/** Godot's vendored TPPL Hertel-Mehlhorn convex partition for Vector2 polygons. */
export interface PolygonPoint2 {
  readonly x: number;
  readonly y: number;
}

interface Vertex {
  readonly point: PolygonPoint2;
  readonly index: number;
  active: boolean;
  previous: number;
  next: number;
  ear: boolean;
  angle: number;
}

function same(a: PolygonPoint2, b: PolygonPoint2): boolean {
  return a.x === b.x && a.y === b.y;
}

function convex(a: PolygonPoint2, b: PolygonPoint2, c: PolygonPoint2): boolean {
  return (c.y - a.y) * (b.x - a.x) - (c.x - a.x) * (b.y - a.y) > 0;
}

function reflex(a: PolygonPoint2, b: PolygonPoint2, c: PolygonPoint2): boolean {
  return (c.y - a.y) * (b.x - a.x) - (c.x - a.x) * (b.y - a.y) < 0;
}

function inside(a: PolygonPoint2, b: PolygonPoint2, c: PolygonPoint2, p: PolygonPoint2): boolean {
  return !convex(a, p, b) && !convex(b, p, c) && !convex(c, p, a);
}

function angle(center: PolygonPoint2, a: PolygonPoint2, b: PolygonPoint2): number {
  const ax = a.x - center.x;
  const ay = a.y - center.y;
  const bx = b.x - center.x;
  const by = b.y - center.y;
  const al = Math.hypot(ax, ay);
  const bl = Math.hypot(bx, by);
  return al === 0 || bl === 0 ? 0 : (ax * bx + ay * by) / (al * bl);
}

function ccw(points: readonly PolygonPoint2[]): PolygonPoint2[] {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += point.x * next.y - point.y * next.x;
  }
  return (area >= 0 ? points : [...points].reverse()).map((point) => ({ ...point }));
}

function triangulate(points: readonly PolygonPoint2[], at: string): PolygonPoint2[][] {
  if (points.length === 3) return [[...points]];
  const vertices: Vertex[] = points.map((point, index) => ({
    point,
    index,
    active: true,
    previous: (index + points.length - 1) % points.length,
    next: (index + 1) % points.length,
    ear: false,
    angle: 0,
  }));
  const update = (vertex: Vertex): void => {
    const previous = vertices[vertex.previous]!;
    const next = vertices[vertex.next]!;
    vertex.angle = angle(vertex.point, previous.point, next.point);
    vertex.ear = convex(previous.point, vertex.point, next.point);
    if (!vertex.ear) return;
    for (const candidate of vertices) {
      if (
        same(candidate.point, previous.point) || same(candidate.point, vertex.point) ||
        same(candidate.point, next.point)
      ) continue;
      if (inside(previous.point, vertex.point, next.point, candidate.point)) {
        vertex.ear = false;
        return;
      }
    }
  };
  for (const vertex of vertices) update(vertex);
  const triangles: PolygonPoint2[][] = [];
  for (let removed = 0; removed < points.length - 3; removed += 1) {
    let ear: Vertex | undefined;
    for (const candidate of vertices) {
      if (!candidate.active || !candidate.ear) continue;
      if (ear === undefined || candidate.angle > ear.angle) ear = candidate;
    }
    if (ear === undefined) throw new Error(`${at}: Godot convex decomposition found no removable ear.`);
    const previous = vertices[ear.previous]!;
    const next = vertices[ear.next]!;
    triangles.push([previous.point, ear.point, next.point]);
    ear.active = false;
    previous.next = next.index;
    next.previous = previous.index;
    if (removed !== points.length - 4) {
      update(previous);
      update(next);
    }
  }
  const remaining = vertices.find((vertex) => vertex.active);
  if (remaining === undefined) throw new Error(`${at}: Godot convex decomposition produced no terminal triangle.`);
  triangles.push([
    vertices[remaining.previous]!.point,
    remaining.point,
    vertices[remaining.next]!.point,
  ]);
  return triangles;
}

/** Literal `TPPLPartition::ConvexPartition_HM`, including stable merge order. */
export function convexPartitionPolygon(
  points: readonly PolygonPoint2[],
  at: string,
): PolygonPoint2[][] {
  if (points.length < 3) return [];
  const polygon = ccw(points);
  const hasReflex = polygon.some((point, index) =>
    reflex(polygon[(index + polygon.length - 1) % polygon.length]!, point, polygon[(index + 1) % polygon.length]!),
  );
  if (!hasReflex) return [polygon];
  const parts = triangulate(polygon, at);
  for (let firstIndex = 0; firstIndex < parts.length; firstIndex += 1) {
    let first = parts[firstIndex]!;
    for (let edge = 0; edge < first.length; edge += 1) {
      const d1 = first[edge]!;
      const firstNext = (edge + 1) % first.length;
      const d2 = first[firstNext]!;
      let secondIndex = -1;
      let secondEdge = -1;
      for (let candidateIndex = firstIndex + 1; candidateIndex < parts.length; candidateIndex += 1) {
        const candidate = parts[candidateIndex]!;
        for (let candidateEdge = 0; candidateEdge < candidate.length; candidateEdge += 1) {
          if (
            same(d2, candidate[candidateEdge]!) &&
            same(d1, candidate[(candidateEdge + 1) % candidate.length]!)
          ) {
            secondIndex = candidateIndex;
            secondEdge = candidateEdge;
            break;
          }
        }
        if (secondIndex >= 0) break;
      }
      if (secondIndex < 0) continue;
      const second = parts[secondIndex]!;
      const beforeD1 = first[(edge + first.length - 1) % first.length]!;
      const afterD1 = second[(secondEdge + 2) % second.length]!;
      const beforeD2 = second[(secondEdge + second.length - 1) % second.length]!;
      const afterD2 = first[(firstNext + 1) % first.length]!;
      if (!convex(beforeD1, d1, afterD1) || !convex(beforeD2, d2, afterD2)) continue;
      const merged: PolygonPoint2[] = [];
      for (let cursor = firstNext; cursor !== edge; cursor = (cursor + 1) % first.length) merged.push(first[cursor]!);
      for (let cursor = (secondEdge + 1) % second.length; cursor !== secondEdge; cursor = (cursor + 1) % second.length) merged.push(second[cursor]!);
      parts.splice(secondIndex, 1);
      parts[firstIndex] = merged;
      first = merged;
      edge = -1;
    }
  }
  return parts;
}
