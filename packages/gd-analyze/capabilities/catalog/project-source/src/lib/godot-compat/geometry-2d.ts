/** Godot Geometry2D and Godot 3 Geometry 2D algorithms, ported from geometry_2d.h. */

import { type Vector2, vec2 } from './vector2';
import { godotDictionary } from './variant';
import * as ClipperLib from 'clipper-lib';

const CMP_EPSILON = 0.00001;

const sub = (a: Readonly<Vector2>, b: Readonly<Vector2>): Vector2 => vec2(a.x - b.x, a.y - b.y);
const addScaled = (a: Readonly<Vector2>, b: Readonly<Vector2>, scale: number): Vector2 =>
  vec2(a.x + b.x * scale, a.y + b.y * scale);
const dot = (a: Readonly<Vector2>, b: Readonly<Vector2>): number => a.x * b.x + a.y * b.y;
const cross = (a: Readonly<Vector2>, b: Readonly<Vector2>): number => a.x * b.y - a.y * b.x;
const clamp = (value: number, min: number, max: number): number => value < min ? min : value > max ? max : value;
const equalApprox = (a: number, b: number): boolean =>
  a === b || Math.abs(a - b) < Math.max(CMP_EPSILON * Math.abs(a), CMP_EPSILON);

export function geometry2DIsPointInCircle(
  point: Readonly<Vector2>,
  circlePosition: Readonly<Vector2>,
  circleRadius: number,
): boolean {
  const delta = sub(point, circlePosition);
  return dot(delta, delta) <= circleRadius * circleRadius;
}

export function geometry2DSegmentIntersectsCircle(
  from: Readonly<Vector2>,
  to: Readonly<Vector2>,
  circlePosition: Readonly<Vector2>,
  circleRadius: number,
): number {
  const line = sub(to, from);
  const origin = sub(from, circlePosition);
  const a = dot(line, line);
  const b = 2 * dot(origin, line);
  const c = dot(origin, origin) - circleRadius * circleRadius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return -1;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (first >= 0 && first <= 1) return first;
  if (second >= 0 && second <= 1) return second;
  return -1;
}

export function geometry2DSegmentIntersectsSegment(
  fromA: Readonly<Vector2>,
  toA: Readonly<Vector2>,
  fromB: Readonly<Vector2>,
  toB: Readonly<Vector2>,
): Vector2 | null {
  const b = sub(toA, fromA);
  let c = sub(fromB, fromA);
  let d = sub(toB, fromA);
  const lengthSquared = dot(b, b);
  if (lengthSquared <= 0) return null;
  const normalized = vec2(b.x / lengthSquared, b.y / lengthSquared);
  c = vec2(c.x * normalized.x + c.y * normalized.y, c.y * normalized.x - c.x * normalized.y);
  d = vec2(d.x * normalized.x + d.y * normalized.y, d.y * normalized.x - d.x * normalized.y);
  if ((c.y < -CMP_EPSILON && d.y < -CMP_EPSILON) || (c.y > CMP_EPSILON && d.y > CMP_EPSILON)) return null;
  if (equalApprox(c.y, d.y)) return null;
  const position = d.x + ((c.x - d.x) * d.y) / (d.y - c.y);
  if (position < 0 || position > 1) return null;
  return addScaled(fromA, b, position);
}

export function geometry2DLineIntersectsLine(
  fromA: Readonly<Vector2>,
  directionA: Readonly<Vector2>,
  fromB: Readonly<Vector2>,
  directionB: Readonly<Vector2>,
): Vector2 | null {
  const denominator = directionB.y * directionA.x - directionB.x * directionA.y;
  if (Math.abs(denominator) < CMP_EPSILON) return null;
  const delta = sub(fromA, fromB);
  const t = (directionB.x * delta.y - directionB.y * delta.x) / denominator;
  return addScaled(fromA, directionA, t);
}

export function geometry2DClosestPointToSegment(
  point: Readonly<Vector2>,
  a: Readonly<Vector2>,
  b: Readonly<Vector2>,
): Vector2 {
  const relative = sub(point, a);
  const segment = sub(b, a);
  const lengthSquared = dot(segment, segment);
  if (lengthSquared < 1e-20) return vec2(a.x, a.y);
  const distance = dot(segment, relative) / lengthSquared;
  if (distance <= 0) return vec2(a.x, a.y);
  if (distance >= 1) return vec2(b.x, b.y);
  return addScaled(a, segment, distance);
}

