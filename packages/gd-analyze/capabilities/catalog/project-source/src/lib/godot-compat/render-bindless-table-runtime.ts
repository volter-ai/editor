export type RenderBindlessResourceKind = "sampled_texture" | "storage_texture" | "sampler" | "uniform_buffer" | "storage_buffer" | "acceleration_structure";

export interface RenderBindlessResource {
  id: string;
  kind: RenderBindlessResourceKind;
  handle: unknown;
  generation?: number;
}

export interface RenderBindlessTableBackend {
  write(kind: RenderBindlessResourceKind, index: number, resource: RenderBindlessResource): void | Promise<void>;
  clear(kind: RenderBindlessResourceKind, index: number): void | Promise<void>;
  flush?(): void | Promise<void>;
}

export interface RenderBindlessSlot {
  kind: RenderBindlessResourceKind;
  index: number;
  resourceId: string;
  generation: number;
  references: number;
}

export interface RenderBindlessTableSnapshot {
  capacities: Record<RenderBindlessResourceKind, number>;
  used: Record<RenderBindlessResourceKind, number>;
  pendingWrites: number;
  revision: number;
}

type BindlessWatcher = (snapshot: RenderBindlessTableSnapshot) => void;

const KINDS: RenderBindlessResourceKind[] = ["sampled_texture", "storage_texture", "sampler", "uniform_buffer", "storage_buffer", "acceleration_structure"];

export class RenderBindlessTableRuntime {
  private readonly slots = new Map<RenderBindlessResourceKind, Array<RenderBindlessSlot | null>>();
  private readonly resources = new Map<string, RenderBindlessSlot>();
  private readonly pending = new Map<string, RenderBindlessResource>();
  private readonly watchers = new Set<BindlessWatcher>();
  private revision = 0;

  constructor(
    private readonly backend: RenderBindlessTableBackend,
    capacities: Partial<Record<RenderBindlessResourceKind, number>>,
  ) {
    for (const kind of KINDS) {
      const capacity = capacities[kind] ?? 0;
      if (!Number.isInteger(capacity) || capacity < 0) throw new Error(`Bindless capacity for ${kind} must be non-negative`);
      this.slots.set(kind, Array.from({ length: capacity }, () => null));
    }
  }

  async acquire(resource: RenderBindlessResource): Promise<RenderBindlessSlot> {
    if (!resource.id) throw new Error("Bindless resource id cannot be empty");
    const key = this.key(resource.kind, resource.id);
    const existing = this.resources.get(key);
    if (existing) {
      existing.references += 1;
      if ((resource.generation ?? existing.generation) !== existing.generation) await this.update(resource);
      return { ...existing };
    }
    const slots = this.slots.get(resource.kind)!;
    const index = slots.findIndex((slot) => slot === null);
    if (index < 0) throw new Error(`Bindless ${resource.kind} table is full`);
    const slot: RenderBindlessSlot = {
      kind: resource.kind,
      index,
      resourceId: resource.id,
      generation: resource.generation ?? 1,
      references: 1,
    };
    slots[index] = slot;
    this.resources.set(key, slot);
    this.pending.set(key, { ...resource });
    this.bump();
    return { ...slot };
  }

  async update(resource: RenderBindlessResource): Promise<void> {
    const key = this.key(resource.kind, resource.id);
    const slot = this.resources.get(key);
    if (!slot) throw new Error(`Bindless resource ${resource.id} is not allocated`);
    slot.generation = resource.generation ?? slot.generation + 1;
    this.pending.set(key, { ...resource, generation: slot.generation });
    this.bump();
  }

  async release(kind: RenderBindlessResourceKind, resourceId: string): Promise<boolean> {
    const key = this.key(kind, resourceId);
    const slot = this.resources.get(key);
    if (!slot) return false;
    slot.references -= 1;
    if (slot.references > 0) {
      this.bump();
      return true;
    }
    this.pending.delete(key);
    await this.backend.clear(kind, slot.index);
    this.slots.get(kind)![slot.index] = null;
    this.resources.delete(key);
    this.bump();
    return true;
  }

  slot(kind: RenderBindlessResourceKind, resourceId: string): RenderBindlessSlot | undefined {
    const slot = this.resources.get(this.key(kind, resourceId));
    return slot ? { ...slot } : undefined;
  }

  async flush(): Promise<number> {
    const writes = [...this.pending.entries()];
    for (const [key, resource] of writes) {
      const slot = this.resources.get(key);
      if (!slot) continue;
      await this.backend.write(slot.kind, slot.index, { ...resource });
      this.pending.delete(key);
    }
    await this.backend.flush?.();
    if (writes.length > 0) this.bump();
    return writes.length;
  }

  snapshot(): RenderBindlessTableSnapshot {
    const capacities = {} as Record<RenderBindlessResourceKind, number>;
    const used = {} as Record<RenderBindlessResourceKind, number>;
    for (const kind of KINDS) {
      const slots = this.slots.get(kind)!;
      capacities[kind] = slots.length;
      used[kind] = slots.filter(Boolean).length;
    }
    return { capacities, used, pendingWrites: this.pending.size, revision: this.revision };
  }

  watch(watcher: BindlessWatcher): () => void {
    this.watchers.add(watcher);
    watcher(this.snapshot());
    return () => this.watchers.delete(watcher);
  }

  async clear(): Promise<void> {
    for (const kind of KINDS) {
      const slots = this.slots.get(kind)!;
      for (let index = 0; index < slots.length; index += 1) {
        if (slots[index]) await this.backend.clear(kind, index);
        slots[index] = null;
      }
    }
    this.resources.clear();
    this.pending.clear();
    await this.backend.flush?.();
    this.bump();
  }

  private key(kind: RenderBindlessResourceKind, id: string): string {
    return `${kind}:${id}`;
  }

  private bump(): void {
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}
