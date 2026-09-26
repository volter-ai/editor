export type GodotRenderUniformBufferRid = string | number;

export type GodotRenderUniformScalarType = 'float' | 'int' | 'uint' | 'bool';

export interface GodotRenderUniformField {
  readonly name: string;
  readonly type: GodotRenderUniformScalarType;
  readonly columns?: number;
  readonly rows?: number;
  readonly arrayLength?: number;
}

export interface GodotRenderUniformLayoutField {
  readonly name: string;
  readonly type: GodotRenderUniformScalarType;
  readonly columns: number;
  readonly rows: number;
  readonly arrayLength: number;
  readonly offset: number;
  readonly stride: number;
  readonly size: number;
  readonly alignment: number;
}

export interface GodotRenderUniformLayout {
  readonly key: string;
  readonly fields: readonly GodotRenderUniformLayoutField[];
  readonly byteLength: number;
  readonly alignment: number;
}

export interface GodotRenderUniformAllocation {
  readonly id: number;
  readonly frame: number;
  readonly buffer: GodotRenderUniformBufferRid;
  readonly offset: number;
  readonly size: number;
  readonly layout: GodotRenderUniformLayout;
  readonly generation: number;
}

export interface GodotRenderUniformBinding {
  readonly buffer: GodotRenderUniformBufferRid;
  readonly offset: number;
  readonly size: number;
  readonly dynamicOffset: number;
  readonly frame: number;
  readonly generation: number;
}

export interface GodotRenderUniformUpload {
  readonly buffer: GodotRenderUniformBufferRid;
  readonly offset: number;
  readonly data: Uint8Array;
  readonly frame: number;
}

export interface GodotRenderUniformArenaSnapshot {
  readonly frame: number;
  readonly buffers: number;
  readonly allocations: number;
  readonly retainedBytes: number;
  readonly usedBytes: number;
  readonly pendingUploadBytes: number;
  readonly generation: number;
}

export interface GodotRenderUniformArenaBackend {
  createBuffer(byteLength: number): GodotRenderUniformBufferRid;
  upload(buffer: GodotRenderUniformBufferRid, offset: number, data: Uint8Array): void;
  destroyBuffer(buffer: GodotRenderUniformBufferRid): void;
}

interface DirtyRange {
  begin: number;
  end: number;
}

interface UniformBlock {
  rid: GodotRenderUniformBufferRid;
  capacity: number;
  bytes: Uint8Array;
  cursor: number;
  dirty: DirtyRange[];
  frame: number;
  generation: number;
}

interface AllocationState {
  allocation: GodotRenderUniformAllocation;
  block: UniformBlock;
  released: boolean;
}

function finite(value: unknown, member: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new TypeError(`godot-compat: ${member} requires a finite number.`);
  return result;
}

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, member);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function powerOfTwo(value: unknown, member: string): number {
  const result = integer(value, member, 1, 65536);
  if ((result & (result - 1)) !== 0) throw new RangeError(`godot-compat: ${member} requires a power of two.`);
  return result;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function fieldAlignment(columns: number, rows: number): number {
  if (columns > 1) return 16;
  if (rows === 1) return 4;
  if (rows === 2) return 8;
  return 16;
}

function fieldElementSize(columns: number, rows: number): number {
  if (columns === 1) return rows * 4;
  return columns * 16;
}

function layoutKey(fields: readonly GodotRenderUniformField[]): string {
  return fields.map((field) => [
    field.name,
    field.type,
    field.columns ?? 1,
    field.rows ?? 1,
    field.arrayLength ?? 1,
  ].join(':')).join('|');
}

function scalar(view: DataView, offset: number, type: GodotRenderUniformScalarType, value: unknown): void {
  if (type === 'float') {
    view.setFloat32(offset, finite(value, 'uniform scalar'), true);
    return;
  }
  if (type === 'bool') {
    view.setInt32(offset, value ? 1 : 0, true);
    return;
  }
  const numeric = finite(value, 'uniform integer');
  if (!Number.isSafeInteger(numeric)) throw new TypeError('godot-compat: integer uniform requires an integer.');
  if (type === 'uint') view.setUint32(offset, numeric >>> 0, true);
  else view.setInt32(offset, numeric | 0, true);
}

function components(value: unknown, count: number, member: string): unknown[] {
  if (count === 1 && (typeof value !== 'object' || value === null)) return [value];
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const values = Array.from(value as ArrayLike<unknown>);
    if (values.length === count) return values;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const names = count === 2 ? ['x', 'y'] : count === 3 ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'w'];
    const values = names.slice(0, count).map((name) => record[name]);
    if (values.every((component) => component !== undefined)) return values;
    const colorNames = ['r', 'g', 'b', 'a'].slice(0, count);
    const colorValues = colorNames.map((name) => record[name]);
    if (colorValues.every((component) => component !== undefined)) return colorValues;
    if ('elements' in record) return components(record['elements'], count, member);
  }
  throw new TypeError(`godot-compat: uniform ${member} requires ${count} components.`);
}

