/** Godot 3 Popup lifecycle over the retained Control entity. */

import { controlBinding, type ControlPoint, type GodotControl } from './control-state';
import { getControlCombinedMinimumSize } from './control-layout';
import { observeGodotVisibility, setVisible } from './node';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';

export interface PopupRect {
  readonly position: ControlPoint;
  readonly size: ControlPoint;
}

export interface GodotPopupControl extends GodotControl {
  exclusive: boolean;
  wrap_controls: boolean;
  readonly about_to_show: GodotSignal<readonly []>;
  readonly about_to_popup: GodotSignal<readonly []>;
  readonly popup_hide: GodotSignal<readonly []>;
  popup(bounds?: PopupRect): void;
  popup_centered(size?: ControlPoint): void;
  popup_centered_minsize(minSize?: ControlPoint): void;
  popup_centered_ratio(ratio?: number): void;
  popup_centered_clamped(size?: ControlPoint, fallbackRatio?: number): void;
  popup_on_parent(parentRect: PopupRect): void;
  popup_exclusive(fromNode?: object): void;
  set_as_minsize(): void;
  hide(): void;
  is_popup_visible(): boolean;
  set_exclusive(enabled: boolean): void;
  is_exclusive(): boolean;
  set_wrap_controls(enabled: boolean): void;
  is_wrapping_controls(): boolean;
}

/** Godot PopupPanel is the same popup owner with a panel presentation supplied by its scene. */
export type GodotPopupPanelControl = GodotPopupControl;

export interface PopupControlOptions {
  readonly viewportSize: () => ControlPoint;
  readonly readSize?: () => ControlPoint;
  readonly readPosition?: () => ControlPoint;
  readonly writeSize?: (size: ControlPoint) => void;
  readonly writePosition?: (position: ControlPoint) => void;
}

function point(value: ControlPoint, member: string, nonNegative: boolean): ControlPoint {
  if (
    typeof value !== 'object' || value === null ||
    !Number.isFinite(value.x) || !Number.isFinite(value.y) ||
    (nonNegative && (value.x < 0 || value.y < 0))
  ) {
    throw new TypeError(`${member} requires a finite${nonNegative ? ' non-negative' : ''} Vector2.`);
  }
  return { x: value.x, y: value.y };
}

