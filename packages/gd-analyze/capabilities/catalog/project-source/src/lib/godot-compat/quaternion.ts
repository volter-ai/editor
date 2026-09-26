/** Godot 4 Quaternion value semantics, pinned to 4.7-stable core/math/quaternion.{h,cpp}. */

import type { Vector3Like } from 'three';

import { basisFromQuaternion, basisRotationQuaternion } from './basis';
import { cross3, dot3, type Vector3, vec3, VECTOR3_ZERO } from './variant-3d';

export interface GodotQuaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

const CMP_EPSILON = 0.00001;

export function quaternion(x: number, y: number, z: number, w: number): GodotQuaternion {
  return Object.freeze({ x, y, z, w });
}

export const QUATERNION_IDENTITY = quaternion(0, 0, 0, 1);

export function quaternionFromAxisAngle(axis: Vector3Like, angle: number): GodotQuaternion {
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (length === 0) return quaternion(0, 0, 0, 0);
  const half = angle * 0.5;
  const sine = Math.sin(half) / length;
  return quaternion(axis.x * sine, axis.y * sine, axis.z * sine, Math.cos(half));
}

export function quaternionFromArc(from: Vector3Like, to: Vector3Like): GodotQuaternion {
  const d = dot3(from, to);
  if (d < -1 + CMP_EPSILON) {
    const axis =
      Math.abs(from.x) > Math.abs(from.z) ? vec3(-from.y, from.x, 0) : vec3(0, -from.z, from.y);
    const len = Math.hypot(axis.x, axis.y, axis.z);
    return quaternion(axis.x / len, axis.y / len, axis.z / len, 0);
  }
  const c = cross3(from, to);
  const s = Math.sqrt((1 + d) * 2);
  return quaternionNormalized(quaternion(c.x / s, c.y / s, c.z / s, s * 0.5));
}

/** Godot's fixed YXZ `Quaternion::from_euler` formula. */
export function quaternionFromEuler(euler: Vector3Like): GodotQuaternion {
  const halfA1 = euler.y * 0.5;
  const halfA2 = euler.x * 0.5;
  const halfA3 = euler.z * 0.5;
  const cosA1 = Math.cos(halfA1);
  const sinA1 = Math.sin(halfA1);
  const cosA2 = Math.cos(halfA2);
  const sinA2 = Math.sin(halfA2);
  const cosA3 = Math.cos(halfA3);
  const sinA3 = Math.sin(halfA3);
  return quaternion(
    sinA1 * cosA2 * sinA3 + cosA1 * sinA2 * cosA3,
    sinA1 * cosA2 * cosA3 - cosA1 * sinA2 * sinA3,
    -sinA1 * sinA2 * cosA3 + cosA1 * cosA2 * sinA3,
    sinA1 * sinA2 * sinA3 + cosA1 * cosA2 * cosA3,
  );
}

export function quaternionLengthSquared(value: GodotQuaternion): number {
  return value.x * value.x + value.y * value.y + value.z * value.z + value.w * value.w;
}

export function quaternionLength(value: GodotQuaternion): number {
  return Math.sqrt(quaternionLengthSquared(value));
}

export function quaternionNormalized(value: GodotQuaternion): GodotQuaternion {
  const length = quaternionLength(value);
  return quaternion(value.x / length, value.y / length, value.z / length, value.w / length);
}

export function quaternionDot(a: GodotQuaternion, b: GodotQuaternion): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

export function quaternionMul(a: GodotQuaternion, b: GodotQuaternion): GodotQuaternion {
  return quaternion(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y + a.y * b.w + a.z * b.x - a.x * b.z,
    a.w * b.z + a.z * b.w + a.x * b.y - a.y * b.x,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );
}

export function quaternionXform(value: GodotQuaternion, vector: Vector3Like): Vector3 {
  const q = vec3(value.x, value.y, value.z);
  const uv = cross3(q, vector);
  const uuv = cross3(q, uv);
  return vec3(
    vector.x + 2 * (uv.x * value.w + uuv.x),
    vector.y + 2 * (uv.y * value.w + uuv.y),
    vector.z + 2 * (uv.z * value.w + uuv.z),
  );
}

