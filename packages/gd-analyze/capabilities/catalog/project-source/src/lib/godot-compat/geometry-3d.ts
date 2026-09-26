/** Godot Geometry3D and Godot 3 Geometry 3D algorithms, ported from geometry_3d.{h,cpp}. */

import { type Plane, plane, planeDistanceTo, planeIntersect3 } from './plane';
import { cross3, dot3, type Vector3, vec3 } from './variant-3d';

const CMP_EPSILON = 0.00001;
const CMP_POINT_IN_PLANE_EPSILON = 0.00001;

const sub = (a: Vector3, b: Vector3): Vector3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
const addScaled = (a: Vector3, b: Vector3, scale: number): Vector3 =>
  vec3(a.x + b.x * scale, a.y + b.y * scale, a.z + b.z * scale);
const mix = (a: Vector3, b: Vector3, weight: number): Vector3 =>
  vec3(a.x * (1 - weight) + b.x * weight, a.y * (1 - weight) + b.y * weight, a.z * (1 - weight) + b.z * weight);
const length = (value: Vector3): number => Math.hypot(value.x, value.y, value.z);
const normalized = (value: Vector3): Vector3 => {
  const magnitude = length(value);
  return magnitude === 0
    ? vec3(0, 0, 0)
    : vec3(value.x / magnitude, value.y / magnitude, value.z / magnitude);
};

export function geometry3DClosestPointsBetweenSegments(
  p0: Vector3,
  p1: Vector3,
  q0: Vector3,
  q1: Vector3,
): readonly [Vector3, Vector3] {
  const p = sub(p1, p0);
  const q = sub(q1, q0);
  const r = sub(p0, q0);
  const a = dot3(p, p);
  const b = dot3(p, q);
  const c = dot3(q, q);
  const d = dot3(p, r);
  const e = dot3(q, r);
  let s = 0;
  let t = 0;
  const determinant = a * c - b * b;
  if (determinant > CMP_EPSILON) {
    const bte = b * e;
    const ctd = c * d;
    if (bte <= ctd) {
      if (e <= 0) {
        s = -d >= a ? 1 : -d > 0 ? -d / a : 0;
        t = 0;
      } else if (e < c) {
        s = 0;
        t = e / c;
      } else {
        s = b - d >= a ? 1 : b - d > 0 ? (b - d) / a : 0;
        t = 1;
      }
    } else {
      s = bte - ctd;
      if (s >= determinant) {
        if (b + e <= 0) {
          s = -d <= 0 ? 0 : -d < a ? -d / a : 1;
          t = 0;
        } else if (b + e < c) {
          s = 1;
          t = (b + e) / c;
        } else {
          s = b - d <= 0 ? 0 : b - d < a ? (b - d) / a : 1;
          t = 1;
        }
      } else {
        const ate = a * e;
        const btd = b * d;
        if (ate <= btd) {
          s = -d <= 0 ? 0 : -d >= a ? 1 : -d / a;
          t = 0;
        } else {
          t = ate - btd;
          if (t >= determinant) {
            s = b - d <= 0 ? 0 : b - d >= a ? 1 : (b - d) / a;
            t = 1;
          } else {
            s /= determinant;
            t /= determinant;
          }
        }
      }
    }
  } else if (e <= 0) {
    s = -d <= 0 ? 0 : -d >= a ? 1 : -d / a;
    t = 0;
  } else if (e >= c) {
    s = b - d <= 0 ? 0 : b - d >= a ? 1 : (b - d) / a;
    t = 1;
  } else {
    s = 0;
    t = e / c;
  }
  return [mix(p0, p1, s), mix(q0, q1, t)];
}

export function geometry3DClosestPointToSegment(point: Vector3, a: Vector3, b: Vector3): Vector3 {
  const relative = sub(point, a);
  const segment = sub(b, a);
  const squareLength = dot3(segment, segment);
  if (squareLength < 1e-20) return vec3(a.x, a.y, a.z);
  const distance = dot3(segment, relative) / squareLength;
  if (distance <= 0) return vec3(a.x, a.y, a.z);
  if (distance >= 1) return vec3(b.x, b.y, b.z);
  return addScaled(a, segment, distance);
}

