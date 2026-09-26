export type GodotVirtualShadowRid = string | number;

export interface GodotVirtualShadowPageCoordinate {
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly face?: number;
}

export interface GodotVirtualShadowLightDescriptor {
  readonly rid: GodotVirtualShadowRid;
  readonly type: 'directional' | 'omni' | 'spot';
  readonly levels?: number;
  readonly virtualResolution?: number;
  readonly priority?: number;
  readonly enabled?: boolean;
  readonly pageWorldSize?: number;
}

export interface GodotVirtualShadowCasterBounds {
  readonly minimum: readonly [number, number, number];
  readonly maximum: readonly [number, number, number];
}

export interface GodotVirtualShadowCasterDescriptor {
  readonly rid: GodotVirtualShadowRid;
  readonly bounds: GodotVirtualShadowCasterBounds;
  readonly lightMask?: number;
  readonly dynamic?: boolean;
  readonly visible?: boolean;
}

export interface GodotVirtualShadowPhysicalPage {
  readonly index: number;
  readonly atlasX: number;
  readonly atlasY: number;
  readonly light: GodotVirtualShadowRid;
  readonly coordinate: Readonly<Required<GodotVirtualShadowPageCoordinate>>;
  readonly dirty: boolean;
  readonly lastUsedFrame: number;
  readonly lastRenderedFrame: number;
  readonly generation: number;
}

export interface GodotVirtualShadowPageRender {
  readonly page: GodotVirtualShadowPhysicalPage;
  readonly lightRevision: number;
  readonly casterRevision: number;
  readonly priority: number;
  readonly generation: number;
}

export interface GodotVirtualShadowPageTable {
  readonly light: GodotVirtualShadowRid;
  readonly levels: number;
  readonly faces: number;
  readonly pageTable: Int32Array;
  readonly pagesPerDimension: number;
  readonly generation: number;
}

export interface GodotVirtualShadowFrame {
  readonly frame: number;
  readonly renderPages: readonly GodotVirtualShadowPageRender[];
  readonly deferredPages: readonly GodotVirtualShadowPageRender[];
  readonly residentPages: number;
  readonly dirtyPages: number;
  readonly allocations: number;
  readonly evictions: number;
  readonly generation: number;
}

export interface GodotVirtualShadowSnapshot {
  readonly frame: number;
  readonly pageSize: number;
  readonly atlasSize: number;
  readonly capacity: number;
  readonly residentPages: number;
  readonly freePages: number;
  readonly dirtyPages: number;
  readonly lights: number;
  readonly casters: number;
  readonly allocations: number;
  readonly evictions: number;
  readonly renderedPages: number;
  readonly generation: number;
}

interface LightState {
  descriptor: Required<GodotVirtualShadowLightDescriptor>;
  pageTable: Int32Array;
  pagesPerDimension: number;
  pages: Set<number>;
  revision: number;
  casterRevision: number;
}

interface CasterState {
  descriptor: Required<GodotVirtualShadowCasterDescriptor>;
  revision: number;
}

