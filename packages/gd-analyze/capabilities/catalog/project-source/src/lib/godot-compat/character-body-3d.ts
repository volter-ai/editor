/**
 * @godot-class CharacterBody3D
 * @role BINDING
 *
 * Godot 4.7's `CharacterBody3D` (`scene/3d/physics/character_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) on Rapier's kinematic character controller: the
 * node's `<RigidBody type="kinematicPosition">` is moved by `move_and_slide`, which hands the
 * controller the velocity over the physics step and moves the body by what it computes, sliding
 * along what it meets, snapping to the floor within `floor_snap_length` and climbing up to
 * `floor_max_angle`. Each contact is a floor, wall or ceiling by its normal against
 * `up_direction`, as Godot classifies them (`_set_collision_direction`, `character_body_3d.cpp:528`),
 * and the velocity slides along each (`Vector3::slide`), as Godot's does. The character's settings
 * are the node's `userData`'s, then its setters'. Moving platforms' velocity is not carried.
 */

import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import { godot_collision_object_body, godot_collision_object_layers, godot_collision_object_of_collider, godot_physics_world } from './collision-object-3d';
import { godot_node_entity } from './node';
import { get_global_transform } from './node-3d';
import { construct as vector3, dot, length, normalized, op_add, op_divide, op_equal, op_multiply, op_subtract, type Vector3 } from './vector3';

const f32 = Math.fround;
const ZERO = vector3();
const MOTION_MODE_GROUNDED = 0;

function degToRad(degrees: number): number {
  return f32((degrees * Math.PI) / 180);
}

interface CollisionState {
  floor: boolean;
  wall: boolean;
  ceiling: boolean;
}

interface BodyState {
  margin: number;
  motion_mode: number;
  collision_state: CollisionState;
  floor_constant_speed: boolean;
  floor_stop_on_slope: boolean;
  floor_block_on_wall: boolean;
  slide_on_ceiling: boolean;
  max_slides: number;
  floor_snap_length: number;
  floor_max_angle: number;
  wall_min_slide_angle: number;
  up_direction: Vector3;
  velocity: Vector3;
  floor_normal: Vector3;
  wall_normal: Vector3;
  last_motion: Vector3;
  platform_velocity: Vector3;
  previous_position: Vector3;
  real_velocity: Vector3;
  slide_collisions: number;
  controller: KinematicCharacterController | undefined;
}

const BODY = new WeakMap<object, BodyState>();

/** A character's state, made with Godot's defaults and the node's `userData` the first time it is asked for. */
function stateOf(object: object, _member: string): BodyState {
  const entity = godot_node_entity(object);
  let state = BODY.get(entity);
  if (state === undefined) {
    state = {
      margin: f32(0.001),
      motion_mode: MOTION_MODE_GROUNDED,
      collision_state: { floor: false, wall: false, ceiling: false },
      floor_constant_speed: false,
      floor_stop_on_slope: true,
      floor_block_on_wall: true,
      slide_on_ceiling: true,
      max_slides: 6,
      floor_snap_length: f32(0.1),
      floor_max_angle: degToRad(45),
      wall_min_slide_angle: degToRad(15),
      up_direction: vector3(0, 1, 0),
      velocity: ZERO,
      floor_normal: ZERO,
      wall_normal: ZERO,
      last_motion: ZERO,
      platform_velocity: ZERO,
      previous_position: ZERO,
      real_velocity: ZERO,
      slide_collisions: 0,
      controller: undefined,
    };
    BODY.set(entity, state);
    const data = ((entity as Object3D).userData ?? {}) as Readonly<Record<string, unknown>>;
    for (const [key, value] of Object.entries(data)) CHARACTER_SEEDS[key]?.(entity, value);
  }
  return state;
}

/** The character's controller, configured from its settings. */
function controllerOf(state: BodyState): KinematicCharacterController | undefined {
  const world = godot_physics_world();
  if (world === undefined) return undefined;
  state.controller ??= world.createCharacterController(Math.max(state.margin, 0.001));
  const controller = state.controller;
  controller.setUp(state.up_direction);
  controller.setMaxSlopeClimbAngle(state.floor_max_angle);
  controller.setMinSlopeSlideAngle(state.floor_max_angle);
  controller.setSlideEnabled(true);
  if (state.motion_mode === MOTION_MODE_GROUNDED && state.floor_snap_length > 0) controller.enableSnapToGround(state.floor_snap_length);
  else controller.disableSnapToGround();
  return controller;
}

