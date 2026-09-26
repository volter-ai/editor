/** Shared Texture2D value queries over the native Pixi and Three texture identities. */

import { Texture as PixiTexture } from 'pixi.js';
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapNearestFilter,
  RepeatWrapping,
  RGBAFormat,
  Texture as ThreeTexture,
  UnsignedByteType,
} from 'three';

import { createGodotImage, IMAGE_FORMAT, type GodotImage } from './image';
import {
  godotRenderingServerCanvasItemAddTextureRect,
  godotRenderingServerCanvasItemAddTextureRectRegion,
} from './canvas-server';
import type { GodotRid } from './gdscript-builtins';
import { godotResourceEmitChanged, godotResourceGetRid } from './resource-io';
import { registerGodotObjectIdentity } from './object';
import type { ColorValue } from './variant';
import { vec2, type Vector2 } from './vector2';

const TEXTURE_FLAG_MIPMAPS = 1;
const TEXTURE_FLAG_REPEAT = 2;
const TEXTURE_FLAG_FILTER = 4;
const TEXTURE_FLAG_MIRRORED_REPEAT = 32;
const NATIVE_TEXTURE_FLAGS =
  TEXTURE_FLAG_MIPMAPS | TEXTURE_FLAG_REPEAT | TEXTURE_FLAG_FILTER | TEXTURE_FLAG_MIRRORED_REPEAT;
const TEXTURE_FLAGS = new WeakMap<object, number>();

interface GodotTextureNativeCarrier {
  readonly three?: ThreeTexture;
  readonly pixi?: PixiTexture;
  get_flags?(): number;
  set_flags?(flags: number): void;
}

function integerTextureFlags(value: unknown): number {
  const flags = typeof value === 'boolean' ? Number(value) : value;
  if (typeof flags !== 'number' || !Number.isSafeInteger(flags) || flags < 0) {
    throw new RangeError('Texture.flags requires a non-negative integer.');
  }
  return flags;
}

function supportedTextureFlags(value: unknown): number {
  const flags = integerTextureFlags(value);
  if ((flags & ~NATIVE_TEXTURE_FLAGS) !== 0) {
    throw new Error(
      `Texture.flags ${flags} requires anisotropic, linear-conversion, or video-surface state not retained by this native texture.`,
    );
  }
  return flags;
}

function textureCarrier(texture: unknown, requireRetained: boolean): {
  readonly owner: object;
  readonly pixi: PixiTexture | null;
  readonly three: ThreeTexture | null;
} {
  if (texture instanceof PixiTexture) {
    if (requireRetained && !TEXTURE_FLAGS.has(texture)) {
      throw new TypeError('Texture.flags requires a retained Godot Texture flags owner, not a bare Pixi texture.');
    }
    return { owner: texture, pixi: texture, three: null };
  }
  if (texture instanceof ThreeTexture) {
    if (requireRetained && !TEXTURE_FLAGS.has(texture)) {
      throw new TypeError('Texture.flags requires a retained Godot Texture flags owner, not a bare Three texture.');
    }
    return { owner: texture, pixi: null, three: texture };
  }
  if (typeof texture === 'object' && texture !== null) {
    const carrier = texture as GodotTextureNativeCarrier;
    const pixi = carrier.pixi instanceof PixiTexture ? carrier.pixi : null;
    const three = carrier.three instanceof ThreeTexture ? carrier.three : null;
    if (pixi !== null || three !== null) {
      if (requireRetained && !TEXTURE_FLAGS.has(texture)) {
        throw new TypeError('Texture.flags requires a retained Godot Texture flags owner.');
      }
      return { owner: texture, pixi, three };
    }
  }
  throw new TypeError('Texture.flags requires a retained Pixi/Three/Godot texture resource.');
}

