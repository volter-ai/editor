/**
 * THE ILLUSTRATOR VERBS — the construction layer over SVG path data.
 *
 * Same causal pattern as the mesh kit's Blender verbs: transcribe the
 * OPERATOR vocabulary of the tool a human would reach for, as pure functions
 * with explicit inputs and outputs, and skip the human half (canvas, palettes,
 * live handles). Everything here takes path `d` strings and/or point lists and
 * returns path `d` strings, so a verb's output is an ordinary shape a rig can
 * fill and stroke.
 *
 * THE GEOMETRY CORE IS A REAL LIBRARY. Boolean ops and path offsetting ride
 * `clipper2-js` (Clipper2, the reference implementation of both). Nothing here
 * hand-rolls a polygon clipper.
 *
 * CURVES FLATTEN FOR BOOLEAN WORK, at `FLATTEN_TOLERANCE` below — Clipper is an
 * INTEGER polygon clipper and has no notion of a bezier. That is the one lossy
 * step in this file and it is stated rather than hidden: a `union` of two
 * curved shapes comes back as a polyline whose maximum deviation from the true
 * curve is under a twentieth of a baked pixel. Verbs that do NOT need booleans
 * (`mirrorX`) transform the path data itself and stay exact.
 *
 * DEMAND, NOT SPECULATION. Every verb here has a caller in the donor art it
 * was extracted for, cited on the verb:
 *   - `subtract` — the donor drew its crescent blade as a spine plus a
 *     thickness profile with the comment "two circles subtracted from each
 *     other is the other way to draw this, and Pixi has no boolean ops"
 *     (`rigs.ts:640-646`). It does now.
 *   - `union` + `outline` — one chunky ink silhouette behind a creature made of
 *     several parts, in place of a stroke per part (`rigs.ts:433-471`).
 *   - `intersect` + `inset` — inside `rimLight`.
 *   - `rimLight` — the donor hand-drew the hood's crown rim as a third bezier
 *     shape (`rigs.ts:321-327`).
 *   - `roundCorners` — the brute's angular carapace polygon (`rigs.ts:531-534`).
 *   - `smooth` — the hero's cape and robe silhouettes, authored as anchors
 *     rather than as hand-solved bezier control points (`rigs.ts:181-198`).
 *   - `mirrorX` — every symmetric pair the donor wrote out twice: imp horns,
 *     brows and eyes (`rigs.ts:434-435`, `459-460`), brute spikes, slits and
 *     tusks (`rigs.ts:507-524`, `547-560`).
 *   - `ramp` — the ad-hoc colour literals the donor's named palette did not
 *     cover (`rigs.ts:189`, `197`, `336`, `453`, `553`, `557`, `561`).
 */

import { Clipper, FillRule, type Path64, type Paths64 } from 'clipper2-js';

export type Point = readonly [number, number];

/**
 * Clipper works in integers. Every coordinate is multiplied by this before a
 * boolean/offset and divided back after, so the effective grid is a
 * thousandth of a baked pixel.
 */
const CLIPPER_SCALE = 1000;

/** Maximum deviation, in baked pixels, when a curve is flattened to a polyline. */
export const FLATTEN_TOLERANCE = 0.05;

// ---------------------------------------------------------------------------
// Path data ⇄ polygons
// ---------------------------------------------------------------------------

interface PathCommand {
  readonly op: string;
  readonly args: readonly number[];
}

/**
 * Parse ABSOLUTE `M L C Q A Z` path data — the exact grammar `PathBuilder`
 * emits. Anything else throws by name rather than being skipped: a silently
 * dropped command is a shape that quietly loses a limb.
 */
function parsePath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const tokenizer = /([MLCQAZ])([^MLCQAZ]*)/gi;
  let match = tokenizer.exec(d);
  if (match === null && d.trim().length > 0) {
    throw new Error(`sprite/verbs: unparsable path data ${JSON.stringify(d.slice(0, 40))}`);
  }
  while (match !== null) {
    const op = match[1] ?? '';
    if (op !== op.toUpperCase()) {
      throw new Error(
        `sprite/verbs: relative path command "${op}" — this kit emits absolute commands only.`,
      );
    }
    const args = (match[2] ?? '')
      .split(/[\s,]+/)
      .filter((token) => token.length > 0)
      .map((token) => {
        const value = Number(token);
        if (!Number.isFinite(value)) {
          throw new Error(`sprite/verbs: non-numeric path argument ${JSON.stringify(token)}`);
        }
        return value;
      });
    commands.push({ op, args });
    match = tokenizer.exec(d);
  }
  return commands;
}

