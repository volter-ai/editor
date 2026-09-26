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

const SETTINGS = new Map<string, unknown>();

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