/** `Vector3::slide`: `v` without its component into `n`. */
function slide(v: Vector3, n: Vector3): Vector3 {
  return op_subtract(v, op_multiply(n, dot(v, n)));
}

/**
 * Moves the body by its velocity over one physics step, sliding along what it meets; true when it
 * met something.
 *
 * @godot CharacterBody3D.move_and_slide
 * @source scene/3d/physics/character_body_3d.cpp:43
 */
export function move_and_slide(owner: object): boolean {
  const state = stateOf(owner, 'move_and_slide');
  const self = godot_node_entity(owner);
  const body = godot_collision_object_body(self);
  const world = godot_physics_world();
  const controller = controllerOf(state);
  const collider = body !== undefined && body.numColliders() > 0 ? body.collider(0) : undefined;
  if (body === undefined || world === undefined || controller === undefined || collider === undefined) return false;
  const delta = world.timestep;
  const from = body.translation();
  state.previous_position = vector3(from.x, from.y, from.z);
  const own = godot_collision_object_layers(self);
  controller.computeColliderMovement(
    collider,
    op_multiply(state.velocity, delta),
    undefined,
    undefined,
    // What the character's mask takes; never its own colliders or a sensor.
    (other: Collider) => {
      if (other.isSensor() || other.parent()?.handle === body.handle) return false;
      const node = godot_collision_object_of_collider(other);
      return node === undefined || (own.mask & godot_collision_object_layers(node).layer) !== 0;
    },
  );
  const moved = controller.computedMovement();
  body.setNextKinematicTranslation({ x: from.x + moved.x, y: from.y + moved.y, z: from.z + moved.z });
  // A character moving away from the floor is not on it, whatever the controller's snap reports.
  const rising = dot(state.velocity, state.up_direction) > 0;
  const flags: CollisionState = { floor: controller.computedGrounded() && !rising && state.motion_mode === MOTION_MODE_GROUNDED, wall: false, ceiling: false };
  let velocity = state.velocity;
  let floorNormal = flags.floor ? state.up_direction : ZERO;
  let wallNormal = ZERO;
  const count = controller.numComputedCollisions();
  const limit = Math.cos(state.floor_max_angle + 0.01);
  for (let index = 0; index < count; index += 1) {
    const hit = controller.computedCollision(index);
    const n = hit === null ? undefined : normalized(vector3(hit.normal2.x, hit.normal2.y, hit.normal2.z));
    if (n === undefined || op_equal(n, ZERO)) continue;
    const up = dot(n, state.up_direction);
    if (state.motion_mode === MOTION_MODE_GROUNDED && up >= limit && !rising) {
      flags.floor = true;
      floorNormal = n;
    } else if (state.motion_mode === MOTION_MODE_GROUNDED && up <= -limit) {
      flags.ceiling = true;
    } else {
      flags.wall = true;
      wallNormal = n;
    }
    if (dot(velocity, n) < 0) velocity = slide(velocity, n);
  }
  // On the floor, nothing carries the character into it (`_snap_on_floor` keeps it there).
  if (flags.floor && dot(velocity, state.up_direction) < 0) velocity = slide(velocity, state.up_direction);
  state.velocity = velocity;
  state.collision_state = flags;
  state.floor_normal = floorNormal;
  state.wall_normal = wallNormal;
  state.slide_collisions = count;
  state.last_motion = vector3(moved.x, moved.y, moved.z);
  state.real_velocity = delta > 0 ? op_divide(state.last_motion, delta) : ZERO;
  return count > 0;
}

/**
 * Keeps a character that was on the floor on it: the controller snaps it within
 * `floor_snap_length` on its next move.
 *
 * @godot CharacterBody3D.apply_floor_snap
 * @source scene/3d/physics/character_body_3d.cpp:459
 */
export function apply_floor_snap(self: object): void {
  const state = stateOf(self, 'apply_floor_snap');
  if (state.collision_state.floor) state.collision_state = { ...state.collision_state, floor: true };
}

