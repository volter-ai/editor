import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export interface GodotTextureStreamingDescriptor {
  readonly rid: GodotRid;
  readonly width: number;
  readonly height: number;
  readonly mipCount: number;
  readonly bytesPerPixel?: number;
  readonly minimumResidentMip?: number;
  readonly priority?: number;
  readonly persistent?: boolean;
  readonly enabled?: boolean;
  readonly userData?: unknown;
}

export interface GodotTextureStreamingState {
  readonly rid: GodotRid;
  readonly width: number;
  readonly height: number;
  readonly mipCount: number;
  readonly bytesPerPixel: number;
  readonly minimumResidentMip: number;
  readonly priority: number;
  readonly persistent: boolean;
  readonly enabled: boolean;
  readonly requestedMip: number;
  readonly residentMip: number;
  readonly loadingMip: number | null;
  readonly residentBytes: number;
  readonly lastVisibleFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}

export interface GodotTextureStreamingRequest {
  readonly texture: GodotRid;
  readonly mip: number;
  readonly priority: number;
  readonly estimatedBytes: number;
}

export interface GodotTextureStreamingBackend {
  load(request: GodotTextureStreamingRequest): Uint8Array | Promise<Uint8Array>;
  upload(texture: GodotRid, mip: number, data: Uint8Array): void | Promise<void>;
  evict(texture: GodotRid, mip: number): void;
}

export interface GodotTextureStreamingFrameResult {
  readonly frame: number;
  readonly loaded: readonly GodotTextureStreamingRequest[];
  readonly deferred: readonly GodotTextureStreamingRequest[];
  readonly evicted: readonly { texture: GodotRid; mip: number }[];
  readonly failed: readonly { request: GodotTextureStreamingRequest; error: unknown }[];
  readonly residentBytes: number;
}

export interface GodotTextureStreamingSnapshot {
  readonly frame: number;
  readonly textures: readonly GodotTextureStreamingState[];
  readonly residentBytes: number;
  readonly memoryBudget: number;
  readonly uploadBudget: number;
  readonly pendingRequests: number;
  readonly loads: number;
  readonly evictions: number;
  readonly generation: number;
  readonly lastFrame: GodotTextureStreamingFrameResult | null;
}

interface Entry {
  rid: GodotRid;
  width: number;
  height: number;
  mipCount: number;
  bytesPerPixel: number;
  minimumResidentMip: number;
  priority: number;
  persistent: boolean;
  enabled: boolean;
  requestedMip: number;
  residentMip: number;
  loadingMip: number | null;
  lastVisibleFrame: number;
  generation: number;
  userData: unknown;
  order: number;
}

