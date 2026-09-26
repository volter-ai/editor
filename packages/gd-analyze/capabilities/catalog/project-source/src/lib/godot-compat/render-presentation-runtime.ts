export type GodotPresentationRid = string | number;
export type GodotPresentationMode = 'immediate' | 'fifo' | 'mailbox' | 'adaptive';

export interface GodotPresentationDamageRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GodotPresentationSurfaceDescriptor {
  readonly rid: GodotPresentationRid;
  readonly width: number;
  readonly height: number;
  readonly imageCount?: number;
  readonly format: string;
  readonly colorSpace: string;
  readonly mode?: GodotPresentationMode;
  readonly refreshRate?: number;
  readonly enabled?: boolean;
}

export interface GodotPresentationImage<TImage = unknown> {
  readonly surface: GodotPresentationRid;
  readonly image: TImage;
  readonly index: number;
  readonly acquireId: number;
  readonly surfaceGeneration: number;
  readonly frame: number;
}

export interface GodotPresentationSubmission<TImage = unknown> {
  readonly surface: GodotPresentationRid;
  readonly acquired: GodotPresentationImage<TImage>;
  readonly damage: readonly GodotPresentationDamageRegion[];
  readonly desiredPresentTime: number;
  readonly frame: number;
  readonly generation: number;
}

export interface GodotPresentationFrame {
  readonly frame: number;
  readonly presented: readonly GodotPresentationRid[];
  readonly deferred: readonly GodotPresentationRid[];
  readonly dropped: readonly GodotPresentationRid[];
  readonly failed: readonly { surface: GodotPresentationRid; error: unknown }[];
  readonly generation: number;
}

export interface GodotPresentationSnapshot {
  readonly frame: number;
  readonly surfaces: number;
  readonly acquiredImages: number;
  readonly pendingPresentations: number;
  readonly presentedFrames: number;
  readonly deferredFrames: number;
  readonly droppedFrames: number;
  readonly resizes: number;
  readonly retiredSurfaces: number;
  readonly generation: number;
}

export interface GodotPresentationBackend<TSurface = unknown, TImage = unknown> {
  createSurface(descriptor: GodotPresentationSurfaceDescriptor): TSurface;
  getImage(surface: TSurface, index: number): TImage;
  present(surface: TSurface, submission: GodotPresentationSubmission<TImage>): void | Promise<void>;
  destroySurface(surface: TSurface): void;
}

interface ImageState<TImage> {
  image: TImage;
  index: number;
  acquired: boolean;
  acquireId: number;
  lastPresentedFrame: number;
}

interface SurfaceState<TSurface, TImage> {
  descriptor: Required<GodotPresentationSurfaceDescriptor>;
  handle: TSurface;
  images: ImageState<TImage>[];
  pending: GodotPresentationSubmission<TImage> | null;
  nextImage: number;
  lastPresentTime: number;
  generation: number;
}

