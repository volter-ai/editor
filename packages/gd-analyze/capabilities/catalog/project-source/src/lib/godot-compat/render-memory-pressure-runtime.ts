export type RenderMemoryPressureLevel = "normal" | "soft" | "hard" | "critical";
export type RenderMemoryResourceClass = "texture" | "buffer" | "pipeline" | "acceleration_structure" | "transient" | "other";

export interface RenderMemoryBudget {
  group: string;
  softBytes: number;
  hardBytes: number;
  criticalBytes?: number;
}

export interface RenderMemoryTrackedResource {
  id: string;
  group: string;
  resourceClass: RenderMemoryResourceClass;
  byteSize: number;
  priority?: number;
  pinned?: boolean;
  evictable?: boolean;
  lastUsedFrame?: number;
  dependencies?: readonly string[];
}

export interface RenderMemoryPressureBackend {
  evict(resource: RenderMemoryTrackedResource): number | Promise<number>;
}

export interface RenderMemoryPressureEvent {
  group: string;
  previousLevel: RenderMemoryPressureLevel;
  level: RenderMemoryPressureLevel;
  usedBytes: number;
  reservedBytes: number;
  budget: RenderMemoryBudget;
  frame: number;
}

export interface RenderMemoryReservation {
  id: string;
  group: string;
  byteSize: number;
  committed: boolean;
  release(): void;
  commit(resource: Omit<RenderMemoryTrackedResource, "group" | "byteSize">): void;
}

export interface RenderMemoryPressureSnapshot {
  frame: number;
  totalUsedBytes: number;
  totalReservedBytes: number;
  resourceCount: number;
  evictionCount: number;
  releasedBytes: number;
  groups: Array<{
    group: string;
    level: RenderMemoryPressureLevel;
    usedBytes: number;
    reservedBytes: number;
    resourceCount: number;
    budget: RenderMemoryBudget;
  }>;
}

type PressureWatcher = (event: RenderMemoryPressureEvent) => void;

interface InternalResource extends RenderMemoryTrackedResource {
  dependencies: string[];
}

interface InternalReservation {
  id: string;
  group: string;
  byteSize: number;
  active: boolean;
}

const LEVEL_ORDER: RenderMemoryPressureLevel[] = ["normal", "soft", "hard", "critical"];

function validateBytes(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
}

function cloneResource(resource: RenderMemoryTrackedResource): RenderMemoryTrackedResource {
  return {
    ...resource,
    ...(resource.dependencies === undefined ? {} : { dependencies: [...resource.dependencies] }),
  };
}

export class RenderMemoryPressureRuntime {
  private readonly budgets = new Map<string, RenderMemoryBudget>();
  private readonly resources = new Map<string, InternalResource>();
  private readonly reservations = new Map<string, InternalReservation>();
  private readonly levels = new Map<string, RenderMemoryPressureLevel>();
  private readonly watchers = new Set<PressureWatcher>();
  private frame = 0;
  private nextReservationId = 1;
  private evictionCount = 0;
  private releasedBytes = 0;

  constructor(private readonly backend: RenderMemoryPressureBackend) {}

  setBudget(budget: RenderMemoryBudget): void {
    if (!budget.group) throw new Error("Memory budget group cannot be empty");
    validateBytes(budget.softBytes, "softBytes");
    validateBytes(budget.hardBytes, "hardBytes");
    validateBytes(budget.criticalBytes ?? budget.hardBytes, "criticalBytes");
    if (budget.hardBytes < budget.softBytes) throw new Error("hardBytes cannot be below softBytes");
    if ((budget.criticalBytes ?? budget.hardBytes) < budget.hardBytes) throw new Error("criticalBytes cannot be below hardBytes");
    this.budgets.set(budget.group, { ...budget });
    this.updateLevel(budget.group);
  }

  removeBudget(group: string): boolean {
    if ([...this.resources.values()].some((resource) => resource.group === group)) {
      throw new Error(`Cannot remove memory budget ${group} while resources remain tracked`);
    }
    this.levels.delete(group);
    return this.budgets.delete(group);
  }

  track(resource: RenderMemoryTrackedResource): void {
    this.requireBudget(resource.group);
    if (!resource.id) throw new Error("Tracked render resource id cannot be empty");
    if (this.resources.has(resource.id)) throw new Error(`Render resource ${resource.id} is already tracked`);
    validateBytes(resource.byteSize, `resource ${resource.id} byteSize`);
    this.resources.set(resource.id, {
      ...resource,
      dependencies: [...(resource.dependencies ?? [])],
      lastUsedFrame: resource.lastUsedFrame ?? this.frame,
    });
    this.updateLevel(resource.group);
  }

  untrack(id: string): boolean {
    const resource = this.resources.get(id);
    if (!resource) return false;
    this.resources.delete(id);
    this.updateLevel(resource.group);
    return true;
  }

  resize(id: string, byteSize: number): void {
    validateBytes(byteSize, "resource byteSize");
    const resource = this.requireResource(id);
    resource.byteSize = byteSize;
    this.updateLevel(resource.group);
  }

  touch(id: string, frame = this.frame): void {
    const resource = this.requireResource(id);
    resource.lastUsedFrame = frame;
  }

  pin(id: string, pinned = true): void {
    this.requireResource(id).pinned = pinned;
  }

