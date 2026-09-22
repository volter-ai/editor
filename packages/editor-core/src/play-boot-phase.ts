/**
 * WHAT PLAY WAS DOING WHEN IT STOPPED ANSWERING.
 *
 * ## The measurement this exists for
 *
 * 2026-08-20, `packages/editor/scripts/scale-harness` at N=20000 on the canvas
 * lane. `vgai play` burned its whole 120s budget and was refused with
 *
 *     Command timed out — the tab is present (last heartbeat 0.8s ago) and
 *     did not respond.
 *
 * then `screenshot` (15s) and `stop` (30s) were refused with the same sentence.
 * Every one of those statements was TRUE and none of them was the answer: the
 * heartbeat is a WORKER, so it kept beating at 0.4s while the page's main
 * thread sat inside one 199.5-second synchronous block. Four consecutive runs,
 * three silent timeouts each, against a session every reader called healthy.
 *
 * The defect the fix closed was a quadratic name derivation
 * (`@vgai/game-runtime/pixi/authoring`). The defect THIS closes is that nothing anywhere
 * could say which of play's eight steps the page was in — the relay knows only
 * that it asked, the tab table knows only that the tab exists, and the page
 * itself, being wedged, is the one party that cannot speak.
 *
 * ## The mechanism
 *
 * A phase is published BEFORE its work starts, on the control channel, as its
 * own tiny message — never folded into the state snapshot, which is the
 * expensive derivation a wedged page cannot produce and which is exactly the
 * thing that goes silent. So the server always holds the phase the page was
 * ENTERING when it went quiet, and the relay's refusal can name it.
 *
 * This module is the page's half and is deliberately pure apart from one
 * injected reporter: the latch, the phase vocabulary, and the sentence are all
 * unit-testable without a browser.
 */

/**
 * The steps of a play boot, in the order `play-mode.ts` runs them.
 *
 * The vocabulary is shared with `play-boot-stall.ts`: the three network-shaped
 * steps it already guards use the SAME wording here, so the hidden-tab stall
 * message and a stuck-play refusal cannot describe the same step differently.
 * The steps that guard does not wrap — the runtime mount and the authoring
 * install, which must never be abandoned mid-flight — are the ones that had no
 * name at all, and they are where the 199.5s block was measured.
 */
export const PLAY_BOOT_PHASES = [
  'waiting for the editor to bind Play',
  'waiting for the project bootstrap to settle',
  'starting the play log session',
  'opening the Game document',
  'fetching the project manifest',
  "resolving the project's root entries",
  'mounting the runtime roots',
  'installing play authoring for each root',
  'binding the editor to the running game',
] as const;

export type PlayBootPhase = (typeof PLAY_BOOT_PHASES)[number];

/** The page's standing answer to "what is play doing right now". */
/** Any main-thread work the page announces before starting it: a play boot
 *  step, or a document's `building src/models/x.ts`. */
export type PagePhase = PlayBootPhase | `building ${string}`;

export interface PlayBootPhaseState {
  /** The phase being ENTERED, or `null` once the boot settled either way. */
  readonly phase: PagePhase | null;
  /** Epoch ms the page entered it (or left the last one). */
  readonly at: number;
  /** This play attempt's ordinal, so a stale report is recognizable as stale. */
  readonly run: number;
}

let _state: PlayBootPhaseState = { phase: null, at: 0, run: 0 };
let _report: ((state: PlayBootPhaseState) => void) | null = null;

/**
 * Install the upstream reporter. Wired once at editor boot; left unset in
 * tests, where the latch is read directly.
 */
export function setPlayBootPhaseReporter(
  report: ((state: PlayBootPhaseState) => void) | null,
): void {
  _report = report;
}

function publish(next: PlayBootPhaseState): void {
  _state = next;
  // A reporter that throws must never break a play boot — the phase is
  // diagnostics, and diagnostics that can fail the thing they describe are
  // worse than none.
  try {
    _report?.(next);
  } catch {
    /* the boot continues; the reader loses one phase line */
  }
}

/** Begin a play attempt. Returns its run ordinal. */
export function beginPlayBoot(now: number = Date.now()): number {
  publish({ phase: null, at: now, run: _state.run + 1 });
  return _state.run;
}

/** Enter one phase. Called BEFORE the phase's work, never after it. */
export function markPlayBootPhase(phase: PlayBootPhase, now: number = Date.now()): void {
  publish({ phase, at: now, run: _state.run });
}

/**
 * The boot settled — started, failed, or was superseded. Clearing the phase is
 * what makes a LATER stuck command ("stop", "screenshot") report honestly that
 * play was not booting rather than blaming the last phase of a boot that
 * finished minutes ago.
 */
export function endPlayBoot(now: number = Date.now()): void {
  publish({ phase: null, at: now, run: _state.run });
}

/**
 * Announce main-thread work that is NOT a play boot — a model document about
 * to run a module's `build()` — so a command that times out while the page is
 * inside it is refused by name ("the page is still inside building
 * src/models/mushroom.ts") instead of "never answered". A blind session on a
 * swapped box read the generic refusal as its own module hanging and bisected
 * a parameter for five minutes (2026-09-06). Returns the end call; nested
 * work is not tracked — the latest announcement stands until it ends.
 */
export function beginPageWork(label: `building ${string}`, now: number = Date.now()): () => void {
  publish({ phase: label, at: now, run: _state.run });
  return () => {
    if (_state.phase === label) publish({ phase: null, at: Date.now(), run: _state.run });
  };
}

export function currentPlayBootPhase(): PlayBootPhaseState {
  return _state;
}

/** Test-only reset — drops the latch and the reporter. */
export function __resetPlayBootPhaseForTest(): void {
  _state = { phase: null, at: 0, run: 0 };
  _report = null;
}
