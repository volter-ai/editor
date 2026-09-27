/**
 * @godot-class Geometry3D
 * @role PROTOCOL
 *
 * Godot 4.7's `Geometry3D` singleton (`core/core_bind.cpp`) over the segment tests of
 * `core/math/geometry_3d.h`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. `real_t` is
 * 32-bit and every intermediate is rounded with `Math.fround` where the C++ rounds it; the
 * official build compiles with `-ffp-contract=off`, so no multiply-add is fused. The physics
 * shapes' ray tests are these same functions, so the shape modules call them.
 */

import {
  construct as vector3,
  cross,
  distance_to,
  dot,
  length,
  normalized,
  op_add,
  op_divide,
  op_multiply,
  op_subtract,
  type Vector3,
} from './vector3';

const f32 = Math.fround;
/** `(real_t)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

type Axis = 0 | 1 | 2;
const KEYS = ['x', 'y', 'z'] as const;

function component(v: Vector3, axis: Axis): number {
  return v[KEYS[axis]];
}

function withComponent(v: Vector3, axis: Axis, value: number): Vector3 {
  return vector3(axis === 0 ? value : v.x, axis === 1 ? value : v.y, axis === 2 ? value : v.z);
}

function unit(axis: Axis): Vector3 {
  return withComponent(vector3(), axis, 1);
}

/**
 * `::Geometry3D::segment_intersects_sphere`: the entry point and the outward normal there, or
 * `undefined` when the segment misses or starts inside past its far end.
 *
 * @godot Geometry3D (protocol)
 * @source core/math/geometry_3d.h:125
 */
export function godot_segment_intersects_sphere(
  p_from: Vector3,
  p_to: Vector3,
  p_sphere_pos: Vector3,
  p_sphere_radius: number,
): readonly [Vector3, Vector3] | undefined {
  const radius = f32(p_sphere_radius);
  const sphere_pos = op_subtract(p_sphere_pos, p_from);
  const rel = op_subtract(p_to, p_from);
  const rel_l = length(rel);
  if (rel_l < CMP_EPSILON) return undefined;
  const normal = op_divide(rel, rel_l);
  const sphere_d = dot(normal, sphere_pos);
  const ray_distance = distance_to(sphere_pos, op_multiply(normal, sphere_d));
  if (ray_distance >= radius) return undefined;
  const inters_d2 = f32(f32(radius * radius) - f32(ray_distance * ray_distance));
  let inters_d = sphere_d;
  if (inters_d2 >= CMP_EPSILON) inters_d = f32(inters_d - f32(Math.sqrt(inters_d2)));
  if (inters_d < 0 || inters_d > rel_l) return undefined;
  const result = op_add(p_from, op_multiply(normal, inters_d));
  return [result, normalized(op_subtract(result, p_sphere_pos))];
}

/**
 * `::Geometry3D::segment_intersects_cylinder` about the given axis (the physics capsule uses Y,
 * the bound method Z): the entry point and the normal there, or `undefined`.
 *
 * @godot Geometry3D (protocol)
 * @source core/math/geometry_3d.h:166
 */
