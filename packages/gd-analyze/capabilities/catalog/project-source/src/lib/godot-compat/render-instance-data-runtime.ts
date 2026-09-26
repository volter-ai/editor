import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotRenderInstanceType = 'mesh' | 'multimesh' | 'particles' | 'decal' | 'light' | 'probe';
export type GodotRenderInstanceDirtyFlag = 'transform' | 'geometry' | 'material' | 'visibility' | 'parameters' | 'skeleton' | 'dependencies';

export interface GodotRenderInstanceDescriptor {
  readonly rid: GodotRid;
  readonly type: GodotRenderInstanceType;
  readonly base?: GodotRid | null;
  readonly material?: GodotRid | null;
  readonly skeleton?: GodotRid | null;
  readonly transform?: unknown;
  readonly previousTransform?: unknown;
  readonly aabb?: unknown;
  readonly layerMask?: number;
  readonly visible?: boolean;
  readonly castShadows?: boolean;
  readonly receiveShadows?: boolean;
  readonly lodBias?: number;
  readonly transparency?: number;
  readonly sortingOffset?: number;
  readonly objectId?: number;
  readonly shaderParameters?: ReadonlyMap<string, unknown> | Record<string, unknown>;
  readonly userData?: unknown;
}

export interface GodotRenderInstanceState {
  readonly rid: GodotRid;
  readonly index: number;
  readonly type: GodotRenderInstanceType;
  readonly base: GodotRid | null;
  readonly material: GodotRid | null;
  readonly skeleton: GodotRid | null;
  readonly transform: unknown;
  readonly previousTransform: unknown;
  readonly aabb: unknown;
  readonly layerMask: number;
  readonly visible: boolean;
  readonly castShadows: boolean;
  readonly receiveShadows: boolean;
  readonly lodBias: number;
  readonly transparency: number;
  readonly sortingOffset: number;
  readonly objectId: number;
  readonly shaderParameters: ReadonlyMap<string, unknown>;
  readonly dependencies: readonly GodotRid[];
  readonly dirtyFlags: readonly GodotRenderInstanceDirtyFlag[];
  readonly lastUploadedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotRenderInstanceUploadBatch {
  readonly frame: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly instances: readonly GodotRenderInstanceState[];
  readonly fullUpload: boolean;
}

export interface GodotRenderInstanceUploadResult {
  readonly frame: number;
  readonly uploadedInstances: number;
  readonly batches: number;
  readonly failedBatches: readonly { batch: GodotRenderInstanceUploadBatch; error: unknown }[];
  readonly remainingDirty: number;
}

export interface GodotRenderInstanceDataBackend {
  resize?(capacity: number): void | Promise<void>;
  upload(batch: GodotRenderInstanceUploadBatch): void | Promise<void>;
  remove?(index: number): void;
}

export interface GodotRenderInstanceDataSnapshot {
  readonly frame: number;
  readonly instances: number;
  readonly capacity: number;
  readonly dirtyInstances: number;
  readonly freeIndices: number;
  readonly uploadBudget: number;
  readonly uploads: number;
  readonly uploadedInstances: number;
  readonly generation: number;
  readonly lastUpload: GodotRenderInstanceUploadResult | null;
}

interface InstanceEntry {
  rid: GodotRid;
  index: number;
  type: GodotRenderInstanceType;
  base: GodotRid | null;
  material: GodotRid | null;
  skeleton: GodotRid | null;
  transform: unknown;
  previousTransform: unknown;
  aabb: unknown;
  layerMask: number;
  visible: boolean;
  castShadows: boolean;
  receiveShadows: boolean;
  lodBias: number;
  transparency: number;
  sortingOffset: number;
  objectId: number;
  shaderParameters: Map<string, unknown>;
  dependencies: Set<bigint>;
  dirtyFlags: Set<GodotRenderInstanceDirtyFlag>;
  lastUploadedFrame: number;
  generation: number;
  userData: unknown;
}

const INSTANCE_TYPES = new Set<GodotRenderInstanceType>(['mesh', 'multimesh', 'particles', 'decal', 'light', 'probe']);
const DIRTY_FLAGS = new Set<GodotRenderInstanceDirtyFlag>(['transform', 'geometry', 'material', 'visibility', 'parameters', 'skeleton', 'dependencies']);

function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: RenderInstanceData.${member} requires integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: RenderInstanceData.${member} requires finite value in [${minimum}, ${maximum}].`);
  }
  return result;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: RenderInstanceData.${member} requires bool.`);
  return value;
}

