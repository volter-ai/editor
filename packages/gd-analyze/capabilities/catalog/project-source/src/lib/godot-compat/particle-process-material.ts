/**
 * @godot-class ParticleProcessMaterial
 * @role BINDING
 *
 * Godot 4.7's `ParticleProcessMaterial` (`scene/resources/particle_process_material.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the parameters its setters store, and the shader
 * parameters (`RenderingServer::material_set_param`) each sets, by the names `init_shaders` gives
 * them (`:45`). The shader itself is the one Godot generated for the material (`_update_shader`,
 * captured by the pinned exporter and lowered; `gpu-particles-3d.ts` runs it), so a setter that
 * would change which shader Godot generates (`_queue_shader_change`: the emission shape, a
 * texture's presence, a particle flag, …) is stored for its getter and refuses once a shader is
 * bound, since no other generated shader is at hand.
 */

import type { Color } from './color';
import { construct as color } from './color';
import { type CurveTexture, godot_curve_texture_ensure_default_setup, godot_curve_texture_pixels } from './curve-texture';
import { type GradientTexture1D, godot_gradient_texture_1d_pixels } from './gradient-texture-1d';
import type { Shader } from './shader';
import type { Vector3 } from './vector3';
import { construct as vector3 } from './vector3';

const f32 = Math.fround;

/** `ParticleProcessMaterial::Parameter` (`particle_process_material.h:50`). */
const PARAM_MAX = 18;
/** `ParticleProcessMaterial::ParticleFlags` (`:73`). */
const PARTICLE_FLAG_MAX = 5;

/** A texture a shader parameter samples: its pixels as the particle pass uploads them. */
export interface GodotParticleTexture {
  /** The texture it is (a `CurveTexture`, a `GradientTexture1D`), for its getter. */
  readonly source: object;
  /** Width, height, format and the texel data (RGBA8 or 32-bit floats). */
  readonly pixels: () => { readonly width: number; readonly height: number; readonly format: 'rgba8' | 'rgbf' | 'rf'; readonly data: Uint8Array | Float32Array };
}

const PARTICLE_TEXTURES = new WeakMap<object, GodotParticleTexture>();

function isCurveTexture(object: object): object is CurveTexture {
  return 'texture_mode' in object && 'curve' in object;
}

/**
 * A texture as the particle pass samples it: a `CurveTexture`'s float image, a `GradientTexture1D`'s
 * RGBA8 bytes; another class is not sampled and fails by name.
 */
function particleTexture(texture: unknown): GodotParticleTexture | null {
  if (texture === null || texture === undefined) return null;
  const object = texture as object;
  const known = PARTICLE_TEXTURES.get(object);
  if (known !== undefined) return known;
  let made: GodotParticleTexture;
  if (isCurveTexture(object)) {
    made = { source: object, pixels: () => godot_curve_texture_pixels(object as CurveTexture) };
  } else if ('gradient' in object && 'use_hdr' in object) {
    made = { source: object, pixels: () => ({ width: (object as GradientTexture1D).width, height: 1, format: 'rgba8', data: godot_gradient_texture_1d_pixels(object as GradientTexture1D) }) };
  } else {
    throw new Error('godot-compat: a ParticleProcessMaterial samples only CurveTexture and GradientTexture1D textures here.');
  }
  PARTICLE_TEXTURES.set(object, made);
  return made;
}

/** A shader parameter's value: a float or vector, or a texture. */
export type GodotShaderParameter = number | readonly number[] | GodotParticleTexture | null;

/** The material's shader as the particle pass runs it (`gpu-particles-3d.ts`). */
export interface GodotParticlesShader {
  /** `uniform <type> godot_u_<name>;`, in the shader's order, with the shader's own default. */
  readonly uniforms: readonly { readonly name: string; readonly glsl: string; readonly type: string; readonly default: readonly number[] | null }[];
  readonly functions: string;
  readonly start: string;
  readonly process: string;
  /** The defines the shader's render modes and built-in usage set (`DISABLE_VELOCITY`, `USERDATA1_USED`). */
  readonly defines: readonly string[];
}

