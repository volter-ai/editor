/**
 * @godot-class World3D
 * @role BINDING
 *
 * Godot 4.7's `World3D` (`scene/resources/3d/world_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto one Rapier `World`, which the composition
 * site hands over (as it hands over the viewport's size): its physics space is that world. Attaching
 * a world starts it empty and registers the physics server's calls with the SceneTree:
 * `sync` + `flush_queries` (bodies brought up to the tree, then the body and area callbacks the
 * physics modules register) and `step` (their pre-step callbacks, then Rapier's step at Godot's
 * fixed step), and the collision objects' deferred transform notifications.
 */

import { EventQueue, SolverFlags, type World } from '@dimforge/rapier3d-compat';
import {
  godot_collision_objects_collide,
  godot_collision_objects_integrate,
  godot_collision_objects_read_rigid,
  godot_collision_objects_step,
  godot_collision_objects_reset,
  godot_collision_objects_settle,
  godot_collision_objects_sync,
  godot_collision_objects_transforms_changed,
} from './collision-object-3d';
import { godot_tree_physics_server } from './scene-tree';

export interface PhysicsSpace3D {
  readonly world: World;
}

export interface World3D {
  readonly space: PhysicsSpace3D;
}

export interface PhysicsDirectSpaceState3D {
  readonly space: PhysicsSpace3D;
}

/** Godot's layers, masks and exceptions decide Rapier's contact pairs (Rapier runs hooks only for a step given an event queue). */
const HOOKS = {
  filterContactPair: (c1: number, c2: number): SolverFlags | null => (godot_collision_objects_collide(c1, c2) ? SolverFlags.COMPUTE_IMPULSE : null),
  filterIntersectionPair: (): boolean => true,
};

let current: { readonly world3d: World3D; readonly state: PhysicsDirectSpaceState3D } | undefined;
const flushHandlers: { readonly handler: (world: World) => void; readonly order: number }[] = [];
const stepHandlers: ((world: World, delta: number) => void)[] = [];
const steppedHandlers: ((world: World, delta: number) => void)[] = [];

/**
 * Registers a physics module's callbacks: `flush` in each step's `flush_queries`, after bodies are
 * synced, in `order` (`GodotSpace3D::call_queries` answers bodies, 0, before areas, 1,
 * `modules/godot_physics_3d/godot_space_3d.cpp:1205`); `step` after the shapes and kinematic bodies
 * are updated and before Rapier integrates; `stepped` once Rapier has (`main/main.cpp:4986`,
 * `:5031`).
 *
 * @godot World3D (protocol)
 * @source main/main.cpp:4986
 */
export function godot_world_3d_physics_callbacks(
  flush: ((world: World) => void) | undefined,
  step: ((world: World, delta: number) => void) | undefined,
  stepped?: (world: World, delta: number) => void,
  order = 0,
): void {
  if (flush !== undefined && !flushHandlers.some((entry) => entry.handler === flush)) {
    flushHandlers.push({ handler: flush, order });
    flushHandlers.sort((a, b) => a.order - b.order);
  }
  if (step !== undefined && !stepHandlers.includes(step)) stepHandlers.push(step);
  if (stepped !== undefined && !steppedHandlers.includes(stepped)) steppedHandlers.push(stepped);
}

/**
 * Attaches the Rapier world the composition site created: the main World3D's space.
 *
 * @godot World3D (protocol)
 * @source scene/resources/3d/world_3d.cpp:52
 */
export function godot_world_3d_attach(world: World): World3D {
  godot_collision_objects_reset();
  const space: PhysicsSpace3D = Object.freeze({ world });
  const world3d: World3D = Object.freeze({ space });
  current = { world3d, state: Object.freeze({ space }) };
  const events = new EventQueue(true);
  godot_tree_physics_server({
    flush: () => {
      godot_collision_objects_sync(world);
      for (const entry of flushHandlers) entry.handler(world);
    },
    step: (delta: number) => {
      godot_collision_objects_sync(world);
      godot_collision_objects_step(world, delta);
      for (const handler of stepHandlers) handler(world, delta);
      godot_collision_objects_settle();
      godot_collision_objects_integrate(world);
      world.timestep = delta;
      world.step(events, HOOKS);
      godot_collision_objects_read_rigid();
      for (const handler of steppedHandlers) handler(world, delta);
    },
    transforms: () => godot_collision_objects_transforms_changed(),
  });
  return world3d;
}

/**
 * The attached World3D (a Node3D's `get_world_3d()` inside the main viewport).
 *
 * @godot World3D (protocol)
 * @source scene/3d/node_3d.cpp:1082
 */
export function godot_world_3d(): World3D {
  if (current === undefined) throw new Error('godot-compat: no Rapier world is attached to the World3D.');
  return current.world3d;
}

/**
 * The world's direct space state, after bringing Rapier up to the tree.
 *
 * @godot World3D (protocol)
 * @source scene/resources/3d/world_3d.cpp:152
 */
export function godot_world_3d_direct_state(space: PhysicsSpace3D): PhysicsDirectSpaceState3D {
  godot_collision_objects_sync(space.world);
  if (current === undefined || current.world3d.space !== space) return Object.freeze({ space });
  return current.state;
}

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