function rid(value: unknown, member: string): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError(`godot-compat: RenderInstanceData.${member} requires RID.`);
  godotRidGetId(value);
  return value as GodotRid;
}

function optionalRid(value: unknown, member: string): GodotRid | null {
  return value === null || value === undefined ? null : rid(value, member);
}

function instanceType(value: unknown): GodotRenderInstanceType {
  if (!INSTANCE_TYPES.has(value as GodotRenderInstanceType)) throw new TypeError(`godot-compat: unknown render instance type ${String(value)}.`);
  return value as GodotRenderInstanceType;
}

function parameters(value: unknown): Map<string, unknown> {
  if (value === undefined) return new Map();
  if (value instanceof Map) return new Map([...value].map(([key, member]) => [String(key), member]));
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return new Map(Object.entries(value));
  throw new TypeError('godot-compat: RenderInstanceData.shader_parameters requires Dictionary.');
}

function state(entry: InstanceEntry): GodotRenderInstanceState {
  return Object.freeze({
    rid: entry.rid, index: entry.index, type: entry.type,
    base: entry.base, material: entry.material, skeleton: entry.skeleton,
    transform: entry.transform, previousTransform: entry.previousTransform, aabb: entry.aabb,
    layerMask: entry.layerMask, visible: entry.visible, castShadows: entry.castShadows,
    receiveShadows: entry.receiveShadows, lodBias: entry.lodBias,
    transparency: entry.transparency, sortingOffset: entry.sortingOffset, objectId: entry.objectId,
    shaderParameters: new Map(entry.shaderParameters),
    dependencies: Object.freeze([...entry.dependencies].map((id) => Object.freeze({ id }))),
    dirtyFlags: Object.freeze([...entry.dirtyFlags]), lastUploadedFrame: entry.lastUploadedFrame,
    generation: entry.generation, userData: entry.userData,
  });
}

export class GodotRenderInstanceDataRuntime {
  public readonly __godotClass = 'RenderInstanceDataRuntime';
  private readonly backend: GodotRenderInstanceDataBackend;
  private readonly instances = new Map<bigint, InstanceEntry>();
  private readonly entriesByIndex = new Map<number, InstanceEntry>();
  private readonly entriesByDependency = new Map<bigint, Set<InstanceEntry>>();
  private readonly freeIndices: number[] = [];
  private readonly watchers = new Set<(snapshot: GodotRenderInstanceDataSnapshot) => void>();
  private capacityValue: number;
  private nextIndex = 0;
  private frameValue = 0;
  private uploadBudgetValue = 4096;
  private maxBatchSizeValue = 256;
  private generationValue = 0;
  private uploads = 0;
  private uploadedInstances = 0;
  private uploading = false;
  private lastUpload: GodotRenderInstanceUploadResult | null = null;

  public constructor(backend: GodotRenderInstanceDataBackend, initialCapacity = 1024) {
    if (typeof backend?.upload !== 'function') throw new TypeError('godot-compat: RenderInstanceData requires upload backend.');
    this.backend = backend;
    this.capacityValue = integer(initialCapacity, 'initial_capacity', 1);
    registerGodotObjectIdentity(this, 'RenderInstanceDataRuntime');
  }

