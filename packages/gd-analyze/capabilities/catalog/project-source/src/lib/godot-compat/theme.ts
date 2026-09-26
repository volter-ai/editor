/**
 * Direct Theme item-map transcription from Godot 3.6/4.7 scene/resources/theme.cpp. Resource
 * parsing stays outside; this owns retained lookup, null-item precedence, and renderer invalidation.
 */

import type { ColorValue } from './variant';
import { Texture, type Graphics, type NineSliceSprite, type Text } from 'pixi.js';
import {
  drawStyleBoxPixi,
  createStyleBoxEmpty,
  GodotStyleBox,
  GodotStyleBoxTexture,
  styleBoxCss,
  type GodotStyleBoxCss,
} from './style-box';
import { godotObjectGetClass, godotObjectIsClass, registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedStringArray } from './packed-array';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { GodotConnection } from './signal';
import {
  createGodotSystemFont,
  godotFontOutlinePresentation,
  type GodotFontOutlinePresentation,
  type GodotSystemFont,
} from './font';
import { optionalControlBinding } from './control-state';

export const THEME_DATA_TYPE_COLOR = 0;
export const THEME_DATA_TYPE_CONSTANT = 1;
export const THEME_DATA_TYPE_FONT = 2;
export const THEME_DATA_TYPE_FONT_SIZE = 3;
export const THEME_DATA_TYPE_ICON = 4;
export const THEME_DATA_TYPE_STYLEBOX = 5;

const CONTROL_NATIVE_DEFAULT_FONTS = new WeakMap<
  object,
  { readonly family: string; readonly font: GodotSystemFont }
>();
let THEME_DB_FALLBACK_FONT: GodotSystemFont | undefined;
let THEME_DB_FALLBACK_STYLEBOX: GodotStyleBox | undefined;
let THEME_DB_DEFAULT_THEME: GodotTheme | undefined;
let THEME_DB_PROJECT_THEME: GodotTheme | null = null;

/** ThemeDB's engine fallback is the same browser-native system font rendered by unthemed UI. */
export function getGodotThemeDbFallbackFont(): GodotSystemFont {
  THEME_DB_FALLBACK_FONT ??= createGodotSystemFont(['sans-serif']);
  return THEME_DB_FALLBACK_FONT;
}

/** ThemeDB fallback base scale matches Godot's engine-owned unscaled UI default. */
export function getGodotThemeDbFallbackBaseScale(): number {
  return 1;
}

/** ThemeDB fallback font size used by unthemed browser-native text controls. */
export function getGodotThemeDbFallbackFontSize(): number {
  return 16;
}

/** Stable empty fallback icon preserving Texture2D identity for missing theme icons. */
export function getGodotThemeDbFallbackIcon(): Texture {
  return Texture.EMPTY;
}

/** Stable empty StyleBox used when a control has no installed theme style. */
export function getGodotThemeDbFallbackStylebox(): GodotStyleBox {
  THEME_DB_FALLBACK_STYLEBOX ??= createStyleBoxEmpty();
  return THEME_DB_FALLBACK_STYLEBOX;
}

/** Engine default theme resource; item fallback continues through Theme lookup semantics. */
export function getGodotThemeDbDefaultTheme(): GodotTheme {
  THEME_DB_DEFAULT_THEME ??= new GodotTheme();
  return THEME_DB_DEFAULT_THEME;
}

/** Project theme installed at the singleton boundary, null when the project does not override it. */
export function getGodotThemeDbProjectTheme(): GodotTheme | null {
  return THEME_DB_PROJECT_THEME;
}

export function setGodotThemeDbProjectTheme(theme: GodotTheme | null): void {
  if (theme !== null && !(theme instanceof GodotTheme)) throw new TypeError('ThemeDB.project_theme requires Theme or null.');
  THEME_DB_PROJECT_THEME = theme;
  refreshActiveControlThemes();
}

type ItemMap<T> = Map<string, Map<string, T>>;

export interface GodotThemeItem<T> {
  readonly name: string;
  readonly themeType: string;
  readonly value: T;
}

export interface GodotThemeSeed {
  readonly defaultBaseScale?: number;
  readonly defaultFont?: unknown;
  readonly defaultFontSize?: number;
  readonly icons?: readonly GodotThemeItem<unknown>[];
  readonly styleboxes?: readonly GodotThemeItem<GodotStyleBox | null>[];
  readonly fonts?: readonly GodotThemeItem<unknown>[];
  readonly fontSizes?: readonly GodotThemeItem<number>[];
  readonly colors?: readonly GodotThemeItem<ColorValue>[];
  readonly constants?: readonly GodotThemeItem<number>[];
  readonly typeVariations?: readonly {
    readonly themeType: string;
    readonly baseType: string;
  }[];
}

function validItemName(name: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(name);
}

function validTypeName(name: string): boolean {
  return /^[A-Za-z0-9_]*$/.test(name);
}

function requireName(name: string, kind: 'item' | 'type'): void {
  const valid = kind === 'item' ? validItemName(name) : validTypeName(name);
  if (!valid) throw new Error(`godot-compat: invalid Theme ${kind} name ${name}.`);
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`godot-compat: Theme.${member} must be finite.`);
  return value;
}

function integer(value: number, member: string): number {
  const result = finite(value, member);
  if (!Number.isInteger(result) || result < -2147483648 || result > 2147483647) {
    throw new RangeError(`godot-compat: Theme.${member} must be a signed 32-bit integer.`);
  }
  return result;
}

function colorValue(value: ColorValue, member: string): ColorValue {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`godot-compat: Theme.${member} must be a Color.`);
  }
  return {
    r: finite(value.r, `${member}.r`),
    g: finite(value.g, `${member}.g`),
    b: finite(value.b, `${member}.b`),
    a: finite(value.a, `${member}.a`),
  };
}

function hasClass(value: unknown, className: string, major: 3 | 4): boolean {
  try {
    return godotObjectIsClass(value, className, major);
  } catch {
    return false;
  }
}

function requireFont(value: unknown, member: string, nullable = false): unknown {
  if (value === null && nullable) return null;
  if (
    (typeof value !== 'object' && typeof value !== 'function') || value === null ||
    (!hasClass(value, 'Font', 3) && !hasClass(value, 'Font', 4))
  ) {
    throw new TypeError(`godot-compat: Theme.${member} must be a Font Resource${nullable ? ' or null' : ''}.`);
  }
  return value;
}

function requireIcon(value: unknown, member: string, nullable = false): unknown {
  if (value === null && nullable) return null;
  if (
    (typeof value !== 'object' && typeof value !== 'function') || value === null ||
    (!hasClass(value, 'Texture', 3) && !hasClass(value, 'Texture2D', 4))
  ) {
    throw new TypeError(`godot-compat: Theme.${member} must be a Texture Resource${nullable ? ' or null' : ''}.`);
  }
  return value;
}

function requireStyleBox(value: unknown, member: string, nullable = false): GodotStyleBox | null {
  if (value === null && nullable) return null;
  if (!(value instanceof GodotStyleBox)) {
    throw new TypeError(`godot-compat: Theme.${member} must be a StyleBox Resource${nullable ? ' or null' : ''}.`);
  }
  return value;
}

function typeMap<T>(map: ItemMap<T>, themeType: string): Map<string, T> {
  let values = map.get(themeType);
  if (values === undefined) {
    values = new Map();
    map.set(themeType, values);
  }
  return values;
}

function setItem<T>(map: ItemMap<T>, name: string, themeType: string, value: T): void {
  requireName(name, 'item');
  requireName(themeType, 'type');
  typeMap(map, themeType).set(name, value);
}

function getItem<T>(map: ItemMap<T>, name: string, themeType: string): T | undefined {
  return map.get(themeType)?.get(name);
}

function hasItem<T>(map: ItemMap<T>, name: string, themeType: string): boolean {
  return map.get(themeType)?.has(name) === true;
}

function clearItem<T>(map: ItemMap<T>, name: string, themeType: string): void {
  const values = map.get(themeType);
  if (values === undefined || !values.has(name)) {
    throw new Error(`godot-compat: Theme ${themeType}.${name} does not exist.`);
  }
  values.delete(name);
  if (values?.size === 0) map.delete(themeType);
}

function renameItem<T>(
  map: ItemMap<T>,
  oldName: string,
  name: string,
  themeType: string,
): void {
  requireName(name, 'item');
  const values = map.get(themeType);
  if (values === undefined || !values.has(oldName)) {
    throw new Error(`godot-compat: Theme ${themeType}.${oldName} does not exist.`);
  }
  if (values.has(name)) throw new Error(`godot-compat: Theme ${themeType}.${name} already exists.`);
  values.set(name, values.get(oldName) as T);
  values.delete(oldName);
}

export class GodotTheme {
  private defaultBaseScaleValue = 0;
  private defaultFontValue: unknown = null;
  private defaultFontSizeValue = -1;
  private resourceConnections: GodotConnection[] = [];

  readonly icons: ItemMap<unknown> = new Map();
  readonly styleboxes: ItemMap<GodotStyleBox | null> = new Map();
  readonly fonts: ItemMap<unknown> = new Map();
  readonly fontSizes: ItemMap<number> = new Map();
  readonly colors: ItemMap<ColorValue> = new Map();
  readonly constants: ItemMap<number> = new Map();
  readonly typeVariations = new Map<string, string>();

