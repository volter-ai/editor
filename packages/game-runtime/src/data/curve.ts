/**
 * Curve FIELDS in data assets — a response curve a designer shapes, living
 * inside an ordinary `.data.json` like any other tunable value.
 *
 * A curve is a FIELD TYPE, never a file type: there is no `.curve.json`, no
 * curve asset class, no baked LUT, and no document. `curve(axes)` is a real
 * Zod schema you drop into a `*.schema.ts` beside `z.number()`, so the value
 * lives in the same data file, hot-swaps through the same `defineData` handle,
 * and is edited by the same Data panel that edits everything else.
 *
 * The JSON a designer (or an agent) reads and writes:
 *
 * ```json
 * { "interpolation": "smooth",
 *   "points": [{ "x": 0, "y": 1 }, { "x": 12, "y": 0.85 }, { "x": 30, "y": 0.2 }] }
 * ```
 *
 * TWO MODES, NO TANGENTS. `linear` and `smooth`, and nothing else. Per-key
 * tangent handles would double the JSON, make it unreadable to an agent, and
 * hand every author a way to make a curve overshoot its own points. Smoothness
 * is DERIVED instead — Fritsch–Carlson monotone cubic tangents, computed from
 * the points themselves — so the interpolant is guaranteed to stay inside each
 * segment's `[yLeft, yRight]` band. "Shape it by moving points" is the whole
 * authoring model.
 *
 * RUNG AUDIT (recorded decision, 2026-08-14): no npm dependency. The candidate
 * packages (`monotone-cubic-spline` and its siblings) are unmaintained
 * micro-packages, and d3's `curveMonotoneX` is an SVG PATH GENERATOR — it
 * draws, it does not sample `y` at an `x`. What we need is ~40 lines of
 * well-known numerics with no API surface, so it is written here.
 *
 * `sampleCurve` is the entire runtime: a pure function, no class, no cache
 * object, no "curve system". Game code calls it every frame from its own
 * update, the same way it reads any other tuning value.
 */

import { z } from 'zod';

/** One authored key: a `y` value at an `x` position. No tangents — see above. */
export interface CurvePoint {
  x: number;
  y: number;
}

/** A curve field's value, exactly as it sits in the `.data.json`. */
export interface CurveValue {
  interpolation: 'linear' | 'smooth';
  points: CurvePoint[];
}

/**
 * The curve's DOMAIN, declared by the engineer in the schema (never by the
 * data): what the axes mean and how far they run. The editor draws its rails
 * from this and clamps every drag to it; the schema rejects a point outside
 * it.
 */
export interface CurveAxes {
  x: { min: number; max: number; label?: string };
  y: { min: number; max: number; label?: string };
}

/** How the marker rides out to the emitted JSON Schema — the editor's detection key, the exact shape `dataRef` uses with `x-vgai-ref`. */
const CURVE_META_KEY = 'x-vgai-curve';

function axisLabel(axes: CurveAxes, axis: 'x' | 'y'): string {
  return axes[axis].label ?? axis;
}

/** Every out-of-domain / ordering problem in one pass, as teaching issues (`parseDataJson`'s "errors teach" doctrine, §6.5). */
function checkPoints(value: CurveValue, axes: CurveAxes, ctx: z.RefinementCtx): void {
  const points = value.points;
  for (let i = 0; i < points.length; i++) {
    const point = points[i] as CurvePoint;
    for (const axis of ['x', 'y'] as const) {
      const { min, max } = axes[axis];
      if (point[axis] < min || point[axis] > max) {
        ctx.addIssue({
          code: 'custom',
          path: ['points', i, axis],
          message:
            `${point[axis]} is outside this curve's ${axisLabel(axes, axis)} domain ` +
            `[${min}, ${max}] — move the point inside the domain, or widen the axis in the ` +
            `schema (curve({ ${axis}: { min, max } })).`,
        });
      }
    }
    if (i === 0) continue;
    const previous = points[i - 1] as CurvePoint;
    if (point.x <= previous.x) {
      ctx.addIssue({
        code: 'custom',
        path: ['points', i, 'x'],
        message:
          `${point.x} must be strictly greater than the previous point's x (${previous.x}) — ` +
          'curve points run left to right along x, with no duplicate x. Sort the points, or ' +
          'nudge this one.',
      });
    }
  }
}

/**
 * A Zod schema for a data-asset FIELD holding a response curve. Use it in a
 * `.schema.ts` exactly like any other field:
 *
 * ```ts
 * export const TuningSchema = z.object({
 *   spawnRate: z.number().min(0).max(10).default(1),
 *   difficultyRamp: curve({
 *     x: { min: 0, max: 300, label: 'Sim time (s)' },
 *     y: { min: 0, max: 2, label: 'Spawn multiplier' },
 *   }).describe('How hard the game leans on the player as the round runs.'),
 * });
 * ```
 *
 * The schema is STRICT (an unrecognized key is an error, never a silent
 * strip), demands at least two points, and enforces strictly-increasing `x`
 * with every point inside the declared axes — each with a message that names
 * the fix rather than the rule.
 *
 * The emitted JSON Schema (`toDataJsonSchema`) carries
 * `"x-vgai-curve": axes` — a Zod `.meta()`, which survives `z.toJSONSchema`
 * including inside a table's `additionalProperties` row schema, exactly the
 * way `dataRef`'s `"x-vgai-ref"` does. That marker is what makes the editor's
 * Data panel render a curve EDITOR instead of a raw-JSON cell, with no emitter
 * changes anywhere.
 */
