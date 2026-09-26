/**
 * @godot-class ConcavePolygonShape3D
 * @role BINDING
 *
 * Godot 4.7's `ConcavePolygonShape3D` (`scene/resources/3d/concave_polygon_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a Rapier triangle mesh: `faces` holds three
 * vertices per triangle (a frozen array). Its segment test is GodotPhysics3D's
 * `GodotConcavePolygonShape3D` (`modules/godot_physics_3d/godot_shape_3d.cpp:1371`): the nearest
 * face ahead of the segment's start, a face's normal `Plane(v0, v1, v2).normal`, and a back face
 * hit only when `backface_collision` and the query's `hit_back_faces` both allow it. Godot visits
 * the faces in its BVH's order and keeps the first of two equally near faces; faces here are
 * visited in index order, so a segment through an edge two faces share reports the lower index.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_segment_intersects_triangle } from './geometry-3d';
import { construct as plane } from './plane';
import { godot_shape_3d_describe, type ShapeSegmentHit } from './shape-3d';
import { construct as vector3, dot, normalized, op_negate, op_subtract, type Vector3 } from './vector3';

const f32 = Math.fround;

export interface ConcavePolygonShape3D {
  faces: readonly Vector3[];
  backface_collision: boolean;
}

function intersectSegment(shape: ConcavePolygonShape3D, begin: Vector3, end: Vector3, hitBackFaces: boolean): ShapeSegmentHit | undefined {
  const faces = shape.faces;
  if (faces.length === 0 || faces.length % 3 !== 0) return undefined;
  const backface = shape.backface_collision && hitBackFaces;
  const dir = normalized(op_subtract(end, begin));
  const rel = op_subtract(end, begin);
  let min_d = f32(1e20);
  let best: ShapeSegmentHit | undefined;
  for (let index = 0; index < faces.length / 3; index += 1) {
    const v0 = faces[index * 3] as Vector3;
    const v1 = faces[index * 3 + 1] as Vector3;
    const v2 = faces[index * 3 + 2] as Vector3;
    // `GodotFaceShape3D::intersect_segment` (`godot_shape_3d.cpp:1240`).
    const point = godot_segment_intersects_triangle(begin, end, v0, v1, v2);
    if (point === undefined) continue;
    let normal = plane(v0, v1, v2).normal;
    if (dot(normal, rel) > 0) {
      if (!backface) continue;
      normal = op_negate(normal);
    }
    // `_cull_segment` (`godot_shape_3d.cpp:1333`).
    const d = f32(dot(dir, point) - dot(dir, begin));
    if (d > 0 && d < min_d) {
      min_d = d;
      best = { point, normal, face: index };
    }
  }
  return best;
}

/**
 * A shape without faces (no collider until it has some).
 *
 * @godot ConcavePolygonShape3D (protocol)
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:134
 */
export function construct(): ConcavePolygonShape3D {
  return godot_shape_3d_describe(
    { faces: Object.freeze([]) as readonly Vector3[], backface_collision: false },
    {
      // A face count not a multiple of three fails in `_setup` (`godot_shape_3d.cpp:1603`).
      collider: (shape) => {
        const count = shape.faces.length;
        if (count === 0 || count % 3 !== 0) return null;
        const vertices = new Float32Array(shape.faces.flatMap((p) => [p.x, p.y, p.z]));
        const indices = new Uint32Array(Array.from({ length: count }, (_, index) => index));
        return RAPIER.ColliderDesc.trimesh(vertices, indices);
      },
      intersectSegment,
      // A concave shape has no inside (`godot_shape_3d.cpp:1405`).
      intersectPoint: () => false,
    },
  );
}

/**
 * @godot ConcavePolygonShape3D.set_faces
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:100
 */
export function set_faces(self: ConcavePolygonShape3D, faces: readonly Vector3[]): void {
  self.faces = Object.freeze(faces.map((point) => vector3(point)));
}

/**
 * @godot ConcavePolygonShape3D.get_faces
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:106
 */
export function get_faces(self: ConcavePolygonShape3D): readonly Vector3[] {
  return self.faces;
}

/**
 * @godot ConcavePolygonShape3D.set_backface_collision_enabled
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:110
 */
export function set_backface_collision_enabled(self: ConcavePolygonShape3D, enabled: boolean): void {
  self.backface_collision = enabled;
}

/**
 * @godot ConcavePolygonShape3D.is_backface_collision_enabled
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:119
 */
export function is_backface_collision_enabled(self: ConcavePolygonShape3D): boolean {
  return self.backface_collision;
}
