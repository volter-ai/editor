export type GodotRenderQueryPoolRid = string | number;

export type GodotRenderQueryKind = 'timestamp' | 'occlusion' | 'pipeline-statistics';

export interface GodotRenderQueryDescriptor {
  readonly name: string;
  readonly kind: GodotRenderQueryKind;
  readonly historyLength?: number;
  readonly statistics?: readonly string[];
}

export interface GodotRenderQueryHandle {
  readonly id: number;
  readonly name: string;
  readonly kind: GodotRenderQueryKind;
  readonly slot: number;
  readonly generation: number;
}

export interface GodotRenderQueryScope {
  readonly id: number;
  readonly frame: number;
  readonly query: GodotRenderQueryHandle;
  readonly beginIndex: number;
  readonly endIndex: number;
  readonly generation: number;
}

export interface GodotRenderQueryResult {
  readonly query: GodotRenderQueryHandle;
  readonly frame: number;
  readonly availableFrame: number;
  readonly begin: bigint;
  readonly end: bigint;
  readonly value: bigint;
  readonly seconds: number | null;
  readonly statistics: Readonly<Record<string, bigint>>;
  readonly valid: boolean;
  readonly generation: number;
}

export interface GodotRenderQueryPoolSnapshot {
  readonly frame: number;
  readonly queries: number;
  readonly activeScopes: number;
  readonly pendingScopes: number;
  readonly resolvedScopes: number;
  readonly capacity: number;
  readonly usedSlots: number;
  readonly generation: number;
}

export interface GodotRenderQueryBackend<TPool = unknown> {
  createPool(kind: GodotRenderQueryKind, capacity: number, statistics: readonly string[]): TPool;
  begin(pool: TPool, index: number): void;
  end(pool: TPool, index: number): void;
  writeTimestamp(pool: TPool, index: number): void;
  isAvailable(pool: TPool, beginIndex: number, endIndex: number): boolean;
  read(pool: TPool, beginIndex: number, endIndex: number, statistics: readonly string[]): readonly bigint[];
  reset(pool: TPool, beginIndex: number, count: number): void;
  destroyPool(pool: TPool): void;
  readonly timestampPeriodSeconds?: number;
}

interface QueryState {
  handle: GodotRenderQueryHandle;
  descriptor: Required<GodotRenderQueryDescriptor>;
  histories: GodotRenderQueryResult[];
  active: ScopeState | null;
}

interface PoolState<TPool> {
  kind: GodotRenderQueryKind;
  statisticsKey: string;
  statistics: string[];
  handle: TPool;
  capacity: number;
  used: boolean[];
  generation: number;
}

interface ScopeState {
  scope: GodotRenderQueryScope;
  query: QueryState;
  poolKey: string;
  ended: boolean;
  cancelled: boolean;
}

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function queryKind(value: unknown): GodotRenderQueryKind {
  if (value !== 'timestamp' && value !== 'occlusion' && value !== 'pipeline-statistics') {
    throw new TypeError(`godot-compat: unknown render query kind ${String(value)}.`);
  }
  return value;
}

function descriptor(value: GodotRenderQueryDescriptor): Required<GodotRenderQueryDescriptor> {
  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new TypeError('godot-compat: render query name requires a non-empty string.');
  }
  const kind = queryKind(value.kind);
  const statistics = [...new Set(value.statistics ?? [])];
  if (kind !== 'pipeline-statistics' && statistics.length > 0) {
    throw new TypeError('godot-compat: statistics are only valid for pipeline-statistics queries.');
  }
  if (!statistics.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    throw new TypeError('godot-compat: render query statistic names require non-empty strings.');
  }
  return Object.freeze({
    name: value.name,
    kind,
    historyLength: integer(value.historyLength ?? 8, 'render query history length', 1, 1024),
    statistics: Object.freeze(statistics),
  });
}

function poolKey(kind: GodotRenderQueryKind, statistics: readonly string[]): string {
  return `${kind}:${[...statistics].sort().join(',')}`;
}

export class GodotRenderQueryPoolRuntime<TPool = unknown> {
  private readonly queries = new Map<number, QueryState>();
  private readonly queriesByName = new Map<string, QueryState>();
  private readonly pools = new Map<string, PoolState<TPool>[]>();
  private readonly scopes = new Map<number, ScopeState>();
  private readonly pending: ScopeState[] = [];
  private readonly watchers = new Set<(result: GodotRenderQueryResult) => void>();
  private readonly snapshotWatchers = new Set<(snapshot: GodotRenderQueryPoolSnapshot) => void>();
  private frame = 0;
  private nextQueryId = 1;
  private nextScopeId = 1;
  private generation = 1;
  private resolvedScopes = 0;
  private poolCapacity: number;

