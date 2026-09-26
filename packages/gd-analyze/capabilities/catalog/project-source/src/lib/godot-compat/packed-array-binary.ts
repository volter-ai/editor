/**
 * Godot 4.7 Packed*Array binary protocol.
 *
 * This module owns Godot's little-endian layouts, bounds/error results, compression-mode routing,
 * and string decoding. Compression algorithms themselves are general supply: runtime setup passes
 * initialized synchronous codec functions through {@link GodotPackedArrayCodecs}.
 *
 * Semantic authority: Godot 4.7-stable 5b4e0cb0
 * `core/variant/variant_call.cpp`, `core/io/{marshalls,compression}.cpp`, and
 * `core/string/ustring.cpp`.
 */

import {
  type GodotInt64,
  type PackedArrayValue,
  type PackedByteArray,
  packedArrayKind,
  packedByteArray,
  packedColorArray,
  packedFloat32Array,
  packedFloat64Array,
  packedInt32Array,
  packedInt64Array,
  packedVector2Array,
  packedVector3Array,
  packedVector4Array,
} from './packed-array';

export const GODOT_COMPRESSION_FASTLZ = 0;
export const GODOT_COMPRESSION_DEFLATE = 1;
export const GODOT_COMPRESSION_ZSTD = 2;
export const GODOT_COMPRESSION_GZIP = 3;
export const GODOT_COMPRESSION_BROTLI = 4;

export interface GodotPackedArrayCodecs {
  readonly compress: (mode: number, source: Uint8Array) => Uint8Array | null;
  readonly decompress: (
    mode: number,
    source: Uint8Array,
    expectedSize: number,
    maxOutputSize?: number,
  ) => Uint8Array | null;
}

function bytes(value: readonly number[]): Uint8Array {
  return Uint8Array.from(value);
}

function view(value: readonly number[]): DataView {
  const source = bytes(value);
  return new DataView(source.buffer, source.byteOffset, source.byteLength);
}

function validRange(value: readonly number[], offset: number, size: number): boolean {
  const at = Math.trunc(offset);
  if (at < 0 || at + size > value.length) {
    console.error(
      `godot-compat: PackedByteArray byte range [${at}, ${at + size}) exceeds size ${value.length}.`,
    );
    return false;
  }
  return true;
}

function read<T>(
  value: readonly number[],
  offset: number,
  size: number,
  fallback: T,
  decode: (source: DataView, at: number) => T,
): T {
  const at = Math.trunc(offset);
  return validRange(value, at, size) ? decode(view(value), at) : fallback;
}

function write(
  value: PackedByteArray,
  offset: number,
  size: number,
  encode: (target: DataView, at: number) => void,
): void {
  const at = Math.trunc(offset);
  if (!validRange(value, at, size)) return;
  const target = view(value);
  encode(target, at);
  for (let i = 0; i < size; i += 1) value[at + i] = target.getUint8(at + i);
}

export function packedByteDecodeInteger(
  value: PackedByteArray,
  offset: number,
  bits: 8 | 16 | 32 | 64,
  signed: boolean,
): GodotInt64 {
  const size = bits / 8;
  return read(value, offset, size, 0, (source, at) => {
    if (bits === 8) return signed ? source.getInt8(at) : source.getUint8(at);
    if (bits === 16) return signed ? source.getInt16(at, true) : source.getUint16(at, true);
    if (bits === 32) return signed ? source.getInt32(at, true) : source.getUint32(at, true);
    const result = signed
      ? source.getBigInt64(at, true)
      : BigInt.asIntN(64, source.getBigUint64(at, true));
    const asNumber = Number(result);
    return Number.isSafeInteger(asNumber) ? asNumber : result;
  });
}

export function packedByteEncodeInteger(
  value: PackedByteArray,
  offset: number,
  input: GodotInt64,
  bits: 8 | 16 | 32 | 64,
  signed: boolean,
): void {
  const size = bits / 8;
  write(value, offset, size, (target, at) => {
    if (bits === 8) {
      signed ? target.setInt8(at, Number(input)) : target.setUint8(at, Number(input));
    } else if (bits === 16) {
      signed ? target.setInt16(at, Number(input), true) : target.setUint16(at, Number(input), true);
    } else if (bits === 32) {
      signed ? target.setInt32(at, Number(input), true) : target.setUint32(at, Number(input), true);
    } else {
      const integer = typeof input === 'bigint' ? input : BigInt(Math.trunc(input));
      signed ? target.setBigInt64(at, integer, true) : target.setBigUint64(at, integer, true);
    }
  });
}

