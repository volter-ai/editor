/**
 * @godot-class StaticBody3D
 * @role BINDING
 *
 * Godot 4.7's `StaticBody3D` (`scene/3d/physics/static_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a fixed @react-three/rapier body
 * (`collision-object-3d.ts`). Its material override is its colliders' friction and restitution;
 * the scene's own is its `userData`'s.
 */

import { Group, type Object3D } from 'three';
import { godot_collision_object_code_body, godot_collision_object_colliders } from './collision-object-3d';
import { godot_node_adopt, godot_node_entity } from './node';
import { godot_physics_material_apply, godot_physics_material_of, type PhysicsMaterial } from './physics-material';

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
  for (const collider of godot_collision_object_colliders(entity)) godot_physics_material_apply(physics_material_override, collider);
}

/**
 * @godot StaticBody3D.get_physics_material_override
 * @source scene/3d/physics/static_body_3d.cpp:69
 */
export function get_physics_material_override(self: object): PhysicsMaterial | null {
  return materialOf(godot_node_entity(self));
}

/**
 * A new StaticBody3D (`StaticBody3D.new()`): a fixed Rapier body while it is in the tree
 * (`godot_collision_object_code_body`), as no `<RigidBody>` renders it.
 *
 * @godot StaticBody3D.StaticBody3D
 * @source scene/3d/physics/static_body_3d.cpp:248
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'spatial', classes: ['StaticBody3D', 'PhysicsBody3D', 'CollisionObject3D', 'Node3D', 'Node', 'Object'] });
  godot_collision_object_code_body(entity, 'fixed');
  return entity;
}
