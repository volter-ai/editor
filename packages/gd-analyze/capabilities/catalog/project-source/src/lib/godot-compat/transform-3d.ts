/**
 * @godot-class Transform3D
 * @role PROTOCOL
 *
 * Godot 4.7's `Transform3D` built-in value, transcribed from `core/math/transform_3d.{h,cpp}` at
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: a `Basis` and a `Vector3 origin`.
 */

import { Matrix4, Quaternion as ThreeQuaternion, Vector3 as ThreeVector3 } from 'three';
import {
  type Basis,
  construct as basis,
  inverse as basisInverse,
  op_multiply as basisMultiply,
  orthonormalized as basisOrthonormalized,
} from './basis';
import {
  construct as vector3,
  cross,
  is_zero_approx,
  normalized,
  op_add,
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

/** A transform as three's matrix (a column per basis axis and the origin). */
function toMatrix(self: Transform3D): Matrix4 {
  const { x, y, z } = self.basis;
  const o = self.origin;
  return new Matrix4().set(x.x, y.x, z.x, o.x, x.y, y.y, z.y, o.y, x.z, y.z, z.z, o.z, 0, 0, 0, 1);
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
 * The transform `weight` of the way to `xform`: each decomposed into scale, rotation and origin
 * (three's `Matrix4.decompose`), the rotations slerped, the scales and origins lerped, composed
 * again, as Godot interpolates (`Transform3D::interpolate_with`).
 *
 * @godot Transform3D.interpolate_with
 * @source core/math/transform_3d.cpp:96
 */
export function interpolate_with(self: Transform3D, xform: Transform3D, weight: number): Transform3D {
  const [fromPosition, fromRotation, fromScale] = [new ThreeVector3(), new ThreeQuaternion(), new ThreeVector3()];
  const [toPosition, toRotation, toScale] = [new ThreeVector3(), new ThreeQuaternion(), new ThreeVector3()];
  toMatrix(self).decompose(fromPosition, fromRotation, fromScale);
  toMatrix(xform).decompose(toPosition, toRotation, toScale);
  const e = new Matrix4().compose(
    fromPosition.lerp(toPosition, weight),
    fromRotation.slerp(toRotation, weight).normalize(),
    fromScale.lerp(toScale, weight),
  ).elements;
  const axis = (at: number): Vector3 => vector3(f32(e[at] as number), f32(e[at + 1] as number), f32(e[at + 2] as number));
  return construct(axis(0), axis(4), axis(8), axis(12));
}

/**
 * The basis orthonormalized (`Basis::orthonormalize`), the origin kept.
 *
 * @godot Transform3D.orthonormalized
 * @source core/math/transform_3d.cpp:157
 */
export function orthonormalized(self: Transform3D): Transform3D {
  return make(basisOrthonormalized(self.basis), self.origin);
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

/**
 * `Transform3D::affine_invert` on a copy (`core/math/transform_3d.cpp:35`): the basis inverted,
 * then the origin is `basis.xform(-origin)`.
 *
 * @godot Transform3D.affine_inverse
 * @source core/math/transform_3d.cpp:40
 */
export function affine_inverse(self: Transform3D): Transform3D {
  const inverted = basisInverse(self.basis);
  return make(inverted, basisMultiply(inverted, op_negate(self.origin)));
}

/**
 * `Transform3D * Vector3` is `xform`: the basis rows dotted with the vector plus the origin
 * (`core/math/transform_3d.h:177`). `Transform3D * Transform3D` is `origin = xform(p.origin)`, then
 * `basis *= p.basis` (`core/math/transform_3d.cpp:185`).
 *
 * @godot Transform3D.OP_MULTIPLY
 * @source core/math/transform_3d.cpp:190
 */
export function op_multiply(left: Transform3D, right: Vector3): Vector3;
export function op_multiply(left: Transform3D, right: Transform3D): Transform3D;
export function op_multiply(left: Transform3D, right: Vector3 | Transform3D): Vector3 | Transform3D {
  if ('basis' in right) return make(basisMultiply(left.basis, right.basis), op_multiply(left, right.origin));
  return op_add(basisMultiply(left.basis, right), left.origin);
}
