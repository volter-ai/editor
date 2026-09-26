/**
 * `Light3D.light_energy` — Godot's light brightness, as the one thing a script does to a light.
 *
 * Every light in this lane so far has been a `.tscn` node-class fact the emitter carries into the
 * scene it writes; `platformer-3d-godot4`'s `stage.gd:12` is the first RUNTIME write to one
 * (`new_light.light_energy = 0.25` on a light it duplicated), so this is the first light member
 * with a backend rather than an emission.
 *
 * ## The PI, which is the whole content of this file
 *
 * Both engines use the same `1/PI` Lambert term, but Godot hands its shader a light colour ALREADY
 * multiplied by PI (`light_color_energy`) — which is what makes `light_energy = 1` mean "albedo
 * renders at full value at normal incidence". three's `intensity` carries no such factor. So the
 * faithful mapping of Godot energy `E` is three intensity `E * PI`, and without it every lit
 * surface is PI times too dark whatever the colour pipeline does.
 *
 * That is not a fact discovered here: it is the mapping the SCENE EMITTER already applies to the
 * authored value (`gd-analyze/src/translate/scene-module-3d.ts`'s `emitLight`, which writes
 * `intensity={E * Math.PI}` and carries the measurement in its own doc comment). A runtime write
 * has to land on the same number the authored one did, or a script that assigns a light its own
 * authored energy would change the frame — so the conversion is stated in both places and is the
 * same conversion, deliberately.
 *
 * ## Structurally typed, because there is no light CLASS here
 *
 * Like `node.ts`'s `visible`/`text` pair, this takes anything with an `intensity` — which is every
 * `THREE.Light` — rather than naming a class. compat builds no lights, owns none and has no
 * factory for one; the emitted scene constructs the real `THREE.DirectionalLight` and these two
 * functions read and write the one property Godot's member maps onto.
 *
 * ## Resource ownership
 *
 * **Owns:** a bound SpotLight owns Three's lazily allocated shadow render target. **Shares:** the
 * light, which is the scene's. **Teardown:** `releaseGodotSpotLight3D` disposes that target.
 */

import { Object3D, PointLight, type Texture } from 'three';
import { registerGodotObjectIdentity } from './object';

/** The half of a `THREE.Light` this file touches. Every three light satisfies it. */
export interface LightLike {
  intensity: number;
}

export interface ColoredLightLike extends LightLike {
  color: { r: number; g: number; b: number; setRGB(r: number, g: number, b: number): unknown };
}

export interface CastingLightLike extends LightLike {
  castShadow: boolean;
}

export interface GodotLight3DLike extends ColoredLightLike, CastingLightLike, Object3D {
  shadow?: {
    bias: number;
    normalBias: number;
    radius: number;
    intensity: number;
    mapSize?: { set(width: number, height: number): unknown };
    camera?: { near: number; far: number; updateProjectionMatrix(): unknown };
    focus?: number;
    needsUpdate?: boolean;
    dispose?(): void;
  };
}

function isGodotLight3DLike(value: object): value is GodotLight3DLike {
  if (!(value instanceof Object3D)) return false;
  const color = Reflect.get(value, 'color');
  return (
    typeof Reflect.get(value, 'intensity') === 'number' &&
    typeof Reflect.get(value, 'castShadow') === 'boolean' &&
    typeof color === 'object' &&
    color !== null &&
    typeof Reflect.get(color, 'setRGB') === 'function'
  );
}

export interface GodotLight3DState {
  editorOnly: boolean;
  negative: boolean;
  cullMask: number;
  distanceFadeEnabled: boolean;
  distanceFadeBegin: number;
  distanceFadeShadow: number;
  distanceFadeLength: number;
  shadowReverseCullFace: boolean;
  shadowCasterMask: number;
  bakeMode: number;
  projector: Texture | null;
  temperature: number;
  indirectEnergy: number;
  volumetricFogEnergy: number;
  specular: number;
  originalIntensity: number;
}

export interface SpotLightLike extends ColoredLightLike, CastingLightLike, ShadowLightLike {
  distance: number;
  decay: number;
  angle: number;
  penumbra: number;
  shadow: ShadowLightLike['shadow'] & {
    bias: number;
    normalBias: number;
    radius: number;
    mapSize: { set(width: number, height: number): unknown };
    camera: { near: number; far: number; updateProjectionMatrix(): unknown };
    focus: number;
    needsUpdate: boolean;
    dispose(): void;
  };
}

