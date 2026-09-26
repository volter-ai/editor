/**
 * @godot-class SceneTree
 * @role PROTOCOL
 *
 * Godot 4.7's `SceneTree` main loop, transcribed from `scene/main/scene_tree.cpp` and the order
 * `Main::iteration` (`main/main.cpp`) runs it in, at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Compat has no loop of its own: the composition site
 * calls `godot_tree_physics_step(delta)` for each fixed physics step and `godot_tree_frame(delta)`
 * once per rendered frame, from R3F's frame and its fixed step. An iteration begins with the first
 * of those calls after a frame: Input's buffered events are flushed first (`OS_MacOS::run`).
 *
 * The tree is a record holding its `process_frame` and `physics_frame` signals; its root is the
 * native entity the composition site registers (the R3F scene), named `root` as Godot's root
 * Window is. Pause is not transcribed (the tree never pauses).
 */

import { flush_buffered_events, godot_input_frame } from './input';
import { godot_node_enter_root, godot_node_free, godot_node_is_freed, godot_node_processing, godot_node_set_queued } from './node';
import { godot_main_timer_sync_advance, godot_main_timer_sync_fixed_fps } from './main-timer-sync';
import { godot_message_queue_flush } from './object';
import { get_setting } from './project-settings';
import { godot_timer_advance, godot_timer_create, type SceneTreeTimer } from './scene-tree-timer';
import { createSignal, type GodotSignal } from './signal';

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
  iterationOpen: false,
  processTime: 0,
  physicsTime: 0,
  reloadPending: false,
  reload: undefined as (() => void) | undefined,
};
let timers: SceneTreeTimer[] = [];
let physicsServer: { readonly flush: () => void; readonly step: (delta: number) => void; readonly transforms: () => void } | undefined;

/**
 * The physics server's two calls in each physics step, which the world binding registers:
 * `sync` + `flush_queries` before `SceneTree::physics_process`, and `step` after it
 * (`main/main.cpp:4986`, `:5031`); and `transforms`, called where the SceneTree delivers the
 * deferred `NOTIFICATION_TRANSFORM_CHANGED` that sends collision objects' transforms to the server
 * (`flush_transform_notifications`, `scene/main/scene_tree.cpp:200`).
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:4986
 */