interface PageState {
  index: number;
  atlasX: number;
  atlasY: number;
  light: GodotVirtualShadowRid | null;
  coordinate: Required<GodotVirtualShadowPageCoordinate> | null;
  dirty: boolean;
  lastUsedFrame: number;
  lastRenderedFrame: number;
  generation: number;
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

function powerOfTwo(value: unknown, member: string, minimum: number, maximum: number): number {
  const result = integer(value, member, minimum, maximum);
  if ((result & (result - 1)) !== 0) throw new RangeError(`godot-compat: ${member} requires a power of two.`);
  return result;
}

function lightDescriptor(value: GodotVirtualShadowLightDescriptor): Required<GodotVirtualShadowLightDescriptor> {
  if (value.type !== 'directional' && value.type !== 'omni' && value.type !== 'spot') {
    throw new TypeError(`godot-compat: unknown virtual shadow light type ${String(value.type)}.`);
  }
  return Object.freeze({
    rid: value.rid,
    type: value.type,
    levels: integer(value.levels ?? (value.type === 'directional' ? 4 : 1), 'virtual shadow levels', 1, 8),
    virtualResolution: powerOfTwo(value.virtualResolution ?? 16384, 'virtual shadow resolution', 128, 131072),
    priority: integer(value.priority ?? 0, 'virtual shadow priority', -128, 127),
    enabled: value.enabled ?? true,
    pageWorldSize: finite(value.pageWorldSize ?? 1, 'virtual shadow page world size', Number.EPSILON),
  });
}

function bounds(value: GodotVirtualShadowCasterBounds): GodotVirtualShadowCasterBounds {
  if (!Array.isArray(value.minimum) || !Array.isArray(value.maximum)
    || value.minimum.length !== 3 || value.maximum.length !== 3) {
    throw new TypeError('godot-compat: virtual shadow caster bounds require min/max Vector3 arrays.');
  }
  const minimum = value.minimum.map((component) => finite(component, 'virtual shadow bounds minimum')) as [number, number, number];
  const maximum = value.maximum.map((component) => finite(component, 'virtual shadow bounds maximum')) as [number, number, number];
  if (minimum.some((component, index) => component > maximum[index]!)) {
    throw new RangeError('godot-compat: virtual shadow caster bounds minimum exceeds maximum.');
  }
  return Object.freeze({ minimum: Object.freeze(minimum), maximum: Object.freeze(maximum) });
}

function casterDescriptor(value: GodotVirtualShadowCasterDescriptor): Required<GodotVirtualShadowCasterDescriptor> {
  return Object.freeze({
    rid: value.rid,
    bounds: bounds(value.bounds),
    lightMask: integer(value.lightMask ?? 0xffff_ffff, 'virtual shadow caster mask', 0, 0xffff_ffff) >>> 0,
    dynamic: value.dynamic ?? true,
    visible: value.visible ?? true,
  });
}

function coordinateKey(value: Required<GodotVirtualShadowPageCoordinate>): string {
  return `${value.face}:${value.level}:${value.x}:${value.y}`;
}

export class GodotVirtualShadowPageRuntime {
  private readonly lights = new Map<GodotVirtualShadowRid, LightState>();
  private readonly casters = new Map<GodotVirtualShadowRid, CasterState>();
  private readonly pages: PageState[] = [];
  private readonly pageLookup = new Map<string, PageState>();
  private readonly watchers = new Set<(frame: GodotVirtualShadowFrame) => void>();
  private pageSize: number;
  private atlasSize: number;
  private renderBudget: number;
  private frame = 0;
  private generation = 1;
  private allocations = 0;
  private evictions = 0;
  private renderedPages = 0;
  private lastFrame: GodotVirtualShadowFrame | null = null;

  constructor(pageSize = 128, atlasSize = 8192, renderBudget = 64) {
    this.pageSize = powerOfTwo(pageSize, 'virtual shadow page size', 16, 1024);
    this.atlasSize = powerOfTwo(atlasSize, 'virtual shadow atlas size', this.pageSize, 32768);
    if (this.atlasSize % this.pageSize !== 0) throw new RangeError('godot-compat: shadow atlas size must be divisible by page size.');
    this.renderBudget = integer(renderBudget, 'virtual shadow render budget', 1, 65536);
    this.rebuildPhysicalPages();
  }

  addLight(value: GodotVirtualShadowLightDescriptor): void {
    if (this.lights.has(value.rid)) throw new Error('godot-compat: virtual shadow light already exists.');
    const descriptor = lightDescriptor(value);
    const pagesPerDimension = descriptor.virtualResolution / this.pageSize;
    const faces = descriptor.type === 'omni' ? 6 : 1;
    const tableLength = pagesPerDimension * pagesPerDimension * descriptor.levels * faces;
    const pageTable = new Int32Array(tableLength);
    pageTable.fill(-1);
    this.lights.set(value.rid, {
      descriptor,
      pageTable,
      pagesPerDimension,
      pages: new Set(),
      revision: ++this.generation,
      casterRevision: this.currentCasterRevision(),
    });
  }

