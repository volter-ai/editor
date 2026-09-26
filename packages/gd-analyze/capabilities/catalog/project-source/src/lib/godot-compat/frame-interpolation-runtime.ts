export type GodotFrameInterpolationRid = string | number;

export interface GodotFrameInterpolationDescriptor {
  readonly view: GodotFrameInterpolationRid;
  readonly width: number;
  readonly height: number;
  readonly color: GodotFrameInterpolationRid;
  readonly depth: GodotFrameInterpolationRid;
  readonly motion: GodotFrameInterpolationRid;
  readonly output: GodotFrameInterpolationRid;
  readonly enabled?: boolean;
  readonly disocclusionThreshold?: number;
  readonly motionScale?: number;
  readonly depthScale?: number;
  readonly maxGeneratedFrames?: number;
}

export interface GodotFrameInterpolationResourceSet<TResource = unknown> {
  readonly previousColor: TResource;
  readonly previousDepth: TResource;
  readonly previousMotion: TResource;
  readonly warpedPrevious: TResource;
  readonly warpedCurrent: TResource;
  readonly confidence: TResource;
}

export interface GodotFrameInterpolationJob<TResource = unknown> {
  readonly view: GodotFrameInterpolationRid;
  readonly frame: number;
  readonly interpolationIndex: number;
  readonly interpolationCount: number;
  readonly factor: number;
  readonly descriptor: Readonly<Required<GodotFrameInterpolationDescriptor>>;
  readonly resources: GodotFrameInterpolationResourceSet<TResource>;
  readonly historyValid: boolean;
  readonly historyGeneration: number;
  readonly generation: number;
}

export interface GodotFrameInterpolationResult<TResource = unknown> {
  readonly view: GodotFrameInterpolationRid;
  readonly frame: number;
  readonly jobs: readonly GodotFrameInterpolationJob<TResource>[];
  readonly historyValid: boolean;
  readonly historyGeneration: number;
  readonly generation: number;
}

export interface GodotFrameInterpolationSnapshot {
  readonly frame: number;
  readonly views: number;
  readonly enabledViews: number;
  readonly validHistories: number;
  readonly generatedFrames: number;
  readonly historyResets: number;
  readonly resources: number;
  readonly generation: number;
}

export interface GodotFrameInterpolationBackend<TResource = unknown> {
  createResource(view: GodotFrameInterpolationRid, name: keyof GodotFrameInterpolationResourceSet, width: number, height: number): TResource;
  execute(job: GodotFrameInterpolationJob<TResource>): void | Promise<void>;
  captureHistory(
    descriptor: GodotFrameInterpolationDescriptor,
    resources: GodotFrameInterpolationResourceSet<TResource>,
  ): void | Promise<void>;
  destroyResource(resource: TResource): void;
}

interface ViewState<TResource> {
  descriptor: Required<GodotFrameInterpolationDescriptor>;
  resources: GodotFrameInterpolationResourceSet<TResource>;
  historyValid: boolean;
  historyGeneration: number;
  lastFrame: number;
  lastCameraRevision: number;
  lastSceneRevision: number;
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

function descriptor(value: GodotFrameInterpolationDescriptor): Required<GodotFrameInterpolationDescriptor> {
  return Object.freeze({
    view: value.view,
    width: integer(value.width, 'frame interpolation width', 1, 32768),
    height: integer(value.height, 'frame interpolation height', 1, 32768),
    color: value.color,
    depth: value.depth,
    motion: value.motion,
    output: value.output,
    enabled: value.enabled ?? true,
    disocclusionThreshold: finite(value.disocclusionThreshold ?? 0.01, 'frame interpolation disocclusion threshold', 0),
    motionScale: finite(value.motionScale ?? 1, 'frame interpolation motion scale', 0),
    depthScale: finite(value.depthScale ?? 1, 'frame interpolation depth scale', 0),
    maxGeneratedFrames: integer(value.maxGeneratedFrames ?? 1, 'maximum generated frames', 0, 8),
  });
}

export class GodotFrameInterpolationRuntime<TResource = unknown> {
  private readonly views = new Map<GodotFrameInterpolationRid, ViewState<TResource>>();
  private readonly watchers = new Set<(result: GodotFrameInterpolationResult<TResource>) => void>();
  private frame = 0;
  private generation = 1;
  private generatedFrames = 0;
  private historyResets = 0;
  private processing = false;

  constructor(private backend: GodotFrameInterpolationBackend<TResource>) {}

  configure(value: GodotFrameInterpolationDescriptor): void {
    const next = descriptor(value);
    const retained = this.views.get(next.view);
    if (retained === undefined) {
      this.views.set(next.view, {
        descriptor: next,
        resources: this.createResources(next),
        historyValid: false,
        historyGeneration: 1,
        lastFrame: -1,
        lastCameraRevision: -1,
        lastSceneRevision: -1,
        revision: ++this.generation,
      });
      return;
    }
    const resize = retained.descriptor.width !== next.width || retained.descriptor.height !== next.height;
    retained.descriptor = next;
    if (resize) {
      this.destroyResources(retained.resources);
      retained.resources = this.createResources(next);
      this.resetState(retained);
    }
    retained.revision = ++this.generation;
  }

  remove(view: GodotFrameInterpolationRid): boolean {
    const state = this.views.get(view);
    if (state === undefined) return false;
    this.destroyResources(state.resources);
    this.views.delete(view);
    this.generation++;
    return true;
  }

