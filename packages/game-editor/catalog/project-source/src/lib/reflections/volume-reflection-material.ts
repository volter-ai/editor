/**
 * The ADVANCED path: a material this factory creates and owns, which blends
 * several probe volumes per fragment with box projection.
 *
 * Nothing reaches this except a material an author asked for by calling
 * {@link createVolumeReflectionMaterial}. An ordinary captured reflection is a
 * probe's PMREM texture assigned as a native `envMap` by the author (see
 * `ReflectionProbe.tsx`), and no standard material is ever scanned, cloned or
 * patched to get one. What you get HERE, and only by creating this material,
 * is the model native `envMap` cannot express — one environment per FRAGMENT,
 * so a wall crossing two rooms fades between their probes, an interior reads
 * its projection box instead of a point capture, and a higher-priority probe
 * wins outright inside an overlap.
 *
 * Native material controls stay native. It IS a `MeshStandardMaterial`:
 * `color`, `roughness`, `metalness`, maps and `envMapIntensity` behave exactly
 * as three defines them, the per-probe `intensity` prop is the library's own
 * weighting on top, and where no probe applies the fragment falls back to
 * three's unmodified functions over the material's or scene's environment.
 * (`envMapRotation` applies to that fallback only — a local probe's
 * orientation is its node's transform, which the box projection is expressed
 * in.)
 *
 * **Probes of different resolutions blend together.** Three's own
 * `textureCubeUV` finds a mip using constants the compiler derives from the
 * ONE installed `envMap`; {@link cubeUvSamplingFunctions} is that same sampler
 * with the atlas layout passed in per call, so each probe is sampled inside
 * its own rectangle and the author never has to align resolutions or supply a
 * matching scene environment.
 */
import {
  baseIblFunctions,
  createIblSentinelTexture,
  IBL_WORLD_POSITION,
  type IblOverride,
  type IblOverrideShader,
  overrideMaterialIbl,
} from '@volter/threejs-runtime/render/ibl-override-material';
import {
  MeshPhysicalMaterial,
  type MeshPhysicalMaterialParameters,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  type Scene,
  ShaderChunk,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from 'three';
import {
  acquireReflectionProbeRegistry,
  type ReflectionProbeRegistryLease,
  type ReflectionProbeRuntime,
} from './reflection-probe-registry';

/** The uniform arrays are declared at a fixed length; this is that length's ceiling. */
const MAX_PROBES = 8;

export interface VolumeReflectionMaterialOptions extends MeshStandardMaterialParameters {
  /** Ceiling on simultaneously blended probes; capped at {@link MAX_PROBES}. */
  readonly maxProbes?: number;
}

export interface VolumeReflectionMaterialHandle<
  T extends MeshStandardMaterial = MeshStandardMaterial,
> {
  /** The material this factory created. Use it like any `MeshStandardMaterial`. */
  readonly material: T;
  /** Releases the registry lease and the material's own GPU resources. */
  dispose(): void;
}

/**
 * Three's CubeUV sampler with the atlas layout supplied per texture, so one
 * material can sample probe atlases of different sizes. Every name is prefixed,
 * because three's own copy of this chunk is in the same program and is what
 * the native fallback still uses.
 */
function cubeUvSamplingFunctions(): string {
  return ShaderChunk.cube_uv_reflection_fragment
    .replace(
      /\b(textureCubeUV|bilinearCubeUV)\(([^)]*)\)/g,
      (_match, name: string, args: string) =>
        `${name === 'textureCubeUV' ? 'vgaiTextureCubeUV' : 'vgaiBilinearCubeUV'}(${args.trim()}, ${args.includes('sampler2D') ? 'vec3 ' : ''}vgaiAtlasSize)`,
    )
    .replace(/\b(getFace|getUV|roughnessToMip)\b/g, 'vgai$1')
    .replace(/\bcubeUV_(\w+)\b/g, 'vgaiCubeUV_$1')
    .replaceAll('CUBEUV_MAX_MIP', 'vgaiAtlasSize.z')
    .replaceAll('CUBEUV_TEXEL_WIDTH', 'vgaiAtlasSize.x')
    .replaceAll('CUBEUV_TEXEL_HEIGHT', 'vgaiAtlasSize.y');
}

