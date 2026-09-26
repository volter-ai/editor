/**
 * @godot-class BoxShape3D
 * @role BINDING
 *
 * Godot 4.7's `BoxShape3D` (`scene/resources/3d/box_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a Rapier cuboid of half its size. Its segment and
 * point tests are GodotPhysics3D's `GodotBoxShape3D` (`modules/godot_physics_3d/godot_shape_3d.cpp`)
 * on the half extents the scene resource hands the server (`size / 2`).
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_shape_3d_describe, type ShapeSupports } from './shape-3d';
import { affine_inverse, op_multiply as transform } from './transform-3d';
import { construct as vector3, dot, length, normalized, op_add, op_divide, op_multiply, op_subtract, type Vector3 } from './vector3';

/** `Basis::xform_inv`: the columns dotted with the vector (`core/math/basis.h:343`). */
function basisXformInv(basis: { readonly x: Vector3; readonly y: Vector3; readonly z: Vector3 }, v: Vector3): Vector3 {
  return vector3(dot(basis.x, v), dot(basis.y, v), dot(basis.z, v));
}

const f32 = Math.fround;

export interface BoxShape3D {
  size: Vector3;
}

const KEYS = ['x', 'y', 'z'] as const;
/** How far a contact point may sit off a face and still be on it: Rapier's single-precision contacts. */
const FACE_TOLERANCE = 1e-4;

/**
 * `AABB::intersects_segment` (`core/math/aabb.cpp:184`) of the box `(-half, half * 2)`, whose end
 * `-half + half * 2` is `half`: slab clipping, the normal the entering slab's.
 */
function intersectSegment(shape: BoxShape3D, from: Vector3, to: Vector3): { point: Vector3; normal: Vector3; face: number } | undefined {
  const half = vector3(f32(shape.size.x * 0.5), f32(shape.size.y * 0.5), f32(shape.size.z * 0.5));
  let min = 0;
  let max = 1;
  let axis = 0;
  let sign = 0;
  for (let i = 0; i < 3; i += 1) {
    const key = KEYS[i] as 'x' | 'y' | 'z';
    const seg_from = from[key];
    const seg_to = to[key];
    const box_begin = -half[key];
    const box_end = f32(box_begin + f32(half[key] * 2));
    let cmin: number;
    let cmax: number;
    let csign: number;
    if (seg_from < seg_to) {
      if (seg_from > box_end || seg_to < box_begin) return undefined;
      const length = f32(seg_to - seg_from);
      cmin = seg_from < box_begin ? f32(f32(box_begin - seg_from) / length) : 0;
      cmax = seg_to > box_end ? f32(f32(box_end - seg_from) / length) : 1;
      csign = -1;
    } else {
      if (seg_to > box_end || seg_from < box_begin) return undefined;
      const length = f32(seg_to - seg_from);
      cmin = seg_from > box_end ? f32(f32(box_end - seg_from) / length) : 0;
      cmax = seg_to < box_begin ? f32(f32(box_begin - seg_from) / length) : 1;
      csign = 1;
    }
    if (cmin > min) {
      min = cmin;
      axis = i;
      sign = csign;
    }
    if (cmax < max) max = cmax;
    if (max < min) return undefined;
  }
  const rel = op_subtract(to, from);
  const normal = vector3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
  return { point: op_add(from, op_multiply(rel, min)), normal, face: -1 };
}

/** A point on one face only (within a float32 tolerance of the others' edges) gives that face's axis. */
function faceNormal(shape: BoxShape3D, point: Vector3): Vector3 | undefined {
  const on: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const key = KEYS[i] as 'x' | 'y' | 'z';
    const half = f32(shape.size[key] * 0.5);
    if (Math.abs(Math.abs(point[key]) - half) <= FACE_TOLERANCE * Math.max(1, half)) on.push(i);
  }
  if (on.length !== 1) return undefined;
  const axis = on[0] as number;
  const sign = Math.sign(point[KEYS[axis] as 'x' | 'y' | 'z']);
  return vector3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
}

/** `face_support_threshold` and `edge_support_threshold_lower` (`godot_shape_3d.cpp:55`), doubles. */
const FACE_SUPPORT_THRESHOLD = 0.9998;
const EDGE_SUPPORT_THRESHOLD_LOWER = Math.sqrt(1 - 0.99999998 * 0.99999998);
const NEXT = [1, 2, 0] as const;
const NEXT2 = [2, 0, 1] as const;
const SIGN = [
  [-1, 1],
  [1, 1],
  [1, -1],
  [-1, -1],
] as const;

function withAxes(values: readonly [number, number, number]): Vector3 {
  return vector3(values[0], values[1], values[2]);
}

