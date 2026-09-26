/** ImageTexture binding: one mutable Godot Image resource backed by one native Pixi Texture. */

import { BufferImageSource, Texture } from 'pixi.js';
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapNearestFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
} from 'three';
import { registerGodotObjectIdentity } from './object';
import { createGodotImage, type GodotImage } from './image';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import { bindGodotTexture2DCanvasApi } from './texture-2d';

export interface GodotImageTexture {
  readonly texture: Texture;
  readonly threeTexture: CanvasTexture | DataTexture;
  create(width: number, height: number, format: number, flags?: number): void;
  create_from_image(image: GodotImage, flags?: number): void;
  set_image(image: GodotImage): void;
  update(image: GodotImage): void;
  get_image(): GodotImage | null;
  get_format(): number;
  get_width(): number;
  get_height(): number;
  get_size(): { x: number; y: number };
  has_alpha(): boolean;
  set_flags(flags: number): void;
  get_flags(): number;
  storage: number;
  set_storage(storage: number): void;
  get_storage(): number;
  set_size_override(size: { x: number; y: number }): void;
}

export interface GodotFloatImageTexture extends GodotImageTexture { readonly threeTexture: DataTexture; }

const imageCopy = (image: GodotImage): GodotImage =>
  createGodotImage(image.width, image.height, image.has_mipmaps(), image.format, image.get_data());

function applyTextureFlags(
  texture: Texture,
  threeTexture: CanvasTexture | DataTexture,
  flags: number,
  hasMipmaps: boolean,
): void {
  const filter = (flags & 4) !== 0;
  const mipmaps = (flags & 1) !== 0 && hasMipmaps;
  const mirrored = (flags & 32) !== 0;
  const repeating = mirrored || (flags & 2) !== 0;
  texture.source.style.scaleMode = filter ? 'linear' : 'nearest';
  texture.source.style.addressMode = mirrored ? 'mirror-repeat' : repeating ? 'repeat' : 'clamp-to-edge';
  texture.source.autoGenerateMipmaps = mipmaps;
  const wrapping = mirrored ? MirroredRepeatWrapping : repeating ? RepeatWrapping : ClampToEdgeWrapping;
  threeTexture.wrapS = wrapping;
  threeTexture.wrapT = wrapping;
  threeTexture.magFilter = filter ? LinearFilter : NearestFilter;
  threeTexture.minFilter = filter
    ? (mipmaps ? LinearMipmapLinearFilter : LinearFilter)
    : (mipmaps ? NearestMipmapNearestFilter : NearestFilter);
  threeTexture.generateMipmaps = mipmaps;
  threeTexture.anisotropy = (flags & 8) !== 0 ? 16 : 1;
  threeTexture.needsUpdate = true;
}

function newCanvas(): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('ImageTexture requires a browser Canvas to create its native Pixi Texture');
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

function drawImageToCanvas(image: GodotImage, canvas = newCanvas()): HTMLCanvasElement {
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('ImageTexture could not acquire a 2D Canvas context');
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  if (image.format >= 8) {
    throw new Error(
      `ImageTexture cannot preserve Image format ${image.format}: Canvas/Pixi storage is 8-bit normalized`,
    );
  }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const color = image.get_pixel(x, y);
      if ([color.r, color.g, color.b, color.a].some((channel) => channel < 0 || channel > 1)) {
        throw new Error('ImageTexture cannot preserve an out-of-range HDR color in native Canvas/Pixi storage');
      }
      const offset = (y * image.width + x) * 4;
      rgba[offset] = Math.round(Math.max(0, Math.min(1, color.r)) * 255);
      rgba[offset + 1] = Math.round(Math.max(0, Math.min(1, color.g)) * 255);
      rgba[offset + 2] = Math.round(Math.max(0, Math.min(1, color.b)) * 255);
      rgba[offset + 3] = Math.round(Math.max(0, Math.min(1, color.a)) * 255);
    }
  }
  context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  return canvas;
}

function imageMipmapCanvases(image: GodotImage): HTMLCanvasElement[] {
  const result: HTMLCanvasElement[] = [];
  const bytes = Uint8Array.from(image.get_data());
  let width = image.width;
  let height = image.height;
  for (let level = 1; level <= image.get_mipmap_count(); level += 1) {
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
    const offset = image.get_mipmap_offset(level);
    const end = level === image.get_mipmap_count() ? bytes.byteLength : image.get_mipmap_offset(level + 1);
    const mipmap = createGodotImage(width, height, false, image.format, bytes.subarray(offset, end));
    result.push(drawImageToCanvas(mipmap));
  }
  return result;
}

