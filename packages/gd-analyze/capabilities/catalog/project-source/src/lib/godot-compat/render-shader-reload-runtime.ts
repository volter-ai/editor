export interface RenderShaderModuleSource {
  id: string;
  language: string;
  source: string | Uint8Array;
  entryPoints: readonly string[];
  defines?: Readonly<Record<string, string | number | boolean>>;
}

export interface RenderShaderModuleHandle {
  id: string;
}

export interface RenderShaderReloadBackend {
  compile(source: RenderShaderModuleSource): RenderShaderModuleHandle | Promise<RenderShaderModuleHandle>;
  destroy(handle: RenderShaderModuleHandle): void | Promise<void>;
}

export interface RenderShaderModuleRecord {
  id: string;
  revision: number;
  state: "ready" | "compiling" | "failed";
  handle: RenderShaderModuleHandle | null;
  error: string | null;
  dependentPipelines: string[];
}

export interface RenderShaderReloadResult {
  shaderId: string;
  revision: number;
  invalidatedPipelines: string[];
}

type ShaderReloadWatcher = (result: RenderShaderReloadResult) => void;

interface InternalRecord extends RenderShaderModuleRecord {
  source: RenderShaderModuleSource;
  generation: number;
}

function cloneSource(source: RenderShaderModuleSource): RenderShaderModuleSource {
  return {
    ...source,
    source: typeof source.source === "string" ? source.source : source.source.slice(),
    entryPoints: [...source.entryPoints],
    ...(source.defines === undefined ? {} : { defines: { ...source.defines } }),
  };
}

export class RenderShaderReloadRuntime {
  private readonly records = new Map<string, InternalRecord>();
  private readonly watchers = new Set<ShaderReloadWatcher>();

  constructor(private readonly backend: RenderShaderReloadBackend) {}

  async register(source: RenderShaderModuleSource): Promise<RenderShaderModuleRecord> {
    this.validate(source);
    if (this.records.has(source.id)) throw new Error(`Shader module ${source.id} is already registered`);
    const record: InternalRecord = {
      id: source.id,
      revision: 1,
      state: "compiling",
      handle: null,
      error: null,
      dependentPipelines: [],
      source: cloneSource(source),
      generation: 1,
    };
    this.records.set(source.id, record);
    await this.compile(record, 1);
    return this.cloneRecord(record);
  }

  attachPipeline(shaderId: string, pipelineId: string): void {
    const record = this.require(shaderId);
    if (!record.dependentPipelines.includes(pipelineId)) record.dependentPipelines.push(pipelineId);
  }

  detachPipeline(shaderId: string, pipelineId: string): boolean {
    const record = this.require(shaderId);
    const index = record.dependentPipelines.indexOf(pipelineId);
    if (index < 0) return false;
    record.dependentPipelines.splice(index, 1);
    return true;
  }

  async reload(shaderId: string, patch: Partial<Omit<RenderShaderModuleSource, "id">>): Promise<RenderShaderReloadResult> {
    const record = this.require(shaderId);
    const source = cloneSource({ ...record.source, ...patch, id: shaderId });
    this.validate(source);
    const generation = ++record.generation;
    record.state = "compiling";
    record.error = null;
    record.source = source;
    await this.compile(record, generation);
    if ((record as RenderShaderModuleRecord).state !== "ready") {
      throw new Error(record.error ?? `Shader ${shaderId} reload failed`);
    }
    const result = { shaderId, revision: record.revision, invalidatedPipelines: [...record.dependentPipelines] };
    for (const watcher of this.watchers) watcher(result);
    return result;
  }

  get(shaderId: string): RenderShaderModuleRecord | undefined {
    const record = this.records.get(shaderId);
    return record ? this.cloneRecord(record) : undefined;
  }

  async remove(shaderId: string): Promise<boolean> {
    const record = this.records.get(shaderId);
    if (!record) return false;
    record.generation += 1;
    this.records.delete(shaderId);
    if (record.handle) await this.backend.destroy({ ...record.handle });
    return true;
  }

  watch(watcher: ShaderReloadWatcher): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  private async compile(record: InternalRecord, generation: number): Promise<void> {
    try {
      const handle = await this.backend.compile(cloneSource(record.source));
      if (record.generation !== generation) {
        await this.backend.destroy(handle);
        return;
      }
      const previous = record.handle;
      record.handle = { ...handle };
      record.state = "ready";
      record.revision += 1;
      if (previous) await this.backend.destroy(previous);
    } catch (error) {
      if (record.generation !== generation) return;
      record.state = "failed";
      record.error = error instanceof Error ? error.message : String(error);
    }
  }

  private validate(source: RenderShaderModuleSource): void {
    if (!source.id || !source.language) throw new Error("Shader module requires an id and language");
    if ((typeof source.source === "string" ? source.source.length : source.source.byteLength) === 0) throw new Error(`Shader ${source.id} source cannot be empty`);
    if (source.entryPoints.length === 0) throw new Error(`Shader ${source.id} requires an entry point`);
  }

  private require(id: string): InternalRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown shader module ${id}`);
    return record;
  }

  private cloneRecord(record: InternalRecord): RenderShaderModuleRecord {
    return { id: record.id, revision: record.revision, state: record.state, handle: record.handle ? { ...record.handle } : null, error: record.error, dependentPipelines: [...record.dependentPipelines] };
  }
}
