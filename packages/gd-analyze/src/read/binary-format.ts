/**
 * read/binary-format.ts — Godot 3/4's BINARY resource container (`RSRC`, and its `RSCC`
 * compressed wrapper) decoded onto the SAME `GodotValue` model the text reader produces.
 *
 * A Godot 4 project ships two serializations of one thing. `.tscn`/`.tres` are the text form this
 * package has always read; `.scn`/`.res` are the binary form of the identical resource graph, and
 * a project mixes them freely — `platformer-3d-godot4` authors its 18 tile meshes, their collision
 * shapes and its GridMap scene as 25 `.res` plus one `.scn`, while the Godot 3 twin authors the
 * same meshes as inline text `ArrayMesh` sub-resources. So this is not a second reader with a
 * second output shape: it decodes to `GodotValue`, and `binary-document.ts` assembles the same
 * `ResourceDocument`/`SceneDocument` the text path yields, so everything downstream stays
 * format-blind.
 *
 * ## Ground truth
 *
 * Every structure decoded here cites `godotengine/godot` at tags **`3.6-stable`** and
 * **`4.7-stable`** — the two engine lines this package pins. Citations name the file and line,
 * e.g. `resource_format_binary.cpp:922`. Nothing here is inferred from a hexdump: a
 * guessed byte layout that happens to decode one fixture is exactly the failure this package's
 * anti-fabrication rule exists to prevent, and the C++ is public.
 *
 *   - `core/io/resource_format_binary.cpp` — the container (`ResourceLoaderBinary::open`, :922)
 *     and the typed variant encoding (`ResourceLoaderBinary::parse_variant`, :158).
 *   - `core/io/resource_format_binary.h` — the format flags and `RESERVED_FIELDS` (:168-176).
 *   - `core/io/file_access_compressed.cpp` — the `RSCC` block wrapper
 *     (`FileAccessCompressed::open_after_magic`, :43).
 *   - `core/io/compression.h` — the compression mode enum (:46-52).
 *
 * ## Enumerate and refuse, never skip
 *
 * Godot's own loader ends `parse_variant` with `default: ERR_FAIL_V(ERR_FILE_CORRUPT)`
 * (:609) because a variant type it does not know is a byte length it does not know — there is no
 * "skip this property and carry on". This reader inherits that and makes it louder: every
 * unimplemented type id REFUSES by NAME and id (`VARIANT_CALLABLE (42)`), and the name table
 * covers every id Godot defines, so a refusal says what was found rather than "unknown". A
 * refusal costs the one document (`godot-project.ts` catches it as a per-item diagnostic), never
 * the project.
 */
import * as zlib from 'node:zlib';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import type { GodotEntry, GodotValue } from './godot-value';

export class GodotBinaryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GodotBinaryParseError';
  }
}

/** `RSRC`, at the head of an uncompressed container and again at its tail
 *  (`resource_format_binary.cpp:939` reading, :2338 writing). */
const MAGIC_RSRC = 'RSRC';
/** `RSCC` — the whole container inside a `FileAccessCompressed` stream
 *  (`resource_format_binary.cpp:928`). The `RSRC` magic is NOT repeated inside: the saver skips
 *  it when compressing (:2134-2138), so the decompressed stream starts at `big_endian`. */
const MAGIC_RSCC = 'RSCC';

/**
 * Godot 4's binary format versions. The loader's own version ledger names 4 as the string-id
 * ext/subresource format, 5 as the script-class header addition, and 6 as PackedVector4Array
 * (`resource_format_binary.cpp:90-99`). Version 4 is therefore a valid Godot 4 container, and is
 * still emitted by source-owned resources saved before the version-5 addition. Version 3 is the
 * newest Godot 3 format — the engine major in the header disambiguates the two families before a
 * single variant is read.
 */
const FORMAT_VERSION_GODOT3 = 3;
const FORMAT_VERSION_MIN = 4;
const FORMAT_VERSION_MAX = 6;

/** `resource_format_binary.h:168-176`. */
const FORMAT_FLAG_NAMED_SCENE_IDS = 1;
const FORMAT_FLAG_UIDS = 2;
const FORMAT_FLAG_REAL_T_IS_DOUBLE = 4;
const FORMAT_FLAG_HAS_SCRIPT_CLASS = 8;
const RESERVED_FIELDS = 11;

/** `resource_format_binary.cpp:48-89`. Every id Godot defines, so a refusal can NAME what it
 *  found. The decoded subset is in `readVariant`; the rest refuse. */
