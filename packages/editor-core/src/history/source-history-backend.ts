import { sha256Hex } from '../bytes-codec';
import type {
  PreparedSourceEdit,
  SourceEditRequest,
  SourceWriteBackend,
} from '../ui-source/source-write-backend';
import {
  type AppliedResourceChange,
  HistoryOperationError,
  type HistoryService,
} from './history-service';
import type { ResourceDescriptor, ResourceDriver, ResourceKey } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface SourceResource {
  descriptor: ResourceDescriptor;
  expectedSha: string | null;
  /** Whether the last read said this file is BYTES rather than text. Recorded
   *  at preflight (which always precedes a restore) so the restore hands the
   *  backend the same kind of value it was given. */
  binary: boolean;
}

interface GestureFile {
  resourcePath: string;
  before: string;
  beforeSha: string;
  after: string;
  afterSha: string;
  /** Every source state produced or observed by this gesture. */
  knownShas: Set<string>;
}

interface SourceGesture {
  label: string;
  files: Map<string, GestureFile>;
  applyOrder: string[];
}

type WriteResponse = { changed: boolean; [key: string]: unknown };

class SourceHistoryManager {
  private readonly resources = new Map<string, SourceResource>();
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly history: HistoryService,
    private readonly backend: SourceWriteBackend,
  ) {}

  commit(label: string, request: SourceEditRequest): Promise<WriteResponse> {
    try {
      this.history.assertCanRecordAppliedChange();
    } catch (error) {
      return Promise.reject(error);
    }
    const releaseProducer = this.history.reserveProducer();
    return this.enqueue(() => {
      this.history.assertCanRecordAppliedChange();
      return this.prepareAndCommit(label, request);
    }).finally(releaseProducer);
  }

  replaceSource(label: string, file: string, source: string): Promise<boolean> {
    try {
      this.history.assertCanRecordAppliedChange();
    } catch (error) {
      return Promise.reject(error);
    }
    const releaseProducer = this.history.reserveProducer();
    return this.enqueue(async () => {
      this.history.assertCanRecordAppliedChange();
      const current = await this.backend.readSource!(file);
      if (current.source === source) return false;
      const resource = this.resource(file, current.resourcePath);
      return this.history.transaction(
        { label, resources: [resource.descriptor.key], scope: 'project' },
        async (tx) => {
          await tx.writeText(resource.descriptor.key, source, 'text/typescript');
          return true;
        },
      );
    }).finally(releaseProducer);
  }

  /**
   * Runs the complete callback while holding the manager queue. The callback's
   * scoped backend writes directly into this gesture; calls on the ordinary
   * backend queue after it, so unrelated inspector edits cannot be absorbed or
   * interleaved. Overlapping gestures likewise become distinct queue entries.
   */
  runGesture<T>(
    label: string,
    operation: (scopedBackend: SourceWriteBackend) => Promise<T>,
  ): Promise<T> {
    try {
      this.history.assertCanRecordAppliedChange();
    } catch (error) {
      return Promise.reject(error);
    }
    const releaseProducer = this.history.reserveProducer();
    return this.enqueue(async () => {
      this.history.assertCanRecordAppliedChange();
      const gesture: SourceGesture = { label, files: new Map(), applyOrder: [] };
      try {
        const result = await operation(this.scopedBackend(gesture));
        await this.recordGesture(gesture);
        return result;
      } catch (error) {
        try {
          await this.compensateGesture(gesture);
        } catch (compensationError) {
          throw this.history.blockForCompensationFailure(label, this.gestureResourceKeys(gesture), {
            operationError: error,
            compensationError,
          });
        }
        if (!(error instanceof HistoryOperationError)) {
          this.history.reportAppliedChangeFailure(label, this.gestureResourceKeys(gesture), error);
        }
        throw error;
      }
    }).finally(releaseProducer);
  }

  /** Run `op` after every previously queued source operation. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.tail.then(op, op);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private scopedBackend(gesture: SourceGesture): SourceWriteBackend {
    const commit = (request: SourceEditRequest) => this.applyInGesture(gesture, request);
    const { runGesture: _nestedGesture, ...backend } = this.backend;
    return {
      ...backend,
      historyManaged: true,
      writeStyle: (oid, prop, value) =>
        commit({ kind: 'style', oid, prop, value }) as ReturnType<SourceWriteBackend['writeStyle']>,
      removeStyle: (oid, prop) =>
        commit({ kind: 'style', oid, prop, value: null }) as ReturnType<
          SourceWriteBackend['removeStyle']
        >,
      writeCss: (file, selector, prop, value, media) =>
        commit({
          kind: 'css',
          file,
          selector,
          prop,
          value,
          ...(media !== undefined ? { media } : {}),
        }),
      writeText: (oid, text) => commit({ kind: 'text', oid, text }),
      // Forward the opt-in flags into the gesture-scoped prepare request too
      // (W2's addIfMissing used to be dropped HERE alone — a multi-channel
      // gesture write on a prop the source never authored silently no-op'd
      // while the single-write path appended it; R2's allowShapeUpgrade
      // would have hit the same asymmetry).
      writeProp: (oid, prop, value, opts) =>
        commit({
          kind: 'prop',
          oid,
          prop,
          value,
          ...(opts?.addIfMissing ? { addIfMissing: true } : {}),
          ...(opts?.allowShapeUpgrade ? { allowShapeUpgrade: true } : {}),
        }),
      // Same removal the ungestured wrapper routes below — kept in step so a
      // revert made inside a gesture belongs to that gesture rather than
      // escaping to the raw backend (the asymmetry `writeProp`'s comment above
      // records having been bitten by once already).
      removeProp: (oid, prop) =>
        commit({ kind: 'prop', oid, prop, value: null }) as ReturnType<
          NonNullable<SourceWriteBackend['removeProp']>
        >,
      writeComponentDefault: (oid, prop, value) =>
        commit({ kind: 'component-default', oid, prop, value }) as ReturnType<
          NonNullable<SourceWriteBackend['writeComponentDefault']>
        >,
      writeStruct: (oid, op, options) =>
        commit({ kind: 'struct', oid, op, ...options }) as ReturnType<
          SourceWriteBackend['writeStruct']
        >,
      writeStructMany: (oids, op, options) =>
        commit({ kind: 'struct-many', oids, op, ...options }) as ReturnType<
          NonNullable<SourceWriteBackend['writeStructMany']>
        >,
    };
  }

  private async recordGesture(gesture: SourceGesture): Promise<void> {
    const changes = [...gesture.files.entries()]
      .filter(([, touched]) => touched.beforeSha !== touched.afterSha)
      .map(([file, touched]) => {
        const resource = this.resource(file, touched.resourcePath);
        return {
          resource: resource.descriptor.key,
          beforeBytes: encoder.encode(touched.before),
          afterBytes: encoder.encode(touched.after),
          contentType: 'text/plain',
        };
      });
    if (changes.length === 0) return;
    await this.history.recordAppliedTransaction(
      {
        label: gesture.label,
        resources: changes.map((change) => change.resource),
        scope: 'project',
      },
      changes,
    );
  }

  private async prepareAndCommit(
    label: string,
    request: SourceEditRequest,
  ): Promise<WriteResponse> {
    const prepared = await this.backend.prepare!(request);
    const response = this.response(prepared);
    if (
      !prepared.changed ||
      !prepared.file ||
      !prepared.resourcePath ||
      prepared.newSource === undefined
    ) {
      return response;
    }
    const resource = this.resource(prepared.file, prepared.resourcePath);
    await this.history.transaction(
      { label, resources: [resource.descriptor.key], scope: 'project' },
      (tx) => tx.writeText(resource.descriptor.key, prepared.newSource!, 'text/plain'),
    );
    return response;
  }

  private async applyInGesture(
    gesture: SourceGesture,
    request: SourceEditRequest,
  ): Promise<WriteResponse> {
    const prepared = await this.backend.prepare!(request);
    const response = this.response(prepared);
    if (
      !prepared.changed ||
      !prepared.file ||
      !prepared.resourcePath ||
      prepared.newSource === undefined ||
      prepared.prevSource === undefined ||
      prepared.prevSha === undefined
    ) {
      return response;
    }
    const newSha = prepared.newSha ?? (await sha256Hex(encoder.encode(prepared.newSource)));
    const existing = gesture.files.get(prepared.file);
    if (existing) {
      existing.knownShas.add(prepared.prevSha);
      existing.knownShas.add(newSha);
    } else {
      gesture.files.set(prepared.file, {
        resourcePath: prepared.resourcePath,
        before: prepared.prevSource,
        beforeSha: prepared.prevSha,
        after: prepared.prevSource,
        afterSha: prepared.prevSha,
        knownShas: new Set([prepared.prevSha, newSha]),
      });
    }

    // The candidate is registered before apply. If transport fails after the
    // server wrote, compensation rereads and recognizes this exact hash.
    const touched = gesture.files.get(prepared.file)!;
    touched.after = prepared.newSource;
    touched.afterSha = newSha;
    gesture.applyOrder.push(prepared.file);
    const applied = await this.backend.applySource!(
      prepared.file,
      prepared.newSource,
      prepared.prevSha,
    );
    if (!applied.applied) {
      throw new Error(applied.error ?? `Failed to apply source file "${prepared.file}".`);
    }
    return response;
  }

  /** Restore all touched files in reverse order, guarded by a fresh read/hash. */
  private async compensateGesture(gesture: SourceGesture): Promise<void> {
    const seen = new Set<string>();
    const reverseLastApplyOrder = [...gesture.applyOrder].reverse().filter((file) => {
      if (seen.has(file)) return false;
      seen.add(file);
      return true;
    });
    for (const file of reverseLastApplyOrder) {
      const touched = gesture.files.get(file)!;
      const current = await this.backend.readSource!(file);
      const currentSha = await sha256Hex(encoder.encode(current.source));
      if (current.sha !== currentSha) {
        throw new Error(`Source file "${file}" returned bytes that do not match its hash.`);
      }
      if (currentSha === touched.beforeSha) continue;
      if (!touched.knownShas.has(currentSha)) {
        throw new Error(`Source file "${file}" changed outside the failed gesture.`);
      }
      const restored = await this.backend.applySource!(file, touched.before, currentSha);
      if (!restored.applied) {
        throw new Error(restored.error ?? `Failed to compensate source file "${file}".`);
      }
      const verified = await this.backend.readSource!(file);
      const verifiedSha = await sha256Hex(encoder.encode(verified.source));
      if (verified.sha !== verifiedSha || verifiedSha !== touched.beforeSha) {
        throw new Error(`Source file "${file}" compensated with the wrong hash.`);
      }
    }
  }

  private gestureResourceKeys(gesture: SourceGesture): ResourceKey[] {
    return [...gesture.files.entries()].map(
      ([file, touched]) => this.resource(file, touched.resourcePath).descriptor.key,
    );
  }

  private response(prepared: PreparedSourceEdit): WriteResponse {
    return {
      changed: prepared.changed,
      ...prepared.result,
      file: prepared.file,
      prevSource: prepared.prevSource,
      newSource: prepared.newSource,
      prevSha: prepared.prevSha,
      newSha: prepared.newSha,
    };
  }

  /** The registered history key for one source file — see
   *  {@link projectSourceAppliedChange}, the only caller that needs the key
   *  without also needing this manager to journal the change. */
  sourceResourceKey(file: string, resourcePath: string): ResourceKey {
    return this.resource(file, resourcePath).descriptor.key;
  }

  private resource(file: string, resourcePath: string): SourceResource {
    const existing = this.resources.get(file);
    if (existing) return existing;
    const descriptor = this.history.registry.registerProject('source', resourcePath);
    const resource: SourceResource = { descriptor, expectedSha: null, binary: false };
    const driver: ResourceDriver = {
      descriptor,
      capture: async () => {
        const current = await this.backend.readSource!(file);
        resource.binary = current.bytes !== undefined;
        return {
          revision: 0,
          contentType: resource.binary ? 'application/octet-stream' : 'text/plain',
          // The FILE's bytes, never the wire's — `sha256` below is the file's
          // digest and the two have to describe the same thing.
          bytes: current.bytes ?? encoder.encode(current.source),
          sha256: current.sha,
        };
      },
      preflight: async (expected) => {
        const current = await this.backend.readSource!(file);
        resource.expectedSha = current.sha;
        resource.binary = current.bytes !== undefined;
        return current.sha === expected.sha256
          ? { ok: true }
          : { ok: false, reason: 'content-conflict', actualSha256: current.sha };
      },
      restore: async (snapshot) => {
        const expectedSha = resource.expectedSha;
        resource.expectedSha = null;
        if (!expectedSha) throw new Error(`Source resource "${file}" was not preflighted.`);
        const stored = this.history.snapshots.read(snapshot).bytes;
        const source = resource.binary ? stored : decoder.decode(stored);
        const result = await this.backend.applySource!(file, source, expectedSha);
        if (!result.applied)
          throw new Error(result.error ?? `Failed to apply source file "${file}".`);
        const actual =
          result.sha ??
          (await sha256Hex(typeof source === 'string' ? encoder.encode(source) : source));
        if (actual !== snapshot.sha256)
          throw new Error(`Source file "${file}" restored with the wrong hash.`);
      },
      estimateBytes: (snapshot) => snapshot.byteLength,
    };
    this.history.registerDriver(driver);
    this.resources.set(file, resource);
    return resource;
  }
}

