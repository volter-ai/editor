/**
 * @godot-class SceneTree
 * @role PROTOCOL
 *
 * Godot 4.7's `SceneTree` (`scene/main/scene_tree.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) without its main loop: the host's clock runs it.
 * Each Rapier step begins and ends the tree's physics frame and each R3F frame begins and ends its
 * process frame (`useGodotTree`, `advance.tsx`); scripts' own `_process` and `_physics_process`
 * run in between, from their components' hooks. What the tree does around them is what
 * `SceneTree::physics_process` and `SceneTree::process` do: count the frame, emit
 * `physics_frame`/`process_frame`, then run timers, tweens and the deletion queue.
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
let timers: SceneTreeTimer[] = [];
let tweens: Tween[] = [];
const deleteQueue: object[] = [];

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

/** `SceneTree::process_timers` (`scene/main/scene_tree.cpp:793`); timers added during the pass wait. */
function processTimers(delta: number, physics: boolean): void {
  const pass = [...timers];
  const done = new Set<SceneTreeTimer>();
  for (const timer of pass) {
    if (godot_timer_advance(timer, delta, physics) === 'done') done.add(timer);
  }
  timers = timers.filter((timer) => !done.has(timer));
}

/**
 * `SceneTree::process_tweens` (`scene/main/scene_tree.cpp:825`): the tweens that existed when the
 * pass began, in creation order, each of this pass's kind and able to process stepped by the
 * frame's delta; one whose step reports it is done is cleared and dropped. The tree never pauses.
 */
function processTweens(delta: number, physics: boolean): void {
  const pass = [...tweens];
  const done = new Set<Tween>();
  for (const tween of pass) {
    if (!godot_tween_can_process(tween, false) || physics !== godot_tween_in_physics(tween)) continue;
    if (!godot_tween_step(tween, delta)) {
      godot_tween_clear(tween);
      done.add(tween);
    }
  }
  if (done.size > 0) tweens = tweens.filter((tween) => !done.has(tween));
}

/** `SceneTree::_flush_delete_queue` (`scene/main/scene_tree.cpp:1626`). */
function flushDeleteQueue(): void {
  while (deleteQueue.length > 0) {
    const entity = deleteQueue.shift() as object;
    if (!godot_node_is_freed(entity)) godot_node_free(entity);
  }
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
 * A physics step ends: after the nodes, physics timers and tweens, then the deletion queue
 * (`scene/main/scene_tree.cpp:660`); `Engine` leaves physics.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:660
 */
export function godot_tree_physics_end(): void {
  processTimers(clock.physicsTime, true);
  processTweens(clock.physicsTime, true);
  flushDeleteQueue();
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
 * A process frame ends: a pending scene change, process timers and tweens, the deletion queue
 * (`scene/main/scene_tree.cpp:725`), then `Engine` counts the frame (`main/main.cpp:5115`).
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:725
 */
export function godot_tree_process_end(): void {
  if (clock.reloadPending) {
    clock.reloadPending = false;
    clock.reload?.();
  }
  processTimers(clock.processTime, false);
  processTweens(clock.processTime, false);
  flushDeleteQueue();
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
 * A timer counted down by process frames (or physics steps), emitting `timeout` once. The Variant
 * defaults are `process_always = true`, `process_in_physics = false`, `ignore_time_scale = false`.
 *
 * @godot SceneTree.create_timer
 * @source scene/main/scene_tree.cpp:1768
 */
export function create_timer(
  self: SceneTree,
  time_sec: number,
  process_always = true,
  process_in_physics = false,
  ignore_time_scale = false,
): SceneTreeTimer {
  void self;
  const timer = godot_timer_create(time_sec, process_always, process_in_physics, ignore_time_scale);
  timers.push(timer);
  return timer;
}

/**
 * A tween the tree holds and steps in every process pass (or physics pass, by its process mode)
 * that begins after it was made, in creation order, until it finishes or is killed.
 *
 * @godot SceneTree.create_tween
 * @source scene/main/scene_tree.cpp:1780
 */
export function create_tween(self: SceneTree): Tween {
  void self;
  const tween = godot_tween_create();
  tweens.push(tween);
  return tween;
}

/**
 * Queues an object for deletion at the end of the current step.
 *
 * @godot SceneTree.queue_delete
 * @source scene/main/scene_tree.cpp:1638
 */
export function queue_delete(self: SceneTree, object: object): void {
  void self;
  godot_node_set_queued(object);
  deleteQueue.push(object);
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
