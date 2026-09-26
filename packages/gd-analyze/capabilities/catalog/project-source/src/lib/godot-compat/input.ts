/**
 * @godot-class Input
 * @role PROTOCOL
 *
 * Godot 4.7's `Input` action state, transcribed from `core/input/input.cpp`,
 * `core/input/input_map.cpp` and the `action_match` members of `core/input/input_event.cpp` at
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A singleton: its members take no receiver.
 *
 * The module owns Godot's state as module state: the InputMap (actions, deadzones, their events),
 * each action's per-device pressed/strength slots and cache, the just-pressed/released frame
 * stamps, the event buffer, and the Engine frame counters the stamps compare against. It never
 * listens to the DOM. The generated composition site turns native events into InputEvent records
 * and hands them to `parse_input_event`, calls `flush_buffered_events` at the start of every main
 * loop iteration (as `OS_MacOS::run` does, `platform/macos/os_macos.mm:1254`), stamps each physics
 * step and process frame through `godot_input_frame`, and loads the project's `[input]` actions
 * through `godot_input_map_load`.
 *
 * Events are the records `input-event.ts` describes. Every event is buffered: Godot's
 * `use_accumulated_input` is on, and only mouse motion and screen drags accumulate, which no action
 * reads, so accumulation is not transcribed. `is_action_just_pressed_by_event` and the key/mouse
 * polling members are not transcribed.
 */

import { get_device as deviceOf, type InputEventRecord } from './input-event';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;
/** `InputMap::ALL_DEVICES` (`core/input/input_map.h:47`). */
const ALL_DEVICES = -1;
/** `InputEvent::DEVICE_ID_KEYBOARD`, `DEVICE_ID_MOUSE` (`core/input/input_event.h:66`). */
const DEVICE_ID_KEYBOARD = 16;
const DEVICE_ID_MOUSE = 32;
/** `InputMap::DEFAULT_DEADZONE` (`core/input/input_map.h:55`). */
const DEFAULT_DEADZONE = f32(0.2);
/** `KeyModifierMask` (`core/os/keyboard.h:256`). */
const SHIFT = 1 << 25;
const ALT = 1 << 26;
const META = 1 << 27;
const CTRL = 1 << 28;
/** `Input::CURSOR_MAX` (`core/input/input.h`): the 17 `CursorShape` values. */
const CURSOR_MAX = 17;
/** `UINT64_MAX`, the stamp an action never pressed carries (`core/input/input.h:134`). */
const NEVER = Number.POSITIVE_INFINITY;

interface Action {
  readonly deadzone: number;
  readonly inputs: InputEventRecord[];
}

interface DeviceState {
  readonly pressed: boolean[];
  readonly strength: number[];
  readonly rawStrength: number[];
}

interface ActionState {
  pressedPhysicsFrame: number;
  pressedProcessFrame: number;
  releasedPhysicsFrame: number;
  releasedProcessFrame: number;
  exact: boolean;
  apiPressed: boolean;
  apiStrength: number;
  deviceStates: Map<number, DeviceState>;
  cache: { pressed: boolean; strength: number; rawStrength: number };
}

/** One project action as `translate/data` reads it from `project.godot`'s `[input]` section. */
export interface GodotInputMapAction {
  readonly name: string;
  readonly deadzone?: number;
  readonly events: readonly InputEventRecord[];
}

const inputMap = new Map<string, Action>();
const actionStates = new Map<string, ActionState>();
const buffered: InputEventRecord[] = [];
const customCursors = new Map<number, { readonly cursor: unknown; readonly hotspot: Vector2 }>();
const engine = { physicsFrames: 0, processFrames: 0, inPhysics: false };

function newState(): ActionState {
  return {
    pressedPhysicsFrame: NEVER,
    pressedProcessFrame: NEVER,
    releasedPhysicsFrame: NEVER,
    releasedProcessFrame: NEVER,
    exact: true,
    apiPressed: false,
    apiStrength: 0,
    deviceStates: new Map(),
    cache: { pressed: false, strength: 0, rawStrength: 0 },
  };
}

