/**
 * THE loop gate for an ingested game — the SimCity ledger's S-5 ("the loop
 * gate silently no-ops: after pause, the gated game still advances").
 *
 * ## What was actually wrong
 *
 * An ingested game runs in the EDITOR'S OWN page, where nothing can be replaced
 * wholesale without collateral on the editor itself, so the entire "gate" was
 * `createIngestLoopGate`: `renderer.setAnimationLoop(null)`, guarded by a check
 * that the game had ever CALLED `setAnimationLoop`.
 *
 * That check is a declaration, not a measurement, and it covers exactly one
 * loop driver. A game that renders through `setAnimationLoop` (so the check
 * passed and the gate reported success) and simulates through
 * `setInterval(this.simulate, 1000)` parks nothing when
 * `setAnimationLoop(null)` runs. Pause froze the picture and the city kept
 * building.
 *
 * ## The cure: the `gated-globals` precedent, applied to scheduling
 *
 * The dev server already prepends a lexical shadow to every project/game module
 * so `window`/`document` resolve to editor-owned proxies
 * (`game-globals-prelude.ts`). The same prelude now shadows the SCHEDULING
 * functions — `setTimeout`, `setInterval`, `requestAnimationFrame` and their
 * cancels — onto the gate this module builds. Only game modules see them; the
 * editor's own timers are untouched, which is precisely why patching the real
 * globals was never an option.
 *
 * A held gate PARKS callbacks, it does not drop them: a one-shot timer fires on
 * release, an interval fires once (coalesced — a held gate must not release a
 * burst of missed ticks), and frame callbacks replay in order. While OPEN the
 * wrappers are straight pass-throughs that run the callback synchronously in
 * the real timer's own tick, so an ungated session's timing is unchanged.
 *
 * ## Recorded limitation (stated, not hidden)
 *
 * This gate does not freeze `performance.now()`/`Date.now()` — those are the
 * editor's own clocks and it shares them with the game, so a game CAN tell it
 * was held. Parked frame callbacks are handed the gate's virtual timestamp (which
 * is what a `dt` is normally computed from), but a game reading `Date.now()`
 * directly will see the pause. That is a real gap in this rung, and it is
 * better stated than papered over.
 *
 * Everything here is injectable (`createSameRealmLoopGate` takes its
 * schedulers; `verifySameRealmLoopControl` takes the gate, a progress reader
 * and a sleep) so the whole decision is unit-testable with no browser.
 */

/**
 * The vocabulary a loop verdict speaks.
 *
 * `'unmeasured'` is a first-class answer, not a failure: the probe only ever
 * concludes from something it OBSERVED, and with nothing due while the gate was
 * held it withheld nothing and therefore learned nothing about who drives this
 * loop. On a hidden or backgrounded tab there is routinely nothing due, which
 * would otherwise make the probe report TAB VISIBILITY as a property of the
 * game.
 */
export type LoopVerdictValue = 'gated' | 'self-driven' | 'unmeasured';

/** What a verdict was concluded FROM — see {@link verifySameRealmLoopControl}
 *  for the rule each number participates in. */
export interface LoopEvidence {
  readonly pendingWhileHeld: number;
  readonly firedWhileHeld: number;
  readonly progressBefore: number;
  readonly progressAfter: number;
  readonly windowMs: number;
}

