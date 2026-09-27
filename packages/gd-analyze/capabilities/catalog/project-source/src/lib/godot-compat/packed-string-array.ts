/**
 * @godot-class PackedStringArray
 * @role PROTOCOL
 *
 * Godot 4.7's `PackedStringArray` (`Vector<String>`, `core/variant/variant.h`), at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Unlike `Array` it is a copy-on-write VALUE: its
 * representation is a frozen JS array of strings, so a write produces a new array.
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
