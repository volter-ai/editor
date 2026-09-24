/**
 * Main-thread busy sampling for the Profiler's frame-budget accounting.
 *
 * The per-source profiler measures only its own loop's rAF callback. The
 * frame budget also needs "how long did OTHER main-thread tasks run" — React
 * commits, timers, observers — which the browser only attributes above the
 * 50ms long-animation-frame threshold. Below it, the honest measurable is
 * event-loop responsiveness: a self-rescheduling `setTimeout(0)` records the
 * gap between wakeups. Chrome clamps nested zero timeouts to ~4ms, so the
 * SMALLEST gap in a window is the scheduler's baseline and anything above it
 * is time the thread was busy with someone else's work (including the
 * measured loop itself — callers subtract the loop's own measured CPU).
 *
 * Honesty properties:
 * - The baseline is measured per window, never assumed, so throttling changes
 *   (background tab, battery saver) recalibrate instead of fabricating load.
 * - Sustained saturation inflates every gap INCLUDING the minimum, so this
 *   under-reports rather than over-reports busy time. It is a floor.
 * - Cost: ~250 timer wakeups/s of a few µs each — an opt-in instrument that
 *   runs only while the Profiler surface has it started, covered by the
 *   panel's existing "profiling adds measurement overhead" warning.
 */

interface GapSample {
  /** performance.now() at the wakeup that OBSERVED the gap (its end). */
  readonly t: number;
  readonly gapMs: number;
}

/**
 * Pure aggregation (unit-tested): total blocked time across `gaps`, using the
 * window's smallest gap as the scheduler baseline. Fewer than 4 samples is
 * too little signal to call anything busy — returns 0, never a guess.
 */
export function busyMsFromGaps(gaps: readonly number[]): number {
  if (gaps.length < 4) return 0;
  let baseline = Number.POSITIVE_INFINITY;
  for (const gap of gaps) baseline = Math.min(baseline, gap);
  let busy = 0;
  for (const gap of gaps) busy += Math.max(0, gap - baseline);
  return busy;
}

const MAX_SAMPLES = 1200;

export interface MainThreadBusySampler {
  start(): void;
  stop(): void;
  /**
   * Busy ms observed in [sinceMs, now], with the sample count so callers can
   * report honest absence (`null` budget row) instead of a zero when the
   * sampler has not covered the window.
   */
  busySince(sinceMs: number): { busyMs: number; sampleCount: number };
}

export function createMainThreadBusySampler(): MainThreadBusySampler {
  const samples: GapSample[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;

  const tick = (): void => {
    const now = performance.now();
    samples.push({ t: now, gapMs: now - last });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    last = now;
    timer = setTimeout(tick, 0);
  };

  return {
    start() {
      if (timer !== null) return;
      samples.length = 0;
      last = performance.now();
      timer = setTimeout(tick, 0);
    },
    stop() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
    busySince(sinceMs: number) {
      const gaps: number[] = [];
      for (const sample of samples) {
        if (sample.t >= sinceMs) gaps.push(sample.gapMs);
      }
      return { busyMs: busyMsFromGaps(gaps), sampleCount: gaps.length };
    },
  };
}