/**
 * THE PAIR the coverage report and the status facet speak: a verdict WITH the
 * evidence it was concluded from, or `null` for no verdict at all.
 *
 * ## Why it is a pair and not the word
 *
 * `'gated'` and `'self-driven'` are also an AUTHOR'S INTENT WORD — the manifest
 * declares `loop: 'gated' | 'self-driven'` per root
 * (`@volter/editor-project/manifest/schema`). While status and coverage emitted the bare
 * string, a declared intent and a measured verdict were the same two bytes, and
 * two mount routes duly asserted `'gated'` with no probe behind them: the report
 * printed `loop ✓ gated` about games nothing had ever held.
 *
 * The provenance therefore lives in the VALUE'S SHAPE, not beside it. A verdict
 * cannot be spelled without {@link LoopEvidence}, and evidence is producible
 * only by {@link verifySameRealmLoopControl} — so "this was measured" is a
 * structural property a stub cannot accidentally satisfy, and a route with no
 * probe has exactly one thing it can say: `null`, plus its own reason.
 *
 * `readiness.ts`'s `RootReadiness.source: 'declared' | 'measured'` is the
 * precedent for making provenance visible, and this is deliberately the
 * STRONGER form of it rather than a transcription: readiness has two real
 * answerers to tell apart, whereas the manifest's `loop` is
 * `.default('gated')` — an unwritten field and an authored one are the same
 * value by the time anything can read it, so a `source: 'declared'` member here
 * would have to FABRICATE a declaration nobody made (the anti-shim rule). The
 * declared word stays where it is read (mount machinery); it never enters this
 * type.
 */
export interface MeasuredLoop {
  readonly verdict: 'gated' | 'self-driven';
  readonly evidence: LoopEvidence;
}

/**
 * Fold a probe answer into {@link MeasuredLoop}: a MEASURED verdict keeps its
 * evidence, and `'unmeasured'` (or no probe at all) becomes `null` — the same
 * "not measured yet" every other unprobed seam reports. The probe's own
 * `reason` travels alongside it either way, so a reader always learns why there
 * is no verdict.
 */
export function measuredLoop(
  verdict: SameRealmLoopVerdict | null | undefined,
): MeasuredLoop | null {
  if (!verdict) return null;
  if (verdict.loop !== 'gated' && verdict.loop !== 'self-driven') return null;
  return { verdict: verdict.loop, evidence: verdict.evidence };
}

/** The real scheduling functions the gate wraps. */
export interface RealSchedulers {
  setTimeout(callback: () => void, ms?: number): number;
  clearTimeout(id: number): void;
  setInterval(callback: () => void, ms?: number): number;
  clearInterval(id: number): void;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
  now(): number;
}

