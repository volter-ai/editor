/**
 * Pure in-memory `StorageBackend` — a virtual filesystem backed by a `Map`.
 *
 * Nothing touches disk; files live as bytes in JS and vanish on reload. The
 * most "virtual" of the backends, and the simplest — the design system's
 * fixture (`design-system-stories/fixtures/editor-runtime.tsx`) is what uses
 * it: a story needs a project-shaped backend and must write nothing.
 *
 * Implements the same interface as every other backend, so it is a drop-in via
 * `setStorageBackend(new MemStorage())`.
 */

import { dirAndBase, normalize } from './paths';
import type { DirEntry, Stat, StorageBackend, WatchCallback, WatchEvent } from '@volter/editor-sdk/kit/storage-types';

type Node = { type: 'file'; data: Uint8Array; mtime: number } | { type: 'dir'; mtime: number };

export class MemStorage implements StorageBackend {
  readonly id = 'mem';

  /** Normalized path → node. The root (`''`) is implicit. */
  private readonly nodes = new Map<string, Node>();
  private readonly watchers = new Set<WatchCallback>();

  /** Optionally seed the VFS from a `{ path: contents }` map. */
  constructor(seed?: Record<string, string | Uint8Array>) {
    if (seed) for (const [path, data] of Object.entries(seed)) this.writeSync(path, data);
  }

  private emit(event: WatchEvent): void {
    for (const cb of this.watchers) cb(event);
  }

  /** Ensure every ancestor directory of `path` exists. */
  private ensureParents(path: string): void {
    const parts = normalize(path).split('/');
    parts.pop();
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (this.nodes.get(cur)?.type !== 'dir') this.nodes.set(cur, { type: 'dir', mtime: now() });
    }
  }

  private writeSync(path: string, data: string | Uint8Array): boolean {
    const norm = normalize(path);
    this.ensureParents(norm);
    const existed = this.nodes.get(norm)?.type === 'file';
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    this.nodes.set(norm, { type: 'file', data: bytes, mtime: now() });
    return existed;
  }

  async read(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const node = this.nodes.get(normalize(path));
    if (node?.type !== 'file')
      throw new Error(`MemStorage.read: no such file '${normalize(path)}'`);
    // Reads own their bytes, just like File/HTTP backends. Asset serving
    // transfers this buffer to a worker; sharing the stored buffer would
    // detach the file itself and break every subsequent read.
    return node.data.slice();
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    const existed = this.writeSync(path, data);
    this.emit({ type: existed ? 'update' : 'create', path: normalize(path) });
  }

  async writeIfAbsent(path: string, data: string | Uint8Array): Promise<boolean> {
    if (await this.exists(path)) return false;
    this.writeSync(path, data);
    this.emit({ type: 'create', path: normalize(path) });
    return true;
  }

  async list(dir: string): Promise<DirEntry[]> {
    const dn = normalize(dir);
    if (dn !== '' && this.nodes.get(dn)?.type !== 'dir') {
      throw new Error(`MemStorage.list: no such directory '${dn}'`);
    }
    const entries: DirEntry[] = [];
    for (const [path, node] of this.nodes) {
      const [parent, base] = dirAndBase(path);
      if (parent !== dn || !base) continue;
      const entry: DirEntry = {
        name: base,
        path,
        type: node.type === 'dir' ? 'dir' : 'file',
        mtime: node.mtime,
      };
      if (node.type === 'file') entry.size = node.data.length;
      entry.mtime = node.mtime;
      entries.push(entry);
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async stat(path: string): Promise<Stat | null> {
    const norm = normalize(path);
    if (norm === '') return { path: '', type: 'dir', size: 0, mtime: 0 };
    const node = this.nodes.get(norm);
    if (!node) return null;
    return node.type === 'file'
      ? { path: norm, type: 'file', size: node.data.length, mtime: node.mtime }
      : { path: norm, type: 'dir', size: 0, mtime: node.mtime };
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async mkdir(path: string): Promise<void> {
    const norm = normalize(path);
    if (!norm || this.nodes.get(norm)?.type === 'dir') return;
    this.ensureParents(norm);
    this.nodes.set(norm, { type: 'dir', mtime: now() });
    this.emit({ type: 'create', path: norm });
  }

  async remove(path: string): Promise<void> {
    const norm = normalize(path);
    if (!norm) return;
    let removed = false;
    for (const key of [...this.nodes.keys()]) {
      if (key === norm || key.startsWith(`${norm}/`)) {
        this.nodes.delete(key);
        removed = true;
      }
    }
    if (removed) this.emit({ type: 'remove', path: norm });
  }

  watch(callback: WatchCallback): () => void {
    this.watchers.add(callback);
    return () => this.watchers.delete(callback);
  }
}

function now(): number {
  return Date.now();
}
