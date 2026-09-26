/**
 * Godot environment IBL and ReflectionProbe rendering over Three's own cube targets, PMREM, and
 * standard materials.
 *
 * This is deliberately a project-owned render helper, not an engine renderer abstraction. Godot
 * associates probes with overlapping geometry, then its GLES3 shader performs the decisive work
 * per fragment: box membership, rounded edge weight, optional box-ray correction, and a weighted
 * average when volumes overlap. That per-fragment step matters for a single InstancedMesh spanning
 * several probes. Assigning one envMap per Object3D would
 * be a plausible-looking but different renderer.
 *
 * The captured radiance is filtered by Three's native PMREM path, so the already-recorded
 * cross-renderer differences remain. Probe data carries its engine generation because Godot 3.6
 * and 4.7 use distinct overlap and ambient models. The Godot 4 path follows the pinned renderer's
 * `reflection_process`: size-descending probes, axis blend distance, uncovered-alpha accumulation,
 * reflection-layer filtering, and Disabled/Environment/Color ambient modes. The world-level
 * diffuse/specular split follows the same pinned renderer through {@link GodotEnvironmentIblData}.
 *
 * What is GODOT here is that list. What is not — overriding Three's IBL functions on a
 * `MeshStandardMaterial`, and scoping a capture's cull mask and shadow suppression to one render —
 * is general three.js plumbing every local-probe system needs, so it lives in the engine
 * (`@vgai/engine/render/ibl-override-material`, `@vgai/engine/render/environment-capture`) and this
 * file BINDS to it. The native `reflections` capability binds to the same two modules with a
 * different per-fragment model; do not read its weighting math into this one.
 */
import {
  canCaptureEnvironment,
  withCaptureMask,
  withCaptureSceneEnvironment,
  withCaptureShadows,
} from '@volter/threejs-runtime/render/environment-capture';
import {
  baseIblFunctions,
  createIblSentinelTexture,
  IBL_WORLD_POSITION,
  type IblOverride,
  type IblOverrideShader,
  overrideMaterialIbl,
  standardMaterialsOf,
} from '@volter/threejs-runtime/render/ibl-override-material';
import {
  Color,
  CubeCamera,
  HalfFloatType,
  LinearMipmapLinearFilter,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  PMREMGenerator,
  Quaternion,
  type Scene,
  SRGBColorSpace,
  type Texture,
  Vector3,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';

export const GODOT_REFLECTION_PROBE_DATA = 'godotReflectionProbe' as const;

interface GodotReflectionProbeCommonData {
  readonly intensity: number;
  readonly maxDistance: number;
  readonly extents: readonly [number, number, number];
  readonly originOffset: readonly [number, number, number];
  readonly boxProjection: boolean;
  readonly cullMask: number;
  readonly interior: boolean;
  readonly updateMode: 'once' | 'always';
  readonly enableShadows: boolean;
}

export interface Godot3ReflectionProbeData extends GodotReflectionProbeCommonData {
  readonly version: 3;
  readonly interiorAmbient: readonly [number, number, number];
  readonly interiorAmbientEnergy: number;
  readonly interiorAmbientContribution: number;
}

export interface Godot4ReflectionProbeData extends GodotReflectionProbeCommonData {
  readonly version: 4;
  readonly blendDistance: number;
  readonly reflectionMask: number;
  readonly ambientMode: 'disabled' | 'environment' | 'color';
  readonly ambientColor: readonly [number, number, number];
  readonly ambientEnergy: number;
}

export type GodotReflectionProbeData = Godot3ReflectionProbeData | Godot4ReflectionProbeData;

type MutableProbe<T> = { -readonly [K in keyof T]: T[K] };
type MutableProbeData = MutableProbe<Godot3ReflectionProbeData> | MutableProbe<Godot4ReflectionProbeData>;

function probeDataOf(node: Object3D): MutableProbeData {
  const data = node.userData[GODOT_REFLECTION_PROBE_DATA] as MutableProbeData | undefined;
  if (data === undefined) {
    throw new Error('ReflectionProbe3D receiver has no retained native capture state.');
  }
  return data;
}

function finiteProbeNumber(member: string, value: number): number {
  if (!Number.isFinite(value)) throw new TypeError(`ReflectionProbe3D.${member} requires a finite number.`);
  return value;
}

/** Live script accessors mutate the same userData record consumed by the native cube-capture pass. */
export function getReflectionProbeIntensity(node: Object3D): number {
  return probeDataOf(node).intensity;
}
export function setReflectionProbeIntensity(node: Object3D, value: number): void {
  probeDataOf(node).intensity = finiteProbeNumber('intensity', value);
}
export function getReflectionProbeMaxDistance(node: Object3D): number {
  return probeDataOf(node).maxDistance;
}
export function setReflectionProbeMaxDistance(node: Object3D, value: number): void {
  probeDataOf(node).maxDistance = Math.max(0, finiteProbeNumber('max_distance', value));
}
export function isReflectionProbeBoxProjection(node: Object3D): boolean {
  return probeDataOf(node).boxProjection;
}
export function setReflectionProbeBoxProjection(node: Object3D, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('ReflectionProbe3D.box_projection requires bool.');
  probeDataOf(node).boxProjection = value;
}
export function getReflectionProbeCullMask(node: Object3D): number {
  return probeDataOf(node).cullMask;
}
export function setReflectionProbeCullMask(node: Object3D, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new TypeError('ReflectionProbe3D.cull_mask requires a non-negative integer.');
  probeDataOf(node).cullMask = value;
}
export function isReflectionProbeInterior(node: Object3D): boolean {
  return probeDataOf(node).interior;
}
export function setReflectionProbeInterior(node: Object3D, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('ReflectionProbe3D.interior requires bool.');
  probeDataOf(node).interior = value;
}
export function isReflectionProbeShadowsEnabled(node: Object3D): boolean {
  return probeDataOf(node).enableShadows;
}
export function setReflectionProbeShadowsEnabled(node: Object3D, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('ReflectionProbe3D.enable_shadows requires bool.');
  probeDataOf(node).enableShadows = value;
}

function probeVector(value: unknown, member: string): [number, number, number] {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) {
    throw new TypeError(`ReflectionProbe3D.${member} requires Vector3.`);
  }
  const result = [Number(value.x), Number(value.y), Number(value.z)] as [number, number, number];
  if (!result.every(Number.isFinite)) throw new TypeError(`ReflectionProbe3D.${member} requires finite Vector3 components.`);
  return result;
}

