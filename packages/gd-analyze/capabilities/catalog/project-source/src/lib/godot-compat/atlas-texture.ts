/**
 * @godot-class AtlasTexture
 * @role BINDING
 *
 * Godot 4.7's `AtlasTexture` (`scene/resources/atlas_texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a region of another texture (the atlas). Its size is
 * the region's (the atlas's where the region is empty). The nodes that draw a texture draw its
 * region of the atlas (`godot_atlas_texture_region`).
 */

import type { Texture } from 'three';
import { construct as rect2, type Rect2 } from './rect2';
import { get_height as heightOf, get_width as widthOf } from './texture-2d';

export interface AtlasTexture {
  atlas: Texture | null;
  region: Rect2;
  margin: Rect2;
  filterClip: boolean;
}

const ATLASES = new WeakSet<object>();

function rectOf(value: Rect2 | readonly number[]): Rect2 {
  return Array.isArray(value) ? rect2(...(value as [number, number, number, number])) : (value as Rect2);
}

/**
 * A new AtlasTexture, with the properties a scene states (`atlas`, `region`, `margin`, `filterClip`).
 *
 * @godot AtlasTexture (protocol)
 * @source scene/resources/atlas_texture.cpp:280
 */
export function godot_atlas_texture_new(properties: Readonly<Record<string, unknown>> = {}): AtlasTexture {
  const self: AtlasTexture = { atlas: null, region: rect2(), margin: rect2(), filterClip: false };
  ATLASES.add(self);
  if (properties['atlas'] !== undefined) self.atlas = properties['atlas'] as Texture | null;
  if (properties['region'] !== undefined) self.region = rectOf(properties['region'] as Rect2 | readonly number[]);
  if (properties['margin'] !== undefined) self.margin = rectOf(properties['margin'] as Rect2 | readonly number[]);
  if (properties['filterClip'] !== undefined) self.filterClip = properties['filterClip'] as boolean;
  return self;
}

/**
 * @godot AtlasTexture.AtlasTexture
 * @source scene/resources/atlas_texture.cpp:280
 */
export function construct(): AtlasTexture {
  return godot_atlas_texture_new();
}

/**
 * The texture a node draws and the region of it, in pixels: an AtlasTexture's atlas and region, any
 * other texture whole.
 *
 * @godot AtlasTexture (protocol)
 * @source scene/resources/atlas_texture.cpp:212
 */
export function godot_atlas_texture_region(texture: object): { readonly texture: Texture; readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null {
  if (ATLASES.has(texture)) {
    const atlas = (texture as AtlasTexture).atlas;
    if (atlas === null) return null;
    const region = (texture as AtlasTexture).region;
    const empty = region.size.x === 0 && region.size.y === 0;
    return { texture: atlas, x: region.position.x, y: region.position.y, width: empty ? widthOf(atlas) : region.size.x, height: empty ? heightOf(atlas) : region.size.y };
  }
  const whole = texture as Texture;
  return { texture: whole, x: 0, y: 0, width: widthOf(whole), height: heightOf(whole) };
}

/**
 * @godot AtlasTexture.set_atlas
 * @source scene/resources/atlas_texture.cpp:48
 */
export function set_atlas(self: AtlasTexture, atlas: Texture | null): void {
  self.atlas = atlas;
}

/**
 * @godot AtlasTexture.get_atlas
 * @source scene/resources/atlas_texture.cpp:64
 */
export function get_atlas(self: AtlasTexture): Texture | null {
  return self.atlas;
}

/**
 * @godot AtlasTexture.set_region
 * @source scene/resources/atlas_texture.cpp:68
 */
export function set_region(self: AtlasTexture, region: Rect2): void {
  self.region = region;
}

/**
 * @godot AtlasTexture.get_region
 * @source scene/resources/atlas_texture.cpp:77
 */
export function get_region(self: AtlasTexture): Rect2 {
  return self.region;
}

/**
 * @godot AtlasTexture.set_margin
 * @source scene/resources/atlas_texture.cpp:81
 */
export function set_margin(self: AtlasTexture, margin: Rect2): void {
  self.margin = margin;
}

/**
 * @godot AtlasTexture.set_filter_clip
 * @source scene/resources/atlas_texture.cpp:94
 */
export function set_filter_clip(self: AtlasTexture, enable: boolean): void {
  self.filterClip = enable;
}
