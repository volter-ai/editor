import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export interface GodotMeshLodLevelDescriptor {
  readonly index: number;
  readonly threshold: number;
  readonly mesh: GodotRid;
  readonly memoryCost?: number;
  readonly preloadDistance?: number;
  readonly userData?: unknown;
}

export interface GodotMeshLodInstanceDescriptor {
  readonly rid: GodotRid;
  readonly levels: readonly GodotMeshLodLevelDescriptor[];
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly lodBias?: number;
  readonly hysteresis?: number;
  readonly enabled?: boolean;
  readonly forcedLevel?: number | null;
  readonly userData?: unknown;
}

export interface GodotMeshLodLevelState extends GodotMeshLodLevelDescriptor {
  readonly memoryCost: number;
  readonly preloadDistance: number;
  readonly resident: boolean;
  readonly requested: boolean;
  readonly lastUsedFrame: number;
}

export interface GodotMeshLodInstanceState {
  readonly rid: GodotRid;
  readonly levels: readonly GodotMeshLodLevelState[];
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly lodBias: number;
  readonly hysteresis: number;
  readonly enabled: boolean;
  readonly forcedLevel: number | null;
  readonly selectedLevel: number;
  readonly previousLevel: number;
  readonly transition: number;
  readonly distance: number;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotMeshLodStreamRequest {
  readonly instance: GodotRid;
  readonly level: number;
  readonly mesh: GodotRid;
  readonly priority: number;
  readonly distance: number;
}

export interface GodotMeshLodFrameResult {
  readonly frame: number;
  readonly selections: readonly GodotMeshLodInstanceState[];
  readonly streamRequests: readonly GodotMeshLodStreamRequest[];
  readonly transitions: number;
  readonly fallbackSelections: number;
  readonly residentBytes: number;
}

export interface GodotMeshLodBackend {
  request(request: GodotMeshLodStreamRequest): void | Promise<void>;
  release?(instance: GodotRid, level: number, mesh: GodotRid): void;
}

export interface GodotMeshLodRuntimeSnapshot {
  readonly frame: number;
  readonly instances: number;
  readonly levels: number;
  readonly residentLevels: number;
  readonly requestedLevels: number;
  readonly residentBytes: number;
  readonly memoryBudget: number;
  readonly streamBudget: number;
  readonly transitions: number;
  readonly evictions: number;
  readonly generation: number;
  readonly lastFrame: GodotMeshLodFrameResult | null;
}

interface LevelEntry {
  index: number;
  threshold: number;
  mesh: GodotRid;
  memoryCost: number;
  preloadDistance: number;
  userData: unknown;
  resident: boolean;
  requested: boolean;
  lastUsedFrame: number;
}
interface InstanceEntry {
  rid: GodotRid;
  levels: LevelEntry[];
  position: { x: number; y: number; z: number };
  lodBias: number;
  hysteresis: number;
  enabled: boolean;
  forcedLevel: number | null;
  selectedLevel: number;
  previousLevel: number;
  transition: number;
  distance: number;
  generation: number;
  order: number;
  userData: unknown;
}

function integer(value: unknown, member: string, minimum = 0): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new RangeError(`godot-compat: MeshLodRuntime.${member} requires integer >= ${minimum}.`);
  return result;
}
function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: MeshLodRuntime.${member} requires finite value in [${minimum}, ${maximum}].`);
  return result;
}
function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: MeshLodRuntime.${member} requires bool.`);
  return value;
}
function rid(value: unknown): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: MeshLodRuntime requires RID.');
  godotRidGetId(value); return value as GodotRid;
}
function vector(value: unknown): { x: number; y: number; z: number } {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) throw new TypeError('godot-compat: MeshLodRuntime.position requires Vector3.');
  return Object.freeze({ x: finite(value.x, 'position.x'), y: finite(value.y, 'position.y'), z: finite(value.z, 'position.z') });
}
function distance(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}
function levelState(level: LevelEntry): GodotMeshLodLevelState {
  return Object.freeze({ ...level });
}
function instanceState(entry: InstanceEntry): GodotMeshLodInstanceState {
  return Object.freeze({
    rid: entry.rid, levels: Object.freeze(entry.levels.map(levelState)), position: Object.freeze({ ...entry.position }),
    lodBias: entry.lodBias, hysteresis: entry.hysteresis, enabled: entry.enabled, forcedLevel: entry.forcedLevel,
    selectedLevel: entry.selectedLevel, previousLevel: entry.previousLevel, transition: entry.transition,
    distance: entry.distance, generation: entry.generation, userData: entry.userData,
  });
}

