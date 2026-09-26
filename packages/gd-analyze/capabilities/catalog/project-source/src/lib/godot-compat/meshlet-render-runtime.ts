export type GodotMeshletRid = string | number;

export interface GodotMeshletVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GodotMeshletGeometry {
  readonly rid: GodotMeshletRid;
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  readonly material?: GodotMeshletRid | null;
  readonly surface?: number;
  readonly lod?: number;
  readonly lodDistance?: number;
}

export interface GodotMeshletDescriptor {
  readonly id: number;
  readonly geometry: GodotMeshletRid;
  readonly material: GodotMeshletRid | null;
  readonly surface: number;
  readonly lod: number;
  readonly lodDistance: number;
  readonly vertexOffset: number;
  readonly vertexCount: number;
  readonly triangleOffset: number;
  readonly triangleCount: number;
  readonly boundsCenter: GodotMeshletVector3;
  readonly boundsRadius: number;
  readonly coneAxis: GodotMeshletVector3;
  readonly coneCutoff: number;
  readonly generation: number;
}

export interface GodotMeshletBuildResult {
  readonly geometry: GodotMeshletRid;
  readonly meshlets: readonly GodotMeshletDescriptor[];
  readonly vertexIndices: Uint32Array;
  readonly triangleIndices: Uint8Array;
  readonly sourceTriangles: number;
  readonly generation: number;
}

export interface GodotMeshletPlane {
  readonly normal: GodotMeshletVector3;
  readonly constant: number;
}

export interface GodotMeshletView {
  readonly position: GodotMeshletVector3;
  readonly forward: GodotMeshletVector3;
  readonly planes: readonly GodotMeshletPlane[];
  readonly layerMask?: number;
  readonly lodBias?: number;
  readonly viewportHeight?: number;
  readonly verticalFov?: number;
}

export interface GodotMeshletInstance {
  readonly rid: GodotMeshletRid;
  readonly geometry: GodotMeshletRid;
  readonly position?: GodotMeshletVector3;
  readonly scale?: GodotMeshletVector3;
  readonly layerMask?: number;
  readonly visible?: boolean;
  readonly cullBackfaces?: boolean;
  readonly lodBias?: number;
  readonly firstInstance?: number;
}

export interface GodotVisibleMeshlet {
  readonly instance: GodotMeshletRid;
  readonly meshlet: GodotMeshletDescriptor;
  readonly center: GodotMeshletVector3;
  readonly radius: number;
  readonly distance: number;
  readonly screenSize: number;
  readonly firstInstance: number;
  readonly generation: number;
}

export interface GodotMeshletIndirectDraw {
  readonly geometry: GodotMeshletRid;
  readonly material: GodotMeshletRid | null;
  readonly surface: number;
  readonly lod: number;
  readonly indexCount: number;
  readonly instanceCount: number;
  readonly firstIndex: number;
  readonly vertexOffset: number;
  readonly firstInstance: number;
  readonly meshlets: readonly GodotVisibleMeshlet[];
}

export interface GodotMeshletCullResult {
  readonly frame: number;
  readonly visible: readonly GodotVisibleMeshlet[];
  readonly draws: readonly GodotMeshletIndirectDraw[];
  readonly tested: number;
  readonly frustumCulled: number;
  readonly coneCulled: number;
  readonly lodCulled: number;
  readonly generation: number;
}

interface MutableInstance {
  descriptor: Required<GodotMeshletInstance>;
  revision: number;
}

