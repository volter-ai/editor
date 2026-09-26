/**
 * Image: images built from the same bytes in official Godot (`Image.create_from_data`) and as
 * compat's image record, then read, and processed as the texture importer processes them
 * (`generate_mipmaps`, `premultiply_alpha`, `fix_alpha_edges`); the bytes are compared through
 * `get_data()` as hex.
 */
import * as IMG from '../../capabilities/catalog/project-source/src/lib/godot-compat/image';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('Image');

/** A deterministic pixel pattern with a range of alphas (some under the edge-fix threshold). */
function pattern(width: number, height: number, channels: number, seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < width * height * channels; i += 1) {
    const pixel = Math.floor(i / channels);
    const channel = i % channels;
    const alpha = channels === 4 || channels === 2 ? channel === channels - 1 : false;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    out.push(alpha ? ((x * 37 + y * 53 + seed) % 5 === 0 ? (x + y) % 20 : ((x * 91 + y * 17 + seed * 7) % 256)) : (i * 73 + seed * 29 + x * y) % 256);
  }
  return out;
}

const FORMATS = [
  [0, 1],
  [1, 2],
  [4, 3],
  [5, 4],
] as const;
const SIZES = [
  [8, 8],
  [7, 5],
  [1, 6],
  [16, 1],
  [13, 9],
] as const;

const native = (w: number, h: number, format: number, data: readonly number[]): string =>
  `var img := Image.create_from_data(${String(w)}, ${String(h)}, false, ${String(format)}, PackedByteArray([${data.join(', ')}]))`;
const target = (w: number, h: number, format: number, data: readonly number[]): IMG.Image => ({ width: w, height: h, format, levels: [Uint8Array.from(data)] });
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

for (const [format, channels] of FORMATS) {
  for (const [w, h] of SIZES) {
    const data = pattern(w, h, channels, w * 3 + h + format);
    const tag = `${String(format)}-${String(w)}x${String(h)}`;
    for (const member of ['get_width', 'get_height', 'get_format', 'has_mipmaps', 'get_mipmap_count'] as const) {
      c.add(`${member}-${tag}`, member, [native(w, h, format, data), `return img.${member}()`], () => IMG[member](target(w, h, format, data)));
    }
    c.add(`has_mipmaps-generated-${tag}`, 'has_mipmaps', [native(w, h, format, data), 'img.generate_mipmaps()', 'return img.has_mipmaps()'], () => {
      const img = target(w, h, format, data);
      IMG.godot_image_generate_mipmaps(img);
      return IMG.has_mipmaps(img);
    });
    c.add(`get_pixel-${tag}`, 'get_pixel', [native(w, h, format, data), `return [img.get_pixel(0, 0), img.get_pixel(${String(w - 1)}, ${String(h - 1)}), img.get_pixel(${String(w >> 1)}, ${String(h >> 1)})]`], () => {
      const img = target(w, h, format, data);
      return [IMG.get_pixel(img, 0, 0), IMG.get_pixel(img, w - 1, h - 1), IMG.get_pixel(img, w >> 1, h >> 1)];
    });
    c.add(`mipmaps-${tag}`, 'get_mipmap_count', [native(w, h, format, data), 'img.generate_mipmaps()', 'return [img.has_mipmaps(), img.get_mipmap_count(), img.get_data().hex_encode()]'], () => {
      const img = target(w, h, format, data);
      IMG.godot_image_generate_mipmaps(img);
      return [IMG.has_mipmaps(img), IMG.get_mipmap_count(img), hex(IMG.get_data(img))];
    });
    c.add(`get_data-processed-${tag}`, 'get_data', [native(w, h, format, data), 'img.fix_alpha_edges()', 'img.premultiply_alpha()', 'return img.get_data().hex_encode()'], () => {
      const img = target(w, h, format, data);
      IMG.godot_image_fix_alpha_edges(img);
      IMG.godot_image_premultiply_alpha(img);
      return hex(IMG.get_data(img));
    });
  }
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Image', compatModule: 'lib/godot-compat/image', cases: c.cases };
export default EVIDENCE;
