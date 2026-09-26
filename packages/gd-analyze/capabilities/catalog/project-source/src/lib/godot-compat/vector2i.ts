/**
 * @godot-class Vector2i
 * @role PROTOCOL
 *
 * Godot 4.7's `Vector2i` built-in value, transcribed from `core/math/vector2i.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Components are `int32_t`, held as JS integers.
 */

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