  private allocateIndex(): number {
    const reused = this.freeIndices.shift();
    if (reused !== undefined) return reused;
    const index = this.nextIndex++;
    if (index >= this.capacityValue) {
      this.capacityValue = Math.max(index + 1, this.capacityValue * 2);
      void this.backend.resize?.(this.capacityValue);
    }
    return index;
  }

  public addInstance(value: GodotRenderInstanceDescriptor): number {
    const instanceRid = rid(value.rid, 'rid'), id = godotRidGetId(instanceRid);
    if (this.instances.has(id)) throw new Error(`godot-compat: render instance RID ${id} already exists.`);
    const entry: InstanceEntry = {
      rid: instanceRid, index: this.allocateIndex(), type: instanceType(value.type),
      base: optionalRid(value.base, 'base'), material: optionalRid(value.material, 'material'),
      skeleton: optionalRid(value.skeleton, 'skeleton'), transform: value.transform ?? null,
      previousTransform: value.previousTransform ?? value.transform ?? null, aabb: value.aabb ?? null,
      layerMask: integer(value.layerMask ?? 1, 'layer_mask', 0, 0xffff_ffff),
      visible: bool(value.visible ?? true, 'visible'), castShadows: bool(value.castShadows ?? true, 'cast_shadows'),
      receiveShadows: bool(value.receiveShadows ?? true, 'receive_shadows'), lodBias: finite(value.lodBias ?? 1, 'lod_bias', 0),
      transparency: finite(value.transparency ?? 0, 'transparency', 0, 1), sortingOffset: finite(value.sortingOffset ?? 0, 'sorting_offset'),
      objectId: integer(value.objectId ?? 0, 'object_id'), shaderParameters: parameters(value.shaderParameters),
      dependencies: new Set(), dirtyFlags: new Set(DIRTY_FLAGS), lastUploadedFrame: -1,
      generation: 1, userData: value.userData ?? null,
    };
    this.instances.set(id, entry); this.entriesByIndex.set(entry.index, entry);
    this.rebuildDependencies(entry); this.generationValue += 1; this.publish();
    return entry.index;
  }

  public removeInstance(value: unknown): boolean {
    const instanceRid = rid(value, 'rid'), id = godotRidGetId(instanceRid), entry = this.instances.get(id);
    if (entry === undefined) return false;
    this.unindexDependencies(entry); this.instances.delete(id); this.entriesByIndex.delete(entry.index);
    this.freeIndices.push(entry.index); this.freeIndices.sort((left, right) => left - right);
    this.backend.remove?.(entry.index); this.generationValue += 1; this.publish();
    return true;
  }

  private requireEntry(value: unknown): InstanceEntry {
    const instanceRid = rid(value, 'rid'), id = godotRidGetId(instanceRid), entry = this.instances.get(id);
    if (entry === undefined) throw new Error(`godot-compat: render instance RID ${id} does not exist.`);
    return entry;
  }

  private dirty(entry: InstanceEntry, flag: GodotRenderInstanceDirtyFlag): void {
    entry.dirtyFlags.add(flag); entry.generation += 1;
  }

  public setTransform(value: unknown, transform: unknown, previousTransform: unknown = undefined): void {
    const entry = this.requireEntry(value);
    entry.previousTransform = previousTransform === undefined ? entry.transform : previousTransform;
    entry.transform = transform; this.dirty(entry, 'transform'); this.publish();
  }

  public setGeometry(value: unknown, baseValue: unknown, aabb: unknown = undefined): void {
    const entry = this.requireEntry(value); this.unindexDependencies(entry);
    entry.base = optionalRid(baseValue, 'base'); if (aabb !== undefined) entry.aabb = aabb;
    this.rebuildDependencies(entry); this.dirty(entry, 'geometry'); this.publish();
  }

  public setMaterial(value: unknown, materialValue: unknown): void {
    const entry = this.requireEntry(value); this.unindexDependencies(entry);
    entry.material = optionalRid(materialValue, 'material'); this.rebuildDependencies(entry);
    this.dirty(entry, 'material'); this.publish();
  }

