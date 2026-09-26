import { Color, CubeTexture, Scene, SRGBColorSpace, type Euler, type Mesh, type Texture } from 'three';
import { registerGodotObjectIdentity } from './object';
import { type GodotSky } from './physical-sky-material';
import type { ColorValue } from './variant';
import { vec3, type Vector3 } from './variant-3d';
import { GodotPanoramaSky } from './panorama-sky-material';
import { godotResourceChangedSignal } from './resource-io';

/**
 * `WorldEnvironment.environment` and Environment properties backed by the THREE.Scene and its
 * retained postprocess owner.
 *
 * ## Where Godot's Environment lives in three, and why this is not a shim
 *
 * Godot models the world's background, ambient light, fog, tonemap and post stack as a RESOURCE
 * (`Environment`) held by a node (`WorldEnvironment`), and a script reaches the settings through
 * the node: `$Environment.environment.background_energy_multiplier = 0.25`
 * (`starter-kit-3d-platformer` `main.gd:11`). three has the same settings and puts them somewhere
 * else — they are properties of the `Scene` itself (`background`, `backgroundIntensity`,
 * `environment`, `fog`) plus the renderer's tonemapping. There is no third object in between.
 *
 * So `world_environment.environment` evaluates to THE SCENE here, and that is the honest
 * correspondence rather than a fabricated wrapper: the resource Godot hands back is precisely the
 * bag of world settings, and in three that bag IS the scene object. {@link getEnvironment} is
 * therefore an identity with a type, and the members hang off the same object a caller could have
 * reached anyway — nothing is invented, nothing is cached, and a second Environment resource
 * assigned to a second WorldEnvironment would be a second three Scene, which is what Godot's own
 * "only one WorldEnvironment per viewport" rule already says.
 *
 * ## What is NOT claimed
 *
 * Unsupported Environment families remain absent. The glow accessors below exist because the
 * translated scene mounts Godot's source-derived gaussian/composite pass; they mutate that native
 * live consumer and refuse when no such consumer exists. The AUTHORED half of an environment —
 * the `.tres` a `.tscn` points at — remains the scene emitter's.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing. **Shares:** the scene, which is the port's. **Teardown:** none.
 */

/**
 * The half of a `THREE.Scene` this file touches — Godot's `Environment` resource, as the object
 * three keeps those settings on. Structural for the reason `light-3d.ts`'s `LightLike` is: compat
 * builds no scene and owns none.
 */
export interface GodotEnvironment {
  backgroundIntensity: number;
  background: Color | Texture | null;
  backgroundRotation: Euler;
  environmentRotation: Euler;
  environment?: Texture | null;
  environmentIntensity?: number;
}

interface EnvironmentState {
  mode: number;
  color: ColorValue;
  ambientLightSource: number;
  reflectedLightSource: number;
  sky: Texture | null;
  skyResource: GodotSky | null;
  skyConnection: { disconnect(): void } | null;
  skyMaterialConnection: { disconnect(): void } | null;
  readonly skyDomes: Map<GodotEnvironment, Mesh>;
  toneMapper: number;
  fogLightColor: ColorValue;
  backgroundSky: GodotPanoramaSky | null;
  releaseBackgroundSky: (() => void) | null;
}

export const GODOT_ENVIRONMENT_BACKGROUND_MODE = {
  CLEAR_COLOR: 0,
  COLOR: 1,
  SKY: 2,
  CANVAS: 3,
  KEEP: 4,
  CAMERA_FEED: 5,
  MAX: 6,
  BG_CLEAR_COLOR: 0,
  BG_COLOR: 1,
  BG_SKY: 2,
  BG_CANVAS: 3,
  BG_KEEP: 4,
  BG_CAMERA_FEED: 5,
  BG_MAX: 6,
} as const;
export const GODOT_ENVIRONMENT_AMBIENT_SOURCE = {
  BACKGROUND: 0,
  DISABLED: 1,
  COLOR: 2,
  SKY: 3,
  AMBIENT_SOURCE_BG: 0,
  AMBIENT_SOURCE_DISABLED: 1,
  AMBIENT_SOURCE_COLOR: 2,
  AMBIENT_SOURCE_SKY: 3,
} as const;
export const GODOT_ENVIRONMENT_REFLECTION_SOURCE = {
  BACKGROUND: 0,
  DISABLED: 1,
  SKY: 2,
  REFLECTION_SOURCE_BG: 0,
  REFLECTION_SOURCE_DISABLED: 1,
  REFLECTION_SOURCE_SKY: 2,
} as const;
export const GODOT_ENVIRONMENT_TONE_MAPPER = {
  LINEAR: 0,
  REINHARDT: 1,
  FILMIC: 2,
  ACES: 3,
  AGX: 4,
  TONE_MAPPER_LINEAR: 0,
  TONE_MAPPER_REINHARDT: 1,
  TONE_MAPPER_FILMIC: 2,
  TONE_MAPPER_ACES: 3,
  TONE_MAPPER_AGX: 4,
} as const;
export const GODOT_ENVIRONMENT_GLOW_BLEND_MODE = {
  ADDITIVE: 0,
  SCREEN: 1,
  SOFTLIGHT: 2,
  REPLACE: 3,
  MIX: 4,
  GLOW_BLEND_MODE_ADDITIVE: 0,
  GLOW_BLEND_MODE_SCREEN: 1,
  GLOW_BLEND_MODE_SOFTLIGHT: 2,
  GLOW_BLEND_MODE_REPLACE: 3,
  GLOW_BLEND_MODE_MIX: 4,
} as const;
export const GODOT_ENVIRONMENT_FOG_MODE = {
  EXPONENTIAL: 0,
  DEPTH: 1,
  FOG_MODE_EXPONENTIAL: 0,
  FOG_MODE_DEPTH: 1,
} as const;
export const GODOT_ENVIRONMENT_SDFGI_Y_SCALE = {
  PERCENT_50: 0,
  PERCENT_75: 1,
  PERCENT_100: 2,
  SDFGI_Y_SCALE_50_PERCENT: 0,
  SDFGI_Y_SCALE_75_PERCENT: 1,
  SDFGI_Y_SCALE_100_PERCENT: 2,
} as const;

