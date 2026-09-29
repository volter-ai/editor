/**
 * @godot-class Vector3
 * @role PROTOCOL
 *
 * Godot 4.7's `Vector3` built-in value, transcribed from `core/math/vector3.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. The pinned build stores `real_t` as a 32-bit float,
 * so every component and every `real_t` intermediate is rounded with `Math.fround` exactly where
 * the C++ rounds it. The official macOS build compiles with `-ffp-contract=off`
 * (`platform/macos/detect.py:118`), so no multiply-add is fused. It is an editor build, so
 * `DEBUG_ENABLED` defines `MATH_CHECKS` (`core/math/math_defs.h:56`) and `UNIT_EPSILON` is 0.001.
 */

import type { Basis } from './basis';
import type { Quaternion } from './quaternion';
import type { Transform3D } from './transform-3d';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

/** `(float)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);
/** `(real_t)UNIT_EPSILON` without `PRECISE_MATH_CHECKS` (`core/math/math_defs.h:65`). */
const UNIT_EPSILON = f32(0.001);

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** `Vector3(real_t, real_t, real_t)`: each argument is converted to `real_t`. */
function make(x: number, y: number, z: number): Vector3 {
  return Object.freeze({ x: f32(x), y: f32(y), z: f32(z) });
}

/**
 * The Variant constructors: no arguments, `from: Vector3`, `from: Vector3i` (whose conversion is
 * `Vector3(x, y, z)`, `core/math/vector3i.cpp:76`), and `x, y, z: float`.
 *
 * @godot Vector3.Vector3
 * @source core/math/vector3.h:224
 */
export function construct(...args: readonly [] | readonly [Vector3] | readonly [number, number, number]): Vector3 {
  if (args.length === 0) return make(0, 0, 0);
  if (args.length === 1) return make(args[0].x, args[0].y, args[0].z);
  return make(args[0], args[1], args[2]);
}

/**
 * @godot Vector3.ZERO
 * @source core/variant/variant_call.cpp:3095
 */
export const ZERO: Vector3 = make(0, 0, 0);

/**
 * @godot Vector3.ONE
 * @source core/variant/variant_call.cpp:3096
 */
export const ONE: Vector3 = make(1, 1, 1);

/**
 * @godot Vector3.UP
 * @source core/math/vector3.h:232
 */
export const UP: Vector3 = make(0, 1, 0);

/**
 * @godot Vector3.cross
 * @source core/math/vector3.h:243
 */
export function cross(self: Vector3, p_with: Vector3): Vector3 {
  return make(
    f32(f32(self.y * p_with.z) - f32(self.z * p_with.y)),
    f32(f32(self.z * p_with.x) - f32(self.x * p_with.z)),
    f32(f32(self.x * p_with.y) - f32(self.y * p_with.x)),
  );
}

/**
 * @godot Vector3.dot
 * @source core/math/vector3.h:252
 */
export function dot(self: Vector3, p_with: Vector3): number {
  return f32(f32(f32(self.x * p_with.x) + f32(self.y * p_with.y)) + f32(self.z * p_with.z));
}

/**
 * @godot Vector3.length
 * @source core/math/vector3.h:532
 */
export function length(self: Vector3): number {
  const x2 = f32(self.x * self.x);
  const y2 = f32(self.y * self.y);
  const z2 = f32(self.z * self.z);
  return f32(Math.sqrt(f32(f32(x2 + y2) + z2)));
}

/**
 * @godot Vector3.length_squared
 * @source core/math/vector3.h:540
 */
export function length_squared(self: Vector3): number {
  const x2 = f32(self.x * self.x);
  const y2 = f32(self.y * self.y);
  const z2 = f32(self.z * self.z);
  return f32(f32(x2 + y2) + z2);
}

/**
 * `normalize()` on a copy (`core/math/vector3.h:548`): a non-finite vector or a zero length
 * becomes `(0, 0, 0)`; otherwise each component is divided by the `real_t` length.
 *
 * @godot Vector3.normalized
 * @source core/math/vector3.h:568
 */
export function normalized(self: Vector3): Vector3 {
  if (!(Number.isFinite(self.x) && Number.isFinite(self.y) && Number.isFinite(self.z))) {
    return make(0, 0, 0);
  }
  let l = length_squared(self);
  if (l === 0) return make(0, 0, 0);
  l = f32(Math.sqrt(l));
  return make(f32(self.x / l), f32(self.y / l), f32(self.z / l));
}