/** `action_states[p_action]`: find or default-construct. */
function stateOf(action: string): ActionState {
  let state = actionStates.get(action);
  if (state === undefined) {
    state = newState();
    actionStates.set(action, state);
  }
  return state;
}

/** `MAX` (`core/typedefs.h:147`). */
function max(a: number, b: number): number {
  return a > b ? a : b;
}

/** `CLAMP` (`core/typedefs.h:152`). */
function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** `InputEvent::is_pressed` (`core/input/input_event.cpp:82`). */
function isPressed(event: InputEventRecord): boolean {
  return 'pressed' in event && event.pressed === true && !('canceled' in event && event.canceled === true);
}

/** `InputEventWithModifiers::get_modifiers_mask` (`core/input/input_event.cpp:238`). */
function modifiersMask(event: InputEventRecord): number {
  const modifiers = event as { ctrl_pressed?: boolean; shift_pressed?: boolean; alt_pressed?: boolean; meta_pressed?: boolean };
  return (
    (modifiers.ctrl_pressed === true ? CTRL : 0) |
    (modifiers.shift_pressed === true ? SHIFT : 0) |
    (modifiers.alt_pressed === true ? ALT : 0) |
    (modifiers.meta_pressed === true ? META : 0)
  );
}

interface Match {
  readonly pressed: boolean;
  readonly strength: number;
  readonly rawStrength: number;
}

/**
 * `action_match` of the InputMap's event `mapped` against the incoming `event`: key
 * (`core/input/input_event.cpp:564`), mouse button (`:780`), joypad motion (`:1133`), joypad
 * button (`:1250`), action (`:1636`); `undefined` when they do not match.
 */
function actionMatch(mapped: InputEventRecord, event: InputEventRecord, exactMatch: boolean, deadzone: number): Match | undefined {
  if (mapped.type !== event.type) return undefined;
  const pressedMatch = (): Match => {
    const pressed = isPressed(event);
    const strength = pressed ? 1 : 0;
    return { pressed, strength, rawStrength: strength };
  };
  switch (mapped.type) {
    case 'key': {
      const key = event as typeof mapped;
      let match: boolean;
      if (mapped.keycode === 0 && mapped.physical_keycode === 0 && mapped.key_label !== 0) {
        match = mapped.key_label === key.key_label;
      } else if (mapped.keycode !== 0) {
        match = mapped.keycode === key.keycode;
      } else if (mapped.physical_keycode !== 0) {
        match = mapped.physical_keycode === key.physical_keycode;
        if ((mapped.location ?? 0) !== 0) match = match && (mapped.location ?? 0) === (key.location ?? 0);
      } else {
        match = false;
      }
      const actionMask = modifiersMask(mapped);
      const keyMask = modifiersMask(key);
      if (isPressed(key)) match = match && (actionMask & keyMask) === actionMask;
      if (exactMatch) match = match && actionMask === keyMask;
      return match ? pressedMatch() : undefined;
    }
    case 'mouse_button': {
      const button = event as typeof mapped;
      let match = mapped.button_index === button.button_index;
      const actionMask = modifiersMask(mapped);
      const buttonMask = modifiersMask(button);
      if (isPressed(button)) match = match && (actionMask & buttonMask) === actionMask;
      if (exactMatch) match = match && actionMask === buttonMask;
      return match ? pressedMatch() : undefined;
    }
    case 'joypad_button': {
      const button = event as typeof mapped;
      return mapped.button_index === button.button_index ? pressedMatch() : undefined;
    }
    case 'joypad_motion': {
      const motion = event as typeof mapped;
      let match = mapped.axis === motion.axis;
      if (exactMatch) match = match && mapped.axis_value < 0 === motion.axis_value < 0;
      if (!match) return undefined;
      const absValue = Math.abs(f32(motion.axis_value));
      const sameDirection = mapped.axis_value < 0 === motion.axis_value < 0 || motion.axis_value === 0;
      const pressed = sameDirection && absValue >= deadzone;
      let strength = 0;
      if (pressed) {
        strength = deadzone === 1 ? 1 : clamp(f32(f32(absValue - deadzone) / f32(1 - deadzone)), 0, 1);
      }
      return { pressed, strength, rawStrength: sameDirection ? absValue : 0 };
    }
    case 'action': {
      const action = event as typeof mapped;
      return mapped.action === action.action ? pressedMatch() : undefined;
    }
    default:
      return undefined;
  }
}

