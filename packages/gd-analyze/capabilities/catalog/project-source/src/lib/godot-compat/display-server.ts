/** Browser-native Godot 4 DisplayServer facilities that are not aliases of OS. */

import { rect2, type GodotRect2 } from './rect2';
import { godot4DomCodesForPhysicalKeycode, type GodotInput } from './input';
import type { ColorValue } from './variant';
import { vec2, type Vector2 } from './vector2';
import {
  godotDisplayServerGetScreenCount,
  godotDisplayServerSetIcon,
  godotOsSetWindowPosition,
  godotOsSetWindowSize,
} from './os';

const DISPLAY_FEATURE = {
  TOUCHSCREEN: 2, MOUSE: 3, CLIPBOARD: 5, VIRTUAL_KEYBOARD: 6,
  CURSOR_SHAPE: 7, CUSTOM_CURSOR_SHAPE: 8, HIDPI: 12, ICON: 13,
  ORIENTATION: 15, TEXT_TO_SPEECH: 19,
} as const;
const DISPLAY_ORIENTATION = {
  LANDSCAPE: 0, PORTRAIT: 1, REVERSE_LANDSCAPE: 2, REVERSE_PORTRAIT: 3, SENSOR: 6,
} as const;
const VIRTUAL_KEYBOARD_TYPE = {
  DEFAULT: 0, MULTILINE: 1, NUMBER: 2, NUMBER_DECIMAL: 3,
  PHONE: 4, EMAIL_ADDRESS: 5, PASSWORD: 6, URL: 7,
} as const;

const GODOT4_KEY_MODIFIER_MASK = 0x7f << 24;

interface BrowserKeyboardLayoutMap {
  get(code: string): string | undefined;
}

let keyboardLayoutMap: BrowserKeyboardLayoutMap | undefined;
let keyboardLayoutMapRequested = false;

/** Populate the asynchronous browser layout API once while preserving a synchronous call seam. */
function requestKeyboardLayoutMap(): void {
  if (keyboardLayoutMapRequested || typeof navigator === 'undefined') return;
  keyboardLayoutMapRequested = true;
  const keyboard = Reflect.get(navigator, 'keyboard');
  if (typeof keyboard !== 'object' || keyboard === null) return;
  const getLayoutMap = Reflect.get(keyboard, 'getLayoutMap');
  if (typeof getLayoutMap !== 'function') return;
  let requested: unknown;
  try {
    requested = Reflect.apply(getLayoutMap, keyboard, []);
  } catch {
    return;
  }
  void Promise.resolve(requested).then((value: unknown) => {
    if (
      typeof value === 'object' && value !== null &&
      typeof Reflect.get(value, 'get') === 'function'
    ) {
      keyboardLayoutMap = value as BrowserKeyboardLayoutMap;
    }
  }).catch(() => {
    // The synchronous Godot fallback is the physical QWERTY key when the host refuses layout
    // access, matching the native backends' failed-lookup path.
  });
}

/** One browser layout-map glyph in Godot's logical Key representation. */
function logicalKeycodeFromLayoutGlyph(glyph: string): number | undefined {
  const characters = [...glyph];
  if (characters.length !== 1) return undefined;
  const codepoint = characters[0]?.codePointAt(0);
  if (codepoint === undefined || codepoint < 0x20 || codepoint > 0x10ffff) return undefined;
  // Pinned X11 and web key conversion normalize only lowercase ASCII to uppercase.
  return codepoint >= 0x61 && codepoint <= 0x7a ? codepoint - 0x20 : codepoint;
}

/**
 * Godot 4 `DisplayServer.keyboard_get_keycode_from_physical` over the browser Keyboard Layout API.
 *
 * Native Godot isolates modifiers, resolves the physical US-QWERTY position through the active
 * layout, uppercases ASCII letters, and restores the modifiers. `getLayoutMap()` is asynchronous;
 * its resolved native map becomes the authoritative synchronous cache. Until it resolves—or when
 * the browser omits/refuses it—the exact native failed-lookup fallback is the input physical Key.
 */
