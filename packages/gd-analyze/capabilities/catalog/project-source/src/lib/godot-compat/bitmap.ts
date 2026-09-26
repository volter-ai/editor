/** Godot BitMap's compact boolean raster protocol. */

import { createGodotImage, IMAGE_FORMAT, type GodotImage, type ImageRect } from './image';
import { registerGodotObjectIdentity } from './object';
import { getGodotTexture2DImage } from './texture-2d';
import { type Vector2, vec2 } from './vector2';

export interface GodotBitMap {
  create(size: Vector2): void;
  create_from_image_alpha(image: GodotImage, threshold?: number): void;
  get_size(): Vector2;
  resize(size: Vector2): void;
  set_bit(x: number, y: number, bit: boolean): void;
  set_bitv(position: Vector2, bit: boolean): void;
  get_bit(x: number, y: number): boolean;
  get_bitv(position: Vector2): boolean;
  set_bit_rect(rect: ImageRect, bit: boolean): void;
  get_true_bit_count(): number;
  grow_mask(pixels: number, rect: ImageRect): void;
  convert_to_image(): GodotImage;
  opaque_to_polygons(rect: ImageRect, epsilon?: number): Vector2[][];
}

export interface GodotPackedBitMapData {
  readonly width: number;
  readonly height: number;
  /** Godot stores pixel n in bit `n & 7` of byte `n >> 3`, least-significant bit first. */
  readonly bytes: readonly number[] | Uint8Array;
}

/** ResourceLoader cache identity for imported source images, partitioned by importer threshold. */
const IMPORTED_ALPHA_BITMAPS = new WeakMap<object, Map<number, GodotBitMap>>();

const integer = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value)) throw new Error(`BitMap ${name} must be an integer`);
  return value;
};
const dimension = (value: number, name: string): number => {
  const parsed = integer(value, name);
  if (parsed < 0) throw new Error(`BitMap ${name} must be non-negative`);
  return parsed;
};
const bitmapDimension = (value: number, name: string): number => {
  const parsed = dimension(value, name);
  if (parsed < 1) throw new Error(`BitMap ${name} must be greater than zero`);
  return parsed;
};

export function createGodotBitMap(): GodotBitMap {
  let width = 0;
  let height = 0;
  let words = new Uint32Array();
  const offset = (x: number, y: number): number => y * width + x;
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const rawGet = (x: number, y: number): boolean => {
    if (!inBounds(x, y)) return false;
    const bit = offset(x, y);
    return ((words[bit >>> 5] as number) & (1 << (bit & 31))) !== 0;
  };
  const rawSet = (x: number, y: number, value: boolean): void => {
    if (!inBounds(x, y)) return;
    const bit = offset(x, y), word = bit >>> 5, mask = 1 << (bit & 31);
    words[word] = value ? (words[word] as number) | mask : (words[word] as number) & ~mask;
  };
  const allocate = (nextWidth: number, nextHeight: number, preserve: boolean): void => {
    const w = bitmapDimension(nextWidth, 'width'), h = bitmapDimension(nextHeight, 'height');
    const previous = words, oldWidth = width, oldHeight = height;
    width = w; height = h; words = new Uint32Array(Math.ceil(w * h / 32));
    if (!preserve) return;
    for (let y = 0; y < Math.min(h, oldHeight); y += 1) for (let x = 0; x < Math.min(w, oldWidth); x += 1) {
      const oldBit = y * oldWidth + x;
      if (((previous[oldBit >>> 5] as number) & (1 << (oldBit & 31))) !== 0) rawSet(x, y, true);
    }
  };

  const api: GodotBitMap = {
    create(size) { allocate(size.x, size.y, false); },
    create_from_image_alpha(image, threshold = 0.1) {
      if (!Number.isFinite(threshold)) throw new Error('BitMap alpha threshold must be finite');
      if (image.is_empty()) throw new Error('BitMap.create_from_image_alpha requires a non-empty Image');
      allocate(image.width, image.height, false);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rawSet(x, y, image.get_pixel(x, y).a > threshold);
    },
    get_size: () => vec2(width, height),
    resize(size) { allocate(size.x, size.y, true); },
    set_bit(x, y, bit) { rawSet(integer(x, 'x'), integer(y, 'y'), bit); },
    set_bitv(position, bit) { rawSet(integer(position.x, 'x'), integer(position.y, 'y'), bit); },
    get_bit(x, y) { return rawGet(integer(x, 'x'), integer(y, 'y')); },
    get_bitv(position) { return rawGet(integer(position.x, 'x'), integer(position.y, 'y')); },
    set_bit_rect(rect, bit) {
      const rawX0 = integer(rect.position.x, 'rect x');
      const rawY0 = integer(rect.position.y, 'rect y');
      const rawX1 = rawX0 + dimension(rect.size.x, 'rect width');
      const rawY1 = rawY0 + dimension(rect.size.y, 'rect height');
      const x0 = Math.max(0, rawX0);
      const y0 = Math.max(0, rawY0);
      const x1 = Math.min(width, rawX1);
      const y1 = Math.min(height, rawY1);
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) rawSet(x, y, bit);
    },
    get_true_bit_count() {
      let count = 0;
      for (const raw of words) { let value = raw; while (value !== 0) { value &= value - 1; count += 1; } }
      return count;
    },
    grow_mask(pixels, rect) {
      const signedRadius = integer(pixels, 'grow pixels');
      const radius = Math.abs(signedRadius);
      if (radius === 0) return;
      const rawX0 = integer(rect.position.x, 'rect x');
      const rawY0 = integer(rect.position.y, 'rect y');
      const rawX1 = rawX0 + dimension(rect.size.x, 'rect width');
      const rawY1 = rawY0 + dimension(rect.size.y, 'rect height');
      const x0 = Math.max(0, rawX0), y0 = Math.max(0, rawY0);
      const x1 = Math.min(width, rawX1), y1 = Math.min(height, rawY1);
      if (x1 <= x0 || y1 <= y0) return;
      const source = new Uint32Array(words);
      const sourceGet = (x: number, y: number) => {
        if (!inBounds(x, y)) return false;
        const bit = offset(x, y);
        return ((source[bit >>> 5] as number) & (1 << (bit & 31))) !== 0;
      };
      const target = signedRadius > 0;
      const radiusSquared = radius * radius + Number.EPSILON;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
        if (sourceGet(x, y) === target) continue;
        let foundTarget = false;
        for (let dy = -radius; dy <= radius && !foundTarget; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radiusSquared) continue;
          const sampleX = x + dx, sampleY = y + dy;
          const insideAuthoredRect = sampleX >= rawX0 && sampleY >= rawY0 && sampleX < rawX1 && sampleY < rawY1;
          if ((insideAuthoredRect ? sourceGet(sampleX, sampleY) : false) === target) {
            foundTarget = true;
            break;
          }
        }
        if (foundTarget) rawSet(x, y, target);
      }
    },
    convert_to_image() {
      const image = createGodotImage(width, height, false, IMAGE_FORMAT.FORMAT_L8);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) image.set_pixel(x, y, rawGet(x, y) ? { r: 1, g: 1, b: 1, a: 1 } : { r: 0, g: 0, b: 0, a: 1 });
      return image;
    },
    opaque_to_polygons() {
      throw new Error('BitMap.opaque_to_polygons is unsupported: exact Godot marching-squares contour simplification is not represented');
    },
  };
  registerGodotObjectIdentity(api, 'BitMap');
  return api;
}

