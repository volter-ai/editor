/**
 * The resident QA TESTER's run state and doors — the half of the live
 * playtesting loop that actually plays the game.
 *
 * Two people build this game: the DEVELOPER (a coding agent at the REPL) and
 * the TESTER. The developer arranges the situation with the game's own setup
 * verbs and tunables, then says WHAT TO TEST in intent terms —
 * `hireTester('sweep')` on this running module — and watches. The tester holds the
 * controller from here on: it steps its goal once per sim tick
 * (`src/bot/QaTester.tsx`'s frame hook calls {@link stepTester}), acting ONLY
 * through this game's own input store, at the game's own timescale. A
 * developer at conversation pace cannot honestly play a realtime game, which
 * is exactly why the tester exists.
 *
 * Exported surface:
 * - {@link hireTester} starts a named goal and is always callable;
 * - {@link describeTester} returns the repertoire and the last run's outcome.
 * The outcome lives here rather than in the run-scoped status because that
 * status resets at exactly the moment the outcome exists.
 *
 * The SEAT — who may hold the controller — is `bot-station.ts`'s to define
 * and enforce. This module takes
 * (`seatTester`) and gives it back (`releaseTester`); it never reasons about
 * the rule itself.
 *
 * No vgai import anywhere: the tester's hands are the project's own input
 * store (`src/input.ts`), typed through `tester-run.ts`'s narrow
 * `TesterInputTarget`.
 */

import { clearVirtualActions, gameActions, setVirtualAction } from '../input';
import { describeTesterBehaviors, resolveTesterBehavior } from './behaviors';
import { getBotStatus, releaseTester, reportTesterRun, seatTester } from './bot-station';
import {
  startTesterRun,
  type TesterInputTarget,
  type TesterRun,
  type TesterRunStatus,
} from './tester-run';

/** How a finished job is remembered for the developer's next poll. */
interface TesterJobRecord {
  readonly goal: string;
  readonly outcome: TesterRunStatus;
  readonly note: string | null;
  readonly simSeconds: number;
}

let currentRun: TesterRun | null = null;
let lastJob: TesterJobRecord | null = null;
const pendingTapReleases = new Set<string>();

/** The tester's hands, over this game's OWN input store. `tap` is a set that
 *  the behavior itself releases — the store keeps no tick scheduler the
 *  neutral scaffold has no reader for. */
const hands: TesterInputTarget = {
  actionNames: () => [...gameActions],
  setVirtualAction(action, value) {
    try {
      setVirtualAction(action, value);
      return { delivered: true };
    } catch (error) {
      return { delivered: false, reason: String(error) };
    }
  },
  tapVirtualAction(action) {
    try {
      setVirtualAction(action, true);
      pendingTapReleases.add(action);
      return { delivered: true };
    } catch (error) {
      return { delivered: false, reason: String(error) };
    }
  },
};

/** Release taps from the previous tick before the next behavior step. A tap
 * therefore stays asserted while every later gameplay callback reads this
 * frame, instead of becoming an invisible true→false write in one call. */
function releasePendingTaps(): void {
  for (const action of pendingTapReleases) setVirtualAction(action, false);
  pendingTapReleases.clear();
}

/** The `paramsJson` argument, as typed at a REPL or into the Dev tab's field. */
function parseGoalParams(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `hireTester: params are not valid JSON (${String(error)}). Pass an object literal, ` +
        'e.g. \'{"holdSimSeconds": 1.5}\'.',
    );
  }
}

/** The Tester contribution and live REPL's discovery/readout body. */
export function describeTester(): {
  behaviors: ReturnType<typeof describeTesterBehaviors>;
  running: string | null;
  last: TesterJobRecord | null;
} {
  return {
    behaviors: describeTesterBehaviors(),
    running: currentRun?.goal ?? null,
    last: lastJob,
  };
}

/** Hire the tester for one goal. */
export function hireTester(name: string, paramsJson?: string): { goal: string; summary: string } {
  if (currentRun !== null) {
    throw new Error(
      `hireTester: the tester is already playing "${currentRun.goal}". ` +
        'Let it finish, or call `abortBot()` first.',
    );
  }
  const behavior = resolveTesterBehavior(name);
  const params = behavior.params
    ? behavior.params.parse(parseGoalParams(paramsJson))
    : parseGoalParams(paramsJson);

  // Takes the seat, starting a run of its own. `drive` is the honest phase
  // tag: everything a tester does is player input. A `setup` cheat is the
  // developer's move, never the tester's.
  seatTester(name);
  try {
    currentRun = startTesterRun({
      goal: name,
      behavior,
      params,
      input: hands,
      directive: () => getBotStatus().directive,
      report: (patch) => reportTesterRun(patch),
    });
  } catch (error) {
    // `create()` is game code and may throw (it reads game state at start).
    // The seating above is already published, so give the seat back —
    // otherwise it strands with no run behind it and the guard refuses every
    // future `hireTester` call.
    lastJob = { goal: name, outcome: 'failed', note: String(error), simSeconds: 0 };
    releaseTester(String(error));
    throw error;
  }
  return { goal: name, summary: behavior.summary };
}

/** One sim tick of the tester's hands — called by `QaTester.tsx`'s frame hook,
 *  which runs before every game-logic hook so a virtual action is already
 *  written when the first mechanic reads it. */
export function stepTester(dt: number): void {
  // Paused redraws must not consume a waypoint or release a pending tap.
  if (dt <= 0) return;
  releasePendingTaps();
  const run = currentRun;
  if (run === null) return;
  const status = run.step(dt);
  if (status === 'running') return;

  currentRun = null;
  lastJob = {
    goal: run.goal,
    outcome: status,
    note: run.note,
    simSeconds: Number(run.elapsed.toFixed(3)),
  };
  // The terminal patch: gives the seat back — to the human, or
  // to nobody, ending the run this tester started.
  releaseTester(run.note);
}

/**
 * The world is unmounting (Play stopped): a run cannot outlive the frame that
 * steps it. Ends the current run as `stopped`, releases the seat, and leaves
 * the outcome on `last` — module state must never strand a dead run into the
 * NEXT session, where `hireTester` would refuse every goal for a run nothing
 * is stepping. `QaTester.tsx`'s unmount cleanup is the one caller.
 */
export function stopTesterForUnmount(): void {
  releasePendingTaps();
  clearVirtualActions();
  const run = currentRun;
  if (run === null) return;
  currentRun = null;
  lastJob = {
    goal: run.goal,
    outcome: 'stopped',
    note: 'the world unmounted mid-run',
    simSeconds: Number(run.elapsed.toFixed(3)),
  };
  releaseTester('the world unmounted mid-run');
}
