export interface VirtualTextureDescriptor {
  id: string;
  width: number;
  height: number;
  mipCount: number;
  pageSize: number;
  borderSize?: number;
  arrayLayers?: number;
  format: string;
  fallbackMip?: number;
}

export interface VirtualTexturePageAddress {
  textureId: string;
  mip: number;
  x: number;
  y: number;
  layer: number;
}

export interface VirtualTextureFeedbackSample extends VirtualTexturePageAddress {
  weight?: number;
  screenCoverage?: number;
}

export interface VirtualTexturePhysicalPage {
  index: number;
  atlasX: number;
  atlasY: number;
  atlasLayer: number;
}

export type VirtualTexturePageState = "requested" | "loading" | "resident" | "evicting" | "failed";

export interface VirtualTexturePageRecord {
  key: string;
  address: VirtualTexturePageAddress;
  state: VirtualTexturePageState;
  physicalPage: VirtualTexturePhysicalPage | null;
  priority: number;
  requestCount: number;
  firstRequestedFrame: number;
  lastRequestedFrame: number;
  lastUsedFrame: number;
  residentFrame: number | null;
  pinned: boolean;
  error: string | null;
}

export interface VirtualTexturePagePayload {
  data: Uint8Array;
  rowBytes?: number;
}

export interface VirtualTextureFeedbackBackend {
  loadPage(address: VirtualTexturePageAddress, descriptor: VirtualTextureDescriptor): VirtualTexturePagePayload | Promise<VirtualTexturePagePayload>;
  uploadPage(
    physicalPage: VirtualTexturePhysicalPage,
    payload: VirtualTexturePagePayload,
    address: VirtualTexturePageAddress,
    descriptor: VirtualTextureDescriptor,
  ): void | Promise<void>;
  updatePageTable(
    address: VirtualTexturePageAddress,
    physicalPage: VirtualTexturePhysicalPage | null,
    descriptor: VirtualTextureDescriptor,
  ): void | Promise<void>;
  clearPhysicalPage?(physicalPage: VirtualTexturePhysicalPage): void | Promise<void>;
}

export interface VirtualTextureFeedbackRuntimeOptions {
  atlasPagesX: number;
  atlasPagesY: number;
  atlasLayers?: number;
  maximumUploadsPerFrame?: number;
  maximumLoadsInFlight?: number;
  feedbackLatencyFrames?: number;
  evictionGraceFrames?: number;
  requestDecay?: number;
}

export interface VirtualTextureFeedbackPacket {
  frame: number;
  samples: readonly VirtualTextureFeedbackSample[];
}

export interface VirtualTextureFeedbackSnapshot {
  frame: number;
  textureCount: number;
  physicalPageCount: number;
  freePageCount: number;
  requestedPageCount: number;
  loadingPageCount: number;
  residentPageCount: number;
  failedPageCount: number;
  queuedFeedbackPackets: number;
  totalUploads: number;
  totalEvictions: number;
  feedbackSamples: number;
}

type VirtualTextureFeedbackWatcher = (snapshot: VirtualTextureFeedbackSnapshot) => void;

interface InternalPage extends VirtualTexturePageRecord {
  generation: number;
}

const DEFAULT_UPLOADS_PER_FRAME = 8;
const DEFAULT_LOADS_IN_FLIGHT = 16;
const DEFAULT_FEEDBACK_LATENCY = 2;
const DEFAULT_EVICTION_GRACE = 4;
const DEFAULT_REQUEST_DECAY = 0.85;

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

function cloneAddress(address: VirtualTexturePageAddress): VirtualTexturePageAddress {
  return { ...address };
}

function clonePhysicalPage(page: VirtualTexturePhysicalPage): VirtualTexturePhysicalPage {
  return { ...page };
}

function cloneRecord(record: VirtualTexturePageRecord): VirtualTexturePageRecord {
  return {
    ...record,
    address: cloneAddress(record.address),
    physicalPage: record.physicalPage ? clonePhysicalPage(record.physicalPage) : null,
  };
}

function addressKey(address: VirtualTexturePageAddress): string {
  return `${address.textureId}:${address.layer}:${address.mip}:${address.x}:${address.y}`;
}