export function godot_segment_intersects_cylinder(
  p_from: Vector3,
  p_to: Vector3,
  p_height: number,
  p_radius: number,
  p_cylinder_axis: Axis,
): readonly [Vector3, Vector3] | undefined {
  const height = f32(p_height);
  const radius = f32(p_radius);
  const rel = op_subtract(p_to, p_from);
  const rel_l = length(rel);
  if (rel_l < CMP_EPSILON) return undefined;
  const cylinder_axis = unit(p_cylinder_axis);
  const normal = op_divide(rel, rel_l);
  const crs = cross(normal, cylinder_axis);
  const crs_l = length(crs);
  const axis_dir = crs_l < CMP_EPSILON ? unit(((p_cylinder_axis + 1) % 3) as Axis) : op_divide(crs, crs_l);
  const dist = dot(axis_dir, p_from);
  if (dist >= radius) return undefined;
  const w2 = f32(f32(radius * radius) - f32(dist * dist));
  if (w2 < CMP_EPSILON) return undefined;
  const size = [f32(Math.sqrt(w2)), f32(height * f32(0.5))] as const;
  const side_dir = normalized(cross(axis_dir, cylinder_axis));
  const from2D = [dot(side_dir, p_from), component(p_from, p_cylinder_axis)] as const;
  const to2D = [dot(side_dir, p_to), component(p_to, p_cylinder_axis)] as const;
  let min = 0;
  let max = 1;
  let axis = -1;
  for (let i = 0; i < 2; i += 1) {
    const seg_from = from2D[i] as number;
    const seg_to = to2D[i] as number;
    const box_begin = -(size[i] as number);
    const box_end = size[i] as number;
    let cmin: number;
    let cmax: number;
    if (seg_from < seg_to) {
      if (seg_from > box_end || seg_to < box_begin) return undefined;
      const len = f32(seg_to - seg_from);
      cmin = seg_from < box_begin ? f32(f32(box_begin - seg_from) / len) : 0;
      cmax = seg_to > box_end ? f32(f32(box_end - seg_from) / len) : 1;
    } else {
      if (seg_to > box_end || seg_from < box_begin) return undefined;
      const len = f32(seg_to - seg_from);
      cmin = seg_from > box_end ? f32(f32(box_end - seg_from) / len) : 0;
      cmax = seg_to < box_begin ? f32(f32(box_begin - seg_from) / len) : 1;
    }
    if (cmin > min) {
      min = cmin;
      axis = i;
    }
    if (cmax < max) max = cmax;
    if (max < min) return undefined;
  }
  const result = op_add(p_from, op_multiply(rel, min));
  let res_normal = result;
  if (axis === 0) {
    res_normal = withComponent(res_normal, p_cylinder_axis, 0);
  } else {
    let axis_side = ((p_cylinder_axis + 1) % 3) as Axis;
    res_normal = withComponent(res_normal, axis_side, 0);
    axis_side = ((axis_side + 1) % 3) as Axis;
    res_normal = withComponent(res_normal, axis_side, 0);
  }
  return [result, normalized(res_normal)];
}

/**
 * `::Geometry3D::segment_intersects_triangle` (Möller–Trumbore): the point, or `undefined` for a
 * parallel segment, a miss, or `t` outside `(CMP_EPSILON, 1]`.
 *
 * @godot Geometry3D (protocol)
 * @source core/math/geometry_3d.h:84
 */
export function godot_segment_intersects_triangle(
  p_from: Vector3,
  p_to: Vector3,
  p_v0: Vector3,
  p_v1: Vector3,
  p_v2: Vector3,
): Vector3 | undefined {
  const rel = op_subtract(p_to, p_from);
  const e1 = op_subtract(p_v1, p_v0);
  const e2 = op_subtract(p_v2, p_v0);
  const h = cross(rel, e2);
  const a = dot(e1, h);
  if (Math.abs(a) < CMP_EPSILON) return undefined;
  const f = f32(1 / a);
  const s = op_subtract(p_from, p_v0);
  const u = f32(f * dot(s, h));
  if (u < 0 || u > 1) return undefined;
  const q = cross(s, e1);
  const v = f32(f * dot(rel, q));
  if (v < 0 || f32(u + v) > 1) return undefined;
  const t = f32(f * dot(e2, q));
  if (t > CMP_EPSILON && t <= 1) return op_add(p_from, op_multiply(rel, t));
  return undefined;
}

/**
 * The entry point and normal as a two-element PackedVector3Array, empty on a miss.
 *
 * @godot Geometry3D.segment_intersects_sphere
 * @source core/core_bind.cpp:1236
 */
export function segment_intersects_sphere(from: Vector3, to: Vector3, sphere_position: Vector3, sphere_radius: number): readonly Vector3[] {
  return Object.freeze([...(godot_segment_intersects_sphere(from, to, sphere_position, sphere_radius) ?? [])]);
}

/**
 * A cylinder along Z centred on the origin; the entry point and normal, empty on a miss.
 *
 * @godot Geometry3D.segment_intersects_cylinder
 * @source core/core_bind.cpp:1249
 */
export function segment_intersects_cylinder(from: Vector3, to: Vector3, height: number, radius: number): readonly Vector3[] {
  return Object.freeze([...(godot_segment_intersects_cylinder(from, to, height, radius, 2) ?? [])]);
}

/**
 * The point, or `null` on a miss.
 *
 * @godot Geometry3D.segment_intersects_triangle
 * @source core/core_bind.cpp:1227
 */
export function segment_intersects_triangle(from: Vector3, to: Vector3, a: Vector3, b: Vector3, c: Vector3): Vector3 | null {
  return godot_segment_intersects_triangle(from, to, a, b, c) ?? null;
}