export function godotDisplayServerKeyboardGetKeycodeFromPhysical(keycodeValue: unknown): number {
  const keycode = finiteInteger(keycodeValue, 'keyboard_get_keycode_from_physical');
  if (keycode < 0) {
    throw new RangeError('DisplayServer.keyboard_get_keycode_from_physical requires a non-negative Key.');
  }
  requestKeyboardLayoutMap();
  const layout = keyboardLayoutMap;
  const codes = godot4DomCodesForPhysicalKeycode(keycode);
  if (layout === undefined || codes === undefined) return keycode;
  for (const code of codes) {
    const glyph = layout.get(code);
    if (glyph === undefined) continue;
    const logical = logicalKeycodeFromLayoutGlyph(glyph);
    if (logical !== undefined) return logical | (keycode & GODOT4_KEY_MODIFIER_MASK);
  }
  return keycode;
}

function documentOwner(member: string): Document {
  if (typeof document === 'undefined') throw new Error(`DisplayServer.${member} requires a browser Document.`);
  return document;
}

function windowOwner(member: string): Window {
  if (typeof window === 'undefined') throw new Error(`DisplayServer.${member} requires a browser Window.`);
  return window;
}

function mainWindow(windowId: unknown, member: string): void {
  if (windowId !== 0) throw new Error(`DisplayServer.${member} cannot address non-main browser window ${String(windowId)}.`);
}

function oneScreen(screenIndex: unknown, member: string): void {
  if (screenIndex !== -1 && screenIndex !== 0) {
    throw new Error(`DisplayServer.${member} cannot address screen ${String(screenIndex)}; synchronous browser APIs expose one screen.`);
  }
  godotDisplayServerGetScreenCount();
}

function finiteInteger(value: unknown, member: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`DisplayServer.${member} requires an integer.`);
  return value as number;
}

function vector(value: unknown, member: string): Vector2 {
  if (typeof value !== 'object' || value === null) throw new TypeError(`DisplayServer.${member} requires Vector2i.`);
  const x = Number(Reflect.get(value, 'x'));
  const y = Number(Reflect.get(value, 'y'));
  if (![x, y].every(Number.isSafeInteger)) throw new TypeError(`DisplayServer.${member} requires integer Vector2i components.`);
  return vec2(x, y);
}

function cssSystemColor(name: 'AccentColor' | 'Canvas'): ColorValue {
  const owner = documentOwner(name === 'AccentColor' ? 'get_accent_color' : 'get_base_color');
  const browser = owner.defaultView;
  const css = browser === null ? undefined : Reflect.get(browser, 'CSS') as { supports?: (property: string, value: string) => boolean } | undefined;
  if (browser === null || typeof css?.supports !== 'function' || !css.supports('color', name)) {
    throw new Error(`DisplayServer cannot resolve unsupported browser system color ${name}.`);
  }
  const probe = owner.createElement('span');
  probe.style.color = name;
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  owner.body.appendChild(probe);
  const computed = browser.getComputedStyle(probe).color;
  probe.remove();
  const channels = computed.match(/[\d.]+/g)?.map(Number);
  if (channels === undefined || channels.length < 3 || channels.slice(0, 3).some((entry) => !Number.isFinite(entry))) {
    throw new Error(`DisplayServer could not resolve browser system color ${name}.`);
  }
  return {
    r: channels[0]! / 255,
    g: channels[1]! / 255,
    b: channels[2]! / 255,
    a: channels.length > 3 ? channels[3]! : 1,
  };
}

export function godotDisplayServerHasFeature(featureValue: unknown): boolean {
  const feature = finiteInteger(featureValue, 'has_feature');
  const browser = typeof navigator === 'undefined' ? undefined : navigator;
  const owner = typeof document === 'undefined' ? undefined : document;
  switch (feature) {
    case DISPLAY_FEATURE.TOUCHSCREEN:
      return (browser?.maxTouchPoints ?? 0) > 0;
    case DISPLAY_FEATURE.MOUSE:
      return typeof matchMedia === 'function' && matchMedia('(any-pointer: fine)').matches;
    case DISPLAY_FEATURE.CLIPBOARD:
      return typeof browser?.clipboard?.writeText === 'function' &&
        typeof browser.clipboard.readText === 'function';
    case DISPLAY_FEATURE.VIRTUAL_KEYBOARD:
      return owner !== undefined && (browser?.maxTouchPoints ?? 0) > 0;
    case DISPLAY_FEATURE.CURSOR_SHAPE:
    case DISPLAY_FEATURE.CUSTOM_CURSOR_SHAPE:
      return owner !== undefined;
    case DISPLAY_FEATURE.HIDPI:
      return typeof devicePixelRatio === 'number';
    case DISPLAY_FEATURE.ICON:
      return owner !== undefined && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
    case DISPLAY_FEATURE.ORIENTATION:
      return typeof screen !== 'undefined' && screen.orientation !== undefined;
    case DISPLAY_FEATURE.TEXT_TO_SPEECH:
      return typeof speechSynthesis !== 'undefined';
    default:
      return false;
  }
}

