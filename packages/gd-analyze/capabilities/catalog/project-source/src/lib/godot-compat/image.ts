/**
 * @godot-class Image
 * @role BINDING
 *
 * Godot 4.7's `Image` (`core/io/image.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`)
 * for the 8-bit formats an imported PNG or WebP holds (`L8`, `LA8`, `RGB8`, `RGBA8`), bound onto
 * the image decoders Godot uses: PNG through `fast-png` as libpng's simplified reader delivers it
 * (`drivers/png/png_driver_common.cpp:47`: palette expanded, 8-bit components; 16-bit and
 * sub-byte grey images are not bound), WebP through libwebp compiled to WebAssembly
 * (`@jsquash/webp`) as `webp_load_image_from_buffer` reads it (`modules/webp/webp_common.cpp:153`:
 * RGBA8 when the bitstream reports alpha, else RGB8). The image is its levels: the base image, then
 * each mipmap, as Godot lays them out one after the other.
 */

import webpDecode, { init as webpInit } from '@jsquash/webp/decode.js';
import { decode as pngDecode } from 'fast-png';
import { construct as color, type Color } from './color';

/** `Image::Format` (`core/io/image.h:66`). */
const FORMAT_L8 = 0;
const FORMAT_LA8 = 1;
const FORMAT_RGB8 = 4;
const FORMAT_RGBA8 = 5;
const CHANNELS: Readonly<Record<number, number>> = { [FORMAT_L8]: 1, [FORMAT_LA8]: 2, [FORMAT_RGB8]: 3, [FORMAT_RGBA8]: 4 };

export interface Image {
  readonly width: number;
  readonly height: number;
  readonly format: number;
  /** The base image, then each mipmap level, tightly packed. */
  levels: Uint8Array[];
}

function channelsOf(format: number): number {
  const channels = CHANNELS[format];
  if (channels === undefined) throw new Error(`godot-compat: Image format ${String(format)} is not bound`);
  return channels;
}

/** libpng's simplified reader of an 8-bit PNG (`png_to_image`): grey, grey+alpha, RGB or RGBA. */
function decodePng(bytes: Uint8Array): Image {
  const png = pngDecode(bytes);
  const pixels = png.width * png.height;
  if (png.palette !== undefined) {
    const alpha = png.palette.some((entry) => entry.length === 4 && entry[3] !== 255);
    const out = new Uint8Array(pixels * (alpha ? 4 : 3));
    for (let i = 0; i < pixels; i += 1) {
      const entry = png.palette[png.data[i] as number] ?? [0, 0, 0, 255];
      for (let c = 0; c < (alpha ? 4 : 3); c += 1) out[i * (alpha ? 4 : 3) + c] = entry[c] ?? 255;
    }
    return { width: png.width, height: png.height, format: alpha ? FORMAT_RGBA8 : FORMAT_RGB8, levels: [out] };
  }
  if (png.depth !== 8) throw new Error(`godot-compat: a ${String(png.depth)}-bit PNG is not bound`);
  const formats: Readonly<Record<number, number>> = { 1: FORMAT_L8, 2: FORMAT_LA8, 3: FORMAT_RGB8, 4: FORMAT_RGBA8 };
  const format = formats[png.channels];
  if (format === undefined) throw new Error('godot-compat: unsupported png format');
  const data = png.data instanceof Uint8Array ? png.data : Uint8Array.from(png.data as ArrayLike<number>);
  // A colour-key transparency (`tRNS` on grey or RGB) gives the image an alpha channel.
  const key = png.transparency;
  if (key !== undefined && (format === FORMAT_L8 || format === FORMAT_RGB8)) {
    const from = channelsOf(format);
    const out = new Uint8Array(pixels * (from + 1));
    for (let i = 0; i < pixels; i += 1) {
      let matches = true;
      for (let c = 0; c < from; c += 1) {
        out[i * (from + 1) + c] = data[i * from + c] as number;
        if (data[i * from + c] !== key[c]) matches = false;
      }
      out[i * (from + 1) + from] = matches ? 0 : 255;
    }
    return { width: png.width, height: png.height, format: format === FORMAT_L8 ? FORMAT_LA8 : FORMAT_RGBA8, levels: [out] };
  }
  return { width: png.width, height: png.height, format, levels: [data.slice(0, pixels * channelsOf(format))] };
}