function sampleCubic(
  from: Point,
  c1: Point,
  c2: Point,
  to: Point,
  tolerance: number,
  out: number[],
): void {
  // Step count from the control polygon's length — cheap, monotone in the
  // curve's actual size, and never zero.
  const span =
    Math.hypot(c1[0] - from[0], c1[1] - from[1]) +
    Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) +
    Math.hypot(to[0] - c2[0], to[1] - c2[1]);
  const steps = Math.max(2, Math.ceil(Math.sqrt(span / tolerance)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push(
      u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
      u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1],
    );
  }
}

/** Endpoint-parameterized elliptical arc → sampled points (SVG F.6.5). */
function sampleArc(
  from: Point,
  rx: number,
  ry: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
  tolerance: number,
  out: number[],
): void {
  if (rx === 0 || ry === 0) {
    out.push(to[0], to[1]);
    return;
  }
  const phi = (rotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cosPhi * dx + sinPhi * dy;
  const y1 = -sinPhi * dx + cosPhi * dy;
  let ax = Math.abs(rx);
  let ay = Math.abs(ry);
  const lambda = (x1 * x1) / (ax * ax) + (y1 * y1) / (ay * ay);
  if (lambda > 1) {
    const root = Math.sqrt(lambda);
    ax *= root;
    ay *= root;
  }
  const numerator = Math.max(0, ax * ax * ay * ay - ax * ax * y1 * y1 - ay * ay * x1 * x1);
  const denominator = ax * ax * y1 * y1 + ay * ay * x1 * x1;
  const factor =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(denominator === 0 ? 0 : numerator / denominator);
  const cx1 = (factor * ax * y1) / ay;
  const cy1 = (-factor * ay * x1) / ax;
  const cx = cosPhi * cx1 - sinPhi * cy1 + (from[0] + to[0]) / 2;
  const cy = sinPhi * cx1 + cosPhi * cy1 + (from[1] + to[1]) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    return sign * Math.acos(Math.min(1, Math.max(-1, len === 0 ? 1 : dot / len)));
  };
  const theta = angle(1, 0, (x1 - cx1) / ax, (y1 - cy1) / ay);
  let delta = angle((x1 - cx1) / ax, (y1 - cy1) / ay, (-x1 - cx1) / ax, (-y1 - cy1) / ay);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const radius = Math.max(ax, ay);
  const steps = Math.max(
    2,
    Math.ceil(Math.abs(delta) / (2 * Math.acos(Math.max(-1, 1 - tolerance / radius)))),
  );
  for (let i = 1; i <= steps; i++) {
    const t = theta + (delta * i) / steps;
    const ex = ax * Math.cos(t);
    const ey = ay * Math.sin(t);
    out.push(cosPhi * ex - sinPhi * ey + cx, sinPhi * ex + cosPhi * ey + cy);
  }
}

/**
 * Path data → closed polygons, as flat `[x, y, …]` lists. Every subpath is
 * treated as closed: booleans are area operations and an open subpath has no
 * area to speak of.
 */
