/**
 * read/project-settings.ts — `project.godot` → the static project facts translation needs.
 *
 * `project.godot` is the Godot lane's `default.project.json`: the file that says where a project
 * STARTS. These sections are load-bearing for analysis and the rest is presentation:
 *
 *   `[application] run/main_scene` — the entry point, and therefore the root of reachability
 *   `[autoload]`                   — Godot's singletons, live in every scene, named globally
 *   `[input]`                      — the action vocabulary every `Input.is_action_*` call cites
 *   `_global_script_classes`       — the `class_name` registry (base class included), which is
 *                                    the AUTHORITATIVE class↔file mapping and the reason S0 can
 *                                    report class names without parsing a line of GDScript
 *   `[display] window/size`        — a 2D Godot game's coordinate space. Every authored position
 *                                    in every `.tscn` is in it, so it is the only honest source
 *                                    for a translated project's `resolution`, and a `Control` that
 *                                    anchors to the viewport has no size without it.
 *   `[rendering]`                  — the RENDERER the project declares, which is what its authored
 *                                    colours MEAN. A Godot 3 project on `GLES2` shades in gamma
 *                                    space with no tonemapper, so the same albedo float renders as
 *                                    a different pixel than it would under a linear/ACES pipeline
 *                                    — dropping this section silently recolours the whole game
 *                                    (`translate/rendering.ts` is what reads it).
 *   `[physics]`                    — fixed tick rate plus Godot's resolved 2D/3D gravity; a custom
 *                                    project setting must not be replaced by a translator constant.
 *   `[editor] script_templates…`   — exact directory of placeholder-bearing templates that the
 *                                    editor expands before the GDScript frontend ever sees them
 *
 * Everything else (`[editor_plugins]`, `[layer_names]`, …) is left in the parsed document and read
 * by nobody, deliberately: a field with no reader is a field that rots. That is also why only the
 * `[rendering]` keys with a translation are lifted out of it: `vram_compression/*` describes
 * an import-time texture format this lane never reaches.
 */

import type {
  EngineVersion,
  GlobalClass,
  InputAction,
  InputEventBinding,
  ProjectRuntimeRoot,
  RenderingSettings,
} from './godot-types';
import type { GodotValue } from './godot-value';
import { asNumber, asString, stringItems } from './godot-value';
import type { ResolvedSetting } from './known-settings';
import { resolveKnownSettings } from './known-settings';
import type { GodotSection, GodotTextFile } from './text-format';