export function quaternionSlerp(
  from: GodotQuaternion,
  to: GodotQuaternion,
  weight: number,
): GodotQuaternion {
  let cosine = quaternionDot(from, to);
  let target = to;
  if (cosine < 0) {
    cosine = -cosine;
    target = quaternion(-to.x, -to.y, -to.z, -to.w);
  }
  let scale0: number;
  let scale1: number;
  if (1 - cosine > CMP_EPSILON) {
    const omega = Math.acos(cosine);
    const sine = Math.sin(omega);
    scale0 = Math.sin((1 - weight) * omega) / sine;
    scale1 = Math.sin(weight * omega) / sine;
  } else {
    scale0 = 1 - weight;
    scale1 = weight;
  }
  return quaternion(
    scale0 * from.x + scale1 * target.x,
    scale0 * from.y + scale1 * target.y,
    scale0 * from.z + scale1 * target.z,
    scale0 * from.w + scale1 * target.w,
  );
}

export function quaternionSlerpni(
  from: GodotQuaternion,
  to: GodotQuaternion,
  weight: number,
): GodotQuaternion {
  const dot = quaternionDot(from, to);
  if (Math.abs(dot) > 0.9999) return from;
  const theta = Math.acos(dot);
  const sinT = 1 / Math.sin(theta);
  const newFactor = Math.sin(weight * theta) * sinT;
  const invFactor = Math.sin((1 - weight) * theta) * sinT;
  return quaternion(
    invFactor * from.x + newFactor * to.x,
    invFactor * from.y + newFactor * to.y,
    invFactor * from.z + newFactor * to.z,
    invFactor * from.w + newFactor * to.w,
  );
}

export function quaternionLog(value: GodotQuaternion): GodotQuaternion {
  const angle = 2 * Math.acos(value.w);
  const axis = quaternionAxis(value);
  return quaternion(axis.x * angle, axis.y * angle, axis.z * angle, 0);
}

export function quaternionExp(value: GodotQuaternion): GodotQuaternion {
  const theta = Math.hypot(value.x, value.y, value.z);
  if (theta < CMP_EPSILON) return QUATERNION_IDENTITY;
  const axis = vec3(value.x / theta, value.y / theta, value.z / theta);
  return quaternionFromAxisAngle(axis, theta);
}

export function quaternionAxis(value: GodotQuaternion): Vector3 {
  if (Math.abs(value.w) > 1 - CMP_EPSILON) return vec3(value.x, value.y, value.z);
  const r = 1 / Math.sqrt(1 - value.w * value.w);
  return vec3(value.x * r, value.y * r, value.z * r);
}

function approx(a: number, b: number): boolean {
  if (a === b) return true;
  const tolerance = Math.max(CMP_EPSILON * Math.abs(a), CMP_EPSILON);
  return Math.abs(a - b) < tolerance;
}

function isQuaternion(value: unknown): value is GodotQuaternion {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<GodotQuaternion>;
  return ['x', 'y', 'z', 'w'].every((key) => typeof v[key as keyof GodotQuaternion] === 'number');
}

function isVector3Value(value: unknown): value is Vector3Like {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || 'w' in value) {
    return false;
  }
  const vector = value as Partial<Vector3Like>;
  return typeof vector.x === 'number' && typeof vector.y === 'number' && typeof vector.z === 'number';
}

function inContainer(value: GodotQuaternion, container: unknown): boolean {
  if (Array.isArray(container))
    return container.some((candidate) => quaternionEquals(value, candidate));
  if (container instanceof Map) {
    for (const candidate of container.keys()) if (quaternionEquals(value, candidate)) return true;
  }
  return false;
}

export function quaternionEquals(value: GodotQuaternion, other: unknown): boolean {
  return (
    isQuaternion(other) &&
    value.x === other.x &&
    value.y === other.y &&
    value.z === other.z &&
    value.w === other.w
  );
}

