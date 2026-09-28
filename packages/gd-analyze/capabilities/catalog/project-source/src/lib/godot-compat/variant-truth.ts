/**
 * @godot-class Variant
 * @role PROTOCOL
 *
 * The truth of an untyped value where a script tests it (`if v:`, `v and w`, `not v`): Godot's
 * `Variant::booleanize`, which is `!is_zero()` (`core/variant/variant.cpp:878`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). Lowering reads a typed value's truth directly
 * (`v !== 0`, `v.length > 0`); only a value analysis leaves untyped comes here, so its truth is
 * read from the JS value it is: null is false, a bool itself, a number or text when not zero or
 * empty, an Array or Dictionary when not empty, an Object while it lives, and a built-in record
 * (a vector) when any member is not 0.
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
  if (Object.isFrozen(value) && Object.getPrototypeOf(value) === Object.prototype) {
    // A built-in value record: `Vector2()` and its kin are all zeroes.
    return Object.values(value).some((member) => member !== 0);
  }
  return godot_object_truthy(value);
}
