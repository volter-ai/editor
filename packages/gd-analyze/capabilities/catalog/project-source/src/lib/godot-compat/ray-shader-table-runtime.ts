export type GodotRayShaderRid = string | number;
export type GodotRayShaderGroupKind = 'raygen' | 'miss' | 'hit' | 'callable';

export interface GodotRayShaderGroupDescriptor {
  readonly rid: GodotRayShaderRid;
  readonly kind: GodotRayShaderGroupKind;
  readonly generalShader?: GodotRayShaderRid | null;
  readonly closestHitShader?: GodotRayShaderRid | null;
  readonly anyHitShader?: GodotRayShaderRid | null;
  readonly intersectionShader?: GodotRayShaderRid | null;
  readonly localData?: Uint8Array | ArrayBuffer | ArrayBufferView | readonly number[];
  readonly enabled?: boolean;
}

export interface GodotRayShaderRecord {
  readonly group: GodotRayShaderRid;
  readonly kind: GodotRayShaderGroupKind;
  readonly index: number;
  readonly offset: number;
  readonly stride: number;
  readonly handleSize: number;
  readonly localDataSize: number;
  readonly generation: number;
}

export interface GodotRayShaderTableRegion {
  readonly kind: GodotRayShaderGroupKind;
  readonly offset: number;
  readonly stride: number;
  readonly size: number;
  readonly count: number;
}

export interface GodotRayShaderTableBuild {
  readonly pipeline: GodotRayShaderRid;
  readonly bytes: Uint8Array;
  readonly records: readonly GodotRayShaderRecord[];
  readonly raygen: GodotRayShaderTableRegion;
  readonly miss: GodotRayShaderTableRegion;
  readonly hit: GodotRayShaderTableRegion;
  readonly callable: GodotRayShaderTableRegion;
  readonly generation: number;
}

export interface GodotRayShaderTableUpload {
  readonly offset: number;
  readonly data: Uint8Array;
  readonly generation: number;
}

export interface GodotRayShaderTableSnapshot {
  readonly groups: number;
  readonly enabledGroups: number;
  readonly byteLength: number;
  readonly dirtyBytes: number;
  readonly uploads: number;
  readonly pipelineGeneration: number;
  readonly generation: number;
}

export interface GodotRayShaderTableBackend<TBuffer = unknown> {
  getGroupHandle(pipeline: GodotRayShaderRid, group: GodotRayShaderGroupDescriptor): Uint8Array | ArrayBuffer | ArrayBufferView;
  createBuffer(byteLength: number): TBuffer;
  upload(buffer: TBuffer, offset: number, data: Uint8Array): void;
  destroyBuffer(buffer: TBuffer): void;
}

interface GroupState {
  descriptor: Required<Omit<GodotRayShaderGroupDescriptor, 'localData'>> & { localData: Uint8Array };
  revision: number;
}

interface DirtyRange {
  begin: number;
  end: number;
}

