/**
 * @godot-class Variant
 * @role PROTOCOL
 *
 * `v[k]` and `v[k] = e` where analysis leaves `v` untyped (`OPCODE_GET_KEYED` / `OPCODE_SET_KEYED`,
 * `modules/gdscript/gdscript_vm.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`), keyed
 * by the kind of value `v` holds at run time: an Array by an int index (a negative one counting
 * from the end), a Dictionary by its key (compat's `Map`, as `dictionary.ts` holds it), a String by
 * an int index. As a release build does, a read that finds nothing gives null and a store that
 * cannot land is dropped (only a debug build reports them, gdscript_vm.cpp:1002, :1120). Indexing
 * any other value (an Object's property by name, a vector's member) is not transcribed and throws
 * by name.
 */

function describe(value: unknown): string {
  return value === null || value === undefined ? 'null' : Array.isArray(value) ? 'Array' : typeof value === 'object' ? (value.constructor?.name ?? 'object') : typeof value;
}

/** An int index into a sequence of `length`, counted from the end when negative; undefined when out of range. */
function place(key: unknown, length: number): number | undefined {
  if (typeof key !== 'number' || !Number.isInteger(key)) return undefined;
  const at = key < 0 ? length + key : key;
  return at >= 0 && at < length ? at : undefined;
}

/**
 * `base[key]` on an untyped base (`Variant::get`, core/variant/variant_setget.cpp).
 *
 * @godot Variant (protocol)
 * @source modules/gdscript/gdscript_vm.cpp:1104
 */
export function godot_variant_get(base: unknown, key: unknown): unknown {
  if (Array.isArray(base)) {
    const at = place(key, base.length);
    return at === undefined ? null : base[at];
  }
  if (base instanceof Map) return base.has(key) ? base.get(key) : null;
  if (typeof base === 'string') {
    const at = place(key, base.length);
    return at === undefined ? null : base[at];
  }
  throw new TypeError(`godot-compat: indexing an untyped ${describe(base)} value is not transcribed`);
}

/**
 * `base[key] = value` on an untyped base (`Variant::set`, core/variant/variant_setget.cpp); gives
 * the value, as an assignment expression does.
 *
 * @godot Variant (protocol)
 * @source modules/gdscript/gdscript_vm.cpp:988
 */
export function godot_variant_set<T>(base: unknown, key: unknown, value: T): T {
  if (Array.isArray(base) && !Object.isFrozen(base)) {
    const at = place(key, base.length);
    if (at !== undefined) base[at] = value;
    return value;
  }
  if (base instanceof Map) {
    base.set(key, value);
    return value;
  }
  throw new TypeError(`godot-compat: a store into an untyped ${describe(base)} value is not transcribed`);
}
