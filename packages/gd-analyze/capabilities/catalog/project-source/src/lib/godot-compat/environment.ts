/**
 * @godot-class Environment
 * @role BINDING
 *
 * Godot 4.7's `Environment` (`scene/resources/environment.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the background, ambient light, tone mapping and fog
 * parameters a scene's `WorldEnvironment` draws with, stored and read back as the resource stores
 * them. How the Compatibility renderer draws them on three is `world-environment.ts`'s; the tone
 * mapper's parameters are computed here as the renderer computes them
 * (`RendererEnvironmentStorage::environment_get_tonemap_parameters`,
 * `servers/rendering/storage/environment_storage.cpp:276`). Glow, SSAO and the adjustments are the
 * renderer's post pass (`environment-post.ts`); the parameters that renderer never reads are stored
 * and read back only.
 */

import { construct as color, type Color } from './color';
import type { Sky } from './sky';

const f32 = Math.fround;

export interface Environment {
  bg_mode: number;
  bg_color: Color;
  bg_energy_multiplier: number;
  sky: Sky | null;
  ambient_color: Color;
  ambient_source: number;
  ambient_energy: number;
  ambient_sky_contribution: number;
  reflection_source: number;
  tone_mapper: number;
  tonemap_exposure: number;
  tonemap_white: number;
  tonemap_agx_white: number;
  tonemap_agx_contrast: number;
  fog_enabled: boolean;
  fog_light_color: Color;
  fog_light_energy: number;
  fog_sun_scatter: number;
  fog_density: number;
  fog_height: number;
  fog_height_density: number;
  fog_sky_affect: number;
  fog_mode: number;
  /** The post pass's parameters (`post-effects.ts`): glow, SSAO and the adjustments. */
  glow_enabled: boolean;
  glow_intensity: number;
  glow_bloom: number;
  glow_hdr_bleed_threshold: number;
  glow_hdr_bleed_scale: number;
  glow_hdr_luminance_cap: number;
  ssao_enabled: boolean;
  ssao_radius: number;
  ssao_intensity: number;
  adjustment_enabled: boolean;
  adjustment_brightness: number;
  adjustment_contrast: number;
  adjustment_saturation: number;
  /** Stored and read back; the Compatibility renderer never reads them (`godot_environment_set_unread`). */
  ssao_power: number;
  ssao_horizon: number;
  glow_levels: number[];
  sdfgi_cascades: number;
  sdfgi_energy: number;
}

/**
 * An environment at its initial values (`environment.h:96`).
 *
 * @godot Environment (protocol)
 * @source scene/resources/environment.cpp:1637
 */
export function construct(): Environment {
  return {
    bg_mode: 0,
    bg_color: color(0, 0, 0, 1),
    bg_energy_multiplier: 1,
    sky: null,
    ambient_color: color(0, 0, 0, 1),
    ambient_source: 0,
    ambient_energy: 1,
    ambient_sky_contribution: 1,
    reflection_source: 0,
    tone_mapper: 0,
    tonemap_exposure: 1,
    tonemap_white: 1,
    tonemap_agx_white: f32(16.29),
    tonemap_agx_contrast: 1.25,
    fog_enabled: false,
    fog_light_color: color(0.518, 0.553, 0.608, 1),
    fog_light_energy: 1,
    fog_sun_scatter: 0,
    fog_density: f32(0.01),
    fog_height: 0,
    fog_height_density: 0,
    fog_sky_affect: 1,
    fog_mode: 0,
    glow_enabled: false,
    glow_intensity: f32(0.3),
    glow_bloom: 0,
    glow_hdr_bleed_threshold: 1,
    glow_hdr_bleed_scale: 2,
    glow_hdr_luminance_cap: 12,
    ssao_enabled: false,
    ssao_radius: 1,
    ssao_intensity: 2,
    adjustment_enabled: false,
    adjustment_brightness: 1,
    adjustment_contrast: 1,
    adjustment_saturation: 1,
    ssao_power: 1.5,
    ssao_horizon: f32(0.06),
    glow_levels: [0, f32(0.8), f32(0.4), f32(0.1), 0, 0, 0],
    sdfgi_cascades: 4,
    sdfgi_energy: 1,
  };
}

