/**
 * @godot-class Window
 * @role BINDING
 *
 * Godot 4.7's root `Window` (`scene/main/window.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the page element the game draws in: the
 * root window's size is that element's size in CSS pixels, which the host sets when it mounts the
 * game and whenever the element is resized (the web display server's canvas size,
 * `platform/web/display_server_web.cpp`). The receiver is the tree's root entity.
 *
 * The root window is also where the page's input arrives: the canvas's keyboard, mouse and touch
 * events become Godot's input records as the web display server makes them
 * (`platform/web/display_server_web.cpp`, `dom_keys.inc`, `js/libs/library_godot_input.js`). The
 * record carries what `input-event.ts` models: a mouse motion's relative motion and button mask;
 * no unicode, double click, pressure or velocity; the wheel, gamepads and IME are not bound. `Input`'s mouse button
 * mask is kept here from the buttons this binding delivered (emulated mouse buttons from touches
 * do not change it). A key, mouse button or touch resumes the page's audio (`resume_audio`).
 */

import type { Object3D } from 'three';
import { godot_object_signal } from './signal';
import { godot_audio_resume } from './audio-stream';
import { flush_buffered_events, godot_input_attach_canvas, godot_input_frame, parse_input_event } from './input';
import { get_setting } from './project-settings';
import type { InputEventRecord } from './input-event';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector2i, type Vector2i } from './vector2i';
import { godot_collision_object_2d_repick } from './collision-object-2d';

const SIZES = new WeakMap<Object3D, Vector2i>();

/**
 * Stores the window's size as the host reads it from the page (`Window::set_size`,
 * `window.cpp:413`, with the size the display server gives); a script's own `set_size` on the root
 * window is the platform's to honour and is not bound. A size that differs from the stored one
 * emits the viewport's `size_changed` (`Viewport::_set_size`, `viewport.cpp:1188`), after the
 * floor of 2 (`viewport.cpp:1154`).
 *
 * @godot Window (protocol)
 * @source scene/main/window.cpp:413
 */
export function godot_window_set_size(self: Object3D, p_size: Vector2i): void {
  const size = vector2i(Math.max(p_size.x, 2), Math.max(p_size.y, 2));
  const previous = SIZES.get(self);
  SIZES.set(self, size);
  if (previous !== undefined && previous.x === size.x && previous.y === size.y) return;
  godot_object_signal<[]>(self, 'size_changed').emit();
}

/**
 * Connects `listener` to a viewport's `size_changed` (the root window's or a SubViewport's), as a
 * root Control connects its `_size_changed` on entering the canvas (`control.cpp:4577`); the returned call disconnects it
 * (`NOTIFICATION_EXIT_CANVAS`, `control.cpp:4589`).
 *
 * @godot Window (protocol)
 * @source scene/main/viewport.cpp:1188
 */
export function godot_window_connect_size_changed(self: Object3D, listener: () => void): () => void {
  const connection = godot_object_signal<[]>(self, 'size_changed').signal.connect(listener);
  return () => {
    connection.disconnect();
  };
}

/**
 * The window's size; before the host sets one, `DEFAULT_WINDOW_SIZE` squared (`window.h:104`).
 *
 * @godot Window.get_size
 * @source scene/main/window.cpp:427
 */
export function get_size(self: Object3D): Vector2i {
  return SIZES.get(self) ?? vector2i(100, 100);
}

/**
 * Where a window of `width` by `height` pixels shows the 2D world under the project's stretch
 * settings: `visible`, the size the 2D world is laid out at (the viewport's visible rect), shown
 * in the window's `screen` rect, `margin` in from its top-left corner.
 */
interface Stretch {
  readonly visible: Vector2;
  readonly screen: Vector2;
  readonly margin: Vector2;
}

/**
 * The project's stretch (`display/window/stretch/*`, `Window::_update_viewport_size`,
 * `window.cpp:1302`). In `canvas_items` mode the 2D world is laid out at the base size
 * (`display/window/size/viewport_*`) grown to the window's aspect as the aspect rule allows and
 * divided by the scale; the window shows it scaled to fit, centred when the rule keeps an aspect
 * the window does not have. `disabled` lays it out at the window's own size. `viewport` mode is
 * refused at import. The 3D world always renders at the window's size.
 */