const VARIANT_TYPE_NAMES: ReadonlyMap<number, string> = new Map([
  [1, 'VARIANT_NIL'],
  [2, 'VARIANT_BOOL'],
  [3, 'VARIANT_INT'],
  [4, 'VARIANT_FLOAT'],
  [5, 'VARIANT_STRING'],
  [10, 'VARIANT_VECTOR2'],
  [11, 'VARIANT_RECT2'],
  [12, 'VARIANT_VECTOR3'],
  [13, 'VARIANT_PLANE'],
  [14, 'VARIANT_QUATERNION'],
  [15, 'VARIANT_AABB'],
  [16, 'VARIANT_BASIS'],
  [17, 'VARIANT_TRANSFORM3D'],
  [18, 'VARIANT_TRANSFORM2D'],
  [20, 'VARIANT_COLOR'],
  [22, 'VARIANT_NODE_PATH'],
  [23, 'VARIANT_RID'],
  [24, 'VARIANT_OBJECT'],
  [25, 'VARIANT_INPUT_EVENT'],
  [26, 'VARIANT_DICTIONARY'],
  [30, 'VARIANT_ARRAY'],
  [31, 'VARIANT_PACKED_BYTE_ARRAY'],
  [32, 'VARIANT_PACKED_INT32_ARRAY'],
  [33, 'VARIANT_PACKED_FLOAT32_ARRAY'],
  [34, 'VARIANT_PACKED_STRING_ARRAY'],
  [35, 'VARIANT_PACKED_VECTOR3_ARRAY'],
  [36, 'VARIANT_PACKED_COLOR_ARRAY'],
  [37, 'VARIANT_PACKED_VECTOR2_ARRAY'],
  [40, 'VARIANT_INT64'],
  [41, 'VARIANT_DOUBLE'],
  [42, 'VARIANT_CALLABLE'],
  [43, 'VARIANT_SIGNAL'],
  [44, 'VARIANT_STRING_NAME'],
  [45, 'VARIANT_VECTOR2I'],
  [46, 'VARIANT_RECT2I'],
  [47, 'VARIANT_VECTOR3I'],
  [48, 'VARIANT_PACKED_INT64_ARRAY'],
  [49, 'VARIANT_PACKED_FLOAT64_ARRAY'],
  [50, 'VARIANT_VECTOR4'],
  [51, 'VARIANT_VECTOR4I'],
  [52, 'VARIANT_PROJECTION'],
  [53, 'VARIANT_PACKED_VECTOR4_ARRAY'],
]);

/** `resource_format_binary.cpp:90-93`. */
const OBJECT_EMPTY = 0;
const OBJECT_EXTERNAL_RESOURCE = 1;
const OBJECT_INTERNAL_RESOURCE = 2;
const OBJECT_EXTERNAL_RESOURCE_INDEX = 3;

/** `compression.h:46-52`. `MODE_ZSTD` is the default `FileAccessCompressed::configure` takes
 *  (`file_access_compressed.h:69`) and therefore the one every `RSCC` Godot writes uses. */
const COMPRESSION_MODE_NAMES: ReadonlyMap<number, string> = new Map([
  [0, 'MODE_FASTLZ'],
  [1, 'MODE_DEFLATE'],
  [2, 'MODE_ZSTD'],
  [3, 'MODE_GZIP'],
  [4, 'MODE_BROTLI'],
]);

/** One row of the external-resource table (`resource_format_binary.cpp:1010-1035`). */
export interface BinaryExtResource {
  /** Godot's own declared class for the reference (`PackedScene`, `ArrayMesh`, `Script`, …). */
  readonly type: string;
  /** The `res://` path as written. */
  readonly path: string;
  /** The `uid://` id, when the file carries UIDs. `undefined` for `ResourceUID::INVALID_ID`. */
  readonly uid?: string;
}

/** One row of the internal-resource table, with its body decoded
 *  (`resource_format_binary.cpp:1038-1045` for the table, :683-790 for the bodies). */
export interface BinaryInternalResource {
  /**
   * The scene-unique id, i.e. the table path's `local://` suffix — the SAME token a Godot 4 text
   * document spells in `[sub_resource type="…" id="ArrayMesh_ybvw5"]`
   * (`resource_format_binary.cpp:2302` writes `"local://" + get_scene_unique_id()`).
   * A file saved without `FORMAT_FLAG_NAMED_SCENE_IDS` has no such token and the id is the row's
   * INDEX, which is what Godot itself falls back to (:392).
   */
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, GodotValue>>;
}

/** A decoded `RSRC`/`RSCC` container. The MAIN resource is the LAST internal row — Godot's own
 *  rule (`resource_format_binary.cpp:651`, `bool main = i == (internal_resources.size() - 1)`). */
export interface BinaryResourceFile {
  /** The header's declared class for the main resource (`resource_format_binary.cpp:968`). */
  readonly type: string;
  readonly engineMajor: number;
  readonly engineMinor: number;
  readonly formatVersion: number;
  /** The `uid://` id of the file itself, when it carries one. */
  readonly uid?: string;
  /** `FORMAT_FLAG_HAS_SCRIPT_CLASS`'s `class_name` (`resource_format_binary.cpp:989-991`). */
  readonly scriptClass?: string;
  /** The `RSCC` mode name when the file was compressed, absent when it was not. */
  readonly compression?: string;
  readonly extResources: readonly BinaryExtResource[];
  readonly internalResources: readonly BinaryInternalResource[];
}

/** Header/table identity available before any internal Resource property is decoded. This is the
 * authoritative ResourceUID join used by the project index even when a later property carries a
 * Variant the runtime reader deliberately refuses. */
export type BinaryResourceMetadata = Omit<BinaryResourceFile, 'internalResources'>;

interface ParsedBinaryHeader extends BinaryResourceMetadata {
  readonly cursor: ByteCursor;
  readonly strings: readonly string[];
  readonly realIsDouble: boolean;
  readonly internalIds: readonly string[];
  readonly internalOffsets: readonly number[];
}

