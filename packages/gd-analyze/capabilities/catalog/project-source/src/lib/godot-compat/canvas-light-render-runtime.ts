import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotCanvasLightKind = 'point' | 'directional';
export interface GodotCanvasLightRenderDescriptor {
  readonly rid: GodotRid;
  readonly kind: GodotCanvasLightKind;
  readonly position?: { readonly x: number; readonly y: number };
  readonly direction?: { readonly x: number; readonly y: number };
  readonly radius?: number;
  readonly energy?: number;
  readonly color?: unknown;
  readonly height?: number;
  readonly layerMin?: number;
  readonly layerMax?: number;
  readonly zMin?: number;
  readonly zMax?: number;
  readonly itemMask?: number;
  readonly shadowMask?: number;
  readonly shadowEnabled?: boolean;
  readonly shadowBufferSize?: number;
  readonly shadowFilter?: number;
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly userData?: unknown;
}
export interface GodotCanvasOccluderDescriptor {
  readonly rid: GodotRid;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly closed?: boolean;
  readonly lightMask?: number;
  readonly enabled?: boolean;
  readonly transform?: unknown;
}
export interface GodotCanvasLightItemDescriptor {
  readonly rid: GodotRid;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly layer?: number;
  readonly zIndex?: number;
  readonly lightMask?: number;
  readonly enabled?: boolean;
}
export interface GodotCanvasLightShadowSlot {
  readonly light: GodotRid;
  readonly slot: number;
  readonly size: number;
  readonly dirty: boolean;
  readonly lastRenderedFrame: number;
  readonly generation: number;
}
export interface GodotCanvasLightRenderState extends Required<Omit<GodotCanvasLightRenderDescriptor, 'userData'>> {
  readonly userData: unknown;
  readonly shadowSlot: GodotCanvasLightShadowSlot | null;
  readonly dirty: boolean;
  readonly generation: number;
}
export interface GodotCanvasLightBatch {
  readonly item: GodotRid;
  readonly lights: readonly GodotCanvasLightRenderState[];
  readonly ambient: unknown;
}
export interface GodotCanvasLightFrameResult {
  readonly frame: number;
  readonly shadowUpdates: readonly GodotRid[];
  readonly batches: readonly GodotCanvasLightBatch[];
  readonly visibleLights: number;
  readonly culledLights: number;
  readonly unlitItems: number;
}
export interface GodotCanvasLightRenderBackend {
  allocateShadow?(slot: number, size: number): void | Promise<void>;
  freeShadow?(slot: number): void;
  renderShadow(light: GodotCanvasLightRenderState, occluders: readonly GodotCanvasOccluderDescriptor[]): void | Promise<void>;
  renderBatch(batch: GodotCanvasLightBatch): void | Promise<void>;
}
export interface GodotCanvasLightRuntimeSnapshot {
  readonly frame: number;
  readonly lights: number;
  readonly occluders: number;
  readonly items: number;
  readonly shadowSlots: number;
  readonly dirtyShadows: number;
  readonly shadowCapacity: number;
  readonly shadowBudget: number;
  readonly renderedFrames: number;
  readonly generation: number;
  readonly lastFrame: GodotCanvasLightFrameResult | null;
}

interface LightEntry {
  descriptor: {
    rid: GodotRid; kind: GodotCanvasLightKind; position: { x: number; y: number }; direction: { x: number; y: number };
    radius: number; energy: number; color: unknown; height: number; layerMin: number; layerMax: number;
    zMin: number; zMax: number; itemMask: number; shadowMask: number; shadowEnabled: boolean;
    shadowBufferSize: number; shadowFilter: number; enabled: boolean; priority: number; userData: unknown;
  };
  shadowSlot: GodotCanvasLightShadowSlot | null; dirty: boolean; generation: number; order: number;
}
interface OccluderEntry {
  descriptor: {
    readonly rid: GodotRid;
    readonly points: readonly { readonly x: number; readonly y: number }[];
    readonly closed: boolean;
    readonly lightMask: number;
    readonly enabled: boolean;
    readonly transform: unknown;
  };
  generation: number;
}
interface ItemEntry { descriptor: Required<GodotCanvasLightItemDescriptor>; order: number }

