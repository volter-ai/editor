export type GodotLightProjectorRid = string | number;
export type GodotLightProjectorType = 'directional' | 'omni' | 'spot';

export interface GodotLightProjectorTextureDescriptor<TSource = unknown> {
  readonly rid: GodotLightProjectorRid;
  readonly width: number;
  readonly height: number;
  readonly source: TSource;
  readonly srgb?: boolean;
  readonly priority?: number;
  readonly persistent?: boolean;
}

export interface GodotLightProjectorAllocation {
  readonly texture: GodotLightProjectorRid;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly uvScale: readonly [number, number];
  readonly uvOffset: readonly [number, number];
  readonly generation: number;
}

export interface GodotLightProjectorBinding {
  readonly light: GodotLightProjectorRid;
  readonly type: GodotLightProjectorType;
  readonly texture: GodotLightProjectorRid | null;
  readonly allocation: GodotLightProjectorAllocation | null;
  readonly intensity: number;
  readonly flipY: boolean;
  readonly enabled: boolean;
  readonly revision: number;
}

export interface GodotLightProjectorUpload<TSource = unknown> {
  readonly frame: number;
  readonly descriptor: GodotLightProjectorTextureDescriptor<TSource>;
  readonly allocation: GodotLightProjectorAllocation;
}

export interface GodotLightProjectorAtlasFrame {
  readonly frame: number;
  readonly uploaded: readonly GodotLightProjectorRid[];
  readonly deferred: readonly GodotLightProjectorRid[];
  readonly evicted: readonly GodotLightProjectorRid[];
  readonly failed: readonly { texture: GodotLightProjectorRid; error: unknown }[];
  readonly generation: number;
}

export interface GodotLightProjectorAtlasSnapshot {
  readonly frame: number;
  readonly atlasSize: number;
  readonly layers: number;
  readonly textures: number;
  readonly residentTextures: number;
  readonly dirtyTextures: number;
  readonly lights: number;
  readonly allocatedArea: number;
  readonly atlasArea: number;
  readonly uploads: number;
  readonly evictions: number;
  readonly generation: number;
}

