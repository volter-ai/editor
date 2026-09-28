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
