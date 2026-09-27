/**
 * @godot-class Engine
 * @role PROTOCOL
 *
 * Godot 4.7's `Engine` frame counters (`core/config/engine.h:138`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`), which `Main::iteration` advances and
 * `scene-tree.ts`'s clock keeps. A singleton: its members take no receiver.
 */

import { godot_tree_frames } from './scene-tree';

/**
 * @godot Engine.get_process_frames
 * @source core/config/engine.h:139
 */
export function get_process_frames(): number {
  return godot_tree_frames().process;
}

/**
 * @godot Engine.get_physics_frames
 * @source core/config/engine.h:138
 */
export function get_physics_frames(): number {
  return godot_tree_frames().physics;
}

/**
 * @godot Engine.is_in_physics_frame
 * @source core/config/engine.h:140
 */
export function is_in_physics_frame(): boolean {
  return godot_tree_frames().inPhysics;
}