export interface GodotLightProjectorAtlasBackend<TSource = unknown> {
  createLayer(layer: number, size: number): void | Promise<void>;
  upload(value: GodotLightProjectorUpload<TSource>): void | Promise<void>;
  clear?(allocation: GodotLightProjectorAllocation): void;
  destroyLayer?(layer: number): void;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Shelf {
  y: number;
  height: number;
  cursor: number;
}

interface AtlasLayer<TSource> {
  index: number;
  shelves: Shelf[];
  free: Rect[];
  textures: Set<TextureState<TSource>>;
  created: boolean;
}

interface TextureState<TSource> {
  descriptor: Required<GodotLightProjectorTextureDescriptor<TSource>>;
  allocation: GodotLightProjectorAllocation | null;
  layer: AtlasLayer<TSource> | null;
  references: Set<GodotLightProjectorRid>;
  dirty: boolean;
  resident: boolean;
  uploading: boolean;
  lastUsedFrame: number;
  revision: number;
}

interface LightState {
  rid: GodotLightProjectorRid;
  type: GodotLightProjectorType;
  texture: TextureState<unknown> | null;
  intensity: number;
  flipY: boolean;
  enabled: boolean;
  revision: number;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires a finite number in [${minimum}, ${maximum}].`);
  }
  return result;
}

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(result)) throw new TypeError(`godot-compat: ${member} requires an integer.`);
  return result;
}

function projectorType(value: unknown): GodotLightProjectorType {
  if (value !== 'directional' && value !== 'omni' && value !== 'spot') {
    throw new TypeError(`godot-compat: unknown projector light type ${String(value)}.`);
  }
  return value;
}

function ridKey(value: GodotLightProjectorRid): string {
  return `${typeof value}:${String(value)}`;
}

function normalizeTexture<TSource>(
  value: GodotLightProjectorTextureDescriptor<TSource>,
  atlasSize: number,
): Required<GodotLightProjectorTextureDescriptor<TSource>> {
  return Object.freeze({
    rid: value.rid,
    width: integer(value.width, 'projector texture width', 1, atlasSize),
    height: integer(value.height, 'projector texture height', 1, atlasSize),
    source: value.source,
    srgb: value.srgb ?? true,
    priority: integer(value.priority ?? 0, 'projector texture priority', -128, 127),
    persistent: value.persistent ?? false,
  });
}

export class GodotLightProjectorAtlasRuntime<TSource = unknown> {
  private readonly textures = new Map<GodotLightProjectorRid, TextureState<TSource>>();
  private readonly lights = new Map<GodotLightProjectorRid, LightState>();
  private readonly layers: AtlasLayer<TSource>[] = [];
  private readonly watchers = new Set<(snapshot: GodotLightProjectorAtlasSnapshot) => void>();
  private atlasSize: number;
  private maxLayers: number;
  private uploadBudget = 8;
  private frame = 0;
  private generation = 1;
  private uploads = 0;
  private evictions = 0;
  private processing = false;

  constructor(
    private backend: GodotLightProjectorAtlasBackend<TSource>,
    atlasSize = 2048,
    maxLayers = 8,
  ) {
    this.atlasSize = integer(atlasSize, 'projector atlas size', 64, 16384);
    this.maxLayers = integer(maxLayers, 'projector atlas layers', 1, 256);
  }

  addTexture(value: GodotLightProjectorTextureDescriptor<TSource>): void {
    if (this.textures.has(value.rid)) throw new Error(`godot-compat: projector texture ${ridKey(value.rid)} already exists.`);
    this.textures.set(value.rid, {
      descriptor: normalizeTexture(value, this.atlasSize),
      allocation: null,
      layer: null,
      references: new Set(),
      dirty: true,
      resident: false,
      uploading: false,
      lastUsedFrame: -1,
      revision: ++this.generation,
    });
    this.publish();
  }

  updateTexture(
    rid: GodotLightProjectorRid,
    patch: Partial<Omit<GodotLightProjectorTextureDescriptor<TSource>, 'rid'>>,
  ): void {
    const texture = this.requireTexture(rid);
    const next = normalizeTexture({ ...texture.descriptor, ...patch, rid }, this.atlasSize);
    const reallocates = next.width !== texture.descriptor.width || next.height !== texture.descriptor.height;
    if (reallocates) this.releaseAllocation(texture);
    texture.descriptor = next;
    texture.dirty = true;
    texture.resident = false;
    texture.revision = ++this.generation;
    this.publish();
  }

  removeTexture(rid: GodotLightProjectorRid): boolean {
    const texture = this.textures.get(rid);
    if (texture === undefined) return false;
    for (const lightRid of texture.references) {
      const light = this.lights.get(lightRid);
      if (light !== undefined) {
        light.texture = null;
        light.revision = ++this.generation;
      }
    }
    this.releaseAllocation(texture);
    this.textures.delete(rid);
    this.publish();
    return true;
  }

  addLight(
    rid: GodotLightProjectorRid,
    typeValue: GodotLightProjectorType,
    textureRid: GodotLightProjectorRid | null = null,
  ): void {
    if (this.lights.has(rid)) throw new Error(`godot-compat: projector light ${ridKey(rid)} already exists.`);
    const texture = textureRid === null ? null : this.requireTexture(textureRid);
    const light: LightState = {
      rid,
      type: projectorType(typeValue),
      texture: texture as TextureState<unknown> | null,
      intensity: 1,
      flipY: typeValue === 'omni',
      enabled: true,
      revision: ++this.generation,
    };
    this.lights.set(rid, light);
    texture?.references.add(rid);
    this.publish();
  }

  removeLight(rid: GodotLightProjectorRid): boolean {
    const light = this.lights.get(rid);
    if (light === undefined) return false;
    (light.texture as TextureState<TSource> | null)?.references.delete(rid);
    this.lights.delete(rid);
    this.generation++;
    this.publish();
    return true;
  }

  bindTexture(lightRid: GodotLightProjectorRid, textureRid: GodotLightProjectorRid | null): void {
    const light = this.requireLight(lightRid);
    (light.texture as TextureState<TSource> | null)?.references.delete(lightRid);
    const texture = textureRid === null ? null : this.requireTexture(textureRid);
    light.texture = texture as TextureState<unknown> | null;
    texture?.references.add(lightRid);
    if (texture !== null) texture.lastUsedFrame = this.frame;
    light.revision = ++this.generation;
    this.publish();
  }

  configureLight(
    rid: GodotLightProjectorRid,
    patch: { readonly intensity?: number; readonly flipY?: boolean; readonly enabled?: boolean; readonly type?: GodotLightProjectorType },
  ): void {
    const light = this.requireLight(rid);
    if (patch.intensity !== undefined) light.intensity = finite(patch.intensity, 'projector intensity', 0);
    if (patch.flipY !== undefined) light.flipY = Boolean(patch.flipY);
    if (patch.enabled !== undefined) light.enabled = Boolean(patch.enabled);
    if (patch.type !== undefined) light.type = projectorType(patch.type);
    light.revision = ++this.generation;
    this.publish();
  }

  getLightBinding(rid: GodotLightProjectorRid): GodotLightProjectorBinding {
    const light = this.requireLight(rid);
    const texture = light.texture as TextureState<TSource> | null;
    if (texture !== null) texture.lastUsedFrame = this.frame;
    return Object.freeze({
      light: light.rid,
      type: light.type,
      texture: texture?.descriptor.rid ?? null,
      allocation: texture?.allocation ?? null,
      intensity: light.intensity,
      flipY: light.flipY,
      enabled: light.enabled && texture?.resident === true,
      revision: light.revision,
    });
  }

  async process(frameValue: number): Promise<GodotLightProjectorAtlasFrame> {
    const frame = integer(frameValue, 'projector atlas frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: projector atlas frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: projector atlas is already processing.');
    this.frame = frame;
    this.processing = true;
    const uploaded: GodotLightProjectorRid[] = [];
    const deferred: GodotLightProjectorRid[] = [];
    const evicted: GodotLightProjectorRid[] = [];
    const failed: Array<{ texture: GodotLightProjectorRid; error: unknown }> = [];
    try {
      const dirty = [...this.textures.values()]
        .filter((texture) => texture.dirty && texture.references.size > 0)
        .sort((left, right) =>
          Number(right.descriptor.persistent) - Number(left.descriptor.persistent)
          || right.descriptor.priority - left.descriptor.priority
          || right.references.size - left.references.size
          || left.lastUsedFrame - right.lastUsedFrame);
      for (const texture of dirty) {
        if (uploaded.length >= this.uploadBudget) {
          deferred.push(texture.descriptor.rid);
          continue;
        }
        try {
          const evictedBefore = this.evictions;
          const allocation = await this.allocate(texture);
          if (this.evictions > evictedBefore) {
            for (const candidate of this.textures.values()) {
              if (!candidate.resident && !candidate.dirty) evicted.push(candidate.descriptor.rid);
            }
          }
          texture.uploading = true;
          await this.backend.upload({ frame, descriptor: texture.descriptor, allocation });
          texture.uploading = false;
          texture.dirty = false;
          texture.resident = true;
          texture.lastUsedFrame = frame;
          texture.revision = ++this.generation;
          this.uploads++;
          uploaded.push(texture.descriptor.rid);
        } catch (error) {
          texture.uploading = false;
          failed.push(Object.freeze({ texture: texture.descriptor.rid, error }));
        }
      }
      this.publish();
      return Object.freeze({
        frame,
        uploaded: Object.freeze(uploaded),
        deferred: Object.freeze(deferred),
        evicted: Object.freeze([...new Set(evicted)]),
        failed: Object.freeze(failed),
        generation: this.generation,
      });
    } finally {
      this.processing = false;
    }
  }

  markDirty(rid: GodotLightProjectorRid): void {
    const texture = this.requireTexture(rid);
    texture.dirty = true;
    texture.revision = ++this.generation;
    this.publish();
  }

  setUploadBudget(value: number): void {
    this.uploadBudget = integer(value, 'projector upload budget', 1, 1024);
  }

  getSnapshot(): GodotLightProjectorAtlasSnapshot {
    const resident = [...this.textures.values()].filter((texture) => texture.resident);
    return Object.freeze({
      frame: this.frame,
      atlasSize: this.atlasSize,
      layers: this.layers.length,
      textures: this.textures.size,
      residentTextures: resident.length,
      dirtyTextures: [...this.textures.values()].filter((texture) => texture.dirty).length,
      lights: this.lights.size,
      allocatedArea: resident.reduce((sum, texture) => sum + texture.descriptor.width * texture.descriptor.height, 0),
      atlasArea: this.layers.length * this.atlasSize * this.atlasSize,
      uploads: this.uploads,
      evictions: this.evictions,
      generation: this.generation,
    });
  }

  watch(listener: (snapshot: GodotLightProjectorAtlasSnapshot) => void): () => void {
    this.watchers.add(listener);
    listener(this.getSnapshot());
    return () => this.watchers.delete(listener);
  }

  dispose(): void {
    for (const layer of this.layers) this.backend.destroyLayer?.(layer.index);
    this.textures.clear();
    this.lights.clear();
    this.layers.length = 0;
    this.watchers.clear();
    this.generation++;
  }

  private async allocate(texture: TextureState<TSource>): Promise<GodotLightProjectorAllocation> {
    if (texture.allocation !== null) return texture.allocation;
    let chosen: { layer: AtlasLayer<TSource>; rect: Rect } | null = null;
    for (const layer of this.layers) {
      const rect = this.findRect(layer, texture.descriptor.width, texture.descriptor.height);
      if (rect !== null) {
        chosen = { layer, rect };
        break;
      }
    }
    while (chosen === null && this.layers.length >= this.maxLayers) {
      const evicted = this.evictOne();
      if (!evicted) break;
      for (const layer of this.layers) {
        const rect = this.findRect(layer, texture.descriptor.width, texture.descriptor.height);
        if (rect !== null) {
          chosen = { layer, rect };
          break;
        }
      }
    }
    if (chosen === null) {
      if (this.layers.length >= this.maxLayers) throw new Error('godot-compat: light projector atlas is full.');
      const layer: AtlasLayer<TSource> = {
        index: this.layers.length,
        shelves: [],
        free: [],
        textures: new Set(),
        created: false,
      };
      await this.backend.createLayer(layer.index, this.atlasSize);
      layer.created = true;
      this.layers.push(layer);
      chosen = { layer, rect: this.findRect(layer, texture.descriptor.width, texture.descriptor.height)! };
    }
    texture.layer = chosen.layer;
    chosen.layer.textures.add(texture);
    const allocation: GodotLightProjectorAllocation = Object.freeze({
      texture: texture.descriptor.rid,
      layer: chosen.layer.index,
      x: chosen.rect.x,
      y: chosen.rect.y,
      width: chosen.rect.width,
      height: chosen.rect.height,
      uvScale: Object.freeze([chosen.rect.width / this.atlasSize, chosen.rect.height / this.atlasSize] as const),
      uvOffset: Object.freeze([chosen.rect.x / this.atlasSize, chosen.rect.y / this.atlasSize] as const),
      generation: ++this.generation,
    });
    texture.allocation = allocation;
    return allocation;
  }

  private findRect(layer: AtlasLayer<TSource>, width: number, height: number): Rect | null {
    const freeIndex = layer.free.findIndex((rect) => rect.width >= width && rect.height >= height);
    if (freeIndex >= 0) {
      const source = layer.free.splice(freeIndex, 1)[0]!;
      if (source.width > width) layer.free.push({ x: source.x + width, y: source.y, width: source.width - width, height });
      if (source.height > height) layer.free.push({ x: source.x, y: source.y + height, width: source.width, height: source.height - height });
      return { x: source.x, y: source.y, width, height };
    }
    for (const shelf of layer.shelves) {
      if (height <= shelf.height && shelf.cursor + width <= this.atlasSize) {
        const rect = { x: shelf.cursor, y: shelf.y, width, height };
        shelf.cursor += width;
        return rect;
      }
    }
    const y = layer.shelves.reduce((bottom, shelf) => Math.max(bottom, shelf.y + shelf.height), 0);
    if (y + height > this.atlasSize) return null;
    layer.shelves.push({ y, height, cursor: width });
    return { x: 0, y, width, height };
  }

  private evictOne(): boolean {
    const candidate = [...this.textures.values()]
      .filter((texture) => texture.resident && !texture.uploading && !texture.descriptor.persistent)
      .sort((left, right) =>
        left.descriptor.priority - right.descriptor.priority
        || left.references.size - right.references.size
        || left.lastUsedFrame - right.lastUsedFrame)[0];
    if (candidate === undefined) return false;
    this.releaseAllocation(candidate);
    candidate.resident = false;
    candidate.dirty = true;
    candidate.revision = ++this.generation;
    this.evictions++;
    return true;
  }

  private releaseAllocation(texture: TextureState<TSource>): void {
    if (texture.allocation === null || texture.layer === null) return;
    this.backend.clear?.(texture.allocation);
    texture.layer.free.push({
      x: texture.allocation.x,
      y: texture.allocation.y,
      width: texture.allocation.width,
      height: texture.allocation.height,
    });
    texture.layer.textures.delete(texture);
    texture.layer = null;
    texture.allocation = null;
    texture.resident = false;
  }

  private requireTexture(rid: GodotLightProjectorRid): TextureState<TSource> {
    const value = this.textures.get(rid);
    if (value === undefined) throw new Error(`godot-compat: unknown projector texture ${ridKey(rid)}.`);
    return value;
  }

  private requireLight(rid: GodotLightProjectorRid): LightState {
    const value = this.lights.get(rid);
    if (value === undefined) throw new Error(`godot-compat: unknown projector light ${ridKey(rid)}.`);
    return value;
  }

  private publish(): void {
    if (this.watchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function createGodotLightProjectorAtlasRuntime<TSource = unknown>(
  backend: GodotLightProjectorAtlasBackend<TSource>,
  atlasSize?: number,
  maxLayers?: number,
): GodotLightProjectorAtlasRuntime<TSource> {
  return new GodotLightProjectorAtlasRuntime(backend, atlasSize, maxLayers);
}
