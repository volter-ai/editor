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
