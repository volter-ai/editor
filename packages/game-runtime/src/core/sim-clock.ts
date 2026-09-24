/**
 * `SimClock` — P3, the sim-time scheduler (punchlist item P3, rung 4).
 *
 * `await` **is** the scheduler; JS already won that argument. The only thing
 * missing from the engine was *clock binding*: a `delay(seconds)` that resolves
 * on the fixed loop's own accumulator instead of on wall time, so a timer
 * pauses when the game pauses, steps when the game steps, and reproduces
 * exactly in an offline export. That, plus a timed-dispose helper for debris,
 * is this whole module.
 *
 * ## This is NOT `AnimationClock`, and it never will be
 *
 * `animation/animation-clock.ts` is a seekable **cinematic** clock: it plays,
 * pauses, loops, runs in reverse and is `seek()`ed to arbitrary times so
 * registered sequence timelines and cue evaluators can be scrubbed. `SimClock` is the
 * **monotonic gameplay clock**: it only ever moves forward, one fixed substep
 * at a time, and there is no seek. Both live in one engine because they answer
 * different questions — "where is the cinematic playhead" versus "how much
 * gameplay time has actually elapsed".
 *
 * The reason they can never merge is a fact about Promises: **a Promise cannot
 * un-resolve.** Scrub a seekable clock backwards past a `delay` that already
 * fired and there is no correct behavior — you cannot un-await it. So `delay`
 * binds to the clock that cannot rewind, and cinematic scrubbing stays with the
 * clock that can.
 *
 * ## Two forms, because sync and async are genuinely different here
 *
 * `Game.runTicks` is **synchronous** (`runtime/game.ts`): it runs N substeps in
 * one straight-line loop. A `delay` continuation is a microtask, so under
 * `runTicks` — and under an offline export driven the same way — it does *not*
 * interleave between ticks; it runs when the caller's stack unwinds, after the
 * whole run. Under the ordinary rAF loop each frame yields, so the difference
 * is invisible.
 *
 * Therefore:
 *
 *  - `await clock.delay(n)` is the **ergonomic** form. Use it for gameplay.
 *  - `clock.after(n, fn)` is the **exact** form: `fn` is invoked inline, during
 *    the flush of the exact due tick, under every driver — rAF, `runTicks`,
 *    `step()`, offline export.
 *  - `clock.disposeAfter(obj, n)` is built on `after`, so debris removal is
 *    frame-exact in an offline export rather than "some time after the run".
 *
 * ## Firing rule (deterministic — pinned by `test/sim-clock.test.ts`)
 *
 *  - The runtime calls `flush(simT)` immediately after it bumps `tick`/`simT`,
 *    inside the same `advanced` guard — so a paused or frozen world fires no
 *    timers at all, and `Game.play.step()` fires exactly the timers that one
 *    substep makes due.
 *  - A timer is due when `simT >= scheduledAt + seconds`.
 *  - Due timers run in due-time ascending order, insertion-sequence ascending
 *    on ties.
 *  - A timer scheduled *during* a flush is never due in that same flush, even
 *    at `seconds === 0`. That is what makes a self-rescheduling timer unable to
 *    hang the frame.
 *
 * ## Cancellation is `AbortSignal`
 *
 * The same rung-1 web primitive the rest of this program uses. An
 * already-aborted signal makes `delay` reject immediately and `after` a no-op;
 * rejection is a `DOMException` with `name === 'AbortError'`, matching `fetch`.
 * Disposing the clock rejects every pending `delay` the same way — game code
 * awaiting a delay is expected to tolerate rejection exactly as aborted `fetch`
 * callers do.
 *
 * ## Ownership: the clock is GAME-scoped, and only the Game disposes it
 *
 * One clock per `Game`, shared by every world on it (`getSimClock(game)`); a
 * mount with no Game shell builds a private, mount-local one instead. Whoever
 * CREATED a clock disposes it: `GameInternal.dispose()` disposes the
 * game-scoped one — `runtime/create-runtime.ts` calls that after every root has
 * torn down — and a root adapter disposes only its own mount-local fallback.
 * A per-root teardown must NEVER dispose the game-scoped clock: disposing one
 * world's `mounted` is a supported way to end a sub-session while the Game
 * keeps running, and doing so would freeze `now()`, reject every sibling
 * world's pending `delay` and turn its later `after()` calls into silent
 * no-ops. (`seededRandom` and `debugRegistry` are game-scoped the same way, and
 * per-root teardown has never destroyed either — that asymmetry is what
 * exposed the bug.)
 *
 * ## Cancelling your own timers is the GAME's job — warm restart will not
 *
 * A timer outlives the code that scheduled it unless something cancels it, and
 * `hotReload` (warm restart) deliberately does not reach the game-scoped clock:
 * it is per-ROOT, so cancelling here would kill a sibling root's live timers —
 * the same ownership violation as above. There is deliberately no `reset()`.
 *
 * So a stale `after` closure surviving a warm restart is the same hazard class
 * as a stale event listener, and it has the same owner and the same remedy: the
 * game's own cleanup. `hotReload` runs the game's `dispose()` first for exactly
 * this reason, and both `after` and `delay` take an `AbortSignal` so one
 * controller cancels everything a `setup()` scheduled:
 *
 * ```ts
 * const ac = new AbortController();
 * clock.after(3, () => spawnWave(), { signal: ac.signal });
 * // on dispose: ac.abort() — cancels timers AND listeners
 * }
 * ```
 *
 * This is the engine-wide "Examples must clean up" contract (CLAUDE.md), not a
 * special rule for timers.
 *
 * ## Deliberately absent
 *
 *  - **No `every`/`repeat`/interval — that is `core/countdown-timer.ts`.**
 *    This header used to say an `after` re-arming itself was "three lines the
 *    game owns"; it is three lines that DRIFT, because re-arming schedules the
 *    next fire from the moment the callback ran, so every long frame
 *    permanently lengthens the interval. A repeating interval needs
 *    overshoot carry and multi-fire on a big step to keep its event count
 *    right, and it is stepped by its owner rather than by the clock. Both
 *    belong to a countdown object, not to a sim-time one-shot.
 *  - **No end-of-frame command queue — that is
 *    `core/deferred-commands.ts`.** `after(0, fn)` looks like one (the flush
 *    below does run at the tail of the frame that scheduled it) and is not:
 *    it holds the work forever across a pause, it has no subject identity, and
 *    a command it schedules during a flush waits a whole extra frame. See that
 *    module's header for all three.
 *  - **No fiber kernel, no coroutine emulation, no `task.spawn`.** Calling an
 *    `async function` *is* `task.spawn` — the language already has it.
 *  - **No wall clock.** This module reads no system timer and creates no
 *    host timeout; every time value comes from the runtime's own accumulator.
 */

