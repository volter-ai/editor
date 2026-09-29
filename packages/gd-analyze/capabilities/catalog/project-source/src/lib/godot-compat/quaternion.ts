/**
 * @godot-class Quaternion
 * @role PROTOCOL
 *
 * Godot 4.7's `Quaternion` built-in value (`core/math/quaternion.h`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): four `real_t` components, 32-bit, rounded with
 * `Math.fround`; `float` library calls are the double result rounded to float. The members that
 * go through a `Basis` (`get_euler`, the spherical cubic interpolations) use `basis.ts`.
 */

import {
  get_euler as basisGetEuler,
  get_rotation_quaternion as basisGetRotationQuaternion,
  godot_basis_from_quaternion,
} from './basis';
import type { Vector3 } from './vector3';

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
 * `Quaternion * Quaternion` is the Hamilton product (`core/math/quaternion.h:237`).
 * `Quaternion * Vector3` is `xform` (`core/math/quaternion.h:92`): under `MATH_CHECKS` a quaternion
 * that is not normalized returns the vector unchanged. `Quaternion * float` scales every component
 * (`core/math/quaternion.h:221`).
 *
 * @godot Quaternion.OP_MULTIPLY
 * @source core/math/quaternion.h:237
 */
export function op_multiply(left: Quaternion, right: Quaternion): Quaternion;
export function op_multiply(left: Quaternion, right: Vector3): Vector3;
export function op_multiply(left: Quaternion, right: number): Quaternion;
export function op_multiply(left: Quaternion, right: Quaternion | Vector3 | number): Quaternion | Vector3 {
  if (typeof right === 'number') return scaled(left, f32(right));
  if (!('w' in right)) return xform(left, right);
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

/** `(float)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

/** A frozen `Vector3` record, as `vector3.ts` makes it. */
function vec3(x: number, y: number, z: number): Vector3 {
  return Object.freeze({ x: f32(x), y: f32(y), z: f32(z) });
}

/** `Vector3::cross` (`core/math/vector3.h:243`). */
function cross3(a: Vector3, b: Vector3): Vector3 {
  return vec3(f32(f32(a.y * b.z) - f32(a.z * b.y)), f32(f32(a.z * b.x) - f32(a.x * b.z)), f32(f32(a.x * b.y) - f32(a.y * b.x)));
}

/** `Quaternion::xform` (`core/math/quaternion.h:92`): `v + ((u x v) * w + u x (u x v)) * 2`. */
function xform(q: Quaternion, v: Vector3): Vector3 {
  if (!is_normalized(q)) return v;
  const u = vec3(q.x, q.y, q.z);
  const uv = cross3(u, v);
  const uuv = cross3(u, uv);
  return vec3(
    f32(v.x + f32(f32(f32(uv.x * q.w) + uuv.x) * 2)),
    f32(v.y + f32(f32(f32(uv.y * q.w) + uuv.y) * 2)),
    f32(v.z + f32(f32(f32(uv.z * q.w) + uuv.z) * 2)),
  );
}

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function isEqualApproxReal(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(CMP_EPSILON * Math.abs(left));
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(f32(left - right)) < tolerance;
}

/** `Quaternion(axis, angle)` (`core/math/quaternion.cpp:288`); a zero axis gives (0, 0, 0, 0). */
function fromAxisAngle(axis: Vector3, angle: number): Quaternion {
  const d = f32(Math.sqrt(f32(f32(f32(axis.x * axis.x) + f32(axis.y * axis.y)) + f32(axis.z * axis.z))));
  if (d === 0) return make(0, 0, 0, 0);
  const half = f32(f32(angle) * 0.5);
  const s = f32(f32(Math.sin(half)) / d);
  return make(f32(axis.x * s), f32(axis.y * s), f32(axis.z * s), f32(Math.cos(half)));
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

/** `Math::lerp(float, float, float)` (`core/math/math_funcs.h:338`). */
function lerpReal(from: number, to: number, weight: number): number {
  return f32(from + f32(f32(to - from) * weight));
}

/** `Math::cubic_interpolate_in_time(float, ...)`, the Barry-Goldman method (`core/math/math_funcs.h:398`). */
function cubicInTimeReal(from: number, to: number, pre: number, post: number, weight: number, to_t: number, pre_t: number, post_t: number): number {
  const t = lerpReal(0, to_t, weight);
  const a1 = lerpReal(pre, from, pre_t === 0 ? 0 : f32(f32(t - pre_t) / -pre_t));
  const a2 = lerpReal(from, to, to_t === 0 ? 0.5 : f32(t / to_t));
  const a3 = lerpReal(to, post, f32(post_t - to_t) === 0 ? 1 : f32(f32(t - to_t) / f32(post_t - to_t)));
  const b1 = lerpReal(a1, a2, f32(to_t - pre_t) === 0 ? 0 : f32(f32(t - pre_t) / f32(to_t - pre_t)));
  const b2 = lerpReal(a2, a3, post_t === 0 ? 1 : f32(t / post_t));
  return lerpReal(b1, b2, to_t === 0 ? 0.5 : f32(t / to_t));
}

/**
 * @godot Quaternion.is_equal_approx
 * @source core/math/quaternion.cpp:49
 */
export function is_equal_approx(self: Quaternion, p_to: Quaternion): boolean {
  return isEqualApproxReal(self.x, p_to.x) && isEqualApproxReal(self.y, p_to.y) && isEqualApproxReal(self.z, p_to.z) && isEqualApproxReal(self.w, p_to.w);
}

/**
 * @godot Quaternion.is_finite
 * @source core/math/quaternion.cpp:57
 */
export function is_finite(self: Quaternion): boolean {
  return Number.isFinite(self.x) && Number.isFinite(self.y) && Number.isFinite(self.z) && Number.isFinite(self.w);
}

/**
 * The rotation axis: the vector part, divided by `sqrt(1 - w^2)` unless `|w|` is within
 * `CMP_EPSILON` of 1.
 *
 * @godot Quaternion.get_axis
 * @source core/math/quaternion.cpp:276
 */
export function get_axis(self: Quaternion): Vector3 {
  if (Math.abs(self.w) > f32(1 - CMP_EPSILON)) return vec3(self.x, self.y, self.z);
  const r = f32(1 / f32(Math.sqrt(f32(1 - f32(self.w * self.w)))));
  return vec3(f32(self.x * r), f32(self.y * r), f32(self.z * r));
}

/**
 * `2 * acos(w)`.
 *
 * @godot Quaternion.get_angle
 * @source core/math/quaternion.cpp:284
 */
export function get_angle(self: Quaternion): number {
  return f32(2 * f32(Math.acos(self.w)));
}

/**
 * `(axis * angle, 0)`.
 *
 * @godot Quaternion.log
 * @source core/math/quaternion.cpp:89
 */
export function log(self: Quaternion): Quaternion {
  const axis = get_axis(self);
  const angle = get_angle(self);
  return make(f32(axis.x * angle), f32(axis.y * angle), f32(axis.z * angle), 0);
}

/**
 * The rotation about the vector part's direction by its length; a length under `CMP_EPSILON` (or a
 * direction that does not normalize) is the identity.
 *
 * @godot Quaternion.exp
 * @source core/math/quaternion.cpp:95
 */
export function exp(self: Quaternion): Quaternion {
  const theta = f32(Math.sqrt(f32(f32(f32(self.x * self.x) + f32(self.y * self.y)) + f32(self.z * self.z))));
  if (theta < CMP_EPSILON || !Number.isFinite(theta)) return make(0, 0, 0, 1);
  const axis = vec3(f32(self.x / theta), f32(self.y / theta), f32(self.z / theta));
  const l2 = f32(f32(f32(axis.x * axis.x) + f32(axis.y * axis.y)) + f32(axis.z * axis.z));
  if (!(l2 === 1 || Math.abs(f32(l2 - 1)) < f32(0.001))) return make(0, 0, 0, 1);
  return fromAxisAngle(axis, theta);
}

/**
 * `acos(2 d^2 - 1)` of the dot product `d`.
 *
 * @godot Quaternion.angle_to
 * @source core/math/quaternion.cpp:36
 */
export function angle_to(self: Quaternion, p_to: Quaternion): number {
  const d = dot(self, p_to);
  return f32(Math.acos(f32(f32(f32(d * d) * 2) - 1)));
}

/**
 * Spherical interpolation without taking the shorter path; within `0.9999` of parallel it returns
 * the start. Under `MATH_CHECKS` an end that is not normalized is an error that returns the identity.
 *
 * @godot Quaternion.slerpni
 * @source core/math/quaternion.cpp:147
 */
export function slerpni(self: Quaternion, p_to: Quaternion, p_weight: number): Quaternion {
  if (!is_normalized(self) || !is_normalized(p_to)) return make(0, 0, 0, 1);
  const weight = f32(p_weight);
  const d = dot(self, p_to);
  if (Math.abs(d) > f32(0.9999)) return self;
  const theta = f32(Math.acos(d));
  const sinT = f32(1 / f32(Math.sin(theta)));
  const newFactor = f32(f32(Math.sin(f32(weight * theta))) * sinT);
  const invFactor = f32(f32(Math.sin(f32(f32(1 - weight) * theta))) * sinT);
  return make(
    f32(f32(invFactor * self.x) + f32(newFactor * p_to.x)),
    f32(f32(invFactor * self.y) + f32(newFactor * p_to.y)),
    f32(f32(invFactor * self.z) + f32(newFactor * p_to.z)),
    f32(f32(invFactor * self.w) + f32(newFactor * p_to.w)),
  );
}

/** A quaternion's rotation part (`Basis(q).get_rotation_quaternion()`). */
function rotationOf(q: Quaternion): Quaternion {
  return basisGetRotationQuaternion(godot_basis_from_quaternion(q));
}

/**
 * The shared body of `spherical_cubic_interpolate` and its in-time form: the four rotations aligned
 * to one hemisphere, their logs relative to the start and to the end interpolated by `interpolate`,
 * and the two results slerped. Under `MATH_CHECKS` a start or end that is not normalized is an error
 * that returns the identity.
 */
function sphericalCubic(
  self: Quaternion,
  p_b: Quaternion,
  p_pre_a: Quaternion,
  p_post_b: Quaternion,
  weight: number,
  interpolate: (from: number, to: number, pre: number, post: number) => number,
): Quaternion {
  if (!is_normalized(self) || !is_normalized(p_b)) return make(0, 0, 0, 1);
  const fromQ = rotationOf(self);
  let preQ = rotationOf(p_pre_a);
  let toQ = rotationOf(p_b);
  let postQ = rotationOf(p_post_b);
  const signbit = (value: number): boolean => value < 0 || Object.is(value, -0);
  if (signbit(dot(fromQ, preQ))) preQ = op_negate(preQ);
  const flip2 = signbit(dot(fromQ, toQ));
  if (flip2) toQ = op_negate(toQ);
  const flip3 = flip2 ? dot(toQ, postQ) <= 0 : signbit(dot(toQ, postQ));
  if (flip3) postQ = op_negate(postQ);
  const lnOf = (base: Quaternion, q: Quaternion): Quaternion => log(op_multiply(inverse(base), q));
  const zero = make(0, 0, 0, 0);
  const blend = (lnFrom: Quaternion, lnTo: Quaternion, lnPre: Quaternion, lnPost: Quaternion): Quaternion =>
    make(
      interpolate(lnFrom.x, lnTo.x, lnPre.x, lnPost.x),
      interpolate(lnFrom.y, lnTo.y, lnPre.y, lnPost.y),
      interpolate(lnFrom.z, lnTo.z, lnPre.z, lnPost.z),
      0,
    );
  const q1 = op_multiply(fromQ, exp(blend(zero, lnOf(fromQ, toQ), lnOf(fromQ, preQ), lnOf(fromQ, postQ))));
  const q2 = op_multiply(toQ, exp(blend(lnOf(toQ, fromQ), zero, lnOf(toQ, preQ), lnOf(toQ, postQ))));
  return slerp(q1, q2, weight);
}

/**
 * Spherical cubic interpolation through `pre_a`, this, `b` and `post_b` (the logarithmic-space
 * blend of `Math::cubic_interpolate`, then a slerp between the two sided results).
 *
 * @godot Quaternion.spherical_cubic_interpolate
 * @source core/math/quaternion.cpp:171
 */
export function spherical_cubic_interpolate(self: Quaternion, p_b: Quaternion, p_pre_a: Quaternion, p_post_b: Quaternion, p_weight: number): Quaternion {
  const weight = f32(p_weight);
  return sphericalCubic(self, p_b, p_pre_a, p_post_b, weight, (from, to, pre, post) => cubicReal(from, to, pre, post, weight));
}

/**
 * As `spherical_cubic_interpolate`, with `Math::cubic_interpolate_in_time` on the key times.
 *
 * @godot Quaternion.spherical_cubic_interpolate_in_time
 * @source core/math/quaternion.cpp:221
 */
export function spherical_cubic_interpolate_in_time(
  self: Quaternion,
  p_b: Quaternion,
  p_pre_a: Quaternion,
  p_post_b: Quaternion,
  p_weight: number,
  p_b_t: number,
  p_pre_a_t: number,
  p_post_b_t: number,
): Quaternion {
  const [weight, bt, pt, qt] = [f32(p_weight), f32(p_b_t), f32(p_pre_a_t), f32(p_post_b_t)];
  return sphericalCubic(self, p_b, p_pre_a, p_post_b, weight, (from, to, pre, post) =>
    cubicInTimeReal(from, to, pre, post, weight, bt, pt, qt),
  );
}

/**
 * `Basis(q).get_euler(order)`; the Variant default order is `EULER_ORDER_YXZ` (2,
 * `core/variant/variant_call.cpp:2408`). Under `MATH_CHECKS` a quaternion that is not normalized
 * is an error that returns (0, 0, 0).
 *
 * @godot Quaternion.get_euler
 * @source core/math/quaternion.cpp:42
 */
export function get_euler(self: Quaternion, p_order = 2): Vector3 {
  if (!is_normalized(self)) return vec3(0, 0, 0);
  return basisGetEuler(godot_basis_from_quaternion(self), p_order);
}

/**
 * The YXZ Euler rotation as a quaternion, from the half-angle products.
 *
 * @godot Quaternion.from_euler
 * @source core/math/quaternion.cpp:313
 */
export function from_euler(p_euler: Vector3): Quaternion {
  const halfA1 = f32(p_euler.y * 0.5);
  const halfA2 = f32(p_euler.x * 0.5);
  const halfA3 = f32(p_euler.z * 0.5);
  const [c1, s1] = [f32(Math.cos(halfA1)), f32(Math.sin(halfA1))];
  const [c2, s2] = [f32(Math.cos(halfA2)), f32(Math.sin(halfA2))];
  const [c3, s3] = [f32(Math.cos(halfA3)), f32(Math.sin(halfA3))];
  const p = (a: number, b: number, c: number): number => f32(f32(a * b) * c);
  return make(
    f32(p(s1, c2, s3) + p(c1, s2, c3)),
    f32(p(s1, c2, c3) - p(c1, s2, s3)),
    f32(-p(s1, s2, c3) + p(c1, c2, s3)),
    f32(p(s1, s2, s3) + p(c1, c2, c3)),
  );
}

/**
 * @godot Quaternion.OP_ADD
 * @source core/math/quaternion.h:206
 */
export function op_add(left: Quaternion, right: Quaternion): Quaternion {
  return make(f32(left.x + right.x), f32(left.y + right.y), f32(left.z + right.z), f32(left.w + right.w));
}

/**
 * @godot Quaternion.OP_SUBTRACT
 * @source core/math/quaternion.h:211
 */
export function op_subtract(left: Quaternion, right: Quaternion): Quaternion {
  return make(f32(left.x - right.x), f32(left.y - right.y), f32(left.z - right.z), f32(left.w - right.w));
}

/**
 * @godot Quaternion.OP_NEGATE
 * @source core/math/quaternion.h:216
 */
export function op_negate(self: Quaternion): Quaternion {
  return make(-self.x, -self.y, -self.z, -self.w);
}

/**
 * @godot Quaternion.OP_POSITIVE
 * @source core/variant/variant_op.cpp:476
 */
export function op_positive(self: Quaternion): Quaternion {
  return self;
}

/**
 * `q * (1 / s)` (`core/math/quaternion.h:225`); plain `OperatorEvaluatorDiv`, so a zero divisor
 * follows IEEE division.
 *
 * @godot Quaternion.OP_DIVIDE
 * @source core/math/quaternion.h:225
 */
export function op_divide(left: Quaternion, right: number): Quaternion {
  return scaled(left, f32(1 / f32(right)));
}

/**
 * Against null (the `Variant` right operand) it is false (`core/variant/variant_op.cpp:547`).
 *
 * @godot Quaternion.OP_EQUAL
 * @source core/math/quaternion.h:229
 */
export function op_equal(left: Quaternion, right: Quaternion | null): boolean {
  return right !== null && left.x === right.x && left.y === right.y && left.z === right.z && left.w === right.w;
}

/**
 * @godot Quaternion.OP_NOT_EQUAL
 * @source core/math/quaternion.h:233
 */
export function op_not_equal(left: Quaternion, right: Quaternion | null): boolean {
  return !op_equal(left, right);
}

/**
 * `q == Quaternion()`, the identity `(0, 0, 0, 1)`.
 *
 * @godot Quaternion.OP_NOT
 * @source core/variant/variant_op.cpp:898
 */
export function op_not(self: Quaternion): boolean {
  return self.x === 0 && self.y === 0 && self.z === 0 && self.w === 1;
}

/** Whether an Array element or a Dictionary key is this Quaternion. */
function isQuaternionEqual(value: unknown, q: Quaternion): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const other = value as Record<string, unknown>;
  return other['x'] === q.x && other['y'] === q.y && other['z'] === q.z && other['w'] === q.w;
}

/**
 * `q in array` is `array.find(q) != -1`; `q in dict` is `dict.has(q)`
 * (`core/variant/variant_op.h:1180`). A Quaternion key is matched by value.
 *
 * @godot Quaternion.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Quaternion, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isQuaternionEqual(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isQuaternionEqual(key, left)) return true;
  return false;
}
