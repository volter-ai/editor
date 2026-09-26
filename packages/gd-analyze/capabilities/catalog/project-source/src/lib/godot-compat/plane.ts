/** Godot 4 Plane value semantics, pinned to 4.7-stable core/math/plane.h. */

import type { Vector3Like } from 'three';

import { basisInverse, basisTransposed, basisXform } from './basis';
import { cross3, dot3, type Transform, type Vector3, vec3, VECTOR3_ZERO } from './variant-3d';

export interface Plane {
  readonly normal: Vector3;
  readonly d: number;
}

const CMP_EPSILON = 0.00001;

export function plane(normal: Vector3Like, d: number): Plane {
  return Object.freeze({ normal: vec3(normal.x, normal.y, normal.z), d });
}

export const PLANE_ZERO = plane(VECTOR3_ZERO, 0);
export const PLANE_YZ = plane(vec3(1, 0, 0), 0);
export const PLANE_XZ = plane(vec3(0, 1, 0), 0);
export const PLANE_XY = plane(vec3(0, 0, 1), 0);

export function planeFromNormalPoint(normal: Vector3Like, point: Vector3Like): Plane {
  return plane(normal, dot3(normal, point));
}

export function planeFromPoints(a: Vector3Like, b: Vector3Like, c: Vector3Like): Plane {
  const first = vec3(a.x - c.x, a.y - c.y, a.z - c.z);
  const second = vec3(a.x - b.x, a.y - b.y, a.z - b.z);
  const n = cross3(first, second);
  const length = Math.hypot(n.x, n.y, n.z);
  const normal = length === 0 ? VECTOR3_ZERO : vec3(n.x / length, n.y / length, n.z / length);
  return plane(normal, dot3(normal, a));
}

export function planeDistanceTo(value: Plane, point: Vector3Like): number {
  return dot3(value.normal, point) - value.d;
}

export function planeNormalized(value: Plane): Plane {
  const length = Math.hypot(value.normal.x, value.normal.y, value.normal.z);
  return length === 0
    ? PLANE_ZERO
    : plane(
        vec3(value.normal.x / length, value.normal.y / length, value.normal.z / length),
        value.d / length,
      );
}

export function planeIntersectsRay(
  value: Plane,
  from: Vector3Like,
  direction: Vector3Like,
): Vector3 | null {
  const denominator = dot3(value.normal, direction);
  if (Math.abs(denominator) <= CMP_EPSILON) return null;
  const distance = (dot3(value.normal, from) - value.d) / denominator;
  if (distance > CMP_EPSILON) return null;
  return vec3(
    from.x - direction.x * distance,
    from.y - direction.y * distance,
    from.z - direction.z * distance,
  );
}

/** Historical exported spelling retained as the same exact Godot operation. */
export const intersectsRay = planeIntersectsRay;

export function planeIntersectsSegment(
  value: Plane,
  from: Vector3Like,
  to: Vector3Like,
): Vector3 | null {
  const segment = vec3(from.x - to.x, from.y - to.y, from.z - to.z);
  const denominator = dot3(value.normal, segment);
  if (Math.abs(denominator) <= CMP_EPSILON) return null;
  const distance = (dot3(value.normal, from) - value.d) / denominator;
  if (distance < -CMP_EPSILON || distance > 1 + CMP_EPSILON) return null;
  return vec3(
    from.x - segment.x * distance,
    from.y - segment.y * distance,
    from.z - segment.z * distance,
  );
}

export function planeIntersect3(value: Plane, b: Plane, c: Plane): Vector3 | null {
  const bCrossC = cross3(b.normal, c.normal);
  const denominator = dot3(value.normal, bCrossC);
  if (Math.abs(denominator) <= CMP_EPSILON) return null;
  const cCrossA = cross3(c.normal, value.normal);
  const aCrossB = cross3(value.normal, b.normal);
  return vec3(
    (bCrossC.x * value.d + cCrossA.x * b.d + aCrossB.x * c.d) / denominator,
    (bCrossC.y * value.d + cCrossA.y * b.d + aCrossB.y * c.d) / denominator,
    (bCrossC.z * value.d + cCrossA.z * b.d + aCrossB.z * c.d) / denominator,
  );
}

function approx(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) < Math.max(CMP_EPSILON * Math.abs(a), CMP_EPSILON);
}

function isPlane(value: unknown): value is Plane {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Plane>;
  return (
    typeof candidate.d === 'number' &&
    typeof candidate.normal?.x === 'number' &&
    typeof candidate.normal.y === 'number' &&
    typeof candidate.normal.z === 'number'
  );
}