/** Restore the internal `data = { size, data }` property written by Godot's Resource saver. */
export function createGodotBitMapFromPackedData(data: GodotPackedBitMapData): GodotBitMap {
  const width = bitmapDimension(data.width, 'width');
  const height = bitmapDimension(data.height, 'height');
  const expected = Math.ceil(width * height / 8);
  if (data.bytes.length !== expected) {
    throw new Error(`BitMap ${width}x${height} requires ${expected} packed bytes; received ${data.bytes.length}`);
  }
  const bitmap = createGodotBitMap();
  bitmap.create(vec2(width, height));
  for (let byteIndex = 0; byteIndex < data.bytes.length; byteIndex += 1) {
    const byte = data.bytes[byteIndex];
    if (typeof byte !== 'number' || !Number.isSafeInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`BitMap packed byte ${byteIndex} must be an integer from 0 through 255`);
    }
    if (byte === 0) continue;
    const firstPixel = byteIndex * 8;
    const limit = Math.min(8, width * height - firstPixel);
    for (let bit = 0; bit < limit; bit += 1) {
      if ((byte & (1 << bit)) === 0) continue;
      const pixel = firstPixel + bit;
      bitmap.set_bit(pixel % width, Math.floor(pixel / width), true);
    }
  }
  return bitmap;
}

/** Reproduce ResourceImporterBitMap's source-image alpha conversion over a preloaded native texture. */
export function createGodotBitMapFromTextureAlpha(texture: unknown, threshold = 0.5): GodotBitMap {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('BitMap importer threshold must be finite from 0 through 1');
  }
  if (typeof texture !== 'object' || texture === null) {
    throw new TypeError('Imported BitMap source must be a retained native texture Resource');
  }
  const byThreshold = IMPORTED_ALPHA_BITMAPS.get(texture);
  const retained = byThreshold?.get(threshold);
  if (retained !== undefined) return retained;
  const image = getGodotTexture2DImage(texture);
  if (image === null || image.is_empty()) {
    throw new Error('Imported BitMap source texture did not expose readable image pixels');
  }
  const bitmap = createGodotBitMap();
  bitmap.create_from_image_alpha(image, threshold);
  const cache = byThreshold ?? new Map<number, GodotBitMap>();
  cache.set(threshold, bitmap);
  if (byThreshold === undefined) IMPORTED_ALPHA_BITMAPS.set(texture, cache);
  return bitmap;
}
