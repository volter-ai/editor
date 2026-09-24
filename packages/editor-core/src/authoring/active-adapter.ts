/**
 * The editor's active {@link AuthoringAdapter} handle.
 *
 * The editor UI talks to the authoring contract through THIS accessor rather than
 * reaching into `EditorShellStore` or any adapter's private model directly. The accessor names no
 * concrete adapter: a SURFACE's live adapter is REGISTERED by the integration
 * that owns that surface's document model ({@link setBaseAuthoringFactory}), an
 * ingest/play/edit-mode session can override it globally, and the UI code below
 * it does not change either way.
 *
 * The adapter is a stateless delegating wrapper over the store, so we memoize one
 * per store (a store's identity is stable for the editor session).
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { inspectAuthoringAdapterSeams } from '@volter/editor-sdk/kit/authoring-seam-evidence';
import type { EditorShellStore } from '../editor-shell-store';
import type { ShellDocumentState } from '../shell-document-state';
import { makeNoAuthoringAdapter } from './no-authoring-adapter';

const byStore = new WeakMap<ShellDocumentState, AuthoringAdapter>();

/**
 * The LIVE authoring adapter a declared world of one surface gets: the
 * projection over whatever that surface has actually mounted, as opposed to
 * the manifest-only `BoundaryAuthoringAdapter` a surface with no registration
 * falls back to.
 *
 * The key is the world's `surface` (`three`, `canvas`, `dom`, …) because that
 * is what decides which projection can read it, and the factory is a
 * PACKAGE's code rather than a store's state — it takes the store as an
 * argument. (It was keyed per STORE until 2026-09-21 and had no caller at all:
 * `getActiveAuthoring` read a map nothing ever wrote. Its one real caller is
 * `edit-mode-authoring.ts`'s installer, which is what this shape is for.)
 */
export type BaseAuthoringFactory = (store: EditorShellStore, worldId: string) => AuthoringAdapter;

const baseFactoryBySurface = new Map<string, BaseAuthoringFactory>();

/**
 * Register the live authoring adapter for one SURFACE. Returns the unregister.
 *
 * A registration arriving LATE is ordinary: the contribution pass that loads
 * an integration is deferred behind the first viewport frame, so the
 * edit-mode composite is routinely installed before it. The registrant asks
 * for a rebuild (`queueEditModeRebuild`) — the same door a source change uses
 * — rather than this seam growing a notification of its own.
 */
export function setBaseAuthoringFactory(
  surface: string,
  factory: BaseAuthoringFactory,
): () => void {
  baseFactoryBySurface.set(surface, factory);
  return () => {
    if (baseFactoryBySurface.get(surface) === factory) baseFactoryBySurface.delete(surface);
  };
}

/** The registered live adapter factory for `surface`, or null. */
export function baseAuthoringFactory(surface: string): BaseAuthoringFactory | null {
  return baseFactoryBySurface.get(surface) ?? null;
}

/**
 * A non-first-party adapter (today: the ingest adapter for an unmodified game)
 * that, while set, becomes the active authoring adapter. The editor renders its
 * adapter-driven (format-neutral) hierarchy/inspector panels instead of the
 * base adapter's while an override is active.
 */
let _override: AuthoringAdapter | null = null;

/**
 * Change notification for the override slot.
 *
 * The slot is module state the shared panels READ every render, so it must
 * tell them when it changes. Relying on a side effect instead is the trap:
 * every ingest entry path also calls `store.setActiveViewportTab(…)`, which
 * in a project WITH a Three root activates a different center document and
 * the workspace-document registry's own `notifyChanged()` re-renders the
 * panels for free. In a project with NO Three root there is exactly one
 * center document (`workspace:game`), that activation is a no-op, nothing
 * notifies, and the Hierarchy/Inspector keep rendering the adapter they
 * resolved BEFORE the ingest session installed its own — `getAuthoringOverride()`
 * returns the right adapter with `{transform, inspectorFields, persist}` all
 * true while the panels still show "No authoring adapter". A stale render,
 * not a resolution error.
 *
 * So the slot notifies for itself and the panels subscribe. One mechanism,
 * no per-session choreography.
 */
