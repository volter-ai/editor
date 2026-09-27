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

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:203-204`): no arguments, and
 * `from: Array`, which references the same array. The `from: Packed*Array` conversions and the
 * typed-array constructor are not transcribed.
 *
 * @godot Array.Array
 * @source core/variant/array.cpp:952
 */
export function construct(...args: readonly [] | readonly [unknown[]]): unknown[] {
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
