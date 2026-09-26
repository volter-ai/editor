export type RenderSamplerFilter = "nearest" | "linear";
export type RenderSamplerMipmapMode = "nearest" | "linear";
export type RenderSamplerAddressMode = "repeat" | "mirrored_repeat" | "clamp_to_edge" | "clamp_to_border" | "mirror_clamp_to_edge";
export type RenderSamplerCompareOperation = "never" | "less" | "equal" | "less_equal" | "greater" | "not_equal" | "greater_equal" | "always";
export type RenderSamplerBorderColor = "transparent_black" | "opaque_black" | "opaque_white" | "custom";

export interface RenderSamplerDescriptor {
  minimumFilter?: RenderSamplerFilter;
  magnificationFilter?: RenderSamplerFilter;
  mipmapMode?: RenderSamplerMipmapMode;
  addressU?: RenderSamplerAddressMode;
  addressV?: RenderSamplerAddressMode;
  addressW?: RenderSamplerAddressMode;
  mipLodBias?: number;
  anisotropy?: number;
  compareEnabled?: boolean;
  compareOperation?: RenderSamplerCompareOperation;
  minimumLod?: number;
  maximumLod?: number;
  borderColor?: RenderSamplerBorderColor;
  customBorderColor?: readonly [number, number, number, number];
  unnormalizedCoordinates?: boolean;
}

export interface RenderSamplerDeviceLimits {
  maximumAnisotropy: number;
  maximumLodBias: number;
  supportsAnisotropy?: boolean;
  supportsMirrorClamp?: boolean;
  supportsCustomBorderColor?: boolean;
  supportsUnnormalizedCoordinates?: boolean;
}

export interface RenderSamplerBackendHandle {
  id: string;
}

export interface RenderSamplerBackend {
  create(descriptor: Required<RenderSamplerDescriptor>): RenderSamplerBackendHandle | Promise<RenderSamplerBackendHandle>;
  destroy(handle: RenderSamplerBackendHandle): void | Promise<void>;
}

export interface RenderSamplerLease {
  id: string;
  key: string;
  descriptor: Required<RenderSamplerDescriptor>;
  handle: RenderSamplerBackendHandle;
  emulatesCustomBorder: boolean;
  emulatesMirrorClamp: boolean;
  release(): Promise<void>;
}

export interface RenderSamplerCacheOptions {
  maximumEntries?: number;
  maximumIdleFrames?: number;
}

export interface RenderSamplerCacheSnapshot {
  frame: number;
  generation: number;
  entryCount: number;
  referencedEntries: number;
  totalReferences: number;
  createdSamplers: number;
  destroyedSamplers: number;
}

type RenderSamplerWatcher = (snapshot: RenderSamplerCacheSnapshot) => void;

interface SamplerEntry {
  id: string;
  key: string;
  descriptor: Required<RenderSamplerDescriptor>;
  handle: RenderSamplerBackendHandle;
  emulatesCustomBorder: boolean;
  emulatesMirrorClamp: boolean;
  references: number;
  lastUsedFrame: number;
  generation: number;
}

const DEFAULT_MAXIMUM_ENTRIES = 1024;
const DEFAULT_MAXIMUM_IDLE_FRAMES = 300;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function stableKey(descriptor: Required<RenderSamplerDescriptor>): string {
  return [
    descriptor.minimumFilter,
    descriptor.magnificationFilter,
    descriptor.mipmapMode,
    descriptor.addressU,
    descriptor.addressV,
    descriptor.addressW,
    descriptor.mipLodBias,
    descriptor.anisotropy,
    descriptor.compareEnabled,
    descriptor.compareOperation,
    descriptor.minimumLod,
    descriptor.maximumLod,
    descriptor.borderColor,
    descriptor.customBorderColor.join(","),
    descriptor.unnormalizedCoordinates,
  ].join("|");
}

export class RenderSamplerCacheRuntime {
  private readonly entries = new Map<string, SamplerEntry>();
  private readonly watchers = new Set<RenderSamplerWatcher>();
  private readonly maximumEntries: number;
  private readonly maximumIdleFrames: number;
  private frame = 0;
  private generation = 1;
  private nextId = 1;
  private createdSamplers = 0;
  private destroyedSamplers = 0;

