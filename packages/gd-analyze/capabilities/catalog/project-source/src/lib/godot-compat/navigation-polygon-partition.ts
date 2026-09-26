/**
 * Godot's vendored TPPL Hertel-Mehlhorn convex partition used by
 * `NavigationPolygon.make_polygons_from_outlines()`.
 *
 * This is intentionally a direct data algorithm: callers retain Godot resource identity while
 * this module reproduces TPPL's stable hole removal, ear choice, and triangle merge order.
 */
export interface NavigationPartitionPoint {
  readonly x: number;
  readonly y: number;
}

export interface NavigationPartitionOutline {
  readonly points: readonly NavigationPartitionPoint[];
  readonly hole: boolean;
}

interface PartitionVertex {
  readonly point: NavigationPartitionPoint;
  readonly index: number;
  active: boolean;
  previous: number;
  next: number;
  ear: boolean;
  angle: number;
}

const copyPoint = (point: NavigationPartitionPoint): NavigationPartitionPoint => ({ x: point.x, y: point.y });
const samePoint = (first: NavigationPartitionPoint, second: NavigationPartitionPoint): boolean =>
  first.x === second.x && first.y === second.y;

function orientation(points: readonly NavigationPartitionPoint[]): -1 | 0 | 1 {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index] as NavigationPartitionPoint;
    const next = points[(index + 1) % points.length] as NavigationPartitionPoint;
    twiceArea += point.x * next.y - point.y * next.x;
  }
  return twiceArea > 0 ? 1 : twiceArea < 0 ? -1 : 0;
}

function orient(
  points: readonly NavigationPartitionPoint[],
  expected: -1 | 1,
): NavigationPartitionPoint[] {
  const copy = points.map(copyPoint);
  const current = orientation(copy);
  if (current !== 0 && current !== expected) copy.reverse();
  return copy;
}

// The signs below exactly follow TPPLPartition. They look reversed relative to the usual cross
// product because the vendored implementation computes (p3-p1) x (p2-p1).
function isConvex(
  first: NavigationPartitionPoint,
  center: NavigationPartitionPoint,
  last: NavigationPartitionPoint,
): boolean {
  return (last.y - first.y) * (center.x - first.x) -
    (last.x - first.x) * (center.y - first.y) > 0;
}

function isReflex(
  first: NavigationPartitionPoint,
  center: NavigationPartitionPoint,
  last: NavigationPartitionPoint,
): boolean {
  return (last.y - first.y) * (center.x - first.x) -
    (last.x - first.x) * (center.y - first.y) < 0;
}

function isInside(
  first: NavigationPartitionPoint,
  center: NavigationPartitionPoint,
  last: NavigationPartitionPoint,
  point: NavigationPartitionPoint,
): boolean {
  return !isConvex(first, point, center) &&
    !isConvex(center, point, last) &&
    !isConvex(last, point, first);
}

function normalizedX(from: NavigationPartitionPoint, to: NavigationPartitionPoint): number {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  return length === 0 ? 0 : x / length;
}

function normalizedDot(
  center: NavigationPartitionPoint,
  first: NavigationPartitionPoint,
  second: NavigationPartitionPoint,
): number {
  const firstX = first.x - center.x;
  const firstY = first.y - center.y;
  const secondX = second.x - center.x;
  const secondY = second.y - center.y;
  const firstLength = Math.hypot(firstX, firstY);
  const secondLength = Math.hypot(secondX, secondY);
  if (firstLength === 0 || secondLength === 0) return 0;
  return (firstX * secondX + firstY * secondY) / (firstLength * secondLength);
}

function inCone(
  previous: NavigationPartitionPoint,
  point: NavigationPartitionPoint,
  next: NavigationPartitionPoint,
  candidate: NavigationPartitionPoint,
): boolean {
  if (isConvex(previous, point, next)) {
    return isConvex(previous, point, candidate) && isConvex(point, next, candidate);
  }
  return isConvex(previous, point, candidate) || isConvex(point, next, candidate);
}

/** TPPL's visibility intersection: shared endpoints do not block the bridge. */
function intersects(
  firstStart: NavigationPartitionPoint,
  firstEnd: NavigationPartitionPoint,
  secondStart: NavigationPartitionPoint,
  secondEnd: NavigationPartitionPoint,
): boolean {
  if (samePoint(firstStart, secondStart) || samePoint(firstStart, secondEnd) ||
      samePoint(firstEnd, secondStart) || samePoint(firstEnd, secondEnd)) return false;

  const firstNormalX = firstEnd.y - firstStart.y;
  const firstNormalY = firstStart.x - firstEnd.x;
  const secondNormalX = secondEnd.y - secondStart.y;
  const secondNormalY = secondStart.x - secondEnd.x;
  const secondStartSide = (secondStart.x - firstStart.x) * firstNormalX +
    (secondStart.y - firstStart.y) * firstNormalY;
  const secondEndSide = (secondEnd.x - firstStart.x) * firstNormalX +
    (secondEnd.y - firstStart.y) * firstNormalY;
  const firstStartSide = (firstStart.x - secondStart.x) * secondNormalX +
    (firstStart.y - secondStart.y) * secondNormalY;
  const firstEndSide = (firstEnd.x - secondStart.x) * secondNormalX +
    (firstEnd.y - secondStart.y) * secondNormalY;
  return firstStartSide * firstEndSide <= 0 && secondStartSide * secondEndSide <= 0;
}

