/**
 * @godot-class Vector2
 * @role PROTOCOL
 *
 * Godot 4.7's `Vector2` built-in value, transcribed from `core/math/vector2.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. The pinned build stores `real_t` as a 32-bit float,
 * so every component and every `real_t` intermediate is rounded with `Math.fround` exactly where
 * the C++ rounds it; no multiply-add is fused (`-ffp-contract=off`, `platform/macos/detect.py:118`).
 */

import type { Transform2D } from './transform-2d';

const f32 = Math.fround;

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

/** `Vector2(real_t, real_t)`: each argument is converted to `real_t`. */
function make(x: number, y: number): Vector2 {
  return Object.freeze({ x: f32(x), y: f32(y) });
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:84-87`): no arguments,
 * `from: Vector2`, `from: Vector2i` (`Vector2((int32_t)x, (int32_t)y)`,
 * `core/math/vector2i.cpp:72`), and `x, y: float`.
 *
 * @godot Vector2.Vector2
 * @source core/math/vector2.h:205
 */
export function construct(...args: readonly [] | readonly [Vector2] | readonly [number, number]): Vector2 {
  if (args.length === 0) return make(0, 0);
  if (args.length === 1) return make(args[0].x, args[0].y);
  return make(args[0], args[1]);
}

/**
 * @godot Vector2.ZERO
 * @source core/variant/variant_call.cpp:3152
 */
export const ZERO: Vector2 = make(0, 0);

/** The largest float not above pi: C's `atan2f` range is `[-pi, +pi]` (C11 7.12.4.4). */
const PI_FLOAT_BELOW = 3.141592502593994;

/**
 * `std::atan2f`, whose result must lie in `[-pi, +pi]`: a result that rounds to the float above
 * pi is the float below it instead, as the official build's libm returns.
 */
function atan2f(y: number, x: number): number {
  const result = f32(Math.atan2(y, x));
  if (result > Math.PI) return PI_FLOAT_BELOW;
  if (result < -Math.PI) return -PI_FLOAT_BELOW;
  return result;
}

/**
 * `Math::atan2(float, float)` is `std::atan2` on floats (`core/math/math_funcs.h:123`).
 *
 * @godot Vector2.angle
 * @source core/math/vector2.cpp:36
 */
export function angle(self: Vector2): number {
  return atan2f(self.y, self.x);
}

/**
 * @godot Vector2.length
 * @source core/math/vector2.cpp:44
 */
export function length(self: Vector2): number {
  return f32(Math.sqrt(f32(f32(self.x * self.x) + f32(self.y * self.y))));
}

/**
 * @godot Vector2.length_squared
 * @source core/math/vector2.cpp:48
 */
export function length_squared(self: Vector2): number {
  return f32(f32(self.x * self.x) + f32(self.y * self.y));
}

/**
 * `normalize()` on a copy (`core/math/vector2.cpp:52`): a non-finite vector or a zero length
 * becomes `(0, 0)`; otherwise each component is divided by the `real_t` length.
 *
 * @godot Vector2.normalized
 * @source core/math/vector2.cpp:71
 */
export function normalized(self: Vector2): Vector2 {
  if (!(Number.isFinite(self.x) && Number.isFinite(self.y))) return make(0, 0);
  let l = length_squared(self);
  if (l === 0) return make(0, 0);
  l = f32(Math.sqrt(l));
  return make(f32(self.x / l), f32(self.y / l));
}

/**
 * @godot Vector2.distance_to
 * @source core/math/vector2.cpp:82
 */
export function distance_to(self: Vector2, p_vector2: Vector2): number {
  const dx = f32(self.x - p_vector2.x);
  const dy = f32(self.y - p_vector2.y);
  return f32(Math.sqrt(f32(f32(dx * dx) + f32(dy * dy))));
}

/**
 * `v /= l; v *= p_len` only when `l > 0 && p_len < l`; the Variant default for `length` is 1.0.
 *
 * @godot Vector2.limit_length
 * @source core/math/vector2.cpp:166
 */
export function limit_length(self: Vector2, p_len = 1.0): Vector2 {
  const len = f32(p_len);
  const l = length(self);
  if (l > 0 && len < l) {
    const x = f32(self.x / l);
    const y = f32(self.y / l);
    return make(f32(x * len), f32(y * len));
  }
  return self;
}

/**
 * @godot Vector2.OP_ADD
 * @source core/math/vector2.h:219
 */
export function op_add(left: Vector2, right: Vector2): Vector2 {
  return make(f32(left.x + right.x), f32(left.y + right.y));
}

/**
 * @godot Vector2.OP_SUBTRACT
 * @source core/math/vector2.h:228
 */
export function op_subtract(left: Vector2, right: Vector2): Vector2 {
  return make(f32(left.x - right.x), f32(left.y - right.y));
}

/**
 * `Vector2 * Vector2` (`core/math/vector2.h:237`) and `Vector2 * real_t` (`core/math/vector2.h:241`);
 * a Variant `float` or `int` right operand converts to `real_t` first. `Vector2 * Transform2D` is
 * the transform's `xform_inv` (`OperatorEvaluatorXFormInv`, `core/variant/variant_op.cpp:310`):
 * the origin subtracted, then each basis column dotted with the rest (`core/math/transform_2d.h:221`).
 *
 * @godot Vector2.OP_MULTIPLY
 * @source core/math/vector2.h:237
 */
export function op_multiply(left: Vector2, right: Vector2 | number | Transform2D): Vector2 {
  if (typeof right === 'object' && 'origin' in right) {
    const v = make(f32(left.x - right.origin.x), f32(left.y - right.origin.y));
    return make(dot(right.x, v), dot(right.y, v));
  }
  if (typeof right === 'number') {
    const scalar = f32(right);
    return make(f32(left.x * scalar), f32(left.y * scalar));
  }
  return make(f32(left.x * right.x), f32(left.y * right.y));
}

/**
 * `Vector2 / Vector2` (`core/math/vector2.h:250`) and `Vector2 / real_t` (`core/math/vector2.h:254`);
 * a zero divisor follows IEEE division.
 *
 * @godot Vector2.OP_DIVIDE
 * @source core/math/vector2.h:250
 */
export function op_divide(left: Vector2, right: Vector2 | number): Vector2 {
  if (typeof right === 'number') {
    const scalar = f32(right);
    return make(f32(left.x / scalar), f32(left.y / scalar));
  }
  return make(f32(left.x / right.x), f32(left.y / right.y));
}

/**
 * `v.x = value` writes `real_t x` (`core/math/vector2.h:56`); the write is a new record assigned back.
 *
 * @godot Vector2.x
 * @source core/math/vector2.h:56
 */
export function with_x(self: Vector2, value: number): Vector2 {
  return make(value, self.y);
}

/**
 * @godot Vector2.y
 * @source core/math/vector2.h:57
 */
export function with_y(self: Vector2, value: number): Vector2 {
  return make(self.x, value);
}

/** `(float)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);
/** `(real_t)UNIT_EPSILON` without `PRECISE_MATH_CHECKS` (`core/math/math_defs.h:65`). */
const UNIT_EPSILON = f32(0.001);

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function isEqualApproxReal(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(CMP_EPSILON * Math.abs(left));
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(f32(left - right)) < tolerance;
}

