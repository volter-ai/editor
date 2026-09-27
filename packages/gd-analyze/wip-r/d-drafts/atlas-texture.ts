/**
 * @godot-class AtlasTexture
 * @role BINDING
 *
 * Godot 4.7's `AtlasTexture` (`scene/resources/atlas_texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a region of another texture, with a margin. Its
 * native entity is a three `Texture` without an image, whose width and height are the class's
 * (`get_width`, `get_height`); a drawer samples its atlas (`godot_atlas_texture_source`, the atlas's
 * own texture as `get_rid` returns it) at the rectangle `get_rect_region` computes. `real_t` is
 * 32-bit: every rectangle is in float.
 */

import { Texture } from 'three';
import { construct as rect2, type Rect2 } from './rect2';
import { get_height as texture_height, get_width as texture_width, godot_texture_2d_connect_changed, godot_texture_2d_disconnect_changed, godot_texture_2d_emit_changed, godot_texture_2d_size } from './texture-2d';
import { construct as vector2 } from './vector2';

const f32 = Math.fround;

interface AtlasState {
  atlas: Texture | null;
  region: Rect2;
  /** `rounded_region`: the region with its size floored (`atlas_texture.cpp:100`). */
  rounded: Rect2;
  margin: Rect2;
  filterClip: boolean;
  forward: () => void;
}

const ATLASES = new WeakMap<Texture, AtlasState>();

function stateOf(self: Texture, member: string): AtlasState {
  const state = ATLASES.get(self);
  if (state === undefined) throw new Error(`godot-compat: ${member} on a texture that is not an AtlasTexture`);
  return state;
}

function sameRect(a: Rect2, b: Rect2): boolean {
  return a.position.x === b.position.x && a.position.y === b.position.y && a.size.x === b.size.x && a.size.y === b.size.y;
}

/**
 * A new AtlasTexture: no atlas, empty region and margin, no filter clip (`atlas_texture.h:42`).
 *
 * @godot AtlasTexture (protocol)
 * @source scene/resources/atlas_texture.cpp:36
 */
export function construct(): Texture {
  const self = new Texture();
  ATLASES.set(self, { atlas: null, region: rect2(), rounded: rect2(), margin: rect2(), filterClip: false, forward: () => godot_texture_2d_emit_changed(self) });
  godot_texture_2d_size(self, () => [get_width(self), get_height(self)]);
  return self;
}

/**
 * @godot AtlasTexture.get_width
 * @source scene/resources/atlas_texture.cpp:36
 */
export function get_width(self: Texture): number {
  const state = stateOf(self, 'get_width');
  if (state.rounded.size.x === 0) return state.atlas === null ? 1 : texture_width(state.atlas);
  return Math.trunc(f32(state.rounded.size.x + state.margin.size.x));
}

/**
 * @godot AtlasTexture.get_height
 * @source scene/resources/atlas_texture.cpp:47
 */
export function get_height(self: Texture): number {
  const state = stateOf(self, 'get_height');
  if (state.rounded.size.y === 0) return state.atlas === null ? 1 : texture_height(state.atlas);
  return Math.trunc(f32(state.rounded.size.y + state.margin.size.y));
}

/**
 * An atlas that is itself an AtlasTexture forwards its `changed` signal.
 *
 * @godot AtlasTexture.set_atlas
 * @source scene/resources/atlas_texture.cpp:74
 */
export function set_atlas(self: Texture, atlas: Texture | null): void {
  const state = stateOf(self, 'set_atlas');
  if (atlas === self) return;
  if (state.atlas === atlas) return;
  if (state.atlas !== null && ATLASES.has(state.atlas)) godot_texture_2d_disconnect_changed(state.atlas, state.forward);
  state.atlas = atlas;
  if (atlas !== null && ATLASES.has(atlas)) godot_texture_2d_connect_changed(atlas, state.forward);
  godot_texture_2d_emit_changed(self);
}

/**
 * @godot AtlasTexture.get_atlas
 * @source scene/resources/atlas_texture.cpp:91
 */
export function get_atlas(self: Texture): Texture | null {
  return stateOf(self, 'get_atlas').atlas;
}

/**
 * @godot AtlasTexture.set_region
 * @source scene/resources/atlas_texture.cpp:95
 */
export function set_region(self: Texture, region: Rect2): void {
  const state = stateOf(self, 'set_region');
  if (sameRect(state.region, region)) return;
  state.region = region;
  state.rounded = rect2(region.position, vector2(Math.floor(region.size.x), Math.floor(region.size.y)));
  godot_texture_2d_emit_changed(self);
}

/**
 * @godot AtlasTexture.get_region
 * @source scene/resources/atlas_texture.cpp:104
 */
export function get_region(self: Texture): Rect2 {
  return stateOf(self, 'get_region').region;
}

/**
 * @godot AtlasTexture.set_margin
 * @source scene/resources/atlas_texture.cpp:108
 */
export function set_margin(self: Texture, margin: Rect2): void {
  const state = stateOf(self, 'set_margin');
  if (sameRect(state.margin, margin)) return;
  state.margin = margin;
  godot_texture_2d_emit_changed(self);
}

/**
 * @godot AtlasTexture.get_margin
 * @source scene/resources/atlas_texture.cpp:116
 */
export function get_margin(self: Texture): Rect2 {
  return stateOf(self, 'get_margin').margin;
}

/**
 * @godot AtlasTexture.set_filter_clip
 * @source scene/resources/atlas_texture.cpp:120
 */
export function set_filter_clip(self: Texture, enable: boolean): void {
  stateOf(self, 'set_filter_clip').filterClip = enable;
  godot_texture_2d_emit_changed(self);
}

