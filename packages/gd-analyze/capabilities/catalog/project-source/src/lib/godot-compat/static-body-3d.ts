/**
 * @godot-class StaticBody3D
 * @role BINDING
 *
 * Godot 4.7's `StaticBody3D` (`scene/3d/physics/static_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a collision object in `BODY_MODE_STATIC`, a fixed
 * Rapier body (`collision-object-3d.ts`).
 */

import { godot_collision_object_adopt, godot_collision_object_material } from './collision-object-3d';
import { godot_node_entity } from './node';
import type { PhysicsMaterial } from './physics-material';

/**
 * Registers a node as a StaticBody3D (`PhysicsBody3D(PhysicsServer3D::BODY_MODE_STATIC)`).
 *
 * @godot StaticBody3D (protocol)
 * @source scene/3d/physics/static_body_3d.cpp:251
 */
export function godot_static_body_3d_adopt(entity: object): void {
  godot_collision_object_adopt(entity, 'static');
}

const MATERIAL = new WeakMap<object, PhysicsMaterial | null>();

/**
 * @godot StaticBody3D.set_physics_material_override
 * @source scene/3d/physics/static_body_3d.cpp:56
 */
export function set_physics_material_override(self: object, physics_material_override: PhysicsMaterial | null): void {
  const entity = godot_node_entity(self);
  MATERIAL.set(entity, physics_material_override);
  godot_collision_object_material(entity, physics_material_override);
}

/**
 * @godot StaticBody3D.get_physics_material_override
 * @source scene/3d/physics/static_body_3d.cpp:69
 */
export function get_physics_material_override(self: object): PhysicsMaterial | null {
  return MATERIAL.get(godot_node_entity(self)) ?? null;
}
