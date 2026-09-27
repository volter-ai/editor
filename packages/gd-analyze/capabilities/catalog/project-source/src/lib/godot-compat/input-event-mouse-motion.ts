/**
 * @godot-class InputEventMouseMotion
 * @role PROTOCOL
 *
 * Godot 4.7's `InputEventMouseMotion.relative` on the event records of `input-event.ts`, at
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`.
 */

import type { InputEventRecord } from './input-event';
import { construct as vector2, type Vector2 } from './vector2';

export type MouseMotion = Extract<InputEventRecord, { readonly type: 'mouse_motion' }>;

/**
 * The motion since the previous event (accumulated motions summed); unset is `Vector2()`.
 *
 * @godot InputEventMouseMotion.get_relative
 * @source core/input/input_event.cpp:948
 */
export function get_relative(self: MouseMotion): Vector2 {
  return self.relative ?? vector2();
}