/**
 * `(texelWidth, texelHeight, maxMip)` for one PMREM atlas — three's own
 * `generateCubeUVSize`, which reads the installed envMap's image height, asked
 * per texture instead.
 */
function atlasSizeOf(texture: Texture | null): Vector3 {
  const height = (texture?.image as { height?: number } | undefined)?.height ?? 0;
  if (height <= 0) return new Vector3(0, 0, 0);
  const maxMip = Math.log2(height) - 2;
  return new Vector3(1 / (3 * Math.max(2 ** maxMip, 7 * 16)), 1 / height, maxMip);
}

function probeWeight(index: number): string {
  return `
    vec3 lp = (vgaiProbeWorldToLocal[${index}] * vec4(${IBL_WORLD_POSITION}, 1.0)).xyz;
    float weight = 0.0;
    if (vgaiProbeShape[${index}] < 0.5) {
      vec3 edge = vgaiProbeExtents[${index}] - abs(lp);
      if (all(greaterThanEqual(edge, vec3(0.0)))) {
        float nearest = min(edge.x, min(edge.y, edge.z));
        weight = vgaiProbeBlendDistance[${index}] > 0.0001
          ? clamp(nearest / vgaiProbeBlendDistance[${index}], 0.0, 1.0)
          : 1.0;
      }
    } else {
      float edge = vgaiProbeRadius[${index}] - length(lp);
      if (edge >= 0.0) {
        weight = vgaiProbeBlendDistance[${index}] > 0.0001
          ? clamp(edge / vgaiProbeBlendDistance[${index}], 0.0, 1.0)
          : 1.0;
      }
    }`;
}

function probeWeightBlock(index: number): string {
  return `
  if (vgaiProbeReady[${index}] > 0.5) {${probeWeight(index)}
    if (weight > 0.0) bestPriority = max(bestPriority, vgaiProbePriority[${index}]);
  }`;
}

function probeSampleBlock(index: number, roughness: string, direction: string): string {
  return `
  if (vgaiProbeReady[${index}] > 0.5 && abs(vgaiProbePriority[${index}] - bestPriority) < 0.001) {${probeWeight(index)}
    if (weight > 0.0) {
      vec3 probeDirection = (vgaiProbeWorldToLocal[${index}] * vec4(${direction}, 0.0)).xyz;
      if (vgaiProbeParallax[${index}] > 0.5) {
        vec3 boxPos = lp - vgaiProbeParallaxOffset[${index}];
        vec3 safeDirection = sign(probeDirection) * max(abs(probeDirection), vec3(0.00001));
        vec3 rayMax = (vgaiProbeParallaxExtents[${index}] - boxPos) / safeDirection;
        vec3 rayMin = (-vgaiProbeParallaxExtents[${index}] - boxPos) / safeDirection;
        vec3 rayDistance = mix(rayMin, rayMax, greaterThan(safeDirection, vec3(0.0)));
        float nearestFace = min(rayDistance.x, min(rayDistance.y, rayDistance.z));
        probeDirection = boxPos + safeDirection * nearestFace
          + vgaiProbeParallaxOffset[${index}] - vgaiProbeCaptureOffset[${index}];
      }
      accumulated += vgaiTextureCubeUV(
        vgaiProbeMap${index}, probeDirection, ${roughness}, vgaiProbeAtlasSize[${index}]
      ).rgb * vgaiProbeIntensity[${index}] * weight;
      totalWeight += weight;
    }
  }`;
}

