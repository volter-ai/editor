export type TextureMipmapFilter = "nearest" | "linear" | "cubic" | "kaiser" | "min" | "max" | "normal_map";

export type TextureMipmapAlphaMode = "straight" | "premultiplied" | "coverage" | "opaque";

export interface TextureMipmapExtent {
  width: number;
  height: number;
  depth?: number;
}

export interface TextureMipmapRegion {
  x: number;
  y: number;
  z?: number;
  width: number;
  height: number;
  depth?: number;
}

export interface TextureMipmapDescriptor {
  textureId: string;
  format: string;
  extent: TextureMipmapExtent;
  mipCount: number;
  arrayLayers?: number;
  cubeFaces?: number;
  colorSpace?: "linear" | "srgb" | "hdr" | "depth";
  compressed?: boolean;
  filterable?: boolean;
  storageWritable?: boolean;
  renderable?: boolean;
}

export interface TextureMipmapGenerationOptions {
  filter?: TextureMipmapFilter;
  alphaMode?: TextureMipmapAlphaMode;
  alphaCoverageThreshold?: number;
  renormalizeNormals?: boolean;
  gammaCorrect?: boolean;
  firstMip?: number;
  lastMip?: number;
  layers?: readonly number[];
  faces?: readonly number[];
  dirtyRegions?: readonly TextureMipmapRegion[];
  preferCompute?: boolean;
  allowIntermediate?: boolean;
}

export type TextureMipmapExecutionPath = "copy" | "blit" | "render" | "compute" | "intermediate";

export interface TextureMipmapStep {
  index: number;
  sourceMip: number;
  targetMip: number;
  layer: number;
  face: number;
  sourceExtent: Required<TextureMipmapExtent>;
  targetExtent: Required<TextureMipmapExtent>;
  sourceRegion: TextureMipmapRegion;
  targetRegion: TextureMipmapRegion;
  filter: TextureMipmapFilter;
  alphaMode: TextureMipmapAlphaMode;
  gammaCorrect: boolean;
  renormalizeNormals: boolean;
  executionPath: TextureMipmapExecutionPath;
  intermediateFormat?: string;
}

export interface TextureMipmapPlan {
  textureId: string;
  descriptor: TextureMipmapDescriptor;
  options: Required<Omit<TextureMipmapGenerationOptions, "layers" | "faces" | "dirtyRegions">> & {
    layers: number[];
    faces: number[];
    dirtyRegions: TextureMipmapRegion[];
  };
  steps: TextureMipmapStep[];
  generatedMipCount: number;
  estimatedTexels: number;
  usesIntermediate: boolean;
}

export interface TextureMipmapBackend {
  begin?(plan: TextureMipmapPlan): void | Promise<void>;
  execute(step: TextureMipmapStep, descriptor: TextureMipmapDescriptor): void | Promise<void>;
  end?(plan: TextureMipmapPlan): void | Promise<void>;
  rollback?(plan: TextureMipmapPlan, completedSteps: readonly TextureMipmapStep[]): void | Promise<void>;
}

export type TextureMipmapJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TextureMipmapJob {
  id: string;
  state: TextureMipmapJobState;
  plan: TextureMipmapPlan;
  currentStep: number;
  progress: number;
  error: string | null;
  createdFrame: number;
  completedFrame: number | null;
}

export interface TextureMipmapRuntimeOptions {
  maximumConcurrentJobs?: number;
  maximumStepsPerFrame?: number;
  defaultIntermediateFormat?: string;
  retainCompletedJobs?: number;
}

export interface TextureMipmapSnapshot {
  frame: number;
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  totalCompletedSteps: number;
}

type TextureMipmapWatcher = (snapshot: TextureMipmapSnapshot) => void;

interface InternalJob extends TextureMipmapJob {
  cancelled: boolean;
  completedSteps: TextureMipmapStep[];
}

const DEFAULT_CONCURRENT_JOBS = 2;
const DEFAULT_STEPS_PER_FRAME = 64;
const DEFAULT_INTERMEDIATE_FORMAT = "rgba16float";

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

function mipExtent(extent: TextureMipmapExtent, mip: number): Required<TextureMipmapExtent> {
  return {
    width: Math.max(1, extent.width >> mip),
    height: Math.max(1, extent.height >> mip),
    depth: Math.max(1, (extent.depth ?? 1) >> mip),
  };
}

