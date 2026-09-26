export type GodotRenderAttachmentRid = string | number;

export type GodotRenderAttachmentKind = 'color' | 'depth' | 'stencil' | 'depth-stencil';
export type GodotRenderAttachmentLoadAction = 'load' | 'clear' | 'discard';
export type GodotRenderAttachmentStoreAction = 'store' | 'discard' | 'resolve';

export interface GodotRenderAttachmentDescriptor {
  readonly name: string;
  readonly kind: GodotRenderAttachmentKind;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly layers?: number;
  readonly mipLevels?: number;
  readonly samples?: number;
  readonly transient?: boolean;
  readonly sampled?: boolean;
  readonly storage?: boolean;
  readonly clearColor?: readonly [number, number, number, number];
  readonly clearDepth?: number;
  readonly clearStencil?: number;
}

export interface GodotRenderAttachmentUse {
  readonly attachment: string;
  readonly pass: string;
  readonly loadAction: GodotRenderAttachmentLoadAction;
  readonly storeAction: GodotRenderAttachmentStoreAction;
  readonly read?: boolean;
  readonly write?: boolean;
  readonly resolveTo?: string | null;
  readonly mipLevel?: number;
  readonly layer?: number;
}

export interface GodotRenderAttachmentAllocation<THandle = unknown> {
  readonly name: string;
  readonly descriptor: GodotRenderAttachmentDescriptor;
  readonly handle: THandle;
  readonly physicalId: number;
  readonly firstPass: number;
  readonly lastPass: number;
  readonly aliased: boolean;
  readonly frame: number;
  readonly generation: number;
}

export interface GodotRenderAttachmentPassBinding<THandle = unknown> {
  readonly pass: string;
  readonly passIndex: number;
  readonly attachment: GodotRenderAttachmentAllocation<THandle>;
  readonly loadAction: GodotRenderAttachmentLoadAction;
  readonly storeAction: GodotRenderAttachmentStoreAction;
  readonly read: boolean;
  readonly write: boolean;
  readonly resolve: GodotRenderAttachmentAllocation<THandle> | null;
  readonly mipLevel: number;
  readonly layer: number;
  readonly clearColor: readonly [number, number, number, number];
  readonly clearDepth: number;
  readonly clearStencil: number;
}

export interface GodotRenderAttachmentFrame<THandle = unknown> {
  readonly frame: number;
  readonly allocations: ReadonlyMap<string, GodotRenderAttachmentAllocation<THandle>>;
  readonly passes: ReadonlyMap<string, readonly GodotRenderAttachmentPassBinding<THandle>[]>;
  readonly physicalAttachments: number;
  readonly logicalAttachments: number;
  readonly aliasCount: number;
  readonly estimatedBytes: number;
  readonly generation: number;
}

export interface GodotRenderAttachmentPoolSnapshot {
  readonly frame: number;
  readonly descriptors: number;
  readonly passUses: number;
  readonly physicalAttachments: number;
  readonly retainedAttachments: number;
  readonly retainedBytes: number;
  readonly allocations: number;
  readonly reuses: number;
  readonly aliases: number;
  readonly releases: number;
  readonly generation: number;
}

export interface GodotRenderAttachmentBackend<THandle = unknown> {
  create(descriptor: GodotRenderAttachmentDescriptor): THandle;
  destroy(handle: THandle, descriptor: GodotRenderAttachmentDescriptor): void;
}

interface MutableDescriptor {
  descriptor: GodotRenderAttachmentDescriptor;
  uses: MutableUse[];
  revision: number;
}

interface MutableUse {
  attachment: string;
  pass: string;
  passIndex: number;
  loadAction: GodotRenderAttachmentLoadAction;
  storeAction: GodotRenderAttachmentStoreAction;
  read: boolean;
  write: boolean;
  resolveTo: string | null;
  mipLevel: number;
  layer: number;
}

interface PhysicalAttachment<THandle> {
  id: number;
  key: string;
  descriptor: GodotRenderAttachmentDescriptor;
  handle: THandle;
  capacityBytes: number;
  inUse: boolean;
  lastUsedFrame: number;
  generation: number;
}

