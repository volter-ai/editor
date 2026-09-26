/**
 * First-party GPU-memory estimator (W4b, F11 profiler memory tab).
 *
 * Walks a live three.js scene and reports geometry/texture byte footprints
 * from data this engine ALREADY holds — attribute buffers and texture images —
 * plus the renderer's own resource counts (`renderer.info`). Uses three.js
 * directly, no wrapper.
 *
 * HONESTY (adapters never fabricate; unmeasurable = absent-with-reason):
 *  - `estimateGeometryBytes` is EXACT: the summed `byteLength` of every
 *    attribute and index array. Not an estimate at all — it is what the
 *    buffers occupy in CPU memory (and, uploaded 1:1, on the GPU).
 *  - `estimateTextureBytes` returns `null` when the footprint is genuinely
 *    unknowable at this seam (no image dimensions, or a pixel format/type we
 *    can't size). A null NEVER enters the totals — it goes to `unestimated[]`
 *    with a reason, so the panel can say "N textures unmeasured" instead of
 *    silently undercounting.
 *  - JS heap is deliberately NOT here: `performance.memory` is a browser-only
 *    global read editor-side (M2), not an engine-scene property.
 */

import type {
  RenderMemoryEntry,
  RenderMemorySnapshot,
  RenderMemoryUnestimated,
} from '@volter/editor-project/adapter/render-memory';
import * as THREE from 'three';

export type {
  RenderMemoryEntry,
  RenderMemorySnapshot,
  RenderMemoryUnestimated,
} from '@volter/editor-project/adapter/render-memory';

const TOP_N = 10;

/** Channel count per pixel format. Packed/compressed formats are handled by
 *  the byte-size logic in {@link estimateTextureBytes}, not here. */
const FORMAT_CHANNELS: Record<number, number> = {
  [THREE.AlphaFormat]: 1,
  [THREE.RedFormat]: 1,
  [THREE.RedIntegerFormat]: 1,
  [THREE.RGFormat]: 2,
  [THREE.RGIntegerFormat]: 2,
  [THREE.RGBAFormat]: 4,
  [THREE.RGBAIntegerFormat]: 4,
  [THREE.DepthFormat]: 1,
  [THREE.DepthStencilFormat]: 2,
};

/** Bytes per channel for a (non-packed) pixel type. */
const TYPE_BYTES: Record<number, number> = {
  [THREE.UnsignedByteType]: 1,
  [THREE.ByteType]: 1,
  [THREE.ShortType]: 2,
  [THREE.UnsignedShortType]: 2,
  [THREE.IntType]: 4,
  [THREE.UnsignedIntType]: 4,
  [THREE.FloatType]: 4,
  [THREE.HalfFloatType]: 2,
};

/** Packed pixel types occupy a FIXED size per texel regardless of channel
 *  count — sized here directly rather than via channels × type-bytes. */
const PACKED_TYPE_TEXEL_BYTES: Record<number, number> = {
  [THREE.UnsignedShort4444Type]: 2,
  [THREE.UnsignedShort5551Type]: 2,
  [THREE.UnsignedInt248Type]: 4,
};

function bytesPerTexel(format: number, type: number): number | null {
  const packed = PACKED_TYPE_TEXEL_BYTES[type];
  if (packed !== undefined) return packed;
  const channels = FORMAT_CHANNELS[format];
  const typeBytes = TYPE_BYTES[type];
  if (channels === undefined || typeBytes === undefined) return null;
  return channels * typeBytes;
}

/** EXACT CPU/GPU footprint of a geometry's attribute + index buffers. */
export function estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
  // Interleaved attributes share ONE backing buffer (`attribute.data.array`);
  // a plain attribute owns its own (`attribute.array`). Count each unique
  // backing view exactly once.
  const counted = new Set<ArrayBufferView>();
  let bytes = 0;
  const add = (view: ArrayBufferView | undefined): void => {
    if (view && !counted.has(view)) {
      counted.add(view);
      bytes += view.byteLength;
    }
  };
  for (const attribute of Object.values(geometry.attributes)) {
    const interleaved = (attribute as THREE.InterleavedBufferAttribute).data?.array as
      | ArrayBufferView
      | undefined;
    add(interleaved ?? ((attribute as THREE.BufferAttribute).array as ArrayBufferView | undefined));
  }
  add(geometry.index?.array as ArrayBufferView | undefined);
  return bytes;
}

