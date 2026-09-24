/**
 * The bot run's ONE store — status, trace, seat, and the operator directive.
 *
 * The resident QA tester (`src/bot/tester-station.ts`) plays this game from
 * INSIDE the page, directed live from the REPL through `hireTester`. This module
 * holds what it is doing so the game's Tester surface and `vgai eval`
 * both watch one run, and it implements the operator controls the tester
 * honors between steps. This module is plain application state and imports no
 * vgai API; its exports are the whole control surface.
 *
 * `getBotStatus()` reads `{active, seat, goal, step, phase, progress,
 * waitingOn, note, seed, directive}`. `pauseBot()`, `resumeBot()`,
 * `abortBot()`, and `handoffBot()` are the operator's controls. Abort and
 * handoff also clear virtual input immediately, so a human taking the seat
 * back never inherits a held key.
 *
 * Resource ownership: THIS MODULE owns bot run state; its ONE writer is the
 * tester (in-process, through `reportTesterRun`). The operator commands own
 * `directive` and the writer never overwrites it — except at a run BOUNDARY:
 * a patch that sets `active` (start or end) resets the directive, so a run
 * neither starts under nor hands on a stale stop. The terminal patch
 * (`active: false`) is the one teardown path that clears the run.
 *
 * ── THE SEAT ────────────────────────────────────────────────────────────────
 * `status.seat` is the CONTROLLER, and it has exactly ONE owner at a time —
 * the tester, or you ({@link seatTester}, {@link releaseTester} — nobody
 * else may reason about `seat`). `hireTester` while a run is active refuses
 * (two hands on one controller); `bot.handoff` returns the seat to the
 * human's keyboard mid-run.
 *
 * Cost when idle: none. No timers, no frame work — reads are pull-only.
 */

import { clearVirtualActions } from '../input';

/** This module feeds the game's Tester surface and its operator controls. */
/** What the operator has asked the running bot to do. This module is the
 *  authority, because it is the side that VALIDATES. */
export type BotDirective = 'run' | 'pause' | 'abort' | 'handoff';

/** Who holds the controller — see this module's SEAT section. `null` while
 *  nothing is driving. */
export type BotSeat = 'tester' | null;

export interface BotStatus {
  readonly active: boolean;
  /** The controller's one owner right now. */
  readonly seat: BotSeat;
  /** The game-side tester's run: which behavior from its repertoire. */
  readonly goal: string | null;
  readonly step: string | null;
  readonly phase: string | null;
  /** Steps completed so far in this run. */
  readonly progress: number;
  /** What the tester is currently waiting on, when it is waiting. */
  readonly waitingOn: string | null;
  /** The tester's own live line — what it is doing, or why it stopped. */
  readonly note: string | null;
  readonly seed: number | null;
  readonly directive: BotDirective;
}

const IDLE: BotStatus = {
  active: false,
  seat: null,
  goal: null,
  step: null,
  phase: null,
  progress: 0,
  waitingOn: null,
  note: null,
  seed: null,
  directive: 'run',
};

/** One patch, from either writer. Every field is optional: absent means
 *  unchanged. The wire schema above is the DRIVER's half of this shape. */
export interface BotPatch {
  seat?: BotSeat | undefined;
  goal?: string | null | undefined;
  step?: string | null | undefined;
  phase?: string | null | undefined;
  progress?: number | undefined;
  waitingOn?: string | null | undefined;
  note?: string | null | undefined;
  active?: boolean | undefined;
  seed?: number | undefined;
}

let status: BotStatus = IDLE;

/** A field an absent patch leaves alone. */
function kept<T>(next: T | undefined, current: T): T {
  return next === undefined ? current : next;
}

/** A field that also RESETS at a run boundary. Both writers omit each other's
 *  fields, so without this a new run would wear the last one's identity. */
function scoped<T>(next: T | undefined, current: T, boundary: boolean, empty: T): T {
  if (next !== undefined) return next;
  return boundary ? empty : current;
}

function applyPatch(patch: BotPatch): BotStatus {
  // A run's own start and end are the only moments the operator's directive is
  // reset — otherwise an abort would silently carry into the next run.
  const boundary = patch.active !== undefined;
  status = {
    active: kept(patch.active, status.active),
    // The tester names its seat on start; a run that ENDS empties the seat.
    seat: patch.seat !== undefined ? patch.seat : boundary && !patch.active ? null : status.seat,
    goal: scoped(patch.goal, status.goal, boundary, null),
    step: kept(patch.step, status.step),
    phase: kept(patch.phase, status.phase),
    progress: scoped(patch.progress, status.progress, boundary, 0),
    waitingOn: kept(patch.waitingOn, status.waitingOn),
    note: scoped(patch.note, status.note, boundary, null),
    seed: scoped(patch.seed, status.seed, boundary, null),
    directive: boundary ? 'run' : status.directive,
  };
  return status;
}

/**
 * The GAME-SIDE writer's door: the resident QA tester
 * (`src/bot/tester-station.ts`) runs in this page, not over the wire, so it
 * patches the store directly. Same store, same boundary rules — see the
 * ownership note.
 */
export function reportTesterRun(patch: BotPatch): BotStatus {
  return applyPatch(patch);
}

/** Seat the tester for one goal — it starts the run and owns it. */
export function seatTester(goal: string): BotStatus {
  return applyPatch({
    goal,
    step: null,
    phase: 'drive',
    note: null,
    active: true,
    seat: 'tester',
    progress: 0,
  });
}

/** The ONE teardown path for a tester run: ends it and empties the seat. */
export function releaseTester(note: string | null): BotStatus {
  return applyPatch({ goal: null, step: null, phase: null, note, active: false, seat: null });
}

export function getBotStatus(): BotStatus {
  return status;
}

function setDirective(directive: BotDirective): BotStatus {
  status = { ...status, directive };
  return status;
}

function requireActiveRun(verb: string): void {
  if (!status.active) {
    throw new Error(`${verb}: no bot run is active — nothing is holding the controller.`);
  }
}

/** Pause the running bot at its next gate — a step boundary or a wait poll. */
export function pauseBot(): BotStatus {
  requireActiveRun('bot.pause');
  return setDirective('pause');
}

/** Resume a paused bot. */
export function resumeBot(): BotStatus {
  requireActiveRun('bot.resume');
  return setDirective('run');
}

/** Stop the running bot and release its virtual input. */
export function abortBot(): BotStatus {
  requireActiveRun('bot.abort');
  clearVirtualActions();
  return setDirective('abort');
}

/** Stop the bot and give the seat back to the human immediately — the
 *  keyboard has to be free the moment a person asks for it. */
export function handoffBot(): BotStatus {
  requireActiveRun('bot.handoff');
  clearVirtualActions();
  return setDirective('handoff');
}
