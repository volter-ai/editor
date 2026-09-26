/** Pixi-native TextureButton whose retained Container remains the world entity. */

import { Container, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';

import { bindBaseButton, type BaseButtonState, type GodotButtonControl } from './control-widgets';
import {
  createControlState,
  registerControlBinding,
  type ControlPoint,
  type ControlRecord,
  type ControlState,
  type GodotControl,
} from './control-state';
import { bindGodotCanvasItemApi, markInternalCanvasChild, registerCanvasNodeRelease, type GodotCanvasItem } from './node';
import type { GodotBitMap } from './bitmap';
import { registerGodotObjectIdentity } from './object';

type TextureSlot = 'normal' | 'pressed' | 'hover' | 'disabled' | 'focused';

interface CanvasTextureButtonState {
  readonly sprite: Sprite;
  readonly focusSprite: Sprite;
  readonly store: ControlState;
  readonly textures: Record<TextureSlot, Texture | null>;
  width: number;
  height: number;
  expand: boolean;
  stretchMode: number;
  flipH: boolean;
  flipV: boolean;
  held: boolean;
  hovered: boolean;
  focused: boolean;
  godotMajor: 3 | 4;
  clickMask: GodotBitMap | null;
  pointerDown(event: FederatedPointerEvent): void;
  pointerUp(event: FederatedPointerEvent): void;
  pointerOver(event: FederatedPointerEvent): void;
  pointerOut(event: FederatedPointerEvent): void;
  pointerUpOutside(event: FederatedPointerEvent): void;
  focusIn(): void;
  focusOut(): void;
  unregisterRelease(): void;
  released: boolean;
}

const TEXTURE_BUTTONS = new WeakMap<Container, CanvasTextureButtonState>();

export interface CanvasTextureButtonOptions extends Partial<BaseButtonState> {
  readonly godot_major?: 3 | 4;
  readonly node: Container;
  readonly width: number;
  readonly height: number;
  readonly normal?: Texture | null;
  readonly pressed?: Texture | null;
  readonly hover?: Texture | null;
  readonly disabledTexture?: Texture | null;
  readonly focused?: Texture | null;
  readonly expand?: boolean;
  readonly stretchMode?: number;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly clickMask?: GodotBitMap | null;
}

export interface GodotCanvasTextureButton extends GodotCanvasItem, Omit<GodotButtonControl, keyof GodotControl> {
  texture_normal: Texture | null;
  texture_pressed: Texture | null;
  texture_hover: Texture | null;
  texture_disabled: Texture | null;
  texture_focused: Texture | null;
  expand: boolean;
  stretch_mode: number;
  flip_h: boolean;
  flip_v: boolean;
  set_texture_normal(value: Texture | null): void;
  get_texture_normal(): Texture | null;
  set_normal_texture(value: Texture | null): void;
  get_normal_texture(): Texture | null;
  set_pressed_texture(value: Texture | null): void;
  get_pressed_texture(): Texture | null;
  get_texture_pressed(): Texture | null;
  set_hover_texture(value: Texture | null): void;
  get_hover_texture(): Texture | null;
  get_texture_hover(): Texture | null;
  set_disabled_texture(value: Texture | null): void;
  get_disabled_texture(): Texture | null;
  get_texture_disabled(): Texture | null;
  set_focused_texture(value: Texture | null): void;
  get_focused_texture(): Texture | null;
  get_texture_focused(): Texture | null;
  texture_click_mask: GodotBitMap | null;
  set_click_mask(value: GodotBitMap | null): void;
  get_click_mask(): GodotBitMap | null;
  set_expand(value: boolean): void;
  get_expand(): boolean;
  set_ignore_texture_size(value: boolean): void;
  get_ignore_texture_size(): boolean;
  set_stretch_mode(value: number): void;
  get_stretch_mode(): number;
  set_flip_h(value: boolean): void;
  set_flip_v(value: boolean): void;
  is_flipped_h(): boolean;
  is_flipped_v(): boolean;
}

function stateOf(node: Container): CanvasTextureButtonState {
  const state = TEXTURE_BUTTONS.get(node);
  if (state === undefined) throw new Error('Canvas TextureButton is not bound.');
  return state;
}

function dimension(member: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${member} must be finite and non-negative.`);
  return value;
}

function boolean(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be bool.`);
  return value;
}

