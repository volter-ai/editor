/** Godot 4.7 Array Variant protocol, ported from `core/variant/array.cpp`. */

import { GodotCallable, godotFuncRef } from './callable';
import { godotNumericVariantTag, godotNumericVariantValue } from './variant-number';

type Draw = () => number;

interface ArrayTypeMetadata {
  readonly builtin: number;
  readonly className: string;
  readonly script: unknown;
}

const ARRAY_TYPES = new WeakMap<readonly unknown[], ArrayTypeMetadata>();

function callable(value: unknown, ...args: readonly unknown[]): unknown {
  if (typeof value === 'function') return value(...args);
  if (typeof value === 'object' && value !== null) {
    const call = Reflect.get(value, 'call') as unknown;
    if (typeof call === 'function') return call.apply(value, args);
  }
  throw new Error('godot-compat: Array method requires a valid Callable');
}

function mutable(value: unknown[]): void {
  if (Object.isFrozen(value)) throw new Error('godot-compat: Array is in read-only state');
}

function equal(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  const leftNumber = godotNumericVariantValue(left);
  const rightNumber = godotNumericVariantValue(right);
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber === rightNumber;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    if (seen.get(left) === right) return true;
    seen.set(left, right);
    return left.every((entry, index) => equal(entry, right[index], seen));
  }
  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) return false;
    return [...left].every(([key, value]) =>
      [...right].some(
        ([otherKey, otherValue]) => equal(key, otherKey, seen) && equal(value, otherValue, seen),
      ),
    );
  }
  if (
    typeof left === 'object' &&
    left !== null &&
    typeof right === 'object' &&
    right !== null &&
    Object.getPrototypeOf(left) === Object.prototype &&
    Object.getPrototypeOf(right) === Object.prototype
  ) {
    if (seen.get(left) === right) return true;
    seen.set(left, right);
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.hasOwn(right, key) && equal(Reflect.get(left, key), Reflect.get(right, key), seen),
      )
    );
  }
  return false;
}

function typeOrder(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return 1;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    godotNumericVariantTag(value) !== undefined
  )
    return 2;
  if (typeof value === 'string') return 4;
  if (Array.isArray(value)) return 28;
  if (value instanceof Map) return 27;
  return 24;
}

function compare(left: unknown, right: unknown): number {
  if (equal(left, right)) return 0;
  const lt = typeOrder(left);
  const rt = typeOrder(right);
  if (lt !== rt) return lt < rt ? -1 : 1;
  if (lt === 0) return 0;
  if (typeof left === 'boolean' && typeof right === 'boolean') return left ? 1 : -1;
  const leftNumber = typeof left === 'bigint' ? left : godotNumericVariantValue(left);
  const rightNumber = typeof right === 'bigint' ? right : godotNumericVariantValue(right);
  if (leftNumber !== undefined && rightNumber !== undefined) {
    if (
      (typeof leftNumber === 'number' && Number.isNaN(leftNumber)) ||
      (typeof rightNumber === 'number' && Number.isNaN(rightNumber))
    ) {
      throw new TypeError('godot-compat: Array ordering refuses NaN without exact Variant tags.');
    }
    return leftNumber < rightNumber ? -1 : 1;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    const a = [...left];
    const b = [...right];
    const count = Math.min(a.length, b.length);
    for (let at = 0; at < count; at += 1) {
      const leftPoint = a[at]?.codePointAt(0) ?? 0;
      const rightPoint = b[at]?.codePointAt(0) ?? 0;
      if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    }
    return a.length < b.length ? -1 : 1;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const count = Math.min(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      const order = compare(left[index], right[index]);
      if (order !== 0) return order;
    }
    return left.length < right.length ? -1 : 1;
  }
  throw new TypeError(
    'godot-compat: Array ordering cannot compare opaque host values without exact Variant tags.',
  );
}

function duplicate(value: unknown, deep: boolean, seen = new WeakMap<object, unknown>()): unknown {
  if (!deep || value === null || typeof value !== 'object') return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    result.push(...value.map((entry) => duplicate(entry, true, seen)));
    const metadata = ARRAY_TYPES.get(value);
    if (metadata !== undefined) ARRAY_TYPES.set(result, metadata);
    return result;
  }
  if (value instanceof Map) {
    const result = new Map<unknown, unknown>();
    seen.set(value, result);
    for (const [key, entry] of value)
      result.set(duplicate(key, true, seen), duplicate(entry, true, seen));
    return result;
  }
  return value;
}