function stretch(width: number, height: number): Stretch {
  const whole = vector2(width, height);
  const factor = Number(get_setting('display/window/stretch/scale', 1)) || 1;
  const base = vector2(Number(get_setting('display/window/size/viewport_width', 1152)), Number(get_setting('display/window/size/viewport_height', 648)));
  const mode = get_setting('display/window/stretch/mode', 'disabled');
  // `viewport` lays the 2D world out as `canvas_items` does; the page's canvas draws the 3D view (`project-composition`).
  if ((mode !== 'canvas_items' && mode !== 'viewport') || base.x <= 0 || base.y <= 0 || width <= 0 || height <= 0) {
    return { visible: vector2(width / factor, height / factor), screen: whole, margin: vector2() };
  }
  const aspect = String(get_setting('display/window/stretch/aspect', 'keep'));
  const baseAspect = base.x / base.y;
  const windowAspect = width / height;
  let visible = base;
  let screen = whole;
  if (aspect !== 'ignore' && Math.abs(baseAspect - windowAspect) > 1e-5) {
    const wider = baseAspect < windowAspect;
    if (wider && (aspect === 'keep_height' || aspect === 'expand')) visible = vector2(base.y * windowAspect, base.y);
    else if (!wider && (aspect === 'keep_width' || aspect === 'expand')) visible = vector2(base.x, base.x / windowAspect);
    else screen = wider ? vector2(height * baseAspect, height) : vector2(width, width / baseAspect);
  }
  screen = vector2(Math.floor(screen.x), Math.floor(screen.y));
  visible = vector2(Math.floor(visible.x), Math.floor(visible.y));
  const margin = vector2(Math.round((width - screen.x) / 2), Math.round((height - screen.y) / 2));
  return { visible: vector2(visible.x / factor, visible.y / factor), screen, margin };
}

/**
 * The size the window's 2D world is laid out at: the window's size stretched by the project's
 * stretch settings (`size_2d_override`, `window.cpp:1428`); a Control anchored to the root viewport
 * anchors to it.
 *
 * @godot Window (protocol)
 * @source scene/main/viewport.cpp:1238
 */
export function godot_window_visible_size(self: Object3D): Vector2 {
  const size = get_size(self);
  return stretch(size.x, size.y).visible;
}

/**
 * A point in the window's 2D world in the window's own pixels, where the 3D world renders
 * (`Viewport::get_camera_coords`, `viewport.cpp:3705`, through the stretch).
 *
 * @godot Window (protocol)
 * @source scene/main/viewport.cpp:3705
 */
export function godot_window_camera_coords(self: Object3D, p_pos: Vector2): Vector2 {
  const size = get_size(self);
  const { visible, screen, margin } = stretch(size.x, size.y);
  return vector2(margin.x + (p_pos.x * screen.x) / visible.x, margin.y + (p_pos.y * screen.y) / visible.y);
}

/**
 * Whether `entity` is a window whose size the host set (the root viewport).
 *
 * @godot Window (protocol)
 * @source scene/main/viewport.cpp:1238
 */
export function godot_window_has_size(entity: Object3D): boolean {
  return SIZES.has(entity);
}

// --- The page's input, as the web display server receives it.

/** `Key::SPECIAL` (`core/os/keyboard.h:48`). */
const S = 1 << 22;

/**
 * `dom_code2godot_scancode`'s table (`platform/web/dom_keys.inc:33`): a DOM `code` (physical) or
 * `key` (logical) string, not a Godot class, and the Godot `Key` it names.
 */