export class VirtualTextureFeedbackRuntime {
  private readonly textures = new Map<string, VirtualTextureDescriptor>();
  private readonly pages = new Map<string, InternalPage>();
  private readonly physicalPages: VirtualTexturePhysicalPage[] = [];
  private readonly freePhysicalPages: VirtualTexturePhysicalPage[] = [];
  private readonly feedbackPackets: VirtualTextureFeedbackPacket[] = [];
  private readonly watchers = new Set<VirtualTextureFeedbackWatcher>();
  private readonly maximumUploadsPerFrame: number;
  private readonly maximumLoadsInFlight: number;
  private readonly feedbackLatencyFrames: number;
  private readonly evictionGraceFrames: number;
  private readonly requestDecay: number;
  private frame = 0;
  private loadsInFlight = 0;
  private uploadsThisFrame = 0;
  private totalUploads = 0;
  private totalEvictions = 0;
  private feedbackSamples = 0;

  constructor(
    private readonly backend: VirtualTextureFeedbackBackend,
    options: VirtualTextureFeedbackRuntimeOptions,
  ) {
    positiveInteger(options.atlasPagesX, "atlasPagesX");
    positiveInteger(options.atlasPagesY, "atlasPagesY");
    const layers = options.atlasLayers ?? 1;
    positiveInteger(layers, "atlasLayers");
    this.maximumUploadsPerFrame = options.maximumUploadsPerFrame ?? DEFAULT_UPLOADS_PER_FRAME;
    this.maximumLoadsInFlight = options.maximumLoadsInFlight ?? DEFAULT_LOADS_IN_FLIGHT;
    this.feedbackLatencyFrames = options.feedbackLatencyFrames ?? DEFAULT_FEEDBACK_LATENCY;
    this.evictionGraceFrames = options.evictionGraceFrames ?? DEFAULT_EVICTION_GRACE;
    this.requestDecay = options.requestDecay ?? DEFAULT_REQUEST_DECAY;
    positiveInteger(this.maximumUploadsPerFrame, "maximumUploadsPerFrame");
    positiveInteger(this.maximumLoadsInFlight, "maximumLoadsInFlight");
    if (!Number.isInteger(this.feedbackLatencyFrames) || this.feedbackLatencyFrames < 0) {
      throw new Error("feedbackLatencyFrames must be a non-negative integer");
    }
    if (!Number.isFinite(this.requestDecay) || this.requestDecay < 0 || this.requestDecay > 1) {
      throw new Error("requestDecay must be between zero and one");
    }
    let index = 0;
    for (let layer = 0; layer < layers; layer += 1) {
      for (let y = 0; y < options.atlasPagesY; y += 1) {
        for (let x = 0; x < options.atlasPagesX; x += 1) {
          const page = { index: index++, atlasX: x, atlasY: y, atlasLayer: layer };
          this.physicalPages.push(page);
          this.freePhysicalPages.push(page);
        }
      }
    }
  }

  registerTexture(descriptor: VirtualTextureDescriptor): void {
    this.validateDescriptor(descriptor);
    if (this.textures.has(descriptor.id)) throw new Error(`Virtual texture ${descriptor.id} is already registered`);
    this.textures.set(descriptor.id, { ...descriptor });
    this.notify();
  }

  async unregisterTexture(id: string): Promise<boolean> {
    if (!this.textures.has(id)) return false;
    const keys = [...this.pages.values()].filter((page) => page.address.textureId === id).map((page) => page.key);
    for (const key of keys) await this.removePage(key);
    this.textures.delete(id);
    this.notify();
    return true;
  }

  getTexture(id: string): VirtualTextureDescriptor | undefined {
    const descriptor = this.textures.get(id);
    return descriptor ? { ...descriptor } : undefined;
  }

  listTextures(): VirtualTextureDescriptor[] {
    return [...this.textures.values()].map((descriptor) => ({ ...descriptor }));
  }

  submitFeedback(packet: VirtualTextureFeedbackPacket): void {
    if (!Number.isInteger(packet.frame) || packet.frame < 0) throw new Error("Feedback frame must be a non-negative integer");
    const samples = packet.samples.map((sample) => {
      this.validateAddress(sample);
      return { ...sample };
    });
    this.feedbackPackets.push({ frame: packet.frame, samples });
    this.feedbackPackets.sort((a, b) => a.frame - b.frame);
    this.feedbackSamples += samples.length;
    this.notify();
  }

  submitPackedFeedback(
    textureId: string,
    packed: Uint32Array,
    decode: (value: number, textureId: string) => VirtualTextureFeedbackSample | null,
    frame = this.frame,
  ): void {
    const samples: VirtualTextureFeedbackSample[] = [];
    for (const value of packed) {
      const sample = decode(value, textureId);
      if (sample) samples.push(sample);
    }
    this.submitFeedback({ frame, samples });
  }