export class GodotMeshLodRuntime {
  public readonly __godotClass = 'MeshLodRuntime';
  private readonly backend: GodotMeshLodBackend;
  private readonly instances = new Map<bigint, InstanceEntry>();
  private readonly watchers = new Set<(snapshot: GodotMeshLodRuntimeSnapshot) => void>();
  private frameValue = 0;
  private memoryBudgetValue = 512 * 1024 * 1024;
  private streamBudgetValue = 8;
  private transitionSpeedValue = 4;
  private nextOrder = 0;
  private transitions = 0;
  private evictions = 0;
  private generationValue = 0;
  private processing = false;
  private lastFrame: GodotMeshLodFrameResult | null = null;

  public constructor(backend: GodotMeshLodBackend) {
    if (typeof backend?.request !== 'function') throw new TypeError('godot-compat: MeshLodRuntime requires stream backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'MeshLodRuntime');
  }

  public addInstance(value: GodotMeshLodInstanceDescriptor): void {
    const instanceRid = rid(value.rid), id = godotRidGetId(instanceRid);
    if (this.instances.has(id)) throw new Error(`godot-compat: mesh LOD instance RID ${id} already exists.`);
    if (!Array.isArray(value.levels) || value.levels.length === 0) throw new TypeError('godot-compat: mesh LOD instance requires nonempty levels.');
    const levels = value.levels.map((level) => ({
      index: integer(level.index, 'level.index'), threshold: finite(level.threshold, 'level.threshold', 0), mesh: rid(level.mesh),
      memoryCost: integer(level.memoryCost ?? 0, 'level.memory_cost'), preloadDistance: finite(level.preloadDistance ?? 0, 'level.preload_distance', 0),
      userData: level.userData ?? null, resident: false, requested: false, lastUsedFrame: -1,
    })).sort((left, right) => left.threshold - right.threshold || left.index - right.index);
    if (new Set(levels.map((level) => level.index)).size !== levels.length) throw new Error('godot-compat: mesh LOD level indices must be unique.');
    const first = levels[0]!; first.resident = true;
    this.instances.set(id, {
      rid: instanceRid, levels, position: vector(value.position), lodBias: finite(value.lodBias ?? 1, 'lod_bias', Number.MIN_VALUE),
      hysteresis: finite(value.hysteresis ?? 0.1, 'hysteresis', 0, 1), enabled: bool(value.enabled ?? true, 'enabled'),
      forcedLevel: value.forcedLevel === undefined || value.forcedLevel === null ? null : integer(value.forcedLevel, 'forced_level'),
      selectedLevel: first.index, previousLevel: first.index, transition: 1, distance: 0,
      generation: 1, order: this.nextOrder++, userData: value.userData ?? null,
    });
    this.generationValue += 1; this.publish();
  }

  public removeInstance(value: unknown): boolean {
    const instanceRid = rid(value), entry = this.instances.get(godotRidGetId(instanceRid));
    if (entry === undefined) return false;
    for (const level of entry.levels) if (level.resident) this.backend.release?.(entry.rid, level.index, level.mesh);
    this.instances.delete(godotRidGetId(instanceRid)); this.generationValue += 1; this.publish(); return true;
  }

  private requireEntry(value: unknown): InstanceEntry {
    const instanceRid = rid(value), entry = this.instances.get(godotRidGetId(instanceRid));
    if (entry === undefined) throw new Error(`godot-compat: mesh LOD instance RID ${godotRidGetId(instanceRid)} does not exist.`);
    return entry;
  }

  public updateInstance(value: unknown, patch: Partial<Omit<GodotMeshLodInstanceDescriptor, 'rid' | 'levels'>>): void {
    const entry = this.requireEntry(value);
    if (patch.position !== undefined) entry.position = vector(patch.position);
    if (patch.lodBias !== undefined) entry.lodBias = finite(patch.lodBias, 'lod_bias', Number.MIN_VALUE);
    if (patch.hysteresis !== undefined) entry.hysteresis = finite(patch.hysteresis, 'hysteresis', 0, 1);
    if (patch.enabled !== undefined) entry.enabled = bool(patch.enabled, 'enabled');
    if (patch.forcedLevel !== undefined) {
      entry.forcedLevel = patch.forcedLevel === null ? null : integer(patch.forcedLevel, 'forced_level');
      if (entry.forcedLevel !== null && !entry.levels.some((level) => level.index === entry.forcedLevel)) throw new Error('godot-compat: forced LOD level does not exist.');
    }
    if (patch.userData !== undefined) entry.userData = patch.userData;
    entry.generation += 1; this.publish();
  }

  public setLevelResident(value: unknown, levelIndexValue: unknown, residentValue: unknown): void {
    const entry = this.requireEntry(value), index = integer(levelIndexValue, 'level_index');
    const level = entry.levels.find((candidate) => candidate.index === index);
    if (level === undefined) throw new Error(`godot-compat: mesh LOD level ${index} does not exist.`);
    const resident = bool(residentValue, 'resident');
    if (resident === level.resident) return;
    level.resident = resident; level.requested = false;
    if (!resident) this.backend.release?.(entry.rid, level.index, level.mesh);
    entry.generation += 1; this.enforceBudget(); this.publish();
  }

  private desiredLevel(entry: InstanceEntry, cameraDistance: number): LevelEntry {
    if (entry.forcedLevel !== null) return entry.levels.find((level) => level.index === entry.forcedLevel)!;
    const biasedDistance = cameraDistance / entry.lodBias;
    let desired = entry.levels[0]!;
    for (const level of entry.levels) {
      const current = level.index === entry.selectedLevel;
      const threshold = level.threshold * (current ? 1 - entry.hysteresis : 1 + entry.hysteresis);
      if (biasedDistance < threshold) break;
      desired = level;
    }
    return desired;
  }

  private residentFallback(entry: InstanceEntry, desired: LevelEntry): LevelEntry {
    if (desired.resident) return desired;
    const desiredPosition = entry.levels.indexOf(desired);
    for (let offset = 1; offset < entry.levels.length; offset += 1) {
      const lowerDetail = entry.levels[desiredPosition + offset]; if (lowerDetail?.resident) return lowerDetail;
      const higherDetail = entry.levels[desiredPosition - offset]; if (higherDetail?.resident) return higherDetail;
    }
    return entry.levels[0]!;
  }

  public async processFrame(cameraPositionValue: unknown, frameValue: unknown, deltaValue: unknown): Promise<GodotMeshLodFrameResult> {
    const camera = vector(cameraPositionValue), frame = integer(frameValue, 'frame'), delta = finite(deltaValue, 'delta', 0);
    if (frame < this.frameValue) throw new RangeError('godot-compat: mesh LOD frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: mesh LOD update already in progress.');
    this.frameValue = frame; this.processing = true;
    const requests: GodotMeshLodStreamRequest[] = [], selections: GodotMeshLodInstanceState[] = [];
    let fallbackSelections = 0, frameTransitions = 0;
    try {
      const candidates = [...this.instances.values()].filter((entry) => entry.enabled).map((entry) => {
        entry.distance = distance(entry.position, camera); const desired = this.desiredLevel(entry, entry.distance);
        return { entry, desired };
      }).sort((left, right) => left.entry.distance - right.entry.distance || left.entry.order - right.entry.order);
      for (const { entry, desired } of candidates) {
        if (!desired.resident && !desired.requested) {
          requests.push(Object.freeze({ instance: entry.rid, level: desired.index, mesh: desired.mesh, priority: entry.levels.length - desired.index, distance: entry.distance }));
        }
        for (const level of entry.levels) {
          if (level.resident || level.requested) continue;
          if (entry.distance / entry.lodBias <= level.threshold + level.preloadDistance) {
            requests.push(Object.freeze({ instance: entry.rid, level: level.index, mesh: level.mesh, priority: Math.max(0, entry.levels.length - level.index - 1), distance: entry.distance }));
          }
        }
        const selected = this.residentFallback(entry, desired);
        if (selected !== desired) fallbackSelections += 1;
        if (selected.index !== entry.selectedLevel) {
          entry.previousLevel = entry.selectedLevel; entry.selectedLevel = selected.index; entry.transition = 0;
          entry.generation += 1; this.transitions += 1; frameTransitions += 1;
        }
        entry.transition = Math.min(1, entry.transition + delta * this.transitionSpeedValue);
        selected.lastUsedFrame = frame; selections.push(instanceState(entry));
      }
      const uniqueRequests = [...new Map(requests.map((request) => [`${godotRidGetId(request.instance)}:${request.level}`, request])).values()]
        .sort((left, right) => right.priority - left.priority || left.distance - right.distance).slice(0, this.streamBudgetValue);
      for (const request of uniqueRequests) {
        const entry = this.requireEntry(request.instance), level = entry.levels.find((candidate) => candidate.index === request.level)!;
        level.requested = true;
        try { await this.backend.request(request); } catch { level.requested = false; }
      }
      this.enforceBudget();
      this.lastFrame = Object.freeze({
        frame, selections: Object.freeze(selections), streamRequests: Object.freeze(uniqueRequests),
        transitions: frameTransitions, fallbackSelections, residentBytes: this.residentBytes(),
      });
      this.publish(); return this.lastFrame;
    } finally { this.processing = false; }
  }

  private residentBytes(): number {
    let bytes = 0; for (const entry of this.instances.values()) for (const level of entry.levels) if (level.resident) bytes += level.memoryCost; return bytes;
  }

  private enforceBudget(): void {
    let retained = this.residentBytes(); if (retained <= this.memoryBudgetValue) return;
    const selected = new Set([...this.instances.values()].map((entry) => `${godotRidGetId(entry.rid)}:${entry.selectedLevel}`));
    const candidates = [...this.instances.values()].flatMap((entry) => entry.levels.map((level) => ({ entry, level })))
      .filter(({ entry, level }) => level.resident && !selected.has(`${godotRidGetId(entry.rid)}:${level.index}`))
      .sort((left, right) => left.level.lastUsedFrame - right.level.lastUsedFrame || right.level.memoryCost - left.level.memoryCost);
    for (const { entry, level } of candidates) {
      if (retained <= this.memoryBudgetValue) break;
      level.resident = false; retained -= level.memoryCost; this.backend.release?.(entry.rid, level.index, level.mesh); this.evictions += 1;
    }
  }

  public setMemoryBudget(value: unknown): void { this.memoryBudgetValue = integer(value, 'memory_budget', 1); this.enforceBudget(); this.publish(); }
  public setStreamBudget(value: unknown): void { this.streamBudgetValue = integer(value, 'stream_budget', 1); }
  public setTransitionSpeed(value: unknown): void { this.transitionSpeedValue = finite(value, 'transition_speed', Number.MIN_VALUE); }
  public getInstance(value: unknown): GodotMeshLodInstanceState | null {
    const instanceRid = rid(value), entry = this.instances.get(godotRidGetId(instanceRid)); return entry === undefined ? null : instanceState(entry);
  }
  public getSnapshot(): GodotMeshLodRuntimeSnapshot {
    const entries = [...this.instances.values()], levels = entries.flatMap((entry) => entry.levels);
    return Object.freeze({
      frame: this.frameValue, instances: entries.length, levels: levels.length,
      residentLevels: levels.filter((level) => level.resident).length, requestedLevels: levels.filter((level) => level.requested).length,
      residentBytes: this.residentBytes(), memoryBudget: this.memoryBudgetValue, streamBudget: this.streamBudgetValue,
      transitions: this.transitions, evictions: this.evictions, generation: this.generationValue, lastFrame: this.lastFrame,
    });
  }
  public watch(watcher: (snapshot: GodotMeshLodRuntimeSnapshot) => void): () => void {
    this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher);
  }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void {
    if (this.processing) throw new Error('godot-compat: cannot clear mesh LOD runtime during frame.');
    for (const entry of this.instances.values()) for (const level of entry.levels) if (level.resident) this.backend.release?.(entry.rid, level.index, level.mesh);
    this.instances.clear(); this.lastFrame = null; this.generationValue += 1; this.publish();
  }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotMeshLodRuntime(backend: GodotMeshLodBackend): GodotMeshLodRuntime {
  return new GodotMeshLodRuntime(backend);
}
