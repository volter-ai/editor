/**
 * @godot-class Object
 * @role PROTOCOL
 *
 * Godot 4.7's deferred calls and metadata (`core/object/object.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). A deferred call runs "later, after the current
 * work", which on the page is a microtask: it runs once the current frame's callbacks return, in
 * the order the calls were made. There is no queue of compat's own to flush.
 *
 * The receiver is a Godot object as compat represents it (a script instance, or a native entity).
 * A method or property named by string is the receiver's own JS member of that name: a script
 * instance's method or field. A native class's property or method named by string needs its
 * setter or member as a callable, which lowering supplies; it is not dispatched here.
 */

import { godot_node_entity, godot_node_is_freed, godot_node_is_queued, godot_node_object } from './node';
import { emitRetainedGodotSignal, godot_object_signal, isRetainedGodotSignal } from './signal';

/** Runs `run` after the current work, unless its target has been freed by then. */
function defer(target: object, run: () => void): void {
  queueMicrotask(() => {
    if (!godot_node_is_freed(target)) run();
  });
}

/**
 * Queues `self.method(...args)` for the next flush.
 *
 * @godot Object.call_deferred
 * @source core/object/object.cpp:632
 */
export function call_deferred(self: object, method: string, ...args: readonly unknown[]): void {
  defer(self, () => {
    const fn = (self as Record<string, unknown>)[method];
    if (typeof fn !== 'function') return;
    // A script error aborts only this call (docs/GODOT.md §Order of work).
    try {
      (fn as (...values: unknown[]) => unknown).apply(self, [...args]);
    } catch (error) {
      console.error(error);
    }
  });
}

/**
 * `self.property = value` by name: a script instance's field. A native class's property by name
 * needs its setter, and an AnimationTree's `parameters/…` its parameter protocol, which lowering
 * supplies (`treeParameterCall`); either fails by name here.
 *
 * @godot Object.set
 * @source core/object/object.cpp:335
 */
export function set(self: object, property: string, value: unknown): void {
  const name = String(property);
  const script = godot_node_object(godot_node_entity(self)) as Record<string, unknown>;
  if (name in script && typeof script[name] !== 'function') {
    script[name] = value;
    return;
  }
  throw new Error(`godot-compat: Object.set of the native property ${name} is not bound by name.`);
}

/**
 * `self.property` by name, as `set` finds it.
 *
 * @godot Object.get
 * @source core/object/object.cpp:418
 */
export function get(self: object, property: string): unknown {
  const name = String(property);
  const script = godot_node_object(godot_node_entity(self)) as Record<string, unknown>;
  if (name in script && typeof script[name] !== 'function') return script[name];
  throw new Error(`godot-compat: Object.get of the native property ${name} is not bound by name.`);
}

/**
 * Queues `self.property = value` for the next flush.
 *
 * @godot Object.set_deferred
 * @source core/object/object.cpp:2002
 */
export function set_deferred(self: object, property: string, value: unknown): void {
  defer(self, () => {
    (self as Record<string, unknown>)[property] = value;
  });
}

/**
 * A bound native call run later (`callable_mp(object, &Class::method).call_deferred()`,
 * `core/object/callable_mp.h`), as an engine class defers its own updates.
 *
 * @godot Object (protocol)
 * @source core/variant/callable.cpp:40
 */
export function godot_message_queue_push(target: object, run: () => void): void {
  defer(target, run);
}

/**
 * Set by `queue_free` (`SceneTree::queue_delete`, `scene/main/scene_tree.cpp:1640`).
 *
 * @godot Object.is_queued_for_deletion
 * @source core/object/object.h:813
 */
export function is_queued_for_deletion(self: object): boolean {
  return godot_node_is_queued(self);
}

/** Each object's metadata, in insertion order (`Object::metadata`, a `HashMap`). */
const META = new WeakMap<object, Map<string, unknown>>();

function metaOf(self: object): Map<string, unknown> {
  const owner = godot_node_entity(self);
  let meta = META.get(owner);
  if (meta === undefined) {
    meta = new Map();
    META.set(owner, meta);
  }
  return meta;
}