function matrixComponents(value: unknown, columns: number, rows: number, member: string): unknown[] {
  const count = columns * rows;
  if (typeof value === 'object' && value !== null && 'elements' in value) {
    return components(Reflect.get(value, 'elements'), count, member);
  }
  return components(value, count, member);
}

function writeElement(
  view: DataView,
  offset: number,
  field: GodotRenderUniformLayoutField,
  value: unknown,
): void {
  if (field.columns === 1) {
    const values = components(value, field.rows, field.name);
    for (let row = 0; row < field.rows; row += 1) scalar(view, offset + row * 4, field.type, values[row]);
    return;
  }
  const values = matrixComponents(value, field.columns, field.rows, field.name);
  for (let column = 0; column < field.columns; column += 1) {
    for (let row = 0; row < field.rows; row += 1) {
      scalar(view, offset + column * 16 + row * 4, field.type, values[column * field.rows + row]);
    }
  }
}

export class GodotRenderUniformArenaRuntime {
  private readonly layouts = new Map<string, GodotRenderUniformLayout>();
  private readonly blocks: UniformBlock[] = [];
  private readonly allocations = new Map<number, AllocationState>();
  private readonly frameBlocks = new Map<number, UniformBlock[]>();
  private readonly watchers = new Set<(snapshot: GodotRenderUniformArenaSnapshot) => void>();
  private frame = 0;
  private nextAllocationId = 1;
  private generation = 1;
  private blockSize: number;
  private dynamicAlignment: number;
  private retainedFrames: number;

  constructor(
    private readonly backend: GodotRenderUniformArenaBackend,
    blockSize = 1024 * 1024,
    dynamicAlignment = 256,
    retainedFrames = 3,
  ) {
    this.blockSize = integer(blockSize, 'uniform arena block size', 256);
    this.dynamicAlignment = powerOfTwo(dynamicAlignment, 'uniform arena dynamic alignment');
    this.retainedFrames = integer(retainedFrames, 'uniform arena retained frames', 1, 32);
  }