import type * as THREE from 'three';
import { createGameScopedSlot } from './game-scoped-slot';

/** Cancel handle returned by {@link SimClock.after}/{@link SimClock.disposeAfter}. */
export interface SimTimerHandle {
  /** Cancel the timer if it has not fired yet. Idempotent. */
  cancel(): void;
}

/** Options accepted by every scheduling call. */
export interface SimScheduleOptions {
  /** Cancel/reject when this signal aborts (already-aborted is honored too). */
  readonly signal?: AbortSignal | undefined;
}

/** The sim clock as GAME CODE sees it — the whole public surface. */
export interface SimClock {
  /** Sim seconds elapsed: the fixed loop's own accumulator. Monotonic. */
  now(): number;
  /** Completed fixed substeps — the same counter `Game`'s `tick` carries. */
  tickNow(): number;
  /**
   * Resolve after `seconds` of SIM time. The ergonomic form; see the module
   * header for why it is not frame-exact under a synchronous driver.
   * Rejects with an `AbortError` `DOMException` if `opts.signal` aborts (or is
   * already aborted), or if the clock is disposed while it is pending.
   */
  delay(seconds: number, opts?: SimScheduleOptions): Promise<void>;
  /**
   * Invoke `fn` inline during the flush of the exact due tick — the exact
   * form. A no-op if `opts.signal` is already aborted.
   */
  after(seconds: number, fn: () => void, opts?: SimScheduleOptions): SimTimerHandle;
  /**
   * Debris: dispose `obj` after `seconds` of sim time. Built on {@link after},
   * so removal lands on an exact tick. The disposal itself is supplied by the
   * runtime (see {@link SimClockOptions.dispose}) — this module knows nothing
   * about physics or rendering.
   */
  disposeAfter(obj: THREE.Object3D, seconds: number): SimTimerHandle;
}

