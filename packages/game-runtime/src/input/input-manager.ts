import { AssetParseError } from '@volter/threejs-runtime/asset-parse-error';
import { resolveUrl } from '@volter/threejs-runtime/loader';
import { inputBindingsCollide } from './binding-identity';
import type {
  ActionValueOf,
  ActionValueSource,
  ActionValueType,
  BindingConflict,
  BindingPrompt,
  InputBinding,
  InputMapFile,
  PromptDevice,
  Vector2,
} from './input-types';
import {
  bindingDeviceFamily,
  gamepadAxisLabel,
  gamepadAxisPairLabel,
  keyLabel,
  mouseButtonLabel,
  STANDARD_GAMEPAD_BUTTON_LABELS,
} from './prompt-labels';
import { InputMapFileSchema } from './schema';

/**
 * True when a text-entry element is focused, so game input shouldn't also fire
 * (e.g. typing into an editor inspector field / renaming an entity). Cheap guard
 * that holds even when the game viewport is the active tab.
 */
function isTextEntryFocused(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable === true
  );
}

/**
 * Thrown by `InputManager.setVirtualAction`/`tapVirtualAction` (Task 1.4)
 * for an action name that was never `registerAction`/`loadMap`-ed. Carries a
 * machine-readable `code` and `data.registered` (every declared action name)
 * rather than requiring a caller to parse the message.
 */
export class InputActionError extends Error {
  readonly code = 'INPUT_ACTION_NOT_FOUND' as const;
  readonly data: { registered: string[] };

  constructor(action: string, method: string, registered: string[]) {
    super(
      `InputManager.${method}: unknown action "${action}". Registered actions: ` +
        (registered.length ? registered.join(', ') : '(none)'),
    );
    this.name = 'InputActionError';
    this.data = { registered };
  }
}

/**
 * Thrown by `InputManager.scheduleActionAtTick` (D15/T-D15.5) when the
 * named `tick` has already elapsed — scheduling only ever applies to the
 * CURRENT or a future tick, never one already serviced by `poll()`.
 * Carries `data.currentTick` — the NEXT tick `poll()` will service (not
 * the tick that just elapsed) — so a caller can retry by scheduling for
 * `data.currentTick` or later.
 */
export class InputTickError extends Error {
  readonly code = 'TICK_ALREADY_PASSED' as const;
  readonly data: { currentTick: number };

  constructor(tick: number, currentTick: number) {
    super(
      `InputManager.scheduleActionAtTick: tick ${tick} has already passed (next tick to be ` +
        `serviced: ${currentTick}) — scheduling only applies to the current or a future tick`,
    );
    this.name = 'InputTickError';
    this.data = { currentTick };
  }
}

/** One named digital-pair axis whose interpolation is owned by {@link InputManager}.
 *
 * Foreign runtimes translate their authored axis table into this neutral carrier, then keep their
 * public API at the compat boundary. The manager owns the live values because the values are a
 * derived view of its action state, not a second device/input store. */
export interface SmoothedInputAxisDefinition {
  readonly name: string;
  readonly negativeAction: string;
  readonly positiveAction: string;
  /** Units per second when returning to zero. */
  readonly gravity: number;
  /** Magnitudes below this threshold read as zero without changing retained interpolation. */
  readonly dead: number;
  /** Units per second when approaching a pressed direction. */
  readonly sensitivity: number;
  /** Reset to zero before accelerating when the newly pressed direction opposes the old value. */
  readonly snap: boolean;
  readonly invert: boolean;
}

/** Scene-owned handle over an InputManager-owned set of smoothed axes. */
export interface SmoothedInputAxisSet {
  advance(deltaTime: number): void;
  getAxis(name: string): number;
  getAxisRaw(name: string): number;
  snapshot(): Record<string, number>;
  dispose(): void;
}

interface SmoothedInputAxisSetState {
  readonly definitions: ReadonlyMap<string, SmoothedInputAxisDefinition>;
  readonly values: Map<string, number>;
  disposed: boolean;
}

/** Shallow equality for a resolved action value (boolean/number/Vector2) —
 *  D15/T-D15.5's recording tap uses this to emit DELTAS only (the trace
 *  format's "deltas only" line), never a full snapshot every tick. `prev`
 *  is `undefined` for an action never recorded before (always "changed"). */
function actionValuesEqual(
  prev: boolean | number | { x: number; y: number } | undefined,
  next: boolean | number | { x: number; y: number },
): boolean {
  if (prev === undefined) return false;
  if (typeof prev !== typeof next) return false;
  if (typeof prev === 'object' && typeof next === 'object') {
    return prev.x === next.x && prev.y === next.y;
  }
  return prev === next;
}

/** Cap on {@link InputManager}'s post-gate input-trace ring (D15/T-D15.5) —
 *  mirrors `debug-registry.ts`'s own `RING_CAP` precedent for the debug event
 *  ring: bounds memory for a recording session a caller forgot to stop. */
const INPUT_TRACE_CAP = 2000;

/**
 * Maps raw keyboard/mouse/gamepad events → named actions.
 *
 * Usage:
 *   const input = new InputManager();
 *   await input.loadMap('inputmaps/default.inputmap.json');
 *   // In game loop:
 *   input.poll();  // call at start of frame
 *   if (input.isPressed('jump')) { ... }
 *   if (input.isJustPressed('attack')) { ... }
 *   input.endFrame();  // call at end of frame
 *
 * F1 (spec §12 "Define Typed Action Values") — typed action values:
 *
 * Every action DECLARES a value shape (`InputAction.valueType`, defaulted to
 * `'digital'` — see `input-types.ts`'s `ActionValueType`). Each shape has its
 * own typed getter, none of which return `any`:
 *
 *   - `'digital'`         — `isPressed`/`isJustPressed`/`isJustReleased` -> `boolean`
 *   - `'scalar'`           — `getScalar` -> `number`
 *   - `'vector2'`          — `getVector2` -> `Vector2` ({x,y})
 *   - `'pointerDelta'`     — `getPointerDelta` -> `Vector2`
 *   - `'pointerPosition'`  — `getPointerPosition` -> `Vector2`
 *
 * Reading an action through the WRONG getter (e.g. `getScalar` on a
 * `'digital'` action) throws — that's the type-safety enforcement point,
 * since actions are declared in data (JSON), not TS types, so there's no
 * compiler backstop otherwise. `readAction(name, expectedType)` is a generic
 * entry point over the same getters, typed via `ActionValueOf<T>`.
 *
 * Each typed getter has a `*Source` sibling (e.g. `getScalarSource`) that
 * returns `ActionValueSource | null` — which binding (and, for gamepad
 * bindings, which connected gamepad, or for injected test bindings, which
 * named source) produced the current value. That's the "device/source
 * metadata" AC.
 *
 * Deadzone + normalization:
 *   - scalar: below `deadzone` magnitude -> 0; at/above it, rescaled from 0
 *     (at the deadzone edge) to ±1 (at |raw| = 1), sign preserved
 *     (`rescaleScalar`).
 *   - vector2: below `deadzone` magnitude -> {0,0}; at/above it, direction is
 *     preserved and magnitude is rescaled the same way, then the result is
 *     clamped to the unit circle — magnitude never exceeds 1 even for a raw
 *     diagonal input like {1,1} (`rescaleVector2`).
 *
 * Simultaneous-binding combine rules (documented here, spec §12 F1
 * "simultaneous bindings combine predictably"):
 *   - digital: OR — any one satisfied binding makes the action pressed
 *     (pre-existing behavior, unchanged).
 *   - scalar: max-magnitude across contributing bindings' (deadzone-applied)
 *     values, sign preserved; ties keep the first-listed binding
 *     (deterministic given binding array order).
 *   - vector2: sum contributing (deadzone-applied) {x,y} values component-
 *     wise, then clamp the sum to the unit circle (never renormalized UP —
 *     only ever scaled down if the sum exceeds magnitude 1).
 *   - pointerDelta: sum contributing deltas (matches the existing
 *     mouseDeltaX/Y + lookStick accumulation precedent below).
 *   - pointerPosition: last-write-wins — the contributing source most
 *     recently updated (by injection call order) wins; position isn't
 *     additive so summing would be meaningless.
 *
 * Synthetic input injection (test hook, also the shape of F2's "injected
 * test input" backend): `injectAxis`/`injectVector2`/`injectPointerDelta`/
 * `injectPointerPosition` push a raw value into a named source, read back by
 * binding an action to `{ type: 'test_axis' | 'test_vector2' |
 * 'test_pointer_delta' | 'test_pointer_position', sourceId }` — the exact
 * same aggregation path (deadzone/normalize/combine) real device bindings
 * use.
 *
 * F2 (spec §12 "Complete Device Backends") completes the real-device side of
 * that same typed-value path:
 *
 *   - `mouse_move` — un-rejected (schema.ts). Feeds `getPointerDelta` (raw
 *     accumulated `mouseDeltaX/Y`, no deadzone) and `getVector2` (the same
 *     delta, deadzone-rescaled + unit-circle-clamped).
 *   - `gamepad_axis_pair` — un-rejected (schema.ts). Feeds `getVector2` with
 *     the coupled `(xAxis, yAxis)` reading, deadzone-rescaled like a real
 *     stick (default deadzone 0.15, matching `gamepad_axis`).
 *   - `touch_button`/`touch_stick` — new binding kinds for touch/virtual
 *     controls. `setTouchButton(sourceId, pressed)` feeds a digital action
 *     (edge-tracked like `mouse_button`); `setTouchStick(sourceId, value)`
 *     feeds a vector2 action (deadzone-rescaled like a gamepad stick). These
 *     are the injectable entry points an on-screen touch UI calls, and they
 *     are the UPPER half of the touch story. The LOWER half — the DOM
 *     pointer stream itself, as dense finger indices mapped into the game's
 *     own design space and gated on `isInputActive()` — is
 *     `input/host-pointer.ts` (`createHostPointer`), beside this file; a
 *     control drains its `takeTouches()` and calls the setters above.
 *     What is deliberately still NOT here is the control layer in between:
 *     which rect owns which finger, and how a knob's offset becomes a stick
 *     vector, is the shape of the UI drawing the control, so it belongs to
 *     that UI and there is no first-party one to generalize from yet.
 *   - Focus gating — `blur`/`focus` on `window` (guarded, real DOM only) now
 *     drop input the same way `setEnabled(false)` does (flushing held
 *     key/mouse/touch-button state) without touching the `enabled` flag the
 *     editor drives — see `focused`/`inputActive` below. This is what stops
 *     a stuck key/button when the user alt-tabs away mid-press.
 *   - Pointer lock — `pointerlockchange` on `document` (guarded) tracks
 *     `isPointerLocked()`; losing lock flushes mouse-button state (a click
 *     held at the moment lock exits must not stick).
 *   - Gamepad device identity — `getGamepadInfo(index)` exposes `{index, id,
 *     mapping, connected}`; `ActionValueSource.gamepadId` (in addition to the
 *     pre-existing `gamepadIndex`) is populated for every
 *     gamepad_button/gamepad_axis/gamepad_axis_pair source.
 *   - Disconnection/reconnection needs no new tracking: `poll()` already
 *     re-reads `navigator.getGamepads()` every frame and every read (digital
 *     edges, scalar/vector2 contributions) already skips a `null` gamepad
 *     entry, so a disconnected gamepad's bound actions go neutral (and a
 *     previously-held button correctly fires `isJustReleased`) with no
 *     special-cased code — see the state-transition tests.
 *
 * F3 (spec §12 "Add Rebinding and Prompts") completes the input system with
 * rebinding, structural conflict detection, and device-prompt resolution:
 *
 *   - Listing/mutating: `getBindings`/`setBindings`/`addBinding`/
 *     `removeBinding`/`replaceBinding` — the same `this.actions` map F1/F2
 *     already read, now with a public read + mutation surface (there was
 *     previously none — every existing call site either loaded a map once or
 *     read through the typed getters).
 *   - Reset-to-defaults: `registerAction`/`loadMap`/`loadMapObject` snapshot
 *     each action's bindings into `defaultBindings` (a deep clone) at
 *     registration/load time; `resetBindings`/`resetAllBindings` restore from
 *     that snapshot. Later rebinding calls do NOT touch the snapshot, so
 *     "reset" always means "back to what was authored/loaded", not "back to
 *     the last reset".
 *   - Persist: `toInputMapFile()` serializes the live action set back into
 *     the exact `.inputmap.json` shape (`InputMapFile`) `loadMap` reads;
 *     `loadMapObject(data)` is `loadMap`'s synchronous, no-`fetch` sibling —
 *     both funnel through the same `InputMapFileSchema`-validated
 *     `applyParsedMap`. This is the round-trip seam: serialize, write/hand to
 *     something else, reload, and rebound actions survive. It complements —
 *     doesn't replace — the SDK's `project.inputMap.read/validate/update`
 *     operations (B2, `packages/vgai-sdk/src/project/input-map-operations.ts`):
 *     those are FILE-level (a CLI/agent editing the `.inputmap.json` on disk,
 *     no running game involved); this is RUNTIME-level (a live game rebinding
 *     while playing). Both validate through the identical
 *     `InputMapFileSchema`, so a file B2 wrote loads here unchanged, and a
 *     map this class serializes is a valid document for B2 to read back.
 *   - Conflicts: `findConflicts(proposed, excludeActionName?)` scans every
 *     OTHER registered action's bindings for one that's structurally
 *     equivalent to `proposed` (see `inputBindingsCollide` — same
 *     physical input identity: same key code, same mouse button, the same
 *     gamepad button/axis/axis-pair, the same touch `sourceId`, etc.) and
 *     returns the (possibly empty) list as plain `BindingConflict` data —
 *     never throws. A rebinding UI calls this BEFORE calling
 *     `addBinding`/`replaceBinding`/`setBindings` and decides what to do with
 *     a non-empty result (block, warn, let the user steal the binding by
 *     removing it from the other action first).
 *   - Prompts: `getPrompt(actionName, device?, gamepadIndex?)` resolves a
 *     `BindingPrompt` (display label + icon name) for whichever of the
 *     action's bindings belongs to the requested `PromptDevice` family
 *     (keyboard/mouse/gamepad/touch — `bindingDeviceFamily` in
 *     `prompt-labels.ts`), using `getGamepadInfo` to prefer the standard
 *     mapping's canonical glyph names (`'A'`, `'LB'`, ...) for gamepad
 *     buttons and falling back to a raw index label (or a "disconnected"
 *     label) when the pad isn't in standard mapping or isn't connected.
 *     `device` is optional (F4 below) — omit it to resolve against
 *     `getLastActiveDevice()` instead.
 *
 * F4 (spec §12 "Schema and Examples") closes F3's one open gap — a
 * current-ACTIVE-device tracker, so a prompt UI can switch its displayed
 * label as the player switches controllers instead of the caller having to
 * track that itself:
 *
 *   - `getLastActiveDevice()` returns the `PromptDevice` family of whichever
 *     input arrived most recently — keyboard on `keydown`, mouse on
 *     `mousedown`/a real `mousemove`, gamepad on a button press or an axis
 *     past ITS OWN DECLARED DEADZONE (checked in `poll()`), touch on
 *     `setTouchButton(_, true)` or a `setTouchStick` past the deadzone that
 *     stick's binding declares. `null` before any input has arrived. The
 *     off-rest threshold is always the game's declaration, never a constant
 *     this class picked — see `declaredDeadzone`.
 *   - `getPrompt(actionName)` (device omitted) resolves against it directly,
 *     falling back to `'keyboard'` before any input has arrived — a HUD can
 *     call it every frame with no extra bookkeeping and the label switches on
 *     its own.
 */
/**
 * The documented deadzone defaults, one home each. Both are stated in
 * `input/schema.ts`'s own `.describe()` text — spelled here so every reader
 * (the value getters AND the active-device tracker) uses the SAME number, which
 * is the drift the tracker's old hardcoded 0.3 was.
 */
const GAMEPAD_AXIS_DEFAULT_DEADZONE = 0.15;
/** `touch_stick`'s documented default: none. A virtual stick reports a value
 *  only because a finger is on it, so it has no at-rest jitter floor to clear. */
