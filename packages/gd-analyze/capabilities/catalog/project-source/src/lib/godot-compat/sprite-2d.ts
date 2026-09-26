/**
 * @godot-class Sprite2D
 * @role BINDING
 *
 * Godot 4.7's `Sprite2D` (`scene/2d/sprite_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node2D drawing a texture (or one frame of a sheet
 * of `hframes` by `vframes`), centered on its origin unless not `centered`, moved by `offset`, and
 * flipped. Its rectangles are Godot's (`_get_rects`, `get_rect`); it is bound onto the page as the
 * texture's image in an element at that rectangle. Regions and `snap_2d_transforms_to_pixel` (off
 * by default) are not bound.
 */

import type { Object3D, Texture } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { godot_node_2d_mount } from './node-2d';
import { godot_node_entity } from './node';
import { construct as rect2, type Rect2 } from './rect2';
import { get_height, get_width } from './texture-2d';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

interface SpriteState {
  texture: Texture | null;
  centered: boolean;
  offset: Vector2;
  flipH: boolean;
  flipV: boolean;
  hframes: number;
  vframes: number;
  frame: number;
}

const SPRITES = new WeakMap<Object3D, SpriteState>();

function stateOf(self: object, member: string): SpriteState {
  const state = SPRITES.get(godot_node_entity(self) as Object3D);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Sprite2D`);
  return state;
}

/**
 * `_get_rects` (`sprite_2d.cpp:98`): the frame's source rectangle in the texture, and where it is
 * drawn (a negative size flips it).
 */
function rects(state: SpriteState, texture: Texture): { readonly src: Rect2; readonly dst: Rect2 } {
  const frameW = f32(get_width(texture) / state.hframes);
  const frameH = f32(get_height(texture) / state.vframes);
  const src = rect2(f32((state.frame % state.hframes) * frameW), f32(Math.trunc(state.frame / state.hframes) * frameH), frameW, frameH);
  let x = state.offset.x;
  let y = state.offset.y;
  if (state.centered) {
    x = f32(x - f32(frameW / 2));
    y = f32(y - f32(frameH / 2));
  }
  return { src, dst: rect2(x, y, state.flipH ? -frameW : frameW, state.flipV ? -frameH : frameH) };
}

const CONTENTS = new WeakMap<Object3D, HTMLElement>();

/** The URL of a texture's image, as `texture-rect.ts` draws it. */
function imageSource(texture: Texture): string {
  const image = texture.image as { readonly src?: string; readonly toDataURL?: () => string } | null | undefined;
  if (image === null || image === undefined) return '';
  if (typeof image.src === 'string') return image.src;
  return typeof image.toDataURL === 'function' ? image.toDataURL() : '';
}

/**
 * `NOTIFICATION_DRAW` on the page: the frame of the texture's image at the destination rectangle,
 * mirrored in place when flipped, tinted by `self_modulate`.
 */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = SPRITES.get(entity) as SpriteState;
  let content = CONTENTS.get(entity);
  if (content === undefined) {
    content = element.ownerDocument.createElement('div');
    content.setAttribute('data-godot-content', '');
    content.style.position = 'absolute';
    CONTENTS.set(entity, content);
  }
  if (content.parentElement !== element) element.insertBefore(content, element.firstChild);
  const texture = state.texture;
  const source = texture === null ? '' : imageSource(texture);
  if (texture === null || source === '') {
    content.style.display = 'none';
    return;
  }
  const { src, dst } = rects(state, texture);
  const width = Math.abs(dst.size.x);
  const height = Math.abs(dst.size.y);
  content.style.display = '';
  content.style.left = `${String(dst.position.x)}px`;
  content.style.top = `${String(dst.position.y)}px`;
  content.style.width = `${String(width)}px`;
  content.style.height = `${String(height)}px`;
  content.style.transform = dst.size.x < 0 || dst.size.y < 0 ? `scale(${dst.size.x < 0 ? '-1' : '1'}, ${dst.size.y < 0 ? '-1' : '1'})` : '';
  content.style.backgroundImage = `url("${source}")`;
  content.style.backgroundRepeat = 'no-repeat';
  content.style.backgroundSize = `${String(get_width(texture))}px ${String(get_height(texture))}px`;
  content.style.backgroundPosition = `${String(-src.position.x)}px ${String(-src.position.y)}px`;
  content.style.filter = godot_canvas_item_self_filter(entity, element);
}

/**
 * Makes `entity` a Sprite2D, a node of that class, with its defaults (`scene/2d/sprite_2d.h:44-58`).
 *
 * @godot Sprite2D (protocol)
 * @source scene/2d/sprite_2d.cpp:98
 */
export function godot_sprite_2d_mount(entity: Object3D): void {
  SPRITES.set(entity, { texture: null, centered: true, offset: vector2(), flipH: false, flipV: false, hframes: 1, vframes: 1, frame: 0 });
  godot_node_2d_mount(entity, ['Sprite2D', 'Node2D', 'CanvasItem', 'Node'], { draw });
}

/**
 * @godot Sprite2D.set_texture
 * @source scene/2d/sprite_2d.cpp:177
 */
export function set_texture(self: object, p_texture: Texture | null): void {
  stateOf(self, 'set_texture').texture = p_texture;
}

/**
 * @godot Sprite2D.get_texture
 * @source scene/2d/sprite_2d.cpp:197
 */
export function get_texture(self: object): Texture | null {
  return stateOf(self, 'get_texture').texture;
}

/**
 * @godot Sprite2D.set_centered
 * @source scene/2d/sprite_2d.cpp:201
 */
export function set_centered(self: object, p_center: boolean): void {
  stateOf(self, 'set_centered').centered = p_center;
}

/**
 * @godot Sprite2D.is_centered
 * @source scene/2d/sprite_2d.cpp:211
 */
export function is_centered(self: object): boolean {
  return stateOf(self, 'is_centered').centered;
}

/**
 * @godot Sprite2D.set_offset
 * @source scene/2d/sprite_2d.cpp:215
 */
export function set_offset(self: object, p_offset: Vector2): void {
  stateOf(self, 'set_offset').offset = p_offset;
}

/**
 * @godot Sprite2D.get_offset
 * @source scene/2d/sprite_2d.cpp:225
 */
export function get_offset(self: object): Vector2 {
  return stateOf(self, 'get_offset').offset;
}

/**
 * @godot Sprite2D.set_flip_h
 * @source scene/2d/sprite_2d.cpp:229
 */
export function set_flip_h(self: object, p_flip: boolean): void {
  stateOf(self, 'set_flip_h').flipH = p_flip;
}

/**
 * @godot Sprite2D.is_flipped_h
 * @source scene/2d/sprite_2d.cpp:238
 */
export function is_flipped_h(self: object): boolean {
  return stateOf(self, 'is_flipped_h').flipH;
}

/**
 * @godot Sprite2D.set_flip_v
 * @source scene/2d/sprite_2d.cpp:242
 */
export function set_flip_v(self: object, p_flip: boolean): void {
  stateOf(self, 'set_flip_v').flipV = p_flip;
}

/**
 * @godot Sprite2D.is_flipped_v
 * @source scene/2d/sprite_2d.cpp:251
 */
export function is_flipped_v(self: object): boolean {
  return stateOf(self, 'is_flipped_v').flipV;
}

/**
 * A frame outside the sheet fails and is ignored.
 *
 * @godot Sprite2D.set_frame
 * @source scene/2d/sprite_2d.cpp:298
 */
export function set_frame(self: object, p_frame: number): void {
  const state = stateOf(self, 'set_frame');
  if (p_frame < 0 || p_frame >= state.vframes * state.hframes) return;
  state.frame = p_frame;
}

/**
 * @godot Sprite2D.get_frame
 * @source scene/2d/sprite_2d.cpp:310
 */
export function get_frame(self: object): number {
  return stateOf(self, 'get_frame').frame;
}

/**
 * Fewer than 1 fails; a frame past the sheet becomes 0.
 *
 * @godot Sprite2D.set_vframes
 * @source scene/2d/sprite_2d.cpp:325
 */
export function set_vframes(self: object, p_amount: number): void {
  const state = stateOf(self, 'set_vframes');
  if (p_amount < 1 || state.vframes === p_amount) return;
  state.vframes = p_amount;
  if (state.frame >= state.vframes * state.hframes) state.frame = 0;
}

/**
 * @godot Sprite2D.get_vframes
 * @source scene/2d/sprite_2d.cpp:342
 */
export function get_vframes(self: object): number {
  return stateOf(self, 'get_vframes').vframes;
}

/**
 * Fewer than 1 fails; with several rows the frame keeps its row and column when its column
 * remains, else becomes 0; a frame past the sheet becomes 0.
 *
 * @godot Sprite2D.set_hframes
 * @source scene/2d/sprite_2d.cpp:346
 */
export function set_hframes(self: object, p_amount: number): void {
  const state = stateOf(self, 'set_hframes');
  if (p_amount < 1 || state.hframes === p_amount) return;
  if (state.vframes > 1) {
    const column = state.frame % state.hframes;
    if (column >= p_amount) state.frame = 0;
    else state.frame = Math.trunc(state.frame / state.hframes) * p_amount + column;
  }
  state.hframes = p_amount;
  if (state.frame >= state.vframes * state.hframes) state.frame = 0;
}

/**
 * @godot Sprite2D.get_hframes
 * @source scene/2d/sprite_2d.cpp:374
 */
export function get_hframes(self: object): number {
  return stateOf(self, 'get_hframes').hframes;
}

/**
 * The frame's rectangle about the origin (`Size2i` of the texture over the frames, `(1, 1)` when
 * empty); `(0, 0, 1, 1)` without a texture.
 *
 * @godot Sprite2D.get_rect
 * @source scene/2d/sprite_2d.cpp:442
 */
export function get_rect(self: object): Rect2 {
  const state = stateOf(self, 'get_rect');
  if (state.texture === null) return rect2(0, 0, 1, 1);
  let w = Math.trunc(f32(get_width(state.texture) / state.hframes));
  let h = Math.trunc(f32(get_height(state.texture) / state.vframes));
  let x = state.offset.x;
  let y = state.offset.y;
  if (state.centered) {
    x = f32(x - f32(w / 2));
    y = f32(y - f32(h / 2));
  }
  if (w === 0 && h === 0) {
    w = 1;
    h = 1;
  }
  return rect2(x, y, w, h);
}
