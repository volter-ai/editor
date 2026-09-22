/**
 * THE AUTHORED VIEWPORT'S DOOR — the host's side of `host.viewport` (WORK.md
 * §Play leaves the host, P2). Every mounted 3D STAGE binds its rig and its
 * presenter here under its own document id (ARCHITECTURE-CORE §One stage:
 * there is one stage host, mounted once per 3D document, and the door is per
 * stage) and drives its frame hook from its own RAF loop; the lanes that
 * mount something (Play's adoption of the live scene, the play-entry camera
 * flight) read here and never hold a panel.
 *
 * The SINGULAR members — `viewportRig`, `presentViewportRoots`,
 * `setViewportHelper`, `onViewportFrame` — resolve THE PRIMARY STAGE at call
 * time: the stage presenting live roots if one is, else the FOCUSED stage
 * (`activeWorkspaceDocumentId()`'s), else the first bound. Focus and
 * presentation are the two facts; nothing here is "the scene viewport" by
 * name. `viewportStages()` is every stage, for the lane that must touch each
 * one (a helper `Object3D` has one parent, so it is set per stage).
 *
 * Until the lanes move, the host's own lanes import this registry directly; a
 * package reads `@volter/editor-sdk/host`'s `viewport` member, which is this.
 */

import type { EditorHostStage, ViewportPresentation, ViewportRig } from '@volter/editor-sdk/host';
import type { ViewportRoot } from '@volter/editor-sdk/host';
import type * as THREE from 'three';
import { activeWorkspaceDocumentId } from './workspace-document-registry';

type Presenter = (roots: readonly ViewportRoot[]) => ViewportPresentation | null;
type HelperSink = (kind: string, object: THREE.Object3D | null) => void;

interface Binding {
  readonly documentId: string;
  readonly rig: ViewportRig;
  readonly present: Presenter;
  readonly setHelper: HelperSink;
  readonly frameListeners: Set<(dtSeconds: number) => void>;
  /** Helpers set on THIS stage by kind, so a re-bind restores them. */
  readonly helpers: Map<string, THREE.Object3D | null>;
  /** A presentation of live roots is alive on this stage right now. */
  presenting: boolean;
}

/** Every bound stage, keyed by the document it draws; insertion-ordered, so
 *  "the first bound" is a real answer. */
const bound = new Map<string, Binding>();
/**
 * What belongs to the STAGE rather than to its current canvas, held by
 * document id so it OUTLIVES a binding: its frame subscribers and its
 * helpers. A stage's viewport remounts (a dock re-layout, HMR) without its
 * baked navmesh having to be re-baked — the `setHelper` contract the SDK
 * states — and without a lane's `onFrame` going quiet.
 */
const stageStateByDocument = new Map<
  string,
  {
    readonly frameListeners: Set<(dtSeconds: number) => void>;
    readonly helpers: Map<string, THREE.Object3D | null>;
  }
>();

function stageStateFor(documentId: string): {
  readonly frameListeners: Set<(dtSeconds: number) => void>;
  readonly helpers: Map<string, THREE.Object3D | null>;
} {
  let state = stageStateByDocument.get(documentId);
  if (!state) {
    state = { frameListeners: new Set(), helpers: new Map() };
    stageStateByDocument.set(documentId, state);
  }
  return state;
}
/** Listeners on the singular `onViewportFrame`: they follow the PRIMARY
 *  stage, so they are held here and fanned in rather than added to a
 *  binding's own set, which would strand them on a stage that stops being
 *  primary (or unmounts). */
const primaryFrameListeners = new Set<(dtSeconds: number) => void>();
const stageListeners = new Set<(stages: readonly EditorHostStage[]) => void>();

/** THE PRIMARY STAGE: presenting live roots > focused > first bound. */
function primary(): Binding | null {
  for (const binding of bound.values()) if (binding.presenting) return binding;
  const focused = activeWorkspaceDocumentId();
  if (focused !== null) {
    const match = bound.get(focused);
    if (match) return match;
  }
  return bound.values().next().value ?? null;
}

let stagesCache: readonly EditorHostStage[] | null = null;

function notifyStages(): void {
  stagesCache = null;
  const snapshot = viewportStages();
  for (const fn of stageListeners) fn(snapshot);
}

/** A stage door resolves its binding BY ID on every call, so a door held
 *  across that stage's remount keeps driving the live canvas rather than the
 *  disposed one. */
function stageDoor(documentId: string, rig: ViewportRig): EditorHostStage {
  const state = stageStateFor(documentId);
  return {
    documentId,
    rig: () => bound.get(documentId)?.rig ?? rig,
    setHelper: (kind, object) => {
      state.helpers.set(kind, object);
      bound.get(documentId)?.setHelper(kind, object);
    },
    onFrame: (fn) => {
      state.frameListeners.add(fn);
      return () => {
        state.frameListeners.delete(fn);
      };
    },
  };
}

