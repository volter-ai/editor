/**
 * `Input.is_action_pressed(action)` — over the engine's own `InputManager`.
 *
 * `Player.gd:16-23` is the 2D pilot's entire control scheme: four
 * `is_action_pressed` calls against `move_right` / `move_left` / `move_down` /
 * `move_up`, and `squash-the-creeps` adds one rising-edge read
 * (`is_action_just_pressed("jump")`). Those names are not compat's, and neither
 * are their bindings:
 * `project.godot` declares five actions across 17 bindings (9 `InputEventKey`,
 * 4 `InputEventJoypadButton`, 4 `InputEventJoypadMotion`), and the translated
 * project carries them as its own input map.
 *
 * **So compat READS and never DEFINES.** It registers no action, invents no
 * binding and owns no keyboard. The caller hands it the mapping from Godot
 * action name to engine action name — usually identity, because the emitter
 * writes the input map straight out of `project.godot` — and every query goes
 * to `input.isPressed(...)`.
 *
 * That is a deliberate difference from `roblox-compat`'s `UserInputService`,
 * which DOES register an action per key, and the reason is that the two
 * questions are not the same. Roblox's `IsKeyDown` is a raw physical-key query
 * with no action behind it, so compat had to manufacture one. Godot's
 * `is_action_pressed` is already an action query against a map the project
 * declares — the engine's model exactly. Manufacturing a second registration
 * here would create a shadow binding set that silently diverges from the one
 * the project ships, and rebinding would stop working for a ported game.
 *
 * ## `Input.action_press` ACTUATES a declared action — it still defines none
 *
 * `platformer-3d-godot4`'s virtual joystick synthesizes action state from a
 * touch drag (`virtual_joystick.gd:145-161`, pressing and releasing `move_left`
 * and friends so the rest of the game reads its own actions and never knows a
 * joystick exists). That looked like the thing the rule above forbids, and it
 * is not: the rule is about REGISTRATION — a shadow binding set beside the
 * project's own — and `action_press` names an action the project already
 * declared. The engine has the door for exactly this and it is not compat's
 * invention: `InputManager.setVirtualAction(action, boolean)` (the synthetic-
 * player surface a bot drives) OR's into the same action reads a human's keys
 * do, manufactures a real `isJustPressed` edge on `false`->`true` and a real
 * `isJustReleased` on `true`->`false`, and THROWS for an action nobody
 * registered. So {@link GodotInput.actionPress} is that call and nothing more.
 * Its strength is retained on the manager's existing virtual-digital entry;
 * there is still one action state, and both processed/raw strength reads see
 * the same clamped value pinned `Input::action_press` stores.
 *
 * ## What reading through `InputManager` buys, and why not `window`
 *
 * The engine's manager only records a key while input is ACTIVE: it returns
 * early when the game is suspended, when the window is blurred, or when a text
 * field has focus, and `setEnabled(false)` flushes everything held (play-mode
 * input isolation). A private `keydown` listener here would cheerfully report
 * `W` held while the user types in an editor inspector, and would keep
 * reporting it after the game was paused.
 *
 * ## Pointer capture is INPUT, not a camera
 *
 * `starter-kit-fps` `player.gd:49`/`:107`/`:111` writes `Input.mouse_mode` to
 * `MOUSE_MODE_CAPTURED` (2) or `MOUSE_MODE_VISIBLE` (0), and `:101-102` reads
 * `event.relative` off an `_input` `InputEventMouseMotion`. Those rows map
 * onto this seam, not onto a camera rig: the camera consumes the delta the
 * same way any script consumes `get_vector`.
 *
 * - {@link GodotInput.setMouseMode} HIDDEN applies the browser's native CSS
 *   `cursor: none` to the game canvas and exits pointer lock, matching Godot
 *   3.6 `OS_JavaScript::set_mouse_mode`. CAPTURED →
 *   `InputManager.requestPointerLock` on the game canvas, plus an immediate
 *   `element.requestPointerLock()` (the browser may reject that without a
 *   gesture; the click listener stays as the fallback). VISIBLE restores the
 *   last configured cursor and calls `InputManager.exitPointerLock`. Capture
 *   respects the manager's play-mode
 *   `setEnabled` gate and its tab-focus flag — the same `inputActive`
 *   predicate `onMouseMove` already uses. A write while the gate is closed
 *   does not acquire lock (the editor's Game-tab isolation).
 * - {@link GodotInput.getMouseMode} checks the real canvas cursor first, then
 *   the REAL lock (`InputManager.isPointerLocked`), the same hidden/captured/
 *   visible order as Godot 3.6's HTML5 backend. A CAPTURED
 *   write that the browser refused (no gesture) or that a headless host
 *   cannot honour still reads VISIBLE. Inventing a captured state would be
 *   the first-party data the anti-shim rule forbids.
 * - {@link GodotInput.getMouseRelative} is the per-frame mouse delta the
 *   manager already accumulates (`getMouseDelta` / the `mouse_move` binding's
 *   source). Sign and units are the browser's `movementX`/`movementY` and
 *   Godot 4.7's `InputEventMouseMotion.relative` (dump:
 *   `vendor/extension-api/godot-4.7-extension_api.json`, property `relative:
 *   Vector2`, getter `get_relative`) in the same convention: +x is right, +y
 *   is down, in CSS pixels. The emitter rewrites `event.relative` inside
 *   `_input` into this poll; there is no event object.
 *
 * Headless: pointer lock does not exist. A CAPTURED write is a silent no-op
 * and a read stays VISIBLE. The look path is still drivable: the S4 harness
 * (and any `vgai eval` command) injects through
 * `InputManager.addMouseDelta`, which is the same accumulator
 * {@link GodotInput.getMouseRelative} reads — never a synthetic `mousemove`
 * and never rAF.
 *
 * ## The pointer/touch stream is the ENGINE's, and only the protocol is here
 *
 * `Viewport.get_mouse_position` and the `InputEventScreenTouch` /
 * `InputEventScreenDrag` queue both need the same thing underneath: the host
 * pointer stream, resolved against the render surface and mapped into the
 * project's design pixels so a finger and a Control rect land in one space.
 * That is not Godot's — it is what any game with a touch UI or a picked
 * ground plane needs — so it is the engine's `createHostPointer`
 * (`@vgai/engine/input/host-pointer`), which owns the four pointer listeners,
 * the surface rect, the design-space mapping, the DENSE finger indices and
 * the bounded touch ring.
 *
 * Compat keeps the PROTOCOL: the two Godot event classes those finger phases
 * are reported as, `pressed`, and `Viewport.set_input_as_handled`.
 *
 * The move also fixed a real gate defect. The pointer listeners here checked
 * `isEnabled()` alone — the editor's play gate — where every other engine
 * listener checks `inputActive` (enabled AND focused). A blurred tab, or one
 * whose user was typing into an inspector field, still moved the game's mouse
 * position. The engine's stream reads `InputManager.isInputActive()` directly,
 * so the two cannot drift apart again.
 *
 * ## Resource ownership
 *
 * **Owns:** the action-name map, which is the caller's data held by reference,
 * and the optional lock-target getter (a function the caller owns).
 * **Shares:** the `InputManager`, which is the game's — including the virtual
 * action state {@link GodotInput.actionPress} writes and the pointer-lock
 * element {@link GodotInput.setMouseMode} wires, both the MANAGER's (flushed
 * or unwired by the manager's own `setEnabled(false)` / `dispose` /
 * `exitPointerLock`). **Teardown:** {@link GodotInput.dispose} disposes the
 * `HostPointer` it created (its listeners are not the manager's and
 * `InputManager.dispose` does not reach them); the click-to-lock listener
 * remains the manager's own to end.
 */

import {
  createHostPointer,
  type HostPointer,
  type HostPointerTouch,
} from '@volter/game-runtime/input/host-pointer';
import type { InputManager } from '@volter/game-runtime/input/input-manager';
import { inputBindingsCollide } from '@volter/game-runtime/input/binding-identity';
import type { InputBinding } from '@volter/game-runtime/input/input-types';
import { packedInt32Array, type PackedArrayValue } from './packed-array';
import { createSignal, type GodotSignal } from './signal';
import { registerGodotObjectIdentity } from './object';
import { PROJECT_RAY_DEFAULT_VIEWPORT } from './spatial';
import type { GodotViewportTexture } from './viewport';
import { copyVector2, VECTOR2_ZERO, type Vector2, vec2 } from './vector2';
import { godotOsGetKeycodeString } from './os';
import type { ColorValue } from './variant';

/**
 * `Input.MOUSE_MODE_VISIBLE` — the pinned 4.7 dump's `Input.MouseMode` value 0.
 * A write of this is {@link GodotInput.setMouseMode}'s exit.
 */
export const MOUSE_MODE_VISIBLE = 0;
/** `Input.MOUSE_MODE_HIDDEN` — Godot 3.6's HTML5 cursor-hidden value 1. */
export const MOUSE_MODE_HIDDEN = 1;
/**
 * `Input.MOUSE_MODE_CAPTURED` — the pinned 4.7 dump's `Input.MouseMode` value 2.
 * A write of this is {@link GodotInput.setMouseMode}'s lock request.
 */
export const MOUSE_MODE_CAPTURED = 2;