/**
 * `Math::is_zero_approx(float)` on each component (`core/math/math_funcs.h:556`).
 *
 * @godot Vector3.is_zero_approx
 * @source core/math/vector3.cpp:149
 */
export function is_zero_approx(self: Vector3): boolean {
  return Math.abs(self.x) < CMP_EPSILON && Math.abs(self.y) < CMP_EPSILON && Math.abs(self.z) < CMP_EPSILON;
}

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function isEqualApproxReal(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(CMP_EPSILON * Math.abs(left));
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(f32(left - right)) < tolerance;
}

/**
 * @godot Vector3.is_equal_approx
 * @source core/math/vector3.cpp:141
 */
export function is_equal_approx(self: Vector3, p_v: Vector3): boolean {
  return isEqualApproxReal(self.x, p_v.x) && isEqualApproxReal(self.y, p_v.y) && isEqualApproxReal(self.z, p_v.z);
}

/**
 * `Math::is_equal_approx(length_squared(), 1, UNIT_EPSILON)` (`core/math/math_funcs.h:519`).
 *
 * @godot Vector3.is_normalized
 * @source core/math/vector3.h:574
 */
export function is_normalized(self: Vector3): boolean {
  const l = length_squared(self);
  return l === 1 || Math.abs(f32(l - 1)) < UNIT_EPSILON;
}

/**
 * `*this - p_normal * dot(p_normal)`; under `MATH_CHECKS` a normal that is not normalized fails
 * with (0, 0, 0).
 *
 * @godot Vector3.slide
 * @source core/math/vector3.h:588
 */
export function slide(self: Vector3, p_normal: Vector3): Vector3 {
  if (!is_normalized(p_normal)) return make(0, 0, 0);
  const d = dot(self, p_normal);
  return make(f32(self.x - f32(p_normal.x * d)), f32(self.y - f32(p_normal.y * d)), f32(self.z - f32(p_normal.z * d)));
}

/** `Math::lerp(float, float, float)` (`core/math/math_funcs.h:338`). */
function lerpReal(from: number, to: number, weight: number): number {
  return f32(from + f32(f32(to - from) * weight));
}

/**
 * @godot Vector3.lerp
 * @source core/math/vector3.h:276
 */
export function lerp(self: Vector3, p_to: Vector3, p_weight: number): Vector3 {
  const weight = f32(p_weight);
  return make(
    lerpReal(self.x, p_to.x, weight),
    lerpReal(self.y, p_to.y, weight),
    lerpReal(self.z, p_to.z, weight),
  );
}

/**
 * `v /= l; v *= p_len` only when `l > 0 && p_len < l`; the Variant default for `length` is 1.0.
 *
 * @godot Vector3.limit_length
 * @source core/math/vector3.cpp:72
 */
export function limit_length(self: Vector3, p_len = 1.0): Vector3 {
  const len = f32(p_len);
  const l = length(self);
  if (l > 0 && len < l) {
    const x = f32(self.x / l);
    const y = f32(self.y / l);
    const z = f32(self.z / l);
    return make(f32(x * len), f32(y * len), f32(z * len));
  }
  return self;
}

/**
 * `*this = Basis(p_axis, p_angle).xform(*this)` (`core/math/vector3.cpp:38`). The basis is
 * `Basis::set_axis_angle` (`core/math/basis.cpp:841`); under `MATH_CHECKS` an axis that fails
 * `is_normalized()` (`core/math/vector3.h:574`) makes it return before writing, leaving the
 * identity rows (`core/math/basis.h:41`). `Basis::xform` is a dot per row (`core/math/basis.h:336`).
 *
 * @godot Vector3.rotated
 * @source core/math/vector3.cpp:42
 */