  constructor(
    private readonly backend: RenderSamplerBackend,
    private limits: RenderSamplerDeviceLimits,
    options: RenderSamplerCacheOptions = {},
  ) {
    this.maximumEntries = options.maximumEntries ?? DEFAULT_MAXIMUM_ENTRIES;
    this.maximumIdleFrames = options.maximumIdleFrames ?? DEFAULT_MAXIMUM_IDLE_FRAMES;
    if (!Number.isInteger(this.maximumEntries) || this.maximumEntries < 1) throw new Error("maximumEntries must be positive");
    if (!Number.isInteger(this.maximumIdleFrames) || this.maximumIdleFrames < 0) throw new Error("maximumIdleFrames must be non-negative");
    this.validateLimits(limits);
  }

  normalize(descriptor: RenderSamplerDescriptor = {}): {
    descriptor: Required<RenderSamplerDescriptor>;
    emulatesCustomBorder: boolean;
    emulatesMirrorClamp: boolean;
  } {
    const requestedBorder = descriptor.borderColor ?? "transparent_black";
    const requestedAddressU = descriptor.addressU ?? "repeat";
    const requestedAddressV = descriptor.addressV ?? "repeat";
    const requestedAddressW = descriptor.addressW ?? "repeat";
    const emulatesMirrorClamp = !this.limits.supportsMirrorClamp
      && [requestedAddressU, requestedAddressV, requestedAddressW].includes("mirror_clamp_to_edge");
    const emulatesCustomBorder = requestedBorder === "custom" && !this.limits.supportsCustomBorderColor;
    const anisotropySupported = this.limits.supportsAnisotropy !== false;
    const compareEnabled = descriptor.compareEnabled ?? false;
    const unnormalizedCoordinates = Boolean(descriptor.unnormalizedCoordinates && this.limits.supportsUnnormalizedCoordinates);
    const normalized: Required<RenderSamplerDescriptor> = {
      minimumFilter: descriptor.minimumFilter ?? "linear",
      magnificationFilter: descriptor.magnificationFilter ?? "linear",
      mipmapMode: unnormalizedCoordinates ? "nearest" : descriptor.mipmapMode ?? "linear",
      addressU: emulatesMirrorClamp && requestedAddressU === "mirror_clamp_to_edge" ? "clamp_to_edge" : requestedAddressU,
      addressV: emulatesMirrorClamp && requestedAddressV === "mirror_clamp_to_edge" ? "clamp_to_edge" : requestedAddressV,
      addressW: emulatesMirrorClamp && requestedAddressW === "mirror_clamp_to_edge" ? "clamp_to_edge" : requestedAddressW,
      mipLodBias: unnormalizedCoordinates ? 0 : clamp(descriptor.mipLodBias ?? 0, -this.limits.maximumLodBias, this.limits.maximumLodBias),
      anisotropy: unnormalizedCoordinates || !anisotropySupported ? 1 : clamp(descriptor.anisotropy ?? 1, 1, this.limits.maximumAnisotropy),
      compareEnabled,
      compareOperation: compareEnabled ? descriptor.compareOperation ?? "less_equal" : "always",
      minimumLod: unnormalizedCoordinates ? 0 : Math.max(0, descriptor.minimumLod ?? 0),
      maximumLod: unnormalizedCoordinates ? 0 : Math.max(descriptor.minimumLod ?? 0, descriptor.maximumLod ?? 1000),
      borderColor: emulatesCustomBorder ? "transparent_black" : requestedBorder,
      customBorderColor: descriptor.customBorderColor ? [...descriptor.customBorderColor] : [0, 0, 0, 0],
      unnormalizedCoordinates,
    };
    if (unnormalizedCoordinates) {
      normalized.minimumFilter = normalized.magnificationFilter;
      normalized.addressU = "clamp_to_edge";
      normalized.addressV = "clamp_to_edge";
      normalized.addressW = "clamp_to_edge";
    }
    return { descriptor: normalized, emulatesCustomBorder, emulatesMirrorClamp };
  }

