/**
 * @godot-class KinematicCollision3D
 * @role BINDING
 *
 * Godot 4.7's `KinematicCollision3D` (`scene/3d/physics/kinematic_collision_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the collisions of one body motion, each what was hit,
 * where and along which normal, with the motion made and left.
 */

import { construct as vector3, type Vector3 } from './vector3';

export interface KinematicCollision3DHit {
  readonly collider: object | null;
  readonly normal: Vector3;
  readonly position: Vector3;
}

export interface KinematicCollision3D {
  readonly hits: readonly KinematicCollision3DHit[];
  readonly travel: Vector3;
  readonly remainder: Vector3;
}

/**
 * A motion's collisions (`PhysicsServer3D::MotionResult`, `physics_server_3d.h:585`).
 *
 * @godot KinematicCollision3D (protocol)
 * @source scene/3d/physics/kinematic_collision_3d.cpp:36
 */
export function godot_kinematic_collision_3d_new(record: KinematicCollision3D): KinematicCollision3D {
  return Object.freeze(record);
}

function hit(self: KinematicCollision3D, index: number): KinematicCollision3DHit | undefined {
  return self.hits[index];
}

/**
 * @godot KinematicCollision3D.get_collider
 * @source scene/3d/physics/kinematic_collision_3d.cpp:88
 */
export function get_collider(self: KinematicCollision3D, collision_index = 0): object | null {
  return hit(self, collision_index)?.collider ?? null;
}

/**
 * @godot KinematicCollision3D.get_normal
 * @source scene/3d/physics/kinematic_collision_3d.cpp:57
 */
export function get_normal(self: KinematicCollision3D, collision_index = 0): Vector3 {
  return hit(self, collision_index)?.normal ?? vector3();
}

/**
 * @godot KinematicCollision3D.get_position
 * @source scene/3d/physics/kinematic_collision_3d.cpp:52
 */
export function get_position(self: KinematicCollision3D, collision_index = 0): Vector3 {
  return hit(self, collision_index)?.position ?? vector3();
}

/**
 * @godot KinematicCollision3D.get_collision_count
 * @source scene/3d/physics/kinematic_collision_3d.cpp:48
 */
export function get_collision_count(self: KinematicCollision3D): number {
  return self.hits.length;
}

/**
 * @godot KinematicCollision3D.get_travel
 * @source scene/3d/physics/kinematic_collision_3d.cpp:36
 */
export function get_travel(self: KinematicCollision3D): Vector3 {
  return self.travel;
}

/**
 * @godot KinematicCollision3D.get_remainder
 * @source scene/3d/physics/kinematic_collision_3d.cpp:40
 */
export function get_remainder(self: KinematicCollision3D): Vector3 {
  return self.remainder;
}

/**
 * The angle between the normal and `up_direction` (`Vector3.UP` by default).
 *
 * @godot KinematicCollision3D.get_angle
 * @source scene/3d/physics/kinematic_collision_3d.cpp:62
 */
export function get_angle(self: KinematicCollision3D, collision_index = 0, up_direction: Vector3 = vector3(0, 1, 0)): number {
  const n = get_normal(self, collision_index);
  return Math.acos(Math.min(Math.max(n.x * up_direction.x + n.y * up_direction.y + n.z * up_direction.z, -1), 1));
}

/**
 * @godot KinematicCollision3D.get_collider_velocity
 * @source scene/3d/physics/kinematic_collision_3d.cpp:118
 */
export function get_collider_velocity(self: KinematicCollision3D, collision_index = 0): Vector3 {
  void self;
  void collision_index;
  return vector3();
}
