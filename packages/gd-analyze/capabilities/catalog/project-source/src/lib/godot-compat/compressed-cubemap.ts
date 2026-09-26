/**
 * @godot-class CompressedCubemap
 * @role BINDING
 *
 * Godot 4.7's `CompressedCubemap` (`scene/resources/compressed_texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) for an image the `cubemap_texture` importer imports
 * losslessly without mipmaps, bound onto a three `CubeTexture`. Godot's editor slices the source
 * image into six layers (`ResourceImporterLayeredTexture::import`,
 * `editor/import/resource_importer_layered_texture.cpp:298`: the arrangement's columns and rows,
 * row by row) and the Compatibility renderer uploads layer `i` to the cube face
 * `GL_TEXTURE_CUBE_MAP_POSITIVE_X + i` (`drivers/gles3/storage/texture_storage.cpp:50`), rows as
 * stored; here the copied source is sliced the same way on the page and each layer is the three
 * cube face of the same index, uploaded as stored. Its pixels are sampled as stored: the
 * Compatibility renderer decodes no sRGB texture (its shaders convert colour themselves).
 */

import { use } from 'react';
import { CubeTexture, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import { godot_image_decode, type Image } from './image';

/** The importer options this binding applies. */
export interface GodotCubemapImport {
  /** `slices/arrangement`: 1x6, 2x3, 3x2, 6x1. */
  readonly arrangement: number;
}

const GRID: readonly (readonly [number, number])[] = [
  [1, 6],
  [2, 3],
  [3, 2],
  [6, 1],
];

/** The image's pixels as RGBA8, grey spread and opaque alpha filled. */
function rgba(image: Image): Uint8Array {
  const data = image.levels[0] as Uint8Array;
  const count = image.width * image.height;
  const cc = data.length / count;
  if (cc === 4) return data;
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const grey = cc <= 2;
    out[i * 4] = data[i * cc] as number;
    out[i * 4 + 1] = data[i * cc + (grey ? 0 : 1)] as number;
    out[i * 4 + 2] = data[i * cc + (grey ? 0 : 2)] as number;
    out[i * 4 + 3] = cc === 2 ? (data[i * cc + 1] as number) : 255;
  }
  return out;
}

/**
 * The six layers of an image, sliced as the importer slices it: `slice_w = width / columns`,
 * `slice_h = height / rows`, row by row, left to right.
 *
 * @godot CompressedCubemap (protocol)
 * @source editor/import/resource_importer_layered_texture.cpp:374
 */
export function godot_compressed_cubemap_slices(image: Image, arrangement: number): readonly { readonly data: Uint8Array; readonly width: number; readonly height: number }[] {
  const [columns, rows] = GRID[arrangement] ?? (GRID[1] as readonly [number, number]);
  const width = Math.floor(image.width / columns);
  const height = Math.floor(image.height / rows);
  const pixels = rgba(image);
  const slices: { data: Uint8Array; width: number; height: number }[] = [];
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < columns; j += 1) {
      const data = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        const from = ((i * height + y) * image.width + j * width) * 4;
        data.set(pixels.subarray(from, from + width * 4), y * width * 4);
      }
      slices.push({ data, width, height });
    }
  }
  return slices;
}

/** The cube texture of six layers: face `i` is layer `i`, uploaded as stored. */
function cube(slices: readonly { readonly data: Uint8Array; readonly width: number; readonly height: number }[]): CubeTexture {
  const faces = slices.slice(0, 6).map((slice) => {
    const face = new DataTexture(slice.data, slice.width, slice.height, RGBAFormat, UnsignedByteType);
    face.needsUpdate = true;
    return face;
  });
  const texture = new CubeTexture(faces as never);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = NoColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

const LOADS = new Map<string, { readonly texture: Promise<CubeTexture> }>();

/**
 * A scene's imported cubemap, as a component loads it: the cube texture of the copied file at
 * `url`, sliced once for every scene that uses it, the component suspended until it is.
 *
 * @godot CompressedCubemap (protocol)
 * @source core/io/resource_loader.cpp:725
 */
export function useGodotCubemap(url: string, options: GodotCubemapImport): CubeTexture {
  const key = `${url}\0${String(options.arrangement)}`;
  let load = LOADS.get(key);
  if (load === undefined) {
    load = {
      texture: fetch(url)
        .then((response) => response.arrayBuffer())
        .then(async (buffer) => cube(godot_compressed_cubemap_slices(await godot_image_decode(new Uint8Array(buffer)), options.arrangement))),
    };
    LOADS.set(key, load);
  }
  return use(load.texture);
}
