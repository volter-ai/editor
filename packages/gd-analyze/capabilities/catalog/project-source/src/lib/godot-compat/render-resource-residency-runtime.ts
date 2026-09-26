export type GodotRenderResidentRid = string | number;

export type GodotRenderResidentKind =
  | 'texture'
  | 'buffer'
  | 'mesh'
  | 'material'
  | 'pipeline'
  | 'framebuffer'
  | 'acceleration-structure';

export const GODOT_RENDER_RESIDENCY_PRIORITY = {
  BACKGROUND: 0,
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4,
} as const;

export interface GodotRenderResidentDescriptor<TSource = unknown> {
  readonly rid: GodotRenderResidentRid;
  readonly kind: GodotRenderResidentKind;
  readonly byteSize: number;
  readonly source: TSource;
  readonly dependencies?: readonly GodotRenderResidentRid[];
  readonly priority?: number;
  readonly evictable?: boolean;
  readonly restoreCost?: number;
}

export interface GodotRenderResidentSnapshot<THandle = unknown> {
  readonly rid: GodotRenderResidentRid;
  readonly kind: GodotRenderResidentKind;
  readonly byteSize: number;
  readonly handle: THandle | null;
  readonly resident: boolean;
  readonly pendingDestroy: boolean;
  readonly pinned: number;
  readonly priority: number;
  readonly evictable: boolean;
  readonly restoreCost: number;
  readonly lastUsedFrame: number;
  readonly residentSinceFrame: number;
  readonly dependencies: readonly GodotRenderResidentRid[];
  readonly dependants: readonly GodotRenderResidentRid[];
  readonly revision: number;
}

export interface GodotRenderResidencySnapshot {
  readonly frame: number;
  readonly budgetBytes: number;
  readonly residentBytes: number;
  readonly pendingDestroyBytes: number;
  readonly residentResources: number;
  readonly evictedResources: number;
  readonly pinnedResources: number;
  readonly creations: number;
  readonly restorations: number;
  readonly evictions: number;
  readonly destructions: number;
  readonly budgetMisses: number;
  readonly revision: number;
}

export interface GodotRenderResidencyBackend<TSource = unknown, THandle = unknown> {
  create(descriptor: GodotRenderResidentDescriptor<TSource>): THandle;
  destroy(handle: THandle, descriptor: GodotRenderResidentDescriptor<TSource>): void;
  update?(handle: THandle, descriptor: GodotRenderResidentDescriptor<TSource>): void;
}

interface MutableResident<TSource, THandle> {
  descriptor: GodotRenderResidentDescriptor<TSource>;
  dependencies: Set<GodotRenderResidentRid>;
  dependants: Set<GodotRenderResidentRid>;
  handle: THandle | null;
  resident: boolean;
  pendingDestroy: boolean;
  pinned: number;
  lastUsedFrame: number;
  residentSinceFrame: number;
  revision: number;
}

interface DeferredDestroy<TSource, THandle> {
  resource: MutableResident<TSource, THandle>;
  handle: THandle;
  dueFrame: number;
  byteSize: number;
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

function ridKey(value: GodotRenderResidentRid): string {
  return `${typeof value}:${String(value)}`;
}

function kind(value: unknown): GodotRenderResidentKind {
  if (value !== 'texture'
    && value !== 'buffer'
    && value !== 'mesh'
    && value !== 'material'
    && value !== 'pipeline'
    && value !== 'framebuffer'
    && value !== 'acceleration-structure') {
    throw new TypeError(`godot-compat: unknown render residency kind ${String(value)}.`);
  }
  return value;
}

function normalizeDescriptor<TSource>(
  value: GodotRenderResidentDescriptor<TSource>,
): GodotRenderResidentDescriptor<TSource> {
  if (value.rid === null || value.rid === undefined) throw new TypeError('godot-compat: resident RID is required.');
  const dependencies = [...new Set(value.dependencies ?? [])];
  if (dependencies.some((dependency) => dependency === value.rid)) {
    throw new Error('godot-compat: resident resource cannot depend on itself.');
  }
  return Object.freeze({
    rid: value.rid,
    kind: kind(value.kind),
    byteSize: integer(value.byteSize, 'resident byte size', 0),
    source: value.source,
    dependencies: Object.freeze(dependencies),
    priority: integer(value.priority ?? GODOT_RENDER_RESIDENCY_PRIORITY.NORMAL, 'resident priority', 0, 4),
    evictable: value.evictable ?? true,
    restoreCost: finite(value.restoreCost ?? 1, 'resident restore cost'),
  });
}

export class GodotRenderResourceResidencyRuntime<TSource = unknown, THandle = unknown> {
  private readonly resources = new Map<GodotRenderResidentRid, MutableResident<TSource, THandle>>();
  private readonly deferred: DeferredDestroy<TSource, THandle>[] = [];
  private readonly watchers = new Set<(snapshot: GodotRenderResidencySnapshot) => void>();
  private readonly resourceWatchers = new Map<GodotRenderResidentRid, Set<(snapshot: GodotRenderResidentSnapshot<THandle>) => void>>();
  private frame = 0;
  private budgetBytes: number;
  private residentBytes = 0;
  private pendingDestroyBytes = 0;
  private retirementDelay: number;
  private revision = 1;
  private creations = 0;
  private restorations = 0;
  private evictions = 0;
  private destructions = 0;
  private budgetMisses = 0;

