/**
 * @godot-class ProceduralSkyMaterial
 * @role BINDING
 *
 * Godot 4.7's `ProceduralSkyMaterial` (`scene/resources/3d/sky_material.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a material whose shader the class generates itself,
 * one per `use_debanding` and sky cover (`_update_shader`, `sky_material.cpp:300`). The import
 * captures the four generated texts from the pinned Godot and lowers them through the same shader
 * frontend as a `.gdshader`; this binding holds them and draws the one its properties select, and
 * its setters write the generated shader's parameters as the class does (colours times their
 * energy, the curves' ad hoc inverses, the sun's maximum angle as a cosine), so the sky draws it as
 * any sky `ShaderMaterial` (`world-environment.ts`).
 */

import type { Texture } from 'three';
import { type Color, construct as color } from './color';
import type { Shader } from './shader';
import { type ShaderMaterial, set_shader, set_shader_parameter } from './shader-material';

const f32 = Math.fround;

/** The generated shaders by the `use_debanding` and sky-cover values that select each (`:199`). */
export interface GodotProceduralSkyShaders {
  readonly debanding0Cover0: Shader;
  readonly debanding1Cover0: Shader;
  readonly debanding0Cover1: Shader;
  readonly debanding1Cover1: Shader;
}

export interface ProceduralSkyMaterial extends ShaderMaterial {
  sky_top_color: Color;
  sky_horizon_color: Color;
  sky_curve: number;
  sky_energy_multiplier: number;
  sky_cover: Texture | null;
  sky_cover_modulate: Color;
  ground_bottom_color: Color;
  ground_horizon_color: Color;
  ground_curve: number;
  ground_energy_multiplier: number;
  sun_angle_max: number;
  sun_curve: number;
  use_debanding: boolean;
  energy_multiplier: number;
  readonly shaders: GodotProceduralSkyShaders;
}

/** `Color * float` (`color.h:327`): every component, alpha included, in float. */
function scaled(c: Color, s: number): Color {
  return color(f32(c.r * s), f32(c.g * s), f32(c.b * s), f32(c.a * s));
}

/** `Math::deg_to_rad(float)` (`math_funcs.h:324`). */
function degToRad(degrees: number): number {
  return f32(degrees * f32(f32(Math.PI) / 180));
}

function selectShader(self: ProceduralSkyMaterial): void {
  const key = `debanding${self.use_debanding ? 1 : 0}Cover${self.sky_cover !== null ? 1 : 0}` as keyof GodotProceduralSkyShaders;
  set_shader(self, self.shaders[key]);
}

/**
 * @godot ProceduralSkyMaterial.set_sky_top_color
 * @source scene/resources/3d/sky_material.cpp:43
 */
export function set_sky_top_color(self: ProceduralSkyMaterial, value: Color): void {
  self.sky_top_color = value;
  set_shader_parameter(self, 'sky_top_color', scaled(value, self.sky_energy_multiplier));
}

/**
 * @godot ProceduralSkyMaterial.get_sky_top_color
 * @source scene/resources/3d/sky_material.cpp:48
 */
export function get_sky_top_color(self: ProceduralSkyMaterial): Color {
  return self.sky_top_color;
}

/**
 * @godot ProceduralSkyMaterial.set_sky_horizon_color
 * @source scene/resources/3d/sky_material.cpp:52
 */
export function set_sky_horizon_color(self: ProceduralSkyMaterial, value: Color): void {
  self.sky_horizon_color = value;
  set_shader_parameter(self, 'sky_horizon_color', scaled(value, self.sky_energy_multiplier));
}

/**
 * @godot ProceduralSkyMaterial.get_sky_horizon_color
 * @source scene/resources/3d/sky_material.cpp:57
 */
export function get_sky_horizon_color(self: ProceduralSkyMaterial): Color {
  return self.sky_horizon_color;
}

