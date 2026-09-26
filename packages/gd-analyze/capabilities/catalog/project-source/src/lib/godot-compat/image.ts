/** Browser-resident Godot Image pixel-buffer protocol.
 *
 * The byte layouts and rectangle clipping rules follow pinned Godot 4.7 `core/io/image.cpp` and
 * Godot 3.6 `core/image.cpp`. Compressed/GPU formats refuse by name: a decoded RGBA mirror would
 * make get_data()/get_format() observably false.
 */

import { godotColor } from './color';
import { FileAccessMode, GodotFileAccess } from './file-access';
import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import type { ColorValue } from './variant';
import { type Vector2, vec2 } from './vector2';

export const IMAGE_FORMAT = Object.freeze({
  FORMAT_L8: 0,
  FORMAT_LA8: 1,
  FORMAT_R8: 2,
  FORMAT_RG8: 3,
  FORMAT_RGB8: 4,
  FORMAT_RGBA8: 5,
  FORMAT_RGBA4444: 6,
  FORMAT_RGB565: 7,
  FORMAT_RF: 8,
  FORMAT_RGF: 9,
  FORMAT_RGBF: 10,
  FORMAT_RGBAF: 11,
  FORMAT_RH: 12,
  FORMAT_RGH: 13,
  FORMAT_RGBH: 14,
  FORMAT_RGBAH: 15,
  FORMAT_RGBE9995: 16,
  FORMAT_DXT1: 17,
  FORMAT_DXT3: 18,
  FORMAT_DXT5: 19,
  FORMAT_RGTC_R: 20,
  FORMAT_RGTC_RG: 21,
  FORMAT_BPTC_RGBA: 22,
  FORMAT_BPTC_RGBF: 23,
  FORMAT_BPTC_RGBFU: 24,
  FORMAT_ETC: 25,
  FORMAT_ETC2_R11: 26,
  FORMAT_ETC2_R11S: 27,
  FORMAT_ETC2_RG11: 28,
  FORMAT_ETC2_RG11S: 29,
  FORMAT_ETC2_RGB8: 30,
  FORMAT_ETC2_RGBA8: 31,
  FORMAT_ETC2_RGB8A1: 32,
  FORMAT_ETC2_RA_AS_RG: 33,
  FORMAT_DXT5_RA_AS_RG: 34,
  FORMAT_ASTC_4x4: 35,
  FORMAT_ASTC_4x4_HDR: 36,
  FORMAT_ASTC_8x8: 37,
  FORMAT_ASTC_8x8_HDR: 38,
  FORMAT_R16: 39,
  FORMAT_RG16: 40,
  FORMAT_RGB16: 41,
  FORMAT_RGBA16: 42,
  FORMAT_R16I: 43,
  FORMAT_RG16I: 44,
  FORMAT_RGB16I: 45,
  FORMAT_RGBA16I: 46,
  FORMAT_MAX: 47,
});

const IMAGE_FORMAT_NAMES = Object.freeze([
  'L8', 'LA8', 'R8', 'RG8', 'RGB8', 'RGBA8', 'RGBA4444', 'RGB565',
  'RF', 'RGF', 'RGBF', 'RGBAF', 'RH', 'RGH', 'RGBH', 'RGBAH', 'RGBE9995',
  'DXT1', 'DXT3', 'DXT5', 'RGTC_R', 'RGTC_RG', 'BPTC_RGBA', 'BPTC_RGBF',
  'BPTC_RGBFU', 'ETC', 'ETC2_R11', 'ETC2_R11S', 'ETC2_RG11', 'ETC2_RG11S',
  'ETC2_RGB8', 'ETC2_RGBA8', 'ETC2_RGB8A1', 'ETC2_RA_AS_RG', 'DXT5_RA_AS_RG',
  'ASTC_4x4', 'ASTC_4x4_HDR', 'ASTC_8x8', 'ASTC_8x8_HDR', 'R16', 'RG16',
  'RGB16', 'RGBA16', 'R16I', 'RG16I', 'RGB16I', 'RGBA16I',
] as const);

export function getGodotImageFormatName(format: number): string {
  if (!Number.isSafeInteger(format) || format < 0 || format >= IMAGE_FORMAT_NAMES.length) {
    throw new RangeError(`Image.get_format_name received invalid format ${String(format)}.`);
  }
  return IMAGE_FORMAT_NAMES[format] as string;
}

export interface ImageRect {
  position: Vector2;
  size: Vector2;
}

export interface GodotImage {
  readonly width: number;
  readonly height: number;
  readonly format: number;
  get_width(): number;
  get_height(): number;
  get_size(): Vector2;
  get_format(): number;
  get_data(): PackedByteArray;
  get_data_size(): number;
  create(width: number, height: number, mipmaps: boolean, format: number): void;
  create_from_data(width: number, height: number, mipmaps: boolean, format: number, data: Iterable<number>): void;
  set_data(width: number, height: number, mipmaps: boolean, format: number, data: Iterable<number>): void;
  convert(format: number): void;
  has_mipmaps(): boolean;
  get_mipmap_count(): number;
  get_mipmap_offset(mipmap: number): number;
  get_image_from_mipmap(mipmap: number): GodotImage;
  is_empty(): boolean;
  empty(): boolean;
  is_size_po2(): boolean;
  lock(): void;
  unlock(): void;
  get_pixel(x: number, y: number): ColorValue;
  get_pixelv(point: Vector2): ColorValue;
  set_pixel(x: number, y: number, color: ColorValue): void;
  set_pixelv(point: Vector2, color: ColorValue): void;
  fill(color: ColorValue): void;
  fill_rect(rect: ImageRect, color: ColorValue): void;
  get_region(rect: ImageRect): GodotImage;
  get_rect(rect: ImageRect): GodotImage;
  get_used_rect(): ImageRect;
  crop(width: number, height: number): void;
  resize(width: number, height: number, interpolation?: number): void;
  resize_to_po2(square?: boolean, interpolation?: number): void;
  shrink_x2(): void;
  flip_x(): void;
  flip_y(): void;
  rotate_90(direction: number): void;
  rotate_180(): void;
  blit_rect(source: GodotImage, source_rect: ImageRect, destination: Vector2): void;
  blend_rect(source: GodotImage, source_rect: ImageRect, destination: Vector2): void;
  blit_rect_mask(source: GodotImage, mask: GodotImage, source_rect: ImageRect, destination: Vector2): void;
  blend_rect_mask(source: GodotImage, mask: GodotImage, source_rect: ImageRect, destination: Vector2): void;
  copy_from(source: GodotImage): void;
  detect_alpha(): number;
  is_invisible(): boolean;
  detect_used_channels(source?: number): number;
  is_compressed(): boolean;
  decompress(): number;
  compress(...args: readonly unknown[]): number;
  compress_from_channels(...args: readonly unknown[]): number;
  premultiply_alpha(): void;
  srgb_to_linear(): void;
  linear_to_srgb(): void;
  adjust_bcs(brightness: number, contrast: number, saturation: number): void;
  fix_alpha_edges(): void;
  normal_map_to_xy(): void;
  rgbe_to_srgb(): GodotImage;
  bump_map_to_normal_map(bump_scale?: number): void;
  compute_image_metrics(compared_image: GodotImage, use_luma?: boolean): Record<string, number>;
  load(path: string): number;
  save_png(path: string): number;
  save_png_to_buffer(): PackedByteArray;
  save_jpg(path: string, quality?: number): number;
  save_jpg_to_buffer(quality?: number): PackedByteArray;
  save_webp(path: string, lossy?: boolean, quality?: number): number;
  save_webp_to_buffer(lossy?: boolean, quality?: number): PackedByteArray;
  save_exr(path: string, grayscale?: boolean): number;
  save_exr_to_buffer(grayscale?: boolean): PackedByteArray;
  save_dds(path: string): number;
  save_dds_to_buffer(): PackedByteArray;
  load_png_from_buffer(data: Iterable<number>): number;
  load_jpg_from_buffer(data: Iterable<number>): number;
  load_webp_from_buffer(data: Iterable<number>): number;
  load_tga_from_buffer(data: Iterable<number>): number;
  load_bmp_from_buffer(data: Iterable<number>): number;
  load_ktx_from_buffer(data: Iterable<number>): number;
  load_dds_from_buffer(data: Iterable<number>): number;
  load_exr_from_buffer(data: Iterable<number>): number;
  load_svg_from_buffer(data: Iterable<number>, scale?: number): number;
  load_svg_from_string(svg: string, scale?: number): number;
  clear_mipmaps(): void;
  generate_mipmaps(renormalize?: boolean): void;
}

type MutableImageState = { width: number; height: number; format: number; mipmaps: boolean; data: Uint8Array };

const byte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
const unit = (value: number): number => value / 255;
const integer = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value)) throw new Error(`Image.${name} must be an integer`);
  return value;
};
const positiveImageDimensions = (width: number, height: number, operation: string): [number, number] => {
  const parsedWidth = integer(width, `${operation} width`);
  const parsedHeight = integer(height, `${operation} height`);
  if (parsedWidth <= 0 || parsedHeight <= 0) throw new Error(`Image.${operation} dimensions must be greater than zero`);
  if (parsedWidth > 1 << 24 || parsedHeight > 1 << 24 || parsedWidth * parsedHeight > 268_435_456) {
    throw new Error(`Image.${operation} dimensions exceed Godot's Image allocation limits`);
  }
  return [parsedWidth, parsedHeight];
};

const bytesPerPixel = (format: number): number => {
  switch (format) {
    case IMAGE_FORMAT.FORMAT_L8:
    case IMAGE_FORMAT.FORMAT_R8:
      return 1;
    case IMAGE_FORMAT.FORMAT_LA8:
    case IMAGE_FORMAT.FORMAT_RG8:
    case IMAGE_FORMAT.FORMAT_RGBA4444:
    case IMAGE_FORMAT.FORMAT_RGB565:
      return 2;
    case IMAGE_FORMAT.FORMAT_RGB8:
      return 3;
    case IMAGE_FORMAT.FORMAT_RGBA8:
    case IMAGE_FORMAT.FORMAT_RF:
    case IMAGE_FORMAT.FORMAT_RGBE9995:
      return 4;
    case IMAGE_FORMAT.FORMAT_RGF:
      return 8;
    case IMAGE_FORMAT.FORMAT_RGBF:
      return 12;
    case IMAGE_FORMAT.FORMAT_RGBAF:
      return 16;
    case IMAGE_FORMAT.FORMAT_RH:
      return 2;
    case IMAGE_FORMAT.FORMAT_RGH:
      return 4;
    case IMAGE_FORMAT.FORMAT_RGBH:
      return 6;
    case IMAGE_FORMAT.FORMAT_RGBAH:
      return 8;
    case IMAGE_FORMAT.FORMAT_R16:
    case IMAGE_FORMAT.FORMAT_R16I:
      return 2;
    case IMAGE_FORMAT.FORMAT_RG16:
    case IMAGE_FORMAT.FORMAT_RG16I:
      return 4;
    case IMAGE_FORMAT.FORMAT_RGB16:
    case IMAGE_FORMAT.FORMAT_RGB16I:
      return 6;
    case IMAGE_FORMAT.FORMAT_RGBA16:
    case IMAGE_FORMAT.FORMAT_RGBA16I:
      return 8;
    default:
      throw new Error(`Image format ${format} is unsupported: compressed and half-float layouts require their source codec`);
  }
};

const mipmapDimensions = (width: number, height: number): readonly { width: number; height: number }[] => {
  const levels: { width: number; height: number }[] = [];
  let levelWidth = width;
  let levelHeight = height;
  while (levelWidth > 0 && levelHeight > 0) {
    levels.push({ width: levelWidth, height: levelHeight });
    if (levelWidth === 1 && levelHeight === 1) break;
    levelWidth = Math.max(1, levelWidth >> 1);
    levelHeight = Math.max(1, levelHeight >> 1);
  }
  return levels;
};

const mipmapDataSize = (width: number, height: number, format: number, mipmaps: boolean): number => {
  const levels = mipmaps ? mipmapDimensions(width, height) : [{ width, height }];
  const pixelSize = bytesPerPixel(format);
  return levels.reduce((size, level) => size + level.width * level.height * pixelSize, 0);
};

