import type { InputEventRecord } from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type ActionSpec, type Query, type Step, timeline, vec } from './input-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, actions: readonly ActionSpec[], steps: readonly Step[]): void {
  const built = timeline(actions, steps);
  cases.push({ id, symbol: { kind: 'singleton-member', owner: 'Input', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const KEY_A = 65;
const KEY_D = 68;
const KEY_W = 87;
const KEY_S = 83;
const key = (keycode: number, pressed: boolean, extra: Partial<Extract<InputEventRecord, { type: 'key' }>> = {}): InputEventRecord => ({
  type: 'key',
  keycode,
  physical_keycode: 0,
  key_label: 0,
  pressed,
  device: 16,
  ...extra,
});
const mapKey = (keycode: number, extra: Partial<Extract<InputEventRecord, { type: 'key' }>> = {}): InputEventRecord => ({
  type: 'key',
  keycode,
  physical_keycode: 0,
  key_label: 0,
  pressed: false,
  ...extra,
});
const stick = (axis: number, value: number, device = 0): InputEventRecord => ({ type: 'joypad_motion', axis, axis_value: value, device });
const button = (index: number, pressed: boolean, device = 0): InputEventRecord => ({ type: 'joypad_button', button_index: index, pressed, device });

const read = (...query: Query): Step => ({ read: query });
const PHYS: Step = { await: 'physics' };
const PROC: Step = { await: 'process' };
const STATE = (action: string): Step[] => [
  read('is_action_pressed', action),
  read('is_action_just_pressed', action),
  read('is_action_just_released', action),
  read('get_action_strength', action),
];

const JUMP: ActionSpec = { name: 'jump', events: [mapKey(KEY_W)] };

// A key press and release across physics and process frames.
add('key-press-timeline', 'is_action_just_pressed', [JUMP], [
  ...STATE('jump'),
  { parse: key(KEY_W, true) },
  ...STATE('jump'),
  PHYS,
  ...STATE('jump'),
  PROC,
  ...STATE('jump'),
  PHYS,
  ...STATE('jump'),
  PROC,
  ...STATE('jump'),
  { parse: key(KEY_W, false) },
  PROC,
  ...STATE('jump'),
  PHYS,
  ...STATE('jump'),
  PROC,
  ...STATE('jump'),
]);
add('key-release-physics-first', 'is_action_just_released', [JUMP], [
  { parse: key(KEY_W, true) },
  PHYS,
  { parse: key(KEY_W, false) },
  PHYS,
  ...STATE('jump'),
  PROC,
  ...STATE('jump'),
]);
add('key-press-flushed-mid-frame', 'flush_buffered_events', [JUMP], [
  { parse: key(KEY_W, true) },
  { flush: true },
  ...STATE('jump'),
  PHYS,
  ...STATE('jump'),
]);
add('key-press-release-same-frame', 'is_action_pressed', [JUMP], [
  { parse: key(KEY_W, true) },
  { parse: key(KEY_W, false) },
  PROC,
  ...STATE('jump'),
  PHYS,
  ...STATE('jump'),
]);
add('key-device-zero-does-not-match', 'parse_input_event', [JUMP], [
  { parse: key(KEY_W, true, { device: 0 }) },
  PROC,
  ...STATE('jump'),
]);
add('key-default-device', 'parse_input_event', [JUMP], [
  { parse: { type: 'key', keycode: KEY_W, physical_keycode: 0, key_label: 0, pressed: true } },
  PROC,
  ...STATE('jump'),
]);
add('key-echo', 'parse_input_event', [JUMP], [{ parse: key(KEY_W, true, { echo: true }) }, PROC, ...STATE('jump')]);
add('key-modifiers', 'is_action_pressed', [
  { name: 'save', events: [mapKey(KEY_S, { ctrl_pressed: true })] },
  { name: 'down', events: [mapKey(KEY_S)] },
], [
  { parse: key(KEY_S, true, { ctrl_pressed: true }) },
  PROC,
  read('is_action_pressed', 'save'),
  read('is_action_pressed', 'save', true),
  read('is_action_pressed', 'down'),
  read('is_action_pressed', 'down', true),
  read('is_action_just_pressed', 'down', true),
  read('get_action_strength', 'down', true),
  read('get_action_raw_strength', 'down', true),
  { parse: key(KEY_S, false) },
  PROC,
  read('is_action_pressed', 'save'),
  read('is_action_pressed', 'down'),
]);
add('physical-and-label-keys', 'is_action_pressed', [
  { name: 'phys', events: [mapKey(0, { physical_keycode: KEY_A })] },
  { name: 'label', events: [mapKey(0, { key_label: KEY_D })] },
], [
  { parse: key(0, true, { physical_keycode: KEY_A, key_label: KEY_D }) },
  PROC,
  read('is_action_pressed', 'phys'),
  read('is_action_pressed', 'label'),
]);

// action_press / action_release.
for (const strength of [1, 0.35, 0, -2, 7]) {
  add(`action_press-${String(strength)}`, 'action_press', [JUMP], [
    { press: 'jump', strength },
    ...STATE('jump'),
    read('get_action_raw_strength', 'jump'),
    PHYS,
    ...STATE('jump'),
    PROC,
    ...STATE('jump'),
  ]);
}
add('action_release', 'action_release', [JUMP], [
  { press: 'jump' },
  PROC,
  { release: 'jump' },
  ...STATE('jump'),
  PHYS,
  ...STATE('jump'),
  PROC,
  ...STATE('jump'),
]);
add('action_press-then-key-release', 'action_press', [JUMP], [
  { press: 'jump', strength: 0.5 },
  { parse: key(KEY_W, true) },
  PROC,
  ...STATE('jump'),
  { parse: key(KEY_W, false) },
  PROC,
  ...STATE('jump'),
]);
add('action_release-unknown', 'action_release', [JUMP], [{ release: 'missing' }, { press: 'missing' }, read('is_action_pressed', 'missing')]);
add('input-event-action', 'parse_input_event', [JUMP], [
  { parse: { type: 'action', action: 'jump', pressed: true, strength: 0.4 } },
  PROC,
  ...STATE('jump'),
  { parse: { type: 'action', action: 'jump', pressed: false } },
  PROC,
  ...STATE('jump'),
]);

// Joypad strength and deadzones.
const MOVE = (deadzone: number): ActionSpec[] => [
  { name: 'left', deadzone, events: [stick(0, -1, -1), mapKey(KEY_A)] },
  { name: 'right', deadzone, events: [stick(0, 1, -1), mapKey(KEY_D)] },
  { name: 'up', deadzone, events: [stick(1, -1, -1), mapKey(KEY_W)] },
  { name: 'down', deadzone, events: [stick(1, 1, -1), mapKey(KEY_S)] },
];
for (const deadzone of [0.2, 0.5, 0, 1]) {
  for (const value of [0, 0.1, 0.2, 0.2000001, 0.35, 0.5, 0.75, 1, -0.3, -0.5, -1, 1.5]) {
    add(`joypad-strength-${String(deadzone)}-${String(value)}`, 'get_action_strength', MOVE(deadzone), [
      { parse: stick(0, value, 3) },
      PROC,
      ...STATE('right'),
      ...STATE('left'),
      read('get_action_raw_strength', 'right'),
      read('get_action_raw_strength', 'left'),
      read('get_axis', 'left', 'right'),
    ]);
  }
}
add('joypad-two-devices', 'get_action_raw_strength', MOVE(0.2), [
  { parse: stick(0, 0.6, 0) },
  { parse: stick(0, 0.9, 1) },
  PROC,
  read('get_action_strength', 'right'),
  { parse: stick(0, 0, 1) },
  PROC,
  read('get_action_strength', 'right'),
  read('is_action_pressed', 'right'),
]);
add('joypad-button', 'is_action_pressed', [{ name: 'fire', events: [button(0, false, -1)] }], [
  { parse: button(0, true, 2) },
  PROC,
  ...STATE('fire'),
  { parse: button(0, false, 2) },
  PHYS,
  ...STATE('fire'),
]);
add('get_axis-keys', 'get_axis', MOVE(0.2), [
  { parse: key(KEY_A, true) },
  PROC,
  read('get_axis', 'left', 'right'),
  { parse: key(KEY_D, true) },
  PROC,
  read('get_axis', 'left', 'right'),
  { press: 'left', strength: 0.3 },
  read('get_axis', 'left', 'right'),
]);

// get_vector: circular deadzone, length limiting, overlapping actions.
for (const deadzone of [0.2, 0.5]) {
  for (const [x, y] of [
    [0, 0], [0.1, 0.1], [0.2, 0], [0.3, 0], [0.5, 0.5], [0.7, 0.7], [1, 1], [-0.6, 0.3], [0.141, 0.141], [0.9, -0.2],
  ] as const) {
    add(`get_vector-${String(deadzone)}-${String(x)}-${String(y)}`, 'get_vector', MOVE(deadzone), [
      { parse: stick(0, x, 0) },
      { parse: stick(1, y, 0) },
      PROC,
      read('get_vector', 'left', 'right', 'up', 'down'),
      read('get_vector', 'left', 'right', 'up', 'down', 0.1),
      read('get_vector', 'left', 'right', 'up', 'down', 0),
      read('get_vector', 'left', 'right', 'up', 'down', 0.9),
    ]);
  }
}
add('get_vector-overlapping', 'get_vector', [
  { name: 'left', deadzone: 0.3, events: [mapKey(KEY_A), stick(0, -1, -1)] },
  { name: 'right', deadzone: 0.1, events: [mapKey(KEY_D), stick(0, 1, -1)] },
  { name: 'up', deadzone: 0.6, events: [mapKey(KEY_W), mapKey(KEY_A)] },
  { name: 'down', deadzone: 0.2, events: [mapKey(KEY_S)] },
], [
  { parse: key(KEY_A, true) },
  PROC,
  read('get_vector', 'left', 'right', 'up', 'down'),
  { parse: key(KEY_D, true) },
  { parse: stick(0, 0.4, 0) },
  PROC,
  read('get_vector', 'left', 'right', 'up', 'down'),
  read('get_vector', 'left', 'left', 'up', 'up'),
]);

// set_custom_mouse_cursor leaves action state alone; an invalid shape fails.
for (const shape of [0, 16, 17, -1]) {
  add(`set_custom_mouse_cursor-${String(shape)}`, 'set_custom_mouse_cursor', [JUMP], [{ cursor: shape }, ...STATE('jump')]);
}

// A mouse button action.
add('mouse-button', 'is_action_pressed', [{ name: 'click', events: [{ type: 'mouse_button', button_index: 1, pressed: false, position: vec(0, 0) }] }], [
  { parse: { type: 'mouse_button', button_index: 1, pressed: true, position: vec(10, 20), device: 32 } },
  PROC,
  ...STATE('click'),
  { parse: { type: 'mouse_button', button_index: 2, pressed: true, position: vec(10, 20), device: 32 } },
  { parse: { type: 'mouse_button', button_index: 1, pressed: false, position: vec(10, 20), device: 32 } },
  PROC,
  ...STATE('click'),
]);

const INPUT_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Input',
  compatModule: 'lib/godot-compat/input',
  cases,
};

export default INPUT_EVIDENCE;
