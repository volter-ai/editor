import { clampTimeScale, paceFrame, TIME_SCALE_RANGE } from '@volter/game-runtime/core/frame-pacing';
import type { GameLoopConfig, GameLoopLiveness } from './types';

/** A visible rAF chain that has produced no callback for this long is not
 * honestly "running" merely because its callback remains armed. One second
 * is far beyond an ordinary dropped frame and short enough for status to
 * report browser starvation while it is still actionable. */
const LOOP_STARVATION_MS = 1_000;

/**
 * Fixed-timestep game loop with accumulator pattern — SIM at a fixed rate,
 * PRESENTATION at the display's rate.
 *
 * Per real (rAF) frame:
 *
 *  1. the accumulator absorbs the frame gap (clamped, `timeScale`d) and
 *     `config.update(fixedDt)` runs once per WHOLE fixed substep it can
 *     consume, up to `maxSubSteps` — unchanged, and still the only thing that
 *     advances gameplay, physics, `tick`/`simT` and the sim clock;
 *  2. `config.render(alpha, displayDt)` runs EXACTLY ONCE, whatever step 1
 *     did — including zero times. `alpha` is `accumulator / fixedDt` after
 *     step 1 (see `core/frame-pacing.ts`): how far presentation sits past the
 *     last completed fixed state, in `[0, 1]`.
 *
 * So a 120 Hz display draws 120 frames a second off a 60 Hz simulation, and a
 * frame that consumes zero substeps still presents — which is the whole point:
 * before this, motion presented at SIM rate, so half of every 120 Hz display's
 * frames were duplicates and there was nowhere at all to host
 * `RenderStepped`-shaped per-display-frame code (camera polish, procedural
 * sway). `Game.onRenderStep` (`runtime/game.ts`) is that host, driven from
 * this callback.
 *
 * `config.render` is OPTIONAL, and the hosts that don't pass it keep the old
 * shape exactly: the `render` phase then still runs inside `config.update` as
 * the last phase of `PHASE_ORDER` (`runtime/game.ts` only skips the render
 * phases when its caller asks it to). That is deliberate, because two paths
 * must stay frame-exact and neither goes through the rAF arm at all:
 * `externalDrive` capture/offline export (see `GameLoopConfig.externalDrive`)
 * and `Game.runTicks`, which drives `runFrame` directly.
 */