  updateLight(rid: GodotVirtualShadowRid, patch: Partial<Omit<GodotVirtualShadowLightDescriptor, 'rid'>>): void {
    const light = this.requireLight(rid);
    const next = lightDescriptor({ ...light.descriptor, ...patch, rid });
    const rebuild = next.virtualResolution !== light.descriptor.virtualResolution
      || next.levels !== light.descriptor.levels
      || next.type !== light.descriptor.type;
    light.descriptor = next;
    light.revision = ++this.generation;
    if (rebuild) {
      this.releaseLightPages(light);
      light.pagesPerDimension = next.virtualResolution / this.pageSize;
      const faces = next.type === 'omni' ? 6 : 1;
      light.pageTable = new Int32Array(light.pagesPerDimension ** 2 * next.levels * faces);
      light.pageTable.fill(-1);
    } else this.markLightDirty(rid);
  }

  removeLight(rid: GodotVirtualShadowRid): boolean {
    const light = this.lights.get(rid);
    if (light === undefined) return false;
    this.releaseLightPages(light);
    this.lights.delete(rid);
    this.generation++;
    return true;
  }

  addCaster(value: GodotVirtualShadowCasterDescriptor): void {
    if (this.casters.has(value.rid)) throw new Error('godot-compat: virtual shadow caster already exists.');
    this.casters.set(value.rid, { descriptor: casterDescriptor(value), revision: ++this.generation });
    this.markCasterBoundsDirty(value.bounds, value.lightMask ?? 0xffff_ffff);
  }

  updateCaster(rid: GodotVirtualShadowRid, patch: Partial<Omit<GodotVirtualShadowCasterDescriptor, 'rid'>>): void {
    const caster = this.requireCaster(rid);
    const previous = caster.descriptor;
    caster.descriptor = casterDescriptor({ ...previous, ...patch, rid });
    caster.revision = ++this.generation;
    this.markCasterBoundsDirty(previous.bounds, previous.lightMask);
    this.markCasterBoundsDirty(caster.descriptor.bounds, caster.descriptor.lightMask);
  }

  removeCaster(rid: GodotVirtualShadowRid): boolean {
    const caster = this.casters.get(rid);
    if (caster === undefined) return false;
    this.markCasterBoundsDirty(caster.descriptor.bounds, caster.descriptor.lightMask);
    this.casters.delete(rid);
    this.generation++;
    return true;
  }

  requestPage(lightRid: GodotVirtualShadowRid, value: GodotVirtualShadowPageCoordinate): GodotVirtualShadowPhysicalPage {
    const light = this.requireLight(lightRid);
    if (!light.descriptor.enabled) throw new Error('godot-compat: virtual shadow light is disabled.');
    const coordinate = this.normalizeCoordinate(light, value);
    const key = `${String(lightRid)}/${coordinateKey(coordinate)}`;
    let page = this.pageLookup.get(key);
    if (page === undefined) {
      page = this.allocatePage(light, coordinate);
      this.pageLookup.set(key, page);
      light.pages.add(page.index);
      light.pageTable[this.tableIndex(light, coordinate)] = page.index;
      this.allocations++;
    }
    page.lastUsedFrame = this.frame;
    return this.pageSnapshot(page);
  }

  requestRegion(
    lightRid: GodotVirtualShadowRid,
    level: number,
    minimumX: number,
    minimumY: number,
    maximumX: number,
    maximumY: number,
    face = 0,
  ): readonly GodotVirtualShadowPhysicalPage[] {
    const light = this.requireLight(lightRid);
    const minX = integer(minimumX, 'virtual shadow region min x', 0, light.pagesPerDimension - 1);
    const minY = integer(minimumY, 'virtual shadow region min y', 0, light.pagesPerDimension - 1);
    const maxX = integer(maximumX, 'virtual shadow region max x', minX, light.pagesPerDimension - 1);
    const maxY = integer(maximumY, 'virtual shadow region max y', minY, light.pagesPerDimension - 1);
    const values: GodotVirtualShadowPhysicalPage[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) values.push(this.requestPage(lightRid, { x, y, level, face }));
    }
    return Object.freeze(values);
  }

