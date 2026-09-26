/** ProgressBar and TextureProgressBar presentation over the retained Range owner. */

import { bindHSlider, bindProgressBar, type GodotProgressBarControl, type GodotRangeControl, type RangeState } from './control-widgets';
import { controlBinding, type GodotControl } from './control-state';
import { colorToHtml, copyColor, godotColor } from './color';
import type { ColorValue } from './variant';

function bool(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be bool.`);
  return value;
}
function integer(member: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${member} must be ${minimum} through ${maximum}.`);
  return value;
}
function finite(member: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${member} must be finite.`);
  return value;
}
function margin(member: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${member} must be an integer.`);
  return value;
}

export interface GodotProgressControl extends GodotProgressBarControl {
  fill_mode: number;
  indeterminate: boolean;
  editor_preview_indeterminate: boolean;
  set_fill_mode(value: number): void;
  get_fill_mode(): number;
  set_show_percentage(value: boolean): void;
  is_percentage_shown(): boolean;
  set_indeterminate(value: boolean): void;
  is_indeterminate(): boolean;
  set_editor_preview_indeterminate(value: boolean): void;
  is_editor_preview_indeterminate_enabled(): boolean;
}

export function bindProgressControl(
  control: GodotControl,
  initial: Partial<RangeState> & {
    readonly show_percentage?: boolean;
    readonly fill_mode?: number;
    readonly indeterminate?: boolean;
    readonly editor_preview_indeterminate?: boolean;
  } = {},
): GodotProgressControl {
  const progress = bindProgressBar(control, initial) as GodotProgressControl;
  const binding = controlBinding(control);
  let fillMode = integer('ProgressBar.fill_mode', initial.fill_mode ?? 0, 0, 3);
  let indeterminate = bool('ProgressBar.indeterminate', initial.indeterminate ?? false);
  let editorPreview = bool('ProgressBar.editor_preview_indeterminate', initial.editor_preview_indeterminate ?? false);
  const sync = (): void => binding.state.write(binding.id, {
    progressFillMode: fillMode,
    progressIndeterminate: indeterminate,
  });
  Object.defineProperties(progress, {
    fill_mode: { enumerable: true, configurable: true, get: () => fillMode, set: (value: number) => { fillMode = integer('ProgressBar.fill_mode', value, 0, 3); sync(); } },
    indeterminate: { enumerable: true, configurable: true, get: () => indeterminate, set: (value: boolean) => { indeterminate = bool('ProgressBar.indeterminate', value); sync(); } },
    editor_preview_indeterminate: { enumerable: true, configurable: true, get: () => editorPreview, set: (value: boolean) => { editorPreview = bool('ProgressBar.editor_preview_indeterminate', value); } },
  });
  progress.set_fill_mode = (value): void => { progress.fill_mode = value; };
  progress.get_fill_mode = (): number => fillMode;
  progress.set_show_percentage = (value): void => { progress.show_percentage = value; };
  progress.is_percentage_shown = (): boolean => progress.show_percentage;
  progress.set_indeterminate = (value): void => { progress.indeterminate = value; };
  progress.is_indeterminate = (): boolean => indeterminate;
  progress.set_editor_preview_indeterminate = (value): void => { progress.editor_preview_indeterminate = value; };
  progress.is_editor_preview_indeterminate_enabled = (): boolean => editorPreview;
  sync();
  return progress;
}

export interface GodotTextureProgressBar extends GodotRangeControl {
  fill_mode: number;
  texture_under: string;
  texture_over: string;
  texture_progress: string;
  nine_patch_stretch: boolean;
  radial_initial_angle: number;
  radial_fill_degrees: number;
  radial_center_offset: { x: number; y: number };
  texture_progress_offset: { x: number; y: number };
  tint_under: ColorValue;
  tint_over: ColorValue;
  tint_progress: ColorValue;
  stretch_margin_left: number;
  stretch_margin_top: number;
  stretch_margin_right: number;
  stretch_margin_bottom: number;
  set_under_texture(value: string): void;
  get_under_texture(): string;
  set_over_texture(value: string): void;
  get_over_texture(): string;
  set_progress_texture(value: string): void;
  get_progress_texture(): string;
  set_nine_patch_stretch(value: boolean): void;
  get_nine_patch_stretch(): boolean;
  set_stretch_margin(margin: number, value: number): void;
  get_stretch_margin(margin: number): number;
  set_radial_initial_angle(value: number): void;
  get_radial_initial_angle(): number;
  set_fill_degrees(value: number): void;
  get_fill_degrees(): number;
  set_fill_mode(value: number): void;
  get_fill_mode(): number;
  set_radial_center_offset(value: { x: number; y: number }): void;
  get_radial_center_offset(): { x: number; y: number };
  set_texture_progress_offset(value: { x: number; y: number }): void;
  get_texture_progress_offset(): { x: number; y: number };
}

