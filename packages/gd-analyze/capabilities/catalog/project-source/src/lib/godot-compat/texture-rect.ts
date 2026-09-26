/**
 * @godot-class TextureRect
 * @role BINDING
 *
 * Godot 4.7's `TextureRect` (`scene/gui/texture_rect.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Control drawing a texture. Its minimum size by the
 * expand mode, and the rect (and source region) its stretch mode draws the texture in, are
 * Godot's; the page draws the texture's image at that rect inside the node's element.
 */

import type { Object3D, Texture } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { godot_control_mount, get_size, update_minimum_size } from './control';
import { godot_node_entity } from './node';
import { construct as rect2, type Rect2 } from './rect2';
import { godot_texture_2d_connect_changed, godot_texture_2d_disconnect_changed, get_height, get_size as textureSize, get_width } from './texture-2d';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

/** `TextureRect::ExpandMode` (`scene/gui/texture_rect.h:39`). */
const EXPAND_KEEP_SIZE = 0;
const EXPAND_IGNORE_SIZE = 1;
const EXPAND_FIT_WIDTH = 2;
const EXPAND_FIT_WIDTH_PROPORTIONAL = 3;
const EXPAND_FIT_HEIGHT = 4;
const EXPAND_FIT_HEIGHT_PROPORTIONAL = 5;

/** `TextureRect::StretchMode` (`scene/gui/texture_rect.h:48`). */
const STRETCH_SCALE = 0;
const STRETCH_TILE = 1;
const STRETCH_KEEP = 2;
const STRETCH_KEEP_CENTERED = 3;
const STRETCH_KEEP_ASPECT = 4;
const STRETCH_KEEP_ASPECT_CENTERED = 5;
const STRETCH_KEEP_ASPECT_COVERED = 6;

interface TextureRectState {
  texture: Texture | null;
  expandMode: number;
  stretchMode: number;
  flipH: boolean;
  flipV: boolean;
  readonly changed: () => void;
}

const RECTS = new WeakMap<Object3D, TextureRectState>();