function binarySearch(
  array: readonly unknown[],
  value: unknown,
  before: boolean,
  less: (left: unknown, right: unknown) => boolean,
): number {
  let low = 0;
  let high = array.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const moveRight = before ? less(array[middle], value) : !less(value, array[middle]);
    if (moveRight) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Dialect-exact custom binary search over the retained native Array.
 *
 * Godot 3 takes the legacy `(value, object, method, before)` callable pair while Godot 4 takes a
 * retained `Callable`. Both forms reach the same source-ordered binary search only after their
 * complete public signature has been validated.
 */
export function godotArrayBsearchCustom(
  godotMajor: 3 | 4,
  receiver: unknown,
  args: readonly unknown[],
): number {
  if (!Array.isArray(receiver)) {
    throw new TypeError('godot-compat: Array.bsearch_custom requires an Array receiver.');
  }
  if (godotMajor === 4) {
    if (args.length < 2 || args.length > 3) {
      throw new TypeError('godot-compat: Godot 4 Array.bsearch_custom expects 2 or 3 arguments.');
    }
    if (!(args[1] instanceof GodotCallable)) {
      throw new TypeError(
        'godot-compat: Godot 4 Array.bsearch_custom requires a retained Callable.',
      );
    }
    if (args.length === 3 && typeof args[2] !== 'boolean') {
      throw new TypeError('godot-compat: Array.bsearch_custom before argument requires bool.');
    }
    return godotArrayCall('bsearch_custom', receiver, args) as number;
  }

  if (args.length < 3 || args.length > 4) {
    throw new TypeError('godot-compat: Godot 3 Array.bsearch_custom expects 3 or 4 arguments.');
  }
  if (
    (typeof args[1] !== 'object' && typeof args[1] !== 'function') ||
    args[1] === null ||
    typeof args[2] !== 'string' ||
    args[2].length === 0
  ) {
    throw new TypeError(
      'godot-compat: Godot 3 Array.bsearch_custom requires an Object and method String.',
    );
  }
  if (args.length === 4 && typeof args[3] !== 'boolean') {
    throw new TypeError('godot-compat: Array.bsearch_custom before argument requires bool.');
  }
  return godotArrayCall('bsearch_custom', receiver, [
    args[0],
    godotFuncRef(args[1], args[2]),
    args[3] ?? true,
  ]) as number;
}

function hashMix(value: number, seed: number): number {
  let k = Math.imul(value >>> 0, 0xcc9e2d51) >>> 0;
  k = ((k << 15) | (k >>> 17)) >>> 0;
  k = Math.imul(k, 0x1b873593) >>> 0;
  let hash = (seed ^ k) >>> 0;
  hash = ((hash << 13) | (hash >>> 19)) >>> 0;
  return (Math.imul(hash, 5) + 0xe6546b64) >>> 0;
}

const MURMUR_SEED = 0x07f07c65;

function hashInteger(value: number | bigint): number {
  let word = BigInt.asUintN(64, typeof value === 'bigint' ? value : BigInt(Math.trunc(value)));
  word = BigInt.asUintN(64, ~word + (word << 18n));
  word ^= word >> 31n;
  word = BigInt.asUintN(64, word * 21n);
  word ^= word >> 11n;
  word = BigInt.asUintN(64, word + (word << 6n));
  word ^= word >> 22n;
  return Number(word & 0xffff_ffffn);
}

function hashDouble(value: number, seed = MURMUR_SEED): number {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, Number.isNaN(value) ? Number.NaN : Object.is(value, -0) ? 0 : value, true);
  return hashMix(view.getUint32(4, true), hashMix(view.getUint32(0, true), seed));
}

