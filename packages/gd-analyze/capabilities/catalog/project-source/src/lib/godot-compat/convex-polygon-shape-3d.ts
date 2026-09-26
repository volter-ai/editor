/**
 * @godot-class ConvexPolygonShape3D
 * @role BINDING
 *
 * Godot 4.7's `ConvexPolygonShape3D` (`scene/resources/3d/convex_polygon_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the Rapier convex hull of its points. `points` is
 * a PackedVector3Array: a frozen array.
 *
 * GodotPhysics3D collides against the hull `ConvexHullComputer` builds (`core/math/convex_hull.cpp`),
 * which first snaps every point to a lattice of 10216 steps across the points' bounds
 * (`ConvexHullInternal::compute`, `core/math/convex_hull.cpp:1578`) and returns the hull's vertices
 * back from that lattice (`get_coordinates`, `:1667`); its faces are the hull's planar polygons, each
 * with the plane of its first three vertices (`:2333`). That snapping is transcribed exactly, and
 * the hull of the lattice points is found here in exact integer arithmetic with coplanar triangles
 * merged into polygons, so the segment and point tests (`GodotConvexPolygonShape3D`,
 * `modules/godot_physics_3d/godot_shape_3d.cpp:964`) run on Godot's vertices and faces. Bounded
 * deviation: which vertex of a face Godot lists first is its construction's order, not transcribed;
 * a face here starts at its lowest-numbered point, so a plane or a fan triangle can differ from
 * Godot's by float32 rounding. The Rapier collider (contacts) is the hull of the unsnapped points.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_segment_intersects_triangle } from './geometry-3d';
import { construct as plane, type Plane } from './plane';
import { godot_shape_3d_describe, type ShapeSegmentHit } from './shape-3d';
import { construct as vector3, dot, op_add, op_multiply, op_subtract, type Vector3 } from './vector3';

const f32 = Math.fround;

export interface ConvexPolygonShape3D {
  points: readonly Vector3[];
}

interface HullFace {
  readonly plane: Plane;
  /** The polygon's vertices in Godot's winding (`Plane` of the first three faces outward). */
  readonly vertices: readonly Vector3[];
}

function hull(shape: ConvexPolygonShape3D): RAPIER.ColliderDesc | null {
  return shape.points.length === 0
    ? null
    : RAPIER.ColliderDesc.convexHull(new Float32Array(shape.points.flatMap((p) => [p.x, p.y, p.z])));
}

const FACES = new WeakMap<ConvexPolygonShape3D, { readonly points: readonly Vector3[]; readonly faces: readonly HullFace[] }>();

/** `Plane::distance_to` (`core/math/plane.h:110`). */
function distanceTo(p: Plane, point: Vector3): number {
  return f32(dot(p.normal, point) - p.d);
}

type Axis = 0 | 1 | 2;
type Int3 = readonly [number, number, number];

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

