/**
 * @godot-class Vector2
 * @role PROTOCOL
 *
 * Godot 4.7's `Vector2` built-in value, transcribed from `core/math/vector2.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. The pinned build stores `real_t` as a 32-bit float,
 * so every component and every `real_t` intermediate is rounded with `Math.fround` exactly where
 * the C++ rounds it; no multiply-add is fused (`-ffp-contract=off`, `platform/macos/detect.py:118`).
 */

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
 * a Variant `float` or `int` right operand converts to `real_t` first.
 *
 * @godot Vector2.OP_MULTIPLY
 * @source core/math/vector2.h:237
 */
export function op_multiply(left: Vector2, right: Vector2 | number): Vector2 {
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