/** Estimated GPU footprint of a texture, or `null` when unknowable at this
 *  seam (the caller routes null into `unestimated[]` with a reason). */
export function estimateTextureBytes(texture: THREE.Texture): number | null {
  // Compressed textures carry their real per-mip byte arrays — sum them; no
  // format math needed and no estimate involved.
  const compressed = texture as THREE.CompressedTexture;
  if (
    (compressed as { isCompressedTexture?: boolean }).isCompressedTexture &&
    Array.isArray(compressed.mipmaps)
  ) {
    let bytes = 0;
    for (const mip of compressed.mipmaps) {
      const data = (mip as { data?: ArrayBufferView }).data;
      if (data?.byteLength) bytes += data.byteLength;
    }
    return bytes;
  }

  const image = texture.image as { width?: number; height?: number } | undefined;
  const width = image?.width;
  const height = image?.height;
  if (!width || !height) return null;

  const bpt = bytesPerTexel(texture.format, texture.type);
  if (bpt === null) return null;

  const base = width * height * bpt;
  return texture.generateMipmaps ? Math.round(base * 1.333) : base;
}

function textureName(texture: THREE.Texture): string {
  return texture.name || (texture.image as { src?: string })?.src || `texture:${texture.uuid}`;
}

function geometryName(geometry: THREE.BufferGeometry): string {
  return geometry.name || `${geometry.type}:${geometry.uuid}`;
}

function unestimatedReason(texture: THREE.Texture): string {
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (!image?.width || !image?.height) return 'no image dimensions available';
  return `unsupported format/type (format 0x${texture.format.toString(16)}, type 0x${texture.type.toString(16)})`;
}

/** Collect every unique geometry and texture referenced by a scene graph. */
function collectResources(scene: THREE.Object3D): {
  geometries: Map<string, THREE.BufferGeometry>;
  textures: Map<string, THREE.Texture>;
} {
  const geometries = new Map<string, THREE.BufferGeometry>();
  const textures = new Map<string, THREE.Texture>();

  const addMaterialTextures = (material: THREE.Material): void => {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value && (value as THREE.Texture).isTexture) {
        const tex = value as THREE.Texture;
        textures.set(tex.uuid, tex);
      }
    }
  };

  scene.traverse((object) => {
    const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geometry?.isBufferGeometry) geometries.set(geometry.uuid, geometry);
    const material = (object as THREE.Mesh).material;
    if (Array.isArray(material)) material.forEach(addMaterialTextures);
    else if (material) addMaterialTextures(material);
  });

  // Scene-level environment/background textures count too.
  for (const maybe of [scene as unknown as THREE.Scene]) {
    for (const value of [maybe.background, maybe.environment]) {
      if (value && (value as THREE.Texture).isTexture) {
        const tex = value as THREE.Texture;
        textures.set(tex.uuid, tex);
      }
    }
  }

  return { geometries, textures };
}

export function collectRenderMemory(
  scene: THREE.Object3D,
  info: THREE.WebGLInfo,
): RenderMemorySnapshot {
  const { geometries, textures } = collectResources(scene);

  const geometryEntries: RenderMemoryEntry[] = [];
  let estimatedGeometryBytes = 0;
  for (const geometry of geometries.values()) {
    const bytes = estimateGeometryBytes(geometry);
    estimatedGeometryBytes += bytes;
    geometryEntries.push({ name: geometryName(geometry), bytes });
  }

  const textureEntries: RenderMemoryEntry[] = [];
  const unestimated: RenderMemoryUnestimated[] = [];
  let estimatedTextureBytes = 0;
  for (const texture of textures.values()) {
    const bytes = estimateTextureBytes(texture);
    if (bytes === null) {
      unestimated.push({ name: textureName(texture), reason: unestimatedReason(texture) });
      continue;
    }
    estimatedTextureBytes += bytes;
    textureEntries.push({ name: textureName(texture), bytes });
  }

  const byBytesDesc = (a: RenderMemoryEntry, b: RenderMemoryEntry): number => b.bytes - a.bytes;

  return {
    counts: {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs ? info.programs.length : null,
    },
    estimatedTextureBytes,
    estimatedGeometryBytes,
    topTextures: textureEntries.sort(byBytesDesc).slice(0, TOP_N),
    topGeometries: geometryEntries.sort(byBytesDesc).slice(0, TOP_N),
    unestimated,
  };
}