/**
 * The shader's `inv_sky_curve` is `0.6 / curve` in double, stored as float.
 *
 * @godot ProceduralSkyMaterial.set_sky_curve
 * @source scene/resources/3d/sky_material.cpp:61
 */
export function set_sky_curve(self: ProceduralSkyMaterial, value: number): void {
  self.sky_curve = f32(value);
  set_shader_parameter(self, 'inv_sky_curve', f32(0.6 / self.sky_curve));
}

/**
 * @godot ProceduralSkyMaterial.get_sky_curve
 * @source scene/resources/3d/sky_material.cpp:68
 */
export function get_sky_curve(self: ProceduralSkyMaterial): number {
  return self.sky_curve;
}

/**
 * @godot ProceduralSkyMaterial.set_sky_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:72
 */
export function set_sky_energy_multiplier(self: ProceduralSkyMaterial, value: number): void {
  self.sky_energy_multiplier = f32(value);
  set_shader_parameter(self, 'sky_top_color', scaled(self.sky_top_color, self.sky_energy_multiplier));
  set_shader_parameter(self, 'sky_horizon_color', scaled(self.sky_horizon_color, self.sky_energy_multiplier));
  const m = self.sky_cover_modulate;
  set_shader_parameter(self, 'sky_cover_modulate', color(m.r, m.g, m.b, f32(m.a * self.sky_energy_multiplier)));
}

/**
 * @godot ProceduralSkyMaterial.get_sky_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:79
 */
export function get_sky_energy_multiplier(self: ProceduralSkyMaterial): number {
  return self.sky_energy_multiplier;
}

/**
 * Selects the generated shader for a cover or none.
 *
 * @godot ProceduralSkyMaterial.set_sky_cover
 * @source scene/resources/3d/sky_material.cpp:83
 */
export function set_sky_cover(self: ProceduralSkyMaterial, value: Texture | null): void {
  self.sky_cover = value;
  set_shader_parameter(self, 'sky_cover', value);
  selectShader(self);
}

/**
 * @godot ProceduralSkyMaterial.get_sky_cover
 * @source scene/resources/3d/sky_material.cpp:99
 */
export function get_sky_cover(self: ProceduralSkyMaterial): Texture | null {
  return self.sky_cover;
}

/**
 * @godot ProceduralSkyMaterial.set_sky_cover_modulate
 * @source scene/resources/3d/sky_material.cpp:103
 */
export function set_sky_cover_modulate(self: ProceduralSkyMaterial, value: Color): void {
  self.sky_cover_modulate = value;
  set_shader_parameter(self, 'sky_cover_modulate', color(value.r, value.g, value.b, f32(value.a * self.sky_energy_multiplier)));
}

/**
 * @godot ProceduralSkyMaterial.get_sky_cover_modulate
 * @source scene/resources/3d/sky_material.cpp:108
 */
export function get_sky_cover_modulate(self: ProceduralSkyMaterial): Color {
  return self.sky_cover_modulate;
}

/**
 * @godot ProceduralSkyMaterial.set_ground_bottom_color
 * @source scene/resources/3d/sky_material.cpp:112
 */
export function set_ground_bottom_color(self: ProceduralSkyMaterial, value: Color): void {
  self.ground_bottom_color = value;
  set_shader_parameter(self, 'ground_bottom_color', scaled(value, self.ground_energy_multiplier));
}

/**
 * @godot ProceduralSkyMaterial.get_ground_bottom_color
 * @source scene/resources/3d/sky_material.cpp:117
 */
export function get_ground_bottom_color(self: ProceduralSkyMaterial): Color {
  return self.ground_bottom_color;
}

/**
 * @godot ProceduralSkyMaterial.set_ground_horizon_color
 * @source scene/resources/3d/sky_material.cpp:121
 */
export function set_ground_horizon_color(self: ProceduralSkyMaterial, value: Color): void {
  self.ground_horizon_color = value;
  set_shader_parameter(self, 'ground_horizon_color', scaled(value, self.ground_energy_multiplier));
}