export function getReflectionProbeSize(node: Object3D): { x: number; y: number; z: number } {
  const [x, y, z] = probeDataOf(node).extents;
  return { x: x * 2, y: y * 2, z: z * 2 };
}

export function setReflectionProbeSize(node: Object3D, value: unknown): void {
  const [x, y, z] = probeVector(value, 'size');
  if (x <= 0 || y <= 0 || z <= 0) throw new RangeError('ReflectionProbe3D.size requires positive components.');
  probeDataOf(node).extents = [x / 2, y / 2, z / 2];
}

export function getReflectionProbeOriginOffset(node: Object3D): { x: number; y: number; z: number } {
  const [x, y, z] = probeDataOf(node).originOffset;
  return { x, y, z };
}

export function setReflectionProbeOriginOffset(node: Object3D, value: unknown): void {
  probeDataOf(node).originOffset = probeVector(value, 'origin_offset');
}

export function getReflectionProbeUpdateMode(node: Object3D): number {
  return probeDataOf(node).updateMode === 'always' ? 1 : 0;
}

export function setReflectionProbeUpdateMode(node: Object3D, value: unknown): void {
  if (value !== 0 && value !== 1) throw new RangeError('ReflectionProbe3D.update_mode requires 0 or 1.');
  probeDataOf(node).updateMode = value === 1 ? 'always' : 'once';
}

function godot4Probe(node: Object3D, member: string): MutableProbe<Godot4ReflectionProbeData> {
  const data = probeDataOf(node);
  if (data.version !== 4) throw new Error(`ReflectionProbe3D.${member} is a Godot 4 property.`);
  return data;
}

export function getReflectionProbeBlendDistance(node: Object3D): number { return godot4Probe(node, 'blend_distance').blendDistance; }
export function setReflectionProbeBlendDistance(node: Object3D, value: number): void { godot4Probe(node, 'blend_distance').blendDistance = Math.max(0, finiteProbeNumber('blend_distance', value)); }
export function getReflectionProbeReflectionMask(node: Object3D): number { return godot4Probe(node, 'reflection_mask').reflectionMask; }
export function setReflectionProbeReflectionMask(node: Object3D, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError('ReflectionProbe3D.reflection_mask requires a 32-bit mask.');
  godot4Probe(node, 'reflection_mask').reflectionMask = value;
}

export function getReflectionProbeAmbientMode(node: Object3D): number {
  const mode = godot4Probe(node, 'ambient_mode').ambientMode;
  return mode === 'disabled' ? 0 : mode === 'environment' ? 1 : 2;
}

export function setReflectionProbeAmbientMode(node: Object3D, value: unknown): void {
  if (value !== 0 && value !== 1 && value !== 2) throw new RangeError('ReflectionProbe3D.ambient_mode requires [0, 2].');
  godot4Probe(node, 'ambient_mode').ambientMode = value === 0 ? 'disabled' : value === 1 ? 'environment' : 'color';
}

export function getReflectionProbeAmbientColor(node: Object3D): { r: number; g: number; b: number; a: number } {
  const [r, g, b] = godot4Probe(node, 'ambient_color').ambientColor;
  return { r, g, b, a: 1 };
}

export function setReflectionProbeAmbientColor(node: Object3D, value: unknown): void {
  if (typeof value !== 'object' || value === null || !('r' in value) || !('g' in value) || !('b' in value)) throw new TypeError('ReflectionProbe3D.ambient_color requires Color.');
  const color = [Number(value.r), Number(value.g), Number(value.b)] as [number, number, number];
  if (!color.every(Number.isFinite)) throw new TypeError('ReflectionProbe3D.ambient_color requires finite components.');
  godot4Probe(node, 'ambient_color').ambientColor = color;
}

export function getReflectionProbeAmbientEnergy(node: Object3D): number { return godot4Probe(node, 'ambient_color_energy').ambientEnergy; }
export function setReflectionProbeAmbientEnergy(node: Object3D, value: number): void { godot4Probe(node, 'ambient_color_energy').ambientEnergy = Math.max(0, finiteProbeNumber('ambient_color_energy', value)); }

export interface GodotReflectionProbeSystem {
  /** Discover new scene objects, refresh uniforms, and capture at most one probe this frame. */
  update(): void;
  dispose(): void;
}

