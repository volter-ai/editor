/** Structural extraction for retained Range, progress, and color controls. */

import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export interface ControlPointValue { readonly x: number; readonly y: number }
export interface ControlColorValue { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

export interface AuthoredRangeControlSpec {
  readonly className: string;
  readonly vertical: boolean;
  readonly progress: boolean;
  readonly textureProgress: boolean;
  readonly minValue: number;
  readonly maxValue: number;
  readonly step: number;
  readonly page: number;
  readonly value: number;
  readonly allowGreater: boolean;
  readonly allowLesser: boolean;
  readonly rounded: boolean;
  readonly expEdit: boolean;
  readonly editable: boolean;
  readonly scrollable: boolean;
  readonly tickCount: number;
  readonly ticksOnBorders: boolean;
  readonly ticksPosition: number;
  readonly customStep: number;
  readonly showPercentage: boolean;
  readonly fillMode: number;
  readonly indeterminate: boolean;
  readonly editorPreviewIndeterminate: boolean;
  readonly ninePatchStretch: boolean;
  readonly radialInitialAngle: number;
  readonly radialFillDegrees: number;
  readonly radialCenterOffset: ControlPointValue;
  readonly textureProgressOffset: ControlPointValue;
  readonly tintUnder: ControlColorValue;
  readonly tintOver: ControlColorValue;
  readonly tintProgress: ControlColorValue;
  readonly stretchMargins: readonly [number, number, number, number];
  readonly textureUnder: GodotValue | undefined;
  readonly textureOver: GodotValue | undefined;
  readonly textureProgressValue: GodotValue | undefined;
}

function number(props: Readonly<Record<string, GodotValue>>, key: string, fallback: number, at: string): number {
  const value = props[key];
  if (value === undefined) return fallback;
  if (value.kind !== 'number' || !Number.isFinite(value.value)) throw new TranslateError(at, `${key} must be a finite number.`);
  return value.value;
}

function integer(props: Readonly<Record<string, GodotValue>>, key: string, fallback: number, minimum: number, maximum: number, at: string): number {
  const value = number(props, key, fallback, at);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TranslateError(at, `${key} must be an integer from ${minimum} through ${maximum}.`);
  return value;
}

function boolean(props: Readonly<Record<string, GodotValue>>, key: string, fallback: boolean, at: string): boolean {
  const value = props[key];
  if (value === undefined) return fallback;
  if (value.kind !== 'bool') throw new TranslateError(at, `${key} must be bool.`);
  return value.value;
}

function point(props: Readonly<Record<string, GodotValue>>, key: string, at: string): ControlPointValue {
  const value = props[key];
  if (value === undefined) return { x: 0, y: 0 };
  if (value.kind !== 'ctor' || value.name !== 'Vector2' || value.args.length < 2 || value.args[0]?.kind !== 'number' || value.args[1]?.kind !== 'number' || !Number.isFinite(value.args[0].value) || !Number.isFinite(value.args[1].value)) {
    throw new TranslateError(at, `${key} must be a finite Vector2.`);
  }
  return { x: value.args[0].value, y: value.args[1].value };
}

function color(props: Readonly<Record<string, GodotValue>>, key: string, at: string): ControlColorValue {
  const value = props[key];
  if (value === undefined) return { r: 1, g: 1, b: 1, a: 1 };
  if (value.kind !== 'ctor' || value.name !== 'Color' || value.args.length < 3 || value.args.some((part) => part.kind !== 'number' || !Number.isFinite(part.value))) {
    throw new TranslateError(at, `${key} must be a finite Color.`);
  }
  return {
    r: (value.args[0] as { readonly kind: 'number'; readonly value: number }).value,
    g: (value.args[1] as { readonly kind: 'number'; readonly value: number }).value,
    b: (value.args[2] as { readonly kind: 'number'; readonly value: number }).value,
    a: value.args[3]?.kind === 'number' ? value.args[3].value : 1,
  };
}

export function readRangeControlSpec(
  props: Readonly<Record<string, GodotValue>>,
  className: string,
  major: 3 | 4,
  at: string,
): AuthoredRangeControlSpec {
  const progress = className === 'ProgressBar';
  const textureProgress = className === 'TextureProgressBar' || className === 'TextureProgress';
  const vertical = className === 'VSlider' || className === 'VScrollBar';
  const margin = (key: string): number => {
    const result = number(props, key, 0, at);
    if (!Number.isSafeInteger(result)) throw new TranslateError(at, `${key} must be an integer.`);
    return result;
  };
  return {
    className,
    vertical,
    progress,
    textureProgress,
    minValue: number(props, 'min_value', 0, at),
    maxValue: number(props, 'max_value', 100, at),
    step: number(props, 'step', 0.01, at),
    page: number(props, 'page', 0, at),
    value: number(props, 'value', 0, at),
    allowGreater: boolean(props, 'allow_greater', false, at),
    allowLesser: boolean(props, 'allow_lesser', false, at),
    rounded: boolean(props, 'rounded', false, at),
    expEdit: boolean(props, 'exp_edit', false, at),
    editable: progress || textureProgress ? false : boolean(props, 'editable', true, at),
    scrollable: progress || textureProgress ? false : boolean(props, 'scrollable', true, at),
    tickCount: progress || textureProgress ? 0 : integer(props, 'tick_count', 0, 0, Number.MAX_SAFE_INTEGER, at),
    ticksOnBorders: progress || textureProgress ? false : boolean(props, 'ticks_on_borders', false, at),
    ticksPosition: progress || textureProgress ? 0 : integer(props, 'ticks_position', 0, 0, 3, at),
    customStep: progress || textureProgress ? -1 : number(props, 'custom_step', -1, at),
    showPercentage: progress ? boolean(props, major === 3 ? 'percent_visible' : 'show_percentage', true, at) : false,
    fillMode: integer(props, 'fill_mode', 0, 0, textureProgress ? 8 : progress ? 3 : 0, at),
    indeterminate: progress ? boolean(props, 'indeterminate', false, at) : false,
    editorPreviewIndeterminate: progress ? boolean(props, 'editor_preview_indeterminate', false, at) : false,
    ninePatchStretch: textureProgress ? boolean(props, 'nine_patch_stretch', false, at) : false,
    radialInitialAngle: textureProgress ? number(props, 'radial_initial_angle', 0, at) : 0,
    radialFillDegrees: textureProgress ? number(props, 'radial_fill_degrees', 360, at) : 360,
    radialCenterOffset: textureProgress ? point(props, 'radial_center_offset', at) : { x: 0, y: 0 },
    textureProgressOffset: textureProgress ? point(props, 'texture_progress_offset', at) : { x: 0, y: 0 },
    tintUnder: textureProgress ? color(props, 'tint_under', at) : { r: 1, g: 1, b: 1, a: 1 },
    tintOver: textureProgress ? color(props, 'tint_over', at) : { r: 1, g: 1, b: 1, a: 1 },
    tintProgress: textureProgress ? color(props, 'tint_progress', at) : { r: 1, g: 1, b: 1, a: 1 },
    stretchMargins: textureProgress
      ? [margin('stretch_margin_left'), margin('stretch_margin_top'), margin('stretch_margin_right'), margin('stretch_margin_bottom')]
      : [0, 0, 0, 0],
    textureUnder: props['texture_under'],
    textureOver: props['texture_over'],
    textureProgressValue: props['texture_progress'],
  };
}

export interface AuthoredColorControlSpec {
  readonly color: ControlColorValue;
  readonly editAlpha: boolean;
  readonly deferredMode: boolean;
  readonly colorMode: number;
  readonly pickerShape: number;
  readonly editIntensity: boolean;
  readonly canAddSwatches: boolean;
  readonly colorizeSliders: boolean;
  readonly samplerVisible: boolean;
  readonly slidersVisible: boolean;
  readonly hexVisible: boolean;
  readonly presetsVisible: boolean;
  readonly modesVisible: boolean;
}

export function readColorControlSpec(props: Readonly<Record<string, GodotValue>>, className: string, at: string): AuthoredColorControlSpec {
  return {
    color: color(props, 'color', at),
    editAlpha: boolean(props, 'edit_alpha', true, at),
    deferredMode: className === 'ColorPicker' ? boolean(props, 'deferred_mode', false, at) : false,
    colorMode: className === 'ColorPicker' ? integer(props, 'color_mode', 0, 0, 3, at) : 0,
    pickerShape: className === 'ColorPicker' ? integer(props, 'picker_shape', 0, 0, 6, at) : 0,
    editIntensity: boolean(props, 'edit_intensity', false, at),
    canAddSwatches: className === 'ColorPicker' ? boolean(props, 'can_add_swatches', true, at) : true,
    colorizeSliders: className === 'ColorPicker' ? boolean(props, 'colorize_sliders', true, at) : true,
    samplerVisible: className === 'ColorPicker' ? boolean(props, 'sampler_visible', true, at) : true,
    slidersVisible: className === 'ColorPicker' ? boolean(props, 'sliders_visible', true, at) : true,
    hexVisible: className === 'ColorPicker' ? boolean(props, 'hex_visible', true, at) : true,
    presetsVisible: className === 'ColorPicker' ? boolean(props, 'presets_visible', true, at) : true,
    modesVisible: className === 'ColorPicker' ? boolean(props, 'color_modes_visible', boolean(props, 'modes_visible', true, at), at) : true,
  };
}
