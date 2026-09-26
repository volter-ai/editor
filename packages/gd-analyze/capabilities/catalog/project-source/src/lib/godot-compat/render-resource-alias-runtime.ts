export type RenderAliasResourceKind = "buffer" | "texture" | "acceleration_structure";

export type RenderAliasMemoryClass =
  | "device_local"
  | "host_visible"
  | "readback"
  | "transient_attachment";

export type RenderAliasAccess =
  | "read"
  | "write"
  | "read_write"
  | "attachment"
  | "copy_source"
  | "copy_destination";

export interface RenderAliasLifetime {
  firstPass: number;
  lastPass: number;
}

export interface RenderAliasResourceDescriptor {
  id: string;
  name?: string;
  kind: RenderAliasResourceKind;
  memoryClass: RenderAliasMemoryClass;
  byteSize: number;
  alignment?: number;
  format?: string;
  sampleCount?: number;
  usage?: readonly string[];
  aliasGroup?: string;
  dedicated?: boolean;
  persistent?: boolean;
  exported?: boolean;
}

export interface RenderAliasPassUse {
  pass: number;
  resourceId: string;
  access: RenderAliasAccess;
  discardBefore?: boolean;
  discardAfter?: boolean;
}

export interface RenderAliasAllocation {
  resourceId: string;
  heapId: string;
  offset: number;
  byteSize: number;
  alignment: number;
  lifetime: RenderAliasLifetime;
  dedicated: boolean;
}

export interface RenderAliasHeap {
  id: string;
  compatibilityKey: string;
  memoryClass: RenderAliasMemoryClass;
  byteSize: number;
  peakBytes: number;
  allocations: RenderAliasAllocation[];
}

export interface RenderAliasBarrier {
  heapId: string;
  offset: number;
  byteSize: number;
  pass: number;
  previousResourceId: string;
  nextResourceId: string;
  discardPrevious: boolean;
  initializeNext: boolean;
}

export interface RenderAliasPlanStats {
  resourceCount: number;
  heapCount: number;
  dedicatedHeapCount: number;
  logicalBytes: number;
  physicalBytes: number;
  savedBytes: number;
  efficiency: number;
  barrierCount: number;
}

export interface RenderAliasPlan {
  revision: number;
  passCount: number;
  heaps: RenderAliasHeap[];
  allocations: Map<string, RenderAliasAllocation>;
  barriers: RenderAliasBarrier[];
  statistics: RenderAliasPlanStats;
}

export interface RenderAliasPlannerOptions {
  defaultHeapSize?: number;
  maximumHeapSize?: number;
  minimumAlignment?: number;
  allowCrossKindAliasing?: boolean;
  allowFormatAliasing?: boolean;
  mergeAdjacentBarriers?: boolean;
}

interface MutableResource {
  descriptor: RenderAliasResourceDescriptor;
  lifetime: RenderAliasLifetime;
  uses: RenderAliasPassUse[];
  compatibilityKey: string;
}

interface FreeRange {
  offset: number;
  byteSize: number;
}

interface ActiveAllocation {
  resource: MutableResource;
  allocation: RenderAliasAllocation;
}

interface MutableHeap extends RenderAliasHeap {
  freeRanges: FreeRange[];
  active: ActiveAllocation[];
  occupants: RenderAliasAllocation[];
}

const DEFAULT_HEAP_SIZE = 16 * 1024 * 1024;
const DEFAULT_MAXIMUM_HEAP_SIZE = 512 * 1024 * 1024;
const DEFAULT_ALIGNMENT = 256;

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

function alignUp(value: number, alignment: number): number {
  if (alignment <= 1) return value;
  return Math.ceil(value / alignment) * alignment;
}

function normalizedAlignment(value: number | undefined, minimum: number): number {
  const requested = value ?? minimum;
  assertFiniteNonNegative(requested, "resource alignment");
  if (requested < 1) return minimum;
  let result = 1;
  while (result < requested) result *= 2;
  return Math.max(result, minimum);
}