export function godotQuaternionNew(...args: unknown[]): GodotQuaternion {
  if (args.length === 0) return quaternion(0, 0, 0, 1);
  if (args.length === 1 && isQuaternion(args[0]))
    return quaternion(args[0].x, args[0].y, args[0].z, args[0].w);
  if (args.length === 1 && Array.isArray(args[0]) && args[0].length === 3) {
    const [x, y, z] = args[0] as unknown as readonly [Vector3Like, Vector3Like, Vector3Like];
    const trace = x.x + y.y + z.z;
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      return quaternion((y.z - z.y) / s, (z.x - x.z) / s, (x.y - y.x) / s, s * 0.25);
    }
    if (x.x > y.y && x.x > z.z) {
      const s = Math.sqrt(1 + x.x - y.y - z.z) * 2;
      return quaternion(s * 0.25, (x.y + y.x) / s, (z.x + x.z) / s, (y.z - z.y) / s);
    }
    if (y.y > z.z) {
      const s = Math.sqrt(1 + y.y - x.x - z.z) * 2;
      return quaternion((x.y + y.x) / s, s * 0.25, (y.z + z.y) / s, (z.x - x.z) / s);
    }
    const s = Math.sqrt(1 + z.z - x.x - y.y) * 2;
    return quaternion((z.x + x.z) / s, (y.z + z.y) / s, s * 0.25, (x.y - y.x) / s);
  }
  if (args.length === 1 && isVector3Value(args[0])) return quaternionFromEuler(args[0]);
  if (args.length === 2) {
    const [a, b] = args as [Vector3Like, Vector3Like | number];
    return typeof b === 'number' ? quaternionFromAxisAngle(a, b) : quaternionFromArc(a, b);
  }
  if (args.length === 4) return quaternion(...(args as [number, number, number, number]));
  throw new Error(
    `godot-compat: unsupported Quaternion constructor with ${args.length} arguments.`,
  );
}

export function godotQuaternionStatic(name: string, args: readonly unknown[]): unknown {
  if (name === 'from_euler') return quaternionFromEuler(args[0] as Vector3Like);
  throw new Error(`godot-compat: unsupported Quaternion static ${name}.`);
}

export function godotQuaternionCall(
  name: string,
  value: GodotQuaternion,
  args: readonly unknown[],
): unknown {
  const other = args[0] as GodotQuaternion;
  switch (name) {
    case 'angle_to':
      return Math.acos(Math.min(1, Math.max(-1, 2 * quaternionDot(value, other) ** 2 - 1)));
    case 'dot':
      return quaternionDot(value, other);
    case 'exp':
      return quaternionExp(value);
    case 'get_angle':
      return 2 * Math.acos(value.w);
    case 'get_axis':
      return quaternionAxis(value);
    case 'get_euler':
      return quaternionToEuler(value, (args[0] as number | undefined) ?? 2);
    case 'inverse':
      return approx(quaternionLengthSquared(value), 1)
        ? quaternion(-value.x, -value.y, -value.z, value.w)
        : QUATERNION_IDENTITY;
    case 'is_equal_approx':
      return (
        isQuaternion(other) &&
        approx(value.x, other.x) &&
        approx(value.y, other.y) &&
        approx(value.z, other.z) &&
        approx(value.w, other.w)
      );
    case 'is_finite':
      return (
        Number.isFinite(value.x) &&
        Number.isFinite(value.y) &&
        Number.isFinite(value.z) &&
        Number.isFinite(value.w)
      );
    case 'is_normalized':
      return approx(quaternionLengthSquared(value), 1);
    case 'length':
      return quaternionLength(value);
    case 'length_squared':
      return quaternionLengthSquared(value);
    case 'log':
      return quaternionLog(value);
    case 'normalized':
      return quaternionNormalized(value);
    case 'slerp':
      return quaternionSlerp(value, other, args[1] as number);
    case 'slerpni':
      return quaternionSlerpni(value, other, args[1] as number);
    case 'spherical_cubic_interpolate':
      return quaternionCubic(
        value,
        other,
        args[1] as GodotQuaternion,
        args[2] as GodotQuaternion,
        args[3] as number,
      );
    case 'spherical_cubic_interpolate_in_time':
      return quaternionCubic(
        value,
        other,
        args[1] as GodotQuaternion,
        args[2] as GodotQuaternion,
        args[3] as number,
        args[4] as number,
        args[5] as number,
        args[6] as number,
      );
    default:
      throw new Error(`godot-compat: unsupported Quaternion method ${name}.`);
  }
}