function fmix(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function variantHash(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number')
    return Number.isInteger(value) ? hashInteger(value) : hashDouble(value);
  const retainedNumber = godotNumericVariantValue(value);
  const retainedTag = godotNumericVariantTag(value);
  if (retainedNumber !== undefined && retainedTag !== undefined) {
    return retainedTag === 'int' ? hashInteger(retainedNumber) : hashDouble(retainedNumber);
  }
  if (typeof value === 'bigint') return hashInteger(value);
  if (typeof value === 'string') {
    let hash = 5381;
    for (const char of value) hash = (Math.imul(hash, 33) + (char.codePointAt(0) ?? 0)) >>> 0;
    return hash;
  }
  if (Array.isArray(value)) return godotArrayHash(value);
  return 0;
}

export function godotArrayHash(array: readonly unknown[]): number {
  let hash = hashMix(28, MURMUR_SEED);
  for (const value of array) hash = hashMix(variantHash(value), hash);
  return fmix(hash);
}

export function godotArrayNew(...args: readonly unknown[]): unknown[] {
  if (args.length === 0) return [];
  const source = args[0];
  if (!Array.isArray(source))
    return source !== null && typeof source === 'object' && Symbol.iterator in source
      ? [...(source as Iterable<unknown>)]
      : [];
  if (args.length === 1) return source;
  const result: unknown[] = [];
  const builtin = Number(args[1] ?? 0);
  if (builtin !== 0) {
    ARRAY_TYPES.set(result, {
      builtin,
      className: String(args[2] ?? ''),
      script: args[3] ?? null,
    });
  }
  result.push(...source.map((entry) => convertTyped(result, entry)));
  return result;
}

function typedDefault(array: readonly unknown[]): unknown {
  switch (ARRAY_TYPES.get(array)?.builtin) {
    case 1:
      return false;
    case 2:
    case 3:
      return 0;
    case 4:
    case 21:
    case 22:
      return '';
    case 5:
    case 6:
      return { x: 0, y: 0 };
    case 9:
    case 10:
      return { x: 0, y: 0, z: 0 };
    case 12:
    case 13:
    case 15:
      return { x: 0, y: 0, z: 0, w: 0 };
    case 20:
      return { r: 0, g: 0, b: 0, a: 1 };
    case 27:
      return new Map();
    case 28:
      return [];
    default:
      return null;
  }
}

function convertTyped(array: readonly unknown[], value: unknown): unknown {
  const builtin = ARRAY_TYPES.get(array)?.builtin;
  switch (builtin) {
    case undefined:
      return value;
    case 1:
      if (typeof value === 'boolean' || typeof value === 'number') return Boolean(value);
      break;
    case 2:
      if (typeof value === 'number' || typeof value === 'boolean') return Math.trunc(Number(value));
      break;
    case 3:
      if (typeof value === 'number' || typeof value === 'boolean') return Number(value);
      break;
    case 4:
    case 21:
    case 22:
      if (typeof value === 'string') return value;
      break;
    case 24:
      if (value === null || typeof value === 'object') return value;
      break;
    case 27:
      if (value instanceof Map) return value;
      break;
    case 28:
      if (Array.isArray(value)) return value;
      break;
    default:
      if (typeof value === 'object' && value !== null) return value;
  }
  throw new Error(`godot-compat: value cannot be converted to typed Array builtin ${builtin}`);
}

function inheritType(source: readonly unknown[], result: unknown[]): unknown[] {
  const metadata = ARRAY_TYPES.get(source);
  if (metadata !== undefined) ARRAY_TYPES.set(result, metadata);
  return result;
}

export function godotArrayCall<T = unknown>(
  method: string,
  array: unknown[],
  args: readonly unknown[],
  random?: Draw,
): T;
export function godotArrayCall(
  method: string,
  array: unknown[],
  args: readonly unknown[],
  random?: Draw,
): unknown {
  const index = (at: number, fallback = 0): number => Math.trunc(Number(args[at] ?? fallback));
  switch (method) {
    case 'size':
      return array.length;
    case 'empty':
    case 'is_empty':
      return array.length === 0;
    case 'clear':
      mutable(array);
      array.length = 0;
      return null;
    case 'hash':
      return godotArrayHash(array);
    case 'assign':
      mutable(array);
      array.splice(
        0,
        array.length,
        ...((args[0] as unknown[]) ?? []).map((entry) => convertTyped(array, entry)),
      );
      return null;
    case 'get':
      return array[index(0)] ?? null;
    case 'set':
      mutable(array);
      if (index(0) >= 0 && index(0) < array.length) array[index(0)] = convertTyped(array, args[1]);
      return null;
    case 'push_back':
    case 'append':
      mutable(array);
      array.push(convertTyped(array, args[0]));
      return null;
    case 'push_front':
      mutable(array);
      array.unshift(convertTyped(array, args[0]));
      return null;
    case 'append_array':
      mutable(array);
      array.push(...((args[0] as unknown[]) ?? []).map((entry) => convertTyped(array, entry)));
      return null;
    case 'resize': {
      mutable(array);
      const size = index(0);
      if (size < 0) return 31;
      if (size < array.length) array.length = size;
      while (array.length < size) array.push(typedDefault(array));
      return 0;
    }
    case 'insert': {
      mutable(array);
      let position = index(0);
      if (position < 0) position += array.length;
      if (position < 0 || position > array.length) return 31;
      array.splice(position, 0, convertTyped(array, args[1]));
      return 0;
    }
    case 'remove_at':
      mutable(array);
      {
        let position = index(0);
        if (position < 0) position += array.length;
        if (position >= 0 && position < array.length) array.splice(position, 1);
      }
      return null;
    case 'remove': {
      mutable(array);
      const position = index(0);
      if (position < 0 || position >= array.length) {
        throw new RangeError(
          `Godot 3 Array.remove index ${position} is outside [0, ${array.length}).`,
        );
      }
      array.splice(position, 1);
      return null;
    }
    case 'fill':
      mutable(array);
      array.fill(convertTyped(array, args[0]));
      return null;
    case 'erase': {
      mutable(array);
      const value = convertTyped(array, args[0]);
      const found = array.findIndex((entry) => equal(entry, value));
      if (found >= 0) array.splice(found, 1);
      return null;
    }
    case 'front':
      return array[0] ?? null;
    case 'back':
      return array[array.length - 1] ?? null;
    case 'pick_random': {
      if (array.length === 0) return null;
      if (array.length === 1) return array[0];
      if (random === undefined) throw new Error('godot-compat: Array.pick_random needs ctx.random');
      return array[Math.floor(random() * 0x1_0000_0000) % array.length];
    }
    case 'find': {
      const from = index(1);
      if (from < 0) return -1;
      const value = convertTyped(array, args[0]);
      return array.findIndex((entry, at) => at >= from && equal(entry, value));
    }
    case 'find_custom': {
      const from = index(1);
      if (from < 0) return -1;
      for (let at = from; at < array.length; at += 1) if (callable(args[0], array[at])) return at;
      return -1;
    }
    case 'rfind': {
      let from = index(1, -1);
      if (from < 0) from += array.length;
      if (from < 0 || from >= array.length) from = array.length - 1;
      {
        const value = convertTyped(array, args[0]);
        for (let at = from; at >= 0; at -= 1) if (equal(array[at], value)) return at;
      }
      return -1;
    }
    case 'rfind_custom': {
      let from = index(1, -1);
      if (from < 0) from += array.length;
      if (from < 0 || from >= array.length) from = array.length - 1;
      for (let at = from; at >= 0; at -= 1) if (callable(args[0], array[at])) return at;
      return -1;
    }
    case 'count': {
      const value = convertTyped(array, args[0]);
      let total = 0;
      for (const entry of array) if (equal(entry, value)) total += 1;
      return total;
    }
    case 'has':
      return array.some((entry) => equal(entry, convertTyped(array, args[0])));
    case 'pop_back':
      mutable(array);
      return array.pop() ?? null;
    case 'pop_front':
      mutable(array);
      return array.shift() ?? null;
    case 'pop_at': {
      mutable(array);
      let position = index(0);
      if (position < 0) position += array.length;
      return position < 0 || position >= array.length ? null : array.splice(position, 1)[0];
    }
    case 'sort':
      mutable(array);
      array.sort(compare);
      return null;
    case 'sort_custom':
      mutable(array);
      array.sort((a, b) => (callable(args[0], a, b) ? -1 : callable(args[0], b, a) ? 1 : 0));
      return null;
    case 'shuffle': {
      mutable(array);
      if (array.length > 1 && random === undefined)
        throw new Error('godot-compat: Array.shuffle needs ctx.random');
      for (let at = array.length - 1; at >= 1; at -= 1) {
        const other = Math.floor((random?.() ?? 0) * 0x1_0000_0000) % (at + 1);
        [array[at], array[other]] = [array[other], array[at]];
      }
      return null;
    }
    case 'bsearch':
      return binarySearch(
        array,
        convertTyped(array, args[0]),
        Boolean(args[1] ?? true),
        (a, b) => compare(a, b) < 0,
      );
    case 'bsearch_custom':
      return binarySearch(array, convertTyped(array, args[0]), Boolean(args[2] ?? true), (a, b) =>
        Boolean(callable(args[1], a, b)),
      );
    case 'invert':
    case 'reverse':
      mutable(array);
      array.reverse();
      return null;
    case 'duplicate':
      return duplicate(array, Boolean(args[0] ?? false));
    case 'duplicate_deep':
      return duplicate(array, true);
    case 'slice': {
      const size = array.length;
      const sourceBegin = index(0);
      const sourceEnd = index(1, 0x7fffffff);
      const step = index(2, 1);
      const result = inheritType(array, []);
      if (
        step === 0 ||
        size === 0 ||
        (sourceBegin < -size && step < 0) ||
        (sourceBegin >= size && step > 0)
      )
        return result;
      let begin = Math.min(Math.max(sourceBegin, -size), size - 1);
      if (begin < 0) begin += size;
      let end = Math.min(Math.max(sourceEnd, -size - 1), size);
      if (end < 0) end += size;
      if ((step > 0 && begin > end) || (step < 0 && begin < end)) return result;
      const resultSize = Math.trunc((end - begin) / step) + ((end - begin) % step !== 0 ? 1 : 0);
      for (let offset = 0, at = begin; offset < resultSize; offset += 1, at += step)
        result.push(duplicate(array[at], Boolean(args[3])));
      return result;
    }
    case 'filter': {
      const result = array.filter((entry) => Boolean(callable(args[0], entry)));
      return inheritType(array, result);
    }
    case 'map':
      return array.map((entry) => callable(args[0], entry));
    case 'reduce': {
      let accumulator: unknown = args.length >= 2 ? args[1] : null;
      for (let at = 0; at < array.length; at += 1)
        accumulator = callable(args[0], accumulator, array[at]);
      return accumulator;
    }
    case 'any':
      return array.some((entry) => Boolean(callable(args[0], entry)));
    case 'all':
      return array.every((entry) => Boolean(callable(args[0], entry)));
    case 'max':
      return array.length === 0
        ? null
        : array.reduce((best, entry) => (compare(entry, best) > 0 ? entry : best));
    case 'min':
      return array.length === 0
        ? null
        : array.reduce((best, entry) => (compare(entry, best) < 0 ? entry : best));
    case 'is_typed':
      return ARRAY_TYPES.has(array);
    case 'is_same_typed': {
      const left = ARRAY_TYPES.get(array);
      const right = ARRAY_TYPES.get(args[0] as unknown[]);
      return left === undefined
        ? right === undefined
        : right !== undefined &&
            left.builtin === right.builtin &&
            left.className === right.className &&
            left.script === right.script;
    }
    case 'get_typed_builtin':
      return ARRAY_TYPES.get(array)?.builtin ?? 0;
    case 'get_typed_class_name':
      return ARRAY_TYPES.get(array)?.className ?? '';
    case 'get_typed_script':
      return ARRAY_TYPES.get(array)?.script ?? null;
    case 'make_read_only':
      Object.freeze(array);
      return null;
    case 'is_read_only':
      return Object.isFrozen(array);
    default:
      throw new Error(`godot-compat: unsupported Array.${method}`);
  }
}

export function godotArrayOperator<T = unknown>(
  operator: string,
  left: unknown[],
  right: unknown,
): T;
export function godotArrayOperator(operator: string, left: unknown[], right: unknown): unknown {
  switch (operator) {
    case '==':
      return Array.isArray(right) && equal(left, right);
    case '!=':
      return !Array.isArray(right) || !equal(left, right);
    case '+':
      return Array.isArray(right) ? [...left, ...right] : [...left];
    case '<':
      return Array.isArray(right) && compare(left, right) < 0;
    case '<=':
      return Array.isArray(right) && compare(left, right) <= 0;
    case '>':
      return Array.isArray(right) && compare(left, right) > 0;
    case '>=':
      return Array.isArray(right) && compare(left, right) >= 0;
    case 'in': {
      if (Array.isArray(right)) return right.some((entry) => equal(entry, left));
      if (right instanceof Map) return [...right.keys()].some((entry) => equal(entry, left));
      return false;
    }
    default:
      throw new Error(`godot-compat: unsupported Array operator ${operator}`);
  }
}

export const godotArrayNot = (value: readonly unknown[]): boolean => value.length === 0;