/**
 * @godot Environment.set_background
 * @source scene/resources/environment.cpp:48
 */
export function set_background(self: Environment, value: number): void {
  self.bg_mode = value;
}

/**
 * @godot Environment.get_background
 * @source scene/resources/environment.cpp:57
 */
export function get_background(self: Environment): number {
  return self.bg_mode;
}

/**
 * @godot Environment.set_bg_color
 * @source scene/resources/environment.cpp:92
 */
export function set_bg_color(self: Environment, value: Color): void {
  self.bg_color = value;
}

/**
 * @godot Environment.get_bg_color
 * @source scene/resources/environment.cpp:97
 */
export function get_bg_color(self: Environment): Color {
  return self.bg_color;
}

/**
 * @godot Environment.set_bg_energy_multiplier
 * @source scene/resources/environment.cpp:101
 */
export function set_bg_energy_multiplier(self: Environment, value: number): void {
  self.bg_energy_multiplier = f32(value);
}

/**
 * @godot Environment.get_bg_energy_multiplier
 * @source scene/resources/environment.cpp:106
 */
export function get_bg_energy_multiplier(self: Environment): number {
  return self.bg_energy_multiplier;
}

/**
 * @godot Environment.set_sky
 * @source scene/resources/environment.cpp:61
 */
export function set_sky(self: Environment, value: Sky | null): void {
  self.sky = value;
}

/**
 * @godot Environment.get_sky
 * @source scene/resources/environment.cpp:70
 */
export function get_sky(self: Environment): Sky | null {
  return self.sky;
}

/**
 * @godot Environment.set_ambient_light_color
 * @source scene/resources/environment.cpp:147
 */
export function set_ambient_light_color(self: Environment, value: Color): void {
  self.ambient_color = value;
}

/**
 * @godot Environment.get_ambient_light_color
 * @source scene/resources/environment.cpp:152
 */
export function get_ambient_light_color(self: Environment): Color {
  return self.ambient_color;
}

/**
 * @godot Environment.set_ambient_source
 * @source scene/resources/environment.cpp:156
 */
export function set_ambient_source(self: Environment, value: number): void {
  self.ambient_source = value;
}

/**
 * @godot Environment.get_ambient_source
 * @source scene/resources/environment.cpp:162
 */
export function get_ambient_source(self: Environment): number {
  return self.ambient_source;
}

/**
 * @godot Environment.set_ambient_light_energy
 * @source scene/resources/environment.cpp:166
 */
export function set_ambient_light_energy(self: Environment, value: number): void {
  self.ambient_energy = f32(value);
}

/**
 * @godot Environment.get_ambient_light_energy
 * @source scene/resources/environment.cpp:171
 */
export function get_ambient_light_energy(self: Environment): number {
  return self.ambient_energy;
}

/**
 * Clamped to 0 to 1.
 *
 * @godot Environment.set_ambient_light_sky_contribution
 * @source scene/resources/environment.cpp:175
 */
export function set_ambient_light_sky_contribution(self: Environment, value: number): void {
  self.ambient_sky_contribution = f32(Math.min(Math.max(value, 0), 1));
}

/**
 * @godot Environment.get_ambient_light_sky_contribution
 * @source scene/resources/environment.cpp:182
 */
export function get_ambient_light_sky_contribution(self: Environment): number {
  return self.ambient_sky_contribution;
}

/**
 * @godot Environment.set_reflection_source
 * @source scene/resources/environment.cpp:186
 */
export function set_reflection_source(self: Environment, value: number): void {
  self.reflection_source = value;
}