function mode(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) {
    throw new RangeError('TextureButton.stretch_mode must be SCALE (0) through KEEP_ASPECT_COVERED (6).');
  }
  if (value === 1) throw new Error('TextureButton STRETCH_TILE requires a TilingSprite texture child and is not approximated.');
  return value;
}

function texture(member: string, value: Texture | null): Texture | null {
  if (value !== null && !(value instanceof Texture)) throw new TypeError(`${member} must be a Pixi Texture or null.`);
  return value;
}

function clickMask(value: GodotBitMap | null | undefined): GodotBitMap | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || typeof value.get_bitv !== 'function' || typeof value.get_size !== 'function') {
    throw new TypeError('TextureButton.texture_click_mask must be a retained BitMap Resource or null.');
  }
  return value;
}

function seatClickMask(node: Container, state: CanvasTextureButtonState): void {
  const mask = state.clickMask;
  node.hitArea = mask === null ? null : {
    contains(x: number, y: number): boolean {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      const size = mask.get_size();
      const placement = textureButtonPlacement(node as GodotCanvasTextureButton, state);
      const x0 = placement?.x ?? 0;
      const y0 = placement?.y ?? 0;
      const width = placement?.width ?? size.x;
      const height = placement?.height ?? size.y;
      if (!(width > 0) || !(height > 0) || size.x <= 0 || size.y <= 0) return false;
      if (x < 0 || y < 0 || x >= state.width || y >= state.height) return false;
      if (x < x0 || y < y0 || x >= x0 + width || y >= y0 + height) return false;
      const rawX = (x - x0) / width;
      const rawY = (y - y0) / height;
      const normalizedX = state.flipH ? 1 - rawX : rawX;
      const normalizedY = state.flipV ? 1 - rawY : rawY;
      const sourceX = Math.floor(normalizedX * size.x);
      const sourceY = Math.floor(normalizedY * size.y);
      return mask.get_bitv({ x: sourceX, y: sourceY });
    },
  };
}

function activeTexture(button: GodotCanvasTextureButton, state: CanvasTextureButtonState): Texture | null {
  if (button.disabled) return state.textures.disabled ?? state.textures.normal;
  if (state.held) return state.textures.pressed ?? state.textures.hover ?? state.textures.normal;
  if (state.hovered) return state.textures.hover ?? (button.button_pressed ? state.textures.pressed : state.textures.normal);
  return state.textures.normal;
}

interface TextureButtonPlacement {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

function textureButtonPlacement(
  button: GodotCanvasTextureButton,
  state: CanvasTextureButtonState,
): TextureButtonPlacement | null {
  const active = activeTexture(button, state);
  const clickMaskSize = state.clickMask?.get_size();
  if (active === null && clickMaskSize === undefined) return null;
  const sourceWidth = active?.width ?? clickMaskSize!.x;
  const sourceHeight = active?.height ?? clickMaskSize!.y;
  let width = sourceWidth;
  let height = sourceHeight;
  let x = 0;
  let y = 0;
  if (state.godotMajor === 4 || state.expand) {
    if (state.stretchMode === 0) {
      width = state.width;
      height = state.height;
    } else if (state.stretchMode === 3) {
      x = (state.width - width) / 2;
      y = (state.height - height) / 2;
    } else if (state.stretchMode === 4 || state.stretchMode === 5 || state.stretchMode === 6) {
      if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
        throw new Error('TextureButton aspect stretch requires a non-empty native texture.');
      }
      const ratio = state.stretchMode === 6
        ? Math.max(state.width / sourceWidth, state.height / sourceHeight)
        : Math.min(state.width / sourceWidth, state.height / sourceHeight);
      width = sourceWidth * ratio;
      height = sourceHeight * ratio;
      if (state.stretchMode === 5 || state.stretchMode === 6) {
        x = (state.width - width) / 2;
        y = (state.height - height) / 2;
      }
    }
  }
  return { sourceWidth, sourceHeight, width, height, x, y };
}

