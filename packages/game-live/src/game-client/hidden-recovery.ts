/**
 * Hidden-tab recovery — pure decision logic, ported from hollowstone's field
 * lessons (the engine hard-stops its loop while `document.hidden`, and a
 * backgrounded tab therefore looks identical to a genuinely stalled
 * game). No Playwright import here: `client.ts`'s `GameClient.snapshot()` —
 * the one read every `waitFor`/`waitSimTime` poll already performs — feeds a
 * `HiddenRecoveryDriver` one tick observation per poll, and only the
 * caller-supplied hooks (wired up in `client.ts`, the one file allowed to
 * touch a live `Page`) perform the actual `page.evaluate('document.hidden')`
 * sample and `page.bringToFront()` call. Unit tests feed the same driver
 * scripted hooks/observations instead.
 *
 * Contract (deliberately narrow): after `HIDDEN_RECOVERY_STALL_POLLS`
 * consecutive polls with an unmoved sim tick, sample `document.hidden` once
 * per poll until it reads `true`, then call `bringToFront()` EXACTLY ONCE
 * (the `recovered` flag latches shut) and keep polling — no wall-clock
 * timeout is added here or anywhere downstream. If the clock stays frozen
 * after recovery, the normal `runWaitFor` sim-time budget exhausts and
 * throws `WaitForTimeoutError` as it always would; that failure block's
 * ~0x sim-speed ratio is what diagnoses a still-stalled loop, not this
 * module reacting a second time.
 */

export const HIDDEN_RECOVERY_STALL_POLLS = 10;

export interface HiddenRecoveryState {
  /** Consecutive polls (so far) where the sim tick has not advanced. */
  stalledPolls: number;
  /** Latches true the moment `bringToFront` has fired once — never resets,
   *  even if the tick later moves and then stalls again, per "once". */
  recovered: boolean;
}

export const initialHiddenRecoveryState: HiddenRecoveryState = {
  stalledPolls: 0,
  recovered: false,
};

export interface PollObservation {
  /** True when this poll's snapshot tick equals the previous poll's tick. */
  tickUnchanged: boolean;
  /** `document.hidden`, sampled by the caller — only meaningful (and only
   *  ever sampled by real callers) once `shouldSampleHidden` says so;
   *  `undefined` means "not sampled this poll". */
  hidden?: boolean | undefined;
}

export type HiddenRecoveryAction = 'none' | 'bring-to-front';

/** Whether THIS poll's caller should bother sampling `document.hidden` at
 *  all — an efficiency guard so a healthy, moving game never pays an extra
 *  `page.evaluate()` per poll. True only once the stall threshold is about
 *  to be (or has been) reached, the tick is (still) unchanged, and recovery
 *  hasn't already fired. */
export function shouldSampleHidden(state: HiddenRecoveryState, tickUnchanged: boolean): boolean {
  if (state.recovered || !tickUnchanged) return false;
  return state.stalledPolls + 1 >= HIDDEN_RECOVERY_STALL_POLLS;
}

/** One pure transition. Called once per `runWaitFor` poll with the previous
 *  state and this poll's observation; returns the next state plus the
 *  action the caller should take. */
export function stepHiddenRecovery(
  state: HiddenRecoveryState,
  obs: PollObservation,
): { state: HiddenRecoveryState; action: HiddenRecoveryAction } {
  if (!obs.tickUnchanged) {
    return { state: { stalledPolls: 0, recovered: state.recovered }, action: 'none' };
  }
  const stalledPolls = state.stalledPolls + 1;
  if (state.recovered || obs.hidden !== true) {
    return { state: { stalledPolls, recovered: state.recovered }, action: 'none' };
  }
  if (stalledPolls >= HIDDEN_RECOVERY_STALL_POLLS) {
    return { state: { stalledPolls, recovered: true }, action: 'bring-to-front' };
  }
  return { state: { stalledPolls, recovered: false }, action: 'none' };
}

/** The page-facing side effects the driver needs, injected so this module
 *  never imports Playwright (`client.ts` supplies the real ones; tests
 *  supply scripted fakes). */
export interface HiddenRecoveryHooks {
  /** Real implementation: `page.evaluate(() => document.hidden)`. */
  sampleHidden(): Promise<boolean> | boolean;
  /** Real implementation: `page.bringToFront()`. */
  bringToFront(): Promise<void> | void;
  /** Real implementation: `console.log(line)` + push onto the client's
   *  console-errors collection so the line also surfaces in an eventual
   *  failure block's console-errors section. */
  log(line: string): void;
}

/** Renders the structured recovery line — one stable, greppable shape. */
export function hiddenRecoveryLogLine(tick: number): string {
  return (
    `game-live: hidden-tab recovery — sim tick frozen at ${tick} for ` +
    `${HIDDEN_RECOVERY_STALL_POLLS} consecutive polls while document.hidden=true; ` +
    'calling page.bringToFront() once'
  );
}

/**
 * Stateful wrapper over the pure transition above, fed one tick observation
 * per poll (`GameClient.snapshot()` calls `observeTick` on every read). All
 * side effects go through the injected hooks; a hook failure (page already
 * closed, say) is swallowed — a recovery attempt must never be what fails a
 * test.
 */
export class HiddenRecoveryDriver {
  private state: HiddenRecoveryState = initialHiddenRecoveryState;
  private lastTick: number | null = null;
  private didTrigger = false;

  constructor(private readonly hooks: HiddenRecoveryHooks) {}

  /** True once `bringToFront()` has fired (at most once per driver/test). */
  wasTriggered(): boolean {
    return this.didTrigger;
  }

  async observeTick(tick: number): Promise<void> {
    const tickUnchanged = this.lastTick !== null && tick === this.lastTick;
    this.lastTick = tick;

    let hidden: boolean | undefined;
    if (shouldSampleHidden(this.state, tickUnchanged)) {
      try {
        hidden = await this.hooks.sampleHidden();
      } catch {
        hidden = undefined;
      }
    }

    const { state, action } = stepHiddenRecovery(this.state, { tickUnchanged, hidden });
    this.state = state;

    if (action === 'bring-to-front') {
      this.didTrigger = true;
      this.hooks.log(hiddenRecoveryLogLine(tick));
      try {
        await this.hooks.bringToFront();
      } catch {
        // Same rule as sampleHidden: never let the recovery attempt itself
        // throw into a spec — the sim-time budget remains the only failure.
      }
    }
  }
}