  constructor(
    private backend: GodotRenderResidencyBackend<TSource, THandle>,
    budgetBytes = 512 * 1024 * 1024,
    retirementDelay = 3,
  ) {
    this.budgetBytes = integer(budgetBytes, 'residency budget', 0);
    this.retirementDelay = integer(retirementDelay, 'residency retirement delay', 0, 32);
  }

  register(descriptorValue: GodotRenderResidentDescriptor<TSource>): void {
    const descriptor = normalizeDescriptor(descriptorValue);
    if (this.resources.has(descriptor.rid)) {
      throw new Error(`godot-compat: resident resource ${ridKey(descriptor.rid)} already exists.`);
    }
    const resource: MutableResident<TSource, THandle> = {
      descriptor,
      dependencies: new Set(descriptor.dependencies),
      dependants: new Set(),
      handle: null,
      resident: false,
      pendingDestroy: false,
      pinned: 0,
      lastUsedFrame: this.frame,
      residentSinceFrame: -1,
      revision: ++this.revision,
    };
    this.resources.set(descriptor.rid, resource);
    for (const dependency of resource.dependencies) this.require(dependency).dependants.add(descriptor.rid);
    this.assertAcyclic(resource);
    this.publish(resource);
  }

  update(descriptorValue: GodotRenderResidentDescriptor<TSource>): void {
    const descriptor = normalizeDescriptor(descriptorValue);
    const resource = this.require(descriptor.rid);
    for (const dependency of resource.dependencies) this.resources.get(dependency)?.dependants.delete(resource.descriptor.rid);
    resource.dependencies = new Set(descriptor.dependencies);
    for (const dependency of resource.dependencies) this.require(dependency).dependants.add(resource.descriptor.rid);
    const sizeDelta = descriptor.byteSize - resource.descriptor.byteSize;
    resource.descriptor = descriptor;
    this.assertAcyclic(resource);
    if (resource.resident) {
      if (sizeDelta > 0) this.ensureBudget(sizeDelta, new Set([descriptor.rid]));
      this.residentBytes += sizeDelta;
      if (resource.handle !== null) {
        if (this.backend.update !== undefined) this.backend.update(resource.handle, descriptor);
        else {
          const previous = resource.handle;
          resource.handle = this.backend.create(descriptor);
          this.backend.destroy(previous, descriptor);
          this.creations++;
          this.destructions++;
        }
      }
    }
    resource.revision = ++this.revision;
    this.publish(resource);
  }

  unregister(rid: GodotRenderResidentRid, force = false): boolean {
    const resource = this.resources.get(rid);
    if (resource === undefined) return false;
    if (!force && resource.dependants.size > 0) {
      throw new Error(`godot-compat: resident resource ${ridKey(rid)} still has dependants.`);
    }
    for (const dependantRid of resource.dependants) {
      const dependant = this.resources.get(dependantRid);
      dependant?.dependencies.delete(rid);
    }
    for (const dependency of resource.dependencies) this.resources.get(dependency)?.dependants.delete(rid);
    if (resource.resident) this.evictResource(resource, true);
    this.resources.delete(rid);
    this.resourceWatchers.delete(rid);
    this.revision++;
    this.publish();
    return true;
  }