export function flattenPath(d: string, tolerance = FLATTEN_TOLERANCE): number[][] {
  const polygons: number[][] = [];
  let current: number[] = [];
  let cursor: Point = [0, 0];
  let start: Point = [0, 0];
  const finish = (): void => {
    if (current.length >= 6) polygons.push(current);
    current = [];
  };
  for (const { op, args } of parsePath(d)) {
    switch (op) {
      case 'M': {
        finish();
        for (let i = 0; i + 1 < args.length; i += 2) {
          const x = args[i] ?? 0;
          const y = args[i + 1] ?? 0;
          if (i === 0) {
            cursor = [x, y];
            start = cursor;
            current.push(x, y);
          } else {
            current.push(x, y);
            cursor = [x, y];
          }
        }
        break;
      }
      case 'L': {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const x = args[i] ?? 0;
          const y = args[i + 1] ?? 0;
          current.push(x, y);
          cursor = [x, y];
        }
        break;
      }
      case 'Q': {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const cx = args[i] ?? 0;
          const cy = args[i + 1] ?? 0;
          const x = args[i + 2] ?? 0;
          const y = args[i + 3] ?? 0;
          // Degree-elevate to a cubic: exact, and one sampler covers both.
          sampleCubic(
            cursor,
            [cursor[0] + (2 / 3) * (cx - cursor[0]), cursor[1] + (2 / 3) * (cy - cursor[1])],
            [x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y)],
            [x, y],
            tolerance,
            current,
          );
          cursor = [x, y];
        }
        break;
      }
      case 'C': {
        for (let i = 0; i + 5 < args.length; i += 6) {
          const to: Point = [args[i + 4] ?? 0, args[i + 5] ?? 0];
          sampleCubic(
            cursor,
            [args[i] ?? 0, args[i + 1] ?? 0],
            [args[i + 2] ?? 0, args[i + 3] ?? 0],
            to,
            tolerance,
            current,
          );
          cursor = to;
        }
        break;
      }
      case 'A': {
        for (let i = 0; i + 6 < args.length; i += 7) {
          const to: Point = [args[i + 5] ?? 0, args[i + 6] ?? 0];
          sampleArc(
            cursor,
            args[i] ?? 0,
            args[i + 1] ?? 0,
            args[i + 2] ?? 0,
            (args[i + 3] ?? 0) !== 0,
            (args[i + 4] ?? 0) !== 0,
            to,
            tolerance,
            current,
          );
          cursor = to;
        }
        break;
      }
      case 'Z': {
        cursor = start;
        finish();
        break;
      }
      default:
        throw new Error(`sprite/verbs: unsupported path command "${op}"`);
    }
  }
  finish();
  return polygons;
}

/** Flat `[x, y, …]` polygons → closed path data. */
export function polygonsToPath(polygons: readonly (readonly number[])[]): string {
  const parts: string[] = [];
  for (const polygon of polygons) {
    if (polygon.length < 6) continue;
    const chunks: string[] = [`M${round(polygon[0] ?? 0)} ${round(polygon[1] ?? 0)}`];
    for (let i = 2; i + 1 < polygon.length; i += 2) {
      chunks.push(`L${round(polygon[i] ?? 0)} ${round(polygon[i + 1] ?? 0)}`);
    }
    chunks.push('Z');
    parts.push(chunks.join(''));
  }
  return parts.join('');
}