const _listeners = new Set<() => void>();
let _version = 0;

/** Subscribe to override changes (`useSyncExternalStore` shape). */
export function subscribeActiveAuthoring(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Monotonic version of the override slot (`useSyncExternalStore` snapshot). */
export function activeAuthoringVersion(): number {
  return _version;
}

/** Install/clear the active authoring override (ingest enters/exits). */
export function setActiveAuthoring(adapter: AuthoringAdapter | null): void {
  if (_override === adapter) return;
  if (adapter) {
    const evidence = inspectAuthoringAdapterSeams({ adapter, subject: 'active-authoring' });
    const failures = [evidence.hierarchy, ...Object.values(evidence.providers)].filter(
      (verdict) => verdict.state === 'failed',
    );
    if (failures.length > 0) {
      throw new Error(
        `authoring adapter refused: ${failures.map((failure) => failure.detail).join('; ')}`,
      );
    }
  }
  _override = adapter;
  _version++;
  for (const listener of [..._listeners]) listener();
}

/** True when a non-first-party adapter is driving authoring (e.g. ingest). */
export function hasAuthoringOverride(): boolean {
  return _override !== null;
}

/**
 * Brand for the edit-mode composite (`edit-mode-authoring.ts`). Unlike an
 * ingest/play override — a FOREIGN adapter whose document the store does not
 * own — the edit-mode composite's FOCUSED child writes through the store's
 * own save path, so
 * the store's save guard (`_blockedForSave`) must NOT block it: an edit to the
 * focused world must Ctrl+S/autosave to disk exactly like a single-scene
 * project. The brand lives on the composite instance and disappears the moment
 * `setActiveAuthoring(null)` clears the slot (the predicate checks the CURRENT
 * `_override`'s identity), so no separate lifecycle state can go stale.
 */
const EDIT_MODE_BRAND = Symbol('vgai.editModeComposite');

/** Mark `adapter` as the edit-mode composite. */
export function markEditModeOverride(adapter: AuthoringAdapter): void {
  (adapter as unknown as Record<symbol, unknown>)[EDIT_MODE_BRAND] = true;
}

/** True when the ACTIVE override is the edit-mode composite — the store's
 *  save guard allows the focused first-party child to persist through it. */
export function activeOverrideIsEditMode(): boolean {
  return (
    _override !== null &&
    (_override as unknown as Record<symbol, unknown>)[EDIT_MODE_BRAND] === true
  );
}

/**
 * Peek the raw override slot (or null) without a store handle — for a session
 * that needs to install ITS OWN override while preserving whatever was active
 * before it, so it can restore that exact value on exit instead of assuming
 * null (e.g. play-mode's ephemeral-persistence wrapper).
 */
export function getAuthoringOverride(): AuthoringAdapter | null {
  return _override;
}

/** Every node id in an adapter's hierarchy (for select-all over an ingested tree). */
export function collectAllNodeIds(adapter: AuthoringAdapter): string[] {
  const ids: string[] = [];
  const walk = (node: { id: string; childIds: string[] }): void => {
    ids.push(node.id);
    for (const cid of node.childIds) {
      const c = adapter.hierarchy.node(cid);
      if (c) walk(c);
    }
  };
  for (const r of adapter.hierarchy.roots()) walk(r);
  return ids;
}

/**
 * The authoring adapter the editor UI should drive for `store`.
 *
 * The floor is HONEST and not a fallback factory: a store nothing has claimed
 * has no document model, and inventing one for it is what the no-authoring
 * adapter exists to refuse. Who DOES claim it is `setActiveAuthoring` (the
 * edit-mode composite, an ingest session, play) — a live adapter for a
 * declared world is asked for by SURFACE through {@link baseAuthoringFactory},
 * which is a different question from "what does this store fall back to".
 */
export function getActiveAuthoring(store: ShellDocumentState): AuthoringAdapter {
  if (_override) return _override;
  let a = byStore.get(store);
  if (!a) {
    a = makeNoAuthoringAdapter(store, 'No authoring adapter');
    byStore.set(store, a);
  }
  return a;
}
