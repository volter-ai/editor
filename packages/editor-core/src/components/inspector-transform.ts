import type { Transform } from '@volter/editor-project/adapter';

export type TransformAxis = 0 | 1 | 2;

type Quaternion = [number, number, number, number];

const DEG = 180 / Math.PI;

/** An XYZ Euler rotation (radians) as a quaternion — the convention three.js's
 *  `Quaternion.setFromEuler` uses for order `'XYZ'`, which the wire's rotation is. */
function quaternionFromEulerXYZ(x: number, y: number, z: number): Quaternion {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** A unit quaternion as XYZ Euler radians, through its rotation matrix exactly
 *  as three.js's `Euler.setFromQuaternion(q, 'XYZ')` does, gimbal branch included. */
function eulerXYZFromQuaternion([x, y, z, w]: Quaternion): [number, number, number] {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy;
  const m22 = 1 - (xx + zz), m23 = yz - wx;
  const m32 = yz + wx, m33 = 1 - (xx + yy);
  const ey = Math.asin(Math.min(Math.max(m13, -1), 1));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), ey, 0];
}

/** Present quaternion rotations as the degree-based XYZ fields editors expect. */
export function rotationDegrees(rotation: Transform['rotation']): [number, number, number] {
  const [x, y, z, w] = rotation;
  const lengthSq = x * x + y * y + z * z + w * w;
  const length = Math.sqrt(lengthSq);
  const unit: Quaternion =
    lengthSq < Number.EPSILON ? [0, 0, 0, 1] : [x / length, y / length, z / length, w / length];
  const [ex, ey, ez] = eulerXYZFromQuaternion(unit);
  return [ex * DEG, ey * DEG, ez * DEG];
}

/**
 * Replace one whole displayed CHANNEL — the wire's write, where
 * {@link withRotationDegrees} is the rendered rows' per-axis one.
 *
 * `rotation` arrives in the units the section publishes and the rows display
 * (Euler XYZ degrees), which is the only reason a caller can hand back a value
 * it read from `data` and get the pose it read.
 */
export function withTransformChannel(
  transform: Transform,
  channel: 'position' | 'rotation' | 'scale',
  value: readonly number[],
): Transform {
  if (value.length !== 3 || value.some((n) => !Number.isFinite(n))) {
    throw new Error(`transform.${channel} expects three finite numbers.`);
  }
  const next: Transform = {
    position: [...transform.position] as [number, number, number],
    rotation: [...transform.rotation] as [number, number, number, number],
    scale: [...transform.scale] as [number, number, number],
  };
  if (channel === 'rotation') {
    return { ...next, rotation: quaternionFromEulerXYZ(value[0]! / DEG, value[1]! / DEG, value[2]! / DEG) };
  }
  return { ...next, [channel]: [value[0]!, value[1]!, value[2]!] };
}

/** Replace one displayed Euler axis while preserving the other displayed axes. */
export function withRotationDegrees(
  transform: Transform,
  axis: TransformAxis,
  degrees: number,
): Transform {
  const displayed = rotationDegrees(transform.rotation);
  displayed[axis] = degrees;
  return {
    position: [...transform.position] as [number, number, number],
    rotation: quaternionFromEulerXYZ(displayed[0] / DEG, displayed[1] / DEG, displayed[2] / DEG),
    scale: [...transform.scale] as [number, number, number],
  };
}