function round(value: number): number {
  const rounded = Number(value.toFixed(4));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Scale to Clipper's integer grid, dropping REPEATED VERTICES as we go —
 * including the one where a closed subpath's last point lands back on its
 * first.
 *
 * This is not tidying. A zero-length edge is a degenerate input to both the
 * clipper and the offsetter, and the failure it produces is silent and
 * spectacular: an ellipse built from two half arcs ends where it began, and
 * offsetting that 51-point path inward returned a shape whose ring, when
 * subtracted, came back as ONE self-crossing star polygon instead of two
 * boundaries. Nothing errored — it just rendered as a zigzag sunburst.
 */
function toClipper(polygons: readonly (readonly number[])[]): Paths64 {
  const paths = [] as unknown as Paths64;
  for (const polygon of polygons) {
    const scaled: number[] = [];
    for (let i = 0; i + 1 < polygon.length; i += 2) {
      const x = Math.round((polygon[i] ?? 0) * CLIPPER_SCALE);
      const y = Math.round((polygon[i + 1] ?? 0) * CLIPPER_SCALE);
      if (
        scaled.length >= 2 &&
        scaled[scaled.length - 2] === x &&
        scaled[scaled.length - 1] === y
      ) {
        continue;
      }
      scaled.push(x, y);
    }
    while (
      scaled.length >= 4 &&
      scaled[0] === scaled[scaled.length - 2] &&
      scaled[1] === scaled[scaled.length - 1]
    ) {
      scaled.length -= 2;
    }
    if (scaled.length >= 6) paths.push(Clipper.makePath(scaled));
  }
  return paths;
}

/** Signed area of a flat `[x, y, …]` polygon, in the polygon's own units. */
function signedArea(polygon: readonly number[]): number {
  let total = 0;
  for (let i = 0; i + 1 < polygon.length; i += 2) {
    const nx = polygon[(i + 2) % polygon.length] ?? 0;
    const ny = polygon[(i + 3) % polygon.length] ?? 0;
    total += (polygon[i] ?? 0) * ny - nx * (polygon[i + 1] ?? 0);
  }
  return total / 2;
}

/**
 * Below this (square baked pixels) a returned polygon is an artifact, not a
 * shape: a boolean over hundreds of overlapping pieces routinely emits hairline
 * slivers of ~1e-3 px² along a boundary it just walked, and they survive into
 * the path data as dozens of points describing nothing visible.
 */
const SLIVER_AREA = 0.01;

function fromClipper(paths: Paths64): number[][] {
  const polygons: number[][] = [];
  for (const path of paths as unknown as Path64[]) {
    const flat: number[] = [];
    for (const point of path) flat.push(point.x / CLIPPER_SCALE, point.y / CLIPPER_SCALE);
    if (flat.length >= 6 && Math.abs(signedArea(flat)) >= SLIVER_AREA) polygons.push(flat);
  }
  return polygons;
}

/**
 * Path data → Clipper paths in CANONICAL ORIENTATION (outer boundaries
 * positive, holes negative), by running the flattened input through a union.
 *
 * The union is not redundant tidying — orientation is an INPUT to Clipper's
 * offsetter, and getting it wrong fails silently and prettily. An ellipse built
 * from two SVG half-arcs comes out negatively oriented; offsetting that inward
 * returned a shape whose every source vertex grew an outward spike, because the
 * offsetter's own self-intersection cleanup picks its fill rule from the input's
 * orientation. It rendered as a cyan sea urchin, and nothing anywhere reported
 * a problem.
 */
function clipperOf(d: string): Paths64 {
  return Clipper.Union(toClipper(flattenPath(d)), undefined, FillRule.NonZero);
}

// ---------------------------------------------------------------------------
// Booleans
// ---------------------------------------------------------------------------

/**
 * Merge shapes into one region. With `outline` below, this is the chunky
 * arcade ink: union the parts, offset the union, fill it behind the art — one
 * silhouette instead of a stroke per part, which is what a stroke-per-part rig
 * cannot give you (its internal seams show through wherever the parts differ
 * in value).
 */
export function union(...shapes: readonly string[]): string {
  const merged = shapes.flatMap((d) => flattenPath(d));
  return polygonsToPath(fromClipper(Clipper.Union(toClipper(merged), undefined, FillRule.NonZero)));
}

/** `a` minus `b`. The crescent the donor could not cut (`rigs.ts:640-646`). */
export function subtract(a: string, b: string): string {
  return polygonsToPath(
    fromClipper(Clipper.Difference(clipperOf(a), clipperOf(b), FillRule.NonZero)),
  );
}

/** The region both shapes cover. Used by `rimLight` to clip a band to one side. */
export function intersect(a: string, b: string): string {
  return polygonsToPath(
    fromClipper(Clipper.Intersect(clipperOf(a), clipperOf(b), FillRule.NonZero)),
  );
}

// ---------------------------------------------------------------------------
// Offsetting
// ---------------------------------------------------------------------------

/**
 * PATH OFFSET — grow a shape outward by `width`, with round joins.
 *
 * This is the chunky look as ONE call. A stroke draws a line centred on an
 * edge; an offset produces a REGION you can fill, so the ink can sit behind
 * everything (no half-covered strokes where parts overlap) and can be a
 * different shape from the art it backs.
 */
/** A regular polygon approximating a circle to within `FLATTEN_TOLERANCE`. */
function disc(cx: number, cy: number, radius: number): number[] {
  const steps = Math.max(
    8,
    Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - FLATTEN_TOLERANCE / radius))),
  );
  const points: number[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    points.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  return points;
}

