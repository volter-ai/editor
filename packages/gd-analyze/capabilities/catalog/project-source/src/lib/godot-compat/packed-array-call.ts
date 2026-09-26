/** Complete PackedByteArray call gate joining binary layout, codecs, and Variant marshaling. */

import { godotDecodeVariant, godotEncodeVariant } from './godot-variant-marshals';
import type { PackedByteArray } from './packed-array';
import { type GodotPackedArrayCodecs, godotPackedByteBinaryCall } from './packed-array-binary';

export function godotPackedByteArrayCall(
  method: 'compress' | 'decompress' | 'decompress_dynamic',
  value: PackedByteArray,
  args: readonly unknown[],
  codecs?: GodotPackedArrayCodecs,
): PackedByteArray;
export function godotPackedByteArrayCall<T = unknown>(
  method: string,
  value: PackedByteArray,
  args: readonly unknown[],
  codecs?: GodotPackedArrayCodecs,
): T;
export function godotPackedByteArrayCall<T = unknown>(
  method: string,
  value: PackedByteArray,
  args: readonly unknown[],
  codecs?: GodotPackedArrayCodecs,
): T {
  const offset = Math.trunc(Number(args[0] ?? 0));
  const allowObjects = Boolean(args[1] ?? false);
  if (method === 'has_encoded_var')
    return (godotDecodeVariant(value, offset, allowObjects) !== null) as T;
  if (method === 'decode_var')
    return (godotDecodeVariant(value, offset, allowObjects)?.value ?? null) as T;
  if (method === 'decode_var_size')
    return (godotDecodeVariant(value, offset, allowObjects)?.used ?? 0) as T;
  if (method === 'encode_var') {
    if (offset < 0) return -1 as T;
    let encoded: PackedByteArray;
    try {
      encoded = godotEncodeVariant(args[1], Boolean(args[2] ?? false));
    } catch {
      return -1 as T;
    }
    if (offset + encoded.length > value.length) return -1 as T;
    for (let index = 0; index < encoded.length; index += 1)
      value[offset + index] = encoded[index] as number;
    return encoded.length as T;
  }
  return godotPackedByteBinaryCall(method, value, args, codecs);
}
