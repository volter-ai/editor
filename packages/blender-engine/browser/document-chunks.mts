/**
 * A saved `.blend` cut into content-defined chunks, the unit a document save travels in
 * (`editor-blender/serving/blender-routes.ts`, `/__editor/blender-document`).
 *
 * WHY CONTENT-DEFINED. A save rewrites the whole file, but an edit changes little of it:
 * MEASURED 2026-09-29, native Blender 5.2 on the Stoneguard bridge, one object moved between two
 * saves changed 1 of 475 one-MiB chunks of a 497 MB file. Fixed offsets would keep that only while
 * no block changes size; an edit that grows a mesh would shift every chunk after it. Cutting where
 * the bytes themselves say (a gear hash, as FastCDC does) re-aligns right after the change, so only
 * the chunks around it are new.
 *
 * The bounds are the transport's: no chunk above {@link CHUNK_MAX}, which the server refuses.
 */

export const CHUNK_MIN = 256 * 1024;
export const CHUNK_MAX = 4 * 1024 * 1024;
/** 20 bits: a cut about every MiB past the minimum. */
const CUT_MASK = (1 << 20) - 1;

/** The gear table: 256 fixed pseudo-random words (xorshift32 from a fixed seed), so every page
 *  cuts the same bytes the same way. */
const GEAR = (() => {
  const table = new Uint32Array(256);
  let state = 0x9e3779b9;
  for (let index = 0; index < 256; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    table[index] = state >>> 0;
  }
  return table;
})();

/** The end offsets of each chunk of `bytes`. */
export function chunkBoundaries(bytes: Uint8Array): number[] {
  const ends: number[] = [];
  let start = 0;
  while (start < bytes.length) {
    const limit = Math.min(bytes.length, start + CHUNK_MAX);
    let end = limit;
    let hash = 0;
    for (let at = start + Math.min(CHUNK_MIN, limit - start); at < limit; at += 1) {
      hash = ((hash << 1) + GEAR[bytes[at]!]!) >>> 0;
      if ((hash & CUT_MASK) === 0) {
        end = at + 1;
        break;
      }
    }
    ends.push(end);
    start = end;
  }
  return ends;
}

export interface DocumentChunk {
  readonly hash: string;
  readonly start: number;
  readonly end: number;
}

/** Each chunk of `bytes` with its SHA-256, in file order. */
export async function documentChunks(bytes: Uint8Array): Promise<DocumentChunk[]> {
  const chunks: DocumentChunk[] = [];
  let start = 0;
  for (const end of chunkBoundaries(bytes)) {
    // `slice`, not `subarray`: WebCrypto refuses a view of shared memory, which an engine read may be.
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice(start, end)));
    chunks.push({ hash: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''), start, end });
    start = end;
  }
  return chunks;
}

/** The same cuts and hashes, retaining one four-MiB chunk and one read block,
 * rather than a whole saved document beside its WasmFS copy. */
export async function documentChunksFromFile(
  size: number,
  read: (offset: number, length: number) => Promise<Uint8Array>,
): Promise<DocumentChunk[]> {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid document size');
  const chunks: DocumentChunk[] = [];
  const chunk = new Uint8Array(CHUNK_MAX);
  let start = 0, length = 0, gear = 0;
  const cut = async (): Promise<void> => {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', chunk.subarray(0, length)));
    chunks.push({ hash: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), start, end: start + length });
    start += length; length = 0; gear = 0;
  };
  for (let offset = 0; offset < size;) {
    const amount = Math.min(1024 * 1024, size - offset);
    const block = await read(offset, amount);
    if (block.byteLength !== amount) throw new Error('Document changed during chunking');
    for (const byte of block) {
      chunk[length++] = byte;
      // chunkBoundaries skips the first CHUNK_MIN bytes, then includes the
      // byte at that offset in the gear hash. Preserve that exact boundary.
      if (length > CHUNK_MIN) gear = ((gear << 1) + GEAR[byte]!) >>> 0;
      if (length === CHUNK_MAX || (length > CHUNK_MIN && (gear & CUT_MASK) === 0)) await cut();
    }
    offset += amount;
  }
  if (length) await cut();
  return chunks;
}
