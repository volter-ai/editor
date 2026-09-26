import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export interface GodotInstanceShaderParameterDescriptor {
  readonly instance: GodotRid;
  readonly parent?: GodotRid | null;
  readonly parameters?: ReadonlyMap<string, unknown> | Record<string, unknown>;
  readonly enabled?: boolean;
  readonly userData?: unknown;
}

export interface GodotInstanceShaderParameterState {
  readonly instance: GodotRid;
  readonly slot: number;
  readonly parent: GodotRid | null;
  readonly parameters: ReadonlyMap<string, unknown>;
  readonly effectiveParameters: ReadonlyMap<string, unknown>;
  readonly enabled: boolean;
  readonly dirty: boolean;
  readonly lastUploadedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotInstanceShaderParameterUpload {
  readonly frame: number;
  readonly startSlot: number;
  readonly endSlot: number;
  readonly instances: readonly GodotInstanceShaderParameterState[];
}

export interface GodotInstanceShaderParameterBackend {
  resize?(capacity: number): void | Promise<void>;
  upload(upload: GodotInstanceShaderParameterUpload): void | Promise<void>;
  clear?(slot: number): void;
}

export interface GodotInstanceShaderParameterFrameResult {
  readonly frame: number;
  readonly uploads: readonly GodotInstanceShaderParameterUpload[];
  readonly uploadedInstances: number;
  readonly remainingDirty: number;
  readonly failed: readonly { upload: GodotInstanceShaderParameterUpload; error: unknown }[];
}

export interface GodotInstanceShaderParameterSnapshot {
  readonly frame: number;
  readonly instances: readonly GodotInstanceShaderParameterState[];
  readonly capacity: number;
  readonly freeSlots: number;
  readonly dirtyInstances: number;
  readonly uploads: number;
  readonly generation: number;
  readonly lastFrame: GodotInstanceShaderParameterFrameResult | null;
}

interface Entry {
  instance: GodotRid;
  slot: number;
  parent: GodotRid | null;
  children: Set<bigint>;
  parameters: Map<string, unknown>;
  enabled: boolean;
  dirty: boolean;
  lastUploadedFrame: number;
  generation: number;
  userData: unknown;
  order: number;
}

function integer(value: unknown, member: string, minimum = 0): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw new RangeError(`godot-compat: InstanceShaderParameterRuntime.${member} requires integer >= ${minimum}.`);
  }
  return result;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: InstanceShaderParameterRuntime.${member} requires bool.`);
  return value;
}

function name(value: unknown): string {
  const result = String(value);
  if (result.length === 0) throw new RangeError('godot-compat: instance shader parameter requires nonempty name.');
  return result;
}

function rid(value: unknown): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: InstanceShaderParameterRuntime requires RID.');
  godotRidGetId(value);
  return value as GodotRid;
}

function optionalRid(value: unknown): GodotRid | null {
  return value === null || value === undefined ? null : rid(value);
}

function parameters(value: unknown): Map<string, unknown> {
  if (value === undefined) return new Map();
  if (value instanceof Map) return new Map([...value].map(([key, member]) => [name(key), member]));
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return new Map(Object.entries(value));
  throw new TypeError('godot-compat: instance shader parameters require Dictionary.');
}

export class GodotInstanceShaderParameterRuntime {
  public readonly __godotClass = 'InstanceShaderParameterRuntime';
  private readonly backend: GodotInstanceShaderParameterBackend;
  private readonly entries = new Map<bigint, Entry>();
  private readonly entriesBySlot = new Map<number, Entry>();
  private readonly freeSlots: number[] = [];
  private readonly watchers = new Set<(snapshot: GodotInstanceShaderParameterSnapshot) => void>();
  private capacityValue: number;
  private nextSlot = 0;
  private nextOrder = 0;
  private frameValue = 0;
  private batchSizeValue = 256;
  private uploadLimitValue = 4096;
  private uploads = 0;
  private generationValue = 0;
  private processing = false;
  private lastFrame: GodotInstanceShaderParameterFrameResult | null = null;

  public constructor(backend: GodotInstanceShaderParameterBackend, initialCapacity = 1024) {
    if (typeof backend?.upload !== 'function') throw new TypeError('godot-compat: InstanceShaderParameterRuntime requires upload backend.');
    this.backend = backend;
    this.capacityValue = integer(initialCapacity, 'initial_capacity', 1);
    registerGodotObjectIdentity(this, 'InstanceShaderParameterRuntime');
  }

  private allocateSlot(): number {
    const reused = this.freeSlots.shift();
    if (reused !== undefined) return reused;
    const slot = this.nextSlot++;
    if (slot >= this.capacityValue) {
      this.capacityValue = Math.max(slot + 1, this.capacityValue * 2);
      void this.backend.resize?.(this.capacityValue);
    }
    return slot;
  }

  public addInstance(value: GodotInstanceShaderParameterDescriptor): number {
    const instance = rid(value.instance);
    const id = godotRidGetId(instance);
    if (this.entries.has(id)) throw new Error('godot-compat: instance shader parameter owner already exists.');
    const parent = optionalRid(value.parent);
    if (parent !== null && !this.entries.has(godotRidGetId(parent))) throw new Error('godot-compat: instance shader parameter parent does not exist.');
    const entry: Entry = {
      instance,
      slot: this.allocateSlot(),
      parent,
      children: new Set(),
      parameters: parameters(value.parameters),
      enabled: bool(value.enabled ?? true, 'enabled'),
      dirty: true,
      lastUploadedFrame: -1,
      generation: 1,
      userData: value.userData ?? null,
      order: this.nextOrder++,
    };
    this.entries.set(id, entry);
    this.entriesBySlot.set(entry.slot, entry);
    if (parent !== null) this.entries.get(godotRidGetId(parent))!.children.add(id);
    this.generationValue += 1;
    this.publish();
    return entry.slot;
  }

  public removeInstance(value: unknown, recursive = false): boolean {
    const instance = rid(value);
    const id = godotRidGetId(instance);
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    if (entry.children.size > 0 && !recursive) throw new Error('godot-compat: instance parameter owner has children.');
    for (const child of [...entry.children]) this.removeInstance(Object.freeze({ id: child }), true);
    if (entry.parent !== null) this.entries.get(godotRidGetId(entry.parent))?.children.delete(id);
    this.entries.delete(id);
    this.entriesBySlot.delete(entry.slot);
    this.freeSlots.push(entry.slot);
    this.freeSlots.sort((left, right) => left - right);
    this.backend.clear?.(entry.slot);
    this.generationValue += 1;
    this.publish();
    return true;
  }

  private requireEntry(value: unknown): Entry {
    const instance = rid(value);
    const entry = this.entries.get(godotRidGetId(instance));
    if (entry === undefined) throw new Error('godot-compat: instance shader parameter owner does not exist.');
    return entry;
  }

  private markDirty(entry: Entry): void {
    entry.dirty = true;
    entry.generation += 1;
    for (const child of entry.children) {
      const childEntry = this.entries.get(child);
      if (childEntry !== undefined) this.markDirty(childEntry);
    }
  }

  public setParent(value: unknown, parentValue: unknown): void {
    const entry = this.requireEntry(value);
    const id = godotRidGetId(entry.instance);
    const parent = optionalRid(parentValue);
    if (parent !== null && !this.entries.has(godotRidGetId(parent))) throw new Error('godot-compat: instance shader parameter parent does not exist.');
    if (entry.parent !== null) this.entries.get(godotRidGetId(entry.parent))?.children.delete(id);
    const previous = entry.parent;
    entry.parent = parent;
    if (parent !== null) this.entries.get(godotRidGetId(parent))!.children.add(id);
    try {
      this.assertAcyclic();
    } catch (error) {
      if (parent !== null) this.entries.get(godotRidGetId(parent))?.children.delete(id);
      entry.parent = previous;
      if (previous !== null) this.entries.get(godotRidGetId(previous))?.children.add(id);
      throw error;
    }
    this.markDirty(entry);
    this.publish();
  }

  private assertAcyclic(): void {
    for (const origin of this.entries.values()) {
      const visited = new Set<bigint>();
      let current: Entry | undefined = origin;
      while (current?.parent !== null && current !== undefined) {
        const id = godotRidGetId(current.instance);
        if (visited.has(id)) throw new Error('godot-compat: instance shader parameter parent cycle.');
        visited.add(id);
        current = this.entries.get(godotRidGetId(current.parent));
      }
    }
  }

  public setParameter(value: unknown, parameterValue: unknown, data: unknown): void {
    const entry = this.requireEntry(value);
    entry.parameters.set(name(parameterValue), data);
    this.markDirty(entry);
    this.publish();
  }

  public eraseParameter(value: unknown, parameterValue: unknown): boolean {
    const entry = this.requireEntry(value);
    const removed = entry.parameters.delete(name(parameterValue));
    if (removed) {
      this.markDirty(entry);
      this.publish();
    }
    return removed;
  }

  public setEnabled(value: unknown, enabledValue: unknown): void {
    const entry = this.requireEntry(value);
    entry.enabled = bool(enabledValue, 'enabled');
    this.markDirty(entry);
    this.publish();
  }

  private effective(entry: Entry): Map<string, unknown> {
    const chain: Entry[] = [];
    let current: Entry | undefined = entry;
    while (current !== undefined) {
      chain.unshift(current);
      current = current.parent === null ? undefined : this.entries.get(godotRidGetId(current.parent));
    }
    const result = new Map<string, unknown>();
    for (const owner of chain) if (owner.enabled) for (const [parameter, data] of owner.parameters) result.set(parameter, data);
    return result;
  }

  private state(entry: Entry): GodotInstanceShaderParameterState {
    return Object.freeze({
      instance: entry.instance,
      slot: entry.slot,
      parent: entry.parent,
      parameters: new Map(entry.parameters),
      effectiveParameters: this.effective(entry),
      enabled: entry.enabled,
      dirty: entry.dirty,
      lastUploadedFrame: entry.lastUploadedFrame,
      generation: entry.generation,
      userData: entry.userData,
    });
  }

  private batches(frame: number): GodotInstanceShaderParameterUpload[] {
    const dirty = [...this.entries.values()]
      .filter((entry) => entry.dirty)
      .sort((left, right) => left.slot - right.slot)
      .slice(0, this.uploadLimitValue);
    const uploads: GodotInstanceShaderParameterUpload[] = [];
    let group: Entry[] = [];
    const flush = () => {
      if (group.length === 0) return;
      uploads.push(Object.freeze({
        frame,
        startSlot: group[0]!.slot,
        endSlot: group[group.length - 1]!.slot,
        instances: Object.freeze(group.map((entry) => this.state(entry))),
      }));
      group = [];
    };
    for (const entry of dirty) {
      const previous = group[group.length - 1];
      if (previous !== undefined && (entry.slot !== previous.slot + 1 || group.length >= this.batchSizeValue)) flush();
      group.push(entry);
    }
    flush();
    return uploads;
  }

  public async uploadFrame(frameValue: unknown): Promise<GodotInstanceShaderParameterFrameResult> {
    const frame = integer(frameValue, 'frame');
    if (frame < this.frameValue) throw new RangeError('godot-compat: instance parameter frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: instance parameter upload already processing.');
    this.frameValue = frame;
    this.processing = true;
    const uploads = this.batches(frame);
    const failed: Array<{ upload: GodotInstanceShaderParameterUpload; error: unknown }> = [];
    let uploadedInstances = 0;
    try {
      for (const upload of uploads) {
        try {
          await this.backend.upload(upload);
          for (const instance of upload.instances) {
            const entry = this.entriesBySlot.get(instance.slot);
            if (entry === undefined) continue;
            entry.dirty = false;
            entry.lastUploadedFrame = frame;
            uploadedInstances += 1;
          }
          this.uploads += 1;
        } catch (error) {
          failed.push(Object.freeze({ upload, error }));
        }
      }
      this.lastFrame = Object.freeze({
        frame,
        uploads: Object.freeze(uploads),
        uploadedInstances,
        remainingDirty: [...this.entries.values()].filter((entry) => entry.dirty).length,
        failed: Object.freeze(failed),
      });
      this.publish();
      return this.lastFrame;
    } finally {
      this.processing = false;
    }
  }

  public setBatchSize(value: unknown): void {
    this.batchSizeValue = integer(value, 'batch_size', 1);
  }

  public setUploadLimit(value: unknown): void {
    this.uploadLimitValue = integer(value, 'upload_limit', 1);
  }

  public getInstance(value: unknown): GodotInstanceShaderParameterState | null {
    const instance = rid(value);
    const entry = this.entries.get(godotRidGetId(instance));
    return entry === undefined ? null : this.state(entry);
  }

  public getSnapshot(): GodotInstanceShaderParameterSnapshot {
    const instances = [...this.entries.values()].sort((left, right) => left.order - right.order).map((entry) => this.state(entry));
    return Object.freeze({
      frame: this.frameValue,
      instances: Object.freeze(instances),
      capacity: this.capacityValue,
      freeSlots: this.freeSlots.length,
      dirtyInstances: instances.filter((entry) => entry.dirty).length,
      uploads: this.uploads,
      generation: this.generationValue,
      lastFrame: this.lastFrame,
    });
  }

  public watch(watcher: (snapshot: GodotInstanceShaderParameterSnapshot) => void): () => void {
    this.watchers.add(watcher);
    watcher(this.getSnapshot());
    return () => this.watchers.delete(watcher);
  }

  private publish(): void {
    const value = this.getSnapshot();
    for (const watcher of this.watchers) watcher(value);
  }

  public clear(): void {
    if (this.processing) throw new Error('godot-compat: cannot clear instance parameters during upload.');
    for (const entry of this.entries.values()) this.backend.clear?.(entry.slot);
    this.entries.clear();
    this.entriesBySlot.clear();
    this.freeSlots.splice(0);
    this.nextSlot = 0;
    this.lastFrame = null;
    this.generationValue += 1;
    this.publish();
  }

  public dispose(): void {
    this.clear();
    this.watchers.clear();
  }
}

export function createGodotInstanceShaderParameterRuntime(
  backend: GodotInstanceShaderParameterBackend,
  initialCapacity = 1024,
): GodotInstanceShaderParameterRuntime {
  return new GodotInstanceShaderParameterRuntime(backend, initialCapacity);
}