/**
 * The BOUNDARY BAND: every point within `radius` of the shape's outline — the
 * Minkowski sum of the boundary with a disc, built as one union of a quad per
 * edge and a disc per vertex.
 *
 * WHY THIS IS NOT `ClipperOffset`. It should be: the library ships an offsetter
 * and offsetting is exactly what this is. `clipper2-js@1.2.4`'s offsetter is
 * WRONG, in both directions, and wrong in a way that renders rather than
 * throws — a 51-vertex ellipse offset by 5 comes back with a spike at every
 * source vertex (a sea urchin), for `InflatePaths` and `ClipperOffset` alike,
 * at the default arc tolerance and at any other, with round, bevel or square
 * joins, and a union cleanup at any fill rule does not remove them (they are
 * not self-intersections — the join arcs are simply swung the wrong way).
 * Measured against the analytic areas: 2093 expected, 1978 produced growing;
 * 775 expected, 830 produced shrinking.
 *
 * What the library gets RIGHT — its boolean core — is what this uses, so the
 * verb still rides Clipper rather than a hand-rolled clipper. The construction
 * is the textbook definition of a round offset, not an approximation of one.
 */
function boundaryBand(paths: Paths64, radius: number): Paths64 {
  const pieces: number[][] = [];
  for (const path of paths as unknown as Path64[]) {
    const count = path.length;
    for (let i = 0; i < count; i++) {
      const a = path[i];
      const b = path[(i + 1) % count];
      if (!a || !b) continue;
      const ax = a.x / CLIPPER_SCALE;
      const ay = a.y / CLIPPER_SCALE;
      const bx = b.x / CLIPPER_SCALE;
      const by = b.y / CLIPPER_SCALE;
      pieces.push(disc(ax, ay, radius));
      const length = Math.hypot(bx - ax, by - ay);
      if (length === 0) continue;
      const nx = (-(by - ay) / length) * radius;
      const ny = ((bx - ax) / length) * radius;
      pieces.push([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]);
    }
  }
  // Every piece must wind the SAME WAY before the union. Under NonZero a
  // reversed piece SUBTRACTS, so a quad that happened to be built clockwise
  // punched a hole in the disc it overlapped and the band came back as a
  // hundred slivers instead of one ring.
  const oriented = pieces.map((piece) => (signedArea(piece) < 0 ? reverseFlat(piece) : piece));
  return Clipper.Union(toClipper(oriented), undefined, FillRule.NonZero);
}

function reverseFlat(polygon: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = polygon.length - 2; i >= 0; i -= 2) out.push(polygon[i] ?? 0, polygon[i + 1] ?? 0);
  return out;
}

export function outline(d: string, width: number): string {
  if (width === 0) return d;
  const shape = clipperOf(d);
  const band = boundaryBand(shape, Math.abs(width));
  const grown =
    width > 0
      ? Clipper.Union(concatPaths(shape, band), undefined, FillRule.NonZero)
      : Clipper.Difference(shape, band, FillRule.NonZero);
  return polygonsToPath(fromClipper(grown));
}

function concatPaths(a: Paths64, b: Paths64): Paths64 {
  const merged = [] as unknown as Paths64;
  for (const path of a as unknown as Path64[]) merged.push(path);
  for (const path of b as unknown as Path64[]) merged.push(path);
  return merged;
}

/** The same offset inward. `rimLight` subtracts an inset copy to get its band. */
export function inset(d: string, width: number): string {
  return outline(d, -width);
}

// ---------------------------------------------------------------------------
// Curve construction
// ---------------------------------------------------------------------------

/**
 * A smooth closed (or open) curve THROUGH `points` — a Catmull-Rom spline
 * emitted as cubic beziers.
 *
 * Authoring a silhouette as the points it passes through, rather than as
 * hand-solved bezier control points, is what makes a shape editable: move an
 * anchor and the curve still reads. `tension` in [0, 1] scales the tangents;
 * 0.5 is the classical Catmull-Rom and the flattest-looking default.
 */
export function smooth(
  points: readonly Point[],
  tension = 0.5,
  options: { closed?: boolean } = {},
): string {
  const closed = options.closed ?? true;
  const count = points.length;
  if (count < 2) return '';
  const at = (index: number): Point => {
    if (closed) return points[((index % count) + count) % count] ?? [0, 0];
    return points[Math.min(count - 1, Math.max(0, index))] ?? [0, 0];
  };
  const first = at(0);
  const parts: string[] = [`M${round(first[0])} ${round(first[1])}`];
  const last = closed ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Point = [
      p1[0] + ((p2[0] - p0[0]) * tension) / 3,
      p1[1] + ((p2[1] - p0[1]) * tension) / 3,
    ];
    const c2: Point = [
      p2[0] - ((p3[0] - p1[0]) * tension) / 3,
      p2[1] - ((p3[1] - p1[1]) * tension) / 3,
    ];
    parts.push(
      `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ` +
        `${round(p2[0])} ${round(p2[1])}`,
    );
  }
  if (closed) parts.push('Z');
  return parts.join('');
}

