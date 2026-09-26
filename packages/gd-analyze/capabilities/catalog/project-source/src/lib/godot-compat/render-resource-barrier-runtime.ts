export type GodotRenderBarrierRid = string | number;

export type GodotRenderQueue = 'graphics' | 'compute' | 'transfer' | 'present';
export type GodotRenderResourceKind = 'buffer' | 'texture';
export type GodotRenderResourceLayout =
  | 'undefined'
  | 'general'
  | 'color-attachment'
  | 'depth-stencil-attachment'
  | 'depth-stencil-read-only'
  | 'shader-read-only'
  | 'transfer-source'
  | 'transfer-destination'
  | 'present';

export const GODOT_RENDER_ACCESS = {
  NONE: 0,
  INDIRECT_READ: 1 << 0,
  INDEX_READ: 1 << 1,
  VERTEX_READ: 1 << 2,
  UNIFORM_READ: 1 << 3,
  SHADER_READ: 1 << 4,
  SHADER_WRITE: 1 << 5,
  COLOR_READ: 1 << 6,
  COLOR_WRITE: 1 << 7,
  DEPTH_STENCIL_READ: 1 << 8,
  DEPTH_STENCIL_WRITE: 1 << 9,
  TRANSFER_READ: 1 << 10,
  TRANSFER_WRITE: 1 << 11,
  HOST_READ: 1 << 12,
  HOST_WRITE: 1 << 13,
} as const;

export const GODOT_RENDER_STAGE = {
  TOP: 1 << 0,
  DRAW_INDIRECT: 1 << 1,
  VERTEX_INPUT: 1 << 2,
  VERTEX_SHADER: 1 << 3,
  FRAGMENT_SHADER: 1 << 4,
  EARLY_DEPTH: 1 << 5,
  LATE_DEPTH: 1 << 6,
  COLOR_OUTPUT: 1 << 7,
  COMPUTE_SHADER: 1 << 8,
  TRANSFER: 1 << 9,
  BOTTOM: 1 << 10,
  HOST: 1 << 11,
} as const;

export interface GodotRenderResourceSubrange {
  readonly offset?: number;
  readonly size?: number;
  readonly baseMip?: number;
  readonly mipCount?: number;
  readonly baseLayer?: number;
  readonly layerCount?: number;
}

export interface GodotRenderResourceState {
  readonly queue: GodotRenderQueue;
  readonly stages: number;
  readonly access: number;
  readonly layout: GodotRenderResourceLayout;
  readonly frame: number;
  readonly pass: string;
}

export interface GodotRenderResourceUsage {
  readonly resource: GodotRenderBarrierRid;
  readonly kind: GodotRenderResourceKind;
  readonly queue: GodotRenderQueue;
  readonly stages: number;
  readonly access: number;
  readonly layout?: GodotRenderResourceLayout;
  readonly subrange?: GodotRenderResourceSubrange;
  readonly discard?: boolean;
}

export interface GodotRenderResourceBarrier {
  readonly resource: GodotRenderBarrierRid;
  readonly kind: GodotRenderResourceKind;
  readonly before: GodotRenderResourceState;
  readonly after: GodotRenderResourceState;
  readonly subrange: Readonly<Required<GodotRenderResourceSubrange>>;
  readonly queueTransfer: boolean;
  readonly layoutTransition: boolean;
  readonly memoryHazard: boolean;
  readonly discard: boolean;
  readonly generation: number;
}

export interface GodotRenderPassBarriers {
  readonly frame: number;
  readonly pass: string;
  readonly queue: GodotRenderQueue;
  readonly barriers: readonly GodotRenderResourceBarrier[];
  readonly usages: readonly GodotRenderResourceUsage[];
  readonly generation: number;
}

export interface GodotRenderBarrierSnapshot {
  readonly frame: number;
  readonly resources: number;
  readonly passes: number;
  readonly barriers: number;
  readonly queueTransfers: number;
  readonly layoutTransitions: number;
  readonly memoryHazards: number;
  readonly generation: number;
}

export interface GodotRenderBarrierBackend {
  submit(pass: GodotRenderPassBarriers): void;
}

interface ResourceSegment {
  range: Required<GodotRenderResourceSubrange>;
  state: GodotRenderResourceState;
}