/** Godot's `Input` singleton, narrowed to the measured surface. */
export interface GodotInput {
  /** Native viewport resize signal exposed by `Node.get_viewport()`. */
  readonly sizeChanged: GodotSignal<readonly []>;
  /** Native browser gamepad connection lifecycle, with Godot's device slot and connected state. */
  readonly joyConnectionChanged: GodotSignal<readonly [number, boolean]>;
  getActions(): string[];
  addAction(action: string, deadzone?: number): void;
  eraseAction(action: string): void;
  getActionDescription(action: string): string;
  actionSetDeadzone(action: string, deadzone: number): void;
  actionGetDeadzone(action: string): number;
  loadFromGlobals(): void;
  getActionList(action: string): GodotInputMapEvent[];
  actionGetEvents(action: string): GodotInputMapEvent[];
  hasAction(action: string): boolean;
  actionHasEvent(action: string, event: unknown): boolean;
  eventActionStrength(event: GodotInputMapEvent, action: string, exactMatch?: boolean): number;
  eventIsAction(event: GodotInputMapEvent, action: string, exactMatch?: boolean): boolean;
  eventIsActionReleased(event: GodotInputMapEvent, action: string, exactMatch?: boolean): boolean;
  actionAddEvent(action: string, event: unknown): void;
  actionEraseEvent(action: string, event: unknown): void;
  actionEraseEvents(action: string): void;
  /**
   * `Input.is_action_pressed("move_left")`.
   *
   * @throws naming the action and the ones that ARE mapped. Godot returns
   * `false` for an unknown action after printing an error, which in a port
   * reads as "the controls do not work" with nothing to grep for.
   */
  isActionPressed(action: string, exactMatch?: boolean): boolean;
  /**
   * `Input.is_action_just_pressed("jump")` — `squash-the-creeps`
   * `Player.gd:40`, the rising edge that makes a jump one jump rather than one
   * per frame held.
   *
   * This is the engine's own `isJustPressed`, not a `pressed && !wasPressed`
   * this file would have to remember: the manager already tracks the edge
   * against the same frame boundary every other read uses, and a second
   * bookkeeping of it here would disagree with the first the moment input is
   * disabled mid-frame (play-mode isolation flushes held state).
   *
   * @throws on an unmapped action, exactly as {@link GodotInput.isActionPressed}
   * does and for the same reason.
   */
  isActionJustPressed(action: string, exactMatch?: boolean): boolean;
  /**
   * `Input.is_action_just_released("jump")` — `platformer-3d-godot4`
   * `player.gd:138`, which cuts a jump short when the key comes back up.
   *
   * The manager's own FALLING edge (`isJustReleased`), beside the
   * `isJustPressed` {@link isActionJustPressed} delegates to, for the same
   * reason: the edge is tracked against the frame boundary every other read
   * uses, and compat keeping a second `wasPressed` would disagree with it the
   * moment input is disabled mid-frame.
   *
   * @throws on an unmapped action, as the reads above do.
   */
  isActionJustReleased(action: string, exactMatch?: boolean): boolean;
  /** Processed action strength from the existing engine action state. */
  getActionStrength(action: string, exactMatch?: boolean): number;
  /** Raw action strength before the action's configured deadzone. */
  getActionRawStrength(action: string, exactMatch?: boolean): number;
  /** Raw keyboard-device query; this never invents an input-map action. */
  isKeyPressed(keycode: number): boolean;
  /** Physical keyboard query over the host KeyboardEvent.code state. */
  isPhysicalKeyPressed(keycode: number): boolean;
  /** Raw native mouse-button query using Godot's MouseButton numbering. */
  isMouseButtonPressed(button: number): boolean;
  /** Godot MouseButtonMask bits for every currently retained DOM pointer button. */
  getMouseButtonMask(): number;
  /** Connected joypad device indices using the dialect's native collection value. */
  getConnectedJoypads(): number[] | PackedArrayValue<number>;
  /** Browser-native W3C Gamepad id for the requested Godot device slot. */
  getJoyName(device: number): string;
  getJoyButtonString(button: number): string;
  getJoyAxisString(axis: number): string;
  /** Whether the device advertises the standardized W3C mapping Godot can identify. */
  isJoyKnown(device: number): boolean;
  isJoyButtonPressed(device: number, button: number): boolean;
  getJoyAxis(device: number, axis: number): number;
  /**
   * `Input.action_press("move_left", strength)` — `virtual_joystick.gd:152-161`.
   *
   * Actuates an action the PROJECT declared, through the engine's own
   * synthetic-player door (`InputManager.setVirtualAction`), so a translated
   * on-screen joystick drives `move_left` for every reader the same way a key
   * does — including the rising edge `is_action_just_pressed` reports. See this
   * module's header for why this does not breach "compat never DEFINES an
   * action": nothing here registers an action or invents a binding.
   *
   * Strength is clamped to `[0, 1]` and retained by the same manager-owned
   * virtual action state that owns the held/edge value, matching pinned
   * `Input::action_press` and making `get_action_strength` observe it.
   *
   * **DEVIATION — the rising EDGE lands one frame later.** Measured against
   * the real manager: the action reads HELD immediately (so `get_vector` and
   * `is_action_pressed`, which is what a joystick's consumers use, see it at
   * once), while `is_action_just_pressed` becomes true at the top of the next
   * `poll()` — the manager queues a virtual press's edge rather than writing
   * it into the frame already in flight. Godot's `action_press` reports the
   * edge in the same frame. The alternative would be compat keeping its own
   * edge bookkeeping, which is exactly what {@link isActionJustPressed}'s doc
   * refuses: two edge records disagree the moment input is gated mid-frame.
   * The FALLING edge has no such lag ({@link actionRelease} writes it).
   *
   * Silently no-ops while the manager's input is gated (play-mode isolation),
   * which is the same gate under which every read above returns false.
   *
   * @throws on an unmapped action, as every member here does.
   */
  actionPress(action: string, strength?: number): void;
  /**
   * `Input.action_release("move_left")` — `virtual_joystick.gd:145-150`.
   *
   * Releases what {@link actionPress} pressed, manufacturing the same falling
   * edge a real key-up does. Releasing an action that was never synthetically
   * pressed is a no-op, as Godot's is.
   */
  actionRelease(action: string): void;
  /** Feed an authored InputEventAction through the same retained action state as native input. */
  parseInputEvent(event: GodotInputMapEvent): void;
  /**
   * `Input.get_vector(neg_x, pos_x, neg_y, pos_y)` — `platformer-3d`
   * `player.gd:48`,
   * `Input.get_vector("move_left", "move_right", "move_forward", "move_back")`,
   * the whole ground-movement stick.
   *
   * Godot 3.6 (`core/os/input.cpp` `Input::get_vector`) builds
   * `(raw(pos_x) − raw(neg_x), raw(pos_y) − raw(neg_y))` from each action's RAW
   * strength (its own per-action deadzone NOT applied), then applies ONE
   * CIRCULAR deadzone to the resulting vector: below `deadzone` it is zero, above
   * length 1 it is normalized, and between it is rescaled by
   * `inverse_lerp(deadzone, 1, length)`. That is exactly what this reproduces,
   * with `deadzone` resolved by the emitter from `project.godot` (all four of the
   * fixture's actions declare `0.5`, and Godot's own default of `-1` averages the
   * four action deadzones — a value the emitter knows statically and the runtime
   * does not, so it is passed in rather than guessed).
   *
   * The manager reads digital keys/buttons/touches as 0/1 and directional
   * gamepad axes at their raw magnitude, before the per-action deadzone.
   *
   * @throws on an unmapped action, as the other two reads do.
   */
  getVector(negX: string, posX: string, negY: string, posY: string, deadzone?: number): Vector2;
  /**
   * `Input.get_axis(negative, positive)` — `starter-kit-3d-platformer` `player.gd:113`/`:114` and
   * `view.gd:44`/`:45`/`:52`, which build a movement vector, a camera pan and a zoom out of five
   * of these.
   *
   * Godot 4's `Input::get_axis` is `get_action_strength(positive) − get_action_strength(negative)`
   * — ONE subtraction, no deadzone of its own. It is deliberately NOT
   * {@link getVector}'s per-axis half: `get_vector` reads RAW strengths and then applies one
   * CIRCULAR deadzone to the resulting 2-vector, so a game that composes two `get_axis` calls into
   * a vector (which is exactly what `player.gd` does) gets a SQUARE region and full-magnitude
   * diagonals, and Godot gives it that too. Reproducing this as `getVector(...).x` would quietly
   * round the diagonals off.
   *
   * @throws on an unmapped action, as every read here does.
   */
  getAxis(negative: string, positive: string): number;
  /**
   * `Input.mouse_mode` — the pinned 4.7 dump's `int` property (`MouseMode` enum).
   *
   * Reports the REAL canvas cursor and pointer-lock state, so a headless host
   * and a browser that refused a lock both read {@link MOUSE_MODE_VISIBLE}.
   */
  getMouseMode(): number;
  /**
   * `Input.mouse_mode = …` — `starter-kit-fps` `player.gd:49`/`:107`/`:111`.
   *
   * {@link MOUSE_MODE_CAPTURED} requests pointer lock on the game canvas
   * through the manager, gated on play + tab focus. {@link MOUSE_MODE_HIDDEN}
   * hides the real canvas cursor and exits pointer lock; {@link MOUSE_MODE_VISIBLE}
   * restores the configured cursor and exits. The two confined modes retain
   * Godot 3.6 HTML5's own named refusal.
   *
   * A CAPTURED write while the manager's play gate is closed is a no-op: the
   * editor's Game-tab isolation, the same predicate `onMouseMove` already
   * uses. A host with no canvas / no `requestPointerLock` (headless) is the
   * same no-op, honestly.
   */
  setMouseMode(mode: number): void;
  /**
   * `InputEventMouseMotion.relative` as a per-frame poll — the emitter rewrites
   * `event.relative` inside `_input` into this.
   *
   * The pinned 4.7 dump declares `relative: Vector2` (getter `get_relative`) on
   * `InputEventMouseMotion`. Godot delivers that per-event mouse delta in
   * screen space: +x is right, +y is down. This engine's
   * `InputManager.getMouseDelta` is the browser's `movementX`/`movementY`,
   * which is the same convention and the same CSS-pixel unit. No axis is
   * flipped and no scale is applied; a game that wants look-inverted applies
   * that itself (`player.gd:148` is `Vector3(-yRot, -xRot, 0)`).
   *
   * Headless injection is `InputManager.addMouseDelta` — the S4 / game-command
   * door — not a synthetic `mousemove`.
   */
  getMouseRelative(): Vector2;
  /**
   * Whether this frame carries mouse motion — the polled form of
   * `event is InputEventMouseMotion`. Godot runs that `_input` body once per
   * motion event; a polled frame answers with "the seam accumulated a
   * non-zero delta".
   */
  hasMouseMotion(): boolean;
  /** Whether this frame contains a native mouse-button press or release edge. */
  hasMouseButtonEvent(): boolean;
  /** Godot button index for this frame's mouse-button edge (left is 1; DOM left is 0). */
  getMouseButtonEventIndex(): number;
  /** `true` for a press edge and `false` for a release edge. */
  isMouseButtonEventPressed(): boolean;
  /** Raw held-state query for Godot's 1-based MouseButton enum. */
  isMouseButtonPressed(button: number): boolean;
  /** `Input.set_custom_mouse_cursor` for the default arrow shape. */
  setCustomMouseCursor(texture: string, shape: number, hotspot: Vector2): void;
  setDefaultCursorShape(shape: number): void;
  getCurrentCursorShape(): number;
  /**
   * `Viewport.get_mouse_position()` — dump: `-> Vector2`. Godot's viewport
   * origin is top-left, Y down, in pixels. Held here because this engine has
   * no Viewport object; `Node.get_viewport()` returns a handle that reads this.
   * Live path is the host canvas pointer; headless injection is {@link setMousePosition}.
   */
  getMousePosition(): Vector2;
  /** S4 / harness door for {@link getMousePosition}. */
  setMousePosition?(position: Vector2): void;
  /**
   * `Viewport.get_visible_rect().size` — the project RESOLUTION this service was
   * built with, in the same logical space {@link getMousePosition} reports.
   *
   * Held on the SERVICE, which is per mounted game, because it is the size
   * `Camera3D.project_ray_normal` unprojects through and a wrong one picks the
   * wrong cell. It used to live in a module-level `let` in `spatial.ts` that
   * `createInput` wrote — process-scoped state two mounted games (the editor's
   * edit world and its play world are two) would take turns clobbering.
   */
  getViewportSize(): Vector2;
  setViewportInputDisabled(disabled: boolean): void;
  isViewportInputDisabled(): boolean;
  /** Stable ViewportTexture Resource over the mounted browser canvas. */
  getViewportTexture(): GodotViewportTexture;
  /** Retained main-Viewport clear-alpha state, applied by the mounted native renderer owner. */
  hasViewportTransparentBackground(): boolean;
  setViewportTransparentBackground(transparent: boolean): void;
  /** Apply RenderingServer's process-wide default clear color through this mounted renderer. */
  setDefaultClearColor(color: ColorValue): void;
  /** Exact InputEventAction injection for the retained input owner; native device events stay loud. */
  pushViewportInput(event: GodotInputMapEvent, inLocalCoords?: boolean): void;
  /**
   * Drain this frame's `InputEventScreenTouch` / `InputEventScreenDrag` queue.
   * The emitter rewrites `_input(event)` that branches on those classes into a
   * loop over this list. Positions are design-pixel viewport coords — the same
   * mapping {@link getMousePosition} uses — so a Control rect and a touch share
   * one space.
   */
  takeScreenEvents(): readonly GodotScreenEvent[];
  /** Mark `event` as the one {@link setInputAsHandled} applies to. */
  beginScreenEvent(event: GodotScreenEvent): void;
  /** `Viewport.set_input_as_handled()` — mark the event currently being
   *  delivered so later `_input` handlers skip it. */
  setInputAsHandled(): void;
  /** Whether the currently delivered screen event has already been accepted. */
  isInputHandled(): boolean;
  /** Release the host pointer observation owned by this service. */
  dispose(): void;
}

/**
 * `CanvasItem.get_global_mouse_position()` over the one host-pointer stream.
 * A host without that stream cannot manufacture a meaningful Godot position.
 */
export function godotGlobalMousePosition(input: GodotInput): Vector2 {
  if (input.getMousePosition === undefined) {
    throw new Error(
      'CanvasItem.get_global_mouse_position requires the mounted host pointer; this input adapter does not expose it.',
    );
  }
  return copyVector2(input.getMousePosition());
}

// String-keyed so ResourceSaver's project JSON snapshot retains event identity across save/load.
const INPUT_BINDING = '__godotInputBinding' as const;
const INPUT_BINDING_IDENTITY = '__godotInputBindingIdentity' as const;

export interface GodotInputMapEvent {
  readonly __godotClass:
    | 'InputEvent'
    | 'InputEventKey'
    | 'InputEventMouseButton'
    | 'InputEventMouseMotion'
    | 'InputEventJoypadButton'
    | 'InputEventJoypadMotion'
    | 'InputEventAction';
  readonly [INPUT_BINDING]?: InputBinding;
  readonly [INPUT_BINDING_IDENTITY]?: string;
  device: number;
  pressed: boolean;
  echo: boolean;
  canceled: boolean;
  /** Godot 3 `control` / Godot 4 `ctrl_pressed`, sourced from the host event when present. */
  control?: boolean;
  alt_pressed?: boolean;
  shift_pressed?: boolean;
  meta_pressed?: boolean;
  command_or_control_autoremap?: boolean;
  position?: Vector2;
  global_position?: Vector2;
  relative?: Vector2;
  speed?: Vector2;
  velocity?: Vector2;
  button_mask?: number;
  scancode?: number;
  physical_scancode?: number;
  keycode?: number;
  physical_keycode?: number;
  unicode?: number;
  key_label?: number;
  button_index?: number;
  pressure?: number;
  factor?: number;
  double_click?: boolean;
  axis?: number;
  axis_value?: number;
  action?: string;
  strength?: number;
  as_text(): string;
}

type GodotModifierInputEventClass =
  | 'InputEventKey'
  | 'InputEventMouseButton'
  | 'InputEventMouseMotion';

/** The concrete InputEvent subclasses that inherit InputEventWithModifiers in both pinned APIs. */
export type GodotInputEventWithModifiers = GodotInputMapEvent & {
  readonly __godotClass: GodotModifierInputEventClass;
};

const RETAINED_INPUT_EVENTS = new WeakSet<object>();

function retainInputEvent<T extends GodotInputMapEvent | GodotScreenEvent>(event: T): T {
  RETAINED_INPUT_EVENTS.add(event);
  registerGodotObjectIdentity(event, event.__godotClass);
  return event;
}

/** Godot's value-like `InputEvent.new()`: a neutral event with no device-specific payload. */
export function createInputEvent(): GodotInputMapEvent {
  return retainInputEvent({
    __godotClass: 'InputEvent',
    device: 0,
    pressed: false,
    echo: false,
    canceled: false,
    as_text: () => '',
  });
}

export function isRetainedInputEvent(
  value: unknown,
): value is GodotInputMapEvent | GodotScreenEvent {
  return typeof value === 'object' && value !== null && RETAINED_INPUT_EVENTS.has(value);
}

/** Retained value portion of Godot's magnification gesture event. */
export interface GodotInputEventMagnifyGesture {
  factor: number;
}

function magnifyGesture(value: unknown): GodotInputEventMagnifyGesture {
  if (typeof value !== 'object' || value === null ||
      !Number.isFinite((value as Partial<GodotInputEventMagnifyGesture>).factor)) {
    throw new TypeError('InputEventMagnifyGesture.factor requires a retained finite gesture factor.');
  }
  return value as GodotInputEventMagnifyGesture;
}

export function getInputEventMagnifyFactor(event: unknown): number {
  return magnifyGesture(event).factor;
}

export function setInputEventMagnifyFactor(event: unknown, factor: unknown): void {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) {
    throw new TypeError('InputEventMagnifyGesture.factor requires a finite float.');
  }
  magnifyGesture(event).factor = factor;
}

/** Retained value portion of Godot's two-axis pan gesture event. */
export interface GodotInputEventPanGesture {
  delta: Vector2;
}

function panGesture(value: unknown): GodotInputEventPanGesture {
  const delta = typeof value === 'object' && value !== null
    ? (value as Partial<GodotInputEventPanGesture>).delta
    : undefined;
  if (delta === undefined || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new TypeError('InputEventPanGesture.delta requires a retained finite Vector2.');
  }
  return value as GodotInputEventPanGesture;
}

export function getInputEventPanDelta(event: unknown): Vector2 {
  return copyVector2(panGesture(event).delta);
}

export function setInputEventPanDelta(event: unknown, delta: Vector2): void {
  if (typeof delta !== 'object' || delta === null ||
      !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new TypeError('InputEventPanGesture.delta requires a finite Vector2.');
  }
  panGesture(event).delta = copyVector2(delta);
}

const GODOT3_SPECIAL_KEYS: Readonly<Record<string, number>> = {
  Escape: 16777217, Tab: 16777218, Backspace: 16777220, Enter: 16777221,
  NumpadEnter: 16777222, Insert: 16777223, Delete: 16777224, Pause: 16777225,
  PrintScreen: 16777226, Home: 16777229, End: 16777230, ArrowLeft: 16777231,
  ArrowUp: 16777232, ArrowRight: 16777233, ArrowDown: 16777234, PageUp: 16777235,
  PageDown: 16777236, ShiftLeft: 16777237, ControlLeft: 16777238, MetaLeft: 16777239,
  AltLeft: 16777240, Space: 32, NumpadMultiply: 16777345, NumpadDivide: 16777346,
  NumpadSubtract: 16777347, NumpadDecimal: 16777348, NumpadAdd: 16777349,
};

function godot3Scancode(code: string): number {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) return letter.charCodeAt(0);
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) return digit.charCodeAt(0);
  const f = /^F([1-9]|1[0-2])$/.exec(code)?.[1];
  if (f !== undefined) return 16777243 + Number(f);
  const keypad = /^Numpad([0-9])$/.exec(code)?.[1];
  if (keypad !== undefined) return 16777350 + Number(keypad);
  const value = GODOT3_SPECIAL_KEYS[code];
  if (value === undefined) {
    throw new Error(`godot-compat: InputMap cannot represent key code ${code} as Godot 3 InputEventKey.`);
  }
  return value;
}

function godot4Keycode(code: string): number {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) return letter.charCodeAt(0);
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) return digit.charCodeAt(0);
  if (code === 'Space') return 32;
  const entry = Object.entries(GODOT4_SPECIAL_KEYS).find(([, codes]) => codes.includes(code));
  if (entry !== undefined) return Number(entry[0]);
  throw new Error(`godot-compat: InputMap cannot represent key code ${code} as Godot 4 InputEventKey.`);
}