export function rotated(self: Vector3, p_axis: Vector3, p_angle: number): Vector3 {
  const angle = f32(p_angle);
  let rows: readonly [Vector3, Vector3, Vector3] = [make(1, 0, 0), make(0, 1, 0), make(0, 0, 1)];
  const axisLengthSquared = length_squared(p_axis);
  const normalizedAxis =
    axisLengthSquared === 1 || Math.abs(f32(axisLengthSquared - 1)) < UNIT_EPSILON;
  if (normalizedAxis) {
    const sqX = f32(p_axis.x * p_axis.x);
    const sqY = f32(p_axis.y * p_axis.y);
    const sqZ = f32(p_axis.z * p_axis.z);
    const cosine = f32(Math.cos(angle));
    const r00 = f32(sqX + f32(cosine * f32(1 - sqX)));
    const r11 = f32(sqY + f32(cosine * f32(1 - sqY)));
    const r22 = f32(sqZ + f32(cosine * f32(1 - sqZ)));
    const sine = f32(Math.sin(angle));
    const t = f32(1 - cosine);
    let xyzt = f32(f32(p_axis.x * p_axis.y) * t);
    let zyxs = f32(p_axis.z * sine);
    const r01 = f32(xyzt - zyxs);
    const r10 = f32(xyzt + zyxs);
    xyzt = f32(f32(p_axis.x * p_axis.z) * t);
    zyxs = f32(p_axis.y * sine);
    const r02 = f32(xyzt + zyxs);
    const r20 = f32(xyzt - zyxs);
    xyzt = f32(f32(p_axis.y * p_axis.z) * t);
    zyxs = f32(p_axis.x * sine);
    const r12 = f32(xyzt - zyxs);
    const r21 = f32(xyzt + zyxs);
    rows = [make(r00, r01, r02), make(r10, r11, r12), make(r20, r21, r22)];
  }
  return make(dot(rows[0], self), dot(rows[1], self), dot(rows[2], self));
}

/**
 * @godot Vector3.distance_to
 * @source core/math/vector3.h:338
 */
export function distance_to(self: Vector3, p_to: Vector3): number {
  return length(op_subtract(p_to, self));
}

/**
 * @godot Vector3.OP_ADD
 * @source core/math/vector3.h:394
 */
export function op_add(left: Vector3, right: Vector3): Vector3 {
  return make(f32(left.x + right.x), f32(left.y + right.y), f32(left.z + right.z));
}

/**
 * @godot Vector3.OP_SUBTRACT
 * @source core/math/vector3.h:405
 */
export function op_subtract(left: Vector3, right: Vector3): Vector3 {
  return make(f32(left.x - right.x), f32(left.y - right.y), f32(left.z - right.z));
}

/** `Basis::xform_inv`: each column dotted with the vector (`core/math/basis.h:343`). */
function basisXformInv(b: Basis, v: Vector3): Vector3 {
  return make(dot(b.x, v), dot(b.y, v), dot(b.z, v));
}

/**
 * `Vector3 * Vector3` (`core/math/vector3.h:416`) and `Vector3 * real_t` (`core/math/vector3.h:457`);
 * a Variant `float` or `int` right operand converts to `real_t` first (`core/variant/variant_op.cpp:283`).
 * The transforming right operands are their `xform_inv` (`OperatorEvaluatorXFormInv`,
 * `core/variant/variant_op.cpp:320`, `:337`, `:345`): `Vector3 * Basis` is `Basis::xform_inv`
 * (`core/math/basis.h:343`), `Vector3 * Transform3D` the same after subtracting the origin
 * (`core/math/transform_3d.h:184`), and `Vector3 * Quaternion` is `inverse().xform(v)`
 * (`core/math/quaternion.h:101`), where a quaternion that is not normalized inverts to the identity
 * under `MATH_CHECKS` and so leaves the vector as it is.
 *
 * @godot Vector3.OP_MULTIPLY
 * @source core/math/vector3.h:416
 */
export function op_multiply(left: Vector3, right: Vector3 | number | Basis | Transform3D | Quaternion): Vector3 {
  if (typeof right === 'object' && 'basis' in right) return basisXformInv(right.basis, op_subtract(left, right.origin));
  if (typeof right === 'object' && 'w' in right) {
    const l2 = f32(f32(f32(f32(right.x * right.x) + f32(right.y * right.y)) + f32(right.z * right.z)) + f32(right.w * right.w));
    if (!(l2 === 1 || Math.abs(f32(l2 - 1)) < UNIT_EPSILON)) return left;
    const u = make(-right.x, -right.y, -right.z);
    const uv = cross(u, left);
    return op_add(left, op_multiply(op_add(op_multiply(uv, right.w), cross(u, uv)), 2));
  }
  if (typeof right === 'object' && typeof right.x === 'object') return basisXformInv(right as Basis, left);
  if (typeof right === 'number') {
    const scalar = f32(right);
    return make(f32(left.x * scalar), f32(left.y * scalar), f32(left.z * scalar));
  }
  const r = right as Vector3;
  return make(f32(left.x * r.x), f32(left.y * r.y), f32(left.z * r.z));
}

/**
 * `Vector3 / Vector3` (`core/math/vector3.h:427`) and `Vector3 / real_t` (`core/math/vector3.h:468`);
 * Godot registers these as plain `OperatorEvaluatorDiv`, so a zero divisor follows IEEE division
 * (`core/variant/variant_op.cpp:366`).
 *
 * @godot Vector3.OP_DIVIDE
 * @source core/math/vector3.h:427
 */
