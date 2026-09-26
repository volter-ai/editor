/**
 * `runTicksWhenSettled` — the settled-aware tick driver behind BOTH session run-ticks doors
 * (the bridge's `window.__vgai.runTicksSettled`, the editor relay's `run-ticks` case), one
 * implementation with byte-identical semantics across doors, exactly as `runTicks` itself is
 * shared (D17).
 *
 * Why it exists: `Game.runTicks` is deliberately SYNCHRONOUS, but a game may be intentionally
 * BETWEEN worlds when a tick arrives — `reload_current_scene` unmounts the running scene and
 * the fresh one arrives on an ASYNC React commit. A tick driven into that gap runs against
 * nothing, and WHICH tick first runs the fresh world then depends on wall timing between
 * driver calls — measured on the starter-kit fidelity drive: the same script produced 7 or 8
 * post-respawn walked ticks depending on how long the driver idled between ticks. The fidelity
 * contract treats a nondeterministic channel as a MECHANISM defect (the instrument that spelled
 * that out went with the archived import lanes, `archive/*-lane-2026-09-19`; the rule did not),
 * and this is the mechanism: ticks must not race remounts.
 *
 * So this driver runs the budget ONE tick at a time and, before each tick, waits for every
 * registered world-settled probe ({@link DebugRegistry.registerWorldSettledProbe} — declared by
 * the game through its `debug.settled` entry export) to answer `true`. The wall-clock poll is
 * sound because the OUTCOME no longer depends on timing: however long the commit takes, the
 * next tick is always the fresh world's first. A game that registers no probe gets the old
 * behavior exactly (every wait resolves immediately).
 *
 * The wait is BOUNDED and loud: a remount that never settles is a real defect, and
 * `WORLD_UNSETTLED_TIMEOUT` names it rather than letting the driver hang.
 */
import { DebugError, type DebugRegistry, type RunTicksOptions } from './debug-registry';

/** A remount is a couple of React commits on an idle main thread; polling faster buys nothing
 *  and slower delays every settled check by the poll period. */
const SETTLED_POLL_MS = 4;
/** A commit that hasn't landed after this long is not "in flight", it is stuck. */
const SETTLED_TIMEOUT_MS = 10_000;

export async function runTicksWhenSettled(
  registry: Pick<DebugRegistry, 'worldSettled' | 'getRunTicksTarget'>,
  n: number,
  opts?: RunTicksOptions,
  /** Test-only overrides — real callers leave this unset (the same seam
   *  convention as fast-forward's `batchTicks`). */
  waits?: { timeoutMs?: number; pollMs?: number },
): Promise<void> {
  const target = registry.getRunTicksTarget();
  if (target === null) {
    throw new DebugError(
      'RUN_TICKS_UNAVAILABLE',
      'runTicksWhenSettled: no run-ticks target is wired — no Game has mounted yet',
    );
  }
  const timeoutMs = waits?.timeoutMs ?? SETTLED_TIMEOUT_MS;
  const pollMs = waits?.pollMs ?? SETTLED_POLL_MS;
  const render = opts?.render ?? 'last';
  for (let i = 0; i < n; i++) {
    if (!registry.worldSettled()) {
      const deadline = Date.now() + timeoutMs;
      while (!registry.worldSettled()) {
        if (Date.now() > deadline) {
          throw new DebugError(
            'WORLD_UNSETTLED_TIMEOUT',
            `runTicksWhenSettled: a world-settled probe still answers false after ${timeoutMs}ms — ` +
              'a scene remount (or a broken probe) is stuck, and driving ticks into it would race it',
          );
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
    const isFinalTick = i === n - 1;
    // Same per-tick render policy `Game.runTicks` applies across its own loop.
    const tickRender =
      render === 'all' ? 'all' : render === 'none' ? 'none' : isFinalTick ? 'last' : 'none';
    target.runTicks(1, { render: tickRender });
  }
}