interface ResourceEntry {
  rid: GodotRenderBarrierRid;
  kind: GodotRenderResourceKind;
  byteSize: number;
  mipLevels: number;
  layers: number;
  segments: ResourceSegment[];
  initial: GodotRenderResourceState;
  revision: number;
}

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function resourceKind(value: unknown): GodotRenderResourceKind {
  if (value !== 'buffer' && value !== 'texture') throw new TypeError(`godot-compat: unknown barrier resource kind ${String(value)}.`);
  return value;
}

function queue(value: unknown): GodotRenderQueue {
  if (value !== 'graphics' && value !== 'compute' && value !== 'transfer' && value !== 'present') {
    throw new TypeError(`godot-compat: unknown render queue ${String(value)}.`);
  }
  return value;
}

function layout(value: unknown): GodotRenderResourceLayout {
  if (value !== 'undefined'
    && value !== 'general'
    && value !== 'color-attachment'
    && value !== 'depth-stencil-attachment'
    && value !== 'depth-stencil-read-only'
    && value !== 'shader-read-only'
    && value !== 'transfer-source'
    && value !== 'transfer-destination'
    && value !== 'present') {
    throw new TypeError(`godot-compat: unknown render resource layout ${String(value)}.`);
  }
  return value;
}

function state(
  value: Omit<GodotRenderResourceState, 'frame' | 'pass'> & Partial<Pick<GodotRenderResourceState, 'frame' | 'pass'>>,
): GodotRenderResourceState {
  return Object.freeze({
    queue: queue(value.queue),
    stages: integer(value.stages, 'render barrier stages', 0, 0xffff_ffff),
    access: integer(value.access, 'render barrier access', 0, 0xffff_ffff),
    layout: layout(value.layout),
    frame: integer(value.frame ?? 0, 'render barrier frame', 0),
    pass: value.pass ?? '',
  });
}

function writes(access: number): boolean {
  const writeMask = GODOT_RENDER_ACCESS.SHADER_WRITE
    | GODOT_RENDER_ACCESS.COLOR_WRITE
    | GODOT_RENDER_ACCESS.DEPTH_STENCIL_WRITE
    | GODOT_RENDER_ACCESS.TRANSFER_WRITE
    | GODOT_RENDER_ACCESS.HOST_WRITE;
  return (access & writeMask) !== 0;
}

function reads(access: number): boolean {
  return (access & ~(
    GODOT_RENDER_ACCESS.SHADER_WRITE
    | GODOT_RENDER_ACCESS.COLOR_WRITE
    | GODOT_RENDER_ACCESS.DEPTH_STENCIL_WRITE
    | GODOT_RENDER_ACCESS.TRANSFER_WRITE
    | GODOT_RENDER_ACCESS.HOST_WRITE
  )) !== 0;
}

function cloneRange(value: Required<GodotRenderResourceSubrange>): Readonly<Required<GodotRenderResourceSubrange>> {
  return Object.freeze({ ...value });
}

function ridKey(value: GodotRenderBarrierRid): string {
  return `${typeof value}:${String(value)}`;
}

export class GodotRenderResourceBarrierRuntime {
  private readonly resources = new Map<GodotRenderBarrierRid, ResourceEntry>();
  private readonly passes: GodotRenderPassBarriers[] = [];
  private readonly watchers = new Set<(pass: GodotRenderPassBarriers) => void>();
  private frame = 0;
  private generation = 1;
  private barrierCount = 0;
  private queueTransfers = 0;
  private layoutTransitions = 0;
  private memoryHazards = 0;

  constructor(private backend?: GodotRenderBarrierBackend) {}

  registerBuffer(
    rid: GodotRenderBarrierRid,
    byteSize: number,
    initial: Omit<GodotRenderResourceState, 'frame' | 'pass'>,
  ): void {
    this.register(rid, 'buffer', integer(byteSize, 'barrier buffer byte size', 1), 1, 1, initial);
  }

  registerTexture(
    rid: GodotRenderBarrierRid,
    mipLevels: number,
    layers: number,
    initial: Omit<GodotRenderResourceState, 'frame' | 'pass'>,
  ): void {
    this.register(
      rid,
      'texture',
      0,
      integer(mipLevels, 'barrier texture mip levels', 1, 32),
      integer(layers, 'barrier texture layers', 1, 2048),
      initial,
    );
  }

