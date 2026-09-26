/** Godot ReferenceRect state projected onto the retained DOM/Pixi Control identity. */

import { Container, Graphics } from 'pixi.js';
import {
  createControlState,
  registerControlBinding,
  optionalControlBinding,
  type ControlColor,
  type GodotControl,
} from './control-state';
import { bindCanvasControl } from './canvas-control-state';
import { registerGodotObjectIdentity } from './object';

export interface GodotReferenceRect extends GodotControl {
  border_color: ControlColor;
  border_width: number;
  editor_only: boolean;
  get_border_color(): ControlColor;
  set_border_color(value: ControlColor): void;
  get_border_width(): number;
  set_border_width(value: number): void;
  get_editor_only(): boolean;
  set_editor_only(value: boolean): void;
}

interface ReferenceRectState {
  color: ControlColor;
  width: number;
  editorOnly: boolean;
  redraw(): void;
}

const REFERENCE_RECTS = new WeakMap<object, ReferenceRectState>();

function color(value: ControlColor): ControlColor {
  if (typeof value !== 'object' || value === null ||
      ![value.r, value.g, value.b, value.a].every((channel) => Number.isFinite(channel))) {
    throw new TypeError('ReferenceRect.border_color requires a finite Color.');
  }
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function width(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('ReferenceRect.border_width requires a finite float.');
  return Math.max(0, value);
}

function sync(control: GodotControl, state: ReferenceRectState): void {
  const binding = optionalControlBinding(control);
  binding?.state.write(binding.id, {
    referenceBorderColor: { ...state.color },
    referenceBorderWidth: state.width,
    referenceEditorOnly: state.editorOnly,
  });
  state.redraw();
}

export function bindReferenceRect(
  control: GodotControl,
  initial: {
    readonly border_color?: ControlColor;
    readonly border_width?: number;
    readonly editor_only?: boolean;
  } = {},
  redraw: () => void = () => {},
): GodotReferenceRect {
  if (REFERENCE_RECTS.has(control)) throw new Error('ReferenceRect identity is already bound.');
  const state: ReferenceRectState = {
    color: color(initial.border_color ?? { r: 1, g: 0, b: 0, a: 1 }),
    width: width(initial.border_width ?? 1),
    editorOnly: initial.editor_only ?? true,
    redraw,
  };
  REFERENCE_RECTS.set(control, state);
  const reference = control as GodotReferenceRect;
  Object.defineProperties(reference, {
    border_color: {
      enumerable: true,
      configurable: true,
      get: () => ({ ...state.color }),
      set: (value: ControlColor) => { state.color = color(value); sync(control, state); },
    },
    border_width: {
      enumerable: true,
      configurable: true,
      get: () => state.width,
      set: (value: number) => { state.width = width(value); sync(control, state); },
    },
    editor_only: {
      enumerable: true,
      configurable: true,
      get: () => state.editorOnly,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('ReferenceRect.editor_only requires bool.');
        state.editorOnly = value;
        sync(control, state);
      },
    },
  });
  Object.assign(reference, {
    get_border_color: () => reference.border_color,
    set_border_color: (value: ControlColor) => { reference.border_color = value; },
    get_border_width: () => reference.border_width,
    set_border_width: (value: number) => { reference.border_width = value; },
    get_editor_only: () => reference.editor_only,
    set_editor_only: (value: boolean) => { reference.editor_only = value; },
  });
  registerGodotObjectIdentity(reference, 'ReferenceRect');
  sync(control, state);
  return reference;
}

function cssColor(value: ControlColor): string {
  const channel = (part: number): number => Math.round(Math.max(0, Math.min(1, part)) * 255);
  return `rgba(${channel(value.r)}, ${channel(value.g)}, ${channel(value.b)}, ${Math.max(0, Math.min(1, value.a))})`;
}

