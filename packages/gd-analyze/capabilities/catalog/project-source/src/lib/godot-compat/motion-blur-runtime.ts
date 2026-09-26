import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export type GodotMotionBlurQuality = 'low' | 'medium' | 'high';
export interface GodotMotionBlurDescriptor {
  readonly viewport: GodotRid;
  readonly enabled?: boolean;
  readonly intensity?: number;
  readonly shutterTime?: number;
  readonly maxBlurPixels?: number;
  readonly quality?: GodotMotionBlurQuality;
  readonly cameraMotion?: boolean;
  readonly objectMotion?: boolean;
  readonly depthRejection?: number;
  readonly userData?: unknown;
}
export interface GodotMotionBlurState extends Required<Omit<GodotMotionBlurDescriptor, 'userData'>> {
  readonly color: GodotRid | null;
  readonly depth: GodotRid | null;
  readonly velocity: GodotRid | null;
  readonly destination: GodotRid | null;
  readonly tileMax: GodotRid | null;
  readonly neighborMax: GodotRid | null;
  readonly resetRequested: boolean;
  readonly lastRenderedFrame: number;
  readonly generation: number;
  readonly userData: unknown;
}
export interface GodotMotionBlurBackend {
  allocate(viewport: GodotRid, kind: 'tile-max' | 'neighbor-max'): GodotRid | Promise<GodotRid>;
  free(texture: GodotRid): void;
  tileMax(frame: number, state: GodotMotionBlurState): void | Promise<void>;
  neighborMax(frame: number, state: GodotMotionBlurState): void | Promise<void>;
  reconstruct(frame: number, state: GodotMotionBlurState): void | Promise<void>;
}
export interface GodotMotionBlurFrameResult {
  readonly frame: number;
  readonly rendered: readonly GodotRid[];
  readonly skipped: readonly GodotRid[];
  readonly passes: number;
  readonly reset: readonly GodotRid[];
  readonly failed: readonly { viewport: GodotRid; error: unknown }[];
}
export interface GodotMotionBlurSnapshot {
  readonly frame: number;
  readonly viewports: readonly GodotMotionBlurState[];
  readonly enabled: number;
  readonly allocatedTextures: number;
  readonly renderedFrames: number;
  readonly passes: number;
  readonly generation: number;
  readonly lastFrame: GodotMotionBlurFrameResult | null;
}
interface Entry {
  viewport: GodotRid;
  enabled: boolean;
  intensity: number;
  shutterTime: number;
  maxBlurPixels: number;
  quality: GodotMotionBlurQuality;
  cameraMotion: boolean;
  objectMotion: boolean;
  depthRejection: number;
  color: GodotRid | null;
  depth: GodotRid | null;
  velocity: GodotRid | null;
  destination: GodotRid | null;
  tileMax: GodotRid | null;
  neighborMax: GodotRid | null;
  resetRequested: boolean;
  lastRenderedFrame: number;
  generation: number;
  userData: unknown;
  order: number;
}
function integer(value: unknown, member: string, minimum = 0): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new RangeError(`godot-compat: MotionBlurRuntime.${member} requires integer >= ${minimum}.`);
  return result;
}
function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw new RangeError(`godot-compat: MotionBlurRuntime.${member} requires finite value in [${minimum}, ${maximum}].`);
  return result;
}
function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: MotionBlurRuntime.${member} requires bool.`);
  return value;
}
function rid(value: unknown): GodotRid {
  if (value === null || typeof value !== 'object') throw new TypeError('godot-compat: MotionBlurRuntime requires RID.');
  godotRidGetId(value);
  return value as GodotRid;
}
function quality(value: unknown): GodotMotionBlurQuality {
  if (value !== 'low' && value !== 'medium' && value !== 'high') throw new TypeError('godot-compat: unknown motion blur quality.');
  return value;
}
function state(entry: Entry): GodotMotionBlurState {
  return Object.freeze({ ...entry });
}

export class GodotMotionBlurRuntime {
  public readonly __godotClass = 'MotionBlurRuntime';
  private readonly backend: GodotMotionBlurBackend;
  private readonly entries = new Map<bigint, Entry>();
  private readonly watchers = new Set<(snapshot: GodotMotionBlurSnapshot) => void>();
  private frameValue = 0;
  private nextOrder = 0;
  private generationValue = 0;
  private renderedFrames = 0;
  private passes = 0;
  private processing = false;
  private lastFrame: GodotMotionBlurFrameResult | null = null;

  public constructor(backend: GodotMotionBlurBackend) {
    if (typeof backend?.allocate !== 'function' || typeof backend?.free !== 'function' || typeof backend?.tileMax !== 'function' || typeof backend?.neighborMax !== 'function' || typeof backend?.reconstruct !== 'function') {
      throw new TypeError('godot-compat: MotionBlurRuntime requires allocation and reconstruction backend.');
    }
    this.backend = backend;
    registerGodotObjectIdentity(this, 'MotionBlurRuntime');
  }

  public addViewport(value: GodotMotionBlurDescriptor): void {
    const viewport = rid(value.viewport);
    const id = godotRidGetId(viewport);
    if (this.entries.has(id)) throw new Error('godot-compat: motion blur viewport already exists.');
    this.entries.set(id, {
      viewport,
      enabled: bool(value.enabled ?? true, 'enabled'),
      intensity: finite(value.intensity ?? 1, 'intensity', 0),
      shutterTime: finite(value.shutterTime ?? 1 / 60, 'shutter_time', 0),
      maxBlurPixels: finite(value.maxBlurPixels ?? 32, 'max_blur_pixels', 0),
      quality: quality(value.quality ?? 'medium'),
      cameraMotion: bool(value.cameraMotion ?? true, 'camera_motion'),
      objectMotion: bool(value.objectMotion ?? true, 'object_motion'),
      depthRejection: finite(value.depthRejection ?? 0.01, 'depth_rejection', 0),
      color: null,
      depth: null,
      velocity: null,
      destination: null,
      tileMax: null,
      neighborMax: null,
      resetRequested: true,
      lastRenderedFrame: -1,
      generation: 1,
      userData: value.userData ?? null,
      order: this.nextOrder++,
    });
    this.generationValue += 1;
    this.publish();
  }

  public removeViewport(value: unknown): boolean {
    const viewport = rid(value);
    const entry = this.entries.get(godotRidGetId(viewport));
    if (entry === undefined) return false;
    this.free(entry);
    this.entries.delete(godotRidGetId(viewport));
    this.generationValue += 1;
    this.publish();
    return true;
  }

  private requireEntry(value: unknown): Entry {
    const viewport = rid(value);
    const entry = this.entries.get(godotRidGetId(viewport));
    if (entry === undefined) throw new Error('godot-compat: motion blur viewport does not exist.');
    return entry;
  }

  public setTargets(value: unknown, colorValue: unknown, depthValue: unknown, velocityValue: unknown, destinationValue: unknown): void {
    const entry = this.requireEntry(value);
    entry.color = rid(colorValue);
    entry.depth = rid(depthValue);
    entry.velocity = rid(velocityValue);
    entry.destination = rid(destinationValue);
    entry.resetRequested = true;
    this.publish();
  }

  public updateViewport(value: unknown, patch: Partial<Omit<GodotMotionBlurDescriptor, 'viewport'>>): void {
    const entry = this.requireEntry(value);
    if (patch.enabled !== undefined) entry.enabled = bool(patch.enabled, 'enabled');
    if (patch.intensity !== undefined) entry.intensity = finite(patch.intensity, 'intensity', 0);
    if (patch.shutterTime !== undefined) entry.shutterTime = finite(patch.shutterTime, 'shutter_time', 0);
    if (patch.maxBlurPixels !== undefined) entry.maxBlurPixels = finite(patch.maxBlurPixels, 'max_blur_pixels', 0);
    if (patch.quality !== undefined) entry.quality = quality(patch.quality);
    if (patch.cameraMotion !== undefined) entry.cameraMotion = bool(patch.cameraMotion, 'camera_motion');
    if (patch.objectMotion !== undefined) entry.objectMotion = bool(patch.objectMotion, 'object_motion');
    if (patch.depthRejection !== undefined) entry.depthRejection = finite(patch.depthRejection, 'depth_rejection', 0);
    if (patch.userData !== undefined) entry.userData = patch.userData;
    entry.generation += 1;
    this.publish();
  }

  public requestReset(value: unknown): void {
    const entry = this.requireEntry(value);
    entry.resetRequested = true;
    this.publish();
  }

  private async allocate(entry: Entry): Promise<void> {
    if (entry.tileMax === null) entry.tileMax = rid(await this.backend.allocate(entry.viewport, 'tile-max'));
    if (entry.neighborMax === null) entry.neighborMax = rid(await this.backend.allocate(entry.viewport, 'neighbor-max'));
  }

  private free(entry: Entry): void {
    if (entry.tileMax !== null) this.backend.free(entry.tileMax);
    if (entry.neighborMax !== null) this.backend.free(entry.neighborMax);
    entry.tileMax = null;
    entry.neighborMax = null;
  }

  public async processFrame(frameValue: unknown): Promise<GodotMotionBlurFrameResult> {
    const frame = integer(frameValue, 'frame');
    if (frame < this.frameValue) throw new RangeError('godot-compat: motion blur frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: motion blur frame already processing.');
    this.frameValue = frame;
    this.processing = true;
    const rendered: GodotRid[] = [];
    const skipped: GodotRid[] = [];
    const reset: GodotRid[] = [];
    const failed: Array<{ viewport: GodotRid; error: unknown }> = [];
    let framePasses = 0;
    try {
      for (const entry of [...this.entries.values()].sort((left, right) => left.order - right.order)) {
        if (!entry.enabled || entry.color === null || entry.depth === null || entry.velocity === null || entry.destination === null || (!entry.cameraMotion && !entry.objectMotion)) {
          skipped.push(entry.viewport);
          continue;
        }
        try {
          await this.allocate(entry);
          if (entry.resetRequested) {
            reset.push(entry.viewport);
            entry.resetRequested = false;
          }
          await this.backend.tileMax(frame, state(entry));
          await this.backend.neighborMax(frame, state(entry));
          await this.backend.reconstruct(frame, state(entry));
          framePasses += 3;
          entry.lastRenderedFrame = frame;
          entry.generation += 1;
          rendered.push(entry.viewport);
        } catch (error) {
          failed.push(Object.freeze({ viewport: entry.viewport, error }));
        }
      }
      this.renderedFrames += 1;
      this.passes += framePasses;
      this.lastFrame = Object.freeze({ frame, rendered: Object.freeze(rendered), skipped: Object.freeze(skipped), passes: framePasses, reset: Object.freeze(reset), failed: Object.freeze(failed) });
      this.publish();
      return this.lastFrame;
    } finally {
      this.processing = false;
    }
  }

  public getSnapshot(): GodotMotionBlurSnapshot {
    const viewports = [...this.entries.values()].map(state);
    return Object.freeze({
      frame: this.frameValue,
      viewports: Object.freeze(viewports),
      enabled: viewports.filter((entry) => entry.enabled).length,
      allocatedTextures: viewports.reduce((total, entry) => total + (entry.tileMax === null ? 0 : 1) + (entry.neighborMax === null ? 0 : 1), 0),
      renderedFrames: this.renderedFrames,
      passes: this.passes,
      generation: this.generationValue,
      lastFrame: this.lastFrame,
    });
  }

  public watch(watcher: (snapshot: GodotMotionBlurSnapshot) => void): () => void {
    this.watchers.add(watcher);
    watcher(this.getSnapshot());
    return () => this.watchers.delete(watcher);
  }

  private publish(): void {
    const value = this.getSnapshot();
    for (const watcher of this.watchers) watcher(value);
  }

  public clear(): void {
    if (this.processing) throw new Error('godot-compat: cannot clear motion blur during frame.');
    for (const entry of this.entries.values()) this.free(entry);
    this.entries.clear();
    this.lastFrame = null;
    this.generationValue += 1;
    this.publish();
  }

  public dispose(): void {
    this.clear();
    this.watchers.clear();
  }
}

export function createGodotMotionBlurRuntime(backend: GodotMotionBlurBackend): GodotMotionBlurRuntime {
  return new GodotMotionBlurRuntime(backend);
}