function planeEquals(value: Plane, other: unknown): boolean {
  return (
    isPlane(other) &&
    value.normal.x === other.normal.x &&
    value.normal.y === other.normal.y &&
    value.normal.z === other.normal.z &&
    value.d === other.d
  );
}

export function godotPlaneNew(...args: unknown[]): Plane {
  if (args.length === 0) return PLANE_ZERO;
  if (args.length === 1) {
    if (isPlane(args[0])) return plane(args[0].normal, args[0].d);
    return plane(args[0] as Vector3Like, 0);
  }
  if (args.length === 2)
    return typeof args[1] === 'number'
      ? plane(args[0] as Vector3Like, args[1])
      : planeFromNormalPoint(args[0] as Vector3Like, args[1] as Vector3Like);
  if (args.length === 3)
    return planeFromPoints(args[0] as Vector3Like, args[1] as Vector3Like, args[2] as Vector3Like);
  if (args.length === 4)
    return plane(vec3(args[0] as number, args[1] as number, args[2] as number), args[3] as number);
  throw new Error(`godot-compat: unsupported Plane constructor with ${args.length} arguments.`);
}

export function godotPlaneCall(name: string, value: Plane, args: readonly unknown[]): unknown {
  const point = args[0] as Vector3Like;
  switch (name) {
    case 'distance_to':
      return planeDistanceTo(value, point);
    case 'get_center':
      return vec3(value.normal.x * value.d, value.normal.y * value.d, value.normal.z * value.d);
    case 'has_point':
      return (
        Math.abs(planeDistanceTo(value, point)) <= ((args[1] as number | undefined) ?? CMP_EPSILON)
      );
    case 'intersect_3':
      return planeIntersect3(value, args[0] as Plane, args[1] as Plane);
    case 'intersects_ray':
      return planeIntersectsRay(value, point, args[1] as Vector3Like);
    case 'intersects_segment':
      return planeIntersectsSegment(value, point, args[1] as Vector3Like);
    case 'is_equal_approx': {
      const other = args[0] as Plane;
      return (
        isPlane(other) &&
        approx(value.normal.x, other.normal.x) &&
        approx(value.normal.y, other.normal.y) &&
        approx(value.normal.z, other.normal.z) &&
        approx(value.d, other.d)
      );
    }
    case 'is_finite':
      return (
        Number.isFinite(value.normal.x) &&
        Number.isFinite(value.normal.y) &&
        Number.isFinite(value.normal.z) &&
        Number.isFinite(value.d)
      );
    case 'is_point_over':
      return planeDistanceTo(value, point) > 0;
    case 'normalized':
      return planeNormalized(value);
    case 'project': {
      const distance = planeDistanceTo(value, point);
      return vec3(
        point.x - value.normal.x * distance,
        point.y - value.normal.y * distance,
        point.z - value.normal.z * distance,
      );
    }
    default:
      throw new Error(`godot-compat: unsupported Plane method ${name}.`);
  }
}

export function godotPlaneOperator(operator: string, left: unknown, right?: unknown): unknown {
  const value = left as Plane;
  switch (operator) {
    case '==':
      return planeEquals(value, right);
    case '!=':
      return !planeEquals(value, right);
    case 'not':
      return planeEquals(value, PLANE_ZERO);
    case 'unary-':
      return plane(vec3(-value.normal.x, -value.normal.y, -value.normal.z), -value.d);
    case 'unary+':
      return value;
    case '*': {
      const transform = right as Transform;
      const inverseBasis = basisInverse(transform.basis);
      const sourcePoint = vec3(
        value.normal.x * value.d,
        value.normal.y * value.d,
        value.normal.z * value.d,
      );
      const relative = vec3(
        sourcePoint.x - transform.origin.x,
        sourcePoint.y - transform.origin.y,
        sourcePoint.z - transform.origin.z,
      );
      const point = basisXform(inverseBasis, relative);
      const transformedNormal = basisXform(basisTransposed(transform.basis), value.normal);
      const length = Math.hypot(transformedNormal.x, transformedNormal.y, transformedNormal.z);
      return planeFromNormalPoint(
        vec3(
          transformedNormal.x / length,
          transformedNormal.y / length,
          transformedNormal.z / length,
        ),
        point,
      );
    }
    case 'in': {
      const container = right;
      if (Array.isArray(container))
        return container.some((candidate) => planeEquals(value, candidate));
      if (container instanceof Map)
        for (const candidate of container.keys()) if (planeEquals(value, candidate)) return true;
      return false;
    }
    default:
      throw new Error(`godot-compat: unsupported Plane operator ${operator}.`);
  }
}
