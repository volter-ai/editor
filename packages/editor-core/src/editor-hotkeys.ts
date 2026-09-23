import { collectAllNodeIds } from './authoring/active-adapter';
import {
  copyAuthoringNodes,
  cutAuthoringNodes,
  duplicateAuthoringNode,
  duplicateManyAuthoringNodes,
  groupAuthoringNodes,
  pasteAuthoringNodes,
  removeAuthoringNode,
  removeManyAuthoringNodes,
  setAuthoringSelection,
  unwrapAuthoringNode,
  wrapAuthoringNode,
} from './authoring/consumer-actions';
import { resolvePanelAuthoring } from './authoring/panel-authoring';
import {
  currentSelectionScopeId,
  enterSelectedScope,
  exitSelectionScope,
} from './authoring/selection-scope';
import { activeSelectionIds, saveActiveAuthoring } from './authoring/shell-document-ops';
import { resetRootPan } from './authoring/world-pan-state';
import {
  boxEditForId,
  computeArrowNudgePatch,
  readSpacingValues,
  rectForId,
} from './components/world-overlay-gestures';
import { openCommandPalette } from './editor-commands';
import { editorConsole } from './editor-console';
import type { EditorShellStore } from './editor-shell-store';
import type { EditorViewport } from './editor-viewport';
import type { HistoryCommands } from './history/history-commands';
import {
  allowsAppUndoWhileEditable,
  getActiveScope,
  type HotkeyBinding,
  installHotkeys,
  isEditableTarget,
  registerHotkeys,
  setActiveScope,
} from './hotkeys';
import { type KeyActionScope, registerKeyAction } from './key-actions';
import {
  type EditorKeyActionId,
  keyChordsFor,
  shortcutFor,
  subscribeEditorKeymap,
} from './keymap-presets';
import { stopAllLiveSessions } from './live-session-registry';
import { requestTransformMode } from './transform-mode-request';
import { showTransientHint } from './transient-hint';
import { saveActiveWorkspaceDocument } from './workspace-document-registry';
import { toggleWorkspaceFocus } from './workspace-host-commands';
import { cycleEditorWorkspace } from './workspace-presets';
import { toggleConsoleUtility } from './workspace-utility-commands';

// 'inspector' belongs here: the inspector shows the SELECTED NODE, so a user
// who just edited a field expects node-scoped clipboard/duplicate to still
// answer (a human pressed Ctrl+D after typing a color and read the silence as
// "duplicate is broken" — runhuman pass 41). Focused text inputs stay safe:
// isEditableTarget refuses there, and clipboard keys keep their native-DOM
// `when` guard.
const AUTHORING_SELECTION_SCOPES = ['viewport', 'hierarchy', 'inspector'] as const;

/**
 * D4 (spec27 §6 D4, §8 "Keyboard / undo / pan-zoom" row) — RECONCILED by the
 * `overlay-panzoom` unit (D-E's own reconciliation note).
 *
 * Space-pan is BUILT: `RootSelectionOverlay.tsx`'s own Space-held +
 * pointer-drag handling (its `spaceHeldRef`/`panDragRef`), writing the shared
 * `world-pan-state.ts` singleton, which `design-time-layers.ts` applies to
 * every world-layer host IN LOCKSTEP with the overlay's own wrapper — a pure
 * CSS `transform: translate()` on both. Not registered here in
 * `editor-hotkeys.ts`'s `registerHotkeys` array because that registry is a
 * single-fire-per-keydown dispatcher with no "held" concept (see
 * `hotkeys.ts`); Space-pan needs a literal hold state, so it follows the
 * SAME precedent this file's own vertex-snap `V`-key handling below already
 * set (a raw `window` keydown/keyup pair) — just owned by the overlay
 * component instead of this file, since the gesture IS a pointer-drag over
 * the overlay's own interaction layer, not a stateless action like
 * duplicate/delete/nudge above.
 *
 * Zoom-fit/selection is a stated EXCLUDE — evidence checked (not assumed):
 * the 3D viewport (`world-root-stage.ts`/`editor-viewport.ts`) already has a
 * real zoom substrate (Three.js `OrbitControls`, numpad view presets), so
 * zoom-fit there is pure duplication, not a gap. The react/DOM world
 * surface's `RectProvider.rect(id)` is `getBoundingClientRect()`-derived and
 * host-relative (`react-world-authoring-adapter.ts`'s `toHostRelative`) —
 * UNLIKE pan (a pure translation, which cancels out of that subtraction with
 * zero consumer changes, per `world-pan-state.ts`'s own soundness doc
 * comment), a host `scale()` bakes the zoom factor into every rect AND every
 * screen-space gesture delta (`toHostLocal`), so it would require an
 * explicit zoom-aware conversion at all ~14 host-relative chrome consumers
 * (selection/hover box, 8 handles, rotate, labels, spacing bands, measure
 * lines, snap guides, badges, parent outline, drag-ghost, reorder marker,
 * empty-container hints, align-toolbar anchor, marquee) and the 3
 * screen-delta gesture patches (`computeResizePatch`/`computeMovePatch`/
 * `computeSpacingPatch`) — a foundation rebase against the ~2360-test unit
 * suite + the full 27x e2e series (all pinned at the implicit `scale=1`
 * frame) that is disproportionate to one keyboard-row affordance the
 * visual-edit reference itself only had live in its own demo host, not its
 * reusable library. No dead keybinding is registered for it.
 */

