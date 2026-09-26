export type GodotRenderMemoryRid = string | number;

export interface GodotRenderMemoryHeapDescriptor {
  readonly rid: GodotRenderMemoryRid;
  readonly byteSize: number;
  readonly alignment?: number;
  readonly memoryType?: number;
}

export interface GodotRenderMemoryAllocationDescriptor {
  readonly rid: GodotRenderMemoryRid;
  readonly byteSize: number;
  readonly alignment?: number;
  readonly movable?: boolean;
  readonly priority?: number;
  readonly pinned?: boolean;
}

export interface GodotRenderMemoryAllocation {
  readonly rid: GodotRenderMemoryRid;
  readonly heap: GodotRenderMemoryRid;
  readonly offset: number;
  readonly byteSize: number;
  readonly alignment: number;
  readonly movable: boolean;
  readonly priority: number;
  readonly pinned: boolean;
  readonly generation: number;
}

export interface GodotRenderMemoryRelocation {
  readonly rid: GodotRenderMemoryRid;
  readonly source: GodotRenderMemoryAllocation;
  readonly destination: GodotRenderMemoryAllocation;
  readonly byteSize: number;
  readonly generation: number;
}

export interface GodotRenderMemoryDefragmentationPlan {
  readonly id: number;
  readonly heap: GodotRenderMemoryRid;
  readonly relocations: readonly GodotRenderMemoryRelocation[];
  readonly bytesMoved: number;
  readonly freeBytesBefore: number;
  readonly largestFreeRangeBefore: number;
  readonly largestFreeRangeAfter: number;
  readonly fragmentationBefore: number;
  readonly fragmentationAfter: number;
  readonly generation: number;
}

export interface GodotRenderMemoryDefragmentationResult {
  readonly plan: GodotRenderMemoryDefragmentationPlan;
  readonly completed: readonly GodotRenderMemoryRid[];
  readonly failed: readonly { rid: GodotRenderMemoryRid; error: unknown }[];
  readonly committed: boolean;
  readonly generation: number;
}

export interface GodotRenderMemorySnapshot {
  readonly heaps: number;
  readonly allocations: number;
  readonly capacityBytes: number;
  readonly allocatedBytes: number;
  readonly freeBytes: number;
  readonly largestFreeRange: number;
  readonly fragmentation: number;
  readonly relocations: number;
  readonly relocatedBytes: number;
  readonly generation: number;
}

export interface GodotRenderMemoryBackend {
  copy(relocation: GodotRenderMemoryRelocation): void | Promise<void>;
  commit(relocation: GodotRenderMemoryRelocation): void;
  rollback?(relocation: GodotRenderMemoryRelocation): void;
}

interface Range {
  offset: number;
  size: number;
}

interface AllocationState {
  allocation: GodotRenderMemoryAllocation;
  pending: GodotRenderMemoryAllocation | null;
}

