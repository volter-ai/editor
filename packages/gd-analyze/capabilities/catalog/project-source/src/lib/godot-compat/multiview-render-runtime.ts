import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export interface GodotMultiviewViewDescriptor {
  readonly index: number;
  readonly transform: unknown;
  readonly projection: unknown;
  readonly viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly color: GodotRid;
  readonly depth: GodotRid;
  readonly velocity?: GodotRid | null;
  readonly enabled?: boolean;
}
export interface GodotMultiviewDescriptor {
  readonly rid: GodotRid;
  readonly views: readonly GodotMultiviewViewDescriptor[];
  readonly multiviewEnabled?: boolean;
  readonly foveationEnabled?: boolean;
  readonly foveationLevel?: number;
  readonly foveationDynamic?: boolean;
  readonly mirrorEnabled?: boolean;
  readonly mirrorView?: number;
  readonly userData?: unknown;
}
export interface GodotMultiviewViewState extends Required<GodotMultiviewViewDescriptor> {
  readonly dirty: boolean;
  readonly generation: number;
}
export interface GodotMultiviewState extends Required<Omit<GodotMultiviewDescriptor, 'views' | 'userData'>> {
  readonly views: readonly GodotMultiviewViewState[];
  readonly viewMask: number;
  readonly lastRenderedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}
