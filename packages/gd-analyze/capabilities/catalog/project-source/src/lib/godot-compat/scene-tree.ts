/**
 * @godot-class SceneTree
 * @role PROTOCOL
 *
 * Godot 4.7's `SceneTree` (`scene/main/scene_tree.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) without its main loop or its clock: the host owns
 * both (docs/GODOT.md §The emitted game's shape, "The SceneTree's clock"). Scripts' `_process` and
 * `_physics_process` run from their components' hooks, and nothing here runs per frame. A delta is
 * read from the host when asked, never kept: a physics step's is the Rapier world's own
 * `timestep`, a frame's is R3F's, read from its clock (`godot_tree_frame`) and bounded as a
 * script's `_process` delta is (`godot_process_delta`). The frame counters (`Engine`'s,
 * `get_frame`) and the `process_frame` and `physics_frame` signals are not bound, so the import
 * refuses them by name. A queued deletion is JavaScript's own deferral (`queue_delete`).
 *
 * Timers and tweens are not the tree's: each belongs to the script instance that made it
 * (`create_timer`, `create_tween`, which take their creator), and that instance's component steps
 * them from its own frame and physics step (`godot_owned_step`), as a three.js component steps a
 * tween library (docs/GODOT.md §The emitted game's shape, step 6). One made before its instance
 * mounts (configured between `instantiate` and `add_child`, or in `_init`) waits until the
 * component steps it. Where Godot keeps a tree-made timer or tween running after the node that
 * made it is freed, here it stops with its creator's component; and a script's own are stepped
 * after its `_process`, not after every node's, so a timeout's effect on another node's
 * `_process` can land a frame apart. A script no component runs is refused by the plan; a static
 * function's by name here; a node made by `Class.new()`, which React never renders, steps none.
 *
 * The tree is an empty record; its root is the three scene the main scene mounts into, named
 * `root` as Godot's root Window is. Pause is not transcribed (the tree never pauses).
 */

import { godot_node_enter_root, godot_node_free, godot_node_is_freed, godot_node_is_queued, godot_node_set_queued } from './node';
import { get_setting } from './project-settings';
import { godot_timer_advance, godot_timer_create, type SceneTreeTimer } from './scene-tree-timer';
import { godot_tween_can_process, godot_tween_clear, godot_tween_create, godot_tween_in_physics, godot_tween_step, type Tween } from './tween';

/** The tree record `get_tree()` returns: members take it as their receiver and read nothing from it. */
export type SceneTree = Readonly<Record<never, never>>;

/** A scene reload already deferred in the current task (`reload_current_scene`). */
let reloadQueued = false;
const TREE: SceneTree = Object.freeze({});

const tree = {
  root: undefined as object | undefined,
  reload: undefined as (() => void) | undefined,
};

/** What the host's clock is read through: R3F's `THREE.Clock` (`state.clock`). */
export interface GodotHostClock {
  readonly elapsedTime: number;
}
/** The host's clock and physics world, which the world hands compat (`godot_tree_attach_host`). */
let host: { readonly clock: GodotHostClock; readonly world: { readonly timestep: number } } | undefined;
/**
 * The frame starts last read from the host's clock: the current one and the one before it. The
 * clock's `elapsedTime` (seconds) changes once per frame, at its start, in both of R3F's frame
 * loops (its `oldTime` is the page's milliseconds when R3F runs the frame and the previous
 * frame's seconds when it is advanced by hand), so the frame's delta is the difference between
 * the two, tracked when read. The root Window reads it at every frame's start (the Input
 * library's edges, `input.ts`), so it is never more than a frame behind.
 */
const read = { start: Number.NaN, previous: 0 };

/** What one creator owns: the timers and tweens its script made. */
interface Owned {
  timers: SceneTreeTimer[];
  tweens: Tween[];
}
/** The creator's own record of what it made, held on the instance as a component holds its tweens. */
const OWNED = Symbol('godot.owned');
type Owner = { [OWNED]?: Owned };
function ownedBy(creator: object): Owned {
  // A static function's `this` is its class (or nothing, called detached): no instance, so no
  // component, owns what it makes.
  if (typeof creator !== 'object' || creator === null) {
    throw new Error('godot-compat: a timer or tween made in a static function has no script instance to own it, which is not transcribed.');
  }
  const owner = creator as Owner;
  owner[OWNED] ??= { timers: [], tweens: [] };
  return owner[OWNED];
}

/**
 * The tree record `Node.get_tree()` returns.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/node.h:558
 */
export function godot_tree(): SceneTree {
  return TREE;
}

/**
 * Registers the tree's root entity (the three scene the main scene mounts into): named `root`,
 * inside the tree and ready.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:586
 */
