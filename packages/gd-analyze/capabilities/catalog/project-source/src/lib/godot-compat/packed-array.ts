/**
 * Godot 4's ten Packed*Array Variant families.
 *
 * These are reference-visible containers backed by copy-on-write storage in Godot. Ordinary
 * GDScript assignment, parameter passing, return, and Array/Dictionary storage preserve the same
 * logical packed value; only `duplicate()` and the one-argument Packed*Array constructors create
 * an independent one. A plain JavaScript Array therefore has the correct alias behavior. Its
 * non-enumerable family tag lets this module apply Godot's element-copy, equality and ordering
 * rules while leaving it directly iterable and indexable.
 *
 * Semantic authority: pinned Godot 4.7 `core/variant/variant_call.cpp`'s packed-array registrations
 * and `core/templates/{vector,cowdata}.h`. The common-path observations are regenerated with the
 * exact official 4.7 binary by gd-analyze's packed-array native differential probe.
 *
 * Numeric Variant identity is explicit at this boundary: translated calls may wrap a statically
 * known INT or FLOAT with {@link godotPackedInt}/{@link godotPackedFloat}. Raw JavaScript numbers
 * remain accepted for project-authored calls and use the only sound fallback available to them —
 * integral numbers are INT, non-integral numbers are FLOAT. The tag matters at the int32/int64
 * overflow edge, where Godot wraps INT but saturates FLOAT.
 */

import type { GodotTransform2D as Transform2D } from './transform-2d';
import type { ColorValue } from './variant';
import type { Transform, Vector3 } from './variant-3d';
import type { Vector2 } from './vector2';

export interface Vector4Value {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export type PackedArrayKind =
  | 'byte'
  | 'int32'
  | 'int64'
  | 'float32'
  | 'float64'
  | 'string'
  | 'vector2'
  | 'vector3'
  | 'vector4'
  | 'color';

const PACKED_KIND: unique symbol = Symbol('godot-packed-array-kind');

const PACKED_NUMBER_KIND: unique symbol = Symbol('godot-packed-number-kind');

export interface GodotPackedNumber {
  readonly value: number | bigint;
  readonly [PACKED_NUMBER_KIND]: 'int' | 'float';
}

export const godotPackedInt = (value: number | bigint): GodotPackedNumber => ({
  value,
  [PACKED_NUMBER_KIND]: 'int',
});

export const godotPackedFloat = (value: number): GodotPackedNumber => ({
  value,
  [PACKED_NUMBER_KIND]: 'float',
});

export type PackedArrayValue<T> = T[] & {
  readonly [PACKED_KIND]: PackedArrayKind;
};

export type PackedByteArray = PackedArrayValue<number>;
export type PackedInt32Array = PackedArrayValue<number>;
/** JavaScript numbers carry every safe Godot int exactly; bigint carries the rest of int64. */
export type GodotInt64 = number | bigint;
export type PackedInt64Array = PackedArrayValue<GodotInt64>;
export type PackedFloat32Array = PackedArrayValue<number>;
export type PackedFloat64Array = PackedArrayValue<number>;
export type PackedStringArray = PackedArrayValue<string>;
export type PackedVector2Array = PackedArrayValue<Vector2>;
export type PackedVector3Array = PackedArrayValue<Vector3>;
export type PackedVector4Array = PackedArrayValue<Vector4Value>;
export type PackedColorArray = PackedArrayValue<ColorValue>;

interface ElementSpec<T> {
  readonly zero: () => T;
  readonly normalize: (value: unknown) => T;
  readonly normalizeConstructor?: (value: unknown) => T;
  readonly copy: (value: T) => T;
  readonly equal: (a: T, b: T) => boolean;
  /** Native contiguous-sequence equality; fundamental floats compare their stored bits. */
  readonly sequenceEqual?: (a: T, b: T) => boolean;
  readonly compare: (a: T, b: T) => number;
}

const scalarCompare = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);
const scalarEqual = (a: number, b: number): boolean => a === b;
const scalarCopy = (value: number): number => value;