/**
 * `WebPGetFeatures`'s `has_alpha`: a lossless bitstream's `alpha_is_used` bit, an extended file's
 * alpha flag, never for a plain lossy one.
 */
function webpHasAlpha(bytes: Uint8Array): boolean {
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === 'VP8L') return ((bytes[24] as number) & 0x10) !== 0;
  if (chunk === 'VP8X') return ((bytes[20] as number) & 0x10) !== 0;
  return false;
}

let webpModule: Promise<void> | undefined;

/**
 * Hands the WebP decoder its compiled WebAssembly module, for a host that cannot fetch it beside
 * the decoder's own script (the page fetches it itself).
 *
 * @godot Image (protocol)
 * @source modules/webp/webp_common.cpp:153
 */
export function godot_image_webp_module(module: WebAssembly.Module): void {
  webpModule = webpInit(module);
}

async function decodeWebp(bytes: Uint8Array): Promise<Image> {
  if (webpModule !== undefined) await webpModule;
  const decoded = await webpDecode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const rgba = new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
  if (webpHasAlpha(bytes)) return { width: decoded.width, height: decoded.height, format: FORMAT_RGBA8, levels: [rgba.slice()] };
  const out = new Uint8Array(decoded.width * decoded.height * 3);
  for (let i = 0; i < decoded.width * decoded.height; i += 1) {
    out[i * 3] = rgba[i * 4] as number;
    out[i * 3 + 1] = rgba[i * 4 + 1] as number;
    out[i * 3 + 2] = rgba[i * 4 + 2] as number;
  }
  return { width: decoded.width, height: decoded.height, format: FORMAT_RGB8, levels: [out] };
}

/**
 * The image in a PNG or WebP file, as `ImageLoader::load_image` reads it (by its signature).
 *
 * @godot Image (protocol)
 * @source core/io/image_loader.cpp:83
 */
export async function godot_image_decode(bytes: Uint8Array): Promise<Image> {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return decodePng(bytes);
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return decodeWebp(bytes);
  }
  throw new Error('godot-compat: the image is neither a PNG nor a WebP file');
}

/**
 * `fix_alpha_edges` (`image.cpp:4259`): a pixel under the alpha threshold takes the colour of the
 * nearest pixel at or over it within 4 pixels, read from the image before the pass. RGBA8 only.
 *
 * @godot Image (protocol)
 * @source core/io/image.cpp:4259
 */
export function godot_image_fix_alpha_edges(self: Image): void {
  if (self.format !== FORMAT_RGBA8) return;
  const source = (self.levels[0] as Uint8Array).slice();
  const target = self.levels[0] as Uint8Array;
  const { width, height } = self;
  const MAX_RADIUS = 4;
  const THRESHOLD = 20;
  const MAX_DIST = 0x7fffffff;
  for (let i = 0; i < height; i += 1) {
    for (let j = 0; j < width; j += 1) {
      const at = (i * width + j) * 4;
      if ((source[at + 3] as number) >= THRESHOLD) continue;
      let closest = MAX_DIST;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = Math.max(0, i - MAX_RADIUS); k <= Math.min(height - 1, i + MAX_RADIUS); k += 1) {
        for (let l = Math.max(0, j - MAX_RADIUS); l <= Math.min(width - 1, j + MAX_RADIUS); l += 1) {
          const dist = (i - k) * (i - k) + (j - l) * (j - l);
          if (dist >= closest) continue;
          const other = (k * width + l) * 4;
          if ((source[other + 3] as number) < THRESHOLD) continue;
          closest = dist;
          r = source[other] as number;
          g = source[other + 1] as number;
          b = source[other + 2] as number;
        }
      }
      if (closest !== MAX_DIST) {
        target[at] = r;
        target[at + 1] = g;
        target[at + 2] = b;
      }
    }
  }
}

/**
 * `premultiply_alpha` (`image.cpp:4237`): `(c * a + 255) >> 8` per colour channel. RGBA8 only.
 *
 * @godot Image (protocol)
 * @source core/io/image.cpp:4237
 */