/** Live renderer owner for Environment glow. The Scene remains the Resource identity; this is the
 * native postprocess pass currently consuming that resource, not a parallel settings mirror. */
export interface GodotEnvironmentGlowRuntime {
  isGlowEnabled(): boolean;
  setGlowEnabled(enabled: boolean): void;
  getGlowBloom(): number;
  setGlowBloom(value: number): void;
  getGlowIntensity(): number;
  setGlowIntensity(value: number): void;
  getGlowStrength(): number;
  setGlowStrength(value: number): void;
  getGlowHdrThreshold(): number;
  setGlowHdrThreshold(value: number): void;
  getGlowHdrScale(): number;
  setGlowHdrScale(value: number): void;
  getGlowHdrLuminanceCap(): number;
  setGlowHdrLuminanceCap(value: number): void;
  getGlowBlendMode(): number;
  setGlowBlendMode(mode: number): void;
  isGlowNormalized(): boolean;
  setGlowNormalized(enabled: boolean): void;
  getGlowMix(): number;
  setGlowMix(value: number): void;
  isGlowBicubicUpscaleEnabled(): boolean;
  setGlowBicubicUpscaleEnabled(enabled: boolean): void;
  isGlowHighQualityEnabled(): boolean;
  setGlowHighQualityEnabled(enabled: boolean): void;
  getGlowLevel(index: number): number;
  setGlowLevel(index: number, weight: number): void;
}

export interface GodotEnvironmentDepthOfFieldRuntime {
  getGodot3Config(): Readonly<{
    readonly farEnabled: boolean;
    readonly farDistance: number;
    readonly farTransition: number;
    readonly farAmount: number;
    readonly farQuality: 0 | 1 | 2;
    readonly nearEnabled: boolean;
    readonly nearDistance: number;
    readonly nearTransition: number;
    readonly nearAmount: number;
    readonly nearQuality: 0 | 1 | 2;
  }>;
  setGodot3Config(patch: Partial<{
    farEnabled: boolean;
    farDistance: number;
    farTransition: number;
    farAmount: number;
    farQuality: 0 | 1 | 2;
    nearEnabled: boolean;
    nearDistance: number;
    nearTransition: number;
    nearAmount: number;
    nearQuality: 0 | 1 | 2;
  }>): void;
}

export interface GodotEnvironmentFogRuntime {
  isFogEnabled(): boolean;
  setFogEnabled(enabled: boolean): void;
  getFogMode(): number;
  setFogMode(value: number): void;
  getFogLightColor(): ColorValue;
  setFogLightColor(value: ColorValue): void;
  getFogLightEnergy(): number;
  setFogLightEnergy(value: number): void;
  getFogSunScatter(): number;
  setFogSunScatter(value: number): void;
  getFogDensity(): number;
  setFogDensity(value: number): void;
  getFogHeight(): number;
  setFogHeight(value: number): void;
  getFogHeightDensity(): number;
  setFogHeightDensity(value: number): void;
  getFogAerialPerspective(): number;
  setFogAerialPerspective(value: number): void;
  getFogSkyAffect(): number;
  setFogSkyAffect(value: number): void;
  getFogDepthCurve(): number;
  setFogDepthCurve(value: number): void;
  getFogDepthBegin(): number;
  setFogDepthBegin(value: number): void;
  getFogDepthEnd(): number;
  setFogDepthEnd(value: number): void;
}

export interface GodotEnvironmentAdjustmentRuntime {
  isAdjustmentEnabled(): boolean;
  setAdjustmentEnabled(value: boolean): void;
  getAdjustmentBrightness(): number;
  setAdjustmentBrightness(value: number): void;
  getAdjustmentContrast(): number;
  setAdjustmentContrast(value: number): void;
  getAdjustmentSaturation(): number;
  setAdjustmentSaturation(value: number): void;
}

export interface GodotEnvironmentSsaoRuntime {
  isSsaoEnabled(): boolean;
  setSsaoEnabled(enabled: boolean): void;
  getSsaoRadius(): number;
  setSsaoRadius(radius: number): void;
  getSsaoIntensity(): number;
  setSsaoIntensity(intensity: number): void;
  getSsaoQuality(): number;
  setSsaoQuality(quality: number): void;
}

const environmentSsaoRuntimes = new WeakMap<object, GodotEnvironmentSsaoRuntime>();

export function bindEnvironmentSsaoRuntime(
  environment: GodotEnvironment,
  runtime: GodotEnvironmentSsaoRuntime,
): () => void {
  const key = environment as object;
  if (environmentSsaoRuntimes.has(key)) {
    throw new Error('Environment already has a retained native ambient-occlusion pass.');
  }
  environmentSsaoRuntimes.set(key, runtime);
  return () => {
    if (environmentSsaoRuntimes.get(key) === runtime) environmentSsaoRuntimes.delete(key);
  };
}

function ssaoRuntime(environment: GodotEnvironment): GodotEnvironmentSsaoRuntime {
  const runtime = environmentSsaoRuntimes.get(environment as object);
  if (runtime === undefined) {
    throw new Error('Environment SSAO requires an authored retained native ambient-occlusion pass.');
  }
  return runtime;
}

export function isEnvironmentSsaoEnabled(environment: GodotEnvironment): boolean {
  return ssaoRuntime(environment).isSsaoEnabled();
}

export function setEnvironmentSsaoEnabled(environment: GodotEnvironment, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Environment.ssao_enabled requires bool.');
  ssaoRuntime(environment).setSsaoEnabled(enabled);
}

export function getEnvironmentSsaoRadius(environment: GodotEnvironment): number {
  return ssaoRuntime(environment).getSsaoRadius();
}

export function setEnvironmentSsaoRadius(environment: GodotEnvironment, radius: number): void {
  ssaoRuntime(environment).setSsaoRadius(radius);
}

export function getEnvironmentSsaoIntensity(environment: GodotEnvironment): number {
  return ssaoRuntime(environment).getSsaoIntensity();
}

export function setEnvironmentSsaoIntensity(environment: GodotEnvironment, intensity: number): void {
  ssaoRuntime(environment).setSsaoIntensity(intensity);
}

export function getEnvironmentSsaoQuality(environment: GodotEnvironment): number {
  return ssaoRuntime(environment).getSsaoQuality();
}

