import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotAutoExposureMetering = 'average' | 'center-weighted' | 'spot';
export interface GodotAutoExposureDescriptor {
  readonly viewport: GodotRid;
  readonly enabled?: boolean;
  readonly minSensitivity?: number;
  readonly maxSensitivity?: number;
  readonly speedUp?: number;
  readonly speedDown?: number;
  readonly compensation?: number;
  readonly metering?: GodotAutoExposureMetering;
  readonly spotPosition?: { readonly x: number; readonly y: number };
  readonly spotSize?: number;
  readonly histogramLowPercent?: number;
  readonly histogramHighPercent?: number;
  readonly histogramBins?: number;
  readonly userData?: unknown;
}
export interface GodotAutoExposureState {
  readonly viewport: GodotRid;
  readonly enabled: boolean;
  readonly minSensitivity: number;
  readonly maxSensitivity: number;
  readonly speedUp: number;
  readonly speedDown: number;
  readonly compensation: number;
  readonly metering: GodotAutoExposureMetering;
  readonly spotPosition: { readonly x: number; readonly y: number };
  readonly spotSize: number;
  readonly histogramLowPercent: number;
  readonly histogramHighPercent: number;
  readonly histogramBins: number;
  readonly exposure: number;
  readonly targetExposure: number;
  readonly averageLuminance: number;
  readonly histogram: readonly number[];
  readonly lastUpdatedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}
export interface GodotAutoExposureSampleContext { readonly frame: number; readonly viewport: GodotRid; readonly bins: number; readonly metering: GodotAutoExposureMetering; readonly spotPosition: { readonly x: number; readonly y: number }; readonly spotSize: number }
export interface GodotAutoExposureBackend { sampleHistogram(context: GodotAutoExposureSampleContext): readonly number[] | Promise<readonly number[]>; apply(viewport: GodotRid, exposure: number): void | Promise<void> }
export interface GodotAutoExposureFrameResult { readonly frame: number; readonly updated: readonly GodotRid[]; readonly exposures: ReadonlyMap<bigint, number>; readonly failed: readonly { viewport: GodotRid; error: unknown }[] }
export interface GodotAutoExposureRuntimeSnapshot { readonly frame: number; readonly viewports: readonly GodotAutoExposureState[]; readonly enabledViewports: number; readonly updates: number; readonly generation: number; readonly lastFrame: GodotAutoExposureFrameResult | null }
interface Entry {
  viewport: GodotRid; enabled: boolean; minSensitivity: number; maxSensitivity: number; speedUp: number; speedDown: number;
  compensation: number; metering: GodotAutoExposureMetering; spotPosition: { x: number; y: number }; spotSize: number;
  histogramLowPercent: number; histogramHighPercent: number; histogramBins: number; exposure: number; targetExposure: number;
  averageLuminance: number; histogram: number[]; lastUpdatedFrame: number; generation: number; userData: unknown; order: number;
}
function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: AutoExposureRuntime.${member} requires integer in [${minimum}, ${maximum}].`); return result; }
function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number { const result = Number(value); if (!Number.isFinite(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: AutoExposureRuntime.${member} requires finite value in [${minimum}, ${maximum}].`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: AutoExposureRuntime.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: AutoExposureRuntime requires viewport RID.'); godotRidGetId(value); return value as GodotRid; }
function point(value: unknown): { x: number; y: number } { if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) throw new TypeError('godot-compat: AutoExposureRuntime.spot_position requires Vector2.'); return Object.freeze({ x: finite(value.x, 'spot_position.x', 0, 1), y: finite(value.y, 'spot_position.y', 0, 1) }); }
function metering(value: unknown): GodotAutoExposureMetering { if (value !== 'average' && value !== 'center-weighted' && value !== 'spot') throw new TypeError('godot-compat: auto exposure metering requires average, center-weighted, or spot.'); return value; }
function state(entry: Entry): GodotAutoExposureState { return Object.freeze({ ...entry, spotPosition: Object.freeze({ ...entry.spotPosition }), histogram: Object.freeze([...entry.histogram]) }); }