/**
 * @godot CharacterBody3D.set_velocity
 * @source scene/3d/physics/character_body_3d.cpp:651
 */
export function set_velocity(self: object, velocity: Vector3): void {
  stateOf(self, 'set_velocity').velocity = vector3(velocity);
}

/**
 * @godot CharacterBody3D.get_velocity
 * @source scene/3d/physics/character_body_3d.cpp:647
 */
export function get_velocity(self: object): Vector3 {
  return stateOf(self, 'get_velocity').velocity;
}

/**
 * @godot CharacterBody3D.set_safe_margin
 * @source scene/3d/physics/character_body_3d.cpp:639
 */
export function set_safe_margin(self: object, margin: number): void {
  stateOf(self, 'set_safe_margin').margin = f32(margin);
}

/**
 * @godot CharacterBody3D.get_safe_margin
 * @source scene/3d/physics/character_body_3d.cpp:643
 */
export function get_safe_margin(self: object): number {
  return stateOf(self, 'get_safe_margin').margin;
}

/**
 * @godot CharacterBody3D.is_on_floor
 * @source scene/3d/physics/character_body_3d.cpp:655
 */
export function is_on_floor(self: object): boolean {
  return stateOf(self, 'is_on_floor').collision_state.floor;
}

/**
 * @godot CharacterBody3D.is_on_floor_only
 * @source scene/3d/physics/character_body_3d.cpp:659
 */
export function is_on_floor_only(self: object): boolean {
  const s = stateOf(self, 'is_on_floor_only').collision_state;
  return s.floor && !s.wall && !s.ceiling;
}

/**
 * @godot CharacterBody3D.is_on_wall
 * @source scene/3d/physics/character_body_3d.cpp:663
 */
export function is_on_wall(self: object): boolean {
  return stateOf(self, 'is_on_wall').collision_state.wall;
}

/**
 * @godot CharacterBody3D.is_on_wall_only
 * @source scene/3d/physics/character_body_3d.cpp:667
 */
export function is_on_wall_only(self: object): boolean {
  const s = stateOf(self, 'is_on_wall_only').collision_state;
  return s.wall && !s.floor && !s.ceiling;
}

/**
 * @godot CharacterBody3D.is_on_ceiling
 * @source scene/3d/physics/character_body_3d.cpp:671
 */
export function is_on_ceiling(self: object): boolean {
  return stateOf(self, 'is_on_ceiling').collision_state.ceiling;
}

/**
 * @godot CharacterBody3D.is_on_ceiling_only
 * @source scene/3d/physics/character_body_3d.cpp:675
 */
export function is_on_ceiling_only(self: object): boolean {
  const s = stateOf(self, 'is_on_ceiling_only').collision_state;
  return s.ceiling && !s.floor && !s.wall;
}

/**
 * @godot CharacterBody3D.get_floor_normal
 * @source scene/3d/physics/character_body_3d.cpp:679
 */
export function get_floor_normal(self: object): Vector3 {
  return stateOf(self, 'get_floor_normal').floor_normal;
}

/**
 * @godot CharacterBody3D.get_wall_normal
 * @source scene/3d/physics/character_body_3d.cpp:683
 */
export function get_wall_normal(self: object): Vector3 {
  return stateOf(self, 'get_wall_normal').wall_normal;
}

/**
 * @godot CharacterBody3D.get_last_motion
 * @source scene/3d/physics/character_body_3d.cpp:687
 */
export function get_last_motion(self: object): Vector3 {
  return stateOf(self, 'get_last_motion').last_motion;
}

/**
 * @godot CharacterBody3D.get_position_delta
 * @source scene/3d/physics/character_body_3d.cpp:691
 */
export function get_position_delta(self: object): Vector3 {
  const state = stateOf(self, 'get_position_delta');
  return op_subtract(get_global_transform(godot_node_entity(self) as Object3D).origin, state.previous_position);
}

/**
 * @godot CharacterBody3D.get_real_velocity
 * @source scene/3d/physics/character_body_3d.cpp:695
 */
export function get_real_velocity(self: object): Vector3 {
  return stateOf(self, 'get_real_velocity').real_velocity;
}