/** `Math::lerp(float, float, float)` (`core/math/math_funcs.h:338`). */
function lerpReal(from: number, to: number, weight: number): number {
  return f32(from + f32(f32(to - from) * weight));
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

/** `Math::fposmod(float, float)` (`core/math/math_funcs.h:286`): `fmod` made the divisor's sign. */
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

/**
 * @godot Vector2.from_angle
 * @source core/math/vector2.cpp:40
 */
export function from_angle(p_angle: number): Vector2 {
  const angle = f32(p_angle);
  return make(f32(Math.cos(angle)), f32(Math.sin(angle)));
}

/**
 * @godot Vector2.dot
 * @source core/math/vector2.cpp:98
 */
export function dot(self: Vector2, p_other: Vector2): number {
  return f32(f32(self.x * p_other.x) + f32(self.y * p_other.y));
}

/**
 * @godot Vector2.cross
 * @source core/math/vector2.cpp:102
 */
export function cross(self: Vector2, p_other: Vector2): number {
  return f32(f32(self.x * p_other.y) - f32(self.y * p_other.x));
}

/**
 * @godot Vector2.distance_squared_to
 * @source core/math/vector2.cpp:86
 */
export function distance_squared_to(self: Vector2, p_vector2: Vector2): number {
  const dx = f32(self.x - p_vector2.x);
  const dy = f32(self.y - p_vector2.y);
  return f32(f32(dx * dx) + f32(dy * dy));
}

/**
 * `atan2(cross, dot)`.
 *
 * @godot Vector2.angle_to
 * @source core/math/vector2.cpp:90
 */
export function angle_to(self: Vector2, p_vector2: Vector2): number {
  return atan2f(cross(self, p_vector2), dot(self, p_vector2));
}

/**
 * @godot Vector2.angle_to_point
 * @source core/math/vector2.cpp:94
 */
export function angle_to_point(self: Vector2, p_vector2: Vector2): number {
  return angle(op_subtract(p_vector2, self));
}

/**
 * The difference normalized.
 *
 * @godot Vector2.direction_to
 * @source core/math/vector2.h:323
 */
export function direction_to(self: Vector2, p_to: Vector2): Vector2 {
  return normalized(make(f32(p_to.x - self.x), f32(p_to.y - self.y)));
}

/**
 * `Math::is_equal_approx(length_squared(), 1, UNIT_EPSILON)`.
 *
 * @godot Vector2.is_normalized
 * @source core/math/vector2.cpp:77
 */
export function is_normalized(self: Vector2): boolean {
  const l = length_squared(self);
  return l === 1 || Math.abs(f32(l - 1)) < UNIT_EPSILON;
}

/**
 * @godot Vector2.is_equal_approx
 * @source core/math/vector2.cpp:203
 */
export function is_equal_approx(self: Vector2, p_v: Vector2): boolean {
  return isEqualApproxReal(self.x, p_v.x) && isEqualApproxReal(self.y, p_v.y);
}

/**
 * @godot Vector2.is_zero_approx
 * @source core/math/vector2.cpp:211
 */
export function is_zero_approx(self: Vector2): boolean {
  return Math.abs(self.x) < CMP_EPSILON && Math.abs(self.y) < CMP_EPSILON;
}

/**
 * @godot Vector2.is_finite
 * @source core/math/vector2.cpp:215
 */
export function is_finite(self: Vector2): boolean {
  return Number.isFinite(self.x) && Number.isFinite(self.y);
}

/**
 * @godot Vector2.posmod
 * @source core/math/vector2.cpp:130
 */
export function posmod(self: Vector2, p_mod: number): Vector2 {
  const mod = f32(p_mod);
  return make(fposmod(self.x, mod), fposmod(self.y, mod));
}

/**
 * @godot Vector2.posmodv
 * @source core/math/vector2.cpp:134
 */
export function posmodv(self: Vector2, p_modv: Vector2): Vector2 {
  return make(fposmod(self.x, p_modv.x), fposmod(self.y, p_modv.y));
}

/**
 * `p_to * (dot(p_to) / p_to.length_squared())`.
 *
 * @godot Vector2.project
 * @source core/math/vector2.cpp:138
 */
export function project(self: Vector2, p_to: Vector2): Vector2 {
  return op_multiply(p_to, f32(dot(self, p_to) / length_squared(p_to)));
}

/**
 * @godot Vector2.lerp
 * @source core/math/vector2.h:275
 */
export function lerp(self: Vector2, p_to: Vector2, p_weight: number): Vector2 {
  const weight = f32(p_weight);
  return make(lerpReal(self.x, p_to.x, weight), lerpReal(self.y, p_to.y, weight));
}

/**
 * A zero-length end lerps; otherwise the vector turns by `angle_to * weight` and its length lerps.
 *
 * @godot Vector2.slerp
 * @source core/math/vector2.h:282
 */
export function slerp(self: Vector2, p_to: Vector2, p_weight: number): Vector2 {
  const weight = f32(p_weight);
  const startLengthSq = length_squared(self);
  const endLengthSq = length_squared(p_to);
  if (startLengthSq === 0 || endLengthSq === 0) return lerp(self, p_to, weight);
  const startLength = f32(Math.sqrt(startLengthSq));
  const resultLength = lerpReal(startLength, f32(Math.sqrt(endLengthSq)), weight);
  const turn = angle_to(self, p_to);
  return op_multiply(rotated(self, f32(turn * weight)), f32(resultLength / startLength));
}

/**
 * @godot Vector2.cubic_interpolate
 * @source core/math/vector2.h:295
 */
export function cubic_interpolate(self: Vector2, p_b: Vector2, p_pre_a: Vector2, p_post_b: Vector2, p_weight: number): Vector2 {
  const weight = f32(p_weight);
  return make(
    cubicReal(self.x, p_b.x, p_pre_a.x, p_post_b.x, weight),
    cubicReal(self.y, p_b.y, p_pre_a.y, p_post_b.y, weight),
  );
}

/**
 * @godot Vector2.cubic_interpolate_in_time
 * @source core/math/vector2.h:302
 */
export function cubic_interpolate_in_time(
  self: Vector2,
  p_b: Vector2,
  p_pre_a: Vector2,
  p_post_b: Vector2,
  p_weight: number,
  p_b_t: number,
  p_pre_a_t: number,
  p_post_b_t: number,
): Vector2 {
  const [w, bt, pt, qt] = [f32(p_weight), f32(p_b_t), f32(p_pre_a_t), f32(p_post_b_t)];
  return make(
    cubicInTimeReal(self.x, p_b.x, p_pre_a.x, p_post_b.x, w, bt, pt, qt),
    cubicInTimeReal(self.y, p_b.y, p_pre_a.y, p_post_b.y, w, bt, pt, qt),
  );
}

/**
 * @godot Vector2.bezier_interpolate
 * @source core/math/vector2.h:309
 */
export function bezier_interpolate(self: Vector2, p_control_1: Vector2, p_control_2: Vector2, p_end: Vector2, p_t: number): Vector2 {
  const t = f32(p_t);
  return make(
    bezierReal(self.x, p_control_1.x, p_control_2.x, p_end.x, t),
    bezierReal(self.y, p_control_1.y, p_control_2.y, p_end.y, t),
  );
}

/**
 * @godot Vector2.bezier_derivative
 * @source core/math/vector2.h:316
 */
export function bezier_derivative(self: Vector2, p_control_1: Vector2, p_control_2: Vector2, p_end: Vector2, p_t: number): Vector2 {
  const t = f32(p_t);
  return make(
    bezierDerivativeReal(self.x, p_control_1.x, p_control_2.x, p_end.x, t),
    bezierDerivativeReal(self.y, p_control_1.y, p_control_2.y, p_end.y, t),
  );
}

/**
 * `AXIS_Y` (1) when `x < y`, else `AXIS_X` (0).
 *
 * @godot Vector2.max_axis_index
 * @source core/math/vector2.h:82
 */
export function max_axis_index(self: Vector2): number {
  return self.x < self.y ? 1 : 0;
}

/**
 * `AXIS_X` (0) when `x < y`, else `AXIS_Y` (1).
 *
 * @godot Vector2.min_axis_index
 * @source core/math/vector2.h:78
 */
export function min_axis_index(self: Vector2): number {
  return self.x < self.y ? 0 : 1;
}

/**
 * `p_to` once within `p_delta` (or `CMP_EPSILON`), else a step of `p_delta` toward it.
 *
 * @godot Vector2.move_toward
 * @source core/math/vector2.cpp:177
 */
export function move_toward(self: Vector2, p_to: Vector2, p_delta: number): Vector2 {
  const delta = f32(p_delta);
  const vd = op_subtract(p_to, self);
  const len = length(vd);
  if (len <= delta || len < CMP_EPSILON) return p_to;
  return op_add(self, op_multiply(op_divide(vd, len), delta));
}

/**
 * @godot Vector2.rotated
 * @source core/math/vector2.cpp:122
 */
export function rotated(self: Vector2, p_by: number): Vector2 {
  const by = f32(p_by);
  const sine = f32(Math.sin(by));
  const cosi = f32(Math.cos(by));
  return make(f32(f32(self.x * cosi) - f32(self.y * sine)), f32(f32(self.x * sine) + f32(self.y * cosi)));
}

/**
 * @godot Vector2.orthogonal
 * @source core/math/vector2.h:179
 */
export function orthogonal(self: Vector2): Vector2 {
  return make(self.y, -self.x);
}

/**
 * @godot Vector2.floor
 * @source core/math/vector2.cpp:110
 */
export function floor(self: Vector2): Vector2 {
  return make(Math.floor(self.x), Math.floor(self.y));
}

/**
 * @godot Vector2.ceil
 * @source core/math/vector2.cpp:114
 */
export function ceil(self: Vector2): Vector2 {
  return make(Math.ceil(self.x), Math.ceil(self.y));
}

/**
 * `std::round`: halves round away from zero.
 *
 * @godot Vector2.round
 * @source core/math/vector2.cpp:118
 */
export function round(self: Vector2): Vector2 {
  return make(roundReal(self.x), roundReal(self.y));
}

/**
 * `width / height`.
 *
 * @godot Vector2.aspect
 * @source core/math/vector2.h:191
 */
export function aspect(self: Vector2): number {
  return f32(self.x / self.y);
}

/**
 * `*this - p_normal * dot(p_normal)`; under `MATH_CHECKS` a normal that is not normalized fails
 * with (0, 0).
 *
 * @godot Vector2.slide
 * @source core/math/vector2.cpp:185
 */
export function slide(self: Vector2, p_normal: Vector2): Vector2 {
  if (!is_normalized(p_normal)) return make(0, 0);
  return op_subtract(self, op_multiply(p_normal, dot(self, p_normal)));
}

/**
 * `2 * p_normal * dot(p_normal) - *this`; under `MATH_CHECKS` a normal that is not normalized fails
 * with (0, 0).
 *
 * @godot Vector2.reflect
 * @source core/math/vector2.cpp:196
 */
export function reflect(self: Vector2, p_normal: Vector2): Vector2 {
  if (!is_normalized(p_normal)) return make(0, 0);
  return op_subtract(op_multiply(op_multiply(p_normal, 2), dot(self, p_normal)), self);
}

/**
 * `-reflect(p_normal)`.
 *
 * @godot Vector2.bounce
 * @source core/math/vector2.cpp:192
 */
export function bounce(self: Vector2, p_normal: Vector2): Vector2 {
  return op_negate(reflect(self, p_normal));
}

/**
 * @godot Vector2.abs
 * @source core/math/vector2.h:174
 */
export function abs(self: Vector2): Vector2 {
  return make(Math.abs(self.x), Math.abs(self.y));
}

/**
 * @godot Vector2.sign
 * @source core/math/vector2.cpp:106
 */
export function sign(self: Vector2): Vector2 {
  return make(signReal(self.x), signReal(self.y));
}

/**
 * @godot Vector2.clamp
 * @source core/math/vector2.cpp:142
 */
export function clamp(self: Vector2, p_min: Vector2, p_max: Vector2): Vector2 {
  return make(clampReal(self.x, p_min.x, p_max.x), clampReal(self.y, p_min.y, p_max.y));
}

/**
 * @godot Vector2.clampf
 * @source core/math/vector2.cpp:148
 */
export function clampf(self: Vector2, p_min: number, p_max: number): Vector2 {
  const [min, max] = [f32(p_min), f32(p_max)];
  return make(clampReal(self.x, min, max), clampReal(self.y, min, max));
}

/**
 * @godot Vector2.snapped
 * @source core/math/vector2.cpp:154
 */
export function snapped(self: Vector2, p_step: Vector2): Vector2 {
  return make(snappedReal(self.x, p_step.x), snappedReal(self.y, p_step.y));
}

/**
 * @godot Vector2.snappedf
 * @source core/math/vector2.cpp:160
 */
export function snappedf(self: Vector2, p_step: number): Vector2 {
  const step = f32(p_step);
  return make(snappedReal(self.x, step), snappedReal(self.y, step));
}

/**
 * @godot Vector2.min
 * @source core/math/vector2.h:96
 */
export function min(self: Vector2, p_vector2: Vector2): Vector2 {
  return make(self.x < p_vector2.x ? self.x : p_vector2.x, self.y < p_vector2.y ? self.y : p_vector2.y);
}

/**
 * @godot Vector2.minf
 * @source core/math/vector2.h:100
 */
export function minf(self: Vector2, p_scalar: number): Vector2 {
  const s = f32(p_scalar);
  return make(self.x < s ? self.x : s, self.y < s ? self.y : s);
}

/**
 * @godot Vector2.max
 * @source core/math/vector2.h:104
 */
export function max(self: Vector2, p_vector2: Vector2): Vector2 {
  return make(self.x > p_vector2.x ? self.x : p_vector2.x, self.y > p_vector2.y ? self.y : p_vector2.y);
}

/**
 * @godot Vector2.maxf
 * @source core/math/vector2.h:108
 */
export function maxf(self: Vector2, p_scalar: number): Vector2 {
  const s = f32(p_scalar);
  return make(self.x > s ? self.x : s, self.y > s ? self.y : s);
}

/**
 * `Vector2 == Vector2`; against null (the `Variant` right operand) it is false
 * (`OperatorEvaluatorAlwaysFalse`, `core/variant/variant_op.cpp:537`).
 *
 * @godot Vector2.OP_EQUAL
 * @source core/math/vector2.h:267
 */
export function op_equal(left: Vector2, right: Vector2 | null): boolean {
  return right !== null && left.x === right.x && left.y === right.y;
}

/**
 * @godot Vector2.OP_NOT_EQUAL
 * @source core/math/vector2.h:271
 */
export function op_not_equal(left: Vector2, right: Vector2 | null): boolean {
  return !op_equal(left, right);
}

/**
 * @godot Vector2.OP_NEGATE
 * @source core/math/vector2.h:263
 */
export function op_negate(self: Vector2): Vector2 {
  return make(-self.x, -self.y);
}

/**
 * Unary plus returns the value (`OperatorEvaluatorPos`).
 *
 * @godot Vector2.OP_POSITIVE
 * @source core/variant/variant_op.cpp:470
 */
export function op_positive(self: Vector2): Vector2 {
  return self;
}

/**
 * `not v` is `v == Vector2()` (`OperatorEvaluatorNot`, `core/variant/variant_op.h:646`).
 *
 * @godot Vector2.OP_NOT
 * @source core/variant/variant_op.cpp:888
 */
export function op_not(self: Vector2): boolean {
  return self.x === 0 && self.y === 0;
}

/**
 * Lexicographic: `y` decides only when the `x` are equal.
 *
 * @godot Vector2.OP_LESS
 * @source core/math/vector2.h:166
 */
export function op_less(left: Vector2, right: Vector2): boolean {
  return left.x === right.x ? left.y < right.y : left.x < right.x;
}

/**
 * @godot Vector2.OP_GREATER
 * @source core/math/vector2.h:167
 */
export function op_greater(left: Vector2, right: Vector2): boolean {
  return left.x === right.x ? left.y > right.y : left.x > right.x;
}

/**
 * @godot Vector2.OP_LESS_EQUAL
 * @source core/math/vector2.h:168
 */
export function op_less_equal(left: Vector2, right: Vector2): boolean {
  return left.x === right.x ? left.y <= right.y : left.x < right.x;
}

/**
 * @godot Vector2.OP_GREATER_EQUAL
 * @source core/math/vector2.h:169
 */
export function op_greater_equal(left: Vector2, right: Vector2): boolean {
  return left.x === right.x ? left.y >= right.y : left.x > right.x;
}

/** Whether a member of an Array, a PackedVector2Array or a Dictionary's keys is this Vector2. */
function isVector2Equal(value: unknown, v: Vector2): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const other = value as Record<string, unknown>;
  return Object.keys(other).length === 2 && other['x'] === v.x && other['y'] === v.y;
}