export function godot_image_premultiply_alpha(self: Image): void {
  if (self.format !== FORMAT_RGBA8) return;
  const data = self.levels[0] as Uint8Array;
  for (let i = 0; i < self.width * self.height; i += 1) {
    const a = data[i * 4 + 3] as number;
    for (let c = 0; c < 3; c += 1) data[i * 4 + c] = ((data[i * 4 + c] as number) * a + 255) >> 8;
  }
}

/**
 * `generate_mipmaps` (`image.cpp:2160`) without renormalization: each level from the one before
 * by `_generate_po2_mipmap` (`:1964`), `(a + b + c + d + 2) >> 2` over each 2x2 block (a width or
 * height of 1 reuses its one column or row), down to 1x1.
 *
 * @godot Image (protocol)
 * @source core/io/image.cpp:2160
 */
export function godot_image_generate_mipmaps(self: Image): void {
  const cc = channelsOf(self.format);
  const levels: Uint8Array[] = [self.levels[0] as Uint8Array];
  let w = self.width;
  let h = self.height;
  while (w !== 1 || h !== 1) {
    const src = levels[levels.length - 1] as Uint8Array;
    const dw = Math.max(w >> 1, 1);
    const dh = Math.max(h >> 1, 1);
    const right = w === 1 ? 0 : cc;
    const down = h === 1 ? 0 : w * cc;
    const dst = new Uint8Array(dw * dh * cc);
    for (let i = 0; i < dh; i += 1) {
      let up = i * 2 * down;
      let under = up + down;
      for (let x = 0; x < dw; x += 1) {
        for (let j = 0; j < cc; j += 1) {
          const sum = (src[up + j] as number) + (src[up + j + right] as number) + (src[under + j] as number) + (src[under + j + right] as number);
          dst[(i * dw + x) * cc + j] = (sum + 2) >> 2;
        }
        up += right * 2;
        under += right * 2;
      }
    }
    levels.push(dst);
    w = dw;
    h = dh;
  }
  self.levels = levels;
}

/**
 * @godot Image.get_width
 * @source core/io/image.cpp:472
 */
export function get_width(self: Image): number {
  return self.width;
}

/**
 * @godot Image.get_height
 * @source core/io/image.cpp:476
 */
export function get_height(self: Image): number {
  return self.height;
}

/**
 * @godot Image.get_format
 * @source core/io/image.cpp:864
 */
export function get_format(self: Image): number {
  return self.format;
}

/**
 * @godot Image.has_mipmaps
 * @source core/io/image.cpp:484
 */
export function has_mipmaps(self: Image): boolean {
  return self.levels.length > 1;
}

/**
 * The levels below the base image (`get_image_required_mipmaps` when the image has them).
 *
 * @godot Image.get_mipmap_count
 * @source core/io/image.cpp:488
 */
export function get_mipmap_count(self: Image): number {
  return self.levels.length - 1;
}

/**
 * The pixel as a `Color`, each 8-bit channel `/ 255.0` held in single precision
 * (`_get_color_at_ofs`, `image.cpp:3435`); grey fills red, green and blue.
 *
 * @godot Image.get_pixel
 * @source core/io/image.cpp:3687
 */
export function get_pixel(self: Image, x: number, y: number): Color {
  const cc = channelsOf(self.format);
  const data = self.levels[0] as Uint8Array;
  const at = (y * self.width + x) * cc;
  const read = (c: number): number => (data[at + c] as number) / 255.0;
  if (self.format === FORMAT_L8) return color(read(0), read(0), read(0), 1);
  if (self.format === FORMAT_LA8) return color(read(0), read(0), read(0), read(1));
  if (self.format === FORMAT_RGB8) return color(read(0), read(1), read(2), 1);
  return color(read(0), read(1), read(2), read(3));
}

/**
 * The image's bytes as Godot lays them out: every level, one after the other.
 *
 * @godot Image.get_data
 * @source core/io/image.cpp:2380
 */
export function get_data(self: Image): Uint8Array {
  const out = new Uint8Array(self.levels.reduce((sum, level) => sum + level.length, 0));
  let offset = 0;
  for (const level of self.levels) {
    out.set(level, offset);
    offset += level.length;
  }
  return out;
}
