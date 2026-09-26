/** LinkButton and DOM TextureButton behavior on retained Controls. */

import {
  bindBaseButton,
  type BaseButtonBindOptions,
  type BaseButtonState,
  type GodotButtonControl,
} from './control-widgets';
import { controlBinding, type GodotControl } from './control-state';
import type { TextureNode } from './node';
import type { GodotBitMap } from './bitmap';

type RetainedTexture2D = TextureNode['texture'];

function string(member: string, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} must be String.`);
  return value;
}

function boolean(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be bool.`);
  return value;
}

function stretchMode(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) {
    throw new RangeError('TextureButton.stretch_mode must be SCALE (0) through KEEP_ASPECT_COVERED (6).');
  }
  if (value === 1) throw new Error('TextureButton STRETCH_TILE requires native repeated texture sampling and is not approximated by CSS.');
  return value;
}

export interface GodotLinkButton extends GodotButtonControl {
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

export function bindLinkButton(
  control: GodotControl,
  initial: Partial<BaseButtonState> & { readonly text?: string; readonly uri?: string; readonly underline?: number } = {},
): GodotLinkButton {
  const link = bindBaseButton(control, initial) as GodotLinkButton;
  const binding = controlBinding(control);
  let label = string('LinkButton.text', initial.text ?? control.text);
  let uri = string('LinkButton.uri', initial.uri ?? '');
  let underline = initial.underline ?? 0;
  const validateUnderline = (value: number): number => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2) {
      throw new RangeError('LinkButton.underline must be ALWAYS (0), ON_HOVER (1), or NEVER (2).');
    }
    return value;
  };
  underline = validateUnderline(underline);
  const sync = (): void => binding.state.write(binding.id, { text: label, linkUri: uri, linkUnderline: underline });
  Object.defineProperties(link, {
    text: { enumerable: true, configurable: true, get: () => label, set: (value: string) => { label = string('LinkButton.text', value); sync(); } },
    uri: { enumerable: true, configurable: true, get: () => uri, set: (value: string) => { uri = string('LinkButton.uri', value); sync(); } },
    underline: { enumerable: true, configurable: true, get: () => underline, set: (value: number) => { underline = validateUnderline(value); sync(); } },
    underline_mode: { enumerable: true, configurable: true, get: () => underline, set: (value: number) => { underline = validateUnderline(value); sync(); } },
  });
  Object.assign(link, {
    get_text: () => label,
    set_text: (value: string) => { link.text = value; },
    get_uri: () => uri,
    set_uri: (value: string) => { link.uri = value; },
    get_underline_mode: () => underline,
    set_underline_mode: (value: number) => { link.underline = value; },
  });
  sync();
  return link;
}

export interface GodotTextureButton extends GodotButtonControl {
  texture_normal: RetainedTexture2D;
  texture_pressed: RetainedTexture2D;
  texture_hover: RetainedTexture2D;
  texture_disabled: RetainedTexture2D;
  texture_focused: RetainedTexture2D;
  expand: boolean;
  stretch_mode: number;
  flip_h: boolean;
  flip_v: boolean;
  texture_click_mask: GodotBitMap | null;
  set_texture_normal(value: RetainedTexture2D): void;
  get_texture_normal(): RetainedTexture2D;
  set_normal_texture(value: RetainedTexture2D): void;
  get_normal_texture(): RetainedTexture2D;
  set_pressed_texture(value: RetainedTexture2D): void;
  get_pressed_texture(): RetainedTexture2D;
  get_texture_pressed(): RetainedTexture2D;
  set_hover_texture(value: RetainedTexture2D): void;
  get_hover_texture(): RetainedTexture2D;
  get_texture_hover(): RetainedTexture2D;
  set_disabled_texture(value: RetainedTexture2D): void;
  get_disabled_texture(): RetainedTexture2D;
  get_texture_disabled(): RetainedTexture2D;
  set_focused_texture(value: RetainedTexture2D): void;
  get_focused_texture(): RetainedTexture2D;
  get_texture_focused(): RetainedTexture2D;
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

interface DomTextureState {
  normal: RetainedTexture2D;
  pressed: RetainedTexture2D;
  hover: RetainedTexture2D;
  disabled: RetainedTexture2D;
  focused: RetainedTexture2D;
  expand: boolean;
  stretch: number;
  flipH: boolean;
  flipV: boolean;
  held: boolean;
  hovered: boolean;
  focusedNow: boolean;
  clickMask: GodotBitMap | null;
  godotMajor: 3 | 4;
  sourceWidth: number;
  sourceHeight: number;
  seatedSource: string;
}

function clickMask(value: GodotBitMap | null | undefined): GodotBitMap | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || typeof value.get_bitv !== 'function' || typeof value.get_size !== 'function') {
    throw new TypeError('TextureButton.texture_click_mask must be a retained BitMap Resource or null.');
  }
  return value;
}

