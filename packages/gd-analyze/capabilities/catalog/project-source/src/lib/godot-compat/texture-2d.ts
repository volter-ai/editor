/**
 * @godot-class Texture2D
 * @role BINDING
 *
 * Godot 4.7's `Texture2D` (`scene/resources/texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `Texture`: an imported image is the
 * texture's image, and its pixel size is the image's; a texture without an image (a
 * `PlaceholderTexture2D`) has the size its class stores here. A texture's `changed` signal is kept
 * here too, for the nodes that draw it.
 */

import type { Texture } from 'three';
import { construct as vector2, type Vector2 } from './vector2';

const SIZES = new WeakMap<Texture, () => readonly [number, number]>();
const LISTENERS = new WeakMap<Texture, Set<() => void>>();

/**
 * Gives a texture its class's width and height (`get_width`, `get_height`, virtual in Texture2D).
 *
 * @godot Texture2D (protocol)
 * @source scene/resources/texture.cpp:61
 */
export function godot_texture_2d_size(texture: Texture, size: () => readonly [number, number]): void {
  SIZES.set(texture, size);
}

/** The width and height: the class's, else the image's (`image.width`, `image.height`), else 0. */
function sizeOf(texture: Texture): readonly [number, number] {
  const own = SIZES.get(texture);
  if (own !== undefined) return own();
  const image = texture.image as { readonly width?: number; readonly height?: number } | null | undefined;
  return [image?.width ?? 0, image?.height ?? 0];
}

/**
 * Listens to the texture's `changed` signal (`Resource::connect_changed`).
 *
 * @godot Texture2D (protocol)
 * @source core/io/resource.cpp:208
 */
export function godot_texture_2d_connect_changed(texture: Texture, listener: () => void): void {
  let listeners = LISTENERS.get(texture);
  if (listeners === undefined) {
    listeners = new Set();
    LISTENERS.set(texture, listeners);
  }
  listeners.add(listener);
}

/**
 * @godot Texture2D (protocol)
 * @source core/io/resource.cpp:219
 */
export function godot_texture_2d_disconnect_changed(texture: Texture, listener: () => void): void {
  LISTENERS.get(texture)?.delete(listener);
}

/**
 * Emits the texture's `changed` signal (`Resource::emit_changed`).
 *
 * @godot Texture2D (protocol)
 * @source core/io/resource.cpp:49
 */
export function godot_texture_2d_emit_changed(texture: Texture): void {
  for (const listener of [...(LISTENERS.get(texture) ?? [])]) listener();
}

/**
 * @godot Texture2D.get_width
 * @source scene/resources/texture.cpp:61
 */
export function get_width(self: Texture): number {
  return sizeOf(self)[0];
}

/**
 * @godot Texture2D.get_height
 * @source scene/resources/texture.cpp:67
 */
export function get_height(self: Texture): number {
  return sizeOf(self)[1];
}

/**
 * `Size2(get_width(), get_height())`.
 *
 * @godot Texture2D.get_size
 * @source scene/resources/texture.cpp:73
 */
export function get_size(self: Texture): Vector2 {
  const [width, height] = sizeOf(self);
  return vector2(width, height);
}
