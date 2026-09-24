/**
 * A single binding for an action.
 *
 * F2 (spec §12 "Complete Device Backends") un-rejects `mouse_move` and
 * `gamepad_axis_pair` — both now have real `InputManager` readers (see that
 * file's `collectPointerDeltaContributions`/`collectVector2Contributions`):
 *  - `mouse_move` feeds a `'pointerDelta'`-valueType action with the raw
 *    accumulated mouse delta (no deadzone — deltas are not deadzoned, same
 *    rule as `test_pointer_delta`), and can ALSO feed a `'vector2'`-valueType
 *    action (the same delta, radial-deadzoned + unit-circle-clamped via
 *    `deadzone`) — e.g. an alternative look control. It does not feed a
 *    `'scalar'` action (no natural single-axis-select field is defined; add
 *    one if a real use case needs it).
 *  - `gamepad_axis_pair` feeds a `'vector2'`-valueType action with the
 *    coupled `(xAxis, yAxis)` reading, radial-deadzoned the same way a real
 *    analog stick is (default deadzone 0.15, matching `gamepad_axis`).
 *
 * F2 also adds `touch_button`/`touch_stick` below — the touch/virtual-control
 * backend. Both are driven by `InputManager.setTouchButton`/`setTouchStick`
 * (the injectable entry points a touch-control UI's own touchstart/
 * touchmove/touchend handlers call — that DOM wiring is a thin adapter at
 * the edge, browser-verified separately; the MAPPING here is unit-tested
 * headlessly with no DOM). `sourceId` names the virtual control (a zone/
 * knob id chosen by the touch UI), reusing the same field `test_*` bindings
 * use for their named source — not a real device index.
 */
export type InputBinding =
  | { type: 'key'; code: string }
  | { type: 'mouse_button'; button: number }
  | { type: 'mouse_move'; deadzone?: number }
  | { type: 'gamepad_button'; button: number }
  | { type: 'gamepad_axis'; axis: number; direction: 'positive' | 'negative'; deadzone?: number }
  | { type: 'gamepad_axis_pair'; xAxis: number; yAxis: number; deadzone?: number }
  // F1 (spec §12) — the "injected test input" backend named in F2's acceptance criteria,
  // built here as the typed value model's testable source (see input-manager.ts's
  // injectAxis/injectVector2/injectPointerDelta/injectPointerPosition). Each is keyed by a
  // caller-chosen `sourceId` (not a real device index) so tests can push synthetic raw values
  // through the exact same aggregation/deadzone/combine path real device backends will use.
  | { type: 'test_axis'; sourceId: string; deadzone?: number }
  | { type: 'test_vector2'; sourceId: string; deadzone?: number }
  | { type: 'test_pointer_delta'; sourceId: string }
  | { type: 'test_pointer_position'; sourceId: string }
  // F2 (spec §12) — touch/virtual controls. `touch_button` is digital (edge-
  // tracked just like `mouse_button`); `touch_stick` is a `'vector2'`-valueType
  // analog control (radial-deadzoned like a gamepad stick). See input-manager.ts's
  // setTouchButton/setTouchStick.
  | { type: 'touch_button'; sourceId: string }
  | { type: 'touch_stick'; sourceId: string; deadzone?: number };

/**
 * The value shape an action carries (F1, spec §12 "Define Typed Action Values"):
 *  - `'digital'` — boolean, with pressed/justPressed/justReleased edges (InputManager.isPressed
 *    et al.). The default when an action omits `valueType` — every action authored before F1
 *    is a digital action, so this stays backward compatible.
 *  - `'scalar'` — a single float axis (InputManager.getScalar), e.g. a throttle or a single
 *    thumbstick axis.
 *  - `'vector2'` — a {x,y} axis pair (InputManager.getVector2), e.g. movement/look.
 *  - `'pointerDelta'` — a {x,y} per-frame movement delta (InputManager.getPointerDelta),
 *    summed across contributing sources, cleared every frame (mirrors the existing
 *    mouseDeltaX/Y accumulator's per-frame-reset shape).
 *  - `'pointerPosition'` — a {x,y} absolute position (InputManager.getPointerPosition),
 *    last-write-wins across contributing sources (position isn't additive).
 */
export type ActionValueType = 'digital' | 'scalar' | 'vector2' | 'pointerDelta' | 'pointerPosition';

