/**
 * @godot-class Vector3i
 * @role PROTOCOL
 *
 * Godot 4.7's `Vector3i` built-in value, transcribed from `core/math/vector3i.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Components are `int32_t`, held as JS integers.
 */

import { construct as vector3, op_divide as vector3Divide, op_multiply as vector3Multiply, type Vector3 } from './vector3';

export interface Vector3i {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** An `int64_t` argument narrowed to `int32_t` (modulo 2^32). */
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

function make(x: number, y: number, z: number): Vector3i {
  return Object.freeze({ x, y, z });
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:111-114`): no arguments,
 * `from: Vector3i`, `from: Vector3` (`Vector3i(x, y, z)` from `real_t`, `core/math/vector3.cpp:161`),
 * and `x, y, z: int`. One record argument goes through the `real_t` conversion: a `Vector3i`'s
 * components are int32 integers, which that conversion returns unchanged.
 *
 * @godot Vector3i.Vector3i
 * @source core/math/vector3i.h:153
 */
export function construct(
  ...args:
    | readonly []
    | readonly [{ readonly x: number; readonly y: number; readonly z: number }]
    | readonly [number, number, number]
): Vector3i {
  if (args.length === 0) return make(0, 0, 0);
  if (args.length === 1) return make(fromReal(args[0].x), fromReal(args[0].y), fromReal(args[0].z));
  return make(fromInt(args[0]), fromInt(args[1]), fromInt(args[2]));
}

/**
 * `v.x = value` writes `int32_t x` (`core/math/vector3i.h:59`) from a Variant int.
 *
 * @godot Vector3i.x
 * @source core/math/vector3i.h:59
 */
export function with_x(self: Vector3i, value: number): Vector3i {
  return make(fromInt(value), self.y, self.z);
}

/**
 * @godot Vector3i.y
 * @source core/math/vector3i.h:60
 */
export function with_y(self: Vector3i, value: number): Vector3i {
  return make(self.x, fromInt(value), self.z);
}

/**
 * @godot Vector3i.z
 * @source core/math/vector3i.h:61
 */
export function with_z(self: Vector3i, value: number): Vector3i {
  return make(self.x, self.y, fromInt(value));
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
 * `AXIS_X` (0), `AXIS_Y` (1) or `AXIS_Z` (2), whichever component is smallest; ties go to the later axis.
 *
 * @godot Vector3i.min_axis_index
 * @source core/math/vector3i.cpp:36
 */
export function min_axis_index(self: Vector3i): number {
  return self.x < self.y ? (self.x < self.z ? 0 : 2) : self.y < self.z ? 1 : 2;
}

/**
 * @godot Vector3i.max_axis_index
 * @source core/math/vector3i.cpp:40
 */
export function max_axis_index(self: Vector3i): number {
  return self.x < self.y ? (self.y < self.z ? 2 : 1) : self.x < self.z ? 2 : 0;
}

/**
 * An int64, exact here while it stays under 2^53.
 *
 * @godot Vector3i.length_squared
 * @source core/math/vector3i.h:164
 */
export function length_squared(self: Vector3i): number {
  return self.x * self.x + self.y * self.y + self.z * self.z;
}

/**
 * `Math::sqrt((double)length_squared())`: a double.
 *
 * @godot Vector3i.length
 * @source core/math/vector3i.h:168
 */
export function length(self: Vector3i): number {
  return Math.sqrt(length_squared(self));
}

/**
 * @godot Vector3i.distance_to
 * @source core/math/vector3i.h:180
 */
export function distance_to(self: Vector3i, p_to: Vector3i): number {
  return length(op_subtract(p_to, self));
}

/**
 * @godot Vector3i.distance_squared_to
 * @source core/math/vector3i.h:184
 */
export function distance_squared_to(self: Vector3i, p_to: Vector3i): number {
  return length_squared(op_subtract(p_to, self));
}

/**
 * @godot Vector3i.sign
 * @source core/math/vector3i.h:176
 */
export function sign(self: Vector3i): Vector3i {
  return make(signInt(self.x), signInt(self.y), signInt(self.z));
}

/**
 * `Math::abs` on `int32_t`; the absolute value of INT32_MIN wraps to itself.
 *
 * @godot Vector3i.abs
 * @source core/math/vector3i.h:172
 */
export function abs(self: Vector3i): Vector3i {
  return make(Math.abs(self.x) | 0, Math.abs(self.y) | 0, Math.abs(self.z) | 0);
}

/**
 * @godot Vector3i.clamp
 * @source core/math/vector3i.cpp:44
 */
export function clamp(self: Vector3i, p_min: Vector3i, p_max: Vector3i): Vector3i {
  return make(clampInt(self.x, p_min.x, p_max.x), clampInt(self.y, p_min.y, p_max.y), clampInt(self.z, p_min.z, p_max.z));
}

/**
 * @godot Vector3i.clampi
 * @source core/math/vector3i.cpp:51
 */
export function clampi(self: Vector3i, p_min: number, p_max: number): Vector3i {
  const [min, max] = [fromInt(p_min), fromInt(p_max)];
  return make(clampInt(self.x, min, max), clampInt(self.y, min, max), clampInt(self.z, min, max));
}

/**
 * @godot Vector3i.snapped
 * @source core/math/vector3i.cpp:58
 */
export function snapped(self: Vector3i, p_step: Vector3i): Vector3i {
  return make(snappedInt(self.x, p_step.x), snappedInt(self.y, p_step.y), snappedInt(self.z, p_step.z));
}

/**
 * @godot Vector3i.snappedi
 * @source core/math/vector3i.cpp:65
 */
export function snappedi(self: Vector3i, p_step: number): Vector3i {
  const step = fromInt(p_step);
  return make(snappedInt(self.x, step), snappedInt(self.y, step), snappedInt(self.z, step));
}

/**
 * @godot Vector3i.min
 * @source core/math/vector3i.h:81
 */
export function min(self: Vector3i, p_vector3i: Vector3i): Vector3i {
  return make(Math.min(self.x, p_vector3i.x), Math.min(self.y, p_vector3i.y), Math.min(self.z, p_vector3i.z));
}

/**
 * @godot Vector3i.mini
 * @source core/math/vector3i.h:85
 */
export function mini(self: Vector3i, p_scalar: number): Vector3i {
  const s = fromInt(p_scalar);
  return make(Math.min(self.x, s), Math.min(self.y, s), Math.min(self.z, s));
}

/**
 * @godot Vector3i.max
 * @source core/math/vector3i.h:89
 */
export function max(self: Vector3i, p_vector3i: Vector3i): Vector3i {
  return make(Math.max(self.x, p_vector3i.x), Math.max(self.y, p_vector3i.y), Math.max(self.z, p_vector3i.z));
}

/**
 * @godot Vector3i.maxi
 * @source core/math/vector3i.h:93
 */
export function maxi(self: Vector3i, p_scalar: number): Vector3i {
  const s = fromInt(p_scalar);
  return make(Math.max(self.x, s), Math.max(self.y, s), Math.max(self.z, s));
}

/**
 * `int32_t` addition, wrapping.
 *
 * @godot Vector3i.OP_ADD
 * @source core/math/vector3i.h:197
 */
export function op_add(left: Vector3i, right: Vector3i): Vector3i {
  return make((left.x + right.x) | 0, (left.y + right.y) | 0, (left.z + right.z) | 0);
}

/**
 * @godot Vector3i.OP_SUBTRACT
 * @source core/math/vector3i.h:208
 */
export function op_subtract(left: Vector3i, right: Vector3i): Vector3i {
  return make((left.x - right.x) | 0, (left.y - right.y) | 0, (left.z - right.z) | 0);
}

/**
 * `Vector3i * Vector3i` and `Vector3i * int` wrap in `int32_t` (`core/math/vector3i.h:252`);
 * `Vector3i * float` is `Vector3(self) * real_t`, a Vector3 (`core/variant/variant_op.cpp:288`). A JS
 * number is a float here only when it is not an integer or `as_float` says so.
 *
 * @godot Vector3i.OP_MULTIPLY
 * @source core/math/vector3i.h:219
 */
export function op_multiply(left: Vector3i, right: Vector3i | number, as_float = false): Vector3i | Vector3 {
  if (typeof right === 'number') {
    if (as_float || !Number.isInteger(right)) return vector3Multiply(vector3(left.x, left.y, left.z), right);
    const s = fromInt(right);
    return make(Math.imul(left.x, s), Math.imul(left.y, s), Math.imul(left.z, s));
  }
  return make(Math.imul(left.x, right.x), Math.imul(left.y, right.y), Math.imul(left.z, right.z));
}

/**
 * Truncating division; a zero divisor (component) is the script error "Division by zero error"
 * (`OperatorEvaluatorDivNZ`, `core/variant/variant_op.h:181`). `Vector3i / float` is a Vector3
 * (`core/variant/variant_op.cpp:371`).
 *
 * @godot Vector3i.OP_DIVIDE
 * @source core/math/vector3i.h:230
 */
export function op_divide(left: Vector3i, right: Vector3i | number, as_float = false): Vector3i | Vector3 {
  if (typeof right === 'number') {
    if (right === 0) scriptError('Division by zero error');
    if (as_float || !Number.isInteger(right)) return vector3Divide(vector3(left.x, left.y, left.z), right);
    const s = fromInt(right);
    return make((left.x / s) | 0, (left.y / s) | 0, (left.z / s) | 0);
  }
  if (right.x === 0 || right.y === 0 || right.z === 0) scriptError('Division by zero error');
  return make((left.x / right.x) | 0, (left.y / right.y) | 0, (left.z / right.z) | 0);
}

/**
 * C's `%`; a zero divisor (component) is the script error "Modulo by zero error"
 * (`OperatorEvaluatorModNZ`, `core/variant/variant_op.h:288`).
 *
 * @godot Vector3i.OP_MODULE
 * @source core/math/vector3i.h:241
 */
export function op_module(left: Vector3i, right: Vector3i | number): Vector3i {
  if (typeof right === 'number') {
    const s = fromInt(right);
    if (s === 0) scriptError('Modulo by zero error');
    return make((left.x % s) | 0, (left.y % s) | 0, (left.z % s) | 0);
  }
  if (right.x === 0 || right.y === 0 || right.z === 0) scriptError('Modulo by zero error');
  return make((left.x % right.x) | 0, (left.y % right.y) | 0, (left.z % right.z) | 0);
}

/**
 * @godot Vector3i.OP_NEGATE
 * @source core/math/vector3i.h:296
 */
export function op_negate(self: Vector3i): Vector3i {
  return make(-self.x | 0, -self.y | 0, -self.z | 0);
}

/**
 * @godot Vector3i.OP_POSITIVE
 * @source core/variant/variant_op.cpp:473
 */
export function op_positive(self: Vector3i): Vector3i {
  return self;
}

/**
 * `v == Vector3i()`.
 *
 * @godot Vector3i.OP_NOT
 * @source core/variant/variant_op.cpp:893
 */
export function op_not(self: Vector3i): boolean {
  return self.x === 0 && self.y === 0 && self.z === 0;
}

/**
 * Against null (the `Variant` right operand) it is false (`core/variant/variant_op.cpp:542`).
 *
 * @godot Vector3i.OP_EQUAL
 * @source core/math/vector3i.h:300
 */
export function op_equal(left: Vector3i, right: Vector3i | null): boolean {
  return right !== null && left.x === right.x && left.y === right.y && left.z === right.z;
}

/**
 * @godot Vector3i.OP_NOT_EQUAL
 * @source core/math/vector3i.h:304
 */
export function op_not_equal(left: Vector3i, right: Vector3i | null): boolean {
  return !op_equal(left, right);
}

/**
 * Lexicographic over x, y, z.
 *
 * @godot Vector3i.OP_LESS
 * @source core/math/vector3i.h:308
 */
export function op_less(left: Vector3i, right: Vector3i): boolean {
  if (left.x === right.x) return left.y === right.y ? left.z < right.z : left.y < right.y;
  return left.x < right.x;
}

/**
 * @godot Vector3i.OP_GREATER
 * @source core/math/vector3i.h:320
 */
export function op_greater(left: Vector3i, right: Vector3i): boolean {
  if (left.x === right.x) return left.y === right.y ? left.z > right.z : left.y > right.y;
  return left.x > right.x;
}

/**
 * @godot Vector3i.OP_LESS_EQUAL
 * @source core/math/vector3i.h:332
 */
export function op_less_equal(left: Vector3i, right: Vector3i): boolean {
  if (left.x === right.x) return left.y === right.y ? left.z <= right.z : left.y < right.y;
  return left.x < right.x;
}

/**
 * @godot Vector3i.OP_GREATER_EQUAL
 * @source core/math/vector3i.h:344
 */
export function op_greater_equal(left: Vector3i, right: Vector3i): boolean {
  if (left.x === right.x) return left.y === right.y ? left.z >= right.z : left.y > right.y;
  return left.x > right.x;
}

/** Whether an Array element or a Dictionary key is this Vector3i. */
function isVector3iEqual(value: unknown, v: Vector3i): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const other = value as Record<string, unknown>;
  return Object.keys(other).length === 3 && other['x'] === v.x && other['y'] === v.y && other['z'] === v.z;
}

/**
 * `v in array` is `array.find(v) != -1`; `v in dict` is `dict.has(v)`
 * (`core/variant/variant_op.h:1180`). A Vector3i key is matched by value.
 *
 * @godot Vector3i.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Vector3i, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isVector3iEqual(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isVector3iEqual(key, left)) return true;
  return false;
}
