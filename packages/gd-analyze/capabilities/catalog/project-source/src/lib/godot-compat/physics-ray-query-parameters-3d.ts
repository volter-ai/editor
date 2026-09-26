/**
 * @godot-class PhysicsRayQueryParameters3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsRayQueryParameters3D` (`servers/physics_3d/physics_server_3d.{h,cpp}`,
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a mutable record of the ray query's
 * parameters, whose fields are Godot's properties. `exclude` holds collision-object RIDs (entities).
 */

import { construct as vector3, type Vector3 } from './vector3';

export interface PhysicsRayQueryParameters3D {
  from: Vector3;
  to: Vector3;
  collision_mask: number;
  exclude: readonly object[];
  collide_with_bodies: boolean;
  collide_with_areas: boolean;
  hit_from_inside: boolean;
  hit_back_faces: boolean;
}

/**
 * A query with Godot's `RayParameters` defaults (`servers/physics_3d/physics_server_3d.h:140`).
 *
 * @godot PhysicsRayQueryParameters3D (protocol)
 * @source servers/physics_3d/physics_server_3d.h:140
 */
export function godot_ray_query_new(): PhysicsRayQueryParameters3D {
  return {
    from: vector3(),
    to: vector3(),
    collision_mask: 0xffffffff,
    exclude: [],
    collide_with_bodies: true,
    collide_with_areas: false,
    hit_from_inside: false,
    hit_back_faces: true,
  };
}

/**
 * A query from `from` to `to`; the Variant defaults are `collision_mask = 4294967295`,
 * `exclude = []`.
 *
 * @godot PhysicsRayQueryParameters3D.create
 * @source servers/physics_3d/physics_server_3d.cpp:241
 */
export function create(from: Vector3, to: Vector3, collision_mask = 0xffffffff, exclude: readonly object[] = []): PhysicsRayQueryParameters3D {
  const query = godot_ray_query_new();
  query.from = vector3(from);
  query.to = vector3(to);
  query.collision_mask = collision_mask >>> 0;
  query.exclude = [...exclude];
  return query;
}

/**
 * @godot PhysicsRayQueryParameters3D.set_collision_mask
 * @source servers/physics_3d/physics_server_3d.h:853
 */
export function set_collision_mask(self: PhysicsRayQueryParameters3D, mask: number): void {
  self.collision_mask = mask >>> 0;
}

/**
 * @godot PhysicsRayQueryParameters3D.set_collide_with_areas
 * @source servers/physics_3d/physics_server_3d.h:859
 */
export function set_collide_with_areas(self: PhysicsRayQueryParameters3D, enable: boolean): void {
  self.collide_with_areas = enable;
}

/**
 * @godot PhysicsRayQueryParameters3D.set_collide_with_bodies
 * @source servers/physics_3d/physics_server_3d.h:856
 */
export function set_collide_with_bodies(self: PhysicsRayQueryParameters3D, enable: boolean): void {
  self.collide_with_bodies = enable;
}

/**
 * @godot PhysicsRayQueryParameters3D.set_hit_from_inside
 * @source servers/physics_3d/physics_server_3d.h:862
 */
export function set_hit_from_inside(self: PhysicsRayQueryParameters3D, enable: boolean): void {
  self.hit_from_inside = enable;
}

/**
 * @godot PhysicsRayQueryParameters3D.set_exclude
 * @source servers/physics_3d/physics_server_3d.cpp:185
 */
export function set_exclude(self: PhysicsRayQueryParameters3D, exclude: readonly object[]): void {
  self.exclude = [...exclude];
}

/**
 * @godot PhysicsRayQueryParameters3D.set_hit_back_faces
 * @source servers/physics_3d/physics_server_3d.h:865
 */
export function set_hit_back_faces(self: PhysicsRayQueryParameters3D, enable: boolean): void {
  self.hit_back_faces = enable;
}

/**
 * @godot PhysicsRayQueryParameters3D.set_from
 * @source servers/physics_3d/physics_server_3d.h:847
 */
export function set_from(self: PhysicsRayQueryParameters3D, from: Vector3): void {
  self.from = vector3(from);
}

/**
 * @godot PhysicsRayQueryParameters3D.set_to
 * @source servers/physics_3d/physics_server_3d.h:850
 */
export function set_to(self: PhysicsRayQueryParameters3D, to: Vector3): void {
  self.to = vector3(to);
}
