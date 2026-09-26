/**
 * @godot-class CapsuleShape3D
 * @role BINDING
 *
 * Godot 4.7's `CapsuleShape3D` (`scene/resources/3d/capsule_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a Rapier capsule along Y. Godot's `height` is the
 * whole capsule, caps included; Rapier's half height is the cylinder's, `height / 2 - radius`.
 * `radius` and `height` are C `float`s; each setter keeps `height >= 2 * radius`. Its segment and
 * point tests are GodotPhysics3D's `GodotCapsuleShape3D` (`modules/godot_physics_3d/godot_shape_3d.cpp`):
 * the nearest of the Y cylinder and the two cap spheres.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_segment_intersects_cylinder, godot_segment_intersects_sphere } from './geometry-3d';
import { godot_shape_3d_describe, type ShapeSegmentHit } from './shape-3d';
import { construct as vector3, dot, length, normalized, op_subtract, type Vector3 } from './vector3';

const f32 = Math.fround;

export interface CapsuleShape3D {
  radius: number;
  height: number;
}

/** `GodotCapsuleShape3D::intersect_segment` (`modules/godot_physics_3d/godot_shape_3d.cpp:544`). */
function intersectSegment(shape: CapsuleShape3D, begin: Vector3, end: Vector3): ShapeSegmentHit | undefined {
  const { radius, height } = shape;
  const norm = normalized(op_subtract(end, begin));
  let min_d = f32(1e20);
  let best: readonly [Vector3, Vector3] | undefined;
  // `height * 0.5` and `radius * 2.0` promote to double; each result is rounded where a `real_t`
  // or a Vector3 component receives it.
  for (const hit of [
    godot_segment_intersects_cylinder(begin, end, f32(height - radius * 2), radius, 1),
    godot_segment_intersects_sphere(begin, end, vector3(0, height * 0.5 - radius, 0), radius),
    godot_segment_intersects_sphere(begin, end, vector3(0, height * -0.5 + radius, 0), radius),
  ]) {
    if (hit === undefined) continue;
    const d = dot(norm, hit[0]);
    if (d < min_d) {
      min_d = d;
      best = hit;
    }
  }
  return best === undefined ? undefined : { point: best[0], normal: best[1], face: -1 };
}

/** `GodotCapsuleShape3D::intersect_point` (`modules/godot_physics_3d/godot_shape_3d.cpp:600`). */
function intersectPoint(shape: CapsuleShape3D, point: Vector3): boolean {
  const { radius, height } = shape;
  // The comparison and the new `p.y` are double expressions; `p.y` is rounded as it is stored.
  if (Math.abs(point.y) < height * 0.5 - radius) return length(vector3(point.x, 0, point.z)) < radius;
  return length(vector3(point.x, Math.abs(point.y) - height * 0.5 + radius, point.z)) < radius;
}

/**
 * A capsule of radius 0.5 and height 2.
 *
 * @godot CapsuleShape3D (protocol)
 * @source scene/resources/3d/capsule_shape_3d.cpp:156
 */
export function construct(): CapsuleShape3D {
  return godot_shape_3d_describe(
    { radius: 0.5, height: 2 },
    {
      collider: (shape) => RAPIER.ColliderDesc.capsule(shape.height / 2 - shape.radius, shape.radius),
      intersectSegment,
      intersectPoint,
    },
  );
}

/**
 * A negative radius fails; a radius over half the height raises the height to twice it.
 *
 * @godot CapsuleShape3D.set_radius
 * @source scene/resources/3d/capsule_shape_3d.cpp:102
 */
export function set_radius(self: CapsuleShape3D, radius: number): void {
  if (radius < 0) return;
  self.radius = f32(radius);
  if (self.height < f32(self.radius * 2)) self.height = f32(self.radius * 2);
}

/**
 * @godot CapsuleShape3D.get_radius
 * @source scene/resources/3d/capsule_shape_3d.cpp:112
 */
export function get_radius(self: CapsuleShape3D): number {
  return self.radius;
}

/**
 * A negative height fails; a height under twice the radius lowers the radius to half of it.
 *
 * @godot CapsuleShape3D.set_height
 * @source scene/resources/3d/capsule_shape_3d.cpp:116
 */
export function set_height(self: CapsuleShape3D, height: number): void {
  if (height < 0) return;
  self.height = f32(height);
  if (self.radius > f32(self.height * 0.5)) self.radius = f32(self.height * 0.5);
}

/**
 * @godot CapsuleShape3D.get_height
 * @source scene/resources/3d/capsule_shape_3d.cpp:126
 */
export function get_height(self: CapsuleShape3D): number {
  return self.height;
}
