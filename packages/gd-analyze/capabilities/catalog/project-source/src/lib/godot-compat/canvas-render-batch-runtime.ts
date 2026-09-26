import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotCanvasRenderPrimitive = 'rect' | 'nine-patch' | 'polygon' | 'mesh' | 'multimesh' | 'text' | 'particles';
export type GodotCanvasRenderBlendMode = 'mix' | 'add' | 'subtract' | 'multiply' | 'premultiplied' | 'disabled';

export interface GodotCanvasRenderCommand {
  readonly id: number;
  readonly primitive: GodotCanvasRenderPrimitive;
  readonly texture?: GodotRid | null;
  readonly normalMap?: GodotRid | null;
  readonly material?: GodotRid | null;
  readonly transform?: unknown;
  readonly modulate?: unknown;
  readonly geometry?: unknown;
  readonly clipRect?: unknown;
  readonly blendMode?: GodotCanvasRenderBlendMode;
  readonly antialiased?: boolean;
  readonly userData?: unknown;
}

export interface GodotCanvasRenderItemDescriptor {
  readonly rid: GodotRid;
  readonly canvasLayer?: number;
  readonly zIndex?: number;
  readonly zRelative?: boolean;
  readonly ySort?: boolean;
  readonly yPosition?: number;
  readonly drawIndex?: number;
  readonly visibilityLayer?: number;
  readonly visible?: boolean;
  readonly clipChildren?: boolean;
  readonly parent?: GodotRid | null;
  readonly commands?: readonly GodotCanvasRenderCommand[];
  readonly userData?: unknown;
}