export class GodotAutoExposureRuntime {
  public readonly __godotClass = 'AutoExposureRuntime';
  private readonly backend: GodotAutoExposureBackend; private readonly entries = new Map<bigint, Entry>();
  private readonly watchers = new Set<(snapshot: GodotAutoExposureRuntimeSnapshot) => void>();
  private frameValue = 0; private nextOrder = 0; private generationValue = 0; private updates = 0; private processing = false;
  private lastFrame: GodotAutoExposureFrameResult | null = null;
  public constructor(backend: GodotAutoExposureBackend) {
    if (typeof backend?.sampleHistogram !== 'function' || typeof backend?.apply !== 'function') throw new TypeError('godot-compat: AutoExposureRuntime requires sample and apply backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'AutoExposureRuntime');
  }
  public addViewport(value: GodotAutoExposureDescriptor): void {
    const viewport = rid(value.viewport), id = godotRidGetId(viewport); if (this.entries.has(id)) throw new Error(`godot-compat: auto exposure viewport RID ${id} already exists.`);
    const min = finite(value.minSensitivity ?? 0.05, 'min_sensitivity', Number.MIN_VALUE), max = finite(value.maxSensitivity ?? 8, 'max_sensitivity', min);
    const low = finite(value.histogramLowPercent ?? 0.01, 'histogram_low_percent', 0, 1), high = finite(value.histogramHighPercent ?? 0.99, 'histogram_high_percent', low, 1);
    this.entries.set(id, { viewport, enabled: bool(value.enabled ?? true, 'enabled'), minSensitivity: min, maxSensitivity: max,
      speedUp: finite(value.speedUp ?? 1, 'speed_up', 0), speedDown: finite(value.speedDown ?? 1, 'speed_down', 0), compensation: finite(value.compensation ?? 0, 'compensation'),
      metering: metering(value.metering ?? 'average'), spotPosition: point(value.spotPosition ?? { x: 0.5, y: 0.5 }), spotSize: finite(value.spotSize ?? 0.1, 'spot_size', Number.MIN_VALUE, 1),
      histogramLowPercent: low, histogramHighPercent: high, histogramBins: integer(value.histogramBins ?? 64, 'histogram_bins', 8, 1024),
      exposure: 1, targetExposure: 1, averageLuminance: 1, histogram: [], lastUpdatedFrame: -1, generation: 1, userData: value.userData ?? null, order: this.nextOrder++ });
    this.generationValue += 1; this.publish();
  }
  public removeViewport(value: unknown): boolean { const viewport = rid(value), removed = this.entries.delete(godotRidGetId(viewport)); if (removed) { this.generationValue += 1; this.publish(); } return removed; }
  private requireEntry(value: unknown): Entry { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); if (entry === undefined) throw new Error('godot-compat: auto exposure viewport does not exist.'); return entry; }
  public updateViewport(value: unknown, patch: Partial<Omit<GodotAutoExposureDescriptor, 'viewport'>>): void {
    const entry = this.requireEntry(value);
    if (patch.enabled !== undefined) entry.enabled = bool(patch.enabled, 'enabled'); if (patch.minSensitivity !== undefined) entry.minSensitivity = finite(patch.minSensitivity, 'min_sensitivity', Number.MIN_VALUE);
    if (patch.maxSensitivity !== undefined) entry.maxSensitivity = finite(patch.maxSensitivity, 'max_sensitivity', entry.minSensitivity);
    if (entry.minSensitivity > entry.maxSensitivity) throw new RangeError('godot-compat: auto exposure sensitivity range is inverted.');
    if (patch.speedUp !== undefined) entry.speedUp = finite(patch.speedUp, 'speed_up', 0); if (patch.speedDown !== undefined) entry.speedDown = finite(patch.speedDown, 'speed_down', 0);
    if (patch.compensation !== undefined) entry.compensation = finite(patch.compensation, 'compensation'); if (patch.metering !== undefined) entry.metering = metering(patch.metering);
    if (patch.spotPosition !== undefined) entry.spotPosition = point(patch.spotPosition); if (patch.spotSize !== undefined) entry.spotSize = finite(patch.spotSize, 'spot_size', Number.MIN_VALUE, 1);
    if (patch.histogramLowPercent !== undefined) entry.histogramLowPercent = finite(patch.histogramLowPercent, 'histogram_low_percent', 0, 1);
    if (patch.histogramHighPercent !== undefined) entry.histogramHighPercent = finite(patch.histogramHighPercent, 'histogram_high_percent', entry.histogramLowPercent, 1);
    if (patch.histogramBins !== undefined) entry.histogramBins = integer(patch.histogramBins, 'histogram_bins', 8, 1024); if (patch.userData !== undefined) entry.userData = patch.userData;
    entry.generation += 1; this.publish();
  }
  private analyze(entry: Entry, histogram: readonly number[]): number {
    if (histogram.length !== entry.histogramBins || histogram.some((count) => !Number.isFinite(count) || count < 0)) throw new Error('godot-compat: auto exposure backend returned invalid histogram.');
    const total = histogram.reduce((sum, count) => sum + count, 0); if (total <= 0) return entry.averageLuminance;
    const lowCount = total * entry.histogramLowPercent, highCount = total * entry.histogramHighPercent;
    let cumulative = 0, weighted = 0, retained = 0;
    for (let index = 0; index < histogram.length; index += 1) {
      const count = histogram[index]!, next = cumulative + count, included = Math.max(0, Math.min(next, highCount) - Math.max(cumulative, lowCount));
      if (included > 0) { const logLuminance = -12 + (index + 0.5) / histogram.length * 24; weighted += 2 ** logLuminance * included; retained += included; }
      cumulative = next;
    }
    return retained > 0 ? weighted / retained : entry.averageLuminance;
  }
  public async processFrame(frameValue: unknown, deltaValue: unknown): Promise<GodotAutoExposureFrameResult> {
    const frame = integer(frameValue, 'frame'), delta = finite(deltaValue, 'delta', 0); if (frame < this.frameValue) throw new RangeError('godot-compat: auto exposure frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: auto exposure frame already processing.');
    this.frameValue = frame; this.processing = true; const updated: GodotRid[] = [], exposures = new Map<bigint, number>(), failed: Array<{ viewport: GodotRid; error: unknown }> = [];
    try {
      for (const entry of [...this.entries.values()].sort((left, right) => left.order - right.order)) {
        if (!entry.enabled) { exposures.set(godotRidGetId(entry.viewport), entry.exposure); continue; }
        try {
          const histogram = [...await this.backend.sampleHistogram(Object.freeze({ frame, viewport: entry.viewport, bins: entry.histogramBins, metering: entry.metering, spotPosition: entry.spotPosition, spotSize: entry.spotSize }))];
          entry.histogram = histogram; entry.averageLuminance = this.analyze(entry, histogram);
          const compensation = 2 ** entry.compensation; entry.targetExposure = Math.max(entry.minSensitivity, Math.min(entry.maxSensitivity, 0.18 / Math.max(entry.averageLuminance, 1e-6) * compensation));
          const speed = entry.targetExposure > entry.exposure ? entry.speedUp : entry.speedDown, weight = 1 - Math.exp(-speed * delta);
          entry.exposure += (entry.targetExposure - entry.exposure) * weight; entry.lastUpdatedFrame = frame; entry.generation += 1;
          await this.backend.apply(entry.viewport, entry.exposure); updated.push(entry.viewport); exposures.set(godotRidGetId(entry.viewport), entry.exposure); this.updates += 1;
        } catch (error) { failed.push(Object.freeze({ viewport: entry.viewport, error })); }
      }
      this.lastFrame = Object.freeze({ frame, updated: Object.freeze(updated), exposures: new Map(exposures), failed: Object.freeze(failed) }); this.publish(); return this.lastFrame;
    } finally { this.processing = false; }
  }
  public reset(value: unknown, exposureValue = 1): void { const entry = this.requireEntry(value), exposure = finite(exposureValue, 'exposure', entry.minSensitivity, entry.maxSensitivity); entry.exposure = exposure; entry.targetExposure = exposure; entry.histogram = []; entry.generation += 1; this.publish(); }
  public getExposure(value: unknown): number { return this.requireEntry(value).exposure; }
  public getViewport(value: unknown): GodotAutoExposureState | null { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); return entry === undefined ? null : state(entry); }
  public getSnapshot(): GodotAutoExposureRuntimeSnapshot { const viewports = [...this.entries.values()].map(state); return Object.freeze({ frame: this.frameValue, viewports: Object.freeze(viewports), enabledViewports: viewports.filter((entry) => entry.enabled).length, updates: this.updates, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotAutoExposureRuntimeSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear auto exposure during frame.'); this.entries.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotAutoExposureRuntime(backend: GodotAutoExposureBackend): GodotAutoExposureRuntime { return new GodotAutoExposureRuntime(backend); }
