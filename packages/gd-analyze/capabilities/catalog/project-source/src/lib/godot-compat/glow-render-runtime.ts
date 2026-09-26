import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotGlowBlendMode = 'additive' | 'screen' | 'softlight' | 'replace' | 'mix';
export interface GodotGlowRenderDescriptor {
  readonly viewport: GodotRid;
  readonly enabled?: boolean;
  readonly levels?: readonly number[];
  readonly threshold?: number;
  readonly scale?: number;
  readonly luminanceCap?: number;
  readonly intensity?: number;
  readonly strength?: number;
  readonly bloom?: number;
  readonly mix?: number;
  readonly blendMode?: GodotGlowBlendMode;
  readonly normalized?: boolean;
  readonly highQuality?: boolean;
  readonly bicubicUpscale?: boolean;
  readonly userData?: unknown;
}
export interface GodotGlowRenderState {
  readonly viewport: GodotRid;
  readonly enabled: boolean;
  readonly levels: readonly number[];
  readonly threshold: number;
  readonly scale: number;
  readonly luminanceCap: number;
  readonly intensity: number;
  readonly strength: number;
  readonly bloom: number;
  readonly mix: number;
  readonly blendMode: GodotGlowBlendMode;
  readonly normalized: boolean;
  readonly highQuality: boolean;
  readonly bicubicUpscale: boolean;
  readonly source: GodotRid | null;
  readonly pyramid: readonly GodotRid[];
  readonly dirty: boolean;
  readonly lastRenderedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}
export interface GodotGlowPassContext { readonly frame: number; readonly glow: GodotGlowRenderState; readonly source: GodotRid; readonly destination: GodotRid; readonly level: number; readonly weight: number }
export interface GodotGlowCombineContext { readonly frame: number; readonly glow: GodotGlowRenderState; readonly source: GodotRid; readonly levels: readonly GodotRid[] }
export interface GodotGlowRenderBackend {
  allocate(viewport: GodotRid, level: number, highQuality: boolean): GodotRid | Promise<GodotRid>;
  free(texture: GodotRid): void;
  extract(context: GodotGlowPassContext): void | Promise<void>;
  downsample(context: GodotGlowPassContext): void | Promise<void>;
  upsample(context: GodotGlowPassContext): void | Promise<void>;
  combine(context: GodotGlowCombineContext): void | Promise<void>;
}
export interface GodotGlowFrameResult { readonly frame: number; readonly rendered: readonly GodotRid[]; readonly skipped: readonly GodotRid[]; readonly passes: number; readonly failed: readonly { viewport: GodotRid; error: unknown }[] }
export interface GodotGlowRuntimeSnapshot { readonly frame: number; readonly viewports: readonly GodotGlowRenderState[]; readonly enabledViewports: number; readonly allocatedTextures: number; readonly renderedFrames: number; readonly totalPasses: number; readonly generation: number; readonly lastFrame: GodotGlowFrameResult | null }
interface Entry {
  viewport: GodotRid; enabled: boolean; levels: number[]; threshold: number; scale: number; luminanceCap: number;
  intensity: number; strength: number; bloom: number; mix: number; blendMode: GodotGlowBlendMode;
  normalized: boolean; highQuality: boolean; bicubicUpscale: boolean; source: GodotRid | null; pyramid: GodotRid[];
  dirty: boolean; lastRenderedFrame: number; generation: number; userData: unknown; order: number;
}
function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: GlowRenderRuntime.${member} requires integer in [${minimum}, ${maximum}].`); return result; }
function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number { const result = Number(value); if (!Number.isFinite(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: GlowRenderRuntime.${member} requires finite value in [${minimum}, ${maximum}].`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: GlowRenderRuntime.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: GlowRenderRuntime requires RID.'); godotRidGetId(value); return value as GodotRid; }
function mode(value: unknown): GodotGlowBlendMode { if (value !== 'additive' && value !== 'screen' && value !== 'softlight' && value !== 'replace' && value !== 'mix') throw new TypeError('godot-compat: unknown glow blend mode.'); return value; }
function levels(value: unknown): number[] { if (!Array.isArray(value) || value.length === 0 || value.length > 16) throw new TypeError('godot-compat: glow levels require nonempty float array.'); return value.map((one, index) => finite(one, `levels[${index}]`, 0)); }
function state(entry: Entry): GodotGlowRenderState { return Object.freeze({ ...entry, levels: Object.freeze([...entry.levels]), pyramid: Object.freeze([...entry.pyramid]) }); }

