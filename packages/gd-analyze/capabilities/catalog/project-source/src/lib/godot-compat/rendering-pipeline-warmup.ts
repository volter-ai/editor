import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotRenderingPipelineWarmupKind = 'render' | 'compute';
export type GodotRenderingPipelineWarmupStatus = 'queued' | 'compiling' | 'ready' | 'failed' | 'invalidated';

export interface GodotRenderingPipelineWarmupDescriptor {
  readonly key: string;
  readonly kind: GodotRenderingPipelineWarmupKind;
  readonly shader: GodotRid;
  readonly priority?: number;
  readonly dependencies?: readonly string[];
  readonly variant?: unknown;
  readonly persistent?: boolean;
  readonly userData?: unknown;
  readonly compile: () => GodotRid | Promise<GodotRid>;
}

export interface GodotRenderingPipelineWarmupEntry {
  readonly key: string;
  readonly kind: GodotRenderingPipelineWarmupKind;
  readonly shader: GodotRid;
  readonly pipeline: GodotRid | null;
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly variant: unknown;
  readonly persistent: boolean;
  readonly status: GodotRenderingPipelineWarmupStatus;
  readonly attempts: number;
  readonly queuedFrame: number;
  readonly compiledFrame: number;
  readonly lastUsedFrame: number;
  readonly error: unknown | null;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotRenderingPipelineWarmupFrameResult {
  readonly frame: number;
  readonly compiled: readonly string[];
  readonly failed: readonly { key: string; error: unknown }[];
  readonly deferred: readonly string[];
  readonly compileCost: number;
}

export interface GodotRenderingPipelineWarmupSnapshot {
  readonly frame: number;
  readonly entries: readonly GodotRenderingPipelineWarmupEntry[];
  readonly queued: number;
  readonly compiling: number;
  readonly ready: number;
  readonly failed: number;
  readonly compileBudget: number;
  readonly maxAttempts: number;
  readonly totalCompiles: number;
  readonly totalFailures: number;
  readonly totalInvalidations: number;
  readonly evictions: number;
  readonly generation: number;
  readonly lastFrame: GodotRenderingPipelineWarmupFrameResult | null;
}

export interface GodotRenderingPipelineWarmupStorage {
  load?(key: string): GodotRid | null | Promise<GodotRid | null>;
  store?(key: string, pipeline: GodotRid): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
  free?(pipeline: GodotRid): void;
}

interface Entry {
  key: string;
  kind: GodotRenderingPipelineWarmupKind;
  shader: GodotRid;
  pipeline: GodotRid | null;
  priority: number;
  dependencies: Set<string>;
  variant: unknown;
  persistent: boolean;
  status: GodotRenderingPipelineWarmupStatus;
  attempts: number;
  queuedFrame: number;
  compiledFrame: number;
  lastUsedFrame: number;
  error: unknown | null;
  generation: number;
  userData: unknown;
  compile: () => GodotRid | Promise<GodotRid>;
  order: number;
}

function integer(value: unknown, member: string, minimum = 0): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new RangeError(`godot-compat: RenderingPipelineWarmup.${member} requires integer >= ${minimum}.`);
  return result;
}
function finite(value: unknown, member: string, minimum = -Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum) throw new RangeError(`godot-compat: RenderingPipelineWarmup.${member} requires finite value >= ${minimum}.`);
  return result;
}
function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: RenderingPipelineWarmup.${member} requires bool.`);
  return value;
}
function name(value: unknown, member: string): string {
  const result = String(value); if (result.length === 0) throw new RangeError(`godot-compat: RenderingPipelineWarmup.${member} requires nonempty StringName.`); return result;
}
function rid(value: unknown): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: RenderingPipelineWarmup requires RID.');
  godotRidGetId(value); return value as GodotRid;
}
function kind(value: unknown): GodotRenderingPipelineWarmupKind {
  if (value !== 'render' && value !== 'compute') throw new TypeError('godot-compat: pipeline warmup kind requires render or compute.');
  return value;
}
function snapshot(entry: Entry): GodotRenderingPipelineWarmupEntry {
  return Object.freeze({
    key: entry.key, kind: entry.kind, shader: entry.shader, pipeline: entry.pipeline,
    priority: entry.priority, dependencies: Object.freeze([...entry.dependencies]), variant: entry.variant,
    persistent: entry.persistent, status: entry.status, attempts: entry.attempts,
    queuedFrame: entry.queuedFrame, compiledFrame: entry.compiledFrame, lastUsedFrame: entry.lastUsedFrame,
    error: entry.error, generation: entry.generation, userData: entry.userData,
  });
}

export class GodotRenderingPipelineWarmup {
  public readonly __godotClass = 'RenderingPipelineWarmup';
  private readonly storage: GodotRenderingPipelineWarmupStorage;
  private readonly entries = new Map<string, Entry>();
  private readonly entriesByShader = new Map<bigint, Set<Entry>>();
  private readonly entriesByDependency = new Map<string, Set<Entry>>();
  private readonly watchers = new Set<(snapshot: GodotRenderingPipelineWarmupSnapshot) => void>();
  private frameValue = 0;
  private compileBudgetValue = 4;
  private maxAttemptsValue = 3;
  private retentionFramesValue = 600;
  private nextOrder = 0;
  private generationValue = 0;
  private totalCompiles = 0;
  private totalFailures = 0;
  private totalInvalidations = 0;
  private evictions = 0;
  private processing = false;
  private lastFrame: GodotRenderingPipelineWarmupFrameResult | null = null;

  public constructor(storage: GodotRenderingPipelineWarmupStorage = {}) {
    this.storage = storage; registerGodotObjectIdentity(this, 'RenderingPipelineWarmup');
  }

  public enqueue(value: GodotRenderingPipelineWarmupDescriptor): void {
    const key = name(value.key, 'key');
    if (this.entries.has(key)) throw new Error(`godot-compat: pipeline warmup ${key} already exists.`);
    if (typeof value.compile !== 'function') throw new TypeError('godot-compat: pipeline warmup requires compile Callable.');
    const entry: Entry = {
      key, kind: kind(value.kind), shader: rid(value.shader), pipeline: null,
      priority: finite(value.priority ?? 0, 'priority'), dependencies: new Set((value.dependencies ?? []).map((dependency) => name(dependency, 'dependency'))),
      variant: value.variant ?? null, persistent: bool(value.persistent ?? false, 'persistent'), status: 'queued',
      attempts: 0, queuedFrame: this.frameValue, compiledFrame: -1, lastUsedFrame: -1,
      error: null, generation: 1, userData: value.userData ?? null, compile: value.compile, order: this.nextOrder++,
    };
    this.entries.set(key, entry); this.index(entry); this.generationValue += 1; this.publish();
  }

  public enqueueOrReplace(value: GodotRenderingPipelineWarmupDescriptor): void {
    const key = name(value.key, 'key');
    if (this.entries.has(key)) this.remove(key);
    this.enqueue(value);
  }

  private index(entry: Entry): void {
    const shaderId = godotRidGetId(entry.shader);
    let shaderEntries = this.entriesByShader.get(shaderId);
    if (shaderEntries === undefined) { shaderEntries = new Set(); this.entriesByShader.set(shaderId, shaderEntries); }
    shaderEntries.add(entry);
    for (const dependency of entry.dependencies) {
      let entries = this.entriesByDependency.get(dependency);
      if (entries === undefined) { entries = new Set(); this.entriesByDependency.set(dependency, entries); }
      entries.add(entry);
    }
  }

  private unindex(entry: Entry): void {
    const shaderId = godotRidGetId(entry.shader), shaderEntries = this.entriesByShader.get(shaderId);
    shaderEntries?.delete(entry); if (shaderEntries?.size === 0) this.entriesByShader.delete(shaderId);
    for (const dependency of entry.dependencies) {
      const entries = this.entriesByDependency.get(dependency); entries?.delete(entry);
      if (entries?.size === 0) this.entriesByDependency.delete(dependency);
    }
  }

  public remove(keyValue: unknown): boolean {
    const key = name(keyValue, 'key'), entry = this.entries.get(key);
    if (entry === undefined) return false;
    this.unindex(entry); this.entries.delete(key);
    if (entry.pipeline !== null) this.storage.free?.(entry.pipeline);
    void this.storage.remove?.(entry.key); this.generationValue += 1; this.publish(); return true;
  }

  private invalidate(entry: Entry): void {
    if (entry.pipeline !== null) this.storage.free?.(entry.pipeline);
    entry.pipeline = null; entry.status = 'invalidated'; entry.error = null; entry.attempts = 0;
    entry.queuedFrame = this.frameValue; entry.generation += 1; this.totalInvalidations += 1;
    void this.storage.remove?.(entry.key);
  }

  public invalidateShader(shaderValue: unknown): number {
    const shader = rid(shaderValue), entries = [...(this.entriesByShader.get(godotRidGetId(shader)) ?? [])];
    for (const entry of entries) this.invalidate(entry); this.publish(); return entries.length;
  }

  public invalidateDependency(dependencyValue: unknown): number {
    const dependency = name(dependencyValue, 'dependency'), entries = [...(this.entriesByDependency.get(dependency) ?? [])];
    for (const entry of entries) this.invalidate(entry); this.publish(); return entries.length;
  }

  public retry(keyValue: unknown): void {
    const key = name(keyValue, 'key'), entry = this.entries.get(key);
    if (entry === undefined) throw new Error(`godot-compat: pipeline warmup ${key} does not exist.`);
    if (entry.status !== 'failed' && entry.status !== 'invalidated') return;
    entry.status = 'queued'; entry.error = null; entry.queuedFrame = this.frameValue; this.publish();
  }

  public async hydrate(): Promise<number> {
    if (this.storage.load === undefined) return 0;
    let hydrated = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === 'ready') continue;
      const pipeline = await this.storage.load(entry.key);
      if (pipeline === null) continue;
      entry.pipeline = rid(pipeline); entry.status = 'ready'; entry.compiledFrame = this.frameValue;
      entry.lastUsedFrame = this.frameValue; entry.generation += 1; hydrated += 1;
    }
    this.publish(); return hydrated;
  }

  private queue(): Entry[] {
    return [...this.entries.values()].filter((entry) => entry.status === 'queued' || entry.status === 'invalidated')
      .sort((left, right) => right.priority - left.priority || left.attempts - right.attempts || left.order - right.order);
  }

  public async processFrame(frameValue: unknown): Promise<GodotRenderingPipelineWarmupFrameResult> {
    const frame = integer(frameValue, 'frame');
    if (frame < this.frameValue) throw new RangeError('godot-compat: pipeline warmup frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: pipeline warmup already processing.');
    this.frameValue = frame; this.processing = true;
    const compiled: string[] = [], failed: Array<{ key: string; error: unknown }> = [];
    const queue = this.queue(), selected = queue.slice(0, this.compileBudgetValue), deferred = queue.slice(this.compileBudgetValue).map((entry) => entry.key);
    let compileCost = 0;
    try {
      for (const entry of selected) {
        entry.status = 'compiling'; entry.attempts += 1; entry.error = null;
        const started = typeof performance === 'undefined' ? Date.now() : performance.now();
        try {
          entry.pipeline = rid(await entry.compile()); entry.status = 'ready'; entry.compiledFrame = frame;
          entry.lastUsedFrame = frame; entry.generation += 1; compiled.push(entry.key); this.totalCompiles += 1;
          await this.storage.store?.(entry.key, entry.pipeline);
        } catch (error) {
          entry.error = error; entry.status = entry.attempts >= this.maxAttemptsValue ? 'failed' : 'queued';
          failed.push(Object.freeze({ key: entry.key, error })); this.totalFailures += 1;
        } finally {
          compileCost += (typeof performance === 'undefined' ? Date.now() : performance.now()) - started;
        }
      }
      this.lastFrame = Object.freeze({ frame, compiled: Object.freeze(compiled), failed: Object.freeze(failed), deferred: Object.freeze(deferred), compileCost });
      this.evictUnused(); this.publish(); return this.lastFrame;
    } finally { this.processing = false; }
  }

  public getPipeline(keyValue: unknown): GodotRid | null {
    const key = name(keyValue, 'key'), entry = this.entries.get(key);
    if (entry === undefined || entry.status !== 'ready' || entry.pipeline === null) return null;
    entry.lastUsedFrame = this.frameValue; return entry.pipeline;
  }

  public markUsed(keyValue: unknown): void {
    const key = name(keyValue, 'key'), entry = this.entries.get(key);
    if (entry === undefined) throw new Error(`godot-compat: pipeline warmup ${key} does not exist.`);
    entry.lastUsedFrame = this.frameValue;
  }

  public evictUnused(): number {
    const cutoff = this.frameValue - this.retentionFramesValue; let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.status !== 'ready' || entry.pipeline === null || entry.persistent || entry.lastUsedFrame > cutoff) continue;
      this.storage.free?.(entry.pipeline); entry.pipeline = null; entry.status = 'queued'; entry.queuedFrame = this.frameValue;
      entry.generation += 1; this.evictions += 1; count += 1;
    }
    return count;
  }

  public setCompileBudget(value: unknown): void { this.compileBudgetValue = integer(value, 'compile_budget', 1); }
  public setMaxAttempts(value: unknown): void { this.maxAttemptsValue = integer(value, 'max_attempts', 1); }
  public setRetentionFrames(value: unknown): void { this.retentionFramesValue = integer(value, 'retention_frames'); }
  public getEntry(keyValue: unknown): GodotRenderingPipelineWarmupEntry | null {
    const entry = this.entries.get(name(keyValue, 'key')); return entry === undefined ? null : snapshot(entry);
  }
  public getSnapshot(): GodotRenderingPipelineWarmupSnapshot {
    const entries = [...this.entries.values()].map(snapshot);
    return Object.freeze({
      frame: this.frameValue, entries: Object.freeze(entries), queued: entries.filter((entry) => entry.status === 'queued' || entry.status === 'invalidated').length,
      compiling: entries.filter((entry) => entry.status === 'compiling').length, ready: entries.filter((entry) => entry.status === 'ready').length,
      failed: entries.filter((entry) => entry.status === 'failed').length, compileBudget: this.compileBudgetValue, maxAttempts: this.maxAttemptsValue,
      totalCompiles: this.totalCompiles, totalFailures: this.totalFailures, totalInvalidations: this.totalInvalidations,
      evictions: this.evictions, generation: this.generationValue, lastFrame: this.lastFrame,
    });
  }
  public watch(watcher: (snapshot: GodotRenderingPipelineWarmupSnapshot) => void): () => void {
    this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher);
  }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void {
    if (this.processing) throw new Error('godot-compat: cannot clear pipeline warmup while processing.');
    for (const entry of this.entries.values()) if (entry.pipeline !== null) this.storage.free?.(entry.pipeline);
    this.entries.clear(); this.entriesByShader.clear(); this.entriesByDependency.clear(); this.lastFrame = null;
    this.generationValue += 1; this.publish();
  }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotRenderingPipelineWarmup(
  storage: GodotRenderingPipelineWarmupStorage = {},
): GodotRenderingPipelineWarmup {
  return new GodotRenderingPipelineWarmup(storage);
}