export interface GodotCanvasRenderItemState {
  readonly rid: GodotRid;
  readonly canvasLayer: number;
  readonly zIndex: number;
  readonly finalZIndex: number;
  readonly zRelative: boolean;
  readonly ySort: boolean;
  readonly yPosition: number;
  readonly drawIndex: number;
  readonly visibilityLayer: number;
  readonly visible: boolean;
  readonly clipChildren: boolean;
  readonly parent: GodotRid | null;
  readonly commands: readonly GodotCanvasRenderCommand[];
  readonly dirty: boolean;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotCanvasRenderBatch {
  readonly key: string;
  readonly canvasLayer: number;
  readonly zIndex: number;
  readonly texture: GodotRid | null;
  readonly normalMap: GodotRid | null;
  readonly material: GodotRid | null;
  readonly blendMode: GodotCanvasRenderBlendMode;
  readonly clipRect: unknown;
  readonly items: readonly GodotCanvasRenderItemState[];
  readonly commands: readonly GodotCanvasRenderCommand[];
}

export interface GodotCanvasRenderFrame {
  readonly frame: number;
  readonly visibilityMask: number;
  readonly batches: readonly GodotCanvasRenderBatch[];
  readonly visibleItems: number;
  readonly culledItems: number;
  readonly commands: number;
  readonly rebuiltItems: number;
}

export interface GodotCanvasRenderBackend {
  rebuild?(item: GodotCanvasRenderItemState): void | Promise<void>;
  render(batch: GodotCanvasRenderBatch): void | Promise<void>;
  remove?(rid: GodotRid): void;
}

export interface GodotCanvasRenderBatchSnapshot {
  readonly frame: number;
  readonly items: number;
  readonly commands: number;
  readonly dirtyItems: number;
  readonly batches: number;
  readonly renderedFrames: number;
  readonly generation: number;
  readonly lastFrame: GodotCanvasRenderFrame | null;
}

interface ItemEntry {
  rid: GodotRid;
  canvasLayer: number;
  zIndex: number;
  zRelative: boolean;
  ySort: boolean;
  yPosition: number;
  drawIndex: number;
  visibilityLayer: number;
  visible: boolean;
  clipChildren: boolean;
  parent: GodotRid | null;
  children: Set<bigint>;
  commands: GodotCanvasRenderCommand[];
  dirty: boolean;
  generation: number;
  order: number;
  userData: unknown;
}

const PRIMITIVES = new Set<GodotCanvasRenderPrimitive>(['rect', 'nine-patch', 'polygon', 'mesh', 'multimesh', 'text', 'particles']);
const BLENDS = new Set<GodotCanvasRenderBlendMode>(['mix', 'add', 'subtract', 'multiply', 'premultiplied', 'disabled']);

function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: CanvasRenderBatch.${member} requires integer in [${minimum}, ${maximum}].`); return result;
}
function signedInteger(value: unknown, member: string, minimum: number, maximum: number): number {
  const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: CanvasRenderBatch.${member} requires integer in [${minimum}, ${maximum}].`); return result;
}
function finite(value: unknown, member: string): number {
  const result = Number(value); if (!Number.isFinite(result)) throw new RangeError(`godot-compat: CanvasRenderBatch.${member} requires finite value.`); return result;
}
function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: CanvasRenderBatch.${member} requires bool.`); return value;
}
function rid(value: unknown): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: CanvasRenderBatch requires RID.'); godotRidGetId(value); return value as GodotRid;
}
function optionalRid(value: unknown): GodotRid | null { return value === null || value === undefined ? null : rid(value); }
function primitive(value: unknown): GodotCanvasRenderPrimitive {
  if (!PRIMITIVES.has(value as GodotCanvasRenderPrimitive)) throw new TypeError(`godot-compat: unknown canvas primitive ${String(value)}.`); return value as GodotCanvasRenderPrimitive;
}
function blend(value: unknown): GodotCanvasRenderBlendMode {
  if (!BLENDS.has(value as GodotCanvasRenderBlendMode)) throw new TypeError(`godot-compat: unknown canvas blend mode ${String(value)}.`); return value as GodotCanvasRenderBlendMode;
}
function command(value: GodotCanvasRenderCommand): GodotCanvasRenderCommand {
  return Object.freeze({
    ...value, id: integer(value.id, 'command.id'), primitive: primitive(value.primitive),
    texture: optionalRid(value.texture), normalMap: optionalRid(value.normalMap), material: optionalRid(value.material),
    blendMode: blend(value.blendMode ?? 'mix'), antialiased: bool(value.antialiased ?? false, 'antialiased'),
  });
}

export class GodotCanvasRenderBatchRuntime {
  public readonly __godotClass = 'CanvasRenderBatchRuntime';
  private readonly backend: GodotCanvasRenderBackend;
  private readonly items = new Map<bigint, ItemEntry>();
  private readonly watchers = new Set<(snapshot: GodotCanvasRenderBatchSnapshot) => void>();
  private frameValue = 0;
  private nextOrder = 0;
  private generationValue = 0;
  private renderedFrames = 0;
  private rendering = false;
  private lastFrame: GodotCanvasRenderFrame | null = null;

  public constructor(backend: GodotCanvasRenderBackend) {
    if (typeof backend?.render !== 'function') throw new TypeError('godot-compat: CanvasRenderBatch requires render backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'CanvasRenderBatchRuntime');
  }

  public addItem(value: GodotCanvasRenderItemDescriptor): void {
    const itemRid = rid(value.rid), id = godotRidGetId(itemRid); if (this.items.has(id)) throw new Error(`godot-compat: canvas item RID ${id} already exists.`);
    const parent = optionalRid(value.parent);
    if (parent !== null && !this.items.has(godotRidGetId(parent))) throw new Error('godot-compat: canvas item parent does not exist.');
    const commands = [...(value.commands ?? [])].map(command);
    if (new Set(commands.map((entry) => entry.id)).size !== commands.length) throw new Error('godot-compat: canvas command IDs must be unique per item.');
    const entry: ItemEntry = {
      rid: itemRid, canvasLayer: signedInteger(value.canvasLayer ?? 0, 'canvas_layer', -128, 127), zIndex: signedInteger(value.zIndex ?? 0, 'z_index', -4096, 4096),
      zRelative: bool(value.zRelative ?? true, 'z_relative'), ySort: bool(value.ySort ?? false, 'y_sort'), yPosition: finite(value.yPosition ?? 0, 'y_position'),
      drawIndex: integer(value.drawIndex ?? this.nextOrder, 'draw_index'), visibilityLayer: integer(value.visibilityLayer ?? 1, 'visibility_layer', 0, 0xffff_ffff),
      visible: bool(value.visible ?? true, 'visible'), clipChildren: bool(value.clipChildren ?? false, 'clip_children'), parent,
      children: new Set(), commands, dirty: true, generation: 1, order: this.nextOrder++, userData: value.userData ?? null,
    };
    this.items.set(id, entry); if (parent !== null) this.items.get(godotRidGetId(parent))!.children.add(id);
    this.assertAcyclic(); this.generationValue += 1; this.publish();
  }

  public removeItem(value: unknown, recursive = false): boolean {
    const itemRid = rid(value), entry = this.items.get(godotRidGetId(itemRid)); if (entry === undefined) return false;
    if (entry.children.size > 0 && !recursive) throw new Error('godot-compat: canvas item has children.');
    for (const child of [...entry.children]) this.removeItem(Object.freeze({ id: child }), true);
    if (entry.parent !== null) this.items.get(godotRidGetId(entry.parent))?.children.delete(godotRidGetId(entry.rid));
    this.items.delete(godotRidGetId(entry.rid)); this.backend.remove?.(entry.rid); this.generationValue += 1; this.publish(); return true;
  }

  private requireEntry(value: unknown): ItemEntry {
    const itemRid = rid(value), entry = this.items.get(godotRidGetId(itemRid)); if (entry === undefined) throw new Error(`godot-compat: canvas item RID ${godotRidGetId(itemRid)} does not exist.`); return entry;
  }

  public setParent(value: unknown, parentValue: unknown): void {
    const entry = this.requireEntry(value), parent = optionalRid(parentValue), id = godotRidGetId(entry.rid);
    if (parent !== null && !this.items.has(godotRidGetId(parent))) throw new Error('godot-compat: canvas parent does not exist.');
    if (entry.parent !== null) this.items.get(godotRidGetId(entry.parent))?.children.delete(id);
    const previous = entry.parent; entry.parent = parent; if (parent !== null) this.items.get(godotRidGetId(parent))!.children.add(id);
    try { this.assertAcyclic(); } catch (error) {
      if (parent !== null) this.items.get(godotRidGetId(parent))?.children.delete(id); entry.parent = previous;
      if (previous !== null) this.items.get(godotRidGetId(previous))?.children.add(id); throw error;
    }
    this.markSubtreeDirty(entry); this.generationValue += 1; this.publish();
  }

  private assertAcyclic(): void {
    for (const entry of this.items.values()) {
      const visited = new Set<bigint>(); let current: ItemEntry | undefined = entry;
      while (current !== undefined && current.parent !== null) {
        const id = godotRidGetId(current.rid); if (visited.has(id)) throw new Error('godot-compat: canvas item parent cycle.'); visited.add(id);
        current = this.items.get(godotRidGetId(current.parent));
      }
    }
  }

  private markSubtreeDirty(entry: ItemEntry): void {
    entry.dirty = true; entry.generation += 1;
    for (const child of entry.children) { const target = this.items.get(child); if (target !== undefined) this.markSubtreeDirty(target); }
  }

  public updateItem(value: unknown, patch: Partial<Omit<GodotCanvasRenderItemDescriptor, 'rid' | 'parent' | 'commands'>>): void {
    const entry = this.requireEntry(value);
    if (patch.canvasLayer !== undefined) entry.canvasLayer = signedInteger(patch.canvasLayer, 'canvas_layer', -128, 127);
    if (patch.zIndex !== undefined) entry.zIndex = signedInteger(patch.zIndex, 'z_index', -4096, 4096);
    if (patch.zRelative !== undefined) entry.zRelative = bool(patch.zRelative, 'z_relative');
    if (patch.ySort !== undefined) entry.ySort = bool(patch.ySort, 'y_sort');
    if (patch.yPosition !== undefined) entry.yPosition = finite(patch.yPosition, 'y_position');
    if (patch.drawIndex !== undefined) entry.drawIndex = integer(patch.drawIndex, 'draw_index');
    if (patch.visibilityLayer !== undefined) entry.visibilityLayer = integer(patch.visibilityLayer, 'visibility_layer', 0, 0xffff_ffff);
    if (patch.visible !== undefined) entry.visible = bool(patch.visible, 'visible');
    if (patch.clipChildren !== undefined) entry.clipChildren = bool(patch.clipChildren, 'clip_children');
    if (patch.userData !== undefined) entry.userData = patch.userData;
    this.markSubtreeDirty(entry); this.generationValue += 1; this.publish();
  }

  public addCommand(value: unknown, commandValue: GodotCanvasRenderCommand): void {
    const entry = this.requireEntry(value), normalized = command(commandValue);
    if (entry.commands.some((existing) => existing.id === normalized.id)) throw new Error(`godot-compat: canvas command ${normalized.id} already exists.`);
    entry.commands.push(normalized); this.markSubtreeDirty(entry); this.publish();
  }

  public updateCommand(value: unknown, commandIdValue: unknown, patch: Partial<Omit<GodotCanvasRenderCommand, 'id'>>): void {
    const entry = this.requireEntry(value), commandId = integer(commandIdValue, 'command_id'), index = entry.commands.findIndex((existing) => existing.id === commandId);
    if (index < 0) throw new Error(`godot-compat: canvas command ${commandId} does not exist.`);
    entry.commands[index] = command({ ...entry.commands[index]!, ...patch, id: commandId }); this.markSubtreeDirty(entry); this.publish();
  }

  public removeCommand(value: unknown, commandIdValue: unknown): boolean {
    const entry = this.requireEntry(value), commandId = integer(commandIdValue, 'command_id'), index = entry.commands.findIndex((existing) => existing.id === commandId);
    if (index < 0) return false; entry.commands.splice(index, 1); this.markSubtreeDirty(entry); this.publish(); return true;
  }

  private finalZ(entry: ItemEntry): number {
    if (!entry.zRelative || entry.parent === null) return entry.zIndex;
    const parent = this.items.get(godotRidGetId(entry.parent)); return entry.zIndex + (parent === undefined ? 0 : this.finalZ(parent));
  }

  private inheritedVisible(entry: ItemEntry): boolean {
    if (!entry.visible) return false; if (entry.parent === null) return true;
    const parent = this.items.get(godotRidGetId(entry.parent)); return parent === undefined || this.inheritedVisible(parent);
  }

  private state(entry: ItemEntry): GodotCanvasRenderItemState {
    return Object.freeze({
      rid: entry.rid, canvasLayer: entry.canvasLayer, zIndex: entry.zIndex, finalZIndex: this.finalZ(entry),
      zRelative: entry.zRelative, ySort: entry.ySort, yPosition: entry.yPosition, drawIndex: entry.drawIndex,
      visibilityLayer: entry.visibilityLayer, visible: entry.visible, clipChildren: entry.clipChildren, parent: entry.parent,
      commands: Object.freeze([...entry.commands]), dirty: entry.dirty, generation: entry.generation, userData: entry.userData,
    });
  }

  private batchKey(item: GodotCanvasRenderItemState, draw: GodotCanvasRenderCommand): string {
    const key = (value: GodotRid | null | undefined) => value == null ? '-' : godotRidGetId(value).toString(16);
    return `${item.canvasLayer}:${item.finalZIndex}:${key(draw.texture)}:${key(draw.normalMap)}:${key(draw.material)}:${draw.blendMode}:${JSON.stringify(draw.clipRect ?? null)}`;
  }

  public async renderFrame(frameValue: unknown, visibilityMaskValue: unknown = 0xffff_ffff): Promise<GodotCanvasRenderFrame> {
    const frame = integer(frameValue, 'frame'), visibilityMask = integer(visibilityMaskValue, 'visibility_mask', 0, 0xffff_ffff);
    if (frame < this.frameValue) throw new RangeError('godot-compat: canvas render frame cannot move backwards.');
    if (this.rendering) throw new Error('godot-compat: canvas rendering already in progress.'); this.frameValue = frame; this.rendering = true;
    try {
      const visible = [...this.items.values()].filter((entry) => this.inheritedVisible(entry) && (entry.visibilityLayer & visibilityMask) !== 0)
        .sort((left, right) => left.canvasLayer - right.canvasLayer || this.finalZ(left) - this.finalZ(right) || (left.ySort || right.ySort ? left.yPosition - right.yPosition : 0) || left.drawIndex - right.drawIndex || left.order - right.order);
      let rebuiltItems = 0;
      for (const entry of visible) if (entry.dirty) { await this.backend.rebuild?.(this.state(entry)); entry.dirty = false; rebuiltItems += 1; }
      const batches: GodotCanvasRenderBatch[] = []; let current: { key: string; items: GodotCanvasRenderItemState[]; commands: GodotCanvasRenderCommand[] } | null = null;
      const flush = () => {
        if (current === null) return; const firstItem = current.items[0]!, first = current.commands[0]!;
        batches.push(Object.freeze({ key: current.key, canvasLayer: firstItem.canvasLayer, zIndex: firstItem.finalZIndex,
          texture: first.texture ?? null, normalMap: first.normalMap ?? null, material: first.material ?? null,
          blendMode: first.blendMode ?? 'mix', clipRect: first.clipRect ?? null,
          items: Object.freeze([...current.items]), commands: Object.freeze([...current.commands]) })); current = null;
      };
      for (const entry of visible) {
        const item = this.state(entry);
        for (const draw of entry.commands) {
          const key = this.batchKey(item, draw); if (current === null || current.key !== key) { flush(); current = { key, items: [], commands: [] }; }
          current.items.push(item); current.commands.push(draw);
        }
      }
      flush(); for (const batch of batches) await this.backend.render(batch);
      this.renderedFrames += 1;
      this.lastFrame = Object.freeze({
        frame, visibilityMask, batches: Object.freeze(batches), visibleItems: visible.length,
        culledItems: this.items.size - visible.length, commands: batches.reduce((total, batch) => total + batch.commands.length, 0), rebuiltItems,
      });
      this.publish(); return this.lastFrame;
    } finally { this.rendering = false; }
  }

  public getItem(value: unknown): GodotCanvasRenderItemState | null {
    const itemRid = rid(value), entry = this.items.get(godotRidGetId(itemRid)); return entry === undefined ? null : this.state(entry);
  }
  public getSnapshot(): GodotCanvasRenderBatchSnapshot {
    let commands = 0, dirtyItems = 0; for (const entry of this.items.values()) { commands += entry.commands.length; if (entry.dirty) dirtyItems += 1; }
    return Object.freeze({ frame: this.frameValue, items: this.items.size, commands, dirtyItems, batches: this.lastFrame?.batches.length ?? 0, renderedFrames: this.renderedFrames, generation: this.generationValue, lastFrame: this.lastFrame });
  }
  public watch(watcher: (snapshot: GodotCanvasRenderBatchSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void {
    if (this.rendering) throw new Error('godot-compat: cannot clear canvas render items during frame.');
    for (const entry of this.items.values()) this.backend.remove?.(entry.rid); this.items.clear(); this.lastFrame = null; this.generationValue += 1; this.publish();
  }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotCanvasRenderBatchRuntime(backend: GodotCanvasRenderBackend): GodotCanvasRenderBatchRuntime {
  return new GodotCanvasRenderBatchRuntime(backend);
}