  markPageDirty(lightRid: GodotVirtualShadowRid, coordinateValue: GodotVirtualShadowPageCoordinate): boolean {
    const light = this.requireLight(lightRid);
    const coordinate = this.normalizeCoordinate(light, coordinateValue);
    const index = light.pageTable[this.tableIndex(light, coordinate)]!;
    if (index < 0) return false;
    const page = this.pages[index]!;
    page.dirty = true;
    page.generation = ++this.generation;
    return true;
  }

  markLightDirty(rid: GodotVirtualShadowRid): void {
    const light = this.requireLight(rid);
    for (const index of light.pages) {
      const page = this.pages[index]!;
      page.dirty = true;
      page.generation = ++this.generation;
    }
  }

  schedule(frameValue: number): GodotVirtualShadowFrame {
    const frame = integer(frameValue, 'virtual shadow frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: virtual shadow frame cannot move backwards.');
    this.frame = frame;
    const candidates: GodotVirtualShadowPageRender[] = [];
    for (const page of this.pages) {
      if (!page.dirty || page.light === null || page.coordinate === null) continue;
      const light = this.requireLight(page.light);
      const render: GodotVirtualShadowPageRender = Object.freeze({
        page: this.pageSnapshot(page),
        lightRevision: light.revision,
        casterRevision: light.casterRevision,
        priority: light.descriptor.priority + (light.descriptor.levels - page.coordinate.level),
        generation: page.generation,
      });
      candidates.push(render);
    }
    candidates.sort((left, right) =>
      right.priority - left.priority
      || left.page.lastUsedFrame - right.page.lastUsedFrame
      || left.page.index - right.page.index);
    const renderPages = candidates.slice(0, this.renderBudget);
    const deferredPages = candidates.slice(this.renderBudget);
    this.lastFrame = Object.freeze({
      frame,
      renderPages: Object.freeze(renderPages),
      deferredPages: Object.freeze(deferredPages),
      residentPages: this.pages.filter((page) => page.light !== null).length,
      dirtyPages: candidates.length,
      allocations: this.allocations,
      evictions: this.evictions,
      generation: this.generation,
    });
    for (const watcher of this.watchers) watcher(this.lastFrame);
    return this.lastFrame;
  }

  markRendered(value: GodotVirtualShadowPageRender): void {
    const page = this.pages[value.page.index];
    if (page === undefined || page.light !== value.page.light || page.generation !== value.generation) {
      throw new Error('godot-compat: virtual shadow render page is stale.');
    }
    page.dirty = false;
    page.lastRenderedFrame = this.frame;
    page.lastUsedFrame = this.frame;
    page.generation = ++this.generation;
    this.renderedPages++;
  }

  getPageTable(lightRid: GodotVirtualShadowRid): GodotVirtualShadowPageTable {
    const light = this.requireLight(lightRid);
    return Object.freeze({
      light: lightRid,
      levels: light.descriptor.levels,
      faces: light.descriptor.type === 'omni' ? 6 : 1,
      pageTable: light.pageTable.slice(),
      pagesPerDimension: light.pagesPerDimension,
      generation: light.revision,
    });
  }

  setRenderBudget(value: number): void {
    this.renderBudget = integer(value, 'virtual shadow render budget', 1, this.pages.length || 1);
  }

