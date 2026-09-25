/**
 * THE PROJECT'S FILES, WRITTEN THROUGH THE WORKBENCH — the provider it
 * installs here, and the window before it lands.
 *
 * `EditorHost.files` is the door (`packages/editor/src/files/`) —
 * read/readBytes/write/exists/list/watch over PROJECT-RELATIVE paths, the same
 * spelling the history door hands over, so both resolve against one workspace
 * folder.
 *
 * WHAT THE PROVIDER BUYS, measured (U5): a vgai write the workbench did not
 * make is an EXTERNAL change to it — Monaco reloads the file,
 * `modelService.updateModel` pushes a fresh text element through `EditStack`,
 * and `IUndoRedoService.pushElement` clears that resource's FUTURE, so a gizmo
 * drag's redo was lost whenever a text model for that file was open. A write
 * made THROUGH the workbench is the workbench's own, so no reload fires and
 * the future survives. That is what this buys, and nothing else.
 *
 * IT ARRIVES AFTER THE MOUNT, always: a `ServicesAccessor` is valid only for
 * the synchronous part of a command, so the contribution cannot build the
 * provider before the mount it is handed to. Until it does, the door falls
 * back to the session's transports — a write in that window is a real write
 * with nowhere else to go.
 */
import type { EditorHostFileEvent, EditorHostFileProvider } from '@volter/editor-sdk/host';

export type ProjectFileEvent = EditorHostFileEvent;
export type ProjectFileProvider = EditorHostFileProvider;

let provider: ProjectFileProvider | null = null;
const listeners = new Set<() => void>();

/**
 * Is the provider installed? False until it lands — later than the mount,
 * because a `ServicesAccessor` is valid only for a command's synchronous part,
 * so the contribution hands the provider over after the editor is running. In
 * that window a caller reaches the session's transports instead, which is a
 * real write with nowhere else to go rather than a refusal.
 */
export function filesProviderInstalled(): boolean {
  return provider !== null;
}

/** The installed provider, or `null` before it lands. */
export function filesProvider(): ProjectFileProvider | null {
  return provider;
}

/**
 * Install how the project's files are read and written, or `null` to withdraw
 * it — the provider is the workbench's, and a workbench that went away takes
 * it with it.
 */
export function setFilesProvider(next: ProjectFileProvider | null): void {
  if (provider === next) return;
  provider = next;
  for (const listener of listeners) listener();
}

export function subscribeFilesProvider(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
