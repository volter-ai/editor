/**
 * @godot-class Sprite3D
 * @role BINDING
 *
 * Godot 4.7's `Sprite3D` (`scene/3d/sprite_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `Mesh` through `sprite-base-3d.ts`:
 * its texture drawn whole as the quad (`_draw`), redrawn when the texture changes. A scene writes it
 * as `<GodotSprite3D texture={…} />`, its transform three's.
 *
 * Bound: `texture`, what the corpus reaches. Not bound: the sprite sheet (`hframes`, `vframes`,
 * `frame`, `frame_coords`) and the region, which keep Godot's defaults (one frame, no region) and
 * are drawn as such.
 */

import type { ReactElement } from 'react';
import { Mesh, type Texture } from 'three';
import { godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as rect2, type Rect2 } from './rect2';
import { godot_object_signal } from './signal';
import {
  godot_sprite_base_3d_draw_texture_rect,
  godot_sprite_base_3d_mount,
  godot_sprite_base_3d_origin,
  godot_sprite_base_3d_props,
  godot_sprite_base_3d_queue_redraw,
  godot_sprite_base_3d_set_based,
} from './sprite-base-3d';
import { get_size as texture_size, godot_texture_2d_connect_changed, godot_texture_2d_disconnect_changed } from './texture-2d';
import { construct as vector2 } from './vector2';

const f32 = Math.fround;

interface Sprite3DState {
  texture: Texture | null;
  /** `_queue_redraw` as a callable, connected to the texture's `changed`. */
  readonly redraw: () => void;
}

const SPRITES = new WeakMap<Mesh, Sprite3DState>();

function stateOf(self: object, member: string): Sprite3DState {
  const state = SPRITES.get(godot_node_entity(self) as Mesh);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Sprite3D`);
  return state;
}

/** `Sprite3D::_draw` (`sprite_3d.cpp:798`): the texture's one frame, centred. */
function draw(entity: Mesh): void {
  const state = SPRITES.get(entity) as Sprite3DState;
  godot_sprite_base_3d_set_based(entity, true);
  const texture = state.texture;
  if (texture === null) {
    godot_sprite_base_3d_set_based(entity, false);
    return;
  }
  const size = texture_size(texture);
  if (size.x === 0 || size.y === 0) return;
  // One frame (`hframes` = `vframes` = 1, `frame` 0) of the whole texture, no region.
  const frameSize = vector2(f32(size.x / 1), f32(size.y / 1));
  const origin = godot_sprite_base_3d_origin(frameSize);
  godot_sprite_base_3d_draw_texture_rect(entity, texture, rect2(origin, frameSize), rect2(vector2(0, 0), frameSize));
}

/** `Sprite3D::get_item_rect` (`sprite_3d.cpp:957`). */
function itemRect(entity: Mesh): Rect2 {
  const texture = (SPRITES.get(entity) as Sprite3DState).texture;
  if (texture === null) return rect2(0, 0, 1, 1);
  const size = texture_size(texture);
  let s = vector2(f32(size.x / 1), f32(size.y / 1));
  const ofs = godot_sprite_base_3d_origin(s);
  if (s.x === 0 && s.y === 0) s = vector2(1, 1);
  return rect2(ofs, s);
}

/**
 * Makes `entity` a Sprite3D (`Sprite3D::Sprite3D`, `sprite_3d.cpp:1030`): no texture.
 *
 * @godot Sprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:1030
 */
export function godot_sprite_3d_mount(entity: Mesh): void {
  const state: Sprite3DState = { texture: null, redraw: () => godot_sprite_base_3d_queue_redraw(entity) };
  SPRITES.set(entity, state);
  godot_sprite_base_3d_mount(entity, { draw, itemRect });
}

/**
 * Listens to the new texture's `changed`, queues a redraw and emits `texture_changed`.
 *
 * @godot Sprite3D.set_texture
 * @source scene/3d/sprite_3d.cpp:832
 */
export function set_texture(self: object, texture: Texture | null): void {
  const state = stateOf(self, 'set_texture');
  if (texture === state.texture) return;
  if (state.texture !== null) godot_texture_2d_disconnect_changed(state.texture, state.redraw);
  state.texture = texture;
  if (texture !== null) godot_texture_2d_connect_changed(texture, state.redraw);
  godot_sprite_base_3d_queue_redraw(self);
  godot_object_signal(godot_node_entity(self) as object, 'texture_changed').emit();
}

/**
 * @godot Sprite3D.get_texture
 * @source scene/3d/sprite_3d.cpp:848
 */
export function get_texture(self: object): Texture | null {
  return stateOf(self, 'get_texture').texture;
}

const SPRITE_3D = {
  create: () => new Mesh(),
  classes: ['Sprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: godot_sprite_3d_mount,
  props: new Map<string, GodotElementProp<Mesh>>([['texture', (entity, value: Texture | null) => set_texture(entity, value)], ...godot_sprite_base_3d_props()]),
};

/**
 * A Sprite3D as a scene writes it: `<GodotSprite3D texture={selector} />`.
 *
 * @godot Sprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:1030
 */
export function GodotSprite3D(props: GodotElementProps<Mesh>): ReactElement {
  return useGodotElement(SPRITE_3D, props);
}
