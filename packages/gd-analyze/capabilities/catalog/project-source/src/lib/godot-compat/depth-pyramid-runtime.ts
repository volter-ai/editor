import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export interface GodotDepthPyramidDescriptor { readonly viewport: GodotRid; readonly width: number; readonly height: number; readonly viewCount?: number; readonly reversedZ?: boolean; readonly enabled?: boolean; readonly userData?: unknown }
export interface GodotDepthPyramidViewState { readonly view: number; readonly sourceDepth: GodotRid | null; readonly mipmaps: readonly GodotRid[]; readonly dirty: boolean; readonly lastBuiltFrame: number; readonly generation: number }
export interface GodotDepthPyramidState { readonly viewport: GodotRid; readonly width: number; readonly height: number; readonly viewCount: number; readonly mipCount: number; readonly reversedZ: boolean; readonly enabled: boolean; readonly views: readonly GodotDepthPyramidViewState[]; readonly generation: number; readonly userData: unknown }
export interface GodotDepthPyramidPass { readonly frame: number; readonly viewport: GodotRid; readonly view: number; readonly level: number; readonly width: number; readonly height: number; readonly source: GodotRid; readonly destination: GodotRid; readonly reduction: 'minimum' | 'maximum' }
export interface GodotDepthPyramidBackend { allocate(viewport: GodotRid, view: number, level: number, width: number, height: number): GodotRid | Promise<GodotRid>; free(texture: GodotRid): void; reduce(pass: GodotDepthPyramidPass): void | Promise<void> }
export interface GodotDepthPyramidFrameResult { readonly frame: number; readonly built: readonly GodotRid[]; readonly skipped: readonly GodotRid[]; readonly passes: number; readonly failed: readonly { viewport: GodotRid; view: number; error: unknown }[] }
export interface GodotDepthPyramidSnapshot { readonly frame: number; readonly viewports: readonly GodotDepthPyramidState[]; readonly textures: number; readonly dirtyViews: number; readonly builds: number; readonly passes: number; readonly generation: number; readonly lastFrame: GodotDepthPyramidFrameResult | null }
interface ViewEntry { view: number; sourceDepth: GodotRid | null; mipmaps: GodotRid[]; dirty: boolean; lastBuiltFrame: number; generation: number }
interface Entry { viewport: GodotRid; width: number; height: number; viewCount: number; mipCount: number; reversedZ: boolean; enabled: boolean; views: ViewEntry[]; generation: number; userData: unknown; order: number }
function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: DepthPyramidRuntime.${member} requires integer in [${minimum}, ${maximum}].`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: DepthPyramidRuntime.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: DepthPyramidRuntime requires RID.'); godotRidGetId(value); return value as GodotRid; }
function mipCount(width: number, height: number): number { return Math.floor(Math.log2(Math.max(width, height))) + 1; }
function viewState(entry: ViewEntry): GodotDepthPyramidViewState { return Object.freeze({ ...entry, mipmaps: Object.freeze([...entry.mipmaps]) }); }

export class GodotDepthPyramidRuntime {
  public readonly __godotClass = 'DepthPyramidRuntime'; private readonly backend: GodotDepthPyramidBackend;
  private readonly entries = new Map<bigint, Entry>(); private readonly watchers = new Set<(snapshot: GodotDepthPyramidSnapshot) => void>();
  private frameValue = 0; private nextOrder = 0; private generationValue = 0; private builds = 0; private passes = 0; private processing = false;
  private lastFrame: GodotDepthPyramidFrameResult | null = null;
  public constructor(backend: GodotDepthPyramidBackend) {
    if (typeof backend?.allocate !== 'function' || typeof backend?.free !== 'function' || typeof backend?.reduce !== 'function') throw new TypeError('godot-compat: DepthPyramidRuntime requires allocation and reduction backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'DepthPyramidRuntime');
  }
  public addViewport(value: GodotDepthPyramidDescriptor): void {
    const viewport = rid(value.viewport), id = godotRidGetId(viewport); if (this.entries.has(id)) throw new Error('godot-compat: depth pyramid viewport already exists.');
    const width = integer(value.width, 'width', 1, 32768), height = integer(value.height, 'height', 1, 32768), viewCount = integer(value.viewCount ?? 1, 'view_count', 1, 32);
    this.entries.set(id, { viewport, width, height, viewCount, mipCount: mipCount(width, height), reversedZ: bool(value.reversedZ ?? true, 'reversed_z'), enabled: bool(value.enabled ?? true, 'enabled'),
      views: Array.from({ length: viewCount }, (_, view) => ({ view, sourceDepth: null, mipmaps: [], dirty: true, lastBuiltFrame: -1, generation: 1 })), generation: 1, userData: value.userData ?? null, order: this.nextOrder++ });
    this.generationValue += 1; this.publish();
  }
  public removeViewport(value: unknown): boolean { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); if (entry === undefined) return false; this.free(entry); this.entries.delete(godotRidGetId(viewport)); this.generationValue += 1; this.publish(); return true; }
  private requireEntry(value: unknown): Entry { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); if (entry === undefined) throw new Error('godot-compat: depth pyramid viewport does not exist.'); return entry; }
  private view(entry: Entry, value: unknown): ViewEntry { const view = integer(value, 'view', 0, entry.viewCount - 1); return entry.views[view]!; }
  public configure(value: unknown, widthValue: unknown, heightValue: unknown, viewCountValue: unknown = undefined, reversedZValue: unknown = undefined): void {
    const entry = this.requireEntry(value), width = integer(widthValue, 'width', 1, 32768), height = integer(heightValue, 'height', 1, 32768), viewCount = viewCountValue === undefined ? entry.viewCount : integer(viewCountValue, 'view_count', 1, 32);
    this.free(entry); entry.width = width; entry.height = height; entry.viewCount = viewCount; entry.mipCount = mipCount(width, height); if (reversedZValue !== undefined) entry.reversedZ = bool(reversedZValue, 'reversed_z');
    entry.views = Array.from({ length: viewCount }, (_, view) => ({ view, sourceDepth: null, mipmaps: [], dirty: true, lastBuiltFrame: -1, generation: 1 })); entry.generation += 1; this.publish();
  }
  public setSourceDepth(value: unknown, viewValue: unknown, sourceValue: unknown): void { const entry = this.requireEntry(value), view = this.view(entry, viewValue); view.sourceDepth = rid(sourceValue); view.dirty = true; view.generation += 1; this.publish(); }
  public setEnabled(value: unknown, enabledValue: unknown): void { const entry = this.requireEntry(value); entry.enabled = bool(enabledValue, 'enabled'); this.publish(); }
  public invalidate(value: unknown, viewValue: unknown = undefined): void { const entry = this.requireEntry(value); if (viewValue === undefined) for (const view of entry.views) { view.dirty = true; view.generation += 1; } else { const view = this.view(entry, viewValue); view.dirty = true; view.generation += 1; } this.publish(); }
  private async allocate(entry: Entry, view: ViewEntry): Promise<void> { while (view.mipmaps.length < entry.mipCount) { const level = view.mipmaps.length; view.mipmaps.push(rid(await this.backend.allocate(entry.viewport, view.view, level, Math.max(1, entry.width >> level), Math.max(1, entry.height >> level)))); } }
  private free(entry: Entry): void { for (const view of entry.views) { for (const mipmap of view.mipmaps) this.backend.free(mipmap); view.mipmaps = []; } }
  private state(entry: Entry): GodotDepthPyramidState { return Object.freeze({ viewport: entry.viewport, width: entry.width, height: entry.height, viewCount: entry.viewCount, mipCount: entry.mipCount, reversedZ: entry.reversedZ, enabled: entry.enabled, views: Object.freeze(entry.views.map(viewState)), generation: entry.generation, userData: entry.userData }); }
  public async processFrame(frameValue: unknown): Promise<GodotDepthPyramidFrameResult> {
    const frame = integer(frameValue, 'frame'); if (frame < this.frameValue) throw new RangeError('godot-compat: depth pyramid frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: depth pyramid frame already processing.');
    this.frameValue = frame; this.processing = true; const built: GodotRid[] = [], skipped: GodotRid[] = [], failed: Array<{ viewport: GodotRid; view: number; error: unknown }> = []; let framePasses = 0;
    try {
      for (const entry of [...this.entries.values()].sort((left, right) => left.order - right.order)) {
        if (!entry.enabled) { skipped.push(entry.viewport); continue; } let builtAny = false;
        for (const view of entry.views) {
          if (!view.dirty || view.sourceDepth === null) continue;
          try { await this.allocate(entry, view); let source = view.sourceDepth;
            for (let level = 0; level < view.mipmaps.length; level += 1) { const destination = view.mipmaps[level]!; await this.backend.reduce(Object.freeze({ frame, viewport: entry.viewport, view: view.view, level, width: Math.max(1, entry.width >> level), height: Math.max(1, entry.height >> level), source, destination, reduction: entry.reversedZ ? 'maximum' : 'minimum' })); source = destination; framePasses += 1; }
            view.dirty = false; view.lastBuiltFrame = frame; view.generation += 1; builtAny = true; this.builds += 1;
          } catch (error) { failed.push(Object.freeze({ viewport: entry.viewport, view: view.view, error })); }
        }
        if (builtAny) built.push(entry.viewport); else skipped.push(entry.viewport);
      }
      this.passes += framePasses; this.lastFrame = Object.freeze({ frame, built: Object.freeze(built), skipped: Object.freeze(skipped), passes: framePasses, failed: Object.freeze(failed) }); this.publish(); return this.lastFrame;
    } finally { this.processing = false; }
  }
  public getMipmap(value: unknown, viewValue: unknown, levelValue: unknown): GodotRid | null { const entry = this.requireEntry(value), view = this.view(entry, viewValue), level = integer(levelValue, 'level', 0, entry.mipCount - 1); return view.mipmaps[level] ?? null; }
  public getViewport(value: unknown): GodotDepthPyramidState | null { const viewport = rid(value), entry = this.entries.get(godotRidGetId(viewport)); return entry === undefined ? null : this.state(entry); }
  public getSnapshot(): GodotDepthPyramidSnapshot { const viewports = [...this.entries.values()].map((entry) => this.state(entry)); return Object.freeze({ frame: this.frameValue, viewports: Object.freeze(viewports), textures: viewports.reduce((sum, viewport) => sum + viewport.views.reduce((total, view) => total + view.mipmaps.length, 0), 0), dirtyViews: viewports.reduce((sum, viewport) => sum + viewport.views.filter((view) => view.dirty).length, 0), builds: this.builds, passes: this.passes, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotDepthPyramidSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear depth pyramids during frame.'); for (const entry of this.entries.values()) this.free(entry); this.entries.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotDepthPyramidRuntime(backend: GodotDepthPyramidBackend): GodotDepthPyramidRuntime { return new GodotDepthPyramidRuntime(backend); }