const mipmapOffset = (width: number, height: number, format: number, level: number): number => {
  const levels = mipmapDimensions(width, height);
  if (!Number.isSafeInteger(level) || level < 0 || level >= levels.length) throw new Error(`Image mipmap level ${level} is out of range`);
  const pixelSize = bytesPerPixel(format);
  let offset = 0;
  for (let index = 0; index < level; index += 1) {
    const dimensions = levels[index] as { width: number; height: number };
    offset += dimensions.width * dimensions.height * pixelSize;
  }
  return offset;
};

const mipmapComponentLayout = (format: number): { readonly components: number; readonly kind: 'uint8' | 'float32' | 'generic' } => {
  switch (format) {
    case IMAGE_FORMAT.FORMAT_L8:
    case IMAGE_FORMAT.FORMAT_R8:
      return { components: 1, kind: 'uint8' };
    case IMAGE_FORMAT.FORMAT_LA8:
    case IMAGE_FORMAT.FORMAT_RG8:
      return { components: 2, kind: 'uint8' };
    case IMAGE_FORMAT.FORMAT_RGB8:
      return { components: 3, kind: 'uint8' };
    case IMAGE_FORMAT.FORMAT_RGBA8:
      return { components: 4, kind: 'uint8' };
    case IMAGE_FORMAT.FORMAT_RF:
      return { components: 1, kind: 'float32' };
    case IMAGE_FORMAT.FORMAT_RGF:
      return { components: 2, kind: 'float32' };
    case IMAGE_FORMAT.FORMAT_RGBF:
      return { components: 3, kind: 'float32' };
    case IMAGE_FORMAT.FORMAT_RGBAF:
      return { components: 4, kind: 'float32' };
    case IMAGE_FORMAT.FORMAT_RGBA4444:
    case IMAGE_FORMAT.FORMAT_RGB565:
    case IMAGE_FORMAT.FORMAT_RH:
    case IMAGE_FORMAT.FORMAT_RGH:
    case IMAGE_FORMAT.FORMAT_RGBH:
    case IMAGE_FORMAT.FORMAT_RGBAH:
    case IMAGE_FORMAT.FORMAT_R16:
    case IMAGE_FORMAT.FORMAT_RG16:
    case IMAGE_FORMAT.FORMAT_RGB16:
    case IMAGE_FORMAT.FORMAT_RGBA16:
    case IMAGE_FORMAT.FORMAT_R16I:
    case IMAGE_FORMAT.FORMAT_RG16I:
    case IMAGE_FORMAT.FORMAT_RGB16I:
    case IMAGE_FORMAT.FORMAT_RGBA16I:
    case IMAGE_FORMAT.FORMAT_RGBE9995:
      return { components: 0, kind: 'generic' };
    default:
      throw new Error(`Image.generate_mipmaps does not yet represent exact filtering for format ${format}`);
  }
};

const generateMipmapChain = (state: MutableImageState, renormalize = false): void => {
  if (state.width === 0 || state.height === 0) throw new Error('Image.generate_mipmaps requires a non-empty Image');
  const layout = mipmapComponentLayout(state.format);
  const levels = mipmapDimensions(state.width, state.height);
  const result = new Uint8Array(mipmapDataSize(state.width, state.height, state.format, true));
  const baseSize = state.width * state.height * bytesPerPixel(state.format);
  result.set(state.data.subarray(0, baseSize));
  let sourceOffset = 0;
  let destinationOffset = baseSize;
  for (let level = 1; level < levels.length; level += 1) {
    const source = levels[level - 1] as { width: number; height: number };
    const destination = levels[level] as { width: number; height: number };
    const rightStep = source.width === 1 ? 0 : layout.components;
    const downStep = source.height === 1 ? 0 : source.width * layout.components;
    if (layout.kind === 'uint8') {
      for (let y = 0; y < destination.height; y += 1) for (let x = 0; x < destination.width; x += 1) {
        const topLeft = sourceOffset + (y * 2 * downStep) + x * rightStep * 2;
        const output = destinationOffset + (y * destination.width + x) * layout.components;
        for (let component = 0; component < layout.components; component += 1) {
          const a = result[topLeft + component] as number;
          const b = result[topLeft + rightStep + component] as number;
          const c = result[topLeft + downStep + component] as number;
          const d = result[topLeft + downStep + rightStep + component] as number;
          result[output + component] = (a + b + c + d + 2) >> 2;
        }
        if (renormalize && layout.components >= 3) {
          let nx = (result[output] as number) / 255 * 2 - 1;
          let ny = (result[output + 1] as number) / 255 * 2 - 1;
          let nz = (result[output + 2] as number) / 255 * 2 - 1;
          const length = Math.hypot(nx, ny, nz);
          if (length !== 0) { nx /= length; ny /= length; nz /= length; }
          result[output] = Math.max(0, Math.min(255, Math.round((nx + 1) * 0.5 * 255)));
          result[output + 1] = Math.max(0, Math.min(255, Math.round((ny + 1) * 0.5 * 255)));
          result[output + 2] = Math.max(0, Math.min(255, Math.round((nz + 1) * 0.5 * 255)));
        }
      }
    } else if (layout.kind === 'float32') {
      const sourceView = new DataView(result.buffer, result.byteOffset + sourceOffset, source.width * source.height * layout.components * 4);
      const destinationView = new DataView(result.buffer, result.byteOffset + destinationOffset, destination.width * destination.height * layout.components * 4);
      const sourceFloat = (component: number): number => sourceView.getFloat32(component * 4, true);
      for (let y = 0; y < destination.height; y += 1) for (let x = 0; x < destination.width; x += 1) {
        const topLeft = y * 2 * downStep + x * rightStep * 2;
        const output = (y * destination.width + x) * layout.components;
        for (let component = 0; component < layout.components; component += 1) {
          destinationView.setFloat32((output + component) * 4, (
            sourceFloat(topLeft + component)
            + sourceFloat(topLeft + rightStep + component)
            + sourceFloat(topLeft + downStep + component)
            + sourceFloat(topLeft + downStep + rightStep + component)
          ) * 0.25, true);
        }
        if (renormalize && layout.components >= 3) {
          let nx = destinationView.getFloat32(output * 4, true) * 2 - 1;
          let ny = destinationView.getFloat32((output + 1) * 4, true) * 2 - 1;
          let nz = destinationView.getFloat32((output + 2) * 4, true) * 2 - 1;
          const length = Math.hypot(nx, ny, nz);
          if (length !== 0) { nx /= length; ny /= length; nz /= length; }
          destinationView.setFloat32(output * 4, (nx + 1) * 0.5, true);
          destinationView.setFloat32((output + 1) * 4, (ny + 1) * 0.5, true);
          destinationView.setFloat32((output + 2) * 4, (nz + 1) * 0.5, true);
        }
      }
    } else {
      const sourceBytes = source.width * source.height * bytesPerPixel(state.format);
      const destinationBytes = destination.width * destination.height * bytesPerPixel(state.format);
      const sourceState: MutableImageState = {
        width: source.width,
        height: source.height,
        format: state.format,
        mipmaps: false,
        data: result.subarray(sourceOffset, sourceOffset + sourceBytes),
      };
      const destinationState: MutableImageState = {
        width: destination.width,
        height: destination.height,
        format: state.format,
        mipmaps: false,
        data: result.subarray(destinationOffset, destinationOffset + destinationBytes),
      };
      for (let y = 0; y < destination.height; y += 1) for (let x = 0; x < destination.width; x += 1) {
        const x0 = x * 2;
        const y0 = y * 2;
        const x1 = Math.min(source.width - 1, x0 + 1);
        const y1 = Math.min(source.height - 1, y0 + 1);
        const a = readPixel(sourceState, y0 * source.width + x0);
        const b = readPixel(sourceState, y0 * source.width + x1);
        const c = readPixel(sourceState, y1 * source.width + x0);
        const d = readPixel(sourceState, y1 * source.width + x1);
        let color = godotColor(
          (a.r + b.r + c.r + d.r) * 0.25,
          (a.g + b.g + c.g + d.g) * 0.25,
          (a.b + b.b + c.b + d.b) * 0.25,
          (a.a + b.a + c.a + d.a) * 0.25,
        );
        if (renormalize) {
          let nx = color.r * 2 - 1;
          let ny = color.g * 2 - 1;
          let nz = color.b * 2 - 1;
          const length = Math.hypot(nx, ny, nz);
          if (length !== 0) { nx /= length; ny /= length; nz /= length; }
          color = godotColor((nx + 1) * 0.5, (ny + 1) * 0.5, (nz + 1) * 0.5, color.a);
        }
        writePixel(destinationState, y * destination.width + x, color);
      }
    }
    sourceOffset = destinationOffset;
    destinationOffset += destination.width * destination.height * bytesPerPixel(state.format);
  }
  state.data = result;
  state.mipmaps = true;
};

const luminance = (color: ColorValue): number =>
  color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

