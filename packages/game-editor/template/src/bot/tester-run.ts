/**
 * ONE tester run: a goal, the hands it plays with, and the per-tick stepping
 * that honors the operator's directive.
 *
 * Kept out of the React component on purpose — this is the part with rules
 * (the tester only ever writes virtual input; pause takes its hands off the
 * controller; abort/handoff end the run), and rules deserve to be provable
 * without a browser. `src/bot/QaTester.tsx` is the thin half: hooks, the frame
 * callback, and the bridge store.
 *
 * Resource ownership: a run owns the virtual actions IT set, and nothing else.
 * It records every actuation it makes so it can let go of exactly those on
 * pause, on abort, and at the end — which is what makes `bot.handoff` hand a
 * clean keyboard to the human. The engine's `clearVirtualActions()` (the
 * bridge's own abort path) is the bigger hammer; a run never needs it.
 */

import type { TesterBehavior, TesterHands, TesterOutcome, TesterTick } from './behaviors';

/** What the operator has asked the running bot to do — the union
 *  `src/bot/bot-station.ts` validates and owns. */
export type TesterDirective = 'run' | 'pause' | 'abort' | 'handoff';

/** How a run ended. The behavior's own `done`/`failed`, plus `stopped` for the
 *  operator ending it — a stopped run is not a failed game. */
export type TesterRunStatus = 'running' | 'done' | 'failed' | 'stopped';

/**
 * The methods the tester's hands need — `tester-station.ts` builds them over
 * the game's real input store (`src/input.ts`), and a disposable REPL probe may
 * pass a recorder. Typed narrowly here so this module never imports the engine, and
 * so the surface a tester can reach is visible in one glance: virtual input,
 * and nothing else.
 */
export interface TesterInputTarget {
  actionNames(): string[];
  setVirtualAction(
    action: string,
    value: boolean | number | { x: number; y: number },
  ): { delivered: boolean; reason?: string };
  tapVirtualAction(action: string): { delivered: boolean; reason?: string };
}

export interface TesterRunPatch {
  readonly step?: string;
  readonly progress?: number;
  readonly note?: string;
}

export interface TesterRunOptions {
  /** The behavior name from this game's repertoire, for reporting. */
  readonly goal: string;
  readonly behavior: TesterBehavior;
  /** Already parsed against `behavior.params` by the caller. */
  readonly params: unknown;
  readonly input: TesterInputTarget;
  /** Read fresh every tick, so pause/abort bite on the next tick. */
  readonly directive: () => TesterDirective;
  readonly report: (patch: TesterRunPatch) => void;
}

/** The "let go" value for whatever shape was last written. */
function releasedValue(
  value: boolean | number | { x: number; y: number },
): boolean | number | { x: number; y: number } {
  if (typeof value === 'boolean') return false;
  if (typeof value === 'number') return 0;
  return { x: 0, y: 0 };
}

class Hands implements TesterHands {
  readonly #input: TesterInputTarget;
  /** Every action this run is currently actuating, with its last value — the
   *  ledger `release`/`suspend`/`resume` work from. */
  readonly #held = new Map<string, boolean | number | { x: number; y: number }>();
  #undelivered: string | null = null;

  constructor(input: TesterInputTarget) {
    this.#input = input;
  }

  actions(): readonly string[] {
    return this.#input.actionNames();
  }

  set(action: string, value: boolean | number | { x: number; y: number }): void {
    this.#note(this.#input.setVirtualAction(action, value));
    this.#held.set(action, value);
  }

  tap(action: string): void {
    this.#note(this.#input.tapVirtualAction(action));
  }

  release(): void {
    this.#letGo();
    this.#held.clear();
  }

  /** Pause: hands off the controller, ledger kept so `resume` can take it
   *  back exactly as it was. */
  suspend(): void {
    this.#letGo();
  }

  resume(): void {
    for (const [action, value] of this.#held) {
      this.#note(this.#input.setVirtualAction(action, value));
    }
  }

  /** The last actuation the engine refused (input gated), consumed by the
   *  reader. A swallowed actuation must never look like a delivered one. */
  takeUndelivered(): string | null {
    const reason = this.#undelivered;
    this.#undelivered = null;
    return reason;
  }

  #letGo(): void {
    for (const [action, value] of this.#held) {
      this.#input.setVirtualAction(action, releasedValue(value));
    }
  }

  #note(result: { delivered: boolean; reason?: string }): void {
    if (!result.delivered) this.#undelivered = result.reason ?? 'actuation not delivered';
  }
}

export class TesterRun {
  readonly goal: string;
  readonly #options: TesterRunOptions;
  readonly #hands: Hands;
  readonly #step: (tick: TesterTick) => TesterOutcome;
  #status: TesterRunStatus = 'running';
  #note: string | null = null;
  #elapsed = 0;
  #suspended = false;

  constructor(options: TesterRunOptions) {
    this.goal = options.goal;
    this.#options = options;
    this.#hands = new Hands(options.input);
    this.#step = options.behavior.create(
      {
        hands: this.#hands,
        report: (patch) => {
          if (patch.note !== undefined) this.#note = patch.note;
          options.report(patch);
        },
      },
      options.params,
    );
  }

  /** Sim seconds this run has been playing. */
  get elapsed(): number {
    return this.#elapsed;
  }

  /** The last thing the run said about itself — the terminal one is why it
   *  ended. */
  get note(): string | null {
    return this.#note;
  }

  get status(): TesterRunStatus {
    return this.#status;
  }

  /**
   * Advance the run by one sim tick. Returns the run's status: anything but
   * `running` means it is over and the caller should retire it.
   */
  step(dt: number): TesterRunStatus {
    if (this.#status !== 'running') return this.#status;

    const directive = this.#options.directive();
    if (directive === 'abort' || directive === 'handoff') {
      // The bridge's own command already released virtual input for the
      // human; this drops the run's ledger so nothing can re-assert it.
      this.#hands.release();
      return this.#end('stopped', `stopped by bot.${directive}`);
    }

    if (directive === 'pause') {
      if (!this.#suspended) {
        this.#suspended = true;
        this.#hands.suspend();
        this.#report('paused — hands off the controller');
      }
      // Paused holds POSITION: the behavior is not stepped and no sim budget
      // is charged against it, so resuming continues the same play.
      return 'running';
    }

    if (this.#suspended) {
      this.#suspended = false;
      this.#hands.resume();
      this.#report('resumed');
    }

    this.#elapsed += dt;

    let outcome: TesterOutcome;
    try {
      outcome = this.#step({ dt, elapsed: this.#elapsed });
    } catch (error) {
      this.#hands.release();
      return this.#end('failed', String(error));
    }

    const undelivered = this.#hands.takeUndelivered();
    if (undelivered !== null) this.#report(`input not delivered — ${undelivered}`);

    if (outcome === 'running') return 'running';
    this.#hands.release();
    return this.#end(outcome, this.#note ?? `behavior reported ${outcome}`);
  }

  #report(note: string): void {
    this.#note = note;
    this.#options.report({ note });
  }

  #end(status: TesterRunStatus, note: string): TesterRunStatus {
    this.#status = status;
    this.#note = note;
    return status;
  }
}

/** Start a goal. The behavior is created here, so anything it wants to read at
 *  start (the declared action list, game state) is read before the first tick. */
export function startTesterRun(options: TesterRunOptions): TesterRun {
  return new TesterRun(options);
}
