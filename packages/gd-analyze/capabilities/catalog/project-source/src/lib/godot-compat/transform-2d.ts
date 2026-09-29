/**
 * @godot-class Transform2D
 * @role PROTOCOL
 *
 * Godot 4.7's `Transform2D` built-in value, transcribed from `core/math/transform_2d.{h,cpp}` at
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Godot stores `columns[3]`: `x`, `y` and
 * `origin`, which are the record's fields. `real_t` is 32-bit.
 */

import { construct as rect2, expand as rect2Expand, type Rect2 } from './rect2';
import {
  angle as vector2Angle,
  dot as vector2Dot,
  is_equal_approx as vector2IsEqualApprox,
  is_finite as vector2IsFinite,
  lerp as vector2Lerp,
  construct as vector2,
  length,
  normalized as vector2Normalized,
  op_multiply as vector2Multiply,
  type Vector2,
} from './vector2';

const f32 = Math.fround;

export interface Transform2D {
  readonly x: Vector2;
  readonly y: Vector2;
  readonly origin: Vector2;
}

function make(x: Vector2, y: Vector2, origin: Vector2): Transform2D {
  return Object.freeze({ x: vector2(x), y: vector2(y), origin: vector2(origin) });
}

/** `SIGN` (`core/typedefs.h:137`): 1, -1, or 0 (also for NaN). */
function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:126-130`): no arguments (the
 * identity, `core/math/transform_2d.h:58`), `from: Transform2D`, `rotation, position`
 * (`core/math/transform_2d.cpp:97`), `rotation, scale, skew, position`
 * (`core/math/transform_2d.cpp:107`), and `x_axis, y_axis, origin`.
 *
 * @godot Transform2D.Transform2D
 * @source core/math/transform_2d.h:145
 */
export function construct(
  ...args:
    | readonly []
    | readonly [Transform2D]
    | readonly [number, Vector2]
    | readonly [number, Vector2, number, Vector2]
    | readonly [Vector2, Vector2, Vector2]
): Transform2D {
  if (args.length === 0) return make(vector2(1, 0), vector2(0, 1), vector2(0, 0));
  if (args.length === 1) return make(args[0].x, args[0].y, args[0].origin);
  if (args.length === 2) {
    const rot = f32(args[0]);
    const cr = f32(Math.cos(rot));
    const sr = f32(Math.sin(rot));
    return make(vector2(cr, sr), vector2(-sr, cr), args[1]);
  }
  if (args.length === 4) {
    const rot = f32(args[0]);
    const scale = args[1];
    const skew = f32(args[2]);
    const turned = f32(rot + skew);
    return make(
      vector2(f32(f32(Math.cos(rot)) * scale.x), f32(f32(Math.sin(rot)) * scale.x)),
      vector2(f32(-f32(Math.sin(turned)) * scale.y), f32(f32(Math.cos(turned)) * scale.y)),
      args[3],
    );
  }
  return make(args[0], args[1], args[2]);
}

/**
 * `Size2(columns[0].length(), SIGN(determinant()) * columns[1].length())`, the determinant being
 * `x.x * y.y - x.y * y.x` (`core/math/transform_2d.cpp:259`).
 *
 * @godot Transform2D.get_scale
 * @source core/math/transform_2d.cpp:115
 */
export function get_scale(self: Transform2D): Vector2 {
  const determinant = f32(f32(self.x.x * self.y.y) - f32(self.x.y * self.y.x));
  return vector2(length(self.x), f32(sign(determinant) * length(self.y)));
}

/**
 * `t.x = value` writes `columns[0]` (`core/math/transform_2d.h:58`); a new record assigned back.
 *
 * @godot Transform2D.x
 * @source core/math/transform_2d.h:58
 */
export function with_x(self: Transform2D, value: Vector2): Transform2D {
  return make(value, self.y, self.origin);
}

/**
 * @godot Transform2D.y
 * @source core/math/transform_2d.h:58
 */
export function with_y(self: Transform2D, value: Vector2): Transform2D {
  return make(self.x, value, self.origin);
}

/**
 * @godot Transform2D.origin
 * @source core/math/transform_2d.h:58
 */
export function with_origin(self: Transform2D, value: Vector2): Transform2D {
  return make(self.x, self.y, value);
}

/** `tdotx`, `tdoty` (`core/math/transform_2d.h:64`): a row of the basis dotted with a vector. */
function tdotx(self: Transform2D, v: Vector2): number {
  return f32(f32(self.x.x * v.x) + f32(self.y.x * v.y));
}

function tdoty(self: Transform2D, v: Vector2): number {
  return f32(f32(self.x.y * v.x) + f32(self.y.y * v.y));
}

/**
 * @godot Transform2D.get_origin
 * @source core/math/transform_2d.h:94
 */
export function get_origin(self: Transform2D): Vector2 {
  return self.origin;
}

/**
 * @godot Transform2D.basis_xform
 * @source core/math/transform_2d.h:202
 */
export function basis_xform(self: Transform2D, v: Vector2): Vector2 {
  return vector2(tdotx(self, v), tdoty(self, v));
}

/**
 * `affine_invert` (`core/math/transform_2d.cpp:48`): `idet = 1 / determinant()`, the diagonal
 * swapped, the columns scaled by `(idet, -idet)` and `(-idet, idet)`, then the origin is the new
 * basis applied to the negated origin. A zero determinant fails `MATH_CHECKS` (the official build
 * has them) and leaves the copy as it was.
 *
 * @godot Transform2D.affine_inverse
 * @source core/math/transform_2d.cpp:62
 */
export function affine_inverse(self: Transform2D): Transform2D {
  const det = f32(f32(self.x.x * self.y.y) - f32(self.x.y * self.y.x));
  if (det === 0) return self;
  const idet = f32(1 / det);
  const x = vector2(f32(self.y.y * idet), f32(self.x.y * -idet));
  const y = vector2(f32(self.y.x * -idet), f32(self.x.x * idet));
  const basis = make(x, y, vector2(0, 0));
  return make(x, y, basis_xform(basis, vector2(-self.origin.x, -self.origin.y)));
}

/**
 * `Transform2D * Vector2` is `xform` (`core/math/transform_2d.h:214`); `Transform2D * Transform2D`
 * is `origin = xform(p.origin)`, then each basis column through `tdotx`, `tdoty`
 * (`core/math/transform_2d.cpp:199`). `Transform2D * float` scales every column
 * (`core/math/transform_2d.h:184`); `Transform2D * Rect2` is the rect enclosing the transformed
 * corners (`core/math/transform_2d.h:229`); `Transform2D * PackedVector2Array` transforms each point
 * (`core/math/transform_2d.h:273`).
 *
 * @godot Transform2D.OP_MULTIPLY
 * @source core/math/transform_2d.cpp:215
 */
export function op_multiply(left: Transform2D, right: Vector2): Vector2;
export function op_multiply(left: Transform2D, right: Transform2D): Transform2D;
export function op_multiply(left: Transform2D, right: number): Transform2D;
export function op_multiply(left: Transform2D, right: Rect2): Rect2;
export function op_multiply(left: Transform2D, right: readonly Vector2[]): Vector2[];
export function op_multiply(
  left: Transform2D,
  right: Vector2 | Transform2D | number | Rect2 | readonly Vector2[],
): Vector2 | Transform2D | Rect2 | Vector2[] {
  if (typeof right === 'number') {
    return make(vector2Multiply(left.x, right), vector2Multiply(left.y, right), vector2Multiply(left.origin, right));
  }
  if (Array.isArray(right)) return (right as readonly Vector2[]).map((point) => xform(left, point));
  if ('origin' in right) {
    return make(basis_xform(left, right.x), basis_xform(left, right.y), xform(left, right.origin));
  }
  if ('position' in right) {
    const x = vector2Multiply(left.x, right.size.x);
    const y = vector2Multiply(left.y, right.size.y);
    const pos = xform(left, right.position);
    const add = (a: Vector2, b: Vector2): Vector2 => vector2(f32(a.x + b.x), f32(a.y + b.y));
    let rect = rect2(pos, vector2());
    rect = rect2Expand(rect, add(pos, x));
    rect = rect2Expand(rect, add(pos, y));
    return rect2Expand(rect, add(add(pos, x), y));
  }
  return xform(left, right as Vector2);
}

/** `xform` (`core/math/transform_2d.h:214`): the basis applied, then the origin added. */
function xform(self: Transform2D, v: Vector2): Vector2 {
  const b = basis_xform(self, v);
  return vector2(f32(b.x + self.origin.x), f32(b.y + self.origin.y));
}

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function isEqualApproxReal(left: number, right: number): boolean {
  if (left === right) return true;
  const epsilon = f32(0.00001);
  let tolerance = f32(epsilon * Math.abs(left));
  if (tolerance < epsilon) tolerance = epsilon;
  return Math.abs(f32(left - right)) < tolerance;
}

/** `Math::angle_difference(float, float)` (`core/math/math_funcs.h:485`). */
function angleDifference(from: number, to: number): number {
  const tau = f32(Math.PI * 2);
  const difference = f32(f32(to - from) % tau);
  return f32(f32(f32(2 * difference) % tau) - difference);
}

/** `Math::lerp_angle(float, float, float)` (`core/math/math_funcs.h:493`). */
function lerpAngle(from: number, to: number, weight: number): number {
  return f32(from + f32(angleDifference(from, to) * weight));
}

/**
 * `Transform2D(angle, Vector2())` (`core/math/transform_2d.cpp:97`).
 */
function rotation(angle: number): Transform2D {
  return construct(f32(angle), vector2());
}

/**
 * The basis transposed and the origin carried back through it (`Transform2D::invert`,
 * `core/math/transform_2d.cpp:35`); correct only for a rotation basis, as Godot's is.
 *
 * @godot Transform2D.inverse
 * @source core/math/transform_2d.cpp:42
 */
export function inverse(self: Transform2D): Transform2D {
  const x = vector2(self.x.x, self.y.x);
  const y = vector2(self.x.y, self.y.y);
  const swapped = make(x, y, vector2());
  return make(x, y, basis_xform(swapped, vector2(-self.origin.x, -self.origin.y)));
}

/**
 * `atan2(x.y, x.x)`.
 *
 * @godot Transform2D.get_rotation
 * @source core/math/transform_2d.cpp:82
 */
export function get_rotation(self: Transform2D): number {
  return vector2Angle(self.x);
}

/**
 * `acos(x.normalized() . (sign(det) * y.normalized())) - PI / 2`.
 *
 * @godot Transform2D.get_skew
 * @source core/math/transform_2d.cpp:72
 */
export function get_skew(self: Transform2D): number {
  const det = determinant(self);
  const d = vector2Dot(vector2Normalized(self.x), vector2Multiply(vector2Normalized(self.y), sign(det)));
  return f32(f32(Math.acos(d)) - f32(f32(Math.PI) * 0.5));
}

/**
 * Gram-Schmidt on the two basis columns; the origin kept.
 *
 * @godot Transform2D.orthonormalized
 * @source core/math/transform_2d.cpp:162
 */
export function orthonormalized(self: Transform2D): Transform2D {
  const x = vector2Normalized(self.x);
  const along = vector2Multiply(x, vector2Dot(x, self.y));
  const y = vector2Normalized(vector2(f32(self.y.x - along.x), f32(self.y.y - along.y)));
  return make(x, y, self.origin);
}

/**
 * `Transform2D(angle, Vector2()) * this`: rotated about the parent origin.
 *
 * @godot Transform2D.rotated
 * @source core/math/transform_2d.cpp:249
 */
export function rotated(self: Transform2D, p_angle: number): Transform2D {
  return op_multiply(rotation(p_angle), self);
}

/**
 * `this * Transform2D(angle, Vector2())`: rotated in its own frame.
 *
 * @godot Transform2D.rotated_local
 * @source core/math/transform_2d.cpp:254
 */
export function rotated_local(self: Transform2D, p_angle: number): Transform2D {
  return op_multiply(self, rotation(p_angle));
}

/**
 * `scale`: each basis ROW scaled (`scale_basis`, `core/math/transform_2d.cpp:132`) and the origin
 * scaled component-wise.
 *
 * @godot Transform2D.scaled
 * @source core/math/transform_2d.cpp:221
 */
export function scaled(self: Transform2D, p_scale: Vector2): Transform2D {
  return make(
    vector2(f32(self.x.x * p_scale.x), f32(self.x.y * p_scale.y)),
    vector2(f32(self.y.x * p_scale.x), f32(self.y.y * p_scale.y)),
    vector2Multiply(self.origin, p_scale),
  );
}

/**
 * Each basis column scaled; the origin kept.
 *
 * @godot Transform2D.scaled_local
 * @source core/math/transform_2d.cpp:228
 */
export function scaled_local(self: Transform2D, p_scale: Vector2): Transform2D {
  return make(vector2Multiply(self.x, p_scale.x), vector2Multiply(self.y, p_scale.y), self.origin);
}

/**
 * The origin moved by the offset in the parent frame.
 *
 * @godot Transform2D.translated
 * @source core/math/transform_2d.cpp:239
 */
export function translated(self: Transform2D, p_offset: Vector2): Transform2D {
  return make(self.x, self.y, vector2(f32(self.origin.x + p_offset.x), f32(self.origin.y + p_offset.y)));
}

/**
 * The origin moved by the offset through the basis.
 *
 * @godot Transform2D.translated_local
 * @source core/math/transform_2d.cpp:244
 */
export function translated_local(self: Transform2D, p_offset: Vector2): Transform2D {
  const b = basis_xform(self, p_offset);
  return make(self.x, self.y, vector2(f32(self.origin.x + b.x), f32(self.origin.y + b.y)));
}

/**
 * `x.x * y.y - x.y * y.x`.
 *
 * @godot Transform2D.determinant
 * @source core/math/transform_2d.cpp:259
 */
export function determinant(self: Transform2D): number {
  return f32(f32(self.x.x * self.y.y) - f32(self.x.y * self.y.x));
}

/**
 * Each basis column dotted with the vector: the transposed basis applied.
 *
 * @godot Transform2D.basis_xform_inv
 * @source core/math/transform_2d.h:208
 */
export function basis_xform_inv(self: Transform2D, v: Vector2): Vector2 {
  return vector2(vector2Dot(self.x, v), vector2Dot(self.y, v));
}

/**
 * Rotation and skew by `lerp_angle`, scale and origin by `lerp`, recomposed with the
 * rotation-scale-skew-position constructor.
 *
 * @godot Transform2D.interpolate_with
 * @source core/math/transform_2d.cpp:263
 */
export function interpolate_with(self: Transform2D, p_transform: Transform2D, p_weight: number): Transform2D {
  const weight = f32(p_weight);
  return construct(
    lerpAngle(get_rotation(self), get_rotation(p_transform), weight),
    vector2Lerp(get_scale(self), get_scale(p_transform), weight),
    lerpAngle(get_skew(self), get_skew(p_transform), weight),
    vector2Lerp(self.origin, p_transform.origin, weight),
  );
}

/**
 * A rotation and uniform scale, flipped or not: `x.x ~ y.y` and `x.y ~ -y.x`, or the flipped pair.
 *
 * @godot Transform2D.is_conformal
 * @source core/math/transform_2d.cpp:168
 */
export function is_conformal(self: Transform2D): boolean {
  if (isEqualApproxReal(self.x.x, self.y.y) && isEqualApproxReal(self.x.y, -self.y.x)) return true;
  return isEqualApproxReal(self.x.x, -self.y.y) && isEqualApproxReal(self.x.y, self.y.x);
}

/**
 * @godot Transform2D.is_equal_approx
 * @source core/math/transform_2d.cpp:180
 */
export function is_equal_approx(self: Transform2D, p_transform: Transform2D): boolean {
  return (
    vector2IsEqualApprox(self.x, p_transform.x) &&
    vector2IsEqualApprox(self.y, p_transform.y) &&
    vector2IsEqualApprox(self.origin, p_transform.origin)
  );
}

/**
 * @godot Transform2D.is_finite
 * @source core/math/transform_2d.cpp:188
 */
export function is_finite(self: Transform2D): boolean {
  return vector2IsFinite(self.x) && vector2IsFinite(self.y) && vector2IsFinite(self.origin);
}

/**
 * The rotation and origin kept, turned to face `target` (`set_rotation` keeps the scale,
 * `core/math/transform_2d.cpp:86`). The Variant default for `target` is `Vector2()`.
 *
 * @godot Transform2D.looking_at
 * @source core/math/transform_2d.cpp:192
 */
export function looking_at(self: Transform2D, p_target: Vector2 = vector2()): Transform2D {
  const base = construct(get_rotation(self), self.origin);
  const target = xform(affine_inverse(self), p_target);
  const rot = f32(get_rotation(base) + vector2Angle(vector2Multiply(target, get_scale(self))));
  const scale = get_scale(base);
  const cr = f32(Math.cos(rot));
  const sr = f32(Math.sin(rot));
  return make(
    vector2Multiply(vector2Normalized(vector2(cr, sr)), scale.x),
    vector2Multiply(vector2Normalized(vector2(-sr, cr)), scale.y),
    base.origin,
  );
}

/**
 * Every column divided by the scalar (`core/math/transform_2d.h:190`); plain
 * `OperatorEvaluatorDiv`, so a zero divisor follows IEEE division.
 *
 * @godot Transform2D.OP_DIVIDE
 * @source core/math/transform_2d.h:196
 */
export function op_divide(left: Transform2D, right: number): Transform2D {
  const s = f32(right);
  const div = (v: Vector2): Vector2 => vector2(f32(v.x / s), f32(v.y / s));
  return make(div(left.x), div(left.y), div(left.origin));
}

/**
 * Against null (the `Variant` right operand) it is false (`core/variant/variant_op.cpp:545`).
 *
 * @godot Transform2D.OP_EQUAL
 * @source core/math/transform_2d.h:158
 */
export function op_equal(left: Transform2D, right: Transform2D | null): boolean {
  if (right === null) return false;
  const same = (a: Vector2, b: Vector2): boolean => a.x === b.x && a.y === b.y;
  return same(left.x, right.x) && same(left.y, right.y) && same(left.origin, right.origin);
}

/**
 * @godot Transform2D.OP_NOT_EQUAL
 * @source core/math/transform_2d.h:168
 */
export function op_not_equal(left: Transform2D, right: Transform2D | null): boolean {
  return !op_equal(left, right);
}

/**
 * `t == Transform2D()`, the identity.
 *
 * @godot Transform2D.OP_NOT
 * @source core/variant/variant_op.cpp:894
 */
export function op_not(self: Transform2D): boolean {
  return op_equal(self, construct());
}

/** Whether an Array element or a Dictionary key is this Transform2D. */
function isTransform2DEqual(value: unknown, t: Transform2D): boolean {
  if (typeof value !== 'object' || value === null || !('origin' in value) || !('x' in value) || !('y' in value)) return false;
  const other = value as Transform2D;
  return typeof other.x === 'object' && op_equal(t, other);
}

/**
 * `t in array` is `array.find(t) != -1`; `t in dict` is `dict.has(t)`
 * (`core/variant/variant_op.h:1180`). A Transform2D key is matched by value.
 *
 * @godot Transform2D.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Transform2D, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isTransform2DEqual(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isTransform2DEqual(key, left)) return true;
  return false;
}