function inputMapEvent(binding: InputBinding): GodotInputMapEvent {
  const common = {
    [INPUT_BINDING]: structuredClone(binding),
    device: 0,
    pressed: false,
    echo: false,
    canceled: false,
    command_or_control_autoremap: false,
  };
  if (binding.type === 'key') {
    const event: GodotInputMapEvent = {
      ...common,
      __godotClass: 'InputEventKey',
      control: false,
      scancode: godot3Scancode(binding.code),
      physical_scancode: godot3Scancode(binding.code),
      keycode: 0,
      physical_keycode: godot4Keycode(binding.code),
      as_text: () => binding.code.replace(/^Key/, '').replace(/^Digit/, ''),
    };
    return retainInputEvent({ ...event, [INPUT_BINDING_IDENTITY]: inputEventBindingIdentity(event) });
  }
  if (binding.type === 'mouse_button') {
    const godotButton = binding.button === 0 ? 1 : binding.button === 2 ? 2 : binding.button === 1 ? 3 : binding.button;
    const event: GodotInputMapEvent = { ...common, __godotClass: 'InputEventMouseButton', control: false, button_index: godotButton, button_mask: 0, as_text: () => `Mouse Button ${godotButton}` };
    return retainInputEvent({ ...event, [INPUT_BINDING_IDENTITY]: inputEventBindingIdentity(event) });
  }
  if (binding.type === 'gamepad_button') {
    const event: GodotInputMapEvent = { ...common, __godotClass: 'InputEventJoypadButton', button_index: binding.button, as_text: () => `Joypad Button ${binding.button}` };
    return retainInputEvent({ ...event, [INPUT_BINDING_IDENTITY]: inputEventBindingIdentity(event) });
  }
  if (binding.type === 'gamepad_axis') {
    const axisValue = binding.direction === 'positive' ? 1 : -1;
    const event: GodotInputMapEvent = { ...common, __godotClass: 'InputEventJoypadMotion', axis: binding.axis, axis_value: axisValue, as_text: () => `Joypad Axis ${binding.axis} ${axisValue}` };
    return retainInputEvent({ ...event, [INPUT_BINDING_IDENTITY]: inputEventBindingIdentity(event) });
  }
  throw new Error(
    `godot-compat: InputMap cannot expose engine binding ${binding.type} as a Godot 3 InputEvent.`,
  );
}

function codeFromGodot3Scancode(scancode: number): string | undefined {
  if (scancode >= 65 && scancode <= 90) return `Key${String.fromCharCode(scancode)}`;
  if (scancode >= 48 && scancode <= 57) return `Digit${String.fromCharCode(scancode)}`;
  if (scancode >= 16777244 && scancode <= 16777255) return `F${scancode - 16777243}`;
  if (scancode >= 16777350 && scancode <= 16777359) return `Numpad${scancode - 16777350}`;
  return Object.entries(GODOT3_SPECIAL_KEYS).find(([, value]) => value === scancode)?.[0];
}

// Godot 4.7 `core/os/keyboard.h` keeps printable key values at their Unicode
// code point and places named keys in the `1 << 22` SPECIAL range. These are
// the keyboard identities represented by the host's KeyboardEvent.code state.
const GODOT4_SPECIAL_KEYS: Readonly<Record<number, readonly string[]>> = {
  4194305: ['Escape'],
  4194306: ['Tab'],
  4194308: ['Backspace'],
  4194309: ['Enter'],
  4194310: ['NumpadEnter'],
  4194311: ['Insert'],
  4194312: ['Delete'],
  4194313: ['Pause'],
  4194314: ['PrintScreen'],
  4194317: ['Home'],
  4194318: ['End'],
  4194319: ['ArrowLeft'],
  4194320: ['ArrowUp'],
  4194321: ['ArrowRight'],
  4194322: ['ArrowDown'],
  4194323: ['PageUp'],
  4194324: ['PageDown'],
  4194325: ['ShiftLeft', 'ShiftRight'],
  4194326: ['ControlLeft', 'ControlRight'],
  4194327: ['MetaLeft', 'MetaRight'],
  4194328: ['AltLeft', 'AltRight'],
  4194329: ['CapsLock'],
  4194330: ['NumLock'],
  4194331: ['ScrollLock'],
  4194332: ['F1'],
  4194333: ['F2'],
  4194334: ['F3'],
  4194335: ['F4'],
  4194336: ['F5'],
  4194337: ['F6'],
  4194338: ['F7'],
  4194339: ['F8'],
  4194340: ['F9'],
  4194341: ['F10'],
  4194342: ['F11'],
  4194343: ['F12'],
  4194433: ['NumpadMultiply'],
  4194434: ['NumpadDivide'],
  4194435: ['NumpadSubtract'],
  4194436: ['NumpadDecimal'],
  4194437: ['NumpadAdd'],
  4194438: ['Numpad0'],
  4194439: ['Numpad1'],
  4194440: ['Numpad2'],
  4194441: ['Numpad3'],
  4194442: ['Numpad4'],
  4194443: ['Numpad5'],
  4194444: ['Numpad6'],
  4194445: ['Numpad7'],
  4194446: ['Numpad8'],
  4194447: ['Numpad9'],
};

const GODOT4_KEY_CODE_MASK = (1 << 23) - 1;
const GODOT4_PRINTABLE_PHYSICAL_CODES: Readonly<Record<number, string>> = {
  39: 'Quote',
  44: 'Comma',
  45: 'Minus',
  46: 'Period',
  47: 'Slash',
  59: 'Semicolon',
  61: 'Equal',
  91: 'BracketLeft',
  92: 'Backslash',
  93: 'BracketRight',
  96: 'Backquote',
  165: 'IntlYen',
};

/**
 * W3C `KeyboardEvent.code` positions represented by one Godot 4 physical Key.
 *
 * This is the inverse of pinned 4.7 `platform/web/dom_keys.inc`'s physical branch. Modifiers are
 * deliberately stripped with `KeyModifierMask::CODE_MASK`; DisplayServer reattaches the exact
 * authored mask after resolving the active layout.
 */
export function godot4DomCodesForPhysicalKeycode(keycode: number): readonly string[] | undefined {
  if (!Number.isSafeInteger(keycode) || keycode < 0) return undefined;
  const physical = keycode & GODOT4_KEY_CODE_MASK;
  if (physical >= 65 && physical <= 90) return [`Key${String.fromCharCode(physical)}`];
  if (physical >= 48 && physical <= 57) return [`Digit${String.fromCharCode(physical)}`];
  if (physical === 32) return ['Space'];
  const printable = GODOT4_PRINTABLE_PHYSICAL_CODES[physical];
  if (printable !== undefined) return [printable];
  return GODOT4_SPECIAL_KEYS[physical];
}

function domCodesForGodotKey(keycode: number, major: 3 | 4): readonly string[] {
  if (!Number.isInteger(keycode)) {
    throw new Error('godot-compat: Input.is_key_pressed requires an integer Godot keycode.');
  }
  if (keycode >= 65 && keycode <= 90) return [`Key${String.fromCharCode(keycode)}`];
  if (keycode >= 48 && keycode <= 57) return [`Digit${String.fromCharCode(keycode)}`];
  if (keycode === 32) return ['Space'];
  if (major === 4) {
    const codes = GODOT4_SPECIAL_KEYS[keycode];
    if (codes !== undefined) return codes;
  } else {
    const code = codeFromGodot3Scancode(keycode);
    if (code !== undefined) {
      if (code === 'ShiftLeft') return ['ShiftLeft', 'ShiftRight'];
      if (code === 'ControlLeft') return ['ControlLeft', 'ControlRight'];
      if (code === 'MetaLeft') return ['MetaLeft', 'MetaRight'];
      if (code === 'AltLeft') return ['AltLeft', 'AltRight'];
      return [code];
    }
  }
  throw new Error(
    `godot-compat: Input.is_key_pressed cannot represent Godot ${major} keycode ${keycode} ` +
      'through the host KeyboardEvent.code contract.',
  );
}

/** Godot's value-like `InputEventKey.new()`: no host binding is invented until a keycode is set. */
export function createInputEventKey(major: 3 | 4): GodotInputMapEvent {
  return retainInputEvent({
    __godotClass: 'InputEventKey',
    device: major === 4 ? 16 : 0,
    pressed: false,
    echo: false,
    canceled: false,
    control: false,
    alt_pressed: false,
    shift_pressed: false,
    meta_pressed: false,
    command_or_control_autoremap: false,
    scancode: 0,
    physical_scancode: 0,
    keycode: 0,
    physical_keycode: 0,
    unicode: 0,
    key_label: 0,
    as_text: () => '',
  });
}

/** Godot's value-like `InputEventMouseButton.new()` over authored fields only. */
export function createInputEventMouseButton(major: 3 | 4): GodotInputMapEvent {
  return retainInputEvent({
    __godotClass: 'InputEventMouseButton',
    device: major === 4 ? 32 : 0,
    pressed: false,
    echo: false,
    canceled: false,
    control: false,
    alt_pressed: false,
    shift_pressed: false,
    meta_pressed: false,
    command_or_control_autoremap: false,
    button_index: 0,
    factor: 1,
    double_click: false,
    button_mask: 0,
    position: vec2(0, 0),
    global_position: vec2(0, 0),
    as_text: () => 'Mouse Button 0',
  });
}

/** Godot's value-like `InputEventMouseMotion.new()` with dialect-native zero defaults. */
export function createInputEventMouseMotion(major: 3 | 4): GodotInputMapEvent {
  return retainInputEvent({
    __godotClass: 'InputEventMouseMotion',
    device: major === 4 ? 32 : 0,
    pressed: false,
    echo: false,
    canceled: false,
    control: false,
    alt_pressed: false,
    shift_pressed: false,
    meta_pressed: false,
    command_or_control_autoremap: false,
    position: vec2(0, 0),
    global_position: vec2(0, 0),
    relative: vec2(0, 0),
    speed: vec2(0, 0),
    velocity: vec2(0, 0),
    button_mask: 0,
    pressure: 0,
    as_text: () => 'Mouse Motion',
  });
}

/** Complete mouse InputEvent snapshot for an emitted `_input` branch whose source type test has
 * already selected one concrete subclass. Translation owns that guard; compat owns construction
 * from the mounted engine input state so the event may cross ordinary project method boundaries. */
export function godotPolledInputEvent(
  input: GodotInput,
  major: 3 | 4,
  eventClass: 'InputEventMouseButton' | 'InputEventMouseMotion',
): GodotInputMapEvent {
  const position = copyVector2(input.getMousePosition());
  const controlKey = major === 3 ? 16777238 : 4194326;
  if (eventClass === 'InputEventMouseButton') {
    if (!input.hasMouseButtonEvent()) {
      throw new Error('godot-compat: polled InputEventMouseButton requested without a mouse-button edge.');
    }
    const event = createInputEventMouseButton(major);
    event.button_index = input.getMouseButtonEventIndex();
    event.pressed = input.isMouseButtonEventPressed();
    event.button_mask = input.getMouseButtonMask();
    event.position = position;
    event.global_position = copyVector2(position);
    event.control = input.isKeyPressed(controlKey);
    event.as_text = () => `Mouse Button ${event.button_index ?? 0}`;
    return event;
  }
  if (!input.hasMouseMotion()) {
    throw new Error('godot-compat: polled InputEventMouseMotion requested without mouse motion.');
  }
  const event = createInputEventMouseMotion(major);
  const relative = copyVector2(input.getMouseRelative());
  event.position = position;
  event.global_position = copyVector2(position);
  event.relative = relative;
  event.speed = copyVector2(relative);
  event.velocity = copyVector2(relative);
  event.button_mask = input.getMouseButtonMask();
  event.control = input.isKeyPressed(controlKey);
  return event;
}

/** Godot's authored action event. It is a value until Input.parse_input_event consumes it. */
const GODOT_INPUT_EVENT_ACTIONS = new WeakSet<object>();

export function isGodotInputEventAction(value: unknown): value is GodotInputMapEvent {
  return typeof value === 'object' && value !== null && GODOT_INPUT_EVENT_ACTIONS.has(value);
}

export function createInputEventAction(): GodotInputMapEvent {
  const event: GodotInputMapEvent = {
    __godotClass: 'InputEventAction',
    device: 0,
    pressed: false,
    echo: false,
    canceled: false,
    action: '',
    strength: 1,
    as_text: () => '',
  };
  GODOT_INPUT_EVENT_ACTIONS.add(event);
  return retainInputEvent(event);
}

export function createInputEventJoypadButton(): GodotInputMapEvent {
  return retainInputEvent({
    __godotClass: 'InputEventJoypadButton',
    device: 0,
    pressed: false,
    echo: false,
    canceled: false,
    button_index: 0,
    pressure: 0,
    as_text: () => 'Joypad Button 0',
  });
}

export function createInputEventJoypadMotion(): GodotInputMapEvent {
  return retainInputEvent({
    __godotClass: 'InputEventJoypadMotion',
    device: 0,
    pressed: false,
    echo: false,
    canceled: false,
    axis: 0,
    axis_value: 0,
    as_text: () => 'Joypad Axis 0 0',
  });
}

export function isInputEventPressed(event: GodotInputMapEvent | GodotScreenEvent): boolean {
  if (event.canceled) return false;
  if ('kind' in event) return event.pressed;
  if (event.__godotClass === 'InputEventJoypadMotion') return Math.abs(event.axis_value ?? 0) >= 0.5;
  return event.pressed;
}

export function isInputEventReleased(event: GodotInputMapEvent | GodotScreenEvent): boolean {
  return !isInputEventPressed(event);
}

/** `InputEvent.as_text()` delegates to the event class's pinned textual representation. */
export function inputEventAsText(event: GodotInputMapEvent | GodotScreenEvent): string {
  if (typeof event.as_text !== 'function') {
    throw new Error('godot-compat: InputEvent.as_text requires a retained InputEvent identity.');
  }
  return event.as_text();
}

/** Concrete event classes whose Godot source override reports an actionable input event. */
export function isInputEventActionType(event: GodotInputMapEvent | GodotScreenEvent): boolean {
  return event.__godotClass === 'InputEventKey' ||
    event.__godotClass === 'InputEventMouseButton' ||
    event.__godotClass === 'InputEventJoypadButton' ||
    event.__godotClass === 'InputEventJoypadMotion' ||
    event.__godotClass === 'InputEventAction';
}

export function getInputEventDevice(event: GodotInputMapEvent | GodotScreenEvent): number {
  return event.device;
}

export function setInputEventDevice(
  event: GodotInputMapEvent | GodotScreenEvent,
  device: number,
): void {
  if (!Number.isInteger(device)) {
    throw new TypeError(`InputEvent.device requires an integer device ID; received ${device}.`);
  }
  event.device = device;
}

/** Base InputEvent returns false; InputEventKey returns its native repeat flag. */
export function isInputEventEcho(event: GodotInputMapEvent | GodotScreenEvent): boolean {
  return !('kind' in event) && event.__godotClass === 'InputEventKey' && event.echo;
}

export function setInputEventKeyEcho(event: GodotInputMapEvent, echo: boolean): void {
  if (event.__godotClass !== 'InputEventKey' || typeof echo !== 'boolean') {
    throw new Error('godot-compat: InputEventKey.echo requires an InputEventKey and boolean value.');
  }
  event.echo = echo;
}