export interface ProjectSettings {
  readonly projectName?: string;
  readonly mainScene?: string;
  readonly mainLoopType: string;
  readonly runtimeRoots: readonly ProjectRuntimeRoot[];
  readonly audioBusLayout: string;
  /** The explicitly-authored bus layout path; absent means Godot's conventional default path. */
  readonly authoredAudioBusLayout?: string;
  /** `[editor] script_templates_search_path`: editor templates contain placeholders such as
   * `%BASE%` and are expanded before compilation; they are not runtime GDScript sources. */
  readonly scriptTemplatesSearchPath?: string;
  readonly openXrActionMap?: string;
  readonly engine: EngineVersion;
  /** Autoload name → its raw target, `*`-prefix and all. Resolved by `godot-project.ts`. */
  readonly autoloadTargets: readonly (readonly [string, string])[];
  readonly inputActions: readonly InputAction[];
  readonly globalClasses: readonly GlobalClass[];
  /** The project's declared VIEWPORT size, when it declares both extents — see
   *  {@link windowSizeKeys} for the two spellings that answer this. */
  readonly window?: { readonly width: number; readonly height: number };
  /**
   * `[physics] common/physics_fps` (Godot 3) or `common/physics_ticks_per_second` (Godot 4) — the
   * FIXED rate Godot's `Main::iteration` steps `_physics_process` at, distinct from the render
   * frame `_process` runs on. Absent when the project declares neither; the caller defaults it to
   * Godot's own 60.
   */
  readonly physicsFps?: number;
  /** `[physics] common/physics_interpolation`, absent when the project uses Godot's false default. */
  readonly physicsInterpolation?: boolean;
  /**
   * `[physics] 2d/default_gravity` (Godot default `980`) times
   * `2d/default_gravity_vector` (Godot default `(0, 1)`) — the gravity a translated canvas
   * project's shared Rapier world uses. Always present, including when the project relies on
   * Godot's defaults.
   */
  readonly gravity2D: { readonly x: number; readonly y: number };
  /**
   * `[physics] 3d/default_gravity` (a scalar, Godot's own engine default `9.8`) times
   * `3d/default_gravity_vector` (a unit `Vector3`, Godot's own default `(0, -1, 0)`) — the gravity
   * a shared Rapier 3D world is created with. ALWAYS present — Godot's own engine default applies
   * when the project declares neither key, rather than an invented zero. Rapier applies world
   * gravity only to DYNAMIC bodies, so this is inert for an all-kinematic game (every measured 3D
   * fixture so far) and correct the moment a translated `RigidBody` needs it.
   */
  readonly gravity3D: { readonly x: number; readonly y: number; readonly z: number };
  /**
   * `[physics] 3d/default_linear_damp` and `3d/default_angular_damp` — the damping Godot integrates
   * every `RigidBody` with that leaves its own `linear_damp`/`angular_damp` at the authored `-1`
   * ("use the project's"). ALWAYS present: Godot's own registered default is `0.1` for each, so a
   * project declaring neither key still damps — measured in the real 3.6 binary, where
   * `ProjectSettings.get_setting("physics/3d/default_linear_damp")` on a project with no `[physics]`
   * damping keys returns `0.1`.
   *
   * Rapier's own default is `0`, which is why this has to be carried explicitly rather than left to
   * the backend: an undamped translated projectile flies measurably further than the real one.
   */
  readonly damping3D: { readonly linear: number; readonly angular: number };
  /** `[rendering]`'s two translated keys. Always present; its own fields are the optional ones. */
  readonly rendering: RenderingSettings;
  /**
   * The whitelisted `ProjectSettings.get_setting` keys (`read/known-settings.ts`) resolved to their
   * TYPED value — declared, or Godot's registered default — so the emitter can inline a
   * `get_setting("physics/3d/default_gravity")` at its value and its type. A key not in this map is
   * one this lane has not measured, and refuses rather than guessing.
   */
  readonly resolvedSettings: ReadonlyMap<string, ResolvedSetting>;
  /** Every authored ProjectSettings key plus every pinned registered default this reader knows. */
  readonly projectSettings: ReadonlyMap<string, GodotValue>;
}

function allProjectSettings(
  file: GodotTextFile,
  resolved: ReadonlyMap<string, ResolvedSetting>,
): ReadonlyMap<string, GodotValue> {
  const values = new Map<string, GodotValue>();
  for (const [key, value] of Object.entries(file.leading)) values.set(key, value);
  for (const section of file.sections) {
    for (const [key, value] of Object.entries(section.properties)) {
      values.set(`${section.kind}/${key}`, value);
    }
  }
  for (const [key, setting] of resolved) {
    if (!values.has(key)) values.set(key, setting.value);
  }
  return values;
}

function nonEmptyPath(value: GodotValue | undefined): string | undefined {
  const result = asString(value)?.trim();
  return result === undefined || result === '' ? undefined : result;
}

/**
 * Project-owned resources the 4.7 PLAYER loads during startup, even when no scene cites them.
 * Keep these source-adjacent anchors beside the parser that owns the settings:
 *
 * - `main/main.cpp:3928-3954` boot splash; `3839-3848` cursor; `4753-4793` TLS + icons
 * - `scene/theme/theme_db.cpp:57-80` project theme/font
 * - `core/string/translation_server.cpp:758-770` project translations
 * - `core/io/resource_loader.cpp:1442-1485,1562-1577` locale resource remaps
 *
 * Pinned source: Godot 4.7-stable, commit 5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88.
 */