  resize(pageSizeValue: number, atlasSizeValue: number): void {
    const pageSize = powerOfTwo(pageSizeValue, 'virtual shadow page size', 16, 1024);
    const atlasSize = powerOfTwo(atlasSizeValue, 'virtual shadow atlas size', pageSize, 32768);
    if (atlasSize % pageSize !== 0) throw new RangeError('godot-compat: shadow atlas size must be divisible by page size.');
    this.pageSize = pageSize;
    this.atlasSize = atlasSize;
    this.pageLookup.clear();
    for (const light of this.lights.values()) {
      light.pages.clear();
      light.pagesPerDimension = light.descriptor.virtualResolution / this.pageSize;
      const faces = light.descriptor.type === 'omni' ? 6 : 1;
      light.pageTable = new Int32Array(light.pagesPerDimension ** 2 * light.descriptor.levels * faces);
      light.pageTable.fill(-1);
      light.revision = ++this.generation;
    }
    this.rebuildPhysicalPages();
  }

  getSnapshot(): GodotVirtualShadowSnapshot {
    const resident = this.pages.filter((page) => page.light !== null);
    return Object.freeze({
      frame: this.frame,
      pageSize: this.pageSize,
      atlasSize: this.atlasSize,
      capacity: this.pages.length,
      residentPages: resident.length,
      freePages: this.pages.length - resident.length,
      dirtyPages: resident.filter((page) => page.dirty).length,
      lights: this.lights.size,
      casters: this.casters.size,
      allocations: this.allocations,
      evictions: this.evictions,
      renderedPages: this.renderedPages,
      generation: this.generation,
    });
  }

  watch(listener: (frame: GodotVirtualShadowFrame) => void): () => void {
    this.watchers.add(listener);
    if (this.lastFrame !== null) listener(this.lastFrame);
    return () => this.watchers.delete(listener);
  }

  dispose(): void {
    this.lights.clear();
    this.casters.clear();
    this.pages.length = 0;
    this.pageLookup.clear();
    this.watchers.clear();
    this.lastFrame = null;
    this.generation++;
  }

  private rebuildPhysicalPages(): void {
    this.pages.length = 0;
    const dimension = this.atlasSize / this.pageSize;
    for (let y = 0; y < dimension; y++) {
      for (let x = 0; x < dimension; x++) {
        this.pages.push({
          index: this.pages.length,
          atlasX: x * this.pageSize,
          atlasY: y * this.pageSize,
          light: null,
          coordinate: null,
          dirty: false,
          lastUsedFrame: -1,
          lastRenderedFrame: -1,
          generation: ++this.generation,
        });
      }
    }
  }

  private allocatePage(
    light: LightState,
    coordinate: Required<GodotVirtualShadowPageCoordinate>,
  ): PageState {
    let page = this.pages.find((candidate) => candidate.light === null);
    if (page === undefined) {
      page = [...this.pages]
        .sort((left, right) =>
          Number(left.dirty) - Number(right.dirty)
          || left.lastUsedFrame - right.lastUsedFrame
          || left.lastRenderedFrame - right.lastRenderedFrame)[0];
      if (page === undefined) throw new Error('godot-compat: virtual shadow atlas has no pages.');
      this.releasePage(page);
      this.evictions++;
    }
    page.light = light.descriptor.rid;
    page.coordinate = { ...coordinate };
    page.dirty = true;
    page.lastUsedFrame = this.frame;
    page.lastRenderedFrame = -1;
    page.generation = ++this.generation;
    return page;
  }

  private releasePage(page: PageState): void {
    if (page.light !== null && page.coordinate !== null) {
      const light = this.lights.get(page.light);
      if (light !== undefined) {
        light.pageTable[this.tableIndex(light, page.coordinate)] = -1;
        light.pages.delete(page.index);
      }
      this.pageLookup.delete(`${String(page.light)}/${coordinateKey(page.coordinate)}`);
    }
    page.light = null;
    page.coordinate = null;
    page.dirty = false;
    page.generation = ++this.generation;
  }

  private releaseLightPages(light: LightState): void {
    for (const index of [...light.pages]) this.releasePage(this.pages[index]!);
    light.pages.clear();
    light.pageTable.fill(-1);
  }

