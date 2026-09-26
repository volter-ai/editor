/** Button.icon projected onto the retained DOM/Pixi button identity. */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { Texture as ThreeTexture } from 'three';
import { optionalControlBinding } from './control-state';

type ButtonIcon = object | string | null;

export interface GodotTextureProjection {
  readonly identity: ButtonIcon;
  readonly pixiTexture: Texture | null;
  readonly domSource?: string;
}

interface IconState {
  value: ButtonIcon;
  sprite: Sprite | null;
  flat: boolean;
  iconAlignment: number;
  autowrapMode: number;
  clipText: boolean;
  expandIcon: boolean;
  alignment: number;
  verticalIconAlignment: number;
  textOverrunBehavior: number;
  textDirection: number;
  language: string;
  chrome: Graphics | null;
  clipMask: Graphics | null;
}

const ICONS = new WeakMap<object, IconState>();

function iconState(button: object): IconState {
  let state = ICONS.get(button);
  if (state === undefined) {
    state = { value: null, sprite: null, flat: false, iconAlignment: 0, autowrapMode: 0, clipText: false, expandIcon: false, alignment: 1, verticalIconAlignment: 1, textOverrunBehavior: 0, textDirection: 0, language: '', chrome: null, clipMask: null };
    ICONS.set(button, state);
  }
  return state;
}

function syncIcon(button: object, state: IconState): void {
  const binding = optionalControlBinding(button);
  const size = binding?.state.read(binding.id).size ?? binding?.state.authored(binding.id)?.size;
  if (button instanceof Container && state.sprite !== null) {
    if (state.expandIcon && size !== undefined && size.y > 0) {
      const scale = Math.max(0, (size.y - 4) / Math.max(1, state.sprite.texture.height));
      state.sprite.scale.set(scale);
    } else state.sprite.scale.set(1);
    const width = size?.x ?? button.width;
    state.sprite.anchor.set(state.iconAlignment === 0 ? 0 : state.iconAlignment === 2 ? 1 : 0.5, 0.5);
    // HorizontalAlignment.FILL places the icon in the centered content group; expansion remains
    // governed independently by Button.expand_icon, matching Godot's Button layout contract.
    state.sprite.position.set(state.iconAlignment === 0 ? 2 : state.iconAlignment === 2 ? width - 2 : width / 2, (size?.y ?? button.height) / 2);
  }
}

function requireButton(value: unknown): object {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    throw new TypeError('godot-compat: Button.icon requires a retained Button receiver.');
  }
  return value as object;
}

function browserSource(value: unknown): { readonly url?: string; readonly native?: CanvasImageSource } | null {
  if (typeof value === 'string') return { url: value };
  if (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) {
    return { url: value.currentSrc || value.src, native: value };
  }
  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) {
    return { url: value.toDataURL(), native: value };
  }
  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) return { native: value };
  return null;
}

/** One exact native projection shared by Button.icon and PopupMenu icon items. */
export function projectGodotTexture(value: unknown, member: string): GodotTextureProjection {
  if (value === null) return { identity: null, pixiTexture: null };
  if (typeof value !== 'string' && (typeof value !== 'object' || value === null)) {
    throw new TypeError(`${member} requires a Texture resource or null.`);
  }
  const identity = value as ButtonIcon;
  if (value instanceof Texture) {
    const browser = browserSource(value.source.resource);
    return {
      identity,
      pixiTexture: value,
      ...(browser?.url === undefined ? {} : { domSource: browser.url }),
    };
  }
  const direct = browserSource(value);
  if (direct !== null) {
    return {
      identity,
      pixiTexture: Texture.from(direct.native ?? direct.url!),
      ...(direct.url === undefined ? {} : { domSource: direct.url }),
    };
  }
  if (value instanceof ThreeTexture) {
    const browser = browserSource(value.image) ?? browserSource(value.source.data);
    if (browser === null) throw new TypeError(`${member} requires a browser-readable native Texture source.`);
    return {
      identity,
      pixiTexture: Texture.from(browser.native ?? browser.url!),
      ...(browser.url === undefined ? {} : { domSource: browser.url }),
    };
  }
  const resource = value as object;
  const nested = Reflect.get(resource, 'texture');
  if (nested !== undefined && nested !== value) {
    const projected = projectGodotTexture(nested, member);
    return { identity, pixiTexture: projected.pixiTexture, ...(projected.domSource === undefined ? {} : { domSource: projected.domSource }) };
  }
  const source = Reflect.get(resource, 'source');
  if (typeof source === 'object' && source !== null) {
    const browser = browserSource(Reflect.get(source, 'resource')) ?? browserSource(Reflect.get(source, 'data'));
    if (browser !== null) {
      return {
        identity,
        pixiTexture: Texture.from(browser.native ?? browser.url!),
        ...(browser.url === undefined ? {} : { domSource: browser.url }),
      };
    }
  }
  throw new TypeError(`${member} requires a retained Pixi/Three/browser Texture resource or null.`);
}

