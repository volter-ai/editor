/**
 * @godot-class InputMap
 * @role BINDING
 *
 * Godot 4.7's `InputMap` singleton (`core/input/input_map.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the project's actions, loaded from its input map
 * file and changed by scripts (`input.ts` holds them). A singleton: no receiver.
 */

import type { InputEventRecord } from './input-event';
import { godot_input_map_actions, godot_input_map_add, godot_input_map_add_event, godot_input_map_erase, godot_input_map_has } from './input';

/**
 * @godot InputMap.has_action
 * @source core/input/input_map.cpp:164
 */
export function has_action(action: string): boolean {
  return godot_input_map_has(action);
}

/**
 * @godot InputMap.add_action
 * @source core/input/input_map.cpp:115
 */
export function add_action(action: string, deadzone = 0.2): void {
  godot_input_map_add(action, deadzone);
}

/**
 * @godot InputMap.erase_action
 * @source core/input/input_map.cpp:124
 */
export function erase_action(action: string): void {
  godot_input_map_erase(action, false);
}

/**
 * @godot InputMap.action_add_event
 * @source core/input/input_map.cpp:199
 */
export function action_add_event(action: string, event: InputEventRecord): void {
  godot_input_map_add_event(action, event);
}

/**
 * @godot InputMap.action_erase_events
 * @source core/input/input_map.cpp:229
 */
export function action_erase_events(action: string): void {
  godot_input_map_erase(action, true);
}

/**
 * @godot InputMap.get_actions
 * @source core/input/input_map.cpp:130
 */
export function get_actions(): string[] {
  return godot_input_map_actions();
}