export function bindTextureProgressBar(
  control: GodotControl,
  initial: Partial<RangeState> & {
    readonly texture_under?: string;
    readonly texture_over?: string;
    readonly texture_progress?: string;
    readonly nine_patch_stretch?: boolean;
    readonly radial_initial_angle?: number;
    readonly radial_fill_degrees?: number;
    readonly radial_center_offset?: { readonly x: number; readonly y: number };
    readonly texture_progress_offset?: { readonly x: number; readonly y: number };
    readonly tint_under?: ColorValue;
    readonly tint_over?: ColorValue;
    readonly tint_progress?: ColorValue;
    readonly stretch_margin_left?: number;
    readonly stretch_margin_top?: number;
    readonly stretch_margin_right?: number;
    readonly stretch_margin_bottom?: number;
    readonly fill_mode?: number;
  } = {},
): GodotTextureProgressBar {
  const texture = bindHSlider(control, { ...initial, scrollable: false, editable: false }) as GodotTextureProgressBar;
  const binding = controlBinding(control);
  let under = initial.texture_under ?? '';
  let over = initial.texture_over ?? '';
  let progress = initial.texture_progress ?? '';
  let ninePatch = bool('TextureProgressBar.nine_patch_stretch', initial.nine_patch_stretch ?? false);
  if (ninePatch) throw new Error('TextureProgressBar.nine_patch_stretch requires native nine-slice texture rendering and is not approximated by the retained DOM image layers.');
  let fillMode = integer('TextureProgressBar.fill_mode', initial.fill_mode ?? 0, 0, 8);
  let radialInitial = ((finite('TextureProgressBar.radial_initial_angle', initial.radial_initial_angle ?? 0) % 360) + 360) % 360;
  let fillDegrees = Math.max(0, Math.min(360, finite('TextureProgressBar.radial_fill_degrees', initial.radial_fill_degrees ?? 360)));
  const point = (member: string, value: { readonly x: number; readonly y: number } | undefined): { x: number; y: number } => {
    const next = value ?? { x: 0, y: 0 };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) throw new TypeError(`${member} must be a finite Vector2.`);
    return { x: next.x, y: next.y };
  };
  const tint = (member: string, value: ColorValue | undefined): ColorValue => {
    const next = value ?? godotColor(1, 1, 1, 1);
    if (![next.r, next.g, next.b, next.a].every(Number.isFinite)) throw new TypeError(`${member} must be a finite Color.`);
    return copyColor(next);
  };
  let radialCenter = point('TextureProgressBar.radial_center_offset', initial.radial_center_offset);
  let progressOffset = point('TextureProgressBar.texture_progress_offset', initial.texture_progress_offset);
  let tintUnder = tint('TextureProgressBar.tint_under', initial.tint_under);
  let tintOver = tint('TextureProgressBar.tint_over', initial.tint_over);
  let tintProgress = tint('TextureProgressBar.tint_progress', initial.tint_progress);
  const margins = [
    margin('TextureProgressBar.stretch_margin_left', initial.stretch_margin_left ?? 0),
    margin('TextureProgressBar.stretch_margin_top', initial.stretch_margin_top ?? 0),
    margin('TextureProgressBar.stretch_margin_right', initial.stretch_margin_right ?? 0),
    margin('TextureProgressBar.stretch_margin_bottom', initial.stretch_margin_bottom ?? 0),
  ];
  const path = (member: string, value: string): string => { if (typeof value !== 'string') throw new TypeError(`${member} must be a retained texture URL.`); return value; };
  const sync = (): void => binding.state.write(binding.id, {
    textureProgressUnder: under,
    textureProgressOver: over,
    textureProgressValue: progress,
    progressFillMode: fillMode,
    textureProgressInitialAngle: radialInitial,
    textureProgressFillDegrees: fillDegrees,
    textureProgressCenterOffset: radialCenter,
    textureProgressOffset: progressOffset,
    textureProgressTintUnder: `#${colorToHtml(tintUnder)}`,
    textureProgressTintOver: `#${colorToHtml(tintOver)}`,
    textureProgressTintValue: `#${colorToHtml(tintProgress)}`,
  });
  Object.defineProperties(texture, {
    texture_under: { enumerable: true, configurable: true, get: () => under, set: (value: string) => { under = path('TextureProgressBar.texture_under', value); sync(); } },
    texture_over: { enumerable: true, configurable: true, get: () => over, set: (value: string) => { over = path('TextureProgressBar.texture_over', value); sync(); } },
    texture_progress: { enumerable: true, configurable: true, get: () => progress, set: (value: string) => { progress = path('TextureProgressBar.texture_progress', value); sync(); } },
    nine_patch_stretch: { enumerable: true, configurable: true, get: () => ninePatch, set: (value: boolean) => { const next = bool('TextureProgressBar.nine_patch_stretch', value); if (next) throw new Error('TextureProgressBar.nine_patch_stretch requires native nine-slice texture rendering.'); ninePatch = false; } },
    fill_mode: { enumerable: true, configurable: true, get: () => fillMode, set: (value: number) => { fillMode = integer('TextureProgressBar.fill_mode', value, 0, 8); sync(); } },
    radial_initial_angle: { enumerable: true, configurable: true, get: () => radialInitial, set: (value: number) => { radialInitial = ((finite('TextureProgressBar.radial_initial_angle', value) % 360) + 360) % 360; sync(); } },
    radial_fill_degrees: { enumerable: true, configurable: true, get: () => fillDegrees, set: (value: number) => { fillDegrees = Math.max(0, Math.min(360, finite('TextureProgressBar.radial_fill_degrees', value))); sync(); } },
    radial_center_offset: { enumerable: true, configurable: true, get: () => ({ ...radialCenter }), set: (value: { x: number; y: number }) => { radialCenter = point('TextureProgressBar.radial_center_offset', value); sync(); } },
    texture_progress_offset: { enumerable: true, configurable: true, get: () => ({ ...progressOffset }), set: (value: { x: number; y: number }) => { progressOffset = point('TextureProgressBar.texture_progress_offset', value); sync(); } },
    tint_under: { enumerable: true, configurable: true, get: () => copyColor(tintUnder), set: (value: ColorValue) => { tintUnder = tint('TextureProgressBar.tint_under', value); sync(); } },
    tint_over: { enumerable: true, configurable: true, get: () => copyColor(tintOver), set: (value: ColorValue) => { tintOver = tint('TextureProgressBar.tint_over', value); sync(); } },
    tint_progress: { enumerable: true, configurable: true, get: () => copyColor(tintProgress), set: (value: ColorValue) => { tintProgress = tint('TextureProgressBar.tint_progress', value); sync(); } },
    stretch_margin_left: { enumerable: true, configurable: true, get: () => margins[0], set: (value: number) => { margins[0] = margin('TextureProgressBar.stretch_margin_left', value); } },
    stretch_margin_top: { enumerable: true, configurable: true, get: () => margins[1], set: (value: number) => { margins[1] = margin('TextureProgressBar.stretch_margin_top', value); } },
    stretch_margin_right: { enumerable: true, configurable: true, get: () => margins[2], set: (value: number) => { margins[2] = margin('TextureProgressBar.stretch_margin_right', value); } },
    stretch_margin_bottom: { enumerable: true, configurable: true, get: () => margins[3], set: (value: number) => { margins[3] = margin('TextureProgressBar.stretch_margin_bottom', value); } },
  });
  const marginIndex = (value: number): number => integer('TextureProgressBar margin side', value, 0, 3);
  texture.set_under_texture = (value): void => { texture.texture_under = value; };
  texture.get_under_texture = (): string => under;
  texture.set_over_texture = (value): void => { texture.texture_over = value; };
  texture.get_over_texture = (): string => over;
  texture.set_progress_texture = (value): void => { texture.texture_progress = value; };
  texture.get_progress_texture = (): string => progress;
  texture.set_nine_patch_stretch = (value): void => { texture.nine_patch_stretch = value; };
  texture.get_nine_patch_stretch = (): boolean => ninePatch;
  texture.set_stretch_margin = (side, value): void => { margins[marginIndex(side)] = margin('TextureProgressBar stretch margin', value); };
  texture.get_stretch_margin = (margin): number => margins[marginIndex(margin)]!;
  texture.set_radial_initial_angle = (value): void => { texture.radial_initial_angle = value; };
  texture.get_radial_initial_angle = (): number => radialInitial;
  texture.set_fill_degrees = (value): void => { texture.radial_fill_degrees = value; };
  texture.get_fill_degrees = (): number => fillDegrees;
  texture.set_fill_mode = (value): void => { texture.fill_mode = value; };
  texture.get_fill_mode = (): number => fillMode;
  texture.set_radial_center_offset = (value): void => { texture.radial_center_offset = value; };
  texture.get_radial_center_offset = (): { x: number; y: number } => ({ ...radialCenter });
  texture.set_texture_progress_offset = (value): void => { texture.texture_progress_offset = value; };
  texture.get_texture_progress_offset = (): { x: number; y: number } => ({ ...progressOffset });
  sync();
  return texture;
}
