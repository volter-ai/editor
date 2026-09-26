/**
 * Godot BaseButton state over the retained Pixi Text that is the canvas-world Button entity.
 *
 * Semantics follow pinned Godot 3.6/4.7 `scene/gui/base_button.cpp`: a press starts on pointer
 * down, `action_mode` chooses whether `pressed` fires on press or release, release outside emits
 * `button_up` without `pressed`, toggle mode changes `button_pressed` before `toggled`/`pressed`,
 * and disabling a held button releases its held state without activating it. Pixi owns hit testing
 * and pointer capture; compat only maps those native events onto Godot's state/signals.
 */

import { Sprite, type FederatedPointerEvent, type Text } from 'pixi.js';
import { optionalControlBinding } from './control-state';
import { setControlFocusMode } from './control-widgets';
import { registerCanvasNodeRelease, type GodotCanvasItem } from './node';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import {
  activateGodotGroupedButton,
  getGodotButtonGroup,
  setGodotGroupedButtonPressed,
  setGodotButtonGroup,
  type GodotButtonGroup,
} from './button-group';
import {
  bindBaseButtonShortcut,
  getBaseButtonShortcut,
  setBaseButtonShortcut,
} from './base-button-shortcut';
import type { GodotShortcut } from './shortcut';
import { godotCallScriptVirtual } from './object';
import { projectGodotTexture } from './button-icon';
import {
  bindControlThemeConsumer,
  getControlThemeConstant,
  getControlThemeStyleBox,
  resolveControlThemeIconForDrawing,
} from './theme';

export interface CanvasBaseButtonInitial {
  readonly disabled?: boolean;
  readonly toggleMode?: boolean;
  readonly buttonPressed?: boolean;
  readonly buttonMask?: number;
  readonly keepPressedOutside?: boolean;
  /** Godot BaseButton ACTION_MODE_BUTTON_PRESS=0, ACTION_MODE_BUTTON_RELEASE=1. */
  readonly actionMode?: 0 | 1;
  readonly presentation?: 'button' | 'check-box' | 'check-button';
  readonly godotMajor?: 3 | 4;
  readonly shortcut?: GodotShortcut | null;
}

export interface GodotCanvasBaseButton extends Text, GodotCanvasItem {
  disabled: boolean;
  toggle_mode: boolean;
  button_pressed: boolean;
  action_mode: 0 | 1;
  button_mask: number;
  keep_pressed_outside: boolean;
  button_group: GodotButtonGroup | null;
  shortcut: GodotShortcut | null;
  readonly pressed: GodotSignal<readonly []>;
  readonly toggled: GodotSignal<readonly [boolean]>;
  readonly button_down: GodotSignal<readonly []>;
  readonly button_up: GodotSignal<readonly []>;
  set_pressed(value: boolean): void;
  set_pressed_no_signal(value: boolean): void;
  set_disabled(value: boolean): void;
  is_hovered(): boolean;
  is_pressed(): boolean;
  press(mouseButton?: number): boolean;
  release(mouseButton?: number): boolean;
  cancel(): void;
  pointer_outside(mouseButton?: number): void;
  set_toggle_mode(value: boolean): void;
  is_toggle_mode(): boolean;
  is_disabled(): boolean;
  set_action_mode(value: number): void;
  get_action_mode(): number;
  set_button_mask(value: number): void;
  get_button_mask(): number;
  get_draw_mode(): number;
  set_keep_pressed_outside(value: boolean): void;
  is_keep_pressed_outside(): boolean;
  set_shortcut(shortcut: GodotShortcut | null): void;
  get_shortcut(): GodotShortcut | null;
}

interface CanvasButtonState {
  readonly pressed: SignalHandle<readonly []>;
  readonly toggled: SignalHandle<readonly [boolean]>;
  readonly down: SignalHandle<readonly []>;
  readonly up: SignalHandle<readonly []>;
  held: boolean;
  heldButton: number;
  hovered: boolean;
  focused: boolean;
  released: boolean;
  unregisterRelease(): void;
  removeListeners(): void;
  readonly presentation: 'button' | 'check-box' | 'check-button';
  readonly label: string;
  readonly focusElement?: HTMLButtonElement;
  releaseShortcut(): void;
  themeIconsBound: boolean;
  themedIconIdentity: unknown;
  themedIconSprite: Sprite | null;
  releaseThemeIcons(): void;
}

const BUTTONS = new WeakMap<GodotCanvasBaseButton, CanvasButtonState>();