/** A mounted stage binds its rig, how it presents live roots and how it shows
 *  a helper, under the id of the document it draws; the return unbinds (a
 *  re-bind for the same id REPLACES, and a stale binding's unbind never
 *  removes its successor). Helpers set through the singular door before the
 *  bind are applied now, the way they always were — but "before the bind" is
 *  now per stage: a helper shown on THIS document's stage returns to it, and
 *  a helper set while nothing is bound anywhere is dropped rather than
 *  appearing on whichever stage happens to mount next. */
export function bindViewportRig(
  rig: ViewportRig,
  present: Presenter,
  setHelper: HelperSink,
  options: { readonly documentId: string },
): () => void {
  const state = stageStateFor(options.documentId);
  const next: Binding = {
    documentId: options.documentId,
    rig,
    present,
    setHelper,
    frameListeners: state.frameListeners,
    helpers: state.helpers,
    presenting: false,
  };
  bound.set(options.documentId, next);
  for (const [kind, object] of next.helpers) setHelper(kind, object);
  notifyStages();
  return () => {
    if (bound.get(options.documentId) !== next) return;
    bound.delete(options.documentId);
    notifyStages();
  };
}

/** Show (or clear with null) the editor-only helper of `kind` on the PRIMARY
 *  stage. A helper wanted on every stage is set per stage through
 *  {@link viewportStages} — an `Object3D` has one parent. */
export function setViewportHelper(kind: string, object: THREE.Object3D | null): void {
  const stage = primary();
  if (!stage) return;
  stage.helpers.set(kind, object);
  stage.setHelper(kind, object);
}

export function viewportRig(): ViewportRig | null {
  return primary()?.rig ?? null;
}

export function presentViewportRoots(roots: readonly ViewportRoot[]): ViewportPresentation | null {
  const stage = primary();
  if (!stage) return null;
  const presentation = stage.present(roots);
  if (!presentation) return null;
  // The stage stays PRIMARY for as long as it is showing live roots — that is
  // what makes Play's own camera flight and frame hook keep finding it while
  // focus moves to the live document.
  stage.presenting = true;
  let released = false;
  return {
    worldId: presentation.worldId,
    dispose: () => {
      if (!released) {
        released = true;
        stage.presenting = false;
      }
      presentation.dispose();
    },
  };
}

/** Runs after the PRIMARY stage's own per-frame update, and RE-TARGETS: the
 *  listener follows whichever stage is primary, not the one that was primary
 *  when it subscribed. */
export function onViewportFrame(fn: (dtSeconds: number) => void): () => void {
  primaryFrameListeners.add(fn);
  return () => {
    primaryFrameListeners.delete(fn);
  };
}

/** Every bound stage, in bind order. */
export function viewportStages(): readonly EditorHostStage[] {
  if (!stagesCache)
    stagesCache = [...bound.values()].map((binding) => stageDoor(binding.documentId, binding.rig));
  return stagesCache;
}

/**
 * WHICH HELPER KINDS A STAGE IS HOLDING — the kinds something has actually
 * shown on it through `setHelper` (`@volter/editor-sdk/host`,
 * `EditorHostStage.setHelper`), cleared ones excluded.
 *
 * It exists because a 3D document's own OVERLAYS MENU must follow what the
 * document put there and nothing else (`Object3DDocumentToolbar`): Blender's
 * viewport overlay popover lists Bones, and ours may not list a Bones row over
 * a document that has no bones to show. Same rule as the Outliner's restriction
 * columns — a control follows what the thing behind it ANSWERS, never a knob.
 */
export function viewportStageHelperKinds(documentId: string): readonly string[] {
  const state = stageStateByDocument.get(documentId);
  if (!state) return [];
  return [...state.helpers].filter(([, object]) => object !== null).map(([kind]) => kind);
}

export function onViewportStages(fn: (stages: readonly EditorHostStage[]) => void): () => void {
  stageListeners.add(fn);
  return () => {
    stageListeners.delete(fn);
  };
}

/** A stage's RAF loop calls this after its own update each frame. The stage's
 *  own listeners always run; the primary-stage listeners run here only when
 *  this stage IS the primary. */
export function runViewportFrame(documentId: string, dtSeconds: number): void {
  const binding = bound.get(documentId);
  if (!binding) return;
  for (const fn of binding.frameListeners) fn(dtSeconds);
  if (primary() === binding) for (const fn of primaryFrameListeners) fn(dtSeconds);
}
