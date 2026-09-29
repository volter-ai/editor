/**
 * @godot-class Input
 * @role PROTOCOL
 *
 * Godot 4.7's `Input` action state, transcribed from `core/input/input.cpp`,
 * `core/input/input_map.cpp` and the `action_match` members of `core/input/input_event.cpp` at
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A singleton: its members take no receiver.
 *
 * The module owns Godot's state as module state: the InputMap (actions, deadzones, their events),
 * each action's per-device pressed/strength slots and cache, when each last changed, and the event
 * buffer. It never listens to the DOM. The window turns native events into InputEvent records and
 * hands them to `parse_input_event`, and flushes them at the start of every host frame
 * (`flush_buffered_events`, before the physics steps and the scripts' `_process`); the world loads
 * the project's `[input]` actions through `godot_input_map_load_json`.
 *
 * `is_action_just_pressed` and `_released` are the library's own edges, not frames the tree counts
 * (docs/GODOT.md §The emitted game's shape, "The SceneTree's clock"): an action records when it
 * changed, as the host frame it changed in, identified by the id the root Window's flush opens it
 * with (`godot_tree_open_frame`), and "just" is a change in the host's current frame. A change
 * made between frames (a script's `action_press` in `_ready` or a deferred call, the debug door)
 * belongs to the next frame, as Godot's next iteration sees it. A frame is open from the window's
 * flush, first in every frame, which opens it whether or not the host's clock advanced (the
 * editor's paused game draws frames without advancing it), until the task that runs it ends: R3F runs a frame's callbacks, physics steps and draw in one task, so a microtask
 * then closes it. Where Godot counts physics frames and process frames apart, one host
 * frame holds both, so:
 * - where several physics steps run in one frame, a change holds for each of them, where Godot
 *   holds it for the first;
 * - a change a script makes during a frame holds for the rest of that frame only, where Godot also
 *   holds it for the next physics step (a press in `_process` is not seen by the next
 *   `_physics_process`).
 *
 * Events are the records `input-event.ts` describes. Every event is buffered: Godot's
 * `use_accumulated_input` is on, so a mouse motion or screen drag folds into the buffered event
 * before it when they are one motion (`godot_input_event_accumulate`) while
 * `use_accumulated_input` holds. Parsing keeps Godot's polling state: the keys, physical keys and
 * key labels held, the mouse button mask, the mouse velocity track and the joypad buttons and axes
 * events set.
 *
 * Joypads are the page's Gamepad API, read when asked, as the web platform samples it
 * (`DisplayServerWeb::process_joypads`, `library_godot_input.js` `GodotInputGamepads`): a pad whose
 * `mapping` is `standard` reports buttons 6 and 7 as the trigger axes and goes through the Web
 * section's `standard` mapping (`core/input/godotcontrollerdb.txt:28`); any other pad goes through a
 * mapping `add_joy_mapping` gave its GUID, else reports its raw buttons and axes. The web platform
 * gives joypads no vibration, light or motion sensors (`Input::set_joy_features` is never called
 * there), so those members answer as Godot's web export does.
 */

import { get_device as deviceOf, godot_input_event_accumulate, type InputEventRecord } from './input-event';
import { godot_tree_open_frame } from './scene-tree';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector3, type Vector3 } from './vector3';

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
/** The change time an action never changed carries: no frame starts then. */
const NEVER = Number.NEGATIVE_INFINITY;
/** The change time of a change made between frames, until the next frame opens and takes it. */
const NEXT = Number.POSITIVE_INFINITY;

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
  /** The start of the host frame the action was last pressed in (or `NEXT`, `NEVER`). */
  pressedAt: number;
  /** The start of the host frame the action was last released in (or `NEXT`, `NEVER`). */
  releasedAt: number;
  exact: boolean;
  /** `pressed_event_id` / `released_event_id`: the event record that last pressed or released it. */
  pressedEvent: InputEventRecord | undefined;
  releasedEvent: InputEventRecord | undefined;
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
/** `keys_pressed`, `physical_keys_pressed`, `key_label_pressed` (`core/input/input.h`). */
const keysPressed = new Set<number>();
const physicalKeysPressed = new Set<number>();
const keyLabelsPressed = new Set<number>();
/** `mouse_button_mask`: `MouseButtonMask` bits (`1 << (button - 1)`). */
let mouseButtonMask = 0;
/** `joy_buttons_pressed` and `_joy_axis`, as joypad events set them, keyed `device:index`. */
const joyButtonsPressed = new Set<string>();
const joyAxes = new Map<string, number>();
/** `use_accumulated_input`, on by default (`input_devices/buffering/agile_event_flushing` aside). */
let useAccumulatedInput = true;
/** `emulate_touch_from_mouse`: `input_devices/pointing/emulate_touch_from_mouse`, off by default. */
let emulateTouchFromMouse = false;
/** `ignore_joypad_on_unfocused_application`, off by default. */
let ignoreJoypadOnUnfocused = false;
/** `gravity`, `accelerometer`, `magnetometer`, `gyroscope`: the web feeds none, a script may set them. */
const sensors = { gravity: vector3(), accelerometer: vector3(), magnetometer: vector3(), gyroscope: vector3() };
/** `joy_vibration`: what `start_joy_vibration` last asked of each device. */
const joyVibration = new Map<number, { readonly weak: number; readonly strong: number; readonly duration: number }>();
const actionStates = new Map<string, ActionState>();
const buffered: InputEventRecord[] = [];
const customCursors = new Map<number, { readonly cursor: unknown; readonly hotspot: Vector2 }>();
/** The host frame the root Window last opened (`godot_input_frame`): its id, and whether it is still running. */
const frame = { id: 0, open: false };