function stateOf(button: GodotCanvasBaseButton): CanvasButtonState {
  const state = BUTTONS.get(button);
  if (state === undefined) throw new Error('BaseButton canvas entity is not bound.');
  return state;
}

function emitPressed(button: GodotCanvasBaseButton, state: CanvasButtonState): void {
  if (button.toggle_mode) {
    button.button_pressed = activateGodotGroupedButton(button, !button.button_pressed);
    state.toggled.emit(button.button_pressed);
  }
  godotCallScriptVirtual(button, '_pressed', []);
  state.pressed.emit();
}

function drawPresentation(button: GodotCanvasBaseButton, state: CanvasButtonState): void {
  if (state.presentation === 'button') return;
  if (state.presentation === 'check-button' && state.themeIconsBound && drawCheckButtonThemeIcon(button, state)) {
    button.text = state.label;
    return;
  }
  const mark = state.presentation === 'check-box'
    ? (button.button_pressed ? '☑' : '☐')
    : (button.button_pressed ? '●' : '○');
  button.text = `${mark} ${state.label}`;
}

function drawCheckButtonThemeIcon(button: GodotCanvasBaseButton, state: CanvasButtonState): boolean {
  if (!state.themeIconsBound) return false;
  const suffix = button.disabled ? '_disabled' : '';
  const onResolution = resolveControlThemeIconForDrawing(button, `on${suffix}`, 'CheckButton');
  const offResolution = resolveControlThemeIconForDrawing(button, `off${suffix}`, 'CheckButton');
  if (onResolution.kind === 'null' || offResolution.kind === 'null') {
    throw new Error(
      `godot-compat: CheckButton requires non-null Theme icons on${suffix} and off${suffix}.`,
    );
  }
  if (onResolution.kind === 'missing' || offResolution.kind === 'missing') {
    if (state.themedIconSprite !== null) state.themedIconSprite.visible = false;
    return false;
  }
  const on = projectGodotTexture(
    onResolution.value,
    `godot-compat: CheckButton.icons/on${suffix}`,
  );
  const off = projectGodotTexture(
    offResolution.value,
    `godot-compat: CheckButton.icons/off${suffix}`,
  );
  const selected = button.button_pressed ? on : off;
  if (state.themedIconSprite === null && selected.pixiTexture !== null) {
    state.themedIconSprite = new Sprite(selected.pixiTexture);
    state.themedIconSprite.label = '__godot_check_button_icon';
    state.themedIconSprite.anchor.set(0, 0);
    button.addChild(state.themedIconSprite);
  } else if (selected.identity !== state.themedIconIdentity && selected.pixiTexture !== null) {
    if (state.themedIconSprite !== null) state.themedIconSprite.texture = selected.pixiTexture;
  }
  state.themedIconIdentity = selected.identity;
  if (state.themedIconSprite === null) return false;
  state.themedIconSprite.visible = selected.pixiTexture !== null;
  const onWidth = on.pixiTexture?.width ?? 0;
  const offWidth = off.pixiTexture?.width ?? 0;
  const onHeight = on.pixiTexture?.height ?? 0;
  const offHeight = off.pixiTexture?.height ?? 0;
  const iconWidth = Math.max(onWidth, offWidth);
  const iconHeight = Math.max(onHeight, offHeight);
  const binding = optionalControlBinding(button);
  const size = binding?.state.read(binding.id).size ?? binding?.state.authored(binding.id)?.size;
  const style = getControlThemeStyleBox(button, 'normal', 'CheckButton');
  const rightMargin = style?.getMargin(2) ?? 0;
  state.themedIconSprite.position.set(
    (size?.x ?? button.width) - iconWidth - rightMargin,
    ((size?.y ?? button.height) - iconHeight) / 2 + getControlThemeConstant(button, 'check_vadjust', 'CheckButton'),
  );
  return true;
}

function requireActionMode(value: number): 0 | 1 {
  if (value !== 0 && value !== 1) {
    throw new RangeError(`BaseButton.action_mode must be 0 or 1; received ${String(value)}.`);
  }
  return value;
}

function requireButtonMask(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('BaseButton.button_mask must be a non-negative MouseButtonMask bitfield.');
  }
  return value;
}

function mouseButtonBit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 31) return 0;
  if (value === 0) return 1;
  if (value === 1) return 4;
  if (value === 2) return 2;
  return 2 ** value;
}

/**
 * Bind Godot's button protocol directly onto the retained Pixi Text. There is no mirror node:
 * scripts, Pixi hit testing, hierarchy, rendering, and Object dispatch all retain one identity.
 */
