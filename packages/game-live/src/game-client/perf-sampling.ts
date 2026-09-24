/**
 * Pure per-test perf math — no Playwright. Two independent measures:
 *  1. Sim-speed ratio for the whole test (`simSpeedRatio`) — the same
 *     sim-seconds/wall-seconds ratio `failure-block.ts` renders on a
 *     timeout, computed instead between the fixture's fence snapshot and a
 *     final snapshot taken at teardown, regardless of whether the test
 *     passed or failed.
 *  2. Effective ticks-per-second, sampled cheaply off polls `game.waitFor`
 *     was already doing (no extra `page.evaluate()` round trips): each poll
 *     contributes one `(tickDelta / wallDeltaMs)` sample, and this module
 *     summarizes the accumulated samples as p50/p95.
 */

/** One poll's instantaneous ticks-per-second, or `null` when `wallDeltaMs`
 *  is non-positive (first poll / a clock with sub-millisecond resolution) —
 *  callers should simply skip a `null` sample rather than recording it. */
export function computeTicksPerSecond(tickDelta: number, wallDeltaMs: number): number | null {
  if (wallDeltaMs <= 0) return null;
  return (tickDelta / wallDeltaMs) * 1000;
}

/** Nearest-rank percentile (1-indexed rank `ceil(p/100 * n)`, clamped into
 *  range) over an ALREADY-SORTED-ASCENDING array. `0` on an empty input. */
export function percentile(sortedAscending: readonly number[], p: number): number {
  const n = sortedAscending.length;
  if (n === 0) return 0;
  const rank = Math.min(n, Math.max(1, Math.ceil((p / 100) * n)));
  return sortedAscending[rank - 1] as number;
}

export interface TpsStats {
  p50: number;
  p95: number;
  sampleCount: number;
}

/** Summarizes raw ticks-per-second samples (any order) into p50/p95 +
 *  count. `{ p50: 0, p95: 0, sampleCount: 0 }` when there are no samples
 *  (a test that never called `game.waitFor` — honestly reported as zero
 *  samples, never fabricated). */
export function summarizeTpsSamples(samples: readonly number[]): TpsStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    sampleCount: sorted.length,
  };
}

/** Whole-test sim-speed ratio: sim-seconds elapsed over wall-seconds
 *  elapsed. `0` when `wallMs` is non-positive (mirrors `failure-block.ts`'s
 *  own `ratioLine` degrade-to-zero rule for a zero/negative denominator). */
export function simSpeedRatio(simSecondsDelta: number, wallMs: number): number {
  return wallMs > 0 ? simSecondsDelta / (wallMs / 1000) : 0;
}

/**
 * Accumulates one tick-rate sample per snapshot read. `GameClient.snapshot()`
 * calls `record(tick, wallNowMs)` on every read it was already doing (waitFor
 * polls, waitSimTime polls, explicit snapshots) — no extra `page.evaluate()`
 * round trips. The first observation only seeds the baseline; a NEGATIVE
 * tick delta (a page reload reset the sim clock) reseeds rather than
 * recording a nonsense sample; a zero tick delta IS recorded (0 ticks/s is
 * the honest "loop frozen" signal the summary exists to surface).
 */
export class TpsAccumulator {
  private last: { tick: number; wallMs: number } | null = null;
  private readonly samples: number[] = [];

  record(tick: number, wallMs: number): void {
    const last = this.last;
    this.last = { tick, wallMs };
    if (last === null) return;
    const tickDelta = tick - last.tick;
    if (tickDelta < 0) return;
    const tps = computeTicksPerSecond(tickDelta, wallMs - last.wallMs);
    if (tps !== null) this.samples.push(tps);
  }

  /** D15: forgets the baseline (not the accumulated samples) — the NEXT
   *  `record()` call becomes a fresh "first observation" (seeds only, no
   *  sample), exactly like the very first `record()` this accumulator ever
   *  sees. `client.ts`'s `fastForward` calls this right after a burst of
   *  `runTicks`, so the burst's enormous tick delta over a near-zero wall
   *  delta is never diffed into a nonsense tps sample (`fast-forward.ts`'s
   *  module doc, point 2) — real per-poll sampling simply resumes from here. */
  resetBaseline(): void {
    this.last = null;
  }

  stats(): TpsStats {
    return summarizeTpsSamples(this.samples);
  }
}
