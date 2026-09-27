/**
 * @godot-class World3D
 * @role BINDING
 *
 * Godot 4.7's `World3D` (`scene/resources/3d/world_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto one Rapier `World`, which the composition
 * site hands over (as it hands over the viewport's size) inside a physics host: the scene's
 * `@react-three/rapier` `<Physics>`, whose world holds the bodies the JSX declares and whose step
 * keeps their objects following them, or a bare world. Its physics space is that world. Attaching
 * starts it empty and registers the physics server's calls with the SceneTree: `sync` +
 * `flush_queries` (bodies brought up to the tree, then the body and area callbacks the physics
 * modules register) and `step` (their pre-step callbacks, then the host's step at Godot's fixed
 * step), and the collision objects' deferred transform notifications. The host never steps on its
 * own clock: Godot's physics step is its only step.
 */

import { type Collider, EventQueue, type RigidBody, SolverFlags, type World } from '@dimforge/rapier3d-compat';
import {
  godot_collision_objects_broad_phase_built,
  godot_collision_objects_broad_phase_stale,
  godot_collision_objects_collide,
  godot_collision_objects_declare,
  godot_collision_objects_hold_detached,
  godot_collision_objects_integrate,
  godot_collision_objects_read_rigid,
  godot_collision_objects_step,
  godot_collision_objects_reset,
  godot_collision_objects_settle,
  godot_collision_objects_sync,
  godot_collision_objects_transforms_changed,
} from './collision-object-3d';
import { godot_node_3d_world_source } from './node-3d';
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

/**
 * Where the Rapier world lives. `step` advances it by one step with the host's own bookkeeping;
 * `filterContacts` makes Godot's layers, masks and exceptions decide its contact pairs (Rapier runs
 * the hooks only for a step given an event queue); `bodies` are the rigid bodies the scene's JSX
 * declares, each with its object and its colliders' objects.
 */
export interface GodotPhysicsHost {
  readonly world: World;
  readonly step: (delta: number) => void;
  readonly filterContacts: (filter: (collider1: number, collider2: number) => SolverFlags | null) => void;
  readonly bodies: () => Iterable<{
    readonly object: object;
    readonly body: RigidBody;
    readonly colliders: readonly { readonly object: object; readonly collider: Collider }[];
  }>;
  /** A number that changes whenever the declared bodies or colliders do (their count). */
  readonly revision?: () => number;
}

/**
 * A bare Rapier world as a physics host: it declares no bodies, and its step runs the filter over
 * an event queue of its own.
 *
 * @godot World3D (protocol)
 * @source scene/resources/3d/world_3d.cpp:52
 */
export function godot_world_3d_host(world: World): GodotPhysicsHost {
  const events = new EventQueue(true);
  let filter: ((collider1: number, collider2: number) => SolverFlags | null) | undefined;
  const hooks = {
    filterContactPair: (c1: number, c2: number): SolverFlags | null => (filter === undefined ? SolverFlags.COMPUTE_IMPULSE : filter(c1, c2)),
    filterIntersectionPair: (): boolean => true,
  };
  return {
    world,
    step: (delta) => {
      world.timestep = delta;
      world.step(events, hooks);
    },
    filterContacts: (next) => {
      filter = next;
    },
    bodies: () => [],
  };
}

let current: { readonly world3d: World3D; readonly state: PhysicsDirectSpaceState3D; readonly host: GodotPhysicsHost } | undefined;
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
 * Declares the host's bodies now and holds those outside the tree: an instantiated scene's bodies,
 * which React mounted outside the tree, never join the space before their node enters it.
 *
 * @godot World3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:96
 */
export function godot_world_3d_declare_detached(): void {
  if (current === undefined) return;
  godot_collision_objects_declare(current.host.bodies());
  godot_collision_objects_hold_detached();
}

let declaredRevision: number | undefined;

/**
 * The collision objects brought up to the tree, the host's declared bodies among them. A space
 * query's sync (`query`) re-reads the declared bodies only when the host's revision moved, and
 * brings a static body's shapes up only when one left it (see `godot_collision_objects_sync`).
 */
function syncSpace(host: GodotPhysicsHost, query = false): void {
  const revision = host.revision?.();
  if (!query || revision === undefined || revision !== declaredRevision) {
    godot_collision_objects_declare(host.bodies());
    declaredRevision = revision;
  }
  godot_collision_objects_sync(host.world, query);
  if (query && godot_collision_objects_broad_phase_stale()) buildBroadPhase(host.world);
}

/**
 * Rapier builds its broad phase only inside a step: a step of zero length before a query puts the
 * colliders made and the static objects placed since the last step in it, as GodotPhysics3D's
 * shapes enter its broad phase when they are added or moved (`_update_shapes`,
 * `godot_collision_object_3d.cpp:155`). Its events are dropped.
 */
function buildBroadPhase(world: World): void {
  const events = new EventQueue(true);
  const timestep = world.timestep;
  world.timestep = 0;
  world.step(events, {
    filterContactPair: (c1: number, c2: number): SolverFlags | null => (godot_collision_objects_collide(c1, c2) ? SolverFlags.COMPUTE_IMPULSE : null),
    filterIntersectionPair: (): boolean => true,
  });
  world.timestep = timestep;
  events.drainCollisionEvents(() => {});
  events.drainContactForceEvents(() => {});
  events.free();
  godot_collision_objects_broad_phase_built();
}

/**
 * Attaches the physics host the composition site created: its world is the main World3D's space.
 *
 * @godot World3D (protocol)
 * @source scene/resources/3d/world_3d.cpp:52
 */
export function godot_world_3d_attach(host: GodotPhysicsHost): World3D {
  const world = host.world;
  godot_collision_objects_reset();
  const space: PhysicsSpace3D = Object.freeze({ world });
  const world3d: World3D = Object.freeze({ space });
  current = { world3d, state: Object.freeze({ space }), host };
  godot_node_3d_world_source(godot_world_3d);
  host.filterContacts((c1, c2) => (godot_collision_objects_collide(c1, c2) ? SolverFlags.COMPUTE_IMPULSE : null));
  const sync = (): void => syncSpace(host);
  godot_tree_physics_server({
    flush: () => {
      sync();
      for (const entry of flushHandlers) entry.handler(world);
    },
    step: (delta: number) => {
      sync();
      godot_collision_objects_step(world, delta);
      for (const handler of stepHandlers) handler(world, delta);
      godot_collision_objects_settle();
      godot_collision_objects_integrate(world);
      host.step(delta);
      godot_collision_objects_read_rigid();
      for (const handler of steppedHandlers) handler(world, delta);
    },
    transforms: () => godot_collision_objects_transforms_changed(),
  });
  return world3d;
}

/**
 * The object a declared Rapier body belongs to (the `<RigidBody>` element's object), once the
 * physics host lists it.
 *
 * @godot World3D (protocol)
 * @source scene/resources/3d/world_3d.cpp:52
 */
export function godot_world_3d_declared_object(body: object): object | undefined {
  if (current === undefined) return undefined;
  for (const entry of current.host.bodies()) if (entry.body === body) return entry.object;
  return undefined;
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
  if (current === undefined || current.world3d.space !== space) {
    godot_collision_objects_sync(space.world);
    return Object.freeze({ space });
  }
  syncSpace(current.host, true);
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
