/**
 * EditorShellStore — the format-NEUTRAL half of the editor's central store.
 *
 * It holds exactly the format-neutral state: selection, the
 * scene-adoption stack, the project-history handle, tool/viewport/play state, and the
 * viewport action bus. It knows about `THREE.Object3D`s and ids — never about
 * any document model or its persistence: an adapter's document is that
 * adapter's private business, and the store names no document type at all
 * (`authoring-inversion-guard.test.ts` is the tripwire).
 *
 * MEASURED: every authoring adapter touches exactly eight store members —
 * `selectedEntityIds`, `selectMultiple`, `subscribe`, `notifyIngestEdit`,
 * `objectMap`, `projectHistory`, `scene`, and `playState`. All eight are here.
 */

import type { ViewportTab } from '@volter/editor-sdk';
import { viewportCaptureOutputPass } from '@volter/editor-threejs/capture/output-pass';
import { isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import type { WorldRendererConfig } from '@volter/editor-threejs/adapter/renderer-config';
import { getUserData, setUserData } from '@volter/editor-threejs/ecs/user-data';
import type { ViewportShadingMode } from '@volter/editor-threejs/render/viewport-shading';
import * as THREE from 'three';
import type { BatchedRenderer } from 'three.quarks';
import { findEntityLod } from './entity-lod';
import { entityIdOf } from './entity-object';
import type { HistoryService } from './history/history-service';
import type { ShellDocumentState } from './shell-document-state';
import { withSceneFogNeutralized } from './scene-view-fog';

/** The store's persistence collaborator — installed by the shell, never
 *  imported by the store (see `attachStatePersistence`). */
export interface EditorStatePersistence {
  save(state: Record<string, unknown>): unknown;
  saveThumbnail?(dataUrl: string): unknown;
}

/**
 * WHICH TOOL THE SHELF HAS ARMED — four that draw a transform gizmo, and one
 * that draws none.
 *
 * `'select'` is Blender's Select Box, and it is a TOOL rather than an absence:
 * its shelf opens on it (`space_toolsystem_toolbar.py`,
 * `_defs_view3d_generic.select_box` first in the Object Mode `_tools_default`;
 * photographed at the engine's pin in `gizmo-select-box.png`), so a selected
 * object shows its outline and nothing else until Move / Rotate / Scale /
 * Transform is armed. Before it there was no "no gizmo" state at all — this
 * store's default was `'combined'` and every selection drew three tools'
 * handles at once — which is why it is a member here rather than a flag beside
 * it. `editor-viewport.ts` detaches on it, through the same branch a
 * non-writable selection already took.
 *
 * Which member a STAGE is born with is the look's (`workspace-regions.ts`'s
 * `shelfTool`); arming one is always a click in the shelf.
 */
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

export type ShadingMode = ViewportShadingMode;

/**
 * What a store notification says CHANGED.
 *
 * `'selection'` is the narrow one and it is claimed by exactly five writers
 * (`select`, `selectMultiple`, `addToSelection`, `toggleSelection`,
 * `applySelectionBeforePresentation`), each of which touches
 * `_viewportSelections` and nothing else. `'content'` is the default and means
 * "assume anything may have changed", so a mutation that forgets to classify
 * itself is safe by construction — the failure mode of a wrong claim is a
 * stale panel, so the burden of proof sits on the narrow value.
 * See {@link EditorShellStore.contentVersion}.
 */
export type NotifyScope = 'content' | 'selection';
type NotifyConcern = 'shell' | 'object-map';

/** Exact structural delta supplied by a live Three projection mutation. */
export interface IngestObjectMapStructureDelta {
  readonly changedParentIds: ReadonlySet<string>;
  readonly rootsChanged: boolean;
  /** Exact projected membership changes; omission keeps legacy callers conservative. */
  readonly addedIds?: ReadonlySet<string>;
  readonly removedIds?: ReadonlySet<string>;
}

/** All projected parent rows changed after a previously observed gizmo epoch. */
export interface IngestObjectMapChanges {
  readonly epoch: number;
  readonly changedParentIds: ReadonlySet<string>;
}

/** Exact object-map identities whose membership changed after an observed gizmo epoch. */
export interface IngestObjectMapMembershipChanges {
  readonly epoch: number;
  readonly changedIds: ReadonlySet<string>;
}

/** Enough exact structural epochs to span deferred React consumers; older readers rebuild. */
const OBJECT_MAP_MEMBERSHIP_HISTORY = 256;

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

/** The two viewport tabs, Edit · Play. Defined ONCE, in the SDK's shared
 *  vocabulary (`@volter/editor-sdk`), because the control API speaks it too;
 *  re-exported here so editor modules keep one import site. */
export type { ViewportTab };

export type AssetKind = 'model' | 'image' | 'video' | 'audio' | 'json' | 'source';

export interface OnlineAssetInfo {
  source: 'polyhaven' | 'ambientcg' | 'local';
  id: string;
  name: string;
  thumbnailUrl: string;
  type: string;
  tags: string[];
  license?: string;
  author?: string;
  sourceUrl?: string;
}

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
}

