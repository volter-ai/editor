/**
 * @godot-class SpotLight3D
 * @role BINDING
 *
 * Godot 4.7's `SpotLight3D` (`scene/3d/light_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as three's `SpotLight`: Light3D's parameters
 * (`light-3d.ts`), shining down the node's -Z as Godot's does, where three's shines toward its
 * target.
 */

import { Object3D, type SpotLight } from 'three';

const AIMED = new WeakSet<SpotLight>();

/**
 * Aims three's light down the node's -Z: its target a nameless child (not a node) one unit down
 * -Z, added once however often R3F reports an update.
 *
 * @godot SpotLight3D (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:1741
 */
export function godot_spot_light_3d_aim(self: SpotLight): void {
  if (AIMED.has(self)) return;
  AIMED.add(self);
  const target = new Object3D();
  target.position.set(0, 0, -1);
  self.add(target);
  self.target = target;
}
