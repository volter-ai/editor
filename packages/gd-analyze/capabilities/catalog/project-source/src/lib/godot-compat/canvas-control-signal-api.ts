/** Native Control signal properties backed by the retained Pixi/DOM input lifecycle. */

import { Container } from 'pixi.js';

import {
  getControlFocusEnteredSignal,
  getControlFocusExitedSignal,
  getControlGuiInputSignal,
  getControlMouseExitedSignal,
  getControlResizedSignal,
} from './control-signals';
import type { GodotInputMapEvent } from './input';
import type { GodotSignal } from './signal';

export interface GodotCanvasControlSignalApi {
  readonly focus_entered: GodotSignal<readonly []>;
  readonly focus_exited: GodotSignal<readonly []>;
  readonly mouse_exited: GodotSignal<readonly []>;
  readonly gui_input: GodotSignal<readonly [GodotInputMapEvent]>;
  readonly resized: GodotSignal<readonly []>;
}

export function bindGodotCanvasControlSignalApi<T extends Container>(
  source: T,
  major: 3 | 4 = 4,
): T & GodotCanvasControlSignalApi {
  const control = source as T & GodotCanvasControlSignalApi;
  Object.defineProperties(control, {
    focus_entered: { configurable: true, enumerable: true, get: () => getControlFocusEnteredSignal(control, major) },
    focus_exited: { configurable: true, enumerable: true, get: () => getControlFocusExitedSignal(control, major) },
    mouse_exited: { configurable: true, enumerable: true, get: () => getControlMouseExitedSignal(control, major) },
    gui_input: { configurable: true, enumerable: true, get: () => getControlGuiInputSignal(control, major) },
    resized: { configurable: true, enumerable: true, get: () => getControlResizedSignal(control, major) },
  });
  return control;
}