/** A plain 2D vector — the shared shape for Vector2 axis pairs, pointer delta, and pointer
 *  position action values (F1). */
export interface Vector2 {
  x: number;
  y: number;
}

/**
 * Maps an `ActionValueType` to its TS read type. This is the "no `any`" backbone behind
 * `InputManager.readAction` (and, informally, behind each dedicated typed getter returning a
 * concrete, non-`any` type): given a value type known at the call site (a literal, or a type
 * parameter inferred from a caller's own action-value-type map), the return type is exact.
 */
export type ActionValueOf<T extends ActionValueType> = T extends 'digital'
  ? boolean
  : T extends 'scalar'
    ? number
    : T extends 'vector2' | 'pointerDelta' | 'pointerPosition'
      ? Vector2
      : never;

/**
 * Device/source metadata (F1 AC): which binding — and, for gamepad bindings, which connected
 * gamepad, or for injected test bindings, which named source — produced an action's current
 * value. Returned by the `*Source` sibling of each typed getter (e.g. `getScalarSource`).
 */
export interface ActionValueSource {
  /** The binding kind that produced the current value. `'virtual'`
   *  (Task 1.4) is not a real `InputBinding` — it marks a
   *  value written by `InputManager.setVirtualAction` (the synthetic-player
   *  seat), not a device binding. */
  bindingType: InputBinding['type'] | 'virtual';
  /** Present for `test_axis`/`test_vector2`/`test_pointer_delta`/`test_pointer_position`/
   *  `touch_button`/`touch_stick` bindings — the caller-chosen source id passed to the
   *  matching `inject*`/`setTouch*` call (F2 reuses this same field for named touch zones,
   *  not a real device index). */
  sourceId?: string;
  /** Present for `gamepad_button`/`gamepad_axis`/`gamepad_axis_pair` (F2) bindings — the
   *  index into `navigator.getGamepads()` of the gamepad that produced the value. */
  gamepadIndex?: number;
  /** F2 — present alongside `gamepadIndex` for `gamepad_button`/`gamepad_axis`/
   *  `gamepad_axis_pair` bindings: the connected gamepad's `Gamepad.id` (device identity,
   *  spec §12 F2 "expose device identity"), e.g. a vendor/product string. */
  gamepadId?: string;
}

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

// =============================================================================
// F3 (spec §12 "Add Rebinding and Prompts") — rebinding + conflict + prompt
// types. See input-manager.ts's class doc comment for the full design note;
// these are the plain data shapes shared between `InputManager`'s rebinding
// API, the framework-free `RebindController` (rebind-controller.ts), and any
// UI that surfaces them.
// =============================================================================

/**
 * A structural conflict returned by `InputManager.findConflicts` (F3 AC
 * "Conflicts are detected and returned structurally"): a proposed binding
 * would collide with an EXISTING binding already registered on a different
 * action. Never thrown — always a plain data array the caller (typically a
 * rebinding UI) inspects and decides what to do with (block, warn, or let the
 * user override).
 */
export interface BindingConflict {
  /** The other action whose existing binding collides with the proposed one. */
  actionName: string;
  /** That action's bindings-array index the collision was found at (stable
   *  enough to pass straight to `removeBinding`/`replaceBinding` if the UI
   *  offers "steal this binding"). */
  bindingIndex: number;
  /** The colliding binding itself. */
  binding: InputBinding;
}

/**
 * The coarse input-device family a prompt is being requested for (F3 AC "a
 * current-device prompt API"). Keyboard and mouse are kept distinct — a
 * binding list frequently carries one of each (e.g. `key` for movement,
 * `mouse_button` for fire) and a prompt UI usually wants to show whichever
 * one is bound, not conflate the two.
 */
export type PromptDevice = 'keyboard' | 'mouse' | 'gamepad' | 'touch';

/**
 * The resolved display prompt for one action's binding on a given device
 * family (F3 AC: "resolves labels/icons such as `Space`, `A`, or a touch
 * control"). `icon` is a short glyph/name a UI can look up in its own icon
 * set (for keyboard it's the same short label; for gamepad it's the
 * canonical button/glyph name, e.g. `'A'`; the UI decides how to render it).
 */
export interface BindingPrompt {
  device: PromptDevice;
  bindingType: InputBinding['type'];
  label: string;
  icon: string;
}
