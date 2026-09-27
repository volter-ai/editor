/**
 * @godot-class Plane
 * @role PROTOCOL
 *
 * Godot 4.7's `Plane` built-in value, transcribed from `core/math/plane.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: a `Vector3 normal` and a `real_t d` (32-bit).
 */

import {
  construct as vector3,
  cross,
  dot,
  normalized,
  op_add,
  op_multiply,
  op_subtract,
  type Vector3,
} from './vector3';

const f32 = Math.fround;
/** `(float)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

export interface Plane {
  readonly normal: Vector3;
  readonly d: number;
}

function make(normal: Vector3, d: number): Plane {
  return Object.freeze({ normal: vector3(normal), d: f32(d) });
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:132-138`): no arguments, `from`,
 * `normal` and `normal, d` (`core/math/plane.h:120`), `normal, point` (`d = normal.dot(point)`,
 * `core/math/plane.h:125`), three points (clockwise, `core/math/plane.h:130`) and `a, b, c, d`
 * (`core/math/plane.h:93`).
 *
 * @godot Plane.Plane
 * @source core/math/plane.h:120
 */
export function construct(
  ...args:
    | readonly []
    | readonly [Plane]
    | readonly [Vector3]
    | readonly [Vector3, number]
    | readonly [Vector3, Vector3]
    | readonly [Vector3, Vector3, Vector3]
    | readonly [number, number, number, number]
): Plane {
  if (args.length === 0) return make(vector3(), 0);
  if (args.length === 1) {
    const only = args[0];
    return 'normal' in only ? make(only.normal, only.d) : make(only, 0);
  }
  if (args.length === 2) {
    const [normal, second] = args;
    return typeof second === 'number' ? make(normal, second) : make(normal, dot(normal, second));
  }
  if (args.length === 3) {
    const [p1, p2, p3] = args;
    const normal = normalized(cross(op_subtract(p1, p3), op_subtract(p1, p2)));
    return make(normal, dot(normal, p1));
  }
  return make(vector3(args[0], args[1], args[2]), args[3]);
}

/**
 * `Plane::intersects_ray` (`core/math/plane.cpp:103`) through the Variant binding, which returns
 * the intersection or `null` (`core/math/plane.cpp:153`).
 *
 * @godot Plane.intersects_ray
 * @source core/math/plane.cpp:103
 */
export function intersects_ray(self: Plane, p_from: Vector3, p_dir: Vector3): Vector3 | null {
  const den = dot(self.normal, p_dir);
  if (Math.abs(den) < CMP_EPSILON) return null;
  let dist = f32(f32(dot(self.normal, p_from) - self.d) / den);
  if (dist > CMP_EPSILON) return null;
  dist = -dist;
  return op_add(p_from, op_multiply(p_dir, dist));
}

/**
 * `p.normal = value` writes `Vector3 normal` (`core/math/plane.h:42`); a new record assigned back.
 *
 * @godot Plane.normal
 * @source core/math/plane.h:42
 */
export function with_normal(self: Plane, value: Vector3): Plane {
  return make(value, self.d);
}

/**
 * @godot Plane.d
 * @source core/math/plane.h:43
 */
export function with_d(self: Plane, value: number): Plane {
  return make(self.normal, value);
}
