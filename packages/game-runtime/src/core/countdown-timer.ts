/**
 * `Countdown` — a restartable interval the CALLER steps, with the two
 * behaviours under a frame hitch that decide whether a game's event count is
 * right.
 *
 * A respawn delay, a weapon cooldown, a wave spawner, a grace window: each is
 * "count down from N seconds, tell me, maybe go again, and let me restart or
 * stop you at any point". `core/sim-clock.ts` schedules a one-shot at an
 * ABSOLUTE sim time — the right shape for "3 seconds from now, once" and the
 * wrong one for a live interval that game code re-arms, reads
 * ({@link Countdown.remaining} is what a HUD ring draws) and cancels.
 *
 * That gap used to be papered over in `sim-clock.ts`'s own header, which said
 * an `after` re-arming itself was "three lines the game owns". Those three
 * lines are wrong in a way nobody notices: re-arming schedules the next fire
 * from the moment the callback RAN, so every long frame permanently lengthens
 * the interval, and a game that hitches ten times has silently slowed its
 * spawner. That is the drift {@link Countdown} exists to not have.
 *
 * ## It owns no clock, and that is the requirement rather than a shortcut
 *
 * There is no `setTimeout`, no `setInterval`, no `requestAnimationFrame` and no
 * subscription anywhere in this module. A countdown advances only inside
 * {@link Countdown.advance}, from seconds the caller already has — the fixed
 * loop's own dt. This repo runs a fixed-step sim with display-rate
 * presentation and can step a game deterministically; a countdown on wall-clock
 * `setTimeout` would be a second, undeterministic timeline that no care
 * downstream could re-sync. A countdown nobody advances does not fire —
 * visibly, rather than drifting.
 *
 * ## The frame-hitch contract, which is the whole reason this is a module
 *
 * Both rules are about keeping the EVENT COUNT correct when `dt` is larger than
 * the period, which is exactly when a game is already in trouble:
 *
 *  - **Overshoot carries into the next period.** A 0.5 s repeating countdown
 *    advanced by 0.6 fires once and has 0.4 s left, not 0.5. Resetting to the
 *    full period instead would make one slow frame lengthen every interval
 *    after it — the drift above, one layer down.
 *  - **A single large step fires MORE THAN ONCE.** A 0.1 s countdown advanced
 *    by 0.35 fires three times and has 0.05 s left. Dropping the extras would
 *    silently slow a repeating countdown down whenever the frame was long, so a
 *    wave that should have spawned 3 enemies spawns 1 and the difficulty curve
 *    quietly depends on frame rate.
 *
 * Two consequences a caller must know about, both deliberate: `onElapsed` can
 * be invoked several times within one `advance` call, and it runs INLINE
 * (synchronously, inside `advance`) rather than on a microtask — so the caller
 * always knows exactly which point of its frame the callback ran at.
 *
 * A one-shot countdown STOPS ITSELF BEFORE invoking `onElapsed`, so a callback
 * that calls {@link Countdown.start} re-arms rather than fighting the stop.
 * A callback that calls {@link Countdown.stop} ends the multi-fire loop
 * immediately, which is what makes "fire once then disarm from inside the
 * callback" work.
 *
 * ## Resource ownership
 *
 * **Owner:** whoever calls {@link createCountdown}. A countdown holds two
 * numbers, a boolean and the `onElapsed` reference; it registers nothing,
 * subscribes to nothing, and this module has no module-level state — so there
 * is deliberately no `dispose()` and dropping the countdown drops everything it
 * had. **Sharers:** none; a countdown is not shareable, because whoever
 * advances it decides its timeline. **Teardown:** what DOES need unregistering
 * is the countdown's slot in whatever set the owner advances each frame, and
 * that is the owner's — the same way `SceneTree.addTimer` hands back a remover.
 */

/** A restartable countdown. Build one with {@link createCountdown}. */
export interface Countdown {
  /** Seconds it counts from. Reflects the last {@link Countdown.start} that
   *  passed a duration. */
  readonly duration: number;
  /** Does it re-arm itself after firing, or stop? */
  readonly repeats: boolean;
  /** Seconds left, or 0 when it is not running. */
  readonly remaining: number;
  /** Is it counting? */
  readonly running: boolean;
  /**
   * Start, or RESTART a running countdown from the top. Passing `duration`
   * overwrites {@link Countdown.duration} for this and every later start.
   *
   * @throws RangeError if `duration` is not a finite positive number of
   * seconds. A non-positive period cannot fire and reads as a hung game
   * rather than a misconfigured one, so it refuses at the call site.
   */
  start(duration?: number): void;
  /** Stop counting. Invokes nothing. */
  stop(): void;
  /**
   * Advance by `dt` SECONDS, invoking `onElapsed` once per completed period —
   * possibly several times in one call. See the module header's frame-hitch
   * contract.
   */
  advance(dt: number): void;
}

/** What {@link createCountdown} needs. */
export interface CountdownOptions {
  /** Seconds to count from. Default 1. */
  readonly duration?: number;
  /** Re-arm after firing instead of stopping. Default `false` (one-shot). */
  readonly repeats?: boolean;
  /** Begin counting immediately instead of waiting for a `start()`. Default
   *  `false`. */
  readonly autostart?: boolean;
  /** Invoked inline, once per completed period. */
  readonly onElapsed: () => void;
}

function assertDuration(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `createCountdown: duration must be a finite, positive number of seconds, got ${String(value)}`,
    );
  }
}

/**
 * Build a countdown.
 *
 * ```ts
 * const wave = createCountdown({ duration: 8, repeats: true, autostart: true, onElapsed: spawnWave });
 * useFrame((_, dt) => wave.advance(dt));   // the caller owns the step
 * ```
 */
export function createCountdown(options: CountdownOptions): Countdown {
  const onElapsed = options.onElapsed;
  const repeats = options.repeats === true;
  let duration = options.duration ?? 1;
  let remaining = 0;
  let running = false;

  assertDuration(duration);

  const countdown: Countdown = {
    get duration(): number {
      return duration;
    },
    get repeats(): boolean {
      return repeats;
    },
    get remaining(): number {
      return running ? remaining : 0;
    },
    get running(): boolean {
      return running;
    },

    start(newDuration): void {
      if (newDuration !== undefined) {
        assertDuration(newDuration);
        duration = newDuration;
      }
      remaining = duration;
      running = true;
    },

    stop(): void {
      running = false;
      remaining = 0;
    },

    advance(dt): void {
      if (!running) return;
      remaining -= dt;
      // The loop is the multi-fire rule; `running` in the condition is what
      // lets a callback's own stop() end it. Module header, frame-hitch.
      while (running && remaining <= 0) {
        if (!repeats) {
          // Disarm BEFORE invoking, so a callback that calls start() re-arms
          // instead of being immediately stopped by this branch.
          running = false;
          remaining = 0;
          onElapsed();
          return;
        }
        // Carry the overshoot rather than resetting to the full period.
        remaining += duration;
        onElapsed();
      }
    },
  };

  if (options.autostart === true) countdown.start();
  return countdown;
}