/**
 * A null value erases the entry; a new name must be an ASCII identifier.
 *
 * @godot Object.set_meta
 * @source core/object/object.cpp:1017
 */
export function set_meta(self: object, name: string, value: unknown): void {
  const meta = metaOf(self);
  if (value === null || value === undefined) {
    meta.delete(name);
    return;
  }
  if (!meta.has(name) && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) return;
  meta.set(name, value);
}

/**
 * A missing entry is `default`, or null (with Godot's error) when that is null.
 *
 * @godot Object.get_meta
 * @source core/object/object.cpp:1047
 */
export function get_meta(self: object, name: string, p_default: unknown = null): unknown {
  const meta = metaOf(self);
  if (!meta.has(name)) return p_default ?? null;
  return meta.get(name);
}

/**
 * @godot Object.has_meta
 * @source core/object/object.cpp:1013
 */
export function has_meta(self: object, name: string): boolean {
  return metaOf(self).has(name);
}

/**
 * @godot Object.remove_meta
 * @source core/object/object.cpp:1058
 */
export function remove_meta(self: object, name: string): void {
  set_meta(self, name, null);
}

/**
 * @godot Object.get_meta_list
 * @source core/object/object.cpp:1090
 */
export function get_meta_list(self: object): string[] {
  return [...metaOf(self).keys()];
}

/** An Object value as a Variant compares it: a freed Object reads as null (`Variant::get_validated_object`). */
function validated(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return typeof value === 'object' && godot_node_is_freed(value) ? null : value;
}

/**
 * `==` on Objects and null: identity, a freed Object equal to null and to any other freed Object
 * (`OperatorEvaluatorEqualObject` / `...EqualObjectNil`, core/variant/variant_op.h:470, :484).
 *
 * @godot Object (protocol)
 * @source core/variant/variant_op.h:470
 */
export function godot_object_equal(a: unknown, b: unknown): boolean {
  return validated(a) === validated(b);
}

/**
 * An Object's truth (`if obj:`, `not obj`): a live Object is true, null or a freed one false
 * (`Variant::booleanize`, `is_zero` for OBJECT, core/variant/variant.cpp:952).
 *
 * @godot Object (protocol)
 * @source core/variant/variant_op.cpp:1120
 */
export function godot_object_truthy(value: unknown): boolean {
  return validated(value) !== null;
}

/**
 * Whether the object's script chain declares the function: a script instance's own method (a
 * lowered GDScript function; the translation's `$`-named members are not functions of the script).
 * Translation calls this only for a name no engine class declares (`lower-official-expression.ts`),
 * where `ClassDB::has_method` is false for every object, so the script's answer is Godot's.
 *
 * @godot Object.has_method
 * @source core/object/object.cpp:655
 */
export function has_method(self: object, method: string): boolean {
  if (method === 'free') return true;
  if (method.startsWith('$')) return false;
  // The object's script instance, whether the call names the instance or its native entity (a
  // node a signal hands over is its entity); an entity with no script has no script functions.
  const entity = godot_node_entity(self);
  const script = godot_node_object(entity);
  if (script === entity) return false;
  let prototype: object | null = script;
  while (prototype !== null && prototype !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
    if (descriptor !== undefined && typeof descriptor.value === 'function' && method !== 'constructor') return true;
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return false;
}

/**
 * Emits the object's signal of that name: its script's (`signal hit`), else the engine signal its
 * object's map holds (`Object::emit_signalp`, `object.cpp:1274`); OK either way.
 *
 * @godot Object.emit_signal
 * @source core/object/object.cpp:1246
 */
export function emit_signal(self: object, signal: string, ...args: readonly unknown[]): number {
  const entity = godot_node_entity(self);
  const own = (godot_node_object(entity) as Record<string, unknown> | undefined)?.[String(signal)];
  if (isRetainedGodotSignal(own)) emitRetainedGodotSignal(own, args);
  else godot_object_signal(entity, String(signal)).emit(...args);
  return 0;
}