/**
 * Godot 4.7 keeps the diffuse and specular halves of its sky IBL independent.
 *
 * Authority: `render_scene_data_rd.cpp` sets `USE_AMBIENT_CUBEMAP` from
 * `ambient_light_source` and `USE_REFLECTION_CUBEMAP` from
 * `reflected_light_source` in separate branches. Three exposes one environment
 * texture to both entry points, so this binding carries the two source-derived
 * multipliers into the shared IBL splice rather than collapsing either one.
 */
export interface GodotEnvironmentIblData {
  readonly diffuse: number;
  readonly specular: number;
  /** Flat world ambient, routed here only when Godot 4 probes must replace it by covered alpha. */
  readonly ambient?: {
    readonly color: string;
    readonly energy: number;
  };
}

type FilteredTarget = ReturnType<PMREMGenerator['fromCubemap']>;

interface ProbeRuntime {
  readonly node: Object3D;
  readonly data: GodotReflectionProbeData;
  readonly target: WebGLCubeRenderTarget;
  readonly camera: CubeCamera;
  readonly worldToLocal: Matrix4;
  readonly extents: Vector3;
  readonly originOffset: Vector3;
  readonly ambient: Vector3;
  readonly capturedTransform: Matrix4;
  filtered: FilteredTarget | null;
  ready: boolean;
}

interface MaterialPatch {
  readonly material: MeshStandardMaterial;
  readonly previousEnvMap: MeshStandardMaterial['envMap'];
  readonly previousBeforeRender: MeshStandardMaterial['onBeforeRender'];
  forcedEnvMap: Texture | null;
  /** Reinstalled — never mutated in place — whenever the probe COUNT changes. */
  override: IblOverride;
}

function isProbeData(value: unknown): value is GodotReflectionProbeData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Partial<GodotReflectionProbeData>;
  const common =
    (data.version === 3 || data.version === 4) &&
    typeof data.intensity === 'number' &&
    typeof data.maxDistance === 'number' &&
    Array.isArray(data.extents) &&
    data.extents.length === 3 &&
    Array.isArray(data.originOffset) &&
    data.originOffset.length === 3 &&
    typeof data.boxProjection === 'boolean' &&
    typeof data.cullMask === 'number' &&
    typeof data.interior === 'boolean' &&
    (data.updateMode === 'once' || data.updateMode === 'always') &&
    typeof data.enableShadows === 'boolean';
  if (!common) return false;
  if (data.version === 3) {
    const godot3 = data as Partial<Godot3ReflectionProbeData>;
    return (
      Array.isArray(godot3.interiorAmbient) &&
      godot3.interiorAmbient.length === 3 &&
      typeof godot3.interiorAmbientEnergy === 'number' &&
      typeof godot3.interiorAmbientContribution === 'number'
    );
  }
  const godot4 = data as Partial<Godot4ReflectionProbeData>;
  return (
    typeof godot4.blendDistance === 'number' &&
    typeof godot4.reflectionMask === 'number' &&
    (godot4.ambientMode === 'disabled' ||
      godot4.ambientMode === 'environment' ||
      godot4.ambientMode === 'color') &&
    Array.isArray(godot4.ambientColor) &&
    godot4.ambientColor.length === 3 &&
    typeof godot4.ambientEnergy === 'number'
  );
}

function probeSampler(index: number): string {
  return `textureCubeUV(godotProbeMap${index}, probeDirection, roughness).rgb`;
}

function godot3ProbeSpecularBlock(index: number): string {
  return `
  if (godotProbeReady[${index}] > 0.5) {
    vec3 probeLocalPosition = (godotProbeWorldToLocal[${index}] * vec4(${IBL_WORLD_POSITION}, 1.0)).xyz;
    vec3 probeExtents = godotProbeExtents[${index}];
    if (all(lessThanEqual(abs(probeLocalPosition), probeExtents))) {
      vec3 innerPosition = abs(probeLocalPosition / probeExtents);
      float probeBlend = max(innerPosition.x, max(innerPosition.y, innerPosition.z));
      probeBlend = mix(length(innerPosition), probeBlend, probeBlend);
      probeBlend = max(0.0, 1.0 - probeBlend * probeBlend);
      vec3 probeDirection = (godotProbeWorldToLocal[${index}] * vec4(worldReflect, 0.0)).xyz;
      if (godotProbeBoxProjection[${index}] > 0.5) {
        vec3 normalizedDirection = normalize(probeDirection);
        vec3 rayMax = (probeExtents - probeLocalPosition) / normalizedDirection;
        vec3 rayMin = (-probeExtents - probeLocalPosition) / normalizedDirection;
        vec3 rayDistance = mix(rayMin, rayMax, greaterThan(normalizedDirection, vec3(0.0)));
        float nearestFace = min(min(rayDistance.x, rayDistance.y), rayDistance.z);
        vec3 positionOnBox = probeLocalPosition + normalizedDirection * nearestFace;
        probeDirection = positionOnBox - godotProbeOriginOffset[${index}];
      }
      vec3 probeRadiance = ${probeSampler(index)};
      if (godotProbeInterior[${index}] < 0.5) {
        probeRadiance = mix(baseRadiance, probeRadiance, probeBlend);
      }
      probeRadianceAccum += probeRadiance * godotProbeIntensity[${index}] * probeBlend;
      probeWeight += probeBlend;
    }
  }`;
}