function applyNativeTextureFlags(texture: unknown, flags: number, requireRetained: boolean): void {
  const { owner, pixi, three } = textureCarrier(texture, requireRetained);
  const filter = (flags & TEXTURE_FLAG_FILTER) !== 0;
  const mipmaps = (flags & TEXTURE_FLAG_MIPMAPS) !== 0;
  const mirrored = (flags & TEXTURE_FLAG_MIRRORED_REPEAT) !== 0;
  const repeating = mirrored || (flags & TEXTURE_FLAG_REPEAT) !== 0;
  if (pixi !== null) {
    pixi.source.style.scaleMode = filter ? 'linear' : 'nearest';
    pixi.source.style.addressMode = mirrored ? 'mirror-repeat' : repeating ? 'repeat' : 'clamp-to-edge';
    pixi.source.autoGenerateMipmaps = mipmaps;
  }
  if (three !== null) {
    const wrapping = mirrored ? MirroredRepeatWrapping : repeating ? RepeatWrapping : ClampToEdgeWrapping;
    three.wrapS = wrapping;
    three.wrapT = wrapping;
    three.magFilter = filter ? LinearFilter : NearestFilter;
    three.minFilter = filter
      ? (mipmaps ? LinearMipmapLinearFilter : LinearFilter)
      : (mipmaps ? NearestMipmapNearestFilter : NearestFilter);
    three.generateMipmaps = mipmaps;
    three.needsUpdate = true;
  }
  TEXTURE_FLAGS.set(owner, flags);
}

/** Godot 3 Texture.flags over an exact retained renderer texture identity. */
export function getGodotTextureFlags(texture: unknown): number {
  if (typeof texture === 'object' && texture !== null) {
    const getter = (texture as GodotTextureNativeCarrier).get_flags;
    if (typeof getter === 'function') return supportedTextureFlags(getter.call(texture));
  }
  const { owner } = textureCarrier(texture, true);
  const flags = TEXTURE_FLAGS.get(owner);
  if (flags === undefined) throw new Error('Texture.flags retained state was not initialized.');
  return flags;
}

export function setGodotTextureFlags(texture: unknown, value: unknown): void {
  const flags = supportedTextureFlags(value);
  if (typeof texture === 'object' && texture !== null) {
    const setter = (texture as GodotTextureNativeCarrier).set_flags;
    if (typeof setter === 'function') {
      setter.call(texture, flags);
      return;
    }
  }
  applyNativeTextureFlags(texture, flags, true);
  godotResourceEmitChanged(texture);
}

/** Seat flags on a newly retained Godot Texture resource before it can be rendered. */
export function initializeGodotTextureFlags(texture: unknown, value: unknown = 7): void {
  applyNativeTextureFlags(texture, supportedTextureFlags(value), false);
}

interface GodotTextureDimensions {
  get_width?(): number;
  get_height?(): number;
  readonly size?: { readonly x: number; readonly y: number };
}

function validSize(width: number, height: number): Vector2 {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new Error(`Texture2D.get_size received invalid native dimensions ${String(width)}x${String(height)}.`);
  }
  return vec2(width, height);
}

/** Godot Texture2D.get_size() without wrapping the renderer-owned texture. */
export function getGodotTexture2DSize(texture: unknown): Vector2 {
  if (texture instanceof PixiTexture) return validSize(texture.width, texture.height);
  if (texture instanceof ThreeTexture) {
    const image = texture.image as { readonly width?: unknown; readonly height?: unknown } | undefined;
    const source = texture.source.data as { readonly width?: unknown; readonly height?: unknown } | undefined;
    const width = image?.width ?? source?.width;
    const height = image?.height ?? source?.height;
    if (typeof width === 'number' && typeof height === 'number') return validSize(width, height);
  }
  if (typeof texture === 'object' && texture !== null) {
    const value = texture as GodotTextureDimensions;
    if (typeof value.get_width === 'function' && typeof value.get_height === 'function') {
      return validSize(value.get_width(), value.get_height());
    }
    if (value.size !== undefined) return validSize(value.size.x, value.size.y);
  }
  throw new TypeError('Texture2D.get_size requires a retained Pixi/Three/Godot texture resource.');
}

