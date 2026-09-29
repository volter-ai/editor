/**
 * @godot-class Sprite3D
 * @role BINDING
 *
 * Godot 4.7's `Sprite3D` (`scene/3d/sprite_3d.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * a SpriteBase3D drawing its `texture`, or one frame of it (`hframes` by `vframes`), or its
 * `region_rect` when `region_enabled`.
 */

import type { ReactElement } from 'react';
import { Mesh } from 'three';
import { construct as rect2, type Rect2 } from './rect2';
import { godot_node_adopt, godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { godot_sprite_base_3d_mount, godot_sprite_base_3d_props, godot_sprite_base_3d_redraw } from './sprite-base-3d';
import { godot_atlas_texture_region } from './atlas-texture';
import { construct as vector2i, type Vector2i } from './vector2i';

interface Sprite3DState {
  texture: object | null;
  hframes: number;
  vframes: number;
  frame: number;
  regionEnabled: boolean;
  regionRect: Rect2;
}

const SPRITES = new WeakMap<object, Sprite3DState>();

function stateOf(self: object, member: string): Sprite3DState {
  const state = SPRITES.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Sprite3D`);
  return state;
}

/**
 * Makes `entity` a Sprite3D (`Sprite3D::_draw`, `sprite_3d.cpp:510`).
 *
 * @godot Sprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:510
 */
export function godot_sprite_3d_mount(entity: Mesh): void {
  const state: Sprite3DState = { texture: null, hframes: 1, vframes: 1, frame: 0, regionEnabled: false, regionRect: rect2() };
  SPRITES.set(entity, state);
  godot_sprite_base_3d_mount(
    entity,
    () => state.texture,
    (texture) => {
      if (state.regionEnabled) return { x: state.regionRect.position.x, y: state.regionRect.position.y, width: state.regionRect.size.x, height: state.regionRect.size.y };
      if (state.hframes === 1 && state.vframes === 1) return undefined;
      const whole = godot_atlas_texture_region(texture);
      if (whole === null) return undefined;
      const width = whole.width / state.hframes;
      const height = whole.height / state.vframes;
      return { x: (state.frame % state.hframes) * width, y: Math.trunc(state.frame / state.hframes) * height, width, height };
    },
  );
}

/**
 * A new Sprite3D (`Sprite3D.new()`).
 *
 * @godot Sprite3D.Sprite3D
 * @source scene/3d/sprite_3d.cpp:760
 */
export function construct(): Mesh {
  const entity = new Mesh();
  godot_node_adopt(entity, { kind: 'spatial', classes: ['Sprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'] });
  godot_sprite_3d_mount(entity);
  return entity;
}

/**
 * @godot Sprite3D.set_texture
 * @source scene/3d/sprite_3d.cpp:607
 */
export function set_texture(self: object, texture: object | null): void {
  stateOf(self, 'set_texture').texture = texture;
  godot_sprite_base_3d_redraw(self);
}

/**
 * @godot Sprite3D.get_texture
 * @source scene/3d/sprite_3d.cpp:626
 */
export function get_texture(self: object): object | null {
  return stateOf(self, 'get_texture').texture;
}

/**
 * @godot Sprite3D.set_hframes
 * @source scene/3d/sprite_3d.cpp:680
 */
export function set_hframes(self: object, hframes: number): void {
  if (hframes <= 0) return;
  stateOf(self, 'set_hframes').hframes = hframes;
  godot_sprite_base_3d_redraw(self);
}

/**
 * @godot Sprite3D.set_vframes
 * @source scene/3d/sprite_3d.cpp:667
 */
export function set_vframes(self: object, vframes: number): void {
  if (vframes <= 0) return;
  stateOf(self, 'set_vframes').vframes = vframes;
  godot_sprite_base_3d_redraw(self);
}

/**
 * A frame outside `0..hframes*vframes-1` fails.
 *
 * @godot Sprite3D.set_frame
 * @source scene/3d/sprite_3d.cpp:640
 */
export function set_frame(self: object, frame: number): void {
  const state = stateOf(self, 'set_frame');
  if (frame < 0 || frame >= state.hframes * state.vframes) return;
  state.frame = frame;
  godot_sprite_base_3d_redraw(self);
}

/**
 * @godot Sprite3D.get_frame
 * @source scene/3d/sprite_3d.cpp:652
 */
export function get_frame(self: object): number {
  return stateOf(self, 'get_frame').frame;
}

/**
 * @godot Sprite3D.set_frame_coords
 * @source scene/3d/sprite_3d.cpp:656
 */
export function set_frame_coords(self: object, coords: Vector2i): void {
  const state = stateOf(self, 'set_frame_coords');
  set_frame(self, coords.y * state.hframes + coords.x);
}

/**
 * @godot Sprite3D.get_frame_coords
 * @source scene/3d/sprite_3d.cpp:662
 */
export function get_frame_coords(self: object): Vector2i {
  const state = stateOf(self, 'get_frame_coords');
  return vector2i(state.frame % state.hframes, Math.trunc(state.frame / state.hframes));
}

/**
 * @godot Sprite3D.set_region_enabled
 * @source scene/3d/sprite_3d.cpp:582
 */
export function set_region_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_region_enabled').regionEnabled = enabled;
  godot_sprite_base_3d_redraw(self);
}

/**
 * @godot Sprite3D.set_region_rect
 * @source scene/3d/sprite_3d.cpp:596
 */
export function set_region_rect(self: object, rect: Rect2): void {
  stateOf(self, 'set_region_rect').regionRect = rect;
  godot_sprite_base_3d_redraw(self);
}

const SPRITE_3D = {
  create: () => new Mesh(),
  classes: ['Sprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: godot_sprite_3d_mount,
  props: new Map<string, GodotElementProp<Mesh>>([
    ...godot_sprite_base_3d_props(),
    ['texture', (entity, value: object | null) => set_texture(entity, value)],
    ['hframes', (entity, value: number) => set_hframes(entity, value)],
    ['vframes', (entity, value: number) => set_vframes(entity, value)],
    ['frame', (entity, value: number) => set_frame(entity, value)],
    ['regionEnabled', (entity, value: boolean) => set_region_enabled(entity, value)],
    ['regionRect', (entity, value: readonly [number, number, number, number]) => set_region_rect(entity, rect2(...value))],
  ]),
};

/**
 * A Sprite3D as a scene writes it: `<GodotSprite3D texture={t} pixelSize={0.01} />`.
 *
 * @godot Sprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:700
 */
export function GodotSprite3D(props: GodotElementProps<Mesh>): ReactElement {
  return useGodotElement(SPRITE_3D, props);
}
