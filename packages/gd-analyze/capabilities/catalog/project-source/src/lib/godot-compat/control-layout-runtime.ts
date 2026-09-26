/** Script-facing Control anchors, top offset, and cursor over the retained native entity. */
import { Container } from 'pixi.js';
import {
  getCanvasControlAnchorLeft,
  getCanvasControlAnchorTop,
  getCanvasControlAnchorsPreset,
  getCanvasControlMargin,
  getCanvasControlStretchRatio,
  setCanvasControlAnchorLeft,
  setCanvasControlAnchor,
  setCanvasControlAnchorsAndOffsetsPreset,
  setCanvasControlAnchorsPreset,
  setCanvasControlAnchorTop,
  setCanvasControlMargin,
  setCanvasControlStretchRatio,
} from './canvas-control-state';
import { optionalControlBinding, type GodotControl } from './control-state';

const CURSORS = new WeakMap<object, number>();
const STRETCH_RATIOS = new WeakMap<object, number>();
const BUTTON_ALIGNMENTS = new WeakMap<object, number>();
const TEXTURE_EXPAND_MODES = new WeakMap<object, number>();
const CURSOR_NAMES = [
  'default', 'text', 'pointer', 'crosshair', 'wait', 'progress', 'grab', 'copy',
  'not-allowed', 'ns-resize', 'ew-resize', 'nwse-resize', 'nesw-resize', 'move',
  'row-resize', 'col-resize', 'help',
] as const;

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires a finite number.`);
  return value;
}
export function setControlAnchorsPreset(control: object, preset: number, keepOffsets = false): void {
  if (!(control instanceof Container)) {
    throw new Error('Control.set_anchors_preset requires retained Pixi Control layout state.');
  }
  setCanvasControlAnchorsPreset(control, preset, keepOffsets);
}
export function setControlAnchor(
  control: object,
  side: number,
  anchor: number,
  keepOffset = false,
  pushOppositeAnchor = true,
): void {
  if (!(control instanceof Container)) {
    throw new Error('Control.set_anchor requires retained Pixi Control layout state.');
  }
  setCanvasControlAnchor(control, side, anchor, keepOffset, pushOppositeAnchor);
}
export function getControlAnchorsPreset(control: object): number {
  if (!(control instanceof Container)) {
    throw new Error('Control.anchors_preset requires retained Pixi Control layout state.');
  }
  return getCanvasControlAnchorsPreset(control);
}

export function setControlAnchorsAndOffsetsPreset(
  control: object,
  preset: number,
  resizeMode = 0,
  margin = 0,
): void {
  if (!(control instanceof Container)) {
    throw new Error('Control.set_anchors_and_offsets_preset requires retained Pixi Control layout state.');
  }
  setCanvasControlAnchorsAndOffsetsPreset(control, preset, resizeMode, margin);
}
export function getControlAnchorLeft(control: object): number {
  if (!(control instanceof Container)) throw new Error('Control.anchor_left requires retained Pixi Control layout state.');
  return getCanvasControlAnchorLeft(control);
}
export function setControlAnchorLeft(control: object, value: number): void {
  if (!(control instanceof Container)) throw new Error('Control.anchor_left requires retained Pixi Control layout state.');
  setCanvasControlAnchorLeft(control, value);
}
export function getControlAnchorTop(control: object): number {
  if (!(control instanceof Container)) throw new Error('Control.anchor_top requires retained Pixi Control layout state.');
  return getCanvasControlAnchorTop(control);
}
export function setControlAnchorTop(control: object, value: number): void {
  if (!(control instanceof Container)) throw new Error('Control.anchor_top requires retained Pixi Control layout state.');
  setCanvasControlAnchorTop(control, value);
}
export function getControlOffsetTop(control: object): number {
  return control instanceof Container ? getCanvasControlMargin(control, 'top') : (control as GodotControl).position.y;
}
export function setControlOffsetTop(control: object, value: number): void {
  const next = finite(value, 'Control.offset_top');
  if (control instanceof Container) setCanvasControlMargin(control, 'top', next);
  else (control as GodotControl).position = { x: (control as GodotControl).position.x, y: next };
}
export function getControlOffsetBottom(control: object): number {
  if (control instanceof Container) return getCanvasControlMargin(control, 'bottom');
  const retained = control as GodotControl;
  return retained.position.y + retained.size.y;
}
export function setControlOffsetBottom(control: object, value: number): void {
  const next = finite(value, 'Control.offset_bottom');
  if (control instanceof Container) setCanvasControlMargin(control, 'bottom', next);
  else {
    const retained = control as GodotControl;
    retained.size = { x: retained.size.x, y: next - retained.position.y };
  }
}
export function getControlStretchRatio(control: object): number {
  return control instanceof Container
    ? getCanvasControlStretchRatio(control)
    : STRETCH_RATIOS.get(control) ?? 1;
}
export function setControlStretchRatio(control: object, value: number): void {
  const next = finite(value, 'Control.size_flags_stretch_ratio');
  if (next < 0) throw new RangeError('Control.size_flags_stretch_ratio must be non-negative.');
  if (control instanceof Container) setCanvasControlStretchRatio(control, next);
  else {
    STRETCH_RATIOS.set(control, next);
    const binding = optionalControlBinding(control);
    const element = binding?.state.read(binding.id).focusElement;
    if (element != null) element.style.flexGrow = String(next);
  }
}
export function getButtonAlignment(button: object): number {
  return BUTTON_ALIGNMENTS.get(button) ?? 1;
}
export function setButtonAlignment(button: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
    throw new RangeError('Button.alignment must be LEFT (0), CENTER (1), RIGHT (2), or FILL (3).');
  }
  BUTTON_ALIGNMENTS.set(button, value);
  const align = value === 0 ? 'left' : value === 2 ? 'right' : value === 3 ? 'justify' : 'center';
  const styled = button as { style?: { align?: string } };
  if (styled.style !== undefined) styled.style.align = align;
  const binding = optionalControlBinding(button);
  const element = binding?.state.read(binding.id).focusElement;
  if (element != null) element.style.textAlign = align;
}
export function getTextureRectExpandMode(rect: object): number {
  return TEXTURE_EXPAND_MODES.get(rect) ?? 0;
}
export function setTextureRectExpandMode(rect: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 5) {
    throw new RangeError('TextureRect.expand_mode must be a Godot ExpandMode value in [0, 5].');
  }
  TEXTURE_EXPAND_MODES.set(rect, value);
  const binding = optionalControlBinding(rect);
  const element = binding?.state.read(binding.id).focusElement;
  if (element == null) return;
  element.style.width = value === 0 ? 'max-content' : value === 4 || value === 5 ? 'auto' : '100%';
  element.style.height = value === 0 ? 'max-content' : value === 2 || value === 3 ? 'auto' : '100%';
}
/** Godot 3 TextureRect.expand is the boolean spelling of KEEP_SIZE/IGNORE_SIZE. */
export function getTextureRectExpand(rect: object): boolean { return getTextureRectExpandMode(rect) !== 0; }
export function setTextureRectExpand(rect: object, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('TextureRect.expand requires bool.');
  setTextureRectExpandMode(rect, value ? 1 : 0);
}
export function getControlDefaultCursorShape(control: object): number { return CURSORS.get(control) ?? 0; }
export function setControlDefaultCursorShape(control: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 16) throw new RangeError('Control.mouse_default_cursor_shape must be in [0, 16].');
  CURSORS.set(control, value);
  if (control instanceof Container) control.cursor = CURSOR_NAMES[value] ?? 'default';
  const binding = optionalControlBinding(control);
  const element = binding?.state.read(binding.id).focusElement;
  if (element != null) element.style.cursor = CURSOR_NAMES[value] ?? 'default';
}