function newState(): ActionState {
  return {
    pressedAt: NEVER,
    releasedAt: NEVER,
    exact: true,
    pressedEvent: undefined,
    releasedEvent: undefined,
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

/**
 * `InputMap::event_get_action_status` for an event: whether it matches the action, and if so
 * whether it presses it and how strongly.
 *
 * @godot InputMap (protocol)
 * @source core/input/input_map.cpp:290
 */
export function godot_input_event_action_status(event: InputEventRecord, action: string, exact_match: boolean): { readonly pressed: boolean; readonly strength: number; readonly rawStrength: number } | undefined {
  return actionStatus(event, action, exact_match);
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

/** `InputEvent::DEVICE_ID_EMULATION` (`core/input/input_event.h:64`). */
const DEVICE_ID_EMULATION = -1;

let dispatchFunction: ((event: InputEventRecord) => void) | undefined;
/** `emulate_mouse_from_touch`: `input_devices/pointing/emulate_mouse_from_touch`, on by default (`main/main.cpp:3666`). */
let emulateMouseFromTouch = true;
/** `mouse_from_touch_index`: the touch the emulated mouse follows, or -1. */
let mouseFromTouchIndex = -1;

/**
 * Sets `event_dispatch_function`, which each parsed event reaches after the action state: the
 * display server's, calling the root window's `_window_input` (`platform/web/display_server_web.cpp:1106`).
 *
 * @godot Input (protocol)
 * @source core/input/input.cpp:1648
 */
export function godot_input_set_dispatch(dispatch: ((event: InputEventRecord) => void) | undefined, emulateMouse = true): void {
  dispatchFunction = dispatch;
  emulateMouseFromTouch = emulateMouse;
  mouseFromTouchIndex = -1;
}

/**
 * `Input::_parse_input_event_impl` (`core/input/input.cpp:801`): a screen touch or drag first
 * parses the mouse event it emulates (the first touch drives the mouse), then the event updates
 * the action state and is dispatched.
 */
function parseImpl(event: InputEventRecord, emulated = false): void {
  if (!emulated && emulateMouseFromTouch && event.type === 'screen_touch') {
    let translate = false;
    if (event.pressed) {
      if (mouseFromTouchIndex === -1) {
        translate = true;
        mouseFromTouchIndex = event.index;
      }
    } else if (event.index === mouseFromTouchIndex) {
      translate = true;
      mouseFromTouchIndex = -1;
    }
    if (translate) {
      parseImpl({ type: 'mouse_button', device: DEVICE_ID_EMULATION, position: event.position, pressed: event.pressed, canceled: event.canceled === true, button_index: 1 }, true);
    }
  }
  if (!emulated && emulateMouseFromTouch && event.type === 'screen_drag' && event.index === mouseFromTouchIndex) {
    parseImpl({ type: 'mouse_motion', device: DEVICE_ID_EMULATION, position: event.position }, true);
  }
  pollingState(event, emulated);
  // `Input::mouse_pos` (`input.cpp:858`, `:893`): where the last mouse event was.
  if (event.type === 'mouse_button' || event.type === 'mouse_motion') mousePosition = event.position;
  parseActions(event);
  dispatchFunction?.(event);
}

let mousePosition: Vector2 = vector2();

/** `Input::VelocityTrack` (`core/input/input.cpp:265`): `min_ref_frame` 0.1 s, `max_ref_frame` 3 s. */
const mouseVelocity = { lastTick: 0, velocity: vector2(), accum: [0, 0], accumT: 0 };

function nowSeconds(): number {
  return (globalThis.performance?.now() ?? Date.now()) / 1000;
}

/** `VelocityTrack::update` (`core/input/input.cpp:265`). */
function trackVelocity(dx: number, dy: number): void {
  const tick = nowSeconds();
  const deltaT = f32(tick - mouseVelocity.lastTick);
  mouseVelocity.lastTick = tick;
  if (deltaT > 3) {
    mouseVelocity.velocity = vector2();
    mouseVelocity.accum = [dx, dy];
    mouseVelocity.accumT = 0;
    return;
  }
  mouseVelocity.accum = [f32((mouseVelocity.accum[0] as number) + dx), f32((mouseVelocity.accum[1] as number) + dy)];
  mouseVelocity.accumT = f32(mouseVelocity.accumT + deltaT);
  if (mouseVelocity.accumT < 0.1) return;
  mouseVelocity.velocity = vector2(f32((mouseVelocity.accum[0] as number) / mouseVelocity.accumT), f32((mouseVelocity.accum[1] as number) / mouseVelocity.accumT));
  mouseVelocity.accum = [0, 0];
  mouseVelocity.accumT = 0;
}

/**
 * The polling part of `Input::_parse_input_event_impl` (`core/input/input.cpp:813`): held keys,
 * physical keys and labels (echoes aside), the mouse button mask, the mouse velocity, touch
 * emulated from the mouse's left button, and the joypad buttons and axes.
 */
function pollingState(event: InputEventRecord, emulated: boolean): void {
  if (event.type === 'key' && event.echo !== true) {
    const pressed = isPressed(event);
    const sets: readonly [Set<number>, number][] = [[keysPressed, event.keycode], [physicalKeysPressed, event.physical_keycode], [keyLabelsPressed, event.key_label]];
    for (const [set, code] of sets) {
      if (code === 0) continue;
      if (pressed) set.add(code);
      else set.delete(code);
    }
  }
  if (event.type === 'mouse_button' && event.button_index > 0) {
    const bit = 1 << (event.button_index - 1);
    mouseButtonMask = isPressed(event) ? mouseButtonMask | bit : mouseButtonMask & ~bit;
    if (dispatchFunction !== undefined && emulateTouchFromMouse && !emulated && event.button_index === 1) {
      dispatchFunction({ type: 'screen_touch', device: DEVICE_ID_EMULATION, index: 0, pressed: event.pressed, canceled: event.canceled === true, position: event.position });
    }
  }
  if (event.type === 'mouse_motion') {
    const relative = event.relative ?? vector2();
    trackVelocity(f32(relative.x), f32(relative.y));
    if (dispatchFunction !== undefined && emulateTouchFromMouse && !emulated && ((event.button_mask ?? 0) & 1) !== 0) {
      dispatchFunction({ type: 'screen_drag', device: DEVICE_ID_EMULATION, index: 0, position: event.position });
    }
  }
  if (event.type === 'joypad_button') {
    const key = `${deviceOf(event)}:${event.button_index}`;
    if (isPressed(event)) joyButtonsPressed.add(key);
    else joyButtonsPressed.delete(key);
  }
  if (event.type === 'joypad_motion') joyAxes.set(`${deviceOf(event)}:${event.axis}`, f32(event.axis_value));
}

/**
 * Where the last mouse event was, in the root viewport's coordinates (`Input::get_mouse_position`
 * as the root viewport reads it, `viewport.cpp:1183`).
 *
 * @godot Input (protocol)
 * @source core/input/input.cpp:858
 */
export function godot_input_mouse_position(): Vector2 {
  return mousePosition;
}

/** The action part of `Input::_parse_input_event_impl` (`core/input/input.cpp:1005`). */
function parseActions(event: InputEventRecord): void {
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
      state.pressedAt = changedAt();
      state.pressedEvent = event;
    }
    if (!state.cache.pressed && wasPressed) {
      state.releasedAt = changedAt();
      state.releasedEvent = event;
    }
  }
}

/**
 * `OS::prefer_meta_over_ctrl` on the web (`core/os/os.cpp:59`): the `web_macos` or `web_ios`
 * feature, read from the page's user agent (`library_godot_os.js:307`).
 */
function preferMetaOverCtrl(): boolean {
  const agent = (globalThis as { readonly navigator?: { readonly userAgent?: string } }).navigator?.userAgent ?? '';
  return ['Mac', 'iPhone', 'iPad', 'iPod'].some((name) => agent.includes(name));
}

/** The event as it was built: its Command-or-Control autoremap resolved (`input_event.cpp:160`). */
function autoremapped(event: InputEventRecord): InputEventRecord {
  if ((event.type === 'key' || event.type === 'mouse_button' || event.type === 'mouse_motion') && event.command_or_control_autoremap === true) {
    const meta = preferMetaOverCtrl();
    return { ...event, ctrl_pressed: !meta, meta_pressed: meta };
  }
  return event;
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
    for (const authored of entry.events) {
      const event = autoremapped(authored);
      const present = action.inputs.some((mapped) => {
        const device = deviceOf(mapped);
        return (device === ALL_DEVICES || device === deviceOf(event)) && actionMatch(mapped, event, true, action.deadzone) !== undefined;
      });
      if (!present) action.inputs.push(normalizedDevice(event));
    }
  }
}

