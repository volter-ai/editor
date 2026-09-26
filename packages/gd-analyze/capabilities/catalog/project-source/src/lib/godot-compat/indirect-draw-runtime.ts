import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export interface GodotIndirectDrawInstanceDescriptor {
  readonly rid: GodotRid;
  readonly mesh: GodotRid;
  readonly surface: number;
  readonly material: GodotRid | null;
  readonly pipeline: GodotRid;
  readonly vertexArray: GodotRid;
  readonly indexArray?: GodotRid | null;
  readonly vertexCount: number;
  readonly indexCount?: number;
  readonly firstVertex?: number;
  readonly firstIndex?: number;
  readonly vertexOffset?: number;
  readonly layerMask?: number;
  readonly visible?: boolean;
  readonly shadow?: boolean;
  readonly instanceData?: unknown;
  readonly sortKey?: number;
}

export interface GodotIndirectDrawInstanceState extends GodotIndirectDrawInstanceDescriptor {
  readonly indexArray: GodotRid | null;
  readonly indexCount: number;
  readonly firstVertex: number;
  readonly firstIndex: number;
  readonly vertexOffset: number;
  readonly layerMask: number;
  readonly visible: boolean;
  readonly shadow: boolean;
  readonly sortKey: number;
  readonly instanceIndex: number;
  readonly dirty: boolean;
  readonly generation: number;
}

export interface GodotIndirectDrawCommand {
  readonly indexed: boolean;
  readonly count: number;
  readonly instanceCount: number;
  readonly firstIndex: number;
  readonly vertexOffset: number;
  readonly firstVertex: number;
  readonly firstInstance: number;
}

export interface GodotIndirectDrawBatch {
  readonly key: string;
  readonly pipeline: GodotRid;
  readonly vertexArray: GodotRid;
  readonly indexArray: GodotRid | null;
  readonly material: GodotRid | null;
  readonly surface: number;
  readonly shadow: boolean;
  readonly instances: readonly GodotIndirectDrawInstanceState[];
  readonly commands: readonly GodotIndirectDrawCommand[];
  readonly commandData: Uint32Array;
  readonly instanceData: readonly unknown[];
}

export interface GodotIndirectDrawFrameResult {
  readonly frame: number;
  readonly cullMask: number;
  readonly batches: readonly GodotIndirectDrawBatch[];
  readonly visibleInstances: number;
  readonly culledInstances: number;
  readonly commands: number;
  readonly uploadedBytes: number;
}

export interface GodotIndirectDrawBackend {
  uploadCommands(batch: GodotIndirectDrawBatch): void | Promise<void>;
  uploadInstances?(batch: GodotIndirectDrawBatch): void | Promise<void>;
  submit(batch: GodotIndirectDrawBatch): void | Promise<void>;
}

export interface GodotIndirectDrawRuntimeSnapshot {
  readonly frame: number;
  readonly instances: number;
  readonly dirtyInstances: number;
  readonly batches: number;
  readonly commands: number;
  readonly submittedFrames: number;
  readonly uploadedBytes: number;
  readonly generation: number;
  readonly lastFrame: GodotIndirectDrawFrameResult | null;
}

interface InstanceEntry {
  rid: GodotRid; mesh: GodotRid; surface: number; material: GodotRid | null; pipeline: GodotRid;
  vertexArray: GodotRid; indexArray: GodotRid | null; vertexCount: number; indexCount: number;
  firstVertex: number; firstIndex: number; vertexOffset: number; layerMask: number; visible: boolean;
  shadow: boolean; instanceData: unknown; sortKey: number; instanceIndex: number; dirty: boolean; generation: number; order: number;
}

