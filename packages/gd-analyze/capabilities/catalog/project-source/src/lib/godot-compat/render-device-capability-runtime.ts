export type RenderDeviceBackend = "vulkan" | "metal" | "direct3d12" | "webgpu" | "opengl" | "unknown";

export type RenderDeviceType = "discrete" | "integrated" | "virtual" | "software" | "unknown";

export type RenderDeviceQueueCapability = "graphics" | "compute" | "transfer" | "present";

export type RenderDeviceFeature =
  | "bindless_resources"
  | "buffer_device_address"
  | "descriptor_indexing"
  | "dynamic_rendering"
  | "fragment_shading_rate"
  | "mesh_shaders"
  | "multiview"
  | "ray_query"
  | "ray_tracing_pipeline"
  | "sampler_anisotropy"
  | "shader_float16"
  | "shader_float64"
  | "shader_int64"
  | "sparse_resources"
  | "subgroup_operations"
  | "texture_compression_astc"
  | "texture_compression_bc"
  | "texture_compression_etc2"
  | "timeline_semaphore"
  | "variable_rate_shading";

export type RenderFormatCapability =
  | "sampled"
  | "storage"
  | "color_attachment"
  | "depth_attachment"
  | "stencil_attachment"
  | "blend"
  | "linear_filter"
  | "copy_source"
  | "copy_destination"
  | "resolve_source"
  | "resolve_destination";

export interface RenderDeviceLimits {
  maximumTextureDimension1D: number;
  maximumTextureDimension2D: number;
  maximumTextureDimension3D: number;
  maximumTextureArrayLayers: number;
  maximumColorAttachments: number;
  maximumFramebufferWidth: number;
  maximumFramebufferHeight: number;
  maximumUniformBufferRange: number;
  maximumStorageBufferRange: number;
  maximumPushConstantBytes: number;
  maximumBoundDescriptorSets: number;
  maximumSampledImagesPerStage: number;
  maximumStorageImagesPerStage: number;
  maximumSamplersPerStage: number;
  maximumComputeSharedMemoryBytes: number;
  maximumComputeWorkgroupInvocations: number;
  maximumComputeWorkgroupSizeX: number;
  maximumComputeWorkgroupSizeY: number;
  maximumComputeWorkgroupSizeZ: number;
  maximumViewports: number;
  maximumViewportWidth: number;
  maximumViewportHeight: number;
  minimumUniformBufferOffsetAlignment: number;
  minimumStorageBufferOffsetAlignment: number;
  maximumAnisotropy: number;
}

export interface RenderDeviceQueueFamily {
  index: number;
  capabilities: readonly RenderDeviceQueueCapability[];
  queueCount: number;
  timestampBits?: number;
  supportsSparseBinding?: boolean;
}

export interface RenderDeviceMemoryHeap {
  index: number;
  byteSize: number;
  deviceLocal: boolean;
  hostVisible: boolean;
  hostCoherent?: boolean;
  hostCached?: boolean;
  budgetBytes?: number;
  usageBytes?: number;
}

export interface RenderDeviceFormatSupport {
  format: string;
  capabilities: readonly RenderFormatCapability[];
  sampleCounts?: readonly number[];
}

export interface RenderDeviceAdapterDescriptor {
  id: string;
  name: string;
  vendor?: string;
  vendorId?: number;
  deviceId?: number;
  driver?: string;
  backend: RenderDeviceBackend;
  type: RenderDeviceType;
  features: readonly RenderDeviceFeature[];
  limits: RenderDeviceLimits;
  queues: readonly RenderDeviceQueueFamily[];
  memoryHeaps: readonly RenderDeviceMemoryHeap[];
  formats?: readonly RenderDeviceFormatSupport[];
  presentationSurfaces?: readonly string[];
}

