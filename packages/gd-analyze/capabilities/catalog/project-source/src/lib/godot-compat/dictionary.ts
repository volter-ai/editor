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
 * Typed dictionaries are not transcribed: every Dictionary here is untyped. A read-only
 * dictionary (`make_read_only`) is recorded in a module `WeakSet` keyed by the `Map`.
 */

import { godot_variant_equal } from './variant-equal';

/** The dictionaries `make_read_only` has frozen (`_p->read_only`, `core/variant/dictionary.cpp:599`). */
const readOnly = new WeakSet<ReadonlyMap<unknown, unknown>>();

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
 * Removes the key; returns whether it was present. A read-only dictionary is an error that returns
 * false.
 *
 * @godot Dictionary.erase
 * @source core/variant/dictionary.cpp:248
 */
export function erase(self: Map<unknown, unknown>, p_key: unknown): boolean {
  if (readOnly.has(self)) return false;
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

/**
 * The key's value, else `default` (null); a named read of a key the dictionary holds
 * (`Variant::get_named`, variant_setget.cpp:291) is this with the key's name.
 *
 * @godot Dictionary.get
 * @source core/variant/dictionary.cpp:178
 */
export function get(self: ReadonlyMap<unknown, unknown>, key: unknown, fallback: unknown = null): unknown {
  return self.has(key) ? self.get(key) : fallback;
}

/**
 * Stores the value under the key (`d[k] = v` is this, `Variant::set` keyed); returns true. A
 * read-only dictionary is an error that returns false.
 *
 * @godot Dictionary.set
 * @source core/variant/dictionary.cpp:202
 */
export function set(self: Map<unknown, unknown>, key: unknown, value: unknown): boolean {
  if (readOnly.has(self)) return false;
  self.set(key, value);
  return true;
}

/**
 * @godot Dictionary.size
 * @source core/variant/dictionary.cpp:212
 */
export function size(self: ReadonlyMap<unknown, unknown>): number {
  return self.size;
}

/**
 * Removes every entry; a read-only dictionary is an error that leaves it as it is.
 *
 * @godot Dictionary.clear
 * @source core/variant/dictionary.cpp:310
 */
export function clear(self: Map<unknown, unknown>): void {
  if (readOnly.has(self)) return;
  self.clear();
}

/**
 * Replaces the entries with a copy of the other dictionary's (the untyped-to-untyped case).
 *
 * @godot Dictionary.assign
 * @source core/variant/dictionary.cpp:426
 */
export function assign(self: Map<unknown, unknown>, p_dictionary: ReadonlyMap<unknown, unknown>): void {
  if (self === p_dictionary) return;
  const entries = [...p_dictionary];
  self.clear();
  for (const [key, value] of entries) self.set(key, value);
}

/** The code points of a string, for Godot's `String` ordering (`operator<`, `core/string/ustring.cpp`). */
function codePointLess(left: string, right: string): boolean {
  const a = Array.from(left, (c) => c.codePointAt(0) ?? 0);
  const b = Array.from(right, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return a.length < b.length;
}

/** `Variant::evaluate(OP_LESS, l, r)`, false where Godot has no evaluator (`_DictionaryVariantSort`). */
function variantLess(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return left < right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return !left && right;
  if (typeof left === 'string' && typeof right === 'string') return codePointLess(left, right);
  return false;
}

/**
 * The entries reordered by key with `OP_LESS` (numbers, bools and strings; keys of kinds with no
 * `<` compare as not less). A read-only dictionary is an error that leaves it as it is.
 *
 * @godot Dictionary.sort
 * @source core/variant/dictionary.cpp:327
 */
export function sort(self: Map<unknown, unknown>): void {
  if (readOnly.has(self)) return;
  const entries = [...self].sort(([a], [b]) => (variantLess(a, b) ? -1 : variantLess(b, a) ? 1 : 0));
  self.clear();
  for (const [key, value] of entries) self.set(key, value);
}

/**
 * Adds the other dictionary's entries; an existing key keeps its value unless `overwrite` (the
 * Variant default is false, `core/variant/variant_call.cpp:2643`).
 *
 * @godot Dictionary.merge
 * @source core/variant/dictionary.cpp:332
 */
export function merge(self: Map<unknown, unknown>, p_dictionary: ReadonlyMap<unknown, unknown>, p_overwrite = false): void {
  if (readOnly.has(self)) return;
  for (const [key, value] of [...p_dictionary]) {
    if (p_overwrite || !self.has(key)) self.set(key, value);
  }
}

/**
 * A shallow copy with the other dictionary merged in (the Variant default for `overwrite` is false,
 * `core/variant/variant_call.cpp:2644`).
 *
 * @godot Dictionary.merged
 * @source core/variant/dictionary.cpp:345
 */
export function merged(
  self: ReadonlyMap<unknown, unknown>,
  p_dictionary: ReadonlyMap<unknown, unknown>,
  p_overwrite = false,
): Map<unknown, unknown> {
  const ret = new Map(self);
  merge(ret, p_dictionary, p_overwrite);
  return ret;
}

/**
 * Whether every element of the Array is a key.
 *
 * @godot Dictionary.has_all
 * @source core/variant/dictionary.cpp:226
 */
export function has_all(self: ReadonlyMap<unknown, unknown>, p_keys: readonly unknown[]): boolean {
  return p_keys.every((key) => self.has(key));
}

/**
 * The first key (in insertion order) whose value equals `value` (`==`), else null.
 *
 * @godot Dictionary.find_key
 * @source core/variant/dictionary.cpp:237
 */
export function find_key(self: ReadonlyMap<unknown, unknown>, p_value: unknown): unknown {
  for (const [key, value] of self) if (godot_variant_equal(value, p_value)) return key;
  return null;
}

/** `hash_murmur3_one_32` (`core/templates/hashfuncs.h:112`), seed `HASH_MURMUR3_SEED` by default. */
function murmur32(input: number, seed = 0x7f07c65): number {
  let k = Math.imul(input >>> 0, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  let h = (seed ^ k) >>> 0;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) >>> 0;
}

/** `hash_fmix32` (`core/templates/hashfuncs.h:144`). */
function fmix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The IEEE bits of a double as two 32-bit words, low first; zero and NaN normalized. */
function doubleWords(value: number): readonly [number, number] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value === 0 ? 0 : Number.isNaN(value) ? Number.NaN : value, true);
  return [view.getUint32(0, true), view.getUint32(4, true)];
}