function acceptsPoint(button: GodotTextureButton, state: DomTextureState, x: number, y: number, width: number, height: number): boolean {
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return false;
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const mask = state.clickMask;
  if (mask === null) return true;
  const size = mask.get_size();
  if (!(size.x > 0) || !(size.y > 0)) return false;
  const source = sourceOf(button, state);
  const sourceWidth = source === '' ? size.x : state.sourceWidth;
  const sourceHeight = source === '' ? size.y : state.sourceHeight;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return false;
  let drawnWidth = sourceWidth;
  let drawnHeight = sourceHeight;
  let drawnX = 0;
  let drawnY = 0;
  if (state.godotMajor === 4 || state.expand) {
    if (state.stretch === 0) {
      drawnWidth = width;
      drawnHeight = height;
    } else if (state.stretch === 3) {
      drawnX = (width - drawnWidth) / 2;
      drawnY = (height - drawnHeight) / 2;
    } else if (state.stretch === 4 || state.stretch === 5 || state.stretch === 6) {
      const ratio = state.stretch === 6
        ? Math.max(width / sourceWidth, height / sourceHeight)
        : Math.min(width / sourceWidth, height / sourceHeight);
      drawnWidth = sourceWidth * ratio;
      drawnHeight = sourceHeight * ratio;
      if (state.stretch === 5 || state.stretch === 6) {
        drawnX = (width - drawnWidth) / 2;
        drawnY = (height - drawnHeight) / 2;
      }
    }
  }
  if (!(drawnWidth > 0) || !(drawnHeight > 0)) return false;
  if (x < drawnX || y < drawnY || x >= drawnX + drawnWidth || y >= drawnY + drawnHeight) return false;
  let sampledX = Math.floor(((x - drawnX) / drawnWidth) * size.x);
  let sampledY = Math.floor(((y - drawnY) / drawnHeight) * size.y);
  if (state.flipH) sampledX = size.x - 1 - sampledX;
  if (state.flipV) sampledY = size.y - 1 - sampledY;
  return mask.get_bitv({ x: sampledX, y: sampledY });
}

function sourceOf(button: GodotTextureButton, state: DomTextureState): string {
  if (button.disabled) return state.disabled || state.normal;
  if (state.held) return state.pressed || state.hover || state.normal;
  if (state.hovered) return state.hover || (button.button_pressed ? state.pressed : state.normal);
  return state.normal || (state.focusedNow ? state.focused : '');
}

function fitOf(state: DomTextureState): 'fill' | 'none' | 'contain' | 'cover' {
  if ((state.godotMajor === 3 && !state.expand) || state.stretch === 2 || state.stretch === 3) return 'none';
  if (state.stretch === 4 || state.stretch === 5) return 'contain';
  if (state.stretch === 6) return 'cover';
  return 'fill';
}