const managers = new WeakMap<HistoryService, WeakMap<object, SourceHistoryManager>>();

function sourceHistoryManager(
  backend: SourceWriteBackend,
  history: HistoryService,
): SourceHistoryManager {
  let byBackend = managers.get(history);
  if (!byBackend) {
    byBackend = new WeakMap();
    managers.set(history, byBackend);
  }
  const identity = backend.historyIdentity ?? backend;
  let manager = byBackend.get(identity);
  if (!manager) {
    manager = new SourceHistoryManager(history, backend);
    byBackend.set(identity, manager);
  }
  return manager;
}

/**
 * The applied-change record for one project source file's before→after bytes,
 * with its history resource registered (or reused) — but NOT journaled.
 *
 * Every other entry point here journals its own transaction, which is right
 * when the source IS the truth: an R3F undo rewrites the file and the live tree
 * follows on re-render. The ingest write-back is the case where it is not —
 * an unmodified game does not re-derive its scene from source, so the file
 * and the live `Object3D` are two halves of one edit, and putting them in two
 * transactions would mean two Ctrl+Z presses to undo one drag, with a window in
 * between where the file and the running game disagree.
 *
 * Handing the caller the change record instead of committing it lets both
 * halves go into ONE `recordAppliedTransaction`, which is the whole of what
 * this export exists for. It deliberately does not know what the other half is.
 */
