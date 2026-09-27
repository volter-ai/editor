/**
 * @godot-class PhysicsServer3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsServer3D` singleton's public members (`servers/physics_3d/physics_server_3d.cpp`,
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) on Rapier's `<Physics>` world:
 * `space_get_direct_state` is the space's queries, and `body_test_motion` is a shape cast of the
 * body's first collider along the motion (Rapier's `castShape`), reporting how far it travels and
 * what it meets.
 */

import { godot_collision_object_body, godot_collision_object_layers, godot_collision_object_of_collider, godot_physics_world } from './collision-object-3d';
import { godot_node_entity } from './node';
import { godot_physics_body_3d_collides } from './physics-body-3d';
import type { PhysicsTestMotionParameters3D } from './physics-test-motion-parameters-3d';
import { godot_test_motion_result, type PhysicsTestMotionResult3D } from './physics-test-motion-result-3d';
import { construct as vector3, op_multiply, op_subtract } from './vector3';
import { godot_world_3d_direct_state, type PhysicsDirectSpaceState3D, type PhysicsSpace3D } from './world-3d';

/**
 * @godot PhysicsServer3D.space_get_direct_state
 * @source modules/godot_physics_3d/godot_physics_server_3d.cpp:191
 */
export function space_get_direct_state(space: PhysicsSpace3D): PhysicsDirectSpaceState3D {
  return godot_world_3d_direct_state(space);
}

/**
 * Casts the body's first collider from `parameters.from` along `parameters.motion`; true when it
 * meets something its mask takes, filling `result` with the travel, the remainder and the contact.
 *
 * @godot PhysicsServer3D.body_test_motion
 * @source modules/godot_physics_3d/godot_space_3d.cpp:652
 */
export function body_test_motion(body: object, parameters: PhysicsTestMotionParameters3D, result?: PhysicsTestMotionResult3D): boolean {
  const entity = godot_node_entity(body);
  const rapier = godot_collision_object_body(entity);
  const world = godot_physics_world();
  const collider = rapier !== undefined && rapier.numColliders() > 0 ? rapier.collider(0) : undefined;
  const out = result ?? godot_test_motion_result();
  out.travel = parameters.motion;
  out.remainder = vector3();
  out.collisions = [];
  out.collision_count = 0;
  if (world === undefined || collider === undefined) return false;
  const mask = godot_collision_object_layers(entity).mask;
  const origin = parameters.from.origin;
  const hit = world.castShape(
    { x: origin.x, y: origin.y, z: origin.z },
    collider.rotation(),
    parameters.motion,
    collider.shape,
    parameters.margin,
    1,
    true,
    undefined,
    undefined,
    collider,
    rapier,
    (other) => {
      const node = godot_collision_object_of_collider(other);
      if (node === undefined || other.isSensor() || parameters.exclude_bodies.includes(node)) return false;
      return (mask & godot_collision_object_layers(node).layer) !== 0 && godot_physics_body_3d_collides(entity, node);
    },
  );
  if (hit === null) return false;
  const node = godot_collision_object_of_collider(hit.collider) ?? null;
  out.travel = op_multiply(parameters.motion, hit.time_of_impact);
  out.remainder = op_subtract(parameters.motion, out.travel);
  out.collision_safe_fraction = hit.time_of_impact;
  out.collision_unsafe_fraction = hit.time_of_impact;
  out.collisions = [
    {
      position: vector3(hit.witness2.x, hit.witness2.y, hit.witness2.z),
      normal: vector3(hit.normal2.x, hit.normal2.y, hit.normal2.z),
      collider_velocity: vector3(),
      collider_angular_velocity: vector3(),
      depth: 0,
      local_shape: 0,
      collider_id: node,
      collider: node,
      collider_shape: 0,
    },
  ];
  out.collision_count = 1;
  return true;
}
