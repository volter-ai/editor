/**
 * @godot-class CharacterBody3D
 * @role BINDING
 *
 * Godot 4.7's `CharacterBody3D` (`scene/3d/physics/character_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`), transcribed: a kinematic collision object whose
 * `move_and_slide` runs Godot's grounded or floating slide over `PhysicsBody3D`'s
 * `move_and_collide` (`physics-body-3d.ts`), whose motion test is `physics-server-3d.ts`'s
 * `body_test_motion` over Rapier. Every `real_t` is a C `float`, rounded where the C++ rounds it;
 * `Math::acos` is the platform's (`std::acos` on a float). The character's state lives in `BODY`,
 * keyed by the entity. `get_slide_collision` (KinematicCollision3D) is not bound.
 */

import type { Object3D } from 'three';
import { godot_collision_object_adopt, godot_collision_object_state } from './collision-object-3d';
import { godot_tree_frames, godot_tree_process_delta } from './scene-tree';
import { godot_node_entity, godot_node_tree_signal } from './node';
import { get_global_transform, set_global_transform } from './node-3d';
import { godot_physics_body_move_and_collide } from './physics-body-3d';
import { godot_test_motion_parameters, type PhysicsTestMotionParameters3D } from './physics-test-motion-parameters-3d';
import { godot_test_motion_result, type MotionCollision, type PhysicsTestMotionResult3D } from './physics-test-motion-result-3d';
import { construct as transform3d, type Transform3D } from './transform-3d';
import {
  construct as vector3,
  cross,
  dot,
  is_equal_approx,
  is_zero_approx,
  length,
  length_squared,
  normalized,
  op_add,
  op_divide,
  op_equal,
  op_multiply,
  op_negate,
  op_subtract,
  slide,
  type Vector3,
} from './vector3';

const f32 = Math.fround;
/** `(real_t)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);
/** `FLOOR_ANGLE_THRESHOLD` (`character_body_3d.cpp:41`), a double. */
const FLOOR_ANGLE_THRESHOLD = 0.01;
const MOTION_MODE_GROUNDED = 0;
const PLATFORM_ON_LEAVE_ADD_VELOCITY = 0;
const PLATFORM_ON_LEAVE_ADD_UPWARD_VELOCITY = 1;
const PLATFORM_ON_LEAVE_DO_NOTHING = 2;

/** `Math::deg_to_rad(float)` (`core/math/math_funcs.h:324`). */
function degToRad(degrees: number): number {
  return f32(degrees * f32(f32(Math.PI) / 180));
}

interface CollisionState {
  floor: boolean;
  wall: boolean;
  ceiling: boolean;
}

interface BodyState {
  margin: number;
  motion_mode: number;
  platform_on_leave: number;
  collision_state: CollisionState;
  floor_constant_speed: boolean;
  floor_stop_on_slope: boolean;
  floor_block_on_wall: boolean;
  slide_on_ceiling: boolean;
  max_slides: number;
  platform_layer: number;
  platform_rid: object | null;
  platform_floor_layers: number;
  platform_wall_layers: number;
  floor_snap_length: number;
  floor_max_angle: number;
  wall_min_slide_angle: number;
  up_direction: Vector3;
  velocity: Vector3;
  floor_normal: Vector3;
  wall_normal: Vector3;
  ceiling_normal: Vector3;
  last_motion: Vector3;
  platform_velocity: Vector3;
  platform_angular_velocity: Vector3;
  platform_ceiling_velocity: Vector3;
  previous_position: Vector3;
  real_velocity: Vector3;
  motion_results: PhysicsTestMotionResult3D[];
}

const BODY = new WeakMap<object, BodyState>();
const ZERO = vector3();

function stateOf(object: object, member: string): BodyState {
  const state = BODY.get(godot_node_entity(object));
  if (state === undefined) throw new TypeError(`godot-compat: CharacterBody3D.${member} requires a CharacterBody3D.`);
  return state;
}

function flags(floor = false, wall = false, ceiling = false): CollisionState {
  return { floor, wall, ceiling };
}

function reset(state: BodyState): void {
  state.collision_state = flags();
  state.platform_rid = null;
  state.motion_results = [];
  state.platform_velocity = ZERO;
  state.platform_angular_velocity = ZERO;
}

/**
 * Registers a node as a CharacterBody3D with Godot's defaults (`character_body_3d.h`); entering
 * the tree resets its move_and_slide data (`_notification`, `character_body_3d.cpp:855`).
 *
 * @godot CharacterBody3D (protocol)
 * @source scene/3d/physics/character_body_3d.cpp:855
 */