function cloneRegion(region: TextureMipmapRegion): TextureMipmapRegion {
  return { ...region };
}

function cloneStep(step: TextureMipmapStep): TextureMipmapStep {
  return {
    ...step,
    sourceExtent: { ...step.sourceExtent },
    targetExtent: { ...step.targetExtent },
    sourceRegion: cloneRegion(step.sourceRegion),
    targetRegion: cloneRegion(step.targetRegion),
  };
}

function clonePlan(plan: TextureMipmapPlan): TextureMipmapPlan {
  return {
    ...plan,
    descriptor: { ...plan.descriptor, extent: { ...plan.descriptor.extent } },
    options: {
      ...plan.options,
      layers: [...plan.options.layers],
      faces: [...plan.options.faces],
      dirtyRegions: plan.options.dirtyRegions.map(cloneRegion),
    },
    steps: plan.steps.map(cloneStep),
  };
}

function cloneJob(job: TextureMipmapJob): TextureMipmapJob {
  return { ...job, plan: clonePlan(job.plan) };
}

function clampRegion(region: TextureMipmapRegion, extent: Required<TextureMipmapExtent>): TextureMipmapRegion | null {
  const x = Math.max(0, Math.min(extent.width, Math.floor(region.x)));
  const y = Math.max(0, Math.min(extent.height, Math.floor(region.y)));
  const z = Math.max(0, Math.min(extent.depth, Math.floor(region.z ?? 0)));
  const endX = Math.max(x, Math.min(extent.width, Math.ceil(region.x + region.width)));
  const endY = Math.max(y, Math.min(extent.height, Math.ceil(region.y + region.height)));
  const endZ = Math.max(z, Math.min(extent.depth, Math.ceil((region.z ?? 0) + (region.depth ?? 1))));
  if (endX <= x || endY <= y || endZ <= z) return null;
  return { x, y, z, width: endX - x, height: endY - y, depth: endZ - z };
}

export class TextureMipmapGenerationRuntime {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly queue: string[] = [];
  private readonly watchers = new Set<TextureMipmapWatcher>();
  private readonly maximumConcurrentJobs: number;
  private readonly maximumStepsPerFrame: number;
  private readonly defaultIntermediateFormat: string;
  private readonly retainCompletedJobs: number;
  private frame = 0;
  private runningJobs = 0;
  private executedStepsThisFrame = 0;
  private totalCompletedSteps = 0;
  private nextJobId = 1;

  constructor(
    private readonly backend: TextureMipmapBackend,
    options: TextureMipmapRuntimeOptions = {},
  ) {
    this.maximumConcurrentJobs = options.maximumConcurrentJobs ?? DEFAULT_CONCURRENT_JOBS;
    this.maximumStepsPerFrame = options.maximumStepsPerFrame ?? DEFAULT_STEPS_PER_FRAME;
    this.defaultIntermediateFormat = options.defaultIntermediateFormat ?? DEFAULT_INTERMEDIATE_FORMAT;
    this.retainCompletedJobs = options.retainCompletedJobs ?? 32;
    positiveInteger(this.maximumConcurrentJobs, "maximumConcurrentJobs");
    positiveInteger(this.maximumStepsPerFrame, "maximumStepsPerFrame");
    if (!Number.isInteger(this.retainCompletedJobs) || this.retainCompletedJobs < 0) {
      throw new Error("retainCompletedJobs must be a non-negative integer");
    }
  }

