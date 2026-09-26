export type RenderDrawBundleCommand =
  | { type: "bind_pipeline"; pipelineId: string }
  | { type: "bind_vertex_buffer"; slot: number; bufferId: string; offset?: number; stride?: number }
  | { type: "bind_index_buffer"; bufferId: string; offset?: number; indexFormat?: "uint16" | "uint32" }
  | { type: "bind_uniform_set"; set: number; uniformSetId: string; dynamicOffsets?: readonly number[] }
  | { type: "set_push_constants"; offset: number; values: readonly number[] }
  | { type: "set_viewport"; x: number; y: number; width: number; height: number; minimumDepth?: number; maximumDepth?: number }
  | { type: "set_scissor"; x: number; y: number; width: number; height: number }
  | { type: "set_blend_constants"; r: number; g: number; b: number; a: number }
  | { type: "set_stencil_reference"; reference: number }
  | { type: "draw"; vertexCount: number; instanceCount?: number; firstVertex?: number; firstInstance?: number }
  | { type: "draw_indexed"; indexCount: number; instanceCount?: number; firstIndex?: number; vertexOffset?: number; firstInstance?: number }
  | { type: "draw_indirect"; bufferId: string; offset: number; drawCount?: number; stride?: number }
  | { type: "draw_indexed_indirect"; bufferId: string; offset: number; drawCount?: number; stride?: number }
  | { type: "debug_marker"; label: string };

export interface RenderDrawBundleCompatibility {
  colorFormats: readonly string[];
  depthStencilFormat?: string;
  sampleCount?: number;
  viewMask?: number;
  readOnlyDepth?: boolean;
  readOnlyStencil?: boolean;
}

export interface RenderDrawBundleDescriptor {
  id: string;
  label?: string;
  compatibility: RenderDrawBundleCompatibility;
  commands: readonly RenderDrawBundleCommand[];
  dependencies?: readonly string[];
  inheritedState?: readonly ("viewport" | "scissor" | "blend_constants" | "stencil_reference")[];
  reusable?: boolean;
  priority?: number;
}

export interface RenderDrawBundleBackendHandle {
  id: string;
  byteSize?: number;
}

export interface RenderDrawBundleCompilerBackend {
  compile(descriptor: RenderDrawBundleDescriptor): RenderDrawBundleBackendHandle | Promise<RenderDrawBundleBackendHandle>;
  destroy?(handle: RenderDrawBundleBackendHandle): void | Promise<void>;
  submit?(handle: RenderDrawBundleBackendHandle): void | Promise<void>;
}

export type RenderDrawBundleState = "registered" | "compiling" | "ready" | "failed" | "invalidated" | "destroyed";

export interface RenderDrawBundleRecord {
  id: string;
  descriptor: RenderDrawBundleDescriptor;
  state: RenderDrawBundleState;
  revision: number;
  signature: string;
  handle: RenderDrawBundleBackendHandle | null;
  error: string | null;
  lastUsedFrame: number;
  submissionCount: number;
  byteSize: number;
}

export interface RenderDrawBundleCacheOptions {
  maximumBundleCount?: number;
  maximumBytes?: number;
  maximumIdleFrames?: number;
  retainFailedBundles?: boolean;
}

export interface RenderDrawBundleCacheSnapshot {
  revision: number;
  frame: number;
  registeredCount: number;
  readyCount: number;
  compilingCount: number;
  failedCount: number;
  invalidatedCount: number;
  cachedBytes: number;
  submissions: number;
}

type RenderDrawBundleWatcher = (snapshot: RenderDrawBundleCacheSnapshot) => void;

interface InternalRecord extends RenderDrawBundleRecord {
  compileGeneration: number;
}

const DEFAULT_MAXIMUM_BUNDLE_COUNT = 2048;
const DEFAULT_MAXIMUM_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAXIMUM_IDLE_FRAMES = 600;

function cloneCommand(command: RenderDrawBundleCommand): RenderDrawBundleCommand {
  if (command.type === "bind_uniform_set") {
    return {
      ...command,
      ...(command.dynamicOffsets === undefined ? {} : { dynamicOffsets: [...command.dynamicOffsets] }),
    };
  }
  if (command.type === "set_push_constants") return { ...command, values: [...command.values] };
  return { ...command };
}

function cloneDescriptor(descriptor: RenderDrawBundleDescriptor): RenderDrawBundleDescriptor {
  return {
    ...descriptor,
    compatibility: {
      ...descriptor.compatibility,
      colorFormats: [...descriptor.compatibility.colorFormats],
    },
    commands: descriptor.commands.map(cloneCommand),
    ...(descriptor.dependencies === undefined ? {} : { dependencies: [...descriptor.dependencies] }),
    ...(descriptor.inheritedState === undefined ? {} : { inheritedState: [...descriptor.inheritedState] }),
  };
}