export function godot_character_body_3d_adopt(entity: object): void {
  godot_collision_object_adopt(entity, 'character');
  if (BODY.has(entity)) return;
  const state: BodyState = {
    margin: f32(0.001),
    motion_mode: MOTION_MODE_GROUNDED,
    platform_on_leave: PLATFORM_ON_LEAVE_ADD_VELOCITY,
    collision_state: flags(),
    floor_constant_speed: false,
    floor_stop_on_slope: true,
    floor_block_on_wall: true,
    slide_on_ceiling: true,
    max_slides: 6,
    platform_layer: 0,
    platform_rid: null,
    platform_floor_layers: 0xffffffff,
    platform_wall_layers: 0,
    floor_snap_length: f32(0.1),
    floor_max_angle: degToRad(45),
    wall_min_slide_angle: degToRad(15),
    up_direction: vector3(0, 1, 0),
    velocity: ZERO,
    floor_normal: ZERO,
    wall_normal: ZERO,
    ceiling_normal: ZERO,
    last_motion: ZERO,
    platform_velocity: ZERO,
    platform_angular_velocity: ZERO,
    platform_ceiling_velocity: ZERO,
    previous_position: ZERO,
    real_velocity: ZERO,
    motion_results: [],
  };
  BODY.set(entity, state);
  godot_node_tree_signal(entity, 'tree_entered').connect(() => reset(state));
}

function withOrigin(t: Transform3D, origin: Vector3): Transform3D {
  return transform3d(t.basis, origin);
}

/** `MotionCollision::get_angle` (`physics_server_3d.h:556`). */
function angleOf(collision: MotionCollision, up: Vector3): number {
  return f32(Math.acos(dot(collision.normal, up)));
}

/** `PhysicsDirectBodyState3D::get_velocity_at_local_position` of the body a platform RID names. */
function platformVelocity(rid: object, globalOrigin: Vector3): Vector3 | undefined {
  const body = godot_collision_object_state(rid);
  if (body === undefined || body.body === undefined) return undefined;
  if (body.kind === 'character') return body.linearVelocity;
  if (body.kind === 'rigid') {
    const v = body.body.linvel();
    const w = body.body.angvel();
    const c = body.body.worldCom();
    const r = op_subtract(globalOrigin, vector3(c.x, c.y, c.z));
    return op_add(vector3(v.x, v.y, v.z), cross(vector3(w.x, w.y, w.z), r));
  }
  return ZERO;
}

function moveAndCollide(self: object, parameters: PhysicsTestMotionParameters3D, result: PhysicsTestMotionResult3D, test_only: boolean, cancel_sliding: boolean): boolean {
  return godot_physics_body_move_and_collide(self, parameters, result, test_only, cancel_sliding);
}

/** `_set_platform_data` (`character_body_3d.cpp:616`). */
function setPlatformData(state: BodyState, collision: MotionCollision): void {
  const body = collision.collider === null ? undefined : godot_collision_object_state(collision.collider);
  if (body === undefined) return;
  state.platform_rid = collision.collider;
  state.platform_velocity = collision.collider_velocity;
  state.platform_angular_velocity = collision.collider_angular_velocity;
  state.platform_layer = body.layer;
}