/**
 * The runtime-facing half — NOT for game code. Split off the public
 * {@link SimClock} the same way `runtime/game.ts` splits `GameInternal` off
 * `Game`: game code only ever sees the public `SimClock`, so it cannot
 * reach `flush`/`dispose`.
 */
export interface SimClockInternal extends SimClock {
  /**
   * Advance to `simT` and fire everything now due. Called by `runFrameImpl`
   * immediately after the `tick`/`simT` bump, inside the `advanced` guard.
   * One call === one completed substep, which is why {@link SimClock.tickNow}
   * can simply count them.
   */
  flush(simT: number): void;
  /**
   * Drop every pending timer and reject every pending `delay`. Called by
   * whoever CREATED this clock and by nobody else — `GameInternal.dispose()`
   * for the game-scoped one, the owning mount for a mount-local fallback. See
   * the module header's ownership section.
   */
  dispose(): void;
}

export interface SimClockOptions {
  /**
   * How {@link SimClock.disposeAfter} disposes an object. Supplied by the
   * runtime, which is the only layer that knows about physics
   * registries and shared geometry; the clock only knows *when*.
   */
  readonly dispose: (obj: THREE.Object3D) => void;
}

interface SimTimer {
  readonly dueAt: number;
  readonly seq: number;
  readonly fn: () => void;
  cancelled: boolean;
  detachAbort: (() => void) | null;
}

const NOOP_HANDLE: SimTimerHandle = { cancel() {} };

/** `fetch`-shaped abort rejection: a `DOMException` named `AbortError`. */
function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function assertSeconds(method: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(
      `SimClock.${method}: seconds must be a finite, non-negative number, got ${seconds}`,
    );
  }
}

/**
 * Build the one sim clock a `Game` owns. See the module header for the
 * contract; `runtime/game.ts` is the only production caller.
 */
