/**
 * THE single live-ingest slot: the shape of a mounted `{ ingest }` root's
 * session, the one module-level variable holding it, and the queue that keeps
 * entry to it serial.
 *
 * This module deliberately holds STATE and nothing else — no mounting, no
 * teardown, no measurement. `mount-three-ingest-root.ts` /
 * `mount-canvas-ingest-root.ts` / `mount-dom-ingest-root.ts` publish into the
 * slot, `unmount-ingest-root.ts` empties it, and everything that merely READS a
 * live session (`ingest-play-control.ts`, `mount-coverage.ts`,
 * `live-ingest-facet.ts`) imports from here. Keeping the slot a leaf is what
 * makes that whole graph acyclic.
 */

import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import type { MeasuredLoop } from '../host/same-realm-loop-gate';
import type { DomAuthoringAdapter } from '../react/dom-authoring-adapter';
import type { AuthoringAdapter } from '@volter/editor-project/adapter/authoring';
import type { IngestMount } from './authoring/ingest-root-adapter';
import type { SiblingMount } from './ingest-siblings';
import type { MountCoverageInputs } from './mount-coverage';

/**
 * The ONE lifecycle control the editor consumes for an ingested game.
 *
 * Mount code resolves the game's raw contract and the substrate's fallback
 * into this shape once. Consumers never choose between those mechanisms:
 * `start` owns the cold -> started edge, while `setPaused` is present only
 * when one complete pause/resume mechanism exists. A missing capability keeps
 * its exact reason on `pauseGap` so Edit can refuse loudly rather than treating
 * a fabricated no-op function as a successful hold.
 */
export interface IngestLifecycleControl {
  readonly start: () => void;
  readonly setPaused?: ((paused: boolean) => void) | undefined;
  readonly pauseGap?: string | undefined;
  readonly step?: (() => void) | undefined;
  readonly canStep?: (() => boolean) | undefined;
}

export interface IngestSession {
  store: EditorShellStore;
  lifecycle: IngestLifecycleControl;
  /** The capture path (a real authoring adapter over the live scene). */
  mount?: IngestMount;
  /** Keeps the captured game renderer sized to its container (host lifecycle). */
  resizeObserver?: ResizeObserver;
  /** Drops the store subscription that releases a game-held pointer lock when
   *  the input gate closes (`ingest/game-pointer-lock.ts`). */
  inputGateUnsubscribe?: () => void;
}

export interface IngestSession2D {
  store: EditorShellStore;
  lifecycle: IngestLifecycleControl;
  adapter?: AuthoringAdapter & { dispose(): void };
  /** The realm host box the game appended into — Scene reparents this. */
  hostEl?: HTMLElement;
  /** Measured loop truth for a reachable canvas realm — a verdict CARRIES the
   *  evidence it was concluded from ({@link MeasuredLoop}). `null` when the
   *  probe ran but learned nothing (`reason` says what it looked at) — never a
   *  verdict forced out of an absence of evidence. */
  loop?: () => { loop: MeasuredLoop | null; reason: string };
  dispose: () => void;
}

export interface IngestSessionReact {
  store: EditorShellStore;
  lifecycle: IngestLifecycleControl;
  stop: () => void;
  /** Live DOM-authoring adapter; owns a session history resource. */
  adapter: DomAuthoringAdapter;
}

/**
 * The world kind of the currently-active ingest session, if any (F26):
 * ingest is an ADAPTER ROUTE, not a kind of its own — D-V1
 * collapsed the three per-kind session slots this used to fixed-priority-scan
 * (`_session` / `_session2D` / `_sessionReact`) into the single `_active` slot
 * below, so at most one session is ever active, of any kind, and
 * {@link activeIngestKind} is just that slot's tag. The play surface
 * ({@link import('./ingest-play-control').getIngestPlayControl}) and
 * {@link isIngestActive} read it, never a slot directly.
 */
export type IngestKind = 'three' | 'canvas' | 'dom';

/**
 * F26 slot collapse (D-V1): at most one ingest session is EVER active, of
 * any kind — {@link activeIngest} is the single module-level slot for it.
 * Pre-collapse, this was three independent per-kind singletons
 * (`_session`/`_session2D`/`_sessionReact`, one per `IngestSession*` shape
 * above), each with its own entry guard that only tore down its OWN slot —
 * so switching kinds leaked the prior kind's live session (the F26
 * residual).
 *
 * `siblings` (D-V2, composite): a composite manifest's OTHER roots, mounted
 * beside this session's ingest world (`ingest-siblings.ts`'s
 * `mountIngestSiblings`) — always `[]` for every non-composite entry path
 * (the in-tree fixture glob route, a single-world manifest).
 * `unmount-ingest-root.ts`'s `exitActiveIngest` disposes these, reverse order,
 * in EVERY kind's teardown path — a sibling never outlives the session it was
 * mounted beside.
 */
export type ActiveIngest = (
  | { kind: 'three'; session: IngestSession }
  | { kind: 'canvas'; session: IngestSession2D }
  | { kind: 'dom'; session: IngestSessionReact }
) & {
  siblings: SiblingMount[];
  /** The mounted world's id — the SAME id every log line and the
   *  `__vgaiIngest` hook's `gameId` names. Carried on the slot (rather than
   *  re-derived) so the status facet can report WHICH world is live
   *  without a second source of truth (S-1). */
  worldId: string;
  /** The coverage inputs that can only be read AT MOUNT (see
   *  {@link MountCoverageInputs}). Absent until a mount path records them, and
   *  absent is honestly "not measured" — never a clean bill of health. */
  coverage?: MountCoverageInputs;
};

let _active: ActiveIngest | null = null;

