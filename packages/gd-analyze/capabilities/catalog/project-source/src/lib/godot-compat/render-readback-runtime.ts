export type GodotRenderReadbackRid = string | number;

export type GodotRenderReadbackFormat =
  | 'r8'
  | 'rg8'
  | 'rgba8'
  | 'r16f'
  | 'rg16f'
  | 'rgba16f'
  | 'r32f'
  | 'rg32f'
  | 'rgba32f'
  | 'r32u'
  | 'depth32f';

export interface GodotRenderReadbackRegion {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  readonly width: number;
  readonly height: number;
  readonly depth?: number;
  readonly mipLevel?: number;
  readonly layer?: number;
}

export interface GodotRenderReadbackRequest {
  readonly source: GodotRenderReadbackRid;
  readonly format: GodotRenderReadbackFormat;
  readonly region: GodotRenderReadbackRegion;
  readonly rowAlignment?: number;
  readonly tag?: string;
}

export interface GodotRenderReadbackTicket {
  readonly id: number;
  readonly frame: number;
  readonly source: GodotRenderReadbackRid;
  readonly format: GodotRenderReadbackFormat;
  readonly region: Readonly<Required<GodotRenderReadbackRegion>>;
  readonly byteLength: number;
  readonly bytesPerRow: number;
  readonly paddedBytesPerRow: number;
  readonly tag: string;
}

export interface GodotRenderReadbackResult {
  readonly ticket: GodotRenderReadbackTicket;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly components: number;
  readonly elapsedFrames: number;
}

export interface GodotRenderReadbackSnapshot {
  readonly frame: number;
  readonly pending: number;
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly stagingSlots: number;
  readonly stagingBytes: number;
  readonly inFlightBytes: number;
  readonly generation: number;
}

export interface GodotRenderReadbackBackend<TSlot = unknown, TFence = unknown> {
  createStaging(byteLength: number): TSlot;
  copyToStaging(slot: TSlot, request: GodotRenderReadbackRequest, ticket: GodotRenderReadbackTicket): TFence;
  isComplete(fence: TFence): boolean;
  map(slot: TSlot, byteLength: number): Uint8Array | ArrayBuffer | ArrayBufferView;
  destroyFence?(fence: TFence): void;
  destroyStaging(slot: TSlot): void;
}

interface StagingSlot<TSlot> {
  handle: TSlot;
  capacity: number;
  busy: boolean;
  lastUsedFrame: number;
}

interface PendingRequest<TSlot, TFence> {
  ticket: GodotRenderReadbackTicket;
  request: GodotRenderReadbackRequest;
  slot: StagingSlot<TSlot> | null;
  fence: TFence | null;
  state: 'pending' | 'submitted' | 'completed' | 'cancelled' | 'failed';
  resolve: (result: GodotRenderReadbackResult) => void;
  reject: (reason: unknown) => void;
  promise: Promise<GodotRenderReadbackResult>;
}

interface FormatInfo {
  components: number;
  bytesPerComponent: number;
  float: boolean;
  unsigned: boolean;
}

const FORMATS: Record<GodotRenderReadbackFormat, FormatInfo> = {
  r8: { components: 1, bytesPerComponent: 1, float: false, unsigned: true },
  rg8: { components: 2, bytesPerComponent: 1, float: false, unsigned: true },
  rgba8: { components: 4, bytesPerComponent: 1, float: false, unsigned: true },
  r16f: { components: 1, bytesPerComponent: 2, float: true, unsigned: false },
  rg16f: { components: 2, bytesPerComponent: 2, float: true, unsigned: false },
  rgba16f: { components: 4, bytesPerComponent: 2, float: true, unsigned: false },
  r32f: { components: 1, bytesPerComponent: 4, float: true, unsigned: false },
  rg32f: { components: 2, bytesPerComponent: 4, float: true, unsigned: false },
  rgba32f: { components: 4, bytesPerComponent: 4, float: true, unsigned: false },
  r32u: { components: 1, bytesPerComponent: 4, float: false, unsigned: true },
  depth32f: { components: 1, bytesPerComponent: 4, float: true, unsigned: false },
};

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return result;
}

function alignment(value: unknown): number {
  const result = integer(value, 'readback row alignment', 1, 65536);
  if ((result & (result - 1)) !== 0) throw new RangeError('godot-compat: readback row alignment requires a power of two.');
  return result;
}

function align(value: number, boundary: number): number {
  return Math.ceil(value / boundary) * boundary;
}