/**
 * @godot ProceduralSkyMaterial.get_ground_horizon_color
 * @source scene/resources/3d/sky_material.cpp:126
 */
export function get_ground_horizon_color(self: ProceduralSkyMaterial): Color {
  return self.ground_horizon_color;
}

/**
 * The shader's `inv_ground_curve` is `0.6 / curve` in double, stored as float.
 *
 * @godot ProceduralSkyMaterial.set_ground_curve
 * @source scene/resources/3d/sky_material.cpp:130
 */
export function set_ground_curve(self: ProceduralSkyMaterial, value: number): void {
  self.ground_curve = f32(value);
  set_shader_parameter(self, 'inv_ground_curve', f32(0.6 / self.ground_curve));
}

/**
 * @godot ProceduralSkyMaterial.get_ground_curve
 * @source scene/resources/3d/sky_material.cpp:137
 */
export function get_ground_curve(self: ProceduralSkyMaterial): number {
  return self.ground_curve;
}

/**
 * @godot ProceduralSkyMaterial.set_ground_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:141
 */
export function set_ground_energy_multiplier(self: ProceduralSkyMaterial, value: number): void {
  self.ground_energy_multiplier = f32(value);
  set_shader_parameter(self, 'ground_bottom_color', scaled(self.ground_bottom_color, self.ground_energy_multiplier));
  set_shader_parameter(self, 'ground_horizon_color', scaled(self.ground_horizon_color, self.ground_energy_multiplier));
}

/**
 * @godot ProceduralSkyMaterial.get_ground_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:147
 */
export function get_ground_energy_multiplier(self: ProceduralSkyMaterial): number {
  return self.ground_energy_multiplier;
}

/**
 * The shader's `sun_angle_max` is the cosine of the angle (`Math::cos` of the float radians).
 *
 * @godot ProceduralSkyMaterial.set_sun_angle_max
 * @source scene/resources/3d/sky_material.cpp:151
 */
export function set_sun_angle_max(self: ProceduralSkyMaterial, value: number): void {
  self.sun_angle_max = f32(value);
  set_shader_parameter(self, 'sun_angle_max', f32(Math.cos(degToRad(self.sun_angle_max))));
}

/**
 * @godot ProceduralSkyMaterial.get_sun_angle_max
 * @source scene/resources/3d/sky_material.cpp:156
 */
export function get_sun_angle_max(self: ProceduralSkyMaterial): number {
  return self.sun_angle_max;
}

/**
 * The shader's `inv_sun_curve` is `1.6f / Math::pow(curve, 1.4f)` in float.
 *
 * @godot ProceduralSkyMaterial.set_sun_curve
 * @source scene/resources/3d/sky_material.cpp:160
 */
export function set_sun_curve(self: ProceduralSkyMaterial, value: number): void {
  self.sun_curve = f32(value);
  set_shader_parameter(self, 'inv_sun_curve', f32(f32(1.6) / f32(Math.pow(self.sun_curve, f32(1.4)))));
}

/**
 * @godot ProceduralSkyMaterial.get_sun_curve
 * @source scene/resources/3d/sky_material.cpp:167
 */
export function get_sun_curve(self: ProceduralSkyMaterial): number {
  return self.sun_curve;
}

/**
 * Selects the generated shader for the value.
 *
 * @godot ProceduralSkyMaterial.set_use_debanding
 * @source scene/resources/3d/sky_material.cpp:171
 */
export function set_use_debanding(self: ProceduralSkyMaterial, value: boolean): void {
  self.use_debanding = value;
  selectShader(self);
}

/**
 * @godot ProceduralSkyMaterial.get_use_debanding
 * @source scene/resources/3d/sky_material.cpp:180
 */
export function get_use_debanding(self: ProceduralSkyMaterial): boolean {
  return self.use_debanding;
}

/**
 * @godot ProceduralSkyMaterial.set_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:184
 */
