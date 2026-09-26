export interface RenderUploadAllocation {
  id: number;
  offset: number;
  byteSize: number;
  submission: number;
  view: Uint8Array;
}

interface InternalAllocation {
  id: number;
  offset: number;
  byteSize: number;
  occupiedBytes: number;
  submission: number;
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export class RenderUploadRingRuntime {
  readonly storage: ArrayBuffer;
  private readonly active: InternalAllocation[] = [];
  private head = 0;
  private nextId = 1;

  constructor(readonly capacity: number, readonly alignment = 256, storage?: ArrayBuffer) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Upload ring capacity must be positive');
    if (!Number.isInteger(alignment) || alignment < 1) throw new Error('Upload ring alignment must be positive');
    if (storage && storage.byteLength < capacity) throw new Error('Upload ring storage is too small');
    this.storage = storage ?? new ArrayBuffer(capacity);
  }

  allocate(byteSize: number, submission: number): RenderUploadAllocation {
    if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > this.capacity) throw new Error('Upload allocation size is invalid');
    if (!Number.isInteger(submission) || submission < 0) throw new Error('Upload submission must be non-negative');
    const occupiedBytes = alignUp(byteSize, this.alignment);
    let offset = alignUp(this.head, this.alignment);
    if (offset + occupiedBytes > this.capacity) offset = 0;
    if (!this.isFree(offset, occupiedBytes)) {
      const candidates = this.freeIntervals();
      const interval = candidates.find((candidate) => alignUp(candidate.offset, this.alignment) + occupiedBytes <= candidate.offset + candidate.byteSize);
      if (!interval) throw new Error(`Upload ring is exhausted; ${byteSize} bytes cannot be allocated`);
      offset = alignUp(interval.offset, this.alignment);
    }
    const allocation: InternalAllocation = { id: this.nextId++, offset, byteSize, occupiedBytes, submission };
    this.active.push(allocation);
    this.active.sort((a, b) => a.offset - b.offset);
    this.head = (offset + occupiedBytes) % this.capacity;
    return { ...allocation, view: new Uint8Array(this.storage, offset, byteSize) };
  }

  write(data: ArrayBufferView, submission: number): RenderUploadAllocation {
    const allocation = this.allocate(data.byteLength, submission);
    allocation.view.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return allocation;
  }

  reclaim(completedSubmission: number): number {
    if (!Number.isInteger(completedSubmission) || completedSubmission < 0) throw new Error('Completed submission must be non-negative');
    let reclaimed = 0;
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const allocation = this.active[index];
      if (allocation && allocation.submission <= completedSubmission) {
        reclaimed += allocation.occupiedBytes;
        this.active.splice(index, 1);
      }
    }
    if (this.active.length === 0) this.head = 0;
    return reclaimed;
  }

  allocation(id: number): RenderUploadAllocation | undefined {
    const allocation = this.active.find((candidate) => candidate.id === id);
    return allocation ? { ...allocation, view: new Uint8Array(this.storage, allocation.offset, allocation.byteSize) } : undefined;
  }

  get usedBytes(): number {
    return this.active.reduce((total, allocation) => total + allocation.occupiedBytes, 0);
  }

  get availableBytes(): number {
    return this.capacity - this.usedBytes;
  }

  private isFree(offset: number, byteSize: number): boolean {
    return this.active.every((allocation) => offset + byteSize <= allocation.offset || allocation.offset + allocation.occupiedBytes <= offset);
  }

  private freeIntervals(): Array<{ offset: number; byteSize: number }> {
    if (this.active.length === 0) return [{ offset: 0, byteSize: this.capacity }];
    const intervals: Array<{ offset: number; byteSize: number }> = [];
    let cursor = 0;
    for (const allocation of this.active) {
      if (allocation.offset > cursor) intervals.push({ offset: cursor, byteSize: allocation.offset - cursor });
      cursor = allocation.offset + allocation.occupiedBytes;
    }
    if (cursor < this.capacity) intervals.push({ offset: cursor, byteSize: this.capacity - cursor });
    return intervals;
  }
}
