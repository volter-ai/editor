/**
 * @godot-class GPUParticles3D
 * @role BINDING
 *
 * Godot 4.7's `GPUParticles3D` (`scene/3d/gpu_particles_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a three.js particle system: the same emitter a
 * CPUParticles3D is (`cpu-particles-3d.ts`: an `InstancedMesh` of the first draw pass's mesh,
 * updated from the node's own frame), its particles doing what its process material says
 * (`particle-process-material.ts`), read each frame. Where Godot runs the material as a particle
 * shader on the GPU, here a few hundred particles are moved on the CPU, as a three.js scene moves
 * them.
 *
 * Also drawn: the node's material override (`GeometryInstance3D`) and its transform alignment, by the
 * camera three last drew the particles with. Stored and not used: `interpolate`,
 * `fixed_fps`, `fractional_delta`, the seed and the visibility AABB. Not drawn, and refused by name
 * at import when a scene states them: sub-emitters, trails, collision, the
 * amount ratio, draw orders other than by index and more than one draw pass.
 */

import type { ReactElement } from 'react';
import { type BufferGeometry, Group, type Material, type Object3D } from 'three';
import {
  get_amount as particles_get_amount,
  get_explosiveness_ratio as particles_get_explosiveness_ratio,
  get_fixed_fps as particles_get_fixed_fps,
  get_fractional_delta as particles_get_fractional_delta,
  get_lifetime as particles_get_lifetime,
  get_one_shot as particles_get_one_shot,
  get_pre_process_time as particles_get_pre_process_time,
  get_randomness_ratio as particles_get_randomness_ratio,
  get_seed as particles_get_seed,
  get_speed_scale as particles_get_speed_scale,
  get_use_fixed_seed as particles_get_use_fixed_seed,
  get_use_local_coordinates as particles_get_use_local_coordinates,
  get_visibility_aabb as particles_get_visibility_aabb,
  finished as particles_finished,
  godot_cpu_particles_3d_cast_shadow,
  godot_cpu_particles_3d_draw_with,
  godot_particles_3d_adopt,
  is_emitting as particles_is_emitting,
  type ParticleProcess,
  restart as particles_restart,
  set_amount as particles_set_amount,
  set_emitting as particles_set_emitting,
  set_explosiveness_ratio as particles_set_explosiveness_ratio,
  set_fixed_fps as particles_set_fixed_fps,
  set_fractional_delta as particles_set_fractional_delta,
  set_lifetime as particles_set_lifetime,
  set_mesh as particles_set_mesh,
  set_one_shot as particles_set_one_shot,
  set_pre_process_time as particles_set_pre_process_time,
  set_randomness_ratio as particles_set_randomness_ratio,
  set_seed as particles_set_seed,
  set_speed_scale as particles_set_speed_scale,
  set_use_fixed_seed as particles_set_use_fixed_seed,
  set_use_local_coordinates as particles_set_use_local_coordinates,
  set_visibility_aabb as particles_set_visibility_aabb,
} from './cpu-particles-3d';
import { get_curve } from './curve-texture';
import { godot_geometry_instance_3d_material_override, set_transparency } from './geometry-instance-3d';
import { get_gradient } from './gradient-texture-1d';
import type { ParticleProcessMaterial } from './particle-process-material';
import type { PrimitiveMesh } from './primitive-mesh';
import { type GodotElementClass, type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import type { GodotSignal } from './signal';

/** `GPUParticles3D::MAX_DRAW_PASSES` (`gpu_particles_3d.h:59`). */
const MAX_DRAW_PASSES = 4;

/** What the node holds besides its emitter. */
interface GPUParticles3DState {
  process_material: ParticleProcessMaterial | null;
  /** `TransformAlign` (`gpu_particles_3d.h:51`), which the emitter draws each particle with. */
  transform_align: number;
  /** The custom value a view-facing particle turns by (`gpu_particles_3d.h`, 4.7). */
  transform_align_channel_filter: number;
  draw_passes: (PrimitiveMesh | null)[];
  interpolate: boolean;
  draw_order: number;
}

const STATE = new WeakMap<object, GPUParticles3DState>();

function stateOf(self: object, member: string): GPUParticles3DState {
  const state = STATE.get(self);
  if (state === undefined) throw new TypeError(`godot-compat: GPUParticles3D.${member} requires a GPUParticles3D.`);
  return state;
}

/** The process material as the values the emitter reads: its curves and ramps are its textures'. */
function processOf(material: ParticleProcessMaterial | null, transformAlign = 0, channelFilter = 0): ParticleProcess | null {
  if (material === null) return null;
  return {
    transform_align: transformAlign,
    transform_align_channel_filter: channelFilter,
    direction: material.direction,
    spread: material.spread,
    flatness: material.flatness,
    gravity: material.gravity,
    params_min: material.params_min,
    params_max: material.params_max,
    curves: material.tex_parameters.map((texture) => (texture === null ? null : get_curve(texture))),
    color: material.color,
    color_ramp: material.color_ramp === null ? null : get_gradient(material.color_ramp),
    color_initial_ramp: material.color_initial_ramp === null ? null : get_gradient(material.color_initial_ramp),
    alpha_curve: material.alpha_curve === null ? null : get_curve(material.alpha_curve),
    emission_shape: material.emission_shape,
    emission_sphere_radius: material.emission_sphere_radius,
    emission_box_extents: material.emission_box_extents,
    emission_ring: { axis: material.emission_ring_axis, height: material.emission_ring_height, radius: material.emission_ring_radius, inner: material.emission_ring_inner_radius },
    lifetime_randomness: material.lifetime_randomness,
    particle_flags: material.particle_flags,
  };
}

/**
 * Makes `entity` a GPUParticles3D with Godot's defaults (`GPUParticles3D::GPUParticles3D`): the
 * particle system, emitting 8 particles a second, reading its process material (none yet: nothing
 * is emitted without one) and drawing one pass.
 *
 * @godot GPUParticles3D (protocol)
 * @source scene/3d/gpu_particles_3d.cpp:933
 */
export function godot_gpu_particles_3d_adopt(entity: Object3D): void {
  if (STATE.has(entity)) return;
  const state: GPUParticles3DState = { process_material: null, transform_align: 0, transform_align_channel_filter: 0, draw_passes: [null], interpolate: true, draw_order: 0 };
  STATE.set(entity, state);
  godot_particles_3d_adopt(entity, () => processOf(state.process_material, state.transform_align, state.transform_align_channel_filter));
  particles_set_fixed_fps(entity, 30);
}

/**
 * Emitted once the system has stopped emitting and its last particle has died.
 *
 * @godot GPUParticles3D.finished
 * @source scene/3d/gpu_particles_3d.cpp:867
 */
export function finished(self: object): GodotSignal<[]> {
  return particles_finished(self);
}

/**
 * Whether new particles are emitted, as a CPUParticles3D's: a one-shot or finished system starts a
 * new cycle, a running one carries on its cycle; stopping lets the live particles finish their lives.
 *
 * @godot GPUParticles3D.set_emitting
 * @source scene/3d/gpu_particles_3d.cpp:49
 */
export function set_emitting(self: object, emitting: boolean): void {
  particles_set_emitting(self, emitting);
}

/**
 * @godot GPUParticles3D.is_emitting
 * @source scene/3d/gpu_particles_3d.cpp:189
 */
export function is_emitting(self: object): boolean {
  return particles_is_emitting(self);
}

/**
 * How many particles one cycle emits.
 *
 * @godot GPUParticles3D.set_amount
 * @source scene/3d/gpu_particles_3d.cpp:80
 */
export function set_amount(self: object, amount: number): void {
  particles_set_amount(self, amount);
}

/**
 * @godot GPUParticles3D.get_amount
 * @source scene/3d/gpu_particles_3d.cpp:193
 */
export function get_amount(self: object): number {
  return particles_get_amount(self);
}

/**
 * How long each particle lives, in seconds.
 *
 * @godot GPUParticles3D.set_lifetime
 * @source scene/3d/gpu_particles_3d.cpp:86
 */
export function set_lifetime(self: object, lifetime: number): void {
  particles_set_lifetime(self, lifetime);
}

/**
 * @godot GPUParticles3D.get_lifetime
 * @source scene/3d/gpu_particles_3d.cpp:197
 */
export function get_lifetime(self: object): number {
  return particles_get_lifetime(self);
}

/**
 * Whether the system emits one cycle and stops.
 *
 * @godot GPUParticles3D.set_one_shot
 * @source scene/3d/gpu_particles_3d.cpp:97
 */
export function set_one_shot(self: object, one_shot: boolean): void {
  particles_set_one_shot(self, one_shot);
}

/**
 * @godot GPUParticles3D.get_one_shot
 * @source scene/3d/gpu_particles_3d.cpp:205
 */
export function get_one_shot(self: object): boolean {
  return particles_get_one_shot(self);
}

/**
 * Seconds the system has already run when it starts emitting.
 *
 * @godot GPUParticles3D.set_pre_process_time
 * @source scene/3d/gpu_particles_3d.cpp:129
 */
export function set_pre_process_time(self: object, time: number): void {
  particles_set_pre_process_time(self, time);
}

/**
 * @godot GPUParticles3D.get_pre_process_time
 * @source scene/3d/gpu_particles_3d.cpp:209
 */
export function get_pre_process_time(self: object): number {
  return particles_get_pre_process_time(self);
}

/**
 * How much of a cycle's particles are emitted at once at its start.
 *
 * @godot GPUParticles3D.set_explosiveness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:134
 */
export function set_explosiveness_ratio(self: object, ratio: number): void {
  particles_set_explosiveness_ratio(self, ratio);
}

/**
 * @godot GPUParticles3D.get_explosiveness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:213
 */
export function get_explosiveness_ratio(self: object): number {
  return particles_get_explosiveness_ratio(self);
}

/**
 * How much the particles' emission times are randomized.
 *
 * @godot GPUParticles3D.set_randomness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:139
 */
export function set_randomness_ratio(self: object, ratio: number): void {
  particles_set_randomness_ratio(self, ratio);
}

/**
 * @godot GPUParticles3D.get_randomness_ratio
 * @source scene/3d/gpu_particles_3d.cpp:217
 */
export function get_randomness_ratio(self: object): number {
  return particles_get_randomness_ratio(self);
}

/**
 * Stored: the particles are drawn unculled.
 *
 * @godot GPUParticles3D.set_visibility_aabb
 * @source scene/3d/gpu_particles_3d.cpp:144
 */
export function set_visibility_aabb(self: object, aabb: unknown): void {
  particles_set_visibility_aabb(self, aabb);
}

/**
 * @godot GPUParticles3D.get_visibility_aabb
 * @source scene/3d/gpu_particles_3d.cpp:221
 */
export function get_visibility_aabb(self: object): unknown {
  return particles_get_visibility_aabb(self);
}

/**
 * Whether the particles move with the node (true) or stay in the world where they were emitted.
 *
 * @godot GPUParticles3D.set_use_local_coordinates
 * @source scene/3d/gpu_particles_3d.cpp:150
 */
export function set_use_local_coordinates(self: object, enable: boolean): void {
  particles_set_use_local_coordinates(self, enable);
}

/**
 * @godot GPUParticles3D.get_use_local_coordinates
 * @source scene/3d/gpu_particles_3d.cpp:225
 */
export function get_use_local_coordinates(self: object): boolean {
  return particles_get_use_local_coordinates(self);
}

/**
 * What the particles do over their lives; read by the emitter each frame, so a change to the
 * material is seen at once.
 *
 * @godot GPUParticles3D.set_process_material
 * @source scene/3d/gpu_particles_3d.cpp:155
 */
export function set_process_material(self: object, material: ParticleProcessMaterial | null): void {
  stateOf(self, 'set_process_material').process_material = material;
}

/**
 * @godot GPUParticles3D.get_process_material
 * @source scene/3d/gpu_particles_3d.cpp:229
 */
export function get_process_material(self: object): ParticleProcessMaterial | null {
  return stateOf(self, 'get_process_material').process_material;
}

/**
 * How fast the system runs (1: real time).
 *
 * @godot GPUParticles3D.set_speed_scale
 * @source scene/3d/gpu_particles_3d.cpp:179
 */
export function set_speed_scale(self: object, scale: number): void {
  particles_set_speed_scale(self, scale);
}

/**
 * @godot GPUParticles3D.get_speed_scale
 * @source scene/3d/gpu_particles_3d.cpp:233
 */
export function get_speed_scale(self: object): number {
  return particles_get_speed_scale(self);
}

/**
 * The particles are drawn in index order; another order fails by name.
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
 * How many meshes each particle is drawn with: one is drawn, more fails by name.
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
 * A pass's mesh; the first pass's is what each particle is drawn as.
 *
 * @godot GPUParticles3D.set_draw_pass_mesh
 * @source scene/3d/gpu_particles_3d.cpp:284
 */
export function set_draw_pass_mesh(self: object, pass: number, mesh: PrimitiveMesh | null): void {
  const state = stateOf(self, 'set_draw_pass_mesh');
  if (pass < 0 || pass >= state.draw_passes.length) return;
  state.draw_passes[pass] = mesh;
  if (pass === 0) particles_set_mesh(self, mesh);
}

/**
 * @godot GPUParticles3D.get_draw_pass_mesh
 * @source scene/3d/gpu_particles_3d.cpp:308
 */
export function get_draw_pass_mesh(self: object, pass: number): PrimitiveMesh | null {
  return stateOf(self, 'get_draw_pass_mesh').draw_passes[pass] ?? null;
}

/**
 * Stored: the emitter steps on the host's frame.
 *
 * @godot GPUParticles3D.set_fixed_fps
 * @source scene/3d/gpu_particles_3d.cpp:314
 */
export function set_fixed_fps(self: object, fps: number): void {
  particles_set_fixed_fps(self, fps);
}

/**
 * @godot GPUParticles3D.get_fixed_fps
 * @source scene/3d/gpu_particles_3d.cpp:319
 */
export function get_fixed_fps(self: object): number {
  return particles_get_fixed_fps(self);
}

/**
 * Stored: the emitter steps on the host's frame.
 *
 * @godot GPUParticles3D.set_fractional_delta
 * @source scene/3d/gpu_particles_3d.cpp:323
 */
export function set_fractional_delta(self: object, enable: boolean): void {
  particles_set_fractional_delta(self, enable);
}

/**
 * @godot GPUParticles3D.get_fractional_delta
 * @source scene/3d/gpu_particles_3d.cpp:328
 */
export function get_fractional_delta(self: object): boolean {
  return particles_get_fractional_delta(self);
}

/**
 * Stored: the emitter moves the particles every frame, so there is nothing to interpolate.
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
 * Stored: the emitter draws from `Math.random`.
 *
 * @godot GPUParticles3D.set_use_fixed_seed
 * @source scene/3d/gpu_particles_3d.cpp:108
 */
export function set_use_fixed_seed(self: object, use: boolean): void {
  particles_set_use_fixed_seed(self, use);
}

/**
 * @godot GPUParticles3D.get_use_fixed_seed
 * @source scene/3d/gpu_particles_3d.cpp:116
 */
export function get_use_fixed_seed(self: object): boolean {
  return particles_get_use_fixed_seed(self);
}

/**
 * Stored: the emitter draws from `Math.random`.
 *
 * @godot GPUParticles3D.set_seed
 * @source scene/3d/gpu_particles_3d.cpp:120
 */
export function set_seed(self: object, seed: number): void {
  particles_set_seed(self, seed);
}

/**
 * @godot GPUParticles3D.get_seed
 * @source scene/3d/gpu_particles_3d.cpp:125
 */
export function get_seed(self: object): number {
  return particles_get_seed(self);
}

/**
 * Kills every particle and starts emitting a new cycle.
 *
 * @godot GPUParticles3D.restart
 * @source scene/3d/gpu_particles_3d.cpp:442
 */
export function restart(self: object, keep_seed = false): void {
  particles_restart(self, keep_seed);
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
    ['transformAlign', (self, value: number) => set_transform_align(self, value)],
    ['transformAlignChannelFilter', (self, value: number) => set_transform_align_channel_filter(self, value)],
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
 * A GPUParticles3D as a scene writes it (`gpu_particles_3d.cpp:869`: its properties): a group
 * holding the `InstancedMesh` its particles are drawn with, advancing from its own frame.
 *
 * @godot GPUParticles3D (protocol)
 * @source scene/3d/gpu_particles_3d.cpp:869
 */
export function GodotGPUParticles3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(GPU_PARTICLES_3D_ELEMENT, props);
}

/**
 * @godot GPUParticles3D.set_transform_align
 * @source scene/3d/gpu_particles_3d.cpp:629
 */
export function set_transform_align(self: Object3D, align: number): void {
  stateOf(self, 'set_transform_align').transform_align = align;
}

/**
 * @godot GPUParticles3D.get_transform_align
 * @source scene/3d/gpu_particles_3d.cpp:635
 */
export function get_transform_align(self: Object3D): number {
  return stateOf(self, 'get_transform_align').transform_align;
}

/**
 * @godot GPUParticles3D.set_transform_align_channel_filter
 * @source scene/3d/gpu_particles_3d.cpp:664
 */
export function set_transform_align_channel_filter(self: Object3D, channel_filter: number): void {
  stateOf(self, 'set_transform_align_channel_filter').transform_align_channel_filter = channel_filter;
}

/**
 * @godot GPUParticles3D.get_transform_align_channel_filter
 * @source scene/3d/gpu_particles_3d.cpp:670
 */
export function get_transform_align_channel_filter(self: Object3D): number {
  return stateOf(self, 'get_transform_align_channel_filter').transform_align_channel_filter;
}
