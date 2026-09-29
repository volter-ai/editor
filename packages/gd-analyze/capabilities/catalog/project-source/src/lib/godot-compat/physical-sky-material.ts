/**
 * @godot-class PhysicalSkyMaterial
 * @role BINDING
 *
 * Godot 4.7's `PhysicalSkyMaterial` (`scene/resources/3d/sky_material.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a material whose shader the class generates itself,
 * one per `use_debanding` and night sky (`_update_shader`, `sky_material.cpp:732`). The import
 * captures the four generated texts from the pinned Godot and lowers them through the same shader
 * frontend as a `.gdshader`; this binding holds them and draws the one its properties select, and
 * its setters write the generated shader's parameters as the class does, so the sky draws it as any
 * sky `ShaderMaterial` (`world-environment.ts`). `exposure_value` (physical light units) is not
 * bound.
 */

import type { Texture } from 'three';
import { type Color, construct as color } from './color';
import type { Shader } from './shader';
import { type ShaderMaterial, set_shader, set_shader_parameter } from './shader-material';

const f32 = Math.fround;

/** The generated shaders by the `use_debanding` and night-sky values that select each (`:645`). */
export interface GodotPhysicalSkyShaders {
  readonly debanding0Night0: Shader;
  readonly debanding1Night0: Shader;
  readonly debanding0Night1: Shader;
  readonly debanding1Night1: Shader;
}

export interface PhysicalSkyMaterial extends ShaderMaterial {
  rayleigh: number;
  mie: number;
  mie_eccentricity: number;
  turbidity: number;
  sun_disk_scale: number;
  energy_multiplier: number;
  rayleigh_color: Color;
  mie_color: Color;
  ground_color: Color;
  use_debanding: boolean;
  night_sky: Texture | null;
  readonly shaders: GodotPhysicalSkyShaders;
}

function selectShader(self: PhysicalSkyMaterial): void {
  const key = `debanding${self.use_debanding ? 1 : 0}Night${self.night_sky !== null ? 1 : 0}` as keyof GodotPhysicalSkyShaders;
  set_shader(self, self.shaders[key]);
}

/**
 * @godot PhysicalSkyMaterial.set_rayleigh_coefficient
 * @source scene/resources/3d/sky_material.cpp:524
 */
export function set_rayleigh_coefficient(self: PhysicalSkyMaterial, value: number): void {
  self.rayleigh = f32(value);
  set_shader_parameter(self, 'rayleigh', self.rayleigh);
}

/**
 * @godot PhysicalSkyMaterial.get_rayleigh_coefficient
 * @source scene/resources/3d/sky_material.cpp:529
 */
export function get_rayleigh_coefficient(self: PhysicalSkyMaterial): number {
  return self.rayleigh;
}

/**
 * @godot PhysicalSkyMaterial.set_mie_coefficient
 * @source scene/resources/3d/sky_material.cpp:542
 */
export function set_mie_coefficient(self: PhysicalSkyMaterial, value: number): void {
  self.mie = f32(value);
  set_shader_parameter(self, 'mie', self.mie);
}

/**
 * @godot PhysicalSkyMaterial.get_mie_coefficient
 * @source scene/resources/3d/sky_material.cpp:547
 */
export function get_mie_coefficient(self: PhysicalSkyMaterial): number {
  return self.mie;
}

/**
 * @godot PhysicalSkyMaterial.set_mie_eccentricity
 * @source scene/resources/3d/sky_material.cpp:551
 */
export function set_mie_eccentricity(self: PhysicalSkyMaterial, value: number): void {
  self.mie_eccentricity = f32(value);
  set_shader_parameter(self, 'mie_eccentricity', self.mie_eccentricity);
}

/**
 * @godot PhysicalSkyMaterial.get_mie_eccentricity
 * @source scene/resources/3d/sky_material.cpp:556
 */
export function get_mie_eccentricity(self: PhysicalSkyMaterial): number {
  return self.mie_eccentricity;
}

/**
 * @godot PhysicalSkyMaterial.set_turbidity
 * @source scene/resources/3d/sky_material.cpp:569
 */
export function set_turbidity(self: PhysicalSkyMaterial, value: number): void {
  self.turbidity = f32(value);
  set_shader_parameter(self, 'turbidity', self.turbidity);
}

/**
 * @godot PhysicalSkyMaterial.get_turbidity
 * @source scene/resources/3d/sky_material.cpp:574
 */
export function get_turbidity(self: PhysicalSkyMaterial): number {
  return self.turbidity;
}

/**
 * @godot PhysicalSkyMaterial.set_sun_disk_scale
 * @source scene/resources/3d/sky_material.cpp:578
 */
export function set_sun_disk_scale(self: PhysicalSkyMaterial, value: number): void {
  self.sun_disk_scale = f32(value);
  set_shader_parameter(self, 'sun_disk_scale', self.sun_disk_scale);
}

/**
 * @godot PhysicalSkyMaterial.get_sun_disk_scale
 * @source scene/resources/3d/sky_material.cpp:583
 */
export function get_sun_disk_scale(self: PhysicalSkyMaterial): number {
  return self.sun_disk_scale;
}

/**
 * @godot PhysicalSkyMaterial.set_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:596
 */
export function set_energy_multiplier(self: PhysicalSkyMaterial, value: number): void {
  self.energy_multiplier = f32(value);
  set_shader_parameter(self, 'exposure', self.energy_multiplier);
}

/**
 * @godot PhysicalSkyMaterial.get_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:601
 */
export function get_energy_multiplier(self: PhysicalSkyMaterial): number {
  return self.energy_multiplier;
}

/**
 * @godot PhysicalSkyMaterial.set_rayleigh_color
 * @source scene/resources/3d/sky_material.cpp:533
 */
