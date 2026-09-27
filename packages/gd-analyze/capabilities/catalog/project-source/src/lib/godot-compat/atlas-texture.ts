/**
 * @godot-class AtlasTexture
 * @role PROTOCOL
 *
 * Godot 4.7's `AtlasTexture` (`scene/resources/atlas_texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a region of another texture. Its native entity is a
 * three `Texture` without an image, whose width and height are the class's (`get_width`,
 * `get_height`, registered with `texture-2d.ts`); a drawer samples its atlas (the texture
 * `get_rid` hands the renderer) over the rectangle `get_rect_region` computes. `real_t` is 32-bit:
 * every rectangle is in float. A change of atlas or region emits the resource's `changed`.
 *
 * Bound: `atlas` and `region`, what the corpus's scenes state. Not bound: `margin` and
 * `filter_clip` (a scene stating them refuses; the margin stays the empty rectangle Godot starts
 * it at, so the region arithmetic below is Godot's with a zero margin).
 */

import { Texture } from 'three';
import { construct as rect2, type Rect2 } from './rect2';
import {
  get_height as texture_height,
  get_width as texture_width,
  godot_texture_2d_connect_changed,
  godot_texture_2d_disconnect_changed,
  godot_texture_2d_emit_changed,
  godot_texture_2d_size,
} from './texture-2d';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

interface AtlasState {
  atlas: Texture | null;
  region: Rect2;
  /** `rounded_region`: the region with its size floored (`atlas_texture.cpp:100`). */
  rounded: Rect2;
  /** `emit_changed` as a callable, connected to a nested AtlasTexture's `changed`. */
  readonly forward: () => void;
}

const ATLASES = new WeakMap<Texture, AtlasState>();

function stateOf(self: Texture, member: string): AtlasState {
  const state = ATLASES.get(self);
  if (state === undefined) throw new Error(`godot-compat: ${member} on a texture that is not an AtlasTexture`);
  return state;
}

const sameRect = (a: Rect2, b: Rect2): boolean =>
  a.position.x === b.position.x && a.position.y === b.position.y && a.size.x === b.size.x && a.size.y === b.size.y;

/** `AtlasTexture::get_width` (`atlas_texture.cpp:35`), the margin empty. */
function widthOf(state: AtlasState): number {
  if (state.rounded.size.x === 0) return state.atlas === null ? 1 : texture_width(state.atlas);
  return Math.trunc(state.rounded.size.x);
}

/** `AtlasTexture::get_height` (`atlas_texture.cpp:47`), the margin empty. */
function heightOf(state: AtlasState): number {
  if (state.rounded.size.y === 0) return state.atlas === null ? 1 : texture_height(state.atlas);
  return Math.trunc(state.rounded.size.y);
}

/**
 * A new AtlasTexture: no atlas, an empty region (`atlas_texture.h:43`); a scene's `atlas` and
 * `region`, set in the order it states them. Another property fails by name.
 *
 * @godot AtlasTexture (protocol)
 * @source scene/resources/atlas_texture.h:43
 */
export function godot_atlas_texture_new(properties: Readonly<Record<string, unknown>> = {}): Texture {
  const self = new Texture();
  const state: AtlasState = { atlas: null, region: rect2(), rounded: rect2(), forward: () => godot_texture_2d_emit_changed(self) };
  ATLASES.set(self, state);
  godot_texture_2d_size(self, () => [widthOf(state), heightOf(state)]);
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'atlas') set_atlas(self, value as Texture | null);
    else if (property === 'region') set_region(self, rect2(...(value as [number, number, number, number])));
    else throw new Error(`godot-compat: AtlasTexture has no ${property} property`);
  }
  return self;
}

/**
 * The texture itself fails (`ERR_FAIL_COND(p_atlas == this)`); an atlas that is itself an
 * AtlasTexture forwards its `changed`.
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

/** `_get_region_rect` (`atlas_texture.cpp:129`): the rounded region, an empty side the atlas's. */
function regionRect(state: AtlasState): Rect2 {
  const size = vector2(
    state.rounded.size.x === 0 && state.atlas !== null ? texture_width(state.atlas) : state.rounded.size.x,
    state.rounded.size.y === 0 && state.atlas !== null ? texture_height(state.atlas) : state.rounded.size.y,
  );
  return rect2(state.rounded.position, size);
}

/** `Rect2::intersection` (`core/math/rect2.h:148`) of `self` with `other`, in float. */
function intersection(self: Rect2, other: Rect2): Rect2 {
  // `intersects` without borders (`rect2.h:54`).
  if (self.position.x >= f32(other.position.x + other.size.x)) return rect2();
  if (f32(self.position.x + self.size.x) <= other.position.x) return rect2();
  if (self.position.y >= f32(other.position.y + other.size.y)) return rect2();
  if (f32(self.position.y + self.size.y) <= other.position.y) return rect2();
  const x = Math.max(other.position.x, self.position.x);
  const y = Math.max(other.position.y, self.position.y);
  const endX = Math.min(f32(other.position.x + other.size.x), f32(self.position.x + self.size.x));
  const endY = Math.min(f32(other.position.y + other.size.y), f32(self.position.y + self.size.y));
  return rect2(x, y, f32(endX - x), f32(endY - y));
}

/**
 * The rectangle a draw of `rect` from `srcRect` of this texture covers and the atlas rectangle it
 * samples, or null when it draws nothing (`AtlasTexture::get_rect_region`); a texture that is not an
 * AtlasTexture draws `rect` from `srcRect` (`Texture2D::get_rect_region`, `texture.cpp:110`).
 *
 * @godot AtlasTexture (protocol)
 * @source scene/resources/atlas_texture.cpp:196
 */
export function godot_atlas_texture_rect_region(self: Texture, rect: Rect2, srcRect: Rect2): { readonly rect: Rect2; readonly srcRect: Rect2 } | null {
  const state = ATLASES.get(self);
  if (state === undefined) return { rect, srcRect };
  if (state.atlas === null) return null;
  let srcSize: Vector2 = srcRect.size;
  if (srcSize.x === 0 && srcSize.y === 0) srcSize = state.rounded.size;
  if (srcSize.x === 0 && srcSize.y === 0) srcSize = vector2(texture_width(state.atlas), texture_height(state.atlas));
  const scale = vector2(f32(rect.size.x / srcSize.x), f32(rect.size.y / srcSize.y));
  // `src.position += rounded_region.position - margin.position`, the margin empty.
  const src = rect2(f32(srcRect.position.x + state.rounded.position.x), f32(srcRect.position.y + state.rounded.position.y), srcSize.x, srcSize.y);
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
 * The texture a drawer samples for this one: an AtlasTexture's atlas (`get_rid` is the atlas's),
 * followed through nested atlases, else the texture itself; null for an AtlasTexture without one.
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
 * Whether `texture` is an AtlasTexture (`Ref<AtlasTexture>(p_texture).is_valid()`), and then its
 * atlas.
 *
 * @godot AtlasTexture (protocol)
 * @source scene/3d/sprite_3d.cpp:143
 */
export function godot_atlas_texture_of(texture: Texture): { readonly atlas: Texture | null } | undefined {
  const state = ATLASES.get(texture);
  return state === undefined ? undefined : { atlas: state.atlas };
}