/** Direct port of TPPLPartition::RemoveHoles. */
function removeHoles(input: readonly NavigationPartitionOutline[]): NavigationPartitionPoint[][] | null {
  let polygons = input.map((polygon) => ({
    points: polygon.points.map(copyPoint),
    hole: polygon.hole,
  }));
  if (!polygons.some((polygon) => polygon.hole)) return polygons.map((polygon) => polygon.points);

  while (true) {
    let holeIndex = -1;
    let holePointIndex = 0;
    for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
      const polygon = polygons[polygonIndex]!;
      if (!polygon.hole) continue;
      if (holeIndex < 0) {
        holeIndex = polygonIndex;
        holePointIndex = 0;
      }
      const selected = polygons[holeIndex]!.points[holePointIndex]!;
      for (let pointIndex = 0; pointIndex < polygon.points.length; pointIndex += 1) {
        if (polygon.points[pointIndex]!.x > selected.x) {
          holeIndex = polygonIndex;
          holePointIndex = pointIndex;
        }
      }
    }
    if (holeIndex < 0) break;

    const hole = polygons[holeIndex]!;
    const holePoint = hole.points[holePointIndex]!;
    let outerIndex = -1;
    let outerPointIndex = -1;
    let bestPoint: NavigationPartitionPoint | undefined;
    for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
      const polygon = polygons[polygonIndex]!;
      if (polygon.hole) continue;
      for (let pointIndex = 0; pointIndex < polygon.points.length; pointIndex += 1) {
        const point = polygon.points[pointIndex]!;
        if (point.x <= holePoint.x) continue;
        const previous = polygon.points[(pointIndex + polygon.points.length - 1) % polygon.points.length]!;
        const next = polygon.points[(pointIndex + 1) % polygon.points.length]!;
        if (!inCone(previous, point, next, holePoint)) continue;
        if (bestPoint !== undefined && normalizedX(holePoint, bestPoint) > normalizedX(holePoint, point)) continue;

        let visible = true;
        for (const candidate of polygons) {
          if (candidate.hole) continue;
          for (let edge = 0; edge < candidate.points.length; edge += 1) {
            const edgeStart = candidate.points[edge]!;
            const edgeEnd = candidate.points[(edge + 1) % candidate.points.length]!;
            if (intersects(holePoint, point, edgeStart, edgeEnd)) {
              visible = false;
              break;
            }
          }
          if (!visible) break;
        }
        if (visible) {
          outerIndex = polygonIndex;
          outerPointIndex = pointIndex;
          bestPoint = point;
        }
      }
    }
    if (outerIndex < 0 || outerPointIndex < 0) return null;

    const outer = polygons[outerIndex]!;
    const merged: NavigationPartitionPoint[] = [];
    for (let index = 0; index <= outerPointIndex; index += 1) merged.push(copyPoint(outer.points[index]!));
    for (let index = 0; index <= hole.points.length; index += 1) {
      merged.push(copyPoint(hole.points[(index + holePointIndex) % hole.points.length]!));
    }
    for (let index = outerPointIndex; index < outer.points.length; index += 1) merged.push(copyPoint(outer.points[index]!));

    const retained = polygons.filter((_polygon, index) => index !== holeIndex && index !== outerIndex);
    retained.push({ points: merged, hole: false });
    polygons = retained;
  }
  return polygons.map((polygon) => polygon.points);
}

