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

/**
 * The motion in screen pixels, before the viewport's stretch: the page's motion, which is the
 * event's own (`relative`) where the viewport does not stretch.
 *
 * @godot InputEventMouseMotion.get_screen_relative
 * @source core/input/input_event.cpp:944
 */
export function get_screen_relative(self: MouseMotion): Vector2 {
  return (self as { readonly screen_relative?: Vector2 }).screen_relative ?? self.relative ?? vector2();
}