const readPixel = (state: MutableImageState, index: number): ColorValue => {
  const view = new DataView(state.data.buffer, state.data.byteOffset, state.data.byteLength);
  const offset = index * bytesPerPixel(state.format);
  switch (state.format) {
    case IMAGE_FORMAT.FORMAT_L8: {
      const l = unit(state.data[offset] as number);
      return godotColor(l, l, l, 1);
    }
    case IMAGE_FORMAT.FORMAT_LA8: {
      const l = unit(state.data[offset] as number);
      return godotColor(l, l, l, unit(state.data[offset + 1] as number));
    }
    case IMAGE_FORMAT.FORMAT_R8:
      return godotColor(unit(state.data[offset] as number), 0, 0, 1);
    case IMAGE_FORMAT.FORMAT_RG8:
      return godotColor(unit(state.data[offset] as number), unit(state.data[offset + 1] as number), 0, 1);
    case IMAGE_FORMAT.FORMAT_RGB8:
      return godotColor(unit(state.data[offset] as number), unit(state.data[offset + 1] as number), unit(state.data[offset + 2] as number), 1);
    case IMAGE_FORMAT.FORMAT_RGBA8:
      return godotColor(unit(state.data[offset] as number), unit(state.data[offset + 1] as number), unit(state.data[offset + 2] as number), unit(state.data[offset + 3] as number));
    case IMAGE_FORMAT.FORMAT_RGBA4444: {
      const packed = view.getUint16(offset, true);
      return godotColor(((packed >> 12) & 15) / 15, ((packed >> 8) & 15) / 15, ((packed >> 4) & 15) / 15, (packed & 15) / 15);
    }
    case IMAGE_FORMAT.FORMAT_RGB565: {
      const packed = view.getUint16(offset, true);
      return godotColor(((packed >> 11) & 31) / 31, ((packed >> 5) & 63) / 63, (packed & 31) / 31, 1);
    }
    case IMAGE_FORMAT.FORMAT_RGBE9995: {
      const packed = view.getUint32(offset, true);
      const exponent = packed >>> 27;
      const scale = 2 ** (exponent - 24);
      return godotColor(
        (packed & 0x1ff) * scale,
        ((packed >>> 9) & 0x1ff) * scale,
        ((packed >>> 18) & 0x1ff) * scale,
        1,
      );
    }
    case IMAGE_FORMAT.FORMAT_RF:
    case IMAGE_FORMAT.FORMAT_RGF:
    case IMAGE_FORMAT.FORMAT_RGBF:
    case IMAGE_FORMAT.FORMAT_RGBAF: {
      const channels = bytesPerPixel(state.format) / 4;
      return godotColor(
        view.getFloat32(offset, true),
        channels > 1 ? view.getFloat32(offset + 4, true) : 0,
        channels > 2 ? view.getFloat32(offset + 8, true) : 0,
        channels > 3 ? view.getFloat32(offset + 12, true) : 1,
      );
    }
    case IMAGE_FORMAT.FORMAT_RH:
    case IMAGE_FORMAT.FORMAT_RGH:
    case IMAGE_FORMAT.FORMAT_RGBH:
    case IMAGE_FORMAT.FORMAT_RGBAH: {
      const channels = bytesPerPixel(state.format) / 2;
      return godotColor(
        halfToFloat(view.getUint16(offset, true)),
        channels > 1 ? halfToFloat(view.getUint16(offset + 2, true)) : 0,
        channels > 2 ? halfToFloat(view.getUint16(offset + 4, true)) : 0,
        channels > 3 ? halfToFloat(view.getUint16(offset + 6, true)) : 1,
      );
    }
    case IMAGE_FORMAT.FORMAT_R16:
    case IMAGE_FORMAT.FORMAT_RG16:
    case IMAGE_FORMAT.FORMAT_RGB16:
    case IMAGE_FORMAT.FORMAT_RGBA16:
    case IMAGE_FORMAT.FORMAT_R16I:
    case IMAGE_FORMAT.FORMAT_RG16I:
    case IMAGE_FORMAT.FORMAT_RGB16I:
    case IMAGE_FORMAT.FORMAT_RGBA16I: {
      const channels = bytesPerPixel(state.format) / 2;
      return godotColor(
        view.getUint16(offset, true) / 65535,
        channels > 1 ? view.getUint16(offset + 2, true) / 65535 : 0,
        channels > 2 ? view.getUint16(offset + 4, true) / 65535 : 0,
        channels > 3 ? view.getUint16(offset + 6, true) / 65535 : 1,
      );
    }
    default:
      return godotColor();
  }
};

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) crc = (PNG_CRC_TABLE[(crc ^ value) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false);
  return bytes;
}

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function pngChunk(name: 'IHDR' | 'IDAT' | 'IEND', data: Uint8Array): Uint8Array {
  const type = Uint8Array.from([...name].map((character) => character.charCodeAt(0)));
  const payload = joinBytes([type, data]);
  return joinBytes([uint32Bytes(data.length), payload, uint32Bytes(pngCrc(payload))]);
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const value of bytes) {
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A standards-valid zlib stream made from stored DEFLATE blocks; PNG readers decode it exactly. */
function deflateStored(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  for (let offset = 0; offset < bytes.length || offset === 0; offset += 65535) {
    const length = Math.min(65535, bytes.length - offset);
    const final = offset + length >= bytes.length;
    const header = new Uint8Array(5);
    header[0] = final ? 1 : 0;
    header[1] = length & 0xff;
    header[2] = length >>> 8;
    const complement = (~length) & 0xffff;
    header[3] = complement & 0xff;
    header[4] = complement >>> 8;
    parts.push(header, bytes.subarray(offset, offset + length));
    if (final) break;
  }
  parts.push(uint32Bytes(adler32(bytes)));
  return joinBytes(parts);
}

function encodePng(state: MutableImageState): Uint8Array {
  if (state.width === 0 || state.height === 0) throw new Error('Image.save_png requires a non-empty Image.');
  const scanlines = new Uint8Array(state.height * (1 + state.width * 4));
  for (let y = 0; y < state.height; y += 1) {
    const row = y * (1 + state.width * 4);
    scanlines[row] = 0;
    for (let x = 0; x < state.width; x += 1) {
      const color = readPixel(state, y * state.width + x);
      const offset = row + 1 + x * 4;
      scanlines[offset] = byte(color.r);
      scanlines[offset + 1] = byte(color.g);
      scanlines[offset + 2] = byte(color.b);
      scanlines[offset + 3] = byte(color.a);
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, state.width, false);
  view.setUint32(4, state.height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return joinBytes([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateStored(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

interface DecodedRaster {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

class DeflateBits {
  private byteOffset = 0;
  private bitOffset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  read(count: number): number {
    let result = 0;
    for (let bit = 0; bit < count; bit += 1) {
      if (this.byteOffset >= this.bytes.length) throw new Error('PNG DEFLATE stream is truncated.');
      result |= (((this.bytes[this.byteOffset] as number) >>> this.bitOffset) & 1) << bit;
      this.bitOffset += 1;
      if (this.bitOffset === 8) { this.bitOffset = 0; this.byteOffset += 1; }
    }
    return result;
  }

  align(): void {
    if (this.bitOffset !== 0) { this.bitOffset = 0; this.byteOffset += 1; }
  }
}

interface HuffmanTable {
  readonly symbols: ReadonlyMap<number, number>;
  readonly maximumLength: number;
}

function reverseBits(value: number, count: number): number {
  let result = 0;
  for (let bit = 0; bit < count; bit += 1) result = (result << 1) | ((value >>> bit) & 1);
  return result;
}

function huffmanTable(lengths: readonly number[]): HuffmanTable {
  const maximumLength = Math.max(0, ...lengths);
  const counts = new Array<number>(maximumLength + 1).fill(0);
  for (const length of lengths) {
    if (!Number.isSafeInteger(length) || length < 0 || length > 15) throw new Error('PNG DEFLATE Huffman length is invalid.');
    if (length > 0) counts[length] = (counts[length] ?? 0) + 1;
  }
  const next = new Array<number>(maximumLength + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maximumLength; bits += 1) {
    code = (code + (counts[bits - 1] as number)) << 1;
    next[bits] = code;
  }
  const symbols = new Map<number, number>();
  lengths.forEach((length, symbol) => {
    if (length === 0) return;
    const canonical = next[length] as number;
    next[length] = canonical + 1;
    symbols.set((length << 16) | reverseBits(canonical, length), symbol);
  });
  return { symbols, maximumLength };
}

function readHuffman(bits: DeflateBits, table: HuffmanTable): number {
  let code = 0;
  for (let length = 1; length <= table.maximumLength; length += 1) {
    code |= bits.read(1) << (length - 1);
    const symbol = table.symbols.get((length << 16) | code);
    if (symbol !== undefined) return symbol;
  }
  throw new Error('PNG DEFLATE stream contains an invalid Huffman code.');
}

const DEFLATE_LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
] as const;
const DEFLATE_LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
] as const;
const DEFLATE_DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289,
  16385, 24577,
] as const;
const DEFLATE_DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
] as const;

function fixedDeflateTables(): readonly [HuffmanTable, HuffmanTable] {
  const literalLengths = Array.from({ length: 288 }, (_, symbol) =>
    symbol <= 143 ? 8 : symbol <= 255 ? 9 : symbol <= 279 ? 7 : 8);
  return [huffmanTable(literalLengths), huffmanTable(new Array<number>(32).fill(5))];
}

function dynamicDeflateTables(bits: DeflateBits): readonly [HuffmanTable, HuffmanTable] {
  const literalCount = bits.read(5) + 257;
  const distanceCount = bits.read(5) + 1;
  const codeLengthCount = bits.read(4) + 4;
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15] as const;
  const codeLengths = new Array<number>(19).fill(0);
  for (let index = 0; index < codeLengthCount; index += 1) codeLengths[order[index] as number] = bits.read(3);
  const codeTable = huffmanTable(codeLengths);
  const lengths: number[] = [];
  while (lengths.length < literalCount + distanceCount) {
    const symbol = readHuffman(bits, codeTable);
    if (symbol <= 15) lengths.push(symbol);
    else if (symbol === 16) {
      const previous = lengths.at(-1);
      if (previous === undefined) throw new Error('PNG DEFLATE repeat has no prior code length.');
      const count = bits.read(2) + 3;
      for (let index = 0; index < count; index += 1) lengths.push(previous);
    } else if (symbol === 17) {
      const count = bits.read(3) + 3;
      for (let index = 0; index < count; index += 1) lengths.push(0);
    } else if (symbol === 18) {
      const count = bits.read(7) + 11;
      for (let index = 0; index < count; index += 1) lengths.push(0);
    } else throw new Error('PNG DEFLATE code-length symbol is invalid.');
  }
  if (lengths.length !== literalCount + distanceCount) throw new Error('PNG DEFLATE code lengths overflow their tables.');
  return [huffmanTable(lengths.slice(0, literalCount)), huffmanTable(lengths.slice(literalCount))];
}

function inflateZlib(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 6) throw new Error('PNG zlib stream is truncated.');
  const cmf = bytes[0] as number;
  const flags = bytes[1] as number;
  if ((cmf & 15) !== 8 || ((cmf << 8) + flags) % 31 !== 0 || (flags & 32) !== 0) {
    throw new Error('PNG zlib header is unsupported or invalid.');
  }
  const bits = new DeflateBits(bytes.subarray(2, -4));
  const output: number[] = [];
  let final = false;
  while (!final) {
    final = bits.read(1) === 1;
    const blockType = bits.read(2);
    if (blockType === 0) {
      bits.align();
      const length = bits.read(16);
      const inverse = bits.read(16);
      if ((length ^ 0xffff) !== inverse) throw new Error('PNG DEFLATE stored block length is corrupt.');
      for (let index = 0; index < length; index += 1) output.push(bits.read(8));
      continue;
    }
    if (blockType === 3) throw new Error('PNG DEFLATE block uses reserved type 3.');
    const [literalTable, distanceTable] = blockType === 1 ? fixedDeflateTables() : dynamicDeflateTables(bits);
    while (true) {
      const symbol = readHuffman(bits, literalTable);
      if (symbol < 256) { output.push(symbol); continue; }
      if (symbol === 256) break;
      const lengthIndex = symbol - 257;
      const lengthBase = DEFLATE_LENGTH_BASE[lengthIndex];
      const lengthExtra = DEFLATE_LENGTH_EXTRA[lengthIndex];
      if (lengthBase === undefined || lengthExtra === undefined) throw new Error('PNG DEFLATE length symbol is invalid.');
      const length = lengthBase + bits.read(lengthExtra);
      const distanceSymbol = readHuffman(bits, distanceTable);
      const distanceBase = DEFLATE_DISTANCE_BASE[distanceSymbol];
      const distanceExtra = DEFLATE_DISTANCE_EXTRA[distanceSymbol];
      if (distanceBase === undefined || distanceExtra === undefined) throw new Error('PNG DEFLATE distance symbol is invalid.');
      const distance = distanceBase + bits.read(distanceExtra);
      if (distance > output.length) throw new Error('PNG DEFLATE distance precedes the output window.');
      for (let index = 0; index < length; index += 1) output.push(output[output.length - distance] as number);
    }
  }
  const result = Uint8Array.from(output);
  let first = 1;
  let second = 0;
  for (const value of result) {
    first = (first + value) % 65521;
    second = (second + first) % 65521;
  }
  const expected = new DataView(bytes.buffer, bytes.byteOffset + bytes.byteLength - 4, 4).getUint32(0, false);
  if ((((second << 16) | first) >>> 0) !== expected) throw new Error('PNG zlib Adler-32 checksum is invalid.');
  return result;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function unfilterPngScanlines(
  inflated: Uint8Array,
  sourceOffset: number,
  width: number,
  height: number,
  bitsPerPixel: number,
): { readonly pixels: Uint8Array; readonly stride: number; readonly nextOffset: number } {
  const stride = Math.ceil(width * bitsPerPixel / 8);
  const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const needed = height * (stride + 1);
  if (sourceOffset + needed > inflated.length) throw new Error('Image PNG scanline data is truncated.');
  const pixels = new Uint8Array(height * stride);
  let source = sourceOffset;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source++] as number;
    if (filter < 0 || filter > 4) throw new Error(`Image PNG filter ${String(filter)} is invalid.`);
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[source++] as number;
      const destination = y * stride + x;
      const left = x >= filterBytesPerPixel ? pixels[destination - filterBytesPerPixel] as number : 0;
      const above = y > 0 ? pixels[destination - stride] as number : 0;
      const upperLeft = y > 0 && x >= filterBytesPerPixel
        ? pixels[destination - stride - filterBytesPerPixel] as number
        : 0;
      pixels[destination] = filter === 0 ? raw
        : filter === 1 ? raw + left
          : filter === 2 ? raw + above
            : filter === 3 ? raw + Math.floor((left + above) / 2)
              : raw + paeth(left, above, upperLeft);
    }
  }
  return { pixels, stride, nextOffset: source };
}