  constructor() {
    registerGodotObjectIdentity(this, 'Theme');
    bindGodotResourceProtocol<GodotTheme>(this, {
      createDuplicate: (source) => {
        const copy = new GodotTheme();
        copy.copyStateFrom(source);
        return copy;
      },
      populateDuplicate: (source, target, subresources, memo) => {
        if (!subresources) return;
        target.defaultFontValue = duplicateGodotSubresource(source.defaultFontValue, memo);
        for (const [sourceMap, targetMap] of [
          [source.icons, target.icons],
          [source.styleboxes, target.styleboxes],
          [source.fonts, target.fonts],
        ] as const) {
          targetMap.clear();
          for (const [themeType, items] of sourceMap) {
            const duplicated = new Map<string, unknown>();
            for (const [name, value] of items) {
              duplicated.set(name, duplicateGodotSubresource(value, memo));
            }
            (targetMap as ItemMap<unknown>).set(themeType, duplicated);
          }
        }
        target.refreshResourceConnections();
      },
    });
  }

  get defaultBaseScale(): number { return this.defaultBaseScaleValue; }
  set defaultBaseScale(value: number) { this.setDefaultBaseScale(value); }
  get defaultFont(): unknown { return this.defaultFontValue; }
  set defaultFont(value: unknown) { this.setDefaultFont(value); }
  get defaultFontSize(): number { return this.defaultFontSizeValue; }
  set defaultFontSize(value: number) { this.setDefaultFontSize(value); }

