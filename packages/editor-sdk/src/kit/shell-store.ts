/**
 * THE SHELL STORE'S MEDIA-NEUTRAL HALF (ARCHITECTURE.md §The plan, unit 3): change
 * notification, project history, selection, play state and the Edit/Play tab derived from
 * workspace focus. It holds no scene, object, camera or tool: `EditorShellStore` extends it with
 * the Three half, which leaves the kit for `@volter/editor-threejs`. A kit module that needs only
 * this half types itself against `ShellStore` (or the narrower `ShellDocumentState`).
 */

import type { ViewportTab } from '@volter/editor-sdk';
import { GAME_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activeWorkspaceDocumentId,
  subscribeWorkspaceDocuments,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import type { HistoryService } from './history/history-service';
import type { ShellDocumentState } from './shell-document-state';

export type NotifyScope = 'content' | 'selection';
export type NotifyConcern = 'shell' | 'object-map';

/** The scope a coalesced pair of notifications must fire with: `'content'`
 *  unless BOTH were selection-only. */
function widenNotifyScope(current: NotifyScope, incoming: NotifyScope): NotifyScope {
  return current === 'selection' && incoming === 'selection' ? 'selection' : 'content';
}

/**
 * Which persistence regime the current play session exposes. D19 makes play
 * edits ephemeral for every world count, and since the `.vgai/` overlay
 * sidecar was deleted outright (2026-08-02) `ephemeral` is the ONLY regime
 * there is. `null` while not playing.
 */
export type PlayEditRegime = 'ephemeral' | null;

/** The authoring tool a view's gizmo arms. */
export type TransformMode = 'select' | 'combined' | 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'world' | 'local';
export type PivotMode = 'active-element' | 'median-point' | 'individual-origins';

/**
 * WHERE the transform gizmo is drawn for a single selection — the standard DCC
 * affordance, and PRESENTATION ONLY: an edit made about the bounds centre writes
 * the same source values it would about the pivot (`editor-viewport.ts`).
 *
 * `auto` is the default because the right answer is a property of the SUBJECT,
 * not a standing preference: an ordinary node's pivot is where its content is,
 * and a world-anchored instanced system's is not (`instanced-presentation.ts`) —
 * that one draws its gizmo at (0,0,0) with every unit the reader can see
 * somewhere else. Both explicit values remain reachable, because "put the gizmo
 * back on the actual origin" is a legitimate thing to want on exactly that node.
 */
export type GizmoAnchor = 'auto' | 'pivot' | 'center';

export interface HelperVisibility {
  bounds: boolean;
  lights: boolean;
  cameras: boolean;
  colliders: boolean;
  joints: boolean;
  particles: boolean;
  lod: boolean;
  audio: boolean;
  splines: boolean;
  navmesh: boolean;
  constraints: boolean;
  reflectionProbes: boolean;
  triggerVolumes: boolean;
  skeletons: boolean;
  /**
   * The WEIGHT display — a mesh coloured by its active vertex group
   * (`@volter/editor-blender`'s `blender-runtime-weights.ts`). Added 2026-09-19 (I4)
   * because nothing in this set stood for it: `skeletons` is the bones, and
   * Blender's own viewport overlay has a Bones checkbox but reaches weight
   * colours through Weight Paint MODE, which an inspection surface has no
   * brushes to enter. OFF by default, the way Blender shows no weights until
   * you ask for them.
   */
  weights: boolean;
  /**
   * Blender's 3D CURSOR (`View3DOverlay.show_cursor`, the overlay popover's
   * "3D Cursor" checkbox): the point `Scene.cursor` names, where the "to 3D
   * Cursor" operators place and snap. ON by default, as Blender draws it.
   */
  cursor: boolean;
  /** EMPTIES — a scene's objects that are only a place (Blender's empties, drawn by its
   *  overlay's extras as axes, arrows or a shape). ON by default, as Blender draws them. */
  empties: boolean;
}

/**
 * A request for whichever viewport shows this store: frame something, take a named view, move
 * the camera. Neutral: a Three stage, a canvas scene and a board each answer the kinds they can.
 */
export type ViewportAction =
  | { type: 'focus-entity'; id: string }
  | { type: 'focus-selection' }
  | { type: 'focus-scene' }
  | { type: 'snap-selection-to-floor' }
  | { type: 'set-view-preset'; preset: 'top' | 'front' | 'right' | 'perspective' }
  | { type: 'toggle-camera-view' }
  | { type: 'toggle-projection' }
  | {
      type: 'set-camera-pose';
      position: { x: number; y: number; z: number };
      target: { x: number; y: number; z: number };
      fov?: number;
    };

export class ShellStore implements ShellDocumentState {
  /** Selection is viewport-local. The public selection accessors always expose
   *  the ACTIVE viewport's set, so Edit and Play never leak subjects into one
   *  another while existing authoring adapters keep the same store contract. */
  protected _viewportSelections: Record<ViewportTab, Set<string>> = {
    edit: new Set<string>(),
    play: new Set<string>(),
  };

  protected _history: HistoryService | null = null;

  protected _playState: 'stopped' | 'playing' | 'paused' = 'stopped';

  /** See {@link PlayEditRegime} — set by play-mode.ts on play-enter, cleared on play-exit. */
  protected _playEditRegime: PlayEditRegime = null;

  /** Only the session store follows workspace focus; a stage's own store is always `edit`. */
  protected readonly _followsWorkspaceFocus: boolean;

  constructor(options: { readonly followsWorkspaceFocus?: boolean } = {}) {
    this._followsWorkspaceFocus = options.followsWorkspaceFocus === true;
    if (!this._followsWorkspaceFocus) return;
    // Focus is the workspace's; a flip of the derived tab is a change every reader must see.
    let tab = this.activeViewportTab;
    subscribeWorkspaceDocuments(() => {
      const next = this.activeViewportTab;
      if (next === tab) return;
      tab = next;
      this._notify();
    });
  }

  protected _listeners = new Set<() => void>();

  /** A relayed selection command applies its value synchronously but lets the
   *  hierarchy/Inspector render on the next task, after the control ack has
   *  left the page. Ordinary UI writes never use this timer. */
  protected _deferredNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  /** The scope the pending deferred notify will fire with. A coalescing window
   *  that swallowed even one `'content'` write must fire as `'content'` — see
   *  {@link widenNotifyScope}. */
  protected _deferredNotifyScope: NotifyScope = 'content';
  protected _version = 0;

  /**
   * Stable across live object-map churn that cannot change shell presentation.
   * Hierarchy/viewport consumers keep using {@link getSnapshot}; chrome that
   * reads play state, selection, tools, or document state uses this narrower
   * snapshot and therefore does not rerender for every runtime projectile.
   */
  protected _shellVersion = 0;

  /**
   * Bumped on every notify EXCEPT one whose only change was WHICH NODES ARE
   * SELECTED — see {@link contentVersion}.
   */
  protected _contentVersion = 0;
  /**
   * Bumped when existing hierarchy-row presentation facets may have changed.
   * Exact object-map membership deltas do not move it: newly admitted rows
   * compute their facets on first render, while surviving rows keep the same
   * source editability, warnings, and reflected property values.
   */
  protected _hierarchyRowFacetVersion = 0;

  // --- React useSyncExternalStore integration ---
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  getSnapshot = (): number => this._version;

  getShellSnapshot = (): number => this._shellVersion;

  /**
   * The version a TREE-SCALE derivation caches against.
   *
   * `_version` moves on every notify, selection included, so a panel that keys
   * a whole-tree walk on it re-walks the tree every time a human clicks a node
   * — measured on the scale harness as 100-430ms of main-thread block per
   * `select` on a 20 000-node world, in a verb whose reply came back in 3ms.
   * The tree the walk reads did not change; only the highlight did.
   *
   * This counter therefore advances on every notify EXCEPT one whose sole
   * change was the contents of `_viewportSelections` — the five selection
   * writers below, and nothing else, notify with `'selection'`. Every other
   * mutation (including `notifyIngestEdit`, history restores, play-state
   * changes and viewport-tab switches) advances it, so a cache keyed on it can
   * only ever be stale for a change that never happened. Subscribers still
   * receive a selection notify and still re-render — this decides only what
   * they are allowed to REUSE while doing so.
   */
  get contentVersion(): number {
    return this._contentVersion;
  }

  /** See {@link _hierarchyRowFacetVersion}. */
  get hierarchyRowFacetVersion(): number {
    return this._hierarchyRowFacetVersion;
  }

  get projectHistory(): HistoryService | null {
    return this._history;
  }

  protected _notify(
    scope: NotifyScope = 'content',
    concern: NotifyConcern = 'shell',
    affectsHierarchyRowFacets = scope !== 'selection',
  ): void {
    if (this._deferredNotifyTimer !== null) {
      clearTimeout(this._deferredNotifyTimer);
      this._deferredNotifyTimer = null;
    }
    this._beforeNotify();
    this._version++;
    if (concern === 'shell') this._shellVersion++;
    if (scope !== 'selection') this._contentVersion++;
    if (affectsHierarchyRowFacets) this._hierarchyRowFacetVersion++;
    for (const fn of this._listeners) fn();
  }

  protected _transformMode: TransformMode = 'combined';
  protected _transformSpace: TransformSpace = 'world';
  protected _snapEnabled = false;
  protected _snapValues = { translate: 1, rotate: 15, scale: 0.25 };
  protected _snapToSurface = false;
  protected _preserveChildrenTransform = false;
  protected _pivotMode: PivotMode = 'active-element';
  protected _gizmoAnchor: GizmoAnchor = 'auto';
  protected _showHelpers = true;
  protected _helperVisibility: HelperVisibility = {
    bounds: false,
    lights: true,
    cameras: true,
    colliders: true,
    joints: true,
    particles: true,
    lod: true,
    audio: true,
    splines: true,
    navmesh: true,
    constraints: true,
    reflectionProbes: true,
    triggerVolumes: true,
    skeletons: false,
    weights: false,
    cursor: true,
    empties: true,
  };

  get transformMode(): TransformMode {
    return this._transformMode;
  }
  get transformSpace(): TransformSpace {
    return this._transformSpace;
  }
  get snapEnabled(): boolean {
    return this._snapEnabled;
  }
  get snapValues() {
    return this._snapValues;
  }
  get snapToSurface(): boolean {
    return this._snapToSurface;
  }
  get preserveChildrenTransform(): boolean {
    return this._preserveChildrenTransform;
  }
  get pivotMode(): PivotMode {
    return this._pivotMode;
  }
  get gizmoAnchor(): GizmoAnchor {
    return this._gizmoAnchor;
  }
  get showHelpers(): boolean {
    return this._showHelpers;
  }
  get helperVisibility(): Readonly<HelperVisibility> {
    return this._helperVisibility;
  }

  // --- Authoring tools (per view: every stage owns its store) ---
  setTransformMode(mode: TransformMode): void {
    this._transformMode = mode;
    this._notify();
  }

  setTransformSpace(space: TransformSpace): void {
    this._transformSpace = space;
    this._notify();
  }

  toggleSnap(): void {
    this._snapEnabled = !this._snapEnabled;
    this._notify();
  }

  setSnapValues(values: Partial<{ translate: number; rotate: number; scale: number }>): void {
    this._snapValues = { ...this._snapValues, ...values };
    this._notify();
  }

  toggleSnapToSurface(): void {
    this._snapToSurface = !this._snapToSurface;
    this._notify();
  }

  togglePreserveChildrenTransform(): void {
    this._preserveChildrenTransform = !this._preserveChildrenTransform;
    this._notify();
  }

  setPivotMode(mode: PivotMode): void {
    this._pivotMode = mode;
    this._notify();
  }

  setGizmoAnchor(anchor: GizmoAnchor): void {
    this._gizmoAnchor = anchor;
    this._notify();
  }

  toggleHelpers(): void {
    // The eye is a visibility gate, not a reset of the category checkboxes.
    this._showHelpers = !this._showHelpers;
    this._notify();
  }

  toggleHelperType(type: keyof HelperVisibility): void {
    this._helperVisibility[type] = !this._helperVisibility[type];
    if (this._helperVisibility[type]) this._showHelpers = true;
    this._notify();
  }

  // --- Viewport requests ---
  protected _viewportActionListeners = new Set<(action: ViewportAction) => void>();

  onViewportAction = (fn: (action: ViewportAction) => void): (() => void) => {
    this._viewportActionListeners.add(fn);
    return () => this._viewportActionListeners.delete(fn);
  };

  /** Ask the viewport showing this store to act. */
  requestViewportAction(action: ViewportAction): void {
    for (const fn of this._viewportActionListeners) fn(action);
  }

  /** Focus the viewport camera on a specific entity. */
  focusOnEntity(id: string): void {
    this.requestViewportAction({ type: 'focus-entity', id });
  }

  /** Focus the viewport camera on the current selection. */
  focusOnSelection(): void {
    this.requestViewportAction({ type: 'focus-selection' });
  }

  /** Frame the whole active scene. A medium may carry more with it (the Three half's game
   *  camera lookup, `EditorShellStore.focusOnScene`). */
  focusOnScene(): void {
    this.requestViewportAction({ type: 'focus-scene' });
  }

  /** Drop the selection onto whatever is under it. */
  snapSelectionToFloor(): void {
    this.requestViewportAction({ type: 'snap-selection-to-floor' });
  }

  /** Switch the viewport camera to a preset view (top, front, right, perspective). */
  setViewPreset(preset: 'top' | 'front' | 'right' | 'perspective'): void {
    this.requestViewportAction({ type: 'set-view-preset', preset });
  }

  /** Enter or leave the camera view, where the document has cameras to look through. */
  toggleCameraView(): void {
    this.requestViewportAction({ type: 'toggle-camera-view' });
  }

  /** Switch the view between perspective and orthographic, from where it is. */
  toggleProjection(): void {
    this.requestViewportAction({ type: 'toggle-projection' });
  }

  /** Move the viewport camera to an arbitrary position/target/fov pose. */
  setCameraPose(
    position: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
    fov?: number,
  ): void {
    this.requestViewportAction({
      type: 'set-camera-pose',
      position,
      target,
      ...(fov !== undefined ? { fov } : {}),
    });
  }

  /** A companion half's change (the Three half's scene, tools and view options): the same
   *  notification the store's own writers send. */
  notifyChange(
    scope: NotifyScope = 'content',
    concern: NotifyConcern = 'shell',
    affectsHierarchyRowFacets = scope !== 'selection',
  ): void {
    this._notify(scope, concern, affectsHierarchyRowFacets);
  }

  /** Coalesce control-plane presentation behind the command-result microtask.
   *  The state mutation has already landed when this is called. */
  protected _notifyDeferred(scope: NotifyScope = 'content'): void {
    if (this._deferredNotifyTimer !== null) {
      this._deferredNotifyScope = widenNotifyScope(this._deferredNotifyScope, scope);
      return;
    }
    this._deferredNotifyScope = scope;
    this._deferredNotifyTimer = setTimeout(() => {
      this._deferredNotifyTimer = null;
      const pending = this._deferredNotifyScope;
      this._deferredNotifyScope = 'content';
      this._notify(pending);
    }, 0);
  }

  attachHistory(history: HistoryService): void {
    if (this._history === history) return;
    if (this._history) throw new Error('EditorStore is already attached to project history.');
    this._history = history;
    this._onHistoryAttached();
  }

  // --- Selection ---
  get selectedEntityId(): string | null {
    const selection = this._viewportSelections[this.activeViewportTab];
    if (selection.size === 0) return null;
    return [...selection].at(-1)!;
  }
  get selectedEntityIds(): ReadonlySet<string> {
    return this._viewportSelections[this.activeViewportTab];
  }

  get canUndo(): boolean {
    return this._history?.getSnapshot().canUndo ?? false;
  }
  get canRedo(): boolean {
    return this._history?.getSnapshot().canRedo ?? false;
  }

  notifyIngestEdit(): void {
    this._notify();
  }

  /**
   * WHICH MODE THE EDITOR IS IN — the shell's own intent, not a claim that a
   * game is running. Read it for anything whose answer must be true from the
   * MOMENT play is entered: the structural-edit block, the design session's
   * suspend, the Play bar, the viewport tab, the tool `when` predicates.
   *
   * It is NOT the answer to "is something actually running", and it must never
   * be reported as one. `'playing'` is written by three subsystems — play mode,
   * ingest and module mode — and every one of them writes it BEFORE its session
   * exists: `enterPlayMode` sets it ~130 lines and three awaits before
   * `_instance.session` is assigned, and an ingest mount sets it before the
   * mount is even attempted. That is deliberate (it is what swaps the viewport
   * onto the game surface and freezes edit-mode work while the boot runs), and
   * it is exactly why reporting the flag verbatim once printed
   * `playState: "playing"` for a mount that had already thrown.
   *
   * The other question has its own door and only one caller may use it:
   * `reported-play-state.ts`'s `deriveReportedPlayState`, which resolves the
   * live session slots and is what `collectState` (`vgai status`) reports. If
   * you are about to send this value outside the editor, you want that instead.
   */
  get playState(): 'stopped' | 'playing' | 'paused' {
    return this._playState;
  }

  /**
   * Guard structural/history mutations while a game is running. During play the
   * store's `_scene` is the LIVE game scene (see enterPlayScene), so undo/redo
   * (which call clearPreview + buildPreview and rebuild the whole scene) or
   * delete/duplicate (which splice the scene graph and objectMap) would tear the
   * scene out from under the running GameSession. Returns true (and warns) when
   * the named op must be blocked. The intended live-edit path during play is the
   * incremental ECS-sync transform path, not these full-scene mutations.
   */
  protected _blockedDuringPlay(op: string): boolean {
    if (this._playState === 'stopped') return false;
    console.warn(`EditorStore: "${op}" is disabled during play mode — stop the game first.`);
    return true;
  }
  setPlayState(state: 'stopped' | 'playing' | 'paused'): void {
    const wasActive = this._playState !== 'stopped';
    this._playState = state;
    if (state === 'stopped') {
      // Apply anything deferred while play/ingest was active. play-mode.ts /
      // ingest/mount-ingest-root.ts call exitPlayScene() (restoring the editor scene) BEFORE
      // this — so by the time we get here `_scene` is already the editor scene,
      // never the just-torn-down game scene (see applyExternalUpdate/applyAssetMove).
      if (wasActive) this._onPlayStopped();
    }
    this._notify();
  }

  /** See {@link PlayEditRegime}. Null while not playing. */
  get playEditRegime(): PlayEditRegime {
    return this._playEditRegime;
  }

  /** Set by play-mode.ts's enterPlayMode/exitPlayMode — see {@link PlayEditRegime}. */
  setPlayEditRegime(regime: PlayEditRegime): void {
    this._playEditRegime = regime;
    this._notify();
  }

  // --- Viewport tab ---
  /**
   * `play` exactly while the Game document is the active workspace document, else `edit`:
   * derived from workspace focus, which Code-OSS owns, never set beside it. A surface that
   * wants the other tab activates the document instead.
   */
  get activeViewportTab(): ViewportTab {
    return this._followsWorkspaceFocus && activeWorkspaceDocumentId() === GAME_DOCUMENT_ID ? 'play' : 'edit';
  }

  // --- Selection ---
  // Every writer below notifies with `'selection'` because every writer below
  // mutates `_viewportSelections` and NOTHING ELSE. That is the whole warrant
  // for the scope — see `contentVersion`.
  select(id: string | null, notification: 'immediate' | 'deferred' = 'immediate'): void {
    const selection = this._viewportSelections[this.activeViewportTab];
    selection.clear();
    if (id) selection.add(id);
    if (notification === 'deferred') this._notifyDeferred('selection');
    else this._notify('selection');
  }

  selectMultiple(ids: string[], notification: 'immediate' | 'deferred' = 'immediate'): void {
    this._viewportSelections[this.activeViewportTab] = new Set(ids);
    if (notification === 'deferred') this._notifyDeferred('selection');
    else this._notify('selection');
  }

  /**
   * Apply a control-API selection NOW and return the notification that lets presentation catch up.
   *
   * The normal UI methods above remain synchronous. A relayed selection is different: its caller
   * is waiting for an acknowledgement, while notifying React can synchronously reveal hundreds of
   * hierarchy rows and build an inspector preview before `select()` returns. The command listener
   * uses this method so `selectedEntityIds` already answers the new truth when it acks, then runs
   * the returned notification only after the result POST has settled. No selection is optimistic:
   * the set is mutated before this method returns; only presentation is deferred.
   */
  applySelectionBeforePresentation(ids: readonly string[]): () => void {
    this._viewportSelections[this.activeViewportTab] = new Set(ids);
    let presented = false;
    return () => {
      if (presented) return;
      presented = true;
      this._notify('selection');
    };
  }

  addToSelection(id: string): void {
    this._viewportSelections[this.activeViewportTab].add(id);
    this._notify('selection');
  }

  toggleSelection(id: string): void {
    const selection = this._viewportSelections[this.activeViewportTab];
    if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
    this._notify('selection');
  }


  /** Runs at the top of every `_notify()`. A document half uses it to close a
   *  pending history edit. */
  protected _beforeNotify(): void {}

  /** Runs after `attachHistory` binds the project `HistoryService`. A document
   *  half uses it to register its document resource driver. */
  protected _onHistoryAttached(): void {}

  /** Runs when `setPlayState('stopped')` ends an active play/ingest session.
   *  A document half applies mutations it deferred while play was running. */
  protected _onPlayStopped(): void {}
}
