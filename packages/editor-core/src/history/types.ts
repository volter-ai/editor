declare const resourceKeyBrand: unique symbol;

/** Stable for the lifetime of one open project session, including across file moves. */
export type ResourceKey = string & { readonly [resourceKeyBrand]: true };

export type ResourceKind =
  | 'scene'
  | 'ui-tree'
  | 'material'
  | 'data'
  | 'manifest'
  | 'settings'
  | 'source'
  | 'overlay'
  | 'project-file'
  | 'session-state';

export interface ResourceDescriptor {
  readonly key: ResourceKey;
  readonly kind: ResourceKind;
  readonly scope: 'project' | 'session';
  readonly displayName: string;
  readonly location: string | null;
  readonly sessionId: string | null;
}

export interface ResourceSnapshot {
  readonly revision: number;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface SnapshotRef {
  readonly revision: number;
  readonly contentType: string;
  readonly sha256: string;
  readonly blobKey: string;
  readonly byteLength: number;
}

export type PreflightResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'revision-conflict' | 'content-conflict' | 'expired';
      readonly actualRevision?: number;
      readonly actualSha256?: string;
    };

export interface ResourceDriver {
  readonly descriptor: ResourceDescriptor;
  capture(): Promise<ResourceSnapshot>;
  preflight(expected: SnapshotRef): Promise<PreflightResult>;
  restore(snapshot: SnapshotRef): Promise<void>;
  estimateBytes(snapshot: SnapshotRef): number;
}

export type HistoryStatus =
  | 'committed'
  | 'undoing'
  | 'undone'
  | 'redoing'
  | 'failed'
  | 'failed-partial'
  | 'expired';

export interface HistoryError {
  readonly code:
    | 'busy'
    | 'conflict'
    | 'expired'
    | 'apply-failed'
    | 'compensation-failed'
    | 'history-limit';
  readonly message: string;
  readonly resources: readonly ResourceKey[];
  readonly cause?: unknown;
}

/**
 * Two independent budgets evict undo entries, and which one binds first depends
 * entirely on what is being edited. Naming the budget is the whole point of the
 * warning: a count-only warning is a lie whenever bytes bind first.
 */
export type HistoryBudget = 'transactions' | 'bytes';

/** Emitted once per threshold crossing, before any undo depth is actually lost. */
export interface HistoryLimitWarning {
  readonly budget: HistoryBudget;
  /** Entry count, or unique retained snapshot bytes, at the moment of crossing. */
  readonly used: number;
  readonly limit: number;
  readonly message: string;
}

/** Reported whenever trimming actually dropped entries — eviction is never silent. */
export interface HistoryEviction {
  readonly budget: HistoryBudget;
  readonly droppedCount: number;
  /** Entries dropped over the life of this in-memory session. */
  readonly totalDropped: number;
  readonly message: string;
}

export interface ResourceChange {
  readonly resource: ResourceKey;
  readonly before: SnapshotRef;
  readonly after: SnapshotRef;
}

export interface HistoryTransaction {
  readonly id: string;
  readonly label: string;
  readonly detail: string | null;
  readonly timestamp: number;
  readonly scope: 'project' | 'session';
  readonly sessionId: string | null;
  readonly changes: readonly ResourceChange[];
  readonly byteSize: number;
  readonly mergeKey: string | null;
  readonly status: HistoryStatus;
  readonly error: HistoryError | null;
}
