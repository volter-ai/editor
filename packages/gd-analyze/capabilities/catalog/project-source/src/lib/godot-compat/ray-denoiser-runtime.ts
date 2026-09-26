export type GodotRayDenoiserRid = string | number;
export type GodotRayDenoiserSignal = 'reflections' | 'shadows' | 'diffuse' | 'ambient-occlusion';

export interface GodotRayDenoiserDescriptor {
  readonly signal: GodotRayDenoiserSignal;
  readonly width: number;
  readonly height: number;
  readonly input: GodotRayDenoiserRid;
  readonly output: GodotRayDenoiserRid;
  readonly depth: GodotRayDenoiserRid;
  readonly normal: GodotRayDenoiserRid;
  readonly motion?: GodotRayDenoiserRid | null;
  readonly albedo?: GodotRayDenoiserRid | null;
  readonly roughness?: GodotRayDenoiserRid | null;
  readonly halfResolution?: boolean;
  readonly temporalEnabled?: boolean;
  readonly spatialPasses?: number;
  readonly historyWeight?: number;
  readonly depthRejection?: number;
  readonly normalRejection?: number;
  readonly luminanceRejection?: number;
  readonly varianceClamp?: number;
}

export interface GodotRayDenoiserResources<TResource = unknown> {
  readonly history: TResource;
  readonly moments: TResource;
  readonly variance: TResource;
  readonly ping: TResource;
  readonly pong: TResource;
}

export interface GodotRayDenoiserPass<TResource = unknown> {
  readonly signal: GodotRayDenoiserSignal;
  readonly kind: 'reproject' | 'moments' | 'variance' | 'spatial' | 'resolve';
  readonly iteration: number;
  readonly input: GodotRayDenoiserRid | TResource;
  readonly output: GodotRayDenoiserRid | TResource;
  readonly descriptor: Readonly<Required<GodotRayDenoiserDescriptor>>;
  readonly resources: GodotRayDenoiserResources<TResource>;
  readonly historyValid: boolean;
  readonly frame: number;
  readonly generation: number;
}

export interface GodotRayDenoiserFrame<TResource = unknown> {
  readonly frame: number;
  readonly signal: GodotRayDenoiserSignal;
  readonly passes: readonly GodotRayDenoiserPass<TResource>[];
  readonly historyValid: boolean;
  readonly historyGeneration: number;
  readonly generation: number;
}

export interface GodotRayDenoiserSnapshot {
  readonly frame: number;
  readonly signals: number;
  readonly allocatedResources: number;
  readonly validHistories: number;
  readonly processedFrames: number;
  readonly executedPasses: number;
  readonly historyResets: number;
  readonly generation: number;
}

export interface GodotRayDenoiserBackend<TResource = unknown> {
  createResource(signal: GodotRayDenoiserSignal, name: keyof GodotRayDenoiserResources, width: number, height: number): TResource;
  execute(pass: GodotRayDenoiserPass<TResource>): void | Promise<void>;
  destroyResource(resource: TResource): void;
}

interface SignalState<TResource> {
  descriptor: Required<GodotRayDenoiserDescriptor>;
  resources: GodotRayDenoiserResources<TResource>;
  historyValid: boolean;
  historyGeneration: number;
  previousViewRevision: number;
  previousSceneRevision: number;
  lastFrame: number;
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

function signal(value: unknown): GodotRayDenoiserSignal {
  if (value !== 'reflections' && value !== 'shadows' && value !== 'diffuse' && value !== 'ambient-occlusion') {
    throw new TypeError(`godot-compat: unknown denoiser signal ${String(value)}.`);
  }
  return value;
}

function descriptor(value: GodotRayDenoiserDescriptor): Required<GodotRayDenoiserDescriptor> {
  return Object.freeze({
    signal: signal(value.signal),
    width: integer(value.width, 'denoiser width', 1, 32768),
    height: integer(value.height, 'denoiser height', 1, 32768),
    input: value.input,
    output: value.output,
    depth: value.depth,
    normal: value.normal,
    motion: value.motion ?? null,
    albedo: value.albedo ?? null,
    roughness: value.roughness ?? null,
    halfResolution: value.halfResolution ?? false,
    temporalEnabled: value.temporalEnabled ?? true,
    spatialPasses: integer(value.spatialPasses ?? 4, 'denoiser spatial passes', 0, 16),
    historyWeight: finite(value.historyWeight ?? 0.95, 'denoiser history weight', 0, 1),
    depthRejection: finite(value.depthRejection ?? 0.01, 'denoiser depth rejection', 0),
    normalRejection: finite(value.normalRejection ?? 0.2, 'denoiser normal rejection', 0, 1),
    luminanceRejection: finite(value.luminanceRejection ?? 3, 'denoiser luminance rejection', 0),
    varianceClamp: finite(value.varianceClamp ?? 4, 'denoiser variance clamp', 0),
  });
}

export class GodotRayDenoiserRuntime<TResource = unknown> {
  private readonly signals = new Map<GodotRayDenoiserSignal, SignalState<TResource>>();
  private readonly watchers = new Set<(frame: GodotRayDenoiserFrame<TResource>) => void>();
  private frame = 0;
  private generation = 1;
  private processedFrames = 0;
  private executedPasses = 0;
  private historyResets = 0;
  private processing = false;