interface Status extends Match {
  readonly index: number;
}

/**
 * `InputMap::event_get_action_status` (`core/input/input_map.cpp:290`): an InputEventAction names
 * its action directly; any other event is found among the action's events (`_find_event`, `:147`).
 */
function actionStatus(event: InputEventRecord, actionName: string, exactMatch: boolean): Status | undefined {
  const action = inputMap.get(actionName);
  if (action === undefined) return undefined;
  if (event.type === 'action') {
    const pressed = isPressed(event);
    const strength = pressed ? f32(event.strength ?? 1) : 0;
    if (event.action !== actionName) return undefined;
    const index = (event.event_index ?? -1) >= 0 ? (event.event_index as number) : action.inputs.length;
    return { pressed, strength, rawStrength: strength, index };
  }
  for (const [index, mapped] of action.inputs.entries()) {
    const device = deviceOf(mapped);
    if (device !== ALL_DEVICES && device !== deviceOf(event)) continue;
    const match = actionMatch(mapped, event, exactMatch, action.deadzone);
    if (match !== undefined) return { ...match, index };
  }
  return undefined;
}

/** `Input::_update_action_cache` (`core/input/input.cpp:1846`). */
function updateActionCache(actionName: string, state: ActionState): void {
  state.cache.pressed = false;
  state.cache.strength = 0;
  state.cache.rawStrength = 0;
  const maxEvent = (inputMap.get(actionName)?.inputs.length ?? 0) + 1;
  for (const device of state.deviceStates.values()) {
    for (let i = 0; i < maxEvent; i += 1) {
      state.cache.pressed = state.cache.pressed || device.pressed[i] === true;
      state.cache.strength = max(state.cache.strength, device.strength[i] ?? 0);
      state.cache.rawStrength = max(state.cache.rawStrength, device.rawStrength[i] ?? 0);
    }
  }
  if (state.apiPressed) {
    state.cache.pressed = true;
    state.cache.strength = max(state.cache.strength, state.apiStrength);
    state.cache.rawStrength = max(state.cache.rawStrength, state.apiStrength);
  }
}

/** The action part of `Input::_parse_input_event_impl` (`core/input/input.cpp:1005`). */
function parseImpl(event: InputEventRecord): void {
  for (const actionName of inputMap.keys()) {
    const status = actionStatus(event, actionName, false);
    if (status === undefined) continue;
    const deviceId = deviceOf(event);
    const pressed = status.pressed && true;
    const state = stateOf(actionName);
    let device = state.deviceStates.get(deviceId);
    if (device === undefined) {
      device = { pressed: [], strength: [], rawStrength: [] };
      state.deviceStates.set(deviceId, device);
    }
    device.pressed[status.index] = pressed;
    device.strength[status.index] = status.strength;
    device.rawStrength[status.index] = status.rawStrength;
    if (!pressed) {
      state.apiPressed = false;
      state.apiStrength = 0;
    }
    state.exact = actionStatus(event, actionName, true) !== undefined;
    const wasPressed = state.cache.pressed;
    updateActionCache(actionName, state);
    if (state.cache.pressed && !wasPressed) {
      state.pressedPhysicsFrame = engine.physicsFrames + 1;
      state.pressedProcessFrame = engine.processFrames;
    }
    if (!state.cache.pressed && wasPressed) {
      state.releasedPhysicsFrame = engine.physicsFrames + 1;
      state.releasedProcessFrame = engine.processFrames;
    }
  }
}

