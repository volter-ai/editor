/**
 * @godot-class StaticBody3D
 * @role BINDING
 *
 * Godot 4.7's `StaticBody3D` (`scene/3d/physics/static_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a collision object in `BODY_MODE_STATIC`, a fixed
 * Rapier body (`collision-object-3d.ts`).
 */

import { godot_collision_object_adopt } from './collision-object-3d';

/**
 * Registers a node as a StaticBody3D (`PhysicsBody3D(PhysicsServer3D::BODY_MODE_STATIC)`).
 *
 * @godot StaticBody3D (protocol)
 * @source scene/3d/physics/static_body_3d.cpp:251
 */
export function godot_static_body_3d_adopt(entity: object): void {
  godot_collision_object_adopt(entity, 'static');
}
