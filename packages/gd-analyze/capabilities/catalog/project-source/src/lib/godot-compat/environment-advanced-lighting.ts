import type { GodotEnvironment } from './world-environment-3d';
import type { ColorValue } from './variant';

export interface GodotEnvironmentAdvancedLightingSnapshot {
  readonly ssaoPower: number;
  readonly ssaoDetail: number;
  readonly ssaoHorizon: number;
  readonly ssaoSharpness: number;
  readonly ssilEnabled: boolean;
  readonly ssilRadius: number;
  readonly ssilIntensity: number;
  readonly ssilSharpness: number;
  readonly ssilNormalRejection: number;
  readonly ssrEnabled: boolean;
  readonly ssrMaxSteps: number;
  readonly ssrFadeIn: number;
  readonly ssrFadeOut: number;
  readonly ssrDepthTolerance: number;
  readonly sdfgiEnabled: boolean;
  readonly sdfgiCascades: number;
  readonly sdfgiMinCellSize: number;
  readonly sdfgiYScale: number;
  readonly sdfgiUseOcclusion: boolean;
  readonly sdfgiBounceFeedback: number;
  readonly sdfgiReadSkyLight: boolean;
  readonly sdfgiEnergy: number;
  readonly volumetricFogEnabled: boolean;
  readonly volumetricFogDensity: number;
  readonly volumetricFogAlbedo: ColorValue;
  readonly volumetricFogEmission: ColorValue;
  readonly volumetricFogEmissionEnergy: number;
  readonly volumetricFogLength: number;
  readonly volumetricFogDetailSpread: number;
  readonly volumetricFogGiInject: number;
  readonly volumetricFogAmbientInject: number;
  readonly volumetricFogSkyAffect: number;
  readonly volumetricFogTemporalReprojectionEnabled: boolean;
  readonly volumetricFogTemporalReprojectionAmount: number;
}

export interface GodotEnvironmentAdvancedLightingBinding {
  apply(snapshot: GodotEnvironmentAdvancedLightingSnapshot): void;
}

interface MutableState {
  ssaoPower: number;
  ssaoDetail: number;
  ssaoHorizon: number;
  ssaoSharpness: number;
  ssilEnabled: boolean;
  ssilRadius: number;
  ssilIntensity: number;
  ssilSharpness: number;
  ssilNormalRejection: number;
  ssrEnabled: boolean;
  ssrMaxSteps: number;
  ssrFadeIn: number;
  ssrFadeOut: number;
  ssrDepthTolerance: number;
  sdfgiEnabled: boolean;
  sdfgiCascades: number;
  sdfgiMinCellSize: number;
  sdfgiYScale: number;
  sdfgiUseOcclusion: boolean;
  sdfgiBounceFeedback: number;
  sdfgiReadSkyLight: boolean;
  sdfgiEnergy: number;
  volumetricFogEnabled: boolean;
  volumetricFogDensity: number;
  volumetricFogAlbedo: ColorValue;
  volumetricFogEmission: ColorValue;
  volumetricFogEmissionEnergy: number;
  volumetricFogLength: number;
  volumetricFogDetailSpread: number;
  volumetricFogGiInject: number;
  volumetricFogAmbientInject: number;
  volumetricFogSkyAffect: number;
  volumetricFogTemporalReprojectionEnabled: boolean;
  volumetricFogTemporalReprojectionAmount: number;
  binding: GodotEnvironmentAdvancedLightingBinding | null;
  listeners: Set<(snapshot: GodotEnvironmentAdvancedLightingSnapshot) => void>;
}

const STATES = new WeakMap<GodotEnvironment, MutableState>();