function decodePng(bytes: Uint8Array): DecodedRaster {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new Error('Image PNG signature is invalid.');
  }
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const length = view.getUint32(0, false);
    if (offset + 12 + length > bytes.length) throw new Error('Image PNG chunk is truncated.');
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = view.getUint32(8 + length, false);
    const actualCrc = pngCrc(bytes.subarray(offset + 4, offset + 8 + length));
    if (actualCrc !== expectedCrc) throw new Error(`Image PNG ${name} chunk CRC is invalid.`);
    if (name === 'IHDR') {
      if (length !== 13) throw new Error('Image PNG IHDR length is invalid.');
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = header.getUint32(0, false);
      height = header.getUint32(4, false);
      bitDepth = data[8] as number;
      colorType = data[9] as number;
      if (data[10] !== 0 || data[11] !== 0) throw new Error('Image PNG compression/filter method is unsupported.');
      interlace = data[12] as number;
    } else if (name === 'PLTE') palette = data.slice();
    else if (name === 'tRNS') transparency = data.slice();
    else if (name === 'IDAT') idat.push(data.slice());
    else if (name === 'IEND') break;
    offset += 12 + length;
  }
  if (width <= 0 || height <= 0 || idat.length === 0) throw new Error('Image PNG is missing IHDR/IDAT data.');
  if (bitDepth !== 8 && bitDepth !== 16 && !(colorType === 3 && (bitDepth === 1 || bitDepth === 2 || bitDepth === 4))) {
    throw new Error(`Image PNG bit depth ${String(bitDepth)} is unsupported for color type ${String(colorType)}.`);
  }
  if (colorType === 3 && bitDepth === 16) throw new Error('Image indexed PNG cannot use 16-bit samples.');
  if (interlace !== 0 && interlace !== 1) throw new Error(`Image PNG interlace method ${String(interlace)} is invalid.`);
  const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`Image PNG color type ${String(colorType)} is unsupported.`);
  if (colorType === 3 && (palette === null || palette.length === 0 || palette.length % 3 !== 0)) {
    throw new Error('Image indexed PNG has no valid PLTE chunk.');
  }
  const inflated = inflateZlib(joinBytes(idat));
  const bitsPerPixel = channels * bitDepth;
  const rgba = new Uint8Array(width * height * 4);
  const transparentGray = transparency !== null && transparency.length >= 2
    ? new DataView(transparency.buffer, transparency.byteOffset, transparency.byteLength).getUint16(0, false)
    : -1;
  const transparentRgb = transparency !== null && transparency.length >= 6
    ? new DataView(transparency.buffer, transparency.byteOffset, transparency.byteLength)
    : null;
  const decodePixel = (
    pixels: Uint8Array,
    stride: number,
    row: number,
    column: number,
    destinationX: number,
    destinationY: number,
  ): void => {
    const input = bitDepth >= 8
      ? row * stride + column * channels * (bitDepth / 8)
      : row * stride + Math.floor(column * bitDepth / 8);
    const output = (destinationY * width + destinationX) * 4;
    const sample8 = (channel: number): number => bitDepth === 16
      ? pixels[input + channel * 2] as number
      : pixels[input + channel] as number;
    const sample16 = (channel: number): number => bitDepth === 16
      ? ((pixels[input + channel * 2] as number) << 8) | (pixels[input + channel * 2 + 1] as number)
      : pixels[input + channel] as number;
    if (colorType === 3) {
      const shift = 8 - bitDepth - ((column * bitDepth) % 8);
      const paletteIndex = ((pixels[input] as number) >>> shift) & ((1 << bitDepth) - 1);
      const paletteOffset = paletteIndex * 3;
      if (palette === null || paletteOffset + 2 >= palette.length) {
        throw new Error(`Image indexed PNG palette index ${String(paletteIndex)} is out of range.`);
      }
      rgba[output] = palette[paletteOffset] as number;
      rgba[output + 1] = palette[paletteOffset + 1] as number;
      rgba[output + 2] = palette[paletteOffset + 2] as number;
      rgba[output + 3] = transparency?.[paletteIndex] ?? 255;
    } else if (colorType === 0) {
      rgba[output] = sample8(0);
      rgba[output + 1] = sample8(0);
      rgba[output + 2] = sample8(0);
      rgba[output + 3] = sample16(0) === transparentGray ? 0 : 255;
    } else if (colorType === 2) {
      rgba[output] = sample8(0);
      rgba[output + 1] = sample8(1);
      rgba[output + 2] = sample8(2);
      rgba[output + 3] = transparentRgb !== null &&
        sample16(0) === transparentRgb.getUint16(0, false) &&
        sample16(1) === transparentRgb.getUint16(2, false) &&
        sample16(2) === transparentRgb.getUint16(4, false) ? 0 : 255;
    } else if (colorType === 4) {
      rgba[output] = sample8(0);
      rgba[output + 1] = sample8(0);
      rgba[output + 2] = sample8(0);
      rgba[output + 3] = sample8(1);
    } else {
      rgba[output] = sample8(0);
      rgba[output + 1] = sample8(1);
      rgba[output + 2] = sample8(2);
      rgba[output + 3] = sample8(3);
    }
  };
  if (interlace === 0) {
    const decoded = unfilterPngScanlines(inflated, 0, width, height, bitsPerPixel);
    if (decoded.nextOffset !== inflated.length) throw new Error('Image PNG scanline data has trailing bytes.');
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      decodePixel(decoded.pixels, decoded.stride, y, x, x, y);
    }
  } else {
    const passes = [
      [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
      [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
    ] as const;
    let sourceOffset = 0;
    for (const [startX, startY, stepX, stepY] of passes) {
      if (startX >= width || startY >= height) continue;
      const passWidth = Math.ceil((width - startX) / stepX);
      const passHeight = Math.ceil((height - startY) / stepY);
      const decoded = unfilterPngScanlines(inflated, sourceOffset, passWidth, passHeight, bitsPerPixel);
      sourceOffset = decoded.nextOffset;
      for (let y = 0; y < passHeight; y += 1) for (let x = 0; x < passWidth; x += 1) {
        decodePixel(decoded.pixels, decoded.stride, y, x, startX + x * stepX, startY + y * stepY);
      }
    }
    if (sourceOffset !== inflated.length) throw new Error('Image PNG Adam7 data has trailing bytes.');
  }
  return { width, height, rgba };
}

function decodeBmp(bytes: Uint8Array): DecodedRaster {
  if (bytes.byteLength < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new Error('Image BMP buffer has no valid BITMAPFILEHEADER.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelOffset = view.getUint32(10, true);
  const dibSize = view.getUint32(14, true);
  if (dibSize < 40 || 14 + dibSize > bytes.byteLength) throw new Error('Image BMP buffer has an unsupported DIB header.');
  const signedWidth = view.getInt32(18, true);
  const signedHeight = view.getInt32(22, true);
  const planes = view.getUint16(26, true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (planes !== 1 || signedWidth <= 0 || signedHeight === 0) throw new Error('Image BMP dimensions/planes are invalid.');
  if (![1, 4, 8, 16, 24, 32].includes(bitsPerPixel)) throw new Error(`Image BMP ${String(bitsPerPixel)}-bit pixels are unsupported.`);
  if (compression !== 0 && !(compression === 3 && (bitsPerPixel === 16 || bitsPerPixel === 32))) {
    throw new Error(`Image BMP compression ${String(compression)} is unsupported.`);
  }
  const width = signedWidth;
  const height = Math.abs(signedHeight);
  const topDown = signedHeight < 0;
  const stride = Math.ceil(width * bitsPerPixel / 32) * 4;
  if (pixelOffset + stride * height > bytes.byteLength) throw new Error('Image BMP pixel array is truncated.');
  const paletteEntries = bitsPerPixel <= 8
    ? Math.min(view.getUint32(46, true) || (1 << bitsPerPixel), 1 << bitsPerPixel)
    : 0;
  const paletteOffset = 14 + dibSize;
  if (paletteOffset + paletteEntries * 4 > pixelOffset) throw new Error('Image BMP palette overlaps its pixel array.');
  const maskOffset = dibSize >= 52 ? 14 + 40 : 14 + dibSize;
  const redMask = compression === 3 ? view.getUint32(maskOffset, true) : bitsPerPixel === 16 ? 0x7c00 : 0;
  const greenMask = compression === 3 ? view.getUint32(maskOffset + 4, true) : bitsPerPixel === 16 ? 0x03e0 : 0;
  const blueMask = compression === 3 ? view.getUint32(maskOffset + 8, true) : bitsPerPixel === 16 ? 0x001f : 0;
  const alphaMask = compression === 3 && maskOffset + 16 <= pixelOffset ? view.getUint32(maskOffset + 12, true) : 0;
  const maskChannel = (packed: number, mask: number, fallback: number): number => {
    if (mask === 0) return fallback;
    let shift = 0;
    while (((mask >>> shift) & 1) === 0 && shift < 32) shift += 1;
    const maximum = mask >>> shift;
    return Math.round((((packed & mask) >>> shift) / maximum) * 255);
  };
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - y - 1;
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      if (bitsPerPixel <= 8) {
        const packed = bytes[pixelOffset + sourceY * stride + Math.floor(x * bitsPerPixel / 8)] as number;
        const shift = 8 - bitsPerPixel - ((x * bitsPerPixel) % 8);
        const paletteIndex = (packed >>> shift) & ((1 << bitsPerPixel) - 1);
        if (paletteIndex >= paletteEntries) throw new Error(`Image BMP palette index ${String(paletteIndex)} is out of range.`);
        const color = paletteOffset + paletteIndex * 4;
        rgba[destination] = bytes[color + 2] as number;
        rgba[destination + 1] = bytes[color + 1] as number;
        rgba[destination + 2] = bytes[color] as number;
        rgba[destination + 3] = 255;
      } else if (bitsPerPixel === 16 || compression === 3) {
        const source = pixelOffset + sourceY * stride + x * (bitsPerPixel / 8);
        const packed = bitsPerPixel === 16 ? view.getUint16(source, true) : view.getUint32(source, true);
        rgba[destination] = maskChannel(packed, redMask, 0);
        rgba[destination + 1] = maskChannel(packed, greenMask, 0);
        rgba[destination + 2] = maskChannel(packed, blueMask, 0);
        rgba[destination + 3] = maskChannel(packed, alphaMask, 255);
      } else {
        const bytesPerSourcePixel = bitsPerPixel / 8;
        const source = pixelOffset + sourceY * stride + x * bytesPerSourcePixel;
        rgba[destination] = bytes[source + 2] as number;
        rgba[destination + 1] = bytes[source + 1] as number;
        rgba[destination + 2] = bytes[source] as number;
        rgba[destination + 3] = bitsPerPixel === 32 ? bytes[source + 3] as number : 255;
      }
    }
  }
  return { width, height, rgba };
}

function decodeTga(bytes: Uint8Array): DecodedRaster {
  if (bytes.byteLength < 18) throw new Error('Image TGA header is truncated.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0] as number;
  const colorMapType = bytes[1] as number;
  const imageType = bytes[2] as number;
  if (colorMapType !== 0 && colorMapType !== 1) throw new Error(`Image TGA color-map type ${String(colorMapType)} is invalid.`);
  const colorMapped = imageType === 1 || imageType === 9;
  if (colorMapped !== (colorMapType === 1)) throw new Error('Image TGA image/color-map types are inconsistent.');
  const rle = imageType === 9 || imageType === 10 || imageType === 11;
  const grayscale = imageType === 3 || imageType === 11;
  if (!rle && imageType !== 1 && imageType !== 2 && imageType !== 3) throw new Error(`Image TGA type ${String(imageType)} is unsupported.`);
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const depth = bytes[16] as number;
  const descriptor = bytes[17] as number;
  if (width === 0 || height === 0) throw new Error('Image TGA dimensions must be positive.');
  if (colorMapped ? depth !== 8 && depth !== 16 : grayscale ? depth !== 8 : depth !== 24 && depth !== 32) {
    throw new Error(`Image TGA ${String(depth)}-bit pixels are unsupported.`);
  }
  const colorMapFirst = view.getUint16(3, true);
  const colorMapLength = view.getUint16(5, true);
  const colorMapDepth = bytes[7] as number;
  if (colorMapped && colorMapLength === 0) throw new Error('Image TGA color map is empty.');
  if (colorMapped && colorMapDepth !== 24 && colorMapDepth !== 32) {
    throw new Error(`Image TGA ${String(colorMapDepth)}-bit palette entries are unsupported.`);
  }
  const sourcePixelSize = depth / 8;
  let offset = 18 + idLength;
  const colorMapEntrySize = colorMapDepth / 8;
  const colorMap = colorMapped
    ? bytes.slice(offset, offset + colorMapLength * colorMapEntrySize)
    : null;
  if (colorMapped && colorMap !== null && colorMap.byteLength !== colorMapLength * colorMapEntrySize) {
    throw new Error('Image TGA color map is truncated.');
  }
  if (colorMapped) offset += colorMapLength * colorMapEntrySize;
  const pixels = new Uint8Array(width * height * sourcePixelSize);
  let pixel = 0;
  const readPixelBytes = (): Uint8Array => {
    if (offset + sourcePixelSize > bytes.byteLength) throw new Error('Image TGA pixel data is truncated.');
    const result = bytes.slice(offset, offset + sourcePixelSize);
    offset += sourcePixelSize;
    return result;
  };
  if (!rle) {
    const length = pixels.byteLength;
    if (offset + length > bytes.byteLength) throw new Error('Image TGA pixel data is truncated.');
    pixels.set(bytes.subarray(offset, offset + length));
  } else {
    while (pixel < width * height) {
      if (offset >= bytes.byteLength) throw new Error('Image TGA RLE packet stream is truncated.');
      const header = bytes[offset++] as number;
      const count = (header & 0x7f) + 1;
      if (pixel + count > width * height) throw new Error('Image TGA RLE packet exceeds the pixel count.');
      if ((header & 0x80) !== 0) {
        const value = readPixelBytes();
        for (let index = 0; index < count; index += 1) pixels.set(value, (pixel + index) * sourcePixelSize);
      } else {
        for (let index = 0; index < count; index += 1) pixels.set(readPixelBytes(), (pixel + index) * sourcePixelSize);
      }
      pixel += count;
    }
  }
  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceX = rightOrigin ? width - x - 1 : x;
    const sourceY = topOrigin ? y : height - y - 1;
    const source = (sourceY * width + sourceX) * sourcePixelSize;
    const destination = (y * width + x) * 4;
    if (colorMapped) {
      const paletteIndex = sourcePixelSize === 1
        ? pixels[source] as number
        : (pixels[source] as number) | ((pixels[source + 1] as number) << 8);
      const relativeIndex = paletteIndex - colorMapFirst;
      if (colorMap === null || relativeIndex < 0 || relativeIndex >= colorMapLength) {
        throw new Error(`Image TGA palette index ${String(paletteIndex)} is out of range.`);
      }
      const paletteOffset = relativeIndex * colorMapEntrySize;
      rgba[destination] = colorMap[paletteOffset + 2] as number;
      rgba[destination + 1] = colorMap[paletteOffset + 1] as number;
      rgba[destination + 2] = colorMap[paletteOffset] as number;
      rgba[destination + 3] = colorMapDepth === 32 ? colorMap[paletteOffset + 3] as number : 255;
    } else if (grayscale) {
      rgba[destination] = pixels[source] as number;
      rgba[destination + 1] = pixels[source] as number;
      rgba[destination + 2] = pixels[source] as number;
      rgba[destination + 3] = 255;
    } else {
      rgba[destination] = pixels[source + 2] as number;
      rgba[destination + 1] = pixels[source + 1] as number;
      rgba[destination + 2] = pixels[source] as number;
      rgba[destination + 3] = depth === 32 ? pixels[source + 3] as number : 255;
    }
  }
  return { width, height, rgba };
}

function installDecodedRaster(image: GodotImage, raster: DecodedRaster): void {
  image.set_data(raster.width, raster.height, false, IMAGE_FORMAT.FORMAT_RGBA8, raster.rgba);
}

const writePixel = (state: MutableImageState, index: number, color: ColorValue): void => {
  const view = new DataView(state.data.buffer, state.data.byteOffset, state.data.byteLength);
  const offset = index * bytesPerPixel(state.format);
  switch (state.format) {
    case IMAGE_FORMAT.FORMAT_L8:
      state.data[offset] = byte(luminance(color)); return;
    case IMAGE_FORMAT.FORMAT_LA8:
      state.data[offset] = byte(luminance(color)); state.data[offset + 1] = byte(color.a); return;
    case IMAGE_FORMAT.FORMAT_R8:
      state.data[offset] = byte(color.r); return;
    case IMAGE_FORMAT.FORMAT_RG8:
      state.data[offset] = byte(color.r); state.data[offset + 1] = byte(color.g); return;
    case IMAGE_FORMAT.FORMAT_RGB8:
      state.data[offset] = byte(color.r); state.data[offset + 1] = byte(color.g); state.data[offset + 2] = byte(color.b); return;
    case IMAGE_FORMAT.FORMAT_RGBA8:
      state.data[offset] = byte(color.r); state.data[offset + 1] = byte(color.g); state.data[offset + 2] = byte(color.b); state.data[offset + 3] = byte(color.a); return;
    case IMAGE_FORMAT.FORMAT_RGBA4444:
      view.setUint16(offset, (Math.round(color.r * 15) << 12) | (Math.round(color.g * 15) << 8) | (Math.round(color.b * 15) << 4) | Math.round(color.a * 15), true); return;
    case IMAGE_FORMAT.FORMAT_RGB565:
      view.setUint16(offset, (Math.round(color.r * 31) << 11) | (Math.round(color.g * 63) << 5) | Math.round(color.b * 31), true); return;
    case IMAGE_FORMAT.FORMAT_RGBE9995: {
      const red = Math.max(0, color.r);
      const green = Math.max(0, color.g);
      const blue = Math.max(0, color.b);
      const maximum = Math.min(65408, Math.max(red, green, blue));
      if (maximum < 2 ** -24) { view.setUint32(offset, 0, true); return; }
      let exponent = Math.max(-15, Math.floor(Math.log2(maximum))) + 1;
      let sharedExponent = Math.min(31, exponent + 15);
      let scale = 2 ** (sharedExponent - 24);
      if (Math.round(maximum / scale) === 512 && sharedExponent < 31) {
        sharedExponent += 1;
        exponent += 1;
        scale = 2 ** (sharedExponent - 24);
      }
      const pack = (value: number): number => Math.min(511, Math.max(0, Math.round(value / scale)));
      view.setUint32(offset, (
        pack(red) | (pack(green) << 9) | (pack(blue) << 18) | (sharedExponent << 27)
      ) >>> 0, true);
      return;
    }
    case IMAGE_FORMAT.FORMAT_RF:
    case IMAGE_FORMAT.FORMAT_RGF:
    case IMAGE_FORMAT.FORMAT_RGBF:
    case IMAGE_FORMAT.FORMAT_RGBAF: {
      const channels = bytesPerPixel(state.format) / 4;
      view.setFloat32(offset, color.r, true);
      if (channels > 1) view.setFloat32(offset + 4, color.g, true);
      if (channels > 2) view.setFloat32(offset + 8, color.b, true);
      if (channels > 3) view.setFloat32(offset + 12, color.a, true);
      return;
    }
    case IMAGE_FORMAT.FORMAT_RH:
    case IMAGE_FORMAT.FORMAT_RGH:
    case IMAGE_FORMAT.FORMAT_RGBH:
    case IMAGE_FORMAT.FORMAT_RGBAH: {
      const channels = bytesPerPixel(state.format) / 2;
      view.setUint16(offset, floatToHalf(color.r), true);
      if (channels > 1) view.setUint16(offset + 2, floatToHalf(color.g), true);
      if (channels > 2) view.setUint16(offset + 4, floatToHalf(color.b), true);
      if (channels > 3) view.setUint16(offset + 6, floatToHalf(color.a), true);
      return;
    }
    case IMAGE_FORMAT.FORMAT_R16:
    case IMAGE_FORMAT.FORMAT_RG16:
    case IMAGE_FORMAT.FORMAT_RGB16:
    case IMAGE_FORMAT.FORMAT_RGBA16:
    case IMAGE_FORMAT.FORMAT_R16I:
    case IMAGE_FORMAT.FORMAT_RG16I:
    case IMAGE_FORMAT.FORMAT_RGB16I:
    case IMAGE_FORMAT.FORMAT_RGBA16I: {
      const channels = bytesPerPixel(state.format) / 2;
      view.setUint16(offset, Math.round(Math.min(1, Math.max(0, color.r)) * 65535), true);
      if (channels > 1) view.setUint16(offset + 2, Math.round(Math.min(1, Math.max(0, color.g)) * 65535), true);
      if (channels > 2) view.setUint16(offset + 4, Math.round(Math.min(1, Math.max(0, color.b)) * 65535), true);
      if (channels > 3) view.setUint16(offset + 6, Math.round(Math.min(1, Math.max(0, color.a)) * 65535), true);
      return;
    }
  }
};

const clippedRect = (rect: ImageRect, width: number, height: number) => {
  const x0 = Math.max(0, integer(rect.position.x, 'rect.x'));
  const y0 = Math.max(0, integer(rect.position.y, 'rect.y'));
  const x1 = Math.min(width, integer(rect.position.x + rect.size.x, 'rect.end.x'));
  const y1 = Math.min(height, integer(rect.position.y + rect.size.y, 'rect.end.y'));
  return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
};

export function createGodotImage(
  width: number = 0,
  height: number = 0,
  mipmaps: boolean = false,
  format: number = IMAGE_FORMAT.FORMAT_L8,
  data?: Iterable<number>,
): GodotImage {
  const w = integer(width, 'width');
  const h = integer(height, 'height');
  if (w < 0 || h < 0) throw new Error('Image dimensions cannot be negative');
  const length = mipmapDataSize(w, h, format, mipmaps);
  const initialData = data === undefined ? undefined : Uint8Array.from(data);
  if (initialData !== undefined && initialData.byteLength !== length) throw new Error(`Image data length ${initialData.byteLength} does not match required ${length}`);
  const state: MutableImageState = { width: w, height: h, format, mipmaps, data: initialData === undefined ? new Uint8Array(length) : initialData };

  const indexOf = (x: number, y: number): number => {
    const ix = integer(x, 'pixel x'); const iy = integer(y, 'pixel y');
    if (ix < 0 || iy < 0 || ix >= state.width || iy >= state.height) throw new Error(`Image pixel (${ix}, ${iy}) is out of bounds`);
    return iy * state.width + ix;
  };
  const api: GodotImage = {
    get width() { return state.width; }, get height() { return state.height; }, get format() { return state.format; },
    get_width: () => state.width, get_height: () => state.height, get_size: () => vec2(state.width, state.height), get_format: () => state.format,
    get_data: () => packedByteArray(state.data), get_data_size: () => state.data.byteLength,
    create(nextWidth, nextHeight, nextMipmaps, nextFormat) {
      const [w2, h2] = positiveImageDimensions(nextWidth, nextHeight, 'create');
      state.width = w2; state.height = h2; state.format = nextFormat; state.mipmaps = nextMipmaps;
      state.data = new Uint8Array(mipmapDataSize(w2, h2, nextFormat, nextMipmaps));
    },
    create_from_data(nextWidth, nextHeight, nextMipmaps, nextFormat, nextData) {
      api.set_data(nextWidth, nextHeight, nextMipmaps, nextFormat, nextData);
    },
    set_data(nextWidth, nextHeight, nextMipmaps, nextFormat, nextData) {
      const [w2, h2] = positiveImageDimensions(nextWidth, nextHeight, 'set_data');
      const bytes = Uint8Array.from(nextData);
      const needed = mipmapDataSize(w2, h2, nextFormat, nextMipmaps);
      if (bytes.byteLength !== needed) throw new Error(`Image data length ${bytes.byteLength} does not match required ${needed}`);
      state.width = w2; state.height = h2; state.format = nextFormat; state.mipmaps = nextMipmaps; state.data = bytes;
    },
    convert(nextFormat) {
      if (nextFormat === state.format) return;
      bytesPerPixel(nextFormat);
      const colors = Array.from({ length: state.width * state.height }, (_, index) => readPixel(state, index));
      const hadMipmaps = state.mipmaps;
      state.format = nextFormat; state.mipmaps = false; state.data = new Uint8Array(state.width * state.height * bytesPerPixel(nextFormat));
      colors.forEach((color, index) => writePixel(state, index, color));
      if (hadMipmaps) generateMipmapChain(state);
    },
    has_mipmaps: () => state.mipmaps,
    get_mipmap_count: () => state.mipmaps ? mipmapDimensions(state.width, state.height).length - 1 : 0,
    get_mipmap_offset(mipmap) {
      const maximum = state.mipmaps ? mipmapDimensions(state.width, state.height).length - 1 : 0;
      if (!Number.isSafeInteger(mipmap) || mipmap < 0 || mipmap > maximum) throw new Error(`Image mipmap level ${mipmap} is out of range`);
      return mipmapOffset(state.width, state.height, state.format, mipmap);
    },
    get_image_from_mipmap(mipmap) {
      const maximum = state.mipmaps ? mipmapDimensions(state.width, state.height).length - 1 : 0;
      if (!Number.isSafeInteger(mipmap) || mipmap < 0 || mipmap > maximum) {
        throw new RangeError(`Image.get_image_from_mipmap level ${String(mipmap)} is out of range 0..${maximum}.`);
      }
      const dimensions = mipmapDimensions(state.width, state.height)[mipmap] as { width: number; height: number };
      const offset = mipmapOffset(state.width, state.height, state.format, mipmap);
      const length = dimensions.width * dimensions.height * bytesPerPixel(state.format);
      return createGodotImage(
        dimensions.width,
        dimensions.height,
        false,
        state.format,
        state.data.subarray(offset, offset + length),
      );
    },
    is_empty: () => state.width === 0 || state.height === 0,
    empty: () => state.width === 0 || state.height === 0,
    is_size_po2: () => state.width > 0 && state.height > 0 &&
      (state.width & (state.width - 1)) === 0 && (state.height & (state.height - 1)) === 0,
    lock() {},
    unlock() {},
    get_pixel: (x, y) => readPixel(state, indexOf(x, y)),
    get_pixelv: (point) => readPixel(state, indexOf(point.x, point.y)),
    set_pixel: (x, y, color) => writePixel(state, indexOf(x, y), color),
    set_pixelv: (point, color) => writePixel(state, indexOf(point.x, point.y), color),
    fill(color) { for (let i = 0; i < state.width * state.height; i += 1) writePixel(state, i, color); },
    fill_rect(rect, color) {
      const rawX = integer(rect.position.x, 'rect.x'), rawY = integer(rect.position.y, 'rect.y');
      const rawWidth = integer(rect.size.x, 'rect.width'), rawHeight = integer(rect.size.y, 'rect.height');
      const absoluteRect = {
        position: vec2(rawWidth < 0 ? rawX + rawWidth : rawX, rawHeight < 0 ? rawY + rawHeight : rawY),
        size: vec2(Math.abs(rawWidth), Math.abs(rawHeight)),
      };
      const r = clippedRect(absoluteRect, state.width, state.height);
      for (let y = r.y0; y < r.y1; y += 1) for (let x = r.x0; x < r.x1; x += 1) writePixel(state, y * state.width + x, color);
    },
    get_region(rect) {
      const requestedWidth = integer(rect.size.x, 'region width');
      const requestedHeight = integer(rect.size.y, 'region height');
      if (requestedWidth <= 0 || requestedHeight <= 0) throw new Error('Image.get_region requires a positive authored region size');
      const result = createGodotImage(requestedWidth, requestedHeight, false, state.format);
      result.blit_rect(api, rect, vec2());
      return result;
    },
    get_rect(rect) { return api.get_region(rect); },
    get_used_rect() { let minX = state.width, minY = state.height, maxX = -1, maxY = -1; for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width; x += 1) if (readPixel(state, y * state.width + x).a > 0) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } return maxX < minX ? { position: vec2(), size: vec2() } : { position: vec2(minX, minY), size: vec2(maxX - minX + 1, maxY - minY + 1) }; },
    crop(newWidth, newHeight) {
      const w2 = integer(newWidth, 'crop width'), h2 = integer(newHeight, 'crop height');
      if (w2 <= 0 || h2 <= 0) throw new Error('Image.crop dimensions must be positive');
      const hadMipmaps = state.mipmaps;
      const oldBaseSize = state.width * state.height * bytesPerPixel(state.format);
      const old = createGodotImage(state.width, state.height, false, state.format, state.data.subarray(0, oldBaseSize));
      state.width = w2; state.height = h2; state.mipmaps = false;
      state.data = new Uint8Array(w2 * h2 * bytesPerPixel(state.format));
      for (let y = 0; y < Math.min(h2, old.height); y += 1) for (let x = 0; x < Math.min(w2, old.width); x += 1) writePixel(state, y * w2 + x, old.get_pixel(x, y));
      if (hadMipmaps) generateMipmapChain(state);
    },
    resize(newWidth, newHeight, interpolation = 1) { resizeState(state, newWidth, newHeight, interpolation); },
    resize_to_po2(square = false, interpolation = 1) { const po2 = (v: number) => { let p = 1; while (p < v) p *= 2; return p; }; const w2 = po2(state.width), h2 = po2(state.height); api.resize(square ? Math.max(w2, h2) : w2, square ? Math.max(w2, h2) : h2, interpolation); },
    shrink_x2() { api.resize(Math.max(1, state.width >> 1), Math.max(1, state.height >> 1), 1); },
    flip_x() { for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width >> 1; x += 1) swapPixels(state, y * state.width + x, y * state.width + state.width - x - 1); },
    flip_y() { for (let y = 0; y < state.height >> 1; y += 1) for (let x = 0; x < state.width; x += 1) swapPixels(state, y * state.width + x, (state.height - y - 1) * state.width + x); },
    rotate_90(direction) { rotate90(state, direction); }, rotate_180() { api.flip_x(); api.flip_y(); },
    blit_rect(source, rect, destination) { copyRect(api, source, undefined, rect, destination, false); },
    blend_rect(source, rect, destination) { copyRect(api, source, undefined, rect, destination, true); },
    blit_rect_mask(source, mask, rect, destination) { copyRect(api, source, mask, rect, destination, false); },
    blend_rect_mask(source, mask, rect, destination) { copyRect(api, source, mask, rect, destination, true); },
    copy_from(source) { state.width = source.width; state.height = source.height; state.format = source.format; state.mipmaps = source.has_mipmaps(); state.data = Uint8Array.from(source.get_data()); },
    detect_alpha() {
      if (!(<readonly number[]>[
        IMAGE_FORMAT.FORMAT_LA8,
        IMAGE_FORMAT.FORMAT_RGBA8,
        IMAGE_FORMAT.FORMAT_RGBA4444,
        IMAGE_FORMAT.FORMAT_RGBAF,
        IMAGE_FORMAT.FORMAT_RGBAH,
        IMAGE_FORMAT.FORMAT_RGBA16,
        IMAGE_FORMAT.FORMAT_RGBA16I,
      ]).includes(state.format)) return 0;
      let hasBitAlpha = false;
      for (let index = 0; index < state.width * state.height; index += 1) {
        const alpha = readPixel(state, index).a;
        if (alpha > 0 && alpha < 1) return 2;
        if (alpha <= 0) hasBitAlpha = true;
      }
      return hasBitAlpha ? 1 : 0;
    },
    is_invisible() { for (let i = 0; i < state.width * state.height; i += 1) if (readPixel(state, i).a !== 0) return false; return true; },
    detect_used_channels(source = 0) {
      if (!Number.isSafeInteger(source) || source < 0 || source > 2) throw new Error(`Image.detect_used_channels source ${source} is outside CompressSource`);
      if (state.data.byteLength === 0) return 5;
      if (source === 2) return 3;
      if (state.format === IMAGE_FORMAT.FORMAT_L8) return 0;
      if ((<readonly number[]>[IMAGE_FORMAT.FORMAT_R8, IMAGE_FORMAT.FORMAT_RH, IMAGE_FORMAT.FORMAT_RF, IMAGE_FORMAT.FORMAT_R16, IMAGE_FORMAT.FORMAT_R16I]).includes(state.format)) return 2;
      const supportsAlpha = (<readonly number[]>[IMAGE_FORMAT.FORMAT_RGBA8, IMAGE_FORMAT.FORMAT_RGBA4444, IMAGE_FORMAT.FORMAT_RGBAH, IMAGE_FORMAT.FORMAT_RGBAF, IMAGE_FORMAT.FORMAT_RGBA16, IMAGE_FORMAT.FORMAT_RGBA16I]).includes(state.format);
      let red = false, green = false, blue = false, alpha = false, colored = false;
      for (let i = 0; i < state.width * state.height; i += 1) {
        const c = readPixel(state, i);
        red ||= c.r > 0.001;
        green ||= c.g > 0.001;
        blue ||= c.b > 0.001;
        alpha ||= c.a < 0.999;
        colored ||= c.r !== c.b || c.r !== c.g || c.b !== c.g;
        if (red && green && blue && colored && (!supportsAlpha || alpha)) break;
      }
      let used = !colored ? (alpha ? 1 : 0) : alpha ? 5 : blue ? 4 : green ? 3 : 2;
      if (source === 1 && (used === 2 || used === 3)) used = 4;
      return used;
    },
    is_compressed: () => false,
    decompress: () => 2,
    compress() { throw new Error('Image.compress is unsupported: no Godot-compatible texture codec is installed'); },
    compress_from_channels() { throw new Error('Image.compress_from_channels is unsupported: no Godot-compatible texture codec is installed'); },
    premultiply_alpha() {
      if (state.format !== IMAGE_FORMAT.FORMAT_RGBA8) return;
      for (let offset = 0; offset < state.data.byteLength; offset += 4) {
        const alpha = state.data[offset + 3] as number;
        state.data[offset] = (((state.data[offset] as number) * alpha + 255) >>> 8);
        state.data[offset + 1] = (((state.data[offset + 1] as number) * alpha + 255) >>> 8);
        state.data[offset + 2] = (((state.data[offset + 2] as number) * alpha + 255) >>> 8);
      }
    },
    srgb_to_linear() {
      if (state.format !== IMAGE_FORMAT.FORMAT_RGB8 && state.format !== IMAGE_FORMAT.FORMAT_RGBA8) return;
      transformRgb(state, srgbToLinear);
    },
    linear_to_srgb() {
      if (state.format !== IMAGE_FORMAT.FORMAT_RGB8 && state.format !== IMAGE_FORMAT.FORMAT_RGBA8) return;
      transformRgb(state, linearToSrgb);
    },
    adjust_bcs(brightness, contrast, saturation) {
      if (![brightness, contrast, saturation].every(Number.isFinite)) throw new Error('Image.adjust_bcs arguments must be finite');
      for (let i = 0; i < state.width * state.height; i += 1) {
        const c = readPixel(state, i);
        const brightRed = c.r * brightness, brightGreen = c.g * brightness, brightBlue = c.b * brightness;
        const contrastRed = 0.5 + (brightRed - 0.5) * contrast;
        const contrastGreen = 0.5 + (brightGreen - 0.5) * contrast;
        const contrastBlue = 0.5 + (brightBlue - 0.5) * contrast;
        const center = (contrastRed + contrastGreen + contrastBlue) / 3;
        const apply = (channel: number) => center + (channel - center) * saturation;
        writePixel(state, i, godotColor(apply(contrastRed), apply(contrastGreen), apply(contrastBlue), c.a));
      }
    },
    fix_alpha_edges() {
      if (state.data.byteLength === 0 || state.format !== IMAGE_FORMAT.FORMAT_RGBA8) return;
      const sourceData = new Uint8Array(state.data);
      for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width; x += 1) {
        const destinationOffset = (y * state.width + x) * 4;
        if ((sourceData[destinationOffset + 3] as number) >= 20) continue;
        let closestDistance = Number.MAX_SAFE_INTEGER;
        let closestOffset = -1;
        for (let sampleY = Math.max(0, y - 4); sampleY <= Math.min(state.height - 1, y + 4); sampleY += 1) {
          for (let sampleX = Math.max(0, x - 4); sampleX <= Math.min(state.width - 1, x + 4); sampleX += 1) {
            const dx = x - sampleX, dy = y - sampleY, distance = dx * dx + dy * dy;
            if (distance >= closestDistance) continue;
            const sampleOffset = (sampleY * state.width + sampleX) * 4;
            if ((sourceData[sampleOffset + 3] as number) < 20) continue;
            closestDistance = distance;
            closestOffset = sampleOffset;
          }
        }
        if (closestOffset >= 0) {
          state.data[destinationOffset] = sourceData[closestOffset] as number;
          state.data[destinationOffset + 1] = sourceData[closestOffset + 1] as number;
          state.data[destinationOffset + 2] = sourceData[closestOffset + 2] as number;
        }
      }
    },
    normal_map_to_xy() {
      api.convert(IMAGE_FORMAT.FORMAT_RGBA8);
      for (let offset = 0; offset < state.data.byteLength; offset += 4) {
        state.data[offset + 3] = state.data[offset] as number;
        state.data[offset] = state.data[offset + 1] as number;
        state.data[offset + 2] = state.data[offset + 1] as number;
      }
      api.convert(IMAGE_FORMAT.FORMAT_LA8);
    },
    rgbe_to_srgb() {
      if (state.format !== IMAGE_FORMAT.FORMAT_RGBE9995) {
        throw new Error(`Image.rgbe_to_srgb requires FORMAT_RGBE9995, received ${getGodotImageFormatName(state.format)}.`);
      }
      const data = new Uint8Array(state.width * state.height * 3);
      for (let index = 0; index < state.width * state.height; index += 1) {
        const color = readPixel(state, index);
        data[index * 3] = byte(linearToSrgb(color.r));
        data[index * 3 + 1] = byte(linearToSrgb(color.g));
        data[index * 3 + 2] = byte(linearToSrgb(color.b));
      }
      return createGodotImage(state.width, state.height, false, IMAGE_FORMAT.FORMAT_RGB8, data);
    },
    bump_map_to_normal_map(bumpScale = 1) {
      if (!Number.isFinite(bumpScale)) throw new Error('Image.bump_map_to_normal_map bump_scale must be finite');
      if (state.data.byteLength === 0) return;
      api.convert(IMAGE_FORMAT.FORMAT_RF);
      const heights = new Float32Array(state.width * state.height);
      for (let index = 0; index < heights.length; index += 1) heights[index] = readPixel(state, index).r;
      const result = new Uint8Array(state.width * state.height * 4);
      for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width; x += 1) {
        const rightX = x + 1 === state.width ? 0 : x + 1;
        const aboveY = y + 1 === state.height ? 0 : y + 1;
        const here = heights[y * state.width + x] as number;
        const right = heights[y * state.width + rightX] as number;
        const above = heights[aboveY * state.width + x] as number;
        // cross((1, 0, right-here), (0, 1, here-above))
        let nx = -(right - here) * bumpScale;
        let ny = -(here - above) * bumpScale;
        let nz = 1;
        const length = Math.hypot(nx, ny, nz);
        nx /= length; ny /= length; nz /= length;
        const offset = (y * state.width + x) * 4;
        result[offset] = Math.trunc(127.5 + nx * 127.5);
        result[offset + 1] = Math.trunc(127.5 + ny * 127.5);
        result[offset + 2] = Math.trunc(127.5 + nz * 127.5);
        result[offset + 3] = 255;
      }
      state.format = IMAGE_FORMAT.FORMAT_RGBA8;
      const hadMipmaps = state.mipmaps;
      state.mipmaps = false;
      state.data = result;
      if (hadMipmaps) generateMipmapChain(state);
    },
    compute_image_metrics(comparedImage, useLuma = true) {
      if (state.format >= IMAGE_FORMAT.FORMAT_RH && state.format <= IMAGE_FORMAT.FORMAT_RGBE9995) {
        throw new Error('Image.compute_image_metrics does not support HDR source images');
      }
      if (comparedImage.format >= IMAGE_FORMAT.FORMAT_RH && comparedImage.format <= IMAGE_FORMAT.FORMAT_RGBE9995) {
        throw new Error('Image.compute_image_metrics does not support HDR compared images');
      }
      const histogram = new Float64Array(256);
      const metricWidth = Math.min(state.width, comparedImage.width);
      const metricHeight = Math.min(state.height, comparedImage.height);
      const channelByte = (value: number): number => {
        if (value > 1) throw new Error('Image.compute_image_metrics cannot compare HDR color channels');
        return byte(value);
      };
      for (let y = 0; y < metricHeight; y += 1) for (let x = 0; x < metricWidth; x += 1) {
        const a = readPixel(state, y * state.width + x);
        const b = comparedImage.get_pixel(x, y);
        if (useLuma) {
          const lumaA = (13938 * channelByte(a.r) + 46869 * channelByte(a.g) + 4729 * channelByte(a.b) + 32768) >>> 16;
          const lumaB = (13938 * channelByte(b.r) + 46869 * channelByte(b.g) + 4729 * channelByte(b.b) + 32768) >>> 16;
          const difference = Math.abs(lumaA - lumaB);
          histogram[difference] = (histogram[difference] ?? 0) + 1;
        } else {
          const differences = [
            Math.abs(channelByte(a.r) - channelByte(b.r)),
            Math.abs(channelByte(a.g) - channelByte(b.g)),
            Math.abs(channelByte(a.b) - channelByte(b.b)),
            Math.abs(channelByte(a.a) - channelByte(b.a)),
          ];
          for (const difference of differences) histogram[difference] = (histogram[difference] ?? 0) + 1;
        }
      }
      let maximum = 0, sum = 0, squaredSum = 0;
      for (let difference = 0; difference < histogram.length; difference += 1) {
        const count = histogram[difference] as number;
        if (count === 0) continue;
        maximum = difference;
        const weighted = difference * count;
        sum += weighted;
        squaredSum += difference * weighted;
      }
      // Pinned Godot applies this four-component divisor even to the luma histogram.
      const totalValues = metricWidth * metricHeight * 4;
      const mean = Math.min(255, Math.max(0, sum / totalValues));
      const meanSquared = Math.min(255 * 255, Math.max(0, squaredSum / totalValues));
      const rootMeanSquared = Math.sqrt(meanSquared);
      const peakSnr = rootMeanSquared === 0 ? 1e10 : Math.min(500, Math.max(0, Math.log10(255 / rootMeanSquared) * 20));
      return { max: maximum, mean, mean_squared: meanSquared, root_mean_squared: rootMeanSquared, peak_snr: peakSnr };
    },
    load(path) {
      if (typeof path !== 'string') throw new TypeError('Image.load path must be a String.');
      let bytes: Uint8Array;
      try {
        bytes = GodotFileAccess.get_file_as_bytes(path);
      } catch {
        return 7;
      }
      const extension = path.toLowerCase().split('.').at(-1) ?? '';
      try {
        if (extension === 'png') installDecodedRaster(api, decodePng(bytes));
        else if (extension === 'bmp') installDecodedRaster(api, decodeBmp(bytes));
        else if (extension === 'tga') installDecodedRaster(api, decodeTga(bytes));
        else return 15;
        return 0;
      } catch {
        return 16;
      }
    },
    save_png(path) {
      if (typeof path !== 'string') throw new TypeError('Image.save_png path must be a String.');
      const file = GodotFileAccess.open(path, FileAccessMode.WRITE);
      if (file === null) return GodotFileAccess.get_open_error();
      file.store_buffer(encodePng(state));
      file.close();
      return 0;
    },
    save_png_to_buffer() { return packedByteArray(encodePng(state)); },
    save_jpg() { throw new Error('Image.save_jpg is unsupported: no synchronous Godot-compatible JPEG codec is installed'); },
    save_jpg_to_buffer() { throw new Error('Image.save_jpg_to_buffer is unsupported: no synchronous Godot-compatible JPEG codec is installed'); },
    save_webp() { throw new Error('Image.save_webp is unsupported: no synchronous Godot-compatible WebP codec is installed'); },
    save_webp_to_buffer() { throw new Error('Image.save_webp_to_buffer is unsupported: no synchronous Godot-compatible WebP codec is installed'); },
    save_exr() { throw new Error('Image.save_exr is unsupported: no Godot-compatible EXR codec is installed'); },
    save_exr_to_buffer() { throw new Error('Image.save_exr_to_buffer is unsupported: no Godot-compatible EXR codec is installed'); },
    save_dds() { throw new Error('Image.save_dds is unsupported: no Godot-compatible DDS codec is installed'); },
    save_dds_to_buffer() { throw new Error('Image.save_dds_to_buffer is unsupported: no Godot-compatible DDS codec is installed'); },
    load_png_from_buffer(data) {
      try { installDecodedRaster(api, decodePng(Uint8Array.from(data))); return 0; }
      catch { return 16; }
    },
    load_jpg_from_buffer() { throw new Error('Image.load_jpg_from_buffer is unsupported: browser decoding is asynchronous'); },
    load_webp_from_buffer() { throw new Error('Image.load_webp_from_buffer is unsupported: browser decoding is asynchronous'); },
    load_tga_from_buffer(data) {
      try { installDecodedRaster(api, decodeTga(Uint8Array.from(data))); return 0; }
      catch { return 16; }
    },
    load_bmp_from_buffer(data) {
      try { installDecodedRaster(api, decodeBmp(Uint8Array.from(data))); return 0; }
      catch { return 16; }
    },
    load_ktx_from_buffer() { throw new Error('Image.load_ktx_from_buffer is unsupported: no Godot-compatible KTX codec is installed'); },
    load_dds_from_buffer() { throw new Error('Image.load_dds_from_buffer is unsupported: no Godot-compatible DDS codec is installed'); },
    load_exr_from_buffer() { throw new Error('Image.load_exr_from_buffer is unsupported: no Godot-compatible EXR codec is installed'); },
    load_svg_from_buffer() { throw new Error('Image.load_svg_from_buffer is unsupported: browser SVG decoding is asynchronous'); },
    load_svg_from_string() { throw new Error('Image.load_svg_from_string is unsupported: browser SVG decoding is asynchronous'); },
    clear_mipmaps() {
      if (!state.mipmaps) return;
      state.data = state.data.slice(0, state.width * state.height * bytesPerPixel(state.format));
      state.mipmaps = false;
    },
    generate_mipmaps(renormalize = false) {
      generateMipmapChain(state, renormalize);
    },
  };
  registerGodotObjectIdentity(api, 'Image');
  bindGodotResourceProtocol(api, {
    createDuplicate(source) {
      return createGodotImage(
        source.width,
        source.height,
        source.has_mipmaps(),
        source.format,
        source.get_data(),
      );
    },
  });
  installImageChangedSignals(api);
  return api;
}