  private resourceValues(): Set<object> {
    const resources = new Set<object>();
    const retain = (value: unknown): void => {
      if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
        resources.add(value as object);
      }
    };
    retain(this.defaultFontValue);
    for (const map of [this.icons, this.styleboxes, this.fonts] as const) {
      for (const items of map.values()) for (const value of items.values()) retain(value);
    }
    return resources;
  }

  private refreshResourceConnections(): void {
    for (const connection of this.resourceConnections) connection.disconnect();
    this.resourceConnections = [...this.resourceValues()].map((resource) =>
      godotResourceChangedSignal(resource).connect(() => godotResourceEmitChanged(this)));
  }

  private mutate(change: () => void): void {
    change();
    this.refreshResourceConnections();
    godotResourceEmitChanged(this);
  }

  private copyStateFrom(source: GodotTheme): void {
    this.defaultBaseScaleValue = source.defaultBaseScaleValue;
    this.defaultFontValue = source.defaultFontValue;
    this.defaultFontSizeValue = source.defaultFontSizeValue;
    for (const [sourceMap, targetMap] of [
      [source.icons, this.icons],
      [source.styleboxes, this.styleboxes],
      [source.fonts, this.fonts],
      [source.fontSizes, this.fontSizes],
      [source.constants, this.constants],
    ] as const) {
      targetMap.clear();
      for (const [themeType, items] of sourceMap) {
        (targetMap as ItemMap<unknown>).set(themeType, new Map(items));
      }
    }
    this.colors.clear();
    for (const [themeType, items] of source.colors) {
      this.colors.set(themeType, new Map(
        [...items].map(([name, value]) => [name, { ...value }]),
      ));
    }
    this.typeVariations.clear();
    for (const [themeType, baseType] of source.typeVariations) {
      this.typeVariations.set(themeType, baseType);
    }
    this.refreshResourceConnections();
  }

  setDefaultBaseScale(value: number): void {
    const normalized = finite(value, 'default_base_scale');
    if (normalized < 0) {
      throw new RangeError('godot-compat: Theme.default_base_scale must be non-negative.');
    }
    if (normalized === this.defaultBaseScaleValue) return;
    this.mutate(() => { this.defaultBaseScaleValue = normalized; });
  }

  getDefaultBaseScale(): number {
    return this.defaultBaseScale;
  }

  hasDefaultBaseScale(): boolean {
    return this.defaultBaseScale > 0;
  }

  setDefaultFont(font: unknown): void {
    const normalized = requireFont(font, 'default_font', true);
    if (normalized === this.defaultFontValue) return;
    this.mutate(() => { this.defaultFontValue = normalized; });
  }

  getDefaultFont(): unknown {
    return this.defaultFont;
  }

  hasDefaultFont(): boolean {
    return this.defaultFont !== null && this.defaultFont !== undefined;
  }

  setDefaultFontSize(size: number): void {
    const normalized = integer(size, 'default_font_size');
    if (normalized === this.defaultFontSizeValue) return;
    this.mutate(() => { this.defaultFontSizeValue = normalized; });
  }

  getDefaultFontSize(): number {
    return this.defaultFontSize;
  }

  hasDefaultFontSize(): boolean {
    return this.defaultFontSize > 0;
  }

  setStyleBox(name: string, themeType: string, styleBox: GodotStyleBox | null): void {
    const normalized = requireStyleBox(styleBox, 'set_stylebox value', true);
    this.mutate(() => { setItem(this.styleboxes, name, themeType, normalized); });
  }

  getStyleBox(name: string, themeType: string): GodotStyleBox {
    const style = getItem(this.styleboxes, name, themeType);
    return style ?? getGodotThemeDbFallbackStylebox();
  }

  hasStyleBox(name: string, themeType: string): boolean {
    const style = getItem(this.styleboxes, name, themeType);
    return style !== null && style !== undefined;
  }

  clearStyleBox(name: string, themeType: string): void {
    this.mutate(() => { clearItem(this.styleboxes, name, themeType); });
  }

  renameStyleBox(oldName: string, name: string, themeType: string): void {
    this.mutate(() => { renameItem(this.styleboxes, oldName, name, themeType); });
  }

  getStyleBoxList(themeType: string): PackedStringArray {
    return packedStringArray([...(this.styleboxes.get(themeType)?.keys() ?? [])].sort());
  }

  setIcon(name: string, themeType: string, icon: unknown): void {
    const normalized = requireIcon(icon, 'set_icon value', true);
    this.mutate(() => { setItem(this.icons, name, themeType, normalized); });
  }

  getIcon(name: string, themeType: string): unknown {
    const icon = getItem(this.icons, name, themeType);
    return icon === null || icon === undefined ? getGodotThemeDbFallbackIcon() : icon;
  }

  hasIcon(name: string, themeType: string): boolean {
    const icon = getItem(this.icons, name, themeType);
    return icon !== null && icon !== undefined;
  }

  clearIcon(name: string, themeType: string): void {
    this.mutate(() => { clearItem(this.icons, name, themeType); });
  }

  renameIcon(oldName: string, name: string, themeType: string): void {
    this.mutate(() => { renameItem(this.icons, oldName, name, themeType); });
  }

  getIconList(themeType: string): PackedStringArray {
    return packedStringArray([...(this.icons.get(themeType)?.keys() ?? [])].sort());
  }

  setFont(name: string, themeType: string, font: unknown): void {
    const normalized = requireFont(font, 'set_font value', true);
    this.mutate(() => { setItem(this.fonts, name, themeType, normalized); });
  }

  getFont(name: string, themeType: string): unknown {
    const font = getItem(this.fonts, name, themeType);
    if (font !== null && font !== undefined) return font;
    if (this.hasDefaultFont()) return this.defaultFont;
    return getGodotThemeDbFallbackFont();
  }

  hasFont(name: string, themeType: string): boolean {
    const font = getItem(this.fonts, name, themeType);
    return (font !== null && font !== undefined) || this.hasDefaultFont();
  }

  clearFont(name: string, themeType: string): void {
    this.mutate(() => { clearItem(this.fonts, name, themeType); });
  }

  renameFont(oldName: string, name: string, themeType: string): void {
    this.mutate(() => { renameItem(this.fonts, oldName, name, themeType); });
  }

  getFontList(themeType: string): PackedStringArray {
    return packedStringArray([...(this.fonts.get(themeType)?.keys() ?? [])].sort());
  }

  setColor(name: string, themeType: string, color: ColorValue): void {
    const normalized = colorValue(color, 'set_color value');
    this.mutate(() => { setItem(this.colors, name, themeType, normalized); });
  }

  getColor(name: string, themeType: string): ColorValue {
    const color = getItem(this.colors, name, themeType) ?? { r: 0, g: 0, b: 0, a: 1 };
    return { ...color };
  }

  hasColor(name: string, themeType: string): boolean {
    return hasItem(this.colors, name, themeType);
  }

  clearColor(name: string, themeType: string): void {
    this.mutate(() => { clearItem(this.colors, name, themeType); });
  }

  renameColor(oldName: string, name: string, themeType: string): void {
    this.mutate(() => { renameItem(this.colors, oldName, name, themeType); });
  }

  getColorList(themeType: string): PackedStringArray {
    return packedStringArray([...(this.colors.get(themeType)?.keys() ?? [])].sort());
  }

  setConstant(name: string, themeType: string, value: number): void {
    const normalized = integer(value, 'set_constant value');
    this.mutate(() => { setItem(this.constants, name, themeType, normalized); });
  }

  getConstant(name: string, themeType: string): number {
    return getItem(this.constants, name, themeType) ?? 0;
  }

  hasConstant(name: string, themeType: string): boolean {
    return hasItem(this.constants, name, themeType);
  }

  clearConstant(name: string, themeType: string): void {
    this.mutate(() => { clearItem(this.constants, name, themeType); });
  }

  renameConstant(oldName: string, name: string, themeType: string): void {
    this.mutate(() => { renameItem(this.constants, oldName, name, themeType); });
  }

  getConstantList(themeType: string): PackedStringArray {
    return packedStringArray([...(this.constants.get(themeType)?.keys() ?? [])].sort());
  }

  setFontSize(name: string, themeType: string, size: number): void {
    const normalized = integer(size, 'set_font_size value');
    this.mutate(() => { setItem(this.fontSizes, name, themeType, normalized); });
  }

  getFontSize(name: string, themeType: string): number {
    const size = getItem(this.fontSizes, name, themeType);
    if (size !== undefined && size > 0) return size;
    if (this.hasDefaultFontSize()) return this.defaultFontSize;
    throw new Error(
      `godot-compat: ThemeDB fallback font size for ${themeType}.${name} is not installed.`,
    );
  }

  hasFontSize(name: string, themeType: string): boolean {
    const size = getItem(this.fontSizes, name, themeType);
    return (size !== undefined && size > 0) || this.hasDefaultFontSize();
  }

  clearFontSize(name: string, themeType: string): void {
    this.mutate(() => { clearItem(this.fontSizes, name, themeType); });
  }

  renameFontSize(oldName: string, name: string, themeType: string): void {
    this.mutate(() => { renameItem(this.fontSizes, oldName, name, themeType); });
  }

  getFontSizeList(themeType: string): PackedStringArray {
    return packedStringArray([...(this.fontSizes.get(themeType)?.keys() ?? [])].sort());
  }

  setTypeVariation(themeType: string, baseType: string): void {
    requireName(themeType, 'type');
    requireName(baseType, 'type');
    if (themeType.length === 0 || baseType.length === 0) {
      throw new Error('godot-compat: Theme type variation and base names must be non-empty.');
    }
    if (themeType === baseType) {
      throw new Error('godot-compat: Theme type variation cannot inherit from itself.');
    }
    this.mutate(() => { this.typeVariations.set(themeType, baseType); });
  }

  isTypeVariation(themeType: string, baseType: string): boolean {
    return this.typeVariations.get(themeType) === baseType;
  }

  clearTypeVariation(themeType: string): void {
    if (!this.typeVariations.has(themeType)) {
      throw new Error(`godot-compat: Theme type variation ${themeType} does not exist.`);
    }
    this.mutate(() => { this.typeVariations.delete(themeType); });
  }

  getTypeVariationBase(themeType: string): string {
    return this.typeVariations.get(themeType) ?? '';
  }

  getTypeVariationList(baseType: string): PackedStringArray {
    const result: string[] = [];
    const seen = new Set<string>();
    const visit = (base: string): void => {
      for (const [variation, inherited] of this.typeVariations) {
        if (inherited !== base || seen.has(variation)) continue;
        seen.add(variation);
        result.push(variation);
        visit(variation);
      }
    };
    visit(baseType);
    return packedStringArray(result);
  }

  private itemTypeList(map: ItemMap<unknown>): PackedStringArray {
    return packedStringArray([...map.keys()].sort());
  }

  getIconTypeList(): PackedStringArray { return this.itemTypeList(this.icons); }
  getStyleBoxTypeList(): PackedStringArray {
    return this.itemTypeList(this.styleboxes as ItemMap<unknown>);
  }
  getFontTypeList(): PackedStringArray { return this.itemTypeList(this.fonts); }
  getFontSizeTypeList(): PackedStringArray {
    return this.itemTypeList(this.fontSizes as ItemMap<unknown>);
  }
  getColorTypeList(): PackedStringArray {
    return this.itemTypeList(this.colors as ItemMap<unknown>);
  }
  getConstantTypeList(): PackedStringArray {
    return this.itemTypeList(this.constants as ItemMap<unknown>);
  }

  getIconTypes(): PackedStringArray { return this.getIconTypeList(); }
  getStyleBoxTypes(): PackedStringArray { return this.getStyleBoxTypeList(); }
  getFontTypes(): PackedStringArray { return this.getFontTypeList(); }
  getFontSizeTypes(): PackedStringArray { return this.getFontSizeTypeList(); }
  getColorTypes(): PackedStringArray { return this.getColorTypeList(); }
  getConstantTypes(): PackedStringArray { return this.getConstantTypeList(); }

  addType(themeType: string): void {
    requireName(themeType, 'type');
    this.mutate(() => {
      for (const map of [
        this.icons,
        this.styleboxes,
        this.fonts,
        this.fontSizes,
        this.colors,
        this.constants,
      ]) {
        typeMap(map as ItemMap<unknown>, themeType);
      }
    });
  }

  removeType(themeType: string): void {
    this.mutate(() => {
      for (const map of [
        this.icons,
        this.styleboxes,
        this.fonts,
        this.fontSizes,
        this.colors,
        this.constants,
      ]) {
        map.delete(themeType);
      }
      this.typeVariations.delete(themeType);
      for (const [variation, base] of this.typeVariations) {
        if (base === themeType) this.typeVariations.delete(variation);
      }
    });
  }

  renameType(oldName: string, name: string): void {
    requireName(oldName, 'type');
    requireName(name, 'type');
    if (oldName.length === 0 || name.length === 0) {
      throw new Error('godot-compat: Theme.rename_type requires non-empty type names.');
    }
    if (!this.getTypeList().includes(oldName)) {
      throw new Error(`godot-compat: Theme type ${JSON.stringify(oldName)} does not exist.`);
    }
    if (this.getTypeList().includes(name)) {
      throw new Error(`godot-compat: Theme type ${JSON.stringify(name)} already exists.`);
    }
    this.mutate(() => {
      for (const map of [
        this.icons,
        this.styleboxes,
        this.fonts,
        this.fontSizes,
        this.colors,
        this.constants,
      ]) {
        const genericMap = map as ItemMap<unknown>;
        const items = genericMap.get(oldName);
        if (items !== undefined) {
          genericMap.set(name, items);
          genericMap.delete(oldName);
        }
      }
      const base = this.typeVariations.get(oldName);
      if (base !== undefined) {
        this.typeVariations.delete(oldName);
        this.typeVariations.set(name, base);
      }
      for (const [variation, inherited] of this.typeVariations) {
        if (inherited === oldName) this.typeVariations.set(variation, name);
      }
    });
  }

  getTypeList(): PackedStringArray {
    const types = new Set<string>(this.typeVariations.keys());
    for (const map of [this.icons, this.styleboxes, this.fonts, this.fontSizes, this.colors, this.constants]) {
      for (const type of map.keys()) types.add(type);
    }
    return packedStringArray([...types].sort());
  }

  clear(): void {
    this.mutate(() => {
      this.icons.clear();
      this.styleboxes.clear();
      this.fonts.clear();
      this.fontSizes.clear();
      this.colors.clear();
      this.constants.clear();
      this.typeVariations.clear();
    });
  }

  mergeWith(other: GodotTheme): void {
    if (!(other instanceof GodotTheme)) {
      throw new TypeError('godot-compat: Theme.merge_with requires a Theme Resource.');
    }
    this.mutate(() => {
      for (const [sourceMap, targetMap] of [
        [other.icons, this.icons],
        [other.styleboxes, this.styleboxes],
        [other.fonts, this.fonts],
        [other.fontSizes, this.fontSizes],
        [other.colors, this.colors],
        [other.constants, this.constants],
      ] as const) {
        for (const [themeType, items] of sourceMap) {
          const targetItems = typeMap(targetMap as ItemMap<unknown>, themeType);
          for (const [name, value] of items) targetItems.set(name, value);
        }
      }
      for (const [variation, base] of other.typeVariations) {
        this.typeVariations.set(variation, base);
      }
      if (other.hasDefaultBaseScale()) this.defaultBaseScaleValue = other.defaultBaseScaleValue;
      if (other.hasDefaultFont()) this.defaultFontValue = other.defaultFontValue;
      if (other.hasDefaultFontSize()) this.defaultFontSizeValue = other.defaultFontSizeValue;
    });
  }

  copyTheme(other: GodotTheme): void {
    if (!(other instanceof GodotTheme)) {
      throw new TypeError('godot-compat: Theme.copy_theme requires a Theme Resource.');
    }
    this.copyStateFrom(other);
    godotResourceEmitChanged(this);
  }

  private themeItemMap(dataType: number): ItemMap<unknown> {
    switch (integer(dataType, 'data_type')) {
      case THEME_DATA_TYPE_COLOR: return this.colors as ItemMap<unknown>;
      case THEME_DATA_TYPE_CONSTANT: return this.constants as ItemMap<unknown>;
      case THEME_DATA_TYPE_FONT: return this.fonts;
      case THEME_DATA_TYPE_FONT_SIZE: return this.fontSizes as ItemMap<unknown>;
      case THEME_DATA_TYPE_ICON: return this.icons;
      case THEME_DATA_TYPE_STYLEBOX: return this.styleboxes as ItemMap<unknown>;
      default: throw new RangeError(`godot-compat: Theme DataType ${dataType} is outside 0..5.`);
    }
  }

  setThemeItem(dataType: number, name: string, themeType: string, value: unknown): void {
    switch (dataType) {
      case THEME_DATA_TYPE_COLOR:
        this.setColor(name, themeType, value as ColorValue);
        return;
      case THEME_DATA_TYPE_CONSTANT:
        this.setConstant(name, themeType, value as number);
        return;
      case THEME_DATA_TYPE_FONT:
        this.setFont(name, themeType, value);
        return;
      case THEME_DATA_TYPE_FONT_SIZE:
        this.setFontSize(name, themeType, value as number);
        return;
      case THEME_DATA_TYPE_ICON:
        this.setIcon(name, themeType, value);
        return;
      case THEME_DATA_TYPE_STYLEBOX:
        this.setStyleBox(name, themeType, value as GodotStyleBox | null);
        return;
      default:
        throw new RangeError(`godot-compat: Theme DataType ${dataType} is outside 0..5.`);
    }
  }

  getThemeItem(dataType: number, name: string, themeType: string): unknown {
    switch (integer(dataType, 'data_type')) {
      case THEME_DATA_TYPE_COLOR: return this.getColor(name, themeType);
      case THEME_DATA_TYPE_CONSTANT: return this.getConstant(name, themeType);
      case THEME_DATA_TYPE_FONT: return this.getFont(name, themeType);
      case THEME_DATA_TYPE_FONT_SIZE: return this.getFontSize(name, themeType);
      case THEME_DATA_TYPE_ICON: return this.getIcon(name, themeType);
      case THEME_DATA_TYPE_STYLEBOX: return this.getStyleBox(name, themeType);
      default: throw new RangeError(`godot-compat: Theme DataType ${dataType} is outside 0..5.`);
    }
  }

  hasThemeItem(dataType: number, name: string, themeType: string): boolean {
    switch (integer(dataType, 'data_type')) {
      case THEME_DATA_TYPE_COLOR: return this.hasColor(name, themeType);
      case THEME_DATA_TYPE_CONSTANT: return this.hasConstant(name, themeType);
      case THEME_DATA_TYPE_FONT:
        return this.typeVariations.has(themeType)
          ? hasItem(this.fonts, name, themeType)
          : this.hasFont(name, themeType);
      case THEME_DATA_TYPE_FONT_SIZE:
        return this.typeVariations.has(themeType)
          ? (getItem(this.fontSizes, name, themeType) ?? -1) > 0
          : this.hasFontSize(name, themeType);
      case THEME_DATA_TYPE_ICON: return this.hasIcon(name, themeType);
      case THEME_DATA_TYPE_STYLEBOX: return this.hasStyleBox(name, themeType);
      default: throw new RangeError(`godot-compat: Theme DataType ${dataType} is outside 0..5.`);
    }
  }

  renameThemeItem(dataType: number, oldName: string, name: string, themeType: string): void {
    this.mutate(() => { renameItem(this.themeItemMap(dataType), oldName, name, themeType); });
  }

  clearThemeItem(dataType: number, name: string, themeType: string): void {
    this.mutate(() => { clearItem(this.themeItemMap(dataType), name, themeType); });
  }

  getThemeItemList(dataType: number, themeType: string): PackedStringArray {
    return packedStringArray([...(this.themeItemMap(dataType).get(themeType)?.keys() ?? [])].sort());
  }

  getThemeItemTypeList(dataType: number): PackedStringArray {
    return this.itemTypeList(this.themeItemMap(dataType));
  }

  getThemeItemTypes(dataType: number): PackedStringArray {
    return this.getThemeItemTypeList(dataType);
  }

  get default_base_scale(): number { return this.getDefaultBaseScale(); }
  set default_base_scale(value: number) { this.setDefaultBaseScale(value); }
  get default_font(): unknown { return this.getDefaultFont(); }
  set default_font(value: unknown) { this.setDefaultFont(value); }
  get default_font_size(): number { return this.getDefaultFontSize(); }
  set default_font_size(value: number) { this.setDefaultFontSize(value); }

  set_default_base_scale(value: number): void { this.setDefaultBaseScale(value); }
  get_default_base_scale(): number { return this.getDefaultBaseScale(); }
  has_default_base_scale(): boolean { return this.hasDefaultBaseScale(); }
  set_default_font(value: unknown): void { this.setDefaultFont(value); }
  get_default_font(): unknown { return this.getDefaultFont(); }
  has_default_font(): boolean { return this.hasDefaultFont(); }
  set_default_font_size(value: number): void { this.setDefaultFontSize(value); }
  get_default_font_size(): number { return this.getDefaultFontSize(); }
  has_default_font_size(): boolean { return this.hasDefaultFontSize(); }

  set_stylebox(name: string, themeType: string, value: GodotStyleBox | null): void {
    this.setStyleBox(name, themeType, value);
  }
  get_stylebox(name: string, themeType: string): GodotStyleBox {
    return this.getStyleBox(name, themeType);
  }
  has_stylebox(name: string, themeType: string): boolean {
    return this.hasStyleBox(name, themeType);
  }
  clear_stylebox(name: string, themeType: string): void { this.clearStyleBox(name, themeType); }
  rename_stylebox(oldName: string, name: string, themeType: string): void {
    this.renameStyleBox(oldName, name, themeType);
  }
  get_stylebox_list(themeType: string): PackedStringArray { return this.getStyleBoxList(themeType); }
  get_stylebox_type_list(): PackedStringArray { return this.getStyleBoxTypeList(); }
  get_stylebox_types(): PackedStringArray { return this.getStyleBoxTypes(); }

  set_icon(name: string, themeType: string, value: unknown): void { this.setIcon(name, themeType, value); }
  get_icon(name: string, themeType: string): unknown { return this.getIcon(name, themeType); }
  has_icon(name: string, themeType: string): boolean { return this.hasIcon(name, themeType); }
  clear_icon(name: string, themeType: string): void { this.clearIcon(name, themeType); }
  rename_icon(oldName: string, name: string, themeType: string): void {
    this.renameIcon(oldName, name, themeType);
  }
  get_icon_list(themeType: string): PackedStringArray { return this.getIconList(themeType); }
  get_icon_type_list(): PackedStringArray { return this.getIconTypeList(); }
  get_icon_types(): PackedStringArray { return this.getIconTypes(); }

  set_font(name: string, themeType: string, value: unknown): void { this.setFont(name, themeType, value); }
  get_font(name: string, themeType: string): unknown { return this.getFont(name, themeType); }
  has_font(name: string, themeType: string): boolean { return this.hasFont(name, themeType); }
  clear_font(name: string, themeType: string): void { this.clearFont(name, themeType); }
  rename_font(oldName: string, name: string, themeType: string): void {
    this.renameFont(oldName, name, themeType);
  }
  get_font_list(themeType: string): PackedStringArray { return this.getFontList(themeType); }
  get_font_type_list(): PackedStringArray { return this.getFontTypeList(); }
  get_font_types(): PackedStringArray { return this.getFontTypes(); }

  set_font_size(name: string, themeType: string, value: number): void {
    this.setFontSize(name, themeType, value);
  }
  get_font_size(name: string, themeType: string): number { return this.getFontSize(name, themeType); }
  has_font_size(name: string, themeType: string): boolean { return this.hasFontSize(name, themeType); }
  clear_font_size(name: string, themeType: string): void { this.clearFontSize(name, themeType); }
  rename_font_size(oldName: string, name: string, themeType: string): void {
    this.renameFontSize(oldName, name, themeType);
  }
  get_font_size_list(themeType: string): PackedStringArray { return this.getFontSizeList(themeType); }
  get_font_size_type_list(): PackedStringArray { return this.getFontSizeTypeList(); }
  get_font_size_types(): PackedStringArray { return this.getFontSizeTypes(); }

  set_color(name: string, themeType: string, value: ColorValue): void {
    this.setColor(name, themeType, value);
  }
  get_color(name: string, themeType: string): ColorValue { return this.getColor(name, themeType); }
  has_color(name: string, themeType: string): boolean { return this.hasColor(name, themeType); }
  clear_color(name: string, themeType: string): void { this.clearColor(name, themeType); }
  rename_color(oldName: string, name: string, themeType: string): void {
    this.renameColor(oldName, name, themeType);
  }
  get_color_list(themeType: string): PackedStringArray { return this.getColorList(themeType); }
  get_color_type_list(): PackedStringArray { return this.getColorTypeList(); }
  get_color_types(): PackedStringArray { return this.getColorTypes(); }

  set_constant(name: string, themeType: string, value: number): void {
    this.setConstant(name, themeType, value);
  }
  get_constant(name: string, themeType: string): number { return this.getConstant(name, themeType); }
  has_constant(name: string, themeType: string): boolean { return this.hasConstant(name, themeType); }
  clear_constant(name: string, themeType: string): void { this.clearConstant(name, themeType); }
  rename_constant(oldName: string, name: string, themeType: string): void {
    this.renameConstant(oldName, name, themeType);
  }
  get_constant_list(themeType: string): PackedStringArray { return this.getConstantList(themeType); }
  get_constant_type_list(): PackedStringArray { return this.getConstantTypeList(); }
  get_constant_types(): PackedStringArray { return this.getConstantTypes(); }

  set_type_variation(themeType: string, baseType: string): void {
    this.setTypeVariation(themeType, baseType);
  }
  is_type_variation(themeType: string, baseType: string): boolean {
    return this.isTypeVariation(themeType, baseType);
  }
  clear_type_variation(themeType: string): void { this.clearTypeVariation(themeType); }
  get_type_variation_base(themeType: string): string { return this.getTypeVariationBase(themeType); }
  get_type_variation_list(baseType: string): PackedStringArray {
    return this.getTypeVariationList(baseType);
  }
  add_type(themeType: string): void { this.addType(themeType); }
  remove_type(themeType: string): void { this.removeType(themeType); }
  rename_type(oldName: string, name: string): void { this.renameType(oldName, name); }
  get_type_list(): PackedStringArray { return this.getTypeList(); }
  merge_with(other: GodotTheme): void { this.mergeWith(other); }
  copy_theme(other: GodotTheme): void { this.copyTheme(other); }

  set_theme_item(dataType: number, name: string, themeType: string, value: unknown): void {
    this.setThemeItem(dataType, name, themeType, value);
  }
  get_theme_item(dataType: number, name: string, themeType: string): unknown {
    return this.getThemeItem(dataType, name, themeType);
  }
  has_theme_item(dataType: number, name: string, themeType: string): boolean {
    return this.hasThemeItem(dataType, name, themeType);
  }
  rename_theme_item(dataType: number, oldName: string, name: string, themeType: string): void {
    this.renameThemeItem(dataType, oldName, name, themeType);
  }
  clear_theme_item(dataType: number, name: string, themeType: string): void {
    this.clearThemeItem(dataType, name, themeType);
  }
  get_theme_item_list(dataType: number, themeType: string): PackedStringArray {
    return this.getThemeItemList(dataType, themeType);
  }
  get_theme_item_type_list(dataType: number): PackedStringArray {
    return this.getThemeItemTypeList(dataType);
  }
  get_theme_item_types(dataType: number): PackedStringArray {
    return this.getThemeItemTypes(dataType);
  }
}

