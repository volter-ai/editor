/** Godot `AABB` operators from pinned `variant_op.cpp` and `transform_3d.h`. */

import type { Vector3Like } from 'three';

import { aabb, aabbEndpoint, aabbExpand, type GodotAabb } from './aabb';
import type { Transform, Vector3 } from './variant-3d';
import { vec3 } from './variant-3d';

function isVector3(value: unknown): value is Vector3Like {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Vector3Like>;
  return (
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number' &&
    typeof candidate.z === 'number'
  );
}

function isAabb(value: unknown): value is GodotAabb {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<GodotAabb>;
  return isVector3(candidate.position) && isVector3(candidate.size);
}

/** `AABB == Variant` / `AABB != Variant`: exact component equality, false for another type. */
export function aabbEquals(value: GodotAabb, other: unknown): boolean {
  return (
    isAabb(other) &&
    value.position.x === other.position.x &&
    value.position.y === other.position.y &&
    value.position.z === other.position.z &&
    value.size.x === other.size.x &&
    value.size.y === other.size.y &&
    value.size.z === other.size.z
  );
}

/** `not aabb`: `OperatorEvaluatorNot<AABB>` compares with default `AABB()`. */
export function aabbIsZero(value: GodotAabb): boolean {
  return (
    value.position.x === 0 &&
    value.position.y === 0 &&
    value.position.z === 0 &&
    value.size.x === 0 &&
    value.size.y === 0 &&
    value.size.z === 0
  );
}

/** `aabb in Dictionary|Array`, preserving AABB value equality over JS Map/Array storage. */
export function aabbIn(
  value: GodotAabb,
  container: ReadonlyMap<unknown, unknown> | readonly unknown[],
): boolean {
  const candidates = container instanceof Map ? container.keys() : container.values();
  for (const candidate of candidates) if (aabbEquals(value, candidate)) return true;
  return false;
}

/** `Transform3D::xform_inv(Vector3)`: transpose-basis inverse used by `AABB * Transform3D`. */
function inversePoint(transform: Transform, point: Vector3Like): Vector3 {
  const relative = {
    x: point.x - transform.origin.x,
    y: point.y - transform.origin.y,
    z: point.z - transform.origin.z,
  };
  const [x, y, z] = transform.basis;
  return vec3(
    x.x * relative.x + x.y * relative.y + x.z * relative.z,
    y.x * relative.x + y.y * relative.y + y.z * relative.z,
    z.x * relative.x + z.y * relative.y + z.z * relative.z,
  );
}

/**
 * `AABB * Transform3D` is Godot's inverse transform overload. It inverse-transforms all eight
 * corners, seeding the result with endpoint 7 and expanding through endpoints 6..0 exactly as
 * `Transform3D::xform_inv(const AABB&)` does.
 */
export function aabbTransformInverse(value: GodotAabb, transform: Transform): GodotAabb {
  const first = inversePoint(transform, aabbEndpoint(value, 7));
  let result = aabb(first, { x: 0, y: 0, z: 0 });
  for (let index = 6; index >= 0; index -= 1) {
    result = aabbExpand(result, inversePoint(transform, aabbEndpoint(value, index)));
  }
  return result;
}
