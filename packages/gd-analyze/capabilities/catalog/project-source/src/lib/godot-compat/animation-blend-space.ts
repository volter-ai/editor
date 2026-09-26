/** Geometry-only weighting for AnimationNodeBlendSpace1D/2D. */
export type BlendSpaceMode = 'interpolated' | 'discrete' | 'discreteCarry';

export interface BlendSpacePoint1D {
  readonly position: number;
}

export interface BlendSpacePoint2D {
  readonly x: number;
  readonly y: number;
}

export interface BlendSpaceWeight {
  readonly index: number;
  readonly weight: number;
}

interface DelaunayTriangle {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

function circumcircleContains(
  points: readonly BlendSpacePoint2D[],
  triangle: DelaunayTriangle,
  point: BlendSpacePoint2D,
): boolean {
  const a = points[triangle.a];
  const b = points[triangle.b];
  const c = points[triangle.c];
  if (a === undefined || b === undefined || c === undefined) return false;
  const ax = a.x - point.x;
  const ay = a.y - point.y;
  const bx = b.x - point.x;
  const by = b.y - point.y;
  const cx = c.x - point.x;
  const cy = c.y - point.y;
  const determinant = (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);
  const orientation = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return orientation > 0 ? determinant > 1e-12 : determinant < -1e-12;
}

/** Deterministic Delaunay regeneration used by AnimationNodeBlendSpace2D auto_triangles. */
export function delaunayBlendSpaceTriangles(
  authored: readonly BlendSpacePoint2D[],
): readonly (readonly [number, number, number])[] {
  if (authored.length < 3) return [];
  let minX = authored[0]?.x ?? 0;
  let maxX = minX;
  let minY = authored[0]?.y ?? 0;
  let maxY = minY;
  for (const point of authored) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const points: BlendSpacePoint2D[] = [
    ...authored,
    { x: centerX - 32 * span, y: centerY - span },
    { x: centerX, y: centerY + 32 * span },
    { x: centerX + 32 * span, y: centerY - span },
  ];
  const superA = authored.length;
  const superB = superA + 1;
  const superC = superA + 2;
  let triangles: DelaunayTriangle[] = [{ a: superA, b: superB, c: superC }];
  for (let pointIndex = 0; pointIndex < authored.length; pointIndex += 1) {
    const point = points[pointIndex] as BlendSpacePoint2D;
    const bad = triangles.filter((triangle) => circumcircleContains(points, triangle, point));
    const boundary = new Map<string, { readonly from: number; readonly to: number; count: number }>();
    for (const triangle of bad) {
      for (const [from, to] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]] as const) {
        const key = from < to ? `${from}:${to}` : `${to}:${from}`;
        const current = boundary.get(key);
        if (current === undefined) boundary.set(key, { from, to, count: 1 });
        else current.count += 1;
      }
    }
    const rejected = new Set(bad);
    triangles = triangles.filter((triangle) => !rejected.has(triangle));
    for (const edge of boundary.values()) {
      if (edge.count !== 1) continue;
      triangles.push({ a: edge.from, b: edge.to, c: pointIndex });
    }
  }
  const unique = new Map<string, readonly [number, number, number]>();
  for (const triangle of triangles) {
    if (triangle.a >= authored.length || triangle.b >= authored.length || triangle.c >= authored.length) continue;
    const value = [triangle.a, triangle.b, triangle.c].sort((a, b) => a - b) as [number, number, number];
    unique.set(value.join(':'), value);
  }
  return [...unique.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

function nearest1D(points: readonly BlendSpacePoint1D[], position: number): number {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const next = Math.abs((points[index]?.position ?? 0) - position);
    if (next < distance) {
      nearest = index;
      distance = next;
    }
  }
  return nearest;
}

