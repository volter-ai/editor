/** Godot HSeparator/VSeparator over the retained Pixi Graphics scene entity. */

import { Graphics } from 'pixi.js';
import { bindRuntimeCanvasControl, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';

export type CanvasSeparatorOrientation = 'horizontal' | 'vertical';

export interface CanvasSeparatorOptions {
  readonly node: Graphics;
  readonly orientation: CanvasSeparatorOrientation;
  readonly width: number;
  readonly height: number;
  readonly color?: number;
  readonly thickness?: number;
}

interface CanvasSeparatorState {
  readonly orientation: CanvasSeparatorOrientation;
  readonly color: number;
  readonly thickness: number;
  width: number;
  height: number;
  released: boolean;
  unregister(): void;
}

const SEPARATORS = new WeakMap<Graphics, CanvasSeparatorState>();

function dimension(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Separator ${name} must be finite and non-negative; received ${String(value)}.`);
  }
  return value;
}

function thickness(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Separator thickness must be finite and positive; received ${String(value)}.`);
  }
  return value;
}

function draw(node: Graphics, state: CanvasSeparatorState): void {
  node.clear();
  if (state.orientation === 'horizontal') {
    const y = state.height / 2;
    node.moveTo(0, y).lineTo(state.width, y);
  } else {
    const x = state.width / 2;
    node.moveTo(x, 0).lineTo(x, state.height);
  }
  node.stroke({ color: state.color, width: state.thickness });
}

/** Bind drawing state directly to the retained Graphics node; no child/mirror renderer exists. */
export function bindCanvasSeparator(options: CanvasSeparatorOptions): Graphics {
  const node = options.node;
  if (SEPARATORS.has(node)) throw new Error('Canvas separator is already bound.');
  const state: CanvasSeparatorState = {
    orientation: options.orientation,
    color: options.color ?? 0x808080,
    thickness: thickness(options.thickness ?? 1),
    width: dimension('width', options.width),
    height: dimension('height', options.height),
    released: false,
    unregister: () => {},
  };
  SEPARATORS.set(node, state);
  state.unregister = registerCanvasNodeRelease(node, () => releaseCanvasSeparator(node));
  draw(node, state);
  return node;
}

/** Redraw the same retained entity after a runtime Control size write. */
export function resizeCanvasSeparator(node: Graphics, width: number, height: number): void {
  const state = SEPARATORS.get(node);
  if (state === undefined || state.released) throw new Error('Canvas separator is not bound.');
  state.width = dimension('width', width);
  state.height = dimension('height', height);
  draw(node, state);
}

/** Release compat-owned state. The scene remains sole owner of the Graphics lifetime. */
export function releaseCanvasSeparator(node: Graphics): void {
  const state = SEPARATORS.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregister();
  SEPARATORS.delete(node);
}

function createCanvasSeparator(orientation: CanvasSeparatorOrientation): Graphics {
  const node = new Graphics();
  bindCanvasSeparator({ node, orientation, width: 0, height: 0 });
  bindRuntimeCanvasControl(node, {
    applySize: (size) => resizeCanvasSeparator(node, size.x, size.y),
  });
  registerGodotObjectIdentity(node, orientation === 'horizontal' ? 'HSeparator' : 'VSeparator');
  return node;
}

/** Runtime `HSeparator.new()` retaining one native Pixi Graphics Control. */
export function createGodotCanvasHSeparator(): Graphics {
  return createCanvasSeparator('horizontal');
}

/** Runtime `VSeparator.new()` retaining one native Pixi Graphics Control. */
export function createGodotCanvasVSeparator(): Graphics {
  return createCanvasSeparator('vertical');
}
