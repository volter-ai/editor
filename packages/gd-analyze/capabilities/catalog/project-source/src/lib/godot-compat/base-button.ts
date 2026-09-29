/**
 * @godot-class BaseButton
 * @role BINDING
 *
 * Godot 4.7's `BaseButton` (`scene/gui/base_button.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Control pressed by the left mouse button, by default
 * on release inside it (`ACTION_MODE_BUTTON_RELEASE`), emitting `button_down`, `button_up` and
 * `pressed` (and `toggled` in toggle mode), or by its shortcut. A shortcut's action events press it
 * when their action is just pressed; its key events are stored.
 */

import type { Object3D } from 'three';
import { is_visible_in_tree } from './canvas-item';
import { godot_control_set_gui_input } from './control';
import { is_action_just_pressed } from './input';
import type { InputEventRecord } from './input-event';
import { godot_node_entity, godot_node_set_internal_process } from './node';
import type { Shortcut } from './shortcut';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

const ACTION_MODE_BUTTON_PRESS = 0;

export interface BaseButtonState {
  disabled: boolean;
  toggleMode: boolean;
  pressed: boolean;
  /** The mouse is held on it. */
  down: boolean;
  hovered: boolean;
  actionMode: number;
  keepPressedOutside: boolean;
  shortcut: Shortcut | null;
  /** Redraws the class's look after its state changes. */
  readonly changed: () => void;
  readonly signals: {
    readonly pressed: SignalHandle<[]>;
    readonly button_down: SignalHandle<[]>;
    readonly button_up: SignalHandle<[]>;
    readonly toggled: SignalHandle<[boolean]>;
  };
}

const BUTTONS = new WeakMap<object, BaseButtonState>();