  createLayout(fields: readonly GodotRenderUniformField[]): GodotRenderUniformLayout {
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new TypeError('godot-compat: uniform layout requires at least one field.');
    }
    const key = layoutKey(fields);
    const retained = this.layouts.get(key);
    if (retained !== undefined) return retained;
    const names = new Set<string>();
    const layoutFields: GodotRenderUniformLayoutField[] = [];
    let cursor = 0;
    let layoutAlignment = 16;
    for (const field of fields) {
      if (typeof field.name !== 'string' || field.name.length === 0) {
        throw new TypeError('godot-compat: uniform field name requires a non-empty string.');
      }
      if (names.has(field.name)) throw new Error(`godot-compat: duplicate uniform field ${field.name}.`);
      names.add(field.name);
      if (field.type !== 'float' && field.type !== 'int' && field.type !== 'uint' && field.type !== 'bool') {
        throw new TypeError(`godot-compat: unknown uniform scalar type ${String(field.type)}.`);
      }
      const columns = integer(field.columns ?? 1, `uniform ${field.name} columns`, 1, 4);
      const rows = integer(field.rows ?? 1, `uniform ${field.name} rows`, 1, 4);
      const arrayLength = integer(field.arrayLength ?? 1, `uniform ${field.name} array length`, 1, 65536);
      const naturalAlignment = fieldAlignment(columns, rows);
      const alignment = arrayLength > 1 ? 16 : naturalAlignment;
      const elementSize = fieldElementSize(columns, rows);
      const stride = arrayLength > 1 ? align(elementSize, 16) : elementSize;
      cursor = align(cursor, alignment);
      layoutFields.push(Object.freeze({
        name: field.name,
        type: field.type,
        columns,
        rows,
        arrayLength,
        offset: cursor,
        stride,
        size: stride * arrayLength,
        alignment,
      }));
      cursor += stride * arrayLength;
      layoutAlignment = Math.max(layoutAlignment, alignment);
    }
    const layout: GodotRenderUniformLayout = Object.freeze({
      key,
      fields: Object.freeze(layoutFields),
      byteLength: align(cursor, layoutAlignment),
      alignment: layoutAlignment,
    });
    this.layouts.set(key, layout);
    return layout;
  }

  beginFrame(frameValue: number): void {
    const nextFrame = integer(frameValue, 'uniform arena frame', 0);
    if (nextFrame < this.frame) throw new RangeError('godot-compat: uniform arena frame cannot move backwards.');
    this.frame = nextFrame;
    this.recycleFrames();
    for (const block of this.frameBlocks.get(this.frame) ?? []) {
      block.cursor = 0;
      block.dirty.length = 0;
      block.generation = ++this.generation;
      block.bytes.fill(0);
    }
    this.publish();
  }

  allocate(layout: GodotRenderUniformLayout, values?: Readonly<Record<string, unknown>>): GodotRenderUniformAllocation {
    if (this.layouts.get(layout.key) !== layout) {
      throw new Error('godot-compat: uniform layout does not belong to this arena.');
    }
    const size = align(layout.byteLength, this.dynamicAlignment);
    let block = (this.frameBlocks.get(this.frame) ?? []).find((candidate) =>
      align(candidate.cursor, this.dynamicAlignment) + size <= candidate.capacity);
    if (block === undefined) block = this.createBlock(Math.max(this.blockSize, size));
    const offset = align(block.cursor, this.dynamicAlignment);
    block.cursor = offset + size;
    const allocation: GodotRenderUniformAllocation = Object.freeze({
      id: this.nextAllocationId++,
      frame: this.frame,
      buffer: block.rid,
      offset,
      size: layout.byteLength,
      layout,
      generation: block.generation,
    });
    this.allocations.set(allocation.id, { allocation, block, released: false });
    if (values !== undefined) this.write(allocation, values);
    this.publish();
    return allocation;
  }

  write(allocation: GodotRenderUniformAllocation, values: Readonly<Record<string, unknown>>): void {
    const state = this.requireAllocation(allocation);
    if (typeof values !== 'object' || values === null) {
      throw new TypeError('godot-compat: uniform write requires a field-value record.');
    }
    const view = new DataView(state.block.bytes.buffer, state.block.bytes.byteOffset, state.block.bytes.byteLength);
    for (const field of allocation.layout.fields) {
      if (!(field.name in values)) continue;
      const value = values[field.name];
      if (field.arrayLength === 1) {
        writeElement(view, allocation.offset + field.offset, field, value);
      } else {
        if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
          throw new TypeError(`godot-compat: uniform ${field.name} requires an array.`);
        }
        const array = Array.from(value as ArrayLike<unknown>);
        if (array.length !== field.arrayLength) {
          throw new RangeError(`godot-compat: uniform ${field.name} requires ${field.arrayLength} array entries.`);
        }
        for (let index = 0; index < array.length; index += 1) {
          writeElement(view, allocation.offset + field.offset + index * field.stride, field, array[index]);
        }
      }
      this.markDirty(state.block, allocation.offset + field.offset, allocation.offset + field.offset + field.size);
    }
  }

  writeField(allocation: GodotRenderUniformAllocation, name: string, value: unknown): void {
    const field = allocation.layout.fields.find((candidate) => candidate.name === name);
    if (field === undefined) throw new Error(`godot-compat: uniform layout has no field ${name}.`);
    this.write(allocation, { [name]: value });
  }

  copy(
    source: GodotRenderUniformAllocation,
    destination: GodotRenderUniformAllocation,
    sourceOffsetValue = 0,
    destinationOffsetValue = 0,
    byteLengthValue = Math.min(source.size, destination.size),
  ): void {
    const sourceState = this.requireAllocation(source);
    const destinationState = this.requireAllocation(destination);
    const sourceOffset = integer(sourceOffsetValue, 'uniform copy source offset', 0, source.size);
    const destinationOffset = integer(destinationOffsetValue, 'uniform copy destination offset', 0, destination.size);
    const byteLength = integer(byteLengthValue, 'uniform copy byte length', 0);
    if (sourceOffset + byteLength > source.size || destinationOffset + byteLength > destination.size) {
      throw new RangeError('godot-compat: uniform copy exceeds allocation bounds.');
    }
    const bytes = sourceState.block.bytes.slice(
      source.offset + sourceOffset,
      source.offset + sourceOffset + byteLength,
    );
    destinationState.block.bytes.set(bytes, destination.offset + destinationOffset);
    this.markDirty(
      destinationState.block,
      destination.offset + destinationOffset,
      destination.offset + destinationOffset + byteLength,
    );
  }

  clear(allocation: GodotRenderUniformAllocation, offsetValue = 0, byteLengthValue = allocation.size): void {
    const state = this.requireAllocation(allocation);
    const offset = integer(offsetValue, 'uniform clear offset', 0, allocation.size);
    const byteLength = integer(byteLengthValue, 'uniform clear byte length', 0);
    if (offset + byteLength > allocation.size) throw new RangeError('godot-compat: uniform clear exceeds allocation bounds.');
    state.block.bytes.fill(0, allocation.offset + offset, allocation.offset + offset + byteLength);
    this.markDirty(state.block, allocation.offset + offset, allocation.offset + offset + byteLength);
  }

  getBytes(allocation: GodotRenderUniformAllocation): Uint8Array {
    const state = this.requireAllocation(allocation);
    return state.block.bytes.slice(allocation.offset, allocation.offset + allocation.size);
  }

  getBinding(allocation: GodotRenderUniformAllocation): GodotRenderUniformBinding {
    this.requireAllocation(allocation);
    return Object.freeze({
      buffer: allocation.buffer,
      offset: allocation.offset,
      size: allocation.size,
      dynamicOffset: allocation.offset,
      frame: allocation.frame,
      generation: allocation.generation,
    });
  }

  flush(): readonly GodotRenderUniformUpload[] {
    const uploads: GodotRenderUniformUpload[] = [];
    for (const block of this.frameBlocks.get(this.frame) ?? []) {
      const merged = this.mergeDirty(block.dirty);
      for (const range of merged) {
        const data = block.bytes.slice(range.begin, range.end);
        this.backend.upload(block.rid, range.begin, data);
        uploads.push(Object.freeze({ buffer: block.rid, offset: range.begin, data, frame: this.frame }));
      }
      block.dirty.length = 0;
    }
    this.publish();
    return Object.freeze(uploads);
  }

  release(allocation: GodotRenderUniformAllocation): void {
    const state = this.requireAllocation(allocation);
    state.released = true;
    this.allocations.delete(allocation.id);
    this.publish();
  }

  setBlockSize(value: number): void {
    this.blockSize = integer(value, 'uniform arena block size', 256);
  }

  setDynamicAlignment(value: number): void {
    this.dynamicAlignment = powerOfTwo(value, 'uniform arena dynamic alignment');
  }

  setRetainedFrames(value: number): void {
    this.retainedFrames = integer(value, 'uniform arena retained frames', 1, 32);
    this.recycleFrames();
  }

  getSnapshot(): GodotRenderUniformArenaSnapshot {
    let retainedBytes = 0;
    let usedBytes = 0;
    let pendingUploadBytes = 0;
    for (const block of this.blocks) {
      retainedBytes += block.capacity;
      usedBytes += block.cursor;
      pendingUploadBytes += this.mergeDirty(block.dirty).reduce((sum, range) => sum + range.end - range.begin, 0);
    }
    return Object.freeze({
      frame: this.frame,
      buffers: this.blocks.length,
      allocations: this.allocations.size,
      retainedBytes,
      usedBytes,
      pendingUploadBytes,
      generation: this.generation,
    });
  }

  watch(listener: (snapshot: GodotRenderUniformArenaSnapshot) => void): () => void {
    this.watchers.add(listener);
    listener(this.getSnapshot());
    return () => this.watchers.delete(listener);
  }

  dispose(): void {
    for (const block of this.blocks) this.backend.destroyBuffer(block.rid);
    this.blocks.length = 0;
    this.frameBlocks.clear();
    this.allocations.clear();
    this.layouts.clear();
    this.watchers.clear();
    this.generation++;
  }

  private createBlock(capacity: number): UniformBlock {
    const block: UniformBlock = {
      rid: this.backend.createBuffer(capacity),
      capacity,
      bytes: new Uint8Array(capacity),
      cursor: 0,
      dirty: [],
      frame: this.frame,
      generation: ++this.generation,
    };
    this.blocks.push(block);
    let frameBlocks = this.frameBlocks.get(this.frame);
    if (frameBlocks === undefined) {
      frameBlocks = [];
      this.frameBlocks.set(this.frame, frameBlocks);
    }
    frameBlocks.push(block);
    return block;
  }

  private requireAllocation(allocation: GodotRenderUniformAllocation): AllocationState {
    const state = this.allocations.get(allocation.id);
    if (state === undefined || state.released || state.allocation !== allocation) {
      throw new Error('godot-compat: uniform allocation is stale or released.');
    }
    if (state.block.generation !== allocation.generation) {
      throw new Error('godot-compat: uniform allocation belongs to a recycled frame.');
    }
    return state;
  }

  private markDirty(block: UniformBlock, begin: number, end: number): void {
    if (begin >= end) return;
    block.dirty.push({ begin, end });
  }

  private mergeDirty(ranges: readonly DirtyRange[]): DirtyRange[] {
    if (ranges.length === 0) return [];
    const sorted = ranges.map((range) => ({ ...range })).sort((left, right) => left.begin - right.begin);
    const merged: DirtyRange[] = [];
    for (const range of sorted) {
      const previous = merged[merged.length - 1];
      if (previous !== undefined && range.begin <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push(range);
    }
    return merged;
  }

  private recycleFrames(): void {
    const oldestRetained = this.frame - this.retainedFrames + 1;
    for (const [frame, blocks] of this.frameBlocks) {
      if (frame >= oldestRetained) continue;
      for (const block of blocks) {
        for (const [id, allocation] of this.allocations) {
          if (allocation.block !== block) continue;
          allocation.released = true;
          this.allocations.delete(id);
        }
        this.backend.destroyBuffer(block.rid);
        const index = this.blocks.indexOf(block);
        if (index >= 0) this.blocks.splice(index, 1);
      }
      this.frameBlocks.delete(frame);
    }
  }

  private publish(): void {
    if (this.watchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function createGodotRenderUniformArenaRuntime(
  backend: GodotRenderUniformArenaBackend,
  blockSize?: number,
  dynamicAlignment?: number,
  retainedFrames?: number,
): GodotRenderUniformArenaRuntime {
  return new GodotRenderUniformArenaRuntime(backend, blockSize, dynamicAlignment, retainedFrames);
}
