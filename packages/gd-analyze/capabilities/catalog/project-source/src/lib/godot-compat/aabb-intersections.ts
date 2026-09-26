/** Exact `AABB` plane/ray/segment queries from the pinned Godot `core/math/aabb.cpp`. */

import type { Vector3Like } from 'three';

import { aabbEnd, aabbEndpoint, type GodotAabb } from './aabb';
import type { Plane } from './plane';
import { type Vector3, vec3 } from './variant-3d';

function planeDistance(plane: Plane, point: Vector3Like): number {
  return point.x * plane.normal.x + point.y * plane.normal.y + point.z * plane.normal.z - plane.d;
}

export function aabbIntersectsPlane(value: GodotAabb, plane: Plane): boolean {
  let over = false;
  let under = false;
  for (let index = 0; index < 8; index += 1) {
    if (planeDistance(plane, aabbEndpoint(value, index)) > 0) over = true;
    else under = true;
  }
  return under && over;
}

/** `AABB.intersects_ray`: entry point, the ray origin when inside, or null on a miss. */
export function aabbIntersectsRay(
  value: GodotAabb,
  from: Vector3Like,
  direction: Vector3Like,
): Vector3 | null {
  const end = aabbEnd(value);
  const origins = [from.x, from.y, from.z] as const;
  const directions = [direction.x, direction.y, direction.z] as const;
  const begins = [value.position.x, value.position.y, value.position.z] as const;
  const ends = [end.x, end.y, end.z] as const;
  let minimum = -1e20;
  let maximum = 1e20;
  let axis = 0;
  for (let index = 0; index < 3; index += 1) {
    const dir = directions[index] as number;
    const origin = origins[index] as number;
    const begin = begins[index] as number;
    const finish = ends[index] as number;
    if (dir === 0) {
      if (origin < begin || origin > finish) return null;
      continue;
    }
    let first = (begin - origin) / dir;
    let second = (finish - origin) / dir;
    if (first > second) [first, second] = [second, first];
    if (first >= minimum) {
      minimum = first;
      axis = index;
    }
    if (second < maximum) {
      if (second < 0) return null;
      maximum = second;
    }
    if (minimum > maximum) return null;
  }
  if (minimum < 0) return vec3(from.x, from.y, from.z);
  const point = [
    from.x + direction.x * minimum,
    from.y + direction.y * minimum,
    from.z + direction.z * minimum,
  ];
  point[axis] = directions[axis]! >= 0 ? begins[axis]! : ends[axis]!;
  return vec3(point[0]!, point[1]!, point[2]!);
}

/** `AABB.intersects_segment`: first point on the finite segment, or null on a miss. */
export function aabbIntersectsSegment(
  value: GodotAabb,
  from: Vector3Like,
  to: Vector3Like,
): Vector3 | null {
  const begins = [value.position.x, value.position.y, value.position.z] as const;
  const sizes = [value.size.x, value.size.y, value.size.z] as const;
  const starts = [from.x, from.y, from.z] as const;
  const finishes = [to.x, to.y, to.z] as const;
  let minimum = 0;
  let maximum = 1;
  for (let index = 0; index < 3; index += 1) {
    const segmentStart = starts[index]!;
    const segmentEnd = finishes[index]!;
    const boxBegin = begins[index]!;
    const boxEnd = boxBegin + sizes[index]!;
    let candidateMinimum: number;
    let candidateMaximum: number;
    if (segmentStart < segmentEnd) {
      if (segmentStart > boxEnd || segmentEnd < boxBegin) return null;
      const length = segmentEnd - segmentStart;
      candidateMinimum = segmentStart < boxBegin ? (boxBegin - segmentStart) / length : 0;
      candidateMaximum = segmentEnd > boxEnd ? (boxEnd - segmentStart) / length : 1;
    } else {
      if (segmentEnd > boxEnd || segmentStart < boxBegin) return null;
      const length = segmentEnd - segmentStart;
      candidateMinimum = segmentStart > boxEnd ? (boxEnd - segmentStart) / length : 0;
      candidateMaximum = segmentEnd < boxBegin ? (boxBegin - segmentStart) / length : 1;
    }
    if (candidateMinimum > minimum) minimum = candidateMinimum;
    if (candidateMaximum < maximum) maximum = candidateMaximum;
    if (maximum < minimum) return null;
  }
  return vec3(
    from.x + (to.x - from.x) * minimum,
    from.y + (to.y - from.y) * minimum,
    from.z + (to.z - from.z) * minimum,
  );
}
