/** Exact spatial queries over the authored polygons retained by NavigationRegion3D. */
import { Box3, Matrix4, Ray, Triangle, Vector3 } from 'three';
import type { GodotNavigationMesh, NavigationMeshAabb, NavigationMeshVector3 } from './navigation-mesh';

export interface GodotNavigationRegionGeometryHit {
  readonly point: NavigationMeshVector3;
  readonly normal: NavigationMeshVector3;
  readonly distanceSquared: number;
  readonly polygonIndex: number;
}

const finitePoint = (value: NavigationMeshVector3, member: string): Vector3 => {
  const point = new Vector3(Number(value.x), Number(value.y), Number(value.z));
  if (![point.x, point.y, point.z].every(Number.isFinite)) {
    throw new TypeError(`${member} requires finite Vector3 components.`);
  }
  return point;
};

const matrixOf = (value: readonly number[]): Matrix4 => {
  if (value.length !== 16 || !value.every(Number.isFinite)) {
    throw new TypeError('NavigationRegion3D transform requires sixteen finite components.');
  }
  return new Matrix4().fromArray([...value]);
};

const valueOf = (point: Vector3): NavigationMeshVector3 => ({ x: point.x, y: point.y, z: point.z });

function visitTriangles(
  mesh: GodotNavigationMesh,
  transform: readonly number[],
  visitor: (triangle: Triangle, polygonIndex: number) => void,
): void {
  const vertices = mesh.get_vertices();
  const matrix = matrixOf(transform);
  for (let polygonIndex = 0; polygonIndex < mesh.get_polygon_count(); polygonIndex += 1) {
    const polygon = mesh.get_polygon(polygonIndex);
    if (polygon.length < 3) continue;
    const firstIndex = polygon[0];
    const first = firstIndex === undefined ? undefined : vertices[firstIndex];
    if (first === undefined) throw new RangeError(`NavigationMesh polygon ${polygonIndex} references missing vertex ${String(firstIndex)}.`);
    const a = finitePoint(first, 'NavigationMesh vertex').applyMatrix4(matrix);
    for (let index = 1; index + 1 < polygon.length; index += 1) {
      const bIndex = polygon[index];
      const cIndex = polygon[index + 1];
      const bValue = bIndex === undefined ? undefined : vertices[bIndex];
      const cValue = cIndex === undefined ? undefined : vertices[cIndex];
      if (bValue === undefined || cValue === undefined) {
        throw new RangeError(`NavigationMesh polygon ${polygonIndex} references a missing vertex.`);
      }
      const b = finitePoint(bValue, 'NavigationMesh vertex').applyMatrix4(matrix);
      const c = finitePoint(cValue, 'NavigationMesh vertex').applyMatrix4(matrix);
      const triangle = new Triangle(a.clone(), b, c);
      if (triangle.getArea() > 0) visitor(triangle, polygonIndex);
    }
  }
}

export function getGodotNavigationRegionBounds(
  mesh: GodotNavigationMesh,
  transform: readonly number[],
): NavigationMeshAabb {
  const bounds = new Box3();
  visitTriangles(mesh, transform, (triangle) => {
    bounds.expandByPoint(triangle.a);
    bounds.expandByPoint(triangle.b);
    bounds.expandByPoint(triangle.c);
  });
  if (bounds.isEmpty()) {
    return { position: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } };
  }
  return { position: valueOf(bounds.min), size: valueOf(bounds.getSize(new Vector3())) };
}

export function getGodotNavigationRegionClosestPoint(
  mesh: GodotNavigationMesh,
  transform: readonly number[],
  query: NavigationMeshVector3,
): GodotNavigationRegionGeometryHit {
  const point = finitePoint(query, 'NavigationServer3D region point query');
  const candidate = new Vector3();
  const normal = new Vector3();
  let best: GodotNavigationRegionGeometryHit | undefined;
  visitTriangles(mesh, transform, (triangle, polygonIndex) => {
    triangle.closestPointToPoint(point, candidate);
    const distanceSquared = candidate.distanceToSquared(point);
    if (best !== undefined && distanceSquared >= best.distanceSquared) return;
    triangle.getNormal(normal);
    best = {
      point: valueOf(candidate),
      normal: valueOf(normal),
      distanceSquared,
      polygonIndex,
    };
  });
  if (best === undefined) throw new Error('NavigationRegion3D has no navigable polygons.');
  return best;
}