interface BuildState {
  result: GodotMeshletBuildResult;
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

function vector(value: GodotMeshletVector3, member: string): GodotMeshletVector3 {
  if (typeof value !== 'object' || value === null) throw new TypeError(`godot-compat: ${member} requires Vector3.`);
  return Object.freeze({
    x: finite(value.x, `${member}.x`),
    y: finite(value.y, `${member}.y`),
    z: finite(value.z, `${member}.z`),
  });
}

function add(left: GodotMeshletVector3, right: GodotMeshletVector3): GodotMeshletVector3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtract(left: GodotMeshletVector3, right: GodotMeshletVector3): GodotMeshletVector3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function multiply(value: GodotMeshletVector3, scale: GodotMeshletVector3): GodotMeshletVector3 {
  return { x: value.x * scale.x, y: value.y * scale.y, z: value.z * scale.z };
}

function dot(left: GodotMeshletVector3, right: GodotMeshletVector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: GodotMeshletVector3, right: GodotMeshletVector3): GodotMeshletVector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function length(value: GodotMeshletVector3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value: GodotMeshletVector3): GodotMeshletVector3 {
  const size = length(value);
  return size <= Number.EPSILON ? { x: 0, y: 0, z: 1 } : { x: value.x / size, y: value.y / size, z: value.z / size };
}

function position(positions: ArrayLike<number>, index: number): GodotMeshletVector3 {
  const offset = index * 3;
  return {
    x: finite(positions[offset], 'meshlet position x'),
    y: finite(positions[offset + 1], 'meshlet position y'),
    z: finite(positions[offset + 2], 'meshlet position z'),
  };
}

function instanceDescriptor(value: GodotMeshletInstance): Required<GodotMeshletInstance> {
  return Object.freeze({
    rid: value.rid,
    geometry: value.geometry,
    position: vector(value.position ?? { x: 0, y: 0, z: 0 }, 'meshlet instance position'),
    scale: vector(value.scale ?? { x: 1, y: 1, z: 1 }, 'meshlet instance scale'),
    layerMask: mask(value.layerMask ?? 1, 'meshlet instance layer mask'),
    visible: value.visible ?? true,
    cullBackfaces: value.cullBackfaces ?? true,
    lodBias: finite(value.lodBias ?? 1, 'meshlet instance lod bias', 0),
    firstInstance: integer(value.firstInstance ?? 0, 'meshlet first instance', 0, 0xffff_ffff),
  });
}

export class GodotMeshletRenderRuntime {
  private readonly geometries = new Map<GodotMeshletRid, BuildState>();
  private readonly instances = new Map<GodotMeshletRid, MutableInstance>();
  private readonly watchers = new Set<(result: GodotMeshletCullResult) => void>();
  private maxVertices: number;
  private maxTriangles: number;
  private generation = 1;
  private nextMeshletId = 1;
  private lastCull: GodotMeshletCullResult | null = null;

  constructor(maxVertices = 64, maxTriangles = 126) {
    this.maxVertices = integer(maxVertices, 'meshlet max vertices', 3, 255);
    this.maxTriangles = integer(maxTriangles, 'meshlet max triangles', 1, 255);
  }

  build(value: GodotMeshletGeometry): GodotMeshletBuildResult {
    if (value.positions.length % 3 !== 0) throw new RangeError('godot-compat: meshlet positions require xyz triples.');
    if (value.indices.length % 3 !== 0) throw new RangeError('godot-compat: meshlet indices require triangle triples.');
    const vertexCount = value.positions.length / 3;
    const globalVertices: number[] = [];
    const localTriangles: number[] = [];
    const meshlets: GodotMeshletDescriptor[] = [];
    let vertexMap = new Map<number, number>();
    let vertices: number[] = [];
    let triangles: number[] = [];
    const flush = (): void => {
      if (triangles.length === 0) return;
      const vertexOffset = globalVertices.length;
      const triangleOffset = localTriangles.length;
      globalVertices.push(...vertices);
      localTriangles.push(...triangles);
      const bounds = this.bounds(value.positions, vertices);
      const cone = this.cone(value.positions, vertices, triangles);
      meshlets.push(Object.freeze({
        id: this.nextMeshletId++,
        geometry: value.rid,
        material: value.material ?? null,
        surface: integer(value.surface ?? 0, 'meshlet surface', 0),
        lod: integer(value.lod ?? 0, 'meshlet lod', 0),
        lodDistance: finite(value.lodDistance ?? 0, 'meshlet lod distance', 0),
        vertexOffset,
        vertexCount: vertices.length,
        triangleOffset,
        triangleCount: triangles.length / 3,
        boundsCenter: Object.freeze(bounds.center),
        boundsRadius: bounds.radius,
        coneAxis: Object.freeze(cone.axis),
        coneCutoff: cone.cutoff,
        generation: this.generation,
      }));
      vertexMap = new Map();
      vertices = [];
      triangles = [];
    };
    for (let triangle = 0; triangle < value.indices.length; triangle += 3) {
      const source = [
        integer(value.indices[triangle], 'meshlet index', 0, vertexCount - 1),
        integer(value.indices[triangle + 1], 'meshlet index', 0, vertexCount - 1),
        integer(value.indices[triangle + 2], 'meshlet index', 0, vertexCount - 1),
      ];
      const newVertices = source.filter((index) => !vertexMap.has(index)).length;
      if (triangles.length / 3 >= this.maxTriangles || vertices.length + newVertices > this.maxVertices) flush();
      for (const index of source) {
        let local = vertexMap.get(index);
        if (local === undefined) {
          local = vertices.length;
          vertexMap.set(index, local);
          vertices.push(index);
        }
        triangles.push(local);
      }
    }
    flush();
    const result: GodotMeshletBuildResult = Object.freeze({
      geometry: value.rid,
      meshlets: Object.freeze(meshlets),
      vertexIndices: Uint32Array.from(globalVertices),
      triangleIndices: Uint8Array.from(localTriangles),
      sourceTriangles: value.indices.length / 3,
      generation: ++this.generation,
    });
    this.geometries.set(value.rid, { result, revision: this.generation });
    return result;
  }