  constructor(private backend: GodotRenderQueryBackend<TPool>, poolCapacity = 256) {
    this.poolCapacity = integer(poolCapacity, 'render query pool capacity', 2, 65536);
    if ((this.poolCapacity & 1) !== 0) this.poolCapacity++;
  }

  createQuery(value: GodotRenderQueryDescriptor): GodotRenderQueryHandle {
    const normalized = descriptor(value);
    if (this.queriesByName.has(normalized.name)) {
      throw new Error(`godot-compat: render query ${normalized.name} already exists.`);
    }
    const handle: GodotRenderQueryHandle = Object.freeze({
      id: this.nextQueryId++,
      name: normalized.name,
      kind: normalized.kind,
      slot: -1,
      generation: ++this.generation,
    });
    const state: QueryState = { handle, descriptor: normalized, histories: [], active: null };
    this.queries.set(handle.id, state);
    this.queriesByName.set(handle.name, state);
    this.publishSnapshot();
    return handle;
  }

  freeQuery(handle: GodotRenderQueryHandle): boolean {
    const query = this.queries.get(handle.id);
    if (query === undefined || query.handle !== handle) return false;
    if (query.active !== null) this.cancelScope(query.active.scope);
    for (const scope of [...this.pending]) {
      if (scope.query !== query) continue;
      this.releaseScope(scope);
    }
    this.queries.delete(handle.id);
    this.queriesByName.delete(handle.name);
    this.generation++;
    this.publishSnapshot();
    return true;
  }

  getQuery(name: string): GodotRenderQueryHandle | null {
    return this.queriesByName.get(name)?.handle ?? null;
  }

  beginQuery(handle: GodotRenderQueryHandle): GodotRenderQueryScope {
    const query = this.requireQuery(handle);
    if (query.active !== null) throw new Error(`godot-compat: render query ${handle.name} is already active.`);
    const allocation = this.allocate(query.descriptor.kind, query.descriptor.statistics, 2);
    const scope: GodotRenderQueryScope = Object.freeze({
      id: this.nextScopeId++,
      frame: this.frame,
      query: handle,
      beginIndex: allocation.begin,
      endIndex: allocation.begin + 1,
      generation: ++this.generation,
    });
    const state: ScopeState = {
      scope,
      query,
      poolKey: allocation.key,
      ended: false,
      cancelled: false,
    };
    query.active = state;
    this.scopes.set(scope.id, state);
    const pool = this.pool(state);
    this.backend.reset(pool.handle, scope.beginIndex, 2);
    if (query.descriptor.kind === 'timestamp') this.backend.writeTimestamp(pool.handle, scope.beginIndex);
    else this.backend.begin(pool.handle, scope.beginIndex);
    this.publishSnapshot();
    return scope;
  }

  endQuery(scope: GodotRenderQueryScope): void {
    const state = this.requireScope(scope);
    if (state.ended) throw new Error('godot-compat: render query scope has already ended.');
    const pool = this.pool(state);
    if (state.query.descriptor.kind === 'timestamp') this.backend.writeTimestamp(pool.handle, scope.endIndex);
    else this.backend.end(pool.handle, scope.endIndex);
    state.ended = true;
    state.query.active = null;
    this.pending.push(state);
    this.generation++;
    this.publishSnapshot();
  }

  cancelScope(scope: GodotRenderQueryScope): boolean {
    const state = this.scopes.get(scope.id);
    if (state === undefined || state.scope !== scope || state.cancelled) return false;
    state.cancelled = true;
    if (state.query.active === state) state.query.active = null;
    this.releaseScope(state);
    this.generation++;
    this.publishSnapshot();
    return true;
  }

  beginFrame(frameValue: number): readonly GodotRenderQueryResult[] {
    const nextFrame = integer(frameValue, 'render query frame', 0);
    if (nextFrame < this.frame) throw new RangeError('godot-compat: render query frame cannot move backwards.');
    this.frame = nextFrame;
    const values = this.resolveAvailable();
    this.publishSnapshot();
    return values;
  }

  endFrame(): readonly GodotRenderQueryResult[] {
    for (const query of this.queries.values()) {
      if (query.active !== null) this.endQuery(query.active.scope);
    }
    const values = this.resolveAvailable();
    this.publishSnapshot();
    return values;
  }