function stringCompare(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const count = Math.min(left.length, right.length);
  for (let i = 0; i < count; i += 1) {
    const order = scalarCompare(left[i]?.codePointAt(0) ?? 0, right[i]?.codePointAt(0) ?? 0);
    if (order !== 0) return order;
  }
  return scalarCompare(left.length, right.length);
}

function byte(value: unknown): number {
  const integer = Math.trunc(Number(numericValue(value)));
  return ((integer % 256) + 256) % 256;
}

function int32(value: unknown): number {
  const tagged = numericInput(value);
  const number = Number(tagged.value);
  if (tagged.kind === 'float') {
    // The pinned native target's direct double -> int32_t conversion returns the architecture's
    // integer-indefinite value (INT32_MIN) for NaN and out-of-range input; it does not clamp.
    if (!Number.isFinite(number) || number < -0x8000_0000 || number > 0x7fff_ffff)
      return -0x8000_0000;
    return Math.trunc(number);
  }
  return Number(
    BigInt.asIntN(32, typeof tagged.value === 'bigint' ? tagged.value : BigInt(Math.trunc(number))),
  );
}

function int64(value: unknown): GodotInt64 {
  const tagged = numericInput(value);
  const number = Number(tagged.value);
  let integer: bigint;
  const maximum = 0x7fff_ffff_ffff_ffffn;
  const minimum = -0x8000_0000_0000_0000n;
  if (tagged.kind === 'float') {
    // Unlike the direct int32 path, Godot's typed int64 call conversion clamps finite doubles.
    if (Number.isNaN(number)) integer = 0n;
    else if (number >= Number(maximum)) integer = maximum;
    else if (number <= Number(minimum)) integer = minimum;
    else integer = BigInt(Math.trunc(number));
  } else {
    integer = BigInt.asIntN(
      64,
      typeof tagged.value === 'bigint' ? tagged.value : BigInt(Math.trunc(number)),
    );
  }
  const resultNumber = Number(integer);
  return Number.isSafeInteger(resultNumber) ? resultNumber : integer;
}

function int32Constructor(value: unknown): number {
  const tagged = numericInput(value);
  if (tagged.kind === 'int') return int32(value);
  const number = Number(tagged.value);
  if (Number.isNaN(number)) return 0;
  return Math.max(-0x8000_0000, Math.min(0x7fff_ffff, Math.trunc(number)));
}

function int64Constructor(value: unknown): GodotInt64 {
  const tagged = numericInput(value);
  if (tagged.kind === 'int') return int64(value);
  const number = Number(tagged.value);
  const maximum = 0x7fff_ffff_ffff_ffffn;
  const minimum = -0x8000_0000_0000_0000n;
  const integer = Number.isNaN(number)
    ? 0n
    : number >= Number(maximum)
      ? maximum
      : number <= Number(minimum)
        ? minimum
        : BigInt(Math.trunc(number));
  const resultNumber = Number(integer);
  return Number.isSafeInteger(resultNumber) ? resultNumber : integer;
}

function finiteNumber(value: unknown): number {
  return Number(numericValue(value));
}

function numericValue(value: unknown): number | bigint {
  return isGodotPackedNumber(value) ? value.value : (value as number | bigint);
}

function isGodotPackedNumber(value: unknown): value is GodotPackedNumber {
  return (
    typeof value === 'object' &&
    value !== null &&
    PACKED_NUMBER_KIND in value &&
    (value[PACKED_NUMBER_KIND] === 'int' || value[PACKED_NUMBER_KIND] === 'float')
  );
}

function numericInput(value: unknown): {
  readonly kind: 'int' | 'float';
  readonly value: number | bigint;
} {
  if (isGodotPackedNumber(value)) return { kind: value[PACKED_NUMBER_KIND], value: value.value };
  if (typeof value === 'bigint') return { kind: 'int', value };
  const number = Number(value);
  return { kind: Number.isInteger(number) ? 'int' : 'float', value: number };
}

