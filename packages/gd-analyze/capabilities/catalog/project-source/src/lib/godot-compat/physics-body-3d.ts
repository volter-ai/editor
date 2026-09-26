/**
 * @godot-class PhysicsBody3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsBody3D` (`scene/3d/physics/physics_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): collision exceptions, which live with the body's
 * state in `collision-object-3d.ts`, and `move_and_collide`, a motion test
 * (`physics-server-3d.ts`) followed by moving the node by the travel, and axis locks: the node's
 * `locked_axis`, which `move_and_collide` zeroes the travel along, handed to the server body
 * (`collision-object-3d.ts`), whose integration holds the locked velocities at zero.
 */

import type { Object3D } from 'three';
import { godot_collision_object_exceptions, godot_collision_object_set_axis_lock, godot_collision_object_state } from './collision-object-3d';
import { godot_node_entity } from './node';
import { set_global_transform } from './node-3d';
import { body_test_motion } from './physics-server-3d';
import type { PhysicsTestMotionParameters3D } from './physics-test-motion-parameters-3d';
import type { PhysicsTestMotionResult3D } from './physics-test-motion-result-3d';
import { construct as transform3d } from './transform-3d';
import { dot, length, op_add, op_divide, op_multiply, op_subtract, construct as vector3 } from './vector3';

const f32 = Math.fround;

/** The node's `locked_axis` (`PhysicsBody3D::locked_axis`, `physics_body_3d.h`), by entity. */
const LOCKED = new WeakMap<object, number>();
/** `(real_t)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

/**
 * `PhysicsBody3D::move_and_collide` (the C++ overload): the motion test; with `cancel_sliding`,
 * a recovery that turned the travel aside by less than the margin is taken back along the motion;
 * unless `test_only`, the node moves to `from` plus the travel.
 *
 * @godot PhysicsBody3D (protocol)
 * @source scene/3d/physics/physics_body_3d.cpp:112
 */
export function godot_physics_body_move_and_collide(
  body: object,
  parameters: PhysicsTestMotionParameters3D,
  result: PhysicsTestMotionResult3D,
  test_only: boolean,
  cancel_sliding: boolean,
): boolean {
  const entity = godot_node_entity(body);
  const colliding = body_test_motion(entity, parameters, result);
  if (cancel_sliding) {
    const motion_length = length(parameters.motion);
    let precision = f32(0.001);
    let cancel = true;
    if (colliding) {
      precision = f32(precision + f32(motion_length * f32(result.collision_unsafe_fraction - result.collision_safe_fraction)));
      if ((result.collisions[0]?.depth ?? 0) > f32(parameters.margin + precision)) cancel = false;
    }
    if (cancel) {
      const motion_normal = motion_length > CMP_EPSILON ? op_divide(parameters.motion, motion_length) : vector3();
      const projected_length = dot(result.travel, motion_normal);
      const recovery = op_subtract(result.travel, op_multiply(motion_normal, projected_length));
      if (length(recovery) < f32(parameters.margin + precision)) {
        result.travel = op_multiply(motion_normal, projected_length);
        result.remainder = op_subtract(parameters.motion, result.travel);
      }
    }
  }
  // A locked linear axis takes no travel (`physics_body_3d.cpp:153`).
  const locked = LOCKED.get(entity) ?? 0;
  if (locked & 7) {
    result.travel = vector3(locked & 1 ? 0 : result.travel.x, locked & 2 ? 0 : result.travel.y, locked & 4 ? 0 : result.travel.z);
  }
  if (!test_only) {
    set_global_transform(entity as Object3D, transform3d(parameters.from.basis, op_add(parameters.from.origin, result.travel)));
  }
  return colliding;
}

/**
 * @godot PhysicsBody3D.add_collision_exception_with
 * @source scene/3d/physics/physics_body_3d.cpp:76
 */
export function add_collision_exception_with(self: object, body: object): void {
  const other = godot_node_entity(body);
  if (godot_collision_object_state(other) === undefined) return;
  godot_collision_object_exceptions(godot_node_entity(self)).add(other);
}

/**
 * @godot PhysicsBody3D.remove_collision_exception_with
 * @source scene/3d/physics/physics_body_3d.cpp:83
 */
export function remove_collision_exception_with(self: object, body: object): void {
  godot_collision_object_exceptions(godot_node_entity(self)).delete(godot_node_entity(body));
}

/**
 * Sets or clears a `BodyAxis` bit of the node's `locked_axis` and the server body's.
 *
 * @godot PhysicsBody3D.set_axis_lock
 * @source scene/3d/physics/physics_body_3d.cpp:192
 */
export function set_axis_lock(self: object, axis: number, lock: boolean): void {
  const entity = godot_node_entity(self);
  const locked = LOCKED.get(entity) ?? 0;
  LOCKED.set(entity, lock ? locked | axis : locked & ~axis);
  godot_collision_object_set_axis_lock(entity, axis, lock);
}

/**
 * @godot PhysicsBody3D.get_axis_lock
 * @source scene/3d/physics/physics_body_3d.cpp:201
 */
export function get_axis_lock(self: object, axis: number): boolean {
  return ((LOCKED.get(godot_node_entity(self)) ?? 0) & axis) !== 0;
}