/** `hash_one_uint64` (`core/templates/hashfuncs.h:84`), Thomas Wang's 64-to-32 hash. */
function hashOneUint64(value: bigint): number {
  const mask = (1n << 64n) - 1n;
  let v = value & mask;
  v = (~v + (v << 18n)) & mask;
  v ^= v >> 31n;
  v = (v * 21n) & mask;
  v ^= v >> 11n;
  v = (v + (v << 6n)) & mask;
  v ^= v >> 22n;
  return Number(v & 0xffffffffn);
}

/** `String::hash` (`core/string/ustring.cpp:2755`): djb2 over the code points. */
function stringHash(text: string): number {
  let h = 5381;
  for (const character of text) h = (Math.imul(h, 33) + (character.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/** Identities for Objects, which Godot hashes by address. */
const objectIds = new WeakMap<object, bigint>();
let nextObjectId = 1n;

/**
 * `Variant::recursive_hash` (`core/variant/variant.cpp:2809`) of a value as this representation
 * holds it: an integer-valued number hashes as an int, any other as a float; a built-in record
 * hashes its numeric members in record order as floats; an Object hashes by an identity of its own.
 */
function variantHash(value: unknown, depth: number): number {
  if (depth > 100) return 0;
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return hashOneUint64(BigInt(value));
    const [low, high] = doubleWords(value);
    return murmur32(high, murmur32(low));
  }
  if (typeof value === 'string') return stringHash(value);
  if (Array.isArray(value)) {
    let h = murmur32(28);
    for (const element of value) h = murmur32(variantHash(element, depth + 1), h);
    return fmix32(h);
  }
  if (value instanceof Map) return dictionaryHash(value, depth);
  if (typeof value === 'object' && Object.isFrozen(value) && Object.getPrototypeOf(value) === Object.prototype) {
    let h = 0x7f07c65;
    const walk = (member: unknown): void => {
      if (typeof member === 'number') {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, member === 0 ? 0 : member, true);
        h = murmur32(view.getUint32(0, true), h);
      } else if (typeof member === 'object' && member !== null) {
        for (const inner of Object.values(member)) walk(inner);
      }
    };
    walk(value);
    return fmix32(h);
  }
  if (typeof value === 'object' || typeof value === 'function') {
    let id = objectIds.get(value);
    if (id === undefined) {
      id = nextObjectId;
      nextObjectId += 1n;
      objectIds.set(value, id);
    }
    return hashOneUint64(id);
  }
  return 0;
}

/** `Dictionary::recursive_hash` (`core/variant/dictionary.cpp:369`). */
function dictionaryHash(self: ReadonlyMap<unknown, unknown>, depth: number): number {
  if (depth > 100) return 0;
  let h = murmur32(27);
  for (const [key, value] of self) {
    h = murmur32(variantHash(key, depth + 1), h);
    h = murmur32(variantHash(value, depth + 1), h);
  }
  return fmix32(h);
}

/**
 * A 32-bit hash of the contents: equal dictionaries hash the same. It follows Godot's
 * `recursive_hash` for null, bools, numbers, strings, Arrays and Dictionaries; a built-in value's
 * members hash in this record's member order, and an Object by an identity assigned here.
 *
 * @godot Dictionary.hash
 * @source core/variant/dictionary.cpp:365
 */
export function hash(self: ReadonlyMap<unknown, unknown>): number {
  return dictionaryHash(self, 0);
}

/**
 * A new Array of the values in insertion order.
 *
 * @godot Dictionary.values
 * @source core/variant/dictionary.cpp:406
 */
export function values(self: ReadonlyMap<unknown, unknown>): unknown[] {
  return [...self.values()];
}

/** `Variant::recursive_duplicate` of a container element: Arrays and Dictionaries copied deeply. */
function duplicateValue(value: unknown, depth: number): unknown {
  if (depth > 100) return value;
  if (Array.isArray(value) && !Object.isFrozen(value)) return value.map((element) => duplicateValue(element, depth + 1));
  if (value instanceof Map) return duplicateMap(value, true, depth + 1);
  return value;
}

/** `Dictionary::recursive_duplicate` (`core/variant/dictionary.cpp:608`). */
function duplicateMap(self: ReadonlyMap<unknown, unknown>, deep: boolean, depth: number): Map<unknown, unknown> {
  const n = new Map<unknown, unknown>();
  for (const [key, value] of self) {
    n.set(deep ? duplicateValue(key, depth) : key, deep ? duplicateValue(value, depth) : value);
  }
  return n;
}

/**
 * A new dictionary with the same entries; with `deep` (the Variant default is false,
 * `core/variant/variant_call.cpp:2652`) nested Arrays and Dictionaries are copied too. The copy is
 * never read-only.
 *
 * @godot Dictionary.duplicate
 * @source core/variant/dictionary.cpp:591
 */
export function duplicate(self: ReadonlyMap<unknown, unknown>, p_deep = false): Map<unknown, unknown> {
  return duplicateMap(self, p_deep, 0);
}

/**
 * A deep copy: nested Arrays and Dictionaries copied. Resources inside stay shared, whatever
 * `deep_subresources_mode` asks (the Variant default is `RESOURCE_DEEP_DUPLICATE_INTERNAL`, 1): their
 * duplication is `Resource::duplicate`'s, which compat does not reach from here.
 *
 * @godot Dictionary.duplicate_deep
 * @source core/variant/dictionary.cpp:595
 */
export function duplicate_deep(self: ReadonlyMap<unknown, unknown>, p_deep_subresources_mode = 1): Map<unknown, unknown> {
  return duplicateMap(self, true, 0);
}

/**
 * The key's value; a missing key is added with `default` (the Variant default is null,
 * `core/variant/variant_call.cpp:2655`), which is returned.
 *
 * @godot Dictionary.get_or_add
 * @source core/variant/dictionary.cpp:189
 */
export function get_or_add(self: Map<unknown, unknown>, p_key: unknown, p_default: unknown = null): unknown {
  if (self.has(p_key)) return self.get(p_key);
  if (!readOnly.has(self)) self.set(p_key, p_default);
  return p_default;
}

/**
 * Every Dictionary here is untyped.
 *
 * @godot Dictionary.is_typed
 * @source core/variant/dictionary.cpp:666
 */
export function is_typed(self: ReadonlyMap<unknown, unknown>): boolean {
  return false;
}

/**
 * @godot Dictionary.is_typed_key
 * @source core/variant/dictionary.cpp:670
 */
export function is_typed_key(self: ReadonlyMap<unknown, unknown>): boolean {
  return false;
}

/**
 * @godot Dictionary.is_typed_value
 * @source core/variant/dictionary.cpp:674
 */
export function is_typed_value(self: ReadonlyMap<unknown, unknown>): boolean {
  return false;
}

/**
 * Two untyped dictionaries are the same typed.
 *
 * @godot Dictionary.is_same_typed
 * @source core/variant/dictionary.cpp:682
 */
export function is_same_typed(self: ReadonlyMap<unknown, unknown>, p_dictionary: ReadonlyMap<unknown, unknown>): boolean {
  return true;
}

/**
 * @godot Dictionary.is_same_typed_key
 * @source core/variant/dictionary.cpp:686
 */
export function is_same_typed_key(self: ReadonlyMap<unknown, unknown>, p_dictionary: ReadonlyMap<unknown, unknown>): boolean {
  return true;
}

/**
 * @godot Dictionary.is_same_typed_value
 * @source core/variant/dictionary.cpp:690
 */
export function is_same_typed_value(self: ReadonlyMap<unknown, unknown>, p_dictionary: ReadonlyMap<unknown, unknown>): boolean {
  return true;
}

/**
 * `TYPE_NIL` (0) for an untyped key.
 *
 * @godot Dictionary.get_typed_key_builtin
 * @source core/variant/dictionary.cpp:710
 */
export function get_typed_key_builtin(self: ReadonlyMap<unknown, unknown>): number {
  return 0;
}

/**
 * `TYPE_NIL` (0) for an untyped value.
 *
 * @godot Dictionary.get_typed_value_builtin
 * @source core/variant/dictionary.cpp:714
 */
export function get_typed_value_builtin(self: ReadonlyMap<unknown, unknown>): number {
  return 0;
}

/**
 * The empty StringName for an untyped key.
 *
 * @godot Dictionary.get_typed_key_class_name
 * @source core/variant/dictionary.cpp:718
 */
export function get_typed_key_class_name(self: ReadonlyMap<unknown, unknown>): string {
  return '';
}

/**
 * @godot Dictionary.get_typed_value_class_name
 * @source core/variant/dictionary.cpp:722
 */
export function get_typed_value_class_name(self: ReadonlyMap<unknown, unknown>): string {
  return '';
}

/**
 * Null for an untyped key.
 *
 * @godot Dictionary.get_typed_key_script
 * @source core/variant/dictionary.cpp:726
 */
export function get_typed_key_script(self: ReadonlyMap<unknown, unknown>): unknown {
  return null;
}

/**
 * @godot Dictionary.get_typed_value_script
 * @source core/variant/dictionary.cpp:730
 */
export function get_typed_value_script(self: ReadonlyMap<unknown, unknown>): unknown {
  return null;
}

/**
 * Makes the dictionary read-only: `set`, `erase`, `clear`, `merge`, `sort` and `get_or_add`'s insert
 * are refused from then on.
 *
 * @godot Dictionary.make_read_only
 * @source core/variant/dictionary.cpp:599
 */
export function make_read_only(self: Map<unknown, unknown>): void {
  readOnly.add(self);
}

/**
 * @godot Dictionary.is_read_only
 * @source core/variant/dictionary.cpp:604
 */
export function is_read_only(self: ReadonlyMap<unknown, unknown>): boolean {
  return readOnly.has(self);
}

/**
 * The same map, or the same size with every key present in the other and its value equal
 * (`hash_compare`, deep for Arrays and Dictionaries).
 *
 * @godot Dictionary.recursive_equal
 * @source core/variant/dictionary.cpp:263
 */
export function recursive_equal(self: ReadonlyMap<unknown, unknown>, p_dictionary: ReadonlyMap<unknown, unknown>, p_recursion_count = 0): boolean {
  return godot_variant_equal(self, p_dictionary);
}

/**
 * `recursive_equal`; against null (the `Variant` right operand) it is false
 * (`core/variant/variant_op.cpp:558`).
 *
 * @godot Dictionary.OP_EQUAL
 * @source core/variant/dictionary.cpp:255
 */
export function op_equal(left: ReadonlyMap<unknown, unknown>, right: ReadonlyMap<unknown, unknown> | null): boolean {
  return right !== null && godot_variant_equal(left, right);
}

/**
 * @godot Dictionary.OP_NOT_EQUAL
 * @source core/variant/dictionary.cpp:259
 */
export function op_not_equal(left: ReadonlyMap<unknown, unknown>, right: ReadonlyMap<unknown, unknown> | null): boolean {
  return !op_equal(left, right);
}

/**
 * `not d` is `d == Dictionary()`, which is `is_empty()`.
 *
 * @godot Dictionary.OP_NOT
 * @source core/variant/variant_op.cpp:909
 */
export function op_not(self: ReadonlyMap<unknown, unknown>): boolean {
  return self.size === 0;
}

/**
 * `d in array` is `array.find(d) != -1` (deep equality); `d in dict` is `dict.has(d)` with a
 * Dictionary key matched by content (`core/variant/variant_op.h:1180`).
 *
 * @godot Dictionary.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: ReadonlyMap<unknown, unknown>, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => godot_variant_equal(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (godot_variant_equal(key, left)) return true;
  return false;
}
