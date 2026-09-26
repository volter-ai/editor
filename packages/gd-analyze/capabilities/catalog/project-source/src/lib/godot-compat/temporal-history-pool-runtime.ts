export type GodotTemporalHistoryRid = string | number;
export type GodotTemporalHistoryReason = 'created' | 'resize' | 'camera-cut' | 'scene-change' | 'settings-change' | 'manual' | 'expired';

export interface GodotTemporalHistoryDescriptor {
  readonly key: string;
  readonly view: GodotTemporalHistoryRid;
  readonly width: number;
  readonly height: number;
  readonly layers?: number;
  readonly format: string;
  readonly samples?: number;
  readonly mipLevels?: number;
  readonly persistent?: boolean;
  readonly clearValue?: unknown;
}

export interface GodotTemporalHistoryLease<TResource = unknown> {
  readonly id: number;
  readonly key: string;
  readonly view: GodotTemporalHistoryRid;
  readonly current: TResource;
  readonly previous: TResource;
  readonly descriptor: Readonly<Required<GodotTemporalHistoryDescriptor>>;
  readonly valid: boolean;
  readonly historyGeneration: number;
  readonly frame: number;
  readonly generation: number;
}

export interface GodotTemporalHistoryInvalidation {
  readonly key: string;
  readonly view: GodotTemporalHistoryRid;
  readonly reason: GodotTemporalHistoryReason;
  readonly historyGeneration: number;
  readonly frame: number;
}

export interface GodotTemporalHistorySnapshot {
  readonly frame: number;
  readonly histories: number;
  readonly resources: number;
  readonly activeLeases: number;
  readonly validHistories: number;
  readonly invalidations: number;
  readonly allocations: number;
  readonly reuses: number;
  readonly retirements: number;
  readonly generation: number;
}

export interface GodotTemporalHistoryBackend<TResource = unknown> {
  create(descriptor: GodotTemporalHistoryDescriptor, index: 0 | 1): TResource;
  clear?(resource: TResource, value: unknown): void;
  destroy(resource: TResource): void;
}

interface HistoryState<TResource> {
  id: number;
  descriptor: Required<GodotTemporalHistoryDescriptor>;
  resources: [TResource, TResource];
  currentIndex: 0 | 1;
  valid: boolean;
  historyGeneration: number;
  lastAcquiredFrame: number;
  lastAdvancedFrame: number;
  leaseCount: number;
  revision: number;
}

