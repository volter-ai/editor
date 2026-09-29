/**
 * @godot-class OS
 * @role BINDING
 *
 * Godot 4.7's `OS` singleton (`core/core_bind.cpp`, `core/os/os.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the web export's release template answers it: the
 * platform `web` (`Web`), a 32-bit single-precision release template on wasm32, not a debug build.
 */

/** The feature tags the web release template has (`OS::has_feature`, `os.cpp:466`, and the web platform's). */
const FEATURES: ReadonlySet<string> = new Set(['web', 'wasm32', '32', 'single', 'template', 'template_release', 'release']);

/**
 * @godot OS.has_feature
 * @source core/core_bind.cpp:576
 */
export function has_feature(tag_name: string): boolean {
  return FEATURES.has(String(tag_name));
}

/**
 * @godot OS.is_debug_build
 * @source core/core_bind.cpp:663
 */
export function is_debug_build(): boolean {
  return false;
}

/**
 * @godot OS.get_name
 * @source core/core_bind.cpp:489
 */
export function get_name(): string {
  return 'Web';
}