/**
 * Whether the map has the action.
 *
 * @godot InputMap (protocol)
 * @source core/input/input_map.cpp:164
 */
export function godot_input_map_has(name: string): boolean {
  return inputMap.has(String(name));
}

/**
 * Adds an action without events (`InputMap::add_action`); an action already there changes nothing.
 *
 * @godot InputMap (protocol)
 * @source core/input/input_map.cpp:115
 */
export function godot_input_map_add(name: string, deadzone: number): void {
  if (inputMap.has(String(name))) return;
  inputMap.set(String(name), { deadzone: f32(deadzone), inputs: [] });
}

/**
 * Adds an event to an action unless the action already matches it exactly
 * (`InputMap::action_add_event`, `input_map.cpp:199`), a keyboard or mouse event of device 0 made
 * the keyboard's or the mouse's.
 *
 * @godot InputMap (protocol)
 * @source core/input/input_map.cpp:199
 */
export function godot_input_map_add_event(name: string, event: InputEventRecord): void {
  const action = inputMap.get(String(name));
  if (action === undefined) return;
  const present = action.inputs.some((mapped) => {
    const device = deviceOf(mapped);
    return (device === ALL_DEVICES || device === deviceOf(event)) && actionMatch(mapped, event, true, action.deadzone) !== undefined;
  });
  if (!present) action.inputs.push(normalizedDevice(autoremapped(event)));
}

/**
 * Removes an action, or its events.
 *
 * @godot InputMap (protocol)
 * @source core/input/input_map.cpp:124
 */
export function godot_input_map_erase(name: string, eventsOnly: boolean): void {
  if (eventsOnly) inputMap.get(String(name))?.inputs.splice(0);
  else inputMap.delete(String(name));
}

/**
 * The map's actions, in the order they were added.
 *
 * @godot InputMap (protocol)
 * @source core/input/input_map.cpp:130
 */
export function godot_input_map_actions(): string[] {
  return [...inputMap.keys()];
}

/** An input map action as the project's input map file holds it: a position is `[x, y]`. */
export interface GodotInputMapActionJson {
  readonly name: string;
  readonly deadzone?: number;
  readonly events: readonly Readonly<Record<string, unknown>>[];
}

/**
 * Loads the InputMap from the project's input map file (`src/project/input-map.json`), each event
 * record's `[x, y]` position as a Vector2.
 *
 * @godot InputMap (protocol)
 * @source core/input/input_map.cpp:325
 */
export function godot_input_map_load_json(actions: readonly GodotInputMapActionJson[]): void {
  godot_input_map_load(
    actions.map((action) => ({
      name: action.name,
      ...(action.deadzone === undefined ? {} : { deadzone: action.deadzone }),
      events: action.events.map((event) => {
        const position = event['position'];
        return (Array.isArray(position) ? { ...event, position: vector2(position[0] as number, position[1] as number) } : event) as unknown as InputEventRecord;
      }),
    })),
  );
}

/**
 * Opens the host's frame, as the root Window's frame hook does at each frame's start with the
 * host's own frame identity and delta (`godot_tree_open_frame`). The changes made between frames
 * take it as their time, the debug door's taps pressed in an earlier frame are released in it
 * (`godot_input_debug`), and it stays open until the task running it ends (a microtask closes
 * it). A flush at any other time (a page event's) opens nothing: what it applies is the next
 * frame's.
 *
 * @godot Input (protocol)
 * @source platform/web/os_web.cpp:87
 */
export function godot_input_frame(host: { readonly id: number; readonly delta: number }): void {
  godot_tree_open_frame(host);
  const id = host.id;
  frame.id = id;
  frame.open = true;
  queueMicrotask(() => {
    if (frame.id === id) frame.open = false;
  });
  for (const state of actionStates.values()) {
    if (state.pressedAt === NEXT) state.pressedAt = id;
    if (state.releasedAt === NEXT) state.releasedAt = id;
  }
  for (const [action, state] of [...debugTaps]) {
    if (state.pressedAt === id) continue;
    debugTaps.delete(action);
    action_release(action);
  }
}

/** When a change made now happened: the running frame's start, or `NEXT` between frames. */
function changedAt(): number {
  return frame.open ? frame.id : NEXT;
}

/** The debug door's taps: action → its state, released in the first frame after the one it was pressed in. */
const debugTaps = new Map<string, ActionState>();
/** The actions the debug door holds pressed, released by its `clear`. */
const debugHeld = new Set<string>();

/** The session input door's value types (`native-entry-surface.ts`). */
export type GodotDebugInputValueType = 'digital' | 'scalar';

/**
 * The session's input door over Godot's own Input (`native-debug-module.ts`'s `debug.input`): the
 * InputMap's actions, read live (`digital` for an action any key or button drives, `scalar` only
 * for one only joypad axes drive); a digital `true` presses at strength 1, as a key press does;
 * `set` presses the action at the value's strength (`true` is 1) or releases it (a
 * false or non-positive value), as `Input.action_press` / `action_release`; `clear` releases every
 * action it holds; `tap` presses the action and releases it at the start of the frame after the one
 * that took the press, so the press holds for one whole frame, its physics steps and its process.
 *
 * @godot Input (protocol)
 * @source core/input/input.cpp:1410
 */
export function godot_input_debug(): {
  readonly actions: () => Readonly<Record<string, GodotDebugInputValueType>>;
  readonly set: (action: string, value: boolean | number | { readonly x: number; readonly y: number }) => void;
  readonly clear: () => void;
  readonly tap: (action: string) => void;
} {
  return {
    actions: () =>
      Object.fromEntries(
        [...inputMap].map(([name, action]) => [name, action.inputs.length > 0 && action.inputs.every((event) => event.type === 'joypad_motion') ? 'scalar' : 'digital'] as const),
      ),
    set: (action, value) => {
      const strength = typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'number' ? value : 0;
      if (strength > 0) {
        action_press(action, strength);
        debugHeld.add(action);
      } else {
        action_release(action);
        debugHeld.delete(action);
      }
    },
    clear: () => {
      for (const action of [...debugHeld, ...debugTaps.keys()]) action_release(action);
      debugHeld.clear();
      debugTaps.clear();
    },
    tap: (action) => {
      action_press(action);
      if (inputMap.has(action)) debugTaps.set(action, stateOf(action));
    },
  };
}

/**
 * Buffers the event, folded into the buffered event before it when they are one motion
 * (`use_accumulated_input`, on by default); it reaches the action state at the next
 * `flush_buffered_events`.
 *
 * @godot Input.parse_input_event
 * @source core/input/input.cpp:1519
 */
