/**
 * The session's frame, read out of the EXPORT DOOR'S ARENA as typed arrays.
 *
 * The C++ door (`bpy_web_export.cc`) answers one call with a small JSON frame
 * and a side arena of bytes; every large column lives in the arena and the
 * frame names it as `{offset, length, dtype, count, stride}`. Nothing large is
 * ever spelled in the JSON, because the JSON is parsed and the arena is not.
 * This is the other half: each descriptor becomes the typed array the
 * presenter reads, and the buffers are what `presentToTab` transfers.
 *
 * THIS FILE DOES NOT KNOW WHICH BLENDER IT IS SERVING, and that is the seam
 * working. It is handed THE ARENA'S BYTES -- offset zero at the arena's base --
 * by `BlenderEngine.readArena`, which is a view on `HEAPU8` where the host can
 * reach the module's memory and the contents of `export_frame`'s `buffer_path`
 * file where it cannot. Both are valid until the next `export_frame`; nothing
 * else about the two skews reaches this far up.
 *
 * THE COPY IS MANDATORY. On the standalone skew the arena is wasm linear
 * memory, and under `-sPROXY_TO_PTHREAD` that memory is SHARED: a view onto it
 * cannot be transferred to the tab, and the next `export_frame` overwrites it.
 * `.slice()` is what makes the bytes this thread's own -- and it also puts
 * them at offset zero of a fresh buffer, which is what lets a `Float32Array`
 * be built over bytes the arena only aligned to eight.
 */

export interface ColumnDescriptor {
  /** Byte offset into the arena. */
  offset: number;
  /** Byte length. */
  length: number;
  dtype: string;
  /** Elements; `count * stride` values. */
  count: number;
  /** Values per element (3 for a position, 2 for an edge, 1 for a flag). */
  stride: number;
}

const isDescriptor = (value: unknown): value is ColumnDescriptor =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ColumnDescriptor).offset === 'number' &&
  typeof (value as ColumnDescriptor).length === 'number' &&
  typeof (value as ColumnDescriptor).dtype === 'string' &&
  typeof (value as ColumnDescriptor).count === 'number' &&
  typeof (value as ColumnDescriptor).stride === 'number';

type Typed =
  | Float32Array
  | Float64Array
  | Uint32Array
  | Int32Array
  | Uint8Array
  | Int8Array
  | Int16Array
  | Uint16Array;

/** The door's own dtype vocabulary -- the C type each column was written from,
 *  not numpy's codes: the Python exporter that spoke numpy is gone. */
const READERS: Record<string, (bytes: Uint8Array) => Typed> = {
  f32: (b) => new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2),
  f64: (b) => new Float64Array(b.buffer, b.byteOffset, b.byteLength >> 3),
  u32: (b) => new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2),
  i32: (b) => new Int32Array(b.buffer, b.byteOffset, b.byteLength >> 2),
  u16: (b) => new Uint16Array(b.buffer, b.byteOffset, b.byteLength >> 1),
  i16: (b) => new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1),
  u8: (b) => b,
  i8: (b) => new Int8Array(b.buffer, b.byteOffset, b.byteLength),
};

function readColumn(arena: Uint8Array, name: string, descriptor: ColumnDescriptor): Typed {
  const read = READERS[descriptor.dtype];
  if (!read) throw new Error(`Blender frame column ${name}: unknown dtype ${descriptor.dtype}`);
  const { offset, length } = descriptor;
  // ONE PAST THE ARENA IS AN ERROR NAMING THE COLUMN. A descriptor is an offset
  // into the arena; a wrong one reads whatever else lives there, silently.
  if (offset < 0 || length < 0 || offset + length > arena.byteLength)
    throw new Error(
      `Blender frame column ${name}: bytes ${offset}..${offset + length} lie outside the ${arena.byteLength}-byte export arena`,
    );
  const bytes = arena.subarray(offset, offset + length).slice();
  const view = read(bytes);
  const expected = descriptor.count * descriptor.stride;
  if (view.length !== expected)
    throw new Error(
      `Blender frame column ${name}: ${view.length} values, ${expected} declared (${descriptor.count} x ${descriptor.stride})`,
    );
  return view;
}

/**
 * Every `{offset, length, dtype, count, stride}` in the frame, replaced by its
 * typed array.
 *
 * `co` is widened to `Float64Array` because that is what `MeshColumns`
 * declares and `drawArraysFromColumns` is typed against, while Blender's own
 * vertex array is single precision.
 */
export function columnsToTypedArrays(arena: Uint8Array, frame: unknown): unknown {
  const walk = (value: unknown, key: string): unknown => {
    if (isDescriptor(value)) {
      const view = readColumn(arena, key, value);
      return key === 'co' ? Float64Array.from(view) : view;
    }
    if (Array.isArray(value)) return value.map((entry) => walk(entry, key));
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [name, held] of Object.entries(value)) out[name] = walk(held, name);
      return out;
    }
    return value;
  };
  return walk(frame, '');
}

/** A column as the RECORD of it: what it was, how many bytes, and their digest.
 *  Never the bytes — see `describeFrame`. */
export interface ColumnDigest {
  dtype: string;
  length: number;
  /** Lowercase hex SHA-256 of exactly the `length` bytes the descriptor names. */
  sha256: string;
}

/**
 * THE FRAME THIS PRESENT SUBMITTED, as a record that can sit in a JSON file.
 *
 * The presenter is asked, later, whether what it DISPLAYS is what the session
 * SENT (`replay_draw_compare.compare_draws`), and that comparison had no second
 * side: the live document keeps the frame's identity and object table but drops
 * every geometry payload the moment it has built the `BufferGeometry` (850 MB of
 * main-thread heap otherwise — `blender-runtime-view.ts`), and nothing else
 * remembered the frame at all.
 *
 * So the worker records it here, while the arena is still the frame's own: every
 * `{offset, length, dtype, count, stride}` becomes `{dtype, length, sha256}` and
 * everything else — objects, materials, cameras, the world, the counts — is
 * copied as it stands. THE COLUMN BYTES NEVER LEAVE THE TAB; a record of the
 * numbers is not the numbers, and a battery run must not write a scene's meshes
 * to disk a second time.
 *
 * This runs BEFORE `presentToTab` posts, for two reasons that are both fatal
 * otherwise: the buffers are TRANSFERRED (detached the instant they are posted),
 * and the arena is overwritten by the next `export_frame`.
 */
export async function describeFrame(arena: Uint8Array, frame: unknown): Promise<unknown> {
  const walk = async (value: unknown, key: string): Promise<unknown> => {
    if (isDescriptor(value)) {
      const { offset, length, dtype } = value;
      if (offset < 0 || length < 0 || offset + length > arena.byteLength)
        throw new Error(
          `Blender frame column ${key}: bytes ${offset}..${offset + length} lie outside the ${arena.byteLength}-byte export arena`,
        );
      const bytes = arena.subarray(offset, offset + length).slice();
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      return { dtype, length, sha256 } satisfies ColumnDigest;
    }
    if (Array.isArray(value)) return Promise.all(value.map((entry) => walk(entry, key)));
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [name, held] of Object.entries(value)) out[name] = await walk(held, name);
      return out;
    }
    return value;
  };
  return walk(frame, '');
}
