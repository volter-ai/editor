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
  overrideMaterialIbl,
} from '@volter/threejs-runtime/render/ibl-override-material';
import {
  type Camera,
  type Material,
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
import type { ReflectionProbeDiffuse } from './probe-controller';
import {
  acquireReflectionProbeRegistry,
  type ReflectionProbeObserver,
  type ReflectionProbeRegistry,
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
  /**
   * Releases the registry leases and the material's own GPU resources: the
   * same as `material.dispose()`, which lets go of everything this handle
   * holds too.
   */
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

/** Whether probe `index` takes part in the reflected (`radiance`) or the diffuse (`irradiance`) term. */
function probeTakesPart(index: number, term: 'radiance' | 'irradiance'): string {
  return term === 'radiance'
    ? `volterProbeReady[${index}] > 0.5`
    : `volterProbeReady[${index}] > 0.5 && volterProbeDiffuseMode[${index}] > 0.5`;
}

function probeWeightBlock(index: number, term: 'radiance' | 'irradiance'): string {
  return `
  if (${probeTakesPart(index, term)}) {${probeWeight(index)}
    if (weight > 0.0) bestPriority = max(bestPriority, volterProbePriority[${index}]);
  }`;
}

function probeSampleBlock(index: number, term: 'radiance' | 'irradiance'): string {
  const [roughness, direction] = term === 'radiance' ? ['roughness', 'worldReflect'] : ['1.0', 'worldNormal'];
  const sampled = `volterTextureCubeUV(
        volterProbeMap${index}, probeDirection, ${roughness}, volterProbeAtlasSize[${index}]
      ).rgb`;
  // The diffuse term is the capture's, or the probe's constant colour (mode 2), with its own weight.
  const light =
    term === 'radiance'
      ? `${sampled} * volterProbeIntensity[${index}]`
      : `(volterProbeDiffuseMode[${index}] > 1.5 ? volterProbeDiffuseColor[${index}] : ${sampled}) * volterProbeDiffuseIntensity[${index}]`;
  return `
  if (${probeTakesPart(index, term)} && abs(volterProbePriority[${index}] - bestPriority) < 0.001) {${probeWeight(index)}
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
      accumulated += ${light} * weight;
      totalWeight += weight;
    }
  }`;
}

/**
 * Three's anisotropic radiance (`getIBLAnisotropyRadiance`, which an
 * anisotropic physical material calls instead of `getIBLRadiance`) bends the
 * normal and samples the radiance; in the renamed base chunk it would sample
 * the environment alone, so it samples the probes' radiance instead (declared
 * ahead of it, defined below).
 */
function anisotropyOverProbes(base: string): string {
  return base.replace(
    /(vec3 getIBLAnisotropyRadiance\([\s\S]*?)getBaseIBLRadiance\(/,
    '$1getIBLRadiance(',
  );
}

/**
 * The IBL chunk for `probeCount` probes, of which the first `sampled` have a
 * sampler (the rest are declared in the arrays, whose length is the program's
 * cache key, and never read).
 */
function volumeReflectionShader(probeCount: number, sampled: number): string {
  const each = (block: (index: number) => string) =>
    Array.from({ length: sampled }, (_, index) => block(index)).join('\n');
  return `#ifdef USE_ENVMAP
vec3 getIBLRadiance(const in vec3 viewDir, const in vec3 normal, const in float roughness);
#endif
${anisotropyOverProbes(baseIblFunctions())}
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
uniform float volterProbeDiffuseMode[${probeCount}];
uniform float volterProbeDiffuseIntensity[${probeCount}];
uniform vec3 volterProbeDiffuseColor[${probeCount}];
uniform float volterProbeParallax[${probeCount}];
uniform float volterBaseEnvironment;
${each((index) => `uniform sampler2D volterProbeMap${index};`)}

vec3 getIBLIrradiance(const in vec3 normal) {
#ifdef ENVMAP_TYPE_CUBE_UV
  vec3 baseIrradiance = getBaseIBLIrradiance(normal) * volterBaseEnvironment;
  vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
  float bestPriority = -1000000.0;
${each((index) => probeWeightBlock(index, 'irradiance'))}
  vec3 accumulated = vec3(0.0);
  float totalWeight = 0.0;
${each((index) => probeSampleBlock(index, 'irradiance'))}
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
${each((index) => probeWeightBlock(index, 'radiance'))}
  vec3 accumulated = vec3(0.0);
  float totalWeight = 0.0;
${each((index) => probeSampleBlock(index, 'radiance'))}
  return totalWeight > 0.0
    ? accumulated / totalWeight * envMapIntensity
    : baseRadiance;
#else
  return getBaseIBLRadiance(viewDir, normal, roughness);
#endif
}
#endif`;
}

/** Every uniform the chunk declares, by name: one object each, for the material's whole life. */
type ProbeUniforms = Readonly<Record<string, { value: unknown }>>;

const ARRAY_UNIFORMS = [
  'volterProbeReady',
  'volterProbeWorldToLocal',
  'volterProbeExtents',
  'volterProbeParallaxExtents',
  'volterProbeParallaxOffset',
  'volterProbeCaptureOffset',
  'volterProbeAtlasSize',
  'volterProbeShape',
  'volterProbeRadius',
  'volterProbeBlendDistance',
  'volterProbePriority',
  'volterProbeIntensity',
  'volterProbeDiffuseMode',
  'volterProbeDiffuseIntensity',
  'volterProbeDiffuseColor',
  'volterProbeParallax',
] as const;

function createProbeUniforms(): ProbeUniforms {
  const uniforms: Record<string, { value: unknown }> = { volterBaseEnvironment: { value: 0 } };
  for (const name of ARRAY_UNIFORMS) uniforms[name] = { value: [] };
  for (let index = 0; index < MAX_PROBES; index += 1) uniforms[`volterProbeMap${index}`] = { value: null };
  return uniforms;
}

/** The probe's diffuse term: 0 none, 1 its capture, 2 its constant colour. */
function diffuseModeOf(config: ReflectionProbeDiffuse): number {
  if (config.diffuse === 'none') return 0;
  return config.diffuse === 'color' ? 2 : 1;
}

/**
 * Write `probes` into the material's uniform objects. Only `.value` changes:
 * every program compiled for the material, in any renderer, holds these same
 * objects, so the next draw uploads what is written here.
 */
function writeProbeUniforms(
  uniforms: ProbeUniforms,
  probes: readonly ReflectionProbeRuntime[],
  baseEnvironment: boolean,
  capturing: boolean,
): void {
  const set = (name: string, value: unknown) => {
    (uniforms[name] as { value: unknown }).value = value;
  };
  const config = (probe: ReflectionProbeRuntime) =>
    probe.mark.config as typeof probe.mark.config & ReflectionProbeDiffuse;
  set('volterProbeReady', probes.map((probe) => Number(probe.ready && !capturing)));
  set('volterProbeWorldToLocal', probes.map((probe) => probe.worldToLocal));
  set('volterProbeExtents', probes.map((probe) => probe.extents));
  set('volterProbeParallaxExtents', probes.map((probe) => probe.parallaxExtents));
  set('volterProbeParallaxOffset', probes.map((probe) => probe.parallaxOffset));
  set('volterProbeCaptureOffset', probes.map((probe) => probe.captureOffset));
  set('volterProbeAtlasSize', probes.map((probe) => atlasSizeOf(probe.texture)));
  set('volterProbeShape', probes.map((probe) => Number(config(probe).shape === 'sphere')));
  set('volterProbeRadius', probes.map((probe) => Math.max(0.01, config(probe).radius)));
  set('volterProbeBlendDistance', probes.map((probe) => Math.max(0, config(probe).blendDistance)));
  set('volterProbePriority', probes.map((probe) => config(probe).priority));
  set('volterProbeIntensity', probes.map((probe) => Math.max(0, config(probe).intensity)));
  set('volterProbeDiffuseMode', probes.map((probe) => diffuseModeOf(config(probe))));
  set(
    'volterProbeDiffuseIntensity',
    probes.map((probe) => Math.max(0, config(probe).diffuseIntensity ?? config(probe).intensity)),
  );
  set(
    'volterProbeDiffuseColor',
    probes.map((probe) => new Vector3(...(config(probe).diffuseColor ?? [0, 0, 0]))),
  );
  set('volterProbeParallax', probes.map((probe) => Number(config(probe).parallaxProjection)));
  set('volterBaseEnvironment', baseEnvironment ? 1 : 0);
  for (let index = 0; index < MAX_PROBES; index += 1) {
    set(`volterProbeMap${index}`, probes[index]?.texture ?? null);
  }
}

/** Texture units a program three compiles with `parameters` binds before any probe's. */
const PARAMETER_TEXTURES = [
  'map',
  'matcap',
  'envMap',
  'lightMap',
  'aoMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'metalnessMap',
  'roughnessMap',
  'anisotropyMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmission',
  'transmissionMap',
  'thicknessMap',
  'gradientMap',
  'alphaMap',
  'skinning',
  'instancingMorph',
  'batchingColor',
] as const;

function texturesBeforeProbes(parameters: Readonly<Record<string, unknown>>): number {
  const count = (name: string) => {
    const value = parameters[name];
    return typeof value === 'number' ? value : 0;
  };
  return (
    PARAMETER_TEXTURES.filter((name) => Boolean(parameters[name])).length +
    // A batched mesh's matrices and ids, a geometry's morph targets.
    (parameters['batching'] ? 2 : 0) +
    (count('morphTargetsCount') > 0 ? 1 : 0) +
    count('numDirLightShadows') +
    count('numPointLightShadows') +
    count('numSpotLightShadows') +
    count('numSpotLightMaps')
  );
}

/** Warned once each: a registry with more probes than a material blends, a renderer out of units. */
const warnedRegistries = new WeakSet<ReflectionProbeRegistry>();
const warnedRenderers = new WeakSet<WebGLRenderer>();

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
 * `onBeforeCompile` and `customProgramCacheKey` may be assigned afterwards as
 * on any three material, and compose with the volume lighting rather than
 * replace it: the assigned hook runs first (a hook that wraps the value it
 * read calls back into this one harmlessly) and the probe chunk is spliced
 * into what it leaves; the assigned cache key is kept in front of the
 * material's own. Reading them back returns the composed functions. The volume
 * lighting cannot be removed by assignment: make a plain material for that.
 *
 * Given no `renderer` and `scene` — a material made before either exists, as
 * a module-level resource is — the material reads the probes of whichever
 * renderer and scene draw it, from their first draw (three's
 * `Material.onBeforeRender`, which runs before that draw compiles its
 * program). It keeps one registry lease per renderer and scene that has drawn
 * it, so two renderers drawing it (an editor viewport and a game view, a
 * throwaway preview renderer) each keep their own probes and never evict each
 * other's; before each draw the material's uniform values are those of the
 * drawing renderer's probes. Given a `renderer` and `scene`, it reads that
 * pair's probes wherever it is drawn. It lets go of every lease when it is
 * disposed (`material.dispose()` or the handle's), taking them up again if it
 * is drawn after that, or when it is garbage collected: whoever holds it owns
 * it as they own any three material.
 *
 * With more probes in the scene than `maxProbes` (at most eight), the ones
 * nearest the camera are blended, reselected as it moves, and the registry
 * warns once. A program blends no more probes than the texture units the
 * renderer has left once the material's maps, environment and shadow maps are
 * bound (`capabilities.maxTextures`); the farthest are dropped from that
 * program, and the renderer warns once.
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

/** One renderer and scene's probes, as this material reads them. */
interface ProbeBinding extends Binding {
  readonly lease: ReflectionProbeRegistryLease;
  /** Held here, so it lives exactly as long as the binding; the registry reaches it weakly. */
  readonly observer: ReflectionProbeObserver;
  stop: () => void;
  probes: readonly ReflectionProbeRuntime[];
  capturing: boolean;
  /** The probes blended, nearest the camera first; its length is the program's probe count. */
  selected: readonly ReflectionProbeRuntime[];
  /** The registry reported since the last selection and write. */
  dirty: boolean;
  readonly camera: Vector3;
}

/**
 * Observe `registry` through a weak reference to `observer`: once the
 * binding that holds the observer is collected (with the material, or with
 * its renderer or scene), the next update stops observing and releases the
 * lease. Module-level on purpose — a closure made inside the material's own
 * scope would hold that scope, and the material with it, from the registry.
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

/** How far the camera is from a probe's volume: 0 inside it. */
function distanceToProbe(probe: ReflectionProbeRuntime, camera: Vector3, local: Vector3): number {
  local.copy(camera).applyMatrix4(probe.worldToLocal);
  if (probe.mark.config.shape === 'sphere') return Math.max(0, local.length() - probe.mark.config.radius);
  const dx = Math.max(0, Math.abs(local.x) - probe.extents.x);
  const dy = Math.max(0, Math.abs(local.y) - probe.extents.y);
  const dz = Math.max(0, Math.abs(local.z) - probe.extents.z);
  return Math.hypot(dx, dy, dz);
}

type CompileHook = Material['onBeforeCompile'];

function ownVolumeReflectionMaterial<T extends MeshStandardMaterial>(
  material: T,
  maxProbes: number | undefined,
  bound: Binding | null,
): VolumeReflectionMaterialHandle<T> {
  const limit = Math.min(MAX_PROBES, Math.max(1, Math.round(maxProbes ?? MAX_PROBES)));
  const sentinel = createIblSentinelTexture();
  const uniforms = createProbeUniforms();
  let authoredEnvMap = material.envMap;
  let bindings = new WeakMap<WebGLRenderer, WeakMap<Scene, ProbeBinding>>();
  // Every binding made, weakly, so disposing can release their leases.
  let made = new Set<WeakRef<ProbeBinding>>();
  let pinned: ProbeBinding | null = null;
  /** The binding of the draw in progress: the program three compiles next is its. */
  let current: ProbeBinding | null = null;
  /** The binding whose values the uniform objects hold. */
  let written: ProbeBinding | null = null;
  /** The samplers the program being compiled declares (its texture units allowing). */
  let sampled = 0;
  const cameraPosition = new Vector3();
  const scratch = new Vector3();

  const probeCount = () => current?.selected.length ?? 0;

  // Three deletes both IBL entry points from a program with no environment at
  // all, so a material that probes apply to needs one native input present to
  // keep them. The author's own value always wins, and `scene.environment` is
  // left to three whenever it exists.
  Object.defineProperty(material, 'envMap', {
    configurable: true,
    enumerable: true,
    get: () =>
      authoredEnvMap ?? (probeCount() === 0 || current?.scene.environment ? null : sentinel),
    set: (value: Texture | null) => {
      authoredEnvMap = value;
    },
  });

  const bind = (renderer: WebGLRenderer, scene: Scene): ProbeBinding => {
    const lease = acquireReflectionProbeRegistry(renderer, scene);
    const binding: ProbeBinding = {
      renderer,
      scene,
      lease,
      observer: (probes, capturing) => {
        binding.probes = probes;
        binding.capturing = capturing;
        binding.dirty = true;
        if (probes.length > limit && !warnedRegistries.has(lease.registry)) {
          warnedRegistries.add(lease.registry);
          // biome-ignore lint/suspicious/noConsole: the uniform arrays have a fixed ceiling; say that probes fell off it.
          console.warn(
            `[reflections] a volume reflection material blends at most ${limit} probes; this scene has ${probes.length}, so the ${limit} nearest the camera are blended.`,
          );
        }
      },
      stop: () => undefined,
      probes: [],
      capturing: false,
      selected: [],
      dirty: true,
      camera: new Vector3(Number.NaN, 0, 0),
    };
    binding.stop = observeWeakly(lease, new WeakRef(binding.observer));
    for (const reference of made) if (!reference.deref()) made.delete(reference);
    made.add(new WeakRef(binding));
    return binding;
  };

  const bindingFor = (renderer: WebGLRenderer, scene: Scene): ProbeBinding => {
    // Made at construction, and again at a draw after a dispose.
    if (bound) {
      pinned ??= bind(bound.renderer, bound.scene);
      return pinned;
    }
    let scenes = bindings.get(renderer);
    if (!scenes) {
      scenes = new WeakMap();
      bindings.set(renderer, scenes);
    }
    let binding = scenes.get(scene);
    if (!binding) {
      binding = bind(renderer, scene);
      scenes.set(scene, binding);
    }
    return binding;
  };

  /**
   * The `limit` probes nearest the camera, nearest first (a program short of
   * texture units samples the first ones); a changed count is another program.
   */
  const select = (binding: ProbeBinding, camera: Camera) => {
    // A capture window zeroes every probe: nothing to choose between.
    if (binding.capturing) return;
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    const moved = !cameraPosition.equals(binding.camera);
    if (!binding.dirty && !(moved && binding.probes.length > 1)) return;
    binding.camera.copy(cameraPosition);
    const next =
      binding.probes.length <= 1
        ? binding.probes
        : binding.probes
            .map((probe) => ({ probe, distance: distanceToProbe(probe, cameraPosition, scratch) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit)
            .map((entry) => entry.probe);
    const previous = binding.selected;
    if (next.length === previous.length && next.every((probe, index) => probe === previous[index])) return;
    if (next.length !== previous.length) material.needsUpdate = true;
    binding.selected = next.slice();
    binding.dirty = true;
  };

  const write = (binding: ProbeBinding) => {
    writeProbeUniforms(
      uniforms,
      binding.selected,
      Boolean(authoredEnvMap ?? binding.scene.environment),
      binding.capturing,
    );
    written = binding;
    binding.dirty = false;
  };

  // Before every draw, in whichever renderer: its probes are the ones the
  // uniform objects hold for this draw. Three uploads a material's uniforms
  // whenever its program or the material drawn changes, and at the start of
  // every render, so a value written here reaches this draw.
  material.onBeforeRender = (renderer, scene, camera) => {
    const binding = bindingFor(renderer, scene);
    current = binding;
    select(binding, camera);
    if (written !== binding || binding.dirty) write(binding);
  };

  // The IBL override goes on ONCE, for the material's whole life: its
  // fragment and cache key are read at compile time from the drawing
  // binding, and every program it compiles holds the same uniform objects.
  overrideMaterialIbl(material, {
    fragment: () =>
      probeCount() === 0
        ? ShaderChunk.envmap_physical_pars_fragment
        : volumeReflectionShader(probeCount(), sampled),
    cacheKey: () => `volter-volume-reflections:${probeCount()}`,
    onCompile: (shader) => {
      Object.assign(shader.uniforms, uniforms);
    },
  });
  const volumeCompile: CompileHook = material.onBeforeCompile;
  const volumeKey = material.customProgramCacheKey;

  // Hooks an author (or another library) assigns later compose with the
  // volume lighting instead of replacing it. One that wraps the value it read
  // calls back into `compile` from inside itself; that inner call does
  // nothing, so its own work runs once and the volume splice follows it.
  let laterCompile: CompileHook | null = null;
  let laterKey: (() => string) | null = null;
  let inside = false;
  const compile: CompileHook = (shader, renderer) => {
    if (inside) return;
    inside = true;
    try {
      laterCompile?.call(material, shader, renderer);
    } finally {
      inside = false;
    }
    const count = probeCount();
    const free = renderer.capabilities.maxTextures - texturesBeforeProbes(shader as unknown as Record<string, unknown>);
    sampled = Math.max(0, Math.min(count, free));
    if (sampled < count && !warnedRenderers.has(renderer)) {
      warnedRenderers.add(renderer);
      // biome-ignore lint/suspicious/noConsole: a GPU's texture units bound how many probes one program can sample.
      console.warn(
        `[reflections] a volume reflection material samples ${sampled} of its ${count} probes: this GPU has ${renderer.capabilities.maxTextures} texture units and the material's maps and shadow maps use the rest. The probes farthest from the camera are left out.`,
      );
    }
    volumeCompile.call(material, shader, renderer);
  };
  const cacheKey = (): string => {
    if (inside) return '';
    inside = true;
    let later: string;
    try {
      later = laterKey ? laterKey.call(material) : laterCompile ? laterCompile.toString() : '';
    } finally {
      inside = false;
    }
    return `${later}|${volumeKey.call(material)}`;
  };
  Object.defineProperty(material, 'onBeforeCompile', {
    configurable: true,
    enumerable: true,
    get: () => compile,
    set: (value: CompileHook) => {
      laterCompile = value === compile ? null : value;
    },
  });
  Object.defineProperty(material, 'customProgramCacheKey', {
    configurable: true,
    enumerable: true,
    get: () => cacheKey,
    set: (value: () => string) => {
      laterKey = value === cacheKey ? null : value;
    },
  });

  const release = () => {
    for (const reference of made) {
      const binding = reference.deref();
      if (!binding) continue;
      binding.stop();
      binding.lease.release();
    }
    made = new Set();
    bindings = new WeakMap();
    pinned = null;
    current = null;
    written = null;
    sentinel.dispose();
  };
  material.addEventListener('dispose', release);

  if (bound) pinned = bind(bound.renderer, bound.scene);

  return {
    material,
    dispose() {
      material.dispose();
    },
  };
}