function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: IndirectDrawRuntime.${member} requires integer in [${minimum}, ${maximum}].`); return result;
}
function signedInteger(value: unknown, member: string): number { const result = Number(value); if (!Number.isSafeInteger(result)) throw new RangeError(`godot-compat: IndirectDrawRuntime.${member} requires integer.`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: IndirectDrawRuntime.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: IndirectDrawRuntime requires RID.'); godotRidGetId(value); return value as GodotRid; }
function optionalRid(value: unknown): GodotRid | null { return value === null || value === undefined ? null : rid(value); }
function state(entry: InstanceEntry): GodotIndirectDrawInstanceState { return Object.freeze({ ...entry }); }
function ridKey(value: GodotRid | null): string { return value === null ? '-' : godotRidGetId(value).toString(16); }

export class GodotIndirectDrawRuntime {
  public readonly __godotClass = 'IndirectDrawRuntime';
  private readonly backend: GodotIndirectDrawBackend;
  private readonly instances = new Map<bigint, InstanceEntry>();
  private readonly freeIndices: number[] = [];
  private readonly watchers = new Set<(snapshot: GodotIndirectDrawRuntimeSnapshot) => void>();
  private nextIndex = 0; private nextOrder = 0; private frameValue = 0; private generationValue = 0;
  private submittedFrames = 0; private uploadedBytes = 0; private processing = false;
  private lastFrame: GodotIndirectDrawFrameResult | null = null;

  public constructor(backend: GodotIndirectDrawBackend) {
    if (typeof backend?.uploadCommands !== 'function' || typeof backend?.submit !== 'function') throw new TypeError('godot-compat: IndirectDrawRuntime requires upload and submit backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'IndirectDrawRuntime');
  }

  private allocateIndex(): number { return this.freeIndices.shift() ?? this.nextIndex++; }
  public addInstance(value: GodotIndirectDrawInstanceDescriptor): number {
    const instanceRid = rid(value.rid), id = godotRidGetId(instanceRid); if (this.instances.has(id)) throw new Error(`godot-compat: indirect draw instance RID ${id} already exists.`);
    const entry: InstanceEntry = {
      rid: instanceRid, mesh: rid(value.mesh), surface: integer(value.surface, 'surface'), material: optionalRid(value.material), pipeline: rid(value.pipeline),
      vertexArray: rid(value.vertexArray), indexArray: optionalRid(value.indexArray), vertexCount: integer(value.vertexCount, 'vertex_count'),
      indexCount: integer(value.indexCount ?? 0, 'index_count'), firstVertex: integer(value.firstVertex ?? 0, 'first_vertex'),
      firstIndex: integer(value.firstIndex ?? 0, 'first_index'), vertexOffset: signedInteger(value.vertexOffset ?? 0, 'vertex_offset'),
      layerMask: integer(value.layerMask ?? 1, 'layer_mask', 0, 0xffff_ffff), visible: bool(value.visible ?? true, 'visible'), shadow: bool(value.shadow ?? false, 'shadow'),
      instanceData: value.instanceData ?? null, sortKey: signedInteger(value.sortKey ?? 0, 'sort_key'), instanceIndex: this.allocateIndex(), dirty: true, generation: 1, order: this.nextOrder++,
    };
    if (entry.indexArray !== null && entry.indexCount === 0) throw new RangeError('godot-compat: indexed indirect draw requires index_count.');
    if (entry.indexArray === null && entry.vertexCount === 0) throw new RangeError('godot-compat: indirect draw requires vertex_count.');
    this.instances.set(id, entry); this.generationValue += 1; this.publish(); return entry.instanceIndex;
  }

  public removeInstance(value: unknown): boolean {
    const instanceRid = rid(value), entry = this.instances.get(godotRidGetId(instanceRid)); if (entry === undefined) return false;
    this.instances.delete(godotRidGetId(instanceRid)); this.freeIndices.push(entry.instanceIndex); this.freeIndices.sort((left, right) => left - right);
    this.generationValue += 1; this.publish(); return true;
  }
  private requireEntry(value: unknown): InstanceEntry { const instanceRid = rid(value), entry = this.instances.get(godotRidGetId(instanceRid)); if (entry === undefined) throw new Error('godot-compat: indirect draw instance does not exist.'); return entry; }

  public updateInstance(value: unknown, patch: Partial<Omit<GodotIndirectDrawInstanceDescriptor, 'rid'>>): void {
    const entry = this.requireEntry(value);
    if (patch.mesh !== undefined) entry.mesh = rid(patch.mesh); if (patch.surface !== undefined) entry.surface = integer(patch.surface, 'surface');
    if (patch.material !== undefined) entry.material = optionalRid(patch.material); if (patch.pipeline !== undefined) entry.pipeline = rid(patch.pipeline);
    if (patch.vertexArray !== undefined) entry.vertexArray = rid(patch.vertexArray); if (patch.indexArray !== undefined) entry.indexArray = optionalRid(patch.indexArray);
    if (patch.vertexCount !== undefined) entry.vertexCount = integer(patch.vertexCount, 'vertex_count'); if (patch.indexCount !== undefined) entry.indexCount = integer(patch.indexCount, 'index_count');
    if (patch.firstVertex !== undefined) entry.firstVertex = integer(patch.firstVertex, 'first_vertex'); if (patch.firstIndex !== undefined) entry.firstIndex = integer(patch.firstIndex, 'first_index');
    if (patch.vertexOffset !== undefined) entry.vertexOffset = signedInteger(patch.vertexOffset, 'vertex_offset'); if (patch.layerMask !== undefined) entry.layerMask = integer(patch.layerMask, 'layer_mask', 0, 0xffff_ffff);
    if (patch.visible !== undefined) entry.visible = bool(patch.visible, 'visible'); if (patch.shadow !== undefined) entry.shadow = bool(patch.shadow, 'shadow');
    if (patch.instanceData !== undefined) entry.instanceData = patch.instanceData; if (patch.sortKey !== undefined) entry.sortKey = signedInteger(patch.sortKey, 'sort_key');
    entry.dirty = true; entry.generation += 1; this.publish();
  }

  private batchKey(entry: InstanceEntry): string {
    return `${ridKey(entry.pipeline)}:${ridKey(entry.vertexArray)}:${ridKey(entry.indexArray)}:${ridKey(entry.material)}:${entry.surface}:${entry.shadow ? 1 : 0}`;
  }
  private command(entry: InstanceEntry, firstInstance: number, instanceCount: number): GodotIndirectDrawCommand {
    return Object.freeze({ indexed: entry.indexArray !== null, count: entry.indexArray === null ? entry.vertexCount : entry.indexCount,
      instanceCount, firstIndex: entry.firstIndex, vertexOffset: entry.vertexOffset, firstVertex: entry.firstVertex, firstInstance });
  }
  private encode(commands: readonly GodotIndirectDrawCommand[]): Uint32Array {
    const data = new Uint32Array(commands.length * 5);
    commands.forEach((command, index) => {
      const offset = index * 5; data[offset] = command.count; data[offset + 1] = command.instanceCount;
      data[offset + 2] = command.indexed ? command.firstIndex : command.firstVertex;
      data[offset + 3] = command.indexed ? command.vertexOffset >>> 0 : command.firstInstance;
      data[offset + 4] = command.indexed ? command.firstInstance : 0;
    }); return data;
  }

  private buildBatches(visible: InstanceEntry[]): GodotIndirectDrawBatch[] {
    const grouped = new Map<string, InstanceEntry[]>();
    for (const entry of visible) { const key = this.batchKey(entry); let group = grouped.get(key); if (group === undefined) { group = []; grouped.set(key, group); } group.push(entry); }
    const batches: GodotIndirectDrawBatch[] = [];
    for (const [key, group] of grouped) {
      group.sort((left, right) => left.sortKey - right.sortKey || left.instanceIndex - right.instanceIndex || left.order - right.order);
      const commands: GodotIndirectDrawCommand[] = []; let run: InstanceEntry[] = [];
      const flush = () => { if (run.length === 0) return; commands.push(this.command(run[0]!, run[0]!.instanceIndex, run.length)); run = []; };
      for (const entry of group) {
        const previous = run[run.length - 1];
        if (previous !== undefined && (entry.instanceIndex !== previous.instanceIndex + 1 || entry.firstIndex !== previous.firstIndex || entry.firstVertex !== previous.firstVertex || entry.indexCount !== previous.indexCount || entry.vertexCount !== previous.vertexCount)) flush();
        run.push(entry);
      }
      flush(); const commandData = this.encode(commands), first = group[0]!;
      batches.push(Object.freeze({ key, pipeline: first.pipeline, vertexArray: first.vertexArray, indexArray: first.indexArray, material: first.material,
        surface: first.surface, shadow: first.shadow, instances: Object.freeze(group.map(state)), commands: Object.freeze(commands), commandData, instanceData: Object.freeze(group.map((entry) => entry.instanceData)) }));
    }
    return batches.sort((left, right) => left.key.localeCompare(right.key));
  }

  public async processFrame(frameValue: unknown, cullMaskValue: unknown = 0xffff_ffff, shadowPass = false): Promise<GodotIndirectDrawFrameResult> {
    const frame = integer(frameValue, 'frame'), cullMask = integer(cullMaskValue, 'cull_mask', 0, 0xffff_ffff);
    if (frame < this.frameValue) throw new RangeError('godot-compat: indirect draw frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: indirect draw frame already processing.');
    this.frameValue = frame; this.processing = true;
    try {
      const visible = [...this.instances.values()].filter((entry) => entry.visible && (entry.layerMask & cullMask) !== 0 && (!shadowPass || entry.shadow));
      const batches = this.buildBatches(visible); let bytes = 0;
      for (const batch of batches) { await this.backend.uploadCommands(batch); await this.backend.uploadInstances?.(batch); await this.backend.submit(batch); bytes += batch.commandData.byteLength; }
      for (const entry of visible) entry.dirty = false; this.submittedFrames += 1; this.uploadedBytes += bytes;
      this.lastFrame = Object.freeze({ frame, cullMask, batches: Object.freeze(batches), visibleInstances: visible.length, culledInstances: this.instances.size - visible.length,
        commands: batches.reduce((total, batch) => total + batch.commands.length, 0), uploadedBytes: bytes }); this.publish(); return this.lastFrame;
    } finally { this.processing = false; }
  }

  public compactIndices(): ReadonlyMap<number, number> {
    if (this.processing) throw new Error('godot-compat: cannot compact indirect instances during frame.');
    const remap = new Map<number, number>(); const entries = [...this.instances.values()].sort((left, right) => left.instanceIndex - right.instanceIndex);
    entries.forEach((entry, index) => { remap.set(entry.instanceIndex, index); entry.instanceIndex = index; entry.dirty = true; entry.generation += 1; });
    this.nextIndex = entries.length; this.freeIndices.splice(0); this.generationValue += 1; this.publish(); return remap;
  }
  public getInstance(value: unknown): GodotIndirectDrawInstanceState | null { const instanceRid = rid(value), entry = this.instances.get(godotRidGetId(instanceRid)); return entry === undefined ? null : state(entry); }
  public getSnapshot(): GodotIndirectDrawRuntimeSnapshot { return Object.freeze({ frame: this.frameValue, instances: this.instances.size, dirtyInstances: [...this.instances.values()].filter((entry) => entry.dirty).length,
    batches: this.lastFrame?.batches.length ?? 0, commands: this.lastFrame?.commands ?? 0, submittedFrames: this.submittedFrames, uploadedBytes: this.uploadedBytes, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotIndirectDrawRuntimeSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear indirect draws during frame.'); this.instances.clear(); this.freeIndices.splice(0); this.nextIndex = 0; this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotIndirectDrawRuntime(backend: GodotIndirectDrawBackend): GodotIndirectDrawRuntime { return new GodotIndirectDrawRuntime(backend); }
