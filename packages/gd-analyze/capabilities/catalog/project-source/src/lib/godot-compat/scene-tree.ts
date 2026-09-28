/**
 * @godot-class SceneTree
 * @role PROTOCOL
 *
 * Godot 4.7's `SceneTree` (`scene/main/scene_tree.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) without its main loop: the host's clock runs it.
 * Each Rapier step begins and ends the tree's physics frame and each R3F frame begins and ends its
 * process frame (`useGodotTree`, `advance.tsx`); scripts' own `_process` and `_physics_process`
 * run in between, from their components' hooks. What the tree does around them is what
 * `SceneTree::physics_process` and `SceneTree::process` do: count the frame and emit
 * `physics_frame`/`process_frame`. A queued deletion is JavaScript's own deferral (`queue_delete`).
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
 * The tree is a record holding its `process_frame` and `physics_frame` signals; its root is the
 * three scene the main scene mounts into, named `root` as Godot's root Window is. Pause is not
 * transcribed (the tree never pauses).
 */

import { godot_input_frame } from './input';
import { godot_node_enter_root, godot_node_free, godot_node_is_freed, godot_node_set_queued } from './node';
import { godot_timer_advance, godot_timer_create, type SceneTreeTimer } from './scene-tree-timer';
import { createSignal, type GodotSignal } from './signal';
import { godot_tween_can_process, godot_tween_clear, godot_tween_create, godot_tween_in_physics, godot_tween_step, type Tween } from './tween';

export interface SceneTree {
  readonly process_frame: GodotSignal<[]>;
  readonly physics_frame: GodotSignal<[]>;
}

const processFrame = createSignal<[]>();
const physicsFrame = createSignal<[]>();
const TREE: SceneTree = Object.freeze({ process_frame: processFrame.signal, physics_frame: physicsFrame.signal });

const clock = {
  root: undefined as object | undefined,
  physicsFrames: 0,
  processFrames: 0,
  currentFrame: 0,
  inPhysics: false,
  processTime: 0,
  physicsTime: 0,
  reloadPending: false,
  reload: undefined as (() => void) | undefined,
};
/** What one creator owns: the timers and tweens its script made. */
interface Owned {
  timers: SceneTreeTimer[];
  tweens: Tween[];
}
const OWNED = new WeakMap<object, Owned>();
function ownedBy(creator: object): Owned {
  // A static function's `this` is its class: no instance, so no component, owns what it makes.
  if (typeof creator === 'function') {
    throw new Error('godot-compat: a timer or tween made in a static function has no script instance to own it, which is not transcribed.');
  }
  let owned = OWNED.get(creator);
  if (owned === undefined) {
    owned = { timers: [], tweens: [] };
    OWNED.set(creator, owned);
  }
  return owned;
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
  clock.root = root;
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
  return clock.root;
}

/**
 * The host's scene reload for `reload_current_scene`, run where Godot changes scene.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:1673
 */
export function godot_tree_on_reload(handler: (() => void) | undefined): void {
  clock.reload = handler;
}

/**
 * The current step's delta: the physics step's or the process frame's.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.h:362
 */
export function godot_tree_process_delta(physics: boolean): number {
  return physics ? clock.physicsTime : clock.processTime;
}

/**
 * The Engine counters: physics frames, process frames, and whether a physics step is running.
 *
 * @godot SceneTree (protocol)
 * @source core/config/engine.h:138
 */
export function godot_tree_frames(): { readonly physics: number; readonly process: number; readonly inPhysics: boolean } {
  return { physics: clock.physicsFrames, process: clock.processFrames, inPhysics: clock.inPhysics };
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
  const owned = OWNED.get(creator);
  if (owned === undefined) return;
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
  const owned = OWNED.get(creator);
  if (owned === undefined) return;
  OWNED.delete(creator);
  for (const timer of owned.timers) {
    if (timer.timeout.hasConnections()) {
      console.error('godot-compat: a timer still pending when the script that made it left the tree does not fire; in Godot it would.');
    }
  }
  for (const tween of owned.tweens) godot_tween_clear(tween);
}

/**
 * A physics step begins: `Engine` counts it and is in physics (`main/main.cpp:4973`), then
 * `SceneTree::physics_process` emits `physics_frame` before the nodes' `_physics_process`
 * (`scene/main/scene_tree.cpp:639`).
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:639
 */
export function godot_tree_physics_begin(delta: number): void {
  clock.inPhysics = true;
  clock.physicsFrames += 1;
  clock.currentFrame += 1;
  clock.physicsTime = delta;
  godot_input_frame(clock.physicsFrames, clock.processFrames, true);
  physicsFrame.emit();
}

/**
 * A physics step ends: `Engine` leaves physics (`scene/main/scene_tree.cpp:660`). Timers and
 * tweens are their owners' (`godot_owned_step`), and a queued deletion JavaScript's own deferral.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:660
 */
export function godot_tree_physics_end(): void {
  clock.inPhysics = false;
  godot_input_frame(clock.physicsFrames, clock.processFrames, false);
}

/**
 * A process frame begins: `SceneTree::process` emits `process_frame` before the nodes' `_process`
 * (`scene/main/scene_tree.cpp:688`). Its delta, which `get_process_delta_time` reads, comes already
 * bounded to the frame's maximum physics steps, as Godot bounds it (`main/main.cpp:4951`,
 * `useGodotTree`).
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:688
 */
export function godot_tree_process_begin(delta: number): void {
  clock.processTime = delta;
  processFrame.emit();
}

/**
 * A process frame ends: a pending scene change (`scene/main/scene_tree.cpp:725`), then `Engine`
 * counts the frame (`main/main.cpp:5115`).
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:725
 */
export function godot_tree_process_end(): void {
  if (clock.reloadPending) {
    clock.reloadPending = false;
    clock.reload?.();
  }
  clock.processFrames += 1;
  godot_input_frame(clock.physicsFrames, clock.processFrames, false);
}

/**
 * @godot SceneTree.get_root
 * @source scene/main/scene_tree.cpp:357
 */
export function get_root(self: SceneTree = TREE): object {
  void self;
  if (clock.root === undefined) throw new Error('godot-compat: the SceneTree has no root yet.');
  return clock.root;
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
 * Queues an object for deletion: marked queued at once (`is_queued_for_deletion`), freed once the
 * current work is done, as JavaScript defers (a microtask, as `call_deferred` is, `object.ts`),
 * unless it was freed first. There is no deletion queue of the tree's own. R3F runs a frame's
 * callbacks and physics steps in one task, so the node is freed after the frame's callbacks; where
 * a stall runs several physics steps in one frame, Godot frees it between them
 * (`scene/main/scene_tree.cpp:660`), here after them.
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
 * The count of physics steps the tree has run.
 *
 * @godot SceneTree.get_frame
 * @source scene/main/scene_tree.cpp:1551
 */
export function get_frame(self: SceneTree): number {
  void self;
  return clock.currentFrame;
}

/**
 * With no current scene (no host reload registered) `ERR_UNCONFIGURED`; otherwise the host's reload
 * runs where Godot flushes a scene change, in the next process frame, and `OK` is returned.
 *
 * @godot SceneTree.reload_current_scene
 * @source scene/main/scene_tree.cpp:1747
 */
export function reload_current_scene(self: SceneTree): number {
  void self;
  if (clock.reload === undefined) return 3;
  clock.reloadPending = true;
  return 0;
}
