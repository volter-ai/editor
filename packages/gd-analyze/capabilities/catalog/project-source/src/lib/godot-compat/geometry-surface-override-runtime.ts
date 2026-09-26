export type GodotGeometrySurfaceRid = string | number;

export const GODOT_GEOMETRY_SURFACE_PASS = {
  COLOR: 'color',
  SHADOW: 'shadow',
  DEPTH: 'depth',
  MOTION: 'motion',
} as const;

export type GodotGeometrySurfacePass =
  (typeof GODOT_GEOMETRY_SURFACE_PASS)[keyof typeof GODOT_GEOMETRY_SURFACE_PASS];

export interface GodotGeometrySurfaceSource {
  readonly surface: number;
  readonly material: GodotGeometrySurfaceRid | null;
  readonly primitive: number;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly castsShadow?: boolean;
  readonly receivesShadow?: boolean;
  readonly transparent?: boolean;
  readonly doubleSided?: boolean;
  readonly renderPriority?: number;
  readonly visibilityMask?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface GodotGeometryMaterialPass {
  readonly material: GodotGeometrySurfaceRid;
  readonly nextPass: GodotGeometrySurfaceRid | null;
  readonly shadowMaterial: GodotGeometrySurfaceRid | null;
  readonly transparent: boolean;
  readonly depthDraw: boolean;
  readonly depthWrite: boolean;
  readonly castsShadow: boolean;
  readonly renderPriority: number;
  readonly pipeline: GodotGeometrySurfaceRid | null;
}

export interface GodotGeometryInstanceSurfaceOptions {
  readonly mesh: GodotGeometrySurfaceRid | null;
  readonly layerMask?: number;
  readonly visible?: boolean;
  readonly castShadows?: boolean;
  readonly shadowsOnly?: boolean;
  readonly materialOverride?: GodotGeometrySurfaceRid | null;
  readonly materialOverlay?: GodotGeometrySurfaceRid | null;
  readonly renderPriority?: number;
  readonly sortDepth?: number;
}

export interface GodotResolvedGeometrySurface {
  readonly key: string;
  readonly instance: GodotGeometrySurfaceRid;
  readonly mesh: GodotGeometrySurfaceRid | null;
  readonly surface: number;
  readonly pass: GodotGeometrySurfacePass;
  readonly passIndex: number;
  readonly material: GodotGeometrySurfaceRid | null;
  readonly sourceMaterial: GodotGeometrySurfaceRid | null;
  readonly pipeline: GodotGeometrySurfaceRid | null;
  readonly primitive: number;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly transparent: boolean;
  readonly doubleSided: boolean;
  readonly depthWrite: boolean;
  readonly receivesShadow: boolean;
  readonly renderPriority: number;
  readonly sortDepth: number;
  readonly layerMask: number;
  readonly overlay: boolean;
  readonly revision: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface GodotGeometrySurfaceBatch {
  readonly key: string;
  readonly pass: GodotGeometrySurfacePass;
  readonly material: GodotGeometrySurfaceRid | null;
  readonly pipeline: GodotGeometrySurfaceRid | null;
  readonly primitive: number;
  readonly transparent: boolean;
  readonly doubleSided: boolean;
  readonly surfaces: readonly GodotResolvedGeometrySurface[];
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly instanceCount: number;
}

export interface GodotGeometrySurfaceFrame {
  readonly frame: number;
  readonly revision: number;
  readonly pass: GodotGeometrySurfacePass;
  readonly layerMask: number;
  readonly surfaces: readonly GodotResolvedGeometrySurface[];
  readonly batches: readonly GodotGeometrySurfaceBatch[];
  readonly opaqueCount: number;
  readonly transparentCount: number;
  readonly shadowCasterCount: number;
}

export interface GodotGeometrySurfaceBackend {
  rebuild(surface: GodotResolvedGeometrySurface): unknown;
  release?(handle: unknown, surface: GodotResolvedGeometrySurface): void;
}

interface MutableMaterialPass {
  material: GodotGeometrySurfaceRid;
  nextPass: GodotGeometrySurfaceRid | null;
  shadowMaterial: GodotGeometrySurfaceRid | null;
  transparent: boolean;
  depthDraw: boolean;
  depthWrite: boolean;
  castsShadow: boolean;
  renderPriority: number;
  pipeline: GodotGeometrySurfaceRid | null;
  revision: number;
}

interface MutableSurface {
  source: GodotGeometrySurfaceSource;
  override: GodotGeometrySurfaceRid | null;
  overrideSet: boolean;
  revision: number;
}

interface MutableInstance {
  rid: GodotGeometrySurfaceRid;
  mesh: GodotGeometrySurfaceRid | null;
  surfaces: Map<number, MutableSurface>;
  layerMask: number;
  visible: boolean;
  castShadows: boolean;
  shadowsOnly: boolean;
  materialOverride: GodotGeometrySurfaceRid | null;
  materialOverlay: GodotGeometrySurfaceRid | null;
  renderPriority: number;
  sortDepth: number;
  revision: number;
}

interface CachedSurface {
  signature: string;
  value: GodotResolvedGeometrySurface;
  handle: unknown;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`godot-compat: ${member} requires a finite number.`);
  }
  return value;
}

