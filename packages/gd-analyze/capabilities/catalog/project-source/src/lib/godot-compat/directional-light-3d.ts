/**
 * @godot-class DirectionalLight3D
 * @role BINDING
 *
 * Godot 4.7's `DirectionalLight3D` (`scene/3d/light_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `DirectionalLight`. Godot's
 * directional light shines along its node's -Z (`rasterizer_scene_gles3.cpp:1741`); three's shines
 * from the light toward its target, so the light's target is a child one unit down its -Z.
 */

import { type DirectionalLight, Object3D } from 'three';
import { godot_light_3d_mount, godot_light_3d_sky_mode } from './light-3d';

/**
 * A directional light as `DirectionalLight3D()` creates it (`light_3d.cpp:612`): shadow max
 * distance 100, fade start 0.8, normal bias 2, intensity 100000 and specular 1 over Light3D's
 * parameters, its target along -Z.
 *
 * @godot DirectionalLight3D (protocol)
 * @source scene/3d/light_3d.cpp:612
 */
export function godot_directional_light_3d_mount(self: DirectionalLight): void {
  const target = new Object3D();
  target.position.set(0, 0, -1);
  self.add(target);
  self.target = target;
  godot_light_3d_mount(self, { 9: 100, 13: 0.8, 14: 2, 20: 100000, 3: 1 });
}

/**
 * @godot DirectionalLight3D.set_sky_mode
 * @source scene/3d/light_3d.cpp:550
 */
export function set_sky_mode(self: DirectionalLight, mode: number): void {
  godot_light_3d_sky_mode(self, mode);
}

/**
 * @godot DirectionalLight3D.get_sky_mode
 * @source scene/3d/light_3d.cpp:555
 */
export function get_sky_mode(self: DirectionalLight): number {
  return godot_light_3d_sky_mode(self);
}