function volumeReflectionShader(probeCount: number): string {
  const samplers = Array.from(
    { length: probeCount },
    (_, index) => `uniform sampler2D vgaiProbeMap${index};`,
  ).join('\n');
  const weights = Array.from({ length: probeCount }, (_, index) => probeWeightBlock(index)).join(
    '\n',
  );
  const radiance = Array.from({ length: probeCount }, (_, index) =>
    probeSampleBlock(index, 'roughness', 'worldReflect'),
  ).join('\n');
  const irradiance = Array.from({ length: probeCount }, (_, index) =>
    probeSampleBlock(index, '1.0', 'worldNormal'),
  ).join('\n');
  return `${baseIblFunctions()}
${cubeUvSamplingFunctions()}
#ifdef USE_ENVMAP
uniform float vgaiProbeReady[${probeCount}];
uniform mat4 vgaiProbeWorldToLocal[${probeCount}];
uniform vec3 vgaiProbeExtents[${probeCount}];
uniform vec3 vgaiProbeParallaxExtents[${probeCount}];
uniform vec3 vgaiProbeParallaxOffset[${probeCount}];
uniform vec3 vgaiProbeCaptureOffset[${probeCount}];
uniform vec3 vgaiProbeAtlasSize[${probeCount}];
uniform float vgaiProbeShape[${probeCount}];
uniform float vgaiProbeRadius[${probeCount}];
uniform float vgaiProbeBlendDistance[${probeCount}];
uniform float vgaiProbePriority[${probeCount}];
uniform float vgaiProbeIntensity[${probeCount}];
uniform float vgaiProbeParallax[${probeCount}];
uniform float vgaiBaseEnvironment;
${samplers}

vec3 getIBLIrradiance(const in vec3 normal) {
#ifdef ENVMAP_TYPE_CUBE_UV
  vec3 baseIrradiance = getBaseIBLIrradiance(normal) * vgaiBaseEnvironment;
  vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
  float bestPriority = -1000000.0;
${weights}
  vec3 accumulated = vec3(0.0);
  float totalWeight = 0.0;
${irradiance}
  return totalWeight > 0.0
    ? PI * accumulated / totalWeight * envMapIntensity
    : baseIrradiance;
#else
  return getBaseIBLIrradiance(normal);
#endif
}

vec3 getIBLRadiance(const in vec3 viewDir, const in vec3 normal, const in float roughness) {
#ifdef ENVMAP_TYPE_CUBE_UV
  vec3 baseRadiance = getBaseIBLRadiance(viewDir, normal, roughness) * vgaiBaseEnvironment;
  vec3 reflected = reflect(-viewDir, normal);
  reflected = normalize(mix(reflected, normal, roughness * roughness));
  vec3 worldReflect = inverseTransformDirection(reflected, viewMatrix);
  float bestPriority = -1000000.0;
${weights}
  vec3 accumulated = vec3(0.0);
  float totalWeight = 0.0;
${radiance}
  return totalWeight > 0.0
    ? accumulated / totalWeight * envMapIntensity
    : baseRadiance;
#else
  return getBaseIBLRadiance(viewDir, normal, roughness);
#endif
}
#endif`;
}

function writeProbeUniforms(
  shader: IblOverrideShader | null,
  probes: readonly ReflectionProbeRuntime[],
  baseEnvironment: boolean,
  capturing: boolean,
): void {
  if (!shader) return;
  const values = <T>(name: string, value: T) => {
    shader.uniforms[name] = { value };
  };
  values(
    'vgaiProbeReady',
    probes.map((probe) => Number(probe.ready && !capturing)),
  );
  values(
    'vgaiProbeWorldToLocal',
    probes.map((probe) => probe.worldToLocal),
  );
  values(
    'vgaiProbeExtents',
    probes.map((probe) => probe.extents),
  );
  values(
    'vgaiProbeParallaxExtents',
    probes.map((probe) => probe.parallaxExtents),
  );
  values(
    'vgaiProbeParallaxOffset',
    probes.map((probe) => probe.parallaxOffset),
  );
  values(
    'vgaiProbeCaptureOffset',
    probes.map((probe) => probe.captureOffset),
  );
  values(
    'vgaiProbeAtlasSize',
    probes.map((probe) => atlasSizeOf(probe.texture)),
  );
  values(
    'vgaiProbeShape',
    probes.map((probe) => Number(probe.mark.config.shape === 'sphere')),
  );
  values(
    'vgaiProbeRadius',
    probes.map((probe) => Math.max(0.01, probe.mark.config.radius)),
  );
  values(
    'vgaiProbeBlendDistance',
    probes.map((probe) => Math.max(0, probe.mark.config.blendDistance)),
  );
  values(
    'vgaiProbePriority',
    probes.map((probe) => probe.mark.config.priority),
  );
  values(
    'vgaiProbeIntensity',
    probes.map((probe) => Math.max(0, probe.mark.config.intensity)),
  );
  values(
    'vgaiProbeParallax',
    probes.map((probe) => Number(probe.mark.config.parallaxProjection)),
  );
  values('vgaiBaseEnvironment', baseEnvironment ? 1 : 0);
  probes.forEach((probe, index) => {
    values(`vgaiProbeMap${index}`, probe.texture);
  });
}

