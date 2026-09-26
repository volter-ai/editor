/**
 * @godot-class ConvexPolygonShape3D
 * @role BINDING
 *
 * Godot 4.7's `ConvexPolygonShape3D` (`scene/resources/3d/convex_polygon_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the Rapier convex hull of its points. `points` is a
 * PackedVector3Array: a frozen array.
 *
 * GodotPhysics3D collides against the hull `ConvexHullComputer` builds (`core/math/convex_hull.cpp`),
 * which first snaps every point to a lattice of 10216 steps across the points' bounds
 * (`ConvexHullInternal::compute`, `:1578`) and returns the hull's vertices from that lattice
 * (`get_coordinates`, `:1667`). That data preparation is transcribed: Rapier's hull is built from
 * the snapped points.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_shape_3d_describe } from './shape-3d';
import { construct as vector3, op_add, op_multiply, op_subtract, type Vector3 } from './vector3';

const f32 = Math.fround;

type Axis = 0 | 1 | 2;
type Int3 = readonly [number, number, number];

export interface ConvexPolygonShape3D {
  points: readonly Vector3[];
}

/** `Vector3::max_axis_index` / `min_axis_index` (`core/math/vector3.h:85`). */
function maxAxis(v: Vector3): Axis {
  return v.x < v.y ? (v.y < v.z ? 2 : 1) : v.x < v.z ? 2 : 0;
}
function minAxis(v: Vector3): Axis {
  return v.x < v.y ? (v.x < v.z ? 0 : 2) : v.y < v.z ? 1 : 2;
}

/**
 * `ConvexHullInternal::compute`'s lattice (`core/math/convex_hull.cpp:1578`): each point's integer
 * coordinates, indexed by world axis, and the vertex `get_coordinates` returns for it.
 */
function snap(points: readonly Vector3[]): { lattice: Int3[]; vertices: Vector3[] } {
  let position = points[0] as Vector3;
  let size = vector3();
  for (const p of points.slice(1)) {
    // `AABB::expand_to` (`core/math/aabb.h:356`): `end = position + size`, both widened, then
    // `size = end - begin`.
    const end = op_add(position, size);
    position = vector3(p.x < position.x ? p.x : position.x, p.y < position.y ? p.y : position.y, p.z < position.z ? p.z : position.z);
    size = op_subtract(vector3(p.x > end.x ? p.x : end.x, p.y > end.y ? p.y : end.y, p.z > end.z ? p.z : end.z), position);
  }
  const max_axis = maxAxis(size);
  let min_axis = minAxis(size);
  if (min_axis === max_axis) min_axis = ((max_axis + 1) % 3) as Axis;
  const med_axis = (3 - max_axis - min_axis) as Axis;
  let s = vector3(f32(size.x / 10216), f32(size.y / 10216), f32(size.z / 10216));
  if ((med_axis + 1) % 3 !== max_axis) s = op_multiply(s, -1);
  const scaling = s;
  const inverse = vector3(s.x === 0 ? 0 : f32(1 / s.x), s.y === 0 ? 0 : f32(1 / s.y), s.z === 0 ? 0 : f32(1 / s.z));
  const center = position;
  const lattice = points.map((p): Int3 => {
    const q = op_multiply(op_subtract(p, center), inverse);
    return [Math.trunc(q.x), Math.trunc(q.y), Math.trunc(q.z)];
  });
  // `get_coordinates`: `p * scaling + center` from the lattice point (`:1667`).
  const vertices = lattice.map((l) => op_add(op_multiply(vector3(l[0], l[1], l[2]), scaling), center));
  return { lattice, vertices };
}

/**
 * A shape without points (no collider until it has some).
 *
 * @godot ConvexPolygonShape3D (protocol)
 * @source scene/resources/3d/convex_polygon_shape_3d.cpp:129
 */
export function construct(): ConvexPolygonShape3D {
  return godot_shape_3d_describe(
    { points: Object.freeze([]) as readonly Vector3[] },
    {
      collider: (shape) =>
        shape.points.length === 0
          ? null
          : RAPIER.ColliderDesc.convexHull(new Float32Array(snap(shape.points).vertices.flatMap((p) => [p.x, p.y, p.z]))),
    },
  );
}

/**
 * @godot ConvexPolygonShape3D.set_points
 * @source scene/resources/3d/convex_polygon_shape_3d.cpp:112
 */
export function set_points(self: ConvexPolygonShape3D, points: readonly Vector3[]): void {
  self.points = Object.freeze(points.map((point) => vector3(point)));
}

/**
 * @godot ConvexPolygonShape3D.get_points
 * @source scene/resources/3d/convex_polygon_shape_3d.cpp:118
 */
export function get_points(self: ConvexPolygonShape3D): readonly Vector3[] {
  return self.points;
}
