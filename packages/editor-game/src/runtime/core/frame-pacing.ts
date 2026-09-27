/**
 * Frame pacing — the accumulator/alpha arithmetic of the fixed-timestep loop,
 * extracted PURE.
 *
 * `editor-game/src/runtime/core/game-loop.ts` owns the browser side (rAF, `visibilitychange`,
 * `performance.now`); this module owns the arithmetic, so the interesting
 * cases — a display frame that consumes zero substeps, a frame that hits the
 * substep ceiling, the spiral-of-death clamp, alpha's monotonic march across a
 * substep gap — are testable without stubbing a single global.
 *
 * The substep half is byte-for-byte the pacing the loop has always used
 * (clamp the raw frame gap, scale by `timeScale`, clamp the accumulator, then
 * consume up to `maxSubSteps` whole steps). The addition is `alpha`: the
 * fraction of a fixed step the accumulator is holding AFTER those substeps
 * were consumed, which is what lets a renderer present between two fixed
 * states instead of only at them.
 */

/** The two constants that define a loop's fixed cadence. */
export interface FramePacingLimits {
  /** Seconds per fixed substep (the loop's `fixedTimestep`). */
  readonly fixedDt: number;
  /** Substep ceiling per display frame — also the accumulator's hard ceiling. */
  readonly maxSubSteps: number;
}

/** What one display frame's worth of wall time resolves to. */
export interface PacedFrame {
  /** Whole fixed substeps this display frame should consume (0..maxSubSteps). */
  readonly steps: number;
  /** The accumulator AFTER those substeps were consumed. */
  readonly accumulator: number;
  /**
   * Interpolation alpha in `[0, 1]` — `accumulator / fixedDt`, i.e. how far
   * the presentation clock sits past the last completed fixed state. `0` means
   * "exactly on the last fixed state"; `0.5` means "halfway to the next one".
   */
  readonly alpha: number;
  /**
   * The display frame's own delta in seconds, clamped and `timeScale`d exactly
   * like the time fed to the accumulator. This is the delta a per-display-frame
   * consumer (post-processing, particles, a `RenderStepped`-shaped callback)
   * should integrate against — NOT `fixedDt`, which is a sim quantity.
   */
  readonly displayDt: number;
}

/**
 * `accumulator / fixedDt`, clamped to `[0, 1]`.
 *
 * Clamped rather than asserted because the accumulator can legitimately still
 * hold a whole step when a frame hits the `maxSubSteps` ceiling; presenting
 * "all the way at the next fixed state" is the only honest answer there, and a
 * NaN/negative/zero-`fixedDt` degenerate resolves to `0` (present the last
 * fixed state) rather than poisoning every transform downstream.
 */
export function interpolationAlpha(accumulator: number, fixedDt: number): number {
  if (!Number.isFinite(accumulator) || !Number.isFinite(fixedDt) || fixedDt <= 0) return 0;
  if (accumulator <= 0) return 0;
  const alpha = accumulator / fixedDt;
  return alpha >= 1 ? 1 : alpha;
}

/**
 * The one legal range for `GameLoop.timeScale`, and therefore the range any
 * instrument that DRIVES it must offer (`editor-game/src/runtime/dev/instruments.ts`'s Time-scale
 * slider reads exactly this — a second copy of `[0, 8]` in a control's bounds
 * is how a slider ends up able to request a value the loop then silently
 * refuses).
 */
export const TIME_SCALE_RANGE = { min: 0, max: 8 } as const;

/**
 * Clamp a requested time scale into {@link TIME_SCALE_RANGE}. Extracted from
 * `editor-game/src/runtime/core/game-loop.ts`'s `set timeScale` (which still owns the out-of-range
 * console warning — this function only computes) so the loop and every reader
 * of the range agree by construction.
 *
 * A NON-FINITE request resolves to `min`, not to itself: `Math.min(8,
 * Math.max(0, NaN))` is `NaN`, and a `NaN` time scale poisons the accumulator
 * permanently — every frame afterwards consumes zero substeps and no warning
 * ever repeats. Freezing (loudly, via the setter's warning) is recoverable;
 * a silently `NaN`-ed loop is not.
 */
export function clampTimeScale(value: number): number {
  if (!Number.isFinite(value)) return TIME_SCALE_RANGE.min;
  return Math.min(TIME_SCALE_RANGE.max, Math.max(TIME_SCALE_RANGE.min, value));
}

/**
 * Resolve one display frame: how many fixed substeps it consumes, what the
 * accumulator holds afterwards, and the alpha/displayDt the render pass should
 * present with.
 *
 * @param accumulator unconsumed sim time carried in from the previous frame
 * @param rawDt       wall-clock seconds since the previous frame
 * @param timeScale   the loop's live time scale (already clamped to [0, 8] by
 *                    its setter — this function does not re-clamp it)
 */
export function paceFrame(
  accumulator: number,
  rawDt: number,
  timeScale: number,
  limits: FramePacingLimits,
): PacedFrame {
  const { fixedDt, maxSubSteps } = limits;
  // Also the accumulator's hard ceiling (see the spiral-of-death clamp below).
  const maxAccumulator = fixedDt * maxSubSteps;

  // Clamp large frame gaps (a slow frame, a debugger pause) BEFORE scaling by
  // timeScale.
  const displayDt = Math.min(rawDt, maxAccumulator) * timeScale;
  let next = accumulator + displayDt;
  // Spiral-of-death guard: bound the accumulator regardless of timeScale or
  // frame-gap size. Time that can't possibly be caught up on is dropped, never
  // carried forward.
  if (next > maxAccumulator) next = maxAccumulator;

  let steps = 0;
  while (next >= fixedDt && steps < maxSubSteps) {
    next -= fixedDt;
    steps++;
  }

  return { steps, accumulator: next, alpha: interpolationAlpha(next, fixedDt), displayDt };
}