// The five action functions below (`duplicateSelection` … `nudgeSelection`)
// are exported for two reasons: `registerEditorShellHotkeys` wires them to
// their keybindings below, AND `editor-hotkeys.test.ts` unit-tests the
// capability-gate behavior (structure/boxEdit absent -> no-op) directly
// against them, without needing a full `EditorViewport`/canvas fixture.

/** Entity clipboard shortcuts yield to ordinary DOM text selection. Editable
 * controls already yield in `hotkeys.ts`; this covers selectable labels/logs
 * inside the hierarchy or viewport scopes. */
export function shouldHandleEditorClipboard(): boolean {
  return (globalThis.getSelection?.()?.toString() ?? '').length === 0;
}

/**
 * THE SUBJECT THESE ACTIONS ACT ON — the ACTIVE DOCUMENT's selection, which is
 * the same place they already take their adapter from.
 *
 * `store.selectedEntityIds` is the SHELL store's set, and for a document whose
 * adapter owns its own selection it is a different set entirely: every one of
 * these functions resolved its adapter through `resolvePanelAuthoring` and then
 * read the ids from the shell, so on such a document they saw an empty
 * selection and returned at the guard — a silent no-op with nothing to report.
 *
 * MEASURED 2026-09-21 on the Blender Model document, whose Outliner adapter
 * publishes its selection in Blender's own row ids: with the Sphere selected
 * and highlighted in the panel, `vgai.edit.delete` ran, found
 * `store.selectedEntityIds` empty and deleted nothing — X and Shift+D were
 * dead for every object on that document. `activeSelectionIds` is what
 * `editor.status()` already reports and what the hierarchy panel already
 * draws, so reading it here makes the three agree instead of two against one.
 */
function actionSelectionIds(store: EditorShellStore): string[] {
  return activeSelectionIds(store);
}

export async function copySelection(store: EditorShellStore): Promise<void> {
  const ids = actionSelectionIds(store);
  if (ids.length === 0) return;
  await copyAuthoringNodes(resolvePanelAuthoring(store).adapter, ids);
}

export async function cutSelection(store: EditorShellStore): Promise<void> {
  const ids = actionSelectionIds(store);
  if (ids.length === 0) return;
  await cutAuthoringNodes(resolvePanelAuthoring(store).adapter, ids);
}

/** Ordinary Paste creates siblings: the current selection's native parent is
 * the destination. With no selection, the adapter's document root is used. */
export async function pasteSelection(store: EditorShellStore): Promise<void> {
  const adapter = resolvePanelAuthoring(store).adapter;
  const selectedId = actionSelectionIds(store)[0];
  const parentId = selectedId ? (adapter.hierarchy.node(selectedId)?.parentId ?? null) : null;
  await pasteAuthoringNodes(adapter, parentId);
}

/**
 * D4 (spec27 §6 D4 "Ctrl+D duplicate, Del/Backspace delete — route through
 * adapter.structure.* (capability-gated)"). `store.selectedEntityIds` is the
 * shared, adapter-routed selection set (every adapter's own `selection.set`
 * funnels into it); the ACTION goes through the active adapter's
 * `StructureProvider`, and is a capability-gated no-op when that adapter has
 * none (e.g. the ingested `react-dom` adapter, spec:308-309).
 *
 * There is no fork here: every adapter is reached the same way, through its
 * `StructureProvider`.
 *
 * Each id's ack is AWAITED before the next fires, exactly as `deleteSelection`
 * awaits `remove`: for a source lane every duplicate in the loop rewrites the
 * SAME file, and two un-awaited writes each read it before either wrote back,
 * so whichever landed second silently loses the first. That is why the id and
 * the ack come back together (`StructuralIdWrite`) — a synchronous id with a
 * `void`ed write would leave this loop nothing to await. Awaiting a lane whose
 * duplicate is in-memory (`ack: undefined`) is a harmless no-op.
 */
/**
 * SERIALIZED ACROSS PRESSES. One invocation already awaits each id's write,
 * but a BURST of Ctrl+D presses ran concurrently: every press read the same
 * pre-write selection and the same stale source, so five presses produced five
 * copies with one name at one position, stacked (runhuman pass 66 —
 * "they are all stacked somewhere together... the names are HeroBox 2, 2, 2").
 * Queuing makes each press start from what the previous one produced, which is
 * also what a human means by pressing it again: a chain of copies, each named
 * and offset from the last.
 */
let duplicateQueue: Promise<void> = Promise.resolve();