/**
 * Create a `MeshStandardMaterial` that blends the scene's reflection probes
 * per fragment. `options` are ordinary material parameters plus `maxProbes`.
 *
 * The material is this factory's: no existing material is mutated, and only
 * meshes the author assigns it to are affected. Assigning `envMap` later works
 * as usual and takes over the fallback term — the black texture that keeps
 * three's IBL entry points compiled when there is no environment at all is
 * installed behind that property and never replaces an assigned map.
 */
export function createVolumeReflectionMaterial(
  renderer: WebGLRenderer,
  scene: Scene,
  options: VolumeReflectionMaterialOptions = {},
): VolumeReflectionMaterialHandle {
  const { maxProbes, ...parameters } = options;
  return ownVolumeReflectionMaterial(
    renderer,
    scene,
    new MeshStandardMaterial(parameters),
    maxProbes,
  );
}

export interface VolumeReflectionPhysicalMaterialOptions extends MeshPhysicalMaterialParameters {
  readonly maxProbes?: number;
}

/** The same explicit volume effect with Three's physical material controls. */
export function createVolumeReflectionPhysicalMaterial(
  renderer: WebGLRenderer,
  scene: Scene,
  options: VolumeReflectionPhysicalMaterialOptions = {},
): VolumeReflectionMaterialHandle<MeshPhysicalMaterial> {
  const { maxProbes, ...parameters } = options;
  return ownVolumeReflectionMaterial(
    renderer,
    scene,
    new MeshPhysicalMaterial(parameters),
    maxProbes,
  );
}

function ownVolumeReflectionMaterial<T extends MeshStandardMaterial>(
  renderer: WebGLRenderer,
  scene: Scene,
  material: T,
  maxProbes: number | undefined,
): VolumeReflectionMaterialHandle<T> {
  const limit = Math.min(MAX_PROBES, Math.max(1, Math.round(maxProbes ?? MAX_PROBES)));
  const sentinel = createIblSentinelTexture();
  let authoredEnvMap = material.envMap;
  let override: IblOverride | null = null;
  let installedCount = 0;
  let warnedOverflow = false;
  let eligible: readonly ReflectionProbeRuntime[] = [];
  let isCapturing = false;
  let lease: ReflectionProbeRegistryLease | null = acquireReflectionProbeRegistry(renderer, scene);

  // Three deletes both IBL entry points from a program with no environment at
  // all, so a probe-only material needs one native input present to keep them.
  // The author's own value always wins, and `scene.environment` is left to
  // three whenever it exists.
  const hasBaseEnvironment = () => Boolean(authoredEnvMap ?? scene.environment);
  Object.defineProperty(material, 'envMap', {
    configurable: true,
    enumerable: true,
    get: () => authoredEnvMap ?? (scene.environment ? null : sentinel),
    set: (value: Texture | null) => {
      authoredEnvMap = value;
    },
  });

  const uninstall = () => {
    override?.restore();
    override = null;
    installedCount = 0;
  };

  const install = (count: number) => {
    uninstall();
    installedCount = count;
    override = overrideMaterialIbl(material, {
      fragment: () => volumeReflectionShader(count),
      cacheKey: () => `vgai-volume-reflections:${count}`,
      onCompile: (shader) =>
        writeProbeUniforms(shader, eligible, hasBaseEnvironment(), isCapturing),
    });
  };

  const unobserve = lease.registry.observe(
    (probes: readonly ReflectionProbeRuntime[], capturing: boolean) => {
      isCapturing = capturing;
      eligible = probes.slice(0, limit);
      if (probes.length > limit && !warnedOverflow) {
        warnedOverflow = true;
        // biome-ignore lint/suspicious/noConsole: the uniform arrays have a fixed ceiling; say which probes fell off it.
        console.warn(
          `[reflections] "${material.name || 'volume reflection material'}" blends at most ${limit} probes; ${probes.length - limit} more are in the scene and are not sampled.`,
        );
      }
      if (eligible.length !== installedCount) {
        if (eligible.length === 0) uninstall();
        else install(eligible.length);
      }
      writeProbeUniforms(override?.shader ?? null, eligible, hasBaseEnvironment(), capturing);
    },
  );

  return {
    material,
    dispose() {
      unobserve();
      uninstall();
      sentinel.dispose();
      material.dispose();
      lease?.release();
      lease = null;
    },
  };
}