/** Decode the browser's canonical RGBA pixel carrier without introducing an engine mirror. */
export function createGodotImageFromImageData(imageData: ImageData): GodotImage {
  if (typeof ImageData === 'undefined' || !(imageData instanceof ImageData)) {
    throw new TypeError('createGodotImageFromImageData requires a browser ImageData value.');
  }
  return createGodotImage(
    imageData.width,
    imageData.height,
    false,
    IMAGE_FORMAT.FORMAT_RGBA8,
    new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength),
  );
}

/** Materialize retained Image pixels as the browser's own canvas carrier. */
export function godotImageToImageData(image: GodotImage): ImageData {
  if (typeof ImageData === 'undefined') throw new Error('godotImageToImageData requires the browser ImageData API.');
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const color = image.get_pixel(x, y);
    const offset = (y * image.width + x) * 4;
    rgba[offset] = byte(color.r);
    rgba[offset + 1] = byte(color.g);
    rgba[offset + 2] = byte(color.b);
    rgba[offset + 3] = byte(color.a);
  }
  return new ImageData(rgba, image.width, image.height);
}

/** Standards-valid PNG Blob for browser downloads and File System Access writes. */
export function godotImageToPngBlob(image: GodotImage): Blob {
  if (typeof Blob === 'undefined') throw new Error('godotImageToPngBlob requires the browser Blob API.');
  return new Blob([Uint8Array.from(image.save_png_to_buffer())], { type: 'image/png' });
}