  async acquire(descriptor: RenderSamplerDescriptor = {}): Promise<RenderSamplerLease> {
    const normalized = this.normalize(descriptor);
    const key = stableKey(normalized.descriptor);
    let entry = this.entries.get(key);
    if (!entry || entry.generation !== this.generation) {
      const handle = await this.backend.create({ ...normalized.descriptor, customBorderColor: [...normalized.descriptor.customBorderColor] });
      entry = {
        id: `sampler_${this.nextId++}`,
        key,
        descriptor: normalized.descriptor,
        handle: { ...handle },
        emulatesCustomBorder: normalized.emulatesCustomBorder,
        emulatesMirrorClamp: normalized.emulatesMirrorClamp,
        references: 0,
        lastUsedFrame: this.frame,
        generation: this.generation,
      };
      this.entries.set(key, entry);
      this.createdSamplers += 1;
    }
    entry.references += 1;
    entry.lastUsedFrame = this.frame;
    let released = false;
    const entryId = entry.id;
    this.notify();
    await this.enforceLimit(key);
    return {
      id: entry.id,
      key,
      descriptor: { ...entry.descriptor, customBorderColor: [...entry.descriptor.customBorderColor] },
      handle: { ...entry.handle },
      emulatesCustomBorder: entry.emulatesCustomBorder,
      emulatesMirrorClamp: entry.emulatesMirrorClamp,
      release: async () => {
        if (released) return;
        released = true;
        const current = this.entries.get(key);
        if (current?.id === entryId) {
          current.references = Math.max(0, current.references - 1);
          current.lastUsedFrame = this.frame;
          this.notify();
        }
      },
    };
  }

  has(descriptor: RenderSamplerDescriptor): boolean {
    return this.entries.has(stableKey(this.normalize(descriptor).descriptor));
  }

  async beginFrame(frame?: number): Promise<void> {
    this.frame = frame ?? this.frame + 1;
    if (!Number.isInteger(this.frame) || this.frame < 0) throw new Error("Sampler cache frame must be non-negative");
    const stale = [...this.entries.values()]
      .filter((entry) => entry.references === 0 && this.frame - entry.lastUsedFrame > this.maximumIdleFrames);
    for (const entry of stale) await this.destroyEntry(entry);
    await this.enforceLimit();
    this.notify();
  }

  async updateDeviceLimits(limits: RenderSamplerDeviceLimits): Promise<void> {
    this.validateLimits(limits);
    this.limits = { ...limits };
    await this.invalidateDevice();
  }

  async invalidateDevice(): Promise<void> {
    this.generation += 1;
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      await this.backend.destroy({ ...entry.handle });
      this.destroyedSamplers += 1;
    }
    this.notify();
  }

  snapshot(): RenderSamplerCacheSnapshot {
    const entries = [...this.entries.values()];
    return {
      frame: this.frame,
      generation: this.generation,
      entryCount: entries.length,
      referencedEntries: entries.filter((entry) => entry.references > 0).length,
      totalReferences: entries.reduce((total, entry) => total + entry.references, 0),
      createdSamplers: this.createdSamplers,
      destroyedSamplers: this.destroyedSamplers,
    };
  }

  watch(watcher: RenderSamplerWatcher): () => void {
    this.watchers.add(watcher);
    watcher(this.snapshot());
    return () => this.watchers.delete(watcher);
  }

  async clear(): Promise<void> {
    await this.invalidateDevice();
  }

  private async enforceLimit(protectedKey?: string): Promise<void> {
    if (this.entries.size <= this.maximumEntries) return;
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.key !== protectedKey && entry.references === 0)
      .sort((a, b) => a.lastUsedFrame - b.lastUsedFrame);
    for (const entry of candidates) {
      await this.destroyEntry(entry);
      if (this.entries.size <= this.maximumEntries) break;
    }
  }

  private async destroyEntry(entry: SamplerEntry): Promise<void> {
    if (this.entries.get(entry.key)?.id !== entry.id || entry.references > 0) return;
    this.entries.delete(entry.key);
    await this.backend.destroy({ ...entry.handle });
    this.destroyedSamplers += 1;
  }

  private validateLimits(limits: RenderSamplerDeviceLimits): void {
    if (!Number.isFinite(limits.maximumAnisotropy) || limits.maximumAnisotropy < 1) {
      throw new Error("maximumAnisotropy must be at least one");
    }
    if (!Number.isFinite(limits.maximumLodBias) || limits.maximumLodBias < 0) {
      throw new Error("maximumLodBias must be non-negative");
    }
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}
