/** Pixi-native TextureProgressBar layers over the retained Range Container. */

import { Container, Graphics, NineSliceSprite, Sprite, Texture } from 'pixi.js';
import {
  addCanvasRangeRelease,
  bindCanvasRange,
  releaseCanvasRange,
  type CanvasRangeOptions,
  type GodotCanvasRange,
} from './canvas-range';
import { copyColor, godotColor } from './color';
import { markInternalCanvasChild } from './node';
import { registerGodotObjectIdentity } from './object';
import type { ColorValue } from './variant';

export type GodotCanvasTextureProgressBar = GodotCanvasRange & {
  fill_mode: number;
  texture_under: Texture | null;
  texture_over: Texture | null;
  texture_progress: Texture | null;
  tint_under: ColorValue;
  tint_over: ColorValue;
  tint_progress: ColorValue;
  radial_initial_angle: number;
  radial_fill_degrees: number;
  radial_center_offset: { x: number; y: number };
  texture_progress_offset: { x: number; y: number };
  nine_patch_stretch: boolean;
  stretch_margin_left: number;
  stretch_margin_top: number;
  stretch_margin_right: number;
  stretch_margin_bottom: number;
  set_fill_mode(value: number): void;
  get_fill_mode(): number;
  set_under_texture(value: Texture | null): void;
  get_under_texture(): Texture | null;
  set_over_texture(value: Texture | null): void;
  get_over_texture(): Texture | null;
  set_progress_texture(value: Texture | null): void;
  get_progress_texture(): Texture | null;
  set_nine_patch_stretch(value: boolean): void;
  get_nine_patch_stretch(): boolean;
  set_stretch_margin(side: number, value: number): void;
  get_stretch_margin(side: number): number;
  set_radial_initial_angle(value: number): void;
  get_radial_initial_angle(): number;
  set_fill_degrees(value: number): void;
  get_fill_degrees(): number;
  set_radial_center_offset(value: { x: number; y: number }): void;
  get_radial_center_offset(): { x: number; y: number };
  set_texture_progress_offset(value: { x: number; y: number }): void;
  get_texture_progress_offset(): { x: number; y: number };
  set_tint_under(value: ColorValue): void;
  get_tint_under(): ColorValue;
  set_tint_over(value: ColorValue): void;
  get_tint_over(): ColorValue;
  set_tint_progress(value: ColorValue): void;
  get_tint_progress(): ColorValue;
};

interface TextureProgressState {
  readonly under: Sprite;
  readonly progress: Sprite;
  readonly over: Sprite;
  readonly mask: Graphics;
  width: number;
  height: number;
  fillMode: number;
  initialAngle: number;
  fillDegrees: number;
  center: { x: number; y: number };
  offset: { x: number; y: number };
  tints: [ColorValue, ColorValue, ColorValue];
  readonly margins: [number, number, number, number];
  released: boolean;
}

const TEXTURES = new WeakMap<GodotCanvasTextureProgressBar, TextureProgressState>();

function finite(member: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${member} must be finite.`);
  return value;
}
function texture(member: string, value: Texture | null): Texture | null {
  if (value !== null && !(value instanceof Texture)) throw new TypeError(`${member} must be a Pixi Texture or null.`);
  return value;
}
function point(member: string, value: { readonly x: number; readonly y: number } | undefined): { x: number; y: number } {
  const next = value ?? { x: 0, y: 0 };
  return { x: finite(`${member}.x`, next.x), y: finite(`${member}.y`, next.y) };
}
function tint(value: ColorValue | undefined): ColorValue {
  const next = value ?? godotColor(1, 1, 1, 1);
  if (![next.r, next.g, next.b, next.a].every(Number.isFinite)) throw new TypeError('TextureProgressBar tint must be a finite Color.');
  return copyColor(next);
}
function pixiTint(value: ColorValue): number {
  return ((Math.max(0, Math.min(255, Math.round(value.r * 255))) << 16) |
    (Math.max(0, Math.min(255, Math.round(value.g * 255))) << 8) |
    Math.max(0, Math.min(255, Math.round(value.b * 255))));
}
function margin(member: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${member} must be an integer.`);
  return value;
}
function side(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('TextureProgressBar margin side must be 0 through 3.');
  return value;
}

