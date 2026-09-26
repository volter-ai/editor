/**
 * @godot-class CanvasLayer
 * @role BINDING
 *
 * Godot 4.7's `CanvasLayer` (`scene/main/canvas_layer.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the page's DOM: a layer draws as one
 * element over the viewport's canvas, stacked by its `layer` (CSS `z-index`), holding the elements
 * of its canvas items. Its node is a non-spatial three `Group` (`node.ts`); the layer's state lives
 * here, keyed by the entity. The transform is Godot's: offset, rotation and scale composed by
 * `set_rotation_and_scale` and `set_origin` (`_update_xform`); `follow_viewport` is not bound, so
 * the final transform is the transform.
 */

import type { Object3D } from 'three';
import { godot_canvas_item_layer, godot_canvas_item_propagate_visibility } from './canvas-item';
import { godot_node_entity } from './node';
import { construct as transform2d, type Transform2D } from './transform-2d';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

interface CanvasLayerState {
  layer: number;
  visible: boolean;
  offset: Vector2;
  rotation: number;
  scale: Vector2;
  transform: Transform2D;
}

const LAYERS = new WeakMap<Object3D, CanvasLayerState>();

function stateOf(self: object, member: string): CanvasLayerState {
  const state = LAYERS.get(godot_node_entity(self) as Object3D);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a CanvasLayer`);
  return state;
}

/**
 * Makes `entity` a canvas layer with CanvasLayer's defaults (`scene/main/canvas_layer.h:41-55`):
 * layer 1, visible, the identity transform.
 *
 * @godot CanvasLayer (protocol)
 * @source scene/main/canvas_layer.cpp:359
 */
export function godot_canvas_layer_mount(entity: Object3D): void {
  const state: CanvasLayerState = { layer: 1, visible: true, offset: vector2(), rotation: 0, scale: vector2(1, 1), transform: transform2d() };
  LAYERS.set(entity, state);
  godot_canvas_item_layer(entity, { layer: () => state.layer, visible: () => state.visible, finalTransform: () => state.transform });
}

/**
 * `transform.set_rotation_and_scale(rot, scale)` then `set_origin(ofs)`
 * (`core/math/transform_2d.h:242`).
 */
function updateTransform(state: CanvasLayerState): void {
  const cos = f32(Math.cos(state.rotation));
  const sin = f32(Math.sin(state.rotation));
  state.transform = transform2d(
    vector2(f32(cos * state.scale.x), f32(sin * state.scale.x)),
    vector2(f32(-sin * state.scale.y), f32(cos * state.scale.y)),
    state.offset,
  );
}

/**
 * @godot CanvasLayer.set_layer
 * @source scene/main/canvas_layer.cpp:40
 */
export function set_layer(self: object, p_xform: number): void {
  stateOf(self, 'set_layer').layer = p_xform;
}

/**
 * @godot CanvasLayer.get_layer
 * @source scene/main/canvas_layer.cpp:48
 */
export function get_layer(self: object): number {
  return stateOf(self, 'get_layer').layer;
}

/**
 * The layer's child canvas items read it as their parent's visibility, and each handles the change
 * (`_propagate_visibility_changed`).
 *
 * @godot CanvasLayer.set_visible
 * @source scene/main/canvas_layer.cpp:52
 */
export function set_visible(self: object, p_visible: boolean): void {
  const state = stateOf(self, 'set_visible');
  if (state.visible === p_visible) return;
  state.visible = p_visible;
  for (const child of [...(godot_node_entity(self) as Object3D).children]) godot_canvas_item_propagate_visibility(child);
}

/**
 * @godot CanvasLayer.is_visible
 * @source scene/main/canvas_layer.cpp:78
 */
export function is_visible(self: object): boolean {
  return stateOf(self, 'is_visible').visible;
}

/**
 * @godot CanvasLayer.show
 * @source scene/main/canvas_layer.cpp:70
 */
export function show(self: object): void {
  set_visible(self, true);
}

/**
 * @godot CanvasLayer.hide
 * @source scene/main/canvas_layer.cpp:74
 */
export function hide(self: object): void {
  set_visible(self, false);
}

/**
 * @godot CanvasLayer.set_offset
 * @source scene/main/canvas_layer.cpp:121
 */
export function set_offset(self: object, p_offset: Vector2): void {
  const state = stateOf(self, 'set_offset');
  state.offset = p_offset;
  updateTransform(state);
}

/**
 * @godot CanvasLayer.get_offset
 * @source scene/main/canvas_layer.cpp:130
 */
export function get_offset(self: object): Vector2 {
  return stateOf(self, 'get_offset').offset;
}

/**
 * @godot CanvasLayer.set_rotation
 * @source scene/main/canvas_layer.cpp:138
 */
export function set_rotation(self: object, p_radians: number): void {
  const state = stateOf(self, 'set_rotation');
  state.rotation = f32(p_radians);
  updateTransform(state);
}

/**
 * @godot CanvasLayer.get_rotation
 * @source scene/main/canvas_layer.cpp:147
 */
export function get_rotation(self: object): number {
  return stateOf(self, 'get_rotation').rotation;
}

/**
 * @godot CanvasLayer.set_scale
 * @source scene/main/canvas_layer.cpp:155
 */
export function set_scale(self: object, p_scale: Vector2): void {
  const state = stateOf(self, 'set_scale');
  state.scale = p_scale;
  updateTransform(state);
}

/**
 * @godot CanvasLayer.get_scale
 * @source scene/main/canvas_layer.cpp:164
 */
export function get_scale(self: object): Vector2 {
  return stateOf(self, 'get_scale').scale;
}

/**
 * @godot CanvasLayer.get_transform
 * @source scene/main/canvas_layer.cpp:90
 */
export function get_transform(self: object): Transform2D {
  return stateOf(self, 'get_transform').transform;
}

/**
 * The transform without `follow_viewport` (not bound).
 *
 * @godot CanvasLayer.get_final_transform
 * @source scene/main/canvas_layer.cpp:94
 */
export function get_final_transform(self: object): Transform2D {
  return stateOf(self, 'get_final_transform').transform;
}
