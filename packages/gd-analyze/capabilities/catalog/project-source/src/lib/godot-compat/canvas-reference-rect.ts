/** Godot ReferenceRect over one retained Pixi Graphics Control identity. */

import { Graphics } from 'pixi.js';
import { bindRuntimeCanvasControl, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';
import type { ColorValue } from './variant';

export interface GodotCanvasReferenceRect extends Graphics {
  border_color: ColorValue;
  border_width: number;
  editor_only: boolean;
  set_border_color(color: ColorValue): void;
  get_border_color(): ColorValue;
  set_border_width(width: number): void;
  get_border_width(): number;
  set_editor_only(enabled: boolean): void;
  get_editor_only(): boolean;
}

export interface CanvasReferenceRectOptions {
  readonly node: Graphics;
  readonly width?: number;
  readonly height?: number;
  readonly borderColor?: ColorValue;
  readonly borderWidth?: number;
  readonly editorOnly?: boolean;
  readonly editorHint?: boolean;
}

interface ReferenceRectState {
  width: number;
  height: number;
  color: ColorValue;
  borderWidth: number;
  editorOnly: boolean;
  editorHint: boolean;
  released: boolean;
  unregister(): void;
}

const STATES = new WeakMap<Graphics, ReferenceRectState>();

function finiteDimension(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`ReferenceRect.${member} requires a finite non-negative number.`);
  }
  return value;
}

function positiveWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError('ReferenceRect.border_width requires a finite positive number.');
  }
  return value;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`ReferenceRect.${member} requires bool.`);
  return value;
}

function color(value: unknown): ColorValue {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('ReferenceRect.border_color requires Color.');
  }
  const result = {
    r: Reflect.get(value, 'r'),
    g: Reflect.get(value, 'g'),
    b: Reflect.get(value, 'b'),
    a: Reflect.get(value, 'a'),
  };
  if (Object.values(result).some((channel) => typeof channel !== 'number' || !Number.isFinite(channel))) {
    throw new TypeError('ReferenceRect.border_color requires finite Color channels.');
  }
  return result as ColorValue;
}

function pixiColor(value: ColorValue): { color: number; alpha: number } {
  const byte = (channel: number): number => Math.max(0, Math.min(255, Math.round(channel * 255)));
  return {
    color: (byte(value.r) << 16) | (byte(value.g) << 8) | byte(value.b),
    alpha: Math.max(0, Math.min(1, value.a)),
  };
}

function stateOf(node: Graphics): ReferenceRectState {
  const state = STATES.get(node);
  if (state === undefined || state.released) throw new Error('ReferenceRect is not bound.');
  return state;
}

function redraw(node: Graphics, state: ReferenceRectState): void {
  node.clear();
  if (state.editorOnly && !state.editorHint) return;
  if (state.width === 0 || state.height === 0) return;
  const inset = state.borderWidth / 2;
  const width = Math.max(0, state.width - state.borderWidth);
  const height = Math.max(0, state.height - state.borderWidth);
  node.rect(inset, inset, width, height).stroke({
    ...pixiColor(state.color),
    width: state.borderWidth,
  });
}

export function bindCanvasReferenceRect(
  options: CanvasReferenceRectOptions,
): GodotCanvasReferenceRect {
  releaseCanvasReferenceRect(options.node);
  const state: ReferenceRectState = {
    width: finiteDimension(options.width ?? 0, 'width'),
    height: finiteDimension(options.height ?? 0, 'height'),
    color: color(options.borderColor ?? { r: 1, g: 0, b: 0, a: 1 }),
    borderWidth: positiveWidth(options.borderWidth ?? 1),
    editorOnly: boolean(options.editorOnly ?? true, 'editor_only'),
    editorHint: boolean(options.editorHint ?? false, 'editor_hint'),
    released: false,
    unregister: () => {},
  };
  const node = options.node as GodotCanvasReferenceRect;
  STATES.set(node, state);
  Object.defineProperties(node, {
    border_color: { configurable: true, enumerable: true, get: () => ({ ...state.color }), set: (value: ColorValue) => node.set_border_color(value) },
    border_width: { configurable: true, enumerable: true, get: () => state.borderWidth, set: (value: number) => node.set_border_width(value) },
    editor_only: { configurable: true, enumerable: true, get: () => state.editorOnly, set: (value: boolean) => node.set_editor_only(value) },
  });
  Object.assign(node, {
    set_border_color(value: ColorValue): void {
      state.color = color(value);
      redraw(node, state);
    },
    get_border_color: (): ColorValue => ({ ...state.color }),
    set_border_width(value: number): void {
      state.borderWidth = positiveWidth(value);
      redraw(node, state);
    },
    get_border_width: (): number => state.borderWidth,
    set_editor_only(value: boolean): void {
      state.editorOnly = boolean(value, 'editor_only');
      redraw(node, state);
    },
    get_editor_only: (): boolean => state.editorOnly,
  });
  state.unregister = registerCanvasNodeRelease(node, () => releaseCanvasReferenceRect(node));
  redraw(node, state);
  return node;
}

export function createGodotCanvasReferenceRect(editorHint = false): GodotCanvasReferenceRect {
  const node = bindRuntimeCanvasControl(new Graphics()) as Graphics;
  registerGodotObjectIdentity(node, 'ReferenceRect');
  return bindCanvasReferenceRect({ node, editorHint });
}

export function resizeCanvasReferenceRect(
  node: GodotCanvasReferenceRect,
  width: number,
  height: number,
): void {
  const state = stateOf(node);
  state.width = finiteDimension(width, 'width');
  state.height = finiteDimension(height, 'height');
  redraw(node, state);
}

export function setCanvasReferenceRectEditorHint(
  node: GodotCanvasReferenceRect,
  enabled: boolean,
): void {
  const state = stateOf(node);
  state.editorHint = boolean(enabled, 'editor_hint');
  redraw(node, state);
}

export function releaseCanvasReferenceRect(node: Graphics): void {
  const state = STATES.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregister();
  node.clear();
  STATES.delete(node);
}
