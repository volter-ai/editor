import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotGpuParticleDrawOrder = 'index' | 'lifetime' | 'reverse-lifetime' | 'view-depth';

export interface GodotGpuParticleSortDescriptor {
  readonly particles: GodotRid;
  readonly amount: number;
  readonly drawOrder?: GodotGpuParticleDrawOrder;
  readonly trailsEnabled?: boolean;
  readonly trailSections?: number;
  readonly visibilityMask?: number;
  readonly sortEnabled?: boolean;
  readonly userData?: unknown;
}

export interface GodotGpuParticleSortState {
  readonly particles: GodotRid;
  readonly amount: number;
  readonly drawOrder: GodotGpuParticleDrawOrder;
  readonly trailsEnabled: boolean;
  readonly trailSections: number;
  readonly visibilityMask: number;
  readonly sortEnabled: boolean;
  readonly activeCount: number;
  readonly visibleCount: number;
  readonly sortedIndices: Uint32Array;
  readonly indirectCount: number;
  readonly dirty: boolean;
  readonly lastSortedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotGpuParticleSortInput {
  readonly alive: ArrayLike<number>;
  readonly lifetime: ArrayLike<number>;
  readonly depth: ArrayLike<number>;
  readonly visibility?: ArrayLike<number>;
}

export interface GodotGpuParticleSortUpload {
  readonly frame: number;
  readonly state: GodotGpuParticleSortState;
  readonly indices: Uint32Array;
  readonly indirectCount: number;
}

export interface GodotGpuParticleSortBackend {
  upload(upload: GodotGpuParticleSortUpload): void | Promise<void>;
}

export interface GodotGpuParticleSortFrameResult {
  readonly frame: number;
  readonly sorted: readonly GodotRid[];
  readonly activeParticles: number;
  readonly visibleParticles: number;
  readonly uploadedBytes: number;
  readonly failed: readonly { particles: GodotRid; error: unknown }[];
}

export interface GodotGpuParticleSortSnapshot {
  readonly frame: number;
  readonly systems: readonly GodotGpuParticleSortState[];
  readonly activeParticles: number;
  readonly visibleParticles: number;
  readonly sorts: number;
  readonly uploadedBytes: number;
  readonly generation: number;
  readonly lastFrame: GodotGpuParticleSortFrameResult | null;
}

interface Entry {
  particles: GodotRid;
  amount: number;
  drawOrder: GodotGpuParticleDrawOrder;
  trailsEnabled: boolean;
  trailSections: number;
  visibilityMask: number;
  sortEnabled: boolean;
  input: GodotGpuParticleSortInput | null;
  activeCount: number;
  visibleCount: number;
  sortedIndices: Uint32Array;
  indirectCount: number;
  dirty: boolean;
  lastSortedFrame: number;
  generation: number;
  userData: unknown;
  order: number;
}

function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: GpuParticleSortRuntime.${member} requires integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: GpuParticleSortRuntime.${member} requires bool.`);
  return value;
}

function rid(value: unknown): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: GpuParticleSortRuntime requires RID.');
  godotRidGetId(value);
  return value as GodotRid;
}

function order(value: unknown): GodotGpuParticleDrawOrder {
  if (value !== 'index' && value !== 'lifetime' && value !== 'reverse-lifetime' && value !== 'view-depth') {
    throw new TypeError(`godot-compat: unknown particle draw order ${String(value)}.`);
  }
  return value;
}

function state(entry: Entry): GodotGpuParticleSortState {
  return Object.freeze({
    particles: entry.particles,
    amount: entry.amount,
    drawOrder: entry.drawOrder,
    trailsEnabled: entry.trailsEnabled,
    trailSections: entry.trailSections,
    visibilityMask: entry.visibilityMask,
    sortEnabled: entry.sortEnabled,
    activeCount: entry.activeCount,
    visibleCount: entry.visibleCount,
    sortedIndices: entry.sortedIndices.slice(),
    indirectCount: entry.indirectCount,
    dirty: entry.dirty,
    lastSortedFrame: entry.lastSortedFrame,
    generation: entry.generation,
    userData: entry.userData,
  });
}

export class GodotGpuParticleSortRuntime {
  public readonly __godotClass = 'GpuParticleSortRuntime';
  private readonly backend: GodotGpuParticleSortBackend;
  private readonly entries = new Map<bigint, Entry>();
  private readonly watchers = new Set<(snapshot: GodotGpuParticleSortSnapshot) => void>();
  private frameValue = 0;
  private nextOrder = 0;
  private generationValue = 0;
  private sorts = 0;
  private uploadedBytes = 0;
  private processing = false;
  private lastFrame: GodotGpuParticleSortFrameResult | null = null;

  public constructor(backend: GodotGpuParticleSortBackend) {
    if (typeof backend?.upload !== 'function') throw new TypeError('godot-compat: GpuParticleSortRuntime requires upload backend.');
    this.backend = backend;
    registerGodotObjectIdentity(this, 'GpuParticleSortRuntime');
  }

  public addSystem(value: GodotGpuParticleSortDescriptor): void {
    const particles = rid(value.particles);
    const id = godotRidGetId(particles);
    if (this.entries.has(id)) throw new Error('godot-compat: particle sort system already exists.');
    const amount = integer(value.amount, 'amount', 1);
    this.entries.set(id, {
      particles,
      amount,
      drawOrder: order(value.drawOrder ?? 'index'),
      trailsEnabled: bool(value.trailsEnabled ?? false, 'trails_enabled'),
      trailSections: integer(value.trailSections ?? 1, 'trail_sections', 1),
      visibilityMask: integer(value.visibilityMask ?? 0xffff_ffff, 'visibility_mask', 0, 0xffff_ffff),
      sortEnabled: bool(value.sortEnabled ?? true, 'sort_enabled'),
      input: null,
      activeCount: 0,
      visibleCount: 0,
      sortedIndices: new Uint32Array(),
      indirectCount: 0,
      dirty: true,
      lastSortedFrame: -1,
      generation: 1,
      userData: value.userData ?? null,
      order: this.nextOrder++,
    });
    this.generationValue += 1;
    this.publish();
  }

  public removeSystem(value: unknown): boolean {
    const particles = rid(value);
    const removed = this.entries.delete(godotRidGetId(particles));
    if (removed) {
      this.generationValue += 1;
      this.publish();
    }
    return removed;
  }

  private requireEntry(value: unknown): Entry {
    const particles = rid(value);
    const entry = this.entries.get(godotRidGetId(particles));
    if (entry === undefined) throw new Error('godot-compat: particle sort system does not exist.');
    return entry;
  }

  public setInput(value: unknown, input: GodotGpuParticleSortInput): void {
    const entry = this.requireEntry(value);
    if (input.alive.length < entry.amount || input.lifetime.length < entry.amount || input.depth.length < entry.amount || (input.visibility !== undefined && input.visibility.length < entry.amount)) {
      throw new RangeError('godot-compat: particle sort input arrays are shorter than amount.');
    }
    entry.input = input;
    entry.dirty = true;
    entry.generation += 1;
    this.publish();
  }

  public configure(value: unknown, patch: Partial<Omit<GodotGpuParticleSortDescriptor, 'particles'>>): void {
    const entry = this.requireEntry(value);
    if (patch.amount !== undefined) entry.amount = integer(patch.amount, 'amount', 1);
    if (patch.drawOrder !== undefined) entry.drawOrder = order(patch.drawOrder);
    if (patch.trailsEnabled !== undefined) entry.trailsEnabled = bool(patch.trailsEnabled, 'trails_enabled');
    if (patch.trailSections !== undefined) entry.trailSections = integer(patch.trailSections, 'trail_sections', 1);
    if (patch.visibilityMask !== undefined) entry.visibilityMask = integer(patch.visibilityMask, 'visibility_mask', 0, 0xffff_ffff);
    if (patch.sortEnabled !== undefined) entry.sortEnabled = bool(patch.sortEnabled, 'sort_enabled');
    if (patch.userData !== undefined) entry.userData = patch.userData;
    entry.dirty = true;
    entry.generation += 1;
    this.publish();
  }

  private sorted(entry: Entry, cullMask: number): Uint32Array {
    if (entry.input === null) return new Uint32Array();
    const indices: number[] = [];
    let activeCount = 0;
    for (let index = 0; index < entry.amount; index += 1) {
      if (Number(entry.input.alive[index]) === 0) continue;
      activeCount += 1;
      if ((entry.visibilityMask & cullMask) === 0 || (entry.input.visibility !== undefined && Number(entry.input.visibility[index]) === 0)) continue;
      indices.push(index);
    }
    if (entry.sortEnabled) {
      if (entry.drawOrder === 'lifetime') indices.sort((left, right) => Number(entry.input!.lifetime[left]) - Number(entry.input!.lifetime[right]) || left - right);
      else if (entry.drawOrder === 'reverse-lifetime') indices.sort((left, right) => Number(entry.input!.lifetime[right]) - Number(entry.input!.lifetime[left]) || left - right);
      else if (entry.drawOrder === 'view-depth') indices.sort((left, right) => Number(entry.input!.depth[right]) - Number(entry.input!.depth[left]) || left - right);
    }
    if (entry.trailsEnabled && entry.trailSections > 1) {
      const trailIndices: number[] = [];
      for (const index of indices) for (let section = 0; section < entry.trailSections; section += 1) trailIndices.push(index * entry.trailSections + section);
      entry.activeCount = activeCount;
      entry.visibleCount = indices.length;
      return Uint32Array.from(trailIndices);
    }
    entry.activeCount = activeCount;
    entry.visibleCount = indices.length;
    return Uint32Array.from(indices);
  }

  public async processFrame(frameValue: unknown, cullMaskValue: unknown = 0xffff_ffff): Promise<GodotGpuParticleSortFrameResult> {
    const frame = integer(frameValue, 'frame');
    const cullMask = integer(cullMaskValue, 'cull_mask', 0, 0xffff_ffff);
    if (frame < this.frameValue) throw new RangeError('godot-compat: particle sort frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: particle sort frame already processing.');
    this.frameValue = frame;
    this.processing = true;
    const sorted: GodotRid[] = [];
    const failed: Array<{ particles: GodotRid; error: unknown }> = [];
    let activeParticles = 0;
    let visibleParticles = 0;
    let frameBytes = 0;
    try {
      for (const entry of [...this.entries.values()].sort((left, right) => left.order - right.order)) {
        try {
          entry.sortedIndices = this.sorted(entry, cullMask);
          entry.indirectCount = entry.sortedIndices.length;
          const upload = Object.freeze({ frame, state: state(entry), indices: entry.sortedIndices.slice(), indirectCount: entry.indirectCount });
          await this.backend.upload(upload);
          entry.dirty = false;
          entry.lastSortedFrame = frame;
          entry.generation += 1;
          activeParticles += entry.activeCount;
          visibleParticles += entry.visibleCount;
          frameBytes += entry.sortedIndices.byteLength + 4;
          sorted.push(entry.particles);
          this.sorts += 1;
        } catch (error) {
          failed.push(Object.freeze({ particles: entry.particles, error }));
        }
      }
      this.uploadedBytes += frameBytes;
      this.lastFrame = Object.freeze({
        frame,
        sorted: Object.freeze(sorted),
        activeParticles,
        visibleParticles,
        uploadedBytes: frameBytes,
        failed: Object.freeze(failed),
      });
      this.publish();
      return this.lastFrame;
    } finally {
      this.processing = false;
    }
  }

  public getSnapshot(): GodotGpuParticleSortSnapshot {
    const systems = [...this.entries.values()].map(state);
    return Object.freeze({
      frame: this.frameValue,
      systems: Object.freeze(systems),
      activeParticles: systems.reduce((total, entry) => total + entry.activeCount, 0),
      visibleParticles: systems.reduce((total, entry) => total + entry.visibleCount, 0),
      sorts: this.sorts,
      uploadedBytes: this.uploadedBytes,
      generation: this.generationValue,
      lastFrame: this.lastFrame,
    });
  }

  public watch(watcher: (snapshot: GodotGpuParticleSortSnapshot) => void): () => void {
    this.watchers.add(watcher);
    watcher(this.getSnapshot());
    return () => this.watchers.delete(watcher);
  }

  private publish(): void {
    const value = this.getSnapshot();
    for (const watcher of this.watchers) watcher(value);
  }

  public clear(): void {
    if (this.processing) throw new Error('godot-compat: cannot clear particle sorts during frame.');
    this.entries.clear();
    this.lastFrame = null;
    this.generationValue += 1;
    this.publish();
  }

  public dispose(): void {
    this.clear();
    this.watchers.clear();
  }
}

export function createGodotGpuParticleSortRuntime(backend: GodotGpuParticleSortBackend): GodotGpuParticleSortRuntime {
  return new GodotGpuParticleSortRuntime(backend);
}