function rangesOverlap(a: RenderAliasAllocation, b: RenderAliasAllocation): boolean {
  return a.offset < b.offset + b.byteSize && b.offset < a.offset + a.byteSize;
}

function lifetimesOverlap(a: RenderAliasLifetime, b: RenderAliasLifetime): boolean {
  return a.firstPass <= b.lastPass && b.firstPass <= a.lastPass;
}

function cloneAllocation(allocation: RenderAliasAllocation): RenderAliasAllocation {
  return {
    ...allocation,
    lifetime: { ...allocation.lifetime },
  };
}

function cloneHeap(heap: RenderAliasHeap): RenderAliasHeap {
  return {
    ...heap,
    allocations: heap.allocations.map(cloneAllocation),
  };
}

function cloneResourceDescriptor(
  descriptor: RenderAliasResourceDescriptor,
): RenderAliasResourceDescriptor {
  return {
    ...descriptor,
    ...(descriptor.usage === undefined ? {} : { usage: [...descriptor.usage] }),
  };
}

export class RenderResourceAliasRuntime {
  private readonly resources = new Map<string, RenderAliasResourceDescriptor>();
  private readonly uses = new Map<string, RenderAliasPassUse[]>();
  private readonly options: Required<RenderAliasPlannerOptions>;
  private revision = 0;
  private cachedPlan: RenderAliasPlan | null = null;

  constructor(options: RenderAliasPlannerOptions = {}) {
    this.options = {
      defaultHeapSize: options.defaultHeapSize ?? DEFAULT_HEAP_SIZE,
      maximumHeapSize: options.maximumHeapSize ?? DEFAULT_MAXIMUM_HEAP_SIZE,
      minimumAlignment: options.minimumAlignment ?? DEFAULT_ALIGNMENT,
      allowCrossKindAliasing: options.allowCrossKindAliasing ?? false,
      allowFormatAliasing: options.allowFormatAliasing ?? false,
      mergeAdjacentBarriers: options.mergeAdjacentBarriers ?? true,
    };
    assertFiniteNonNegative(this.options.defaultHeapSize, "defaultHeapSize");
    assertFiniteNonNegative(this.options.maximumHeapSize, "maximumHeapSize");
    if (this.options.defaultHeapSize < 1) throw new Error("defaultHeapSize must be positive");
    if (this.options.maximumHeapSize < this.options.defaultHeapSize) {
      throw new Error("maximumHeapSize cannot be smaller than defaultHeapSize");
    }
  }

  registerResource(descriptor: RenderAliasResourceDescriptor): void {
    if (!descriptor.id) throw new Error("Render alias resource id cannot be empty");
    assertFiniteNonNegative(descriptor.byteSize, `resource ${descriptor.id} byteSize`);
    if (descriptor.byteSize === 0) throw new Error(`Resource ${descriptor.id} must not be empty`);
    if (this.resources.has(descriptor.id)) {
      throw new Error(`Render alias resource ${descriptor.id} is already registered`);
    }
    this.resources.set(descriptor.id, cloneResourceDescriptor(descriptor));
    this.uses.set(descriptor.id, []);
    this.invalidate();
  }

  updateResource(id: string, patch: Partial<Omit<RenderAliasResourceDescriptor, "id">>): void {
    const existing = this.requireResource(id);
    const { usage: patchedUsage, ...rest } = patch;
    const next = {
      ...existing,
      ...rest,
      id,
      ...(patchedUsage === undefined
        ? existing.usage === undefined ? {} : { usage: [...existing.usage] }
        : { usage: [...patchedUsage] }),
    };
    assertFiniteNonNegative(next.byteSize, `resource ${id} byteSize`);
    if (next.byteSize === 0) throw new Error(`Resource ${id} must not be empty`);
    this.resources.set(id, next);
    this.invalidate();
  }