/**
 * `uid://` text — `ResourceUID::id_to_text` (`core/io/resource_uid.cpp:55-90`), digits emitted
 * least-significant first and then reversed (:82-84).
 *
 * The alphabet is Godot's own 34-character table (`resource_uid.cpp:51`): `a`..`y` then `0`..`8`.
 * It is NOT base-36 and it is not the alphabet `text_to_id` inverts with, which is why it is
 * transcribed here rather than reconstructed from a range. Spelling it out is what makes the
 * binary path report the same `uid://…` token the G4 text documents carry on their
 * `[ext_resource]` lines — the check that caught this: `stage.tscn` names
 * `uid://ba7lhk44sk366` for `res://stage/meshes/floor.res`, and the file's own header must decode
 * to that string.
 */
const UID_CHARS = 'abcdefghijklmnopqrstuvwxy012345678';

function uidToText(id: bigint): string | undefined {
  // ResourceUID::INVALID_ID is -1, stored by the saver as a full-width unsigned word (:56-58).
  if (id === 0xffffffffffffffffn || id < 0n) return undefined;
  const radix = BigInt(UID_CHARS.length);
  let value = id;
  let text = '';
  do {
    text = `${UID_CHARS[Number(value % radix)]}${text}`;
    value /= radix;
  } while (value > 0n);
  return `uid://${text}`;
}

/**
 * A cursor over the container's bytes.
 *
 * Godot reads through `FileAccess`, which is little-endian unless the header's `big_endian` word
 * says otherwise (`resource_format_binary.cpp:946-949`). This reader REFUSES a big-endian file by
 * name instead of carrying a second byte order: Godot only writes one when a caller passes
 * `FLAG_SAVE_BIG_ENDIAN` (:2122), no exporter this lane targets does, and a silently
 * byte-swapped mesh is the kind of wrong answer that looks like geometry.
 */
class ByteCursor {
  private offset = 0;
  private readonly view: DataView;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly at: string,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  seek(position: number): void {
    if (position < 0 || position > this.bytes.length) {
      this.fail(`seek to ${position}, outside the ${this.bytes.length}-byte container`);
    }
    this.offset = position;
  }

  fail(message: string): never {
    throw new GodotBinaryParseError(`${this.at}: ${message}`);
  }

  private need(count: number): number {
    if (this.offset + count > this.bytes.length) {
      this.fail(
        `wanted ${count} byte(s) at offset ${this.offset} but the container is ${this.bytes.length} byte(s) — truncated`,
      );
    }
    const start = this.offset;
    this.offset += count;
    return start;
  }

  ascii(count: number): string {
    const start = this.need(count);
    return String.fromCharCode(...this.bytes.subarray(start, start + count));
  }

