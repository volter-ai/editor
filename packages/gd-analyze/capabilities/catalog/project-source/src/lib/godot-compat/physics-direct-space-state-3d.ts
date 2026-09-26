/**
 * @godot-class PhysicsDirectSpaceState3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsDirectSpaceState3D.intersect_ray`, transcribed from GodotPhysics3D (the
 * pinned default 3D engine, `modules/godot_physics_3d/godot_space_3d.cpp:110`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over the Rapier world: Rapier's broad phase gathers
 * the colliders whose bounds meet the segment's, Godot's filter admits them (layer against mask,
 * bodies/areas, exclusions), and each shape's own segment and point tests (`shape-3d.ts`) run in
 * the shape's local space through Godot's single-precision transforms. The nearest hit along the
 * ray wins; a shape containing the start is skipped, or with `hit_from_inside` is hit there.
 * Godot visits candidates in its broad phase's order; here they are visited in the order the
 * collision objects entered the world, which decides only between two equally near hits.
 */

import type { Collider } from '@dimforge/rapier3d-compat';
import {
  type CollisionShapeEntry,
  godot_collision_object_object,
  godot_collision_object_of_collider,
  godot_collision_object_state,
  godot_collision_objects,
} from './collision-object-3d';
import type { PhysicsRayQueryParameters3D } from './physics-ray-query-parameters-3d';
import { godot_shape_3d_intersect_point, godot_shape_3d_intersect_segment } from './shape-3d';
import { op_multiply as transform, type Transform3D } from './transform-3d';
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

/** `Basis::xform_inv`: the columns dotted with the vector (`core/math/basis.h:343`). */
function basisXformInv(basis: Transform3D['basis'], v: Vector3): Vector3 {
  return vector3(dot(basis.x, v), dot(basis.y, v), dot(basis.z, v));
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
  const found: { entity: object; index: number; entry: CollisionShapeEntry; transform: Transform3D; inverse: Transform3D }[] = [];
  for (const [entity, state] of godot_collision_objects()) {
    if (!admits(entity, query)) continue;
    state.colliders.forEach((entry, index) => {
      if (near.has(entry.collider.handle)) found.push({ entity, index, entry, transform: state.transform, inverse: state.inverse });
    });
  }
  return found;
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
    // `get_shape_inv_transform(shape_idx) * get_inv_transform()`.
    const inv_xform = transform(candidate.entry.localInverse, candidate.inverse);
    const local_from = transform(inv_xform, begin);
    const local_to = transform(inv_xform, end);
    if (godot_shape_3d_intersect_point(candidate.entry.shape, local_from)) {
      if (!parameters.hit_from_inside) continue;
      best = { point: begin, normal: vector3(), face: -1, entity: candidate.entity, index: candidate.index };
      break;
    }
    const hit = godot_shape_3d_intersect_segment(candidate.entry.shape, local_from, local_to, parameters.hit_back_faces);
    if (hit === undefined) continue;
    const point = transform(transform(candidate.transform, candidate.entry.local), hit.point);
    const ld = dot(normal, point);
    if (ld < min_d) {
      min_d = ld;
      best = {
        point,
        normal: normalized(basisXformInv(inv_xform.basis, hit.normal)),
        face: hit.face,
        entity: candidate.entity,
        index: candidate.index,
      };
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

export type { Vector3 };