function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: TextureStreamingRuntime.${member} requires integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function finite(value: unknown, member: string, minimum = -Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum) {
    throw new RangeError(`godot-compat: TextureStreamingRuntime.${member} requires finite value >= ${minimum}.`);
  }
  return result;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: TextureStreamingRuntime.${member} requires bool.`);
  return value;
}

function rid(value: unknown): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: TextureStreamingRuntime requires RID.');
  godotRidGetId(value);
  return value as GodotRid;
}

function mipSize(entry: Entry, mip: number): number {
  return Math.max(1, entry.width >> mip) * Math.max(1, entry.height >> mip) * entry.bytesPerPixel;
}

function residentBytes(entry: Entry): number {
  let bytes = 0;
  for (let mip = entry.residentMip; mip < entry.mipCount; mip += 1) bytes += mipSize(entry, mip);
  return bytes;
}

function state(entry: Entry): GodotTextureStreamingState {
  return Object.freeze({ ...entry, residentBytes: residentBytes(entry) });
}

export class GodotTextureStreamingRuntime {
  public readonly __godotClass = 'TextureStreamingRuntime';
  private readonly backend: GodotTextureStreamingBackend;
  private readonly entries = new Map<bigint, Entry>();
  private readonly watchers = new Set<(snapshot: GodotTextureStreamingSnapshot) => void>();
  private frameValue = 0;
  private memoryBudgetValue = 512 * 1024 * 1024;
  private uploadBudgetValue = 16 * 1024 * 1024;
  private nextOrder = 0;
  private generationValue = 0;
  private loads = 0;
  private evictions = 0;
  private processing = false;
  private lastFrame: GodotTextureStreamingFrameResult | null = null;

  public constructor(backend: GodotTextureStreamingBackend) {
    if (typeof backend?.load !== 'function' || typeof backend?.upload !== 'function' || typeof backend?.evict !== 'function') {
      throw new TypeError('godot-compat: TextureStreamingRuntime requires load, upload, and evict backend.');
    }
    this.backend = backend;
    registerGodotObjectIdentity(this, 'TextureStreamingRuntime');
  }

  public addTexture(value: GodotTextureStreamingDescriptor): void {
    const texture = rid(value.rid);
    const id = godotRidGetId(texture);
    if (this.entries.has(id)) throw new Error('godot-compat: streaming texture already exists.');
    const mipCount = integer(value.mipCount, 'mip_count', 1, 32);
    const minimumResidentMip = integer(value.minimumResidentMip ?? mipCount - 1, 'minimum_resident_mip', 0, mipCount - 1);
    this.entries.set(id, {
      rid: texture,
      width: integer(value.width, 'width', 1, 65536),
      height: integer(value.height, 'height', 1, 65536),
      mipCount,
      bytesPerPixel: integer(value.bytesPerPixel ?? 4, 'bytes_per_pixel', 1, 32),
      minimumResidentMip,
      priority: finite(value.priority ?? 0, 'priority'),
      persistent: bool(value.persistent ?? false, 'persistent'),
      enabled: bool(value.enabled ?? true, 'enabled'),
      requestedMip: minimumResidentMip,
      residentMip: mipCount,
      loadingMip: null,
      lastVisibleFrame: -1,
      generation: 1,
      userData: value.userData ?? null,
      order: this.nextOrder++,
    });
    this.generationValue += 1;
    this.publish();
  }

  public removeTexture(value: unknown): boolean {
    const texture = rid(value);
    const entry = this.entries.get(godotRidGetId(texture));
    if (entry === undefined) return false;
    for (let mip = entry.residentMip; mip < entry.mipCount; mip += 1) this.backend.evict(entry.rid, mip);
    this.entries.delete(godotRidGetId(texture));
    this.generationValue += 1;
    this.publish();
    return true;
  }

  private requireEntry(value: unknown): Entry {
    const texture = rid(value);
    const entry = this.entries.get(godotRidGetId(texture));
    if (entry === undefined) throw new Error('godot-compat: streaming texture does not exist.');
    return entry;
  }

  public requestMip(value: unknown, mipValue: unknown, visible = true): void {
    const entry = this.requireEntry(value);
    const mip = integer(mipValue, 'mip', 0, entry.mipCount - 1);
    entry.requestedMip = Math.min(mip, entry.minimumResidentMip);
    if (visible) entry.lastVisibleFrame = this.frameValue;
    entry.generation += 1;
    this.publish();
  }

  public requestByProjectedSize(value: unknown, projectedPixelsValue: unknown): number {
    const entry = this.requireEntry(value);
    const projectedPixels = finite(projectedPixelsValue, 'projected_pixels', 0);
    const maximumDimension = Math.max(entry.width, entry.height);
    const mip = Math.max(0, Math.min(entry.mipCount - 1, Math.floor(Math.log2(Math.max(1, maximumDimension / Math.max(1, projectedPixels))))));
    this.requestMip(entry.rid, mip, true);
    return mip;
  }

  public setEnabled(value: unknown, enabledValue: unknown): void {
    const entry = this.requireEntry(value);
    entry.enabled = bool(enabledValue, 'enabled');
    this.publish();
  }

  private request(entry: Entry, mip: number): GodotTextureStreamingRequest {
    return Object.freeze({
      texture: entry.rid,
      mip,
      priority: entry.priority + Math.max(0, entry.residentMip - mip) * 1000 + Math.max(0, this.frameValue - entry.lastVisibleFrame),
      estimatedBytes: mipSize(entry, mip),
    });
  }

  private totalResidentBytes(): number {
    let bytes = 0;
    for (const entry of this.entries.values()) bytes += residentBytes(entry);
    return bytes;
  }

  private evictToBudget(evicted: Array<{ texture: GodotRid; mip: number }>): void {
    let retained = this.totalResidentBytes();
    if (retained <= this.memoryBudgetValue) return;
    const candidates = [...this.entries.values()]
      .filter((entry) => !entry.persistent && entry.residentMip < entry.minimumResidentMip)
      .sort((left, right) => left.lastVisibleFrame - right.lastVisibleFrame || left.priority - right.priority || left.order - right.order);
    while (retained > this.memoryBudgetValue) {
      const candidate = candidates.find((entry) => entry.residentMip < entry.minimumResidentMip);
      if (candidate === undefined) break;
      const mip = candidate.residentMip;
      this.backend.evict(candidate.rid, mip);
      candidate.residentMip += 1;
      candidate.requestedMip = Math.max(candidate.requestedMip, candidate.residentMip);
      retained -= mipSize(candidate, mip);
      this.evictions += 1;
      evicted.push(Object.freeze({ texture: candidate.rid, mip }));
    }
  }

  public async processFrame(frameValue: unknown): Promise<GodotTextureStreamingFrameResult> {
    const frame = integer(frameValue, 'frame');
    if (frame < this.frameValue) throw new RangeError('godot-compat: texture streaming frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: texture streaming frame already processing.');
    this.frameValue = frame;
    this.processing = true;
    const loaded: GodotTextureStreamingRequest[] = [];
    const deferred: GodotTextureStreamingRequest[] = [];
    const evicted: Array<{ texture: GodotRid; mip: number }> = [];
    const failed: Array<{ request: GodotTextureStreamingRequest; error: unknown }> = [];
    let uploadBudget = this.uploadBudgetValue;
    try {
      const requests = [...this.entries.values()]
        .filter((entry) => entry.enabled && entry.loadingMip === null && entry.requestedMip < entry.residentMip)
        .map((entry) => this.request(entry, entry.residentMip - 1))
        .sort((left, right) => right.priority - left.priority || left.estimatedBytes - right.estimatedBytes);
      for (const request of requests) {
        if (request.estimatedBytes > uploadBudget) {
          deferred.push(request);
          continue;
        }
        const entry = this.requireEntry(request.texture);
        entry.loadingMip = request.mip;
        try {
          const data = await this.backend.load(request);
          await this.backend.upload(entry.rid, request.mip, data);
          entry.residentMip = request.mip;
          entry.loadingMip = null;
          entry.generation += 1;
          uploadBudget -= request.estimatedBytes;
          loaded.push(request);
          this.loads += 1;
        } catch (error) {
          entry.loadingMip = null;
          failed.push(Object.freeze({ request, error }));
        }
      }
      this.evictToBudget(evicted);
      this.lastFrame = Object.freeze({
        frame,
        loaded: Object.freeze(loaded),
        deferred: Object.freeze(deferred),
        evicted: Object.freeze(evicted),
        failed: Object.freeze(failed),
        residentBytes: this.totalResidentBytes(),
      });
      this.publish();
      return this.lastFrame;
    } finally {
      this.processing = false;
    }
  }

  public setMemoryBudget(value: unknown): void {
    this.memoryBudgetValue = integer(value, 'memory_budget', 1);
    const evicted: Array<{ texture: GodotRid; mip: number }> = [];
    this.evictToBudget(evicted);
    this.publish();
  }

  public setUploadBudget(value: unknown): void {
    this.uploadBudgetValue = integer(value, 'upload_budget', 1);
  }

  public getTexture(value: unknown): GodotTextureStreamingState | null {
    const texture = rid(value);
    const entry = this.entries.get(godotRidGetId(texture));
    return entry === undefined ? null : state(entry);
  }

  public getSnapshot(): GodotTextureStreamingSnapshot {
    const textures = [...this.entries.values()].map(state);
    return Object.freeze({
      frame: this.frameValue,
      textures: Object.freeze(textures),
      residentBytes: this.totalResidentBytes(),
      memoryBudget: this.memoryBudgetValue,
      uploadBudget: this.uploadBudgetValue,
      pendingRequests: textures.filter((entry) => entry.requestedMip < entry.residentMip).length,
      loads: this.loads,
      evictions: this.evictions,
      generation: this.generationValue,
      lastFrame: this.lastFrame,
    });
  }

  public watch(watcher: (snapshot: GodotTextureStreamingSnapshot) => void): () => void {
    this.watchers.add(watcher);
    watcher(this.getSnapshot());
    return () => this.watchers.delete(watcher);
  }

  private publish(): void {
    const value = this.getSnapshot();
    for (const watcher of this.watchers) watcher(value);
  }

  public clear(): void {
    if (this.processing) throw new Error('godot-compat: cannot clear texture streaming during frame.');
    for (const entry of this.entries.values()) {
      for (let mip = entry.residentMip; mip < entry.mipCount; mip += 1) this.backend.evict(entry.rid, mip);
    }
    this.entries.clear();
    this.lastFrame = null;
    this.generationValue += 1;
    this.publish();
  }

  public dispose(): void {
    this.clear();
    this.watchers.clear();
  }
}

export function createGodotTextureStreamingRuntime(backend: GodotTextureStreamingBackend): GodotTextureStreamingRuntime {
  return new GodotTextureStreamingRuntime(backend);
}
