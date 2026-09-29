/**
 * @godot-class BaseButton
 * @role BINDING
 *
 * Godot 4.7's `BaseButton` (`scene/gui/base_button.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the element its scene renders (docs/GODOT.md
 * "UI is React DOM"): its signals are the element's own events (`pressed` a click, `button_down`
 * and `button_up` the pointer's press and release, `toggled` a CheckBox's box changing or a toggle
 * button's click), and its pressed state is the box's `checked` or the button's `aria-pressed`.
 */

import { godot_node_entity } from './node';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

function elementOf(self: object, member: string): HTMLElement {
  const entity = godot_node_entity(self) as unknown;
  if (typeof HTMLElement === 'undefined' || !(entity instanceof HTMLElement)) throw new Error(`godot-compat: BaseButton.${member} on a node that is not a Control's element`);
  return entity;
}

/** A CheckBox's box (`data-part="check"`), which holds its pressed state. */
function boxOf(element: HTMLElement): HTMLInputElement | null {
  return element.querySelector<HTMLInputElement>(':scope > input[data-part="check"]');
}

/**
 * The page's buttons a key event is the shortcut of (`data-shortcut`, its actions): each pressed
 * as a click (`BaseButton::shortcut_input`), for the viewport's shortcut stage.
 *
 * @godot BaseButton (protocol)
 * @source scene/gui/base_button.cpp:388
 */
export function godot_base_button_shortcuts(document: Document, matches: (action: string) => boolean): boolean {
  let pressedAny = false;
  for (const element of document.querySelectorAll<HTMLElement>('[data-shortcut]')) {
    if (!element.checkVisibility() || (element as HTMLButtonElement).disabled === true) continue;
    if (!(element.dataset['shortcut'] ?? '').split(' ').some(matches)) continue;
    element.click();
    pressedAny = true;
  }
  return pressedAny;
}

/** Each element's signals, made as a script first reaches them, each listening to its event. */
const SIGNALS = new WeakMap<HTMLElement, Map<string, SignalHandle<readonly any[]>>>();

function signalOf<Args extends readonly unknown[]>(element: HTMLElement, name: string, listen: (handle: SignalHandle<Args>) => void): GodotSignal<Args> {
  let signals = SIGNALS.get(element);
  if (signals === undefined) {
    signals = new Map();
    SIGNALS.set(element, signals);
  }
  let handle = signals.get(name) as SignalHandle<Args> | undefined;
  if (handle === undefined) {
    handle = createSignal<Args>();
    signals.set(name, handle as unknown as SignalHandle<readonly any[]>);
    listen(handle);
  }
  return handle.signal;
}

/**
 * A click: the page's own press and release over the element.
 *
 * @godot BaseButton.pressed
 * @source scene/gui/base_button.cpp:289
 */
export function pressed(self: object): GodotSignal<[]> {
  const element = elementOf(self, 'pressed');
  // `ACTION_MODE_BUTTON_PRESS` presses on the pointer's press (`data-action-mode`), else on the click.
  const event = element.dataset['actionMode'] === 'press' ? 'pointerdown' : 'click';
  return signalOf<[]>(element, 'pressed', (handle) => element.addEventListener(event, () => handle.emit()));
}

/**
 * A toggle button's click: its pressed state turned over, its pressed texture drawn while pressed
 * (`data-texture-pressed`), and `toggled` told (`BaseButton::_toggled`).
 *
 * @godot BaseButton (protocol)
 * @source scene/gui/base_button.cpp:141
 */
export function godot_base_button_toggle(event: { readonly currentTarget: EventTarget | null }): void {
  const element = event.currentTarget as HTMLElement | null;
  if (element === null) return;
  const next = element.getAttribute('aria-pressed') !== 'true';
  element.setAttribute('aria-pressed', String(next));
  drawPressed(element, next);
  (SIGNALS.get(element)?.get('toggled') as SignalHandle<[boolean]> | undefined)?.emit(next);
}

/** A texture button's texture for its state: pressed, else hovered, else normal (`TextureButton::_notification`). */
function drawPressed(element: HTMLElement, toggled: boolean): void {
  const pressed = toggled || element.dataset['held'] === 'true';
  const hovered = element.dataset['hovered'] === 'true';
  const texture = (pressed ? element.dataset['texturePressed'] : undefined) ?? (hovered ? element.dataset['textureHover'] : undefined) ?? element.dataset['textureNormal'];
  // The focused texture over the rest while the button has focus.
  const focused = element.dataset['focused'] === 'true' ? element.dataset['textureFocused'] : undefined;
  const layers = [focused, texture].filter((layer): layer is string => layer !== undefined && layer !== 'none');
  if (texture !== undefined || focused !== undefined) element.style.backgroundImage = layers.join(', ');
}

/**
 * A pointer holding a (non-toggle) texture button down or letting go: its pressed texture drawn
 * while it is held (`BaseButton::is_pressed` during the press).
 *
 * @godot BaseButton (protocol)
 * @source scene/gui/base_button.cpp:97
 */
