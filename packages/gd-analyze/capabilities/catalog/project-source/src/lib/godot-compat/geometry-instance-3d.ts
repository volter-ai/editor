/**
 * @godot-class GeometryInstance3D
 * @role BINDING
 *
 * Godot 4.7's `GeometryInstance3D` shadow casting (`scene/3d/visual_instance_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto three's `castShadow`: an instance casts
 * unless its setting is `SHADOW_CASTING_SETTING_OFF`, and every instance receives shadows (the
 * scene shader samples them for every lit surface), which three enables with `receiveShadow`.
 * `SHADOWS_ONLY` (cast, not drawn) draws in three as well: three draws no shadow for a hidden
 * object.
 */

import type { Object3D } from 'three';

const SETTING = new WeakMap<Object3D, number>();

/**
 * A geometry instance as Godot creates it: casting (`SHADOW_CASTING_SETTING_ON`,
 * `visual_instance_3d.h:124`) and receiving shadows.
 *
 * @godot GeometryInstance3D (protocol)
 * @source scene/3d/visual_instance_3d.h:124
 */
export function godot_geometry_instance_3d_mount(self: Object3D): void {
  self.castShadow = (SETTING.get(self) ?? 1) !== 0;
  self.receiveShadow = true;
}

/**
 * @godot GeometryInstance3D.set_cast_shadows_setting
 * @source scene/3d/visual_instance_3d.cpp:373
 */
export function set_cast_shadows_setting(self: Object3D, setting: number): void {
  SETTING.set(self, setting);
  self.castShadow = setting !== 0;
}

/**
 * @godot GeometryInstance3D.get_cast_shadows_setting
 * @source scene/3d/visual_instance_3d.cpp:379
 */
export function get_cast_shadows_setting(self: Object3D): number {
  return SETTING.get(self) ?? 1;
}