interface RetiredResources<TResource> {
  resources: [TResource, TResource];
  retireFrame: number;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires a finite number in [${minimum}, ${maximum}].`);
  }
  return result;
}

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(result)) throw new TypeError(`godot-compat: ${member} requires an integer.`);
  return result;
}

function descriptor(value: GodotTemporalHistoryDescriptor): Required<GodotTemporalHistoryDescriptor> {
  if (typeof value.key !== 'string' || value.key.length === 0) {
    throw new TypeError('godot-compat: temporal history key requires a non-empty string.');
  }
  if (typeof value.format !== 'string' || value.format.length === 0) {
    throw new TypeError('godot-compat: temporal history format requires a non-empty string.');
  }
  return Object.freeze({
    key: value.key,
    view: value.view,
    width: integer(value.width, 'temporal history width', 1, 32768),
    height: integer(value.height, 'temporal history height', 1, 32768),
    layers: integer(value.layers ?? 1, 'temporal history layers', 1, 2048),
    format: value.format,
    samples: integer(value.samples ?? 1, 'temporal history samples', 1, 64),
    mipLevels: integer(value.mipLevels ?? 1, 'temporal history mip levels', 1, 32),
    persistent: value.persistent ?? false,
    clearValue: value.clearValue ?? null,
  });
}

function historyKey(value: Pick<GodotTemporalHistoryDescriptor, 'key' | 'view'>): string {
  return `${typeof value.view}:${String(value.view)}/${value.key}`;
}

function compatible(left: Required<GodotTemporalHistoryDescriptor>, right: Required<GodotTemporalHistoryDescriptor>): boolean {
  return left.width === right.width
    && left.height === right.height
    && left.layers === right.layers
    && left.format === right.format
    && left.samples === right.samples
    && left.mipLevels === right.mipLevels;
}

export class GodotTemporalHistoryPoolRuntime<TResource = unknown> {
  private readonly histories = new Map<string, HistoryState<TResource>>();
  private readonly leases = new Map<number, { history: HistoryState<TResource>; lease: GodotTemporalHistoryLease<TResource> }>();
  private readonly retired: RetiredResources<TResource>[] = [];
  private readonly invalidationWatchers = new Set<(value: GodotTemporalHistoryInvalidation) => void>();
  private readonly snapshotWatchers = new Set<(snapshot: GodotTemporalHistorySnapshot) => void>();
  private frame = 0;
  private nextHistoryId = 1;
  private nextLeaseId = 1;
  private generation = 1;
  private retirementDelay: number;
  private expirationFrames: number;
  private invalidations = 0;
  private allocations = 0;
  private reuses = 0;
  private retirements = 0;

  constructor(
    private backend: GodotTemporalHistoryBackend<TResource>,
    retirementDelay = 3,
    expirationFrames = 120,
  ) {
    this.retirementDelay = integer(retirementDelay, 'temporal history retirement delay', 0, 32);
    this.expirationFrames = integer(expirationFrames, 'temporal history expiration', 1);
  }

  beginFrame(frameValue: number): void {
    const nextFrame = integer(frameValue, 'temporal history frame', 0);
    if (nextFrame < this.frame) throw new RangeError('godot-compat: temporal history frame cannot move backwards.');
    this.frame = nextFrame;
    this.retireDue();
    this.expireUnused();
    this.publishSnapshot();
  }

  acquire(value: GodotTemporalHistoryDescriptor): GodotTemporalHistoryLease<TResource> {
    const next = descriptor(value);
    const key = historyKey(next);
    let history = this.histories.get(key);
    if (history === undefined) {
      history = this.createHistory(next);
      this.histories.set(key, history);
    } else if (!compatible(history.descriptor, next)) {
      this.retire(history.resources);
      history.resources = this.createResources(next);
      history.descriptor = next;
      this.invalidateState(history, 'resize');
      this.allocations += 2;
    } else {
      history.descriptor = next;
      this.reuses++;
    }
    history.lastAcquiredFrame = this.frame;
    history.leaseCount++;
    const id = this.nextLeaseId++;
    const lease = this.lease(id, history);
    this.leases.set(id, { history, lease });
    this.publishSnapshot();
    return lease;
  }

  release(lease: GodotTemporalHistoryLease<TResource>): void {
    const retained = this.requireLease(lease);
    retained.history.leaseCount--;
    retained.history.lastAcquiredFrame = this.frame;
    this.leases.delete(lease.id);
    this.publishSnapshot();
  }

  advance(lease: GodotTemporalHistoryLease<TResource>, markValid = true): GodotTemporalHistoryLease<TResource> {
    const retained = this.requireLease(lease);
    const history = retained.history;
    if (history.lastAdvancedFrame === this.frame) {
      throw new Error('godot-compat: temporal history can only advance once per frame.');
    }
    history.currentIndex = history.currentIndex === 0 ? 1 : 0;
    history.valid = markValid;
    history.lastAdvancedFrame = this.frame;
    history.revision = ++this.generation;
    const updated = this.lease(lease.id, history);
    retained.lease = updated;
    return updated;
  }

  refreshLease(lease: GodotTemporalHistoryLease<TResource>): GodotTemporalHistoryLease<TResource> {
    const retained = this.requireLease(lease);
    const updated = this.lease(lease.id, retained.history);
    retained.lease = updated;
    return updated;
  }

  invalidate(
    keyValue: string,
    view: GodotTemporalHistoryRid,
    reason: GodotTemporalHistoryReason = 'manual',
  ): boolean {
    const history = this.histories.get(historyKey({ key: keyValue, view }));
    if (history === undefined) return false;
    this.invalidateState(history, reason);
    this.publishSnapshot();
    return true;
  }

  invalidateView(view: GodotTemporalHistoryRid, reason: GodotTemporalHistoryReason = 'camera-cut'): number {
    let affected = 0;
    for (const history of this.histories.values()) {
      if (history.descriptor.view !== view) continue;
      this.invalidateState(history, reason);
      affected++;
    }
    this.publishSnapshot();
    return affected;
  }

  invalidateAll(reason: GodotTemporalHistoryReason = 'manual'): void {
    for (const history of this.histories.values()) this.invalidateState(history, reason);
    this.publishSnapshot();
  }

  remove(keyValue: string, view: GodotTemporalHistoryRid, force = false): boolean {
    const key = historyKey({ key: keyValue, view });
    const history = this.histories.get(key);
    if (history === undefined) return false;
    if (!force && history.leaseCount > 0) throw new Error('godot-compat: temporal history still has active leases.');
    for (const [id, lease] of this.leases) if (lease.history === history) this.leases.delete(id);
    this.retire(history.resources);
    this.histories.delete(key);
    this.generation++;
    this.publishSnapshot();
    return true;
  }

  setRetirementDelay(value: number): void {
    this.retirementDelay = integer(value, 'temporal history retirement delay', 0, 32);
    this.retireDue();
  }

  setExpirationFrames(value: number): void {
    this.expirationFrames = integer(value, 'temporal history expiration', 1);
    this.expireUnused();
  }

  getSnapshot(): GodotTemporalHistorySnapshot {
    return Object.freeze({
      frame: this.frame,
      histories: this.histories.size,
      resources: this.histories.size * 2 + this.retired.length * 2,
      activeLeases: this.leases.size,
      validHistories: [...this.histories.values()].filter((history) => history.valid).length,
      invalidations: this.invalidations,
      allocations: this.allocations,
      reuses: this.reuses,
      retirements: this.retirements,
      generation: this.generation,
    });
  }

  watchInvalidations(listener: (value: GodotTemporalHistoryInvalidation) => void): () => void {
    this.invalidationWatchers.add(listener);
    return () => this.invalidationWatchers.delete(listener);
  }

  watchSnapshot(listener: (snapshot: GodotTemporalHistorySnapshot) => void): () => void {
    this.snapshotWatchers.add(listener);
    listener(this.getSnapshot());
    return () => this.snapshotWatchers.delete(listener);
  }

  replaceBackend(backend: GodotTemporalHistoryBackend<TResource>): void {
    const descriptors = [...this.histories.values()].map((history) => history.descriptor);
    for (const history of this.histories.values()) this.destroyResources(history.resources);
    for (const retired of this.retired) this.destroyResources(retired.resources);
    this.histories.clear();
    this.retired.length = 0;
    this.leases.clear();
    this.backend = backend;
    for (const value of descriptors) {
      const history = this.createHistory(value);
      this.histories.set(historyKey(value), history);
    }
    this.generation++;
    this.publishSnapshot();
  }

  dispose(): void {
    for (const history of this.histories.values()) this.destroyResources(history.resources);
    for (const retired of this.retired) this.destroyResources(retired.resources);
    this.histories.clear();
    this.retired.length = 0;
    this.leases.clear();
    this.invalidationWatchers.clear();
    this.snapshotWatchers.clear();
    this.generation++;
  }

  private createHistory(value: Required<GodotTemporalHistoryDescriptor>): HistoryState<TResource> {
    const history: HistoryState<TResource> = {
      id: this.nextHistoryId++,
      descriptor: value,
      resources: this.createResources(value),
      currentIndex: 0,
      valid: false,
      historyGeneration: 1,
      lastAcquiredFrame: this.frame,
      lastAdvancedFrame: -1,
      leaseCount: 0,
      revision: ++this.generation,
    };
    this.allocations += 2;
    this.notifyInvalidation(history, 'created');
    return history;
  }

  private createResources(value: Required<GodotTemporalHistoryDescriptor>): [TResource, TResource] {
    const first = this.backend.create(value, 0);
    const second = this.backend.create(value, 1);
    this.backend.clear?.(first, value.clearValue);
    this.backend.clear?.(second, value.clearValue);
    return [first, second];
  }

  private destroyResources(resources: [TResource, TResource]): void {
    this.backend.destroy(resources[0]);
    this.backend.destroy(resources[1]);
    this.retirements += 2;
  }

  private retire(resources: [TResource, TResource]): void {
    if (this.retirementDelay === 0) this.destroyResources(resources);
    else this.retired.push({ resources, retireFrame: this.frame + this.retirementDelay });
  }

  private retireDue(): void {
    for (let index = this.retired.length - 1; index >= 0; index--) {
      const retired = this.retired[index]!;
      if (retired.retireFrame > this.frame) continue;
      this.retired.splice(index, 1);
      this.destroyResources(retired.resources);
      this.generation++;
    }
  }

  private expireUnused(): void {
    for (const [key, history] of this.histories) {
      if (history.descriptor.persistent || history.leaseCount > 0) continue;
      if (this.frame - history.lastAcquiredFrame < this.expirationFrames) continue;
      this.notifyInvalidation(history, 'expired');
      this.retire(history.resources);
      this.histories.delete(key);
      this.generation++;
    }
  }

  private invalidateState(history: HistoryState<TResource>, reason: GodotTemporalHistoryReason): void {
    history.valid = false;
    history.historyGeneration++;
    history.revision = ++this.generation;
    this.backend.clear?.(history.resources[0], history.descriptor.clearValue);
    this.backend.clear?.(history.resources[1], history.descriptor.clearValue);
    this.notifyInvalidation(history, reason);
  }

  private notifyInvalidation(history: HistoryState<TResource>, reason: GodotTemporalHistoryReason): void {
    const value: GodotTemporalHistoryInvalidation = Object.freeze({
      key: history.descriptor.key,
      view: history.descriptor.view,
      reason,
      historyGeneration: history.historyGeneration,
      frame: this.frame,
    });
    this.invalidations++;
    for (const watcher of this.invalidationWatchers) watcher(value);
  }

  private lease(id: number, history: HistoryState<TResource>): GodotTemporalHistoryLease<TResource> {
    return Object.freeze({
      id,
      key: history.descriptor.key,
      view: history.descriptor.view,
      current: history.resources[history.currentIndex],
      previous: history.resources[history.currentIndex === 0 ? 1 : 0],
      descriptor: history.descriptor,
      valid: history.valid,
      historyGeneration: history.historyGeneration,
      frame: this.frame,
      generation: history.revision,
    });
  }

  private requireLease(lease: GodotTemporalHistoryLease<TResource>): { history: HistoryState<TResource>; lease: GodotTemporalHistoryLease<TResource> } {
    const value = this.leases.get(lease.id);
    if (value === undefined || value.lease !== lease) throw new Error('godot-compat: temporal history lease is stale or released.');
    return value;
  }

  private publishSnapshot(): void {
    if (this.snapshotWatchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.snapshotWatchers) watcher(snapshot);
  }
}

export function createGodotTemporalHistoryPoolRuntime<TResource = unknown>(
  backend: GodotTemporalHistoryBackend<TResource>,
  retirementDelay?: number,
  expirationFrames?: number,
): GodotTemporalHistoryPoolRuntime<TResource> {
  return new GodotTemporalHistoryPoolRuntime(backend, retirementDelay, expirationFrames);
}
