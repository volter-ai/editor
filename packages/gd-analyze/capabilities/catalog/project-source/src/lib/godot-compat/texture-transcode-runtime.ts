export type TextureTranscodeColorSpace = "linear" | "srgb" | "hdr_linear" | "depth" | "depth_stencil";

export type TextureTranscodeChannelType = "unorm" | "snorm" | "uint" | "sint" | "float" | "depth";

export type TextureTranscodeCompressionFamily = "none" | "bc" | "etc" | "astc" | "pvrtc" | "basis" | "custom";

export interface TextureTranscodeFormat {
  name: string;
  blockWidth: number;
  blockHeight: number;
  blockDepth?: number;
  bytesPerBlock: number;
  channels: number;
  channelType: TextureTranscodeChannelType;
  colorSpace: TextureTranscodeColorSpace;
  compression: TextureTranscodeCompressionFamily;
  renderable?: boolean;
  filterable?: boolean;
  storage?: boolean;
  copyable?: boolean;
}

export interface TextureTranscodeExtent {
  width: number;
  height: number;
  depth?: number;
}

export interface TextureSubresourceFootprint {
  mipLevel: number;
  arrayLayer: number;
  width: number;
  height: number;
  depth: number;
  blocksX: number;
  blocksY: number;
  blocksZ: number;
  rowBytes: number;
  sliceBytes: number;
  byteOffset: number;
  byteSize: number;
}

export interface TextureTranscodeSource {
  id: string;
  format: string;
  extent: TextureTranscodeExtent;
  mipCount?: number;
  arrayLayers?: number;
  data?: Uint8Array;
}

export interface TextureTranscodeTargetRequirements {
  supportedFormats: readonly string[];
  preferredFormats?: readonly string[];
  requireRenderable?: boolean;
  requireFilterable?: boolean;
  requireStorage?: boolean;
  preserveColorSpace?: boolean;
  preserveAlpha?: boolean;
  maximumBytes?: number;
  allowDecompression?: boolean;
  allowLossy?: boolean;
}

export type TextureTranscodeOperationKind =
  | "direct_copy"
  | "reinterpret"
  | "decompress"
  | "compress"
  | "convert_channels"
  | "convert_color_space"
  | "convert_numeric_type";

export interface TextureTranscodeStep {
  operation: TextureTranscodeOperationKind;
  sourceFormat: string;
  targetFormat: string;
  estimatedInputBytes: number;
  estimatedOutputBytes: number;
  lossy: boolean;
}

export interface TextureTranscodePlan {
  sourceId: string;
  sourceFormat: string;
  targetFormat: string;
  extent: TextureTranscodeExtent;
  mipCount: number;
  arrayLayers: number;
  steps: TextureTranscodeStep[];
  sourceFootprints: TextureSubresourceFootprint[];
  targetFootprints: TextureSubresourceFootprint[];
  sourceBytes: number;
  targetBytes: number;
  directCopy: boolean;
  lossy: boolean;
  score: number;
}

export interface TextureTranscodeBackend {
  transcode(
    step: TextureTranscodeStep,
    input: Uint8Array,
    source: TextureTranscodeSource,
    targetFormat: TextureTranscodeFormat,
  ): Uint8Array | Promise<Uint8Array>;
}

