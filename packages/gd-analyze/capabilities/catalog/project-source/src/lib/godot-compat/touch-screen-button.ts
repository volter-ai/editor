import {
  isGodotShape2D,
  type GodotShape2D,
} from './physics-query-2d';
import { projectGodotTexture } from './button-icon';
import { registerGodotObjectIdentity } from './object';
import type { GodotBitMap } from './bitmap';

/**
 * The retained source-side identity for a Godot TouchScreenButton.
 *
 * The DOM overlay is only its renderer. GDScript owns this object and may replace the Shape2D or
 * mutate the retained resource in place; pointer hit testing resolves the current object by the
 * authored source id for every event, so it never reads a serialized startup copy.
 */
export interface GodotTouchScreenButton {
  action: string;
  normal: unknown | null;
  pressed: unknown | null;
  shape: GodotShape2D | null;
  shape_centered: boolean;
  passby_press: boolean;
  bitmask: GodotBitMap | null;
  shape_visible: boolean;
  visibility_mode: number;
  readonly down: boolean;
  readonly sourceId: string;
  set_action(action: string): void;
  get_action(): string;
  set_texture_normal(texture: unknown | null): void;
  get_texture_normal(): unknown | null;
  set_texture_pressed(texture: unknown | null): void;
  get_texture_pressed(): unknown | null;
  set_bitmask(bitmask: GodotBitMap | null): void;
  get_bitmask(): GodotBitMap | null;
  set_shape(shape: GodotShape2D | null): void;
  get_shape(): GodotShape2D | null;
  set_shape_centered(centered: boolean): void;
  is_shape_centered(): boolean;
  set_shape_visible(visible: boolean): void;
  is_shape_visible(): boolean;
  set_passby_press(enabled: boolean): void;
  is_passby_press_enabled(): boolean;
  set_visibility_mode(mode: number): void;
  get_visibility_mode(): number;
  is_pressed(): boolean;
  dispose(): void;
}

const TOUCH_SCREEN_BUTTONS = new Map<string, GodotTouchScreenButton>();
const TOUCH_TEXTURE_SOURCES = new WeakMap<GodotTouchScreenButton, { normal?: string; pressed?: string }>();
const GODOT_TOUCH_SCREEN_BUTTONS = new WeakSet<object>();

export function isGodotTouchScreenButton(value: unknown): value is GodotTouchScreenButton {
  return typeof value === 'object' && value !== null && GODOT_TOUCH_SCREEN_BUTTONS.has(value);
}

function requireBoolean(value: unknown, property: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`TouchScreenButton.${property} requires a boolean.`);
  }
  return value;
}

function requireShape(value: unknown): GodotShape2D | null {
  if (value === null || isGodotShape2D(value)) return value;
  throw new TypeError('TouchScreenButton.shape requires a Shape2D Resource or null.');
}