function integer(value: unknown, member: string, minimum = 0): number {
  const result = finite(value, member);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw new RangeError(`godot-compat: ${member} requires an integer >= ${minimum}.`);
  }
  return result;
}

function mask(value: unknown, member: string): number {
  return integer(value, member, 0) >>> 0;
}

function ridKey(rid: GodotGeometrySurfaceRid | null): string {
  return rid === null ? '-' : `${typeof rid}:${String(rid)}`;
}

function cloneMetadata(value: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...(value ?? {}) });
}

function cloneSource(source: GodotGeometrySurfaceSource): GodotGeometrySurfaceSource {
  return Object.freeze({
    surface: integer(source.surface, 'geometry surface index'),
    material: source.material,
    primitive: integer(source.primitive, 'geometry primitive'),
    vertexCount: integer(source.vertexCount, 'geometry vertex count'),
    indexCount: integer(source.indexCount, 'geometry index count'),
    castsShadow: source.castsShadow ?? true,
    receivesShadow: source.receivesShadow ?? true,
    transparent: source.transparent ?? false,
    doubleSided: source.doubleSided ?? false,
    renderPriority: finite(source.renderPriority ?? 0, 'geometry render priority'),
    visibilityMask: mask(source.visibilityMask ?? 0xffffffff, 'geometry visibility mask'),
    metadata: cloneMetadata(source.metadata),
  });
}

function defaultMaterial(rid: GodotGeometrySurfaceRid): MutableMaterialPass {
  return {
    material: rid,
    nextPass: null,
    shadowMaterial: null,
    transparent: false,
    depthDraw: true,
    depthWrite: true,
    castsShadow: true,
    renderPriority: 0,
    pipeline: null,
    revision: 1,
  };
}