function releaseNative(state: IconState): void {
  if (state.sprite === null) return;
  state.sprite.removeFromParent();
  state.sprite.destroy({ children: true, texture: false, textureSource: false });
  state.sprite = null;
}

/** Read back the exact Resource identity assigned by game code. */
export function getButtonIcon(buttonLike: unknown): ButtonIcon {
  return ICONS.get(requireButton(buttonLike))?.value ?? null;
}

/** Assign and immediately project the icon onto the retained native control. */
export function setButtonIcon(buttonLike: unknown, iconLike: unknown): void {
  const button = requireButton(buttonLike);
  const projected = projectGodotTexture(iconLike, 'godot-compat: Button.icon');
  const value = projected.identity;
  const state = iconState(button);
  if (state.value === value) return;
  releaseNative(state);
  state.value = value;

  const binding = optionalControlBinding(button);
  binding?.state.write(binding.id, { buttonIconSource: projected.domSource });

  if (!(button instanceof Container) || projected.pixiTexture === null) return;
  // Texture.from participates in Pixi's shared asset cache. The icon presentation owns only
  // its Sprite; destroying the Texture here would invalidate every other consumer of the URL.
  const sprite = new Sprite(projected.pixiTexture);
  sprite.label = '__godot_button_icon';
  sprite.anchor.set(0.5);
  sprite.position.set(-Math.max(8, button.width / 2), 0);
  button.addChild(sprite);
  state.sprite = sprite;
  syncIcon(button, state);
}

export function getButtonFlat(buttonLike: unknown): boolean { return iconState(requireButton(buttonLike)).flat; }
export function setButtonFlat(buttonLike: unknown, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Button.flat requires bool.');
  const button = requireButton(buttonLike); const state = iconState(button); state.flat = value;
  const binding = optionalControlBinding(button);
  binding?.state.write(binding.id, { buttonFlat: value });
  if (typeof HTMLElement !== 'undefined' && button instanceof HTMLElement) { button.style.background = value ? 'transparent' : ''; button.style.borderColor = value ? 'transparent' : ''; }
  if (button instanceof Container) {
    state.chrome?.destroy(); state.chrome = null;
    if (!value) {
      const binding = optionalControlBinding(button); const size = binding?.state.read(binding.id).size ?? binding?.state.authored(binding.id)?.size;
      const chrome = new Graphics().roundRect(0, 0, size?.x ?? Math.max(1, button.width), size?.y ?? Math.max(1, button.height), 3).fill(0x252a32).stroke({ color: 0x737983, width: 1 });
      button.addChildAt(chrome, 0); state.chrome = chrome;
    }
  }
}
export function getButtonIconAlignment(buttonLike: unknown): number { return iconState(requireButton(buttonLike)).iconAlignment; }
export function setButtonIconAlignment(buttonLike: unknown, value: number, godotMajor: 3 | 4 = 4): void {
  const maximum = godotMajor === 3 ? 2 : 3;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`Button.${godotMajor === 3 ? 'icon_align' : 'icon_alignment'} must be in [0, ${String(maximum)}].`);
  }
  const button = requireButton(buttonLike); const state = iconState(button); state.iconAlignment = value;
  const binding = optionalControlBinding(button);
  binding?.state.write(binding.id, { buttonIconAlignment: value });
  syncIcon(button, state);
}
export function setButtonIconAlignment3(buttonLike: unknown, value: number): void {
  setButtonIconAlignment(buttonLike, value, 3);
}
export function getButtonAutowrapMode(buttonLike: unknown): number { return iconState(requireButton(buttonLike)).autowrapMode; }
export function setButtonAutowrapMode(buttonLike: unknown, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Button.autowrap_mode must be in [0, 3].');
  const button = requireButton(buttonLike); const state = iconState(button); state.autowrapMode = value;
  const binding = optionalControlBinding(button);
  binding?.state.write(binding.id, { buttonAutowrapMode: value });
  if (typeof HTMLElement !== 'undefined' && button instanceof HTMLElement) button.style.whiteSpace = value === 0 ? 'nowrap' : 'normal';
  if (button instanceof Text) { button.style.wordWrap = value !== 0; const width = binding?.state.read(binding.id).size?.x; if (width !== undefined) button.style.wordWrapWidth = width; button.style.breakWords = value === 1 || value === 3; }
}
export function getButtonClipText(buttonLike: unknown): boolean { return iconState(requireButton(buttonLike)).clipText; }
export function setButtonClipText(buttonLike: unknown, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Button.clip_text requires bool.');
  const button = requireButton(buttonLike); const state = iconState(button); state.clipText = value;
  const binding = optionalControlBinding(button);
  binding?.state.write(binding.id, { buttonClipText: value });
  if (typeof HTMLElement !== 'undefined' && button instanceof HTMLElement) button.style.overflow = value ? 'hidden' : '';
  if (button instanceof Container) {
    state.clipMask?.destroy(); state.clipMask = null; button.mask = null;
    if (value) { const size = binding?.state.read(binding.id).size ?? binding?.state.authored(binding.id)?.size; const mask = new Graphics().rect(0, 0, size?.x ?? button.width, size?.y ?? button.height).fill(0xffffff); button.addChild(mask); button.mask = mask; state.clipMask = mask; }
  }
}
export function getButtonExpandIcon(buttonLike: unknown): boolean { return iconState(requireButton(buttonLike)).expandIcon; }
export function setButtonExpandIcon(buttonLike: unknown, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Button.expand_icon requires bool.');
  const button = requireButton(buttonLike); const state = iconState(button); state.expandIcon = value;
  const binding = optionalControlBinding(button);
  binding?.state.write(binding.id, { buttonExpandIcon: value });
  syncIcon(button, state);
}

