/** Project-keyed durable snapshots for the synchronous Godot browser filesystem. */

import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

export interface StoredFileSystemSnapshot {
  readonly files: Record<string, string>;
  readonly directories: string[];
  readonly metadata?: Record<string, StoredFileMetadata>;
}

export interface StoredFileMetadata {
  readonly modifiedTime: number;
  readonly accessTime: number;
  readonly unixPermissions: number;
}

export interface IndexedDbFileSystemStore {
  load(): Promise<StoredFileSystemSnapshot | null>;
  write(snapshot: StoredFileSystemSnapshot): void;
  flush(): Promise<void>;
  deleteSnapshot(): Promise<void>;
  reset(): Promise<void>;
}

const DATABASE_NAME = 'vgai-godot-compat';
const DATABASE_VERSION = 1;
const OBJECT_STORE = 'file-systems';
const FALLBACK = new Map<string, StoredFileSystemSnapshot>();
const EMPTY: StoredFileSystemSnapshot = { files: {}, directories: ['res://', 'user://'] };

interface GodotFileSystemDatabase extends DBSchema {
  'file-systems': {
    key: string;
    value: StoredFileSystemSnapshot;
  };
}

function cloneSnapshot(snapshot: StoredFileSystemSnapshot): StoredFileSystemSnapshot {
  return {
    files: { ...snapshot.files },
    directories: [...snapshot.directories],
    metadata: Object.fromEntries(
      Object.entries(snapshot.metadata ?? {}).map(([path, metadata]) => [path, { ...metadata }]),
    ),
  };
}

function validatedSnapshot(value: unknown): StoredFileSystemSnapshot {
  if (typeof value !== 'object' || value === null) return cloneSnapshot(EMPTY);
  const candidate = value as Partial<StoredFileSystemSnapshot>;
  const files: Record<string, string> = {};
  if (typeof candidate.files === 'object' && candidate.files !== null) {
    for (const [path, contents] of Object.entries(candidate.files)) {
      if (typeof contents !== 'string') {
        throw new TypeError(
          `Godot filesystem snapshot ${JSON.stringify(path)} is not base64 text.`,
        );
      }
      files[path] = contents;
    }
  }
  const directories = Array.isArray(candidate.directories)
    ? candidate.directories.map((entry) => {
        if (typeof entry !== 'string')
          throw new TypeError('Godot filesystem directory entries must be strings.');
        return entry;
      })
    : [...EMPTY.directories];
  const metadata: Record<string, StoredFileMetadata> = {};
  if (typeof candidate.metadata === 'object' && candidate.metadata !== null) {
    for (const [path, value] of Object.entries(candidate.metadata)) {
      if (typeof value !== 'object' || value === null) continue;
      const entry = value as Partial<StoredFileMetadata>;
      if (
        typeof entry.modifiedTime !== 'number' ||
        typeof entry.accessTime !== 'number' ||
        typeof entry.unixPermissions !== 'number'
      )
        continue;
      metadata[path] = {
        modifiedTime: entry.modifiedTime,
        accessTime: entry.accessTime,
        unixPermissions: entry.unixPermissions,
      };
    }
  }
  return { files, directories, metadata };
}

export function createIndexedDbFileSystemStore(projectKey: string): IndexedDbFileSystemStore {
  const key = projectKey.trim();
  if (key === '') throw new Error('Godot filesystem project key cannot be empty.');

  let pending: StoredFileSystemSnapshot | undefined;
  let writing: Promise<void> | undefined;
  let failure: Error | undefined;
  let database: Promise<IDBPDatabase<GodotFileSystemDatabase>> | undefined;

  const db = (): Promise<IDBPDatabase<GodotFileSystemDatabase>> | null => {
    if (typeof indexedDB === 'undefined') return null;
    if (database === undefined) {
      let rejectBlocked: ((reason: Error) => void) | undefined;
      let wasBlocked = false;
      const blocked = new Promise<never>((_resolve, reject) => {
        rejectBlocked = reject;
      });
      const opening = openDB<GodotFileSystemDatabase>(DATABASE_NAME, DATABASE_VERSION, {
        upgrade(upgrading) {
          if (!upgrading.objectStoreNames.contains(OBJECT_STORE)) {
            upgrading.createObjectStore(OBJECT_STORE);
          }
        },
        blocked() {
          wasBlocked = true;
          rejectBlocked?.(
            new Error('Godot filesystem IndexedDB upgrade is blocked by another open page.'),
          );
        },
        blocking() {
          void database?.then(
            (live) => live.close(),
            () => undefined,
          );
          database = undefined;
        },
        terminated() {
          database = undefined;
        },
      });
      void opening.then(
        (live) => {
          if (wasBlocked) live.close();
        },
        () => undefined,
      );
      const selected = Promise.race([opening, blocked]);
      const guarded = selected.catch((reason: unknown) => {
        if (database === guarded) database = undefined;
        throw reason;
      });
      database = guarded;
    }
    return database;
  };

  const assertHealthy = (): void => {
    if (failure !== undefined) {
      throw new Error(`Godot user:// persistence failed: ${failure.message}`, { cause: failure });
    }
  };

  const persist = async (snapshot: StoredFileSystemSnapshot): Promise<void> => {
    const opening = db();
    if (opening === null) {
      FALLBACK.set(key, cloneSnapshot(snapshot));
      return;
    }
    await (await opening).put(OBJECT_STORE, cloneSnapshot(snapshot), key);
  };

  const startWriter = (): void => {
    if (writing !== undefined) return;
    writing = (async () => {
      while (pending !== undefined) {
        const snapshot = pending;
        pending = undefined;
        await persist(snapshot);
      }
    })();
    void writing.then(
      () => {
        writing = undefined;
        if (pending !== undefined) startWriter();
      },
      (reason: unknown) => {
        writing = undefined;
        failure = reason instanceof Error ? reason : new Error(String(reason));
        const surfaced = new Error(`Godot user:// persistence failed: ${failure.message}`, {
          cause: failure,
        });
        queueMicrotask(() => {
          throw surfaced;
        });
      },
    );
  };

  const deleteSnapshot = async (): Promise<void> => {
    pending = undefined;
    while (writing !== undefined) {
      try {
        await writing;
      } catch {
        // Deletion is the recovery operation for a failed/quota-exhausted writer.
      }
    }
    failure = undefined;
    const opening = db();
    if (opening === null) {
      FALLBACK.delete(key);
      return;
    }
    await (await opening).delete(OBJECT_STORE, key);
  };

  return {
    async load() {
      assertHealthy();
      const opening = db();
      if (opening === null) {
        const snapshot = FALLBACK.get(key);
        return snapshot === undefined ? null : cloneSnapshot(snapshot);
      }
      const value = await (await opening).get(OBJECT_STORE, key);
      return value === undefined ? null : validatedSnapshot(value);
    },
    write(snapshot) {
      assertHealthy();
      pending = validatedSnapshot(snapshot);
      startWriter();
    },
    async flush() {
      while (writing !== undefined) await writing;
      assertHealthy();
    },
    deleteSnapshot,
    async reset() {
      await deleteSnapshot();
      FALLBACK.set(key, cloneSnapshot(EMPTY));
    },
  };
}
