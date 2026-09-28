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
  type ReflectionProbeObserver,
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
        `${name === 'textureCubeUV' ? 'volterTextureCubeUV' : 'volterBilinearCubeUV'}(${args.trim()}, ${args.includes('sampler2D') ? 'vec3 ' : ''}volterAtlasSize)`,
    )
    .replace(/\b(getFace|getUV|roughnessToMip)\b/g, 'volter$1')
    .replace(/\bcubeUV_(\w+)\b/g, 'volterCubeUV_$1')
    .replaceAll('CUBEUV_MAX_MIP', 'volterAtlasSize.z')
    .replaceAll('CUBEUV_TEXEL_WIDTH', 'volterAtlasSize.x')
    .replaceAll('CUBEUV_TEXEL_HEIGHT', 'volterAtlasSize.y');
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
    vec3 lp = (volterProbeWorldToLocal[${index}] * vec4(${IBL_WORLD_POSITION}, 1.0)).xyz;
    float weight = 0.0;
    if (volterProbeShape[${index}] < 0.5) {
      vec3 edge = volterProbeExtents[${index}] - abs(lp);
      if (all(greaterThanEqual(edge, vec3(0.0)))) {
        float nearest = min(edge.x, min(edge.y, edge.z));
        weight = volterProbeBlendDistance[${index}] > 0.0001
          ? clamp(nearest / volterProbeBlendDistance[${index}], 0.0, 1.0)
          : 1.0;
      }
    } else {
      float edge = volterProbeRadius[${index}] - length(lp);
      if (edge >= 0.0) {
        weight = volterProbeBlendDistance[${index}] > 0.0001
          ? clamp(edge / volterProbeBlendDistance[${index}], 0.0, 1.0)
          : 1.0;
      }
    }`;
}

function probeWeightBlock(index: number): string {
  return `
  if (volterProbeReady[${index}] > 0.5) {${probeWeight(index)}
    if (weight > 0.0) bestPriority = max(bestPriority, volterProbePriority[${index}]);
  }`;
}

function probeSampleBlock(index: number, roughness: string, direction: string): string {
  return `
  if (volterProbeReady[${index}] > 0.5 && abs(volterProbePriority[${index}] - bestPriority) < 0.001) {${probeWeight(index)}
    if (weight > 0.0) {
      vec3 probeDirection = (volterProbeWorldToLocal[${index}] * vec4(${direction}, 0.0)).xyz;
      if (volterProbeParallax[${index}] > 0.5) {
        vec3 boxPos = lp - volterProbeParallaxOffset[${index}];
        vec3 safeDirection = sign(probeDirection) * max(abs(probeDirection), vec3(0.00001));
        vec3 rayMax = (volterProbeParallaxExtents[${index}] - boxPos) / safeDirection;
        vec3 rayMin = (-volterProbeParallaxExtents[${index}] - boxPos) / safeDirection;
        vec3 rayDistance = mix(rayMin, rayMax, greaterThan(safeDirection, vec3(0.0)));
        float nearestFace = min(rayDistance.x, min(rayDistance.y, rayDistance.z));
        probeDirection = boxPos + safeDirection * nearestFace
          + volterProbeParallaxOffset[${index}] - volterProbeCaptureOffset[${index}];
      }
      accumulated += volterTextureCubeUV(
        volterProbeMap${index}, probeDirection, ${roughness}, volterProbeAtlasSize[${index}]
      ).rgb * volterProbeIntensity[${index}] * weight;
      totalWeight += weight;
    }
  }`;
}

function volumeReflectionShader(probeCount: number): string {
  const samplers = Array.from(
    { length: probeCount },
    (_, index) => `uniform sampler2D volterProbeMap${index};`,
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
uniform float volterProbeReady[${probeCount}];
uniform mat4 volterProbeWorldToLocal[${probeCount}];
uniform vec3 volterProbeExtents[${probeCount}];
uniform vec3 volterProbeParallaxExtents[${probeCount}];
uniform vec3 volterProbeParallaxOffset[${probeCount}];
uniform vec3 volterProbeCaptureOffset[${probeCount}];
uniform vec3 volterProbeAtlasSize[${probeCount}];
uniform float volterProbeShape[${probeCount}];
uniform float volterProbeRadius[${probeCount}];
uniform float volterProbeBlendDistance[${probeCount}];
uniform float volterProbePriority[${probeCount}];
uniform float volterProbeIntensity[${probeCount}];
uniform float volterProbeParallax[${probeCount}];
uniform float volterBaseEnvironment;
${samplers}

vec3 getIBLIrradiance(const in vec3 normal) {
#ifdef ENVMAP_TYPE_CUBE_UV
  vec3 baseIrradiance = getBaseIBLIrradiance(normal) * volterBaseEnvironment;
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
  vec3 baseRadiance = getBaseIBLRadiance(viewDir, normal, roughness) * volterBaseEnvironment;
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
    'volterProbeReady',
    probes.map((probe) => Number(probe.ready && !capturing)),
  );
  values(
    'volterProbeWorldToLocal',
    probes.map((probe) => probe.worldToLocal),
  );
  values(
    'volterProbeExtents',
    probes.map((probe) => probe.extents),
  );
  values(
    'volterProbeParallaxExtents',
    probes.map((probe) => probe.parallaxExtents),
  );
  values(
    'volterProbeParallaxOffset',
    probes.map((probe) => probe.parallaxOffset),
  );
  values(
    'volterProbeCaptureOffset',
    probes.map((probe) => probe.captureOffset),
  );
  values(
    'volterProbeAtlasSize',
    probes.map((probe) => atlasSizeOf(probe.texture)),
  );
  values(
    'volterProbeShape',
    probes.map((probe) => Number(probe.mark.config.shape === 'sphere')),
  );
  values(
    'volterProbeRadius',
    probes.map((probe) => Math.max(0.01, probe.mark.config.radius)),
  );
  values(
    'volterProbeBlendDistance',
    probes.map((probe) => Math.max(0, probe.mark.config.blendDistance)),
  );
  values(
    'volterProbePriority',
    probes.map((probe) => probe.mark.config.priority),
  );
  values(
    'volterProbeIntensity',
    probes.map((probe) => Math.max(0, probe.mark.config.intensity)),
  );
  values(
    'volterProbeParallax',
    probes.map((probe) => Number(probe.mark.config.parallaxProjection)),
  );
  values('volterBaseEnvironment', baseEnvironment ? 1 : 0);
  probes.forEach((probe, index) => {
    values(`volterProbeMap${index}`, probe.texture);
  });
}

/** The parameters and, when given, the renderer and scene of either factory's two forms. */
function splitArguments<O>(
  first: WebGLRenderer | O | undefined,
  scene: Scene | undefined,
  options: O | undefined,
): { readonly bound: Binding | null; readonly options: O | undefined } {
  const renderer = first as WebGLRenderer | undefined;
  if (typeof renderer?.render === 'function' && scene !== undefined) {
    return { bound: { renderer, scene }, options };
  }
  return { bound: null, options: first as O | undefined };
}

/**
 * Create a `MeshStandardMaterial` that blends the scene's reflection probes
 * per fragment. `options` are ordinary material parameters plus `maxProbes`.
 *
 * The material is this factory's: no existing material is mutated, and only
 * meshes the author assigns it to are affected. Assigning `envMap` later works
 * as usual and takes over the fallback term — the black texture that keeps
 * three's IBL entry points compiled when probes apply and there is no
 * environment at all is installed behind that property and never replaces an
 * assigned map. Where the scene has no probes the material draws as three's
 * own.
 *
 * Given no `renderer` and `scene` — a material made before either exists, as
 * a module-level resource is — the material reads the probes of the renderer
 * and scene that draw it, from its first draw (three's
 * `Material.onBeforeRender`, which runs before that draw compiles its
 * program); a draw by another renderer (the canvas remounted) moves it to that
 * renderer's probes. It lets go of them when it is disposed, taking them up
 * again if it is drawn after that, or when it is garbage collected: whoever
 * holds it owns it as they own any three material.
 */
export function createVolumeReflectionMaterial(
  options?: VolumeReflectionMaterialOptions,
): VolumeReflectionMaterialHandle;
export function createVolumeReflectionMaterial(
  renderer: WebGLRenderer,
  scene: Scene,
  options?: VolumeReflectionMaterialOptions,
): VolumeReflectionMaterialHandle;
export function createVolumeReflectionMaterial(
  first?: WebGLRenderer | VolumeReflectionMaterialOptions,
  scene?: Scene,
  options?: VolumeReflectionMaterialOptions,
): VolumeReflectionMaterialHandle {
  const split = splitArguments(first, scene, options);
  const { maxProbes, ...parameters } = split.options ?? {};
  return ownVolumeReflectionMaterial(new MeshStandardMaterial(parameters), maxProbes, split.bound);
}

export interface VolumeReflectionPhysicalMaterialOptions extends MeshPhysicalMaterialParameters {
  readonly maxProbes?: number;
}

/** The same explicit volume effect with Three's physical material controls. */
export function createVolumeReflectionPhysicalMaterial(
  options?: VolumeReflectionPhysicalMaterialOptions,
): VolumeReflectionMaterialHandle<MeshPhysicalMaterial>;
export function createVolumeReflectionPhysicalMaterial(
  renderer: WebGLRenderer,
  scene: Scene,
  options?: VolumeReflectionPhysicalMaterialOptions,
): VolumeReflectionMaterialHandle<MeshPhysicalMaterial>;
export function createVolumeReflectionPhysicalMaterial(
  first?: WebGLRenderer | VolumeReflectionPhysicalMaterialOptions,
  scene?: Scene,
  options?: VolumeReflectionPhysicalMaterialOptions,
): VolumeReflectionMaterialHandle<MeshPhysicalMaterial> {
  const split = splitArguments(first, scene, options);
  const { maxProbes, ...parameters } = split.options ?? {};
  return ownVolumeReflectionMaterial(new MeshPhysicalMaterial(parameters), maxProbes, split.bound);
}

interface Binding {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
}

/**
 * Observe `registry` through a weak reference to `observer`: once the
 * material that holds the observer is collected, the next update stops
 * observing and releases the lease. Module-level on purpose — a closure made
 * inside the material's own scope would hold that scope, and the material
 * with it, from the registry.
 */
function observeWeakly(
  lease: ReflectionProbeRegistryLease,
  observer: WeakRef<ReflectionProbeObserver>,
): () => void {
  let stop = (): void => undefined;
  stop = lease.registry.observe((probes, capturing) => {
    const live = observer.deref();
    if (live) {
      live(probes, capturing);
      return;
    }
    stop();
    lease.release();
  });
  return stop;
}

function ownVolumeReflectionMaterial<T extends MeshStandardMaterial>(
  material: T,
  maxProbes: number | undefined,
  bound: Binding | null,
): VolumeReflectionMaterialHandle<T> {
  const limit = Math.min(MAX_PROBES, Math.max(1, Math.round(maxProbes ?? MAX_PROBES)));
  const sentinel = createIblSentinelTexture();
  let authoredEnvMap = material.envMap;
  let warnedOverflow = false;
  let eligible: readonly ReflectionProbeRuntime[] = [];
  let isCapturing = false;
  let binding: (Binding & { readonly lease: ReflectionProbeRegistryLease; stop: () => void }) | null = null;
  let override: IblOverride | null = null;

  // Three deletes both IBL entry points from a program with no environment at
  // all, so a material that probes apply to needs one native input present to
  // keep them. The author's own value always wins, and `scene.environment` is
  // left to three whenever it exists.
  const hasBaseEnvironment = () => Boolean(authoredEnvMap ?? binding?.scene.environment);
  Object.defineProperty(material, 'envMap', {
    configurable: true,
    enumerable: true,
    get: () =>
      authoredEnvMap ?? (eligible.length === 0 || binding?.scene.environment ? null : sentinel),
    set: (value: Texture | null) => {
      authoredEnvMap = value;
    },
  });

  // The observer, held only by this scope: the registry reaches it weakly.
  const observe: ReflectionProbeObserver = (probes, capturing) => {
    isCapturing = capturing;
    const next = probes.slice(0, limit);
    if (probes.length > limit && !warnedOverflow) {
      warnedOverflow = true;
      // biome-ignore lint/suspicious/noConsole: the uniform arrays have a fixed ceiling; say which probes fell off it.
      console.warn(
        `[reflections] "${material.name || 'volume reflection material'}" blends at most ${limit} probes; ${probes.length - limit} more are in the scene and are not sampled.`,
      );
    }
    // The probe count is the declared arrays' length: another count is another program.
    if (next.length !== eligible.length) material.needsUpdate = true;
    eligible = next;
    writeProbeUniforms(override?.shader ?? null, eligible, hasBaseEnvironment(), capturing);
  };

  const unbind = () => {
    if (!binding) return;
    binding.stop();
    binding.lease.release();
    binding = null;
    override?.restore();
    override = null;
    eligible = [];
  };

  const bind = ({ renderer, scene }: Binding) => {
    unbind();
    // Installed once per binding: the fragment and the cache key are read at
    // compile time, so a changed probe count only recompiles.
    override = overrideMaterialIbl(material, {
      fragment: () =>
        eligible.length === 0
          ? ShaderChunk.envmap_physical_pars_fragment
          : volumeReflectionShader(eligible.length),
      cacheKey: () => `volter-volume-reflections:${eligible.length}`,
      onCompile: (shader) =>
        writeProbeUniforms(shader, eligible, hasBaseEnvironment(), isCapturing),
    });
    const lease = acquireReflectionProbeRegistry(renderer, scene);
    // Bound before observing: the first observation reads the scene's environment.
    const bound = { renderer, scene, lease, stop: (): void => undefined };
    binding = bound;
    bound.stop = observeWeakly(lease, new WeakRef(observe));
  };

  if (bound) {
    bind(bound);
  } else {
    material.onBeforeRender = (renderer, scene) => {
      if (binding?.renderer !== renderer) bind({ renderer, scene });
    };
    material.addEventListener('dispose', unbind);
  }

  return {
    material,
    dispose() {
      unbind();
      sentinel.dispose();
      material.dispose();
    },
  };
}
