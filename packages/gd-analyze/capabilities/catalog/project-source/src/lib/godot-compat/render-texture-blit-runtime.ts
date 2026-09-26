export type RenderTextureAspect = 'color' | 'depth' | 'stencil';

export interface RenderTextureBlitBox {
  x: number;
  y: number;
  z?: number;
  width: number;
  height: number;
  depth?: number;
}

export interface RenderTextureBlitResource {
  id: string;
  width: number;
  height: number;
  depth?: number;
  mipCount: number;
  layerCount?: number;
  format: string;
  aspects: readonly RenderTextureAspect[];
}

export interface RenderTextureBlitRequest {
  source: RenderTextureBlitResource;
  destination: RenderTextureBlitResource;
  sourceMip?: number;
  destinationMip?: number;
  sourceLayer?: number;
  destinationLayer?: number;
  sourceBox: RenderTextureBlitBox;
  destinationBox: RenderTextureBlitBox;
  aspect?: RenderTextureAspect;
  filter?: 'nearest' | 'linear';
}

export interface RenderTextureBlitPlan {
  request: RenderTextureBlitRequest;
  path: 'copy' | 'blit';
  scaled: boolean;
  overlapping: boolean;
}

export class RenderTextureBlitRuntime {
  plan(request: RenderTextureBlitRequest): RenderTextureBlitPlan {
    const sourceMip = request.sourceMip ?? 0;
    const destinationMip = request.destinationMip ?? 0;
    const sourceLayer = request.sourceLayer ?? 0;
    const destinationLayer = request.destinationLayer ?? 0;
    this.validateSubresource(request.source, sourceMip, sourceLayer, 'source');
    this.validateSubresource(request.destination, destinationMip, destinationLayer, 'destination');
    this.validateBox(request.source, sourceMip, request.sourceBox, 'source');
    this.validateBox(request.destination, destinationMip, request.destinationBox, 'destination');
    const aspect = request.aspect ?? 'color';
    if (!request.source.aspects.includes(aspect) || !request.destination.aspects.includes(aspect)) throw new Error(`Texture blit aspect ${aspect} is unsupported`);
    const scaled = request.sourceBox.width !== request.destinationBox.width
      || request.sourceBox.height !== request.destinationBox.height
      || (request.sourceBox.depth ?? 1) !== (request.destinationBox.depth ?? 1);
    if (scaled && aspect !== 'color') throw new Error('Depth and stencil texture blits cannot scale');
    if ((request.filter ?? 'nearest') === 'linear' && aspect !== 'color') throw new Error('Linear filtering requires a color aspect');
    const sameFormat = request.source.format === request.destination.format;
    const overlapping = request.source.id === request.destination.id
      && sourceMip === destinationMip
      && sourceLayer === destinationLayer
      && this.overlaps(request.sourceBox, request.destinationBox);
    if (overlapping) throw new Error('Texture blit source and destination regions overlap');
    const path = !scaled && sameFormat ? 'copy' : 'blit';
    return {
      request: {
        ...request,
        source: { ...request.source, aspects: [...request.source.aspects] },
        destination: { ...request.destination, aspects: [...request.destination.aspects] },
        sourceBox: { ...request.sourceBox },
        destinationBox: { ...request.destinationBox },
        sourceMip,
        destinationMip,
        sourceLayer,
        destinationLayer,
        aspect,
        filter: request.filter ?? 'nearest',
      },
      path,
      scaled,
      overlapping,
    };
  }

  private validateSubresource(resource: RenderTextureBlitResource, mip: number, layer: number, label: string): void {
    if (!Number.isInteger(mip) || mip < 0 || mip >= resource.mipCount) throw new Error(`Texture blit ${label} mip is out of range`);
    if (!Number.isInteger(layer) || layer < 0 || layer >= (resource.layerCount ?? 1)) throw new Error(`Texture blit ${label} layer is out of range`);
  }

  private validateBox(resource: RenderTextureBlitResource, mip: number, box: RenderTextureBlitBox, label: string): void {
    const extent = { width: Math.max(1, resource.width >> mip), height: Math.max(1, resource.height >> mip), depth: Math.max(1, (resource.depth ?? 1) >> mip) };
    const values = [box.x, box.y, box.z ?? 0, box.width, box.height, box.depth ?? 1];
    if (!values.every(Number.isInteger) || values.some((value) => value < 0) || box.width < 1 || box.height < 1 || (box.depth ?? 1) < 1) throw new Error(`Texture blit ${label} box is invalid`);
    if (box.x + box.width > extent.width || box.y + box.height > extent.height || (box.z ?? 0) + (box.depth ?? 1) > extent.depth) throw new Error(`Texture blit ${label} box exceeds its mip extent`);
  }

  private overlaps(a: RenderTextureBlitBox, b: RenderTextureBlitBox): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width
      && a.y < b.y + b.height && b.y < a.y + a.height
      && (a.z ?? 0) < (b.z ?? 0) + (b.depth ?? 1) && (b.z ?? 0) < (a.z ?? 0) + (a.depth ?? 1);
  }
}
