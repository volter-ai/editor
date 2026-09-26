/** PortableCompressedTexture2D decoded into the same retained native ImageTexture identity. */

import type { Texture } from 'pixi.js';
import type { GodotImage } from './image';
import { createGodotImageTexture, type GodotImageTexture } from './image-texture';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import { vec2, type Vector2 } from './vector2';

export const PORTABLE_COMPRESSION_MODE_LOSSLESS = 0;
export const PORTABLE_COMPRESSION_MODE_LOSSY = 1;
export const PORTABLE_COMPRESSION_MODE_BASIS_UNIVERSAL = 2;
export const PORTABLE_COMPRESSION_MODE_S3TC = 3;
export const PORTABLE_COMPRESSION_MODE_ETC2 = 4;
export const PORTABLE_COMPRESSION_MODE_BPTC = 5;

export interface GodotPortableCompressedTexture2D extends GodotImageTexture {
  readonly texture: Texture;
  compression_mode: number;
  size_override: Vector2;
  keep_compressed_buffer: boolean;
  normal_map: boolean;
  lossy_quality: number;
  create_from_image(
    image: GodotImage,
    compressionMode?: number,
    normalMap?: boolean,
    lossyQuality?: number,
  ): void;
  set_compression_mode(mode: number): void;
  get_compression_mode(): number;
  set_size_override(size: Vector2): void;
  get_size_override(): Vector2;
  set_keep_compressed_buffer(enabled: boolean): void;
  is_keeping_compressed_buffer(): boolean;
  set_normal_map(enabled: boolean): void;
  is_normal_map(): boolean;
  set_lossy_quality(quality: number): void;
  get_lossy_quality(): number;
}

function compressionMode(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 5) {
    throw new RangeError('PortableCompressedTexture2D.compression_mode requires a CompressionMode value in [0, 5].');
  }
  return value;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`PortableCompressedTexture2D.${member} requires bool.`);
  return value;
}

function quality(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('PortableCompressedTexture2D.lossy_quality requires a finite value in [0, 1].');
  }
  return value;
}

function size(value: unknown): Vector2 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('PortableCompressedTexture2D.size_override requires a Vector2.');
  }
  const x = Reflect.get(value, 'x');
  const y = Reflect.get(value, 'y');
  if (
    typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0 ||
    typeof y !== 'number' || !Number.isSafeInteger(y) || y < 0
  ) {
    throw new RangeError('PortableCompressedTexture2D.size_override requires non-negative integer dimensions.');
  }
  return vec2(x, y);
}

export function createGodotPortableCompressedTexture2D(
  initial?: GodotImage,
): GodotPortableCompressedTexture2D {
  const resource = createGodotImageTexture(initial) as GodotPortableCompressedTexture2D;
  const nativeCreateFromImage = resource.create_from_image.bind(resource);
  const nativeGetImage = resource.get_image.bind(resource);
  let mode = PORTABLE_COMPRESSION_MODE_LOSSLESS;
  let override = vec2();
  let keepBuffer = false;
  let normalMap = false;
  let lossyQuality = 0.8;

  const logicalWidth = (): number => {
    if (override.x > 0) return override.x;
    return nativeGetImage()?.width ?? 0;
  };
  const logicalHeight = (): number => {
    if (override.y > 0) return override.y;
    return nativeGetImage()?.height ?? 0;
  };
  Object.defineProperties(resource, {
    compression_mode: { configurable: true, enumerable: true, get: () => mode, set: (value: number) => resource.set_compression_mode(value) },
    size_override: { configurable: true, enumerable: true, get: () => vec2(override.x, override.y), set: (value: Vector2) => resource.set_size_override(value) },
    keep_compressed_buffer: { configurable: true, enumerable: true, get: () => keepBuffer, set: (value: boolean) => resource.set_keep_compressed_buffer(value) },
    normal_map: { configurable: true, enumerable: true, get: () => normalMap, set: (value: boolean) => resource.set_normal_map(value) },
    lossy_quality: { configurable: true, enumerable: true, get: () => lossyQuality, set: (value: number) => resource.set_lossy_quality(value) },
  });
  Object.assign(resource, {
    create_from_image(
      image: GodotImage,
      nextMode = PORTABLE_COMPRESSION_MODE_LOSSLESS,
      nextNormalMap = false,
      nextLossyQuality = 0.8,
    ): void {
      mode = compressionMode(nextMode);
      normalMap = boolean(nextNormalMap, 'normal_map');
      lossyQuality = quality(nextLossyQuality);
      nativeCreateFromImage(image);
      godotResourceEmitChanged(resource);
    },
    set_compression_mode(value: number): void {
      const next = compressionMode(value);
      if (next === mode) return;
      mode = next;
      godotResourceEmitChanged(resource);
    },
    get_compression_mode: (): number => mode,
    set_size_override(value: Vector2): void {
      const next = size(value);
      if (next.x === override.x && next.y === override.y) return;
      override = next;
      godotResourceEmitChanged(resource);
    },
    get_size_override: (): Vector2 => vec2(override.x, override.y),
    set_keep_compressed_buffer(value: boolean): void {
      const next = boolean(value, 'keep_compressed_buffer');
      if (next === keepBuffer) return;
      keepBuffer = next;
      godotResourceEmitChanged(resource);
    },
    is_keeping_compressed_buffer: (): boolean => keepBuffer,
    set_normal_map(value: boolean): void {
      const next = boolean(value, 'normal_map');
      if (next === normalMap) return;
      normalMap = next;
      godotResourceEmitChanged(resource);
    },
    is_normal_map: (): boolean => normalMap,
    set_lossy_quality(value: number): void {
      const next = quality(value);
      if (next === lossyQuality) return;
      lossyQuality = next;
      godotResourceEmitChanged(resource);
    },
    get_lossy_quality: (): number => lossyQuality,
    get_width: logicalWidth,
    get_height: logicalHeight,
    get_size: (): Vector2 => vec2(logicalWidth(), logicalHeight()),
  });
  registerGodotObjectIdentity(resource.texture, 'PortableCompressedTexture2D');
  bindGodotResourceProtocol(resource, {
    createDuplicate(source) {
      const copy = createGodotPortableCompressedTexture2D(source.get_image() ?? undefined);
      copy.compression_mode = source.compression_mode;
      copy.size_override = source.size_override;
      copy.keep_compressed_buffer = source.keep_compressed_buffer;
      copy.normal_map = source.normal_map;
      copy.lossy_quality = source.lossy_quality;
      return copy;
    },
  });
  return resource;
}