export function set_energy_multiplier(self: ProceduralSkyMaterial, value: number): void {
  self.energy_multiplier = f32(value);
  set_shader_parameter(self, 'exposure', self.energy_multiplier);
}

/**
 * @godot ProceduralSkyMaterial.get_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:189
 */
export function get_energy_multiplier(self: ProceduralSkyMaterial): number {
  return self.energy_multiplier;
}

/**
 * A material at the values its constructor sets, in its order (`sky_material.cpp:385`).
 *
 * @godot ProceduralSkyMaterial (protocol)
 * @source scene/resources/3d/sky_material.cpp:385
 */
export function construct(shaders: GodotProceduralSkyShaders): ProceduralSkyMaterial {
  const black = color(0, 0, 0, 1);
  const self: ProceduralSkyMaterial = {
    shader: null,
    parameters: new Map(),
    sky_top_color: black,
    sky_horizon_color: black,
    sky_curve: 0,
    sky_energy_multiplier: 0,
    sky_cover: null,
    sky_cover_modulate: black,
    ground_bottom_color: black,
    ground_horizon_color: black,
    ground_curve: 0,
    ground_energy_multiplier: 0,
    sun_angle_max: 0,
    sun_curve: 0,
    use_debanding: true,
    energy_multiplier: 1,
    shaders,
  };
  set_sky_top_color(self, color(0.385, 0.454, 0.55));
  set_sky_horizon_color(self, color(0.6463, 0.6558, 0.6708));
  set_sky_curve(self, 0.15);
  set_sky_energy_multiplier(self, 1);
  set_sky_cover_modulate(self, color(1, 1, 1));
  set_ground_bottom_color(self, color(0.2, 0.169, 0.133));
  set_ground_horizon_color(self, color(0.6463, 0.6558, 0.6708));
  set_ground_curve(self, 0.02);
  set_ground_energy_multiplier(self, 1);
  set_sun_angle_max(self, 30);
  set_sun_curve(self, 0.15);
  set_use_debanding(self, true);
  set_energy_multiplier(self, 1);
  return self;
}

const SETTERS: Readonly<Record<string, (self: ProceduralSkyMaterial, value: never) => void>> = {
  skyTopColor: (self, value: readonly [number, number, number, number]) => set_sky_top_color(self, color(...value)),
  skyHorizonColor: (self, value: readonly [number, number, number, number]) => set_sky_horizon_color(self, color(...value)),
  skyCurve: set_sky_curve,
  skyEnergyMultiplier: set_sky_energy_multiplier,
  skyCover: set_sky_cover,
  skyCoverModulate: (self, value: readonly [number, number, number, number]) => set_sky_cover_modulate(self, color(...value)),
  groundBottomColor: (self, value: readonly [number, number, number, number]) => set_ground_bottom_color(self, color(...value)),
  groundHorizonColor: (self, value: readonly [number, number, number, number]) => set_ground_horizon_color(self, color(...value)),
  groundCurve: set_ground_curve,
  groundEnergyMultiplier: set_ground_energy_multiplier,
  sunAngleMax: set_sun_angle_max,
  sunCurve: set_sun_curve,
  useDebanding: set_use_debanding,
  energyMultiplier: set_energy_multiplier,
};

/**
 * A ProceduralSkyMaterial of its four generated shaders and the properties a scene states (a colour as
 * its components), set in the order given; an unknown one fails by name.
 *
 * @godot ProceduralSkyMaterial (protocol)
 * @source scene/resources/3d/sky_material.cpp:385
 */
export function godot_procedural_sky_material_new(
  shaders: GodotProceduralSkyShaders,
  properties: Readonly<Record<string, unknown>> = {},
): ProceduralSkyMaterial {
  const self = construct(shaders);
  for (const [property, value] of Object.entries(properties)) {
    const setter = SETTERS[property];
    if (setter === undefined) throw new Error(`godot-compat: ProceduralSkyMaterial has no ${property} property.`);
    setter(self, value as never);
  }
  return self;
}
