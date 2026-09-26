import {
  ClampToEdgeWrapping,
  Data3DTexture,
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  RGBAFormat,
  RedFormat,
  RGFormat,
  UnsignedByteType,
  type Texture,
} from 'three';
import { registerGodotObjectIdentity } from './object';

export const GODOT_LAYERED_TEXTURE_LAYERED_TYPE = {
  TEXTURE_2D_ARRAY: 0,
  CUBEMAP: 1,
  CUBEMAP_ARRAY: 2,
  LAYERED_TYPE_2D_ARRAY: 0,
  LAYERED_TYPE_CUBEMAP: 1,
  LAYERED_TYPE_CUBEMAP_ARRAY: 2,
} as const;

export interface GodotTextureImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly channels?: 1 | 2 | 4;
  readonly format?: number;
}

export interface GodotLayeredTextureResource {
  readonly __godotClass: 'Texture2DArray' | 'Cubemap' | 'CubemapArray';
  readonly layeredType: 0 | 1 | 2;
  readonly native: DataArrayTexture;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  readonly format: number;
  readonly mipmaps: boolean;
  createFromImages(images: readonly GodotTextureImageData[]): void;
  updateLayer(image: GodotTextureImageData, layer: number): void;
  getLayerData(layer: number): GodotTextureImageData;
}

export interface GodotTexture3DResource {
  readonly __godotClass: 'ImageTexture3D';
  readonly native: Data3DTexture;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly format: number;
  readonly mipmaps: boolean;
  create(format: number, width: number, height: number, depth: number, mipmaps: boolean, data: readonly GodotTextureImageData[]): void;
  update(data: readonly GodotTextureImageData[]): void;
  getData(): GodotTextureImageData[];
}

interface MutableLayeredState {
  width: number;
  height: number;
  layers: number;
  format: number;
  mipmaps: boolean;
  channels: 1 | 2 | 4;
  images: GodotTextureImageData[];
}

interface MutableTexture3DState {
  width: number;
  height: number;
  depth: number;
  format: number;
  mipmaps: boolean;
  channels: 1 | 2 | 4;
  slices: GodotTextureImageData[];
}

const LAYERED_STATE = new WeakMap<GodotLayeredTextureResource, MutableLayeredState>();
const TEXTURE_3D_STATE = new WeakMap<GodotTexture3DResource, MutableTexture3DState>();
const TEXTURE_LISTENERS = new WeakMap<object, Set<() => void>>();

function integer(value: unknown, member: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new RangeError(`godot-compat: ${member} requires an integer >= ${minimum}.`);
  }
  return value as number;
}

function copyImage(image: GodotTextureImageData, member: string): GodotTextureImageData {
  const width = integer(image?.width, `${member}.width`, 1);
  const height = integer(image?.height, `${member}.height`, 1);
  const channels = image.channels ?? 4;
  if (channels !== 1 && channels !== 2 && channels !== 4) {
    throw new RangeError(`godot-compat: ${member}.channels requires 1, 2, or 4.`);
  }
  if (!(image.data instanceof Uint8Array) || image.data.length !== width * height * channels) {
    throw new RangeError(`godot-compat: ${member}.data length must equal width * height * channels.`);
  }
  return Object.freeze({ width, height, channels, format: image.format ?? 0, data: image.data.slice() });
}

function threeFormat(channels: 1 | 2 | 4): typeof RedFormat | typeof RGFormat | typeof RGBAFormat {
  return channels === 1 ? RedFormat : channels === 2 ? RGFormat : RGBAFormat;
}

function applySampler(texture: Texture, mipmaps: boolean): void {
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.generateMipmaps = mipmaps;
  texture.needsUpdate = true;
}

function notify(resource: object): void {
  for (const listener of TEXTURE_LISTENERS.get(resource) ?? []) listener();
}

function packLayers(images: readonly GodotTextureImageData[], width: number, height: number, channels: number): Uint8Array {
  const layerBytes = width * height * channels;
  const packed = new Uint8Array(layerBytes * images.length);
  images.forEach((image, layer) => packed.set(image.data, layerBytes * layer));
  return packed;
}

