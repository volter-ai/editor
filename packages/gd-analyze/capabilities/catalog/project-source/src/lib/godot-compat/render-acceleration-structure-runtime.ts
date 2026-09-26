export type GodotAccelerationRid = string | number;

export interface GodotAccelerationGeometryDescriptor<TGeometry = unknown> {
  readonly rid: GodotAccelerationRid;
  readonly geometry: TGeometry;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly dynamic?: boolean;
  readonly allowCompaction?: boolean;
  readonly opaque?: boolean;
  readonly priority?: number;
}

export interface GodotAccelerationTransform {
  readonly elements: ArrayLike<number>;
}

export interface GodotAccelerationInstanceDescriptor {
  readonly rid: GodotAccelerationRid;
  readonly geometry: GodotAccelerationRid;
  readonly transform: GodotAccelerationTransform | ArrayLike<number>;
  readonly mask?: number;
  readonly customIndex?: number;
  readonly shaderBindingOffset?: number;
  readonly flags?: number;
  readonly visible?: boolean;
  readonly priority?: number;
}

export interface GodotAccelerationBlasBuild<TGeometry = unknown, TBlas = unknown> {
  readonly geometry: GodotAccelerationGeometryDescriptor<TGeometry>;
  readonly previous: TBlas | null;
  readonly mode: 'build' | 'refit';
  readonly generation: number;
}

export interface GodotAccelerationTlasInstance<TBlas = unknown> {
  readonly instance: GodotAccelerationRid;
  readonly blas: TBlas;
  readonly transform: Float32Array;
  readonly mask: number;
  readonly customIndex: number;
  readonly shaderBindingOffset: number;
  readonly flags: number;
  readonly generation: number;
}

export interface GodotAccelerationTlasBuild<TBlas = unknown, TTlas = unknown> {
  readonly instances: readonly GodotAccelerationTlasInstance<TBlas>[];
  readonly previous: TTlas | null;
  readonly mode: 'build' | 'update';
  readonly generation: number;
}

export interface GodotAccelerationFrameResult {
  readonly frame: number;
  readonly builtBlas: readonly GodotAccelerationRid[];
  readonly refitBlas: readonly GodotAccelerationRid[];
  readonly compactedBlas: readonly GodotAccelerationRid[];
  readonly deferredBlas: readonly GodotAccelerationRid[];
  readonly rebuiltTlas: boolean;
  readonly updatedTlas: boolean;
  readonly failed: readonly { rid: GodotAccelerationRid | null; error: unknown }[];
  readonly generation: number;
}

export interface GodotAccelerationSnapshot {
  readonly frame: number;
  readonly geometries: number;
  readonly instances: number;
  readonly residentBlas: number;
  readonly dirtyBlas: number;
  readonly tlasResident: boolean;
  readonly tlasDirty: boolean;
  readonly buildBudget: number;
  readonly builds: number;
  readonly refits: number;
  readonly compactions: number;
  readonly tlasBuilds: number;
  readonly generation: number;
}

export interface GodotAccelerationBackend<TGeometry = unknown, TBlas = unknown, TTlas = unknown> {
  buildBlas(value: GodotAccelerationBlasBuild<TGeometry, TBlas>): TBlas | Promise<TBlas>;
  compactBlas?(blas: TBlas, geometry: GodotAccelerationGeometryDescriptor<TGeometry>): TBlas | Promise<TBlas>;
  destroyBlas(blas: TBlas): void;
  buildTlas(value: GodotAccelerationTlasBuild<TBlas, TTlas>): TTlas | Promise<TTlas>;
  destroyTlas(tlas: TTlas): void;
}

interface GeometryState<TGeometry, TBlas> {
  descriptor: Required<GodotAccelerationGeometryDescriptor<TGeometry>>;
  blas: TBlas | null;
  dirty: boolean;
  topologyDirty: boolean;
  compacted: boolean;
  references: Set<GodotAccelerationRid>;
  revision: number;
  lastBuiltFrame: number;
}

interface InstanceState {
  descriptor: Required<Omit<GodotAccelerationInstanceDescriptor, 'transform'>> & { transform: Float32Array };
  revision: number;
}

function finite(value: unknown, member: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new TypeError(`godot-compat: ${member} requires a finite number.`);
  return result;
}

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, member);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function transform(value: GodotAccelerationTransform | ArrayLike<number>): Float32Array {
  const source = typeof value === 'object' && value !== null && 'elements' in value
    ? value.elements
    : value as ArrayLike<number>;
  if (source.length !== 12 && source.length !== 16) {
    throw new RangeError('godot-compat: acceleration instance transform requires 12 or 16 values.');
  }
  const result = new Float32Array(12);
  if (source.length === 12) {
    for (let index = 0; index < 12; index++) result[index] = finite(source[index], 'acceleration transform');
  } else {
    const indices = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14];
    indices.forEach((sourceIndex, index) => { result[index] = finite(source[sourceIndex], 'acceleration transform'); });
  }
  return result;
}