  resolveAvailable(): readonly GodotRenderQueryResult[] {
    const results: GodotRenderQueryResult[] = [];
    for (let index = 0; index < this.pending.length;) {
      const state = this.pending[index]!;
      const pool = this.pool(state);
      if (!this.backend.isAvailable(pool.handle, state.scope.beginIndex, state.scope.endIndex)) {
        index++;
        continue;
      }
      this.pending.splice(index, 1);
      const raw = this.backend.read(
        pool.handle,
        state.scope.beginIndex,
        state.scope.endIndex,
        state.query.descriptor.statistics,
      );
      const result = this.decode(state, raw);
      state.query.histories.push(result);
      if (state.query.histories.length > state.query.descriptor.historyLength) state.query.histories.shift();
      this.releaseScope(state);
      this.resolvedScopes++;
      this.generation++;
      for (const watcher of this.watchers) watcher(result);
      results.push(result);
    }
    return Object.freeze(results);
  }

  getLatest(handle: GodotRenderQueryHandle): GodotRenderQueryResult | null {
    return this.requireQuery(handle).histories.at(-1) ?? null;
  }

  getHistory(handle: GodotRenderQueryHandle): readonly GodotRenderQueryResult[] {
    return Object.freeze([...this.requireQuery(handle).histories]);
  }

