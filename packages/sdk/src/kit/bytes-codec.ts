/**
 * The editor's byte codecs: content hashing, and the base64 wire encoding the
 * dev server's save routes speak.
 *
 * Both functions existed as three private copies each, and both sets had
 * already drifted — one `sha256Hex` copy hashed the wrong bytes for a
 * subarray, one `bytesToBase64` copy blew the call stack on a large file. Each
 * function below carries the constraint its copies disagreed about; that
 * constraint is the reason this module exists, so keep the comment with the
 * code.
 */

/**
 * sha256 of `bytes`, lowercase hex — Web Crypto, available in every browser
 * this editor supports and in Node ≥ 20's `globalThis.crypto`.
 *
 * `crypto.subtle.digest` hashes a whole `ArrayBuffer`, never a view's range: a
 * `Uint8Array` with a non-zero `byteOffset` (or one shorter than its buffer)
 * whose `.buffer` is handed over directly hashes its NEIGHBOURS too, and the
 * digest then matches nothing. Only a view spanning its entire buffer may pass
 * the buffer through; everything else copies its own range out first.
 *
 * The argument is narrowed to a real `ArrayBuffer` rather than the DOM lib's
 * `BufferSource`, so the types here need no browser lib either — the
 * "runs anywhere" promise is about runtime, and a DOM-only type name would
 * quietly break it for a Node-side consumer.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.slice().buffer as ArrayBuffer);
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * base64-encode `bytes` for the save routes' `encoding: 'base64'` mode, which
 * is what the server's `Buffer.from(…, 'base64')` speaks on the other end.
 *
 * The walk is CHUNKED on purpose. `String.fromCharCode(...bytes)` on a 2.3 MB
 * level file is a 2.3-million-argument spread and throws
 * `RangeError: Maximum call stack size exceeded`; a per-byte `+=` loop avoids
 * the spread but is quadratic on the same input. 0x8000 is the block size that
 * stays inside every engine's argument limit.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** The inverse of {@link bytesToBase64}, via the platform's own `atob`. */
export function base64ToBytes(source: string): Uint8Array {
  const binary = atob(source);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
