/**
 * `StorageBackend`, answered by the WORKBENCH'S OWN FILE SERVICE (U5).
 *
 * ARCHITECTURE-CORE §The core is Code-OSS: *"the storage backends → file
 * system providers, the dev server as one provider"*. What that turned out to
 * mean, measured: both product shapes already have a real file service over
 * the project folder (desktop's disk provider, the REH's `vscode-remote://`),
 * so there is nothing to PROVIDE — the door CALLS what exists
 * (`files/project-files.ts` states the decision and the reason).
 *
 * This class is how the existing `StorageBackend` callers — forty-odd of
 * them, from the asset browser to the provenance ledger — reach that file
 * service without one of them changing. It is a DECORATOR, not a fourth
 * backend: it overrides exactly the three operations where "is this the
 * workbench's own write?" is a question that has an answer (`read`,
 * `readBytes`, `write`) and delegates everything else to the tier's real
 * backend. `remove`, `mkdir`, `stat`, `list` and `watch` are the session's
 * still, because the file door deliberately carries no remove/mkdir — a
 * member nobody reads is cut, and nothing in the frame needs them yet.
 *
 * THE ROOT DIFFERENCE IS THE WHOLE JOB. `StorageBackend`'s paths on the server
 * tier are rooted at `<project>/public/` (`http-storage.ts`'s header) while
 * the file door's are PROJECT-RELATIVE, because that is the spelling the frame
 * can resolve against its workspace folder. This class is the `public/` view:
 * one prefix, in one place, instead of forty callers learning a second
 * spelling.
 */

import { projectFiles } from '../files/project-files';
import type { DirEntry, Stat, StorageBackend, WatchCallback } from '@volter/editor-sdk/kit/storage-types';

export class HostFilesStorage implements StorageBackend {
  readonly id: string;

  /**
   * @param inner the tier's own backend, which still owns every operation the
   *   file door does not carry — and which is also the FALLBACK while the
   *   frame has taken ownership but not yet installed its provider (the mount
   *   window `files/file-provider.ts` describes).
   * @param root the project-relative prefix these paths live under. Always
   *   `public` today; named rather than hardcoded so the prefix is visible at
   *   the call site that chose it.
   */
  constructor(
    private readonly inner: StorageBackend,
    private readonly root = 'public',
  ) {
    this.id = `frame:${inner.id}`;
  }

  private resolve(path: string): string {
    const key = path.replace(/\\/g, '/').replace(/^\/+/, '');
    return key ? `${this.root}/${key}` : this.root;
  }

  read(path: string): Promise<string> {
    return projectFiles.read(this.resolve(path));
  }

  readBytes(path: string): Promise<Uint8Array> {
    return projectFiles.readBytes(this.resolve(path));
  }

  write(path: string, data: string | Uint8Array): Promise<void> {
    return projectFiles.write(this.resolve(path), data);
  }

  async writeIfAbsent(path: string, data: string | Uint8Array): Promise<boolean> {
    if (await this.exists(path)) return false;
    await this.write(path, data);
    return true;
  }

  list(dir: string): Promise<DirEntry[]> {
    return this.inner.list(dir);
  }

  stat(path: string): Promise<Stat | null> {
    return this.inner.stat(path);
  }

  exists(path: string): Promise<boolean> {
    return projectFiles.exists(this.resolve(path));
  }

  mkdir(path: string): Promise<void> {
    return this.inner.mkdir(path);
  }

  remove(path: string): Promise<void> {
    return this.inner.remove(path);
  }

  watch(callback: WatchCallback): () => void {
    return this.inner.watch(callback);
  }
}
