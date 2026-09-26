/** Godot 3.6 Pool*Array's common Variant container protocol. */

import {
  type PackedArrayValue,
  packedArrayAppend,
  packedArrayAppendArray,
  packedArrayClear,
  packedArrayCount,
  packedArrayFill,
  packedArrayFind,
  packedArrayGet,
  packedArrayHas,
  packedArrayInsert,
  packedArrayIsEmpty,
  packedArrayRemoveAt,
  packedArrayResize,
  packedArrayReverse,
  packedArrayRfind,
  packedArraySet,
  packedArraySize,
  packedArraySort,
} from './packed-array';

/** Exact common calls registered for every Godot 3.6 PoolVector specialization. */
export function godotPoolArrayCall<T = unknown>(
  method: string,
  value: PackedArrayValue<unknown>,
  args: readonly unknown[],
): T {
  let result: unknown;
  switch (method) {
    case 'append':
    case 'push_back':
      void packedArrayAppend(value, args[0]);
      result = undefined;
      break;
    case 'append_array':
      result = packedArrayAppendArray(value, args[0] as PackedArrayValue<unknown>);
      break;
    case 'clear':
      result = packedArrayClear(value);
      break;
    case 'count':
      result = packedArrayCount(value, args[0]);
      break;
    case 'empty':
      result = packedArrayIsEmpty(value);
      break;
    case 'fill':
      result = packedArrayFill(value, args[0]);
      break;
    case 'find':
      result = packedArrayFind(value, args[0], Number(args[1] ?? 0));
      break;
    case 'get':
      result = packedArrayGet(value, Number(args[0]));
      break;
    case 'has':
      result = packedArrayHas(value, args[0]);
      break;
    case 'insert':
      result = packedArrayInsert(value, Number(args[0]), args[1]);
      break;
    case 'invert':
      result = packedArrayReverse(value);
      break;
    case 'remove':
      result = packedArrayRemoveAt(value, Number(args[0]));
      break;
    case 'resize':
      void packedArrayResize(value, Number(args[0]));
      result = undefined;
      break;
    case 'rfind':
      result = packedArrayRfind(value, args[0], Number(args[1] ?? -1));
      break;
    case 'set':
      result = packedArraySet(value, Number(args[0]), args[1]);
      break;
    case 'size':
      result = packedArraySize(value);
      break;
    case 'sort':
      result = packedArraySort(value);
      break;
    default:
      throw new Error(`godot-compat: unsupported Pool*Array.${method}`);
  }
  return result as T;
}
