export interface RenderPipelineRebuildDescriptor {
  id: string;
  shaderIds: readonly string[];
  layoutSignature: string;
  stateSignature: string;
  priority?: number;
}

export interface RenderPipelineRebuildHandle {
  id: string;
}

export interface RenderPipelineRebuildBackend {
  build(descriptor: RenderPipelineRebuildDescriptor): RenderPipelineRebuildHandle | Promise<RenderPipelineRebuildHandle>;
  destroy(handle: RenderPipelineRebuildHandle): void | Promise<void>;
}

export type RenderPipelineRebuildState = "ready" | "queued" | "building" | "failed";

export interface RenderPipelineRebuildRecord {
  id: string;
  descriptor: RenderPipelineRebuildDescriptor;
  handle: RenderPipelineRebuildHandle | null;
  state: RenderPipelineRebuildState;
  revision: number;
  error: string | null;
  invalidatedBy: string[];
}

export interface RenderPipelineRebuildSnapshot {
  pipelineCount: number;
  queuedCount: number;
  buildingCount: number;
  failedCount: number;
  successfulRebuilds: number;
}

interface InternalRecord extends RenderPipelineRebuildRecord {
  generation: number;
}

function cloneDescriptor(descriptor: RenderPipelineRebuildDescriptor): RenderPipelineRebuildDescriptor {
  return { ...descriptor, shaderIds: [...descriptor.shaderIds] };
}

export class RenderPipelineRebuildRuntime {
  private readonly records = new Map<string, InternalRecord>();
  private readonly shaderIndex = new Map<string, Set<string>>();
  private readonly queue: string[] = [];
  private running = false;
  private successfulRebuilds = 0;

  constructor(private readonly backend: RenderPipelineRebuildBackend) {}

  async register(descriptor: RenderPipelineRebuildDescriptor): Promise<RenderPipelineRebuildRecord> {
    this.validate(descriptor);
    if (this.records.has(descriptor.id)) throw new Error(`Render pipeline ${descriptor.id} is already registered`);
    const record: InternalRecord = {
      id: descriptor.id,
      descriptor: cloneDescriptor(descriptor),
      handle: null,
      state: "building",
      revision: 0,
      error: null,
      invalidatedBy: [],
      generation: 1,
    };
    this.records.set(record.id, record);
    this.index(record);
    await this.build(record, record.generation);
    return this.cloneRecord(record);
  }

  invalidateShader(shaderId: string): string[] {
    const ids = [...(this.shaderIndex.get(shaderId) ?? [])];
    for (const id of ids) this.enqueue(id, shaderId);
    void this.pump();
    return ids;
  }

  invalidatePipeline(id: string, reason = "explicit"): void {
    this.require(id);
    this.enqueue(id, reason);
    void this.pump();
  }

  async update(id: string, descriptor: Omit<RenderPipelineRebuildDescriptor, "id">): Promise<void> {
    const record = this.require(id);
    this.unindex(record);
    record.descriptor = cloneDescriptor({ ...descriptor, id });
    this.validate(record.descriptor);
    this.index(record);
    this.enqueue(id, "descriptor_update");
    await this.pump();
  }

  get(id: string): RenderPipelineRebuildRecord | undefined {
    const record = this.records.get(id);
    return record ? this.cloneRecord(record) : undefined;
  }

  list(state?: RenderPipelineRebuildState): RenderPipelineRebuildRecord[] {
    return [...this.records.values()].filter((record) => !state || record.state === state).map((record) => this.cloneRecord(record));
  }

  async retryFailed(): Promise<void> {
    for (const record of this.records.values()) if (record.state === "failed") this.enqueue(record.id, "retry");
    await this.pump();
  }

  async remove(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    record.generation += 1;
    this.unindex(record);
    this.records.delete(id);
    const queueIndex = this.queue.indexOf(id);
    if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
    if (record.handle) await this.backend.destroy({ ...record.handle });
    return true;
  }

  snapshot(): RenderPipelineRebuildSnapshot {
    const records = [...this.records.values()];
    return {
      pipelineCount: records.length,
      queuedCount: records.filter((record) => record.state === "queued").length,
      buildingCount: records.filter((record) => record.state === "building").length,
      failedCount: records.filter((record) => record.state === "failed").length,
      successfulRebuilds: this.successfulRebuilds,
    };
  }

  private enqueue(id: string, reason: string): void {
    const record = this.require(id);
    record.generation += 1;
    record.state = "queued";
    record.error = null;
    if (!record.invalidatedBy.includes(reason)) record.invalidatedBy.push(reason);
    if (!this.queue.includes(id)) this.queue.push(id);
    this.queue.sort((a, b) => (this.records.get(b)?.descriptor.priority ?? 0) - (this.records.get(a)?.descriptor.priority ?? 0));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const id = this.queue.shift()!;
        const record = this.records.get(id);
        if (!record) continue;
        const generation = record.generation;
        record.state = "building";
        await this.build(record, generation);
      }
    } finally {
      this.running = false;
    }
  }

  private async build(record: InternalRecord, generation: number): Promise<void> {
    try {
      const handle = await this.backend.build(cloneDescriptor(record.descriptor));
      if (record.generation !== generation || !this.records.has(record.id)) {
        await this.backend.destroy(handle);
        return;
      }
      const previous = record.handle;
      record.handle = { ...handle };
      record.state = "ready";
      record.revision += 1;
      record.error = null;
      record.invalidatedBy = [];
      this.successfulRebuilds += 1;
      if (previous) await this.backend.destroy(previous);
    } catch (error) {
      if (record.generation !== generation) return;
      record.state = "failed";
      record.error = error instanceof Error ? error.message : String(error);
    }
  }

  private index(record: InternalRecord): void {
    for (const shaderId of record.descriptor.shaderIds) {
      const ids = this.shaderIndex.get(shaderId) ?? new Set<string>();
      ids.add(record.id);
      this.shaderIndex.set(shaderId, ids);
    }
  }

  private unindex(record: InternalRecord): void {
    for (const shaderId of record.descriptor.shaderIds) {
      const ids = this.shaderIndex.get(shaderId);
      ids?.delete(record.id);
      if (ids?.size === 0) this.shaderIndex.delete(shaderId);
    }
  }

  private validate(descriptor: RenderPipelineRebuildDescriptor): void {
    if (!descriptor.id || !descriptor.layoutSignature || !descriptor.stateSignature) throw new Error("Pipeline rebuild descriptor is incomplete");
    if (descriptor.shaderIds.length === 0) throw new Error(`Pipeline ${descriptor.id} requires at least one shader`);
  }

  private require(id: string): InternalRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown render pipeline ${id}`);
    return record;
  }

  private cloneRecord(record: InternalRecord): RenderPipelineRebuildRecord {
    return { ...record, descriptor: cloneDescriptor(record.descriptor), handle: record.handle ? { ...record.handle } : null, invalidatedBy: [...record.invalidatedBy] };
  }
}
