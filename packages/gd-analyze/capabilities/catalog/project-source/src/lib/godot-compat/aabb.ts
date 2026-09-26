/**
 * Godot's `AABB` built-in value protocol.
 *
 * Source authority: `core/math/aabb.h` and `core/math/aabb.cpp` at pinned Godot revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. An AABB is a position plus a full size, not a
 * center plus half-extents. Every operation returns frozen value records so an assignment never
 * aliases a live Three.js object.
 */

import type { Vector3Like } from 'three';

import { type Vector3, vec3 } from './variant-3d';

export interface GodotAabb {
  readonly position: Vector3;
  readonly size: Vector3;
}

function frozen(position: Vector3Like, size: Vector3Like): GodotAabb {
  return Object.freeze({
    position: vec3(position.x, position.y, position.z),
    size: vec3(size.x, size.y, size.z),
  });
}

/** `AABB()`, `AABB(from)`, and `AABB(position, size)`. */
export function aabb(
  position: Vector3Like = { x: 0, y: 0, z: 0 },
  size: Vector3Like = { x: 0, y: 0, z: 0 },
): GodotAabb {
  return frozen(position, size);
}

/** Constructor spelling reserved for generated code, so a source local named `aabb` cannot shadow it. */
export function godotAabb(
  position: Vector3Like = { x: 0, y: 0, z: 0 },
  size: Vector3Like = { x: 0, y: 0, z: 0 },
): GodotAabb {
  return aabb(position, size);
}

/** `AABB(from)` — an independent value copy. */
export function copyAabb(value: GodotAabb): GodotAabb {
  return frozen(value.position, value.size);
}

/** Godot value-property writes rebuild the AABB rather than mutating a shared record. */
export function aabbWithPosition(value: GodotAabb, position: Vector3Like): GodotAabb {
  return frozen(position, value.size);
}

/** Godot value-property writes rebuild the AABB rather than mutating a shared record. */
export function aabbWithSize(value: GodotAabb, size: Vector3Like): GodotAabb {
  return frozen(value.position, size);
}

/** `aabb.end = value` sets size to `value - position`. */
export function aabbWithEnd(value: GodotAabb, end: Vector3Like): GodotAabb {
  return frozen(value.position, {
    x: end.x - value.position.x,
    y: end.y - value.position.y,
    z: end.z - value.position.z,
  });
}

export function aabbEnd(value: GodotAabb): Vector3 {
  return vec3(
    value.position.x + value.size.x,
    value.position.y + value.size.y,
    value.position.z + value.size.z,
  );
}

export function aabbAbs(value: GodotAabb): GodotAabb {
  return frozen(
    {
      x: value.position.x + Math.min(value.size.x, 0),
      y: value.position.y + Math.min(value.size.y, 0),
      z: value.position.z + Math.min(value.size.z, 0),
    },
    { x: Math.abs(value.size.x), y: Math.abs(value.size.y), z: Math.abs(value.size.z) },
  );
}

export function aabbCenter(value: GodotAabb): Vector3 {
  return vec3(
    value.position.x + value.size.x * 0.5,
    value.position.y + value.size.y * 0.5,
    value.position.z + value.size.z * 0.5,
  );
}

export function aabbVolume(value: GodotAabb): number {
  return value.size.x * value.size.y * value.size.z;
}

export function aabbHasVolume(value: GodotAabb): boolean {
  return value.size.x > 0 && value.size.y > 0 && value.size.z > 0;
}

export function aabbHasSurface(value: GodotAabb): boolean {
  return value.size.x > 0 || value.size.y > 0 || value.size.z > 0;
}

export function aabbHasPoint(value: GodotAabb, point: Vector3Like): boolean {
  const end = aabbEnd(value);
  return (
    point.x >= value.position.x &&
    point.y >= value.position.y &&
    point.z >= value.position.z &&
    point.x <= end.x &&
    point.y <= end.y &&
    point.z <= end.z
  );
}

function approx(left: number, right: number): boolean {
  if (left === right) return true;
  const tolerance = Math.max(0.00001 * Math.abs(left), 0.00001);
  return Math.abs(left - right) < tolerance;
}

function vectorApprox(left: Vector3Like, right: Vector3Like): boolean {
  return approx(left.x, right.x) && approx(left.y, right.y) && approx(left.z, right.z);
}

export function aabbIsEqualApprox(value: GodotAabb, other: GodotAabb): boolean {
  return vectorApprox(value.position, other.position) && vectorApprox(value.size, other.size);
}

export function aabbIsFinite(value: GodotAabb): boolean {
  return (
    Number.isFinite(value.position.x) &&
    Number.isFinite(value.position.y) &&
    Number.isFinite(value.position.z) &&
    Number.isFinite(value.size.x) &&
    Number.isFinite(value.size.y) &&
    Number.isFinite(value.size.z)
  );
}

/** Face-only contact is not an intersection in Godot's `AABB::intersects`. */
export function aabbIntersects(value: GodotAabb, other: GodotAabb): boolean {
  const end = aabbEnd(value);
  const otherEnd = aabbEnd(other);
  return !(
    value.position.x >= otherEnd.x ||
    end.x <= other.position.x ||
    value.position.y >= otherEnd.y ||
    end.y <= other.position.y ||
    value.position.z >= otherEnd.z ||
    end.z <= other.position.z
  );
}

