/**
 * @godot-class InputEventScreenDrag
 * @role PROTOCOL
 *
 * Godot 4.7's `InputEventScreenDrag.index` and `position` on the event records of
 * `input-event.ts`, at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`.
 */

import type { InputEventRecord } from './input-event';
import type { Vector2 } from './vector2';

type ScreenDrag = Extract<InputEventRecord, { readonly type: 'screen_drag' }>;

/**
 * @godot InputEventScreenDrag.get_index
 * @source core/input/input_event.cpp:1437
 */
export function get_index(self: ScreenDrag): number {
  return self.index;
}

/**
 * @godot InputEventScreenDrag.get_position
 * @source core/input/input_event.cpp:1469
 */
export function get_position(self: ScreenDrag): Vector2 {
  return self.position;
}