function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: CanvasLightRender.${member} requires integer in [${minimum}, ${maximum}].`); return result;
}
function signed(value: unknown, member: string): number { const result = Number(value); if (!Number.isSafeInteger(result)) throw new RangeError(`godot-compat: CanvasLightRender.${member} requires integer.`); return result; }
function finite(value: unknown, member: string, minimum = -Infinity): number { const result = Number(value); if (!Number.isFinite(result) || result < minimum) throw new RangeError(`godot-compat: CanvasLightRender.${member} requires finite value >= ${minimum}.`); return result; }
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: CanvasLightRender.${member} requires bool.`); return value; }
function rid(value: unknown): GodotRid { if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: CanvasLightRender requires RID.'); godotRidGetId(value); return value as GodotRid; }
function point(value: unknown, member: string): { x: number; y: number } {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) throw new TypeError(`godot-compat: CanvasLightRender.${member} requires Vector2.`);
  return Object.freeze({ x: finite(value.x, `${member}.x`), y: finite(value.y, `${member}.y`) });
}
function bounds(value: unknown): { x: number; y: number; width: number; height: number } {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('width' in value) || !('height' in value)) throw new TypeError('godot-compat: CanvasLightRender.bounds requires Rect2.');
  return Object.freeze({ x: finite(value.x, 'bounds.x'), y: finite(value.y, 'bounds.y'), width: finite(value.width, 'bounds.width', 0), height: finite(value.height, 'bounds.height', 0) });
}
function intersectsCircle(rect: { x: number; y: number; width: number; height: number }, center: { x: number; y: number }, radius: number): boolean {
  const x = Math.max(rect.x, Math.min(center.x, rect.x + rect.width)), y = Math.max(rect.y, Math.min(center.y, rect.y + rect.height));
  return (x - center.x) ** 2 + (y - center.y) ** 2 <= radius ** 2;
}

export class GodotCanvasLightRenderRuntime {
  public readonly __godotClass = 'CanvasLightRenderRuntime';
  private readonly backend: GodotCanvasLightRenderBackend;
  private readonly lights = new Map<bigint, LightEntry>();
  private readonly occluders = new Map<bigint, OccluderEntry>();
  private readonly items = new Map<bigint, ItemEntry>();
  private readonly shadowSlots = new Map<number, LightEntry>();
  private readonly watchers = new Set<(snapshot: GodotCanvasLightRuntimeSnapshot) => void>();
  private frameValue = 0; private shadowCapacityValue = 64; private shadowBudgetValue = 4;
  private nextOrder = 0; private generationValue = 0; private renderedFrames = 0;
  private rendering = false; private ambientValue: unknown = null; private lastFrame: GodotCanvasLightFrameResult | null = null;