export function createGameLoop(config: GameLoopConfig) {
  const fixedDt = config.fixedTimestep ?? 1 / 60;
  // Also the accumulator's hard ceiling — `paceFrame` derives
  // `fixedDt * maxSubSteps` from these two and clamps against it.
  const maxSubSteps = config.maxSubSteps ?? 8;
  // I2 (render-control runtime mode, see `GameLoopConfig.externalDrive`'s
  // doc comment): in this mode `start()` below deliberately skips both the
  // `requestAnimationFrame` arm AND the `visibilitychange` listener install —
  // no wall-clock timing source ever exists for this loop instance, so
  // `config.update` can only ever be invoked by an external driver calling
  // into the render-control seam, never by this file's own `frame()`.
  const externalDrive = config.externalDrive ?? false;

  let accumulator = 0;
  let lastTime = 0;
  let running = false;
  let rafId = 0;
  let timeScale = 1.0;

  // Idle throttle (T2.1): a hidden tab stops the loop outright; becoming
  // visible again restarts it with the accumulator clock resynced to "now" —
  // deliberately no catch-up burst for the wall-clock time spent hidden.
  let visibilityPaused = false;
  let visibilityListenerAttached = false;

  /** Reconcile the gate against the CURRENT document bit, not merely the
   * last event. Browsers can miss/coalesce visibilitychange around window
   * occlusion and reloads; reading liveness is itself a recovery opportunity,
   * so a stale event can never leave this flag permanently wedged. */
  function reconcileVisibilityGate() {
    if (externalDrive || !visibilityListenerAttached) return;
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      if (running) {
        running = false;
        cancelAnimationFrame(rafId);
        visibilityPaused = true;
      }
    } else if (visibilityPaused) {
      visibilityPaused = false;
      running = true;
      lastTime = performance.now();
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    }
  }

  function handleVisibilityChange() {
    reconcileVisibilityGate();
  }

  function frame(currentTime: number) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    // Convert to seconds
    const rawDt = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    // All of the pacing arithmetic — frame-gap clamp, timeScale, the
    // spiral-of-death accumulator clamp, the substep count and the
    // interpolation alpha — lives in `core/frame-pacing.ts`, pure and unit
    // tested. The accumulator is written back BEFORE the substeps run so a
    // throwing `update` cannot make the loop re-consume time it already
    // charged for.
    const paced = paceFrame(accumulator, rawDt, timeScale, { fixedDt, maxSubSteps });
    accumulator = paced.accumulator;

    // Fixed-rate: gameplay/physics, once per consumed substep. Zero times on
    // a frame that could not fill one.
    for (let i = 0; i < paced.steps; i++) config.update(fixedDt);

    // Display-rate: exactly once per real frame, whatever the substep count
    // was — see the module doc comment. Optional; a host that never passes
    // `render` keeps rendering inside `update`'s phase list.
    config.render?.(paced.alpha, paced.displayDt);
  }

  return {
    start() {
      if (running) return;
      running = true;
      // A direct start() call can land while the loop is auto-loop-starved
      // (`visibilityPaused` true, `running` false, no rAF pending). Without this
      // reset, a later visibilitychange-to-visible would see stale
      // `visibilityPaused === true` and spawn a SECOND rAF chain on top of the
      // one this call is about to start (doubled update()/render() overhead
      // until the next stop() — no sim-speed effect, but wasted work).
      visibilityPaused = false;
      lastTime = performance.now();
      accumulator = 0;

      // External-drive mode (I2): never arm rAF and never install the
      // visibilitychange auto-stop handler. `running` still flips `true`
      // above (so `isRunning`/`stop()` behave normally for a caller that
      // treats this loop as "started"), but nothing will ever call
      // `frame()` — a headless/backgrounded capture page cannot have this
      // loop silently killed by `document.hidden`, because there is no
      // listener to fire in the first place.
      if (externalDrive) return;

      // A play session can be started while the editor tab is ALREADY
      // hidden. In that case no future visibilitychange-to-hidden event will
      // arrive, and arming rAF would leave `running=true` forever while the
      // browser executes zero callbacks. Classify and park the loop before
      // arming it so status is truthful and visibility restore can resume it.
      if (!visibilityListenerAttached && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibilityChange);
        visibilityListenerAttached = true;
      }
      if (typeof document !== 'undefined' && document.hidden) {
        running = false;
        visibilityPaused = true;
        return;
      }

      rafId = requestAnimationFrame(frame);
    },

    stop() {
      running = false;
      visibilityPaused = false;
      cancelAnimationFrame(rafId);

      if (visibilityListenerAttached && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        visibilityListenerAttached = false;
      }
    },

    get isRunning() {
      reconcileVisibilityGate();
      return running;
    },

    /**
     * Truthful liveness (issue #175 — see `GameLoopLiveness`'s doc comment
     * in `core/types.ts` for the full contract). Unlike `isRunning` above,
     * this distinguishes a starved rAF loop from an actually-stopped loop.
     * `visibilityPaused` records the deliberate `document.hidden` gate, and
     * every read first reconciles that flag against the CURRENT document bit
     * so a missed visibilitychange cannot wedge it. A visible, armed chain
     * also reports starvation when no real frame callback has arrived within
     * {@link LOOP_STARVATION_MS}; "armed" alone is not evidence of progress. An
     * `externalDrive` loop never installs the visibility listener at all
     * (see `start()` above), so `visibilityPaused` stays permanently `false` for
     * it — it only ever reports `'running'` or `'stopped'`.
     */
    get liveness(): GameLoopLiveness {
      reconcileVisibilityGate();
      if (visibilityPaused) return 'loop-starved';
      if (running && !externalDrive && performance.now() - lastTime > LOOP_STARVATION_MS) {
        return 'loop-starved';
      }
      return running ? 'running' : 'stopped';
    },

    set timeScale(value: number) {
      const clamped = clampTimeScale(value);
      if (clamped !== value) {
        console.warn(
          `[game-loop] timeScale ${value} is out of range ` +
            `[${TIME_SCALE_RANGE.min}, ${TIME_SCALE_RANGE.max}]; clamped to ${clamped}.`,
        );
      }
      timeScale = clamped;
    },

    get timeScale() {
      return timeScale;
    },

    /**
     * The fixed substep timestep (seconds) this loop's accumulator consumes
     * per `config.update()` call (`config.fixedTimestep ?? 1/60`) — read by
     * `Game.runTicks` (D15, `runtime/game.ts`) so a synchronous fast-forward
     * burst drives `game.runFrame` with the SAME `fixedDt` this loop's own
     * rAF-driven accumulator would have used, without exposing (or
     * `runTicks` needing) any other internal loop state.
     */
    get fixedDt() {
      return fixedDt;
    },
  };
}
