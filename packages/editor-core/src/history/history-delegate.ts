/**
 * THERE IS ONE UNDO STACK AND IT IS VS CODE'S `IUndoRedoService`
 * (ARCHITECTURE-CORE §The core is Code-OSS, "there is one Cmd+Z").
 *
 * Two directions cross this module:
 *
 * 1. **OUT** — every committed transaction is offered as an ELEMENT
 *    ({@link emitHistoryElement}), keyed on the document's own file, and the
 *    frame pushes it as an `IResourceUndoRedoElement` (or an
 *    `IWorkspaceUndoRedoElement` when it spans several). That is the one-stack
 *    property: a drag on `MainScene.tsx` and a keystroke in `MainScene.tsx`'s
 *    text editor undo in order from one list. Elements are recorded even
 *    before the delegate arrives, so a frame that mounts after the editor's
 *    first edits pushes what it missed, in order, rather than starting with a
 *    stack missing its beginning.
 *
 * 2. **IN** — the DELEGATE, the frame's own undo, because the editor has undo
 *    affordances that are not the keyboard: its Edit menu's "Undo <label>",
 *    the palette, `vgai eval`'s undo verb. Every one of them must reach the
 *    ONE stack. Without it the Edit menu still names the step (the label comes
 *    from the last recorded entry) while the click refuses, which is worse
 *    than no menu item at all.
 *
 * `history-service.ts` is the RECORDER: it still stages, applies and can
 * revert ONE entry by id, and it no longer decides which entry is next.
 */
/** One recorded edit, as the owner of undo sees it. */
export interface HistoryElement {
  /** The transaction's id — stable, and what {@link HistoryElement.undo}
   *  addresses back in the service. */
  readonly id: string;
  /** User-presentable, already trimmed ("Transform Selection"). */
  readonly label: string;
  /**
   * The project-relative files this edit changed, in the order the
   * transaction declared them. EMPTY for a session-scoped edit (a live
   * journal), which is a fact the frame must decide about rather than a
   * default it may paper over.
   */
  readonly resources: readonly string[];
  /**
   * THE WORKSPACE DOCUMENT THIS EDIT WAS MADE IN, at the moment it was
   * recorded — the id, or null when nothing was active.
   *
   * MEASURED, and the reason it exists (2026-09-19, the game template in the
   * frame): a three root's document is NOT one file. Its adapter's own source
   * path is the root entry `src/world.tsx`, while a gizmo drag on the scene's
   * HeroBox instance writes `src/scenes/MainScene.tsx` — so "the document's
   * resource" is a SET that grows with what the person edits, and asking the
   * undo service about the entry file alone would find nothing to undo. The
   * document id is the stable thing; WHICH FILE its next undo acts on is the
   * newest element recorded in it, and this is what lets the frame ask that.
   *
   * It is also what keeps the stacks apart: a component view's elements carry
   * that view's own document id, so a ⌘Z there can never reach the main
   * scene's — which is the whole of "Component-view Ctrl+Z acts on the MAIN
   * scene's history".
   */
  readonly document: string | null;
  /** Revert this one entry. `false` when the service refused (conflict,
   *  expired resource, blocked history) — never a silent no-op. */
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
}

/**
 * WHAT THE FRAME DOES WHEN THE EDITOR'S OWN UNDO IS ASKED FOR.
 *
 * The keyboard door has `invoke` (frame → editor); this is the other
 * direction, and it exists because the editor has undo AFFORDANCES that are
 * not the keyboard: its Edit menu's "Undo <label>", the command palette, and
 * `vgai eval`'s undo verb all call the same `edit.undo` action. Under the
 * frame that action must reach the ONE stack, not walk a cursor nobody is
 * driving — so the frame installs its own undo here and every one of those
 * affordances keeps working, unchanged, against VS Code's service.
 *
 * MEASURED (2026-09-19, the game template in the frame): without this the Edit
 * menu still read "Undo Set position" — the label comes from the last recorded
 * entry — while the click refused. A menu that names the step it will not take
 * is worse than one that is absent.
 */
export interface HistoryDelegate {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

let delegate: HistoryDelegate | null = null;
/** Who can say which document is active. The host door installs it (that is
 *  the module that already reads the workspace registry); without one every
 *  element is honestly document-less rather than wrongly attributed. */
let documentResolver: (() => string | null) | null = null;
const ownerListeners = new Set<() => void>();
const elementListeners = new Set<(element: HistoryElement) => void>();
/** Everything recorded while a delegate was installed, so a LATE subscriber
 *  (the bridge mounts after the editor's first edits are possible) can catch
 *  up rather than start with a stack that is missing its beginning. */
let recorded: HistoryElement[] = [];

/**
 * Is the delegate installed? False until it lands — later than the mount,
 * because a `ServicesAccessor` is valid only for a command's synchronous part,
 * so the contribution hands the delegate over after the editor is running.
 * Until then the editor's own cursor answers, which is a real undo with
 * nowhere else to go rather than a refusal.
 */
export function historyDelegateInstalled(): boolean {
  return delegate !== null;
}

/**
 * Install the undo stack every gesture records into, or `null` to withdraw it
 * — the stack is the workbench's, and a workbench that went away takes it (and
 * the catch-up buffer of elements recorded for it) with it.
 */
export function setHistoryDelegate(next: HistoryDelegate | null): void {
  if (delegate === next) return;
  delegate = next;
  if (!delegate) recorded = [];
  for (const listener of ownerListeners) listener();
}

/** The installed delegate, or `null` before it lands. */
export function historyDelegate(): HistoryDelegate | null {
  return delegate;
}

export function subscribeHistoryDelegate(listener: () => void): () => void {
  ownerListeners.add(listener);
  return () => ownerListeners.delete(listener);
}

/**
 * Offer one committed transaction to the frame. Recorded even before the
 * delegate arrives — that buffer is what lets a frame that mounts after the
 * editor's first edits push what it missed, in order, rather than start with a
 * stack missing its beginning.
 */
export function emitHistoryElement(element: Omit<HistoryElement, 'document'>): void {
  const stamped: HistoryElement = { ...element, document: documentResolver?.() ?? null };
  recorded.push(stamped);
  for (const listener of elementListeners) listener(stamped);
}

/** Install the reader of "which document is active". Called once by the host
 *  door at boot; passing null removes it (tests). */
export function setHistoryDocumentResolver(next: (() => string | null) | null): void {
  documentResolver = next;
}

/**
 * Every element recorded so far under frame ownership. The frame reads this
 * once when it subscribes and pushes what it missed, in order.
 */
export function recordedHistoryElements(): readonly HistoryElement[] {
  return recorded;
}

export function onHistoryElement(listener: (element: HistoryElement) => void): () => void {
  elementListeners.add(listener);
  return () => elementListeners.delete(listener);
}