/** Runtime DOM constructor; editor_only suppresses drawing, never the Control or its children. */
export function createGodotDomReferenceRect(documentValue: Document = document): GodotReferenceRect & HTMLDivElement {
  const element = documentValue.createElement('div') as HTMLDivElement & GodotControl;
  const store = createControlState();
  registerControlBinding(element, { id: 'reference-rect', state: store });
  const reference = bindReferenceRect(element, {}, () => {
    const state = REFERENCE_RECTS.get(element)!;
    const visible = !state.editorOnly;
    const presentationWidth = state.width === 0 ? 1 : state.width;
    element.style.outline = visible ? `${presentationWidth}px solid ${cssColor(state.color)}` : 'none';
    // CSS outlines do not affect layout. Pull half the stroke inward so it is centered on the
    // Control edge like CanvasItem.draw_rect(..., filled=false, border_width).
    element.style.outlineOffset = `${-presentationWidth / 2}px`;
    element.style.background = 'transparent';
  });
  return reference as GodotReferenceRect & HTMLDivElement;
}

export type GodotCanvasReferenceRect = Container & Omit<GodotReferenceRect, keyof Container>;

interface CanvasReferenceState { size: { x: number; y: number } }
const CANVAS_REFERENCE_RECTS = new WeakMap<Graphics, CanvasReferenceState>();

function redrawCanvasReferenceRect(graphics: Graphics): void {
  const state = REFERENCE_RECTS.get(graphics);
  const canvas = CANVAS_REFERENCE_RECTS.get(graphics);
  if (state === undefined || canvas === undefined) return;
  const channel = (part: number): number => Math.round(Math.max(0, Math.min(1, part)) * 255);
  const nativeColor = channel(state.color.r) * 0x10000 + channel(state.color.g) * 0x100 + channel(state.color.b);
  graphics.clear();
  if (state.editorOnly) return;
  graphics.rect(0, 0, canvas.size.x, canvas.size.y).stroke({
    color: nativeColor,
    alpha: state.color.a,
    width: state.width === 0 ? 1 : state.width,
  });
}

export function bindGodotCanvasReferenceRect(
  graphics: Graphics,
  initial: Parameters<typeof bindReferenceRect>[1] = {},
  size: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): GodotCanvasReferenceRect {
  CANVAS_REFERENCE_RECTS.set(graphics, { size: { x: size.x, y: size.y } });
  return bindReferenceRect(graphics as unknown as GodotControl, initial, () => redrawCanvasReferenceRect(graphics)) as unknown as GodotCanvasReferenceRect;
}

export function resizeGodotCanvasReferenceRect(reference: GodotCanvasReferenceRect, width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) throw new TypeError('ReferenceRect size requires a finite non-negative Vector2.');
  const graphics = reference as unknown as Graphics;
  const state = CANVAS_REFERENCE_RECTS.get(graphics);
  if (state === undefined) throw new TypeError('Expected a retained canvas ReferenceRect.');
  state.size = { x: width, y: height };
  redrawCanvasReferenceRect(graphics);
}

export function releaseGodotCanvasReferenceRect(reference: GodotCanvasReferenceRect): void {
  CANVAS_REFERENCE_RECTS.delete(reference as unknown as Graphics);
}

/** Runtime Pixi constructor; one Graphics is both Control identity and drawn border. */
export function createGodotCanvasReferenceRect(): GodotCanvasReferenceRect {
  const graphics = new Graphics();
  let reference: GodotCanvasReferenceRect | undefined;
  bindCanvasControl(graphics, {
    position: { x: 0, y: 0 }, size: { x: 0, y: 0 }, anchor: { x: 0, y: 0 },
    customMinimumSize: { x: 0, y: 0 }, sizeFlagsHorizontal: 1, sizeFlagsVertical: 1,
    mouseFilter: 0, nativeSize: false, applySize: (size) => {
      if (reference !== undefined) resizeGodotCanvasReferenceRect(reference, size.x, size.y);
    },
  });
  reference = bindGodotCanvasReferenceRect(graphics);
  return reference;
}