export function setInputEventPressed(event: GodotInputMapEvent, pressed: boolean): void {
  if (event.__godotClass === 'InputEventJoypadMotion') {
    throw new Error('godot-compat: InputEventJoypadMotion pressed is derived from axis_value.');
  }
  event.pressed = pressed;
}

export function getInputEventScancode(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventKey') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventKey.`);
  }
  return event.scancode ?? 0;
}

export function setInputEventScancode(event: GodotInputMapEvent, scancode: number): void {
  if (event.__godotClass !== 'InputEventKey' || !Number.isInteger(scancode)) {
    throw new Error('godot-compat: InputEventKey.scancode requires an integer Godot keycode.');
  }
  event.scancode = scancode;
}

export function getInputEventPhysicalScancode(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventKey') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventKey.`);
  }
  return event.physical_scancode ?? 0;
}

export function setInputEventPhysicalScancode(event: GodotInputMapEvent, scancode: number): void {
  if (event.__godotClass !== 'InputEventKey' || !Number.isInteger(scancode) || scancode < 0) {
    throw new Error('godot-compat: InputEventKey.physical_scancode requires a non-negative integer keycode.');
  }
  event.physical_scancode = scancode;
}

export function getInputEventKeycode(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventKey') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventKey.`);
  }
  return event.keycode ?? 0;
}

export function setInputEventKeycode(event: GodotInputMapEvent, keycode: number): void {
  if (event.__godotClass !== 'InputEventKey' || !Number.isInteger(keycode) || keycode < 0) {
    throw new Error('godot-compat: InputEventKey.keycode requires a non-negative integer Key value.');
  }
  event.keycode = keycode;
}

export function getInputEventPhysicalKeycode(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventKey') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventKey.`);
  }
  return event.physical_keycode ?? 0;
}

export function setInputEventPhysicalKeycode(event: GodotInputMapEvent, keycode: number): void {
  if (event.__godotClass !== 'InputEventKey' || !Number.isInteger(keycode) || keycode < 0) {
    throw new Error(
      'godot-compat: InputEventKey.physical_keycode requires a non-negative integer Key value.',
    );
  }
  event.physical_keycode = keycode;
}

function inputEventKeyModifiers(
  event: GodotInputMapEvent,
  masks: Readonly<{ shift: number; alt: number; meta: number; control: number }>,
): number {
  if (event.__godotClass !== 'InputEventKey') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventKey.`);
  }
  return (event.shift_pressed === true ? masks.shift : 0) |
    (event.alt_pressed === true ? masks.alt : 0) |
    (event.meta_pressed === true ? masks.meta : 0) |
    (event.control === true ? masks.control : 0);
}

const GODOT3_KEY_MODIFIER_MASKS = {
  shift: 1 << 25,
  alt: 1 << 26,
  meta: 1 << 27,
  control: 1 << 28,
} as const;

const GODOT4_KEY_MODIFIER_MASKS = {
  shift: 1 << 25,
  alt: 1 << 26,
  meta: 1 << 27,
  control: 1 << 28,
} as const;

/** Godot 3's logical scancode with the retained Shift/Alt/Meta/Control mask. */
export function getInputEventScancodeWithModifiers(event: GodotInputMapEvent): number {
  return getInputEventScancode(event) | inputEventKeyModifiers(event, GODOT3_KEY_MODIFIER_MASKS);
}

/** Godot 3's physical scancode with the retained Shift/Alt/Meta/Control mask. */
export function getInputEventPhysicalScancodeWithModifiers(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventKey') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventKey.`);
  }
  return getInputEventPhysicalScancode(event) |
    inputEventKeyModifiers(event, GODOT3_KEY_MODIFIER_MASKS);
}

/** Godot 4's logical keycode with the retained Shift/Alt/Meta/Control mask. */
export function getInputEventKeycodeWithModifiers(event: GodotInputMapEvent): number {
  return getInputEventKeycode(event) | inputEventKeyModifiers(event, GODOT4_KEY_MODIFIER_MASKS);
}

/** Godot 4's physical keycode with the retained Shift/Alt/Meta/Control mask. */
export function getInputEventPhysicalKeycodeWithModifiers(event: GodotInputMapEvent): number {
  return getInputEventPhysicalKeycode(event) |
    inputEventKeyModifiers(event, GODOT4_KEY_MODIFIER_MASKS);
}

export function inputEventKeyAsTextKeycode(event: GodotInputMapEvent): string {
  return godotOsGetKeycodeString(getInputEventKeycodeWithModifiers(event));
}

export function inputEventKeyAsTextPhysicalKeycode(event: GodotInputMapEvent): string {
  return godotOsGetKeycodeString(getInputEventPhysicalKeycodeWithModifiers(event));
}

export function getInputEventAction(event: GodotInputMapEvent): string {
  if (event.__godotClass !== 'InputEventAction') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventAction.`);
  }
  return event.action ?? '';
}

export function setInputEventAction(event: GodotInputMapEvent, action: string): void {
  if (event.__godotClass !== 'InputEventAction') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventAction.`);
  }
  event.action = action;
}

export function getInputEventActionStrength(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventAction') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventAction.`);
  }
  return event.strength ?? 1;
}

export function setInputEventActionStrength(event: GodotInputMapEvent, strength: number): void {
  if (event.__godotClass !== 'InputEventAction') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventAction.`);
  }
  event.strength = Math.max(0, Math.min(1, strength));
}

export function getInputEventJoypadAxis(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventJoypadMotion') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventJoypadMotion.`);
  }
  return event.axis ?? 0;
}

export function setInputEventJoypadAxis(event: GodotInputMapEvent, axis: number): void {
  if (event.__godotClass !== 'InputEventJoypadMotion' || !Number.isInteger(axis)) {
    throw new Error('godot-compat: InputEventJoypadMotion.axis requires an integer axis.');
  }
  event.axis = axis;
}

export function getInputEventJoypadAxisValue(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventJoypadMotion') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventJoypadMotion.`);
  }
  return event.axis_value ?? 0;
}

export function setInputEventJoypadAxisValue(event: GodotInputMapEvent, value: number): void {
  if (event.__godotClass !== 'InputEventJoypadMotion' || !Number.isFinite(value)) {
    throw new Error('godot-compat: InputEventJoypadMotion.axis_value requires a finite number.');
  }
  event.axis_value = value;
  event.pressed = Math.abs(value) >= 0.5;
}

export function getInputEventButtonIndex(event: GodotInputMapEvent): number {
  if (
    event.__godotClass !== 'InputEventMouseButton' &&
    event.__godotClass !== 'InputEventJoypadButton'
  ) {
    throw new Error(`godot-compat: ${event.__godotClass} has no button_index.`);
  }
  return event.button_index ?? 0;
}

/** `InputEventMouseButton.get_button_index()` preserves the concrete mouse-event contract. */
export function getInputEventMouseButtonIndex(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventMouseButton') {
    throw new TypeError(`godot-compat: ${event.__godotClass} is not an InputEventMouseButton.`);
  }
  return event.button_index ?? 0;
}

interface NativeModifierEvent {
  readonly ctrlKey: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
}

function isNativeModifierEvent(value: unknown): value is NativeModifierEvent {
  return typeof value === 'object' && value !== null && typeof (value as { ctrlKey?: unknown }).ctrlKey === 'boolean';
}

function isGodotInputEventWithModifiers(
  event: GodotInputMapEvent,
): event is GodotInputEventWithModifiers {
  return (
    event.__godotClass === 'InputEventKey' ||
    event.__godotClass === 'InputEventMouseButton' ||
    event.__godotClass === 'InputEventMouseMotion'
  );
}

/**
 * Godot 3 `get_control` / Godot 4 `is_ctrl_pressed` over either a retained modifier event or the
 * browser event that carries it. InputEventAction and joypad events do not inherit
 * InputEventWithModifiers, so accepting them here would fabricate a property their source class
 * does not own.
 */
export function isInputEventControlPressed(event: GodotInputMapEvent | NativeModifierEvent): boolean {
  if (isNativeModifierEvent(event)) return event.ctrlKey;
  if (!isGodotInputEventWithModifiers(event)) {
    throw new TypeError(
      `godot-compat: ${event.__godotClass} does not inherit InputEventWithModifiers.`,
    );
  }
  return event.control ?? false;
}

/** Godot 3 `set_control` / Godot 4 `set_ctrl_pressed` on a retained event value. */
export function setInputEventControlPressed(
  event: GodotInputMapEvent | NativeModifierEvent,
  pressed: boolean,
): void {
  if (typeof pressed !== 'boolean') {
    throw new TypeError('InputEventWithModifiers control state requires bool.');
  }
  if (isNativeModifierEvent(event)) {
    throw new Error('InputEventWithModifiers control state is read-only on a native browser event.');
  }
  if (!isGodotInputEventWithModifiers(event)) {
    throw new TypeError(
      `godot-compat: ${event.__godotClass} does not inherit InputEventWithModifiers.`,
    );
  }
  event.control = pressed;
}

type RetainedModifierField = 'control' | 'alt_pressed' | 'shift_pressed' | 'meta_pressed';

function readInputEventModifier(
  event: GodotInputMapEvent | NativeModifierEvent,
  field: RetainedModifierField,
  nativeField: keyof NativeModifierEvent,
): boolean {
  if (isNativeModifierEvent(event)) return event[nativeField] === true;
  if (!isGodotInputEventWithModifiers(event)) {
    throw new TypeError(
      `godot-compat: ${event.__godotClass} does not inherit InputEventWithModifiers.`,
    );
  }
  return event[field] ?? false;
}

function writeInputEventModifier(
  event: GodotInputMapEvent | NativeModifierEvent,
  field: RetainedModifierField,
  pressed: boolean,
  sourceName: string,
): void {
  if (typeof pressed !== 'boolean') {
    throw new TypeError(`InputEventWithModifiers ${sourceName} state requires bool.`);
  }
  if (isNativeModifierEvent(event)) {
    throw new Error(
      `InputEventWithModifiers ${sourceName} state is read-only on a native browser event.`,
    );
  }
  if (!isGodotInputEventWithModifiers(event)) {
    throw new TypeError(
      `godot-compat: ${event.__godotClass} does not inherit InputEventWithModifiers.`,
    );
  }
  event[field] = pressed;
}

/** Godot 3 `alt` / `get_alt` over the retained modifier bit or native Alt key. */
export function isInputEventAltPressed(
  event: GodotInputMapEvent | NativeModifierEvent,
): boolean {
  return readInputEventModifier(event, 'alt_pressed', 'altKey');
}

/** Godot 3 `set_alt` on a retained InputEventWithModifiers value. */
export function setInputEventAltPressed(
  event: GodotInputMapEvent | NativeModifierEvent,
  pressed: boolean,
): void {
  writeInputEventModifier(event, 'alt_pressed', pressed, 'alt');
}

/** Godot 3 `shift` / `get_shift` over the retained modifier bit or native Shift key. */
export function isInputEventShiftPressed(
  event: GodotInputMapEvent | NativeModifierEvent,
): boolean {
  return readInputEventModifier(event, 'shift_pressed', 'shiftKey');
}

/** Godot 3 `set_shift` on a retained InputEventWithModifiers value. */
export function setInputEventShiftPressed(
  event: GodotInputMapEvent | NativeModifierEvent,
  pressed: boolean,
): void {
  writeInputEventModifier(event, 'shift_pressed', pressed, 'shift');
}

/** Godot 3 `meta` / `get_meta` over the retained modifier bit or native Meta key. */
export function isInputEventMetaPressed(
  event: GodotInputMapEvent | NativeModifierEvent,
): boolean {
  return readInputEventModifier(event, 'meta_pressed', 'metaKey');
}

/** Godot 3 `set_meta` on a retained InputEventWithModifiers value. */
export function setInputEventMetaPressed(
  event: GodotInputMapEvent | NativeModifierEvent,
  pressed: boolean,
): void {
  writeInputEventModifier(event, 'meta_pressed', pressed, 'meta');
}

function hostUsesMetaAsCommand(): boolean {
  if (typeof navigator === 'undefined') return false;
  const navigatorWithUserAgentData = navigator as Navigator & {
    readonly userAgentData?: { readonly platform?: string };
  };
  const platform = navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform;
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform);
}

/**
 * Godot 3's platform `command` abstraction: Meta on Apple hosts, Control elsewhere.
 * This deliberately does not alias command to Control on macOS/iOS.
 */
export function isInputEventCommandPressed(
  event: GodotInputMapEvent | NativeModifierEvent,
): boolean {
  return hostUsesMetaAsCommand()
    ? readInputEventModifier(event, 'meta_pressed', 'metaKey')
    : readInputEventModifier(event, 'control', 'ctrlKey');
}

/** Godot 3 `set_command`, writing the platform-specific retained modifier bit. */
export function setInputEventCommandPressed(
  event: GodotInputMapEvent | NativeModifierEvent,
  pressed: boolean,
): void {
  if (hostUsesMetaAsCommand()) {
    writeInputEventModifier(event, 'meta_pressed', pressed, 'command');
  } else {
    writeInputEventModifier(event, 'control', pressed, 'command');
  }
}

export function isInputEventCommandOrControlAutoremap(event: GodotInputMapEvent): boolean {
  if (!isGodotInputEventWithModifiers(event)) {
    throw new TypeError(`godot-compat: ${event.__godotClass} does not inherit InputEventWithModifiers.`);
  }
  return event.command_or_control_autoremap ?? false;
}

export function setInputEventCommandOrControlAutoremap(
  event: GodotInputMapEvent,
  enabled: boolean,
): void {
  if (!isGodotInputEventWithModifiers(event) || typeof enabled !== 'boolean') {
    throw new TypeError('InputEventWithModifiers.command_or_control_autoremap requires bool.');
  }
  event.command_or_control_autoremap = enabled;
}

export function isInputEventCommandOrControlPressed(event: GodotInputMapEvent): boolean {
  if (isInputEventCommandOrControlAutoremap(event)) {
    return isInputEventControlPressed(event) || isInputEventMetaPressed(event);
  }
  return isInputEventCommandPressed(event);
}

export function setInputEventButtonIndex(event: GodotInputMapEvent, buttonIndex: number): void {
  if (
    (event.__godotClass !== 'InputEventMouseButton' &&
      event.__godotClass !== 'InputEventJoypadButton') ||
    !Number.isInteger(buttonIndex)
  ) {
    throw new Error('godot-compat: InputEvent button_index requires an integer button identity.');
  }
  event.button_index = buttonIndex;
}

export function getInputEventJoypadButtonPressure(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventJoypadButton') {
    throw new TypeError(`godot-compat: ${event.__godotClass} is not an InputEventJoypadButton.`);
  }
  return event.pressure ?? 0;
}

export function setInputEventJoypadButtonPressure(event: GodotInputMapEvent, pressure: number): void {
  if (event.__godotClass !== 'InputEventJoypadButton' || !Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
    throw new TypeError('godot-compat: InputEventJoypadButton.pressure requires a finite float in [0, 1].');
  }
  event.pressure = pressure;
}

export function getInputEventMouseButtonFactor(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventMouseButton') {
    throw new TypeError(`godot-compat: ${event.__godotClass} is not an InputEventMouseButton.`);
  }
  return event.factor ?? 1;
}

