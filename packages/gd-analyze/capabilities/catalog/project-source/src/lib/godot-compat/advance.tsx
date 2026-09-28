/**
 * @godot-class Node
 * @role PROTOCOL
 *
 * A node that advances itself (an animation player, a particle system) does it from its own
 * component's hooks: the host's `useFrame` for its internal processing and `useBeforePhysicsStep`
 * for its internal physics processing, as a three.js component animates itself. The only hooks
 * compat takes from the host, each advancing one node: compat never drives other nodes' work from
 * the frame (docs/GODOT.md §The lane's law, row 4). A node that hands the renderer something each
 * frame (a WorldEnvironment) does it from its own component too (`useGodotDraw`). The SceneTree
 * advances the same way, from the
 * world's component (`useGodotTree`): its own frames, timers, tweens and deletion queue; and the
 * root Window, a node, from its own (`useGodotRootWindow`): the page's input and its canvas items.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { useLayoutEffect, useRef } from 'react';
import { godot_canvas_draw } from './canvas-item';
import { get_physics_process_delta_time, godot_node_advance, is_inside_tree } from './node';
import { get_setting } from './project-settings';
import { godot_tree_physics_begin, godot_tree_physics_end, godot_tree_process_begin, godot_tree_process_end } from './scene-tree';
import { godot_window_canvas_layer, godot_window_process_events } from './window';

/**
 * The frame's delta as Godot code sees it: at most `max_physics_steps_per_frame` physics ticks
 * (8/60 s by default). Godot never advances a frame by more (`main/main.cpp:4951`: a frame due more
 * steps than the maximum drops the excess from its process step), so a stall, such as a page's
 * first frames while it loads, never reaches a node as one long delta. The emitted scripts'
 * `_process` is handed the same bound, so it and `get_process_delta_time()` agree. The physics
 * step needs none: Rapier steps at its fixed `timeStep`, so a stall adds steps, never a longer one.
 */
function processDelta(delta: number): number {
  const steps = Number(get_setting('physics/common/max_physics_steps_per_frame', 8));
  const ticks = Number(get_setting('physics/common/physics_ticks_per_second', 60));
  return Math.min(delta, steps / ticks);
}

/**
 * Runs one node's own internal processing from its component's frame and physics step.
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1219
 */
export function useGodotAdvance(entity: object): void {
  useFrame((_, delta) => godot_node_advance(entity, false, processDelta(delta)));
  useBeforePhysicsStep(() => godot_node_advance(entity, true, get_physics_process_delta_time(entity)));
}

/**
 * What one node hands the renderer each frame, from its component's frame while the node is inside
 * the tree, whatever its process mode: Godot's rendering server draws the world as it stands each
 * frame, paused or not (`RenderingServerDefault::draw`). A WorldEnvironment draws its environment
 * this way.
 *
 * @godot Node (protocol)
 * @source servers/rendering/rendering_server_default.cpp:443
 */
export function useGodotDraw(entity: object | undefined, draw: () => void): void {
  const current = useRef(draw);
  current.current = draw;
  useFrame(() => {
    if (entity !== undefined && is_inside_tree(entity)) current.current();
  });
}

/**
 * The SceneTree's frames on the host's clock, from the world's component: each Rapier step begins
 * and ends its physics frame, each R3F frame begins and ends its process frame, so timers, tweens
 * and the deletion queue run after the scripts' own hooks, as `SceneTree::physics_process` and
 * `SceneTree::process` run them after the nodes; the process frame's delta is bounded as the
 * scripts' is (`processDelta`). Registered from a layout effect, the step's begin is its first
 * callback, and the frame's begin runs first by its priority.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:639
 */
export function useGodotTree(): void {
  const rapier = useRapier();
  useLayoutEffect(() => {
    const begin = { current: (world: { readonly timestep: number }) => godot_tree_physics_begin(world.timestep) };
    const end = { current: () => godot_tree_physics_end() };
    rapier.beforeStepCallbacks.add(begin as never);
    rapier.afterStepCallbacks.add(end as never);
    return () => {
      rapier.beforeStepCallbacks.delete(begin as never);
      rapier.afterStepCallbacks.delete(end as never);
    };
  }, [rapier]);
  useFrame((_, delta) => godot_tree_process_begin(processDelta(delta)), -1);
  useFrame(() => godot_tree_process_end());
}

/**
 * The root Window's own processing, from its component's frame: at the start of each frame the
 * page's buffered input becomes events (`OS_Web::main_loop_iterate` then
 * `DisplayServerWeb::process_events`), and each frame it draws its canvas items over the canvas.
 *
 * @godot Window (protocol)
 * @source platform/web/os_web.cpp:87
 */
export function useGodotRootWindow(): void {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  useFrame(() => {
    godot_window_process_events();
    godot_canvas_draw(scene, godot_window_canvas_layer(gl.domElement));
  });
}