export function parse_input_event(event: InputEventRecord): void {
  const last = buffered[buffered.length - 1];
  const folded = last === undefined || !useAccumulatedInput ? undefined : godot_input_event_accumulate(last, event);
  if (folded === undefined) buffered.push(event);
  else buffered[buffered.length - 1] = folded;
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
 * Whether the action was pressed in the host's current frame (the module's header), in its
 * physics steps and its process alike.
 *
 * @godot Input.is_action_just_pressed
 * @source core/input/input.cpp:419
 */
export function is_action_just_pressed(action: string, exact_match = false): boolean {
  if (!inputMap.has(action)) return false;
  const state = actionStates.get(action);
  if (state === undefined) return false;
  if (exact_match && !state.exact) return false;
  // Between frames the current frame is the next one, as Godot's process frame count is until its
  // iteration ends (`main.cpp:5115`): a press flushed from a page event reads as just pressed there.
  return state.pressedAt === changedAt();
}

/**
 * Whether the action was released in the host's current frame (the module's header).
 *
 * @godot Input.is_action_just_released
 * @source core/input/input.cpp:476
 */
export function is_action_just_released(action: string, exact_match = false): boolean {
  if (!inputMap.has(action)) return false;
  const state = actionStates.get(action);
  if (state === undefined) return false;
  if (exact_match && !state.exact) return false;
  return state.releasedAt === changedAt();
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
 * Presses the action from script, a change as any other: in the current frame, or the next one when
 * pressed between frames.
 *
 * @godot Input.action_press
 * @source core/input/input.cpp:1410
 */
export function action_press(action: string, strength = 1.0): void {
  if (!inputMap.has(action)) return;
  const state = stateOf(action);
  if (!state.cache.pressed) state.pressedAt = changedAt();
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
  state.releasedAt = changedAt();
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

/**
 * `Input::set_mouse_mode` (`core/input/input.cpp:101`): the web display server's mouse mode
 * (`DisplayServerWeb::mouse_set_mode`, below).
 *
 * @godot Input.set_mouse_mode
 * @source core/input/input.cpp:101
 */
export function set_mouse_mode(mode: number): void {
  setDisplayMouseMode(mode);
}

/**
 * @godot Input.get_mouse_mode
 * @source core/input/input.cpp:106
 */
export function get_mouse_mode(): number {
  return displayMouseMode();
}

/** The canvas the page draws the game in, which pointer lock locks to (`GodotConfig.canvas`). */
let displayCanvas: HTMLCanvasElement | null = null;
/** `GodotDisplayCursor.visible` (`library_godot_display.js`). */
let cursorVisible = true;

/**
 * Records the game's canvas (`GodotConfig.canvas`), as the window attaches its input to it.
 *
 * @godot Input (protocol)
 * @source platform/web/js/libs/library_godot_display.js:214
 */
export function godot_input_attach_canvas(canvas: HTMLCanvasElement | null): void {
  const previous = lastCanvas;
  displayCanvas = canvas;
  cursorVisible = true;
  if (canvas === null || canvas === previous) return;
  lastCanvas = canvas;
  // A new page's input starts clear: the frame identities are its renderer's own count, which a
  // new renderer starts again, so nothing stamped by an earlier one may meet them. The same canvas
  // attached again (the world hidden and shown by a Suspense boundary) keeps what is held.
  actionStates.clear();
  keysPressed.clear();
  physicalKeysPressed.clear();
  keyLabelsPressed.clear();
  mouseButtonMask = 0;
  joyButtonsPressed.clear();
  joyAxes.clear();
  debugTaps.clear();
  debugHeld.clear();
  buffered.length = 0;
  frame.id = 0;
  frame.open = false;
  godot_tree_open_frame({ id: 0, delta: 0 });
}

/** The canvas the page's input was last attached from. */
let lastCanvas: HTMLCanvasElement | null = null;

/** `MouseMode` (`display_server_enums.h`): visible, hidden, captured, confined, confined hidden. */
const MOUSE_MODE_VISIBLE = 0;
const MOUSE_MODE_HIDDEN = 1;
const MOUSE_MODE_CAPTURED = 2;
const MOUSE_MODE_MAX = 5;

/**
 * `DisplayServerWeb::mouse_get_mode` (`display_server_web.cpp:596`): hidden when the cursor is
 * hidden, captured while the pointer is locked to the canvas, else visible. Without a page (the
 * headless server) it is visible.
 */
function displayMouseMode(): number {
  if (displayCanvas === null) return MOUSE_MODE_VISIBLE;
  if (!cursorVisible) return MOUSE_MODE_HIDDEN;
  return displayCanvas.ownerDocument.pointerLockElement === displayCanvas ? MOUSE_MODE_CAPTURED : MOUSE_MODE_VISIBLE;
}

/**
 * `DisplayServerWeb::mouse_set_mode` / `_mouse_update_mode` (`display_server_web.cpp:555`): the
 * cursor shown or hidden (`cursor: none`) and the pointer locked to the canvas or released; the
 * confined modes fail (not supported on the web). Without a page nothing happens.
 */
function setDisplayMouseMode(mode: number): void {
  if (!Number.isInteger(mode) || mode < 0 || mode >= MOUSE_MODE_MAX) return;
  if (displayCanvas === null || mode > MOUSE_MODE_CAPTURED) return;
  if (mode === displayMouseMode()) return;
  const canvas = displayCanvas;
  const visible = mode !== MOUSE_MODE_HIDDEN;
  if (visible !== cursorVisible) {
    cursorVisible = visible;
    canvas.style.cursor = visible ? cursorCss() : 'none';
  }
  if (mode === MOUSE_MODE_CAPTURED) void canvas.requestPointerLock?.();
  else if (canvas.ownerDocument.pointerLockElement === canvas) canvas.ownerDocument.exitPointerLock();
}

// --- Cursor shapes (`DisplayServerWeb::cursor_set_shape`, `display_server_web.cpp:506`).

/** `DisplayServerWeb::godot2dom_cursor` (`platform/web/display_server_web.cpp:354`), by `CursorShape`. */
const DOM_CURSORS = [
  'default', 'text', 'pointer', 'crosshair', 'wait', 'progress', 'grab', 'grabbing', 'no-drop',
  'ns-resize', 'ew-resize', 'nesw-resize', 'nwse-resize', 'move', 'row-resize', 'col-resize', 'help',
] as const;

/** `Input::default_shape` and the display server's `cursor_shape`. */
let defaultCursorShape = 0;
let currentCursorShape = 0;

/** The CSS cursor of the current shape (the arrow is the page's own default). */
function cursorCss(): string {
  return currentCursorShape === 0 ? '' : DOM_CURSORS[currentCursorShape] ?? '';
}

/**
 * The shape the pointer shows where no Control asks for its own. The viewport applies it at the
 * next mouse motion (`Viewport::_gui_input_event`); here the display server's cursor takes it at
 * once (`DisplayServerWeb::cursor_set_shape`, a CSS cursor on the canvas while the cursor shows).
 *
 * @godot Input.set_default_cursor_shape
 * @source core/input/input.cpp:1489
 */
export function set_default_cursor_shape(shape = 0): void {
  if (!Number.isInteger(shape) || shape < 0 || shape >= CURSOR_MAX) return;
  if (defaultCursorShape === shape) return;
  defaultCursorShape = shape;
  currentCursorShape = shape;
  if (displayCanvas !== null && cursorVisible) displayCanvas.style.cursor = cursorCss();
}

/**
 * @godot Input.get_current_cursor_shape
 * @source core/input/input.cpp:1505
 */
export function get_current_cursor_shape(): number {
  return currentCursorShape;
}

/**
 * Moving the pointer is something a page cannot do: the web display server does not implement
 * `warp_mouse` (DisplayServer's default does nothing), so it does nothing.
 *
 * @godot Input.warp_mouse
 * @source core/input/input.cpp:1381
 */
export function warp_mouse(position: Vector2): void {
  void position;
}

// --- Keys and mouse buttons.

/**
 * Anything held: a key, a joypad button, a mouse button, or any action.
 *
 * @godot Input.is_anything_pressed
 * @source core/input/input.cpp:312
 */
export function is_anything_pressed(): boolean {
  if (keysPressed.size > 0 || joyButtonsPressed.size > 0 || mouseButtonMask !== 0) return true;
  for (let device = 0; device < gamepads().length; device += 1) {
    for (let button = 0; button < JOY_BUTTON_NAMES.length; button += 1) if (padButton(device, button)) return true;
  }
  for (const state of actionStates.values()) if (state.cache.pressed) return true;
  return false;
}

/**
 * @godot Input.is_key_pressed
 * @source core/input/input.cpp:342
 */
export function is_key_pressed(keycode: number): boolean {
  return keysPressed.has(keycode);
}

/**
 * @godot Input.is_physical_key_pressed
 * @source core/input/input.cpp:352
 */
export function is_physical_key_pressed(keycode: number): boolean {
  return physicalKeysPressed.has(keycode);
}

/**
 * @godot Input.is_key_label_pressed
 * @source core/input/input.cpp:362
 */
export function is_key_label_pressed(keycode: number): boolean {
  return keyLabelsPressed.has(keycode);
}

/**
 * @godot Input.is_mouse_button_pressed
 * @source core/input/input.cpp:372
 */
export function is_mouse_button_pressed(button: number): boolean {
  if (button <= 0) return false;
  return (mouseButtonMask & (1 << (button - 1))) !== 0;
}

/**
 * @godot Input.get_mouse_button_mask
 * @source core/input/input.cpp:1377
 */
export function get_mouse_button_mask(): number {
  return mouseButtonMask;
}

/**
 * The mouse's velocity over its recent motions (`VelocityTrack`, updated with no motion first).
 *
 * @godot Input.get_last_mouse_velocity
 * @source core/input/input.cpp:1367
 */
export function get_last_mouse_velocity(): Vector2 {
  trackVelocity(0, 0);
  return mouseVelocity.velocity;
}

/**
 * The same velocity: the page reports motion in the canvas's pixels only, so the screen motion is
 * the motion.
 *
 * @godot Input.get_last_mouse_screen_velocity
 * @source core/input/input.cpp:1372
 */
export function get_last_mouse_screen_velocity(): Vector2 {
  trackVelocity(0, 0);
  return mouseVelocity.velocity;
}

/**
 * Whether the action was just pressed, and by this event (the record that pressed it).
 *
 * @godot Input.is_action_just_pressed_by_event
 * @source core/input/input.cpp:445
 */
export function is_action_just_pressed_by_event(action: string, event: InputEventRecord, exact_match = false): boolean {
  if (!inputMap.has(action)) return false;
  const state = actionStates.get(action);
  if (state === undefined || (exact_match && !state.exact)) return false;
  if (state.pressedEvent !== event) return false;
  return state.pressedAt === changedAt();
}

/**
 * Whether the action was just released, and by this event (the record that released it).
 *
 * @godot Input.is_action_just_released_by_event
 * @source core/input/input.cpp:502
 */
export function is_action_just_released_by_event(action: string, event: InputEventRecord, exact_match = false): boolean {
  if (!inputMap.has(action)) return false;
  const state = actionStates.get(action);
  if (state === undefined || (exact_match && !state.exact)) return false;
  if (state.releasedEvent !== event) return false;
  return state.releasedAt === changedAt();
}

/**
 * @godot Input.set_use_accumulated_input
 * @source core/input/input.cpp:1592
 */
export function set_use_accumulated_input(enable: boolean): void {
  useAccumulatedInput = Boolean(enable);
}

/**
 * @godot Input.is_using_accumulated_input
 * @source core/input/input.cpp:1596
 */
export function is_using_accumulated_input(): boolean {
  return useAccumulatedInput;
}

/**
 * @godot Input.set_emulate_mouse_from_touch
 * @source core/input/input.cpp:1477
 */
export function set_emulate_mouse_from_touch(enable: boolean): void {
  emulateMouseFromTouch = Boolean(enable);
}

/**
 * @godot Input.is_emulating_mouse_from_touch
 * @source core/input/input.cpp:1481
 */
export function is_emulating_mouse_from_touch(): boolean {
  return emulateMouseFromTouch;
}

/**
 * The left mouse button and its drags are also delivered as touches (device
 * `DEVICE_ID_EMULATION`, index 0).
 *
 * @godot Input.set_emulate_touch_from_mouse
 * @source core/input/input.cpp:1446
 */
export function set_emulate_touch_from_mouse(enable: boolean): void {
  emulateTouchFromMouse = Boolean(enable);
}

/**
 * @godot Input.is_emulating_touch_from_mouse
 * @source core/input/input.cpp:1450
 */
export function is_emulating_touch_from_mouse(): boolean {
  return emulateTouchFromMouse;
}

// --- Device sensors: the web platform feeds none, so they read what a script set (zero until then).

/**
 * @godot Input.get_gravity
 * @source core/input/input.cpp:753
 */
export function get_gravity(): Vector3 {
  return sensors.gravity;
}

/**
 * @godot Input.get_accelerometer
 * @source core/input/input.cpp:765
 */
export function get_accelerometer(): Vector3 {
  return sensors.accelerometer;
}

/**
 * @godot Input.get_magnetometer
 * @source core/input/input.cpp:777
 */
export function get_magnetometer(): Vector3 {
  return sensors.magnetometer;
}

/**
 * @godot Input.get_gyroscope
 * @source core/input/input.cpp:789
 */
export function get_gyroscope(): Vector3 {
  return sensors.gyroscope;
}

/**
 * @godot Input.set_gravity
 * @source core/input/input.cpp:1335
 */
export function set_gravity(value: Vector3): void {
  sensors.gravity = value;
}

/**
 * @godot Input.set_accelerometer
 * @source core/input/input.cpp:1341
 */
export function set_accelerometer(value: Vector3): void {
  sensors.accelerometer = value;
}

/**
 * @godot Input.set_magnetometer
 * @source core/input/input.cpp:1347
 */
export function set_magnetometer(value: Vector3): void {
  sensors.magnetometer = value;
}

/**
 * @godot Input.set_gyroscope
 * @source core/input/input.cpp:1353
 */
export function set_gyroscope(value: Vector3): void {
  sensors.gyroscope = value;
}

/**
 * The page's vibration (`OS_Web::vibrate_handheld` → `navigator.vibrate`, `os_web.cpp:206`); the
 * amplitude is not the web's to set.
 *
 * @godot Input.vibrate_handheld
 * @source core/input/input.cpp:1320
 */
export function vibrate_handheld(duration_ms = 500, amplitude = -1.0): void {
  void amplitude;
  const navigator = (globalThis as { readonly navigator?: { readonly vibrate?: (ms: number) => boolean } }).navigator;
  navigator?.vibrate?.(duration_ms);
}

// --- Joypads: the page's Gamepad API.

/** `_joy_buttons` (`core/input/input.cpp:49`): SDL output names by `JoyButton`. */
const JOY_BUTTON_NAMES = [
  'a', 'b', 'x', 'y', 'back', 'guide', 'start', 'leftstick', 'rightstick', 'leftshoulder', 'rightshoulder',
  'dpup', 'dpdown', 'dpleft', 'dpright', 'misc1', 'paddle1', 'paddle2', 'paddle3', 'paddle4', 'touchpad',
  'misc2', 'misc3', 'misc4', 'misc5', 'misc6',
] as const;
/** `_joy_axes` (`core/input/input.cpp:78`): SDL output names by `JoyAxis`. */
const JOY_AXIS_NAMES = ['leftx', 'lefty', 'rightx', 'righty', 'lefttrigger', 'righttrigger'] as const;
const TRIGGER_LEFT = 4;
const TRIGGER_RIGHT = 5;

/** `JoyAxisRange`: full, positive half, negative half. */
type Range = 'full' | '+' | '-';

interface JoyBinding {
  readonly output: { readonly button: number } | { readonly axis: number; readonly range: Range };
  readonly input: { readonly button: number } | { readonly axis: number; readonly range: Range; readonly invert: boolean };
}

interface JoyMapping {
  readonly uid: string;
  readonly name: string;
  readonly bindings: readonly JoyBinding[];
}

/** `Input::parse_mapping` (`core/input/input.cpp:2066`); hat inputs are left out (the web reports none). */
function parseMapping(text: string): JoyMapping | undefined {
  const entry = text.split(',');
  if (entry.length < 2) return undefined;
  const bindings: JoyBinding[] = [];
  for (const part of entry.slice(2)) {
    if (part === '') continue;
    let output = (part.split(':')[0] ?? '').replaceAll(' ', '');
    let input = (part.split(':')[1] ?? '').replaceAll(' ', '');
    if (output.length < 1 || input.length < 2 || output === 'platform' || output === 'hint') continue;
    let outputRange: Range = 'full';
    if (output[0] === '+' || output[0] === '-') {
      if (output.length < 2) continue;
      outputRange = output[0];
      output = output.slice(1);
    }
    let inputRange: Range = 'full';
    if (input[0] === '+' || input[0] === '-') {
      inputRange = input[0];
      input = input.slice(1);
    }
    const invert = input.endsWith('~');
    if (invert) input = input.slice(0, -1);
    const button = (JOY_BUTTON_NAMES as readonly string[]).indexOf(output);
    const axis = (JOY_AXIS_NAMES as readonly string[]).indexOf(output);
    if (button === -1 && axis === -1) continue;
    const out = button !== -1 ? { button } : { axis, range: outputRange };
    const index = Number.parseInt(input.slice(1), 10) || 0;
    if (input[0] === 'b') bindings.push({ output: out, input: { button: index } });
    else if (input[0] === 'a') bindings.push({ output: out, input: { axis: index, range: inputRange, invert } });
  }
  return { uid: entry[0] as string, name: entry[1] as string, bindings };
}

/** `map_db`: the Web section's `standard` mapping (`core/input/godotcontrollerdb.txt:28`), then the added ones. */
const mapDb: JoyMapping[] = [
  parseMapping(
    'standard,Standard Gamepad Mapping,leftx:a0,lefty:a1,rightx:a2,righty:a3,lefttrigger:+a4,righttrigger:+a5,a:b0,b:b1,x:b2,y:b3,leftshoulder:b4,rightshoulder:b5,back:b8,start:b9,leftstick:b10,rightstick:b11,dpup:b12,dpdown:b13,dpleft:b14,dpright:b15,guide:b16,leftstick:b10,rightstick:b11,platform:Web,',
  ) as JoyMapping,
];

interface PadSample {
  readonly pad: Gamepad;
  readonly buttons: readonly number[];
  readonly axes: readonly number[];
}

/** `GodotInputGamepads.get_pads` (`library_godot_input.js:181`): empty where the page may not read them. */
function gamepads(): readonly (Gamepad | null)[] {
  try {
    return (globalThis as { readonly navigator?: { readonly getGamepads?: () => (Gamepad | null)[] } }).navigator?.getGamepads?.() ?? [];
  } catch {
    return [];
  }
}

/** Whether joypads are ignored now: the option is on and the page does not have focus. */
function ignoringJoypads(): boolean {
  if (!ignoreJoypadOnUnfocused) return false;
  const document = (globalThis as { readonly document?: { readonly hasFocus?: () => boolean } }).document;
  return document?.hasFocus?.() === false;
}

/**
 * A pad's sample as the web platform hands it to Input (`DisplayServerWeb::process_joypads`,
 * `display_server_web.cpp:974`): a standard pad's buttons 6 and 7 are the trigger axes 4 and 5.
 */
function sampleOf(device: number): PadSample | undefined {
  const pad = gamepads()[device];
  if (pad === null || pad === undefined || !pad.connected || ignoringJoypads()) return undefined;
  const standard = pad.mapping === 'standard';
  const buttons: number[] = [];
  const axes = pad.axes.slice(0, 10).map((value) => f32(value));
  pad.buttons.slice(0, 16).forEach((button, index) => {
    if (standard && index === 6) axes[TRIGGER_LEFT] = f32(button.value);
    else if (standard && index === 7) axes[TRIGGER_RIGHT] = f32(button.value);
    else buttons[index] = f32(button.value);
  });
  // A standard pad's guide button is its 17th; the platform samples 16, so Godot never sees it.
  return { pad, buttons, axes };
}

/** `GodotInputGamepads.get_guid` (`library_godot_input.js:262`). */
function guidOf(pad: Gamepad): string {
  if (pad.mapping) return pad.mapping;
  const agent = (globalThis as { readonly navigator?: { readonly userAgent?: string } }).navigator?.userAgent ?? '';
  const os = agent.includes('Android') ? 'Android' : agent.includes('Linux') ? 'Linux' : agent.includes('iPhone') ? 'iOS' : agent.includes('Macintosh') ? 'MacOSX' : agent.includes('Windows') ? 'Windows' : 'Unknown';
  const match = /vendor: ([0-9a-f]{4}) product: ([0-9a-f]{4})/i.exec(pad.id) ?? /^([0-9a-f]+)-([0-9a-f]+)-/i.exec(pad.id);
  if (match === null) return `${os}Unknown`;
  return os + (match[1] as string).padStart(4, '0') + (match[2] as string).padStart(4, '0');
}

/** The mapping a pad's GUID finds in `map_db` (`Input::joy_connection_changed`, `input.cpp:716`), if any. */
function mappingOf(pad: Gamepad): JoyMapping | undefined {
  const uid = guidOf(pad);
  return mapDb.find((mapping) => mapping.uid === uid);
}

/**
 * The value an input binding reads from a sample, shifted as `_get_mapped_axis_event` shifts it
 * (`core/input/input.cpp:1927`); undefined where the input's half-axis does not hold the value.
 */
function bindingInput(binding: JoyBinding, sample: PadSample): { readonly value: number; readonly shifted: number; readonly range: Range } | undefined {
  const input = binding.input;
  if ('button' in input) {
    const pressed = (sample.buttons[input.button] ?? 0) !== 0;
    return { value: pressed ? 1 : 0, shifted: pressed ? 1 : 0, range: '+' };
  }
  let value = sample.axes[input.axis] ?? 0;
  if (input.invert) value = -value;
  if (input.range === '+' && value < 0) return undefined;
  if (input.range === '-' && value >= 0) return undefined;
  const shifted = input.range === '+' ? value : input.range === '-' ? value + 1 : (value + 1) / 2;
  return { value, shifted, range: input.range };
}

/** A pad's button through its mapping (`_get_mapped_button_event` / `_get_mapped_axis_event`), or raw. */
function padButton(device: number, button: number): boolean {
  const sample = sampleOf(device);
  if (sample === undefined) return false;
  const mapping = mappingOf(sample.pad);
  if (mapping === undefined) return (sample.buttons[button] ?? 0) !== 0;
  return mapping.bindings.some((binding) => {
    if (!('button' in binding.output) || binding.output.button !== button) return false;
    const read = bindingInput(binding, sample);
    if (read === undefined) return false;
    if ('button' in binding.input) return read.value !== 0;
    const value = read.range === '+' ? read.shifted : read.range === '-' ? 1 - read.shifted : read.shifted * 2 - 1;
    return value > 0.5;
  });
}

/** A pad's axis through its mapping, or raw; a full-range axis bound to a trigger reads 0 to 1 (`input.cpp:1745`). */
function padAxis(device: number, axis: number): number | undefined {
  const sample = sampleOf(device);
  if (sample === undefined) return undefined;
  const mapping = mappingOf(sample.pad);
  if (mapping === undefined) return sample.axes[axis] ?? 0;
  let result = 0;
  for (const binding of mapping.bindings) {
    if (!('axis' in binding.output) || binding.output.axis !== axis) continue;
    const read = bindingInput(binding, sample);
    if (read === undefined) continue;
    const range = binding.output.range;
    let value: number;
    if ('button' in binding.input) value = read.value === 0 ? 0 : range === '-' ? -1 : 1;
    else if (range === read.range) value = read.value;
    else value = range === '+' ? read.shifted : range === '-' ? read.shifted - 1 : read.shifted * 2 - 1;
    if (range === 'full' && !('button' in binding.input) && (axis === TRIGGER_LEFT || axis === TRIGGER_RIGHT)) value = 0.5 + value / 2;
    if (Math.abs(value) > Math.abs(result)) result = f32(value);
  }
  return result;
}

/**
 * Held on the page's pad (through its mapping) or by a joypad button event.
 *
 * @godot Input.is_joy_button_pressed
 * @source core/input/input.cpp:394
 */
export function is_joy_button_pressed(device: number, button: number): boolean {
  return joyButtonsPressed.has(`${device}:${button}`) || padButton(device, button);
}

/**
 * The page's pad's axis (through its mapping), or what a joypad motion event last set.
 *
 * @godot Input.get_joy_axis
 * @source core/input/input.cpp:601
 */
export function get_joy_axis(device: number, axis: number): number {
  return padAxis(device, axis) ?? joyAxes.get(`${device}:${axis}`) ?? 0;
}

/**
 * The pad's name: its mapping's name when its GUID has one (`_set_joypad_mapping`,
 * `input.cpp:2251`), else the Gamepad API's `id`; an unknown device has none.
 *
 * @godot Input.get_joy_name
 * @source core/input/input.cpp:616
 */
export function get_joy_name(device: number): string {
  const pad = gamepads()[device];
  if (pad === null || pad === undefined || !pad.connected) return '';
  return mappingOf(pad)?.name ?? pad.id;
}

/**
 * The pad's GUID as the web platform makes it (its `mapping`, else the OS and vendor/product ids).
 *
 * @godot Input.get_joy_guid
 * @source core/input/input.cpp:2276
 */
export function get_joy_guid(device: number): string {
  const pad = gamepads()[device];
  if (pad === null || pad === undefined || !pad.connected) return '';
  return guidOf(pad);
}

/**
 * The web platform connects a pad with no extra information, so the dictionary is empty.
 *
 * @godot Input.get_joy_info
 * @source core/input/input.cpp:2281
 */
export function get_joy_info(device: number): Map<unknown, unknown> {
  void device;
  return new Map();
}

/**
 * Whether the pad's GUID has a mapping (the Web `standard` mapping or one `add_joy_mapping` gave).
 *
 * @godot Input.is_joy_known
 * @source core/input/input.cpp:2272
 */
export function is_joy_known(device: number): boolean {
  const pad = gamepads()[device];
  return pad !== null && pad !== undefined && pad.connected && mappingOf(pad) !== undefined;
}

/**
 * The page's connected pads, by index.
 *
 * @godot Input.get_connected_joypads
 * @source core/input/input.cpp:2291
 */
export function get_connected_joypads(): number[] {
  const out: number[] = [];
  gamepads().forEach((pad, index) => {
    if (pad !== null && pad.connected) out.push(index);
  });
  return out;
}

/**
 * Adds an SDL mapping; pads with its GUID read through it from then on (`update_existing` or not:
 * the page's pads are read through the latest mapping when asked).
 *
 * @godot Input.add_joy_mapping
 * @source core/input/input.cpp:2167
 */
export function add_joy_mapping(mapping: string, update_existing = false): void {
  void update_existing;
  const parsed = parseMapping(mapping);
  if (parsed !== undefined) mapDb.unshift(parsed);
}

/**
 * Removes every mapping with that GUID.
 *
 * @godot Input.remove_joy_mapping
 * @source core/input/input.cpp:2180
 */
export function remove_joy_mapping(guid: string): void {
  for (let i = mapDb.length - 1; i >= 0; i -= 1) if (mapDb[i]?.uid === guid) mapDb.splice(i, 1);
}

/**
 * No device ids are ignored on the web (the list comes from `SDL_GAMECONTROLLER_IGNORE_DEVICES`,
 * which a page has no environment for).
 *
 * @godot Input.should_ignore_device
 * @source core/input/input.cpp:2286
 */
export function should_ignore_device(vendor_id: number, product_id: number): boolean {
  void vendor_id;
  void product_id;
  return false;
}

/**
 * While on, pads read nothing when the page does not have focus.
 *
 * @godot Input.set_ignore_joypad_on_unfocused_application
 * @source core/input/input.cpp:1324
 */
export function set_ignore_joypad_on_unfocused_application(enable: boolean): void {
  ignoreJoypadOnUnfocused = Boolean(enable);
}

/**
 * @godot Input.is_ignoring_joypad_on_unfocused_application
 * @source core/input/input.cpp:1331
 */
export function is_ignoring_joypad_on_unfocused_application(): boolean {
  return ignoreJoypadOnUnfocused;
}

/**
 * Records the request, as Godot does; the web platform drives no rumble (no joypad features there).
 *
 * @godot Input.start_joy_vibration
 * @source core/input/input.cpp:1292
 */
export function start_joy_vibration(device: number, weak_magnitude: number, strong_magnitude: number, duration = 0): void {
  if (ignoringJoypads()) return;
  const weak = f32(weak_magnitude);
  const strong = f32(strong_magnitude);
  if (weak < 0 || weak > 1 || strong < 0 || strong > 1) return;
  joyVibration.set(device, { weak, strong, duration: f32(duration) });
}

/**
 * @godot Input.stop_joy_vibration
 * @source core/input/input.cpp:1310
 */
export function stop_joy_vibration(device: number): void {
  joyVibration.set(device, { weak: 0, strong: 0, duration: 0 });
}

/**
 * @godot Input.get_joy_vibration_strength
 * @source core/input/input.cpp:621
 */
export function get_joy_vibration_strength(device: number): Vector2 {
  const vibration = joyVibration.get(device);
  return vibration === undefined ? vector2() : vector2(vibration.weak, vibration.strong);
}

/**
 * @godot Input.get_joy_vibration_duration
 * @source core/input/input.cpp:637
 */
export function get_joy_vibration_duration(device: number): number {
  return joyVibration.get(device)?.duration ?? 0;
}

/**
 * Zero: no web pad has vibration (`has_vibration` is never set on the web).
 *
 * @godot Input.get_joy_vibration_remaining_duration
 * @source core/input/input.cpp:645
 */
export function get_joy_vibration_remaining_duration(device: number): number {
  void device;
  return 0;
}

/**
 * @godot Input.is_joy_vibrating
 * @source core/input/input.cpp:662
 */
export function is_joy_vibrating(device: number): boolean {
  return get_joy_vibration_remaining_duration(device) > 0;
}

/**
 * @godot Input.has_joy_vibration
 * @source core/input/input.cpp:666
 */
export function has_joy_vibration(device: number): boolean {
  void device;
  return false;
}

/**
 * No web pad has a light, so it does nothing.
 *
 * @godot Input.set_joy_light
 * @source core/input/input.cpp:1067
 */
export function set_joy_light(device: number, color: unknown): void {
  void device;
  void color;
}

/**
 * @godot Input.has_joy_light
 * @source core/input/input.cpp:1082
 */
export function has_joy_light(device: number): boolean {
  void device;
  return false;
}

/**
 * No web pad reports motion sensors (`joy_motion` stays empty), so it reads `Vector3()`.
 *
 * @godot Input.get_joy_accelerometer
 * @source core/input/input.cpp:1087
 */
export function get_joy_accelerometer(device: number): Vector3 {
  void device;
  return vector3();
}

/**
 * @godot Input.get_joy_gravity
 * @source core/input/input.cpp:1110
 */
export function get_joy_gravity(device: number): Vector3 {
  void device;
  return vector3();
}

/**
 * @godot Input.get_joy_gyroscope
 * @source core/input/input.cpp:1129
 */
export function get_joy_gyroscope(device: number): Vector3 {
  void device;
  return vector3();
}

/**
 * @godot Input.get_joy_motion_sensors_rate
 * @source core/input/input.cpp:1173
 */
export function get_joy_motion_sensors_rate(device: number): number {
  void device;
  return 0;
}

/**
 * Without motion sensors it does nothing.
 *
 * @godot Input.set_joy_motion_sensors_enabled
 * @source core/input/input.cpp:1148
 */
export function set_joy_motion_sensors_enabled(device: number, enable: boolean): void {
  void device;
  void enable;
}

/**
 * @godot Input.is_joy_motion_sensors_enabled
 * @source core/input/input.cpp:1162
 */
export function is_joy_motion_sensors_enabled(device: number): boolean {
  void device;
  return false;
}

/**
 * @godot Input.has_joy_motion_sensors
 * @source core/input/input.cpp:1168
 */
export function has_joy_motion_sensors(device: number): boolean {
  void device;
  return false;
}

/**
 * Without motion sensors it does nothing.
 *
 * @godot Input.start_joy_motion_sensors_calibration
 * @source core/input/input.cpp:1182
 */
export function start_joy_motion_sensors_calibration(device: number): void {
  void device;
}

/**
 * Without motion sensors it does nothing.
 *
 * @godot Input.stop_joy_motion_sensors_calibration
 * @source core/input/input.cpp:1199
 */
export function stop_joy_motion_sensors_calibration(device: number): void {
  void device;
}

/**
 * Without motion sensors it does nothing.
 *
 * @godot Input.clear_joy_motion_sensors_calibration
 * @source core/input/input.cpp:1215
 */
export function clear_joy_motion_sensors_calibration(device: number): void {
  void device;
}

/**
 * Without motion sensors the calibration is an empty dictionary.
 *
 * @godot Input.get_joy_motion_sensors_calibration
 * @source core/input/input.cpp:1228
 */
export function get_joy_motion_sensors_calibration(device: number): Map<unknown, unknown> {
  void device;
  return new Map();
}

/**
 * Without motion sensors it does nothing.
 *
 * @godot Input.set_joy_motion_sensors_calibration
 * @source core/input/input.cpp:1248
 */
export function set_joy_motion_sensors_calibration(device: number, calibration_info: Map<unknown, unknown>): void {
  void device;
  void calibration_info;
}

/**
 * @godot Input.is_joy_motion_sensors_calibrated
 * @source core/input/input.cpp:1273
 */
export function is_joy_motion_sensors_calibrated(device: number): boolean {
  void device;
  return false;
}

/**
 * @godot Input.is_joy_motion_sensors_calibrating
 * @source core/input/input.cpp:1264
 */
export function is_joy_motion_sensors_calibrating(device: number): boolean {
  void device;
  return false;
}
