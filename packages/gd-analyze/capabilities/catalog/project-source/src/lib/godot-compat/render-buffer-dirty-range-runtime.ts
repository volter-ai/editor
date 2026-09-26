export interface RenderBufferDirtyRange { offset: number; byteSize: number }

export class RenderBufferDirtyRangeRuntime {
  private ranges: RenderBufferDirtyRange[] = [];

  constructor(readonly byteSize: number, readonly alignment = 4) {
    if (!Number.isInteger(byteSize) || byteSize < 0) throw new Error('Buffer byteSize must be non-negative');
    if (!Number.isInteger(alignment) || alignment < 1) throw new Error('Buffer alignment must be positive');
  }

  mark(offset: number, byteSize: number): void {
    if (!Number.isInteger(offset) || !Number.isInteger(byteSize) || offset < 0 || byteSize < 0 || offset + byteSize > this.byteSize) {
      throw new Error('Dirty buffer range is out of bounds');
    }
    if (byteSize === 0) return;
    const start = Math.floor(offset / this.alignment) * this.alignment;
    const end = Math.min(this.byteSize, Math.ceil((offset + byteSize) / this.alignment) * this.alignment);
    this.ranges.push({ offset: start, byteSize: end - start });
    this.coalesce();
  }

  markAll(): void {
    this.ranges = this.byteSize === 0 ? [] : [{ offset: 0, byteSize: this.byteSize }];
  }

  peek(): RenderBufferDirtyRange[] {
    return this.ranges.map((range) => ({ ...range }));
  }

  consume(maximumBytes = Number.POSITIVE_INFINITY): RenderBufferDirtyRange[] {
    const consumed: RenderBufferDirtyRange[] = [];
    let remaining = maximumBytes;
    while (this.ranges.length > 0 && remaining > 0) {
      const range = this.ranges[0];
      if (!range) break;
      const size = Math.min(range.byteSize, remaining);
      consumed.push({ offset: range.offset, byteSize: size });
      if (size === range.byteSize) this.ranges.shift();
      else {
        range.offset += size;
        range.byteSize -= size;
      }
      remaining -= size;
    }
    return consumed;
  }

  clear(): void { this.ranges = []; }
  get dirtyBytes(): number { return this.ranges.reduce((total, range) => total + range.byteSize, 0); }

  private coalesce(): void {
    this.ranges.sort((a, b) => a.offset - b.offset);
    const merged: RenderBufferDirtyRange[] = [];
    for (const range of this.ranges) {
      const previous = merged[merged.length - 1];
      if (previous && previous.offset + previous.byteSize >= range.offset) {
        previous.byteSize = Math.max(previous.offset + previous.byteSize, range.offset + range.byteSize) - previous.offset;
      } else merged.push({ ...range });
    }
    this.ranges = merged;
  }
}