export function godotQuaternionOperator(operator: string, left: unknown, right?: unknown): unknown {
  const a = left as GodotQuaternion;
  switch (operator) {
    case '==':
      return quaternionEquals(a, right);
    case '!=':
      return !quaternionEquals(a, right);
    case 'not':
      return quaternionEquals(a, QUATERNION_IDENTITY);
    case 'in':
      return inContainer(a, right);
    case 'unary-':
      return quaternion(-a.x, -a.y, -a.z, -a.w);
    case 'unary+':
      return a;
    case '+': {
      const b = right as GodotQuaternion;
      return quaternion(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
    }
    case '-': {
      const b = right as GodotQuaternion;
      return quaternion(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w);
    }
    case '*':
      if (typeof right === 'number')
        return quaternion(a.x * right, a.y * right, a.z * right, a.w * right);
      if (isQuaternion(right)) return quaternionMul(a, right);
      return quaternionXform(a, right as Vector3Like);
    case '/':
      return quaternion(
        a.x / (right as number),
        a.y / (right as number),
        a.z / (right as number),
        a.w / (right as number),
      );
    default:
      throw new Error(`godot-compat: unsupported Quaternion operator ${operator}.`);
  }
}

/** Matrix-to-Euler formulas from Basis::get_euler for all six Godot EulerOrder values. */
export function quaternionToEuler(value: GodotQuaternion, order = 2): Vector3 {
  const x2 = value.x + value.x;
  const y2 = value.y + value.y;
  const z2 = value.z + value.z;
  const m00 = 1 - y2 * value.y - z2 * value.z;
  const m01 = x2 * value.y - z2 * value.w;
  const m02 = x2 * value.z + y2 * value.w;
  const m10 = x2 * value.y + z2 * value.w;
  const m11 = 1 - x2 * value.x - z2 * value.z;
  const m12 = y2 * value.z - x2 * value.w;
  const m20 = x2 * value.z - y2 * value.w;
  const m21 = y2 * value.z + x2 * value.w;
  const m22 = 1 - x2 * value.x - y2 * value.y;
  const clamp = (n: number) => Math.min(1, Math.max(-1, n));
  switch (order) {
    case 0:
      return Math.abs(m02) < 1 - CMP_EPSILON
        ? vec3(Math.atan2(-m12, m22), Math.asin(clamp(m02)), Math.atan2(-m01, m00))
        : vec3(Math.atan2(m21, m11), Math.asin(clamp(m02)), 0);
    case 1:
      return Math.abs(m01) < 1 - CMP_EPSILON
        ? vec3(Math.atan2(m21, m11), Math.atan2(m02, m00), Math.asin(clamp(-m01)))
        : vec3(-Math.atan2(-m12, m22), 0, Math.asin(clamp(-m01)));
    case 2:
      return Math.abs(m12) < 1 - CMP_EPSILON
        ? vec3(Math.asin(clamp(-m12)), Math.atan2(m02, m22), Math.atan2(m10, m11))
        : vec3(Math.asin(clamp(-m12)), Math.atan2(-m20, m00), 0);
    case 3:
      return Math.abs(m10) < 1 - CMP_EPSILON
        ? vec3(Math.atan2(-m12, m11), Math.atan2(-m20, m00), Math.asin(clamp(m10)))
        : vec3(0, Math.atan2(m02, m22), Math.asin(clamp(m10)));
    case 4:
      return Math.abs(m21) < 1 - CMP_EPSILON
        ? vec3(Math.atan2(-m20, m22), Math.asin(clamp(m21)), Math.atan2(-m01, m11))
        : vec3(0, -Math.atan2(m02, m00), Math.asin(clamp(m21)));
    case 5:
      return Math.abs(m20) < 1 - CMP_EPSILON
        ? vec3(Math.atan2(m21, m22), Math.asin(clamp(-m20)), Math.atan2(m10, m00))
        : vec3(0, Math.asin(clamp(-m20)), -Math.atan2(-m01, m11));
    default:
      return VECTOR3_ZERO;
  }
}

function quaternionCubic(
  from: GodotQuaternion,
  to: GodotQuaternion,
  pre: GodotQuaternion,
  post: GodotQuaternion,
  weight: number,
  toTime?: number,
  preTime?: number,
  postTime?: number,
): GodotQuaternion {
  const neg = (q: GodotQuaternion) => quaternion(-q.x, -q.y, -q.z, -q.w);
  const canonical = (q: GodotQuaternion) => basisRotationQuaternion(basisFromQuaternion(q));
  const fromQ = canonical(from);
  let preQ = canonical(pre);
  let toQ = canonical(to);
  let postQ = canonical(post);
  if (quaternionDot(fromQ, preQ) < 0) preQ = neg(preQ);
  const flipTo = quaternionDot(fromQ, toQ) < 0;
  if (flipTo) toQ = neg(toQ);
  if (flipTo ? quaternionDot(toQ, postQ) <= 0 : quaternionDot(toQ, postQ) < 0) postQ = neg(postQ);
  const inverse = (q: GodotQuaternion) => quaternion(-q.x, -q.y, -q.z, q.w);
  const zero = quaternion(0, 0, 0, 0);
  const interpolate = (a: number, b: number, p: number, q: number): number => {
    if (toTime === undefined || preTime === undefined || postTime === undefined) {
      return (
        0.5 *
        (2 * a +
          (-p + b) * weight +
          (2 * p - 5 * a + 4 * b - q) * weight ** 2 +
          (-p + 3 * a - 3 * b + q) * weight ** 3)
      );
    }
    const lerp = (x: number, y: number, t: number) => x + (y - x) * t;
    const t = lerp(0, toTime, weight);
    const a1 = lerp(p, a, preTime === 0 ? 0 : (t - preTime) / -preTime);
    const a2 = lerp(a, b, toTime === 0 ? 0.5 : t / toTime);
    const a3 = lerp(b, q, postTime - toTime === 0 ? 1 : (t - toTime) / (postTime - toTime));
    const b1 = lerp(a1, a2, toTime - preTime === 0 ? 0 : (t - preTime) / (toTime - preTime));
    const b2 = lerp(a2, a3, postTime === 0 ? 1 : t / postTime);
    return lerp(b1, b2, toTime === 0 ? 0.5 : t / toTime);
  };
  const relative = (space: GodotQuaternion, q: GodotQuaternion) =>
    quaternionLog(quaternionMul(inverse(space), q));
  const fromTo = relative(fromQ, toQ);
  const fromPre = relative(fromQ, preQ);
  const fromPost = relative(fromQ, postQ);
  const ln1 = quaternion(
    interpolate(zero.x, fromTo.x, fromPre.x, fromPost.x),
    interpolate(zero.y, fromTo.y, fromPre.y, fromPost.y),
    interpolate(zero.z, fromTo.z, fromPre.z, fromPost.z),
    0,
  );
  const q1 = quaternionMul(fromQ, quaternionExp(ln1));
  const toFrom = relative(toQ, fromQ);
  const toPre = relative(toQ, preQ);
  const toPost = relative(toQ, postQ);
  const ln2 = quaternion(
    interpolate(toFrom.x, zero.x, toPre.x, toPost.x),
    interpolate(toFrom.y, zero.y, toPre.y, toPost.y),
    interpolate(toFrom.z, zero.z, toPre.z, toPost.z),
    0,
  );
  const q2 = quaternionMul(toQ, quaternionExp(ln2));
  return quaternionSlerp(q1, q2, weight);
}