function godot3ProbeAmbientBlock(index: number): string {
  return `
  if (godotProbeReady[${index}] > 0.5) {
    vec3 probeLocalPosition = (godotProbeWorldToLocal[${index}] * vec4(${IBL_WORLD_POSITION}, 1.0)).xyz;
    vec3 probeExtents = godotProbeExtents[${index}];
    if (all(lessThanEqual(abs(probeLocalPosition), probeExtents))) {
      vec3 innerPosition = abs(probeLocalPosition / probeExtents);
      float probeBlend = max(innerPosition.x, max(innerPosition.y, innerPosition.z));
      probeBlend = mix(length(innerPosition), probeBlend, probeBlend);
      probeBlend = max(0.0, 1.0 - probeBlend * probeBlend);
      vec3 probeAmbient = godotProbeAmbient[${index}];
      if (godotProbeAmbientContribution[${index}] > 0.0) {
        vec3 probeDirection = normalize((godotProbeWorldToLocal[${index}] * vec4(worldNormal, 0.0)).xyz);
        vec3 capturedAmbient = textureCubeUV(godotProbeMap${index}, probeDirection, 1.0).rgb;
        probeAmbient = mix(probeAmbient, capturedAmbient, godotProbeAmbientContribution[${index}]);
      }
      if (godotProbeInterior[${index}] < 0.5) {
        probeAmbient = mix(baseAmbient, probeAmbient, probeBlend);
      }
      probeAmbientAccum += probeAmbient * probeBlend;
      probeWeight += probeBlend;
    }
  }`;
}

/**
 * Pinned Godot 4.7 Forward+ `reflection_process`, expressed against Three's cube-UV PMREM sampler.
 * The only renderer substitution is the sampler representation; the volume and accumulation math
 * stays source-identical. Larger probes run first because `update_reflection_probe_buffer` sorts by
 * negative half-extents length before the shader sees them.
 */
function godot4ProbeBlend(index: number): string {
  return `
    vec3 probeLocalPosition = (godotProbeWorldToLocal[${index}] * vec4(${IBL_WORLD_POSITION}, 1.0)).xyz;
    vec3 probeExtents = godotProbeExtents[${index}];
    if (all(lessThanEqual(abs(probeLocalPosition), probeExtents))) {
      float probeBlend = 1.0;
      if (godotProbeBlendDistance[${index}] != 0.0) {
        vec3 axisBlendDistance = min(vec3(godotProbeBlendDistance[${index}]), probeExtents);
        vec3 blendAxes = (abs(probeLocalPosition) - probeExtents + axisBlendDistance) / axisBlendDistance;
        blendAxes = clamp(vec3(1.0) - blendAxes, vec3(0.0), vec3(1.0));
        probeBlend = pow(blendAxes.x * blendAxes.y * blendAxes.z, 2.0);
      }`;
}

function godot4ProbeSpecularBlock(index: number): string {
  return `
  if (godotProbeReady[${index}] > 0.5 &&
      (godotProbeReflectionMask[${index}] & godotObjectLayerMask) != uint(0)) {${godot4ProbeBlend(index)}
      if (godotProbeIntensity[${index}] > 0.0 && probeWeight < 1.0) {
        vec3 probeDirection = (godotProbeWorldToLocal[${index}] * vec4(worldReflect, 0.0)).xyz;
        if (godotProbeBoxProjection[${index}] > 0.5) {
          vec3 normalizedDirection = normalize(probeDirection);
          vec3 rayMax = (probeExtents - probeLocalPosition) / normalizedDirection;
          vec3 rayMin = (-probeExtents - probeLocalPosition) / normalizedDirection;
          vec3 rayDistance = mix(rayMin, rayMax, greaterThan(normalizedDirection, vec3(0.0)));
          float nearestFace = min(min(rayDistance.x, rayDistance.y), rayDistance.z);
          vec3 positionOnBox = probeLocalPosition + normalizedDirection * nearestFace;
          probeDirection = positionOnBox - godotProbeOriginOffset[${index}];
        }
        float probeContribution = max(0.0, probeBlend - probeWeight);
        probeRadianceAccum += ${probeSampler(index)} * godotProbeIntensity[${index}] * probeContribution;
        probeWeight += probeContribution;
      }
    }
  }`;
}

function godot4ProbeAmbientBlock(index: number): string {
  return `
  if (godotProbeReady[${index}] > 0.5 &&
      (godotProbeReflectionMask[${index}] & godotObjectLayerMask) != uint(0)) {${godot4ProbeBlend(index)}
      if (probeWeight < 1.0 && godotProbeAmbientMode[${index}] != 0) {
        float probeContribution = max(0.0, probeBlend - probeWeight);
        vec3 probeAmbient = godotProbeAmbient[${index}];
        if (godotProbeAmbientMode[${index}] == 1) {
          vec3 probeDirection = normalize((godotProbeWorldToLocal[${index}] * vec4(worldNormal, 0.0)).xyz);
          probeAmbient = textureCubeUV(godotProbeMap${index}, probeDirection, 1.0).rgb;
        }
        probeAmbientAccum += probeAmbient * probeContribution;
        probeWeight += probeContribution;
      }
    }
  }`;
}