export function duplicateSelection(store: EditorShellStore): Promise<void> {
  const queued = duplicateQueue.then(() => runDuplicateSelection(store));
  // The queue never inherits a rejection — one failed duplicate must not
  // strand every later press (the commit-queue rule in the canvas lane).
  duplicateQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

async function runDuplicateSelection(store: EditorShellStore): Promise<void> {
  const selection = actionSelectionIds(store);
  if (selection.length === 0) return;
  const adapter = resolvePanelAuthoring(store).adapter;
  const structure = adapter.structure;
  if (!structure) return;
  // Immediate acknowledgement: a source-lane duplicate takes a visible moment
  // (write + remount), and the silence in between reads as a dead hotkey — a
  // human pressed Ctrl+D repeatedly and ended up with three copies (runhuman
  // pass 41). The hint is published BEFORE the first await and replaced by the
  // done line when the writes land.
  const label =
    selection.length === 1
      ? (adapter.hierarchy.node(selection[0] as string)?.label ?? 'selection')
      : `${selection.length} objects`;
  showTransientHint(`Duplicating ${label}…`);
  if (structure.duplicateMany) {
    const ack = await duplicateManyAuthoringNodes(adapter, selection);
    if (ack && !ack.persisted) {
      showTransientHint(ack.destination);
      return;
    }
  } else {
    for (const id of selection) {
      const ack = await duplicateAuthoringNode(adapter, id).ack;
      if (ack && !ack.persisted) {
        showTransientHint(ack.destination);
        return;
      }
    }
  }
  showTransientHint(`Duplicated ${label}`);
}

/**
 * D4.R2 (spec27 §6 D4 reopen) — a multi-node override delete prefers the
 * batched `structure.removeMany` (ONE undo entry for the whole selection,
 * matching the first-party `store.deleteEntities` batched-undo semantics
 * below) when the active adapter implements it; falls back to the per-id
 * `structure.remove` loop for any adapter that doesn't (N undo entries).
 * `await`ed the same way `remove` is (harmless no-op for a synchronous/
 * in-memory implementer) — see `StructureProvider.removeMany`'s doc comment.
 *
 * SOURCE-CORRUPTION FIX (bug-panel reopen, post-D4.R2) + DELETE-ORDER-
 * RESIDUAL FIX (bug-panel follow-up, post-50f90a6d): the per-id fallback loop
 * used to fire `structure.remove(id)` for every id in RAW selection order —
 * document/top-first, the same order a marquee/DFS walk produces — with NO
 * `await` between iterations. For an adapter whose per-op target offset is
 * resolved from an index that is only refreshed by a real reparse (never
 * between same-file writes — `ReactRootAuthoringAdapter`'s `OidStore.index`),
 * that is a real, default-gesture-reachable source-corruption hazard:
 * deleting an EARLIER element first shifts every LATER element's still-stale
 * `{line, col}` out from under it, and firing every write in the same tick
 * can race the underlying network request, letting a later write silently
 * clobber an earlier one. Both mechanisms are fixed for the fallback loop,
 * together (see the CORRECTNESS INVARIANT comment on
 * `ReactRootAuthoringAdapter.structure`'s per-id `remove` for the full
 * soundness argument, including its own remaining caveat):
 *   1. sort `ids` into REVERSE DOCUMENT ORDER (bottom-most/deepest first) —
 *      derived from the SAME DFS pre-order `collectAllNodeIds` walks (the
 *      marquee/select-all candidate order), reversed, so a selected
 *      descendant is always deleted before a selected ancestor;
 *   2. `await` each `structure.remove(id)` before starting the next, so
 *      write N only ever begins once write N-1 has landed on disk.
 * A synchronous/in-memory `remove` (e.g. `UIAuthoringAdapter`'s) is
 * unaffected — awaiting a non-promise return is a harmless no-op, and its own
 * `removeMany` batches instead of ever reaching this loop. This fallback loop
 * is sound ONLY when `collectAllNodeIds`' walk order matches true SOURCE
 * order — `ReactRootAuthoringAdapter` now implements `removeMany` (a single
 * shared-snapshot batched delete, order-independent by construction) exactly
 * so THIS loop is never reached for it; it stays here, documented and tested,
 * as the honest degrade for any override adapter that has no batched delete.
 */
export async function deleteSelection(store: EditorShellStore): Promise<void> {
  const ids = actionSelectionIds(store);
  if (ids.length === 0) return;
  const adapter = resolvePanelAuthoring(store).adapter;
  const structure = adapter.structure;
  if (!structure) return;
  if (structure.removeMany) {
    await removeManyAuthoringNodes(adapter, ids);
  } else {
    // Reverse DOCUMENT order (bottom-most/deepest first) — see this
    // function's own doc comment. `collectAllNodeIds` walks the adapter's
    // hierarchy in the same DFS pre-order (parent-before-child, top-first)
    // a marquee/select-all uses; an id outside that walk (should not
    // happen — every selected id came FROM this adapter's own hierarchy)
    // sorts last (rank -1) as a defensive fallback, never a throw.
    const rank = new Map(collectAllNodeIds(adapter).map((id, i) => [id, i]));
    const ordered = [...ids].sort((a, b) => (rank.get(b) ?? -1) - (rank.get(a) ?? -1));
    for (const id of ordered) await removeAuthoringNode(adapter, id);
  }
}

/** D4 — `Ctrl+Alt+G` wrap / `Ctrl+Shift+G` unwrap (spec §6 D4, §5 "wrap/
 *  unwrap ... via `structure.*`"): no first-party equivalent exists (a 3D
 *  entity can't be "wrapped"), so this is override-only, capability-gated on
 *  the OPTIONAL `structure.wrap`/`structure.unwrap` (absent for the
 *  ingested `react-dom` adapter and the first-party three adapter alike —
 *  both correctly no-op). Applies to every selected id, same multi-select
 *  loop `duplicateSelection`/`deleteSelection` use. */
/** Awaited per id for the same reason `deleteSelection` awaits `remove`: two
 *  in-flight structural writes against the SAME source file each read it before
 *  either wrote back, and whichever lands second silently loses the first. The
 *  awaited value is that edit's own `{destination, persisted}` ack. */
export async function wrapSelection(store: EditorShellStore): Promise<void> {
  const ids = actionSelectionIds(store);
  if (ids.length === 0) return;
  const adapter = resolvePanelAuthoring(store).adapter;
  const structure = adapter.structure;
  if (!structure?.wrap) return;
  for (const id of ids) await wrapAuthoringNode(adapter, id);
}

export async function unwrapSelection(store: EditorShellStore): Promise<void> {
  const ids = actionSelectionIds(store);
  if (ids.length === 0) return;
  const adapter = resolvePanelAuthoring(store).adapter;
  const structure = adapter.structure;
  if (!structure?.unwrap) return;
  for (const id of ids) await unwrapAuthoringNode(adapter, id);
}

/** Group the current selection as one real spatial parent when its adapter
 * supports lossless grouping. One provider call owns one undo entry, and its
 * ack is awaited the same way `wrapSelection` awaits `wrap` — a caller that
 * awaits this function has awaited the byte. */
export async function groupSelection(store: EditorShellStore): Promise<void> {
  const ids = actionSelectionIds(store);
  if (ids.length === 0) return;
  const adapter = resolvePanelAuthoring(store).adapter;
  if (!adapter.structure?.group) return;
  await groupAuthoringNodes(adapter, ids).ack;
}

/**
 * D4.c (spec §6 D4 "arrow-nudge (↑↓←→, Shift=×10) ... writes margins/
 * offsets"): nudges every currently-selected id whose owner exposes
 * `boxEdit` (capability-gated — silently skips ids that don't, e.g. a 3D
 * entity or an ingested-world node with no spatial write path). Position/
 * margin math is the pure, independently-tested `computeArrowNudgePatch`
 * (`world-overlay-gestures.ts`); this function only resolves the per-id
 * rect/position/margin inputs it needs and brackets the write in a single
 * `begin`/`apply`/`end` (one undo step per nudged node, per B1/D-1).
 */
export function nudgeSelection(store: EditorShellStore, dx: number, dy: number): void {
  const ids = actionSelectionIds(store);
  if (ids.length === 0) return;
  const adapter = resolvePanelAuthoring(store).adapter;
  for (const id of ids) {
    const boxEdit = boxEditForId(adapter, id);
    if (!boxEdit) continue;
    const rect = rectForId(adapter, id);
    if (!rect) continue;
    const position = adapter.inspector?.get(id, 'style.position');
    const isPositioned = position === 'absolute' || position === 'fixed';
    const spacing = readSpacingValues(adapter, id);
    const patch = computeArrowNudgePatch(dx, dy, isPositioned, rect, {
      left: spacing.marginLeft,
      top: spacing.marginTop,
    });
    if (Object.keys(patch).length === 0) continue;
    boxEdit.begin(id);
    boxEdit.apply(id, patch);
    boxEdit.end(id);
  }
}

// ---------------------------------------------------------------------------
// The keymap seam
// ---------------------------------------------------------------------------
// No binding below spells a literal key. Each names a LOGICAL ACTION and
// `keymap-presets.ts` supplies the chords the active keymap assigns it, so
// `vgai` and `blender` are two tables rather than two code paths. See that
// module's header for the ruling, the collision resolutions, and the boundary
// against play-mode input isolation (which this seam does not touch).

/** How the FRAME reads a binding's scope when it turns one into a `when`
 *  clause (`key-actions.ts`): the viewport is the stage, the
 *  selection panels are the editor's own parts, global is everywhere in it. */
function frameScopeOf(scope: HotkeyBinding['scope']): KeyActionScope {
  const scopes = Array.isArray(scope) ? scope : [scope];
  if (scopes.includes('global')) return 'global';
  if (scopes.length === 1 && scopes[0] === 'viewport') return 'stage';
  return 'panel';
}

/**
 * The action ids one `build()` pass registered, collected so the pass's
 * disposal can take them back out. `bind` is the one place an action's body
 * is written, so it is also the one place the frame's table is filled; the
 * collector is how a call inside the build closure reaches the registration
 * that owns it without every call site threading it.
 */
let keyActionCollector: (() => void)[] | null = null;

/** Expand one logical action into the dispatcher's per-chord binding rows,
 *  and record what the action DOES in the chord-independent table the frame
 *  dispatches through (`key-actions.ts`). */
function bind(
  action: EditorKeyActionId,
  binding: Omit<HotkeyBinding, 'key' | 'code' | 'mod' | 'shift' | 'alt'> & {
    /** This binding's `when`, in the form the FRAME can ask — no event. Set
     *  it wherever `when` ignores its argument; see `KeyActionEntry.enabled`. */
    frameEnabled?: () => boolean;
  },
): HotkeyBinding[] {
  const { frameEnabled, ...row } = binding;
  keyActionCollector?.push(
    registerKeyAction({
      id: action,
      run: (event) => row.action(event ?? new KeyboardEvent('keydown')),
      scope: frameScopeOf(row.scope),
      ...(frameEnabled ? { enabled: frameEnabled } : {}),
    }),
  );
  return keyChordsFor(action).map((chord) => ({ ...row, ...chord }));
}

/**
 * Register a binding set that REBUILDS on a keymap switch — the "live, no
 * reload" half of the setting. Nothing else re-registers: the actions are the
 * same objects, only their chords move.
 *
 * The action TABLE is filled by the same pass, and it is filled whoever owns
 * the keyboard: under the frame the chord rows below go unread (the host
 * dispatcher is never installed — `hotkeys.ts`) while the table is what every
 * `vgai.*` VS Code command dispatches into.
 */
function registerKeymapBindings(build: () => HotkeyBinding[]): () => void {
  const runBuild = (): { rows: HotkeyBinding[]; actions: (() => void)[] } => {
    const actions: (() => void)[] = [];
    const previous = keyActionCollector;
    keyActionCollector = actions;
    try {
      return { rows: build(), actions };
    } finally {
      keyActionCollector = previous;
    }
  };
  let pass = runBuild();
  let dispose = registerHotkeys(pass.rows);
  const disposePass = (): void => {
    dispose();
    for (const drop of pass.actions) drop();
  };
  const unsubscribe = subscribeEditorKeymap(() => {
    disposePass();
    pass = runBuild();
    dispose = registerHotkeys(pass.rows);
  });
  return () => {
    unsubscribe();
    disposePass();
  };
}

/**
 * Shell-lifetime bindings: undo/redo, save, clipboard, delete, command palette.
 * These do not need a Three viewport. Canvas-only projects (Bubbo isolation
 * documents, first-party Pixi worlds) never mount a three stage at all, so they
 * only get these keys if THIS function is registered from the editor shell.
 *
 * `mod+Z` matches Ctrl OR Cmd (`hotkeys.ts`); on Mac the menu prints ⌘Z and
 * both chords fire the same action.
 */
export function registerEditorShellHotkeys(
  store: EditorShellStore,
  history: HistoryCommands,
): () => void {
  // NARRATED undo/redo: the hint names what just happened ("Undid Paste 3
  // Entities"). Undoing a paste empties the selection (the pasted ids die
  // with it), and the silent no-gizmo viewport that follows read as "a Play
  // preview I had to click out of" to a human (runhuman passes 52/53).
  const narratedUndo = (): void => {
    const label = history.getSnapshot().undoLabel;
    void history.undo().then((done) => {
      if (done && label) showTransientHint(`Undid ${label}`);
    });
  };
  const narratedRedo = (): void => {
    const label = history.getSnapshot().redoLabel;
    void history.redo().then((done) => {
      if (done && label) showTransientHint(`Redid ${label}`);
    });
  };
  const unregister = registerKeymapBindings(() => [
    // --- Global (fire regardless of active panel) ---
    // H2: one project-scoped async command queue owns shell undo/redo. Ctrl+Y
    // mirrors Ctrl+Shift+Z (Windows convention) — both are chords of the one
    // `edit.redo` action in the keymap table.
    // Undo/redo also fire inside fields that opted into app undo
    // (`APP_UNDO_PASSTHROUGH_ATTR` — per-keystroke-committing numeric inputs,
    // where native text undo is a dead key); every other editable keeps the
    // guard so typing retains the browser's own undo.
    ...bind('edit.redo', {
      scope: 'global',
      allowInEditable: true,
      when: (e) => !isEditableTarget(e.target) || allowsAppUndoWhileEditable(e.target),
      action: narratedRedo,
    }),
    ...bind('edit.undo', {
      scope: 'global',
      allowInEditable: true,
      when: (e) => !isEditableTarget(e.target) || allowsAppUndoWhileEditable(e.target),
      action: narratedUndo,
    }),
    ...bind('edit.copy', {
      scope: AUTHORING_SELECTION_SCOPES,
      when: shouldHandleEditorClipboard,
      frameEnabled: shouldHandleEditorClipboard,
      action: () => void copySelection(store),
    }),
    ...bind('edit.cut', {
      scope: AUTHORING_SELECTION_SCOPES,
      when: shouldHandleEditorClipboard,
      frameEnabled: shouldHandleEditorClipboard,
      action: () => void cutSelection(store),
    }),
    ...bind('edit.paste', {
      scope: AUTHORING_SELECTION_SCOPES,
      when: shouldHandleEditorClipboard,
      frameEnabled: shouldHandleEditorClipboard,
      action: () => void pasteSelection(store),
    }),
    ...bind('edit.duplicate', {
      scope: AUTHORING_SELECTION_SCOPES,
      action: () => void duplicateSelection(store),
    }),
    // D4 — wrap/unwrap (override-only, capability-gated — see
    // `wrapSelection`/`unwrapSelection`'s doc comments).
    ...bind('edit.group', {
      scope: AUTHORING_SELECTION_SCOPES,
      action: () => void groupSelection(store),
    }),
    ...bind('edit.wrap', {
      scope: AUTHORING_SELECTION_SCOPES,
      action: () => wrapSelection(store),
    }),
    ...bind('edit.unwrap', {
      scope: AUTHORING_SELECTION_SCOPES,
      action: () => unwrapSelection(store),
    }),
    // D4 — arrow-nudge (↑↓←→, Shift=×10 — see `nudgeSelection`'s doc comment).
    ...bind('edit.nudgeUp', { scope: 'viewport', action: () => nudgeSelection(store, 0, -1) }),
    ...bind('edit.nudgeUpCoarse', {
      scope: 'viewport',
      action: () => nudgeSelection(store, 0, -10),
    }),
    ...bind('edit.nudgeDown', { scope: 'viewport', action: () => nudgeSelection(store, 0, 1) }),
    ...bind('edit.nudgeDownCoarse', {
      scope: 'viewport',
      action: () => nudgeSelection(store, 0, 10),
    }),
    ...bind('edit.nudgeLeft', { scope: 'viewport', action: () => nudgeSelection(store, -1, 0) }),
    ...bind('edit.nudgeLeftCoarse', {
      scope: 'viewport',
      action: () => nudgeSelection(store, -10, 0),
    }),
    ...bind('edit.nudgeRight', { scope: 'viewport', action: () => nudgeSelection(store, 1, 0) }),
    ...bind('edit.nudgeRightCoarse', {
      scope: 'viewport',
      action: () => nudgeSelection(store, 10, 0),
    }),
    ...bind('edit.selectAll', {
      scope: AUTHORING_SELECTION_SCOPES,
      action: () => {
        const a = resolvePanelAuthoring(store).adapter;
        setAuthoringSelection(a, collectAllNodeIds(a));
      },
    }),
    // Blender's Alt+A. Unbound in the vgai table, where Escape is the deselect
    // (and carries the scope-exit verb with it); this one only clears.
    ...bind('edit.deselectAll', {
      scope: AUTHORING_SELECTION_SCOPES,
      action: () => setAuthoringSelection(resolvePanelAuthoring(store).adapter, []),
    }),
    ...bind('edit.save', {
      scope: 'global',
      allowInEditable: true,
      action: () => {
        void saveActiveWorkspaceDocument().then((handled) => {
          // Surfaces with no document-local editor fall back to the ACTIVE
          // authoring adapter's own persistence provider.
          if (handled === null) void saveActiveAuthoring(store);
        });
      },
    }),
    // D4 (spec27 §8 "space-pan" row) — Ctrl+0, the conventional "reset
    // zoom/pan to 100%" shortcut (browsers/design tools alike), resets the
    // DOM/react overlay's shared pan translate (`world-pan-state.ts`) back to
    // `(0, 0)`. A no-op when already at rest or when the active surface has
    // no pan-capable world (there is nothing for it to affect either way —
    // `resetRootPan()` itself no-ops at `(0,0)`).
    ...bind('view.resetPan', { scope: 'viewport', action: () => resetRootPan() }),
    ...bind('edit.enterScope', {
      scope: AUTHORING_SELECTION_SCOPES,
      // While playing, Enter belongs to the GAME. The dispatcher preventDefaults
      // every matched binding, so with this bound unconditionally the editor
      // swallowed Enter during play and a game's own Enter binding could never
      // fire — third-person's 'restart' is Enter, and its SQUAD DOWN card says
      // 'PRESS ENTER TO REDEPLOY': a tester pressed it and 'Enter then redeploy
      // doesn't work' (runhuman pass 122; an earlier reproduction had already
      // measured Enter and Escape both exiting Play). Same gate shape as
      // Escape's below, for the same reason.
      when: () => store.playState === 'stopped',
      frameEnabled: () => store.playState === 'stopped',
      action: () => {
        // The PANEL adapter, not the composite: `selection-scope.ts` keys its
        // stack by adapter identity and the Hierarchy's breadcrumb/entry both
        // resolve this one, so all three gestures name the same scope.
        enterSelectedScope(resolvePanelAuthoring(store).adapter);
      },
    }),
    ...bind('edit.delete', {
      scope: AUTHORING_SELECTION_SCOPES,
      action: () => void deleteSelection(store),
    }),
    ...bind('edit.exitScopeOrDeselect', {
      scope: AUTHORING_SELECTION_SCOPES,
      // While playing, Escape is owned by play-mode (stop on Escape) — don't also
      // clear the editor selection out from under the running game. The `when`
      // gate (NOT an action-internal no-op) is load-bearing: the dispatcher
      // preventDefaults every MATCHED binding, and play-mode's own bubble-phase
      // Escape guard (`shouldEscapeStopPlay`) reads `defaultPrevented` as
      // "an overlay consumed this Escape" — an action no-op here would still
      // preventDefault and poison that signal, leaving Escape unable to stop play.
      when: () => currentSelectionScopeId() !== null || store.playState === 'stopped',
      // AND UNDER THE FRAME THAT FALLTHROUGH DOES NOT EXIST, which is why the two
      // gates differ (found by walk 2's beat 17, 2026-09-20). VS Code's keybinding
      // service preventDefaults every rule whose `when` RESOLVES, before the command
      // it names decides anything — so with a `vgai.edit.exitScopeOrDeselect` rule on
      // Escape, play-mode's `window` listener never sees an Escape that is not already
      // `defaultPrevented`. A `frameEnabled` that returned false during play therefore
      // produced neither outcome: the command refused ("the editor has no live handler
      // for it right now") and the keystroke was consumed, so Escape did nothing at all
      // while play ran and only the transport's ■ could end an immersive Play.
      // The frame's Escape is this ONE action, and it does what the gesture means: leave
      // the current scope, or — with none to leave — leave PLAY.
      frameEnabled: () => true,
      action: () => {
        // Same one resolution as the Enter binding above — with the composite
        // here, `exitSelectionScope` saw a FOREIGN adapter and dropped the whole
        // stack instead of popping one level.
        const adapter = resolvePanelAuthoring(store).adapter;
        if (exitSelectionScope(adapter)) return;
        // Nothing to pop. Standalone this is only ever reached with play stopped
        // (the `when` above), so it is the deselect it always was; under the frame
        // it is also the Escape that ends a run, through the registry every lane
        // registers into — the same door `stop` reaches, never play-mode by name
        // (the editor does not import `@vgai/game`).
        if (store.playState !== 'stopped') {
          stopAllLiveSessions();
          return;
        }
        store.select(null);
      },
    }),
    ...bind('view.commandPalette', {
      scope: 'global',
      // THE PALETTE IS THE WORKBENCH'S. The frame hands over an opener that
      // runs `workbench.action.showCommands`. (This action's own CHORD is
      // unbound — ⌘K is VS Code's chord prefix, U6 — so this path is the
      // command, run from the palette itself or from a keybinding a person
      // made.)
      action: () => {
        if (!openCommandPalette()) {
          editorConsole.warn(
            'The command palette has not handed over its opener yet — run "Volter Editor: Open Workspace" first, or press the workbench\'s own Show All Commands.',
          );
        }
      },
    }),
    ...bind('view.toggleConsole', {
      scope: 'global',
      action: () => toggleConsoleUtility(),
    }),
    // W5 (§6.2 focus/maximize mode) — Ctrl/Cmd+Shift+F. SHORTCUT DECISION,
    // recorded: the benchmarks are Unity's Shift+Space (maximize view under
    // cursor) and VS Code zen's Ctrl+K Z chord — but this registry is
    // single-fire and chord-less, and Space already participates in the
    // overlay's space-pan HOLD gesture (`RootSelectionOverlay`), so both
    // benchmarks' literal keys would collide. mod+shift+F ("Focus") is free
    // in this registry and unclaimed by Chromium on an app page.
    ...bind('view.focusMode', {
      scope: 'global',
      action: () => toggleWorkspaceFocus(),
    }),
    // NAMED WORKSPACES' cycle pair (ARCHITECTURE-CORE §Editor chrome asks for
    // "a cycle shortcut"). Ctrl/Cmd+PageDown / PageUp is BLENDER'S OWN
    // workspace cycle — the vocabulary rule (docs/BLENDER-PARITY.md) applies
    // to the modeling half of the editor, and both keys are unclaimed here,
    // so both keymaps keep them.
    ...bind('workspace.cycleNext', {
      scope: 'global',
      action: () => {
        cycleEditorWorkspace(1);
      },
    }),
    ...bind('workspace.cyclePrevious', {
      scope: 'global',
      action: () => {
        cycleEditorWorkspace(-1);
      },
    }),
  ]);
  installHotkeys();
  return unregister;
}

/**
 * Three-viewport bindings (the gizmo-mode trio, numpad views, vertex snap).
 * Only the 3D Scene document has an `EditorViewport`; canvas isolation
 * documents do not. Which keys the trio lands on is the active KEYMAP's call
 * (`keymap-presets.ts`): W/E/R under `vgai`, G/R/S under `blender`.
 */
export function registerEditorViewportHotkeys(
  store: EditorShellStore,
  viewport: EditorViewport,
  canvas: HTMLCanvasElement,
): () => void {
  const unregister = registerKeymapBindings(() => [
    // --- Viewport-scoped (only when viewport/canvas is active) ---
    ...bind('transform.select', {
      scope: 'viewport',
      action: () => {
        if (!viewport.isFlying) requestTransformMode(store, 'select');
      },
    }),
    ...bind('transform.combined', {
      scope: 'viewport',
      action: () => {
        if (!viewport.isFlying) requestTransformMode(store, 'combined');
      },
    }),
    ...bind('transform.translate', {
      scope: 'viewport',
      action: () => {
        if (!viewport.isFlying) requestTransformMode(store, 'translate');
      },
    }),
    ...bind('transform.rotate', {
      scope: 'viewport',
      action: () => {
        if (!viewport.isFlying) requestTransformMode(store, 'rotate');
      },
    }),
    ...bind('transform.scale', {
      scope: 'viewport',
      action: () => {
        if (!viewport.isFlying) requestTransformMode(store, 'scale');
      },
    }),
    // Snap has a key and says what it did: a human build session asked "how
    // do you toggle the snap" with the magnet button on screen the whole time.
    // The hint names the ACTIVE keymap's key, never a remembered literal.
    // Holding Ctrl/⌘ during a drag snaps temporarily (editor-viewport.ts).
    ...bind('viewport.toggleSnap', {
      scope: 'viewport',
      action: () => {
        store.toggleSnap();
        const { translate, rotate, scale } = store.snapValues;
        const toggles = `${shortcutFor('viewport.toggleSnap') ?? ''} toggles; hold Ctrl while dragging to snap once`;
        showTransientHint(
          store.snapEnabled
            ? `Snap on — ${translate} units, ${rotate}°, ×${scale} (${toggles})`
            : `Snap off (${toggles})`,
        );
      },
    }),
    ...bind('viewport.frameSelection', {
      scope: 'viewport',
      action: () => store.focusOnSelection(),
    }),
    ...bind('viewport.cyclePivot', {
      scope: 'viewport',
      action: () => {
        const pivotModes = ['active-element', 'median-point', 'individual-origins'] as const;
        const idx = pivotModes.indexOf(store.pivotMode);
        store.setPivotMode(pivotModes[(idx + 1) % pivotModes.length]!);
      },
    }),
    ...bind('view.top', { scope: 'viewport', action: () => viewport.setViewPreset('top') }),
    ...bind('view.front', { scope: 'viewport', action: () => viewport.setViewPreset('front') }),
    ...bind('view.right', { scope: 'viewport', action: () => viewport.setViewPreset('right') }),
    ...bind('view.perspective', {
      scope: 'viewport',
      action: () => viewport.setViewPreset('perspective'),
    }),
    ...bind('viewport.snapToFloor', {
      scope: 'viewport',
      action: () => viewport.snapSelectionToFloor(),
    }),
  ]);

  const onPointerDown = () => setActiveScope('viewport');
  canvas.addEventListener('pointerdown', onPointerDown);
  installHotkeys();

  // Vertex snap: HOLD to activate. Not a `registerHotkeys` row because that
  // dispatcher is single-fire-per-keydown with no held concept, so this pair
  // reads the same keymap entry directly rather than a literal key.
  const isVertexSnapKey = (e: KeyboardEvent): boolean =>
    keyChordsFor('viewport.vertexSnapHold').some((chord) => chord.key === e.key.toLowerCase());
  const onKeyDown = (e: KeyboardEvent) => {
    if (isVertexSnapKey(e) && !e.metaKey && !e.ctrlKey && !e.repeat) {
      // THE STAGE'S OWN SCOPE, which is what keeps this from being a second
      // keyboard owner: it fires only while the viewport holds the editor's
      // scope, the same fact the frame publishes as `vgai.stage.focused`.
      if (getActiveScope() !== 'viewport') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      store.setVertexSnapActive(true);
      viewport.activateVertexSnap();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (isVertexSnapKey(e) && !e.metaKey && !e.ctrlKey) {
      store.setVertexSnapActive(false);
      viewport.deactivateVertexSnap();
    }
  };
  // THE ONE KEY LISTENER THE EDITOR STILL INSTALLS, and it is not a second
  // keyboard owner: a keybinding rule fires on keydown and has no HELD
  // concept, so vertex-snap hold has no workbench counterpart to become. It
  // consumes nothing — no `preventDefault`, no action table — reads only
  // whether a chord is DOWN, and fires only while the viewport holds the
  // editor's own scope. That is the stage-local gesture WORK.md U6 left open,
  // living beside `editor-viewport.ts`'s fly keys and snap-hold, which are
  // gated the same way.
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    unregister();
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}

/** Test/legacy wrapper: shell bindings plus the Three viewport set. */
export function registerEditorHotkeys(
  store: EditorShellStore,
  viewport: EditorViewport,
  canvas: HTMLCanvasElement,
  history: HistoryCommands,
): () => void {
  const unregisterShell = registerEditorShellHotkeys(store, history);
  const unregisterViewport = registerEditorViewportHotkeys(store, viewport, canvas);
  return () => {
    unregisterShell();
    unregisterViewport();
  };
}
