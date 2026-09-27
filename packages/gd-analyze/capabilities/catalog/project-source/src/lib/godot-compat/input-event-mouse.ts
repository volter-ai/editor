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
