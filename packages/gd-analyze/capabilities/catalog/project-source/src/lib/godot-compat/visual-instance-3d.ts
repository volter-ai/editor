/**
 * @godot-class VisualInstance3D
 * @role BINDING
 *
 * Godot 4.7's `VisualInstance3D` render layers (`scene/3d/visual_instance_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto three's layers: an instance is drawn by a
 * camera whose cull mask shares a bit with its layer mask (`RendererSceneCull`), as three draws an
 * object whose `layers` share a bit with the camera's. Godot's 20 render layers are three's layers
 * 0 to 19; a Camera3D's cull mask is its camera's layers (`camera-3d.ts`).
 */

import type { Object3D } from 'three';

const LAYERS = new WeakMap<Object3D, number>();

/**
 * @godot VisualInstance3D.set_layer_mask
 * @source scene/3d/visual_instance_3d.cpp:130
 */
export function set_layer_mask(self: Object3D, mask: number): void {
  const value = mask >>> 0;
  LAYERS.set(self, value);
  self.layers.mask = value;
}

/**
 * Layer 1 until set (`visual_instance_3d.h:44`).
 *
 * @godot VisualInstance3D.get_layer_mask
 * @source scene/3d/visual_instance_3d.cpp:135
 */
export function get_layer_mask(self: Object3D): number {
  return LAYERS.get(self) ?? 1;
}