function layout(button: GodotCanvasTextureButton, state: CanvasTextureButtonState): void {
  const active = activeTexture(button, state);
  const placement = textureButtonPlacement(button, state);
  state.sprite.visible = active !== null;
  state.focusSprite.visible = state.focused && state.textures.focused !== null;
  if (state.focusSprite.visible) {
    const texture = state.textures.focused!;
    state.focusSprite.texture = texture;
    const sourceWidth = Math.max(1, texture.width);
    const sourceHeight = Math.max(1, texture.height);
    let width = sourceWidth;
    let height = sourceHeight;
    let x = 0;
    let y = 0;
    if (state.godotMajor === 4 || state.expand) {
      if (state.stretchMode === 0 || state.stretchMode === 1) { width = state.width; height = state.height; }
      else if (state.stretchMode === 3) { x = (state.width - width) / 2; y = (state.height - height) / 2; }
      else if (state.stretchMode >= 4) {
        const ratio = state.stretchMode === 6
          ? Math.max(state.width / sourceWidth, state.height / sourceHeight)
          : Math.min(state.width / sourceWidth, state.height / sourceHeight);
        width *= ratio;
        height *= ratio;
        if (state.stretchMode >= 5) { x = (state.width - width) / 2; y = (state.height - height) / 2; }
      }
    }
    state.focusSprite.position.set(state.flipH ? x + width : x, state.flipV ? y + height : y);
    state.focusSprite.scale.set((state.flipH ? -1 : 1) * width / sourceWidth, (state.flipV ? -1 : 1) * height / sourceHeight);
  }
  if (active === null || placement === null) return;
  state.sprite.texture = active;
  const { sourceWidth, sourceHeight, width, height, x, y } = placement;
  state.sprite.position.set(state.flipH ? x + width : x, state.flipV ? y + height : y);
  state.sprite.scale.set(
    (state.flipH ? -1 : 1) * (sourceWidth === 0 ? 1 : width / sourceWidth),
    (state.flipV ? -1 : 1) * (sourceHeight === 0 ? 1 : height / sourceHeight),
  );
}

function projection(node: Container): ControlState {
  const base = createControlState();
  return {
    read: (id) => base.read(id),
    write(id: string, patch: ControlRecord): void { base.write(id, patch); if (TEXTURE_BUTTONS.has(node)) layout(node as GodotCanvasTextureButton, stateOf(node)); },
    register: (id, value) => base.register(id, value),
    authored: (id) => base.authored(id),
    seatControl: (id, control) => base.seatControl(id, control),
    control: (id) => base.control(id),
    childControls: (id) => base.childControls(id),
    focusOwner: () => base.focusOwner(),
    releaseFocus: (control) => base.releaseFocus(control),
    routePointer: (control, event) => base.routePointer(control, event),
    grabClickFocus: (control) => base.grabClickFocus(control),
    removeControl: (id, control) => base.removeControl(id, control),
    retain: (release) => base.retain(release),
    clear: () => base.clear(),
    snapshot: () => base.snapshot(),
  };
}