export function bindPopupControl(control: GodotControl, options: PopupControlOptions): GodotPopupControl {
  const popup = control as GodotPopupControl;
  const aboutToShow = createSignal<readonly []>();
  const popupHide = createSignal<readonly []>();
  let popped = false;
  let exclusive = false;
  let wrapControls = false;
  const readSize = options.readSize ?? (() => control.size);
  const readPosition = options.readPosition ?? (() => control.position);
  const writeSize = options.writeSize ?? ((size: ControlPoint) => { control.size = size; });
  const writePosition = options.writePosition ?? ((position: ControlPoint) => { control.position = position; });
  const clampPosition = (position: ControlPoint, size: ControlPoint): ControlPoint => {
    const viewport = point(options.viewportSize(), 'Popup viewport size', true);
    return {
      x: Math.min(Math.max(position.x, 0), Math.max(0, viewport.x - size.x)),
      y: Math.min(Math.max(position.y, 0), Math.max(0, viewport.y - size.y)),
    };
  };
  const releaseVisibility = observeGodotVisibility(control, (visible) => {
    if (visible || !popped) return;
    popped = false;
    popupHide.emit();
  });
  controlBinding(control).state.retain(releaseVisibility);
  Object.defineProperties(popup, {
    exclusive: {
      enumerable: true,
      configurable: true,
      get: () => exclusive,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('Popup.exclusive requires bool.');
        exclusive = value;
      },
    },
    wrap_controls: {
      enumerable: true, configurable: true, get: () => wrapControls,
      set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('Popup.wrap_controls requires bool.'); wrapControls = value; },
    },
    about_to_show: { enumerable: true, configurable: true, value: aboutToShow.signal },
    about_to_popup: { enumerable: true, configurable: true, value: aboutToShow.signal },
    popup_hide: { enumerable: true, configurable: true, value: popupHide.signal },
  });
  const present = (): void => {
    aboutToShow.emit();
    popped = true;
    setVisible(control, true);
  };
  Object.assign(popup, {
    popup(bounds?: PopupRect): void {
      let position = point(readPosition(), 'Popup position', false);
      let size = point(readSize(), 'Popup size', true);
      if (bounds !== undefined) {
        const requestedPosition = point(bounds.position, 'Popup.popup bounds.position', false);
        const requestedSize = point(bounds.size, 'Popup.popup bounds.size', true);
        if (requestedPosition.x !== 0 || requestedPosition.y !== 0 || requestedSize.x !== 0 || requestedSize.y !== 0) {
          position = requestedPosition;
          size = requestedSize;
          writeSize(size);
        }
      }
      writePosition(clampPosition(position, size));
      present();
    },
    popup_centered(requested: ControlPoint = { x: 0, y: 0 }): void {
      const requestedSize = point(requested, 'Popup.popup_centered size', true);
      const size = requestedSize.x === 0 && requestedSize.y === 0
        ? point(readSize(), 'Popup size', true)
        : requestedSize;
      const viewport = point(options.viewportSize(), 'Popup viewport size', true);
      writeSize(size);
      writePosition(clampPosition({
        x: Math.floor((viewport.x - size.x) / 2),
        y: Math.floor((viewport.y - size.y) / 2),
      }, size));
      present();
    },
    set_as_minsize(): void {
      writeSize(getControlCombinedMinimumSize(control));
    },
    popup_centered_minsize(requested: ControlPoint = { x: 0, y: 0 }): void {
      const minimum = getControlCombinedMinimumSize(control);
      const requestedSize = point(requested, 'Popup.popup_centered_minsize minsize', true);
      popup.popup_centered({
        x: Math.max(minimum.x, requestedSize.x),
        y: Math.max(minimum.y, requestedSize.y),
      });
    },
    popup_centered_ratio(ratio = 0.8): void {
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new RangeError('Popup.popup_centered_ratio ratio must be in [0, 1].');
      const viewport = point(options.viewportSize(), 'Popup viewport size', true);
      popup.popup_centered({ x: Math.floor(viewport.x * ratio), y: Math.floor(viewport.y * ratio) });
    },
    popup_centered_clamped(requested: ControlPoint = { x: 0, y: 0 }, fallbackRatio = 0.75): void {
      const size = point(requested, 'Popup.popup_centered_clamped size', true);
      if (!Number.isFinite(fallbackRatio) || fallbackRatio < 0 || fallbackRatio > 1) throw new RangeError('Popup.popup_centered_clamped fallback_ratio must be in [0, 1].');
      const viewport = point(options.viewportSize(), 'Popup viewport size', true);
      popup.popup_centered({
        x: Math.min(size.x === 0 ? readSize().x : size.x, Math.floor(viewport.x * fallbackRatio)),
        y: Math.min(size.y === 0 ? readSize().y : size.y, Math.floor(viewport.y * fallbackRatio)),
      });
    },
    popup_on_parent(parentRect: PopupRect): void {
      const parentPosition = point(parentRect.position, 'Popup.popup_on_parent position', false);
      const parentSize = point(parentRect.size, 'Popup.popup_on_parent size', true);
      const size = point(readSize(), 'Popup size', true);
      writePosition(clampPosition({ x: parentPosition.x, y: parentPosition.y + parentSize.y }, size));
      present();
    },
    popup_exclusive(_fromNode?: object): void {
      popup.exclusive = true;
      popup.popup();
    },
    hide(): void { setVisible(control, false); },
    is_popup_visible(): boolean { return popped; },
    set_exclusive(enabled: boolean): void { popup.exclusive = enabled; },
    is_exclusive(): boolean { return exclusive; },
    set_wrap_controls(enabled: boolean): void { popup.wrap_controls = enabled; },
    is_wrapping_controls(): boolean { return wrapControls; },
  });
  setVisible(control, false);
  registerGodotObjectIdentity(popup, 'Popup');
  return popup;
}

/** Bind an authored PopupPanel without replacing the retained Control that owns its children. */
export function bindPopupPanel(
  control: GodotControl,
  options: PopupControlOptions,
): GodotPopupPanelControl {
  const popup = bindPopupControl(control, options);
  registerGodotObjectIdentity(popup, 'PopupPanel');
  return popup;
}
