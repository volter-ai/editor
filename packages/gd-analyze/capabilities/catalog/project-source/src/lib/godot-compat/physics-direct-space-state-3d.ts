/**
 * @godot-class PhysicsDirectSpaceState3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsDirectSpaceState3D` (`servers/physics_3d/physics_server_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as Rapier's scene queries on the `<Physics>` world:
 * `intersect_ray` is `castRayAndGetNormal` along the segment, admitting what the query's mask
 * takes by each node's layer, bodies or areas as it asks, and nothing it excludes.
 */

import { type Collider, Ray, ShapeType } from '@dimforge/rapier3d-compat';
import { godot_collision_object_layers, godot_collision_object_of_collider } from './collision-object-3d';
import { godot_node_object } from './node';
import type { PhysicsRayQueryParameters3D } from './physics-ray-query-parameters-3d';
import { construct as vector3, type Vector3 } from './vector3';
import type { PhysicsDirectSpaceState3D } from './world-3d';

/**
 * Whether Godot counts `point` as inside the collider's shape. Godot's solid shapes (sphere, box,
 * capsule, cylinder, convex polygon, world boundary) answer `intersect_point` by volume
 * (`godot_shape_3d.cpp:277`, `:421`, `:600`, `:738`, `:1002`, `:137`); its concave polygon,
 * height map, face and separation ray shapes are surfaces and always answer false
 * (`godot_shape_3d.cpp:1408`, `:1994`, `:1256`, `:214`). Rapier's `containsPoint` is the volume
 * test for the solid ones.
 */
function startsInside(collider: Collider, point: { x: number; y: number; z: number }): boolean {
  switch (collider.shapeType()) {
    case ShapeType.TriMesh:
    case ShapeType.HeightField:
    case ShapeType.Polyline:
    case ShapeType.Triangle:
    case ShapeType.RoundTriangle:
    case ShapeType.Segment:
      return false;
    default:
      return collider.containsPoint(point);
  }
}

/**
 * The nearest hit as Godot's Dictionary (`position`, `normal`, `face_index`, `collider_id`,
 * `collider`, `shape`, `rid`), or an empty Dictionary. `collider_id` is the collider object itself
 * (compat has no instance ids).
 *
 * A shape the ray starts inside is Godot's special case (`godot_space_3d.cpp:156`): with
 * `hit_from_inside` it is the hit, at the ray's origin with a zero normal; without it the shape is
 * skipped and the ray goes on to the others, so a ray that starts inside its own body sees past it.
 * Rapier's non-solid cast would instead report where the ray leaves that shape, so the shapes
 * containing the origin are taken out of the cast, and the cast is never solid.
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
  const origin = { x: from.x, y: from.y, z: from.z };
  const ray = new Ray(origin, { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
  const admits = (collider: Collider): boolean => {
    const node = godot_collision_object_of_collider(collider);
    if (node === undefined || parameters.exclude.includes(node)) return false;
    if ((godot_collision_object_layers(node).layer & parameters.collision_mask) === 0) return false;
    // An area's shapes are Rapier sensors and a body's are not: the collider in hand says which,
    // without walking the node's body for its kind on every candidate the cast tests.
    return collider.isSensor() ? parameters.collide_with_areas : parameters.collide_with_bodies;
  };
  if (parameters.hit_from_inside) {
    let inside: Collider | undefined;
    world.intersectionsWithPoint(origin, (collider) => {
      inside = collider;
      return false;
    }, undefined, undefined, undefined, undefined, (collider) => admits(collider) && startsInside(collider, origin));
    if (inside !== undefined) return describe(result, inside, vector3(from.x, from.y, from.z), vector3());
  }
  const hit = world.castRayAndGetNormal(ray, 1, false, undefined, undefined, undefined, undefined, (collider) => admits(collider) && !startsInside(collider, origin));
  if (hit === null) return result;
  const point = ray.pointAt(hit.timeOfImpact);
  return describe(result, hit.collider, vector3(point.x, point.y, point.z), vector3(hit.normal.x, hit.normal.y, hit.normal.z));
}

function describe(result: Map<string, unknown>, collider: Collider, position: Vector3, normal: Vector3): Map<string, unknown> {
  const node = godot_collision_object_of_collider(collider) as object;
  const object = godot_node_object(node);
  result.set('position', position);
  result.set('normal', normal);
  result.set('face_index', -1);
  result.set('collider_id', object);
  result.set('collider', object);
  result.set('shape', 0);
  result.set('rid', node);
  return result;
}
