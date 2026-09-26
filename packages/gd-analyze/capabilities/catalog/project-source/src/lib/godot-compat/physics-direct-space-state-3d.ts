/**
 * @godot-class PhysicsDirectSpaceState3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsDirectSpaceState3D.intersect_ray` (`modules/godot_physics_3d/godot_space_3d.cpp:110`,
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) on Rapier's rays. Godot's query semantics
 * are kept: the filter (layer against mask, bodies/areas, exclusions), a shape containing the start
 * skipped or, with `hit_from_inside`, hit there with a zero normal; a concave shape's back faces
 * passed through unless both its `backface_collision` and the query's `hit_back_faces` allow them
 * (Rapier reports a front-face hit as its face index plus the triangle count); the nearest hit along
 * the ray; Godot's Dictionary. Candidates are those Rapier's broad phase finds on the segment's
 * bounds, visited in the order the collision objects entered the world (this decides only between
 * equally near hits).
 *
 * Bounded deviation (`rapier-geometry`): the hit point and normal are Rapier's ray cast, not
 * GodotPhysics3D's per-shape segment tests; they differ by float32 rounding on boxes, spheres and
 * faces and by Rapier's convex-cast tolerance on capsules and convex hulls (measured per claim).
 */

import { type Collider, Ray, ShapeType, type TriMesh } from '@dimforge/rapier3d-compat';
import { godot_collision_object_object, godot_collision_object_of_collider, godot_collision_object_state, godot_collision_objects } from './collision-object-3d';
import type { PhysicsRayQueryParameters3D } from './physics-ray-query-parameters-3d';
import { godot_shape_3d_backface } from './shape-3d';
import { construct as vector3, dot, normalized, op_subtract, type Vector3 } from './vector3';
import type { PhysicsDirectSpaceState3D } from './world-3d';

const f32 = Math.fround;

/** `_can_collide_with` and the exclusion set (`modules/godot_physics_3d/godot_space_3d.cpp:43`). */
function admits(entity: object, query: PhysicsRayQueryParameters3D): boolean {
  const state = godot_collision_object_state(entity);
  if (state === undefined || (state.layer & query.collision_mask) === 0) return false;
  if (state.kind === 'area' ? !query.collide_with_areas : !query.collide_with_bodies) return false;
  return !query.exclude.includes(entity);
}

/** The admitted shapes whose Rapier bounds meet the segment's, in world order. */
function candidates(self: PhysicsDirectSpaceState3D, begin: Vector3, end: Vector3, query: PhysicsRayQueryParameters3D) {
  const near = new Set<Collider['handle']>();
  const margin = 1e-3;
  self.space.world.collidersWithAabbIntersectingAabb(
    { x: (begin.x + end.x) / 2, y: (begin.y + end.y) / 2, z: (begin.z + end.z) / 2 },
    {
      x: Math.abs(end.x - begin.x) / 2 + margin,
      y: Math.abs(end.y - begin.y) / 2 + margin,
      z: Math.abs(end.z - begin.z) / 2 + margin,
    },
    (collider) => {
      if (godot_collision_object_of_collider(collider) !== undefined) near.add(collider.handle);
      return true;
    },
  );
  const found: { entity: object; index: number; collider: Collider; backface: boolean }[] = [];
  for (const [entity, state] of godot_collision_objects()) {
    if (!admits(entity, query)) continue;
    state.colliders.forEach((entry, index) => {
      if (entry.inBroadphase && entry.collider !== undefined && near.has(entry.collider.handle)) {
        found.push({ entity, index, collider: entry.collider, backface: godot_shape_3d_backface(entry.shape) });
      }
    });
  }
  return found;
}

/** The nearest front-facing (or admitted back-facing) Rapier hit of the segment on one collider. */
function castOn(collider: Collider, begin: Vector3, end: Vector3, backFaces: boolean) {
  const dir = { x: end.x - begin.x, y: end.y - begin.y, z: end.z - begin.z };
  const concave = collider.shape.type === ShapeType.TriMesh;
  const triangles = concave ? ((collider.shape as TriMesh).indices?.length ?? 0) / 3 : 0;
  let from = 0;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const ray = new Ray({ x: begin.x + dir.x * from, y: begin.y + dir.y * from, z: begin.z + dir.z * from }, dir);
    const hit = collider.castRayAndGetNormal(ray, 1 - from, false);
    if (hit === null) return undefined;
    const toi = from + hit.timeOfImpact;
    const feature = hit.featureId ?? -1;
    if (concave && feature < triangles && !backFaces) {
      // A back face is passed through (`GodotFaceShape3D::intersect_segment`, `godot_shape_3d.cpp:1240`).
      from = toi + 1e-6;
      continue;
    }
    const point = ray.pointAt(hit.timeOfImpact);
    return {
      point: vector3(point.x, point.y, point.z),
      normal: vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      face: concave ? feature % triangles : -1,
    };
  }
  return undefined;
}

/**
 * The nearest hit as Godot's Dictionary (`position`, `normal`, `face_index`, `collider_id`,
 * `collider`, `shape`, `rid`), or an empty Dictionary. `collider_id` is the collider object itself
 * (compat has no instance ids).
 *
 * @godot PhysicsDirectSpaceState3D.intersect_ray
 * @source modules/godot_physics_3d/godot_space_3d.cpp:110
 */
export function intersect_ray(self: PhysicsDirectSpaceState3D, parameters: PhysicsRayQueryParameters3D): Map<string, unknown> {
  const begin = vector3(parameters.from);
  const end = vector3(parameters.to);
  const normal = normalized(op_subtract(end, begin));
  let min_d = f32(1e10);
  let best: { point: Vector3; normal: Vector3; face: number; entity: object; index: number } | undefined;
  for (const candidate of candidates(self, begin, end, parameters)) {
    const concave = candidate.collider.shape.type === ShapeType.TriMesh;
    // A concave shape has no inside (`GodotConcavePolygonShape3D::intersect_point`).
    if (!concave && candidate.collider.containsPoint(begin)) {
      if (!parameters.hit_from_inside) continue;
      best = { point: begin, normal: vector3(), face: -1, entity: candidate.entity, index: candidate.index };
      break;
    }
    const hit = castOn(candidate.collider, begin, end, candidate.backface && parameters.hit_back_faces);
    if (hit === undefined) continue;
    const ld = dot(normal, hit.point);
    if (ld < min_d) {
      min_d = ld;
      best = { ...hit, entity: candidate.entity, index: candidate.index };
    }
  }
  const result = new Map<string, unknown>();
  if (best === undefined) return result;
  const object = godot_collision_object_object(best.entity);
  result.set('position', best.point);
  result.set('normal', best.normal);
  result.set('face_index', best.face);
  result.set('collider_id', object);
  result.set('collider', object);
  result.set('shape', best.index);
  result.set('rid', best.entity);
  return result;
}