  unregister(rid: GodotRenderBarrierRid): boolean {
    const removed = this.resources.delete(rid);
    if (removed) this.generation++;
    return removed;
  }

  resetResource(rid: GodotRenderBarrierRid): void {
    const resource = this.require(rid);
    resource.segments = [{ range: this.fullRange(resource), state: resource.initial }];
    resource.revision = ++this.generation;
  }

  setInitialState(
    rid: GodotRenderBarrierRid,
    value: Omit<GodotRenderResourceState, 'frame' | 'pass'>,
    reset = false,
  ): void {
    const resource = this.require(rid);
    resource.initial = state(value);
    if (reset) resource.segments = [{ range: this.fullRange(resource), state: resource.initial }];
    resource.revision = ++this.generation;
  }

  beginFrame(frameValue: number, resetStates = false): void {
    const nextFrame = integer(frameValue, 'render barrier frame', 0);
    if (nextFrame < this.frame) throw new RangeError('godot-compat: render barrier frame cannot move backwards.');
    this.frame = nextFrame;
    this.passes.length = 0;
    if (resetStates) for (const resource of this.resources.values()) this.resetResource(resource.rid);
    this.generation++;
  }

  transitionPass(pass: string, passQueueValue: GodotRenderQueue, usagesValue: readonly GodotRenderResourceUsage[]): GodotRenderPassBarriers {
    if (typeof pass !== 'string' || pass.length === 0) throw new TypeError('godot-compat: render barrier pass requires a name.');
    const passQueue = queue(passQueueValue);
    if (!Array.isArray(usagesValue)) throw new TypeError('godot-compat: render barrier usages require an array.');
    const resourcesSeen = new Set<string>();
    const usages = usagesValue.map((usage) => this.normalizeUsage(usage, passQueue));
    const barriers: GodotRenderResourceBarrier[] = [];
    for (const usage of usages) {
      const resource = this.require(usage.resource);
      if (resource.kind !== usage.kind) throw new TypeError(`godot-compat: barrier kind mismatch for ${ridKey(usage.resource)}.`);
      const range = this.normalizeRange(resource, usage.subrange);
      const key = `${ridKey(usage.resource)}/${JSON.stringify(range)}`;
      if (resourcesSeen.has(key) && writes(usage.access)) {
        throw new Error(`godot-compat: pass ${pass} writes resource ${ridKey(usage.resource)} more than once.`);
      }
      resourcesSeen.add(key);
      const after = state({
        queue: usage.queue,
        stages: usage.stages,
        access: usage.access,
        layout: usage.layout ?? this.defaultLayout(usage),
        frame: this.frame,
        pass,
      });
      const overlapping = resource.segments.filter((segment) => this.overlaps(resource.kind, segment.range, range));
      if (overlapping.length === 0) overlapping.push({ range, state: resource.initial });
      for (const segment of overlapping) {
        const before = usage.discard ? state({ ...resource.initial, frame: this.frame, pass }) : segment.state;
        const queueTransfer = before.queue !== after.queue;
        const layoutTransition = before.layout !== after.layout;
        const memoryHazard = !usage.discard && (writes(before.access) || writes(after.access))
          && (reads(before.access) || reads(after.access) || writes(before.access) || writes(after.access));
        if (!queueTransfer && !layoutTransition && !memoryHazard) continue;
        barriers.push(Object.freeze({
          resource: usage.resource,
          kind: usage.kind,
          before,
          after,
          subrange: cloneRange(range),
          queueTransfer,
          layoutTransition,
          memoryHazard,
          discard: usage.discard ?? false,
          generation: ++this.generation,
        }));
        if (queueTransfer) this.queueTransfers++;
        if (layoutTransition) this.layoutTransitions++;
        if (memoryHazard) this.memoryHazards++;
      }
      this.replaceSegments(resource, range, after);
      resource.revision = ++this.generation;
    }
    this.barrierCount += barriers.length;
    const result: GodotRenderPassBarriers = Object.freeze({
      frame: this.frame,
      pass,
      queue: passQueue,
      barriers: Object.freeze(barriers),
      usages: Object.freeze(usages),
      generation: this.generation,
    });
    this.passes.push(result);
    this.backend?.submit(result);
    for (const watcher of this.watchers) watcher(result);
    return result;
  }

