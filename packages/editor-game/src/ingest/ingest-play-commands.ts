/**
 * Relay play-control dispatch for an INGEST session — the SimCity ledger's S-2
 * ("`vgai play` destroys a working source-mount").
 *
 * ## The defect
 *
 * `command-listener.ts`'s `play`/`stop`/`pause`/`resume`/`step` cases called
 * straight into `play-mode.ts`, which is the FIRST-PARTY runtime boot. That
 * boot mounts the manifest's roots into `getGameContainer()` — the same element
 * an ingest mount already occupies — and a captured ingest is not a
 * host-mounted `RootAdapter`. Play
 * therefore always failed on an ingest project and ran `exitPlayMode()` in its
 * own catch, which unconditionally reset the systems slot, popped the adopted
 * scene, restored the pre-ingest authoring adapter, cleared the game input gate
 * and set `playState: 'stopped'` — tearing the live mount's editor-side
 * ownership out from under it, with no remount.
 *
 * The editor's own Play button never had this problem: `components/PlayBar.tsx`
 * early-returns an entirely separate ingest toolbar wired to
 * `getIngestPlayControl()`. The relay was the one play surface that did not
 * branch, which is exactly why the defect only ever showed up through the CLI.
 *
 * ## Why a separate module
 *
 * So the dispatch is a pure function over the control surface, testable with a
 * stub and no editor/browser at all (`packages/editor/test/ingest-play-commands.test.ts`).
 */

import {
  type CommandResult,
  type IngestPlayCommandType,
  isIngestPlayCommandType,
} from '@volter/editor-sdk/session/command-table';

/** The shape {@link handleIngestPlayControl} needs — structurally satisfied by
 *  `ingest/ingest-play-control.ts`'s `IngestPlayControl`, named locally so this module imports
 *  no session state. */
export interface IngestPlaySurface {
  readonly playing: boolean;
  play(): void;
  pause(): void;
  resume(): void;
  readonly canStep: boolean;
  step(): void;
}

/**
 * Dispatch one relay play-control command to the live ingest session, or return
 * `null` when this command is not a play control (the caller then runs its
 * ordinary switch).
 *
 * `stop` maps to PAUSE by default, deliberately. An ingest session's mount is
 * the editor's open document, not a play session — there is no "stop" that
 * could unmount it and leave the editor in a sensible state, and destroying the
 * mount is the very defect this module exists to fix. Halting the game's loop
 * is what "stop the game" can honestly mean here, and it is what the editor's
 * own ingest toolbar offers.
 *
 * `stopEndsRun` inverts exactly that premise, and nothing else. A root that
 * declares its own world component mounts the GAME only when Play starts
 * (`deferred-ingest-play.ts`), so its mount is a play run rather than the open
 * document: ⏹ genuinely ends it and the editor returns to the design-time
 * Scene. This dispatch then declines `stop` (returns `null`) so the caller's
 * ordinary `exitPlayMode()` runs. ▶/⏸/step still belong here either way —
 * they drive the ingested game's OWN loop, which no first-party session owns.
 *
 * `step` REFUSES when the mount cannot honestly step (`canStep` is false
 * whenever no serve-time loop gate measured control over this game's frames) —
 * a silent no-op would be a fabricated ack.
 */
/**
 * One handler per claimed verb, keyed by the command table's own play-control
 * subset. A `Record` rather than a switch on purpose: adding a play verb to
 * `command-table.ts` makes this object stop compiling until it has a handler,
 * which a switch would not, and the vocabulary is then read from ONE place
 * instead of being spelled again here.
 *
 * `null` means "not mine" — the caller runs its ordinary dispatch.
 */
type IngestPlayOutcome =
  /** Driven; the caller gets the standard `{ ingest: true, playing }` ack. */
  | 'driven'
  /** Not this lane's after all; the caller runs its ordinary dispatch. */
  | 'declined'
  /** A refusal with its own reason. */
  | CommandResult;

const INGEST_PLAY_HANDLERS: Record<
  IngestPlayCommandType,
  (ingest: IngestPlaySurface, opts?: { readonly stopEndsRun?: boolean }) => IngestPlayOutcome
> = {
  play: (ingest) => {
    ingest.play();
    return 'driven';
  },
  resume: (ingest) => {
    ingest.resume();
    return 'driven';
  },
  stop: (ingest, opts) => {
    if (opts?.stopEndsRun) return 'declined';
    ingest.pause();
    return 'driven';
  },
  pause: (ingest) => {
    ingest.pause();
    return 'driven';
  },
  step: (ingest) => {
    if (!ingest.canStep) {
      return {
        ok: false,
        error:
          'this ingested game cannot be stepped — no serve-time loop gate measured control ' +
          'over its frames, so a single-frame step would be a button that lies (see ' +
          'ingest/same-realm-loop-gate.ts)',
      };
    }
    ingest.step();
    return 'driven';
  },
};

export function handleIngestPlayControl(
  ingest: IngestPlaySurface,
  type: string,
  opts?: { readonly stopEndsRun?: boolean },
): CommandResult | null {
  if (!isIngestPlayCommandType(type)) return null;
  const outcome = INGEST_PLAY_HANDLERS[type](ingest, opts);
  if (outcome === 'declined') return null;
  if (outcome !== 'driven') return outcome;
  return { ok: true, data: { ingest: true, playing: ingest.playing } };
}