  u16(): number {
    return this.view.getUint16(this.need(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.need(4), true);
  }

  i32(): number {
    return this.view.getInt32(this.need(4), true);
  }

  u64(): bigint {
    return this.view.getBigUint64(this.need(8), true);
  }

  i64(): bigint {
    return this.view.getBigInt64(this.need(8), true);
  }

  f32(): number {
    return this.view.getFloat32(this.need(4), true);
  }

  f64(): number {
    return this.view.getFloat64(this.need(8), true);
  }

  take(count: number): Uint8Array {
    const start = this.need(count);
    return this.bytes.subarray(start, start + count);
  }

  /** `ResourceLoaderBinary::_advance_padding` (`resource_format_binary.cpp:104-111`) — the byte
   *  array is the ONE variant whose payload is not a multiple of 4. */
  advancePadding(length: number): void {
    const extra = 4 - (length % 4);
    if (extra < 4) this.need(extra);
  }
}

/** `String::utf8(buf, len)` where `len` INCLUDES the trailing NUL the saver writes
 *  (`resource_format_binary.cpp:850-854`); Godot's UTF-8 decode stops at it. */
function utf8(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}

interface DecodeContext {
  readonly cursor: ByteCursor;
  readonly strings: readonly string[];
  /** `FORMAT_FLAG_REAL_T_IS_DOUBLE` — decides `get_real()`'s width
   *  (`resource_format_binary.cpp:980`, `read_reals` :113-139). */
  readonly realIsDouble: boolean;
  /** The container's engine dialect. Variant ids shared by 3.x and 4.x still have dialect-native
   *  text spellings (`PoolByteArray`/`PackedByteArray`, `Transform`/`Transform3D`). */
  readonly engineMajor: number;
  readonly formatVersion: number;
  /** Resolves an `OBJECT_INTERNAL_RESOURCE` index to the id `binary-document.ts` keys sub
   *  resources by. Populated from the internal table, which the container reads first. */
  readonly internalIds: readonly string[];
}

/** `ResourceLoaderBinary::get_unicode_string` (`resource_format_binary.cpp:864-874`) — an INLINE
 *  string: a length then that many bytes. */
function readInlineString(cursor: ByteCursor): string {
  const length = cursor.u32();
  if (length === 0) return '';
  return utf8(cursor.take(length));
}

/**
 * `ResourceLoaderBinary::_get_string` (`resource_format_binary.cpp:141-156`) — a string TABLE
 * reference, or, when the top bit is set, an inline string whose length is the low 31 bits. Only
 * property names and `NodePath` segments use this spelling (the saver's `p_bit_on_len`
 * argument, :1789).
 */
function readTableString(ctx: DecodeContext): string {
  const id = ctx.cursor.u32();
  if ((id & 0x80000000) !== 0) {
    const length = id & 0x7fffffff;
    if (length === 0) return '';
    return utf8(ctx.cursor.take(length));
  }
  const value = ctx.strings[id];
  if (value === undefined) {
    ctx.cursor.fail(
      `string table reference ${id}, but the table has ${ctx.strings.length} entr(ies)`,
    );
  }
  return value;
}

function num(value: number, variantType: 'int' | 'float'): GodotValue {
  return { kind: 'number', value, variantType };
}

function ctor(name: string, args: readonly GodotValue[]): GodotValue {
  return { kind: 'ctor', name, args, fields: [] };
}

/** `f->get_real()` — float32, or float64 under `FORMAT_FLAG_REAL_T_IS_DOUBLE`
 *  (`resource_format_binary.cpp:113-139`). */
function real(ctx: DecodeContext): number {
  return ctx.realIsDouble ? ctx.cursor.f64() : ctx.cursor.f32();
}

function reals(ctx: DecodeContext, count: number): GodotValue[] {
  const out: GodotValue[] = [];
  for (let i = 0; i < count; i++) out.push(num(real(ctx), 'float'));
  return out;
}

function int32s(ctx: DecodeContext, count: number): GodotValue[] {
  const out: GodotValue[] = [];
  for (let i = 0; i < count; i++) out.push(num(ctx.cursor.i32(), 'int'));
  return out;
}

function floats(ctx: DecodeContext, count: number): GodotValue[] {
  const out: GodotValue[] = [];
  for (let i = 0; i < count; i++) out.push(num(ctx.cursor.f32(), 'float'));
  return out;
}

function refuseVariant(ctx: DecodeContext, typeId: number, why: string): never {
  const name = VARIANT_TYPE_NAMES.get(typeId);
  ctx.cursor.fail(
    name === undefined
      ? `unknown variant type id ${typeId} — not a type Godot 4.7 defines (resource_format_binary.cpp:48-89)`
      : `${name} (${typeId}) is not decoded by this reader: ${why}`,
  );
}

/**
 * A `NodePath`'s text spelling, which is what the text reader's `^"…"` decode yields
 * (`text-format.ts`'s `sigilValue`). `NodePath::operator String` — absolute paths lead with `/`,
 * names join with `/`, each subname is prefixed `:`.
 */
function nodePathText(
  names: readonly string[],
  subnames: readonly string[],
  absolute: boolean,
): string {
  return `${absolute ? '/' : ''}${names.join('/')}${subnames.map((s) => `:${s}`).join('')}`;
}

/**
 * A dictionary KEY, in the spelling the text reader produces for the same dictionary.
 *
 * `GodotEntry.key` is a `string` because Godot's own text form writes bare tokens there
 * (`{ "cells": …, 1: … }` both parse through `text-format.ts`'s `readKey`), so an int key IS
 * `"1"` on the text path and decoding it that way is a match rather than a coercion. A key of any
 * other type refuses by name — the text parser refuses it too (it would read `Vector2` as a key
 * token and then fail on the missing `:`), and inventing a spelling here would make the two paths
 * disagree about the same document.
 */
function readDictionaryKey(ctx: DecodeContext): string {
  const value = readVariant(ctx);
  switch (value.kind) {
    case 'string':
      return value.value;
    case 'number':
      return String(value.value);
    case 'bool':
      return value.value ? 'true' : 'false';
    default:
      return ctx.cursor.fail(
        `a dictionary key decoded to ${value.kind === 'ctor' ? `${value.name}(…)` : value.kind}; ` +
          'the document model keys dictionaries by their text spelling, which Godot writes only ' +
          'for String/StringName/int/bool keys',
      );
  }
}

/**
 * `ResourceLoaderBinary::parse_variant` (`resource_format_binary.cpp:158-615`).
 *
 * Each case below cites the line of the case it mirrors. The mapping onto `GodotValue` is the one
 * `text-format.ts` already produces for the same value written as text, so a consumer cannot tell
 * which serialization it came from — that is the property this whole module exists for.
 */
function readVariant(ctx: DecodeContext): GodotValue {
  const typeId = ctx.cursor.u32();
  switch (typeId) {
    case 1: // VARIANT_NIL, :163
      return { kind: 'null' };
    case 2: // VARIANT_BOOL, :166
      return { kind: 'bool', value: ctx.cursor.u32() !== 0 };
    case 3: // VARIANT_INT, :169 — `int(f->get_32())`, signed
      return num(ctx.cursor.i32(), 'int');
    case 40: {
      // VARIANT_INT64, :172
      const value = ctx.cursor.i64();
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        ctx.cursor.fail(
          `VARIANT_INT64 ${value} is outside JavaScript's exact integer range; the value model ` +
            'carries numbers and would report a rounded one',
        );
      }
      return num(Number(value), 'int');
    }
    case 4: // VARIANT_FLOAT, :175
      return num(real(ctx), 'float');
    case 41: // VARIANT_DOUBLE, :178
      return num(ctx.cursor.f64(), 'float');
    case 5: // VARIANT_STRING, :181
      return { kind: 'string', value: readInlineString(ctx.cursor) };
    case 44: // VARIANT_STRING_NAME, :344 — the text reader decodes `&"x"` to a plain string
      return { kind: 'string', value: readInlineString(ctx.cursor) };
    case 10: // VARIANT_VECTOR2, :184
      return ctor('Vector2', reals(ctx, 2));
    case 45: // VARIANT_VECTOR2I, :191
      return ctor('Vector2i', int32s(ctx, 2));
    case 11: // VARIANT_RECT2, :198
      return ctor('Rect2', reals(ctx, 4));
    case 46: // VARIANT_RECT2I, :207
      return ctor('Rect2i', int32s(ctx, 4));
    case 12: // VARIANT_VECTOR3, :216
      return ctor('Vector3', reals(ctx, 3));
    case 47: // VARIANT_VECTOR3I, :223
      return ctor('Vector3i', int32s(ctx, 3));
    case 50: // VARIANT_VECTOR4, :230
      return ctor('Vector4', reals(ctx, 4));
    case 51: // VARIANT_VECTOR4I, :238
      return ctor('Vector4i', int32s(ctx, 4));
    case 13: // VARIANT_PLANE, :246 — normal.xyz then d
      return ctor('Plane', reals(ctx, 4));
    case 14: // VARIANT_QUAT/QUATERNION
      return ctor(ctx.engineMajor < 4 ? 'Quat' : 'Quaternion', reals(ctx, 4));
    case 15: // VARIANT_AABB, :263 — position.xyz then size.xyz
      return ctor('AABB', reals(ctx, 6));
    case 18: // VARIANT_TRANSFORM2D, :274 — three columns of 2
      return ctor('Transform2D', reals(ctx, 6));
    case 16: // VARIANT_BASIS, :285 — three ROWS of 3
      return ctor('Basis', reals(ctx, 9));
    case 17: // VARIANT_TRANSFORM/TRANSFORM3D — basis rows then origin
      return ctor(ctx.engineMajor < 4 ? 'Transform' : 'Transform3D', reals(ctx, 12));
    case 52: // VARIANT_PROJECTION, :315 — four columns of 4
      return ctor('Projection', reals(ctx, 16));
    case 20: // VARIANT_COLOR, :335 — "Colors should always be in single-precision"
      return ctor('Color', floats(ctx, 4));
    case 22: {
      // VARIANT_NODE_PATH, :348
      const nameCount = ctx.cursor.u16();
      const rawSubnameCount = ctx.cursor.u16();
      const absolute = (rawSubnameCount & 0x8000) !== 0;
      const subnameCount = rawSubnameCount & 0x7fff;
      const names: string[] = [];
      const subnames: string[] = [];
      for (let i = 0; i < nameCount; i++) names.push(readTableString(ctx));
      for (let i = 0; i < subnameCount; i++) subnames.push(readTableString(ctx));
      return ctor('NodePath', [{ kind: 'string', value: nodePathText(names, subnames, absolute) }]);
    }
    case 24: {
      // VARIANT_OBJECT, :376
      const objectType = ctx.cursor.u32();
      switch (objectType) {
        case OBJECT_EMPTY: // :380
          return { kind: 'null' };
        case OBJECT_INTERNAL_RESOURCE: {
          // :384
          const index = ctx.cursor.u32();
          const id = ctx.internalIds[index];
          if (id === undefined) {
            ctx.cursor.fail(
              `an OBJECT_INTERNAL_RESOURCE cites index ${index}, but the internal-resource table has ${ctx.internalIds.length} row(s)`,
            );
          }
          return ctor('SubResource', [{ kind: 'string', value: id }]);
        }
        case OBJECT_EXTERNAL_RESOURCE_INDEX: // :426
          return ctor('ExtResource', [num(ctx.cursor.i32(), 'int')]);
        case OBJECT_EXTERNAL_RESOURCE:
          // :403 — "old file format, still around for compatibility". Godot 4's saver never
          // writes it (:1808-1829 emits only EMPTY / INTERNAL / EXTERNAL_RESOURCE_INDEX), so a
          // file carrying one is not a Godot 4 file this reader claims.
          return ctx.cursor.fail(
            'OBJECT_EXTERNAL_RESOURCE (1) is the pre-index inline external reference; Godot 4 ' +
              'writes OBJECT_EXTERNAL_RESOURCE_INDEX (3) and this reader decodes that spelling only',
          );
        default:
          return ctx.cursor.fail(
            `unknown OBJECT sub-type ${objectType} — resource_format_binary.cpp:90-93 defines 0..3`,
          );
      }
    }
    case 26: {
      // VARIANT_DICTIONARY, :465 — the top bit is Godot's unused "shared" marker
      const length = ctx.cursor.u32() & 0x7fffffff;
      const entries: GodotEntry[] = [];
      for (let i = 0; i < length; i++) {
        const key = readDictionaryKey(ctx);
        entries.push({ key, value: readVariant(ctx) });
      }
      return { kind: 'dict', entries };
    }
    case 30: {
      // VARIANT_ARRAY, :480
      const length = ctx.cursor.u32() & 0x7fffffff;
      const items: GodotValue[] = [];
      for (let i = 0; i < length; i++) items.push(readVariant(ctx));
      return { kind: 'array', items };
    }
    case 31: {
      // VARIANT_PACKED_BYTE_ARRAY, :494 — the one variant with tail padding (:501)
      const length = ctx.cursor.u32();
      const bytes = ctx.cursor.take(length);
      ctx.cursor.advancePadding(length);
      // Each dialect's own text spelling. Godot 3 writes decimal PoolByteArray elements; Godot 4
      // writes one base64 string. Downstream readers therefore see exactly the shape they already
      // accept from a text resource in the same project.
      return ctx.engineMajor < 4
        ? ctor('PoolByteArray', [...bytes].map((value) => num(value, 'int')))
        : ctor(
            'PackedByteArray',
            length === 0 ? [] : [{ kind: 'string', value: Buffer.from(bytes).toString('base64') }],
          );
    }
    case 32: {
      // VARIANT_PACKED_INT32_ARRAY, :506
      const length = ctx.cursor.u32();
      return ctor(ctx.engineMajor < 4 ? 'PoolIntArray' : 'PackedInt32Array', int32s(ctx, length));
    }
    case 48: {
      // VARIANT_PACKED_INT64_ARRAY, :516
      const length = ctx.cursor.u32();
      const items: GodotValue[] = [];
      for (let i = 0; i < length; i++) {
        const value = ctx.cursor.i64();
        if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
          ctx.cursor.fail(
            `PackedInt64Array[${i}] is ${value}, outside JavaScript's exact integer range`,
          );
        }
        items.push(num(Number(value), 'int'));
      }
      return ctor('PackedInt64Array', items);
    }
    case 33: {
      // VARIANT_PACKED_FLOAT32_ARRAY, :526
      const length = ctx.cursor.u32();
      return ctor(ctx.engineMajor < 4 ? 'PoolRealArray' : 'PackedFloat32Array', floats(ctx, length));
    }
    case 49: {
      // VARIANT_PACKED_FLOAT64_ARRAY, :536
      const length = ctx.cursor.u32();
      const items: GodotValue[] = [];
      for (let i = 0; i < length; i++) items.push(num(ctx.cursor.f64(), 'float'));
      return ctor('PackedFloat64Array', items);
    }
    case 34: {
      // VARIANT_PACKED_STRING_ARRAY, :546
      const length = ctx.cursor.u32();
      const items: GodotValue[] = [];
      for (let i = 0; i < length; i++) {
        items.push({ kind: 'string', value: readInlineString(ctx.cursor) });
      }
      return ctor(ctx.engineMajor < 4 ? 'PoolStringArray' : 'PackedStringArray', items);
    }
    case 37: {
      // VARIANT_PACKED_VECTOR2_ARRAY, :558 — reals, so double under REAL_T_IS_DOUBLE
      const length = ctx.cursor.u32();
      return ctor(ctx.engineMajor < 4 ? 'PoolVector2Array' : 'PackedVector2Array', reals(ctx, length * 2));
    }
    case 35: {
      // VARIANT_PACKED_VECTOR3_ARRAY, :571
      const length = ctx.cursor.u32();
      return ctor(ctx.engineMajor < 4 ? 'PoolVector3Array' : 'PackedVector3Array', reals(ctx, length * 3));
    }
    case 53: {
      // VARIANT_PACKED_VECTOR4_ARRAY, :596
      const length = ctx.cursor.u32();
      return ctor('PackedVector4Array', reals(ctx, length * 4));
    }
    case 36: {
      // VARIANT_PACKED_COLOR_ARRAY, :584 — "Colors always use `float`"
      const length = ctx.cursor.u32();
      return ctor(ctx.engineMajor < 4 ? 'PoolColorArray' : 'PackedColorArray', floats(ctx, length * 4));
    }
    case 23: // VARIANT_RID, :373
      return refuseVariant(
        ctx,
        typeId,
        'a RID is a live server handle Godot itself warns it cannot save ' +
          '(resource_format_binary.cpp:1803) and it means nothing outside the running engine',
      );
    case 42: // VARIANT_CALLABLE, :458
    case 43: // VARIANT_SIGNAL, :461
      return refuseVariant(
        ctx,
        typeId,
        'Godot restores it as an EMPTY value (it cannot serialize the bound object), so a ' +
          'decoded value would carry no information the document actually states',
      );
    case 25: // VARIANT_INPUT_EVENT — declared (:66) and written by nothing in 4.x
      return refuseVariant(
        ctx,
        typeId,
        'no Godot 4 encoder writes it and its payload is undefined',
      );
    default:
      return refuseVariant(ctx, typeId, 'not implemented');
  }
}

