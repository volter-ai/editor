/**
 * @godot-class ParticleProcessMaterial
 * @role BINDING
 *
 * Godot 4.7's `ParticleProcessMaterial` (`scene/resources/particle_process_material.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the parameters it holds. Godot compiles them into
 * a particle shader the GPU runs; here nothing is compiled: a GPUParticles3D is drawn as the CPU
 * particle system Godot converts it to (`CPUParticles3D::convert_from_particles`,
 * `gpu-particles-3d.ts`), which reads these parameters. A change to one is handed to the systems
 * using the material, which convert it again.
 *
 * Held: the parameters that conversion carries, and the alpha curve (`alpha_curve`), which the
 * converted system applies as the material's shader does. The rest (turbulence, collision,
 * sub-emitters, attractors, 3D scale and rotation, velocity limits, emission curves and textures)
 * has no member here: a scene that states one is refused by name at import.
 */

import { type Color, construct as color } from './color';
import type { CurveTexture } from './curve-texture';
import type { GradientTexture1D } from './gradient-texture-1d';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;
/** `ParticleProcessMaterial::PARAM_MAX` (`particle_process_material.h:69`). */
const PARAM_MAX = 18;
/** `PARAM_SCALE` and `PARAM_DIRECTIONAL_VELOCITY` (`particle_process_material.h:59`, `:67`). */
const PARAM_SCALE = 8;
const PARAM_DIRECTIONAL_VELOCITY = 16;
/** `PARAM_TURB_VEL_INFLUENCE` (`particle_process_material.h:64`). */
const PARAM_TURB_VEL_INFLUENCE = 13;
/** `PARTICLE_FLAG_MAX` (`particle_process_material.h:79`). */
const PARTICLE_FLAG_MAX = 5;
/** `EMISSION_SHAPE_MAX` (`particle_process_material.h:91`). */
const EMISSION_SHAPE_MAX = 7;

export interface ParticleProcessMaterial {
  direction: Vector3;
  spread: number;
  flatness: number;
  params_min: number[];
  params_max: number[];
  tex_parameters: (CurveTexture | null)[];
  color: Color;
  color_ramp: GradientTexture1D | null;
  color_initial_ramp: GradientTexture1D | null;
  alpha_curve: CurveTexture | null;
  particle_flags: boolean[];
  emission_shape: number;
  emission_sphere_radius: number;
  emission_box_extents: Vector3;
  gravity: Vector3;
  lifetime_randomness: number;
}

/** The systems drawing with each material, told when one of its parameters changes. */
const USERS = new WeakMap<ParticleProcessMaterial, Set<() => void>>();

function changed(self: ParticleProcessMaterial): void {
  for (const listener of [...(USERS.get(self) ?? [])]) listener();
}

/**
 * A particle system that draws with `self` hears of each change to it, as Godot's particles
 * take the material's recompiled shader (`_queue_shader_change`); the returned function stops that.
 *
 * @godot ParticleProcessMaterial (protocol)
 * @source scene/resources/particle_process_material.cpp:1387
 */
export function godot_particle_process_material_listen(self: ParticleProcessMaterial, listener: () => void): () => void {
  const listeners = USERS.get(self) ?? new Set();
  listeners.add(listener);
  USERS.set(self, listeners);
  return () => listeners.delete(listener);
}

/**
 * Godot's defaults (`ParticleProcessMaterial::ParticleProcessMaterial`): direction +X, a 45°
 * spread, scale 1, directional velocity 1, turbulence influence 0.1, gravity -9.8 on Y, white,
 * emitted from a point of a unit sphere's or box's size.
 *
 * @godot ParticleProcessMaterial (protocol)
 * @source scene/resources/particle_process_material.cpp:2747
 */