function validateLayerSet(images: readonly GodotTextureImageData[], minimumLayers: number, cubemap: boolean): GodotTextureImageData[] {
  if (!Array.isArray(images) || images.length < minimumLayers) {
    throw new RangeError(`godot-compat: layered texture requires at least ${minimumLayers} image layers.`);
  }
  if (cubemap && images.length % 6 !== 0) {
    throw new RangeError('godot-compat: Cubemap layers require a multiple of six faces.');
  }
  const copied = images.map((image, index) => copyImage(image, `layer[${index}]`));
  const first = copied[0]!;
  for (const image of copied) {
    if (image.width !== first.width || image.height !== first.height || image.channels !== first.channels) {
      throw new RangeError('godot-compat: every layered texture image requires identical dimensions and channels.');
    }
    if (cubemap && image.width !== image.height) {
      throw new RangeError('godot-compat: every Cubemap face must be square.');
    }
  }
  return copied;
}

export function createGodotLayeredTexture(type: 0 | 1 | 2): GodotLayeredTextureResource {
  if (type !== 0 && type !== 1 && type !== 2) throw new RangeError('godot-compat: layered texture type requires [0, 2].');
  const native = new DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  native.format = RGBAFormat;
  native.type = UnsignedByteType;
  applySampler(native, false);
  const godotClass = type === 0 ? 'Texture2DArray' : type === 1 ? 'Cubemap' : 'CubemapArray';
  const resource = {
    __godotClass: godotClass,
    layeredType: type,
    native,
    get width() { return LAYERED_STATE.get(resource)!.width; },
    get height() { return LAYERED_STATE.get(resource)!.height; },
    get layers() { return LAYERED_STATE.get(resource)!.layers; },
    get format() { return LAYERED_STATE.get(resource)!.format; },
    get mipmaps() { return LAYERED_STATE.get(resource)!.mipmaps; },
    createFromImages(images: readonly GodotTextureImageData[]) { createGodotLayeredTextureFromImages(resource, images); },
    updateLayer(image: GodotTextureImageData, layer: number) { updateGodotLayeredTextureLayer(resource, image, layer); },
    getLayerData(layer: number) { return getGodotLayeredTextureLayerData(resource, layer); },
  } as GodotLayeredTextureResource;
  LAYERED_STATE.set(resource, { width: 1, height: 1, layers: 1, format: 0, mipmaps: false, channels: 4, images: [copyImage({ width: 1, height: 1, data: new Uint8Array(4) }, 'initial')] });
  registerGodotObjectIdentity(resource, godotClass);
  return resource;
}

export function createGodotTexture2DArray(): GodotLayeredTextureResource { return createGodotLayeredTexture(0); }
export function createGodotCubemap(): GodotLayeredTextureResource { return createGodotLayeredTexture(1); }
export function createGodotCubemapArray(): GodotLayeredTextureResource { return createGodotLayeredTexture(2); }

export function createGodotLayeredTextureFromImages(resource: GodotLayeredTextureResource, images: readonly GodotTextureImageData[]): void {
  const copied = validateLayerSet(images, resource.layeredType === 0 ? 1 : 6, resource.layeredType !== 0);
  const first = copied[0]!;
  const state = LAYERED_STATE.get(resource)!;
  state.width = first.width; state.height = first.height; state.layers = copied.length;
  state.channels = first.channels ?? 4; state.format = first.format ?? 0; state.images = copied;
  const packed = packLayers(copied, state.width, state.height, state.channels);
  resource.native.image = { data: packed, width: state.width, height: state.height, depth: state.layers };
  resource.native.format = threeFormat(state.channels);
  applySampler(resource.native, state.mipmaps);
  notify(resource);
}

export function updateGodotLayeredTextureLayer(resource: GodotLayeredTextureResource, image: GodotTextureImageData, layer: unknown): void {
  const state = LAYERED_STATE.get(resource)!;
  const index = integer(layer, 'TextureLayered.update_layer.layer');
  if (index >= state.layers) throw new RangeError(`godot-compat: layer ${index} is outside ${state.layers} layers.`);
  const copied = copyImage(image, 'TextureLayered.update_layer.image');
  if (copied.width !== state.width || copied.height !== state.height || copied.channels !== state.channels) {
    throw new RangeError('godot-compat: replacement layer dimensions and channels must match the texture.');
  }
  state.images[index] = copied;
  const packed = packLayers(state.images, state.width, state.height, state.channels);
  resource.native.image = { data: packed, width: state.width, height: state.height, depth: state.layers };
  resource.native.needsUpdate = true;
  notify(resource);
}