function reflectionShader(probes: readonly ProbeRuntime[]): string {
  const probeCount = probes.length;
  const godot4 = probes.some((probe) => probe.data.version === 4);
  const base = baseIblFunctions();
  const probeUniforms =
    probeCount === 0
      ? ''
      : `uniform float godotProbeReady[${probeCount}];
uniform mat4 godotProbeWorldToLocal[${probeCount}];
uniform vec3 godotProbeExtents[${probeCount}];
uniform vec3 godotProbeOriginOffset[${probeCount}];
uniform float godotProbeBoxProjection[${probeCount}];
uniform float godotProbeIntensity[${probeCount}];
uniform float godotProbeInterior[${probeCount}];
uniform vec3 godotProbeAmbient[${probeCount}];
uniform float godotProbeAmbientContribution[${probeCount}];
uniform float godotProbeBlendDistance[${probeCount}];
uniform int godotProbeAmbientMode[${probeCount}];
uniform uint godotProbeReflectionMask[${probeCount}];
uniform uint godotObjectLayerMask;`;
  const samplers = Array.from(
    { length: probeCount },
    (_, index) => `uniform sampler2D godotProbeMap${index};`,
  ).join('\n');
  const specular = probes
    .map((probe, index) =>
      probe.data.version === 4 ? godot4ProbeSpecularBlock(index) : godot3ProbeSpecularBlock(index),
    )
    .join('\n');
  const ambient = probes
    .map((probe, index) =>
      probe.data.version === 4 ? godot4ProbeAmbientBlock(index) : godot3ProbeAmbientBlock(index),
    )
    .join('\n');
  return `${base}
#ifdef USE_ENVMAP
${probeUniforms}
${samplers}

uniform float godotEnvironmentDiffuse;
uniform float godotEnvironmentSpecular;
uniform vec3 godotEnvironmentAmbient;

vec3 getIBLIrradiance(const in vec3 normal) {
  vec3 baseIrradiance = getBaseIBLIrradiance(normal) * godotEnvironmentDiffuse;
  vec3 baseAmbient = baseIrradiance * RECIPROCAL_PI + godotEnvironmentAmbient;
  vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
  vec3 probeAmbientAccum = vec3(0.0);
  float probeWeight = 0.0;
${ambient}
  ${godot4 ? 'return PI * (probeAmbientAccum + baseAmbient * (1.0 - probeWeight));' : 'return probeWeight > 0.0 ? PI * probeAmbientAccum / probeWeight : baseIrradiance;'}
}

vec3 getIBLRadiance(const in vec3 viewDir, const in vec3 normal, const in float roughness) {
  vec3 baseRadiance = getBaseIBLRadiance(viewDir, normal, roughness) * godotEnvironmentSpecular;
  vec3 reflectDirection = reflect(-viewDir, normal);
  reflectDirection = normalize(mix(reflectDirection, normal, roughness * roughness));
  vec3 worldReflect = inverseTransformDirection(reflectDirection, viewMatrix);
  vec3 probeRadianceAccum = vec3(0.0);
  float probeWeight = 0.0;
${specular}
  ${godot4 ? 'return probeRadianceAccum + baseRadiance * (1.0 - probeWeight);' : 'return probeWeight > 0.0 ? probeRadianceAccum / probeWeight : baseRadiance;'}
}
#endif`;
}

/**
 * Every uniform Godot's probe blocks read. Seeded at COMPILE time, because that is the only moment
 * the shader object exists; `godotProbeReady` starts at 0 so a material that compiles mid-capture
 * does not sample a target the capture is still writing.
 */
function seedProbeUniforms(
  shader: IblOverrideShader,
  probes: readonly ProbeRuntime[],
  environment: GodotEnvironmentIblData,
): void {
  shader.uniforms['godotEnvironmentDiffuse'] = { value: environment.diffuse };
  shader.uniforms['godotEnvironmentSpecular'] = { value: environment.specular };
  const ambient = new Color(environment.ambient?.color ?? '#000000');
  shader.uniforms['godotEnvironmentAmbient'] = {
    value: new Vector3(ambient.r, ambient.g, ambient.b).multiplyScalar(
      environment.ambient?.energy ?? 0,
    ),
  };
  shader.uniforms['godotProbeReady'] = { value: probes.map(() => 0) };
  shader.uniforms['godotProbeWorldToLocal'] = {
    value: probes.map((probe) => probe.worldToLocal),
  };
  shader.uniforms['godotProbeExtents'] = { value: probes.map((probe) => probe.extents) };
  shader.uniforms['godotProbeOriginOffset'] = {
    value: probes.map((probe) => probe.originOffset),
  };
  shader.uniforms['godotProbeBoxProjection'] = {
    value: probes.map((probe) => Number(probe.data.boxProjection)),
  };
  shader.uniforms['godotProbeIntensity'] = {
    value: probes.map((probe) => probe.data.intensity),
  };
  shader.uniforms['godotProbeInterior'] = {
    value: probes.map((probe) => Number(probe.data.interior)),
  };
  shader.uniforms['godotProbeAmbient'] = { value: probes.map((probe) => probe.ambient) };
  shader.uniforms['godotProbeAmbientContribution'] = {
    value: probes.map((probe) =>
      probe.data.version === 3 ? probe.data.interiorAmbientContribution : 0,
    ),
  };
  shader.uniforms['godotProbeBlendDistance'] = {
    value: probes.map((probe) => (probe.data.version === 4 ? probe.data.blendDistance : 0)),
  };
  shader.uniforms['godotProbeAmbientMode'] = {
    value: probes.map((probe) =>
      probe.data.version === 4
        ? { disabled: 0, environment: 1, color: 2 }[probe.data.ambientMode]
        : 0,
    ),
  };
  shader.uniforms['godotProbeReflectionMask'] = {
    value: probes.map((probe) =>
      probe.data.version === 4 ? probe.data.reflectionMask >>> 0 : 0xffffffff,
    ),
  };
  shader.uniforms['godotObjectLayerMask'] = { value: 1 };
  probes.forEach((probe, index) => {
    shader.uniforms[`godotProbeMap${index}`] = { value: probe.filtered?.texture ?? null };
  });
}

