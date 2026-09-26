/**
 * @godot-class PhysicsServer3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsServer3D` public members this lane uses, bound onto the Rapier world as the
 * web platform's physics (`modules/godot_physics_3d/godot_physics_server_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). A singleton: no receiver. It never reimplements
 * the server; each member reads the Rapier world `world-3d.ts` holds.
 */

import { godot_world_3d_direct_state, type PhysicsDirectSpaceState3D, type PhysicsSpace3D } from './world-3d';

/**
 * @godot PhysicsServer3D.space_get_direct_state
 * @source modules/godot_physics_3d/godot_physics_server_3d.cpp:191
 */
export function space_get_direct_state(space: PhysicsSpace3D): PhysicsDirectSpaceState3D {
  return godot_world_3d_direct_state(space);
}