function bytes(value: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function normalizeRegion(value: GodotRenderReadbackRegion): Readonly<Required<GodotRenderReadbackRegion>> {
  return Object.freeze({
    x: integer(value.x, 'readback region x', 0),
    y: integer(value.y, 'readback region y', 0),
    z: integer(value.z ?? 0, 'readback region z', 0),
    width: integer(value.width, 'readback region width', 1),
    height: integer(value.height, 'readback region height', 1),
    depth: integer(value.depth ?? 1, 'readback region depth', 1),
    mipLevel: integer(value.mipLevel ?? 0, 'readback mip level', 0),
    layer: integer(value.layer ?? 0, 'readback layer', 0),
  });
}

function halfToFloat(value: number): number {
  const sign = (value & 0x8000) << 16;
  let exponent = (value >>> 10) & 0x1f;
  let mantissa = value & 0x3ff;
  let bits: number;
  if (exponent === 0) {
    if (mantissa === 0) bits = sign;
    else {
      exponent = 1;
      while ((mantissa & 0x400) === 0) {
        mantissa <<= 1;
        exponent--;
      }
      mantissa &= 0x3ff;
      bits = sign | ((exponent + 112) << 23) | (mantissa << 13);
    }
  } else if (exponent === 31) bits = sign | 0x7f800000 | (mantissa << 13);
  else bits = sign | ((exponent + 112) << 23) | (mantissa << 13);
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, bits, true);
  return new DataView(buffer).getFloat32(0, true);
}

export class GodotRenderReadbackRuntime<TSlot = unknown, TFence = unknown> {
  private readonly staging: StagingSlot<TSlot>[] = [];
  private readonly requests = new Map<number, PendingRequest<TSlot, TFence>>();
  private readonly queue: PendingRequest<TSlot, TFence>[] = [];
  private readonly inFlight: PendingRequest<TSlot, TFence>[] = [];
  private readonly watchers = new Set<(snapshot: GodotRenderReadbackSnapshot) => void>();
  private frame = 0;
  private nextId = 1;
  private maxInFlight: number;
  private minimumStagingSize: number;
  private generation = 1;
  private submitted = 0;
  private completed = 0;
  private cancelled = 0;
  private failed = 0;

  constructor(
    private backend: GodotRenderReadbackBackend<TSlot, TFence>,
    maxInFlight = 4,
    minimumStagingSize = 64 * 1024,
  ) {
    this.maxInFlight = integer(maxInFlight, 'readback max in flight', 1, 256);
    this.minimumStagingSize = integer(minimumStagingSize, 'readback minimum staging size', 1);
  }

  request(value: GodotRenderReadbackRequest): GodotRenderReadbackTicket {
    if (!(value.format in FORMATS)) throw new TypeError(`godot-compat: unknown readback format ${String(value.format)}.`);
    const region = normalizeRegion(value.region);
    const info = FORMATS[value.format];
    const rowBytes = region.width * info.components * info.bytesPerComponent;
    const paddedBytesPerRow = align(rowBytes, alignment(value.rowAlignment ?? 256));
    const byteLength = paddedBytesPerRow * region.height * region.depth;
    const ticket: GodotRenderReadbackTicket = Object.freeze({
      id: this.nextId++,
      frame: this.frame,
      source: value.source,
      format: value.format,
      region,
      byteLength,
      bytesPerRow: rowBytes,
      paddedBytesPerRow,
      tag: value.tag ?? '',
    });
    let resolve!: (result: GodotRenderReadbackResult) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<GodotRenderReadbackResult>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const pending: PendingRequest<TSlot, TFence> = {
      ticket,
      request: Object.freeze({ ...value, region }),
      slot: null,
      fence: null,
      state: 'pending',
      resolve,
      reject,
      promise,
    };
    this.requests.set(ticket.id, pending);
    this.queue.push(pending);
    this.submitAvailable();
    this.publish();
    return ticket;
  }

  wait(ticket: GodotRenderReadbackTicket): Promise<GodotRenderReadbackResult> {
    return this.require(ticket).promise;
  }

  cancel(ticket: GodotRenderReadbackTicket, reason = 'readback cancelled'): boolean {
    const request = this.requests.get(ticket.id);
    if (request === undefined || request.ticket !== ticket) return false;
    if (request.state === 'completed' || request.state === 'cancelled' || request.state === 'failed') return false;
    request.state = 'cancelled';
    const queued = this.queue.indexOf(request);
    if (queued >= 0) this.queue.splice(queued, 1);
    const submitted = this.inFlight.indexOf(request);
    if (submitted >= 0) this.inFlight.splice(submitted, 1);
    this.releaseRequestSlot(request);
    request.reject(new Error(`godot-compat: ${reason}`));
    this.requests.delete(ticket.id);
    this.cancelled++;
    this.generation++;
    this.submitAvailable();
    this.publish();
    return true;
  }

