/** Bounded, acknowledged frame transport. One value (one mesh/image or the
 * metadata frame) is assembled at a time; SHA-256 covers every chunk, including
 * the metadata. Nothing is applied before all of that value has been verified. */
export const FRAME_CHUNK_BYTES = 1024 * 1024;
export type FrameChunk =
  | { kind: 'begin'; lengths: number[] }
  | { kind: 'bytes'; slot: number; offset: number; bytes: Uint8Array; sha256: string }
  | { kind: 'end' };
const arrays = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
const digest = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, '0')).join('');

/**
 * FREE A FRAME'S BYTES NOW, NOT AT THE NEXT GARBAGE COLLECTION. Every column crosses this path as
 * several whole copies (the worker's copy off the engine arena, the copy hashed for the record,
 * each one-MiB chunk, the column reassembled in the tab), and each is dead the moment the next
 * one exists. Left to the collector they are external memory it reclaims when it gets to it; a
 * scene's columns are gigabytes (1.45 GB on the Stoneguard bridge), so the copies are released
 * here instead. `ArrayBuffer.prototype.transfer(0)` detaches a buffer and frees its backing
 * store at once.
 * Only plain buffers this realm owns are released: a SharedArrayBuffer (the engine's own memory)
 * is never touched, and `keep` names the buffers a caller is still using.
 */
export function releaseFrameBuffers(value: unknown, keep: ReadonlySet<ArrayBufferLike> = new Set()): void {
  const seen = new Set<unknown>();
  const walk = (item: unknown): void => {
    if (item === null || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    if (ArrayBuffer.isView(item)) {
      const buffer = item.buffer as ArrayBuffer & { transfer?: (length: number) => ArrayBuffer; detached?: boolean };
      if (!(buffer instanceof ArrayBuffer) || keep.has(buffer) || buffer.detached || typeof buffer.transfer !== 'function') return;
      buffer.transfer(0);
      return;
    }
    for (const held of Array.isArray(item) ? item : Object.values(item)) walk(held);
  };
  walk(value);
}

export async function sendFrameValue(value: unknown, send: (chunk: FrameChunk) => Promise<unknown>): Promise<unknown> {
  const buffers: Uint8Array[] = [];
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (!ArrayBuffer.isView(item)) return item;
    const type = item.constructor.name;
    if (!Object.hasOwn(arrays, type)) throw new Error(`Unsupported frame column ${type}`);
    buffers.push(new Uint8Array(item.buffer, item.byteOffset, item.byteLength));
    return { $frameColumn: buffers.length, type };
  });
  buffers.unshift(new TextEncoder().encode(json));
  await send({ kind: 'begin', lengths: buffers.map(b => b.byteLength) });
  for (const [slot, buffer] of buffers.entries()) {
    for (let offset = 0; offset < buffer.byteLength; offset += FRAME_CHUNK_BYTES) {
      const bytes = buffer.slice(offset, offset + FRAME_CHUNK_BYTES);
      const sha256 = await digest(bytes);
      await send({ kind: 'bytes', slot, offset, bytes, sha256 });
    }
  }
  return send({ kind: 'end' });
}

export class FrameStreamReader {
  private buffers: Uint8Array[] | null = null;
  private offsets: number[] = [];
  reset(): void { this.buffers = null; this.offsets = []; }
  async accept(chunk: FrameChunk): Promise<{ value: unknown } | undefined> {
    try {
      if (chunk.kind === 'begin') {
        if (this.buffers) throw new Error('A frame value is already arriving');
        if (!chunk.lengths.length || chunk.lengths.length > 4096 || chunk.lengths.reduce((sum, n) => sum + n, 0) > 2 * 1024 ** 3 || chunk.lengths.some(n => !Number.isSafeInteger(n) || n < 0 || n > 1024 ** 3))
          throw new Error('Invalid frame buffer lengths');
        this.buffers = chunk.lengths.map(n => new Uint8Array(n));
        this.offsets = chunk.lengths.map(() => 0);
        return;
      }
      if (!this.buffers) throw new Error('Frame chunk arrived without its manifest');
      if (chunk.kind === 'bytes') {
        const buffer = this.buffers[chunk.slot];
        if (!buffer || !Number.isSafeInteger(chunk.offset) || chunk.offset !== this.offsets[chunk.slot] || chunk.bytes.byteLength > FRAME_CHUNK_BYTES || !chunk.bytes.byteLength || chunk.offset + chunk.bytes.byteLength > buffer.byteLength)
          throw new Error('Frame chunk is out of order or exceeds its bound');
        if (await digest(chunk.bytes) !== chunk.sha256) throw new Error('Frame chunk digest mismatch');
        buffer.set(chunk.bytes, chunk.offset); this.offsets[chunk.slot] = chunk.offset + chunk.bytes.byteLength;
        releaseFrameBuffers(chunk.bytes);
        return;
      }
      if (chunk.kind !== 'end') throw new Error('Unknown frame chunk');
      const buffers = this.buffers;
      if (buffers.some((b, i) => b.length !== this.offsets[i])) throw new Error('Frame value is incomplete');
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffers[0]), (_key, item) => {
        if (!item || typeof item !== 'object' || !('$frameColumn' in item)) return item;
        const bytes = buffers[item.$frameColumn];
        const Type = arrays[item.type as keyof typeof arrays];
        if (!Number.isSafeInteger(item.$frameColumn) || item.$frameColumn < 1 || !bytes || !Object.hasOwn(arrays, item.type) || !Type || bytes.byteLength % Type.BYTES_PER_ELEMENT)
          throw new Error('Invalid frame column descriptor');
        return new Type(bytes.buffer as ArrayBuffer);
      });
      this.reset(); return { value };
    } catch (error) { this.reset(); throw error; }
  }
}