/** Seat one scene-owned TouchScreenButton protocol in the project-wide overlay lookup. */
export function createGodotTouchScreenButton(
  sourceId: string,
  initialShape: GodotShape2D | null,
  initialShapeCentered: boolean,
  initialPassbyPress = false,
  initialAction = '',
  initialNormal: unknown | null = null,
  initialPressed: unknown | null = null,
): GodotTouchScreenButton {
  if (sourceId.length === 0) throw new TypeError('TouchScreenButton sourceId must not be empty.');
  let liveShape = requireShape(initialShape);
  let liveShapeCentered = requireBoolean(initialShapeCentered, 'shape_centered');
  let livePassbyPress = requireBoolean(initialPassbyPress, 'passby_press');
  let liveBitmask: GodotBitMap | null = null;
  let liveShapeVisible = false;
  let liveVisibilityMode = 0;
  let livePressed = false;
  let liveAction = initialAction;
  let liveNormal: unknown | null = initialNormal;
  let livePressedTexture: unknown | null = initialPressed;
  let normalSource = initialNormal === null ? undefined : projectGodotTexture(initialNormal, 'TouchScreenButton.normal').domSource;
  let pressedSource = initialPressed === null ? undefined : projectGodotTexture(initialPressed, 'TouchScreenButton.pressed').domSource;
  let disposed = false;
  const button = {
    sourceId,
    get action() { return liveAction; },
    set action(value: string) { if (typeof value !== 'string') throw new TypeError('TouchScreenButton.action requires String.'); liveAction = value; },
    get normal() { return liveNormal; },
    set normal(value: unknown | null) { liveNormal = value; normalSource = value === null ? undefined : projectGodotTexture(value, 'TouchScreenButton.normal').domSource; TOUCH_TEXTURE_SOURCES.set(button, { ...(normalSource === undefined ? {} : { normal: normalSource }), ...(pressedSource === undefined ? {} : { pressed: pressedSource }) }); },
    get pressed() { return livePressedTexture; },
    set pressed(value: unknown | null) { livePressedTexture = value; pressedSource = value === null ? undefined : projectGodotTexture(value, 'TouchScreenButton.pressed').domSource; TOUCH_TEXTURE_SOURCES.set(button, { ...(normalSource === undefined ? {} : { normal: normalSource }), ...(pressedSource === undefined ? {} : { pressed: pressedSource }) }); },
    get shape() {
      return liveShape;
    },
    set shape(value: GodotShape2D | null) {
      liveShape = requireShape(value);
    },
    get shape_centered() {
      return liveShapeCentered;
    },
    set shape_centered(value: boolean) {
      liveShapeCentered = requireBoolean(value, 'shape_centered');
    },
    get passby_press() {
      return livePassbyPress;
    },
    set passby_press(value: boolean) {
      livePassbyPress = requireBoolean(value, 'passby_press');
    },
    get bitmask() { return liveBitmask; },
    set bitmask(value: GodotBitMap | null) { if (value !== null && (typeof value !== 'object' || value === null)) throw new TypeError('TouchScreenButton.bitmask requires BitMap or null.'); liveBitmask = value; },
    get shape_visible() { return liveShapeVisible; },
    set shape_visible(value: boolean) { liveShapeVisible = requireBoolean(value, 'shape_visible'); },
    get visibility_mode() { return liveVisibilityMode; },
    set visibility_mode(value: number) { if (!Number.isSafeInteger(value) || value < 0 || value > 2) throw new RangeError('TouchScreenButton.visibility_mode must be ALWAYS (0), TOUCHSCREEN_ONLY (1), or DESKTOP_ONLY (2).'); liveVisibilityMode = value; },
    get down() {
      return livePressed;
    },
    set down(value: boolean) {
      livePressed = requireBoolean(value, 'pressed');
    },
    set_action(value: string) { button.action = value; },
    get_action() { return liveAction; },
    set_texture_normal(value: unknown | null) { button.normal = value; },
    get_texture_normal() { return liveNormal; },
    set_texture_pressed(value: unknown | null) { button.pressed = value; },
    get_texture_pressed() { return livePressedTexture; },
    set_bitmask(value: GodotBitMap | null) { button.bitmask = value; },
    get_bitmask() { return liveBitmask; },
    set_shape(value: GodotShape2D | null) { button.shape = value; },
    get_shape() { return liveShape; },
    set_shape_centered(value: boolean) { button.shape_centered = value; },
    is_shape_centered() { return liveShapeCentered; },
    set_shape_visible(value: boolean) { button.shape_visible = value; },
    is_shape_visible() { return liveShapeVisible; },
    set_passby_press(value: boolean) { button.passby_press = value; },
    is_passby_press_enabled() { return livePassbyPress; },
    set_visibility_mode(value: number) { button.visibility_mode = value; },
    get_visibility_mode() { return liveVisibilityMode; },
    is_pressed() { return livePressed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (TOUCH_SCREEN_BUTTONS.get(sourceId) === button) TOUCH_SCREEN_BUTTONS.delete(sourceId);
    },
  } satisfies GodotTouchScreenButton;
  GODOT_TOUCH_SCREEN_BUTTONS.add(button);
  registerGodotObjectIdentity(button, 'TouchScreenButton');
  TOUCH_TEXTURE_SOURCES.set(button, { ...(normalSource === undefined ? {} : { normal: normalSource }), ...(pressedSource === undefined ? {} : { pressed: pressedSource }) });
  TOUCH_SCREEN_BUTTONS.set(sourceId, button);
  return button;
}

/** Pointer interpreter write; the script-facing `is_pressed()` reads this exact retained state. */
export function setGodotTouchScreenButtonPressed(sourceId: string, pressed: boolean): void {
  const button = TOUCH_SCREEN_BUTTONS.get(sourceId);
  if (button === undefined) return;
  if (typeof pressed !== 'boolean') throw new TypeError('TouchScreenButton pressed state requires bool.');
  (button as { down: boolean }).down = pressed;
}

/** Current live hit-test state. Absence means the owning scene is not mounted. */
export function godotTouchScreenButtonState(
  sourceId: string,
): (Pick<GodotTouchScreenButton, 'shape' | 'shape_centered' | 'passby_press' | 'down' | 'action' | 'normal' | 'pressed'> & { readonly normalSource?: string; readonly pressedSource?: string }) | undefined {
  const button = TOUCH_SCREEN_BUTTONS.get(sourceId);
  if (button === undefined) return undefined;
  const sources = TOUCH_TEXTURE_SOURCES.get(button);
  return { ...button, ...(sources?.normal === undefined ? {} : { normalSource: sources.normal }), ...(sources?.pressed === undefined ? {} : { pressedSource: sources.pressed }) };
}
