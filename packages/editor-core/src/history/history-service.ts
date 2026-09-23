import { emitHistoryElement, historyDelegate, historyDelegateInstalled, subscribeHistoryDelegate } from './history-delegate';
import { PersistenceCoordinator } from './persistence-coordinator';
import { ResourceRegistry } from './resource-registry';
import { SnapshotStore } from './snapshot-store';
import type {
  HistoryBudget,
  HistoryError,
  HistoryEviction,
  HistoryLimitWarning,
  HistoryStatus,
  HistoryTransaction,
  ResourceChange,
  ResourceDriver,
  ResourceKey,
  ResourceSnapshot,
  SnapshotRef,
} from './types';

const DEFAULT_MAX_TRANSACTIONS = 2000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_TRANSACTION_BYTES = 16 * 1024 * 1024;

/**
 * Fraction of the nearest-binding budget at which the user is told they are
 * running out of undo depth. Early enough to raise a limit before anything is
 * lost; late enough that ordinary sessions never see it.
 */
const LIMIT_WARNING_THRESHOLD = 0.8;

/** What `ResourceRegistry.registerProject` prefixes a project-relative path
 *  with. Spelled once, beside the only reader that has to strip it. */
const PROJECT_LOCATION_PREFIX = 'project://';

export interface HistoryLimits {
  readonly maxTransactions: number;
  readonly maxBytes: number;
  readonly maxTransactionBytes: number;
}

export interface TransactionOptions {
  readonly label: string;
  readonly detail?: string;
  readonly resources: readonly ResourceKey[];
  readonly scope: 'project' | 'session';
  readonly sessionId?: string;
  readonly mergeKey?: string;
}

export interface HistoryTransactionContext {
  read(resource: ResourceKey): Promise<ResourceSnapshot>;
  write(resource: ResourceKey, bytes: Uint8Array, contentType?: string): Promise<void>;
  writeText(resource: ResourceKey, text: string, contentType?: string): Promise<void>;
  writeJson(resource: ResourceKey, value: unknown): Promise<void>;
}

export interface AppliedResourceChange {
  readonly resource: ResourceKey;
  readonly beforeBytes: Uint8Array;
  readonly afterBytes: Uint8Array;
  readonly contentType: string;
}

export interface HistorySnapshot {
  readonly version: number;
  readonly transactions: readonly HistoryTransaction[];
  readonly cursor: number;
  readonly busy: boolean;
  readonly blocked: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly uniqueSnapshotBytes: number;
  readonly lastError: HistoryError | null;
  /**
   * Set once per crossing of {@link LIMIT_WARNING_THRESHOLD} on whichever budget
   * is nearest to binding, and cleared when pressure falls back below it. The
   * same warning object persists across later commits, so a caller can compare
   * identity to tell a fresh crossing from a still-standing one.
   */
  readonly limitWarning: HistoryLimitWarning | null;
  /** The most recent trim that actually dropped entries, if any. */
  readonly lastEviction: HistoryEviction | null;
}

export interface HistoryServiceOptions {
  readonly registry?: ResourceRegistry;
  readonly snapshots?: SnapshotStore;
  readonly persistence?: PersistenceCoordinator;
  readonly limits?: Partial<HistoryLimits>;
  readonly makeId?: () => string;
  readonly now?: () => number;
}

interface StagedResource {
  readonly driver: ResourceDriver;
  readonly beforeSnapshot: ResourceSnapshot;
  readonly before: SnapshotRef;
  afterBytes: Uint8Array;
  afterContentType: string;
  beforeOwned: boolean;
}

interface MutableTransaction extends Omit<HistoryTransaction, 'status' | 'error'> {
  status: HistoryStatus;
  error: HistoryError | null;
}

export class HistoryOperationError extends Error {
  constructor(readonly historyError: HistoryError) {
    super(historyError.message);
    this.name = 'HistoryOperationError';
  }
}

function defaultId(): string {
  return crypto.randomUUID();
}

/**
 * THE REFUSING SENTENCE behind a failure, or `null` when the cause carries
 * none.
 *
 * Measured 2026-09-19 under the Code-OSS frame: `vgaiFiles.write` refused to
 * write over a Monaco model holding unsaved keystrokes — by name, naming the
 * file and what to do about it — and the only thing any door said was
 * *"Source write rolled back: Failed to apply “Set position”; prior state was
 * restored. (apply-failed)"*. The refusal was RIGHT THERE, as this error's
 * `cause`, and every reader of the failure — the console ledger, `vgai
 * console`, the document's own message — restated the generic half and threw
 * the specific half away. A rollback line that cannot say WHY is a line that
 * sends its reader to look somewhere else.
 *
 * So the cause's own sentence is carried in `message`, at the one place every
 * `HistoryError` is built. `cause` stays too: it is the object, this is the
 * words.
 */
function causeSentence(cause: unknown): string | null {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : null;
  const text = raw?.trim();
  return text ? text : null;
}

