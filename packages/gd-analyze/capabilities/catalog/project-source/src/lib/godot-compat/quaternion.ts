/**
 * @godot-class Quaternion
 * @role PROTOCOL
 *
 * Godot 4.7's `Quaternion` built-in value (`core/math/quaternion.h`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): four `real_t` components, 32-bit, rounded with
 * `Math.fround`. Construction and the arithmetic animation blending runs (`*`, `inverse`,
 * `normalized`, `dot`, `length`, `slerp`) are transcribed; `float` library calls are the double
 * result rounded to float.
 */

const f32 = Math.fround;

export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

function make(x: number, y: number, z: number, w: number): Quaternion {
  return Object.freeze({ x: f32(x), y: f32(y), z: f32(z), w: f32(w) });
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:140-145`) with no arguments (the
 * identity, `quaternion.h:120`), `from: Quaternion` and `x, y, z, w`. The Basis, axis-angle and
 * arc constructors are not transcribed.
 *
 * @godot Quaternion.Quaternion
 * @source core/math/quaternion.h:123
 */
export function construct(...args: readonly [] | readonly [Quaternion] | readonly [number, number, number, number]): Quaternion {
  if (args.length === 0) return make(0, 0, 0, 1);
  if (args.length === 1) return make(args[0].x, args[0].y, args[0].z, args[0].w);
  return make(args[0], args[1], args[2], args[3]);
}

/**
 * @godot Quaternion.dot
 * @source core/math/quaternion.h:173
 */
export function dot(self: Quaternion, with_: Quaternion): number {
  return f32(f32(f32(f32(self.x * with_.x) + f32(self.y * with_.y)) + f32(self.z * with_.z)) + f32(self.w * with_.w));
}

/**
 * @godot Quaternion.length_squared
 * @source core/math/quaternion.h:177
 */
export function length_squared(self: Quaternion): number {
  return dot(self, self);
}

/**
 * @godot Quaternion.length
 * @source core/math/quaternion.cpp:61
 */
export function length(self: Quaternion): number {
  return f32(Math.sqrt(length_squared(self)));
}

/** `q * s` (`quaternion.h:221`). */
function scaled(q: Quaternion, s: number): Quaternion {
  return make(f32(q.x * s), f32(q.y * s), f32(q.z * s), f32(q.w * s));
}

/**
 * `*this / length()`, which multiplies by `1 / length` (`quaternion.h:225`).
 *
 * @godot Quaternion.normalized
 * @source core/math/quaternion.cpp:74
 */
export function normalized(self: Quaternion): Quaternion {
  return scaled(self, f32(1 / length(self)));
}

/**
 * `length_squared` within `UNIT_EPSILON` of 1 (`quaternion.cpp:78`).
 *
 * @godot Quaternion.is_normalized
 * @source core/math/quaternion.cpp:78
 */
export function is_normalized(self: Quaternion): boolean {
  const l2 = length_squared(self);
  return l2 === 1 || Math.abs(f32(l2 - 1)) < f32(0.001);
}

/**
 * A quaternion that is not normalized is an error that returns the identity (the official
 * build's `MATH_CHECKS`).
 *
 * @godot Quaternion.inverse
 * @source core/math/quaternion.cpp:82
 */
export function inverse(self: Quaternion): Quaternion {
  if (!is_normalized(self)) return make(0, 0, 0, 1);
  return make(-self.x, -self.y, -self.z, self.w);
}

/**
 * @godot Quaternion.OP_MULTIPLY
 * @source core/math/quaternion.h:237
 */
export function op_multiply(left: Quaternion, right: Quaternion): Quaternion {
  const xx = f32(f32(f32(f32(left.w * right.x) + f32(left.x * right.w)) + f32(left.y * right.z)) - f32(left.z * right.y));
  const yy = f32(f32(f32(f32(left.w * right.y) + f32(left.y * right.w)) + f32(left.z * right.x)) - f32(left.x * right.z));
  const zz = f32(f32(f32(f32(left.w * right.z) + f32(left.z * right.w)) + f32(left.x * right.y)) - f32(left.y * right.x));
  const ww = f32(f32(f32(f32(left.w * right.w) - f32(left.x * right.x)) - f32(left.y * right.y)) - f32(left.z * right.z));
  return make(xx, yy, zz, ww);
}

/**
 * The shortest arc, linear when the two are within `CMP_EPSILON` (`quaternion.cpp:106`). Its
 * `acosf`/`sinf` are the platform C library's, which is within one float ulp of the correctly
 * rounded result this takes (measured: `float32-ulp`).
 *
 * @godot Quaternion.slerp
 * @source core/math/quaternion.cpp:106
 */
export function slerp(self: Quaternion, to: Quaternion, weight: number): Quaternion {
  const w = f32(weight);
  let cosom = dot(self, to);
  let to1 = to;
  if (cosom < 0) {
    cosom = -cosom;
    to1 = make(-to.x, -to.y, -to.z, -to.w);
  }
  let scale0: number;
  let scale1: number;
  if (f32(1 - cosom) > f32(0.00001)) {
    const omega = f32(Math.acos(cosom));
    const sinom = f32(Math.sin(omega));
    scale0 = f32(Math.sin((1 - w) * omega) / sinom);
    scale1 = f32(f32(Math.sin(f32(w * omega))) / sinom);
  } else {
    scale0 = f32(1 - w);
    scale1 = w;
  }
  return make(
    f32(f32(scale0 * self.x) + f32(scale1 * to1.x)),
    f32(f32(scale0 * self.y) + f32(scale1 * to1.y)),
    f32(f32(scale0 * self.z) + f32(scale1 * to1.z)),
    f32(f32(scale0 * self.w) + f32(scale1 * to1.w)),
  );
}
