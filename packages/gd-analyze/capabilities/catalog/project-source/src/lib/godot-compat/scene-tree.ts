/**
 * @godot-class SceneTree
 * @role PROTOCOL
 *
 * Godot 4.7's `SceneTree` (`scene/main/scene_tree.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) without its main loop or its clock: the host owns
 * both (docs/GODOT.md §The emitted game's shape, "The SceneTree's clock"). Scripts' `_process` and
 * `_physics_process` run from their components' hooks, and nothing here runs per frame. A delta is
 * the host's: a physics step's is the Rapier world's own `timestep`, a frame's is R3F's, which the
 * root Window's frame hook hands over with three's frame count as the frame's identity
 * (`godot_tree_frame`), bounded as a script's `_process` delta is (`godot_process_delta`). The frame counters (`Engine`'s,
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
 * `root` as Godot's root Window is. Pausing pauses its nodes by their process modes and the
 * world's physics (`set_pause`).
 */

import type { PackedScene } from './packed-scene-instance';
import { godot_node_enter_root, godot_node_free, godot_node_object, godot_node_group_members, godot_node_is_freed, godot_node_is_queued, godot_node_set_queued, godot_node_set_tree_paused, godot_node_tree_paused } from './node';
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
  change: undefined as ((scene: PackedScene) => void) | undefined,
};

/** The host's physics world, which the world hands compat (`godot_tree_attach_host`). */
let host: { readonly world: { readonly timestep: number } } | undefined;
/**
 * The host frame running now, as the root Window's frame hook hands it over: three's own count of
 * the renderer's frames (`renderer.info.render.frame`) as its identity, and R3F's delta. Nothing
 * here counts frames; a frame the host draws without advancing its clock (the editor's paused
 * game) is still a frame of its own, with a delta of 0.
 */
const read = { id: 0, delta: 0 };

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
 * The host's scene change for `change_scene_to_packed`, run where Godot changes scene.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:1687
 */
export function godot_tree_on_change(handler: ((scene: PackedScene) => void) | undefined): void {
  tree.change = handler;
}

/**
 * Hands compat the host's physics world (Rapier's, whose `timestep` is the physics step's delta);
 * the returned call releases it.
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:4951
 */
export function godot_tree_attach_host(world: { readonly timestep: number }): () => void {
  const attached = { world };
  host = attached;
  return () => {
    if (host === attached) host = undefined;
  };
}

/**
 * The host's frame, as the root Window's frame hook hands it over at the frame's start: its
 * identity and its delta.
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:4951
 */
export function godot_tree_open_frame(frame: { readonly id: number; readonly delta: number }): void {
  read.id = frame.id;
  // A host advanced to an earlier time (a scrubbed preview) is no time at all.
  read.delta = Math.max(0, frame.delta);
}

/**
 * The host frame running now: its identity and its delta (0 before the host's first frame).
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:4951
 */
export function godot_tree_frame(): { readonly id: number; readonly delta: number } {
  return { id: read.id, delta: read.delta };
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
 * Pauses or resumes the tree: nodes process by their process modes (`node.ts`) and the world's
 * physics steps only while it runs (`useGodotPaused`).
 *
 * @godot SceneTree.set_pause
 * @source scene/main/scene_tree.cpp:1100
 */
export function set_pause(self: SceneTree, enable: boolean): void {
  void self;
  godot_node_set_tree_paused(Boolean(enable));
}

/**
 * @godot SceneTree.is_paused
 * @source scene/main/scene_tree.cpp:1121
 */
export function is_paused(self: SceneTree): boolean {
  void self;
  return godot_node_tree_paused();
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

/**
 * The scene changes to a new instance of `scene` once the current work is done (a microtask, as
 * `reload_current_scene` defers), and `OK` is returned; with no host to change it,
 * `ERR_UNCONFIGURED`.
 *
 * @godot SceneTree.change_scene_to_packed
 * @source scene/main/scene_tree.cpp:1687
 */
export function change_scene_to_packed(self: SceneTree, scene: PackedScene): number {
  void self;
  if (tree.change === undefined) return 3;
  queueMicrotask(() => tree.change?.(scene));
  return 0;
}

/**
 * The web export's `quit` ends the game's main loop and leaves the page as it is; the page here
 * keeps drawing, which the game no longer changes once it stops asking.
 *
 * @godot SceneTree.quit
 * @source scene/main/scene_tree.cpp:875
 */
export function quit(self: SceneTree, exit_code = 0): void {
  void self;
  void exit_code;
}

/**
 * An autoload's script instance: the root's child of its name (`/root/<name>`, where `Main::start`
 * adds each autoload), for a script that reads it before its scene hands it over (`_init`).
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:3949
 */
export function godot_tree_autoload(name: string): unknown {
  const root = tree.root as { readonly children?: readonly { readonly name?: string }[] } | undefined;
  const found = root?.children?.find((child) => child.name === name);
  if (found === undefined) throw new Error(`godot-compat: no autoload ${name} under the root yet.`);
  return godot_node_object(found as object);
}

function members(group: string): unknown[] {
  return tree.root === undefined ? [] : godot_node_group_members(tree.root, group);
}

/**
 * Calls `method` with `args` on every node in the group, in tree order; a node without it is
 * skipped (`SceneTree::call_group_flagsp`, `scene_tree.cpp:1130`, reports the error and goes on).
 *
 * @godot SceneTree.call_group
 * @source scene/main/scene_tree.cpp:1245
 */
export function call_group(self: SceneTree, group: string, method: string, ...args: unknown[]): void {
  void self;
  for (const node of members(group)) {
    const target = node as Record<string, unknown>;
    const own = target[method];
    if (typeof own === 'function') {
      (own as (...values: unknown[]) => unknown).apply(target, args);
      continue;
    }
    // A native method of the node (`queue_free`): the group's object answers it by name.
    if (method === 'queue_free') queue_delete(self, node as object);
  }
}

/**
 * Sets `property` to `value` on every node in the group that has it.
 *
 * @godot SceneTree.set_group
 * @source scene/main/scene_tree.cpp:1270
 */
export function set_group(self: SceneTree, group: string, property: string, value: unknown): void {
  void self;
  for (const node of members(group)) {
    const target = node as Record<string, unknown>;
    if (property in target) target[property] = value;
  }
}

/**
 * @godot SceneTree.get_nodes_in_group
 * @source scene/main/scene_tree.cpp:1406
 */
export function get_nodes_in_group(self: SceneTree, group: string): unknown[] {
  void self;
  return members(group);
}

/**
 * @godot SceneTree.get_first_node_in_group
 * @source scene/main/scene_tree.cpp:1427
 */
export function get_first_node_in_group(self: SceneTree, group: string): unknown {
  void self;
  return members(group)[0] ?? null;
}

/**
 * @godot SceneTree.has_group
 * @source scene/main/scene_tree.cpp:1390
 */
export function has_group(self: SceneTree, group: string): boolean {
  void self;
  return members(group).length > 0;
}

/**
 * @godot SceneTree.get_node_count_in_group
 * @source scene/main/scene_tree.cpp:1439
 */
export function get_node_count_in_group(self: SceneTree, group: string): number {
  void self;
  return members(group).length;
}