export function bindCanvasTextureButton(options: CanvasTextureButtonOptions): GodotCanvasTextureButton {
  releaseCanvasTextureButton(options.node);
  const retainedClickMask = clickMask(options.clickMask);
  const retainedStretchMode = mode(options.stretchMode ?? 0);
  const sprite = markInternalCanvasChild(new Sprite());
  const focusSprite = markInternalCanvasChild(new Sprite(Texture.EMPTY));
  options.node.addChild(sprite, focusSprite);
  const store = projection(options.node);
  const state: CanvasTextureButtonState = {
    sprite, focusSprite,
    store,
    textures: {
      normal: texture('TextureButton.texture_normal', options.normal ?? null),
      pressed: texture('TextureButton.texture_pressed', options.pressed ?? null),
      hover: texture('TextureButton.texture_hover', options.hover ?? null),
      disabled: texture('TextureButton.texture_disabled', options.disabledTexture ?? null),
      focused: texture('TextureButton.texture_focused', options.focused ?? null),
    },
    width: dimension('TextureButton width', options.width),
    height: dimension('TextureButton height', options.height),
    expand: options.expand ?? false,
    stretchMode: retainedStretchMode,
    flipH: options.flipH ?? false,
    flipV: options.flipV ?? false,
    held: false,
    hovered: false,
    focused: false,
    godotMajor: options.godot_major ?? 3,
    clickMask: retainedClickMask,
    pointerDown: () => {},
    pointerUp: () => {},
    pointerOver: () => {},
    pointerOut: () => {},
    pointerUpOutside: () => {},
    focusIn: () => {},
    focusOut: () => {},
    unregisterRelease: () => {},
    released: false,
  };
  TEXTURE_BUTTONS.set(options.node, state);
  bindGodotCanvasItemApi(options.node);
  registerControlBinding(options.node as unknown as GodotControl, { id: 'texture-button', state: store });
  const button = bindBaseButton(options.node as unknown as GodotControl, options) as unknown as GodotCanvasTextureButton;
  const sync = (): void => layout(button, state);
  const slot = (name: TextureSlot, member: string): PropertyDescriptor => ({
    enumerable: true,
    configurable: true,
    get: () => state.textures[name],
    set: (value: Texture | null) => { state.textures[name] = texture(member, value); sync(); },
  });
  Object.defineProperties(button, {
    texture_normal: slot('normal', 'TextureButton.texture_normal'),
    texture_pressed: slot('pressed', 'TextureButton.texture_pressed'),
    texture_hover: slot('hover', 'TextureButton.texture_hover'),
    texture_disabled: slot('disabled', 'TextureButton.texture_disabled'),
    texture_focused: slot('focused', 'TextureButton.texture_focused'),
    expand: { enumerable: true, configurable: true, get: () => state.expand, set: (value: boolean) => { state.expand = boolean('TextureButton.expand', value); sync(); } },
    stretch_mode: {
      enumerable: true,
      configurable: true,
      get: () => state.stretchMode,
      set: (value: number) => {
        state.stretchMode = mode(value);
        sync();
      },
    },
    flip_h: { enumerable: true, configurable: true, get: () => state.flipH, set: (value: boolean) => { state.flipH = boolean('TextureButton.flip_h', value); sync(); } },
    flip_v: { enumerable: true, configurable: true, get: () => state.flipV, set: (value: boolean) => { state.flipV = boolean('TextureButton.flip_v', value); sync(); } },
    texture_click_mask: {
      enumerable: true,
      configurable: true,
      get: () => state.clickMask,
      set: (value: GodotBitMap | null) => {
        state.clickMask = clickMask(value);
        seatClickMask(options.node, state);
      },
    },
  });
  Object.assign(button, {
    set_texture_normal: (value: Texture | null) => { button.texture_normal = value; },
    get_texture_normal: () => state.textures.normal,
    set_normal_texture: (value: Texture | null) => { button.texture_normal = value; },
    get_normal_texture: () => state.textures.normal,
    set_pressed_texture: (value: Texture | null) => { button.texture_pressed = value; },
    get_pressed_texture: () => state.textures.pressed,
    get_texture_pressed: () => state.textures.pressed,
    set_hover_texture: (value: Texture | null) => { button.texture_hover = value; },
    get_hover_texture: () => state.textures.hover,
    get_texture_hover: () => state.textures.hover,
    set_disabled_texture: (value: Texture | null) => { button.texture_disabled = value; },
    get_disabled_texture: () => state.textures.disabled,
    get_texture_disabled: () => state.textures.disabled,
    set_focused_texture: (value: Texture | null) => { button.texture_focused = value; },
    get_focused_texture: () => state.textures.focused,
    get_texture_focused: () => state.textures.focused,
    set_click_mask: (value: GodotBitMap | null) => { button.texture_click_mask = value; },
    get_click_mask: () => state.clickMask,
    set_expand: (value: boolean) => { button.expand = value; },
    get_expand: () => state.expand,
    set_ignore_texture_size: (value: boolean) => { button.expand = value; },
    get_ignore_texture_size: () => state.expand,
    set_stretch_mode: (value: number) => { button.stretch_mode = value; },
    get_stretch_mode: () => state.stretchMode,
    set_flip_h: (value: boolean) => { button.flip_h = value; },
    set_flip_v: (value: boolean) => { button.flip_v = value; },
    is_flipped_h: () => state.flipH,
    is_flipped_v: () => state.flipV,
  });
  state.pointerDown = (event) => {
    const accepted = store.read('texture-button').onButtonPointerDown?.(event.button) !== false;
    state.held = accepted;
    sync();
  };
  state.pointerUp = (event) => {
    state.held = false;
    store.read('texture-button').onButtonPointerUp?.(event.button);
    sync();
  };
  state.pointerOver = () => { state.hovered = true; sync(); };
  state.pointerOut = () => {
    state.hovered = false;
    if (state.held && store.read('texture-button').buttonKeepPressedOutside !== true) {
      store.read('texture-button').onButtonPointerCancel?.();
      state.held = false;
    }
    sync();
  };
  state.pointerUpOutside = (event) => {
    if (!state.held) return;
    state.held = false;
    store.read('texture-button').onButtonPointerOutside?.(event.button);
    sync();
  };
  state.focusIn = () => { state.focused = true; sync(); };
  state.focusOut = () => { state.focused = false; sync(); };
  options.node.eventMode = 'static';
  options.node.cursor = 'pointer';
  options.node.on('pointerdown', state.pointerDown);
  options.node.on('pointerup', state.pointerUp);
  options.node.on('pointerupoutside', state.pointerUpOutside);
  options.node.on('pointerover', state.pointerOver);
  options.node.on('pointerout', state.pointerOut);
  options.node.on('focusin', state.focusIn);
  options.node.on('focusout', state.focusOut);
  state.unregisterRelease = registerCanvasNodeRelease(options.node, () => releaseCanvasTextureButton(options.node));
  seatClickMask(options.node, state);
  sync();
  return button;
}