function stateOf(self: object, member: string): TextureRectState {
  const state = RECTS.get(godot_node_entity(self) as Object3D);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a TextureRect`);
  return state;
}

/**
 * `get_minimum_size` (`texture_rect.cpp:128`): by the expand mode, the texture's size, nothing, or
 * one side fitted to the other side of the node's size.
 */
function minimumSize(entity: Object3D): Vector2 {
  const state = RECTS.get(entity) as TextureRectState;
  const texture = state.texture;
  if (texture === null) return vector2();
  switch (state.expandMode) {
    case EXPAND_KEEP_SIZE:
      return textureSize(texture);
    case EXPAND_FIT_WIDTH:
      return vector2(get_size(entity).y, 0);
    case EXPAND_FIT_WIDTH_PROPORTIONAL:
      return vector2(f32(get_size(entity).y * f32(f32(get_width(texture)) / get_height(texture))), 0);
    case EXPAND_FIT_HEIGHT:
      return vector2(0, get_size(entity).x);
    case EXPAND_FIT_HEIGHT_PROPORTIONAL:
      return vector2(0, f32(get_size(entity).x * f32(f32(get_height(texture)) / get_width(texture))));
    default:
      return vector2();
  }
}

/**
 * Makes `entity` a TextureRect, a node of that class, with its defaults
 * (`scene/gui/texture_rect.h:59-63`).
 *
 * @godot TextureRect (protocol)
 * @source scene/gui/texture_rect.cpp:299
 */
export function godot_texture_rect_mount(entity: Object3D): void {
  const state: TextureRectState = {
    texture: null,
    expandMode: EXPAND_KEEP_SIZE,
    stretchMode: STRETCH_SCALE,
    flipH: false,
    flipV: false,
    changed: () => update_minimum_size(entity),
  };
  RECTS.set(entity, state);
  godot_control_mount(entity, ['TextureRect', 'Control', 'CanvasItem', 'Node'], {
    minimumSize,
    draw,
    // `NOTIFICATION_RESIZED` (`texture_rect.cpp:122`).
    resized: (node) => update_minimum_size(node),
  });
}

/**
 * The texture, and `_texture_changed` (the minimum size may change) now and whenever it changes.
 *
 * @godot TextureRect.set_texture
 * @source scene/gui/texture_rect.cpp:223
 */
export function set_texture(self: object, p_tex: Texture | null): void {
  const state = stateOf(self, 'set_texture');
  if (p_tex === state.texture) return;
  if (state.texture !== null) godot_texture_2d_disconnect_changed(state.texture, state.changed);
  state.texture = p_tex;
  if (p_tex !== null) godot_texture_2d_connect_changed(p_tex, state.changed);
  state.changed();
}

/**
 * @godot TextureRect.get_texture
 * @source scene/gui/texture_rect.cpp:241
 */
export function get_texture(self: object): Texture | null {
  return stateOf(self, 'get_texture').texture;
}

/**
 * @godot TextureRect.set_expand_mode
 * @source scene/gui/texture_rect.cpp:245
 */
export function set_expand_mode(self: object, p_mode: number): void {
  const state = stateOf(self, 'set_expand_mode');
  if (state.expandMode === p_mode) return;
  state.expandMode = p_mode;
  update_minimum_size(self);
}

/**
 * @godot TextureRect.get_expand_mode
 * @source scene/gui/texture_rect.cpp:255
 */
export function get_expand_mode(self: object): number {
  return stateOf(self, 'get_expand_mode').expandMode;
}

/**
 * @godot TextureRect.set_stretch_mode
 * @source scene/gui/texture_rect.cpp:259
 */
export function set_stretch_mode(self: object, p_mode: number): void {
  stateOf(self, 'set_stretch_mode').stretchMode = p_mode;
}

/**
 * @godot TextureRect.get_stretch_mode
 * @source scene/gui/texture_rect.cpp:269
 */
export function get_stretch_mode(self: object): number {
  return stateOf(self, 'get_stretch_mode').stretchMode;
}

/**
 * @godot TextureRect.set_flip_h
 * @source scene/gui/texture_rect.cpp:273
 */
export function set_flip_h(self: object, p_flip: boolean): void {
  stateOf(self, 'set_flip_h').flipH = p_flip;
}

/**
 * @godot TextureRect.is_flipped_h
 * @source scene/gui/texture_rect.cpp:282
 */
export function is_flipped_h(self: object): boolean {
  return stateOf(self, 'is_flipped_h').flipH;
}

/**
 * @godot TextureRect.set_flip_v
 * @source scene/gui/texture_rect.cpp:286
 */
export function set_flip_v(self: object, p_flip: boolean): void {
  stateOf(self, 'set_flip_v').flipV = p_flip;
}

/**
 * @godot TextureRect.is_flipped_v
 * @source scene/gui/texture_rect.cpp:295
 */
export function is_flipped_v(self: object): boolean {
  return stateOf(self, 'is_flipped_v').flipV;
}

/**
 * Where `NOTIFICATION_DRAW` draws the texture (`texture_rect.cpp:39`): the destination rect in the
 * node's space (a negative size flips it), the source region when the mode crops (`region`, empty
 * otherwise), and whether it tiles; null without a texture.
 *
 * @godot TextureRect (protocol)
 * @source scene/gui/texture_rect.cpp:39
 */
export function godot_texture_rect_draw(self: object): { readonly rect: Rect2; readonly region: Rect2; readonly tile: boolean } | null {
  const state = stateOf(self, 'draw');
  const texture = state.texture;
  if (texture === null) return null;
  const own = get_size(self);
  let width = 0;
  let height = 0;
  let offsetX = 0;
  let offsetY = 0;
  let region = rect2();
  let tile = false;
  switch (state.stretchMode) {
    case STRETCH_SCALE:
      width = own.x;
      height = own.y;
      break;
    case STRETCH_TILE:
      width = own.x;
      height = own.y;
      tile = true;
      break;
    case STRETCH_KEEP: {
      const size = textureSize(texture);
      width = size.x;
      height = size.y;
      break;
    }
    case STRETCH_KEEP_CENTERED: {
      const size = textureSize(texture);
      offsetX = f32(f32(own.x - size.x) / 2);
      offsetY = f32(f32(own.y - size.y) / 2);
      width = size.x;
      height = size.y;
      break;
    }
    case STRETCH_KEEP_ASPECT_CENTERED:
    case STRETCH_KEEP_ASPECT: {
      // `int tex_width = texture->get_width() * size.height / texture->get_height()`, in float, truncated.
      let texWidth = Math.trunc(f32(f32(get_width(texture) * own.y) / get_height(texture)));
      let texHeight = Math.trunc(own.y);
      if (texWidth > own.x) {
        texWidth = Math.trunc(own.x);
        texHeight = Math.trunc((get_height(texture) * texWidth) / get_width(texture));
      }
      if (state.stretchMode === STRETCH_KEEP_ASPECT_CENTERED) {
        offsetX = f32(f32(own.x - texWidth) / 2);
        offsetY = f32(f32(own.y - texHeight) / 2);
      }
      width = texWidth;
      height = texHeight;
      break;
    }
    case STRETCH_KEEP_ASPECT_COVERED: {
      width = own.x;
      height = own.y;
      const size = textureSize(texture);
      const sx = f32(own.x / size.x);
      const sy = f32(own.y / size.y);
      const scale = sx > sy ? sx : sy;
      const scaledX = f32(size.x * scale);
      const scaledY = f32(size.y * scale);
      region = rect2(
        f32(Math.abs(f32(f32(scaledX - own.x) / scale)) / 2),
        f32(Math.abs(f32(f32(scaledY - own.y) / scale)) / 2),
        f32(own.x / scale),
        f32(own.y / scale),
      );
      break;
    }
    default:
      break;
  }
  if (state.flipH) width = -width;
  if (state.flipV) height = -height;
  return { rect: rect2(offsetX, offsetY, width, height), region, tile };
}

const CONTENTS = new WeakMap<Object3D, HTMLElement>();
const SOURCES = new WeakMap<object, string>();

/** The URL of a texture's image: an image element's `src`, a canvas's data URL; none without one. */
function imageSource(texture: Texture): string {
  const image = texture.image as { readonly src?: string; readonly toDataURL?: () => string } | null | undefined;
  if (image === null || image === undefined) return '';
  if (typeof image.src === 'string') return image.src;
  if (typeof image.toDataURL !== 'function') return '';
  let source = SOURCES.get(image);
  if (source === undefined) {
    source = image.toDataURL();
    SOURCES.set(image, source);
  }
  return source;
}

/**
 * `NOTIFICATION_DRAW` on the page: the texture's image as the background of an element at the rect
 * Godot draws it in (`godot_texture_rect_draw`), mirrored in place where the rect's size is negative
 * (the rendering server flips the texture and keeps the rect's corner, `renderer_canvas_cull.cpp:1585`), sized
 * to the node (scale), repeated at the texture's size (tile), or showing the source region (keep
 * aspect covered); tinted by `self_modulate`.
 */
function draw(entity: Object3D, element: HTMLElement): void {
  let content = CONTENTS.get(entity);
  if (content === undefined) {
    content = element.ownerDocument.createElement('div');
    content.setAttribute('data-godot-content', '');
    content.style.position = 'absolute';
    CONTENTS.set(entity, content);
  }
  if (content.parentElement !== element) element.insertBefore(content, element.firstChild);
  const state = RECTS.get(entity) as TextureRectState;
  const drawn = godot_texture_rect_draw(entity);
  const source = state.texture === null ? '' : imageSource(state.texture);
  if (drawn === null || source === '') {
    content.style.display = 'none';
    return;
  }
  const { rect, region, tile } = drawn;
  const width = Math.abs(rect.size.x);
  const height = Math.abs(rect.size.y);
  content.style.display = '';
  content.style.left = `${String(rect.position.x)}px`;
  content.style.top = `${String(rect.position.y)}px`;
  content.style.width = `${String(width)}px`;
  content.style.height = `${String(height)}px`;
  content.style.transform = rect.size.x < 0 || rect.size.y < 0 ? `scale(${rect.size.x < 0 ? '-1' : '1'}, ${rect.size.y < 0 ? '-1' : '1'})` : '';
  content.style.backgroundImage = `url("${source}")`;
  content.style.backgroundRepeat = tile ? 'repeat' : 'no-repeat';
  const texture = textureSize(state.texture as Texture);
  if (tile) {
    content.style.backgroundSize = `${String(texture.x)}px ${String(texture.y)}px`;
    content.style.backgroundPosition = '0px 0px';
  } else if (region.size.x > 0 && region.size.y > 0) {
    const sx = width / region.size.x;
    const sy = height / region.size.y;
    content.style.backgroundSize = `${String(texture.x * sx)}px ${String(texture.y * sy)}px`;
    content.style.backgroundPosition = `${String(-region.position.x * sx)}px ${String(-region.position.y * sy)}px`;
  } else {
    content.style.backgroundSize = '100% 100%';
    content.style.backgroundPosition = '0px 0px';
  }
  content.style.filter = godot_canvas_item_self_filter(entity, element);
}
