/** A shell store's Three half (`threeStateOf`, beside the half in `editor-shell-store.ts`). */
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { type EditorShellStore, threeStateOf } from './editor-shell-store';
import { useEditorStore, useOptionalEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import { onShellStore, shellStoreForHost } from '@volter/editor-sdk/kit/shell-store-door';

export { threeStateOf };

/** {@link threeStateOf} for a store that may be absent (outside a session). */
export function optionalThreeStateOf(store: ShellStore | null): EditorShellStore | null {
  return store === null ? null : threeStateOf(store);
}

/** The session store's Three half (`threeStateOf`), for a component that reads the scene,
 *  object map, camera or viewport tools. */
export function useThreeEditorStore(): EditorShellStore {
  return threeStateOf(useEditorStore());
}

/** {@link useThreeEditorStore} outside a session answers `null`. */
export function useOptionalThreeEditorStore(): EditorShellStore | null {
  return optionalThreeStateOf(useOptionalEditorStore());
}

/** The session store's Three half (`three-state.ts`), or `null` before a session opens. */
export function threeStoreForHost(): EditorShellStore | null {
  return optionalThreeStateOf(shellStoreForHost());
}

/** {@link onShellStore} for a lane that works on the store's Three half. */
export function onThreeStore(listener: (store: EditorShellStore) => void): () => void {
  return onShellStore((store) => listener(threeStateOf(store)));
}
