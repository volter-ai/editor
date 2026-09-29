/**
 * @godot-class Noise
 * @role BINDING
 *
 * Godot 4.7's `Noise` (`modules/noise/noise.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a noise's values at points, and its values over a
 * grid as an 8-bit greyscale image (`FORMAT_L8`), normalized to the grid's own range or read as
 * [-1, 1]. A seamless image is a larger image with its quadrants swapped so its edges match, the
 * seams it swapped in blended over by a skirt (`Noise::_generate_seamless_image`, `noise.h:83`).
 * Its concrete noise (`FastNoiseLite`, the one Godot ships) samples it; a noise's `changed` listeners
 * are the textures drawn from it.
 */

import type { Image } from './image';

/** `Image::FORMAT_L8` (`core/io/image.h:74`). */
const FORMAT_L8 = 0;

const f32 = Math.fround;

export interface Noise {
  /** `get_noise_2d` and `get_noise_3d`, virtual in Noise. */
  readonly sample2d: (x: number, y: number) => number;
  readonly sample3d: (x: number, y: number, z: number) => number;
  /** The textures drawn from it, told when a setting changes (`Resource::emit_changed`). */
  readonly listeners: Set<() => void>;
}

/**
 * Tells the noise's textures a setting changed.
 *
 * @godot Noise (protocol)
 * @source core/io/resource.cpp:49
 */
export function godot_noise_changed(self: Noise): void {
  for (const listener of [...self.listeners]) listener();
}

/**
 * @godot Noise.get_noise_2d
 * @source modules/noise/fastnoise_lite.cpp:318
 */
export function get_noise_2d(self: Noise, x: number, y: number): number {
  return self.sample2d(x, y);
}

/**
 * @godot Noise.get_noise_3d
 * @source modules/noise/fastnoise_lite.cpp:331
 */
export function get_noise_3d(self: Noise, x: number, y: number, z: number): number {
  return self.sample3d(x, y, z);
}

/**
 * @godot Noise.get_noise_1d
 * @source modules/noise/fastnoise_lite.cpp:304
 */
export function get_noise_1d(self: Noise, x: number): number {
  return self.sample2d(x, 0);
}

/**
 * @godot Noise.get_noise_2dv
 * @source modules/noise/fastnoise_lite.cpp:314
 */
export function get_noise_2dv(self: Noise, v: { readonly x: number; readonly y: number }): number {
  return self.sample2d(v.x, v.y);
}

/**
 * @godot Noise.get_noise_3dv
 * @source modules/noise/fastnoise_lite.cpp:327
 */
export function get_noise_3dv(self: Noise, v: { readonly x: number; readonly y: number; readonly z: number }): number {
  return self.sample3d(v.x, v.y, v.z);
}

/** The grid's greyscale bytes, row by row (`Noise::_get_image`, one slice at depth 0). */
function greyscale(self: Noise, width: number, height: number, invert: boolean, in3d: boolean, normalize: boolean): Uint8Array {
  const data = new Uint8Array(width * height);
  const at = (x: number, y: number) => f32(in3d ? self.sample3d(x, y, 0) : self.sample2d(x, y));
  if (normalize) {
    const values = new Float32Array(width * height);
    let min = Number.MAX_VALUE;
    let max = -Number.MAX_VALUE;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = at(x, y);
        values[x + y * width] = value;
        if (value > max) max = value;
        if (value < min) min = value;
      }
    }
    for (let i = 0; i < values.length; i += 1) {
      const value = max === min ? 0 : Math.trunc(Math.min(Math.max(f32(f32(f32((values[i] as number) - min) / f32(max - min)) * 255), 0), 255));
      data[i] = invert ? 255 - value : value;
    }
    return data;
  }
  // Without normalizing, the noise's range is [-1, 1].
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.trunc(Math.min(Math.max(f32(f32(at(x, y) * 127.5) + 127.5), 0), 255));
      data[x + y * width] = invert ? 255 - value : value;
    }
  }
  return data;
}

/** `Math::smoothstep` in float (`core/math/math_funcs.h:579`). */
function smoothstep(from: number, to: number, s: number): number {
  const t = Math.min(Math.max(f32(f32(s - from) / f32(to - from)), 0), 1);
  return f32(f32(t * t) * f32(3 - f32(2 * t)));
}

/** `Noise::_alpha_blend<uint8_t>` (`noise.cpp:74`, `noise.h:251`): `fg` over `bg` by 0–255. */
function blend(bg: number, fg: number, alpha: number): number {
  return (((alpha + 1) * fg + (256 - alpha) * bg) >> 8) & 0xff;
}