const DOM_KEY_ENTRIES: readonly (readonly [string, number])[] = [
  ['NumLock', S | 0x1a], ['Numpad0', S | 0x86], ['Numpad1', S | 0x87], ['Numpad2', S | 0x88],
  ['Numpad3', S | 0x89], ['Numpad4', S | 0x8a], ['Numpad5', S | 0x8b], ['Numpad6', S | 0x8c],
  ['Numpad7', S | 0x8d], ['Numpad8', S | 0x8e], ['Numpad9', S | 0x8f], ['NumpadAdd', S | 0x85],
  ['NumpadBackspace', S | 0x04], ['Clear', S | 0x0c], ['NumpadClear', S | 0x0c],
  ['NumpadClearEntry', S | 0x0c], ['NumpadDecimal', S | 0x84], ['NumpadDivide', S | 0x82],
  ['NumpadEnter', S | 0x06], ['NumpadEqual', 0x3d], ['NumpadMultiply', S | 0x81],
  ['NumpadParenLeft', 0x28], ['NumpadParenRight', 0x29], ['NumpadStar', S | 0x81],
  ['NumpadSubtract', S | 0x83], ['Backquote', 0x60], ['Backslash', 0x5c], ['BracketLeft', 0x5b],
  ['BracketRight', 0x5d], ['Comma', 0x2c],
  ...Array.from({ length: 10 }, (_, i): readonly [string, number] => [`Digit${String(i)}`, 0x30 + i]),
  ['Equal', 0x3d], ['IntlBackslash', 0x5c], ['IntlYen', 0xa5],
  ...Array.from({ length: 26 }, (_, i): readonly [string, number] => [`Key${String.fromCharCode(65 + i)}`, 65 + i]),
  ['Minus', 0x2d], ['Period', 0x2e], ['Quote', 0x27], ['Semicolon', 0x3b], ['Slash', 0x2f],
  ['Alt', S | 0x18], ['AltLeft', S | 0x18], ['AltRight', S | 0x18], ['Backspace', S | 0x04],
  ['CapsLock', S | 0x19], ['ContextMenu', S | 0x42], ['Control', S | 0x16], ['ControlLeft', S | 0x16],
  ['ControlRight', S | 0x16], ['Enter', S | 0x05], ['Meta', S | 0x17], ['MetaLeft', S | 0x17],
  ['MetaRight', S | 0x17], ['OSLeft', S | 0x17], ['OSRight', S | 0x17], ['Shift', S | 0x15],
  ['ShiftLeft', S | 0x15], ['ShiftRight', S | 0x15], ['Space', 0x20], ['Tab', S | 0x02],
  ['Delete', S | 0x08], ['End', S | 0x0e], ['Help', S | 0x45], ['Home', S | 0x0d], ['Insert', S | 0x07],
  ['PageDown', S | 0x14], ['PageUp', S | 0x13], ['ArrowDown', S | 0x12], ['ArrowLeft', S | 0x0f],
  ['ArrowRight', S | 0x11], ['ArrowUp', S | 0x10], ['Escape', S | 0x01],
  ...Array.from({ length: 12 }, (_, i): readonly [string, number] => [`F${String(i + 1)}`, S | (0x1c + i)]),
  ['PrintScreen', S | 0x0a], ['ScrollLock', S | 0x1b], ['Pause', S | 0x09], ['BrowserBack', S | 0x48],
  ['BrowserFavorites', S | 0x5a], ['BrowserForward', S | 0x49], ['BrowserHome', S | 0x5d],
  ['BrowserRefresh', S | 0x4b], ['BrowserSearch', S | 0x5b], ['BrowserStop', S | 0x4a],
  ['LaunchApp1', S | 0x60], ['LaunchApp2', S | 0x61], ['LaunchMail', S | 0x5e],
  ['MediaPlayPause', S | 0x54], ['MediaSelect', S | 0x5f], ['MediaStop', S | 0x55],
  ['MediaTrackNext', S | 0x57], ['MediaTrackPrevious', S | 0x56], ['AudioVolumeDown', S | 0x4c],
  ['AudioVolumeMute', S | 0x4d], ['AudioVolumeUp', S | 0x4e],
];
const DOM_KEYS: ReadonlyMap<string, number> = new Map(DOM_KEY_ENTRIES);

/** `dom_code2godot_scancode` (`dom_keys.inc:33`): the table, then the key's printable ASCII (uppercased), `¥`, `§`. */
function domKey(code: string, key: string, physical: boolean): number {
  const named = DOM_KEYS.get(physical ? code : key);
  if (named !== undefined) return named;
  const b0 = key.length > 0 ? (key.codePointAt(0) as number) : 0;
  if (b0 >= 0x20 && b0 < 0x7f) return b0 > 0x60 && b0 < 0x7b ? b0 - 32 : b0;
  if (b0 === 0xa5 || b0 === 0xa7) return b0;
  return 0;
}

/** `dom_code2godot_key_location` (`dom_keys.inc:228`): left 1, right 2, else unspecified 0. */
function domLocation(code: string): number {
  if (/^(Alt|Control|Meta|OS|Shift)Left$/u.test(code)) return 1;
  if (/^(Alt|Control|Meta|OS|Shift)Right$/u.test(code)) return 2;
  return 0;
}

/** `String::char_uppercase` of one character. */
function upper(c: number): number {
  const up = String.fromCodePoint(c).toUpperCase();
  return [...up].length === 1 ? (up.codePointAt(0) as number) : c;
}