/**
 * `FileAccessCompressed::open_after_magic` (`file_access_compressed.cpp:43-78`), reading the
 * whole stream rather than Godot's seek-a-block-at-a-time.
 *
 * The layout after the `RSCC` magic: mode, block size, total DECOMPRESSED length, then one
 * `uint32` compressed size per block, then the blocks. `bc = (read_total / block_size) + 1`
 * (:52) — note the `+ 1`, so a payload that is an exact multiple of the block size carries a
 * final EMPTY block, and the concatenation is truncated to `read_total`.
 */
function decompressRscc(cursor: ByteCursor, at: string): { bytes: Uint8Array; mode: string } {
  const modeId = cursor.u32();
  const mode = COMPRESSION_MODE_NAMES.get(modeId);
  if (mode === undefined) {
    cursor.fail(`RSCC compression mode ${modeId} — compression.h:46-52 defines 0..4`);
  }
  const blockSize = cursor.u32();
  if (blockSize === 0) cursor.fail('RSCC block size 0 — the container is corrupt (:47-50)');
  const readTotal = cursor.u32();
  const blockCount = Math.floor(readTotal / blockSize) + 1;
  const sizes: number[] = [];
  for (let i = 0; i < blockCount; i++) sizes.push(cursor.u32());

  const blocks: Uint8Array[] = [];
  for (const size of sizes) blocks.push(decompressBlock(cursor.take(size), modeId, mode, at));

  const joined = Buffer.concat(blocks.map((block) => Buffer.from(block)));
  if (joined.length < readTotal) {
    throw new GodotBinaryParseError(
      `${at}: RSCC declares ${readTotal} decompressed byte(s) but its ${blockCount} block(s) yielded ${joined.length}`,
    );
  }
  return { bytes: new Uint8Array(joined.subarray(0, readTotal)), mode };
}