/** Methods that mutate Image's retained pixel buffer and therefore emit Resource.changed. */
const IMAGE_MUTATORS = [
  'create',
  'create_from_data',
  'set_data',
  'convert',
  'set_pixel',
  'set_pixelv',
  'fill',
  'fill_rect',
  'crop',
  'resize',
  'resize_to_po2',
  'shrink_x2',
  'flip_x',
  'flip_y',
  'rotate_90',
  'rotate_180',
  'blit_rect',
  'blend_rect',
  'blit_rect_mask',
  'blend_rect_mask',
  'copy_from',
  'decompress',
  'premultiply_alpha',
  'srgb_to_linear',
  'linear_to_srgb',
  'adjust_bcs',
  'fix_alpha_edges',
  'normal_map_to_xy',
  'bump_map_to_normal_map',
  'load',
  'load_png_from_buffer',
  'load_jpg_from_buffer',
  'load_webp_from_buffer',
  'load_tga_from_buffer',
  'load_bmp_from_buffer',
  'load_ktx_from_buffer',
  'load_dds_from_buffer',
  'load_exr_from_buffer',
  'load_svg_from_buffer',
  'load_svg_from_string',
  'generate_mipmaps',
  'clear_mipmaps',
] as const satisfies readonly (keyof GodotImage)[];