export interface ParticleProcessMaterial {
  shader: GodotParticlesShader | null;
  /** Each shader parameter the setters have set, by name. */
  readonly parameters: Map<string, GodotShaderParameter>;
  direction: Vector3;
  spread: number;
  flatness: number;
  params_min: number[];
  params_max: number[];
  tex_parameters: (GodotParticleTexture | null)[];
  color: Color;
  color_ramp: GodotParticleTexture | null;
  color_initial_ramp: GodotParticleTexture | null;
  alpha_curve: GodotParticleTexture | null;
  emission_curve: GodotParticleTexture | null;
  velocity_limit_curve: GodotParticleTexture | null;
  particle_flags: boolean[];
  emission_shape: number;
  emission_sphere_radius: number;
  emission_box_extents: Vector3;
  emission_ring_axis: Vector3;
  emission_ring_height: number;
  emission_ring_radius: number;
  emission_ring_inner_radius: number;
  emission_ring_cone_angle: number;
  emission_shape_offset: Vector3;
  emission_shape_scale: Vector3;
  inherit_velocity_ratio: number;
  velocity_pivot: Vector3;
  gravity: Vector3;
  lifetime_randomness: number;
}

/** The shader parameter each `Parameter`'s min and max set (`set_param_min`, `:1446`). */
const MIN_NAMES: readonly (string | null)[] = [
  'initial_linear_velocity_min',
  'angular_velocity_min',
  'orbit_velocity_min',
  'linear_accel_min',
  'radial_accel_min',
  'tangent_accel_min',
  'damping_min',
  'initial_angle_min',
  'scale_min',
  'hue_variation_min',
  'anim_speed_min',
  'anim_offset_min',
  null,
  'turbulence_influence_min',
  'turbulence_initial_displacement_min',
  'radial_velocity_min',
  'directional_velocity_min',
  'scale_over_velocity_min',
];
const MAX_NAMES: readonly (string | null)[] = MIN_NAMES.map((name) => (name === null ? null : name.replace(/_min$/u, '_max')));
/** The texture each `Parameter` samples (`set_param_texture`, `:1604`); `null` for none. */
const TEXTURE_NAMES: readonly (string | null)[] = [
  null,
  'angular_velocity_texture',
  'orbit_velocity_curve',
  'linear_accel_texture',
  'radial_accel_texture',
  'tangent_accel_texture',
  'damping_texture',
  'angle_texture',
  'scale_curve',
  'hue_rot_curve',
  'animation_speed_curve',
  'animation_offset_curve',
  'turbulence_influence_over_life',
  null,
  null,
  'radial_velocity_curve',
  'directional_velocity_curve',
  'scale_over_velocity_curve',
];

/**
 * The range a `CurveTexture` set on each `Parameter` gets when it has no curve (`_adjust_curve_range`,
 * `:1596`, called by `set_param_texture`, `:1609`); `null` where Godot adjusts none.
 */
const CURVE_RANGES: readonly (readonly [number, number] | null)[] = [
  null,
  [-360, 360],
  [-2, 2],
  [-200, 200],
  [-200, 200],
  [-200, 200],
  [0, 100],
  [-360, 360],
  [0, 1],
  [-1, 1],
  [0, 200],
  null,
  [0, 1],
  null,
  null,
  null,
  null,
  [0, 3],
];

const vec3 = (value: Vector3): readonly number[] => [value.x, value.y, value.z];

/** A setter that changes which shader Godot generates: refused once a generated shader is bound. */
function keyChange(self: ParticleProcessMaterial, member: string): void {
  if (self.shader !== null) {
    throw new Error(`godot-compat: ParticleProcessMaterial.${member} changes the material's generated shader, which only the translation captures.`);
  }
}

/**
 * The material with the constructor's defaults (`particle_process_material.cpp:2747`).
 *
 * @godot ParticleProcessMaterial.ParticleProcessMaterial
 * @source scene/resources/particle_process_material.cpp:2747
 */