export function op_divide(left: Vector3, right: Vector3 | number): Vector3 {
  if (typeof right === 'number') {
    const scalar = f32(right);
    return make(f32(left.x / scalar), f32(left.y / scalar), f32(left.z / scalar));
  }
  return make(f32(left.x / right.x), f32(left.y / right.y), f32(left.z / right.z));
}

/**
 * @godot Vector3.OP_NEGATE
 * @source core/math/vector3.h:472
 */
export function op_negate(self: Vector3): Vector3 {
  return make(-self.x, -self.y, -self.z);
}

/**
 * Against null (the `Variant` right operand) it is false (`core/variant/variant_op.cpp:541`).
 *
 * @godot Vector3.OP_EQUAL
 * @source core/math/vector3.h:476
 */
export function op_equal(left: Vector3, right: Vector3 | null): boolean {
  return right !== null && left.x === right.x && left.y === right.y && left.z === right.z;
}

/**
 * `v.x = value` writes `real_t x` (`core/math/vector3.h:66`); Godot copies the value, so the
 * write is a new record assigned back.
 *
 * @godot Vector3.x
 * @source core/math/vector3.h:66
 */
export function with_x(self: Vector3, value: number): Vector3 {
  return make(value, self.y, self.z);
}

/**
 * @godot Vector3.y
 * @source core/math/vector3.h:67
 */
export function with_y(self: Vector3, value: number): Vector3 {
  return make(self.x, value, self.z);
}

/**
 * @godot Vector3.z
 * @source core/math/vector3.h:68
 */
export function with_z(self: Vector3, value: number): Vector3 {
  return make(self.x, self.y, value);
}

