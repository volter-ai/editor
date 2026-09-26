/**
 * @godot-class CompressedTexture2D
 * @role BINDING
 *
 * Godot 4.7's `CompressedTexture2D` (`scene/resources/compressed_texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) for an image the `texture` importer imports
 * losslessly (`compress/mode=0`), bound onto a three `DataTexture`. Godot's editor turns the source
 * image into the `.ctex` the game loads; here the source file is copied beside the app and the
 * importer's processing runs on the page (`ResourceImporterTexture::import`,
 * `editor/import/resource_importer_texture.cpp:700`): the image decoded as `ImageLoader` decodes
 * it, `fix_alpha_edges`, `premultiply_alpha`, then mipmaps when `mipmaps/generate` is on
 * (`_save_ctex`, `:352`). A lossless `.ctex` stores the image in its own format and hands it back
 * unchanged. Other compression modes, channel remaps, normal-map and HDR processing and a size
 * limit are not bound (the translation refuses them).
 *
 * The three texture holds the image in RGBA8 for the GPU (grey spread over red, green and blue,
 * opaque alpha filled), each level a mipmap; how it is sampled belongs to its user (a material's
 * `texture_filter`, a canvas item's). The page draws a canvas item's texture from a canvas of its
 * image.
 */

import { DataTexture, RGBAFormat, type Texture, UnsignedByteType } from 'three';
import { godot_image_decode, godot_image_fix_alpha_edges, godot_image_generate_mipmaps, godot_image_premultiply_alpha, type Image } from './image';
import { godot_resource_loader_track } from './resource-loader';
import { godot_texture_2d_emit_changed, godot_texture_2d_image, godot_texture_2d_size } from './texture-2d';

/** The importer options this binding applies (`ResourceImporterTexture::get_import_options`). */
export interface GodotTextureImport {
  readonly fixAlphaBorder: boolean;
  readonly premultAlpha: boolean;
  readonly mipmaps: boolean;
}

const IMAGES = new WeakMap<Texture, Image>();

/** An image's level as RGBA8. */
function rgba(image: Image, level: number, width: number, height: number): Uint8Array {
  const data = image.levels[level] as Uint8Array;
  const cc = data.length / (width * height);
  if (cc === 4) return data;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const grey = cc <= 2;
    out[i * 4] = data[i * cc] as number;
    out[i * 4 + 1] = data[i * cc + (grey ? 0 : 1)] as number;
    out[i * 4 + 2] = data[i * cc + (grey ? 0 : 2)] as number;
    out[i * 4 + 3] = cc === 2 ? (data[i * cc + 1] as number) : 255;
  }
  return out;
}

/** Puts the imported image into the three texture, with a canvas of its base level for the page. */
function upload(texture: DataTexture, image: Image): void {
  IMAGES.set(texture, image);
  const levels = image.levels.map((_, level) => {
    const width = Math.max(image.width >> level, 1);
    const height = Math.max(image.height >> level, 1);
    return { data: rgba(image, level, width, height), width, height };
  });
  const base = levels[0] as { data: Uint8Array; width: number; height: number };
  const page = (globalThis as { readonly document?: Document }).document;
  texture.image = {
    ...base,
    toDataURL: (): string => {
      if (page === undefined) return '';
      const canvas = page.createElement('canvas');
      canvas.width = base.width;
      canvas.height = base.height;
      const context = canvas.getContext('2d');
      if (context === null) return '';
      context.putImageData(new ImageData(new Uint8ClampedArray(base.data), base.width, base.height), 0, 0);
      return canvas.toDataURL();
    },
  } as unknown as DataTexture['image'];
  texture.mipmaps = levels.length > 1 ? levels : [];
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  godot_texture_2d_emit_changed(texture);
}

/**
 * The imported texture of an image file's bytes: decoded and processed as the importer does, then
 * uploaded.
 *
 * @godot CompressedTexture2D (protocol)
 * @source editor/import/resource_importer_texture.cpp:700
 */
export async function godot_compressed_texture_2d_import(texture: Texture, bytes: Uint8Array, options: GodotTextureImport): Promise<void> {
  const image = await godot_image_decode(bytes);
  if (options.fixAlphaBorder) godot_image_fix_alpha_edges(image);
  if (options.premultAlpha) godot_image_premultiply_alpha(image);
  if (options.mipmaps) godot_image_generate_mipmaps(image);
  upload(texture as DataTexture, image);
}

/**
 * A texture not yet loaded: its size and image are the image's once `import` has run.
 *
 * @godot CompressedTexture2D (protocol)
 * @source scene/resources/compressed_texture.cpp:132
 */
export function godot_compressed_texture_2d_new(): Texture {
  const texture = new DataTexture(null, 0, 0, RGBAFormat, UnsignedByteType);
  godot_texture_2d_size(texture, () => {
    const image = IMAGES.get(texture);
    return image === undefined ? [0, 0] : [image.width, image.height];
  });
  godot_texture_2d_image(texture, () => IMAGES.get(texture) ?? null);
  return texture;
}

/**
 * `load()` of an imported image: the texture now, its image once the copied file at `url` has been
 * fetched and imported; the load is tracked so the scenes mount after it.
 *
 * @godot CompressedTexture2D (protocol)
 * @source scene/resources/compressed_texture.cpp:132
 */
export function godot_compressed_texture_2d_load(url: string, options: GodotTextureImport): Texture {
  const texture = godot_compressed_texture_2d_new();
  godot_resource_loader_track(
    fetch(url)
      .then((response) => response.arrayBuffer())
      .then((buffer) => godot_compressed_texture_2d_import(texture, new Uint8Array(buffer), options)),
  );
  return texture;
}