export function setInputEventMouseButtonFactor(event: GodotInputMapEvent, factor: number): void {
  if (event.__godotClass !== 'InputEventMouseButton' || !Number.isFinite(factor)) {
    throw new TypeError('godot-compat: InputEventMouseButton.factor requires a finite float.');
  }
  event.factor = factor;
}

/** InputEventMouseButton.set_button_index without widening to joypad event values. */
export function setInputEventMouseButtonIndex(
  event: GodotInputMapEvent,
  buttonIndex: number,
): void {
  if (event.__godotClass !== 'InputEventMouseButton' || !Number.isInteger(buttonIndex)) {
    throw new TypeError(
      'godot-compat: InputEventMouseButton.button_index requires an integer button identity.',
    );
  }
  event.button_index = buttonIndex;
}

export function getInputEventMouseButtonDoubleClick(event: GodotInputMapEvent): boolean {
  if (event.__godotClass !== 'InputEventMouseButton') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventMouseButton.`);
  }
  return event.double_click ?? false;
}

export function setInputEventMouseButtonDoubleClick(
  event: GodotInputMapEvent,
  doubleClick: boolean,
): void {
  if (event.__godotClass !== 'InputEventMouseButton' || typeof doubleClick !== 'boolean') {
    throw new TypeError('godot-compat: InputEventMouseButton.double_click requires bool.');
  }
  event.double_click = doubleClick;
}

export function getInputEventPosition(event: GodotInputMapEvent | GodotScreenEvent): Vector2 {
  const position = event.position;
  if (position === undefined) throw new Error(`godot-compat: ${'kind' in event ? event.kind : event.__godotClass} has no position.`);
  return vec2(position.x, position.y);
}

export function setInputEventPosition(
  event: GodotInputMapEvent | GodotScreenEvent,
  position: Vector2,
): void {
  if (
    event.__godotClass !== 'InputEventMouseButton' &&
    event.__godotClass !== 'InputEventMouseMotion' &&
    event.__godotClass !== 'InputEventScreenTouch' &&
    event.__godotClass !== 'InputEventScreenDrag'
  ) {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventMouse.`);
  }
  event.position = vec2(position.x, position.y);
}

type MouseMotionVectorMember = 'relative' | 'velocity';

export function getInputEventMouseMotionVector(
  event: GodotInputMapEvent,
  member: MouseMotionVectorMember,
): Vector2 {
  const value = event[member];
  if (event.__godotClass !== 'InputEventMouseMotion' || value === undefined) {
    throw new TypeError(`godot-compat: ${event.__godotClass}.${member} is not a retained mouse-motion vector.`);
  }
  return copyVector2(value);
}

export function setInputEventMouseMotionVector(
  event: GodotInputMapEvent,
  member: MouseMotionVectorMember,
  value: unknown,
): void {
  if (event.__godotClass !== 'InputEventMouseMotion') {
    throw new TypeError(`godot-compat: ${event.__godotClass}.${member} is not a mouse-motion vector.`);
  }
  event[member] = screenVector(value, `InputEventMouseMotion.${member}`);
}

export function getInputEventKeyUnicode(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventKey') {
    throw new TypeError(`godot-compat: ${event.__godotClass} is not an InputEventKey.`);
  }
  return event.unicode ?? 0;
}

export function setInputEventKeyUnicode(event: GodotInputMapEvent, unicode: number): void {
  if (
    event.__godotClass !== 'InputEventKey' || !Number.isSafeInteger(unicode) ||
    unicode < 0 || unicode > 0x10ffff || (unicode >= 0xd800 && unicode <= 0xdfff)
  ) {
    throw new TypeError('godot-compat: InputEventKey.unicode requires a Unicode scalar integer.');
  }
  event.unicode = unicode;
}

export function getInputEventKeyLabel(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventKey' || event.key_label === undefined) {
    throw new TypeError('godot-compat: InputEventKey.key_label requires retained key-label state.');
  }
  return event.key_label;
}

export function setInputEventKeyLabel(event: GodotInputMapEvent, label: number): void {
  if (event.__godotClass !== 'InputEventKey' || !Number.isSafeInteger(label) || label < 0) {
    throw new TypeError('godot-compat: InputEventKey.key_label requires a non-negative integer.');
  }
  event.key_label = label;
}

export function getInputEventMouseMotionPressure(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventMouseMotion') {
    throw new TypeError(`godot-compat: ${event.__godotClass} is not an InputEventMouseMotion.`);
  }
  return event.pressure ?? 0;
}

export function setInputEventMouseMotionPressure(
  event: GodotInputMapEvent,
  pressure: number,
): void {
  if (event.__godotClass !== 'InputEventMouseMotion') {
    throw new TypeError(`godot-compat: ${event.__godotClass} is not an InputEventMouseMotion.`);
  }
  if (!Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
    throw new RangeError('godot-compat: InputEventMouseMotion.pressure requires a float in [0, 1].');
  }
  event.pressure = pressure;
}

function retainedScreenEvent(
  event: unknown,
  expected?: GodotScreenEvent['__godotClass'],
): GodotScreenEvent {
  if (
    typeof event !== 'object' || event === null ||
    !('__godotClass' in event) ||
    ((event as { __godotClass?: unknown }).__godotClass !== 'InputEventScreenTouch' &&
      (event as { __godotClass?: unknown }).__godotClass !== 'InputEventScreenDrag')
  ) {
    throw new TypeError('godot-compat: operation requires a retained screen input event.');
  }
  const result = event as GodotScreenEvent;
  if (expected !== undefined && result.__godotClass !== expected) {
    throw new TypeError(`godot-compat: ${result.__godotClass} is not ${expected}.`);
  }
  return result;
}

function screenVector(value: unknown, member: string): Vector2 {
  if (
    typeof value !== 'object' || value === null ||
    typeof (value as { x?: unknown }).x !== 'number' ||
    typeof (value as { y?: unknown }).y !== 'number' ||
    !Number.isFinite((value as { x: number }).x) ||
    !Number.isFinite((value as { y: number }).y)
  ) {
    throw new TypeError(`${member} requires a finite Vector2.`);
  }
  return vec2((value as { x: number }).x, (value as { y: number }).y);
}

export function getInputEventScreenIndex(event: unknown): number {
  return retainedScreenEvent(event).index;
}

export function setInputEventScreenIndex(event: unknown, index: unknown): void {
  if (typeof index !== 'number' || !Number.isSafeInteger(index)) {
    throw new TypeError('InputEventScreen index requires an integer.');
  }
  retainedScreenEvent(event).index = index;
}

export function getInputEventScreenPosition(event: unknown): Vector2 {
  return copyVector2(retainedScreenEvent(event).position);
}

export function setInputEventScreenPosition(event: unknown, position: unknown): void {
  retainedScreenEvent(event).position = screenVector(position, 'InputEventScreen.position');
}

export function isInputEventScreenTouchPressed(event: unknown): boolean {
  return retainedScreenEvent(event, 'InputEventScreenTouch').pressed;
}

export function setInputEventScreenTouchPressed(event: unknown, pressed: unknown): void {
  if (typeof pressed !== 'boolean') throw new TypeError('InputEventScreenTouch.pressed requires bool.');
  retainedScreenEvent(event, 'InputEventScreenTouch').pressed = pressed;
}

export function isInputEventScreenTouchCanceled(event: unknown): boolean {
  return retainedScreenEvent(event, 'InputEventScreenTouch').canceled;
}

export function setInputEventScreenTouchCanceled(event: unknown, canceled: unknown): void {
  if (typeof canceled !== 'boolean') throw new TypeError('InputEventScreenTouch.canceled requires bool.');
  retainedScreenEvent(event, 'InputEventScreenTouch').canceled = canceled;
}

export function isInputEventScreenTouchDoubleTap(event: unknown): boolean {
  return retainedScreenEvent(event, 'InputEventScreenTouch').double_tap;
}

export function setInputEventScreenTouchDoubleTap(event: unknown, doubleTap: unknown): void {
  if (typeof doubleTap !== 'boolean') throw new TypeError('InputEventScreenTouch.double_tap requires bool.');
  retainedScreenEvent(event, 'InputEventScreenTouch').double_tap = doubleTap;
}

export function getInputEventScreenDragTilt(event: unknown): Vector2 {
  return copyVector2(retainedScreenEvent(event, 'InputEventScreenDrag').tilt);
}

export function setInputEventScreenDragTilt(event: unknown, tilt: unknown): void {
  retainedScreenEvent(event, 'InputEventScreenDrag').tilt = screenVector(tilt, 'InputEventScreenDrag.tilt');
}

export function getInputEventScreenDragPressure(event: unknown): number {
  return retainedScreenEvent(event, 'InputEventScreenDrag').pressure;
}

export function setInputEventScreenDragPressure(event: unknown, pressure: unknown): void {
  if (typeof pressure !== 'number' || !Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
    throw new RangeError('InputEventScreenDrag.pressure requires a finite float in [0, 1].');
  }
  retainedScreenEvent(event, 'InputEventScreenDrag').pressure = pressure;
}

export function isInputEventScreenDragPenInverted(event: unknown): boolean {
  return retainedScreenEvent(event, 'InputEventScreenDrag').pen_inverted;
}

export function setInputEventScreenDragPenInverted(event: unknown, inverted: unknown): void {
  if (typeof inverted !== 'boolean') throw new TypeError('InputEventScreenDrag.pen_inverted requires bool.');
  retainedScreenEvent(event, 'InputEventScreenDrag').pen_inverted = inverted;
}

type ScreenDragVectorMember = 'relative' | 'screen_relative' | 'velocity' | 'screen_velocity';

function getInputEventScreenDragVector(event: unknown, member: ScreenDragVectorMember): Vector2 {
  return copyVector2(retainedScreenEvent(event, 'InputEventScreenDrag')[member]);
}

function setInputEventScreenDragVector(
  event: unknown,
  member: ScreenDragVectorMember,
  value: unknown,
): void {
  retainedScreenEvent(event, 'InputEventScreenDrag')[member] =
    screenVector(value, `InputEventScreenDrag.${member}`);
}

export const getInputEventScreenDragRelative = (event: unknown): Vector2 =>
  getInputEventScreenDragVector(event, 'relative');
export const setInputEventScreenDragRelative = (event: unknown, value: unknown): void =>
  setInputEventScreenDragVector(event, 'relative', value);
export const getInputEventScreenDragScreenRelative = (event: unknown): Vector2 =>
  getInputEventScreenDragVector(event, 'screen_relative');
export const setInputEventScreenDragScreenRelative = (event: unknown, value: unknown): void =>
  setInputEventScreenDragVector(event, 'screen_relative', value);
export const getInputEventScreenDragVelocity = (event: unknown): Vector2 =>
  getInputEventScreenDragVector(event, 'velocity');
export const setInputEventScreenDragVelocity = (event: unknown, value: unknown): void =>
  setInputEventScreenDragVector(event, 'velocity', value);
export const getInputEventScreenDragScreenVelocity = (event: unknown): Vector2 =>
  getInputEventScreenDragVector(event, 'screen_velocity');
export const setInputEventScreenDragScreenVelocity = (event: unknown, value: unknown): void =>
  setInputEventScreenDragVector(event, 'screen_velocity', value);

export function getInputEventGlobalPosition(event: GodotInputMapEvent): Vector2 {
  if (event.__godotClass !== 'InputEventMouseButton' && event.__godotClass !== 'InputEventMouseMotion') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventMouse.`);
  }
  const position = event.global_position ?? event.position;
  if (position === undefined) throw new Error(`godot-compat: ${event.__godotClass} has no global_position.`);
  return vec2(position.x, position.y);
}

export function setInputEventGlobalPosition(event: GodotInputMapEvent, position: Vector2): void {
  if (event.__godotClass !== 'InputEventMouseButton' && event.__godotClass !== 'InputEventMouseMotion') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventMouse.`);
  }
  event.global_position = vec2(position.x, position.y);
}

/** Godot 3 InputEventMouseMotion.speed, retained in viewport pixels per second. */
export function getInputEventMouseMotionSpeed(event: GodotInputMapEvent): Vector2 {
  if (event.__godotClass !== 'InputEventMouseMotion') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventMouseMotion.`);
  }
  const speed = event.speed;
  if (speed === undefined) throw new Error('godot-compat: InputEventMouseMotion.speed has no retained motion sample.');
  return vec2(speed.x, speed.y);
}

export function setInputEventMouseMotionSpeed(event: GodotInputMapEvent, speed: Vector2): void {
  if (event.__godotClass !== 'InputEventMouseMotion') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventMouseMotion.`);
  }
  event.speed = vec2(speed.x, speed.y);
}

/** Convert DOM MouseEvent.buttons into Godot's MouseButtonMask numbering. */
export function godotMouseButtonMask(buttons: number): number {
  if (!Number.isSafeInteger(buttons) || buttons < 0) {
    throw new TypeError('godot-compat: InputEventMouse.button_mask requires a non-negative integer mask.');
  }
  let mask = 0;
  if ((buttons & 1) !== 0) mask |= 1; // DOM left -> Godot left.
  if ((buttons & 2) !== 0) mask |= 2; // DOM right -> Godot right.
  if ((buttons & 4) !== 0) mask |= 4; // DOM middle -> Godot middle.
  if ((buttons & 8) !== 0) mask |= 128; // DOM back -> Godot XBUTTON1.
  if ((buttons & 16) !== 0) mask |= 256; // DOM forward -> Godot XBUTTON2.
  return mask;
}

export function getInputEventMouseButtonMask(event: GodotInputMapEvent): number {
  if (event.__godotClass !== 'InputEventMouseButton' && event.__godotClass !== 'InputEventMouseMotion') {
    throw new Error(`godot-compat: ${event.__godotClass} is not an InputEventMouse.`);
  }
  return event.button_mask ?? 0;
}

export function setInputEventMouseButtonMask(event: GodotInputMapEvent, mask: number): void {
  if (
    (event.__godotClass !== 'InputEventMouseButton' && event.__godotClass !== 'InputEventMouseMotion') ||
    !Number.isSafeInteger(mask) || mask < 0
  ) {
    throw new TypeError('godot-compat: InputEventMouse.button_mask requires a non-negative integer mask.');
  }
  event.button_mask = mask;
}

function inputEventBindingIdentity(event: GodotInputMapEvent): string {
  if (event.__godotClass === 'InputEventAction') {
    return `${event.device}:${event.__godotClass}:${event.action ?? ''}`;
  }
  if (event.__godotClass === 'InputEventKey') {
    return `${event.device}:${event.__godotClass}:${event.scancode ?? 0}`;
  }
  if (event.__godotClass === 'InputEventJoypadMotion') {
    return `${event.device}:${event.__godotClass}:${event.axis ?? 0}:${Math.sign(event.axis_value ?? 0)}`;
  }
  return `${event.device}:${event.__godotClass}:${event.button_index ?? 0}`;
}