  public constructor(backend: GodotCanvasLightRenderBackend) {
    if (typeof backend?.renderShadow !== 'function' || typeof backend?.renderBatch !== 'function') throw new TypeError('godot-compat: CanvasLightRender requires shadow and batch backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'CanvasLightRenderRuntime');
  }

  public addLight(value: GodotCanvasLightRenderDescriptor): void {
    const lightRid = rid(value.rid), id = godotRidGetId(lightRid); if (this.lights.has(id)) throw new Error(`godot-compat: canvas light RID ${id} already exists.`);
    if (value.kind !== 'point' && value.kind !== 'directional') throw new TypeError('godot-compat: canvas light kind requires point or directional.');
    const entry: LightEntry = { descriptor: {
      rid: lightRid, kind: value.kind, position: point(value.position ?? { x: 0, y: 0 }, 'position'), direction: point(value.direction ?? { x: 0, y: 1 }, 'direction'),
      radius: finite(value.radius ?? 256, 'radius', 0), energy: finite(value.energy ?? 1, 'energy', 0), color: value.color ?? null, height: finite(value.height ?? 0, 'height'),
      layerMin: signed(value.layerMin ?? -512, 'layer_min'), layerMax: signed(value.layerMax ?? 512, 'layer_max'), zMin: signed(value.zMin ?? -4096, 'z_min'), zMax: signed(value.zMax ?? 4096, 'z_max'),
      itemMask: integer(value.itemMask ?? 1, 'item_mask', 0, 0xffff_ffff), shadowMask: integer(value.shadowMask ?? 1, 'shadow_mask', 0, 0xffff_ffff),
      shadowEnabled: bool(value.shadowEnabled ?? false, 'shadow_enabled'), shadowBufferSize: integer(value.shadowBufferSize ?? 2048, 'shadow_buffer_size', 32, 16384),
      shadowFilter: integer(value.shadowFilter ?? 0, 'shadow_filter', 0, 3), enabled: bool(value.enabled ?? true, 'enabled'), priority: integer(value.priority ?? 0, 'priority'), userData: value.userData ?? null,
    }, shadowSlot: null, dirty: true, generation: 1, order: this.nextOrder++ };
    if (entry.descriptor.layerMin > entry.descriptor.layerMax || entry.descriptor.zMin > entry.descriptor.zMax) throw new RangeError('godot-compat: canvas light ranges are inverted.');
    this.lights.set(id, entry); this.generationValue += 1; this.publish();
  }

  public removeLight(value: unknown): boolean {
    const lightRid = rid(value), entry = this.lights.get(godotRidGetId(lightRid)); if (entry === undefined) return false;
    this.releaseShadow(entry); this.lights.delete(godotRidGetId(lightRid)); this.generationValue += 1; this.publish(); return true;
  }

  private requireLight(value: unknown): LightEntry { const lightRid = rid(value), entry = this.lights.get(godotRidGetId(lightRid)); if (entry === undefined) throw new Error('godot-compat: canvas light does not exist.'); return entry; }
  public updateLight(value: unknown, patch: Partial<Omit<GodotCanvasLightRenderDescriptor, 'rid' | 'kind'>>): void {
    const entry = this.requireLight(value), descriptor = entry.descriptor;
    if (patch.position !== undefined) descriptor.position = point(patch.position, 'position'); if (patch.direction !== undefined) descriptor.direction = point(patch.direction, 'direction');
    if (patch.radius !== undefined) descriptor.radius = finite(patch.radius, 'radius', 0); if (patch.energy !== undefined) descriptor.energy = finite(patch.energy, 'energy', 0);
    if (patch.color !== undefined) descriptor.color = patch.color; if (patch.height !== undefined) descriptor.height = finite(patch.height, 'height');
    if (patch.layerMin !== undefined) descriptor.layerMin = signed(patch.layerMin, 'layer_min'); if (patch.layerMax !== undefined) descriptor.layerMax = signed(patch.layerMax, 'layer_max');
    if (patch.zMin !== undefined) descriptor.zMin = signed(patch.zMin, 'z_min'); if (patch.zMax !== undefined) descriptor.zMax = signed(patch.zMax, 'z_max');
    if (patch.itemMask !== undefined) descriptor.itemMask = integer(patch.itemMask, 'item_mask', 0, 0xffff_ffff); if (patch.shadowMask !== undefined) descriptor.shadowMask = integer(patch.shadowMask, 'shadow_mask', 0, 0xffff_ffff);
    if (patch.shadowEnabled !== undefined) descriptor.shadowEnabled = bool(patch.shadowEnabled, 'shadow_enabled'); if (patch.shadowBufferSize !== undefined) { descriptor.shadowBufferSize = integer(patch.shadowBufferSize, 'shadow_buffer_size', 32, 16384); this.releaseShadow(entry); }
    if (patch.shadowFilter !== undefined) descriptor.shadowFilter = integer(patch.shadowFilter, 'shadow_filter', 0, 3); if (patch.enabled !== undefined) descriptor.enabled = bool(patch.enabled, 'enabled');
    if (patch.priority !== undefined) descriptor.priority = integer(patch.priority, 'priority'); if (patch.userData !== undefined) descriptor.userData = patch.userData;
    entry.dirty = true; entry.generation += 1; this.publish();
  }

  public addOccluder(value: GodotCanvasOccluderDescriptor): void {
    const occluderRid = rid(value.rid), id = godotRidGetId(occluderRid); if (this.occluders.has(id)) throw new Error('godot-compat: canvas occluder already exists.');
    if (!Array.isArray(value.points) || value.points.length < 2) throw new TypeError('godot-compat: canvas occluder requires at least two points.');
    this.occluders.set(id, { descriptor: Object.freeze({ rid: occluderRid, points: Object.freeze(value.points.map((one) => point(one, 'occluder.point'))), closed: bool(value.closed ?? true, 'occluder.closed'), lightMask: integer(value.lightMask ?? 1, 'occluder.light_mask', 0, 0xffff_ffff), enabled: bool(value.enabled ?? true, 'occluder.enabled'), transform: value.transform ?? null }), generation: 1 });
    this.markShadowsDirty(); this.generationValue += 1; this.publish();
  }
  public removeOccluder(value: unknown): boolean { const occluderRid = rid(value), removed = this.occluders.delete(godotRidGetId(occluderRid)); if (removed) { this.markShadowsDirty(); this.generationValue += 1; this.publish(); } return removed; }
  public updateOccluder(value: GodotCanvasOccluderDescriptor): void { this.removeOccluder(value.rid); this.addOccluder(value); }

  public addItem(value: GodotCanvasLightItemDescriptor): void {
    const itemRid = rid(value.rid), id = godotRidGetId(itemRid); if (this.items.has(id)) throw new Error('godot-compat: canvas light item already exists.');
    this.items.set(id, { descriptor: Object.freeze({ rid: itemRid, bounds: bounds(value.bounds), layer: signed(value.layer ?? 0, 'item.layer'), zIndex: signed(value.zIndex ?? 0, 'item.z_index'), lightMask: integer(value.lightMask ?? 1, 'item.light_mask', 0, 0xffff_ffff), enabled: bool(value.enabled ?? true, 'item.enabled') }), order: this.nextOrder++ }); this.publish();
  }
  public removeItem(value: unknown): boolean { const itemRid = rid(value), removed = this.items.delete(godotRidGetId(itemRid)); if (removed) this.publish(); return removed; }

  private markShadowsDirty(): void { for (const entry of this.lights.values()) if (entry.descriptor.shadowEnabled) entry.dirty = true; }
  private state(entry: LightEntry): GodotCanvasLightRenderState { return Object.freeze({ ...entry.descriptor, shadowSlot: entry.shadowSlot, dirty: entry.dirty, generation: entry.generation }); }
  private async allocateShadow(entry: LightEntry): Promise<void> {
    if (entry.shadowSlot !== null || !entry.descriptor.shadowEnabled) return; let slot = 0; while (this.shadowSlots.has(slot) && slot < this.shadowCapacityValue) slot += 1;
    if (slot >= this.shadowCapacityValue) throw new Error('godot-compat: canvas shadow atlas capacity exhausted.');
    await this.backend.allocateShadow?.(slot, entry.descriptor.shadowBufferSize); entry.shadowSlot = Object.freeze({ light: entry.descriptor.rid, slot, size: entry.descriptor.shadowBufferSize, dirty: true, lastRenderedFrame: -1, generation: 1 }); this.shadowSlots.set(slot, entry);
  }
  private releaseShadow(entry: LightEntry): void { if (entry.shadowSlot === null) return; this.backend.freeShadow?.(entry.shadowSlot.slot); this.shadowSlots.delete(entry.shadowSlot.slot); entry.shadowSlot = null; }

  public async renderFrame(frameValue: unknown): Promise<GodotCanvasLightFrameResult> {
    const frame = integer(frameValue, 'frame'); if (frame < this.frameValue) throw new RangeError('godot-compat: canvas lighting frame cannot move backwards.'); if (this.rendering) throw new Error('godot-compat: canvas lighting already rendering.');
    this.frameValue = frame; this.rendering = true; const shadowUpdates: GodotRid[] = [], batches: GodotCanvasLightBatch[] = []; let visibleLights = 0, unlitItems = 0;
    try {
      const shadowQueue = [...this.lights.values()].filter((entry) => entry.descriptor.enabled && entry.descriptor.shadowEnabled && entry.dirty).sort((left, right) => right.descriptor.priority - left.descriptor.priority || left.order - right.order).slice(0, this.shadowBudgetValue);
      for (const entry of shadowQueue) {
        await this.allocateShadow(entry); const occluders = [...this.occluders.values()].map((one) => one.descriptor).filter((one) => one.enabled && (one.lightMask & entry.descriptor.shadowMask) !== 0);
        await this.backend.renderShadow(this.state(entry), Object.freeze(occluders)); entry.dirty = false;
        entry.shadowSlot = Object.freeze({ ...entry.shadowSlot!, dirty: false, lastRenderedFrame: frame, generation: entry.shadowSlot!.generation + 1 }); shadowUpdates.push(entry.descriptor.rid);
      }
      for (const item of [...this.items.values()].filter((entry) => entry.descriptor.enabled).sort((left, right) => left.descriptor.layer - right.descriptor.layer || left.descriptor.zIndex - right.descriptor.zIndex || left.order - right.order)) {
        const lights = [...this.lights.values()].filter((entry) => {
          const light = entry.descriptor; return light.enabled && item.descriptor.layer >= light.layerMin && item.descriptor.layer <= light.layerMax && item.descriptor.zIndex >= light.zMin && item.descriptor.zIndex <= light.zMax && (item.descriptor.lightMask & light.itemMask) !== 0 && (light.kind === 'directional' || intersectsCircle(item.descriptor.bounds, light.position, light.radius));
        }).sort((left, right) => right.descriptor.priority - left.descriptor.priority || left.order - right.order);
        if (lights.length === 0) unlitItems += 1; else visibleLights += lights.length;
        const batch = Object.freeze({ item: item.descriptor.rid, lights: Object.freeze(lights.map((entry) => this.state(entry))), ambient: this.ambientValue }); batches.push(batch); await this.backend.renderBatch(batch);
      }
      this.renderedFrames += 1; this.lastFrame = Object.freeze({ frame, shadowUpdates: Object.freeze(shadowUpdates), batches: Object.freeze(batches), visibleLights, culledLights: this.lights.size - new Set(batches.flatMap((batch) => batch.lights.map((light) => godotRidGetId(light.rid)))).size, unlitItems }); this.publish(); return this.lastFrame;
    } finally { this.rendering = false; }
  }

  public setAmbient(value: unknown): void { this.ambientValue = value; this.publish(); }
  public setShadowCapacity(value: unknown): void { const capacity = integer(value, 'shadow_capacity', 1); if (capacity < this.shadowSlots.size) throw new Error('godot-compat: shadow capacity below allocated slots.'); this.shadowCapacityValue = capacity; }
  public setShadowBudget(value: unknown): void { this.shadowBudgetValue = integer(value, 'shadow_budget', 1); }
  public getSnapshot(): GodotCanvasLightRuntimeSnapshot { return Object.freeze({ frame: this.frameValue, lights: this.lights.size, occluders: this.occluders.size, items: this.items.size, shadowSlots: this.shadowSlots.size, dirtyShadows: [...this.lights.values()].filter((entry) => entry.descriptor.shadowEnabled && entry.dirty).length, shadowCapacity: this.shadowCapacityValue, shadowBudget: this.shadowBudgetValue, renderedFrames: this.renderedFrames, generation: this.generationValue, lastFrame: this.lastFrame }); }
  public watch(watcher: (snapshot: GodotCanvasLightRuntimeSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void { if (this.rendering) throw new Error('godot-compat: cannot clear canvas lighting while rendering.'); for (const entry of this.lights.values()) this.releaseShadow(entry); this.lights.clear(); this.occluders.clear(); this.items.clear(); this.lastFrame = null; this.generationValue += 1; this.publish(); }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotCanvasLightRenderRuntime(backend: GodotCanvasLightRenderBackend): GodotCanvasLightRenderRuntime { return new GodotCanvasLightRenderRuntime(backend); }
