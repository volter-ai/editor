import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotViewportRenderTargetUpdateMode = 'disabled' | 'once' | 'when-visible' | 'when-parent-visible' | 'always';
export type GodotViewportRenderTargetClearMode = 'always' | 'never' | 'once';
export type GodotViewportRenderTargetAttachment = 'color' | 'depth' | 'velocity' | 'normal-roughness' | 'voxel-gi';

export interface GodotViewportRenderTargetDescriptor {
  readonly rid: GodotRid;
  readonly width: number;
  readonly height: number;
  readonly viewCount?: number;
  readonly samples?: number;
  readonly hdr?: boolean;
  readonly transparentBackground?: boolean;
  readonly directToScreen?: boolean;
  readonly updateMode?: GodotViewportRenderTargetUpdateMode;
  readonly clearMode?: GodotViewportRenderTargetClearMode;
  readonly clearColor?: unknown;
  readonly historyLength?: number;
  readonly attachments?: readonly GodotViewportRenderTargetAttachment[];
  readonly userData?: unknown;
}

export interface GodotViewportRenderTargetAttachmentState {
  readonly attachment: GodotViewportRenderTargetAttachment;
  readonly rid: GodotRid;
  readonly history: readonly GodotRid[];
  readonly historyIndex: number;
  readonly generation: number;
}

