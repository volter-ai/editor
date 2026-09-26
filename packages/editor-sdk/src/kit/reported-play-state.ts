/**
 * Honest play-state reporting for the control API (`vgai status`) — the
 * derivation half of the SimCity ledger's S-1 "false-alive ingest status".
 *
 * ## The defect this closes
 *
 * `EditorShellStore.playState` is EDITOR UI STATE. Every lane that mounts
 * something writes `'playing'` into it, but only play mode's write is
 * accompanied by a live `play-mode.ts` `_session`, which is the predicate the
 * whole debug seam gates on (`isPlayModeActive()`, `command-listener.ts`'s
 * `notPlayingResult`). `collectState` reported the store flag verbatim, so a
 * mounted lane printed `playState: "playing"` while every `game.state()` /
 * `game.command()` call refused with "not in play mode" — the two predicates
 * disagreeing in the same breath.
 *
 * Worse, a lane sets `'playing'` BEFORE the mount is attempted (it is what
 * swaps the viewport onto the live scene). A mount that then threw left the
 * flag behind, so a DEAD game reported itself alive.
 *
 * ## The rule
 *
 * A reported play state is a claim about something that is actually running,
 * so it is derived from the LIVE-SESSION REGISTRY (`live-session-registry.ts`)
 * — the host's one question about what runs — never from the UI flag alone,
 * and it names no lane:
 *
 *  - nothing mounted is `stopped`, whatever the stale flag says;
 *  - a mount whose lane was not asked to run is `paused` — a freshly mounted,
 *    still-cold session is `paused`, not `playing`;
 *  - otherwise the store flag, which for a running lane is written in lockstep.
 *
 * Pure and injectable so the whole decision is unit-testable with no browser
 * (`packages/editor/test/ingest-status.test.ts`).
 *
 * ## Why this is not folded back into the store's getter
 *
 * Because the two answer different questions, and the store's is the one the
 * editor itself needs. `isPlayModeActive()` is `_instance.session !== null`,
 * assigned only after the mount resolves — so a derived `store.playState` would
 * read `'stopped'` for the whole play boot (manifest fetch, entry resolution,
 * the mount itself), and the structural-edit block, the design session's
 * suspend, the Play bar and the viewport-tab predicates would all act as though
 * nothing were starting. The store's flag stays the editor's MODE; this stays
 * the report.
 */

import type { MountFailureReport } from '@volter/editor-sdk/kit/mount-failure-report';

/** The vocabulary `EditorShellStore.playState` and the SDK's status both use. */
export type ReportedPlayState = 'stopped' | 'playing' | 'paused';

/** Everything the derivation reads. Assembled by the caller from the live
 *  module singletons so this module itself imports no session state. */
export interface LiveSurfaceFacts {
  /** `EditorShellStore.playState` — the UI flag, used only where it is backed. */
  readonly storePlayState: ReportedPlayState;
  /** `live-session-registry.ts`: some lane owns a canvas right now. */
  readonly liveMounted: boolean;
  /** `live-session-registry.ts`: some lane was asked to RUN content. */
  readonly livePlaying: boolean;
  /** Recorded mount failures (`authoring/mount-failure-report.ts`). */
  readonly mountFailures: readonly MountFailureReport[];
}

/**
 * The reported play state — derived from what is actually running, asked of
 * the live-session registry so no lane is named: a held mount (a mounted game
 * whose loop is stopped) is `paused`; a running one reports the store's
 * playing/paused; nothing mounted is `stopped` whatever the store says.
 */
export function deriveReportedPlayState(facts: LiveSurfaceFacts): ReportedPlayState {
  if (!facts.liveMounted) {
    // Nothing is running. A leftover `'playing'`/`'paused'` here is exactly
    // the false-alive report S-1 is about — a mount that threw after setting
    // the flag.
    return 'stopped';
  }
  if (!facts.livePlaying) return 'paused';
  return facts.storePlayState === 'paused' ? 'paused' : 'playing';
}

/**
 * True when the editor is reporting a world that FAILED to mount and has no
 * live session to replace it. Consumers surface this as the "dead game" signal
 * (`vgai status`'s `mountFailures`, the status bar's mount-failure item)
 * rather than making a reader diff two other fields to notice.
 */
export function hasDeadMount(facts: LiveSurfaceFacts): boolean {
  return facts.mountFailures.length > 0 && !facts.liveMounted;
}