function geometryDescriptor<TGeometry>(
  value: GodotAccelerationGeometryDescriptor<TGeometry>,
): Required<GodotAccelerationGeometryDescriptor<TGeometry>> {
  return Object.freeze({
    rid: value.rid,
    geometry: value.geometry,
    vertexCount: integer(value.vertexCount, 'acceleration vertex count', 0),
    indexCount: integer(value.indexCount, 'acceleration index count', 0),
    dynamic: value.dynamic ?? false,
    allowCompaction: value.allowCompaction ?? !value.dynamic,
    opaque: value.opaque ?? true,
    priority: integer(value.priority ?? 0, 'acceleration geometry priority', -128, 127),
  });
}

function instanceDescriptor(
  value: GodotAccelerationInstanceDescriptor,
): Required<Omit<GodotAccelerationInstanceDescriptor, 'transform'>> & { transform: Float32Array } {
  return Object.freeze({
    rid: value.rid,
    geometry: value.geometry,
    transform: transform(value.transform),
    mask: integer(value.mask ?? 0xff, 'acceleration instance mask', 0, 0xff),
    customIndex: integer(value.customIndex ?? 0, 'acceleration custom index', 0, 0xff_ffff),
    shaderBindingOffset: integer(value.shaderBindingOffset ?? 0, 'acceleration shader binding offset', 0, 0xff_ffff),
    flags: integer(value.flags ?? 0, 'acceleration instance flags', 0, 0xff),
    visible: value.visible ?? true,
    priority: integer(value.priority ?? 0, 'acceleration instance priority', -128, 127),
  });
}

export class GodotRenderAccelerationStructureRuntime<TGeometry = unknown, TBlas = unknown, TTlas = unknown> {
  private readonly geometries = new Map<GodotAccelerationRid, GeometryState<TGeometry, TBlas>>();
  private readonly instances = new Map<GodotAccelerationRid, InstanceState>();
  private readonly watchers = new Set<(result: GodotAccelerationFrameResult) => void>();
  private tlas: TTlas | null = null;
  private tlasDirty = true;
  private tlasTopologyDirty = true;
  private frame = 0;
  private generation = 1;
  private buildBudget = 8;
  private builds = 0;
  private refits = 0;
  private compactions = 0;
  private tlasBuilds = 0;
  private processing = false;
  private lastFrame: GodotAccelerationFrameResult | null = null;

  constructor(private backend: GodotAccelerationBackend<TGeometry, TBlas, TTlas>) {}

  addGeometry(value: GodotAccelerationGeometryDescriptor<TGeometry>): void {
    if (this.geometries.has(value.rid)) throw new Error('godot-compat: acceleration geometry RID already exists.');
    this.geometries.set(value.rid, {
      descriptor: geometryDescriptor(value),
      blas: null,
      dirty: true,
      topologyDirty: true,
      compacted: false,
      references: new Set(),
      revision: ++this.generation,
      lastBuiltFrame: -1,
    });
  }

  updateGeometry(
    rid: GodotAccelerationRid,
    patch: Partial<Omit<GodotAccelerationGeometryDescriptor<TGeometry>, 'rid'>>,
    topologyChanged = true,
  ): void {
    const geometry = this.requireGeometry(rid);
    geometry.descriptor = geometryDescriptor({ ...geometry.descriptor, ...patch, rid });
    geometry.dirty = true;
    geometry.topologyDirty ||= topologyChanged;
    geometry.compacted = false;
    geometry.revision = ++this.generation;
    this.tlasDirty = true;
  }

  removeGeometry(rid: GodotAccelerationRid, force = false): boolean {
    const geometry = this.geometries.get(rid);
    if (geometry === undefined) return false;
    if (!force && geometry.references.size > 0) throw new Error('godot-compat: acceleration geometry still has instances.');
    for (const instanceRid of [...geometry.references]) this.removeInstance(instanceRid);
    if (geometry.blas !== null) this.backend.destroyBlas(geometry.blas);
    this.geometries.delete(rid);
    this.tlasDirty = true;
    this.tlasTopologyDirty = true;
    this.generation++;
    return true;
  }

  addInstance(value: GodotAccelerationInstanceDescriptor): void {
    if (this.instances.has(value.rid)) throw new Error('godot-compat: acceleration instance RID already exists.');
    const geometry = this.requireGeometry(value.geometry);
    const descriptor = instanceDescriptor(value);
    this.instances.set(value.rid, { descriptor, revision: ++this.generation });
    geometry.references.add(value.rid);
    this.tlasDirty = true;
    this.tlasTopologyDirty = true;
  }

