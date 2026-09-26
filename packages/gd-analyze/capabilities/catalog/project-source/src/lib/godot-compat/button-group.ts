/** Godot ButtonGroup Resource semantics shared by retained DOM and Pixi BaseButtons. */

import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  godotResourceEmitChanged,
  setGodotResourceLocalToScene,
} from './resource-io';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

/** The exact structural portion of BaseButton that ButtonGroup owns. */
export interface GodotGroupedButton {
  button_pressed: boolean;
  button_group: GodotButtonGroup | null;
}

export interface GodotButtonGroup {
  allow_unpress: boolean;
  readonly pressed: GodotSignal<readonly [GodotGroupedButton]>;
  get_pressed_button(): GodotGroupedButton | null;
  get_buttons(): readonly GodotGroupedButton[];
  set_allow_unpress(enabled: boolean): void;
  is_allow_unpress(): boolean;
}

interface ButtonGroupState {
  allowUnpress: boolean;
  readonly buttons: Set<GodotGroupedButton>;
  readonly pressed: SignalHandle<readonly [GodotGroupedButton]>;
}

const GROUPS = new WeakMap<GodotButtonGroup, ButtonGroupState>();
const BUTTON_GROUPS = new WeakMap<GodotGroupedButton, GodotButtonGroup>();

function bool(value: boolean, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires a bool.`);
  return value;
}

function stateOf(group: GodotButtonGroup): ButtonGroupState {
  const state = GROUPS.get(group);
  if (state === undefined) throw new Error('ButtonGroup Resource is not bound.');
  return state;
}

/** Allocate one Resource identity. Godot 4 ButtonGroup is local-to-scene by default. */
export function createGodotButtonGroup(
  major: 3 | 4,
  initial: { readonly allowUnpress?: boolean } = {},
): GodotButtonGroup {
  const pressed = createSignal<readonly [GodotGroupedButton]>();
  const group = {} as GodotButtonGroup;
  const state: ButtonGroupState = {
    allowUnpress: bool(initial.allowUnpress ?? false, 'ButtonGroup.allow_unpress'),
    buttons: new Set(),
    pressed,
  };
  GROUPS.set(group, state);
  registerGodotObjectIdentity(group, 'ButtonGroup');
  Object.defineProperties(group, {
    allow_unpress: {
      enumerable: true,
      configurable: true,
      get: () => state.allowUnpress,
      set: (value: boolean) => group.set_allow_unpress(value),
    },
    pressed: { enumerable: true, configurable: true, value: pressed.signal },
  });
  Object.assign(group, {
    get_pressed_button(): GodotGroupedButton | null {
      for (const button of state.buttons) if (button.button_pressed) return button;
      return null;
    },
    get_buttons(): readonly GodotGroupedButton[] {
      return [...state.buttons];
    },
    set_allow_unpress(enabled: boolean): void {
      const next = bool(enabled, 'ButtonGroup.set_allow_unpress');
      if (next === state.allowUnpress) return;
      state.allowUnpress = next;
      godotResourceEmitChanged(group);
    },
    is_allow_unpress(): boolean {
      return state.allowUnpress;
    },
  });
  bindGodotResourceProtocol(group, {
    createDuplicate(source) {
      return createGodotButtonGroup(major, { allowUnpress: source.allow_unpress });
    },
  });
  if (major === 4) setGodotResourceLocalToScene(group, true);
  return group;
}

/** Bind a retained BaseButton to the Resource, preserving one shared authored identity. */
export function setGodotButtonGroup(
  button: GodotGroupedButton,
  group: GodotButtonGroup | null,
): void {
  if (group !== null && !GROUPS.has(group)) {
    throw new TypeError('BaseButton.button_group requires a ButtonGroup Resource or null.');
  }
  const previous = BUTTON_GROUPS.get(button) ?? null;
  if (previous === group) return;
  if (previous !== null) stateOf(previous).buttons.delete(button);
  if (group === null) BUTTON_GROUPS.delete(button);
  else {
    BUTTON_GROUPS.set(button, group);
    stateOf(group).buttons.add(button);
  }
}

export function getGodotButtonGroup(button: GodotGroupedButton): GodotButtonGroup | null {
  return BUTTON_GROUPS.get(button) ?? null;
}

/**
 * Apply one interaction-driven toggle. The selected button cannot toggle itself off unless
 * allow_unpress is enabled; selecting a button unpresses every sibling and emits group.pressed.
 */
export function activateGodotGroupedButton(
  button: GodotGroupedButton,
  requested: boolean,
): boolean {
  const group = BUTTON_GROUPS.get(button);
  if (group === undefined) return requested;
  const state = stateOf(group);
  const next = !requested && button.button_pressed && !state.allowUnpress ? true : requested;
  return next;
}

/** Apply BaseButton.set_pressed group effects for script/property writes. */
export function setGodotGroupedButtonPressed(
  button: GodotGroupedButton,
  requested: boolean,
): boolean {
  const group = BUTTON_GROUPS.get(button);
  if (group === undefined || !requested || button.button_pressed === requested) return requested;
  const state = stateOf(group);
  for (const sibling of state.buttons) {
    if (sibling !== button && sibling.button_pressed) sibling.button_pressed = false;
  }
  state.pressed.emit(button);
  return true;
}
