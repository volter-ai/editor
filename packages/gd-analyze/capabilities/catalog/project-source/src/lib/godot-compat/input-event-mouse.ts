/**
 * @godot-class InputEventMouse
 * @role PROTOCOL
 *
 * Godot 4.7's `InputEventMouse.position` on the event records of `input-event.ts`, at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: mouse button and mouse motion events.
 */

import type { InputEventRecord } from './input-event';
import type { Vector2 } from './vector2';

/**
 * @godot InputEventMouse.get_position
 * @source core/input/input_event.cpp:688
 */
export function get_position(self: Extract<InputEventRecord, { readonly type: 'mouse_button' | 'mouse_motion' }>): Vector2 {
  return self.position;
}

/**
 * @godot InputEventMouseButton.get_button_index
 * @source core/input/input_event.cpp:786
 */
export function get_button_index(self: Extract<InputEventRecord, { readonly type: 'mouse_button' }>): number {
  return self.button_index;
}

/**
 * @godot InputEventMouseButton.is_double_click
 * @source core/input/input_event.cpp:806
 */
export function is_double_click(self: Extract<InputEventRecord, { readonly type: 'mouse_button' }>): boolean {
  void self;
  return false;
}