export function geometry3DClosestPointToSegmentUncapped(point: Vector3, a: Vector3, b: Vector3): Vector3 {
  const relative = sub(point, a);
  const segment = sub(b, a);
  const squareLength = dot3(segment, segment);
  if (squareLength < 1e-20) return vec3(a.x, a.y, a.z);
  return addScaled(a, segment, dot3(segment, relative) / squareLength);
}

export function geometry3DTriangleBarycentricCoords(point: Vector3, a: Vector3, b: Vector3, c: Vector3): Vector3 {
  const v0 = sub(b, a);
  const v1 = sub(c, a);
  const v2 = sub(point, a);
  const d00 = dot3(v0, v0);
  const d01 = dot3(v0, v1);
  const d11 = dot3(v1, v1);
  const d20 = dot3(v2, v0);
  const d21 = dot3(v2, v1);
  const denominator = d00 * d11 - d01 * d01;
  if (denominator === 0) return vec3(0, 0, 0);
  const v = (d11 * d20 - d01 * d21) / denominator;
  const w = (d00 * d21 - d01 * d20) / denominator;
  return vec3(1 - v - w, v, w);
}

function triangleIntersection(from: Vector3, direction: Vector3, a: Vector3, b: Vector3, c: Vector3, segment: boolean): Vector3 | null {
  const edge1 = sub(b, a);
  const edge2 = sub(c, a);
  const h = cross3(direction, edge2);
  const determinant = dot3(edge1, h);
  if (Math.abs(determinant) < CMP_EPSILON) return null;
  const inverse = 1 / determinant;
  const s = sub(from, a);
  const u = inverse * dot3(s, h);
  if (u < 0 || u > 1) return null;
  const q = cross3(s, edge1);
  const v = inverse * dot3(direction, q);
  if (v < 0 || u + v > 1) return null;
  const t = inverse * dot3(edge2, q);
  if (segment ? t <= CMP_EPSILON || t > 1 : t <= 0.00001) return null;
  return addScaled(from, direction, t);
}

export const geometry3DRayIntersectsTriangle = (from: Vector3, direction: Vector3, a: Vector3, b: Vector3, c: Vector3): Vector3 | null =>
  triangleIntersection(from, direction, a, b, c, false);

export const geometry3DSegmentIntersectsTriangle = (from: Vector3, to: Vector3, a: Vector3, b: Vector3, c: Vector3): Vector3 | null =>
  triangleIntersection(from, sub(to, from), a, b, c, true);

export function geometry3DSegmentIntersectsSphere(
  from: Vector3,
  to: Vector3,
  spherePosition: Vector3,
  sphereRadius: number,
): Vector3[] {
  const sphere = sub(spherePosition, from);
  const relative = sub(to, from);
  const relativeLength = length(relative);
  if (relativeLength < CMP_EPSILON) return [];
  const direction = vec3(relative.x / relativeLength, relative.y / relativeLength, relative.z / relativeLength);
  const sphereDistance = dot3(direction, sphere);
  const closest = vec3(direction.x * sphereDistance, direction.y * sphereDistance, direction.z * sphereDistance);
  const rayDistance = length(sub(sphere, closest));
  if (rayDistance >= sphereRadius) return [];
  const intersectionSquared = sphereRadius * sphereRadius - rayDistance * rayDistance;
  let intersectionDistance = sphereDistance;
  if (intersectionSquared >= CMP_EPSILON) intersectionDistance -= Math.sqrt(intersectionSquared);
  if (intersectionDistance < 0 || intersectionDistance > relativeLength) return [];
  const point = addScaled(from, direction, intersectionDistance);
  return [point, normalized(sub(point, spherePosition))];
}

export function geometry3DSegmentIntersectsConvex(from: Vector3, to: Vector3, planes: readonly Plane[]): Vector3[] {
  const relative = sub(to, from);
  const relativeLength = length(relative);
  if (relativeLength < CMP_EPSILON) return [];
  const direction = vec3(relative.x / relativeLength, relative.y / relativeLength, relative.z / relativeLength);
  let minimum = -1e20;
  let maximum = 1e20;
  let minimumIndex = -1;
  for (let index = 0; index < planes.length; index += 1) {
    const current = planes[index] as Plane;
    const denominator = dot3(current.normal, direction);
    if (Math.abs(denominator) <= CMP_EPSILON) {
      if (planeDistanceTo(current, from) > 0) return [];
      continue;
    }
    const distance = -planeDistanceTo(current, from) / denominator;
    if (denominator < 0) {
      if (distance > minimum) { minimum = distance; minimumIndex = index; }
    } else if (distance < maximum) maximum = distance;
  }
  if (maximum <= minimum || minimum < 0 || minimum > relativeLength || minimumIndex < 0) return [];
  return [addScaled(from, direction, minimum), vec3(
    planes[minimumIndex]!.normal.x,
    planes[minimumIndex]!.normal.y,
    planes[minimumIndex]!.normal.z,
  )];
}

