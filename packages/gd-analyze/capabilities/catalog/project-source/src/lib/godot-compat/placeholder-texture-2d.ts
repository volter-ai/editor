/**
 * @godot-class PlaceholderTexture2D
 * @role PROTOCOL
 *
 * Godot 4.7's `PlaceholderTexture2D` (`scene/resources/placeholder_textures.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a texture with a size and no image. Its native
 * entity is a three `Texture` without an image; its width and height are the stored size
 * truncated to integers.
 */

import { Texture } from 'three';
import { godot_texture_2d_emit_changed, godot_texture_2d_size } from './texture-2d';
import { construct as vector2, type Vector2 } from './vector2';

const SIZE = new WeakMap<Texture, Vector2>();

/**
 * A new placeholder texture (`PlaceholderTexture2D.new()`), `Size2(1, 1)`
 * (`scene/resources/placeholder_textures.h:39`).
 *
 * A scene states its `size` (`placeholder_textures.cpp:67`).
 *
 * @godot PlaceholderTexture2D (protocol)
 * @source scene/resources/placeholder_textures.cpp:70
 */
export function godot_placeholder_texture_2d_new(properties: { readonly size?: readonly [number, number] } = {}): Texture {
  const texture = new Texture();
  SIZE.set(texture, vector2(1, 1));
  godot_texture_2d_size(texture, () => {
    const size = SIZE.get(texture) as Vector2;
    return [Math.trunc(size.x), Math.trunc(size.y)];
  });
  for (const property of Object.keys(properties)) {
    if (property !== 'size') throw new Error(`godot-compat: PlaceholderTexture2D has no ${property} property`);
  }
  if (properties.size !== undefined) set_size(texture, vector2(...properties.size));
  return texture;
}

/**
 * Stores the size and emits `changed`.
 *
 * @godot PlaceholderTexture2D.set_size
 * @source scene/resources/placeholder_textures.cpp:36
 */
export function set_size(self: Texture, p_size: Vector2): void {
  SIZE.set(self, p_size);
  godot_texture_2d_emit_changed(self);
}