function decodeHalf(raw: number): number {
  const sign = (raw & 0x8000) === 0 ? 1 : -1;
  const exponent = (raw >>> 10) & 0x1f;
  const fraction = raw & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function encodeHalf(value: number): number {
  const float = new Float32Array([value]);
  const bits = new Uint32Array(float.buffer)[0] ?? 0;
  const sign = (bits >>> 16) & 0x8000;
  let exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  let fraction = bits & 0x7f_ffff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    fraction = (fraction | 0x80_0000) >>> (1 - exponent);
    return sign | ((fraction + 0x1000) >>> 13);
  }
  if (exponent >= 0x1f) return sign | 0x7c00 | (fraction === 0 ? 0 : 0x0200);
  fraction += 0x1000;
  if ((fraction & 0x80_0000) !== 0) {
    fraction = 0;
    exponent += 1;
  }
  return exponent >= 0x1f ? sign | 0x7c00 : sign | (exponent << 10) | (fraction >>> 13);
}

export function packedByteDecodeFloat(
  value: PackedByteArray,
  offset: number,
  kind: 'half' | 'float' | 'double',
): number {
  const size = kind === 'half' ? 2 : kind === 'float' ? 4 : 8;
  return read(value, offset, size, 0, (source, at) =>
    kind === 'half'
      ? decodeHalf(source.getUint16(at, true))
      : kind === 'float'
        ? source.getFloat32(at, true)
        : source.getFloat64(at, true),
  );
}

export function packedByteEncodeFloat(
  value: PackedByteArray,
  offset: number,
  input: number,
  kind: 'half' | 'float' | 'double',
): void {
  const size = kind === 'half' ? 2 : kind === 'float' ? 4 : 8;
  write(value, offset, size, (target, at) => {
    if (kind === 'half') target.setUint16(at, encodeHalf(input), true);
    else if (kind === 'float') target.setFloat32(at, input, true);
    else target.setFloat64(at, input, true);
  });
}

export function packedByteString(
  value: PackedByteArray,
  encoding: 'ascii' | 'utf8' | 'utf16' | 'utf32' | 'wchar' | string,
): string {
  const source = bytes(value);
  if (encoding === 'ascii') return String.fromCharCode(...source);
  if (encoding === 'utf8' || encoding === '') return new TextDecoder('utf-8').decode(source);
  if (encoding === 'utf16') {
    return new TextDecoder('utf-16le').decode(
      source.subarray(0, source.length - (source.length % 2)),
    );
  }
  if (encoding === 'utf32' || encoding === 'wchar') {
    const data = new DataView(source.buffer, source.byteOffset, source.byteLength);
    const codepoints: number[] = [];
    for (let at = 0; at + 4 <= source.length; at += 4) codepoints.push(data.getUint32(at, true));
    try {
      return String.fromCodePoint(...codepoints);
    } catch {
      return '';
    }
  }
  try {
    return new TextDecoder(encoding).decode(source);
  } catch {
    console.error(`godot-compat: unsupported multibyte encoding "${encoding}".`);
    return '';
  }
}

export const packedByteHexEncode = (value: PackedByteArray): string =>
  value.map((item) => item.toString(16).padStart(2, '0')).join('');

function toBytes(data: ArrayBuffer): PackedByteArray {
  return packedByteArray(new Uint8Array(data));
}

export function packedArrayToByteArray(value: PackedArrayValue<unknown>): PackedByteArray {
  const kind = packedArrayKind(value);
  if (kind === 'byte') return packedByteArray(value);
  if (kind === 'string') {
    const encoder = new TextEncoder();
    const output: number[] = [];
    for (const item of value) output.push(...encoder.encode(String(item)), 0);
    return packedByteArray(output);
  }
  const widths: Readonly<Record<string, number>> = {
    int32: 4,
    int64: 8,
    float32: 4,
    float64: 8,
    vector2: 8,
    vector3: 12,
    vector4: 16,
    color: 16,
  };
  const buffer = new ArrayBuffer((widths[kind] ?? 0) * value.length);
  const target = new DataView(buffer);
  let at = 0;
  for (const item of value) {
    if (kind === 'int32') target.setInt32(at, Number(item), true);
    else if (kind === 'int64') target.setBigInt64(at, BigInt(item as GodotInt64), true);
    else if (kind === 'float32') target.setFloat32(at, Number(item), true);
    else if (kind === 'float64') target.setFloat64(at, Number(item), true);
    else {
      const tuple = item as Record<string, number>;
      const fields =
        kind === 'vector2'
          ? ['x', 'y']
          : kind === 'vector3'
            ? ['x', 'y', 'z']
            : kind === 'vector4'
              ? ['x', 'y', 'z', 'w']
              : ['r', 'g', 'b', 'a'];
      for (const field of fields) {
        target.setFloat32(at, tuple[field] ?? 0, true);
        at += 4;
      }
      continue;
    }
    at += widths[kind] ?? 0;
  }
  return toBytes(buffer);
}