/**
 * Round a polygon's corners by `radius` — the angular-shape verb.
 *
 * Each corner is cut back along both of its edges by at most half the shorter
 * edge (so adjacent corners can never eat each other) and joined by a circular
 * arc. The silhouette stays the polygon's; only the corners soften.
 */
function roundOneCorner(
  previous: Point,
  corner: Point,
  next: Point,
  radius: number,
  lead: string,
): string {
  const backLength = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
  const forwardLength = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
  const cut = Math.min(radius, backLength / 2, forwardLength / 2);
  if (cut <= 0) return `${lead}${round(corner[0])} ${round(corner[1])}`;
  const enterX = corner[0] + ((previous[0] - corner[0]) / backLength) * cut;
  const enterY = corner[1] + ((previous[1] - corner[1]) / backLength) * cut;
  const leaveX = corner[0] + ((next[0] - corner[0]) / forwardLength) * cut;
  const leaveY = corner[1] + ((next[1] - corner[1]) / forwardLength) * cut;
  // Which way the arc turns is the sign of the cross product of the two edges —
  // a convex corner and a reflex one sweep opposite ways.
  const cross =
    (corner[0] - previous[0]) * (next[1] - corner[1]) -
    (corner[1] - previous[1]) * (next[0] - corner[0]);
  return (
    `${lead}${round(enterX)} ${round(enterY)}` +
    `A${round(cut)} ${round(cut)} 0 0 ${cross >= 0 ? 1 : 0} ${round(leaveX)} ${round(leaveY)}`
  );
}

export function roundCorners(points: readonly Point[], radius: number): string {
  const count = points.length;
  if (count < 3 || radius <= 0) {
    return polygonsToPath([points.flatMap((point) => [point[0], point[1]])]);
  }
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    parts.push(
      roundOneCorner(
        points[(i - 1 + count) % count] ?? [0, 0],
        points[i] ?? [0, 0],
        points[(i + 1) % count] ?? [0, 0],
        radius,
        i === 0 ? 'M' : 'L',
      ),
    );
  }
  parts.push('Z');
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Symmetry
// ---------------------------------------------------------------------------

/**
 * Mirror path data across the vertical line `x = axis`, EXACTLY — the data is
 * transformed command by command, never flattened, so a mirrored curve is
 * still the same curve.
 *
 * Author one side, mirror it, and the pair can never drift: the donor wrote
 * every symmetric part twice, and a coordinate typo in the second copy is
 * invisible until someone looks at a 26px sprite very closely.
 */
/** One `A` command's seven arguments, mirrored. The SWEEP FLAG flips: a mirror
 *  reverses the sense in which the arc is swept. */
function mirrorArcArgs(args: readonly number[], flip: (x: number) => number): number[] {
  const values: number[] = [];
  for (let i = 0; i + 6 < args.length; i += 7) {
    values.push(
      args[i] ?? 0,
      args[i + 1] ?? 0,
      args[i + 2] ?? 0,
      args[i + 3] ?? 0,
      (args[i + 4] ?? 0) !== 0 ? 0 : 1,
      flip(args[i + 5] ?? 0),
      args[i + 6] ?? 0,
    );
  }
  return values;
}