export function getGodotLayeredTextureLayerData(resource: GodotLayeredTextureResource, layer: unknown): GodotTextureImageData {
  const state = LAYERED_STATE.get(resource)!;
  const index = integer(layer, 'TextureLayered.get_layer_data.layer');
  const image = state.images[index];
  if (image === undefined) throw new RangeError(`godot-compat: layer ${index} is outside ${state.layers} layers.`);
  return copyImage(image, 'TextureLayered.layer');
}

export function createGodotImageTexture3D(): GodotTexture3DResource {
  const native = new Data3DTexture(new Uint8Array(4), 1, 1, 1);
  native.format = RGBAFormat; native.type = UnsignedByteType; native.wrapR = ClampToEdgeWrapping;
  applySampler(native, false);
  const resource = {
    __godotClass: 'ImageTexture3D' as const,
    native,
    get width(): number { return TEXTURE_3D_STATE.get(resource)!.width; },
    get height(): number { return TEXTURE_3D_STATE.get(resource)!.height; },
    get depth(): number { return TEXTURE_3D_STATE.get(resource)!.depth; },
    get format(): number { return TEXTURE_3D_STATE.get(resource)!.format; },
    get mipmaps(): boolean { return TEXTURE_3D_STATE.get(resource)!.mipmaps; },
    create(format: number, width: number, height: number, depth: number, mipmaps: boolean, data: readonly GodotTextureImageData[]) {
      createGodotImageTexture3DFromData(resource, format, width, height, depth, mipmaps, data);
    },
    update(data: readonly GodotTextureImageData[]) { updateGodotImageTexture3D(resource, data); },
    getData(): GodotTextureImageData[] { return getGodotImageTexture3DData(resource); },
  };
  TEXTURE_3D_STATE.set(resource, { width: 1, height: 1, depth: 1, format: 0, mipmaps: false, channels: 4, slices: [copyImage({ width: 1, height: 1, data: new Uint8Array(4) }, 'initial')] });
  registerGodotObjectIdentity(resource, 'ImageTexture3D');
  return resource;
}

export function createGodotImageTexture3DFromData(resource: GodotTexture3DResource, format: unknown, width: unknown, height: unknown, depth: unknown, mipmaps: unknown, data: readonly GodotTextureImageData[]): void {
  const w = integer(width, 'ImageTexture3D.create.width', 1), h = integer(height, 'ImageTexture3D.create.height', 1), d = integer(depth, 'ImageTexture3D.create.depth', 1);
  if (typeof mipmaps !== 'boolean') throw new TypeError('godot-compat: ImageTexture3D.create.mipmaps requires bool.');
  const copied = validateLayerSet(data, d, false);
  if (copied.length !== d || copied.some((image) => image.width !== w || image.height !== h)) {
    throw new RangeError('godot-compat: ImageTexture3D data must contain depth slices of width x height.');
  }
  const state = TEXTURE_3D_STATE.get(resource)!;
  state.width = w; state.height = h; state.depth = d; state.format = integer(format, 'ImageTexture3D.create.format');
  state.mipmaps = mipmaps; state.channels = copied[0]!.channels ?? 4; state.slices = copied;
  resource.native.image = { data: packLayers(copied, w, h, state.channels), width: w, height: h, depth: d };
  resource.native.format = threeFormat(state.channels); applySampler(resource.native, mipmaps); notify(resource);
}

export function updateGodotImageTexture3D(resource: GodotTexture3DResource, data: readonly GodotTextureImageData[]): void {
  const state = TEXTURE_3D_STATE.get(resource)!;
  createGodotImageTexture3DFromData(resource, state.format, state.width, state.height, state.depth, state.mipmaps, data);
}

export function getGodotImageTexture3DData(resource: GodotTexture3DResource): GodotTextureImageData[] {
  return TEXTURE_3D_STATE.get(resource)!.slices.map((image) => copyImage(image, 'ImageTexture3D.data'));
}

export function watchGodotLayeredTexture(resource: object, listener: () => void): () => void {
  let listeners = TEXTURE_LISTENERS.get(resource);
  if (listeners === undefined) { listeners = new Set(); TEXTURE_LISTENERS.set(resource, listeners); }
  listeners.add(listener); return () => listeners?.delete(listener);
}