export function construct(): ParticleProcessMaterial {
  const self: ParticleProcessMaterial = {
    shader: null,
    parameters: new Map(),
    direction: vector3(1, 0, 0),
    spread: 0,
    flatness: 0,
    params_min: new Array(PARAM_MAX).fill(0),
    params_max: new Array(PARAM_MAX).fill(0),
    tex_parameters: new Array(PARAM_MAX).fill(null),
    color: color(1, 1, 1, 1),
    color_ramp: null,
    color_initial_ramp: null,
    alpha_curve: null,
    emission_curve: null,
    velocity_limit_curve: null,
    particle_flags: new Array(PARTICLE_FLAG_MAX).fill(false),
    emission_shape: 0,
    emission_sphere_radius: 0,
    emission_box_extents: vector3(0, 0, 0),
    emission_ring_axis: vector3(0, 0, 0),
    emission_ring_height: 0,
    emission_ring_radius: 0,
    emission_ring_inner_radius: 0,
    emission_ring_cone_angle: 0,
    emission_shape_offset: vector3(0, 0, 0),
    emission_shape_scale: vector3(1, 1, 1),
    inherit_velocity_ratio: 0,
    velocity_pivot: vector3(0, 0, 0),
    gravity: vector3(0, 0, 0),
    lifetime_randomness: 0,
  };
  set_direction(self, vector3(1, 0, 0));
  set_spread(self, 45);
  set_flatness(self, 0);
  for (const param of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) set_param_min(self, param, param === 8 ? 1 : 0);
  for (const param of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) set_param_max(self, param, param === 8 ? 1 : 0);
  set_param_min(self, 16, 1.0);
  set_param_max(self, 16, 1.0);
  self.emission_shape = 0;
  set_emission_sphere_radius(self, 1);
  set_emission_box_extents(self, vector3(1, 1, 1));
  set_emission_ring_axis(self, vector3(0, 0, 1.0));
  set_emission_ring_height(self, 1);
  set_emission_ring_radius(self, 1);
  set_emission_ring_inner_radius(self, 0);
  set_emission_ring_cone_angle(self, 90);
  set_emission_shape_offset(self, vector3(0.0, 0.0, 0.0));
  set_emission_shape_scale(self, vector3(1.0, 1.0, 1.0));
  set_param_min(self, 13, 0.1);
  set_param_max(self, 13, 0.1);
  set_param_min(self, 14, 0.0);
  set_param_max(self, 14, 0.0);
  set_gravity(self, vector3(0, -9.8, 0));
  set_lifetime_randomness(self, 0);
  set_color(self, color(1, 1, 1, 1));
  return self;
}

/**
 * @godot ParticleProcessMaterial.set_direction
 * @source scene/resources/particle_process_material.cpp:1403
 */
export function set_direction(self: ParticleProcessMaterial, p_direction: Vector3): void {
  self.direction = p_direction;
  self.parameters.set('direction', vec3(p_direction));
}

/**
 * @godot ParticleProcessMaterial.get_direction
 * @source scene/resources/particle_process_material.cpp:1408
 */
export function get_direction(self: ParticleProcessMaterial): Vector3 {
  return self.direction;
}

/**
 * @godot ParticleProcessMaterial.set_spread
 * @source scene/resources/particle_process_material.cpp:1412
 */
export function set_spread(self: ParticleProcessMaterial, p_spread: number): void {
  self.spread = f32(p_spread);
  self.parameters.set('spread', self.spread);
}

/**
 * @godot ParticleProcessMaterial.get_spread
 * @source scene/resources/particle_process_material.cpp:1417
 */
export function get_spread(self: ParticleProcessMaterial): number {
  return self.spread;
}

/**
 * @godot ParticleProcessMaterial.set_flatness
 * @source scene/resources/particle_process_material.cpp:1421
 */
export function set_flatness(self: ParticleProcessMaterial, p_flatness: number): void {
  self.flatness = f32(p_flatness);
  self.parameters.set('flatness', self.flatness);
}

/**
 * @godot ParticleProcessMaterial.get_flatness
 * @source scene/resources/particle_process_material.cpp:1426
 */
export function get_flatness(self: ParticleProcessMaterial): number {
  return self.flatness;
}

/**
 * A minimum above the maximum raises the maximum to it (`:1446`).
 *
 * @godot ParticleProcessMaterial.set_param_min
 * @source scene/resources/particle_process_material.cpp:1448
 */
export function set_param_min(self: ParticleProcessMaterial, p_param: number, p_value: number): void {
  if (!Number.isInteger(p_param) || p_param < 0 || p_param >= PARAM_MAX) return;
  self.params_min[p_param] = f32(p_value);
  if ((self.params_min[p_param] as number) > (self.params_max[p_param] as number)) set_param_max(self, p_param, p_value);
  const name = MIN_NAMES[p_param];
  if (name !== null && name !== undefined) self.parameters.set(name, f32(p_value));
}

/**
 * @godot ParticleProcessMaterial.get_param_min
 * @source scene/resources/particle_process_material.cpp:1516
 */
export function get_param_min(self: ParticleProcessMaterial, p_param: number): number {
  return Number.isInteger(p_param) && p_param >= 0 && p_param < PARAM_MAX ? (self.params_min[p_param] as number) : 0;
}

/**
 * A maximum below the minimum lowers the minimum to it (`:1523`).
 *
 * @godot ParticleProcessMaterial.set_param_max
 * @source scene/resources/particle_process_material.cpp:1522
 */
