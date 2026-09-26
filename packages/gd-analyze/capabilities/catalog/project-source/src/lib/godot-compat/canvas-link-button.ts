/** Pixi-native LinkButton on the retained Text entity. */

import { Graphics, Text, type FederatedPointerEvent } from 'pixi.js';

import { bindCanvasBaseButton, releaseCanvasBaseButton, type CanvasBaseButtonInitial, type GodotCanvasBaseButton } from './canvas-button';
import { bindRuntimeCanvasControl, markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';

export interface CanvasLinkButtonOptions extends CanvasBaseButtonInitial {
  readonly text?: string;
  readonly uri?: string;
  readonly underline?: number;
}

export interface GodotCanvasLinkButton extends GodotCanvasBaseButton {
  text: string;
  uri: string;
  underline: number;
  underline_mode: number;
  get_text(): string;
  set_text(value: string): void;
  get_uri(): string;
  set_uri(value: string): void;
  get_underline_mode(): number;
  set_underline_mode(value: number): void;
}

interface LinkState {
  readonly underlineGraphic: Graphics;
  uri: string;
  underline: number;
  hovered: boolean;
  pointerOver(event: FederatedPointerEvent): void;
  pointerOut(event: FederatedPointerEvent): void;
  unregisterRelease(): void;
  released: boolean;
}

const LINKS = new WeakMap<GodotCanvasLinkButton, LinkState>();

function string(member: string, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} must be String.`);
  return value;
}

function underline(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2) {
    throw new RangeError('LinkButton.underline must be ALWAYS (0), ON_HOVER (1), or NEVER (2).');
  }
  return value;
}

function draw(button: GodotCanvasLinkButton, state: LinkState): void {
  state.underlineGraphic.clear();
  if (state.underline === 2 || (state.underline === 1 && !state.hovered)) return;
  const bounds = button.getLocalBounds();
  const fill = button.style.fill;
  const color = typeof fill === 'number' || typeof fill === 'string' ? fill : 0xffffff;
  state.underlineGraphic
    .moveTo(bounds.x, bounds.y + bounds.height + 1)
    .lineTo(bounds.x + bounds.width, bounds.y + bounds.height + 1)
    .stroke({ color, width: 1 });
}

export function bindCanvasLinkButton(native: Text, options: CanvasLinkButtonOptions = {}): GodotCanvasLinkButton {
  releaseCanvasLinkButton(native as GodotCanvasLinkButton);
  if (options.text !== undefined) native.text = string('LinkButton.text', options.text);
  const button = bindCanvasBaseButton(native, options) as GodotCanvasLinkButton;
  const graphic = markInternalCanvasChild(new Graphics());
  button.addChild(graphic);
  const state: LinkState = {
    underlineGraphic: graphic,
    uri: string('LinkButton.uri', options.uri ?? ''),
    underline: underline(options.underline ?? 0),
    hovered: false,
    pointerOver: () => {},
    pointerOut: () => {},
    unregisterRelease: () => {},
    released: false,
  };
  LINKS.set(button, state);
  Object.defineProperties(button, {
    uri: { enumerable: true, configurable: true, get: () => state.uri, set: (value: string) => { state.uri = string('LinkButton.uri', value); } },
    underline: { enumerable: true, configurable: true, get: () => state.underline, set: (value: number) => { state.underline = underline(value); draw(button, state); } },
    underline_mode: { enumerable: true, configurable: true, get: () => state.underline, set: (value: number) => { state.underline = underline(value); draw(button, state); } },
  });
  Object.assign(button, {
    get_text: () => String(button.text),
    set_text: (value: string) => { button.text = string('LinkButton.text', value); draw(button, state); },
    get_uri: () => state.uri,
    set_uri: (value: string) => { state.uri = string('LinkButton.uri', value); },
    get_underline_mode: () => state.underline,
    set_underline_mode: (value: number) => { button.underline = value; },
  });
  state.pointerOver = () => { state.hovered = true; draw(button, state); };
  state.pointerOut = () => { state.hovered = false; draw(button, state); };
  button.on('pointerover', state.pointerOver);
  button.on('pointerout', state.pointerOut);
  state.unregisterRelease = registerCanvasNodeRelease(button, () => releaseCanvasLinkButton(button));
  draw(button, state);
  return button;
}

/** Runtime `LinkButton.new()` whose retained Pixi Text is both Control and button entity. */
export function createGodotCanvasLinkButton(): GodotCanvasLinkButton {
  const button = bindCanvasLinkButton(new Text({ text: '' }), {
    text: '',
    uri: '',
    underline: 0,
  });
  bindRuntimeCanvasControl(button, { useLocalBoundsMinimum: true });
  registerGodotObjectIdentity(button, 'LinkButton');
  return button;
}

export function releaseCanvasLinkButton(button: GodotCanvasLinkButton): void {
  const state = LINKS.get(button);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregisterRelease();
  button.off('pointerover', state.pointerOver);
  button.off('pointerout', state.pointerOut);
  state.underlineGraphic.removeFromParent();
  state.underlineGraphic.destroy();
  releaseCanvasBaseButton(button);
  LINKS.delete(button);
}
