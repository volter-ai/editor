/**
 * @godot-class OmniLight3D
 * @role BINDING
 *
 * Godot 4.7's `OmniLight3D` (`scene/3d/light_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `PointLight`; its range and
 * attenuation are Light3D parameters (`light-3d.ts`).
 */

import type { PointLight } from 'three';
import { godot_light_3d_mount } from './light-3d';

/**
 * An omni light as `OmniLight3D()` creates it (`light_3d.cpp:661`): Light3D's parameters.
 *
 * @godot OmniLight3D (protocol)
 * @source scene/3d/light_3d.cpp:661
 */
export function godot_omni_light_3d_mount(self: PointLight): void {
  godot_light_3d_mount(self);
}