  unregisterResource(id: string): boolean {
    const removed = this.resources.delete(id);
    this.uses.delete(id);
    if (removed) this.invalidate();
    return removed;
  }

  addUse(use: RenderAliasPassUse): void {
    if (!Number.isInteger(use.pass) || use.pass < 0) {
      throw new Error("Render alias pass index must be a non-negative integer");
    }
    this.requireResource(use.resourceId);
    const list = this.uses.get(use.resourceId)!;
    const existingIndex = list.findIndex((entry) => entry.pass === use.pass);
    if (existingIndex >= 0) list[existingIndex] = { ...use };
    else list.push({ ...use });
    list.sort((a, b) => a.pass - b.pass);
    this.invalidate();
  }

  addUses(uses: readonly RenderAliasPassUse[]): void {
    for (const use of uses) this.addUse(use);
  }

  removeUse(resourceId: string, pass: number): boolean {
    const list = this.uses.get(resourceId);
    if (!list) return false;
    const index = list.findIndex((entry) => entry.pass === pass);
    if (index < 0) return false;
    list.splice(index, 1);
    this.invalidate();
    return true;
  }

  clearUses(resourceId?: string): void {
    if (resourceId !== undefined) {
      this.requireResource(resourceId);
      this.uses.set(resourceId, []);
    } else {
      for (const id of this.resources.keys()) this.uses.set(id, []);
    }
    this.invalidate();
  }

  hasResource(id: string): boolean {
    return this.resources.has(id);
  }

  getResource(id: string): RenderAliasResourceDescriptor | undefined {
    const resource = this.resources.get(id);
    return resource === undefined ? undefined : cloneResourceDescriptor(resource);
  }

  getUses(id: string): RenderAliasPassUse[] {
    return (this.uses.get(id) ?? []).map((use) => ({ ...use }));
  }

  plan(): RenderAliasPlan {
    if (this.cachedPlan) return this.clonePlan(this.cachedPlan);
    const mutableResources = this.collectMutableResources();
    const heaps: MutableHeap[] = [];
    const allocations = new Map<string, RenderAliasAllocation>();

    const ordered = mutableResources.sort((a, b) => {
      const dedicatedDelta = Number(this.isDedicated(b.descriptor)) - Number(this.isDedicated(a.descriptor));
      if (dedicatedDelta !== 0) return dedicatedDelta;
      const firstDelta = a.lifetime.firstPass - b.lifetime.firstPass;
      if (firstDelta !== 0) return firstDelta;
      return b.descriptor.byteSize - a.descriptor.byteSize;
    });

    for (const resource of ordered) {
      for (const heap of heaps) this.releaseExpired(heap, resource.lifetime.firstPass);
      const allocation = this.allocateResource(resource, heaps);
      allocations.set(resource.descriptor.id, allocation);
    }

    const publicHeaps = heaps.map((heap) => this.finalizeHeap(heap));
    const barriers = this.buildBarriers(publicHeaps, mutableResources);
    const passCount = mutableResources.reduce((maximum, resource) => Math.max(maximum, resource.lifetime.lastPass + 1), 0);
    const logicalBytes = mutableResources.reduce((total, resource) => total + resource.descriptor.byteSize, 0);
    const physicalBytes = publicHeaps.reduce((total, heap) => total + heap.byteSize, 0);
    const dedicatedHeapCount = publicHeaps.filter(
      (heap) => heap.allocations.length === 1 && heap.allocations[0]!.dedicated,
    ).length;
    const plan: RenderAliasPlan = {
      revision: this.revision,
      passCount,
      heaps: publicHeaps,
      allocations,
      barriers,
      statistics: {
        resourceCount: mutableResources.length,
        heapCount: publicHeaps.length,
        dedicatedHeapCount,
        logicalBytes,
        physicalBytes,
        savedBytes: Math.max(0, logicalBytes - physicalBytes),
        efficiency: logicalBytes === 0 ? 1 : Math.min(1, logicalBytes / Math.max(1, physicalBytes)),
        barrierCount: barriers.length,
      },
    };
    this.cachedPlan = plan;
    return this.clonePlan(plan);
  }

