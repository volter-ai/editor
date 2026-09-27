/**
 * @godot-class PhysicsTestMotionParameters3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsTestMotionParameters3D` (`servers/physics_3d/physics_server_3d.h:945`,
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a mutable record of
 * `PhysicsServer3D::MotionParameters` (`physics_server_3d.h:527`), whose fields are Godot's.
 * `exclude_bodies` holds collision-object RIDs (entities); `exclude_objects` instance ids (objects).
 */

import { construct as transform3d, type Transform3D } from './transform-3d';
import { construct as vector3, type Vector3 } from './vector3';

export interface PhysicsTestMotionParameters3D {
  from: Transform3D;
  motion: Vector3;
  margin: number;
  max_collisions: number;
  collide_separation_ray: boolean;
  exclude_bodies: readonly object[];
  exclude_objects: readonly object[];
  recovery_as_collision: boolean;
}

/**
 * `MotionParameters(from, motion, margin = 0.001)` (`physics_server_3d.h:539`).
 *
 * @godot PhysicsTestMotionParameters3D (protocol)
 * @source servers/physics_3d/physics_server_3d.h:539
 */
export function godot_test_motion_parameters(
  from: Transform3D = transform3d(),
  motion: Vector3 = vector3(),
  margin = 0.001,
): PhysicsTestMotionParameters3D {
  return {
    from,
    motion,
    margin: Math.fround(margin),
    max_collisions: 1,
    collide_separation_ray: false,
    exclude_bodies: [],
    exclude_objects: [],
    recovery_as_collision: false,
  };
}

/**
 * @godot PhysicsTestMotionParameters3D.get_from
 * @source servers/physics_3d/physics_server_3d.h:951
 */
export function get_from(self: PhysicsTestMotionParameters3D): Transform3D {
  return self.from;
}

/**
 * @godot PhysicsTestMotionParameters3D.set_from
 * @source servers/physics_3d/physics_server_3d.h:952
 */
export function set_from(self: PhysicsTestMotionParameters3D, from: Transform3D): void {
  self.from = transform3d(from);
}

/**
 * @godot PhysicsTestMotionParameters3D.get_motion
 * @source servers/physics_3d/physics_server_3d.h:954
 */
export function get_motion(self: PhysicsTestMotionParameters3D): Vector3 {
  return self.motion;
}

/**
 * @godot PhysicsTestMotionParameters3D.set_motion
 * @source servers/physics_3d/physics_server_3d.h:955
 */
export function set_motion(self: PhysicsTestMotionParameters3D, motion: Vector3): void {
  self.motion = vector3(motion);
}

/**
 * @godot PhysicsTestMotionParameters3D.get_margin
 * @source servers/physics_3d/physics_server_3d.h:957
 */
export function get_margin(self: PhysicsTestMotionParameters3D): number {
  return self.margin;
}

/**
 * @godot PhysicsTestMotionParameters3D.set_margin
 * @source servers/physics_3d/physics_server_3d.h:958
 */
export function set_margin(self: PhysicsTestMotionParameters3D, margin: number): void {
  self.margin = Math.fround(margin);
}

/**
 * @godot PhysicsTestMotionParameters3D.get_max_collisions
 * @source servers/physics_3d/physics_server_3d.h:960
 */
export function get_max_collisions(self: PhysicsTestMotionParameters3D): number {
  return self.max_collisions;
}

/**
 * The value is truncated to a C `int`.
 *
 * @godot PhysicsTestMotionParameters3D.set_max_collisions
 * @source servers/physics_3d/physics_server_3d.h:961
 */
export function set_max_collisions(self: PhysicsTestMotionParameters3D, max_collisions: number): void {
  self.max_collisions = max_collisions | 0;
}

/**
 * @godot PhysicsTestMotionParameters3D.is_collide_separation_ray_enabled
 * @source servers/physics_3d/physics_server_3d.h:963
 */
export function is_collide_separation_ray_enabled(self: PhysicsTestMotionParameters3D): boolean {
  return self.collide_separation_ray;
}

/**
 * @godot PhysicsTestMotionParameters3D.set_collide_separation_ray_enabled
 * @source servers/physics_3d/physics_server_3d.h:964
 */
export function set_collide_separation_ray_enabled(self: PhysicsTestMotionParameters3D, enabled: boolean): void {
  self.collide_separation_ray = enabled;
}

/**
 * @godot PhysicsTestMotionParameters3D.set_exclude_bodies
 * @source servers/physics_3d/physics_server_3d.cpp:511
 */
export function set_exclude_bodies(self: PhysicsTestMotionParameters3D, exclude_list: readonly object[]): void {
  self.exclude_bodies = [...new Set(exclude_list)];
}

/**
 * @godot PhysicsTestMotionParameters3D.is_recovery_as_collision_enabled
 * @source servers/physics_3d/physics_server_3d.h:972
 */
export function is_recovery_as_collision_enabled(self: PhysicsTestMotionParameters3D): boolean {
  return self.recovery_as_collision;
}

/**
 * @godot PhysicsTestMotionParameters3D.set_recovery_as_collision_enabled
 * @source servers/physics_3d/physics_server_3d.h:973
 */
export function set_recovery_as_collision_enabled(self: PhysicsTestMotionParameters3D, enabled: boolean): void {
  self.recovery_as_collision = enabled;
}
