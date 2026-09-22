/**
 * Server-backed `StorageBackend` for the local (Node) editor.
 *
 * A thin adapter over the editor server's existing routes — it changes nothing
 * about how the local editor talks to disk, it just presents that surface behind
 * the shared interface. The backend is rooted at the project's `public/` folder,
 * matching the server's `/__editor/assets` (list) and `/__editor/save-file`
 * (write) routes; reads come from Vite's `/@fs/` static serving.
 *
 * Route mapping (paths are relative to `public/`):
 *   list     → GET  /__editor/assets?dir            → { entries: [{name,type,size,mtime}] }
 *   write    → POST /__editor/save-file             ({path, content, encoding?})
 *   read     → GET  /@fs/{projectRoot}/public/{path}
 *   watch    → EventSource /__editor/events         (chokidar-backed)
 *
 * The CLI control channel, native dialogs, `export`, online asset library, and
 * project/editor-state persistence are NOT file operations and live outside this
 * interface (see types.ts and editor-api.ts).
 */

import { bytesToBase64 } from '../bytes-codec';
import { assertEditorServerAnswered, editorServerJson } from '../editor-server-response';
import { sourceMutationAttribution } from '../editor-session-attribution';
import { handleProjectMutationFailure } from '../source-conflict';
import { dirAndBase, normalize } from './paths';
import type { DirEntry, Stat, StorageBackend, WatchCallback, WatchEvent } from './types';

const BASE = '/__editor';

interface ServerAssetEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
}

export class HttpStorage implements StorageBackend {
  readonly id = 'http';

  /** Absolute project root on the server (used for /@fs reads). */
  constructor(private readonly projectRoot: string) {}

  async read(path: string): Promise<string> {
    const res = await fetch(`/@fs/${this.projectRoot}/public/${normalize(path)}`);
    if (!res.ok) throw new Error(`HttpStorage.read '${normalize(path)}': HTTP ${res.status}`);
    return res.text();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const res = await fetch(`/@fs/${this.projectRoot}/public/${normalize(path)}`);
    if (!res.ok) throw new Error(`HttpStorage.readBytes '${normalize(path)}': HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    const body =
      typeof data === 'string'
        ? { path: normalize(path), content: data, ...sourceMutationAttribution() }
        : {
            path: normalize(path),
            content: bytesToBase64(data),
            encoding: 'base64' as const,
            ...sourceMutationAttribution(),
          };
    const res = await fetch(`${BASE}/save-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // This is the AUTOSAVE path. `!res.ok` alone let a page fallback report
    // every save as written, so the editor kept showing saved work that no
    // server had ever received.
    assertEditorServerAnswered(res, `Write ${normalize(path)} failed`);
    if (!res.ok) {
      await handleProjectMutationFailure(res, {
        label: `Write ${normalize(path)}`,
        attempted: {
          [`public/${normalize(path)}`]:
            typeof data === 'string' ? data : `[${data.byteLength} binary bytes]`,
        },
        reapply: () => this.write(path, data),
      });
    }
  }

  async writeIfAbsent(path: string, data: string | Uint8Array): Promise<boolean> {
    // Browser adaptation never uses HttpStorage: the Node endpoint owns its
    // true `wx` write. Keep the interface honest for generic callers.
    if (await this.exists(path)) return false;
    await this.write(path, data);
    return true;
  }

  async list(dir: string): Promise<DirEntry[]> {
    const res = await fetch(`${BASE}/assets?${new URLSearchParams({ dir: normalize(dir) })}`);
    const { entries } = await editorServerJson<{ entries: ServerAssetEntry[] }>(
      res,
      `HttpStorage.list '${normalize(dir)}' failed`,
    );
    return entries.map((e) => {
      const out: DirEntry = {
        name: e.name,
        path: normalize(dir ? `${dir}/${e.name}` : e.name),
        type: e.type === 'directory' ? 'dir' : 'file',
        mtime: e.mtime,
      };
      if (e.type === 'file') out.size = e.size;
      out.mtime = e.mtime;
      return out;
    });
  }

  async stat(path: string): Promise<Stat | null> {
    // The server exposes listings, not a per-path stat. Derive from the parent
    // listing — sufficient for the editor's needs (existence + type + size).
    const [dir, base] = dirAndBase(path);
    if (!base) return { path: '', type: 'dir', size: 0, mtime: 0 };
    let entries: DirEntry[];
    try {
      entries = await this.list(dir);
    } catch {
      return null;
    }
    const hit = entries.find((e) => e.name === base);
    return hit
      ? { path: hit.path, type: hit.type, size: hit.size ?? 0, mtime: hit.mtime ?? 0 }
      : null;
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async mkdir(path: string): Promise<void> {
    // The server has no empty-dir route; directories materialize when their
    // first file is written (save-file creates parents). No-op here.
    void path;
  }

  async remove(path: string): Promise<void> {
    const res = await fetch(`${BASE}/save-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: normalize(path), delete: true, ...sourceMutationAttribution() }),
    });
    assertEditorServerAnswered(res, `Delete ${normalize(path)} failed`);
    if (!res.ok) {
      await handleProjectMutationFailure(res, {
        label: `Delete ${normalize(path)}`,
        attempted: { [`public/${normalize(path)}`]: null },
        reapply: () => this.remove(path),
      });
    }
  }

  watch(callback: WatchCallback): () => void {
    const source = new EventSource(`${BASE}/events`);
    const handler = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { type?: string; file?: string; path?: string };
        const path = data.path ?? data.file;
        if (!path) return;
        callback({ type: (data.type as WatchEvent['type']) ?? 'update', path: normalize(path) });
      } catch {
        // Ignore non-JSON keepalive frames.
      }
    };
    source.addEventListener('message', handler);
    return () => {
      source.removeEventListener('message', handler);
      source.close();
    };
  }
}