export function createTheme(seed: GodotThemeSeed = {}): GodotTheme {
  const theme = new GodotTheme();
  if (seed.defaultBaseScale !== undefined) theme.setDefaultBaseScale(seed.defaultBaseScale);
  if (seed.defaultFont !== undefined) theme.setDefaultFont(seed.defaultFont);
  if (seed.defaultFontSize !== undefined) theme.setDefaultFontSize(seed.defaultFontSize);
  for (const item of seed.icons ?? []) theme.setIcon(item.name, item.themeType, item.value);
  for (const item of seed.styleboxes ?? []) {
    theme.setStyleBox(item.name, item.themeType, item.value);
  }
  for (const item of seed.fonts ?? []) theme.setFont(item.name, item.themeType, item.value);
  for (const item of seed.fontSizes ?? []) {
    theme.setFontSize(item.name, item.themeType, item.value);
  }
  for (const item of seed.colors ?? []) theme.setColor(item.name, item.themeType, item.value);
  for (const item of seed.constants ?? []) {
    theme.setConstant(item.name, item.themeType, item.value);
  }
  for (const item of seed.typeVariations ?? []) {
    theme.setTypeVariation(item.themeType, item.baseType);
  }
  return theme;
}

/** Re-run one retained renderer projection whenever Theme or a nested item Resource changes. */
export function bindThemeConsumer(theme: GodotTheme, apply: (theme: GodotTheme) => void): () => void {
  if (!(theme instanceof GodotTheme)) {
    throw new TypeError('godot-compat: bindThemeConsumer requires a Theme Resource.');
  }
  apply(theme);
  const connection = godotResourceChangedSignal(theme).connect(() => apply(theme));
  return () => connection.disconnect();
}

