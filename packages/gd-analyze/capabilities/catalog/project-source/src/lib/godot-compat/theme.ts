/**
 * @godot-class Theme
 * @role PROTOCOL
 *
 * Godot 4.7's `Theme` resource (`scene/resources/theme.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): items by data type, theme type and name, as a scene
 * stores them (`Type/colors/name`, `Type/constants/name`, `Type/fonts/name`, `Type/font_sizes/name`,
 * `Type/icons/name`, `Type/styles/name`, `Theme::_set`), and a default font, font size and base
 * scale. A font or font size query of a theme with a default one always finds it (`has_font`,
 * `has_font_size`). Controls look their items up through the themes of their branch (`control.ts`).
 * Its native entity is a plain object.
 */

/** Theme's data types as a scene stores them (`Theme::DataType`, `theme.h:48`). */
export type GodotThemeDataType = 'colors' | 'constants' | 'fonts' | 'font_sizes' | 'icons' | 'styles';

export interface Theme {
  /** Items by data type, then `Type/name`. */
  readonly items: Map<GodotThemeDataType, Map<string, unknown>>;
  defaultFont: unknown;
  defaultFontSize: number;
  defaultBaseScale: number;
}

const THEMES = new WeakSet<object>();

/**
 * A Theme of the properties a scene stores.
 *
 * @godot Theme (protocol)
 * @source scene/resources/theme.cpp:1927
 */
export function godot_theme_new(properties: ReadonlyMap<string, unknown> = new Map()): Theme {
  const self: Theme = { items: new Map(), defaultFont: null, defaultFontSize: -1, defaultBaseScale: 0 };
  THEMES.add(self);
  for (const [name, value] of properties) {
    if (name === 'default_font') self.defaultFont = value;
    else if (name === 'default_font_size') self.defaultFontSize = value as number;
    else if (name === 'default_base_scale') self.defaultBaseScale = value as number;
    else {
      const item = /^([^/]+)\/(colors|constants|fonts|font_sizes|icons|styles)\/(.+)$/u.exec(name);
      if (item !== null) itemsOf(self, item[2] as GodotThemeDataType).set(`${item[1] as string}/${item[3] as string}`, value);
    }
  }
  return self;
}

/**
 * @godot Theme.Theme
 * @source scene/resources/theme.cpp:1927
 */
export function construct(): Theme {
  return godot_theme_new();
}

function itemsOf(self: Theme, dataType: GodotThemeDataType): Map<string, unknown> {
  let items = self.items.get(dataType);
  if (items === undefined) {
    items = new Map();
    self.items.set(dataType, items);
  }
  return items;
}

/**
 * Whether a value is a Theme.
 *
 * @godot Theme (protocol)
 * @source scene/resources/theme.cpp:1927
 */
export function godot_theme_is(value: unknown): value is Theme {
  return typeof value === 'object' && value !== null && THEMES.has(value);
}

/**
 * The theme's item of a data type, name and theme type, if it has one: a font or font size falls
 * back to the theme's default (`Theme::has_theme_item`, `get_theme_item`).
 *
 * @godot Theme (protocol)
 * @source scene/resources/theme.cpp:1009
 */
export function godot_theme_item(self: Theme, dataType: GodotThemeDataType, name: string, themeType: string): { readonly value: unknown } | undefined {
  const items = self.items.get(dataType);
  const key = `${themeType}/${name}`;
  if (items?.has(key) === true && items.get(key) !== null) return { value: items.get(key) };
  if (dataType === 'fonts' && self.defaultFont !== null) return { value: self.defaultFont };
  if (dataType === 'font_sizes' && self.defaultFontSize > 0) return { value: self.defaultFontSize };
  return undefined;
}

/**
 * @godot Theme.set_default_font
 * @source scene/resources/theme.cpp:234
 */
export function set_default_font(self: Theme, font: unknown): void {
  self.defaultFont = font;
}

/**
 * @godot Theme.get_default_font
 * @source scene/resources/theme.cpp:252
 */
export function get_default_font(self: Theme): unknown {
  return self.defaultFont;
}

/**
 * @godot Theme.has_default_font
 * @source scene/resources/theme.cpp:256
 */
export function has_default_font(self: Theme): boolean {
  return self.defaultFont !== null;
}

/**
 * @godot Theme.set_default_font_size
 * @source scene/resources/theme.cpp:260
 */
export function set_default_font_size(self: Theme, font_size: number): void {
  self.defaultFontSize = font_size;
}

/**
 * @godot Theme.get_default_font_size
 * @source scene/resources/theme.cpp:270
 */
export function get_default_font_size(self: Theme): number {
  return self.defaultFontSize;
}

/**
 * @godot Theme.has_default_font_size
 * @source scene/resources/theme.cpp:274
 */
export function has_default_font_size(self: Theme): boolean {
  return self.defaultFontSize > 0;
}