/**
 * @godot Environment.get_reflection_source
 * @source scene/resources/environment.cpp:192
 */
export function get_reflection_source(self: Environment): number {
  return self.reflection_source;
}

/**
 * @godot Environment.set_tonemapper
 * @source scene/resources/environment.cpp:207
 */
export function set_tonemapper(self: Environment, value: number): void {
  self.tone_mapper = value;
}

/**
 * @godot Environment.get_tonemapper
 * @source scene/resources/environment.cpp:213
 */
export function get_tonemapper(self: Environment): number {
  return self.tone_mapper;
}

/**
 * @godot Environment.set_tonemap_exposure
 * @source scene/resources/environment.cpp:217
 */
export function set_tonemap_exposure(self: Environment, value: number): void {
  self.tonemap_exposure = f32(value);
}

/**
 * @godot Environment.get_tonemap_exposure
 * @source scene/resources/environment.cpp:222
 */
export function get_tonemap_exposure(self: Environment): number {
  return self.tonemap_exposure;
}

/**
 * @godot Environment.set_tonemap_white
 * @source scene/resources/environment.cpp:226
 */
export function set_tonemap_white(self: Environment, value: number): void {
  self.tonemap_white = f32(value);
}

/**
 * @godot Environment.get_tonemap_white
 * @source scene/resources/environment.cpp:231
 */
export function get_tonemap_white(self: Environment): number {
  return self.tonemap_white;
}

/**
 * @godot Environment.set_tonemap_agx_white
 * @source scene/resources/environment.cpp:235
 */
export function set_tonemap_agx_white(self: Environment, value: number): void {
  self.tonemap_agx_white = f32(value);
}

/**
 * @godot Environment.get_tonemap_agx_white
 * @source scene/resources/environment.cpp:240
 */
export function get_tonemap_agx_white(self: Environment): number {
  return self.tonemap_agx_white;
}

/**
 * @godot Environment.set_tonemap_agx_contrast
 * @source scene/resources/environment.cpp:244
 */
export function set_tonemap_agx_contrast(self: Environment, value: number): void {
  self.tonemap_agx_contrast = f32(value);
}

/**
 * @godot Environment.get_tonemap_agx_contrast
 * @source scene/resources/environment.cpp:249
 */
export function get_tonemap_agx_contrast(self: Environment): number {
  return self.tonemap_agx_contrast;
}

/**
 * @godot Environment.set_fog_enabled
 * @source scene/resources/environment.cpp:774
 */
export function set_fog_enabled(self: Environment, value: boolean): void {
  self.fog_enabled = value;
}

/**
 * @godot Environment.is_fog_enabled
 * @source scene/resources/environment.cpp:779
 */
export function is_fog_enabled(self: Environment): boolean {
  return self.fog_enabled;
}

/**
 * @godot Environment.set_fog_light_color
 * @source scene/resources/environment.cpp:798
 */
export function set_fog_light_color(self: Environment, value: Color): void {
  self.fog_light_color = value;
}

/**
 * @godot Environment.get_fog_light_color
 * @source scene/resources/environment.cpp:802
 */
export function get_fog_light_color(self: Environment): Color {
  return self.fog_light_color;
}

/**
 * @godot Environment.set_fog_light_energy
 * @source scene/resources/environment.cpp:805
 */
export function set_fog_light_energy(self: Environment, value: number): void {
  self.fog_light_energy = f32(value);
}

/**
 * @godot Environment.get_fog_light_energy
 * @source scene/resources/environment.cpp:809
 */
export function get_fog_light_energy(self: Environment): number {
  return self.fog_light_energy;
}

/**
 * @godot Environment.set_fog_sun_scatter
 * @source scene/resources/environment.cpp:812
 */
export function set_fog_sun_scatter(self: Environment, value: number): void {
  self.fog_sun_scatter = f32(value);
}

