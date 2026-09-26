/**
 * @godot-class PhysicsTestMotionResult3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsTestMotionResult3D` (`servers/physics_3d/physics_server_3d.cpp:576`,
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a mutable record of
 * `PhysicsServer3D::MotionResult` (`physics_server_3d.h:561`), which
 * `PhysicsServer3D.body_test_motion` fills. A collision's `collider` is its RID (entity) and
 * `collider_id` its object.
 */

import { construct as vector3, type Vector3 } from './vector3';

export interface MotionCollision {
  position: Vector3;
  normal: Vector3;
  collider_velocity: Vector3;
  collider_angular_velocity: Vector3;
  depth: number;
  local_shape: number;
  collider_id: object | null;
  collider: object | null;
  collider_shape: number;
}

export interface PhysicsTestMotionResult3D {
  travel: Vector3;
  remainder: Vector3;
  collision_depth: number;
  collision_safe_fraction: number;
  collision_unsafe_fraction: number;
  collisions: MotionCollision[];
  collision_count: number;
}

/**
 * An empty `MotionResult` (`physics_server_3d.h:561`).
 *
 * @godot PhysicsTestMotionResult3D (protocol)
 * @source servers/physics_3d/physics_server_3d.h:561
 */
export function godot_test_motion_result(): PhysicsTestMotionResult3D {
  return { travel: vector3(), remainder: vector3(), collision_depth: 0, collision_safe_fraction: 0, collision_unsafe_fraction: 0, collisions: [], collision_count: 0 };
}

function collision(self: PhysicsTestMotionResult3D, index: number): MotionCollision | undefined {
  return index >= 0 && index < self.collision_count ? self.collisions[index] : undefined;
}

/**
 * @godot PhysicsTestMotionResult3D.get_travel
 * @source servers/physics_3d/physics_server_3d.cpp:576
 */
export function get_travel(self: PhysicsTestMotionResult3D): Vector3 {
  return self.travel;
}

/**
 * @godot PhysicsTestMotionResult3D.get_remainder
 * @source servers/physics_3d/physics_server_3d.cpp:580
 */
export function get_remainder(self: PhysicsTestMotionResult3D): Vector3 {
  return self.remainder;
}

/**
 * @godot PhysicsTestMotionResult3D.get_collision_safe_fraction
 * @source servers/physics_3d/physics_server_3d.cpp:584
 */
export function get_collision_safe_fraction(self: PhysicsTestMotionResult3D): number {
  return self.collision_safe_fraction;
}

/**
 * @godot PhysicsTestMotionResult3D.get_collision_unsafe_fraction
 * @source servers/physics_3d/physics_server_3d.cpp:588
 */
export function get_collision_unsafe_fraction(self: PhysicsTestMotionResult3D): number {
  return self.collision_unsafe_fraction;
}

/**
 * @godot PhysicsTestMotionResult3D.get_collision_count
 * @source servers/physics_3d/physics_server_3d.cpp:592
 */
export function get_collision_count(self: PhysicsTestMotionResult3D): number {
  return self.collision_count;
}

/**
 * An index outside the collisions fails with (0, 0, 0).
 *
 * @godot PhysicsTestMotionResult3D.get_collision_point
 * @source servers/physics_3d/physics_server_3d.cpp:596
 */
export function get_collision_point(self: PhysicsTestMotionResult3D, collision_index = 0): Vector3 {
  return collision(self, collision_index)?.position ?? vector3();
}

/**
 * @godot PhysicsTestMotionResult3D.get_collision_normal
 * @source servers/physics_3d/physics_server_3d.cpp:601
 */
export function get_collision_normal(self: PhysicsTestMotionResult3D, collision_index = 0): Vector3 {
  return collision(self, collision_index)?.normal ?? vector3();
}

/**
 * @godot PhysicsTestMotionResult3D.get_collider_velocity
 * @source servers/physics_3d/physics_server_3d.cpp:606
 */
export function get_collider_velocity(self: PhysicsTestMotionResult3D, collision_index = 0): Vector3 {
  return collision(self, collision_index)?.collider_velocity ?? vector3();
}

/**
 * @godot PhysicsTestMotionResult3D.get_collider
 * @source servers/physics_3d/physics_server_3d.cpp:621
 */
export function get_collider(self: PhysicsTestMotionResult3D, collision_index = 0): object | null {
  return collision(self, collision_index)?.collider_id ?? null;
}

/**
 * @godot PhysicsTestMotionResult3D.get_collider_shape
 * @source servers/physics_3d/physics_server_3d.cpp:626
 */
export function get_collider_shape(self: PhysicsTestMotionResult3D, collision_index = 0): number {
  return collision(self, collision_index)?.collider_shape ?? 0;
}

/**
 * @godot PhysicsTestMotionResult3D.get_collision_local_shape
 * @source servers/physics_3d/physics_server_3d.cpp:631
 */
export function get_collision_local_shape(self: PhysicsTestMotionResult3D, collision_index = 0): number {
  return collision(self, collision_index)?.local_shape ?? 0;
}

/**
 * @godot PhysicsTestMotionResult3D.get_collision_depth
 * @source servers/physics_3d/physics_server_3d.cpp:636
 */
export function get_collision_depth(self: PhysicsTestMotionResult3D, collision_index = 0): number {
  return collision(self, collision_index)?.depth ?? 0;
}