/** The gated replacements, in the shape game code expects. */
export interface GatedSchedulers {
  setTimeout(callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number;
  clearTimeout(id: number): void;
  setInterval(callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number;
  clearInterval(id: number): void;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
}

/** A snapshot of the gate's counters — everything the probe reads. */
export interface SameRealmLoopGateStats {
  /** `'open'` (callbacks run) · `'held'` (callbacks parked) · `'step'` (one batch, then held). */
  readonly mode: 'open' | 'held' | 'step';
  /** Callbacks currently parked by the gate. */
  readonly pending: number;
  /** Total scheduling calls the game has made through the shadowed functions. */
  readonly requests: number;
  /** Total callbacks the gate has actually dispatched. */
  readonly fired: number;
  /**
   * Callbacks that ran WHILE THE GATE WAS HELD. Structurally always 0 — it is a
   * falsifier, not a statistic: a non-zero value means the gate leaked, and the
   * probe reports `self-driven` rather than trusting itself.
   */
  readonly firedWhileHeld: number;
  /** Real scheduler handles still owned by this gate. Optional for older
   * adapter-provided test doubles; the first-party gate always reports them. */
  readonly activeTimeouts?: number;
  readonly activeIntervals?: number;
  readonly activeAnimationFrames?: number;
  /** Input events observed by the realm's window/document proxies. A blocked
   * event is counted in both `input` and `inputBlocked`. */
  readonly input?: number;
  readonly inputBlocked?: number;
}

export interface SameRealmLoopDisposal {
  readonly timeouts: number;
  readonly intervals: number;
  readonly animationFrames: number;
  readonly parkedCallbacks: number;
}

export interface SameRealmLoopGate {
  /** The functions the prelude shadows onto. */
  readonly schedulers: GatedSchedulers;
  hold(): void;
  release(): void;
  /** Run exactly `n` parked batches, then hold again (editor Step). */
  step(n?: number): void;
  stats(): SameRealmLoopGateStats;
  recordInput?(blocked: boolean): void;
  /** Cancel every callback still owned by the mount. Optional only so
   * third-party/test doubles written before mount-scoped realms remain valid. */
  dispose?(): SameRealmLoopDisposal;
}

interface Parked {
  run(): void;
  /** Set for one-shot timers, so `clearTimeout` can unpark an already-fired one. */
  timerId?: number;
  /** Set for frame callbacks, so `cancelAnimationFrame` can unpark one. */
  frameId?: number;
}

/**
 * Build a loop gate over `real`. The gate starts OPEN — a mount must be allowed
 * to construct and draw before anything holds it.
 */
export function createSameRealmLoopGate(real: RealSchedulers): SameRealmLoopGate {
  let mode: 'open' | 'held' | 'step' = 'open';
  let stepsLeft = 0;
  let requests = 0;
  let fired = 0;
  let firedWhileHeld = 0;
  let input = 0;
  let inputBlocked = 0;
  let heldAt = 0;
  let offset = 0;
  let disposed = false;
  const parked: Parked[] = [];
  const activeTimeouts = new Set<number>();
  const activeIntervals = new Set<number>();
  const activeAnimationFrames = new Set<number>();
  /** Interval id → its parked entry, so a held interval coalesces to ONE
   *  pending invocation instead of releasing a burst of missed ticks. */
  const parkedIntervals = new Map<number, Parked>();

  /** The gate's virtual time — frozen while held. Handed to parked frame
   *  callbacks so their `dt` does not swallow the whole pause. */
  const virtualNow = (): number => (mode === 'held' ? heldAt : real.now()) - offset;

  const dispatch = (entry: Parked): void => {
    fired++;
    if (mode === 'held') firedWhileHeld++;
    try {
      entry.run();
    } catch (err) {
      // A throwing game callback must not swallow the rest of the batch or
      // wedge the gate; rethrow asynchronously so window.onerror still sees it.
      real.setTimeout(() => {
        throw err;
      }, 0);
    }
  };

  /** Run one parked batch. Callbacks scheduled BY the batch run normally (the
   *  gate is open by then). */
  const flush = (): void => {
    const batch = parked.splice(0, parked.length);
    parkedIntervals.clear();
    for (const entry of batch) dispatch(entry);
  };

  const park = (entry: Parked): void => {
    parked.push(entry);
  };

  /** The one place "held?" is decided, for every kind of callback. */
  const gated = (entry: Omit<Parked, 'run'> & { run(): void }) => (): void => {
    if (mode === 'held') {
      park(entry);
      return;
    }
    dispatch(entry);
  };

  const hold = (): void => {
    if (mode === 'held') return;
    heldAt = real.now();
    mode = 'held';
  };

  const reopen = (): void => {
    if (mode !== 'held') return;
    offset += real.now() - heldAt;
  };

  const schedulers: GatedSchedulers = {
    setTimeout(callback, ms, ...args) {
      requests++;
      if (disposed) return -1;
      const entry: Parked = { run: () => callback(...args) };
      let id = -1;
      const run = gated(entry);
      id = real.setTimeout(() => {
        activeTimeouts.delete(id);
        run();
      }, ms);
      activeTimeouts.add(id);
      entry.timerId = id;
      return id;
    },
    clearTimeout(id) {
      real.clearTimeout(id);
      activeTimeouts.delete(id);
      const index = parked.findIndex((entry) => entry.timerId === id);
      if (index !== -1) parked.splice(index, 1);
    },
    setInterval(callback, ms, ...args) {
      requests++;
      if (disposed) return -1;
      let id = -1;
      const tick = (): void => {
        const entry: Parked = { run: () => callback(...args) };
        if (mode === 'held') {
          // Coalesce: replace this interval's pending invocation rather than
          // stacking one per missed tick.
          const previous = parkedIntervals.get(id);
          if (previous) {
            const index = parked.indexOf(previous);
            if (index !== -1) parked.splice(index, 1);
          }
          parkedIntervals.set(id, entry);
          park(entry);
          return;
        }
        dispatch(entry);
      };
      id = real.setInterval(tick, ms);
      activeIntervals.add(id);
      return id;
    },
    clearInterval(id) {
      real.clearInterval(id);
      activeIntervals.delete(id);
      const entry = parkedIntervals.get(id);
      if (entry) {
        parkedIntervals.delete(id);
        const index = parked.indexOf(entry);
        if (index !== -1) parked.splice(index, 1);
      }
    },
    requestAnimationFrame(callback) {
      requests++;
      if (disposed) return -1;
      const entry: Parked = { run: () => callback(virtualNow()) };
      let id = -1;
      const run = gated(entry);
      id = real.requestAnimationFrame(() => {
        activeAnimationFrames.delete(id);
        run();
      });
      activeAnimationFrames.add(id);
      entry.frameId = id;
      return id;
    },
    cancelAnimationFrame(id) {
      real.cancelAnimationFrame(id);
      activeAnimationFrames.delete(id);
      const index = parked.findIndex((entry) => entry.frameId === id);
      if (index !== -1) parked.splice(index, 1);
    },
  };

  return {
    schedulers,
    hold,
    release() {
      if (disposed) return;
      reopen();
      mode = 'open';
      flush();
    },
    step(n = 1) {
      if (disposed) return;
      reopen();
      stepsLeft = n > 0 ? n : 1;
      mode = 'step';
      while (stepsLeft > 0 && parked.length > 0) {
        stepsLeft--;
        flush();
      }
      mode = 'held';
      heldAt = real.now();
    },
    stats() {
      return {
        mode,
        pending: parked.length,
        requests,
        fired,
        firedWhileHeld,
        activeTimeouts: activeTimeouts.size,
        activeIntervals: activeIntervals.size,
        activeAnimationFrames: activeAnimationFrames.size,
        input,
        inputBlocked,
      };
    },
    recordInput(blocked) {
      input++;
      if (blocked) inputBlocked++;
    },
    dispose() {
      if (disposed) {
        return { timeouts: 0, intervals: 0, animationFrames: 0, parkedCallbacks: 0 };
      }
      disposed = true;
      const report: SameRealmLoopDisposal = {
        timeouts: activeTimeouts.size,
        intervals: activeIntervals.size,
        animationFrames: activeAnimationFrames.size,
        parkedCallbacks: parked.length,
      };
      for (const id of activeTimeouts) real.clearTimeout(id);
      for (const id of activeIntervals) real.clearInterval(id);
      for (const id of activeAnimationFrames) real.cancelAnimationFrame(id);
      activeTimeouts.clear();
      activeIntervals.clear();
      activeAnimationFrames.clear();
      parked.length = 0;
      parkedIntervals.clear();
      stepsLeft = 0;
      mode = 'held';
      heldAt = real.now();
      return report;
    },
  };
}

/** The measured verdict for a mount's loop. */
export interface SameRealmLoopVerdict {
  readonly loop: LoopVerdictValue;
  readonly reason: string;
  readonly evidence: LoopEvidence;
}

/**
 * THE PROBE. Precondition: the caller has already held the gate.
 *
 * `loop: 'gated'` is a claim that something here actually
 * controls this game's frames, so it must be MEASURED:
 *
 *  - **Are we withholding anything?** `pending > 0` means the game asked for a
 *    frame or a timer and the gate is sitting on it. With nothing parked there
 *    is nothing to prove control OVER. This is the rule the old
 *    `getAnimationLoop(renderer) !== null` check lacked: it asked whether the
 *    game had ever *declared* a loop, not whether we were holding one.
 *  - **Did anything run anyway?** `firedWhileHeld` must be 0 (the gate leaked
 *    if not), and the injected `progress` reader — the game renderer's own
 *    frame counter, which is independent of this gate — must not advance.
 *
 * All three must hold to report `gated`.
 *
 * The window is SAMPLED, not measured end-to-end, and it is long by default.
 * A 250ms window is sized for `requestAnimationFrame`, which fires
 * every ~16ms; the slowest driver here is a `setInterval` a game chooses the
 * period of, and a city-builder's simulation tick is 1000ms. Measured live: a 250ms
 * single-sample window saw `pending: 0` and honestly-but-uselessly reported
 * "the gate is withholding nothing" about a gate that had, moments later, both
 * of that game's intervals parked. A probe reporting its own impatience as the
 * game's shape is the same class of error as the declaration check it replaced,
 * so the window covers a 1Hz driver and every sample counts.
 */
export async function verifySameRealmLoopControl(opts: {
  gate: SameRealmLoopGate | null;
  /** An independent, monotonically-advancing progress signal for this game —
   *  in practice `renderer.info.render.frame` on the CAPTURED game renderer. */
  progress: () => number;
  /** Total real time to watch. Default 1500ms — long enough for a 1Hz
   *  `setInterval` simulation tick to become observable (see the doc comment). */
  windowMs?: number;
  /** How often to sample within the window. */
  sampleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<SameRealmLoopVerdict> {
  const windowMs = opts.windowMs ?? 1500;
  const sampleMs = Math.max(1, Math.min(opts.sampleMs ?? 50, windowMs));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gate = opts.gate;
  if (!gate) {
    return {
      loop: 'self-driven',
      reason:
        'no same-realm loop gate is installed, so nothing here controls this game’s scheduling',
      evidence: {
        pendingWhileHeld: 0,
        firedWhileHeld: 0,
        progressBefore: 0,
        progressAfter: 0,
        windowMs,
      },
    };
  }
  const before = gate.stats();
  const progressBefore = opts.progress();
  let after = before;
  let progressAfter = progressBefore;
  // The PEAK parked count across the window, not the endpoint: a one-shot timer
  // parked at 200ms and released by a Step at 900ms would read 0 at the end and
  // erase the very evidence it is.
  let pendingWhileHeld = before.pending;
  let heldThroughout = before.mode === 'held';
  for (let elapsed = 0; elapsed < windowMs; elapsed += sampleMs) {
    await sleep(Math.min(sampleMs, windowMs - elapsed));
    after = gate.stats();
    progressAfter = opts.progress();
    pendingWhileHeld = Math.max(pendingWhileHeld, after.pending);
    if (after.mode !== 'held') {
      heldThroughout = false;
      break;
    }
  }
  const firedWhileHeld = after.firedWhileHeld - before.firedWhileHeld;
  const evidence = { pendingWhileHeld, firedWhileHeld, progressBefore, progressAfter, windowMs };

  if (!heldThroughout || after.mode !== 'held') {
    return {
      loop: 'unmeasured',
      reason:
        'the gate was not held for the whole probe window — something else released it, so ' +
        'control was not measured',
      evidence,
    };
  }
  if (firedWhileHeld > 0) {
    return {
      loop: 'self-driven',
      reason:
        `${firedWhileHeld} gated callback(s) ran while the gate was held — the gate leaked, ` +
        'so it cannot claim control',
      evidence,
    };
  }
  if (progressAfter > progressBefore) {
    return {
      loop: 'self-driven',
      reason:
        `the game kept rendering while its scheduling was withheld ` +
        `(frame ${progressBefore} → ${progressAfter} in ${windowMs}ms) — something outside this ` +
        'gate drives its loop',
      evidence,
    };
  }
  if (pendingWhileHeld === 0) {
    return {
      loop: 'unmeasured',
      reason:
        'nothing was due while the gate was held, so it withheld nothing and the probe learned ' +
        'nothing about this loop — note a hidden or backgrounded tab schedules no frames at ' +
        'all, which is a fact about the TAB, never about the game',
      evidence,
    };
  }
  return {
    loop: 'gated',
    reason:
      `verified: ${pendingWhileHeld} scheduled callback(s) withheld, none ran, and no frame ` +
      `advanced in ${windowMs}ms of held time`,
    evidence,
  };
}
