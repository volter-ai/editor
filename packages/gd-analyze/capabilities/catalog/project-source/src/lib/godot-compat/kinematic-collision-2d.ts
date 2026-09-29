/**
 * @godot-class KinematicCollision2D
 * @role BINDING
 *
 * Godot 4.7's `KinematicCollision2D` (`scene/2d/physics/kinematic_collision_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): one collision of a body's motion, a record of what it
 * hit, where, along which normal, and the motion made and left.
 */

import { construct as vector2, type Vector2 } from './vector2';

export interface KinematicCollision2D {
  readonly collider: object;
  readonly normal: Vector2;
  readonly position: Vector2;
  readonly travel: Vector2;
  readonly remainder: Vector2;
  readonly colliderVelocity: Vector2;
  readonly depth: number;
}

/**
 * A collision record (`PhysicsServer2D::MotionResult`, `physics_server_2d.h:540`).
 *
 * @godot KinematicCollision2D (protocol)
 * @source scene/2d/physics/kinematic_collision_2d.cpp:37
 */
export function godot_kinematic_collision_2d_new(record: KinematicCollision2D): KinematicCollision2D {
  return Object.freeze(record);
}

/**
 * @godot KinematicCollision2D.get_collider
 * @source scene/2d/physics/kinematic_collision_2d.cpp:73
 */
export function get_collider(self: KinematicCollision2D): object {
  return self.collider;
}

/**
 * @godot KinematicCollision2D.get_normal
 * @source scene/2d/physics/kinematic_collision_2d.cpp:41
 */
export function get_normal(self: KinematicCollision2D): Vector2 {
  return self.normal;
}

/**
 * @godot KinematicCollision2D.get_position
 * @source scene/2d/physics/kinematic_collision_2d.cpp:37
 */
export function get_position(self: KinematicCollision2D): Vector2 {
  return self.position;
}

/**
 * @godot KinematicCollision2D.get_travel
 * @source scene/2d/physics/kinematic_collision_2d.cpp:45
 */
export function get_travel(self: KinematicCollision2D): Vector2 {
  return self.travel;
}

/**
 * @godot KinematicCollision2D.get_remainder
 * @source scene/2d/physics/kinematic_collision_2d.cpp:49
 */
export function get_remainder(self: KinematicCollision2D): Vector2 {
  return self.remainder;
}

/**
 * The angle between the normal and `up_direction` (`Vector2.UP` by default).
 *
 * @godot KinematicCollision2D.get_angle
 * @source scene/2d/physics/kinematic_collision_2d.cpp:53
 */
export function get_angle(self: KinematicCollision2D, up_direction: Vector2 = vector2(0, -1)): number {
  const dot = self.normal.x * up_direction.x + self.normal.y * up_direction.y;
  return Math.acos(Math.min(Math.max(dot, -1), 1));
}

/**
 * @godot KinematicCollision2D.get_depth
 * @source scene/2d/physics/kinematic_collision_2d.cpp:58
 */
export function get_depth(self: KinematicCollision2D): number {
  return self.depth;
}

/**
 * @godot KinematicCollision2D.get_collider_velocity
 * @source scene/2d/physics/kinematic_collision_2d.cpp:89
 */
export function get_collider_velocity(self: KinematicCollision2D): Vector2 {
  return self.colliderVelocity;
}
