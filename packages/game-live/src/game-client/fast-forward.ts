/**
 * Pure `game.fastForward` batching/accounting math — no Playwright (same
 * "pure module, Playwright-free" split `wait-for.ts` established, so this
 * unit-tests headlessly). `client.ts`'s `GameClient.fastForward` is the
 * thin Playwright-bound wrapper around `runFastForward` below, exactly the
 * way `GameClient.waitFor` wraps `runWaitFor`.
 *
 * The shape: `game.fastForward({simSeconds}|{simTicks})` synchronously
 * drives the live `Game`'s `runTicks` (through the debug bridge, door (a))
 * instead of relying on real wall-clock time to pass. Doctrine:
 * fastForward is for SETUP/STAGING traversal —
 * reaching a known late-game state fast — not a replacement for real-input
 * proofs, which still run in real ticks; a scripted/scheduled input sequence
 * driven THROUGH a fastForward burst is still an honest proof of "what the sim
 * consumed" (the post-gate recording framing) — fastForward changes
 * how fast ticks are produced, never what a tick consumes.
 *
 * Two honesty decisions this module encodes, both because burst ticks are NOT
 * ordinary wall-clock-paced simulation and must never be reported as if they
 * were (the "never fabricate" rule threaded through `perf-sampling.ts`/
 * `failure-block.ts`):
 *
 *  1. **Batching, not one giant `runTicks` call.** A single call driving (say)
 *     an hour of sim time would (a) block the page's JS thread for the ENTIRE
 *     burst with zero observable progress, and (b) starve anything watching
 *     this run's stdout for liveness for however long the burst takes — a
 *     false "wedged" verdict on a run that was making fine (just silent)
 *     progress. Batching into `DEFAULT_FAST_FORWARD_BATCH_TICKS`-sized chunks
 *     with one heartbeat per chunk (`client.ts` prints it) keeps output flowing
 *     without giving up the speedup — each batch is still driven synchronously
 *     in-page; only the ROUND TRIP is chunked.
 *  2. **Burst ticks never feed the ordinary tps stats.** `perf-sampling.ts`'s
 *     `TpsAccumulator` measures REAL wall-clock throughput between ordinary
 *     `snapshot()` polls — its whole purpose is "is the game's frame loop
 *     keeping up in real time." A burst of, say, 1800 ticks completed in
 *     ~50ms would produce a `~36000 ticks/s` sample that means nothing about
 *     the game's real per-frame cost, and would silently corrupt the p50/p95
 *     a genuine stall would otherwise surface in. `client.ts`'s `fastForward`
 *     therefore drives every batch through a RAW bridge call (bypassing
 *     `GameClient.snapshot()`'s automatic `TpsAccumulator.record`) and resets
 *     the accumulator's baseline once the burst completes, so the very next
 *     ordinary poll starts a fresh "first observation" instead of diffing
 *     across the burst discontinuity. The whole-TEST `simSpeedRatio` (fixture
 *     teardown, `perf-sampling.ts`) is NOT protected this way, deliberately:
 *     it is an honest end-to-end ratio (fence snapshot -> final snapshot),
 *     not a sampled rate, and showing "this test ran at 400x" when it
 *     genuinely did IS the correct, undistorted signal. `waitFor` budgets are
 *     themselves unaffected by any of this — they are still sim-time
 *     budgets; a `fastForward` immediately before one just leaves less real
 *     ground for it to cover (sim-time got CHEAPER, not redefined).
 */

export type FastForwardBudget = { simSeconds: number } | { simTicks: number };

export type FastForwardRenderMode = 'last' | 'all' | 'none';

export interface FastForwardOptions {
  /** Render mode for the FINAL tick of the WHOLE fast-forward (default
   *  `'last'`, matching `Game.runTicks`'s own default) — every intermediate
   *  batch always forces `'none'` regardless of this value; see the module
   *  doc's batching rationale (point 1). */
  render?: FastForwardRenderMode;
  /** Overrides `DEFAULT_FAST_FORWARD_BATCH_TICKS` — test-only seam; real
   *  callers should leave this unset. */
  batchTicks?: number;
  /** What the caller needs back after the burst. Defaults to the complete
   * debug snapshot. Tick-by-tick orchestration that samples providers only at
   * explicit boundaries selects `'time'` so it does not serialize every large
   * state provider after every staging tick. */
  result?: 'snapshot' | 'time';
}

/** One fixed timestep, matching every real host's loop construction
 *  (`createGameLoop`'s own `fixedTimestep ?? 1/60` default: "fixedDt = the
 *  host loop's fixed timestep (1/60)"). Used ONLY as a fallback when a
 *  `simSeconds` budget needs converting to a tick count before the game has
 *  ticked even once (nothing observed yet to measure the real fixedDt from) —
 *  see `ticksForBudget`. */
