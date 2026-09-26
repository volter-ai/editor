/**
 * @godot-class Dictionary
 * @role PROTOCOL
 *
 * Godot 4.7's `Dictionary`, transcribed from `core/variant/dictionary.cpp` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A Godot Dictionary is a shared reference
 * (`Dictionary(const Dictionary &)` references the same map, `core/variant/dictionary.cpp:760`) to
 * an insertion-ordered `HashMap<Variant, Variant>` (`core/variant/dictionary.cpp:46`); its
 * representation is a JS `Map`, which keeps insertion order and is mutated in place.
 *
 * Key equality is `StringLikeVariantComparator` (`core/variant/variant.cpp:3400`): `hash_compare`
 * of same-typed keys, and String equal to StringName. A JS `Map` compares keys by SameValueZero,
 * which agrees for String/StringName (both JS strings), bool, null, objects, and numbers of one
 * Godot type (float NaN equals NaN in both). It does NOT agree where Godot distinguishes an int key
 * from an equal float key (`hash_compare` rejects different types, `:3177`) or compares a
 * built-in value key (`Vector2`, ...) by value: those keys are outside this representation.
 * Typed and read-only dictionaries are not transcribed.
 */

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:199-200`): no arguments, and
 * `from: Dictionary`, which references the same map. The typed-dictionary constructor is not
 * transcribed.
 *
 * @godot Dictionary.Dictionary
 * @source core/variant/dictionary.cpp:760
 */
export function construct(...args: readonly [] | readonly [Map<unknown, unknown>]): Map<unknown, unknown> {
  if (args.length === 0) return new Map();
  return args[0];
}

/**
 * @godot Dictionary.is_empty
 * @source core/variant/dictionary.cpp:216
 */
export function is_empty(self: ReadonlyMap<unknown, unknown>): boolean {
  return self.size === 0;
}

/**
 * @godot Dictionary.has
 * @source core/variant/dictionary.cpp:220
 */
export function has(self: ReadonlyMap<unknown, unknown>, p_key: unknown): boolean {
  return self.has(p_key);
}

/**
 * Removes the key; returns whether it was present.
 *
 * @godot Dictionary.erase
 * @source core/variant/dictionary.cpp:248
 */
export function erase(self: Map<unknown, unknown>, p_key: unknown): boolean {
  return self.delete(p_key);
}

/**
 * A new Array of the keys in insertion order.
 *
 * @godot Dictionary.keys
 * @source core/variant/dictionary.cpp:386
 */
export function keys(self: ReadonlyMap<unknown, unknown>): unknown[] {
  return [...self.keys()];
}