export function projectSourceAppliedChange(
  backend: SourceWriteBackend,
  history: HistoryService,
  options: {
    readonly file: string;
    readonly resourcePath: string;
    /** Bytes for a file that is not text — see `SourceWriteBackend.readSource`. */
    readonly before: string | Uint8Array;
    readonly after: string | Uint8Array;
  },
): AppliedResourceChange {
  if (!backend.readSource || !backend.applySource) {
    throw new Error('This editor tier cannot write project source.');
  }
  const manager = sourceHistoryManager(backend, history);
  return {
    resource: manager.sourceResourceKey(options.file, options.resourcePath),
    beforeBytes:
      typeof options.before === 'string' ? encoder.encode(options.before) : options.before,
    afterBytes: typeof options.after === 'string' ? encoder.encode(options.after) : options.after,
    contentType: typeof options.after === 'string' ? 'text/plain' : 'application/octet-stream',
  };
}

/** Replace one project-owned source file through checksum-guarded project history. */
export function replaceProjectSource(
  backend: SourceWriteBackend,
  history: HistoryService,
  options: { readonly file: string; readonly source: string; readonly label: string },
): Promise<boolean> {
  if (!backend.readSource || !backend.applySource) {
    return Promise.reject(new Error('This editor tier cannot write project source.'));
  }
  return sourceHistoryManager(backend, history).replaceSource(
    options.label,
    options.file,
    options.source,
  );
}

