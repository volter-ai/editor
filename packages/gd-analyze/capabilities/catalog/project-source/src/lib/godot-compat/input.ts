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
 * before it when they are one motion (`godot_input_event_accumulate`). `is_action_just_pressed_by_event` and the key/mouse
 * polling members are not transcribed.
 */

import { get_device as deviceOf, godot_input_event_accumulate, type InputEventRecord } from './input-event';
import { godot_tree_open_frame } from './scene-tree';
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
/** The host frame the root Window last opened (`godot_input_frame`): its id, and whether it is still running. */
const frame = { id: 0, open: false };

function newState(): ActionState {
  return {
    pressedAt: NEVER,
    releasedAt: NEVER,
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
  parseActions(event);
  dispatchFunction?.(event);
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
    if (state.cache.pressed && !wasPressed) state.pressedAt = changedAt();
    if (!state.cache.pressed && wasPressed) state.releasedAt = changedAt();
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
  const folded = last === undefined ? undefined : godot_input_event_accumulate(last, event);
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
  displayCanvas = canvas;
  cursorVisible = true;
  // A new page's input starts clear: the frame identities are its renderer's own count, which a
  // new renderer starts again, so nothing stamped by an earlier one may meet them.
  actionStates.clear();
  debugTaps.clear();
  buffered.length = 0;
  frame.id = 0;
  frame.open = false;
}

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
    canvas.style.cursor = visible ? '' : 'none';
  }
  if (mode === MOUSE_MODE_CAPTURED) void canvas.requestPointerLock?.();
  else if (canvas.ownerDocument.pointerLockElement === canvas) canvas.ownerDocument.exitPointerLock();
}