  beginFrame(frameValue: number): readonly GodotRenderReadbackResult[] {
    const nextFrame = integer(frameValue, 'readback frame', 0);
    if (nextFrame < this.frame) throw new RangeError('godot-compat: readback frame cannot move backwards.');
    this.frame = nextFrame;
    const results = this.poll();
    this.submitAvailable();
    this.publish();
    return results;
  }

  poll(): readonly GodotRenderReadbackResult[] {
    const results: GodotRenderReadbackResult[] = [];
    for (let index = 0; index < this.inFlight.length;) {
      const request = this.inFlight[index]!;
      if (request.fence === null || !this.backend.isComplete(request.fence)) {
        index++;
        continue;
      }
      this.inFlight.splice(index, 1);
      try {
        results.push(this.complete(request));
      } catch (error) {
        this.fail(request, error);
      }
    }
    this.submitAvailable();
    if (results.length > 0) this.publish();
    return Object.freeze(results);
  }

  flushCompleted(): readonly Promise<GodotRenderReadbackResult>[] {
    this.poll();
    return Object.freeze([...this.requests.values()].map((request) => request.promise));
  }

  getTicketState(ticket: GodotRenderReadbackTicket): 'pending' | 'submitted' | 'completed' | 'cancelled' | 'failed' {
    return this.require(ticket).state;
  }

  decodeFloats(result: GodotRenderReadbackResult): Float32Array {
    const info = FORMATS[result.ticket.format];
    if (!info.float) throw new TypeError('godot-compat: readback format does not contain floating-point values.');
    const values = new Float32Array(result.width * result.height * result.depth * result.components);
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    const bytesPerPixel = info.components * info.bytesPerComponent;
    let output = 0;
    for (let z = 0; z < result.depth; z++) {
      for (let y = 0; y < result.height; y++) {
        const row = (z * result.height + y) * result.ticket.bytesPerRow;
        for (let x = 0; x < result.width; x++) {
          const pixel = row + x * bytesPerPixel;
          for (let component = 0; component < info.components; component++) {
            const offset = pixel + component * info.bytesPerComponent;
            values[output++] = info.bytesPerComponent === 2
              ? halfToFloat(view.getUint16(offset, true))
              : view.getFloat32(offset, true);
          }
        }
      }
    }
    return values;
  }

  decodeUint32(result: GodotRenderReadbackResult): Uint32Array {
    if (result.ticket.format !== 'r32u') throw new TypeError('godot-compat: readback format is not r32u.');
    const values = new Uint32Array(result.width * result.height * result.depth);
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    let output = 0;
    for (let z = 0; z < result.depth; z++) {
      for (let y = 0; y < result.height; y++) {
        const row = (z * result.height + y) * result.ticket.bytesPerRow;
        for (let x = 0; x < result.width; x++) values[output++] = view.getUint32(row + x * 4, true);
      }
    }
    return values;
  }

  getSnapshot(): GodotRenderReadbackSnapshot {
    return Object.freeze({
      frame: this.frame,
      pending: this.queue.length,
      submitted: this.submitted,
      completed: this.completed,
      cancelled: this.cancelled,
      failed: this.failed,
      stagingSlots: this.staging.length,
      stagingBytes: this.staging.reduce((sum, slot) => sum + slot.capacity, 0),
      inFlightBytes: this.inFlight.reduce((sum, request) => sum + request.ticket.byteLength, 0),
      generation: this.generation,
    });
  }

  watch(listener: (snapshot: GodotRenderReadbackSnapshot) => void): () => void {
    this.watchers.add(listener);
    listener(this.getSnapshot());
    return () => this.watchers.delete(listener);
  }

  setMaxInFlight(value: number): void {
    this.maxInFlight = integer(value, 'readback max in flight', 1, 256);
    this.submitAvailable();
  }

  trimStaging(maxIdleFrames = 30): number {
    const idleFrames = integer(maxIdleFrames, 'readback idle frames', 0);
    let removed = 0;
    for (let index = this.staging.length - 1; index >= 0; index--) {
      const slot = this.staging[index]!;
      if (slot.busy || this.frame - slot.lastUsedFrame < idleFrames) continue;
      this.backend.destroyStaging(slot.handle);
      this.staging.splice(index, 1);
      removed++;
    }
    if (removed > 0) {
      this.generation++;
      this.publish();
    }
    return removed;
  }

  replaceBackend(backend: GodotRenderReadbackBackend<TSlot, TFence>): void {
    for (const request of [...this.requests.values()]) this.cancel(request.ticket, 'readback backend replaced');
    for (const slot of this.staging) this.backend.destroyStaging(slot.handle);
    this.staging.length = 0;
    this.backend = backend;
    this.generation++;
    this.publish();
  }