/**
 * @godot Environment.get_fog_sun_scatter
 * @source scene/resources/environment.cpp:816
 */
export function get_fog_sun_scatter(self: Environment): number {
  return self.fog_sun_scatter;
}

/**
 * @godot Environment.set_fog_density
 * @source scene/resources/environment.cpp:819
 */
export function set_fog_density(self: Environment, value: number): void {
  self.fog_density = f32(value);
}

/**
 * @godot Environment.get_fog_density
 * @source scene/resources/environment.cpp:823
 */
export function get_fog_density(self: Environment): number {
  return self.fog_density;
}

/**
 * @godot Environment.set_fog_height
 * @source scene/resources/environment.cpp:826
 */
export function set_fog_height(self: Environment, value: number): void {
  self.fog_height = f32(value);
}

/**
 * @godot Environment.get_fog_height
 * @source scene/resources/environment.cpp:830
 */
export function get_fog_height(self: Environment): number {
  return self.fog_height;
}

/**
 * @godot Environment.set_fog_height_density
 * @source scene/resources/environment.cpp:833
 */
export function set_fog_height_density(self: Environment, value: number): void {
  self.fog_height_density = f32(value);
}

/**
 * @godot Environment.get_fog_height_density
 * @source scene/resources/environment.cpp:837
 */
export function get_fog_height_density(self: Environment): number {
  return self.fog_height_density;
}

/**
 * @godot Environment.set_fog_sky_affect
 * @source scene/resources/environment.cpp:849
 */
export function set_fog_sky_affect(self: Environment, value: number): void {
  self.fog_sky_affect = f32(value);
}

/**
 * @godot Environment.get_fog_sky_affect
 * @source scene/resources/environment.cpp:854
 */
export function get_fog_sky_affect(self: Environment): number {
  return self.fog_sky_affect;
}

/**
 * Switching to another mode resets the density: 0.01 when switching to exponential, else 1.0 (the
 * else branch also takes exponential chosen again).
 *
 * @godot Environment.set_fog_mode
 * @source scene/resources/environment.cpp:783
 */
export function set_fog_mode(self: Environment, mode: number): void {
  if (self.fog_mode !== mode && mode === 0) set_fog_density(self, 0.01);
  else set_fog_density(self, 1.0);
  self.fog_mode = mode;
}

/**
 * @godot Environment.get_fog_mode
 * @source scene/resources/environment.cpp:794
 */
export function get_fog_mode(self: Environment): number {
  return self.fog_mode;
}

