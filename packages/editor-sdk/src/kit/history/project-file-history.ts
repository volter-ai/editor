import { sha256Hex } from '@volter/editor-sdk/kit/bytes-codec';
import { getStorageBackend } from '../storage/index';
import type { HistoryService } from '@volter/editor-sdk/kit/history/history-service';
import { normalizeProjectPath } from '@volter/editor-sdk/kit/history/resource-registry';
import type {
  ResourceDescriptor,
  ResourceDriver,
  ResourceKey,
  ResourceKind,
  ResourceSnapshot,
} from '@volter/editor-sdk/kit/history-types';

const ABSENT = 0;
const PRESENT = 1;

function encodeFile(exists: boolean, bytes: Uint8Array = new Uint8Array()): Uint8Array {
  const encoded = new Uint8Array(bytes.byteLength + 1);
  encoded[0] = exists ? PRESENT : ABSENT;
  if (exists) encoded.set(bytes, 1);
  return encoded;
}

function decodeFile(encoded: Uint8Array): { exists: boolean; bytes: Uint8Array } {
  const marker = encoded[0];
  if (marker !== ABSENT && marker !== PRESENT) throw new Error('Invalid project-file snapshot.');
  return { exists: marker === PRESENT, bytes: encoded.slice(1) };
}

async function captureFile(
  backend: HistoryFileBackend,
  path: string,
  revision: number,
  contentType: string,
): Promise<ResourceSnapshot> {
  const exists = await backend.exists(path);
  const bytes = encodeFile(exists, exists ? await backend.readBytes(path) : undefined);
  return { revision, contentType, bytes, sha256: await sha256Hex(bytes) };
}

interface ManagedFile {
  descriptor: ResourceDescriptor;
  revision: number;
  contentType: string;
  listeners: Set<() => void>;
}

export interface ProjectFileMutation {
  readonly path: string;
  readonly data: string | Uint8Array | null;
  readonly kind?: ResourceKind;
  readonly contentType?: string;
}

interface ProjectFileFingerprint {
  readonly path: string;
  readonly sha256: string;
}

export interface ProjectFileMutationSession {
  /** Refuse before invoking a project-owned serializer when an opened file has
   * already changed. The transactional check in mutate remains the final
   * race-safe authority. */
  assertUnchanged(): Promise<void>;
  /**
   * Writes only while every resource still matches the exact bytes this
   * session opened. A successful write advances that baseline to the bytes
   * just committed; a conflict leaves both the files and baseline untouched.
   */
  mutate(changes: readonly ProjectFileMutation[], options: { label: string }): Promise<boolean>;
}

export class ProjectFileContentConflictError extends Error {
  constructor(readonly path: string) {
    super(
      `Project file "${path}" no longer matches the bytes loaded into this Asset Lab document. ` +
        'Reopen the document to review the newer file; the editor did not overwrite it.',
    );
    this.name = 'ProjectFileContentConflictError';
  }
}

/** Exact-byte, existence-aware history for project files reached through StorageBackend. */
export class ProjectFileHistory {
  private readonly files = new Map<string, ManagedFile>();
  private readonly listeners = new Set<(path: string) => void>();

  constructor(
    private readonly history: HistoryService,
    private readonly backend: HistoryFileBackend,
  ) {}

  write(
    path: string,
    data: string | Uint8Array,
    options: { label: string; kind?: ResourceKind; contentType?: string },
  ): Promise<boolean> {
    const normalized = normalizeProjectPath(path);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : Uint8Array.from(data);
    const file = this.file(
      normalized,
      options.kind ?? 'project-file',
      options.contentType ?? (typeof data === 'string' ? 'text/plain' : 'application/octet-stream'),
    );
    return this.history.transaction(
      { label: options.label, resources: [file.descriptor.key], scope: 'project' },
      async (tx) => {
        await tx.write(file.descriptor.key, encodeFile(true, bytes), file.contentType);
        return true;
      },
    );
  }

