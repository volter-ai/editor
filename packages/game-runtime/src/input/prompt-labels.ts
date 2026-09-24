// F3 (spec §12 "Add Rebinding and Prompts") — the device->label map behind
// `InputManager.getPrompt`. Pure data + pure functions, no InputManager
// dependency, so it's independently unit-testable and reusable by a
// rebinding UI that wants to render a label without going through a live
// InputManager instance (e.g. previewing a not-yet-applied binding).
//
// Labels intentionally favor short, conventional display strings over exact
// spec names (`'Ctrl'` not `'ControlLeft'`, `'A'` not `'button-0'`) — this is
// what a HUD prompt or rebinding list actually renders.

import type { InputBinding, PromptDevice } from './input-types';

/** `KeyboardEvent.code` values with a friendlier display label than the raw
 *  code string. Anything not listed here falls through to `keyLabel`'s
 *  `Key*`/`Digit*` stripping, or the raw code as a last resort. */
const KEY_LABELS: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  CapsLock: 'Caps Lock',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  MetaLeft: 'Meta',
  MetaRight: 'Meta',
};

/** Display label for a `KeyboardEvent.code` (F3 AC example: `'Space'`). */
export function keyLabel(code: string): string {
  const known = KEY_LABELS[code];
  if (known) return known;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3); // KeyW -> W
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5); // Digit1 -> 1
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('F') && /^F\d+$/.test(code)) return code; // F1..F12 already short
  return code;
}

const MOUSE_BUTTON_LABELS: Record<number, string> = {
  0: 'Left Click',
  1: 'Middle Click',
  2: 'Right Click',
  3: 'Mouse 4',
  4: 'Mouse 5',
};

/** Display label for a `MouseEvent.button` index. */
export function mouseButtonLabel(button: number): string {
  return MOUSE_BUTTON_LABELS[button] ?? `Mouse ${button}`;
}

/** W3C Standard Gamepad button-index -> conventional face-button glyph name
 *  (F3 AC example: `'A'`). Only meaningful when `Gamepad.mapping === 'standard'`
 *  — see `InputManager.getPrompt`, which falls back to a raw index label when
 *  the connected pad doesn't report the standard mapping. */
export const STANDARD_GAMEPAD_BUTTON_LABELS: Record<number, string> = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'Back',
  9: 'Start',
  10: 'L3',
  11: 'R3',
  12: 'D-Up',
  13: 'D-Down',
  14: 'D-Left',
  15: 'D-Right',
  16: 'Home',
};

/** Display label for a single standard-mapping gamepad axis (a `gamepad_axis`
 *  binding — one half of a stick, or a trigger). */
export function gamepadAxisLabel(axis: number): string {
  if (axis === 0 || axis === 1) return 'Left Stick';
  if (axis === 2 || axis === 3) return 'Right Stick';
  return `Axis ${axis}`;
}

/** Display label for a coupled `gamepad_axis_pair` binding. */
export function gamepadAxisPairLabel(xAxis: number, yAxis: number): string {
  if (xAxis === 0 && yAxis === 1) return 'Left Stick';
  if (xAxis === 2 && yAxis === 3) return 'Right Stick';
  return `Axis ${xAxis}/${yAxis}`;
}

/** Which `PromptDevice` family a binding kind belongs to, or `null` for a
 *  binding kind with no real physical device (the synthetic `test_*` kinds —
 *  they're an injected-test-input source, never something to prompt a player
 *  about). */
export function bindingDeviceFamily(type: InputBinding['type']): PromptDevice | null {
  switch (type) {
    case 'key':
      return 'keyboard';
    case 'mouse_button':
    case 'mouse_move':
      return 'mouse';
    case 'gamepad_button':
    case 'gamepad_axis':
    case 'gamepad_axis_pair':
      return 'gamepad';
    case 'touch_button':
    case 'touch_stick':
      return 'touch';
    default:
      return null;
  }
}