export function set_param_max(self: ParticleProcessMaterial, p_param: number, p_value: number): void {
  if (!Number.isInteger(p_param) || p_param < 0 || p_param >= PARAM_MAX) return;
  self.params_max[p_param] = f32(p_value);
  if ((self.params_min[p_param] as number) > (self.params_max[p_param] as number)) set_param_min(self, p_param, p_value);
  const name = MAX_NAMES[p_param];
  if (name !== null && name !== undefined) self.parameters.set(name, f32(p_value));
}

/**
 * @godot ParticleProcessMaterial.get_param_max
 * @source scene/resources/particle_process_material.cpp:1590
 */
export function get_param_max(self: ParticleProcessMaterial, p_param: number): number {
  return Number.isInteger(p_param) && p_param >= 0 && p_param < PARAM_MAX ? (self.params_max[p_param] as number) : 0;
}

/**
 * A `CurveTexture` with no curve gets a flat one over the parameter's range (`_adjust_curve_range`,
 * `:1596`: `CurveTexture::ensure_default_setup`).
 *
 * @godot ParticleProcessMaterial.set_param_texture
 * @source scene/resources/particle_process_material.cpp:1609
 */
export function set_param_texture(self: ParticleProcessMaterial, p_param: number, p_texture: unknown): void {
  if (!Number.isInteger(p_param) || p_param < 0 || p_param >= PARAM_MAX) return;
  keyChange(self, 'set_param_texture');
  const texture = particleTexture(p_texture);
  self.tex_parameters[p_param] = texture;
  const name = TEXTURE_NAMES[p_param];
  if (name !== null && name !== undefined) self.parameters.set(name, texture);
  const range = CURVE_RANGES[p_param];
  if (range !== null && range !== undefined && texture !== null && isCurveTexture(texture.source)) godot_curve_texture_ensure_default_setup(texture.source, range[0], range[1]);
}

/**
 * @godot ParticleProcessMaterial.get_param_texture
 * @source scene/resources/particle_process_material.cpp:1693
 */
export function get_param_texture(self: ParticleProcessMaterial, p_param: number): object | null {
  return Number.isInteger(p_param) && p_param >= 0 && p_param < PARAM_MAX ? (self.tex_parameters[p_param]?.source ?? null) : null;
}

/**
 * @godot ParticleProcessMaterial.set_color
 * @source scene/resources/particle_process_material.cpp:1699
 */
export function set_color(self: ParticleProcessMaterial, p_color: Color): void {
  self.parameters.set('color_value', [p_color.r, p_color.g, p_color.b, p_color.a]);
  self.color = p_color;
}

/**
 * @godot ParticleProcessMaterial.get_color
 * @source scene/resources/particle_process_material.cpp:1704
 */
export function get_color(self: ParticleProcessMaterial): Color {
  return self.color;
}

/**
 * @godot ParticleProcessMaterial.set_color_ramp
 * @source scene/resources/particle_process_material.cpp:1708
 */
export function set_color_ramp(self: ParticleProcessMaterial, p_texture: unknown): void {
  keyChange(self, 'set_color_ramp');
  self.color_ramp = particleTexture(p_texture);
  self.parameters.set('color_ramp', self.color_ramp);
}

/**
 * @godot ParticleProcessMaterial.get_color_ramp
 * @source scene/resources/particle_process_material.cpp:1716
 */
export function get_color_ramp(self: ParticleProcessMaterial): object | null {
  return self.color_ramp?.source ?? null;
}

/**
 * @godot ParticleProcessMaterial.set_color_initial_ramp
 * @source scene/resources/particle_process_material.cpp:1720
 */
export function set_color_initial_ramp(self: ParticleProcessMaterial, p_texture: unknown): void {
  keyChange(self, 'set_color_initial_ramp');
  self.color_initial_ramp = particleTexture(p_texture);
  self.parameters.set('color_initial_ramp', self.color_initial_ramp);
}

/**
 * @godot ParticleProcessMaterial.get_color_initial_ramp
 * @source scene/resources/particle_process_material.cpp:1728
 */
export function get_color_initial_ramp(self: ParticleProcessMaterial): object | null {
  return self.color_initial_ramp?.source ?? null;
}

/**
 * @godot ParticleProcessMaterial.set_particle_flag
 * @source scene/resources/particle_process_material.cpp:1732
 */