  public setSkeleton(value: unknown, skeletonValue: unknown): void {
    const entry = this.requireEntry(value); this.unindexDependencies(entry);
    entry.skeleton = optionalRid(skeletonValue, 'skeleton'); this.rebuildDependencies(entry);
    this.dirty(entry, 'skeleton'); this.publish();
  }

  public setVisibility(
    value: unknown,
    visibleValue: unknown,
    layerMaskValue: unknown = undefined,
    transparencyValue: unknown = undefined,
  ): void {
    const entry = this.requireEntry(value); entry.visible = bool(visibleValue, 'visible');
    if (layerMaskValue !== undefined) entry.layerMask = integer(layerMaskValue, 'layer_mask', 0, 0xffff_ffff);
    if (transparencyValue !== undefined) entry.transparency = finite(transparencyValue, 'transparency', 0, 1);
    this.dirty(entry, 'visibility'); this.publish();
  }

  public setShaderParameter(value: unknown, nameValue: unknown, parameterValue: unknown): void {
    const entry = this.requireEntry(value), name = String(nameValue);
    if (name.length === 0) throw new RangeError('godot-compat: shader parameter name cannot be empty.');
    entry.shaderParameters.set(name, parameterValue); this.dirty(entry, 'parameters'); this.publish();
  }

  public eraseShaderParameter(value: unknown, nameValue: unknown): boolean {
    const entry = this.requireEntry(value), removed = entry.shaderParameters.delete(String(nameValue));
    if (removed) { this.dirty(entry, 'parameters'); this.publish(); }
    return removed;
  }

  public setUserData(value: unknown, userData: unknown): void { const entry = this.requireEntry(value); entry.userData = userData; }

  private rebuildDependencies(entry: InstanceEntry): void {
    for (const dependency of [entry.base, entry.material, entry.skeleton]) {
      if (dependency === null) continue;
      const id = godotRidGetId(dependency); entry.dependencies.add(id);
      let entries = this.entriesByDependency.get(id);
      if (entries === undefined) { entries = new Set(); this.entriesByDependency.set(id, entries); }
      entries.add(entry);
    }
  }

  private unindexDependencies(entry: InstanceEntry): void {
    for (const dependency of entry.dependencies) {
      const entries = this.entriesByDependency.get(dependency); if (entries === undefined) continue;
      entries.delete(entry); if (entries.size === 0) this.entriesByDependency.delete(dependency);
    }
    entry.dependencies.clear();
  }

  public invalidateDependency(value: unknown): number {
    const dependency = rid(value, 'dependency'), entries = [...(this.entriesByDependency.get(godotRidGetId(dependency)) ?? [])];
    for (const entry of entries) this.dirty(entry, 'dependencies');
    this.publish(); return entries.length;
  }

  public markDirty(value: unknown, flagValue: unknown): void {
    const entry = this.requireEntry(value);
    if (!DIRTY_FLAGS.has(flagValue as GodotRenderInstanceDirtyFlag)) throw new TypeError(`godot-compat: unknown render instance dirty flag ${String(flagValue)}.`);
    this.dirty(entry, flagValue as GodotRenderInstanceDirtyFlag); this.publish();
  }

  private batches(entries: InstanceEntry[], frame: number): GodotRenderInstanceUploadBatch[] {
    const ordered = entries.sort((left, right) => left.index - right.index), batches: GodotRenderInstanceUploadBatch[] = [];
    let group: InstanceEntry[] = [];
    const flush = () => {
      if (group.length === 0) return;
      batches.push(Object.freeze({
        frame, startIndex: group[0]!.index, endIndex: group[group.length - 1]!.index,
        instances: Object.freeze(group.map(state)), fullUpload: group.length === this.instances.size,
      }));
      group = [];
    };
    for (const entry of ordered) {
      const previous = group[group.length - 1];
      if (previous !== undefined && (entry.index !== previous.index + 1 || group.length >= this.maxBatchSizeValue)) flush();
      group.push(entry);
    }
    flush(); return batches;
  }

