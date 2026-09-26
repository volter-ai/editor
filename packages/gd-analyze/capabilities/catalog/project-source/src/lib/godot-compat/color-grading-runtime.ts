import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotTonemapMode = 'linear' | 'reinhard' | 'filmic' | 'aces';
export interface GodotColorGradingDescriptor {
  readonly viewport: GodotRid; readonly enabled?: boolean; readonly tonemap?: GodotTonemapMode;
  readonly exposure?: number; readonly white?: number; readonly temperature?: number; readonly tint?: number;
  readonly brightness?: number; readonly contrast?: number; readonly saturation?: number;
  readonly lift?: unknown; readonly gamma?: unknown; readonly gain?: unknown;
  readonly lut?: GodotRid | null; readonly lutIntensity?: number; readonly useDebanding?: boolean; readonly userData?: unknown;
}
export interface GodotColorGradingState {
  readonly viewport: GodotRid; readonly enabled: boolean; readonly tonemap: GodotTonemapMode;
  readonly exposure: number; readonly white: number; readonly temperature: number; readonly tint: number;
  readonly brightness: number; readonly contrast: number; readonly saturation: number;
  readonly lift: unknown; readonly gamma: unknown; readonly gain: unknown;
  readonly lut: GodotRid | null; readonly lutIntensity: number; readonly useDebanding: boolean;
  readonly source: GodotRid | null; readonly destination: GodotRid | null; readonly dirty: boolean;
  readonly lastRenderedFrame: number; readonly generation: number; readonly userData: unknown;
}
export interface GodotColorGradingBackend { render(frame: number, state: GodotColorGradingState): void | Promise<void> }
export interface GodotColorGradingFrameResult { readonly frame: number; readonly rendered: readonly GodotRid[]; readonly skipped: readonly GodotRid[]; readonly failed: readonly { viewport: GodotRid; error: unknown }[] }
export interface GodotColorGradingSnapshot { readonly frame: number; readonly viewports: readonly GodotColorGradingState[]; readonly enabled: number; readonly dirty: number; readonly renderedFrames: number; readonly generation: number; readonly lastFrame: GodotColorGradingFrameResult | null }
interface Entry { viewport: GodotRid; enabled: boolean; tonemap: GodotTonemapMode; exposure: number; white: number; temperature: number; tint: number; brightness: number; contrast: number; saturation: number; lift: unknown; gamma: unknown; gain: unknown; lut: GodotRid | null; lutIntensity: number; useDebanding: boolean; source: GodotRid | null; destination: GodotRid | null; dirty: boolean; lastRenderedFrame: number; generation: number; userData: unknown; order: number }
function integer(value: unknown, member: string, minimum = 0): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum) throw new RangeError(`godot-compat: ColorGradingRuntime.${member} requires integer >= ${minimum}.`); return result; }
function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number { const result = Number(value); if (!Number.isFinite(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: ColorGradingRuntime.${member} requires finite value in [${minimum}, ${maximum}].`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ColorGradingRuntime.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: ColorGradingRuntime requires RID.'); godotRidGetId(value); return value as GodotRid; }
function optionalRid(value: unknown): GodotRid | null { return value === null || value === undefined ? null : rid(value); }
function tonemap(value: unknown): GodotTonemapMode { if (value !== 'linear' && value !== 'reinhard' && value !== 'filmic' && value !== 'aces') throw new TypeError('godot-compat: unknown tonemap mode.'); return value; }
function state(entry: Entry): GodotColorGradingState { return Object.freeze({ ...entry }); }

export class GodotColorGradingRuntime {
  public readonly __godotClass = 'ColorGradingRuntime'; private readonly backend: GodotColorGradingBackend;
  private readonly entries = new Map<bigint, Entry>(); private readonly watchers = new Set<(snapshot: GodotColorGradingSnapshot) => void>();
  private frameValue = 0; private nextOrder = 0; private generationValue = 0; private renderedFrames = 0; private processing = false;
  private lastFrame: GodotColorGradingFrameResult | null = null;
  public constructor(backend: GodotColorGradingBackend) { if (typeof backend?.render !== 'function') throw new TypeError('godot-compat: ColorGradingRuntime requires render backend.'); this.backend = backend; registerGodotObjectIdentity(this, 'ColorGradingRuntime'); }
  public addViewport(value: GodotColorGradingDescriptor): void {
    const viewport = rid(value.viewport), id = godotRidGetId(viewport); if (this.entries.has(id)) throw new Error('godot-compat: color grading viewport already exists.');
    this.entries.set(id, { viewport, enabled: bool(value.enabled ?? true, 'enabled'), tonemap: tonemap(value.tonemap ?? 'aces'), exposure: finite(value.exposure ?? 1, 'exposure', 0), white: finite(value.white ?? 1, 'white', Number.MIN_VALUE), temperature: finite(value.temperature ?? 0, 'temperature', -1, 1), tint: finite(value.tint ?? 0, 'tint', -1, 1), brightness: finite(value.brightness ?? 1, 'brightness', 0), contrast: finite(value.contrast ?? 1, 'contrast', 0), saturation: finite(value.saturation ?? 1, 'saturation', 0), lift: value.lift ?? null, gamma: value.gamma ?? null, gain: value.gain ?? null, lut: optionalRid(value.lut), lutIntensity: finite(value.lutIntensity ?? 1, 'lut_intensity', 0, 1), useDebanding: bool(value.useDebanding ?? false, 'use_debanding'), source: null, destination: null, dirty: true, lastRenderedFrame: -1, generation: 1, userData: value.userData ?? null, order: this.nextOrder++ });
    this.generationValue += 1; this.publish();
  }
  public removeViewport(value: unknown): boolean { const viewport = rid(value), removed = this.entries.delete(godotRidGetId(viewport)); if (removed) { this.generationValue += 1; this.publish(); } return removed; }
  private requireEntry(value: unknown): Entry { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); if (entry === undefined) throw new Error('godot-compat: color grading viewport does not exist.'); return entry; }
  public updateViewport(value: unknown, patch: Partial<Omit<GodotColorGradingDescriptor, 'viewport'>>): void {
    const entry = this.requireEntry(value);
    if (patch.enabled !== undefined) entry.enabled = bool(patch.enabled, 'enabled'); if (patch.tonemap !== undefined) entry.tonemap = tonemap(patch.tonemap);
    if (patch.exposure !== undefined) entry.exposure = finite(patch.exposure, 'exposure', 0); if (patch.white !== undefined) entry.white = finite(patch.white, 'white', Number.MIN_VALUE);
    if (patch.temperature !== undefined) entry.temperature = finite(patch.temperature, 'temperature', -1, 1); if (patch.tint !== undefined) entry.tint = finite(patch.tint, 'tint', -1, 1);
    if (patch.brightness !== undefined) entry.brightness = finite(patch.brightness, 'brightness', 0); if (patch.contrast !== undefined) entry.contrast = finite(patch.contrast, 'contrast', 0);
    if (patch.saturation !== undefined) entry.saturation = finite(patch.saturation, 'saturation', 0); if (patch.lift !== undefined) entry.lift = patch.lift;
    if (patch.gamma !== undefined) entry.gamma = patch.gamma; if (patch.gain !== undefined) entry.gain = patch.gain;
    if (patch.lut !== undefined) entry.lut = optionalRid(patch.lut); if (patch.lutIntensity !== undefined) entry.lutIntensity = finite(patch.lutIntensity, 'lut_intensity', 0, 1);
    if (patch.useDebanding !== undefined) entry.useDebanding = bool(patch.useDebanding, 'use_debanding'); if (patch.userData !== undefined) entry.userData = patch.userData;
    entry.dirty = true; entry.generation += 1; this.publish();
  }
  public setTargets(value: unknown, sourceValue: unknown, destinationValue: unknown): void { const entry = this.requireEntry(value); entry.source = rid(sourceValue); entry.destination = rid(destinationValue); entry.dirty = true; this.publish(); }
  public invalidateLut(value: unknown): number { const lut = rid(value), id = godotRidGetId(lut); let count = 0; for (const entry of this.entries.values()) if (entry.lut !== null && godotRidGetId(entry.lut) === id) { entry.dirty = true; entry.generation += 1; count += 1; } this.publish(); return count; }
  public async processFrame(frameValue: unknown): Promise<GodotColorGradingFrameResult> {
    const frame = integer(frameValue, 'frame'); if (frame < this.frameValue) throw new RangeError('godot-compat: color grading frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: color grading frame already processing.');
    this.frameValue = frame; this.processing = true; const rendered: GodotRid[] = [], skipped: GodotRid[] = [], failed: Array<{ viewport: GodotRid; error: unknown }> = [];
    try { for (const entry of [...this.entries.values()].sort((left, right) => left.order - right.order)) {
      if (!entry.enabled || entry.source === null || entry.destination === null) { skipped.push(entry.viewport); continue; }
      try { await this.backend.render(frame, state(entry)); entry.dirty = false; entry.lastRenderedFrame = frame; entry.generation += 1; rendered.push(entry.viewport); } catch (error) { failed.push(Object.freeze({ viewport: entry.viewport, error })); }
    } this.renderedFrames += 1; this.lastFrame = Object.freeze({ frame, rendered: Object.freeze(rendered), skipped: Object.freeze(skipped), failed: Object.freeze(failed) }); this.publish(); return this.lastFrame; } finally { this.processing = false; }
  }
  public getViewport(value: unknown): GodotColorGradingState | null { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); return entry === undefined ? null : state(entry); }
  public getSnapshot(): GodotColorGradingSnapshot { const viewports = [...this.entries.values()].map(state); return Object.freeze({ frame: this.frameValue, viewports: Object.freeze(viewports), enabled: viewports.filter((entry) => entry.enabled).length, dirty: viewports.filter((entry) => entry.dirty).length, renderedFrames: this.renderedFrames, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotColorGradingSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear color grading during frame.'); this.entries.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotColorGradingRuntime(backend: GodotColorGradingBackend): GodotColorGradingRuntime { return new GodotColorGradingRuntime(backend); }
