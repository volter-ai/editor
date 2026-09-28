/**
 * @godot-class Variant
 * @role PROTOCOL
 *
 * The truth of an untyped value where a script tests it (`if v:`, `v and w`, `not v`): Godot's
 * `Variant::booleanize`, which is `!is_zero()` (`core/variant/variant.cpp:878`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). Lowering reads a typed value's truth directly
 * (`v !== 0`, `v.length > 0`); only a value analysis leaves untyped comes here, so its truth is
 * read from the JS value it is: null is false, a bool itself, a number or text when not zero or
 * empty, an Array or Dictionary when not empty, an Object while it lives, and a Vector2, Vector2i,
 * Vector3 or Vector3i record when any member is not 0. Any other built-in record (a Color or
 * Quaternion, whose zero construction is not all zeroes; a Rect2, Plane, Basis or transform, which
 * nest records) cannot be told apart here, and its truth throws by name.
 */

import { godot_object_truthy } from './object';

/**
 * `Variant::booleanize` of a value whose type is known only at run time.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.cpp:878
 */
export function godot_variant_truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  switch (typeof value) {
    case 'boolean':
      return value;
    case 'number':
      return value !== 0;
    case 'string':
      return value !== '';
    case 'function':
      // A Callable is a JS function, never null (`Callable::is_null`).
      return true;
    default:
      break;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Map) return value.size > 0;
  if (Object.isFrozen(value) && Object.getPrototypeOf(value) === Object.prototype) return vectorTruth(value);
  return godot_object_truthy(value);
}

/** The member names of the records whose zero construction is every member 0: a 2D or 3D vector. */
const VECTOR_MEMBERS: readonly string[] = ['x,y', 'x,y,z'];

/** `is_zero` of a Vector2, Vector2i, Vector3 or Vector3i record (`== Vector2()`, variant.cpp:896). */
function vectorTruth(record: object): boolean {
  const entries = Object.entries(record);
  const numeric = entries.every(([, member]) => typeof member === 'number');
  if (!numeric || !VECTOR_MEMBERS.includes(entries.map(([name]) => name).join(','))) {
    throw new TypeError(`godot-compat: the truth of a ${entries.map(([name]) => name).join(',')} value is not transcribed`);
  }
  return entries.some(([, member]) => member !== 0);
}

/**
 * `bool(value)`, as a typed bool place converts an untyped value into it (a bool return or
 * variable given an untyped value): Godot constructs a bool from a bool, int or float, as its truth
 * (`VariantConstructor<bool, int64_t>`, `<bool, double>`), which is what this gives for those.
 *
 * @godot bool.bool
 * @source core/variant/variant_construct.cpp:63
 */
export function construct_bool(value: unknown): boolean {
  return godot_variant_truthy(value);
}