function historyError(
  code: HistoryError['code'],
  message: string,
  resources: readonly ResourceKey[],
  cause?: unknown,
): HistoryError {
  const why = causeSentence(cause);
  const said =
    why && !message.includes(why) ? `${message} ${why.endsWith('.') ? why : `${why}.`}` : message;
  const error: HistoryError = { code, message: said, resources };
  return cause === undefined ? error : { ...error, cause };
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * History lives only in this tab's memory, so the honest subject of both
 * messages is undo depth in the current editing session — never saved files,
 * which nothing here touches. The byte wording states the step count too,
 * because "you are nowhere near 2000 steps and are still about to lose depth"
 * is the fact a count-only warning would hide.
 */
function limitWarningMessage(
  budget: HistoryBudget,
  entryCount: number,
  bytes: number,
  limits: HistoryLimits,
): string {
  return budget === 'transactions'
    ? `Undo history is near its step limit — ${entryCount} of ${limits.maxTransactions} steps ` +
        'in this editing session. Older steps will start dropping; raise maxTransactions to keep more.'
    : `Undo history is near its memory limit — ${formatMegabytes(bytes)} of ` +
        `${formatMegabytes(limits.maxBytes)} of in-memory snapshots, at only ${entryCount} of ` +
        `${limits.maxTransactions} steps. Memory binds first here; raise maxBytes to keep more.`;
}

function evictionMessage(
  budget: HistoryBudget,
  droppedCount: number,
  limits: HistoryLimits,
): string {
  const ceiling =
    budget === 'transactions'
      ? `${limits.maxTransactions}-step limit`
      : `${formatMegabytes(limits.maxBytes)} memory limit`;
  return (
    `Undo history dropped ${plural(droppedCount, 'older step')} to stay within its ${ceiling}. ` +
    'Those edits can no longer be undone; saved files are unaffected.'
  );
}

function transactionBytes(changes: readonly ResourceChange[]): number {
  const blobs = new Map<string, number>();
  for (const change of changes) {
    blobs.set(change.before.blobKey, change.before.byteLength);
    blobs.set(change.after.blobKey, change.after.byteLength);
  }
  let total = 0;
  for (const length of blobs.values()) total += length;
  return total;
}

/** One authoritative, async undo/redo timeline for an open project session. */
export class HistoryService {
  readonly registry: ResourceRegistry;
  readonly snapshots: SnapshotStore;
  readonly persistence: PersistenceCoordinator;
  readonly limits: HistoryLimits;

  private readonly drivers = new Map<ResourceKey, ResourceDriver>();
  private readonly listeners = new Set<() => void>();
  private readonly commitListeners = new Set<(transaction: HistoryTransaction) => void>();
  private readonly makeId: () => string;
  private readonly now: () => number;
  private entries: MutableTransaction[] = [];
  private cursorValue = 0;
  private version = 0;
  private pendingExecutions = 0;
  private pendingProducers = 0;
  private activeTransaction = false;
  private disposeRequested = false;
  private disposeComplete = false;
  private blockedValue = false;
  private lastErrorValue: HistoryError | null = null;
  private limitWarningValue: HistoryLimitWarning | null = null;
  private lastEvictionValue: HistoryEviction | null = null;
  private droppedTotal = 0;
  private executionTail: Promise<void> = Promise.resolve();
  private publicSnapshot: HistorySnapshot;
  private readonly unsubscribeOwner: () => void;

  constructor(options: HistoryServiceOptions = {}) {
    this.registry = options.registry ?? new ResourceRegistry();
    this.snapshots = options.snapshots ?? new SnapshotStore();
    this.persistence = options.persistence ?? new PersistenceCoordinator();
    this.makeId = options.makeId ?? defaultId;
    this.now = options.now ?? Date.now;
    this.limits = {
      maxTransactions: options.limits?.maxTransactions ?? DEFAULT_MAX_TRANSACTIONS,
      maxBytes: options.limits?.maxBytes ?? DEFAULT_MAX_BYTES,
      maxTransactionBytes: options.limits?.maxTransactionBytes ?? DEFAULT_MAX_TRANSACTION_BYTES,
    };
    if (
      this.limits.maxTransactions < 1 ||
      this.limits.maxBytes < 1 ||
      this.limits.maxTransactionBytes < 1 ||
      this.limits.maxTransactionBytes > this.limits.maxBytes
    ) {
      throw new Error('History limits must be positive.');
    }
    this.publicSnapshot = this.buildSnapshot();
    this.unsubscribeOwner = subscribeHistoryDelegate(() => this.notify());
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposeRequested) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HistorySnapshot => {
    // Focus may move between documents without changing any history entry.
    // Keep the external-store snapshot stable unless the native answer changes.
    if (historyDelegateInstalled()) {
      const next = this.buildSnapshot();
      if (next.canUndo !== this.publicSnapshot.canUndo || next.canRedo !== this.publicSnapshot.canRedo ||
          next.undoLabel !== this.publicSnapshot.undoLabel || next.redoLabel !== this.publicSnapshot.redoLabel)
        this.publicSnapshot = next;
    }
    return this.publicSnapshot;
  };

  subscribeCommits(listener: (transaction: HistoryTransaction) => void): () => void {
    this.assertNotDisposed();
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  /** Reserves shell ordering while an async producer prepares a transaction. */
  reserveProducer(): () => void {
    this.assertNotDisposed();
    this.pendingProducers++;
    this.notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pendingProducers--;
      this.finishDisposeIfIdle();
      if (!this.disposeComplete) this.notify();
    };
  }

  registerDriver(driver: ResourceDriver): () => void {
    this.assertNotDisposed();
    const key = driver.descriptor.key;
    const registered = this.registry.get(key);
    if (!registered) throw new Error(`Driver resource "${key}" is not registered.`);
    if (this.drivers.has(key)) throw new Error(`Resource "${key}" already has a driver.`);
    this.drivers.set(key, driver);
    return () => {
      if (this.drivers.get(key) === driver) this.drivers.delete(key);
    };
  }

  transaction<T>(
    options: TransactionOptions,
    operation: (tx: HistoryTransactionContext) => Promise<T> | T,
  ): Promise<T> {
    this.validateOptions(options);
    if (this.activeTransaction) {
      return Promise.reject(
        new HistoryOperationError(
          historyError('busy', 'A history transaction cannot nest another transaction.', []),
        ),
      );
    }
    return this.enqueue(() => this.transactionNow(options, operation));
  }

  private async transactionNow<T>(
    options: TransactionOptions,
    operation: (tx: HistoryTransactionContext) => Promise<T> | T,
  ): Promise<T> {
    this.assertCanStartTransaction();

    this.activeTransaction = true;
    this.notify();
    const allowed = new Set(options.resources);
    const staged = new Map<ResourceKey, StagedResource>();
    const ensureStaged = async (resource: ResourceKey): Promise<StagedResource> => {
      if (!allowed.has(resource)) {
        throw new Error(`Transaction did not declare resource "${resource}".`);
      }
      const existing = staged.get(resource);
      if (existing) return existing;
      const driver = this.requireDriver(resource);
      this.validateResourceScope(driver, options);
      const beforeSnapshot = await driver.capture();
      const before = await this.storeCapturedSnapshot(beforeSnapshot);
      const state: StagedResource = {
        driver,
        beforeSnapshot,
        before,
        afterBytes: Uint8Array.from(beforeSnapshot.bytes),
        afterContentType: beforeSnapshot.contentType,
        beforeOwned: true,
      };
      staged.set(resource, state);
      return state;
    };

    const context: HistoryTransactionContext = {
      read: async (resource) => {
        const state = await ensureStaged(resource);
        return {
          revision: state.beforeSnapshot.revision,
          contentType: state.afterContentType,
          bytes: Uint8Array.from(state.afterBytes),
          sha256: state.beforeSnapshot.sha256,
        };
      },
      write: async (resource, bytes, contentType) => {
        const state = await ensureStaged(resource);
        state.afterBytes = Uint8Array.from(bytes);
        state.afterContentType = contentType ?? state.afterContentType;
      },
      writeText: async (resource, text, contentType = 'text/plain') => {
        await context.write(resource, new TextEncoder().encode(text), contentType);
      },
      writeJson: async (resource, value) => {
        await context.writeText(resource, JSON.stringify(value, null, 2), 'application/json');
      },
    };

    try {
      const result = await operation(context);
      const changes = await this.finishStaging(staged);
      if (changes.length === 0) return result;
      await this.commitStagedTransaction(options, changes);
      return result;
    } finally {
      // Any before refs left in a staging map with no matching committed change
      // are released by finishStaging. If the callback throws before that point,
      // release them here.
      for (const state of staged.values()) {
        if (state.beforeOwned) this.snapshots.release(state.before);
      }
      this.activeTransaction = false;
      this.finishDisposeIfIdle();
      if (!this.disposeComplete) this.notify();
    }
  }

  /**
   * THE HOST SHAPE'S undo: one step back along this service's own cursor.
   * Under frame ownership there is no such step to take — the one ordered
   * stack is the frame's, and an entry is reverted through the element the
   * frame holds ({@link executeEntry}) — so this refuses by name rather than
   * quietly walking a cursor nobody is driving.
   */
  undo(): Promise<boolean> {
    if (historyDelegateInstalled()) return Promise.resolve(this.delegateOrRefuse('undo'));
    return this.enqueue(() => this.undoNow());
  }

  redo(): Promise<boolean> {
    if (historyDelegateInstalled()) return Promise.resolve(this.delegateOrRefuse('redo'));
    return this.enqueue(() => this.redoNow());
  }

  /**
   * Revert or reapply ONE recorded entry, addressed by id rather than by
   * cursor. This is what a {@link HistoryElement} the frame holds calls: VS
   * Code's `IUndoRedoService` decides WHICH element is next (per resource, in
   * its own order), and this service only knows how to put that entry's
   * before-bytes back. The cursor is deliberately not moved — under frame
   * ownership it means nothing, and under host ownership nothing calls this.
   */
  executeEntry(id: string, direction: 'undo' | 'redo'): Promise<boolean> {
    return this.enqueue(async () => {
      const transaction = this.entries.find((entry) => entry.id === id);
      if (!transaction) {
        this.lastErrorValue = historyError(
          'expired',
          `History entry "${id}" is no longer recorded, so it cannot be ${direction}ne.`,
          [],
        );
        this.notify();
        return false;
      }
      if (transaction.status === 'expired') {
        const error = historyError(
          'expired',
          `“${transaction.label}” belongs to an expired session.`,
          [],
        );
        transaction.error = error;
        this.lastErrorValue = error;
        this.notify();
        return false;
      }
      return this.executeExisting(transaction, direction, false);
    });
  }

  /**
   * Every editor affordance that says "undo" — the Edit menu, the palette,
   * `vgai eval` — goes through here, so under the frame they all reach the
   * ONE stack instead of walking a cursor nobody is driving. A frame that has
   * not installed its undo yet gets a named refusal rather than silence.
   */
  private async delegateOrRefuse(direction: 'undo' | 'redo'): Promise<boolean> {
    const delegate = historyDelegate();
    if (delegate) {
      // A handled keyboard command is not evidence that history moved. In
      // particular, a native document may have no entry on Code-OSS's stack.
      if (!(direction === 'undo' ? delegate.canUndo() : delegate.canRedo())) return false;
      try {
        const moved = direction === 'undo' ? await delegate.undo() : await delegate.redo();
        return moved !== false;
      } finally {
        this.notify();
      }
    }
    this.lastErrorValue = historyError(
      'busy',
      `History ${direction} belongs to the frame while the editor runs inside one, ` +
        'and the frame has not installed its undo yet.',
      [],
    );
    this.notify();
    return false;
  }

  /**
   * Journals an editor mutation whose exact before/after bytes were captured in
   * the same synchronous UI turn. The command queue is shared with undo/redo, so
   * an immediate shortcut always runs after this entry becomes authoritative.
   */
  recordAppliedTransaction(
    options: TransactionOptions,
    applied: readonly AppliedResourceChange[],
  ): Promise<boolean> {
    this.assertCanRecordAppliedChange();
    this.validateOptions(options);
    if (applied.length === 0) return Promise.resolve(false);
    const declared = new Set(options.resources);
    if (
      applied.length !== declared.size ||
      applied.some((change) => !declared.has(change.resource))
    ) {
      return Promise.reject(
        new Error('Applied history changes must exactly match declared resources.'),
      );
    }
    // Resolve drivers before queueing. A synchronous document switch may retire
    // the resource before this journal task runs, but the already-applied edit
    // must still be recorded (as expired), never rejected or retargeted.
    for (const change of applied) {
      const driver = this.requireDriver(change.resource);
      this.validateResourceScope(driver, options);
    }
    return this.enqueue(async () => {
      this.assertCanRecordAppliedChange();
      const changes: ResourceChange[] = [];
      try {
        for (const change of applied) {
          const before = await this.snapshots.put({
            revision: 0,
            contentType: change.contentType,
            bytes: change.beforeBytes,
          });
          const after = await this.snapshots.put({
            revision: 1,
            contentType: change.contentType,
            bytes: change.afterBytes,
          });
          if (before.sha256 === after.sha256) {
            this.snapshots.release(before);
            this.snapshots.release(after);
            continue;
          }
          changes.push({ resource: change.resource, before, after });
        }
        if (changes.length === 0) return false;
        this.appendAppliedTransaction(options, changes);
        return true;
      } catch (error) {
        this.releaseChanges(changes);
        this.lastErrorValue =
          error instanceof HistoryOperationError
            ? error.historyError
            : historyError(
                'apply-failed',
                `Failed to journal “${options.label.trim()}”.`,
                applied.map((change) => change.resource),
                error,
              );
        this.notify();
        throw error;
      }
    });
  }

  /** Preflight for producers that mutate state before journaling it. */
  assertCanRecordAppliedChange(): void {
    this.assertNotDisposed();
    if (this.blockedValue) {
      if (this.lastErrorValue?.code === 'compensation-failed') {
        throw new HistoryOperationError(this.lastErrorValue);
      }
      throw new HistoryOperationError(
        historyError('compensation-failed', 'History is blocked pending recovery.', []),
      );
    }
  }

  /** Surface a recovered producer failure without blocking later safe edits. */
  reportAppliedChangeFailure(
    label: string,
    resources: readonly ResourceKey[],
    cause: unknown,
  ): void {
    if (this.blockedValue) return;
    this.lastErrorValue = historyError(
      'apply-failed',
      `Failed to apply “${label.trim()}”; prior state was restored.`,
      resources,
      cause,
    );
    this.notify();
  }

  /**
   * Permanently blocks history after an already-applied producer could not
   * restore exact prior bytes. Producers outside HistoryService's own apply
   * loop use this to surface the same loud recovery state as undo/redo.
   */
  blockForCompensationFailure(
    label: string,
    resources: readonly ResourceKey[],
    cause: unknown,
  ): HistoryOperationError {
    if (this.blockedValue && this.lastErrorValue?.code === 'compensation-failed') {
      return new HistoryOperationError(this.lastErrorValue);
    }
    const problem = historyError(
      'compensation-failed',
      `History recovery failed while applying “${label.trim()}”.`,
      resources,
      cause,
    );
    this.blockedValue = true;
    this.lastErrorValue = problem;
    this.notify();
    return new HistoryOperationError(problem);
  }

  jumpTo(cursor: number): Promise<boolean> {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.entries.length) {
      return Promise.reject(new Error(`History cursor ${cursor} is out of range.`));
    }
    return this.enqueue(async () => {
      while (this.cursorValue > cursor) {
        if (!(await this.undoNow())) return false;
      }
      while (this.cursorValue < cursor) {
        if (!(await this.redoNow())) return false;
      }
      return true;
    });
  }

  expireSession(sessionId: string): void {
    if (this.disposeRequested) return;
    const resources = new Set(this.registry.expireSession(sessionId));
    if (resources.size === 0) return;
    this.entries = this.entries.map((entry) =>
      entry.sessionId === sessionId ||
      entry.changes.some((change) => resources.has(change.resource))
        ? { ...entry, status: 'expired', error: null }
        : entry,
    );
    this.notify();
  }

  expireResources(resources: Iterable<ResourceKey>): void {
    if (this.disposeRequested) return;
    const expired = new Set(this.registry.expireResources(resources));
    if (expired.size === 0) return;
    this.entries = this.entries.map((entry) =>
      entry.changes.some((change) => expired.has(change.resource))
        ? { ...entry, status: 'expired', error: null }
        : entry,
    );
    this.notify();
  }

  dispose(): void {
    if (this.disposeRequested) return;
    this.disposeRequested = true;
    this.unsubscribeOwner();
    this.listeners.clear();
    this.commitListeners.clear();
    this.finishDisposeIfIdle();
  }

  private finishDisposeIfIdle(): void {
    if (
      !this.disposeRequested ||
      this.disposeComplete ||
      this.activeTransaction ||
      this.pendingExecutions > 0 ||
      this.pendingProducers > 0
    ) {
      return;
    }
    for (const entry of this.entries) this.releaseChanges(entry.changes);
    this.entries = [];
    this.cursorValue = 0;
    this.drivers.clear();
    this.registry.clear();
    this.snapshots.clear();
    this.blockedValue = false;
    this.lastErrorValue = null;
    this.limitWarningValue = null;
    this.lastEvictionValue = null;
    this.droppedTotal = 0;
    this.disposeComplete = true;
    this.notify();
  }

  private async finishStaging(staged: Map<ResourceKey, StagedResource>): Promise<ResourceChange[]> {
    const changes: ResourceChange[] = [];
    try {
      for (const [resource, state] of staged) {
        const after = await this.snapshots.put({
          revision: state.beforeSnapshot.revision + 1,
          contentType: state.afterContentType,
          bytes: state.afterBytes,
        });
        if (after.sha256 === state.before.sha256) {
          this.snapshots.release(after);
          this.snapshots.release(state.before);
          state.beforeOwned = false;
          continue;
        }
        changes.push({ resource, before: state.before, after });
        state.beforeOwned = false;
      }
      return changes;
    } catch (error) {
      this.releaseChanges(changes);
      throw error;
    }
  }

  private async commitStagedTransaction(
    options: TransactionOptions,
    changes: readonly ResourceChange[],
  ): Promise<void> {
    const byteSize = transactionBytes(changes);
    if (byteSize > this.limits.maxTransactionBytes) {
      this.releaseChanges(changes);
      throw new HistoryOperationError(
        historyError(
          'history-limit',
          `Transaction requires ${byteSize} bytes; the limit is ${this.limits.maxTransactionBytes}.`,
          changes.map((change) => change.resource),
        ),
      );
    }

    const transaction: MutableTransaction = {
      id: this.makeId(),
      label: options.label.trim(),
      detail: options.detail?.trim() || null,
      timestamp: this.now(),
      scope: options.scope,
      sessionId: options.scope === 'session' ? options.sessionId! : null,
      changes,
      byteSize,
      mergeKey: options.mergeKey?.trim() || null,
      status: 'committed',
      error: null,
    };

    try {
      this.assertCanRecordAppliedChange();
      await this.persistence.runMany(
        changes.map((change) => change.resource),
        async () => {
          this.assertCanRecordAppliedChange();
          await this.preflight(transaction, 'redo');
          await this.applyWithCompensation(transaction, 'redo');
        },
      );
    } catch (error) {
      const problem =
        error instanceof HistoryOperationError
          ? error.historyError
          : historyError(
              'apply-failed',
              `Failed to commit “${transaction.label}”.`,
              changes.map((change) => change.resource),
              error,
            );
      this.lastErrorValue = problem;
      if (problem.code === 'compensation-failed') this.blockedValue = true;
      this.releaseChanges(changes);
      this.notify();
      throw error;
    }

    this.truncateRedo();
    this.entries.push(transaction);
    this.cursorValue = this.entries.length;
    if (!this.blockedValue) this.lastErrorValue = null;
    this.trimToLimits();
    this.notify();
    for (const listener of this.commitListeners) listener(transaction);
    this.offerElement(transaction);
  }

  private appendAppliedTransaction(
    options: TransactionOptions,
    changes: readonly ResourceChange[],
  ): void {
    const byteSize = transactionBytes(changes);
    if (byteSize > this.limits.maxTransactionBytes) {
      this.releaseChanges(changes);
      throw new HistoryOperationError(
        historyError(
          'history-limit',
          `Transaction requires ${byteSize} bytes; the limit is ${this.limits.maxTransactionBytes}.`,
          changes.map((change) => change.resource),
        ),
      );
    }
    const transaction: MutableTransaction = {
      id: this.makeId(),
      label: options.label.trim(),
      detail: options.detail?.trim() || null,
      timestamp: this.now(),
      scope: options.scope,
      sessionId: options.scope === 'session' ? options.sessionId! : null,
      changes,
      byteSize,
      mergeKey: options.mergeKey?.trim() || null,
      status: changes.every((change) => this.registry.isActive(change.resource))
        ? 'committed'
        : 'expired',
      error: null,
    };
    this.truncateRedo();
    this.entries.push(transaction);
    this.cursorValue = this.entries.length;
    if (!this.blockedValue) this.lastErrorValue = null;
    this.trimToLimits();
    this.notify();
    for (const listener of this.commitListeners) listener(transaction);
    this.offerElement(transaction);
  }

  /**
   * Offer a freshly committed transaction to whoever owns undo. A no-op under
   * host ownership (`history-delegate.ts` drops it), so the standalone shape
   * pays nothing for this seam.
   *
   * `resources` is the project-relative path per change, in the transaction's
   * own order, taken from each resource's registered `project://<path>`
   * location — that path is what lets the frame key the element on the SAME
   * `file:` URI Monaco holds for the file. A SESSION-scoped resource (a live
   * journal) has no such path and contributes none; a transaction made only of
   * those arrives with an empty list, which is a fact for the frame to decide
   * about rather than one this service may paper over.
   */
  private offerElement(transaction: MutableTransaction): void {
    if (!historyDelegateInstalled()) return;
    const resources: string[] = [];
    for (const change of transaction.changes) {
      const location = this.registry.get(change.resource)?.location;
      if (!location?.startsWith(PROJECT_LOCATION_PREFIX)) continue;
      const path = location.slice(PROJECT_LOCATION_PREFIX.length);
      if (!resources.includes(path)) resources.push(path);
    }
    emitHistoryElement({
      id: transaction.id,
      label: transaction.label,
      resources,
      undo: () => this.executeEntry(transaction.id, 'undo'),
      redo: () => this.executeEntry(transaction.id, 'redo'),
    });
  }

  private async undoNow(): Promise<boolean> {
    if (this.cursorValue === 0 || this.blockedValue) return false;
    const transaction = this.entries[this.cursorValue - 1]!;
    if (transaction.status === 'expired') {
      const error = historyError(
        'expired',
        `“${transaction.label}” belongs to an expired session.`,
        [],
      );
      transaction.error = error;
      this.lastErrorValue = error;
      this.notify();
      return false;
    }
    return this.executeExisting(transaction, 'undo');
  }

  private async redoNow(): Promise<boolean> {
    if (this.cursorValue >= this.entries.length || this.blockedValue) return false;
    const transaction = this.entries[this.cursorValue]!;
    if (transaction.status === 'expired') {
      const error = historyError(
        'expired',
        `“${transaction.label}” belongs to an expired session.`,
        [],
      );
      transaction.error = error;
      this.lastErrorValue = error;
      this.notify();
      return false;
    }
    return this.executeExisting(transaction, 'redo');
  }

  private async executeExisting(
    transaction: MutableTransaction,
    direction: 'undo' | 'redo',
    moveCursor = true,
  ): Promise<boolean> {
    const resources = transaction.changes.map((change) => change.resource);
    try {
      await this.persistence.runMany(resources, async () => {
        await this.preflight(transaction, direction);
        transaction.status = direction === 'undo' ? 'undoing' : 'redoing';
        transaction.error = null;
        this.notify();
        await this.applyWithCompensation(transaction, direction);
      });
      if (direction === 'undo') {
        if (moveCursor) this.cursorValue--;
        transaction.status = 'undone';
      } else {
        if (moveCursor) this.cursorValue++;
        transaction.status = 'committed';
      }
      transaction.error = null;
      this.lastErrorValue = null;
      this.notify();
      return true;
    } catch (error) {
      const problem =
        error instanceof HistoryOperationError
          ? error.historyError
          : historyError(
              'apply-failed',
              `Failed to ${direction} “${transaction.label}”.`,
              resources,
              error,
            );
      transaction.error = problem;
      transaction.status = problem.code === 'compensation-failed' ? 'failed-partial' : 'failed';
      this.lastErrorValue = problem;
      if (problem.code === 'compensation-failed') this.blockedValue = true;
      this.notify();
      return false;
    }
  }

  private async preflight(
    transaction: MutableTransaction,
    direction: 'undo' | 'redo',
  ): Promise<void> {
    for (const change of transaction.changes) {
      if (!this.registry.isActive(change.resource)) {
        throw new HistoryOperationError(
          historyError('expired', `Resource "${change.resource}" is unavailable.`, [
            change.resource,
          ]),
        );
      }
      const expected = direction === 'undo' ? change.after : change.before;
      const result = await this.requireDriver(change.resource).preflight(expected);
      if (!result.ok) {
        throw new HistoryOperationError(
          historyError(
            result.reason === 'expired' ? 'expired' : 'conflict',
            `Resource "${change.resource}" no longer matches “${transaction.label}”.`,
            [change.resource],
          ),
        );
      }
    }
  }

  private async applyWithCompensation(
    transaction: MutableTransaction,
    direction: 'undo' | 'redo',
  ): Promise<void> {
    const ordered =
      direction === 'undo' ? [...transaction.changes].reverse() : [...transaction.changes];
    const applied: ResourceChange[] = [];
    try {
      for (const change of ordered) {
        const target = direction === 'undo' ? change.before : change.after;
        await this.requireDriver(change.resource).restore(target);
        applied.push(change);
      }
    } catch (applyError) {
      try {
        for (const change of [...applied].reverse()) {
          const compensation = direction === 'undo' ? change.after : change.before;
          await this.requireDriver(change.resource).restore(compensation);
        }
      } catch (compensationError) {
        throw new HistoryOperationError(
          historyError(
            'compensation-failed',
            `History recovery failed while applying “${transaction.label}”.`,
            transaction.changes.map((change) => change.resource),
            { applyError, compensationError },
          ),
        );
      }
      throw new HistoryOperationError(
        historyError(
          'apply-failed',
          `Failed to apply “${transaction.label}”; prior state was restored.`,
          transaction.changes.map((change) => change.resource),
          applyError,
        ),
      );
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposeRequested) return Promise.reject(new Error('History service is disposed.'));
    this.pendingExecutions++;
    this.notify();
    const run = () => {
      this.assertNotDisposed();
      return operation();
    };
    const result = this.executionTail.then(run, run);
    this.executionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.pendingExecutions--;
      this.finishDisposeIfIdle();
      if (!this.disposeComplete) this.notify();
    });
  }

  private async storeCapturedSnapshot(snapshot: ResourceSnapshot): Promise<SnapshotRef> {
    const ref = await this.snapshots.put({
      revision: snapshot.revision,
      contentType: snapshot.contentType,
      bytes: snapshot.bytes,
    });
    if (ref.sha256 !== snapshot.sha256) {
      this.snapshots.release(ref);
      throw new Error('Resource driver returned bytes that do not match its SHA-256.');
    }
    return ref;
  }

  private truncateRedo(): void {
    if (this.cursorValue === this.entries.length) return;
    for (const entry of this.entries.slice(this.cursorValue)) this.releaseChanges(entry.changes);
    this.entries = this.entries.slice(0, this.cursorValue);
  }

  private trimToLimits(): void {
    // THE SERVICE CAPS NOTHING UNDER THE FRAME (ARCHITECTURE-CORE §The core is
    // Code-OSS). Dropping an entry the frame still holds an element for would
    // make that element's undo refuse for a reason the person never caused, so
    // eviction is the host shape's alone. The PRESSURE is still reported — the
    // limit warning below reaches the vgai console through
    // `history-limit-notices.ts` — because a standing warning naming its
    // mechanism is the doctrine, and a silent unbounded stack is not.
    if (historyDelegateInstalled()) {
      this.evaluateLimitWarning();
      return;
    }
    let dropped = 0;
    let budget: HistoryBudget | null = null;
    while (this.entries.length > 1) {
      const overBytes = this.snapshots.uniqueByteLength > this.limits.maxBytes;
      const overCount = this.entries.length > this.limits.maxTransactions;
      if (!overBytes && !overCount) break;
      // The budget still binding on the final pass is the one that cost the user
      // this depth, so report that one rather than whichever tripped first.
      budget = overBytes ? 'bytes' : 'transactions';
      const [oldest, ...rest] = this.entries;
      this.entries = rest;
      this.releaseChanges(oldest!.changes);
      this.cursorValue = Math.max(0, this.cursorValue - 1);
      dropped++;
    }
    if (dropped > 0) {
      this.droppedTotal += dropped;
      this.lastEvictionValue = {
        budget: budget!,
        droppedCount: dropped,
        totalDropped: this.droppedTotal,
        // Deliberately free of the running total so repeats collapse in any
        // deduplicating log; the total stays available as a field.
        message: evictionMessage(budget!, dropped, this.limits),
      };
    }
    this.evaluateLimitWarning();
  }

  /**
   * Warns before depth is lost, naming the budget actually closest to binding.
   * Two budgets evict, and for snapshot-heavy work bytes bind long before the
   * step count does — a count-only warning would be wrong in exactly that case.
   */
  private evaluateLimitWarning(): void {
    const transactionRatio = this.entries.length / this.limits.maxTransactions;
    const byteRatio = this.snapshots.uniqueByteLength / this.limits.maxBytes;
    if (Math.max(transactionRatio, byteRatio) < LIMIT_WARNING_THRESHOLD) {
      this.limitWarningValue = null;
      return;
    }
    const budget: HistoryBudget = byteRatio > transactionRatio ? 'bytes' : 'transactions';
    // Re-issue only when the crossing is new, or when a different budget takes
    // over as the binding one — never once per commit while sitting over it.
    if (this.limitWarningValue?.budget === budget) return;
    const bytes = this.snapshots.uniqueByteLength;
    this.limitWarningValue = {
      budget,
      used: budget === 'bytes' ? bytes : this.entries.length,
      limit: budget === 'bytes' ? this.limits.maxBytes : this.limits.maxTransactions,
      message: limitWarningMessage(budget, this.entries.length, bytes, this.limits),
    };
  }

  private releaseChanges(changes: readonly ResourceChange[]): void {
    for (const change of changes) {
      if (this.snapshots.has(change.before)) this.snapshots.release(change.before);
      if (this.snapshots.has(change.after)) this.snapshots.release(change.after);
    }
  }

  private requireDriver(resource: ResourceKey): ResourceDriver {
    const driver = this.drivers.get(resource);
    if (!driver) throw new Error(`No history resource driver is registered for "${resource}".`);
    return driver;
  }

  private validateOptions(options: TransactionOptions): void {
    if (!options.label.trim()) throw new Error('History transaction label cannot be empty.');
    if (options.resources.length === 0) throw new Error('History transaction needs a resource.');
    if (new Set(options.resources).size !== options.resources.length) {
      throw new Error('History transaction resources must be unique.');
    }
    if (options.scope === 'session' && !options.sessionId?.trim()) {
      throw new Error('A session transaction requires a session id.');
    }
    if (options.scope === 'project' && options.sessionId !== undefined) {
      throw new Error('A project transaction cannot have a session id.');
    }
  }

  private assertCanStartTransaction(): void {
    this.assertNotDisposed();
    if (this.blockedValue) {
      throw new HistoryOperationError(
        historyError('compensation-failed', 'History is blocked pending recovery.', []),
      );
    }
    if (this.activeTransaction) {
      throw new HistoryOperationError(
        historyError('busy', 'Another history operation is already in progress.', []),
      );
    }
  }

  private assertNotDisposed(): void {
    if (this.disposeRequested) throw new Error('History service is disposed.');
  }

  private validateResourceScope(driver: ResourceDriver, options: TransactionOptions): void {
    const descriptor = driver.descriptor;
    if (descriptor.scope !== options.scope) {
      throw new Error(`Resource "${descriptor.key}" does not match transaction scope.`);
    }
    if (options.scope === 'session' && descriptor.sessionId !== options.sessionId) {
      throw new Error(`Resource "${descriptor.key}" belongs to another session.`);
    }
  }

  private notify(): void {
    this.version++;
    this.publicSnapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): HistorySnapshot {
    const undo = this.cursorValue > 0 ? this.entries[this.cursorValue - 1]! : null;
    const redo = this.cursorValue < this.entries.length ? this.entries[this.cursorValue]! : null;
    const idle =
      this.pendingExecutions === 0 && this.pendingProducers === 0 && !this.activeTransaction;
    return {
      version: this.version,
      transactions: this.entries.map((entry) => ({
        ...entry,
        changes: entry.changes.map((change) => ({ ...change })),
      })),
      cursor: this.cursorValue,
      busy: !idle,
      blocked: this.blockedValue,
      // Under frame ownership this service's cursor is not undo, so the
      // question belongs to the frame: its delegate answers, and the editor's
      // own Edit menu is enabled exactly when the one stack has a step. The
      // cursor's own reachability would be the wrong answer in both
      // directions.
      canUndo: historyDelegateInstalled()
        ? (historyDelegate()?.canUndo() ?? false)
        : idle && !!undo && undo.status !== 'expired' && !this.blockedValue,
      canRedo: historyDelegateInstalled()
        ? (historyDelegate()?.canRedo() ?? false)
        : idle && !!redo && redo.status !== 'expired' && !this.blockedValue,
      undoLabel: historyDelegateInstalled() ? historyDelegate()?.undoLabel?.() ?? null : undo?.label ?? null,
      redoLabel: historyDelegateInstalled() ? historyDelegate()?.redoLabel?.() ?? null : redo?.label ?? null,
      uniqueSnapshotBytes: this.snapshots.uniqueByteLength,
      lastError: this.lastErrorValue,
      limitWarning: this.limitWarningValue,
      lastEviction: this.lastEvictionValue,
    };
  }
}