function closestSegmentPair(
  firstStart: Vector3,
  firstEnd: Vector3,
  secondStart: Vector3,
  secondEnd: Vector3,
): { readonly first: Vector3; readonly second: Vector3; readonly distanceSquared: number } {
  const firstDirection = firstEnd.clone().sub(firstStart);
  const secondDirection = secondEnd.clone().sub(secondStart);
  const offset = firstStart.clone().sub(secondStart);
  const aa = firstDirection.dot(firstDirection);
  const bb = firstDirection.dot(secondDirection);
  const cc = secondDirection.dot(secondDirection);
  const dd = firstDirection.dot(offset);
  const ee = secondDirection.dot(offset);
  const denominator = aa * cc - bb * bb;
  let firstT = denominator === 0 ? 0 : Math.max(0, Math.min(1, (bb * ee - cc * dd) / denominator));
  let secondT = cc === 0 ? 0 : (bb * firstT + ee) / cc;
  if (secondT < 0) {
    secondT = 0;
    firstT = aa === 0 ? 0 : Math.max(0, Math.min(1, -dd / aa));
  } else if (secondT > 1) {
    secondT = 1;
    firstT = aa === 0 ? 0 : Math.max(0, Math.min(1, (bb - dd) / aa));
  }
  const first = firstStart.clone().addScaledVector(firstDirection, firstT);
  const second = secondStart.clone().addScaledVector(secondDirection, secondT);
  return { first, second, distanceSquared: first.distanceToSquared(second) };
}

export function getGodotNavigationRegionClosestPointToSegment(
  mesh: GodotNavigationMesh,
  transform: readonly number[],
  startValue: NavigationMeshVector3,
  endValue: NavigationMeshVector3,
  useCollision = false,
): NavigationMeshVector3 {
  const start = finitePoint(startValue, 'NavigationServer3D segment start');
  const end = finitePoint(endValue, 'NavigationServer3D segment end');
  const direction = end.clone().sub(start);
  const length = direction.length();
  const ray = length === 0 ? null : new Ray(start, direction.clone().divideScalar(length));
  const intersection = new Vector3();
  const trianglePoint = new Vector3();
  let bestPoint: Vector3 | undefined;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  visitTriangles(mesh, transform, (triangle) => {
    if (ray !== null) {
      const hit = ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, intersection);
      if (hit !== null && hit.distanceToSquared(start) <= length * length) {
        const distanceSquared = hit.distanceToSquared(start);
        if (useCollision) {
          if (distanceSquared < bestDistanceSquared) { bestDistanceSquared = distanceSquared; bestPoint = hit.clone(); }
          return;
        }
        bestDistanceSquared = 0;
        bestPoint = hit.clone();
        return;
      }
    }
    if (useCollision) return;
    for (const endpoint of [start, end]) {
      triangle.closestPointToPoint(endpoint, trianglePoint);
      const distanceSquared = endpoint.distanceToSquared(trianglePoint);
      if (distanceSquared < bestDistanceSquared) { bestDistanceSquared = distanceSquared; bestPoint = trianglePoint.clone(); }
    }
    for (const edge of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]] as const) {
      const candidate = closestSegmentPair(start, end, edge[0], edge[1]);
      if (candidate.distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = candidate.distanceSquared;
        bestPoint = candidate.second;
      }
    }
  });
  if (bestPoint === undefined) {
    if (useCollision) return { x: 0, y: 0, z: 0 };
    throw new Error('NavigationRegion3D has no navigable polygons.');
  }
  return valueOf(bestPoint);
}
