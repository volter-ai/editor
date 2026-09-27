/**
 * THE WORKBENCH'S WORKSPACE STORAGE, as the frame hands it over at mount: Code-OSS's own
 * `IStorageService` at `StorageScope.WORKSPACE`, which the web workbench keeps in the project's
 * folder (`.vgai/workbench-storage.json`, the fork's `workspaceStorageUrl`). A host without the
 * frame installs none, and the project-local layer keeps its own file.
 */
export interface WorkspaceStorageProvider {
  get(key: string): string | undefined;
  /** `undefined` removes the key. */
  store(key: string, value: string | undefined): void;
  /** Resolves once every change the workbench holds (its own layout included) has reached the
   *  project's folder. The session's end waits on it: the server stops listening moments after
   *  the page acknowledges, so a write left for the page's unload never lands. */
  flush(): Promise<void>;
}

let provider: WorkspaceStorageProvider | null = null;
const listeners = new Set<() => void>();

export function setWorkspaceStorageProvider(next: WorkspaceStorageProvider | null): void {
  provider = next;
  for (const listener of listeners) listener();
}

export function workspaceStorageProvider(): WorkspaceStorageProvider | null {
  return provider;
}

/** Fires when the provider is installed or removed. */
export function onWorkspaceStorageProvider(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
