/** Godot 3.6 PoolByteArray's byte-specific Variant method surface. */

import { type PackedByteArray, packedByteArray } from './packed-array';
import {
  type GodotPackedArrayCodecs,
  packedByteCompress,
  packedByteDecompress,
  packedByteHexEncode,
  packedByteString,
} from './packed-array-binary';
import { godotPoolArrayCall } from './pool-array';

/**
 * Godot 3's `PoolVector<T>::subarray` accepts negative offsets relative to the end and includes
 * both endpoints. Unlike Godot 4 `Packed*Array.slice`, it does not clamp: either endpoint outside
 * the source or an inverted range reports an error and returns an empty same-family value.
 */
export function poolByteArraySubarray(
  value: PackedByteArray,
  from: number,
  to: number,
): PackedByteArray {
  if (value.length === 0) return packedByteArray();
  let start = Math.trunc(from);
  let end = Math.trunc(to);
  if (start < 0) start += value.length;
  if (end < 0) end += value.length;
  if (start < 0 || start >= value.length || end < 0 || end >= value.length || start > end) {
    console.error(
      `godot-compat: PoolByteArray.subarray range [${Math.trunc(from)}, ${Math.trunc(to)}] ` +
        `is invalid for size ${value.length}.`,
    );
    return packedByteArray();
  }
  return packedByteArray(value.slice(start, end + 1));
}

/** Godot 3 copies PoolByteArray bytes into a NUL-terminated CharString before String conversion. */
function poolByteArrayStringFromAscii(value: PackedByteArray): string {
  const end = value.indexOf(0);
  return String.fromCharCode(...(end === -1 ? value : value.slice(0, end)));
}

/**
 * Exact script-visible PoolByteArray calls from pinned Godot 3.6
 * `core/pool_vector.h`, `core/variant_call.cpp`, `core/ustring.cpp`, and
 * `core/io/compression.cpp`.
 */
export function godotPoolByteArrayCall<T = unknown>(
  method: string,
  value: PackedByteArray,
  args: readonly unknown[],
  codecs?: GodotPackedArrayCodecs,
): T {
  let result: unknown;
  switch (method) {
    case 'compress':
      result = packedByteCompress(value, Number(args[0] ?? 0), codecs);
      break;
    case 'decompress':
      result = packedByteDecompress(value, Number(args[0]), Number(args[1] ?? 0), codecs);
      break;
    case 'get_string_from_ascii':
      result = poolByteArrayStringFromAscii(value);
      break;
    case 'get_string_from_utf8':
      result = packedByteString(value, 'utf8');
      break;
    case 'hex_encode':
      result = packedByteHexEncode(value);
      break;
    case 'subarray':
      result = poolByteArraySubarray(value, Number(args[0]), Number(args[1]));
      break;
    default:
      return godotPoolArrayCall(method, value, args);
  }
  return result as T;
}