  requestPage(address: VirtualTexturePageAddress, weight = 1, pin = false): VirtualTexturePageRecord {
    this.validateAddress(address);
    if (!Number.isFinite(weight) || weight < 0) throw new Error("Virtual texture page request weight must be non-negative");
    const key = addressKey(address);
    let page = this.pages.get(key);
    if (!page) {
      page = {
        key,
        address: cloneAddress(address),
        state: "requested",
        physicalPage: null,
        priority: this.basePriority(address) + weight,
        requestCount: 1,
        firstRequestedFrame: this.frame,
        lastRequestedFrame: this.frame,
        lastUsedFrame: this.frame,
        residentFrame: null,
        pinned: pin,
        error: null,
        generation: 0,
      };
      this.pages.set(key, page);
    } else {
      page.priority += weight;
      page.requestCount += 1;
      page.lastRequestedFrame = this.frame;
      page.lastUsedFrame = this.frame;
      page.pinned ||= pin;
      if (page.state === "failed") {
        page.state = "requested";
        page.error = null;
      }
    }
    this.notify();
    void this.pumpLoads();
    return cloneRecord(page);
  }

  pinPage(address: VirtualTexturePageAddress, pinned = true): boolean {
    const page = this.pages.get(addressKey(address));
    if (!page) return false;
    page.pinned = pinned;
    page.lastUsedFrame = this.frame;
    this.notify();
    return true;
  }

  touchPage(address: VirtualTexturePageAddress): boolean {
    const page = this.pages.get(addressKey(address));
    if (!page) return false;
    page.lastUsedFrame = this.frame;
    page.priority += 1;
    return true;
  }

  getPage(address: VirtualTexturePageAddress): VirtualTexturePageRecord | undefined {
    const page = this.pages.get(addressKey(address));
    return page ? cloneRecord(page) : undefined;
  }

  listPages(state?: VirtualTexturePageState): VirtualTexturePageRecord[] {
    return [...this.pages.values()].filter((page) => !state || page.state === state).map(cloneRecord);
  }

  async beginFrame(frame?: number): Promise<void> {
    this.frame = frame ?? this.frame + 1;
    if (!Number.isInteger(this.frame) || this.frame < 0) throw new Error("Virtual texture frame must be non-negative");
    this.uploadsThisFrame = 0;
    this.consumeFeedback();
    for (const page of this.pages.values()) {
      if (!page.pinned && page.lastRequestedFrame < this.frame) page.priority *= this.requestDecay;
    }
    await this.ensureFallbackMips();
    void this.pumpLoads();
    this.notify();
  }

  async evictUnused(maximumIdleFrames: number): Promise<string[]> {
    if (!Number.isInteger(maximumIdleFrames) || maximumIdleFrames < 0) {
      throw new Error("maximumIdleFrames must be a non-negative integer");
    }
    const candidates = [...this.pages.values()]
      .filter((page) => page.state === "resident" && !page.pinned && this.frame - page.lastUsedFrame > maximumIdleFrames)
      .sort((a, b) => a.lastUsedFrame - b.lastUsedFrame || a.priority - b.priority);
    const evicted: string[] = [];
    for (const page of candidates) {
      if (await this.evictPage(page)) evicted.push(page.key);
    }
    return evicted;
  }

  snapshot(): VirtualTextureFeedbackSnapshot {
    const pages = [...this.pages.values()];
    return {
      frame: this.frame,
      textureCount: this.textures.size,
      physicalPageCount: this.physicalPages.length,
      freePageCount: this.freePhysicalPages.length,
      requestedPageCount: pages.filter((page) => page.state === "requested").length,
      loadingPageCount: pages.filter((page) => page.state === "loading").length,
      residentPageCount: pages.filter((page) => page.state === "resident").length,
      failedPageCount: pages.filter((page) => page.state === "failed").length,
      queuedFeedbackPackets: this.feedbackPackets.length,
      totalUploads: this.totalUploads,
      totalEvictions: this.totalEvictions,
      feedbackSamples: this.feedbackSamples,
    };
  }

  watch(watcher: VirtualTextureFeedbackWatcher): () => void {
    this.watchers.add(watcher);
    watcher(this.snapshot());
    return () => this.watchers.delete(watcher);
  }

  async clear(): Promise<void> {
    for (const key of [...this.pages.keys()]) await this.removePage(key);
    this.feedbackPackets.length = 0;
    this.textures.clear();
    this.notify();
  }

