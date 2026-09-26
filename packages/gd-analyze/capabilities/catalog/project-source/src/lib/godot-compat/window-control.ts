/** Godot 4 embedded Window behavior over the retained DOM/Pixi content owner. */

import { controlBinding, type ControlPoint, type GodotControl } from './control-state';
import { observeGodotVisibility, setVisible, type VisibleNode } from './node';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';

export interface GodotWindowControl {
  title: string;
  size: ControlPoint;
  position: ControlPoint;
  visible: boolean;
  unresizable: boolean;
  borderless: boolean;
  always_on_top: boolean;
  transparent: boolean;
  unfocusable: boolean;
  popup_window: boolean;
  exclusive: boolean;
  transient: boolean;
  transient_to_focused: boolean;
  extend_to_title: boolean;
  mouse_passthrough: boolean;
  wrap_controls: boolean;
  mode: number;
  initial_position: number;
  current_screen: number;
  content_scale_size: ControlPoint;
  content_scale_mode: number;
  content_scale_aspect: number;
  content_scale_stretch: number;
  readonly close_requested: GodotSignal<readonly []>;
  readonly about_to_popup: GodotSignal<readonly []>;
  readonly visibility_changed: GodotSignal<readonly []>;
  readonly focus_entered: GodotSignal<readonly []>;
  readonly focus_exited: GodotSignal<readonly []>;
  readonly mouse_entered: GodotSignal<readonly []>;
  readonly mouse_exited: GodotSignal<readonly []>;
  readonly go_back_requested: GodotSignal<readonly []>;
  readonly dpi_changed: GodotSignal<readonly []>;
  readonly titlebar_changed: GodotSignal<readonly []>;
  set_title(value: string): void;
  get_title(): string;
  set_position(value: ControlPoint): void;
  get_position(): ControlPoint;
  set_size(value: ControlPoint): void;
  get_size(): ControlPoint;
  set_visible(value: boolean): void;
  is_visible(): boolean;
  is_embedded(): boolean;
  show(): void;
  hide(): void;
  popup(): void;
  popup_centered(minSize?: ControlPoint): void;
  popup_centered_ratio(ratio?: number): void;
  popup_centered_clamped(size?: ControlPoint, fallbackRatio?: number): void;
  set_mode(mode: number): void;
  get_mode(): number;
  set_current_screen(screen: number): void;
  get_current_screen(): number;
  set_content_scale_size(size: ControlPoint): void;
  get_content_scale_size(): ControlPoint;
  set_content_scale_mode(mode: number): void;
  get_content_scale_mode(): number;
  set_content_scale_aspect(aspect: number): void;
  get_content_scale_aspect(): number;
  set_content_scale_stretch(stretch: number): void;
  get_content_scale_stretch(): number;
  set_unresizable(enabled: boolean): void;
  get_unresizable(): boolean;
  set_borderless(enabled: boolean): void;
  get_borderless(): boolean;
  set_always_on_top(enabled: boolean): void;
  is_always_on_top(): boolean;
  set_transparent_background(enabled: boolean): void;
  is_transparent_background(): boolean;
  set_unfocusable(enabled: boolean): void;
  get_unfocusable(): boolean;
  set_popup_window(enabled: boolean): void;
  get_popup_window(): boolean;
  set_exclusive(enabled: boolean): void;
  is_exclusive(): boolean;
  set_transient(enabled: boolean): void;
  is_transient(): boolean;
  set_transient_to_focused(enabled: boolean): void;
  is_transient_to_focused(): boolean;
  set_extend_to_title(enabled: boolean): void;
  is_extended_to_title(): boolean;
  set_mouse_passthrough(enabled: boolean): void;
  is_mouse_passthrough(): boolean;
  set_wrap_controls(enabled: boolean): void;
  is_wrapping_controls(): boolean;
  grab_focus(): void;
  has_focus(): boolean;
  move_to_foreground(): void;
  request_attention(): void;
}

