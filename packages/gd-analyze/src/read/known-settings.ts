/**
 * read/known-settings.ts — the project settings a translated script may READ, resolved to a TYPED
 * value at project-load time.
 *
 * `ProjectSettings.get_setting("physics/3d/default_gravity")` reads a value Godot fixed at project
 * load from `project.godot` — it has no runtime shape a backend could present (see
 * `registry/emitter-resolved.ts`). So the emitter inlines the value, exactly as `resolutionOf`
 * inlines a `[display]` setting. Two facts make that sound and a NaN-free:
 *
 *   1. the value must carry its VARIANT TYPE, so `float * Vector3` in enemy.gd:13 spells as a
 *      scalar-times-vector (`mul3(vec3(0,-1,0), 14)`), never a vector-times-vector. The analyzer
 *      reads {@link KNOWN_SETTINGS}'s `variant` to type the `get_setting` call; the emitter reads
 *      {@link resolveKnownSettings}'s value to spell it.
 *   2. a setting whose type/default this lane has not measured is NOT in the table, so it REFUSES
 *      by name rather than inventing an untyped value.
 *
 * This is a WHITELIST of measured settings, not a general ProjectSettings model — a general one
 * would be a second copy of the project's own configuration. Each entry earns its place by a
 * fixture that reaches it. Engine-registered settings carry Godot's own default for the case the
 * project declares none; typed custom settings deliberately do not.
 */

import type { GodotValue } from './godot-value';
import type { GodotTextFile } from './text-format';

/** The Variant type a known setting holds — what the analyzer types the `get_setting` call as. */
export type SettingVariant = 'float' | 'Vector3' | 'String';

/** One measured project setting: where it lives in `project.godot`, its type, and any registered default. */
export interface KnownSetting {
  /** The `[section]` the key lives under. */
  readonly section: string;
  /** The property key inside that section (`3d/default_gravity`). */
  readonly key: string;
  /** The Variant type Godot's value carries. */
  readonly variant: SettingVariant;
  /** Godot's own registered default, used when the project declares none. Custom settings omit it. */
  readonly default?: GodotValue;
}

/** A known setting resolved to the value a translated script reads — declared, or Godot's default. */
export interface ResolvedSetting {
  readonly variant: SettingVariant;
  readonly value: GodotValue;
}

const vec3 = (x: number, y: number, z: number): GodotValue => ({
  kind: 'ctor',
  name: 'Vector3',
  args: [
    { kind: 'number', value: x },
    { kind: 'number', value: y },
    { kind: 'number', value: z },
  ],
  fields: [],
});

/**
 * The whitelist, keyed by the `get_setting` path a script writes. Godot 3.x defaults verified
 * against the engine's `ProjectSettings` registration: `physics/3d/default_gravity` is `9.8` and
 * `physics/3d/default_gravity_vector` is `Vector3(0, -1, 0)`.
 */
export const KNOWN_SETTINGS: Readonly<Record<string, KnownSetting>> = {
  'game_gui/gui_scale': {
    section: 'game_gui',
    key: 'gui_scale',
    variant: 'float',
  },
  'physics/3d/default_gravity': {
    section: 'physics',
    key: '3d/default_gravity',
    variant: 'float',
    default: { kind: 'number', value: 9.8 },
  },
  'physics/3d/default_gravity_vector': {
    section: 'physics',
    key: '3d/default_gravity_vector',
    variant: 'Vector3',
    default: vec3(0, -1, 0),
  },
  /**
   * WHICH RENDERER the project configured — the value `RenderingServer.get_current_rendering_method`
   * answers, and the only setting here no `get_setting` call reaches.
   *
   * It is in this table for the same reason the other two are: it is fixed at project load and the
   * emitter inlines it (see `registry/emitter-resolved.ts`). Godot's registered default is
   * `forward_plus` on desktop, and NEITHER Godot 4 fixture declares the key — `starter-kit`
   * corroborates it in `config/features` ("Forward Plus"), `platformer-3d-godot4` declares no
   * renderer at all and therefore takes the default. So both resolve to `forward_plus`, and both
   * games' `== "gl_compatibility"` compensation branches are correctly NOT taken, which is exactly
   * what Godot itself does running these two projects.
   */
  'rendering/renderer/rendering_method': {
    section: 'rendering',
    key: 'renderer/rendering_method',
    variant: 'String',
    default: { kind: 'string', value: 'forward_plus' },
  },
};

/** The declared value of a known setting matches the type the whitelist promises, or the value is
 *  ignored — a project that writes a Vector3 where a float belongs is not this lane's to reinterpret. */
function declaredValueMatches(variant: SettingVariant, value: GodotValue): boolean {
  if (variant === 'float') return value.kind === 'number';
  if (variant === 'String') return value.kind === 'string';
  return value.kind === 'ctor' && value.name === 'Vector3';
}

/**
 * Every known setting resolved against `project.godot` — the declared value when present and of the
 * expected type, or Godot's registered default when this table records one. A custom setting that
 * is absent or has the wrong authored type remains absent, so callers refuse instead of inventing
 * a value. A key absent from the returned map is unresolved by this lane.
 */
export function resolveKnownSettings(file: GodotTextFile): Map<string, ResolvedSetting> {
  const resolved = new Map<string, ResolvedSetting>();
  for (const [path, setting] of Object.entries(KNOWN_SETTINGS)) {
    const section = file.sections.find((s) => s.kind === setting.section);
    const declared = section?.properties[setting.key];
    const value = declared !== undefined && declaredValueMatches(setting.variant, declared)
      ? declared
      : setting.default;
    if (value === undefined) continue;
    resolved.set(path, { variant: setting.variant, value });
  }
  return resolved;
}
