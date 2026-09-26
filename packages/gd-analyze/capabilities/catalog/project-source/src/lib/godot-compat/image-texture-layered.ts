import { Data3DTexture, DataArrayTexture, RGBAFormat, UnsignedByteType } from 'three';
import { type GodotImage } from './image';
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export const GODOT_LAYERED_TYPE_2D_ARRAY = 0;
export const GODOT_LAYERED_TYPE_CUBEMAP = 1;
export const GODOT_LAYERED_TYPE_CUBEMAP_ARRAY = 2;

function copyImage(image: GodotImage): GodotImage {
  const duplicate = Object.create(Object.getPrototypeOf(image)) as GodotImage;
  Object.assign(duplicate, image);
  return image;
}

function validateImages(images: readonly GodotImage[], requiredLayers = 1): { width: number; height: number; format: number; mipmaps: boolean } {
  if (images.length < requiredLayers) throw new RangeError(`Layered texture requires at least ${requiredLayers} images.`);
  const first = images[0]!;
  const width = first.get_width(); const height = first.get_height(); const format = first.get_format(); const mipmaps = first.has_mipmaps();
  if (width <= 0 || height <= 0) throw new RangeError('Layered texture images must be non-empty.');
  for (const image of images) {
    if (image.get_width() !== width || image.get_height() !== height || image.get_format() !== format || image.has_mipmaps() !== mipmaps) {
      throw new RangeError('Layered texture images require identical dimensions, format, and mipmap state.');
    }
  }
  return { width, height, format, mipmaps };
}

function rgbaBytes(image: GodotImage): Uint8Array {
  const size = image.get_width() * image.get_height() * 4;
  const source = image.get_data();
  if (source.length === size) return Uint8Array.from(source);
  const result = new Uint8Array(size);
  if (source.length >= image.get_width() * image.get_height()) {
    const components = Math.max(1, Math.floor(source.length / (image.get_width() * image.get_height())));
    for (let pixel = 0; pixel < image.get_width() * image.get_height(); pixel += 1) {
      result[pixel * 4] = source[pixel * components] ?? 0;
      result[pixel * 4 + 1] = source[pixel * components + Math.min(1, components - 1)] ?? result[pixel * 4]!;
      result[pixel * 4 + 2] = source[pixel * components + Math.min(2, components - 1)] ?? result[pixel * 4]!;
      result[pixel * 4 + 3] = components >= 4 ? source[pixel * components + 3] ?? 255 : 255;
    }
  }
  return result;
}

function stackedBytes(images: readonly GodotImage[]): Uint8Array {
  if (!images.length) return new Uint8Array();
  const layerSize = images[0]!.get_width() * images[0]!.get_height() * 4;
  const output = new Uint8Array(layerSize * images.length);
  images.forEach((image, layer) => output.set(rgbaBytes(image), layer * layerSize));
  return output;
}

export class GodotImageTexture3D {
  private format = 0;
  private width = 0;
  private height = 0;
  private depth = 0;
  private mipmaps = false;
  private images: GodotImage[] = [];
  readonly native = new Data3DTexture(new Uint8Array(4), 1, 1, 1);

  constructor() {
    this.native.format = RGBAFormat; this.native.type = UnsignedByteType; this.native.flipY = false;
    registerGodotObjectIdentity(this, 'ImageTexture3D');
  }

  create(format: number, width: number, height: number, depth: number, useMipmaps: boolean, data: readonly GodotImage[]): number {
    if (!Number.isSafeInteger(depth) || depth <= 0 || data.length !== depth) return 31;
    const dimensions = validateImages(data, depth);
    if (dimensions.width !== width || dimensions.height !== height || dimensions.format !== format) return 31;
    this.format = format; this.width = width; this.height = height; this.depth = depth; this.mipmaps = useMipmaps; this.images = data.map(copyImage);
    this.refreshNative(); return 0;
  }

  update(data: readonly GodotImage[]): void {
    const dimensions = validateImages(data, this.depth);
    if (data.length !== this.depth || dimensions.width !== this.width || dimensions.height !== this.height || dimensions.format !== this.format) throw new RangeError('ImageTexture3D.update requires matching images.');
    this.images = data.map(copyImage); this.refreshNative();
  }