export function set_particle_flag(self: ParticleProcessMaterial, p_particle_flag: number, p_enable: boolean): void {
  if (!Number.isInteger(p_particle_flag) || p_particle_flag < 0 || p_particle_flag >= PARTICLE_FLAG_MAX) return;
  keyChange(self, 'set_particle_flag');
  self.particle_flags[p_particle_flag] = p_enable;
}

/**
 * @godot ParticleProcessMaterial.get_particle_flag
 * @source scene/resources/particle_process_material.cpp:1777
 */
export function get_particle_flag(self: ParticleProcessMaterial, p_particle_flag: number): boolean {
  return Number.isInteger(p_particle_flag) && p_particle_flag >= 0 && p_particle_flag < PARTICLE_FLAG_MAX ? (self.particle_flags[p_particle_flag] as boolean) : false;
}

/**
 * @godot ParticleProcessMaterial.set_alpha_curve
 * @source scene/resources/particle_process_material.cpp:1741
 */
export function set_alpha_curve(self: ParticleProcessMaterial, p_texture: unknown): void {
  keyChange(self, 'set_alpha_curve');
  self.alpha_curve = particleTexture(p_texture);
  self.parameters.set('alpha_curve', self.alpha_curve);
}

/**
 * @godot ParticleProcessMaterial.get_alpha_curve
 * @source scene/resources/particle_process_material.cpp:1749
 */
export function get_alpha_curve(self: ParticleProcessMaterial): object | null {
  return self.alpha_curve?.source ?? null;
}

/**
 * @godot ParticleProcessMaterial.set_emission_curve
 * @source scene/resources/particle_process_material.cpp:1753
 */
export function set_emission_curve(self: ParticleProcessMaterial, p_texture: unknown): void {
  keyChange(self, 'set_emission_curve');
  self.emission_curve = particleTexture(p_texture);
  self.parameters.set('emission_curve', self.emission_curve);
}

/**
 * @godot ParticleProcessMaterial.get_emission_curve
 * @source scene/resources/particle_process_material.cpp:1761
 */
export function get_emission_curve(self: ParticleProcessMaterial): object | null {
  return self.emission_curve?.source ?? null;
}

/**
 * @godot ParticleProcessMaterial.set_velocity_limit_curve
 * @source scene/resources/particle_process_material.cpp:1765
 */
export function set_velocity_limit_curve(self: ParticleProcessMaterial, p_texture: unknown): void {
  keyChange(self, 'set_velocity_limit_curve');
  self.velocity_limit_curve = particleTexture(p_texture);
  self.parameters.set('velocity_limit_curve', self.velocity_limit_curve);
}

/**
 * @godot ParticleProcessMaterial.get_velocity_limit_curve
 * @source scene/resources/particle_process_material.cpp:1773
 */
export function get_velocity_limit_curve(self: ParticleProcessMaterial): object | null {
  return self.velocity_limit_curve?.source ?? null;
}

/**
 * @godot ParticleProcessMaterial.set_emission_shape
 * @source scene/resources/particle_process_material.cpp:1782
 */
export function set_emission_shape(self: ParticleProcessMaterial, p_shape: number): void {
  if (!Number.isInteger(p_shape) || p_shape < 0 || p_shape >= 7) return;
  keyChange(self, 'set_emission_shape');
  self.emission_shape = p_shape;
}

/**
 * @godot ParticleProcessMaterial.get_emission_shape
 * @source scene/resources/particle_process_material.cpp:1877
 */
export function get_emission_shape(self: ParticleProcessMaterial): number {
  return self.emission_shape;
}

/**
 * @godot ParticleProcessMaterial.set_emission_sphere_radius
 * @source scene/resources/particle_process_material.cpp:1792
 */
export function set_emission_sphere_radius(self: ParticleProcessMaterial, p_radius: number): void {
  self.emission_sphere_radius = f32(p_radius);
  self.parameters.set('emission_sphere_radius', self.emission_sphere_radius);
}

/**
 * @godot ParticleProcessMaterial.get_emission_sphere_radius
 * @source scene/resources/particle_process_material.cpp:1881
 */
export function get_emission_sphere_radius(self: ParticleProcessMaterial): number {
  return self.emission_sphere_radius;
}

/**
 * @godot ParticleProcessMaterial.set_emission_box_extents
 * @source scene/resources/particle_process_material.cpp:1800
 */
export function set_emission_box_extents(self: ParticleProcessMaterial, p_extents: Vector3): void {
  self.emission_box_extents = p_extents;
  self.parameters.set('emission_box_extents', vec3(p_extents));
}