export function createGodotImageTexture(initial?: GodotImage, major: 3 | 4 = 4): GodotImageTexture {
  if (initial?.is_empty()) throw new Error('ImageTexture.create_from_image requires a non-empty Image');
  let image = initial === undefined ? null : imageCopy(initial);
  const canvas = image === null ? newCanvas() : drawImageToCanvas(image);
  const texture = Texture.from(canvas);
  const threeTexture = new CanvasTexture(canvas);
  texture.source.autoGenerateMipmaps = image?.has_mipmaps() ?? false;
  threeTexture.generateMipmaps = false;
  threeTexture.mipmaps = image === null ? [] : imageMipmapCanvases(image);
  const nativeTextureUpdate = texture.update.bind(texture);
  let width = image?.width ?? 0;
  let height = image?.height ?? 0;
  let format = image?.format ?? 0;
  let flags = major === 3 ? 7 : 0;
  let flagsActive = major === 3;
  let storage = 0;
  if (flagsActive) applyTextureFlags(texture, threeTexture, flags, image?.has_mipmaps() ?? false);

  const replace = (next: GodotImage, requireSameSize: boolean): void => {
    if (next.is_empty()) return;
    if (requireSameSize && image === null) throw new Error('ImageTexture.update requires an initialized texture');
    if (requireSameSize && image !== null && (next.width !== width || next.height !== height || next.format !== format || next.has_mipmaps() !== image.has_mipmaps())) {
      throw new Error('ImageTexture.update requires the existing width, height, format, and mipmap status');
    }
    image = imageCopy(next);
    if (!requireSameSize) {
      width = next.width;
      height = next.height;
      format = next.format;
    }
    const nextCanvas = drawImageToCanvas(image);
    canvas.width = nextCanvas.width;
    canvas.height = nextCanvas.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('ImageTexture lost its native 2D Canvas context');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(nextCanvas, 0, 0);
    texture.source.autoGenerateMipmaps = image.has_mipmaps();
    texture.source.update();
    if (image.has_mipmaps()) texture.source.updateMipmaps();
    nativeTextureUpdate();
    threeTexture.mipmaps = imageMipmapCanvases(image);
    if (flagsActive) applyTextureFlags(texture, threeTexture, flags, image.has_mipmaps());
    threeTexture.needsUpdate = true;
  };

  const methods = {
    create(nextWidth: number, nextHeight: number, nextFormat: number, nextFlags = 7) {
      if (!Number.isSafeInteger(nextWidth) || nextWidth <= 0 || !Number.isSafeInteger(nextHeight) || nextHeight <= 0) {
        throw new RangeError('ImageTexture.create requires positive integer dimensions.');
      }
      if (!Number.isSafeInteger(nextFormat)) throw new TypeError('ImageTexture.create format must be an integer.');
      if (!Number.isSafeInteger(nextFlags) || nextFlags < 0) throw new RangeError('ImageTexture.create flags must be a non-negative integer.');
      flags = nextFlags;
      flagsActive = true;
      replace(createGodotImage(nextWidth, nextHeight, false, nextFormat), false);
      godotResourceEmitChanged(texture);
    },
    create_from_image(next: GodotImage, nextFlags?: number) {
      if (nextFlags !== undefined) {
        if (!Number.isSafeInteger(nextFlags) || nextFlags < 0) throw new RangeError('ImageTexture.create_from_image flags must be a non-negative integer.');
        flags = nextFlags;
        flagsActive = true;
      }
      replace(next, false);
      godotResourceEmitChanged(texture);
    },
    set_image(next) { replace(next, false); godotResourceEmitChanged(texture); },
    update(next?: GodotImage) {
      // Pixi owns this native method name too. Preserve its zero-argument protocol while exposing
      // Godot ImageTexture.update(Image) on the same retained Texture identity.
      if (next === undefined) nativeTextureUpdate();
      else { replace(next, true); godotResourceEmitChanged(texture); }
    },
    get_image() { return image === null ? null : imageCopy(image); },
    get_format() { return format; },
    get_width() { return width; },
    get_height() { return height; },
    get_size() { return { x: width, y: height }; },
    has_alpha() { return format === 1 || format === 5 || format === 6; },
    set_flags(nextFlags: number) {
      if (!Number.isSafeInteger(nextFlags) || nextFlags < 0) throw new RangeError('ImageTexture.set_flags requires a non-negative integer.');
      if (nextFlags === flags) return;
      flags = nextFlags;
      flagsActive = true;
      applyTextureFlags(texture, threeTexture, flags, image?.has_mipmaps() ?? false);
      godotResourceEmitChanged(texture);
    },
    get_flags() { return flags; },
    set_storage(value: number) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 2) {
        throw new RangeError('ImageTexture.storage requires STORAGE_RAW, STORAGE_COMPRESS_LOSSY, or STORAGE_COMPRESS_LOSSLESS.');
      }
      if (value === storage) return;
      storage = value;
    },
    get_storage() { return storage; },
    set_size_override(size) {
      if (!Number.isSafeInteger(size.x) || !Number.isSafeInteger(size.y)) {
        throw new Error('ImageTexture.set_size_override requires integer dimensions');
      }
      if (size.x !== 0) width = size.x;
      if (size.y !== 0) height = size.y;
      godotResourceEmitChanged(texture);
    },
  } satisfies Omit<GodotImageTexture, 'texture' | 'threeTexture' | 'storage'>;
  const install = <T extends Texture | CanvasTexture>(native: T): T & GodotImageTexture => {
    const api = native as T & GodotImageTexture;
    Object.defineProperties(api, {
      texture: { value: texture, enumerable: false },
      threeTexture: { value: threeTexture, enumerable: false },
      storage: {
        configurable: true,
        enumerable: true,
        get: () => storage,
        set: (value: number) => methods.set_storage(value),
      },
    });
    Object.assign(api, methods);
    registerGodotObjectIdentity(api, 'ImageTexture');
    return api;
  };
  const api = install(texture);
  install(threeTexture);
  bindGodotResourceProtocol(api, {
    createDuplicate(source) {
      const sourceImage = source.get_image();
      const target = createGodotImageTexture(sourceImage ?? undefined, major);
      target.set_flags(source.get_flags());
      target.storage = source.storage;
      target.set_size_override(source.get_size());
      return target as typeof source;
    },
  });
  return bindGodotTexture2DCanvasApi(api);
}