export function getGodotTexture2DWidth(texture: unknown): number {
  return getGodotTexture2DSize(texture).x;
}

export function getGodotTexture2DHeight(texture: unknown): number {
  return getGodotTexture2DSize(texture).y;
}

interface PixelSource {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

function pixelSource(value: unknown): PixelSource | null {
  if (typeof ImageData !== 'undefined' && value instanceof ImageData) {
    return { width: value.width, height: value.height, data: value.data };
  }
  if (typeof value === 'object' && value !== null) {
    const width = Reflect.get(value, 'width');
    const height = Reflect.get(value, 'height');
    const data = Reflect.get(value, 'data') ?? Reflect.get(value, 'resource');
    if (
      typeof width === 'number' && Number.isSafeInteger(width) && width > 0 &&
      typeof height === 'number' && Number.isSafeInteger(height) && height > 0 &&
      (data instanceof Uint8Array || data instanceof Uint8ClampedArray) &&
      data.byteLength === width * height * 4
    ) {
      return { width, height, data };
    }
    const getContext = Reflect.get(value, 'getContext');
    if (typeof getContext === 'function') {
      const context = getContext.call(value, '2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
      if (context !== null && typeof width === 'number' && typeof height === 'number') {
        const pixels = context.getImageData(0, 0, width, height);
        return { width, height, data: pixels.data };
      }
    }
    if (
      typeof document !== 'undefined' && typeof width === 'number' && width > 0 &&
      typeof height === 'number' && height > 0 &&
      typeof Reflect.get(value, 'complete') === 'boolean'
    ) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context !== null) {
        context.drawImage(value as CanvasImageSource, 0, 0);
        const pixels = context.getImageData(0, 0, width, height);
        return { width, height, data: pixels.data };
      }
    }
  }
  return null;
}

function nativePixelSource(texture: PixiTexture | ThreeTexture): PixelSource | null {
  if (texture instanceof PixiTexture) {
    return pixelSource(texture.source.resource);
  }
  return pixelSource(texture.image) ?? pixelSource(texture.source.data);
}

export function getGodotTexture2DImage(texture: unknown): GodotImage | null {
  if (typeof texture === 'object' && texture !== null) {
    const getter = Reflect.get(texture, 'get_image') ?? Reflect.get(texture, 'get_data');
    if (typeof getter === 'function') {
      const result = getter.call(texture) as GodotImage | null;
      if (result !== null) return result;
    }
  }
  if (!(texture instanceof PixiTexture) && !(texture instanceof ThreeTexture)) {
    throw new TypeError('Texture2D.get_image requires a retained Pixi/Three/Godot texture resource.');
  }
  const source = nativePixelSource(texture);
  if (source === null) {
    throw new Error('Texture2D.get_image cannot synchronously read this native GPU/image source.');
  }
  if (texture instanceof PixiTexture) {
    const frame = texture.frame;
    const width = Math.floor(frame.width);
    const height = Math.floor(frame.height);
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      const sourceOffset = ((Math.floor(frame.y) + y) * source.width + Math.floor(frame.x)) * 4;
      rgba.set(source.data.subarray(sourceOffset, sourceOffset + width * 4), y * width * 4);
    }
    return createGodotImage(width, height, false, IMAGE_FORMAT.FORMAT_RGBA8, rgba);
  }
  return createGodotImage(source.width, source.height, false, IMAGE_FORMAT.FORMAT_RGBA8, source.data);
}

export function getGodotTexture2DFormat(texture: unknown): number {
  const image = getGodotTexture2DImage(texture);
  return image?.format ?? IMAGE_FORMAT.FORMAT_RGBA8;
}

