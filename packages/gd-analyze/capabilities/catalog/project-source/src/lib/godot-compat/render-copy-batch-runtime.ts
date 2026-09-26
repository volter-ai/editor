export interface RenderBufferCopyRegion {
  sourceId: string;
  destinationId: string;
  sourceOffset: number;
  destinationOffset: number;
  byteSize: number;
}

export interface RenderCopyBatch {
  id: number;
  regions: RenderBufferCopyRegion[];
  totalBytes: number;
}

export class RenderCopyBatchRuntime {
  private regions: RenderBufferCopyRegion[] = [];
  private nextBatchId = 1;

  constructor(readonly maximumRegions = 1024, readonly maximumBytes = 64 * 1024 * 1024) {
    if (!Number.isInteger(maximumRegions) || maximumRegions < 1) throw new Error('Maximum copy region count must be positive');
    if (!Number.isInteger(maximumBytes) || maximumBytes < 1) throw new Error('Maximum copy byte count must be positive');
  }

  add(region: RenderBufferCopyRegion): void {
    if (!region.sourceId || !region.destinationId || region.sourceId === region.destinationId) throw new Error('Copy region requires distinct resources');
    for (const value of [region.sourceOffset, region.destinationOffset, region.byteSize]) {
      if (!Number.isInteger(value) || value < 0) throw new Error('Copy region values must be non-negative integers');
    }
    if (region.byteSize === 0) return;
    if (this.regions.length >= this.maximumRegions) throw new Error('Copy batch region capacity is exhausted');
    if (this.totalBytes + region.byteSize > this.maximumBytes) throw new Error('Copy batch byte capacity is exhausted');
    const previous = this.regions[this.regions.length - 1];
    if (previous
      && previous.sourceId === region.sourceId
      && previous.destinationId === region.destinationId
      && previous.sourceOffset + previous.byteSize === region.sourceOffset
      && previous.destinationOffset + previous.byteSize === region.destinationOffset) {
      previous.byteSize += region.byteSize;
    } else this.regions.push({ ...region });
  }

  flush(): RenderCopyBatch | null {
    if (this.regions.length === 0) return null;
    const batch = { id: this.nextBatchId++, regions: this.regions.map((region) => ({ ...region })), totalBytes: this.totalBytes };
    this.regions = [];
    return batch;
  }

  peek(): RenderCopyBatch | null {
    return this.regions.length === 0 ? null : { id: this.nextBatchId, regions: this.regions.map((region) => ({ ...region })), totalBytes: this.totalBytes };
  }

  clear(): void { this.regions = []; }
  get totalBytes(): number { return this.regions.reduce((total, region) => total + region.byteSize, 0); }
  get regionCount(): number { return this.regions.length; }
}