function installImageChangedSignals(image: GodotImage): void {
  const errorResultMutators = new Set<keyof GodotImage>([
    'decompress',
    'load',
    'load_png_from_buffer',
    'load_jpg_from_buffer',
    'load_webp_from_buffer',
    'load_tga_from_buffer',
    'load_bmp_from_buffer',
    'load_ktx_from_buffer',
    'load_dds_from_buffer',
    'load_exr_from_buffer',
    'load_svg_from_buffer',
    'load_svg_from_string',
  ]);
  let mutationDepth = 0;
  for (const name of IMAGE_MUTATORS) {
    const member = image[name];
    if (typeof member !== 'function') continue;
    const invoke = member.bind(image) as (...args: unknown[]) => unknown;
    Object.defineProperty(image, name, {
      configurable: true,
      enumerable: true,
      value: (...args: unknown[]) => {
        mutationDepth += 1;
        let result: unknown;
        let completed = false;
        try {
          result = invoke(...args);
          completed = true;
          return result;
        } finally {
          mutationDepth -= 1;
          if (mutationDepth === 0 && completed && (!errorResultMutators.has(name) || result === 0)) {
            godotResourceEmitChanged(image);
          }
        }
      },
    });
  }
}

function swapPixels(state: MutableImageState, a: number, b: number): void { const first = readPixel(state, a); writePixel(state, a, readPixel(state, b)); writePixel(state, b, first); }