function stateOf(self: object, member: string): BaseButtonState {
  const state = BUTTONS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a BaseButton`);
  return state;
}

/** `_pressed` then the signals (`BaseButton::_toggled` / `on_action_event`, `base_button.cpp:132`). */
function press(state: BaseButtonState): void {
  if (state.toggleMode) {
    state.pressed = !state.pressed;
    state.signals.toggled.emit(state.pressed);
  }
  state.signals.pressed.emit();
  state.changed();
}

/**
 * Makes `entity` (a Control already mounted) a button: its mouse input and its shortcut.
 *
 * @godot BaseButton (protocol)
 * @source scene/gui/base_button.cpp:132
 */
export function godot_base_button_mount(entity: Object3D, changed: () => void): BaseButtonState {
  const state: BaseButtonState = {
    disabled: false,
    toggleMode: false,
    pressed: false,
    down: false,
    hovered: false,
    actionMode: 1,
    keepPressedOutside: false,
    shortcut: null,
    changed,
    signals: { pressed: createSignal<[]>(), button_down: createSignal<[]>(), button_up: createSignal<[]>(), toggled: createSignal<[boolean]>() },
  };
  BUTTONS.set(entity, state);
  godot_control_set_gui_input(entity, {
    native: (event) => {
      const record = event as InputEventRecord;
      if (state.disabled) return;
      if (record.type === 'mouse_motion') {
        if (!state.hovered) {
          state.hovered = true;
          changed();
        }
        return;
      }
      if (record.type !== 'mouse_button' || record.button_index !== 1) return;
      if (record.pressed) {
        state.down = true;
        state.signals.button_down.emit();
        if (state.actionMode === ACTION_MODE_BUTTON_PRESS) press(state);
      } else if (state.down) {
        state.down = false;
        state.signals.button_up.emit();
        if (state.actionMode !== ACTION_MODE_BUTTON_PRESS) press(state);
      }
      changed();
    },
  });
  // The shortcut's actions (`BaseButton::shortcut_input`, `base_button.cpp:380`).
  godot_node_set_internal_process(entity, () => {
    if (state.disabled || state.shortcut === null || !is_visible_in_tree(entity)) return;
    for (const event of state.shortcut.events) {
      if (event.type === 'action' && is_action_just_pressed(event.action)) {
        press(state);
        break;
      }
    }
  });
  return state;
}

/**
 * @godot BaseButton.set_disabled
 * @source scene/gui/base_button.cpp:198
 */
export function set_disabled(self: object, disabled: boolean): void {
  const state = stateOf(self, 'set_disabled');
  state.disabled = disabled;
  if (disabled) state.down = false;
  state.changed();
}

/**
 * @godot BaseButton.is_disabled
 * @source scene/gui/base_button.cpp:213
 */
export function is_disabled(self: object): boolean {
  return stateOf(self, 'is_disabled').disabled;
}

/**
 * @godot BaseButton.set_pressed
 * @source scene/gui/base_button.cpp:217
 */
export function set_pressed(self: object, pressed: boolean): void {
  const state = stateOf(self, 'set_pressed');
  if (!state.toggleMode || state.pressed === pressed) return;
  state.pressed = pressed;
  state.signals.toggled.emit(pressed);
  state.changed();
}

/**
 * @godot BaseButton.set_pressed_no_signal
 * @source scene/gui/base_button.cpp:237
 */
export function set_pressed_no_signal(self: object, pressed: boolean): void {
  const state = stateOf(self, 'set_pressed_no_signal');
  if (!state.toggleMode) return;
  state.pressed = pressed;
  state.changed();
}

/**
 * @godot BaseButton.is_pressed
 * @source scene/gui/base_button.cpp:250
 */
export function is_pressed(self: object): boolean {
  const state = stateOf(self, 'is_pressed');
  return state.toggleMode ? state.pressed : state.down;
}

/**
 * @godot BaseButton.is_hovered
 * @source scene/gui/base_button.cpp:254
 */
export function is_hovered(self: object): boolean {
  return stateOf(self, 'is_hovered').hovered;
}

/**
 * @godot BaseButton.set_toggle_mode
 * @source scene/gui/base_button.cpp:292
 */
export function set_toggle_mode(self: object, on: boolean): void {
  const state = stateOf(self, 'set_toggle_mode');
  state.toggleMode = on;
  if (!on) state.pressed = false;
}

/**
 * @godot BaseButton.is_toggle_mode
 * @source scene/gui/base_button.cpp:303
 */
export function is_toggle_mode(self: object): boolean {
  return stateOf(self, 'is_toggle_mode').toggleMode;
}

/**
 * @godot BaseButton.set_action_mode
 * @source scene/gui/base_button.cpp:320
 */
export function set_action_mode(self: object, mode: number): void {
  stateOf(self, 'set_action_mode').actionMode = mode;
}

/**
 * @godot BaseButton.set_keep_pressed_outside
 * @source scene/gui/base_button.cpp:340
 */
export function set_keep_pressed_outside(self: object, keep: boolean): void {
  stateOf(self, 'set_keep_pressed_outside').keepPressedOutside = keep;
}

/**
 * @godot BaseButton.set_shortcut
 * @source scene/gui/base_button.cpp:360
 */
export function set_shortcut(self: object, shortcut: Shortcut | null): void {
  stateOf(self, 'set_shortcut').shortcut = shortcut;
}

/**
 * @godot BaseButton.get_shortcut
 * @source scene/gui/base_button.cpp:366
 */
export function get_shortcut(self: object): Shortcut | null {
  return stateOf(self, 'get_shortcut').shortcut;
}

/**
 * @godot BaseButton.pressed
 * @source scene/gui/base_button.cpp:480
 */
export function pressed(self: object): GodotSignal<[]> {
  return stateOf(self, 'pressed').signals.pressed.signal;
}

/**
 * @godot BaseButton.button_down
 * @source scene/gui/base_button.cpp:482
 */
export function button_down(self: object): GodotSignal<[]> {
  return stateOf(self, 'button_down').signals.button_down.signal;
}

/**
 * @godot BaseButton.button_up
 * @source scene/gui/base_button.cpp:481
 */
export function button_up(self: object): GodotSignal<[]> {
  return stateOf(self, 'button_up').signals.button_up.signal;
}

/**
 * @godot BaseButton.toggled
 * @source scene/gui/base_button.cpp:483
 */
export function toggled(self: object): GodotSignal<[boolean]> {
  return stateOf(self, 'toggled').signals.toggled.signal;
}

/**
 * The props every button class states (`base_button.cpp:490`), by the setters above.
 *
 * @godot BaseButton (protocol)
 * @source scene/gui/base_button.cpp:490
 */
export function godot_base_button_props(): (readonly [string, (entity: Object3D, value: never) => void])[] {
  return [
    ['disabled', (entity, value: boolean) => set_disabled(entity, value)],
    ['toggleMode', (entity, value: boolean) => set_toggle_mode(entity, value)],
    ['buttonPressed', (entity, value: boolean) => set_pressed_no_signal(entity, value)],
    ['actionMode', (entity, value: number) => set_action_mode(entity, value)],
    ['keepPressedOutside', (entity, value: boolean) => set_keep_pressed_outside(entity, value)],
    ['shortcut', (entity, value: Shortcut | null) => set_shortcut(entity, value)],
    ['buttonMask', () => undefined],
    ['shortcutFeedback', () => undefined],
    ['shortcutInTooltip', () => undefined],
    ['buttonGroup', () => undefined],
  ];
}

/**
 * Whether a button is held down now (for its look).
 *
 * @godot BaseButton (protocol)
 * @source scene/gui/base_button.cpp:258
 */
export function godot_base_button_draw_state(entity: object): { readonly down: boolean; readonly hovered: boolean; readonly disabled: boolean; readonly pressed: boolean } {
  const state = stateOf(entity, 'draw');
  return { down: state.down, hovered: state.hovered, disabled: state.disabled, pressed: state.pressed };
}