/**
 * One RSCC block. `Compression::decompress` (`compression.cpp:170-220`) picks the codec by mode;
 * DEFLATE is zlib-WRAPPED (`window_bits = 15`, :177) rather than raw, and GZIP is `15 + 16`.
 *
 * Node carries every codec Godot writes: zstd landed in `node:zlib` in Node 23.8 / 22.15
 * (`zlib.zstdDecompressSync`), so no dependency is added for the mode the fixture actually uses.
 * `MODE_FASTLZ` is Godot's own vendored codec with no Node or npm counterpart worth adopting for
 * a mode `FileAccessCompressed::configure` never selects (`file_access_compressed.h:69` defaults
 * to ZSTD), so it refuses by name.
 */
function decompressBlock(block: Uint8Array, modeId: number, mode: string, at: string): Uint8Array {
  switch (modeId) {
    case 2: {
      const { zstdDecompressSync } = zlib;
      if (typeof zstdDecompressSync !== 'function') {
        throw new GodotBinaryParseError(
          `${at}: this container is MODE_ZSTD and node:zlib on ${process.version} has no zstdDecompressSync (added in Node 23.8 / 22.15)`,
        );
      }
      return new Uint8Array(zstdDecompressSync(block));
    }
    case 1:
      return new Uint8Array(inflateSync(block));
    case 3:
      return new Uint8Array(gunzipSync(block));
    case 4:
      return new Uint8Array(brotliDecompressSync(block));
    default:
      throw new GodotBinaryParseError(
        `${at}: RSCC compression mode ${mode} (${modeId}) has no decoder here — Godot vendors its own FastLZ and never selects it for a resource container`,
      );
  }
}

