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

import type { Object3D } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useBeforePhysicsStep } from '@react-three/rapier';
import { type RefObject, useEffect, useRef } from 'react';
import { get_physics_process_delta_time, godot_node_advance, is_inside_tree } from './node';
import { godot_process_delta } from './scene-tree';
import { godot_window_canvas_layer, godot_window_canvas_root, godot_window_process_events } from './window';
import { godot_canvas_item_draw, godot_canvas_item_undraw } from './canvas-item';
import { godot_animation_clips_advance } from './animation-clips';

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
 * A model's AnimationPlayers that play its glTF's clips, advanced from the model's own frame
 * (`animation-clips.ts`).
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:2283
 */
export function useGodotClips(model: RefObject<Object3D | null>): void {
  useFrame((_, delta) => {
    if (model.current !== null) godot_animation_clips_advance(model.current, delta);
  });
}

/**
 * A canvas item's or layer's own drawing, from its own component: each frame it draws itself onto
 * the root Window's canvas layer (`godot_canvas_item_draw`), and it takes its element off the page
 * as it unmounts.
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:469
 */
export function useGodotCanvasItem(entity: Object3D): void {
  const viewport = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  useFrame(() => {
    const root = godot_window_canvas_root(gl.domElement);
    if (root !== undefined) godot_canvas_item_draw(entity, viewport, root);
  });
  useEffect(() => () => godot_canvas_item_undraw(entity), [entity]);
}

/**
 * The root Window's own processing, from its component's frame: at the start of each frame, before
 * the physics steps and the scripts' `_process` (its hook runs first, by its priority), the page's
 * buffered input becomes events (`OS_Web::main_loop_iterate` then
 * `DisplayServerWeb::process_events`), as Godot's iteration begins; and it places its canvas layer
 * over the canvas, which its canvas items draw themselves into.
 *
 * @godot Window (protocol)
 * @source platform/web/os_web.cpp:87
 */
export function useGodotRootWindow(): void {
  const gl = useThree((state) => state.gl);
  // The frame's identity is three's own count of the renderer's frames, its delta R3F's. A renderer
  // that keeps no count (a host's stand-in) gives each frame R3F's elapsed time as its identity,
  // which repeats while its clock is paused (a press then reads as just pressed until it moves).
  useFrame((state, delta) => godot_window_process_events({ id: state.gl.info?.render?.frame ?? state.clock.elapsedTime, delta }), -1);
  // The Window's own canvas layer, placed over the canvas each frame; each canvas item draws itself
  // into it from its own component (`useGodotCanvasItem`).
  useFrame(() => godot_window_canvas_layer(gl.domElement), -1);
}