/**
 * `v in array` is `array.find(v) != -1` (`OperatorEvaluatorInArrayFind`, also for
 * `PackedVector2Array`); `v in dict` is `dict.has(v)` (`OperatorEvaluatorInDictionaryHas`,
 * `core/variant/variant_op.h:1180`). A Vector2 key is matched by value.
 *
 * @godot Vector2.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Vector2, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isVector2Equal(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isVector2Equal(key, left)) return true;
  return false;
}

/**
 * @godot Vector2.AXIS_X
 * @source core/variant/variant_call.cpp:3146
 */
export const AXIS_X: number = 0;

/**
 * @godot Vector2.AXIS_Y
 * @source core/variant/variant_call.cpp:3147
 */
export const AXIS_Y: number = 1;

/**
 * @godot Vector2.ONE
 * @source core/variant/variant_call.cpp:3153
 */
export const ONE: Vector2 = make(1, 1);

/**
 * @godot Vector2.INF
 * @source core/variant/variant_call.cpp:3154
 */
export const INF: Vector2 = make(Infinity, Infinity);

/**
 * @godot Vector2.LEFT
 * @source core/variant/variant_call.cpp:3155
 */
export const LEFT: Vector2 = make(-1, 0);

/**
 * @godot Vector2.RIGHT
 * @source core/variant/variant_call.cpp:3156
 */
export const RIGHT: Vector2 = make(1, 0);

/**
 * @godot Vector2.UP
 * @source core/variant/variant_call.cpp:3157
 */
export const UP: Vector2 = make(0, -1);

/**
 * @godot Vector2.DOWN
 * @source core/variant/variant_call.cpp:3158
 */
export const DOWN: Vector2 = make(0, 1);