export interface GodotMultiviewRenderContext {
  readonly frame: number;
  readonly target: GodotMultiviewState;
  readonly views: readonly GodotMultiviewViewState[];
  readonly multiview: boolean;
}
export interface GodotMultiviewRenderBackend {
  lateUpdate?(frame: number, target: GodotMultiviewState): readonly Partial<GodotMultiviewViewDescriptor>[] | Promise<readonly Partial<GodotMultiviewViewDescriptor>[]>;
  render(context: GodotMultiviewRenderContext): void | Promise<void>;
  mirror?(frame: number, target: GodotMultiviewState, view: GodotMultiviewViewState): void | Promise<void>;
}
export interface GodotMultiviewFrameResult {
  readonly frame: number;
  readonly rendered: readonly GodotRid[];
  readonly skipped: readonly GodotRid[];
  readonly views: number;
  readonly multiviewSubmissions: number;
  readonly sequentialSubmissions: number;
  readonly mirrored: readonly GodotRid[];
  readonly failed: readonly { target: GodotRid; error: unknown }[];
}
export interface GodotMultiviewRuntimeSnapshot {
  readonly frame: number;
  readonly targets: readonly GodotMultiviewState[];
  readonly views: number;
  readonly enabledViews: number;
  readonly submissions: number;
  readonly renderedFrames: number;
  readonly generation: number;
  readonly lastFrame: GodotMultiviewFrameResult | null;
}
interface ViewEntry { index: number; transform: unknown; projection: unknown; viewport: { x: number; y: number; width: number; height: number }; color: GodotRid; depth: GodotRid; velocity: GodotRid | null; enabled: boolean; dirty: boolean; generation: number }
interface TargetEntry { rid: GodotRid; views: ViewEntry[]; multiviewEnabled: boolean; foveationEnabled: boolean; foveationLevel: number; foveationDynamic: boolean; mirrorEnabled: boolean; mirrorView: number; viewMask: number; lastRenderedFrame: number; generation: number; userData: unknown; order: number }
function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: MultiviewRenderRuntime.${member} requires integer in [${minimum}, ${maximum}].`); return result; }
function finite(value: unknown, member: string, minimum = -Infinity): number { const result = Number(value); if (!Number.isFinite(result) || result < minimum) throw new RangeError(`godot-compat: MultiviewRenderRuntime.${member} requires finite value >= ${minimum}.`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: MultiviewRenderRuntime.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: MultiviewRenderRuntime requires RID.'); godotRidGetId(value); return value as GodotRid; }
function optionalRid(value: unknown): GodotRid | null { return value === null || value === undefined ? null : rid(value); }
function rect(value: unknown): { x: number; y: number; width: number; height: number } { if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('width' in value) || !('height' in value)) throw new TypeError('godot-compat: multiview viewport requires Rect2i.'); return Object.freeze({ x: finite(value.x, 'viewport.x'), y: finite(value.y, 'viewport.y'), width: finite(value.width, 'viewport.width', 1), height: finite(value.height, 'viewport.height', 1) }); }
function viewState(entry: ViewEntry): GodotMultiviewViewState { return Object.freeze({ ...entry }); }

export class GodotMultiviewRenderRuntime {
  public readonly __godotClass = 'MultiviewRenderRuntime'; private readonly backend: GodotMultiviewRenderBackend;
  private readonly targets = new Map<bigint, TargetEntry>(); private readonly watchers = new Set<(snapshot: GodotMultiviewRuntimeSnapshot) => void>();
  private frameValue = 0; private nextOrder = 0; private generationValue = 0; private submissions = 0; private renderedFrames = 0; private processing = false;
  private lastFrame: GodotMultiviewFrameResult | null = null;
  public constructor(backend: GodotMultiviewRenderBackend) { if (typeof backend?.render !== 'function') throw new TypeError('godot-compat: MultiviewRenderRuntime requires render backend.'); this.backend = backend; registerGodotObjectIdentity(this, 'MultiviewRenderRuntime'); }
  public addTarget(value: GodotMultiviewDescriptor): void {
    const targetRid = rid(value.rid), id = godotRidGetId(targetRid); if (this.targets.has(id)) throw new Error('godot-compat: multiview target already exists.'); if (!Array.isArray(value.views) || value.views.length === 0 || value.views.length > 32) throw new TypeError('godot-compat: multiview target requires 1..32 views.');
    const views = value.views.map((view) => ({ index: integer(view.index, 'view.index', 0, 31), transform: view.transform, projection: view.projection, viewport: rect(view.viewport), color: rid(view.color), depth: rid(view.depth), velocity: optionalRid(view.velocity), enabled: bool(view.enabled ?? true, 'view.enabled'), dirty: true, generation: 1 })).sort((left, right) => left.index - right.index);
    if (new Set(views.map((view) => view.index)).size !== views.length) throw new Error('godot-compat: multiview indices must be unique.');
    const mirrorView = integer(value.mirrorView ?? views[0]!.index, 'mirror_view', 0, 31); if (!views.some((view) => view.index === mirrorView)) throw new Error('godot-compat: mirror view does not exist.');
    this.targets.set(id, { rid: targetRid, views, multiviewEnabled: bool(value.multiviewEnabled ?? true, 'multiview_enabled'), foveationEnabled: bool(value.foveationEnabled ?? false, 'foveation_enabled'), foveationLevel: finite(value.foveationLevel ?? 0, 'foveation_level', 0), foveationDynamic: bool(value.foveationDynamic ?? false, 'foveation_dynamic'), mirrorEnabled: bool(value.mirrorEnabled ?? false, 'mirror_enabled'), mirrorView, viewMask: views.reduce((mask, view) => view.enabled ? mask | (1 << view.index) : mask, 0), lastRenderedFrame: -1, generation: 1, userData: value.userData ?? null, order: this.nextOrder++ });
    this.generationValue += 1; this.publish();
  }
  public removeTarget(value: unknown): boolean { const targetRid = rid(value), removed = this.targets.delete(godotRidGetId(targetRid)); if (removed) { this.generationValue += 1; this.publish(); } return removed; }
  private requireTarget(value: unknown): TargetEntry { const targetRid = rid(value), entry = this.targets.get(godotRidGetId(targetRid)); if (entry === undefined) throw new Error('godot-compat: multiview target does not exist.'); return entry; }
  private view(entry: TargetEntry, value: unknown): ViewEntry { const index = integer(value, 'view', 0, 31), view = entry.views.find((candidate) => candidate.index === index); if (view === undefined) throw new Error(`godot-compat: multiview view ${index} does not exist.`); return view; }
  public updateView(value: unknown, viewValue: unknown, patch: Partial<Omit<GodotMultiviewViewDescriptor, 'index'>>): void { const entry = this.requireTarget(value), view = this.view(entry, viewValue); if (patch.transform !== undefined) view.transform = patch.transform; if (patch.projection !== undefined) view.projection = patch.projection; if (patch.viewport !== undefined) view.viewport = rect(patch.viewport); if (patch.color !== undefined) view.color = rid(patch.color); if (patch.depth !== undefined) view.depth = rid(patch.depth); if (patch.velocity !== undefined) view.velocity = optionalRid(patch.velocity); if (patch.enabled !== undefined) view.enabled = bool(patch.enabled, 'view.enabled'); view.dirty = true; view.generation += 1; entry.viewMask = entry.views.reduce((mask, candidate) => candidate.enabled ? mask | (1 << candidate.index) : mask, 0); entry.generation += 1; this.publish(); }
  public configure(value: unknown, patch: Partial<Omit<GodotMultiviewDescriptor, 'rid' | 'views'>>): void { const entry = this.requireTarget(value); if (patch.multiviewEnabled !== undefined) entry.multiviewEnabled = bool(patch.multiviewEnabled, 'multiview_enabled'); if (patch.foveationEnabled !== undefined) entry.foveationEnabled = bool(patch.foveationEnabled, 'foveation_enabled'); if (patch.foveationLevel !== undefined) entry.foveationLevel = finite(patch.foveationLevel, 'foveation_level', 0); if (patch.foveationDynamic !== undefined) entry.foveationDynamic = bool(patch.foveationDynamic, 'foveation_dynamic'); if (patch.mirrorEnabled !== undefined) entry.mirrorEnabled = bool(patch.mirrorEnabled, 'mirror_enabled'); if (patch.mirrorView !== undefined) { const mirror = integer(patch.mirrorView, 'mirror_view', 0, 31); this.view(entry, mirror); entry.mirrorView = mirror; } if (patch.userData !== undefined) entry.userData = patch.userData; entry.generation += 1; this.publish(); }
  private state(entry: TargetEntry): GodotMultiviewState { return Object.freeze({ rid: entry.rid, views: Object.freeze(entry.views.map(viewState)), multiviewEnabled: entry.multiviewEnabled, foveationEnabled: entry.foveationEnabled, foveationLevel: entry.foveationLevel, foveationDynamic: entry.foveationDynamic, mirrorEnabled: entry.mirrorEnabled, mirrorView: entry.mirrorView, viewMask: entry.viewMask, lastRenderedFrame: entry.lastRenderedFrame, generation: entry.generation, userData: entry.userData }); }
  public async processFrame(frameValue: unknown): Promise<GodotMultiviewFrameResult> {
    const frame = integer(frameValue, 'frame'); if (frame < this.frameValue) throw new RangeError('godot-compat: multiview frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: multiview frame already processing.'); this.frameValue = frame; this.processing = true;
    const rendered: GodotRid[] = [], skipped: GodotRid[] = [], mirrored: GodotRid[] = [], failed: Array<{ target: GodotRid; error: unknown }> = []; let views = 0, multiviewSubmissions = 0, sequentialSubmissions = 0;
    try { for (const entry of [...this.targets.values()].sort((left, right) => left.order - right.order)) { try {
      const late = await this.backend.lateUpdate?.(frame, this.state(entry)); if (late !== undefined) late.forEach((patch, index) => { const view = entry.views[index]; if (view === undefined) return; if (patch.transform !== undefined) view.transform = patch.transform; if (patch.projection !== undefined) view.projection = patch.projection; view.dirty = true; });
      const enabled = entry.views.filter((view) => view.enabled); if (enabled.length === 0) { skipped.push(entry.rid); continue; }
      if (entry.multiviewEnabled) { await this.backend.render(Object.freeze({ frame, target: this.state(entry), views: Object.freeze(enabled.map(viewState)), multiview: true })); multiviewSubmissions += 1; this.submissions += 1; }
      else for (const view of enabled) { await this.backend.render(Object.freeze({ frame, target: this.state(entry), views: Object.freeze([viewState(view)]), multiview: false })); sequentialSubmissions += 1; this.submissions += 1; }
      for (const view of enabled) view.dirty = false; views += enabled.length; entry.lastRenderedFrame = frame; entry.generation += 1; rendered.push(entry.rid);
      if (entry.mirrorEnabled && this.backend.mirror !== undefined) { await this.backend.mirror(frame, this.state(entry), viewState(this.view(entry, entry.mirrorView))); mirrored.push(entry.rid); }
    } catch (error) { failed.push(Object.freeze({ target: entry.rid, error })); } }
      this.renderedFrames += 1; this.lastFrame = Object.freeze({ frame, rendered: Object.freeze(rendered), skipped: Object.freeze(skipped), views, multiviewSubmissions, sequentialSubmissions, mirrored: Object.freeze(mirrored), failed: Object.freeze(failed) }); this.publish(); return this.lastFrame;
    } finally { this.processing = false; }
  }
  public getSnapshot(): GodotMultiviewRuntimeSnapshot { const targets = [...this.targets.values()].map((entry) => this.state(entry)); return Object.freeze({ frame: this.frameValue, targets: Object.freeze(targets), views: targets.reduce((sum, target) => sum + target.views.length, 0), enabledViews: targets.reduce((sum, target) => sum + target.views.filter((view) => view.enabled).length, 0), submissions: this.submissions, renderedFrames: this.renderedFrames, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotMultiviewRuntimeSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear multiview during frame.'); this.targets.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotMultiviewRenderRuntime(backend: GodotMultiviewRenderBackend): GodotMultiviewRenderRuntime { return new GodotMultiviewRenderRuntime(backend); }