/** Live Theme StyleBox projection for the DOM overlay used by the retained Three Control surface. */
export function bindThemeStyleBoxDom(
  element: HTMLElement,
  theme: GodotTheme,
  name: string,
  themeType: string,
  options: { readonly contentPadding?: boolean } = {},
): () => void {
  let previous = new Set<keyof GodotStyleBoxCss>();
  return bindThemeConsumer(theme, (current) => {
    const css = styleBoxCss(current.getStyleBox(name, themeType), options);
    const next = new Set(Object.keys(css) as (keyof GodotStyleBoxCss)[]);
    for (const key of previous) {
      if (!next.has(key)) Reflect.set(element.style, key, '');
    }
    for (const [key, value] of Object.entries(css)) Reflect.set(element.style, key, value);
    previous = next;
  });
}

/** Live Theme StyleBox projection onto the retained Pixi Graphics that is the canvas Control. */
export function bindThemeStyleBoxPixi(
  graphics: Graphics,
  theme: GodotTheme,
  name: string,
  themeType: string,
  rect: () => {
    readonly width: number;
    readonly height: number;
    readonly x?: number;
    readonly y?: number;
  },
): () => void {
  return bindThemeConsumer(theme, (current) => {
    const bounds = rect();
    drawStyleBoxPixi(
      graphics,
      current.getStyleBox(name, themeType),
      bounds.width,
      bounds.height,
      bounds.x ?? 0,
      bounds.y ?? 0,
    );
  });
}

interface ControlThemeBinding {
  readonly control: object;
  theme: GodotTheme | null;
  themeTypeVariation: string;
  readonly constantOverrides: Map<string, number>;
  readonly colorOverrides: Map<string, ColorValue>;
  readonly fontOverrides: Map<string, unknown>;
  readonly iconOverrides: Map<string, unknown>;
  readonly fontSizeOverrides: Map<string, number>;
  readonly styleBoxOverrides: Map<string, GodotStyleBox>;
  parent: () => object | null;
  readonly consumers: Set<(theme: GodotTheme | null, themeTypeVariation: string) => void>;
  connections: GodotConnection[];
  fontOverrideConnections: GodotConnection[];
}

const CONTROL_THEMES = new WeakMap<object, ControlThemeBinding>();
const ACTIVE_CONTROL_THEME_CONSUMERS = new Set<ControlThemeBinding>();

function nativeControlParent(control: object): object | null {
  const parent = Reflect.get(control, 'parent');
  return typeof parent === 'object' && parent !== null ? parent : null;
}

function controlThemeBinding(control: object): ControlThemeBinding {
  let binding = CONTROL_THEMES.get(control);
  if (binding !== undefined) return binding;
  binding = {
    control,
    theme: null,
    themeTypeVariation: '',
    constantOverrides: new Map(),
    colorOverrides: new Map(),
    fontOverrides: new Map(),
    iconOverrides: new Map(),
    fontSizeOverrides: new Map(),
    styleBoxOverrides: new Map(),
    parent: () => nativeControlParent(control),
    consumers: new Set(),
    connections: [],
    fontOverrideConnections: [],
  };
  CONTROL_THEMES.set(control, binding);
  return binding;
}

/** Register the authored Control ancestry before a native renderer attaches its display tree. */
export function setControlThemeParent(
  control: object,
  parent?: () => object | null,
): void {
  const binding = controlThemeBinding(control);
  binding.parent = parent ?? (() => nativeControlParent(control));
  refreshActiveControlThemes();
}

function effectiveControlTheme(binding: ControlThemeBinding): GodotTheme | null {
  const seen = new Set<object>();
  let current: ControlThemeBinding | undefined = binding;
  while (current !== undefined && !seen.has(current.control)) {
    seen.add(current.control);
    if (current.theme !== null) return current.theme;
    const parent = current.parent();
    current = parent === null ? undefined : CONTROL_THEMES.get(parent) ?? controlThemeBinding(parent);
  }
  return null;
}

function reconnectControlTheme(binding: ControlThemeBinding): void {
  for (const connection of binding.connections) connection.disconnect();
  binding.connections = [];
  for (const connection of binding.fontOverrideConnections) connection.disconnect();
  binding.fontOverrideConnections = [];
  const theme = effectiveControlTheme(binding);
  const apply = (): void => {
    const current = effectiveControlTheme(binding);
    for (const consumer of binding.consumers) {
      consumer(current, binding.themeTypeVariation);
    }
  };
  binding.connections = controlThemeSearchThemes(binding)
    .map((candidate) => godotResourceChangedSignal(candidate).connect(apply));
  binding.fontOverrideConnections = [...new Set(binding.fontOverrides.values())]
    .map((font) => godotResourceChangedSignal(font).connect(apply));
  for (const consumer of binding.consumers) {
    consumer(theme, binding.themeTypeVariation);
  }
}

function refreshActiveControlThemes(): void {
  for (const binding of ACTIVE_CONTROL_THEME_CONSUMERS) reconnectControlTheme(binding);
}

/** Seat one renderer-owned Control invalidator on the shared Theme attachment protocol. */
export function bindControlThemeConsumer(
  control: object,
  apply: (theme: GodotTheme | null, themeTypeVariation: string) => void,
  parent?: () => object | null,
): () => void {
  const binding = controlThemeBinding(control);
  binding.consumers.add(apply);
  if (parent !== undefined) binding.parent = parent;
  ACTIVE_CONTROL_THEME_CONSUMERS.add(binding);
  // A child may have been seated before its parent handle. Refreshing the whole retained tree
  // makes attachment order irrelevant and keeps nearest-ancestor inheritance live.
  refreshActiveControlThemes();
  return () => {
    binding.consumers.delete(apply);
    if (binding.consumers.size === 0) {
      for (const connection of binding.connections) connection.disconnect();
      binding.connections = [];
      for (const connection of binding.fontOverrideConnections) connection.disconnect();
      binding.fontOverrideConnections = [];
      ACTIVE_CONTROL_THEME_CONSUMERS.delete(binding);
    }
  };
}

export function setControlTheme(control: object, value: GodotTheme | null): void {
  if (value !== null && !(value instanceof GodotTheme)) {
    throw new TypeError('godot-compat: Control.theme must be a Theme Resource or null.');
  }
  const binding = controlThemeBinding(control);
  binding.theme = value;
  refreshActiveControlThemes();
}

export function getControlTheme(control: object): GodotTheme | null {
  return controlThemeBinding(control).theme;
}