export function bindCanvasBaseButton(
  native: Text,
  initial: CanvasBaseButtonInitial = {},
): GodotCanvasBaseButton {
  const button = native as GodotCanvasBaseButton;
  if (BUTTONS.has(button)) throw new Error('BaseButton canvas entity is already bound.');

  const pressed = createSignal<readonly []>();
  const toggled = createSignal<readonly [boolean]>();
  const down = createSignal<readonly []>();
  const up = createSignal<readonly []>();
  let disabled = Boolean(initial.disabled ?? false);
  let toggleMode = Boolean(initial.toggleMode ?? false);
  let buttonPressed = Boolean(initial.buttonPressed ?? false);
  let actionMode = requireActionMode(initial.actionMode ?? 1);
  let acceptedButtonMask = requireButtonMask(initial.buttonMask ?? 1);
  let keepPressedOutside = Boolean(initial.keepPressedOutside ?? false);
  const binding = optionalControlBinding(button);
  if (binding === undefined) {
    throw new Error('BaseButton canvas entity requires an existing retained Control binding.');
  }
  const focusElement = typeof document === 'undefined' ? undefined : document.createElement('button');
  if (focusElement !== undefined) {
    focusElement.type = 'button';
    focusElement.tabIndex = -1;
    focusElement.style.position = 'fixed';
    focusElement.style.left = '-10000px';
    focusElement.style.top = '0';
    focusElement.style.width = '1px';
    focusElement.style.height = '1px';
    focusElement.style.opacity = '0';
    focusElement.style.pointerEvents = 'none';
    document.body.append(focusElement);
    binding.state.write(binding.id, { focusElement });
  }
  if (binding.state.read(binding.id).focusMode === undefined) setControlFocusMode(button, 2);

  const state: CanvasButtonState = {
    pressed,
    toggled,
    down,
    up,
    held: false,
    heldButton: -1,
    hovered: false,
    focused: false,
    released: false,
    unregisterRelease: () => {},
    removeListeners: () => {},
    presentation: initial.presentation ?? 'button',
    label: String(native.text),
    ...(focusElement === undefined ? {} : { focusElement }),
    releaseShortcut: () => {},
    themeIconsBound: false,
    themedIconIdentity: null,
    themedIconSprite: null,
    releaseThemeIcons: () => {},
  };
  const applyPressed = (value: boolean, emitSignal: boolean): void => {
    const next = setGodotGroupedButtonPressed(button, Boolean(value));
    if (next === buttonPressed) return;
    buttonPressed = next;
    drawPresentation(button, state);
    if (emitSignal && toggleMode) state.toggled.emit(buttonPressed);
  };
  const press = (mouseButton = 0): boolean => {
    if (button.disabled || state.held || (acceptedButtonMask & mouseButtonBit(mouseButton)) === 0) return false;
    state.held = true;
    state.heldButton = mouseButton;
    state.down.emit();
    if (button.action_mode === 0) emitPressed(button, state);
    return true;
  };
  const release = (mouseButton = state.heldButton): boolean => {
    if (!state.held || mouseButton !== state.heldButton) return false;
    state.held = false;
    state.heldButton = -1;
    state.up.emit();
    if (!button.disabled && button.action_mode === 1) emitPressed(button, state);
    return true;
  };
  const cancel = (): void => {
    if (!state.held) return;
    state.held = false;
    state.heldButton = -1;
    state.up.emit();
  };
  BUTTONS.set(button, state);
  state.releaseShortcut = bindBaseButtonShortcut(button, initial.godotMajor ?? 4, () => {
    if (button.disabled) return;
    button.press();
    button.release();
  });
  state.unregisterRelease = registerCanvasNodeRelease(button, () => releaseCanvasBaseButton(button));

  Object.defineProperties(button, {
    disabled: {
      configurable: true,
      enumerable: true,
      get: () => disabled,
      set: (value: boolean) => {
        const next = Boolean(value);
        if (next === disabled) return;
        disabled = next;
        if (disabled && state.held) {
          state.held = false;
          state.heldButton = -1;
          state.up.emit();
        }
        if (disabled) state.hovered = false;
        if (focusElement !== undefined) focusElement.disabled = disabled;
        button.eventMode = disabled ? 'none' : 'static';
        button.cursor = disabled ? 'default' : 'pointer';
        drawPresentation(button, state);
      },
    },
    toggle_mode: {
      configurable: true,
      enumerable: true,
      get: () => toggleMode,
      set: (value: boolean) => { toggleMode = Boolean(value); },
    },
    button_pressed: {
      configurable: true,
      enumerable: true,
      get: () => buttonPressed,
      set: (value: boolean) => applyPressed(value, true),
    },
    action_mode: {
      configurable: true,
      enumerable: true,
      get: () => actionMode,
      set: (value: number) => { actionMode = requireActionMode(value); },
    },
    button_mask: {
      configurable: true,
      enumerable: true,
      get: () => acceptedButtonMask,
      set: (value: number) => {
        acceptedButtonMask = requireButtonMask(value);
        binding.state.write(binding.id, { buttonMask: acceptedButtonMask });
      },
    },
    keep_pressed_outside: {
      configurable: true,
      enumerable: true,
      get: () => keepPressedOutside,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('BaseButton.keep_pressed_outside requires bool.');
        keepPressedOutside = value;
        binding.state.write(binding.id, { buttonKeepPressedOutside: value });
      },
    },
    button_group: {
      configurable: true,
      enumerable: true,
      get: () => getGodotButtonGroup(button),
      set: (value: GodotButtonGroup | null) => setGodotButtonGroup(button, value),
    },
    shortcut: {
      configurable: true,
      enumerable: true,
      get: () => getBaseButtonShortcut(button),
      set: (value: GodotShortcut | null) => setBaseButtonShortcut(button, value),
    },
    pressed: { configurable: true, enumerable: true, value: pressed.signal },
    toggled: { configurable: true, enumerable: true, value: toggled.signal },
    button_down: { configurable: true, enumerable: true, value: down.signal },
    button_up: { configurable: true, enumerable: true, value: up.signal },
    set_pressed: { configurable: true, enumerable: false, value: (value: boolean) => applyPressed(value, true) },
    set_pressed_no_signal: { configurable: true, enumerable: false, value: (value: boolean) => applyPressed(value, false) },
    set_disabled: { configurable: true, enumerable: false, value: (value: boolean) => { button.disabled = value; } },
    is_hovered: { configurable: true, enumerable: false, value: () => state.hovered },
    is_pressed: { configurable: true, enumerable: false, value: () => buttonPressed },
    press: { configurable: true, enumerable: false, value: press },
    release: { configurable: true, enumerable: false, value: release },
    cancel: { configurable: true, enumerable: false, value: cancel },
    pointer_outside: { configurable: true, enumerable: false, value: (mouseButton = state.heldButton) => { if (keepPressedOutside) release(mouseButton); else cancel(); } },
    set_toggle_mode: { configurable: true, enumerable: false, value: (value: boolean) => { button.toggle_mode = value; } },
    is_toggle_mode: { configurable: true, enumerable: false, value: () => toggleMode },
    is_disabled: { configurable: true, enumerable: false, value: () => disabled },
    set_action_mode: { configurable: true, enumerable: false, value: (value: number) => { button.action_mode = requireActionMode(value); } },
    get_action_mode: { configurable: true, enumerable: false, value: () => actionMode },
    set_button_mask: { configurable: true, enumerable: false, value: (value: number) => { button.button_mask = value; } },
    get_button_mask: { configurable: true, enumerable: false, value: () => acceptedButtonMask },
    get_draw_mode: {
      configurable: true,
      enumerable: false,
      value: () => {
        if (disabled) return 3;
        const visuallyPressed = state.held || buttonPressed;
        if (state.hovered && visuallyPressed) return 4;
        if (visuallyPressed) return 1;
        return state.hovered ? 2 : 0;
      },
    },
    set_keep_pressed_outside: { configurable: true, enumerable: false, value: (value: boolean) => { button.keep_pressed_outside = value; } },
    is_keep_pressed_outside: { configurable: true, enumerable: false, value: () => keepPressedOutside },
    set_shortcut: { configurable: true, enumerable: false, value: (value: GodotShortcut | null) => setBaseButtonShortcut(button, value) },
    get_shortcut: { configurable: true, enumerable: false, value: () => getBaseButtonShortcut(button) },
  });

  const pointerOver = (): void => { if (!button.disabled) state.hovered = true; };
  const pointerOut = (): void => { state.hovered = false; };

  const pointerDown = (event: FederatedPointerEvent): void => {
    if (!button.disabled) focusElement?.focus();
    press(event.button);
  };
  const pointerUp = (event: FederatedPointerEvent): void => {
    release(event.button);
  };
  const pointerUpOutside = (event: FederatedPointerEvent): void => {
    if (!state.held || event.button !== state.heldButton) return;
    if (keepPressedOutside) release(event.button);
    else cancel();
  };
  button.on('pointerdown', pointerDown);
  button.on('pointerup', pointerUp);
  button.on('pointerupoutside', pointerUpOutside);
  button.on('pointerover', pointerOver);
  button.on('pointerout', pointerOut);
  button.eventMode = disabled ? 'none' : 'static';
  button.cursor = disabled ? 'default' : 'pointer';
  const focus = (): void => {
    state.focused = true;
    button.alpha = 1;
  };
  const blur = (): void => {
    state.focused = false;
    cancel();
    button.alpha = 0.92;
  };
  const keyDown = (event: KeyboardEvent): void => {
    if (event.repeat || button.disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    if (press(0)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const keyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      cancel();
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (release(0)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  if (focusElement !== undefined) {
    focusElement.disabled = disabled;
    focusElement.setAttribute('aria-label', String(button.text));
    focusElement.addEventListener('focus', focus);
    focusElement.addEventListener('blur', blur);
    focusElement.addEventListener('keydown', keyDown);
    focusElement.addEventListener('keyup', keyUp);
  }
  drawPresentation(button, state);
  binding.state.write(binding.id, {
    buttonMask: acceptedButtonMask,
    buttonKeepPressedOutside: keepPressedOutside,
  });
  if (initial.shortcut !== undefined) setBaseButtonShortcut(button, initial.shortcut);
  state.removeListeners = () => {
    button.off('pointerdown', pointerDown);
    button.off('pointerup', pointerUp);
    button.off('pointerupoutside', pointerUpOutside);
    button.off('pointerover', pointerOver);
    button.off('pointerout', pointerOut);
    focusElement?.removeEventListener('focus', focus);
    focusElement?.removeEventListener('blur', blur);
    focusElement?.removeEventListener('keydown', keyDown);
    focusElement?.removeEventListener('keyup', keyUp);
  };
  return button;
}

/** Release only compat-owned listeners/state; the scene remains the Pixi Text's lifecycle owner. */
export function releaseCanvasBaseButton(button: GodotCanvasBaseButton): void {
  const state = BUTTONS.get(button);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregisterRelease();
  state.removeListeners();
  state.releaseShortcut();
  state.releaseThemeIcons();
  state.themedIconSprite?.removeFromParent();
  state.themedIconSprite?.destroy({ children: true, texture: false, textureSource: false });
  const binding = optionalControlBinding(button);
  binding?.state.write(binding.id, { focusElement: null });
  state.focusElement?.remove();
  setGodotButtonGroup(button, null);
  BUTTONS.delete(button);
}

/** Bind Godot CheckButton's on/off and enabled/disabled Theme icon state to its retained Pixi Text. */
export function bindCanvasCheckButtonThemeIcons(button: GodotCanvasBaseButton): void {
  const state = stateOf(button);
  if (state.presentation !== 'check-button') {
    throw new TypeError('bindCanvasCheckButtonThemeIcons requires a CheckButton presentation.');
  }
  if (state.themeIconsBound) throw new Error('CheckButton Theme icons are already bound.');
  state.themeIconsBound = true;
  state.releaseThemeIcons = bindControlThemeConsumer(button, () => drawPresentation(button, state));
  drawPresentation(button, state);
}

/** Bind authored Godot 3 ToolButton state without introducing another Pixi identity. */
export function bindCanvasToolButton(
  button: Text,
  initial: CanvasBaseButtonInitial & { readonly flat?: boolean } = {},
): GodotCanvasBaseButton & { flat: boolean } {
  if (initial.flat === false) {
    throw new Error('ToolButton.flat=false requires the non-flat themed Button presentation.');
  }
  const toolButton = bindCanvasBaseButton(button, initial) as GodotCanvasBaseButton & { flat: boolean };
  Object.defineProperty(toolButton, 'flat', {
    enumerable: true,
    configurable: true,
    get: () => true,
    set: (value: boolean) => {
      if (value !== true) {
        throw new Error('ToolButton.flat=false requires the non-flat themed Button presentation.');
      }
    },
  });
  return toolButton;
}

/** Runtime guard used by script/property dispatch without accepting arbitrary Pixi Text values. */
export function isCanvasBaseButton(value: unknown): value is GodotCanvasBaseButton {
  return typeof value === 'object' && value !== null && BUTTONS.has(value as GodotCanvasBaseButton);
}
