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
import { godot_node_class_reader } from './node';

const OMNI_LIGHT_3D = Object.freeze(['OmniLight3D', 'Light3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object']);

// A scene's `<pointLight>` is an OmniLight3D.
godot_node_class_reader((entity) =>
  (entity as { readonly isPointLight?: boolean }).isPointLight === true && (entity as { readonly name?: string }).name !== '' ? OMNI_LIGHT_3D : undefined,
);

/**
 * An omni light as `OmniLight3D()` creates it (`light_3d.cpp:661`): Light3D's parameters.
 *
 * @godot OmniLight3D (protocol)
 * @source scene/3d/light_3d.cpp:661
 */
export function godot_omni_light_3d_mount(self: PointLight): void {
  godot_light_3d_mount(self);
}