  allocationFor(resourceId: string): RenderAliasAllocation | undefined {
    const allocation = this.plan().allocations.get(resourceId);
    return allocation ? cloneAllocation(allocation) : undefined;
  }

  barriersForPass(pass: number): RenderAliasBarrier[] {
    return this.plan().barriers.filter((barrier) => barrier.pass === pass).map((barrier) => ({ ...barrier }));
  }

  resourcesSharingAllocation(resourceId: string): string[] {
    const plan = this.plan();
    const allocation = plan.allocations.get(resourceId);
    if (!allocation) return [];
    const heap = plan.heaps.find((candidate) => candidate.id === allocation.heapId);
    if (!heap) return [];
    return heap.allocations
      .filter((candidate) => candidate.resourceId !== resourceId && rangesOverlap(candidate, allocation))
      .map((candidate) => candidate.resourceId);
  }

  reset(): void {
    this.resources.clear();
    this.uses.clear();
    this.invalidate();
  }

  private collectMutableResources(): MutableResource[] {
    const resources: MutableResource[] = [];
    for (const descriptor of this.resources.values()) {
      const uses = [...(this.uses.get(descriptor.id) ?? [])].sort((a, b) => a.pass - b.pass);
      if (uses.length === 0 && !descriptor.persistent && !descriptor.exported) continue;
      const lifetime: RenderAliasLifetime = uses.length > 0
        ? { firstPass: uses[0]!.pass, lastPass: uses[uses.length - 1]!.pass }
        : { firstPass: 0, lastPass: 0 };
      if (descriptor.persistent || descriptor.exported) lifetime.lastPass = Number.MAX_SAFE_INTEGER;
      resources.push({
        descriptor,
        lifetime,
        uses,
        compatibilityKey: this.compatibilityKey(descriptor),
      });
    }
    return resources;
  }

  private compatibilityKey(descriptor: RenderAliasResourceDescriptor): string {
    const parts: string[] = [descriptor.memoryClass];
    if (!this.options.allowCrossKindAliasing) parts.push(descriptor.kind);
    if (!this.options.allowFormatAliasing && descriptor.kind === "texture") {
      parts.push(descriptor.format ?? "unknown", String(descriptor.sampleCount ?? 1));
    }
    if (descriptor.aliasGroup) parts.push(`group:${descriptor.aliasGroup}`);
    const usage = [...(descriptor.usage ?? [])].sort();
    if (usage.length > 0) parts.push(`usage:${usage.join(",")}`);
    return parts.join("|");
  }

  private isDedicated(descriptor: RenderAliasResourceDescriptor): boolean {
    return Boolean(descriptor.dedicated || descriptor.persistent || descriptor.exported || descriptor.byteSize > this.options.maximumHeapSize);
  }

  private allocateResource(resource: MutableResource, heaps: MutableHeap[]): RenderAliasAllocation {
    const alignment = normalizedAlignment(resource.descriptor.alignment, this.options.minimumAlignment);
    const byteSize = alignUp(resource.descriptor.byteSize, alignment);
    const dedicated = this.isDedicated(resource.descriptor);
    if (!dedicated) {
      for (const heap of heaps) {
        if (heap.compatibilityKey !== resource.compatibilityKey) continue;
        const allocation = this.tryAllocateRange(heap, resource, byteSize, alignment, false);
        if (allocation) return allocation;
      }
    }

    const requestedSize = dedicated
      ? byteSize
      : Math.min(this.options.maximumHeapSize, Math.max(this.options.defaultHeapSize, byteSize));
    const heap: MutableHeap = {
      id: `alias_heap_${heaps.length + 1}`,
      compatibilityKey: resource.compatibilityKey,
      memoryClass: resource.descriptor.memoryClass,
      byteSize: requestedSize,
      peakBytes: 0,
      allocations: [],
      occupants: [],
      active: [],
      freeRanges: [{ offset: 0, byteSize: requestedSize }],
    };
    heaps.push(heap);
    const allocation = this.tryAllocateRange(heap, resource, byteSize, alignment, dedicated);
    if (!allocation) throw new Error(`Unable to allocate render alias resource ${resource.descriptor.id}`);
    return allocation;
  }

