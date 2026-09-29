/**
 * @godot-class TouchScreenButton
 * @role BINDING
 *
 * Godot 4.7's `TouchScreenButton` (`scene/2d/physics/touch_screen_button.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the element its scene renders (docs/GODOT.md "UI is
 * React DOM"): the element's pointer events press and release its action (`_press`, `_release`),
 * a pointer sliding onto it presses it with `passby_press`, and it draws its pressed texture while
 * pressed (`data-texture-pressed`).
 */

import { action_press, action_release } from './input';

/** The elements pressed now, each by the action it pressed. */
const PRESSED = new WeakSet<Element>();

function draw(element: HTMLElement, pressed: boolean): void {
  const texture = pressed ? element.dataset['texturePressed'] : element.dataset['textureNormal'];
  if (texture !== undefined) element.style.backgroundImage = texture === 'none' ? '' : texture;
}

/**
 * A pointer pressing (`pressed`) or releasing the button: its action pressed or released.
 *
 * @godot TouchScreenButton (protocol)
 * @source scene/2d/physics/touch_screen_button.cpp:313
 */
export function godot_touch_screen_button_press(event: { readonly currentTarget: EventTarget | null }, action: string, pressed: boolean): void {
  const element = event.currentTarget as HTMLElement | null;
  if (element === null || PRESSED.has(element) === pressed) return;
  if (pressed) PRESSED.add(element);
  else PRESSED.delete(element);
  draw(element, pressed);
  if (action === '') return;
  if (pressed) action_press(action);
  else action_release(action);
}

/**
 * A pointer held down sliding onto the button (`passby_press`): it presses the button.
 *
 * @godot TouchScreenButton (protocol)
 * @source scene/2d/physics/touch_screen_button.cpp:161
 */
export function godot_touch_screen_button_pass(event: { readonly currentTarget: EventTarget | null; readonly buttons: number }, action: string): void {
  if (event.buttons !== 0) godot_touch_screen_button_press(event, action, true);
}
