/**
 * Minimal pure image-header parsers for the Asset Budget model (W4a).
 *
 * Only formats whose dimensions can be read from a header without a decoder
 * are parsed (PNG IHDR, JPEG SOFn, GIF logical screen, lossy/lossless WebP).
 * Anything else returns `null` — the budget reports "unknown" rather than a
 * fabricated estimate (anti-shim).
 */

export interface ImageDims {
  readonly width: number;
  readonly height: number;
}

function parsePng(bytes: Uint8Array, view: DataView): ImageDims | null {
  // 89 50 4E 47 0D 0A 1A 0A, IHDR width/height at byte 16/20 (BE).
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  if (bytes.length < 24) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function parseJpeg(bytes: Uint8Array, view: DataView): ImageDims | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // SOFn markers C0–CF except C4 (DHT), C8 (JPG), CC (DAC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function parseGif(bytes: Uint8Array, view: DataView): ImageDims | null {
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function parseWebp(bytes: Uint8Array, view: DataView): ImageDims | null {
  const tag = (offset: number, text: string): boolean =>
    text.split('').every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (!tag(0, 'RIFF') || !tag(8, 'WEBP') || bytes.length < 30) return null;
  if (tag(12, 'VP8 ')) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (tag(12, 'VP8L')) {
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

export function parseImageDims(bytes: Uint8Array): ImageDims | null {
  if (bytes.length < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const parse of [parsePng, parseJpeg, parseGif, parseWebp]) {
    const dims = parse(bytes, view);
    if (dims) return dims;
  }
  return null;
}

/**
 * Estimated GPU upload size for an uncompressed RGBA texture of these
 * dimensions with a full mip chain (×4/3) — the same convention
 * gltf-transform's `inspect()` uses for its texture `gpuSize`.
 */
export function estimateImageGpuBytes(dims: ImageDims): number {
  return Math.ceil(dims.width * dims.height * 4 * (4 / 3));
}
