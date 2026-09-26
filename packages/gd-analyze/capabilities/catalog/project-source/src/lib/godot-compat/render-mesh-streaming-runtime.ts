export type RenderMeshStreamKind = "vertex" | "index" | "meshlet" | "cluster" | "morph" | "skin";

export interface RenderMeshStreamChunkDescriptor {
  id: string;
  meshId: string;
  lod: number;
  kind: RenderMeshStreamKind;
  compressedBytes: number;
  decodedBytes: number;
  gpuBytes?: number;
  dependencies?: readonly string[];
  vertexCount?: number;
  indexCount?: number;
  meshletCount?: number;
  bounds?: readonly [number, number, number, number, number, number];
}

export interface RenderMeshStreamMeshDescriptor {
  id: string;
  lodCount: number;
  fallbackLod?: number;
  chunks: readonly RenderMeshStreamChunkDescriptor[];
}

export interface RenderMeshStreamPayload {
  data: Uint8Array;
  metadata?: Readonly<Record<string, number | string | boolean>>;
}

export interface RenderMeshStreamGpuHandle {
  id: string;
  byteSize: number;
}

export interface RenderMeshStreamingBackend {
  load(chunk: RenderMeshStreamChunkDescriptor): RenderMeshStreamPayload | Promise<RenderMeshStreamPayload>;
  decode(chunk: RenderMeshStreamChunkDescriptor, payload: RenderMeshStreamPayload): RenderMeshStreamPayload | Promise<RenderMeshStreamPayload>;
  upload(chunk: RenderMeshStreamChunkDescriptor, payload: RenderMeshStreamPayload): RenderMeshStreamGpuHandle | Promise<RenderMeshStreamGpuHandle>;
  destroy(handle: RenderMeshStreamGpuHandle): void | Promise<void>;
}

export type RenderMeshStreamChunkState =
  | "unloaded"
  | "queued"
  | "loading"
  | "decoding"
  | "uploading"
  | "resident"
  | "failed"
  | "evicting";

export interface RenderMeshStreamChunkRecord {
  id: string;
  descriptor: RenderMeshStreamChunkDescriptor;
  state: RenderMeshStreamChunkState;
  priority: number;
  requestCount: number;
  firstRequestedFrame: number | null;
  lastRequestedFrame: number | null;
  lastUsedFrame: number;
  residentFrame: number | null;
  pinned: boolean;
  handle: RenderMeshStreamGpuHandle | null;
  error: string | null;
}

export interface RenderMeshStreamRequest {
  meshId: string;
  lod: number;
  priority?: number;
  pin?: boolean;
}

export interface RenderMeshStreamingOptions {
  maximumGpuBytes?: number;
  maximumDecodeBytes?: number;
  maximumLoadsInFlight?: number;
  maximumUploadsPerFrame?: number;
  evictionGraceFrames?: number;
  priorityDecay?: number;
}

export interface RenderMeshStreamingSnapshot {
  frame: number;
  meshCount: number;
  chunkCount: number;
  queuedChunks: number;
  activeChunks: number;
  residentChunks: number;
  failedChunks: number;
  gpuBytes: number;
  decodedBytesInFlight: number;
  totalUploads: number;
  totalEvictions: number;
}

type RenderMeshStreamWatcher = (snapshot: RenderMeshStreamingSnapshot) => void;

interface InternalChunk extends RenderMeshStreamChunkRecord {
  generation: number;
  pendingDecodedBytes: number;
}

const DEFAULT_GPU_BYTES = 256 * 1024 * 1024;
const DEFAULT_DECODE_BYTES = 64 * 1024 * 1024;
const DEFAULT_LOADS_IN_FLIGHT = 8;
const DEFAULT_UPLOADS_PER_FRAME = 8;
const DEFAULT_EVICTION_GRACE = 3;
const DEFAULT_PRIORITY_DECAY = 0.9;