interface Lifetime {
  name: string;
  descriptor: GodotRenderAttachmentDescriptor;
  firstPass: number;
  lastPass: number;
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

function attachmentKind(value: unknown): GodotRenderAttachmentKind {
  if (value !== 'color' && value !== 'depth' && value !== 'stencil' && value !== 'depth-stencil') {
    throw new TypeError(`godot-compat: unknown render attachment kind ${String(value)}.`);
  }
  return value;
}

function loadAction(value: unknown): GodotRenderAttachmentLoadAction {
  if (value !== 'load' && value !== 'clear' && value !== 'discard') {
    throw new TypeError(`godot-compat: unknown attachment load action ${String(value)}.`);
  }
  return value;
}

function storeAction(value: unknown): GodotRenderAttachmentStoreAction {
  if (value !== 'store' && value !== 'discard' && value !== 'resolve') {
    throw new TypeError(`godot-compat: unknown attachment store action ${String(value)}.`);
  }
  return value;
}

function color(value: readonly [number, number, number, number] | undefined): readonly [number, number, number, number] {
  const values = value ?? [0, 0, 0, 0];
  if (values.length !== 4) throw new TypeError('godot-compat: attachment clear color requires four components.');
  return Object.freeze(values.map((component) => finite(component, 'attachment clear color')) as unknown as [number, number, number, number]);
}

function normalize(value: GodotRenderAttachmentDescriptor): GodotRenderAttachmentDescriptor {
  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new TypeError('godot-compat: render attachment name requires a non-empty string.');
  }
  if (typeof value.format !== 'string' || value.format.length === 0) {
    throw new TypeError('godot-compat: render attachment format requires a non-empty string.');
  }
  return Object.freeze({
    name: value.name,
    kind: attachmentKind(value.kind),
    format: value.format,
    width: integer(value.width, 'attachment width', 1),
    height: integer(value.height, 'attachment height', 1),
    layers: integer(value.layers ?? 1, 'attachment layers', 1, 2048),
    mipLevels: integer(value.mipLevels ?? 1, 'attachment mip levels', 1, 32),
    samples: integer(value.samples ?? 1, 'attachment samples', 1, 64),
    transient: value.transient ?? true,
    sampled: value.sampled ?? false,
    storage: value.storage ?? false,
    clearColor: color(value.clearColor),
    clearDepth: finite(value.clearDepth ?? 1, 'attachment clear depth', 0, 1),
    clearStencil: integer(value.clearStencil ?? 0, 'attachment clear stencil', 0, 255),
  });
}

function compatibilityKey(value: GodotRenderAttachmentDescriptor): string {
  return [
    value.kind,
    value.format,
    value.width,
    value.height,
    value.layers,
    value.mipLevels,
    value.samples,
    value.sampled ? 1 : 0,
    value.storage ? 1 : 0,
  ].join(':');
}

function bytesPerPixel(format: string): number {
  const normalized = format.toLowerCase();
  if (normalized.includes('rgba32') || normalized.includes('128')) return 16;
  if (normalized.includes('rgb32') || normalized.includes('96')) return 12;
  if (normalized.includes('rgba16') || normalized.includes('64')) return 8;
  if (normalized.includes('rgb16') || normalized.includes('48')) return 6;
  if (normalized.includes('rgba8') || normalized.includes('rg16') || normalized.includes('depth32') || normalized.includes('32')) return 4;
  if (normalized.includes('rgb8') || normalized.includes('24')) return 3;
  if (normalized.includes('rg8') || normalized.includes('r16') || normalized.includes('depth16') || normalized.includes('16')) return 2;
  return 1;
}