/** Runtime `TextureButton.new()` with the pinned empty-texture Control defaults. */
export function createGodotCanvasTextureButton(godotMajor: 3 | 4 = 4): GodotCanvasTextureButton {
  const node = new Container();
  registerGodotObjectIdentity(node, 'TextureButton');
  return bindCanvasTextureButton({
    node,
    godot_major: godotMajor,
    width: 0,
    height: 0,
    normal: null,
    pressed: null,
    hover: null,
    disabledTexture: null,
    focused: null,
    expand: false,
    stretchMode: 0,
    flipH: false,
    flipV: false,
    clickMask: null,
  });
}

export function resizeCanvasTextureButton(node: Container, size: ControlPoint): void {
  const state = stateOf(node);
  state.width = dimension('TextureButton width', size.x);
  state.height = dimension('TextureButton height', size.y);
  layout(node as GodotCanvasTextureButton, state);
}

export function releaseCanvasTextureButton(node: Container): void {
  const state = TEXTURE_BUTTONS.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  state.unregisterRelease();
  node.off('pointerdown', state.pointerDown);
  node.off('pointerup', state.pointerUp);
  node.off('pointerupoutside', state.pointerUpOutside);
  node.off('pointerover', state.pointerOver);
  node.off('pointerout', state.pointerOut);
  node.off('focusin', state.focusIn);
  node.off('focusout', state.focusOut);
  state.sprite.removeFromParent();
  state.sprite.destroy({ texture: false, textureSource: false });
  state.focusSprite.removeFromParent();
  state.focusSprite.destroy({ texture: false, textureSource: false });
  node.hitArea = null;
  TEXTURE_BUTTONS.delete(node);
}