function imagePixel(state: MutableImageState, x: number, y: number): ColorValue {
  const clampedX = Math.max(0, Math.min(state.width - 1, x));
  const clampedY = Math.max(0, Math.min(state.height - 1, y));
  return readPixel(state, clampedY * state.width + clampedX);
}

function weightedColor(samples: readonly { readonly color: ColorValue; readonly weight: number }[]): ColorValue {
  let weight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  for (const sample of samples) {
    weight += sample.weight;
    red += sample.color.r * sample.weight;
    green += sample.color.g * sample.weight;
    blue += sample.color.b * sample.weight;
    alpha += sample.color.a * sample.weight;
  }
  if (weight === 0) return godotColor();
  return godotColor(red / weight, green / weight, blue / weight, alpha / weight);
}

function sampleNearest(state: MutableImageState, x: number, y: number): ColorValue {
  return imagePixel(state, Math.round(x), Math.round(y));
}

function sampleBilinear(state: MutableImageState, x: number, y: number): ColorValue {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  return lerpColor(
    lerpColor(imagePixel(state, x0, y0), imagePixel(state, x1, y0), tx),
    lerpColor(imagePixel(state, x0, y1), imagePixel(state, x1, y1), tx),
    ty,
  );
}

function cubicWeight(value: number): number {
  const x = Math.abs(value);
  if (x <= 1) return (1.5 * x - 2.5) * x * x + 1;
  if (x < 2) return ((-0.5 * x + 2.5) * x - 4) * x + 2;
  return 0;
}

function sampleBicubic(state: MutableImageState, x: number, y: number): ColorValue {
  const centerX = Math.floor(x);
  const centerY = Math.floor(y);
  const samples: { color: ColorValue; weight: number }[] = [];
  for (let row = -1; row <= 2; row += 1) {
    const weightY = cubicWeight(y - (centerY + row));
    for (let column = -1; column <= 2; column += 1) {
      samples.push({
        color: imagePixel(state, centerX + column, centerY + row),
        weight: cubicWeight(x - (centerX + column)) * weightY,
      });
    }
  }
  return weightedColor(samples);
}

function sinc(value: number): number {
  if (value === 0) return 1;
  const angle = Math.PI * value;
  return Math.sin(angle) / angle;
}

function lanczosWeight(value: number): number {
  const x = Math.abs(value);
  return x < 3 ? sinc(x) * sinc(x / 3) : 0;
}

function sampleLanczos(state: MutableImageState, x: number, y: number): ColorValue {
  const centerX = Math.floor(x);
  const centerY = Math.floor(y);
  const samples: { color: ColorValue; weight: number }[] = [];
  for (let row = -2; row <= 3; row += 1) {
    const weightY = lanczosWeight(y - (centerY + row));
    for (let column = -2; column <= 3; column += 1) {
      samples.push({
        color: imagePixel(state, centerX + column, centerY + row),
        weight: lanczosWeight(x - (centerX + column)) * weightY,
      });
    }
  }
  return weightedColor(samples);
}

function resizeLevel(
  source: MutableImageState,
  width: number,
  height: number,
  sampler: (state: MutableImageState, x: number, y: number) => ColorValue,
): MutableImageState {
  const result: MutableImageState = {
    width,
    height,
    format: source.format,
    mipmaps: false,
    data: new Uint8Array(width * height * bytesPerPixel(source.format)),
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * source.width / width - 0.5;
      const sourceY = (y + 0.5) * source.height / height - 0.5;
      writePixel(result, y * width + x, sampler(source, sourceX, sourceY));
    }
  }
  return result;
}

function resizeTrilinear(source: MutableImageState, width: number, height: number): MutableImageState {
  const downscale = Math.max(source.width / width, source.height / height);
  if (downscale <= 1) return resizeLevel(source, width, height, sampleBilinear);
  const level = Math.max(0, Math.floor(Math.log2(downscale)));
  let lower = source;
  for (let index = 0; index < level; index += 1) {
    lower = resizeLevel(lower, Math.max(1, lower.width >> 1), Math.max(1, lower.height >> 1), sampleBilinear);
  }
  const upper = resizeLevel(lower, Math.max(1, lower.width >> 1), Math.max(1, lower.height >> 1), sampleBilinear);
  const lowerResult = resizeLevel(lower, width, height, sampleBilinear);
  const upperResult = resizeLevel(upper, width, height, sampleBilinear);
  const blend = Math.log2(downscale) - level;
  const result: MutableImageState = {
    width,
    height,
    format: source.format,
    mipmaps: false,
    data: new Uint8Array(width * height * bytesPerPixel(source.format)),
  };
  for (let index = 0; index < width * height; index += 1) {
    writePixel(result, index, lerpColor(readPixel(lowerResult, index), readPixel(upperResult, index), blend));
  }
  return result;
}

function resizeState(state: MutableImageState, width: number, height: number, interpolation: number): void {
  const w = integer(width, 'resize width');
  const h = integer(height, 'resize height');
  if (w <= 0 || h <= 0) throw new Error('Image.resize dimensions must be positive');
  if (!Number.isSafeInteger(interpolation) || interpolation < 0 || interpolation > 4) {
    throw new RangeError('Image.resize interpolation must be NEAREST..LANCZOS (0..4)');
  }
  const old: MutableImageState = {
    ...state,
    mipmaps: false,
    data: state.data.slice(0, state.width * state.height * bytesPerPixel(state.format)),
  };
  const hadMipmaps = state.mipmaps;
  const resized = interpolation === 0
    ? resizeLevel(old, w, h, sampleNearest)
    : interpolation === 1
      ? resizeLevel(old, w, h, sampleBilinear)
      : interpolation === 2
        ? resizeLevel(old, w, h, sampleBicubic)
        : interpolation === 3
          ? resizeTrilinear(old, w, h)
          : resizeLevel(old, w, h, sampleLanczos);
  state.width = resized.width;
  state.height = resized.height;
  state.mipmaps = false;
  state.data = resized.data;
  if (hadMipmaps) generateMipmapChain(state);
}

const lerpColor = (a: ColorValue, b: ColorValue, t: number): ColorValue => godotColor(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
function halfToFloat(value: number): number { const sign = value & 0x8000 ? -1 : 1, exponent = (value >>> 10) & 31, fraction = value & 1023; if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024); if (exponent === 31) return fraction === 0 ? sign * Infinity : NaN; return sign * 2 ** (exponent - 15) * (1 + fraction / 1024); }
function floatToHalf(value: number): number { if (Number.isNaN(value)) return 0x7e00; const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0; const absolute = Math.abs(value); if (absolute === Infinity) return sign | 0x7c00; if (absolute === 0) return sign; let exponent = Math.floor(Math.log2(absolute)), fraction: number; if (exponent < -14) return sign | Math.min(0x3ff, Math.round(absolute / 2 ** -24)); if (exponent > 15) return sign | 0x7c00; fraction = Math.round((absolute / 2 ** exponent - 1) * 1024); if (fraction === 1024) { exponent += 1; fraction = 0; } return sign | ((exponent + 15) << 10) | fraction; }
const srgbToLinear = (value: number): number => value < 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (value: number): number => value < 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
function transformRgb(state: MutableImageState, transform: (value: number) => number): void { for (let i = 0; i < state.width * state.height; i += 1) { const c = readPixel(state, i); writePixel(state, i, godotColor(transform(c.r), transform(c.g), transform(c.b), c.a)); } }

function rotate90(state: MutableImageState, direction: number): void {
  if (direction !== 0 && direction !== 1) throw new Error('Image.rotate_90 direction must be CLOCKWISE=0 or COUNTERCLOCKWISE=1');
  const old: MutableImageState = { ...state, mipmaps: false, data: state.data.slice(0, state.width * state.height * bytesPerPixel(state.format)) };
  const hadMipmaps = state.mipmaps;
  state.width = old.height; state.height = old.width; state.mipmaps = false;
  state.data = new Uint8Array(state.width * state.height * bytesPerPixel(state.format));
  for (let y = 0; y < old.height; y += 1) for (let x = 0; x < old.width; x += 1) {
    const dx = direction === 0 ? old.height - y - 1 : y, dy = direction === 0 ? x : old.width - x - 1;
    writePixel(state, dy * state.width + dx, readPixel(old, y * old.width + x));
  }
  if (hadMipmaps) generateMipmapChain(state);
}

function copyRect(target: GodotImage, source: GodotImage, mask: GodotImage | undefined, rect: ImageRect, destination: Vector2, blend: boolean): void {
  if (target.format !== source.format) throw new Error('Image rectangle copy requires source and target to have the same format');
  if (mask !== undefined && (mask.width !== source.width || mask.height !== source.height)) {
    throw new Error('Image masked rectangle copy requires mask dimensions equal to source dimensions');
  }
  const readSource = source === target ? createGodotImage(source.width, source.height, source.has_mipmaps(), source.format, source.get_data()) : source;
  const readMask = mask === target ? createGodotImage(mask.width, mask.height, mask.has_mipmaps(), mask.format, mask.get_data()) : mask;
  const sx = integer(rect.position.x, 'source x'), sy = integer(rect.position.y, 'source y');
  const width = integer(rect.size.x, 'source width'), height = integer(rect.size.y, 'source height');
  const dx = integer(destination.x, 'destination x'), dy = integer(destination.y, 'destination y');
  if (width <= 0 || height <= 0) return;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const fx = sx + x, fy = sy + y, tx = dx + x, ty = dy + y;
    if (fx < 0 || fy < 0 || fx >= readSource.width || fy >= readSource.height || tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
    if (readMask !== undefined && readMask.get_pixel(fx, fy).a === 0) continue;
    const src = readSource.get_pixel(fx, fy);
    if (!blend) target.set_pixel(tx, ty, src);
    else {
      const dst = target.get_pixel(tx, ty), alpha = src.a + dst.a * (1 - src.a);
      target.set_pixel(tx, ty, alpha === 0 ? godotColor() : godotColor(
        (src.r * src.a + dst.r * dst.a * (1 - src.a)) / alpha,
        (src.g * src.a + dst.g * dst.a * (1 - src.a)) / alpha,
        (src.b * src.a + dst.b * dst.a * (1 - src.a)) / alpha,
        alpha,
      ));
    }
  }
}

export const createGodotImageFromData = (width: number, height: number, mipmaps: boolean, format: number, data: Iterable<number>): GodotImage => {
  positiveImageDimensions(width, height, 'create_from_data');
  return createGodotImage(width, height, mipmaps, format, Uint8Array.from(data));
};
export const createGodotImageEmpty = (width: number, height: number, mipmaps: boolean, format: number): GodotImage => {
  positiveImageDimensions(width, height, 'create_empty');
  return createGodotImage(width, height, mipmaps, format);
};
export function createGodotImageFromFile(path: string): GodotImage | null {
  const image = createGodotImage();
  return image.load(path) === 0 ? image : null;
}