  createPlan(
    descriptor: TextureMipmapDescriptor,
    options: TextureMipmapGenerationOptions = {},
  ): TextureMipmapPlan {
    this.validateDescriptor(descriptor);
    const firstMip = options.firstMip ?? 0;
    const lastMip = options.lastMip ?? descriptor.mipCount - 1;
    if (!Number.isInteger(firstMip) || firstMip < 0 || firstMip >= descriptor.mipCount) {
      throw new Error("firstMip is out of range");
    }
    if (!Number.isInteger(lastMip) || lastMip <= firstMip || lastMip >= descriptor.mipCount) {
      throw new Error("lastMip must follow firstMip and remain in range");
    }
    const layers = options.layers ? [...new Set(options.layers)] : Array.from({ length: descriptor.arrayLayers ?? 1 }, (_, index) => index);
    const faces = options.faces ? [...new Set(options.faces)] : Array.from({ length: descriptor.cubeFaces ?? 1 }, (_, index) => index);
    this.validateIndices(layers, descriptor.arrayLayers ?? 1, "layer");
    this.validateIndices(faces, descriptor.cubeFaces ?? 1, "face");
    const filter = options.filter ?? "linear";
    const alphaMode = options.alphaMode ?? "straight";
    const alphaCoverageThreshold = options.alphaCoverageThreshold ?? 0.5;
    if (!Number.isFinite(alphaCoverageThreshold) || alphaCoverageThreshold < 0 || alphaCoverageThreshold > 1) {
      throw new Error("alphaCoverageThreshold must be between zero and one");
    }
    const gammaCorrect = options.gammaCorrect ?? descriptor.colorSpace === "srgb";
    const renormalizeNormals = options.renormalizeNormals ?? filter === "normal_map";
    const preferCompute = options.preferCompute ?? true;
    const allowIntermediate = options.allowIntermediate ?? true;
    const dirtyRegions = (options.dirtyRegions ?? [{ x: 0, y: 0, z: 0, ...descriptor.extent }]).map(cloneRegion);
    const normalizedOptions: TextureMipmapPlan["options"] = {
      filter,
      alphaMode,
      alphaCoverageThreshold,
      renormalizeNormals,
      gammaCorrect,
      firstMip,
      lastMip,
      layers,
      faces,
      dirtyRegions,
      preferCompute,
      allowIntermediate,
    };
    const executionPath = this.selectExecutionPath(descriptor, normalizedOptions);
    if (executionPath === "intermediate" && !allowIntermediate) {
      throw new Error(`Texture ${descriptor.textureId} requires an intermediate format for mip generation`);
    }
    const steps: TextureMipmapStep[] = [];
    let estimatedTexels = 0;
    for (const layer of layers) {
      for (const face of faces) {
        let regions = dirtyRegions.map((region) => clampRegion(region, mipExtent(descriptor.extent, firstMip))).filter(Boolean) as TextureMipmapRegion[];
        for (let targetMip = firstMip + 1; targetMip <= lastMip; targetMip += 1) {
          const sourceMip = targetMip - 1;
          const sourceExtent = mipExtent(descriptor.extent, sourceMip);
          const targetExtent = mipExtent(descriptor.extent, targetMip);
          const nextRegions: TextureMipmapRegion[] = [];
          for (const sourceRegion of regions) {
            const expanded = this.expandSourceRegion(sourceRegion, sourceExtent, filter);
            const targetRegion = this.downsampleRegion(expanded, targetExtent);
            if (!targetRegion) continue;
            steps.push({
              index: steps.length,
              sourceMip,
              targetMip,
              layer,
              face,
              sourceExtent,
              targetExtent,
              sourceRegion: expanded,
              targetRegion,
              filter,
              alphaMode,
              gammaCorrect,
              renormalizeNormals,
              executionPath,
              ...(executionPath === "intermediate" ? { intermediateFormat: this.defaultIntermediateFormat } : {}),
            });
            estimatedTexels += targetRegion.width * targetRegion.height * (targetRegion.depth ?? 1);
            nextRegions.push(targetRegion);
          }
          regions = this.mergeRegions(nextRegions);
        }
      }
    }
    return {
      textureId: descriptor.textureId,
      descriptor: { ...descriptor, extent: { ...descriptor.extent } },
      options: normalizedOptions,
      steps,
      generatedMipCount: lastMip - firstMip,
      estimatedTexels,
      usesIntermediate: executionPath === "intermediate",
    };
  }

  enqueue(plan: TextureMipmapPlan): TextureMipmapJob {
    const id = `mipmap_job_${this.nextJobId++}`;
    const job: InternalJob = {
      id,
      state: "queued",
      plan: clonePlan(plan),
      currentStep: 0,
      progress: plan.steps.length === 0 ? 1 : 0,
      error: null,
      createdFrame: this.frame,
      completedFrame: null,
      cancelled: false,
      completedSteps: [],
    };
    if (plan.steps.length === 0) {
      job.state = "completed";
      job.completedFrame = this.frame;
    } else {
      this.queue.push(id);
    }
    this.jobs.set(id, job);
    this.notify();
    void this.pump();
    return cloneJob(job);
  }