export function createGodotImageTextureFromImage(image: GodotImage): GodotImageTexture {
  return createGodotImageTexture(image);
}

export function createGodotImageTexture3D(initial?: GodotImage, major: 3 | 4 = 4): GodotImageTexture {
  return createGodotImageTexture(initial, major).threeTexture as CanvasTexture & GodotImageTexture;
}

export function createGodotImageTextureFromImage3D(image: GodotImage): GodotImageTexture {
  return createGodotImageTexture3D(image);
}

/** Native Three handle for a retained ImageTexture; the handle shares and tracks the same canvas. */
export function imageTextureForThree(texture: GodotImageTexture): CanvasTexture | DataTexture {
  return texture.threeTexture;
}

function floatPixels(image: GodotImage): { readonly data: Float32Array; readonly channels: 1 | 4 } {
  if (image.format !== 5 && image.format !== 8 && image.format !== 10 && image.format !== 11) {
    throw new Error(`Float ImageTexture requires Image RGBA8, RF, RGBF, or RGBAF; received format ${image.format}`);
  }
  const channels = image.format === 8 ? 1 : 4;
  const data = new Float32Array(image.width * image.height * channels);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const color = image.get_pixel(x, y);
    const index = (x + y * image.width) * channels;
    data[index] = color.r;
    if (channels === 4) {
      data[index + 1] = color.g;
      data[index + 2] = color.b;
      data[index + 3] = image.format === 10 ? 1 : color.a;
    }
  }
  return { data, channels };
}