/**
 * @godot ParticleProcessMaterial.get_emission_box_extents
 * @source scene/resources/particle_process_material.cpp:1885
 */
export function get_emission_box_extents(self: ParticleProcessMaterial): Vector3 {
  return self.emission_box_extents;
}

/**
 * @godot ParticleProcessMaterial.set_emission_ring_axis
 * @source scene/resources/particle_process_material.cpp:1832
 */
export function set_emission_ring_axis(self: ParticleProcessMaterial, p_axis: Vector3): void {
  self.emission_ring_axis = p_axis;
  self.parameters.set('emission_ring_axis', vec3(p_axis));
}

/**
 * @godot ParticleProcessMaterial.get_emission_ring_axis
 * @source scene/resources/particle_process_material.cpp:1905
 */
export function get_emission_ring_axis(self: ParticleProcessMaterial): Vector3 {
  return self.emission_ring_axis;
}

/**
 * @godot ParticleProcessMaterial.set_emission_ring_height
 * @source scene/resources/particle_process_material.cpp:1840
 */
export function set_emission_ring_height(self: ParticleProcessMaterial, p_height: number): void {
  self.emission_ring_height = f32(p_height);
  self.parameters.set('emission_ring_height', self.emission_ring_height);
}

/**
 * @godot ParticleProcessMaterial.get_emission_ring_height
 * @source scene/resources/particle_process_material.cpp:1909
 */
export function get_emission_ring_height(self: ParticleProcessMaterial): number {
  return self.emission_ring_height;
}

/**
 * @godot ParticleProcessMaterial.set_emission_ring_radius
 * @source scene/resources/particle_process_material.cpp:1848
 */
export function set_emission_ring_radius(self: ParticleProcessMaterial, p_radius: number): void {
  self.emission_ring_radius = f32(p_radius);
  self.parameters.set('emission_ring_radius', self.emission_ring_radius);
}

/**
 * @godot ParticleProcessMaterial.get_emission_ring_radius
 * @source scene/resources/particle_process_material.cpp:1913
 */
export function get_emission_ring_radius(self: ParticleProcessMaterial): number {
  return self.emission_ring_radius;
}

/**
 * @godot ParticleProcessMaterial.set_emission_ring_inner_radius
 * @source scene/resources/particle_process_material.cpp:1856
 */
export function set_emission_ring_inner_radius(self: ParticleProcessMaterial, p_radius: number): void {
  self.emission_ring_inner_radius = f32(p_radius);
  self.parameters.set('emission_ring_inner_radius', self.emission_ring_inner_radius);
}

/**
 * @godot ParticleProcessMaterial.get_emission_ring_inner_radius
 * @source scene/resources/particle_process_material.cpp:1917
 */
export function get_emission_ring_inner_radius(self: ParticleProcessMaterial): number {
  return self.emission_ring_inner_radius;
}

/**
 * @godot ParticleProcessMaterial.set_emission_ring_cone_angle
 * @source scene/resources/particle_process_material.cpp:1864
 */
export function set_emission_ring_cone_angle(self: ParticleProcessMaterial, p_angle: number): void {
  self.emission_ring_cone_angle = f32(p_angle);
  self.parameters.set('emission_ring_cone_angle', self.emission_ring_cone_angle);
}

/**
 * @godot ParticleProcessMaterial.get_emission_ring_cone_angle
 * @source scene/resources/particle_process_material.cpp:1921
 */
export function get_emission_ring_cone_angle(self: ParticleProcessMaterial): number {
  return self.emission_ring_cone_angle;
}

/**
 * @godot ParticleProcessMaterial.set_inherit_velocity_ratio
 * @source scene/resources/particle_process_material.cpp:1872
 */
export function set_inherit_velocity_ratio(self: ParticleProcessMaterial, p_ratio: number): void {
  self.inherit_velocity_ratio = p_ratio;
  self.parameters.set('inherit_emitter_velocity_ratio', f32(p_ratio));
}

/**
 * @godot ParticleProcessMaterial.get_inherit_velocity_ratio
 * @source scene/resources/particle_process_material.cpp:1949
 */
export function get_inherit_velocity_ratio(self: ParticleProcessMaterial): number {
  return self.inherit_velocity_ratio;
}

/**
 * @godot ParticleProcessMaterial.set_velocity_pivot
 * @source scene/resources/particle_process_material.cpp:1430
 */