  updateInstance(
    rid: GodotAccelerationRid,
    patch: Partial<Omit<GodotAccelerationInstanceDescriptor, 'rid'>>,
  ): void {
    const instance = this.requireInstance(rid);
    const previousGeometry = instance.descriptor.geometry;
    const descriptor = instanceDescriptor({ ...instance.descriptor, ...patch, rid });
    this.requireGeometry(descriptor.geometry);
    if (previousGeometry !== descriptor.geometry) {
      this.requireGeometry(previousGeometry).references.delete(rid);
      this.requireGeometry(descriptor.geometry).references.add(rid);
      this.tlasTopologyDirty = true;
    }
    instance.descriptor = descriptor;
    instance.revision = ++this.generation;
    this.tlasDirty = true;
  }

  setInstanceTransform(rid: GodotAccelerationRid, value: GodotAccelerationTransform | ArrayLike<number>): void {
    this.updateInstance(rid, { transform: value });
  }

  removeInstance(rid: GodotAccelerationRid): boolean {
    const instance = this.instances.get(rid);
    if (instance === undefined) return false;
    this.geometries.get(instance.descriptor.geometry)?.references.delete(rid);
    this.instances.delete(rid);
    this.tlasDirty = true;
    this.tlasTopologyDirty = true;
    this.generation++;
    return true;
  }

  invalidateGeometry(rid: GodotAccelerationRid, topologyChanged = false): void {
    const geometry = this.requireGeometry(rid);
    geometry.dirty = true;
    geometry.topologyDirty ||= topologyChanged;
    geometry.revision = ++this.generation;
  }

  async process(frameValue: number): Promise<GodotAccelerationFrameResult> {
    const frame = integer(frameValue, 'acceleration frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: acceleration frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: acceleration structures are already processing.');
    this.frame = frame;
    this.processing = true;
    const builtBlas: GodotAccelerationRid[] = [];
    const refitBlas: GodotAccelerationRid[] = [];
    const compactedBlas: GodotAccelerationRid[] = [];
    const deferredBlas: GodotAccelerationRid[] = [];
    const failed: Array<{ rid: GodotAccelerationRid | null; error: unknown }> = [];
    let rebuiltTlas = false;
    let updatedTlas = false;
    try {
      const dirty = [...this.geometries.values()]
        .filter((geometry) => geometry.dirty)
        .sort((left, right) =>
          right.descriptor.priority - left.descriptor.priority
          || Number(right.references.size > 0) - Number(left.references.size > 0)
          || left.lastBuiltFrame - right.lastBuiltFrame);
      for (let index = 0; index < dirty.length; index++) {
        const geometry = dirty[index]!;
        if (index >= this.buildBudget) {
          deferredBlas.push(geometry.descriptor.rid);
          continue;
        }
        const mode = geometry.blas !== null && geometry.descriptor.dynamic && !geometry.topologyDirty ? 'refit' : 'build';
        try {
          const previous = geometry.blas;
          let next = await this.backend.buildBlas({
            geometry: geometry.descriptor,
            previous,
            mode,
            generation: geometry.revision,
          });
          if (previous !== null && previous !== next) this.backend.destroyBlas(previous);
          geometry.blas = next;
          geometry.dirty = false;
          geometry.topologyDirty = false;
          geometry.lastBuiltFrame = frame;
          geometry.revision = ++this.generation;
          if (mode === 'build') {
            builtBlas.push(geometry.descriptor.rid);
            this.builds++;
          } else {
            refitBlas.push(geometry.descriptor.rid);
            this.refits++;
          }
          if (geometry.descriptor.allowCompaction && !geometry.compacted && this.backend.compactBlas !== undefined) {
            const compacted = await this.backend.compactBlas(next, geometry.descriptor);
            if (compacted !== next) this.backend.destroyBlas(next);
            next = compacted;
            geometry.blas = compacted;
            geometry.compacted = true;
            compactedBlas.push(geometry.descriptor.rid);
            this.compactions++;
          }
          this.tlasDirty = true;
        } catch (error) {
          failed.push(Object.freeze({ rid: geometry.descriptor.rid, error }));
        }
      }
      if (this.tlasDirty && this.canBuildTlas()) {
        try {
          const mode = this.tlas !== null && !this.tlasTopologyDirty ? 'update' : 'build';
          const previous = this.tlas;
          const instances = this.tlasInstances();
          const next = await this.backend.buildTlas({
            instances,
            previous,
            mode,
            generation: this.generation,
          });
          if (previous !== null && previous !== next) this.backend.destroyTlas(previous);
          this.tlas = next;
          this.tlasDirty = false;
          this.tlasTopologyDirty = false;
          this.tlasBuilds++;
          rebuiltTlas = mode === 'build';
          updatedTlas = mode === 'update';
          this.generation++;
        } catch (error) {
          failed.push(Object.freeze({ rid: null, error }));
        }
      }
      this.lastFrame = Object.freeze({
        frame,
        builtBlas: Object.freeze(builtBlas),
        refitBlas: Object.freeze(refitBlas),
        compactedBlas: Object.freeze(compactedBlas),
        deferredBlas: Object.freeze(deferredBlas),
        rebuiltTlas,
        updatedTlas,
        failed: Object.freeze(failed),
        generation: this.generation,
      });
      for (const watcher of this.watchers) watcher(this.lastFrame);
      return this.lastFrame;
    } finally {
      this.processing = false;
    }
  }

