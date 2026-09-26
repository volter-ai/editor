/**
 * @godot-class InputEventScreenTouch
 * @role PROTOCOL
 *
 * Godot 4.7's `InputEventScreenTouch.index` and `position` on the event records of
 * `input-event.ts`, at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`.
 */

import type { InputEventRecord } from './input-event';
import type { Vector2 } from './vector2';

type ScreenTouch = Extract<InputEventRecord, { readonly type: 'screen_touch' }>;

/**
 * @godot InputEventScreenTouch.get_index
 * @source core/input/input_event.cpp:1355
 */
export function get_index(self: ScreenTouch): number {
  return self.index;
}

/**
 * @godot InputEventScreenTouch.get_position
 * @source core/input/input_event.cpp:1363
 */
export function get_position(self: ScreenTouch): Vector2 {
  return self.position;
}
