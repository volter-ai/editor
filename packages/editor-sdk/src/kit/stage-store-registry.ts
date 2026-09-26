import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
/**
 * WHICH STORE A STAGE RUNS ON — the live identities behind
 * `focusedStageStore()` (`stage-context.ts`).
 *
 * ARCHITECTURE-CORE §One stage: no stage is on "the" store by birthright.
 * Every mounted stage owns an `EditorShellStore` holding its own per-stage
 * state — selection, scene/objectMap, camera pose, orbit target, tool state
 * and view options — and the shared panels read whichever one the FOCUSED
 * document's stage runs on. Before this, only one stage's store was reachable
 * (the shell's), so a control mounted over a model or a prefab drove a
 * different stage's state: the grid button toggled the world's grid, and the
 * camera readout reported a camera nobody was looking through.
 *
 * A registry of live identities, deliberately shaped like
 * `authoring/object3d-document-session-registry.ts` — the same job for the
 * same objects, and the reason it is not merged into that module is that a
 * stage has a store BEFORE it has a session (the world root's stage has no
 * `Object3DDocumentSession` at all, measured 2026-09-18). A leaf module with
 * no imports beyond the store's type, so any lane may read it without an
 * import cycle.
 */

const stores = new Map<string, { store: ShellStore }>();
let registryVersion = 0;
const listeners = new Set<() => void>();

function notify(): void {
  registryVersion++;
  for (const listener of [...listeners]) listener();
}

/** A mounted stage declares the store it runs on. Re-registering the same
 *  document replaces it; the returned unregister drops it. */
export function registerStageStore(documentId: string, store: ShellStore): () => void {
  const registration = { store };
  stores.set(documentId, registration);
  notify();
  return () => {
    if (stores.get(documentId) !== registration) return;
    stores.delete(documentId);
    notify();
  };
}

/** The store that document's stage runs on, or `null` for a document with no
 *  stage of its own (a tool tab, a text document, the Game tab). */
export function stageStore(documentId: string | null): ShellStore | null {
  return documentId === null ? null : (stores.get(documentId)?.store ?? null);
}

/** The document whose stage runs on `store`, or null for a store no stage registered. */
export function stageDocument(store: ShellStore): string | null {
  for (const [documentId, registration] of stores) if (registration.store === store) return documentId;
  return null;
}

/** `useSyncExternalStore` shape — a stage mounting or unmounting changes what
 *  `focusedStageStore()` answers, so a panel that reads it subscribes here. */
export function subscribeStageStores(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function stageStoresVersion(): number {
  return registryVersion;
}
