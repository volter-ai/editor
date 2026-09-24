/**
 * Which Three half belongs to which shell store — a leaf module (type-only imports), so the
 * store door and a lane can ask at module load without an import cycle.
 *
 * Kit modules hand out the media-neutral `ShellStore`; Three code asks `threeStateOf` for its
 * own half. Today a session's store is its own Three half (`EditorShellStore` registers itself);
 * once the half is a companion owned by `@volter/editor-threejs`, the companion registers here.
 */
import type { EditorShellStore } from './editor-shell-store';
import type { ShellStore } from './shell-store';

const threeStates = new WeakMap<ShellStore, EditorShellStore>();

export function registerThreeState(store: ShellStore, three: EditorShellStore): void {
  threeStates.set(store, three);
}

/** The Three half of a shell store; refuses a store no Three stage was made for. */
export function threeStateOf(store: ShellStore): EditorShellStore {
  const three = threeStates.get(store);
  if (!three) throw new Error('This shell store has no Three state: no Three stage was created for it.');
  return three;
}

/** {@link threeStateOf} for a store that may be absent (outside a session). */
export function optionalThreeStateOf(store: ShellStore | null): EditorShellStore | null {
  return store === null ? null : threeStateOf(store);
}