/** `SIGN` (`core/typedefs.h:137`). */
function signReal(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/** `CLAMP` (`core/typedefs.h:152`). */
function clampReal(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** `std::round` on a float: halves round away from zero. */
function roundReal(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** `Math::fposmod(float, float)` (`core/math/math_funcs.h:286`). */
function fposmod(x: number, y: number): number {
  let value = f32(x % y);
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value = f32(value + y);
  return value + 0;
}

/** `Math::snapped(double, double)` (`core/math/math_funcs.cpp:121`), narrowed to `real_t`. */
function snappedReal(value: number, step: number): number {
  if (step !== 0) return f32(Math.floor(value / step + 0.5) * step);
  return value;
}

/** `Math::cubic_interpolate(float, ...)` (`core/math/math_funcs.h:349`). */
function cubicReal(from: number, to: number, pre: number, post: number, weight: number): number {
  const w2 = f32(weight * weight);
  const w3 = f32(w2 * weight);
  const a = f32(from * 2);
  const b = f32(f32(-pre + to) * weight);
  const c = f32(f32(f32(f32(f32(2 * pre) - f32(5 * from)) + f32(4 * to)) - post) * w2);
  const d = f32(f32(f32(f32(-pre + f32(3 * from)) - f32(3 * to)) + post) * w3);
  return f32(0.5 * f32(f32(f32(a + b) + c) + d));
}

/** `Math::cubic_interpolate_in_time(float, ...)`, the Barry-Goldman method (`core/math/math_funcs.h:398`). */
function cubicInTimeReal(
  from: number,
  to: number,
  pre: number,
  post: number,
  weight: number,
  to_t: number,
  pre_t: number,
  post_t: number,
): number {
  const t = lerpReal(0, to_t, weight);
  const a1 = lerpReal(pre, from, pre_t === 0 ? 0 : f32(f32(t - pre_t) / -pre_t));
  const a2 = lerpReal(from, to, to_t === 0 ? 0.5 : f32(t / to_t));
  const a3 = lerpReal(to, post, f32(post_t - to_t) === 0 ? 1 : f32(f32(t - to_t) / f32(post_t - to_t)));
  const b1 = lerpReal(a1, a2, f32(to_t - pre_t) === 0 ? 0 : f32(f32(t - pre_t) / f32(to_t - pre_t)));
  const b2 = lerpReal(a2, a3, post_t === 0 ? 1 : f32(t / post_t));
  return lerpReal(b1, b2, to_t === 0 ? 0.5 : f32(t / to_t));
}

/** `Math::bezier_interpolate(float, ...)` (`core/math/math_funcs.h:451`). */
function bezierReal(start: number, control_1: number, control_2: number, end: number, t: number): number {
  const omt = f32(1 - t);
  const omt2 = f32(omt * omt);
  const omt3 = f32(omt2 * omt);
  const t2 = f32(t * t);
  const t3 = f32(t2 * t);
  return f32(
    f32(f32(f32(start * omt3) + f32(f32(f32(control_1 * omt2) * t) * 3)) + f32(f32(f32(control_2 * omt) * t2) * 3)) +
      f32(end * t3),
  );
}

/** `Math::bezier_derivative(float, ...)` (`core/math/math_funcs.h:471`). */
function bezierDerivativeReal(start: number, control_1: number, control_2: number, end: number, t: number): number {
  const omt = f32(1 - t);
  const omt2 = f32(omt * omt);
  const t2 = f32(t * t);
  return f32(
    f32(f32(f32(control_1 - start) * 3) * omt2) +
      f32(f32(f32(f32(control_2 - control_1) * 6) * omt) * t) +
      f32(f32(f32(end - control_2) * 3) * t2),
  );
}

/** Applies a `real_t` function to each component. */
function each(self: Vector3, fn: (value: number) => number): Vector3 {
  return make(fn(self.x), fn(self.y), fn(self.z));
}

/**
 * `AXIS_X` (0), `AXIS_Y` (1) or `AXIS_Z` (2), whichever component is smallest; ties go to the later axis.
 *
 * @godot Vector3.min_axis_index
 * @source core/math/vector3.h:85
 */
export function min_axis_index(self: Vector3): number {
  return self.x < self.y ? (self.x < self.z ? 0 : 2) : self.y < self.z ? 1 : 2;
}

/**
 * @godot Vector3.max_axis_index
 * @source core/math/vector3.h:89
 */
export function max_axis_index(self: Vector3): number {
  return self.x < self.y ? (self.y < self.z ? 2 : 1) : self.x < self.z ? 2 : 0;
}

/**
 * `atan2(cross(p_to).length(), dot(p_to))`.
 *
 * @godot Vector3.angle_to
 * @source core/math/vector3.h:358
 */
export function angle_to(self: Vector3, p_to: Vector3): number {
  return f32(Math.atan2(length(cross(self, p_to)), dot(self, p_to)));
}

/**
 * The unsigned angle, negated when the cross product points against `p_axis`.
 *
 * @godot Vector3.signed_angle_to
 * @source core/math/vector3.h:362
 */
export function signed_angle_to(self: Vector3, p_to: Vector3, p_axis: Vector3): number {
  const crossTo = cross(self, p_to);
  const unsigned = f32(Math.atan2(length(crossTo), dot(self, p_to)));
  return dot(crossTo, p_axis) < 0 ? -unsigned : unsigned;
}

/**
 * @godot Vector3.direction_to
 * @source core/math/vector3.h:369
 */
export function direction_to(self: Vector3, p_to: Vector3): Vector3 {
  return normalized(make(f32(p_to.x - self.x), f32(p_to.y - self.y), f32(p_to.z - self.z)));
}

/**
 * @godot Vector3.distance_squared_to
 * @source core/math/vector3.h:342
 */
export function distance_squared_to(self: Vector3, p_to: Vector3): number {
  return length_squared(op_subtract(p_to, self));
}

/**
 * @godot Vector3.is_finite
 * @source core/math/vector3.cpp:153
 */
export function is_finite(self: Vector3): boolean {
  return Number.isFinite(self.x) && Number.isFinite(self.y) && Number.isFinite(self.z);
}

/**
 * `1.0f / component` for each; a zero component becomes an infinity.
 *
 * @godot Vector3.inverse
 * @source core/math/vector3.h:579
 */
export function inverse(self: Vector3): Vector3 {
  return make(f32(1 / self.x), f32(1 / self.y), f32(1 / self.z));
}

/**
 * @godot Vector3.clamp
 * @source core/math/vector3.h:109
 */
export function clamp(self: Vector3, p_min: Vector3, p_max: Vector3): Vector3 {
  return make(clampReal(self.x, p_min.x, p_max.x), clampReal(self.y, p_min.y, p_max.y), clampReal(self.z, p_min.z, p_max.z));
}

/**
 * @godot Vector3.clampf
 * @source core/math/vector3.h:116
 */
export function clampf(self: Vector3, p_min: number, p_max: number): Vector3 {
  const [min, max] = [f32(p_min), f32(p_max)];
  return each(self, (value) => clampReal(value, min, max));
}

/**
 * @godot Vector3.snapped
 * @source core/math/vector3.cpp:54
 */
export function snapped(self: Vector3, p_step: Vector3): Vector3 {
  return make(snappedReal(self.x, p_step.x), snappedReal(self.y, p_step.y), snappedReal(self.z, p_step.z));
}

/**
 * @godot Vector3.snappedf
 * @source core/math/vector3.cpp:66
 */
export function snappedf(self: Vector3, p_step: number): Vector3 {
  const step = f32(p_step);
  return each(self, (value) => snappedReal(value, step));
}

/**
 * A zero-length end, or parallel ends (no rotation axis), lerp; otherwise the vector turns about the
 * normalized cross product by `angle_to * weight` and its length lerps.
 *
 * @godot Vector3.slerp
 * @source core/math/vector3.h:284
 */
export function slerp(self: Vector3, p_to: Vector3, p_weight: number): Vector3 {
  const weight = f32(p_weight);
  const startLengthSq = length_squared(self);
  const endLengthSq = length_squared(p_to);
  if (startLengthSq === 0 || endLengthSq === 0) return lerp(self, p_to, weight);
  let axis = cross(self, p_to);
  const axisLengthSq = length_squared(axis);
  if (axisLengthSq === 0) return lerp(self, p_to, weight);
  axis = op_divide(axis, f32(Math.sqrt(axisLengthSq)));
  const startLength = f32(Math.sqrt(startLengthSq));
  const resultLength = lerpReal(startLength, f32(Math.sqrt(endLengthSq)), weight);
  const turn = angle_to(self, p_to);
  return op_multiply(rotated(self, axis, f32(turn * weight)), f32(resultLength / startLength));
}

/**
 * @godot Vector3.cubic_interpolate
 * @source core/math/vector3.h:306
 */
export function cubic_interpolate(self: Vector3, p_b: Vector3, p_pre_a: Vector3, p_post_b: Vector3, p_weight: number): Vector3 {
  const weight = f32(p_weight);
  return make(
    cubicReal(self.x, p_b.x, p_pre_a.x, p_post_b.x, weight),
    cubicReal(self.y, p_b.y, p_pre_a.y, p_post_b.y, weight),
    cubicReal(self.z, p_b.z, p_pre_a.z, p_post_b.z, weight),
  );
}

/**
 * @godot Vector3.cubic_interpolate_in_time
 * @source core/math/vector3.h:314
 */
export function cubic_interpolate_in_time(
  self: Vector3,
  p_b: Vector3,
  p_pre_a: Vector3,
  p_post_b: Vector3,
  p_weight: number,
  p_b_t: number,
  p_pre_a_t: number,
  p_post_b_t: number,
): Vector3 {
  const [w, bt, pt, qt] = [f32(p_weight), f32(p_b_t), f32(p_pre_a_t), f32(p_post_b_t)];
  return make(
    cubicInTimeReal(self.x, p_b.x, p_pre_a.x, p_post_b.x, w, bt, pt, qt),
    cubicInTimeReal(self.y, p_b.y, p_pre_a.y, p_post_b.y, w, bt, pt, qt),
    cubicInTimeReal(self.z, p_b.z, p_pre_a.z, p_post_b.z, w, bt, pt, qt),
  );
}

/**
 * @godot Vector3.bezier_interpolate
 * @source core/math/vector3.h:322
 */
export function bezier_interpolate(self: Vector3, p_control_1: Vector3, p_control_2: Vector3, p_end: Vector3, p_t: number): Vector3 {
  const t = f32(p_t);
  return make(
    bezierReal(self.x, p_control_1.x, p_control_2.x, p_end.x, t),
    bezierReal(self.y, p_control_1.y, p_control_2.y, p_end.y, t),
    bezierReal(self.z, p_control_1.z, p_control_2.z, p_end.z, t),
  );
}

/**
 * @godot Vector3.bezier_derivative
 * @source core/math/vector3.h:330
 */
export function bezier_derivative(self: Vector3, p_control_1: Vector3, p_control_2: Vector3, p_end: Vector3, p_t: number): Vector3 {
  const t = f32(p_t);
  return make(
    bezierDerivativeReal(self.x, p_control_1.x, p_control_2.x, p_end.x, t),
    bezierDerivativeReal(self.y, p_control_1.y, p_control_2.y, p_end.y, t),
    bezierDerivativeReal(self.z, p_control_1.z, p_control_2.z, p_end.z, t),
  );
}

/**
 * `p_to` once within `p_delta` (or `CMP_EPSILON`), else a step of `p_delta` toward it.
 *
 * @godot Vector3.move_toward
 * @source core/math/vector3.cpp:83
 */
export function move_toward(self: Vector3, p_to: Vector3, p_delta: number): Vector3 {
  const delta = f32(p_delta);
  const vd = op_subtract(p_to, self);
  const len = length(vd);
  if (len <= delta || len < CMP_EPSILON) return p_to;
  return op_add(self, op_multiply(op_divide(vd, len), delta));
}

/**
 * The outer product: row `i` is `self[i] * p_with`, so column `j` is `self * p_with[j]`.
 *
 * @godot Vector3.outer
 * @source core/math/vector3.cpp:133
 */
export function outer(self: Vector3, p_with: Vector3): Basis {
  return Object.freeze({ x: op_multiply(self, p_with.x), y: op_multiply(self, p_with.y), z: op_multiply(self, p_with.z) });
}

/**
 * @godot Vector3.abs
 * @source core/math/vector3.h:256
 */
export function abs(self: Vector3): Vector3 {
  return each(self, Math.abs);
}

/**
 * @godot Vector3.floor
 * @source core/math/vector3.h:264
 */
export function floor(self: Vector3): Vector3 {
  return each(self, Math.floor);
}

/**
 * @godot Vector3.ceil
 * @source core/math/vector3.h:268
 */
export function ceil(self: Vector3): Vector3 {
  return each(self, Math.ceil);
}

/**
 * `std::round`: halves round away from zero.
 *
 * @godot Vector3.round
 * @source core/math/vector3.h:272
 */
export function round(self: Vector3): Vector3 {
  return each(self, roundReal);
}

/**
 * @godot Vector3.posmod
 * @source core/math/vector3.h:346
 */
export function posmod(self: Vector3, p_mod: number): Vector3 {
  const mod = f32(p_mod);
  return each(self, (value) => fposmod(value, mod));
}

/**
 * @godot Vector3.posmodv
 * @source core/math/vector3.h:350
 */
export function posmodv(self: Vector3, p_modv: Vector3): Vector3 {
  return make(fposmod(self.x, p_modv.x), fposmod(self.y, p_modv.y), fposmod(self.z, p_modv.z));
}

/**
 * `p_to * (dot(p_to) / p_to.length_squared())`.
 *
 * @godot Vector3.project
 * @source core/math/vector3.h:354
 */
export function project(self: Vector3, p_to: Vector3): Vector3 {
  return op_multiply(p_to, f32(dot(self, p_to) / length_squared(p_to)));
}

/**
 * `2 * p_normal * dot(p_normal) - *this`; under `MATH_CHECKS` a normal that is not normalized fails
 * with (0, 0, 0).
 *
 * @godot Vector3.reflect
 * @source core/math/vector3.h:599
 */
export function reflect(self: Vector3, p_normal: Vector3): Vector3 {
  if (!is_normalized(p_normal)) return make(0, 0, 0);
  return op_subtract(op_multiply(op_multiply(p_normal, 2), dot(self, p_normal)), self);
}

/**
 * `-reflect(p_normal)`.
 *
 * @godot Vector3.bounce
 * @source core/math/vector3.h:595
 */
export function bounce(self: Vector3, p_normal: Vector3): Vector3 {
  return op_negate(reflect(self, p_normal));
}

/**
 * @godot Vector3.sign
 * @source core/math/vector3.h:260
 */
export function sign(self: Vector3): Vector3 {
  return each(self, signReal);
}

/**
 * The unit vector projected onto the octahedron and unfolded into `[0, 1]^2`.
 *
 * @godot Vector3.octahedron_encode
 * @source core/math/vector3.cpp:90
 */
export function octahedron_encode(self: Vector3): Vector2 {
  const n = op_divide(self, f32(f32(Math.abs(self.x) + Math.abs(self.y)) + Math.abs(self.z)));
  let ox: number;
  let oy: number;
  if (n.z >= 0) {
    ox = n.x;
    oy = n.y;
  } else {
    ox = f32(f32(1 - Math.abs(n.y)) * (n.x >= 0 ? 1 : -1));
    oy = f32(f32(1 - Math.abs(n.x)) * (n.y >= 0 ? 1 : -1));
  }
  return vector2(f32(f32(ox * 0.5) + 0.5), f32(f32(oy * 0.5) + 0.5));
}

/**
 * The inverse of `octahedron_encode`, normalized.
 *
 * @godot Vector3.octahedron_decode
 * @source core/math/vector3.cpp:106
 */
export function octahedron_decode(p_oct: Vector2): Vector3 {
  const fx = f32(f32(p_oct.x * 2) - 1);
  const fy = f32(f32(p_oct.y * 2) - 1);
  const nz = f32(f32(1 - Math.abs(fx)) - Math.abs(fy));
  const t = clampReal(-nz, 0, 1);
  const nx = f32(fx + (fx >= 0 ? -t : t));
  const ny = f32(fy + (fy >= 0 ? -t : t));
  return normalized(make(nx, ny, nz));
}

/**
 * @godot Vector3.min
 * @source core/math/vector3.h:93
 */
export function min(self: Vector3, p_vector3: Vector3): Vector3 {
  return make(
    self.x < p_vector3.x ? self.x : p_vector3.x,
    self.y < p_vector3.y ? self.y : p_vector3.y,
    self.z < p_vector3.z ? self.z : p_vector3.z,
  );
}

/**
 * @godot Vector3.minf
 * @source core/math/vector3.h:97
 */
export function minf(self: Vector3, p_scalar: number): Vector3 {
  const s = f32(p_scalar);
  return each(self, (value) => (value < s ? value : s));
}

/**
 * @godot Vector3.max
 * @source core/math/vector3.h:101
 */
export function max(self: Vector3, p_vector3: Vector3): Vector3 {
  return make(
    self.x > p_vector3.x ? self.x : p_vector3.x,
    self.y > p_vector3.y ? self.y : p_vector3.y,
    self.z > p_vector3.z ? self.z : p_vector3.z,
  );
}

/**
 * @godot Vector3.maxf
 * @source core/math/vector3.h:105
 */
export function maxf(self: Vector3, p_scalar: number): Vector3 {
  const s = f32(p_scalar);
  return each(self, (value) => (value > s ? value : s));
}

/**
 * Against null (the `Variant` right operand) it is true (`core/variant/variant_op.cpp:663`).
 *
 * @godot Vector3.OP_NOT_EQUAL
 * @source core/math/vector3.h:480
 */
export function op_not_equal(left: Vector3, right: Vector3 | null): boolean {
  return right === null || left.x !== right.x || left.y !== right.y || left.z !== right.z;
}

/**
 * @godot Vector3.OP_POSITIVE
 * @source core/variant/variant_op.cpp:472
 */
export function op_positive(self: Vector3): Vector3 {
  return self;
}

/**
 * `v == Vector3()`.
 *
 * @godot Vector3.OP_NOT
 * @source core/variant/variant_op.cpp:892
 */
export function op_not(self: Vector3): boolean {
  return self.x === 0 && self.y === 0 && self.z === 0;
}

/**
 * Lexicographic over x, y, z.
 *
 * @godot Vector3.OP_LESS
 * @source core/math/vector3.h:484
 */
export function op_less(left: Vector3, right: Vector3): boolean {
  if (left.x === right.x) return left.y === right.y ? left.z < right.z : left.y < right.y;
  return left.x < right.x;
}

/**
 * @godot Vector3.OP_GREATER
 * @source core/math/vector3.h:494
 */
export function op_greater(left: Vector3, right: Vector3): boolean {
  if (left.x === right.x) return left.y === right.y ? left.z > right.z : left.y > right.y;
  return left.x > right.x;
}

/**
 * @godot Vector3.OP_LESS_EQUAL
 * @source core/math/vector3.h:504
 */
export function op_less_equal(left: Vector3, right: Vector3): boolean {
  if (left.x === right.x) return left.y === right.y ? left.z <= right.z : left.y < right.y;
  return left.x < right.x;
}

/**
 * @godot Vector3.OP_GREATER_EQUAL
 * @source core/math/vector3.h:514
 */
export function op_greater_equal(left: Vector3, right: Vector3): boolean {
  if (left.x === right.x) return left.y === right.y ? left.z >= right.z : left.y > right.y;
  return left.x > right.x;
}

/** Whether an Array or PackedVector3Array element, or a Dictionary key, is this Vector3. */
function isVector3Equal(value: unknown, v: Vector3): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const other = value as Record<string, unknown>;
  return Object.keys(other).length === 3 && other.x === v.x && other.y === v.y && other.z === v.z;
}

/**
 * `v in array` is `array.find(v) != -1` (also for `PackedVector3Array`); `v in dict` is
 * `dict.has(v)` (`core/variant/variant_op.h:1180`). A Vector3 key is matched by value.
 *
 * @godot Vector3.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Vector3, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isVector3Equal(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isVector3Equal(key, left)) return true;
  return false;
}