function installShaderPatch(
  material: MeshStandardMaterial,
  probes: readonly ProbeRuntime[],
  environment: GodotEnvironmentIblData,
): IblOverride {
  return overrideMaterialIbl(material, {
    fragment: () => reflectionShader(probes),
    cacheKey: () =>
      `godot-reflection-probes:${probes.map((probe) => probe.data.version).join(',')}:environment:${environment.diffuse}:${environment.specular}:${environment.ambient?.color ?? 'none'}:${environment.ambient?.energy ?? 0}`,
    onCompile: (shader) => seedProbeUniforms(shader, probes, environment),
  });
}

function updatePatchUniforms(patch: MaterialPatch, probes: readonly ProbeRuntime[]): void {
  const shader = patch.override.shader;
  if (shader === null) return;
  shader.uniforms['godotProbeReady']!.value = probes.map((probe) => Number(probe.ready));
  probes.forEach((probe, index) => {
    shader.uniforms[`godotProbeMap${index}`]!.value = probe.filtered?.texture ?? null;
  });
}

/**
 * `interior_ambient_color` as the LINEAR radiance the shader adds, which is not the number the
 * `.tscn` spells.
 *
 * A Godot `Color(…)` in a scene file is an AUTHORED sRGB colour — what the editor's colour picker
 * showed — and Godot 3's GLES3 renderer calls `.to_linear()` on it before it reaches any shader.
 * Measured on the 3.6.stable binary rather than read off its source: an interior `ReflectionProbe`
 * with `interior_ambient_color = Color(0.5, 0.5, 0.5)` over a white Lambert quad with no lights
 * renders back byte **127**, which is the same byte an UNSHADED `Color(0.5, 0.5, 0.5)` quad
 * renders. That equality only holds if the shader used `to_linear(0.5) = 0.214` and the frame was
 * then sRGB-encoded on output; had it used the raw 0.5 as radiance, the readback would have been
 * 188.
 *
 * Feeding the raw float in as linear radiance is therefore over-bright, and over-bright by a
 * DIFFERENT factor per channel — 2.98x at 0.40, 2.07x at 0.55, 1.17x at 0.88 — so it also washes
 * the hue out toward white. That was the measured cause of a ported level rendering pale and
 * neutral where the source engine renders it dim and blue.
 */
function linearAmbient(data: GodotReflectionProbeData): Vector3 {
  const [r, g, b] = data.version === 4 ? data.ambientColor : data.interiorAmbient;
  // `Color.setRGB(…, SRGBColorSpace)` converts INTO Three's working (linear) space, the same
  // decode Three performs on a material's own sRGB colour.
  const color = new Color().setRGB(r, g, b, SRGBColorSpace);
  return new Vector3(color.r, color.g, color.b).multiplyScalar(
    data.version === 4 ? data.ambientEnergy : data.interiorAmbientEnergy,
  );
}

function makeProbe(node: Object3D, data: GodotReflectionProbeData): ProbeRuntime {
  const target = new WebGLCubeRenderTarget(512, {
    type: HalfFloatType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    depthBuffer: true,
  });
  return {
    node,
    data,
    target,
    camera: new CubeCamera(0.01, 1, target),
    worldToLocal: new Matrix4(),
    extents: new Vector3(...data.extents),
    originOffset: new Vector3(...data.originOffset),
    ambient: linearAmbient(data),
    capturedTransform: new Matrix4().makeScale(0, 0, 0),
    filtered: null,
    ready: false,
  };
}

/**
 * Release a target only while the renderer still owns its WebGL allocation.
 *
 * R3F tears component effects down synchronously, but the editor can also close the renderer-owning
 * viewport in the same React commit. Three's `WebGLRenderer.dispose()` clears `renderer.properties`;
 * a later `WebGLCubeRenderTarget.dispose()` still reaches the renderer's retained dispose listener,
 * whose deallocator assumes those properties exist and throws. An unregistered target has no GPU
 * allocation to release, so ownership is both the safety check and the exact resource question.
 */
function disposeOwnedTarget(
  renderer: WebGLRenderer,
  target: WebGLCubeRenderTarget | FilteredTarget | null,
): boolean {
  if (target === null || !renderer.properties.has(target)) return false;
  target.dispose();
  return true;
}

function updateProbeTransform(probe: ProbeRuntime): boolean {
  probe.node.updateWorldMatrix(true, false);
  probe.worldToLocal.copy(probe.node.matrixWorld).invert();
  return probe.capturedTransform.equals(probe.node.matrixWorld);
}