export type TextureTranscodeJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TextureTranscodeJob {
  id: string;
  plan: TextureTranscodePlan;
  state: TextureTranscodeJobState;
  progress: number;
  result: Uint8Array | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface TextureTranscodeRuntimeOptions {
  maximumConcurrentJobs?: number;
  retainCompletedJobs?: number;
  rowAlignment?: number;
}

export interface TextureTranscodeSnapshot {
  registeredFormats: number;
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
}

type TextureTranscodeWatcher = (snapshot: TextureTranscodeSnapshot) => void;

interface InternalJob extends TextureTranscodeJob {
  source: TextureTranscodeSource;
  cancelled: boolean;
}

const DEFAULT_MAXIMUM_CONCURRENT_JOBS = 2;
const DEFAULT_RETAIN_COMPLETED_JOBS = 32;

function alignUp(value: number, alignment: number): number {
  return alignment <= 1 ? value : Math.ceil(value / alignment) * alignment;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

function cloneFormat(format: TextureTranscodeFormat): TextureTranscodeFormat {
  return { ...format };
}

function cloneFootprint(footprint: TextureSubresourceFootprint): TextureSubresourceFootprint {
  return { ...footprint };
}

function clonePlan(plan: TextureTranscodePlan): TextureTranscodePlan {
  return {
    ...plan,
    extent: { ...plan.extent },
    steps: plan.steps.map((step) => ({ ...step })),
    sourceFootprints: plan.sourceFootprints.map(cloneFootprint),
    targetFootprints: plan.targetFootprints.map(cloneFootprint),
  };
}

function cloneJob(job: TextureTranscodeJob): TextureTranscodeJob {
  return {
    ...job,
    plan: clonePlan(job.plan),
    result: job.result ? job.result.slice() : null,
  };
}

function mipExtent(extent: TextureTranscodeExtent, level: number): Required<TextureTranscodeExtent> {
  return {
    width: Math.max(1, extent.width >> level),
    height: Math.max(1, extent.height >> level),
    depth: Math.max(1, (extent.depth ?? 1) >> level),
  };
}

export class TextureTranscodeRuntime {
  private readonly formats = new Map<string, TextureTranscodeFormat>();
  private readonly jobs = new Map<string, InternalJob>();
  private readonly queue: string[] = [];
  private readonly watchers = new Set<TextureTranscodeWatcher>();
  private readonly maximumConcurrentJobs: number;
  private readonly retainCompletedJobs: number;
  private readonly rowAlignment: number;
  private runningJobs = 0;
  private nextJobId = 1;

  constructor(
    private readonly backend: TextureTranscodeBackend,
    options: TextureTranscodeRuntimeOptions = {},
  ) {
    this.maximumConcurrentJobs = options.maximumConcurrentJobs ?? DEFAULT_MAXIMUM_CONCURRENT_JOBS;
    this.retainCompletedJobs = options.retainCompletedJobs ?? DEFAULT_RETAIN_COMPLETED_JOBS;
    this.rowAlignment = options.rowAlignment ?? 1;
    positiveInteger(this.maximumConcurrentJobs, "maximumConcurrentJobs");
    if (!Number.isInteger(this.retainCompletedJobs) || this.retainCompletedJobs < 0) {
      throw new Error("retainCompletedJobs must be a non-negative integer");
    }
    positiveInteger(this.rowAlignment, "rowAlignment");
  }

  registerFormat(format: TextureTranscodeFormat): void {
    this.validateFormat(format);
    if (this.formats.has(format.name)) throw new Error(`Texture format ${format.name} is already registered`);
    this.formats.set(format.name, cloneFormat(format));
    this.notify();
  }

  updateFormat(name: string, patch: Partial<Omit<TextureTranscodeFormat, "name">>): void {
    const existing = this.formats.get(name);
    if (!existing) throw new Error(`Unknown texture format ${name}`);
    const next = { ...existing, ...patch, name };
    this.validateFormat(next);
    this.formats.set(name, next);
    this.notify();
  }

  unregisterFormat(name: string): boolean {
    const deleted = this.formats.delete(name);
    if (deleted) this.notify();
    return deleted;
  }

  getFormat(name: string): TextureTranscodeFormat | undefined {
    const format = this.formats.get(name);
    return format ? cloneFormat(format) : undefined;
  }

  listFormats(): TextureTranscodeFormat[] {
    return [...this.formats.values()].map(cloneFormat);
  }

  calculateFootprints(
    formatName: string,
    extent: TextureTranscodeExtent,
    mipCount = 1,
    arrayLayers = 1,
  ): TextureSubresourceFootprint[] {
    const format = this.requireFormat(formatName);
    this.validateExtent(extent);
    positiveInteger(mipCount, "mipCount");
    positiveInteger(arrayLayers, "arrayLayers");
    const footprints: TextureSubresourceFootprint[] = [];
    let byteOffset = 0;
    for (let layer = 0; layer < arrayLayers; layer += 1) {
      for (let mip = 0; mip < mipCount; mip += 1) {
        const mipSize = mipExtent(extent, mip);
        const blocksX = Math.ceil(mipSize.width / format.blockWidth);
        const blocksY = Math.ceil(mipSize.height / format.blockHeight);
        const blocksZ = Math.ceil(mipSize.depth / (format.blockDepth ?? 1));
        const rowBytes = alignUp(blocksX * format.bytesPerBlock, this.rowAlignment);
        const sliceBytes = rowBytes * blocksY;
        const byteSize = sliceBytes * blocksZ;
        byteOffset = alignUp(byteOffset, this.rowAlignment);
        footprints.push({
          mipLevel: mip,
          arrayLayer: layer,
          width: mipSize.width,
          height: mipSize.height,
          depth: mipSize.depth,
          blocksX,
          blocksY,
          blocksZ,
          rowBytes,
          sliceBytes,
          byteOffset,
          byteSize,
        });
        byteOffset += byteSize;
      }
    }
    return footprints;
  }

  estimateBytes(formatName: string, extent: TextureTranscodeExtent, mipCount = 1, arrayLayers = 1): number {
    const footprints = this.calculateFootprints(formatName, extent, mipCount, arrayLayers);
    const last = footprints[footprints.length - 1];
    return last ? last.byteOffset + last.byteSize : 0;
  }

  selectTarget(source: TextureTranscodeSource, requirements: TextureTranscodeTargetRequirements): TextureTranscodePlan | null {
    this.validateSource(source);
    const plans: TextureTranscodePlan[] = [];
    const supported = new Set(requirements.supportedFormats);
    for (const formatName of supported) {
      const target = this.formats.get(formatName);
      if (!target || !this.satisfiesRequirements(target, requirements)) continue;
      const plan = this.createPlan(source, target, requirements);
      if (plan) plans.push(plan);
    }
    plans.sort((a, b) => b.score - a.score || a.targetBytes - b.targetBytes || a.targetFormat.localeCompare(b.targetFormat));
    return plans[0] ? clonePlan(plans[0]) : null;
  }

  createPlan(
    source: TextureTranscodeSource,
    targetFormat: TextureTranscodeFormat | string,
    requirements: TextureTranscodeTargetRequirements = { supportedFormats: [] },
  ): TextureTranscodePlan | null {
    this.validateSource(source);
    const sourceFormat = this.requireFormat(source.format);
    const target = typeof targetFormat === "string" ? this.requireFormat(targetFormat) : targetFormat;
    this.validateFormat(target);
    const mipCount = source.mipCount ?? 1;
    const arrayLayers = source.arrayLayers ?? 1;
    const sourceFootprints = this.calculateFootprints(sourceFormat.name, source.extent, mipCount, arrayLayers);
    const targetFootprints = this.calculateFootprints(target.name, source.extent, mipCount, arrayLayers);
    const sourceBytes = sourceFootprints.reduce((total, footprint) => total + footprint.byteSize, 0);
    const targetBytes = targetFootprints.reduce((total, footprint) => total + footprint.byteSize, 0);
    if (requirements.maximumBytes !== undefined && targetBytes > requirements.maximumBytes) return null;
    const steps = this.planSteps(sourceFormat, target, sourceBytes, targetBytes);
    const lossy = steps.some((step) => step.lossy);
    if (lossy && requirements.allowLossy === false) return null;
    if (sourceFormat.compression !== "none" && target.compression === "none" && requirements.allowDecompression === false) return null;
    if (requirements.preserveColorSpace !== false && sourceFormat.colorSpace !== target.colorSpace) return null;
    if (requirements.preserveAlpha && sourceFormat.channels >= 4 && target.channels < 4) return null;
    const preferredIndex = requirements.preferredFormats?.indexOf(target.name) ?? -1;
    let score = 1000 - steps.length * 75;
    if (sourceFormat.name === target.name) score += 1000;
    if (preferredIndex >= 0) score += Math.max(10, 500 - preferredIndex * 25);
    if (!lossy) score += 250;
    if (targetBytes <= sourceBytes) score += Math.min(200, Math.round((sourceBytes - targetBytes) / Math.max(1, sourceBytes) * 200));
    if (target.renderable) score += 10;
    if (target.filterable) score += 10;
    return {
      sourceId: source.id,
      sourceFormat: sourceFormat.name,
      targetFormat: target.name,
      extent: { ...source.extent },
      mipCount,
      arrayLayers,
      steps,
      sourceFootprints,
      targetFootprints,
      sourceBytes,
      targetBytes,
      directCopy: steps.length === 1 && steps[0]?.operation === "direct_copy",
      lossy,
      score,
    };
  }

  enqueue(source: TextureTranscodeSource, plan: TextureTranscodePlan): TextureTranscodeJob {
    if (plan.sourceId !== source.id) throw new Error("Texture transcode plan does not match source id");
    if (plan.sourceFormat !== source.format) throw new Error("Texture transcode plan does not match source format");
    if (!source.data) throw new Error(`Texture transcode source ${source.id} has no data`);
    const expectedSourceBytes = plan.sourceFootprints.reduce((total, footprint) => total + footprint.byteSize, 0);
    if (source.data.byteLength < expectedSourceBytes) {
      throw new Error(`Texture transcode source ${source.id} data is smaller than its declared footprint`);
    }
    const id = `texture_transcode_${this.nextJobId++}`;
    const job: InternalJob = {
      id,
      plan: clonePlan(plan),
      source: { ...source, extent: { ...source.extent }, data: source.data.slice() },
      state: "queued",
      progress: 0,
      result: null,
      error: null,
      createdAt: Date.now(),
      completedAt: null,
      cancelled: false,
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.notify();
    void this.pumpQueue();
    return cloneJob(job);
  }

  getJob(id: string): TextureTranscodeJob | undefined {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  listJobs(state?: TextureTranscodeJobState): TextureTranscodeJob[] {
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
      job.completedAt = Date.now();
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

  snapshot(): TextureTranscodeSnapshot {
    const jobs = [...this.jobs.values()];
    return {
      registeredFormats: this.formats.size,
      queuedJobs: jobs.filter((job) => job.state === "queued").length,
      runningJobs: jobs.filter((job) => job.state === "running").length,
      completedJobs: jobs.filter((job) => job.state === "completed").length,
      failedJobs: jobs.filter((job) => job.state === "failed").length,
      cancelledJobs: jobs.filter((job) => job.state === "cancelled").length,
    };
  }

  watch(watcher: TextureTranscodeWatcher): () => void {
    this.watchers.add(watcher);
    watcher(this.snapshot());
    return () => this.watchers.delete(watcher);
  }

  private async pumpQueue(): Promise<void> {
    while (this.runningJobs < this.maximumConcurrentJobs && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.cancelled) continue;
      this.runningJobs += 1;
      void this.runJob(job).finally(() => {
        this.runningJobs -= 1;
        this.pruneCompletedJobs();
        this.notify();
        void this.pumpQueue();
      });
    }
  }

  private async runJob(job: InternalJob): Promise<void> {
    job.state = "running";
    this.notify();
    try {
      let data: Uint8Array<ArrayBufferLike> = job.source.data!.slice();
      const target = this.requireFormat(job.plan.targetFormat);
      for (let index = 0; index < job.plan.steps.length; index += 1) {
        if (job.cancelled) {
          job.state = "cancelled";
          job.completedAt = Date.now();
          return;
        }
        const step = job.plan.steps[index];
        if (step === undefined) throw new Error(`Texture transcode job ${job.id} lost step ${index}`);
        if (step.operation !== "direct_copy") {
          data = await this.backend.transcode({ ...step }, data, job.source, target);
        }
        job.progress = (index + 1) / job.plan.steps.length;
        this.notify();
      }
      if (data.byteLength < job.plan.targetBytes) {
        throw new Error(`Texture transcode backend returned ${data.byteLength} bytes, expected at least ${job.plan.targetBytes}`);
      }
      job.result = data;
      job.state = "completed";
      job.progress = 1;
      job.completedAt = Date.now();
    } catch (error) {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = Date.now();
    }
  }

  private planSteps(
    source: TextureTranscodeFormat,
    target: TextureTranscodeFormat,
    sourceBytes: number,
    targetBytes: number,
  ): TextureTranscodeStep[] {
    if (source.name === target.name) {
      return [{ operation: "direct_copy", sourceFormat: source.name, targetFormat: target.name, estimatedInputBytes: sourceBytes, estimatedOutputBytes: targetBytes, lossy: false }];
    }
    if (source.blockWidth === target.blockWidth
      && source.blockHeight === target.blockHeight
      && (source.blockDepth ?? 1) === (target.blockDepth ?? 1)
      && source.bytesPerBlock === target.bytesPerBlock
      && source.channels === target.channels
      && source.channelType === target.channelType
      && source.compression === target.compression) {
      return [{ operation: "reinterpret", sourceFormat: source.name, targetFormat: target.name, estimatedInputBytes: sourceBytes, estimatedOutputBytes: targetBytes, lossy: source.colorSpace !== target.colorSpace }];
    }
    const steps: TextureTranscodeStep[] = [];
    let current = source;
    let currentBytes = sourceBytes;
    if (current.compression !== "none") {
      const intermediate = `${current.channels === 4 ? "rgba" : "rgb"}32f_intermediate`;
      steps.push({ operation: "decompress", sourceFormat: current.name, targetFormat: intermediate, estimatedInputBytes: currentBytes, estimatedOutputBytes: sourceBytes * 4, lossy: false });
      currentBytes = sourceBytes * 4;
      current = { ...current, name: intermediate, compression: "none", blockWidth: 1, blockHeight: 1, blockDepth: 1, bytesPerBlock: current.channels * 4, channelType: "float" };
    }
    if (current.channels !== target.channels) {
      steps.push({ operation: "convert_channels", sourceFormat: current.name, targetFormat: `${target.channels}ch_intermediate`, estimatedInputBytes: currentBytes, estimatedOutputBytes: currentBytes, lossy: target.channels < current.channels });
      current = { ...current, name: `${target.channels}ch_intermediate`, channels: target.channels };
    }
    if (current.colorSpace !== target.colorSpace) {
      steps.push({ operation: "convert_color_space", sourceFormat: current.name, targetFormat: `${target.colorSpace}_intermediate`, estimatedInputBytes: currentBytes, estimatedOutputBytes: currentBytes, lossy: target.colorSpace === "srgb" });
      current = { ...current, name: `${target.colorSpace}_intermediate`, colorSpace: target.colorSpace };
    }
    if (current.channelType !== target.channelType) {
      steps.push({ operation: "convert_numeric_type", sourceFormat: current.name, targetFormat: `${target.channelType}_intermediate`, estimatedInputBytes: currentBytes, estimatedOutputBytes: targetBytes, lossy: current.channelType === "float" && target.channelType !== "float" });
      current = { ...current, name: `${target.channelType}_intermediate`, channelType: target.channelType };
      currentBytes = targetBytes;
    }
    if (target.compression !== "none") {
      steps.push({ operation: "compress", sourceFormat: current.name, targetFormat: target.name, estimatedInputBytes: currentBytes, estimatedOutputBytes: targetBytes, lossy: true });
    } else if (steps.length === 0 || current.name !== target.name) {
      steps.push({ operation: "reinterpret", sourceFormat: current.name, targetFormat: target.name, estimatedInputBytes: currentBytes, estimatedOutputBytes: targetBytes, lossy: false });
    }
    return steps;
  }

  private satisfiesRequirements(format: TextureTranscodeFormat, requirements: TextureTranscodeTargetRequirements): boolean {
    if (requirements.requireRenderable && !format.renderable) return false;
    if (requirements.requireFilterable && !format.filterable) return false;
    if (requirements.requireStorage && !format.storage) return false;
    return true;
  }

  private pruneCompletedJobs(): void {
    const terminal = [...this.jobs.values()]
      .filter((job) => job.state === "completed" || job.state === "failed" || job.state === "cancelled")
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    for (const job of terminal.slice(this.retainCompletedJobs)) this.jobs.delete(job.id);
  }

  private validateSource(source: TextureTranscodeSource): void {
    if (!source.id) throw new Error("Texture transcode source id cannot be empty");
    this.requireFormat(source.format);
    this.validateExtent(source.extent);
    positiveInteger(source.mipCount ?? 1, "source mipCount");
    positiveInteger(source.arrayLayers ?? 1, "source arrayLayers");
  }

  private validateExtent(extent: TextureTranscodeExtent): void {
    positiveInteger(extent.width, "texture width");
    positiveInteger(extent.height, "texture height");
    positiveInteger(extent.depth ?? 1, "texture depth");
  }

  private validateFormat(format: TextureTranscodeFormat): void {
    if (!format.name) throw new Error("Texture format name cannot be empty");
    positiveInteger(format.blockWidth, `format ${format.name} blockWidth`);
    positiveInteger(format.blockHeight, `format ${format.name} blockHeight`);
    positiveInteger(format.blockDepth ?? 1, `format ${format.name} blockDepth`);
    positiveInteger(format.bytesPerBlock, `format ${format.name} bytesPerBlock`);
    if (!Number.isInteger(format.channels) || format.channels < 1 || format.channels > 4) {
      throw new Error(`Texture format ${format.name} channels must be between one and four`);
    }
  }

  private requireFormat(name: string): TextureTranscodeFormat {
    const format = this.formats.get(name);
    if (!format) throw new Error(`Unknown texture format ${name}`);
    return format;
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}
