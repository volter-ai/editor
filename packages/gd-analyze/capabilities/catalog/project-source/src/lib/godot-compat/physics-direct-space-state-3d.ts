/**
 * @godot-class PhysicsDirectSpaceState3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsDirectSpaceState3D` (`servers/physics_3d/physics_server_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as Rapier's scene queries on the `<Physics>` world:
 * `intersect_ray` is `castRayAndGetNormal` along the segment, admitting what the query's mask
 * takes by each node's layer, bodies or areas as it asks, and nothing it excludes.
 */

import { type Collider, Ray } from '@dimforge/rapier3d-compat';
import { godot_collision_object_kind, godot_collision_object_layers, godot_collision_object_of_collider } from './collision-object-3d';
import { godot_node_object } from './node';
import type { PhysicsRayQueryParameters3D } from './physics-ray-query-parameters-3d';
import { construct as vector3 } from './vector3';
import type { PhysicsDirectSpaceState3D } from './world-3d';

/**
 * The nearest hit as Godot's Dictionary (`position`, `normal`, `face_index`, `collider_id`,
 * `collider`, `shape`, `rid`), or an empty Dictionary. `collider_id` is the collider object itself
 * (compat has no instance ids).
 *
 * @godot PhysicsDirectSpaceState3D.intersect_ray
 * @source modules/godot_physics_3d/godot_space_3d.cpp:110
 */
export function intersect_ray(self: PhysicsDirectSpaceState3D, parameters: PhysicsRayQueryParameters3D): Map<string, unknown> {
  const result = new Map<string, unknown>();
  const world = self.space.world;
  if (world === undefined) return result;
  const from = parameters.from;
  const to = parameters.to;
  const ray = new Ray({ x: from.x, y: from.y, z: from.z }, { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
  const admits = (collider: Collider): boolean => {
    const node = godot_collision_object_of_collider(collider);
    if (node === undefined || parameters.exclude.includes(node)) return false;
    if ((godot_collision_object_layers(node).layer & parameters.collision_mask) === 0) return false;
    return godot_collision_object_kind(node) === 'area' ? parameters.collide_with_areas : parameters.collide_with_bodies;
  };
  const hit = world.castRayAndGetNormal(ray, 1, parameters.hit_from_inside, undefined, undefined, undefined, undefined, admits);
  if (hit === null) return result;
  const node = godot_collision_object_of_collider(hit.collider) as object;
  const object = godot_node_object(node);
  const point = ray.pointAt(hit.timeOfImpact);
  result.set('position', vector3(point.x, point.y, point.z));
  result.set('normal', vector3(hit.normal.x, hit.normal.y, hit.normal.z));
  result.set('face_index', -1);
  result.set('collider_id', object);
  result.set('collider', object);
  result.set('shape', 0);
  result.set('rid', node);
  return result;
}