function estimatedBytes(descriptor: GodotRenderAttachmentDescriptor): number {
  let pixels = 0;
  let width = descriptor.width;
  let height = descriptor.height;
  for (let mip = 0; mip < (descriptor.mipLevels ?? 1); mip++) {
    pixels += Math.max(1, width) * Math.max(1, height);
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
  return pixels * (descriptor.layers ?? 1) * (descriptor.samples ?? 1) * bytesPerPixel(descriptor.format);
}

export class GodotRenderAttachmentPoolRuntime<THandle = unknown> {
  private readonly descriptors = new Map<string, MutableDescriptor>();
  private readonly passOrder: string[] = [];
  private readonly physical: PhysicalAttachment<THandle>[] = [];
  private readonly watchers = new Set<(snapshot: GodotRenderAttachmentPoolSnapshot) => void>();
  private frame = 0;
  private nextPhysicalId = 1;
  private generation = 1;
  private allocations = 0;
  private reuses = 0;
  private aliases = 0;
  private releases = 0;
  private retainedFrames: number;
  private lastFrame: GodotRenderAttachmentFrame<THandle> | null = null;

  constructor(
    private backend: GodotRenderAttachmentBackend<THandle>,
    retainedFrames = 3,
  ) {
    this.retainedFrames = integer(retainedFrames, 'attachment retained frames', 0, 64);
  }

  defineAttachment(value: GodotRenderAttachmentDescriptor): void {
    const descriptor = normalize(value);
    const retained = this.descriptors.get(descriptor.name);
    this.descriptors.set(descriptor.name, {
      descriptor,
      uses: retained?.uses ?? [],
      revision: ++this.generation,
    });
    this.lastFrame = null;
    this.publish();
  }

  removeAttachment(name: string): boolean {
    const value = this.descriptors.get(name);
    if (value === undefined) return false;
    for (const descriptor of this.descriptors.values()) {
      if (descriptor.uses.some((use) => use.resolveTo === name)) {
        throw new Error(`godot-compat: attachment ${name} remains a resolve target.`);
      }
    }
    this.descriptors.delete(name);
    this.generation++;
    this.lastFrame = null;
    this.publish();
    return true;
  }

  setPassOrder(passes: readonly string[]): void {
    if (!Array.isArray(passes) || !passes.every((pass) => typeof pass === 'string' && pass.length > 0)) {
      throw new TypeError('godot-compat: attachment pass order requires non-empty strings.');
    }
    if (new Set(passes).size !== passes.length) throw new Error('godot-compat: attachment pass order contains duplicates.');
    this.passOrder.splice(0, this.passOrder.length, ...passes);
    this.reindexUses();
    this.generation++;
    this.lastFrame = null;
    this.publish();
  }

  addUse(value: GodotRenderAttachmentUse): void {
    const attachment = this.requireDescriptor(value.attachment);
    const passIndex = this.passOrder.indexOf(value.pass);
    if (passIndex < 0) throw new Error(`godot-compat: attachment pass ${value.pass} is not registered.`);
    const resolveTo = value.resolveTo ?? null;
    if (resolveTo !== null) {
      const resolve = this.requireDescriptor(resolveTo);
      if ((attachment.descriptor.samples ?? 1) <= 1 || (resolve.descriptor.samples ?? 1) !== 1) {
        throw new Error('godot-compat: attachment resolve requires multisampled source and single-sampled target.');
      }
      if (attachment.descriptor.format !== resolve.descriptor.format
        || attachment.descriptor.width !== resolve.descriptor.width
        || attachment.descriptor.height !== resolve.descriptor.height) {
        throw new Error('godot-compat: attachment resolve target is incompatible with source.');
      }
    }
    const use: MutableUse = {
      attachment: value.attachment,
      pass: value.pass,
      passIndex,
      loadAction: loadAction(value.loadAction),
      storeAction: storeAction(value.storeAction),
      read: value.read ?? value.loadAction === 'load',
      write: value.write ?? true,
      resolveTo,
      mipLevel: integer(value.mipLevel ?? 0, 'attachment use mip level', 0, (attachment.descriptor.mipLevels ?? 1) - 1),
      layer: integer(value.layer ?? 0, 'attachment use layer', 0, (attachment.descriptor.layers ?? 1) - 1),
    };
    if (attachment.uses.some((existing) => existing.pass === use.pass && existing.mipLevel === use.mipLevel && existing.layer === use.layer)) {
      throw new Error(`godot-compat: attachment ${use.attachment} is already used by pass ${use.pass}.`);
    }
    attachment.uses.push(use);
    attachment.uses.sort((left, right) => left.passIndex - right.passIndex);
    attachment.revision = ++this.generation;
    this.lastFrame = null;
    this.publish();
  }

  removeUse(attachmentName: string, pass: string): boolean {
    const attachment = this.requireDescriptor(attachmentName);
    const index = attachment.uses.findIndex((use) => use.pass === pass);
    if (index < 0) return false;
    attachment.uses.splice(index, 1);
    attachment.revision = ++this.generation;
    this.lastFrame = null;
    this.publish();
    return true;
  }

  compile(frameValue: number): GodotRenderAttachmentFrame<THandle> {
    const frame = integer(frameValue, 'attachment frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: attachment frame cannot move backwards.');
    this.frame = frame;
    this.releaseFrameUse();
    const lifetimes = this.lifetimes();
    const allocations = new Map<string, GodotRenderAttachmentAllocation<THandle>>();
    const occupied: Array<{ physical: PhysicalAttachment<THandle>; lastPass: number }> = [];
    for (const lifetime of lifetimes.sort((left, right) => left.firstPass - right.firstPass || left.lastPass - right.lastPass)) {
      let physical = occupied
        .filter((candidate) => candidate.lastPass < lifetime.firstPass && candidate.physical.key === compatibilityKey(lifetime.descriptor))
        .sort((left, right) => left.lastPass - right.lastPass)[0]?.physical;
      let aliased = physical !== undefined;
      if (physical === undefined) {
        physical = this.acquirePhysical(lifetime.descriptor);
        aliased = physical.generation !== this.generation;
      } else {
        this.aliases++;
      }
      physical.inUse = true;
      physical.lastUsedFrame = frame;
      const occupiedIndex = occupied.findIndex((candidate) => candidate.physical === physical);
      if (occupiedIndex >= 0) occupied[occupiedIndex]!.lastPass = lifetime.lastPass;
      else occupied.push({ physical, lastPass: lifetime.lastPass });
      allocations.set(lifetime.name, Object.freeze({
        name: lifetime.name,
        descriptor: lifetime.descriptor,
        handle: physical.handle,
        physicalId: physical.id,
        firstPass: lifetime.firstPass,
        lastPass: lifetime.lastPass,
        aliased,
        frame,
        generation: physical.generation,
      }));
    }
    const passes = new Map<string, GodotRenderAttachmentPassBinding<THandle>[]>();
    for (const pass of this.passOrder) passes.set(pass, []);
    for (const descriptor of this.descriptors.values()) {
      const allocation = allocations.get(descriptor.descriptor.name);
      if (allocation === undefined) continue;
      for (const use of descriptor.uses) {
        passes.get(use.pass)!.push(Object.freeze({
          pass: use.pass,
          passIndex: use.passIndex,
          attachment: allocation,
          loadAction: use.loadAction,
          storeAction: use.storeAction,
          read: use.read,
          write: use.write,
          resolve: use.resolveTo === null ? null : allocations.get(use.resolveTo) ?? null,
          mipLevel: use.mipLevel,
          layer: use.layer,
          clearColor: descriptor.descriptor.clearColor ?? ([0, 0, 0, 0] as const),
          clearDepth: descriptor.descriptor.clearDepth ?? 1,
          clearStencil: descriptor.descriptor.clearStencil ?? 0,
        }));
      }
    }
    for (const bindings of passes.values()) bindings.sort((left, right) => left.attachment.name.localeCompare(right.attachment.name));
    const usedPhysical = new Set([...allocations.values()].map((allocation) => allocation.physicalId));
    this.lastFrame = Object.freeze({
      frame,
      allocations: new Map(allocations),
      passes: new Map([...passes].map(([name, values]) => [name, Object.freeze(values)])),
      physicalAttachments: usedPhysical.size,
      logicalAttachments: allocations.size,
      aliasCount: allocations.size - usedPhysical.size,
      estimatedBytes: [...usedPhysical].reduce((sum, id) => sum + (this.physical.find((entry) => entry.id === id)?.capacityBytes ?? 0), 0),
      generation: this.generation,
    });
    this.trimUnused();
    this.publish();
    return this.lastFrame;
  }

  getLastFrame(): GodotRenderAttachmentFrame<THandle> | null {
    return this.lastFrame;
  }

  getAllocation(name: string): GodotRenderAttachmentAllocation<THandle> | null {
    return this.lastFrame?.allocations.get(name) ?? null;
  }

  getPassBindings(pass: string): readonly GodotRenderAttachmentPassBinding<THandle>[] {
    return this.lastFrame?.passes.get(pass) ?? Object.freeze([]);
  }

  setRetainedFrames(value: number): void {
    this.retainedFrames = integer(value, 'attachment retained frames', 0, 64);
    this.trimUnused();
    this.publish();
  }

  getSnapshot(): GodotRenderAttachmentPoolSnapshot {
    return Object.freeze({
      frame: this.frame,
      descriptors: this.descriptors.size,
      passUses: [...this.descriptors.values()].reduce((sum, descriptor) => sum + descriptor.uses.length, 0),
      physicalAttachments: this.physical.filter((physical) => physical.inUse).length,
      retainedAttachments: this.physical.length,
      retainedBytes: this.physical.reduce((sum, physical) => sum + physical.capacityBytes, 0),
      allocations: this.allocations,
      reuses: this.reuses,
      aliases: this.aliases,
      releases: this.releases,
      generation: this.generation,
    });
  }

  watch(listener: (snapshot: GodotRenderAttachmentPoolSnapshot) => void): () => void {
    this.watchers.add(listener);
    listener(this.getSnapshot());
    return () => this.watchers.delete(listener);
  }

  replaceBackend(backend: GodotRenderAttachmentBackend<THandle>): void {
    for (const physical of this.physical) this.backend.destroy(physical.handle, physical.descriptor);
    this.physical.length = 0;
    this.backend = backend;
    this.lastFrame = null;
    this.generation++;
    this.publish();
  }

  clear(): void {
    for (const physical of this.physical) this.backend.destroy(physical.handle, physical.descriptor);
    this.descriptors.clear();
    this.passOrder.length = 0;
    this.physical.length = 0;
    this.lastFrame = null;
    this.generation++;
    this.publish();
  }

  dispose(): void {
    this.clear();
    this.watchers.clear();
  }

  private lifetimes(): Lifetime[] {
    const values: Lifetime[] = [];
    for (const mutable of this.descriptors.values()) {
      if (mutable.uses.length === 0) continue;
      let firstPass = Math.min(...mutable.uses.map((use) => use.passIndex));
      let lastPass = Math.max(...mutable.uses.map((use) => use.passIndex));
      if (!(mutable.descriptor.transient ?? true)) {
        firstPass = 0;
        lastPass = Math.max(0, this.passOrder.length - 1);
      }
      values.push({ name: mutable.descriptor.name, descriptor: mutable.descriptor, firstPass, lastPass });
    }
    return values;
  }

  private acquirePhysical(descriptor: GodotRenderAttachmentDescriptor): PhysicalAttachment<THandle> {
    const key = compatibilityKey(descriptor);
    const retained = this.physical
      .filter((physical) => !physical.inUse && physical.key === key)
      .sort((left, right) => right.lastUsedFrame - left.lastUsedFrame)[0];
    if (retained !== undefined) {
      retained.inUse = true;
      retained.lastUsedFrame = this.frame;
      retained.generation = ++this.generation;
      this.reuses++;
      return retained;
    }
    const physical: PhysicalAttachment<THandle> = {
      id: this.nextPhysicalId++,
      key,
      descriptor,
      handle: this.backend.create(descriptor),
      capacityBytes: estimatedBytes(descriptor),
      inUse: true,
      lastUsedFrame: this.frame,
      generation: ++this.generation,
    };
    this.physical.push(physical);
    this.allocations++;
    return physical;
  }

  private releaseFrameUse(): void {
    for (const physical of this.physical) physical.inUse = false;
  }

  private trimUnused(): void {
    const cutoff = this.frame - this.retainedFrames;
    for (let index = this.physical.length - 1; index >= 0; index--) {
      const physical = this.physical[index]!;
      if (physical.inUse || physical.lastUsedFrame > cutoff) continue;
      this.backend.destroy(physical.handle, physical.descriptor);
      this.physical.splice(index, 1);
      this.releases++;
      this.generation++;
    }
  }

  private reindexUses(): void {
    for (const descriptor of this.descriptors.values()) {
      for (const use of descriptor.uses) {
        const passIndex = this.passOrder.indexOf(use.pass);
        if (passIndex < 0) throw new Error(`godot-compat: attachment use references missing pass ${use.pass}.`);
        use.passIndex = passIndex;
      }
      descriptor.uses.sort((left, right) => left.passIndex - right.passIndex);
    }
  }

  private requireDescriptor(name: string): MutableDescriptor {
    const value = this.descriptors.get(name);
    if (value === undefined) throw new Error(`godot-compat: unknown render attachment ${name}.`);
    return value;
  }

  private publish(): void {
    if (this.watchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function createGodotRenderAttachmentPoolRuntime<THandle = unknown>(
  backend: GodotRenderAttachmentBackend<THandle>,
  retainedFrames?: number,
): GodotRenderAttachmentPoolRuntime<THandle> {
  return new GodotRenderAttachmentPoolRuntime(backend, retainedFrames);
}