export function set_velocity_pivot(self: ParticleProcessMaterial, p_pivot: Vector3): void {
  self.velocity_pivot = p_pivot;
  self.parameters.set('velocity_pivot', vec3(p_pivot));
}

/**
 * @godot ParticleProcessMaterial.get_velocity_pivot
 * @source scene/resources/particle_process_material.cpp:1435
 */
export function get_velocity_pivot(self: ParticleProcessMaterial): Vector3 {
  return self.velocity_pivot;
}

/**
 * @godot ParticleProcessMaterial.set_emission_shape_offset
 * @source scene/resources/particle_process_material.cpp:1925
 */
export function set_emission_shape_offset(self: ParticleProcessMaterial, p_offset: Vector3): void {
  self.emission_shape_offset = p_offset;
  self.parameters.set('emission_shape_offset', vec3(p_offset));
}

/**
 * @godot ParticleProcessMaterial.get_emission_shape_offset
 * @source scene/resources/particle_process_material.cpp:1933
 */
export function get_emission_shape_offset(self: ParticleProcessMaterial): Vector3 {
  return self.emission_shape_offset;
}

/**
 * @godot ParticleProcessMaterial.set_emission_shape_scale
 * @source scene/resources/particle_process_material.cpp:1937
 */
export function set_emission_shape_scale(self: ParticleProcessMaterial, p_scale: Vector3): void {
  self.emission_shape_scale = p_scale;
  self.parameters.set('emission_shape_scale', vec3(p_scale));
}

/**
 * @godot ParticleProcessMaterial.get_emission_shape_scale
 * @source scene/resources/particle_process_material.cpp:1945
 */
export function get_emission_shape_scale(self: ParticleProcessMaterial): Vector3 {
  return self.emission_shape_scale;
}

/**
 * A zero gravity is sent as `(0, -0.000001, 0)`: it is an up vector in some calculations (`:2119`).
 *
 * @godot ParticleProcessMaterial.set_gravity
 * @source scene/resources/particle_process_material.cpp:2116
 */
export function set_gravity(self: ParticleProcessMaterial, p_gravity: Vector3): void {
  self.gravity = p_gravity;
  const zero = p_gravity.x === 0 && p_gravity.y === 0 && p_gravity.z === 0;
  self.parameters.set('gravity', zero ? [0, f32(-0.000001), 0] : vec3(p_gravity));
}

/**
 * @godot ParticleProcessMaterial.get_gravity
 * @source scene/resources/particle_process_material.cpp:2125
 */
export function get_gravity(self: ParticleProcessMaterial): Vector3 {
  return self.gravity;
}

/**
 * @godot ParticleProcessMaterial.set_lifetime_randomness
 * @source scene/resources/particle_process_material.cpp:2129
 */
export function set_lifetime_randomness(self: ParticleProcessMaterial, p_lifetime: number): void {
  self.lifetime_randomness = p_lifetime;
  self.parameters.set('lifetime_randomness', f32(p_lifetime));
}

/**
 * @godot ParticleProcessMaterial.get_lifetime_randomness
 * @source scene/resources/particle_process_material.cpp:2134
 */
export function get_lifetime_randomness(self: ParticleProcessMaterial): number {
  return self.lifetime_randomness;
}

/**
 * Binds the shader Godot generated for this material (captured and lowered by the translation).
 *
 * @godot ParticleProcessMaterial (protocol)
 * @source scene/resources/particle_process_material.cpp:160
 */
export function godot_particle_process_material_bind_shader(self: ParticleProcessMaterial, shader: GodotParticlesShader): void {
  self.shader = shader;
}

/** Every property a scene states on a ParticleProcessMaterial, by its prop, and the setter it calls. */
const MIN_MAX: Readonly<Record<string, number>> = {
  angle: 7,
  initialVelocity: 0,
  angularVelocity: 1,
  directionalVelocity: 16,
  orbitVelocity: 2,
  radialVelocity: 15,
  linearAccel: 3,
  radialAccel: 4,
  tangentialAccel: 5,
  damping: 6,
  scale: 8,
  scaleOverVelocity: 17,
  hueVariation: 9,
  animSpeed: 10,
  animOffset: 11,
  turbulenceInfluence: 13,
  turbulenceInitialDisplacement: 14,
};
const CURVES: Readonly<Record<string, number>> = {
  angleCurve: 7,
  angularVelocityCurve: 1,
  directionalVelocityCurve: 16,
  orbitVelocityCurve: 2,
  radialVelocityCurve: 15,
  linearAccelCurve: 3,
  radialAccelCurve: 4,
  tangentialAccelCurve: 5,
  dampingCurve: 6,
  scaleCurve: 8,
  scaleOverVelocityCurve: 17,
  hueVariationCurve: 9,
  animSpeedCurve: 10,
  animOffsetCurve: 11,
  turbulenceInfluenceOverLife: 12,
};
const FLAGS: Readonly<Record<string, number>> = {
  particleFlagAlignY: 0,
  particleFlagRotateY: 1,
  particleFlagDisableZ: 2,
  particleFlagDampingAsFriction: 3,
  particleFlagInheritEmitterScale: 4,
};
const vector = (value: unknown): Vector3 => {
  const v = value as readonly number[] | Vector3;
  return Array.isArray(v) ? vector3(v[0] as number, v[1] as number, v[2] as number) : (v as Vector3);
};