  dispose(): void {
    for (const request of [...this.requests.values()]) this.cancel(request.ticket, 'readback runtime disposed');
    for (const slot of this.staging) this.backend.destroyStaging(slot.handle);
    this.staging.length = 0;
    this.queue.length = 0;
    this.inFlight.length = 0;
    this.watchers.clear();
    this.generation++;
  }

  private submitAvailable(): void {
    while (this.inFlight.length < this.maxInFlight && this.queue.length > 0) {
      const request = this.queue.shift()!;
      if (request.state !== 'pending') continue;
      let slot: StagingSlot<TSlot> | null = null;
      try {
        slot = this.acquireSlot(request.ticket.byteLength);
        request.slot = slot;
        request.fence = this.backend.copyToStaging(slot.handle, request.request, request.ticket);
        request.state = 'submitted';
        this.inFlight.push(request);
        this.submitted++;
      } catch (error) {
        if (slot !== null) slot.busy = false;
        this.fail(request, error);
      }
    }
  }

  private complete(request: PendingRequest<TSlot, TFence>): GodotRenderReadbackResult {
    if (request.slot === null) throw new Error('godot-compat: submitted readback has no staging slot.');
    const mapped = bytes(this.backend.map(request.slot.handle, request.ticket.byteLength));
    if (mapped.byteLength < request.ticket.byteLength) {
      throw new RangeError('godot-compat: readback backend returned too few bytes.');
    }
    const bytesPerRow = request.ticket.bytesPerRow;
    const paddedBytesPerRow = request.ticket.paddedBytesPerRow;
    const region = request.ticket.region;
    const packed = new Uint8Array(bytesPerRow * region.height * region.depth);
    for (let z = 0; z < region.depth; z++) {
      for (let y = 0; y < region.height; y++) {
        const sourceOffset = (z * region.height + y) * paddedBytesPerRow;
        const destinationOffset = (z * region.height + y) * bytesPerRow;
        packed.set(mapped.subarray(sourceOffset, sourceOffset + bytesPerRow), destinationOffset);
      }
    }
    const info = FORMATS[request.ticket.format];
    const result: GodotRenderReadbackResult = Object.freeze({
      ticket: request.ticket,
      bytes: packed,
      width: region.width,
      height: region.height,
      depth: region.depth,
      components: info.components,
      elapsedFrames: this.frame - request.ticket.frame,
    });
    request.state = 'completed';
    request.resolve(result);
    this.completed++;
    this.requests.delete(request.ticket.id);
    this.releaseRequestSlot(request);
    this.generation++;
    return result;
  }

  private fail(request: PendingRequest<TSlot, TFence>, error: unknown): void {
    request.state = 'failed';
    request.reject(error);
    this.failed++;
    this.requests.delete(request.ticket.id);
    this.releaseRequestSlot(request);
    this.generation++;
  }

  private acquireSlot(byteLength: number): StagingSlot<TSlot> {
    let slot = this.staging
      .filter((candidate) => !candidate.busy && candidate.capacity >= byteLength)
      .sort((left, right) => left.capacity - right.capacity)[0];
    if (slot === undefined) {
      const capacity = Math.max(this.minimumStagingSize, 2 ** Math.ceil(Math.log2(byteLength)));
      slot = {
        handle: this.backend.createStaging(capacity),
        capacity,
        busy: false,
        lastUsedFrame: this.frame,
      };
      this.staging.push(slot);
      this.generation++;
    }
    slot.busy = true;
    slot.lastUsedFrame = this.frame;
    return slot;
  }

  private releaseRequestSlot(request: PendingRequest<TSlot, TFence>): void {
    if (request.fence !== null) this.backend.destroyFence?.(request.fence);
    request.fence = null;
    if (request.slot !== null) {
      request.slot.busy = false;
      request.slot.lastUsedFrame = this.frame;
      request.slot = null;
    }
  }

  private require(ticket: GodotRenderReadbackTicket): PendingRequest<TSlot, TFence> {
    const request = this.requests.get(ticket.id);
    if (request === undefined || request.ticket !== ticket) {
      throw new Error('godot-compat: readback ticket is stale or unknown.');
    }
    return request;
  }

  private publish(): void {
    if (this.watchers.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function createGodotRenderReadbackRuntime<TSlot = unknown, TFence = unknown>(
  backend: GodotRenderReadbackBackend<TSlot, TFence>,
  maxInFlight?: number,
  minimumStagingSize?: number,
): GodotRenderReadbackRuntime<TSlot, TFence> {
  return new GodotRenderReadbackRuntime(backend, maxInFlight, minimumStagingSize);
}