export function geometry2DClosestPointToSegmentUncapped(
  point: Readonly<Vector2>,
  a: Readonly<Vector2>,
  b: Readonly<Vector2>,
): Vector2 {
  const relative = sub(point, a);
  const segment = sub(b, a);
  const lengthSquared = dot(segment, segment);
  if (lengthSquared < 1e-20) return vec2(a.x, a.y);
  return addScaled(a, segment, dot(segment, relative) / lengthSquared);
}

export function geometry2DClosestPointsBetweenSegments(
  p1: Readonly<Vector2>,
  q1: Readonly<Vector2>,
  p2: Readonly<Vector2>,
  q2: Readonly<Vector2>,
): readonly [Vector2, Vector2] {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const relative = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, relative);
  let s: number;
  let t: number;
  if (a <= CMP_EPSILON && e <= CMP_EPSILON) return [vec2(p1.x, p1.y), vec2(p2.x, p2.y)];
  if (a <= CMP_EPSILON) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, relative);
    if (e <= CMP_EPSILON) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denominator = a * e - b * b;
      s = denominator !== 0 ? clamp((b * f - c * e) / denominator, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  return [addScaled(p1, d1, s), addScaled(p2, d2, t)];
}

export function geometry2DPointIsInsideTriangle(
  point: Readonly<Vector2>,
  a: Readonly<Vector2>,
  b: Readonly<Vector2>,
  c: Readonly<Vector2>,
): boolean {
  const an = sub(a, point);
  const bn = sub(b, point);
  const cn = sub(c, point);
  const orientation = cross(an, bn) > 0;
  if ((cross(bn, cn) > 0) !== orientation) return false;
  return (cross(cn, an) > 0) === orientation;
}

export function geometry2DIsPolygonClockwise(polygon: readonly Readonly<Vector2>[]): boolean {
  if (polygon.length < 3) return false;
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index] as Readonly<Vector2>;
    const next = polygon[(index + 1) % polygon.length] as Readonly<Vector2>;
    sum += (next.x - current.x) * (next.y + current.y);
  }
  return sum > 0;
}

export function geometry2DIsPointInPolygon(point: Readonly<Vector2>, polygon: readonly Readonly<Vector2>[]): boolean {
  if (polygon.length < 3) return false;
  let far = vec2(-1e20, -1e20);
  let opposite = vec2(1e20, 1e20);
  for (const vertex of polygon) {
    far = vec2(Math.max(far.x, vertex.x), Math.max(far.y, vertex.y));
    opposite = vec2(Math.min(opposite.x, vertex.x), Math.min(opposite.y, vertex.y));
  }
  far = vec2(
    far.x + (far.x - opposite.x) * 1.221313,
    far.y + (far.y - opposite.y) * 1.512312,
  );
  let intersections = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const result = geometry2DSegmentIntersectsSegment(
      polygon[index]!,
      polygon[(index + 1) % polygon.length]!,
      point,
      far,
    );
    if (result === null) continue;
    intersections += 1;
    if (equalApprox(result.x, point.x) && equalApprox(result.y, point.y)) return true;
  }
  return (intersections & 1) === 1;
}

export function geometry2DConvexHull(points: readonly Readonly<Vector2>[]): Vector2[] {
  const sorted = points.map((point) => vec2(point.x, point.y));
  sorted.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  if (sorted.length <= 1) return sorted;
  const hull: Vector2[] = [];
  for (const point of sorted) {
    while (hull.length >= 2 && cross(sub(hull[hull.length - 1]!, hull[hull.length - 2]!), sub(point, hull[hull.length - 2]!)) <= 0) hull.pop();
    hull.push(point);
  }
  const lower = hull.length;
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const point = sorted[index] as Vector2;
    while (hull.length > lower && cross(sub(hull[hull.length - 1]!, hull[hull.length - 2]!), sub(point, hull[hull.length - 2]!)) <= 0) hull.pop();
    hull.push(point);
  }
  return hull;
}