/**
 * @godot AtlasTexture.has_filter_clip
 * @source scene/resources/atlas_texture.cpp:125
 */
export function has_filter_clip(self: Texture): boolean {
  return stateOf(self, 'has_filter_clip').filterClip;
}

/** `_get_region_rect` (`atlas_texture.cpp:129`): the rounded region, an empty side the atlas's. */
function regionRect(state: AtlasState): Rect2 {
  const size = vector2(
    state.rounded.size.x === 0 && state.atlas !== null ? texture_width(state.atlas) : state.rounded.size.x,
    state.rounded.size.y === 0 && state.atlas !== null ? texture_height(state.atlas) : state.rounded.size.y,
  );
  return rect2(state.rounded.position, size);
}

/** `Rect2::intersection` (`core/math/rect2.h:148`) in float, `intersects` without borders. */
function intersection(a: Rect2, b: Rect2): Rect2 {
  if (a.position.x >= f32(b.position.x + b.size.x)) return rect2();
  if (f32(a.position.x + a.size.x) <= b.position.x) return rect2();
  if (a.position.y >= f32(b.position.y + b.size.y)) return rect2();
  if (f32(a.position.y + a.size.y) <= b.position.y) return rect2();
  const x = Math.max(b.position.x, a.position.x);
  const y = Math.max(b.position.y, a.position.y);
  const endX = Math.min(f32(b.position.x + b.size.x), f32(a.position.x + a.size.x));
  const endY = Math.min(f32(b.position.y + b.size.y), f32(a.position.y + a.size.y));
  return rect2(x, y, f32(endX - x), f32(endY - y));
}

/**
 * The rectangle a draw of `rect` from `srcRect` of this texture covers, and the atlas rectangle it
 * samples, or null when nothing is drawn (`AtlasTexture::get_rect_region`); a texture that is not
 * an AtlasTexture draws `rect` from `srcRect` (`Texture2D::get_rect_region`, `texture.cpp:110`).
 *
 * @godot AtlasTexture (protocol)
 * @source scene/resources/atlas_texture.cpp:196
 */
export function godot_atlas_texture_rect_region(self: Texture, rect: Rect2, srcRect: Rect2): { readonly rect: Rect2; readonly srcRect: Rect2 } | null {
  const state = ATLASES.get(self);
  if (state === undefined) return { rect, srcRect };
  if (state.atlas === null) return null;
  let srcSize = srcRect.size;
  if (srcSize.x === 0 && srcSize.y === 0) srcSize = state.rounded.size;
  if (srcSize.x === 0 && srcSize.y === 0) srcSize = vector2(texture_width(state.atlas), texture_height(state.atlas));
  const scale = vector2(f32(rect.size.x / srcSize.x), f32(rect.size.y / srcSize.y));
  const src = rect2(
    f32(srcRect.position.x + f32(state.rounded.position.x - state.margin.position.x)),
    f32(srcRect.position.y + f32(state.rounded.position.y - state.margin.position.y)),
    srcSize.x,
    srcSize.y,
  );
  const clipped = intersection(regionRect(state), src);
  if (clipped.size.x === 0 && clipped.size.y === 0) return null;
  let ofsX = f32(clipped.position.x - src.position.x);
  let ofsY = f32(clipped.position.y - src.position.y);
  if (scale.x < 0) ofsX = f32(ofsX + f32(clipped.size.x - src.size.x));
  if (scale.y < 0) ofsY = f32(ofsY + f32(clipped.size.y - src.size.y));
  return {
    rect: rect2(f32(rect.position.x + f32(ofsX * scale.x)), f32(rect.position.y + f32(ofsY * scale.y)), f32(clipped.size.x * scale.x), f32(clipped.size.y * scale.y)),
    srcRect: clipped,
  };
}

/**
 * The texture a drawer samples for this one: an AtlasTexture's atlas (its `get_rid`, followed
 * through nested atlases), else the texture itself.
 *
 * @godot AtlasTexture (protocol)
 * @source scene/resources/atlas_texture.cpp:58
 */
export function godot_atlas_texture_source(self: Texture): Texture | null {
  let current: Texture | null = self;
  while (current !== null && ATLASES.has(current)) current = (ATLASES.get(current) as AtlasState).atlas;
  return current;
}

/**
 * The size of the texture an atlas draw's UVs divide by: an AtlasTexture's atlas's, else the
 * texture's own (`SpriteBase3D::draw_texture_rect`, `sprite_3d.cpp:140`).
 *
 * @godot AtlasTexture (protocol)
 * @source scene/3d/sprite_3d.cpp:140
 */
export function godot_atlas_texture_uv_size(self: Texture): readonly [number, number] {
  const state = ATLASES.get(self);
  const sized = state === undefined || state.atlas === null ? self : state.atlas;
  return [texture_width(sized), texture_height(sized)];
}

/**
 * An AtlasTexture of the properties a scene states (`atlas`, `region`, `margin`, `filterClip`),
 * set in the order given; an unknown one fails by name.
 *
 * @godot AtlasTexture (protocol)
 * @source scene/resources/atlas_texture.cpp:36
 */
export function godot_atlas_texture_new(properties: Readonly<Record<string, unknown>> = {}): Texture {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'atlas') set_atlas(self, value as Texture | null);
    else if (property === 'region') set_region(self, rect2(...(value as [number, number, number, number])));
    else if (property === 'margin') set_margin(self, rect2(...(value as [number, number, number, number])));
    else if (property === 'filterClip') set_filter_clip(self, value as boolean);
    else throw new Error(`godot-compat: AtlasTexture has no ${property} property.`);
  }
  return self;
}