/** Decode the format header, string/external tables and internal-resource address table. Godot
 * reads all of these before `load()` visits an internal resource body
 * (`resource_format_binary.cpp:922-1045`), so their identity remains authoritative when a body is
 * corrupt or contains a deliberately unsupported runtime-only Variant. */
function parseGodotBinaryHeader(bytes: Uint8Array, resPath: string): ParsedBinaryHeader {
  const outer = new ByteCursor(bytes, resPath);
  const magic = outer.ascii(4);

  let cursor = outer;
  let compression: string | undefined;
  if (magic === MAGIC_RSCC) {
    // resource_format_binary.cpp:928-937 — the container continues INSIDE the compressed stream,
    // with no second RSRC magic (the saver skips it when compressing, :2134-2138).
    const inner = decompressRscc(outer, resPath);
    cursor = new ByteCursor(inner.bytes, resPath);
    compression = inner.mode;
  } else if (magic !== MAGIC_RSRC) {
    throw new GodotBinaryParseError(
      `${resPath}: magic "${magic}" is neither RSRC nor RSCC — not a Godot binary resource (resource_format_binary.cpp:928-944)`,
    );
  }

  const bigEndian = cursor.u32(); // :946
  const useReal64 = cursor.u32(); // recorded by both savers; 3.x always writes false
  if (bigEndian !== 0) {
    cursor.fail(
      'big-endian binary resource (header word 1 is non-zero); Godot writes one only under ' +
        'ResourceSaver::FLAG_SAVE_BIG_ENDIAN (:2122) and this reader decodes little-endian only',
    );
  }

  const engineMajor = cursor.u32(); // :951
  const engineMinor = cursor.u32(); // :952
  const formatVersion = cursor.u32(); // :953

  const godot3 = engineMajor < 4;
  if (godot3 && (formatVersion < 1 || formatVersion > FORMAT_VERSION_GODOT3)) {
    cursor.fail(
      `format version ${formatVersion} (engine ${engineMajor}.${engineMinor}) is outside the ` +
        `Godot 3 range this reader decodes (1..${FORMAT_VERSION_GODOT3})`,
    );
  }
  if (!godot3 && (formatVersion < FORMAT_VERSION_MIN || formatVersion > FORMAT_VERSION_MAX)) {
    cursor.fail(
      `format version ${formatVersion} (engine ${engineMajor}.${engineMinor}) is outside the ` +
        `Godot 4 range this reader decodes (${FORMAT_VERSION_MIN} string-id resources through ` +
        `${FORMAT_VERSION_MAX} in 4.7-stable, resource_format_binary.cpp:99)`,
    );
  }

  const type = readInlineString(cursor);
  cursor.u64(); // importmd_ofs — always 0 from both measured savers
  let usingNamedSceneIds = false;
  let usingUids = false;
  let realIsDouble = false;
  let uid: string | undefined;
  let scriptClass: string | undefined;
  if (godot3) {
    // 3.6 resource_format_binary.cpp:796-803: type, import metadata offset, then fourteen reserved
    // words. There are no flags, UID, or script-class fields. Its saver writes use_real64=false;
    // refusing the otherwise-unspecified form avoids byte-width guessing.
    if (useReal64 !== 0) {
      cursor.fail('a Godot 3 binary resource with use_real64 set; the 3.6 saver always writes 0');
    }
    for (let i = 0; i < 14; i++) cursor.u32();
    // Godot 3 stores built-in resources as `local://<numeric subindex>` and resolves references by
    // that suffix (3.6 resource_format_binary.cpp:611-616).
    usingNamedSceneIds = true;
  } else {
    const flags = cursor.u32();
    usingNamedSceneIds = (flags & FORMAT_FLAG_NAMED_SCENE_IDS) !== 0;
    usingUids = (flags & FORMAT_FLAG_UIDS) !== 0;
    realIsDouble = (flags & FORMAT_FLAG_REAL_T_IS_DOUBLE) !== 0;
    const rawUid = cursor.u64();
    uid = usingUids ? uidToText(rawUid) : undefined;
    scriptClass =
      (flags & FORMAT_FLAG_HAS_SCRIPT_CLASS) !== 0 ? readInlineString(cursor) : undefined;
    for (let i = 0; i < RESERVED_FIELDS; i++) cursor.u32();
  }

  const stringTableSize = cursor.u32(); // :1001
  const strings: string[] = [];
  for (let i = 0; i < stringTableSize; i++) strings.push(readInlineString(cursor));

  const extResourceCount = cursor.u32(); // :1010
  const extResources: BinaryExtResource[] = [];
  for (let i = 0; i < extResourceCount; i++) {
    const extType = readInlineString(cursor);
    const path = readInlineString(cursor);
    const extUid = usingUids ? uidToText(cursor.u64()) : undefined;
    extResources.push({ type: extType, path, ...(extUid === undefined ? {} : { uid: extUid }) });
  }

  const internalCount = cursor.u32(); // :1038
  const internalPaths: string[] = [];
  const internalOffsets: number[] = [];
  for (let i = 0; i < internalCount; i++) {
    internalPaths.push(readInlineString(cursor)); // :1042
    const offset = cursor.u64(); // :1043
    if (offset > BigInt(Number.MAX_SAFE_INTEGER)) {
      cursor.fail(`internal resource ${i} declares offset ${offset}, which is not addressable`);
    }
    internalOffsets.push(Number(offset));
  }

  // `local://<scene unique id>` is what the saver writes for a built-in resource (:2302); Godot
  // strips the prefix on load (:660-663) and falls back to the row INDEX when the file predates
  // named scene ids (:392). The main resource — the LAST row — is stored under its own res:// path
  // and has no local id at all.
  const internalIds = internalPaths.map((path, index) =>
    usingNamedSceneIds && path.startsWith('local://')
      ? path.slice('local://'.length)
      : String(index),
  );

  return {
    cursor,
    type,
    engineMajor,
    engineMinor,
    formatVersion,
    ...(uid === undefined ? {} : { uid }),
    ...(scriptClass === undefined ? {} : { scriptClass }),
    ...(compression === undefined ? {} : { compression }),
    extResources,
    strings,
    realIsDouble,
    internalIds,
    internalOffsets,
  };
}

