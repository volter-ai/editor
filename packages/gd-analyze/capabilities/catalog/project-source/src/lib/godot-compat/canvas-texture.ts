/**
 * @godot-class CanvasTexture
 * @role PROTOCOL
 *
 * Godot 4.7's `CanvasTexture` (`scene/main/canvas_item.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a texture drawn from its diffuse texture, 1x1 without
 * one. Its native entity is a three `Texture` without an image; the normal and specular channels
 * are not bound.
 */

import { Texture } from 'three';
import { godot_texture_2d_connect_changed, godot_texture_2d_disconnect_changed, godot_texture_2d_emit_changed, godot_texture_2d_size, get_height, get_width } from './texture-2d';

const DIFFUSE = new WeakMap<Texture, Texture | null>();
const RELAYS = new WeakMap<Texture, () => void>();

/**
 * A new canvas texture (`CanvasTexture.new()`), with no diffuse texture.
 *
 * @godot CanvasTexture (protocol)
 * @source scene/main/canvas_item.cpp:2009
 */
export function godot_canvas_texture_new(): Texture {
  const texture = new Texture();
  DIFFUSE.set(texture, null);
  // `get_width`, `get_height` (`canvas_item.cpp:2009`): the diffuse texture's, else 1.
  godot_texture_2d_size(texture, () => {
    const diffuse = DIFFUSE.get(texture) ?? null;
    return diffuse === null ? [1, 1] : [get_width(diffuse), get_height(diffuse)];
  });
  return texture;
}

/**
 * The diffuse texture; drawing the canvas texture draws its image.
 *
 * @godot CanvasTexture.set_diffuse_texture
 * @source scene/main/canvas_item.cpp:1915
 */
export function set_diffuse_texture(self: Texture, p_diffuse: Texture | null): void {
  const previous = DIFFUSE.get(self) ?? null;
  if (previous === p_diffuse) return;
  let relay = RELAYS.get(self);
  if (relay === undefined) {
    relay = () => godot_texture_2d_emit_changed(self);
    RELAYS.set(self, relay);
  }
  if (previous !== null) godot_texture_2d_disconnect_changed(previous, relay);
  DIFFUSE.set(self, p_diffuse);
  self.image = p_diffuse?.image ?? null;
  if (p_diffuse !== null) godot_texture_2d_connect_changed(p_diffuse, relay);
  godot_texture_2d_emit_changed(self);
}

/**
 * @godot CanvasTexture.get_diffuse_texture
 * @source scene/main/canvas_item.cpp:1926
 */
export function get_diffuse_texture(self: Texture): Texture | null {
  return DIFFUSE.get(self) ?? null;
}