function bindingFromEvent(event: unknown, method: string): InputBinding {
  if (typeof event !== 'object' || event === null || !('__godotClass' in event)) {
    throw new Error(
      `godot-compat: InputMap.${method} requires an InputEvent returned by this live InputMap; ` +
        'an unbound event has no exact engine InputBinding identity.',
    );
  }
  const value = event as GodotInputMapEvent;
  if (value.device !== 0) {
    throw new Error(
      `godot-compat: InputMap.${method} cannot match InputEvent device ${value.device}; ` +
        'the engine InputBinding identity has no per-device field.',
    );
  }
  if (
    value[INPUT_BINDING] !== undefined &&
    value[INPUT_BINDING_IDENTITY] === inputEventBindingIdentity(value)
  ) {
    return structuredClone(value[INPUT_BINDING]);
  }
  if (value.__godotClass === 'InputEventKey') {
    const code = codeFromGodot3Scancode(value.scancode ?? 0);
    if (code === undefined) throw new Error(`godot-compat: InputEventKey scancode ${value.scancode ?? 0} has no engine key identity.`);
    return { type: 'key', code };
  }
  if (value.__godotClass === 'InputEventMouseButton') {
    const index = value.button_index ?? 0;
    if (index === 0) {
      throw new Error('godot-compat: InputEventMouseButton BUTTON_NONE has no engine button identity.');
    }
    const button = index === 1 ? 0 : index === 2 ? 2 : index === 3 ? 1 : index;
    if (button < 0) throw new Error(`godot-compat: InputEventMouseButton index ${index} is invalid.`);
    return { type: 'mouse_button', button };
  }
  if (value.__godotClass === 'InputEventJoypadButton') {
    return { type: 'gamepad_button', button: value.button_index ?? 0 };
  }
  if (value.__godotClass === 'InputEventJoypadMotion') {
    if ((value.axis_value ?? 0) === 0) {
      throw new Error('godot-compat: InputEventJoypadMotion axis_value=0 has no engine axis direction.');
    }
    return { type: 'gamepad_axis', axis: value.axis ?? 0, direction: (value.axis_value ?? 0) < 0 ? 'negative' : 'positive' };
  }
  if (value.__godotClass === 'InputEventAction') {
    throw new Error(
      `godot-compat: InputMap.${method} cannot use InputEventAction as a physical binding.`,
    );
  }
  throw new Error(`godot-compat: InputMap.${method} cannot derive an engine binding from this event.`);
}

export function isInputEventActionReleased(
  input: GodotInput,
  event: GodotInputMapEvent,
  action: string,
  exactMatch = false,
): boolean {
  return input.eventIsActionReleased(event, action, exactMatch);
}

export function isInputEventActionPressed(
  input: GodotInput,
  event: GodotInputMapEvent,
  action: string,
  exactMatch = false,
): boolean {
  return getInputEventStrengthForAction(input, event, action, exactMatch) > 0;
}

export function isInputEventAction(
  input: GodotInput,
  event: GodotInputMapEvent,
  action: string,
  exactMatch = false,
): boolean {
  return input.eventIsAction(event, action, exactMatch);
}

export function getInputEventStrengthForAction(
  input: GodotInput,
  event: GodotInputMapEvent,
  action: string,
  exactMatch = false,
): number {
  return input.eventActionStrength(event, action, exactMatch);
}

/**
 * One finger event the host pointer stream produced this frame — the engine's
 * `HostPointerTouch` in Godot's own two classes. `index` is a dense finger id
 * (Godot's `InputEventScreenTouch.index`), not the browser's `pointerId`, and
 * the engine's stream is what mints it.
 */
export interface GodotScreenEvent {
  readonly __godotClass: 'InputEventScreenTouch' | 'InputEventScreenDrag';
  readonly kind: 'screenTouch' | 'screenDrag';
  device: number;
  index: number;
  position: Vector2;
  pressed: boolean;
  canceled: boolean;
  double_tap: boolean;
  tilt: Vector2;
  pressure: number;
  pen_inverted: boolean;
  relative: Vector2;
  screen_relative: Vector2;
  velocity: Vector2;
  screen_velocity: Vector2;
  handled: boolean;
  as_text(): string;
}

/**
 * `DisplayServer.is_touchscreen_available()` — `platformer-3d-godot4`
 * `touch_screen_ui.gd:6` and `virtual_joystick.gd:67`, which gate the whole
 * touch UI on it.
 *
 * Godot's is a HOST question ("does this device have a touchscreen"), and the
 * browser answers it: `navigator.maxTouchPoints` is the standardized count of
 * simultaneous touch contacts the hardware supports, and `> 0` is what every
 * feature detection means by "there is a touchscreen". It lives in this file
 * rather than a `DisplayServer` of its own because it is an INPUT-device
 * capability and the one call a fixture makes of that singleton — a file per
 * measured member would be bookkeeping, not structure.
 *
 * It is a FUNCTION and not a constant on purpose: a hybrid device can gain a
 * touchscreen while the game runs, and Godot re-answers per call too. Nothing
 * is cached, nothing is registered, and there is no listener to tear down.
 *
 * On a host with no `navigator` at all (the headless jsdom-less runner) this is
 * `false` — the honest answer for "no touch hardware is reachable from here",
 * and the same answer Godot gives on a desktop build.
 */
