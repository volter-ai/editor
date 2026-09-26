export interface RenderUniformSlice {
  bufferIndex: number;
  offset: number;
  byteSize: number;
  dynamicOffset: number;
  view: Uint8Array;
}

export class RenderUniformSliceRuntime {
  private readonly buffers: ArrayBuffer[] = [];
  private bufferIndex = 0;
  private offset = 0;

  constructor(readonly bufferByteSize: number, readonly offsetAlignment: number, readonly maximumBuffers = 8) {
    if (!Number.isInteger(bufferByteSize) || bufferByteSize < 1) throw new Error('Uniform buffer size must be positive');
    if (!Number.isInteger(offsetAlignment) || offsetAlignment < 1) throw new Error('Uniform offset alignment must be positive');
    if (!Number.isInteger(maximumBuffers) || maximumBuffers < 1) throw new Error('Maximum uniform buffer count must be positive');
    this.buffers.push(new ArrayBuffer(bufferByteSize));
  }

  allocate(byteSize: number): RenderUniformSlice {
    if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > this.bufferByteSize) throw new Error('Uniform slice size is invalid');
    let aligned = Math.ceil(this.offset / this.offsetAlignment) * this.offsetAlignment;
    if (aligned + byteSize > this.bufferByteSize) {
      this.bufferIndex += 1;
      if (this.bufferIndex >= this.maximumBuffers) throw new Error('Dynamic uniform slice capacity is exhausted');
      if (!this.buffers[this.bufferIndex]) this.buffers.push(new ArrayBuffer(this.bufferByteSize));
      aligned = 0;
    }
    const buffer = this.buffers[this.bufferIndex];
    if (!buffer) throw new Error(`Uniform buffer ${this.bufferIndex} does not exist`);
    const slice = {
      bufferIndex: this.bufferIndex,
      offset: aligned,
      byteSize,
      dynamicOffset: aligned,
      view: new Uint8Array(buffer, aligned, byteSize),
    };
    this.offset = aligned + byteSize;
    return slice;
  }

  write(data: ArrayBufferView): RenderUniformSlice {
    const slice = this.allocate(data.byteLength);
    slice.view.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return slice;
  }

  beginFrame(clear = false): void {
    this.bufferIndex = 0;
    this.offset = 0;
    if (clear) for (const buffer of this.buffers) new Uint8Array(buffer).fill(0);
  }

  buffer(index: number): ArrayBuffer {
    const buffer = this.buffers[index];
    if (!buffer) throw new Error(`Uniform buffer ${index} does not exist`);
    return buffer;
  }

  get allocatedBufferCount(): number { return this.buffers.length; }
  get currentBufferIndex(): number { return this.bufferIndex; }
  get currentOffset(): number { return this.offset; }
}