export function geometry3DSegmentIntersectsCylinder(
  from: Vector3,
  to: Vector3,
  height: number,
  radius: number,
  cylinderAxis = 2,
): Vector3[] {
  const relative = sub(to, from);
  const relativeLength = length(relative);
  if (relativeLength < CMP_EPSILON || !Number.isSafeInteger(cylinderAxis) || cylinderAxis < 0 || cylinderAxis > 2) return [];
  const cylinderDirection = axisVector(cylinderAxis, 1);
  const direction = scale(relative, 1 / relativeLength);
  const perpendicular = cross3(direction, cylinderDirection);
  const perpendicularLength = length(perpendicular);
  const axisDirection = perpendicularLength < CMP_EPSILON
    ? axisVector((cylinderAxis + 1) % 3, 1)
    : scale(perpendicular, 1 / perpendicularLength);
  const distance = dot3(axisDirection, from);
  if (distance >= radius) return [];
  const widthSquared = radius * radius - distance * distance;
  if (widthSquared < CMP_EPSILON) return [];
  const sideDirection = normalized(cross3(axisDirection, cylinderDirection));
  const from2D = [dot3(sideDirection, from), component(from, cylinderAxis)];
  const to2D = [dot3(sideDirection, to), component(to, cylinderAxis)];
  const size = [Math.sqrt(widthSquared), height * 0.5];
  let minimum = 0;
  let maximum = 1;
  let hitAxis = -1;
  for (let axis = 0; axis < 2; axis += 1) {
    const segmentFrom = from2D[axis] as number;
    const segmentTo = to2D[axis] as number;
    const boxBegin = -(size[axis] as number);
    const boxEnd = size[axis] as number;
    let candidateMinimum: number;
    let candidateMaximum: number;
    if (segmentFrom < segmentTo) {
      if (segmentFrom > boxEnd || segmentTo < boxBegin) return [];
      const segmentLength = segmentTo - segmentFrom;
      candidateMinimum = segmentFrom < boxBegin ? (boxBegin - segmentFrom) / segmentLength : 0;
      candidateMaximum = segmentTo > boxEnd ? (boxEnd - segmentFrom) / segmentLength : 1;
    } else {
      if (segmentTo > boxEnd || segmentFrom < boxBegin) return [];
      const segmentLength = segmentTo - segmentFrom;
      candidateMinimum = segmentFrom > boxEnd ? (boxEnd - segmentFrom) / segmentLength : 0;
      candidateMaximum = segmentTo < boxBegin ? (boxBegin - segmentFrom) / segmentLength : 1;
    }
    if (candidateMinimum > minimum) { minimum = candidateMinimum; hitAxis = axis; }
    if (candidateMaximum < maximum) maximum = candidateMaximum;
    if (maximum < minimum) return [];
  }
  const point = addScaled(from, relative, minimum);
  let normal: Vector3;
  if (hitAxis === 0) {
    normal = withoutAxis(point, cylinderAxis);
  } else {
    normal = axisVector(cylinderAxis, component(point, cylinderAxis));
  }
  return [point, normalized(normal)];
}

const component = (value: Vector3, axis: number): number => axis === 0 ? value.x : axis === 1 ? value.y : value.z;
const withoutAxis = (value: Vector3, axis: number): Vector3 =>
  vec3(axis === 0 ? 0 : value.x, axis === 1 ? 0 : value.y, axis === 2 ? 0 : value.z);

