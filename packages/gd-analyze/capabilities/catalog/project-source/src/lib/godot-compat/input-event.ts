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

import { godot_input_event_action_status } from './input';
import { construct as vector2, type Vector2 } from './vector2';

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
  | (Base &
      Modifiers & {
        readonly type: 'mouse_motion';
        readonly position: Vector2;
        /** The motion since the last event, in canvas pixels; unset is `Vector2()`. */
        readonly relative?: Vector2;
        /** The mouse buttons held (`MouseButtonMask`); unset is none. */
        readonly button_mask?: number;
      })
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

/** Each record's Godot class and its ancestors (ClassDB's `inherits`), which `is` and `as` read. */
const CLASSES: Readonly<Record<InputEventRecord['type'], readonly string[]>> = {
  key: ['InputEventKey', 'InputEventWithModifiers', 'InputEventFromWindow', 'InputEvent', 'Resource', 'RefCounted', 'Object'],
  mouse_button: ['InputEventMouseButton', 'InputEventMouse', 'InputEventWithModifiers', 'InputEventFromWindow', 'InputEvent', 'Resource', 'RefCounted', 'Object'],
  mouse_motion: ['InputEventMouseMotion', 'InputEventMouse', 'InputEventWithModifiers', 'InputEventFromWindow', 'InputEvent', 'Resource', 'RefCounted', 'Object'],
  joypad_button: ['InputEventJoypadButton', 'InputEvent', 'Resource', 'RefCounted', 'Object'],
  joypad_motion: ['InputEventJoypadMotion', 'InputEvent', 'Resource', 'RefCounted', 'Object'],
  screen_touch: ['InputEventScreenTouch', 'InputEventFromWindow', 'InputEvent', 'Resource', 'RefCounted', 'Object'],
  screen_drag: ['InputEventScreenDrag', 'InputEventFromWindow', 'InputEvent', 'Resource', 'RefCounted', 'Object'],
  action: ['InputEventAction', 'InputEvent', 'Resource', 'RefCounted', 'Object'],
};

/**
 * An input event record's class and ancestors, for `is` and `as`; undefined for any other object
 * (a three object's `type` names none of these).
 *
 * @godot InputEvent (protocol)
 * @source core/input/input_event.h:150
 */
export function godot_input_event_classes(object: object): readonly string[] | undefined {
  const type = (object as { readonly type?: unknown }).type;
  return typeof type === 'string' && Object.hasOwn(CLASSES, type) ? CLASSES[type as InputEventRecord['type']] : undefined;
}

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

/**
 * @godot InputEvent.is_echo
 * @source core/input/input_event.cpp:87
 */
export function is_echo(self: InputEventRecord): boolean {
  return self.type === 'key' && self.echo === true;
}

/**
 * Whether the event matches the action at all, pressed or not.
 *
 * @godot InputEvent.is_action
 * @source core/input/input_event.cpp:47
 */
export function is_action(self: InputEventRecord, action: string, exact_match = false): boolean {
  return godot_input_event_action_status(self, action, exact_match) !== undefined;
}

/**
 * Pressing the action, an echo only when `allow_echo`.
 *
 * @godot InputEvent.is_action_pressed
 * @source core/input/input_event.cpp:51
 */
export function is_action_pressed(self: InputEventRecord, action: string, allow_echo = false, exact_match = false): boolean {
  const status = godot_input_event_action_status(self, action, exact_match);
  return status !== undefined && status.pressed && (allow_echo || !is_echo(self));
}

/**
 * @godot InputEvent.is_action_released
 * @source core/input/input_event.cpp:57
 */
export function is_action_released(self: InputEventRecord, action: string, exact_match = false): boolean {
  const status = godot_input_event_action_status(self, action, exact_match);
  return status !== undefined && !status.pressed;
}

/**
 * @godot InputEvent.get_action_strength
 * @source core/input/input_event.cpp:63
 */
export function get_action_strength(self: InputEventRecord, action: string, exact_match = false): number {
  return godot_input_event_action_status(self, action, exact_match)?.strength ?? 0;
}

const ZERO = vector2();
const held = (value: boolean | undefined): boolean => value === true;

/**
 * `InputEvent::accumulate`: the event `next` folded into the buffered `last` when they are one
 * motion, else undefined. A mouse motion takes a motion with the same buttons and modifiers
 * (`InputEventMouseMotion::accumulate`: the latest position, the relative motions summed); a screen
 * drag takes a drag of the same touch (`InputEventScreenDrag::accumulate`: the latest position).
 *
 * @godot InputEvent (protocol)
 * @source core/input/input_event.cpp:1031
 * @source core/input/input_event.cpp:1536
 */
export function godot_input_event_accumulate(last: InputEventRecord, next: InputEventRecord): InputEventRecord | undefined {
  if (last.type === 'mouse_motion' && next.type === 'mouse_motion') {
    if (
      (last.button_mask ?? 0) !== (next.button_mask ?? 0) ||
      held(last.shift_pressed) !== held(next.shift_pressed) ||
      held(last.ctrl_pressed) !== held(next.ctrl_pressed) ||
      held(last.alt_pressed) !== held(next.alt_pressed) ||
      held(last.meta_pressed) !== held(next.meta_pressed)
    ) {
      return undefined;
    }
    const a = last.relative ?? ZERO;
    const b = next.relative ?? ZERO;
    return { ...last, position: next.position, relative: vector2(a.x + b.x, a.y + b.y) };
  }
  if (last.type === 'screen_drag' && next.type === 'screen_drag') {
    return last.index === next.index ? { ...last, position: next.position } : undefined;
  }
  return undefined;
}
