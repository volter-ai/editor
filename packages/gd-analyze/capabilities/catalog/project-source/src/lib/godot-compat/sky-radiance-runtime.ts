import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotSkyRadianceMode = 'automatic' | 'quality' | 'realtime';
export interface GodotSkyRadianceDescriptor {
  readonly rid: GodotRid;
  readonly material: GodotRid | null;
  readonly panorama?: GodotRid | null;
  readonly size?: number;
  readonly mode?: GodotSkyRadianceMode;
  readonly roughnessLayers?: number;
  readonly energyMultiplier?: number;
  readonly orientation?: unknown;
  readonly priority?: number;
  readonly enabled?: boolean;
  readonly userData?: unknown;
}
export interface GodotSkyRadianceState {
  readonly rid: GodotRid;
  readonly material: GodotRid | null;
  readonly panorama: GodotRid | null;
  readonly size: number;
  readonly mode: GodotSkyRadianceMode;
  readonly roughnessLayers: number;
  readonly energyMultiplier: number;
  readonly orientation: unknown;
  readonly priority: number;
  readonly enabled: boolean;
  readonly radiance: GodotRid | null;
  readonly capturedFaces: number;
  readonly filteredLayers: number;
  readonly dirty: boolean;
  readonly ready: boolean;
  readonly lastUpdatedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}