export function godotTexture2DHasAlpha(texture: unknown): boolean {
  const image = getGodotTexture2DImage(texture);
  return image !== null && (<readonly number[]>[
    IMAGE_FORMAT.FORMAT_LA8,
    IMAGE_FORMAT.FORMAT_RGBA8,
    IMAGE_FORMAT.FORMAT_RGBA4444,
    IMAGE_FORMAT.FORMAT_RGBAF,
    IMAGE_FORMAT.FORMAT_RGBAH,
    IMAGE_FORMAT.FORMAT_RGBA16,
    IMAGE_FORMAT.FORMAT_RGBA16I,
  ]).includes(image.format);
}

export function godotTexture2DHasMipmaps(texture: unknown): boolean {
  if (typeof texture === 'object' && texture !== null) {
    const getter = Reflect.get(texture, 'has_mipmaps');
    if (typeof getter === 'function') return Boolean(getter.call(texture));
  }
  if (texture instanceof PixiTexture) {
    return texture.source.autoGenerateMipmaps;
  }
  if (texture instanceof ThreeTexture) {
    return texture.generateMipmaps || texture.mipmaps.length > 0;
  }
  const carrier = textureCarrier(texture, false);
  if (carrier.three !== null) return carrier.three.generateMipmaps || carrier.three.mipmaps.length > 0;
  if (carrier.pixi !== null) {
    return carrier.pixi.source.autoGenerateMipmaps;
  }
  return false;
}

export function getGodotTexture2DMipmapCount(texture: unknown): number {
  if (typeof texture === 'object' && texture !== null) {
    const getter = Reflect.get(texture, 'get_mipmap_count');
    if (typeof getter === 'function') {
      const count = getter.call(texture) as unknown;
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('Texture2D.get_mipmap_count received an invalid retained mip count.');
      }
      return count;
    }
  }
  if (!godotTexture2DHasMipmaps(texture)) return 0;
  const size = getGodotTexture2DSize(texture);
  return Math.floor(Math.log2(Math.max(size.x, size.y)));
}

export function godotTexture2DIsPixelOpaque(texture: unknown, x: number, y: number): boolean {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new TypeError('Texture2D.is_pixel_opaque requires integer coordinates.');
  }
  const size = getGodotTexture2DSize(texture);
  if (x < 0 || y < 0 || x >= size.x || y >= size.y) return false;
  const image = getGodotTexture2DImage(texture);
  if (image === null) return false;
  const pixel = image.get_pixel(x, y);
  return pixel.a >= 0.5;
}

/** GPU-backed placeholder with the source texture's dimensions and magenta missing-resource texels. */
export function createGodotTexture2DPlaceholder(texture: unknown): ThreeTexture {
  const size = getGodotTexture2DSize(texture);
  const width = Math.max(1, Math.trunc(size.x));
  const height = Math.max(1, Math.trunc(size.y));
  const pixels = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const pixel = offset / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const dark = ((x >> 3) + (y >> 3)) % 2 === 0;
    pixels[offset] = dark ? 255 : 40;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = dark ? 255 : 40;
    pixels[offset + 3] = 255;
  }
  const placeholder = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  placeholder.needsUpdate = true;
  initializeGodotTextureFlags(placeholder, TEXTURE_FLAG_FILTER);
  return placeholder;
}

export interface GodotTexture2DCanvasApi {
  draw(
    canvasItem: GodotRid,
    position: Vector2,
    modulate?: ColorValue,
    transpose?: boolean,
  ): void;
  draw_rect(
    canvasItem: GodotRid,
    rect: { readonly position: Vector2; readonly size: Vector2 },
    tile?: boolean,
    modulate?: ColorValue,
    transpose?: boolean,
  ): void;
  draw_rect_region(
    canvasItem: GodotRid,
    rect: { readonly position: Vector2; readonly size: Vector2 },
    sourceRect: { readonly position: Vector2; readonly size: Vector2 },
    modulate?: ColorValue,
    transpose?: boolean,
    clipUv?: boolean,
  ): void;
  get_width(): number;
  get_height(): number;
  get_size(): Vector2;
  has_alpha(): boolean;
  is_pixel_opaque(x: number, y: number): boolean;
  get_image(): GodotImage | null;
  get_rid(): GodotRid;
}