interface RetiredSurface<TSurface> {
  handle: TSurface;
  retireFrame: number;
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

function mode(value: unknown): GodotPresentationMode {
  if (value !== 'immediate' && value !== 'fifo' && value !== 'mailbox' && value !== 'adaptive') {
    throw new TypeError(`godot-compat: unknown presentation mode ${String(value)}.`);
  }
  return value;
}

function descriptor(value: GodotPresentationSurfaceDescriptor): Required<GodotPresentationSurfaceDescriptor> {
  if (typeof value.format !== 'string' || value.format.length === 0
    || typeof value.colorSpace !== 'string' || value.colorSpace.length === 0) {
    throw new TypeError('godot-compat: presentation surface requires format and color space.');
  }
  return Object.freeze({
    rid: value.rid,
    width: integer(value.width, 'presentation width', 1, 32768),
    height: integer(value.height, 'presentation height', 1, 32768),
    imageCount: integer(value.imageCount ?? 3, 'presentation image count', 2, 8),
    format: value.format,
    colorSpace: value.colorSpace,
    mode: mode(value.mode ?? 'fifo'),
    refreshRate: finite(value.refreshRate ?? 60, 'presentation refresh rate', Number.EPSILON, 1000),
    enabled: value.enabled ?? true,
  });
}

function damage(value: GodotPresentationDamageRegion, width: number, height: number): GodotPresentationDamageRegion {
  const x = integer(value.x, 'presentation damage x', 0, width);
  const y = integer(value.y, 'presentation damage y', 0, height);
  const regionWidth = integer(value.width, 'presentation damage width', 0, width - x);
  const regionHeight = integer(value.height, 'presentation damage height', 0, height - y);
  return Object.freeze({ x, y, width: regionWidth, height: regionHeight });
}

export class GodotRenderPresentationRuntime<TSurface = unknown, TImage = unknown> {
  private readonly surfaces = new Map<GodotPresentationRid, SurfaceState<TSurface, TImage>>();
  private readonly retired: RetiredSurface<TSurface>[] = [];
  private readonly watchers = new Set<(frame: GodotPresentationFrame) => void>();
  private frame = 0;
  private nextAcquireId = 1;
  private generation = 1;
  private retirementDelay: number;
  private presentedFrames = 0;
  private deferredFrames = 0;
  private droppedFrames = 0;
  private resizes = 0;
  private retiredSurfaces = 0;
  private presenting = false;
  private lastFrame: GodotPresentationFrame | null = null;

  constructor(private backend: GodotPresentationBackend<TSurface, TImage>, retirementDelay = 3) {
    this.retirementDelay = integer(retirementDelay, 'presentation retirement delay', 0, 32);
  }

  addSurface(value: GodotPresentationSurfaceDescriptor): void {
    if (this.surfaces.has(value.rid)) throw new Error('godot-compat: presentation surface already exists.');
    const normalized = descriptor(value);
    this.surfaces.set(value.rid, this.createSurface(normalized));
  }

  updateSurface(
    rid: GodotPresentationRid,
    patch: Partial<Omit<GodotPresentationSurfaceDescriptor, 'rid'>>,
  ): void {
    const state = this.require(rid);
    const next = descriptor({ ...state.descriptor, ...patch, rid });
    const recreate = next.width !== state.descriptor.width
      || next.height !== state.descriptor.height
      || next.imageCount !== state.descriptor.imageCount
      || next.format !== state.descriptor.format
      || next.colorSpace !== state.descriptor.colorSpace;
    if (!recreate) {
      state.descriptor = next;
      state.generation = ++this.generation;
      return;
    }
    if (state.images.some((image) => image.acquired)) {
      throw new Error('godot-compat: cannot resize presentation surface with acquired images.');
    }
    this.retire(state.handle);
    const replacement = this.createSurface(next);
    this.surfaces.set(rid, replacement);
    this.resizes++;
    this.generation++;
  }

  removeSurface(rid: GodotPresentationRid, force = false): boolean {
    const state = this.surfaces.get(rid);
    if (state === undefined) return false;
    if (!force && state.images.some((image) => image.acquired)) {
      throw new Error('godot-compat: presentation surface still has acquired images.');
    }
    this.retire(state.handle);
    this.surfaces.delete(rid);
    this.generation++;
    return true;
  }

  acquire(rid: GodotPresentationRid): GodotPresentationImage<TImage> | null {
    const state = this.require(rid);
    if (!state.descriptor.enabled) return null;
    for (let offset = 0; offset < state.images.length; offset++) {
      const index = (state.nextImage + offset) % state.images.length;
      const image = state.images[index]!;
      if (image.acquired) continue;
      image.acquired = true;
      image.acquireId = this.nextAcquireId++;
      state.nextImage = (index + 1) % state.images.length;
      return Object.freeze({
        surface: rid,
        image: image.image,
        index,
        acquireId: image.acquireId,
        surfaceGeneration: state.generation,
        frame: this.frame,
      });
    }
    return null;
  }