/** The live session, or `null`. Read it; never cache it across an await. */
export function activeIngest(): ActiveIngest | null {
  return _active;
}

/** THE one write to the slot. Publishing happens only after a mount SUCCEEDS,
 *  which is what makes a non-null slot the mount evidence itself (S-1). */
export function setActiveIngest(next: ActiveIngest | null): void {
  _active = next;
}

export function activeIngestKind(): IngestKind | null {
  return _active?.kind ?? null;
}

/** True if an unmodified game is currently ingested — ANY kind (F26). */
export function isIngestActive(): boolean {
  return activeIngestKind() !== null;
}

/** True if an unmodified PixiJS game is currently ingested. */
export function isIngestActive2D(): boolean {
  return _active?.kind === 'canvas';
}

/** True if an ingested native-React game is currently mounted. */
export function isIngestActiveReact(): boolean {
  return _active?.kind === 'dom';
}

/**
 * D-V2: attach a composite's sibling handles onto the JUST-published session
 * (set by the primary ingest world's own mount call, immediately before this
 * runs) — a no-op if the slot is somehow no longer set (defensive only;
 * nothing in that synchronous call chain clears it between the primary mount
 * and this attach).
 */
export function attachIngestSiblings(siblings: readonly SiblingMount[]): void {
  if (_active) _active.siblings = [...siblings];
}

/**
 * Serializes ingest ENTRY, exactly as `play-mode.ts`'s `_enterQueue` does for
 * play — and for the same reason it had to.
 *
 * Every entry point opens with a synchronous `exitActiveIngest()`, which reads
 * the slot. But the slot is not assigned until AFTER the mount's awaits
 * resolve. Two overlapping calls therefore both observe an empty slot,
 * both tear down nothing, and both mount — leaving two live sessions. That is
 * the react-rpg double mount: two React roots, two `<div id="window">`, two
 * "Story Mode" buttons, intermittently, because it is a race rather than a
 * code path. Nothing kind-specific about it; every entry point shares the
 * shape, react merely had the test that caught it.
 *
 * Queued, the second caller's `exitActiveIngest()` runs after the first has
 * published the slot, so it disposes it and exactly one session stays live.
 * Pinned by `ingest-root-entry-race.test.ts`.
 */
let _enterQueue: Promise<void> = Promise.resolve();

export function serializeEntry<T>(run: () => Promise<T>): Promise<T> {
  const result = _enterQueue.then(run);
  // Advance unconditionally so one caller's rejection can never wedge every
  // subsequent ingest attempt — each caller still observes its OWN failure
  // through the promise returned here (same contract as play-mode's queue).
  _enterQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

import { registerLiveSession } from '@volter/editor-sdk/kit/live-session-registry';
// THE INGEST LANE, as the host sees it (`live-session-registry.ts`). Playing
// is the host play-control latch, never an inferred loop
// (`editor-session-mode.ts` records why); a deferred-ingest play counts.
import { activeContractScenes } from './active-scene-navigation';
import { deferredIngestPlayActive } from './deferred-ingest-session';
import { armIngestFrameSnapshot, ingestFrameCanvas } from './ingest-frame-snapshot';
import { handleIngestPlayControl } from './ingest-play-commands';
import { getIngestPlayControl, ingestPlaying } from './ingest-play-control';
// `mount-coverage.ts` imports this module back, so the pair is a CYCLE — and
// the lane's report is read through it directly rather than pushed in by a
// setter. A setter is what a cycle cannot survive: `mount-coverage`'s
// module-scope `setIngestCoverageSource(...)` ran while this module's own body
// was still in its `let`'s temporal dead zone whenever the graph happened to
// evaluate this file first, and the editor failed to start with "Cannot access
// 'coverageSource' before initialization" (measured on `bunnymark`,
// 2026-09-17, when an import-sort reshuffle changed which file the graph
// reached first). `ingestCoverageReport` is a FUNCTION DECLARATION: ESM
// initializes it at instantiation, before any body runs, so reading it across
// the cycle is order-independent by construction.
import { ingestCoverageReport } from './mount-coverage';
import { exitActiveIngest } from './unmount-ingest-root';

registerLiveSession({
  id: 'ingest',
  priority: 1,
  mounted: isIngestActive,
  playing: () => ingestPlaying() || deferredIngestPlayActive(),
  stop: exitActiveIngest,
  instanceContainer: () => null,
  frameCanvas: ingestFrameCanvas,
  snapshotFrame: () => armIngestFrameSnapshot(),
  // S-2 (the SimCity ledger): an ingest session OWNS its mount, and the
  // first-party play boot cannot share it — `play`/`stop`/`pause`/`resume`/
  // `step` drive the ingested game's own loop (`ingest-play-commands.ts`).
  command: (cmd) => {
    const control = isIngestActive() ? getIngestPlayControl() : null;
    return control
      ? handleIngestPlayControl(control, cmd.type, { stopEndsRun: deferredIngestPlayActive() })
      : null;
  },
  scenes: activeContractScenes,
  surface: activeIngestKind,
  coverage: ingestCoverageReport,
  // An ingested native-React game renders as a DOM layer under the host
  // React — no scene graph, no renderer to introspect — and authoring is
  // deliberately off for react ingests (the editor never writes JSX back into
  // an unmodified game). The game is hosted, sized and disposed; play it in
  // the Game tab.
  authoringRefusal: () =>
    _active?.kind === 'dom'
      ? 'This is an ingested native-React game: its components render directly as a DOM layer ' +
        'under the host React — there is no scene graph or renderer to introspect, and authoring ' +
        'is deliberately off for react ingests (the editor never writes JSX back into an ' +
        'unmodified game). The game is hosted, sized, and disposed; play it in the Game tab.'
      : null,
});
