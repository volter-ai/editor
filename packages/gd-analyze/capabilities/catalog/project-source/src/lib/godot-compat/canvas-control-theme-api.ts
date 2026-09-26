/** Godot Control theme properties and lookup/override methods seated on retained Pixi Controls. */

import { Container } from 'pixi.js';

import { GodotStyleBox } from './style-box';
import {
  GodotTheme,
  addControlColorOverride,
  addControlThemeColorOverride,
  addControlThemeConstantOverride,
  addControlThemeFontOverride,
  addControlThemeFontSizeOverride,
  addControlThemeIconOverride,
  addControlThemeStyleBoxOverride,
  getControlTheme,
  getControlThemeColor,
  getControlThemeConstant,
  getControlThemeDefaultBaseScale,
  getControlThemeFont,
  getControlThemeDefaultFont,
  getControlThemeDefaultFontSize,
  getControlThemeFontSize,
  getControlThemeIcon,
  getControlThemeStyleBox,
  getControlThemeTypeVariation,
  hasControlThemeColor,
  hasControlThemeColorOverride,
  hasControlThemeConstant,
  hasControlThemeConstantOverride,
  hasControlThemeFont,
  hasControlThemeFontOverride,
  hasControlThemeFontSize,
  hasControlThemeFontSizeOverride,
  hasControlThemeIcon,
  hasControlThemeIconOverride,
  hasControlThemeStyleBox,
  hasControlThemeStyleBoxOverride,
  removeControlThemeColorOverride,
  removeControlThemeConstantOverride,
  removeControlThemeFontOverride,
  removeControlThemeFontSizeOverride,
  removeControlThemeIconOverride,
  removeControlThemeStyleBoxOverride,
  setControlTheme,
  setControlThemeTypeVariation,
} from './theme';
import type { ColorValue } from './variant';

export interface GodotCanvasControlThemeApi {
  theme: GodotTheme | null;
  theme_type_variation: string;
  set_theme(value: GodotTheme | null): void;
  get_theme(): GodotTheme | null;
  set_theme_type_variation(value: string): void;
  get_theme_type_variation(): string;
  get_theme_default_base_scale(): number;
  get_theme_default_font(): unknown;
  get_theme_default_font_size(): number;
  add_theme_color_override(name: string, color: ColorValue): void;
  add_color_override(name: string, color: ColorValue): void;
  has_theme_color_override(name: string): boolean;
  remove_theme_color_override(name: string): void;
  add_theme_constant_override(name: string, constant: number): void;
  add_constant_override(name: string, constant: number): void;
  has_theme_constant_override(name: string): boolean;
  remove_theme_constant_override(name: string): void;
  add_theme_font_override(name: string, font: unknown): void;
  add_font_override(name: string, font: unknown): void;
  has_theme_font_override(name: string): boolean;
  remove_theme_font_override(name: string): void;
  add_theme_font_size_override(name: string, fontSize: number): void;
  has_theme_font_size_override(name: string): boolean;
  remove_theme_font_size_override(name: string): void;
  add_theme_icon_override(name: string, icon: unknown): void;
  add_icon_override(name: string, icon: unknown): void;
  has_theme_icon_override(name: string): boolean;
  remove_theme_icon_override(name: string): void;
  add_theme_stylebox_override(name: string, styleBox: GodotStyleBox | null): void;
  add_stylebox_override(name: string, styleBox: GodotStyleBox | null): void;
  has_theme_stylebox_override(name: string): boolean;
  remove_theme_stylebox_override(name: string): void;
  get_theme_color(name: string, themeType?: string): ColorValue;
  has_theme_color(name: string, themeType?: string): boolean;
  get_theme_constant(name: string, themeType?: string): number;
  has_theme_constant(name: string, themeType?: string): boolean;
  get_theme_font(name: string, themeType?: string): unknown;
  has_theme_font(name: string, themeType?: string): boolean;
  get_theme_font_size(name: string, themeType?: string): number;
  has_theme_font_size(name: string, themeType?: string): boolean;
  get_theme_icon(name: string, themeType?: string): unknown;
  has_theme_icon(name: string, themeType?: string): boolean;
  get_theme_stylebox(name: string, themeType?: string): GodotStyleBox;
  has_theme_stylebox(name: string, themeType?: string): boolean;
}

