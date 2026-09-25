/**
 * Storage backend selection — the `public/`-rooted file interface the editor's
 * asset surfaces read and write through.
 *
 * ONE TIER, two implementations, and the second is a decorator:
 *   - `HttpStorage`      — the session's own `/__editor/*` routes.
 *   - `HostFilesStorage` — the same view, written through `EditorHost.files`
 *                          so a write is the WORKBENCH's own (U5).
 * `MemStorage` is the design system's fixture backend and nothing else.
 *
 * Upstream code depends only on `StorageBackend` from `./types` and obtains
 * an instance via `getStorageBackend()`.
 */

import { getProjectDefinePath } from '../editor-mode';
import { filesProviderInstalled } from '../files/file-provider';
import { HostFilesStorage } from './host-files-storage';
import { HttpStorage } from './http-storage';
import type { StorageBackend } from '@volter/editor-sdk/kit/storage-types';

export { HttpStorage } from './http-storage';
export { MemStorage } from './mem-storage';
export type { DirEntry, HostCapabilities, Stat, StorageBackend, WatchEvent } from '@volter/editor-sdk/kit/storage-types';

let _backend: StorageBackend | null = null;
/** The tier's own backend, kept beside the active one so the frame decorator
 *  never becomes its own delegate — see {@link tierStorageBackend}. */
let _tier: StorageBackend | null = null;

/**
 * THE TIER'S OWN backend — never the frame decorator, and the only thing the
 * file door's host fill is allowed to stand on.
 *
 * Without this the fill would recurse: `projectFiles.read` falls back to
 * `getStorageBackend()`, which under the frame is `HostFilesStorage`, whose
 * `read` is `projectFiles.read`. One function, so the cycle cannot be written
 * by accident.
 */
export function tierStorageBackend(): StorageBackend {
  if (_backend && !(_backend instanceof HostFilesStorage)) return _backend;
  if (!_tier) _tier = new HttpStorage(getProjectDefinePath());
  return _tier;
}

/**
 * The active storage backend: the session's own, wrapped by the frame's file
 * door once its provider has landed.
 *
 * UNDER THE CODE-OSS FRAME the file system is the WORKBENCH'S, not the
 * session's (U5; ARCHITECTURE-CORE §The core is Code-OSS, "the storage
 * backends → file system providers"). `HostFilesStorage` is the `public/`
 * view onto `EditorHost.files`, so an asset write is the workbench's own write
 * on the URI it already holds — the same property that closed U4's redo open
 * for source files. Everything the file door does not carry (remove, mkdir,
 * stat, list, watch) stays this tier's, which is why the decorator keeps it
 * rather than replacing it.
 *
 * Read at FIRST USE rather than at module load: the bridge takes ownership
 * before the editor mounts, but the provider arrives with the contribution's
 * own services, after — see `files/file-provider.ts`.
 */
export function getStorageBackend(): StorageBackend {
  if (_backend) return _backend;
  const tier = tierStorageBackend();
  _backend = filesProviderInstalled() ? new HostFilesStorage(tier) : tier;
  return _backend;
}

/** Override the active backend (the design system's fixture). */
export function setStorageBackend(backend: StorageBackend): void {
  _backend = backend;
  // An explicitly installed backend REPLACES the tier, so the file door's host
  // fill stands on it too rather than on a stale one it would otherwise hold.
  if (!(backend instanceof HostFilesStorage)) _tier = backend;
}
