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
  Matrix4,
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
 * `(texelWidth, texelHeight, maxMip)` for one PMREM atlas, written into
 * `target` — three's own `generateCubeUVSize`, which reads the installed
 * envMap's image height, asked per texture instead.
 */
function atlasSizeInto(texture: Texture | null, target: Vector3): Vector3 {
  const height = (texture?.image as { height?: number } | undefined)?.height ?? 0;
  if (height <= 0) return target.set(0, 0, 0);
  const maxMip = Math.log2(height) - 2;
  return target.set(1 / (3 * Math.max(2 ** maxMip, 7 * 16)), 1 / height, maxMip);
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

const FLOAT_UNIFORMS = [
  'volterProbeReady',
  'volterProbeShape',
  'volterProbeRadius',
  'volterProbeBlendDistance',
  'volterProbePriority',
  'volterProbeIntensity',
  'volterProbeDiffuseMode',
  'volterProbeDiffuseIntensity',
  'volterProbeParallax',
] as const;

const VECTOR_UNIFORMS = [
  'volterProbeExtents',
  'volterProbeParallaxExtents',
  'volterProbeParallaxOffset',
  'volterProbeCaptureOffset',
  'volterProbeAtlasSize',
  'volterProbeDiffuseColor',
] as const;

function createProbeUniforms(): ProbeUniforms {
  const uniforms: Record<string, { value: unknown }> = {
    volterBaseEnvironment: { value: 0 },
    volterProbeWorldToLocal: { value: null },
  };
  for (const name of [...FLOAT_UNIFORMS, ...VECTOR_UNIFORMS]) uniforms[name] = { value: null };
  for (let index = 0; index < MAX_PROBES; index += 1) uniforms[`volterProbeMap${index}`] = { value: null };
  return uniforms;
}

/**
 * One binding's probe values, allocated once and rewritten in place. Every
 * array is {@link MAX_PROBES} long whatever the program declares, the entries
 * past the selected probes neutral (not ready, identity, zero), so a program
 * compiled for more probes than are selected still uploads in full and
 * lights nothing from the extra ones.
 */
interface ProbeValues {
  readonly floats: Readonly<Record<(typeof FLOAT_UNIFORMS)[number], Float32Array>>;
  readonly vectors: Readonly<Record<(typeof VECTOR_UNIFORMS)[number], readonly Vector3[]>>;
  readonly worldToLocal: readonly Matrix4[];
  readonly maps: (Texture | null)[];
}

function createProbeValues(): ProbeValues {
  const floats = {} as Record<(typeof FLOAT_UNIFORMS)[number], Float32Array>;
  for (const name of FLOAT_UNIFORMS) floats[name] = new Float32Array(MAX_PROBES);
  const vectors = {} as Record<(typeof VECTOR_UNIFORMS)[number], readonly Vector3[]>;
  for (const name of VECTOR_UNIFORMS) vectors[name] = Array.from({ length: MAX_PROBES }, () => new Vector3());
  return {
    floats,
    vectors,
    worldToLocal: Array.from({ length: MAX_PROBES }, () => new Matrix4()),
    maps: Array.from({ length: MAX_PROBES }, () => null),
  };
}

/** The probe's diffuse term: 0 none, 1 its capture, 2 its constant colour. */
function diffuseModeOf(config: ReflectionProbeDiffuse): number {
  if (config.diffuse === 'none') return 0;
  return config.diffuse === 'color' ? 2 : 1;
}

/** Rewrite `values` in place for `probes`, padding the rest with neutral entries. */
function fillProbeValues(
  values: ProbeValues,
  probes: readonly ReflectionProbeRuntime[],
  capturing: boolean,
): void {
  const { floats, vectors } = values;
  for (let index = 0; index < MAX_PROBES; index += 1) {
    const probe = probes[index];
    if (!probe) {
      for (const name of FLOAT_UNIFORMS) floats[name][index] = 0;
      for (const name of VECTOR_UNIFORMS) vectors[name][index]!.set(0, 0, 0);
      values.worldToLocal[index]!.identity();
      values.maps[index] = null;
      continue;
    }
    const config = probe.mark.config as typeof probe.mark.config & ReflectionProbeDiffuse;
    floats.volterProbeReady[index] = Number(probe.ready && !capturing);
    floats.volterProbeShape[index] = Number(config.shape === 'sphere');
    floats.volterProbeRadius[index] = Math.max(0.01, config.radius);
    floats.volterProbeBlendDistance[index] = Math.max(0, config.blendDistance);
    floats.volterProbePriority[index] = config.priority;
    floats.volterProbeIntensity[index] = Math.max(0, config.intensity);
    floats.volterProbeDiffuseMode[index] = diffuseModeOf(config);
    floats.volterProbeDiffuseIntensity[index] = Math.max(0, config.diffuseIntensity ?? config.intensity);
    floats.volterProbeParallax[index] = Number(config.parallaxProjection);
    vectors.volterProbeExtents[index]!.copy(probe.extents);
    vectors.volterProbeParallaxExtents[index]!.copy(probe.parallaxExtents);
    vectors.volterProbeParallaxOffset[index]!.copy(probe.parallaxOffset);
    vectors.volterProbeCaptureOffset[index]!.copy(probe.captureOffset);
    atlasSizeInto(probe.texture, vectors.volterProbeAtlasSize[index]!);
    const color = config.diffuseColor;
    vectors.volterProbeDiffuseColor[index]!.set(color?.[0] ?? 0, color?.[1] ?? 0, color?.[2] ?? 0);
    values.worldToLocal[index]!.copy(probe.worldToLocal);
    values.maps[index] = probe.texture;
  }
}

/**
 * Point the material's uniform objects at `values`. Only `.value` changes:
 * every program compiled for the material, in any renderer, holds these same
 * objects, so the next draw uploads what they point at.
 */
function pointProbeUniforms(uniforms: ProbeUniforms, values: ProbeValues): void {
  const set = (name: string, value: unknown) => {
    (uniforms[name] as { value: unknown }).value = value;
  };
  for (const name of FLOAT_UNIFORMS) set(name, values.floats[name]);
  for (const name of VECTOR_UNIFORMS) set(name, values.vectors[name]);
  set('volterProbeWorldToLocal', values.worldToLocal);
  for (let index = 0; index < MAX_PROBES; index += 1) set(`volterProbeMap${index}`, values.maps[index]);
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
    // A rect area light's two LTC lookup textures.
    (count('numRectAreaLights') > 0 ? 2 : 0) +
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
 * `onBeforeCompile`, `customProgramCacheKey` and `onBeforeRender` are the
 * material's own hooks, and compose as three's hooks do: reading one returns
 * exactly what was last assigned (the material's own before that), and a hook
 * that wraps the value it read and calls it keeps the volume lighting, however
 * many wrap it in turn. The probe chunk is spliced once per program, where the
 * chain reaches the material's own hook; with no probes to light nothing is
 * spliced, so a hook that takes three's IBL chunk for itself still finds it.
 * A hook assigned without calling the one it replaces replaces the volume
 * lighting too, as on any three material.
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
 * renderer has left once the material's maps, environment, shadow maps and
 * area-light tables are bound (`capabilities.maxTextures`); the farthest are
 * dropped from that program, and the renderer warns once.
 *
 * A program compiled without a draw (`renderer.compile`) takes the probe count
 * of the binding that drew last; the renderer's next draw recompiles it if its
 * own probes differ, and until then the program's extra probe slots light
 * nothing.
 *
 * `clone()` and `toJSON()` see the author's `envMap` (null if none), never the
 * black texture that stands in for it while probes apply.
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
  readonly selected: ReflectionProbeRuntime[];
  /** The registry reported, or the selection changed, since `values` were last filled. */
  dirty: boolean;
  readonly camera: Vector3;
  /** This binding's uniform values, rewritten in place. */
  readonly values: ProbeValues;
  /** Scratch for selection: the nearest probes so far and their distances. */
  readonly nearest: (ReflectionProbeRuntime | undefined)[];
  readonly nearestDistance: Float64Array;
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

/** The chunks the probe splice reads from three's program, or the first missing. */
function missingChunk(shader: { vertexShader: string; fragmentShader: string }): string | null {
  if (!shader.vertexShader.includes('#include <worldpos_vertex>')) return '#include <worldpos_vertex>';
  if (!shader.fragmentShader.includes('#include <envmap_physical_pars_fragment>')) {
    return '#include <envmap_physical_pars_fragment>';
  }
  return null;
}

type CompileHook = Material['onBeforeCompile'];
type RenderHook = Material['onBeforeRender'];

/**
 * Make `name` an accessor that reads back exactly what was last assigned, or
 * `own` before anything was (or once `own` is assigned back). Three calls
 * what it reads, so a hook that wraps the value it read chains to `own`.
 */
function ownHook<F>(material: Material, name: string, own: F): void {
  let assigned: F | null = null;
  Object.defineProperty(material, name, {
    configurable: true,
    enumerable: true,
    get: () => assigned ?? own,
    set: (value: F) => {
      assigned = value === own ? null : value;
    },
  });
}

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
  /** The binding whose values the uniform objects point at. */
  let written: ProbeBinding | null = null;
  /** Per renderer, the probe count of the program it last resolved for this material. */
  let resolved = new WeakMap<WebGLRenderer, number>();
  /** The samplers the program being compiled declares (its texture units allowing). */
  let sampled = 0;
  /** Inside `clone()`/`toJSON()`, which see the author's envMap. */
  let plain = 0;
  let warnedChunk = false;
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
      authoredEnvMap ??
      (plain > 0 || probeCount() === 0 || current?.scene.environment ? null : sentinel),
    set: (value: Texture | null) => {
      authoredEnvMap = value;
    },
  });
  const prototype = Object.getPrototypeOf(material) as T;
  const plainly = <R>(run: () => R): R => {
    plain += 1;
    try {
      return run();
    } finally {
      plain -= 1;
    }
  };
  Object.defineProperty(material, 'clone', {
    configurable: true,
    writable: true,
    value: () => plainly(() => prototype.clone.call(material)),
  });
  Object.defineProperty(material, 'toJSON', {
    configurable: true,
    writable: true,
    value: (meta?: Parameters<T['toJSON']>[0]) => plainly(() => prototype.toJSON.call(material, meta)),
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
      values: createProbeValues(),
      nearest: Array.from({ length: MAX_PROBES }, () => undefined),
      nearestDistance: new Float64Array(MAX_PROBES),
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
   * texture units samples the first ones), chosen without allocating: again
   * whenever the registry reports, and as the camera moves.
   */
  const select = (binding: ProbeBinding, camera: Camera) => {
    // A capture window zeroes every probe: nothing to choose between.
    if (binding.capturing) return;
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    const moved = !cameraPosition.equals(binding.camera);
    if (!binding.dirty && !(moved && binding.probes.length > 1)) return;
    binding.camera.copy(cameraPosition);
    const { nearest, nearestDistance: distance } = binding;
    let count = 0;
    for (const probe of binding.probes) {
      const d = binding.probes.length === 1 ? 0 : distanceToProbe(probe, cameraPosition, scratch);
      if (count === limit && d >= distance[count - 1]!) continue;
      let slot = count < limit ? count++ : count - 1;
      for (; slot > 0 && distance[slot - 1]! > d; slot -= 1) {
        distance[slot] = distance[slot - 1]!;
        nearest[slot] = nearest[slot - 1];
      }
      distance[slot] = d;
      nearest[slot] = probe;
    }
    const selected = binding.selected;
    let same = count === selected.length;
    for (let index = 0; same && index < count; index += 1) same = nearest[index] === selected[index];
    if (!same) {
      selected.length = count;
      for (let index = 0; index < count; index += 1) selected[index] = nearest[index]!;
      binding.dirty = true;
    }
    nearest.fill(undefined);
  };

  // Before every draw, in whichever renderer: its probes are the ones the
  // uniform objects point at for this draw. Three uploads a material's
  // uniforms whenever its program or the material drawn changes, and at the
  // start of every render, so a value written here reaches this draw.
  const render: RenderHook = (renderer, scene, camera) => {
    const binding = bindingFor(renderer, scene);
    current = binding;
    select(binding, camera);
    // The program this renderer resolved last may be for another binding's
    // count (one compiled by `renderer.compile`, which draws nothing and so
    // never comes here first): have three resolve it again.
    const count = resolved.get(renderer);
    if (count !== undefined && count !== binding.selected.length) material.needsUpdate = true;
    if (binding.dirty) {
      fillProbeValues(binding.values, binding.selected, binding.capturing);
      binding.dirty = false;
      written = null;
    }
    if (written !== binding) {
      pointProbeUniforms(uniforms, binding.values);
      written = binding;
    }
    (uniforms['volterBaseEnvironment'] as { value: unknown }).value = (authoredEnvMap ?? scene.environment) ? 1 : 0;
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

  // Where a chain of hooks reaches the material's own: the probe splice, once
  // per program three compiles (a wrapper that calls it twice splices once).
  const spliced = new WeakSet<object>();
  const compile: CompileHook = (shader, renderer) => {
    if (spliced.has(shader)) return;
    spliced.add(shader);
    const count = probeCount();
    resolved.set(renderer, count);
    // No probes: three's own program, whose chunks a later hook may still take.
    if (count === 0) return;
    const missing = missingChunk(shader);
    if (missing !== null) {
      if (!warnedChunk) {
        warnedChunk = true;
        // biome-ignore lint/suspicious/noConsole: a hook took a chunk the probe splice needs; say why no probe lights this material.
        console.warn(
          `[reflections] volume reflection material "${material.name}" draws without its probes: an onBeforeCompile hook replaced ${missing}, which the probe lighting is spliced into.`,
        );
      }
      return;
    }
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
  // Three asks for the key each time it resolves a program: during a draw,
  // for the drawing renderer.
  const cacheKey = (): string => {
    if (current) resolved.set(current.renderer, probeCount());
    return volumeKey.call(material);
  };
  ownHook(material, 'onBeforeCompile', compile);
  ownHook(material, 'customProgramCacheKey', cacheKey);
  ownHook(material, 'onBeforeRender', render);

  const release = () => {
    for (const reference of made) {
      const binding = reference.deref();
      if (!binding) continue;
      binding.stop();
      binding.lease.release();
    }
    made = new Set();
    bindings = new WeakMap();
    resolved = new WeakMap();
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