  queuePresent(
    acquired: GodotPresentationImage<TImage>,
    damageRegions: readonly GodotPresentationDamageRegion[] = [],
    desiredPresentTime = 0,
  ): GodotPresentationSubmission<TImage> {
    const state = this.require(acquired.surface);
    const image = this.requireAcquired(state, acquired);
    if (state.pending !== null) {
      if (state.descriptor.mode !== 'mailbox' && state.descriptor.mode !== 'immediate') {
        throw new Error('godot-compat: presentation surface already has a queued frame.');
      }
      this.releaseImage(state, state.pending.acquired);
      this.droppedFrames++;
    }
    const regions = damageRegions.length === 0
      ? [Object.freeze({ x: 0, y: 0, width: state.descriptor.width, height: state.descriptor.height })]
      : damageRegions.map((region) => damage(region, state.descriptor.width, state.descriptor.height));
    const submission: GodotPresentationSubmission<TImage> = Object.freeze({
      surface: acquired.surface,
      acquired,
      damage: Object.freeze(regions),
      desiredPresentTime: finite(desiredPresentTime, 'desired presentation time', 0),
      frame: this.frame,
      generation: ++this.generation,
    });
    image.acquired = true;
    state.pending = submission;
    return submission;
  }

  cancelAcquire(acquired: GodotPresentationImage<TImage>): boolean {
    const state = this.surfaces.get(acquired.surface);
    if (state === undefined) return false;
    try {
      this.releaseImage(state, acquired);
      if (state.pending?.acquired === acquired) state.pending = null;
      return true;
    } catch {
      return false;
    }
  }

