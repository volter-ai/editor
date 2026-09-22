/**
 * WHAT THE GIZMO VIEWPORT ASKS THE SHELL — the one collaborator
 * `editor-viewport.ts` declares and the shell installs at boot.
 *
 * ARCHITECTURE-CORE §Editor chrome, "The viewport stack is separable": a
 * surface below the shell never imports the shell's transport, a world
 * authoring adapter, or project discovery. The viewport was importing six
 * `authoring/` modules to ask four questions —
 *
 *   · which adapter am I driving, and which one do the shared panels drive?
 *   · what is under the pointer?
 *   · which native root owns the current selection, and is it painted here?
 *   · which three root is world-hidden, and how do I apply that?
 *
 * — and every one of those answers is a COMPOSITE fact. `layered-pick.ts`
 * walks `CompositeAuthoringAdapter.childAdapters()` in manifest z-order;
 * `panel-authoring.ts` reaches the workspace-document registry;
 * `world-hidden-viewport.ts` and `viewport-tool-context.ts` resolve the
 * composite's live three child. The viewport itself knows about none of that:
 * it raycasts a scene and drags a gizmo. Measured, those six edges were 96 of
 * its 193 files.
 *
 * ## The default is the NO-SHELL answer, and it is deliberate
 *
 * {@link DEFAULT_VIEWPORT_AUTHORING_POLICY} is what a viewport mounted with no
 * shell above it (a bounded host; a fixture) gets: no composite exists,
 * so there are no layers to walk, no other panel to agree with, no world-group
 * eye to honour. Each default states that outright rather than half-answering.
 * The ONE default that is real logic is {@link adapterOnlyToolOwner} — the
 * structural single-adapter fallback `resolveViewportToolContext` already used
 * for non-composite adapters, which lives here now and is imported BACK by
 * `authoring/viewport-tool-context.ts` so there is one copy of it.
 *
 * In the editor the shell policy is installed once by `EditorProvider`
 * (`EditorContext.tsx`), before any viewport mounts — including the Asset Lab
 * document's own, which is why that document keeps today's behaviour exactly.
 * The install site is the PROVIDER rather than `the world root's stage` because a
 * workspace can have an Asset Lab document open with no scene the world root's stage
 * mounted at all, and that document's viewport must not silently fall to the
 * defaults.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type * as THREE from 'three';
import { makeNoAuthoringAdapter } from './authoring/no-authoring-adapter';
import type { EditorShellStore } from './editor-shell-store';

/**
 * The native root whose viewport tools may claim the current selection, as far
 * as the viewport cares: its KIND (only `three` lets the 3D chrome claim the
 * surface) and its manifest root id (`null` for a single-adapter session).
 *
 * `authoring/viewport-tool-context.ts`'s `ViewportToolContext` is this plus the
 * adapter, and is structurally assignable to it.
 */
export interface ViewportToolOwner {
  readonly worldId: string | null;
  readonly kind: string;
}

export interface ViewportAuthoringPolicy {
  /** The adapter this viewport drives when its host injected none. */
  activeAuthoring(store: EditorShellStore): AuthoringAdapter;
  /**
   * The adapter a selection SCOPE is keyed on — the Hierarchy's own resolution,
   * so a viewport drill-in and the panel breadcrumb name the same scope.
   */
  panelAuthoring(store: EditorShellStore): AuthoringAdapter;
  /** Topmost-first hit test across every visible, pick-unlocked layer. */
  pick(
    store: EditorShellStore,
    clientX: number,
    clientY: number,
    intent: 'normal' | 'deep',
  ): string | null;
  /** Which native root the selection resolves to, or `null` for empty,
   *  organizational and cross-root selections. */
  toolOwner(adapter: AuthoringAdapter, selectedIds: Iterable<string>): ViewportToolOwner | null;
  /** Is that owner's surface actually PAINTED in this viewport right now? */
  toolOwnerPainted(store: EditorShellStore, owner: ViewportToolOwner | null): boolean;
  /** Is a THREE stage painted here at all, selection or not — the gate for
   *  the grid and axis lines (Blender's floor is persistent; only the gizmos
   *  need an owner). */
  threeSurfaceShowing(store: EditorShellStore, adapter: AuthoringAdapter): boolean;
  /** The one three world rendered here, for the world-hidden eye. */
  threeViewportRootId(store: EditorShellStore): string | null;
  /** Apply the eye to every entity object (a no-op unless that root is hidden). */
  applyRootHiddenVisibility(
    objectMap: ReadonlyMap<string, THREE.Object3D>,
    threeRootId: string | null,
  ): void;
  /** The scene-level half of the eye: background, fog, IBL, env objects. */
  suppressRootEnvironment(scene: THREE.Scene): void;
}