/** Routes the existing React authoring seam through prepare → HistoryService → guarded apply. */
export function withProjectSourceHistory(
  backend: SourceWriteBackend | undefined,
  history: HistoryService | null,
): SourceWriteBackend | undefined {
  if (!backend || !history || !backend.prepare || !backend.readSource || !backend.applySource) {
    return backend;
  }
  const manager = sourceHistoryManager(backend, history);
  const commit = (label: string, request: SourceEditRequest) => manager!.commit(label, request);
  const activeManager = manager;
  return {
    ...backend,
    historyManaged: true,
    runGesture: (label, operation) => activeManager.runGesture(label, operation),
    writeStyle: (oid, prop, value) =>
      commit(`Set ${prop}`, { kind: 'style', oid, prop, value }) as ReturnType<
        SourceWriteBackend['writeStyle']
      >,
    removeStyle: (oid, prop) =>
      commit(`Remove ${prop}`, { kind: 'style', oid, prop, value: null }) as ReturnType<
        SourceWriteBackend['removeStyle']
      >,
    writeCss: (file, selector, prop, value, media) =>
      commit(`Set ${prop}`, {
        kind: 'css',
        file,
        selector,
        prop,
        value,
        ...(media !== undefined ? { media } : {}),
      }),
    writeText: (oid, text) => commit('Edit Text', { kind: 'text', oid, text }),
    writeProp: (oid, prop, value, opts) =>
      commit(`Set ${prop}`, {
        kind: 'prop',
        oid,
        prop,
        value,
        ...(opts?.addIfMissing ? { addIfMissing: true } : {}),
        ...(opts?.allowShapeUpgrade ? { allowShapeUpgrade: true } : {}),
      }),
    // H4 — the inspector's revert arrow. It used to fall through the `...backend`
    // spread to the RAW backend: the attribute really was deleted, but outside
    // the transaction, so it left no undo entry and no checksum guard while
    // every other write on this seam had both. Same `value: null` removal
    // sentinel `removeStyle` above uses.
    removeProp: (oid, prop) =>
      commit(`Revert ${prop}`, { kind: 'prop', oid, prop, value: null }) as ReturnType<
        NonNullable<SourceWriteBackend['removeProp']>
      >,
    writeComponentDefault: (oid, prop, value) =>
      commit(`Apply ${prop} to Component`, {
        kind: 'component-default',
        oid,
        prop,
        value,
      }) as ReturnType<NonNullable<SourceWriteBackend['writeComponentDefault']>>,
    writeStruct: (oid, op, options) =>
      commit(`${op[0]?.toUpperCase() ?? ''}${op.slice(1)}`, {
        kind: 'struct',
        oid,
        op,
        ...options,
      }),
    writeStructMany: (oids, op, options) =>
      commit(`${op[0]?.toUpperCase() ?? ''}${op.slice(1)} ${oids.length} Elements`, {
        kind: 'struct-many',
        oids,
        op,
        ...options,
      }),
  };
}