  public async uploadFrame(frameValue: unknown): Promise<GodotRenderInstanceUploadResult> {
    const frame = integer(frameValue, 'frame');
    if (frame < this.frameValue) throw new RangeError('godot-compat: render instance frame cannot move backwards.');
    if (this.uploading) throw new Error('godot-compat: render instance upload already in progress.');
    this.frameValue = frame; this.uploading = true;
    const dirty = [...this.instances.values()].filter((entry) => entry.dirtyFlags.size > 0)
      .sort((left, right) => left.index - right.index);
    const selected = dirty.slice(0, this.uploadBudgetValue), failed: Array<{ batch: GodotRenderInstanceUploadBatch; error: unknown }> = [];
    let uploaded = 0;
    try {
      const batches = this.batches(selected, frame);
      for (const batch of batches) {
        try {
          await this.backend.upload(batch);
          for (const instance of batch.instances) {
            const entry = this.entriesByIndex.get(instance.index);
            if (entry === undefined) continue;
            entry.dirtyFlags.clear(); entry.lastUploadedFrame = frame; uploaded += 1;
          }
          this.uploads += 1;
        } catch (error) { failed.push(Object.freeze({ batch, error })); }
      }
      this.uploadedInstances += uploaded;
      this.lastUpload = Object.freeze({
        frame, uploadedInstances: uploaded, batches: batches.length,
        failedBatches: Object.freeze(failed), remainingDirty: [...this.instances.values()].filter((entry) => entry.dirtyFlags.size > 0).length,
      });
      this.publish(); return this.lastUpload;
    } finally { this.uploading = false; }
  }

  public setUploadBudget(value: unknown): void { this.uploadBudgetValue = integer(value, 'upload_budget', 1); }
  public setMaxBatchSize(value: unknown): void { this.maxBatchSizeValue = integer(value, 'max_batch_size', 1); }
  public getInstance(value: unknown): GodotRenderInstanceState | null {
    const instanceRid = rid(value, 'rid'), entry = this.instances.get(godotRidGetId(instanceRid)); return entry === undefined ? null : state(entry);
  }
  public getInstanceByIndex(indexValue: unknown): GodotRenderInstanceState | null {
    const entry = this.entriesByIndex.get(integer(indexValue, 'index')); return entry === undefined ? null : state(entry);
  }
  public getSnapshot(): GodotRenderInstanceDataSnapshot {
    return Object.freeze({
      frame: this.frameValue, instances: this.instances.size, capacity: this.capacityValue,
      dirtyInstances: [...this.instances.values()].filter((entry) => entry.dirtyFlags.size > 0).length,
      freeIndices: this.freeIndices.length, uploadBudget: this.uploadBudgetValue,
      uploads: this.uploads, uploadedInstances: this.uploadedInstances,
      generation: this.generationValue, lastUpload: this.lastUpload,
    });
  }
  public watch(watcher: (snapshot: GodotRenderInstanceDataSnapshot) => void): () => void {
    this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher);
  }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void {
    if (this.uploading) throw new Error('godot-compat: cannot clear render instances during upload.');
    for (const entry of this.instances.values()) this.backend.remove?.(entry.index);
    this.instances.clear(); this.entriesByIndex.clear(); this.entriesByDependency.clear(); this.freeIndices.splice(0);
    this.nextIndex = 0; this.generationValue += 1; this.lastUpload = null; this.publish();
  }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotRenderInstanceDataRuntime(
  backend: GodotRenderInstanceDataBackend,
  initialCapacity = 1024,
): GodotRenderInstanceDataRuntime {
  return new GodotRenderInstanceDataRuntime(backend, initialCapacity);
}