/**
 * Viewport-tool ownership for a SINGLE adapter — no composite, no manifest kind
 * metadata to read.
 *
 * Structural and conservative, unchanged from where it was written
 * (`authoring/viewport-tool-context.ts`, which now imports it): a rect-capable
 * selection is DOM; a selection whose every node resolves to an `Object3D` is
 * three; anything else advertises no kind-specific chrome rather than guessing.
 * It speaks only the adapter contract, which is why it can be the default here.
 */
export function adapterOnlyToolOwner(
  adapter: AuthoringAdapter,
  selectedIds: Iterable<string>,
): ViewportToolOwner | null {
  const ids = [...selectedIds];
  if (ids.length === 0) return null;
  if (ids.some((id) => adapter.hierarchy.node(id) === null)) return null;
  if (adapter.rects) return { worldId: null, kind: 'dom' };
  if (ids.every((id) => adapter.hierarchy.object3D?.(id) != null)) {
    return { worldId: null, kind: 'three' };
  }
  return null;
}

/** Memoized per store, because the viewport calls `activeAuthoring` per gesture
 *  and adapter IDENTITY keys the selection scope and the handle cache. Mirrors
 *  `authoring/active-adapter.ts`'s own per-store memo. */
const _noAuthoringByStore = new WeakMap<EditorShellStore, AuthoringAdapter>();

export const DEFAULT_VIEWPORT_AUTHORING_POLICY: ViewportAuthoringPolicy = {
  activeAuthoring(store) {
    let adapter = _noAuthoringByStore.get(store);
    if (!adapter) {
      adapter = makeNoAuthoringAdapter(store, 'No authoring adapter');
      _noAuthoringByStore.set(store, adapter);
    }
    return adapter;
  },
  panelAuthoring(store) {
    // No shell means no shared panels to agree with.
    return DEFAULT_VIEWPORT_AUTHORING_POLICY.activeAuthoring(store);
  },
  pick() {
    // No shell means no layer stack to walk. A host that mounts this viewport
    // for one document supplies its own hit test (`EditorViewportOptions.pick`),
    // which is what the Asset Lab document does.
    return null;
  },
  toolOwner: adapterOnlyToolOwner,
  toolOwnerPainted() {
    // No world-group eyes exist without a composite, so nothing can be hidden.
    return true;
  },
  threeSurfaceShowing(_store, adapter) {
    return !adapter.rects && typeof adapter.hierarchy.object3D === 'function';
  },
  threeViewportRootId() {
    return null;
  },
  applyRootHiddenVisibility() {
    // Unreachable while `threeViewportRootId` is null — stated rather than
    // implemented, so the no-shell story is one story.
  },
  suppressRootEnvironment() {},
};

let _policy: ViewportAuthoringPolicy = DEFAULT_VIEWPORT_AUTHORING_POLICY;

/**
 * Install the shell's composition. One owner, same rule as the store's
 * `attachHistory`/`attachStatePersistence`: re-installing the SAME policy is a
 * no-op (React strict-mode double-invokes the provider body), a DIFFERENT one
 * throws rather than letting two shells disagree about what is under a pointer.
 */
export function installViewportAuthoringPolicy(policy: ViewportAuthoringPolicy): void {
  if (_policy === policy) return;
  if (_policy !== DEFAULT_VIEWPORT_AUTHORING_POLICY) {
    throw new Error('A viewport authoring policy is already installed.');
  }
  _policy = policy;
}

/** The installed policy, or the no-shell default. */
export function viewportAuthoringPolicy(): ViewportAuthoringPolicy {
  return _policy;
}

/** Test seam: drop the installed policy. */
export function __resetViewportAuthoringPolicyForTest(): void {
  _policy = DEFAULT_VIEWPORT_AUTHORING_POLICY;
}