/** The properties a scene states, by the setter each calls (camelCase Godot names). */
const PROPS: ReadonlyMap<string, (self: Environment, value: never) => void> = new Map<string, (self: Environment, value: never) => void>([
  ['backgroundMode', (self, value: number) => set_background(self, value)],
  ['backgroundColor', (self, value: readonly [number, number, number, number]) => set_bg_color(self, color(...value))],
  ['backgroundEnergyMultiplier', (self, value: number) => set_bg_energy_multiplier(self, value)],
  ['sky', (self, value: Sky | null) => set_sky(self, value)],
  ['ambientLightColor', (self, value: readonly [number, number, number, number]) => set_ambient_light_color(self, color(...value))],
  ['ambientLightSource', (self, value: number) => set_ambient_source(self, value)],
  ['ambientLightEnergy', (self, value: number) => set_ambient_light_energy(self, value)],
  ['ambientLightSkyContribution', (self, value: number) => set_ambient_light_sky_contribution(self, value)],
  ['reflectedLightSource', (self, value: number) => set_reflection_source(self, value)],
  ['tonemapMode', (self, value: number) => set_tonemapper(self, value)],
  ['tonemapExposure', (self, value: number) => set_tonemap_exposure(self, value)],
  ['tonemapWhite', (self, value: number) => set_tonemap_white(self, value)],
  ['tonemapAgxWhite', (self, value: number) => set_tonemap_agx_white(self, value)],
  ['tonemapAgxContrast', (self, value: number) => set_tonemap_agx_contrast(self, value)],
  ['fogEnabled', (self, value: boolean) => set_fog_enabled(self, value)],
  ['fogLightColor', (self, value: readonly [number, number, number, number]) => set_fog_light_color(self, color(...value))],
  ['fogLightEnergy', (self, value: number) => set_fog_light_energy(self, value)],
  ['fogSunScatter', (self, value: number) => set_fog_sun_scatter(self, value)],
  ['fogDensity', (self, value: number) => set_fog_density(self, value)],
  ['fogHeight', (self, value: number) => set_fog_height(self, value)],
  ['fogHeightDensity', (self, value: number) => set_fog_height_density(self, value)],
  ['fogSkyAffect', (self, value: number) => set_fog_sky_affect(self, value)],
  ['fogMode', (self, value: number) => set_fog_mode(self, value)],
  ['glowEnabled', (self, value: boolean) => set_glow_enabled(self, value)],
  ['glowIntensity', (self, value: number) => set_glow_intensity(self, value)],
  ['glowBloom', (self, value: number) => set_glow_bloom(self, value)],
  ['glowHdrThreshold', (self, value: number) => set_glow_hdr_bleed_threshold(self, value)],
  ['glowHdrScale', (self, value: number) => set_glow_hdr_bleed_scale(self, value)],
  ['glowHdrLuminanceCap', (self, value: number) => set_glow_hdr_luminance_cap(self, value)],
  ['ssaoEnabled', (self, value: boolean) => set_ssao_enabled(self, value)],
  ['ssaoRadius', (self, value: number) => set_ssao_radius(self, value)],
  ['ssaoIntensity', (self, value: number) => set_ssao_intensity(self, value)],
  ['adjustmentEnabled', (self, value: boolean) => set_adjustment_enabled(self, value)],
  ['adjustmentBrightness', (self, value: number) => set_adjustment_brightness(self, value)],
  ['adjustmentContrast', (self, value: number) => set_adjustment_contrast(self, value)],
  ['adjustmentSaturation', (self, value: number) => set_adjustment_saturation(self, value)],
  ['ssaoPower', (self, value: number) => set_ssao_power(self, value)],
  ['ssaoHorizon', (self, value: number) => set_ssao_horizon(self, value)],
  ['sdfgiCascades', (self, value: number) => set_sdfgi_cascades(self, value)],
  ['sdfgiEnergy', (self, value: number) => set_sdfgi_energy(self, value)],
  // `glow_levels/N` is the level N - 1 (`environment.cpp:1464`).
  ...[1, 2, 3, 4, 5, 6, 7].map((n): [string, (self: Environment, value: never) => void] => [`glowLevels${String(n)}`, (self, value: number) => set_glow_level(self, n - 1, value)]),
]);


// --- The post pass's parameters: drawn by `post-effects.ts` as the Compatibility renderer's post pass.

/**
 * @godot Environment.set_glow_enabled
 * @source scene/resources/environment.cpp:608
 */
export function set_glow_enabled(self: Environment, value: boolean): void {
  self.glow_enabled = Boolean(value);
}

/**
 * @godot Environment.is_glow_enabled
 * @source scene/resources/environment.cpp:613
 */
export function is_glow_enabled(self: Environment): boolean {
  return self.glow_enabled;
}

/**
 * @godot Environment.set_glow_intensity
 * @source scene/resources/environment.cpp:641
 */
export function set_glow_intensity(self: Environment, value: number): void {
  self.glow_intensity = f32(value);
}

/**
 * @godot Environment.get_glow_intensity
 * @source scene/resources/environment.cpp:646
 */
export function get_glow_intensity(self: Environment): number {
  return self.glow_intensity;
}

/**
 * @godot Environment.set_glow_bloom
 * @source scene/resources/environment.cpp:668
 */