/** Install the native Control theme vocabulary once while preserving the Pixi object identity. */
export function bindGodotCanvasControlThemeApi<T extends Container>(
  source: T,
): T & GodotCanvasControlThemeApi {
  const control = source as T & GodotCanvasControlThemeApi;
  Object.defineProperties(control, {
    theme: {
      configurable: true,
      enumerable: true,
      get: (): GodotTheme | null => getControlTheme(control),
      set: (value: GodotTheme | null): void => setControlTheme(control, value),
    },
    theme_type_variation: {
      configurable: true,
      enumerable: true,
      get: (): string => getControlThemeTypeVariation(control),
      set: (value: string): void => setControlThemeTypeVariation(control, value),
    },
  });
  Object.assign(control, {
    set_theme: (value: GodotTheme | null): void => setControlTheme(control, value),
    get_theme: (): GodotTheme | null => getControlTheme(control),
    set_theme_type_variation: (value: string): void => setControlThemeTypeVariation(control, value),
    get_theme_type_variation: (): string => getControlThemeTypeVariation(control),
    get_theme_default_base_scale: (): number => getControlThemeDefaultBaseScale(control),
    get_theme_default_font: (): unknown => getControlThemeDefaultFont(control),
    get_theme_default_font_size: (): number => getControlThemeDefaultFontSize(control),
    add_theme_color_override: (name: string, value: ColorValue): void => addControlThemeColorOverride(control, name, value),
    add_color_override: (name: string, value: ColorValue): void => addControlColorOverride(control, name, value),
    has_theme_color_override: (name: string): boolean => hasControlThemeColorOverride(control, name),
    remove_theme_color_override: (name: string): void => removeControlThemeColorOverride(control, name),
    add_theme_constant_override: (name: string, value: number): void => addControlThemeConstantOverride(control, name, value),
    add_constant_override: (name: string, value: number): void => addControlThemeConstantOverride(control, name, value),
    has_theme_constant_override: (name: string): boolean => hasControlThemeConstantOverride(control, name),
    remove_theme_constant_override: (name: string): void => removeControlThemeConstantOverride(control, name),
    add_theme_font_override: (name: string, value: unknown): void => addControlThemeFontOverride(control, name, value),
    add_font_override: (name: string, value: unknown): void => addControlThemeFontOverride(control, name, value),
    has_theme_font_override: (name: string): boolean => hasControlThemeFontOverride(control, name),
    remove_theme_font_override: (name: string): void => removeControlThemeFontOverride(control, name),
    add_theme_font_size_override: (name: string, value: number): void => addControlThemeFontSizeOverride(control, name, value),
    has_theme_font_size_override: (name: string): boolean => hasControlThemeFontSizeOverride(control, name),
    remove_theme_font_size_override: (name: string): void => removeControlThemeFontSizeOverride(control, name),
    add_theme_icon_override: (name: string, value: unknown): void => addControlThemeIconOverride(control, name, value),
    add_icon_override: (name: string, value: unknown): void => addControlThemeIconOverride(control, name, value),
    has_theme_icon_override: (name: string): boolean => hasControlThemeIconOverride(control, name),
    remove_theme_icon_override: (name: string): void => removeControlThemeIconOverride(control, name),
    add_theme_stylebox_override: (name: string, value: GodotStyleBox | null): void => addControlThemeStyleBoxOverride(control, name, value),
    add_stylebox_override: (name: string, value: GodotStyleBox | null): void => addControlThemeStyleBoxOverride(control, name, value),
    has_theme_stylebox_override: (name: string): boolean => hasControlThemeStyleBoxOverride(control, name),
    remove_theme_stylebox_override: (name: string): void => removeControlThemeStyleBoxOverride(control, name),
    get_theme_color: (name: string, themeType = ''): ColorValue => getControlThemeColor(control, name, themeType),
    has_theme_color: (name: string, themeType = ''): boolean => hasControlThemeColor(control, name, themeType),
    get_theme_constant: (name: string, themeType = ''): number => getControlThemeConstant(control, name, themeType),
    has_theme_constant: (name: string, themeType = ''): boolean => hasControlThemeConstant(control, name, themeType),
    get_theme_font: (name: string, themeType = ''): unknown => getControlThemeFont(control, name, themeType),
    has_theme_font: (name: string, themeType = ''): boolean => hasControlThemeFont(control, name, themeType),
    get_theme_font_size: (name: string, themeType = ''): number => getControlThemeFontSize(control, name, themeType),
    has_theme_font_size: (name: string, themeType = ''): boolean => hasControlThemeFontSize(control, name, themeType),
    get_theme_icon: (name: string, themeType = ''): unknown => getControlThemeIcon(control, name, themeType),
    has_theme_icon: (name: string, themeType = ''): boolean => hasControlThemeIcon(control, name, themeType),
    get_theme_stylebox: (name: string, themeType = ''): GodotStyleBox => getControlThemeStyleBox(control, name, themeType),
    has_theme_stylebox: (name: string, themeType = ''): boolean => hasControlThemeStyleBox(control, name, themeType),
  });
  return control;
}
