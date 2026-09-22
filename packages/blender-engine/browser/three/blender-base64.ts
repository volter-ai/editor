/**
 * Base64 → bytes, as a PLAIN LOOP.
 *
 * `Uint8Array.from(atob(text), (c) => c.charCodeAt(0))` is the obvious form and
 * it is a trap: the mapping callback is invoked ONCE PER CHARACTER, so decoding
 * scales with call overhead rather than with a memory copy. Measured against
 * the loop below, byte-identical output throughout: 1MB 63ms vs 4ms (16.9x),
 * 3MB 224ms vs 8ms (27.7x), 8MB 545ms vs 19ms (28.9x). Textures and EXR frames
 * are routinely multi-megabyte and one of these decodes runs on the page's main
 * thread, so the callback form is never the right one here.
 */
export function bytesFromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Bytes → base64, the way back.
 *
 * `String.fromCharCode(...bytes)` in one call overflows the argument stack on
 * anything megabyte-sized, so the string is built in 32K spreads. Extracted
 * from the Blender worker's `encode_image`, which had exactly this
 * loop; a frame's JSON channel needs the same conversion for a raster that has
 * no transferable buffer to travel in.
 */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** {@link bytesFromBase64} for callers that want an 8-bit RGBA raster's own
 *  element type (`ImageData.data`'s), rather than a plain byte array. */
export function clampedBytesFromBase64(text: string): Uint8ClampedArray<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
