export type GodotClusteredDecalRid = string | number;

export interface GodotClusteredDecalVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GodotClusteredDecalDescriptor {
  readonly rid: GodotClusteredDecalRid;
  readonly position: GodotClusteredDecalVector3;
  readonly halfExtents: GodotClusteredDecalVector3;
  readonly direction?: GodotClusteredDecalVector3;
  readonly layerMask?: number;
  readonly cullMask?: number;
  readonly priority?: number;
  readonly distanceFadeEnabled?: boolean;
  readonly distanceFadeBegin?: number;
  readonly distanceFadeLength?: number;
  readonly upperFade?: number;
  readonly lowerFade?: number;
  readonly normalFade?: number;
  readonly albedoMix?: number;
  readonly emissionEnergy?: number;
  readonly modulate?: readonly [number, number, number, number];
  readonly atlasBinding?: unknown;
  readonly enabled?: boolean;
}

export interface GodotClusteredDecalView {
  readonly position: GodotClusteredDecalVector3;
  readonly forward: GodotClusteredDecalVector3;
  readonly right: GodotClusteredDecalVector3;
  readonly up: GodotClusteredDecalVector3;
  readonly near: number;
  readonly far: number;
  readonly verticalFov: number;
  readonly aspect: number;
  readonly layerMask?: number;
}

export interface GodotClusteredDecalGrid {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly maxPerCluster?: number;
}

export interface GodotClusteredDecalInstance {
  readonly rid: GodotClusteredDecalRid;
  readonly position: GodotClusteredDecalVector3;
  readonly halfExtents: GodotClusteredDecalVector3;
  readonly direction: GodotClusteredDecalVector3;
  readonly priority: number;
  readonly fade: number;
  readonly upperFade: number;
  readonly lowerFade: number;
  readonly normalFade: number;
  readonly albedoMix: number;
  readonly emissionEnergy: number;
  readonly modulate: readonly [number, number, number, number];
  readonly atlasBinding: unknown;
  readonly distance: number;
  readonly clusterBegin: GodotClusteredDecalVector3;
  readonly clusterEnd: GodotClusteredDecalVector3;
  readonly revision: number;
}

export interface GodotClusteredDecalCell {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly decals: readonly number[];
  readonly overflow: number;
}

export interface GodotClusteredDecalFrame {
  readonly frame: number;
  readonly grid: Readonly<Required<GodotClusteredDecalGrid>>;
  readonly decals: readonly GodotClusteredDecalInstance[];
  readonly cells: readonly GodotClusteredDecalCell[];
  readonly indices: Uint32Array;
  readonly offsets: Uint32Array;
  readonly overflow: number;
  readonly culled: number;
  readonly generation: number;
}