/** `InputMap::action_add_event`'s device normalization (`core/input/input_map.cpp:211`). */
function normalizedDevice(event: InputEventRecord): InputEventRecord {
  if (deviceOf(event) !== 0) return event;
  if (event.type === 'key') return { ...event, device: DEVICE_ID_KEYBOARD };
  if (event.type === 'mouse_button' || event.type === 'mouse_motion') return { ...event, device: DEVICE_ID_MOUSE };
  return event;
}

/**
 * `InputMap::load_from_project_settings` (`core/input/input_map.cpp:325`) over the project's
 * actions as data: the map is cleared, then each action is added with its deadzone (default 0.2)
 * and its events through `action_add_event`, which skips an event the action already matches
 * exactly and normalizes a keyboard or mouse event's device 0. Input's action states persist.
 *
 * @godot InputMap (protocol)
 * @source core/input/input_map.cpp:325
 */
export function godot_input_map_load(actions: readonly GodotInputMapAction[]): void {
  inputMap.clear();
  for (const entry of actions) {
    const action: Action = { deadzone: f32(entry.deadzone ?? DEFAULT_DEADZONE), inputs: [] };
    inputMap.set(entry.name, action);
    for (const event of entry.events) {
      const present = action.inputs.some((mapped) => {
        const device = deviceOf(mapped);
        return (device === ALL_DEVICES || device === deviceOf(event)) && actionMatch(mapped, event, true, action.deadzone) !== undefined;
      });
      if (!present) action.inputs.push(normalizedDevice(event));
    }
  }
}

/**
 * The Engine frame counters the just-pressed stamps compare against: `Main::iteration` increments
 * `physics_frames` and sets `in_physics` around each physics step (`main/main.cpp:4973`) and
 * increments `process_frames` after the process step (`main/main.cpp:5115`).
 *
 * @godot Input (protocol)
 * @source main/main.cpp:4973
 */
export function godot_input_frame(physicsFrames: number, processFrames: number, inPhysics: boolean): void {
  engine.physicsFrames = physicsFrames;
  engine.processFrames = processFrames;
  engine.inPhysics = inPhysics;
}

/**
 * Buffers the event; it reaches the action state at the next `flush_buffered_events`.
 *
 * @godot Input.parse_input_event
 * @source core/input/input.cpp:1519
 */
export function parse_input_event(event: InputEventRecord): void {
  buffered.push(event);
}

/**
 * @godot Input.flush_buffered_events
 * @source core/input/input.cpp:1568
 */
export function flush_buffered_events(): void {
  while (buffered.length > 0) parseImpl(buffered.shift() as InputEventRecord);
}

/**
 * @godot Input.is_action_pressed
 * @source core/input/input.cpp:404
 */
export function is_action_pressed(action: string, exact_match = false): boolean {
  if (!inputMap.has(action)) return false;
  const state = actionStates.get(action);
  if (state === undefined) return false;
  return state.cache.pressed && (exact_match ? state.exact : true);
}

/**
 * The press stamp against the current physics frame inside a physics step, else the current process
 * frame (`legacy_just_pressed_behavior` is off by default, `core/input/input.cpp:2364`).
 *
 * @godot Input.is_action_just_pressed
 * @source core/input/input.cpp:419
 */
export function is_action_just_pressed(action: string, exact_match = false): boolean {
  if (!inputMap.has(action)) return false;
  const state = actionStates.get(action);
  if (state === undefined) return false;
  if (exact_match && !state.exact) return false;
  return engine.inPhysics
    ? state.pressedPhysicsFrame === engine.physicsFrames
    : state.pressedProcessFrame === engine.processFrames;
}

/**
 * @godot Input.is_action_just_released
 * @source core/input/input.cpp:476
 */
export function is_action_just_released(action: string, exact_match = false): boolean {
  if (!inputMap.has(action)) return false;
  const state = actionStates.get(action);
  if (state === undefined) return false;
  if (exact_match && !state.exact) return false;
  return engine.inPhysics
    ? state.releasedPhysicsFrame === engine.physicsFrames
    : state.releasedProcessFrame === engine.processFrames;
}