interface PageModifiers {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** `dom2godot_mod` (`display_server_web.cpp:152`): a modifier key's own flag is left unset. */
function modifiers(mod: PageModifiers, keycode: number): Partial<Record<'shift_pressed' | 'alt_pressed' | 'ctrl_pressed' | 'meta_pressed', boolean>> {
  return {
    ...(keycode === (S | 0x15) ? {} : { shift_pressed: mod.shiftKey }),
    ...(keycode === (S | 0x18) ? {} : { alt_pressed: mod.altKey }),
    ...(keycode === (S | 0x16) ? {} : { ctrl_pressed: mod.ctrlKey }),
    ...(keycode === (S | 0x17) ? {} : { meta_pressed: mod.metaKey }),
  };
}

/** `DOM_BUTTON_*` to `MouseButton` (`display_server_web.cpp:249`): left, middle, right, X1, X2. */
const MOUSE_BUTTONS: readonly number[] = [1, 3, 2, 8, 9];

const web = {
  keys: [] as InputEventRecord[],
  mask: 0,
  insideCanvas: false,
  canvas: null as HTMLCanvasElement | null,
};

/**
 * `GodotInput.computePosition` (`platform/web/js/libs/library_godot_input.js:492`): the client
 * point in the canvas's drawing-buffer pixels, then in the root viewport's 2D world through the
 * stretch (`Viewport::push_input` with `_get_input_pre_xform`, `viewport.cpp:3489`).
 */
function canvasPoint(canvas: HTMLCanvasElement, event: { readonly clientX: number; readonly clientY: number }): Vector2 {
  const rect = canvas.getBoundingClientRect();
  const { visible, screen, margin } = stretch(canvas.width, canvas.height);
  const x = (event.clientX - rect.x) * (canvas.width / rect.width);
  const y = (event.clientY - rect.y) * (canvas.height / rect.height);
  if (screen.x <= 0 || screen.y <= 0) return vector2(x, y);
  return vector2(((x - margin.x) * visible.x) / screen.x, ((y - margin.y) * visible.y) / screen.y);
}

/**
 * Listens to the page as the web export does (`library_godot_input.js`): keys on the canvas,
 * buffered until the next frame (`_key_callback`, `display_server_web.cpp:187`); mouse buttons
 * down on the canvas and up anywhere, parsed and flushed at once (`:240`, a release whose press
 * was outside the canvas ignored); pointer motion anywhere while the cursor is over the canvas or
 * a button is held (`:327`); touches on the canvas (`:742`, start and end flushed at once). The
 * canvas takes focus on a press, and its context menu is suppressed. The returned call removes
 * the listeners.
 *
 * @godot Window (protocol)
 * @source platform/web/display_server_web.cpp:187
 */
export function godot_window_attach_input(canvas: HTMLCanvasElement): () => void {
  // A new canvas hears no key or button the page before it queued or held.
  if (canvas !== web.canvas) {
    web.keys = [];
    web.mask = 0;
    web.canvas = canvas;
  }
  godot_input_attach_canvas(canvas);
  const page = canvas.ownerDocument.defaultView as Window;
  const listeners: (readonly [EventTarget, string, EventListener])[] = [];
  const on = (target: EventTarget, name: string, handler: EventListener): void => {
    target.addEventListener(name, handler);
    listeners.push([target, name, handler]);
  };
  if (canvas.tabIndex < 0) canvas.tabIndex = 0;
  const key = (pressed: boolean): EventListener => (raw) => {
    const event = raw as KeyboardEvent;
    // Typing into a field on the page (the host's, or the game's own DOM) is the field's.
    const target = event.target as HTMLElement | null;
    if (target !== null && target !== canvas && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return;
    const c = [...event.key].length === 1 ? (event.key.codePointAt(0) as number) : 0;
    const keycode = domKey(event.code, event.key, false);
    const fixed = c >= 0x20 && c <= 0x7e ? upper(c) : keycode;
    web.keys.push({
      type: 'key',
      pressed,
      echo: event.repeat,
      keycode: fixed,
      physical_keycode: domKey(event.code, event.key, true),
      key_label: c >= 0x20 && c !== 0x7f ? upper(c) : keycode,
      location: domLocation(event.code),
      ...modifiers(event, fixed),
    });
    godot_audio_resume();
    flush_buffered_events();
    event.preventDefault();
  };
  // The page's keys, as a web game hears them: the canvas itself need not hold the focus (a game
  // embedded in a host page, the editor's play view, never gives it one).
  on(page, 'keydown', key(true));
  on(page, 'keyup', key(false));
  const button = (pressed: boolean): EventListener => (raw) => {
    const event = raw as MouseEvent;
    if (pressed) canvas.focus();
    const index = MOUSE_BUTTONS[event.button];
    if (index === undefined) return;
    const flag = 1 << (index - 1);
    if (pressed) web.mask |= flag;
    else if ((web.mask & flag) !== 0) web.mask &= ~flag;
    else return;
    parse_input_event({ type: 'mouse_button', pressed, button_index: index, position: canvasPoint(canvas, event), ...modifiers(event, 0) });
    godot_audio_resume();
    flush_buffered_events();
    event.preventDefault();
  };
  on(canvas, 'mousedown', button(true));
  on(page, 'mouseup', button(false));
  on(page, 'pointermove', (raw) => {
    const event = raw as PointerEvent;
    if (!web.insideCanvas && web.mask === 0) return;
    // The movement scaled from CSS pixels to canvas pixels (`platform/web/js/libs/library_godot_input.js:528`),
    // then through the stretch as the position is.
    const rect = canvas.getBoundingClientRect();
    const { visible, screen } = stretch(canvas.width, canvas.height);
    const relative = vector2(
      rect.width === 0 || screen.x <= 0 ? 0 : (event.movementX * canvas.width * visible.x) / (rect.width * screen.x),
      rect.height === 0 || screen.y <= 0 ? 0 : (event.movementY * canvas.height * visible.y) / (rect.height * screen.y),
    );
    parse_input_event({ type: 'mouse_motion', position: canvasPoint(canvas, event), relative, button_mask: web.mask, ...modifiers(event, 0) });
  });
  on(canvas, 'mouseover', () => {
    web.insideCanvas = true;
  });
  on(canvas, 'mouseleave', () => {
    web.insideCanvas = false;
  });
  const touch = (type: 0 | 1 | 2): EventListener => (raw) => {
    const event = raw as TouchEvent;
    if (type === 0) canvas.focus();
    for (const point of Array.from(event.changedTouches)) {
      const position = canvasPoint(canvas, point);
      if (type === 2) {
        parse_input_event({ type: 'screen_drag', index: point.identifier, position });
      } else {
        godot_audio_resume();
        parse_input_event({ type: 'screen_touch', index: point.identifier, position, pressed: type === 0 });
        flush_buffered_events();
      }
    }
    if (event.cancelable) event.preventDefault();
  };
  on(canvas, 'touchstart', touch(0));
  on(canvas, 'touchend', touch(1));
  on(canvas, 'touchcancel', touch(1));
  on(canvas, 'touchmove', touch(2));
  on(canvas, 'contextmenu', (event) => event.preventDefault());
  return () => {
    godot_input_attach_canvas(null);
    for (const [target, name, handler] of listeners) target.removeEventListener(name, handler);
  };
}

/**
 * The start of a frame on the web (`OS_Web::main_loop_iterate`, `platform/web/os_web.cpp:87`):
 * the buffered keys become events, then Input flushes its buffer (`process_events`,
 * `display_server_web.cpp:1469`).
 *
 * @godot Window (protocol)
 * @source platform/web/display_server_web.cpp:1469
 */
export function godot_window_process_events(frame: { readonly id: number; readonly delta: number }): void {
  godot_input_frame(frame);
  const keys = web.keys;
  web.keys = [];
  for (const event of keys) parse_input_event(event);
  flush_buffered_events();
  godot_collision_object_2d_repick();
}

/**
 * The window's size on the web: the canvas's drawing buffer in pixels
 * (`DisplayServerWeb::window_get_size`).
 *
 * @godot Window (protocol)
 * @source platform/web/display_server_web.cpp:1393
 */
export function godot_window_canvas_size(canvas: HTMLCanvasElement): Vector2i {
  return vector2i(canvas.width, canvas.height);
}

const LAYERS = new WeakMap<HTMLCanvasElement, HTMLElement>();
/** The canvas z-index style each layer's stacking was computed from. */
const STACKED = new WeakMap<HTMLElement, string>();

/**
 * The page element the root Window's canvas layer is, once its frame placed it
 * (`godot_window_canvas_layer`): what each canvas item draws itself into.
 *
 * @godot Window (protocol)
 * @source servers/rendering/renderer_canvas_cull.cpp:304
 */
export function godot_window_canvas_root(canvas: HTMLCanvasElement): HTMLElement | undefined {
  return LAYERS.get(canvas);
}

/**
 * The element the canvas items draw into (`useGodotCanvasItem`): one absolutely placed layer over
 * the canvas in the canvas's parent, laid out at the stretched size the 2D world is laid out at and
 * scaled by a CSS transform to the part of the canvas's CSS box the window shows it in, and
 * transparent to the pointer, so the page's input reaches the canvas as in the web export. It
 * stacks above the canvas, as the web export's canvas items draw over its 3D view. The root Window
 * places it each frame.
 *
 * @godot Window (protocol)
 * @source servers/rendering/renderer_canvas_cull.cpp:304
 */
export function godot_window_canvas_layer(canvas: HTMLCanvasElement): HTMLElement {
  const parent = canvas.parentElement as HTMLElement;
  let layer = LAYERS.get(canvas);
  if (layer === undefined) {
    layer = canvas.ownerDocument.createElement('div');
    layer.style.position = 'absolute';
    layer.style.pointerEvents = 'none';
    layer.style.transformOrigin = '0 0';
    layer.style.overflow = 'hidden';
    LAYERS.set(canvas, layer);
  }
  // Every read before any write, so the frame costs no forced layout.
  const left = canvas.offsetLeft;
  const top = canvas.offsetTop;
  const cssWidth = canvas.clientWidth;
  if (layer.parentElement !== parent) {
    parent.appendChild(layer);
    STACKED.delete(layer);
  }
  // Laid out at the stretched size and scaled to the rect the window shows it in, from
  // drawing-buffer pixels to the canvas's CSS box.
  const { visible, screen, margin } = stretch(canvas.width, canvas.height);
  const css = canvas.width > 0 ? cssWidth / canvas.width : 1;
  layer.style.left = `${String(left + margin.x * css)}px`;
  layer.style.top = `${String(top + margin.y * css)}px`;
  layer.style.width = `${String(visible.x)}px`;
  layer.style.height = `${String(visible.y)}px`;
  // Over the canvas whatever stacking the page gives it (a positioned canvas with a z-index),
  // computed again only when the canvas's own z-index style changes.
  const stacking = canvas.style.zIndex;
  if (STACKED.get(layer) !== stacking) {
    const below = Number.parseInt(canvas.ownerDocument.defaultView?.getComputedStyle(canvas).zIndex ?? '', 10);
    layer.style.zIndex = Number.isNaN(below) ? '' : String(below + 1);
    STACKED.set(layer, stacking);
  }
  // The canvas's CSS width in its own box (`clientWidth`; a canvas carries no border or padding
  // here), not its on-screen rect: the layer sits in the same parent, so a transform on an ancestor
  // (a scaled preview) already applies to both.
  if (canvas.width > 0 && cssWidth > 0 && visible.x > 0 && visible.y > 0) {
    layer.style.transform = `scale(${String((css * screen.x) / visible.x)}, ${String((css * screen.y) / visible.y)})`;
  }
  return layer;
}

/** `Window::Mode` (`window.h:48`): `MODE_WINDOWED` 0, `MODE_FULLSCREEN` 3, `MODE_EXCLUSIVE_FULLSCREEN` 4. */
const MODE_WINDOWED = 0;
const MODE_FULLSCREEN = 3;
const MODE_EXCLUSIVE_FULLSCREEN = 4;

/**
 * The page's fullscreen state (`DisplayServerWeb::window_get_mode`, `display_server_web.cpp:1422`):
 * fullscreen while the document has a fullscreen element, else windowed.
 *
 * @godot Window.get_mode
 * @source scene/main/window.cpp:535
 */
export function get_mode(self: object): number {
  void self;
  return globalThis.document?.fullscreenElement ? MODE_FULLSCREEN : MODE_WINDOWED;
}

/**
 * Fullscreen asks the page's document for it (a browser grants it only in an input's handler);
 * windowed leaves it; maximized and minimized change nothing on the web
 * (`DisplayServerWeb::window_set_mode`, `display_server_web.cpp:1396`).
 *
 * @godot Window.set_mode
 * @source scene/main/window.cpp:523
 */
export function set_mode(self: object, mode: number): void {
  void self;
  const document = globalThis.document;
  if (document === undefined) return;
  if (mode === MODE_FULLSCREEN || mode === MODE_EXCLUSIVE_FULLSCREEN) {
    if (document.fullscreenElement === null) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  } else if (mode === MODE_WINDOWED && document.fullscreenElement !== null) {
    void document.exitFullscreen?.().catch(() => undefined);
  }
}