/** `_set_collision_direction` (`character_body_3d.cpp:528`). */
function setCollisionDirection(
  state: BodyState,
  result: PhysicsTestMotionResult3D,
  r_state: CollisionState,
  apply: CollisionState = flags(true, true, true),
): void {
  r_state.floor = false;
  r_state.wall = false;
  r_state.ceiling = false;
  let wall_depth = -1;
  let floor_depth = -1;
  const was_on_wall = state.collision_state.wall;
  const prev_wall_normal = state.wall_normal;
  let wall_collision_count = 0;
  let combined_wall_normal = ZERO;
  let tmp_wall_col = ZERO;
  for (let i = result.collision_count - 1; i >= 0; i -= 1) {
    const collision = result.collisions[i] as MotionCollision;
    if (state.motion_mode === MOTION_MODE_GROUNDED) {
      const floor_angle = angleOf(collision, state.up_direction);
      if (floor_angle <= state.floor_max_angle + FLOOR_ANGLE_THRESHOLD) {
        r_state.floor = true;
        if (apply.floor && collision.depth > floor_depth) {
          state.collision_state.floor = true;
          state.floor_normal = collision.normal;
          floor_depth = collision.depth;
          setPlatformData(state, collision);
        }
        continue;
      }
      const ceiling_angle = angleOf(collision, op_negate(state.up_direction));
      if (ceiling_angle <= state.floor_max_angle + FLOOR_ANGLE_THRESHOLD) {
        r_state.ceiling = true;
        if (apply.ceiling) {
          state.platform_ceiling_velocity = collision.collider_velocity;
          state.ceiling_normal = collision.normal;
          state.collision_state.ceiling = true;
        }
        continue;
      }
    }
    r_state.wall = true;
    if (apply.wall && collision.depth > wall_depth) {
      state.collision_state.wall = true;
      wall_depth = collision.depth;
      state.wall_normal = collision.normal;
      // Don't apply wall velocity when the collider is a CharacterBody3D.
      if (collision.collider === null || !BODY.has(collision.collider)) setPlatformData(state, collision);
    }
    if (!is_equal_approx(collision.normal, tmp_wall_col)) {
      tmp_wall_col = collision.normal;
      combined_wall_normal = op_add(combined_wall_normal, collision.normal);
      wall_collision_count += 1;
    }
  }
  if (r_state.wall && wall_collision_count > 1 && !r_state.floor && state.motion_mode === MOTION_MODE_GROUNDED) {
    combined_wall_normal = normalized(combined_wall_normal);
    const floor_angle = f32(Math.acos(dot(combined_wall_normal, state.up_direction)));
    if (floor_angle <= state.floor_max_angle + FLOOR_ANGLE_THRESHOLD) {
      r_state.floor = true;
      r_state.wall = false;
      if (apply.floor) {
        state.collision_state.floor = true;
        state.floor_normal = combined_wall_normal;
      }
      if (apply.wall) {
        state.collision_state.wall = was_on_wall;
        state.wall_normal = prev_wall_normal;
      }
    }
  }
}

function snapParameters(self: object, state: BodyState): PhysicsTestMotionParameters3D {
  const snap = state.floor_snap_length > state.margin ? state.floor_snap_length : state.margin;
  const parameters = godot_test_motion_parameters(get_global_transform(self as Object3D), op_multiply(op_negate(state.up_direction), snap), state.margin);
  parameters.max_collisions = 4;
  parameters.recovery_as_collision = true;
  parameters.collide_separation_ray = true;
  return parameters;
}

/** `apply_floor_snap` (`character_body_3d.cpp:459`). */
function applyFloorSnap(self: object, state: BodyState): void {
  if (state.collision_state.floor) return;
  const parameters = snapParameters(self, state);
  const result = godot_test_motion_result();
  if (moveAndCollide(self, parameters, result, true, false)) {
    const result_state = flags();
    setCollisionDirection(state, result, result_state, flags(true, false, false));
    if (result_state.floor) {
      if (length(result.travel) > state.margin) {
        result.travel = op_multiply(state.up_direction, dot(state.up_direction, result.travel));
      } else {
        result.travel = ZERO;
      }
      set_global_transform(self as Object3D, withOrigin(parameters.from, op_add(parameters.from.origin, result.travel)));
    }
  }
}

/** `_snap_on_floor` (`character_body_3d.cpp:495`). */
function snapOnFloor(self: object, state: BodyState, was_on_floor: boolean, vel_dir_facing_up: boolean): void {
  if (state.collision_state.floor || !was_on_floor || vel_dir_facing_up) return;
  applyFloorSnap(self, state);
}

/** `_on_floor_if_snapped` (`character_body_3d.cpp:503`). */
function onFloorIfSnapped(self: object, state: BodyState, was_on_floor: boolean, vel_dir_facing_up: boolean): boolean {
  if (op_equal(state.up_direction, ZERO) || state.collision_state.floor || !was_on_floor || vel_dir_facing_up) return false;
  const parameters = snapParameters(self, state);
  const result = godot_test_motion_result();
  if (moveAndCollide(self, parameters, result, true, false)) {
    const result_state = flags();
    setCollisionDirection(state, result, result_state, flags());
    return result_state.floor;
  }
  return false;
}