export const DEFAULT_FIXED_DT = 1 / 60;

/** 5 sim-seconds' worth of ticks at the default 60Hz rate — small enough that
 *  even a complex game's batch finishes well inside a second of real time
 *  (keeping heartbeats frequent), large enough that round-trip overhead stays
 *  negligible next to the speedup (module doc, point 1). */
export const DEFAULT_FAST_FORWARD_BATCH_TICKS = 300;

export interface FastForwardTime {
  tick: number;
  simSeconds: number;
}

/** The driver's I/O seam — real usage (`client.ts`) wires this to raw
 *  (non-tps-recording) bridge calls; tests supply a scripted fake so this
 *  module's batching/accounting logic is provable with no browser at all. */
export interface FastForwardClock {
  /** Synchronously runs `n` fixed ticks with the given render mode for THIS
   *  batch (the driver, not the clock, decides which batch is final and
   *  therefore gets the caller's requested render mode). */
  runTicksBatch(n: number, render: FastForwardRenderMode): Promise<void>;
  /** Reads the current `{tick, simSeconds}` WITHOUT recording a tps sample —
   *  called once up front (to derive `fixedDt` for a `simSeconds` budget) and
   *  once at the very end (the returned result). */
  readTime(): Promise<FastForwardTime>;
  /** One call per completed batch — real usage prints a heartbeat line
   *  (reaching the CLI wedge watchdog's stdout-liveness check); tests just
   *  record the calls. */
  heartbeat(info: { ticksDone: number; ticksTotal: number }): void;
}

/** Converts a `simSeconds` budget into an exact tick count using the game's
 *  OWN observed `simSeconds`/`tick` ratio — not a hardcoded constant, since a
 *  project may run a non-default fixed timestep (see `simulate-cinematic`'s
 *  `vgai-simulate-fixed-dt` precedent); measuring beats assuming. Falls back
 *  to `DEFAULT_FIXED_DT` only when `observed.tick` is still `0` (nothing to
 *  measure from yet — a fresh page that hasn't ticked once). A `simTicks`
 *  budget passes straight through, unaffected by any of this. */
export function ticksForBudget(budget: FastForwardBudget, observed: FastForwardTime): number {
  if ('simTicks' in budget) {
    if (!Number.isInteger(budget.simTicks) || budget.simTicks < 0) {
      throw new RangeError(
        `game.fastForward: simTicks must be a non-negative integer, got ${budget.simTicks}`,
      );
    }
    return budget.simTicks;
  }
  if (!Number.isFinite(budget.simSeconds) || budget.simSeconds < 0) {
    throw new RangeError(`game.fastForward: simSeconds must be >= 0, got ${budget.simSeconds}`);
  }
  const fixedDt = observed.tick > 0 ? observed.simSeconds / observed.tick : DEFAULT_FIXED_DT;
  return Math.ceil(budget.simSeconds / fixedDt);
}

/** Pure batch-size planner: splits `totalTicks` into chunks of at most
 *  `batchTicks`, the LAST of which may be smaller (never any other position —
 *  the driver marks exactly the last chunk "final" and applies the caller's
 *  requested render mode only to it). Empty for `totalTicks <= 0`. */
export function planFastForwardBatches(totalTicks: number, batchTicks: number): number[] {
  if (totalTicks <= 0) return [];
  const batches: number[] = [];
  let remaining = totalTicks;
  while (remaining > 0) {
    const chunk = Math.min(batchTicks, remaining);
    batches.push(chunk);
    remaining -= chunk;
  }
  return batches;
}

/**
 * Drives a `fastForward` call against `clock`: converts `budget` to an exact
 * tick count (`ticksForBudget`), batches it (`planFastForwardBatches`), runs
 * each batch through `runTicksBatch` (forcing `render: 'none'` on every batch
 * but the last, which gets `opts.render ?? 'last'`), heartbeats once per
 * batch, and returns the final observed `{tick, simSeconds}`. See the module
 * doc for why batching and the render-mode split exist.
 */
export async function runFastForward(
  budget: FastForwardBudget,
  opts: FastForwardOptions,
  clock: FastForwardClock,
): Promise<FastForwardTime> {
  const observed = await clock.readTime();
  const totalTicks = ticksForBudget(budget, observed);
  const batches = planFastForwardBatches(
    totalTicks,
    opts.batchTicks ?? DEFAULT_FAST_FORWARD_BATCH_TICKS,
  );
  const finalRender = opts.render ?? 'last';

  let ticksDone = 0;
  for (let i = 0; i < batches.length; i++) {
    const size = batches[i] as number;
    const isFinalBatch = i === batches.length - 1;
    await clock.runTicksBatch(size, isFinalBatch ? finalRender : 'none');
    ticksDone += size;
    clock.heartbeat({ ticksDone, ticksTotal: totalTicks });
  }

  return clock.readTime();
}
