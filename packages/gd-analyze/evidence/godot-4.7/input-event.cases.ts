import * as E from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { eventCase } from './input-event-family';

const at = V2.construct(3.5, -2);
const EVENTS: readonly (readonly [string, E.InputEventRecord])[] = [
  ['key-pressed', { type: 'key', keycode: 65, physical_keycode: 0, key_label: 0, pressed: true }],
  ['key-released', { type: 'key', keycode: 65, physical_keycode: 0, key_label: 0, pressed: false, device: 16 }],
  ['key-device-zero', { type: 'key', keycode: 65, physical_keycode: 0, key_label: 0, pressed: true, device: 0 }],
  ['mouse-pressed', { type: 'mouse_button', button_index: 1, pressed: true, position: at, device: 32 }],
  ['mouse-canceled', { type: 'mouse_button', button_index: 1, pressed: true, canceled: true, position: at }],
  ['motion', { type: 'mouse_motion', position: at, device: 32 }],
  ['joypad-button', { type: 'joypad_button', button_index: 3, pressed: true, device: 2 }],
  ['touch', { type: 'screen_touch', index: 4, position: at, pressed: true, device: -1 }],
  ['touch-canceled', { type: 'screen_touch', index: 4, position: at, pressed: true, canceled: true }],
  ['drag', { type: 'screen_drag', index: 1, position: at }],
  ['action', { type: 'action', action: 'jump', pressed: true, strength: 0.5, device: 7 }],
];

const cases = EVENTS.flatMap(([name, event]) => [
  eventCase(`is_pressed-${name}`, 'InputEvent', 'is_pressed', event, (e) => E.is_pressed(e)),
  eventCase(`get_device-${name}`, 'InputEvent', 'get_device', event, (e) => E.get_device(e)),
]);

const INPUT_EVENT_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'InputEvent',
  compatModule: 'lib/godot-compat/input-event',
  cases,
};

export default INPUT_EVENT_EVIDENCE;