export function packedByteToArray(value: PackedByteArray, kind: string): PackedArrayValue<unknown> {
  const widths: Readonly<Record<string, number>> = {
    int32: 4,
    int64: 8,
    float32: 4,
    float64: 8,
    vector2: 8,
    vector3: 12,
    vector4: 16,
    color: 16,
  };
  const width = widths[kind] ?? 0;
  if (width === 0 || value.length % width !== 0) {
    console.error(`godot-compat: PackedByteArray cannot convert ${value.length} bytes to ${kind}.`);
    const empty: Readonly<Record<string, () => PackedArrayValue<unknown>>> = {
      int32: packedInt32Array,
      int64: packedInt64Array,
      float32: packedFloat32Array,
      float64: packedFloat64Array,
      vector2: packedVector2Array,
      vector3: packedVector3Array,
      vector4: packedVector4Array,
      color: packedColorArray,
    };
    return (empty[kind] ?? packedByteArray)();
  }
  const source = view(value);
  const result: unknown[] = [];
  for (let at = 0; at < value.length; at += width) {
    if (kind === 'int32') result.push(source.getInt32(at, true));
    else if (kind === 'int64') result.push(source.getBigInt64(at, true));
    else if (kind === 'float32') result.push(source.getFloat32(at, true));
    else if (kind === 'float64') result.push(source.getFloat64(at, true));
    else {
      const count = kind === 'vector2' ? 2 : kind === 'vector3' ? 3 : 4;
      const values = Array.from({ length: count }, (_, i) => source.getFloat32(at + i * 4, true));
      result.push(
        kind === 'vector2'
          ? { x: values[0], y: values[1] }
          : kind === 'vector3'
            ? { x: values[0], y: values[1], z: values[2] }
            : kind === 'vector4'
              ? { x: values[0], y: values[1], z: values[2], w: values[3] }
              : { r: values[0], g: values[1], b: values[2], a: values[3] },
      );
    }
  }
  const constructors: Readonly<
    Record<string, (items: Iterable<unknown>) => PackedArrayValue<unknown>>
  > = {
    int32: packedInt32Array,
    int64: packedInt64Array,
    float32: packedFloat32Array,
    float64: packedFloat64Array,
    vector2: packedVector2Array,
    vector3: packedVector3Array,
    vector4: packedVector4Array,
    color: packedColorArray,
  };
  return (constructors[kind] ?? packedByteArray)(result);
}

export function packedByteSwap(
  value: PackedByteArray,
  width: 2 | 4 | 8,
  offset = 0,
  count = -1,
): void {
  const start = Math.trunc(offset);
  const bytesToSwap = count < 0 ? value.length - start : Math.trunc(count) * width;
  if (start < 0 || start + bytesToSwap > value.length || bytesToSwap % width !== 0) {
    console.error('godot-compat: PackedByteArray.bswap range is invalid.');
    return;
  }
  for (let at = start; at < start + bytesToSwap; at += width) {
    for (let i = 0; i < width / 2; i += 1) {
      const opposite = at + width - i - 1;
      [value[at + i], value[opposite]] = [value[opposite] as number, value[at + i] as number];
    }
  }
}

export function packedByteCompress(
  value: PackedByteArray,
  mode: number,
  codecs: GodotPackedArrayCodecs | undefined,
): PackedByteArray {
  const result = codecs?.compress(Math.trunc(mode), bytes(value));
  if (result === null || result === undefined) {
    console.error(`godot-compat: compression mode ${mode} is unavailable.`);
    return packedByteArray();
  }
  // zlib writes the host OS byte in a gzip header; the pinned official macOS build writes 19.
  if (Math.trunc(mode) === GODOT_COMPRESSION_GZIP && result.length > 9) result[9] = 19;
  return packedByteArray(result);
}

export function packedByteDecompress(
  value: PackedByteArray,
  expectedSize: number,
  mode: number,
  codecs: GodotPackedArrayCodecs | undefined,
  maxOutputSize?: number,
): PackedByteArray {
  const result = codecs?.decompress(
    Math.trunc(mode),
    bytes(value),
    Math.trunc(expectedSize),
    maxOutputSize,
  );
  if (result === null || result === undefined) {
    console.error(`godot-compat: decompression mode ${mode} failed.`);
    return packedByteArray();
  }
  return packedByteArray(result);
}