  private tryAllocateRange(
    heap: MutableHeap,
    resource: MutableResource,
    byteSize: number,
    alignment: number,
    dedicated: boolean,
  ): RenderAliasAllocation | null {
    let selectedIndex = -1;
    let selectedOffset = 0;
    let smallestWaste = Number.POSITIVE_INFINITY;
    for (let index = 0; index < heap.freeRanges.length; index += 1) {
      const range = heap.freeRanges[index]!;
      const offset = alignUp(range.offset, alignment);
      const padding = offset - range.offset;
      const available = range.byteSize - padding;
      if (available < byteSize) continue;
      const waste = available - byteSize;
      if (waste < smallestWaste) {
        selectedIndex = index;
        selectedOffset = offset;
        smallestWaste = waste;
      }
    }
    if (selectedIndex < 0) return null;
    const range = heap.freeRanges[selectedIndex];
    if (range === undefined) {
      throw new Error(`Selected free range ${selectedIndex} no longer exists in ${heap.id}`);
    }
    heap.freeRanges.splice(selectedIndex, 1);
    if (selectedOffset > range.offset) {
      heap.freeRanges.push({ offset: range.offset, byteSize: selectedOffset - range.offset });
    }
    const end = selectedOffset + byteSize;
    const rangeEnd = range.offset + range.byteSize;
    if (end < rangeEnd) heap.freeRanges.push({ offset: end, byteSize: rangeEnd - end });
    this.coalesceFreeRanges(heap);

    const allocation: RenderAliasAllocation = {
      resourceId: resource.descriptor.id,
      heapId: heap.id,
      offset: selectedOffset,
      byteSize,
      alignment,
      lifetime: { ...resource.lifetime },
      dedicated,
    };
    heap.allocations.push(allocation);
    heap.occupants.push(allocation);
    heap.active.push({ resource, allocation });
    const activeBytes = heap.active.reduce((total, item) => total + item.allocation.byteSize, 0);
    heap.peakBytes = Math.max(heap.peakBytes, activeBytes);
    return allocation;
  }

  private releaseExpired(heap: MutableHeap, pass: number): void {
    const retained: ActiveAllocation[] = [];
    for (const active of heap.active) {
      if (active.resource.lifetime.lastPass < pass) {
        heap.freeRanges.push({ offset: active.allocation.offset, byteSize: active.allocation.byteSize });
      } else {
        retained.push(active);
      }
    }
    heap.active = retained;
    this.coalesceFreeRanges(heap);
  }

  private coalesceFreeRanges(heap: MutableHeap): void {
    heap.freeRanges.sort((a, b) => a.offset - b.offset);
    const merged: FreeRange[] = [];
    for (const range of heap.freeRanges) {
      const previous = merged[merged.length - 1];
      if (previous && previous.offset + previous.byteSize >= range.offset) {
        previous.byteSize = Math.max(previous.offset + previous.byteSize, range.offset + range.byteSize) - previous.offset;
      } else {
        merged.push({ ...range });
      }
    }
    heap.freeRanges = merged;
  }

  private finalizeHeap(heap: MutableHeap): RenderAliasHeap {
    return {
      id: heap.id,
      compatibilityKey: heap.compatibilityKey,
      memoryClass: heap.memoryClass,
      byteSize: heap.byteSize,
      peakBytes: heap.peakBytes,
      allocations: heap.allocations.map(cloneAllocation),
    };
  }