/** `GodotBoxShape3D::get_supports` (`godot_shape_3d.cpp:332`). */
function supports(shape: BoxShape3D, direction: Vector3): ShapeSupports {
  const half = [f32(shape.size.x * 0.5), f32(shape.size.y * 0.5), f32(shape.size.z * 0.5)] as const;
  const n = [direction.x, direction.y, direction.z] as const;
  for (let i = 0; i < 3; i += 1) {
    const d = n[i] as number;
    if (Math.abs(d) > FACE_SUPPORT_THRESHOLD) {
      const neg = d < 0;
      const point: [number, number, number] = [0, 0, 0];
      point[i] = half[i] as number;
      const i_n = NEXT[i] as number;
      const i_n2 = NEXT2[i] as number;
      const points = SIGN.map(([a, b]) => {
        point[i_n] = a * (half[i_n] as number);
        point[i_n2] = b * (half[i_n2] as number);
        const v = withAxes(point);
        return neg ? vector3(-v.x, -v.y, -v.z) : v;
      });
      if (neg) {
        [points[1], points[2]] = [points[2] as Vector3, points[1] as Vector3];
        [points[0], points[3]] = [points[3] as Vector3, points[0] as Vector3];
      }
      return { points, type: 2 };
    }
  }
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(n[i] as number) < EDGE_SUPPORT_THRESHOLD_LOWER) {
      const i_n = NEXT[i] as number;
      const i_n2 = NEXT2[i] as number;
      const point: [number, number, number] = [half[0], half[1], half[2]];
      if ((n[i_n] as number) < 0) point[i_n] = -(point[i_n] as number);
      if ((n[i_n2] as number) < 0) point[i_n2] = -(point[i_n2] as number);
      const first = withAxes(point);
      point[i] = -(point[i] as number);
      return { points: [first, withAxes(point)], type: 1 };
    }
  }
  return {
    points: [vector3(direction.x < 0 ? -half[0] : half[0], direction.y < 0 ? -half[1] : half[1], direction.z < 0 ? -half[2] : half[2])],
    type: 0,
  };
}

/** `GodotBoxShape3D::intersect_point` (`modules/godot_physics_3d/godot_shape_3d.cpp:421`). */
function intersectPoint(shape: BoxShape3D, point: Vector3): boolean {
  return KEYS.every((key) => Math.abs(point[key]) < f32(shape.size[key] * 0.5));
}

/**
 * A box of size (1, 1, 1).
 *
 * @godot BoxShape3D (protocol)
 * @source scene/resources/3d/box_shape_3d.cpp:118
 */
export function construct(): BoxShape3D {
  return godot_shape_3d_describe(
    { size: vector3(1, 1, 1) },
    {
      collider: (shape) => RAPIER.ColliderDesc.cuboid(shape.size.x / 2, shape.size.y / 2, shape.size.z / 2),
      intersectSegment,
      intersectPoint,
      faceNormal,
      supports,
      satKind: 'box',
      // `GodotBoxShape3D::project_range` (`godot_shape_3d.cpp:312`).
      projectRange: (shape, axis, xform) => {
        const local = basisXformInv(xform.basis, axis);
        const half = vector3(f32(shape.size.x * 0.5), f32(shape.size.y * 0.5), f32(shape.size.z * 0.5));
        const len = dot(vector3(Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)), half);
        const distance = dot(axis, xform.origin);
        return [f32(distance - len), f32(distance + len)];
      },
      // `_collision_sphere_box` (`godot_collision_solver_3d_sat.cpp:842`).
      sphereContact: (shape, xform, center, radius, ma, mb) => {
        const local = transform(affine_inverse(xform), center);
        const he = vector3(f32(shape.size.x * 0.5), f32(shape.size.y * 0.5), f32(shape.size.z * 0.5));
        const clamp = (v: number, e: number): number => Math.min(Math.max(v, -e), e);
        const nearest = transform(xform, vector3(clamp(local.x, he.x), clamp(local.y, he.y), clamp(local.z, he.z)));
        const delta = op_subtract(nearest, center);
        const len = length(delta);
        if (len > f32(f32(radius + ma) + mb)) return undefined;
        const axis = len === 0 ? normalized(op_subtract(xform.origin, nearest)) : op_divide(delta, len);
        return [op_add(center, op_multiply(axis, f32(radius + ma))), op_subtract(nearest, op_multiply(axis, mb)), axis];
      },
      // `GodotBoxShape3D::get_support` (`godot_shape_3d.cpp:323`).
      support: (shape, direction) => {
        const hx = f32(shape.size.x * 0.5);
        const hy = f32(shape.size.y * 0.5);
        const hz = f32(shape.size.z * 0.5);
        return vector3(direction.x < 0 ? -hx : hx, direction.y < 0 ? -hy : hy, direction.z < 0 ? -hz : hz);
      },
    },
  );
}

/**
 * A negative component fails and leaves the size.
 *
 * @godot BoxShape3D.set_size
 * @source scene/resources/3d/box_shape_3d.cpp:100
 */
export function set_size(self: BoxShape3D, size: Vector3): void {
  if (size.x < 0 || size.y < 0 || size.z < 0) return;
  self.size = vector3(size);
}

/**
 * @godot BoxShape3D.get_size
 * @source scene/resources/3d/box_shape_3d.cpp:107
 */
export function get_size(self: BoxShape3D): Vector3 {
  return self.size;
}