export function setEnvironmentSsaoQuality(environment: GodotEnvironment, quality: number): void {
  ssaoRuntime(environment).setSsaoQuality(quality);
}

const environmentFogRuntimes = new WeakMap<object, GodotEnvironmentFogRuntime>();

export function bindEnvironmentFogRuntime(
  environment: GodotEnvironment,
  runtime: GodotEnvironmentFogRuntime,
): () => void {
  const key = environment as object;
  if (environmentFogRuntimes.has(key)) {
    throw new Error('Environment already has a retained native fog pass.');
  }
  environmentFogRuntimes.set(key, runtime);
  return () => { if (environmentFogRuntimes.get(key) === runtime) environmentFogRuntimes.delete(key); };
}

function fogRuntime(environment: GodotEnvironment): GodotEnvironmentFogRuntime {
  const runtime = environmentFogRuntimes.get(environment as object);
  if (runtime === undefined) {
    throw new Error('Environment.fog_enabled requires an authored retained native fog pass.');
  }
  return runtime;
}

export function setEnvironmentFogEnabled(environment: GodotEnvironment, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Environment.fog_enabled requires bool.');
  fogRuntime(environment).setFogEnabled(enabled);
}

export function isEnvironmentFogEnabled(environment: GodotEnvironment): boolean {
  return fogRuntime(environment).isFogEnabled();
}

export function getEnvironmentFogMode(environment: GodotEnvironment): number { return fogRuntime(environment).getFogMode(); }
export function setEnvironmentFogMode(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogMode(value); }
export function getEnvironmentFogLightColor(environment: GodotEnvironment): ColorValue { return fogRuntime(environment).getFogLightColor(); }
export function setEnvironmentFogLightColor(environment: GodotEnvironment, value: ColorValue): void { fogRuntime(environment).setFogLightColor(value); }
export function getEnvironmentFogLightEnergy(environment: GodotEnvironment): number { return fogRuntime(environment).getFogLightEnergy(); }
export function setEnvironmentFogLightEnergy(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogLightEnergy(value); }
export function getEnvironmentFogSunScatter(environment: GodotEnvironment): number { return fogRuntime(environment).getFogSunScatter(); }
export function setEnvironmentFogSunScatter(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogSunScatter(value); }
export function getEnvironmentFogDensity(environment: GodotEnvironment): number { return fogRuntime(environment).getFogDensity(); }
export function setEnvironmentFogDensity(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogDensity(value); }
export function getEnvironmentFogHeight(environment: GodotEnvironment): number { return fogRuntime(environment).getFogHeight(); }
export function setEnvironmentFogHeight(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogHeight(value); }
export function getEnvironmentFogHeightDensity(environment: GodotEnvironment): number { return fogRuntime(environment).getFogHeightDensity(); }
export function setEnvironmentFogHeightDensity(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogHeightDensity(value); }
export function getEnvironmentFogAerialPerspective(environment: GodotEnvironment): number { return fogRuntime(environment).getFogAerialPerspective(); }
export function setEnvironmentFogAerialPerspective(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogAerialPerspective(value); }
export function getEnvironmentFogSkyAffect(environment: GodotEnvironment): number { return fogRuntime(environment).getFogSkyAffect(); }
export function setEnvironmentFogSkyAffect(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogSkyAffect(value); }
export function getEnvironmentFogDepthCurve(environment: GodotEnvironment): number { return fogRuntime(environment).getFogDepthCurve(); }
export function setEnvironmentFogDepthCurve(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogDepthCurve(value); }
export function getEnvironmentFogDepthBegin(environment: GodotEnvironment): number { return fogRuntime(environment).getFogDepthBegin(); }
export function setEnvironmentFogDepthBegin(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogDepthBegin(value); }
export function getEnvironmentFogDepthEnd(environment: GodotEnvironment): number { return fogRuntime(environment).getFogDepthEnd(); }
export function setEnvironmentFogDepthEnd(environment: GodotEnvironment, value: number): void { fogRuntime(environment).setFogDepthEnd(value); }

const environmentAdjustmentRuntimes = new WeakMap<object, GodotEnvironmentAdjustmentRuntime>();

export function bindEnvironmentAdjustmentRuntime(
  environment: GodotEnvironment,
  runtime: GodotEnvironmentAdjustmentRuntime,
): () => void {
  const key = environment as object;
  if (environmentAdjustmentRuntimes.has(key)) {
    throw new Error('Environment already has a retained native color-adjustment pass.');
  }
  environmentAdjustmentRuntimes.set(key, runtime);
  return () => {
    if (environmentAdjustmentRuntimes.get(key) === runtime) environmentAdjustmentRuntimes.delete(key);
  };
}

function adjustmentRuntime(environment: GodotEnvironment): GodotEnvironmentAdjustmentRuntime {
  const runtime = environmentAdjustmentRuntimes.get(environment as object);
  if (runtime === undefined) {
    throw new Error('Environment adjustment requires an authored retained native tonemap pass.');
  }
  return runtime;
}

export function isEnvironmentAdjustmentEnabled(environment: GodotEnvironment): boolean { return adjustmentRuntime(environment).isAdjustmentEnabled(); }
export function setEnvironmentAdjustmentEnabled(environment: GodotEnvironment, value: boolean): void { adjustmentRuntime(environment).setAdjustmentEnabled(value); }
export function getEnvironmentAdjustmentBrightness(environment: GodotEnvironment): number { return adjustmentRuntime(environment).getAdjustmentBrightness(); }
export function setEnvironmentAdjustmentBrightness(environment: GodotEnvironment, value: number): void { adjustmentRuntime(environment).setAdjustmentBrightness(value); }
export function getEnvironmentAdjustmentContrast(environment: GodotEnvironment): number { return adjustmentRuntime(environment).getAdjustmentContrast(); }
export function setEnvironmentAdjustmentContrast(environment: GodotEnvironment, value: number): void { adjustmentRuntime(environment).setAdjustmentContrast(value); }
export function getEnvironmentAdjustmentSaturation(environment: GodotEnvironment): number { return adjustmentRuntime(environment).getAdjustmentSaturation(); }
export function setEnvironmentAdjustmentSaturation(environment: GodotEnvironment, value: number): void { adjustmentRuntime(environment).setAdjustmentSaturation(value); }