export function set_rayleigh_color(self: PhysicalSkyMaterial, value: Color): void {
  self.rayleigh_color = value;
  set_shader_parameter(self, 'rayleigh_color', value);
}

/**
 * @godot PhysicalSkyMaterial.get_rayleigh_color
 * @source scene/resources/3d/sky_material.cpp:538
 */
export function get_rayleigh_color(self: PhysicalSkyMaterial): Color {
  return self.rayleigh_color;
}

/**
 * @godot PhysicalSkyMaterial.set_mie_color
 * @source scene/resources/3d/sky_material.cpp:560
 */
export function set_mie_color(self: PhysicalSkyMaterial, value: Color): void {
  self.mie_color = value;
  set_shader_parameter(self, 'mie_color', value);
}

/**
 * @godot PhysicalSkyMaterial.get_mie_color
 * @source scene/resources/3d/sky_material.cpp:565
 */
export function get_mie_color(self: PhysicalSkyMaterial): Color {
  return self.mie_color;
}

/**
 * @godot PhysicalSkyMaterial.set_ground_color
 * @source scene/resources/3d/sky_material.cpp:587
 */
export function set_ground_color(self: PhysicalSkyMaterial, value: Color): void {
  self.ground_color = value;
  set_shader_parameter(self, 'ground_color', value);
}

/**
 * @godot PhysicalSkyMaterial.get_ground_color
 * @source scene/resources/3d/sky_material.cpp:592
 */
export function get_ground_color(self: PhysicalSkyMaterial): Color {
  return self.ground_color;
}

/**
 * Selects the generated shader for the value.
 *
 * @godot PhysicalSkyMaterial.set_use_debanding
 * @source scene/resources/3d/sky_material.cpp:605
 */
export function set_use_debanding(self: PhysicalSkyMaterial, value: boolean): void {
  self.use_debanding = value;
  selectShader(self);
}

/**
 * @godot PhysicalSkyMaterial.get_use_debanding
 * @source scene/resources/3d/sky_material.cpp:614
 */
export function get_use_debanding(self: PhysicalSkyMaterial): boolean {
  return self.use_debanding;
}

/**
 * Selects the generated shader for a night sky or none.
 *
 * @godot PhysicalSkyMaterial.set_night_sky
 * @source scene/resources/3d/sky_material.cpp:618
 */
export function set_night_sky(self: PhysicalSkyMaterial, value: Texture | null): void {
  self.night_sky = value;
  set_shader_parameter(self, 'night_sky', value);
  selectShader(self);
}

/**
 * @godot PhysicalSkyMaterial.get_night_sky
 * @source scene/resources/3d/sky_material.cpp:633
 */
export function get_night_sky(self: PhysicalSkyMaterial): Texture | null {
  return self.night_sky;
}

/**
 * A material at the values its constructor sets, in its order (`sky_material.cpp:827`).
 *
 * @godot PhysicalSkyMaterial (protocol)
 * @source scene/resources/3d/sky_material.cpp:827
 */
export function construct(shaders: GodotPhysicalSkyShaders): PhysicalSkyMaterial {
  const black = color(0, 0, 0, 1);
  const self: PhysicalSkyMaterial = {
    shader: null,
    renderPriority: 0,
    parameters: new Map(),
    listeners: new Set(),
    rayleigh: 0,
    mie: 0,
    mie_eccentricity: 0,
    turbidity: 0,
    sun_disk_scale: 0,
    energy_multiplier: 1,
    rayleigh_color: black,
    mie_color: black,
    ground_color: black,
    use_debanding: true,
    night_sky: null,
    shaders,
  };
  set_rayleigh_coefficient(self, 2);
  set_rayleigh_color(self, color(0.3, 0.405, 0.6));
  set_mie_coefficient(self, 0.005);
  set_mie_eccentricity(self, 0.8);
  set_mie_color(self, color(0.69, 0.729, 0.812));
  set_turbidity(self, 10);
  set_sun_disk_scale(self, 1);
  set_ground_color(self, color(0.1, 0.07, 0.034));
  set_energy_multiplier(self, 1);
  set_use_debanding(self, true);
  return self;
}

const SETTERS: Readonly<Record<string, (self: PhysicalSkyMaterial, value: never) => void>> = {
  rayleighCoefficient: set_rayleigh_coefficient,
  rayleighColor: (self, value: readonly [number, number, number, number]) => set_rayleigh_color(self, color(...value)),
  mieCoefficient: set_mie_coefficient,
  mieEccentricity: set_mie_eccentricity,
  mieColor: (self, value: readonly [number, number, number, number]) => set_mie_color(self, color(...value)),
  turbidity: set_turbidity,
  sunDiskScale: set_sun_disk_scale,
  groundColor: (self, value: readonly [number, number, number, number]) => set_ground_color(self, color(...value)),
  energyMultiplier: set_energy_multiplier,
  useDebanding: set_use_debanding,
  nightSky: set_night_sky,
};

/**
 * A PhysicalSkyMaterial of its four generated shaders and the properties a scene states (a colour as
 * its components), set in the order given; an unknown one fails by name.
 *
 * @godot PhysicalSkyMaterial (protocol)
 * @source scene/resources/3d/sky_material.cpp:827
 */
export function godot_physical_sky_material_new(
  shaders: GodotPhysicalSkyShaders,
  properties: Readonly<Record<string, unknown>> = {},
): PhysicalSkyMaterial {
  const self = construct(shaders);
  for (const [property, value] of Object.entries(properties)) {
    const setter = SETTERS[property];
    if (setter === undefined) throw new Error(`godot-compat: PhysicalSkyMaterial has no ${property} property.`);
    setter(self, value as never);
  }
  return self;
}
