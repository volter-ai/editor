/** A shell store's Three half (`threeStateOf`, beside the half in `editor-shell-store.ts`). */
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { type EditorShellStore, threeStateOf } from './editor-shell-store';

export { threeStateOf };

/** {@link threeStateOf} for a store that may be absent (outside a session). */
export function optionalThreeStateOf(store: ShellStore | null): EditorShellStore | null {
  return store === null ? null : threeStateOf(store);
}