  transitionResource(
    pass: string,
    usage: GodotRenderResourceUsage,
  ): GodotRenderResourceBarrier | null {
    const result = this.transitionPass(pass, usage.queue, [usage]);
    return result.barriers[0] ?? null;
  }

  getState(rid: GodotRenderBarrierRid, subrange?: GodotRenderResourceSubrange): readonly GodotRenderResourceState[] {
    const resource = this.require(rid);
    const range = this.normalizeRange(resource, subrange);
    return Object.freeze(resource.segments
      .filter((segment) => this.overlaps(resource.kind, segment.range, range))
      .map((segment) => segment.state));
  }

  getPasses(): readonly GodotRenderPassBarriers[] {
    return Object.freeze([...this.passes]);
  }

  watch(listener: (pass: GodotRenderPassBarriers) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  getSnapshot(): GodotRenderBarrierSnapshot {
    return Object.freeze({
      frame: this.frame,
      resources: this.resources.size,
      passes: this.passes.length,
      barriers: this.barrierCount,
      queueTransfers: this.queueTransfers,
      layoutTransitions: this.layoutTransitions,
      memoryHazards: this.memoryHazards,
      generation: this.generation,
    });
  }

  clear(): void {
    this.resources.clear();
    this.passes.length = 0;
    this.generation++;
  }

  dispose(): void {
    this.clear();
    this.watchers.clear();
  }

  private register(
    rid: GodotRenderBarrierRid,
    kindValue: GodotRenderResourceKind,
    byteSize: number,
    mipLevels: number,
    layers: number,
    initialValue: Omit<GodotRenderResourceState, 'frame' | 'pass'>,
  ): void {
    if (this.resources.has(rid)) throw new Error(`godot-compat: barrier resource ${ridKey(rid)} already exists.`);
    const initial = state(initialValue);
    const resource: ResourceEntry = {
      rid,
      kind: resourceKind(kindValue),
      byteSize,
      mipLevels,
      layers,
      segments: [],
      initial,
      revision: ++this.generation,
    };
    resource.segments.push({ range: this.fullRange(resource), state: initial });
    this.resources.set(rid, resource);
  }

  private normalizeUsage(value: GodotRenderResourceUsage, passQueue: GodotRenderQueue): GodotRenderResourceUsage {
    const kind = resourceKind(value.kind);
    const usageQueue = queue(value.queue);
    if (usageQueue !== passQueue) throw new Error('godot-compat: resource usage queue must match its pass queue.');
    const access = integer(value.access, 'render resource access', 0, 0xffff_ffff);
    if (access === 0 && !value.discard) throw new Error('godot-compat: resource usage requires access or discard.');
    return Object.freeze({
      resource: value.resource,
      kind,
      queue: usageQueue,
      stages: integer(value.stages, 'render resource stages', 0, 0xffff_ffff),
      access,
      ...(value.layout === undefined ? {} : { layout: layout(value.layout) }),
      ...(value.subrange === undefined ? {} : { subrange: Object.freeze({ ...value.subrange }) }),
      discard: value.discard ?? false,
    });
  }

  private defaultLayout(usage: GodotRenderResourceUsage): GodotRenderResourceLayout {
    if (usage.kind === 'buffer') return 'general';
    if ((usage.access & GODOT_RENDER_ACCESS.COLOR_WRITE) !== 0) return 'color-attachment';
    if ((usage.access & GODOT_RENDER_ACCESS.DEPTH_STENCIL_WRITE) !== 0) return 'depth-stencil-attachment';
    if ((usage.access & GODOT_RENDER_ACCESS.DEPTH_STENCIL_READ) !== 0) return 'depth-stencil-read-only';
    if ((usage.access & GODOT_RENDER_ACCESS.TRANSFER_READ) !== 0) return 'transfer-source';
    if ((usage.access & GODOT_RENDER_ACCESS.TRANSFER_WRITE) !== 0) return 'transfer-destination';
    return writes(usage.access) ? 'general' : 'shader-read-only';
  }

  private fullRange(resource: ResourceEntry): Required<GodotRenderResourceSubrange> {
    return resource.kind === 'buffer'
      ? { offset: 0, size: resource.byteSize, baseMip: 0, mipCount: 1, baseLayer: 0, layerCount: 1 }
      : { offset: 0, size: 0, baseMip: 0, mipCount: resource.mipLevels, baseLayer: 0, layerCount: resource.layers };
  }

  private normalizeRange(resource: ResourceEntry, value?: GodotRenderResourceSubrange): Required<GodotRenderResourceSubrange> {
    if (resource.kind === 'buffer') {
      const offset = integer(value?.offset ?? 0, 'barrier buffer offset', 0, resource.byteSize);
      const size = integer(value?.size ?? resource.byteSize - offset, 'barrier buffer size', 0, resource.byteSize - offset);
      return { offset, size, baseMip: 0, mipCount: 1, baseLayer: 0, layerCount: 1 };
    }
    const baseMip = integer(value?.baseMip ?? 0, 'barrier base mip', 0, resource.mipLevels - 1);
    const mipCount = integer(value?.mipCount ?? resource.mipLevels - baseMip, 'barrier mip count', 1, resource.mipLevels - baseMip);
    const baseLayer = integer(value?.baseLayer ?? 0, 'barrier base layer', 0, resource.layers - 1);
    const layerCount = integer(value?.layerCount ?? resource.layers - baseLayer, 'barrier layer count', 1, resource.layers - baseLayer);
    return { offset: 0, size: 0, baseMip, mipCount, baseLayer, layerCount };
  }

  private overlaps(
    kind: GodotRenderResourceKind,
    left: Required<GodotRenderResourceSubrange>,
    right: Required<GodotRenderResourceSubrange>,
  ): boolean {
    if (kind === 'buffer') return left.offset < right.offset + right.size && right.offset < left.offset + left.size;
    const mip = left.baseMip < right.baseMip + right.mipCount && right.baseMip < left.baseMip + left.mipCount;
    const layer = left.baseLayer < right.baseLayer + right.layerCount && right.baseLayer < left.baseLayer + left.layerCount;
    return mip && layer;
  }

  private replaceSegments(
    resource: ResourceEntry,
    range: Required<GodotRenderResourceSubrange>,
    next: GodotRenderResourceState,
  ): void {
    if (resource.kind === 'buffer') {
      const segments: ResourceSegment[] = [];
      for (const segment of resource.segments) {
        if (!this.overlaps(resource.kind, segment.range, range)) {
          segments.push(segment);
          continue;
        }
        if (segment.range.offset < range.offset) {
          segments.push({
            range: { ...segment.range, size: range.offset - segment.range.offset },
            state: segment.state,
          });
        }
        const segmentEnd = segment.range.offset + segment.range.size;
        const rangeEnd = range.offset + range.size;
        if (segmentEnd > rangeEnd) {
          segments.push({
            range: { ...segment.range, offset: rangeEnd, size: segmentEnd - rangeEnd },
            state: segment.state,
          });
        }
      }
      segments.push({ range: { ...range }, state: next });
      resource.segments = this.mergeSegments(segments.sort((left, right) => left.range.offset - right.range.offset));
      return;
    }
    const segments = resource.segments.filter((segment) => !this.overlaps(resource.kind, segment.range, range));
    segments.push({ range: { ...range }, state: next });
    resource.segments = segments;
  }

  private mergeSegments(segments: ResourceSegment[]): ResourceSegment[] {
    const merged: ResourceSegment[] = [];
    for (const segment of segments) {
      const previous = merged.at(-1);
      if (previous !== undefined
        && previous.range.offset + previous.range.size === segment.range.offset
        && previous.state.queue === segment.state.queue
        && previous.state.stages === segment.state.stages
        && previous.state.access === segment.state.access
        && previous.state.layout === segment.state.layout) {
        previous.range = {
          ...previous.range,
          size: previous.range.size + segment.range.size,
        };
      } else merged.push(segment);
    }
    return merged;
  }

  private require(rid: GodotRenderBarrierRid): ResourceEntry {
    const value = this.resources.get(rid);
    if (value === undefined) throw new Error(`godot-compat: unknown barrier resource ${ridKey(rid)}.`);
    return value;
  }
}

export function createGodotRenderResourceBarrierRuntime(
  backend?: GodotRenderBarrierBackend,
): GodotRenderResourceBarrierRuntime {
  return new GodotRenderResourceBarrierRuntime(backend);
}
