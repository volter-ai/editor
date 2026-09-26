import type { Texture } from 'three';
import { registerGodotObjectIdentity } from './object';
import type { ColorValue } from './variant';

export interface GodotParticleVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const GODOT_PARTICLE_EMISSION_SHAPE_3D = {
  POINT: 0,
  SPHERE: 1,
  SPHERE_SURFACE: 2,
  BOX: 3,
  POINTS: 4,
  DIRECTED_POINTS: 5,
  RING: 6,
  EMISSION_SHAPE_POINT: 0,
  EMISSION_SHAPE_SPHERE: 1,
  EMISSION_SHAPE_SPHERE_SURFACE: 2,
  EMISSION_SHAPE_BOX: 3,
  EMISSION_SHAPE_POINTS: 4,
  EMISSION_SHAPE_DIRECTED_POINTS: 5,
  EMISSION_SHAPE_RING: 6,
} as const;

export const GODOT_PARTICLE_COLLISION_TYPE = {
  DISABLED: 0,
  RIGID: 1,
  HIDE_ON_CONTACT: 2,
  COLLISION_TYPE_DISABLED: 0,
  COLLISION_TYPE_RIGID: 1,
  COLLISION_TYPE_HIDE_ON_CONTACT: 2,
} as const;

export const GODOT_PARTICLE_SUB_EMITTER_MODE = {
  DISABLED: 0,
  CONSTANT: 1,
  AT_END: 2,
  AT_COLLISION: 3,
  AT_START: 4,
  SUB_EMITTER_DISABLED: 0,
  SUB_EMITTER_CONSTANT: 1,
  SUB_EMITTER_AT_END: 2,
  SUB_EMITTER_AT_COLLISION: 3,
  SUB_EMITTER_AT_START: 4,
} as const;

export interface GodotParticleProcessMaterial3D {
  readonly __godotClass: 'ParticleProcessMaterial';
  direction: GodotParticleVector3;
  spread: number;
  flatness: number;
  gravity: GodotParticleVector3;
  emission_shape: number;
  emission_sphere_radius: number;
  emission_sphere_inner_radius: number;
  emission_box_extents: GodotParticleVector3;
  emission_ring_axis: GodotParticleVector3;
  emission_ring_height: number;
  emission_ring_radius: number;
  emission_ring_inner_radius: number;
  emission_point_texture: Texture | null;
  emission_normal_texture: Texture | null;
  emission_color_texture: Texture | null;
  emission_point_count: number;
  initial_velocity_min: number;
  initial_velocity_max: number;
  inherit_velocity_ratio: number;
  velocity_pivot: GodotParticleVector3;
  directional_velocity_min: number;
  directional_velocity_max: number;
  spread_curve: unknown | null;
  flatness_curve: unknown | null;
  initial_velocity_curve: unknown | null;
  velocity_limit_curve: unknown | null;
  angular_velocity_min: number;
  angular_velocity_max: number;
  angular_velocity_curve: unknown | null;
  orbit_velocity_min: number;
  orbit_velocity_max: number;
  orbit_velocity_curve: unknown | null;
  linear_accel_min: number;
  linear_accel_max: number;
  linear_accel_curve: unknown | null;
  radial_accel_min: number;
  radial_accel_max: number;
  radial_accel_curve: unknown | null;
  tangential_accel_min: number;
  tangential_accel_max: number;
  tangential_accel_curve: unknown | null;
  radial_velocity_min: number;
  radial_velocity_max: number;
  radial_velocity_curve: unknown | null;
  damping_min: number;
  damping_max: number;
  damping_curve: unknown | null;
  angle_min: number;
  angle_max: number;
  angle_curve: unknown | null;
  scale_min: number;
  scale_max: number;
  scale_curve: unknown | null;
  scale_over_velocity_min: number;
  scale_over_velocity_max: number;
  scale_over_velocity_curve: unknown | null;
  hue_variation_min: number;
  hue_variation_max: number;
  hue_variation_curve: unknown | null;
  anim_speed_min: number;
  anim_speed_max: number;
  anim_speed_curve: unknown | null;
  anim_offset_min: number;
  anim_offset_max: number;
  anim_offset_curve: unknown | null;
  lifetime_randomness: number;
  color: ColorValue;
  color_ramp: unknown | null;
  alpha_curve: unknown | null;
  emission_curve: unknown | null;
  particle_flag_align_y: boolean;
  particle_flag_rotate_y: boolean;
  particle_flag_disable_z: boolean;
  turbulence_enabled: boolean;
  turbulence_noise_strength: number;
  turbulence_noise_scale: number;
  turbulence_noise_speed: GodotParticleVector3;
  turbulence_noise_speed_random: number;
  turbulence_influence_min: number;
  turbulence_influence_max: number;
  turbulence_influence_over_life: unknown | null;
  turbulence_initial_displacement_min: number;
  turbulence_initial_displacement_max: number;
  collision_type: number;
  collision_friction: number;
  collision_bounce: number;
  collision_use_scale: boolean;
  sub_emitter_mode: number;
  sub_emitter_frequency: number;
  sub_emitter_amount_at_end: number;
  sub_emitter_amount_at_collision: number;
  sub_emitter_amount_at_start: number;
  attractor_interaction_enabled: boolean;
}