  getAverage(handle: GodotRenderQueryHandle, samples = Number.MAX_SAFE_INTEGER): number | null {
    const query = this.requireQuery(handle);
    const count = integer(samples, 'render query average samples', 1);
    const values = query.histories.slice(-count).map((result) => result.seconds).filter((value): value is number => value !== null);
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  getStatisticsAverage(handle: GodotRenderQueryHandle, statistic: string, samples = Number.MAX_SAFE_INTEGER): number | null {
    const query = this.requireQuery(handle);
    if (!query.descriptor.statistics.includes(statistic)) {
      throw new Error(`godot-compat: render query ${handle.name} does not collect ${statistic}.`);
    }
    const count = integer(samples, 'render query statistics samples', 1);
    const values = query.histories.slice(-count).map((result) => result.statistics[statistic]).filter((value): value is bigint => value !== undefined);
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
  }

  watch(listener: (result: GodotRenderQueryResult) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  watchSnapshot(listener: (snapshot: GodotRenderQueryPoolSnapshot) => void): () => void {
    this.snapshotWatchers.add(listener);
    listener(this.getSnapshot());
    return () => this.snapshotWatchers.delete(listener);
  }

  getSnapshot(): GodotRenderQueryPoolSnapshot {
    let capacity = 0;
    let usedSlots = 0;
    for (const pools of this.pools.values()) {
      for (const pool of pools) {
        capacity += pool.capacity;
        usedSlots += pool.used.filter(Boolean).length;
      }
    }
    return Object.freeze({
      frame: this.frame,
      queries: this.queries.size,
      activeScopes: [...this.queries.values()].filter((query) => query.active !== null).length,
      pendingScopes: this.pending.length,
      resolvedScopes: this.resolvedScopes,
      capacity,
      usedSlots,
      generation: this.generation,
    });
  }

  setPoolCapacity(value: number): void {
    const capacity = integer(value, 'render query pool capacity', 2, 65536);
    this.poolCapacity = (capacity & 1) === 0 ? capacity : capacity + 1;
  }

  trimEmptyPools(keepPerKind = 1): number {
    const keep = integer(keepPerKind, 'render query retained pools', 0, 64);
    let removed = 0;
    for (const [key, pools] of this.pools) {
      const empty = pools.filter((pool) => !pool.used.some(Boolean));
      for (const pool of empty.slice(keep)) {
        this.backend.destroyPool(pool.handle);
        pools.splice(pools.indexOf(pool), 1);
        removed++;
      }
      if (pools.length === 0) this.pools.delete(key);
    }
    if (removed > 0) {
      this.generation++;
      this.publishSnapshot();
    }
    return removed;
  }

  replaceBackend(backend: GodotRenderQueryBackend<TPool>): void {
    for (const pools of this.pools.values()) for (const pool of pools) this.backend.destroyPool(pool.handle);
    for (const query of this.queries.values()) query.active = null;
    this.pools.clear();
    this.scopes.clear();
    this.pending.length = 0;
    this.backend = backend;
    this.generation++;
    this.publishSnapshot();
  }

  dispose(): void {
    for (const pools of this.pools.values()) for (const pool of pools) this.backend.destroyPool(pool.handle);
    this.queries.clear();
    this.queriesByName.clear();
    this.pools.clear();
    this.scopes.clear();
    this.pending.length = 0;
    this.watchers.clear();
    this.snapshotWatchers.clear();
    this.generation++;
  }

  private allocate(
    kind: GodotRenderQueryKind,
    statistics: readonly string[],
    count: number,
  ): { key: string; begin: number } {
    const key = poolKey(kind, statistics);
    let pools = this.pools.get(key);
    if (pools === undefined) {
      pools = [];
      this.pools.set(key, pools);
    }
    for (let poolIndex = 0; poolIndex < pools.length; poolIndex++) {
      const begin = this.findRange(pools[poolIndex]!, count);
      if (begin >= 0) return { key: `${key}/${poolIndex}`, begin };
    }
    const capacity = Math.max(this.poolCapacity, count);
    const pool: PoolState<TPool> = {
      kind,
      statisticsKey: key,
      statistics: [...statistics],
      handle: this.backend.createPool(kind, capacity, statistics),
      capacity,
      used: new Array<boolean>(capacity).fill(false),
      generation: ++this.generation,
    };
    pools.push(pool);
    const begin = this.findRange(pool, count);
    return { key: `${key}/${pools.length - 1}`, begin };
  }

  private findRange(pool: PoolState<TPool>, count: number): number {
    for (let begin = 0; begin <= pool.capacity - count; begin++) {
      let free = true;
      for (let offset = 0; offset < count; offset++) {
        if (pool.used[begin + offset]) {
          free = false;
          begin += offset;
          break;
        }
      }
      if (!free) continue;
      for (let offset = 0; offset < count; offset++) pool.used[begin + offset] = true;
      return begin;
    }
    return -1;
  }

  private pool(state: ScopeState): PoolState<TPool> {
    const separator = state.poolKey.lastIndexOf('/');
    const key = state.poolKey.slice(0, separator);
    const index = Number(state.poolKey.slice(separator + 1));
    const pool = this.pools.get(key)?.[index];
    if (pool === undefined) throw new Error('godot-compat: render query pool no longer exists.');
    return pool;
  }

  private decode(state: ScopeState, values: readonly bigint[]): GodotRenderQueryResult {
    const begin = values[0] ?? 0n;
    const end = values[1] ?? begin;
    const value = state.query.descriptor.kind === 'timestamp' ? end - begin : begin;
    const statistics: Record<string, bigint> = Object.create(null);
    const statisticOffset = state.query.descriptor.kind === 'pipeline-statistics' ? 0 : 2;
    state.query.descriptor.statistics.forEach((name, index) => {
      statistics[name] = values[statisticOffset + index] ?? 0n;
    });
    const period = this.backend.timestampPeriodSeconds ?? null;
    return Object.freeze({
      query: state.query.handle,
      frame: state.scope.frame,
      availableFrame: this.frame,
      begin,
      end,
      value,
      seconds: state.query.descriptor.kind === 'timestamp' && period !== null ? Number(value) * period : null,
      statistics: Object.freeze(statistics),
      valid: values.length > 0,
      generation: this.generation,
    });
  }

  private releaseScope(state: ScopeState): void {
    const pendingIndex = this.pending.indexOf(state);
    if (pendingIndex >= 0) this.pending.splice(pendingIndex, 1);
    const pool = this.pool(state);
    pool.used[state.scope.beginIndex] = false;
    pool.used[state.scope.endIndex] = false;
    this.scopes.delete(state.scope.id);
  }

  private requireQuery(handle: GodotRenderQueryHandle): QueryState {
    const query = this.queries.get(handle.id);
    if (query === undefined || query.handle !== handle) throw new Error('godot-compat: render query handle is stale or unknown.');
    return query;
  }

  private requireScope(scope: GodotRenderQueryScope): ScopeState {
    const state = this.scopes.get(scope.id);
    if (state === undefined || state.scope !== scope || state.cancelled) {
      throw new Error('godot-compat: render query scope is stale or cancelled.');
    }
    return state;
  }

  private publishSnapshot(): void {
    if (this.snapshotWatchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.snapshotWatchers) watcher(snapshot);
  }
}

export function createGodotRenderQueryPoolRuntime<TPool = unknown>(
  backend: GodotRenderQueryBackend<TPool>,
  poolCapacity?: number,
): GodotRenderQueryPoolRuntime<TPool> {
  return new GodotRenderQueryPoolRuntime(backend, poolCapacity);
}