  removeGeometry(rid: GodotMeshletRid): boolean {
    if ([...this.instances.values()].some((instance) => instance.descriptor.geometry === rid)) {
      throw new Error('godot-compat: meshlet geometry still has instances.');
    }
    const removed = this.geometries.delete(rid);
    if (removed) this.generation++;
    return removed;
  }

  addInstance(value: GodotMeshletInstance): void {
    if (this.instances.has(value.rid)) throw new Error('godot-compat: meshlet instance RID already exists.');
    if (!this.geometries.has(value.geometry)) throw new Error('godot-compat: meshlet instance geometry is not built.');
    this.instances.set(value.rid, { descriptor: instanceDescriptor(value), revision: ++this.generation });
  }

  updateInstance(rid: GodotMeshletRid, patch: Partial<Omit<GodotMeshletInstance, 'rid'>>): void {
    const instance = this.requireInstance(rid);
    const next = instanceDescriptor({ ...instance.descriptor, ...patch, rid });
    if (!this.geometries.has(next.geometry)) throw new Error('godot-compat: meshlet instance geometry is not built.');
    instance.descriptor = next;
    instance.revision = ++this.generation;
  }

  removeInstance(rid: GodotMeshletRid): boolean {
    const removed = this.instances.delete(rid);
    if (removed) this.generation++;
    return removed;
  }