  getBlas(rid: GodotAccelerationRid): TBlas | null {
    return this.requireGeometry(rid).blas;
  }

  getTlas(): TTlas | null {
    return this.tlas;
  }

  setBuildBudget(value: number): void {
    this.buildBudget = integer(value, 'acceleration build budget', 1, 4096);
  }

  getLastFrame(): GodotAccelerationFrameResult | null {
    return this.lastFrame;
  }

  getSnapshot(): GodotAccelerationSnapshot {
    return Object.freeze({
      frame: this.frame,
      geometries: this.geometries.size,
      instances: this.instances.size,
      residentBlas: [...this.geometries.values()].filter((geometry) => geometry.blas !== null).length,
      dirtyBlas: [...this.geometries.values()].filter((geometry) => geometry.dirty).length,
      tlasResident: this.tlas !== null,
      tlasDirty: this.tlasDirty,
      buildBudget: this.buildBudget,
      builds: this.builds,
      refits: this.refits,
      compactions: this.compactions,
      tlasBuilds: this.tlasBuilds,
      generation: this.generation,
    });
  }

  watch(listener: (result: GodotAccelerationFrameResult) => void): () => void {
    this.watchers.add(listener);
    if (this.lastFrame !== null) listener(this.lastFrame);
    return () => this.watchers.delete(listener);
  }

  replaceBackend(backend: GodotAccelerationBackend<TGeometry, TBlas, TTlas>): void {
    if (this.tlas !== null) this.backend.destroyTlas(this.tlas);
    for (const geometry of this.geometries.values()) {
      if (geometry.blas !== null) this.backend.destroyBlas(geometry.blas);
      geometry.blas = null;
      geometry.dirty = true;
      geometry.topologyDirty = true;
      geometry.compacted = false;
    }
    this.tlas = null;
    this.tlasDirty = true;
    this.tlasTopologyDirty = true;
    this.backend = backend;
    this.generation++;
  }

  dispose(): void {
    if (this.tlas !== null) this.backend.destroyTlas(this.tlas);
    for (const geometry of this.geometries.values()) if (geometry.blas !== null) this.backend.destroyBlas(geometry.blas);
    this.geometries.clear();
    this.instances.clear();
    this.watchers.clear();
    this.tlas = null;
    this.lastFrame = null;
    this.generation++;
  }

  private tlasInstances(): readonly GodotAccelerationTlasInstance<TBlas>[] {
    return Object.freeze([...this.instances.values()]
      .filter((instance) => instance.descriptor.visible)
      .sort((left, right) => right.descriptor.priority - left.descriptor.priority)
      .map((instance) => {
        const geometry = this.requireGeometry(instance.descriptor.geometry);
        if (geometry.blas === null) throw new Error('godot-compat: acceleration instance geometry has no BLAS.');
        return Object.freeze({
          instance: instance.descriptor.rid,
          blas: geometry.blas,
          transform: instance.descriptor.transform.slice(),
          mask: instance.descriptor.mask,
          customIndex: instance.descriptor.customIndex,
          shaderBindingOffset: instance.descriptor.shaderBindingOffset,
          flags: instance.descriptor.flags,
          generation: instance.revision,
        });
      }));
  }

  private canBuildTlas(): boolean {
    return [...this.instances.values()]
      .filter((instance) => instance.descriptor.visible)
      .every((instance) => this.geometries.get(instance.descriptor.geometry)?.blas !== null);
  }

  private requireGeometry(rid: GodotAccelerationRid): GeometryState<TGeometry, TBlas> {
    const value = this.geometries.get(rid);
    if (value === undefined) throw new Error('godot-compat: unknown acceleration geometry.');
    return value;
  }

  private requireInstance(rid: GodotAccelerationRid): InstanceState {
    const value = this.instances.get(rid);
    if (value === undefined) throw new Error('godot-compat: unknown acceleration instance.');
    return value;
  }
}

export function createGodotRenderAccelerationStructureRuntime<TGeometry = unknown, TBlas = unknown, TTlas = unknown>(
  backend: GodotAccelerationBackend<TGeometry, TBlas, TTlas>,
): GodotRenderAccelerationStructureRuntime<TGeometry, TBlas, TTlas> {
  return new GodotRenderAccelerationStructureRuntime(backend);
}
