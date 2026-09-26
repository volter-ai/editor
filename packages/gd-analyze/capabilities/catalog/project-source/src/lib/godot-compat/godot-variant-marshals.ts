/** Godot 4.7 Variant binary marshaling used by PackedByteArray encode/decode_var. */

import {
  type PackedArrayValue,
  type PackedByteArray,
  packedArrayKind,
  packedByteArray,
  packedColorArray,
  packedFloat32Array,
  packedFloat64Array,
  packedInt32Array,
  packedInt64Array,
  packedStringArray,
  packedVector2Array,
  packedVector3Array,
  packedVector4Array,
} from './packed-array';
import { packedArrayToByteArray } from './packed-array-binary';

const FLAG_64 = 1 << 16;
const TYPE = {
  nil: 0,
  bool: 1,
  int: 2,
  float: 3,
  string: 4,
  dictionary: 27,
  array: 28,
  byte: 29,
  int32: 30,
  int64: 31,
  float32: 32,
  float64: 33,
  packedString: 34,
  vector2: 35,
  vector3: 36,
  color: 37,
  vector4: 38,
} as const;

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function encodedString(value: string): Uint8Array {
  const data = new TextEncoder().encode(value);
  const padding = (4 - (data.length % 4)) % 4;
  return concat([u32(data.length), data, new Uint8Array(padding)]);
}

function packedType(value: PackedArrayValue<unknown>): number {
  const kind = packedArrayKind(value);
  if (kind === 'byte') return TYPE.byte;
  if (kind === 'int32') return TYPE.int32;
  if (kind === 'int64') return TYPE.int64;
  if (kind === 'float32') return TYPE.float32;
  if (kind === 'float64') return TYPE.float64;
  if (kind === 'string') return TYPE.packedString;
  if (kind === 'vector2') return TYPE.vector2;
  if (kind === 'vector3') return TYPE.vector3;
  if (kind === 'color') return TYPE.color;
  return TYPE.vector4;
}

function encodePacked(value: PackedArrayValue<unknown>): Uint8Array {
  if (packedArrayKind(value) === 'string') {
    return concat([u32(value.length), ...value.map((item) => encodedString(String(item)))]);
  }
  const data = Uint8Array.from(packedArrayToByteArray(value));
  const padding =
    packedArrayKind(value) === 'byte'
      ? new Uint8Array((4 - (data.length % 4)) % 4)
      : new Uint8Array();
  return concat([u32(value.length), data, padding]);
}

function encodeValue(value: unknown, depth: number): Uint8Array {
  if (depth > 1024) throw new RangeError('Godot Variant recursion depth exceeded.');
  if (value === null || value === undefined) return u32(TYPE.nil);
  if (typeof value === 'boolean') return concat([u32(TYPE.bool), u32(value ? 1 : 0)]);
  if (typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value))) {
    const integer = typeof value === 'bigint' ? value : BigInt(value);
    if (integer >= -0x8000_0000n && integer <= 0x7fff_ffffn) {
      return concat([u32(TYPE.int), u32(Number(BigInt.asUintN(32, integer)))]);
    }
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigInt64(0, BigInt.asIntN(64, integer), true);
    return concat([u32(TYPE.int | FLAG_64), bytes]);
  }
  if (typeof value === 'number') {
    const float = Math.fround(value);
    const wide = !Object.is(float, value);
    const data = new Uint8Array(wide ? 8 : 4);
    const target = new DataView(data.buffer);
    wide ? target.setFloat64(0, value, true) : target.setFloat32(0, value, true);
    return concat([u32(TYPE.float | (wide ? FLAG_64 : 0)), data]);
  }
  if (typeof value === 'string') return concat([u32(TYPE.string), encodedString(value)]);
  if (
    Array.isArray(value) &&
    [
      'byte',
      'int32',
      'int64',
      'float32',
      'float64',
      'string',
      'vector2',
      'vector3',
      'vector4',
      'color',
    ].includes(packedArrayKind(value as PackedArrayValue<unknown>))
  ) {
    const packed = value as PackedArrayValue<unknown>;
    return concat([u32(packedType(packed)), encodePacked(packed)]);
  }
  if (Array.isArray(value)) {
    return concat([
      u32(TYPE.array),
      u32(value.length),
      ...value.map((item) => encodeValue(item, depth + 1)),
    ]);
  }
  if (value instanceof Map) {
    const entries = [...value].flatMap(([key, item]) => [
      encodeValue(key, depth + 1),
      encodeValue(item, depth + 1),
    ]);
    return concat([u32(TYPE.dictionary), u32(value.size), ...entries]);
  }
  throw new TypeError(
    'godot-compat: object Variant marshaling is unavailable without a Godot object carrier.',
  );
}