export function geometry3DClipPolygon(points: readonly Vector3[], clippingPlane: Plane): Vector3[] {
  if (points.length === 0) return [];
  const locations = points.map((point) => {
    const distance = planeDistanceTo(clippingPlane, point);
    return distance < -CMP_POINT_IN_PLANE_EPSILON ? 1 : distance > CMP_POINT_IN_PLANE_EPSILON ? -1 : 0;
  });
  const insideCount = locations.filter((location) => location === 1).length;
  const outsideCount = locations.filter((location) => location === -1).length;
  if (outsideCount === 0) return points.map((point) => vec3(point.x, point.y, point.z));
  if (insideCount === 0) return [];
  const clipped: Vector3[] = [];
  let previous = points.length - 1;
  for (let index = 0; index < points.length; index += 1) {
    const location = locations[index];
    const current = points[index] as Vector3;
    if (location === -1) {
      if (locations[previous] === 1) clipped.push(clipEdge(points[previous] as Vector3, current, clippingPlane));
    } else {
      if (location === 1 && locations[previous] === -1) clipped.push(clipEdge(current, points[previous] as Vector3, clippingPlane));
      clipped.push(vec3(current.x, current.y, current.z));
    }
    previous = index;
  }
  return clipped;
}

function clipEdge(inside: Vector3, outside: Vector3, clippingPlane: Plane): Vector3 {
  const segment = sub(inside, outside);
  const denominator = dot3(clippingPlane.normal, segment);
  const distance = -planeDistanceTo(clippingPlane, inside) / denominator;
  return addScaled(inside, segment, distance);
}

export function geometry3DBuildBoxPlanes(extents: Vector3): Plane[] {
  return [
    plane(vec3(1, 0, 0), extents.x), plane(vec3(-1, 0, 0), extents.x),
    plane(vec3(0, 1, 0), extents.y), plane(vec3(0, -1, 0), extents.y),
    plane(vec3(0, 0, 1), extents.z), plane(vec3(0, 0, -1), extents.z),
  ];
}

export function geometry3DBuildCylinderPlanes(radius: number, height: number, sides: number, axis = 2): Plane[] {
  if (!Number.isSafeInteger(sides)) throw new TypeError('Geometry3D.build_cylinder_planes sides must be int.');
  if (!Number.isSafeInteger(axis) || axis < 0 || axis > 2) return [];
  const result: Plane[] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = (index * Math.PI * 2) / sides;
    const first = (axis + 1) % 3;
    const second = (axis + 2) % 3;
    const normal = axisVector(first, Math.cos(angle), second, Math.sin(angle));
    result.push(plane(normal, radius));
  }
  const positive = axisVector(axis, 1);
  const negative = axisVector(axis, -1);
  result.push(plane(positive, height * 0.5), plane(negative, height * 0.5));
  return result;
}

export function geometry3DBuildSpherePlanes(radius: number, latitudes: number, longitudes: number, axis = 2): Plane[] {
  if (![latitudes, longitudes].every(Number.isSafeInteger)) throw new TypeError('Geometry3D sphere plane counts must be int.');
  if (!Number.isSafeInteger(axis) || axis < 0 || axis > 2) return [];
  const axisDirection = axisVector(axis, 1);
  const axisNegative = vec3(axis === 0 ? -1 : 1, axis === 1 ? -1 : 1, axis === 2 ? -1 : 1);
  const result: Plane[] = [];
  const longitudeStep = (Math.PI * 2) / longitudes;
  for (let longitude = 0; longitude < longitudes; longitude += 1) {
    const normal = axisVector(
      (axis + 1) % 3,
      Math.cos(longitude * longitudeStep),
      (axis + 2) % 3,
      Math.sin(longitude * longitudeStep),
    );
    result.push(plane(normal, radius));
    for (let latitude = 1; latitude <= latitudes; latitude += 1) {
      const weight = latitude / latitudes;
      const tilted = normalized(mix(normal, axisDirection, weight));
      result.push(plane(tilted, radius));
      result.push(plane(componentMultiply(tilted, axisNegative), radius));
    }
  }
  return result;
}