type MaterialListener = (material: GodotParticleProcessMaterial3D, member: string) => void;
const MATERIAL_LISTENERS = new WeakMap<GodotParticleProcessMaterial3D, Set<MaterialListener>>();

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`godot-compat: ParticleProcessMaterial.${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  const number = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(number)) throw new TypeError(`godot-compat: ParticleProcessMaterial.${member} requires an integer.`);
  return number;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ParticleProcessMaterial.${member} requires bool.`);
  return value;
}

function vector(value: unknown, member: string): GodotParticleVector3 {
  if (
    typeof value !== 'object' || value === null ||
    !('x' in value) || !('y' in value) || !('z' in value) ||
    ![value.x, value.y, value.z].every((component) => typeof component === 'number' && Number.isFinite(component))
  ) throw new TypeError(`godot-compat: ParticleProcessMaterial.${member} requires Vector3.`);
  return Object.freeze({ x: value.x as number, y: value.y as number, z: value.z as number });
}

function color(value: unknown): ColorValue {
  if (typeof value !== 'object' || value === null || !('r' in value) || !('g' in value) || !('b' in value)) {
    throw new TypeError('godot-compat: ParticleProcessMaterial.color requires Color.');
  }
  return Object.freeze({
    r: finite(value.r, 'color.r'),
    g: finite(value.g, 'color.g'),
    b: finite(value.b, 'color.b'),
    a: finite('a' in value ? value.a : 1, 'color.a'),
  });
}

function texture(value: unknown, member: string): Texture | null {
  if (value === null) return null;
  if (typeof value !== 'object' || !('isTexture' in value)) {
    throw new TypeError(`godot-compat: ParticleProcessMaterial.${member} requires Texture2D or null.`);
  }
  return value as Texture;
}

function resource(value: unknown): unknown | null { return value === undefined ? null : value; }

function property(
  owner: GodotParticleProcessMaterial3D,
  member: string,
  initial: unknown,
  normalize: (value: unknown) => unknown,
): void {
  let retained = normalize(initial);
  Object.defineProperty(owner, member, {
    enumerable: true,
    configurable: true,
    get: () => retained,
    set: (value: unknown) => {
      retained = normalize(value);
      for (const listener of MATERIAL_LISTENERS.get(owner) ?? []) listener(owner, member);
    },
  });
}