  cull(frameValue: number, viewValue: GodotMeshletView): GodotMeshletCullResult {
    const frame = integer(frameValue, 'meshlet cull frame', 0);
    const view = this.normalizeView(viewValue);
    const visible: GodotVisibleMeshlet[] = [];
    let tested = 0;
    let frustumCulled = 0;
    let coneCulled = 0;
    let lodCulled = 0;
    for (const instance of this.instances.values()) {
      if (!instance.descriptor.visible || (instance.descriptor.layerMask & view.layerMask) === 0) continue;
      const geometry = this.geometries.get(instance.descriptor.geometry)!;
      const lodGroups = new Map<number, GodotMeshletDescriptor[]>();
      for (const meshlet of geometry.result.meshlets) {
        let group = lodGroups.get(meshlet.lod);
        if (group === undefined) {
          group = [];
          lodGroups.set(meshlet.lod, group);
        }
        group.push(meshlet);
      }
      const lod = this.selectLod(instance, view, lodGroups);
      for (const meshlet of geometry.result.meshlets) {
        tested++;
        if (meshlet.lod !== lod) {
          lodCulled++;
          continue;
        }
        const scale = instance.descriptor.scale;
        const center = add(multiply(meshlet.boundsCenter, scale), instance.descriptor.position);
        const radius = meshlet.boundsRadius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
        if (!this.inFrustum(center, radius, view.planes)) {
          frustumCulled++;
          continue;
        }
        const toCamera = normalize(subtract(view.position, center));
        if (instance.descriptor.cullBackfaces && dot(meshlet.coneAxis, toCamera) < meshlet.coneCutoff) {
          coneCulled++;
          continue;
        }
        const distance = length(subtract(center, view.position));
        const screenSize = radius / Math.max(distance, Number.EPSILON)
          * view.viewportHeight / (2 * Math.tan(view.verticalFov * 0.5));
        visible.push(Object.freeze({
          instance: instance.descriptor.rid,
          meshlet,
          center: Object.freeze(center),
          radius,
          distance,
          screenSize,
          firstInstance: instance.descriptor.firstInstance,
          generation: instance.revision,
        }));
      }
    }
    visible.sort((left, right) =>
      String(left.meshlet.material).localeCompare(String(right.meshlet.material))
      || left.meshlet.surface - right.meshlet.surface
      || left.meshlet.lod - right.meshlet.lod
      || left.distance - right.distance);
    const draws = this.compactDraws(visible);
    this.lastCull = Object.freeze({
      frame,
      visible: Object.freeze(visible),
      draws: Object.freeze(draws),
      tested,
      frustumCulled,
      coneCulled,
      lodCulled,
      generation: ++this.generation,
    });
    for (const watcher of this.watchers) watcher(this.lastCull);
    return this.lastCull;
  }

  getBuild(rid: GodotMeshletRid): GodotMeshletBuildResult {
    const value = this.geometries.get(rid);
    if (value === undefined) throw new Error('godot-compat: meshlet geometry is not built.');
    return value.result;
  }

  getLastCull(): GodotMeshletCullResult | null {
    return this.lastCull;
  }

  watch(listener: (result: GodotMeshletCullResult) => void): () => void {
    this.watchers.add(listener);
    if (this.lastCull !== null) listener(this.lastCull);
    return () => this.watchers.delete(listener);
  }

  setLimits(maxVertices: number, maxTriangles: number): void {
    this.maxVertices = integer(maxVertices, 'meshlet max vertices', 3, 255);
    this.maxTriangles = integer(maxTriangles, 'meshlet max triangles', 1, 255);
    this.generation++;
  }

  clear(): void {
    this.geometries.clear();
    this.instances.clear();
    this.lastCull = null;
    this.generation++;
  }

  dispose(): void {
    this.clear();
    this.watchers.clear();
  }

  private bounds(positions: ArrayLike<number>, vertices: readonly number[]): { center: GodotMeshletVector3; radius: number } {
    let minimum = { x: Infinity, y: Infinity, z: Infinity };
    let maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const index of vertices) {
      const point = position(positions, index);
      minimum = { x: Math.min(minimum.x, point.x), y: Math.min(minimum.y, point.y), z: Math.min(minimum.z, point.z) };
      maximum = { x: Math.max(maximum.x, point.x), y: Math.max(maximum.y, point.y), z: Math.max(maximum.z, point.z) };
    }
    const center = { x: (minimum.x + maximum.x) * 0.5, y: (minimum.y + maximum.y) * 0.5, z: (minimum.z + maximum.z) * 0.5 };
    let radius = 0;
    for (const index of vertices) radius = Math.max(radius, length(subtract(position(positions, index), center)));
    return { center, radius };
  }

  private cone(
    positions: ArrayLike<number>,
    vertices: readonly number[],
    triangles: readonly number[],
  ): { axis: GodotMeshletVector3; cutoff: number } {
    const normals: GodotMeshletVector3[] = [];
    let sum = { x: 0, y: 0, z: 0 };
    for (let triangle = 0; triangle < triangles.length; triangle += 3) {
      const a = position(positions, vertices[triangles[triangle]!]!);
      const b = position(positions, vertices[triangles[triangle + 1]!]!);
      const c = position(positions, vertices[triangles[triangle + 2]!]!);
      const normal = normalize(cross(subtract(b, a), subtract(c, a)));
      normals.push(normal);
      sum = add(sum, normal);
    }
    const axis = normalize(sum);
    const cutoff = normals.reduce((minimum, normal) => Math.min(minimum, dot(axis, normal)), 1);
    return { axis, cutoff: -Math.sqrt(Math.max(0, 1 - cutoff * cutoff)) };
  }

