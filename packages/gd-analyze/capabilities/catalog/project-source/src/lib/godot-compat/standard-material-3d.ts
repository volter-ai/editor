/**
 * @godot-class StandardMaterial3D
 * @role PROTOCOL
 *
 * Godot 4.7's `StandardMaterial3D` (`scene/resources/material.h:912`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a `BaseMaterial3D` with separate metallic, roughness
 * and occlusion textures. Its members are BaseMaterial3D's (`base-material-3d.ts`).
 */

import { type BaseMaterial3D, godot_base_material_3d_initial } from './base-material-3d';

/**
 * `StandardMaterial3D()`: `BaseMaterial3D(false)`'s initial parameters.
 *
 * @godot StandardMaterial3D (protocol)
 * @source scene/resources/material.h:920
 */
export function construct(): BaseMaterial3D {
  return godot_base_material_3d_initial();
}