function configureCaptureCamera(probe: ProbeRuntime, renderer: WebGLRenderer): void {
  const worldPosition = new Vector3();
  const worldRotation = new Quaternion();
  const worldScale = new Vector3();
  probe.node.matrixWorld.decompose(worldPosition, worldRotation, worldScale);
  const capturePosition = probe.originOffset.clone().applyMatrix4(probe.node.matrixWorld);
  probe.camera.position.copy(capturePosition);
  probe.camera.quaternion.copy(worldRotation);
  probe.camera.updateMatrixWorld(true);
  if (probe.camera.coordinateSystem !== renderer.coordinateSystem) {
    probe.camera.coordinateSystem = renderer.coordinateSystem;
    probe.camera.updateCoordinateSystem();
  }

  const [x, y, z] = probe.data.extents;
  const [ox, oy, oz] = probe.data.originOffset;
  const faceDistances = [
    new Vector3(x, oy, oz),
    new Vector3(-x, oy, oz),
    new Vector3(ox, y, oz),
    new Vector3(ox, -y, oz),
    new Vector3(ox, oy, z),
    new Vector3(ox, oy, -z),
  ].map((face) => face.applyMatrix4(probe.node.matrixWorld).distanceTo(capturePosition));
  probe.camera.children.forEach((child, index) => {
    const camera = child as CubeCamera['children'][number] & {
      far: number;
      updateProjectionMatrix(): void;
    };
    camera.far = Math.max(probe.data.maxDistance, faceDistances[index] ?? 0, 0.02);
    camera.updateProjectionMatrix();
  });
}