function finiteInteger(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function powerOfTwo(value: unknown, member: string, minimum: number, maximum: number): number {
  const result = finiteInteger(value, member, minimum, maximum);
  if ((result & (result - 1)) !== 0) throw new RangeError(`godot-compat: ${member} requires a power of two.`);
  return result;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function bytes(value: GodotRayShaderGroupDescriptor['localData']): Uint8Array {
  if (value === undefined) return new Uint8Array();
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (Array.isArray(value)) return Uint8Array.from(value.map((entry) => finiteInteger(entry, 'shader table local byte', 0, 255)));
  throw new TypeError('godot-compat: shader table local data requires bytes.');
}

function kind(value: unknown): GodotRayShaderGroupKind {
  if (value !== 'raygen' && value !== 'miss' && value !== 'hit' && value !== 'callable') {
    throw new TypeError(`godot-compat: unknown ray shader group kind ${String(value)}.`);
  }
  return value;
}

function descriptor(value: GodotRayShaderGroupDescriptor): GroupState['descriptor'] {
  const groupKind = kind(value.kind);
  const generalShader = value.generalShader ?? null;
  const closestHitShader = value.closestHitShader ?? null;
  const anyHitShader = value.anyHitShader ?? null;
  const intersectionShader = value.intersectionShader ?? null;
  if (groupKind === 'hit') {
    if (generalShader !== null) throw new Error('godot-compat: hit shader group cannot use a general shader.');
    if (closestHitShader === null && anyHitShader === null && intersectionShader === null) {
      throw new Error('godot-compat: hit shader group requires at least one hit shader.');
    }
  } else {
    if (generalShader === null) throw new Error(`godot-compat: ${groupKind} shader group requires a general shader.`);
    if (closestHitShader !== null || anyHitShader !== null || intersectionShader !== null) {
      throw new Error(`godot-compat: ${groupKind} shader group cannot use hit shaders.`);
    }
  }
  return Object.freeze({
    rid: value.rid,
    kind: groupKind,
    generalShader,
    closestHitShader,
    anyHitShader,
    intersectionShader,
    localData: bytes(value.localData),
    enabled: value.enabled ?? true,
  });
}

function emptyRegion(kind: GodotRayShaderGroupKind, offset: number): GodotRayShaderTableRegion {
  return Object.freeze({ kind, offset, stride: 0, size: 0, count: 0 });
}

export class GodotRayShaderTableRuntime<TBuffer = unknown> {
  private readonly groups = new Map<GodotRayShaderRid, GroupState>();
  private readonly order: GodotRayShaderRid[] = [];
  private readonly dirty: DirtyRange[] = [];
  private readonly watchers = new Set<(build: GodotRayShaderTableBuild) => void>();
  private pipeline: GodotRayShaderRid | null = null;
  private buffer: TBuffer | null = null;
  private buildValue: GodotRayShaderTableBuild | null = null;
  private handleSize: number;
  private handleAlignment: number;
  private baseAlignment: number;
  private maximumStride: number;
  private generation = 1;
  private pipelineGeneration = 0;
  private uploads = 0;

  constructor(
    private backend: GodotRayShaderTableBackend<TBuffer>,
    handleSize = 32,
    handleAlignment = 32,
    baseAlignment = 64,
    maximumStride = 4096,
  ) {
    this.handleSize = finiteInteger(handleSize, 'shader group handle size', 1, 4096);
    this.handleAlignment = powerOfTwo(handleAlignment, 'shader group handle alignment', 1, 4096);
    this.baseAlignment = powerOfTwo(baseAlignment, 'shader table base alignment', 1, 65536);
    this.maximumStride = finiteInteger(maximumStride, 'shader table maximum stride', this.handleSize, 65536);
  }

  setPipeline(pipeline: GodotRayShaderRid): void {
    if (this.pipeline === pipeline) return;
    this.pipeline = pipeline;
    this.pipelineGeneration++;
    this.invalidate();
  }

  addGroup(value: GodotRayShaderGroupDescriptor): void {
    if (this.groups.has(value.rid)) throw new Error('godot-compat: ray shader group RID already exists.');
    this.groups.set(value.rid, { descriptor: descriptor(value), revision: ++this.generation });
    this.order.push(value.rid);
    this.invalidate();
  }

  updateGroup(
    rid: GodotRayShaderRid,
    patch: Partial<Omit<GodotRayShaderGroupDescriptor, 'rid'>>,
  ): void {
    const group = this.require(rid);
    group.descriptor = descriptor({ ...group.descriptor, ...patch, rid });
    group.revision = ++this.generation;
    this.invalidate();
  }

  setLocalData(rid: GodotRayShaderRid, data: GodotRayShaderGroupDescriptor['localData']): void {
    this.updateGroup(rid, { localData: data ?? new Uint8Array() });
  }

  setEnabled(rid: GodotRayShaderRid, enabled: boolean): void {
    this.updateGroup(rid, { enabled });
  }

  removeGroup(rid: GodotRayShaderRid): boolean {
    if (!this.groups.delete(rid)) return false;
    const index = this.order.indexOf(rid);
    if (index >= 0) this.order.splice(index, 1);
    this.generation++;
    this.invalidate();
    return true;
  }

  setGroupOrder(values: readonly GodotRayShaderRid[]): void {
    if (!Array.isArray(values) || values.length !== this.groups.size || new Set(values).size !== values.length) {
      throw new Error('godot-compat: shader group order must contain each group exactly once.');
    }
    for (const rid of values) this.require(rid);
    this.order.splice(0, this.order.length, ...values);
    this.generation++;
    this.invalidate();
  }

  build(): GodotRayShaderTableBuild {
    if (this.pipeline === null) throw new Error('godot-compat: ray shader table requires a pipeline.');
    const groupsByKind = new Map<GodotRayShaderGroupKind, GroupState[]>([
      ['raygen', []],
      ['miss', []],
      ['hit', []],
      ['callable', []],
    ]);
    for (const rid of this.order) {
      const group = this.require(rid);
      if (group.descriptor.enabled) groupsByKind.get(group.descriptor.kind)!.push(group);
    }
    if (groupsByKind.get('raygen')!.length !== 1) {
      throw new Error('godot-compat: ray shader table requires exactly one enabled raygen group.');
    }
    const regions = new Map<GodotRayShaderGroupKind, GodotRayShaderTableRegion>();
    let cursor = 0;
    for (const groupKind of ['raygen', 'miss', 'hit', 'callable'] as const) {
      const groups = groupsByKind.get(groupKind)!;
      if (groups.length === 0) {
        regions.set(groupKind, emptyRegion(groupKind, cursor));
        continue;
      }
      const largestLocalData = Math.max(...groups.map((group) => group.descriptor.localData.byteLength));
      const stride = align(this.handleSize + largestLocalData, this.handleAlignment);
      if (stride > this.maximumStride) throw new RangeError(`godot-compat: ${groupKind} shader record stride exceeds device limit.`);
      cursor = align(cursor, this.baseAlignment);
      regions.set(groupKind, Object.freeze({
        kind: groupKind,
        offset: cursor,
        stride,
        size: stride * groups.length,
        count: groups.length,
      }));
      cursor += stride * groups.length;
    }
    const totalSize = align(cursor, this.baseAlignment);
    const tableBytes = new Uint8Array(totalSize);
    const records: GodotRayShaderRecord[] = [];
    for (const groupKind of ['raygen', 'miss', 'hit', 'callable'] as const) {
      const region = regions.get(groupKind)!;
      const groups = groupsByKind.get(groupKind)!;
      groups.forEach((group, index) => {
        const offset = region.offset + index * region.stride;
        const handle = bytes(this.backend.getGroupHandle(this.pipeline!, group.descriptor));
        if (handle.byteLength !== this.handleSize) {
          throw new RangeError(`godot-compat: shader group handle requires ${this.handleSize} bytes.`);
        }
        tableBytes.set(handle, offset);
        tableBytes.set(group.descriptor.localData, offset + this.handleSize);
        records.push(Object.freeze({
          group: group.descriptor.rid,
          kind: groupKind,
          index,
          offset,
          stride: region.stride,
          handleSize: this.handleSize,
          localDataSize: group.descriptor.localData.byteLength,
          generation: group.revision,
        }));
      });
    }
    const previous = this.buildValue;
    if (this.buffer === null || previous?.bytes.byteLength !== tableBytes.byteLength) {
      if (this.buffer !== null) this.backend.destroyBuffer(this.buffer);
      this.buffer = this.backend.createBuffer(tableBytes.byteLength);
      this.dirty.splice(0, this.dirty.length, { begin: 0, end: tableBytes.byteLength });
    } else this.findDirty(previous.bytes, tableBytes);
    this.buildValue = Object.freeze({
      pipeline: this.pipeline,
      bytes: tableBytes,
      records: Object.freeze(records),
      raygen: regions.get('raygen')!,
      miss: regions.get('miss')!,
      hit: regions.get('hit')!,
      callable: regions.get('callable')!,
      generation: ++this.generation,
    });
    for (const watcher of this.watchers) watcher(this.buildValue);
    return this.buildValue;
  }

  flush(): readonly GodotRayShaderTableUpload[] {
    if (this.buildValue === null) this.build();
    if (this.buffer === null || this.buildValue === null) throw new Error('godot-compat: shader table buffer is unavailable.');
    const merged = this.mergeDirty();
    const values: GodotRayShaderTableUpload[] = [];
    for (const range of merged) {
      const data = this.buildValue.bytes.slice(range.begin, range.end);
      this.backend.upload(this.buffer, range.begin, data);
      values.push(Object.freeze({ offset: range.begin, data, generation: this.generation }));
      this.uploads++;
    }
    this.dirty.length = 0;
    return Object.freeze(values);
  }

  getBuffer(): TBuffer | null {
    return this.buffer;
  }

  getBuild(): GodotRayShaderTableBuild | null {
    return this.buildValue;
  }

  getRecord(rid: GodotRayShaderRid): GodotRayShaderRecord | null {
    return this.buildValue?.records.find((record) => record.group === rid) ?? null;
  }

  getSnapshot(): GodotRayShaderTableSnapshot {
    return Object.freeze({
      groups: this.groups.size,
      enabledGroups: [...this.groups.values()].filter((group) => group.descriptor.enabled).length,
      byteLength: this.buildValue?.bytes.byteLength ?? 0,
      dirtyBytes: this.mergeDirty().reduce((sum, range) => sum + range.end - range.begin, 0),
      uploads: this.uploads,
      pipelineGeneration: this.pipelineGeneration,
      generation: this.generation,
    });
  }

  watch(listener: (build: GodotRayShaderTableBuild) => void): () => void {
    this.watchers.add(listener);
    if (this.buildValue !== null) listener(this.buildValue);
    return () => this.watchers.delete(listener);
  }

  replaceBackend(backend: GodotRayShaderTableBackend<TBuffer>): void {
    if (this.buffer !== null) this.backend.destroyBuffer(this.buffer);
    this.buffer = null;
    this.backend = backend;
    this.invalidate();
  }

  dispose(): void {
    if (this.buffer !== null) this.backend.destroyBuffer(this.buffer);
    this.groups.clear();
    this.order.length = 0;
    this.dirty.length = 0;
    this.watchers.clear();
    this.buffer = null;
    this.buildValue = null;
    this.pipeline = null;
    this.generation++;
  }

  private invalidate(): void {
    if (this.buildValue !== null) this.dirty.push({ begin: 0, end: this.buildValue.bytes.byteLength });
    this.buildValue = null;
    this.generation++;
  }

  private findDirty(previous: Uint8Array, next: Uint8Array): void {
    let begin = -1;
    for (let index = 0; index < next.length; index++) {
      if (previous[index] !== next[index]) {
        if (begin < 0) begin = index;
      } else if (begin >= 0) {
        this.dirty.push({ begin, end: index });
        begin = -1;
      }
    }
    if (begin >= 0) this.dirty.push({ begin, end: next.length });
  }

  private mergeDirty(): DirtyRange[] {
    const sorted = this.dirty.map((range) => ({ ...range })).sort((left, right) => left.begin - right.begin);
    const merged: DirtyRange[] = [];
    for (const range of sorted) {
      const previous = merged.at(-1);
      if (previous !== undefined && range.begin <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push(range);
    }
    return merged;
  }

  private require(rid: GodotRayShaderRid): GroupState {
    const value = this.groups.get(rid);
    if (value === undefined) throw new Error('godot-compat: unknown ray shader group.');
    return value;
  }
}

export function createGodotRayShaderTableRuntime<TBuffer = unknown>(
  backend: GodotRayShaderTableBackend<TBuffer>,
  handleSize?: number,
  handleAlignment?: number,
  baseAlignment?: number,
  maximumStride?: number,
): GodotRayShaderTableRuntime<TBuffer> {
  return new GodotRayShaderTableRuntime(backend, handleSize, handleAlignment, baseAlignment, maximumStride);
}
