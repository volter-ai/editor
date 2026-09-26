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
import { godot_shape_3d_describe } from './shape-3d';
import { construct as vector3, op_add, op_multiply, op_subtract, type Vector3 } from './vector3';

const f32 = Math.fround;

export interface BoxShape3D {
  size: Vector3;
}

const KEYS = ['x', 'y', 'z'] as const;

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