function draw(bar: GodotCanvasTextureProgressBar): void {
  const state = TEXTURES.get(bar);
  if (state === undefined) return;
  const sprites = [state.under, state.over, state.progress] as const;
  sprites.forEach((sprite, index) => {
    const value = state.tints[index]!;
    sprite.tint = pixiTint(value);
    sprite.alpha = value.a;
    sprite.scale.set(1);
  });
  state.progress.position.set(state.offset.x, state.offset.y);
  const ratio = bar.ratio;
  const width = state.progress.texture === Texture.EMPTY ? 0 : state.progress.texture.width;
  const height = state.progress.texture === Texture.EMPTY ? 0 : state.progress.texture.height;
  const offsetX = state.offset.x;
  const offsetY = state.offset.y;
  state.mask.clear();
  if (state.fillMode <= 3) {
    const visibleWidth = state.fillMode <= 1 ? width * ratio : width;
    const visibleHeight = state.fillMode >= 2 ? height * ratio : height;
    const x = state.fillMode === 1 ? width - visibleWidth : 0;
    const y = state.fillMode === 3 ? height - visibleHeight : 0;
    state.mask.rect(offsetX + x, offsetY + y, visibleWidth, visibleHeight).fill(0xffffff);
  } else if (state.fillMode === 6) {
    const visibleWidth = width * ratio;
    state.mask.rect(offsetX + (width - visibleWidth) / 2, offsetY, visibleWidth, height).fill(0xffffff);
  } else if (state.fillMode === 7) {
    const visibleHeight = height * ratio;
    state.mask.rect(offsetX, offsetY + (height - visibleHeight) / 2, width, visibleHeight).fill(0xffffff);
  } else {
    const symmetric = state.fillMode === 8;
    const degrees = state.fillDegrees * ratio;
    const startDegrees = state.initialAngle - 90 - (symmetric ? degrees / 2 : 0);
    const start = startDegrees * Math.PI / 180;
    const direction = state.fillMode === 5 ? -1 : 1;
    const amount = degrees * Math.PI / 180 * direction;
    const centerX = offsetX + width / 2 + state.center.x;
    const centerY = offsetY + height / 2 + state.center.y;
    const radius = Math.hypot(width, height);
    state.mask.moveTo(centerX, centerY).arc(centerX, centerY, radius, start, start + amount, direction < 0).closePath().fill(0xffffff);
  }
}

