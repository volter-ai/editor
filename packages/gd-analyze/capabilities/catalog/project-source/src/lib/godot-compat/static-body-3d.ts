/**
 * @godot-class StaticBody3D
 * @role BINDING
 *
 * Godot 4.7's `StaticBody3D` (`scene/3d/physics/static_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a fixed @react-three/rapier body
 * (`collision-object-3d.ts`). Its material override is its colliders' friction and restitution;
 * the scene's own is its `userData`'s.
 */

import type { Object3D } from 'three';
import { godot_collision_object_colliders } from './collision-object-3d';
import { godot_node_entity } from './node';
import { godot_physics_material_computed, godot_physics_material_of, type PhysicsMaterial } from './physics-material';

const MATERIAL = new WeakMap<object, PhysicsMaterial | null>();

function materialOf(entity: object): PhysicsMaterial | null {
  if (!MATERIAL.has(entity)) {
    const data = ((entity as Object3D).userData ?? {}) as Readonly<Record<string, unknown>>;
    const authored = data['physics_material_override'];
    MATERIAL.set(entity, authored === undefined ? null : godot_physics_material_of(authored as Readonly<Record<string, unknown>>));
  }
  return MATERIAL.get(entity) ?? null;
}

/**
 * @godot StaticBody3D.set_physics_material_override
 * @source scene/3d/physics/static_body_3d.cpp:56
 */
export function set_physics_material_override(self: object, physics_material_override: PhysicsMaterial | null): void {
  const entity = godot_node_entity(self);
  MATERIAL.set(entity, physics_material_override);
  if (physics_material_override === null) return;
  const { friction, bounce } = godot_physics_material_computed(physics_material_override);
  for (const collider of godot_collision_object_colliders(entity)) {
    collider.setFriction(friction);
    collider.setRestitution(bounce);
  }
}

/**
 * @godot StaticBody3D.get_physics_material_override
 * @source scene/3d/physics/static_body_3d.cpp:69
 */
export function get_physics_material_override(self: object): PhysicsMaterial | null {
  return materialOf(godot_node_entity(self));
}