export type ViewportAction =
  | { type: 'focus-entity'; id: string }
  | { type: 'focus-selection' }
  | { type: 'focus-scene'; gameCamera?: () => THREE.Camera | null }
  | { type: 'snap-selection-to-floor' }
  | { type: 'set-view-preset'; preset: 'top' | 'front' | 'right' | 'perspective' }
  | {
      type: 'set-camera-pose';
      position: { x: number; y: number; z: number };
      target: { x: number; y: number; z: number };
      fov?: number;
    };

export class EditorShellStore implements ShellDocumentState {
  // --- Scene graph references (set via bindScene) ---
  protected _scene: THREE.Scene | null = null;
  /** Adoption stack (see enterPlayScene): each frame is the scene state that
   *  was active when an adoption replaced it, restored in LIFO order by
   *  exitPlayScene. A STACK (not a single slot) because adoptions nest for
   *  R3F projects: the design session adopts its fiber scene at design time,
   *  and play adopts the live game scene OVER it while the play-entry
   *  transition still needs the design scene alive — the design session then
   *  unwinds its own frame from the middle via releaseAdoptedScene. */
  protected _adoptionStack: Array<{
    /** `null` when the adoption replaced no scene: a session with no Scene stage plays too. */
    scene: THREE.Scene | null;
    objectMap: Map<string, THREE.Object3D>;
    /** Opaque payload from {@link _captureAdoptionExtras} — a document half's
     *  own per-adoption snapshot. The shell never inspects it. */
    extras: unknown;
    selection: Set<string>;
    /** The image config that was active BEFORE this adoption — same LIFO
     *  discipline as `scene`, so a frame spliced out of the middle simply
     *  stops being a restore point. See {@link _applyAdoptedImageConfig}. */
    imageConfig: WorldRendererConfig | undefined;
  }> = [];
  protected _objectMap = new Map<string, THREE.Object3D>();
  protected _renderer: THREE.WebGLRenderer | null = null;
  protected _camera: THREE.Camera | null = null;
  protected _batchedRenderer: BatchedRenderer | null = null;
  protected _lastThumbnailTime = 0;
  protected _lastEditorStateSaveTime = 0;
  protected _orbitTarget: THREE.Vector3 | null = null;