  private buildBarriers(heaps: RenderAliasHeap[], resources: MutableResource[]): RenderAliasBarrier[] {
    const resourceById = new Map(resources.map((resource) => [resource.descriptor.id, resource]));
    const barriers: RenderAliasBarrier[] = [];
    for (const heap of heaps) {
      const allocations = [...heap.allocations].sort((a, b) => a.lifetime.firstPass - b.lifetime.firstPass);
      for (let nextIndex = 0; nextIndex < allocations.length; nextIndex += 1) {
        const next = allocations[nextIndex]!;
        let previous: RenderAliasAllocation | null = null;
        for (let previousIndex = 0; previousIndex < nextIndex; previousIndex += 1) {
          const candidate = allocations[previousIndex]!;
          if (!rangesOverlap(candidate, next)) continue;
          if (lifetimesOverlap(candidate.lifetime, next.lifetime)) continue;
          if (candidate.lifetime.lastPass >= next.lifetime.firstPass) continue;
          if (!previous || candidate.lifetime.lastPass > previous.lifetime.lastPass) previous = candidate;
        }
        if (!previous) continue;
        const previousResource = resourceById.get(previous.resourceId);
        const nextResource = resourceById.get(next.resourceId);
        const previousLastUse = previousResource?.uses[previousResource.uses.length - 1];
        const nextFirstUse = nextResource?.uses[0];
        const offset = Math.max(previous.offset, next.offset);
        const end = Math.min(previous.offset + previous.byteSize, next.offset + next.byteSize);
        barriers.push({
          heapId: heap.id,
          offset,
          byteSize: Math.max(0, end - offset),
          pass: next.lifetime.firstPass,
          previousResourceId: previous.resourceId,
          nextResourceId: next.resourceId,
          discardPrevious: previousLastUse?.discardAfter ?? true,
          initializeNext: !(nextFirstUse?.discardBefore ?? false),
        });
      }
    }
    barriers.sort((a, b) => a.pass - b.pass || a.heapId.localeCompare(b.heapId) || a.offset - b.offset);
    return this.options.mergeAdjacentBarriers ? this.mergeBarriers(barriers) : barriers;
  }

  private mergeBarriers(barriers: RenderAliasBarrier[]): RenderAliasBarrier[] {
    const merged: RenderAliasBarrier[] = [];
    for (const barrier of barriers) {
      const previous = merged[merged.length - 1];
      const compatible = previous
        && previous.heapId === barrier.heapId
        && previous.pass === barrier.pass
        && previous.previousResourceId === barrier.previousResourceId
        && previous.nextResourceId === barrier.nextResourceId
        && previous.discardPrevious === barrier.discardPrevious
        && previous.initializeNext === barrier.initializeNext
        && previous.offset + previous.byteSize >= barrier.offset;
      if (compatible) {
        previous.byteSize = Math.max(previous.offset + previous.byteSize, barrier.offset + barrier.byteSize) - previous.offset;
      } else {
        merged.push({ ...barrier });
      }
    }
    return merged;
  }

  private requireResource(id: string): RenderAliasResourceDescriptor {
    const resource = this.resources.get(id);
    if (!resource) throw new Error(`Unknown render alias resource ${id}`);
    return resource;
  }

  private invalidate(): void {
    this.revision += 1;
    this.cachedPlan = null;
  }

  private clonePlan(plan: RenderAliasPlan): RenderAliasPlan {
    return {
      revision: plan.revision,
      passCount: plan.passCount,
      heaps: plan.heaps.map(cloneHeap),
      allocations: new Map([...plan.allocations].map(([id, allocation]) => [id, cloneAllocation(allocation)])),
      barriers: plan.barriers.map((barrier) => ({ ...barrier })),
      statistics: { ...plan.statistics },
    };
  }
}
