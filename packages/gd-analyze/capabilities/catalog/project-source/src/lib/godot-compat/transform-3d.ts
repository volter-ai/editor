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
  is_equal_approx as basisIsEqualApprox,
  is_finite as basisIsFinite,
  op_divide as basisDivide,
  op_equal as basisEqual,
  op_multiply as basisMultiply,
  orthonormalized as basisOrthonormalized,
  scaled as basisScaled,
  scaled_local as basisScaledLocal,
  transposed as basisTransposed,
} from './basis';
import { construct as plane, type Plane } from './plane';
import {
  construct as vector3,
  cross,
  dot,
  is_equal_approx as vector3IsEqualApprox,
  is_finite as vector3IsFinite,
  is_zero_approx,
  normalized,
  op_add,
  op_divide as vector3Divide,
  op_multiply as vector3Multiply,
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

/** Godot's `AABB` layout (`core/math/aabb.h`): a `Vector3 position` and a `Vector3 size`. */
interface Aabb {
  readonly position: Vector3;
  readonly size: Vector3;
}

/** `Transform3D::xform(AABB)` (`core/math/transform_3d.h:209`): the box of the transformed extents. */
function xformAabb(self: Transform3D, box: Aabb): Aabb {
  const min = box.position;
  const max = op_add(box.position, box.size);
  const axes = ['x', 'y', 'z'] as const;
  const columns = [self.basis.x, self.basis.y, self.basis.z] as const;
  const tmin = [self.origin.x, self.origin.y, self.origin.z];
  const tmax = [self.origin.x, self.origin.y, self.origin.z];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const entry = columns[j as 0 | 1 | 2][axes[i as 0 | 1 | 2]];
      const e = f32(entry * min[axes[j as 0 | 1 | 2]]);
      const g = f32(entry * max[axes[j as 0 | 1 | 2]]);
      tmin[i] = f32((tmin[i] ?? 0) + (e < g ? e : g));
      tmax[i] = f32((tmax[i] ?? 0) + (e < g ? g : e));
    }
  }
  const position = vector3(tmin[0] ?? 0, tmin[1] ?? 0, tmin[2] ?? 0);
  return Object.freeze({ position, size: op_subtract(vector3(tmax[0] ?? 0, tmax[1] ?? 0, tmax[2] ?? 0), position) });
}

/**
 * `Transform3D::xform(Plane)` (`core/math/transform_3d.h:197`): a point of the plane transformed,
 * the normal through the inverse-transpose basis and normalized, `d` recomputed
 * (`xform_fast`, `core/math/transform_3d.h:284`).
 */
function xformPlane(self: Transform3D, p: Plane): Plane {
  const point = op_multiply(self, vector3Multiply(p.normal, p.d));
  const normal = normalized(basisMultiply(basisTransposed(basisInverse(self.basis)), p.normal));
  return plane(normal, dot(normal, point));
}

/**
 * `Transform3D * Vector3` is `xform`: the basis rows dotted with the vector plus the origin
 * (`core/math/transform_3d.h:177`). `Transform3D * Transform3D` is `origin = xform(p.origin)`, then
 * `basis *= p.basis` (`core/math/transform_3d.cpp:185`). `Transform3D * float` scales the basis and
 * origin (`core/math/transform_3d.h:155`); `* Plane` (`core/math/transform_3d.h:197`), `* AABB`
 * (`core/math/transform_3d.h:209`, a `{ position, size }` record) and `* PackedVector3Array` (each
 * point, `core/math/transform_3d.h:258`) transform those.
 *
 * @godot Transform3D.OP_MULTIPLY
 * @source core/math/transform_3d.cpp:190
 */
export function op_multiply(left: Transform3D, right: Vector3): Vector3;
export function op_multiply(left: Transform3D, right: Transform3D): Transform3D;
export function op_multiply(left: Transform3D, right: number): Transform3D;
export function op_multiply(left: Transform3D, right: Plane): Plane;
export function op_multiply(left: Transform3D, right: Aabb): Aabb;
export function op_multiply(left: Transform3D, right: readonly Vector3[]): Vector3[];
export function op_multiply(
  left: Transform3D,
  right: Vector3 | Transform3D | number | Plane | Aabb | readonly Vector3[],
): Vector3 | Transform3D | Plane | Aabb | Vector3[] {
  if (typeof right === 'number') return make(basisMultiply(left.basis, right), vector3Multiply(left.origin, right));
  if (Array.isArray(right)) return (right as readonly Vector3[]).map((point) => op_multiply(left, point));
  if ('basis' in right) return make(basisMultiply(left.basis, right.basis), op_multiply(left, right.origin));
  if ('normal' in right) return xformPlane(left, right);
  if ('position' in right) return xformAabb(left, right);
  return op_add(basisMultiply(left.basis, right as Vector3), left.origin);
}

/**
 * The basis transposed and the origin carried back through it (`Transform3D::invert`,
 * `core/math/transform_3d.cpp:46`): the inverse of a rotation-and-translation, which is what Godot
 * assumes here.
 *
 * @godot Transform3D.inverse
 * @source core/math/transform_3d.cpp:51
 */