  generate(descriptor: TextureMipmapDescriptor, options: TextureMipmapGenerationOptions = {}): TextureMipmapJob {
    return this.enqueue(this.createPlan(descriptor, options));
  }

  getJob(id: string): TextureMipmapJob | undefined {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  listJobs(state?: TextureMipmapJobState): TextureMipmapJob[] {
    return [...this.jobs.values()].filter((job) => !state || job.state === state).map(cloneJob);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.state === "completed" || job.state === "failed" || job.state === "cancelled") return false;
    job.cancelled = true;
    if (job.state === "queued") {
      const index = this.queue.indexOf(id);
      if (index >= 0) this.queue.splice(index, 1);
      job.state = "cancelled";
      job.completedFrame = this.frame;
      this.notify();
    }
    return true;
  }

  removeJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.state === "running") return false;
    const index = this.queue.indexOf(id);
    if (index >= 0) this.queue.splice(index, 1);
    const deleted = this.jobs.delete(id);
    if (deleted) this.notify();
    return deleted;
  }

  beginFrame(frame?: number): void {
    this.frame = frame ?? this.frame + 1;
    if (!Number.isInteger(this.frame) || this.frame < 0) throw new Error("Mipmap generation frame must be non-negative");
    this.executedStepsThisFrame = 0;
    this.pruneJobs();
    this.notify();
    void this.pump();
  }

  snapshot(): TextureMipmapSnapshot {
    const jobs = [...this.jobs.values()];
    return {
      frame: this.frame,
      queuedJobs: jobs.filter((job) => job.state === "queued").length,
      runningJobs: jobs.filter((job) => job.state === "running").length,
      completedJobs: jobs.filter((job) => job.state === "completed").length,
      failedJobs: jobs.filter((job) => job.state === "failed").length,
      cancelledJobs: jobs.filter((job) => job.state === "cancelled").length,
      totalCompletedSteps: this.totalCompletedSteps,
    };
  }

  watch(watcher: TextureMipmapWatcher): () => void {
    this.watchers.add(watcher);
    watcher(this.snapshot());
    return () => this.watchers.delete(watcher);
  }

  private async pump(): Promise<void> {
    while (this.runningJobs < this.maximumConcurrentJobs
      && this.executedStepsThisFrame < this.maximumStepsPerFrame
      && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.cancelled) continue;
      this.runningJobs += 1;
      void this.runJob(job).finally(() => {
        this.runningJobs -= 1;
        this.notify();
        void this.pump();
      });
    }
  }

  private async runJob(job: InternalJob): Promise<void> {
    job.state = "running";
    try {
      await this.backend.begin?.(clonePlan(job.plan));
      while (job.currentStep < job.plan.steps.length) {
        if (job.cancelled) {
          job.state = "cancelled";
          job.completedFrame = this.frame;
          await this.backend.rollback?.(clonePlan(job.plan), job.completedSteps.map(cloneStep));
          return;
        }
        if (this.executedStepsThisFrame >= this.maximumStepsPerFrame) {
          job.state = "queued";
          this.queue.push(job.id);
          return;
        }
        const step = job.plan.steps[job.currentStep];
        if (step === undefined) throw new Error(`Mipmap job ${job.id} lost step ${job.currentStep}`);
        await this.backend.execute(cloneStep(step), { ...job.plan.descriptor, extent: { ...job.plan.descriptor.extent } });
        job.completedSteps.push(step);
        job.currentStep += 1;
        job.progress = job.currentStep / job.plan.steps.length;
        this.executedStepsThisFrame += 1;
        this.totalCompletedSteps += 1;
        this.notify();
      }
      await this.backend.end?.(clonePlan(job.plan));
      job.state = "completed";
      job.progress = 1;
      job.completedFrame = this.frame;
    } catch (error) {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.completedFrame = this.frame;
      await this.backend.rollback?.(clonePlan(job.plan), job.completedSteps.map(cloneStep));
    }
  }

  private selectExecutionPath(
    descriptor: TextureMipmapDescriptor,
    options: TextureMipmapPlan["options"],
  ): TextureMipmapExecutionPath {
    if (options.filter === "nearest" && descriptor.filterable !== false && !options.gammaCorrect) return "blit";
    if (descriptor.compressed) return "intermediate";
    if (options.preferCompute && descriptor.storageWritable) return "compute";
    if (descriptor.renderable) return "render";
    if (descriptor.filterable) return "blit";
    return "intermediate";
  }

  private expandSourceRegion(
    region: TextureMipmapRegion,
    extent: Required<TextureMipmapExtent>,
    filter: TextureMipmapFilter,
  ): TextureMipmapRegion {
    const radius = filter === "nearest" ? 0 : filter === "linear" || filter === "min" || filter === "max" || filter === "normal_map" ? 1 : 2;
    return clampRegion({
      x: region.x - radius,
      y: region.y - radius,
      z: (region.z ?? 0) - radius,
      width: region.width + radius * 2,
      height: region.height + radius * 2,
      depth: (region.depth ?? 1) + radius * 2,
    }, extent)!;
  }

  private downsampleRegion(region: TextureMipmapRegion, extent: Required<TextureMipmapExtent>): TextureMipmapRegion | null {
    const x = Math.floor(region.x / 2);
    const y = Math.floor(region.y / 2);
    const z = Math.floor((region.z ?? 0) / 2);
    return clampRegion({
      x,
      y,
      z,
      width: Math.max(1, Math.ceil((region.x + region.width) / 2) - x),
      height: Math.max(1, Math.ceil((region.y + region.height) / 2) - y),
      depth: Math.max(1, Math.ceil(((region.z ?? 0) + (region.depth ?? 1)) / 2) - z),
    }, extent);
  }

  private mergeRegions(regions: TextureMipmapRegion[]): TextureMipmapRegion[] {
    const merged: TextureMipmapRegion[] = [];
    for (const region of regions) {
      const overlap = merged.find((candidate) => {
        const z = candidate.z ?? 0;
        const depth = candidate.depth ?? 1;
        const regionZ = region.z ?? 0;
        const regionDepth = region.depth ?? 1;
        return candidate.x <= region.x + region.width && region.x <= candidate.x + candidate.width
          && candidate.y <= region.y + region.height && region.y <= candidate.y + candidate.height
          && z <= regionZ + regionDepth && regionZ <= z + depth;
      });
      if (!overlap) {
        merged.push(cloneRegion(region));
        continue;
      }
      const minX = Math.min(overlap.x, region.x);
      const minY = Math.min(overlap.y, region.y);
      const minZ = Math.min(overlap.z ?? 0, region.z ?? 0);
      overlap.width = Math.max(overlap.x + overlap.width, region.x + region.width) - minX;
      overlap.height = Math.max(overlap.y + overlap.height, region.y + region.height) - minY;
      overlap.depth = Math.max((overlap.z ?? 0) + (overlap.depth ?? 1), (region.z ?? 0) + (region.depth ?? 1)) - minZ;
      overlap.x = minX;
      overlap.y = minY;
      overlap.z = minZ;
    }
    return merged;
  }

  private validateDescriptor(descriptor: TextureMipmapDescriptor): void {
    if (!descriptor.textureId) throw new Error("Mipmap texture id cannot be empty");
    if (!descriptor.format) throw new Error(`Texture ${descriptor.textureId} format cannot be empty`);
    positiveInteger(descriptor.extent.width, "texture width");
    positiveInteger(descriptor.extent.height, "texture height");
    positiveInteger(descriptor.extent.depth ?? 1, "texture depth");
    positiveInteger(descriptor.mipCount, "mipCount");
    positiveInteger(descriptor.arrayLayers ?? 1, "arrayLayers");
    positiveInteger(descriptor.cubeFaces ?? 1, "cubeFaces");
  }

  private validateIndices(indices: readonly number[], count: number, label: string): void {
    if (indices.length === 0) throw new Error(`At least one ${label} must be selected`);
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`${label} ${index} is out of range`);
    }
  }

  private pruneJobs(): void {
    const completed = [...this.jobs.values()]
      .filter((job) => job.state === "completed" || job.state === "failed" || job.state === "cancelled")
      .sort((a, b) => (b.completedFrame ?? 0) - (a.completedFrame ?? 0));
    for (const job of completed.slice(this.retainCompletedJobs)) this.jobs.delete(job.id);
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}