interface HeapState {
  descriptor: Required<GodotRenderMemoryHeapDescriptor>;
  allocations: Map<GodotRenderMemoryRid, AllocationState>;
  free: Range[];
  revision: number;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires a finite number in [${minimum}, ${maximum}].`);
  }
  return result;
}

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(result)) throw new TypeError(`godot-compat: ${member} requires an integer.`);
  return result;
}

function alignment(value: unknown, member: string): number {
  const result = integer(value, member, 1, 65536);
  if ((result & (result - 1)) !== 0) throw new RangeError(`godot-compat: ${member} requires a power of two.`);
  return result;
}

function align(value: number, boundary: number): number {
  return Math.ceil(value / boundary) * boundary;
}

function heapDescriptor(value: GodotRenderMemoryHeapDescriptor): Required<GodotRenderMemoryHeapDescriptor> {
  return Object.freeze({
    rid: value.rid,
    byteSize: integer(value.byteSize, 'render memory heap byte size', 1),
    alignment: alignment(value.alignment ?? 256, 'render memory heap alignment'),
    memoryType: integer(value.memoryType ?? 0, 'render memory type', 0, 255),
  });
}

export class GodotRenderMemoryDefragmentationRuntime {
  private readonly heaps = new Map<GodotRenderMemoryRid, HeapState>();
  private readonly allocationLookup = new Map<GodotRenderMemoryRid, HeapState>();
  private readonly watchers = new Set<(snapshot: GodotRenderMemorySnapshot) => void>();
  private nextPlanId = 1;
  private generation = 1;
  private relocations = 0;
  private relocatedBytes = 0;
  private executing = false;

  constructor(private backend: GodotRenderMemoryBackend) {}

  addHeap(value: GodotRenderMemoryHeapDescriptor): void {
    if (this.heaps.has(value.rid)) throw new Error('godot-compat: render memory heap already exists.');
    const descriptor = heapDescriptor(value);
    this.heaps.set(value.rid, {
      descriptor,
      allocations: new Map(),
      free: [{ offset: 0, size: descriptor.byteSize }],
      revision: ++this.generation,
    });
    this.publish();
  }

  removeHeap(rid: GodotRenderMemoryRid): boolean {
    const heap = this.heaps.get(rid);
    if (heap === undefined) return false;
    if (heap.allocations.size > 0) throw new Error('godot-compat: render memory heap still has allocations.');
    this.heaps.delete(rid);
    this.generation++;
    this.publish();
    return true;
  }

  allocate(
    heapRid: GodotRenderMemoryRid,
    value: GodotRenderMemoryAllocationDescriptor,
  ): GodotRenderMemoryAllocation {
    if (this.allocationLookup.has(value.rid)) throw new Error('godot-compat: render memory allocation RID already exists.');
    const heap = this.requireHeap(heapRid);
    const byteSize = integer(value.byteSize, 'render memory allocation byte size', 1, heap.descriptor.byteSize);
    const requestedAlignment = alignment(value.alignment ?? heap.descriptor.alignment, 'render memory allocation alignment');
    const found = this.findRange(heap.free, byteSize, requestedAlignment);
    if (found === null) throw new Error('godot-compat: render memory heap has no compatible free range.');
    this.consumeRange(heap.free, found.index, found.offset, byteSize);
    const allocation: GodotRenderMemoryAllocation = Object.freeze({
      rid: value.rid,
      heap: heapRid,
      offset: found.offset,
      byteSize,
      alignment: requestedAlignment,
      movable: value.movable ?? true,
      priority: integer(value.priority ?? 0, 'render memory allocation priority', -128, 127),
      pinned: value.pinned ?? false,
      generation: ++this.generation,
    });
    heap.allocations.set(value.rid, { allocation, pending: null });
    this.allocationLookup.set(value.rid, heap);
    heap.revision = this.generation;
    this.publish();
    return allocation;
  }

  free(rid: GodotRenderMemoryRid): boolean {
    const heap = this.allocationLookup.get(rid);
    if (heap === undefined) return false;
    const state = heap.allocations.get(rid)!;
    if (state.pending !== null) throw new Error('godot-compat: cannot free allocation during relocation.');
    heap.free.push({ offset: state.allocation.offset, size: state.allocation.byteSize });
    this.coalesce(heap.free);
    heap.allocations.delete(rid);
    this.allocationLookup.delete(rid);
    heap.revision = ++this.generation;
    this.publish();
    return true;
  }

  setPinned(rid: GodotRenderMemoryRid, pinned: boolean): void {
    const state = this.requireAllocation(rid);
    state.allocation = Object.freeze({ ...state.allocation, pinned, generation: ++this.generation });
    this.publish();
  }

  getAllocation(rid: GodotRenderMemoryRid): GodotRenderMemoryAllocation {
    return this.requireAllocation(rid).allocation;
  }

  plan(
    heapRid: GodotRenderMemoryRid,
    byteBudget = Number.MAX_SAFE_INTEGER,
    fragmentationThreshold = 0,
  ): GodotRenderMemoryDefragmentationPlan {
    const heap = this.requireHeap(heapRid);
    const budget = integer(byteBudget, 'defragmentation byte budget', 0);
    const threshold = finite(fragmentationThreshold, 'defragmentation threshold', 0, 1);
    const before = this.heapStats(heap);
    if (before.fragmentation <= threshold || budget === 0) return this.emptyPlan(heap, before);
    const occupied = [...heap.allocations.values()]
      .sort((left, right) => left.allocation.offset - right.allocation.offset);
    const relocations: GodotRenderMemoryRelocation[] = [];
    let cursor = 0;
    let bytesMoved = 0;
    for (const state of occupied) {
      const allocation = state.allocation;
      if (!allocation.movable || allocation.pinned || state.pending !== null) {
        cursor = Math.max(cursor, allocation.offset + allocation.byteSize);
        continue;
      }
      const destinationOffset = align(cursor, allocation.alignment);
      if (destinationOffset >= allocation.offset) {
        cursor = allocation.offset + allocation.byteSize;
        continue;
      }
      if (bytesMoved + allocation.byteSize > budget && relocations.length > 0) continue;
      const destination: GodotRenderMemoryAllocation = Object.freeze({
        ...allocation,
        offset: destinationOffset,
        generation: ++this.generation,
      });
      relocations.push(Object.freeze({
        rid: allocation.rid,
        source: allocation,
        destination,
        byteSize: allocation.byteSize,
        generation: this.generation,
      }));
      bytesMoved += allocation.byteSize;
      cursor = destinationOffset + allocation.byteSize;
    }
    const simulated = occupied.map((state) =>
      relocations.find((relocation) => relocation.rid === state.allocation.rid)?.destination ?? state.allocation);
    const freeAfter = this.freeFromAllocations(heap.descriptor.byteSize, simulated);
    const largestAfter = Math.max(0, ...freeAfter.map((range) => range.size));
    const fragmentationAfter = before.freeBytes === 0 ? 0 : 1 - largestAfter / before.freeBytes;
    return Object.freeze({
      id: this.nextPlanId++,
      heap: heapRid,
      relocations: Object.freeze(relocations),
      bytesMoved,
      freeBytesBefore: before.freeBytes,
      largestFreeRangeBefore: before.largestFreeRange,
      largestFreeRangeAfter: largestAfter,
      fragmentationBefore: before.fragmentation,
      fragmentationAfter,
      generation: this.generation,
    });
  }

  async execute(plan: GodotRenderMemoryDefragmentationPlan): Promise<GodotRenderMemoryDefragmentationResult> {
    if (this.executing) throw new Error('godot-compat: memory defragmentation is already executing.');
    const heap = this.requireHeap(plan.heap);
    for (const relocation of plan.relocations) {
      const state = this.requireAllocation(relocation.rid);
      if (state.allocation !== relocation.source) throw new Error('godot-compat: defragmentation plan is stale.');
      state.pending = relocation.destination;
    }
    this.executing = true;
    const completed: GodotRenderMemoryRid[] = [];
    const failed: Array<{ rid: GodotRenderMemoryRid; error: unknown }> = [];
    try {
      for (const relocation of plan.relocations) {
        try {
          await this.backend.copy(relocation);
          completed.push(relocation.rid);
        } catch (error) {
          failed.push(Object.freeze({ rid: relocation.rid, error }));
          break;
        }
      }
      const committed = failed.length === 0;
      if (committed) {
        for (const relocation of plan.relocations) {
          const state = this.requireAllocation(relocation.rid);
          this.backend.commit(relocation);
          state.allocation = relocation.destination;
          state.pending = null;
          this.relocations++;
          this.relocatedBytes += relocation.byteSize;
        }
        heap.free = this.freeFromAllocations(
          heap.descriptor.byteSize,
          [...heap.allocations.values()].map((state) => state.allocation),
        );
        heap.revision = ++this.generation;
      } else {
        for (const relocation of plan.relocations) {
          this.backend.rollback?.(relocation);
          this.requireAllocation(relocation.rid).pending = null;
        }
      }
      this.publish();
      return Object.freeze({
        plan,
        completed: Object.freeze(completed),
        failed: Object.freeze(failed),
        committed,
        generation: this.generation,
      });
    } finally {
      this.executing = false;
    }
  }

  getSnapshot(): GodotRenderMemorySnapshot {
    let capacityBytes = 0;
    let allocatedBytes = 0;
    let freeBytes = 0;
    let largestFreeRange = 0;
    for (const heap of this.heaps.values()) {
      const stats = this.heapStats(heap);
      capacityBytes += heap.descriptor.byteSize;
      allocatedBytes += stats.allocatedBytes;
      freeBytes += stats.freeBytes;
      largestFreeRange = Math.max(largestFreeRange, stats.largestFreeRange);
    }
    return Object.freeze({
      heaps: this.heaps.size,
      allocations: this.allocationLookup.size,
      capacityBytes,
      allocatedBytes,
      freeBytes,
      largestFreeRange,
      fragmentation: freeBytes === 0 ? 0 : 1 - largestFreeRange / freeBytes,
      relocations: this.relocations,
      relocatedBytes: this.relocatedBytes,
      generation: this.generation,
    });
  }

  watch(listener: (snapshot: GodotRenderMemorySnapshot) => void): () => void {
    this.watchers.add(listener);
    listener(this.getSnapshot());
    return () => this.watchers.delete(listener);
  }

  clear(): void {
    if (this.executing) throw new Error('godot-compat: cannot clear memory allocator during defragmentation.');
    this.heaps.clear();
    this.allocationLookup.clear();
    this.generation++;
    this.publish();
  }

  dispose(): void {
    this.clear();
    this.watchers.clear();
  }

  private findRange(free: readonly Range[], size: number, requestedAlignment: number): { index: number; offset: number } | null {
    for (let index = 0; index < free.length; index++) {
      const range = free[index]!;
      const offset = align(range.offset, requestedAlignment);
      if (offset + size <= range.offset + range.size) return { index, offset };
    }
    return null;
  }

  private consumeRange(free: Range[], index: number, offset: number, size: number): void {
    const range = free[index]!;
    const before = offset - range.offset;
    const afterOffset = offset + size;
    const after = range.offset + range.size - afterOffset;
    free.splice(index, 1,
      ...(before > 0 ? [{ offset: range.offset, size: before }] : []),
      ...(after > 0 ? [{ offset: afterOffset, size: after }] : []),
    );
  }

  private coalesce(free: Range[]): void {
    free.sort((left, right) => left.offset - right.offset);
    const merged: Range[] = [];
    for (const range of free) {
      const previous = merged.at(-1);
      if (previous !== undefined && previous.offset + previous.size >= range.offset) {
        previous.size = Math.max(previous.offset + previous.size, range.offset + range.size) - previous.offset;
      } else merged.push({ ...range });
    }
    free.splice(0, free.length, ...merged);
  }

  private freeFromAllocations(byteSize: number, allocations: readonly GodotRenderMemoryAllocation[]): Range[] {
    const ordered = [...allocations].sort((left, right) => left.offset - right.offset);
    const free: Range[] = [];
    let cursor = 0;
    for (const allocation of ordered) {
      if (allocation.offset > cursor) free.push({ offset: cursor, size: allocation.offset - cursor });
      cursor = Math.max(cursor, allocation.offset + allocation.byteSize);
    }
    if (cursor < byteSize) free.push({ offset: cursor, size: byteSize - cursor });
    return free;
  }

  private heapStats(heap: HeapState): { allocatedBytes: number; freeBytes: number; largestFreeRange: number; fragmentation: number } {
    const allocatedBytes = [...heap.allocations.values()].reduce((sum, state) => sum + state.allocation.byteSize, 0);
    const freeBytes = heap.free.reduce((sum, range) => sum + range.size, 0);
    const largestFreeRange = Math.max(0, ...heap.free.map((range) => range.size));
    return {
      allocatedBytes,
      freeBytes,
      largestFreeRange,
      fragmentation: freeBytes === 0 ? 0 : 1 - largestFreeRange / freeBytes,
    };
  }

  private emptyPlan(heap: HeapState, stats: ReturnType<GodotRenderMemoryDefragmentationRuntime['heapStats']>): GodotRenderMemoryDefragmentationPlan {
    return Object.freeze({
      id: this.nextPlanId++,
      heap: heap.descriptor.rid,
      relocations: Object.freeze([]),
      bytesMoved: 0,
      freeBytesBefore: stats.freeBytes,
      largestFreeRangeBefore: stats.largestFreeRange,
      largestFreeRangeAfter: stats.largestFreeRange,
      fragmentationBefore: stats.fragmentation,
      fragmentationAfter: stats.fragmentation,
      generation: this.generation,
    });
  }

  private requireHeap(rid: GodotRenderMemoryRid): HeapState {
    const value = this.heaps.get(rid);
    if (value === undefined) throw new Error('godot-compat: unknown render memory heap.');
    return value;
  }

  private requireAllocation(rid: GodotRenderMemoryRid): AllocationState {
    const heap = this.allocationLookup.get(rid);
    const value = heap?.allocations.get(rid);
    if (value === undefined) throw new Error('godot-compat: unknown render memory allocation.');
    return value;
  }

  private publish(): void {
    if (this.watchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function createGodotRenderMemoryDefragmentationRuntime(
  backend: GodotRenderMemoryBackend,
): GodotRenderMemoryDefragmentationRuntime {
  return new GodotRenderMemoryDefragmentationRuntime(backend);
}