export function godot_tree_set_root(root: object): void {
  tree.root = root;
  (root as { name: string }).name = 'root';
  godot_node_enter_root(root);
}

/**
 * The registered root entity, or undefined before the main scene mounts.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:357
 */
export function godot_tree_root(): object | undefined {
  return tree.root;
}

/**
 * The host's scene reload for `reload_current_scene`, run where Godot changes scene.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:1673
 */
export function godot_tree_on_reload(handler: (() => void) | undefined): void {
  tree.reload = handler;
}

/**
 * Hands compat the host's clock (R3F's) and its physics world (Rapier's, whose `timestep` is the
 * physics step's delta); the returned call releases them.
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:4951
 */
export function godot_tree_attach_host(clock: GodotHostClock, world: { readonly timestep: number }): () => void {
  const attached = { clock, world };
  host = attached;
  return () => {
    if (host === attached) host = undefined;
  };
}

/**
 * The host frame as its clock reads now: when the current frame started (its clock's elapsed
 * seconds, which identifies the frame) and its delta, the time since the frame before it started.
 * Before the host's first frame both are 0.
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:4951
 */
export function godot_tree_frame(): { readonly start: number; readonly delta: number } {
  const start = host?.clock.elapsedTime ?? 0;
  if (start !== read.start) {
    read.previous = Number.isNaN(read.start) ? 0 : read.start;
    read.start = start;
  }
  return { start, delta: Math.max(0, start - read.previous) };
}

/**
 * The frame's delta as Godot code sees it: at most `max_physics_steps_per_frame` physics ticks
 * (8/60 s by default). Godot never advances a frame by more (`main/main.cpp:4951`: a frame due more
 * steps than the maximum drops the excess from its process step), so a stall, such as a page's
 * first frames while it loads, never reaches a node as one long delta. The emitted scripts'
 * `_process` is handed the same bound, so it and `get_process_delta_time()` agree. A setting that
 * is missing or not positive takes Godot's default, as the engine rejects it (`engine.cpp:63`).
 *
 * The physics steps are not bounded the same way: Rapier steps at its fixed `timeStep` and runs
 * every step due, up to its own half-second clamp (30 steps at 60 Hz), where Godot runs at most
 * `max_physics_steps_per_frame` and drops the rest (`main.cpp:4954`). So after a stall the physics
 * clock runs ahead of the process clock by up to the difference.
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:4951
 */
export function godot_process_delta(delta: number): number {
  return Math.min(delta, setting('physics/common/max_physics_steps_per_frame', 8) / setting('physics/common/physics_ticks_per_second', 60));
}