export function getButtonAlignment(buttonLike: unknown): number { return iconState(requireButton(buttonLike)).alignment; }
export function setButtonAlignment(buttonLike: unknown, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Button.alignment must be in [0, 3].');
  const button = requireButton(buttonLike); const state = iconState(button); state.alignment = value;
  const binding = optionalControlBinding(button); binding?.state.write(binding.id, { buttonAlignment: value });
  if (typeof HTMLElement !== 'undefined' && button instanceof HTMLElement) button.style.textAlign = value === 0 ? 'left' : value === 2 ? 'right' : value === 3 ? 'justify' : 'center';
  if (button instanceof Text) button.style.align = value === 0 ? 'left' : value === 2 ? 'right' : 'center';
}

export function getButtonVerticalIconAlignment(buttonLike: unknown): number { return iconState(requireButton(buttonLike)).verticalIconAlignment; }
export function setButtonVerticalIconAlignment(buttonLike: unknown, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Button.vertical_icon_alignment must be in [0, 3].');
  const button = requireButton(buttonLike); const state = iconState(button); state.verticalIconAlignment = value;
  const binding = optionalControlBinding(button); binding?.state.write(binding.id, { buttonVerticalIconAlignment: value });
  if (button instanceof Container && state.sprite !== null) {
    const size = binding?.state.read(binding.id).size ?? binding?.state.authored(binding.id)?.size;
    state.sprite.anchor.y = value === 0 ? 0 : value === 2 ? 1 : 0.5;
    state.sprite.y = value === 0 ? 2 : value === 2 ? (size?.y ?? button.height) - 2 : (size?.y ?? button.height) / 2;
  }
}

export function getButtonTextOverrunBehavior(buttonLike: unknown): number { return iconState(requireButton(buttonLike)).textOverrunBehavior; }
export function setButtonTextOverrunBehavior(buttonLike: unknown, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) throw new RangeError('Button.text_overrun_behavior must be in [0, 6].');
  const button = requireButton(buttonLike); const state = iconState(button); state.textOverrunBehavior = value;
  const binding = optionalControlBinding(button); binding?.state.write(binding.id, { buttonTextOverrunBehavior: value });
  if (typeof HTMLElement !== 'undefined' && button instanceof HTMLElement) button.style.textOverflow = value === 3 || value === 4 ? 'ellipsis' : 'clip';
}

export function getButtonTextDirection(buttonLike: unknown): number { return iconState(requireButton(buttonLike)).textDirection; }
export function setButtonTextDirection(buttonLike: unknown, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Button.text_direction must be in [0, 3].');
  const button = requireButton(buttonLike); const state = iconState(button); state.textDirection = value;
  const binding = optionalControlBinding(button); binding?.state.write(binding.id, { buttonTextDirection: value });
  if (typeof HTMLElement !== 'undefined' && button instanceof HTMLElement) button.dir = value === 2 ? 'rtl' : value === 1 ? 'ltr' : 'auto';
}

export function getButtonLanguage(buttonLike: unknown): string { return iconState(requireButton(buttonLike)).language; }
export function setButtonLanguage(buttonLike: unknown, value: string): void {
  if (typeof value !== 'string') throw new TypeError('Button.language requires String.');
  const button = requireButton(buttonLike); const state = iconState(button); state.language = value;
  const binding = optionalControlBinding(button); binding?.state.write(binding.id, { buttonLanguage: value });
  if (typeof HTMLElement !== 'undefined' && button instanceof HTMLElement) button.lang = value;
}

/** Release only compat-owned Sprite/URL texture presentation, never caller-owned Resources. */
export function releaseButtonIcon(buttonLike: unknown): void {
  const button = requireButton(buttonLike);
  const state = ICONS.get(button);
  if (state === undefined) return;
  releaseNative(state);
  state.chrome?.destroy();
  state.clipMask?.destroy();
  ICONS.delete(button);
  const binding = optionalControlBinding(button);
  binding?.state.write(binding.id, {
    buttonIconSource: undefined,
    buttonFlat: undefined,
    buttonIconAlignment: undefined,
    buttonAutowrapMode: undefined,
    buttonClipText: undefined,
    buttonExpandIcon: undefined,
    buttonAlignment: undefined,
    buttonVerticalIconAlignment: undefined,
    buttonTextOverrunBehavior: undefined,
    buttonTextDirection: undefined,
    buttonLanguage: undefined,
  });
}