/** Exact Godot 4.7 PackedByteArray method dispatch, kept separate from the common container path. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: mirrors the official ClassDB inventory one-for-one.
export function godotPackedByteBinaryCall<T = unknown>(
  method: string,
  value: PackedByteArray,
  args: readonly unknown[],
  codecs?: GodotPackedArrayCodecs,
): T {
  let result: unknown;
  const offset = Number(args[0] ?? 0);
  switch (method) {
    case 'get_string_from_ascii':
      result = packedByteString(value, 'ascii');
      break;
    case 'get_string_from_utf8':
      result = packedByteString(value, 'utf8');
      break;
    case 'get_string_from_utf16':
      result = packedByteString(value, 'utf16');
      break;
    case 'get_string_from_utf32':
      result = packedByteString(value, 'utf32');
      break;
    case 'get_string_from_wchar':
      result = packedByteString(value, 'wchar');
      break;
    case 'get_string_from_multibyte_char':
      result = packedByteString(value, String(args[0] ?? ''));
      break;
    case 'hex_encode':
      result = packedByteHexEncode(value);
      break;
    case 'compress':
      result = packedByteCompress(value, Number(args[0] ?? 0), codecs);
      break;
    case 'decompress':
      result = packedByteDecompress(value, Number(args[0]), Number(args[1] ?? 0), codecs);
      break;
    case 'decompress_dynamic':
      result = packedByteDecompress(value, -1, Number(args[1] ?? 0), codecs, Number(args[0]));
      break;
    case 'decode_u8':
      result = packedByteDecodeInteger(value, offset, 8, false);
      break;
    case 'decode_s8':
      result = packedByteDecodeInteger(value, offset, 8, true);
      break;
    case 'decode_u16':
      result = packedByteDecodeInteger(value, offset, 16, false);
      break;
    case 'decode_s16':
      result = packedByteDecodeInteger(value, offset, 16, true);
      break;
    case 'decode_u32':
      result = packedByteDecodeInteger(value, offset, 32, false);
      break;
    case 'decode_s32':
      result = packedByteDecodeInteger(value, offset, 32, true);
      break;
    case 'decode_u64':
      result = packedByteDecodeInteger(value, offset, 64, false);
      break;
    case 'decode_s64':
      result = packedByteDecodeInteger(value, offset, 64, true);
      break;
    case 'decode_half':
      result = packedByteDecodeFloat(value, offset, 'half');
      break;
    case 'decode_float':
      result = packedByteDecodeFloat(value, offset, 'float');
      break;
    case 'decode_double':
      result = packedByteDecodeFloat(value, offset, 'double');
      break;
    case 'to_int32_array':
      result = packedByteToArray(value, 'int32');
      break;
    case 'to_int64_array':
      result = packedByteToArray(value, 'int64');
      break;
    case 'to_float32_array':
      result = packedByteToArray(value, 'float32');
      break;
    case 'to_float64_array':
      result = packedByteToArray(value, 'float64');
      break;
    case 'to_vector2_array':
      result = packedByteToArray(value, 'vector2');
      break;
    case 'to_vector3_array':
      result = packedByteToArray(value, 'vector3');
      break;
    case 'to_vector4_array':
      result = packedByteToArray(value, 'vector4');
      break;
    case 'to_color_array':
      result = packedByteToArray(value, 'color');
      break;
    case 'bswap16':
      result = packedByteSwap(value, 2, offset, Number(args[1] ?? -1));
      break;
    case 'bswap32':
      result = packedByteSwap(value, 4, offset, Number(args[1] ?? -1));
      break;
    case 'bswap64':
      result = packedByteSwap(value, 8, offset, Number(args[1] ?? -1));
      break;
    case 'encode_u8':
      result = packedByteEncodeInteger(value, offset, args[1] as GodotInt64, 8, false);
      break;
    case 'encode_s8':
      result = packedByteEncodeInteger(value, offset, args[1] as GodotInt64, 8, true);
      break;
    case 'encode_u16':
      result = packedByteEncodeInteger(value, offset, args[1] as GodotInt64, 16, false);
      break;
    case 'encode_s16':
      result = packedByteEncodeInteger(value, offset, args[1] as GodotInt64, 16, true);
      break;
    case 'encode_u32':
      result = packedByteEncodeInteger(value, offset, args[1] as GodotInt64, 32, false);
      break;
    case 'encode_s32':
      result = packedByteEncodeInteger(value, offset, args[1] as GodotInt64, 32, true);
      break;
    case 'encode_u64':
      result = packedByteEncodeInteger(value, offset, args[1] as GodotInt64, 64, false);
      break;
    case 'encode_s64':
      result = packedByteEncodeInteger(value, offset, args[1] as GodotInt64, 64, true);
      break;
    case 'encode_half':
      result = packedByteEncodeFloat(value, offset, Number(args[1]), 'half');
      break;
    case 'encode_float':
      result = packedByteEncodeFloat(value, offset, Number(args[1]), 'float');
      break;
    case 'encode_double':
      result = packedByteEncodeFloat(value, offset, Number(args[1]), 'double');
      break;
    default:
      throw new Error(`godot-compat: unsupported PackedByteArray.${method}`);
  }
  return result as T;
}
