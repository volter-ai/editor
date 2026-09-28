/**
 * @godot-class Node
 * @role PROTOCOL
 *
 * A node that advances itself (an animation player, a particle system) does it from its own
 * component's hooks: the host's `useFrame` for its internal processing and `useBeforePhysicsStep`
 * for its internal physics processing, as a three.js component animates itself. The only hooks
 * compat takes from the host, each advancing one node: compat never drives other nodes' work from
 * the frame (docs/GODOT.md §The lane's law, row 4). A node that hands the renderer something each
 * frame (a WorldEnvironment) does it from its own component too (`useGodotDraw`), and so does the
 * root Window, a node (`useGodotRootWindow`): the page's input and its canvas items. The SceneTree
 * has no hook: it keeps no clock, and a delta is read from the host when asked (`scene-tree.ts`).
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useBeforePhysicsStep } from '@react-three/rapier';
import { useRef } from 'react';
import { godot_canvas_draw } from './canvas-item';
import { get_physics_process_delta_time, godot_node_advance, is_inside_tree } from './node';
import { godot_process_delta } from './scene-tree';
import { godot_window_canvas_layer, godot_window_process_events } from './window';

/**
 * Runs one node's own internal processing from its component's frame and physics step.
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1219
 */
export function useGodotAdvance(entity: object): void {
  useFrame((_, delta) => godot_node_advance(entity, false, godot_process_delta(delta)));
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
 * The root Window's own processing, from its component's frame: at the start of each frame, before
 * the physics steps and the scripts' `_process` (its hook runs first, by its priority), the page's
 * buffered input becomes events (`OS_Web::main_loop_iterate` then
 * `DisplayServerWeb::process_events`), as Godot's iteration begins; and each frame it draws its
 * canvas items over the canvas, with the other frame work.
 *
 * @godot Window (protocol)
 * @source platform/web/os_web.cpp:87
 */
export function useGodotRootWindow(): void {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  // The frame's identity is three's own count of the renderer's frames, its delta R3F's.
  useFrame((state, delta) => godot_window_process_events({ id: state.gl.info.render.frame, delta }), -1);
  useFrame(() => godot_canvas_draw(scene, godot_window_canvas_layer(gl.domElement)));
}
