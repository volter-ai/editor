import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotRenderingResourceKind =
  | 'texture' | 'buffer' | 'shader' | 'material' | 'mesh' | 'pipeline'
  | 'uniform-set' | 'framebuffer' | 'instance' | 'skeleton' | 'light' | 'environment';
export type GodotRenderingResourceState = 'alive' | 'dirty' | 'retiring' | 'destroyed';

export interface GodotRenderingResourceDescriptor {
  readonly rid: GodotRid;
  readonly kind: GodotRenderingResourceKind;
  readonly name?: string;
  readonly dependencies?: readonly GodotRid[];
  readonly persistent?: boolean;
  readonly userData?: unknown;
}

export interface GodotRenderingResourceSnapshot {
  readonly rid: GodotRid;
  readonly kind: GodotRenderingResourceKind;
  readonly name: string;
  readonly state: GodotRenderingResourceState;
  readonly dependencies: readonly GodotRid[];
  readonly dependents: readonly GodotRid[];
  readonly persistent: boolean;
  readonly dirtyReasons: readonly string[];
  readonly createdFrame: number;
  readonly lastUsedFrame: number;
  readonly retireFrame: number | null;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotRenderingResourceInvalidation {
  readonly source: GodotRid;
  readonly affected: readonly GodotRid[];
  readonly reason: string;
  readonly generation: number;
}

export interface GodotRenderingResourceDependencySnapshot {
  readonly frame: number;
  readonly resources: readonly GodotRenderingResourceSnapshot[];
  readonly alive: number;
  readonly dirty: number;
  readonly retiring: number;
  readonly destroyed: number;
  readonly invalidations: number;
  readonly retirements: number;
  readonly generation: number;
  readonly lastInvalidation: GodotRenderingResourceInvalidation | null;
}

export interface GodotRenderingResourceDependencyBackend {
  destroy(resource: GodotRenderingResourceSnapshot): void;
  invalidated?(resource: GodotRenderingResourceSnapshot, reason: string): void;
}

interface ResourceEntry {
  rid: GodotRid;
  kind: GodotRenderingResourceKind;
  name: string;
  state: GodotRenderingResourceState;
  dependencies: Set<bigint>;
  dependents: Set<bigint>;
  persistent: boolean;
  dirtyReasons: Set<string>;
  createdFrame: number;
  lastUsedFrame: number;
  retireFrame: number | null;
  generation: number;
  userData: unknown;
  order: number;
}

const KINDS = new Set<GodotRenderingResourceKind>([
  'texture', 'buffer', 'shader', 'material', 'mesh', 'pipeline', 'uniform-set',
  'framebuffer', 'instance', 'skeleton', 'light', 'environment',
]);

function integer(value: unknown, member: string, minimum = 0): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new RangeError(`godot-compat: RenderingResourceDependency.${member} requires integer >= ${minimum}.`);
  return result;
}
function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: RenderingResourceDependency.${member} requires bool.`);
  return value;
}
function name(value: unknown, member: string, allowEmpty = false): string {
  const result = String(value); if (!allowEmpty && result.length === 0) throw new RangeError(`godot-compat: RenderingResourceDependency.${member} requires nonempty StringName.`); return result;
}
function rid(value: unknown): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: RenderingResourceDependency requires RID.');
  godotRidGetId(value); return value as GodotRid;
}
function kind(value: unknown): GodotRenderingResourceKind {
  if (!KINDS.has(value as GodotRenderingResourceKind)) throw new TypeError(`godot-compat: unknown rendering resource kind ${String(value)}.`);
  return value as GodotRenderingResourceKind;
}

export class GodotRenderingResourceDependencyRuntime {
  public readonly __godotClass = 'RenderingResourceDependencyRuntime';
  private readonly backend: GodotRenderingResourceDependencyBackend;
  private readonly resources = new Map<bigint, ResourceEntry>();
  private readonly watchers = new Set<(snapshot: GodotRenderingResourceDependencySnapshot) => void>();
  private frameValue = 0;
  private retirementDelayValue = 3;
  private nextOrder = 0;
  private generationValue = 0;
  private invalidations = 0;
  private retirements = 0;
  private destroyed = 0;
  private lastInvalidation: GodotRenderingResourceInvalidation | null = null;

  public constructor(backend: GodotRenderingResourceDependencyBackend) {
    if (typeof backend?.destroy !== 'function') throw new TypeError('godot-compat: RenderingResourceDependency requires destroy backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'RenderingResourceDependencyRuntime');
  }

  public add(value: GodotRenderingResourceDescriptor): void {
    const resourceRid = rid(value.rid), id = godotRidGetId(resourceRid);
    if (this.resources.has(id)) throw new Error(`godot-compat: rendering resource RID ${id} already exists.`);
    const dependencies = new Set((value.dependencies ?? []).map((dependency) => godotRidGetId(rid(dependency))));
    for (const dependency of dependencies) {
      if (!this.resources.has(dependency)) throw new Error(`godot-compat: rendering resource dependency RID ${dependency} does not exist.`);
      if (dependency === id) throw new Error('godot-compat: rendering resource cannot depend on itself.');
    }
    const entry: ResourceEntry = {
      rid: resourceRid, kind: kind(value.kind), name: name(value.name ?? '', 'name', true), state: 'alive',
      dependencies, dependents: new Set(), persistent: bool(value.persistent ?? false, 'persistent'),
      dirtyReasons: new Set(), createdFrame: this.frameValue, lastUsedFrame: this.frameValue,
      retireFrame: null, generation: 1, userData: value.userData ?? null, order: this.nextOrder++,
    };
    this.resources.set(id, entry);
    for (const dependency of dependencies) this.resources.get(dependency)!.dependents.add(id);
    this.assertAcyclic(); this.generationValue += 1; this.publish();
  }

  private requireEntry(value: unknown): ResourceEntry {
    const resourceRid = rid(value), id = godotRidGetId(resourceRid), entry = this.resources.get(id);
    if (entry === undefined) throw new Error(`godot-compat: rendering resource RID ${id} does not exist.`); return entry;
  }

  public updateDependencies(value: unknown, dependenciesValue: readonly GodotRid[]): void {
    const entry = this.requireEntry(value);
    if (!Array.isArray(dependenciesValue)) throw new TypeError('godot-compat: rendering dependencies require RID array.');
    const next = new Set(dependenciesValue.map((dependency) => godotRidGetId(rid(dependency))));
    const id = godotRidGetId(entry.rid);
    if (next.has(id)) throw new Error('godot-compat: rendering resource cannot depend on itself.');
    for (const dependency of next) if (!this.resources.has(dependency)) throw new Error(`godot-compat: rendering resource dependency RID ${dependency} does not exist.`);
    const previous = new Set(entry.dependencies);
    for (const dependency of previous) this.resources.get(dependency)?.dependents.delete(id);
    entry.dependencies = next;
    for (const dependency of next) this.resources.get(dependency)!.dependents.add(id);
    try { this.assertAcyclic(); } catch (error) {
      for (const dependency of next) this.resources.get(dependency)?.dependents.delete(id);
      entry.dependencies = previous; for (const dependency of previous) this.resources.get(dependency)?.dependents.add(id); throw error;
    }
    entry.generation += 1; this.invalidate(entry.rid, 'dependencies'); this.generationValue += 1;
  }

  private assertAcyclic(): void {
    const visiting = new Set<bigint>(), visited = new Set<bigint>();
    const visit = (id: bigint) => {
      if (visiting.has(id)) throw new Error(`godot-compat: rendering resource dependency cycle contains RID ${id}.`);
      if (visited.has(id)) return; visiting.add(id);
      for (const dependency of this.resources.get(id)?.dependencies ?? []) visit(dependency);
      visiting.delete(id); visited.add(id);
    };
    for (const id of this.resources.keys()) visit(id);
  }

  public invalidate(value: unknown, reasonValue: unknown = 'changed'): GodotRenderingResourceInvalidation {
    const source = this.requireEntry(value), reason = name(reasonValue, 'reason');
    const affected: GodotRid[] = [], queue = [source], visited = new Set<bigint>();
    while (queue.length > 0) {
      const entry = queue.shift()!, id = godotRidGetId(entry.rid);
      if (visited.has(id) || entry.state === 'destroyed') continue; visited.add(id);
      entry.state = 'dirty'; entry.dirtyReasons.add(reason); entry.generation += 1; affected.push(entry.rid);
      this.backend.invalidated?.(this.resourceSnapshot(entry), reason);
      for (const dependent of entry.dependents) {
        const dependentEntry = this.resources.get(dependent); if (dependentEntry !== undefined) queue.push(dependentEntry);
      }
    }
    this.invalidations += 1;
    this.lastInvalidation = Object.freeze({ source: source.rid, affected: Object.freeze(affected), reason, generation: this.generationValue });
    this.publish(); return this.lastInvalidation;
  }

  public markClean(value: unknown): void {
    const entry = this.requireEntry(value);
    if (entry.state !== 'dirty') return;
    entry.state = 'alive'; entry.dirtyReasons.clear(); entry.generation += 1; this.publish();
  }

  public touch(value: unknown): void {
    const entry = this.requireEntry(value);
    if (entry.state === 'destroyed') throw new Error('godot-compat: cannot touch destroyed rendering resource.');
    entry.lastUsedFrame = this.frameValue;
    if (entry.state === 'retiring') { entry.state = entry.dirtyReasons.size > 0 ? 'dirty' : 'alive'; entry.retireFrame = null; }
  }

  public retire(value: unknown, force = false): void {
    const entry = this.requireEntry(value);
    if (entry.persistent && !force) throw new Error('godot-compat: persistent rendering resource requires forced retirement.');
    if (entry.dependents.size > 0 && !force) throw new Error('godot-compat: rendering resource has live dependents.');
    entry.state = 'retiring'; entry.retireFrame = this.frameValue + this.retirementDelayValue; entry.generation += 1;
    if (force) for (const dependent of [...entry.dependents]) this.retire(this.resources.get(dependent)!.rid, true);
    this.publish();
  }

  public cancelRetirement(value: unknown): void {
    const entry = this.requireEntry(value); if (entry.state !== 'retiring') return;
    entry.state = entry.dirtyReasons.size > 0 ? 'dirty' : 'alive'; entry.retireFrame = null; entry.generation += 1; this.publish();
  }

  public beginFrame(frameValue: unknown): void {
    const frame = integer(frameValue, 'frame');
    if (frame < this.frameValue) throw new RangeError('godot-compat: rendering resource frame cannot move backwards.');
    this.frameValue = frame; this.processRetirements(); this.publish();
  }

  private processRetirements(): void {
    const due = [...this.resources.values()].filter((entry) => entry.state === 'retiring' && entry.retireFrame !== null && entry.retireFrame <= this.frameValue)
      .sort((left, right) => this.depth(right) - this.depth(left) || right.order - left.order);
    for (const entry of due) {
      if (entry.dependents.size > 0) continue;
      this.destroyEntry(entry);
    }
  }

  private depth(entry: ResourceEntry, visited = new Set<bigint>()): number {
    const id = godotRidGetId(entry.rid); if (visited.has(id)) return 0; visited.add(id);
    let maximum = 0; for (const dependency of entry.dependencies) { const target = this.resources.get(dependency); if (target !== undefined) maximum = Math.max(maximum, 1 + this.depth(target, visited)); }
    return maximum;
  }

  private destroyEntry(entry: ResourceEntry): void {
    const resource = this.resourceSnapshot(entry); this.backend.destroy(resource);
    const id = godotRidGetId(entry.rid);
    for (const dependency of entry.dependencies) this.resources.get(dependency)?.dependents.delete(id);
    entry.state = 'destroyed'; entry.dependencies.clear(); entry.dependents.clear(); entry.retireFrame = null;
    this.resources.delete(id); this.retirements += 1; this.destroyed += 1; this.generationValue += 1;
  }

  public retireUnused(frameAgeValue: unknown): number {
    const cutoff = this.frameValue - integer(frameAgeValue, 'frame_age'); let count = 0;
    for (const entry of this.resources.values()) {
      if (entry.persistent || entry.state === 'retiring' || entry.dependents.size > 0 || entry.lastUsedFrame > cutoff) continue;
      this.retire(entry.rid); count += 1;
    }
    return count;
  }

  public setRetirementDelay(value: unknown): void { this.retirementDelayValue = integer(value, 'retirement_delay'); }
  public get(value: unknown): GodotRenderingResourceSnapshot | null {
    const resourceRid = rid(value), entry = this.resources.get(godotRidGetId(resourceRid)); return entry === undefined ? null : this.resourceSnapshot(entry);
  }
  private resourceSnapshot(entry: ResourceEntry): GodotRenderingResourceSnapshot {
    const resolve = (ids: Set<bigint>) => Object.freeze([...ids].map((id) => this.resources.get(id)?.rid ?? Object.freeze({ id })));
    return Object.freeze({
      rid: entry.rid, kind: entry.kind, name: entry.name, state: entry.state,
      dependencies: resolve(entry.dependencies), dependents: resolve(entry.dependents), persistent: entry.persistent,
      dirtyReasons: Object.freeze([...entry.dirtyReasons]), createdFrame: entry.createdFrame,
      lastUsedFrame: entry.lastUsedFrame, retireFrame: entry.retireFrame, generation: entry.generation, userData: entry.userData,
    });
  }
  public getSnapshot(): GodotRenderingResourceDependencySnapshot {
    const resources = [...this.resources.values()].sort((left, right) => left.order - right.order).map((entry) => this.resourceSnapshot(entry));
    return Object.freeze({
      frame: this.frameValue, resources: Object.freeze(resources), alive: resources.filter((entry) => entry.state === 'alive').length,
      dirty: resources.filter((entry) => entry.state === 'dirty').length, retiring: resources.filter((entry) => entry.state === 'retiring').length,
      destroyed: this.destroyed, invalidations: this.invalidations, retirements: this.retirements,
      generation: this.generationValue, lastInvalidation: this.lastInvalidation,
    });
  }
  public watch(watcher: (snapshot: GodotRenderingResourceDependencySnapshot) => void): () => void {
    this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher);
  }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void {
    const entries = [...this.resources.values()].sort((left, right) => this.depth(right) - this.depth(left));
    for (const entry of entries) if (this.resources.has(godotRidGetId(entry.rid))) this.destroyEntry(entry);
    this.lastInvalidation = null; this.publish();
  }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotRenderingResourceDependencyRuntime(
  backend: GodotRenderingResourceDependencyBackend,
): GodotRenderingResourceDependencyRuntime {
  return new GodotRenderingResourceDependencyRuntime(backend);
}