/** `_move_and_slide_grounded` (`character_body_3d.cpp:140`). */
function slideGrounded(self: object, state: BodyState, delta: number, was_on_floor: boolean): void {
  const up = state.up_direction;
  let motion = op_multiply(state.velocity, delta);
  const motion_slide_up = slide(motion, up);
  const prev_floor_normal = state.floor_normal;
  state.platform_rid = null;
  state.platform_velocity = ZERO;
  state.platform_angular_velocity = ZERO;
  state.platform_ceiling_velocity = ZERO;
  state.floor_normal = ZERO;
  state.wall_normal = ZERO;
  state.ceiling_normal = ZERO;

  let sliding_enabled = !state.floor_stop_on_slope;
  let can_apply_constant_speed = sliding_enabled;
  let apply_ceiling_velocity = false;
  let first_slide = true;
  const vel_dir_facing_up = dot(state.velocity, up) > 0;
  let total_travel = ZERO;

  for (let iteration = 0; iteration < state.max_slides; iteration += 1) {
    const parameters = godot_test_motion_parameters(get_global_transform(self as Object3D), motion, state.margin);
    parameters.max_collisions = 6;
    parameters.recovery_as_collision = true;
    const result = godot_test_motion_result();
    let collided = moveAndCollide(self, parameters, result, false, !sliding_enabled);
    state.last_motion = result.travel;

    if (collided) {
      state.motion_results.push(result);
      const previous_state = { ...state.collision_state };
      const result_state = flags();
      setCollisionDirection(state, result, result_state);

      if (state.collision_state.ceiling && !op_equal(state.platform_ceiling_velocity, ZERO) && dot(state.platform_ceiling_velocity, up) < 0) {
        if (!state.slide_on_ceiling || dot(motion, up) < 0 || length(op_add(state.ceiling_normal, up)) < 0.01) {
          apply_ceiling_velocity = true;
          const ceiling_vertical_velocity = op_multiply(up, dot(up, state.platform_ceiling_velocity));
          const motion_vertical_velocity = op_multiply(up, dot(up, state.velocity));
          if (dot(motion_vertical_velocity, up) > 0 || length_squared(ceiling_vertical_velocity) > length_squared(motion_vertical_velocity)) {
            state.velocity = op_add(ceiling_vertical_velocity, slide(state.velocity, up));
          }
        }
      }

      if (state.collision_state.floor && state.floor_stop_on_slope && length(op_add(normalized(state.velocity), up)) < 0.01) {
        let gt = get_global_transform(self as Object3D);
        if (length(result.travel) <= f32(state.margin + CMP_EPSILON)) gt = withOrigin(gt, op_subtract(gt.origin, result.travel));
        set_global_transform(self as Object3D, gt);
        state.velocity = ZERO;
        motion = ZERO;
        state.last_motion = ZERO;
        break;
      }

      if (is_zero_approx(result.remainder)) {
        motion = ZERO;
        break;
      }

      let apply_default_sliding = true;

      if (result_state.wall && dot(motion_slide_up, state.wall_normal) <= 0) {
        if (state.floor_block_on_wall) {
          const horizontal_motion = slide(motion, up);
          const horizontal_normal = normalized(slide(state.wall_normal, up));
          const motion_angle = Math.abs(f32(Math.acos(f32(-dot(horizontal_normal, normalized(horizontal_motion))))));
          if (motion_angle < 0.5 * Math.PI) {
            apply_default_sliding = false;
            if (was_on_floor && !vel_dir_facing_up) {
              let gt = get_global_transform(self as Object3D);
              const travel_total = length(result.travel);
              const twenty = f32(state.margin * 20);
              const cancel_dist_max = f32(0.1 < twenty ? 0.1 : twenty);
              if (travel_total <= f32(state.margin + CMP_EPSILON)) {
                gt = withOrigin(gt, op_subtract(gt.origin, result.travel));
                result.travel = ZERO;
              } else if (travel_total < cancel_dist_max) {
                gt = withOrigin(gt, op_subtract(gt.origin, slide(result.travel, up)));
                motion = slide(motion, up);
                result.travel = ZERO;
              } else {
                result.travel = slide(result.travel, up);
                motion = result.remainder;
              }
              set_global_transform(self as Object3D, gt);
              snapOnFloor(self, state, true, false);
            } else {
              motion = result.remainder;
            }

            const forward = normalized(slide(state.wall_normal, up));
            motion = slide(motion, forward);

            if (vel_dir_facing_up) {
              const slide_motion = slide(state.velocity, (result.collisions[0] as MotionCollision).normal);
              state.velocity = op_add(op_multiply(up, dot(up, state.velocity)), slide(slide_motion, up));
            } else {
              state.velocity = slide(state.velocity, forward);
            }

            if (was_on_floor && !vel_dir_facing_up && dot(motion, up) > 0) {
              const floor_side = cross(prev_floor_normal, state.wall_normal);
              if (!op_equal(floor_side, ZERO)) motion = op_multiply(floor_side, dot(motion, floor_side));
            }

            let stop_all_motion = previous_state.wall && !vel_dir_facing_up;
            if (!state.collision_state.floor && dot(motion, up) < 0) {
              const slide_motion = slide(motion, state.wall_normal);
              if (dot(slide_motion, up) < 0) {
                stop_all_motion = false;
                motion = slide_motion;
              }
            }
            if (stop_all_motion) {
              motion = ZERO;
              state.velocity = ZERO;
            }
          }
        }

        if (was_on_floor && state.wall_min_slide_angle > 0 && result_state.wall) {
          const horizontal_normal = normalized(slide(state.wall_normal, up));
          const motion_angle = Math.abs(f32(Math.acos(f32(-dot(horizontal_normal, normalized(motion_slide_up))))));
          if (motion_angle < state.wall_min_slide_angle) {
            motion = op_multiply(up, dot(motion, up));
            state.velocity = op_multiply(up, dot(state.velocity, up));
            apply_default_sliding = false;
          }
        }
      }

      if (apply_default_sliding) {
        if ((sliding_enabled || !state.collision_state.floor) && (!state.collision_state.ceiling || state.slide_on_ceiling || !vel_dir_facing_up) && !apply_ceiling_velocity) {
          const collision = result.collisions[0] as MotionCollision;
          let slide_motion = slide(result.remainder, collision.normal);
          if (state.collision_state.floor && !state.collision_state.wall && !is_zero_approx(motion_slide_up)) {
            const motion_length = length(slide_motion);
            slide_motion = cross(cross(up, result.remainder), state.floor_normal);
            slide_motion = normalized(slide_motion);
            slide_motion = op_multiply(slide_motion, motion_length);
          }
          motion = dot(slide_motion, state.velocity) > 0 ? slide_motion : ZERO;
          if (state.slide_on_ceiling && result_state.ceiling) {
            if (vel_dir_facing_up) state.velocity = slide(state.velocity, collision.normal);
            else state.velocity = op_multiply(up, dot(up, state.velocity));
          }
        } else {
          motion = result.remainder;
          if (result_state.ceiling && !state.slide_on_ceiling && vel_dir_facing_up) {
            state.velocity = slide(state.velocity, up);
            motion = slide(motion, up);
          }
        }
      }

      total_travel = op_add(total_travel, result.travel);

      if (was_on_floor && state.floor_constant_speed && can_apply_constant_speed && state.collision_state.floor && !is_zero_approx(motion)) {
        const travel_slide_up = slide(total_travel, up);
        const remaining = f32(length(motion_slide_up) - length(travel_slide_up));
        motion = op_multiply(normalized(motion), remaining > 0 ? remaining : 0);
      }
    } else if (state.floor_constant_speed && first_slide && onFloorIfSnapped(self, state, was_on_floor, vel_dir_facing_up)) {
      can_apply_constant_speed = false;
      sliding_enabled = true;
      const gt = get_global_transform(self as Object3D);
      set_global_transform(self as Object3D, withOrigin(gt, op_subtract(gt.origin, result.travel)));
      const motion_slide_norm = normalized(cross(cross(up, motion), prev_floor_normal));
      motion = op_multiply(motion_slide_norm, length(motion_slide_up));
      collided = true;
    }

    if (!collided || is_zero_approx(motion)) break;

    can_apply_constant_speed = !can_apply_constant_speed && !sliding_enabled;
    sliding_enabled = true;
    first_slide = false;
  }

  snapOnFloor(self, state, was_on_floor, vel_dir_facing_up);

  if (state.collision_state.floor && !vel_dir_facing_up) state.velocity = slide(state.velocity, up);
}