  // --- UI state (not stored in scene graph) ---
  /** Selection is viewport-local. The public selection accessors always expose
   *  the ACTIVE viewport's set, so Edit and Play never leak subjects into one
   *  another while existing authoring adapters keep the same store contract. */
  protected _viewportSelections: Record<ViewportTab, Set<string>> = {
    edit: new Set<string>(),
    play: new Set<string>(),
  };
  protected _transformMode: TransformMode = 'combined';
  protected _transformSpace: TransformSpace = 'world';
  protected _snapEnabled = false;
  protected _snapValues = { translate: 1, rotate: 15, scale: 0.25 };
  protected _snapToSurface = false;
  protected _preserveChildrenTransform = false;
  protected _pivotMode: PivotMode = 'active-element';
  protected _gizmoAnchor: GizmoAnchor = 'auto';
  protected _showGrid = true;
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
  };
  /**
   * Bumped whenever gizmos must be re-applied without a structural signature
   * change (W3a B1): a single-entity rebuild (`_rebuildEntity` →
   * `updateEntityPreview`) disposes the old Object3D WITH all its helper
   * children, but leaves the objectMap identity/size and every toggle
   * untouched — the viewport's `gizmoSig` gate would otherwise skip both
   * `applyEntityGizmos` and the per-type visibility pass until an unrelated
   * event.
   */
  protected _gizmoEpoch = 0;
  /** Last structural epoch at which each projected parent's direct children changed. */
  protected _objectMapParentChangedAt = new Map<string, number>();
  /** A root change (or an unclassified legacy call) requires a full hierarchy read. */
  protected _objectMapFullChangeEpoch = 0;
  /** Last exact add/remove epoch for each projected id, independently consumed by the viewport. */
  protected _objectMapMembershipChangedAt = new Map<string, number>();
  /** Missing membership detail requires the viewport to reconcile its complete helper indexes. */
  protected _objectMapMembershipFullChangeEpoch = 0;
  /** Epochs older than this were compacted from the bounded membership history. */
  protected _objectMapMembershipHistoryFloor = 0;
  protected _showStats = false;
  protected _shadingMode: ShadingMode = 'solid';
  protected _history: HistoryService | null = null;
  protected _statePersistence: EditorStatePersistence | null = null;
  protected _playState: 'stopped' | 'playing' | 'paused' = 'stopped';
  /** See {@link PlayEditRegime} — set by play-mode.ts on play-enter, cleared on play-exit. */
  protected _playEditRegime: PlayEditRegime = null;
  protected _activeViewportTab: ViewportTab = 'edit';
  protected _vertexSnapActive = false;
  protected _listeners = new Set<() => void>();
  protected _viewportActionListeners = new Set<(action: ViewportAction) => void>();
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
   * Bumped only when post-processing-relevant state changes (environment / scene
   * structure / play-stop scene swap). The viewport rebuilds its EffectComposer
   * only when this changes — NOT on every notify — so a transform drag/scrub (which
   * notifies per frame but never touches these) no longer recompiles shaders 60×/s.
   */
  protected _composerVersion = 0;
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
  bindScene(
    scene: THREE.Scene,
    renderer?: THREE.WebGLRenderer,
    batchedRenderer?: BatchedRenderer | null,
    camera?: THREE.Camera,
  ): void {
    // A stage mounting while a scene is adopted binds the edit scene UNDER the adoption, where
    // Stop restores it; the adopted scene stays the active one.
    const base = this._adoptionStack[0];
    if (base) base.scene = scene;
    else this._scene = scene;
    this._renderer = renderer ?? null;
    this._batchedRenderer = batchedRenderer ?? null;
    if (camera) this._camera = camera;
  }

  /** Set the orbit controls target reference for camera state persistence. */
  setOrbitTarget(target: THREE.Vector3): void {
    this._orbitTarget = target;
  }

  /** Update only the editor presentation camera (for perspective/orthographic
   * switching) without rebinding or replacing an adopted game scene. */
  setViewportCamera(camera: THREE.Camera): void {
    this._camera = camera;
  }

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

  /**
   * Where view/tool state and the autosave thumbnail go. The shell installs
   * its transport here (`EditorContext` binds the server SDK); the store
   * itself names no endpoint, so a document-local store (Asset Lab) or a
   * fixture store simply never persists. Same collaborator shape as
   * `attachHistory`, same one-owner rule.
   */
  attachStatePersistence(persistence: EditorStatePersistence): void {
    if (this._statePersistence === persistence) return;
    if (this._statePersistence) {
      throw new Error('EditorStore is already attached to a state persistence.');
    }
    this._statePersistence = persistence;
  }

  onViewportAction = (fn: (action: ViewportAction) => void): (() => void) => {
    this._viewportActionListeners.add(fn);
    return () => this._viewportActionListeners.delete(fn);
  };

  protected _emitViewportAction(action: ViewportAction): void {
    for (const fn of this._viewportActionListeners) fn(action);
  }

  /** Focus the viewport camera on a specific entity. */
  focusOnEntity(id: string): void {
    this._emitViewportAction({ type: 'focus-entity', id });
  }

  /** Focus the viewport camera on the current selection. */
  focusOnSelection(): void {
    this._emitViewportAction({ type: 'focus-selection' });
  }

  /**
   * Frame the whole active scene — the first thing a reader should see when a
   * world they did not author is adopted (an ingest mount). The viewport keeps
   * asking until the world HAS content, because a game builds itself
   * asynchronously; any camera input from the reader cancels it (see
   * `the world root's stage`). A no-op for a scene the reader already has a camera on.
   *
   * `gameCamera` is a LIVE LOOKUP, not a camera: an adopted game's own camera
   * may not exist yet on the frame it is captured on, so the viewport asks
   * again while its window is open. When one turns up, its view is adopted
   * instead of any measurement — see `scene-framing.ts`.
   */
  focusOnScene(gameCamera?: () => THREE.Camera | null): void {
    this._emitViewportAction({
      type: 'focus-scene',
      ...(gameCamera ? { gameCamera } : {}),
    });
  }

  /** Switch the viewport camera to a preset view (top, front, right, perspective). */
  setViewPreset(preset: 'top' | 'front' | 'right' | 'perspective'): void {
    this._emitViewportAction({ type: 'set-view-preset', preset });
  }

  /** Move the viewport camera to an arbitrary position/target/fov pose. */
  setCameraPose(
    position: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
    fov?: number,
  ): void {
    this._emitViewportAction({
      type: 'set-camera-pose',
      position,
      target,
      ...(fov !== undefined ? { fov } : {}),
    });
  }

  /**
   * Live viewport camera pose, read straight from the bound Three.js camera +
   * orbit target (`bindScene`/`setOrbitTarget` — wired by `world-root-stage.ts`).
   * Null only when nothing has bound a camera yet (e.g. a headless store in a
   * unit test that never mounted `the world root's stage`).
   */
  get cameraPose(): { position: THREE.Vector3; target: THREE.Vector3; fov: number } | null {
    if (!this._camera) return null;
    const fov = (this._camera as THREE.PerspectiveCamera).fov;
    return {
      position: this._camera.position.clone(),
      target: this._orbitTarget ? this._orbitTarget.clone() : new THREE.Vector3(),
      fov: typeof fov === 'number' ? fov : 0,
    };
  }

  // --- Scene graph accessors ---

  /** The object map: entity ID → Three.js Object3D. */
  get objectMap(): Map<string, THREE.Object3D> {
    return this._objectMap;
  }

  /** The bound Three.js scene. */
  get scene(): THREE.Scene | null {
    return this._scene;
  }

  /** Monotonic counter bumped when post-processing inputs change (see field doc). */
  get composerVersion(): number {
    return this._composerVersion;
  }

  // --- Selection ---
  get selectedEntityId(): string | null {
    const selection = this._viewportSelections[this._activeViewportTab];
    if (selection.size === 0) return null;
    return [...selection].at(-1)!;
  }
  get selectedEntityIds(): ReadonlySet<string> {
    return this._viewportSelections[this._activeViewportTab];
  }
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
  get canUndo(): boolean {
    return this._history?.getSnapshot().canUndo ?? false;
  }
  get canRedo(): boolean {
    return this._history?.getSnapshot().canRedo ?? false;
  }
  get showGrid(): boolean {
    return this._showGrid;
  }
  get showHelpers(): boolean {
    return this._showHelpers;
  }
  get helperVisibility(): Readonly<HelperVisibility> {
    return this._helperVisibility;
  }
  /** See {@link _gizmoEpoch} — folded into the viewport's gizmo signature. */
  get gizmoEpoch(): number {
    return this._gizmoEpoch;
  }

  /**
   * Return the exact projected parents changed after `epoch`, or `null` when a
   * root/unclassified change crossed that boundary and callers must rebuild.
   * Parent timestamps make this safe across React batching: no consumer drains
   * a shared queue, and several projectile commits collapse into one union.
   */
  ingestObjectMapChangesSince(epoch: number): IngestObjectMapChanges | null {
    if (epoch < 0 || epoch > this._gizmoEpoch || epoch < this._objectMapFullChangeEpoch) {
      return null;
    }
    const changedParentIds = new Set<string>();
    for (const [id, changedAt] of this._objectMapParentChangedAt) {
      if (changedAt > epoch) changedParentIds.add(id);
    }
    return { epoch: this._gizmoEpoch, changedParentIds };
  }

  /** Return exact added/removed identities since `epoch`, or `null` across an unclassified edit. */
  ingestObjectMapMembershipChangesSince(epoch: number): IngestObjectMapMembershipChanges | null {
    if (
      epoch < 0 ||
      epoch > this._gizmoEpoch ||
      epoch < this._objectMapMembershipFullChangeEpoch ||
      epoch < this._objectMapMembershipHistoryFloor
    ) {
      return null;
    }
    const changedIds = new Set<string>();
    for (const [id, changedAt] of this._objectMapMembershipChangedAt) {
      if (changedAt > epoch) changedIds.add(id);
    }
    return { epoch: this._gizmoEpoch, changedIds };
  }

  isSkeletonVisible(id: string): boolean {
    return Boolean(getUserData(this._objectMap.get(id), 'skeletonVisible'));
  }

  setSkeletonVisible(id: string, visible: boolean): void {
    const object = this._objectMap.get(id);
    if (!object) return;
    setUserData(object, 'skeletonVisible', visible);
    object.traverse((child) => {
      if (getUserData(child, 'editorHelperType') !== 'skeletons') return;
      setUserData(child, 'skeletonEnabled', visible);
      child.visible = visible || this._helperVisibility.skeletons;
    });
    this._notify();
  }
  get showStats(): boolean {
    return this._showStats;
  }
  get shadingMode(): ShadingMode {
    return this._shadingMode;
  }
  /** Notify subscribers after an ingest adapter mutated a live foreign object
   *  (material/visibility). Runtime-only — no dirty/autosave, because the edit
   *  lives on the live `Object3D` and nothing here owns a document. */
  notifyIngestEdit(): void {
    this._notify();
  }

  /** Notify after a live adapter changed `objectMap` membership.
   *
   * Unlike an ordinary reflected-property edit, a membership change requires
   * the viewport to re-apply native helper visibility. The map is mutated in
   * place, and a remove+add burst can keep its size unchanged, so neither map
   * identity nor size is a complete signal. `_gizmoEpoch` is the viewport's
   * existing explicit rebuild input; bump it only at this structural seam. */
  notifyIngestObjectMapEdit(delta?: IngestObjectMapStructureDelta): void {
    this._gizmoEpoch++;
    if (delta === undefined || delta.rootsChanged) {
      this._objectMapFullChangeEpoch = this._gizmoEpoch;
      this._objectMapParentChangedAt.clear();
    } else {
      for (const id of delta.changedParentIds) {
        this._objectMapParentChangedAt.set(id, this._gizmoEpoch);
      }
    }
    if (delta?.addedIds === undefined || delta.removedIds === undefined) {
      this._objectMapMembershipFullChangeEpoch = this._gizmoEpoch;
      this._objectMapMembershipChangedAt.clear();
    } else {
      for (const id of delta.addedIds) this._objectMapMembershipChangedAt.set(id, this._gizmoEpoch);
      for (const id of delta.removedIds) {
        this._objectMapMembershipChangedAt.set(id, this._gizmoEpoch);
      }
      const historyFloor = Math.max(0, this._gizmoEpoch - OBJECT_MAP_MEMBERSHIP_HISTORY);
      if (historyFloor > this._objectMapMembershipHistoryFloor) {
        this._objectMapMembershipHistoryFloor = historyFloor;
        for (const [id, changedAt] of this._objectMapMembershipChangedAt) {
          if (changedAt <= historyFloor) this._objectMapMembershipChangedAt.delete(id);
        }
      }
    }
    const affectsShell =
      delta === undefined ||
      delta.rootsChanged ||
      [...(delta.addedIds ?? []), ...(delta.removedIds ?? [])].some((id) =>
        this.selectedEntityIds.has(id),
      );
    this._notify('content', affectsShell ? 'shell' : 'object-map', false);
  }

  // --- Play mode scene swap ---

  /** Callback to sync transform edits to game ECS. Set by play-mode, cleared on exit.
   *  Receives the NODE ID as well as the live object: the `PhysicsAdapter` seam
   *  it ultimately feeds is id-keyed since P-4, and the id is already in hand
   *  at the one call site — so nothing downstream has to map an object back. */
  protected _ecsSyncTransform: ((id: string, obj: THREE.Object3D) => void) | null = null;

  /** Set a callback that syncs editor transform changes to the game's ECS state. */
  setEcsSyncTransform(fn: ((id: string, obj: THREE.Object3D) => void) | null): void {
    this._ecsSyncTransform = fn;
  }

  /**
   * Swap the store's active scene to the game scene. Editor scene is preserved.
   *
   * Also snapshots whatever the active document half hands back from
   * {@link _captureAdoptionExtras}. A half that keeps mutating its LIVE
   * metadata during play (so its inspector fields keep working) must have
   * those edits discarded when play stops — otherwise a play-time edit
   * silently persists with `isDirty` false. `exitPlayScene` restores the
   * snapshot.
   */
  enterPlayScene(
    gameScene: THREE.Scene,
    imageConfig?: WorldRendererConfig | undefined,
    projectedObjects?: ReadonlyMap<string, THREE.Object3D>,
  ): void {
    this._adoptionStack.push({
      scene: this._scene,
      objectMap: this._objectMap,
      extras: this._captureAdoptionExtras(),
      selection: new Set(this.selectedEntityIds),
      imageConfig: this._adoptedImageConfig,
    });
    this._scene = gameScene;
    this._applyAdoptedImageConfig(imageConfig);

    // The store INDEXES an adopted scene; it no longer models it. A foreign
    // adapter supplies its pure projection explicitly, so editor identity is
    // never written into the game's Object3Ds. Source-backed/adopted worlds
    // already carry native authoring stamps and retain the fallback walk.
    const gameMap = projectedObjects
      ? new Map(projectedObjects)
      : (() => {
          const stamped = new Map<string, THREE.Object3D>();
          const visit = (obj: THREE.Object3D): void => {
            if (isEditorOwnedObject(obj)) return;
            const eid = entityIdOf(obj);
            if (eid !== undefined) stamped.set(eid, obj);
            for (const child of obj.children) visit(child);
          };
          for (const child of gameScene.children) visit(child);
          return stamped;
        })();
    this._objectMap = gameMap;

    this._viewportSelections[this._activeViewportTab] = new Set(
      [...this.selectedEntityIds].filter((id) => gameMap.has(id)),
    );
    // A viewport LOD pin must not follow the entity id into the adopted game
    // scene — there `WebGLRenderer.projectObject` owns level visibility (it
    // calls `lod.update(camera)` for every visible LOD whose `autoUpdate` is
    // still true, which is what a pin turns OFF), and per-frame enforcement
    // would fight it.
    this._lodForcedLevels.clear();
    this._composerVersion++; // scene swapped → composer must rebuild against the game scene
    this._notify();
  }

  /** Whether the active scene is one another document adopted (`enterPlayScene`). */
  get hasAdoptedScene(): boolean {
    return this._adoptionStack.length > 0;
  }

  /** Restore the previously-adopted scene (LIFO — see enterPlayScene). */
  exitPlayScene(): void {
    const frame = this._adoptionStack.pop();
    if (!frame) return;
    this._scene = frame.scene;
    this._objectMap = frame.objectMap;
    this._applyAdoptedImageConfig(frame.imageConfig);
    // Discard any play-time env/name/ui edits — restore the pre-play snapshot.
    this._restoreAdoptionExtras(frame.extras);
    this._viewportSelections[this._activeViewportTab] = new Set(frame.selection);
    this._composerVersion++; // scene swapped back → composer must rebuild against the editor scene
    this._notify();
  }

  /**
   * Release ONE adopter's adoption, wherever it sits in the stack. When
   * `scene` is the ACTIVE scene this is exactly `exitPlayScene`; when a later
   * adoption (play over the R3F design session) has already replaced it, the
   * frame that would restore `scene` is unlinked from the middle of the stack
   * instead — nothing visible changes now, and the LATER adopter's exit
   * restores the state underneath as if this adoption never happened. No-op
   * when `scene` was never adopted (or was already released).
   */
  releaseAdoptedScene(scene: THREE.Scene): void {
    if (this._scene === scene) {
      this.exitPlayScene();
      return;
    }
    const index = this._adoptionStack.findIndex((frame) => frame.scene === scene);
    if (index === -1) return;
    this._adoptionStack.splice(index, 1);
  }

  /**
   * THE ADOPTED CONTENT'S OWN COLOUR PIPELINE — what it is, not where it is
   * applied.
   *
   * A mounted world may report the pipeline it was authored for
   * (`MountedThreeRoot.rendererConfig`), and `applyWorldRendererConfig` puts it
   * on the renderer its own host handed it. In the editor those are two
   * DIFFERENT renderers: the design session mounts against a non-rasterizing
   * one (`authoring/design-time-renderer.ts`) and the viewport draws the
   * mounted scene with its own. So the declaration landed on a surface with no
   * pixels while the surface with pixels kept the engine's defaults — measured
   * on the translated Godot platformer, whose roughness-0 metal reads as chrome
   * under the editor's ACES while the game renders it under its own curve.
   *
   * The store only REMEMBERS the declaration and bumps `_composerVersion` when
   * it changes; `the world root's stage.rebuildComposer` is the one place that derives
   * the viewport renderer's whole configuration, and it applies this last. That
   * split is why there is no restore bookkeeping here: a rebuild always resets
   * the renderer to the engine defaults first, so "unwind" is just the next
   * rebuild seeing a different (or absent) config.
   */
  protected _adoptedImageConfig: WorldRendererConfig | undefined;

  /** What the active adopted content declared about the renderer that draws it,
   *  or `undefined` when it declared nothing (leave the editor's own alone). */
  get adoptedImageConfig(): WorldRendererConfig | undefined {
    return this._adoptedImageConfig;
  }

  protected _applyAdoptedImageConfig(next: WorldRendererConfig | undefined): void {
    if (next === this._adoptedImageConfig) return;
    this._adoptedImageConfig = next;
    this._composerVersion++;
  }

  /** True while an ADOPTED live game scene is the active scene — every
   *  `enterPlayScene` caller: play adoption, ingest mounts, and the R3F
   *  design session. Adopted scenes own their lighting/rendering completely;
   *  the viewport uses this to keep editor-fabricated presentation (the
   *  helper light rig) out of them. */
  get isAdoptedSceneActive(): boolean {
    return this._adoptionStack.length > 0;
  }

  // --- Play mode state ---
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
    if (state === 'playing' && this._activeViewportTab === 'edit') {
      this._activeViewportTab = 'play';
    }
    if (state === 'stopped') {
      this._activeViewportTab = 'edit';
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
  get activeViewportTab(): ViewportTab {
    return this._activeViewportTab;
  }
  setActiveViewportTab(tab: ViewportTab): void {
    if (tab === this._activeViewportTab) return;
    this._activeViewportTab = tab;
    this._notify();
  }
  // --- Vertex snap ---
  get vertexSnapActive(): boolean {
    return this._vertexSnapActive;
  }
  setVertexSnapActive(active: boolean): void {
    this._vertexSnapActive = active;
    this._notify();
  }

  // --- Selection ---
  // Every writer below notifies with `'selection'` because every writer below
  // mutates `_viewportSelections` and NOTHING ELSE. That is the whole warrant
  // for the scope — see `contentVersion`.
  select(id: string | null, notification: 'immediate' | 'deferred' = 'immediate'): void {
    const selection = this._viewportSelections[this._activeViewportTab];
    selection.clear();
    if (id) selection.add(id);
    if (notification === 'deferred') this._notifyDeferred('selection');
    else this._notify('selection');
  }

  selectMultiple(ids: string[], notification: 'immediate' | 'deferred' = 'immediate'): void {
    this._viewportSelections[this._activeViewportTab] = new Set(ids);
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
    this._viewportSelections[this._activeViewportTab] = new Set(ids);
    let presented = false;
    return () => {
      if (presented) return;
      presented = true;
      this._notify('selection');
    };
  }

  addToSelection(id: string): void {
    this._viewportSelections[this._activeViewportTab].add(id);
    this._notify('selection');
  }

  toggleSelection(id: string): void {
    const selection = this._viewportSelections[this._activeViewportTab];
    if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
    this._notify('selection');
  }

  protected static readonly THUMBNAIL_INTERVAL_MS = 60_000;
  protected static readonly THUMBNAIL_SIZE = 256;

  /**
   * Render the bound camera's current view to a PNG data URL at `size`x`size`.
   * Autosave thumbnails request game content only; an explicit SDK/editor
   * viewport capture requests every camera layer so grid/helpers/gizmos are
   * represented honestly. Both use the same offscreen render-target technique,
   * so neither needs `preserveDrawingBuffer` on the live WebGL canvas.
   *
   * THE COLOUR PIPELINE IS THE WHOLE REASON THERE ARE TWO TARGETS. Three
   * applies `renderer.toneMapping` and `renderer.outputColorSpace` ONLY when
   * the destination is the canvas: rendering into an ordinary
   * `WebGLRenderTarget` compiles every material with `NoToneMapping` and a
   * LINEAR output transfer (`WebGLPrograms.getParameters` and
   * `WebGLRenderer.setProgram` both gate on `currentRenderTarget === null`).
   * So the single-target version of this function answered "what does the
   * viewport look like" with a raw linear frame — measurably darker and
   * flatter than the pixels on screen, and immune to every tone-mapping
   * change (verified live: flipping the viewport to `NoToneMapping` moved the
   * captured PNG by 0 bytes). That made this door — the only look at the EDIT
   * viewport, and the source of every project thumbnail — unusable as
   * evidence about the image.
   *
   * The fix is three's own: render the scene into a HALF-FLOAT linear buffer
   * (so highlights survive to be tone-mapped) and resolve it through
   * `OutputPass`, which reads `toneMapping`/`toneMappingExposure`/
   * `outputColorSpace` off the renderer and applies exactly what the on-screen
   * frame gets.
   */
  protected _renderViewportImage(
    size: number | { width: number; height: number },
    includeEditorLayers: boolean,
  ): string | null {
    if (!this._renderer || !this._scene || !this._camera) return null;
    // A number is a SQUARE of that size — the default shape; `{width, height}`
    // renders the buffer and the camera at that aspect so a shaped look needs
    // no crop (`@volter/editor-sdk`'s `CaptureDimensions`).
    const width = typeof size === 'number' ? size : size.width;
    const height = typeof size === 'number' ? size : size.height;
    // The same floor `authoring/object3d-document-session.ts`'s `captureImage`
    // already sets, for the same reason: the doubled size is handed straight to
    // `createImageData`, so a non-finite size throws
    // `TypeError: Value is not of type 'long'` from the middle of the render
    // path instead of failing where the value entered.
    if (!Number.isFinite(width) || width < 1) return null;
    if (!Number.isFinite(height) || height < 1) return null;

    // render at 2x then downscale for crisp result
    const renderWidth = width * 2;
    const renderHeight = height * 2;
    const renderer = this._renderer;
    const sceneTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
      type: THREE.HalfFloatType,
    });
    const renderTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight);
    const prevTarget = renderer.getRenderTarget();
    const prevPixelRatio = renderer.getPixelRatio();

    const camera = this._camera;
    const prevLayers = camera.layers.mask;
    const perspectiveCamera = camera instanceof THREE.PerspectiveCamera ? camera : null;
    const previousAspect = perspectiveCamera?.aspect;
    if (includeEditorLayers) {
      camera.layers.enableAll();
    } else {
      camera.layers.disableAll();
      camera.layers.enable(0); // clean project thumbnail: game content only
    }

    try {
      if (perspectiveCamera) {
        perspectiveCamera.aspect = width / height;
        perspectiveCamera.updateProjectionMatrix();
      }
      renderer.setPixelRatio(1);
      renderer.setRenderTarget(sceneTarget);
      // The same view policy the on-screen draw applies (`scene-view-fog.ts`).
      // This capture is the ONLY look anyone gets at the Edit viewport — the
      // `vgai screenshot` evidence and every project thumbnail — so a capture
      // that renders the game's fog while the viewport does not would make the
      // one door onto the image disagree with the image.
      withSceneFogNeutralized(this._scene, () =>
        renderer.render(this._scene as THREE.Scene, camera),
      );
      viewportCaptureOutputPass().render(renderer, renderTarget, sceneTarget, 0, false);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setPixelRatio(prevPixelRatio);
      camera.layers.mask = prevLayers;
      if (perspectiveCamera && previousAspect !== undefined) {
        perspectiveCamera.aspect = previousAspect;
        perspectiveCamera.updateProjectionMatrix();
      }
    }

    // Read pixels from the render target
    const rowBytes = renderWidth * 4;
    const pixels = new Uint8Array(rowBytes * renderHeight);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, renderWidth, renderHeight, pixels);
    renderTarget.dispose();
    sceneTarget.dispose();

    // Flip vertically (WebGL reads bottom-up) and write to a full-size canvas
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = renderWidth;
    fullCanvas.height = renderHeight;
    const fullCtx = fullCanvas.getContext('2d')!;
    const imageData = fullCtx.createImageData(renderWidth, renderHeight);
    for (let y = 0; y < renderHeight; y++) {
      const srcRow = (renderHeight - 1 - y) * rowBytes;
      const dstRow = y * rowBytes;
      imageData.data.set(pixels.subarray(srcRow, srcRow + rowBytes), dstRow);
    }
    fullCtx.putImageData(imageData, 0, 0);

    // Downscale to the requested size
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx2d = canvas.getContext('2d')!;
    ctx2d.drawImage(fullCanvas, 0, 0, width, height);

    return canvas.toDataURL('image/png');
  }

  protected _captureThumbnail(): void {
    const now = Date.now();
    if (now - this._lastThumbnailTime < EditorShellStore.THUMBNAIL_INTERVAL_MS) return;
    this._lastThumbnailTime = now;
    const dataUrl = this._renderViewportImage(EditorShellStore.THUMBNAIL_SIZE, false);
    if (dataUrl) void this._statePersistence?.saveThumbnail?.(dataUrl);
  }

  /**
   * Fresh, on-demand viewport capture (unthrottled, unlike the periodic
   * autosave thumbnail above) — backs the `capture-viewport` relay command.
   * Returns null when no renderer/scene/camera is bound yet (e.g. before
   * `the world root's stage` has mounted).
   */
  captureViewportImage(
    size: number | { width: number; height: number } = EditorShellStore.THUMBNAIL_SIZE,
  ): string | null {
    return this._renderViewportImage(size, true);
  }

  /** The live Scene viewport's own `<canvas>`, or null before a renderer is
   *  bound. A photograph of the whole editor page (`editor-chrome-capture.ts`)
   *  needs to recognise it: its WebGL context has no `preserveDrawingBuffer`,
   *  so its pixels come from {@link captureViewportImage}, not a late read. */
  viewportCanvas(): HTMLCanvasElement | null {
    return this._renderer?.domElement ?? null;
  }

  // --- Editor state persistence ---

  protected static readonly EDITOR_STATE_INTERVAL_MS = 60_000;

  protected _saveEditorStateIfDue(): void {
    if (!this._statePersistence) return;
    const now = Date.now();
    if (now - this._lastEditorStateSaveTime < EditorShellStore.EDITOR_STATE_INTERVAL_MS) return;
    this._lastEditorStateSaveTime = now;

    const state: Record<string, unknown> = {
      transformMode: this._transformMode,
      transformSpace: this._transformSpace,
      snapEnabled: this._snapEnabled,
      snapValues: this._snapValues,
      preserveChildrenTransform: this._preserveChildrenTransform,
      pivotMode: this._pivotMode,
      gizmoAnchor: this._gizmoAnchor,
      showGrid: this._showGrid,
      showHelpers: this._showHelpers,
      helperVisibility: { ...this._helperVisibility },
      showStats: this._showStats,
      shadingMode: this._shadingMode,
    };

    Object.assign(state, this._editorStateExtras());

    if (this._camera) {
      const cam = this._camera as THREE.PerspectiveCamera;
      state['camera'] = {
        position: cam.position.toArray(),
        target: this._orbitTarget ? this._orbitTarget.toArray() : [0, 0, 0],
      };
    }

    void this._statePersistence.save(state);
  }

  // --- Mutations ---

  /**
   * EDITOR-ONLY level-preview override (W2b): entity id → index into the
   * live THREE.LOD's (ascending-by-distance) levels to pin in the viewport.
   * Pure UI state — never written to the descriptor, so it can't leak into
   * the saved scene or the undo history. Enforced per frame by
   * `EditorViewport.update` (the glTF loads async and entity rebuilds replace
   * the THREE.LOD instance, so a one-shot apply would silently un-pin).
   */
  protected _lodForcedLevels = new Map<string, number>();

  get lodForcedLevels(): ReadonlyMap<string, number> {
    return this._lodForcedLevels;
  }

  getLodForcedLevel(id: string): number | null {
    return this._lodForcedLevels.get(id) ?? null;
  }

  /** Pin an entity's viewport LOD display to one level, or `null` for Auto
   * (distance-based selection — the renderer's own `LOD.update(camera)`). */
  setLodForcedLevel(id: string, level: number | null): void {
    if (level === null) {
      this._lodForcedLevels.delete(id);
      // Hand control back to the renderer's distance-based selection.
      const obj = this._objectMap.get(id);
      const projectedObjects = new Set(this._objectMap.values());
      const lodObj = obj ? findEntityLod(obj, (node) => projectedObjects.has(node)) : null;
      if (lodObj) lodObj.autoUpdate = true;
    } else {
      this._lodForcedLevels.set(id, level);
    }
    this._notify();
  }

  // --- Transform mode ---
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

  snapSelectionToFloor(): void {
    this._emitViewportAction({ type: 'snap-selection-to-floor' });
  }

  setPivotMode(mode: PivotMode): void {
    this._pivotMode = mode;
    this._notify();
  }

  setGizmoAnchor(anchor: GizmoAnchor): void {
    this._gizmoAnchor = anchor;
    this._notify();
  }

  toggleGrid(): void {
    this._showGrid = !this._showGrid;
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

  toggleStats(): void {
    this._showStats = !this._showStats;
    this._notify();
  }

  setShadingMode(mode: ShadingMode): void {
    this._shadingMode = mode;
    // View-only state. The viewport applies it during its own render and
    // restores native materials before returning to editor/game code.
    this._notify();
  }

  // --- Subclass hooks -------------------------------------------------------
  // The ONLY way the shell reaches into a document half. Each is a no-op here,
  // so the shell runs standalone; a subclass that owns a document overrides the
  // ones it needs (`store-notify-scope.test.ts` exercises the deferral hooks).

  /** Runs at the top of every `_notify()`. A document half uses it to close a
   *  pending history edit. */
  protected _beforeNotify(): void {}

  /** Runs after `attachHistory` binds the project `HistoryService`. A document
   *  half uses it to register its document resource driver. */
  protected _onHistoryAttached(): void {}

  /** Captured into the adoption frame by `enterPlayScene`, handed back by
   *  `exitPlayScene`. A document half snapshots its metadata here so
   *  play-time edits to it are discarded on exit. */
  protected _captureAdoptionExtras(): unknown {
    return undefined;
  }

  /** Restore counterpart of {@link _captureAdoptionExtras}. */
  protected _restoreAdoptionExtras(_extras: unknown): void {}

  /** Runs when `setPlayState('stopped')` ends an active play/ingest session.
   *  A document half applies mutations it deferred while play was running. */
  protected _onPlayStopped(): void {}

  /** Extra keys folded into the periodic editor-state save. A document half
   *  contributes whatever it needs restored on the next boot. */
  protected _editorStateExtras(): Record<string, unknown> {
    return {};
  }
}