function readRuntimeRoots(file: GodotTextFile): ProjectRuntimeRoot[] {
  const roots: ProjectRuntimeRoot[] = [];
  const push = (mechanism: ProjectRuntimeRoot['mechanism'], value: GodotValue | undefined): void => {
    const resPath = nonEmptyPath(value);
    if (resPath !== undefined) roots.push({ mechanism, resPath });
  };

  const application = section(file, 'application');
  const display = section(file, 'display');
  const gui = section(file, 'gui');
  const internationalization = section(file, 'internationalization');
  const locale = section(file, 'locale');
  const network = section(file, 'network');
  push('boot-splash', application?.properties['boot_splash/image']);
  push('application-icon', application?.properties['config/icon']);
  push('macos-native-icon', application?.properties['config/macos_native_icon']);
  push('windows-native-icon', application?.properties['config/windows_native_icon']);
  push('custom-cursor', display?.properties['mouse_cursor/custom_image']);
  push('custom-theme', gui?.properties['theme/custom']);
  push('custom-font', gui?.properties['theme/custom_font']);
  push('tls-certificate-bundle', network?.properties['tls/certificate_bundle_override']);

  for (const resPath of stringItems(internationalization?.properties['locale/translations'])) {
    roots.push({ mechanism: 'project-translation', resPath });
  }
  for (const [setting, value] of Object.entries(locale?.properties ?? {})) {
    if (setting !== 'translations' && !setting.startsWith('translations_')) continue;
    for (const resPath of stringItems(value)) {
      roots.push({ mechanism: 'project-translation', resPath });
    }
  }
  const remaps = internationalization?.properties['locale/translation_remaps'];
  if (remaps?.kind === 'dict') {
    for (const entry of remaps.entries) {
      if (entry.key.trim() !== '') {
        roots.push({ mechanism: 'translation-remap-source', resPath: entry.key });
      }
      for (const localized of stringItems(entry.value)) {
        const split = localized.lastIndexOf(':');
        const target = (split < 0 ? localized : localized.slice(0, split)).trim();
        if (target !== '') roots.push({ mechanism: 'translation-remap-target', resPath: target });
      }
    }
  }
  return roots;
}

function section(file: GodotTextFile, kind: string): GodotSection | undefined {
  return file.sections.find((s) => s.kind === kind);
}

/**
 * `config_version` → engine major. Godot writes `4` for the whole 3.x line and `5` for 4.x; those
 * are the only two values a project this reader can open carries, so anything else maps to
 * `undefined` rather than to an invented number.
 */
function majorFor(configVersion: number | undefined): number | undefined {
  if (configVersion === 4) return 3;
  if (configVersion === 5) return 4;
  return undefined;
}

/**
 * The `[display]` keys that hold the project's viewport extents, for the engine major in hand.
 *
 * Godot 4 renamed the pair: 3.x writes `window/size/width|height` and 4.x writes
 * `window/size/viewport_width|viewport_height` (4.x's `window/size/window_width_override` is the
 * separate "open the OS window bigger than the viewport" setting and is NOT this). The two
 * spellings are read per MAJOR rather than by trying both, because "which key does this project
 * use" is a fact about its engine, and a reader that fell back would answer a 4.x project's size
 * from a 3.x key it cannot have — and answer `undefined` the same way for a project that declares
 * neither.
 *
 * This is not cosmetic and it is not only a window: every `Control` anchor in the game resolves
 * against this rect (`translate/data/control-layout.ts`), so reading it from the wrong key lays the
 * whole HUD out in a viewport the project never declared.
 */
function windowSizeKeys(major: number | undefined): { width: string; height: string } {
  return major === 4
    ? { width: 'window/size/viewport_width', height: 'window/size/viewport_height' }
    : { width: 'window/size/width', height: 'window/size/height' };
}

