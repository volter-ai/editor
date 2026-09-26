/**
 * @godot-class SphereShape3D
 * @role BINDING
 *
 * Godot 4.7's `SphereShape3D` (`scene/resources/3d/sphere_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a Rapier ball. `radius` is a C `float`.
 * Its segment and point tests are GodotPhysics3D's `GodotSphereShape3D`
 * (`modules/godot_physics_3d/godot_shape_3d.cpp:273`).
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_segment_intersects_sphere } from './geometry-3d';
import { godot_shape_3d_describe } from './shape-3d';
import type { Transform3D } from './transform-3d';
import { construct as vector3, length, op_add, op_divide, op_multiply, op_subtract, type Vector3 } from './vector3';

const f32 = Math.fround;
/** `(real_t)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

export interface SphereShape3D {
  radius: number;
}

/** `basis[0].length()`: the length of the basis's first row (`godot_collision_solver_3d_sat.cpp:832`). */
function rowLength(xform: Transform3D): number {
  return length(vector3(xform.basis.x.x, xform.basis.y.x, xform.basis.z.x));
}

/**
 * `analytic_sphere_collision<withMargin>` (`godot_collision_solver_3d_sat.cpp:774`): two spheres'
 * contact, reported from the smaller one, or undefined when they do not overlap.
 *
 * @godot SphereShape3D (protocol)
 * @source modules/godot_physics_3d/godot_collision_solver_3d_sat.cpp:774
 */
export function godot_analytic_sphere_collision(
  origin_a: Vector3,
  radius_a: number,
  origin_b: Vector3,
  radius_b: number,
  margin_a: number,
  margin_b: number,
): readonly [Vector3, Vector3, Vector3] | undefined {
  const ra = f32(radius_a + margin_a);
  const rb = f32(radius_b + margin_b);
  let b_to_a = op_subtract(origin_a, origin_b);
  const b_to_a_len = length(b_to_a);
  const overlap = f32(f32(ra + rb) - b_to_a_len);
  if (overlap < 0) return undefined;
  b_to_a = b_to_a_len < CMP_EPSILON ? vector3(0, 1, 0) : op_divide(b_to_a, b_to_a_len);
  if (ra < rb) {
    const point_a = op_subtract(origin_a, op_multiply(b_to_a, ra));
    return [point_a, op_add(point_a, op_multiply(b_to_a, overlap)), b_to_a];
  }
  const point_b = op_add(origin_b, op_multiply(b_to_a, rb));
  return [op_subtract(point_b, op_multiply(b_to_a, overlap)), point_b, b_to_a];
}

/**
 * A sphere of radius 0.5.
 *
 * @godot SphereShape3D (protocol)
 * @source scene/resources/3d/sphere_shape_3d.cpp:104
 */
export function construct(): SphereShape3D {
  return godot_shape_3d_describe(
    { radius: 0.5 },
    {
      collider: (shape) => RAPIER.ColliderDesc.ball(shape.radius),
      intersectSegment: (shape, begin, end) => {
        const hit = godot_segment_intersects_sphere(begin, end, vector3(), shape.radius);
        return hit === undefined ? undefined : { point: hit[0], normal: hit[1], face: -1 };
      },
      intersectPoint: (shape, point) => length(point) < shape.radius,
      core: (shape) => ({ shape: new RAPIER.Ball(0), radius: shape.radius }),
      // `GodotSphereShape3D::get_supports` (`godot_shape_3d.cpp:267`).
      supports: (shape, direction) => ({ points: [op_multiply(direction, shape.radius)], type: 0 }),
      // `GodotSphereShape3D::get_support` (`godot_shape_3d.cpp:263`).
      support: (shape, direction) => op_multiply(direction, shape.radius),
      // `_collision_sphere_sphere` (`godot_collision_solver_3d_sat.cpp:826`).
      sphereContact: (shape, xform, center, radius, ma, mb) =>
        godot_analytic_sphere_collision(center, radius, xform.origin, f32(shape.radius * rowLength(xform)), ma, mb),
    },
  );
}

/**
 * A negative radius fails and leaves it.
 *
 * @godot SphereShape3D.set_radius
 * @source scene/resources/3d/sphere_shape_3d.cpp:86
 */
export function set_radius(self: SphereShape3D, radius: number): void {
  if (radius < 0) return;
  self.radius = f32(radius);
}

/**
 * @godot SphereShape3D.get_radius
 * @source scene/resources/3d/sphere_shape_3d.cpp:93
 */
export function get_radius(self: SphereShape3D): number {
  return self.radius;
}