export function geometry2DTriangulatePolygon(contour: readonly Readonly<Vector2>[]): number[] {
  const count = contour.length;
  if (count < 3) return [];
  const vertices = Array.from({ length: count }, (_, index) => index);
  if (triangulationArea(contour) <= 0) vertices.reverse();
  const triangles: number[] = [];
  let relaxed = false;
  let remaining = count;
  let attempts = 2 * remaining;
  let cursor = remaining - 1;
  while (remaining > 2) {
    const expired = attempts <= 0;
    attempts -= 1;
    if (expired) {
      if (relaxed) return [];
      attempts = 2 * remaining;
      relaxed = true;
    }
    const before = cursor >= remaining ? 0 : cursor;
    cursor = before + 1 >= remaining ? 0 : before + 1;
    const after = cursor + 1 >= remaining ? 0 : cursor + 1;
    if (!triangulationSnip(contour, before, cursor, after, remaining, vertices, relaxed)) continue;
    triangles.push(vertices[before]!, vertices[cursor]!, vertices[after]!);
    vertices.splice(cursor, 1);
    remaining -= 1;
    attempts = 2 * remaining;
  }
  return triangles;
}

interface DelaunayTriangle {
  readonly points: readonly [number, number, number];
  readonly center: Vector2;
  readonly radiusSquared: number;
}

export function geometry2DTriangulateDelaunay(source: readonly Readonly<Vector2>[]): number[] {
  const count = source.length;
  if (count <= 2) return [];
  const points = source.map((point) => vec2(point.x, point.y));
  let minX = points[0]!.x;
  let maxX = minX;
  let minY = points[0]!.y;
  let maxY = minY;
  for (let index = 1; index < count; index += 1) {
    const point = points[index]!;
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  const delta = Math.max(maxX - minX, maxY - minY);
  const center = vec2((minX + maxX) * 0.5, (minY + maxY) * 0.5);
  points.push(
    vec2(center.x - delta * 16, center.y - delta),
    vec2(center.x, center.y + delta * 16),
    vec2(center.x + delta * 16, center.y - delta),
  );
  let triangles: DelaunayTriangle[] = [delaunayTriangle(points, count, count + 1, count + 2)];
  for (let pointIndex = 0; pointIndex < count; pointIndex += 1) {
    const edges: Array<{ readonly points: readonly [number, number]; bad: boolean }> = [];
    for (let triangleIndex = triangles.length - 1; triangleIndex >= 0; triangleIndex -= 1) {
      const triangle = triangles[triangleIndex]!;
      const distance = sub(points[pointIndex]!, triangle.center);
      if (dot(distance, distance) >= triangle.radiusSquared) continue;
      edges.push(
        delaunayEdge(triangle.points[0], triangle.points[1]),
        delaunayEdge(triangle.points[1], triangle.points[2]),
        delaunayEdge(triangle.points[2], triangle.points[0]),
      );
      triangles.splice(triangleIndex, 1);
    }
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      const edge = edges[edgeIndex]!;
      if (edge.bad) continue;
      for (let candidateIndex = edgeIndex + 1; candidateIndex < edges.length; candidateIndex += 1) {
        const candidate = edges[candidateIndex]!;
        if (candidate.points[0] === edge.points[0] && candidate.points[1] === edge.points[1]) {
          edge.bad = true;
          candidate.bad = true;
          break;
        }
      }
      if (!edge.bad) triangles.push(delaunayTriangle(points, edge.points[0], edge.points[1], pointIndex));
    }
  }
  triangles = triangles.filter((triangle) => triangle.points.every((point) => point < count));
  return triangles.flatMap((triangle) => [...triangle.points]);
}

export function geometry2DDecomposePolygonInConvex(
  _polygon: readonly Readonly<Vector2>[],
): never {
  throw new Error(
    'godot-compat: Geometry2D.decompose_polygon_in_convex requires Godot TPPL Hertel-Mehlhorn partition ordering, which the browser runtime does not yet carry.',
  );
}

function delaunayTriangle(points: readonly Vector2[], aIndex: number, bIndex: number, cIndex: number): DelaunayTriangle {
  const origin = points[aIndex]!;
  const a = sub(points[bIndex]!, origin);
  const b = sub(points[cIndex]!, origin);
  const denominator = cross(a, b) * 2;
  const numerator = sub(
    vec2(b.x * dot(a, a), b.y * dot(a, a)),
    vec2(a.x * dot(b, b), a.y * dot(b, b)),
  );
  const orthogonal = vec2(numerator.y, -numerator.x);
  const offset = vec2(orthogonal.x / denominator, orthogonal.y / denominator);
  return {
    points: [aIndex, bIndex, cIndex],
    center: vec2(origin.x + offset.x, origin.y + offset.y),
    radiusSquared: dot(offset, offset),
  };
}