export function construct(): ParticleProcessMaterial {
  const params_min = new Array<number>(PARAM_MAX).fill(0);
  const params_max = new Array<number>(PARAM_MAX).fill(0);
  for (const param of [PARAM_SCALE, PARAM_DIRECTIONAL_VELOCITY]) {
    params_min[param] = 1;
    params_max[param] = 1;
  }
  params_min[PARAM_TURB_VEL_INFLUENCE] = f32(0.1);
  params_max[PARAM_TURB_VEL_INFLUENCE] = f32(0.1);
  return {
    direction: vector3(1, 0, 0),
    spread: 45,
    flatness: 0,
    params_min,
    params_max,
    tex_parameters: new Array<CurveTexture | null>(PARAM_MAX).fill(null),
    color: color(1, 1, 1, 1),
    color_ramp: null,
    color_initial_ramp: null,
    alpha_curve: null,
    particle_flags: new Array<boolean>(PARTICLE_FLAG_MAX).fill(false),
    emission_shape: 0,
    emission_sphere_radius: 1,
    emission_box_extents: vector3(1, 1, 1),
    gravity: vector3(0, f32(-9.8), 0),
    lifetime_randomness: 0,
  };
}

/**
 * @godot ParticleProcessMaterial.set_direction
 * @source scene/resources/particle_process_material.cpp:1403
 */
