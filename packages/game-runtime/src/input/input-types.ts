/**
 * A single binding for an action. `mouse_move` feeds a `'pointerDelta'` action
 * with the raw mouse delta (or a `'vector2'` one, radial-deadzoned);
 * `gamepad_axis_pair` feeds a `'vector2'` action with a coupled stick reading;
 * `touch_button`/`touch_stick` read a named on-screen control the game's own
 * touch UI writes, and `test_*` bindings a caller-injected value.
 */
export type InputBinding =
  | { type: 'key'; code: string }
  | { type: 'mouse_button'; button: number }
  | { type: 'mouse_move'; deadzone?: number }
  | { type: 'gamepad_button'; button: number }
  | { type: 'gamepad_axis'; axis: number; direction: 'positive' | 'negative'; deadzone?: number }
  | { type: 'gamepad_axis_pair'; xAxis: number; yAxis: number; deadzone?: number }
  // F1 (spec §12) — the "injected test input" backend named in F2's acceptance criteria,
  // the typed value model's testable source. Each is keyed by a caller-chosen `sourceId`
  // (not a real device index).
  | { type: 'test_axis'; sourceId: string; deadzone?: number }
  | { type: 'test_vector2'; sourceId: string; deadzone?: number }
  | { type: 'test_pointer_delta'; sourceId: string }
  | { type: 'test_pointer_position'; sourceId: string }
  // F2 (spec §12) — touch/virtual controls. `touch_button` is digital (edge-
  // tracked just like `mouse_button`); `touch_stick` is a `'vector2'`-valueType
  // analog control (radial-deadzoned like a gamepad stick).
  | { type: 'touch_button'; sourceId: string }
  | { type: 'touch_stick'; sourceId: string; deadzone?: number };

/**
 * The value shape an action carries (F1, spec §12 "Define Typed Action Values"):
 *  - `'digital'` — boolean, with pressed/justPressed/justReleased edges. The default when an action omits `valueType` — every action authored before F1
 *    is a digital action, so this stays backward compatible.
 *  - `'scalar'` — a single float axis, e.g. a throttle or a single
 *    thumbstick axis.
 *  - `'vector2'` — a {x,y} axis pair, e.g. movement/look.
 *  - `'pointerDelta'` — a {x,y} per-frame movement delta,
 *    summed across contributing sources, cleared every frame (mirrors the existing
 *    mouseDeltaX/Y accumulator's per-frame-reset shape).
 *  - `'pointerPosition'` — a {x,y} absolute position,
 *    last-write-wins across contributing sources (position isn't additive).
 */
export type ActionValueType = 'digital' | 'scalar' | 'vector2' | 'pointerDelta' | 'pointerPosition';

/** An action has a name and one or more bindings */
export interface InputAction {
  /** Declares this action's value shape (F1). Optional — defaults to `'digital'`, matching
   *  every action authored before F1. See `ActionValueType` for the full set. */
  valueType?: ActionValueType;
  bindings: InputBinding[];
}

/** The .inputmap.json file format */
export interface InputMapFile {
  version: number;
  actions: Record<string, InputAction>;
}
