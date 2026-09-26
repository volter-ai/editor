export interface RenderTextureUploadFormat {
  blockWidth: number;
  blockHeight: number;
  blockDepth?: number;
  bytesPerBlock: number;
}

export interface RenderTextureUploadExtent {
  width: number;
  height: number;
  depth?: number;
}

export interface RenderTextureUploadSubresource {
  mip: number;
  layer: number;
  offset: number;
  rowBytes: number;
  rowsPerImage: number;
  sliceBytes: number;
  byteSize: number;
  extent: Required<RenderTextureUploadExtent>;
}

function positive(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export class RenderTextureUploadLayoutRuntime {
  constructor(readonly rowAlignment = 256, readonly offsetAlignment = 512) {
    positive(rowAlignment, 'Texture upload row alignment');
    positive(offsetAlignment, 'Texture upload offset alignment');
  }

  layout(
    format: RenderTextureUploadFormat,
    extent: RenderTextureUploadExtent,
    mipCount = 1,
    layerCount = 1,
  ): RenderTextureUploadSubresource[] {
    this.validateFormat(format);
    positive(extent.width, 'Texture width');
    positive(extent.height, 'Texture height');
    positive(extent.depth ?? 1, 'Texture depth');
    positive(mipCount, 'Texture mip count');
    positive(layerCount, 'Texture layer count');
    const result: RenderTextureUploadSubresource[] = [];
    let offset = 0;
    for (let layer = 0; layer < layerCount; layer += 1) {
      for (let mip = 0; mip < mipCount; mip += 1) {
        const mipExtent = {
          width: Math.max(1, extent.width >> mip),
          height: Math.max(1, extent.height >> mip),
          depth: Math.max(1, (extent.depth ?? 1) >> mip),
        };
        const blocksX = Math.ceil(mipExtent.width / format.blockWidth);
        const blocksY = Math.ceil(mipExtent.height / format.blockHeight);
        const blocksZ = Math.ceil(mipExtent.depth / (format.blockDepth ?? 1));
        const rowBytes = align(blocksX * format.bytesPerBlock, this.rowAlignment);
        const rowsPerImage = blocksY;
        const sliceBytes = rowBytes * rowsPerImage;
        const byteSize = sliceBytes * blocksZ;
        offset = align(offset, this.offsetAlignment);
        result.push({ mip, layer, offset, rowBytes, rowsPerImage, sliceBytes, byteSize, extent: mipExtent });
        offset += byteSize;
      }
    }
    return result;
  }

  requiredBytes(subresources: readonly RenderTextureUploadSubresource[]): number {
    const last = subresources[subresources.length - 1];
    return last ? last.offset + last.byteSize : 0;
  }

  validateSource(source: ArrayBufferView, subresources: readonly RenderTextureUploadSubresource[]): void {
    const required = this.requiredBytes(subresources);
    if (source.byteLength < required) throw new Error(`Texture upload source has ${source.byteLength} bytes but requires ${required}`);
  }

  private validateFormat(format: RenderTextureUploadFormat): void {
    positive(format.blockWidth, 'Texture block width');
    positive(format.blockHeight, 'Texture block height');
    positive(format.blockDepth ?? 1, 'Texture block depth');
    positive(format.bytesPerBlock, 'Texture bytes per block');
  }
}