  constructor(private backend: GodotRayDenoiserBackend<TResource>) {}

  configure(value: GodotRayDenoiserDescriptor): void {
    const next = descriptor(value);
    const retained = this.signals.get(next.signal);
    if (retained === undefined) {
      this.signals.set(next.signal, {
        descriptor: next,
        resources: this.createResources(next),
        historyValid: false,
        historyGeneration: 1,
        previousViewRevision: -1,
        previousSceneRevision: -1,
        lastFrame: -1,
        revision: ++this.generation,
      });
      return;
    }
    const resize = retained.descriptor.width !== next.width
      || retained.descriptor.height !== next.height
      || retained.descriptor.halfResolution !== next.halfResolution;
    retained.descriptor = next;
    if (resize) {
      this.destroyResources(retained.resources);
      retained.resources = this.createResources(next);
      this.resetState(retained);
    }
    retained.revision = ++this.generation;
  }

  remove(signalValue: GodotRayDenoiserSignal): boolean {
    const key = signal(signalValue);
    const state = this.signals.get(key);
    if (state === undefined) return false;
    this.destroyResources(state.resources);
    this.signals.delete(key);
    this.generation++;
    return true;
  }

  async process(
    signalValue: GodotRayDenoiserSignal,
    frameValue: number,
    viewRevision: number,
    sceneRevision: number,
  ): Promise<GodotRayDenoiserFrame<TResource>> {
    const key = signal(signalValue);
    const state = this.require(key);
    const frame = integer(frameValue, 'denoiser frame', 0);
    if (frame < this.frame) throw new RangeError('godot-compat: denoiser frame cannot move backwards.');
    if (this.processing) throw new Error('godot-compat: denoiser runtime is already processing.');
    this.frame = frame;
    this.processing = true;
    try {
      const currentViewRevision = integer(viewRevision, 'denoiser view revision', 0);
      const currentSceneRevision = integer(sceneRevision, 'denoiser scene revision', 0);
      if (state.lastFrame >= 0 && frame !== state.lastFrame + 1) this.resetState(state);
      if (state.previousViewRevision >= 0 && Math.abs(currentViewRevision - state.previousViewRevision) > 1) this.resetState(state);
      if (state.previousSceneRevision >= 0 && currentSceneRevision < state.previousSceneRevision) this.resetState(state);
      const passes = this.buildPasses(state, frame);
      for (const pass of passes) {
        await this.backend.execute(pass);
        this.executedPasses++;
      }
      const historyValid = state.historyValid;
      state.historyValid = true;
      state.previousViewRevision = currentViewRevision;
      state.previousSceneRevision = currentSceneRevision;
      state.lastFrame = frame;
      state.revision = ++this.generation;
      this.processedFrames++;
      const result: GodotRayDenoiserFrame<TResource> = Object.freeze({
        frame,
        signal: key,
        passes: Object.freeze(passes),
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

  async processAll(
    frameValue: number,
    viewRevision: number,
    sceneRevision: number,
  ): Promise<readonly GodotRayDenoiserFrame<TResource>[]> {
    const results: GodotRayDenoiserFrame<TResource>[] = [];
    for (const key of this.signals.keys()) results.push(await this.process(key, frameValue, viewRevision, sceneRevision));
    return Object.freeze(results);
  }

  resetHistory(signalValue?: GodotRayDenoiserSignal): void {
    if (signalValue === undefined) {
      for (const state of this.signals.values()) this.resetState(state);
    } else this.resetState(this.require(signal(signalValue)));
    this.generation++;
  }

  getResources(signalValue: GodotRayDenoiserSignal): GodotRayDenoiserResources<TResource> {
    return this.require(signal(signalValue)).resources;
  }

  getSnapshot(): GodotRayDenoiserSnapshot {
    return Object.freeze({
      frame: this.frame,
      signals: this.signals.size,
      allocatedResources: this.signals.size * 5,
      validHistories: [...this.signals.values()].filter((state) => state.historyValid).length,
      processedFrames: this.processedFrames,
      executedPasses: this.executedPasses,
      historyResets: this.historyResets,
      generation: this.generation,
    });
  }

  watch(listener: (frame: GodotRayDenoiserFrame<TResource>) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  replaceBackend(backend: GodotRayDenoiserBackend<TResource>): void {
    const descriptors = [...this.signals.values()].map((state) => state.descriptor);
    for (const state of this.signals.values()) this.destroyResources(state.resources);
    this.signals.clear();
    this.backend = backend;
    for (const value of descriptors) this.configure(value);
    this.generation++;
  }

  dispose(): void {
    for (const state of this.signals.values()) this.destroyResources(state.resources);
    this.signals.clear();
    this.watchers.clear();
    this.generation++;
  }

  private buildPasses(state: SignalState<TResource>, frame: number): GodotRayDenoiserPass<TResource>[] {
    const passes: GodotRayDenoiserPass<TResource>[] = [];
    const add = (
      kind: GodotRayDenoiserPass<TResource>['kind'],
      iteration: number,
      input: GodotRayDenoiserRid | TResource,
      output: GodotRayDenoiserRid | TResource,
    ): void => {
      passes.push(Object.freeze({
        signal: state.descriptor.signal,
        kind,
        iteration,
        input,
        output,
        descriptor: state.descriptor,
        resources: state.resources,
        historyValid: state.historyValid,
        frame,
        generation: state.revision,
      }));
    };
    let current: GodotRayDenoiserRid | TResource = state.descriptor.input;
    if (state.descriptor.temporalEnabled) {
      add('reproject', 0, current, state.resources.ping);
      current = state.resources.ping;
    }
    add('moments', 0, current, state.resources.moments);
    add('variance', 0, state.resources.moments, state.resources.variance);
    for (let iteration = 0; iteration < state.descriptor.spatialPasses; iteration++) {
      const output = iteration % 2 === 0 ? state.resources.pong : state.resources.ping;
      add('spatial', iteration, current, output);
      current = output;
    }
    add('resolve', 0, current, state.descriptor.output);
    return passes;
  }

  private createResources(value: Required<GodotRayDenoiserDescriptor>): GodotRayDenoiserResources<TResource> {
    const width = value.halfResolution ? Math.max(1, Math.ceil(value.width / 2)) : value.width;
    const height = value.halfResolution ? Math.max(1, Math.ceil(value.height / 2)) : value.height;
    return Object.freeze({
      history: this.backend.createResource(value.signal, 'history', width, height),
      moments: this.backend.createResource(value.signal, 'moments', width, height),
      variance: this.backend.createResource(value.signal, 'variance', width, height),
      ping: this.backend.createResource(value.signal, 'ping', width, height),
      pong: this.backend.createResource(value.signal, 'pong', width, height),
    });
  }

  private destroyResources(resources: GodotRayDenoiserResources<TResource>): void {
    this.backend.destroyResource(resources.history);
    this.backend.destroyResource(resources.moments);
    this.backend.destroyResource(resources.variance);
    this.backend.destroyResource(resources.ping);
    this.backend.destroyResource(resources.pong);
  }

  private resetState(state: SignalState<TResource>): void {
    state.historyValid = false;
    state.historyGeneration++;
    state.previousViewRevision = -1;
    state.previousSceneRevision = -1;
    state.revision = ++this.generation;
    this.historyResets++;
  }

  private require(key: GodotRayDenoiserSignal): SignalState<TResource> {
    const value = this.signals.get(key);
    if (value === undefined) throw new Error(`godot-compat: denoiser signal ${key} is not configured.`);
    return value;
  }
}

export function createGodotRayDenoiserRuntime<TResource = unknown>(
  backend: GodotRayDenoiserBackend<TResource>,
): GodotRayDenoiserRuntime<TResource> {
  return new GodotRayDenoiserRuntime(backend);
}
