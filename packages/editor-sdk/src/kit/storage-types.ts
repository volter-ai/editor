/**
 * Backend-agnostic file interface for the editor.
 *
 * The editor and engine read/write project files through one `StorageBackend`
 * and never learn which implementation is behind it — the session's own
 * `/__editor/*` routes, the frame's file door over them, or the design
 * system's in-memory fixture.
 *
 * Scope — this interface deliberately covers ONLY what reduces to file
 * operations. Three editor concerns do not, and are handled elsewhere:
 *   - native folder dialogs / "reveal in OS file manager" → `HostCapabilities`
 *   - the `vgai` CLI control channel (SSE + command RPC) → server-only, dropped
 *     in a pure-browser editor
 *   - `export` / packaging (spawns a build) → a client-side bundler in-browser
 *
 * `watch` is part of the interface but its semantics are backend-specific: a
 * server backend reports real filesystem events (chokidar); a browser backend
 * has no OS file-change notifications, so it derives events from its OWN writes
 * (in a server-less editor the editor is the only writer — which is exactly the
 * signal HMR needs).
 *
 * Paths are POSIX-style, project-root-relative, '/'-separated, no leading slash
 * (e.g. `src/scripts/components/spin.ts`).
 */

export type NodeType = 'file' | 'dir';

export interface Stat {
  /** Normalized, root-relative path. */
  path: string;
  type: NodeType;
  /** Byte length for files; 0 for directories. */
  size: number;
  /** Last-modified time, epoch ms (0 if the backend cannot report it). */
  mtime: number;
}

export interface DirEntry {
  /** Base name (no slashes). */
  name: string;
  /** Normalized, root-relative path. */
  path: string;
  type: NodeType;
  /** Byte length for files (omitted for directories). */
  size?: number;
  /** Last-modified time, epoch ms (omitted if the backend cannot report it). */
  mtime?: number;
}

export type WatchEventType = 'create' | 'update' | 'remove';

export interface WatchEvent {
  type: WatchEventType;
  /** Normalized, root-relative path of the affected node. */
  path: string;
}

export type WatchCallback = (event: WatchEvent) => void;

/**
 * The one file interface every storage backend implements. All methods take and
 * return normalized, root-relative POSIX paths.
 */
export interface StorageBackend {
  /** Stable identifier for the active backend (for diagnostics/feature flags). */
  readonly id: string;

  /** Read a UTF-8 text file. Rejects if the path is missing or is a directory. */
  read(path: string): Promise<string>;
  /** Read raw bytes. Rejects if the path is missing or is a directory. */
  readBytes(path: string): Promise<Uint8Array>;

  /** Write a file, creating parent directories as needed. Emits a watch event. */
  write(path: string, data: string | Uint8Array): Promise<void>;
  /**
   * Create a new file without replacing an existing one. Returns false when
   * the path already exists. Browser handle APIs have no OS-level O_EXCL;
   * HandleStorage serializes same-origin writers and rechecks at handle
   * acquisition, while an external process may still win the final race.
   */
  writeIfAbsent(path: string, data: string | Uint8Array): Promise<boolean>;

  /** Shallow directory listing. Rejects if the path is missing or is a file. */
  list(dir: string): Promise<DirEntry[]>;

  /** Stat a node, or resolve to `null` if it does not exist. */
  stat(path: string): Promise<Stat | null>;

  /** Convenience existence check. */
  exists(path: string): Promise<boolean>;

  /** Recursively create a directory (no-op if it already exists). */
  mkdir(path: string): Promise<void>;

  /** Recursively remove a file or directory (no-op if missing). Emits an event. */
  remove(path: string): Promise<void>;

  /** Subscribe to change events. Returns an unsubscribe function. */
  watch(callback: WatchCallback): () => void;
}

/**
 * Non-file host capabilities, kept separate from `StorageBackend` because they
 * do not reduce to path operations. A backend may implement none of these.
 */
export interface HostCapabilities {
  /**
   * Prompt the user to choose a project root and return a backend rooted there.
   * Browser: `showDirectoryPicker()` (Chromium). Resolves to `null` if the user
   * cancels. Absent entirely where unsupported.
   */
  pickProjectRoot?(): Promise<StorageBackend | null>;

  /** Reveal a path in the OS file manager. Absent in the browser. */
  reveal?(path: string): Promise<void>;
}
