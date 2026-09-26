/**
 * @godot-class Transform3D
 * @role PROTOCOL
 *
 * Godot 4.7's `Transform3D` built-in value, transcribed from `core/math/transform_3d.{h,cpp}` at
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: a `Basis` and a `Vector3 origin`.
 */

import { type Basis, construct as basis } from './basis';
import {
  construct as vector3,
  cross,
  is_zero_approx,
  normalized,
  op_negate,
  op_subtract,
  UP,
  type Vector3,
} from './vector3';

const f32 = Math.fround;
/** `(float)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

export interface Transform3D {
  readonly basis: Basis;
  readonly origin: Vector3;
}

function make(b: Basis, origin: Vector3): Transform3D {
  return Object.freeze({ basis: basis(b), origin: vector3(origin) });
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:157-160`): no arguments (identity
 * basis, zero origin), `from: Transform3D`, `basis, origin`, and `x_axis, y_axis, z_axis, origin`
 * (`core/math/transform_3d.h:135`). `from: Projection` is not transcribed.
 *
 * @godot Transform3D.Transform3D
 * @source core/math/transform_3d.h:132
 */
export function construct(
  ...args:
    | readonly []
    | readonly [Transform3D]
    | readonly [Basis, Vector3]
    | readonly [Vector3, Vector3, Vector3, Vector3]
): Transform3D {
  if (args.length === 0) return make(basis(), vector3());
  if (args.length === 1) return make(args[0].basis, args[0].origin);
  if (args.length === 2) return make(args[0], args[1]);
  return make(basis(args[0], args[1], args[2]), args[3]);
}

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function isEqualApprox(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(CMP_EPSILON * Math.abs(left));
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(f32(left - right)) < tolerance;
}

/**
 * `Vector3::get_any_perpendicular` (`core/math/vector3.h:375`): a zero vector fails with (0, 0, 0);
 * otherwise the cross with RIGHT when |x| is the smallest component, else with UP, normalized.
 */
function anyPerpendicular(v: Vector3): Vector3 {
  if (is_zero_approx(v)) return vector3(0, 0, 0);
  const useRight = Math.abs(v.x) <= Math.abs(v.y) && Math.abs(v.x) <= Math.abs(v.z);
  return normalized(cross(v, useRight ? vector3(1, 0, 0) : UP));
}

/**
 * `Basis::looking_at` (`core/math/basis.cpp:1034`); under `MATH_CHECKS` a zero target or up
 * returns the identity.
 */
function lookingAtBasis(p_target: Vector3, p_up: Vector3, p_use_model_front: boolean): Basis {
  if (is_zero_approx(p_target) || is_zero_approx(p_up)) return basis();
  let v_z = normalized(p_target);
  if (!p_use_model_front) v_z = op_negate(v_z);
  let v_x = cross(p_up, v_z);
  if (is_zero_approx(v_x)) v_x = anyPerpendicular(p_up);
  v_x = normalized(v_x);
  const v_y = cross(v_z, v_x);
  return basis(v_x, v_y, v_z);
}

/**
 * Under `MATH_CHECKS` an origin approximately equal to the target returns `Transform3D()`;
 * otherwise the basis looks at `target - origin` and the origin stays. The Variant defaults are
 * `up = Vector3.UP`, `use_model_front = false` (`core/variant/variant_call.cpp:2597`).
 *
 * @godot Transform3D.looking_at
 * @source core/math/transform_3d.cpp:79
 */
export function looking_at(
  self: Transform3D,
  p_target: Vector3,
  p_up: Vector3 = UP,
  p_use_model_front = false,
): Transform3D {
  const o = self.origin;
  if (isEqualApprox(o.x, p_target.x) && isEqualApprox(o.y, p_target.y) && isEqualApprox(o.z, p_target.z)) {
    return construct();
  }
  return make(lookingAtBasis(op_subtract(p_target, o), p_up, p_use_model_front), o);
}

/**
 * `t.basis = value` writes `Basis basis` (`core/math/transform_3d.h:43`); a new record assigned back.
 *
 * @godot Transform3D.basis
 * @source core/math/transform_3d.h:43
 */
export function with_basis(self: Transform3D, value: Basis): Transform3D {
  return make(value, self.origin);
}

/**
 * @godot Transform3D.origin
 * @source core/math/transform_3d.h:44
 */
export function with_origin(self: Transform3D, value: Vector3): Transform3D {
  return make(self.basis, value);
}