export interface RenderDeviceRequirements {
  requiredFeatures?: readonly RenderDeviceFeature[];
  optionalFeatures?: readonly RenderDeviceFeature[];
  requiredFormats?: Readonly<Record<string, readonly RenderFormatCapability[]>>;
  requiredLimits?: Partial<RenderDeviceLimits>;
  requiredQueues?: Partial<Record<RenderDeviceQueueCapability, number>>;
  preferredBackend?: RenderDeviceBackend;
  preferredDeviceType?: RenderDeviceType;
  presentationSurface?: string;
  minimumDeviceLocalMemoryBytes?: number;
  allowSoftware?: boolean;
}

export interface RenderDeviceQueueSelection {
  graphics?: { familyIndex: number; queueIndex: number };
  compute?: { familyIndex: number; queueIndex: number };
  transfer?: { familyIndex: number; queueIndex: number };
  present?: { familyIndex: number; queueIndex: number };
}

export interface RenderDeviceRejection {
  adapterId: string;
  reasons: string[];
}

export interface RenderDeviceSelection {
  adapter: RenderDeviceAdapterDescriptor;
  enabledFeatures: RenderDeviceFeature[];
  unavailableOptionalFeatures: RenderDeviceFeature[];
  queues: RenderDeviceQueueSelection;
  score: number;
  warnings: string[];
}

export interface RenderDeviceSelectionResult {
  selected: RenderDeviceSelection | null;
  candidates: RenderDeviceSelection[];
  rejected: RenderDeviceRejection[];
}

export interface RenderDeviceCapabilitySnapshot {
  revision: number;
  adapterCount: number;
  adapters: RenderDeviceAdapterDescriptor[];
}

type CapabilityWatcher = (snapshot: RenderDeviceCapabilitySnapshot) => void;

const LIMIT_KEYS: readonly (keyof RenderDeviceLimits)[] = [
  "maximumTextureDimension1D",
  "maximumTextureDimension2D",
  "maximumTextureDimension3D",
  "maximumTextureArrayLayers",
  "maximumColorAttachments",
  "maximumFramebufferWidth",
  "maximumFramebufferHeight",
  "maximumUniformBufferRange",
  "maximumStorageBufferRange",
  "maximumPushConstantBytes",
  "maximumBoundDescriptorSets",
  "maximumSampledImagesPerStage",
  "maximumStorageImagesPerStage",
  "maximumSamplersPerStage",
  "maximumComputeSharedMemoryBytes",
  "maximumComputeWorkgroupInvocations",
  "maximumComputeWorkgroupSizeX",
  "maximumComputeWorkgroupSizeY",
  "maximumComputeWorkgroupSizeZ",
  "maximumViewports",
  "maximumViewportWidth",
  "maximumViewportHeight",
  "minimumUniformBufferOffsetAlignment",
  "minimumStorageBufferOffsetAlignment",
  "maximumAnisotropy",
];

const DEVICE_TYPE_SCORE: Record<RenderDeviceType, number> = {
  discrete: 500,
  integrated: 300,
  virtual: 150,
  software: 10,
  unknown: 50,
};

const BACKEND_SCORE: Record<RenderDeviceBackend, number> = {
  vulkan: 80,
  metal: 80,
  direct3d12: 80,
  webgpu: 60,
  opengl: 20,
  unknown: 0,
};

function cloneLimits(limits: RenderDeviceLimits): RenderDeviceLimits {
  return { ...limits };
}

function cloneAdapter(adapter: RenderDeviceAdapterDescriptor): RenderDeviceAdapterDescriptor {
  const formats = adapter.formats?.map((format): RenderDeviceFormatSupport => ({
    ...format,
    capabilities: [...format.capabilities],
    ...(format.sampleCounts === undefined ? {} : { sampleCounts: [...format.sampleCounts] }),
  }));
  return {
    ...adapter,
    features: [...adapter.features],
    limits: cloneLimits(adapter.limits),
    queues: adapter.queues.map((queue) => ({ ...queue, capabilities: [...queue.capabilities] })),
    memoryHeaps: adapter.memoryHeaps.map((heap) => ({ ...heap })),
    ...(formats === undefined ? {} : { formats }),
    ...(adapter.presentationSurfaces === undefined
      ? {}
      : { presentationSurfaces: [...adapter.presentationSurfaces] }),
  };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function finiteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
}