export function blendSpace1DWeights(
  points: readonly BlendSpacePoint1D[],
  position: number,
  mode: BlendSpaceMode,
): BlendSpaceWeight[] {
  if (points.length === 0) return [];
  if (mode !== 'interpolated' || points.length === 1) {
    return [{ index: nearest1D(points, position), weight: 1 }];
  }
  const sorted = points.map((point, index) => ({ point, index }))
    .sort((a, b) => a.point.position - b.point.position || a.index - b.index);
  if (position <= (sorted[0]?.point.position ?? 0)) return [{ index: sorted[0]?.index ?? 0, weight: 1 }];
  const last = sorted[sorted.length - 1];
  if (last !== undefined && position >= last.point.position) return [{ index: last.index, weight: 1 }];
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (left === undefined || right === undefined || position > right.point.position) continue;
    const span = right.point.position - left.point.position;
    const amount = span === 0 ? 0 : (position - left.point.position) / span;
    return [
      { index: left.index, weight: 1 - amount },
      { index: right.index, weight: amount },
    ];
  }
  return [];
}

function barycentric(
  point: BlendSpacePoint2D,
  a: BlendSpacePoint2D,
  b: BlendSpacePoint2D,
  c: BlendSpacePoint2D,
): readonly [number, number, number] | undefined {
  const v0x = b.x - a.x;
  const v0y = b.y - a.y;
  const v1x = c.x - a.x;
  const v1y = c.y - a.y;
  const v2x = point.x - a.x;
  const v2y = point.y - a.y;
  const denominator = v0x * v1y - v1x * v0y;
  if (Math.abs(denominator) <= Number.EPSILON) return undefined;
  const second = (v2x * v1y - v1x * v2y) / denominator;
  const third = (v0x * v2y - v2x * v0y) / denominator;
  return [1 - second - third, second, third];
}

function closestOnSegment(
  point: BlendSpacePoint2D,
  a: BlendSpacePoint2D,
  b: BlendSpacePoint2D,
): { readonly amount: number; readonly distance2: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const amount = length2 === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2,
  ));
  const x = a.x + dx * amount;
  const y = a.y + dy * amount;
  return { amount, distance2: (point.x - x) ** 2 + (point.y - y) ** 2 };
}

export function blendSpace2DWeights(
  points: readonly BlendSpacePoint2D[],
  triangles: readonly (readonly [number, number, number])[],
  position: BlendSpacePoint2D,
  mode: BlendSpaceMode,
): BlendSpaceWeight[] {
  if (points.length === 0) return [];
  if (mode !== 'interpolated' || triangles.length === 0) {
    let nearest = 0;
    let distance2 = Number.POSITIVE_INFINITY;
    for (let index = 0; index < points.length; index += 1) {
      const sample = points[index];
      if (sample === undefined) continue;
      const next = (sample.x - position.x) ** 2 + (sample.y - position.y) ** 2;
      if (next < distance2) {
        nearest = index;
        distance2 = next;
      }
    }
    return [{ index: nearest, weight: 1 }];
  }
  let closest: BlendSpaceWeight[] = [];
  let closestDistance2 = Number.POSITIVE_INFINITY;
  for (const [ia, ib, ic] of triangles) {
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    if (a === undefined || b === undefined || c === undefined) continue;
    const weights = barycentric(position, a, b, c);
    if (weights !== undefined && weights.every((weight) => weight >= -1e-7)) {
      return [
        { index: ia, weight: Math.max(0, weights[0]) },
        { index: ib, weight: Math.max(0, weights[1]) },
        { index: ic, weight: Math.max(0, weights[2]) },
      ];
    }
    const edges = [[ia, ib], [ib, ic], [ic, ia]] as const;
    for (const [from, to] of edges) {
      const edge = closestOnSegment(position, points[from] as BlendSpacePoint2D, points[to] as BlendSpacePoint2D);
      if (edge.distance2 >= closestDistance2) continue;
      closestDistance2 = edge.distance2;
      closest = [
        { index: from, weight: 1 - edge.amount },
        { index: to, weight: edge.amount },
      ];
    }
  }
  return closest;
}