function compareRid(left: GodotGeometrySurfaceRid, right: GodotGeometrySurfaceRid): number {
  const a = ridKey(left);
  const b = ridKey(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export class GodotGeometrySurfaceOverrideRuntime {
  private readonly instances = new Map<GodotGeometrySurfaceRid, MutableInstance>();
  private readonly materials = new Map<GodotGeometrySurfaceRid, MutableMaterialPass>();
  private readonly materialUsers = new Map<GodotGeometrySurfaceRid, Set<GodotGeometrySurfaceRid>>();
  private readonly cache = new Map<string, CachedSurface>();
  private readonly dirtyInstances = new Set<GodotGeometrySurfaceRid>();
  private readonly listeners = new Set<(frame: GodotGeometrySurfaceFrame) => void>();
  private revision = 1;

  constructor(private readonly backend?: GodotGeometrySurfaceBackend) {}

  hasInstance(rid: GodotGeometrySurfaceRid): boolean {
    return this.instances.has(rid);
  }

  hasMaterial(rid: GodotGeometrySurfaceRid): boolean {
    return this.materials.has(rid);
  }

  getRevision(): number {
    return this.revision;
  }

  createInstance(rid: GodotGeometrySurfaceRid, options: GodotGeometryInstanceSurfaceOptions): void {
    if (this.instances.has(rid)) throw new Error(`godot-compat: geometry instance ${ridKey(rid)} already exists.`);
    const instance: MutableInstance = {
      rid,
      mesh: options.mesh,
      surfaces: new Map(),
      layerMask: mask(options.layerMask ?? 1, 'geometry instance layer mask'),
      visible: options.visible ?? true,
      castShadows: options.castShadows ?? true,
      shadowsOnly: options.shadowsOnly ?? false,
      materialOverride: options.materialOverride ?? null,
      materialOverlay: options.materialOverlay ?? null,
      renderPriority: finite(options.renderPriority ?? 0, 'geometry instance render priority'),
      sortDepth: finite(options.sortDepth ?? 0, 'geometry instance sort depth'),
      revision: ++this.revision,
    };
    this.instances.set(rid, instance);
    this.dirtyInstances.add(rid);
    this.relinkInstanceMaterials(instance);
  }

  freeInstance(rid: GodotGeometrySurfaceRid): boolean {
    const instance = this.instances.get(rid);
    if (instance === undefined) return false;
    this.unlinkInstanceMaterials(instance);
    this.instances.delete(rid);
    this.dirtyInstances.delete(rid);
    this.releaseInstanceCache(rid);
    this.revision++;
    return true;
  }

  setMesh(rid: GodotGeometrySurfaceRid, mesh: GodotGeometrySurfaceRid | null): void {
    const instance = this.instance(rid);
    if (instance.mesh === mesh) return;
    instance.mesh = mesh;
    this.touch(instance);
  }

  setSurfaces(rid: GodotGeometrySurfaceRid, sources: readonly GodotGeometrySurfaceSource[]): void {
    const instance = this.instance(rid);
    this.unlinkInstanceMaterials(instance);
    const previous = instance.surfaces;
    const next = new Map<number, MutableSurface>();
    for (const value of sources) {
      const source = cloneSource(value);
      if (next.has(source.surface)) throw new Error(`godot-compat: duplicate geometry surface ${source.surface}.`);
      const old = previous.get(source.surface);
      next.set(source.surface, {
        source,
        override: old?.override ?? null,
        overrideSet: old?.overrideSet ?? false,
        revision: ++this.revision,
      });
    }
    instance.surfaces = next;
    this.relinkInstanceMaterials(instance);
    this.touch(instance);
  }

  setSurface(rid: GodotGeometrySurfaceRid, sourceValue: GodotGeometrySurfaceSource): void {
    const instance = this.instance(rid);
    const source = cloneSource(sourceValue);
    this.unlinkInstanceMaterials(instance);
    const previous = instance.surfaces.get(source.surface);
    instance.surfaces.set(source.surface, {
      source,
      override: previous?.override ?? null,
      overrideSet: previous?.overrideSet ?? false,
      revision: ++this.revision,
    });
    this.relinkInstanceMaterials(instance);
    this.touch(instance);
  }

  removeSurface(rid: GodotGeometrySurfaceRid, surface: number): boolean {
    const instance = this.instance(rid);
    const index = integer(surface, 'geometry surface index');
    if (!instance.surfaces.has(index)) return false;
    this.unlinkInstanceMaterials(instance);
    instance.surfaces.delete(index);
    this.relinkInstanceMaterials(instance);
    this.touch(instance);
    return true;
  }

  setSurfaceOverrideMaterial(
    rid: GodotGeometrySurfaceRid,
    surface: number,
    material: GodotGeometrySurfaceRid | null,
  ): void {
    const instance = this.instance(rid);
    const mutable = this.surface(instance, surface);
    if (mutable.overrideSet && mutable.override === material) return;
    this.unlinkInstanceMaterials(instance);
    mutable.override = material;
    mutable.overrideSet = true;
    mutable.revision = ++this.revision;
    this.relinkInstanceMaterials(instance);
    this.touch(instance);
  }

  clearSurfaceOverrideMaterial(rid: GodotGeometrySurfaceRid, surface: number): void {
    const instance = this.instance(rid);
    const mutable = this.surface(instance, surface);
    if (!mutable.overrideSet) return;
    this.unlinkInstanceMaterials(instance);
    mutable.override = null;
    mutable.overrideSet = false;
    mutable.revision = ++this.revision;
    this.relinkInstanceMaterials(instance);
    this.touch(instance);
  }

  getSurfaceOverrideMaterial(rid: GodotGeometrySurfaceRid, surface: number): GodotGeometrySurfaceRid | null {
    const value = this.surface(this.instance(rid), surface);
    return value.overrideSet ? value.override : null;
  }

  getSurfaceOverrideMaterialCount(rid: GodotGeometrySurfaceRid): number {
    return this.instance(rid).surfaces.size;
  }

  setMaterialOverride(rid: GodotGeometrySurfaceRid, material: GodotGeometrySurfaceRid | null): void {
    const instance = this.instance(rid);
    if (instance.materialOverride === material) return;
    this.unlinkInstanceMaterials(instance);
    instance.materialOverride = material;
    this.relinkInstanceMaterials(instance);
    this.touch(instance);
  }

  setMaterialOverlay(rid: GodotGeometrySurfaceRid, material: GodotGeometrySurfaceRid | null): void {
    const instance = this.instance(rid);
    if (instance.materialOverlay === material) return;
    this.unlinkInstanceMaterials(instance);
    instance.materialOverlay = material;
    this.relinkInstanceMaterials(instance);
    this.touch(instance);
  }

  setVisible(rid: GodotGeometrySurfaceRid, visible: boolean): void {
    const instance = this.instance(rid);
    if (instance.visible === visible) return;
    instance.visible = visible;
    this.touch(instance);
  }

  setLayerMask(rid: GodotGeometrySurfaceRid, layerMask: number): void {
    const instance = this.instance(rid);
    const value = mask(layerMask, 'geometry instance layer mask');
    if (instance.layerMask === value) return;
    instance.layerMask = value;
    this.touch(instance);
  }

  setShadowMode(rid: GodotGeometrySurfaceRid, castShadows: boolean, shadowsOnly = false): void {
    const instance = this.instance(rid);
    if (instance.castShadows === castShadows && instance.shadowsOnly === shadowsOnly) return;
    instance.castShadows = castShadows;
    instance.shadowsOnly = shadowsOnly;
    this.touch(instance);
  }

  setSort(rid: GodotGeometrySurfaceRid, sortDepth: number, renderPriority?: number): void {
    const instance = this.instance(rid);
    instance.sortDepth = finite(sortDepth, 'geometry instance sort depth');
    if (renderPriority !== undefined) {
      instance.renderPriority = finite(renderPriority, 'geometry instance render priority');
    }
    this.touch(instance);
  }

  defineMaterial(value: GodotGeometryMaterialPass): void {
    const previous = this.materials.get(value.material);
    const material: MutableMaterialPass = {
      material: value.material,
      nextPass: value.nextPass,
      shadowMaterial: value.shadowMaterial,
      transparent: Boolean(value.transparent),
      depthDraw: Boolean(value.depthDraw),
      depthWrite: Boolean(value.depthWrite),
      castsShadow: Boolean(value.castsShadow),
      renderPriority: finite(value.renderPriority, 'material render priority'),
      pipeline: value.pipeline,
      revision: (previous?.revision ?? 0) + 1,
    };
    this.materials.set(value.material, material);
    this.invalidateMaterial(value.material);
  }

  patchMaterial(
    rid: GodotGeometrySurfaceRid,
    patch: Partial<Omit<GodotGeometryMaterialPass, 'material'>>,
  ): void {
    const current = this.materials.get(rid) ?? defaultMaterial(rid);
    this.defineMaterial({
      material: rid,
      nextPass: patch.nextPass === undefined ? current.nextPass : patch.nextPass,
      shadowMaterial: patch.shadowMaterial === undefined ? current.shadowMaterial : patch.shadowMaterial,
      transparent: patch.transparent ?? current.transparent,
      depthDraw: patch.depthDraw ?? current.depthDraw,
      depthWrite: patch.depthWrite ?? current.depthWrite,
      castsShadow: patch.castsShadow ?? current.castsShadow,
      renderPriority: patch.renderPriority ?? current.renderPriority,
      pipeline: patch.pipeline === undefined ? current.pipeline : patch.pipeline,
    });
  }

  freeMaterial(rid: GodotGeometrySurfaceRid): boolean {
    if (!this.materials.delete(rid)) return false;
    this.invalidateMaterial(rid);
    return true;
  }

  invalidateMaterial(rid: GodotGeometrySurfaceRid): void {
    this.revision++;
    for (const instance of this.materialUsers.get(rid) ?? []) this.dirtyInstances.add(instance);
    for (const [candidateRid, material] of this.materials) {
      if (material.nextPass === rid || material.shadowMaterial === rid) {
        for (const instance of this.materialUsers.get(candidateRid) ?? []) this.dirtyInstances.add(instance);
      }
    }
  }

  watch(listener: (frame: GodotGeometrySurfaceFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resolveFrame(
    frame: number,
    pass: GodotGeometrySurfacePass = GODOT_GEOMETRY_SURFACE_PASS.COLOR,
    layerMask = 0xffffffff,
  ): GodotGeometrySurfaceFrame {
    const frameNumber = integer(frame, 'geometry frame');
    const visibleMask = mask(layerMask, 'geometry frame layer mask');
    this.flushDirtyCache();
    const surfaces: GodotResolvedGeometrySurface[] = [];
    const instances = [...this.instances.values()].sort((a, b) => compareRid(a.rid, b.rid));
    for (const instance of instances) {
      if (!instance.visible || (instance.layerMask & visibleMask) === 0) continue;
      if (pass === GODOT_GEOMETRY_SURFACE_PASS.COLOR && instance.shadowsOnly) continue;
      if (pass === GODOT_GEOMETRY_SURFACE_PASS.SHADOW && !instance.castShadows) continue;
      for (const surface of [...instance.surfaces.values()].sort((a, b) => a.source.surface - b.source.surface)) {
        if (((surface.source.visibilityMask ?? 0xffffffff) & visibleMask) === 0) continue;
        surfaces.push(...this.resolveSurface(instance, surface, pass));
      }
    }
    surfaces.sort((a, b) => this.compareSurfaces(a, b));
    const batches = this.batchSurfaces(surfaces);
    const value: GodotGeometrySurfaceFrame = Object.freeze({
      frame: frameNumber,
      revision: this.revision,
      pass,
      layerMask: visibleMask,
      surfaces: Object.freeze(surfaces),
      batches: Object.freeze(batches),
      opaqueCount: surfaces.filter((surface) => !surface.transparent).length,
      transparentCount: surfaces.filter((surface) => surface.transparent).length,
      shadowCasterCount: surfaces.filter((surface) => surface.pass === GODOT_GEOMETRY_SURFACE_PASS.SHADOW).length,
    });
    for (const listener of this.listeners) listener(value);
    return value;
  }

  clear(): void {
    for (const cached of this.cache.values()) this.backend?.release?.(cached.handle, cached.value);
    this.instances.clear();
    this.materials.clear();
    this.materialUsers.clear();
    this.cache.clear();
    this.dirtyInstances.clear();
    this.revision++;
  }

  private resolveSurface(
    instance: MutableInstance,
    surface: MutableSurface,
    pass: GodotGeometrySurfacePass,
  ): GodotResolvedGeometrySurface[] {
    const sourceMaterial = surface.source.material;
    const baseMaterial = instance.materialOverride ?? (surface.overrideSet ? surface.override : sourceMaterial);
    const values: GodotResolvedGeometrySurface[] = [];
    if (baseMaterial !== null) this.resolveMaterialChain(instance, surface, sourceMaterial, baseMaterial, pass, false, values);
    else values.push(this.resolveOne(instance, surface, sourceMaterial, null, null, pass, 0, false, undefined));
    if (pass === GODOT_GEOMETRY_SURFACE_PASS.COLOR && instance.materialOverlay !== null) {
      this.resolveMaterialChain(instance, surface, sourceMaterial, instance.materialOverlay, pass, true, values);
    }
    return values;
  }

  private resolveMaterialChain(
    instance: MutableInstance,
    surface: MutableSurface,
    sourceMaterial: GodotGeometrySurfaceRid | null,
    root: GodotGeometrySurfaceRid,
    pass: GodotGeometrySurfacePass,
    overlay: boolean,
    output: GodotResolvedGeometrySurface[],
  ): void {
    const visited = new Set<GodotGeometrySurfaceRid>();
    let materialRid: GodotGeometrySurfaceRid | null = root;
    let passIndex = 0;
    while (materialRid !== null) {
      if (visited.has(materialRid)) throw new Error(`godot-compat: material next-pass cycle at ${ridKey(materialRid)}.`);
      visited.add(materialRid);
      let material: MutableMaterialPass = this.materials.get(materialRid) ?? defaultMaterial(materialRid);
      if (pass === GODOT_GEOMETRY_SURFACE_PASS.SHADOW) {
        if (!material.castsShadow || surface.source.castsShadow === false) return;
        const shadowMaterial = material.shadowMaterial;
        if (shadowMaterial !== null) {
          materialRid = shadowMaterial;
          material = this.materials.get(shadowMaterial) ?? defaultMaterial(shadowMaterial);
        }
      }
      if (pass !== GODOT_GEOMETRY_SURFACE_PASS.DEPTH || material.depthDraw) {
        output.push(this.resolveOne(instance, surface, sourceMaterial, materialRid, material.pipeline, pass, passIndex, overlay, material));
      }
      materialRid = pass === GODOT_GEOMETRY_SURFACE_PASS.SHADOW ? null : material.nextPass;
      passIndex++;
    }
  }

  private resolveOne(
    instance: MutableInstance,
    surface: MutableSurface,
    sourceMaterial: GodotGeometrySurfaceRid | null,
    materialRid: GodotGeometrySurfaceRid | null,
    pipeline: GodotGeometrySurfaceRid | null,
    pass: GodotGeometrySurfacePass,
    passIndex: number,
    overlay: boolean,
    material?: MutableMaterialPass,
  ): GodotResolvedGeometrySurface {
    const key = `${ridKey(instance.rid)}/${surface.source.surface}/${pass}/${passIndex}/${overlay ? 1 : 0}`;
    const signature = [
      instance.revision,
      surface.revision,
      material?.revision ?? 0,
      ridKey(materialRid),
      ridKey(pipeline),
      pass,
      overlay ? 1 : 0,
    ].join(':');
    const cached = this.cache.get(key);
    if (cached?.signature === signature) return cached.value;
    if (cached !== undefined) this.backend?.release?.(cached.handle, cached.value);
    const transparent = pass === GODOT_GEOMETRY_SURFACE_PASS.COLOR
      && (surface.source.transparent === true || material?.transparent === true || overlay);
    const value: GodotResolvedGeometrySurface = Object.freeze({
      key,
      instance: instance.rid,
      mesh: instance.mesh,
      surface: surface.source.surface,
      pass,
      passIndex,
      material: materialRid,
      sourceMaterial,
      pipeline,
      primitive: surface.source.primitive,
      vertexCount: surface.source.vertexCount,
      indexCount: surface.source.indexCount,
      transparent,
      doubleSided: surface.source.doubleSided ?? false,
      depthWrite: material?.depthWrite ?? true,
      receivesShadow: surface.source.receivesShadow ?? true,
      renderPriority: instance.renderPriority + (surface.source.renderPriority ?? 0) + (material?.renderPriority ?? 0),
      sortDepth: instance.sortDepth,
      layerMask: instance.layerMask,
      overlay,
      revision: this.revision,
      metadata: surface.source.metadata ?? Object.freeze({}),
    });
    const handle = this.backend?.rebuild(value);
    this.cache.set(key, { signature, value, handle });
    return value;
  }

  private compareSurfaces(left: GodotResolvedGeometrySurface, right: GodotResolvedGeometrySurface): number {
    if (left.transparent !== right.transparent) return left.transparent ? 1 : -1;
    if (left.renderPriority !== right.renderPriority) return left.renderPriority - right.renderPriority;
    if (left.transparent && left.sortDepth !== right.sortDepth) return right.sortDepth - left.sortDepth;
    if (!left.transparent && left.sortDepth !== right.sortDepth) return left.sortDepth - right.sortDepth;
    const pipeline = ridKey(left.pipeline).localeCompare(ridKey(right.pipeline));
    if (pipeline !== 0) return pipeline;
    const material = ridKey(left.material).localeCompare(ridKey(right.material));
    if (material !== 0) return material;
    const instance = ridKey(left.instance).localeCompare(ridKey(right.instance));
    return instance !== 0 ? instance : left.surface - right.surface;
  }

  private batchSurfaces(surfaces: readonly GodotResolvedGeometrySurface[]): GodotGeometrySurfaceBatch[] {
    const batches: GodotGeometrySurfaceBatch[] = [];
    let members: GodotResolvedGeometrySurface[] = [];
    let previousKey = '';
    const flush = (): void => {
      if (members.length === 0) return;
      const first = members[0]!;
      batches.push(Object.freeze({
        key: previousKey,
        pass: first.pass,
        material: first.material,
        pipeline: first.pipeline,
        primitive: first.primitive,
        transparent: first.transparent,
        doubleSided: first.doubleSided,
        surfaces: Object.freeze(members),
        vertexCount: members.reduce((sum, value) => sum + value.vertexCount, 0),
        indexCount: members.reduce((sum, value) => sum + value.indexCount, 0),
        instanceCount: new Set(members.map((value) => value.instance)).size,
      }));
      members = [];
    };
    for (const surface of surfaces) {
      const key = [surface.pass, ridKey(surface.pipeline), ridKey(surface.material), surface.primitive, surface.transparent ? 1 : 0, surface.doubleSided ? 1 : 0].join('/');
      if (members.length > 0 && key !== previousKey) flush();
      previousKey = key;
      members.push(surface);
    }
    flush();
    return batches;
  }

  private touch(instance: MutableInstance): void {
    instance.revision = ++this.revision;
    this.dirtyInstances.add(instance.rid);
  }

  private flushDirtyCache(): void {
    for (const rid of this.dirtyInstances) this.releaseInstanceCache(rid);
    this.dirtyInstances.clear();
  }

  private releaseInstanceCache(rid: GodotGeometrySurfaceRid): void {
    const prefix = `${ridKey(rid)}/`;
    for (const [key, cached] of this.cache) {
      if (!key.startsWith(prefix)) continue;
      this.backend?.release?.(cached.handle, cached.value);
      this.cache.delete(key);
    }
  }

  private instance(rid: GodotGeometrySurfaceRid): MutableInstance {
    const value = this.instances.get(rid);
    if (value === undefined) throw new Error(`godot-compat: unknown geometry instance ${ridKey(rid)}.`);
    return value;
  }

  private surface(instance: MutableInstance, index: number): MutableSurface {
    const surfaceIndex = integer(index, 'geometry surface index');
    const value = instance.surfaces.get(surfaceIndex);
    if (value === undefined) throw new RangeError(`godot-compat: geometry surface ${surfaceIndex} does not exist.`);
    return value;
  }

  private linkMaterial(material: GodotGeometrySurfaceRid | null, instance: GodotGeometrySurfaceRid): void {
    if (material === null) return;
    let users = this.materialUsers.get(material);
    if (users === undefined) {
      users = new Set();
      this.materialUsers.set(material, users);
    }
    users.add(instance);
  }

  private unlinkInstanceMaterials(instance: MutableInstance): void {
    for (const users of this.materialUsers.values()) users.delete(instance.rid);
  }

  private relinkInstanceMaterials(instance: MutableInstance): void {
    this.linkMaterial(instance.materialOverride, instance.rid);
    this.linkMaterial(instance.materialOverlay, instance.rid);
    for (const surface of instance.surfaces.values()) {
      this.linkMaterial(surface.source.material, instance.rid);
      if (surface.overrideSet) this.linkMaterial(surface.override, instance.rid);
    }
  }
}
