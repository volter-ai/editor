/**
 * @godot-class InputEvent
 * @role PROTOCOL
 *
 * Godot 4.7's `InputEvent` family as data, at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`
 * (`core/input/input_event.{h,cpp}`). An event is a plain record whose fields are the Godot
 * properties of its class, `type` naming the class; the generated composition site builds records
 * from native DOM/gamepad events, and `input.ts` consumes them. Unset modifiers and `canceled` are
 * false; positions are float32 `Vector2`s. An unset `device` is the class's constructed default:
 * `DEVICE_ID_KEYBOARD` (16) for a key (`core/input/input_event.cpp:669`), `DEVICE_ID_MOUSE` (32)
 * for a mouse event (`:715`), 0 otherwise. Only mouse buttons and screen touches can be canceled.
 */

import type { Vector2 } from './vector2';

interface Base {
  readonly device?: number;
}

interface Modifiers {
  readonly shift_pressed?: boolean;
  readonly alt_pressed?: boolean;
  readonly ctrl_pressed?: boolean;
  readonly meta_pressed?: boolean;
  /** Command on Apple platforms, Control elsewhere (`set_command_or_control_autoremap`). */
  readonly command_or_control_autoremap?: boolean;
}

export type InputEventRecord =
  | (Base &
      Modifiers & {
        readonly type: 'key';
        readonly pressed: boolean;
        readonly echo?: boolean;
        readonly keycode: number;
        readonly physical_keycode: number;
        readonly key_label: number;
        readonly location?: number;
      })
  | (Base &
      Modifiers & {
        readonly type: 'mouse_button';
        readonly pressed: boolean;
        readonly canceled?: boolean;
        readonly button_index: number;
        readonly position: Vector2;
      })
  | (Base & Modifiers & { readonly type: 'mouse_motion'; readonly position: Vector2 })
  | (Base & { readonly type: 'joypad_button'; readonly pressed: boolean; readonly button_index: number })
  | (Base & { readonly type: 'joypad_motion'; readonly axis: number; readonly axis_value: number })
  | (Base & {
      readonly type: 'screen_touch';
      readonly pressed: boolean;
      readonly canceled?: boolean;
      readonly index: number;
      readonly position: Vector2;
    })
  | (Base & { readonly type: 'screen_drag'; readonly index: number; readonly position: Vector2 })
  | (Base & {
      readonly type: 'action';
      readonly action: string;
      readonly pressed: boolean;
      readonly strength?: number;
      readonly event_index?: number;
    });

/**
 * `pressed && !canceled`; an event class without `pressed` is never pressed.
 *
 * @godot InputEvent.is_pressed
 * @source core/input/input_event.cpp:82
 */
export function is_pressed(self: InputEventRecord): boolean {
  return 'pressed' in self && self.pressed === true && ('canceled' in self ? self.canceled !== true : true);
}

/**
 * The event's device, or its class's constructed default when unset.
 *
 * @godot InputEvent.get_device
 * @source core/input/input_event.cpp:46
 */
export function get_device(self: InputEventRecord): number {
  if (self.device !== undefined) return self.device;
  if (self.type === 'key') return 16;
  if (self.type === 'mouse_button' || self.type === 'mouse_motion') return 32;
  return 0;
}
