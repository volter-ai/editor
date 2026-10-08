/**
 * THE PROJECT'S FILES IN A LIMITED VIEW — the SDK's in-memory `StorageBackend`
 * (`@volter/sdk/kit/storage/mem-storage`), seeded from the files the view shipped.
 *
 * Seeding is LAZY: the view's index (`__view/files.json`) says which files exist, with their
 * sizes, and a file's bytes are fetched from `__view/project/<path>` the first time something
 * reads it. A project's `.blend` can be hundreds of megabytes; a view that opens on a script
 * should not download it. Once read or written, a file lives in the `MemStorage`; a removed seed
 * file is forgotten until the page reloads.
 *
 * Paths are project-root relative, `/`-separated, no leading slash — the `StorageBackend`
 * contract. The store is the ONE set of bytes in the page: the workbench's `volter-view:` folder
 * and the `/__editor/*` router both stand on it.
 */

import { MemStorage } from '@volter/sdk/kit/storage/mem-storage';
import { dirAndBase, normalize } from '@volter/sdk/kit/storage/paths';
import type { DirEntry, Stat, StorageBackend, WatchCallback, WatchEvent } from '@volter/sdk/kit/storage-types';
import { type LimitedViewProjectFile, VIEW_DIR } from './view-contract';

const within = (path: string, dir: string): boolean => dir === '' || path === dir || path.startsWith(`${dir}/`);

export class SeededProjectStore implements StorageBackend {
  readonly id = 'limited-view';

  private readonly memory = new MemStorage();
  /** Seed files not yet read into memory, by path. */
  private readonly unread = new Map<string, LimitedViewProjectFile>();
  /** Every directory the unread seed implies, so a listing of an unread tree is answered. */
  private readonly seedDirs = new Set<string>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly watchers = new Set<WatchCallback>();

  constructor(
    seed: readonly LimitedViewProjectFile[],
    /** The page's base URL, ending in `/`. */
    private readonly base: string,
  ) {
    for (const file of seed) {
      const path = normalize(file.path);
      this.unread.set(path, { ...file, path });
      let [dir] = dirAndBase(path);
      while (dir !== '' && !this.seedDirs.has(dir)) {
        this.seedDirs.add(dir);
        [dir] = dirAndBase(dir);
      }
    }
    this.memory.watch((event) => this.announce(event));
  }

  private announce(event: WatchEvent): void {
    for (const callback of this.watchers) callback(event);
  }

  /** Bring one seed file into memory, once, without announcing it as a change. */
  private async load(path: string): Promise<void> {
    if (!this.unread.has(path)) return;
    let inFlight = this.loading.get(path);
    if (!inFlight) {
      inFlight = (async () => {
        const url = `${this.base}${VIEW_DIR}/project/${path.split('/').map(encodeURIComponent).join('/')}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`The limited view shipped ${path}, and ${url} answered ${response.status}.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        // A write or removal that landed while this was in flight wins.
        if (this.unread.delete(path)) this.memory.seed(path, bytes);
      })().finally(() => this.loading.delete(path));
      this.loading.set(path, inFlight);
    }
    await inFlight;
  }

  async read(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const norm = normalize(path);
    await this.load(norm);
    return this.memory.readBytes(norm);
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    const norm = normalize(path);
    this.unread.delete(norm);
    await this.memory.write(norm, data);
  }

  async writeIfAbsent(path: string, data: string | Uint8Array): Promise<boolean> {
    if (await this.exists(path)) return false;
    await this.write(path, data);
    return true;
  }

  async list(dir: string): Promise<DirEntry[]> {
    const norm = normalize(dir);
    const byName = new Map<string, DirEntry>();
    let found = norm === '';
    try {
      for (const entry of await this.memory.list(norm)) byName.set(entry.name, entry);
      found = true;
    } catch {
      /* not a directory in memory; the seed may still have it */
    }
    const prefix = norm === '' ? '' : `${norm}/`;
    if (norm === '' || this.seedDirs.has(norm)) {
      found = true;
      for (const sub of this.seedDirs) {
        if (!sub.startsWith(prefix) || sub.slice(prefix.length).includes('/')) continue;
        const name = sub.slice(prefix.length);
        if (!byName.has(name)) byName.set(name, { name, path: sub, type: 'dir', mtime: 0 });
      }
      for (const [path, file] of this.unread) {
        if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
        const name = path.slice(prefix.length);
        if (!byName.has(name)) byName.set(name, { name, path, type: 'file', size: file.size, mtime: file.mtime });
      }
    }
    if (!found) throw new Error(`No such directory in the limited view: '${norm}'`);
    return [...byName.values()].sort((a, b) =>
      a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
    );
  }

  async stat(path: string): Promise<Stat | null> {
    const norm = normalize(path);
    const inMemory = await this.memory.stat(norm);
    if (inMemory) return inMemory;
    const seed = this.unread.get(norm);
    if (seed) return { path: norm, type: 'file', size: seed.size, mtime: seed.mtime };
    if (this.seedDirs.has(norm)) return { path: norm, type: 'dir', size: 0, mtime: 0 };
    return null;
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async mkdir(path: string): Promise<void> {
    await this.memory.mkdir(normalize(path));
  }

  async remove(path: string): Promise<void> {
    const norm = normalize(path);
    if (!norm) return;
    const existed = await this.exists(norm);
    let fromSeed = false;
    for (const key of [...this.unread.keys()]) {
      if (within(key, norm)) fromSeed = this.unread.delete(key) || fromSeed;
    }
    for (const dir of [...this.seedDirs]) {
      if (within(dir, norm)) fromSeed = this.seedDirs.delete(dir) || fromSeed;
    }
    // MemStorage announces a removal it held; one that only the seed had is announced here.
    if (await this.memory.stat(norm)) await this.memory.remove(norm);
    else if (existed && fromSeed) this.announce({ type: 'remove', path: norm });
  }

  watch(callback: WatchCallback): () => void {
    this.watchers.add(callback);
    return () => {
      this.watchers.delete(callback);
    };
  }

  /** Every file in the project as it stands now, for the routes that scan. */
  async allFiles(under = ''): Promise<{ path: string; size: number; mtime: number }[]> {
    const out: { path: string; size: number; mtime: number }[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: DirEntry[];
      try {
        entries = await this.list(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.type === 'dir') await walk(entry.path);
        else out.push({ path: entry.path, size: entry.size ?? 0, mtime: entry.mtime ?? 0 });
      }
    };
    await walk(normalize(under));
    return out;
  }
}
