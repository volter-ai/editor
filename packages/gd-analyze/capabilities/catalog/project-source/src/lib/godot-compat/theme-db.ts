/** Retained ThemeDB singleton and its process-wide fallback resources. */

import { godotResourceChangedSignal } from './resource-io';
import { createSignal, type GodotConnection, type GodotSignal } from './signal';
import { GodotStyleBox } from './style-box';
import { createTheme, getGodotThemeDbFallbackFont, GodotTheme } from './theme';

function finitePositive(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`ThemeDB.${member} requires a positive finite number.`);
  }
  return value;
}

function positiveInt(value: unknown, member: string): number {
  const result = finitePositive(value, member);
  if (!Number.isSafeInteger(result)) throw new TypeError(`ThemeDB.${member} requires an integer.`);
  return result;
}

function resource(value: unknown, member: string, nullable = false): unknown {
  if (nullable && value === null) return null;
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError(`ThemeDB.${member} requires a Resource${nullable ? ' or null' : ''}.`);
  }
  return value;
}

class GodotThemeDBRuntime {
  private readonly changed = createSignal<[]>();
  private readonly defaultTheme = createTheme();
  private projectTheme: GodotTheme | null = null;
  private projectThemeConnection: GodotConnection | null = null;
  private fallbackBaseScaleValue = 1;
  private fallbackFontValue: unknown = getGodotThemeDbFallbackFont();
  private fallbackFontSizeValue = 16;
  private fallbackIconValue: unknown = null;
  private fallbackStyleboxValue: GodotStyleBox = new GodotStyleBox();

  constructor() {
    godotResourceChangedSignal(this.defaultTheme).connect(() => this.changed.emit());
  }

  readonly fallback_changed: GodotSignal<[]> = this.changed.signal;

  get fallback_base_scale(): number { return this.fallbackBaseScaleValue; }
  set fallback_base_scale(value: number) { this.set_fallback_base_scale(value); }
  get fallback_font(): unknown { return this.fallbackFontValue; }
  set fallback_font(value: unknown) { this.set_fallback_font(value); }
  get fallback_font_size(): number { return this.fallbackFontSizeValue; }
  set fallback_font_size(value: number) { this.set_fallback_font_size(value); }
  get fallback_icon(): unknown { return this.fallbackIconValue; }
  set fallback_icon(value: unknown) { this.set_fallback_icon(value); }
  get fallback_stylebox(): GodotStyleBox { return this.fallbackStyleboxValue; }
  set fallback_stylebox(value: GodotStyleBox) { this.set_fallback_stylebox(value); }

  get_default_theme(): GodotTheme { return this.defaultTheme; }
  get_project_theme(): GodotTheme | null { return this.projectTheme; }

  set_project_theme(value: GodotTheme | null): void {
    if (value !== null && !(value instanceof GodotTheme)) {
      throw new TypeError('ThemeDB.set_project_theme requires Theme or null.');
    }
    if (value === this.projectTheme) return;
    this.projectThemeConnection?.disconnect();
    this.projectTheme = value;
    this.projectThemeConnection = value === null
      ? null
      : godotResourceChangedSignal(value).connect(() => this.changed.emit());
    this.changed.emit();
  }

  set_fallback_base_scale(value: unknown): void {
    const next = finitePositive(value, 'set_fallback_base_scale');
    if (next === this.fallbackBaseScaleValue) return;
    this.fallbackBaseScaleValue = next;
    this.changed.emit();
  }

  get_fallback_base_scale(): number { return this.fallbackBaseScaleValue; }

  set_fallback_font(value: unknown): void {
    const next = resource(value, 'set_fallback_font');
    if (next === this.fallbackFontValue) return;
    this.fallbackFontValue = next;
    this.changed.emit();
  }

  get_fallback_font(): unknown { return this.fallbackFontValue; }

  set_fallback_font_size(value: unknown): void {
    const next = positiveInt(value, 'set_fallback_font_size');
    if (next === this.fallbackFontSizeValue) return;
    this.fallbackFontSizeValue = next;
    this.changed.emit();
  }

  get_fallback_font_size(): number { return this.fallbackFontSizeValue; }

  set_fallback_icon(value: unknown): void {
    const next = resource(value, 'set_fallback_icon', true);
    if (next === this.fallbackIconValue) return;
    this.fallbackIconValue = next;
    this.changed.emit();
  }

  get_fallback_icon(): unknown { return this.fallbackIconValue; }

  set_fallback_stylebox(value: GodotStyleBox): void {
    if (!(value instanceof GodotStyleBox)) {
      throw new TypeError('ThemeDB.set_fallback_stylebox requires StyleBox.');
    }
    if (value === this.fallbackStyleboxValue) return;
    this.fallbackStyleboxValue = value;
    this.changed.emit();
  }

  get_fallback_stylebox(): GodotStyleBox { return this.fallbackStyleboxValue; }
}

export const GodotThemeDB = new GodotThemeDBRuntime();
export type GodotThemeDb = typeof GodotThemeDB;
export const GODOT_THEME_DB: GodotThemeDb = GodotThemeDB;