  writeWithResources(
    path: string,
    data: string | Uint8Array,
    options: { label: string; kind?: ResourceKind; contentType?: string },
    additional: readonly {
      resource: ResourceKey;
      bytes: Uint8Array;
      contentType: string;
    }[],
  ): Promise<boolean> {
    const normalized = normalizeProjectPath(path);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : Uint8Array.from(data);
    const file = this.file(
      normalized,
      options.kind ?? 'project-file',
      options.contentType ?? (typeof data === 'string' ? 'text/plain' : 'application/octet-stream'),
    );
    return this.history.transaction(
      {
        label: options.label,
        resources: [file.descriptor.key, ...additional.map((change) => change.resource)],
        scope: 'project',
      },
      async (tx) => {
        await tx.write(file.descriptor.key, encodeFile(true, bytes), file.contentType);
        for (const change of additional) {
          await tx.write(change.resource, change.bytes, change.contentType);
        }
        return true;
      },
    );
  }

  remove(
    path: string,
    options: { label: string; kind?: ResourceKind; contentType?: string },
  ): Promise<boolean> {
    const normalized = normalizeProjectPath(path);
    const file = this.file(
      normalized,
      options.kind ?? 'project-file',
      options.contentType ?? 'application/octet-stream',
    );
    return this.history.transaction(
      { label: options.label, resources: [file.descriptor.key], scope: 'project' },
      async (tx) => {
        await tx.write(file.descriptor.key, encodeFile(false), file.contentType);
        return true;
      },
    );
  }

  /** Apply a logical multi-file operation as one failure-atomic undo step. */
  mutate(
    changes: readonly ProjectFileMutation[],
    options: { label: string; expected?: readonly ProjectFileFingerprint[] },
  ): Promise<boolean> {
    const staged = changes.map((change) => {
      const path = normalizeProjectPath(change.path);
      const contentType = change.contentType ?? 'application/octet-stream';
      return {
        change,
        file: this.file(path, change.kind ?? 'project-file', contentType),
        contentType,
      };
    });
    const uniqueResources = new Set(staged.map(({ file }) => file.descriptor.key));
    if (uniqueResources.size !== staged.length) {
      throw new Error('A project-file mutation cannot write the same path twice.');
    }
    const expected = new Map(
      options.expected?.map((fingerprint) => [
        normalizeProjectPath(fingerprint.path),
        fingerprint.sha256,
      ]),
    );
    if (
      options.expected &&
      (expected.size !== staged.length ||
        staged.some(({ change }) => !expected.has(normalizeProjectPath(change.path))))
    ) {
      throw new Error('A guarded project-file mutation must cover exactly the opened paths.');
    }
    return this.history.transaction(
      { label: options.label, resources: [...uniqueResources], scope: 'project' },
      async (tx) => {
        for (const { change, file, contentType } of staged) {
          const before = await tx.read(file.descriptor.key);
          const path = normalizeProjectPath(change.path);
          const expectedSha = expected.get(path);
          if (expectedSha !== undefined && before.sha256 !== expectedSha) {
            throw new ProjectFileContentConflictError(path);
          }
          const bytes =
            change.data === null
              ? encodeFile(false)
              : encodeFile(
                  true,
                  typeof change.data === 'string'
                    ? new TextEncoder().encode(change.data)
                    : Uint8Array.from(change.data),
                );
          await tx.write(file.descriptor.key, bytes, contentType);
        }
        return true;
      },
    );
  }

  /**
   * Opens a long-lived optimistic-concurrency boundary from the exact bytes a
   * document's serializers say are currently loaded in memory.
   */
  async openMutationSession(
    initial: readonly ProjectFileMutation[],
  ): Promise<ProjectFileMutationSession> {
    let expected = await this.fingerprintMutations(initial);
    const contentTypes = new Map(
      initial.map((change) => [
        normalizeProjectPath(change.path),
        change.contentType ?? 'application/octet-stream',
      ]),
    );
    const assertUnchanged = async () => {
      for (const fingerprint of expected) {
        const current = await captureFile(
          this.backend,
          fingerprint.path,
          0,
          contentTypes.get(fingerprint.path) ?? 'application/octet-stream',
        );
        if (current.sha256 !== fingerprint.sha256) {
          throw new ProjectFileContentConflictError(fingerprint.path);
        }
      }
    };
    await assertUnchanged();
    return {
      assertUnchanged,
      mutate: async (changes, options) => {
        const next = await this.fingerprintMutations(changes);
        const changed = await this.mutate(changes, { ...options, expected });
        expected = next;
        for (const change of changes) {
          contentTypes.set(
            normalizeProjectPath(change.path),
            change.contentType ?? 'application/octet-stream',
          );
        }
        return changed;
      },
    };
  }