/** Float ImageTexture lower rung for procedural RGBAF/RGBF/RF resources. */
export function createGodotFloatImageTexture(initial: GodotImage): GodotFloatImageTexture {
  if (initial.is_empty()) throw new Error('Float ImageTexture requires a non-empty Image');
  let image = imageCopy(initial);
  let pixels = floatPixels(image);
  const source = new BufferImageSource({
    resource: pixels.data,
    width: image.width,
    height: image.height,
    format: pixels.channels === 1 ? 'r32float' : 'rgba32float',
    alphaMode: 'no-premultiply-alpha',
  });
  const texture = new Texture({ source });
  const threeTexture = new DataTexture(
    pixels.data,
    image.width,
    image.height,
    pixels.channels === 1 ? RedFormat : RGBAFormat,
    FloatType,
  );
  threeTexture.needsUpdate = true;
  let width = image.width;
  let height = image.height;
  let format = image.format;
  let flags = 0;
  let flagsActive = false;

  const replace = (next: GodotImage, sameShape: boolean): void => {
    const nextPixels = floatPixels(next);
    if (sameShape && (next.width !== width || next.height !== height || next.format !== format)) {
      throw new Error('Float ImageTexture.update requires identical dimensions and format');
    }
    image = imageCopy(next);
    pixels = nextPixels;
    width = next.width;
    height = next.height;
    format = next.format;
    source.resource = pixels.data;
    source.resize(width, height);
    source.update();
    threeTexture.image = { data: pixels.data, width, height };
    threeTexture.format = pixels.channels === 1 ? RedFormat : RGBAFormat;
    if (flagsActive) applyTextureFlags(texture, threeTexture, flags, image.has_mipmaps());
    threeTexture.needsUpdate = true;
  };
  const methods = {
    create(nextWidth: number, nextHeight: number, nextFormat: number, nextFlags = 7) {
      if (!Number.isSafeInteger(nextWidth) || nextWidth <= 0 || !Number.isSafeInteger(nextHeight) || nextHeight <= 0) {
        throw new RangeError('Float ImageTexture.create requires positive integer dimensions.');
      }
      if (!Number.isSafeInteger(nextFlags) || nextFlags < 0) throw new RangeError('Float ImageTexture.create flags must be a non-negative integer.');
      flags = nextFlags;
      flagsActive = true;
      replace(createGodotImage(nextWidth, nextHeight, false, nextFormat), false);
      godotResourceEmitChanged(texture);
    },
    create_from_image(next: GodotImage, nextFlags?: number) {
      if (nextFlags !== undefined) {
        if (!Number.isSafeInteger(nextFlags) || nextFlags < 0) throw new RangeError('Float ImageTexture.create_from_image flags must be a non-negative integer.');
        flags = nextFlags;
        flagsActive = true;
      }
      replace(next, false);
      godotResourceEmitChanged(texture);
    },
    set_image(next: GodotImage) { replace(next, false); godotResourceEmitChanged(texture); },
    update(next?: GodotImage) { if (next === undefined) source.update(); else { replace(next, true); godotResourceEmitChanged(texture); } },
    get_image: () => imageCopy(image),
    get_format: () => format,
    get_width: () => width,
    get_height: () => height,
    get_size: () => ({ x: width, y: height }),
    has_alpha: () => format === 5 || format === 11 || format === 15 || format === 42 || format === 46,
    set_flags(nextFlags: number) {
      if (!Number.isSafeInteger(nextFlags) || nextFlags < 0) throw new RangeError('Float ImageTexture.set_flags requires a non-negative integer.');
      if (nextFlags === flags) return;
      flags = nextFlags;
      flagsActive = true;
      applyTextureFlags(texture, threeTexture, flags, image.has_mipmaps());
      godotResourceEmitChanged(texture);
    },
    get_flags: () => flags,
    set_size_override(size: { x: number; y: number }) {
      if (!Number.isSafeInteger(size.x) || !Number.isSafeInteger(size.y)) throw new Error('Float ImageTexture.set_size_override requires integer dimensions');
      if (size.x !== 0) width = size.x;
      if (size.y !== 0) height = size.y;
      godotResourceEmitChanged(texture);
    },
  };
  const install = <T extends Texture | DataTexture>(native: T): T & GodotFloatImageTexture => {
    const api = native as T & GodotFloatImageTexture;
    Object.defineProperties(api, {
      texture: { value: texture, enumerable: false },
      threeTexture: { value: threeTexture, enumerable: false },
    });
    Object.assign(api, methods);
    registerGodotObjectIdentity(api, 'ImageTexture');
    return api;
  };
  const api = install(texture);
  install(threeTexture);
  bindGodotResourceProtocol(api, {
    createDuplicate(sourceTexture) {
      const sourceImage = sourceTexture.get_image();
      if (sourceImage === null) throw new Error('Float ImageTexture duplicate lost its Image source');
      const target = createGodotFloatImageTexture(sourceImage);
      target.set_flags(sourceTexture.get_flags());
      target.set_size_override(sourceTexture.get_size());
      return target as typeof sourceTexture;
    },
  });
  return bindGodotTexture2DCanvasApi(api);
}