export function bindTextureButton(
  control: GodotControl,
  initial: BaseButtonBindOptions & {
    readonly normal?: RetainedTexture2D;
    readonly pressed?: RetainedTexture2D;
    readonly hover?: RetainedTexture2D;
    readonly disabledTexture?: RetainedTexture2D;
    readonly focused?: RetainedTexture2D;
    readonly expand?: boolean;
    readonly stretchMode?: number;
    readonly flipH?: boolean;
    readonly flipV?: boolean;
    readonly clickMask?: GodotBitMap | null;
  } = {},
): GodotTextureButton {
  const button = bindBaseButton(control, initial) as GodotTextureButton;
  const binding = controlBinding(control);
  const state: DomTextureState = {
    normal: string('TextureButton.texture_normal', initial.normal ?? ''),
    pressed: string('TextureButton.texture_pressed', initial.pressed ?? ''),
    hover: string('TextureButton.texture_hover', initial.hover ?? ''),
    disabled: string('TextureButton.texture_disabled', initial.disabledTexture ?? ''),
    focused: string('TextureButton.texture_focused', initial.focused ?? ''),
    expand: initial.expand ?? false,
    stretch: stretchMode(initial.stretchMode ?? 0),
    flipH: initial.flipH ?? false,
    flipV: initial.flipV ?? false,
    held: false,
    hovered: false,
    focusedNow: false,
    clickMask: clickMask(initial.clickMask),
    godotMajor: initial.godot_major ?? 3,
    sourceWidth: 0,
    sourceHeight: 0,
    seatedSource: '',
  };
  const sync = (): void => {
    const source = sourceOf(button, state);
    const focusedSource = state.focusedNow && state.focused !== '' ? state.focused : undefined;
    if (source !== state.seatedSource) {
      state.seatedSource = source;
      state.sourceWidth = 0;
      state.sourceHeight = 0;
    }
    binding.state.write(binding.id, {
      textureButtonSource: source,
      ...(focusedSource === undefined ? {} : { textureButtonFocused: focusedSource }),
      textureButtonFit: fitOf(state),
      textureButtonCentered: state.stretch === 3 || state.stretch === 5,
      textureButtonFlipH: state.flipH,
      textureButtonFlipV: state.flipV,
    });
  };
  const textureProperty = (name: keyof Pick<DomTextureState, 'normal' | 'pressed' | 'hover' | 'disabled' | 'focused'>, member: string): PropertyDescriptor => ({
    enumerable: true,
    configurable: true,
    get: () => state[name],
    set: (value: RetainedTexture2D) => { state[name] = string(member, value); sync(); },
  });
  Object.defineProperties(button, {
    texture_normal: textureProperty('normal', 'TextureButton.texture_normal'),
    texture_pressed: textureProperty('pressed', 'TextureButton.texture_pressed'),
    texture_hover: textureProperty('hover', 'TextureButton.texture_hover'),
    texture_disabled: textureProperty('disabled', 'TextureButton.texture_disabled'),
    texture_focused: textureProperty('focused', 'TextureButton.texture_focused'),
    expand: { enumerable: true, configurable: true, get: () => state.expand, set: (value: boolean) => { state.expand = boolean('TextureButton.expand', value); sync(); } },
    stretch_mode: { enumerable: true, configurable: true, get: () => state.stretch, set: (value: number) => { state.stretch = stretchMode(value); sync(); } },
    flip_h: { enumerable: true, configurable: true, get: () => state.flipH, set: (value: boolean) => { state.flipH = boolean('TextureButton.flip_h', value); sync(); } },
    flip_v: { enumerable: true, configurable: true, get: () => state.flipV, set: (value: boolean) => { state.flipV = boolean('TextureButton.flip_v', value); sync(); } },
    texture_click_mask: { enumerable: true, configurable: true, get: () => state.clickMask, set: (value: GodotBitMap | null) => { state.clickMask = clickMask(value); } },
  });
  Object.assign(button, {
    set_texture_normal: (value: RetainedTexture2D) => { button.texture_normal = value; },
    get_texture_normal: () => state.normal,
    set_normal_texture: (value: RetainedTexture2D) => { button.texture_normal = value; },
    get_normal_texture: () => state.normal,
    set_pressed_texture: (value: RetainedTexture2D) => { button.texture_pressed = value; },
    get_pressed_texture: () => state.pressed,
    get_texture_pressed: () => state.pressed,
    set_hover_texture: (value: RetainedTexture2D) => { button.texture_hover = value; },
    get_hover_texture: () => state.hover,
    get_texture_hover: () => state.hover,
    set_disabled_texture: (value: RetainedTexture2D) => { button.texture_disabled = value; },
    get_disabled_texture: () => state.disabled,
    get_texture_disabled: () => state.disabled,
    set_focused_texture: (value: RetainedTexture2D) => { button.texture_focused = value; },
    get_focused_texture: () => state.focused,
    get_texture_focused: () => state.focused,
    set_click_mask: (value: GodotBitMap | null) => { button.texture_click_mask = value; },
    get_click_mask: () => state.clickMask,
    set_expand: (value: boolean) => { button.expand = value; },
    get_expand: () => state.expand,
    set_ignore_texture_size: (value: boolean) => { button.expand = value; },
    get_ignore_texture_size: () => state.expand,
    set_stretch_mode: (value: number) => { button.stretch_mode = value; },
    get_stretch_mode: () => state.stretch,
    set_flip_h: (value: boolean) => { button.flip_h = value; },
    set_flip_v: (value: boolean) => { button.flip_v = value; },
    is_flipped_h: () => state.flipH,
    is_flipped_v: () => state.flipV,
  });
  binding.state.write(binding.id, {
    onTextureButtonHover(value): void { state.hovered = value; sync(); },
    onTextureButtonFocus(value): void { state.focusedNow = value; sync(); },
    onTextureButtonHeld(value): void { state.held = value; sync(); },
    onTextureButtonSourceSize(width, height): void {
      if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
        throw new Error('TextureButton source image must decode to positive integer dimensions.');
      }
      state.sourceWidth = width;
      state.sourceHeight = height;
    },
    textureButtonAcceptsPoint: (x, y, width, height) => acceptsPoint(button, state, x, y, width, height),
  });
  sync();
  return button;
}
