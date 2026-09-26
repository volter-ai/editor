/** Exact open-receiver calls after analyzer provenance has narrowed the method family. */

import {
  godotObjectBindingOf,
  godotObjectCall,
  godotObjectIsClass,
} from './object';
import { godotResourceGetName } from './resource-io';
import {
  getGodotTexture2DHeight,
  getGodotTexture2DImage,
  getGodotTexture2DWidth,
} from './texture-2d';

const STREAM_PEER_METHOD_ARITY: Readonly<Record<string, number>> = {
  put_data: 1,
  put_partial_data: 1,
  get_data: 1,
  get_partial_data: 1,
  get_available_bytes: 0,
  put_8: 1,
  put_u8: 1,
  put_16: 1,
  put_u16: 1,
  put_32: 1,
  put_u32: 1,
  put_64: 1,
  put_u64: 1,
  put_half: 1,
  put_float: 1,
  put_double: 1,
  get_8: 0,
  get_u8: 0,
  get_16: 0,
  get_u16: 0,
  get_32: 0,
  get_u32: 0,
  get_64: 0,
  get_u64: 0,
  get_half: 0,
  get_float: 0,
  get_double: 0,
};

function exactArity(method: string, args: readonly unknown[], expected: number): void {
  if (args.length !== expected) {
    throw new Error(
      `godot-compat: ${method} expects ${expected} argument${expected === 1 ? '' : 's'}; received ${args.length}.`,
    );
  }
}

function directCall(receiver: object, method: string, args: readonly unknown[]): unknown {
  const candidate = Reflect.get(receiver, method) as unknown;
  if (typeof candidate !== 'function') {
    throw new Error(`godot-compat: retained ${method} owner has no callable native implementation.`);
  }
  return Reflect.apply(candidate, receiver, args);
}

/**
 * Finite runtime half of the analyzer's open Object-method matrix. Script overrides and generated
 * ClassDB rows retain their normal Object.call precedence. Identity-only compat resources may use
 * direct methods only after their retained native class proves the precise owner family below.
 */
export function godotOpenExactObjectMethodCall(
  receiver: unknown,
  major: 3 | 4,
  method: string,
  args: readonly unknown[],
): unknown {
  const binding = godotObjectBindingOf(receiver);
  if (binding.scriptMembers?.has(method) === true || binding.dispatch.methods[method] !== undefined) {
    return godotObjectCall(receiver, [method, ...args]);
  }

  if (method === 'get_name') {
    exactArity(method, args, 0);
    if (godotObjectIsClass(receiver, 'Resource', major)) return godotResourceGetName(receiver);
    if (godotObjectIsClass(receiver, 'Node', major)) {
      const direct = Reflect.get(binding.value, 'get_name') as unknown;
      if (typeof direct === 'function') return Reflect.apply(direct, binding.value, []);
      if ((typeof binding.native !== 'object' && typeof binding.native !== 'function') || binding.native === null) {
        throw new Error(`godot-compat: retained ${binding.godotClass} has no native Node name owner.`);
      }
      const nativeName = Reflect.get(binding.native, 'name');
      if (typeof nativeName === 'string') return nativeName;
      throw new Error(`godot-compat: retained ${binding.godotClass} has no native Node name owner.`);
    }
  }

  if (method === 'get_width' || method === 'get_height') {
    exactArity(method, args, 0);
    if (godotObjectIsClass(receiver, 'Image', major)) {
      return directCall(binding.value, method, []);
    }
    const textureBase = major === 3 ? 'Texture' : 'Texture2D';
    if (godotObjectIsClass(receiver, textureBase, major)) {
      return method === 'get_width'
        ? getGodotTexture2DWidth(binding.value)
        : getGodotTexture2DHeight(binding.value);
    }
  }

  if (method === 'get_image') {
    exactArity(method, args, 0);
    if (major === 4 && godotObjectIsClass(receiver, 'Texture2D', major)) {
      return getGodotTexture2DImage(binding.value);
    }
  }

  if (method === 'get_pixel' || method === 'get_pixelv') {
    exactArity(method, args, method === 'get_pixel' ? 2 : 1);
    if (godotObjectIsClass(receiver, 'Image', major)) {
      return directCall(binding.value, method, args);
    }
  }

  if (method === 'get_data') {
    if (godotObjectIsClass(receiver, 'StreamPeer', major)) {
      exactArity(method, args, 1);
      return directCall(binding.value, method, args);
    }
    exactArity(method, args, 0);
    if (godotObjectIsClass(receiver, 'Image', major) || godotObjectIsClass(receiver, 'JSON', major)) {
      return directCall(binding.value, method, []);
    }
    if (major === 3 && godotObjectIsClass(receiver, 'Texture', major)) {
      return getGodotTexture2DImage(binding.value);
    }
  }

  if (method === 'close') {
    exactArity(method, args, 0);
    const fileClass = major === 3 ? 'File' : 'FileAccess';
    if (godotObjectIsClass(receiver, fileClass, major)) return directCall(binding.value, method, []);
  }

  const streamArity = STREAM_PEER_METHOD_ARITY[method];
  if (streamArity !== undefined && godotObjectIsClass(receiver, 'StreamPeer', major)) {
    exactArity(method, args, streamArity);
    return directCall(binding.value, method, args);
  }

  throw new Error(
    `godot-compat: ${binding.godotClass}.${method} is outside the exact open-receiver method matrix.`,
  );
}
