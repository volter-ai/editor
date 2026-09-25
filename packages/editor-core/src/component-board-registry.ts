/**
 * A COMPONENT BOARD IS REGISTERED — the sixth registry in the family of
 * `workspace-document-restore.ts` (a kind owns its persisted state),
 * `document-open-registry.ts` (a kind owns how it opens),
 * `chrome-slot-registry.ts` (the host owns the place, a package owns what sits
 * there), `content-entry-source-registry.ts` (the host owns the Content scope,
 * a package owns why a component is content) and
 * `authoring/design-time-mount-registry.ts` (the host owns the layer stack, a
 * package owns how a medium mounts). Here: the host owns WHERE a project's
 * component boards sit in the workspace — installing one, closing one,
 * answering why one is absent — and a package owns WHICH medium it is a board
 * of, whether this project has one, and what goes in it.
 *
 * WHY IT EXISTS. `components/world-documents.tsx` held a literal table of
 * three media with an installer each (`COMPONENT_BOARDS`), reconciled against
 * `getStoryMediaPresence()`, plus two absence thunks gated on
 * `projectStoriesReady()`. Three statements about CSF, made in the host: that
 * a project's boards are `dom`/`three`/`canvas`; that a board exists because
 * the project has stories of that medium; and that "no board yet" and "no
 * board ever" are told apart by a story-DISCOVERY flag. The host does not
 * author portable CSF and must not know any of it (WORK.md §The open-source
 * launch item 18a).
 *
 * THE SHAPE is transcribed from `content-entry-source-registry.ts:80-149`:
 * register / list / subscribe with the owner-replaces-owner rule, and the
 * registry RE-FANS each board's own `subscribe` into one signal, because the
 * host's single reconciler must re-read when any board's verdict moves and
 * which board moved is never its question (`:89-91`, `:122`). Three
 * deliberate differences from `design-time-mount-registry.ts`, the sibling
 * this door most resembles, each with its reason:
 *
 *  - NO VERSION COUNTER, for that registry's reason: the only reader is
 *    `installRootDocuments`, which subscribes and re-reads. A counter with no
 *    caller is a name that got built because it was named.
 *  - PRESENCE IS RE-FANNED, where a design-time mount's staleness deliberately
 *    is not. The distinction is the one that registry's own note draws: a
 *    staleness signal must reach the ONE stack that mounted that medium
 *    carrying which action to take, while board presence is a registration-wide
 *    fact the single reconciler acts on uniformly.
 *  - NO `remountWhen`, AND THAT IS A MEASUREMENT. The membership rule this door
 *    was specified to absorb (a story added or deleted while a board is
 *    mounted must put the new frame on screen without F5) is a statement about
 *    a MEDIUM's mounted layers, which is exactly `DesignTimeMount.remountWhen`
 *    / `reprojectWhen` — already bound per medium by `mountDesignTimeLayers`
 *    (`design-time-layers.ts:717-742`) and already carrying this lane's two
 *    other staleness rules. A second hook here would fire on a board whose
 *    layers are not stories at all: the rule lived in `RootDocumentContent`,
 *    which mounts the dom board AND the canvas Scene, so a canvas world was
 *    being torn down and rebuilt every time an unrelated dom story was saved.
 *    It travels with the dom mount instead.
 *
 * PRESENCE IS TRI-STATE, and the third state is the whole point. `null` means
 * "cannot answer yet" — a board whose census has not run. The host used to
 * spell that condition itself as `projectStoriesReady()`, so it knew that a
 * board waits on story discovery; now it knows only that a registration may
 * not have a verdict, which is the same thing a document opener's `ready` and
 * a design-time mount's late registration already say. An absence is spoken
 * only when the owner has a verdict.
 *
 * NOTHING REGISTERED IS A REAL ANSWER. A build whose package list carries no
 * board installs none and says so through the generic "no workspace document
 * is named …" — the same honest emptiness a document kind with no registered
 * opener gives.
 */