  private selectLod(
    instance: MutableInstance,
    view: Required<GodotMeshletView>,
    groups: Map<number, GodotMeshletDescriptor[]>,
  ): number {
    const first = [...groups.values()][0]?.[0];
    if (first === undefined) return 0;
    const center = add(multiply(first.boundsCenter, instance.descriptor.scale), instance.descriptor.position);
    const distance = length(subtract(center, view.position)) * instance.descriptor.lodBias * view.lodBias;
    const lods = [...groups.entries()].sort((left, right) => left[0] - right[0]);
    let selected = lods[0]![0];
    for (const [lod, meshlets] of lods) {
      const threshold = meshlets[0]?.lodDistance ?? 0;
      if (distance >= threshold) selected = lod;
    }
    return selected;
  }

  private inFrustum(center: GodotMeshletVector3, radius: number, planes: readonly GodotMeshletPlane[]): boolean {
    return planes.every((plane) => dot(plane.normal, center) + plane.constant >= -radius);
  }

  private compactDraws(visible: readonly GodotVisibleMeshlet[]): GodotMeshletIndirectDraw[] {
    const draws: GodotMeshletIndirectDraw[] = [];
    let begin = 0;
    while (begin < visible.length) {
      const head = visible[begin]!;
      let end = begin + 1;
      while (end < visible.length) {
        const next = visible[end]!;
        if (next.meshlet.geometry !== head.meshlet.geometry
          || next.meshlet.material !== head.meshlet.material
          || next.meshlet.surface !== head.meshlet.surface
          || next.meshlet.lod !== head.meshlet.lod) break;
        end++;
      }
      const meshlets = visible.slice(begin, end);
      draws.push(Object.freeze({
        geometry: head.meshlet.geometry,
        material: head.meshlet.material,
        surface: head.meshlet.surface,
        lod: head.meshlet.lod,
        indexCount: meshlets.reduce((sum, value) => sum + value.meshlet.triangleCount * 3, 0),
        instanceCount: meshlets.length,
        firstIndex: head.meshlet.triangleOffset,
        vertexOffset: head.meshlet.vertexOffset,
        firstInstance: head.firstInstance,
        meshlets: Object.freeze(meshlets),
      }));
      begin = end;
    }
    return draws;
  }

  private normalizeView(value: GodotMeshletView): Required<GodotMeshletView> {
    if (!Array.isArray(value.planes)) throw new TypeError('godot-compat: meshlet view planes require an array.');
    return Object.freeze({
      position: vector(value.position, 'meshlet view position'),
      forward: normalize(vector(value.forward, 'meshlet view forward')),
      planes: Object.freeze(value.planes.map((plane) => Object.freeze({
        normal: normalize(vector(plane.normal, 'meshlet plane normal')),
        constant: finite(plane.constant, 'meshlet plane constant'),
      }))),
      layerMask: mask(value.layerMask ?? 0xffff_ffff, 'meshlet view layer mask'),
      lodBias: finite(value.lodBias ?? 1, 'meshlet view lod bias', 0),
      viewportHeight: finite(value.viewportHeight ?? 1080, 'meshlet viewport height', 1),
      verticalFov: finite(value.verticalFov ?? Math.PI / 3, 'meshlet vertical fov', Number.EPSILON, Math.PI - Number.EPSILON),
    });
  }

  private requireInstance(rid: GodotMeshletRid): MutableInstance {
    const value = this.instances.get(rid);
    if (value === undefined) throw new Error('godot-compat: unknown meshlet instance.');
    return value;
  }
}

export function createGodotMeshletRenderRuntime(
  maxVertices?: number,
  maxTriangles?: number,
): GodotMeshletRenderRuntime {
  return new GodotMeshletRenderRuntime(maxVertices, maxTriangles);
}