export function godot_base_button_hold(event: { readonly currentTarget: EventTarget | null }, held: boolean): void {
  const element = event.currentTarget as HTMLElement | null;
  if (element === null) return;
  element.dataset['held'] = String(held);
  drawPressed(element, element.getAttribute('aria-pressed') === 'true');
}

/**
 * The pointer leaving a texture button: no longer over it, nor holding it.
 *
 * @godot BaseButton (protocol)
 * @source scene/gui/base_button.cpp:74
 */
export function godot_base_button_leave(event: { readonly currentTarget: EventTarget | null }): void {
  const element = event.currentTarget as HTMLElement | null;
  if (element === null) return;
  element.dataset['held'] = 'false';
  element.dataset['hovered'] = 'false';
  drawPressed(element, element.getAttribute('aria-pressed') === 'true');
}

/**
 * A texture button taking or losing the page's focus: its focused texture drawn over the rest.
 *
 * @godot BaseButton (protocol)
 * @source scene/gui/texture_button.cpp:230
 */
export function godot_base_button_focus(event: { readonly currentTarget: EventTarget | null }, focused: boolean): void {
  const element = event.currentTarget as HTMLElement | null;
  if (element === null) return;
  element.dataset['focused'] = String(focused);
  drawPressed(element, element.getAttribute('aria-pressed') === 'true');
}

/**
 * The pointer entering or leaving a texture button: its hover texture drawn while it is over it.
 *
 * @godot BaseButton (protocol)
 * @source scene/gui/base_button.cpp:74
 */
export function godot_base_button_hover(event: { readonly currentTarget: EventTarget | null }, entering: boolean): void {
  const element = event.currentTarget as HTMLElement | null;
  if (element === null) return;
  element.dataset['hovered'] = String(entering);
  drawPressed(element, element.getAttribute('aria-pressed') === 'true');
}

/**
 * @godot BaseButton.button_down
 * @source scene/gui/base_button.cpp:612
 */
export function button_down(self: object): GodotSignal<[]> {
  const element = elementOf(self, 'button_down');
  return signalOf<[]>(element, 'button_down', (handle) => element.addEventListener('pointerdown', () => handle.emit()));
}

/**
 * @godot BaseButton.button_up
 * @source scene/gui/base_button.cpp:611
 */
export function button_up(self: object): GodotSignal<[]> {
  const element = elementOf(self, 'button_up');
  return signalOf<[]>(element, 'button_up', (handle) => element.addEventListener('pointerup', () => handle.emit()));
}

/**
 * A CheckBox's box changing, or a toggle button's click turning its pressed state over.
 *
 * @godot BaseButton.toggled
 * @source scene/gui/base_button.cpp:292
 */
export function toggled(self: object): GodotSignal<[boolean]> {
  const element = elementOf(self, 'toggled');
  // A toggle button's click tells it (`godot_base_button_toggle`); a CheckBox's box, its change.
  return signalOf<[boolean]>(element, 'toggled', (handle) => {
    const box = boxOf(element);
    if (box !== null) box.addEventListener('change', () => handle.emit(box.checked));
  });
}

/**
 * @godot BaseButton.is_pressed
 * @source scene/gui/base_button.cpp:354
 */
export function is_pressed(self: object): boolean {
  const element = elementOf(self, 'is_pressed');
  const box = boxOf(element);
  return box !== null ? box.checked : element.getAttribute('aria-pressed') === 'true';
}

/**
 * Sets the pressed state, which `toggled` reports (`BaseButton::set_pressed`).
 *
 * @godot BaseButton.set_pressed
 * @source scene/gui/base_button.cpp:321
 */
export function set_pressed(self: object, p_pressed: boolean): void {
  const element = elementOf(self, 'set_pressed');
  if (is_pressed(self) === p_pressed) return;
  const box = boxOf(element);
  if (box !== null) box.checked = p_pressed;
  else element.setAttribute('aria-pressed', String(p_pressed));
  drawPressed(element, p_pressed);
  (SIGNALS.get(element)?.get('toggled') as SignalHandle<[boolean]> | undefined)?.emit(p_pressed);
}

/**
 * Sets the pressed state without `toggled` (`BaseButton::set_pressed_no_signal`).
 *
 * @godot BaseButton.set_pressed_no_signal
 * @source scene/gui/base_button.cpp:338
 */
export function set_pressed_no_signal(self: object, p_pressed: boolean): void {
  const element = elementOf(self, 'set_pressed_no_signal');
  const box = boxOf(element);
  if (box !== null) box.checked = p_pressed;
  else element.setAttribute('aria-pressed', String(p_pressed));
  drawPressed(element, p_pressed);
}

/**
 * @godot BaseButton.set_disabled
 * @source scene/gui/base_button.cpp:295
 */
export function set_disabled(self: object, p_disabled: boolean): void {
  const element = elementOf(self, 'set_disabled');
  const target = boxOf(element) ?? element;
  (target as HTMLButtonElement).disabled = p_disabled;
}

/**
 * @godot BaseButton.is_disabled
 * @source scene/gui/base_button.cpp:317
 */
export function is_disabled(self: object): boolean {
  const element = elementOf(self, 'is_disabled');
  return ((boxOf(element) ?? element) as HTMLButtonElement).disabled === true;
}