/**
 * @godot Input.get_action_strength
 * @source core/input/input.cpp:533
 */
export function get_action_strength(action: string, exact_match = false): number {
  if (!inputMap.has(action)) return 0;
  const state = actionStates.get(action);
  if (state === undefined) return 0;
  if (exact_match && !state.exact) return 0;
  return state.cache.strength;
}

/**
 * @godot Input.get_action_raw_strength
 * @source core/input/input.cpp:552
 */
export function get_action_raw_strength(action: string, exact_match = false): number {
  if (!inputMap.has(action)) return 0;
  const state = actionStates.get(action);
  if (state === undefined) return 0;
  if (exact_match && !state.exact) return 0;
  return state.cache.rawStrength;
}

/**
 * @godot Input.get_axis
 * @source core/input/input.cpp:571
 */
export function get_axis(negative_action: string, positive_action: string): number {
  return f32(get_action_strength(positive_action) - get_action_strength(negative_action));
}

/**
 * Raw strengths as a vector; a negative deadzone is the average of the four actions' deadzones;
 * then circular deadzone and length limiting.
 *
 * @godot Input.get_vector
 * @source core/input/input.cpp:575
 */
export function get_vector(
  negative_x: string,
  positive_x: string,
  negative_y: string,
  positive_y: string,
  deadzone = -1.0,
): Vector2 {
  const x = f32(get_action_raw_strength(positive_x) - get_action_raw_strength(negative_x));
  const y = f32(get_action_raw_strength(positive_y) - get_action_raw_strength(negative_y));
  let zone = f32(deadzone);
  if (zone < 0) {
    const dz = (name: string): number => inputMap.get(name)?.deadzone ?? 0;
    zone = f32(0.25 * f32(f32(f32(dz(positive_x) + dz(negative_x)) + dz(positive_y)) + dz(negative_y)));
  }
  const length = f32(Math.sqrt(f32(f32(x * x) + f32(y * y))));
  if (length <= zone) return vector2();
  if (length > 1) return vector2(f32(x / length), f32(y / length));
  const scale = f32(f32(f32(length - zone) / f32(1 - zone)) / length);
  return vector2(f32(x * scale), f32(y * scale));
}

/**
 * Presses the action from script: the earliest reaction is the next physics step.
 *
 * @godot Input.action_press
 * @source core/input/input.cpp:1410
 */
export function action_press(action: string, strength = 1.0): void {
  if (!inputMap.has(action)) return;
  const state = stateOf(action);
  if (!state.cache.pressed) {
    state.pressedPhysicsFrame = engine.physicsFrames + 1;
    state.pressedProcessFrame = engine.processFrames;
  }
  state.exact = true;
  state.apiPressed = true;
  state.apiStrength = clamp(f32(strength), 0, 1);
  updateActionCache(action, state);
}

/**
 * Releases the action and every device's state for it.
 *
 * @godot Input.action_release
 * @source core/input/input.cpp:1428
 */
export function action_release(action: string): void {
  if (!inputMap.has(action)) return;
  const state = stateOf(action);
  state.cache.pressed = false;
  state.cache.strength = 0;
  state.cache.rawStrength = 0;
  state.releasedPhysicsFrame = engine.physicsFrames + 1;
  state.releasedProcessFrame = engine.processFrames;
  state.deviceStates.clear();
  state.exact = true;
  state.apiPressed = false;
  state.apiStrength = 0;
}

/**
 * `ERR_FAIL_INDEX(p_shape, CURSOR_MAX)`, then the display server's custom cursor for that shape,
 * which the host applies; the Variant defaults are `shape = CURSOR_ARROW`, `hotspot = Vector2()`.
 *
 * @godot Input.set_custom_mouse_cursor
 * @source core/input/input.cpp:1509
 */
export function set_custom_mouse_cursor(cursor: unknown, shape = 0, hotspot: Vector2 = vector2()): void {
  if (!Number.isInteger(shape) || shape < 0 || shape >= CURSOR_MAX) return;
  customCursors.set(shape, { cursor, hotspot });
}