export function godotEncodeVariant(value: unknown, allowObjects = false): PackedByteArray {
  void allowObjects;
  return packedByteArray(encodeValue(value, 0));
}

interface Decoded {
  readonly value: unknown;
  readonly used: number;
}

function requireBytes(source: Uint8Array, at: number, count: number): void {
  if (at < 0 || at + count > source.length) throw new RangeError('truncated Godot Variant payload');
}

function decodeString(source: Uint8Array, at: number): Decoded {
  requireBytes(source, at, 4);
  const length = new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(
    at,
    true,
  );
  requireBytes(source, at + 4, length);
  const padded = length + ((4 - (length % 4)) % 4);
  return {
    value: new TextDecoder().decode(source.subarray(at + 4, at + 4 + length)),
    used: 4 + padded,
  };
}

function decodeValue(source: Uint8Array, at: number, depth: number): Decoded {
  if (depth > 1024) throw new RangeError('Godot Variant recursion depth exceeded.');
  requireBytes(source, at, 4);
  const data = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const header = data.getUint32(at, true);
  const type = header & 0xff;
  let cursor = at + 4;
  if (type === TYPE.nil) return { value: null, used: 4 };
  if (type === TYPE.bool) {
    requireBytes(source, cursor, 4);
    return { value: data.getUint32(cursor, true) !== 0, used: 8 };
  }
  if (type === TYPE.int) {
    const wide = (header & FLAG_64) !== 0;
    requireBytes(source, cursor, wide ? 8 : 4);
    const integer = wide ? data.getBigInt64(cursor, true) : BigInt(data.getInt32(cursor, true));
    const number = Number(integer);
    return { value: Number.isSafeInteger(number) ? number : integer, used: 4 + (wide ? 8 : 4) };
  }
  if (type === TYPE.float) {
    const wide = (header & FLAG_64) !== 0;
    requireBytes(source, cursor, wide ? 8 : 4);
    return {
      value: wide ? data.getFloat64(cursor, true) : data.getFloat32(cursor, true),
      used: 4 + (wide ? 8 : 4),
    };
  }
  if (type === TYPE.string) {
    const decoded = decodeString(source, cursor);
    return { value: decoded.value, used: 4 + decoded.used };
  }
  if (type === TYPE.array || type === TYPE.dictionary) {
    requireBytes(source, cursor, 4);
    const count = data.getUint32(cursor, true) & 0x7fff_ffff;
    cursor += 4;
    const items: unknown[] = [];
    for (let index = 0; index < count * (type === TYPE.dictionary ? 2 : 1); index += 1) {
      const decoded = decodeValue(source, cursor, depth + 1);
      items.push(decoded.value);
      cursor += decoded.used;
    }
    if (type === TYPE.array) return { value: items, used: cursor - at };
    const map = new Map<unknown, unknown>();
    for (let index = 0; index < items.length; index += 2) map.set(items[index], items[index + 1]);
    return { value: map, used: cursor - at };
  }
  if (type >= TYPE.byte && type <= TYPE.vector4) {
    requireBytes(source, cursor, 4);
    const count = data.getUint32(cursor, true);
    cursor += 4;
    if (type === TYPE.packedString) {
      const strings: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const decoded = decodeString(source, cursor);
        strings.push(decoded.value as string);
        cursor += decoded.used;
      }
      return { value: packedStringArray(strings), used: cursor - at };
    }
    const widths: Readonly<Record<number, number>> = {
      [TYPE.byte]: 1,
      [TYPE.int32]: 4,
      [TYPE.int64]: 8,
      [TYPE.float32]: 4,
      [TYPE.float64]: 8,
      [TYPE.vector2]: 8,
      [TYPE.vector3]: 12,
      [TYPE.color]: 16,
      [TYPE.vector4]: 16,
    };
    const byteCount = count * (widths[type] ?? 0);
    requireBytes(source, cursor, byteCount);
    const raw = packedByteArray(source.subarray(cursor, cursor + byteCount));
    const constructors: Readonly<Record<number, () => PackedArrayValue<unknown>>> = {
      [TYPE.byte]: () => packedByteArray(raw),
      [TYPE.int32]: () => packedInt32ArrayFrom(raw),
      [TYPE.int64]: () => packedInt64ArrayFrom(raw),
      [TYPE.float32]: () => packedFloat32ArrayFrom(raw),
      [TYPE.float64]: () => packedFloat64ArrayFrom(raw),
      [TYPE.vector2]: () => packedVector2ArrayFrom(raw),
      [TYPE.vector3]: () => packedVector3ArrayFrom(raw),
      [TYPE.color]: () => packedColorArrayFrom(raw),
      [TYPE.vector4]: () => packedVector4ArrayFrom(raw),
    };
    const padded = type === TYPE.byte ? (4 - (byteCount % 4)) % 4 : 0;
    return {
      value: constructors[type]?.() ?? packedByteArray(),
      used: cursor + byteCount + padded - at,
    };
  }
  throw new TypeError(`unsupported Godot Variant type ${type}`);
}