function cloneRecord(record: RenderDrawBundleRecord): RenderDrawBundleRecord {
  return {
    ...record,
    descriptor: cloneDescriptor(record.descriptor),
    handle: record.handle ? { ...record.handle } : null,
  };
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(",")}}`;
}

function hashString(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function compatibilitySignature(compatibility: RenderDrawBundleCompatibility): string {
  return hashString(stableValue({
    colorFormats: compatibility.colorFormats,
    depthStencilFormat: compatibility.depthStencilFormat ?? null,
    sampleCount: compatibility.sampleCount ?? 1,
    viewMask: compatibility.viewMask ?? 0,
    readOnlyDepth: compatibility.readOnlyDepth ?? false,
    readOnlyStencil: compatibility.readOnlyStencil ?? false,
  }));
}

export class RenderDrawBundleRuntime {
  private readonly records = new Map<string, InternalRecord>();
  private readonly dependencyIndex = new Map<string, Set<string>>();
  private readonly watchers = new Set<RenderDrawBundleWatcher>();
  private readonly maximumBundleCount: number;
  private readonly maximumBytes: number;
  private readonly maximumIdleFrames: number;
  private readonly retainFailedBundles: boolean;
  private frame = 0;
  private revision = 0;
  private submissions = 0;

  constructor(
    private readonly backend: RenderDrawBundleCompilerBackend,
    options: RenderDrawBundleCacheOptions = {},
  ) {
    this.maximumBundleCount = options.maximumBundleCount ?? DEFAULT_MAXIMUM_BUNDLE_COUNT;
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
    this.maximumIdleFrames = options.maximumIdleFrames ?? DEFAULT_MAXIMUM_IDLE_FRAMES;
    this.retainFailedBundles = options.retainFailedBundles ?? false;
    if (!Number.isInteger(this.maximumBundleCount) || this.maximumBundleCount < 1) {
      throw new Error("maximumBundleCount must be a positive integer");
    }
    if (!Number.isFinite(this.maximumBytes) || this.maximumBytes < 0) {
      throw new Error("maximumBytes must be finite and non-negative");
    }
  }

  register(descriptor: RenderDrawBundleDescriptor): RenderDrawBundleRecord {
    this.validateDescriptor(descriptor);
    if (this.records.has(descriptor.id)) throw new Error(`Draw bundle ${descriptor.id} is already registered`);
    const cloned = cloneDescriptor(descriptor);
    const record: InternalRecord = {
      id: cloned.id,
      descriptor: cloned,
      state: "registered",
      revision: 1,
      signature: this.descriptorSignature(cloned),
      handle: null,
      error: null,
      lastUsedFrame: this.frame,
      submissionCount: 0,
      byteSize: 0,
      compileGeneration: 0,
    };
    this.records.set(record.id, record);
    this.indexDependencies(record);
    this.bumpRevision();
    return cloneRecord(record);
  }

  async update(id: string, patch: Partial<Omit<RenderDrawBundleDescriptor, "id">>): Promise<RenderDrawBundleRecord> {
    const record = this.requireRecord(id);
    const descriptor: RenderDrawBundleDescriptor = {
      ...record.descriptor,
      ...patch,
      id,
      compatibility: patch.compatibility ?? record.descriptor.compatibility,
      commands: patch.commands ?? record.descriptor.commands,
    };
    this.validateDescriptor(descriptor);
    this.unindexDependencies(record);
    await this.releaseHandle(record);
    record.descriptor = cloneDescriptor(descriptor);
    record.signature = this.descriptorSignature(descriptor);
    record.state = "registered";
    record.error = null;
    record.revision += 1;
    record.compileGeneration += 1;
    this.indexDependencies(record);
    this.bumpRevision();
    return cloneRecord(record);
  }

  get(id: string): RenderDrawBundleRecord | undefined {
    const record = this.records.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  list(): RenderDrawBundleRecord[] {
    return [...this.records.values()].map(cloneRecord);
  }

  findBySignature(signature: string): RenderDrawBundleRecord[] {
    return [...this.records.values()].filter((record) => record.signature === signature).map(cloneRecord);
  }

  async compile(id: string): Promise<RenderDrawBundleRecord> {
    const record = this.requireRecord(id);
    if (record.state === "ready" && record.handle) {
      record.lastUsedFrame = this.frame;
      return cloneRecord(record);
    }
    if (record.state === "destroyed") throw new Error(`Draw bundle ${id} has been destroyed`);
    const generation = ++record.compileGeneration;
    record.state = "compiling";
    record.error = null;
    this.bumpRevision();
    const isDestroyed = (): boolean => record.state === "destroyed";
    try {
      const handle = await this.backend.compile(cloneDescriptor(record.descriptor));
      if (record.compileGeneration !== generation || isDestroyed()) {
        await this.backend.destroy?.(handle);
        return cloneRecord(record);
      }
      record.handle = { ...handle };
      record.byteSize = Math.max(0, handle.byteSize ?? this.estimateByteSize(record.descriptor));
      record.state = "ready";
      record.lastUsedFrame = this.frame;
      record.revision += 1;
      this.bumpRevision();
      await this.enforceLimits(id);
      return cloneRecord(record);
    } catch (error) {
      if (record.compileGeneration === generation && !isDestroyed()) {
        record.state = "failed";
        record.error = error instanceof Error ? error.message : String(error);
        record.revision += 1;
        this.bumpRevision();
      }
      throw error;
    }
  }

  async compileAll(): Promise<RenderDrawBundleRecord[]> {
    const compiled: RenderDrawBundleRecord[] = [];
    const ordered = [...this.records.values()].sort((a, b) => (b.descriptor.priority ?? 0) - (a.descriptor.priority ?? 0));
    for (const record of ordered) {
      if (record.state === "destroyed") continue;
      try {
        compiled.push(await this.compile(record.id));
      } catch {
        if (!this.retainFailedBundles) await this.remove(record.id);
      }
    }
    return compiled;
  }

  async submit(id: string, compatibility?: RenderDrawBundleCompatibility): Promise<void> {
    let record = this.requireRecord(id);
    if (compatibility && compatibilitySignature(record.descriptor.compatibility) !== compatibilitySignature(compatibility)) {
      throw new Error(`Draw bundle ${id} is incompatible with the active render pass`);
    }
    if (record.state !== "ready" || !record.handle) {
      await this.compile(id);
      record = this.requireRecord(id);
    }
    if (!record.handle) throw new Error(`Draw bundle ${id} did not produce a backend handle`);
    await this.backend.submit?.({ ...record.handle });
    record.submissionCount += 1;
    record.lastUsedFrame = this.frame;
    this.submissions += 1;
    this.bumpRevision();
    if (record.descriptor.reusable === false) await this.invalidate(id);
  }

  async invalidate(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.state === "destroyed") return false;
    record.compileGeneration += 1;
    await this.releaseHandle(record);
    record.state = "invalidated";
    record.error = null;
    record.revision += 1;
    this.bumpRevision();
    return true;
  }

  async invalidateDependency(dependencyId: string): Promise<string[]> {
    const ids = [...(this.dependencyIndex.get(dependencyId) ?? [])];
    const invalidated: string[] = [];
    for (const id of ids) {
      if (await this.invalidate(id)) invalidated.push(id);
    }
    return invalidated;
  }

  async invalidateCompatibility(compatibility: RenderDrawBundleCompatibility): Promise<string[]> {
    const signature = compatibilitySignature(compatibility);
    const invalidated: string[] = [];
    for (const record of this.records.values()) {
      if (compatibilitySignature(record.descriptor.compatibility) === signature && await this.invalidate(record.id)) {
        invalidated.push(record.id);
      }
    }
    return invalidated;
  }

  async remove(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    record.compileGeneration += 1;
    record.state = "destroyed";
    await this.releaseHandle(record);
    this.unindexDependencies(record);
    this.records.delete(id);
    this.bumpRevision();
    return true;
  }

  async beginFrame(frame?: number): Promise<void> {
    this.frame = frame ?? this.frame + 1;
    if (!Number.isInteger(this.frame) || this.frame < 0) throw new Error("Render frame must be a non-negative integer");
    const stale: string[] = [];
    for (const record of this.records.values()) {
      if (record.state === "ready" && this.frame - record.lastUsedFrame > this.maximumIdleFrames) stale.push(record.id);
    }
    for (const id of stale) await this.invalidate(id);
    await this.enforceLimits();
    this.bumpRevision();
  }

  snapshot(): RenderDrawBundleCacheSnapshot {
    const records = [...this.records.values()];
    return {
      revision: this.revision,
      frame: this.frame,
      registeredCount: records.length,
      readyCount: records.filter((record) => record.state === "ready").length,
      compilingCount: records.filter((record) => record.state === "compiling").length,
      failedCount: records.filter((record) => record.state === "failed").length,
      invalidatedCount: records.filter((record) => record.state === "invalidated").length,
      cachedBytes: records.reduce((total, record) => total + record.byteSize, 0),
      submissions: this.submissions,
    };
  }

  watch(watcher: RenderDrawBundleWatcher): () => void {
    this.watchers.add(watcher);
    watcher(this.snapshot());
    return () => this.watchers.delete(watcher);
  }

  async clear(): Promise<void> {
    const ids = [...this.records.keys()];
    for (const id of ids) await this.remove(id);
  }

  private async enforceLimits(protectedId?: string): Promise<void> {
    let snapshot = this.snapshot();
    if (snapshot.readyCount <= this.maximumBundleCount && snapshot.cachedBytes <= this.maximumBytes) return;
    const evictable = [...this.records.values()]
      .filter((record) => record.id !== protectedId && record.state === "ready")
      .sort((a, b) => {
        const priorityDelta = (a.descriptor.priority ?? 0) - (b.descriptor.priority ?? 0);
        if (priorityDelta !== 0) return priorityDelta;
        if (a.lastUsedFrame !== b.lastUsedFrame) return a.lastUsedFrame - b.lastUsedFrame;
        return a.submissionCount - b.submissionCount;
      });
    for (const record of evictable) {
      await this.invalidate(record.id);
      snapshot = this.snapshot();
      if (snapshot.readyCount <= this.maximumBundleCount && snapshot.cachedBytes <= this.maximumBytes) break;
    }
  }

  private descriptorSignature(descriptor: RenderDrawBundleDescriptor): string {
    return hashString(stableValue({
      compatibility: descriptor.compatibility,
      commands: descriptor.commands,
      dependencies: [...(descriptor.dependencies ?? [])].sort(),
      inheritedState: [...(descriptor.inheritedState ?? [])].sort(),
    }));
  }

  private estimateByteSize(descriptor: RenderDrawBundleDescriptor): number {
    return 128 + descriptor.commands.reduce((total, command) => total + stableValue(command).length * 2 + 24, 0);
  }

  private validateDescriptor(descriptor: RenderDrawBundleDescriptor): void {
    if (!descriptor.id) throw new Error("Draw bundle id cannot be empty");
    if (descriptor.compatibility.colorFormats.length === 0 && !descriptor.compatibility.depthStencilFormat) {
      throw new Error(`Draw bundle ${descriptor.id} has no render target formats`);
    }
    const sampleCount = descriptor.compatibility.sampleCount ?? 1;
    if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error(`Draw bundle ${descriptor.id} has invalid sample count`);
    if (descriptor.commands.length === 0) throw new Error(`Draw bundle ${descriptor.id} has no commands`);
    let pipelineBound = false;
    for (const command of descriptor.commands) {
      if (command.type === "bind_pipeline") pipelineBound = true;
      if ((command.type === "draw" || command.type === "draw_indexed"
        || command.type === "draw_indirect" || command.type === "draw_indexed_indirect") && !pipelineBound) {
        throw new Error(`Draw bundle ${descriptor.id} draws before binding a pipeline`);
      }
      if (command.type === "bind_vertex_buffer" && (!Number.isInteger(command.slot) || command.slot < 0)) {
        throw new Error(`Draw bundle ${descriptor.id} has an invalid vertex buffer slot`);
      }
      if (command.type === "bind_uniform_set" && (!Number.isInteger(command.set) || command.set < 0)) {
        throw new Error(`Draw bundle ${descriptor.id} has an invalid uniform set index`);
      }
      if (command.type === "draw" && command.vertexCount < 1) throw new Error(`Draw bundle ${descriptor.id} has an empty draw`);
      if (command.type === "draw_indexed" && command.indexCount < 1) throw new Error(`Draw bundle ${descriptor.id} has an empty indexed draw`);
    }
  }

  private indexDependencies(record: InternalRecord): void {
    for (const dependency of record.descriptor.dependencies ?? []) {
      let ids = this.dependencyIndex.get(dependency);
      if (!ids) {
        ids = new Set();
        this.dependencyIndex.set(dependency, ids);
      }
      ids.add(record.id);
    }
  }

  private unindexDependencies(record: InternalRecord): void {
    for (const dependency of record.descriptor.dependencies ?? []) {
      const ids = this.dependencyIndex.get(dependency);
      ids?.delete(record.id);
      if (ids?.size === 0) this.dependencyIndex.delete(dependency);
    }
  }

  private async releaseHandle(record: InternalRecord): Promise<void> {
    const handle = record.handle;
    record.handle = null;
    record.byteSize = 0;
    if (handle) await this.backend.destroy?.({ ...handle });
  }

  private requireRecord(id: string): InternalRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown draw bundle ${id}`);
    return record;
  }

  private bumpRevision(): void {
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function renderDrawBundleCompatibilitySignature(compatibility: RenderDrawBundleCompatibility): string {
  return compatibilitySignature(compatibility);
}
