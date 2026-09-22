/**
 * Pure curve math for `CurveEditor` (W1b) — piecewise cubic-bezier
 * value-over-normalized-time curves, structurally identical to the engine's
 * `PiecewiseBezier` schema shape (`schema/particles.ts`) and to three.quarks'
 * own `PiecewiseBezier` JSON: segment `i` spans `[start_i, start_{i+1}]`
 * (the last segment ends at 1), and `p0..p3` are VALUE control points over
 * the segment's normalized time — i.e. the plotted curve is an exact SVG
 * cubic with x-controls at 1/3 and 2/3 of the segment width.
 *
 * Kept editor-generic (no particle imports): any future consumer uses the
 * same helpers.
 */

export interface CurveBezier {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface CurveSegment {
  function: CurveBezier;
  start: number;
}

export interface CurveKey {
  time: number;
  value: number;
}

/** End time of segment `i` — the next segment's start, or 1 for the last. */
export function segmentEnd(segments: CurveSegment[], i: number): number {
  return i + 1 < segments.length ? segments[i + 1]!.start : 1;
}

/**
 * The curve's keys (n segments → n+1 keys): key `i` sits at segment `i`'s
 * start with value `p0`; the final key sits at t=1 with the last `p3`.
 */
export function curveKeys(segments: CurveSegment[]): CurveKey[] {
  const keys: CurveKey[] = segments.map((s) => ({ time: s.start, value: s.function.p0 }));
  const last = segments[segments.length - 1];
  if (last) keys.push({ time: 1, value: last.function.p3 });
  return keys;
}

function cloneSegments(segments: CurveSegment[]): CurveSegment[] {
  return segments.map((s) => ({ start: s.start, function: { ...s.function } }));
}

const MIN_SEGMENT_WIDTH = 0.01;

/**
 * Move key `keyIndex` to (time, value). Endpoint keys are time-locked (first
 * to its own start, last to 1); interior key times clamp between neighbors.
 * Tangent control values (p1/p2) shift WITH their endpoint so the curve's
 * local shape is preserved.
 */
export function moveKey(
  segments: CurveSegment[],
  keyIndex: number,
  time: number,
  value: number,
): CurveSegment[] {
  const next = cloneSegments(segments);
  const n = next.length;
  if (keyIndex < 0 || keyIndex > n) return next;

  if (keyIndex < n) {
    // Key owns segment keyIndex's start/p0 (and the previous segment's p3).
    const seg = next[keyIndex]!;
    const dv = value - seg.function.p0;
    seg.function.p0 = value;
    seg.function.p1 += dv;
    if (keyIndex > 0) {
      const prev = next[keyIndex - 1]!;
      const dvPrev = value - prev.function.p3;
      prev.function.p3 = value;
      prev.function.p2 += dvPrev;
      // Interior keys may move in time, clamped between neighbors.
      const lo = prev.start + MIN_SEGMENT_WIDTH;
      const hi = segmentEnd(next, keyIndex) - MIN_SEGMENT_WIDTH;
      seg.start = Math.min(hi, Math.max(lo, time));
    }
  } else {
    // Final key: last segment's p3, time locked at 1.
    const seg = next[n - 1]!;
    const dv = value - seg.function.p3;
    seg.function.p3 = value;
    seg.function.p2 += dv;
  }
  return next;
}

/**
 * Move a tangent control value of key `keyIndex`: `out` = its segment's p1
 * (exists for every key but the last), `in` = the previous segment's p2
 * (exists for every key but the first).
 */
export function moveTangent(
  segments: CurveSegment[],
  keyIndex: number,
  which: 'in' | 'out',
  value: number,
): CurveSegment[] {
  const next = cloneSegments(segments);
  if (which === 'out' && keyIndex < next.length) {
    next[keyIndex]!.function.p1 = value;
  } else if (which === 'in' && keyIndex > 0 && keyIndex <= next.length) {
    next[keyIndex - 1]!.function.p2 = value;
  }
  return next;
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** Evaluate the curve at normalized time t (matches quarks' genValue). */
export function sampleCurve(segments: CurveSegment[], t: number): number {
  for (let i = 0; i < segments.length; i++) {
    const start = segments[i]!.start;
    const end = segmentEnd(segments, i);
    if (t >= start && t <= end) {
      const u = end > start ? (t - start) / (end - start) : 0;
      const { p0, p1, p2, p3 } = segments[i]!.function;
      const b01 = lerp(p0, p1, u);
      const b12 = lerp(p1, p2, u);
      const b23 = lerp(p2, p3, u);
      const b012 = lerp(b01, b12, u);
      const b123 = lerp(b12, b23, u);
      return lerp(b012, b123, u);
    }
  }
  return 0;
}

/**
 * Insert a key at time `t` by de Casteljau subdivision of the containing
 * segment — the curve's shape is EXACTLY preserved. Returns the input
 * unchanged when `t` falls outside the curve or too close to an existing key.
 */
export function splitAt(segments: CurveSegment[], t: number): CurveSegment[] {
  for (let i = 0; i < segments.length; i++) {
    const start = segments[i]!.start;
    const end = segmentEnd(segments, i);
    if (t <= start + MIN_SEGMENT_WIDTH || t >= end - MIN_SEGMENT_WIDTH) continue;
    if (t < start || t > end) continue;
    const u = (t - start) / (end - start);
    const { p0, p1, p2, p3 } = segments[i]!.function;
    const b01 = lerp(p0, p1, u);
    const b12 = lerp(p1, p2, u);
    const b23 = lerp(p2, p3, u);
    const b012 = lerp(b01, b12, u);
    const b123 = lerp(b12, b23, u);
    const mid = lerp(b012, b123, u);
    const next = cloneSegments(segments);
    next.splice(
      i,
      1,
      { start, function: { p0, p1: b01, p2: b012, p3: mid } },
      { start: t, function: { p0: mid, p1: b123, p2: b23, p3 } },
    );
    return next;
  }
  return segments;
}

/**
 * Delete interior key `keyIndex`, merging its two adjacent segments. The
 * merged bezier keeps both outer endpoints and rescales the outer tangent
 * controls so endpoint SLOPES are preserved (the interior wiggle is
 * re-fitted — same approximation Unity's curve editor makes). Endpoint keys
 * are not deletable; returns the input unchanged for them.
 */
export function deleteKey(segments: CurveSegment[], keyIndex: number): CurveSegment[] {
  if (keyIndex <= 0 || keyIndex >= segments.length) return segments;
  const left = segments[keyIndex - 1]!;
  const right = segments[keyIndex]!;
  const leftDur = right.start - left.start;
  const rightDur = segmentEnd(segments, keyIndex) - right.start;
  const total = leftDur + rightDur;
  if (total <= 0) return segments;
  const lf = left.function;
  const rf = right.function;
  const merged: CurveSegment = {
    start: left.start,
    function: {
      p0: lf.p0,
      p1: lf.p0 + (lf.p1 - lf.p0) * (leftDur > 0 ? total / leftDur : 1),
      p2: rf.p3 + (rf.p2 - rf.p3) * (rightDur > 0 ? total / rightDur : 1),
      p3: rf.p3,
    },
  };
  const next = cloneSegments(segments);
  next.splice(keyIndex - 1, 2, merged);
  return next;
}

/** Min/max over every control value (bezier hull bounds the curve). */
export function curveValueRange(segments: CurveSegment[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of segments) {
    for (const v of [s.function.p0, s.function.p1, s.function.p2, s.function.p3]) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return { min, max };
}
