/**
 * @godot-class Variant
 * @role PROTOCOL
 *
 * `v.name`, `v.name = e` and `v.name(...)` where analysis leaves `v` untyped (`OPCODE_GET_NAMED`,
 * `OPCODE_SET_NAMED`, `OPCODE_CALL`, `modules/gdscript/gdscript_vm.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): Godot selects the member at run time from the value it
 * holds, and so does this. A script instance answers first with its own members (`Object::get` and
 * `Object::callp` ask the script instance before ClassDB); then the engine members the compiler
 * found by that name, each tried on the objects of its class (`is`) or the values of its built-in
 * type; a built-in record's own member, and a Dictionary's key, last. Nothing found is Godot's
 * error. The candidates are the call site's own, written by lowering from ClassDB: there is no
 * table of classes here.
 */

import { godot_is_native, godot_node_entity, godot_node_object } from './node';
import { isRetainedGodotSignal } from './signal';

/** An engine member of one class or built-in type that a name can select at run time. */
export interface GodotNamedMember {
  /** The engine class (`is`) the member is declared on. */
  readonly owner: string;
  /** For a built-in type's member: whether a value is of that type (`godot_variant_is_*`). */
  readonly is?: (value: unknown) => boolean;
  readonly get?: (self: never) => unknown;
  readonly set?: (self: never, value: never) => unknown;
  readonly call?: (self: never, ...args: never[]) => unknown;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && Object.isFrozen(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Whether a value is a built-in record with exactly these members (`x,y` for a Vector2), each a
 * number or, with `nested`, each a record (a Basis's vectors).
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.h:95
 */
export function godot_variant_is_record(value: unknown, members: string, nested = false): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const wanted = members.split(',');
  return keys.length === wanted.length && wanted.every((key) => Object.hasOwn(value, key) && (nested ? isRecord(value[key]) : typeof value[key] === 'number' || isRecord(value[key])));
}

/**
 * @godot Variant (protocol)
 * @source core/variant/variant.h:95
 */
export function godot_variant_is_array(value: unknown): boolean {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

/**
 * @godot Variant (protocol)
 * @source core/variant/variant.h:95
 */
export function godot_variant_is_dictionary(value: unknown): boolean {
  return value instanceof Map;
}

/**
 * @godot Variant (protocol)
 * @source core/variant/variant.h:95
 */
export function godot_variant_is_text(value: unknown): boolean {
  return typeof value === 'string';
}

/**
 * @godot Variant (protocol)
 * @source core/variant/variant.h:95
 */
export function godot_variant_is_number(value: unknown): boolean {
  return typeof value === 'number';
}

/**
 * @godot Variant (protocol)
 * @source core/variant/variant.h:95
 */
export function godot_variant_is_signal(value: unknown): boolean {
  return isRetainedGodotSignal(value);
}

/**
 * @godot Variant (protocol)
 * @source core/variant/variant.h:95
 */
export function godot_variant_is_callable(value: unknown): boolean {
  return typeof value === 'function';
}

/** The script instance of an object value, when a script is attached. */
function scriptOf(value: object): Record<string, unknown> | undefined {
  if (isRecord(value) || Array.isArray(value) || value instanceof Map || isRetainedGodotSignal(value)) return undefined;
  const owner = godot_node_object(godot_node_entity(value));
  return '$native' in owner ? (owner as Record<string, unknown>) : undefined;
}

function matches(value: unknown, member: GodotNamedMember): boolean {
  if (member.is !== undefined) return member.is(value);
  if (typeof value !== 'object' || value === null || isRecord(value) || Array.isArray(value) || value instanceof Map || isRetainedGodotSignal(value)) return false;
  try {
    return godot_is_native(value, member.owner);
  } catch {
    return false;
  }
}

function typeName(value: unknown): string {
  if (value === null || value === undefined) return 'Nil';
  if (Array.isArray(value)) return 'Array';
  if (value instanceof Map) return 'Dictionary';
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') return 'float';
  if (typeof value === 'boolean') return 'bool';
  return 'Object';
}

/**
 * `value.name` on an untyped value (`Variant::get_named`).
 *
 * @godot Variant (protocol)
 * @source modules/gdscript/gdscript_vm.cpp:1260
 */
export function godot_variant_get_named(value: unknown, name: string, members: readonly GodotNamedMember[]): unknown {
  if (typeof value === 'object' && value !== null) {
    const script = scriptOf(value);
    if (script !== undefined && name in script && typeof script[name] !== 'function') return script[name];
  }
  for (const member of members) {
    if (member.get !== undefined && matches(value, member)) {
      return (member.get as (self: unknown) => unknown)(member.is !== undefined ? value : godot_node_entity(value as object));
    }
  }
  if (isRecord(value) && Object.hasOwn(value, name)) return value[name];
  if (value instanceof Map) return value.has(name) ? value.get(name) : null;
  throw new Error(`Invalid access to property or key '${name}' on a base object of type '${typeName(value)}'.`);
}

/**
 * `value.name = v` on an untyped value (`Variant::set_named`): gives the value to store back where
 * `value` came from, which is `value` itself unless it is a built-in record, which a store copies.
 *
 * @godot Variant (protocol)
 * @source modules/gdscript/gdscript_vm.cpp:1138
 */
export function godot_variant_set_named<Value>(value: Value, name: string, assigned: unknown, members: readonly GodotNamedMember[]): Value {
  if (typeof value === 'object' && value !== null) {
    const script = scriptOf(value);
    if (script !== undefined && name in script && typeof script[name] !== 'function') {
      script[name] = assigned;
      return value;
    }
  }
  for (const member of members) {
    if (member.set !== undefined && matches(value, member)) {
      if (member.is !== undefined) return (member.set as (self: unknown, next: unknown) => Value)(value, assigned);
      (member.set as (self: unknown, next: unknown) => unknown)(godot_node_entity(value as object), assigned);
      return value;
    }
  }
  if (isRecord(value) && Object.hasOwn(value, name)) return Object.freeze({ ...value, [name]: assigned }) as Value;
  if (value instanceof Map) {
    value.set(name, assigned);
    return value;
  }
  throw new Error(`Invalid assignment of property or key '${name}' on a base object of type '${typeName(value)}'.`);
}

/**
 * `value.name(...)` on an untyped value (`Variant::callp`): a script's function first, then an
 * engine method of the value's class or built-in type.
 *
 * @godot Variant (protocol)
 * @source modules/gdscript/gdscript_vm.cpp:1903
 */
export function godot_variant_call_named(value: unknown, name: string, members: readonly GodotNamedMember[], args: readonly unknown[]): unknown {
  if (value === null || value === undefined) throw new Error(`Attempt to call function '${name}' in base 'null instance' on a null instance.`);
  if (typeof value === 'object') {
    const script = scriptOf(value);
    const method = script?.[name];
    if (typeof method === 'function') return (method as (...values: unknown[]) => unknown).apply(script, [...args]);
  }
  for (const member of members) {
    if (member.call !== undefined && matches(value, member)) {
      return (member.call as (self: unknown, ...values: unknown[]) => unknown)(member.is !== undefined ? value : godot_node_entity(value as object), ...args);
    }
  }
  // A Callable-valued member, called (`Callable::callp`).
  throw new Error(`Invalid call. Nonexistent function '${name}' in base '${typeName(value)}'.`);
}