const int64Compare = (a: GodotInt64, b: GodotInt64): number => {
  const left = typeof a === 'bigint' ? a : BigInt(a);
  const right = typeof b === 'bigint' ? b : BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
};
const int64Equal = (a: GodotInt64, b: GodotInt64): boolean => int64Compare(a, b) === 0;
const int64Copy = (value: GodotInt64): GodotInt64 => value;

function copyVector2(value: Vector2): Vector2 {
  return { x: value.x, y: value.y };
}

function copyVector3(value: Vector3): Vector3 {
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

function copyVector4(value: Vector4Value): Vector4Value {
  return Object.freeze({ x: value.x, y: value.y, z: value.z, w: value.w });
}

function copyColor(value: ColorValue): ColorValue {
  return Object.freeze({ r: value.r, g: value.g, b: value.b, a: value.a });
}

interface PackedElementByKind {
  readonly byte: number;
  readonly int32: number;
  readonly int64: GodotInt64;
  readonly float32: number;
  readonly float64: number;
  readonly string: string;
  readonly vector2: Vector2;
  readonly vector3: Vector3;
  readonly vector4: Vector4Value;
  readonly color: ColorValue;
}

const SPECS: { readonly [K in PackedArrayKind]: ElementSpec<PackedElementByKind[K]> } = {
  byte: {
    zero: () => 0,
    normalize: byte,
    copy: scalarCopy,
    equal: scalarEqual,
    compare: scalarCompare,
  },
  int32: {
    zero: () => 0,
    normalize: int32,
    normalizeConstructor: int32Constructor,
    copy: scalarCopy,
    equal: scalarEqual,
    compare: scalarCompare,
  },
  int64: {
    zero: () => 0,
    normalize: int64,
    normalizeConstructor: int64Constructor,
    copy: int64Copy,
    equal: int64Equal,
    compare: int64Compare,
  },
  float32: {
    zero: () => 0,
    normalize: (value) => Math.fround(finiteNumber(value)),
    copy: scalarCopy,
    equal: scalarEqual,
    sequenceEqual: Object.is,
    compare: scalarCompare,
  },
  float64: {
    zero: () => 0,
    normalize: finiteNumber,
    copy: scalarCopy,
    equal: scalarEqual,
    sequenceEqual: Object.is,
    compare: scalarCompare,
  },
  string: {
    zero: () => '',
    normalize: (value) => String(value),
    copy: (value) => value,
    equal: (a, b) => a === b,
    compare: stringCompare,
  },
  vector2: {
    zero: () => ({ x: 0, y: 0 }),
    normalize: (value) => copyVector2(value as Vector2),
    copy: copyVector2,
    equal: (a, b) => a.x === b.x && a.y === b.y,
    compare: (a, b) => scalarCompare(a.x, b.x) || scalarCompare(a.y, b.y),
  },
  vector3: {
    zero: () => copyVector3({ x: 0, y: 0, z: 0 }),
    normalize: (value) => copyVector3(value as Vector3),
    copy: copyVector3,
    equal: (a, b) => a.x === b.x && a.y === b.y && a.z === b.z,
    compare: (a, b) =>
      scalarCompare(a.x, b.x) || scalarCompare(a.y, b.y) || scalarCompare(a.z, b.z),
  },
  vector4: {
    zero: () => copyVector4({ x: 0, y: 0, z: 0, w: 0 }),
    normalize: (value) => copyVector4(value as Vector4Value),
    copy: copyVector4,
    equal: (a, b) => a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w,
    compare: (a, b) =>
      scalarCompare(a.x, b.x) ||
      scalarCompare(a.y, b.y) ||
      scalarCompare(a.z, b.z) ||
      scalarCompare(a.w, b.w),
  },
  color: {
    zero: () => copyColor({ r: 0, g: 0, b: 0, a: 1 }),
    normalize: (value) => copyColor(value as ColorValue),
    copy: copyColor,
    equal: (a, b) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a,
    compare: (a, b) =>
      scalarCompare(a.r, b.r) ||
      scalarCompare(a.g, b.g) ||
      scalarCompare(a.b, b.b) ||
      scalarCompare(a.a, b.a),
  },
};

function specOf<T>(array: PackedArrayValue<T>): ElementSpec<T> {
  return SPECS[array[PACKED_KIND]] as unknown as ElementSpec<T>;
}

export function packedArrayKind(array: PackedArrayValue<unknown>): PackedArrayKind {
  return array[PACKED_KIND];
}

/** Exact retained-carrier guard used by Variant runtime dispatch. */
export function isGodotPackedArray(value: unknown): value is PackedArrayValue<unknown> {
  return Array.isArray(value) && PACKED_KIND in value;
}

function create<T>(kind: PackedArrayKind, values: Iterable<unknown> = []): PackedArrayValue<T> {
  const spec = SPECS[kind] as unknown as ElementSpec<T>;
  const normalize = spec.normalizeConstructor ?? spec.normalize;
  const array = Array.from(values, (value) => normalize(value)) as PackedArrayValue<T>;
  Object.defineProperty(array, PACKED_KIND, { value: kind, enumerable: false });
  return array;
}

export const packedByteArray = (values: Iterable<unknown> = []): PackedArrayValue<number> =>
  create('byte', values);
export const packedInt32Array = (values: Iterable<unknown> = []): PackedArrayValue<number> =>
  create('int32', values);
export const packedInt64Array = (values: Iterable<unknown> = []): PackedArrayValue<GodotInt64> =>
  create('int64', values);
export const packedFloat32Array = (values: Iterable<unknown> = []): PackedArrayValue<number> =>
  create('float32', values);
export const packedFloat64Array = (values: Iterable<unknown> = []): PackedArrayValue<number> =>
  create('float64', values);
export const packedStringArray = (values: Iterable<unknown> = []): PackedArrayValue<string> =>
  create('string', values);
export const packedVector2Array = (values: Iterable<unknown> = []): PackedArrayValue<Vector2> =>
  create('vector2', values);
export const packedVector3Array = (values: Iterable<unknown> = []): PackedArrayValue<Vector3> =>
  create('vector3', values);
export const packedVector4Array = (
  values: Iterable<unknown> = [],
): PackedArrayValue<Vector4Value> => create('vector4', values);
export const packedColorArray = (values: Iterable<unknown> = []): PackedArrayValue<ColorValue> =>
  create('color', values);

function boundsError(member: string, index: number, size: number): void {
  console.error(
    `godot-compat: PackedArray.${member}: index ${index} is out of bounds (size ${size}).`,
  );
}

export function packedArrayGet<T>(array: PackedArrayValue<T>, index: number): T {
  const at = Math.trunc(index);
  const spec = specOf(array);
  if (at < 0 || at >= array.length) {
    boundsError('get', at, array.length);
    return spec.zero();
  }
  return spec.copy(array[at] as T);
}

/** Indexed `packed[i]` accepts `-size..-1`; the `.get(i)` method deliberately does not. */
export function packedArrayIndexGet<T>(array: PackedArrayValue<T>, index: number): T {
  let at = Math.trunc(index);
  if (at < 0) at += array.length;
  const spec = specOf(array);
  if (at < 0 || at >= array.length) {
    boundsError('indexed get', at, array.length);
    return spec.zero();
  }
  return spec.copy(array[at] as T);
}

export function packedArraySet<T>(array: PackedArrayValue<T>, index: number, value: unknown): void {
  const at = Math.trunc(index);
  if (at < 0 || at >= array.length) {
    boundsError('set', at, array.length);
    return;
  }
  array[at] = specOf(array).normalize(value);
}

export const packedArraySize = (array: readonly unknown[]): number => array.length;
export const packedArrayIsEmpty = (array: readonly unknown[]): boolean => array.length === 0;

/** Godot 3 PoolStringArray.join; Godot 4 moved the same operation to String.join. */
export function packedStringArrayJoin(array: PackedStringArray, delimiter: unknown): string {
  if (array[PACKED_KIND] !== 'string') {
    throw new TypeError('godot-compat: PoolStringArray.join requires a string packed array.');
  }
  if (typeof delimiter !== 'string') {
    throw new TypeError('godot-compat: PoolStringArray.join delimiter must be a String.');
  }
  return array.join(delimiter);
}

export function packedArrayAppend<T>(array: PackedArrayValue<T>, value: unknown): false {
  array.push(specOf(array).normalize(value));
  return false;
}

/** Godot 3 PoolStringArray.append mutates through the shared typed normalizer and returns void. */
export function poolStringArrayAppend(array: PackedStringArray, value: unknown): void {
  void packedArrayAppend(array, value);
}

export const packedArrayPushBack = packedArrayAppend;

export function packedArrayAppendArray<T>(
  array: PackedArrayValue<T>,
  other: PackedArrayValue<T>,
): void {
  if (array[PACKED_KIND] !== other[PACKED_KIND]) {
    throw new TypeError('godot-compat: append_array requires the same packed element family.');
  }
  const spec = specOf(array);
  const values = other === array ? [...other] : other;
  for (const value of values) array.push(spec.normalize(value));
}

export function packedArrayRemoveAt<T>(array: PackedArrayValue<T>, index: number): void {
  const at = Math.trunc(index);
  if (at < 0 || at >= array.length) {
    boundsError('remove_at', at, array.length);
    return;
  }
  array.splice(at, 1);
}

export function packedArrayInsert<T>(
  array: PackedArrayValue<T>,
  index: number,
  value: unknown,
): 0 | 31 {
  const at = Math.trunc(index);
  if (at < 0 || at > array.length) {
    boundsError('insert', at, array.length);
    return 31;
  }
  array.splice(at, 0, specOf(array).normalize(value));
  return 0;
}

export function packedArrayFill<T>(array: PackedArrayValue<T>, value: unknown): void {
  const spec = specOf(array);
  for (let i = 0; i < array.length; i += 1) array[i] = spec.normalize(value);
}

export function packedArrayResize<T>(array: PackedArrayValue<T>, size: number): 0 | 31 {
  const next = Math.trunc(size);
  if (next < 0) {
    console.error(`godot-compat: PackedArray.resize: size ${next} is negative.`);
    return 31;
  }
  if (next <= array.length) {
    array.length = next;
    return 0;
  }
  const spec = specOf(array);
  while (array.length < next) array.push(spec.zero());
  return 0;
}

export function packedArrayClear(array: unknown[]): void {
  array.length = 0;
}

export function packedArrayHas<T>(array: PackedArrayValue<T>, value: unknown): boolean {
  return packedArrayFind(array, value) !== -1;
}

export function packedArrayReverse(array: unknown[]): void {
  array.reverse();
}

function normalizedSliceIndex(index: number, size: number): number {
  const integer = Math.trunc(index);
  return Math.max(0, Math.min(size, integer < 0 ? integer + size : integer));
}

export function packedArraySlice<T>(
  array: PackedArrayValue<T>,
  begin: number,
  end = 0x7fffffff,
): PackedArrayValue<T> {
  const start = normalizedSliceIndex(begin, array.length);
  const stop = normalizedSliceIndex(end, array.length);
  if (start > stop) {
    console.error(
      `godot-compat: PackedArray.slice: begin ${Math.trunc(begin)} exceeds end ${Math.trunc(end)}.`,
    );
    return create(array[PACKED_KIND]);
  }
  return create(array[PACKED_KIND], array.slice(start, stop));
}

export function packedArraySort<T>(array: PackedArrayValue<T>): void {
  array.sort(specOf(array).compare);
}

export function packedArrayBsearch<T>(
  array: PackedArrayValue<T>,
  value: unknown,
  before = true,
): number {
  const spec = specOf(array);
  const needle = spec.normalize(value);
  let low = 0;
  let high = array.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const order = spec.compare(array[middle] as T, needle);
    if (order < 0 || (!before && order === 0)) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function packedArrayDuplicate<T>(array: PackedArrayValue<T>): PackedArrayValue<T> {
  return create(array[PACKED_KIND], array);
}

function packedArraySameKindEquals<T>(left: PackedArrayValue<T>, right: unknown): boolean {
  if (
    !Array.isArray(right) ||
    !(PACKED_KIND in right) ||
    left[PACKED_KIND] !== right[PACKED_KIND]
  ) {
    return false;
  }
  if (left.length !== right.length) return false;
  const spec = specOf(left);
  const equal = spec.sequenceEqual ?? spec.equal;
  for (let i = 0; i < left.length; i += 1) {
    if (!equal(left[i] as T, right[i] as T)) return false;
  }
  return true;
}

export function packedArrayEquals<T>(left: PackedArrayValue<T>, right: unknown): boolean {
  if (right === null) return false;
  if (
    !Array.isArray(right) ||
    !(PACKED_KIND in right) ||
    left[PACKED_KIND] !== right[PACKED_KIND]
  ) {
    throw new TypeError(
      `godot-compat: invalid operands for ${left[PACKED_KIND]} packed-array equality.`,
    );
  }
  return packedArraySameKindEquals(left, right);
}

export function packedArrayConcat<T>(
  left: PackedArrayValue<T>,
  right: PackedArrayValue<T>,
): PackedArrayValue<T> {
  if (left[PACKED_KIND] !== right[PACKED_KIND]) {
    throw new TypeError(
      'godot-compat: packed-array concatenation requires the same element family.',
    );
  }
  const result = packedArrayDuplicate(left);
  packedArrayAppendArray(result, right);
  return result;
}

/** `packed in Array|Dictionary`: the packed value is the needle, never the container. */
export function packedArrayIn<T>(
  value: PackedArrayValue<T>,
  container: readonly unknown[] | ReadonlyMap<unknown, unknown>,
): boolean {
  const candidates = container instanceof Map ? container.keys() : container;
  for (const candidate of candidates) {
    if (packedArraySameKindEquals(value, candidate)) return true;
  }
  return false;
}

export function packedArrayFind<T>(array: PackedArrayValue<T>, value: unknown, from = 0): number {
  const spec = specOf(array);
  const needle = spec.normalize(value);
  let start = Math.trunc(from);
  if (start < 0) start += array.length;
  if (start < 0 || start >= array.length) return -1;
  for (let i = start; i < array.length; i += 1) {
    if (spec.equal(array[i] as T, needle)) return i;
  }
  return -1;
}

export function packedArrayRfind<T>(array: PackedArrayValue<T>, value: unknown, from = -1): number {
  const spec = specOf(array);
  const needle = spec.normalize(value);
  let start = Math.trunc(from);
  if (start < 0) start += array.length;
  if (start < 0 || start >= array.length) return -1;
  for (let i = start; i >= 0; i -= 1) {
    if (spec.equal(array[i] as T, needle)) return i;
  }
  return -1;
}

export function packedArrayCount<T>(array: PackedArrayValue<T>, value: unknown): number {
  const spec = specOf(array);
  const needle = spec.normalize(value);
  let count = 0;
  for (const item of array) if (spec.equal(item, needle)) count += 1;
  return count;
}

export function packedArrayErase<T>(array: PackedArrayValue<T>, value: unknown): boolean {
  const index = packedArrayFind(array, value);
  if (index === -1) return false;
  array.splice(index, 1);
  return true;
}

/** PackedVector2Array * Transform2D / PackedVector3Array * Transform3D (`xform_inv`). */
export function packedArrayTransformInverse(
  value: PackedVector2Array,
  transform: Transform2D,
): PackedVector2Array;
export function packedArrayTransformInverse(
  value: PackedVector3Array,
  transform: Transform,
): PackedVector3Array;
export function packedArrayTransformInverse(
  value: PackedVector2Array | PackedVector3Array,
  transform: Transform2D | Transform,
): PackedVector2Array | PackedVector3Array {
  if (packedArrayKind(value) === 'vector2') {
    const t = transform as Transform2D;
    return packedVector2Array(
      (value as PackedVector2Array).map((point) => {
        const x = point.x - t.origin.x;
        const y = point.y - t.origin.y;
        return { x: t.x.x * x + t.x.y * y, y: t.y.x * x + t.y.y * y };
      }),
    );
  }
  const t = transform as Transform;
  return packedVector3Array(
    (value as PackedVector3Array).map((point) => {
      const x = point.x - t.origin.x;
      const y = point.y - t.origin.y;
      const z = point.z - t.origin.z;
      return {
        x: t.basis[0].x * x + t.basis[0].y * y + t.basis[0].z * z,
        y: t.basis[1].x * x + t.basis[1].y * y + t.basis[1].z * z,
        z: t.basis[2].x * x + t.basis[2].y * y + t.basis[2].z * z,
      };
    }),
  );
}

/** Exact common Godot 4.7 Packed*Array method protocol. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the official common ClassDB method inventory is intentionally one auditable dispatch.
export function godotPackedArrayCall<T = unknown>(
  method: string,
  array: PackedArrayValue<unknown>,
  args: readonly unknown[],
): T {
  let result: unknown;
  switch (method) {
    case 'get':
      result = packedArrayGet(array, Number(args[0]));
      break;
    case 'set':
      result = packedArraySet(array, Number(args[0]), args[1]);
      break;
    case 'size':
      result = packedArraySize(array);
      break;
    case 'is_empty':
    case 'empty':
      result = packedArrayIsEmpty(array);
      break;
    case 'join':
      result = packedStringArrayJoin(array as PackedStringArray, args[0]);
      break;
    case 'push_back':
    case 'append':
      result = packedArrayAppend(array, args[0]);
      break;
    case 'append_array':
      result = packedArrayAppendArray(array, args[0] as PackedArrayValue<unknown>);
      break;
    case 'remove_at':
      result = packedArrayRemoveAt(array, Number(args[0]));
      break;
    case 'insert':
      result = packedArrayInsert(array, Number(args[0]), args[1]);
      break;
    case 'fill':
      result = packedArrayFill(array, args[0]);
      break;
    case 'resize':
      result = packedArrayResize(array, Number(args[0]));
      break;
    case 'clear':
      result = packedArrayClear(array);
      break;
    case 'has':
      result = packedArrayHas(array, args[0]);
      break;
    case 'reverse':
      result = packedArrayReverse(array);
      break;
    case 'slice':
      result = packedArraySlice(array, Number(args[0]), Number(args[1] ?? 0x7fff_ffff));
      break;
    case 'sort':
      result = packedArraySort(array);
      break;
    case 'bsearch':
      result = packedArrayBsearch(array, args[0], Boolean(args[1] ?? true));
      break;
    case 'duplicate':
      result = packedArrayDuplicate(array);
      break;
    case 'find':
      result = packedArrayFind(array, args[0], Number(args[1] ?? 0));
      break;
    case 'rfind':
      result = packedArrayRfind(array, args[0], Number(args[1] ?? -1));
      break;
    case 'count':
      result = packedArrayCount(array, args[0]);
      break;
    case 'erase':
      result = packedArrayErase(array, args[0]);
      break;
    default:
      throw new Error(`godot-compat: unsupported Packed*Array.${method}`);
  }
  return result as T;
}