export function mirrorX(d: string, axis = 0): string {
  const flip = (x: number): number => round(2 * axis - x);
  const parts: string[] = [];
  for (const { op, args } of parsePath(d)) {
    if (op === 'Z') {
      parts.push('Z');
      continue;
    }
    const values: number[] = [];
    if (op === 'A') {
      values.push(...mirrorArcArgs(args, flip));
    } else {
      for (let i = 0; i + 1 < args.length; i += 2) {
        values.push(flip(args[i] ?? 0), round(args[i + 1] ?? 0));
      }
    }
    parts.push(op + values.join(' '));
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export interface ColorRamp {
  /** Deepest shadow: the value a form turns at its darkest before ink. */
  readonly shadow: number;
  /** The shaded body of a form. */
  readonly deep: number;
  readonly base: number;
  /** A lit plane. */
  readonly light: number;
  /** The hot rim / specular. */
  readonly pale: number;
}

function rgbToHsl(color: number): [number, number, number] {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / delta + 2) / 6;
  else hue = ((r - g) / delta + 4) / 6;
  return [hue, saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): number {
  const h = ((hue % 1) + 1) % 1;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  if (s === 0) {
    const value = Math.round(l * 255);
    return (value << 16) | (value << 8) | value;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return (
    (Math.round(channel(h + 1 / 3) * 255) << 16) |
    (Math.round(channel(h) * 255) << 8) |
    Math.round(channel(h - 1 / 3) * 255)
  );
}

/**
 * A five-value ramp from one base colour, HUE-SHIFTED rather than merely
 * darkened and lightened.
 *
 * Shading by lightness alone gives grey mud: what reads as light is a shift
 * toward the light's own hue and what reads as shadow is a shift toward the
 * ambient's — the standard painter's move, and the one the donor's named
 * palette families already encode by hand (`sprite-palette.ts:26-47`: every
 * family is exactly SHADE / DEEP / BASE / LIFT). `hueShift` is in turns
 * (1 = 360°); positive rotates shadows one way and lights the other.
 */
export function ramp(
  base: number,
  options: { hueShift?: number; range?: number; saturateShadow?: number } = {},
): ColorRamp {
  const hueShift = options.hueShift ?? 0.04;
  const range = options.range ?? 0.32;
  const saturateShadow = options.saturateShadow ?? 0.12;
  const [hue, saturation, lightness] = rgbToHsl(base);
  const make = (level: number, shift: number, saturationDelta: number): number =>
    hslToRgb(hue + shift, saturation + saturationDelta, lightness + level);
  return {
    shadow: make(-range, -hueShift * 1.6, saturateShadow),
    deep: make(-range / 2, -hueShift, saturateShadow / 2),
    base,
    light: make(range / 2, hueShift, -saturateShadow / 3),
    pale: make(range, hueShift * 1.6, -saturateShadow),
  };
}

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------

/** `[minX, minY, maxX, maxY]` of a path, flattened. Infinite when it is empty. */
function pathBounds(d: string): [number, number, number, number] {
  // Accumulated rather than spread into `Math.min`: a flattened tile runs to
  // thousands of points, and a spread of that many arguments overflows.
  const bounds: [number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const polygon of flattenPath(d)) {
    for (let i = 0; i + 1 < polygon.length; i += 2) {
      const x = polygon[i] ?? 0;
      const y = polygon[i + 1] ?? 0;
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
  }
  return bounds;
}

/**
 * The lit band along the side of a silhouette a light falls on: an INSET BAND
 * (the shape minus a copy of itself shrunk by `depth`) INTERSECTED with the
 * half-plane facing `direction`.
 *
 * That is the whole trick that makes a flat filled shape read as round — and
 * it is a construction, not a drawing, so it tracks the silhouette instead of
 * having to be re-drawn beside it whenever the form changes.
 *
 * `direction` points TOWARD the light. It need not be normalized.
 */
export function rimLight(
  silhouette: string,
  direction: Point,
  depth: number,
  options: { offset?: number } = {},
): string {
  const band = subtract(silhouette, inset(silhouette, depth));
  const [minX, minY, maxX, maxY] = pathBounds(silhouette);
  if (!Number.isFinite(minX)) return '';
  const length = Math.hypot(direction[0], direction[1]) || 1;
  const nx = direction[0] / length;
  const ny = direction[1] / length;
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const span = Math.hypot(maxX - minX, maxY - minY) + Math.abs(depth) * 4 + 4;
  // The half-plane as a rectangle far larger than the shape: its near edge is
  // the cut, `offset` slides that edge along the light direction.
  const cutX = centreX + nx * (options.offset ?? 0);
  const cutY = centreY + ny * (options.offset ?? 0);
  const tx = -ny;
  const ty = nx;
  const corners: number[] = [
    cutX + tx * span,
    cutY + ty * span,
    cutX - tx * span,
    cutY - ty * span,
    cutX - tx * span + nx * span,
    cutY - ty * span + ny * span,
    cutX + tx * span + nx * span,
    cutY + ty * span + ny * span,
  ];
  return intersect(band, polygonsToPath([corners]));
}