function cloneDescriptor(descriptor: RenderMeshStreamChunkDescriptor): RenderMeshStreamChunkDescriptor {
  return {
    ...descriptor,
    ...(descriptor.dependencies === undefined ? {} : { dependencies: [...descriptor.dependencies] }),
    ...(descriptor.bounds === undefined ? {} : {
      bounds: [...descriptor.bounds] as [number, number, number, number, number, number],
    }),
  };
}

function cloneRecord(record: RenderMeshStreamChunkRecord): RenderMeshStreamChunkRecord {
  return {
    ...record,
    descriptor: cloneDescriptor(record.descriptor),
    handle: record.handle ? { ...record.handle } : null,
  };
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

export class RenderMeshStreamingRuntime {
  private readonly meshes = new Map<string, RenderMeshStreamMeshDescriptor>();
  private readonly chunks = new Map<string, InternalChunk>();
  private readonly meshChunks = new Map<string, Map<number, string[]>>();
  private readonly watchers = new Set<RenderMeshStreamWatcher>();
  private readonly maximumGpuBytes: number;
  private readonly maximumDecodeBytes: number;
  private readonly maximumLoadsInFlight: number;
  private readonly maximumUploadsPerFrame: number;
  private readonly evictionGraceFrames: number;
  private readonly priorityDecay: number;
  private frame = 0;
  private loadsInFlight = 0;
  private uploadsThisFrame = 0;
  private decodedBytesInFlight = 0;
  private totalUploads = 0;
  private totalEvictions = 0;

  constructor(
    private readonly backend: RenderMeshStreamingBackend,
    options: RenderMeshStreamingOptions = {},
  ) {
    this.maximumGpuBytes = options.maximumGpuBytes ?? DEFAULT_GPU_BYTES;
    this.maximumDecodeBytes = options.maximumDecodeBytes ?? DEFAULT_DECODE_BYTES;
    this.maximumLoadsInFlight = options.maximumLoadsInFlight ?? DEFAULT_LOADS_IN_FLIGHT;
    this.maximumUploadsPerFrame = options.maximumUploadsPerFrame ?? DEFAULT_UPLOADS_PER_FRAME;
    this.evictionGraceFrames = options.evictionGraceFrames ?? DEFAULT_EVICTION_GRACE;
    this.priorityDecay = options.priorityDecay ?? DEFAULT_PRIORITY_DECAY;
    positiveInteger(this.maximumGpuBytes, "maximumGpuBytes");
    positiveInteger(this.maximumDecodeBytes, "maximumDecodeBytes");
    positiveInteger(this.maximumLoadsInFlight, "maximumLoadsInFlight");
    positiveInteger(this.maximumUploadsPerFrame, "maximumUploadsPerFrame");
    if (!Number.isFinite(this.priorityDecay) || this.priorityDecay < 0 || this.priorityDecay > 1) {
      throw new Error("priorityDecay must be between zero and one");
    }
  }

  registerMesh(descriptor: RenderMeshStreamMeshDescriptor): void {
    this.validateMesh(descriptor);
    if (this.meshes.has(descriptor.id)) throw new Error(`Streamed mesh ${descriptor.id} is already registered`);
    const lodMap = new Map<number, string[]>();
    for (const chunkDescriptor of descriptor.chunks) {
      if (this.chunks.has(chunkDescriptor.id)) throw new Error(`Mesh stream chunk ${chunkDescriptor.id} is already registered`);
      const cloned = cloneDescriptor(chunkDescriptor);
      this.chunks.set(cloned.id, {
        id: cloned.id,
        descriptor: cloned,
        state: "unloaded",
        priority: 0,
        requestCount: 0,
        firstRequestedFrame: null,
        lastRequestedFrame: null,
        lastUsedFrame: this.frame,
        residentFrame: null,
        pinned: false,
        handle: null,
        error: null,
        generation: 0,
        pendingDecodedBytes: 0,
      });
      const ids = lodMap.get(cloned.lod) ?? [];
      ids.push(cloned.id);
      lodMap.set(cloned.lod, ids);
    }
    this.meshes.set(descriptor.id, {
      ...descriptor,
      chunks: descriptor.chunks.map(cloneDescriptor),
    });
    this.meshChunks.set(descriptor.id, lodMap);
    this.notify();
  }

  async unregisterMesh(id: string): Promise<boolean> {
    const descriptor = this.meshes.get(id);
    if (!descriptor) return false;
    for (const chunk of descriptor.chunks) await this.removeChunk(chunk.id);
    this.meshChunks.delete(id);
    this.meshes.delete(id);
    this.notify();
    return true;
  }

  getMesh(id: string): RenderMeshStreamMeshDescriptor | undefined {
    const descriptor = this.meshes.get(id);
    return descriptor ? { ...descriptor, chunks: descriptor.chunks.map(cloneDescriptor) } : undefined;
  }

  getChunk(id: string): RenderMeshStreamChunkRecord | undefined {
    const chunk = this.chunks.get(id);
    return chunk ? cloneRecord(chunk) : undefined;
  }

  listChunks(state?: RenderMeshStreamChunkState): RenderMeshStreamChunkRecord[] {
    return [...this.chunks.values()].filter((chunk) => !state || chunk.state === state).map(cloneRecord);
  }

  request(request: RenderMeshStreamRequest): RenderMeshStreamChunkRecord[] {
    const mesh = this.requireMesh(request.meshId);
    if (!Number.isInteger(request.lod) || request.lod < 0 || request.lod >= mesh.lodCount) {
      throw new Error(`Mesh ${request.meshId} LOD ${request.lod} is out of range`);
    }
    const ids = this.meshChunks.get(request.meshId)?.get(request.lod) ?? [];
    const records: RenderMeshStreamChunkRecord[] = [];
    for (const id of ids) {
      const chunk = this.chunks.get(id)!;
      this.requestChunk(chunk, request.priority ?? this.lodPriority(mesh, request.lod), request.pin ?? false);
      records.push(cloneRecord(chunk));
    }
    this.requestFallback(mesh);
    this.notify();
    void this.pump();
    return records;
  }

  requestVisible(
    requests: readonly (RenderMeshStreamRequest & { screenCoverage?: number; distance?: number })[],
  ): void {
    const consolidated = new Map<string, RenderMeshStreamRequest & { screenCoverage?: number; distance?: number }>();
    for (const request of requests) {
      const key = `${request.meshId}:${request.lod}`;
      const existing = consolidated.get(key);
      if (!existing || (request.screenCoverage ?? 0) > (existing.screenCoverage ?? 0)) consolidated.set(key, request);
    }
    for (const request of consolidated.values()) {
      const coverage = Math.max(0, request.screenCoverage ?? 0);
      const distanceFactor = 1 / Math.max(1, request.distance ?? 1);
      this.request({ ...request, priority: (request.priority ?? 0) + coverage * 100 + distanceFactor * 10 });
    }
  }

  bestResidentLod(meshId: string, desiredLod: number): number | null {
    const mesh = this.requireMesh(meshId);
    for (let lod = desiredLod; lod < mesh.lodCount; lod += 1) {
      const ids = this.meshChunks.get(meshId)?.get(lod) ?? [];
      if (ids.length > 0 && ids.every((id) => this.chunks.get(id)?.state === "resident")) return lod;
    }
    for (let lod = desiredLod - 1; lod >= 0; lod -= 1) {
      const ids = this.meshChunks.get(meshId)?.get(lod) ?? [];
      if (ids.length > 0 && ids.every((id) => this.chunks.get(id)?.state === "resident")) return lod;
    }
    return null;
  }

  isLodResident(meshId: string, lod: number): boolean {
    const ids = this.meshChunks.get(meshId)?.get(lod) ?? [];
    return ids.length > 0 && ids.every((id) => this.chunks.get(id)?.state === "resident");
  }

  touch(meshId: string, lod: number): void {
    for (const id of this.meshChunks.get(meshId)?.get(lod) ?? []) {
      const chunk = this.chunks.get(id);
      if (chunk) chunk.lastUsedFrame = this.frame;
    }
  }

  pinMesh(meshId: string, pinned = true, lod?: number): void {
    this.requireMesh(meshId);
    for (const [chunkLod, ids] of this.meshChunks.get(meshId) ?? []) {
      if (lod !== undefined && chunkLod !== lod) continue;
      for (const id of ids) {
        const chunk = this.chunks.get(id)!;
        chunk.pinned = pinned;
        if (pinned && chunk.state === "unloaded") this.requestChunk(chunk, 10000, true);
      }
    }
    this.notify();
    void this.pump();
  }

  async beginFrame(frame?: number): Promise<void> {
    this.frame = frame ?? this.frame + 1;
    if (!Number.isInteger(this.frame) || this.frame < 0) throw new Error("Mesh streaming frame must be non-negative");
    this.uploadsThisFrame = 0;
    for (const chunk of this.chunks.values()) {
      if (!chunk.pinned && chunk.lastRequestedFrame !== this.frame) chunk.priority *= this.priorityDecay;
    }
    await this.enforceGpuBudget();
    void this.pump();
    this.notify();
  }

  async evictMesh(meshId: string, lod?: number): Promise<string[]> {
    this.requireMesh(meshId);
    const evicted: string[] = [];
    for (const [chunkLod, ids] of this.meshChunks.get(meshId) ?? []) {
      if (lod !== undefined && lod !== chunkLod) continue;
      for (const id of ids) if (await this.evictChunk(this.chunks.get(id)!)) evicted.push(id);
    }
    return evicted;
  }

  snapshot(): RenderMeshStreamingSnapshot {
    const chunks = [...this.chunks.values()];
    return {
      frame: this.frame,
      meshCount: this.meshes.size,
      chunkCount: chunks.length,
      queuedChunks: chunks.filter((chunk) => chunk.state === "queued").length,
      activeChunks: chunks.filter((chunk) => chunk.state === "loading" || chunk.state === "decoding" || chunk.state === "uploading").length,
      residentChunks: chunks.filter((chunk) => chunk.state === "resident").length,
      failedChunks: chunks.filter((chunk) => chunk.state === "failed").length,
      gpuBytes: chunks.reduce((total, chunk) => total + (chunk.handle?.byteSize ?? 0), 0),
      decodedBytesInFlight: this.decodedBytesInFlight,
      totalUploads: this.totalUploads,
      totalEvictions: this.totalEvictions,
    };
  }

  watch(watcher: RenderMeshStreamWatcher): () => void {
    this.watchers.add(watcher);
    watcher(this.snapshot());
    return () => this.watchers.delete(watcher);
  }

  async clear(): Promise<void> {
    for (const meshId of [...this.meshes.keys()]) await this.unregisterMesh(meshId);
  }

  private requestChunk(chunk: InternalChunk, priority: number, pin: boolean): void {
    chunk.priority += Math.max(0, priority);
    chunk.requestCount += 1;
    chunk.firstRequestedFrame ??= this.frame;
    chunk.lastRequestedFrame = this.frame;
    chunk.lastUsedFrame = this.frame;
    chunk.pinned ||= pin;
    if (chunk.state === "unloaded" || chunk.state === "failed") {
      chunk.state = "queued";
      chunk.error = null;
    }
    for (const dependencyId of chunk.descriptor.dependencies ?? []) {
      const dependency = this.chunks.get(dependencyId);
      if (dependency) this.requestChunk(dependency, priority + 1, pin);
    }
  }

  private requestFallback(mesh: RenderMeshStreamMeshDescriptor): void {
    const fallbackLod = mesh.fallbackLod ?? mesh.lodCount - 1;
    for (const id of this.meshChunks.get(mesh.id)?.get(fallbackLod) ?? []) {
      const chunk = this.chunks.get(id)!;
      if (chunk.state !== "resident") this.requestChunk(chunk, 5000, true);
    }
  }

  private async pump(): Promise<void> {
    while (this.loadsInFlight < this.maximumLoadsInFlight && this.uploadsThisFrame < this.maximumUploadsPerFrame) {
      const chunk = this.nextChunk();
      if (!chunk) break;
      if (this.decodedBytesInFlight + chunk.descriptor.decodedBytes > this.maximumDecodeBytes && this.decodedBytesInFlight > 0) break;
      chunk.state = "loading";
      chunk.generation += 1;
      const generation = chunk.generation;
      this.loadsInFlight += 1;
      this.decodedBytesInFlight += chunk.descriptor.decodedBytes;
      chunk.pendingDecodedBytes = chunk.descriptor.decodedBytes;
      void this.loadChunk(chunk, generation).finally(() => {
        this.loadsInFlight -= 1;
        this.decodedBytesInFlight -= chunk.pendingDecodedBytes;
        chunk.pendingDecodedBytes = 0;
        this.notify();
        void this.pump();
      });
    }
  }

  private nextChunk(): InternalChunk | null {
    const queued = [...this.chunks.values()]
      .filter((chunk) => chunk.state === "queued" && this.dependenciesResident(chunk))
      .sort((a, b) => b.priority - a.priority || (a.firstRequestedFrame ?? 0) - (b.firstRequestedFrame ?? 0));
    return queued[0] ?? null;
  }

  private dependenciesResident(chunk: InternalChunk): boolean {
    for (const dependencyId of chunk.descriptor.dependencies ?? []) {
      const dependency = this.chunks.get(dependencyId);
      if (!dependency || dependency.state !== "resident") return false;
    }
    return true;
  }

  private async loadChunk(chunk: InternalChunk, generation: number): Promise<void> {
    try {
      const compressed = await this.backend.load(cloneDescriptor(chunk.descriptor));
      if (chunk.generation !== generation || chunk.state !== "loading") return;
      chunk.state = "decoding";
      this.notify();
      const decoded = await this.backend.decode(cloneDescriptor(chunk.descriptor), {
        ...compressed,
        data: compressed.data.slice(),
      });
      if (chunk.generation !== generation || chunk.state !== "decoding") return;
      await this.reserveGpuBytes(chunk.descriptor.gpuBytes ?? chunk.descriptor.decodedBytes);
      chunk.state = "uploading";
      this.uploadsThisFrame += 1;
      this.notify();
      const handle = await this.backend.upload(cloneDescriptor(chunk.descriptor), {
        ...decoded,
        data: decoded.data.slice(),
      });
      if (chunk.generation !== generation || chunk.state !== "uploading") {
        await this.backend.destroy(handle);
        return;
      }
      chunk.handle = { ...handle };
      chunk.state = "resident";
      chunk.residentFrame = this.frame;
      chunk.lastUsedFrame = this.frame;
      chunk.error = null;
      this.totalUploads += 1;
    } catch (error) {
      if (chunk.generation !== generation) return;
      chunk.state = "failed";
      chunk.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async reserveGpuBytes(byteSize: number): Promise<void> {
    let available = this.maximumGpuBytes - this.snapshot().gpuBytes;
    if (available >= byteSize) return;
    const candidates = this.evictionCandidates();
    for (const candidate of candidates) {
      await this.evictChunk(candidate);
      available = this.maximumGpuBytes - this.snapshot().gpuBytes;
      if (available >= byteSize) return;
    }
    if (byteSize > this.maximumGpuBytes) throw new Error(`Mesh stream chunk requires ${byteSize} GPU bytes, exceeding the full budget`);
  }

  private async enforceGpuBudget(): Promise<void> {
    let bytes = this.snapshot().gpuBytes;
    if (bytes <= this.maximumGpuBytes) return;
    for (const chunk of this.evictionCandidates()) {
      const released = chunk.handle?.byteSize ?? 0;
      if (await this.evictChunk(chunk)) bytes -= released;
      if (bytes <= this.maximumGpuBytes) break;
    }
  }

  private evictionCandidates(): InternalChunk[] {
    return [...this.chunks.values()]
      .filter((chunk) => chunk.state === "resident" && !chunk.pinned && this.frame - chunk.lastUsedFrame >= this.evictionGraceFrames)
      .sort((a, b) => a.priority - b.priority || a.lastUsedFrame - b.lastUsedFrame || (b.handle?.byteSize ?? 0) - (a.handle?.byteSize ?? 0));
  }

  private async evictChunk(chunk: InternalChunk): Promise<boolean> {
    if (chunk.state !== "resident" || !chunk.handle || chunk.pinned) return false;
    chunk.state = "evicting";
    chunk.generation += 1;
    const handle = chunk.handle;
    chunk.handle = null;
    await this.backend.destroy({ ...handle });
    chunk.state = "unloaded";
    chunk.residentFrame = null;
    chunk.priority = 0;
    this.totalEvictions += 1;
    this.notify();
    return true;
  }

  private async removeChunk(id: string): Promise<void> {
    const chunk = this.chunks.get(id);
    if (!chunk) return;
    chunk.generation += 1;
    if (chunk.handle) await this.backend.destroy({ ...chunk.handle });
    this.chunks.delete(id);
  }

  private lodPriority(mesh: RenderMeshStreamMeshDescriptor, lod: number): number {
    return (mesh.lodCount - lod) * 100;
  }

  private validateMesh(mesh: RenderMeshStreamMeshDescriptor): void {
    if (!mesh.id) throw new Error("Streamed mesh id cannot be empty");
    positiveInteger(mesh.lodCount, `mesh ${mesh.id} lodCount`);
    if (mesh.fallbackLod !== undefined
      && (!Number.isInteger(mesh.fallbackLod) || mesh.fallbackLod < 0 || mesh.fallbackLod >= mesh.lodCount)) {
      throw new Error(`Mesh ${mesh.id} fallbackLod is out of range`);
    }
    const ids = new Set<string>();
    for (const chunk of mesh.chunks) {
      if (!chunk.id) throw new Error(`Mesh ${mesh.id} contains a chunk with an empty id`);
      if (chunk.meshId !== mesh.id) throw new Error(`Chunk ${chunk.id} belongs to ${chunk.meshId}, not ${mesh.id}`);
      if (ids.has(chunk.id)) throw new Error(`Mesh ${mesh.id} duplicates chunk ${chunk.id}`);
      ids.add(chunk.id);
      if (!Number.isInteger(chunk.lod) || chunk.lod < 0 || chunk.lod >= mesh.lodCount) {
        throw new Error(`Chunk ${chunk.id} LOD is out of range`);
      }
      positiveInteger(chunk.compressedBytes, `chunk ${chunk.id} compressedBytes`);
      positiveInteger(chunk.decodedBytes, `chunk ${chunk.id} decodedBytes`);
      positiveInteger(chunk.gpuBytes ?? chunk.decodedBytes, `chunk ${chunk.id} gpuBytes`);
    }
    for (const chunk of mesh.chunks) {
      for (const dependency of chunk.dependencies ?? []) {
        if (!ids.has(dependency)) throw new Error(`Chunk ${chunk.id} references unknown dependency ${dependency}`);
        if (dependency === chunk.id) throw new Error(`Chunk ${chunk.id} cannot depend on itself`);
      }
    }
  }

  private requireMesh(id: string): RenderMeshStreamMeshDescriptor {
    const mesh = this.meshes.get(id);
    if (!mesh) throw new Error(`Unknown streamed mesh ${id}`);
    return mesh;
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
  }
}