function stateOf(environment: GodotEnvironment): MutableState {
  let state = STATES.get(environment);
  if (state !== undefined) return state;
  state = {
    ssaoPower: 1.5, ssaoDetail: 0.5, ssaoHorizon: 0.06, ssaoSharpness: 0.98,
    ssilEnabled: false, ssilRadius: 5, ssilIntensity: 1, ssilSharpness: 0.98, ssilNormalRejection: 1,
    ssrEnabled: false, ssrMaxSteps: 64, ssrFadeIn: 0.15, ssrFadeOut: 2, ssrDepthTolerance: 0.2,
    sdfgiEnabled: false, sdfgiCascades: 4, sdfgiMinCellSize: 0.2, sdfgiYScale: 0,
    sdfgiUseOcclusion: false, sdfgiBounceFeedback: 0.5, sdfgiReadSkyLight: true, sdfgiEnergy: 1,
    volumetricFogEnabled: false, volumetricFogDensity: 0.05,
    volumetricFogAlbedo: { r: 1, g: 1, b: 1, a: 1 },
    volumetricFogEmission: { r: 0, g: 0, b: 0, a: 1 },
    volumetricFogEmissionEnergy: 1, volumetricFogLength: 64, volumetricFogDetailSpread: 2,
    volumetricFogGiInject: 1, volumetricFogAmbientInject: 0, volumetricFogSkyAffect: 1,
    volumetricFogTemporalReprojectionEnabled: true, volumetricFogTemporalReprojectionAmount: 0.9,
    binding: null, listeners: new Set(),
  };
  STATES.set(environment, state);
  return state;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`godot-compat: Environment.${member} requires a finite value in [${minimum}, ${maximum}].`);
  return value;
}
function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  const number = finite(value, member, minimum, maximum); if (!Number.isSafeInteger(number)) throw new TypeError(`godot-compat: Environment.${member} requires an integer.`); return number;
}
function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: Environment.${member} requires bool.`); return value;
}
function color(value: unknown, member: string): ColorValue {
  if (typeof value !== 'object' || value === null || !('r' in value) || !('g' in value) || !('b' in value)) throw new TypeError(`godot-compat: Environment.${member} requires Color.`);
  return Object.freeze({ r: finite(value.r, `${member}.r`), g: finite(value.g, `${member}.g`), b: finite(value.b, `${member}.b`), a: finite('a' in value ? value.a : 1, `${member}.a`) });
}

function snapshot(state: MutableState): GodotEnvironmentAdvancedLightingSnapshot {
  return Object.freeze({
    ssaoPower: state.ssaoPower, ssaoDetail: state.ssaoDetail, ssaoHorizon: state.ssaoHorizon, ssaoSharpness: state.ssaoSharpness,
    ssilEnabled: state.ssilEnabled, ssilRadius: state.ssilRadius, ssilIntensity: state.ssilIntensity, ssilSharpness: state.ssilSharpness, ssilNormalRejection: state.ssilNormalRejection,
    ssrEnabled: state.ssrEnabled, ssrMaxSteps: state.ssrMaxSteps, ssrFadeIn: state.ssrFadeIn, ssrFadeOut: state.ssrFadeOut, ssrDepthTolerance: state.ssrDepthTolerance,
    sdfgiEnabled: state.sdfgiEnabled, sdfgiCascades: state.sdfgiCascades, sdfgiMinCellSize: state.sdfgiMinCellSize, sdfgiYScale: state.sdfgiYScale,
    sdfgiUseOcclusion: state.sdfgiUseOcclusion, sdfgiBounceFeedback: state.sdfgiBounceFeedback, sdfgiReadSkyLight: state.sdfgiReadSkyLight, sdfgiEnergy: state.sdfgiEnergy,
    volumetricFogEnabled: state.volumetricFogEnabled, volumetricFogDensity: state.volumetricFogDensity,
    volumetricFogAlbedo: { ...state.volumetricFogAlbedo }, volumetricFogEmission: { ...state.volumetricFogEmission },
    volumetricFogEmissionEnergy: state.volumetricFogEmissionEnergy, volumetricFogLength: state.volumetricFogLength,
    volumetricFogDetailSpread: state.volumetricFogDetailSpread, volumetricFogGiInject: state.volumetricFogGiInject,
    volumetricFogAmbientInject: state.volumetricFogAmbientInject, volumetricFogSkyAffect: state.volumetricFogSkyAffect,
    volumetricFogTemporalReprojectionEnabled: state.volumetricFogTemporalReprojectionEnabled,
    volumetricFogTemporalReprojectionAmount: state.volumetricFogTemporalReprojectionAmount,
  });
}

function publish(state: MutableState): void { const value = snapshot(state); state.binding?.apply(value); for (const listener of state.listeners) listener(value); }

export function bindGodotEnvironmentAdvancedLighting(environment: GodotEnvironment, binding: GodotEnvironmentAdvancedLightingBinding | null): () => void {
  const state = stateOf(environment); state.binding = binding; if (binding !== null) binding.apply(snapshot(state));
  return () => { if (state.binding === binding) state.binding = null; };
}
export function watchGodotEnvironmentAdvancedLighting(environment: GodotEnvironment, listener: (snapshot: GodotEnvironmentAdvancedLightingSnapshot) => void): () => void {
  const state = stateOf(environment); state.listeners.add(listener); listener(snapshot(state)); return () => state.listeners.delete(listener);
}
export function getGodotEnvironmentAdvancedLighting(environment: GodotEnvironment): GodotEnvironmentAdvancedLightingSnapshot { return snapshot(stateOf(environment)); }

export function getEnvironmentSsaoPower(environment: GodotEnvironment): number { return stateOf(environment).ssaoPower; }
export function setEnvironmentSsaoPower(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssaoPower = finite(value, 'ssao_power', 0); publish(state); }
export function getEnvironmentSsaoDetail(environment: GodotEnvironment): number { return stateOf(environment).ssaoDetail; }
export function setEnvironmentSsaoDetail(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssaoDetail = finite(value, 'ssao_detail', 0, 1); publish(state); }
export function getEnvironmentSsaoHorizon(environment: GodotEnvironment): number { return stateOf(environment).ssaoHorizon; }
export function setEnvironmentSsaoHorizon(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssaoHorizon = finite(value, 'ssao_horizon', 0, 1); publish(state); }
export function getEnvironmentSsaoSharpness(environment: GodotEnvironment): number { return stateOf(environment).ssaoSharpness; }
export function setEnvironmentSsaoSharpness(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssaoSharpness = finite(value, 'ssao_sharpness', 0, 1); publish(state); }

export function isEnvironmentSsilEnabled(environment: GodotEnvironment): boolean { return stateOf(environment).ssilEnabled; }
export function setEnvironmentSsilEnabled(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssilEnabled = bool(value, 'ssil_enabled'); publish(state); }
export function getEnvironmentSsilRadius(environment: GodotEnvironment): number { return stateOf(environment).ssilRadius; }
export function setEnvironmentSsilRadius(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssilRadius = finite(value, 'ssil_radius', 0); publish(state); }
export function getEnvironmentSsilIntensity(environment: GodotEnvironment): number { return stateOf(environment).ssilIntensity; }
export function setEnvironmentSsilIntensity(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssilIntensity = finite(value, 'ssil_intensity', 0); publish(state); }
export function getEnvironmentSsilSharpness(environment: GodotEnvironment): number { return stateOf(environment).ssilSharpness; }
export function setEnvironmentSsilSharpness(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssilSharpness = finite(value, 'ssil_sharpness', 0, 1); publish(state); }
export function getEnvironmentSsilNormalRejection(environment: GodotEnvironment): number { return stateOf(environment).ssilNormalRejection; }
export function setEnvironmentSsilNormalRejection(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssilNormalRejection = finite(value, 'ssil_normal_rejection', 0, 1); publish(state); }

export function isEnvironmentSsrEnabled(environment: GodotEnvironment): boolean { return stateOf(environment).ssrEnabled; }
export function setEnvironmentSsrEnabled(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssrEnabled = bool(value, 'ssr_enabled'); publish(state); }
export function getEnvironmentSsrMaxSteps(environment: GodotEnvironment): number { return stateOf(environment).ssrMaxSteps; }
export function setEnvironmentSsrMaxSteps(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssrMaxSteps = integer(value, 'ssr_max_steps', 1, 512); publish(state); }
export function getEnvironmentSsrFadeIn(environment: GodotEnvironment): number { return stateOf(environment).ssrFadeIn; }
export function setEnvironmentSsrFadeIn(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssrFadeIn = finite(value, 'ssr_fade_in', 0); publish(state); }
export function getEnvironmentSsrFadeOut(environment: GodotEnvironment): number { return stateOf(environment).ssrFadeOut; }
export function setEnvironmentSsrFadeOut(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssrFadeOut = finite(value, 'ssr_fade_out', 0); publish(state); }
export function getEnvironmentSsrDepthTolerance(environment: GodotEnvironment): number { return stateOf(environment).ssrDepthTolerance; }
export function setEnvironmentSsrDepthTolerance(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.ssrDepthTolerance = finite(value, 'ssr_depth_tolerance', 0); publish(state); }

export function isEnvironmentSdfgiEnabled(environment: GodotEnvironment): boolean { return stateOf(environment).sdfgiEnabled; }
export function setEnvironmentSdfgiEnabled(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.sdfgiEnabled = bool(value, 'sdfgi_enabled'); publish(state); }
export function getEnvironmentSdfgiCascades(environment: GodotEnvironment): number { return stateOf(environment).sdfgiCascades; }
export function setEnvironmentSdfgiCascades(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.sdfgiCascades = integer(value, 'sdfgi_cascades', 1, 8); publish(state); }
export function getEnvironmentSdfgiMinCellSize(environment: GodotEnvironment): number { return stateOf(environment).sdfgiMinCellSize; }
export function setEnvironmentSdfgiMinCellSize(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.sdfgiMinCellSize = finite(value, 'sdfgi_min_cell_size', Number.MIN_VALUE); publish(state); }
export function getEnvironmentSdfgiYScale(environment: GodotEnvironment): number { return stateOf(environment).sdfgiYScale; }
export function setEnvironmentSdfgiYScale(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.sdfgiYScale = integer(value, 'sdfgi_y_scale', 0, 2); publish(state); }
export function isEnvironmentSdfgiUsingOcclusion(environment: GodotEnvironment): boolean { return stateOf(environment).sdfgiUseOcclusion; }
export function setEnvironmentSdfgiUseOcclusion(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.sdfgiUseOcclusion = bool(value, 'sdfgi_use_occlusion'); publish(state); }
export function getEnvironmentSdfgiBounceFeedback(environment: GodotEnvironment): number { return stateOf(environment).sdfgiBounceFeedback; }
export function setEnvironmentSdfgiBounceFeedback(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.sdfgiBounceFeedback = finite(value, 'sdfgi_bounce_feedback', 0, 1); publish(state); }
export function isEnvironmentSdfgiReadingSkyLight(environment: GodotEnvironment): boolean { return stateOf(environment).sdfgiReadSkyLight; }
export function setEnvironmentSdfgiReadSkyLight(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.sdfgiReadSkyLight = bool(value, 'sdfgi_read_sky_light'); publish(state); }
export function getEnvironmentSdfgiEnergy(environment: GodotEnvironment): number { return stateOf(environment).sdfgiEnergy; }
export function setEnvironmentSdfgiEnergy(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.sdfgiEnergy = finite(value, 'sdfgi_energy', 0); publish(state); }

export function isEnvironmentVolumetricFogEnabled(environment: GodotEnvironment): boolean { return stateOf(environment).volumetricFogEnabled; }
export function setEnvironmentVolumetricFogEnabled(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogEnabled = bool(value, 'volumetric_fog_enabled'); publish(state); }
export function getEnvironmentVolumetricFogDensity(environment: GodotEnvironment): number { return stateOf(environment).volumetricFogDensity; }
export function setEnvironmentVolumetricFogDensity(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogDensity = finite(value, 'volumetric_fog_density', 0); publish(state); }
export function getEnvironmentVolumetricFogAlbedo(environment: GodotEnvironment): ColorValue { return { ...stateOf(environment).volumetricFogAlbedo }; }
export function setEnvironmentVolumetricFogAlbedo(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogAlbedo = color(value, 'volumetric_fog_albedo'); publish(state); }
export function getEnvironmentVolumetricFogEmission(environment: GodotEnvironment): ColorValue { return { ...stateOf(environment).volumetricFogEmission }; }
export function setEnvironmentVolumetricFogEmission(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogEmission = color(value, 'volumetric_fog_emission'); publish(state); }
export function getEnvironmentVolumetricFogEmissionEnergy(environment: GodotEnvironment): number { return stateOf(environment).volumetricFogEmissionEnergy; }
export function setEnvironmentVolumetricFogEmissionEnergy(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogEmissionEnergy = finite(value, 'volumetric_fog_emission_energy', 0); publish(state); }
export function getEnvironmentVolumetricFogLength(environment: GodotEnvironment): number { return stateOf(environment).volumetricFogLength; }
export function setEnvironmentVolumetricFogLength(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogLength = finite(value, 'volumetric_fog_length', 0); publish(state); }
export function getEnvironmentVolumetricFogDetailSpread(environment: GodotEnvironment): number { return stateOf(environment).volumetricFogDetailSpread; }
export function setEnvironmentVolumetricFogDetailSpread(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogDetailSpread = finite(value, 'volumetric_fog_detail_spread', 0); publish(state); }
export function getEnvironmentVolumetricFogGiInject(environment: GodotEnvironment): number { return stateOf(environment).volumetricFogGiInject; }
export function setEnvironmentVolumetricFogGiInject(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogGiInject = finite(value, 'volumetric_fog_gi_inject', 0); publish(state); }
export function getEnvironmentVolumetricFogAmbientInject(environment: GodotEnvironment): number { return stateOf(environment).volumetricFogAmbientInject; }
export function setEnvironmentVolumetricFogAmbientInject(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogAmbientInject = finite(value, 'volumetric_fog_ambient_inject', 0, 1); publish(state); }
export function getEnvironmentVolumetricFogSkyAffect(environment: GodotEnvironment): number { return stateOf(environment).volumetricFogSkyAffect; }
export function setEnvironmentVolumetricFogSkyAffect(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogSkyAffect = finite(value, 'volumetric_fog_sky_affect', 0, 1); publish(state); }
export function isEnvironmentVolumetricFogTemporalReprojectionEnabled(environment: GodotEnvironment): boolean { return stateOf(environment).volumetricFogTemporalReprojectionEnabled; }
export function setEnvironmentVolumetricFogTemporalReprojectionEnabled(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogTemporalReprojectionEnabled = bool(value, 'volumetric_fog_temporal_reprojection_enabled'); publish(state); }
export function getEnvironmentVolumetricFogTemporalReprojectionAmount(environment: GodotEnvironment): number { return stateOf(environment).volumetricFogTemporalReprojectionAmount; }
export function setEnvironmentVolumetricFogTemporalReprojectionAmount(environment: GodotEnvironment, value: unknown): void { const state = stateOf(environment); state.volumetricFogTemporalReprojectionAmount = finite(value, 'volumetric_fog_temporal_reprojection_amount', 0, 1); publish(state); }