/** `_move_and_slide_floating` (`character_body_3d.cpp:402`). */
function slideFloating(self: object, state: BodyState, delta: number): void {
  let motion = op_multiply(state.velocity, delta);
  state.platform_rid = null;
  state.floor_normal = ZERO;
  state.platform_velocity = ZERO;
  state.platform_angular_velocity = ZERO;
  let first_slide = true;
  for (let iteration = 0; iteration < state.max_slides; iteration += 1) {
    const parameters = godot_test_motion_parameters(get_global_transform(self as Object3D), motion, state.margin);
    parameters.recovery_as_collision = true;
    const result = godot_test_motion_result();
    const collided = moveAndCollide(self, parameters, result, false, false);
    state.last_motion = result.travel;
    if (collided) {
      state.motion_results.push(result);
      setCollisionDirection(state, result, flags());
      if (is_zero_approx(result.remainder)) {
        motion = ZERO;
        break;
      }
      if (state.wall_min_slide_angle !== 0 && f32(Math.acos(dot(state.wall_normal, op_negate(normalized(state.velocity))))) < state.wall_min_slide_angle + FLOOR_ANGLE_THRESHOLD) {
        motion = ZERO;
        if (length(result.travel) < f32(state.margin + CMP_EPSILON)) {
          const gt = get_global_transform(self as Object3D);
          set_global_transform(self as Object3D, withOrigin(gt, op_subtract(gt.origin, result.travel)));
        }
      } else if (first_slide) {
        const motion_slide_norm = normalized(slide(result.remainder, state.wall_normal));
        motion = op_multiply(motion_slide_norm, f32(length(motion) - length(result.travel)));
      } else {
        motion = slide(result.remainder, state.wall_normal);
      }
      if (dot(motion, state.velocity) <= 0) motion = ZERO;
    }
    if (!collided || is_zero_approx(motion)) break;
    first_slide = false;
  }
}