export interface GodotViewportRenderTargetState {
  readonly rid: GodotRid;
  readonly width: number;
  readonly height: number;
  readonly viewCount: number;
  readonly samples: number;
  readonly hdr: boolean;
  readonly transparentBackground: boolean;
  readonly directToScreen: boolean;
  readonly updateMode: GodotViewportRenderTargetUpdateMode;
  readonly clearMode: GodotViewportRenderTargetClearMode;
  readonly clearColor: unknown;
  readonly historyLength: number;
  readonly attachments: readonly GodotViewportRenderTargetAttachmentState[];
  readonly visible: boolean;
  readonly parentVisible: boolean;
  readonly updateRequested: boolean;
  readonly clearRequested: boolean;
  readonly resizing: boolean;
  readonly lastRenderedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotViewportRenderTargetAllocationContext {
  readonly target: GodotViewportRenderTargetState;
  readonly attachment: GodotViewportRenderTargetAttachment;
  readonly historyIndex: number;
}

export interface GodotViewportRenderTargetBackend {
  allocate(context: GodotViewportRenderTargetAllocationContext): GodotRid | Promise<GodotRid>;
  free(rid: GodotRid): void;
  clear?(target: GodotViewportRenderTargetState): void | Promise<void>;
  present?(target: GodotViewportRenderTargetState): void | Promise<void>;
}

export interface GodotViewportRenderTargetFrameResult {
  readonly frame: number;
  readonly rendered: readonly GodotRid[];
  readonly skipped: readonly GodotRid[];
  readonly cleared: readonly GodotRid[];
  readonly presented: readonly GodotRid[];
  readonly recreated: readonly GodotRid[];
}

export interface GodotViewportRenderTargetRuntimeSnapshot {
  readonly frame: number;
  readonly targets: readonly GodotViewportRenderTargetState[];
  readonly attachments: number;
  readonly historyTextures: number;
  readonly pendingResize: number;
  readonly renderedFrames: number;
  readonly recreations: number;
  readonly generation: number;
  readonly lastFrame: GodotViewportRenderTargetFrameResult | null;
}

interface AttachmentEntry {
  attachment: GodotViewportRenderTargetAttachment;
  rid: GodotRid;
  history: GodotRid[];
  historyIndex: number;
  generation: number;
}
interface TargetEntry {
  rid: GodotRid; width: number; height: number; viewCount: number; samples: number; hdr: boolean;
  transparentBackground: boolean; directToScreen: boolean; updateMode: GodotViewportRenderTargetUpdateMode;
  clearMode: GodotViewportRenderTargetClearMode; clearColor: unknown; historyLength: number;
  attachmentKinds: GodotViewportRenderTargetAttachment[]; attachments: Map<GodotViewportRenderTargetAttachment, AttachmentEntry>;
  visible: boolean; parentVisible: boolean; updateRequested: boolean; clearRequested: boolean;
  resizing: boolean; pendingWidth: number; pendingHeight: number; lastRenderedFrame: number;
  generation: number; order: number; userData: unknown;
}

const ATTACHMENTS = new Set<GodotViewportRenderTargetAttachment>(['color', 'depth', 'velocity', 'normal-roughness', 'voxel-gi']);
const UPDATES = new Set<GodotViewportRenderTargetUpdateMode>(['disabled', 'once', 'when-visible', 'when-parent-visible', 'always']);
const CLEARS = new Set<GodotViewportRenderTargetClearMode>(['always', 'never', 'once']);
function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: ViewportRenderTarget.${member} requires integer in [${minimum}, ${maximum}].`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ViewportRenderTarget.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: ViewportRenderTarget requires RID.'); godotRidGetId(value); return value as GodotRid; }
function attachment(value: unknown): GodotViewportRenderTargetAttachment { if (!ATTACHMENTS.has(value as GodotViewportRenderTargetAttachment)) throw new TypeError(`godot-compat: unknown viewport attachment ${String(value)}.`); return value as GodotViewportRenderTargetAttachment; }
function updateMode(value: unknown): GodotViewportRenderTargetUpdateMode { if (!UPDATES.has(value as GodotViewportRenderTargetUpdateMode)) throw new TypeError(`godot-compat: unknown viewport update mode ${String(value)}.`); return value as GodotViewportRenderTargetUpdateMode; }
function clearMode(value: unknown): GodotViewportRenderTargetClearMode { if (!CLEARS.has(value as GodotViewportRenderTargetClearMode)) throw new TypeError(`godot-compat: unknown viewport clear mode ${String(value)}.`); return value as GodotViewportRenderTargetClearMode; }

export class GodotViewportRenderTargetRuntime {
  public readonly __godotClass = 'ViewportRenderTargetRuntime';
  private readonly backend: GodotViewportRenderTargetBackend;
  private readonly targets = new Map<bigint, TargetEntry>();
  private readonly watchers = new Set<(snapshot: GodotViewportRenderTargetRuntimeSnapshot) => void>();
  private frameValue = 0; private nextOrder = 0; private generationValue = 0; private renderedFrames = 0; private recreations = 0;
  private processing = false; private lastFrame: GodotViewportRenderTargetFrameResult | null = null;

  public constructor(backend: GodotViewportRenderTargetBackend) {
    if (typeof backend?.allocate !== 'function' || typeof backend?.free !== 'function') throw new TypeError('godot-compat: ViewportRenderTarget requires allocation backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'ViewportRenderTargetRuntime');
  }

  public addTarget(value: GodotViewportRenderTargetDescriptor): void {
    const targetRid = rid(value.rid), id = godotRidGetId(targetRid); if (this.targets.has(id)) throw new Error(`godot-compat: viewport render target RID ${id} already exists.`);
    const kinds = [...new Set((value.attachments ?? ['color', 'depth']).map(attachment))];
    this.targets.set(id, {
      rid: targetRid, width: integer(value.width, 'width', 1, 32768), height: integer(value.height, 'height', 1, 32768),
      viewCount: integer(value.viewCount ?? 1, 'view_count', 1, 32), samples: integer(value.samples ?? 1, 'samples', 1, 64),
      hdr: bool(value.hdr ?? true, 'hdr'), transparentBackground: bool(value.transparentBackground ?? false, 'transparent_background'),
      directToScreen: bool(value.directToScreen ?? false, 'direct_to_screen'), updateMode: updateMode(value.updateMode ?? 'always'),
      clearMode: clearMode(value.clearMode ?? 'always'), clearColor: value.clearColor ?? null, historyLength: integer(value.historyLength ?? 0, 'history_length', 0, 16),
      attachmentKinds: kinds, attachments: new Map(), visible: true, parentVisible: true, updateRequested: true, clearRequested: true,
      resizing: true, pendingWidth: integer(value.width, 'width', 1, 32768), pendingHeight: integer(value.height, 'height', 1, 32768),
      lastRenderedFrame: -1, generation: 1, order: this.nextOrder++, userData: value.userData ?? null,
    });
    this.generationValue += 1; this.publish();
  }

  public removeTarget(value: unknown): boolean {
    const targetRid = rid(value), entry = this.targets.get(godotRidGetId(targetRid)); if (entry === undefined) return false;
    this.freeAttachments(entry); this.targets.delete(godotRidGetId(targetRid)); this.generationValue += 1; this.publish(); return true;
  }
  private requireTarget(value: unknown): TargetEntry { const targetRid = rid(value), entry = this.targets.get(godotRidGetId(targetRid)); if (entry === undefined) throw new Error('godot-compat: viewport render target does not exist.'); return entry; }

  public resize(value: unknown, widthValue: unknown, heightValue: unknown): void {
    const entry = this.requireTarget(value), width = integer(widthValue, 'width', 1, 32768), height = integer(heightValue, 'height', 1, 32768);
    if (width === entry.width && height === entry.height && !entry.resizing) return; entry.pendingWidth = width; entry.pendingHeight = height; entry.resizing = true; entry.updateRequested = true; entry.generation += 1; this.publish();
  }
  public configure(value: unknown, patch: Partial<Omit<GodotViewportRenderTargetDescriptor, 'rid' | 'width' | 'height'>>): void {
    const entry = this.requireTarget(value); let recreate = false;
    if (patch.viewCount !== undefined) { entry.viewCount = integer(patch.viewCount, 'view_count', 1, 32); recreate = true; }
    if (patch.samples !== undefined) { entry.samples = integer(patch.samples, 'samples', 1, 64); recreate = true; }
    if (patch.hdr !== undefined) { entry.hdr = bool(patch.hdr, 'hdr'); recreate = true; }
    if (patch.transparentBackground !== undefined) entry.transparentBackground = bool(patch.transparentBackground, 'transparent_background');
    if (patch.directToScreen !== undefined) entry.directToScreen = bool(patch.directToScreen, 'direct_to_screen');
    if (patch.updateMode !== undefined) entry.updateMode = updateMode(patch.updateMode); if (patch.clearMode !== undefined) entry.clearMode = clearMode(patch.clearMode);
    if (patch.clearColor !== undefined) entry.clearColor = patch.clearColor;
    if (patch.historyLength !== undefined) { entry.historyLength = integer(patch.historyLength, 'history_length', 0, 16); recreate = true; }
    if (patch.attachments !== undefined) { entry.attachmentKinds = [...new Set(patch.attachments.map(attachment))]; recreate = true; }
    if (patch.userData !== undefined) entry.userData = patch.userData;
    if (recreate) entry.resizing = true; entry.updateRequested = true; entry.generation += 1; this.publish();
  }
  public setVisible(value: unknown, visibleValue: unknown, parentVisibleValue: unknown = true): void { const entry = this.requireTarget(value); entry.visible = bool(visibleValue, 'visible'); entry.parentVisible = bool(parentVisibleValue, 'parent_visible'); this.publish(); }
  public requestUpdate(value: unknown): void { const entry = this.requireTarget(value); entry.updateRequested = true; this.publish(); }
  public requestClear(value: unknown): void { const entry = this.requireTarget(value); entry.clearRequested = true; this.publish(); }

  private shouldRender(entry: TargetEntry): boolean {
    if (entry.updateMode === 'disabled') return false; if (entry.updateMode === 'always') return true;
    if (entry.updateMode === 'once') return entry.updateRequested; if (entry.updateMode === 'when-visible') return entry.visible;
    return entry.parentVisible;
  }
  private shouldClear(entry: TargetEntry): boolean { return entry.clearMode === 'always' || (entry.clearMode === 'once' && entry.clearRequested); }
  private attachmentState(entry: AttachmentEntry): GodotViewportRenderTargetAttachmentState { return Object.freeze({ attachment: entry.attachment, rid: entry.rid, history: Object.freeze([...entry.history]), historyIndex: entry.historyIndex, generation: entry.generation }); }
  private state(entry: TargetEntry): GodotViewportRenderTargetState { return Object.freeze({
    rid: entry.rid, width: entry.width, height: entry.height, viewCount: entry.viewCount, samples: entry.samples, hdr: entry.hdr,
    transparentBackground: entry.transparentBackground, directToScreen: entry.directToScreen, updateMode: entry.updateMode,
    clearMode: entry.clearMode, clearColor: entry.clearColor, historyLength: entry.historyLength,
    attachments: Object.freeze([...entry.attachments.values()].map((one) => this.attachmentState(one))), visible: entry.visible,
    parentVisible: entry.parentVisible, updateRequested: entry.updateRequested, clearRequested: entry.clearRequested,
    resizing: entry.resizing, lastRenderedFrame: entry.lastRenderedFrame, generation: entry.generation, userData: entry.userData,
  }); }

  private async recreate(entry: TargetEntry): Promise<void> {
    this.freeAttachments(entry); entry.width = entry.pendingWidth; entry.height = entry.pendingHeight;
    for (const kind of entry.attachmentKinds) {
      const provisional: AttachmentEntry = { attachment: kind, rid: Object.freeze({ id: 0n }), history: [], historyIndex: 0, generation: entry.generation };
      provisional.rid = rid(await this.backend.allocate(Object.freeze({ target: this.state(entry), attachment: kind, historyIndex: 0 })));
      for (let index = 0; index < entry.historyLength; index += 1) provisional.history.push(rid(await this.backend.allocate(Object.freeze({ target: this.state(entry), attachment: kind, historyIndex: index + 1 }))));
      entry.attachments.set(kind, provisional);
    }
    entry.resizing = false; entry.generation += 1; this.recreations += 1;
  }
  private freeAttachments(entry: TargetEntry): void { for (const attachment of entry.attachments.values()) { this.backend.free(attachment.rid); for (const history of attachment.history) this.backend.free(history); } entry.attachments.clear(); }

  public async processFrame(frameValue: unknown, render: (target: GodotViewportRenderTargetState) => void | Promise<void>): Promise<GodotViewportRenderTargetFrameResult> {
    const frame = integer(frameValue, 'frame'); if (frame < this.frameValue) throw new RangeError('godot-compat: viewport target frame cannot move backwards.'); if (this.processing) throw new Error('godot-compat: viewport target frame already processing.');
    if (typeof render !== 'function') throw new TypeError('godot-compat: viewport target render requires Callable.'); this.frameValue = frame; this.processing = true;
    const rendered: GodotRid[] = [], skipped: GodotRid[] = [], cleared: GodotRid[] = [], presented: GodotRid[] = [], recreated: GodotRid[] = [];
    try {
      for (const entry of [...this.targets.values()].sort((left, right) => left.order - right.order)) {
        if (entry.resizing) { await this.recreate(entry); recreated.push(entry.rid); }
        if (!this.shouldRender(entry)) { skipped.push(entry.rid); continue; }
        if (this.shouldClear(entry)) { await this.backend.clear?.(this.state(entry)); cleared.push(entry.rid); entry.clearRequested = false; }
        await render(this.state(entry)); entry.lastRenderedFrame = frame; entry.updateRequested = false;
        for (const attachment of entry.attachments.values()) if (attachment.history.length > 0) attachment.historyIndex = (attachment.historyIndex + 1) % attachment.history.length;
        rendered.push(entry.rid); if (entry.directToScreen) { await this.backend.present?.(this.state(entry)); presented.push(entry.rid); }
      }
      this.renderedFrames += 1; this.lastFrame = Object.freeze({ frame, rendered: Object.freeze(rendered), skipped: Object.freeze(skipped), cleared: Object.freeze(cleared), presented: Object.freeze(presented), recreated: Object.freeze(recreated) }); this.publish(); return this.lastFrame;
    } finally { this.processing = false; }
  }
  public getAttachment(value: unknown, attachmentValue: unknown, historyOffsetValue = 0): GodotRid | null {
    const entry = this.requireTarget(value), target = entry.attachments.get(attachment(attachmentValue)); if (target === undefined) return null;
    const offset = integer(historyOffsetValue, 'history_offset'); if (offset === 0) return target.rid; if (offset > target.history.length) throw new RangeError('godot-compat: viewport history offset exceeds history length.');
    return target.history[(target.historyIndex - offset + target.history.length) % target.history.length] ?? null;
  }
  public getTarget(value: unknown): GodotViewportRenderTargetState | null { const targetRid = rid(value), entry = this.targets.get(godotRidGetId(targetRid)); return entry === undefined ? null : this.state(entry); }
  public getSnapshot(): GodotViewportRenderTargetRuntimeSnapshot { const targets = [...this.targets.values()].map((entry) => this.state(entry)); return Object.freeze({ frame: this.frameValue, targets: Object.freeze(targets), attachments: targets.reduce((total, target) => total + target.attachments.length, 0), historyTextures: targets.reduce((total, target) => total + target.attachments.reduce((sum, one) => sum + one.history.length, 0), 0), pendingResize: targets.filter((target) => target.resizing).length, renderedFrames: this.renderedFrames, recreations: this.recreations, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotViewportRenderTargetRuntimeSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.processing) throw new Error('godot-compat: cannot clear viewport targets during frame.'); for (const entry of this.targets.values()) this.freeAttachments(entry); this.targets.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotViewportRenderTargetRuntime(backend: GodotViewportRenderTargetBackend): GodotViewportRenderTargetRuntime { return new GodotViewportRenderTargetRuntime(backend); }