export function godot_tree_physics_server(server: { readonly flush: () => void; readonly step: (delta: number) => void; readonly transforms: () => void } | undefined): void {
  physicsServer = server;
}
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
 * Registers the tree's root entity (the R3F scene): named `root`, inside the tree and ready.
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
 * The registered root entity, or undefined before the host registers one.
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
export function godot_tree_on_reload(handler: () => void): void {
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

function openIteration(): void {
  if (clock.iterationOpen) return;
  clock.iterationOpen = true;
  godot_input_frame(clock.physicsFrames, clock.processFrames, false);
  flush_buffered_events();
}

/** Every entity inside the tree in tree order (parent before children, children in order). */
function treeOrder(): object[] {
  const found: object[] = [];
  const visit = (entity: object): void => {
    found.push(entity);
    for (const child of (entity as { children?: readonly object[] }).children ?? []) visit(child);
  };
  if (clock.root !== undefined) visit(clock.root);
  return found;
}

/**
 * `SceneTree::_process` / `_process_group` (`scene/main/scene_tree.cpp:1177`): the processing
 * nodes sorted by priority then tree order, copied, each checked again when its turn comes.
 */
function processNodes(physics: boolean): void {
  const listed = treeOrder()
    .map((entity, order) => ({ entity, order, info: godot_node_processing(entity) }))
    .filter(
      (entry) =>
        entry.info !== undefined &&
        entry.info.insideTree &&
        (physics ? entry.info.physicsProcess || entry.info.internalPhysics !== undefined : entry.info.process || entry.info.internalProcess !== undefined),
    );
  listed.sort((a, b) => {
    const pa = physics ? (a.info?.physicsProcessPriority ?? 0) : (a.info?.processPriority ?? 0);
    const pb = physics ? (b.info?.physicsProcessPriority ?? 0) : (b.info?.processPriority ?? 0);
    return pa !== pb ? pa - pb : a.order - b.order;
  });
  for (const { entity } of listed) {
    const info = godot_node_processing(entity);
    if (info === undefined || !info.insideTree || !info.canProcess) continue;
    if (physics) {
      info.internalPhysics?.(clock.physicsTime);
      if (info.physicsProcess) info.binding?.physicsProcess?.(clock.physicsTime);
    } else {
      info.internalProcess?.(clock.processTime);
      if (info.process) info.binding?.process?.(clock.processTime);
    }
  }
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

/** `SceneTree::_flush_delete_queue` (`scene/main/scene_tree.cpp:1626`). */
function flushDeleteQueue(): void {
  while (deleteQueue.length > 0) {
    const entity = deleteQueue.shift() as object;
    if (!godot_node_is_freed(entity)) godot_node_free(entity);
  }
}

/**
 * One physics step: `Engine` counts it, then `SceneTree::physics_process`
 * (`scene/main/scene_tree.cpp:639`): `physics_frame`, the physics-processing nodes, deferred calls,
 * physics timers, the deletion queue; `Main::iteration` then flushes deferred calls again
 * (`main/main.cpp:5025`).
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:4973
 */
export function godot_tree_physics_step(delta: number): void {
  openIteration();
  clock.inPhysics = true;
  clock.physicsFrames += 1;
  godot_input_frame(clock.physicsFrames, clock.processFrames, true);
  physicsServer?.flush();
  clock.currentFrame += 1;
  physicsServer?.transforms();
  clock.physicsTime = delta;
  physicsFrame.emit();
  processNodes(true);
  godot_message_queue_flush();
  processTimers(delta, true);
  physicsServer?.transforms();
  flushDeleteQueue();
  godot_message_queue_flush();
  physicsServer?.step(delta);
  godot_message_queue_flush();
  clock.inPhysics = false;
  godot_input_frame(clock.physicsFrames, clock.processFrames, false);
}

/**
 * One process frame, `SceneTree::process` (`scene/main/scene_tree.cpp:695`): `process_frame`,
 * deferred calls, the processing nodes, deferred calls, a pending scene change, process timers,
 * the deletion queue; `Main::iteration` then flushes deferred calls and counts the frame
 * (`main/main.cpp:5115`).
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:695
 */
export function godot_tree_frame(delta: number): void {
  openIteration();
  clock.processTime = delta;
  processFrame.emit();
  godot_message_queue_flush();
  physicsServer?.transforms();
  processNodes(false);
  godot_message_queue_flush();
  physicsServer?.transforms();
  if (clock.reloadPending) {
    clock.reloadPending = false;
    clock.reload?.();
  }
  processTimers(delta, false);
  physicsServer?.transforms();
  flushDeleteQueue();
  godot_message_queue_flush();
  clock.processFrames += 1;
  // Input reads the Engine counters between iterations too: events the page delivers before the
  // next iteration stamp this frame's count (`Engine::_process_frames`, `main/main.cpp:5115`).
  godot_input_frame(clock.physicsFrames, clock.processFrames, false);
  clock.iterationOpen = false;
}

/**
 * One `Main::iteration` at the wall clock `p_ticks_usec` (`main/main.cpp:4917`): `MainTimerSync`
 * turns the time since the last iteration into a process step and a count of physics steps at
 * `physics/common/physics_ticks_per_second` (default 60), at most
 * `physics/common/max_physics_steps_per_frame` (default 8) of them unless `--fixed-fps` is set,
 * the process step shortened by the steps dropped; then each physics step, then the process
 * frame. The host calls it once per rendered frame.
 *
 * @godot SceneTree (protocol)
 * @source main/main.cpp:4917
 */
export function godot_main_iteration(p_ticks_usec: number): void {
  // `Engine::set_physics_ticks_per_second` and friends at `Main::setup2` (`main/main.cpp:2247`).
  const ticksPerSecond = Math.max(1, Math.trunc(Number(get_setting('physics/common/physics_ticks_per_second', 60))));
  const maxSteps = Math.trunc(Number(get_setting('physics/common/max_physics_steps_per_frame', 8)));
  const jitterFix = Math.max(0, Number(get_setting('physics/common/physics_jitter_fix', 0.5)));
  const physicsStep = 1.0 / ticksPerSecond;
  const advance = godot_main_timer_sync_advance(p_ticks_usec, physicsStep, ticksPerSecond, jitterFix);
  let processStep = advance.process_step;
  let steps = advance.physics_steps;
  if (godot_main_timer_sync_fixed_fps() === -1 && steps > maxSteps) {
    processStep -= (steps - maxSteps) * physicsStep;
    steps = maxSteps;
  }
  for (let step = 0; step < steps; step += 1) godot_tree_physics_step(physicsStep);
  godot_tree_frame(processStep);
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