export function inverse(self: Transform3D): Transform3D {
  const b = basisTransposed(self.basis);
  return make(b, basisMultiply(b, op_negate(self.origin)));
}

/**
 * Rotated about the parent axis: basis and origin both rotated. Under `MATH_CHECKS` an axis that is
 * not normalized leaves the rotation the identity.
 *
 * @godot Transform3D.rotated
 * @source core/math/transform_3d.cpp:63
 */
export function rotated(self: Transform3D, p_axis: Vector3, p_angle: number): Transform3D {
  const r = basis(p_axis, p_angle);
  return make(basisMultiply(r, self.basis), basisMultiply(r, self.origin));
}

/**
 * Rotated in its own frame: the basis post-multiplied, the origin kept.
 *
 * @godot Transform3D.rotated_local
 * @source core/math/transform_3d.cpp:69
 */
export function rotated_local(self: Transform3D, p_axis: Vector3, p_angle: number): Transform3D {
  return make(basisMultiply(self.basis, basis(p_axis, p_angle)), self.origin);
}

/**
 * The basis rows and the origin scaled component-wise (parent frame).
 *
 * @godot Transform3D.scaled
 * @source core/math/transform_3d.cpp:118
 */
export function scaled(self: Transform3D, p_scale: Vector3): Transform3D {
  return make(basisScaled(self.basis, p_scale), vector3Multiply(self.origin, p_scale));
}

/**
 * The basis columns scaled (local frame); the origin kept.
 *
 * @godot Transform3D.scaled_local
 * @source core/math/transform_3d.cpp:123
 */
export function scaled_local(self: Transform3D, p_scale: Vector3): Transform3D {
  return make(basisScaledLocal(self.basis, p_scale), self.origin);
}

/**
 * The origin moved by the offset in the parent frame.
 *
 * @godot Transform3D.translated
 * @source core/math/transform_3d.cpp:142
 */
export function translated(self: Transform3D, p_offset: Vector3): Transform3D {
  return make(self.basis, op_add(self.origin, p_offset));
}

/**
 * The origin moved by the offset through the basis.
 *
 * @godot Transform3D.translated_local
 * @source core/math/transform_3d.cpp:147
 */
export function translated_local(self: Transform3D, p_offset: Vector3): Transform3D {
  return make(self.basis, op_add(self.origin, basisMultiply(self.basis, p_offset)));
}

/**
 * @godot Transform3D.is_equal_approx
 * @source core/math/transform_3d.cpp:173
 */
export function is_equal_approx(self: Transform3D, p_xform: Transform3D): boolean {
  return basisIsEqualApprox(self.basis, p_xform.basis) && vector3IsEqualApprox(self.origin, p_xform.origin);
}

/**
 * @godot Transform3D.is_finite
 * @source core/math/transform_3d.cpp:181
 */
export function is_finite(self: Transform3D): boolean {
  return basisIsFinite(self.basis) && vector3IsFinite(self.origin);
}

/**
 * The basis and origin divided by the scalar (`core/math/transform_3d.h:166`); plain
 * `OperatorEvaluatorDiv`, so a zero divisor follows IEEE division.
 *
 * @godot Transform3D.OP_DIVIDE
 * @source core/math/transform_3d.h:171
 */
export function op_divide(left: Transform3D, right: number): Transform3D {
  return make(basisDivide(left.basis, right), vector3Divide(left.origin, right));
}

/**
 * Against null (the `Variant` right operand) it is false (`core/variant/variant_op.cpp:550`).
 *
 * @godot Transform3D.OP_EQUAL
 * @source core/math/transform_3d.h:147
 */
export function op_equal(left: Transform3D, right: Transform3D | null): boolean {
  if (right === null) return false;
  const o = left.origin;
  return basisEqual(left.basis, right.basis) && o.x === right.origin.x && o.y === right.origin.y && o.z === right.origin.z;
}

/**
 * @godot Transform3D.OP_NOT_EQUAL
 * @source core/math/transform_3d.h:151
 */
export function op_not_equal(left: Transform3D, right: Transform3D | null): boolean {
  return !op_equal(left, right);
}

/**
 * `t == Transform3D()`: identity basis, zero origin.
 *
 * @godot Transform3D.OP_NOT
 * @source core/variant/variant_op.cpp:901
 */
export function op_not(self: Transform3D): boolean {
  return op_equal(self, construct());
}

/** Whether an Array element or a Dictionary key is this Transform3D. */
function isTransform3DEqual(value: unknown, t: Transform3D): boolean {
  if (typeof value !== 'object' || value === null || !('basis' in value) || !('origin' in value)) return false;
  return op_equal(t, value as Transform3D);
}

/**
 * `t in array` is `array.find(t) != -1`; `t in dict` is `dict.has(t)`
 * (`core/variant/variant_op.h:1180`). A Transform3D key is matched by value.
 *
 * @godot Transform3D.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Transform3D, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isTransform3DEqual(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isTransform3DEqual(key, left)) return true;
  return false;
}