function setting(name: string, fallback: number): number {
  const value = Number(get_setting(name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The current step's delta, read from the host: a physics step's is the physics world's own
 * `timestep` (before the world is attached, one tick of the project's rate), a frame's is R3F's
 * frame delta, bounded (`godot_process_delta`).
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.h:362
 */
export function godot_tree_process_delta(physics: boolean): number {
  if (physics) return host?.world.timestep ?? 1 / setting('physics/common/physics_ticks_per_second', 60);
  return godot_process_delta(godot_tree_frame().delta);
}

/** `SceneTree::process_timers` (`scene/main/scene_tree.cpp:793`) over one creator's timers; timers added during the pass wait. */
function processTimers(owned: Owned, delta: number, physics: boolean): void {
  const pass = [...owned.timers];
  const done = new Set<SceneTreeTimer>();
  for (const timer of pass) {
    // A callback its timeout runs aborts only itself, and the timer is done (docs/GODOT.md §Order of work).
    try {
      if (godot_timer_advance(timer, delta, physics) === 'done') done.add(timer);
    } catch (error) {
      console.error(error);
      done.add(timer);
    }
  }
  if (done.size > 0) owned.timers = owned.timers.filter((timer) => !done.has(timer));
}

/**
 * `SceneTree::process_tweens` (`scene/main/scene_tree.cpp:825`): the tweens that existed when the
 * pass began, in creation order, each of this pass's kind and able to process stepped by the
 * frame's delta; one whose step reports it is done is cleared and dropped. The tree never pauses.
 */
function processTweens(owned: Owned, delta: number, physics: boolean): void {
  const pass = [...owned.tweens];
  const done = new Set<Tween>();
  for (const tween of pass) {
    if (!godot_tween_can_process(tween, false) || physics !== godot_tween_in_physics(tween)) continue;
    let running = false;
    // A callback the tween runs aborts only itself, and the tween with it.
    try {
      running = godot_tween_step(tween, delta);
    } catch (error) {
      console.error(error);
    }
    if (!running) {
      godot_tween_clear(tween);
      done.add(tween);
    }
  }
  if (done.size > 0) owned.tweens = owned.tweens.filter((tween) => !done.has(tween));
}

/**
 * Steps the timers and tweens one creator owns by its frame's delta (or its physics step's):
 * called from the creator's component, after its own `_process` or `_physics_process`, as
 * `SceneTree::process` runs them after the nodes (`scene/main/scene_tree.cpp:725`).
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:725
 */
export function godot_owned_step(creator: object | null, delta: number, physics: boolean): void {
  if (creator === null) return;
  const owned = (creator as Owner)[OWNED];
  // A creator that has left play steps nothing more, as Godot frees it and its tweens.
  if (owned === undefined || godot_node_is_queued(creator)) return;
  processTimers(owned, delta, physics);
  processTweens(owned, delta, physics);
}

/**
 * A creator's component unmounts: the timers and tweens it owns stop with it. Godot keeps a
 * tree-made timer running after the node that made it is freed; a timer still pending with
 * anything connected to its `timeout` (a callable or an `await`) is reported, so that difference
 * is never silent (docs/GODOT.md §The emitted game's shape, step 6).
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:793
 */
export function godot_owned_release(creator: object): void {
  const owned = (creator as Owner)[OWNED];
  if (owned === undefined) return;
  delete (creator as Owner)[OWNED];
  for (const timer of owned.timers) {
    if (timer.timeout.hasConnections()) {
      console.error('godot-compat: a timer still pending when the script that made it left the tree does not fire; in Godot it would.');
    }
  }
  for (const tween of owned.tweens) godot_tween_clear(tween);
}

/**
 * @godot SceneTree.get_root
 * @source scene/main/scene_tree.cpp:357
 */
export function get_root(self: SceneTree = TREE): object {
  void self;
  if (tree.root === undefined) throw new Error('godot-compat: the SceneTree has no root yet.');
  return tree.root;
}

/**
 * A timer counted down by process frames (or physics steps), emitting `timeout` once, owned by the
 * script that makes it (`creator`), whose component steps it (`godot_owned_step`). The Variant
 * defaults are `process_always = true`, `process_in_physics = false`, `ignore_time_scale = false`.
 *
 * @godot SceneTree.create_timer
 * @source scene/main/scene_tree.cpp:1768
 */
export function create_timer(
  self: SceneTree,
  creator: object,
  time_sec: number,
  process_always = true,
  process_in_physics = false,
  ignore_time_scale = false,
): SceneTreeTimer {
  void self;
  const timer = godot_timer_create(time_sec, process_always, process_in_physics, ignore_time_scale);
  ownedBy(creator).timers.push(timer);
  return timer;
}

/**
 * A tween owned by the script that makes it (`creator`), whose component steps it in every process
 * pass (or physics pass, by its process mode) after it was made, in creation order, until it
 * finishes or is killed.
 *
 * @godot SceneTree.create_tween
 * @source scene/main/scene_tree.cpp:1780
 */
export function create_tween(self: SceneTree, creator: object): Tween {
  void self;
  const tween = godot_tween_create();
  ownedBy(creator).tweens.push(tween);
  return tween;
}

/**
 * Queues an object for deletion: marked queued (`is_queued_for_deletion`), which takes it out of
 * play at once (`godot_node_is_queued`), and freed once the current work is done, as JavaScript
 * defers (a microtask, as `call_deferred` is, `object.ts`), unless it was freed first. There is no
 * deletion queue of the tree's own. R3F runs a frame's callbacks, physics steps and draw in one
 * task, so the node is freed after the frame's draw, where Godot frees it before: it is drawn one
 * more frame, and its colliders take part in the frame's later physics steps.
 *
 * @godot SceneTree.queue_delete
 * @source scene/main/scene_tree.cpp:1638
 */
export function queue_delete(self: SceneTree, object: object): void {
  void self;
  godot_node_set_queued(object);
  queueMicrotask(() => {
    if (!godot_node_is_freed(object)) godot_node_free(object);
  });
}

/**
 * With no current scene (no host reload registered) `ERR_UNCONFIGURED`; otherwise the scene is
 * reloaded once the current work is done, as JavaScript defers (a microtask, as `queue_delete`
 * is), where Godot swaps it in its next process pass (`scene/main/scene_tree.cpp:1673`), and `OK`
 * is returned. Calls in one task reload once; calls in two tasks before React swaps the scene (a
 * DOM input handler and the next frame's `_process`) reload twice, where Godot changes it once.
 *
 * @godot SceneTree.reload_current_scene
 * @source scene/main/scene_tree.cpp:1747
 */
export function reload_current_scene(self: SceneTree): number {
  void self;
  if (tree.reload === undefined) return 3;
  if (!reloadQueued) {
    reloadQueued = true;
    queueMicrotask(() => {
      reloadQueued = false;
      tree.reload?.();
    });
  }
  return 0;
}