export function bindCanvasTextureProgressBar(
  options: CanvasRangeOptions & {
    readonly under?: Texture | null;
    readonly over?: Texture | null;
    readonly progress?: Texture | null;
    readonly fillMode?: number;
    readonly tintUnder?: ColorValue;
    readonly tintOver?: ColorValue;
    readonly tintProgress?: ColorValue;
    readonly radialInitialAngle?: number;
    readonly radialFillDegrees?: number;
    readonly radialCenterOffset?: { readonly x: number; readonly y: number };
    readonly textureProgressOffset?: { readonly x: number; readonly y: number };
    readonly ninePatchStretch?: boolean;
    readonly stretchMarginLeft?: number;
    readonly stretchMarginTop?: number;
    readonly stretchMarginRight?: number;
    readonly stretchMarginBottom?: number;
  },
): GodotCanvasTextureProgressBar {
  if (options.ninePatchStretch === true) throw new Error('TextureProgressBar.nine_patch_stretch requires retained NineSliceSprite layers and is not approximated.');
  const bar = bindCanvasRange({ ...options, presentation: 'texture-progress', editable: false, scrollable: false }) as GodotCanvasTextureProgressBar;
  const under = markInternalCanvasChild(new Sprite({ texture: texture('TextureProgressBar.texture_under', options.under ?? null) ?? Texture.EMPTY }));
  const progress = markInternalCanvasChild(new Sprite({ texture: texture('TextureProgressBar.texture_progress', options.progress ?? null) ?? Texture.EMPTY }));
  const over = markInternalCanvasChild(new Sprite({ texture: texture('TextureProgressBar.texture_over', options.over ?? null) ?? Texture.EMPTY }));
  const mask = markInternalCanvasChild(new Graphics());
  bar.addChildAt(under, 0);
  bar.addChild(progress, mask, over);
  progress.mask = mask;
  const fillMode = options.fillMode ?? 0;
  if (!Number.isSafeInteger(fillMode) || fillMode < 0 || fillMode > 8) throw new RangeError('TextureProgressBar.fill_mode must be 0 through 8.');
  const state: TextureProgressState = {
    under, progress, over, mask,
    width: options.width,
    height: options.height,
    fillMode,
    initialAngle: ((finite('TextureProgressBar.radial_initial_angle', options.radialInitialAngle ?? 0) % 360) + 360) % 360,
    fillDegrees: Math.max(0, Math.min(360, finite('TextureProgressBar.radial_fill_degrees', options.radialFillDegrees ?? 360))),
    center: point('TextureProgressBar.radial_center_offset', options.radialCenterOffset),
    offset: point('TextureProgressBar.texture_progress_offset', options.textureProgressOffset),
    tints: [tint(options.tintUnder), tint(options.tintOver), tint(options.tintProgress)],
    margins: [
      margin('TextureProgressBar.stretch_margin_left', options.stretchMarginLeft ?? 0),
      margin('TextureProgressBar.stretch_margin_top', options.stretchMarginTop ?? 0),
      margin('TextureProgressBar.stretch_margin_right', options.stretchMarginRight ?? 0),
      margin('TextureProgressBar.stretch_margin_bottom', options.stretchMarginBottom ?? 0),
    ],
    released: false,
  };
  TEXTURES.set(bar, state);
  Object.defineProperties(bar, {
    fill_mode: { enumerable: true, configurable: true, get: () => state.fillMode, set: (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || value > 8) throw new RangeError('TextureProgressBar.fill_mode must be 0 through 8.'); state.fillMode = value; draw(bar); } },
    texture_under: { enumerable: true, configurable: true, get: () => state.under.texture === Texture.EMPTY ? null : state.under.texture, set: (value: Texture | null) => { state.under.texture = texture('TextureProgressBar.texture_under', value) ?? Texture.EMPTY; draw(bar); } },
    texture_over: { enumerable: true, configurable: true, get: () => state.over.texture === Texture.EMPTY ? null : state.over.texture, set: (value: Texture | null) => { state.over.texture = texture('TextureProgressBar.texture_over', value) ?? Texture.EMPTY; draw(bar); } },
    texture_progress: { enumerable: true, configurable: true, get: () => state.progress.texture === Texture.EMPTY ? null : state.progress.texture, set: (value: Texture | null) => { state.progress.texture = texture('TextureProgressBar.texture_progress', value) ?? Texture.EMPTY; draw(bar); } },
    nine_patch_stretch: { enumerable: true, configurable: true, get: () => false, set: (value: boolean) => { if (typeof value !== 'boolean') throw new TypeError('TextureProgressBar.nine_patch_stretch must be bool.'); if (value) throw new Error('TextureProgressBar.nine_patch_stretch requires retained NineSliceSprite layers and is not approximated.'); } },
    radial_initial_angle: { enumerable: true, configurable: true, get: () => state.initialAngle, set: (value: number) => { state.initialAngle = ((finite('TextureProgressBar.radial_initial_angle', value) % 360) + 360) % 360; draw(bar); } },
    radial_fill_degrees: { enumerable: true, configurable: true, get: () => state.fillDegrees, set: (value: number) => { state.fillDegrees = Math.max(0, Math.min(360, finite('TextureProgressBar.radial_fill_degrees', value))); draw(bar); } },
    radial_center_offset: { enumerable: true, configurable: true, get: () => ({ ...state.center }), set: (value: { x: number; y: number }) => { state.center = point('TextureProgressBar.radial_center_offset', value); draw(bar); } },
    texture_progress_offset: { enumerable: true, configurable: true, get: () => ({ ...state.offset }), set: (value: { x: number; y: number }) => { state.offset = point('TextureProgressBar.texture_progress_offset', value); draw(bar); } },
    tint_under: { enumerable: true, configurable: true, get: () => copyColor(state.tints[0]), set: (value: ColorValue) => { state.tints[0] = tint(value); draw(bar); } },
    tint_over: { enumerable: true, configurable: true, get: () => copyColor(state.tints[1]), set: (value: ColorValue) => { state.tints[1] = tint(value); draw(bar); } },
    tint_progress: { enumerable: true, configurable: true, get: () => copyColor(state.tints[2]), set: (value: ColorValue) => { state.tints[2] = tint(value); draw(bar); } },
    stretch_margin_left: { enumerable: true, configurable: true, get: () => state.margins[0], set: (value: number) => { state.margins[0] = margin('TextureProgressBar.stretch_margin_left', value); } },
    stretch_margin_top: { enumerable: true, configurable: true, get: () => state.margins[1], set: (value: number) => { state.margins[1] = margin('TextureProgressBar.stretch_margin_top', value); } },
    stretch_margin_right: { enumerable: true, configurable: true, get: () => state.margins[2], set: (value: number) => { state.margins[2] = margin('TextureProgressBar.stretch_margin_right', value); } },
    stretch_margin_bottom: { enumerable: true, configurable: true, get: () => state.margins[3], set: (value: number) => { state.margins[3] = margin('TextureProgressBar.stretch_margin_bottom', value); } },
  });
  bar.set_fill_mode = (value): void => { bar.fill_mode = value; };
  bar.get_fill_mode = (): number => state.fillMode;
  bar.set_under_texture = (value): void => { bar.texture_under = value; };
  bar.get_under_texture = (): Texture | null => bar.texture_under;
  bar.set_over_texture = (value): void => { bar.texture_over = value; };
  bar.get_over_texture = (): Texture | null => bar.texture_over;
  bar.set_progress_texture = (value): void => { bar.texture_progress = value; };
  bar.get_progress_texture = (): Texture | null => bar.texture_progress;
  bar.set_nine_patch_stretch = (value): void => { bar.nine_patch_stretch = value; };
  bar.get_nine_patch_stretch = (): boolean => false;
  bar.set_stretch_margin = (index, value): void => { state.margins[side(index)] = margin('TextureProgressBar stretch margin', value); };
  bar.get_stretch_margin = (index): number => state.margins[side(index)]!;
  bar.set_radial_initial_angle = (value): void => { bar.radial_initial_angle = value; };
  bar.get_radial_initial_angle = (): number => state.initialAngle;
  bar.set_fill_degrees = (value): void => { bar.radial_fill_degrees = value; };
  bar.get_fill_degrees = (): number => state.fillDegrees;
  bar.set_radial_center_offset = (value): void => { bar.radial_center_offset = value; };
  bar.get_radial_center_offset = (): { x: number; y: number } => ({ ...state.center });
  bar.set_texture_progress_offset = (value): void => { bar.texture_progress_offset = value; };
  bar.get_texture_progress_offset = (): { x: number; y: number } => ({ ...state.offset });
  bar.set_tint_under = (value): void => { bar.tint_under = value; };
  bar.get_tint_under = (): ColorValue => copyColor(state.tints[0]);
  bar.set_tint_over = (value): void => { bar.tint_over = value; };
  bar.get_tint_over = (): ColorValue => copyColor(state.tints[1]);
  bar.set_tint_progress = (value): void => { bar.tint_progress = value; };
  bar.get_tint_progress = (): ColorValue => copyColor(state.tints[2]);
  bar.value_changed.connect(() => draw(bar));
  bar.changed.connect(() => draw(bar));
  addCanvasRangeRelease(bar, () => {
    if (state.released) return;
    state.released = true;
    state.progress.mask = null;
    for (const child of [state.under, state.progress, state.over, state.mask]) {
      child.removeFromParent();
      child.destroy();
    }
    TEXTURES.delete(bar);
  });
  draw(bar);
  return bar;
}