export function setControlThemeTypeVariation(control: object, value: string): void {
  if (typeof value !== 'string') {
    throw new TypeError('godot-compat: Control.theme_type_variation must be a StringName.');
  }
  const binding = controlThemeBinding(control);
  binding.themeTypeVariation = value;
  refreshActiveControlThemes();
}

export function getControlThemeTypeVariation(control: object): string {
  return controlThemeBinding(control).themeTypeVariation;
}

/** Godot 4 Control.add_theme_constant_override on the retained Control identity. */
export function addControlThemeConstantOverride(
  control: object,
  name: string,
  value: number,
): void {
  requireName(name, 'item');
  const normalized = integer(value, 'Control.add_theme_constant_override constant');
  const binding = controlThemeBinding(control);
  if (binding.constantOverrides.get(name) === normalized) return;
  binding.constantOverrides.set(name, normalized);
  reconnectControlTheme(binding);
}

export function hasControlThemeConstantOverride(control: object, name: string): boolean {
  requireName(name, 'item');
  return controlThemeBinding(control).constantOverrides.has(name);
}

export function removeControlThemeConstantOverride(control: object, name: string): void {
  requireName(name, 'item');
  const binding = controlThemeBinding(control);
  if (!binding.constantOverrides.delete(name)) return;
  reconnectControlTheme(binding);
}

function setControlColorOverride(
  control: object,
  name: string,
  value: ColorValue,
  member: 'add_color_override' | 'add_theme_color_override',
): void {
  requireName(name, 'item');
  const normalized = colorValue(value, `Control.${member} color`);
  const binding = controlThemeBinding(control);
  const current = binding.colorOverrides.get(name);
  if (current !== undefined && current.r === normalized.r && current.g === normalized.g && current.b === normalized.b && current.a === normalized.a) return;
  binding.colorOverrides.set(name, normalized);
  reconnectControlTheme(binding);
}

/** Godot 4 Control theme overrides live on the retained Control, not on its shared Theme. */
export function addControlThemeColorOverride(control: object, name: string, value: ColorValue): void {
  setControlColorOverride(control, name, value, 'add_theme_color_override');
}

/** Godot 3 Control.add_color_override over the same retained override map and native consumers. */
export function addControlColorOverride(control: object, name: string, value: ColorValue): void {
  setControlColorOverride(control, name, value, 'add_color_override');
}

export function controlThemeColorOverride(control: object, name: string): ColorValue | null {
  requireName(name, 'item');
  const value = controlThemeBinding(control).colorOverrides.get(name);
  return value === undefined ? null : { ...value };
}

export function hasControlThemeColorOverride(control: object, name: string): boolean {
  requireName(name, 'item');
  return controlThemeBinding(control).colorOverrides.has(name);
}

export function removeControlThemeColorOverride(control: object, name: string): void {
  requireName(name, 'item');
  const binding = controlThemeBinding(control);
  if (binding.colorOverrides.delete(name)) reconnectControlTheme(binding);
}