/** Build the renderer helper for one mounted Three scene. The caller owns the frame and disposal. */
export function createGodotReflectionProbeSystem(
  renderer: WebGLRenderer,
  scene: Scene,
  environment: GodotEnvironmentIblData = { diffuse: 1, specular: 1 },
): GodotReflectionProbeSystem {
  const probes: ProbeRuntime[] = [];
  const probeByNode = new WeakMap<Object3D, ProbeRuntime>();
  const patches = new Map<MeshStandardMaterial, MaterialPatch>();
  // Three's constructor compiles immediately. Keep it out of React render so the editor's inert
  // design-time renderer can mount the authored tree; the first PLAY frame owns the real capture.
  let pmrem: PMREMGenerator | null = null;
  let captureCursor = 0;
  let disposed = false;
  const iblSentinel = createIblSentinelTexture();
  const needsEnvironmentOverride = environment.diffuse !== 1 || environment.specular !== 1;

  const scanScene = (): {
    probes: Map<Object3D, GodotReflectionProbeData>;
    materials: Set<MeshStandardMaterial>;
  } => {
    const currentProbes = new Map<Object3D, GodotReflectionProbeData>();
    const currentMaterials = new Set<MeshStandardMaterial>();
    scene.traverse((object) => {
      const data = object.userData[GODOT_REFLECTION_PROBE_DATA];
      if (isProbeData(data)) currentProbes.set(object, data);
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      for (const material of standardMaterialsOf(mesh)) currentMaterials.add(material);
    });
    return { probes: currentProbes, materials: currentMaterials };
  };

  const removeStaleProbes = (
    currentProbes: ReadonlyMap<Object3D, GodotReflectionProbeData>,
  ): boolean => {
    let changed = false;
    let releasedRendererResource = false;
    for (let index = probes.length - 1; index >= 0; index -= 1) {
      const probe = probes[index] as ProbeRuntime;
      if (currentProbes.get(probe.node) === probe.data) continue;
      releasedRendererResource =
        disposeOwnedTarget(renderer, probe.filtered) || releasedRendererResource;
      releasedRendererResource =
        disposeOwnedTarget(renderer, probe.target) || releasedRendererResource;
      probeByNode.delete(probe.node);
      probes.splice(index, 1);
      changed = true;
    }
    if (probes.length === 0 && pmrem !== null) {
      if (releasedRendererResource) pmrem.dispose();
      pmrem = null;
    }
    return changed;
  };

  const addNewProbes = (
    currentProbes: ReadonlyMap<Object3D, GodotReflectionProbeData>,
  ): boolean => {
    let changed = false;
    for (const [object, data] of currentProbes) {
      if (probeByNode.has(object)) continue;
      const existingVersion = probes[0]?.data.version;
      if (existingVersion !== undefined && existingVersion !== data.version) {
        throw new Error(
          `One Godot scene cannot mix ReflectionProbe renderer generations ${existingVersion} and ${data.version}.`,
        );
      }
      const probe = makeProbe(object, data);
      probes.push(probe);
      probeByNode.set(object, probe);
      changed = true;
    }
    if (changed && probes[0]?.data.version === 4) {
      // Pinned `LightStorage::update_reflection_probe_buffer` sorts the render list by NEGATIVE
      // half-extents length, so large volumes claim their alpha before smaller overlapping ones.
      probes.sort((left, right) => right.extents.lengthSq() - left.extents.lengthSq());
    }
    return changed;
  };

  const restoreMaterialPatch = (patch: MaterialPatch): void => {
    patch.override.restore();
    patch.material.onBeforeRender = patch.previousBeforeRender;
    if (patch.forcedEnvMap !== null && patch.material.envMap === patch.forcedEnvMap) {
      patch.material.envMap = patch.previousEnvMap;
      patch.material.needsUpdate = true;
    }
  };

  const removeStalePatches = (currentMaterials: ReadonlySet<MeshStandardMaterial>): void => {
    for (const [material, patch] of patches) {
      if (currentMaterials.has(material)) continue;
      restoreMaterialPatch(patch);
      patches.delete(material);
    }
  };

  const refreshPatchProbeCount = (): void => {
    for (const patch of patches.values()) {
      patch.override.restore();
      if (probes.length > 0 || needsEnvironmentOverride) {
        patch.override = installShaderPatch(patch.material, probes, environment);
      }
    }
    if (probes.length === 0 && !needsEnvironmentOverride) patches.clear();
    captureCursor %= Math.max(1, probes.length);
  };

  const addNewPatches = (currentMaterials: ReadonlySet<MeshStandardMaterial>): void => {
    if (probes.length === 0 && !needsEnvironmentOverride) return;
    for (const material of currentMaterials) {
      if (patches.has(material)) continue;
      const previousEnvMap = material.envMap;
      const previousBeforeRender = material.onBeforeRender;
      const patch: MaterialPatch = {
        material,
        previousEnvMap,
        previousBeforeRender,
        forcedEnvMap: null,
        override: installShaderPatch(material, probes, environment),
      };
      // Godot filters each probe's `reflection_mask` against the currently drawn instance layer.
      // A material may be shared by objects on different layers, so this is a per-DRAW uniform,
      // not material discovery state. Three's own Material callback supplies that object identity.
      material.onBeforeRender = (...args): void => {
        previousBeforeRender.apply(material, args);
        const shader = patch.override.shader;
        if (shader === null) return;
        const object = args[4];
        shader.uniforms['godotObjectLayerMask']!.value = object.layers.mask >>> 0;
      };
      patches.set(material, patch);
    }
  };

  const ensureIblPrograms = (): void => {
    for (const patch of patches.values()) {
      if (
        patch.forcedEnvMap !== null &&
        (scene.environment !== null || patch.material.envMap !== patch.forcedEnvMap)
      ) {
        if (patch.material.envMap === patch.forcedEnvMap) {
          patch.material.envMap = patch.previousEnvMap;
        }
        patch.forcedEnvMap = null;
        patch.material.needsUpdate = true;
      }
      if (scene.environment === null && patch.material.envMap === null) {
        patch.material.envMap = iblSentinel;
        patch.forcedEnvMap = iblSentinel;
        patch.material.needsUpdate = true;
      }
    }
  };

  const reconcileScene = (): void => {
    const current = scanScene();
    const removedProbe = removeStaleProbes(current.probes);
    const addedProbe = addNewProbes(current.probes);
    removeStalePatches(current.materials);
    if (removedProbe || addedProbe) {
      refreshPatchProbeCount();
    }
    addNewPatches(current.materials);
  };

  const captureProbe = (probe: ProbeRuntime): void => {
    configureCaptureCamera(probe, renderer);
    const priorReady = probes.map((one) => one.ready);
    for (const one of probes) one.ready = false;
    for (const patch of patches.values()) updatePatchUniforms(patch, probes);
    // `enable_shadows` (Godot default FALSE) and `cull_mask` both mean "for THIS capture only", and
    // both land on three's own primitives: per-light `LightShadow.intensity`, and
    // `Object3D.layers.mask` — the same 32-bit primitive as `VisualInstance.layers`, so the
    // translation writes the authored mask straight onto the object and this reads it back. Both
    // engines default an unannotated object to `1`, which no default `cull_mask` excludes.
    // `withCaptureShadows` documents why the renderer-wide shadow switch is never the mechanism.
    withCaptureShadows(scene, probe.data.enableShadows, () => {
      withCaptureSceneEnvironment(scene, !probe.data.interior, () => {
        withCaptureMask(scene, probe.data.cullMask, () => probe.camera.update(renderer, scene));
      });
    });
    probes.forEach((one, index) => {
      one.ready = priorReady[index] ?? false;
    });
    probe.filtered?.dispose();
    pmrem ??= new PMREMGenerator(renderer);
    probe.filtered = pmrem.fromCubemap(probe.target.texture);
    probe.ready = true;
    probe.capturedTransform.copy(probe.node.matrixWorld);
  };

  const refreshProbeTransforms = (): void => {
    for (const probe of probes) {
      if (!updateProbeTransform(probe) && probe.data.updateMode === 'once') probe.ready = false;
    }
  };

  const nextProbeToCapture = (): ProbeRuntime | undefined => {
    for (let offset = 0; offset < probes.length; offset += 1) {
      const index = (captureCursor + offset) % probes.length;
      const probe = probes[index] as ProbeRuntime;
      if (probe.ready && probe.data.updateMode === 'once') continue;
      captureCursor = (index + 1) % probes.length;
      return probe;
    }
    return undefined;
  };

  return {
    update(): void {
      // The editor's still design tree and S4's headless runtime deliberately supply no GPU. They
      // must keep the authored scene and gameplay; only the renderer-owned capture is unavailable.
      if (disposed || !canCaptureEnvironment(renderer)) return;
      reconcileScene();
      ensureIblPrograms();
      refreshProbeTransforms();
      for (const patch of patches.values()) updatePatchUniforms(patch, probes);
      const probe = nextProbeToCapture();
      if (probe !== undefined) captureProbe(probe);
      for (const patch of patches.values()) updatePatchUniforms(patch, probes);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const patch of patches.values()) {
        restoreMaterialPatch(patch);
      }
      patches.clear();
      const rendererOwnsResources = probes.some(
        (probe) =>
          renderer.properties.has(probe.target) ||
          (probe.filtered !== null && renderer.properties.has(probe.filtered)),
      );
      for (const probe of probes) {
        disposeOwnedTarget(renderer, probe.filtered);
        disposeOwnedTarget(renderer, probe.target);
      }
      probes.length = 0;
      if (rendererOwnsResources) pmrem?.dispose();
      pmrem = null;
      iblSentinel.dispose();
    },
  };
}