/** Runtime `TextureProgressBar.new()` with empty layers and native Range defaults. */
export function createGodotCanvasTextureProgressBar(godotMajor: 3 | 4 = 4): GodotCanvasTextureProgressBar {
  const node = new Container();
  registerGodotObjectIdentity(node, 'TextureProgressBar');
  return bindCanvasTextureProgressBar({
    node,
    godotMajor,
    width: 0,
    height: 0,
    minValue: 0,
    maxValue: 100,
    step: 0.01,
    page: 0,
    value: 0,
    under: null,
    progress: null,
    over: null,
    fillMode: 0,
    radialInitialAngle: 0,
    radialFillDegrees: 360,
    radialCenterOffset: { x: 0, y: 0 },
    textureProgressOffset: { x: 0, y: 0 },
    ninePatchStretch: false,
  });
}

export function resizeCanvasTextureProgressBar(bar: GodotCanvasTextureProgressBar, width: number, height: number): void {
  const state = TEXTURES.get(bar);
  if (state === undefined) throw new Error('Canvas TextureProgressBar is not bound.');
  state.width = finite('TextureProgressBar width', width);
  state.height = finite('TextureProgressBar height', height);
  draw(bar);
}

/** Release the TextureProgressBar layers and its shared retained Range behavior. */
export function releaseCanvasTextureProgressBar(bar: GodotCanvasTextureProgressBar): void {
  releaseCanvasRange(bar);
}