  subscribe(path: string, listener: () => void): () => void {
    const normalized = normalizeProjectPath(path);
    const file = this.files.get(normalized);
    if (!file) throw new Error(`Project file "${normalized}" is not registered with history.`);
    file.listeners.add(listener);
    return () => file.listeners.delete(listener);
  }

  subscribeAll(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private file(path: string, kind: ResourceKind, contentType: string): ManagedFile {
    const existing = this.files.get(path);
    if (existing) {
      if (existing.descriptor.kind !== kind) {
        throw new Error(
          `Project file "${path}" is already registered as ${existing.descriptor.kind}.`,
        );
      }
      existing.contentType = contentType;
      return existing;
    }
    const descriptor = this.history.registry.registerProject(kind, path);
    const file: ManagedFile = {
      descriptor,
      revision: 0,
      contentType,
      listeners: new Set(),
    };
    const driver: ResourceDriver = {
      descriptor,
      capture: () => captureFile(this.backend, path, file.revision, file.contentType),
      preflight: async (expected) => {
        const current = await captureFile(this.backend, path, file.revision, file.contentType);
        return current.sha256 === expected.sha256
          ? { ok: true }
          : {
              ok: false,
              reason: 'content-conflict',
              actualRevision: file.revision,
              actualSha256: current.sha256,
            };
      },
      restore: async (snapshot) => {
        const decoded = decodeFile(this.history.snapshots.read(snapshot).bytes);
        if (decoded.exists) await this.backend.write(path, decoded.bytes);
        else await this.backend.remove(path);
        file.revision++;
        for (const listener of file.listeners) listener();
        for (const listener of this.listeners) listener(path);
      },
      estimateBytes: (snapshot) => snapshot.byteLength,
    };
    this.history.registerDriver(driver);
    this.files.set(path, file);
    return file;
  }

  private async fingerprintMutations(
    changes: readonly ProjectFileMutation[],
  ): Promise<ProjectFileFingerprint[]> {
    const paths = new Set<string>();
    const fingerprints: ProjectFileFingerprint[] = [];
    for (const change of changes) {
      const path = normalizeProjectPath(change.path);
      if (paths.has(path)) {
        throw new Error('A project-file mutation cannot write the same path twice.');
      }
      paths.add(path);
      const bytes =
        change.data === null
          ? encodeFile(false)
          : encodeFile(
              true,
              typeof change.data === 'string'
                ? new TextEncoder().encode(change.data)
                : Uint8Array.from(change.data),
            );
      fingerprints.push({ path, sha256: await sha256Hex(bytes) });
    }
    return fingerprints;
  }
}

export interface HistoryFileBackend {
  readonly id: string;
  readBytes(path: string): Promise<Uint8Array>;
  write(path: string, data: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

const managers = new WeakMap<
  HistoryService,
  Map<string, { backend: HistoryFileBackend; manager: ProjectFileHistory }>
>();

export function getProjectFileHistory(
  history: HistoryService,
  backend: HistoryFileBackend = getStorageBackend(),
  namespace = 'public',
): ProjectFileHistory {
  let byNamespace = managers.get(history);
  if (!byNamespace) {
    byNamespace = new Map();
    managers.set(history, byNamespace);
  }
  const existing = byNamespace.get(namespace);
  if (existing) {
    if (existing.backend !== backend) {
      throw new Error('The project storage backend changed without creating a new editor session.');
    }
    return existing.manager;
  }
  const manager = new ProjectFileHistory(history, backend);
  byNamespace.set(namespace, { backend, manager });
  return manager;
}