const TOUCH_STICK_DEFAULT_DEADZONE = 0;

export class InputManager {
  private actions = new Map<string, InputBinding[]>();
  // F1 — each registered/loaded action's declared value shape (defaults to
  // 'digital' — see registerAction/loadMap). Kept as a sibling map rather than
  // folded into `actions` so the pre-F1 `Map<string, InputBinding[]>` shape
  // (and every existing direct read of it, e.g. in tests) stays unchanged.
  private actionValueTypes = new Map<string, ActionValueType>();
  // F3 — a deep-cloned snapshot of each action's bindings AT REGISTRATION/LOAD
  // TIME (registerAction/loadMap/loadMapObject), restored by
  // resetBindings/resetAllBindings. Later rebinding calls (setBindings/
  // addBinding/removeBinding/replaceBinding) deliberately do not touch this —
  // "reset" always means "back to the originally authored/loaded defaults".
  private defaultBindings = new Map<string, InputBinding[]>();
  // F3 — the `version` field of the last `loadMap`/`loadMapObject`-ed
  // document, carried forward by `toInputMapFile()` so a round-trip
  // (serialize -> reload) preserves it. Defaults to 1 for a manager built
  // purely via `registerAction` (no file was ever loaded).
  private loadedMapVersion = 1;
  private keysDown = new Set<string>();
  private keysJustDown = new Set<string>();
  private keysJustUp = new Set<string>();
  private mouseButtons = new Set<number>();
  private mouseButtonsJustDown = new Set<number>();
  private mouseButtonsJustUp = new Set<number>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  /** Last `mousemove` client position. Device-poll only — action maps read delta, not this. */
  private mouseClientX = 0;
  private mouseClientY = 0;
  private gamepads: (Gamepad | null)[] = [];
  // Gamepad button edge tracking (P1.6c). Keys are `${gamepadIndex}:${buttonIndex}`.
  // `Prev` is last frame's pressed set; `Down` is this frame's; the just-down/up
  // sets are the per-frame diff computed in poll() and cleared in endFrame().
  private gamepadButtonsDown = new Set<string>();
  private gamepadButtonsPrev = new Set<string>();
  private gamepadButtonsJustDown = new Set<string>();
  private gamepadButtonsJustUp = new Set<string>();
  // Gamepad axis edge tracking: raw per-(gamepad,axis) values, this frame vs
  // last frame, so `gamepad_axis` bindings can compute a thresholded
  // (direction + deadzone) boolean for THIS frame and compare it against the
  // same threshold applied to last frame's raw value — giving real
  // isJustPressed/isJustReleased edges for an otherwise-continuous input.
  // Keys are `${gamepadIndex}:${axisIndex}`; `Prev` is carried forward in
  // endFrame(), mirroring the button edge-tracking above.
  private gamepadAxesCurrent = new Map<string, number>();
  private gamepadAxesPrev = new Map<string, number>();
  private lookStickX = 0;
  private lookStickY = 0;
  // F1 — injected-test-input raw value stores, keyed by caller-chosen
  // `sourceId` (see the class doc comment's "Synthetic input injection"
  // section). Axis/Vector2/pointer-position are LEVEL values (persist across
  // frames until changed, mirroring a real analog stick/gamepad axis —
  // there's no hardware poll to naturally refresh them each frame); pointer
  // delta is a per-frame accumulator (cleared in endFrame(), mirroring
  // mouseDeltaX/Y above).
  private testAxisValues = new Map<string, number>();
  private testVector2Values = new Map<string, Vector2>();
  private testPointerDeltaAccum = new Map<string, Vector2>();
  private testPointerPositionValues = new Map<string, { value: Vector2; seq: number }>();
  // Monotonic counter stamped onto each injectPointerPosition call so the
  // pointerPosition combine rule (last-write-wins) can tell which of several
  // contributing sources was written most recently within/across frames.
  private pointerPositionSeq = 0;
  // F2 — touch/virtual-control state, keyed by caller-chosen `sourceId` (the
  // touch UI's own zone/knob id — see setTouchButton/setTouchStick). Buttons
  // mirror the mouse-button edge-tracking shape (Down/JustDown/JustUp sets);
  // sticks are LEVEL values like a gamepad axis (persist until changed).
  private touchButtonsDown = new Set<string>();
  private touchButtonsJustDown = new Set<string>();
  private touchButtonsJustUp = new Set<string>();
  private touchStickValues = new Map<string, Vector2>();
  // F4 (spec §12 "Schema and Examples" — the F3 prompt-switching gap) — which
  // device family most recently produced REAL input, so a prompt UI can
  // switch its displayed label ('Space' -> 'A' -> a touch control's name) as
  // the player switches controllers, without the caller having to guess or
  // track this itself. Updated at the same points raw input arrives: keydown
  // (`'keyboard'`), mousedown/mousemove (`'mouse'`), a gamepad button press or
  // an axis past its declared deadzone (`'gamepad'`, both detected in
  // `poll()` — a raw resting stick reports small non-zero noise on some
  // pads, so this checks the threshold the GAME declared for that axis, not
  // "any non-zero axis"), and a touch button press / stick pushed past rest
  // (`'touch'` — `setTouchButton`/`setTouchStick`). `null` until the very
  // first input of any kind arrives. See `getLastActiveDevice`/`getPrompt`.
  private lastActiveDevice: PromptDevice | null = null;
  /**
   * "Is this control off its rest position" for the active-device tracker,
   * answered from what the GAME DECLARED rather than from a threshold this
   * class invented.
   *
   * It used to be `Math.hypot(v.x, v.y) > 0.3` — a constant nobody could see or
   * change, sitting on top of a deadzone the game had already stated. A game
   * that declares a 0.5 deadzone on its move stick considers everything under
   * 0.5 to be rest; reporting "the player switched to gamepad" at 0.31 makes a
   * HUD's prompt flip to a control the game itself is ignoring. Zero inference
   * (ARCHITECTURE-CORE §The editor protocol) says the fix is to read the
   * declaration, and it is already here in `this.actions`.
   *
   * SMALLEST wins when several bindings name one source: the first magnitude at
   * which ANY of the game's own bindings treats the control as live is the
   * moment the player has grabbed it.
   */
  private declaredDeadzone(
    matches: (binding: InputBinding) => number | undefined,
    documentedDefault: number,
  ): number {
    let smallest: number | undefined;
    for (const bindings of this.actions.values()) {
      for (const binding of bindings) {
        const declared = matches(binding);
        if (declared !== undefined && (smallest === undefined || declared < smallest)) {
          smallest = declared;
        }
      }
    }
    return smallest ?? documentedDefault;
  }
  // Task 1.4 — action-level virtual input
  // for a synthetic player, promoted from hollowstone's `VirtualInput`. Held
  // digitals OR into isPressed alongside binding contributions (like
  // touchButtonsDown above); tap queues, then is promoted to "active" for
  // exactly one poll()/endFrame() bracket (see poll()/endFrame() below,
  // mirroring hollowstone's queued/beginFrame contract); scalar/vector2 are
  // level values feeding the same max-magnitude/sum combine every real
  // binding uses (collectScalarContributions/collectVector2Contributions).
  private virtualDigitalHeld = new Set<string>();
  /** Processed strength attached to a held virtual digital action. */
  private virtualDigitalStrength = new Map<string, number>();
  private virtualDigitalTapQueued = new Set<string>();
  private virtualDigitalTapActive = new Set<string>();
  /** pulse-runner friction #4 — the release-edge mirror of
   *  `virtualDigitalTapActive`: a direct `setVirtualAction(action, false)` (or
   *  `clearVirtualActions()`) on an action that WAS held writes here so
   *  `isJustReleased` fires exactly once, mirroring real `onKeyUp`'s
   *  immediate `keysJustUp` write (no queue/promotion needed — unlike the
   *  press edge, nothing in `poll()` reassigns this set out from under a
   *  write that lands before `poll()` runs). Cleared every `endFrame()`,
   *  same bracket as every other just-* edge set. */
  private virtualDigitalJustReleased = new Set<string>();
  private virtualScalarValues = new Map<string, number>();
  private virtualVector2Values = new Map<string, Vector2>();
  /** Derived digital-pair axes owned by mounted foreign runtimes. Their public GetAxis-shaped
   * calls remain in compat; only interpolation state and action reads live beside their source. */
  private smoothedAxisSets = new Set<SmoothedInputAxisSetState>();
  // D15/T-D15.5 — tick-indexed input scheduling + post-gate recording.
  //
  // `currentTick` is a FALLBACK, self-incrementing counter, used only when a
  // caller never tells `poll()` which tick it's servicing (every existing
  // bare/headless caller — tests, a mount with no `Game` shell behind it —
  // keeps this exact pre-existing behavior, zero regression). The REAL
  // per-world wiring (`editor-game/src/host/roots/r3f-root.tsx`) instead passes the
  // shared `Game`-level tick counter into every `poll(tick)` call — this is
  // deliberate: an InputManager-local counter drifts from the actual game
  // tick for a paused/frozen world (its `poll()` isn't called every game
  // tick, so a local increment-per-call counter undercounts) — see the
  // `lastServicedTick` gap-handling below, which structurally can't drift
  // because it's driven by whatever tick value the CALLER (ultimately the
  // shared `Game` tick) actually supplies.
  private currentTick = 0;
  /** The last tick value `poll()` actually serviced, or `-1` before the
   *  first call. Used to detect a GAP (this world's input phase didn't run
   *  for one or more intervening ticks — e.g. frozen/paused while other
   *  roots kept advancing the shared game tick) so any schedule entries
   *  inside that gap can be dropped (with an observable event) instead of
   *  silently rotting in {@link scheduledActions} forever. */
  private lastServicedTick = -1;
  /** Pending `scheduleActionAtTick` actuations, grouped by their exact target
   *  tick. Applied (and removed) at the START of that tick's `poll()` — see
   *  `applyScheduledActionsForTick`. A tick whose input phase is skipped
   *  entirely (this world paused/frozen, or a gap between two serviced
   *  ticks) never reaches it — its scheduled entries are dropped, each
   *  emitting one `'input.schedule.dropped'` debug event (`{tick, action}`)
   *  via {@link setDebugEmit}'s sink if one is wired — NOT retried on a
   *  later tick (mirrors `clearVirtualActions`-on-gate-close: no stuck
   *  actuation ever silently fires late). */
  private scheduledActions = new Map<
    number,
    { action: string; value: boolean | number | { x: number; y: number } }[]
  >();
  /** Optional sink for the `'input.schedule.dropped'` debug event (`{tick,
   *  action}`) emitted whenever a scheduled entry is discarded because its
   *  target tick's input phase never ran. Wired by whoever constructs this
   *  `InputManager` with access to a `DebugRegistry`
   *  (`editor-game/src/host/roots/r3f-root.tsx`, the same seed spot as
   *  `setVirtualInputTarget`/`setInputActionsSource`) — `null` (the
   *  default) for a bare/headless `InputManager`, in which case a drop
   *  stays silent (matching pre-D15/T-D15.5 behavior). */
  private debugEmit: ((event: string, detail?: unknown) => void) | null = null;
  /** D15/T-D15.5 recording toggle — see {@link startInputRecording}. */
  private inputRecording = false;
  /** The post-gate action-delta trace (§2.c's format sketch) — capped so an
   *  accidentally-long recording session can't grow this unboundedly. */
  private inputTrace: {
    tick: number;
    actions: Record<string, boolean | number | { x: number; y: number }>;
  }[] = [];
  /** Last value recorded per action, so `recordPostGateTick` only ever
   *  appends a DELTA (the format sketch's "deltas only" line), not a full
   *  snapshot every tick. Cleared on `startInputRecording()`. */
  private lastTraceSnapshot = new Map<string, boolean | number | { x: number; y: number }>();
  private disposed = false;
  /**
   * When false, all raw input is ignored and held/transient state is cleared.
   * The editor host drives this (T6.3, `packages/editor/src/play-mode.ts`) so
   * the running game only receives input while its viewport is the active,
   * focused surface — keystrokes typed into the editor (Scene tab, inspector
   * fields) must not leak into the game. A standalone game leaves this true
   * for its whole lifetime.
   */
  private enabled = true;
  /**
   * F2 — real window focus, distinct from `enabled` (which is the editor's
   * explicit play-mode gate). `false` while the tab/window is blurred (real
   * `blur`/`focus` events — see the constructor). Held keyboard/mouse/touch
   * state is flushed on blur so a key/button held at alt-tab time doesn't
   * stick (the browser stops delivering keyup/mouseup while blurred).
   */
  private focused = true;
  /** Both gates a standalone game must pass for input to be live (spec §12
   *  F2 "focus gating"): the editor's explicit `enabled` flag AND real
   *  window focus. Used everywhere `enabled` alone used to be checked. */
  private get inputActive(): boolean {
    return this.enabled && this.focused;
  }
  /** #144 — the gate MACHINE input passes (virtual actions and
   *  tick-scheduled actuations): the editor's explicit `enabled` flag ONLY.
   *  Window focus deliberately does not participate: a synthetic player
   *  drives the shared editor tab precisely while the human's focus is
   *  elsewhere (their terminal, another window) — the first live in-editor
   *  E2E run froze mid-suite the moment the owner started typing to their
   *  agent, which is the bug this gate split fixes. Real-device input keeps
   *  the stricter `inputActive` (enabled AND focused) gate above. */
  private get machineInputActive(): boolean {
    return this.enabled;
  }
  /** F2 — real pointer-lock state (`document.pointerLockElement`), tracked via
   *  `pointerlockchange` (see the constructor). */
  private pointerLocked = false;
  /** Element currently wired for click-to-pointer-lock, and its listener. */
  private pointerLockElement: HTMLElement | null = null;
  /** One report per refusal reason: a refused lock is the whole story of
   *  "the mouse doesn't aim", and it was silent. */
  private reportedPointerLockRefusals = new Set<string>();
  private reportPointerLockRefused(reason: string): void {
    if (this.reportedPointerLockRefusals.has(reason)) return;
    this.reportedPointerLockRefusals.add(reason);
    // biome-ignore lint/suspicious/noConsole: the game's own input intent failed in the browser — an error the editor console and a tester's evidence must both carry
    console.error(
      `Pointer lock was refused, so mouse look and mouse aim cannot engage: ${reason}. ` +
        'The browser grants it only to a user gesture on a page it trusts — a page inside a ' +
        'frame needs allow="pointer-lock", and some extensions block it.',
    );
  }
  /** A retry already scheduled for Chrome's post-exit cooldown, if any. */
  private pointerLockRetry: ReturnType<typeof setTimeout> | null = null;
  private onPointerLockClick = () => {
    // Chrome answers with a promise that REJECTS when the lock is refused (a
    // sandboxed/automated document, a policy, a frame without the permission).
    // Three testers in a row reported "the mouse doesn't aim" on the hosted
    // editor while automation could not lock at all — and the refusal was
    // caught silently (runhuman passes 122–126). It is reported now, once
    // per reason, as the error it is.
    const request = this.pointerLockElement?.requestPointerLock() as unknown;
    if (request instanceof Promise) {
      request.catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        // CHROME'S COOLDOWN IS NOT A REFUSAL. After Escape ends a lock, a
        // request in the next ~1.25 s is rejected with "cannot be acquired
        // immediately after the user has exited the lock" — and a player who
        // clicks back into the game right away gets no aim and no second
        // chance (runhuman pass 130: "I can't move the camera with the
        // mouse"). The click's activation still stands for a few seconds, so
        // the request is retried once when the cooldown has passed.
        if (/exited the lock/i.test(reason) && this.pointerLockRetry === null) {
          this.pointerLockRetry = setTimeout(() => {
            this.pointerLockRetry = null;
            const doc = typeof document !== 'undefined' ? document : null;
            const activation =
              typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
            if (!this.pointerLockElement || doc?.pointerLockElement === this.pointerLockElement) {
              return;
            }
            if (activation?.isActive) {
              this.onPointerLockClick();
            } else {
              // The cooldown outlived the click's activation: the retry
              // cannot run, and a silent end here is "mouse dead, no error".
              this.reportPointerLockRefused(`${reason} (the retry found no user activation left)`);
            }
          }, 1_300);
          return;
        }
        this.reportPointerLockRefused(reason);
      });
    }
  };
  private onPointerLockChange = () => {
    const doc = typeof document !== 'undefined' ? document : null;
    const wasLocked = this.pointerLocked;
    this.pointerLocked =
      !!this.pointerLockElement && doc?.pointerLockElement === this.pointerLockElement;
    // Losing lock mid-click must not leave a mouse button stuck down — the
    // browser may not deliver a mouseup when lock exits (e.g. Escape).
    if (wasLocked && !this.pointerLocked) {
      this.mouseButtons.clear();
      this.mouseButtonsJustDown.clear();
      this.mouseButtonsJustUp.clear();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    // Ignore game input while suspended, unfocused, or while the user is typing
    // into a text field (e.g. renaming an entity / editing an inspector value
    // in the editor).
    if (!this.inputActive || isTextEntryFocused()) return;
    this.lastActiveDevice = 'keyboard';
    if (!this.keysDown.has(e.code)) {
      this.keysJustDown.add(e.code);
    }
    this.keysDown.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.inputActive) return;
    this.keysDown.delete(e.code);
    this.keysJustUp.add(e.code);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.inputActive) return;
    this.lastActiveDevice = 'mouse';
    this.mouseButtons.add(e.button);
    this.mouseButtonsJustDown.add(e.button);
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.inputActive) return;
    this.mouseButtons.delete(e.button);
    this.mouseButtonsJustUp.add(e.button);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.inputActive) return;
    if (e.movementX !== 0 || e.movementY !== 0) this.lastActiveDevice = 'mouse';
    this.mouseDeltaX += e.movementX;
    this.mouseDeltaY += e.movementY;
    this.mouseClientX = e.clientX;
    this.mouseClientY = e.clientY;
  };

  /** F2 — real window blur: drop focus and flush held REAL-device state
   *  (the browser stops delivering keyup/mouseup while blurred, so a key
   *  held at alt-tab time would stick). #144: virtual-action state is
   *  deliberately NOT flushed here — a bot's held action survives the human
   *  looking away (see `machineInputActive`); only `setEnabled(false)`
   *  clears it. */
  private onWindowBlur = () => {
    this.focused = false;
    this.flushRealHeldState();
  };

  /** F2 — real window focus regain. No flush needed (there's nothing held to
   *  flush — a fresh keydown/mousedown is required to register pressed
   *  again, exactly like re-enabling via `setEnabled(true)`). */
  private onWindowFocus = () => {
    this.focused = true;
  };

  /** Clear held/transient REAL-device state (keyboard/mouse/touch-button) —
   *  shared by `setEnabled(false)` (via `flushHeldState`) and real blur
   *  (`onWindowBlur`), so a key/button physically held when input is
   *  suspended doesn't linger. Level values (gamepad axes, touch sticks,
   *  injected test axes) are deliberately NOT flushed here — they are gated
   *  at READ time instead (see `inputActive` checks in `poll()`/the
   *  `collect*Contributions` methods), matching the pre-existing
   *  gamepad-axis convention. */
  private flushRealHeldState(): void {
    this.keysDown.clear();
    this.keysJustDown.clear();
    this.keysJustUp.clear();
    this.mouseButtons.clear();
    this.mouseButtonsJustDown.clear();
    this.mouseButtonsJustUp.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.touchButtonsDown.clear();
    this.touchButtonsJustDown.clear();
    this.touchButtonsJustUp.clear();
  }

  /** The full flush `setEnabled(false)` performs: real-device state AND
   *  virtual-action state. Task 1.4's rule ("a bot's held action must not
   *  survive input being suspended") now applies only to the editor's
   *  explicit gate — #144 moved real window blur onto `flushRealHeldState`
   *  alone, so machine input survives the human's focus leaving the tab.
   *  No release edge is manufactured here (`manufactureReleaseEdge: false`,
   *  the default) — this is a SUSPEND, not a deliberate release, and mirrors
   *  `flushRealHeldState`'s own silence (a key physically held at
   *  suspend/blur time is wiped with no `keysJustUp`, "flush held state,
   *  don't corrupt history", see `poll()`'s doc comment). */
  private flushHeldState(): void {
    this.flushRealHeldState();
    this.clearVirtualActionState();
  }

  /** Shared by the public `clearVirtualActions()` and `flushHeldState()`
   *  above — clears every virtual-action store (held digitals, queued/active
   *  taps, scalar/vector2 values, the release-edge set itself).
   *
   *  `manufactureReleaseEdge` (default `false`): when `true` — only
   *  `clearVirtualActions()`'s own deliberate "let go" passes this — every
   *  currently-held digital in `virtualDigitalHeld` first gets an
   *  `isJustReleased` edge written to `virtualDigitalJustReleased`, mirroring
   *  a real key-up (`onKeyUp` → `keysJustUp`). `flushHeldState()` (the
   *  editor-gate suspend path) deliberately passes `false` — see its own doc
   *  comment for why a suspend must stay silent. */
  private clearVirtualActionState(options?: { manufactureReleaseEdge: boolean }): void {
    if (options?.manufactureReleaseEdge) {
      for (const action of this.virtualDigitalHeld) {
        this.virtualDigitalJustReleased.add(action);
      }
    }
    this.virtualDigitalHeld.clear();
    this.virtualDigitalStrength.clear();
    this.virtualDigitalTapQueued.clear();
    this.virtualDigitalTapActive.clear();
    this.virtualScalarValues.clear();
    this.virtualVector2Values.clear();
  }

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('mousedown', this.onMouseDown);
      window.addEventListener('mouseup', this.onMouseUp);
      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('blur', this.onWindowBlur);
      window.addEventListener('focus', this.onWindowFocus);
    }
    // `document` isn't touched by any pre-F2 code path (the headless vitest
    // env stubs `window` only) — guard the same way `isTextEntryFocused` does
    // so tests that don't need pointer-lock coverage need no `document` stub.
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('pointerlockchange', this.onPointerLockChange);
    }
  }

  /**
   * Load action map from a .inputmap.json file. Validated via
   * `InputMapFileSchema` (T4.6) — a malformed input map throws a
   * `AssetParseError` naming the file, not a deep TypeError once the bad
   * data reaches `isPressed`/`isJustPressed`/`isJustReleased`.
   */
  async loadMap(url: string) {
    await this.fetchMap(url, false);
  }

  /**
   * `loadMap`'s OPTIONAL sibling: apply the map at `url` when the project
   * ships one and report `false` — SILENTLY — when it does not exist.
   *
   * The host loads the conventional map path at mount for every three/canvas
   * root, including the scaffolded shape that has declared no actions yet, so
   * "no map on disk" is the ordinary state of a brand-new project and must not
   * print an error on every boot. Everything else stays exactly as loud as
   * `loadMap`: a map that EXISTS and is malformed (or any non-404 failure)
   * still logs and throws.
   */
  async loadMapIfPresent(url: string): Promise<boolean> {
    return this.fetchMap(url, true);
  }

  /** Shared fetch/validate/apply for {@link loadMap} and
   *  {@link loadMapIfPresent}; `optional` decides only what a 404 means. */
  private async fetchMap(url: string, optional: boolean): Promise<boolean> {
    let data: InputMapFile;
    try {
      const res = await fetch(resolveUrl(url));
      if (!res.ok) {
        if (optional && res.status === 404) return false;
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      const result = InputMapFileSchema.safeParse(json);
      if (!result.success) throw new AssetParseError(result.error.issues, url);
      data = result.data;
    } catch (err) {
      const message = `InputManager.loadMap: failed to load input map "${url}": ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.error(message);
      throw err instanceof AssetParseError ? err : new Error(message);
    }
    this.applyParsedMap(data);
    return true;
  }

  /**
   * F3 — `loadMap`'s synchronous, no-`fetch` sibling: apply an already-in-
   * memory (or freshly-deserialized) input-map DOCUMENT, validated through
   * the identical `InputMapFileSchema` (throws `AssetParseError` naming no
   * file, matching `loadMap`'s error shape minus the URL). This is the other
   * half of the F3 persist round-trip: `toInputMapFile()` serializes,
   * `loadMapObject` re-applies — no network/file I/O required, so it's also
   * how a headless test proves a rebind survives a save/reload cycle.
   */
  loadMapObject(data: unknown): InputMapFile {
    const result = InputMapFileSchema.safeParse(data);
    if (!result.success) throw new AssetParseError(result.error.issues);
    this.applyParsedMap(result.data);
    return result.data;
  }

  /** Shared apply step for `loadMap`/`loadMapObject`: copy each action's
   *  bindings + declared valueType into the live maps, and snapshot the
   *  bindings as that action's F3 reset-to-defaults baseline. */
  private applyParsedMap(data: InputMapFile): void {
    this.loadedMapVersion = data.version;
    for (const [name, action] of Object.entries(data.actions)) {
      this.actions.set(name, action.bindings);
      // `InputActionSchema.valueType` has a Zod `.default('digital')`, so a
      // successfully-parsed action always carries one even when the source
      // JSON omitted it.
      this.actionValueTypes.set(name, action.valueType ?? 'digital');
      this.defaultBindings.set(name, structuredClone(action.bindings));
    }
  }

  /** Register an action programmatically. `valueType` declares the action's
   *  value shape (F1) — defaults to `'digital'`, matching every call site
   *  written before F1. F3 — also snapshots `bindings` as this action's
   *  reset-to-defaults baseline (see `resetBindings`). */
  registerAction(name: string, bindings: InputBinding[], valueType: ActionValueType = 'digital') {
    this.actions.set(name, bindings);
    this.actionValueTypes.set(name, valueType);
    this.defaultBindings.set(name, structuredClone(bindings));
  }

  /** The declared value type for a registered/loaded action (F1) — `'digital'`
   *  for an action that never specified one (including an unregistered/typo'd
   *  name — harmless, since every typed getter already treats an unknown
   *  action as inert). */
  getActionValueType(actionName: string): ActionValueType {
    return this.actionValueTypes.get(actionName) ?? 'digital';
  }

  /** Enforces the F1 type-safety AC: reading an action through a typed getter
   *  whose value type doesn't match the action's DECLARED `valueType` throws,
   *  naming both. Unknown actions (never registered/loaded) are exempt — they
   *  already read as inert/zeroed by every getter, matching pre-F1 behavior
   *  for a typo'd action name. */
  private assertValueType(actionName: string, expected: ActionValueType, method: string): void {
    const actual = this.actionValueTypes.get(actionName);
    if (actual !== undefined && actual !== expected) {
      throw new Error(
        `InputManager.${method}: action "${actionName}" is declared valueType '${actual}', not ` +
          `'${expected}'. Typed reads must match an action's declared valueType (F1, spec §12) — ` +
          `use the getter for '${actual}' instead.`,
      );
    }
  }

  /** The names of all registered actions (the `game.input.actions` debug seam
   *  enumerates these — `editor-game/src/runtime/game-input-seams.ts`). */
  actionNames(): string[] {
    return [...this.actions.keys()];
  }

  /**
   * Create a retained, action-backed set of digital axes. Foreign runtimes keep their public
   * GetAxis-shaped API in compat, while interpolation and the live action reads stay in the input
   * owner instead of becoming a parallel compat input store.
   */
  createSmoothedAxisSet(definitions: readonly SmoothedInputAxisDefinition[]): SmoothedInputAxisSet {
    const byName = new Map<string, SmoothedInputAxisDefinition>();
    for (const source of definitions) {
      const definition = { ...source };
      if (definition.name.length === 0) {
        throw new Error('InputManager.createSmoothedAxisSet: axis names must not be empty');
      }
      if (byName.has(definition.name)) {
        throw new Error(
          `InputManager.createSmoothedAxisSet: duplicate axis ${JSON.stringify(definition.name)}`,
        );
      }
      if (definition.negativeAction.length === 0 || definition.positiveAction.length === 0) {
        throw new Error(
          `InputManager.createSmoothedAxisSet: axis ${JSON.stringify(definition.name)} requires ` +
            'both negative and positive actions',
        );
      }
      for (const [field, value] of [
        ['gravity', definition.gravity],
        ['dead', definition.dead],
        ['sensitivity', definition.sensitivity],
      ] as const) {
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(
            `InputManager.createSmoothedAxisSet: ${definition.name}.${field} must be a finite ` +
              `non-negative number, received ${String(value)}`,
          );
        }
      }
      byName.set(definition.name, Object.freeze(definition));
    }

    const state: SmoothedInputAxisSetState = {
      definitions: byName,
      values: new Map(),
      disposed: false,
    };
    this.smoothedAxisSets.add(state);

    const assertLive = (): void => {
      if (state.disposed || this.disposed) {
        throw new Error('InputManager smoothed axis set has been disposed');
      }
    };
    const definitionOf = (name: string): SmoothedInputAxisDefinition => {
      assertLive();
      const definition = state.definitions.get(name);
      if (definition === undefined) {
        throw new Error(`InputManager smoothed axis set has no axis ${JSON.stringify(name)}`);
      }
      return definition;
    };
    const rawValue = (definition: SmoothedInputAxisDefinition): number => {
      const negative = this.isPressed(definition.negativeAction) ? -1 : 0;
      const positive = this.isPressed(definition.positiveAction) ? 1 : 0;
      return (negative + positive) * (definition.invert ? -1 : 1);
    };
    const getAxis = (name: string): number => {
      const definition = definitionOf(name);
      const value = state.values.get(name) ?? 0;
      return Math.abs(value) < definition.dead ? 0 : value;
    };

    return {
      advance: (deltaTime) => {
        assertLive();
        if (!Number.isFinite(deltaTime) || deltaTime < 0) {
          throw new Error(
            `InputManager smoothed axis deltaTime must be finite and non-negative, received ` +
              String(deltaTime),
          );
        }
        for (const definition of state.definitions.values()) {
          const target = rawValue(definition);
          const current = state.values.get(definition.name) ?? 0;
          let next: number;
          if (target === 0) {
            const step = definition.gravity * deltaTime;
            next = current > 0 ? Math.max(0, current - step) : Math.min(0, current + step);
          } else {
            const from = definition.snap && current * target < 0 ? 0 : current;
            const step = definition.sensitivity * deltaTime;
            next = target > 0 ? Math.min(target, from + step) : Math.max(target, from - step);
          }
          state.values.set(definition.name, next);
        }
      },
      getAxis,
      getAxisRaw: (name) => rawValue(definitionOf(name)),
      snapshot: () => {
        assertLive();
        const snapshot: Record<string, number> = {};
        for (const name of state.definitions.keys()) snapshot[name] = getAxis(name);
        return snapshot;
      },
      dispose: () => {
        if (state.disposed) return;
        state.disposed = true;
        state.values.clear();
        this.smoothedAxisSets.delete(state);
      },
    };
  }

  /**
   * Poll gamepads and virtual look stick (call at start of frame).
   *
   * `tick` (D15/T-D15.3/.5) — the GAME tick this call services. Pass the
   * live, shared `Game` tick counter here (`editor-game/src/host/roots/r3f-root.tsx` does,
   * via `DebugRegistry.getGameTick()`) so `scheduleActionAtTick`'s numbering
   * never drifts from the actual game tick — the bug an earlier revision of
   * this feature had: an InputManager-LOCAL counter, incremented once per
   * `poll()` call, undercounts for a paused/frozen world (its `poll()` isn't
   * called every game tick while frozen), so a schedule set against "tick
   * 500" could fire at the wrong wall-tick once the world resumed. Omit it
   * (every existing bare/headless caller does) to fall back to the
   * self-incrementing `currentTick` counter — unchanged pre-D15 behavior.
   */
  poll(tick?: number) {
    const servicedTick = tick !== undefined ? tick : this.currentTick;
    // D15/T-D15.5 — a GAP: one or more ticks strictly between the last tick
    // this InputManager serviced and this one never ran its input phase at
    // all (this world was paused/frozen and skipped straight from tick A to
    // a later tick B > A+1 once stepped/resumed again — the frozen-world
    // scenario objection above). Any entries scheduled for a tick inside
    // that gap can never be honored — drop them (each emitting one
    // `'input.schedule.dropped'` event) rather than leaving them to rot in
    // `scheduledActions` forever. Guarded on `size > 0` so the overwhelmingly
    // common case (nothing ever scheduled) costs nothing, even across a
    // very large gap.
    if (this.scheduledActions.size > 0) {
      // Iterate the (tiny) schedule map, never the gap's tick RANGE — a
      // world resuming after a very long freeze (or one mounting late into
      // a game already millions of ticks in) must not pay O(gap) here.
      // Sorted so drop events still arrive in tick order.
      const gapped = [...this.scheduledActions.keys()]
        .filter((t) => t > this.lastServicedTick && t < servicedTick)
        .sort((a, b) => a - b);
      for (const t of gapped) {
        const skipped = this.scheduledActions.get(t)!;
        this.scheduledActions.delete(t);
        for (const entry of skipped) {
          this.debugEmit?.('input.schedule.dropped', { tick: t, action: entry.action });
        }
      }
    }
    this.lastServicedTick = servicedTick;
    this.currentTick = servicedTick + 1;
    if (!this.enabled) {
      // Input suspended by the editor's explicit gate (play stopped /
      // game-tab-inactive). #144: this branch no longer covers real window
      // blur — an enabled-but-blurred tick falls through so MACHINE input
      // (virtual actions, scheduled actuations) keeps flowing while the
      // human's focus is elsewhere; real devices are gated further down.
      // Unlike keyboard/mouse, gamepad state isn't DOM-event-driven —
      // `isPressed`/`isJustPressed`/`isJustReleased` read `this.gamepads`
      // (and the edge-tracked sets) directly, not a live poll of `navigator`.
      // So gate the READ here: leave `this.gamepads` empty so every
      // gamepad-bound check sees no gamepads and reports false. Deliberately
      // leave the edge-tracking sets
      // (gamepadButtons{Prev,Down,JustDown,JustUp}, gamepadAxes{Current,Prev})
      // untouched — they freeze at their last real values while disabled and
      // resume diffing against genuinely-last-observed hardware state once
      // re-enabled, so there's no phantom edge on re-enable (mirrors the
      // "flush held state, don't corrupt history" intent of setEnabled below).
      // D15/T-D15.5: a tick serviced while gated drops its OWN scheduled
      // entries too (never applied, never retried later) — same honesty line
      // `setVirtualAction`'s own gate already draws — each emitting the same
      // `'input.schedule.dropped'` event the gap-handling above does.
      const gatedDrop = this.scheduledActions.get(servicedTick);
      if (gatedDrop) {
        this.scheduledActions.delete(servicedTick);
        for (const entry of gatedDrop) {
          this.debugEmit?.('input.schedule.dropped', { tick: servicedTick, action: entry.action });
        }
      }
      this.gamepads = [];
      return;
    }
    // Task 1.4 — promote queued tapVirtualAction() calls to this frame's
    // "active" just-pressed set (hollowstone's queued/beginFrame contract,
    // ported onto this engine's existing fixed-step poll()/endFrame()
    // bracket instead of a bespoke beginFrame() — poll() already runs at the
    // start of the fixed step). Cleared in endFrame() below.
    this.virtualDigitalTapActive = this.virtualDigitalTapQueued;
    this.virtualDigitalTapQueued = new Set();
    // D15/T-D15.5 — apply any actuation scheduled for exactly this tick
    // (spec §2.c: "applied at the START of the target tick's input phase",
    // before any gameplay phase reads input — this still runs before every
    // OTHER phase this tick, `input` being the first system phase). Placed
    // AFTER the tap-queue promotion immediately above (not before) so a
    // scheduled digital `true` can add itself to `virtualDigitalTapActive`
    // (see `applyScheduledActionsForTick`) without that promotion's
    // reassignment wiping it out.
    this.applyScheduledActionsForTick(servicedTick);

    if (!this.focused) {
      // #144 — enabled but blurred: everything ABOVE this line is machine
      // input (tap promotion, scheduled actuations) and stays live; real
      // devices below gate exactly as the old combined branch did (no
      // gamepads presented, edge sets frozen at their last real values).
      // The post-gate trace still records — "what the sim actually
      // consumed" includes machine input delivered while blurred.
      this.gamepads = [];
      this.recordPostGateTick(servicedTick);
      return;
    }

    this.gamepads =
      typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : [];

    // Gamepad button edge detection: diff this frame's pressed set against the
    // previous frame's so isJustPressed/isJustReleased work for gamepads too.
    const current = new Set<string>();
    for (let i = 0; i < this.gamepads.length; i++) {
      const gp = this.gamepads[i];
      if (!gp) continue;
      for (let b = 0; b < gp.buttons.length; b++) {
        if (gp.buttons[b]?.pressed) current.add(`${i}:${b}`);
      }
    }
    for (const key of current) {
      if (!this.gamepadButtonsPrev.has(key)) this.gamepadButtonsJustDown.add(key);
    }
    for (const key of this.gamepadButtonsPrev) {
      if (!current.has(key)) this.gamepadButtonsJustUp.add(key);
    }
    this.gamepadButtonsDown = current;
    // F4 — a button press is unambiguous real gamepad input.
    if (current.size > 0) this.lastActiveDevice = 'gamepad';

    // Snapshot this frame's raw axis values per (gamepad, axis) — independent
    // of any binding's direction/deadzone, mirroring the button snapshot
    // above. isPressed/isJustPressed/isJustReleased apply a binding's own
    // threshold to these raw values (current vs. `gamepadAxesPrev`) on read.
    const currentAxes = new Map<string, number>();
    // F4 — the deadzone THIS GAME declares on each axis, resolved once per poll
    // (see `declaredDeadzone`): an axis reading past the game's own rest
    // threshold is unambiguous real gamepad input; anything under it is the
    // resting noise every pad emits, and the game is already ignoring it.
    const axisDeadzone = new Map<number, number>();
    for (let i = 0; i < this.gamepads.length; i++) {
      const gp = this.gamepads[i];
      if (!gp) continue;
      for (let a = 0; a < gp.axes.length; a++) {
        const value = gp.axes[a] ?? 0;
        currentAxes.set(`${i}:${a}`, value);
        let deadzone = axisDeadzone.get(a);
        if (deadzone === undefined) {
          deadzone = this.declaredDeadzone(
            (binding) =>
              (binding.type === 'gamepad_axis' && binding.axis === a) ||
              (binding.type === 'gamepad_axis_pair' && (binding.xAxis === a || binding.yAxis === a))
                ? (binding.deadzone ?? GAMEPAD_AXIS_DEFAULT_DEADZONE)
                : undefined,
            GAMEPAD_AXIS_DEFAULT_DEADZONE,
          );
          axisDeadzone.set(a, deadzone);
        }
        if (Math.abs(value) > deadzone) this.lastActiveDevice = 'gamepad';
      }
    }
    this.gamepadAxesCurrent = currentAxes;

    // Inject look stick as continuous mouse delta (position → rate-of-rotation)
    if (this.lookStickX !== 0 || this.lookStickY !== 0) {
      const scale = 8;
      this.mouseDeltaX += this.lookStickX * scale;
      this.mouseDeltaY += this.lookStickY * scale;
    }
    // D15/T-D15.5 — tap the POST-GATE resolved values for this tick LAST
    // (every binding/virtual/scheduled contribution above has already been
    // folded in): "what the sim actually consumed", the honesty line the
    // design doc draws for record-now/replay-in-SP5 (§2.c).
    this.recordPostGateTick(servicedTick);
  }

  /**
   * D15/T-D15.5 — apply every actuation `scheduleActionAtTick` queued for
   * exactly `tick`, then forget them (a tick is serviced at most once).
   *
   * Digital `true` gets SPECIAL handling (the objection-1 fix): it promotes
   * the action into this tick's `virtualDigitalTapActive` set directly — the
   * same one-tick "active" pulse `tapVirtualAction` uses — so `isJustPressed`
   * reads true for EXACTLY this tick (false on the next, per `endFrame()`'s
   * clear) while `isPressed` keeps reading true afterward (still held) until
   * a later scheduled/explicit `false` releases it. This direct write is
   * safe here (unlike `applyVirtualActionValue`'s equivalent direct-path
   * case — see its doc comment) specifically because this method only ever
   * runs from inside `poll()`, AFTER `poll()`'s own tap-queue-promotion
   * reassignment of `virtualDigitalTapActive` has already happened for this
   * tick (see `poll()`'s own comment on why it's placed after) — so there's
   * no risk of this write being silently wiped by that reassignment.
   *
   * pulse-runner friction #4: a prior revision of this comment
   * used to say `setVirtualAction`'s plain write "never produces a
   * just-pressed edge at all" and that the edge fix landed ONLY here, for
   * this scheduled path — true at the time, and exactly the gap a blind
   * dogfood run (pulse-runner) hit through the direct `setVirtualAction`/
   * `holdFor` path. `applyVirtualActionValue` now manufactures the same kind
   * of edge for THAT path too (queued instead of written directly, for the
   * timing reason above) — this is no longer the only path that does.
   *
   * A digital `false` here simply releases the hold — no edge is
   * manufactured for it at a SCHEDULED tick (no caller needs a virtual
   * `isJustReleased` fired at an exact future tick today); the direct
   * `setVirtualAction(action, false)`/`clearVirtualActions()` paths DO
   * manufacture one now (see `applyVirtualActionValue`/
   * `clearVirtualActionState`). Scalar/vector2 values apply directly,
   * unchanged.
   */
  private applyScheduledActionsForTick(tick: number): void {
    const pending = this.scheduledActions.get(tick);
    if (!pending) return;
    this.scheduledActions.delete(tick);
    for (const entry of pending) {
      if (typeof entry.value === 'boolean') {
        if (entry.value) {
          this.virtualDigitalHeld.add(entry.action);
          this.virtualDigitalStrength.set(entry.action, 1);
          this.virtualDigitalTapActive.add(entry.action);
        } else {
          this.virtualDigitalHeld.delete(entry.action);
          this.virtualDigitalStrength.delete(entry.action);
        }
      } else {
        this.applyVirtualActionValue(entry.action, entry.value);
      }
    }
  }

  /** D15/T-D15.5 — append this tick's action-value DELTA to the recording
   *  ring, iff a recording is active. Reads every declared digital/scalar/
   *  vector2 action through the exact same typed getters gameplay code would
   *  (`readAction`), so the trace reflects what a component reading these
   *  actions THIS tick actually sees post-gate — never a raw/ungated value.
   *  `pointerDelta`/`pointerPosition` actions are skipped (a different,
   *  frame-accumulated shape, and not part of the virtual-action/schedule
   *  surface this trace exists to prove).
   *
   *  Two replay-affecting caveats a future SP5 consumer must know:
   *  1. A gated stretch never calls this at all (`poll()`'s gated branch
   *     returns before reaching it) — no entries are recorded for ticks
   *     input was suspended. Any change only OBSERVABLE once re-enabled (a
   *     delta against `lastTraceSnapshot`) lands as a delta AT the re-enable
   *     tick, not at whatever tick it actually happened.
   *  2. This ring is capped (`INPUT_TRACE_CAP`) and evicts via `shift()` once
   *     it fills — dropping the OLDEST entry. Because entries are DELTAS,
   *     evicting the earliest entries drops the base state later deltas were
   *     relative to — this ring is not safe to replay from its start once it
   *     has ever been capped. */
  private recordPostGateTick(tick: number): void {
    if (!this.inputRecording) return;
    const deltas: Record<string, boolean | number | { x: number; y: number }> = {};
    let changed = false;
    for (const name of this.actionNames()) {
      const type = this.getActionValueType(name);
      if (type !== 'digital' && type !== 'scalar' && type !== 'vector2') continue;
      const value = this.readAction(name, type);
      const prev = this.lastTraceSnapshot.get(name);
      if (actionValuesEqual(prev, value)) continue;
      deltas[name] = value;
      this.lastTraceSnapshot.set(name, value);
      changed = true;
    }
    if (!changed) return;
    this.inputTrace.push({ tick, actions: deltas });
    if (this.inputTrace.length > INPUT_TRACE_CAP) this.inputTrace.shift();
  }

  /** Has a `gamepad_axis` binding's raw value crossed its direction+deadzone
   *  threshold (positive: `value > deadzone`; negative: `value < -deadzone`)? */
  private static axisThresholdMet(
    value: number,
    direction: 'positive' | 'negative',
    deadzone: number,
  ): boolean {
    return direction === 'positive' ? value > deadzone : value < -deadzone;
  }

  /** Is an action currently held down? */
  isPressed(actionName: string): boolean {
    this.assertValueType(actionName, 'digital', 'isPressed');
    // Task 1.4 — a held virtual action, or a tap promoted to this frame's
    // "active" set, ORs into isPressed alongside binding contributions.
    if (this.virtualDigitalHeld.has(actionName) || this.virtualDigitalTapActive.has(actionName)) {
      return true;
    }
    const bindings = this.actions.get(actionName);
    if (!bindings) return false;

    for (const binding of bindings) {
      switch (binding.type) {
        case 'key':
          if (this.keysDown.has(binding.code)) return true;
          break;
        case 'mouse_button':
          if (this.mouseButtons.has(binding.button)) return true;
          break;
        case 'gamepad_button':
          for (const gp of this.gamepads) {
            if (gp?.buttons[binding.button]?.pressed) return true;
          }
          break;
        case 'gamepad_axis': {
          const dz = binding.deadzone ?? GAMEPAD_AXIS_DEFAULT_DEADZONE;
          for (const gp of this.gamepads) {
            if (!gp) continue;
            const val = gp.axes[binding.axis] ?? 0;
            if (InputManager.axisThresholdMet(val, binding.direction, dz)) return true;
          }
          break;
        }
        case 'touch_button':
          if (this.touchButtonsDown.has(binding.sourceId)) return true;
          break;
      }
    }
    return false;
  }

  /**
   * Processed strength for a declared digital action without creating a
   * second action-state store. Digital keys/buttons/touches contribute 1,
   * while a directional gamepad axis contributes Godot's deadzone-rescaled
   * magnitude. Multiple bindings combine by greatest strength, matching the
   * action state that {@link isPressed} reads as a boolean.
   */
  getDigitalStrength(actionName: string): number {
    this.assertValueType(actionName, 'digital', 'getDigitalStrength');
    if (
      this.machineInputActive &&
      (this.virtualDigitalHeld.has(actionName) || this.virtualDigitalTapActive.has(actionName))
    ) {
      return this.virtualDigitalStrength.get(actionName) ?? 1;
    }
    if (!this.inputActive) return 0;
    const bindings = this.actions.get(actionName);
    if (!bindings) return 0;

    let strength = 0;
    for (const binding of bindings) {
      switch (binding.type) {
        case 'key':
          if (this.keysDown.has(binding.code)) return 1;
          break;
        case 'mouse_button':
          if (this.mouseButtons.has(binding.button)) return 1;
          break;
        case 'gamepad_button':
          for (const gp of this.gamepads) {
            const button = gp?.buttons[binding.button];
            // Pinned InputEventJoypadButton::action_match reports 1 for a
            // pressed button and 0 otherwise; GamepadButton.value is not its
            // action strength.
            if (button?.pressed) return 1;
          }
          break;
        case 'gamepad_axis': {
          const deadzone = binding.deadzone ?? GAMEPAD_AXIS_DEFAULT_DEADZONE;
          for (const gp of this.gamepads) {
            if (!gp) continue;
            const raw = gp.axes[binding.axis] ?? 0;
            const directional = binding.direction === 'positive' ? raw : -raw;
            if (directional < deadzone) continue;
            strength = Math.max(
              strength,
              deadzone === 1
                ? 1
                : Math.min(1, Math.max(0, (directional - deadzone) / (1 - deadzone))),
            );
          }
          break;
        }
        case 'touch_button':
          if (this.touchButtonsDown.has(binding.sourceId)) return 1;
          break;
      }
    }
    return strength;
  }

  /** Raw (pre-deadzone) strength for a declared digital action. */
  getDigitalRawStrength(actionName: string): number {
    this.assertValueType(actionName, 'digital', 'getDigitalRawStrength');
    if (
      this.machineInputActive &&
      (this.virtualDigitalHeld.has(actionName) || this.virtualDigitalTapActive.has(actionName))
    ) {
      return this.virtualDigitalStrength.get(actionName) ?? 1;
    }
    if (!this.inputActive) return 0;
    const bindings = this.actions.get(actionName);
    if (!bindings) return 0;

    let strength = 0;
    for (const binding of bindings) {
      switch (binding.type) {
        case 'key':
          if (this.keysDown.has(binding.code)) return 1;
          break;
        case 'mouse_button':
          if (this.mouseButtons.has(binding.button)) return 1;
          break;
        case 'gamepad_button':
          if (this.gamepads.some((gp) => gp?.buttons[binding.button]?.pressed)) return 1;
          break;
        case 'gamepad_axis':
          for (const gp of this.gamepads) {
            if (!gp) continue;
            const raw = gp.axes[binding.axis] ?? 0;
            strength = Math.max(
              strength,
              Math.min(1, Math.max(0, binding.direction === 'positive' ? raw : -raw)),
            );
          }
          break;
        case 'touch_button':
          if (this.touchButtonsDown.has(binding.sourceId)) return 1;
          break;
      }
    }
    return strength;
  }

  /** Was an action pressed this frame (not held from previous)? */
  isJustPressed(actionName: string): boolean {
    this.assertValueType(actionName, 'digital', 'isJustPressed');
    // Task 1.4 — a tapVirtualAction() queued on a prior frame reads
    // just-pressed for exactly the one poll()/endFrame() bracket it was
    // promoted into (see poll()/endFrame() below).
    if (this.virtualDigitalTapActive.has(actionName)) return true;
    const bindings = this.actions.get(actionName);
    if (!bindings) return false;

    for (const binding of bindings) {
      switch (binding.type) {
        case 'key':
          if (this.keysJustDown.has(binding.code)) return true;
          break;
        case 'mouse_button':
          if (this.mouseButtonsJustDown.has(binding.button)) return true;
          break;
        case 'gamepad_button':
          // Edge-tracked in poll(): true only on the first frame the button
          // transitions from up→down (across any connected gamepad).
          for (let i = 0; i < this.gamepads.length; i++) {
            if (this.gamepadButtonsJustDown.has(`${i}:${binding.button}`)) return true;
          }
          break;
        case 'gamepad_axis': {
          // Edge-tracked via raw axis snapshots (poll()): true only on the
          // first frame the thresholded (direction+deadzone) boolean flips
          // from off→on (across any connected gamepad).
          const dz = binding.deadzone ?? GAMEPAD_AXIS_DEFAULT_DEADZONE;
          for (let i = 0; i < this.gamepads.length; i++) {
            const key = `${i}:${binding.axis}`;
            const now = this.gamepadAxesCurrent.get(key) ?? 0;
            const prev = this.gamepadAxesPrev.get(key) ?? 0;
            const nowOn = InputManager.axisThresholdMet(now, binding.direction, dz);
            const prevOn = InputManager.axisThresholdMet(prev, binding.direction, dz);
            if (nowOn && !prevOn) return true;
          }
          break;
        }
        case 'touch_button':
          if (this.touchButtonsJustDown.has(binding.sourceId)) return true;
          break;
      }
    }
    return false;
  }

  /** Was an action released this frame (held last frame, up now)? */
  isJustReleased(actionName: string): boolean {
    this.assertValueType(actionName, 'digital', 'isJustReleased');
    // pulse-runner friction #4 — mirrors isJustPressed's virtual check above:
    // a direct setVirtualAction(action, false) or clearVirtualActions() on a
    // held action manufactures exactly one just-released edge here, matching
    // a real key-up's keysJustUp.
    if (this.virtualDigitalJustReleased.has(actionName)) return true;
    const bindings = this.actions.get(actionName);
    if (!bindings) return false;

    for (const binding of bindings) {
      switch (binding.type) {
        case 'key':
          if (this.keysJustUp.has(binding.code)) return true;
          break;
        case 'mouse_button':
          if (this.mouseButtonsJustUp.has(binding.button)) return true;
          break;
        case 'gamepad_button':
          for (let i = 0; i < this.gamepads.length; i++) {
            if (this.gamepadButtonsJustUp.has(`${i}:${binding.button}`)) return true;
          }
          break;
        case 'gamepad_axis': {
          // The mirror of isJustPressed: true only on the first frame the
          // thresholded boolean flips from on→off.
          const dz = binding.deadzone ?? GAMEPAD_AXIS_DEFAULT_DEADZONE;
          for (let i = 0; i < this.gamepads.length; i++) {
            const key = `${i}:${binding.axis}`;
            const now = this.gamepadAxesCurrent.get(key) ?? 0;
            const prev = this.gamepadAxesPrev.get(key) ?? 0;
            const nowOn = InputManager.axisThresholdMet(now, binding.direction, dz);
            const prevOn = InputManager.axisThresholdMet(prev, binding.direction, dz);
            if (!nowOn && prevOn) return true;
          }
          break;
        }
        case 'touch_button':
          if (this.touchButtonsJustUp.has(binding.sourceId)) return true;
          break;
      }
    }
    return false;
  }

  /** Device/source metadata (F1 AC) for a digital action: which binding is
   *  CURRENTLY satisfying `isPressed`, or `null` if none is (including an
   *  unknown action). First-satisfied-binding-wins, mirroring isPressed's own
   *  iteration order. */
  getDigitalSource(actionName: string): ActionValueSource | null {
    this.assertValueType(actionName, 'digital', 'getDigitalSource');
    // #144 — mirror isPressed's own pre-gate virtual check: a machine-held
    // action reports its source even while the window is blurred.
    if (
      this.machineInputActive &&
      (this.virtualDigitalHeld.has(actionName) || this.virtualDigitalTapActive.has(actionName))
    ) {
      return { bindingType: 'virtual' };
    }
    if (!this.inputActive) return null;
    const bindings = this.actions.get(actionName);
    if (!bindings) return null;
    for (const binding of bindings) {
      switch (binding.type) {
        case 'key':
          if (this.keysDown.has(binding.code)) return { bindingType: 'key' };
          break;
        case 'mouse_button':
          if (this.mouseButtons.has(binding.button)) return { bindingType: 'mouse_button' };
          break;
        case 'gamepad_button':
          for (let i = 0; i < this.gamepads.length; i++) {
            const gp = this.gamepads[i];
            if (gp?.buttons[binding.button]?.pressed) {
              return { bindingType: 'gamepad_button', gamepadIndex: i, gamepadId: gp.id };
            }
          }
          break;
        case 'gamepad_axis': {
          const dz = binding.deadzone ?? GAMEPAD_AXIS_DEFAULT_DEADZONE;
          for (let i = 0; i < this.gamepads.length; i++) {
            const gp = this.gamepads[i];
            if (!gp) continue;
            const val = gp.axes[binding.axis] ?? 0;
            if (InputManager.axisThresholdMet(val, binding.direction, dz)) {
              return { bindingType: 'gamepad_axis', gamepadIndex: i, gamepadId: gp.id };
            }
          }
          break;
        }
        case 'touch_button':
          if (this.touchButtonsDown.has(binding.sourceId)) {
            return { bindingType: 'touch_button', sourceId: binding.sourceId };
          }
          break;
      }
    }
    return null;
  }

  // ==========================================================================
  // F1 — typed scalar/vector2/pointer reads. See the class doc comment above
  // for the deadzone/normalize/combine rules these implement.
  // ==========================================================================

  /** 1D deadzone rescale: magnitudes below `deadzone` become 0; magnitudes
   *  at/above it rescale from 0 (at the deadzone edge) to ±1 (at |raw| = 1),
   *  sign preserved. `raw` is clamped to [-1, 1] first so an out-of-range
   *  input can't overshoot past ±1 the other end. */
  private static rescaleScalar(raw: number, deadzone: number): number {
    const clamped = Math.max(-1, Math.min(1, raw));
    const mag = Math.abs(clamped);
    if (mag < deadzone) return 0;
    const rescaled = deadzone >= 1 ? 0 : (mag - deadzone) / (1 - deadzone);
    return Math.sign(clamped) * Math.min(1, rescaled);
  }

  /** Radial deadzone + unit-circle normalization for a Vector2: magnitude
   *  below `deadzone` snaps to {0,0}; at/above it, direction is preserved and
   *  magnitude is rescaled the same way `rescaleScalar` rescales a 1D
   *  magnitude (never renormalized UP past 1 — only ever scaled down). */
  private static rescaleVector2(raw: Vector2, deadzone: number): Vector2 {
    const mag = Math.hypot(raw.x, raw.y);
    if (mag === 0 || mag < deadzone) return { x: 0, y: 0 };
    const rescaledMag = Math.min(1, deadzone >= 1 ? 0 : (mag - deadzone) / (1 - deadzone));
    const scale = rescaledMag / mag;
    return { x: raw.x * scale, y: raw.y * scale };
  }

  /** Clamp a Vector2's magnitude to at most 1 (unit circle), preserving
   *  direction — the second half of the vector2 "sum-then-clamp" combine
   *  rule (a diagonal sum like {0.8, 0.8} has magnitude > 1). */
  private static clampVector2(v: Vector2): Vector2 {
    const mag = Math.hypot(v.x, v.y);
    if (mag <= 1 || mag === 0) return v;
    return { x: v.x / mag, y: v.y / mag };
  }

  /** Every `scalar`-relevant binding's (deadzone-applied) contribution for
   *  `actionName`, one entry per binding that can produce a scalar value —
   *  `gamepad_axis` (real device, already implemented pre-F1 for digital
   *  thresholding — F1 additionally reads its raw signed value for scalar
   *  actions, ignoring the binding's `direction` field, which is a digital-
   *  only hint) and `test_axis` (F1's injected-test-input source). `mouse_move`
   *  deliberately does NOT feed scalar (spec §12 F2 — no natural single-axis
   *  selector field is defined for it; it feeds pointerDelta/vector2 only —
   *  see `collectPointerDeltaContributions`/`collectVector2Contributions`). */
  private collectScalarContributions(
    actionName: string,
  ): { value: number; source: ActionValueSource }[] {
    const out: { value: number; source: ActionValueSource }[] = [];
    // Task 1.4 — a virtual scalar value joins the same max-magnitude combine
    // real bindings do (computeScalar below). #144: it passes the MACHINE
    // gate (enabled only), so a bot's held value reads through while the
    // window is blurred; real bindings below keep the full focus gate.
    const virtual = this.virtualScalarValues.get(actionName);
    if (virtual !== undefined && this.machineInputActive) {
      out.push({ value: virtual, source: { bindingType: 'virtual' } });
    }
    if (!this.inputActive) return out;
    const bindings = this.actions.get(actionName);
    if (!bindings) return out;
    for (const binding of bindings) {
      if (binding.type === 'gamepad_axis') {
        const dz = binding.deadzone ?? GAMEPAD_AXIS_DEFAULT_DEADZONE;
        for (let i = 0; i < this.gamepads.length; i++) {
          const gp = this.gamepads[i];
          if (!gp) continue;
          const raw = gp.axes[binding.axis] ?? 0;
          out.push({
            value: InputManager.rescaleScalar(raw, dz),
            source: { bindingType: 'gamepad_axis', gamepadIndex: i, gamepadId: gp.id },
          });
        }
      } else if (binding.type === 'test_axis') {
        const raw = this.testAxisValues.get(binding.sourceId) ?? 0;
        out.push({
          value: InputManager.rescaleScalar(raw, binding.deadzone ?? 0),
          source: { bindingType: 'test_axis', sourceId: binding.sourceId },
        });
      }
    }
    return out;
  }

  private computeScalar(actionName: string): { value: number; source: ActionValueSource | null } {
    this.assertValueType(actionName, 'scalar', 'getScalar');
    let best: { value: number; source: ActionValueSource } | null = null;
    for (const c of this.collectScalarContributions(actionName)) {
      if (!best || Math.abs(c.value) > Math.abs(best.value)) best = c;
    }
    if (!best || best.value === 0) return { value: 0, source: null };
    return best;
  }

  /** Read a `'scalar'`-valueType action's current value: max-magnitude across
   *  contributing (deadzone-applied) bindings, sign preserved (combine rule —
   *  see the class doc comment). Throws if the action is declared a
   *  different valueType. */
  getScalar(actionName: string): number {
    return this.computeScalar(actionName).value;
  }

  /** Device/source metadata for {@link getScalar} — which binding is
   *  currently driving the combined value, or `null` if every contribution is
   *  zero (including an unknown action). */
  getScalarSource(actionName: string): ActionValueSource | null {
    return this.computeScalar(actionName).source;
  }

  /** `gamepad_axis_pair` contribution(s) for {@link collectVector2Contributions} — one entry
   *  per connected gamepad, deadzone-rescaled (default 0.15, matching `gamepad_axis`). Broken
   *  out to a helper so the per-gamepad loop doesn't add to the main dispatcher's complexity. */
  private contributeGamepadAxisPair(
    binding: Extract<InputBinding, { type: 'gamepad_axis_pair' }>,
  ): { value: Vector2; source: ActionValueSource }[] {
    const dz = binding.deadzone ?? GAMEPAD_AXIS_DEFAULT_DEADZONE;
    const out: { value: Vector2; source: ActionValueSource }[] = [];
    for (let i = 0; i < this.gamepads.length; i++) {
      const gp = this.gamepads[i];
      if (!gp) continue;
      const raw = { x: gp.axes[binding.xAxis] ?? 0, y: gp.axes[binding.yAxis] ?? 0 };
      out.push({
        value: InputManager.rescaleVector2(raw, dz),
        source: { bindingType: 'gamepad_axis_pair', gamepadIndex: i, gamepadId: gp.id },
      });
    }
    return out;
  }

  /** Every `vector2`-relevant binding's (deadzone-applied) contribution:
   *  `test_vector2` (F1's injected-test-input source), plus F2's real-device
   *  cases — `gamepad_axis_pair` (see {@link contributeGamepadAxisPair}), `mouse_move` (the
   *  accumulated mouse delta, deadzone default 0 — raw pixel deltas have no natural "at rest"
   *  jitter floor the way an analog stick does), and `touch_stick` (a virtual on-screen stick,
   *  deadzone default 0). */
  private collectVector2Contributions(
    actionName: string,
  ): { value: Vector2; source: ActionValueSource }[] {
    const out: { value: Vector2; source: ActionValueSource }[] = [];
    // Task 1.4 — a virtual vector2 value joins the same sum-then-clamp
    // combine real bindings do (computeVector2 below). #144: machine gate
    // only, same as the scalar collector above.
    const virtual = this.virtualVector2Values.get(actionName);
    if (virtual !== undefined && this.machineInputActive) {
      out.push({ value: virtual, source: { bindingType: 'virtual' } });
    }
    if (!this.inputActive) return out;
    const bindings = this.actions.get(actionName);
    if (!bindings) return out;
    for (const binding of bindings) {
      switch (binding.type) {
        case 'test_vector2': {
          const raw = this.testVector2Values.get(binding.sourceId) ?? { x: 0, y: 0 };
          out.push({
            value: InputManager.rescaleVector2(raw, binding.deadzone ?? 0),
            source: { bindingType: 'test_vector2', sourceId: binding.sourceId },
          });
          break;
        }
        case 'gamepad_axis_pair':
          out.push(...this.contributeGamepadAxisPair(binding));
          break;
        case 'mouse_move': {
          const raw = { x: this.mouseDeltaX, y: this.mouseDeltaY };
          out.push({
            value: InputManager.rescaleVector2(raw, binding.deadzone ?? 0),
            source: { bindingType: 'mouse_move' },
          });
          break;
        }
        case 'touch_stick': {
          const raw = this.touchStickValues.get(binding.sourceId) ?? { x: 0, y: 0 };
          out.push({
            value: InputManager.rescaleVector2(
              raw,
              binding.deadzone ?? TOUCH_STICK_DEFAULT_DEADZONE,
            ),
            source: { bindingType: 'touch_stick', sourceId: binding.sourceId },
          });
          break;
        }
      }
    }
    return out;
  }

  private computeVector2(actionName: string): { value: Vector2; source: ActionValueSource | null } {
    this.assertValueType(actionName, 'vector2', 'getVector2');
    let sum: Vector2 = { x: 0, y: 0 };
    let bestSource: ActionValueSource | null = null;
    let bestMag = 0;
    for (const c of this.collectVector2Contributions(actionName)) {
      sum = { x: sum.x + c.value.x, y: sum.y + c.value.y };
      const mag = Math.hypot(c.value.x, c.value.y);
      if (mag > bestMag) {
        bestMag = mag;
        bestSource = c.source;
      }
    }
    const clamped = InputManager.clampVector2(sum);
    if (clamped.x === 0 && clamped.y === 0) return { value: clamped, source: null };
    return { value: clamped, source: bestSource };
  }

  /** Read a `'vector2'`-valueType action's current value: sum contributing
   *  (deadzone-applied) {x,y} values component-wise, then clamp to the unit
   *  circle (combine rule — see the class doc comment). Throws if the action
   *  is declared a different valueType. */
  getVector2(actionName: string): Vector2 {
    return this.computeVector2(actionName).value;
  }

  /** Device/source metadata for {@link getVector2} — the contributing binding
   *  with the largest (pre-combine) magnitude, or `null` if the combined
   *  value is {0,0} (including an unknown action). */
  getVector2Source(actionName: string): ActionValueSource | null {
    return this.computeVector2(actionName).source;
  }

  /** Every `pointerDelta`-relevant binding's contribution: `test_pointer_delta`
   *  (F1's injected-test-input source) and — F2 — `mouse_move`, reading the
   *  real accumulated `mouseDeltaX/Y` (the same accumulator `onMouseMove`
   *  fills and `getMouseDelta()` reads). No deadzone for either (deltas are
   *  not deadzoned). */
  private collectPointerDeltaContributions(
    actionName: string,
  ): { value: Vector2; source: ActionValueSource }[] {
    if (!this.inputActive) return [];
    const bindings = this.actions.get(actionName);
    if (!bindings) return [];
    const out: { value: Vector2; source: ActionValueSource }[] = [];
    for (const binding of bindings) {
      if (binding.type === 'test_pointer_delta') {
        const value = this.testPointerDeltaAccum.get(binding.sourceId) ?? { x: 0, y: 0 };
        out.push({
          value,
          source: { bindingType: 'test_pointer_delta', sourceId: binding.sourceId },
        });
      } else if (binding.type === 'mouse_move') {
        out.push({
          value: { x: this.mouseDeltaX, y: this.mouseDeltaY },
          source: { bindingType: 'mouse_move' },
        });
      }
    }
    return out;
  }

  private computePointerDelta(actionName: string): {
    value: Vector2;
    source: ActionValueSource | null;
  } {
    this.assertValueType(actionName, 'pointerDelta', 'getPointerDelta');
    let sum: Vector2 = { x: 0, y: 0 };
    let bestSource: ActionValueSource | null = null;
    let bestMag = 0;
    for (const c of this.collectPointerDeltaContributions(actionName)) {
      sum = { x: sum.x + c.value.x, y: sum.y + c.value.y };
      const mag = Math.hypot(c.value.x, c.value.y);
      if (mag > bestMag) {
        bestMag = mag;
        bestSource = c.source;
      }
    }
    if (sum.x === 0 && sum.y === 0) return { value: sum, source: null };
    return { value: sum, source: bestSource };
  }

  /** Read a `'pointerDelta'`-valueType action's this-frame movement: sum of
   *  contributing bindings' deltas (combine rule — see the class doc
   *  comment). Throws if the action is declared a different valueType. */
  getPointerDelta(actionName: string): Vector2 {
    return this.computePointerDelta(actionName).value;
  }

  /** Device/source metadata for {@link getPointerDelta}. */
  getPointerDeltaSource(actionName: string): ActionValueSource | null {
    return this.computePointerDelta(actionName).source;
  }

  /** Every `pointerPosition`-relevant binding's contribution, each tagged
   *  with the injection-order sequence number used to break ties (last-
   *  write-wins) — today only `test_pointer_position` (F1's injected-test-
   *  input source). */
  private collectPointerPositionContributions(
    actionName: string,
  ): { value: Vector2; seq: number; source: ActionValueSource }[] {
    if (!this.inputActive) return [];
    const bindings = this.actions.get(actionName);
    if (!bindings) return [];
    const out: { value: Vector2; seq: number; source: ActionValueSource }[] = [];
    for (const binding of bindings) {
      if (binding.type === 'test_pointer_position') {
        const entry = this.testPointerPositionValues.get(binding.sourceId);
        if (entry) {
          out.push({
            value: entry.value,
            seq: entry.seq,
            source: { bindingType: 'test_pointer_position', sourceId: binding.sourceId },
          });
        }
      }
    }
    return out;
  }

  private computePointerPosition(actionName: string): {
    value: Vector2;
    source: ActionValueSource | null;
  } {
    this.assertValueType(actionName, 'pointerPosition', 'getPointerPosition');
    const contributions = this.collectPointerPositionContributions(actionName);
    if (contributions.length === 0) return { value: { x: 0, y: 0 }, source: null };
    let best = contributions[0]!;
    for (const c of contributions) {
      if (c.seq > best.seq) best = c;
    }
    return { value: best.value, source: best.source };
  }

  /** Read a `'pointerPosition'`-valueType action's current absolute position:
   *  last-write-wins across contributing bindings (combine rule — see the
   *  class doc comment; position isn't additive, so it is never summed).
   *  Throws if the action is declared a different valueType. */
  getPointerPosition(actionName: string): Vector2 {
    return this.computePointerPosition(actionName).value;
  }

  /** Device/source metadata for {@link getPointerPosition} — the most
   *  recently-written contributing source. */
  getPointerPositionSource(actionName: string): ActionValueSource | null {
    return this.computePointerPosition(actionName).source;
  }

  /** Generic typed read (F1): dispatches to the matching typed getter based
   *  on `expectedType`, returning `ActionValueOf<T>` — a caller with a
   *  statically-known action-value-type map gets a fully-inferred, non-`any`
   *  return type. Throws the same mismatch error as the dedicated getters if
   *  the action's declared valueType disagrees with `expectedType`. */
  readAction<T extends ActionValueType>(actionName: string, expectedType: T): ActionValueOf<T> {
    switch (expectedType) {
      case 'digital':
        return this.isPressed(actionName) as ActionValueOf<T>;
      case 'scalar':
        return this.getScalar(actionName) as ActionValueOf<T>;
      case 'vector2':
        return this.getVector2(actionName) as ActionValueOf<T>;
      case 'pointerDelta':
        return this.getPointerDelta(actionName) as ActionValueOf<T>;
      case 'pointerPosition':
        return this.getPointerPosition(actionName) as ActionValueOf<T>;
      default:
        throw new Error(`InputManager.readAction: unknown value type "${expectedType as string}"`);
    }
  }

  /** Inject a synthetic scalar value for a named test source (F1's injected-
   *  test-input hook — also the shape of F2's "injected test input" backend).
   *  Bind an action to `{ type: 'test_axis', sourceId }` (`valueType:
   *  'scalar'`) to read it back via {@link getScalar}. The value PERSISTS
   *  across frames (like a real analog stick held in position) until changed
   *  or cleared via {@link clearAxis}. */
  injectAxis(sourceId: string, value: number): void {
    this.testAxisValues.set(sourceId, value);
  }

  /** Clear an injected scalar source (e.g. simulating an at-rest/disconnected
   *  device). */
  clearAxis(sourceId: string): void {
    this.testAxisValues.delete(sourceId);
  }

  /** Inject a synthetic {x,y} value for a named test source. Bind an action
   *  to `{ type: 'test_vector2', sourceId }` (`valueType: 'vector2'`) to read
   *  it back via {@link getVector2}. Persists across frames until changed or
   *  cleared via {@link clearVector2}. */
  injectVector2(sourceId: string, value: Vector2): void {
    this.testVector2Values.set(sourceId, value);
  }

  /** Clear an injected Vector2 source. */
  clearVector2(sourceId: string): void {
    this.testVector2Values.delete(sourceId);
  }

  /** Accumulate a synthetic pointer delta for a named test source — mirrors
   *  real mouse-move delta accumulation (`onMouseMove` above): multiple calls
   *  within the same frame sum, and the accumulator is cleared in
   *  {@link endFrame}. Bind an action to `{ type: 'test_pointer_delta',
   *  sourceId }` (`valueType: 'pointerDelta'`) to read it back via
   *  {@link getPointerDelta}. */
  injectPointerDelta(sourceId: string, delta: Vector2): void {
    const prev = this.testPointerDeltaAccum.get(sourceId) ?? { x: 0, y: 0 };
    this.testPointerDeltaAccum.set(sourceId, { x: prev.x + delta.x, y: prev.y + delta.y });
  }

  /** Set a synthetic absolute pointer position for a named test source.
   *  Persists (last-write-wins across contributing sources on read — see the
   *  pointerPosition combine rule) until changed. Bind an action to `{ type:
   *  'test_pointer_position', sourceId }` (`valueType: 'pointerPosition'`) to
   *  read it back via {@link getPointerPosition}. */
  injectPointerPosition(sourceId: string, value: Vector2): void {
    this.testPointerPositionValues.set(sourceId, { value, seq: ++this.pointerPositionSeq });
  }

  /** Whether input capture is currently enabled (see {@link setEnabled}). */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable/disable input capture. The editor host disables the running game's
   * input while its viewport isn't focused so keystrokes don't leak in from
   * the editor. Disabling clears all held/transient keyboard/mouse/touch-button
   * state (via {@link flushHeldState}) so nothing sticks (e.g. a held movement
   * key when you switch back to the Scene tab mid-flight) — gamepad state
   * doesn't need clearing here since `poll()` itself stops reading it while
   * disabled (see poll()'s doc comment).
   */
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.flushHeldState();
  }

  /** Whether the window/tab is currently focused (F2, spec §12 "focus
   *  gating") — `false` while blurred (real `blur`/`focus` events; see the
   *  constructor). Distinct from {@link isEnabled}, which is the editor's
   *  explicit play-mode gate. */
  isFocused(): boolean {
    return this.focused;
  }

  /**
   * The gate every REAL-DEVICE listener here passes: {@link isEnabled} AND
   * {@link isFocused}. Public because the DOM edge this class deliberately
   * does not own — `host-pointer.ts`, the pointer stream behind the touch
   * backends — must pass the SAME gate, and a caller writing
   * `isEnabled() && isFocused()` out for itself is how a looser one drifts in
   * (a pointer adapter that checked only `isEnabled` kept updating position
   * for a blurred tab). Read it; do not recompose it.
   *
   * Machine input (`setVirtualAction` and the tick-scheduled actuations) is
   * deliberately NOT this gate — see `machineInputActive`.
   */
  isInputActive(): boolean {
    return this.inputActive;
  }

  /** Whether the pointer is currently locked to {@link requestPointerLock}'s
   *  element (F2, spec §12 "pointer lock") — tracked via the real
   *  `pointerlockchange` event. */
  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** Device identity for a connected gamepad slot (F2, spec §12 "expose
   *  device identity" + "prefer the standard mapping"), or `null` if nothing
   *  is connected at `index` (including while input is disabled/unfocused,
   *  since `poll()` empties `this.gamepads` then). `mapping` is the Gamepad
   *  API's own `'standard'`/`''` value — bindings author button/axis indices
   *  assuming the W3C Standard Gamepad layout, so a non-`'standard'` mapping
   *  means those indices may not correspond as documented. */
  getGamepadInfo(
    index: number,
  ): { index: number; id: string; mapping: string; connected: boolean } | null {
    const gp = this.gamepads[index];
    if (!gp) return null;
    return { index, id: gp.id, mapping: gp.mapping, connected: gp.connected };
  }

  /** Get mouse movement delta this frame */
  getMouseDelta(): { x: number; y: number } {
    return { x: this.mouseDeltaX, y: this.mouseDeltaY };
  }

  /**
   * Device-poll door (not an action binding). Every getter checks
   * {@link inputActive} at READ time so a poll while play is off or the
   * tab is unfocused is inert — the same predicate `onKeyDown` / `onMouseMove`
   * already use. Inventing an implicit `registerAction` per key would define
   * bindings the project's own `.inputmap` never named.
   */
  isDeviceKeyPressed(code: string): boolean {
    if (!this.inputActive) return false;
    return this.keysDown.has(code);
  }

  isDeviceKeyJustPressed(code: string): boolean {
    if (!this.inputActive) return false;
    return this.keysJustDown.has(code);
  }

  isDeviceKeyJustReleased(code: string): boolean {
    if (!this.inputActive) return false;
    return this.keysJustUp.has(code);
  }

  /** `button` is the DOM `MouseEvent.button` index (0 left, 1 middle, 2 right). */
  isDeviceMouseButtonPressed(button: number): boolean {
    if (!this.inputActive) return false;
    return this.mouseButtons.has(button);
  }

  isDeviceMouseButtonJustPressed(button: number): boolean {
    if (!this.inputActive) return false;
    return this.mouseButtonsJustDown.has(button);
  }

  isDeviceMouseButtonJustReleased(button: number): boolean {
    if (!this.inputActive) return false;
    return this.mouseButtonsJustUp.has(button);
  }

  /**
   * This-frame mouse delta in DOM space (Y +down). Callers that need Unity
   * `Pointer.delta` (Y-up) flip Y themselves.
   */
  getDeviceMouseDelta(): { x: number; y: number } {
    if (!this.inputActive) return { x: 0, y: 0 };
    return { x: this.mouseDeltaX, y: this.mouseDeltaY };
  }

  /** Last `mousemove` client position in DOM space (origin top-left, Y +down). */
  getDeviceMousePosition(): { x: number; y: number } {
    if (!this.inputActive) return { x: 0, y: 0 };
    return { x: this.mouseClientX, y: this.mouseClientY };
  }

  hasDeviceGamepad(): boolean {
    if (!this.inputActive) return false;
    return this.gamepads.some((pad) => pad !== null);
  }

  /** Connected W3C Gamepad indices in native slot order, gated by the same play/focus state as
   * every other raw device poll. Foreign-engine adapters use their own collection value type. */
  getConnectedGamepadIndices(): number[] {
    if (!this.inputActive) return [];
    const indices: number[] = [];
    for (let index = 0; index < this.gamepads.length; index += 1) {
      if (this.gamepads[index] !== null) indices.push(index);
    }
    return indices;
  }

  isDeviceGamepadButtonPressed(button: number): boolean {
    if (!this.inputActive) return false;
    const index = this.firstConnectedGamepadIndex();
    if (index < 0) return false;
    return this.gamepadButtonsDown.has(`${index}:${button}`);
  }

  /** Raw button state for one explicit native Gamepad slot. */
  isDeviceGamepadButtonPressedAt(index: number, button: number): boolean {
    if (!this.inputActive) return false;
    if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(button) || button < 0) {
      return false;
    }
    return this.gamepads[index]?.buttons[button]?.pressed ?? false;
  }

  isDeviceGamepadButtonJustPressed(button: number): boolean {
    if (!this.inputActive) return false;
    const index = this.firstConnectedGamepadIndex();
    if (index < 0) return false;
    return this.gamepadButtonsJustDown.has(`${index}:${button}`);
  }

  isDeviceGamepadButtonJustReleased(button: number): boolean {
    if (!this.inputActive) return false;
    const index = this.firstConnectedGamepadIndex();
    if (index < 0) return false;
    return this.gamepadButtonsJustUp.has(`${index}:${button}`);
  }

  /**
   * The RAW `Gamepad.axes[axis]` of the first connected pad, gated on `inputActive`.
   *
   * Deliberately un-deadzoned, and it must stay that way. The engine's own stick deadzone lives on
   * the ACTION path (`gamepad_axis` / `gamepad_axis_pair`, default
   * `GAMEPAD_AXIS_DEFAULT_DEADZONE`), where a game declares it and can override it per binding.
   * This door exists for a caller that must apply a DIFFERENT rule — every foreign-engine compat
   * lane does: Unity's `Gamepad.leftStick` carries a `StickDeadzone` processor with its own
   * 0.125/0.925 (`unity-compat/input-system-device.ts` reproduces it), and Godot's `get_axis`
   * has its own. Baking one engine's constants in here would silently give every other lane the
   * wrong feel under its own API name.
   *
   * So: a caller that wants "a stick" wants a deadzone and must say WHOSE. A caller that wants
   * the hardware number calls this.
   */
  getDeviceGamepadAxis(axis: number): number {
    if (!this.inputActive) return 0;
    const index = this.firstConnectedGamepadIndex();
    if (index < 0) return 0;
    return this.gamepads[index]?.axes[axis] ?? 0;
  }

  /** Raw axis value for one explicit native Gamepad slot. */
  getDeviceGamepadAxisAt(index: number, axis: number): number {
    if (!this.inputActive) return 0;
    if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(axis) || axis < 0) {
      return 0;
    }
    return this.gamepads[index]?.axes[axis] ?? 0;
  }

  private firstConnectedGamepadIndex(): number {
    for (let i = 0; i < this.gamepads.length; i++) {
      if (this.gamepads[i] !== null) return i;
    }
    return -1;
  }

  /**
   * F4 (spec §12 "Schema and Examples" — the F3 prompt-switching gap): which
   * device family most recently produced real input, or `null` before any
   * input has arrived. A prompt UI polls this (or lets {@link getPrompt}
   * consult it automatically by omitting `device`) to switch its displayed
   * label as the player switches controllers — e.g. showing `'Space'` while
   * they're on keyboard, then `'A'` the moment they touch a gamepad.
   */
  getLastActiveDevice(): PromptDevice | null {
    return this.lastActiveDevice;
  }

  // ==========================================================================
  // F3 — rebinding: list/replace/add/remove/reset/persist. See the class doc
  // comment above for the full design note.
  // ==========================================================================

  /** The current bindings for `actionName` (F3 AC "listed") — a defensive
   *  deep clone, so mutating the returned array/objects never affects the
   *  live binding list. `[]` for an unknown/never-registered action. */
  getBindings(actionName: string): InputBinding[] {
    const bindings = this.actions.get(actionName);
    return bindings ? structuredClone(bindings) : [];
  }

  /** Wholesale-replace `actionName`'s bindings array (F3 AC "replaced"). Does
   *  NOT touch the reset-to-defaults snapshot — see `resetBindings`. A no-op
   *  target for an action that was never registered is allowed (it simply
   *  registers one with `valueType: 'digital'`, matching `registerAction`'s
   *  own default) since a rebinding UI operates on actions it already knows
   *  about, but shouldn't have to special-case "brand new action" separately. */
  setBindings(actionName: string, bindings: InputBinding[]): void {
    if (!this.actionValueTypes.has(actionName)) this.actionValueTypes.set(actionName, 'digital');
    this.actions.set(actionName, structuredClone(bindings));
  }

  /** Append one binding to `actionName` (F3 AC "added"). */
  addBinding(actionName: string, binding: InputBinding): void {
    const bindings = this.actions.get(actionName) ?? [];
    this.actions.set(actionName, [...bindings, structuredClone(binding)]);
    if (!this.actionValueTypes.has(actionName)) this.actionValueTypes.set(actionName, 'digital');
  }

  /** Remove the binding at `index` from `actionName` (F3 AC "removed"). A
   *  no-op if the action is unknown or `index` is out of range (rather than
   *  throwing) — mirrors every other getter's "unknown action is inert"
   *  convention, so a UI doesn't need a separate existence check first. */
  removeBinding(actionName: string, index: number): void {
    const bindings = this.actions.get(actionName);
    if (!bindings || index < 0 || index >= bindings.length) return;
    this.actions.set(actionName, [...bindings.slice(0, index), ...bindings.slice(index + 1)]);
  }

  /** Replace a single binding slot at `index` on `actionName` — the shape a
   *  rebinding UI actually wants ("rebind THIS control"), built on
   *  `getBindings`/`setBindings`. A no-op if the action is unknown or `index`
   *  is out of range. */
  replaceBinding(actionName: string, index: number, binding: InputBinding): void {
    const bindings = this.actions.get(actionName);
    if (!bindings || index < 0 || index >= bindings.length) return;
    const next = bindings.slice();
    next[index] = structuredClone(binding);
    this.actions.set(actionName, next);
  }

  /** Restore `actionName`'s bindings to the snapshot taken at
   *  `registerAction`/`loadMap`/`loadMapObject` time (F3 AC "reset"). A no-op
   *  for an action with no snapshot (never registered/loaded — there is no
   *  "default" to reset to). */
  resetBindings(actionName: string): void {
    const defaults = this.defaultBindings.get(actionName);
    if (!defaults) return;
    this.actions.set(actionName, structuredClone(defaults));
  }

  /** Reset every action that has a snapshot back to its registered/loaded
   *  defaults. Convenience batch form of `resetBindings`. */
  resetAllBindings(): void {
    for (const actionName of this.defaultBindings.keys()) this.resetBindings(actionName);
  }

  /**
   * Every EXISTING binding, on every OTHER registered action, that is
   * structurally the same physical input as `proposed` (F3 AC "conflicts are
   * detected and returned structurally") — never throws, always a plain
   * (possibly empty) array a rebinding UI inspects before committing a
   * rebind. `excludeActionName` is normally the action being rebound itself
   * (so an action isn't reported as conflicting with its own current
   * binding when re-proposing an unchanged value).
   */
  findConflicts(proposed: InputBinding, excludeActionName?: string): BindingConflict[] {
    const conflicts: BindingConflict[] = [];
    for (const [actionName, bindings] of this.actions) {
      if (actionName === excludeActionName) continue;
      bindings.forEach((binding, bindingIndex) => {
        if (inputBindingsCollide(proposed, binding)) {
          conflicts.push({ actionName, bindingIndex, binding: structuredClone(binding) });
        }
      });
    }
    return conflicts;
  }

  /**
   * Serialize every registered/loaded action back into the `.inputmap.json`
   * document shape (F3 AC "persisted") — the exact `InputMapFile` shape
   * `loadMap`/`loadMapObject` read, so `manager.loadMapObject(manager.toInputMapFile())`
   * on a fresh instance reproduces the same live bindings. `version` is
   * carried forward from the last loaded map when known, else `1` (a
   * manager built purely via `registerAction` calls, never `loadMap`, has no
   * file-format version to preserve).
   */
  toInputMapFile(): InputMapFile {
    const actions: InputMapFile['actions'] = {};
    for (const [name, bindings] of this.actions) {
      actions[name] = {
        valueType: this.actionValueTypes.get(name) ?? 'digital',
        bindings: structuredClone(bindings),
      };
    }
    return { version: this.loadedMapVersion, actions };
  }

  /**
   * Resolve a display prompt (F3 AC: labels/icons like `'Space'`, `'A'`, or a
   * touch control's name) for whichever of `actionName`'s bindings belongs to
   * the requested `device` family. `null` when the action has no binding for
   * that device (including an unknown action). `gamepadIndex` (default 0)
   * selects which connected pad's `mapping`/connected state to consult for a
   * `gamepad_*` binding — see `getGamepadInfo`.
   *
   * F4 — `device` is now OPTIONAL: omit it (or pass `undefined`) to resolve
   * against {@link getLastActiveDevice} instead (falling back to `'keyboard'`
   * before any input has arrived), so a prompt UI that wants "show whatever
   * the player is actually holding right now" doesn't have to track the
   * active device itself — it can just call `getPrompt(actionName)` every
   * frame and the label switches on its own as the player changes controllers.
   * Passing an explicit `device` (as every pre-F4 caller does) is unaffected.
   */
  getPrompt(actionName: string, device?: PromptDevice, gamepadIndex = 0): BindingPrompt | null {
    const resolvedDevice = device ?? this.lastActiveDevice ?? 'keyboard';
    const bindings = this.actions.get(actionName);
    if (!bindings) return null;
    const binding = bindings.find((b) => bindingDeviceFamily(b.type) === resolvedDevice);
    if (!binding) return null;

    switch (binding.type) {
      case 'key':
        return {
          device: 'keyboard',
          bindingType: 'key',
          label: keyLabel(binding.code),
          icon: keyLabel(binding.code),
        };
      case 'mouse_button':
        return {
          device: 'mouse',
          bindingType: 'mouse_button',
          label: mouseButtonLabel(binding.button),
          icon: 'mouse',
        };
      case 'mouse_move':
        return { device: 'mouse', bindingType: 'mouse_move', label: 'Mouse', icon: 'mouse' };
      case 'gamepad_button': {
        const info = this.getGamepadInfo(gamepadIndex);
        if (!info?.connected) {
          return {
            device: 'gamepad',
            bindingType: 'gamepad_button',
            label: 'Gamepad Disconnected',
            icon: 'gamepad-off',
          };
        }
        const label =
          info.mapping === 'standard'
            ? (STANDARD_GAMEPAD_BUTTON_LABELS[binding.button] ?? `Button ${binding.button}`)
            : `Button ${binding.button}`;
        return { device: 'gamepad', bindingType: 'gamepad_button', label, icon: label };
      }
      case 'gamepad_axis': {
        const info = this.getGamepadInfo(gamepadIndex);
        if (!info?.connected) {
          return {
            device: 'gamepad',
            bindingType: 'gamepad_axis',
            label: 'Gamepad Disconnected',
            icon: 'gamepad-off',
          };
        }
        return {
          device: 'gamepad',
          bindingType: 'gamepad_axis',
          label: gamepadAxisLabel(binding.axis),
          icon: 'gamepad-stick',
        };
      }
      case 'gamepad_axis_pair': {
        const info = this.getGamepadInfo(gamepadIndex);
        if (!info?.connected) {
          return {
            device: 'gamepad',
            bindingType: 'gamepad_axis_pair',
            label: 'Gamepad Disconnected',
            icon: 'gamepad-off',
          };
        }
        return {
          device: 'gamepad',
          bindingType: 'gamepad_axis_pair',
          label: gamepadAxisPairLabel(binding.xAxis, binding.yAxis),
          icon: 'gamepad-stick',
        };
      }
      case 'touch_button':
        return {
          device: 'touch',
          bindingType: 'touch_button',
          label: binding.sourceId,
          icon: 'touch',
        };
      case 'touch_stick':
        return {
          device: 'touch',
          bindingType: 'touch_stick',
          label: binding.sourceId,
          icon: 'touch',
        };
      default:
        return null;
    }
  }

  /** Call at end of frame to clear per-frame state */
  endFrame() {
    this.keysJustDown.clear();
    this.keysJustUp.clear();
    this.mouseButtonsJustDown.clear();
    this.mouseButtonsJustUp.clear();
    // Carry this frame's gamepad pressed set forward as next frame's baseline,
    // then clear the per-frame edge sets.
    this.gamepadButtonsPrev = this.gamepadButtonsDown;
    this.gamepadButtonsJustDown.clear();
    this.gamepadButtonsJustUp.clear();
    // Carry this frame's raw axis snapshot forward as next frame's baseline
    // for gamepad_axis edge detection (isJustPressed/isJustReleased).
    this.gamepadAxesPrev = this.gamepadAxesCurrent;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    // F1 — pointerDelta is a per-frame accumulator, same shape as
    // mouseDeltaX/Y above; axis/vector2/pointerPosition are level values and
    // deliberately NOT reset here (they persist until changed/cleared).
    this.testPointerDeltaAccum.clear();
    // F2 — touch-button edges, same shape as the mouse-button edges above.
    this.touchButtonsJustDown.clear();
    this.touchButtonsJustUp.clear();
    // Task 1.4 — a promoted tap is just-pressed for exactly one poll()/
    // endFrame() bracket.
    this.virtualDigitalTapActive.clear();
    // Mirrors the line above for the release edge a direct
    // `setVirtualAction(action, false)`/`clearVirtualActions()` manufactures
    // (see `virtualDigitalJustReleased`'s doc comment) — just-released for
    // exactly one poll()/endFrame() bracket too.
    this.virtualDigitalJustReleased.clear();
  }

  /** Inject synthetic key state from touch controls */
  setVirtualKey(code: string, pressed: boolean) {
    if (pressed) {
      if (!this.keysDown.has(code)) this.keysJustDown.add(code);
      this.keysDown.add(code);
    } else {
      if (this.keysDown.has(code)) this.keysJustUp.add(code);
      this.keysDown.delete(code);
    }
  }

  /** Set virtual look stick position (-1..1). Injected as mouse delta during poll(). */
  setLookStick(x: number, y: number) {
    this.lookStickX = x;
    this.lookStickY = y;
  }

  /** Inject synthetic mouse delta (e.g. from touch controls) */
  addMouseDelta(dx: number, dy: number) {
    this.mouseDeltaX += dx;
    this.mouseDeltaY += dy;
  }

  /**
   * F2 (spec §12 "Complete Device Backends") — the touch/virtual-control
   * digital backend. Set a named virtual button's (`sourceId` — a zone/knob
   * id the touch UI chooses) pressed state; edge-tracked exactly like a real
   * mouse button (`onMouseDown`/`onMouseUp` above) so `isJustPressed`/
   * `isJustReleased` work for `{ type: 'touch_button', sourceId }` bindings.
   * This is the injectable entry point a real on-screen button's own
   * touchstart/touchend handler would call — that DOM wiring is a thin
   * adapter at the edge (browser-verified separately); this method is the
   * MAPPING logic, unit-tested headlessly with no DOM.
   */
  setTouchButton(sourceId: string, pressed: boolean): void {
    if (!this.inputActive) return;
    if (pressed) {
      if (!this.touchButtonsDown.has(sourceId)) this.touchButtonsJustDown.add(sourceId);
      this.touchButtonsDown.add(sourceId);
      this.lastActiveDevice = 'touch'; // F4
    } else {
      if (this.touchButtonsDown.has(sourceId)) this.touchButtonsJustUp.add(sourceId);
      this.touchButtonsDown.delete(sourceId);
    }
  }

  /**
   * F2 — the touch/virtual-control analog backend. Set a named virtual
   * stick's (`sourceId`) raw `{x,y}` position (e.g. -1..1 per axis, like a
   * gamepad stick); read back via `getVector2` on a `{ type: 'touch_stick',
   * sourceId }` binding, deadzone-rescaled the same way a gamepad stick is.
   * Persists across frames (a level value, like a real analog stick held in
   * position) until changed or cleared via {@link clearTouchStick}.
   */
  setTouchStick(sourceId: string, value: Vector2): void {
    this.touchStickValues.set(sourceId, value);
    // F4 — same rule as poll()'s gamepad axes (see `declaredDeadzone`): the
    // deadzone the game declared on THIS virtual stick decides whether the knob
    // has left rest, not a number this class picked.
    const deadzone = this.declaredDeadzone(
      (binding) =>
        binding.type === 'touch_stick' && binding.sourceId === sourceId
          ? (binding.deadzone ?? TOUCH_STICK_DEFAULT_DEADZONE)
          : undefined,
      TOUCH_STICK_DEFAULT_DEADZONE,
    );
    if (Math.hypot(value.x, value.y) > deadzone) this.lastActiveDevice = 'touch';
  }

  /** Clear a virtual stick's value (e.g. simulating the touch point lifting —
   *  the knob returns to center). */
  clearTouchStick(sourceId: string): void {
    this.touchStickValues.delete(sourceId);
  }

  // ==========================================================================
  // Action-level virtual input for a synthetic player: a bot drives
  // NAMED ACTIONS (not raw devices), and its contributions join action
  // resolution at exactly the same points binding contributions do (see
  // isPressed/isJustPressed and collectScalarContributions/
  // collectVector2Contributions above). The gates are split: virtual input
  // passes `machineInputActive` (the editor's `enabled` flag only), while
  // human input keeps the full `inputActive` (enabled AND focused) gate — a
  // synthetic player must keep playing the shared editor tab while the
  // human's focus is elsewhere. Unlike every typed getter above (which
  // treats an unknown action as inert), these THROW on an unknown name — a
  // synthetic-player caller needs a loud signal that the action it's driving
  // doesn't exist, not a silently-ignored actuation.
  // ==========================================================================

  /** Existence check shared by `setVirtualAction`/`tapVirtualAction` — throws
   *  `InputActionError` (`code: 'INPUT_ACTION_NOT_FOUND'`, `data.registered`
   *  = every declared action name) for a name that was never
   *  `registerAction`/`loadMap`-ed. */
  private assertActionExists(actionName: string, method: string): void {
    if (!this.actionValueTypes.has(actionName)) {
      throw new InputActionError(actionName, method, this.actionNames());
    }
  }

  /** Which declared `ActionValueType` a `setVirtualAction` value shape
   *  corresponds to — the type-safety check mirrors every typed getter's
   *  `assertValueType` (F1). `pointerDelta`/`pointerPosition` actions aren't
   *  drivable through `setVirtualAction` (no boolean/number/Vector2 call
   *  shape maps to them) — use `injectPointerDelta`/`injectPointerPosition`. */
  private static virtualValueCategory(
    value: boolean | number | { x: number; y: number },
  ): ActionValueType {
    if (typeof value === 'boolean') return 'digital';
    if (typeof value === 'number') return 'scalar';
    return 'vector2';
  }

  /**
   * Set a virtual value for `action`, OR'd/summed into the same action reads
   * humans drive (see the section doc comment above). A `boolean` holds a
   * digital action pressed until set `false`/cleared; a `number` or `{x,y}`
   * is a level value combined via the action's own scalar max-magnitude /
   * vector2 sum-then-clamp rule.
   *
   * A digital `false`→`true` transition manufactures a genuine `isJustPressed`
   * edge, exactly one real key-down does (pulse-runner friction #4 —
   * previously this write-half only ever held the action pressed with NO
   * edge at all; every edge-triggered ability driven through this direct
   * path was unprovable). Re-setting `true` while already held (auto-repeat)
   * does NOT re-fire it — see {@link applyVirtualActionValue}. The mirror
   * `true`→`false` transition manufactures an `isJustReleased` edge the same
   * way a real key-up does.
   *
   * Throws `InputActionError` for an unregistered `action`, and the same
   * valueType-mismatch error every typed getter throws (`assertValueType`)
   * when `value`'s shape doesn't match the action's declared `valueType`.
   *
   * Gated (`setEnabled(false)` — play stopped or editor-gated; #144: window
   * focus no longer gates machine input): writes NOTHING — matching
   * `setTouchButton`'s write-gate precedent above — and returns
   * `{delivered: false, reason}` rather than a silent no-op, so a probe/bot
   * never mistakes a swallowed actuation for a delivered one.
   */
  setVirtualAction(
    action: string,
    value: boolean | number | { x: number; y: number },
  ): { delivered: boolean; reason?: string } {
    this.assertActionExists(action, 'setVirtualAction');
    const expected = InputManager.virtualValueCategory(value);
    this.assertValueType(action, expected, 'setVirtualAction');
    if (!this.machineInputActive) {
      return { delivered: false, reason: 'input-gated (input disabled by the editor)' };
    }
    this.applyVirtualActionValue(action, value);
    return { delivered: true };
  }

  /**
   * Godot's `Input.action_press(action, strength)` door for a digital action.
   * This extends the existing virtual held/edge state with its clamped
   * processed strength instead of maintaining a parallel Godot action map.
   */
  setVirtualDigitalStrength(
    action: string,
    strength: number,
  ): { delivered: boolean; reason?: string } {
    this.assertActionExists(action, 'setVirtualDigitalStrength');
    this.assertValueType(action, 'digital', 'setVirtualDigitalStrength');
    if (!Number.isFinite(strength)) {
      throw new Error('InputManager.setVirtualDigitalStrength: strength must be finite.');
    }
    if (!this.machineInputActive) {
      return { delivered: false, reason: 'input-gated (input disabled by the editor)' };
    }
    const clamped = Math.min(1, Math.max(0, strength));
    // `Input::action_press` sets api_pressed=true even when its clamped
    // strength is zero; only `action_release` clears the pressed state.
    this.applyVirtualActionValue(action, true);
    this.virtualDigitalStrength.set(action, clamped);
    return { delivered: true };
  }

  /**
   * The write half of {@link setVirtualAction} — extracted so D15/T-D15.5's
   * `scheduleActionAtTick` can apply a non-boolean (scalar/vector2) queued
   * actuation through the exact same code path (no gate check here: the two
   * callers gate differently — `setVirtualAction` above checks
   * `inputActive` before calling this; `applyScheduledActionsForTick` is
   * only ever reached from inside `poll()` AFTER its own gate check has
   * already returned early on a gated tick). `applyScheduledActionsForTick`
   * still handles digital `true` itself rather than calling here (its
   * one-tick edge must land EXACTLY at the scheduled tick — see its own doc
   * comment) — this method's digital branch is `setVirtualAction`'s direct
   * path, called at an arbitrary point relative to the poll()/endFrame()
   * bracket.
   *
   * pulse-runner friction #4 — the digital branch used to be a bare held-flag
   * write with no manufactured edge at all (the comment that used to sit
   * here read: "A digital value is handled by `applyScheduledActionsForTick`
   * itself (it needs the extra just-pressed edge a plain held-value write
   * doesn't produce)" — i.e. the edge fix shipped ONLY for the scheduled
   * path, never for this one, which is exactly the gap a blind dogfood run
   * hit: `setVirtualAction('jump', true)` held the action down but
   * `isJustPressed('jump')` never fired). Fixed here by reusing
   * `tapVirtualAction`'s exact one-tick-pulse queue mechanism for this
   * DIRECT case, specifically because this method's caller can land at any
   * point relative to `poll()`: writing `virtualDigitalTapActive` directly
   * here (as the scheduled path safely does, from inside `poll()` itself)
   * would risk being silently wiped by `poll()`'s own unconditional
   * `virtualDigitalTapActive = virtualDigitalTapQueued` reassignment,
   * depending on timing. Queueing side-steps that hazard by construction —
   * the same reason `tapVirtualAction` queues instead of writing directly. A
   * redundant `true` while already held (`virtualDigitalHeld` already has
   * `action`) does not queue again, matching a real key's auto-repeat never
   * re-firing `isJustPressed`. The `false` branch mirrors real `onKeyUp`
   * instead (immediate write, no queue needed — nothing in `poll()`
   * reassigns `virtualDigitalJustReleased`), and only fires when the action
   * was actually held (no released→released re-fire).
   */
  private applyVirtualActionValue(
    action: string,
    value: boolean | number | { x: number; y: number },
  ): void {
    switch (InputManager.virtualValueCategory(value)) {
      case 'digital':
        if (value as boolean) {
          if (!this.virtualDigitalHeld.has(action)) this.virtualDigitalTapQueued.add(action);
          this.virtualDigitalHeld.add(action);
        } else {
          if (this.virtualDigitalHeld.has(action)) this.virtualDigitalJustReleased.add(action);
          this.virtualDigitalHeld.delete(action);
          this.virtualDigitalStrength.delete(action);
        }
        break;
      case 'scalar':
        this.virtualScalarValues.set(action, value as number);
        break;
      default:
        this.virtualVector2Values.set(action, value as { x: number; y: number });
        break;
    }
  }

  /**
   * One-frame press of a `'digital'` action (Task 1.4): queues `action` so it
   * reads `isJustPressed`/`isPressed` true for EXACTLY the next `poll()`'s
   * frame — promoted to the "active" set at the top of `poll()`, cleared in
   * `endFrame()` alongside every other just-pressed edge set (see both
   * above). Hollowstone's `queued`/`beginFrame` tap contract, ported onto
   * this engine's existing fixed-step `poll()`/`endFrame()` bracket instead
   * of a bespoke `beginFrame()` hook.
   *
   * Throws the same errors as {@link setVirtualAction} (unknown action;
   * non-digital valueType). A gated tap does NOT queue — it must not fire on
   * a later frame once input becomes active again — and returns
   * `{delivered: false, reason}`.
   */
  tapVirtualAction(action: string): { delivered: boolean; reason?: string } {
    this.assertActionExists(action, 'tapVirtualAction');
    this.assertValueType(action, 'digital', 'tapVirtualAction');
    if (!this.machineInputActive) {
      return { delivered: false, reason: 'input-gated (input disabled by the editor)' };
    }
    this.virtualDigitalTapQueued.add(action);
    return { delivered: true };
  }

  /** Clear all virtual-action state — held digitals, queued/active taps, and
   *  scalar/vector2 values. `flushHeldState()` (the same flush
   *  `setEnabled(false)`/real blur apply to held keys/mouse/touch buttons)
   *  shares the underlying wipe, so a bot's held action never survives input
   *  being suspended — but only THIS public entry point (a deliberate "let
   *  go", the mirror of `setVirtualAction(action, false)` below) manufactures
   *  an `isJustReleased` edge for whatever was held; the suspend path stays
   *  silent (see `flushHeldState`'s own doc comment). */
  clearVirtualActions(): void {
    this.clearVirtualActionState({ manufactureReleaseEdge: true });
  }

  /**
   * D15/T-D15.5 — schedule a virtual actuation for exactly `tick`: applied
   * at the START of that tick's `poll()` (composing with `runTicks` — a
   * schedule for tick 500 fires exactly once the sim has been driven through
   * tick 500, regardless of burst size). A digital `true` produces a genuine
   * `isJustPressed` edge exactly at the target tick (not merely a held value
   * — see `applyScheduledActionsForTick`).
   *
   * Throws `InputActionError` for an unregistered `action` and the same
   * valueType-mismatch error every typed getter throws (`assertValueType`) —
   * both checked EAGERLY, at schedule time, not deferred to the target tick.
   * Throws `InputTickError` (`code: 'TICK_ALREADY_PASSED'`) when `tick` is
   * strictly less than the tick `poll()` will service NEXT — scheduling only
   * ever reaches the current or a future tick. A tick whose input phase
   * never runs (this world paused/frozen at that point, or a multi-tick gap
   * — see `poll()`) drops its scheduled entries rather than replaying them
   * late — each drop emits one `'input.schedule.dropped'` debug event
   * (`{tick, action}`) via {@link setDebugEmit}'s sink, if one is wired.
   */
  scheduleActionAtTick(
    tick: number,
    action: string,
    value: boolean | number | { x: number; y: number },
  ): void {
    this.assertActionExists(action, 'scheduleActionAtTick');
    const expected = InputManager.virtualValueCategory(value);
    this.assertValueType(action, expected, 'scheduleActionAtTick');
    if (tick < this.currentTick) {
      throw new InputTickError(tick, this.currentTick);
    }
    const pending = this.scheduledActions.get(tick);
    if (pending) pending.push({ action, value });
    else this.scheduledActions.set(tick, [{ action, value }]);
  }

  /** Wire (or clear, via `null`) the sink `poll()` calls with
   *  `'input.schedule.dropped'` (`{tick, action}`) whenever it discards a
   *  scheduled entry for a tick whose input phase never ran. Called once by
   *  whoever constructs this `InputManager` with a `DebugRegistry` behind it
   *  (`editor-game/src/host/roots/r3f-root.tsx`), the same seed spot as
   *  `setVirtualInputTarget`/`setInputActionsSource` — never called directly
   *  by gameplay code. */
  setDebugEmit(fn: ((event: string, detail?: unknown) => void) | null): void {
    this.debugEmit = fn;
  }

  /** D15/T-D15.5 — start (or restart) recording the post-gate action-delta
   *  trace: clears any prior trace/snapshot, so a fresh recording session
   *  never carries over stale deltas from an earlier one. */
  startInputRecording(): void {
    this.inputRecording = true;
    this.inputTrace = [];
    this.lastTraceSnapshot.clear();
  }

  /** D15/T-D15.5 — stop recording (the trace accumulated so far stays
   *  readable via {@link getInputTrace} until the next `startInputRecording`
   *  clears it). Idempotent. */
  stopInputRecording(): void {
    this.inputRecording = false;
  }

  /** D15/T-D15.5 — whether a recording is currently active. */
  isInputRecording(): boolean {
    return this.inputRecording;
  }

  /** D15/T-D15.5 — the recorded trace so far (a defensive copy), versioned
   *  per the design doc's format sketch (§2.c). SP5 (out of scope here) is
   *  the eventual consumer that replays this; this module only ever
   *  RECORDS. */
  getInputTrace(): {
    version: 1;
    ticks: { tick: number; actions: Record<string, boolean | number | { x: number; y: number }> }[];
  } {
    return { version: 1, ticks: this.inputTrace.slice() };
  }

  /**
   * Request pointer lock for FPS-style mouse control.
   *
   * Wires `element` for click-to-lock (so a lock released by Escape comes back
   * on the next click) AND, when the call itself is inside a user gesture,
   * requests the lock right now. Games call this FROM a click handler
   * (third-person's Player: canvas click → `requestPointerLock(canvas)`), and
   * with only the listener wired that first click did nothing — the lock
   * arrived one click late, with no feedback, which every hosted-editor tester
   * read as "the mouse doesn't work" (runhuman passes 113–116). Outside a
   * gesture the browser would refuse and log, so the immediate request is
   * gated on `navigator.userActivation`.
   */
  requestPointerLock(element: HTMLElement) {
    // Idempotent: never stack duplicate click listeners. Rewire if the element
    // changed, and track it so dispose() can remove the listener.
    if (this.pointerLockElement !== element) {
      if (this.pointerLockElement) {
        this.pointerLockElement.removeEventListener('click', this.onPointerLockClick);
      }
      this.pointerLockElement = element;
      element.addEventListener('click', this.onPointerLockClick);
    }
    const doc = typeof document !== 'undefined' ? document : null;
    const activation = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
    if (doc && doc.pointerLockElement !== element && activation?.isActive) {
      this.onPointerLockClick();
    }
  }

  /**
   * Release pointer lock on the element {@link requestPointerLock} wired.
   *
   * Godot's `Input.mouse_mode = MOUSE_MODE_VISIBLE` is this call: drop the
   * lock if this manager holds it, and unwire the click-to-lock listener so a
   * later click does not recapture. Idempotent. A host with no
   * `document.exitPointerLock` (headless) still unwires — the lock never
   * existed there.
   *
   * Only the lock THIS manager requested is released. An editor viewport
   * holding lock on a different element is not ours to drop.
   */
  exitPointerLock() {
    if (this.pointerLockRetry !== null) {
      clearTimeout(this.pointerLockRetry);
      this.pointerLockRetry = null;
    }
    const el = this.pointerLockElement;
    if (el) {
      el.removeEventListener('click', this.onPointerLockClick);
      this.pointerLockElement = null;
    }
    this.pointerLocked = false;
    const doc = typeof document !== 'undefined' ? document : undefined;
    if (!doc || typeof doc.exitPointerLock !== 'function') return;
    if (el && doc.pointerLockElement === el) doc.exitPointerLock();
  }

  /** Clean up event listeners */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // A manager torn down with a key under the hand (Stop while W is held)
    // kept that key in `keysDown` for good — its listeners went away before
    // the release arrived, and nothing else clears it. A disposed manager
    // holds nothing.
    this.flushHeldState();
    for (const axes of this.smoothedAxisSets) {
      axes.disposed = true;
      axes.values.clear();
    }
    this.smoothedAxisSets.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('mousedown', this.onMouseDown);
      window.removeEventListener('mouseup', this.onMouseUp);
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('blur', this.onWindowBlur);
      window.removeEventListener('focus', this.onWindowFocus);
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    }
    if (this.pointerLockElement) {
      this.pointerLockElement.removeEventListener('click', this.onPointerLockClick);
      this.pointerLockElement = null;
    }
  }
}