const subI = (a: Int3, b: Int3): Int3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossI = (a: Int3, b: Int3): Int3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotI = (a: Int3, b: Int3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The hull of the lattice points as planar polygons of point indices, by incremental construction
 * with exact integer predicates (the lattice spans at most 10216 steps, so every product is exact
 * in a double). Fewer than four points off one plane have no faces.
 */
function hullPolygons(p: readonly Int3[]): number[][] {
  const orient = (t: readonly [number, number, number], q: Int3): number =>
    dotI(crossI(subI(p[t[1]]!, p[t[0]]!), subI(p[t[2]]!, p[t[0]]!)), subI(q, p[t[0]]!));
  const i0 = 0;
  const i1 = p.findIndex((v) => v.some((c, k) => c !== p[i0]![k]));
  if (i1 < 0) return [];
  const i2 = p.findIndex((v) => crossI(subI(p[i1]!, p[i0]!), subI(v, p[i0]!)).some((c) => c !== 0));
  if (i2 < 0) return [];
  const i3 = p.findIndex((v) => orient([i0, i1, i2], v) !== 0);
  if (i3 < 0) return [];
  let faces: [number, number, number][] = [
    [i0, i1, i2],
    [i0, i3, i1],
    [i1, i3, i2],
    [i2, i3, i0],
  ];
  if (orient([i0, i1, i2], p[i3]!) > 0) faces = faces.map(([a, b, c]) => [a, c, b]);
  p.forEach((point, index) => {
    if (index === i0 || index === i1 || index === i2 || index === i3) return;
    const visible = faces.filter((face) => orient(face, point) > 0);
    if (visible.length === 0) return;
    const edges = new Map<string, [number, number]>();
    for (const [a, b, c] of visible) {
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const reverse = `${String(v)},${String(u)}`;
        if (edges.has(reverse)) edges.delete(reverse);
        else edges.set(`${String(u)},${String(v)}`, [u, v]);
      }
    }
    faces = faces.filter((face) => !visible.includes(face));
    for (const [u, v] of edges.values()) faces.push([u, v, index]);
  });
  // Merge coplanar triangles: each polygon is the boundary loop of its triangles' edges.
  const groups = new Map<string, [number, number, number][]>();
  for (const face of faces) {
    const n = crossI(subI(p[face[1]]!, p[face[0]]!), subI(p[face[2]]!, p[face[0]]!));
    const g = gcd(gcd(Math.abs(n[0]), Math.abs(n[1])), Math.abs(n[2])) || 1;
    const unit: Int3 = [n[0] / g, n[1] / g, n[2] / g];
    const key = `${unit.join(',')},${String(dotI(unit, p[face[0]]!))}`;
    groups.set(key, [...(groups.get(key) ?? []), face]);
  }
  return [...groups.values()].map((group) => {
    const directed = group.flatMap(([a, b, c]) => [
      [a, b],
      [b, c],
      [c, a],
    ]);
    const has = new Set(directed.map(([u, v]) => `${String(u)},${String(v)}`));
    const next = new Map<number, number>();
    for (const [u, v] of directed) if (!has.has(`${String(v)},${String(u)}`)) next.set(u as number, v as number);
    const start = Math.min(...next.keys());
    const loop = [start];
    for (let at = next.get(start)!; at !== start && loop.length <= next.size; at = next.get(at)!) loop.push(at);
    return loop;
  });
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** The hull's faces: snapped vertices, winding with an outward `Plane` of the first three. */
function facesOf(shape: ConvexPolygonShape3D): readonly HullFace[] {
  const cached = FACES.get(shape);
  if (cached?.points === shape.points) return cached.faces;
  const faces: HullFace[] = [];
  if (shape.points.length > 0) {
    const { lattice, vertices } = snap(shape.points);
    const polygons = hullPolygons(lattice);
    const used = [...new Set(polygons.flat())];
    let [cx, cy, cz] = [0, 0, 0];
    for (const index of used) {
      cx += vertices[index]!.x;
      cy += vertices[index]!.y;
      cz += vertices[index]!.z;
    }
    const inside = vector3(cx / used.length, cy / used.length, cz / used.length);
    for (const polygon of polygons) {
      let loop = polygon.map((index) => vertices[index]!);
      let face = plane(loop[0]!, loop[1]!, loop[2]!);
      if (distanceTo(face, inside) > 0) {
        loop = [loop[0]!, ...loop.slice(1).reverse()];
        face = plane(loop[0]!, loop[1]!, loop[2]!);
      }
      faces.push({ plane: face, vertices: loop });
    }
  }
  FACES.set(shape, { points: shape.points, faces });
  return faces;
}

/** `GodotConvexPolygonShape3D::intersect_segment` (`godot_shape_3d.cpp:964`). */
function intersectSegment(shape: ConvexPolygonShape3D, begin: Vector3, end: Vector3): ShapeSegmentHit | undefined {
  const n = op_subtract(end, begin);
  let min = f32(1e20);
  let best: ShapeSegmentHit | undefined;
  for (const face of facesOf(shape)) {
    if (dot(face.plane.normal, n) > 0) continue;
    const v = face.vertices;
    for (let j = 1; j < v.length - 1; j += 1) {
      const point = godot_segment_intersects_triangle(begin, end, v[0]!, v[j]!, v[j + 1]!);
      if (point === undefined) continue;
      const d = dot(n, point);
      if (d < min) {
        min = d;
        best = { point, normal: face.plane.normal, face: -1 };
      }
      break;
    }
  }
  return best;
}

/** `GodotConvexPolygonShape3D::intersect_point` (`godot_shape_3d.cpp:1002`). */
function intersectPoint(shape: ConvexPolygonShape3D, point: Vector3): boolean {
  const faces = facesOf(shape);
  return faces.length > 0 && faces.every((face) => distanceTo(face.plane, point) < 0);
}

/**
 * A shape without points (no collider until it has some).
 *
 * @godot ConvexPolygonShape3D (protocol)
 * @source scene/resources/3d/convex_polygon_shape_3d.cpp:129
 */
export function construct(): ConvexPolygonShape3D {
  return godot_shape_3d_describe({ points: Object.freeze([]) as readonly Vector3[] }, { collider: hull, intersectSegment, intersectPoint });
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
