/**
 * @godot-class PackedStringArray
 * @role PROTOCOL
 *
 * Godot 4.7's `PackedStringArray` (`Vector<String>`, `core/variant/variant.h`), at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Unlike `Array` it is a copy-on-write VALUE: its
 * representation is a frozen JS array of strings, so a write produces a new array. The members
 * that write the array (`push_back`, `set`, `sort`, ...) therefore return the new array, which the
 * lowering assigns back to the variable as it does `with_indexed`; the value Godot returns from them
 * (a bool or an `Error`) is not returned.
 */

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:237-239`): no arguments and
 * `from: PackedStringArray` (a copy of the value). `from: Array`, which converts each element to
 * String, is not transcribed.
 *
 * @godot PackedStringArray.PackedStringArray
 * @source core/variant/variant_construct.cpp:238
 */
export function construct(...args: readonly [] | readonly [readonly string[]]): readonly string[] {
  if (args.length === 0) return Object.freeze([]);
  return Object.freeze([...args[0]]);
}

/**
 * `Vector<String>::size()` (`core/templates/vector.h`), bound at
 * `core/variant/variant_call.cpp:2944`.
 *
 * @godot PackedStringArray.size
 * @source core/variant/variant_call.cpp:2944
 */
export function size(self: readonly string[]): number {
  return self.length;
}

/**
 * `a[i] = value`: Variant's indexed set (`VariantIndexedSetGet_PackedStringArray::set`,
 * `INDEXED_SETGET_STRUCT_TYPED`, `core/variant/variant_setget.cpp:356`). A negative index counts
 * from the end; a store outside the array is dropped (the release build reports nothing). Godot
 * writes into the variable's own copy-on-write buffer, so the write is a new array assigned back.
 *
 * @godot PackedStringArray.set_indexed
 * @source core/variant/variant_setget.cpp:356
 */
export function with_indexed(self: readonly string[], index: number, value: string): readonly string[] {
  const place = index < 0 ? self.length + index : index;
  if (place < 0 || place >= self.length) return self;
  const copy = [...self];
  copy[place] = value;
  return Object.freeze(copy);
}

/** A new frozen array. */
function freeze(values: string[]): readonly string[] {
  return Object.freeze(values);
}

/** `String::operator<` (`core/string/ustring.cpp`): code point by code point, a prefix first. */
function stringLess(left: string, right: string): boolean {
  const a = Array.from(left, (c) => c.codePointAt(0) ?? 0);
  const b = Array.from(right, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return a.length < b.length;
}

/**
 * The element at `index`; an index outside the array is an error that returns "" (no negative
 * indexing, `VARCALL_ARRAY_GETTER_SETTER`).
 *
 * @godot PackedStringArray.get
 * @source core/variant/variant_call.cpp:661
 */
export function get(self: readonly string[], p_index: number): string {
  if (p_index < 0 || p_index >= self.length) return '';
  return self[p_index] ?? '';
}

/**
 * The array with the element at `index` replaced; an index outside the array is an error that
 * leaves it as it is.
 *
 * @godot PackedStringArray.set
 * @source core/variant/variant_call.cpp:665
 */
export function set(self: readonly string[], p_index: number, p_value: string): readonly string[] {
  if (p_index < 0 || p_index >= self.length) return self;
  const copy = [...self];
  copy[p_index] = p_value;
  return freeze(copy);
}

/**
 * @godot PackedStringArray.is_empty
 * @source core/templates/vector.h:99
 */
export function is_empty(self: readonly string[]): boolean {
  return self.length === 0;
}

/**
 * The array with the value appended.
 *
 * @godot PackedStringArray.push_back
 * @source core/templates/vector.h:74
 */
export function push_back(self: readonly string[], p_value: string): readonly string[] {
  return freeze([...self, p_value]);
}

/**
 * `push_back`'s alias.
 *
 * @godot PackedStringArray.append
 * @source core/templates/vector.h:75
 */
export function append(self: readonly string[], p_value: string): readonly string[] {
  return push_back(self, p_value);
}

/**
 * The array with the other's elements appended.
 *
 * @godot PackedStringArray.append_array
 * @source core/templates/vector.h:168
 */
export function append_array(self: readonly string[], p_array: readonly string[]): readonly string[] {
  return freeze([...self, ...p_array]);
}

/**
 * The array without the element at `index`; an index outside it is an error that leaves it as it is.
 *
 * @godot PackedStringArray.remove_at
 * @source core/templates/vector.h:78
 */
export function remove_at(self: readonly string[], p_index: number): readonly string[] {
  if (p_index < 0 || p_index >= self.length) return self;
  return freeze([...self.slice(0, p_index), ...self.slice(p_index + 1)]);
}

/**
 * The array with the value inserted before `at_index` (which may be the size); another index is an
 * error (`ERR_INVALID_PARAMETER`) that leaves it as it is.
 *
 * @godot PackedStringArray.insert
 * @source core/templates/vector.h:146
 */
export function insert(self: readonly string[], p_at_index: number, p_value: string): readonly string[] {
  if (p_at_index < 0 || p_at_index > self.length) return self;
  return freeze([...self.slice(0, p_at_index), p_value, ...self.slice(p_at_index)]);
}

/**
 * Every element replaced by the value.
 *
 * @godot PackedStringArray.fill
 * @source core/templates/vector.h:76
 */
export function fill(self: readonly string[], p_value: string): readonly string[] {
  return freeze(self.map(() => p_value));
}

/**
 * The array cut or grown to `new_size`, new elements `""` (`resize_initialized`,
 * `core/variant/variant_call.cpp:2952`); a negative size is an error that leaves it as it is.
 *
 * @godot PackedStringArray.resize
 * @source core/templates/vector.h:113
 */
export function resize(self: readonly string[], p_new_size: number): readonly string[] {
  if (p_new_size < 0) return self;
  const copy = self.slice(0, p_new_size);
  while (copy.length < p_new_size) copy.push('');
  return freeze(copy);
}

/**
 * The empty array.
 *
 * @godot PackedStringArray.clear
 * @source core/templates/vector.h:98
 */
export function clear(self: readonly string[]): readonly string[] {
  return freeze([]);
}

/**
 * @godot PackedStringArray.has
 * @source core/templates/vector.h:170
 */
export function has(self: readonly string[], p_value: string): boolean {
  return self.includes(p_value);
}

/**
 * The array in reverse order.
 *
 * @godot PackedStringArray.reverse
 * @source core/templates/vector.h:88
 */
export function reverse(self: readonly string[]): readonly string[] {
  return freeze([...self].reverse());
}

/**
 * Elements `begin` up to (not including) `end`, each clamped to the size and counted from the end
 * when negative; the Variant default for `end` is `INT_MAX` (`core/variant/variant_call.cpp:2956`).
 * A begin after the end is an error that returns the empty array.
 *
 * @godot PackedStringArray.slice
 * @source core/templates/vector.h:227
 */
export function slice(self: readonly string[], p_begin: number, p_end = 2147483647): readonly string[] {
  const s = self.length;
  const clamp = (v: number): number => (v < -s ? -s : v > s ? s : v);
  let begin = clamp(p_begin);
  if (begin < 0) begin += s;
  let end = clamp(p_end);
  if (end < 0) end += s;
  if (begin > end) return freeze([]);
  return freeze(self.slice(begin, end));
}

/**
 * Each string as UTF-8 followed by a zero byte, concatenated.
 *
 * @godot PackedStringArray.to_byte_array
 * @source core/variant/variant_call.cpp:1158
 */
export function to_byte_array(self: readonly string[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts = self.map((text) => encoder.encode(text));
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length + 1, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length + 1;
  }
  return out;
}

/**
 * The array sorted ascending by `String::operator<`.
 *
 * @godot PackedStringArray.sort
 * @source core/templates/vector.h:172
 */
export function sort(self: readonly string[]): readonly string[] {
  return freeze([...self].sort((a, b) => (stringLess(a, b) ? -1 : stringLess(b, a) ? 1 : 0)));
}

/**
 * The insertion index of `value` in a sorted array: before equal elements when `before` (the Variant
 * default is true, `core/variant/variant_call.cpp:2959`), after them otherwise (`Span::bisect`).
 *
 * @godot PackedStringArray.bsearch
 * @source core/templates/vector.h:188
 */
export function bsearch(self: readonly string[], p_value: string, p_before = true): number {
  let lo = 0;
  let hi = self.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const element = self[mid] ?? '';
    const goRight = p_before ? stringLess(element, p_value) : !stringLess(p_value, element);
    if (goRight) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A copy of the value (the same frozen array: it can never change).
 *
 * @godot PackedStringArray.duplicate
 * @source core/templates/vector.h:197
 */
export function duplicate(self: readonly string[]): readonly string[] {
  return self;
}

/**
 * The first index at or after `from` (counted from the end when negative; the Variant default is 0)
 * holding the value, else -1.
 *
 * @godot PackedStringArray.find
 * @source core/templates/vector.h:147
 */
export function find(self: readonly string[], p_value: string, p_from = 0): number {
  const from = p_from < 0 ? self.length + p_from : p_from;
  if (from < 0 || from >= self.length) return -1;
  return self.indexOf(p_value, from);
}

/**
 * The last index at or before `from` (counted from the end when negative; the Variant default is -1)
 * holding the value, else -1.
 *
 * @godot PackedStringArray.rfind
 * @source core/templates/vector.h:156
 */
export function rfind(self: readonly string[], p_value: string, p_from = -1): number {
  const from = p_from < 0 ? self.length + p_from : p_from;
  if (from < 0 || from >= self.length) return -1;
  return self.lastIndexOf(p_value, from);
}

/**
 * @godot PackedStringArray.count
 * @source core/templates/vector.h:165
 */
export function count(self: readonly string[], p_value: string): number {
  return self.filter((element) => element === p_value).length;
}

/**
 * The array without the first element equal to the value (unchanged when there is none).
 *
 * @godot PackedStringArray.erase
 * @source core/templates/vector.h:79
 */
export function erase(self: readonly string[], p_value: string): readonly string[] {
  const at = self.indexOf(p_value);
  return at < 0 ? self : remove_at(self, at);
}

/**
 * Element by element; against null (the `Variant` right operand) it is false
 * (`core/variant/variant_op.cpp:565`).
 *
 * @godot PackedStringArray.OP_EQUAL
 * @source core/templates/vector.h:255
 */
export function op_equal(left: readonly string[], right: readonly string[] | null): boolean {
  return right !== null && left.length === right.length && left.every((element, i) => element === right[i]);
}

/**
 * @godot PackedStringArray.OP_NOT_EQUAL
 * @source core/templates/vector.h:256
 */
export function op_not_equal(left: readonly string[], right: readonly string[] | null): boolean {
  return !op_equal(left, right);
}

/**
 * `not a` is `a == PackedStringArray()`, which is `is_empty()`.
 *
 * @godot PackedStringArray.OP_NOT
 * @source core/variant/variant_op.cpp:916
 */
export function op_not(self: readonly string[]): boolean {
  return self.length === 0;
}

/**
 * A new array of both arrays' elements (`OperatorEvaluatorAppendArray`,
 * `core/variant/variant_op.cpp:237`).
 *
 * @godot PackedStringArray.OP_ADD
 * @source core/variant/variant_op.cpp:237
 */
export function op_add(left: readonly string[], right: readonly string[]): readonly string[] {
  return freeze([...left, ...right]);
}

/** Whether an Array element or a Dictionary key is a PackedStringArray equal to this one. */
function isSameArray(value: unknown, a: readonly string[]): boolean {
  return Array.isArray(value) && op_equal(a, value as readonly string[]);
}

/**
 * `a in array` is `array.find(a) != -1`; `a in dict` is `dict.has(a)`
 * (`core/variant/variant_op.h:1180`). A PackedStringArray is matched by content.
 *
 * @godot PackedStringArray.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: readonly string[], right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isSameArray(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isSameArray(key, left)) return true;
  return false;
}