/**
 * A zero up direction fails with 0. The Variant default is `Vector3.UP`.
 *
 * @godot CharacterBody3D.get_floor_angle
 * @source scene/3d/physics/character_body_3d.cpp:699
 */
export function get_floor_angle(self: object, up_direction: Vector3 = vector3(0, 1, 0)): number {
  const state = stateOf(self, 'get_floor_angle');
  if (op_equal(up_direction, ZERO)) return 0;
  return f32(Math.acos(dot(state.floor_normal, up_direction)));
}

/**
 * @godot CharacterBody3D.get_platform_velocity
 * @source scene/3d/physics/character_body_3d.cpp:704
 */
export function get_platform_velocity(self: object): Vector3 {
  return stateOf(self, 'get_platform_velocity').platform_velocity;
}

/**
 * @godot CharacterBody3D.get_slide_collision_count
 * @source scene/3d/physics/character_body_3d.cpp:716
 */
export function get_slide_collision_count(self: object): number {
  return stateOf(self, 'get_slide_collision_count').slide_collisions;
}

/**
 * @godot CharacterBody3D.is_floor_stop_on_slope_enabled
 * @source scene/3d/physics/character_body_3d.cpp:748
 */
export function is_floor_stop_on_slope_enabled(self: object): boolean {
  return stateOf(self, 'is_floor_stop_on_slope_enabled').floor_stop_on_slope;
}

/**
 * @godot CharacterBody3D.set_floor_stop_on_slope_enabled
 * @source scene/3d/physics/character_body_3d.cpp:752
 */
export function set_floor_stop_on_slope_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_floor_stop_on_slope_enabled').floor_stop_on_slope = enabled;
}

/**
 * @godot CharacterBody3D.is_floor_constant_speed_enabled
 * @source scene/3d/physics/character_body_3d.cpp:756
 */
export function is_floor_constant_speed_enabled(self: object): boolean {
  return stateOf(self, 'is_floor_constant_speed_enabled').floor_constant_speed;
}

/**
 * @godot CharacterBody3D.set_floor_constant_speed_enabled
 * @source scene/3d/physics/character_body_3d.cpp:760
 */
export function set_floor_constant_speed_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_floor_constant_speed_enabled').floor_constant_speed = enabled;
}

/**
 * @godot CharacterBody3D.is_floor_block_on_wall_enabled
 * @source scene/3d/physics/character_body_3d.cpp:764
 */
export function is_floor_block_on_wall_enabled(self: object): boolean {
  return stateOf(self, 'is_floor_block_on_wall_enabled').floor_block_on_wall;
}

/**
 * @godot CharacterBody3D.set_floor_block_on_wall_enabled
 * @source scene/3d/physics/character_body_3d.cpp:768
 */
export function set_floor_block_on_wall_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_floor_block_on_wall_enabled').floor_block_on_wall = enabled;
}

/**
 * @godot CharacterBody3D.is_slide_on_ceiling_enabled
 * @source scene/3d/physics/character_body_3d.cpp:772
 */
export function is_slide_on_ceiling_enabled(self: object): boolean {
  return stateOf(self, 'is_slide_on_ceiling_enabled').slide_on_ceiling;
}

/**
 * @godot CharacterBody3D.set_slide_on_ceiling_enabled
 * @source scene/3d/physics/character_body_3d.cpp:776
 */
export function set_slide_on_ceiling_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_slide_on_ceiling_enabled').slide_on_ceiling = enabled;
}

/**
 * @godot CharacterBody3D.set_motion_mode
 * @source scene/3d/physics/character_body_3d.cpp:796
 */
export function set_motion_mode(self: object, mode: number): void {
  stateOf(self, 'set_motion_mode').motion_mode = mode;
}

/**
 * @godot CharacterBody3D.get_motion_mode
 * @source scene/3d/physics/character_body_3d.cpp:800
 */
export function get_motion_mode(self: object): number {
  return stateOf(self, 'get_motion_mode').motion_mode;
}

/**
 * @godot CharacterBody3D.get_max_slides
 * @source scene/3d/physics/character_body_3d.cpp:812
 */
export function get_max_slides(self: object): number {
  return stateOf(self, 'get_max_slides').max_slides;
}

/**
 * Fewer than one slide fails and leaves it.
 *
 * @godot CharacterBody3D.set_max_slides
 * @source scene/3d/physics/character_body_3d.cpp:816
 */