function readInputActions(file: GodotTextFile): InputAction[] {
  const input = section(file, 'input');
  if (input === undefined) return [];
  return Object.entries(input.properties).map(([name, value]) => {
    if (value.kind !== 'dict') return { name, eventCount: 0, eventTypes: [], events: [] };
    const deadzone = asNumber(value.entries.find((e) => e.key === 'deadzone')?.value);
    const eventsValue = value.entries.find((e) => e.key === 'events')?.value;
    const items: readonly GodotValue[] = eventsValue?.kind === 'array' ? eventsValue.items : [];
    // Godot writes each binding as `Object( InputEventKey, "scancode":32, … )`: the event class is
    // the constructor's FIRST positional argument, a bare identifier.
    const events: InputEventBinding[] = items.flatMap((item) => {
      if (item.kind !== 'ctor') return [];
      const first = item.args[0];
      if (first?.kind !== 'ident') return [];
      const fields: Record<string, number | boolean> = {};
      for (const field of item.fields) {
        if (field.value.kind === 'number' || field.value.kind === 'bool') {
          fields[field.key] = field.value.value;
        }
      }
      return [{ eventClass: first.name, fields }];
    });
    return {
      name,
      ...(deadzone === undefined ? {} : { deadzone }),
      eventCount: items.length,
      eventTypes: events.map((event) => event.eventClass),
      events,
    };
  });
}

function readGlobalClasses(file: GodotTextFile): GlobalClass[] {
  const registry = file.leading['_global_script_classes'];
  if (registry?.kind !== 'array') return [];
  return registry.items.flatMap((item) => {
    if (item.kind !== 'dict') return [];
    const get = (key: string): string | undefined =>
      asString(item.entries.find((e) => e.key === key)?.value);
    const className = get('class');
    const resPath = get('path');
    if (className === undefined || resPath === undefined) return [];
    return [
      {
        className,
        base: get('base') ?? '',
        language: get('language') ?? '',
        resPath,
      },
    ];
  });
}

/**
 * A `Color( r, g, b, a )` project setting as a CSS hex string, with Godot's own float→byte rule.
 *
 * Godot writes these channels with no transfer function: a frame cleared to `Color(0.3,0.3,0.3)`
 * saves as byte 77, and the same value used as ambient light lands the white ground at byte 78.
 * So `round(channel * 255)` IS the conversion, not an approximation of one.
 */