// Kept local to avoid exposing marshaling's raw-byte construction details as public API.
const rawValues = (
  raw: PackedByteArray,
  width: number,
  read: (view: DataView, at: number) => unknown,
): unknown[] => {
  const data = new DataView(Uint8Array.from(raw).buffer);
  return Array.from({ length: raw.length / width }, (_, index) => read(data, index * width));
};
const packedInt32ArrayFrom = (raw: PackedByteArray) =>
  packedInt32Array(rawValues(raw, 4, (v, a) => v.getInt32(a, true)));
const packedInt64ArrayFrom = (raw: PackedByteArray) =>
  packedInt64Array(rawValues(raw, 8, (v, a) => v.getBigInt64(a, true)));
const packedFloat32ArrayFrom = (raw: PackedByteArray) =>
  packedFloat32Array(rawValues(raw, 4, (v, a) => v.getFloat32(a, true)));
const packedFloat64ArrayFrom = (raw: PackedByteArray) =>
  packedFloat64Array(rawValues(raw, 8, (v, a) => v.getFloat64(a, true)));
const tuples = (raw: PackedByteArray, count: number, fields: readonly string[]) =>
  rawValues(raw, count * 4, (v, a) =>
    Object.fromEntries(fields.map((field, i) => [field, v.getFloat32(a + i * 4, true)])),
  );
const packedVector2ArrayFrom = (raw: PackedByteArray) =>
  packedVector2Array(tuples(raw, 2, ['x', 'y']));
const packedVector3ArrayFrom = (raw: PackedByteArray) =>
  packedVector3Array(tuples(raw, 3, ['x', 'y', 'z']));
const packedVector4ArrayFrom = (raw: PackedByteArray) =>
  packedVector4Array(tuples(raw, 4, ['x', 'y', 'z', 'w']));
const packedColorArrayFrom = (raw: PackedByteArray) =>
  packedColorArray(tuples(raw, 4, ['r', 'g', 'b', 'a']));

export function godotDecodeVariant(
  value: PackedByteArray,
  offset = 0,
  allowObjects = false,
): Decoded | null {
  void allowObjects;
  const at = Math.trunc(offset);
  if (at < 0) return null;
  try {
    return decodeValue(Uint8Array.from(value), at, 0);
  } catch {
    return null;
  }
}