export function set_glow_bloom(self: Environment, value: number): void {
  self.glow_bloom = f32(value);
}

/**
 * @godot Environment.get_glow_bloom
 * @source scene/resources/environment.cpp:673
 */
export function get_glow_bloom(self: Environment): number {
  return self.glow_bloom;
}

/**
 * @godot Environment.set_glow_hdr_bleed_threshold
 * @source scene/resources/environment.cpp:687
 */
export function set_glow_hdr_bleed_threshold(self: Environment, value: number): void {
  self.glow_hdr_bleed_threshold = f32(value);
}

/**
 * @godot Environment.get_glow_hdr_bleed_threshold
 * @source scene/resources/environment.cpp:692
 */
export function get_glow_hdr_bleed_threshold(self: Environment): number {
  return self.glow_hdr_bleed_threshold;
}

/**
 * @godot Environment.set_glow_hdr_bleed_scale
 * @source scene/resources/environment.cpp:696
 */
export function set_glow_hdr_bleed_scale(self: Environment, value: number): void {
  self.glow_hdr_bleed_scale = f32(value);
}

/**
 * @godot Environment.get_glow_hdr_bleed_scale
 * @source scene/resources/environment.cpp:701
 */
export function get_glow_hdr_bleed_scale(self: Environment): number {
  return self.glow_hdr_bleed_scale;
}

/**
 * @godot Environment.set_glow_hdr_luminance_cap
 * @source scene/resources/environment.cpp:705
 */
export function set_glow_hdr_luminance_cap(self: Environment, value: number): void {
  self.glow_hdr_luminance_cap = f32(value);
}

/**
 * @godot Environment.get_glow_hdr_luminance_cap
 * @source scene/resources/environment.cpp:710
 */
export function get_glow_hdr_luminance_cap(self: Environment): number {
  return self.glow_hdr_luminance_cap;
}

/**
 * @godot Environment.set_ssao_enabled
 * @source scene/resources/environment.cpp:320
 */
export function set_ssao_enabled(self: Environment, value: boolean): void {
  self.ssao_enabled = Boolean(value);
}

/**
 * @godot Environment.is_ssao_enabled
 * @source scene/resources/environment.cpp:325
 */
export function is_ssao_enabled(self: Environment): boolean {
  return self.ssao_enabled;
}

/**
 * @godot Environment.set_ssao_radius
 * @source scene/resources/environment.cpp:329
 */
export function set_ssao_radius(self: Environment, value: number): void {
  self.ssao_radius = f32(value);
}

/**
 * @godot Environment.get_ssao_radius
 * @source scene/resources/environment.cpp:334
 */
export function get_ssao_radius(self: Environment): number {
  return self.ssao_radius;
}

/**
 * @godot Environment.set_ssao_intensity
 * @source scene/resources/environment.cpp:338
 */
export function set_ssao_intensity(self: Environment, value: number): void {
  self.ssao_intensity = f32(value);
}

/**
 * @godot Environment.get_ssao_intensity
 * @source scene/resources/environment.cpp:343
 */
export function get_ssao_intensity(self: Environment): number {
  return self.ssao_intensity;
}

/**
 * @godot Environment.set_adjustment_enabled
 * @source scene/resources/environment.cpp:1037
 */
export function set_adjustment_enabled(self: Environment, value: boolean): void {
  self.adjustment_enabled = Boolean(value);
}

/**
 * @godot Environment.is_adjustment_enabled
 * @source scene/resources/environment.cpp:1042
 */
export function is_adjustment_enabled(self: Environment): boolean {
  return self.adjustment_enabled;
}

/**
 * @godot Environment.set_adjustment_brightness
 * @source scene/resources/environment.cpp:1046
 */
export function set_adjustment_brightness(self: Environment, value: number): void {
  self.adjustment_brightness = f32(value);
}

/**
 * @godot Environment.get_adjustment_brightness
 * @source scene/resources/environment.cpp:1051
 */
