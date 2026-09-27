/**
 * @godot-class World3D
 * @role BINDING
 *
 * Godot 4.7's `World3D` (`scene/resources/3d/world_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the main viewport's world, whose physics space is
 * the Rapier world of the `<Physics>` the game renders (`godot_physics_attach`,
 * `collision-object-3d.ts`). Rapier owns and steps it.
 */

import type { World } from '@dimforge/rapier3d-compat';
import { godot_physics_world } from './collision-object-3d';
import { godot_node_3d_world_source } from './node-3d';

/** A physics space: its Rapier world, read when a query runs. */
export interface PhysicsSpace3D {
  readonly world: World | undefined;
}

export interface World3D {
  readonly space: PhysicsSpace3D;
}

export interface PhysicsDirectSpaceState3D {
  readonly space: PhysicsSpace3D;
}

const SPACE: PhysicsSpace3D = Object.freeze({
  get world(): World | undefined {
    return godot_physics_world();
  },
});
const WORLD: World3D = Object.freeze({ space: SPACE });
const DIRECT: PhysicsDirectSpaceState3D = Object.freeze({ space: SPACE });

/**
 * The main World3D (a Node3D's `get_world_3d()` inside the main viewport).
 *
 * @godot World3D (protocol)
 * @source scene/3d/node_3d.cpp:1082
 */
export function godot_world_3d(): World3D {
  return WORLD;
}

/**
 * A space's direct state.
 *
 * @godot World3D (protocol)
 * @source scene/resources/3d/world_3d.cpp:152
 */
export function godot_world_3d_direct_state(_space: PhysicsSpace3D): PhysicsDirectSpaceState3D {
  return DIRECT;
}

godot_node_3d_world_source(godot_world_3d);

/**
 * @godot World3D.get_space
 * @source scene/resources/3d/world_3d.cpp:52
 */
export function get_space(self: World3D): PhysicsSpace3D {
  return self.space;
}

/**
 * @godot World3D.get_direct_space_state
 * @source scene/resources/3d/world_3d.cpp:152
 */
export function get_direct_space_state(self: World3D): PhysicsDirectSpaceState3D {
  return godot_world_3d_direct_state(self.space);
}