export function set_direction(self: ParticleProcessMaterial, direction: Vector3): void {
  self.direction = vector3(direction);
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_direction
 * @source scene/resources/particle_process_material.cpp:1408
 */
export function get_direction(self: ParticleProcessMaterial): Vector3 {
  return vector3(self.direction);
}

/**
 * @godot ParticleProcessMaterial.set_spread
 * @source scene/resources/particle_process_material.cpp:1412
 */
export function set_spread(self: ParticleProcessMaterial, spread: number): void {
  self.spread = f32(spread);
  changed(self);
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
export function set_flatness(self: ParticleProcessMaterial, flatness: number): void {
  self.flatness = f32(flatness);
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_flatness
 * @source scene/resources/particle_process_material.cpp:1426
 */
export function get_flatness(self: ParticleProcessMaterial): number {
  return self.flatness;
}

/**
 * A minimum above the maximum raises the maximum; a parameter out of range fails.
 *
 * @godot ParticleProcessMaterial.set_param_min
 * @source scene/resources/particle_process_material.cpp:1448
 */
export function set_param_min(self: ParticleProcessMaterial, param: number, value: number): void {
  if (param < 0 || param >= PARAM_MAX) return;
  self.params_min[param] = f32(value);
  if ((self.params_min[param] as number) > (self.params_max[param] as number)) self.params_max[param] = f32(value);
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_param_min
 * @source scene/resources/particle_process_material.cpp:1516
 */
export function get_param_min(self: ParticleProcessMaterial, param: number): number {
  return self.params_min[param] ?? 0;
}

/**
 * A maximum below the minimum lowers the minimum; a parameter out of range fails.
 *
 * @godot ParticleProcessMaterial.set_param_max
 * @source scene/resources/particle_process_material.cpp:1522
 */
export function set_param_max(self: ParticleProcessMaterial, param: number, value: number): void {
  if (param < 0 || param >= PARAM_MAX) return;
  self.params_max[param] = f32(value);
  if ((self.params_min[param] as number) > (self.params_max[param] as number)) self.params_min[param] = f32(value);
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_param_max
 * @source scene/resources/particle_process_material.cpp:1590
 */
export function get_param_max(self: ParticleProcessMaterial, param: number): number {
  return self.params_max[param] ?? 0;
}

/**
 * A parameter's curve. Godot fits an empty curve's range to the parameter here
 * (`_adjust_curve_range`); the converted system fits it as it takes the curve
 * (`CPUParticles3D::set_param_curve`), so the material keeps the curve as given.
 *
 * @godot ParticleProcessMaterial.set_param_texture
 * @source scene/resources/particle_process_material.cpp:1609
 */
export function set_param_texture(self: ParticleProcessMaterial, param: number, texture: CurveTexture | null): void {
  if (param < 0 || param >= PARAM_MAX) return;
  self.tex_parameters[param] = texture;
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_param_texture
 * @source scene/resources/particle_process_material.cpp:1693
 */
export function get_param_texture(self: ParticleProcessMaterial, param: number): CurveTexture | null {
  return self.tex_parameters[param] ?? null;
}

/**
 * @godot ParticleProcessMaterial.set_color
 * @source scene/resources/particle_process_material.cpp:1699
 */
export function set_color(self: ParticleProcessMaterial, value: Color): void {
  self.color = value;
  changed(self);
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
export function set_color_ramp(self: ParticleProcessMaterial, ramp: GradientTexture1D | null): void {
  self.color_ramp = ramp;
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_color_ramp
 * @source scene/resources/particle_process_material.cpp:1716
 */
export function get_color_ramp(self: ParticleProcessMaterial): GradientTexture1D | null {
  return self.color_ramp;
}

/**
 * @godot ParticleProcessMaterial.set_color_initial_ramp
 * @source scene/resources/particle_process_material.cpp:1720
 */
export function set_color_initial_ramp(self: ParticleProcessMaterial, ramp: GradientTexture1D | null): void {
  self.color_initial_ramp = ramp;
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_color_initial_ramp
 * @source scene/resources/particle_process_material.cpp:1728
 */
export function get_color_initial_ramp(self: ParticleProcessMaterial): GradientTexture1D | null {
  return self.color_initial_ramp;
}

/**
 * A flag out of range fails.
 *
 * @godot ParticleProcessMaterial.set_particle_flag
 * @source scene/resources/particle_process_material.cpp:1732
 */
export function set_particle_flag(self: ParticleProcessMaterial, flag: number, enable: boolean): void {
  if (flag < 0 || flag >= PARTICLE_FLAG_MAX) return;
  self.particle_flags[flag] = enable;
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_particle_flag
 * @source scene/resources/particle_process_material.cpp:1777
 */
export function get_particle_flag(self: ParticleProcessMaterial, flag: number): boolean {
  return self.particle_flags[flag] ?? false;
}

/**
 * The particle's alpha over its life, which the material's shader multiplies in after the colour
 * ramp (`particle_process_material.cpp:688`).
 *
 * @godot ParticleProcessMaterial.set_alpha_curve
 * @source scene/resources/particle_process_material.cpp:1741
 */
export function set_alpha_curve(self: ParticleProcessMaterial, curve: CurveTexture | null): void {
  self.alpha_curve = curve;
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_alpha_curve
 * @source scene/resources/particle_process_material.cpp:1749
 */
export function get_alpha_curve(self: ParticleProcessMaterial): CurveTexture | null {
  return self.alpha_curve;
}

/**
 * A shape out of range fails.
 *
 * @godot ParticleProcessMaterial.set_emission_shape
 * @source scene/resources/particle_process_material.cpp:1782
 */
export function set_emission_shape(self: ParticleProcessMaterial, shape: number): void {
  if (shape < 0 || shape >= EMISSION_SHAPE_MAX) return;
  self.emission_shape = shape;
  changed(self);
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
export function set_emission_sphere_radius(self: ParticleProcessMaterial, radius: number): void {
  self.emission_sphere_radius = f32(radius);
  changed(self);
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
export function set_emission_box_extents(self: ParticleProcessMaterial, extents: Vector3): void {
  self.emission_box_extents = vector3(extents);
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_emission_box_extents
 * @source scene/resources/particle_process_material.cpp:1885
 */
export function get_emission_box_extents(self: ParticleProcessMaterial): Vector3 {
  return vector3(self.emission_box_extents);
}

/**
 * @godot ParticleProcessMaterial.set_gravity
 * @source scene/resources/particle_process_material.cpp:2116
 */
export function set_gravity(self: ParticleProcessMaterial, gravity: Vector3): void {
  self.gravity = vector3(gravity);
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_gravity
 * @source scene/resources/particle_process_material.cpp:2125
 */
export function get_gravity(self: ParticleProcessMaterial): Vector3 {
  return vector3(self.gravity);
}

/**
 * @godot ParticleProcessMaterial.set_lifetime_randomness
 * @source scene/resources/particle_process_material.cpp:2129
 */
export function set_lifetime_randomness(self: ParticleProcessMaterial, randomness: number): void {
  self.lifetime_randomness = randomness;
  changed(self);
}

/**
 * @godot ParticleProcessMaterial.get_lifetime_randomness
 * @source scene/resources/particle_process_material.cpp:2134
 */
export function get_lifetime_randomness(self: ParticleProcessMaterial): number {
  return self.lifetime_randomness;
}

/** A scene's `Vector3` or `Color` prop, its components as written. */
const components = (value: unknown): readonly number[] => value as readonly number[];

/** A scene's `<name>_min`, `<name>_max` and `<name>_curve` props, by parameter (`particle_process_material.cpp:2562`). */
const PARAMS: Readonly<Record<string, number>> = {
  initialVelocity: 0,
  angularVelocity: 1,
  orbitVelocity: 2,
  linearAccel: 3,
  radialAccel: 4,
  tangentialAccel: 5,
  damping: 6,
  angle: 7,
  scale: 8,
  hueVariation: 9,
  animSpeed: 10,
  animOffset: 11,
};

/** A scene's `particle_flag_*` props, by flag (`particle_process_material.cpp:2569`). */
const FLAGS: Readonly<Record<string, number>> = {
  particleFlagAlignY: 0,
  particleFlagRotateY: 1,
  particleFlagDisableZ: 2,
};

/**
 * A ParticleProcessMaterial of the properties a scene states (by Godot's property names, in camel
 * case), set in the order given; an unknown one fails by name.
 *
 * @godot ParticleProcessMaterial (protocol)
 * @source scene/resources/particle_process_material.cpp:2747
 */
export function godot_particle_process_material_new(properties: Readonly<Record<string, unknown>> = {}): ParticleProcessMaterial {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    const ranged = /^(.*)(Min|Max|Curve)$/u.exec(property);
    const param = ranged === null ? undefined : PARAMS[ranged[1] as string];
    const flag = FLAGS[property];
    if (ranged !== null && param !== undefined) {
      if (ranged[2] === 'Min') set_param_min(self, param, value as number);
      else if (ranged[2] === 'Max') set_param_max(self, param, value as number);
      else set_param_texture(self, param, value as CurveTexture | null);
    } else if (flag !== undefined) set_particle_flag(self, flag, value as boolean);
    else if (property === 'direction') set_direction(self, vector3(...(components(value) as [number, number, number])));
    else if (property === 'spread') set_spread(self, value as number);
    else if (property === 'flatness') set_flatness(self, value as number);
    else if (property === 'color') {
      const [r, g, b, a] = components(value);
      set_color(self, color(r as number, g as number, b as number, a ?? 1));
    } else if (property === 'colorRamp') set_color_ramp(self, value as GradientTexture1D | null);
    else if (property === 'colorInitialRamp') set_color_initial_ramp(self, value as GradientTexture1D | null);
    else if (property === 'alphaCurve') set_alpha_curve(self, value as CurveTexture | null);
    else if (property === 'emissionShape') set_emission_shape(self, value as number);
    else if (property === 'emissionSphereRadius') set_emission_sphere_radius(self, value as number);
    else if (property === 'emissionBoxExtents') set_emission_box_extents(self, vector3(...(components(value) as [number, number, number])));
    else if (property === 'gravity') set_gravity(self, vector3(...(components(value) as [number, number, number])));
    else if (property === 'lifetimeRandomness') set_lifetime_randomness(self, value as number);
    else throw new Error(`godot-compat: ParticleProcessMaterial has no ${property} property.`);
  }
  return self;
}
