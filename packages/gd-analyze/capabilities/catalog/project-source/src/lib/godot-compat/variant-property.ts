/** Dynamic dot-property access over retained Object identity and exact Variant carriers. */

import { godotObjectBindingOf, godotObjectHasBinding } from './object';
import { isRetainedGodotSignal } from './signal';

function carrierName(value: unknown): string {
  if (value === null) return 'Nil';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return typeof value;
  return value.constructor?.name ?? 'Object';
}

function invalidProperty(receiver: unknown, property: string, write: boolean): never {
  throw new TypeError(
    `godot-compat: Invalid ${write ? 'assignment to' : 'access to'} property or key ` +
      `'${property}' on a base object of type '${carrierName(receiver)}'.`,
  );
}

/**
 * Direct Variant property read. Retained ScriptInstance/ClassDB identity always gets first refusal;
 * Dictionary keys and finite structural Variant carriers keep their existing representation.
 */
export function godotOpenVariantPropertyGet<T = unknown>(receiver: unknown, property: string): T {
  if (godotObjectHasBinding(receiver)) {
    const binding = godotObjectBindingOf(receiver);
    if (binding.scriptMembers?.has(property) === true) {
      return Reflect.get(binding.value, property) as T;
    }
    const propertyRow = binding.dispatch.properties[property];
    const native = propertyRow === undefined ? binding.dispatch.signals[property] : propertyRow;
    if (native === undefined || native === null || native.get === undefined) {
      return invalidProperty(receiver, property, false);
    }
    return native.get(binding) as T;
  }
  if (receiver instanceof Map) return receiver.get(property) as T;
  if (typeof receiver === 'object' && receiver !== null && Object.hasOwn(receiver, property)) {
    return Reflect.get(receiver, property) as T;
  }
  return invalidProperty(receiver, property, false);
}

/**
 * Direct Variant property write through the same owner order as the read. Exact value carriers are
 * immutable in compat and remain on their existing whole-value emitter path; this door mutates only
 * retained Object properties, Dictionary keys, and already-present mutable structural slots.
 */
export function godotOpenVariantPropertySet(
  receiver: unknown,
  property: string,
  value: unknown,
): void {
  if (godotObjectHasBinding(receiver)) {
    const binding = godotObjectBindingOf(receiver);
    if (binding.scriptMembers?.has(property) === true) {
      if (isRetainedGodotSignal(Reflect.get(binding.value, property))) {
        return invalidProperty(receiver, property, true);
      }
      if (!Reflect.set(binding.value, property, value)) {
        return invalidProperty(receiver, property, true);
      }
      return;
    }
    if (binding.dispatch.signals[property] !== undefined) {
      return invalidProperty(receiver, property, true);
    }
    const native = binding.dispatch.properties[property];
    if (native === undefined || native === null || native.set === undefined) {
      return invalidProperty(receiver, property, true);
    }
    native.set(binding, value);
    return;
  }
  if (receiver instanceof Map) {
    receiver.set(property, value);
    return;
  }
  if (typeof receiver === 'object' && receiver !== null && Object.hasOwn(receiver, property)) {
    if (!Reflect.set(receiver, property, value)) {
      throw new TypeError(`godot-compat: Variant property '${property}' is read-only.`);
    }
    return;
  }
  invalidProperty(receiver, property, true);
}
