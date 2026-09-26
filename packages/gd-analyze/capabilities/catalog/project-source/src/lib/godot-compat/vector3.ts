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

/**
 * `Vector3 * Vector3` (`core/math/vector3.h:416`) and `Vector3 * real_t` (`core/math/vector3.h:457`);
 * a Variant `float` or `int` right operand converts to `real_t` first (`core/variant/variant_op.cpp:283`).
 *
 * @godot Vector3.OP_MULTIPLY
 * @source core/math/vector3.h:416
 */
export function op_multiply(left: Vector3, right: Vector3 | number): Vector3 {
  if (typeof right === 'number') {
    const scalar = f32(right);
    return make(f32(left.x * scalar), f32(left.y * scalar), f32(left.z * scalar));
  }
  return make(f32(left.x * right.x), f32(left.y * right.y), f32(left.z * right.z));
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
 * @godot Vector3.OP_EQUAL
 * @source core/math/vector3.h:476
 */
export function op_equal(left: Vector3, right: Vector3): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
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