/** A skirt row's or column's alpha: 255 at the seam, easing to 0 across the skirt. */
function skirtAlpha(distance: number, skirt: number): number {
  return Math.trunc(255 * f32(1 - smoothstep(0.1, 0.9, f32(distance / skirt))));
}

/**
 * The seamless image of a source `width + skirt` by `height + skirt` (`Noise::_generate_seamless_image<uint8_t>`,
 * `noise.h:83`): its quadrants swapped, then the vertical and horizontal seams and their crossing
 * blended over from the skirt.
 */
function seamless(src: Uint8Array, width: number, height: number, blendSkirt: number): Uint8Array {
  const skirtWidth = Math.max(1, Math.trunc(f32(width * blendSkirt)));
  const skirtHeight = Math.max(1, Math.trunc(f32(height * blendSkirt)));
  const srcWidth = width + skirtWidth;
  const srcHeight = height + skirtHeight;
  const halfWidth = Math.trunc(width * 0.5);
  const halfHeight = Math.trunc(height * 0.5);
  const edgeX = halfWidth + skirtWidth;
  const edgeY = halfHeight + skirtHeight;
  // `img_buff::operator()`: the source read from its half offset, wrapped by the full or the output size.
  const read = (x: number, y: number, wrapX: number, wrapY: number) => src[((x + halfWidth) % wrapX) + ((y + halfHeight) % wrapY) * srcWidth] as number;
  const fullXY = (x: number, y: number) => read(x, y, srcWidth, srcHeight);
  const altX = (x: number, y: number) => read(x, y, width, srcHeight);
  const altY = (x: number, y: number) => read(x, y, srcWidth, height);
  const altXY = (x: number, y: number) => read(x, y, width, height);
  const dest = new Uint8Array(width * height);
  const at = (x: number, y: number) => ((x % width) + (y % height) * width);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) dest[at(x, y)] = altXY(x, y);
  // The vertical skirt over the middle seam, skipping the center square.
  for (let x = halfWidth; x < edgeX; x += 1) {
    const alpha = skirtAlpha(x - halfWidth, skirtWidth);
    for (let y = 0; y < height; y += 1) {
      if (y === halfHeight) y = edgeY - 1;
      else dest[at(x, y)] = blend(dest[at(x, y)] as number, altY(x, y), alpha);
    }
  }
  // The horizontal skirt over the middle seam, skipping the center square.
  for (let y = halfHeight; y < edgeY; y += 1) {
    const alpha = skirtAlpha(y - halfHeight, skirtHeight);
    for (let x = 0; x < width; x += 1) {
      if (x === halfWidth) x = edgeX - 1;
      else dest[at(x, y)] = blend(dest[at(x, y)] as number, altX(x, y), alpha);
    }
  }
  // The center square: the top half blended onto the bottom half.
  for (let y = halfHeight; y < edgeY; y += 1) {
    for (let x = halfWidth; x < edgeX; x += 1) {
      const xpos = skirtAlpha(x - halfWidth, skirtWidth);
      const ypos = skirtAlpha(y - halfHeight, skirtHeight);
      const top = blend(altX(x, y), fullXY(x, y), xpos);
      const bottom = blend(altXY(x, y), altY(x, y), xpos);
      dest[at(x, y)] = blend(bottom, top, ypos);
    }
  }
  return dest;
}

/**
 * The noise over a `width` by `height` grid as a greyscale image.
 *
 * @godot Noise.get_image
 * @source modules/noise/noise.cpp:165
 */
export function get_image(self: Noise, width: number, height: number, invert = false, in_3d_space = false, normalize = true): Image | null {
  if (width <= 0 || height <= 0) return null;
  return { width, height, format: FORMAT_L8, levels: [greyscale(self, width, height, invert, in_3d_space, normalize)] };
}

/**
 * The noise as a greyscale image whose edges tile, from a grid `blend_skirt` larger.
 *
 * @godot Noise.get_seamless_image
 * @source modules/noise/noise.cpp:53
 */
export function get_seamless_image(self: Noise, width: number, height: number, invert = false, in_3d_space = false, blend_skirt = 0.1, normalize = true): Image | null {
  if (width <= 0 || height <= 0 || blend_skirt < 0) return null;
  const srcWidth = width + Math.max(1, Math.trunc(f32(width * blend_skirt)));
  const srcHeight = height + Math.max(1, Math.trunc(f32(height * blend_skirt)));
  const src = greyscale(self, srcWidth, srcHeight, invert, in_3d_space, normalize);
  return { width, height, format: FORMAT_L8, levels: [seamless(src, width, height, blend_skirt)] };
}