export function geometry3DBuildCapsulePlanes(
  radius: number,
  height: number,
  sides: number,
  latitudes: number,
  axis = 2,
): Plane[] {
  if (![sides, latitudes].every(Number.isSafeInteger)) throw new TypeError('Geometry3D capsule plane counts must be int.');
  if (!Number.isSafeInteger(axis) || axis < 0 || axis > 2) return [];
  const axisDirection = axisVector(axis, 1);
  const axisNegative = vec3(axis === 0 ? -1 : 1, axis === 1 ? -1 : 1, axis === 2 ? -1 : 1);
  const result: Plane[] = [];
  const sideStep = (Math.PI * 2) / sides;
  for (let side = 0; side < sides; side += 1) {
    const normal = axisVector(
      (axis + 1) % 3,
      Math.cos(side * sideStep),
      (axis + 2) % 3,
      Math.sin(side * sideStep),
    );
    result.push(plane(normal, radius));
    for (let latitude = 1; latitude <= latitudes; latitude += 1) {
      const tilted = normalized(mix(normal, axisDirection, latitude / latitudes));
      const position = addScaled(scale(axisDirection, height * 0.5), tilted, radius);
      const mirroredNormal = componentMultiply(tilted, axisNegative);
      const mirroredPosition = componentMultiply(position, axisNegative);
      result.push(plane(tilted, dot3(tilted, position)));
      result.push(plane(mirroredNormal, dot3(mirroredNormal, mirroredPosition)));
    }
  }
  return result;
}

export function geometry3DComputeConvexMeshPoints(planes: readonly Plane[]): Vector3[] {
  const points: Vector3[] = [];
  for (let first = planes.length - 1; first >= 0; first -= 1) {
    for (let second = first - 1; second >= 0; second -= 1) {
      for (let third = second - 1; third >= 0; third -= 1) {
        const point = planeIntersect3(planes[first]!, planes[second]!, planes[third]!);
        if (point === null) continue;
        let excluded = false;
        for (let index = 0; index < planes.length; index += 1) {
          if (index === first || index === second || index === third) continue;
          const candidate = planes[index] as Plane;
          if (dot3(candidate.normal, point) - candidate.d > CMP_EPSILON) {
            excluded = true;
            break;
          }
        }
        if (!excluded) points.push(point);
      }
    }
  }
  return points;
}

export function geometry3DUv84NormalBit(value: Vector3): number {
  const latitude = Math.floor((Math.acos(dot3(value, vec3(0, 1, 0))) * 4) / Math.PI + 0.5);
  if (latitude === 0) return 24;
  if (latitude === 4) return 25;
  const longitude = Math.floor(((Math.PI + Math.atan2(value.x, value.z)) * 8) / (Math.PI * 2) + 0.5) % 8;
  return longitude + (latitude - 1) * 8;
}

export function geometry3DTetrahedralizeDelaunay(_points: readonly Vector3[]): never {
  throw new Error(
    'godot-compat: Geometry3D.tetrahedralize_delaunay requires Godot Delaunay3D simplex ordering, which the browser runtime does not yet carry.',
  );
}

const scale = (value: Vector3, amount: number): Vector3 => vec3(value.x * amount, value.y * amount, value.z * amount);
const componentMultiply = (a: Vector3, b: Vector3): Vector3 => vec3(a.x * b.x, a.y * b.y, a.z * b.z);

function axisVector(firstAxis: number, firstValue: number, secondAxis = -1, secondValue = 0): Vector3 {
  const values = [0, 0, 0];
  values[firstAxis] = firstValue;
  if (secondAxis >= 0) values[secondAxis] = secondValue;
  return vec3(values[0]!, values[1]!, values[2]!);
}

export const GodotGeometry3D = Object.freeze({
  build_box_planes: geometry3DBuildBoxPlanes,
  build_cylinder_planes: geometry3DBuildCylinderPlanes,
  build_capsule_planes: geometry3DBuildCapsulePlanes,
  compute_convex_mesh_points: geometry3DComputeConvexMeshPoints,
  get_closest_points_between_segments: geometry3DClosestPointsBetweenSegments,
  get_closest_point_to_segment: geometry3DClosestPointToSegment,
  get_closest_point_to_segment_uncapped: geometry3DClosestPointToSegmentUncapped,
  get_triangle_barycentric_coords: geometry3DTriangleBarycentricCoords,
  ray_intersects_triangle: geometry3DRayIntersectsTriangle,
  segment_intersects_triangle: geometry3DSegmentIntersectsTriangle,
  segment_intersects_sphere: geometry3DSegmentIntersectsSphere,
  segment_intersects_cylinder: geometry3DSegmentIntersectsCylinder,
  segment_intersects_convex: geometry3DSegmentIntersectsConvex,
  clip_polygon: geometry3DClipPolygon,
  tetrahedralize_delaunay: geometry3DTetrahedralizeDelaunay,
  get_uv84_normal_bit: geometry3DUv84NormalBit,
});