  makeResident(rid: GodotRenderResidentRid): THandle {
    const resource = this.require(rid);
    if (resource.pendingDestroy) this.cancelDeferred(resource);
    if (resource.resident && resource.handle !== null) {
      resource.lastUsedFrame = this.frame;
      return resource.handle;
    }
    const stack = new Set<GodotRenderResidentRid>();
    this.restore(resource, stack);
    this.publish(resource);
    return resource.handle!;
  }

  touch(rid: GodotRenderResidentRid, recursive = false): void {
    const resource = this.require(rid);
    resource.lastUsedFrame = this.frame;
    if (recursive) for (const dependency of resource.dependencies) this.touch(dependency, true);
  }

  pin(rid: GodotRenderResidentRid, recursive = true): () => void {
    const pinned = new Set<GodotRenderResidentRid>();
    const visit = (resourceRid: GodotRenderResidentRid): void => {
      if (pinned.has(resourceRid)) return;
      pinned.add(resourceRid);
      const resource = this.require(resourceRid);
      resource.pinned++;
      if (recursive) for (const dependency of resource.dependencies) visit(dependency);
    };
    visit(rid);
    this.publish(this.require(rid));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const resourceRid of pinned) {
        const resource = this.resources.get(resourceRid);
        if (resource !== undefined) resource.pinned = Math.max(0, resource.pinned - 1);
      }
      this.publish(this.resources.get(rid));
    };
  }

  evict(rid: GodotRenderResidentRid, recursive = false): boolean {
    const resource = this.require(rid);
    if (resource.pinned > 0 || !resource.descriptor.evictable) return false;
    if ([...resource.dependants].some((dependant) => this.resources.get(dependant)?.resident)) return false;
    const evicted = this.evictResource(resource, false);
    if (recursive) {
      for (const dependencyRid of resource.dependencies) {
        const dependency = this.resources.get(dependencyRid);
        if (dependency !== undefined && dependency.dependants.size === 1) this.evict(dependencyRid, true);
      }
    }
    this.publish(resource);
    return evicted;
  }

  trim(targetBytes = this.budgetBytes): number {
    const target = integer(targetBytes, 'residency trim target', 0);
    let evictedBytes = 0;
    for (const candidate of this.evictionCandidates()) {
      if (this.residentBytes <= target) break;
      const size = candidate.descriptor.byteSize;
      if (this.evictResource(candidate, false)) evictedBytes += size;
    }
    if (this.residentBytes > target) this.budgetMisses++;
    this.publish();
    return evictedBytes;
  }

  beginFrame(frameValue: number): void {
    const nextFrame = integer(frameValue, 'residency frame', 0);
    if (nextFrame < this.frame) throw new RangeError('godot-compat: residency frame cannot move backwards.');
    this.frame = nextFrame;
    this.retireDue();
    if (this.residentBytes > this.budgetBytes) this.trim(this.budgetBytes);
    this.publish();
  }

  setBudget(byteSize: number): void {
    this.budgetBytes = integer(byteSize, 'residency budget', 0);
    if (this.residentBytes > this.budgetBytes) this.trim(this.budgetBytes);
    this.publish();
  }

  setRetirementDelay(frames: number): void {
    this.retirementDelay = integer(frames, 'residency retirement delay', 0, 32);
    this.retireDue();
  }

  replaceBackend(backend: GodotRenderResidencyBackend<TSource, THandle>, restoreResident = true): void {
    for (const deferred of this.deferred.splice(0)) {
      this.backend.destroy(deferred.handle, deferred.resource.descriptor);
      this.pendingDestroyBytes -= deferred.byteSize;
      this.destructions++;
      deferred.resource.pendingDestroy = false;
    }
    const resident = [...this.resources.values()].filter((resource) => resource.resident);
    for (const resource of resident) {
      if (resource.handle !== null) {
        this.backend.destroy(resource.handle, resource.descriptor);
        this.destructions++;
      }
      resource.handle = null;
      resource.resident = false;
      resource.residentSinceFrame = -1;
    }
    this.residentBytes = 0;
    this.backend = backend;
    this.revision++;
    if (restoreResident) for (const resource of resident) this.restore(resource, new Set());
    this.publish();
  }

  getHandle(rid: GodotRenderResidentRid): THandle | null {
    return this.require(rid).handle;
  }

  getResourceSnapshot(rid: GodotRenderResidentRid): GodotRenderResidentSnapshot<THandle> {
    return this.resourceSnapshot(this.require(rid));
  }

  getSnapshot(): GodotRenderResidencySnapshot {
    let residentResources = 0;
    let evictedResources = 0;
    let pinnedResources = 0;
    for (const resource of this.resources.values()) {
      if (resource.resident) residentResources++;
      else evictedResources++;
      if (resource.pinned > 0) pinnedResources++;
    }
    return Object.freeze({
      frame: this.frame,
      budgetBytes: this.budgetBytes,
      residentBytes: this.residentBytes,
      pendingDestroyBytes: this.pendingDestroyBytes,
      residentResources,
      evictedResources,
      pinnedResources,
      creations: this.creations,
      restorations: this.restorations,
      evictions: this.evictions,
      destructions: this.destructions,
      budgetMisses: this.budgetMisses,
      revision: this.revision,
    });
  }

  watch(listener: (snapshot: GodotRenderResidencySnapshot) => void): () => void {
    this.watchers.add(listener);
    listener(this.getSnapshot());
    return () => this.watchers.delete(listener);
  }

  watchResource(
    rid: GodotRenderResidentRid,
    listener: (snapshot: GodotRenderResidentSnapshot<THandle>) => void,
  ): () => void {
    const resource = this.require(rid);
    let watchers = this.resourceWatchers.get(rid);
    if (watchers === undefined) {
      watchers = new Set();
      this.resourceWatchers.set(rid, watchers);
    }
    watchers.add(listener);
    listener(this.resourceSnapshot(resource));
    return () => {
      watchers!.delete(listener);
      if (watchers!.size === 0) this.resourceWatchers.delete(rid);
    };
  }

  dispose(): void {
    for (const deferred of this.deferred) {
      this.backend.destroy(deferred.handle, deferred.resource.descriptor);
      this.destructions++;
    }
    this.deferred.length = 0;
    for (const resource of this.resources.values()) {
      if (resource.handle !== null) {
        this.backend.destroy(resource.handle, resource.descriptor);
        this.destructions++;
      }
    }
    this.resources.clear();
    this.resourceWatchers.clear();
    this.watchers.clear();
    this.residentBytes = 0;
    this.pendingDestroyBytes = 0;
    this.revision++;
  }

  private restore(resource: MutableResident<TSource, THandle>, stack: Set<GodotRenderResidentRid>): void {
    if (resource.resident && resource.handle !== null) return;
    if (stack.has(resource.descriptor.rid)) throw new Error('godot-compat: render residency dependency cycle.');
    stack.add(resource.descriptor.rid);
    for (const dependencyRid of resource.dependencies) this.restore(this.require(dependencyRid), stack);
    stack.delete(resource.descriptor.rid);
    this.ensureBudget(resource.descriptor.byteSize, new Set([...stack, resource.descriptor.rid]));
    resource.handle = this.backend.create(resource.descriptor);
    resource.resident = true;
    resource.pendingDestroy = false;
    resource.lastUsedFrame = this.frame;
    resource.residentSinceFrame = this.frame;
    resource.revision = ++this.revision;
    this.residentBytes += resource.descriptor.byteSize;
    this.creations++;
    if (resource.residentSinceFrame >= 0) this.restorations++;
  }

  private ensureBudget(requiredBytes: number, excluded: Set<GodotRenderResidentRid>): void {
    const target = this.budgetBytes - requiredBytes;
    if (this.residentBytes <= target) return;
    for (const candidate of this.evictionCandidates()) {
      if (this.residentBytes <= target) break;
      if (excluded.has(candidate.descriptor.rid)) continue;
      this.evictResource(candidate, false);
    }
    if (this.residentBytes > target) this.budgetMisses++;
  }

  private evictionCandidates(): MutableResident<TSource, THandle>[] {
    return [...this.resources.values()]
      .filter((resource) =>
        resource.resident
        && resource.pinned === 0
        && resource.descriptor.evictable
        && ![...resource.dependants].some((dependant) => this.resources.get(dependant)?.resident))
      .sort((left, right) =>
        (left.descriptor.priority ?? 2) - (right.descriptor.priority ?? 2)
        || left.lastUsedFrame - right.lastUsedFrame
        || (left.descriptor.restoreCost ?? 1) - (right.descriptor.restoreCost ?? 1)
        || right.descriptor.byteSize - left.descriptor.byteSize
        || ridKey(left.descriptor.rid).localeCompare(ridKey(right.descriptor.rid)));
  }

  private evictResource(resource: MutableResident<TSource, THandle>, immediate: boolean): boolean {
    if (!resource.resident || resource.handle === null) return false;
    const handle = resource.handle;
    resource.handle = null;
    resource.resident = false;
    resource.revision = ++this.revision;
    this.residentBytes -= resource.descriptor.byteSize;
    this.evictions++;
    if (immediate || this.retirementDelay === 0) {
      this.backend.destroy(handle, resource.descriptor);
      this.destructions++;
    } else {
      resource.pendingDestroy = true;
      this.pendingDestroyBytes += resource.descriptor.byteSize;
      this.deferred.push({
        resource,
        handle,
        dueFrame: this.frame + this.retirementDelay,
        byteSize: resource.descriptor.byteSize,
      });
    }
    return true;
  }

  private cancelDeferred(resource: MutableResident<TSource, THandle>): void {
    for (let index = this.deferred.length - 1; index >= 0; index--) {
      const deferred = this.deferred[index]!;
      if (deferred.resource !== resource) continue;
      this.deferred.splice(index, 1);
      this.backend.destroy(deferred.handle, resource.descriptor);
      this.pendingDestroyBytes -= deferred.byteSize;
      this.destructions++;
    }
    resource.pendingDestroy = false;
  }

  private retireDue(): void {
    for (let index = this.deferred.length - 1; index >= 0; index--) {
      const deferred = this.deferred[index]!;
      if (deferred.dueFrame > this.frame) continue;
      this.deferred.splice(index, 1);
      this.backend.destroy(deferred.handle, deferred.resource.descriptor);
      this.pendingDestroyBytes -= deferred.byteSize;
      this.destructions++;
      deferred.resource.pendingDestroy = false;
      deferred.resource.revision = ++this.revision;
    }
  }

  private assertAcyclic(root: MutableResident<TSource, THandle>): void {
    const visiting = new Set<GodotRenderResidentRid>();
    const visited = new Set<GodotRenderResidentRid>();
    const visit = (resource: MutableResident<TSource, THandle>): void => {
      if (visiting.has(resource.descriptor.rid)) {
        throw new Error(`godot-compat: render residency dependency cycle at ${ridKey(resource.descriptor.rid)}.`);
      }
      if (visited.has(resource.descriptor.rid)) return;
      visiting.add(resource.descriptor.rid);
      for (const dependency of resource.dependencies) visit(this.require(dependency));
      visiting.delete(resource.descriptor.rid);
      visited.add(resource.descriptor.rid);
    };
    visit(root);
  }

  private require(rid: GodotRenderResidentRid): MutableResident<TSource, THandle> {
    const resource = this.resources.get(rid);
    if (resource === undefined) throw new Error(`godot-compat: unknown resident resource ${ridKey(rid)}.`);
    return resource;
  }

  private resourceSnapshot(resource: MutableResident<TSource, THandle>): GodotRenderResidentSnapshot<THandle> {
    return Object.freeze({
      rid: resource.descriptor.rid,
      kind: resource.descriptor.kind,
      byteSize: resource.descriptor.byteSize,
      handle: resource.handle,
      resident: resource.resident,
      pendingDestroy: resource.pendingDestroy,
      pinned: resource.pinned,
      priority: resource.descriptor.priority ?? 2,
      evictable: resource.descriptor.evictable ?? true,
      restoreCost: resource.descriptor.restoreCost ?? 1,
      lastUsedFrame: resource.lastUsedFrame,
      residentSinceFrame: resource.residentSinceFrame,
      dependencies: Object.freeze([...resource.dependencies]),
      dependants: Object.freeze([...resource.dependants]),
      revision: resource.revision,
    });
  }

  private publish(resource?: MutableResident<TSource, THandle>): void {
    if (resource !== undefined) {
      const snapshot = this.resourceSnapshot(resource);
      for (const watcher of this.resourceWatchers.get(resource.descriptor.rid) ?? []) watcher(snapshot);
    }
    if (this.watchers.size > 0) {
      const snapshot = this.getSnapshot();
      for (const watcher of this.watchers) watcher(snapshot);
    }
  }
}

export function createGodotRenderResourceResidencyRuntime<TSource = unknown, THandle = unknown>(
  backend: GodotRenderResidencyBackend<TSource, THandle>,
  budgetBytes?: number,
  retirementDelay?: number,
): GodotRenderResourceResidencyRuntime<TSource, THandle> {
  return new GodotRenderResourceResidencyRuntime(backend, budgetBytes, retirementDelay);
}
