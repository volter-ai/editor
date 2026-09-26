import { godotObjectHasBinding, godotOpenObjectProtocolCall } from './object';
import { godotOpenVariantCall } from './variant';
import { isGodotPackedArray } from './packed-array';

/** `get` belongs to Array, Dictionary, and Object; retained identity selects the exact protocol. */
export function godotOpenDictionaryOrObjectGet(
  receiver: unknown,
  major: 3 | 4,
  args: readonly unknown[],
): unknown {
  if (receiver instanceof Map || (Array.isArray(receiver) && !isGodotPackedArray(receiver))) {
    return godotOpenVariantCall(major, 'get', receiver, args);
  }
  if (godotObjectHasBinding(receiver)) {
    return godotOpenObjectProtocolCall(receiver, major, 'get', args);
  }
  const property = args[0];
  if (
    typeof receiver === 'object' && receiver !== null &&
    (typeof property === 'string' || typeof property === 'number') &&
    Object.hasOwn(receiver, property)
  ) {
    return Reflect.get(receiver, property);
  }
  return godotOpenObjectProtocolCall(receiver, major, 'get', args);
}

/** `set` belongs to G4 Array and Object; packed arrays retain their concrete method owner. */
export function godotOpenArrayOrObjectSet(
  receiver: unknown,
  major: 3 | 4,
  args: readonly unknown[],
): unknown {
  if (Array.isArray(receiver) && !isGodotPackedArray(receiver)) {
    return godotOpenVariantCall(major, 'set', receiver, args);
  }
  return godotOpenObjectProtocolCall(receiver, major, 'set', args);
}
/** Dot-property assignment on an open Dictionary/Object Variant. */
export function godotOpenDictionaryOrObjectSet(
  receiver: unknown,
  major: 3 | 4,
  property: string,
  value: unknown,
): void {
  if (receiver instanceof Map) {
    receiver.set(property, value);
    return;
  }
  if (godotObjectHasBinding(receiver)) {
    void godotOpenObjectProtocolCall(receiver, major, 'set', [property, value]);
    return;
  }
  if (typeof receiver === 'object' && receiver !== null && Object.hasOwn(receiver, property)) {
    if (!Reflect.set(receiver, property, value)) {
      throw new TypeError(`godot-compat: Variant property ${property} is read-only.`);
    }
    return;
  }
  void godotOpenObjectProtocolCall(receiver, major, 'set', [property, value]);
}