  async process(
    view: GodotFrameInterpolationRid,
    frameValue: number,
    generatedFrameCount: number,
    cameraRevision: number,
    sceneRevision: number,
  ): Promise<GodotFrameInterpolationResult<TResource>> {
    const state = this.require(view);
    const frame = integer(frameValue, 'frame interpolation frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: frame interpolation frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: frame interpolation is already processing.');
    this.frame = frame;
    this.processing = true;
    try {
      const count = Math.min(
        integer(generatedFrameCount, 'generated frame count', 0, 8),
        state.descriptor.maxGeneratedFrames,
      );
      const currentCameraRevision = integer(cameraRevision, 'frame interpolation camera revision', 0);
      const currentSceneRevision = integer(sceneRevision, 'frame interpolation scene revision', 0);
      if (state.lastFrame >= 0 && frame !== state.lastFrame + 1) this.resetState(state);
      if (state.lastCameraRevision >= 0 && Math.abs(currentCameraRevision - state.lastCameraRevision) > 1) this.resetState(state);
      if (state.lastSceneRevision > currentSceneRevision) this.resetState(state);
      const historyValid = state.historyValid;
      const jobs: GodotFrameInterpolationJob<TResource>[] = [];
      if (state.descriptor.enabled && historyValid) {
        for (let index = 0; index < count; index++) {
          const job: GodotFrameInterpolationJob<TResource> = Object.freeze({
            view,
            frame,
            interpolationIndex: index,
            interpolationCount: count,
            factor: (index + 1) / (count + 1),
            descriptor: state.descriptor,
            resources: state.resources,
            historyValid,
            historyGeneration: state.historyGeneration,
            generation: state.revision,
          });
          await this.backend.execute(job);
          jobs.push(job);
          this.generatedFrames++;
        }
      }
      await this.backend.captureHistory(state.descriptor, state.resources);
      state.historyValid = true;
      state.lastFrame = frame;
      state.lastCameraRevision = currentCameraRevision;
      state.lastSceneRevision = currentSceneRevision;
      state.revision = ++this.generation;
      const result: GodotFrameInterpolationResult<TResource> = Object.freeze({
        view,
        frame,
        jobs: Object.freeze(jobs),
        historyValid,
        historyGeneration: state.historyGeneration,
        generation: this.generation,
      });
      for (const watcher of this.watchers) watcher(result);
      return result;
    } finally {
      this.processing = false;
    }
  }

  resetHistory(view?: GodotFrameInterpolationRid): void {
    if (view === undefined) for (const state of this.views.values()) this.resetState(state);
    else this.resetState(this.require(view));
    this.generation++;
  }

  getResources(view: GodotFrameInterpolationRid): GodotFrameInterpolationResourceSet<TResource> {
    return this.require(view).resources;
  }

  getSnapshot(): GodotFrameInterpolationSnapshot {
    return Object.freeze({
      frame: this.frame,
      views: this.views.size,
      enabledViews: [...this.views.values()].filter((state) => state.descriptor.enabled).length,
      validHistories: [...this.views.values()].filter((state) => state.historyValid).length,
      generatedFrames: this.generatedFrames,
      historyResets: this.historyResets,
      resources: this.views.size * 6,
      generation: this.generation,
    });
  }

  watch(listener: (result: GodotFrameInterpolationResult<TResource>) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  replaceBackend(backend: GodotFrameInterpolationBackend<TResource>): void {
    const descriptors = [...this.views.values()].map((state) => state.descriptor);
    for (const state of this.views.values()) this.destroyResources(state.resources);
    this.views.clear();
    this.backend = backend;
    for (const value of descriptors) this.configure(value);
    this.generation++;
  }

  dispose(): void {
    for (const state of this.views.values()) this.destroyResources(state.resources);
    this.views.clear();
    this.watchers.clear();
    this.generation++;
  }

  private createResources(value: Required<GodotFrameInterpolationDescriptor>): GodotFrameInterpolationResourceSet<TResource> {
    return Object.freeze({
      previousColor: this.backend.createResource(value.view, 'previousColor', value.width, value.height),
      previousDepth: this.backend.createResource(value.view, 'previousDepth', value.width, value.height),
      previousMotion: this.backend.createResource(value.view, 'previousMotion', value.width, value.height),
      warpedPrevious: this.backend.createResource(value.view, 'warpedPrevious', value.width, value.height),
      warpedCurrent: this.backend.createResource(value.view, 'warpedCurrent', value.width, value.height),
      confidence: this.backend.createResource(value.view, 'confidence', value.width, value.height),
    });
  }

  private destroyResources(resources: GodotFrameInterpolationResourceSet<TResource>): void {
    this.backend.destroyResource(resources.previousColor);
    this.backend.destroyResource(resources.previousDepth);
    this.backend.destroyResource(resources.previousMotion);
    this.backend.destroyResource(resources.warpedPrevious);
    this.backend.destroyResource(resources.warpedCurrent);
    this.backend.destroyResource(resources.confidence);
  }

  private resetState(state: ViewState<TResource>): void {
    state.historyValid = false;
    state.historyGeneration++;
    state.lastFrame = -1;
    state.lastCameraRevision = -1;
    state.lastSceneRevision = -1;
    state.revision = ++this.generation;
    this.historyResets++;
  }

  private require(view: GodotFrameInterpolationRid): ViewState<TResource> {
    const value = this.views.get(view);
    if (value === undefined) throw new Error('godot-compat: frame interpolation view is not configured.');
    return value;
  }
}

export function createGodotFrameInterpolationRuntime<TResource = unknown>(
  backend: GodotFrameInterpolationBackend<TResource>,
): GodotFrameInterpolationRuntime<TResource> {
  return new GodotFrameInterpolationRuntime(backend);
}