  private markCasterBoundsDirty(boundsValue: GodotVirtualShadowCasterBounds, lightMask: number): void {
    const value = bounds(boundsValue);
    for (const [index, light] of [...this.lights.values()].entries()) {
      if ((lightMask & (1 << (index % 32))) === 0) continue;
      const worldSize = light.descriptor.pageWorldSize;
      for (let level = 0; level < light.descriptor.levels; level++) {
        const scale = worldSize * 2 ** level;
        const minX = Math.max(0, Math.floor(value.minimum[0] / scale + light.pagesPerDimension * 0.5));
        const minY = Math.max(0, Math.floor(value.minimum[2] / scale + light.pagesPerDimension * 0.5));
        const maxX = Math.min(light.pagesPerDimension - 1, Math.floor(value.maximum[0] / scale + light.pagesPerDimension * 0.5));
        const maxY = Math.min(light.pagesPerDimension - 1, Math.floor(value.maximum[2] / scale + light.pagesPerDimension * 0.5));
        if (minX > maxX || minY > maxY) continue;
        const faces = light.descriptor.type === 'omni' ? 6 : 1;
        for (let face = 0; face < faces; face++) {
          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) this.markPageDirty(light.descriptor.rid, { x, y, level, face });
          }
        }
      }
      light.casterRevision = this.currentCasterRevision();
    }
  }

  private normalizeCoordinate(
    light: LightState,
    value: GodotVirtualShadowPageCoordinate,
  ): Required<GodotVirtualShadowPageCoordinate> {
    const faces = light.descriptor.type === 'omni' ? 6 : 1;
    return {
      x: integer(value.x, 'virtual shadow page x', 0, light.pagesPerDimension - 1),
      y: integer(value.y, 'virtual shadow page y', 0, light.pagesPerDimension - 1),
      level: integer(value.level, 'virtual shadow page level', 0, light.descriptor.levels - 1),
      face: integer(value.face ?? 0, 'virtual shadow page face', 0, faces - 1),
    };
  }

  private tableIndex(light: LightState, coordinate: Required<GodotVirtualShadowPageCoordinate>): number {
    const pagesPerLevel = light.pagesPerDimension ** 2;
    return coordinate.x
      + coordinate.y * light.pagesPerDimension
      + coordinate.level * pagesPerLevel
      + coordinate.face * pagesPerLevel * light.descriptor.levels;
  }

  private pageSnapshot(page: PageState): GodotVirtualShadowPhysicalPage {
    if (page.light === null || page.coordinate === null) throw new Error('godot-compat: virtual shadow page is not resident.');
    return Object.freeze({
      index: page.index,
      atlasX: page.atlasX,
      atlasY: page.atlasY,
      light: page.light,
      coordinate: Object.freeze({ ...page.coordinate }),
      dirty: page.dirty,
      lastUsedFrame: page.lastUsedFrame,
      lastRenderedFrame: page.lastRenderedFrame,
      generation: page.generation,
    });
  }

  private currentCasterRevision(): number {
    let revision = 0;
    for (const caster of this.casters.values()) revision = Math.max(revision, caster.revision);
    return revision;
  }

  private requireLight(rid: GodotVirtualShadowRid): LightState {
    const light = this.lights.get(rid);
    if (light === undefined) throw new Error('godot-compat: unknown virtual shadow light.');
    return light;
  }

  private requireCaster(rid: GodotVirtualShadowRid): CasterState {
    const caster = this.casters.get(rid);
    if (caster === undefined) throw new Error('godot-compat: unknown virtual shadow caster.');
    return caster;
  }
}

export function createGodotVirtualShadowPageRuntime(
  pageSize?: number,
  atlasSize?: number,
  renderBudget?: number,
): GodotVirtualShadowPageRuntime {
  return new GodotVirtualShadowPageRuntime(pageSize, atlasSize, renderBudget);
}