function requireThemeResource(value: unknown, member: string): object {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Control.${member} requires a Resource.`);
  }
  return value;
}

export function addControlThemeFontOverride(control: object, name: string, value: unknown): void {
  requireName(name, 'item');
  const binding = controlThemeBinding(control);
  const normalized = requireThemeResource(value, 'add_theme_font_override');
  if (binding.fontOverrides.get(name) === normalized) return;
  binding.fontOverrides.set(name, normalized);
  reconnectControlTheme(binding);
}

export function removeControlThemeFontOverride(control: object, name: string): void {
  requireName(name, 'item');
  const binding = controlThemeBinding(control);
  if (binding.fontOverrides.delete(name)) reconnectControlTheme(binding);
}

export function hasControlThemeFontOverride(control: object, name: string): boolean {
  requireName(name, 'item');
  return controlThemeBinding(control).fontOverrides.has(name);
}

export function addControlThemeIconOverride(control: object, name: string, value: unknown): void {
  requireName(name, 'item');
  const binding = controlThemeBinding(control);
  const normalized = requireIcon(value, 'Control.add_theme_icon_override', true);
  if (binding.iconOverrides.get(name) === normalized) return;
  binding.iconOverrides.set(name, normalized);
  reconnectControlTheme(binding);
}

export function removeControlThemeIconOverride(control: object, name: string): void {
  requireName(name, 'item');
  const binding = controlThemeBinding(control);
  if (binding.iconOverrides.delete(name)) reconnectControlTheme(binding);
}

export function hasControlThemeIconOverride(control: object, name: string): boolean {
  requireName(name, 'item');
  return controlThemeBinding(control).iconOverrides.has(name);
}

export function getControlThemeFont(control: object, name: string, themeType = ''): unknown {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  const override = binding.fontOverrides.get(name);
  if (override !== undefined) return override;
  const theme = effectiveControlTheme(binding);
  if (theme === null) return getGodotThemeDbFallbackFont();
  const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
  for (const type of controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)) {
    if (theme.hasFont(name, type)) return theme.getFont(name, type);
  }
  return theme.hasDefaultFont() ? theme.getDefaultFont() : getGodotThemeDbFallbackFont();
}

/** Resolve DynamicFont outline state through the same override/variation/inheritance path as Font. */
export function controlThemeFontOutline(
  control: object,
  name: string,
  themeType = '',
): GodotFontOutlinePresentation | null {
  const font = getControlThemeFont(control, name, themeType);
  return font === null ? null : godotFontOutlinePresentation(font);
}

/** Effective native font family, including a per-Control font override Resource. */
export function controlThemeFontFamily(
  control: object,
  name: string,
  fallback?: string,
  themeType = '',
): string | undefined {
  const font = getControlThemeFont(control, name, themeType);
  if (typeof font !== 'object' || font === null) return fallback;
  const family = Reflect.get(font, 'family');
  return typeof family === 'string' && family.length > 0 ? family : fallback;
}

/** Effective native font size, preserving Theme font-size priority then DynamicFont's own size. */
export function controlThemeResolvedFontSize(
  control: object,
  fontName: string,
  sizeName: string,
  fallback?: number,
  themeType = '',
): number | undefined {
  const override = controlThemeFontSizeOverride(control, sizeName);
  if (override !== null) return override;
  const themed = getControlThemeFontSize(control, sizeName, themeType);
  if (themed > 0) return themed;
  const font = getControlThemeFont(control, fontName, themeType);
  const size = typeof font === 'object' && font !== null ? Reflect.get(font, 'size') : undefined;
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : fallback;
}

/** Control.get_theme_default_font reads the effective inherited Theme's retained default font. */
export function getControlThemeDefaultFont(control: object): unknown {
  const theme = effectiveControlTheme(controlThemeBinding(control));
  if (theme?.hasDefaultFont() === true) return theme.getDefaultFont();
  const binding = optionalControlBinding(control);
  const element = binding?.state.read(binding.id).focusElement;
  const nativeFamily = typeof window !== 'undefined' && element !== undefined && element !== null
    ? window.getComputedStyle(element).fontFamily
    : (control as { readonly style?: { readonly fontFamily?: unknown } }).style?.fontFamily;
  const family = Array.isArray(nativeFamily)
    ? String(nativeFamily[0] ?? 'sans-serif')
    : typeof nativeFamily === 'string' && nativeFamily !== ''
      ? nativeFamily
      : 'sans-serif';
  if (family === 'sans-serif') return getGodotThemeDbFallbackFont();
  const retained = CONTROL_NATIVE_DEFAULT_FONTS.get(control);
  if (retained?.family === family) return retained.font;
  const font = createGodotSystemFont([family]);
  CONTROL_NATIVE_DEFAULT_FONTS.set(control, { family, font });
  return font;
}

/** Control.get_theme_default_base_scale follows the inherited Theme then ThemeDB fallback. */
export function getControlThemeDefaultBaseScale(control: object): number {
  const theme = effectiveControlTheme(controlThemeBinding(control));
  return theme?.hasDefaultBaseScale() === true
    ? theme.getDefaultBaseScale()
    : getGodotThemeDbFallbackBaseScale();
}

/** Control.get_theme_default_font_size follows the inherited Theme then ThemeDB fallback. */
export function getControlThemeDefaultFontSize(control: object): number {
  const theme = effectiveControlTheme(controlThemeBinding(control));
  return theme?.hasDefaultFontSize() === true
    ? theme.getDefaultFontSize()
    : getGodotThemeDbFallbackFontSize();
}

export function hasControlThemeFont(control: object, name: string, themeType = ''): boolean {
  return getControlThemeFont(control, name, themeType) !== null;
}

export function getControlThemeIcon(control: object, name: string, themeType = ''): unknown {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  if (binding.iconOverrides.has(name)) return binding.iconOverrides.get(name);
  for (const theme of controlThemeSearchThemes(binding)) {
    const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
    for (const type of controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)) {
      if (theme.hasIcon(name, type)) return theme.getIcon(name, type);
    }
  }
  return getGodotThemeDbFallbackIcon();
}

export function hasControlThemeIcon(control: object, name: string, themeType = ''): boolean {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  // Godot 3 Control::has_icon_override tests map presence, not Ref<Texture>::is_valid().
  if (binding.iconOverrides.has(name)) return true;
  return controlThemeSearchThemes(binding).some((theme) => {
    const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
    return controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)
      .some((type) => theme.hasIcon(name, type));
  });
}

export type GodotControlThemeIconDrawResolution =
  | { readonly kind: 'missing' }
  | { readonly kind: 'null' }
  | { readonly kind: 'texture'; readonly value: unknown };

function controlThemeSearchThemes(binding: ControlThemeBinding): readonly GodotTheme[] {
  const themes: GodotTheme[] = [];
  const seenControls = new Set<object>();
  let current: ControlThemeBinding | undefined = binding;
  while (current !== undefined && !seenControls.has(current.control)) {
    seenControls.add(current.control);
    if (current.theme !== null) themes.push(current.theme);
    const parent = current.parent();
    current = parent === null ? undefined : CONTROL_THEMES.get(parent) ?? controlThemeBinding(parent);
  }
  if (THEME_DB_PROJECT_THEME !== null) themes.push(THEME_DB_PROJECT_THEME);
  themes.push(getGodotThemeDbDefaultTheme());
  return [...new Set(themes)];
}

/**
 * Draw-time lookup retains the distinction Godot's public Theme API normally hides: a null item
 * is an authored Resource entry, while no item means the engine default theme supplied nothing.
 */
export function resolveControlThemeIconForDrawing(
  control: object,
  name: string,
  themeType = '',
): GodotControlThemeIconDrawResolution {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  if (binding.iconOverrides.has(name)) {
    const value = binding.iconOverrides.get(name);
    return value === null ? { kind: 'null' } : { kind: 'texture', value };
  }
  for (const theme of controlThemeSearchThemes(binding)) {
    const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
    for (const type of controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)) {
      // Theme::has_icon rejects an invalid/null Ref and Control continues through the remaining
      // owner/project/default Themes. Only a Control override returns its null Ref directly.
      if (theme.hasIcon(name, type)) return { kind: 'texture', value: theme.getIcon(name, type) };
    }
  }
  return { kind: 'missing' };
}

export function addControlThemeFontSizeOverride(control: object, name: string, value: number): void {
  requireName(name, 'item');
  const normalized = integer(value, 'Control.add_theme_font_size_override font size');
  if (normalized <= 0) throw new RangeError('Control.add_theme_font_size_override requires a positive font size.');
  const binding = controlThemeBinding(control);
  if (binding.fontSizeOverrides.get(name) === normalized) return;
  binding.fontSizeOverrides.set(name, normalized);
  reconnectControlTheme(binding);
}

export function controlThemeFontSizeOverride(control: object, name: string): number | null {
  requireName(name, 'item');
  return controlThemeBinding(control).fontSizeOverrides.get(name) ?? null;
}

export function hasControlThemeFontSizeOverride(control: object, name: string): boolean {
  requireName(name, 'item');
  return controlThemeBinding(control).fontSizeOverrides.has(name);
}

export function removeControlThemeFontSizeOverride(control: object, name: string): void {
  requireName(name, 'item');
  const binding = controlThemeBinding(control);
  if (binding.fontSizeOverrides.delete(name)) reconnectControlTheme(binding);
}

function controlThemeDefaultType(control: object): string {
  try {
    return godotObjectGetClass(control);
  } catch {
    return 'Control';
  }
}

function controlStyleBoxOverrideApplies(
  control: object,
  binding: ControlThemeBinding,
  themeType: string,
): boolean {
  return themeType === '' ||
    themeType === controlThemeDefaultType(control) ||
    themeType === binding.themeTypeVariation;
}

export function getControlThemeColor(control: object, name: string, themeType = ''): ColorValue {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  const override = binding.colorOverrides.get(name);
  if (override !== undefined) return { ...override };
  const theme = effectiveControlTheme(binding);
  if (theme === null) return { r: 0, g: 0, b: 0, a: 1 };
  const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
  for (const type of controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)) {
    if (theme.hasColor(name, type)) return theme.getColor(name, type);
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export function hasControlThemeColor(control: object, name: string, themeType = ''): boolean {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  if (binding.colorOverrides.has(name)) return true;
  const theme = effectiveControlTheme(binding);
  if (theme === null) return false;
  const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
  return controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)
    .some((type) => theme.hasColor(name, type));
}

export function getControlThemeFontSize(control: object, name: string, themeType = ''): number {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  const override = binding.fontSizeOverrides.get(name);
  if (override !== undefined) return override;
  const theme = effectiveControlTheme(binding);
  if (theme === null) return 0;
  const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
  for (const type of controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)) {
    if (theme.hasFontSize(name, type)) return theme.getFontSize(name, type);
  }
  return theme.hasDefaultFontSize() ? theme.getDefaultFontSize() : 0;
}

export function hasControlThemeFontSize(control: object, name: string, themeType = ''): boolean {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  if (binding.fontSizeOverrides.has(name)) return true;
  const theme = effectiveControlTheme(binding);
  if (theme === null) return false;
  const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
  return controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)
    .some((type) => theme.hasFontSize(name, type));
}

export function getControlThemeConstant(
  control: object,
  name: string,
  themeType = '',
): number {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  const overridden = binding.constantOverrides.get(name);
  if (overridden !== undefined) return overridden;
  const theme = effectiveControlTheme(binding);
  if (theme === null) return 0;
  let defaultThemeType = 'Control';
  try {
    defaultThemeType = godotObjectGetClass(control);
  } catch {
    // A user-created retained Control may not have been registered yet; Control is ClassDB's base.
  }
  const types = controlThemeTypes(
    theme,
    binding.themeTypeVariation,
    themeType === '' ? defaultThemeType : themeType,
  );
  for (const type of types) {
    if (theme.hasConstant(name, type)) return theme.getConstant(name, type);
  }
  return 0;
}

export function hasControlThemeConstant(
  control: object,
  name: string,
  themeType = '',
): boolean {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  if (binding.constantOverrides.has(name)) return true;
  const theme = effectiveControlTheme(binding);
  if (theme === null) return false;
  let defaultThemeType = 'Control';
  try {
    defaultThemeType = godotObjectGetClass(control);
  } catch {
    // See getControlThemeConstant: the base is exact before a more specific identity is seated.
  }
  return controlThemeTypes(
    theme,
    binding.themeTypeVariation,
    themeType === '' ? defaultThemeType : themeType,
  ).some((type) => theme.hasConstant(name, type));
}

export function controlThemeStyleBox(
  control: object,
  fallback: GodotStyleBox,
  name: string,
  defaultThemeType: string,
): GodotStyleBox {
  const binding = controlThemeBinding(control);
  const override = binding.styleBoxOverrides.get(name);
  if (override !== undefined) return override;
  for (const theme of controlThemeSearchThemes(binding)) {
    for (const type of controlThemeTypes(theme, binding.themeTypeVariation, defaultThemeType)) {
      if (theme.hasStyleBox(name, type)) return theme.getStyleBox(name, type);
    }
  }
  return fallback;
}

export function addControlThemeStyleBoxOverride(
  control: object,
  name: string,
  styleBox: GodotStyleBox | null,
): void {
  requireName(name, 'item');
  const binding = controlThemeBinding(control);
  // Godot 3 Control::add_style_override(null) clears the override instead of storing a null Ref.
  if (styleBox === null) {
    if (binding.styleBoxOverrides.delete(name)) reconnectControlTheme(binding);
    return;
  }
  if (!(styleBox instanceof GodotStyleBox)) {
    throw new TypeError('Control.add_theme_stylebox_override requires a StyleBox Resource or null.');
  }
  if (binding.styleBoxOverrides.get(name) === styleBox) return;
  binding.styleBoxOverrides.set(name, styleBox);
  reconnectControlTheme(binding);
}

export function hasControlThemeStyleBoxOverride(control: object, name: string): boolean {
  requireName(name, 'item');
  return controlThemeBinding(control).styleBoxOverrides.has(name);
}

export function removeControlThemeStyleBoxOverride(control: object, name: string): void {
  requireName(name, 'item');
  const binding = controlThemeBinding(control);
  if (binding.styleBoxOverrides.delete(name)) reconnectControlTheme(binding);
}

export function getControlThemeStyleBox(
  control: object,
  name: string,
  themeType = '',
): GodotStyleBox {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  if (controlStyleBoxOverrideApplies(control, binding, themeType)) {
    const override = binding.styleBoxOverrides.get(name);
    if (override !== undefined) return override;
  }
  for (const theme of controlThemeSearchThemes(binding)) {
    const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
    for (const type of controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)) {
      if (theme.hasStyleBox(name, type)) return theme.getStyleBox(name, type);
    }
  }
  return getGodotThemeDbFallbackStylebox();
}

export function hasControlThemeStyleBox(control: object, name: string, themeType = ''): boolean {
  requireName(name, 'item');
  requireName(themeType, 'type');
  const binding = controlThemeBinding(control);
  if (controlStyleBoxOverrideApplies(control, binding, themeType) && binding.styleBoxOverrides.has(name)) {
    return true;
  }
  return controlThemeSearchThemes(binding).some((theme) => {
    const resolvedType = themeType === '' ? controlThemeDefaultType(control) : themeType;
    return controlThemeTypes(theme, binding.themeTypeVariation, resolvedType)
      .some((type) => theme.hasStyleBox(name, type));
  });
}

/** Effective Control lookup: variation chain first, then the concrete Control class. */
export function themeStyleBoxForControl(
  theme: GodotTheme | null,
  fallback: GodotStyleBox,
  name: string,
  themeTypeVariation: string,
  defaultThemeType: string,
): GodotStyleBox {
  if (theme === null) return fallback;
  const seen = new Set<string>();
  let current = themeTypeVariation;
  while (current.length > 0 && !seen.has(current)) {
    seen.add(current);
    if (theme.hasStyleBox(name, current)) return theme.getStyleBox(name, current);
    current = theme.getTypeVariationBase(current);
  }
  if (theme.hasStyleBox(name, defaultThemeType)) {
    return theme.getStyleBox(name, defaultThemeType);
  }
  return fallback;
}

function controlThemeTypes(
  theme: GodotTheme,
  themeTypeVariation: string,
  defaultThemeType: string,
): readonly string[] {
  const types: string[] = [];
  const seen = new Set<string>();
  let current = themeTypeVariation;
  while (current.length > 0 && !seen.has(current)) {
    seen.add(current);
    types.push(current);
    current = theme.getTypeVariationBase(current);
  }
  if (!seen.has(defaultThemeType)) types.push(defaultThemeType);
  return types;
}

function themeFontForControl(
  theme: GodotTheme | null,
  name: string,
  themeTypeVariation: string,
  defaultThemeType: string,
): unknown {
  if (theme === null) return getGodotThemeDbFallbackFont();
  for (const themeType of controlThemeTypes(theme, themeTypeVariation, defaultThemeType)) {
    const font = theme.fonts.get(themeType)?.get(name);
    if (font !== null && font !== undefined) return font;
    if (theme.hasDefaultFont()) return theme.getDefaultFont();
  }
  return getGodotThemeDbFallbackFont();
}

/** Resolve the actual inherited Font Resource behind Control.get_font(). */
export function controlThemeFont(
  control: object,
  name: string,
  defaultThemeType: string,
): unknown {
  const binding = controlThemeBinding(control);
  return themeFontForControl(
    effectiveControlTheme(binding),
    name,
    binding.themeTypeVariation,
    defaultThemeType,
  );
}

export function themeFontFamilyForControl(
  theme: GodotTheme | null,
  fallback: string | undefined,
  name: string,
  themeTypeVariation: string,
  defaultThemeType: string,
): string | undefined {
  const font = themeFontForControl(theme, name, themeTypeVariation, defaultThemeType);
  if (typeof font !== 'object' || font === null) return fallback;
  const family = Reflect.get(font, 'family');
  return typeof family === 'string' && family.length > 0 ? family : fallback;
}

export function themeFontSizeForControl(
  theme: GodotTheme | null,
  fallback: number | undefined,
  name: string,
  themeTypeVariation: string,
  defaultThemeType: string,
): number | undefined {
  if (theme === null) return fallback;
  for (const themeType of controlThemeTypes(theme, themeTypeVariation, defaultThemeType)) {
    const size = theme.fontSizes.get(themeType)?.get(name);
    if (size !== undefined && size > 0) return size;
  }
  if (theme.defaultFontSize > 0) return theme.defaultFontSize;
  const font = themeFontForControl(theme, name, themeTypeVariation, defaultThemeType);
  const size = typeof font === 'object' && font !== null ? Reflect.get(font, 'size') : undefined;
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : fallback;
}

/** Bind a retained Pixi text Control to the same inherited Theme identity scripts mutate. */
export function bindCanvasControlThemeFont(
  text: Text,
  fallbackFamily: string,
  fallbackSize: number,
  defaultThemeType: string,
): () => void {
  releaseCanvasControlThemeFont(text);
  const release = bindControlThemeConsumer(text, (theme, variation) => {
    void theme;
    void variation;
    text.style.fontFamily = controlThemeFontFamily(text, 'font', fallbackFamily, defaultThemeType) ?? fallbackFamily;
    text.style.fontSize = controlThemeResolvedFontSize(
      text,
      'font',
      'font_size',
      fallbackSize,
      defaultThemeType,
    ) ?? fallbackSize;
    const outline = controlThemeFontOutline(text, 'font', defaultThemeType);
    text.style.stroke = outline === null
      ? { color: 0x000000, alpha: 0, width: 0 }
      : { color: outline.color, width: outline.size * 2 };
    const color = controlThemeColorOverride(text, 'font_color');
    if (color !== null) {
      const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
      text.style.fill = `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${Math.max(0, Math.min(1, color.a))})`;
    }
  });
  CANVAS_CONTROL_THEME_FONT_RELEASES.set(text, release);
  return release;
}

const CANVAS_CONTROL_THEME_FONT_RELEASES = new WeakMap<Text, () => void>();

export function releaseCanvasControlThemeFont(text: Text): void {
  CANVAS_CONTROL_THEME_FONT_RELEASES.get(text)?.();
  CANVAS_CONTROL_THEME_FONT_RELEASES.delete(text);
}

/** Bind an emitted Pixi Panel's retained Graphics to Control.theme and all child Resource changes. */
export function bindCanvasControlThemeStyleBox(
  graphics: Graphics,
  fallback: GodotStyleBox,
  name: string,
  defaultThemeType: string,
  rect: () => { readonly width: number; readonly height: number },
): () => void {
  releaseCanvasControlThemeStyleBox(graphics);
  const release = bindControlThemeConsumer(graphics, () => {
    const size = rect();
    drawStyleBoxPixi(
      graphics,
      controlThemeStyleBox(graphics, fallback, name, defaultThemeType),
      size.width,
      size.height,
    );
  });
  CANVAS_CONTROL_THEME_RELEASES.set(graphics, release);
  return release;
}

const CANVAS_CONTROL_THEME_RELEASES = new WeakMap<Graphics, () => void>();

export function releaseCanvasControlThemeStyleBox(graphics: Graphics): void {
  CANVAS_CONTROL_THEME_RELEASES.get(graphics)?.();
  CANVAS_CONTROL_THEME_RELEASES.delete(graphics);
}

function applyCanvasStyleBoxTexture(
  slice: NineSliceSprite,
  style: GodotStyleBox,
  width: number,
  height: number,
): void {
  if (!(style instanceof GodotStyleBoxTexture)) {
    throw new TypeError(
      'godot-compat: a retained NineSliceSprite Panel requires a StyleBoxTexture theme item.',
    );
  }
  const texture = style.getTexture();
  if (texture !== null && !(texture instanceof Texture)) {
    throw new TypeError(
      'godot-compat: canvas StyleBoxTexture requires its project-owned Pixi Texture identity.',
    );
  }
  if (
    style.regionRect.x !== 0 ||
    style.regionRect.y !== 0 ||
    style.regionRect.width !== 0 ||
    style.regionRect.height !== 0
  ) {
    throw new Error(
      'godot-compat: canvas StyleBoxTexture.region_rect requires a retained framed Pixi Texture.',
    );
  }
  if (style.horizontalAxisStretchMode !== 0 || style.verticalAxisStretchMode !== 0) {
    throw new Error(
      'godot-compat: Pixi NineSliceSprite cannot preserve tiled StyleBoxTexture axes.',
    );
  }
  if (!style.drawCenter) {
    throw new Error(
      'godot-compat: Pixi NineSliceSprite cannot omit the StyleBoxTexture center quad.',
    );
  }
  if (style.expandMargin.some((margin) => margin !== 0)) {
    throw new Error(
      'godot-compat: StyleBoxTexture expand margins require a separate retained draw entity.',
    );
  }
  const [left, top, right, bottom] = style.textureMargin;
  slice.texture = texture ?? Texture.EMPTY;
  slice.leftWidth = left;
  slice.topHeight = top;
  slice.rightWidth = right;
  slice.bottomHeight = bottom;
  slice.width = width;
  slice.height = height;
  const channel = (value: number): number => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(
        'godot-compat: native Pixi StyleBoxTexture modulate channels must be in [0, 1].',
      );
    }
    return Math.round(value * 255);
  };
  slice.tint =
    (channel(style.modulate.r) << 16) |
    (channel(style.modulate.g) << 8) |
    channel(style.modulate.b);
  channel(style.modulate.a);
  slice.alpha = style.modulate.a;
}

/** Live Theme projection onto the native NineSliceSprite that is a textured Panel entity. */
export function bindCanvasControlThemeStyleBoxTexture(
  slice: NineSliceSprite,
  fallback: GodotStyleBoxTexture<Texture>,
  name: string,
  defaultThemeType: string,
  rect: () => { readonly width: number; readonly height: number },
): () => void {
  releaseCanvasControlThemeStyleBoxTexture(slice);
  const release = bindControlThemeConsumer(slice, () => {
    const size = rect();
    applyCanvasStyleBoxTexture(
      slice,
      controlThemeStyleBox(slice, fallback, name, defaultThemeType),
      size.width,
      size.height,
    );
  });
  CANVAS_CONTROL_TEXTURE_STYLE_RELEASES.set(slice, release);
  return release;
}

export function resizeCanvasControlThemeStyleBoxTexture(
  slice: NineSliceSprite,
  fallback: GodotStyleBoxTexture<Texture>,
  width: number,
  height: number,
): void {
  applyCanvasStyleBoxTexture(
    slice,
    controlThemeStyleBox(slice, fallback, 'panel', 'Panel'),
    width,
    height,
  );
}

const CANVAS_CONTROL_TEXTURE_STYLE_RELEASES = new WeakMap<NineSliceSprite, () => void>();

export function releaseCanvasControlThemeStyleBoxTexture(slice: NineSliceSprite): void {
  CANVAS_CONTROL_TEXTURE_STYLE_RELEASES.get(slice)?.();
  CANVAS_CONTROL_TEXTURE_STYLE_RELEASES.delete(slice);
}
