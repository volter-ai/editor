/**
 * @godot-class GPUParticles3D
 * @role BINDING
 *
 * Godot 4.7's `GPUParticles3D` (`scene/3d/gpu_particles_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the CPU particle system Godot itself converts it to
 * (`CPUParticles3D::convert_from_particles`, `scene/3d/cpu_particles_3d.cpp:1460`): the node is a
 * `<GodotCPUParticles3D>`'s simulation (`cpu-particles-3d.ts`), its own properties set on it as the
 * conversion copies them, and its process material's parameters converted onto it as that function
 * converts them, again whenever the material or one of its parameters changes. The GPU's particle
 * storage and process shader are not ported.
 *
 * Carried beyond the conversion: the material override the node draws with (`GeometryInstance3D`)
 * and the process material's alpha curve. Not carried, and refused by name at import when a scene
 * states them: sub-emitters, trails, collision, transform alignment, the amount ratio, draw orders
 * other than by index and more than one draw pass. `interpolate` is stored and not drawn: the CPU
 * system, like the converted node, draws its last fixed step.
 */

import type { ReactElement } from 'react';
import { type BufferGeometry, Group, type Material } from 'three';
import {
  get_amount as cpu_get_amount,
  get_explosiveness_ratio as cpu_get_explosiveness_ratio,
  get_fixed_fps as cpu_get_fixed_fps,
  get_fractional_delta as cpu_get_fractional_delta,
  get_lifetime as cpu_get_lifetime,
  get_one_shot as cpu_get_one_shot,
  get_pre_process_time as cpu_get_pre_process_time,
  get_randomness_ratio as cpu_get_randomness_ratio,
  get_seed as cpu_get_seed,
  get_speed_scale as cpu_get_speed_scale,
  get_use_fixed_seed as cpu_get_use_fixed_seed,
  get_use_local_coordinates as cpu_get_use_local_coordinates,
  godot_cpu_particles_3d_adopt,
  godot_cpu_particles_3d_alpha_curve,
  godot_cpu_particles_3d_cast_shadow,
  godot_cpu_particles_3d_draw_with,
  is_emitting as cpu_is_emitting,
  restart as cpu_restart,
  set_amount as cpu_set_amount,
  set_color as cpu_set_color,
  set_color_initial_ramp as cpu_set_color_initial_ramp,
  set_color_ramp as cpu_set_color_ramp,
  set_direction as cpu_set_direction,
  set_emission_box_extents as cpu_set_emission_box_extents,
  set_emission_shape as cpu_set_emission_shape,
  set_emission_sphere_radius as cpu_set_emission_sphere_radius,
  set_emitting as cpu_set_emitting,
  set_explosiveness_ratio as cpu_set_explosiveness_ratio,
  set_fixed_fps as cpu_set_fixed_fps,
  set_flatness as cpu_set_flatness,
  set_fractional_delta as cpu_set_fractional_delta,
  set_gravity as cpu_set_gravity,
  set_lifetime as cpu_set_lifetime,
  set_lifetime_randomness as cpu_set_lifetime_randomness,
  set_mesh as cpu_set_mesh,
  set_one_shot as cpu_set_one_shot,
  set_param_curve as cpu_set_param_curve,
  set_param_max as cpu_set_param_max,
  set_param_min as cpu_set_param_min,
  set_particle_flag as cpu_set_particle_flag,
  set_pre_process_time as cpu_set_pre_process_time,
  set_randomness_ratio as cpu_set_randomness_ratio,
  set_seed as cpu_set_seed,
  set_speed_scale as cpu_set_speed_scale,
  set_spread as cpu_set_spread,
  set_use_fixed_seed as cpu_set_use_fixed_seed,
  set_use_local_coordinates as cpu_set_use_local_coordinates,
  set_visibility_aabb as cpu_set_visibility_aabb,
} from './cpu-particles-3d';
import { godot_geometry_instance_3d_material_override, set_transparency } from './geometry-instance-3d';
import { get_gradient } from './gradient-texture-1d';
import { get_curve } from './curve-texture';
import { type ParticleProcessMaterial, godot_particle_process_material_listen } from './particle-process-material';
import type { PrimitiveMesh } from './primitive-mesh';
import { type GodotElementClass, type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

/** `CPUParticles3D::PARAM_ANIM_OFFSET` (`cpu_particles_3d.h:64`): the last parameter the conversion carries. */
const PARAM_ANIM_OFFSET = 11;
/** `GPUParticles3D::MAX_DRAW_PASSES` (`gpu_particles_3d.h:59`). */
const MAX_DRAW_PASSES = 4;

/** What the node holds that the CPU system does not. */
interface GPUParticles3DState {
  process_material: ParticleProcessMaterial | null;
  /** Stops hearing the process material's changes. */
  unlisten: (() => void) | null;
  draw_passes: (PrimitiveMesh | null)[];
  interpolate: boolean;
  draw_order: number;
  visibility_aabb: unknown;
}

const STATE = new WeakMap<object, GPUParticles3DState>();

function stateOf(self: object, member: string): GPUParticles3DState {
  const state = STATE.get(self);
  if (state === undefined) throw new TypeError(`godot-compat: GPUParticles3D.${member} requires a GPUParticles3D.`);
  return state;
}

/**
 * The process material's parameters converted onto the CPU system
 * (`CPUParticles3D::convert_from_particles`, `cpu_particles_3d.cpp:1479`), plus its alpha curve. A
 * curve or ramp the material no longer holds is cleared, as a system converted afresh holds none.
 */
function convert(self: object, material: ParticleProcessMaterial | null): void {
  if (material === null) return;
  cpu_set_direction(self, material.direction);
  cpu_set_spread(self, material.spread);
  cpu_set_flatness(self, material.flatness);
  cpu_set_color(self, material.color);
  cpu_set_color_ramp(self, material.color_ramp === null ? null : get_gradient(material.color_ramp));
  cpu_set_color_initial_ramp(self, material.color_initial_ramp === null ? null : get_gradient(material.color_initial_ramp));
  // Align Y, rotate Y, disable Z (`:1500`-`:1502`): the first three flags, the same in both classes.
  for (let flag = 0; flag < 3; flag += 1) cpu_set_particle_flag(self, flag, material.particle_flags[flag] === true);
  cpu_set_emission_shape(self, material.emission_shape);
  cpu_set_emission_sphere_radius(self, material.emission_sphere_radius);
  cpu_set_emission_box_extents(self, material.emission_box_extents);
  cpu_set_gravity(self, material.gravity);
  cpu_set_lifetime_randomness(self, material.lifetime_randomness);
  // `CONVERT_PARAM` (`:1523`): the minimum, the curve, the maximum, for each shared parameter.
  for (let param = 0; param <= PARAM_ANIM_OFFSET; param += 1) {
    cpu_set_param_min(self, param, material.params_min[param] as number);
    const texture = material.tex_parameters[param] ?? null;
    cpu_set_param_curve(self, param, texture === null ? null : get_curve(texture));
    cpu_set_param_max(self, param, material.params_max[param] as number);
  }
  godot_cpu_particles_3d_alpha_curve(self, material.alpha_curve === null ? null : get_curve(material.alpha_curve));
}

/**
 * Makes `entity` a GPUParticles3D with Godot's defaults (`GPUParticles3D::GPUParticles3D`): the CPU
 * system it converts to, with the GPU node's 30 fixed frames a second (`:944`) and one draw pass.
 *
 * @godot GPUParticles3D (protocol)
 * @source scene/3d/gpu_particles_3d.cpp:933
 */
export function godot_gpu_particles_3d_adopt(entity: object): void {
  if (STATE.has(entity)) return;
  godot_cpu_particles_3d_adopt(entity);
  cpu_set_fixed_fps(entity, 30);
  STATE.set(entity, { process_material: null, unlisten: null, draw_passes: [null], interpolate: true, draw_order: 0, visibility_aabb: null });
}

/**
 * @godot GPUParticles3D.set_emitting
 * @source scene/3d/gpu_particles_3d.cpp:49
 */
export function set_emitting(self: object, emitting: boolean): void {
  cpu_set_emitting(self, emitting);
}

/**
 * @godot GPUParticles3D.is_emitting
 * @source scene/3d/gpu_particles_3d.cpp:189
 */
export function is_emitting(self: object): boolean {
  return cpu_is_emitting(self);
}

/**
 * @godot GPUParticles3D.set_amount
 * @source scene/3d/gpu_particles_3d.cpp:80
 */
export function set_amount(self: object, amount: number): void {
  cpu_set_amount(self, amount);
}

/**
 * @godot GPUParticles3D.get_amount
 * @source scene/3d/gpu_particles_3d.cpp:193
 */
export function get_amount(self: object): number {
  return cpu_get_amount(self);
}

/**
 * @godot GPUParticles3D.set_lifetime
 * @source scene/3d/gpu_particles_3d.cpp:86
 */
export function set_lifetime(self: object, lifetime: number): void {
  cpu_set_lifetime(self, lifetime);
}

/**
 * @godot GPUParticles3D.get_lifetime
 * @source scene/3d/gpu_particles_3d.cpp:197
 */
export function get_lifetime(self: object): number {
  return cpu_get_lifetime(self);
}

/**
 * @godot GPUParticles3D.set_one_shot
 * @source scene/3d/gpu_particles_3d.cpp:97
 */
export function set_one_shot(self: object, one_shot: boolean): void {
  cpu_set_one_shot(self, one_shot);
}

/**
 * @godot GPUParticles3D.get_one_shot
 * @source scene/3d/gpu_particles_3d.cpp:205
 */
export function get_one_shot(self: object): boolean {
  return cpu_get_one_shot(self);
}

/**
 * @godot GPUParticles3D.set_pre_process_time
 * @source scene/3d/gpu_particles_3d.cpp:129
 */
export function set_pre_process_time(self: object, time: number): void {
  cpu_set_pre_process_time(self, time);
}

/**
 * @godot GPUParticles3D.get_pre_process_time
 * @source scene/3d/gpu_particles_3d.cpp:209
 */
export function get_pre_process_time(self: object): number {
  return cpu_get_pre_process_time(self);
}

/**
 * @godot GPUParticles3D.set_explosiveness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:134
 */
export function set_explosiveness_ratio(self: object, ratio: number): void {
  cpu_set_explosiveness_ratio(self, ratio);
}

/**
 * @godot GPUParticles3D.get_explosiveness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:213
 */
export function get_explosiveness_ratio(self: object): number {
  return cpu_get_explosiveness_ratio(self);
}

/**
 * @godot GPUParticles3D.set_randomness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:139
 */
export function set_randomness_ratio(self: object, ratio: number): void {
  cpu_set_randomness_ratio(self, ratio);
}

/**
 * @godot GPUParticles3D.get_randomness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:217
 */
export function get_randomness_ratio(self: object): number {
  return cpu_get_randomness_ratio(self);
}

/**
 * The bounds the node reports to culling; the CPU system draws its instances unculled.
 *
 * @godot GPUParticles3D.set_visibility_aabb
 * @source scene/3d/gpu_particles_3d.cpp:144
 */
export function set_visibility_aabb(self: object, aabb: unknown): void {
  stateOf(self, 'set_visibility_aabb').visibility_aabb = aabb;
  cpu_set_visibility_aabb(self, aabb);
}

/**
 * @godot GPUParticles3D.get_visibility_aabb
 * @source scene/3d/gpu_particles_3d.cpp:221
 */
export function get_visibility_aabb(self: object): unknown {
  return stateOf(self, 'get_visibility_aabb').visibility_aabb;
}

/**
 * @godot GPUParticles3D.set_use_local_coordinates
 * @source scene/3d/gpu_particles_3d.cpp:150
 */
export function set_use_local_coordinates(self: object, enable: boolean): void {
  cpu_set_use_local_coordinates(self, enable);
}

/**
 * @godot GPUParticles3D.get_use_local_coordinates
 * @source scene/3d/gpu_particles_3d.cpp:225
 */
export function get_use_local_coordinates(self: object): boolean {
  return cpu_get_use_local_coordinates(self);
}

/**
 * The process material, converted onto the CPU system now and again at each change to it.
 *
 * @godot GPUParticles3D.set_process_material
 * @source scene/3d/gpu_particles_3d.cpp:155
 */
export function set_process_material(self: object, material: ParticleProcessMaterial | null): void {
  const state = stateOf(self, 'set_process_material');
  state.unlisten?.();
  state.process_material = material;
  state.unlisten = material === null ? null : godot_particle_process_material_listen(material, () => convert(self, material));
  convert(self, material);
}

/**
 * @godot GPUParticles3D.get_process_material
 * @source scene/3d/gpu_particles_3d.cpp:229
 */
export function get_process_material(self: object): ParticleProcessMaterial | null {
  return stateOf(self, 'get_process_material').process_material;
}

/**
 * @godot GPUParticles3D.set_speed_scale
 * @source scene/3d/gpu_particles_3d.cpp:179
 */
export function set_speed_scale(self: object, scale: number): void {
  cpu_set_speed_scale(self, scale);
}

/**
 * @godot GPUParticles3D.get_speed_scale
 * @source scene/3d/gpu_particles_3d.cpp:233
 */
export function get_speed_scale(self: object): number {
  return cpu_get_speed_scale(self);
}

/**
 * Only drawing by index is drawn (`cpu-particles-3d.ts`): another order fails by name.
 *
 * @godot GPUParticles3D.set_draw_order
 * @source scene/3d/gpu_particles_3d.cpp:241
 */
export function set_draw_order(self: object, order: number): void {
  if (order !== 0) throw new Error('godot-compat: GPUParticles3D draw orders other than by index are not drawn.');
  stateOf(self, 'set_draw_order').draw_order = order;
}

/**
 * @godot GPUParticles3D.get_draw_order
 * @source scene/3d/gpu_particles_3d.cpp:266
 */
export function get_draw_order(self: object): number {
  return stateOf(self, 'get_draw_order').draw_order;
}

/**
 * Fewer than one fails; the conversion draws the first pass's mesh only, so more than one fails
 * by name.
 *
 * @godot GPUParticles3D.set_draw_passes
 * @source scene/3d/gpu_particles_3d.cpp:270
 */
export function set_draw_passes(self: object, count: number): void {
  const state = stateOf(self, 'set_draw_passes');
  if (count < 1 || count > MAX_DRAW_PASSES) return;
  if (count > 1) throw new Error('godot-compat: GPUParticles3D draw passes after the first are not drawn.');
  state.draw_passes = state.draw_passes.slice(0, count);
}

/**
 * @godot GPUParticles3D.get_draw_passes
 * @source scene/3d/gpu_particles_3d.cpp:280
 */
export function get_draw_passes(self: object): number {
  return stateOf(self, 'get_draw_passes').draw_passes.length;
}

/**
 * A pass outside the node's passes fails; the first pass's mesh is the CPU system's mesh (`:1477`).
 *
 * @godot GPUParticles3D.set_draw_pass_mesh
 * @source scene/3d/gpu_particles_3d.cpp:284
 */
export function set_draw_pass_mesh(self: object, pass: number, mesh: PrimitiveMesh | null): void {
  const state = stateOf(self, 'set_draw_pass_mesh');
  if (pass < 0 || pass >= state.draw_passes.length) return;
  state.draw_passes[pass] = mesh;
  if (pass === 0) cpu_set_mesh(self, mesh);
}

/**
 * @godot GPUParticles3D.get_draw_pass_mesh
 * @source scene/3d/gpu_particles_3d.cpp:308
 */
export function get_draw_pass_mesh(self: object, pass: number): PrimitiveMesh | null {
  return stateOf(self, 'get_draw_pass_mesh').draw_passes[pass] ?? null;
}

/**
 * @godot GPUParticles3D.set_fixed_fps
 * @source scene/3d/gpu_particles_3d.cpp:314
 */
export function set_fixed_fps(self: object, fps: number): void {
  cpu_set_fixed_fps(self, fps);
}

/**
 * @godot GPUParticles3D.get_fixed_fps
 * @source scene/3d/gpu_particles_3d.cpp:319
 */
export function get_fixed_fps(self: object): number {
  return cpu_get_fixed_fps(self);
}

/**
 * @godot GPUParticles3D.set_fractional_delta
 * @source scene/3d/gpu_particles_3d.cpp:323
 */
export function set_fractional_delta(self: object, enable: boolean): void {
  cpu_set_fractional_delta(self, enable);
}

/**
 * @godot GPUParticles3D.get_fractional_delta
 * @source scene/3d/gpu_particles_3d.cpp:328
 */
export function get_fractional_delta(self: object): boolean {
  return cpu_get_fractional_delta(self);
}

/**
 * Stored; the CPU system draws its last step, as the converted node does.
 *
 * @godot GPUParticles3D.set_interpolate
 * @source scene/3d/gpu_particles_3d.cpp:332
 */
export function set_interpolate(self: object, enable: boolean): void {
  stateOf(self, 'set_interpolate').interpolate = enable;
}

/**
 * @godot GPUParticles3D.get_interpolate
 * @source scene/3d/gpu_particles_3d.cpp:337
 */
export function get_interpolate(self: object): boolean {
  return stateOf(self, 'get_interpolate').interpolate;
}

/**
 * @godot GPUParticles3D.set_use_fixed_seed
 * @source scene/3d/gpu_particles_3d.cpp:108
 */
export function set_use_fixed_seed(self: object, use: boolean): void {
  cpu_set_use_fixed_seed(self, use);
}

/**
 * @godot GPUParticles3D.get_use_fixed_seed
 * @source scene/3d/gpu_particles_3d.cpp:116
 */
export function get_use_fixed_seed(self: object): boolean {
  return cpu_get_use_fixed_seed(self);
}

/**
 * @godot GPUParticles3D.set_seed
 * @source scene/3d/gpu_particles_3d.cpp:120
 */
export function set_seed(self: object, seed: number): void {
  cpu_set_seed(self, seed);
}

/**
 * @godot GPUParticles3D.get_seed
 * @source scene/3d/gpu_particles_3d.cpp:125
 */
export function get_seed(self: object): number {
  return cpu_get_seed(self);
}

/**
 * @godot GPUParticles3D.restart
 * @source scene/3d/gpu_particles_3d.cpp:442
 */
export function restart(self: object, keep_seed = false): void {
  cpu_restart(self, keep_seed);
}

// The node's class, for a GPUParticles3D its JSX declares.
const GPU_PARTICLES_3D = Object.freeze(['GPUParticles3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object']);

/** The props a scene states on `<GodotGPUParticles3D>`, by the setter each calls. */
const GPU_PARTICLES_3D_ELEMENT: GodotElementClass<Group> = {
  advances: true,
  create: () => new Group(),
  classes: GPU_PARTICLES_3D,
  spatial: true,
  mount: (entity) => godot_gpu_particles_3d_adopt(entity),
  props: new Map<string, GodotElementProp<Group>>([
    ['emitting', (self, value: boolean) => set_emitting(self, value)],
    ['amount', (self, value: number) => set_amount(self, value)],
    ['lifetime', (self, value: number) => set_lifetime(self, value)],
    ['oneShot', (self, value: boolean) => set_one_shot(self, value)],
    ['preprocess', (self, value: number) => set_pre_process_time(self, value)],
    ['speedScale', (self, value: number) => set_speed_scale(self, value)],
    ['explosiveness', (self, value: number) => set_explosiveness_ratio(self, value)],
    ['randomness', (self, value: number) => set_randomness_ratio(self, value)],
    ['useFixedSeed', (self, value: boolean) => set_use_fixed_seed(self, value)],
    ['seed', (self, value: number) => set_seed(self, value)],
    ['fixedFps', (self, value: number) => set_fixed_fps(self, value)],
    ['interpolate', (self, value: boolean) => set_interpolate(self, value)],
    ['fractDelta', (self, value: boolean) => set_fractional_delta(self, value)],
    ['visibilityAabb', (self, value: unknown) => set_visibility_aabb(self, value)],
    ['localCoords', (self, value: boolean) => set_use_local_coordinates(self, value)],
    ['processMaterial', (self, value: ParticleProcessMaterial | null) => set_process_material(self, value)],
    ['drawPasses', (self, value: number) => set_draw_passes(self, value)],
    // The first pass's mesh as three's geometry and its surface material, as a scene states a drawn mesh.
    ['geometry', (self, value: BufferGeometry) => godot_cpu_particles_3d_draw_with(self, value, undefined)],
    ['material', (self, value: Material) => godot_cpu_particles_3d_draw_with(self, undefined, value)],
    ['drawPass1', (self, value: PrimitiveMesh | null) => set_draw_pass_mesh(self, 0, value)],
    ['materialOverride', (self, value: Material) => godot_geometry_instance_3d_material_override(self, value)],
    ['castShadow', (self, value: number) => godot_cpu_particles_3d_cast_shadow(self, value)],
    ['transparency', (self, value: number) => set_transparency(self, value)],
  ]),
};

/**
 * A GPUParticles3D as a scene writes it (`gpu_particles_3d.cpp:869`: its properties): a group the
 * converted CPU system's state is kept on, drawing its particles as an `InstancedMesh` child.
 *
 * @godot GPUParticles3D (protocol)
 * @source scene/3d/gpu_particles_3d.cpp:869
 */
export function GodotGPUParticles3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(GPU_PARTICLES_3D_ELEMENT, props);
}
