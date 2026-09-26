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
import { godot_shape_3d_describe, type ShapeSegmentHit, type ShapeSupports } from './shape-3d';
import { godot_analytic_sphere_collision } from './sphere-shape-3d';
import { op_multiply as transform } from './transform-3d';
import { construct as vector3, dot, length, normalized, op_add, op_multiply, op_negate, op_subtract, type Vector3 } from './vector3';

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

/** `Geometry3D::get_closest_point_to_segment` (`core/math/geometry_3d.h:333`). */
function closestToSegment(point: Vector3, a: Vector3, b: Vector3): Vector3 {
  const p = op_subtract(point, a);
  const n = op_subtract(b, a);
  const l2 = dot(n, n);
  if (l2 < 1e-20) return a;
  const d = f32(dot(n, p) / l2);
  if (d <= 0) return a;
  if (d >= 1) return b;
  return op_add(a, op_multiply(n, d));
}

/** `edge_support_threshold_lower` (`godot_shape_3d.cpp:56`), a double. */
const EDGE_SUPPORT_THRESHOLD_LOWER = Math.sqrt(1 - 0.99999998 * 0.99999998);

/** `GodotCapsuleShape3D::get_supports` (`godot_shape_3d.cpp:517`). */
function supports(shape: CapsuleShape3D, direction: Vector3): ShapeSupports {
  const d = direction.y;
  const h = f32(shape.height * 0.5 - shape.radius);
  if (h > 0 && Math.abs(d) < EDGE_SUPPORT_THRESHOLD_LOWER) {
    const n = op_multiply(normalized(vector3(direction.x, 0, direction.z)), shape.radius);
    return { points: [vector3(n.x, f32(n.y + h), n.z), vector3(n.x, f32(n.y - h), n.z)], type: 1 };
  }
  const n = op_multiply(direction, shape.radius);
  return { points: [vector3(n.x, f32(n.y + (d > 0 ? h : -h)), n.z)], type: 0 };
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
      // The segment between the cap centres (`GodotCapsuleShape3D`, `godot_shape_3d.cpp:517`).
      supports,
      satKind: 'capsule',
      // `GodotCapsuleShape3D::project_range` (`godot_shape_3d.cpp:496`).
      projectRange: (shape, axis, xform) => {
        let n = normalized(vector3(dot(xform.basis.x, axis), dot(xform.basis.y, axis), dot(xform.basis.z, axis)));
        const h = f32(shape.height * 0.5 - shape.radius);
        n = op_multiply(n, shape.radius);
        n = vector3(n.x, f32(n.y + (n.y > 0 ? h : -h)), n.z);
        return [dot(axis, transform(xform, op_negate(n))), dot(axis, transform(xform, n))];
      },
      // `_collision_sphere_capsule` (`godot_collision_solver_3d_sat.cpp:880`).
      sphereContact: (shape, xform, center, radius, ma, mb) => {
        const scale = length(vector3(xform.basis.x.x, xform.basis.y.x, xform.basis.z.x));
        const axis = op_multiply(xform.basis.y, f32(shape.height * 0.5 - shape.radius));
        const closest = closestToSegment(center, op_add(xform.origin, axis), op_subtract(xform.origin, axis));
        return godot_analytic_sphere_collision(center, radius, closest, f32(shape.radius * scale), ma, mb);
      },
      // `GodotCapsuleShape3D::get_support` (`godot_shape_3d.cpp:507`).
      support: (shape, direction) => {
        const h = f32(shape.height * 0.5 - shape.radius);
        const n = op_multiply(direction, shape.radius);
        return vector3(n.x, f32(n.y + (n.y > 0 ? h : -h)), n.z);
      },
      core: (shape) => {
        const half = f32(shape.height * 0.5 - shape.radius);
        return { shape: new RAPIER.Segment({ x: 0, y: -half, z: 0 }, { x: 0, y: half, z: 0 }), radius: shape.radius };
      },
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