function delaunayEdge(a: number, b: number): { readonly points: readonly [number, number]; bad: boolean } {
  return { points: a > b ? [b, a] : [a, b], bad: false };
}

const CLIPPER_SCALE = 100_000;

function clipperPath(points: readonly Readonly<Vector2>[]): ClipperLib.Path {
  return points.map((point) => {
    const x = point.x * CLIPPER_SCALE;
    const y = point.y * CLIPPER_SCALE;
    if (!Number.isSafeInteger(roundAway(x)) || !Number.isSafeInteger(roundAway(y))) {
      throw new RangeError('Geometry2D polygon coordinate exceeds clipper safe-integer range.');
    }
    return { X: roundAway(x), Y: roundAway(y) };
  });
}

function vectorPaths(paths: ClipperLib.Paths): Vector2[][] {
  return paths.map((path) => path.map((point) => vec2(point.X / CLIPPER_SCALE, point.Y / CLIPPER_SCALE)));
}

const roundAway = (value: number): number => value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);

function geometry2DPolygonOperation(
  operation: ClipperLib.ClipType,
  subject: readonly Readonly<Vector2>[],
  clip: readonly Readonly<Vector2>[],
  openSubject: boolean,
): Vector2[][] {
  const clipper = new ClipperLib.Clipper();
  clipper.PreserveCollinear = false;
  if (!clipper.AddPath(clipperPath(subject), ClipperLib.PolyType.ptSubject, !openSubject)) return [];
  if (!clipper.AddPath(clipperPath(clip), ClipperLib.PolyType.ptClip, true)) return [];
  if (openSubject) {
    const tree = new ClipperLib.PolyTree();
    clipper.Execute(operation, tree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
    return vectorPaths(ClipperLib.Clipper.OpenPathsFromPolyTree(tree));
  }
  const output: ClipperLib.Paths = [];
  clipper.Execute(operation, output, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return vectorPaths(output);
}

export const geometry2DMergePolygons = (a: readonly Readonly<Vector2>[], b: readonly Readonly<Vector2>[]): Vector2[][] =>
  geometry2DPolygonOperation(ClipperLib.ClipType.ctUnion, a, b, false);
export const geometry2DClipPolygons = (a: readonly Readonly<Vector2>[], b: readonly Readonly<Vector2>[]): Vector2[][] =>
  geometry2DPolygonOperation(ClipperLib.ClipType.ctDifference, a, b, false);
export const geometry2DIntersectPolygons = (a: readonly Readonly<Vector2>[], b: readonly Readonly<Vector2>[]): Vector2[][] =>
  geometry2DPolygonOperation(ClipperLib.ClipType.ctIntersection, a, b, false);
export const geometry2DExcludePolygons = (a: readonly Readonly<Vector2>[], b: readonly Readonly<Vector2>[]): Vector2[][] =>
  geometry2DPolygonOperation(ClipperLib.ClipType.ctXor, a, b, false);
export const geometry2DClipPolylineWithPolygon = (line: readonly Readonly<Vector2>[], polygon: readonly Readonly<Vector2>[]): Vector2[][] =>
  geometry2DPolygonOperation(ClipperLib.ClipType.ctDifference, line, polygon, true);
export const geometry2DIntersectPolylineWithPolygon = (line: readonly Readonly<Vector2>[], polygon: readonly Readonly<Vector2>[]): Vector2[][] =>
  geometry2DPolygonOperation(ClipperLib.ClipType.ctIntersection, line, polygon, true);

function geometry2DOffset(
  source: readonly Readonly<Vector2>[],
  delta: number,
  joinType: number,
  endType: number,
): Vector2[][] {
  const joins = [ClipperLib.JoinType.jtSquare, ClipperLib.JoinType.jtRound, ClipperLib.JoinType.jtMiter] as const;
  const ends = [
    ClipperLib.EndType.etClosedPolygon,
    ClipperLib.EndType.etClosedLine,
    ClipperLib.EndType.etOpenButt,
    ClipperLib.EndType.etOpenSquare,
    ClipperLib.EndType.etOpenRound,
  ] as const;
  if (!Number.isSafeInteger(joinType) || joins[joinType] === undefined) throw new RangeError(`Geometry2D invalid PolyJoinType ${joinType}.`);
  if (!Number.isSafeInteger(endType) || ends[endType] === undefined) throw new RangeError(`Geometry2D invalid PolyEndType ${endType}.`);
  const offset = new ClipperLib.ClipperOffset(2, 0.25 * CLIPPER_SCALE);
  offset.AddPath(clipperPath(source), joins[joinType], ends[endType]);
  const output: ClipperLib.Paths = [];
  offset.Execute(output, delta * CLIPPER_SCALE);
  return vectorPaths(output);
}

export const geometry2DOffsetPolygon = (polygon: readonly Readonly<Vector2>[], delta: number, joinType = 0): Vector2[][] =>
  geometry2DOffset(polygon, delta, joinType, 0);

export function geometry2DOffsetPolyline(
  polyline: readonly Readonly<Vector2>[],
  delta: number,
  joinType = 0,
  endType = 3,
): Vector2[][] {
  if (endType === 0) throw new Error('Geometry2D.offset_polyline END_POLYGON is invalid; use offset_polygon.');
  return geometry2DOffset(polyline, delta, joinType, endType);
}

function triangulationArea(contour: readonly Readonly<Vector2>[]): number {
  let area = 0;
  for (let previous = contour.length - 1, current = 0; current < contour.length; previous = current++) {
    area += cross(contour[previous]!, contour[current]!);
  }
  return area * 0.5;
}

function triangulationSnip(
  contour: readonly Readonly<Vector2>[],
  before: number,
  current: number,
  after: number,
  remaining: number,
  vertices: readonly number[],
  relaxed: boolean,
): boolean {
  const a = contour[vertices[before]!]!;
  const b = contour[vertices[current]!]!;
  const c = contour[vertices[after]!]!;
  const threshold = relaxed ? -CMP_EPSILON : CMP_EPSILON;
  if (threshold > cross(sub(b, a), sub(c, a))) return false;
  for (let index = 0; index < remaining; index += 1) {
    if (index === before || index === current || index === after) continue;
    if (triangulationInside(a, b, c, contour[vertices[index]!]!, relaxed)) return false;
  }
  return true;
}

function triangulationInside(a: Readonly<Vector2>, b: Readonly<Vector2>, c: Readonly<Vector2>, point: Readonly<Vector2>, relaxed: boolean): boolean {
  const first = cross(sub(c, b), sub(point, b));
  const second = cross(sub(a, c), sub(point, c));
  const third = cross(sub(b, a), sub(point, a));
  return relaxed ? first > 0 && second > 0 && third > 0 : first >= 0 && second >= 0 && third >= 0;
}

export function geometry2DBresenhamLine(from: Readonly<Vector2>, to: Readonly<Vector2>): Vector2[] {
  if (![from.x, from.y, to.x, to.y].every(Number.isSafeInteger)) throw new TypeError('Geometry2D.bresenham_line requires Vector2i endpoints.');
  const points: Vector2[] = [];
  const deltaX = Math.abs(to.x - from.x) * 2;
  const deltaY = Math.abs(to.y - from.y) * 2;
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  if (deltaX > deltaY) {
    let error = deltaX / 2;
    for (; x !== to.x; x += stepX) {
      points.push(vec2(x, y));
      error -= deltaY;
      if (error < 0) { y += stepY; error += deltaX; }
    }
  } else {
    let error = deltaY / 2;
    for (; y !== to.y; y += stepY) {
      points.push(vec2(x, y));
      error -= deltaX;
      if (error < 0) { x += stepX; error += deltaY; }
    }
  }
  points.push(vec2(x, y));
  return points;
}

export function geometry2DMakeAtlas(rectangles: readonly Readonly<Vector2>[]): Map<string, unknown> {
  if (rectangles.length === 0) throw new Error('Geometry2D.make_atlas requires at least one size.');
  const working = rectangles.map((size, index) => {
    if (!Number.isFinite(size.x) || !Number.isFinite(size.y)) {
      throw new Error('Geometry2D.make_atlas requires finite sizes.');
    }
    const integerSize = vec2(Math.trunc(size.x), Math.trunc(size.y));
    if (
      !Number.isSafeInteger(integerSize.x)
      || !Number.isSafeInteger(integerSize.y)
      || integerSize.x <= 0
      || integerSize.y <= 0
      || integerSize.x > 0x7fffffff
      || integerSize.y > 0x7fffffff
    ) {
      throw new Error('Geometry2D.make_atlas requires sizes that convert to positive int32 values.');
    }
    return { size: integerSize, position: vec2(), index };
  }).sort((left, right) => right.size.x - left.size.x);
  const widest = working[0]!.size.x;
  const results: Array<{ readonly rectangles: typeof working; readonly maxWidth: number; readonly maxHeight: number }> = [];
  for (let power = 0; power <= 12; power += 1) {
    const width = 1 << power;
    if (width < widest) continue;
    const heights = new Array<number>(width).fill(0);
    const placed = working.map((rectangle) => ({ ...rectangle, position: vec2() }));
    let offset = 0;
    let heightLimit = 0;
    let maxHeight = 0;
    let maxWidth = 0;
    for (const rectangle of placed) {
      if (offset + rectangle.size.x > width) offset = 0;
      let fromY = 0;
      for (let scan = 0; scan < rectangle.size.x; scan += 1) {
        if (heights[offset + scan]! > fromY) fromY = heights[offset + scan]!;
      }
      rectangle.position = vec2(offset, fromY);
      const endHeight = fromY + rectangle.size.y;
      const endWidth = offset + rectangle.size.x;
      if (offset === 0) heightLimit = endHeight;
      for (let scan = 0; scan < rectangle.size.x; scan += 1) heights[offset + scan] = endHeight;
      if (endHeight > maxHeight) maxHeight = endHeight;
      if (endWidth > maxWidth) maxWidth = endWidth;
      if (offset === 0 || endHeight > heightLimit) offset += rectangle.size.x;
    }
    results.push({ rectangles: placed, maxWidth, maxHeight });
  }
  let best = results[0]!;
  let bestAspect = Number.POSITIVE_INFINITY;
  for (const result of results) {
    const height = nextPowerOfTwo(result.maxHeight);
    const width = nextPowerOfTwo(result.maxWidth);
    const aspect = height > width ? height / width : width / height;
    if (aspect < bestAspect) { best = result; bestAspect = aspect; }
  }
  const points = new Array<Vector2>(rectangles.length);
  for (const rectangle of best.rectangles) points[rectangle.index] = rectangle.position;
  return godotDictionary([['points', points], ['size', vec2(best.maxWidth, best.maxHeight)]]);
}

function nextPowerOfTwo(value: number): number {
  if (value <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(value));
}

export const GodotGeometry2D = Object.freeze({
  is_point_in_circle: geometry2DIsPointInCircle,
  segment_intersects_circle: geometry2DSegmentIntersectsCircle,
  segment_intersects_segment: geometry2DSegmentIntersectsSegment,
  line_intersects_line: geometry2DLineIntersectsLine,
  get_closest_points_between_segments: geometry2DClosestPointsBetweenSegments,
  get_closest_point_to_segment: geometry2DClosestPointToSegment,
  get_closest_point_to_segment_uncapped: geometry2DClosestPointToSegmentUncapped,
  point_is_inside_triangle: geometry2DPointIsInsideTriangle,
  is_polygon_clockwise: geometry2DIsPolygonClockwise,
  is_point_in_polygon: geometry2DIsPointInPolygon,
  convex_hull: geometry2DConvexHull,
  triangulate_polygon: geometry2DTriangulatePolygon,
  triangulate_delaunay: geometry2DTriangulateDelaunay,
  decompose_polygon_in_convex: geometry2DDecomposePolygonInConvex,
  merge_polygons: geometry2DMergePolygons,
  clip_polygons: geometry2DClipPolygons,
  intersect_polygons: geometry2DIntersectPolygons,
  exclude_polygons: geometry2DExcludePolygons,
  clip_polyline_with_polygon: geometry2DClipPolylineWithPolygon,
  intersect_polyline_with_polygon: geometry2DIntersectPolylineWithPolygon,
  offset_polygon: geometry2DOffsetPolygon,
  offset_polyline: geometry2DOffsetPolyline,
  bresenham_line: geometry2DBresenhamLine,
  make_atlas: geometry2DMakeAtlas,
});