function formatLookup(adapter: RenderDeviceAdapterDescriptor): Map<string, RenderDeviceFormatSupport> {
  return new Map((adapter.formats ?? []).map((entry) => [entry.format, entry]));
}

export class RenderDeviceCapabilityRuntime {
  private readonly adapters = new Map<string, RenderDeviceAdapterDescriptor>();
  private readonly watchers = new Set<CapabilityWatcher>();
  private revision = 0;

  registerAdapter(descriptor: RenderDeviceAdapterDescriptor): void {
    this.validateAdapter(descriptor);
    if (this.adapters.has(descriptor.id)) throw new Error(`Render adapter ${descriptor.id} is already registered`);
    this.adapters.set(descriptor.id, cloneAdapter(descriptor));
    this.bumpRevision();
  }

  updateAdapter(id: string, patch: Partial<Omit<RenderDeviceAdapterDescriptor, "id">>): void {
    const existing = this.adapters.get(id);
    if (!existing) throw new Error(`Unknown render adapter ${id}`);
    const formats = patch.formats ?? existing.formats;
    const presentationSurfaces = patch.presentationSurfaces ?? existing.presentationSurfaces;
    const descriptor: RenderDeviceAdapterDescriptor = {
      ...existing,
      ...patch,
      id,
      features: patch.features ?? existing.features,
      limits: patch.limits ?? existing.limits,
      queues: patch.queues ?? existing.queues,
      memoryHeaps: patch.memoryHeaps ?? existing.memoryHeaps,
      ...(formats === undefined ? {} : { formats }),
      ...(presentationSurfaces === undefined ? {} : { presentationSurfaces }),
    };
    this.validateAdapter(descriptor);
    this.adapters.set(id, cloneAdapter(descriptor));
    this.bumpRevision();
  }

  unregisterAdapter(id: string): boolean {
    const deleted = this.adapters.delete(id);
    if (deleted) this.bumpRevision();
    return deleted;
  }

  getAdapter(id: string): RenderDeviceAdapterDescriptor | undefined {
    const adapter = this.adapters.get(id);
    return adapter ? cloneAdapter(adapter) : undefined;
  }

  listAdapters(): RenderDeviceAdapterDescriptor[] {
    return [...this.adapters.values()].map(cloneAdapter);
  }

  snapshot(): RenderDeviceCapabilitySnapshot {
    return {
      revision: this.revision,
      adapterCount: this.adapters.size,
      adapters: this.listAdapters(),
    };
  }

  watch(watcher: CapabilityWatcher): () => void {
    this.watchers.add(watcher);
    watcher(this.snapshot());
    return () => this.watchers.delete(watcher);
  }

  supportsFeature(adapterId: string, feature: RenderDeviceFeature): boolean {
    return this.adapters.get(adapterId)?.features.includes(feature) ?? false;
  }