export function curve(axes: CurveAxes): z.ZodType<CurveValue> {
  const point = z.strictObject({
    x: z.number().describe(`Position along ${axisLabel(axes, 'x')}.`),
    y: z.number().describe(`Value at that position, along ${axisLabel(axes, 'y')}.`),
  });
  return z
    .strictObject({
      interpolation: z
        .enum(['linear', 'smooth'])
        .describe(
          'How the value moves between points: "linear" for straight segments, ' +
            '"smooth" for a monotone cubic that never overshoots them.',
        ),
      points: z
        .array(point)
        .min(2, {
          message:
            'a curve needs at least two points — add another { "x": …, "y": … } so the ' +
            'value has somewhere to travel between.',
        })
        .describe('Keys in increasing x order; the value is clamped outside the first/last x.'),
    })
    .superRefine((value, ctx) => checkPoints(value, axes, ctx))
    .meta({ [CURVE_META_KEY]: axes }) as unknown as z.ZodType<CurveValue>;
}

/**
 * Read a curve field's declared axes back off a LIVE Zod schema (as opposed to
 * the emitted JSON Schema, which the editor's Data panel reads instead).
 *
 * This is the dev-tools capability's detection door: it derives its rows by
 * walking the game's own `TuningSchema` object, so it needs the axes from the
 * schema in hand. Wrappers (`.optional()`, `.default(…)`, `.describe(…)` chains
 * that re-wrap) hide the metadata behind an inner type, so a bounded unwrap
 * walks down to it.
 */
export function curveAxesOf(schema: z.ZodType): CurveAxes | undefined {
  let current: unknown = schema;
  for (let depth = 0; depth < 5 && current; depth++) {
    const meta = (current as z.ZodType).meta?.() as Record<string, unknown> | undefined;
    const axes = meta?.[CURVE_META_KEY];
    if (axes && typeof axes === 'object' && 'x' in axes && 'y' in axes) return axes as CurveAxes;
    current = (current as { def?: { innerType?: unknown } }).def?.innerType;
  }
  return undefined;
}

/**
 * Fritsch–Carlson tangents: the ordinary cubic-Hermite slopes, then limited so
 * the interpolant cannot overshoot the data. This is what makes "smooth" safe
 * to hand a designer — a curve that dips below its own points would silently
 * feed the game a value nobody authored.
 */
function monotoneTangents(points: readonly CurvePoint[]): number[] {
  const n = points.length;
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const left = points[i] as CurvePoint;
    const right = points[i + 1] as CurvePoint;
    secants.push((right.y - left.y) / (right.x - left.x));
  }
  const tangents: number[] = [secants[0] as number];
  for (let i = 1; i < n - 1; i++) {
    tangents.push(((secants[i - 1] as number) + (secants[i] as number)) / 2);
  }
  tangents.push(secants[n - 2] as number);

  for (let i = 0; i < n - 1; i++) {
    const secant = secants[i] as number;
    if (secant === 0) {
      // A flat segment must stay flat: any slope at either end would bulge.
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    let alpha = (tangents[i] as number) / secant;
    let beta = (tangents[i + 1] as number) / secant;
    // A tangent fighting the segment's own direction is a local extremum the
    // data does not have.
    if (alpha < 0) {
      tangents[i] = 0;
      alpha = 0;
    }
    if (beta < 0) {
      tangents[i + 1] = 0;
      beta = 0;
    }
    const radius = alpha * alpha + beta * beta;
    if (radius > 9) {
      const scale = 3 / Math.sqrt(radius);
      tangents[i] = scale * alpha * secant;
      tangents[i + 1] = scale * beta * secant;
    }
  }
  return tangents;
}

/**
 * The curve's value at `x` — the whole runtime API.
 *
 * Read it every frame from the game's own update, the way every other data
 * value is read (`tuning.get()` then sample); never precompute a table, and
 * never hold the result across frames — an edit to the `.data.json` hot-swaps
 * underneath you and that is the point.
 *
 * Outside `[first.x, last.x]` the value CLAMPS to the nearest endpoint: a
 * curve declares what it knows about, and extrapolating past it would invent
 * numbers nobody authored.
 */
export function sampleCurve(value: CurveValue, x: number): number {
  const points = value.points;
  if (points.length === 0) return 0;
  const first = points[0] as CurvePoint;
  const last = points[points.length - 1] as CurvePoint;
  if (points.length === 1 || x <= first.x) return first.y;
  if (x >= last.x) return last.y;

  let i = 0;
  while (i < points.length - 2 && x >= (points[i + 1] as CurvePoint).x) i++;
  const left = points[i] as CurvePoint;
  const right = points[i + 1] as CurvePoint;
  const span = right.x - left.x;
  if (span <= 0) return left.y; // duplicate x — the schema rejects it; a hand-built value might not
  const t = (x - left.x) / span;
  if (value.interpolation === 'linear') return left.y + (right.y - left.y) * t;

  const tangents = monotoneTangents(points);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * left.y +
    (t3 - 2 * t2 + t) * span * (tangents[i] as number) +
    (-2 * t3 + 3 * t2) * right.y +
    (t3 - t2) * span * (tangents[i + 1] as number)
  );
}
