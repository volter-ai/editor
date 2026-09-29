/**
 * @godot-class TextureRect
 * @role BINDING
 *
 * Godot 4.7's `TextureRect` (`scene/gui/texture_rect.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the element its scene renders (docs/GODOT.md
 * "UI is React DOM"): its texture is the element's background image, the imported image's copied
 * file, sized by its stretch mode as the plan gave its style (`scene-control-idioms.ts`).
 */

import type { Texture } from 'three';
import { godot_compressed_texture_2d_source } from './compressed-texture-2d';
import { godot_node_entity } from './node';

function elementOf(self: object, member: string): HTMLElement {
  const entity = godot_node_entity(self) as unknown;
  if (typeof HTMLElement === 'undefined' || !(entity instanceof HTMLElement)) throw new Error(`godot-compat: TextureRect.${member} on a node that is not a Control's element`);
  return entity;
}

const TEXTURES = new WeakMap<HTMLElement, Texture | null>();

/**
 * @godot TextureRect.set_texture
 * @source scene/gui/texture_rect.cpp:223
 */
export function set_texture(self: object, p_tex: Texture | null): void {
  const element = elementOf(self, 'set_texture');
  TEXTURES.set(element, p_tex);
  const source = p_tex === null ? undefined : godot_compressed_texture_2d_source(p_tex);
  if (p_tex !== null && source === undefined) throw new Error('godot-compat: TextureRect.set_texture of a texture with no image the page loads');
  element.style.backgroundImage = source === undefined ? '' : `url("${source}")`;
}

/**
 * @godot TextureRect.get_texture
 * @source scene/gui/texture_rect.cpp:241
 */
export function get_texture(self: object): Texture | null {
  return TEXTURES.get(elementOf(self, 'get_texture')) ?? null;
}
