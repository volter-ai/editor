/** Live Theme/StyleBox presentation for retained Pixi Panel and PanelContainer controls. */

import { Container, Graphics } from 'pixi.js';
import { getCanvasControlSize, setCanvasContainerLayout } from './canvas-control-state';
import { drawStyleBoxPixi, type GodotStyleBox } from './style-box';
import {
  bindControlThemeConsumer,
  controlThemeStyleBox,
  getGodotThemeDbFallbackStylebox,
} from './theme';

export interface CanvasPanelBindingOptions {
  readonly owner: Container;
  readonly graphics: Graphics;
  readonly themeType?: string;
  readonly styleName?: string;
}

interface CanvasPanelState {
  readonly owner: Container;
  readonly graphics: Graphics;
  readonly themeType: string;
  readonly styleName: string;
  releaseTheme(): void;
  released: boolean;
}

const STATES = new WeakMap<Container, CanvasPanelState>();

function stateOf(owner: Container): CanvasPanelState {
  const state = STATES.get(owner);
  if (state === undefined || state.released) throw new Error('Canvas Panel is not bound.');
  return state;
}

function draw(state: CanvasPanelState): void {
  const size = getCanvasControlSize(state.owner);
  drawStyleBoxPixi(state.graphics, styleBox(state), size.x, size.y);
}

function styleBox(state: CanvasPanelState): GodotStyleBox {
  return controlThemeStyleBox(
    state.owner,
    getGodotThemeDbFallbackStylebox(),
    state.styleName,
    state.themeType,
  );
}

function applyPanelContainerInsets(state: CanvasPanelState): void {
  if (state.themeType !== 'PanelContainer') return;
  const box = styleBox(state);
  setCanvasContainerLayout(state.owner, 'panel', {
    contentInsets: {
      left: Math.max(0, box.getContentMargin(0)),
      top: Math.max(0, box.getContentMargin(1)),
      right: Math.max(0, box.getContentMargin(2)),
      bottom: Math.max(0, box.getContentMargin(3)),
    },
  });
}

export function bindCanvasPanelTheme(options: CanvasPanelBindingOptions): () => void {
  releaseCanvasPanelTheme(options.owner);
  const state: CanvasPanelState = {
    owner: options.owner,
    graphics: options.graphics,
    themeType: options.themeType ?? 'Panel',
    styleName: options.styleName ?? 'panel',
    releaseTheme: () => {},
    released: false,
  };
  STATES.set(options.owner, state);
  state.releaseTheme = bindControlThemeConsumer(options.owner, () => {
    applyPanelContainerInsets(state);
    draw(state);
  });
  applyPanelContainerInsets(state);
  draw(state);
  return () => releaseCanvasPanelTheme(options.owner);
}

export function redrawCanvasPanelTheme(owner: Container): void {
  const state = STATES.get(owner);
  if (state === undefined || state.released) return;
  draw(state);
}

export function getCanvasPanelGraphics(owner: Container): Graphics {
  return stateOf(owner).graphics;
}

export function releaseCanvasPanelTheme(owner: Container): void {
  const state = STATES.get(owner);
  if (state === undefined || state.released) return;
  state.released = true;
  state.releaseTheme();
  state.graphics.clear();
  STATES.delete(owner);
}