const environmentDepthOfFieldRuntimes = new WeakMap<object, GodotEnvironmentDepthOfFieldRuntime>();

export function bindEnvironmentDepthOfFieldRuntime(
  environment: GodotEnvironment,
  runtime: GodotEnvironmentDepthOfFieldRuntime,
): () => void {
  const key = environment as object;
  environmentDepthOfFieldRuntimes.set(key, runtime);
  return () => {
    if (environmentDepthOfFieldRuntimes.get(key) === runtime) environmentDepthOfFieldRuntimes.delete(key);
  };
}

function depthOfFieldRuntime(environment: GodotEnvironment): GodotEnvironmentDepthOfFieldRuntime {
  const runtime = environmentDepthOfFieldRuntimes.get(environment as object);
  if (runtime === undefined) {
    throw new Error('Environment DOF has no retained native postprocess pass for this world.');
  }
  return runtime;
}

function finiteEnvironmentScalar(member: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Environment.${member} requires a finite non-negative float.`);
  }
  return value;
}

function dofQuality(member: string, value: number): 0 | 1 | 2 {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new RangeError(`Environment.${member} requires LOW, MEDIUM, or HIGH (0..2).`);
  }
  return value as 0 | 1 | 2;
}

export function isEnvironmentDofBlurFarEnabled(environment: GodotEnvironment): boolean { return depthOfFieldRuntime(environment).getGodot3Config().farEnabled; }
export function setEnvironmentDofBlurFarEnabled(environment: GodotEnvironment, value: boolean): void { depthOfFieldRuntime(environment).setGodot3Config({ farEnabled: Boolean(value) }); }
export function getEnvironmentDofBlurFarDistance(environment: GodotEnvironment): number { return depthOfFieldRuntime(environment).getGodot3Config().farDistance; }
export function setEnvironmentDofBlurFarDistance(environment: GodotEnvironment, value: number): void { depthOfFieldRuntime(environment).setGodot3Config({ farDistance: finiteEnvironmentScalar('dof_blur_far_distance', value) }); }
export function getEnvironmentDofBlurFarTransition(environment: GodotEnvironment): number { return depthOfFieldRuntime(environment).getGodot3Config().farTransition; }
export function setEnvironmentDofBlurFarTransition(environment: GodotEnvironment, value: number): void { depthOfFieldRuntime(environment).setGodot3Config({ farTransition: finiteEnvironmentScalar('dof_blur_far_transition', value) }); }
export function getEnvironmentDofBlurFarAmount(environment: GodotEnvironment): number { return depthOfFieldRuntime(environment).getGodot3Config().farAmount; }
export function setEnvironmentDofBlurFarAmount(environment: GodotEnvironment, value: number): void { depthOfFieldRuntime(environment).setGodot3Config({ farAmount: finiteEnvironmentScalar('dof_blur_far_amount', value) }); }
export function getEnvironmentDofBlurFarQuality(environment: GodotEnvironment): number { return depthOfFieldRuntime(environment).getGodot3Config().farQuality; }
export function setEnvironmentDofBlurFarQuality(environment: GodotEnvironment, value: number): void { depthOfFieldRuntime(environment).setGodot3Config({ farQuality: dofQuality('dof_blur_far_quality', value) }); }
export function isEnvironmentDofBlurNearEnabled(environment: GodotEnvironment): boolean { return depthOfFieldRuntime(environment).getGodot3Config().nearEnabled; }
export function setEnvironmentDofBlurNearEnabled(environment: GodotEnvironment, value: boolean): void { depthOfFieldRuntime(environment).setGodot3Config({ nearEnabled: Boolean(value) }); }
export function getEnvironmentDofBlurNearDistance(environment: GodotEnvironment): number { return depthOfFieldRuntime(environment).getGodot3Config().nearDistance; }
export function setEnvironmentDofBlurNearDistance(environment: GodotEnvironment, value: number): void { depthOfFieldRuntime(environment).setGodot3Config({ nearDistance: finiteEnvironmentScalar('dof_blur_near_distance', value) }); }
export function getEnvironmentDofBlurNearTransition(environment: GodotEnvironment): number { return depthOfFieldRuntime(environment).getGodot3Config().nearTransition; }
export function setEnvironmentDofBlurNearTransition(environment: GodotEnvironment, value: number): void { depthOfFieldRuntime(environment).setGodot3Config({ nearTransition: finiteEnvironmentScalar('dof_blur_near_transition', value) }); }
export function getEnvironmentDofBlurNearAmount(environment: GodotEnvironment): number { return depthOfFieldRuntime(environment).getGodot3Config().nearAmount; }
export function setEnvironmentDofBlurNearAmount(environment: GodotEnvironment, value: number): void { depthOfFieldRuntime(environment).setGodot3Config({ nearAmount: finiteEnvironmentScalar('dof_blur_near_amount', value) }); }
export function getEnvironmentDofBlurNearQuality(environment: GodotEnvironment): number { return depthOfFieldRuntime(environment).getGodot3Config().nearQuality; }
export function setEnvironmentDofBlurNearQuality(environment: GodotEnvironment, value: number): void { depthOfFieldRuntime(environment).setGodot3Config({ nearQuality: dofQuality('dof_blur_near_quality', value) }); }

const environmentGlowRuntimes = new WeakMap<object, GodotEnvironmentGlowRuntime>();

export function bindEnvironmentGlowRuntime(
  environment: GodotEnvironment,
  runtime: GodotEnvironmentGlowRuntime,
): () => void {
  const key = environment as object;
  environmentGlowRuntimes.set(key, runtime);
  return () => {
    if (environmentGlowRuntimes.get(key) === runtime) environmentGlowRuntimes.delete(key);
  };
}

function glowRuntime(environment: GodotEnvironment): GodotEnvironmentGlowRuntime {
  const runtime = environmentGlowRuntimes.get(environment as object);
  if (runtime === undefined) {
    throw new Error(
      'Environment glow has no retained renderer pass. The translated world must mount its authored Environment postprocessing before glow can be read or changed.',
    );
  }
  return runtime;
}

export function setEnvironmentGlowEnabled(environment: GodotEnvironment, enabled: boolean): void {
  glowRuntime(environment).setGlowEnabled(Boolean(enabled));
}

export function isEnvironmentGlowEnabled(environment: GodotEnvironment): boolean {
  return glowRuntime(environment).isGlowEnabled();
}

export function setEnvironmentGlowBloom(environment: GodotEnvironment, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError('Environment.glow_bloom requires a finite float.');
  glowRuntime(environment).setGlowBloom(value);
}

export function getEnvironmentGlowBloom(environment: GodotEnvironment): number {
  return glowRuntime(environment).getGlowBloom();
}

function finiteGlowScalar(member: string, value: number): number {
  if (!Number.isFinite(value)) throw new TypeError(`Environment.${member} requires a finite float.`);
  return value;
}

export function setEnvironmentGlowIntensity(environment: GodotEnvironment, value: number): void {
  glowRuntime(environment).setGlowIntensity(finiteGlowScalar('glow_intensity', value));
}
export function getEnvironmentGlowIntensity(environment: GodotEnvironment): number {
  return glowRuntime(environment).getGlowIntensity();
}
export function setEnvironmentGlowStrength(environment: GodotEnvironment, value: number): void {
  glowRuntime(environment).setGlowStrength(finiteGlowScalar('glow_strength', value));
}
export function getEnvironmentGlowStrength(environment: GodotEnvironment): number {
  return glowRuntime(environment).getGlowStrength();
}
export function setEnvironmentGlowHdrThreshold(environment: GodotEnvironment, value: number): void {
  glowRuntime(environment).setGlowHdrThreshold(finiteGlowScalar('glow_hdr_threshold', value));
}
export function getEnvironmentGlowHdrThreshold(environment: GodotEnvironment): number {
  return glowRuntime(environment).getGlowHdrThreshold();
}
export function setEnvironmentGlowHdrScale(environment: GodotEnvironment, value: number): void {
  glowRuntime(environment).setGlowHdrScale(finiteGlowScalar('glow_hdr_scale', value));
}
export function getEnvironmentGlowHdrScale(environment: GodotEnvironment): number {
  return glowRuntime(environment).getGlowHdrScale();
}
export function setEnvironmentGlowHdrLuminanceCap(environment: GodotEnvironment, value: number): void {
  glowRuntime(environment).setGlowHdrLuminanceCap(finiteGlowScalar('glow_hdr_luminance_cap', value));
}
export function getEnvironmentGlowHdrLuminanceCap(environment: GodotEnvironment): number {
  return glowRuntime(environment).getGlowHdrLuminanceCap();
}

export function setEnvironmentGlowBlendMode(environment: GodotEnvironment, mode: number): void {
  if (!Number.isInteger(mode)) throw new TypeError('Environment.glow_blend_mode requires an integer.');
  glowRuntime(environment).setGlowBlendMode(mode);
}

export function getEnvironmentGlowBlendMode(environment: GodotEnvironment): number {
  return glowRuntime(environment).getGlowBlendMode();
}

export function setEnvironmentGlowNormalized(
  environment: GodotEnvironment,
  enabled: boolean,
): void {
  glowRuntime(environment).setGlowNormalized(Boolean(enabled));
}

export function isEnvironmentGlowNormalized(environment: GodotEnvironment): boolean {
  return glowRuntime(environment).isGlowNormalized();
}

export function setEnvironmentGlowMix(environment: GodotEnvironment, value: number): void {
  glowRuntime(environment).setGlowMix(finiteGlowScalar('glow_mix', value));
}

export function getEnvironmentGlowMix(environment: GodotEnvironment): number {
  return glowRuntime(environment).getGlowMix();
}

export function setEnvironmentGlowBicubicUpscale(
  environment: GodotEnvironment,
  enabled: boolean,
): void {
  glowRuntime(environment).setGlowBicubicUpscaleEnabled(Boolean(enabled));
}

export function isEnvironmentGlowBicubicUpscaleEnabled(
  environment: GodotEnvironment,
): boolean {
  return glowRuntime(environment).isGlowBicubicUpscaleEnabled();
}

export function setEnvironmentGlowHighQuality(environment: GodotEnvironment, enabled: boolean): void {
  glowRuntime(environment).setGlowHighQualityEnabled(Boolean(enabled));
}
export function isEnvironmentGlowHighQualityEnabled(environment: GodotEnvironment): boolean {
  return glowRuntime(environment).isGlowHighQualityEnabled();
}

function glowLevelIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= 7) {
    throw new RangeError('Environment glow level index must be an integer from 0 through 6.');
  }
  return index;
}

export function setEnvironmentGlowLevel(
  environment: GodotEnvironment,
  index: number,
  weight: number | boolean,
): void {
  glowRuntime(environment).setGlowLevel(
    glowLevelIndex(index),
    typeof weight === 'boolean' ? (weight ? 1 : 0) : finiteGlowScalar('glow_levels', weight),
  );
}
export function getEnvironmentGlowLevel(environment: GodotEnvironment, index: number): number {
  return glowRuntime(environment).getGlowLevel(glowLevelIndex(index));
}
export function setEnvironmentGlowLevelEnabled(
  environment: GodotEnvironment,
  index: number,
  enabled: boolean,
): void {
  glowRuntime(environment).setGlowLevel(glowLevelIndex(index), enabled ? 1 : 0);
}
export function isEnvironmentGlowLevelEnabled(environment: GodotEnvironment, index: number): boolean {
  return glowRuntime(environment).getGlowLevel(glowLevelIndex(index)) > 0.5;
}

const environmentStates = new WeakMap<object, EnvironmentState>();

interface WorldEnvironmentState {
  environment: GodotEnvironment | null;
  scene: GodotEnvironment;
}

const worldEnvironmentStates = new WeakMap<object, WorldEnvironmentState>();
const activeWorldEnvironment = new WeakMap<object, { node: object; environment: GodotEnvironment }>();
const environmentConsumers = new WeakMap<object, Set<GodotEnvironment>>();

function addEnvironmentConsumer(environment: GodotEnvironment, scene: GodotEnvironment): void {
  if (environment === scene) return;
  const consumers = environmentConsumers.get(environment as object) ?? new Set<GodotEnvironment>();
  consumers.add(scene);
  environmentConsumers.set(environment as object, consumers);
  refreshEnvironmentSkyConsumer(environment, scene);
}

function removeEnvironmentConsumer(environment: GodotEnvironment, scene: GodotEnvironment): void {
  const dome = environmentState(environment).skyDomes.get(scene);
  dome?.removeFromParent();
  environmentState(environment).skyDomes.delete(scene);
  const consumers = environmentConsumers.get(environment as object);
  consumers?.delete(scene);
  if (consumers?.size === 0) environmentConsumers.delete(environment as object);
}

function forEnvironmentAndConsumers(
  environment: GodotEnvironment,
  apply: (target: GodotEnvironment) => void,
): void {
  apply(environment);
  for (const consumer of environmentConsumers.get(environment as object) ?? []) apply(consumer);
}

function applyEnvironmentResource(environment: GodotEnvironment, scene: GodotEnvironment): void {
  if (environment === scene) return;
  scene.background = environment.background;
  scene.backgroundIntensity = environment.backgroundIntensity;
  scene.backgroundRotation.copy(environment.backgroundRotation);
  scene.environmentRotation.copy(environment.environmentRotation);
  if ('environment' in scene) scene.environment = environment.environment ?? null;
  if ('environmentIntensity' in scene) {
    scene.environmentIntensity = environment.environmentIntensity ?? 1;
  }
}

function clearWorldEnvironment(scene: GodotEnvironment): void {
  scene.background = null;
  scene.backgroundIntensity = 1;
  scene.backgroundRotation.set(0, 0, 0);
  scene.environmentRotation.set(0, 0, 0);
  if ('environment' in scene) scene.environment = null;
  if ('environmentIntensity' in scene) scene.environmentIntensity = 1;
}

function worldEnvironmentState(node: object, scene: GodotEnvironment): WorldEnvironmentState {
  const existing = worldEnvironmentStates.get(node);
  if (existing !== undefined) {
    if (existing.scene !== scene) {
      throw new Error('WorldEnvironment cannot move between retained Three scenes.');
    }
    return existing;
  }
  registerGodotObjectIdentity(scene as object, 'Environment');
  const state = { environment: scene, scene };
  worldEnvironmentStates.set(node, state);
  if (!activeWorldEnvironment.has(scene as object)) {
    activeWorldEnvironment.set(scene as object, { node, environment: scene });
  }
  return state;
}

function environmentState(environment: GodotEnvironment): EnvironmentState {
  const key = environment as object;
  let state = environmentStates.get(key);
  if (state !== undefined) return state;
  state = {
    mode: environment.background instanceof Color ? 1 : environment.background === null ? 0 : 2,
    color: environment.background instanceof Color
      ? { r: environment.background.r, g: environment.background.g, b: environment.background.b, a: 1 }
      : { r: 0, g: 0, b: 0, a: 1 },
    ambientLightSource: GODOT_ENVIRONMENT_AMBIENT_SOURCE.BACKGROUND,
    reflectedLightSource: GODOT_ENVIRONMENT_REFLECTION_SOURCE.BACKGROUND,
    sky: environment.background instanceof Color ? null : environment.background,
    skyResource: null,
    skyConnection: null,
    skyMaterialConnection: null,
    skyDomes: new Map(),
    toneMapper: GODOT_ENVIRONMENT_TONE_MAPPER.LINEAR,
    fogLightColor: { r: 0.518, g: 0.553, b: 0.608, a: 1 },
    backgroundSky: null,
    releaseBackgroundSky: null,
  };
  environmentStates.set(key, state);
  return state;
}

/** Construct one standalone Environment Resource. A Three Scene is the native settings owner; it
 * remains distinct from every live world scene that later consumes it through WorldEnvironment. */
export function createGodotEnvironment(): GodotEnvironment {
  const environment = new Scene();
  registerGodotObjectIdentity(environment, 'Environment');
  environmentState(environment);
  return environment;
}

function refreshEnvironmentSkyConsumer(
  environment: GodotEnvironment,
  scene: GodotEnvironment,
): void {
  const state = environmentState(environment);
  state.skyDomes.get(scene)?.removeFromParent();
  state.skyDomes.delete(scene);
  if (state.mode !== GODOT_ENVIRONMENT_BACKGROUND_MODE.SKY) return;
  const nativeSky = state.skyResource?.getMaterial()?.nativeSky;
  if (nativeSky === undefined || !(scene instanceof Scene)) return;
  const dome = nativeSky.clone() as Mesh;
  scene.add(dome);
  state.skyDomes.set(scene, dome);
}

function refreshEnvironmentSkyConsumers(environment: GodotEnvironment): void {
  for (const scene of environmentConsumers.get(environment as object) ?? []) {
    refreshEnvironmentSkyConsumer(environment, scene);
  }
}

/** Environment.sky retains the exact Sky Resource and projects its native shader into every live
 * WorldEnvironment consumer without changing either Resource identity. */
export function setGodotEnvironmentSky(
  environment: GodotEnvironment,
  sky: GodotSky | null,
): void {
  if (
    sky !== null &&
    (typeof sky !== 'object' || typeof sky.getMaterial !== 'function')
  ) {
    throw new TypeError('Environment.sky requires a Sky resource or null.');
  }
  const state = environmentState(environment);
  if (state.skyResource === sky) return;
  state.skyConnection?.disconnect();
  state.skyMaterialConnection?.disconnect();
  state.skyResource = sky;
  const bindMaterial = (): void => {
    state.skyMaterialConnection?.disconnect();
    const material = sky?.getMaterial() ?? null;
    state.skyMaterialConnection = material === null
      ? null
      : godotResourceChangedSignal(material).connect(() => refreshEnvironmentSkyConsumers(environment));
    refreshEnvironmentSkyConsumers(environment);
  };
  state.skyConnection = sky === null
    ? null
    : godotResourceChangedSignal(sky).connect(bindMaterial);
  bindMaterial();
}

export function getGodotEnvironmentSky(environment: GodotEnvironment): GodotSky | null {
  return environmentState(environment).skyResource;
}

/** Environment.ambient_light_source, retained on the same Resource identity consumed by the
 * renderer. Godot 4.7 stores the enum and forwards it unchanged to RenderingServer. */
export function setGodotEnvironmentAmbientLightSource(
  environment: GodotEnvironment,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new RangeError('Environment.ambient_light_source requires BACKGROUND through SKY.');
  }
  environmentState(environment).ambientLightSource = value;
}

export function getGodotEnvironmentAmbientLightSource(environment: GodotEnvironment): number {
  return environmentState(environment).ambientLightSource;
}

/** Environment.reflected_light_source, kept independently from ambient sourcing exactly as the
 * Godot Environment Resource does. */
export function setGodotEnvironmentReflectedLightSource(
  environment: GodotEnvironment,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new RangeError('Environment.reflected_light_source requires BACKGROUND through SKY.');
  }
  environmentState(environment).reflectedLightSource = value;
}

export function getGodotEnvironmentReflectedLightSource(environment: GodotEnvironment): number {
  return environmentState(environment).reflectedLightSource;
}

export function setGodotEnvironmentToneMapper(environment: GodotEnvironment, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= GODOT_ENVIRONMENT_TONE_MAPPER.TONE_MAPPER_AGX + 1) {
    throw new RangeError('Environment.tonemap_mode requires LINEAR through AGX.');
  }
  environmentState(environment).toneMapper = value;
}

export function getGodotEnvironmentToneMapper(environment: GodotEnvironment): number {
  return environmentState(environment).toneMapper;
}

export function setGodotEnvironmentAuthoredFogLightColor(
  environment: GodotEnvironment,
  value: ColorValue,
): void {
  if (typeof value !== 'object' || value === null || ![value.r, value.g, value.b, value.a].every(Number.isFinite)) {
    throw new TypeError('Environment.fog_light_color requires a finite Color.');
  }
  environmentState(environment).fogLightColor = { ...value };
}

export function getGodotEnvironmentAuthoredFogLightColor(environment: GodotEnvironment): ColorValue {
  return { ...environmentState(environment).fogLightColor };
}

export function setEnvironmentBackgroundSky(
  environment: GodotEnvironment,
  sky: GodotPanoramaSky | null,
): void {
  if (sky !== null && !(sky instanceof GodotPanoramaSky)) {
    throw new TypeError('Environment.background_sky requires a PanoramaSky resource or null.');
  }
  const state = environmentState(environment);
  state.releaseBackgroundSky?.();
  state.backgroundSky = sky;
  const refresh = (): void => {
    state.sky = sky?.getPanorama() ?? null;
    if (state.mode === GODOT_ENVIRONMENT_BACKGROUND_MODE.SKY) {
      forEnvironmentAndConsumers(environment, (target) => { target.background = state.sky; });
    }
  };
  state.releaseBackgroundSky = sky === null
    ? null
    : (() => {
        const connection = godotResourceChangedSignal(sky).connect(refresh);
        return () => connection.disconnect();
      })();
  refresh();
}

export function getEnvironmentBackgroundSky(
  environment: GodotEnvironment,
): GodotPanoramaSky | null {
  return environmentState(environment).backgroundSky;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
const DEGREES_PER_RADIAN = 180 / Math.PI;

/** Godot 3 Environment sky orientation carried by Three's native Scene rotation owners. */
export function setEnvironmentBackgroundSkyRotationDegrees(
  environment: GodotEnvironment,
  rotation: Vector3,
): void {
  if (
    typeof rotation !== 'object' || rotation === null ||
    ![rotation.x, rotation.y, rotation.z].every(Number.isFinite)
  ) {
    throw new TypeError('Environment.background_sky_rotation_degrees requires a finite Vector3.');
  }
  forEnvironmentAndConsumers(environment, (target) => {
    target.backgroundRotation.set(
      rotation.x * RADIANS_PER_DEGREE,
      rotation.y * RADIANS_PER_DEGREE,
      rotation.z * RADIANS_PER_DEGREE,
      'YXZ',
    );
    target.environmentRotation.copy(target.backgroundRotation);
  });
}

export function getEnvironmentBackgroundSkyRotationDegrees(
  environment: GodotEnvironment,
): Vector3 {
  return vec3(
    environment.backgroundRotation.x * DEGREES_PER_RADIAN,
    environment.backgroundRotation.y * DEGREES_PER_RADIAN,
    environment.backgroundRotation.z * DEGREES_PER_RADIAN,
  );
}

/** Release an emitter-owned sky binding without writing the shared native background. */
export function unbindEnvironmentBackgroundSky(
  environment: GodotEnvironment,
  expectedSky: GodotPanoramaSky,
): void {
  const state = environmentState(environment);
  // An older effect must never disconnect a newer authored Environment binding.
  if (state.backgroundSky !== expectedSky) return;
  state.releaseBackgroundSky?.();
  state.releaseBackgroundSky = null;
  state.backgroundSky = null;
  state.sky = null;
}

/**
 * `WorldEnvironment.environment` retains the node's exact Resource reference. The authored
 * Environment begins as the Three scene because that is where its live settings already reside;
 * replacement Resources remain distinct identities and acquire the scene only as a consumer.
 */
export function getEnvironment(
  node: object,
  scene: GodotEnvironment,
): GodotEnvironment | null {
  return worldEnvironmentState(node, scene).environment;
}

/** Godot's `WorldEnvironment::set_environment`: release the old world consumer, retain the exact
 * incoming Ref (including null), then install a non-null replacement on this scene. Assigning the
 * already-active Resource is an identity-preserving no-op; sharing one Resource with another
 * world keeps the Resource identity and gives each scene a live consumer. */
export function setEnvironment(
  node: object,
  scene: GodotEnvironment,
  environment: GodotEnvironment | null,
): void {
  if (
    environment !== null &&
    (typeof environment !== 'object' ||
      typeof environment.backgroundIntensity !== 'number' ||
      typeof environment.backgroundRotation?.copy !== 'function' ||
      typeof environment.environmentRotation?.copy !== 'function')
  ) {
    throw new TypeError('WorldEnvironment.environment requires an Environment resource or null.');
  }
  const state = worldEnvironmentState(node, scene);
  const active = activeWorldEnvironment.get(scene as object);
  if (state.environment === environment && active?.node === node) return;

  if (active?.node === node) {
    removeEnvironmentConsumer(active.environment, scene);
    activeWorldEnvironment.delete(scene as object);
  }
  state.environment = environment;
  if (environment === null) {
    if (active?.node === node) clearWorldEnvironment(scene);
    return;
  }

  const displaced = activeWorldEnvironment.get(scene as object);
  if (displaced !== undefined) removeEnvironmentConsumer(displaced.environment, scene);
  activeWorldEnvironment.set(scene as object, { node, environment });
  registerGodotObjectIdentity(environment as object, 'Environment');
  addEnvironmentConsumer(environment, scene);
  applyEnvironmentResource(environment, scene);
}

/**
 * `environment.background_energy_multiplier = m` — `main.gd:11`, which quarters the sky's
 * brightness under Godot's compatibility renderer.
 *
 * Godot multiplies the background's radiance (and the ambient light it contributes when
 * `ambient_light_source` is the background) by this scalar; three's `Scene.backgroundIntensity` is
 * the same multiplier on the same quantity, `1` by default in both. Godot 3.x spelled it
 * `background_energy`, and the rename in 4.0 came with no change to the meaning.
 *
 * NOTE what this does NOT do, because Godot's does: with the background as the ambient source,
 * Godot's multiplier dims the AMBIENT contribution too. three splits those — `backgroundIntensity`
 * is the visible sky and `environmentIntensity` is what lights the objects — so a project that
 * lights from its sky needs the emitter to carry `ambient_light_source` onto the second property.
 * The measured fixture lights from a `DirectionalLight3D` and this write is the visible sky alone.
 */
export function setBackgroundEnergyMultiplier(environment: GodotEnvironment, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Environment.background_energy_multiplier must be finite and non-negative.');
  }
  forEnvironmentAndConsumers(environment, (target) => { target.backgroundIntensity = value; });
}

/** `environment.background_energy_multiplier` — see {@link setBackgroundEnergyMultiplier}. */
export function getBackgroundEnergyMultiplier(environment: GodotEnvironment): number {
  return environment.backgroundIntensity;
}

export function setEnvironmentBackgroundColor(
  environment: GodotEnvironment,
  value: ColorValue,
): void {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Environment.background_color requires a Color value.');
  }
  const channels = [value.r, value.g, value.b, value.a];
  if (!channels.every(Number.isFinite)) {
    throw new TypeError('Environment.background_color requires a finite Color value.');
  }
  const state = environmentState(environment);
  state.color = { r: value.r, g: value.g, b: value.b, a: value.a };
  if (state.mode === 1) {
    forEnvironmentAndConsumers(environment, (target) => {
      target.background = new Color(value.r, value.g, value.b);
    });
  }
}

export function getEnvironmentBackgroundColor(environment: GodotEnvironment): ColorValue {
  const color = environmentState(environment).color;
  return { r: color.r, g: color.g, b: color.b, a: color.a };
}

export function setEnvironmentBackgroundMode(environment: GodotEnvironment, mode: number): void {
  if (!Number.isInteger(mode)) throw new TypeError('Environment.background_mode requires an integer.');
  const state = environmentState(environment);
  state.mode = mode;
  if (mode === 0) {
    forEnvironmentAndConsumers(environment, (target) => { target.background = null; });
  } else if (mode === 1) {
    forEnvironmentAndConsumers(environment, (target) => {
      target.background = new Color(state.color.r, state.color.g, state.color.b);
    });
  }
  else if (mode === 2) {
    forEnvironmentAndConsumers(environment, (target) => { target.background = state.sky; });
  } else {
    throw new Error(`Environment background mode ${mode} has no exact native Three scene mode.`);
  }
  refreshEnvironmentSkyConsumers(environment);
}

export function getEnvironmentBackgroundMode(environment: GodotEnvironment): number {
  return environmentState(environment).mode;
}

export function setEnvironmentBackground(
  environment: GodotEnvironment,
  mode: number,
): void {
  setEnvironmentBackgroundMode(environment, mode);
}

export function getEnvironmentBackground(environment: GodotEnvironment): number {
  return getEnvironmentBackgroundMode(environment);
}

export function setEnvironmentBgColor(environment: GodotEnvironment, color: ColorValue): void {
  setEnvironmentBackgroundColor(environment, color);
}

export function getEnvironmentBgColor(environment: GodotEnvironment): ColorValue {
  return getEnvironmentBackgroundColor(environment);
}

export function setEnvironmentBgEnergyMultiplier(
  environment: GodotEnvironment,
  value: number,
): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Environment background energy multiplier must be finite and non-negative.');
  }
  setBackgroundEnergyMultiplier(environment, value);
}

export function getEnvironmentBgEnergyMultiplier(environment: GodotEnvironment): number {
  return getBackgroundEnergyMultiplier(environment);
}

export type GodotCubemapArrangement = '1x6' | '2x3' | '3x2' | '6x1';

/**
 * Godot's `cubemap_texture` importer slices its atlas row-major and stores those six images as the
 * cubemap layers (`resource_importer_layered_texture.cpp`, `i` rows then `j` columns). Three's
 * CubeTexture consumes the same six face order. This helper performs only that mechanical slice
 * and returns Three's own texture; the translator has already bound the active sky shader to the
 * exact samplerCube recipe that makes this representation valid.
 */
export function createGodotCubemapFromAtlas(
  image: CanvasImageSource & { readonly width: number; readonly height: number },
  arrangement: GodotCubemapArrangement,
): CubeTexture {
  const [columns, rows] = arrangement.split('x').map(Number) as [number, number];
  const faceWidth = image.width / columns;
  const faceHeight = image.height / rows;
  if (
    !Number.isInteger(faceWidth) ||
    !Number.isInteger(faceHeight) ||
    faceWidth <= 0 ||
    faceWidth !== faceHeight ||
    columns * rows !== 6
  ) {
    throw new Error(
      `Godot cubemap atlas ${image.width}x${image.height} is not six square ${arrangement} faces`,
    );
  }
  const faces: HTMLCanvasElement[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = faceWidth;
      canvas.height = faceHeight;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Godot cubemap atlas requires a 2D canvas context');
      context.drawImage(
        image,
        column * faceWidth,
        row * faceHeight,
        faceWidth,
        faceHeight,
        0,
        0,
        faceWidth,
        faceHeight,
      );
      faces.push(canvas);
    }
  }
  const texture = new CubeTexture(faces);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
