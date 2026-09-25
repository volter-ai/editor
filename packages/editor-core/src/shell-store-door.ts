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
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { optionalThreeStateOf, threeStateOf } from './three-state';

let shellStore: ShellStore | null = null;
const arrivals = new Set<(store: ShellStore) => void>();
const changeListeners = new Set<() => void>();

/** `EditorContext.tsx` registers the store it created. */
export function registerShellStoreForHost(store: ShellStore): void {
  shellStore = store;
  for (const listener of arrivals) listener(store);
  for (const listener of changeListeners) listener();
}

/** The current store, or null before a project session opens. */
export function shellStoreForHost(): ShellStore | null {
  return shellStore;
}

/** Runs on every store arrival — at once, when one is already registered. */
export function onShellStore(listener: (store: ShellStore) => void): () => void {
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

/** The session store's Three half (`three-state.ts`), or `null` before a session opens. */
export function threeStoreForHost(): EditorShellStore | null {
  return optionalThreeStateOf(shellStore);
}

/** {@link onShellStore} for a lane that works on the store's Three half. */
export function onThreeStore(listener: (store: EditorShellStore) => void): () => void {
  return onShellStore((store) => listener(threeStateOf(store)));
}