/**
 * A ParticleProcessMaterial of the properties a scene states (`particle_process_material.cpp:2562`:
 * its properties), with the shader Godot generated for it (captured by the translation); an
 * unknown property fails by name.
 *
 * @godot ParticleProcessMaterial (protocol)
 * @source scene/resources/particle_process_material.cpp:2562
 */
export function godot_particle_process_material_new(shaders: { readonly generated: Shader }, properties: Readonly<Record<string, unknown>> = {}): ParticleProcessMaterial {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    const minMax = /^(.*)(Min|Max)$/u.exec(property);
    if (minMax !== null && MIN_MAX[minMax[1] as string] !== undefined) {
      (minMax[2] === 'Min' ? set_param_min : set_param_max)(self, MIN_MAX[minMax[1] as string] as number, value as number);
    } else if (CURVES[property] !== undefined) set_param_texture(self, CURVES[property] as number, value);
    else if (FLAGS[property] !== undefined) set_particle_flag(self, FLAGS[property] as number, value as boolean);
    else if (property === 'direction') set_direction(self, vector(value));
    else if (property === 'spread') set_spread(self, value as number);
    else if (property === 'flatness') set_flatness(self, value as number);
    else if (property === 'gravity') set_gravity(self, vector(value));
    else if (property === 'color') {
      const c = value as readonly number[];
      set_color(self, Array.isArray(c) ? color(c[0] as number, c[1] as number, c[2] as number, c[3] as number) : (value as Color));
    } else if (property === 'colorRamp') set_color_ramp(self, value);
    else if (property === 'colorInitialRamp') set_color_initial_ramp(self, value);
    else if (property === 'alphaCurve') set_alpha_curve(self, value);
    else if (property === 'emissionCurve') set_emission_curve(self, value);
    else if (property === 'velocityLimitCurve') set_velocity_limit_curve(self, value);
    else if (property === 'emissionShape') set_emission_shape(self, value as number);
    else if (property === 'emissionSphereRadius') set_emission_sphere_radius(self, value as number);
    else if (property === 'emissionBoxExtents') set_emission_box_extents(self, vector(value));
    else if (property === 'emissionRingAxis') set_emission_ring_axis(self, vector(value));
    else if (property === 'emissionRingHeight') set_emission_ring_height(self, value as number);
    else if (property === 'emissionRingRadius') set_emission_ring_radius(self, value as number);
    else if (property === 'emissionRingInnerRadius') set_emission_ring_inner_radius(self, value as number);
    else if (property === 'emissionRingConeAngle') set_emission_ring_cone_angle(self, value as number);
    else if (property === 'emissionShapeOffset') set_emission_shape_offset(self, vector(value));
    else if (property === 'emissionShapeScale') set_emission_shape_scale(self, vector(value));
    else if (property === 'inheritVelocityRatio') set_inherit_velocity_ratio(self, value as number);
    else if (property === 'velocityPivot') set_velocity_pivot(self, vector(value));
    else if (property === 'lifetimeRandomness') set_lifetime_randomness(self, value as number);
    else throw new Error(`godot-compat: ParticleProcessMaterial has no ${property} property here.`);
  }
  const lowered = shaders.generated.lowered;
  if (lowered.mode !== 'particles' || lowered.entries === undefined) throw new Error('godot-compat: a ParticleProcessMaterial shader must be a lowered particles shader.');
  godot_particle_process_material_bind_shader(self, {
    uniforms: lowered.uniforms,
    functions: lowered.functions,
    start: lowered.entries['start'] ?? '',
    process: lowered.entries['process'] ?? '',
    defines: lowered.defines ?? [],
  });
  return self;
}