import type { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import type { EditorShellStore } from './editor-shell-store';

/** Everything a board reads from the HOST at install, and deliberately
 *  nothing more — measured against the three installers as they stood:
 *  `installThreeBoardDocument` and `installCanvasBoardDocument` read the shell
 *  store alone; the UI board additionally reads the session's composite,
 *  because it is a document OF a root and carries that root's provenance. */
export interface ComponentBoardContext {
  /** The ONE format-neutral shell store the session's documents are opened
   *  against. */
  readonly store: EditorShellStore;
  /** The live session's composite authoring adapter — the roots this project
   *  actually mounted, for a board that is also a root's document. */
  readonly composite: CompositeAuthoringAdapter;
}

export interface ComponentBoard {
  /**
   * The medium this is the board of, in the registering package's own
   * vocabulary. The host never spells one: it compares this against a
   * design-time root descriptor's `kind` to decide whether that root's
   * document IS this board, and otherwise only passes it back.
   */
  readonly medium: string;
  /** Which module registered it. Re-registering the same owner+medium
   *  REPLACES, so an HMR re-evaluation leaves one board, not two. */
  readonly owner: string;
  /** The workspace document id this board installs under. The host closes by
   *  it and answers "why is this id absent" from it. */
  readonly documentId: string;
  /** How the board is named to a human, for the host's own absence prose
   *  ("this project has no <title> board"). */
  readonly title: string;
  /**
   * Does this project have this board? `'present'` installs it, `'absent'`
   * closes it, and `null` is "no verdict yet" — the host neither installs nor
   * speaks an absence, because a census that has not run is not a No.
   */
  readonly presence: () => 'present' | 'absent' | null;
  /** The board's OWN change signal — its census settling, its discovery pass
   *  finishing. The host re-reconciles on it without knowing what moved. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Open this board's workspace document. Called once per transition into
   * `'present'`; the host closes it by {@link documentId}, exactly as it did
   * when the table was a literal. Never activates: a board arrives
   * asynchronously and must not yank the author off what they were looking at.
   *
   * MAY BE ASYNCHRONOUS — a board whose renderer costs a whole substrate
   * (the 2D board initializes Pixi) loads its implementation only for a
   * project that has one. A rejected promise or a throw un-reserves the id
   * here, so the next verdict retries; saying WHAT failed is the board's own
   * job, because only it knows what it was loading.
   */
  readonly install: (context: ComponentBoardContext) => void | Promise<void>;
  /**
   * Why THIS project has no board of this medium, and what would make one
   * appear — the fix text, in the lane's own vocabulary. Read only while
   * {@link presence} says `'absent'`.
   */
  readonly absentReason: () => string;
}

const _boards: ComponentBoard[] = [];
const listeners = new Set<() => void>();
/** Live teardowns for the per-board presence subscriptions the registry
 *  re-fans (`content-entry-source-registry.ts:102`). */
const boardSubscriptions = new Map<ComponentBoard, () => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Install a board. Returns the teardown. */
export function registerComponentBoard(board: ComponentBoard): () => void {
  const stale = _boards.findIndex(
    (item) => item.owner === board.owner && item.medium === board.medium,
  );
  if (stale >= 0) {
    const [removed] = _boards.splice(stale, 1);
    if (removed) {
      boardSubscriptions.get(removed)?.();
      boardSubscriptions.delete(removed);
    }
  }
  _boards.push(board);
  boardSubscriptions.set(board, board.subscribe(publish));
  publish();
  return () => {
    const at = _boards.indexOf(board);
    if (at < 0) return;
    _boards.splice(at, 1);
    boardSubscriptions.get(board)?.();
    boardSubscriptions.delete(board);
    publish();
  };
}

const EMPTY: readonly ComponentBoard[] = [];

/** Everything registered, in registration order. A stable array while nothing
 *  changes, so a reader can compare identities across a notification. */
export function componentBoards(): readonly ComponentBoard[] {
  return _boards.length === 0 ? EMPTY : _boards;
}

/** The board of one medium, or `null` — "no package registered one", which is
 *  a real answer and never an error. The LAST registration wins, the same way
 *  a later design-time mount of the same kind does. */
export function componentBoardForMedium(medium: string): ComponentBoard | null {
  for (let i = _boards.length - 1; i >= 0; i--) {
    const board = _boards[i];
    if (board && board.medium === medium) return board;
  }
  return null;
}

/** The board installed under a workspace document id, or `null`. */
export function componentBoardForDocument(documentId: string): ComponentBoard | null {
  return _boards.find((board) => board.documentId === documentId) ?? null;
}

/** ONE subscription for the reconciler: the registry's own changes AND every
 *  registered board's presence signal. What changed is never its question. */
export function subscribeComponentBoards(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset (mirrors the restore, open, chrome-slot, content-source and
 *  design-time-mount registries'). */
export function __resetComponentBoardsForTest(): void {
  for (const stop of boardSubscriptions.values()) stop();
  boardSubscriptions.clear();
  _boards.length = 0;
  publish();
}