  async presentFrame(frameValue: number, currentTime: number): Promise<GodotPresentationFrame> {
    const frame = integer(frameValue, 'presentation frame', 0);
    const now = finite(currentTime, 'presentation current time', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: presentation frame cannot move backwards.');
    if (this.presenting) throw new Error('godot-compat: presentation runtime is already presenting.');
    this.frame = frame;
    this.presenting = true;
    const presented: GodotPresentationRid[] = [];
    const deferred: GodotPresentationRid[] = [];
    const dropped: GodotPresentationRid[] = [];
    const failed: Array<{ surface: GodotPresentationRid; error: unknown }> = [];
    try {
      for (const state of this.surfaces.values()) {
        const submission = state.pending;
        if (submission === null) continue;
        if (!state.descriptor.enabled) {
          this.releaseImage(state, submission.acquired);
          state.pending = null;
          dropped.push(state.descriptor.rid);
          this.droppedFrames++;
          continue;
        }
        const interval = 1 / state.descriptor.refreshRate;
        const due = state.descriptor.mode === 'immediate'
          || submission.desiredPresentTime <= now
          && (state.descriptor.mode === 'mailbox' || now - state.lastPresentTime >= interval);
        if (!due && state.descriptor.mode !== 'adaptive') {
          deferred.push(state.descriptor.rid);
          this.deferredFrames++;
          continue;
        }
        if (state.descriptor.mode === 'adaptive' && now - state.lastPresentTime < interval * 0.5) {
          deferred.push(state.descriptor.rid);
          this.deferredFrames++;
          continue;
        }
        try {
          await this.backend.present(state.handle, submission);
          const image = this.requireAcquired(state, submission.acquired);
          image.lastPresentedFrame = frame;
          image.acquired = false;
          state.pending = null;
          state.lastPresentTime = now;
          presented.push(state.descriptor.rid);
          this.presentedFrames++;
        } catch (error) {
          failed.push(Object.freeze({ surface: state.descriptor.rid, error }));
        }
      }
      this.retireDue();
      this.lastFrame = Object.freeze({
        frame,
        presented: Object.freeze(presented),
        deferred: Object.freeze(deferred),
        dropped: Object.freeze(dropped),
        failed: Object.freeze(failed),
        generation: ++this.generation,
      });
      for (const watcher of this.watchers) watcher(this.lastFrame);
      return this.lastFrame;
    } finally {
      this.presenting = false;
    }
  }

  beginFrame(frameValue: number): void {
    const frame = integer(frameValue, 'presentation frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: presentation frame cannot move backwards.');
    this.frame = frame;
    this.retireDue();
  }

  setRetirementDelay(value: number): void {
    this.retirementDelay = integer(value, 'presentation retirement delay', 0, 32);
    this.retireDue();
  }

  getLastFrame(): GodotPresentationFrame | null {
    return this.lastFrame;
  }

  getSnapshot(): GodotPresentationSnapshot {
    return Object.freeze({
      frame: this.frame,
      surfaces: this.surfaces.size,
      acquiredImages: [...this.surfaces.values()].reduce((sum, state) => sum + state.images.filter((image) => image.acquired).length, 0),
      pendingPresentations: [...this.surfaces.values()].filter((state) => state.pending !== null).length,
      presentedFrames: this.presentedFrames,
      deferredFrames: this.deferredFrames,
      droppedFrames: this.droppedFrames,
      resizes: this.resizes,
      retiredSurfaces: this.retiredSurfaces,
      generation: this.generation,
    });
  }

  watch(listener: (frame: GodotPresentationFrame) => void): () => void {
    this.watchers.add(listener);
    if (this.lastFrame !== null) listener(this.lastFrame);
    return () => this.watchers.delete(listener);
  }

  dispose(): void {
    for (const state of this.surfaces.values()) this.backend.destroySurface(state.handle);
    for (const retired of this.retired) this.backend.destroySurface(retired.handle);
    this.surfaces.clear();
    this.retired.length = 0;
    this.watchers.clear();
    this.lastFrame = null;
    this.generation++;
  }

  private createSurface(value: Required<GodotPresentationSurfaceDescriptor>): SurfaceState<TSurface, TImage> {
    const handle = this.backend.createSurface(value);
    const images = Array.from({ length: value.imageCount }, (_, index): ImageState<TImage> => ({
      image: this.backend.getImage(handle, index),
      index,
      acquired: false,
      acquireId: 0,
      lastPresentedFrame: -1,
    }));
    return {
      descriptor: value,
      handle,
      images,
      pending: null,
      nextImage: 0,
      lastPresentTime: -Infinity,
      generation: ++this.generation,
    };
  }

  private requireAcquired(
    state: SurfaceState<TSurface, TImage>,
    acquired: GodotPresentationImage<TImage>,
  ): ImageState<TImage> {
    if (acquired.surfaceGeneration !== state.generation) throw new Error('godot-compat: acquired presentation image belongs to an old surface.');
    const image = state.images[acquired.index];
    if (image === undefined || !image.acquired || image.acquireId !== acquired.acquireId || image.image !== acquired.image) {
      throw new Error('godot-compat: presentation image is stale or not acquired.');
    }
    return image;
  }

  private releaseImage(state: SurfaceState<TSurface, TImage>, acquired: GodotPresentationImage<TImage>): void {
    const image = this.requireAcquired(state, acquired);
    image.acquired = false;
  }

  private retire(handle: TSurface): void {
    if (this.retirementDelay === 0) {
      this.backend.destroySurface(handle);
      this.retiredSurfaces++;
    } else this.retired.push({ handle, retireFrame: this.frame + this.retirementDelay });
  }

  private retireDue(): void {
    for (let index = this.retired.length - 1; index >= 0; index--) {
      const retired = this.retired[index]!;
      if (retired.retireFrame > this.frame) continue;
      this.retired.splice(index, 1);
      this.backend.destroySurface(retired.handle);
      this.retiredSurfaces++;
    }
  }

  private require(rid: GodotPresentationRid): SurfaceState<TSurface, TImage> {
    const value = this.surfaces.get(rid);
    if (value === undefined) throw new Error('godot-compat: unknown presentation surface.');
    return value;
  }
}

export function createGodotRenderPresentationRuntime<TSurface = unknown, TImage = unknown>(
  backend: GodotPresentationBackend<TSurface, TImage>,
  retirementDelay?: number,
): GodotRenderPresentationRuntime<TSurface, TImage> {
  return new GodotRenderPresentationRuntime(backend, retirementDelay);
}