/**
 * Moves the body by `velocity` over the current frame's delta (the physics delta inside a physics
 * frame, else the process delta), sliding along what it hits; true when it collided.
 *
 * @godot CharacterBody3D.move_and_slide
 * @source scene/3d/physics/character_body_3d.cpp:43
 */
export function move_and_slide(owner: object): boolean {
  const state = stateOf(owner, 'move_and_slide');
  const self = godot_node_entity(owner);
  const delta = godot_tree_process_delta(godot_tree_frames().inPhysics);
  const gt = get_global_transform(self as Object3D);
  state.previous_position = gt.origin;
  let current_platform_velocity = state.platform_velocity;

  if ((state.collision_state.floor || state.collision_state.wall) && state.platform_rid !== null) {
    let excluded = false;
    if (state.collision_state.floor) excluded = (state.platform_floor_layers & state.platform_layer) === 0;
    else if (state.collision_state.wall) excluded = (state.platform_wall_layers & state.platform_layer) === 0;
    if (!excluded) {
      const platform = godot_collision_object_state(state.platform_rid);
      const velocity = platform === undefined ? undefined : platformVelocity(state.platform_rid, op_subtract(gt.origin, platform.transform.origin));
      if (velocity !== undefined) {
        current_platform_velocity = velocity;
      } else {
        current_platform_velocity = ZERO;
        state.platform_rid = null;
      }
    } else {
      current_platform_velocity = ZERO;
    }
  }

  state.motion_results = [];
  const was_on_floor = state.collision_state.floor;
  state.collision_state = flags();
  state.last_motion = ZERO;

  if (!is_zero_approx(current_platform_velocity)) {
    const parameters = godot_test_motion_parameters(get_global_transform(self as Object3D), op_multiply(current_platform_velocity, delta), state.margin);
    parameters.recovery_as_collision = true;
    if (state.platform_rid !== null) parameters.exclude_bodies = [state.platform_rid];
    const floor_result = godot_test_motion_result();
    if (moveAndCollide(self, parameters, floor_result, false, false)) {
      state.motion_results.push(floor_result);
      setCollisionDirection(state, floor_result, flags());
    }
  }

  if (state.motion_mode === MOTION_MODE_GROUNDED) slideGrounded(self, state, delta, was_on_floor);
  else slideFloating(self, state, delta);

  state.real_velocity = op_divide(get_position_delta(self), delta);

  if (state.platform_on_leave !== PLATFORM_ON_LEAVE_DO_NOTHING) {
    if (!state.collision_state.floor && !state.collision_state.wall) {
      if (state.platform_on_leave === PLATFORM_ON_LEAVE_ADD_UPWARD_VELOCITY && dot(current_platform_velocity, state.up_direction) < 0) {
        current_platform_velocity = slide(current_platform_velocity, state.up_direction);
      }
      state.velocity = op_add(state.velocity, current_platform_velocity);
    }
  }
  return state.motion_results.length > 0;
}

/**
 * @godot CharacterBody3D.apply_floor_snap
 * @source scene/3d/physics/character_body_3d.cpp:459
 */
export function apply_floor_snap(self: object): void {
  applyFloorSnap(godot_node_entity(self), stateOf(self, 'apply_floor_snap'));
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
  return stateOf(self, 'get_slide_collision_count').motion_results.length;
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