  reserve(group: string, byteSize: number): RenderMemoryReservation {
    this.requireBudget(group);
    validateBytes(byteSize, "reservation byteSize");
    const id = `memory_reservation_${this.nextReservationId++}`;
    const internal: InternalReservation = { id, group, byteSize, active: true };
    this.reservations.set(id, internal);
    this.updateLevel(group);
    let committed = false;
    return {
      id,
      group,
      byteSize,
      get committed() { return committed; },
      release: () => {
        if (!internal.active) return;
        internal.active = false;
        this.reservations.delete(id);
        this.updateLevel(group);
      },
      commit: (resource) => {
        if (!internal.active) throw new Error(`Memory reservation ${id} is no longer active`);
        internal.active = false;
        this.reservations.delete(id);
        committed = true;
        this.track({ ...resource, group, byteSize });
      },
    };
  }

  canReserve(group: string, byteSize: number, level: RenderMemoryPressureLevel = "hard"): boolean {
    validateBytes(byteSize, "reservation byteSize");
    const budget = this.requireBudget(group);
    const limit = level === "soft" ? budget.softBytes
      : level === "hard" ? budget.hardBytes
      : level === "critical" ? budget.criticalBytes ?? budget.hardBytes
      : Number.POSITIVE_INFINITY;
    return this.groupBytes(group) + byteSize <= limit;
  }

  async relieve(group: string, targetLevel: RenderMemoryPressureLevel = "soft"): Promise<string[]> {
    const budget = this.requireBudget(group);
    const targetBytes = targetLevel === "normal" ? budget.softBytes
      : targetLevel === "soft" ? budget.softBytes
      : targetLevel === "hard" ? budget.hardBytes
      : budget.criticalBytes ?? budget.hardBytes;
    const evicted: string[] = [];
    const candidates = [...this.resources.values()]
      .filter((resource) => resource.group === group && resource.evictable !== false && !resource.pinned)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)
        || (a.lastUsedFrame ?? 0) - (b.lastUsedFrame ?? 0)
        || b.byteSize - a.byteSize);
    for (const resource of candidates) {
      if (this.groupBytes(group) <= targetBytes) break;
      if (this.hasLiveDependent(resource.id)) continue;
      const released = Math.max(0, await this.backend.evict(cloneResource(resource)));
      this.resources.delete(resource.id);
      this.evictionCount += 1;
      this.releasedBytes += released;
      evicted.push(resource.id);
    }
    this.updateLevel(group);
    return evicted;
  }

  async beginFrame(frame?: number, autoRelieve = true): Promise<void> {
    this.frame = frame ?? this.frame + 1;
    if (!Number.isInteger(this.frame) || this.frame < 0) throw new Error("Memory pressure frame must be non-negative");
    for (const group of this.budgets.keys()) {
      this.updateLevel(group);
      if (autoRelieve && LEVEL_ORDER.indexOf(this.levels.get(group) ?? "normal") >= LEVEL_ORDER.indexOf("hard")) {
        await this.relieve(group, "soft");
      }
    }
  }

  getResource(id: string): RenderMemoryTrackedResource | undefined {
    const resource = this.resources.get(id);
    return resource ? cloneResource(resource) : undefined;
  }

  level(group: string): RenderMemoryPressureLevel {
    this.requireBudget(group);
    return this.levels.get(group) ?? "normal";
  }

  snapshot(): RenderMemoryPressureSnapshot {
    const groups = [...this.budgets.values()].map((budget) => {
      const groupResources = [...this.resources.values()].filter((resource) => resource.group === budget.group);
      return {
        group: budget.group,
        level: this.levels.get(budget.group) ?? "normal",
        usedBytes: groupResources.reduce((total, resource) => total + resource.byteSize, 0),
        reservedBytes: this.reservedBytes(budget.group),
        resourceCount: groupResources.length,
        budget: { ...budget },
      };
    });
    return {
      frame: this.frame,
      totalUsedBytes: groups.reduce((total, group) => total + group.usedBytes, 0),
      totalReservedBytes: groups.reduce((total, group) => total + group.reservedBytes, 0),
      resourceCount: this.resources.size,
      evictionCount: this.evictionCount,
      releasedBytes: this.releasedBytes,
      groups,
    };
  }

  watch(watcher: PressureWatcher): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  private updateLevel(group: string): void {
    const budget = this.requireBudget(group);
    const bytes = this.groupBytes(group);
    const previousLevel = this.levels.get(group) ?? "normal";
    const level: RenderMemoryPressureLevel = bytes >= (budget.criticalBytes ?? budget.hardBytes) ? "critical"
      : bytes >= budget.hardBytes ? "hard"
      : bytes >= budget.softBytes ? "soft"
      : "normal";
    this.levels.set(group, level);
    if (level !== previousLevel) {
      const event = { group, previousLevel, level, usedBytes: bytes - this.reservedBytes(group), reservedBytes: this.reservedBytes(group), budget: { ...budget }, frame: this.frame };
      for (const watcher of this.watchers) watcher(event);
    }
  }

  private groupBytes(group: string): number {
    return [...this.resources.values()].filter((resource) => resource.group === group).reduce((total, resource) => total + resource.byteSize, 0) + this.reservedBytes(group);
  }

  private reservedBytes(group: string): number {
    return [...this.reservations.values()].filter((reservation) => reservation.group === group && reservation.active).reduce((total, reservation) => total + reservation.byteSize, 0);
  }

  private hasLiveDependent(id: string): boolean {
    return [...this.resources.values()].some((resource) => resource.dependencies.includes(id));
  }

  private requireBudget(group: string): RenderMemoryBudget {
    const budget = this.budgets.get(group);
    if (!budget) throw new Error(`Unknown render memory budget ${group}`);
    return budget;
  }

  private requireResource(id: string): InternalResource {
    const resource = this.resources.get(id);
    if (!resource) throw new Error(`Unknown render memory resource ${id}`);
    return resource;
  }
}
