/** Pixi-native TouchScreenButton presentation over the shared retained input protocol. */

import { Container, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import { projectGodotTexture } from './button-icon';
import { bindGodotCanvasNode2DApi, markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';
import type { GodotBitMap } from './bitmap';
import type { GodotShape2D } from './physics-query-2d';
import {
  createGodotTouchScreenButton,
  setGodotTouchScreenButtonPressed,
  type GodotTouchScreenButton,
} from './touch-screen-button';

export interface CanvasTouchScreenButtonOptions {
  readonly node: Container;
  readonly sourceId: string;
  readonly action?: string;
  readonly normal?: unknown | null;
  readonly pressed?: unknown | null;
  readonly shape?: GodotShape2D | null;
  readonly shapeCentered?: boolean;
  readonly passbyPress?: boolean;
  readonly bitmask?: GodotBitMap | null;
  readonly shapeVisible?: boolean;
  readonly visibilityMode?: number;
  readonly onAction?: (action: string, pressed: boolean) => void;
}

export interface GodotCanvasTouchScreenButton extends Container {
  action: string;
  normal: unknown | null;
  pressed: unknown | null;
  shape: GodotShape2D | null;
  shape_centered: boolean;
  passby_press: boolean;
  bitmask: GodotBitMap | null;
  shape_visible: boolean;
  visibility_mode: number;
  readonly down: boolean;
  readonly sourceId: string;
  set_action(action: string): void;
  get_action(): string;
  set_texture_normal(texture: unknown | null): void;
  get_texture_normal(): unknown | null;
  set_texture_pressed(texture: unknown | null): void;
  get_texture_pressed(): unknown | null;
  set_bitmask(bitmask: GodotBitMap | null): void;
  get_bitmask(): GodotBitMap | null;
  set_shape(shape: GodotShape2D | null): void;
  get_shape(): GodotShape2D | null;
  set_shape_centered(centered: boolean): void;
  is_shape_centered(): boolean;
  set_shape_visible(visible: boolean): void;
  is_shape_visible(): boolean;
  set_passby_press(enabled: boolean): void;
  is_passby_press_enabled(): boolean;
  set_visibility_mode(mode: number): void;
  get_visibility_mode(): number;
  is_pressed(): boolean;
}

interface CanvasTouchScreenButtonState {
  readonly model: GodotTouchScreenButton;
  readonly sprite: Sprite;
  readonly pointers: Set<number>;
  readonly onAction: (action: string, pressed: boolean) => void;
  pointerDown(event: FederatedPointerEvent): void;
  pointerUp(event: FederatedPointerEvent): void;
  pointerMove(event: FederatedPointerEvent): void;
  unregister(): void;
  released: boolean;
}

const STATES = new WeakMap<Container, CanvasTouchScreenButtonState>();

function stateOf(node: Container): CanvasTouchScreenButtonState {
  const state = STATES.get(node);
  if (state === undefined || state.released) throw new Error('Canvas TouchScreenButton is not bound.');
  return state;
}

function isTouchDevice(): boolean {
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

function visibleForMode(mode: number): boolean {
  if (mode === 0) return true;
  if (mode === 1) return isTouchDevice();
  if (mode === 2) return !isTouchDevice();
  throw new RangeError('TouchScreenButton.visibility_mode must be ALWAYS (0), TOUCHSCREEN_ONLY (1), or DESKTOP_ONLY (2).');
}

function projectedTexture(value: unknown | null, member: string): Texture {
  if (value === null) return Texture.EMPTY;
  return projectGodotTexture(value, member).pixiTexture ?? Texture.EMPTY;
}

function syncHitArea(node: GodotCanvasTouchScreenButton, state: CanvasTouchScreenButtonState): void {
  const mask = state.model.bitmask;
  node.hitArea = mask === null ? null : {
    contains(x: number, y: number): boolean {
      const size = mask.get_size();
      if (size.x <= 0 || size.y <= 0 || state.sprite.width <= 0 || state.sprite.height <= 0) return false;
      const localX = Math.floor(x / state.sprite.width * size.x);
      const localY = Math.floor(y / state.sprite.height * size.y);
      return localX >= 0 && localY >= 0 && localX < size.x && localY < size.y &&
        mask.get_bitv({ x: localX, y: localY });
    },
  };
}

function sync(node: GodotCanvasTouchScreenButton, state: CanvasTouchScreenButtonState): void {
  state.sprite.texture = projectedTexture(
    state.model.down ? state.model.pressed ?? state.model.normal : state.model.normal,
    state.model.down ? 'TouchScreenButton.pressed' : 'TouchScreenButton.normal',
  );
  state.sprite.visible = state.sprite.texture !== Texture.EMPTY;
  node.visible = visibleForMode(state.model.visibility_mode);
  syncHitArea(node, state);
}

function setPressed(
  node: GodotCanvasTouchScreenButton,
  state: CanvasTouchScreenButtonState,
  pressed: boolean,
): void {
  if (state.model.down === pressed) return;
  setGodotTouchScreenButtonPressed(state.model.sourceId, pressed);
  if (state.model.action !== '') state.onAction(state.model.action, pressed);
  sync(node, state);
}

export function bindCanvasTouchScreenButton(
  options: CanvasTouchScreenButtonOptions,
): GodotCanvasTouchScreenButton {
  releaseCanvasTouchScreenButton(options.node);
  const model = createGodotTouchScreenButton(
    options.sourceId,
    options.shape ?? null,
    options.shapeCentered ?? true,
    options.passbyPress ?? false,
    options.action ?? '',
    options.normal ?? null,
    options.pressed ?? null,
  );
  model.bitmask = options.bitmask ?? null;
  model.shape_visible = options.shapeVisible ?? false;
  model.visibility_mode = options.visibilityMode ?? 0;
  const sprite = markInternalCanvasChild(new Sprite(Texture.EMPTY));
  options.node.addChild(sprite);
  const state: CanvasTouchScreenButtonState = {
    model,
    sprite,
    pointers: new Set(),
    onAction: options.onAction ?? (() => {}),
    pointerDown: () => {},
    pointerUp: () => {},
    pointerMove: () => {},
    unregister: () => {},
    released: false,
  };
  const node = options.node as GodotCanvasTouchScreenButton;
  STATES.set(node, state);
  const property = (member: keyof GodotTouchScreenButton, synchronize = false): PropertyDescriptor => ({
    configurable: true,
    enumerable: true,
    get: () => model[member],
    set: (value: unknown) => {
      Reflect.set(model, member, value);
      if (synchronize) sync(node, state);
    },
  });
  Object.defineProperties(node, {
    sourceId: { configurable: true, enumerable: true, get: () => model.sourceId },
    down: { configurable: true, enumerable: true, get: () => model.down },
    action: property('action'),
    normal: property('normal', true),
    pressed: property('pressed', true),
    shape: property('shape', true),
    shape_centered: property('shape_centered', true),
    passby_press: property('passby_press'),
    bitmask: property('bitmask', true),
    shape_visible: property('shape_visible', true),
    visibility_mode: property('visibility_mode', true),
  });
  Object.assign(node, {
    set_action(value: string): void { model.set_action(value); },
    get_action: (): string => model.get_action(),
    set_texture_normal(value: unknown | null): void { model.set_texture_normal(value); sync(node, state); },
    get_texture_normal: (): unknown | null => model.get_texture_normal(),
    set_texture_pressed(value: unknown | null): void { model.set_texture_pressed(value); sync(node, state); },
    get_texture_pressed: (): unknown | null => model.get_texture_pressed(),
    set_bitmask(value: GodotBitMap | null): void { model.set_bitmask(value); syncHitArea(node, state); },
    get_bitmask: (): GodotBitMap | null => model.get_bitmask(),
    set_shape(value: GodotShape2D | null): void { model.set_shape(value); sync(node, state); },
    get_shape: (): GodotShape2D | null => model.get_shape(),
    set_shape_centered(value: boolean): void { model.set_shape_centered(value); sync(node, state); },
    is_shape_centered: (): boolean => model.is_shape_centered(),
    set_shape_visible(value: boolean): void { model.set_shape_visible(value); sync(node, state); },
    is_shape_visible: (): boolean => model.is_shape_visible(),
    set_passby_press: (value: boolean): void => model.set_passby_press(value),
    is_passby_press_enabled: (): boolean => model.is_passby_press_enabled(),
    set_visibility_mode(value: number): void { model.set_visibility_mode(value); sync(node, state); },
    get_visibility_mode: (): number => model.get_visibility_mode(),
    is_pressed: (): boolean => model.is_pressed(),
  });
  state.pointerDown = (event) => {
    state.pointers.add(event.pointerId);
    setPressed(node, state, true);
    event.stopPropagation();
  };
  state.pointerUp = (event) => {
    state.pointers.delete(event.pointerId);
    setPressed(node, state, state.pointers.size > 0);
    event.stopPropagation();
  };
  state.pointerMove = (event) => {
    if (!model.passby_press || event.pressure <= 0) return;
    if (!state.pointers.has(event.pointerId)) state.pointers.add(event.pointerId);
    setPressed(node, state, true);
  };
  node.eventMode = 'static';
  node.cursor = 'pointer';
  node.on('pointerdown', state.pointerDown);
  node.on('pointerup', state.pointerUp);
  node.on('pointerupoutside', state.pointerUp);
  node.on('pointercancel', state.pointerUp);
  node.on('pointermove', state.pointerMove);
  state.unregister = registerCanvasNodeRelease(node, () => releaseCanvasTouchScreenButton(node));
  registerGodotObjectIdentity(node, 'TouchScreenButton');
  sync(node, state);
  return node;
}

export function createGodotCanvasTouchScreenButton(
  sourceId: string,
  onAction?: (action: string, pressed: boolean) => void,
): GodotCanvasTouchScreenButton {
  return bindCanvasTouchScreenButton({
    node: bindGodotCanvasNode2DApi(new Container()),
    sourceId,
    ...(onAction === undefined ? {} : { onAction }),
  });
}

export function releaseCanvasTouchScreenButton(node: Container): void {
  const state = STATES.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregister();
  node.off('pointerdown', state.pointerDown);
  node.off('pointerup', state.pointerUp);
  node.off('pointerupoutside', state.pointerUp);
  node.off('pointercancel', state.pointerUp);
  node.off('pointermove', state.pointerMove);
  if (state.model.down && state.model.action !== '') state.onAction(state.model.action, false);
  state.model.dispose();
  state.sprite.removeFromParent();
  state.sprite.destroy({ texture: false, textureSource: false });
  STATES.delete(node);
}
