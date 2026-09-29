/**
 * @godot-class Array
 * @role PROTOCOL
 *
 * Godot 4.7's `Array`, transcribed from `core/variant/array.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A Godot Array is a shared reference to one element
 * vector (`Array(const Array &)` references the same data, `core/variant/array.cpp:952`), so its
 * representation is a JS array mutated in place. Typed and read-only arrays
 * (`ArrayPrivate::typed`, `read_only`) are not transcribed: their checks never run here.
 */

import { godot_variant_equal } from './variant-equal';

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:203-204`): no arguments, and
 * `from: Array`, which references the same array. The `from: Packed*Array` conversions and the
 * typed-array constructor are not transcribed.
 *
 * @godot Array.Array
 * @source core/variant/array.cpp:952
 */
export function construct<Element = unknown>(...args: readonly [] | readonly [Element[]]): Element[] {
  if (args.length === 0) return [];
  return args[0];
}

/**
 * `append` is `push_back` (`core/variant/array.h:122`), which adds the element at the end.
 *
 * @godot Array.append
 * @source core/variant/array.cpp:282
 */
export function append(self: unknown[], p_value: unknown): void {
  self.push(p_value);
}

/**
 * @godot Array.clear
 * @source core/variant/array.cpp:124
 */
export function clear(self: unknown[]): void {
  self.length = 0;
}

/**
 * @godot Array.size
 * @source core/variant/array.cpp:116
 */
export function size(self: readonly unknown[]): number {
  return self.length;
}

/**
 * @godot Array.is_empty
 * @source core/variant/array.cpp:120
 */
export function is_empty(self: readonly unknown[]): boolean {
  return self.length === 0;
}

/**
 * Removes and returns the first element, or `null` when the array is empty.
 *
 * @godot Array.pop_front
 * @source core/variant/array.cpp:792
 */
export function pop_front(self: unknown[]): unknown {
  if (self.length === 0) return null;
  return self.shift();
}

/**
 * Whether the array holds the value: `find(value) != -1` (`core/variant/array.cpp:497`), whose
 * `StringLikeVariantComparator` (`core/variant/variant.cpp:3400`) agrees with JS `includes`
 * (SameValueZero) for objects, strings, bools, null and numbers of one Godot type.
 *
 * @godot Array.has
 * @source core/variant/array.cpp:497
 */
export function has(self: readonly unknown[], p_value: unknown): boolean {
  return self.includes(p_value);
}

/**
 * Removes the first element equal to the value, if any (`Vector::erase`,
 * `core/templates/vector.h:79`).
 *
 * @godot Array.erase
 * @source core/variant/array.cpp:347
 */
export function erase(self: unknown[], p_value: unknown): void {
  const index = self.indexOf(p_value);
  if (index >= 0) self.splice(index, 1);
}

/** An index counted from the end when negative; undefined when out of range. */
function at(self: readonly unknown[], index: number): number | undefined {
  const place = index < 0 ? self.length + index : index;
  return place >= 0 && place < self.length ? place : undefined;
}

/** A Variant's order, as `Array::sort` compares (`_ArrayVariantSort`, `Variant::operator<`). */
function less(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return a < b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return !a && b;
  return false;
}

/**
 * @godot Array.push_back
 * @source core/variant/array.cpp:326
 */
export function push_back(self: unknown[], value: unknown): void {
  self.push(value);
}

/**
 * @godot Array.push_front
 * @source core/variant/array.cpp:781
 */
export function push_front(self: unknown[], value: unknown): void {
  self.unshift(value);
}

/**
 * @godot Array.append_array
 * @source core/variant/array.cpp:330
 */
export function append_array(self: unknown[], array: readonly unknown[]): void {
  self.push(...array);
}

/**
 * Grows with nulls or shrinks to `size`; 0 (`OK`).
 *
 * @godot Array.resize
 * @source core/variant/array.cpp:336
 */
export function resize(self: unknown[], new_size: number): number {
  const previous = self.length;
  self.length = Math.max(0, Math.trunc(new_size));
  for (let index = previous; index < self.length; index += 1) self[index] = null;
  return 0;
}

/**
 * @godot Array.fill
 * @source core/variant/array.cpp:357
 */
export function fill(self: unknown[], value: unknown): void {
  self.fill(value);
}

/**
 * Inserts at `position` (from the end when negative); 0 (`OK`), or 31 (`ERR_INVALID_PARAMETER`).
 *
 * @godot Array.insert
 * @source core/variant/array.cpp:343
 */
export function insert(self: unknown[], position: number, value: unknown): number {
  const place = position < 0 ? self.length + position : position;
  if (place < 0 || place > self.length) return 31;
  self.splice(place, 0, value);
  return 0;
}

/**
 * @godot Array.remove_at
 * @source core/variant/array.cpp:352
 */
export function remove_at(self: unknown[], position: number): void {
  const place = at(self, position);
  if (place !== undefined) self.splice(place, 1);
}

/**
 * @godot Array.front
 * @source core/variant/array.cpp:369
 */
export function front(self: readonly unknown[]): unknown {
  return self.length === 0 ? null : self[0];
}

/**
 * @godot Array.back
 * @source core/variant/array.cpp:375
 */
export function back(self: readonly unknown[]): unknown {
  return self.length === 0 ? null : self[self.length - 1];
}

/**
 * @godot Array.pick_random
 * @source core/variant/array.cpp:381
 */
export function pick_random(self: readonly unknown[]): unknown {
  return self.length === 0 ? null : self[Math.floor(Math.random() * self.length)];
}

/**
 * @godot Array.find
 * @source core/variant/array.cpp:386
 */
export function find(self: readonly unknown[], what: unknown, from = 0): number {
  for (let index = from < 0 ? Math.max(0, self.length + from) : from; index < self.length; index += 1) if (godot_variant_equal(self[index], what)) return index;
  return -1;
}

/**
 * @godot Array.rfind
 * @source core/variant/array.cpp:430
 */
export function rfind(self: readonly unknown[], what: unknown, from = -1): number {
  for (let index = from < 0 ? self.length + from : Math.min(from, self.length - 1); index >= 0; index -= 1) if (godot_variant_equal(self[index], what)) return index;
  return -1;
}

/**
 * @godot Array.find_custom
 * @source core/variant/array.cpp:407
 */
export function find_custom(self: readonly unknown[], method: (value: unknown) => unknown, from = 0): number {
  for (let index = from; index < self.length; index += 1) if (method(self[index]) === true) return index;
  return -1;
}

/**
 * @godot Array.count
 * @source core/variant/array.cpp:482
 */
export function count(self: readonly unknown[], value: unknown): number {
  return self.filter((element) => godot_variant_equal(element, value)).length;
}

/**
 * @godot Array.pop_back
 * @source core/variant/array.cpp:786
 */
export function pop_back(self: unknown[]): unknown {
  return self.length === 0 ? null : self.pop();
}

/**
 * @godot Array.pop_at
 * @source core/variant/array.cpp:800
 */
export function pop_at(self: unknown[], position: number): unknown {
  const place = at(self, position);
  return place === undefined ? null : self.splice(place, 1)[0];
}

/**
 * @godot Array.reverse
 * @source core/variant/array.cpp:776
 */
export function reverse(self: unknown[]): void {
  self.reverse();
}

/**
 * @godot Array.shuffle
 * @source core/variant/array.cpp:753
 */
export function shuffle(self: unknown[]): void {
  for (let index = self.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [self[index], self[other]] = [self[other], self[index]];
  }
}

/**
 * @godot Array.sort
 * @source core/variant/array.cpp:733
 */
export function sort(self: unknown[]): void {
  self.sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0));
}

/**
 * @godot Array.sort_custom
 * @source core/variant/array.cpp:745
 */
export function sort_custom(self: unknown[], func: (a: unknown, b: unknown) => unknown): void {
  self.sort((a, b) => (func(a, b) === true ? -1 : func(b, a) === true ? 1 : 0));
}

/**
 * @godot Array.slice
 * @source core/variant/array.cpp:529
 */
export function slice(self: readonly unknown[], begin: number, end = 2147483647, step = 1, deep = false): unknown[] {
  void deep;
  const length = self.length;
  const from = begin < 0 ? Math.max(0, length + begin) : Math.min(begin, length);
  const to = end < 0 ? Math.max(0, length + end) : Math.min(end, length);
  const out: unknown[] = [];
  if (step > 0) for (let index = from; index < to; index += step) out.push(self[index]);
  else if (step < 0) for (let index = Math.min(from, length - 1); index > to; index += step) out.push(self[index]);
  return out;
}

/**
 * @godot Array.duplicate
 * @source core/variant/array.cpp:500
 */
export function duplicate(self: readonly unknown[], deep = false): unknown[] {
  return deep ? self.map((element) => (Array.isArray(element) ? duplicate(element, true) : element)) : [...self];
}

/**
 * @godot Array.filter
 * @source core/variant/array.cpp:576
 */
export function filter(self: readonly unknown[], method: (value: unknown) => unknown): unknown[] {
  return self.filter((element) => method(element) === true);
}

/**
 * @godot Array.map
 * @source core/variant/array.cpp:599
 */
export function map(self: readonly unknown[], method: (value: unknown) => unknown): unknown[] {
  return self.map((element) => method(element));
}

/**
 * @godot Array.reduce
 * @source core/variant/array.cpp:620
 */
export function reduce(self: readonly unknown[], method: (accum: unknown, value: unknown) => unknown, accum: unknown = null): unknown {
  let start = 0;
  let value = accum;
  if (accum === null && self.length > 0) {
    value = self[0];
    start = 1;
  }
  for (let index = start; index < self.length; index += 1) value = method(value, self[index]);
  return value;
}

/**
 * @godot Array.any
 * @source core/variant/array.cpp:645
 */
export function any(self: readonly unknown[], method: (value: unknown) => unknown): boolean {
  return self.some((element) => method(element) === true);
}

/**
 * @godot Array.all
 * @source core/variant/array.cpp:666
 */
export function all(self: readonly unknown[], method: (value: unknown) => unknown): boolean {
  return self.every((element) => method(element) === true);
}

/**
 * @godot Array.max
 * @source core/variant/array.cpp:822
 */
export function max(self: readonly unknown[]): unknown {
  if (self.length === 0) return null;
  return self.reduce((best, element) => (less(best, element) ? element : best));
}

/**
 * @godot Array.min
 * @source core/variant/array.cpp:844
 */
export function min(self: readonly unknown[]): unknown {
  if (self.length === 0) return null;
  return self.reduce((best, element) => (less(element, best) ? element : best));
}

/**
 * @godot Array.bsearch
 * @source core/variant/array.cpp:710
 */
export function bsearch(self: readonly unknown[], value: unknown, before = true): number {
  let low = 0;
  let high = self.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (before ? less(self[middle], value) : !less(value, self[middle])) low = middle + 1;
    else high = middle;
  }
  return low;
}
