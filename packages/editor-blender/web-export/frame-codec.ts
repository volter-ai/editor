/**
 * A FRAME AS ONE FILE: plain data and typed arrays, written by the editor
 * (`blender-export.command.ts`) and read back by an exported page (`web-player.ts`).
 *
 * JSON alone cannot carry a frame: its meshes, skins and images are typed arrays, which JSON
 * turns into objects of numbered keys (a 40 MB mesh becomes hundreds of MB of text and loses
 * its type). So the file is the frame's JSON with every typed array taken out into one binary
 * section after it, each replaced by `{ "$typed": "<Float32Array|…>", "o": <offset>, "n": <length> }`
 * (offsets 8-byte aligned, so a reader may view them in place). Numbers JSON cannot spell
 * (NaN, ±Infinity) are `{ "$number": "<spelling>" }`.
 *
 *     "VFRAME1\n"  u32 json byte length  u32 0  json (UTF-8)  pad to 8  binary section
 *
 * Little-endian throughout. No dependency: the editor and the page share this one module.
 */

const MAGIC = 'VFRAME1\n';
const HEADER_BYTES = 16;

const TYPED = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array,
} as const;
type TypedName = keyof typeof TYPED;
type Typed = InstanceType<(typeof TYPED)[TypedName]>;

const align = (value: number): number => (value + 7) & ~7;

function typedName(value: ArrayBufferView): TypedName | null {
  for (const name of Object.keys(TYPED) as TypedName[]) if (value instanceof TYPED[name]) return name;
  return null;
}

/** `value` as one file. Throws, naming the path, for anything that is not plain data. */
export function encodeFrameFile(value: unknown): Uint8Array {
  const chunks: { offset: number; bytes: Uint8Array }[] = [];
  let size = 0;
  const walk = (node: unknown, path: string): unknown => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return node;
    if (node === undefined) return undefined;
    if (typeof node === 'number') return Number.isFinite(node) ? node : { $number: String(node) };
    if (ArrayBuffer.isView(node)) {
      if (node instanceof DataView) throw new Error(`The frame file cannot carry a DataView (at ${path}).`);
      const name = typedName(node);
      if (!name) throw new Error(`The frame file cannot carry ${node.constructor.name} (at ${path}).`);
      const offset = size;
      chunks.push({ offset, bytes: new Uint8Array(node.buffer, node.byteOffset, node.byteLength) });
      size = align(size + node.byteLength);
      return { $typed: name, o: offset, n: (node as Typed).length };
    }
    if (node instanceof ArrayBuffer) {
      const offset = size;
      chunks.push({ offset, bytes: new Uint8Array(node) });
      size = align(size + node.byteLength);
      return { $buffer: true, o: offset, n: node.byteLength };
    }
    if (Array.isArray(node)) return node.map((item, index) => {
      const out = walk(item, `${path}[${index}]`);
      return out === undefined ? null : out;
    });
    if (typeof node === 'object') {
      const prototype = Object.getPrototypeOf(node);
      if (prototype !== Object.prototype && prototype !== null)
        throw new Error(`The frame file carries plain objects only; ${path} is a ${(node as object).constructor?.name ?? 'object'}.`);
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node)) {
        const encoded = walk(item, `${path}.${key}`);
        if (encoded !== undefined) out[key] = encoded;
      }
      return out;
    }
    throw new Error(`The frame file cannot carry a ${typeof node} (at ${path}).`);
  };
  const json = new TextEncoder().encode(JSON.stringify(walk(value, 'frame')));
  const binaryStart = align(HEADER_BYTES + json.byteLength);
  const file = new Uint8Array(binaryStart + size);
  for (let i = 0; i < MAGIC.length; i++) file[i] = MAGIC.charCodeAt(i);
  const header = new DataView(file.buffer);
  header.setUint32(8, json.byteLength, true);
  header.setUint32(12, 0, true);
  file.set(json, HEADER_BYTES);
  for (const chunk of chunks) file.set(chunk.bytes, binaryStart + chunk.offset);
  return file;
}

/** A file `encodeFrameFile` wrote, back as the value. Every typed array is its own copy. */
export function decodeFrameFile(input: ArrayBuffer | Uint8Array): unknown {
  const file = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (file.byteLength < HEADER_BYTES || String.fromCharCode(...file.subarray(0, MAGIC.length)) !== MAGIC)
    throw new Error('Not a frame file (no VFRAME1 header): export the game again with `cyclotron export web`.');
  const header = new DataView(file.buffer, file.byteOffset, HEADER_BYTES);
  const jsonBytes = header.getUint32(8, true);
  const binaryStart = align(HEADER_BYTES + jsonBytes);
  if (binaryStart > file.byteLength) throw new Error('The frame file is cut short.');
  const text = new TextDecoder().decode(file.subarray(HEADER_BYTES, HEADER_BYTES + jsonBytes));
  const slice = (offset: number, bytes: number): ArrayBuffer => {
    const start = file.byteOffset + binaryStart + offset;
    if (offset < 0 || binaryStart + offset + bytes > file.byteLength) throw new Error('The frame file is cut short.');
    return file.buffer.slice(start, start + bytes) as ArrayBuffer;
  };
  return JSON.parse(text, (_key, node: unknown) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return node;
    const record = node as Record<string, unknown>;
    if (typeof record['$number'] === 'string') return Number(record['$number']);
    if (record['$buffer'] === true) return slice(record['o'] as number, record['n'] as number);
    const name = record['$typed'];
    if (typeof name === 'string') {
      const Type = TYPED[name as TypedName];
      if (!Type) throw new Error(`The frame file names an unknown array type ${name}.`);
      const length = record['n'] as number;
      return new Type(slice(record['o'] as number, length * Type.BYTES_PER_ELEMENT));
    }
    return node;
  });
}
