import { GodotCallable, godotCallableCall } from './callable';
import { godotOpenObjectProtocolCall } from './object';
import { isGodotPackedArray } from './packed-array';
import { godotOpenVariantCall } from './variant';

export type GodotOpenCallableMethod =
  | 'callv'
  | 'bind'
  | 'bindv'
  | 'unbind'
  | 'get_bound_arguments_count'
  | 'get_bound_arguments'
  | 'get_object'
  | 'get_object_id'
  | 'get_method'
  | 'is_null'
  | 'is_valid'
  | 'hash';

/** Open Variant dispatch over exact retained Callable identity; callv also belongs to Object. */
export function godotOpenCallableOrObjectCall(
  receiver: unknown,
  major: 3 | 4,
  method: GodotOpenCallableMethod,
  args: readonly unknown[],
): unknown {
  if (receiver instanceof GodotCallable) {
    if (major !== 4) {
      throw new Error(`godot-compat: first-class Callable.${method} is not declared by Godot 3.x.`);
    }
    return godotCallableCall(receiver, method, args);
  }
  if (method === 'hash' && Array.isArray(receiver) && !isGodotPackedArray(receiver)) {
    return godotOpenVariantCall(major, 'hash', receiver, args);
  }
  if (method === 'callv') {
    return godotOpenObjectProtocolCall(receiver, major, method, args);
  }
  throw new TypeError(`godot-compat: Variant.${method} requires a retained Callable value.`);
}