interface MutableDecal {
  descriptor: Required<GodotClusteredDecalDescriptor>;
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

function mask(value: unknown, member: string): number {
  return integer(value, member, 0, 0xffff_ffff) >>> 0;
}

function vector(value: GodotClusteredDecalVector3, member: string, positive = false): GodotClusteredDecalVector3 {
  if (typeof value !== 'object' || value === null) throw new TypeError(`godot-compat: ${member} requires Vector3.`);
  const minimum = positive ? 0 : -Infinity;
  return Object.freeze({
    x: finite(value.x, `${member}.x`, minimum),
    y: finite(value.y, `${member}.y`, minimum),
    z: finite(value.z, `${member}.z`, minimum),
  });
}

function length(value: GodotClusteredDecalVector3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value: GodotClusteredDecalVector3): GodotClusteredDecalVector3 {
  const size = length(value);
  if (size <= Number.EPSILON) return Object.freeze({ x: 0, y: -1, z: 0 });
  return Object.freeze({ x: value.x / size, y: value.y / size, z: value.z / size });
}

function subtract(left: GodotClusteredDecalVector3, right: GodotClusteredDecalVector3): GodotClusteredDecalVector3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function dot(left: GodotClusteredDecalVector3, right: GodotClusteredDecalVector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function normalizedDescriptor(value: GodotClusteredDecalDescriptor): Required<GodotClusteredDecalDescriptor> {
  const color = value.modulate ?? [1, 1, 1, 1];
  if (color.length !== 4) throw new TypeError('godot-compat: decal modulate requires four components.');
  return Object.freeze({
    rid: value.rid,
    position: vector(value.position, 'decal position'),
    halfExtents: vector(value.halfExtents, 'decal half extents', true),
    direction: normalize(vector(value.direction ?? { x: 0, y: -1, z: 0 }, 'decal direction')),
    layerMask: mask(value.layerMask ?? 1, 'decal layer mask'),
    cullMask: mask(value.cullMask ?? 0xfffff, 'decal cull mask'),
    priority: integer(value.priority ?? 0, 'decal priority', -128, 127),
    distanceFadeEnabled: value.distanceFadeEnabled ?? false,
    distanceFadeBegin: finite(value.distanceFadeBegin ?? 40, 'decal fade begin', 0),
    distanceFadeLength: finite(value.distanceFadeLength ?? 10, 'decal fade length', 0),
    upperFade: finite(value.upperFade ?? 0.3, 'decal upper fade', 0, 1),
    lowerFade: finite(value.lowerFade ?? 0.3, 'decal lower fade', 0, 1),
    normalFade: finite(value.normalFade ?? 0, 'decal normal fade', 0, 1),
    albedoMix: finite(value.albedoMix ?? 1, 'decal albedo mix', 0, 1),
    emissionEnergy: finite(value.emissionEnergy ?? 1, 'decal emission energy', 0),
    modulate: Object.freeze(color.map((component) => finite(component, 'decal modulate')) as unknown as [number, number, number, number]),
    atlasBinding: value.atlasBinding ?? null,
    enabled: value.enabled ?? true,
  });
}

export class GodotClusteredDecalRuntime {
  private readonly decals = new Map<GodotClusteredDecalRid, MutableDecal>();
  private readonly watchers = new Set<(frame: GodotClusteredDecalFrame) => void>();
  private generation = 1;
  private lastFrame: GodotClusteredDecalFrame | null = null;

  add(value: GodotClusteredDecalDescriptor): void {
    if (this.decals.has(value.rid)) throw new Error('godot-compat: clustered decal RID already exists.');
    this.decals.set(value.rid, { descriptor: normalizedDescriptor(value), revision: ++this.generation });
  }

  update(rid: GodotClusteredDecalRid, patch: Partial<Omit<GodotClusteredDecalDescriptor, 'rid'>>): void {
    const decal = this.require(rid);
    decal.descriptor = normalizedDescriptor({ ...decal.descriptor, ...patch, rid });
    decal.revision = ++this.generation;
  }

  remove(rid: GodotClusteredDecalRid): boolean {
    const removed = this.decals.delete(rid);
    if (removed) this.generation++;
    return removed;
  }

  setEnabled(rid: GodotClusteredDecalRid, enabled: boolean): void {
    this.update(rid, { enabled });
  }

  setAtlasBinding(rid: GodotClusteredDecalRid, atlasBinding: unknown): void {
    this.update(rid, { atlasBinding });
  }

  build(
    frameValue: number,
    viewValue: GodotClusteredDecalView,
    gridValue: GodotClusteredDecalGrid,
  ): GodotClusteredDecalFrame {
    const frame = integer(frameValue, 'clustered decal frame', 0);
    const view = this.normalizeView(viewValue);
    const grid = Object.freeze({
      x: integer(gridValue.x, 'decal grid x', 1, 1024),
      y: integer(gridValue.y, 'decal grid y', 1, 1024),
      z: integer(gridValue.z, 'decal grid z', 1, 1024),
      maxPerCluster: integer(gridValue.maxPerCluster ?? 32, 'decal max per cluster', 1, 1024),
    });
    const visible: GodotClusteredDecalInstance[] = [];
    let culled = 0;
    for (const decal of this.decals.values()) {
      const resolved = this.resolve(decal, view, grid);
      if (resolved === null) culled++;
      else visible.push(resolved);
    }
    visible.sort((left, right) => right.priority - left.priority || left.distance - right.distance);
    const cellCount = grid.x * grid.y * grid.z;
    const cellLists: number[][] = Array.from({ length: cellCount }, () => []);
    const overflow: number[] = new Array(cellCount).fill(0);
    for (let decalIndex = 0; decalIndex < visible.length; decalIndex++) {
      const decal = visible[decalIndex]!;
      for (let z = decal.clusterBegin.z; z <= decal.clusterEnd.z; z++) {
        for (let y = decal.clusterBegin.y; y <= decal.clusterEnd.y; y++) {
          for (let x = decal.clusterBegin.x; x <= decal.clusterEnd.x; x++) {
            const index = x + y * grid.x + z * grid.x * grid.y;
            if (cellLists[index]!.length < grid.maxPerCluster) cellLists[index]!.push(decalIndex);
            else overflow[index]!++;
          }
        }
      }
    }
    const offsets = new Uint32Array(cellCount + 1);
    for (let index = 0; index < cellCount; index++) offsets[index + 1] = offsets[index]! + cellLists[index]!.length;
    const indices = new Uint32Array(offsets[cellCount]!);
    for (let index = 0; index < cellCount; index++) indices.set(cellLists[index]!, offsets[index]);
    const cells: GodotClusteredDecalCell[] = cellLists.map((decals, index) => Object.freeze({
      index,
      x: index % grid.x,
      y: Math.floor(index / grid.x) % grid.y,
      z: Math.floor(index / (grid.x * grid.y)),
      decals: Object.freeze([...decals]),
      overflow: overflow[index]!,
    }));
    this.lastFrame = Object.freeze({
      frame,
      grid,
      decals: Object.freeze(visible),
      cells: Object.freeze(cells),
      indices,
      offsets,
      overflow: overflow.reduce((sum, value) => sum + value, 0),
      culled,
      generation: this.generation,
    });
    for (const watcher of this.watchers) watcher(this.lastFrame);
    return this.lastFrame;
  }

  getLastFrame(): GodotClusteredDecalFrame | null {
    return this.lastFrame;
  }

  watch(listener: (frame: GodotClusteredDecalFrame) => void): () => void {
    this.watchers.add(listener);
    if (this.lastFrame !== null) listener(this.lastFrame);
    return () => this.watchers.delete(listener);
  }

  clear(): void {
    this.decals.clear();
    this.lastFrame = null;
    this.generation++;
  }

  dispose(): void {
    this.clear();
    this.watchers.clear();
  }

  private resolve(
    decal: MutableDecal,
    view: Required<GodotClusteredDecalView>,
    grid: Required<GodotClusteredDecalGrid>,
  ): GodotClusteredDecalInstance | null {
    const value = decal.descriptor;
    if (!value.enabled || (value.layerMask & view.layerMask) === 0) return null;
    const relative = subtract(value.position, view.position);
    const viewX = dot(relative, view.right);
    const viewY = dot(relative, view.up);
    const viewZ = dot(relative, view.forward);
    const radius = length(value.halfExtents);
    if (viewZ + radius < view.near || viewZ - radius > view.far) return null;
    const depth = Math.max(view.near, viewZ);
    const halfHeight = Math.tan(view.verticalFov * 0.5) * depth;
    const halfWidth = halfHeight * view.aspect;
    if (Math.abs(viewX) - radius > halfWidth || Math.abs(viewY) - radius > halfHeight) return null;
    const distance = length(relative);
    let fade = 1;
    if (value.distanceFadeEnabled && distance > value.distanceFadeBegin) {
      fade = value.distanceFadeLength <= 0 ? 0 : Math.max(0, 1 - (distance - value.distanceFadeBegin) / value.distanceFadeLength);
      if (fade <= 0) return null;
    }
    const nearDepth = Math.max(view.near, viewZ - radius);
    const farDepth = Math.min(view.far, viewZ + radius);
    const zBegin = this.depthSlice(nearDepth, view.near, view.far, grid.z);
    const zEnd = this.depthSlice(farDepth, view.near, view.far, grid.z);
    const project = (coordinate: number, extent: number, depthValue: number, dimension: number): [number, number] => {
      const span = coordinate === viewX
        ? Math.tan(view.verticalFov * 0.5) * depthValue * view.aspect
        : Math.tan(view.verticalFov * 0.5) * depthValue;
      const minimum = Math.floor(((coordinate - extent) / Math.max(span, Number.EPSILON) * 0.5 + 0.5) * dimension);
      const maximum = Math.floor(((coordinate + extent) / Math.max(span, Number.EPSILON) * 0.5 + 0.5) * dimension);
      return [Math.max(0, Math.min(dimension - 1, minimum)), Math.max(0, Math.min(dimension - 1, maximum))];
    };
    const [xBegin, xEnd] = project(viewX, radius, nearDepth, grid.x);
    const [yBegin, yEnd] = project(viewY, radius, nearDepth, grid.y);
    return Object.freeze({
      rid: value.rid,
      position: value.position,
      halfExtents: value.halfExtents,
      direction: value.direction,
      priority: value.priority,
      fade,
      upperFade: value.upperFade,
      lowerFade: value.lowerFade,
      normalFade: value.normalFade,
      albedoMix: value.albedoMix,
      emissionEnergy: value.emissionEnergy,
      modulate: value.modulate,
      atlasBinding: value.atlasBinding,
      distance,
      clusterBegin: Object.freeze({ x: Math.min(xBegin, xEnd), y: Math.min(yBegin, yEnd), z: Math.min(zBegin, zEnd) }),
      clusterEnd: Object.freeze({ x: Math.max(xBegin, xEnd), y: Math.max(yBegin, yEnd), z: Math.max(zBegin, zEnd) }),
      revision: decal.revision,
    });
  }

  private depthSlice(depth: number, near: number, far: number, slices: number): number {
    const normalized = Math.log(depth / near) / Math.log(far / near);
    return Math.max(0, Math.min(slices - 1, Math.floor(normalized * slices)));
  }

  private normalizeView(value: GodotClusteredDecalView): Required<GodotClusteredDecalView> {
    const near = finite(value.near, 'decal view near', Number.EPSILON);
    const far = finite(value.far, 'decal view far', near);
    return Object.freeze({
      position: vector(value.position, 'decal view position'),
      forward: normalize(vector(value.forward, 'decal view forward')),
      right: normalize(vector(value.right, 'decal view right')),
      up: normalize(vector(value.up, 'decal view up')),
      near,
      far,
      verticalFov: finite(value.verticalFov, 'decal view vertical fov', Number.EPSILON, Math.PI - Number.EPSILON),
      aspect: finite(value.aspect, 'decal view aspect', Number.EPSILON),
      layerMask: mask(value.layerMask ?? 0xffff_ffff, 'decal view layer mask'),
    });
  }

  private require(rid: GodotClusteredDecalRid): MutableDecal {
    const value = this.decals.get(rid);
    if (value === undefined) throw new Error('godot-compat: unknown clustered decal RID.');
    return value;
  }
}

export function createGodotClusteredDecalRuntime(): GodotClusteredDecalRuntime {
  return new GodotClusteredDecalRuntime();
}