export function godotDisplayServerIsDarkModeSupported(): boolean {
  return typeof matchMedia === 'function';
}

export function godotDisplayServerIsDarkMode(): boolean {
  if (!godotDisplayServerIsDarkModeSupported()) {
    throw new Error('DisplayServer.is_dark_mode requires browser matchMedia.');
  }
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function godotDisplayServerGetAccentColor(): ColorValue {
  return cssSystemColor('AccentColor');
}

export function godotDisplayServerGetBaseColor(): ColorValue {
  return cssSystemColor('Canvas');
}

export function godotDisplayServerGetDisplayCutouts(): never {
  documentOwner('get_display_cutouts');
  throw new Error(
    'DisplayServer.get_display_cutouts is unavailable because CSS safe-area insets do not expose individual display-cutout rectangles.',
  );
}

export function godotDisplayServerGetDisplaySafeArea(): GodotRect2 {
  const owner = documentOwner('get_display_safe_area');
  const browser = windowOwner('get_display_safe_area');
  const probe = owner.createElement('div');
  probe.style.cssText = [
    'position:fixed', 'visibility:hidden', 'pointer-events:none',
    'padding-top:env(safe-area-inset-top, 0px)',
    'padding-right:env(safe-area-inset-right, 0px)',
    'padding-bottom:env(safe-area-inset-bottom, 0px)',
    'padding-left:env(safe-area-inset-left, 0px)',
  ].join(';');
  owner.body.appendChild(probe);
  const computed = browser.getComputedStyle(probe);
  const top = Number.parseFloat(computed.paddingTop) || 0;
  const right = Number.parseFloat(computed.paddingRight) || 0;
  const bottom = Number.parseFloat(computed.paddingBottom) || 0;
  const left = Number.parseFloat(computed.paddingLeft) || 0;
  probe.remove();
  return rect2(
    left,
    top,
    Math.max(0, browser.innerWidth - left - right),
    Math.max(0, browser.innerHeight - top - bottom),
  );
}

/** Browsers do not synchronously expose monitor refresh rate; Godot uses -1 for unknown. */
export function godotDisplayServerScreenGetRefreshRate(screenIndex = -1): number {
  oneScreen(screenIndex, 'screen_get_refresh_rate');
  return -1;
}

const ORIENTATION_LOCKS = [
  'landscape-primary', 'portrait-primary', 'landscape-secondary', 'portrait-secondary',
  'landscape', 'portrait', 'any',
] as const;

export function godotDisplayServerScreenSetOrientation(orientationValue: unknown, screenIndex = -1): void {
  oneScreen(screenIndex, 'screen_set_orientation');
  const orientation = finiteInteger(orientationValue, 'screen_set_orientation');
  if (orientation < 0 || orientation > DISPLAY_ORIENTATION.SENSOR) {
    throw new RangeError('DisplayServer.screen_set_orientation requires ScreenOrientation 0..6.');
  }
  if (typeof screen === 'undefined' || screen.orientation === undefined) {
    throw new Error('DisplayServer.screen_set_orientation requires the browser Screen Orientation API.');
  }
  const lock = Reflect.get(screen.orientation, 'lock');
  if (typeof lock !== 'function') throw new Error('This browser does not allow screen-orientation locking.');
  const pending = Reflect.apply(lock, screen.orientation, [ORIENTATION_LOCKS[orientation]]) as Promise<void>;
  void pending.catch((error: unknown) => {
    console.error(`godot-compat: DisplayServer.screen_set_orientation was refused by the browser: ${String(error)}`);
  });
}

export function godotDisplayServerScreenGetOrientation(screenIndex = -1): number {
  oneScreen(screenIndex, 'screen_get_orientation');
  if (typeof screen === 'undefined' || screen.orientation === undefined) {
    throw new Error('DisplayServer.screen_get_orientation requires the browser Screen Orientation API.');
  }
  switch (screen.orientation.type) {
    case 'landscape-primary': return DISPLAY_ORIENTATION.LANDSCAPE;
    case 'portrait-primary': return DISPLAY_ORIENTATION.PORTRAIT;
    case 'landscape-secondary': return DISPLAY_ORIENTATION.REVERSE_LANDSCAPE;
    case 'portrait-secondary': return DISPLAY_ORIENTATION.REVERSE_PORTRAIT;
  }
  throw new Error(`DisplayServer received unknown browser orientation ${String(screen.orientation.type)}.`);
}

interface WakeLockHandle { release(): Promise<void>; readonly released: boolean }
let wakeLock: WakeLockHandle | undefined;
let keepScreenOn = false;
let wakeLockGeneration = 0;

export function godotDisplayServerScreenSetKeepOn(enabled: unknown): void {
  if (typeof enabled !== 'boolean') throw new TypeError('DisplayServer.screen_set_keep_on requires bool.');
  if (keepScreenOn === enabled) return;
  keepScreenOn = enabled;
  const generation = ++wakeLockGeneration;
  if (!enabled) {
    const current = wakeLock;
    wakeLock = undefined;
    if (current !== undefined && !current.released) {
      void current.release().catch((error: unknown) => console.error(`godot-compat: Wake Lock release failed: ${String(error)}`));
    }
    return;
  }
  if (typeof navigator === 'undefined') {
    keepScreenOn = false;
    throw new Error('DisplayServer.screen_set_keep_on requires navigator.wakeLock.');
  }
  const owner = Reflect.get(navigator, 'wakeLock');
  const request = typeof owner === 'object' && owner !== null ? Reflect.get(owner, 'request') : undefined;
  if (typeof request !== 'function') {
    keepScreenOn = false;
    throw new Error('DisplayServer.screen_set_keep_on is unavailable because this browser exposes no Screen Wake Lock API.');
  }
  const pending = Reflect.apply(request, owner, ['screen']) as Promise<WakeLockHandle>;
  void pending.then((handle) => {
    if (keepScreenOn && generation === wakeLockGeneration) {
      const previous = wakeLock;
      wakeLock = handle;
      if (previous !== undefined && previous !== handle && !previous.released) {
        void previous.release().catch((error: unknown) => console.error(`godot-compat: stale Wake Lock release failed: ${String(error)}`));
      }
    } else {
      void handle.release().catch((error: unknown) => console.error(`godot-compat: stale Wake Lock release failed: ${String(error)}`));
    }
  }).catch((error: unknown) => {
    if (generation === wakeLockGeneration) keepScreenOn = false;
    console.error(`godot-compat: DisplayServer.screen_set_keep_on was refused by the browser: ${String(error)}`);
  });
}

export function godotDisplayServerScreenIsKeptOn(): boolean {
  return keepScreenOn;
}

interface VirtualKeyboardState { readonly element: HTMLInputElement | HTMLTextAreaElement }
const virtualKeyboards = new WeakMap<Document, VirtualKeyboardState>();

export function godotDisplayServerVirtualKeyboardShow(
  existingText: unknown,
  position: unknown = rect2(0, 0, 0, 0),
  keyboardType = VIRTUAL_KEYBOARD_TYPE.DEFAULT,
  maxLength = -1,
  cursorStart = -1,
  cursorEnd = -1,
): void {
  if (typeof existingText !== 'string') throw new TypeError('DisplayServer.virtual_keyboard_show requires String text.');
  const kind = finiteInteger(keyboardType, 'virtual_keyboard_show');
  if (kind < 0 || kind > 7) throw new RangeError('DisplayServer.virtual_keyboard_show requires VirtualKeyboardType 0..7.');
  const maximum = finiteInteger(maxLength, 'virtual_keyboard_show');
  if (maximum < -1) throw new RangeError('DisplayServer.virtual_keyboard_show max_length must be -1 or non-negative.');
  if (typeof position !== 'object' || position === null) {
    throw new TypeError('DisplayServer.virtual_keyboard_show requires a Rect2 position.');
  }
  const bounds = position as { position?: Vector2; size?: Vector2 };
  const x = Number(bounds.position?.x), y = Number(bounds.position?.y);
  const width = Number(bounds.size?.x), height = Number(bounds.size?.y);
  if (![x, y, width, height].every(Number.isFinite)) {
    throw new TypeError('DisplayServer.virtual_keyboard_show requires a finite Rect2 position and size.');
  }
  const requestedStart = finiteInteger(cursorStart, 'virtual_keyboard_show');
  const requestedEnd = finiteInteger(cursorEnd, 'virtual_keyboard_show');
  if (requestedStart < -1 || requestedEnd < -1) {
    throw new RangeError('DisplayServer.virtual_keyboard_show cursor positions must be -1 or non-negative.');
  }
  const start = requestedStart < 0 ? existingText.length : Math.min(existingText.length, requestedStart);
  const end = requestedEnd < 0 ? start : Math.min(existingText.length, requestedEnd);

  // Nothing native exists until the complete Godot call has passed validation.
  const owner = documentOwner('virtual_keyboard_show');
  godotDisplayServerVirtualKeyboardHide();
  const element = kind === VIRTUAL_KEYBOARD_TYPE.MULTILINE
    ? owner.createElement('textarea')
    : owner.createElement('input');
  if (element.tagName === 'INPUT') {
    const input = element as HTMLInputElement;
    // Keep a selection-capable control for Godot's cursor_start/cursor_end contract; the native
    // inputMode still requests the specialized mobile layout without number/email's selection ban.
    input.type = kind === VIRTUAL_KEYBOARD_TYPE.PASSWORD ? 'password' : 'text';
    input.inputMode = kind === VIRTUAL_KEYBOARD_TYPE.NUMBER ? 'numeric'
      : kind === VIRTUAL_KEYBOARD_TYPE.NUMBER_DECIMAL ? 'decimal'
        : kind === VIRTUAL_KEYBOARD_TYPE.PHONE ? 'tel'
          : kind === VIRTUAL_KEYBOARD_TYPE.EMAIL_ADDRESS ? 'email'
            : kind === VIRTUAL_KEYBOARD_TYPE.URL ? 'url'
              : 'text';
  }
  element.value = existingText;
  if (maximum >= 0) element.maxLength = maximum;
  element.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${Math.max(1, width)}px;height:${Math.max(1, height)}px;opacity:0.01;pointer-events:none;z-index:-1;`;
  owner.body.appendChild(element);
  virtualKeyboards.set(owner, { element });
  try {
    element.focus({ preventScroll: true });
    element.setSelectionRange(start, end);
  } catch (error) {
    element.remove();
    virtualKeyboards.delete(owner);
    throw error;
  }
}

export function godotDisplayServerVirtualKeyboardHide(): void {
  const owner = documentOwner('virtual_keyboard_hide');
  const current = virtualKeyboards.get(owner);
  if (current === undefined) return;
  current.element.blur();
  current.element.remove();
  virtualKeyboards.delete(owner);
}

/** DisplayServer and Input are two Godot doors onto the mounted game's one native pointer owner. */
export function godotDisplayServerMouseSetMode(input: GodotInput, mode: unknown): void {
  input.setMouseMode(finiteInteger(mode, 'mouse_set_mode'));
}

export function godotDisplayServerMouseGetMode(input: GodotInput): number {
  return input.getMouseMode();
}

export function godotDisplayServerMouseGetPosition(input: GodotInput): Vector2 {
  return input.getMousePosition();
}

export function godotDisplayServerMouseGetButtonState(input: GodotInput): number {
  return input.getMouseButtonMask();
}

/** The Web display driver owns one top-level window; return it only when the point hits its native outer rect. */
export function godotDisplayServerGetWindowAtScreenPosition(position: unknown): number {
  const point = vector(position, 'get_window_at_screen_position');
  const browser = windowOwner('get_window_at_screen_position');
  return point.x >= browser.screenX && point.y >= browser.screenY &&
    point.x < browser.screenX + browser.outerWidth && point.y < browser.screenY + browser.outerHeight
    ? 0
    : -1;
}

export function godotDisplayServerWindowSetIcon(image: Parameters<typeof godotDisplayServerSetIcon>[0], windowId = 0): void {
  mainWindow(windowId, 'window_set_icon');
  godotDisplayServerSetIcon(image);
}

export function godotDisplayServerWindowMoveToForeground(windowId = 0): void {
  mainWindow(windowId, 'window_move_to_foreground');
  windowOwner('window_move_to_foreground').focus();
}

export function godotDisplayServerWindowSetPosition(position: unknown, windowId = 0): void {
  mainWindow(windowId, 'window_set_position');
  godotOsSetWindowPosition(vector(position, 'window_set_position'));
}

export function godotDisplayServerWindowSetSize(size: unknown, windowId = 0): void {
  mainWindow(windowId, 'window_set_size');
  const value = vector(size, 'window_set_size');
  if (value.x <= 0 || value.y <= 0) throw new RangeError('DisplayServer.window_set_size requires positive dimensions.');
  godotOsSetWindowSize(value);
}