function readColorSetting(value: GodotValue | undefined): string | undefined {
  if (value?.kind !== 'ctor' || value.name !== 'Color') return undefined;
  const channels = value.args.flatMap((arg) => (arg.kind === 'number' ? [arg.value] : []));
  if (channels.length < 3) return undefined;
  const byte = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(channels[0] as number)}${byte(channels[1] as number)}${byte(channels[2] as number)}`;
}

function readRendering(file: GodotTextFile, major: number | undefined): RenderingSettings {
  const rendering = section(file, 'rendering');
  const renderingMethod =
    major === 4
      ? (asString(rendering?.properties['renderer/rendering_method']) ?? 'forward_plus')
      : undefined;
  const driverName = asString(rendering?.properties['quality/driver/driver_name']);
  const msaa = asNumber(
    rendering?.properties[
      major === 4 ? 'anti_aliasing/quality/msaa_3d' : 'quality/filters/msaa'
    ],
  );
  const authoredAnisotropicFilterLevel = asNumber(
    rendering?.properties[
      major === 4
        ? 'textures/default_filters/anisotropic_filtering_level'
        : 'quality/filters/anisotropic_filter_level'
    ],
  );
  // Godot 3 stores the actual maximum sample count (2/4/8/16). Godot 4 stores its base-two
  // exponent (0 disables it, 1/2/3/4 mean 2x/4x/8x/16x). Three wants the actual sample count;
  // anisotropy=1 is its disabled value.
  const anisotropicFilterLevel =
    authoredAnisotropicFilterLevel === undefined
      ? undefined
      : major === 4
        ? authoredAnisotropicFilterLevel === 0
          ? 1
          : 2 ** authoredAnisotropicFilterLevel
        : authoredAnisotropicFilterLevel;
  const defaultClearColor = readColorSetting(
    rendering?.properties['environment/default_clear_color'],
  );
  // Godot 3 spells it `environment/default_environment`; Godot 4 moved it under `defaults/`.
  // Godot strips the value before testing it against `""` (scene_tree.cpp:2376), so a
  // whitespace-only declaration means "no fallback environment" and is read as absent here too.
  const declaredDefaultEnvironment = asString(
    rendering?.properties[
      major === 4 ? 'environment/defaults/default_environment' : 'environment/default_environment'
    ],
  )?.trim();
  const defaultEnvironment =
    declaredDefaultEnvironment === undefined || declaredDefaultEnvironment === ''
      ? undefined
      : declaredDefaultEnvironment;
  const directionalShadowSize = asNumber(
    rendering?.properties[
      major === 4
        ? 'lights_and_shadows/directional_shadow/size'
        : 'quality/directional_shadow/size'
    ],
  );
  const positionalShadowAtlasSize = major === 4
    ? asNumber(rendering?.properties['lights_and_shadows/positional_shadow/atlas_size']) ?? 4096
    : undefined;
  const positionalShadowAtlasQuadrants = major === 4
    ? ([0, 1, 2, 3].map((quadrant, index) => asNumber(
        rendering?.properties[`lights_and_shadows/positional_shadow/atlas_quadrant_${quadrant}_subdiv`],
      ) ?? [2, 2, 3, 4][index]!) as [number, number, number, number])
    : undefined;
  const positionalShadowFilterQuality = major === 4
    ? asNumber(rendering?.properties['lights_and_shadows/positional_shadow/soft_shadow_filter_quality']) ?? 2
    : undefined;
  const shadowFilterMode = asNumber(rendering?.properties['quality/shadows/filter_mode']);
  const physicalLightUnits =
    rendering?.properties['lights_and_shadows/use_physical_light_units'];
  const dofBokehShape = asNumber(
    rendering?.properties['camera/depth_of_field/depth_of_field_bokeh_shape'],
  );
  const dofBokehQuality = asNumber(
    rendering?.properties['camera/depth_of_field/depth_of_field_bokeh_quality'],
  );
  const dofUseJitter =
    rendering?.properties['camera/depth_of_field/depth_of_field_use_jitter'];
  const ssaoQuality = asNumber(rendering?.properties['environment/ssao/quality']);
  const ssaoHalfSize = rendering?.properties['environment/ssao/half_size'];
  const ssaoAdaptiveTarget = asNumber(
    rendering?.properties['environment/ssao/adaptive_target'],
  );
  const ssaoBlurPasses = asNumber(rendering?.properties['environment/ssao/blur_passes']);
  const ssaoFadeoutFrom = asNumber(rendering?.properties['environment/ssao/fadeout_from']);
  const ssaoFadeoutTo = asNumber(rendering?.properties['environment/ssao/fadeout_to']);
  const splitStream = rendering?.properties['misc/mesh_storage/split_stream'];
  return {
    ...(renderingMethod === undefined ? {} : { renderingMethod }),
    ...(driverName === undefined ? {} : { driverName }),
    ...(msaa === undefined ? {} : { msaa }),
    ...(anisotropicFilterLevel === undefined ? {} : { anisotropicFilterLevel }),
    ...(defaultClearColor === undefined ? {} : { defaultClearColor }),
    ...(defaultEnvironment === undefined ? {} : { defaultEnvironment }),
    ...(directionalShadowSize === undefined ? {} : { directionalShadowSize }),
    ...(positionalShadowAtlasSize === undefined ? {} : { positionalShadowAtlasSize }),
    ...(positionalShadowAtlasQuadrants === undefined ? {} : { positionalShadowAtlasQuadrants }),
    ...(positionalShadowFilterQuality === undefined ? {} : { positionalShadowFilterQuality }),
    ...(shadowFilterMode === undefined ? {} : { shadowFilterMode }),
    ...(physicalLightUnits?.kind === 'bool'
      ? { physicalLightUnits: physicalLightUnits.value }
      : {}),
    ...(dofBokehShape === undefined ? {} : { dofBokehShape }),
    ...(dofBokehQuality === undefined ? {} : { dofBokehQuality }),
    ...(dofUseJitter?.kind === 'bool' ? { dofUseJitter: dofUseJitter.value } : {}),
    ...(ssaoQuality === undefined ? {} : { ssaoQuality }),
    ...(ssaoHalfSize?.kind === 'bool' ? { ssaoHalfSize: ssaoHalfSize.value } : {}),
    ...(ssaoAdaptiveTarget === undefined ? {} : { ssaoAdaptiveTarget }),
    ...(ssaoBlurPasses === undefined ? {} : { ssaoBlurPasses }),
    ...(ssaoFadeoutFrom === undefined ? {} : { ssaoFadeoutFrom }),
    ...(ssaoFadeoutTo === undefined ? {} : { ssaoFadeoutTo }),
    ...(splitStream?.kind === 'bool' ? { meshSplitStream: splitStream.value } : {}),
  };
}

/**
 * The FIXED physics rate `_physics_process` is stepped at. Godot 3 spells it
 * `[physics] common/physics_fps`, Godot 4 `common/physics_ticks_per_second`; they are the same
 * setting under two names, so either answers. Absent when the project declares neither — the caller
 * defaults it to Godot's own 60 rather than this reader inventing one.
 */
function readPhysicsFps(file: GodotTextFile): number | undefined {
  const physics = section(file, 'physics');
  return (
    asNumber(physics?.properties['common/physics_fps']) ??
    asNumber(physics?.properties['common/physics_ticks_per_second'])
  );
}

/** `Vector3( x, y, z )`, read locally rather than imported from a `translate/` module — this file
 *  is the READ layer and must not depend on translation. */
function readVector3(
  value: GodotValue | undefined,
): { x: number; y: number; z: number } | undefined {
  if (value?.kind !== 'ctor' || value.name !== 'Vector3') return undefined;
  const [x, y, z] = value.args;
  if (x?.kind !== 'number' || y?.kind !== 'number' || z?.kind !== 'number') return undefined;
  return { x: x.value, y: y.value, z: z.value };
}

function readVector2(value: GodotValue | undefined): { x: number; y: number } | undefined {
  if (value?.kind !== 'ctor' || value.name !== 'Vector2') return undefined;
  const [x, y] = value.args;
  if (x?.kind !== 'number' || y?.kind !== 'number') return undefined;
  return { x: x.value, y: y.value };
}

/** Godot's registered 2D gravity defaults, combined with either half a project overrides. */
function readGravity2D(file: GodotTextFile): { x: number; y: number } {
  const physics = section(file, 'physics');
  const scalar = asNumber(physics?.properties['2d/default_gravity']) ?? 980;
  const vector = readVector2(physics?.properties['2d/default_gravity_vector']) ?? { x: 0, y: 1 };
  return { x: scalar * vector.x, y: scalar * vector.y };
}

/**
 * `[physics] 3d/default_gravity` * `3d/default_gravity_vector` — see {@link ProjectSettings.gravity3D}.
 *
 * Godot's own registered defaults (`ProjectSettings::_add_property_info_bind` in `main.cpp`) are
 * `9.8` and `(0, -1, 0)`; a project that declares NEITHER key gets that default rather than an
 * invented zero, and one that declares only one of the two gets it combined with the other's
 * default — exactly how Godot's own `ProjectSettings.get_setting` resolves a partially-overridden
 * pair.
 */
function readGravity3D(file: GodotTextFile): { x: number; y: number; z: number } {
  const physics = section(file, 'physics');
  const scalar = asNumber(physics?.properties['3d/default_gravity']) ?? 9.8;
  const vector = readVector3(physics?.properties['3d/default_gravity_vector']) ?? {
    x: 0,
    y: -1,
    z: 0,
  };
  return { x: scalar * vector.x, y: scalar * vector.y, z: scalar * vector.z };
}

/**
 * `[physics] 3d/default_linear_damp` / `3d/default_angular_damp` — see
 * {@link ProjectSettings.damping3D}. Godot registers `0.1` for both; a project that declares
 * neither gets that, exactly as its own `ProjectSettings.get_setting` resolves them.
 */
function readDamping3D(file: GodotTextFile): { linear: number; angular: number } {
  const physics = section(file, 'physics');
  return {
    linear: asNumber(physics?.properties['3d/default_linear_damp']) ?? 0.1,
    angular: asNumber(physics?.properties['3d/default_angular_damp']) ?? 0.1,
  };
}

export function readProjectSettings(file: GodotTextFile): ProjectSettings {
  const application = section(file, 'application');
  const configVersion = asNumber(file.leading['config_version']);
  const major = majorFor(configVersion);
  const autoload = section(file, 'autoload');
  const audio = section(file, 'audio');
  const editor = section(file, 'editor');
  const xr = section(file, 'xr');
  const display = section(file, 'display');
  const sizeKeys = windowSizeKeys(major);
  const width = asNumber(display?.properties[sizeKeys.width]);
  const height = asNumber(display?.properties[sizeKeys.height]);
  const physicsFps = readPhysicsFps(file);
  const physicsInterpolationValue = section(file, 'physics')?.properties[
    'common/physics_interpolation'
  ];
  const physicsInterpolation =
    physicsInterpolationValue?.kind === 'bool' ? physicsInterpolationValue.value : undefined;
  const authoredAudioBusLayout = nonEmptyPath(audio?.properties['buses/default_bus_layout']);
  const resolvedSettings = resolveKnownSettings(file);

  return {
    mainLoopType: nonEmptyPath(application?.properties['run/main_loop_type']) ?? 'SceneTree',
    runtimeRoots: readRuntimeRoots(file),
    audioBusLayout: authoredAudioBusLayout ?? 'res://default_bus_layout.tres',
    ...(authoredAudioBusLayout === undefined ? {} : { authoredAudioBusLayout }),
    ...(nonEmptyPath(editor?.properties['script_templates_search_path']) === undefined
      ? {}
      : {
          scriptTemplatesSearchPath: nonEmptyPath(
            editor?.properties['script_templates_search_path'],
          ) as string,
        }),
    ...(xr?.properties['openxr/enabled']?.kind === 'bool' &&
    xr.properties['openxr/enabled'].value
      ? {
          openXrActionMap:
            nonEmptyPath(xr.properties['openxr/default_action_map']) ??
            'res://openxr_action_map.tres',
        }
      : {}),
    rendering: readRendering(file, major),
    resolvedSettings,
    projectSettings: allProjectSettings(file, resolvedSettings),
    ...(physicsFps === undefined ? {} : { physicsFps }),
    ...(physicsInterpolation === undefined ? {} : { physicsInterpolation }),
    gravity2D: readGravity2D(file),
    gravity3D: readGravity3D(file),
    damping3D: readDamping3D(file),
    ...(width === undefined || height === undefined ? {} : { window: { width, height } }),
    ...(asString(application?.properties['config/name']) === undefined
      ? {}
      : { projectName: asString(application?.properties['config/name']) as string }),
    ...(asString(application?.properties['run/main_scene']) === undefined
      ? {}
      : { mainScene: asString(application?.properties['run/main_scene']) as string }),
    engine: {
      ...(configVersion === undefined ? {} : { configVersion }),
      ...(major === undefined ? {} : { major }),
      // `config/features` is a Godot 4 key. Its ABSENCE on a `config_version=4` project is
      // consistent evidence, not a hole — see vendor/extension-api/UPSTREAM.md.
      features: stringItems(application?.properties['config/features']),
    },
    autoloadTargets: Object.entries(autoload?.properties ?? {}).flatMap(([name, value]) => {
      const raw = asString(value);
      return raw === undefined ? [] : [[name, raw] as const];
    }),
    inputActions: readInputActions(file),
    globalClasses: readGlobalClasses(file),
  };
}