export function createGodotParticleProcessMaterial3D(): GodotParticleProcessMaterial3D {
  const material = { __godotClass: 'ParticleProcessMaterial' as const } as GodotParticleProcessMaterial3D;
  property(material, 'direction', { x: 1, y: 0, z: 0 }, (value) => vector(value, 'direction'));
  property(material, 'spread', 45, (value) => finite(value, 'spread', 0, 180));
  property(material, 'flatness', 0, (value) => finite(value, 'flatness', 0, 1));
  property(material, 'gravity', { x: 0, y: -9.8, z: 0 }, (value) => vector(value, 'gravity'));
  property(material, 'emission_shape', 0, (value) => integer(value, 'emission_shape', 0, 6));
  property(material, 'emission_sphere_radius', 1, (value) => finite(value, 'emission_sphere_radius', 0));
  property(material, 'emission_sphere_inner_radius', 0, (value) => finite(value, 'emission_sphere_inner_radius', 0));
  property(material, 'emission_box_extents', { x: 1, y: 1, z: 1 }, (value) => vector(value, 'emission_box_extents'));
  property(material, 'emission_ring_axis', { x: 0, y: 0, z: 1 }, (value) => vector(value, 'emission_ring_axis'));
  for (const [member, initial] of [['emission_ring_height', 1], ['emission_ring_radius', 1], ['emission_ring_inner_radius', 0]] as const) {
    property(material, member, initial, (value) => finite(value, member, 0));
  }
  for (const member of ['emission_point_texture', 'emission_normal_texture', 'emission_color_texture'] as const) {
    property(material, member, null, (value) => texture(value, member));
  }
  property(material, 'emission_point_count', 1, (value) => integer(value, 'emission_point_count', 1, 1_000_000));
  property(material, 'velocity_pivot', { x: 0, y: 0, z: 0 }, (value) => vector(value, 'velocity_pivot'));
  property(material, 'turbulence_noise_speed', { x: 0.5, y: 0.5, z: 0.5 }, (value) => vector(value, 'turbulence_noise_speed'));

  const nonNegative = [
    ['initial_velocity_min', 0], ['initial_velocity_max', 0], ['directional_velocity_min', 0],
    ['directional_velocity_max', 0], ['damping_min', 0], ['damping_max', 0],
    ['scale_min', 1], ['scale_max', 1], ['scale_over_velocity_min', 0], ['scale_over_velocity_max', 0],
    ['turbulence_noise_strength', 1], ['turbulence_noise_scale', 9],
    ['turbulence_initial_displacement_min', 0], ['turbulence_initial_displacement_max', 0],
    ['collision_friction', 0], ['collision_bounce', 0], ['sub_emitter_frequency', 4],
  ] as const;
  for (const [member, initial] of nonNegative) property(material, member, initial, (value) => finite(value, member, 0));

  const unrestricted = [
    'angular_velocity_min', 'angular_velocity_max', 'orbit_velocity_min', 'orbit_velocity_max',
    'linear_accel_min', 'linear_accel_max', 'radial_accel_min', 'radial_accel_max',
    'tangential_accel_min', 'tangential_accel_max', 'radial_velocity_min', 'radial_velocity_max',
    'angle_min', 'angle_max', 'hue_variation_min', 'hue_variation_max',
    'anim_speed_min', 'anim_speed_max', 'anim_offset_min', 'anim_offset_max',
  ] as const;
  for (const member of unrestricted) property(material, member, 0, (value) => finite(value, member));

  const ratios = [
    'inherit_velocity_ratio', 'lifetime_randomness', 'turbulence_noise_speed_random',
    'turbulence_influence_min', 'turbulence_influence_max',
  ] as const;
  for (const member of ratios) property(material, member, 0, (value) => finite(value, member, 0, 1));

  const curves = [
    'spread_curve', 'flatness_curve', 'initial_velocity_curve', 'velocity_limit_curve',
    'angular_velocity_curve', 'orbit_velocity_curve', 'linear_accel_curve', 'radial_accel_curve',
    'tangential_accel_curve', 'radial_velocity_curve', 'damping_curve', 'angle_curve',
    'scale_curve', 'scale_over_velocity_curve', 'hue_variation_curve', 'anim_speed_curve',
    'anim_offset_curve', 'color_ramp', 'alpha_curve', 'emission_curve',
    'turbulence_influence_over_life',
  ] as const;
  for (const member of curves) property(material, member, null, resource);

  property(material, 'color', { r: 1, g: 1, b: 1, a: 1 }, color);
  for (const member of [
    'particle_flag_align_y', 'particle_flag_rotate_y', 'particle_flag_disable_z',
    'turbulence_enabled', 'collision_use_scale', 'attractor_interaction_enabled',
  ] as const) property(material, member, false, (value) => bool(value, member));
  property(material, 'collision_type', 0, (value) => integer(value, 'collision_type', 0, 2));
  property(material, 'sub_emitter_mode', 0, (value) => integer(value, 'sub_emitter_mode', 0, 4));
  for (const member of ['sub_emitter_amount_at_end', 'sub_emitter_amount_at_collision', 'sub_emitter_amount_at_start'] as const) {
    property(material, member, 1, (value) => integer(value, member, 1, 1_000_000));
  }
  registerGodotObjectIdentity(material, 'ParticleProcessMaterial');
  return material;
}

export function watchGodotParticleProcessMaterial3D(
  material: GodotParticleProcessMaterial3D,
  listener: MaterialListener,
): () => void {
  let listeners = MATERIAL_LISTENERS.get(material);
  if (listeners === undefined) { listeners = new Set(); MATERIAL_LISTENERS.set(material, listeners); }
  listeners.add(listener);
  return () => listeners?.delete(listener);
}