export function get_adjustment_brightness(self: Environment): number {
  return self.adjustment_brightness;
}

/**
 * @godot Environment.set_adjustment_contrast
 * @source scene/resources/environment.cpp:1055
 */
export function set_adjustment_contrast(self: Environment, value: number): void {
  self.adjustment_contrast = f32(value);
}

/**
 * @godot Environment.get_adjustment_contrast
 * @source scene/resources/environment.cpp:1060
 */
export function get_adjustment_contrast(self: Environment): number {
  return self.adjustment_contrast;
}

/**
 * @godot Environment.set_adjustment_saturation
 * @source scene/resources/environment.cpp:1064
 */
export function set_adjustment_saturation(self: Environment, value: number): void {
  self.adjustment_saturation = f32(value);
}

/**
 * @godot Environment.get_adjustment_saturation
 * @source scene/resources/environment.cpp:1069
 */
export function get_adjustment_saturation(self: Environment): number {
  return self.adjustment_saturation;
}

// --- Parameters the Compatibility renderer (the web's) never reads: stored and read back, drawing
// nothing. Its SSAO pass reads only the intensity and radius (`rasterizer_scene_gles3.cpp:2996`);
// its glow is fixed levels (`drivers/gles3/effects/glow.cpp`), never the environment's; its SDFGI
// update is empty (`rasterizer_scene_gles3.h:882`).

/**
 * @godot Environment.set_ssao_power
 * @source scene/resources/environment.cpp:347
 */
export function set_ssao_power(self: Environment, power: number): void {
  self.ssao_power = f32(power);
}

/**
 * @godot Environment.get_ssao_power
 * @source scene/resources/environment.cpp:352
 */
export function get_ssao_power(self: Environment): number {
  return self.ssao_power;
}

/**
 * @godot Environment.set_ssao_horizon
 * @source scene/resources/environment.cpp:365
 */
export function set_ssao_horizon(self: Environment, horizon: number): void {
  self.ssao_horizon = f32(horizon);
}

/**
 * @godot Environment.get_ssao_horizon
 * @source scene/resources/environment.cpp:370
 */
export function get_ssao_horizon(self: Environment): number {
  return self.ssao_horizon;
}

/**
 * An index outside the seven levels changes nothing (`ERR_FAIL_INDEX`).
 *
 * @godot Environment.set_glow_level
 * @source scene/resources/environment.cpp:617
 */
export function set_glow_level(self: Environment, level: number, intensity: number): void {
  if (!Number.isInteger(level) || level < 0 || level >= self.glow_levels.length) return;
  self.glow_levels[level] = f32(intensity);
}

/**
 * An index outside the seven levels reads 0 (`ERR_FAIL_INDEX_V`).
 *
 * @godot Environment.get_glow_level
 * @source scene/resources/environment.cpp:625
 */
export function get_glow_level(self: Environment, level: number): number {
  return Number.isInteger(level) && level >= 0 && level < self.glow_levels.length ? (self.glow_levels[level] as number) : 0;
}

/**
 * A count outside 1 to 8 changes nothing (`ERR_FAIL_COND_MSG`).
 *
 * @godot Environment.set_sdfgi_cascades
 * @source scene/resources/environment.cpp:483
 */
export function set_sdfgi_cascades(self: Environment, cascades: number): void {
  if (cascades < 1 || cascades > 8) return;
  self.sdfgi_cascades = cascades;
}

/**
 * @godot Environment.get_sdfgi_cascades
 * @source scene/resources/environment.cpp:489
 */
export function get_sdfgi_cascades(self: Environment): number {
  return self.sdfgi_cascades;
}

/**
 * @godot Environment.set_sdfgi_energy
 * @source scene/resources/environment.cpp:564
 */
export function set_sdfgi_energy(self: Environment, energy: number): void {
  self.sdfgi_energy = f32(energy);
}

