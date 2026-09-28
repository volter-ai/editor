/**
 * @godot-class Variant
 * @role PROTOCOL
 *
 * `==` and `!=` where a script compares an untyped value (`Variant::evaluate` with `OP_EQUAL`,
 * `core/variant/variant_op.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). Lowering
 * compares typed values directly (`===`, compat's operators); only a value analysis leaves untyped
 * comes here, so the comparison is read from the JS values: values of different kinds are not
 * equal (Godot registers an always-false evaluator for most such pairs, and a release build reads
 * an unregistered pair's result, Nil, as false), an
 * int and a float compare as numbers, text as text, an Object by identity (a freed one equal to
 * null), an Array or Dictionary element by element (`Array::operator==`, `Dictionary::operator==`),
 * and a built-in record member by member.
 */

import { godot_object_equal } from './object';

function plainRecord(value: object): boolean {
  return Object.isFrozen(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * `a == b` on values whose types are known only at run time.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant_op.cpp:1041
 */
export function godot_variant_equal(a: unknown, b: unknown): boolean {
  const absent = (value: unknown) => value === null || value === undefined;
  if (absent(a) || absent(b)) return godot_object_equal(a, b);
  if (typeof a !== 'object' || typeof b !== 'object') return typeof a === typeof b && a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((element, index) => godot_variant_equal(element, b[index]));
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    for (const [key, value] of a) if (!b.has(key) || !godot_variant_equal(value, b.get(key))) return false;
    return true;
  }
  if (plainRecord(a) || plainRecord(b)) {
    if (!(plainRecord(a) && plainRecord(b))) return false;
    const left = Object.entries(a);
    const right = b as Record<string, unknown>;
    return left.length === Object.keys(right).length && left.every(([name, member]) => name in right && godot_variant_equal(member, right[name]));
  }
  return godot_object_equal(a, b);
}
