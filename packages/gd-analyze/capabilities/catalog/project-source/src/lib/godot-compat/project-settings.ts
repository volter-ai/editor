/**
 * @godot-class ProjectSettings
 * @role PROTOCOL
 *
 * Godot 4.7's `ProjectSettings` singleton (`core/config/project_settings.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the project's settings, which Godot loads from
 * `project.godot` over its registered defaults before any script runs (`Main::setup`,
 * `main/main.cpp:2102`). The translated project loads the settings its scripts read, each at the
 * value project facts fix for it, when its world module is evaluated. A singleton: members take no
 * receiver.
 */

import { construct as color } from './color';
import { construct as vector2 } from './vector2';
import { construct as vector3 } from './vector3';

const SETTINGS = new Map<string, unknown>();

/** A setting's value as the project's settings file holds it: a primitive, or `{ Vector3: [...] }`. */
export type GodotSettingJson = number | boolean | string | { readonly Vector2: readonly number[] } | { readonly Vector3: readonly number[] } | { readonly Color: readonly number[] };

function settingValue(value: GodotSettingJson): unknown {
  if (typeof value !== 'object') return value;
  if ('Vector2' in value) return vector2(...(value.Vector2 as [number, number]));
  if ('Vector3' in value) return vector3(...(value.Vector3 as [number, number, number]));
  return color(...(value.Color as [number, number, number, number]));
}

/**
 * Loads the project's settings from its settings file (`src/project/settings.json`: each setting's
 * key and value), replacing any loaded before.
 *
 * @godot ProjectSettings (protocol)
 * @source core/config/project_settings.cpp:870
 */
export function godot_project_settings_load_json(entries: readonly (readonly [string, GodotSettingJson])[]): void {
  godot_project_settings_load(entries.map(([key, value]) => [key, settingValue(value)] as const));
}

/**
 * Loads the project's settings (`ProjectSettings::setup`), replacing any loaded before.
 *
 * @godot ProjectSettings (protocol)
 * @source core/config/project_settings.cpp:870
 */
export function godot_project_settings_load(values: Iterable<readonly [string, unknown]>): void {
  SETTINGS.clear();
  for (const [name, value] of values) SETTINGS.set(name, value);
}

/**
 * The setting's value when the project has it, else `default_value`.
 *
 * @godot ProjectSettings.get_setting
 * @source core/config/project_settings.cpp:1408
 */
export function get_setting(name: string, default_value: unknown = null): unknown {
  return SETTINGS.has(name) ? SETTINGS.get(name) : default_value;
}