export function aabbEncloses(value: GodotAabb, other: GodotAabb): boolean {
  const end = aabbEnd(value);
  const otherEnd = aabbEnd(other);
  return (
    value.position.x <= other.position.x &&
    end.x >= otherEnd.x &&
    value.position.y <= other.position.y &&
    end.y >= otherEnd.y &&
    value.position.z <= other.position.z &&
    end.z >= otherEnd.z
  );
}

/** A disjoint intersection is Godot's zero AABB; touching faces produce a zero-size intersection. */
export function aabbIntersection(value: GodotAabb, other: GodotAabb): GodotAabb {
  const end = aabbEnd(value);
  const otherEnd = aabbEnd(other);
  if (
    value.position.x > otherEnd.x ||
    end.x < other.position.x ||
    value.position.y > otherEnd.y ||
    end.y < other.position.y ||
    value.position.z > otherEnd.z ||
    end.z < other.position.z
  ) {
    return aabb();
  }
  const position = {
    x: Math.max(value.position.x, other.position.x),
    y: Math.max(value.position.y, other.position.y),
    z: Math.max(value.position.z, other.position.z),
  };
  const overlapEnd = {
    x: Math.min(end.x, otherEnd.x),
    y: Math.min(end.y, otherEnd.y),
    z: Math.min(end.z, otherEnd.z),
  };
  return frozen(position, {
    x: overlapEnd.x - position.x,
    y: overlapEnd.y - position.y,
    z: overlapEnd.z - position.z,
  });
}

export function aabbMerge(value: GodotAabb, other: GodotAabb): GodotAabb {
  const end = aabbEnd(value);
  const otherEnd = aabbEnd(other);
  const position = {
    x: Math.min(value.position.x, other.position.x),
    y: Math.min(value.position.y, other.position.y),
    z: Math.min(value.position.z, other.position.z),
  };
  const mergedEnd = {
    x: Math.max(end.x, otherEnd.x),
    y: Math.max(end.y, otherEnd.y),
    z: Math.max(end.z, otherEnd.z),
  };
  return frozen(position, {
    x: mergedEnd.x - position.x,
    y: mergedEnd.y - position.y,
    z: mergedEnd.z - position.z,
  });
}

export function aabbExpand(value: GodotAabb, point: Vector3Like): GodotAabb {
  const end = aabbEnd(value);
  const position = {
    x: Math.min(value.position.x, point.x),
    y: Math.min(value.position.y, point.y),
    z: Math.min(value.position.z, point.z),
  };
  const expandedEnd = {
    x: Math.max(end.x, point.x),
    y: Math.max(end.y, point.y),
    z: Math.max(end.z, point.z),
  };
  return frozen(position, {
    x: expandedEnd.x - position.x,
    y: expandedEnd.y - position.y,
    z: expandedEnd.z - position.z,
  });
}

export function aabbGrow(value: GodotAabb, amount: number): GodotAabb {
  return frozen(
    {
      x: value.position.x - amount,
      y: value.position.y - amount,
      z: value.position.z - amount,
    },
    {
      x: value.size.x + 2 * amount,
      y: value.size.y + 2 * amount,
      z: value.size.z + 2 * amount,
    },
  );
}

export function aabbSupport(value: GodotAabb, direction: Vector3Like): Vector3 {
  return vec3(
    value.position.x + (direction.x > 0 ? value.size.x : 0),
    value.position.y + (direction.y > 0 ? value.size.y : 0),
    value.position.z + (direction.z > 0 ? value.size.z : 0),
  );
}

function longestAxisIndex(size: Vector3Like): 0 | 1 | 2 {
  let axis: 0 | 1 | 2 = 0;
  let best = size.x;
  if (size.y > best) {
    axis = 1;
    best = size.y;
  }
  if (size.z > best) axis = 2;
  return axis;
}

function shortestAxisIndex(size: Vector3Like): 0 | 1 | 2 {
  let axis: 0 | 1 | 2 = 0;
  let best = size.x;
  if (size.y < best) {
    axis = 1;
    best = size.y;
  }
  if (size.z < best) axis = 2;
  return axis;
}

function axisVector(axis: 0 | 1 | 2): Vector3 {
  return axis === 0 ? vec3(1, 0, 0) : axis === 1 ? vec3(0, 1, 0) : vec3(0, 0, 1);
}

export function aabbLongestAxis(value: GodotAabb): Vector3 {
  return axisVector(longestAxisIndex(value.size));
}

export function aabbLongestAxisIndex(value: GodotAabb): number {
  return longestAxisIndex(value.size);
}

export function aabbLongestAxisSize(value: GodotAabb): number {
  return Math.max(value.size.x, value.size.y, value.size.z);
}

export function aabbShortestAxis(value: GodotAabb): Vector3 {
  return axisVector(shortestAxisIndex(value.size));
}

export function aabbShortestAxisIndex(value: GodotAabb): number {
  return shortestAxisIndex(value.size);
}

export function aabbShortestAxisSize(value: GodotAabb): number {
  return Math.min(value.size.x, value.size.y, value.size.z);
}

export function aabbEndpoint(value: GodotAabb, index: number): Vector3 {
  if (!Number.isInteger(index) || index < 0 || index > 7) return vec3(0, 0, 0);
  return vec3(
    value.position.x + (index >= 4 ? value.size.x : 0),
    value.position.y + ((index & 2) !== 0 ? value.size.y : 0),
    value.position.z + ((index & 1) !== 0 ? value.size.z : 0),
  );
}