export function isTouchscreenAvailable(): boolean {
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

/** What {@link createInput} needs from the game. */
export interface CreateInputOptions {
  /** The game's own `InputManager` — `ctx.input`. */
  readonly input: InputManager;
  /** The source project's dialect; Godot 3 and 4 assign different integers to special keys. */
  readonly godotMajor: 3 | 4;
  /**
   * Godot action name -> the engine action name that carries its bindings.
   *
   * Written by the emitter from `project.godot`'s `[input]` section, and
   * usually identity (`{ move_left: 'move_left', … }`) because the same
   * emitter also writes the project's input map. It is still spelled out
   * rather than assumed: an action a port never declared must fail loudly, and
   * an identity default would make every typo silently return `false`.
   */
  readonly actions: Readonly<Record<string, string>>;
  /**
   * The game canvas {@link GodotInput.setMouseMode} should lock to, when the
   * host has one. Absent (or returning null) is the headless / no-canvas
   * case: a CAPTURED write degrades honestly and does not invent a lock.
   *
   * A getter rather than an element because the R3F renderer mints the
   * canvas after `createInput` runs.
   */
  readonly lockTarget?: () => HTMLElement | null;
  /** Apply `Viewport.transparent_bg` to the mounted Pixi/Three renderer's real clear alpha. */
  readonly setViewportTransparentBackground?: (transparent: boolean) => void;
  readonly setDefaultClearColor?: (color: ColorValue) => void;
  /**
   * Viewport in pixels `Camera3D.project_ray_normal` unprojects through when
   * the emitted call omits a size (Godot reads it off the camera's Viewport).
   * The project `RESOLUTION` / live canvas. Absent, the 1024×600 design
   * space `world.tsx` emits when `[display]` is missing — not Godot 4's
   * 1152×648 window default.
   */
  readonly viewportSize?: () =>
    | { readonly x: number; readonly y: number }
    | {
        readonly width: number;
        readonly height: number;
      };
}

/**
 * A complete Input singleton for authored-scene previews that deliberately own no host input
 * manager. It preserves Input's stateful project-map surface while every physical-device read is
 * inert; preview stories can therefore construct arbitrary translated scripts without fabricating
 * keyboard, pointer, joypad, viewport-canvas, or edge state.
 */
export function createInertInput(): GodotInput {
  const actions = new Map<
    string,
    { deadzone: number; description: string; events: GodotInputMapEvent[] }
  >();
  const sizeChanged = createSignal<readonly []>();
  const joyConnectionChanged = createSignal<readonly [number, boolean]>();
  let mouseMode = MOUSE_MODE_VISIBLE;
  let mousePosition = vec2(0, 0);
  let cursorShape = 0;
  let viewportInputDisabled = false;
  let viewportTransparentBackground = false;
  let currentScreenEvent: GodotScreenEvent | undefined;
  const action = (name: string) => actions.get(name);
  return {
    sizeChanged: sizeChanged.signal,
    joyConnectionChanged: joyConnectionChanged.signal,
    getActions: () => [...actions.keys()],
    addAction: (name, deadzone = 0.5) => {
      if (!actions.has(name)) actions.set(name, { deadzone, description: '', events: [] });
    },
    eraseAction: (name) => {
      actions.delete(name);
    },
    getActionDescription: (name) => action(name)?.description ?? '',
    actionSetDeadzone: (name, deadzone) => {
      const found = action(name);
      if (found !== undefined) found.deadzone = deadzone;
    },
    actionGetDeadzone: (name) => action(name)?.deadzone ?? 0.5,
    loadFromGlobals: () => {},
    getActionList: (name) => [...(action(name)?.events ?? [])],
    actionGetEvents: (name) => [...(action(name)?.events ?? [])],
    hasAction: (name) => actions.has(name),
    actionHasEvent: (name, event) => action(name)?.events.includes(event as GodotInputMapEvent) ?? false,
    eventActionStrength: () => 0,
    eventIsAction: () => false,
    eventIsActionReleased: () => false,
    actionAddEvent: (name, event) => {
      const found = action(name);
      if (found !== undefined && !found.events.includes(event as GodotInputMapEvent)) {
        found.events.push(event as GodotInputMapEvent);
      }
    },
    actionEraseEvent: (name, event) => {
      const found = action(name);
      if (found === undefined) return;
      const index = found.events.indexOf(event as GodotInputMapEvent);
      if (index >= 0) found.events.splice(index, 1);
    },
    actionEraseEvents: (name) => {
      const found = action(name);
      if (found !== undefined) found.events.length = 0;
    },
    isActionPressed: () => false,
    isActionJustPressed: () => false,
    isActionJustReleased: () => false,
    getActionStrength: () => 0,
    getActionRawStrength: () => 0,
    isKeyPressed: () => false,
    isPhysicalKeyPressed: () => false,
    isMouseButtonPressed: () => false,
    getMouseButtonMask: () => 0,
    getConnectedJoypads: () => [],
    getJoyName: () => '',
    getJoyButtonString: () => '',
    getJoyAxisString: () => '',
    isJoyKnown: () => false,
    isJoyButtonPressed: () => false,
    getJoyAxis: () => 0,
    actionPress: () => {},
    actionRelease: () => {},
    parseInputEvent: () => {},
    getVector: () => vec2(0, 0),
    getAxis: () => 0,
    getMouseMode: () => mouseMode,
    setMouseMode: (mode) => {
      mouseMode = mode;
    },
    getMouseRelative: () => vec2(0, 0),
    hasMouseMotion: () => false,
    hasMouseButtonEvent: () => false,
    getMouseButtonEventIndex: () => 0,
    isMouseButtonEventPressed: () => false,
    setCustomMouseCursor: (_texture, shape) => {
      cursorShape = shape;
    },
    setDefaultCursorShape: (shape) => {
      cursorShape = shape;
    },
    getCurrentCursorShape: () => cursorShape,
    getMousePosition: () => copyVector2(mousePosition),
    setMousePosition: (position) => {
      mousePosition = copyVector2(position);
    },
    getViewportSize: () => copyVector2(PROJECT_RAY_DEFAULT_VIEWPORT),
    setViewportInputDisabled: (disabled) => {
      viewportInputDisabled = disabled;
    },
    isViewportInputDisabled: () => viewportInputDisabled,
    getViewportTexture: () => {
      throw new Error(
        'godot-compat: a preview Input has no mounted renderer canvas for ViewportTexture.',
      );
    },
    hasViewportTransparentBackground: () => viewportTransparentBackground,
    setViewportTransparentBackground: (transparent) => {
      viewportTransparentBackground = transparent;
    },
    setDefaultClearColor: () => {},
    pushViewportInput: () => {},
    takeScreenEvents: () => [],
    beginScreenEvent: (event) => {
      currentScreenEvent = event;
    },
    setInputAsHandled: () => {
      if (currentScreenEvent !== undefined) currentScreenEvent.handled = true;
    },
    isInputHandled: () => currentScreenEvent?.handled ?? false,
    dispose: () => {
      actions.clear();
      currentScreenEvent = undefined;
    },
  };
}

/** Headless door onto the GodotInput `createInput` bound to an InputManager.
 *  S4 sets the mouse the city's `get_viewport().get_mouse_position()` reads
 *  (`builder.gd:54`) without inventing a second pointer. */
const INPUT_BY_MANAGER = new WeakMap<InputManager, GodotInput>();

/** The GodotInput `createInput` attached to this manager, if any. */
export function godotInputOf(input: InputManager): GodotInput | undefined {
  return INPUT_BY_MANAGER.get(input);
}

/**
 * One engine finger phase as Godot's own event class — the whole of what the
 * push-down left here.
 *
 * A finger ARRIVING or LEAVING is `InputEventScreenTouch`, with `pressed`
 * saying which; everything between is `InputEventScreenDrag`, which Godot only
 * ever raises for a finger that is down — hence its constant `pressed: true`.
 * `handled` starts false and {@link GodotInput.setInputAsHandled} is what sets
 * it, per delivery.
 */
function screenEventBase(
  kind: GodotScreenEvent['kind'],
  godotClass: GodotScreenEvent['__godotClass'],
): GodotScreenEvent {
  const event: GodotScreenEvent = {
    __godotClass: godotClass,
    kind,
    device: -1,
    index: 0,
    position: vec2(0, 0),
    pressed: false,
    canceled: false,
    double_tap: false,
    tilt: vec2(0, 0),
    pressure: 0,
    pen_inverted: false,
    relative: vec2(0, 0),
    screen_relative: vec2(0, 0),
    velocity: vec2(0, 0),
    screen_velocity: vec2(0, 0),
    handled: false,
    as_text: () => {
      throw new Error(
        `godot-compat: ${godotClass}.as_text requires Godot's platform-specific event formatter; ` +
          'the retained browser event fields remain available directly.',
      );
    },
  };
  return retainInputEvent(event);
}

export function createInputEventScreenTouch(): GodotScreenEvent {
  return screenEventBase('screenTouch', 'InputEventScreenTouch');
}

export function createInputEventScreenDrag(): GodotScreenEvent {
  const event = screenEventBase('screenDrag', 'InputEventScreenDrag');
  event.pressed = true;
  return event;
}

function screenEventOf(touch: HostPointerTouch): GodotScreenEvent {
  const event = touch.phase === 'move'
    ? createInputEventScreenDrag()
    : createInputEventScreenTouch();
  event.index = touch.index;
  event.position = vec2(touch.position.x, touch.position.y);
  event.pressed = touch.phase !== 'end';
  event.canceled = touch.canceled;
  event.tilt = vec2(touch.tilt.x, touch.tilt.y);
  event.pressure = touch.pressure;
  event.pen_inverted = touch.penInverted;
  event.relative = vec2(touch.relative.x, touch.relative.y);
  event.screen_relative = vec2(touch.screenRelative.x, touch.screenRelative.y);
  event.velocity = vec2(touch.velocity.x, touch.velocity.y);
  event.screen_velocity = vec2(touch.screenVelocity.x, touch.screenVelocity.y);
  return event;
}

function viewportFrom(
  raw:
    | { readonly x: number; readonly y: number }
    | { readonly width: number; readonly height: number },
): Vector2 {
  return 'width' in raw ? vec2(raw.width, raw.height) : vec2(raw.x, raw.y);
}

/** Build the service. One per mounted game. */
export function createInput(options: CreateInputOptions): GodotInput {
  const { input, actions, lockTarget, godotMajor } = options;
  const runtimeActions: Record<string, string> = { ...actions };
  const globalActions: Readonly<Record<string, string>> = { ...actions };
  const runtimeActionDeadzones = new Map<string, number>();
  const runtimeActionDescriptions = new Map<string, string>();
  // Project RESOLUTION — the fixed logical size the host presents by uniformly scaling and
  // letterboxing the result. Browser/CSS resizes do not resize this Viewport; source-authored
  // stretch behavior is a separate translation. A headless first frame sits at its centre.
  const viewport = viewportFrom(options.viewportSize?.() ?? PROJECT_RAY_DEFAULT_VIEWPORT);
  const sizeChanged = createSignal<readonly []>();
  const joyConnectionChanged = createSignal<readonly [number, boolean]>();
  const inputWindow = lockTarget?.()?.ownerDocument.defaultView ?? null;
  const gamepadConnected = (event: GamepadEvent): void => {
    joyConnectionChanged.emit(event.gamepad.index, true);
  };
  const gamepadDisconnected = (event: GamepadEvent): void => {
    joyConnectionChanged.emit(event.gamepad.index, false);
  };
  if (inputWindow !== null) {
    inputWindow.addEventListener('gamepadconnected', gamepadConnected);
    inputWindow.addEventListener('gamepaddisconnected', gamepadDisconnected);
  }
  // The host pointer stream — the engine's, not compat's. It owns the four `pointerdown`/`move`/
  // `up`/`cancel` listeners, the surface rect, the CSS-pixels-to-project-pixels mapping (so a
  // touch and a Control rect land in ONE space), the dense finger indices and the bounded touch
  // ring, all gated on `InputManager.isInputActive()`. What is Godot's and stays here is the
  // PROTOCOL on top: the two event CLASSES those fingers are reported as, and
  // `Viewport.set_input_as_handled`.
  const pointer: HostPointer = createHostPointer({
    input,
    surface: lockTarget,
    designSize: viewport,
  });
  let currentScreenEvent: GodotScreenEvent | undefined;
  let viewportInputDisabled = false;
  // Godot keeps cursor shape and visibility separately. HIDDEN temporarily
  // applies `none`; returning to VISIBLE/CAPTURED restores the last custom
  // cursor rather than replacing it with the default arrow.
  let visibleCursor = 'default';
  let currentCursorShape = 0;
  const mainViewportTexture: GodotViewportTexture = {
    viewport: null,
    get canvas(): HTMLCanvasElement {
      const target = lockTarget?.() ?? null;
      if (
        typeof HTMLCanvasElement === 'undefined' ||
        !(target instanceof HTMLCanvasElement)
      ) {
        throw new Error(
          'godot-compat: the main ViewportTexture requires the mounted browser canvas; none is attached.',
        );
      }
      return target;
    },
    get size() {
      return { x: viewport.x, y: viewport.y };
    },
  };
  registerGodotObjectIdentity(mainViewportTexture, 'ViewportTexture');
  let viewportTransparentBackground = false;

  function applyCursor(cursor: string): void {
    pointer.setCursor(cursor);
    const target = lockTarget?.() ?? null;
    if (target !== null) target.style.cursor = cursor;
  }

  /** The engine action carrying `action`'s bindings. Throws if there is none —
   *  one message for both queries, so the two cannot drift apart. */
  function mapAction(action: string, query: string): string {
    const mapped = runtimeActions[action];
    if (mapped === undefined) {
      const known = Object.keys(runtimeActions).sort();
      throw new Error(
        `godot-compat: Input.${query}("${action}") — that action is not in the map ` +
          `this game declared. Mapped actions: ${known.length === 0 ? '(none)' : known.join(', ')}. ` +
          "Compat reads the project's own input map and never defines an action; add the " +
          "binding to the project's input map and the name to createInput({ actions }).",
      );
    }
    return mapped;
  }

  const service: GodotInput = {
    sizeChanged: sizeChanged.signal,
    joyConnectionChanged: joyConnectionChanged.signal,
    getActions(): string[] {
      return Object.keys(runtimeActions);
    },
    addAction(action, deadzone = 0.5): void {
      if (typeof action !== 'string' || action.length === 0) {
        throw new TypeError('godot-compat: InputMap.add_action requires a non-empty StringName.');
      }
      if (!Number.isFinite(deadzone) || deadzone < 0 || deadzone > 1) {
        throw new RangeError('godot-compat: InputMap.add_action deadzone must be in [0, 1].');
      }
      if (runtimeActions[action] !== undefined) return;
      runtimeActions[action] = action;
      runtimeActionDeadzones.set(action, deadzone);
      input.registerAction(action, []);
    },
    eraseAction(action): void {
      const mapped = runtimeActions[action];
      if (mapped === undefined) return;
      input.setBindings(mapped, []);
      delete runtimeActions[action];
      runtimeActionDeadzones.delete(action);
      runtimeActionDescriptions.delete(action);
    },
    getActionDescription(action): string {
      if (runtimeActions[action] === undefined) return '';
      return runtimeActionDescriptions.get(action) ?? action;
    },
    actionSetDeadzone(action, deadzone): void {
      const mapped = mapAction(action, 'InputMap.action_set_deadzone');
      if (!Number.isFinite(deadzone) || deadzone < 0 || deadzone > 1) {
        throw new RangeError('godot-compat: InputMap.action_set_deadzone deadzone must be in [0, 1].');
      }
      runtimeActionDeadzones.set(action, deadzone);
      input.setBindings(mapped, input.getBindings(mapped).map((binding) =>
        binding.type === 'gamepad_axis' ? { ...binding, deadzone } : binding));
    },
    actionGetDeadzone(action): number {
      mapAction(action, 'InputMap.action_get_deadzone');
      return runtimeActionDeadzones.get(action) ?? 0.5;
    },
    loadFromGlobals(): void {
      for (const [action, mapped] of Object.entries(runtimeActions)) {
        if (globalActions[action] !== undefined) continue;
        input.setBindings(mapped, []);
        delete runtimeActions[action];
        runtimeActionDeadzones.delete(action);
        runtimeActionDescriptions.delete(action);
      }
      for (const [action, mapped] of Object.entries(globalActions)) {
        runtimeActions[action] = mapped;
        input.resetBindings(mapped);
        runtimeActionDeadzones.delete(action);
      }
    },
    getActionList(action): GodotInputMapEvent[] {
      const mapped = runtimeActions[action];
      if (mapped === undefined) return [];
      return input.getBindings(mapped).map(inputMapEvent);
    },
    actionGetEvents(action): GodotInputMapEvent[] {
      const mapped = runtimeActions[action];
      if (mapped === undefined) return [];
      return input.getBindings(mapped).map(inputMapEvent);
    },
    hasAction(action): boolean {
      return runtimeActions[action] !== undefined;
    },
    actionHasEvent(action, event): boolean {
      const mapped = mapAction(action, 'InputMap.action_has_event');
      const binding = bindingFromEvent(event, 'action_has_event');
      return input.getBindings(mapped).some((candidate) => inputBindingsCollide(candidate, binding));
    },
    eventActionStrength(event, action, exactMatch = false): number {
      if (exactMatch) {
        throw new Error(
          'godot-compat: InputEvent.get_action_strength exact_match=true requires native ' +
            'modifier/device matching that the engine InputBinding boundary does not expose.',
        );
      }
      mapAction(action, 'InputEvent.get_action_strength');
      if (event.__godotClass === 'InputEventAction') {
        return event.action === action && isInputEventPressed(event) ? (event.strength ?? 1) : 0;
      }
      const incoming = bindingFromEvent(event, 'get_action_strength');
      const mapped = runtimeActions[action]!;
      for (const candidate of input.getBindings(mapped)) {
        if (candidate.type === 'gamepad_axis' && incoming.type === 'gamepad_axis') {
          if (candidate.axis !== incoming.axis) continue;
          const raw = Math.abs(event.axis_value ?? 0);
          const sameDirection =
            candidate.direction === incoming.direction || (event.axis_value ?? 0) === 0;
          const deadzone = candidate.deadzone ?? 0.5;
          if (!sameDirection || raw < deadzone) return 0;
          return deadzone === 1
            ? 1
            : Math.min(1, Math.max(0, (raw - deadzone) / (1 - deadzone)));
        }
        if (inputBindingsCollide(candidate, incoming)) {
          return isInputEventPressed(event) ? 1 : 0;
        }
      }
      return 0;
    },
    eventIsAction(event, action, exactMatch = false): boolean {
      if (exactMatch) {
        throw new Error(
          'godot-compat: InputEvent.is_action exact_match=true requires native modifier/device matching.',
        );
      }
      mapAction(action, 'InputEvent.is_action');
      if (event.__godotClass === 'InputEventAction') return event.action === action;
      const incoming = bindingFromEvent(event, 'is_action');
      return input
        .getBindings(runtimeActions[action]!)
        .some((candidate) => inputBindingsCollide(candidate, incoming));
    },
    eventIsActionReleased(event, action, exactMatch = false): boolean {
      if (exactMatch) {
        throw new Error(
          'godot-compat: InputEvent.is_action_released exact_match=true requires native ' +
            'modifier/device matching that the engine InputBinding boundary does not expose.',
        );
      }
      mapAction(action, 'InputEvent.is_action_released');
      if (event.__godotClass === 'InputEventAction') {
        return event.action === action && !isInputEventPressed(event);
      }
      const incoming = bindingFromEvent(event, 'is_action_released');
      const mapped = runtimeActions[action]!;
      for (const candidate of input.getBindings(mapped)) {
        if (candidate.type === 'gamepad_axis' && incoming.type === 'gamepad_axis') {
          if (candidate.axis !== incoming.axis) continue;
          const sameDirection =
            candidate.direction === incoming.direction || (event.axis_value ?? 0) === 0;
          const deadzone = candidate.deadzone ?? 0.5;
          return !sameDirection || Math.abs(event.axis_value ?? 0) < deadzone;
        }
        if (inputBindingsCollide(candidate, incoming)) return !isInputEventPressed(event);
      }
      return false;
    },
    actionAddEvent(action, event): void {
      const mapped = mapAction(action, 'InputMap.action_add_event');
      const sourceBinding = bindingFromEvent(event, 'action_add_event');
      const binding = sourceBinding.type === 'gamepad_axis' && sourceBinding.deadzone === undefined
        ? { ...sourceBinding, deadzone: runtimeActionDeadzones.get(action) ?? 0.5 }
        : sourceBinding;
      if (input.getBindings(mapped).some((candidate) => inputBindingsCollide(candidate, binding))) return;
      input.addBinding(mapped, binding);
    },
    actionEraseEvent(action, event): void {
      const mapped = mapAction(action, 'InputMap.action_erase_event');
      const binding = bindingFromEvent(event, 'action_erase_event');
      const index = input.getBindings(mapped).findIndex((candidate) => inputBindingsCollide(candidate, binding));
      if (index >= 0) input.removeBinding(mapped, index);
    },
    actionEraseEvents(action): void {
      input.setBindings(mapAction(action, 'InputMap.action_erase_events'), []);
    },
    isActionPressed(action, exactMatch = false): boolean {
      if (exactMatch) {
        throw new Error(
          'godot-compat: Input.is_action_pressed exact_match=true requires native modifier match state.',
        );
      }
      return input.isPressed(mapAction(action, 'is_action_pressed'));
    },
    isActionJustPressed(action, exactMatch = false): boolean {
      if (exactMatch) {
        throw new Error(
          'godot-compat: Input.is_action_just_pressed exact_match=true requires native modifier match state.',
        );
      }
      return input.isJustPressed(mapAction(action, 'is_action_just_pressed'));
    },
    isActionJustReleased(action, exactMatch = false): boolean {
      if (exactMatch) {
        throw new Error(
          'godot-compat: Input.is_action_just_released exact_match=true requires native modifier match state.',
        );
      }
      return input.isJustReleased(mapAction(action, 'is_action_just_released'));
    },
    getActionStrength(action, exactMatch = false): number {
      if (exactMatch) {
        throw new Error(
          'godot-compat: Input.get_action_strength exact_match=true requires the native ' +
            'logical/physical modifier match state, which the host action boundary does not expose.',
        );
      }
      return input.getDigitalStrength(mapAction(action, 'get_action_strength'));
    },
    getActionRawStrength(action, exactMatch = false): number {
      if (exactMatch) {
        throw new Error(
          'godot-compat: Input.get_action_raw_strength exact_match=true requires the native ' +
            'logical/physical modifier match state, which the host action boundary does not expose.',
        );
      }
      return input.getDigitalRawStrength(mapAction(action, 'get_action_raw_strength'));
    },
    isKeyPressed(keycode): boolean {
      return domCodesForGodotKey(keycode, godotMajor).some((code) =>
        input.isDeviceKeyPressed(code),
      );
    },
    isPhysicalKeyPressed(keycode): boolean {
      return domCodesForGodotKey(keycode, godotMajor).some((code) =>
        input.isDeviceKeyPressed(code),
      );
    },
    isMouseButtonPressed(button): boolean {
      if (!Number.isSafeInteger(button) || button < 1 || button > 9) {
        throw new RangeError('godot-compat: Input.is_mouse_button_pressed requires MouseButton 1..9.');
      }
      // Godot: LEFT=1, RIGHT=2, MIDDLE=3, WHEEL_UP..RIGHT=4..7, XBUTTON1/2=8/9.
      // DOM: left=0, middle=1, right=2, back=3, forward=4. Wheel entries are impulses and are
      // never a held mouse button, matching Godot's is_mouse_button_pressed result for them.
      const domButton = button === 1 ? 0 : button === 2 ? 2 : button === 3 ? 1 : button >= 8 ? button - 5 : -1;
      return domButton >= 0 && input.isDeviceMouseButtonPressed(domButton);
    },
    getMouseButtonMask(): number {
      let mask = 0;
      for (const button of [1, 2, 3, 8, 9] as const) {
        const domButton = button === 1 ? 0 : button === 2 ? 2 : button === 3 ? 1 : button - 5;
        if (input.isDeviceMouseButtonPressed(domButton)) mask |= 1 << (button - 1);
      }
      return mask;
    },
    getConnectedJoypads(): number[] | PackedArrayValue<number> {
      const indices = input.getConnectedGamepadIndices();
      return godotMajor === 4 ? packedInt32Array(indices) : indices;
    },
    getJoyName(device): string {
      if (!Number.isSafeInteger(device) || device < 0) {
        throw new RangeError('godot-compat: Input.get_joy_name requires a non-negative device index.');
      }
      return input.getGamepadInfo(device)?.id ?? '';
    },
    getJoyButtonString(button): string {
      if (!Number.isSafeInteger(button) || button < 0 || button > 20) {
        throw new RangeError('godot-compat: Input.get_joy_button_string requires JoyButton 0..20.');
      }
      return [
        'A', 'B', 'X', 'Y', 'Back', 'Guide', 'Start', 'Left Stick', 'Right Stick',
        'Left Shoulder', 'Right Shoulder', 'D-pad Up', 'D-pad Down', 'D-pad Left',
        'D-pad Right', 'Miscellaneous', 'Paddle 1', 'Paddle 2', 'Paddle 3', 'Paddle 4',
        'Touchpad',
      ][button]!;
    },
    getJoyAxisString(axis): string {
      if (!Number.isSafeInteger(axis) || axis < 0 || axis > 5) {
        throw new RangeError('godot-compat: Input.get_joy_axis_string requires JoyAxis 0..5.');
      }
      return ['Left Stick X', 'Left Stick Y', 'Right Stick X', 'Right Stick Y', 'Trigger Left', 'Trigger Right'][axis]!;
    },
    isJoyKnown(device): boolean {
      if (!Number.isSafeInteger(device) || device < 0) {
        throw new RangeError('godot-compat: Input.is_joy_known requires a non-negative device index.');
      }
      return input.getGamepadInfo(device)?.mapping === 'standard';
    },
    isJoyButtonPressed(device, button): boolean {
      if (!Number.isSafeInteger(device) || device < 0 || !Number.isSafeInteger(button) || button < 0) {
        throw new RangeError('godot-compat: Input.is_joy_button_pressed requires non-negative integer device and button indices.');
      }
      return input.isDeviceGamepadButtonPressedAt(device, button);
    },
    getJoyAxis(device, axis): number {
      if (!Number.isSafeInteger(device) || device < 0 || !Number.isSafeInteger(axis) || axis < 0) {
        throw new RangeError('godot-compat: Input.get_joy_axis requires non-negative integer device and axis indices.');
      }
      return input.getDeviceGamepadAxisAt(device, axis);
    },
    actionPress(action, strength): void {
      input.setVirtualDigitalStrength(
        mapAction(action, 'action_press'),
        strength === undefined ? 1 : strength,
      );
    },
    actionRelease(action): void {
      input.setVirtualAction(mapAction(action, 'action_release'), false);
    },
    parseInputEvent(event): void {
      if (event.__godotClass !== 'InputEventAction') {
        throw new Error(
          `godot-compat: Input.parse_input_event cannot inject ${event.__godotClass}; ` +
            'the browser InputManager exposes action injection, not fabricated native device events.',
        );
      }
      const action = event.action ?? '';
      const mapped = mapAction(action, 'parse_input_event');
      if (isInputEventPressed(event)) input.setVirtualDigitalStrength(mapped, event.strength ?? 1);
      else input.setVirtualAction(mapped, false);
    },
    getVector(negX, posX, negY, posY, deadzone = -1): Vector2 {
      const mappedNegX = mapAction(negX, 'get_vector');
      const mappedPosX = mapAction(posX, 'get_vector');
      const mappedNegY = mapAction(negY, 'get_vector');
      const mappedPosY = mapAction(posY, 'get_vector');
      const actionDeadzone = (action: string, mapped: string): number =>
        runtimeActionDeadzones.get(action) ??
        input.getBindings(mapped).find((binding) => binding.type === 'gamepad_axis')?.deadzone ??
        0.5;
      const effectiveDeadzone = deadzone < 0
        ? (
            actionDeadzone(negX, mappedNegX) + actionDeadzone(posX, mappedPosX) +
            actionDeadzone(negY, mappedNegY) + actionDeadzone(posY, mappedPosY)
          ) / 4
        : deadzone;
      const x = input.getDigitalRawStrength(mappedPosX) - input.getDigitalRawStrength(mappedNegX);
      const y = input.getDigitalRawStrength(mappedPosY) - input.getDigitalRawStrength(mappedNegY);
      const length = Math.hypot(x, y);
      // Godot's CIRCULAR deadzone (Input::get_vector): zero below, normalize
      // above 1, and rescale between by inverse_lerp(deadzone, 1, length).
      if (length <= effectiveDeadzone) return VECTOR2_ZERO;
      if (length > 1) return vec2(x / length, y / length);
      const scale = (length - effectiveDeadzone) / (1 - effectiveDeadzone);
      return vec2(x * scale, y * scale);
    },
    getAxis(negative, positive): number {
      const strength = (action: string): number =>
        input.getDigitalStrength(mapAction(action, 'get_axis'));
      return strength(positive) - strength(negative);
    },
    getMouseMode(): number {
      const target = lockTarget?.() ?? null;
      if (target?.style.cursor === 'none') return MOUSE_MODE_HIDDEN;
      return input.isPointerLocked() ? MOUSE_MODE_CAPTURED : MOUSE_MODE_VISIBLE;
    },
    setMouseMode(mode): void {
      if (mode === MOUSE_MODE_VISIBLE) {
        applyCursor(visibleCursor);
        input.exitPointerLock();
        return;
      }
      if (mode === MOUSE_MODE_HIDDEN) {
        const target = lockTarget?.() ?? null;
        if (target === null) {
          throw new Error(
            'godot-compat: Input.mouse_mode = MOUSE_MODE_HIDDEN (1) requires the game canvas; ' +
              'there is no browser cursor to hide on this host.',
          );
        }
        input.exitPointerLock();
        applyCursor('none');
        return;
      }
      if (mode !== MOUSE_MODE_CAPTURED) {
        throw new Error(
          `godot-compat: Input.mouse_mode = ${mode} — MOUSE_MODE_CONFINED and ` +
            'MOUSE_MODE_CONFINED_HIDDEN are not supported by Godot 3.6 HTML5 or the browser host.',
        );
      }
      applyCursor(visibleCursor);
      // Play-mode + tab-focus: the same predicate onMouseMove already uses. A
      // CAPTURED write while the editor has suspended game input must not take
      // the page-wide pointer-lock singleton away from the viewport — and must
      // not wire the click-to-lock fallback either, which is what
      // `InputManager.requestPointerLock` installs below.
      if (!input.isEnabled() || !input.isFocused()) return;
      const el = lockTarget?.() ?? null;
      if (el === null || typeof el.requestPointerLock !== 'function') return;
      input.requestPointerLock(el);
      // Godot's write is immediate. The browser may reject this without a
      // user gesture; the click listener requestPointerLock wired is the
      // fallback. A thrown / rejected request is the honest degrade, never a
      // fabricated lock.
      try {
        const result = el.requestPointerLock();
        if (result !== undefined && typeof (result as Promise<unknown>).catch === 'function') {
          void (result as Promise<unknown>).catch(() => undefined);
        }
      } catch {
        // Headless stand-in, or a host that implements the method as a throw.
      }
    },
    getMouseRelative(): Vector2 {
      const delta = input.getMouseDelta();
      return vec2(delta.x, delta.y);
    },
    hasMouseMotion(): boolean {
      if (viewportInputDisabled) return false;
      const delta = input.getMouseDelta();
      return delta.x !== 0 || delta.y !== 0;
    },
    hasMouseButtonEvent(): boolean {
      if (viewportInputDisabled) return false;
      for (let button = 0; button < 5; button += 1) {
        if (
          input.isDeviceMouseButtonJustPressed(button) ||
          input.isDeviceMouseButtonJustReleased(button)
        ) {
          return true;
        }
      }
      return false;
    },
    getMouseButtonEventIndex(): number {
      // Godot orders LEFT/RIGHT/MIDDLE as 1/2/3; DOM orders left/middle/right as 0/1/2.
      const godotToDom = [0, 0, 2, 1, 3, 4] as const;
      for (let button = 1; button <= 5; button += 1) {
        const domButton = godotToDom[button] as number;
        if (
          input.isDeviceMouseButtonJustPressed(domButton) ||
          input.isDeviceMouseButtonJustReleased(domButton)
        ) {
          return button;
        }
      }
      return 0;
    },
    isMouseButtonEventPressed(): boolean {
      for (let button = 0; button < 5; button += 1) {
        if (input.isDeviceMouseButtonJustPressed(button)) return true;
        if (input.isDeviceMouseButtonJustReleased(button)) return false;
      }
      return false;
    },
    setCustomMouseCursor(texture, shape, hotspot): void {
      if (shape !== 0) {
        throw new Error(
          `godot-compat: Input.set_custom_mouse_cursor shape ${shape} — only CURSOR_ARROW (0) ` +
            'is measured; silently replacing a different system cursor would change its scope.',
        );
      }
      const textureUrl = texture.startsWith('res://')
        ? `/${texture.slice('res://'.length)}`
        : texture;
      visibleCursor = `url("${textureUrl}") ${Math.trunc(hotspot.x)} ${Math.trunc(hotspot.y)}, default`;
      if (service.getMouseMode() !== MOUSE_MODE_HIDDEN) applyCursor(visibleCursor);
    },
    setDefaultCursorShape(shape): void {
      const cursors = [
        'default', 'text', 'pointer', 'crosshair', 'wait', 'progress', 'grab', 'copy',
        'not-allowed', 'ns-resize', 'ew-resize', 'nesw-resize', 'nwse-resize', 'move',
        'row-resize', 'col-resize', 'help',
      ] as const;
      if (!Number.isSafeInteger(shape) || shape < 0 || shape >= cursors.length) {
        throw new RangeError('godot-compat: Input.set_default_cursor_shape requires CURSOR_ARROW (0) through CURSOR_HELP (16).');
      }
      visibleCursor = cursors[shape]!;
      currentCursorShape = shape;
      if (service.getMouseMode() !== MOUSE_MODE_HIDDEN) applyCursor(visibleCursor);
    },
    getCurrentCursorShape(): number {
      return currentCursorShape;
    },
    getMousePosition(): Vector2 {
      // A VALUE copy: Godot's Vector2 read is not an alias, and this record is
      // the engine's own live one.
      const position = pointer.getPosition();
      return vec2(position.x, position.y);
    },
    setMousePosition(position): void {
      pointer.setPosition(position);
    },
    getViewportSize(): Vector2 {
      return vec2(viewport.x, viewport.y);
    },
    setViewportInputDisabled(disabled): void {
      if (typeof disabled !== 'boolean') throw new TypeError('Viewport.set_disable_input requires bool.');
      viewportInputDisabled = disabled;
    },
    isViewportInputDisabled(): boolean {
      return viewportInputDisabled;
    },
    getViewportTexture(): GodotViewportTexture {
      return mainViewportTexture;
    },
    hasViewportTransparentBackground(): boolean {
      return viewportTransparentBackground;
    },
    setViewportTransparentBackground(transparent): void {
      if (typeof transparent !== 'boolean') {
        throw new TypeError('godot-compat: Viewport.transparent_bg requires bool.');
      }
      const apply = options.setViewportTransparentBackground;
      if (apply === undefined) {
        throw new Error(
          'godot-compat: main Viewport.transparent_bg requires the mounted native renderer owner.',
        );
      }
      apply(transparent);
      viewportTransparentBackground = transparent;
    },
    setDefaultClearColor(color): void {
      const apply = options.setDefaultClearColor;
      if (apply === undefined) {
        throw new Error('godot-compat: RenderingServer.set_default_clear_color requires the mounted native renderer owner.');
      }
      apply(color);
    },
    pushViewportInput(event, inLocalCoords = false): void {
      if (typeof inLocalCoords !== 'boolean') {
        throw new TypeError('godot-compat: Viewport.push_input in_local_coords requires bool.');
      }
      if (
        typeof event !== 'object' ||
        event === null ||
        typeof (event as { readonly __godotClass?: unknown }).__godotClass !== 'string'
      ) {
        throw new TypeError('godot-compat: Viewport.push_input requires an InputEvent.');
      }
      if (event.__godotClass !== 'InputEventAction') {
        throw new Error(
          `godot-compat: Viewport.push_input cannot inject ${event.__godotClass}; ` +
            'the retained browser input owner exposes action injection, not native device-event dispatch.',
        );
      }
      if (!viewportInputDisabled) service.parseInputEvent(event);
    },
    takeScreenEvents(): readonly GodotScreenEvent[] {
      if (viewportInputDisabled) {
        pointer.takeTouches();
        return [];
      }
      return pointer.takeTouches().map(screenEventOf);
    },
    beginScreenEvent(event): void {
      currentScreenEvent = event;
    },
    setInputAsHandled(): void {
      if (currentScreenEvent !== undefined) currentScreenEvent.handled = true;
    },
    isInputHandled(): boolean {
      return currentScreenEvent?.handled ?? false;
    },
    dispose(): void {
      applyCursor('default');
      pointer.dispose();
      if (inputWindow !== null) {
        inputWindow.removeEventListener('gamepadconnected', gamepadConnected);
        inputWindow.removeEventListener('gamepaddisconnected', gamepadDisconnected);
      }
      if (INPUT_BY_MANAGER.get(input) === service) INPUT_BY_MANAGER.delete(input);
    },
  };
  INPUT_BY_MANAGER.set(input, service);
  return service;
}

/** Input singleton emitter door over the mounted game InputManager. */
export function godotParseInputEvent(input: InputManager, event: GodotInputMapEvent): void {
  const service = godotInputOf(input);
  if (service === undefined) {
    throw new Error('Input.parse_input_event requires the mounted Godot input service.');
  }
  service.parseInputEvent(event);
}

/** `Node.get_viewport()` — a handle whose `getMousePosition` is Godot's
 *  `Viewport.get_mouse_position` and whose size is the viewport
 *  `projectRayNormal` unprojects through. builder.gd:54. */
export interface GodotMainViewportHandle {
  getMousePosition: () => Vector2;
  getSize: () => Vector2;
  getTexture: () => GodotViewportTexture;
  sizeChanged: GodotSignal<readonly []>;
  setInputAsHandled: () => void;
  isInputHandled: () => boolean;
  hasTransparentBackground: () => boolean;
  setTransparentBackground: (transparent: boolean) => void;
  pushInput: (event: GodotInputMapEvent, inLocalCoords?: boolean) => void;
  input: (event: GodotInputMapEvent) => void;
  setDisableInput: (disabled: boolean) => void;
  isInputDisabled: () => boolean;
}

const MAIN_VIEWPORT_BY_INPUT = new WeakMap<GodotInput, GodotMainViewportHandle>();

export function getViewport(input: GodotInput): GodotMainViewportHandle {
  const retained = MAIN_VIEWPORT_BY_INPUT.get(input);
  if (retained !== undefined) return retained;
  const viewport: GodotMainViewportHandle = {
    getMousePosition: () => input.getMousePosition?.() ?? VECTOR2_ZERO,
    getSize: () => {
      const size = input.getViewportSize();
      return vec2(size.x, size.y);
    },
    getTexture: () => input.getViewportTexture(),
    sizeChanged: input.sizeChanged,
    setInputAsHandled: () => input.setInputAsHandled(),
    isInputHandled: () => input.isInputHandled(),
    hasTransparentBackground: () => input.hasViewportTransparentBackground(),
    setTransparentBackground: (transparent) => input.setViewportTransparentBackground(transparent),
    pushInput: (event, inLocalCoords) => input.pushViewportInput(event, inLocalCoords),
    input: (event) => input.pushViewportInput(event, true),
    setDisableInput: (disabled) => input.setViewportInputDisabled(disabled),
    isInputDisabled: () => input.isViewportInputDisabled(),
  };
  MAIN_VIEWPORT_BY_INPUT.set(input, viewport);
  return viewport;
}