export function set_max_slides(self: object, max_slides: number): void {
  const state = stateOf(self, 'set_max_slides');
  if (max_slides < 1) return;
  state.max_slides = max_slides | 0;
}

/**
 * @godot CharacterBody3D.get_floor_max_angle
 * @source scene/3d/physics/character_body_3d.cpp:821
 */
export function get_floor_max_angle(self: object): number {
  return stateOf(self, 'get_floor_max_angle').floor_max_angle;
}

/**
 * @godot CharacterBody3D.set_floor_max_angle
 * @source scene/3d/physics/character_body_3d.cpp:825
 */
export function set_floor_max_angle(self: object, radians: number): void {
  stateOf(self, 'set_floor_max_angle').floor_max_angle = f32(radians);
}

/**
 * @godot CharacterBody3D.get_floor_snap_length
 * @source scene/3d/physics/character_body_3d.cpp:829
 */
export function get_floor_snap_length(self: object): number {
  return stateOf(self, 'get_floor_snap_length').floor_snap_length;
}

/**
 * A negative length fails and leaves it.
 *
 * @godot CharacterBody3D.set_floor_snap_length
 * @source scene/3d/physics/character_body_3d.cpp:833
 */
export function set_floor_snap_length(self: object, floor_snap_length: number): void {
  const state = stateOf(self, 'set_floor_snap_length');
  if (floor_snap_length < 0) return;
  state.floor_snap_length = f32(floor_snap_length);
}

/**
 * @godot CharacterBody3D.get_wall_min_slide_angle
 * @source scene/3d/physics/character_body_3d.cpp:838
 */
export function get_wall_min_slide_angle(self: object): number {
  return stateOf(self, 'get_wall_min_slide_angle').wall_min_slide_angle;
}

/**
 * @godot CharacterBody3D.set_wall_min_slide_angle
 * @source scene/3d/physics/character_body_3d.cpp:842
 */
export function set_wall_min_slide_angle(self: object, radians: number): void {
  stateOf(self, 'set_wall_min_slide_angle').wall_min_slide_angle = f32(radians);
}

/**
 * @godot CharacterBody3D.get_up_direction
 * @source scene/3d/physics/character_body_3d.cpp:846
 */
export function get_up_direction(self: object): Vector3 {
  return stateOf(self, 'get_up_direction').up_direction;
}

/**
 * A zero direction fails and leaves it; otherwise it is normalized.
 *
 * @godot CharacterBody3D.set_up_direction
 * @source scene/3d/physics/character_body_3d.cpp:850
 */
export function set_up_direction(self: object, up_direction: Vector3): void {
  const state = stateOf(self, 'set_up_direction');
  if (op_equal(up_direction, ZERO)) return;
  state.up_direction = normalized(up_direction);
}

/** The CharacterBody3D properties a scene states, by their Godot names, and their setters. */
const CHARACTER_SEEDS: Readonly<Record<string, (entity: object, value: unknown) => void>> = {
  velocity: (entity, value) => set_velocity(entity, vector3(...(value as [number, number, number]))),
  safe_margin: (entity, value) => set_safe_margin(entity, Number(value)),
  floor_stop_on_slope: (entity, value) => set_floor_stop_on_slope_enabled(entity, Boolean(value)),
  floor_constant_speed: (entity, value) => set_floor_constant_speed_enabled(entity, Boolean(value)),
  floor_block_on_wall: (entity, value) => set_floor_block_on_wall_enabled(entity, Boolean(value)),
  slide_on_ceiling: (entity, value) => set_slide_on_ceiling_enabled(entity, Boolean(value)),
  motion_mode: (entity, value) => set_motion_mode(entity, Number(value)),
  max_slides: (entity, value) => set_max_slides(entity, Number(value)),
  floor_max_angle: (entity, value) => set_floor_max_angle(entity, Number(value)),
  floor_snap_length: (entity, value) => set_floor_snap_length(entity, Number(value)),
  wall_min_slide_angle: (entity, value) => set_wall_min_slide_angle(entity, Number(value)),
  up_direction: (entity, value) => set_up_direction(entity, vector3(...(value as [number, number, number]))),
};