  private consumeFeedback(): void {
    const readyFrame = this.frame - this.feedbackLatencyFrames;
    while (this.feedbackPackets.length > 0) {
      const first = this.feedbackPackets[0];
      if (first === undefined || first.frame > readyFrame) break;
      const packet = this.feedbackPackets.shift()!;
      const consolidated = new Map<string, VirtualTextureFeedbackSample>();
      for (const sample of packet.samples) {
        const key = addressKey(sample);
        const existing = consolidated.get(key);
        if (existing) {
          existing.weight = (existing.weight ?? 1) + (sample.weight ?? 1);
          existing.screenCoverage = Math.max(existing.screenCoverage ?? 0, sample.screenCoverage ?? 0);
        } else {
          consolidated.set(key, { ...sample });
        }
      }
      for (const sample of consolidated.values()) {
        const weight = (sample.weight ?? 1) * (1 + (sample.screenCoverage ?? 0));
        this.requestPage(sample, weight);
      }
    }
  }

  private async ensureFallbackMips(): Promise<void> {
    for (const texture of this.textures.values()) {
      const fallbackMip = Math.min(texture.mipCount - 1, texture.fallbackMip ?? texture.mipCount - 1);
      const pagesX = Math.ceil(Math.max(1, texture.width >> fallbackMip) / texture.pageSize);
      const pagesY = Math.ceil(Math.max(1, texture.height >> fallbackMip) / texture.pageSize);
      for (let layer = 0; layer < (texture.arrayLayers ?? 1); layer += 1) {
        for (let y = 0; y < pagesY; y += 1) {
          for (let x = 0; x < pagesX; x += 1) {
            const address = { textureId: texture.id, mip: fallbackMip, x, y, layer };
            const page = this.pages.get(addressKey(address));
            if (!page) this.requestPage(address, 1000, true);
            else page.pinned = true;
          }
        }
      }
    }
  }

  private async pumpLoads(): Promise<void> {
    while (this.loadsInFlight < this.maximumLoadsInFlight && this.uploadsThisFrame < this.maximumUploadsPerFrame) {
      const page = this.nextRequestedPage();
      if (!page) break;
      const physicalPage = await this.acquirePhysicalPage();
      if (!physicalPage) break;
      page.state = "loading";
      page.physicalPage = physicalPage;
      page.generation += 1;
      const generation = page.generation;
      this.loadsInFlight += 1;
      this.uploadsThisFrame += 1;
      void this.loadPage(page, generation).finally(() => {
        this.loadsInFlight -= 1;
        this.notify();
        void this.pumpLoads();
      });
    }
  }

  private nextRequestedPage(): InternalPage | null {
    const pages = [...this.pages.values()]
      .filter((page) => page.state === "requested")
      .sort((a, b) => b.priority - a.priority || a.firstRequestedFrame - b.firstRequestedFrame || a.key.localeCompare(b.key));
    return pages[0] ?? null;
  }

  private async acquirePhysicalPage(): Promise<VirtualTexturePhysicalPage | null> {
    const free = this.freePhysicalPages.pop();
    if (free) return free;
    const candidate = [...this.pages.values()]
      .filter((page) => page.state === "resident" && !page.pinned && this.frame - page.lastUsedFrame >= this.evictionGraceFrames)
      .sort((a, b) => a.priority - b.priority || a.lastUsedFrame - b.lastUsedFrame)[0];
    if (!candidate || !candidate.physicalPage) return null;
    const physicalPage = clonePhysicalPage(candidate.physicalPage);
    await this.evictPage(candidate, false);
    const reclaimedIndex = this.freePhysicalPages.findIndex((page) => page.index === physicalPage.index);
    if (reclaimedIndex >= 0) this.freePhysicalPages.splice(reclaimedIndex, 1);
    return physicalPage;
  }

  private async loadPage(page: InternalPage, generation: number): Promise<void> {
    const descriptor = this.textures.get(page.address.textureId);
    const physicalPage = page.physicalPage;
    if (!descriptor || !physicalPage) return;
    try {
      const payload = await this.backend.loadPage(cloneAddress(page.address), { ...descriptor });
      if (page.generation !== generation || page.state !== "loading" || !page.physicalPage) return;
      await this.backend.uploadPage(clonePhysicalPage(page.physicalPage), { ...payload, data: payload.data.slice() }, cloneAddress(page.address), { ...descriptor });
      if (page.generation !== generation || page.state !== "loading" || !page.physicalPage) return;
      await this.backend.updatePageTable(cloneAddress(page.address), clonePhysicalPage(page.physicalPage), { ...descriptor });
      page.state = "resident";
      page.residentFrame = this.frame;
      page.lastUsedFrame = this.frame;
      page.error = null;
      this.totalUploads += 1;
    } catch (error) {
      if (page.generation !== generation) return;
      page.state = "failed";
      page.error = error instanceof Error ? error.message : String(error);
      if (page.physicalPage) this.freePhysicalPages.push(page.physicalPage);
      page.physicalPage = null;
    }
  }