export class GodotGlowRenderRuntime {
  public readonly __godotClass = 'GlowRenderRuntime'; private readonly backend: GodotGlowRenderBackend;
  private readonly entries = new Map<bigint, Entry>(); private readonly watchers = new Set<(snapshot: GodotGlowRuntimeSnapshot) => void>();
  private frameValue = 0; private nextOrder = 0; private generationValue = 0; private renderedFrames = 0; private totalPasses = 0;
  private processing = false; private lastFrame: GodotGlowFrameResult | null = null;
  public constructor(backend: GodotGlowRenderBackend) {
    if (typeof backend?.allocate !== 'function' || typeof backend?.free !== 'function' || typeof backend?.extract !== 'function' || typeof backend?.downsample !== 'function' || typeof backend?.upsample !== 'function' || typeof backend?.combine !== 'function') throw new TypeError('godot-compat: GlowRenderRuntime requires complete backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'GlowRenderRuntime');
  }
  public addViewport(value: GodotGlowRenderDescriptor): void {
    const viewport = rid(value.viewport), id = godotRidGetId(viewport); if (this.entries.has(id)) throw new Error('godot-compat: glow viewport already exists.');
    this.entries.set(id, { viewport, enabled: bool(value.enabled ?? true, 'enabled'), levels: levels(value.levels ?? [0, 0, 1, 0, 1, 0, 0]), threshold: finite(value.threshold ?? 1, 'threshold', 0),
      scale: finite(value.scale ?? 2, 'scale', 0), luminanceCap: finite(value.luminanceCap ?? 12, 'luminance_cap', 0), intensity: finite(value.intensity ?? 0.8, 'intensity', 0),
      strength: finite(value.strength ?? 1, 'strength', 0), bloom: finite(value.bloom ?? 0, 'bloom', 0), mix: finite(value.mix ?? 0.05, 'mix', 0, 1),
      blendMode: mode(value.blendMode ?? 'softlight'), normalized: bool(value.normalized ?? false, 'normalized'), highQuality: bool(value.highQuality ?? false, 'high_quality'),
      bicubicUpscale: bool(value.bicubicUpscale ?? false, 'bicubic_upscale'), source: null, pyramid: [], dirty: true, lastRenderedFrame: -1, generation: 1, userData: value.userData ?? null, order: this.nextOrder++ });
    this.generationValue += 1; this.publish();
  }
  public removeViewport(value: unknown): boolean { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); if (entry === undefined) return false; this.free(entry); this.entries.delete(godotRidGetId(viewport)); this.generationValue += 1; this.publish(); return true; }
  private requireEntry(value: unknown): Entry { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); if (entry === undefined) throw new Error('godot-compat: glow viewport does not exist.'); return entry; }
  public updateViewport(value: unknown, patch: Partial<Omit<GodotGlowRenderDescriptor, 'viewport'>>): void {
    const entry = this.requireEntry(value); let reallocates = false;
    if (patch.enabled !== undefined) entry.enabled = bool(patch.enabled, 'enabled'); if (patch.levels !== undefined) { entry.levels = levels(patch.levels); reallocates = true; }
    if (patch.threshold !== undefined) entry.threshold = finite(patch.threshold, 'threshold', 0); if (patch.scale !== undefined) entry.scale = finite(patch.scale, 'scale', 0);
    if (patch.luminanceCap !== undefined) entry.luminanceCap = finite(patch.luminanceCap, 'luminance_cap', 0); if (patch.intensity !== undefined) entry.intensity = finite(patch.intensity, 'intensity', 0);
    if (patch.strength !== undefined) entry.strength = finite(patch.strength, 'strength', 0); if (patch.bloom !== undefined) entry.bloom = finite(patch.bloom, 'bloom', 0);
    if (patch.mix !== undefined) entry.mix = finite(patch.mix, 'mix', 0, 1); if (patch.blendMode !== undefined) entry.blendMode = mode(patch.blendMode);
    if (patch.normalized !== undefined) entry.normalized = bool(patch.normalized, 'normalized'); if (patch.highQuality !== undefined) { entry.highQuality = bool(patch.highQuality, 'high_quality'); reallocates = true; }
    if (patch.bicubicUpscale !== undefined) entry.bicubicUpscale = bool(patch.bicubicUpscale, 'bicubic_upscale'); if (patch.userData !== undefined) entry.userData = patch.userData;
    if (reallocates) this.free(entry); entry.dirty = true; entry.generation += 1; this.publish();
  }
  private free(entry: Entry): void { for (const texture of entry.pyramid) this.backend.free(texture); entry.pyramid = []; }
  private async allocate(entry: Entry): Promise<void> { while (entry.pyramid.length < entry.levels.length) entry.pyramid.push(rid(await this.backend.allocate(entry.viewport, entry.pyramid.length, entry.highQuality))); }
  public setSource(value: unknown, sourceValue: unknown): void { const entry = this.requireEntry(value); entry.source = rid(sourceValue); entry.dirty = true; this.publish(); }
  public async processFrame(frameValue: unknown): Promise<GodotGlowFrameResult> {
    const frame = integer(frameValue, 'frame'); if (frame < this.frameValue) throw new RangeError('godot-compat: glow frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: glow frame already processing.');
    this.frameValue = frame; this.processing = true; const rendered: GodotRid[] = [], skipped: GodotRid[] = [], failed: Array<{ viewport: GodotRid; error: unknown }> = []; let passes = 0;
    try {
      for (const entry of [...this.entries.values()].sort((left, right) => left.order - right.order)) {
        if (!entry.enabled || entry.source === null) { skipped.push(entry.viewport); continue; }
        try {
          await this.allocate(entry); const first = entry.pyramid[0]!;
          await this.backend.extract(Object.freeze({ frame, glow: state(entry), source: entry.source, destination: first, level: 0, weight: entry.levels[0]! })); passes += 1;
          for (let level = 1; level < entry.pyramid.length; level += 1) { await this.backend.downsample(Object.freeze({ frame, glow: state(entry), source: entry.pyramid[level - 1]!, destination: entry.pyramid[level]!, level, weight: entry.levels[level]! })); passes += 1; }
          for (let level = entry.pyramid.length - 2; level >= 0; level -= 1) { await this.backend.upsample(Object.freeze({ frame, glow: state(entry), source: entry.pyramid[level + 1]!, destination: entry.pyramid[level]!, level, weight: entry.levels[level]! })); passes += 1; }
          await this.backend.combine(Object.freeze({ frame, glow: state(entry), source: entry.source, levels: Object.freeze([...entry.pyramid]) })); passes += 1;
          entry.dirty = false; entry.lastRenderedFrame = frame; entry.generation += 1; rendered.push(entry.viewport);
        } catch (error) { failed.push(Object.freeze({ viewport: entry.viewport, error })); }
      }
      this.renderedFrames += 1; this.totalPasses += passes; this.lastFrame = Object.freeze({ frame, rendered: Object.freeze(rendered), skipped: Object.freeze(skipped), passes, failed: Object.freeze(failed) }); this.publish(); return this.lastFrame;
    } finally { this.processing = false; }
  }
  public getViewport(value: unknown): GodotGlowRenderState | null { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); return entry === undefined ? null : state(entry); }
  public getSnapshot(): GodotGlowRuntimeSnapshot { const viewports = [...this.entries.values()].map(state); return Object.freeze({ frame: this.frameValue, viewports: Object.freeze(viewports), enabledViewports: viewports.filter((entry) => entry.enabled).length, allocatedTextures: viewports.reduce((total, entry) => total + entry.pyramid.length, 0), renderedFrames: this.renderedFrames, totalPasses: this.totalPasses, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotGlowRuntimeSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear glow during frame.'); for (const entry of this.entries.values()) this.free(entry); this.entries.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotGlowRenderRuntime(backend: GodotGlowRenderBackend): GodotGlowRenderRuntime { return new GodotGlowRenderRuntime(backend); }