export function createSimClock(options: SimClockOptions): SimClockInternal {
  const disposeObject = options.dispose;

  let simT = 0;
  let ticks = 0;
  let seq = 0;
  let disposed = false;

  const pending = new Set<SimTimer>();
  /** Rejectors for in-flight `delay`s, so `dispose()` can settle them all. */
  const pendingDelays = new Set<(message: string) => void>();

  function cancelTimer(timer: SimTimer): void {
    if (timer.cancelled) return;
    timer.cancelled = true;
    pending.delete(timer);
    timer.detachAbort?.();
    timer.detachAbort = null;
  }

  function after(seconds: number, fn: () => void, opts?: SimScheduleOptions): SimTimerHandle {
    assertSeconds('after', seconds);
    const signal = opts?.signal;
    // Already-aborted, or a clock that is gone: a no-op, never a throw.
    if (disposed || signal?.aborted) return NOOP_HANDLE;

    const timer: SimTimer = {
      dueAt: simT + seconds,
      seq: seq++,
      fn,
      cancelled: false,
      detachAbort: null,
    };
    pending.add(timer);

    if (signal) {
      const onAbort = (): void => cancelTimer(timer);
      signal.addEventListener('abort', onAbort, { once: true });
      timer.detachAbort = (): void => signal.removeEventListener('abort', onAbort);
    }

    return {
      cancel(): void {
        cancelTimer(timer);
      },
    };
  }

  return {
    now: (): number => simT,
    tickNow: (): number => ticks,
    after,

    delay(seconds: number, opts?: SimScheduleOptions): Promise<void> {
      assertSeconds('delay', seconds);
      const signal = opts?.signal;
      if (signal?.aborted) {
        return Promise.reject(abortError('SimClock.delay: aborted before it was scheduled'));
      }
      if (disposed) {
        return Promise.reject(abortError('SimClock.delay: the sim clock is disposed'));
      }
      return new Promise<void>((resolve, reject) => {
        let handle: SimTimerHandle | null = null;
        let detachAbort: (() => void) | null = null;
        let settled = false;

        const finish = (): void => {
          settled = true;
          pendingDelays.delete(rejectDelay);
          detachAbort?.();
          detachAbort = null;
        };
        function rejectDelay(message: string): void {
          if (settled) return;
          finish();
          handle?.cancel();
          reject(abortError(message));
        }

        handle = after(seconds, () => {
          if (settled) return;
          finish();
          resolve();
        });
        pendingDelays.add(rejectDelay);

        if (signal) {
          const onAbort = (): void => rejectDelay('SimClock.delay: aborted');
          signal.addEventListener('abort', onAbort, { once: true });
          detachAbort = (): void => signal.removeEventListener('abort', onAbort);
        }
      });
    },

    disposeAfter(obj: THREE.Object3D, seconds: number): SimTimerHandle {
      assertSeconds('disposeAfter', seconds);
      return after(seconds, () => disposeObject(obj));
    },

    flush(nextSimT: number): void {
      if (disposed) return;
      simT = nextSimT;
      ticks++;
      if (pending.size === 0) return;

      // Snapshot BEFORE running anything: a timer scheduled by one of these
      // callbacks lands in `pending` but not in this batch, so it can never be
      // due in the same flush (module header, firing rule 4).
      const batch: SimTimer[] = [];
      for (const timer of pending) {
        if (!timer.cancelled && timer.dueAt <= simT) batch.push(timer);
      }
      if (batch.length === 0) return;
      batch.sort((a, b) => a.dueAt - b.dueAt || a.seq - b.seq);

      for (const timer of batch) {
        // A previously-fired callback may have cancelled this one.
        if (timer.cancelled) continue;
        cancelTimer(timer);
        try {
          timer.fn();
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: loud degrade — one bad timer must not abort the frame's remaining timers (same isolation idiom as `runFrameImpl`'s per-world try/catch)
          console.error('[sim-clock] timer callback threw:', err);
        }
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const timer of pending) {
        timer.detachAbort?.();
        timer.detachAbort = null;
        timer.cancelled = true;
      }
      pending.clear();
      const rejectors = [...pendingDelays];
      pendingDelays.clear();
      for (const rejectDelay of rejectors) {
        rejectDelay('SimClock: disposed while a delay was pending');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Game-scoped registry — mirrors `core/seeded-random.ts`'s
// `registerSeededRandom`/`getSeededRandom` slot pattern exactly, keyed on a
// bare `object` (not `Game`) so `core/` never imports `runtime/`. `createGame`
// is the one real registrant, passing the `GameInternal` shell as the key.
// ---------------------------------------------------------------------------

const clockByOwner = createGameScopedSlot<SimClockInternal>('sim-clock');

/** Called once by `createGame`, right after the clock and the Game shell exist. */
export function registerSimClock(owner: object, clock: SimClockInternal): void {
  clockByOwner.set(owner, clock);
}

/** The game-scoped clock backing every world's `ctx.clock` — `null` for an
 *  owner built without one (a hand-built `Game`-shaped stand-in that never went
 *  through `createGame`).
 *
 *  Returns the INTERNAL view because this registry is engine-only — but a
 *  caller that RESOLVES a clock here is not its owner and must not call
 *  `dispose()` on it (module header, ownership). Game code never reaches it at
 *  all: it only ever sees the public {@link SimClock}, which has
 *  neither `flush` nor `dispose`, the same way `Game` hides `GameInternal`. */
export function getSimClock(owner: object): SimClockInternal | null {
  return clockByOwner.get(owner) ?? null;
}