  private async evictPage(page: InternalPage, returnToFreeList = true): Promise<boolean> {
    if (page.state !== "resident" || !page.physicalPage || page.pinned) return false;
    page.state = "evicting";
    page.generation += 1;
    const descriptor = this.textures.get(page.address.textureId);
    const physicalPage = page.physicalPage;
    if (descriptor) await this.backend.updatePageTable(cloneAddress(page.address), null, { ...descriptor });
    await this.backend.clearPhysicalPage?.(clonePhysicalPage(physicalPage));
    page.physicalPage = null;
    page.state = "requested";
    page.residentFrame = null;
    page.priority *= this.requestDecay;
    if (returnToFreeList) this.freePhysicalPages.push(physicalPage);
    this.totalEvictions += 1;
    this.notify();
    return true;
  }

  private async removePage(key: string): Promise<boolean> {
    const page = this.pages.get(key);
    if (!page) return false;
    page.generation += 1;
    const descriptor = this.textures.get(page.address.textureId);
    if (page.physicalPage) {
      if (descriptor && page.state === "resident") {
        await this.backend.updatePageTable(cloneAddress(page.address), null, { ...descriptor });
      }
      await this.backend.clearPhysicalPage?.(clonePhysicalPage(page.physicalPage));
      this.freePhysicalPages.push(page.physicalPage);
    }
    this.pages.delete(key);
    return true;
  }

  private basePriority(address: VirtualTexturePageAddress): number {
    const descriptor = this.textures.get(address.textureId)!;
    return (descriptor.mipCount - address.mip) * 10;
  }

  private validateDescriptor(descriptor: VirtualTextureDescriptor): void {
    if (!descriptor.id) throw new Error("Virtual texture id cannot be empty");
    positiveInteger(descriptor.width, `virtual texture ${descriptor.id} width`);
    positiveInteger(descriptor.height, `virtual texture ${descriptor.id} height`);
    positiveInteger(descriptor.mipCount, `virtual texture ${descriptor.id} mipCount`);
    positiveInteger(descriptor.pageSize, `virtual texture ${descriptor.id} pageSize`);
    positiveInteger(descriptor.arrayLayers ?? 1, `virtual texture ${descriptor.id} arrayLayers`);
    if (!descriptor.format) throw new Error(`Virtual texture ${descriptor.id} format cannot be empty`);
    if (!Number.isInteger(descriptor.borderSize ?? 0) || (descriptor.borderSize ?? 0) < 0) {
      throw new Error(`Virtual texture ${descriptor.id} borderSize must be non-negative`);
    }
    if (descriptor.fallbackMip !== undefined
      && (!Number.isInteger(descriptor.fallbackMip) || descriptor.fallbackMip < 0 || descriptor.fallbackMip >= descriptor.mipCount)) {
      throw new Error(`Virtual texture ${descriptor.id} fallbackMip is out of range`);
    }
  }

  private validateAddress(address: VirtualTexturePageAddress): void {
    const descriptor = this.textures.get(address.textureId);
    if (!descriptor) throw new Error(`Unknown virtual texture ${address.textureId}`);
    if (!Number.isInteger(address.mip) || address.mip < 0 || address.mip >= descriptor.mipCount) {
      throw new Error(`Virtual texture ${address.textureId} mip ${address.mip} is out of range`);
    }
    if (!Number.isInteger(address.layer) || address.layer < 0 || address.layer >= (descriptor.arrayLayers ?? 1)) {
      throw new Error(`Virtual texture ${address.textureId} layer ${address.layer} is out of range`);
    }
    const pagesX = Math.ceil(Math.max(1, descriptor.width >> address.mip) / descriptor.pageSize);
    const pagesY = Math.ceil(Math.max(1, descriptor.height >> address.mip) / descriptor.pageSize);
    if (!Number.isInteger(address.x) || address.x < 0 || address.x >= pagesX
      || !Number.isInteger(address.y) || address.y < 0 || address.y >= pagesY) {
      throw new Error(`Virtual texture ${address.textureId} page (${address.x}, ${address.y}) is out of range`);
    }
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

export function virtualTexturePageKey(address: VirtualTexturePageAddress): string {
  return addressKey(address);
}