const WHITE: ColorValue = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

/** Godot 4's concrete `Texture2D.new()` carrier: an empty retained renderer texture. */
export function createGodotTexture2D(): ThreeTexture {
  const texture = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  texture.needsUpdate = true;
  registerGodotObjectIdentity(texture, 'Texture2D');
  return bindGodotTexture2DCanvasApi(texture);
}

/** Retain one loader-owned native texture as the corresponding Godot file Texture Resource. */
export function retainGodotNativeTextureResource<T extends object>(
  texture: T,
  godotMajor: 3 | 4,
): T & GodotTexture2DCanvasApi {
  registerGodotObjectIdentity(texture, godotMajor === 3 ? 'Texture' : 'Texture2D');
  return bindGodotTexture2DCanvasApi(texture);
}

function defineTextureMethod(texture: object, member: string, method: (...args: never[]) => unknown): void {
  if (typeof Reflect.get(texture, member) === 'function') return;
  Object.defineProperty(texture, member, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: method,
  });
}

/** Install Texture2D's native draw/query vocabulary directly on the renderer texture identity. */
export function bindGodotTexture2DCanvasApi<T extends object>(texture: T): T & GodotTexture2DCanvasApi {
  defineTextureMethod(texture, 'draw', ((
    canvasItem: GodotRid,
    position: Vector2,
    modulate: ColorValue = WHITE,
    transpose = false,
  ): void => {
    const size = getGodotTexture2DSize(texture);
    godotRenderingServerCanvasItemAddTextureRect(
      canvasItem,
      { position, size },
      godotResourceGetRid(texture),
      false,
      modulate,
      transpose,
    );
  }) as (...args: never[]) => unknown);
  defineTextureMethod(texture, 'draw_rect', ((
    canvasItem: GodotRid,
    rect: { readonly position: Vector2; readonly size: Vector2 },
    tile = false,
    modulate: ColorValue = WHITE,
    transpose = false,
  ): void => {
    godotRenderingServerCanvasItemAddTextureRect(
      canvasItem,
      rect,
      godotResourceGetRid(texture),
      tile,
      modulate,
      transpose,
    );
  }) as (...args: never[]) => unknown);
  defineTextureMethod(texture, 'draw_rect_region', ((
    canvasItem: GodotRid,
    rect: { readonly position: Vector2; readonly size: Vector2 },
    sourceRect: { readonly position: Vector2; readonly size: Vector2 },
    modulate: ColorValue = WHITE,
    transpose = false,
    clipUv = true,
  ): void => {
    godotRenderingServerCanvasItemAddTextureRectRegion(
      canvasItem,
      rect,
      godotResourceGetRid(texture),
      sourceRect,
      modulate,
      transpose,
      clipUv,
    );
  }) as (...args: never[]) => unknown);
  defineTextureMethod(texture, 'get_width', (() => getGodotTexture2DWidth(texture)) as (...args: never[]) => unknown);
  defineTextureMethod(texture, 'get_height', (() => getGodotTexture2DHeight(texture)) as (...args: never[]) => unknown);
  defineTextureMethod(texture, 'get_size', (() => getGodotTexture2DSize(texture)) as (...args: never[]) => unknown);
  defineTextureMethod(texture, 'has_alpha', (() => godotTexture2DHasAlpha(texture)) as (...args: never[]) => unknown);
  defineTextureMethod(texture, 'is_pixel_opaque', ((x: number, y: number) =>
    godotTexture2DIsPixelOpaque(texture, x, y)) as (...args: never[]) => unknown);
  defineTextureMethod(texture, 'get_image', (() => getGodotTexture2DImage(texture)) as (...args: never[]) => unknown);
  defineTextureMethod(texture, 'get_rid', (() => godotResourceGetRid(texture)) as (...args: never[]) => unknown);
  return texture as T & GodotTexture2DCanvasApi;
}
