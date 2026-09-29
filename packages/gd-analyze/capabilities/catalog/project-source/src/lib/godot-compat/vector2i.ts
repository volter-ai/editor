/**
 * @godot-class Vector2i
 * @role PROTOCOL
 *
 * Godot 4.7's `Vector2i` built-in value, transcribed from `core/math/vector2i.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Components are `int32_t`, held as JS integers.
 */

import { construct as vector2, op_divide as vector2Divide, op_multiply as vector2Multiply, type Vector2 } from './vector2';

export interface Vector2i {
  readonly x: number;
  readonly y: number;
}

/**
 * An `int64_t` argument narrowed to `int32_t` (modulo 2^32). A Variant int is exact in JS only
 * inside the safe range, which is where lowering admits integer values.
 */
function fromInt(value: number): number {
  return value | 0;
}

/**
 * A `real_t` component converted to `int32_t` by the arm64 `fcvtzs` the official macOS build
 * executes: truncation toward zero, saturating at the int32 limits, NaN to 0.
 */
function fromReal(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value >= 2147483647) return 2147483647;
  if (value <= -2147483648) return -2147483648;
  return Math.trunc(value) | 0;
}

function make(x: number, y: number): Vector2i {
  return Object.freeze({ x, y });
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:89-92`): no arguments,
 * `from: Vector2i`, `from: Vector2` (`Vector2i(x, y)` from `real_t`, `core/math/vector2.cpp:223`),
 * and `x, y: int`. One record argument goes through the `real_t` conversion: a `Vector2i`'s
 * components are int32 integers, which that conversion returns unchanged.
 *
 * @godot Vector2i.Vector2i
 * @source core/math/vector2i.h:160
 */
export function construct(
  ...args: readonly [] | readonly [{ readonly x: number; readonly y: number }] | readonly [number, number]
): Vector2i {
  if (args.length === 0) return make(0, 0);
  if (args.length === 1) return make(fromReal(args[0].x), fromReal(args[0].y));
  return make(fromInt(args[0]), fromInt(args[1]));
}

/**
 * @godot Vector2i.OP_NOT_EQUAL
 * @source core/math/vector2i.h:235
 */
export function op_not_equal(left: Vector2i, right: Vector2i): boolean {
  return left.x !== right.x || left.y !== right.y;
}

/**
 * `v.x = value` writes `int32_t x` (`core/math/vector2i.h:56`) from a Variant int.
 *
 * @godot Vector2i.x
 * @source core/math/vector2i.h:56
 */
export function with_x(self: Vector2i, value: number): Vector2i {
  return make(fromInt(value), self.y);
}

/**
 * @godot Vector2i.y
 * @source core/math/vector2i.h:57
 */
export function with_y(self: Vector2i, value: number): Vector2i {
  return make(self.x, fromInt(value));
}

/** `SIGN` (`core/typedefs.h:137`) converted back to `int32_t`. */
function signInt(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/** `CLAMP` (`core/typedefs.h:152`). */
function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** `Math::snapped(double, double)` (`core/math/math_funcs.cpp:121`), converted to `int32_t`. */
function snappedInt(value: number, step: number): number {
  return fromReal(step !== 0 ? Math.floor(value / step + 0.5) * step : value);
}

/** A script error that aborts the calling function (`r_valid = false` with its message). */
function scriptError(message: string): never {
  throw new Error(`godot-compat: ${message}`);
}

/**
 * `AXIS_Y` (1) when `x < y`, else `AXIS_X` (0).
 *
 * @godot Vector2i.max_axis_index
 * @source core/math/vector2i.h:82
 */
export function max_axis_index(self: Vector2i): number {
  return self.x < self.y ? 1 : 0;
}

/**
 * @godot Vector2i.min_axis_index
 * @source core/math/vector2i.h:78
 */
export function min_axis_index(self: Vector2i): number {
  return self.x < self.y ? 0 : 1;
}

/**
 * `x * (int64_t)x + y * (int64_t)y`: an int64, exact here while it stays under 2^53.
 *
 * @godot Vector2i.length_squared
 * @source core/math/vector2i.cpp:60
 */
export function length_squared(self: Vector2i): number {
  return self.x * self.x + self.y * self.y;
}

/**
 * `Math::sqrt((double)length_squared())`: a double.
 *
 * @godot Vector2i.length
 * @source core/math/vector2i.cpp:64
 */
export function length(self: Vector2i): number {
  return Math.sqrt(length_squared(self));
}

/**
 * @godot Vector2i.distance_to
 * @source core/math/vector2i.h:102
 */
export function distance_to(self: Vector2i, p_to: Vector2i): number {
  return length(op_subtract(p_to, self));
}

/**
 * @godot Vector2i.distance_squared_to
 * @source core/math/vector2i.h:106
 */
export function distance_squared_to(self: Vector2i, p_to: Vector2i): number {
  return length_squared(op_subtract(p_to, self));
}

/**
 * `width / (real_t)height`, a `real_t`.
 *
 * @godot Vector2i.aspect
 * @source core/math/vector2i.h:140
 */
export function aspect(self: Vector2i): number {
  return Math.fround(Math.fround(self.x) / Math.fround(self.y));
}

/**
 * @godot Vector2i.sign
 * @source core/math/vector2i.h:141
 */
export function sign(self: Vector2i): Vector2i {
  return make(signInt(self.x), signInt(self.y));
}

/**
 * `Math::abs` on `int32_t`; the absolute value of INT32_MIN wraps to itself.
 *
 * @godot Vector2i.abs
 * @source core/math/vector2i.h:142
 */
export function abs(self: Vector2i): Vector2i {
  return make(Math.abs(self.x) | 0, Math.abs(self.y) | 0);
}

/**
 * @godot Vector2i.clamp
 * @source core/math/vector2i.cpp:36
 */
export function clamp(self: Vector2i, p_min: Vector2i, p_max: Vector2i): Vector2i {
  return make(clampInt(self.x, p_min.x, p_max.x), clampInt(self.y, p_min.y, p_max.y));
}

/**
 * @godot Vector2i.clampi
 * @source core/math/vector2i.cpp:42
 */
export function clampi(self: Vector2i, p_min: number, p_max: number): Vector2i {
  const [min, max] = [fromInt(p_min), fromInt(p_max)];
  return make(clampInt(self.x, min, max), clampInt(self.y, min, max));
}

/**
 * @godot Vector2i.snapped
 * @source core/math/vector2i.cpp:48
 */
export function snapped(self: Vector2i, p_step: Vector2i): Vector2i {
  return make(snappedInt(self.x, p_step.x), snappedInt(self.y, p_step.y));
}

/**
 * @godot Vector2i.snappedi
 * @source core/math/vector2i.cpp:54
 */
export function snappedi(self: Vector2i, p_step: number): Vector2i {
  const step = fromInt(p_step);
  return make(snappedInt(self.x, step), snappedInt(self.y, step));
}

/**
 * @godot Vector2i.min
 * @source core/math/vector2i.h:86
 */
export function min(self: Vector2i, p_vector2i: Vector2i): Vector2i {
  return make(Math.min(self.x, p_vector2i.x), Math.min(self.y, p_vector2i.y));
}

/**
 * @godot Vector2i.mini
 * @source core/math/vector2i.h:90
 */
export function mini(self: Vector2i, p_scalar: number): Vector2i {
  const s = fromInt(p_scalar);
  return make(Math.min(self.x, s), Math.min(self.y, s));
}

/**
 * @godot Vector2i.max
 * @source core/math/vector2i.h:94
 */
export function max(self: Vector2i, p_vector2i: Vector2i): Vector2i {
  return make(Math.max(self.x, p_vector2i.x), Math.max(self.y, p_vector2i.y));
}

/**
 * @godot Vector2i.maxi
 * @source core/math/vector2i.h:98
 */
export function maxi(self: Vector2i, p_scalar: number): Vector2i {
  const s = fromInt(p_scalar);
  return make(Math.max(self.x, s), Math.max(self.y, s));
}

/**
 * `int32_t` addition, wrapping.
 *
 * @godot Vector2i.OP_ADD
 * @source core/math/vector2i.h:170
 */
export function op_add(left: Vector2i, right: Vector2i): Vector2i {
  return make((left.x + right.x) | 0, (left.y + right.y) | 0);
}

/**
 * @godot Vector2i.OP_SUBTRACT
 * @source core/math/vector2i.h:179
 */
export function op_subtract(left: Vector2i, right: Vector2i): Vector2i {
  return make((left.x - right.x) | 0, (left.y - right.y) | 0);
}

/**
 * `Vector2i * Vector2i` and `Vector2i * int` (the int narrowed to `int32_t`) wrap in `int32_t`
 * (`core/math/vector2i.h:192`); `Vector2i * float` is `Vector2(self) * real_t`, a Vector2
 * (`OperatorEvaluatorMul<Vector2, Vector2i, double>`, `core/variant/variant_op.cpp:280`). A JS
 * number is a float here only when it is not an integer: lowering passes the static type's
 * choice through `as_float`.
 *
 * @godot Vector2i.OP_MULTIPLY
 * @source core/math/vector2i.h:188
 */
export function op_multiply(left: Vector2i, right: Vector2i | number, as_float = false): Vector2i | Vector2 {
  if (typeof right === 'number') {
    if (as_float || !Number.isInteger(right)) return vector2Multiply(vector2(left.x, left.y), right);
    const s = fromInt(right);
    return make(Math.imul(left.x, s), Math.imul(left.y, s));
  }
  return make(Math.imul(left.x, right.x), Math.imul(left.y, right.y));
}

/**
 * `Vector2i / Vector2i` and `Vector2i / int` truncate toward zero; a zero divisor component is the
 * script error "Division by zero error" (`OperatorEvaluatorDivNZ`, `core/variant/variant_op.h:157`).
 * `Vector2i / float` is `Vector2(self) / real_t`, a Vector2 (`core/variant/variant_op.cpp:363`).
 *
 * @godot Vector2i.OP_DIVIDE
 * @source core/math/vector2i.h:201
 */
export function op_divide(left: Vector2i, right: Vector2i | number, as_float = false): Vector2i | Vector2 {
  if (typeof right === 'number') {
    if (right === 0) scriptError('Division by zero error');
    if (as_float || !Number.isInteger(right)) return vector2Divide(vector2(left.x, left.y), right);
    const s = fromInt(right);
    return make((left.x / s) | 0, (left.y / s) | 0);
  }
  if (right.x === 0 || right.y === 0) scriptError('Division by zero error');
  return make((left.x / right.x) | 0, (left.y / right.y) | 0);
}

/**
 * C's `%` (the sign of the dividend); a zero divisor component is the script error "Modulo by zero
 * error" (`OperatorEvaluatorModNZ`, `core/variant/variant_op.h:264`).
 *
 * @godot Vector2i.OP_MODULE
 * @source core/math/vector2i.h:214
 */
export function op_module(left: Vector2i, right: Vector2i | number): Vector2i {
  if (typeof right === 'number') {
    const s = fromInt(right);
    if (s === 0) scriptError('Modulo by zero error');
    return make((left.x % s) | 0, (left.y % s) | 0);
  }
  if (right.x === 0 || right.y === 0) scriptError('Modulo by zero error');
  return make((left.x % right.x) | 0, (left.y % right.y) | 0);
}

/**
 * @godot Vector2i.OP_NEGATE
 * @source core/math/vector2i.h:227
 */
export function op_negate(self: Vector2i): Vector2i {
  return make(-self.x | 0, -self.y | 0);
}

/**
 * @godot Vector2i.OP_POSITIVE
 * @source core/variant/variant_op.cpp:471
 */
export function op_positive(self: Vector2i): Vector2i {
  return self;
}

/**
 * `v == Vector2i()`.
 *
 * @godot Vector2i.OP_NOT
 * @source core/variant/variant_op.cpp:889
 */
export function op_not(self: Vector2i): boolean {
  return self.x === 0 && self.y === 0;
}

/**
 * Against null (the `Variant` right operand) it is false (`core/variant/variant_op.cpp:538`).
 *
 * @godot Vector2i.OP_EQUAL
 * @source core/math/vector2i.h:231
 */
export function op_equal(left: Vector2i, right: Vector2i | null): boolean {
  return right !== null && left.x === right.x && left.y === right.y;
}

/**
 * @godot Vector2i.OP_LESS
 * @source core/math/vector2i.h:128
 */
export function op_less(left: Vector2i, right: Vector2i): boolean {
  return left.x === right.x ? left.y < right.y : left.x < right.x;
}

/**
 * @godot Vector2i.OP_GREATER
 * @source core/math/vector2i.h:129
 */
export function op_greater(left: Vector2i, right: Vector2i): boolean {
  return left.x === right.x ? left.y > right.y : left.x > right.x;
}

/**
 * @godot Vector2i.OP_LESS_EQUAL
 * @source core/math/vector2i.h:131
 */
export function op_less_equal(left: Vector2i, right: Vector2i): boolean {
  return left.x === right.x ? left.y <= right.y : left.x < right.x;
}

/**
 * @godot Vector2i.OP_GREATER_EQUAL
 * @source core/math/vector2i.h:132
 */
export function op_greater_equal(left: Vector2i, right: Vector2i): boolean {
  return left.x === right.x ? left.y >= right.y : left.x > right.x;
}

/** Whether an Array element or a Dictionary key is this Vector2i. */
function isVector2iEqual(value: unknown, v: Vector2i): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const other = value as Record<string, unknown>;
  return Object.keys(other).length === 2 && other.x === v.x && other.y === v.y;
}

/**
 * `v in array` is `array.find(v) != -1`; `v in dict` is `dict.has(v)`
 * (`core/variant/variant_op.h:1180`). A Vector2i key is matched by value.
 *
 * @godot Vector2i.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Vector2i, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isVector2iEqual(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isVector2iEqual(key, left)) return true;
  return false;
}
