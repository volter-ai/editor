/**
 * An image file's pixel size from its header, as the importer reads it before decoding: PNG's IHDR,
 * JPEG's start-of-frame, WebP's VP8, VP8L or VP8X chunk. Undefined for any other file or a header
 * it cannot read.
 */
export function godotImageSize(bytes: Uint8Array): readonly [number, number] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  // PNG: the signature, then IHDR's width and height (big-endian).
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') {
    return [view.getUint32(16), view.getUint32(20)];
  }
  // JPEG: markers up to a start-of-frame (SOF0 to SOF15, less DHT, JPG and DAC).
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return undefined;
      const marker = bytes[at + 1] as number;
      const length = view.getUint16(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return [view.getUint16(at + 7), view.getUint16(at + 5)];
      }
      at += 2 + length;
    }
    return undefined;
  }
  // WebP: RIFF, then its first chunk.
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ') return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true);
      return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    }
    if (chunk === 'VP8X') {
      const width = 1 + ((bytes[24] as number) | ((bytes[25] as number) << 8) | ((bytes[26] as number) << 16));
      const height = 1 + ((bytes[27] as number) | ((bytes[28] as number) << 8) | ((bytes[29] as number) << 16));
      return [width, height];
    }
  }
  return undefined;
}