/** Direct port of TPPLPartition::Triangulate_EC, including inactive-point ear checks. */
function triangulate(points: readonly NavigationPartitionPoint[]): NavigationPartitionPoint[][] | null {
  if (points.length < 3) return null;
  if (points.length === 3) return [points.map(copyPoint)];
  const vertices: PartitionVertex[] = points.map((point, index) => ({
    point: copyPoint(point),
    index,
    active: true,
    previous: (index + points.length - 1) % points.length,
    next: (index + 1) % points.length,
    ear: false,
    angle: 0,
  }));
  const update = (vertex: PartitionVertex): void => {
    const previous = vertices[vertex.previous]!;
    const next = vertices[vertex.next]!;
    vertex.ear = isConvex(previous.point, vertex.point, next.point);
    vertex.angle = normalizedDot(vertex.point, previous.point, next.point);
    if (!vertex.ear) return;
    for (const candidate of vertices) {
      if (samePoint(candidate.point, vertex.point) || samePoint(candidate.point, previous.point) || samePoint(candidate.point, next.point)) continue;
      if (isInside(previous.point, vertex.point, next.point, candidate.point)) {
        vertex.ear = false;
        break;
      }
    }
  };
  for (const vertex of vertices) update(vertex);

  const triangles: NavigationPartitionPoint[][] = [];
  for (let removed = 0; removed < points.length - 3; removed += 1) {
    let ear: PartitionVertex | undefined;
    for (const candidate of vertices) {
      if (!candidate.active || !candidate.ear) continue;
      if (ear === undefined || candidate.angle > ear.angle) ear = candidate;
    }
    if (ear === undefined) return null;
    const previous = vertices[ear.previous]!;
    const next = vertices[ear.next]!;
    triangles.push([copyPoint(previous.point), copyPoint(ear.point), copyPoint(next.point)]);
    ear.active = false;
    previous.next = next.index;
    next.previous = previous.index;
    if (removed !== points.length - 4) {
      update(previous);
      update(next);
    }
  }
  const remaining = vertices.find((vertex) => vertex.active);
  if (remaining === undefined) return null;
  triangles.push([
    copyPoint(vertices[remaining.previous]!.point),
    copyPoint(remaining.point),
    copyPoint(vertices[remaining.next]!.point),
  ]);
  return triangles;
}

/** Direct port of TPPLPartition::ConvexPartition_HM for a simple polygon. */
function partitionSimplePolygon(points: readonly NavigationPartitionPoint[]): NavigationPartitionPoint[][] | null {
  if (points.length < 3) return null;
  let reflex = false;
  for (let index = 0; index < points.length; index += 1) {
    if (isReflex(
      points[(index + points.length - 1) % points.length]!,
      points[index]!,
      points[(index + 1) % points.length]!,
    )) {
      reflex = true;
      break;
    }
  }
  if (!reflex) return [points.map(copyPoint)];
  const parts = triangulate(points);
  if (parts === null) return null;

  for (let firstIndex = 0; firstIndex < parts.length; firstIndex += 1) {
    let first = parts[firstIndex]!;
    for (let firstEdge = 0; firstEdge < first.length; firstEdge += 1) {
      const firstStart = first[firstEdge]!;
      const firstEndIndex = (firstEdge + 1) % first.length;
      const firstEnd = first[firstEndIndex]!;
      let secondIndex = -1;
      let secondEdge = -1;
      for (let candidateIndex = firstIndex + 1; candidateIndex < parts.length; candidateIndex += 1) {
        const candidate = parts[candidateIndex]!;
        for (let candidateEdge = 0; candidateEdge < candidate.length; candidateEdge += 1) {
          if (samePoint(firstEnd, candidate[candidateEdge]!) &&
              samePoint(firstStart, candidate[(candidateEdge + 1) % candidate.length]!)) {
            secondIndex = candidateIndex;
            secondEdge = candidateEdge;
            break;
          }
        }
        if (secondIndex >= 0) break;
      }
      if (secondIndex < 0) continue;

      const second = parts[secondIndex]!;
      if (!isConvex(
        first[(firstEdge + first.length - 1) % first.length]!,
        firstStart,
        second[(secondEdge + 2) % second.length]!,
      )) continue;
      if (!isConvex(
        second[(secondEdge + second.length - 1) % second.length]!,
        firstEnd,
        first[(firstEndIndex + 1) % first.length]!,
      )) continue;

      const merged: NavigationPartitionPoint[] = [];
      for (let cursor = firstEndIndex; cursor !== firstEdge; cursor = (cursor + 1) % first.length) merged.push(copyPoint(first[cursor]!));
      for (let cursor = (secondEdge + 1) % second.length; cursor !== secondEdge; cursor = (cursor + 1) % second.length) merged.push(copyPoint(second[cursor]!));
      parts.splice(secondIndex, 1);
      parts[firstIndex] = merged;
      first = merged;
      firstEdge = -1;
    }
  }
  return parts;
}

/** `TPPLPartition::ConvexPartition_HM(TPPLPolyList*)`. Null matches TPPL's failure return. */
export function partitionNavigationOutlines(
  outlines: readonly NavigationPartitionOutline[],
): NavigationPartitionPoint[][] | null {
  const simple = removeHoles(outlines);
  if (simple === null) return null;
  const result: NavigationPartitionPoint[][] = [];
  for (const polygon of simple) {
    const parts = partitionSimplePolygon(polygon);
    if (parts === null) return null;
    result.push(...parts);
  }
  return result;
}