  supportsFormat(
    adapterId: string,
    format: string,
    capabilities: readonly RenderFormatCapability[] = [],
    sampleCount?: number,
  ): boolean {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) return false;
    const support = formatLookup(adapter).get(format);
    if (!support) return false;
    if (!capabilities.every((capability) => support.capabilities.includes(capability))) return false;
    return sampleCount === undefined || (support.sampleCounts ?? [1]).includes(sampleCount);
  }

  findCompatibleFormats(
    capabilities: readonly RenderFormatCapability[],
    sampleCount = 1,
    adapterId?: string,
  ): string[] {
    const adapters = adapterId ? [this.adapters.get(adapterId)].filter(Boolean) as RenderDeviceAdapterDescriptor[] : [...this.adapters.values()];
    const formats = new Set<string>();
    for (const adapter of adapters) {
      for (const format of adapter.formats ?? []) {
        if (capabilities.every((capability) => format.capabilities.includes(capability))
          && (format.sampleCounts ?? [1]).includes(sampleCount)) {
          formats.add(format.format);
        }
      }
    }
    return [...formats].sort();
  }

  totalMemory(adapterId: string, deviceLocalOnly = false): number {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) return 0;
    return adapter.memoryHeaps
      .filter((heap) => !deviceLocalOnly || heap.deviceLocal)
      .reduce((total, heap) => total + heap.byteSize, 0);
  }

  availableMemory(adapterId: string, deviceLocalOnly = false): number {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) return 0;
    return adapter.memoryHeaps
      .filter((heap) => !deviceLocalOnly || heap.deviceLocal)
      .reduce((total, heap) => {
        const ceiling = heap.budgetBytes ?? heap.byteSize;
        return total + Math.max(0, ceiling - (heap.usageBytes ?? 0));
      }, 0);
  }

  select(requirements: RenderDeviceRequirements = {}): RenderDeviceSelectionResult {
    const candidates: RenderDeviceSelection[] = [];
    const rejected: RenderDeviceRejection[] = [];
    for (const adapter of this.adapters.values()) {
      const reasons = this.rejectionReasons(adapter, requirements);
      if (reasons.length > 0) {
        rejected.push({ adapterId: adapter.id, reasons });
        continue;
      }
      const queues = this.selectQueues(adapter, requirements);
      const required = unique(requirements.requiredFeatures ?? []);
      const optional = unique(requirements.optionalFeatures ?? []);
      const enabledOptional = optional.filter((feature) => adapter.features.includes(feature));
      const warnings: string[] = [];
      if (requirements.preferredBackend && adapter.backend !== requirements.preferredBackend) {
        warnings.push(`Preferred backend ${requirements.preferredBackend} is unavailable on this adapter`);
      }
      if (requirements.preferredDeviceType && adapter.type !== requirements.preferredDeviceType) {
        warnings.push(`Preferred device type ${requirements.preferredDeviceType} is unavailable on this adapter`);
      }
      const unavailableOptionalFeatures = optional.filter((feature) => !adapter.features.includes(feature));
      if (unavailableOptionalFeatures.length > 0) {
        warnings.push(`Optional features unavailable: ${unavailableOptionalFeatures.join(", ")}`);
      }
      candidates.push({
        adapter: cloneAdapter(adapter),
        enabledFeatures: unique([...required, ...enabledOptional]),
        unavailableOptionalFeatures,
        queues,
        score: this.scoreAdapter(adapter, requirements, enabledOptional.length),
        warnings,
      });
    }
    candidates.sort((a, b) => b.score - a.score || a.adapter.name.localeCompare(b.adapter.name));
    return {
      selected: candidates[0] ? this.cloneSelection(candidates[0]) : null,
      candidates: candidates.map((candidate) => this.cloneSelection(candidate)),
      rejected: rejected.map((entry) => ({ adapterId: entry.adapterId, reasons: [...entry.reasons] })),
    };
  }

  compareLimits(adapterId: string, requested: Partial<RenderDeviceLimits>): string[] {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) return [`Unknown render adapter ${adapterId}`];
    return this.limitFailures(adapter, requested);
  }

  clear(): void {
    if (this.adapters.size === 0) return;
    this.adapters.clear();
    this.bumpRevision();
  }

  private rejectionReasons(adapter: RenderDeviceAdapterDescriptor, requirements: RenderDeviceRequirements): string[] {
    const reasons: string[] = [];
    if (adapter.type === "software" && requirements.allowSoftware === false) {
      reasons.push("Software rendering adapters are disabled");
    }
    for (const feature of unique(requirements.requiredFeatures ?? [])) {
      if (!adapter.features.includes(feature)) reasons.push(`Missing required feature ${feature}`);
    }
    reasons.push(...this.limitFailures(adapter, requirements.requiredLimits ?? {}));
    const formats = formatLookup(adapter);
    for (const [formatName, capabilities] of Object.entries(requirements.requiredFormats ?? {})) {
      const support = formats.get(formatName);
      if (!support) {
        reasons.push(`Missing required format ${formatName}`);
        continue;
      }
      for (const capability of capabilities) {
        if (!support.capabilities.includes(capability)) {
          reasons.push(`Format ${formatName} lacks ${capability}`);
        }
      }
    }
    for (const [capability, count] of Object.entries(requirements.requiredQueues ?? {}) as [RenderDeviceQueueCapability, number][]) {
      const available = adapter.queues
        .filter((queue) => queue.capabilities.includes(capability))
        .reduce((total, queue) => total + queue.queueCount, 0);
      if (available < count) reasons.push(`Requires ${count} ${capability} queues, adapter exposes ${available}`);
    }
    if (requirements.presentationSurface
      && !(adapter.presentationSurfaces ?? []).includes(requirements.presentationSurface)) {
      reasons.push(`Presentation surface ${requirements.presentationSurface} is unsupported`);
    }
    if (requirements.minimumDeviceLocalMemoryBytes !== undefined) {
      const memory = adapter.memoryHeaps
        .filter((heap) => heap.deviceLocal)
        .reduce((total, heap) => total + heap.byteSize, 0);
      if (memory < requirements.minimumDeviceLocalMemoryBytes) {
        reasons.push(`Insufficient device-local memory (${memory} < ${requirements.minimumDeviceLocalMemoryBytes})`);
      }
    }
    return reasons;
  }

  private limitFailures(adapter: RenderDeviceAdapterDescriptor, requested: Partial<RenderDeviceLimits>): string[] {
    const failures: string[] = [];
    for (const key of LIMIT_KEYS) {
      const requirement = requested[key];
      if (requirement === undefined) continue;
      const actual = adapter.limits[key];
      const isMinimumAlignment = key.startsWith("minimum");
      const satisfied = isMinimumAlignment ? actual <= requirement : actual >= requirement;
      if (!satisfied) failures.push(`Limit ${key} is ${actual}, requires ${isMinimumAlignment ? "at most" : "at least"} ${requirement}`);
    }
    return failures;
  }

  private selectQueues(adapter: RenderDeviceAdapterDescriptor, requirements: RenderDeviceRequirements): RenderDeviceQueueSelection {
    const selection: RenderDeviceQueueSelection = {};
    const usedByFamily = new Map<number, number>();
    const order: RenderDeviceQueueCapability[] = ["graphics", "present", "compute", "transfer"];
    for (const capability of order) {
      const requiredCount = requirements.requiredQueues?.[capability] ?? (capability === "graphics" ? 1 : 0);
      if (requiredCount < 1 && capability !== "present") continue;
      const candidates = adapter.queues
        .filter((family) => family.capabilities.includes(capability))
        .sort((a, b) => {
          const aExtra = a.capabilities.length - 1;
          const bExtra = b.capabilities.length - 1;
          if (capability === "graphics" || capability === "present") return b.capabilities.length - a.capabilities.length;
          return aExtra - bExtra;
        });
      const family = candidates.find((candidate) => (usedByFamily.get(candidate.index) ?? 0) < candidate.queueCount) ?? candidates[0];
      if (!family) continue;
      const nextIndex = Math.min(usedByFamily.get(family.index) ?? 0, family.queueCount - 1);
      selection[capability] = { familyIndex: family.index, queueIndex: nextIndex };
      usedByFamily.set(family.index, nextIndex + 1);
    }
    return selection;
  }

  private scoreAdapter(
    adapter: RenderDeviceAdapterDescriptor,
    requirements: RenderDeviceRequirements,
    optionalFeatureCount: number,
  ): number {
    let score = DEVICE_TYPE_SCORE[adapter.type] + BACKEND_SCORE[adapter.backend];
    if (requirements.preferredBackend === adapter.backend) score += 300;
    if (requirements.preferredDeviceType === adapter.type) score += 250;
    score += optionalFeatureCount * 20;
    const localMemory = adapter.memoryHeaps
      .filter((heap) => heap.deviceLocal)
      .reduce((total, heap) => total + Math.min(heap.budgetBytes ?? heap.byteSize, heap.byteSize), 0);
    score += Math.min(200, Math.log2(Math.max(1, localMemory / (1024 * 1024))) * 10);
    const dedicatedCompute = adapter.queues.some((queue) => queue.capabilities.length === 1 && queue.capabilities[0] === "compute");
    const dedicatedTransfer = adapter.queues.some((queue) => queue.capabilities.length === 1 && queue.capabilities[0] === "transfer");
    if (dedicatedCompute) score += 25;
    if (dedicatedTransfer) score += 15;
    return score;
  }

  private validateAdapter(adapter: RenderDeviceAdapterDescriptor): void {
    if (!adapter.id) throw new Error("Render adapter id cannot be empty");
    if (!adapter.name) throw new Error(`Render adapter ${adapter.id} name cannot be empty`);
    for (const key of LIMIT_KEYS) finiteNonNegative(adapter.limits[key], `adapter ${adapter.id} limit ${key}`);
    const queueIndices = new Set<number>();
    for (const queue of adapter.queues) {
      if (!Number.isInteger(queue.index) || queue.index < 0) throw new Error(`Adapter ${adapter.id} has invalid queue family index`);
      if (queueIndices.has(queue.index)) throw new Error(`Adapter ${adapter.id} duplicates queue family ${queue.index}`);
      queueIndices.add(queue.index);
      if (!Number.isInteger(queue.queueCount) || queue.queueCount < 1) throw new Error(`Adapter ${adapter.id} queue family ${queue.index} is empty`);
      if (queue.capabilities.length === 0) throw new Error(`Adapter ${adapter.id} queue family ${queue.index} has no capabilities`);
    }
    const heapIndices = new Set<number>();
    for (const heap of adapter.memoryHeaps) {
      if (!Number.isInteger(heap.index) || heap.index < 0) throw new Error(`Adapter ${adapter.id} has invalid memory heap index`);
      if (heapIndices.has(heap.index)) throw new Error(`Adapter ${adapter.id} duplicates memory heap ${heap.index}`);
      heapIndices.add(heap.index);
      finiteNonNegative(heap.byteSize, `adapter ${adapter.id} memory heap size`);
      if (heap.byteSize === 0) throw new Error(`Adapter ${adapter.id} memory heap ${heap.index} is empty`);
      if (heap.budgetBytes !== undefined) finiteNonNegative(heap.budgetBytes, `adapter ${adapter.id} heap budget`);
      if (heap.usageBytes !== undefined) finiteNonNegative(heap.usageBytes, `adapter ${adapter.id} heap usage`);
    }
    const formatNames = new Set<string>();
    for (const format of adapter.formats ?? []) {
      if (!format.format) throw new Error(`Adapter ${adapter.id} has an empty format name`);
      if (formatNames.has(format.format)) throw new Error(`Adapter ${adapter.id} duplicates format ${format.format}`);
      formatNames.add(format.format);
      for (const sampleCount of format.sampleCounts ?? [1]) {
        if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error(`Format ${format.format} has invalid sample count`);
      }
    }
  }

  private cloneSelection(selection: RenderDeviceSelection): RenderDeviceSelection {
    return {
      adapter: cloneAdapter(selection.adapter),
      enabledFeatures: [...selection.enabledFeatures],
      unavailableOptionalFeatures: [...selection.unavailableOptionalFeatures],
      queues: Object.fromEntries(Object.entries(selection.queues).map(([key, value]) => [key, value ? { ...value } : undefined])),
      score: selection.score,
      warnings: [...selection.warnings],
    };
  }

  private bumpRevision(): void {
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}
