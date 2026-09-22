/**
 * THE ONE SHELL STORE, as the lanes that run something reach it. The store is
 * created once per project session (`EditorContext.tsx`); the door is
 * installed at boot before any store exists, and Play, ingest and the module
 * lane bind themselves to the store on its ARRIVAL rather than being bound by
 * the workspace panel that happens to mount first (until 2026-09-17 both
 * `the world root's stage` and `NonThreeAuthoringBootstrap` named Play and ingest to
 * hand them the store). A leaf module with no imports, so a lane may subscribe
 * at its own module load without an import cycle.
 */
import type { EditorShellStore } from './editor-shell-store';

let shellStore: EditorShellStore | null = null;
const arrivals = new Set<(store: EditorShellStore) => void>();
const changeListeners = new Set<() => void>();

/** `EditorContext.tsx` registers the store it created. */
export function registerShellStoreForHost(store: EditorShellStore): void {
  shellStore = store;
  for (const listener of arrivals) listener(store);
  for (const listener of changeListeners) listener();
}

/** The current store, or null before a project session opens. */
export function shellStoreForHost(): EditorShellStore | null {
  return shellStore;
}

/** Runs on every store arrival — at once, when one is already registered. */
export function onShellStore(listener: (store: EditorShellStore) => void): () => void {
  arrivals.add(listener);
  if (shellStore) listener(shellStore);
  return () => {
    arrivals.delete(listener);
  };
}

/** Fires when the store is (re)registered; the door's `session.subscribe`
 *  composes this with the store's own subscription. */
export function onShellStoreChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