  private refreshNative(): void {
    this.native.image = { data: stackedBytes(this.images), width: this.width, height: this.height, depth: this.depth };
    this.native.generateMipmaps = this.mipmaps; this.native.needsUpdate = true; godotResourceEmitChanged(this);
  }

  get_format(): number { return this.format; }
  get_width(): number { return this.width; }
  get_height(): number { return this.height; }
  get_depth(): number { return this.depth; }
  has_mipmaps(): boolean { return this.mipmaps; }
  get_data(): GodotImage[] { return [...this.images]; }
}

export class GodotImageTextureLayered {
  private format = 0;
  private width = 0;
  private height = 0;
  private mipmaps = false;
  private images: GodotImage[] = [];
  readonly native = new DataArrayTexture(new Uint8Array(4), 1, 1, 1);

  constructor(readonly layeredType = GODOT_LAYERED_TYPE_2D_ARRAY, readonly godotClass = 'ImageTextureLayered') {
    this.native.format = RGBAFormat; this.native.type = UnsignedByteType; this.native.flipY = false;
    registerGodotObjectIdentity(this, godotClass);
  }

  create_from_images(images: readonly GodotImage[]): number {
    const required = this.layeredType === GODOT_LAYERED_TYPE_CUBEMAP ? 6 : 1;
    if (this.layeredType === GODOT_LAYERED_TYPE_CUBEMAP && images.length !== 6) return 31;
    if (this.layeredType === GODOT_LAYERED_TYPE_CUBEMAP_ARRAY && images.length % 6 !== 0) return 31;
    let dimensions: ReturnType<typeof validateImages>;
    try { dimensions = validateImages(images, required); } catch { return 31; }
    this.width = dimensions.width; this.height = dimensions.height; this.format = dimensions.format; this.mipmaps = dimensions.mipmaps; this.images = images.map(copyImage);
    this.refreshNative(); return 0;
  }

  update_layer(image: GodotImage, layer: number): void {
    if (!Number.isSafeInteger(layer) || layer < 0 || layer >= this.images.length) throw new RangeError('ImageTextureLayered.update_layer index is out of range.');
    if (image.get_width() !== this.width || image.get_height() !== this.height || image.get_format() !== this.format || image.has_mipmaps() !== this.mipmaps) throw new RangeError('ImageTextureLayered.update_layer requires a matching image.');
    this.images[layer] = copyImage(image); this.refreshNative();
  }

  private refreshNative(): void {
    this.native.image = { data: stackedBytes(this.images), width: this.width, height: this.height, depth: this.images.length };
    this.native.generateMipmaps = this.mipmaps; this.native.needsUpdate = true; godotResourceEmitChanged(this);
  }

  get_format(): number { return this.format; }
  get_width(): number { return this.width; }
  get_height(): number { return this.height; }
  get_layers(): number { return this.images.length; }
  has_mipmaps(): boolean { return this.mipmaps; }
  get_layer_data(layer: number): GodotImage | null { return this.images[layer] ?? null; }
}

export class GodotTexture2DArray extends GodotImageTextureLayered { constructor() { super(GODOT_LAYERED_TYPE_2D_ARRAY, 'Texture2DArray'); } }
export class GodotCubemap extends GodotImageTextureLayered { constructor() { super(GODOT_LAYERED_TYPE_CUBEMAP, 'Cubemap'); } }
export class GodotCubemapArray extends GodotImageTextureLayered { constructor() { super(GODOT_LAYERED_TYPE_CUBEMAP_ARRAY, 'CubemapArray'); } }

export const createGodotImageTexture3D = (): GodotImageTexture3D => new GodotImageTexture3D();
export const createGodotTexture2DArray = (): GodotTexture2DArray => new GodotTexture2DArray();
export const createGodotCubemap = (): GodotCubemap => new GodotCubemap();
export const createGodotCubemapArray = (): GodotCubemapArray => new GodotCubemapArray();