/**
 * @godot Environment.get_sdfgi_energy
 * @source scene/resources/environment.cpp:569
 */
export function get_sdfgi_energy(self: Environment): number {
  return self.sdfgi_energy;
}

/**
 * An Environment of the properties a scene states, set in the order given; an unknown one fails
 * by name.
 *
 * @godot Environment (protocol)
 * @source scene/resources/environment.cpp:1637
 */
export function godot_environment_new(properties: Readonly<Record<string, unknown>> = {}): Environment {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    const set = PROPS.get(property);
    if (set === undefined) throw new Error(`godot-compat: Environment has no ${property} property.`);
    (set as (self: Environment, value: unknown) => void)(self, value);
  }
  return self;
}

/** The tone mapper's parameters (`TonemapParameters`), four floats, and its white. */
export interface GodotTonemapParameters {
  readonly white: number;
  readonly params: readonly [number, number, number, number];
}

/**
 * The tone mapper's white (`environment_get_white`, `environment_storage.cpp:230`) and parameters
 * (`environment_get_tonemap_parameters`, `:276`) as the Compatibility renderer asks for them: SDR,
 * output max 1, AgX white not limited (`rasterizer_scene_gles3.cpp:2515`). Computed in binary32.
 *
 * @godot Environment (protocol)
 * @source servers/rendering/storage/environment_storage.cpp:276
 */
export function godot_environment_tonemap_parameters(self: Environment): GodotTonemapParameters {
  const outputMax = 1;
  const mapper = self.tone_mapper;
  const envWhite = mapper === 4 ? self.tonemap_agx_white : self.tonemap_white;
  let white: number;
  if (mapper === 0) white = outputMax;
  else if (mapper === 2 || mapper === 3) white = Math.max(1, envWhite);
  else if (mapper === 4) white = f32(Math.max(2, envWhite) * outputMax);
  else white = Math.max(outputMax, envWhite);
  const params: [number, number, number, number] = [0, 0, 0, 0];
  if (mapper === 1) {
    params[0] = f32(f32(white * white) / outputMax);
  } else if (mapper === 2) {
    const bias = 2;
    const A = f32(f32(f32(0.22) * bias) * bias);
    const B = f32(f32(0.3) * bias);
    const C = f32(0.1);
    const D = f32(0.2);
    const E = f32(0.01);
    const F = f32(0.3);
    params[0] = f32(
      f32(f32(f32(white * f32(f32(A * white) + f32(C * B))) + f32(D * E)) / f32(f32(white * f32(f32(A * white) + B)) + f32(D * F))) - f32(E / F),
    );
  } else if (mapper === 3) {
    const A = f32(0.0245786);
    const B = f32(0.000090537);
    const C = f32(0.983729);
    const D = f32(0.432951);
    const E = f32(0.238081);
    const w = f32(white * f32(1.8));
    params[0] = f32(f32(f32(w * f32(w + A)) - B) / f32(f32(w * f32(f32(C * w) + D)) + E));
  } else if (mapper === 4) {
    const crossover = f32(0.18);
    const shoulderMax = f32(outputMax - crossover);
    const contrast = self.tonemap_agx_contrast;
    // `(1.0 / awp_crossover_point) - 1.0` is double arithmetic on a float, then float.
    const toeA = f32((1.0 / crossover - 1.0) * f32(Math.pow(crossover, contrast)));
    const denom = f32(f32(Math.pow(crossover, contrast)) + toeA);
    const slope = f32(f32(f32(contrast * f32(Math.pow(crossover, contrast - 1.0))) * toeA) / f32(denom * denom));
    let w = f32(white - crossover);
    w = f32(w * w);
    w = f32(w / shoulderMax);
    w = f32(w * slope);
    params[0] = contrast;
    params[1] = toeA;
    params[2] = slope;
    params[3] = w;
  }
  return { white, params };
}