export interface WindowControlOptions {
  readonly viewportSize: () => ControlPoint;
  readonly title?: string;
  readonly unresizable?: boolean;
  readonly initialPosition?: number;
  readonly transparentBackground?: boolean;
  readonly readSize?: () => ControlPoint;
  readonly readPosition?: () => ControlPoint;
  readonly writeSize?: (size: ControlPoint) => void;
  readonly writePosition?: (position: ControlPoint) => void;
  readonly borderless?: boolean;
  readonly alwaysOnTop?: boolean;
  readonly unfocusable?: boolean;
  readonly popupWindow?: boolean;
  readonly exclusive?: boolean;
  readonly transient?: boolean;
  readonly transientToFocused?: boolean;
  readonly extendToTitle?: boolean;
  readonly mousePassthrough?: boolean;
  readonly wrapControls?: boolean;
  readonly mode?: number;
  readonly currentScreen?: number;
  readonly contentScaleSize?: ControlPoint;
  readonly contentScaleMode?: number;
  readonly contentScaleAspect?: number;
  readonly contentScaleStretch?: number;
}

type WindowPresentation = VisibleNode & {
  size: ControlPoint;
  position: ControlPoint;
};

function bool(value: boolean, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function text(value: string, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} requires String.`);
  return value;
}

function point(value: ControlPoint, member: string, positive = false): ControlPoint {
  if (
    typeof value !== 'object' || value === null ||
    !Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y) ||
    (positive && (value.x <= 0 || value.y <= 0))
  ) throw new TypeError(`${member} requires a ${positive ? 'positive ' : ''}Vector2i.`);
  return { x: value.x, y: value.y };
}

/**
 * Bind an embedded Godot 4 Window to the same native entity that owns its authored children.
 * Browser-global window-manager operations deliberately do not live here; this is the embedded
 * subwindow path and reports that distinction through `is_embedded()`.
 */
export function bindWindowControl(control: WindowPresentation, options: WindowControlOptions): GodotWindowControl {
  const windowControl = control as GodotWindowControl;
  const binding = controlBinding(control as unknown as GodotControl);
  const closeRequested = createSignal<readonly []>();
  const aboutToPopup = createSignal<readonly []>();
  const visibilityChanged = createSignal<readonly []>();
  const focusEntered = createSignal<readonly []>();
  const focusExited = createSignal<readonly []>();
  const mouseEntered = createSignal<readonly []>();
  const mouseExited = createSignal<readonly []>();
  const goBackRequested = createSignal<readonly []>();
  const dpiChanged = createSignal<readonly []>();
  const titlebarChanged = createSignal<readonly []>();
  const initialPosition = options.initialPosition ?? 0;
  if (initialPosition !== 0 && initialPosition !== 1 && initialPosition !== 2) {
    throw new Error(
      `Window.initial_position=${String(initialPosition)} requires native screen/window-manager placement; ` +
        'the embedded browser Window supports ABSOLUTE (0), CENTER_PRIMARY_SCREEN (1), and CENTER_MAIN_WINDOW_SCREEN (2).',
    );
  }
  let titleValue = text(options.title ?? '', 'Window.title');
  let unresizableValue = bool(options.unresizable ?? false, 'Window.unresizable');
  let borderless = bool(options.borderless ?? false, 'Window.borderless');
  let alwaysOnTop = bool(options.alwaysOnTop ?? false, 'Window.always_on_top');
  let transparent = bool(options.transparentBackground ?? false, 'Window.transparent');
  let unfocusable = bool(options.unfocusable ?? false, 'Window.unfocusable');
  let popupWindow = bool(options.popupWindow ?? false, 'Window.popup_window');
  let exclusive = bool(options.exclusive ?? false, 'Window.exclusive');
  let transient = bool(options.transient ?? false, 'Window.transient');
  let transientToFocused = bool(options.transientToFocused ?? false, 'Window.transient_to_focused');
  let extendToTitle = bool(options.extendToTitle ?? false, 'Window.extend_to_title');
  let mousePassthrough = bool(options.mousePassthrough ?? false, 'Window.mouse_passthrough');
  let wrapControls = bool(options.wrapControls ?? false, 'Window.wrap_controls');
  let mode = options.mode ?? 0;
  let currentScreen = options.currentScreen ?? 0;
  let contentScaleSize = point(options.contentScaleSize ?? { x: 0, y: 0 }, 'Window.content_scale_size');
  let contentScaleMode = options.contentScaleMode ?? 0;
  let contentScaleAspect = options.contentScaleAspect ?? 0;
  let contentScaleStretch = options.contentScaleStretch ?? 0;
  let focused = false;
  const readSize = options.readSize ?? (() => control.size);
  const readPosition = options.readPosition ?? (() => control.position);
  const writeSize = options.writeSize ?? ((value: ControlPoint) => { control.size = value; });
  const writePosition = options.writePosition ?? ((value: ControlPoint) => { control.position = value; });
  const viewportSize = (): ControlPoint => point(options.viewportSize(), 'Window viewport size');
  const center = (requested: ControlPoint): void => {
    const expectedSize = requested.x === 0 && requested.y === 0
      ? point(readSize(), 'Window.size', true)
      : point(requested, 'Window.popup_centered minsize', true);
    const viewport = viewportSize();
    const size = {
      x: Math.min(expectedSize.x, viewport.x),
      y: Math.min(expectedSize.y, viewport.y),
    };
    writeSize(size);
    writePosition({
      x: Math.floor((viewport.x - size.x) / 2),
      y: Math.floor((viewport.y - size.y) / 2),
    });
  };
  const syncPresentation = (): void => {
    binding.state.write(binding.id, {
      windowTitle: titleValue,
      windowTransparentBackground: options.transparentBackground ?? false,
      onWindowCloseRequest: () => closeRequested.emit(),
    });
  };
  const releaseVisibility = observeGodotVisibility(control, () => visibilityChanged.emit());
  binding.state.retain(releaseVisibility);
  Object.defineProperties(windowControl, {
    title: {
      enumerable: true,
      configurable: true,
      get: () => titleValue,
      set: (value: string) => { titleValue = text(value, 'Window.title'); syncPresentation(); },
    },
    unresizable: {
      enumerable: true,
      configurable: true,
      get: () => unresizableValue,
      set: (value: boolean) => { unresizableValue = bool(value, 'Window.unresizable'); },
    },
    borderless: { enumerable: true, configurable: true, get: () => borderless, set: (value: boolean) => { borderless = bool(value, 'Window.borderless'); syncPresentation(); } },
    always_on_top: { enumerable: true, configurable: true, get: () => alwaysOnTop, set: (value: boolean) => { alwaysOnTop = bool(value, 'Window.always_on_top'); } },
    transparent: { enumerable: true, configurable: true, get: () => transparent, set: (value: boolean) => { transparent = bool(value, 'Window.transparent'); syncPresentation(); } },
    unfocusable: { enumerable: true, configurable: true, get: () => unfocusable, set: (value: boolean) => { unfocusable = bool(value, 'Window.unfocusable'); if (unfocusable && focused) { focused = false; focusExited.emit(); } } },
    popup_window: { enumerable: true, configurable: true, get: () => popupWindow, set: (value: boolean) => { popupWindow = bool(value, 'Window.popup_window'); } },
    exclusive: { enumerable: true, configurable: true, get: () => exclusive, set: (value: boolean) => { exclusive = bool(value, 'Window.exclusive'); } },
    transient: { enumerable: true, configurable: true, get: () => transient, set: (value: boolean) => { transient = bool(value, 'Window.transient'); } },
    transient_to_focused: { enumerable: true, configurable: true, get: () => transientToFocused, set: (value: boolean) => { transientToFocused = bool(value, 'Window.transient_to_focused'); } },
    extend_to_title: { enumerable: true, configurable: true, get: () => extendToTitle, set: (value: boolean) => { extendToTitle = bool(value, 'Window.extend_to_title'); titlebarChanged.emit(); } },
    mouse_passthrough: { enumerable: true, configurable: true, get: () => mousePassthrough, set: (value: boolean) => { mousePassthrough = bool(value, 'Window.mouse_passthrough'); } },
    wrap_controls: { enumerable: true, configurable: true, get: () => wrapControls, set: (value: boolean) => { wrapControls = bool(value, 'Window.wrap_controls'); } },
    mode: { enumerable: true, configurable: true, get: () => mode, set: (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || value > 4) throw new RangeError('Window.mode must be in [0, 4].'); mode = value; } },
    initial_position: { enumerable: true, configurable: true, get: () => initialPosition },
    current_screen: { enumerable: true, configurable: true, get: () => currentScreen, set: (value: number) => { if (!Number.isSafeInteger(value)) throw new TypeError('Window.current_screen requires an integer.'); currentScreen = value; } },
    content_scale_size: { enumerable: true, configurable: true, get: () => ({ ...contentScaleSize }), set: (value: ControlPoint) => { contentScaleSize = point(value, 'Window.content_scale_size'); } },
    content_scale_mode: { enumerable: true, configurable: true, get: () => contentScaleMode, set: (value: number) => { if (!Number.isSafeInteger(value)) throw new TypeError('Window.content_scale_mode requires an integer.'); contentScaleMode = value; } },
    content_scale_aspect: { enumerable: true, configurable: true, get: () => contentScaleAspect, set: (value: number) => { if (!Number.isSafeInteger(value)) throw new TypeError('Window.content_scale_aspect requires an integer.'); contentScaleAspect = value; } },
    content_scale_stretch: { enumerable: true, configurable: true, get: () => contentScaleStretch, set: (value: number) => { if (!Number.isSafeInteger(value)) throw new TypeError('Window.content_scale_stretch requires an integer.'); contentScaleStretch = value; } },
    close_requested: { enumerable: true, configurable: true, value: closeRequested.signal },
    about_to_popup: { enumerable: true, configurable: true, value: aboutToPopup.signal },
    visibility_changed: { enumerable: true, configurable: true, value: visibilityChanged.signal },
    focus_entered: { enumerable: true, configurable: true, value: focusEntered.signal },
    focus_exited: { enumerable: true, configurable: true, value: focusExited.signal },
    mouse_entered: { enumerable: true, configurable: true, value: mouseEntered.signal },
    mouse_exited: { enumerable: true, configurable: true, value: mouseExited.signal },
    go_back_requested: { enumerable: true, configurable: true, value: goBackRequested.signal },
    dpi_changed: { enumerable: true, configurable: true, value: dpiChanged.signal },
    titlebar_changed: { enumerable: true, configurable: true, value: titlebarChanged.signal },
  });
  Object.assign(windowControl, {
    set_title(value: string): void { windowControl.title = value; },
    get_title(): string { return windowControl.title; },
    set_position(value: ControlPoint): void {
      writePosition(point(value, 'Window.position'));
    },
    get_position(): ControlPoint { return point(readPosition(), 'Window.position'); },
    set_size(value: ControlPoint): void {
      const size = point(value, 'Window.size', true);
      writeSize(size);
    },
    get_size(): ControlPoint { return point(readSize(), 'Window.size', true); },
    set_visible(value: boolean): void { setVisible(control, bool(value, 'Window.visible')); },
    is_visible(): boolean { return control.visible; },
    is_embedded(): boolean { return true; },
    show(): void {
      if (initialPosition !== 0 && !control.visible) center({ x: 0, y: 0 });
      setVisible(control, true);
    },
    hide(): void { setVisible(control, false); },
    popup(): void {
      aboutToPopup.emit();
      windowControl.show();
    },
    popup_centered(minSize: ControlPoint = { x: 0, y: 0 }): void {
      const requested = point(minSize, 'Window.popup_centered minsize');
      if (requested.x < 0 || requested.y < 0) {
        throw new RangeError('Window.popup_centered minsize must be a non-negative Vector2i.');
      }
      aboutToPopup.emit();
      center(requested);
      setVisible(control, true);
    },
    popup_centered_ratio(ratio = 0.8): void {
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new RangeError('Window.popup_centered_ratio requires ratio in [0, 1].');
      const viewport = viewportSize(); windowControl.popup_centered({ x: Math.floor(viewport.x * ratio), y: Math.floor(viewport.y * ratio) });
    },
    popup_centered_clamped(requested: ControlPoint = { x: 0, y: 0 }, fallbackRatio = 0.75): void {
      const size = point(requested, 'Window.popup_centered_clamped size');
      if (!Number.isFinite(fallbackRatio) || fallbackRatio < 0 || fallbackRatio > 1) throw new RangeError('Window.popup_centered_clamped fallback_ratio must be in [0, 1].');
      const viewport = viewportSize(); const current = readSize();
      windowControl.popup_centered({ x: Math.min(size.x || current.x, Math.floor(viewport.x * fallbackRatio)), y: Math.min(size.y || current.y, Math.floor(viewport.y * fallbackRatio)) });
    },
    set_mode(value: number): void { windowControl.mode = value; },
    get_mode(): number { return mode; },
    set_current_screen(value: number): void { windowControl.current_screen = value; },
    get_current_screen(): number { return currentScreen; },
    set_content_scale_size(value: ControlPoint): void { windowControl.content_scale_size = value; },
    get_content_scale_size(): ControlPoint { return { ...contentScaleSize }; },
    set_content_scale_mode(value: number): void { windowControl.content_scale_mode = value; },
    get_content_scale_mode(): number { return contentScaleMode; },
    set_content_scale_aspect(value: number): void { windowControl.content_scale_aspect = value; },
    get_content_scale_aspect(): number { return contentScaleAspect; },
    set_content_scale_stretch(value: number): void { windowControl.content_scale_stretch = value; },
    get_content_scale_stretch(): number { return contentScaleStretch; },
    set_unresizable(value: boolean): void { windowControl.unresizable = value; },
    get_unresizable(): boolean { return unresizableValue; },
    set_borderless(value: boolean): void { windowControl.borderless = value; },
    get_borderless(): boolean { return borderless; },
    set_always_on_top(value: boolean): void { windowControl.always_on_top = value; },
    is_always_on_top(): boolean { return alwaysOnTop; },
    set_transparent_background(value: boolean): void { windowControl.transparent = value; },
    is_transparent_background(): boolean { return transparent; },
    set_unfocusable(value: boolean): void { windowControl.unfocusable = value; },
    get_unfocusable(): boolean { return unfocusable; },
    set_popup_window(value: boolean): void { windowControl.popup_window = value; },
    get_popup_window(): boolean { return popupWindow; },
    set_exclusive(value: boolean): void { windowControl.exclusive = value; },
    is_exclusive(): boolean { return exclusive; },
    set_transient(value: boolean): void { windowControl.transient = value; },
    is_transient(): boolean { return transient; },
    set_transient_to_focused(value: boolean): void { windowControl.transient_to_focused = value; },
    is_transient_to_focused(): boolean { return transientToFocused; },
    set_extend_to_title(value: boolean): void { windowControl.extend_to_title = value; },
    is_extended_to_title(): boolean { return extendToTitle; },
    set_mouse_passthrough(value: boolean): void { windowControl.mouse_passthrough = value; },
    is_mouse_passthrough(): boolean { return mousePassthrough; },
    set_wrap_controls(value: boolean): void { windowControl.wrap_controls = value; },
    is_wrapping_controls(): boolean { return wrapControls; },
    grab_focus(): void { if (!unfocusable && !focused) { focused = true; focusEntered.emit(); } },
    has_focus(): boolean { return focused; },
    move_to_foreground(): void { windowControl.show(); windowControl.grab_focus(); },
    request_attention(): void { if (!focused) binding.state.write(binding.id, { windowAttentionRequested: true }); },
  });
  syncPresentation();
  registerGodotObjectIdentity(windowControl, 'Window');
  return windowControl;
}