export interface GodotSkyRadianceCaptureContext { readonly frame: number; readonly sky: GodotSkyRadianceState; readonly face: number }
export interface GodotSkyRadianceFilterContext { readonly frame: number; readonly sky: GodotSkyRadianceState; readonly layer: number; readonly roughness: number }
export interface GodotSkyRadianceBackend {
  allocate(sky: GodotSkyRadianceState): GodotRid | Promise<GodotRid>;
  free(radiance: GodotRid): void;
  captureFace(context: GodotSkyRadianceCaptureContext): void | Promise<void>;
  filterLayer(context: GodotSkyRadianceFilterContext): void | Promise<void>;
}
export interface GodotSkyRadianceFrameResult {
  readonly frame: number;
  readonly capturedFaces: number;
  readonly filteredLayers: number;
  readonly completed: readonly GodotRid[];
  readonly deferred: readonly GodotRid[];
  readonly failed: readonly { rid: GodotRid; error: unknown }[];
}
export interface GodotSkyRadianceRuntimeSnapshot {
  readonly frame: number;
  readonly skies: readonly GodotSkyRadianceState[];
  readonly readySkies: number;
  readonly dirtySkies: number;
  readonly faceBudget: number;
  readonly filterBudget: number;
  readonly captures: number;
  readonly filters: number;
  readonly generation: number;
  readonly lastFrame: GodotSkyRadianceFrameResult | null;
}
interface SkyEntry {
  rid: GodotRid; material: GodotRid | null; panorama: GodotRid | null; size: number; mode: GodotSkyRadianceMode;
  roughnessLayers: number; energyMultiplier: number; orientation: unknown; priority: number; enabled: boolean;
  radiance: GodotRid | null; capturedFaces: number; filteredLayers: number; dirty: boolean; ready: boolean;
  lastUpdatedFrame: number; generation: number; userData: unknown; order: number;
}
function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: SkyRadianceRuntime.${member} requires integer in [${minimum}, ${maximum}].`); return result; }
function finite(value: unknown, member: string, minimum = -Infinity): number { const result = Number(value); if (!Number.isFinite(result) || result < minimum) throw new RangeError(`godot-compat: SkyRadianceRuntime.${member} requires finite value >= ${minimum}.`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: SkyRadianceRuntime.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: SkyRadianceRuntime requires RID.'); godotRidGetId(value); return value as GodotRid; }
function optionalRid(value: unknown): GodotRid | null { return value === null || value === undefined ? null : rid(value); }
function mode(value: unknown): GodotSkyRadianceMode { if (value !== 'automatic' && value !== 'quality' && value !== 'realtime') throw new TypeError('godot-compat: sky radiance mode requires automatic, quality, or realtime.'); return value; }
function state(entry: SkyEntry): GodotSkyRadianceState { return Object.freeze({ ...entry }); }

export class GodotSkyRadianceRuntime {
  public readonly __godotClass = 'SkyRadianceRuntime';
  private readonly backend: GodotSkyRadianceBackend;
  private readonly skies = new Map<bigint, SkyEntry>();
  private readonly watchers = new Set<(snapshot: GodotSkyRadianceRuntimeSnapshot) => void>();
  private frameValue = 0; private faceBudgetValue = 6; private filterBudgetValue = 4;
  private nextOrder = 0; private generationValue = 0; private captures = 0; private filters = 0;
  private processing = false; private lastFrame: GodotSkyRadianceFrameResult | null = null;
  public constructor(backend: GodotSkyRadianceBackend) {
    if (typeof backend?.allocate !== 'function' || typeof backend?.free !== 'function' || typeof backend?.captureFace !== 'function' || typeof backend?.filterLayer !== 'function') throw new TypeError('godot-compat: SkyRadianceRuntime requires allocation, capture, and filter backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'SkyRadianceRuntime');
  }
  public addSky(value: GodotSkyRadianceDescriptor): void {
    const skyRid = rid(value.rid), id = godotRidGetId(skyRid); if (this.skies.has(id)) throw new Error(`godot-compat: sky RID ${id} already exists.`);
    this.skies.set(id, { rid: skyRid, material: optionalRid(value.material), panorama: optionalRid(value.panorama), size: integer(value.size ?? 256, 'size', 32, 4096),
      mode: mode(value.mode ?? 'automatic'), roughnessLayers: integer(value.roughnessLayers ?? 8, 'roughness_layers', 1, 32), energyMultiplier: finite(value.energyMultiplier ?? 1, 'energy_multiplier', 0),
      orientation: value.orientation ?? null, priority: integer(value.priority ?? 0, 'priority'), enabled: bool(value.enabled ?? true, 'enabled'), radiance: null,
      capturedFaces: 0, filteredLayers: 0, dirty: true, ready: false, lastUpdatedFrame: -1, generation: 1, userData: value.userData ?? null, order: this.nextOrder++ });
    this.generationValue += 1; this.publish();
  }
  public removeSky(value: unknown): boolean { const skyRid = rid(value), entry = this.skies.get(godotRidGetId(skyRid)); if (entry === undefined) return false; if (entry.radiance !== null) this.backend.free(entry.radiance); this.skies.delete(godotRidGetId(skyRid)); this.generationValue += 1; this.publish(); return true; }
  private requireSky(value: unknown): SkyEntry { const skyRid = rid(value), entry = this.skies.get(godotRidGetId(skyRid)); if (entry === undefined) throw new Error('godot-compat: sky does not exist.'); return entry; }
  public updateSky(value: unknown, patch: Partial<Omit<GodotSkyRadianceDescriptor, 'rid'>>): void {
    const entry = this.requireSky(value); let reallocates = false;
    if (patch.material !== undefined) entry.material = optionalRid(patch.material); if (patch.panorama !== undefined) entry.panorama = optionalRid(patch.panorama);
    if (patch.size !== undefined) { entry.size = integer(patch.size, 'size', 32, 4096); reallocates = true; }
    if (patch.mode !== undefined) entry.mode = mode(patch.mode); if (patch.roughnessLayers !== undefined) { entry.roughnessLayers = integer(patch.roughnessLayers, 'roughness_layers', 1, 32); reallocates = true; }
    if (patch.energyMultiplier !== undefined) entry.energyMultiplier = finite(patch.energyMultiplier, 'energy_multiplier', 0);
    if (patch.orientation !== undefined) entry.orientation = patch.orientation; if (patch.priority !== undefined) entry.priority = integer(patch.priority, 'priority');
    if (patch.enabled !== undefined) entry.enabled = bool(patch.enabled, 'enabled'); if (patch.userData !== undefined) entry.userData = patch.userData;
    if (reallocates && entry.radiance !== null) { this.backend.free(entry.radiance); entry.radiance = null; }
    this.invalidateEntry(entry); this.generationValue += 1; this.publish();
  }
  private invalidateEntry(entry: SkyEntry): void { entry.capturedFaces = 0; entry.filteredLayers = 0; entry.dirty = true; entry.ready = false; entry.generation += 1; }
  public invalidate(value: unknown): void { this.invalidateEntry(this.requireSky(value)); this.publish(); }
  public invalidateMaterial(value: unknown): number { const material = rid(value), id = godotRidGetId(material); let count = 0; for (const entry of this.skies.values()) if (entry.material !== null && godotRidGetId(entry.material) === id) { this.invalidateEntry(entry); count += 1; } this.publish(); return count; }
  public invalidatePanorama(value: unknown): number { const panorama = rid(value), id = godotRidGetId(panorama); let count = 0; for (const entry of this.skies.values()) if (entry.panorama !== null && godotRidGetId(entry.panorama) === id) { this.invalidateEntry(entry); count += 1; } this.publish(); return count; }
  private async ensureRadiance(entry: SkyEntry): Promise<void> { if (entry.radiance === null) entry.radiance = rid(await this.backend.allocate(state(entry))); }

  public async processFrame(frameValue: unknown): Promise<GodotSkyRadianceFrameResult> {
    const frame = integer(frameValue, 'frame'); if (frame < this.frameValue) throw new RangeError('godot-compat: sky radiance frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: sky radiance update already in progress.');
    this.frameValue = frame; this.processing = true; let faceBudget = this.faceBudgetValue, filterBudget = this.filterBudgetValue, capturedFaces = 0, filteredLayers = 0;
    const completed: GodotRid[] = [], failed: Array<{ rid: GodotRid; error: unknown }> = [];
    try {
      const queue = [...this.skies.values()].filter((entry) => entry.enabled && (entry.dirty || entry.mode === 'realtime')).sort((left, right) => right.priority - left.priority || left.lastUpdatedFrame - right.lastUpdatedFrame || left.order - right.order);
      for (const entry of queue) {
        if (entry.mode === 'realtime' && entry.ready) this.invalidateEntry(entry);
        try {
          await this.ensureRadiance(entry);
          while (entry.capturedFaces < 6 && faceBudget > 0) { await this.backend.captureFace(Object.freeze({ frame, sky: state(entry), face: entry.capturedFaces })); entry.capturedFaces += 1; faceBudget -= 1; capturedFaces += 1; this.captures += 1; }
          while (entry.capturedFaces === 6 && entry.filteredLayers < entry.roughnessLayers && filterBudget > 0) {
            const roughness = entry.roughnessLayers <= 1 ? 0 : entry.filteredLayers / (entry.roughnessLayers - 1);
            await this.backend.filterLayer(Object.freeze({ frame, sky: state(entry), layer: entry.filteredLayers, roughness })); entry.filteredLayers += 1; filterBudget -= 1; filteredLayers += 1; this.filters += 1;
          }
          if (entry.capturedFaces === 6 && entry.filteredLayers === entry.roughnessLayers) { entry.dirty = false; entry.ready = true; entry.lastUpdatedFrame = frame; entry.generation += 1; completed.push(entry.rid); }
        } catch (error) { failed.push(Object.freeze({ rid: entry.rid, error })); }
        if (faceBudget === 0 && filterBudget === 0) break;
      }
      const deferred = queue.filter((entry) => entry.dirty).map((entry) => entry.rid);
      this.lastFrame = Object.freeze({ frame, capturedFaces, filteredLayers, completed: Object.freeze(completed), deferred: Object.freeze(deferred), failed: Object.freeze(failed) }); this.publish(); return this.lastFrame;
    } finally { this.processing = false; }
  }
  public setBudgets(faceBudgetValue: unknown, filterBudgetValue: unknown): void { this.faceBudgetValue = integer(faceBudgetValue, 'face_budget', 1); this.filterBudgetValue = integer(filterBudgetValue, 'filter_budget', 1); }
  public getRadiance(value: unknown): GodotRid | null { const entry = this.requireSky(value); return entry.ready ? entry.radiance : null; }
  public getSky(value: unknown): GodotSkyRadianceState | null { const skyRid = rid(value), entry = this.skies.get(godotRidGetId(skyRid)); return entry === undefined ? null : state(entry); }
  public getSnapshot(): GodotSkyRadianceRuntimeSnapshot { const skies = [...this.skies.values()].map(state); return Object.freeze({ frame: this.frameValue, skies: Object.freeze(skies), readySkies: skies.filter((entry) => entry.ready).length, dirtySkies: skies.filter((entry) => entry.dirty).length, faceBudget: this.faceBudgetValue, filterBudget: this.filterBudgetValue, captures: this.captures, filters: this.filters, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotSkyRadianceRuntimeSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear sky radiance during update.'); for (const entry of this.skies.values()) if (entry.radiance !== null) this.backend.free(entry.radiance); this.skies.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotSkyRadianceRuntime(backend: GodotSkyRadianceBackend): GodotSkyRadianceRuntime { return new GodotSkyRadianceRuntime(backend); }