export interface RangedLightLike extends ColoredLightLike, CastingLightLike {
  distance: number;
}

const OMNI_RANGE = new WeakMap<object, number>();
const DIRECTIONAL_LIGHT_MAJOR = new WeakMap<object, 3 | 4>();
const DIRECTIONAL_LIGHT_INTENSITY = new WeakMap<object, number>();
const LIGHT_3D_STATE = new WeakMap<object, GodotLight3DState>();

function finiteLight(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Light3D.${member} requires a finite number.`);
  }
  return value;
}

function nonnegativeLight(value: unknown, member: string): number {
  const result = finiteLight(value, member);
  if (result < 0) throw new RangeError(`Light3D.${member} cannot be negative.`);
  return result;
}

function unsignedMask(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`Light3D.${member} requires an unsigned 32-bit mask.`);
  }
  return value >>> 0;
}

function light3dState(light: GodotLight3DLike): GodotLight3DState {
  let state = LIGHT_3D_STATE.get(light);
  if (state !== undefined) return state;
  state = {
    editorOnly: false,
    negative: false,
    cullMask: light.layers.mask >>> 0,
    distanceFadeEnabled: false,
    distanceFadeBegin: 40,
    distanceFadeShadow: 50,
    distanceFadeLength: 10,
    shadowReverseCullFace: false,
    shadowCasterMask: 0xffff_ffff,
    bakeMode: 2,
    projector: null,
    temperature: 6500,
    indirectEnergy: 1,
    volumetricFogEnergy: 1,
    specular: 0.5,
    originalIntensity: light.intensity,
  };
  LIGHT_3D_STATE.set(light, state);
  return state;
}

export function bindGodotLight3DState(light: GodotLight3DLike): GodotLight3DLike {
  light3dState(light);
  return light;
}

export function setLightEditorOnly(light: GodotLight3DLike, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Light3D.editor_only requires bool.');
  light3dState(light).editorOnly = enabled;
}

export function isLightEditorOnly(light: GodotLight3DLike): boolean {
  return light3dState(light).editorOnly;
}

export function setLightNegative(light: GodotLight3DLike, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Light3D.light_negative requires bool.');
  const state = light3dState(light);
  if (state.negative === enabled) return;
  state.negative = enabled;
  light.intensity = Math.abs(light.intensity) * (enabled ? -1 : 1);
}

export function isLightNegative(light: GodotLight3DLike): boolean {
  return light3dState(light).negative;
}

export function setLightCullMask(light: GodotLight3DLike, mask: number): void {
  const value = unsignedMask(mask, 'light_cull_mask');
  light3dState(light).cullMask = value;
  light.layers.mask = value;
}

export function getLightCullMask(light: GodotLight3DLike): number {
  return light3dState(light).cullMask;
}

export function setLightDistanceFadeEnabled(light: GodotLight3DLike, enabled: boolean): void {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('Light3D.distance_fade_enabled requires bool.');
  }
  light3dState(light).distanceFadeEnabled = enabled;
}

export function isLightDistanceFadeEnabled(light: GodotLight3DLike): boolean {
  return light3dState(light).distanceFadeEnabled;
}

export function setLightDistanceFadeBegin(light: GodotLight3DLike, value: number): void {
  light3dState(light).distanceFadeBegin = nonnegativeLight(value, 'distance_fade_begin');
}

export function getLightDistanceFadeBegin(light: GodotLight3DLike): number {
  return light3dState(light).distanceFadeBegin;
}

export function setLightDistanceFadeShadow(light: GodotLight3DLike, value: number): void {
  light3dState(light).distanceFadeShadow = nonnegativeLight(value, 'distance_fade_shadow');
}

export function getLightDistanceFadeShadow(light: GodotLight3DLike): number {
  return light3dState(light).distanceFadeShadow;
}

export function setLightDistanceFadeLength(light: GodotLight3DLike, value: number): void {
  light3dState(light).distanceFadeLength = nonnegativeLight(value, 'distance_fade_length');
}

export function getLightDistanceFadeLength(light: GodotLight3DLike): number {
  return light3dState(light).distanceFadeLength;
}

/** Apply Godot's linear distance fade to the existing native light intensity and shadow gate. */
export function updateGodotLightDistanceFade(
  light: GodotLight3DLike,
  cameraWorldPosition: { readonly x: number; readonly y: number; readonly z: number },
): void {
  const state = light3dState(light);
  if (!state.distanceFadeEnabled) {
    light.intensity = state.originalIntensity * (state.negative ? -1 : 1);
    return;
  }
  const dx = light.position.x - cameraWorldPosition.x;
  const dy = light.position.y - cameraWorldPosition.y;
  const dz = light.position.z - cameraWorldPosition.z;
  const distance = Math.hypot(dx, dy, dz);
  const length = Math.max(state.distanceFadeLength, Number.EPSILON);
  const weight = 1 - Math.min(Math.max((distance - state.distanceFadeBegin) / length, 0), 1);
  light.intensity = state.originalIntensity * weight * (state.negative ? -1 : 1);
  if (light.shadow !== undefined) {
    light.castShadow = distance < state.distanceFadeShadow;
  }
}

export function setLightShadowReverseCullFace(light: GodotLight3DLike, enabled: boolean): void {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('Light3D.shadow_reverse_cull_face requires bool.');
  }
  light3dState(light).shadowReverseCullFace = enabled;
}

export function getLightShadowReverseCullFace(light: GodotLight3DLike): boolean {
  return light3dState(light).shadowReverseCullFace;
}

export function setLightShadowCasterMask(light: GodotLight3DLike, mask: number): void {
  light3dState(light).shadowCasterMask = unsignedMask(mask, 'shadow_caster_mask');
}

export function getLightShadowCasterMask(light: GodotLight3DLike): number {
  return light3dState(light).shadowCasterMask;
}

export function setLightBakeMode(light: GodotLight3DLike, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new RangeError('Light3D.light_bake_mode requires BAKE_DISABLED through BAKE_STATIC.');
  }
  light3dState(light).bakeMode = value;
}

export function getLightBakeMode(light: GodotLight3DLike): number {
  return light3dState(light).bakeMode;
}

export function setLightProjector(light: GodotLight3DLike, texture: Texture | null): void {
  if (texture !== null && !texture.isTexture) {
    throw new TypeError('Light3D.light_projector requires Texture2D or null.');
  }
  light3dState(light).projector = texture;
  if ('map' in light) (light as unknown as { map: Texture | null }).map = texture;
}

export function getLightProjector(light: GodotLight3DLike): Texture | null {
  return light3dState(light).projector;
}

/** Tanner Helland's black-body approximation, used only to feed Three's native linear color. */
export function godotCorrelatedColor(temperature: number): { r: number; g: number; b: number; a: 1 } {
  const kelvin = Math.min(Math.max(nonnegativeLight(temperature, 'light_temperature'), 1000), 40_000);
  const value = kelvin / 100;
  const red = value <= 66 ? 255 : 329.698727446 * ((value - 60) ** -0.1332047592);
  const green = value <= 66
    ? 99.4708025861 * Math.log(value) - 161.1195681661
    : 288.1221695283 * ((value - 60) ** -0.0755148492);
  const blue = value >= 66 ? 255 : value <= 19 ? 0 : 138.5177312231 * Math.log(value - 10) - 305.044792731;
  return {
    r: Math.min(Math.max(red, 0), 255) / 255,
    g: Math.min(Math.max(green, 0), 255) / 255,
    b: Math.min(Math.max(blue, 0), 255) / 255,
    a: 1,
  };
}

export function setLightTemperature(light: GodotLight3DLike, temperature: number): void {
  const state = light3dState(light);
  state.temperature = nonnegativeLight(temperature, 'light_temperature');
  const correlated = godotCorrelatedColor(state.temperature);
  light.color.setRGB(correlated.r, correlated.g, correlated.b);
}

export function getLightTemperature(light: GodotLight3DLike): number {
  return light3dState(light).temperature;
}

export function bindGodotOmniLight3D(light: RangedLightLike, range: number): RangedLightLike {
  registerGodotObjectIdentity(light, 'OmniLight3D');
  if (isGodotLight3DLike(light)) bindGodotLight3DState(light);
  setOmniLightRange(light, range);
  return light;
}

/** Runtime `OmniLight3D.new()` as the same native PointLight emitted for scene-owned nodes. */
export function createGodotOmniLight3D(): PointLight {
  const light = new PointLight(0xffffff, Math.PI, 5, 1);
  return bindGodotOmniLight3D(light, 5) as PointLight;
}

export function getOmniLightRange(light: RangedLightLike): number {
  return OMNI_RANGE.get(light) ?? light.distance;
}

export function setOmniLightRange(light: RangedLightLike, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      'OmniLight3D.omni_range requires a nonnegative finite value.',
    );
  }
  OMNI_RANGE.set(light, value);
  light.distance = Math.max(0.001, value);
}

interface SpotLightState {
  range: number;
  attenuation: number;
  angle: number;
  angleAttenuation: number;
  godotMajor: 3 | 4;
  shadowEnabled: boolean;
  shadowMapSize: number;
  shadowBias: number;
  shadowNormalBias: number;
  shadowBlur: number;
  shadowOpacity: number;
  shadowFilterQuality: number;
}

const SPOT_LIGHT_STATE = new WeakMap<object, SpotLightState>();

function finiteSpot(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`SpotLight.${member} requires a finite float.`);
  }
  return value;
}

/** Godot's own glTF bridge conversion from cone exponent to native inner-cone ratio. */
function spotPenumbra(attenuation: number): number {
  if (attenuation < 0) {
    throw new RangeError('Negative SpotLight.spot_angle_attenuation has no native Three cone representation.');
  }
  const innerRatio = Math.max(0, 1 - 0.2 / (0.1 + attenuation));
  return 1 - innerRatio;
}

export function bindGodotSpotLight3D(
  light: SpotLightLike,
  options: {
    readonly range: number;
    readonly attenuation: number;
    readonly angle: number;
    readonly angleAttenuation: number;
    readonly godotMajor: 3 | 4;
    readonly shadowEnabled?: boolean;
    readonly shadowMapSize?: number;
    readonly shadowBias?: number;
    readonly shadowNormalBias?: number;
    readonly shadowBlur?: number;
    readonly shadowOpacity?: number;
    readonly shadowFilterQuality?: number;
  },
): void {
  registerGodotObjectIdentity(light, options.godotMajor === 3 ? 'SpotLight' : 'SpotLight3D');
  if (isGodotLight3DLike(light)) bindGodotLight3DState(light);
  SPOT_LIGHT_STATE.set(light, {
    range: finiteSpot(options.range, 'spot_range'),
    attenuation: finiteSpot(options.attenuation, 'spot_attenuation'),
    angle: finiteSpot(options.angle, 'spot_angle'),
    angleAttenuation: finiteSpot(options.angleAttenuation, 'spot_angle_attenuation'),
    godotMajor: options.godotMajor,
    shadowEnabled: options.shadowEnabled ?? false,
    shadowMapSize: positiveShadowMapSize(options.shadowMapSize ?? 1024),
    shadowBias: finiteSpot(options.shadowBias ?? (options.godotMajor === 4 ? 0.03 : 0.1), 'shadow_bias'),
    shadowNormalBias: finiteSpot(options.shadowNormalBias ?? 1, 'shadow_normal_bias'),
    shadowBlur: nonnegativeLight(options.shadowBlur ?? 1, 'shadow_blur'),
    shadowOpacity: unitShadow(options.shadowOpacity ?? 1, 'shadow_opacity'),
    shadowFilterQuality: integerShadowQuality(options.shadowFilterQuality ?? 2),
  });
  setSpotLightRange(light, options.range);
  light.decay = options.attenuation;
  setSpotLightAngle(light, options.angle);
  setSpotLightAngleAttenuation(light, options.angleAttenuation);
  configureSpotShadow(light);
}

function positiveShadowMapSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('SpotLight shadow map size requires a positive whole number of texels.');
  }
  return value;
}

function unitShadow(value: unknown, member: string): number {
  const result = finiteSpot(value, member);
  if (result < 0 || result > 1) throw new RangeError(`SpotLight.${member} requires a value from 0 through 1.`);
  return result;
}

function integerShadowQuality(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) {
    throw new RangeError('Godot positional shadow filter quality must be an enum from 0 through 5.');
  }
  return value;
}

const POSITIONAL_FILTER_RADIUS = [1, 1.5, 2, 2, 3, 4] as const;

/**
 * Carry Godot 4's positional shadow projection onto Three's native SpotLightShadow. Godot frames
 * the shadow with `2 * spot_angle`, near `min(0.025, range)`, and far `range`; Three's
 * SpotLightShadow derives the same full FOV and far plane from `light.angle`/`light.distance`.
 */
function configureSpotShadow(light: SpotLightLike): void {
  const state = spotState(light);
  if (state.shadowEnabled && state.angle >= 90) {
    throw new RangeError('SpotLight shadows require spot_angle < 90 degrees; Godot cannot cast a perspective shadow at or beyond a 180-degree field of view.');
  }
  light.castShadow = state.shadowEnabled;
  light.shadow.focus = 1;
  light.shadow.mapSize.set(state.shadowMapSize, state.shadowMapSize);
  light.shadow.camera.near = Math.min(0.025, state.range);
  light.shadow.camera.far = state.range;
  light.shadow.camera.updateProjectionMatrix();
  // Godot's spot depth bias is divided by 100 before the receiver-side normalized-depth add.
  const filterRadius = POSITIONAL_FILTER_RADIUS[state.shadowFilterQuality]!;
  light.shadow.bias = state.shadowBias / 100 * state.shadowBlur * filterRadius;
  // Godot scales normal bias by ten shadow texels, receiver distance, and incidence. Three exposes
  // one world-space offset; this explicitly measured approximation matches the far-plane scale.
  light.shadow.normalBias = state.shadowNormalBias * state.range * 10 / state.shadowMapSize;
  light.shadow.radius = state.shadowBlur * filterRadius;
  light.shadow.intensity = state.shadowOpacity;
  light.shadow.needsUpdate = true;
}

export function releaseGodotSpotLight3D(light: SpotLightLike): void {
  light.shadow.dispose();
  SPOT_LIGHT_STATE.delete(light);
}

function spotState(light: SpotLightLike): SpotLightState {
  const state = SPOT_LIGHT_STATE.get(light);
  if (state === undefined) throw new Error('SpotLight runtime member used before native light binding.');
  return state;
}

export function setSpotLightRange(light: SpotLightLike, value: number): void {
  const range = finiteSpot(value, 'spot_range');
  if (range <= 0) {
    throw new RangeError(
      'SpotLight.spot_range <= 0 has no exact native Three representation: Godot extinguishes the ranged light, while Three distance=0 means no cutoff.',
    );
  }
  spotState(light).range = range;
  light.distance = range;
  configureSpotShadow(light);
}

export function getSpotLightRange(light: SpotLightLike): number { return spotState(light).range; }

export function setSpotLightAttenuation(light: SpotLightLike, value: number): void {
  const attenuation = finiteSpot(value, 'spot_attenuation');
  const state = spotState(light);
  if (state.godotMajor === 3) {
    throw new Error(
      'SpotLight.spot_attenuation runtime writes are unsupported for Godot 3: its default GLES3 falloff is pow(max(1 - distance / range, 0), attenuation), which Three cannot represent.',
    );
  }
  state.attenuation = attenuation;
  light.decay = attenuation;
}

export function getSpotLightAttenuation(light: SpotLightLike): number {
  return spotState(light).attenuation;
}

export function setSpotLightAngle(light: SpotLightLike, value: number): void {
  const angle = finiteSpot(value, 'spot_angle');
  spotState(light).angle = angle;
  light.angle = angle * Math.PI / 180;
  configureSpotShadow(light);
}

export function getSpotLightAngle(light: SpotLightLike): number { return spotState(light).angle; }

function setSpotLightAngleAttenuation(light: SpotLightLike, value: number): void {
  const attenuation = finiteSpot(value, 'spot_angle_attenuation');
  spotState(light).angleAttenuation = attenuation;
  light.penumbra = spotPenumbra(attenuation);
}

/** Godot's `light_energy` E as three's `intensity` — see this module's header for the PI. */
const GODOT_ENERGY_TO_THREE_INTENSITY = Math.PI;

/** `light.light_energy = e` — `platformer-3d-godot4` `stage.gd:12`. */
export function setLightEnergy(light: LightLike, energy: number): void {
  const intensity = energy * GODOT_ENERGY_TO_THREE_INTENSITY;
  const retained = LIGHT_3D_STATE.get(light);
  if (retained !== undefined) retained.originalIntensity = intensity;
  if (DIRECTIONAL_LIGHT_MAJOR.has(light)) {
    DIRECTIONAL_LIGHT_INTENSITY.set(light, intensity);
    light.intensity = getSkyMode(light) === SKY_MODE_SKY_ONLY ? 0 : intensity;
    return;
  }
  light.intensity = intensity;
}

/** `light.light_energy` — the same conversion read back, so a write followed by a read is the
 *  value Godot would report rather than three's. */
export function getLightEnergy(light: LightLike): number {
  return (DIRECTIONAL_LIGHT_INTENSITY.get(light) ?? light.intensity) /
    GODOT_ENERGY_TO_THREE_INTENSITY;
}

export function getLightColor(light: ColoredLightLike): { r: number; g: number; b: number; a: number } {
  return { r: light.color.r, g: light.color.g, b: light.color.b, a: 1 };
}

export function setLightColor(
  light: ColoredLightLike,
  color: { readonly r: number; readonly g: number; readonly b: number; readonly a?: number },
): void {
  if (![color.r, color.g, color.b, color.a ?? 1].every(Number.isFinite)) {
    throw new TypeError('Light3D.light_color requires a finite Color.');
  }
  light.color.setRGB(color.r, color.g, color.b);
}

/** Godot 3/4 `Light.set_color` / `Light3D.set_color`. */
export function setLightColorMethod(light: ColoredLightLike, color: Parameters<typeof setLightColor>[1]): void {
  setLightColor(light, color);
}

/**
 * The Light parameter indices with direct native Three consumers. Unsupported renderer-only
 * parameters refuse instead of entering a retained shadow store.
 */
export function setLightParam(light: LightLike, godotMajor: 3 | 4, param: number, value: number): void {
  if ((godotMajor !== 3 && godotMajor !== 4) || !Number.isInteger(param) || !Number.isFinite(value)) {
    throw new TypeError('Light3D.set_param requires an integer LightParam and finite float value.');
  }
  // Pinned 3.6.2 and 4.7 dumps both declare ENERGY=0 and RANGE=4. Keep the
  // dialect tables explicit so a future enum insertion cannot silently retarget the call.
  const indices = godotMajor === 3
    ? { energy: 0, range: 4 } as const
    : { energy: 0, range: 4 } as const;
  if (param === indices.energy) {
    setLightEnergy(light, value);
    return;
  }
  if (param === indices.range && 'distance' in light) {
    if (SPOT_LIGHT_STATE.has(light)) setSpotLightRange(light as SpotLightLike, value);
    else setOmniLightRange(light as RangedLightLike, value);
    return;
  }
  if (godotMajor === 4 && LIGHT_3D_STATE.has(light)) {
    const native = light as GodotLight3DLike;
    const state = light3dState(native);
    if (param === 1) { state.indirectEnergy = nonnegativeLight(value, 'light_indirect_energy'); return; }
    if (param === 2) { state.volumetricFogEnergy = nonnegativeLight(value, 'light_volumetric_fog_energy'); return; }
    if (param === 3) { state.specular = nonnegativeLight(value, 'light_specular'); return; }
    if (param === 14 && native.shadow !== undefined) {
      if (SPOT_LIGHT_STATE.has(light)) {
        const spot = light as SpotLightLike;
        spotState(spot).shadowNormalBias = nonnegativeLight(value, 'shadow_normal_bias');
        configureSpotShadow(spot);
      } else native.shadow.normalBias = value;
      return;
    }
    if (param === 15 && native.shadow !== undefined) {
      if (SPOT_LIGHT_STATE.has(light)) {
        const spot = light as SpotLightLike;
        spotState(spot).shadowBias = finiteSpot(value, 'shadow_bias');
        configureSpotShadow(spot);
      } else native.shadow.bias = value;
      return;
    }
    if (param === 17 && hasLightShadow(native)) { setShadowOpacity(native, value); return; }
    if (param === 18 && native.shadow !== undefined) {
      if (SPOT_LIGHT_STATE.has(light)) {
        const spot = light as SpotLightLike;
        spotState(spot).shadowBlur = nonnegativeLight(value, 'shadow_blur');
        configureSpotShadow(spot);
      } else native.shadow.radius = nonnegativeLight(value, 'shadow_blur');
      return;
    }
  }
  throw new Error(
    `Light3D.set_param(${param}) has no exact native Three consumer in this renderer; only PARAM_ENERGY (0) and ranged-light PARAM_RANGE (4) are supported.`,
  );
}

export function getLightParam(light: LightLike, godotMajor: 3 | 4, param: number): number {
  if ((godotMajor !== 3 && godotMajor !== 4) || !Number.isInteger(param)) {
    throw new TypeError('Light3D.get_param requires an integer LightParam.');
  }
  if (param === 0) return getLightEnergy(light);
  if (param === 4 && 'distance' in light) {
    return SPOT_LIGHT_STATE.has(light)
      ? getSpotLightRange(light as SpotLightLike)
      : getOmniLightRange(light as RangedLightLike);
  }
  if (godotMajor === 4 && LIGHT_3D_STATE.has(light)) {
    const native = light as GodotLight3DLike;
    const state = light3dState(native);
    if (param === 1) return state.indirectEnergy;
    if (param === 2) return state.volumetricFogEnergy;
    if (param === 3) return state.specular;
    if (param === 14 && native.shadow !== undefined) return SPOT_LIGHT_STATE.has(light)
      ? spotState(light as SpotLightLike).shadowNormalBias
      : native.shadow.normalBias;
    if (param === 15 && native.shadow !== undefined) return SPOT_LIGHT_STATE.has(light)
      ? spotState(light as SpotLightLike).shadowBias
      : native.shadow.bias;
    if (param === 17 && native.shadow !== undefined) return SPOT_LIGHT_STATE.has(light)
      ? spotState(light as SpotLightLike).shadowOpacity
      : native.shadow.intensity;
    if (param === 18 && native.shadow !== undefined) return SPOT_LIGHT_STATE.has(light)
      ? spotState(light as SpotLightLike).shadowBlur
      : native.shadow.radius;
  }
  throw new Error(
    `Light3D.get_param(${param}) has no exact native Three consumer in this renderer.`,
  );
}

export function isLightShadowEnabled(light: CastingLightLike): boolean {
  return light.castShadow;
}

export function setLightShadowEnabled(light: CastingLightLike, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Light3D.shadow_enabled requires bool.');
  if (SPOT_LIGHT_STATE.has(light)) {
    spotState(light as SpotLightLike).shadowEnabled = enabled;
    configureSpotShadow(light as SpotLightLike);
    return;
  }
  light.castShadow = enabled;
}

/** Godot's method spelling over the same native castShadow field as shadow_enabled. */
export function setLightShadow(light: CastingLightLike, enabled: boolean): void {
  setLightShadowEnabled(light, enabled);
}

/**
 * The half of a shadow-casting `THREE.Light` {@link setShadowOpacity} touches. Every three light
 * that casts shadows carries a `LightShadow`, and `intensity` has been on it since r165 (this repo
 * is on 0.180) — so this is the same structural typing {@link LightLike} uses, one level in.
 */
export interface ShadowLightLike {
  shadow: { intensity: number };
}

function hasLightShadow(light: GodotLight3DLike): light is GodotLight3DLike & ShadowLightLike {
  return light.shadow !== undefined;
}

/**
 * `light.shadow_opacity = o` — `starter-kit-3d-platformer` `main.gd:10`, which dims the sun's
 * shadows to 0.85 under Godot's compatibility renderer.
 *
 * A DIRECT correspondence and not a conversion: Godot's `Light3D.shadow_opacity` is documented as
 * "the opacity to use when rendering the light's shadow map. Values lower than 1.0 make the light
 * appear through shadows", `[0, 1]`, default 1; three's `LightShadow.intensity` is "the intensity
 * of the shadow, 0 = no shadow, 1 = full", same range, same default. Both are a lerp of the
 * shadowed sample toward the unshadowed one by the same parameter, so the number transfers
 * unchanged — unlike `light_energy` above, which needs the PI.
 */
export function setShadowOpacity(light: ShadowLightLike, opacity: number): void {
  if (SPOT_LIGHT_STATE.has(light)) {
    const spot = light as SpotLightLike;
    spotState(spot).shadowOpacity = unitShadow(opacity, 'shadow_opacity');
    configureSpotShadow(spot);
    return;
  }
  light.shadow.intensity = opacity;
}

/**
 * Godot 4 `DirectionalLight3D.SkyMode` — the pinned 4.7 dump's SkyMode enum.
 * `stage.gd:10`/`:13` writes these inside the `gl_compatibility` compensation.
 *
 * Three's DirectionalLight is the geometry pass. SKY_ONLY gates its native intensity while the
 * retained PhysicalSkyMaterial owner independently reads the same light's direction; LIGHT_ONLY
 * leaves geometry enabled and excludes it from that sky read. The authored intensity remains in
 * a retained slot while geometry is gated, so mode transitions and light_energy writes round-trip.
 */
export const SKY_MODE_LIGHT_AND_SKY = 0;
export const SKY_MODE_LIGHT_ONLY = 1;
export const SKY_MODE_SKY_ONLY = 2;

const SKY_MODE = new WeakMap<object, number>();

/** Bind one emitted native Three DirectionalLight to its exact Godot dialect and sky mode. */
export function bindGodotDirectionalLight3D(
  light: object,
  major: 3 | 4,
  skyMode = SKY_MODE_LIGHT_AND_SKY,
): void {
  registerGodotObjectIdentity(light, major === 3 ? 'DirectionalLight' : 'DirectionalLight3D');
  if ('layers' in light) bindGodotLight3DState(light as GodotLight3DLike);
  if (!DIRECTIONAL_LIGHT_INTENSITY.has(light)) {
    DIRECTIONAL_LIGHT_INTENSITY.set(light, (light as LightLike).intensity);
  }
  DIRECTIONAL_LIGHT_MAJOR.set(light, major);
  setSkyMode(light, skyMode);
}

/** True only for a retained Godot 4 DirectionalLight3D that contributes to the sky pass. */
export function godotDirectionalLightContributesToPhysicalSky(light: object): boolean {
  if (DIRECTIONAL_LIGHT_MAJOR.get(light) !== 4) return false;
  const mode = getSkyMode(light);
  return mode === SKY_MODE_LIGHT_AND_SKY || mode === SKY_MODE_SKY_ONLY;
}

/** `light.sky_mode` — dump SkyMode, default LIGHT_AND_SKY (0). */
export function getSkyMode(light: object): number {
  return SKY_MODE.get(light) ?? SKY_MODE_LIGHT_AND_SKY;
}

/** `light.sky_mode = mode`. */
export function setSkyMode(light: object, mode: number): void {
  if (!Number.isInteger(mode) || mode < SKY_MODE_LIGHT_AND_SKY || mode > SKY_MODE_SKY_ONLY) {
    throw new RangeError('DirectionalLight3D.sky_mode requires SKY_MODE_LIGHT_AND_SKY through SKY_MODE_SKY_ONLY.');
  }
  SKY_MODE.set(light, mode);
  const intensity = DIRECTIONAL_LIGHT_INTENSITY.get(light);
  if (intensity !== undefined) {
    (light as LightLike).intensity = mode === SKY_MODE_SKY_ONLY ? 0 : intensity;
  }
}

/**
 * `RenderingServer.SHADOW_QUALITY_SOFT_HIGH` — dump ShadowQuality value 4.
 * `stage.gd:7` passes it to `directional_soft_shadow_filter_set_quality`.
 */
export const SHADOW_QUALITY_SOFT_HIGH = 4;

/** Last requested directional soft-shadow quality. three's filter is the
 *  renderer's `shadowMap.type` (PCFSoft), not this Godot-server enum; the
 *  setter records the request so a write is not a silent no-op identifier. */
let directionalSoftShadowQuality = SHADOW_QUALITY_SOFT_HIGH;

/** `RenderingServer.directional_soft_shadow_filter_set_quality(q)`. */
export function setDirectionalSoftShadowFilterQuality(quality: number): void {
  directionalSoftShadowQuality = quality;
}

/** The value {@link setDirectionalSoftShadowFilterQuality} last stored. */
export function getDirectionalSoftShadowFilterQuality(): number {
  return directionalSoftShadowQuality;
}

/** `light.shadow_opacity` — see {@link setShadowOpacity}. */
export function getShadowOpacity(light: ShadowLightLike): number {
  return light.shadow.intensity;
}
