/**
 * @godot-class Vector3i
 * @role PROTOCOL
 *
 * Godot 4.7's `Vector3i` built-in value, transcribed from `core/math/vector3i.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Components are `int32_t`, held as JS integers.
 */

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