/**
 * Read only the source identity and external-resource table of one `.res`/`.scn`. Unlike the full
 * decoder this never visits an internal property body, so a caller building the project-wide UID
 * index does not lose an otherwise exact file UID because an unrelated property is unsupported.
 */
export function parseGodotBinaryResourceMetadata(
  bytes: Uint8Array,
  resPath: string,
): BinaryResourceMetadata {
  const {
    cursor: _cursor,
    strings: _strings,
    realIsDouble: _realIsDouble,
    internalIds: _internalIds,
    internalOffsets: _internalOffsets,
    ...metadata
  } = parseGodotBinaryHeader(bytes, resPath);
  return metadata;
}

/**
 * Decode one `.res`/`.scn`. Throws `GodotBinaryParseError` — with the `res://` path and the
 * reason — on anything it will not decode; the caller turns that into one per-document
 * diagnostic, exactly as the text path does with `GodotParseError`.
 */
export function parseGodotBinaryResource(bytes: Uint8Array, resPath: string): BinaryResourceFile {
  const {
    cursor,
    type,
    engineMajor,
    engineMinor,
    formatVersion,
    uid,
    scriptClass,
    compression,
    extResources,
    strings,
    realIsDouble,
    internalIds,
    internalOffsets,
  } = parseGodotBinaryHeader(bytes, resPath);

  const ctx: DecodeContext = {
    cursor,
    strings,
    realIsDouble,
    engineMajor,
    formatVersion,
    internalIds,
  };

  const internalResources: BinaryInternalResource[] = [];
  for (let i = 0; i < internalIds.length; i++) {
    cursor.seek(internalOffsets[i] as number); // :685
    const resourceType = readInlineString(cursor); // :687
    const propertyCount = cursor.u32(); // :752
    const properties: Record<string, GodotValue> = {};
    for (let p = 0; p < propertyCount; p++) {
      const name = readTableString(ctx); // :759
      if (name === '') {
        cursor.fail(`internal resource ${i} declares an unnamed property (:761-764)`);
      }
      properties[name] = readVariant(ctx);
    }
    internalResources.push({ id: internalIds[i] as string, type: resourceType, properties });
  }

  return {
    type,
    engineMajor,
    engineMinor,
    formatVersion,
    ...(uid === undefined ? {} : { uid }),
    ...(scriptClass === undefined ? {} : { scriptClass }),
    ...(compression === undefined ? {} : { compression }),
    extResources,
    internalResources,
  };
}
