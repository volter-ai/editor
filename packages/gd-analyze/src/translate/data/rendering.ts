/**
 * translate/data/rendering.ts — `project.godot`'s `[rendering]` section, as the emitted world's own
 * renderer configuration.
 *
 * ## Why this exists at all
 *
 * A material's `albedo_color` is not a colour until you know what renders it. Godot 3 on the GLES2
 * driver shades in GAMMA space and has no tonemapper; this engine's host renderer does linear
 * lighting with ACES and an sRGB encode on output. Feed the same authored float to both and you get
 * two different pixels — measurably so: `squash-the-creeps`'s white ground renders at byte 255 in
 * Godot 3.6 and at byte 138 through the host's defaults. Nothing in the scene translation can fix
 * that, because nothing in the scene is wrong. The PIPELINE is.
 *
 * So the emitted world declares the pipeline it was authored for — a `WorldRendererConfig`
 * (`@engine/adapter/renderer-config`) that its own `<GodotRendererPipeline />` applies to whichever
 * renderer draws it, for the life of the mount, restoring what it found after.
 *
 * ## What may be emitted, and the measurements behind each value
 *
 * Every number here was read out of Godot 3.6.stable itself (`de2f0f147`, GLES2, Apple M3 Pro),
 * never from a guess about what an engine "probably" defaults to:
 *
 *  - `ProjectSettings.get_setting("rendering/environment/default_clear_color")` → `0.3,0.3,0.3,1`,
 *    and a frame cleared to it saves as byte **77** (= 0.3 x 255) — Godot writes that colour with
 *    no transfer function. `#4d4d4d` reproduces it exactly: three converts an unlit clear colour
 *    from the working space to `outputColorSpace` (`WebGLBackground`'s `getUnlitUniformColorSpace`
 *    returns `renderer.outputColorSpace` when drawing to the canvas), so the sRGB hex whose byte
 *    value IS 77 round-trips back to 77.
 *  - `ProjectSettings.get_setting("rendering/environment/default_environment")` → **empty** IN THAT
 *    GAME. That reading is about `squash-the-creeps` and it does not generalise — see "the
 *    Environment a project has and no scene mentions" below, which is a different project doing the
 *    opposite. More
 *    importantly, Godot 3's GLES2 backend ignores an Environment's authored tonemapper too:
 *    `RasterizerSceneGLES2::environment_set_tonemap(...)` validates the Environment and returns
 *    without storing any of its arguments, and the GLES2 post-process shader has no tone curve.
 *    So `toneMapping: 'none'` is the measured DRIVER semantic whether or not the scene carries a
 *    `WorldEnvironment`. This is the field that was actually doing the damage: the host's ACES
 *    default took the ground from byte 255 to byte 138.
 *  - `ProjectSettings.get_setting("rendering/quality/filters/msaa")` → **0** (the default; this
 *    game declares `3`).
 *  - `ProjectSettings.get_setting("rendering/quality/shadows/filter_mode")` → **1** (PCF5). This
 *    one matters because the default is not "nothing": a project that declares no filter is
 *    declaring PCF5, and the host's own default is `PCFSoftShadowMap` — Godot's WIDEST filter. So
 *    an undeclared setting still emits a `shadowMapType`, or every ported game gets softer shadow
 *    edges than its author chose.
 *
 * ## `default_clear_color` is ALSO the ambient light, and that was the missing 4.3%
 *
 * This is the fact this module was originally written without, and it accounted for every colour
 * residual the previous measurement recorded as "Godot's specular". Godot 3's scene renderer, given
 * NO `Environment`, lights the scene with a global ambient whose colour is the project's
 * `default_clear_color` at energy 1. Two runs of the real game on Godot 3.6.stable measured it,
 * both with the `.tscn`'s one `DirectionalLight` hidden so nothing but ambient remained:
 *
 * | `environment/default_clear_color` | white 60x60 ground, light OFF |
 * | --- | --- |
 * | `0.3, 0.3, 0.3` (Godot's default; what this game declares) | **78, 78, 78** |
 * | `0.8, 0.1, 0.2` (planted for the experiment) | **207, 26, 52** |
 *
 * The second row is the one that proves it: the ground took the planted colour, so the ambient
 * FOLLOWS the clear colour rather than being a fixed grey. And the values are the raw channels x
 * 255 (`0.8 -> 204`, `0.1 -> 26`, `0.2 -> 51`) to within ~1%, which is Godot writing them with no
 * transfer function — the same thing the clear colour itself does.
 *
 * The consequences are everywhere and they are not subtle:
 *
 *  - The flat lit ground clipped at 255 in Godot (`N·L 0.897 + ambient 0.3 = 1.197`) where the
 *    emitted world, with no ambient at all, landed at 244. That whole 11-byte gap was ambient.
 *  - A SHADOWED surface in Godot is lit by ambient alone (`shadow_color` is black — measured), so
 *    the native shadow under a character is byte 78. Without an ambient term the same shadow in the
 *    emitted world would be BLACK, which would have made the shadow translation look wrong in a
 *    way that had nothing to do with shadows.
 *
 * ### Its colour space, which the shadow measurement pins exactly
 *
 * The ambient is emitted as an `<ambientLight>` carrying the clear colour as an ORDINARY sRGB
 * colour — three decodes `#4d4d4d` to linear 0.0742 the same way it decodes every material albedo.
 * That is not a stylistic choice; the two candidates give different pixels and the measurement
 * chooses between them. Under three's linear lighting plus sRGB output, a fully shadowed white
 * surface renders `sRGB(ambient_linear)`:
 *
 * | ambient treated as | shadowed white ground | Godot 3.6 |
 * | --- | --- | --- |
 * | an sRGB colour (linear 0.0742) | **76** | 78 |
 * | a raw linear 0.3 | 149 | 78 |
 *
 * Which is the same round-trip argument the colour-space section below makes for albedo: three's
 * sRGB encode on output undoes its own decode, so a Godot gamma-space value handed in as an sRGB
 * colour comes back out as itself.
 *
 * ### Measuring these tables: ERODE the mask before you average
 *
 * Every byte value above is a mean over a masked region of a frame, and the two frames come from
 * different renderers at different resolutions and MSAA settings. Antialiased EDGE pixels are
 * therefore blends of the region and whatever is behind it, and they are not the same blend on
 * both sides. Averaging them in moved a body-colour mean by ~20 bytes in one channel against a
 * white ground and read as a shading defect that did not exist. Erode the mask by a few pixels
 * first; a residual that survives erosion is real, one that does not was never in the shading.
 *
 * ## The colour space, and the hypothesis this measurement KILLED
 *
 * The obvious reading of "GLES2 shades in gamma space" is that the translated world should also
 * write its frame with no output transform — three's `outputColorSpace: 'srgb-linear'`, with
 * colour management off so material colours stay raw. That was measured and it is WRONG for this
 * pairing, by a wide margin:
 *
 * | sample | Godot 3.6 | `srgb-linear` out | `srgb` out |
 * | --- | --- | --- | --- |
 * | white ground, `N·L = 0.897` | 255 | 229 | 244 |
 * | `#f57c08` cylinder at `N·L = 1` | 245,124,8 | 204,26,0 | 245,124,8 |
 *
 * The reason is that three's colour management already performs the SAME round trip Godot's gamma
 * pipeline performs by construction: an authored `#f57c08` is decoded sRGB→linear when the
 * material is built and re-encoded linear→sRGB on output, so the value that lands in the
 * framebuffer is the value Godot's shader used directly. Turning the output transform off does not
 * "match gamma space" — it deletes the ENCODE half of a round trip whose DECODE half already
 * happened, and every saturated colour collapses toward black (the port's orange player rendered
 * red).
 *
 * So `outputColorSpace: 'srgb'` is emitted. It happens to be three's own default today, and it is
 * still stated rather than inherited: it is a property of the GAME (its colours mean sRGB bytes),
 * a host default is not a contract, and this exact field is one fiber's `configure()` rewrites
 * unconditionally.
 *
 * ## What is deliberately NOT emitted
 *
 *  - **The MSAA sample COUNT.** `quality/filters/msaa=3` is Godot's index for 8x. A WebGL context's
 *    sample count is fixed when the context is created, from a BOOLEAN `antialias` attribute the
 *    host renderer is constructed with long before a world exists — so multisampling itself rides
 *    the emitted `vgai.project.json`'s `rendering.antialias` (read by `runtime/mount-manifest.ts`
 *    at renderer construction) and the exact level does not: WebGL has no way to ask for one, and
 *    every desktop browser measured gives 4x. The count is a NOTE.
 *  - **Anything for a driver/operator pair this has not measured.** The exact Godot 3 GLES3 Filmic
 *    case is carried from its source shader (including exposure and white point). Other GLES3
 *    operators still get a NOTE and no config rather than an authoritative-looking approximation.
 *  - **Environment mixes Three cannot express.** Godot independently scales its panorama's
 *    reflections by `background_energy`, its diffuse sky ambient by `ambient_light_energy`, and
 *    mixes that diffuse term with `ambient_light_color` using `ambient_light_sky_contribution`.
 *    Three exposes one `scene.environmentIntensity` for both diffuse and specular image-based
 *    light. The exact all-sky/default-energy case is carried; a different authored mix keeps the
 *    panorama background but gets a NOTE instead of an authoritative-looking approximation.
 *
 * ## The Environment a project HAS and no scene mentions — `[rendering] environment/default_environment`
 *
 * `kaykit-hexagons` authors no `WorldEnvironment` anywhere and still renders a blue procedural sky,
 * because Godot 3 has a second place an Environment comes from: `SceneTree::SceneTree()` loads
 * `rendering/environment/default_environment` and installs it as the world's FALLBACK environment
 * (3.6-stable, `scene/main/scene_tree.cpp:2373-2390`), used by any viewport that supplies none of
 * its own. That path is not editor-only — the `is_editor_hint()` branch beside it only CLEARS the
 * setting when the file is missing.
 *
 * This is the same defect as the Godot 4 near-black below, arriving through the other door: every
 * instrument that reads a scene GRAPH was green while the game's whole background and fill light
 * were dropped, and the drop was silent because the resource is reachable only from
 * `project.godot`. So `project-plan.ts`'s `authoredWorldEnvironment` falls back to that setting
 * when — and only when — no node named an Environment; a node-supplied one OVERRIDES it in Godot
 * and still does here.
 *
 * What that buys, measured on the two fixtures that declare it (`kaykit-hexagons`, `rota` — both
 * `background_mode = 2` over an EMPTY `[sub_resource type="ProceduralSky"]`, so every colour is
 * Godot 3.6's own default): the horizon colour as `scene.background` and a `<hemisphereLight>` of
 * the sky/ground colours, because Godot gathers the scene's whole fill light from that sky at its
 * default `ambient_light_sky_contribution` of 1 (`drivers/gles3/shaders/scene.glsl:2011-2030`).
 * The dome CURVE, the sun disc, and kaykit's fog/SSAO/DOF are named deviations, not carries — see
 * {@link translateGodot3ProceduralSky} and ENVIRONMENT_KEY_NOTES.
 *
 * ## GODOT 4: the Environment resource is the game's WHOLE LOOK, and dropping it renders BLACK
 *
 * This module shipped reading Godot 3 only. A Godot 4 project fell through every branch to the
 * "no measured translation" note at the bottom — no renderer config, no ambient, no background —
 * and on 2026-08-16 the owner opened the `starter-kit-3d-platformer` port in a real editor and
 * found it rendering NEARLY BLACK. `scenes/main-environment.tres` authors sixteen keys, all of the
 * game's lighting among them, and NONE of them reached an emitted line. Every instrument the lane
 * owns was green, because every one of them reads a scene GRAPH; the missing one is
 * the starter-kit live viewport comparison.
 *
 * Two things came out of that, and the second matters more than the first:
 *
 *  1. **Godot 4's Environment is now translated key by key** — {@link translateGodot4Environment}.
 *  2. **NO Environment key may be dropped in silence, in either dialect.**
 *     {@link accountEnvironmentKeys} walks every key the resource authors against
 *     {@link ENVIRONMENT_KEY_NOTES}: a key a branch carried is accounted for by that branch's own
 *     note, a key three cannot express is a NAMED deviation with its mechanism, and a key this
 *     table has never classified is a `TranslateError` that halts the port. That last case is the
 *     class-killer — the defect above was an unclassified key set passing through a `?? undefined`.
 *
 * ### The Godot 4 semantics, read out of Godot 4.6's own source rather than its docs
 *
 * The docs are ambiguous where it counts and the shader is not. `ambient_light_color`'s reference
 * page says it is "Only effective if ambient_light_sky_contribution is lower than 1.0 (exclusive)",
 * which reads as "an ambient colour is ignored at the default sky contribution" — and would have
 * made this game's authored ambient a no-op. It is not, and the renderer says so plainly:
 *
 *  - `servers/rendering/renderer_rd/storage_rd/render_scene_data_rd.cpp` (4.6-stable, lines
 *    174-194) sets `ambient_light_color_energy = srgb_to_linear(ambient_light_color) *
 *    ambient_light_energy`, then `use_ambient_cubemap = (src == BG && bg == SKY) || src == SKY`
 *    and `use_ambient_light = use_ambient_cubemap || src == COLOR`.
 *  - `shaders/forward_clustered/scene_forward_clustered.glsl` (lines 1723-1738) reads
 *    `ambient_light = ambient_light_color_energy.rgb`, and mixes the cubemap in by
 *    `ambient_color_sky_mix` ONLY inside `if (USE_AMBIENT_CUBEMAP)`.
 *
 * So at `AMBIENT_SOURCE_COLOR` the sky contribution is never read and the authored colour is the
 * whole diffuse ambient. That is what this game authors (`ambient_light_source = 2`), and it is
 * carried as an `<ambientLight>` — the same mechanism, and the same `Math.PI` irradiance factor,
 * the Godot 3 GLES2 ambient above uses.
 *
 * Two more of this resource's keys are decided by the same reading:
 *
 *  - `background_color` is authored and Godot IGNORES IT: the reference page is unambiguous here
 *    ("Only effective when using the BG_COLOR background mode") and this Environment is
 *    `BG_SKY`. Emitting it as a clear colour would have put a grey-blue behind a sky that already
 *    covers the frame, and made a wrong pixel out of a key nobody authored for this mode.
 *  - `reflected_light_source` defaults to `REFLECTION_SOURCE_BG`, so with a sky background Godot
 *    DOES take specular reflections from the panorama while its diffuse ambient stays the flat
 *    colour. Three has one `scene.environment` feeding `getIBLIrradiance` and `getIBLRadiance`
 *    together, so installing the panorama there to gain the reflections would ALSO replace the
 *    diffuse term the paragraph above just carried exactly. The exact half is kept and the
 *    specular half is a named deviation.
 *
 * ### The Filmic curve is the SAME curve in both engines, so there is one emitter
 *
 * Godot 4.6's `shaders/effects/tonemap.glsl` `tonemap_filmic` and Godot 3.6's GLES3 `tonemap.glsl`
 * are algebraically identical — `exposure_bias = 2`, `A = 0.22 * bias^2`, `B = 0.30 * bias`,
 * `C = 0.10`, `D = 0.20`, `E = 0.01`, `F = 0.30`, normalized by the same curve evaluated at the
 * authored white point (Godot 4 precomputes that divisor on the CPU in
 * `servers/rendering/storage/environment_storage.cpp:287-300`; Godot 3 evaluates it in the shader).
 * So {@link EmittedPostEffect} is dialect-neutral and both branches produce the same pass.
 *
 * ### `adjustment_*` rides that same pass, because its formula is four lines
 *
 * Godot applies brightness/contrast/saturation in the tonemap shader immediately after the curve
 * (`shaders/effects/tonemap.glsl:916-935`): multiply in LINEAR, encode to sRGB, `mix(0.5, c,
 * contrast)`, then `mix(dot(vec3(1), c)/3, c, saturation)`. There is nothing to approximate, so it
 * is carried rather than noted — and it is carried in the pass that already exists rather than in a
 * post-processing STACK, which is a recorded engine decision this module does not reopen.
 */

import type { EngineVersion, RenderingSettings } from "../../read/godot-types";
import { assetUrl, TranslateError, type TranslationNote } from "./model";
import type { EmittedTextureConfig } from "./texture-import";

/**
 * The subset of `@engine/adapter/renderer-config`'s `WorldRendererConfig` this stage can honestly produce.
 *
 * Declared HERE rather than imported: this package emits SOURCE TEXT, and the emitted text is
 * type-checked against the real engine type by the port fixture's own tsconfig. A structural import
 * would couple the translator's build to the engine's without checking anything the port's
 * typecheck does not already check.
 */
export interface EmittedRendererConfig {
  readonly toneMapping: "none";
  readonly outputColorSpace: "srgb";
  /** Godot 3's `rendering/environment/default_clear_color`, as the byte value GLES2 writes. */
  readonly clearColor?: string;
  /** `[rendering] quality/shadows/filter_mode`, as three's `WebGLRenderer.shadowMap.type`. */
  readonly shadowMapType?: EmittedShadowMapType;
}

/** The `WorldShadowMapType` values this stage can produce from Godot 3's three filter modes. */
export type EmittedShadowMapType = "basic" | "pcf" | "pcf-soft";

/**
 * Godot's `adjustment_*` block: brightness, then contrast, then saturation, in that order.
 *
 * Carried rather than noted because there is nothing to approximate — the formula is four lines of
 * `shaders/effects/tonemap.glsl` and it runs in the same pass as the tone curve. See the header.
 */
export interface EmittedColorAdjustments {
  readonly brightness: number;
  readonly contrast: number;
  readonly saturation: number;
}

/**
 * A post-process whose formula is source-equivalent to the source renderer, not a named guess.
 *
 * Dialect-NEUTRAL: Godot 3.6's GLES3 Filmic and Godot 4.6's Filmic are the same Hable curve with
 * the same constants and the same white-point normalization (header, "the SAME curve in both
 * engines"), so one emitted pass serves both.
 */
export interface EmittedPostEffect {
  readonly kind: "godot-output" | "godot-filmic" | "godot-agx";
  readonly exposure: number;
  readonly white: number;
  /** Godot 4.7's AllenWP toe/shoulder contrast. Present only for `godot-agx`. */
  readonly contrast?: number;
  /** `adjustment_enabled`'s BCS stage, applied after the curve — Godot's own order. */
  readonly adjustments?: EmittedColorAdjustments;
  /** `glow_enabled`'s bloom pyramid, applied BEFORE the curve — Godot's own order. */
  readonly glow?: EmittedGlow;
  /** Godot's fixed depth/height fog, executed after the scene render and before glow/tone mapping. */
  readonly fog?: EmittedFog;
  /** Godot's exact GLES separable blur or 4.7 raster bokeh pass. */
  readonly depthOfField?: EmittedDepthOfField;
  /** Godot 4 Compatibility's exact final-post S4AO kernel. */
  readonly ambientOcclusion?: EmittedAmbientOcclusion;
  /** Godot 4 RD's exact 8x luminance pyramid and retained one-pixel exposure state. */
  readonly autoExposure?: EmittedAutoExposure;
}

export interface EmittedAutoExposure {
  readonly dialect: "godot-4";
  readonly rendererPath: "compute" | "raster";
  readonly minLuminance: number;
  readonly maxLuminance: number;
  readonly speed: number;
  readonly scale: number;
}

export interface EmittedAmbientOcclusion {
  readonly dialect: "godot-4-compatibility";
  readonly radius: number;
  readonly intensity: number;
  readonly quality: 0 | 1 | 2 | 3 | 4;
}

export type EmittedDepthOfField =
  | {
      readonly dialect: "godot-3";
      readonly farEnabled: boolean;
      readonly farDistance: number;
      readonly farTransition: number;
      readonly farAmount: number;
      readonly farQuality: 0 | 1 | 2;
      readonly nearEnabled: boolean;
      readonly nearDistance: number;
      readonly nearTransition: number;
      readonly nearAmount: number;
      readonly nearQuality: 0 | 1 | 2;
    }
  | {
      readonly dialect: "godot-4";
      readonly farEnabled: boolean;
      readonly farDistance: number;
      readonly farTransition: number;
      readonly nearEnabled: boolean;
      readonly nearDistance: number;
      readonly nearTransition: number;
      readonly amount: number;
      readonly shape: 0 | 1 | 2;
      readonly quality: 0 | 1 | 2 | 3;
      readonly rendererPath: "compute" | "raster";
    };

/** Godot 4.7's non-volumetric `Environment` fog inputs, consumed by the exact compat pass. */
export type EmittedFog =
  | {
      readonly dialect: "godot-4";
      readonly mode: 0 | 1;
      readonly lightColor: string;
      readonly lightEnergy: number;
      readonly sunScatter: number;
      readonly density: number;
      readonly height: number;
      readonly heightDensity: number;
      readonly aerialPerspective: number;
      readonly skyAffect: number;
      readonly depthCurve: number;
      readonly depthBegin: number;
      readonly depthEnd: number;
    }
  | {
      readonly dialect: "godot-3";
      readonly color: string;
      readonly density: number;
      readonly sunColor: string;
      readonly sunAmount: number;
      readonly depthEnabled: boolean;
      readonly depthBegin: number;
      readonly depthEnd: number;
      readonly depthCurve: number;
      readonly transmitEnabled: boolean;
      readonly transmitCurve: number;
      readonly heightEnabled: boolean;
      readonly heightMin: number;
      readonly heightMax: number;
      readonly heightCurve: number;
    };

/**
 * Godot's `glow_*` block as the numbers its own shaders read.
 *
 * Every field is Godot's, resolved at translate time so the emitted pass carries values rather than
 * a policy: `levels` is already normalized when `glow_normalized` asked for it (Godot normalizes in
 * `Environment::_update_glow`, not in the shader), and `levelCount` is one past the highest
 * non-zero weight so the emitted world builds only the mips it will sample.
 */
export interface EmittedGlow {
  readonly dialect: "godot-3" | "godot-4";
  /** The Environment switch; the retained pass remains mounted so runtime setters can enable it. */
  readonly enabled: boolean;
  /** The seven `glow_levels/1..7` weights, 0-INDEXED as the shader indexes them. */
  readonly levels: readonly number[];
  /** Pre-normalization values retained for exact runtime set_glow_level recomputation. */
  readonly sourceLevels: readonly number[];
  readonly normalized: boolean;
  /** How many pyramid levels the pass builds — one past the highest non-zero weight. */
  readonly levelCount: number;
  readonly intensity: number;
  readonly strength: number;
  readonly bloom: number;
  readonly hdrThreshold: number;
  readonly hdrScale: number;
  readonly luminanceCap: number;
  readonly mix: number;
  /** `GlowBlendMode`: 0 ADDITIVE, 1 SCREEN, 3 REPLACE, 4 MIX. SOFTLIGHT (2) is refused — see
   *  `translateGodot4Glow`. */
  readonly blendMode: number;
  /** Godot 3's exact per-Environment upscale sampler selection. */
  readonly bicubicUpscale?: boolean;
  /** Godot 3's alternate pyramid layout; retained while disabled, but not executable here. */
  readonly highQuality?: boolean;
}

/** A panorama the emitted world installs directly on Three's scene. */
export interface EmittedPanoramaEnvironment {
  readonly kind: "godot-panorama";
  /** The `res://` file {@link url} names — what {@link RenderingTranslation.assets} declares. */
  readonly resPath: string;
  readonly url: string;
  /** Godot 3's `background_energy` / Godot 4's `background_energy_multiplier`; scales both the
   *  visible sky and its radiance. */
  readonly energy: number;
  /** Multiplier on Three's diffuse environment entry point, after {@link energy}. */
  readonly iblDiffuse: number;
  /** Multiplier on Three's specular environment entry point, after {@link energy}. */
  readonly iblSpecular: number;
  /**
   * The sampler this image's own `.import` sidecar authored, when it authored one three's defaults
   * do not already do. Joined by the data-plan assembler — the caller that has both this
   * translation and the sidecars — because this module reads `project.godot` and the `Environment`
   * resource, and never the per-file imports. See `translate/data/texture-import.ts`.
   */
  readonly textureConfig?: EmittedTextureConfig;
}

/**
 * Godot 4 `background_mode = BG_COLOR` (1) — class_environment, Godot 4.7: "Clears the background
 * using a custom clear color." Emitted onto three's `scene.background`, because the host
 * already paints `scene.background` (`setup-three-root-adapter` / `0x1a1a2e`) and a renderer
 * `clearColor` never shows through that.
 */
export interface EmittedColorEnvironment {
  readonly kind: "godot-color";
  readonly color: string;
  readonly energy: number;
}

/**
 * Godot 4 `background_mode = BG_SKY` whose `sky` holds a `ProceduralSkyMaterial` rather than a
 * panorama image. three has no Godot sky shader; the visible carry is the authored horizon colour
 * as `scene.background`, plus a hemisphere whose sky/ground colours are the material's. The sky
 * dome curve (`sky_curve` / `ground_curve`) is a named deviation — three has no equivalent stage.
 */
export interface EmittedProceduralSkyEnvironment {
  readonly kind: "godot-procedural-sky";
  readonly skyTop: string;
  readonly skyHorizon: string;
  readonly groundBottom: string;
  readonly groundHorizon: string;
  readonly energy: number;
}

/** A Godot `samplerCube` sky whose source image was imported as six row-major faces. */
export interface EmittedCubemapEnvironment {
  readonly kind: "godot-cubemap";
  readonly resPath: string;
  readonly url: string;
  readonly arrangement: "1x6" | "2x3" | "3x2" | "6x1";
  readonly energy: number;
  readonly iblDiffuse: number;
  readonly iblSpecular: number;
}

/** Godot 4 PhysicalSkyMaterial lowered to Three's native atmospheric Sky and PMREM owner. */
export interface EmittedPhysicalSkyEnvironment {
  readonly kind: "godot-physical-sky";
  readonly radianceSize: number;
  readonly rayleighCoefficient: number;
  readonly mieCoefficient: number;
  readonly mieEccentricity: number;
  readonly turbidity: number;
  readonly iblDiffuse: number;
  readonly iblSpecular: number;
}

/** The authored sky/background the emitted R3F world installs on Three's scene. */
export type EmittedWorldEnvironment =
  | EmittedPanoramaEnvironment
  | EmittedColorEnvironment
  | EmittedProceduralSkyEnvironment
  | EmittedCubemapEnvironment
  | EmittedPhysicalSkyEnvironment;

/**
 * The world's one `<ambientLight>`: its colour, Godot's own energy on it, and WHY it is that
 * colour — the last of which is emitted as the element's comment, because the reason differs by
 * dialect and a reader of the emitted world has no other way to find it.
 */
export interface EmittedAmbientLight {
  /** A CSS hex. three decodes it sRGB -> linear, which is Godot's own `Color::srgb_to_linear`. */
  readonly color: string;
  /** `ambient_light_energy`, or 1 where the dialect has no such knob. */
  readonly energy: number;
  /** The emitted comment's first paragraph. The `Math.PI` irradiance paragraph is shared and lives
   *  in `translate/emit/world3d.ts` with the element it explains. */
  readonly reason: string;
}

/**
 * Sky-sourced ambient when Godot gathers fill light from a `ProceduralSkyMaterial`.
 *
 * three has no radiance cubemap for a generated sky, so the carry is a `<hemisphereLight>` whose
 * sky/ground colours are the material's — Godot 4.7 `AMBIENT_SOURCE_SKY` (3) "Gather ambient light
 * from the Sky regardless of what the background is."
 */
export interface EmittedHemisphereLight {
  readonly sky: string;
  readonly ground: string;
  readonly energy: number;
  readonly reason: string;
}

export interface AuthoredPanoramaSky {
  readonly resPath: string;
  readonly present: boolean;
  readonly radianceSize?: number;
}

/** Godot 4 `ProceduralSkyMaterial` colours the emitter can name. Absent keys stay undefined so
 *  the translation can fall back to Godot's own defaults rather than inventing a palette. */
export interface AuthoredProceduralSky {
  readonly skyTopColor?: string;
  readonly skyHorizonColor?: string;
  readonly groundBottomColor?: string;
  readonly groundHorizonColor?: string;
}

export interface AuthoredPhysicalSky {
  readonly radianceSize?: number;
  readonly rayleighCoefficient?: number;
  readonly mieCoefficient?: number;
  readonly mieEccentricity?: number;
  readonly turbidity?: number;
}

export interface AuthoredCubemapSky {
  readonly resPath: string;
  readonly present: boolean;
  readonly arrangement: "1x6" | "2x3" | "3x2" | "6x1";
  /** The fixture's exact sky shader multiplies the sampled cubemap by this uniform. */
  readonly exposure: number;
}

/** The Environment resource referenced by the project's authored `WorldEnvironment`. */
export interface AuthoredWorldEnvironment {
  readonly resPath: string;
  /**
   * EVERY key the `[resource]` block authors, in document order — the input to
   * {@link accountEnvironmentKeys}.
   *
   * This is what makes "an authored key either carries or is named" checkable rather than
   * aspirational. Reading only the fields below and returning is exactly how sixteen keys of this
   * game's lighting reached no emitted line and nothing said so; see the header.
   */
  readonly authoredKeys: readonly string[];
  readonly backgroundMode?: number;
  /** `background_color` as a CSS hex. Godot reads it ONLY at `BG_COLOR`. */
  readonly backgroundColor?: string;
  /** Godot 3 `background_energy` / Godot 4 `background_energy_multiplier`. */
  readonly backgroundEnergy?: number;
  /** Godot 4's `ambient_light_source` (`AmbientSource`: 0 BG, 1 DISABLED, 2 COLOR, 3 SKY). Godot 3
   *  has no such key — there, the source is implied by the background and the sky contribution. */
  readonly ambientSource?: number;
  /** `ambient_light_color` as a CSS hex. */
  readonly ambientLightColor?: string;
  readonly ambientLightEnergy?: number;
  readonly ambientLightSkyContribution?: number;
  /** Godot 4's `reflected_light_source` (`ReflectionSource`: 0 BG, 1 DISABLED, 2 SKY). */
  readonly reflectionSource?: number;
  readonly skyCustomFov?: number;
  /** Godot 4 `sky_rotation` or Godot 3 `background_sky_rotation`, in radians. */
  readonly skyRotation?: readonly [number, number, number];
  /** Godot 3 editor alias; the resource setter converts these degrees to radians. */
  readonly skyRotationDegrees?: readonly [number, number, number];
  /** Godot 3's serialized Basis, row-major exactly as the text resource writes it. */
  readonly skyOrientation?: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  readonly panorama?: AuthoredPanoramaSky;
  readonly proceduralSky?: AuthoredProceduralSky;
  readonly physicalSky?: AuthoredPhysicalSky;
  readonly cubemapSky?: AuthoredCubemapSky;
  readonly tonemapMode?: number;
  readonly tonemapExposure?: number;
  readonly tonemapWhite?: number;
  readonly tonemapAgxWhite?: number;
  readonly tonemapAgxContrast?: number;
  readonly adjustmentEnabled?: boolean;
  readonly adjustmentBrightness?: number;
  readonly adjustmentContrast?: number;
  readonly adjustmentSaturation?: number;
  readonly glowEnabled?: boolean;
  readonly glowNormalized?: boolean;
  readonly glowBicubicUpscale?: boolean;
  readonly glowHighQuality?: boolean;
  /** `glow_levels/1..7` as authored, indexed 0..6 — `undefined` where the resource is silent, so
   *  Godot's own per-level defaults (0, 0.8, 0.4, 0.1, 0, 0, 0) apply. */
  readonly glowLevels?: readonly (number | undefined)[];
  readonly glowIntensity?: number;
  readonly glowStrength?: number;
  readonly glowBloom?: number;
  readonly glowBlendMode?: number;
  readonly glowHdrThreshold?: number;
  readonly glowHdrScale?: number;
  readonly glowHdrLuminanceCap?: number;
  readonly glowMix?: number;
  /** True when `glow_map` names a texture — the one glow key that is not a scalar. */
  readonly glowMap?: boolean;
  readonly fogEnabled?: boolean;
  readonly fogMode?: number;
  readonly fogLightColor?: string;
  readonly fogLightEnergy?: number;
  readonly fogSunScatter?: number;
  readonly fogDensity?: number;
  readonly fogHeight?: number;
  readonly fogHeightDensity?: number;
  readonly fogAerialPerspective?: number;
  readonly fogSkyAffect?: number;
  readonly fogDepthCurve?: number;
  readonly fogDepthBegin?: number;
  readonly fogDepthEnd?: number;
  readonly fogColor?: string;
  readonly fogColorAlpha?: number;
  readonly fogSunColor?: string;
  readonly fogSunAmount?: number;
  readonly fogDepthEnabled?: boolean;
  readonly fogTransmitEnabled?: boolean;
  readonly fogTransmitCurve?: number;
  readonly fogHeightEnabled?: boolean;
  readonly fogHeightMin?: number;
  readonly fogHeightMax?: number;
  readonly fogHeightCurve?: number;
  readonly volumetricFogEnabled?: boolean;
  readonly dofBlurFarEnabled?: boolean;
  readonly dofBlurFarDistance?: number;
  readonly dofBlurFarTransition?: number;
  readonly dofBlurFarAmount?: number;
  readonly dofBlurFarQuality?: number;
  readonly dofBlurNearEnabled?: boolean;
  readonly dofBlurNearDistance?: number;
  readonly dofBlurNearTransition?: number;
  readonly dofBlurNearAmount?: number;
  readonly dofBlurNearQuality?: number;
  readonly ssaoEnabled?: boolean;
  readonly ssaoRadius?: number;
  readonly ssaoIntensity?: number;
  readonly ssaoPower?: number;
  readonly ssaoDetail?: number;
  readonly ssaoHorizon?: number;
  readonly ssaoSharpness?: number;
  readonly ssaoLightAffect?: number;
  readonly ssaoAoChannelAffect?: number;
  readonly ssaoRadius2?: number;
  readonly ssaoIntensity2?: number;
  readonly ssaoBias?: number;
  readonly ssaoColor?: string;
  readonly ssaoQuality?: number;
  readonly ssaoBlur?: number;
  readonly ssaoEdgeSharpness?: number;
  /** Godot 4 `ssr_*` / Godot 3 `ss_reflections_*`; normalized here after resource parsing. */
  readonly ssrEnabled?: boolean;
  readonly ssrMaxSteps?: number;
  readonly ssrFadeIn?: number;
  readonly ssrFadeOut?: number;
  readonly ssrDepthTolerance?: number;
  readonly ssrRoughness?: boolean;
}

/** The one authored Godot 4 camera-attributes resource selected by the reachable camera graph. */
export interface AuthoredCameraAttributes {
  readonly resPath: string;
  readonly type: "CameraAttributesPractical" | "CameraAttributesPhysical";
  readonly authoredKeys: readonly string[];
  readonly farEnabled?: boolean;
  readonly farDistance?: number;
  readonly farTransition?: number;
  readonly nearEnabled?: boolean;
  readonly nearDistance?: number;
  readonly nearTransition?: number;
  readonly amount?: number;
  readonly exposureMultiplier?: number;
  readonly exposureSensitivity?: number;
  readonly exposureAperture?: number;
  readonly exposureShutterSpeed?: number;
  readonly autoExposureEnabled?: boolean;
  readonly autoExposureSpeed?: number;
  readonly autoExposureScale?: number;
  readonly autoExposureMinSensitivity?: number;
  readonly autoExposureMaxSensitivity?: number;
  readonly autoExposureMinExposureValue?: number;
  readonly autoExposureMaxExposureValue?: number;
}

export interface RenderingTranslation {
  /** Absent when the project's declared rendering has no measured translation — see the header. */
  readonly config?: EmittedRendererConfig;
  /**
   * The world's GLOBAL AMBIENT LIGHT, emitted as an `<ambientLight>` beside the main scene.
   *
   * Two projects produce one: a Godot 3 + GLES2 project with NO `Environment`, whose ambient is its
   * own `default_clear_color` (the header's two measured runs), and a Godot 4 Environment whose
   * `ambient_light_source` resolves to a flat colour rather than the sky (the header's shader
   * citation). The two have different REASONS and the emitted world carries each project's own —
   * {@link EmittedAmbientLight.reason} is the comment the reader of that world will see.
   */
  readonly ambient?: EmittedAmbientLight;
  /** Sky-sourced fill when the Environment gathers ambient from a ProceduralSky, not a panorama. */
  readonly hemisphere?: EmittedHemisphereLight;
  /** Exact full-frame effect the emitted R3F world owns and renders after its scene. */
  readonly postEffect?: EmittedPostEffect;
  /** Authored sky/background and, when exact, its image-based ambient/reflection source. */
  readonly worldEnvironment?: EmittedWorldEnvironment;
  /**
   * `vgai.project.json`'s own `rendering` block — the construction-time renderer properties no
   * world can declare for itself.
   *
   * MSAA is the whole reason this exists. A WebGL context's sample count is fixed when the context
   * is CREATED, from a boolean `antialias` attribute, long before a world mounts — so it cannot ride
   * {@link config}, which is applied to a renderer the host already built. It rides the PROJECT
   * MANIFEST instead, and the engine reads it there (`runtime/mount-manifest.ts` threads it into
   * `createHostRenderer`). WebGL exposes no sample COUNT, so Godot's index becomes the boolean plus
   * a note naming what was asked for and what a browser actually gives.
   */
  readonly manifestRendering?: { readonly antialias: boolean };
  readonly notes: readonly TranslationNote[];
  /**
   * Every `res://` file the emitted RENDERING code fetches — the PanoramaSky's own image, and only
   * when the sky was actually carried.
   *
   * Recorded here rather than re-derived by the caller from the authored `Environment`, for the
   * reason `SceneRequests3D.assets` gives: this function is the one that decides whether a URL is
   * written at all (an absent panorama is noted and dropped), so it is the only honest place to
   * say the byte is needed. Joins `TranslatedProject.requiredAssets`.
   */
  readonly assets: readonly string[];
}

/**
 * Godot 3's `rendering/environment/default_clear_color` (`0.3, 0.3, 0.3`) as the byte triple GLES2
 * actually writes: `round(0.3 * 255) = 77 = 0x4d`. Measured, not converted — see the header.
 */
export const GODOT3_DEFAULT_CLEAR_COLOR = "#4d4d4d";

/** Godot's `quality/filters/msaa` is an INDEX, not a sample count. */
const MSAA_INDEX_TO_SAMPLES: Readonly<Record<number, string>> = {
  0: "disabled",
  1: "2x",
  2: "4x",
  3: "8x",
  4: "16x",
};

/**
 * Godot 3's `quality/shadows/filter_mode` INDEX → three's shadow-map filter.
 *
 * Godot 3.6's own default is **1** (measured on the 3.6.stable binary:
 * `ProjectSettings.get_setting("rendering/quality/shadows/filter_mode")` → `1`), so a project that
 * declares nothing is declaring PCF5 rather than nothing — and the host's own default is
 * `PCFSoftShadowMap`, which is the WRONG one for it. That is why an undeclared setting still emits.
 */
const SHADOW_FILTER_MODE_TO_MAP_TYPE: Readonly<
  Record<number, EmittedShadowMapType>
> = {
  0: "basic",
  1: "pcf",
  2: "pcf-soft",
};

/** Godot 3.6's own `quality/shadows/filter_mode` default, measured — see the table above. */
const GODOT3_SHADOW_FILTER_MODE = 1;

/** Godot 3's name for each filter mode, so a refusal names what the project actually asked for. */
const SHADOW_FILTER_MODE_NAMES: Readonly<Record<number, string>> = {
  0: "Disabled",
  1: "PCF5",
  2: "PCF13",
};

/**
 * `[rendering] quality/shadows/filter_mode` → three's `shadowMap.type`, with the deviation named.
 *
 * The mapping is by KERNEL SIZE and it is not exact in either direction: Godot's PCF5 takes 5 taps
 * and PCF13 takes 13, while three's `PCFShadowMap` takes 9 and `PCFSoftShadowMap` takes 9 over a
 * receiver-distance-scaled radius. So the ORDERING is carried exactly (no filter < narrow < wide)
 * and the penumbra width is not — which is a visible difference at a shadow edge and nothing else.
 */
function translateShadowFilterMode(
  input: RenderingTranslationInput,
  notes: TranslationNote[],
): EmittedShadowMapType | undefined {
  const declared = input.rendering.shadowFilterMode;
  const mode = declared ?? GODOT3_SHADOW_FILTER_MODE;
  const mapType = SHADOW_FILTER_MODE_TO_MAP_TYPE[mode];
  if (mapType === undefined) {
    notes.push({
      at: "project.godot",
      message:
        `[rendering] quality/shadows/filter_mode = ${mode} is not one of Godot 3's three filter ` +
        "modes (0 Disabled, 1 PCF5, 2 PCF13), so no shadow filter is declared and the frame is " +
        "filtered with whatever the host's renderer was built with.",
    });
    return undefined;
  }
  notes.push({
    at: "project.godot",
    message:
      `[rendering] quality/shadows/filter_mode = ${mode} (${SHADOW_FILTER_MODE_NAMES[mode]}` +
      `${declared === undefined ? ", Godot 3.6's own default — the project declares none" : ""}) ` +
      `becomes three's \`${mapType}\` shadow map. The two engines agree on the ORDERING of their ` +
      "filters and not on kernel width: Godot PCF5/PCF13 take 5 and 13 taps, three takes 9 for " +
      "both and scales the soft one by receiver distance, so a shadow EDGE is a named deviation.",
  });
  return mapType;
}

export interface RenderingTranslationInput {
  readonly engine: EngineVersion;
  readonly rendering: RenderingSettings;
  /** True when ANY translated scene authors a `WorldEnvironment` node. */
  readonly hasWorldEnvironment: boolean;
  /** Present when that node's Environment reference resolves unambiguously. */
  readonly worldEnvironment?: AuthoredWorldEnvironment;
  /** Godot 4 camera attributes selected by the authored camera graph. */
  readonly cameraAttributes?: AuthoredCameraAttributes;
  /** First mounted transparent surface, whose fragment depth cannot be represented by one buffer. */
  readonly transparentFogSurface?: string;
  /** First mounted negative directional light; its sign is not represented by Three intensity. */
  readonly unsupportedFogLight?: string;
  /** Exact analyzed script demand for an Environment glow member. */
  readonly runtimeGlowAccess?: boolean;
}

function refuseUnsupportedFixedFogInputs(
  fog: EmittedFog | undefined,
  input: Pick<RenderingTranslationInput, "transparentFogSurface" | "unsupportedFogLight">,
  dialect: string,
): void {
  if (fog === undefined) return;
  if (input.transparentFogSurface !== undefined) {
    throw new TranslateError(
      input.transparentFogSurface,
      `fixed Environment fog runs per transparent surface fragment in ${dialect}, but the native ` +
        "postprocessing pass has only the nearest depth-writing fragment. Refusing instead of " +
        "fogging this blended surface at the opaque/background distance.",
    );
  }
  if (input.unsupportedFogLight !== undefined) {
    throw new TranslateError(
      input.unsupportedFogLight,
      `fixed Environment fog in ${dialect} multiplies directional sun scatter by the light's ` +
        "signed energy. Three's directional-light intensity does not preserve Godot's separate " +
        "light_negative flag, so translation refuses rather than turning a subtractive fog sun " +
        "into an additive one.",
    );
  }
}

function translateGodot3Gles2(
  input: RenderingTranslationInput,
  notes: TranslationNote[],
): RenderingTranslation {
  // `worldEnvironment` is also set by `[rendering] environment/default_environment`, which needs no
  // node at all (see `project-plan.ts`'s `authoredWorldEnvironment`). Reading only the NODE here
  // would send such a project down the no-Environment path below and emit a clear-colour ambient
  // Godot never used.
  if (input.hasWorldEnvironment || input.worldEnvironment !== undefined) {
    if (input.worldEnvironment !== undefined) {
      classifyGodot3AmbientOcclusion(input.worldEnvironment, "GLES2", notes);
      classifyGodot3ScreenSpaceReflections(
        input.worldEnvironment,
        "GLES2",
        notes,
      );
      classifyGodot3SkyTransform(input.worldEnvironment, notes);
    }
    const fog =
      input.worldEnvironment === undefined
        ? undefined
        : translateGodot3Fog(input.worldEnvironment, notes);
    if (
      input.worldEnvironment?.dofBlurFarEnabled === true ||
      input.worldEnvironment?.dofBlurNearEnabled === true
    ) {
      throw new TranslateError(
        input.worldEnvironment.resPath,
        "active Godot 3 GLES2 depth of field uses a distinct alpha-weighted near kernel and " +
          "ordinary SRC_ALPHA destination-alpha merge. The implemented pass transcribes GLES3; " +
          "translation refuses instead of claiming the two driver paths are identical.",
      );
    }
    refuseUnsupportedFixedFogInputs(fog, input, "Godot 3.6 GLES2");
    notes.push({
      at: "project.godot",
      message:
        "this project supplies an `Environment` (a `WorldEnvironment`/`Camera` node, or " +
        "`[rendering] environment/default_environment`). Its background and ambient light are not " +
        "carried yet, so this renderer declaration deliberately omits a clear colour and the " +
        "world emits no ambient light. Fixed fog, when enabled, is carried separately from the " +
        "depth buffer. Its authored tonemapper is different: Godot 3 GLES2 " +
        "`RasterizerSceneGLES2::environment_set_tonemap` is a no-op and its post-process shader " +
        "has no tone curve, so `toneMapping: none` carries the reference renderer faithfully " +
        "instead of silently inheriting the host's ACES operator.",
    });
    return {
      config: { toneMapping: "none", outputColorSpace: "srgb" },
      ...(fog === undefined
        ? {}
        : {
            postEffect: {
              kind: "godot-output" as const,
              exposure: 1,
              white: 1,
              ...(fog === undefined ? {} : { fog }),
            },
          }),
      notes,
      assets: [],
    };
  }

  // The project's own `environment/default_clear_color` when it declares one, and Godot 3's
  // measured default when it does not. It is TWO facts at once — what the frame is cleared to,
  // and what the scene's ambient light is — so both fields below read this one value.
  const clearColor =
    input.rendering.defaultClearColor ?? GODOT3_DEFAULT_CLEAR_COLOR;
  return {
    config: {
      toneMapping: "none",
      // sRGB, NOT "no transform" — the measured table in this module's header is why.
      outputColorSpace: "srgb",
      clearColor,
    },
    ambient: {
      color: clearColor,
      energy: 1,
      reason: GODOT3_GLES2_AMBIENT_REASON,
    },
    notes,
    assets: [],
  };
}

/** The emitted comment on a Godot 3 GLES2 world's `<ambientLight>` — see the module header. */
const GODOT3_GLES2_AMBIENT_REASON =
  "`project.godot` [rendering] environment/default_clear_color — Godot 3 lights a scene\n" +
  "          with no `Environment` using the clear colour as a global ambient at energy 1, and a\n" +
  "          shadowed surface is lit by this and nothing else. See `translate/rendering.ts` for the\n" +
  "          two Godot 3.6 runs that measured it.";

function translateGodot3Tonemap(
  environment: AuthoredWorldEnvironment,
  glow: EmittedGlow | undefined,
  notes: TranslationNote[],
): { config?: EmittedRendererConfig; postEffect?: EmittedPostEffect } {
  if (environment.tonemapMode === 2) {
    const exposure = environment.tonemapExposure ?? 1;
    const white = environment.tonemapWhite ?? 1;
    notes.push({
      at: environment.resPath,
      message:
        "Godot 3 GLES3 Filmic tonemapping is carried by an exact fullscreen Hable curve with " +
        `exposure ${exposure} and white point ${white}.`,
    });
    return {
      config: { toneMapping: "none", outputColorSpace: "srgb" },
      postEffect: {
        kind: "godot-filmic",
        exposure,
        white,
        ...(glow === undefined ? {} : { glow }),
      },
    };
  }
  if ((environment.tonemapMode ?? 0) === 0 && glow !== undefined) {
    return {
      config: { toneMapping: "none", outputColorSpace: "srgb" },
      postEffect: {
        kind: "godot-output",
        exposure: environment.tonemapExposure ?? 1,
        white: environment.tonemapWhite ?? 1,
        glow,
      },
    };
  }
  notes.push({
    at: environment.resPath,
    message:
      `this Godot 3 GLES3 Environment uses tonemap_mode=${environment.tonemapMode ?? 0}; only ` +
      "mode 2 (Filmic) has a measured renderer translation, so its tone curve is not invented.",
  });
  return {};
}

const GODOT3_GLOW_LEVEL_DEFAULTS: readonly number[] = [0, 0, 1, 0, 1, 0, 0];
const GODOT3_GLOW_KEYS: readonly string[] = [
  "glow_enabled",
  "glow_intensity",
  "glow_strength",
  "glow_bloom",
  "glow_blend_mode",
  "glow_hdr_threshold",
  "glow_hdr_scale",
  "glow_hdr_luminance_cap",
  "glow_bicubic_upscale",
  "glow_high_quality",
];

/** Godot 3.6 GLES3 Environment glow values consumed by its tonemap pass. */
function translateGodot3Glow(
  environment: AuthoredWorldEnvironment,
  runtimeGlowAccess: boolean,
  notes: TranslationNote[],
): EmittedGlow | undefined {
  const authored = environment.authoredKeys.some((key) => key.startsWith("glow_"));
  if (!authored && !runtimeGlowAccess) return undefined;
  const enabled = environment.glowEnabled === true;
  const blendMode = environment.glowBlendMode ?? 2;
  if (blendMode === GLOW_BLEND_SOFTLIGHT && enabled) {
    notes.push({
      at: environment.resPath,
      message:
        "Godot 3 glow_blend_mode = 2 (SOFTLIGHT) is applied after the tone curve. The retained " +
        "pre-tonemap glow pass cannot represent that insertion point, so glow is refused rather " +
        "than silently composited in the wrong color space.",
    });
    return undefined;
  }
  if (environment.glowHighQuality === true && enabled) {
    notes.push({
      at: environment.resPath,
      message:
        "Godot 3 glow_high_quality changes the source pyramid allocation and sampling path. That " +
        "high-quality carrier is unavailable, so this glow block remains loud instead of using " +
        "the low-quality pyramid.",
    });
    return undefined;
  }
  if (blendMode !== 0 && blendMode !== 1 && blendMode !== 2 && blendMode !== 3) {
    notes.push({
      at: environment.resPath,
      message: `Godot 3 glow_blend_mode=${blendMode} is outside its source enum and is not carried.`,
    });
    return undefined;
  }
  const authoredLevels = environment.glowLevels ?? [];
  const levels = GODOT3_GLOW_LEVEL_DEFAULTS.map(
    (fallback, index) => authoredLevels[index] ?? fallback,
  );
  let levelCount = 0;
  for (let index = 0; index < levels.length; index += 1) {
    if ((levels[index] as number) > 0.0001) levelCount = index + 1;
  }
  const glow: EmittedGlow = {
    dialect: "godot-3",
    enabled,
    levels,
    sourceLevels: levels,
    normalized: false,
    levelCount,
    intensity: environment.glowIntensity ?? 0.8,
    strength: environment.glowStrength ?? 1,
    bloom: environment.glowBloom ?? 0,
    hdrThreshold: environment.glowHdrThreshold ?? 1,
    hdrScale: environment.glowHdrScale ?? 2,
    luminanceCap: environment.glowHdrLuminanceCap ?? 12,
    mix: 0,
    blendMode,
    bicubicUpscale: environment.glowBicubicUpscale ?? false,
    highQuality: environment.glowHighQuality ?? false,
  };
  notes.push({
    at: environment.resPath,
    message:
      `Godot 3 GLES3 glow is carried by its retained seven-level gaussian pyramid with ` +
      `glow_enabled=${enabled}, blend mode ${blendMode}, bloom ${glow.bloom}, and ` +
      `${glow.bicubicUpscale ? "the source four-tap cubic B-spline upscale" : "bilinear upscale"}.`,
  });
  return glow;
}

/**
 * Godot 3.6's `ProceduralSky` gradient defaults, read out of the constructor that sets them —
 * `scene/resources/sky.cpp:503-511` (3.6-stable): `sky_top_color = Color::hex(0xa5d6f1ff)`,
 * `sky_horizon_color = 0xd6eafaff`, `ground_bottom_color = 0x282f36ff`,
 * `ground_horizon_color = 0x6c655fff`.
 *
 * A SEPARATE constant from {@link GODOT4_PROCEDURAL_SKY_DEFAULTS} because the two engines ship
 * different palettes for the same four keys — Godot 3's is a blue daylight sky, Godot 4's a
 * desaturated grey-blue — and a `.tres` with an empty `[sub_resource type="ProceduralSky"]` body
 * (which is what both fixtures on this shelf author) is ENTIRELY these values. Using the wrong
 * dialect's table would put a colour on screen that nothing in either engine ever produced.
 *
 * Godot's `ProceduralSky(bool p_desaturate)` has a desaturating overload; the default argument is
 * `false` (`scene/resources/sky.h:197`) and that is what resource loading constructs, so these are
 * the values a loaded `.tres` starts from.
 */
const GODOT3_PROCEDURAL_SKY_DEFAULTS = {
  skyTop: "#a5d6f1",
  skyHorizon: "#d6eafa",
  groundBottom: "#282f36",
  groundHorizon: "#6c655f",
} as const;

/**
 * Godot 3's `BG_SKY` background, and the sky-sourced ambient that comes with it.
 *
 * Two skies reach this: a `PanoramaSky` (an image) and a `ProceduralSky` (a generated gradient).
 * Godot draws both with `_draw_sky(...)` scaled by `bg_energy`
 * (`drivers/gles3/rasterizer_scene_gles3.cpp:4533`) and gathers ambient from the same sky's
 * irradiance map — `ambient_light = mix(ambient_light_color, sky_irradiance * bg_energy,
 * radiance_ambient_contribution)` then `*= ambient_energy`
 * (`drivers/gles3/shaders/scene.glsl:2011-2030`, fed by `ambient_sky_contribution` at
 * `rasterizer_scene_gles3.cpp:2612`). So at Godot's own defaults — contribution 1, ambient energy
 * 1, ambient colour black — the sky IS the whole fill light, and `carried` says which keys that
 * accounts for.
 *
 * The panorama half is unchanged; the ProceduralSky half is the addition, and it is the same carry
 * the Godot 4 branch makes for `ProceduralSkyMaterial`: the horizon colour as `scene.background`
 * plus a `<hemisphereLight>` of the gradient's own colours, because three has no Godot sky shader
 * to build a radiance cubemap from.
 */
interface Godot3Background {
  readonly worldEnvironment?: EmittedWorldEnvironment;
  readonly hemisphere?: EmittedHemisphereLight;
  /** The Environment keys this branch READ, for {@link accountEnvironmentKeys}. */
  readonly carried: readonly string[];
}

function translateGodot3Background(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
): Godot3Background {
  if (environment.backgroundMode === 2 && environment.panorama === undefined) {
    return translateGodot3ProceduralSky(environment, notes);
  }
  const worldEnvironment = translateGodot3Panorama(environment, notes);
  return {
    carried: [],
    ...(worldEnvironment === undefined ? {} : { worldEnvironment }),
  };
}

/**
 * `background_mode = BG_SKY` over a Godot 3 `ProceduralSky` — `kaykit-hexagons` and `rota`.
 *
 * Both author `[sub_resource type="ProceduralSky" id=1]` with an EMPTY body, so every colour below
 * is Godot 3.6's own constructor default rather than an authored value. That is why the defaults
 * are a cited constant and not a palette this lane picked.
 */
function translateGodot3ProceduralSky(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
): Godot3Background {
  const procedural = environment.proceduralSky;
  if (procedural === undefined) {
    notes.push({
      at: environment.resPath,
      message:
        "this Environment is `background_mode = 2` (BG_SKY) and its `background_sky` does not " +
        "resolve to a `PanoramaSky` or a `ProceduralSky`, so no background is fabricated and the " +
        "frame is cleared to the host's own colour.",
    });
    return { carried: ["background_mode", "background_sky"] };
  }
  const backgroundEnergy = environment.backgroundEnergy ?? 1;
  const ambientEnergy = environment.ambientLightEnergy ?? 1;
  const skyContribution = environment.ambientLightSkyContribution ?? 1;
  const skyTop =
    procedural.skyTopColor ?? GODOT3_PROCEDURAL_SKY_DEFAULTS.skyTop;
  const skyHorizon =
    procedural.skyHorizonColor ?? GODOT3_PROCEDURAL_SKY_DEFAULTS.skyHorizon;
  const groundBottom =
    procedural.groundBottomColor ?? GODOT3_PROCEDURAL_SKY_DEFAULTS.groundBottom;
  const groundHorizon =
    procedural.groundHorizonColor ??
    GODOT3_PROCEDURAL_SKY_DEFAULTS.groundHorizon;
  const carried = ["background_mode", "background_sky"];
  notes.push({
    at: environment.resPath,
    message:
      "background_mode = 2 (BG_SKY) over a `ProceduralSky` is carried as " +
      `three's \`scene.background\` at the authored/default horizon ${skyHorizon} (top ` +
      `${skyTop}, ground ${groundBottom}/${groundHorizon}), at background energy ` +
      `${backgroundEnergy}. Godot generates a gradient DOME with a sun disc and samples it per ` +
      "pixel (`scene/resources/sky.cpp` `ProceduralSky::_generate_sky`); three has no equivalent " +
      "stage, so the sky CURVE (`sky_curve`/`ground_curve`), the ground half below the horizon " +
      "and the sun disc (`sun_*`) are named deviations — the frame is the horizon colour, not a " +
      "generated skybox.",
  });
  // Godot's own defaults are what make the sky the WHOLE fill light; anything else is a mix three's
  // single hemisphere cannot reproduce without also changing the visible sky, so it is named
  // instead of approximated.
  if (skyContribution === 1) {
    carried.push("ambient_light_sky_contribution", "ambient_light_energy");
    if (environment.ambientLightColor !== undefined)
      carried.push("ambient_light_color");
    notes.push({
      at: environment.resPath,
      message:
        `ambient is gathered from that sky: Godot 3 GLES3 mixes \`ambient_light_color\` with the ` +
        "sky irradiance by `ambient_sky_contribution` (`drivers/gles3/shaders/scene.glsl:2014`), " +
        "and at this resource’s contribution of 1 the colour is not read at all" +
        (environment.ambientLightColor === undefined
          ? ""
          : ` — so the authored \`ambient_light_color\` ${environment.ambientLightColor} is ` +
            "ignored by Godot too, and emitting it would be a pixel nobody authored") +
        `. It becomes a \`<hemisphereLight>\` of the same sky/ground colours at energy ` +
        `${ambientEnergy * backgroundEnergy} (\`ambient_energy\` × \`bg_energy\`, both of ` +
        "which scale Godot's own term). Godot additionally attenuates it by the surface Fresnel " +
        "(`env_ambient *= 1.0 - F`) and three does not; that is a named deviation at grazing " +
        "angles.",
    });
    return {
      worldEnvironment: {
        kind: "godot-procedural-sky",
        skyTop,
        skyHorizon,
        groundBottom,
        groundHorizon,
        energy: backgroundEnergy,
      },
      hemisphere: {
        sky: skyHorizon,
        ground: groundHorizon,
        energy: ambientEnergy * backgroundEnergy,
        reason: GODOT3_SKY_AMBIENT_REASON,
      },
      carried,
    };
  }
  notes.push({
    at: environment.resPath,
    message:
      `this Environment authors \`ambient_light_sky_contribution = ${skyContribution}\`, so Godot ` +
      "mixes a flat ambient colour with the sky irradiance (`scene.glsl:2014`). Three has one " +
      "hemisphere term and no sky radiance for a generated sky, so no ambient is emitted rather " +
      "than an authoritative-looking blend of the two; the visible sky background is carried as " +
      "above.",
  });
  carried.push("ambient_light_sky_contribution");
  return {
    worldEnvironment: {
      kind: "godot-procedural-sky",
      skyTop,
      skyHorizon,
      groundBottom,
      groundHorizon,
      energy: backgroundEnergy,
    },
    carried,
  };
}

/** The emitted comment on a Godot 3 sky-lit world's `<hemisphereLight>`. */
const GODOT3_SKY_AMBIENT_REASON =
  "Godot 3 GLES3 gathers this scene’s fill light from the `Environment`’s own\n" +
  "          ProceduralSky (`ambient_light_sky_contribution` 1 — `scene.glsl:2014`), not from a\n" +
  "          flat colour. three has no radiance cubemap for a generated sky, so the carry is a\n" +
  "          hemisphere of the same sky/ground colours.";

function translateGodot3Panorama(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
): EmittedWorldEnvironment | undefined {
  if (environment.backgroundMode === 2 && environment.panorama !== undefined) {
    const panorama = environment.panorama;
    const energy = environment.backgroundEnergy ?? 1;
    const ambientEnergy = environment.ambientLightEnergy ?? 1;
    const skyContribution = environment.ambientLightSkyContribution ?? 1;
    const radianceSize = panorama.radianceSize ?? 2;
    if (!panorama.present) {
      notes.push({
        at: panorama.resPath,
        message:
          "the PanoramaSky texture is absent from the Godot project, so the emitted world cannot " +
          "load it and does not fabricate a background.",
      });
      return undefined;
    }
    const useAsEnvironment = ambientEnergy === 1 && skyContribution === 1;
    notes.push({
      at: environment.resPath,
      message:
        `the PanoramaSky ${panorama.resPath} is carried as the visible equirectangular ` +
        `background at energy ${energy}` +
        (useAsEnvironment
          ? " and as the scene environment. Godot defaults this resource to sky contribution 1 " +
            "and ambient energy 1, so its ambient color is ignored and both renderers derive " +
            `diffuse ambient plus reflections from the authored panorama. Godot radiance_size=${radianceSize} ` +
            "uses a different convolution kernel, and Three's equirectangular azimuth convention " +
            "differs from Godot's; pixel-identical roughness blur and sky orientation are not claimed."
          : `. Its authored ambient energy ${ambientEnergy} / sky contribution ${skyContribution} ` +
            "cannot be carried by Three's single environment intensity without also changing " +
            "specular reflections, so the panorama is not installed as ambient image-based light."),
    });
    return {
      kind: "godot-panorama",
      resPath: panorama.resPath,
      url: assetUrl(panorama.resPath),
      energy,
      iblDiffuse: useAsEnvironment ? 1 : 0,
      iblSpecular: useAsEnvironment ? 1 : 0,
    };
  }
  if (environment.backgroundMode !== undefined) {
    notes.push({
      at: environment.resPath,
      message:
        `this Environment uses background_mode=${environment.backgroundMode}; only Godot 3's ` +
        "BG_SKY (2), over a PanoramaSky or a ProceduralSky, has a native background translation.",
    });
  }
  return undefined;
}

const GODOT3_FOG_KEYS = [
  "fog_enabled",
  "fog_color",
  "fog_sun_color",
  "fog_sun_amount",
  "fog_depth_enabled",
  "fog_depth_begin",
  "fog_depth_end",
  "fog_depth_curve",
  "fog_transmit_enabled",
  "fog_transmit_curve",
  "fog_height_enabled",
  "fog_height_min",
  "fog_height_max",
  "fog_height_curve",
] as const;

const GODOT3_DOF_KEYS = [
  "dof_blur_far_enabled",
  "dof_blur_far_distance",
  "dof_blur_far_transition",
  "dof_blur_far_amount",
  "dof_blur_far_quality",
  "dof_blur_near_enabled",
  "dof_blur_near_distance",
  "dof_blur_near_transition",
  "dof_blur_near_amount",
  "dof_blur_near_quality",
] as const;

const GODOT3_SSAO_KEYS = [
  "ssao_enabled",
  "ssao_radius",
  "ssao_intensity",
  "ssao_radius2",
  "ssao_intensity2",
  "ssao_bias",
  "ssao_light_affect",
  "ssao_ao_channel_affect",
  "ssao_color",
  "ssao_quality",
  "ssao_blur",
  "ssao_edge_sharpness",
] as const;

const GODOT3_SSR_KEYS = [
  "ss_reflections_enabled",
  "ss_reflections_max_steps",
  "ss_reflections_fade_in",
  "ss_reflections_fade_out",
  "ss_reflections_depth_tolerance",
  "ss_reflections_roughness",
] as const;

function classifyGodot3ScreenSpaceReflections(
  environment: AuthoredWorldEnvironment,
  driver: "GLES2" | "GLES3",
  notes: TranslationNote[],
): void {
  if (
    environment.authoredKeys.includes("ss_reflections_enabled") &&
    environment.ssrEnabled === undefined
  ) {
    throw new TranslateError(
      environment.resPath,
      "the authored Godot 3 ss_reflections_enabled value is not a bool.",
    );
  }
  if (environment.ssrEnabled !== true) {
    if (
      environment.authoredKeys.some((key) =>
        (GODOT3_SSR_KEYS as readonly string[]).includes(key),
      )
    ) {
      notes.push({
        at: environment.resPath,
        message:
          "the authored Godot 3 screen-space reflection fields are inactive because " +
          "ss_reflections_enabled is false (the Environment default); Godot does not schedule " +
          "the effect and the translation does not either.",
      });
    }
    return;
  }
  if (driver === "GLES2") {
    notes.push({
      at: environment.resPath,
      message:
        "ss_reflections_enabled is inert on Godot 3.6 GLES2: " +
        "RasterizerSceneGLES2::environment_set_ssr validates the Environment RID but stores none " +
        "of its arguments, and the renderer has no SSR pass. The translation preserves that " +
        "selected source driver's no-op.",
    });
    return;
  }
  throw new TranslateError(
    environment.resPath,
    "active Godot 3.6 GLES3 screen-space reflections require the source renderer's diffuse MRT, " +
      "normal/roughness MRT, specular buffer and depth buffer, then merge the ray result back into " +
      "the indirect-specular channel. The native Three render target exposes only composed color " +
      "and depth, so translation refuses instead of tracing a visually similar reflection over " +
      "different inputs.",
  );
}

function allZero(values: readonly number[]): boolean {
  return values.every((value) => value === 0);
}

function identityBasis(values: readonly number[]): boolean {
  return (
    values.length === 9 &&
    values.every((value, index) => value === (index === 0 || index === 4 || index === 8 ? 1 : 0))
  );
}

function classifyGodot3SkyTransform(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
): void {
  const malformed = [
    environment.authoredKeys.includes("background_sky_custom_fov") &&
    environment.skyCustomFov === undefined
      ? "background_sky_custom_fov (expected numeric scalar)"
      : undefined,
    environment.authoredKeys.includes("background_sky_orientation") &&
    environment.skyOrientation === undefined
      ? "background_sky_orientation (expected Basis with 9 numeric components)"
      : undefined,
    environment.authoredKeys.includes("background_sky_rotation") &&
    environment.skyRotation === undefined
      ? "background_sky_rotation (expected Vector3)"
      : undefined,
    environment.authoredKeys.includes("background_sky_rotation_degrees") &&
    environment.skyRotationDegrees === undefined
      ? "background_sky_rotation_degrees (expected Vector3)"
      : undefined,
  ].filter((value): value is string => value !== undefined);
  if (malformed.length > 0) {
    throw new TranslateError(
      environment.resPath,
      `the authored Godot 3 sky transform value(s) do not match the source Variant shape: ${malformed.join(", ")}.`,
    );
  }
  const customFov = environment.skyCustomFov ?? 0;
  if (customFov !== 0) {
    throw new TranslateError(
      environment.resPath,
      `background_sky_custom_fov = ${customFov} replaces the camera projection used only for ` +
        "Godot's sky draw. Three's Scene background uses the mounted camera projection directly, " +
        "so translation refuses instead of changing the gameplay camera or approximating a " +
        "different sky field of view.",
    );
  }
  const authoredTransformKeys = [
    "background_sky_orientation",
    "background_sky_rotation",
    "background_sky_rotation_degrees",
  ].filter((key) => environment.authoredKeys.includes(key));
  if (authoredTransformKeys.length === 0) {
    if (environment.authoredKeys.includes("background_sky_custom_fov")) {
      notes.push({
        at: environment.resPath,
        message:
          "background_sky_custom_fov is authored as 0, which selects the camera projection in " +
          "Godot and requires no separate sky projection in the translation.",
      });
    }
    return;
  }
  const identity =
    (environment.skyOrientation === undefined || identityBasis(environment.skyOrientation)) &&
    (environment.skyRotation === undefined || allZero(environment.skyRotation)) &&
    (environment.skyRotationDegrees === undefined || allZero(environment.skyRotationDegrees));
  if (!identity) {
    throw new TranslateError(
      environment.resPath,
      `the authored Godot 3 sky transform (${authoredTransformKeys.join(", ")}) is non-identity. ` +
        "Godot multiplies the camera-space ray by the inverse authored Basis before PanoramaSky " +
        "lookup; Three's equirectangular background first converts its own world-space direction " +
        "under a different handedness/azimuth convention. That baseline convention is still a " +
        "named deviation, so applying an Euler with the same numbers would not be the source " +
        "texture-space transform. Translation refuses rather than rotating the sky incorrectly.",
    );
  }
  notes.push({
    at: environment.resPath,
    message:
      `the authored Godot 3 sky transform (${authoredTransformKeys.join(", ")}) is identity; ` +
      "Godot's inverse Basis therefore changes no lookup direction and the translation emits no " +
      "extra rotation.",
  });
}

function classifyGodot3AmbientOcclusion(
  environment: AuthoredWorldEnvironment,
  driver: "GLES2" | "GLES3",
  notes: TranslationNote[],
): void {
  if (environment.ssaoEnabled !== true) {
    if (
      environment.authoredKeys.some((key) =>
        (GODOT3_SSAO_KEYS as readonly string[]).includes(key),
      )
    ) {
      notes.push({
        at: environment.resPath,
        message:
          "the authored Godot 3 SSAO fields are inactive because ssao_enabled is false; " +
          "Godot does not schedule the effect and the translation does not either.",
      });
    }
    return;
  }
  if (driver === "GLES2") {
    notes.push({
      at: environment.resPath,
      message:
        "ssao_enabled is inert on Godot 3.6 GLES2: " +
        "RasterizerSceneGLES2::environment_set_ssao stores no values and that driver has no " +
        "SSAO render pass. The translation preserves the selected source driver's no-op.",
    });
    return;
  }
  throw new TranslateError(
    environment.resPath,
    "active Godot 3.6 GLES3 SSAO is applied only to the ambient fraction encoded by the " +
      "scene shader into the diffuse MRT alpha, with ssao_light_affect and " +
      "ssao_ao_channel_affect participating before the final merge. The native Three render " +
      "target exposes only composed color, not that source MRT channel, so translation refuses " +
      "instead of multiplying the whole lit frame with a visually similar SSAO pass.",
  );
}

function godot3DofQuality(
  resPath: string,
  key: string,
  value: number | undefined,
): 0 | 1 | 2 {
  const quality = value ?? 1;
  if (quality !== 0 && quality !== 1 && quality !== 2) {
    throw new TranslateError(
      resPath,
      `${key} = ${quality} is not a Godot 3.6 EnvironmentDOFBlurQuality ` +
        "(0 LOW, 1 MEDIUM, 2 HIGH).",
    );
  }
  return quality;
}

function translateGodot3DepthOfField(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
): EmittedDepthOfField | undefined {
  const farEnabled = environment.dofBlurFarEnabled ?? false;
  const nearEnabled = environment.dofBlurNearEnabled ?? false;
  if (!farEnabled && !nearEnabled) {
    if (
      environment.authoredKeys.some((key) =>
        (GODOT3_DOF_KEYS as readonly string[]).includes(key),
      )
    ) {
      notes.push({
        at: environment.resPath,
        message:
          "the authored Godot 3 depth-of-field fields are inactive because both near/far " +
          "enable switches are false; Godot ignores them and the translation does too.",
      });
    }
    return undefined;
  }
  const depthOfField: EmittedDepthOfField = {
    dialect: "godot-3",
    farEnabled,
    farDistance: environment.dofBlurFarDistance ?? 10,
    farTransition: environment.dofBlurFarTransition ?? 5,
    farAmount: environment.dofBlurFarAmount ?? 0.1,
    farQuality: godot3DofQuality(
      environment.resPath,
      "dof_blur_far_quality",
      environment.dofBlurFarQuality,
    ),
    nearEnabled,
    nearDistance: environment.dofBlurNearDistance ?? 2,
    nearTransition: environment.dofBlurNearTransition ?? 1,
    nearAmount: environment.dofBlurNearAmount ?? 0.1,
    nearQuality: godot3DofQuality(
      environment.resPath,
      "dof_blur_near_quality",
      environment.dofBlurNearQuality,
    ),
  };
  notes.push({
    at: environment.resPath,
    message:
      "Godot 3 near/far depth of field is carried by the pinned GLES3 separable Gaussian " +
      "kernels, depth weighting, near alpha merge, quality taps and amount-squared radius.",
  });
  return depthOfField;
}

function translateGodot3Fog(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
): EmittedFog | undefined {
  if (environment.fogEnabled !== true) {
    if (
      environment.authoredKeys.some((key) =>
        (GODOT3_FOG_KEYS as readonly string[]).includes(key),
      )
    ) {
      notes.push({
        at: environment.resPath,
        message:
          "the authored Godot 3 fog fields are inactive because fog_enabled is false (the " +
          "Environment default); Godot ignores them and the translation does too.",
      });
    }
    return undefined;
  }
  const fog: EmittedFog = {
    dialect: "godot-3",
    color: environment.fogColor ?? "#8099b3",
    density: environment.fogColorAlpha ?? 1,
    sunColor: environment.fogSunColor ?? "#ffe6b3",
    sunAmount: environment.fogSunAmount ?? 0,
    depthEnabled: environment.fogDepthEnabled ?? true,
    depthBegin: environment.fogDepthBegin ?? 10,
    depthEnd: environment.fogDepthEnd ?? 100,
    depthCurve: environment.fogDepthCurve ?? 1,
    transmitEnabled: environment.fogTransmitEnabled ?? false,
    transmitCurve: environment.fogTransmitCurve ?? 1,
    heightEnabled: environment.fogHeightEnabled ?? false,
    heightMin: environment.fogHeightMin ?? 10,
    heightMax: environment.fogHeightMax ?? 0,
    heightCurve: environment.fogHeightCurve ?? 1,
  };
  notes.push({
    at: environment.resPath,
    message:
      "fog_enabled is carried by Godot 3.6's exact fixed-fog equations from pinned " +
      "`drivers/gles3/shaders/scene.glsl`: independent depth and height curves, fog-color alpha " +
      "density, directional sun tint, and the source transmit curve over the shaded input. " +
      "Three Fog/FogExp2 are not used.",
  });
  return fog;
}

function translateGodot3Gles3Environment(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
  unsupported: Pick<
    RenderingTranslationInput,
    "transparentFogSurface" | "unsupportedFogLight" | "runtimeGlowAccess"
  >,
): RenderingTranslation {
  classifyGodot3AmbientOcclusion(environment, "GLES3", notes);
  classifyGodot3ScreenSpaceReflections(environment, "GLES3", notes);
  classifyGodot3SkyTransform(environment, notes);
  const glow = translateGodot3Glow(
    environment,
    unsupported.runtimeGlowAccess === true,
    notes,
  );
  const tone = translateGodot3Tonemap(environment, glow, notes);
  const fog = translateGodot3Fog(environment, notes);
  const depthOfField = translateGodot3DepthOfField(environment, notes);
  refuseUnsupportedFixedFogInputs(fog, unsupported, "Godot 3.6 GLES3");
  const basePostEffect =
    tone.postEffect === undefined
      ? fog === undefined && depthOfField === undefined
        ? undefined
        : { kind: "godot-output" as const, exposure: 1, white: 1 }
      : tone.postEffect;
  const postEffect =
    basePostEffect === undefined
      ? undefined
      : {
          ...basePostEffect,
          ...(fog === undefined ? {} : { fog }),
          ...(depthOfField === undefined ? {} : { depthOfField }),
        };
  const background = translateGodot3Background(environment, notes);
  const worldEnvironment = background.worldEnvironment;
  accountEnvironmentKeys(
    environment,
    [
      "background_mode",
      "background_sky",
      "background_sky_custom_fov",
      "background_sky_orientation",
      "background_sky_rotation",
      "background_sky_rotation_degrees",
      "tonemap_mode",
      "tonemap_exposure",
      "tonemap_white",
      ...(postEffect?.glow === undefined ? [] : GODOT3_GLOW_KEYS),
      ...background.carried,
      ...GODOT3_FOG_KEYS,
      ...GODOT3_DOF_KEYS,
      ...GODOT3_SSAO_KEYS,
      ...GODOT3_SSR_KEYS,
    ],
    notes,
  );
  return {
    ...(tone.config === undefined
      ? postEffect === undefined
        ? {}
        : { config: { toneMapping: "none" as const, outputColorSpace: "srgb" as const } }
      : { config: tone.config }),
    ...(postEffect === undefined ? {} : { postEffect }),
    ...(worldEnvironment === undefined ? {} : { worldEnvironment }),
    ...(background.hemisphere === undefined
      ? {}
      : { hemisphere: background.hemisphere }),
    notes,
    assets:
      worldEnvironment?.kind === "godot-panorama"
        ? [worldEnvironment.resPath]
        : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Godot 4 — see this module's header for every citation behind the branch below.
// ---------------------------------------------------------------------------------------------

/** `Environment.BGMode`, from the pinned `godot-4.7-extension_api.json`. */
const BG_SKY = 2;
const BG_COLOR = 1;

/** `Environment.AmbientSource`, same source. Godot's own default is `AMBIENT_SOURCE_BG`. */
const AMBIENT_SOURCE_BG = 0;
const AMBIENT_SOURCE_DISABLED = 1;
const AMBIENT_SOURCE_COLOR = 2;
const AMBIENT_SOURCE_SKY = 3;

/** `Environment.ToneMapper`, from the pinned Godot 4.7 extension API. */
const TONE_MAPPER_FILMIC = 2;
const TONE_MAPPER_AGX = 4;

const TONE_MAPPER_NAMES: Readonly<Record<number, string>> = {
  0: "LINEAR",
  1: "REINHARDT",
  2: "FILMIC",
  3: "ACES",
  4: "AGX",
};

const AMBIENT_SOURCE_NAMES: Readonly<Record<number, string>> = {
  0: "BG",
  1: "DISABLED",
  2: "COLOR",
  3: "SKY",
};

/**
 * Godot 4's sky background: the same `scene.background` install the Godot 3 branch emits, decided
 * from Godot 4's own key names (`sky`, `background_energy_multiplier`).
 *
 * The two IBL channels are NOT decided here — the caller resolves them independently from Godot
 * 4.7's ambient and reflected-light source enums. See {@link translateGodot4Ambient}.
 */
/** Godot 4.7 `ProceduralSkyMaterial` defaults (class_proceduralskymaterial) — used only when
 *  the `.tres` is silent on that colour, which is Godot's own fallback. */
const GODOT4_PROCEDURAL_SKY_DEFAULTS = {
  skyTop: "#62738c",
  skyHorizon: "#a5a7ab",
  groundBottom: "#332b22",
  groundHorizon: "#a5a7ab",
} as const;

function translateGodot4Background(
  environment: AuthoredWorldEnvironment,
  ibl: { readonly diffuse: number; readonly specular: number },
  notes: TranslationNote[],
): EmittedWorldEnvironment | undefined {
  if (environment.backgroundMode === BG_COLOR) {
    if (environment.backgroundColor === undefined) {
      notes.push({
        at: environment.resPath,
        message:
          "this Environment is `background_mode = 1` (BG_COLOR) and authors no `background_color`, " +
          "so Godot's own default (opaque black) applies — class_environment 4.7, " +
          "`background_color` default `Color(0, 0, 0, 1)`. The emitted world declares no " +
          "background colour either, which is the same frame.",
      });
      return undefined;
    }
    const energy = environment.backgroundEnergy ?? 1;
    notes.push({
      at: environment.resPath,
      message:
        `background_mode = 1 (BG_COLOR) is carried as three's \`scene.background\` at ` +
        `${environment.backgroundColor}, energy ${energy}. Godot 4.7 class_environment: ` +
        '"Clears the background using a custom clear color" / `background_color` "Only effective ' +
        'when using the BG_COLOR background mode." The host already paints `scene.background` ' +
        "(`0x1a1a2e`), so a renderer `clearColor` would never show; the colour must replace the " +
        "scene background. `background_energy_multiplier` becomes `scene.backgroundIntensity`.",
    });
    if (
      environment.proceduralSky !== undefined ||
      environment.panorama !== undefined ||
      environment.physicalSky !== undefined
    ) {
      notes.push({
        at: environment.resPath,
        message:
          "this Environment authors a `Sky` (`ProceduralSkyMaterial`, `PanoramaSkyMaterial`, or " +
          "`PhysicalSkyMaterial`) " +
          "AND `background_mode = 1` (BG_COLOR). Godot does not draw that sky — class_environment " +
          "4.7, `background_color` is the only effective background in this mode — so the Sky / " +
          "ProceduralSkyMaterial is a named unused resource, not a silent drop.",
      });
    }
    return { kind: "godot-color", color: environment.backgroundColor, energy };
  }
  if (environment.backgroundMode !== BG_SKY) return undefined;
  const cubemap = environment.cubemapSky;
  if (cubemap !== undefined) {
    if (!cubemap.present) {
      throw new TranslateError(
        cubemap.resPath,
        "the active ShaderMaterial sky cubemap is absent; the emitted frame cannot fabricate it.",
      );
    }
    const energy = (environment.backgroundEnergy ?? 1) * cubemap.exposure;
    notes.push({
      at: environment.resPath,
      message:
        `background_mode = BG_SKY with the bound samplerCube shader is carried from ` +
        `${cubemap.resPath} (${cubemap.arrangement}) as three's CubeTexture background at energy ` +
        `${energy}. The shader's only operation is texture(source_panorama, EYEDIR) * exposure; ` +
        "the semantic frontend refuses any other active shader before this lowering runs.",
    });
    return {
      kind: "godot-cubemap",
      resPath: cubemap.resPath,
      url: assetUrl(cubemap.resPath),
      arrangement: cubemap.arrangement,
      energy,
      iblDiffuse: ibl.diffuse,
      iblSpecular: ibl.specular,
    };
  }
  const panorama = environment.panorama;
  if (panorama === undefined) {
    const physical = environment.physicalSky;
    if (physical !== undefined) {
      const energy = environment.backgroundEnergy ?? 1;
      if (energy !== 1) {
        throw new TranslateError(
          environment.resPath,
          `PhysicalSkyMaterial background_energy_multiplier ${energy} has no exact input in ` +
            "Three's native Sky shader; refusing rather than retaining an unused multiplier.",
        );
      }
      notes.push({
        at: environment.resPath,
        message:
          "background_mode = BG_SKY with PhysicalSkyMaterial is carried by Three's native Sky " +
          "shader. Its exact rayleigh/mie/turbidity uniforms drive the visible dome and a PMREM " +
          "generated at Sky.radiance_size drives scene.environment.",
      });
      return {
        kind: "godot-physical-sky",
        radianceSize: physical.radianceSize ?? 3,
        rayleighCoefficient: physical.rayleighCoefficient ?? 2,
        mieCoefficient: physical.mieCoefficient ?? 0.005,
        mieEccentricity: physical.mieEccentricity ?? 0.8,
        turbidity: physical.turbidity ?? 10,
        iblDiffuse: ibl.diffuse,
        iblSpecular: ibl.specular,
      };
    }
    const procedural = environment.proceduralSky;
    if (procedural !== undefined) {
      const energy = environment.backgroundEnergy ?? 1;
      const skyTop =
        procedural.skyTopColor ?? GODOT4_PROCEDURAL_SKY_DEFAULTS.skyTop;
      const skyHorizon =
        procedural.skyHorizonColor ?? GODOT4_PROCEDURAL_SKY_DEFAULTS.skyHorizon;
      const groundBottom =
        procedural.groundBottomColor ??
        GODOT4_PROCEDURAL_SKY_DEFAULTS.groundBottom;
      const groundHorizon =
        procedural.groundHorizonColor ??
        GODOT4_PROCEDURAL_SKY_DEFAULTS.groundHorizon;
      notes.push({
        at: environment.resPath,
        message:
          `background_mode = BG_SKY with a ProceduralSkyMaterial is carried as ` +
          `three's \`scene.background\` at the authored/default horizon ${skyHorizon} ` +
          `(top ${skyTop}, ground ${groundBottom}/${groundHorizon}) and, when ambient is sourced ` +
          "from the sky, a `<hemisphereLight>` of the same colours. Godot 4.7 class_environment " +
          '`BG_SKY` "Displays a user-defined sky in the background"; three has no Godot sky ' +
          "shader, so the dome curve (`sky_curve` / `ground_curve`) is a named deviation — the " +
          "frame is the horizon colour, not a generated skybox." +
          (ibl.diffuse > 0
            ? " Ambient is gathered from those colours (AMBIENT_SOURCE_SKY / BG+SKY), not from " +
              "an image-based environment three cannot build from a procedural material."
            : ""),
      });
      return {
        kind: "godot-procedural-sky",
        skyTop,
        skyHorizon,
        groundBottom,
        groundHorizon,
        energy,
      };
    }
    notes.push({
      at: environment.resPath,
      message:
        "this Environment is `background_mode = BG_SKY` and its `sky` does not resolve to a `Sky` " +
        "holding a supported `PanoramaSkyMaterial`, `ProceduralSkyMaterial`, or " +
        "`PhysicalSkyMaterial`. A custom `ShaderMaterial` sky is not mechanically portable, so " +
        "no background is fabricated and " +
        "the frame is cleared to the host's own colour.",
    });
    return undefined;
  }
  if (!panorama.present) {
    notes.push({
      at: panorama.resPath,
      message:
        "the PanoramaSkyMaterial texture is absent from the Godot project, so the emitted world " +
        "cannot load it and does not fabricate a background.",
    });
    return undefined;
  }
  const energy = environment.backgroundEnergy ?? 1;
  notes.push({
    at: environment.resPath,
    message:
      `background_mode = BG_SKY with the PanoramaSkyMaterial ${panorama.resPath} is carried as ` +
      `three's \`scene.background\`, equirectangular, at \`backgroundIntensity\` ${energy} ` +
      "(`background_energy_multiplier`). Godot samples a PanoramaSkyMaterial equirectangularly " +
      "with the image's first row at the zenith, which is three's " +
      "`EquirectangularReflectionMapping` exactly; the AZIMUTH origin differs between the two, so " +
      "the sky is rotated about Y by an unmeasured amount and that is a named deviation." +
      (ibl.diffuse > 0 || ibl.specular > 0
        ? " It is ALSO installed as `scene.environment`, because this Environment sources its " +
          "diffuse ambient and/or reflected light from the sky."
        : ""),
  });
  return {
    kind: "godot-panorama",
    resPath: panorama.resPath,
    url: assetUrl(panorama.resPath),
    energy,
    iblDiffuse: ibl.diffuse,
    iblSpecular: ibl.specular,
  };
}

/**
 * Godot 4's ambient light, resolved the way `render_scene_data_rd.cpp` resolves it.
 *
 * Returns the flat `<ambientLight>` to emit and whether the panorama must ALSO become
 * `scene.environment`. The two are mutually exclusive by construction: three's `scene.environment`
 * feeds `getIBLIrradiance`, so a scene carrying both would light every surface twice.
 */
function translateGodot4Ambient(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
): {
  ambient?: EmittedAmbientLight;
  hemisphere?: EmittedHemisphereLight;
  iblDiffuse: number;
} {
  const source = environment.ambientSource ?? AMBIENT_SOURCE_BG;
  const name = AMBIENT_SOURCE_NAMES[source];
  if (name === undefined) {
    // `ambient_light_source` decides where EVERY surface's fill light comes from, so an
    // unrecognised value cannot fall through to any of the four branches below and be called a
    // translation. A new Godot minor adding a fifth source refuses here and gets read.
    throw new TranslateError(
      environment.resPath,
      `ambient_light_source = ${source} is not one of Godot's four \`AmbientSource\` values ` +
        "(0 BG, 1 DISABLED, 2 COLOR, 3 SKY). This key decides where every surface in the scene " +
        "gets its fill light, so it is refused rather than defaulted onto one of the four.",
    );
  }
  const energy = environment.ambientLightEnergy ?? 1;
  // Environment::set_ambient_light_sky_contribution clamps exactly here in pinned 4.7 source.
  const skyContribution = Math.max(
    0,
    Math.min(1, environment.ambientLightSkyContribution ?? 1),
  );
  const background = environment.backgroundMode;

  // `use_ambient_cubemap = (src == BG && bg == SKY) || src == SKY` — render_scene_data_rd.cpp:190.
  const fromSky =
    (source === AMBIENT_SOURCE_BG && background === BG_SKY) ||
    source === AMBIENT_SOURCE_SKY;
  if (fromSky) {
    // A ProceduralSky has no image three can PMREM. Approximate Godot's sky-sourced fill with a
    // hemisphere of the material's own colours — class_environment 4.7 AMBIENT_SOURCE_SKY (3)
    // "Gather ambient light from the Sky regardless of what the background is."
    if (
      environment.panorama === undefined &&
      environment.proceduralSky !== undefined
    ) {
      const sky = environment.proceduralSky;
      const skyColor =
        sky.skyHorizonColor ??
        sky.skyTopColor ??
        GODOT4_PROCEDURAL_SKY_DEFAULTS.skyHorizon;
      const groundColor =
        sky.groundBottomColor ??
        sky.groundHorizonColor ??
        GODOT4_PROCEDURAL_SKY_DEFAULTS.groundBottom;
      notes.push({
        at: environment.resPath,
        message:
          `ambient_light_source = ${source} (${name}) gathers fill from a ProceduralSkyMaterial. ` +
          "three has no radiance cubemap for a generated sky, so the carry is a " +
          `\`<hemisphereLight>\` at sky ${skyColor} / ground ${groundColor}, energy ${energy}. ` +
          "Godot 4.7 class_environment: AMBIENT_SOURCE_SKY = 3 (not 2 — 2 is COLOR). The sky " +
          "dome curve is a named deviation; the hemisphere is the sky colour as fill light.",
      });
      return {
        hemisphere: {
          sky: skyColor,
          ground: groundColor,
          energy,
          reason:
            `\`${environment.resPath}\` ambient_light_source = ${source} (${name}) — Godot 4\n` +
            "          gathers every surface's fill from this ProceduralSky. three has no cubemap\n" +
            "          for a generated sky, so the carry is a hemisphere of the material colours.",
        },
        iblDiffuse: 0,
      };
    }
    const hasTextureSky =
      environment.panorama !== undefined ||
      environment.cubemapSky !== undefined;
    const flatWeight = 1 - skyContribution;
    const flatColor = environment.ambientLightColor;
    const ambient =
      flatWeight > 0 && flatColor !== undefined
        ? {
            color: flatColor,
            energy: energy * flatWeight,
            reason:
              `\`${environment.resPath}\` ambient_light_source = ${source} (${name}) — Godot 4\n` +
              `          mixes ${flatWeight} of its authored ambient colour with ${skyContribution} of the sky.`,
          }
        : undefined;
    notes.push({
      at: environment.resPath,
      message:
        `ambient_light_source = ${source} (${name}) uses Godot 4.7's independent ambient ` +
        `cubemap flag. Its sky contribution ${skyContribution} is carried only through Three's ` +
        "`getIBLIrradiance`, while the reflected-light source independently controls " +
        "`getIBLRadiance`; `render_scene_data_rd.cpp` sets those two flags in separate branches. " +
        (flatWeight > 0
          ? `The remaining ${flatWeight} of ambient_light_color is a flat AmbientLight at energy ${energy * flatWeight}. `
          : "") +
        (hasTextureSky
          ? "Three's PMREM convolution and Godot's radiance kernel remain a named roughness deviation."
          : "No image-backed Sky is available, so no cubemap contribution is fabricated."),
    });
    return {
      ...(ambient === undefined ? {} : { ambient }),
      iblDiffuse: hasTextureSky ? skyContribution : 0,
    };
  }

  if (source === AMBIENT_SOURCE_DISABLED) {
    notes.push({
      at: environment.resPath,
      message:
        "ambient_light_source = 1 (DISABLED): Godot lights this scene with its own lights and " +
        "nothing else, so the emitted world declares no ambient light either.",
    });
    return { iblDiffuse: 0 };
  }

  // `AMBIENT_SOURCE_COLOR`, or `AMBIENT_SOURCE_BG` over a colour background. The two differ only in
  // WHICH colour the shader reads (render_scene_data_rd.cpp:174-188): the BG case takes the
  // background colour scaled by `background_energy_multiplier`, the COLOR case takes
  // `ambient_light_color` scaled by `ambient_light_energy`.
  const overBackgroundColour = source !== AMBIENT_SOURCE_COLOR;
  if (overBackgroundColour && background !== BG_COLOR) {
    // BG_CLEAR_COLOR (Godot's own default background mode): the SAME cpp branch reads
    // `p_default_bg_color` — the PROJECT's `default_clear_color`, not this resource's
    // `background_color` — and lights every surface with it. That colour lives in a Godot 4
    // project setting this lane has not measured, so no ambient is invented; the missing fill
    // light is a named deviation rather than a value that looks authored.
    notes.push({
      at: environment.resPath,
      message:
        `ambient_light_source = ${source} (${name}) over background_mode = ` +
        `${environment.backgroundMode ?? 0} resolves to the PROJECT's default_clear_color ` +
        "(`render_scene_data_rd.cpp:173-180` reads `p_default_bg_color` for BG_CLEAR_COLOR), a " +
        "Godot 4 project setting this lane has not measured. No ambient is emitted, so surfaces " +
        "out of every light's reach render darker than Godot's, and that is a named deviation " +
        "rather than a guessed colour.",
    });
    return { iblDiffuse: 0 };
  }
  const color = overBackgroundColour
    ? environment.backgroundColor
    : environment.ambientLightColor;
  const scale = overBackgroundColour
    ? (environment.backgroundEnergy ?? 1)
    : energy;
  if (color === undefined) {
    notes.push({
      at: environment.resPath,
      message:
        `ambient_light_source = ${source} (${name}) resolves to a flat colour this resource does ` +
        `not author, so Godot's own default (opaque black) applies and the emitted world declares ` +
        "no ambient light — which is the same frame.",
    });
    return { iblDiffuse: 0 };
  }
  notes.push({
    at: environment.resPath,
    message:
      `ambient_light_source = ${source} (${name}) is carried as a flat \`<ambientLight>\` at ` +
      `${color}, energy ${scale}. Godot's shader reads ` +
      "`ambient_light_color_energy = srgb_to_linear(colour) * energy` and applies it to every " +
      "surface (`render_scene_data_rd.cpp:182-188`), which is what three does with an AmbientLight " +
      "carrying an sRGB hex. `ambient_light_sky_contribution` is NOT read on this path — " +
      "`scene_forward_clustered.glsl:1726` gates the sky mix behind `USE_AMBIENT_CUBEMAP`, which " +
      "this source does not set — so the reference page's \"only effective if sky contribution is " +
      'below 1" does not apply here. The emitted `intensity` is PI times this energy, and that ' +
      "factor is Godot 4's own: its shader applies ambient as `ambient_light *= albedo` with NO " +
      "1/PI (`scene_forward_clustered.glsl:2147`) while three routes an AmbientLight through " +
      "`BRDF_Lambert`, which divides by PI. The scene's DirectionalLights carry the same factor " +
      "for a different reason that lands in the same place — `light_storage.cpp:648-654` scales a " +
      "non-physical directional light by PI and `scene_forward_lights_inc.glsl:212` takes it back " +
      "out — so the two agree by construction rather than by coincidence.",
  });
  return {
    ambient: {
      color,
      energy: scale,
      reason:
        `\`${environment.resPath}\` ambient_light_source = ${source} (${name}) — Godot 4 lights\n` +
        "          every surface in the scene with this flat colour at this energy, and a surface\n" +
        "          in shadow is lit by it and nothing else. See `translate/rendering.ts` for the\n" +
        "          Godot 4.6 shader lines that pin the semantics its own docs leave ambiguous.",
    },
    iblDiffuse: 0,
  };
}

/**
 * Godot's own per-level glow weights when the resource authors none —
 * `Environment::Environment()`, `scene/resources/environment.cpp:1614-1621`.
 */
const GODOT4_GLOW_LEVEL_DEFAULTS: readonly number[] = [
  0, 0.8, 0.4, 0.1, 0, 0, 0,
];

/** `GlowBlendMode.GLOW_BLEND_MODE_SOFTLIGHT` — the one blend applied AFTER the tone curve. */
const GLOW_BLEND_SOFTLIGHT = 2;

/**
 * Every key the emitted glow pass reads, so `accountEnvironmentKeys` counts them as CARRIED when
 * the pass is emitted and lets `ENVIRONMENT_KEY_NOTES` name them when it is not.
 *
 * `glow_levels/N` is not here: it is matched by prefix in both places.
 */
const GLOW_KEYS: readonly string[] = [
  "glow_enabled",
  "glow_normalized",
  "glow_intensity",
  "glow_strength",
  "glow_bloom",
  "glow_mix",
  "glow_blend_mode",
  "glow_hdr_threshold",
  "glow_hdr_scale",
  "glow_hdr_luminance_cap",
];

/**
 * Godot 4's `glow_*` block, transcribed rather than mapped.
 *
 * Three ships `UnrealBloomPass`, and it is NOT this function: a different high-pass, a different
 * kernel, different level weights and a different composite. So the emitted pass is Godot's own —
 * the 9-tap separable kernel `{0.2024, 0.1790, 0.1240, 0.0672, 0.0285}` from
 * `shaders/effects/copy.glsl`'s `MODE_GAUSSIAN_BLUR`+`MODE_GLOW`, its firefly tone-map around the
 * first level, its `smoothstep(threshold, threshold + scale, maxChannel)` feedback, and
 * `apply_glow`'s blend from `shaders/effects/tonemap.glsl`. It runs BEFORE the tone curve because
 * that is where Godot runs it, on the exposed HDR colour.
 *
 * ONE blend mode is refused: `SOFTLIGHT` is applied AFTER tonemapping in Godot, on a glow that has
 * itself been tone-mapped, which is a different insertion point in the pass chain rather than a
 * different formula. No fixture on this shelf authors it, and inventing a placement for it would be
 * the guess this lane does not make.
 */
function translateGodot4Glow(
  environment: AuthoredWorldEnvironment,
  runtimeGlowAccess: boolean,
  notes: TranslationNote[],
): EmittedGlow | undefined {
  const hasAuthoredGlow = environment.authoredKeys.some((key) => key.startsWith("glow_"));
  if (!hasAuthoredGlow && !runtimeGlowAccess) return undefined;
  const enabled = environment.glowEnabled === true;
  const blendMode = environment.glowBlendMode ?? 1;
  if (blendMode === GLOW_BLEND_SOFTLIGHT && enabled) {
    notes.push({
      at: environment.resPath,
      message:
        "glow_blend_mode = 2 (SOFTLIGHT) is NOT carried. Godot applies every other blend to the " +
        "exposed HDR colour BEFORE the tone curve and this one AFTER it, to a glow that has itself " +
        "been tone-mapped (`tonemap.glsl`, the `GLOW_MODE_SOFTLIGHT` branch of `main`) — a " +
        "different place in the pass chain rather than a different formula. The rest of the glow " +
        "block is dropped with it rather than being applied at the wrong point.",
    });
    return undefined;
  }
  if (environment.glowMap === true) {
    notes.push({
      at: environment.resPath,
      message:
        "glow_map is authored: Godot modulates the gathered glow by that texture " +
        "(`mix(glow, texture(glow_map, uv) * glow, glow_map_strength)`). The retained pass has no " +
        "exact mask carrier, so this glow block is refused rather than emitted spatially uniform.",
    });
    return undefined;
  }
  const authored = environment.glowLevels ?? [];
  const raw = GODOT4_GLOW_LEVEL_DEFAULTS.map(
    (fallback, i) => authored[i] ?? fallback,
  );
  // Godot normalizes in `Environment::_update_glow`, not in the shader, so the emitted pass carries
  // weights that are already whatever the resource asked for.
  const total = raw.reduce((sum, one) => sum + one, 0);
  const levels =
    environment.glowNormalized === true && total > 0
      ? raw.map((one) => one / total)
      : raw;
  let levelCount = 0;
  for (let i = 0; i < levels.length; i += 1)
    if ((levels[i] as number) > 0.0001) levelCount = i + 1;
  if (enabled && levelCount === 0) {
    notes.push({
      at: environment.resPath,
      message:
        "glow_enabled is true and every `glow_levels/N` weight is zero, so Godot gathers nothing " +
        "and neither does the emitted world — the same frame, by the same arithmetic.",
    });
  }
  const glow: EmittedGlow = {
    dialect: "godot-4",
    enabled,
    levels,
    sourceLevels: raw,
    normalized: environment.glowNormalized === true,
    levelCount,
    intensity: environment.glowIntensity ?? 0.3,
    strength: environment.glowStrength ?? 1,
    bloom: environment.glowBloom ?? 0,
    hdrThreshold: environment.glowHdrThreshold ?? 1,
    hdrScale: environment.glowHdrScale ?? 2,
    luminanceCap: environment.glowHdrLuminanceCap ?? 12,
    // 0.05 is Godot's own member initializer (`environment.h:170`, 4.6-stable) — the property
    // range hint suggests otherwise but the constructor is the truth.
    mix: environment.glowMix ?? 0.05,
    blendMode,
  };
  notes.push({
    at: environment.resPath,
    message:
      `${enabled ? "glow_enabled is carried" : "glow_enabled is false; its dormant retained state is carried"} ` +
      `as Godot's own bloom: ${levelCount} pyramid level(s) at weights ` +
      `[${levels
        .slice(0, levelCount)
        .map((one) => one.toFixed(3))
        .join(
          ", ",
        )}], gathered at intensity ${glow.intensity} and blended by mode ` +
      `${glow.blendMode} onto the exposed HDR colour BEFORE the tone curve — Godot's own order. ` +
      "The kernel is Godot's 9-tap separable gaussian from `shaders/effects/copy.glsl`, with its " +
      `firefly tone-map around the first level and its ` +
      `smoothstep(${glow.hdrThreshold}, ${glow.hdrThreshold + glow.hdrScale}) HDR feedback; three's ` +
      "`UnrealBloomPass` is a different function and is deliberately not used. The pyramid's " +
      "levels are half-resolution steps as Godot's are, so the blur RADIUS matches at any viewport " +
      "size; exact per-texel agreement with a different rasterizer is not claimed.",
  });
  return glow;
}

/** Godot 4's tone mapper plus its `adjustment_*` block, as one fullscreen pass. */
function translateGodot4Tonemap(
  environment: AuthoredWorldEnvironment,
  glow: EmittedGlow | undefined,
  notes: TranslationNote[],
): EmittedPostEffect | undefined {
  const mode = environment.tonemapMode ?? 0;
  const adjustments =
    environment.adjustmentEnabled === true
      ? {
          brightness: environment.adjustmentBrightness ?? 1,
          contrast: environment.adjustmentContrast ?? 1,
          saturation: environment.adjustmentSaturation ?? 1,
        }
      : undefined;
  if (mode === 0 && glow !== undefined && adjustments === undefined) {
    return {
      kind: "godot-output",
      exposure: environment.tonemapExposure ?? 1,
      white: environment.tonemapWhite ?? 1,
      glow,
    };
  }
  if (mode !== TONE_MAPPER_FILMIC && mode !== TONE_MAPPER_AGX) {
    notes.push({
      at: environment.resPath,
      message:
        `tonemap_mode = ${mode} (${TONE_MAPPER_NAMES[mode] ?? "unknown"}): modes 2 (FILMIC) and ` +
        "4 (AGX) have exact translations on this lane, copied algebraically from Godot's own " +
        "`tonemap.glsl`. Three ships similarly named operators that are different functions, so " +
        "no tone curve " +
        "is invented and the frame is tone-mapped with the host's default." +
        (adjustments === undefined
          ? ""
          : " `adjustment_*` rides that pass and is therefore not carried either."),
    });
    return undefined;
  }
  const exposure = environment.tonemapExposure ?? 1;
  if (mode === TONE_MAPPER_AGX) {
    // Pinned 4.7 `environment_get_white`: SDR output_max_value is 1, AgX white is clamped to at
    // least 2, then multiplied by that output maximum. The browser output in this lane is SDR.
    const white = Math.max(2, environment.tonemapAgxWhite ?? 16.29);
    const contrast = environment.tonemapAgxContrast ?? 1.25;
    notes.push({
      at: environment.resPath,
      message:
        `tonemap_mode = 4 (AGX) at exposure ${exposure}, white ${white}, and contrast ${contrast} ` +
        "is carried by Godot 4.7's exact fullscreen AgX pass: its Rec.709/Rec.2020 inset and " +
        "outset matrices, AllenWP toe/shoulder curve, SDR output maximum, and CPU-derived curve " +
        "parameters are transcribed from pinned `tonemap.glsl` and `environment_storage.cpp`. " +
        "Three's AgX operator is not substituted." +
        (adjustments === undefined
          ? ""
          : ` \`adjustment_enabled\` rides the same pass in Godot's own order — brightness ` +
            `${adjustments.brightness} in linear, then contrast ${adjustments.contrast} and ` +
            `saturation ${adjustments.saturation} on the sRGB-encoded value.`),
    });
    return {
      kind: "godot-agx",
      exposure,
      white,
      contrast,
      ...(adjustments === undefined ? {} : { adjustments }),
      ...(glow === undefined ? {} : { glow }),
    };
  }
  const white = environment.tonemapWhite ?? 1;
  notes.push({
    at: environment.resPath,
    message:
      `tonemap_mode = 2 (FILMIC) at exposure ${exposure} and white point ${white} is carried by an ` +
      "exact fullscreen Hable pass copied from Godot 4.6's `shaders/effects/tonemap.glsl` " +
      "(`exposure_bias = 2` baked into A and B, normalized by the same curve at the white point)." +
      (adjustments === undefined
        ? ""
        : ` \`adjustment_enabled\` rides the same pass in Godot's own order — brightness ` +
          `${adjustments.brightness} in linear, then contrast ${adjustments.contrast} and ` +
          `saturation ${adjustments.saturation} on the sRGB-encoded value ` +
          "(`tonemap.glsl:916-935`)."),
  });
  return {
    kind: "godot-filmic",
    exposure,
    white,
    ...(adjustments === undefined ? {} : { adjustments }),
    ...(glow === undefined ? {} : { glow }),
  };
}

/** Godot 4.7's exact fixed fog inputs; executable equations live once in godot-compat. */
const GODOT4_FOG_KEYS = [
  "fog_enabled",
  "fog_mode",
  "fog_light_color",
  "fog_light_energy",
  "fog_sun_scatter",
  "fog_density",
  "fog_aerial_perspective",
  "fog_sky_affect",
  "fog_height",
  "fog_height_density",
  "fog_depth_curve",
  "fog_depth_begin",
  "fog_depth_end",
] as const;

const GODOT4_SSAO_KEYS = [
  "ssao_enabled",
  "ssao_radius",
  "ssao_intensity",
  "ssao_power",
  "ssao_detail",
  "ssao_horizon",
  "ssao_sharpness",
  "ssao_light_affect",
  "ssao_ao_channel_affect",
] as const;

function godot4SsaoQuality(
  rendering: RenderingSettings,
): 0 | 1 | 2 | 3 | 4 {
  const quality = rendering.ssaoQuality ?? 2;
  if (
    quality !== 0 &&
    quality !== 1 &&
    quality !== 2 &&
    quality !== 3 &&
    quality !== 4
  ) {
    throw new TranslateError(
      "project.godot#rendering/environment/ssao/quality",
      `SSAO quality = ${quality} is not a Godot 4.7 EnvironmentSSAOQuality ` +
        "(0 VERY_LOW, 1 LOW, 2 MEDIUM, 3 HIGH, 4 ULTRA).",
    );
  }
  return quality;
}

function finiteSsaoScalar(
  resPath: string,
  key: string,
  value: number,
): number {
  if (!Number.isFinite(value)) {
    throw new TranslateError(
      resPath,
      `${key} = ${value} is not finite. Godot uploads this scalar directly to the SSAO shader; ` +
        "translation refuses instead of emitting a backend-dependent NaN/Infinity kernel.",
    );
  }
  return value;
}

function translateGodot4AmbientOcclusion(
  environment: AuthoredWorldEnvironment,
  rendering: RenderingSettings,
  notes: TranslationNote[],
): EmittedAmbientOcclusion | undefined {
  if (environment.ssaoEnabled !== true) {
    if (
      environment.authoredKeys.some((key) =>
        (GODOT4_SSAO_KEYS as readonly string[]).includes(key),
      )
    ) {
      notes.push({
        at: environment.resPath,
        message:
          "the authored Godot 4 SSAO fields are inactive because ssao_enabled is false; " +
          "Godot does not schedule the effect and the translation does not either.",
      });
    }
    return undefined;
  }
  const method = rendering.renderingMethod ?? "forward_plus";
  if (method === "mobile") {
    notes.push({
      at: environment.resPath,
      message:
        "ssao_enabled is inert on Godot 4.7's Mobile renderer: RenderForwardMobile does not " +
        "process SSAO and environment_set_ssao_quality is a no-op. The translation preserves " +
        "the selected source renderer's absence rather than injecting another renderer's pass.",
    });
    return undefined;
  }
  if (method === "forward_plus") {
    throw new TranslateError(
      environment.resPath,
      "active Godot 4.7 Forward+ SSAO consumes the source renderer's normal-roughness prepass, " +
        "four deinterleaved linear-depth layers, edge-packed Intel SSAO buffers and integrates " +
        "ssao_light_affect/ssao_ao_channel_affect into opaque material lighting. The current " +
        "native Three render target exposes none of those source attachments, so translation " +
        "refuses instead of substituting Compatibility S4AO or a generic normal-pass effect.",
    );
  }
  if (method !== "gl_compatibility") {
    throw new TranslateError(
      "project.godot#rendering/renderer/rendering_method",
      `active SSAO uses unknown rendering_method=${method}; expected forward_plus, mobile, or ` +
        "gl_compatibility.",
    );
  }
  const quality = godot4SsaoQuality(rendering);
  const ignoredQualitySettings = [
    rendering.ssaoHalfSize === undefined
      ? undefined
      : `half_size=${rendering.ssaoHalfSize}`,
    rendering.ssaoAdaptiveTarget === undefined
      ? undefined
      : `adaptive_target=${rendering.ssaoAdaptiveTarget}`,
    rendering.ssaoBlurPasses === undefined
      ? undefined
      : `blur_passes=${rendering.ssaoBlurPasses}`,
    rendering.ssaoFadeoutFrom === undefined
      ? undefined
      : `fadeout_from=${rendering.ssaoFadeoutFrom}`,
    rendering.ssaoFadeoutTo === undefined
      ? undefined
      : `fadeout_to=${rendering.ssaoFadeoutTo}`,
  ].filter((value): value is string => value !== undefined);
  const radius = finiteSsaoScalar(
    environment.resPath,
    "ssao_radius",
    environment.ssaoRadius ?? 1,
  );
  const intensity = finiteSsaoScalar(
    environment.resPath,
    "ssao_intensity",
    environment.ssaoIntensity ?? 2,
  );
  const ignoredEnvironmentFields = GODOT4_SSAO_KEYS.filter(
    (key) =>
      key !== "ssao_enabled" &&
      key !== "ssao_radius" &&
      key !== "ssao_intensity" &&
      environment.authoredKeys.includes(key),
  );
  const ambientOcclusion: EmittedAmbientOcclusion = {
    dialect: "godot-4-compatibility",
    radius,
    intensity,
    quality,
  };
  notes.push({
    at: environment.resPath,
    message:
      `ssao_enabled is carried through Godot 4.7 Compatibility's exact quality-${quality}` +
      (rendering.ssaoQuality === undefined ? " (source default MEDIUM)" : "") +
      " " +
      "S4AO post kernel: reversed stored depth, deterministic per-pixel rotation, source sample " +
      "grid/rings, radius*0.5 and intensity*2 CPU uploads, and squared visibility in linear " +
      "color before tone mapping. This renderer reads only ssao_enabled, ssao_radius and " +
      "ssao_intensity from Environment" +
      (ignoredEnvironmentFields.length === 0
        ? ""
        : `; its own post_copy ignores the authored Forward+-only field(s) ${ignoredEnvironmentFields.join(", ")}`) +
      (ignoredQualitySettings.length === 0
        ? "."
        : `; its environment_set_ssao_quality also ignores ${ignoredQualitySettings.join(", ")}.`),
  });
  return ambientOcclusion;
}

const GODOT4_SSR_KEYS = [
  "ssr_enabled",
  "ssr_max_steps",
  "ssr_fade_in",
  "ssr_fade_out",
  "ssr_depth_tolerance",
] as const;

function classifyGodot4ScreenSpaceReflections(
  environment: AuthoredWorldEnvironment,
  rendering: RenderingSettings,
  notes: TranslationNote[],
): void {
  if (
    environment.authoredKeys.includes("ssr_enabled") &&
    environment.ssrEnabled === undefined
  ) {
    throw new TranslateError(
      environment.resPath,
      "the authored Godot 4 ssr_enabled value is not a bool.",
    );
  }
  if (environment.ssrEnabled !== true) {
    if (
      environment.authoredKeys.some((key) =>
        (GODOT4_SSR_KEYS as readonly string[]).includes(key),
      )
    ) {
      notes.push({
        at: environment.resPath,
        message:
          "the authored Godot 4 screen-space reflection fields are inactive because ssr_enabled " +
          "is false; Godot does not schedule the effect and the translation does not either.",
      });
    }
    return;
  }
  const method = rendering.renderingMethod ?? "forward_plus";
  if (method === "mobile") {
    notes.push({
      at: environment.resPath,
      message:
        "ssr_enabled is inert on Godot 4.7's Mobile renderer: RenderForwardMobile does not " +
        "schedule screen-space reflections and its SSR quality setters are no-ops. The " +
        "translation preserves the selected renderer's absence.",
    });
    return;
  }
  if (method === "gl_compatibility") {
    notes.push({
      at: environment.resPath,
      message:
        "ssr_enabled is inert on Godot 4.7's Compatibility renderer: RasterizerSceneGLES3 has " +
        "no SSR render path and its SSR quality setters are no-ops. The translation preserves " +
        "the selected renderer's absence.",
    });
    return;
  }
  if (method !== "forward_plus") {
    throw new TranslateError(
      "project.godot#rendering/renderer/rendering_method",
      `active SSR uses unknown rendering_method=${method}; expected forward_plus, mobile, or ` +
        "gl_compatibility.",
    );
  }
  throw new TranslateError(
    environment.resPath,
    "active Godot 4.7 Forward+ screen-space reflections require the source renderer's " +
      "normal-roughness and metallic render-buffer attachments, hierarchical depth mip chain, " +
      "last-frame color and camera reprojection matrices. The native Three render target exposes " +
      "none of those material channels, so translation refuses instead of installing a generic " +
      "screen-space reflection pass over different inputs.",
  );
}

function classifyGodot4SkyTransform(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
): void {
  if (
    environment.authoredKeys.includes("sky_rotation") &&
    environment.skyRotation === undefined
  ) {
    throw new TranslateError(
      environment.resPath,
      "the authored Godot 4 sky_rotation is not a Vector3 with three numeric components.",
    );
  }
  if (
    environment.authoredKeys.includes("sky_custom_fov") &&
    environment.skyCustomFov === undefined
  ) {
    throw new TranslateError(
      environment.resPath,
      "the authored Godot 4 sky_custom_fov is not a numeric scalar.",
    );
  }
  const customFov = environment.skyCustomFov ?? 0;
  if (customFov !== 0) {
    throw new TranslateError(
      environment.resPath,
      `sky_custom_fov = ${customFov} replaces the camera projection used only for Godot's sky ` +
        "draw. Three's Scene background uses the mounted camera projection directly, so " +
        "translation refuses instead of changing the gameplay camera or approximating a " +
        "different sky field of view.",
    );
  }
  if (!environment.authoredKeys.includes("sky_rotation")) {
    if (environment.authoredKeys.includes("sky_custom_fov")) {
      notes.push({
        at: environment.resPath,
        message:
          "sky_custom_fov is authored as 0, which selects the camera projection in Godot and " +
          "requires no separate sky projection in the translation.",
      });
    }
    return;
  }
  if (environment.skyRotation !== undefined && !allZero(environment.skyRotation)) {
    throw new TranslateError(
      environment.resPath,
      "the authored Godot 4 sky_rotation is nonzero. Godot applies the inverse Basis generated " +
        "from its YXZ Euler to the camera-space sky ray before material lookup; Three rotates an " +
        "already world-space environment direction under its own handedness and equirectangular " +
        "azimuth. The current panorama carry still names that baseline convention as a deviation, " +
        "so translation refuses rather than treating equal Euler components as an equal texture " +
        "transform.",
    );
  }
  notes.push({
    at: environment.resPath,
    message:
      "the authored Godot 4 sky_rotation is zero; its inverse Basis changes no lookup direction " +
      "and the translation emits no extra rotation.",
  });
}

function translateGodot4Fog(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
): EmittedFog | undefined {
  if (environment.fogEnabled !== true) {
    if (
      environment.authoredKeys.some((key) =>
        (GODOT4_FOG_KEYS as readonly string[]).includes(key),
      )
    ) {
      notes.push({
        at: environment.resPath,
        message:
          "the authored Godot 4 fixed-fog fields are inactive because fog_enabled is false " +
          "(the Environment default); Godot ignores them and the translation does too.",
      });
    }
    return undefined;
  }
  const mode = environment.fogMode ?? 0;
  if (mode !== 0 && mode !== 1) {
    throw new TranslateError(
      environment.resPath,
      `fog_mode = ${mode} is not one of Godot 4.7's EnvironmentFogMode values ` +
        "(0 EXPONENTIAL, 1 DEPTH).",
    );
  }
  const aerialPerspective = environment.fogAerialPerspective ?? 0;
  if (aerialPerspective !== 0) {
    throw new TranslateError(
      environment.resPath,
      `fog_aerial_perspective = ${aerialPerspective} requires the renderer's roughness-LOD ` +
        "radiance octahedral map for every geometry fragment. The postprocessing pass has the " +
        "visible sky color but not that filtered environment texture, so it refuses rather than " +
        "carrying only the sky half or substituting an unblurred screen sample.",
    );
  }
  const fog: EmittedFog = {
    dialect: "godot-4",
    mode,
    lightColor: environment.fogLightColor ?? "#848d9b",
    lightEnergy: environment.fogLightEnergy ?? 1,
    sunScatter: environment.fogSunScatter ?? 0,
    density: environment.fogDensity ?? 0.01,
    height: environment.fogHeight ?? 0,
    heightDensity: environment.fogHeightDensity ?? 0,
    aerialPerspective,
    skyAffect: environment.fogSkyAffect ?? 1,
    depthCurve: environment.fogDepthCurve ?? 1,
    depthBegin: environment.fogDepthBegin ?? 10,
    depthEnd: environment.fogDepthEnd ?? 100,
  };
  notes.push({
    at: environment.resPath,
    message:
      `fog_enabled is carried by the exact Godot 4.7 fixed-fog pass (${mode === 1 ? "DEPTH" : "EXPONENTIAL"}): ` +
      "view distance, depth curve/range, signed height-density exponential, sRGB light colour and " +
      "energy, directional sun scatter, zero aerial perspective, and sky-affect are transcribed " +
      "from pinned `scene_forward_clustered.glsl`, `sky.glsl`, and `render_scene_data_rd.cpp`. " +
      "It consumes the native composer depth texture; Three Fog/FogExp2 are not used.",
  });
  return fog;
}

const GODOT4_PRACTICAL_DOF_KEYS = new Set([
  "dof_blur_far_enabled",
  "dof_blur_far_distance",
  "dof_blur_far_transition",
  "dof_blur_near_enabled",
  "dof_blur_near_distance",
  "dof_blur_near_transition",
  "dof_blur_amount",
  "exposure_multiplier",
  "exposure_sensitivity",
  "auto_exposure_enabled",
  "auto_exposure_speed",
  "auto_exposure_scale",
  "auto_exposure_min_sensitivity",
  "auto_exposure_max_sensitivity",
]);

function finiteCameraScalar(
  attributes: AuthoredCameraAttributes,
  name: string,
  value: number,
): number {
  if (Number.isFinite(value)) return value;
  throw new TranslateError(
    attributes.resPath,
    `${name} must be finite; received ${String(value)}.`,
  );
}

const CAMERA_ATTRIBUTE_NUMBER_FIELDS: Readonly<
  Record<keyof AuthoredCameraAttributes, string | undefined>
> = {
  resPath: undefined,
  type: undefined,
  authoredKeys: undefined,
  farEnabled: undefined,
  farDistance: "dof_blur_far_distance",
  farTransition: "dof_blur_far_transition",
  nearEnabled: undefined,
  nearDistance: "dof_blur_near_distance",
  nearTransition: "dof_blur_near_transition",
  amount: "dof_blur_amount",
  exposureMultiplier: "exposure_multiplier",
  exposureSensitivity: "exposure_sensitivity",
  exposureAperture: "exposure_aperture",
  exposureShutterSpeed: "exposure_shutter_speed",
  autoExposureEnabled: undefined,
  autoExposureSpeed: "auto_exposure_speed",
  autoExposureScale: "auto_exposure_scale",
  autoExposureMinSensitivity: "auto_exposure_min_sensitivity",
  autoExposureMaxSensitivity: "auto_exposure_max_sensitivity",
  autoExposureMinExposureValue: "auto_exposure_min_exposure_value",
  autoExposureMaxExposureValue: "auto_exposure_max_exposure_value",
};

function classifyGodot4CameraExposure(input: RenderingTranslationInput): void {
  const attributes = input.cameraAttributes;
  if (attributes === undefined) return;
  for (const [field, key] of [
    ["farEnabled", "dof_blur_far_enabled"],
    ["nearEnabled", "dof_blur_near_enabled"],
    ["autoExposureEnabled", "auto_exposure_enabled"],
  ] as const) {
    if (
      attributes.authoredKeys.includes(key) &&
      attributes[field] === undefined
    ) {
      throw new TranslateError(
        attributes.resPath,
        `CameraAttributes ${key} is authored with a non-boolean value.`,
      );
    }
  }
  for (const [field, key] of Object.entries(CAMERA_ATTRIBUTE_NUMBER_FIELDS)) {
    if (
      key !== undefined &&
      attributes.authoredKeys.includes(key) &&
      attributes[field as keyof AuthoredCameraAttributes] === undefined
    ) {
      throw new TranslateError(
        attributes.resPath,
        `CameraAttributes ${key} is authored with a non-numeric value.`,
      );
    }
  }
  const multiplier = attributes.exposureMultiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new TranslateError(
      attributes.resPath,
      `exposure_multiplier must be a finite nonnegative value; received ${multiplier}.`,
    );
  }
  if (multiplier !== 1) {
    throw new TranslateError(
      attributes.resPath,
      `exposure_multiplier = ${multiplier} is consumed upstream by Godot's directional and ` +
        "positional lights, sky/background, emissive and IBL normalization, GI, lightmaps and " +
        "reflections. The native post pass cannot reproduce those separate pre-render writes, " +
        "so translation refuses instead of multiplying only the final image.",
    );
  }
  if (input.rendering.physicalLightUnits === true) {
    throw new TranslateError(
      "project.godot#rendering/lights_and_shadows/use_physical_light_units",
      `CameraAttributes ${attributes.resPath} participates in physical exposure normalization ` +
        "for every light, sky, IBL and emissive surface. That pre-lighting normalization is not " +
        "yet carried by the native Three scene, so translation refuses rather than applying only " +
        "its postprocessing half.",
    );
  }
}

function translateGodot4AutoExposure(
  input: RenderingTranslationInput,
  notes: TranslationNote[],
): EmittedAutoExposure | undefined {
  const attributes = input.cameraAttributes;
  if (attributes === undefined) return undefined;
  if (
    attributes.authoredKeys.includes("auto_exposure_enabled") &&
    attributes.autoExposureEnabled === undefined
  ) {
    throw new TranslateError(
      attributes.resPath,
      "CameraAttributes auto_exposure_enabled is authored with a non-boolean value.",
    );
  }
  if (attributes.autoExposureEnabled !== true) {
    const inert = attributes.authoredKeys.filter((key) =>
      key.startsWith("auto_exposure_"),
    );
    if (inert.length > 0) {
      notes.push({
        at: attributes.resPath,
        message:
          `${inert.join(", ")} ${inert.length === 1 ? "is" : "are"} authored while ` +
          "auto_exposure_enabled is false (the CameraAttributes default), so Godot does not " +
          "schedule luminance reduction and neither does the translation.",
      });
    }
    return undefined;
  }
  const method = input.rendering.renderingMethod ?? "forward_plus";
  if (method === "gl_compatibility" || method === "mobile") {
    notes.push({
      at: attributes.resPath,
      message:
        `auto_exposure_enabled is inert under Godot 4.7 ${method}: ` +
        "camera_attributes_storage.cpp exposes auto exposure only in Forward+. The translation " +
        "preserves that source-renderer no-op rather than scheduling a luminance pass.",
    });
    return undefined;
  }
  if (method !== "forward_plus") {
    throw new TranslateError(
      "project.godot#rendering/renderer/rendering_method",
      `active CameraAttributes auto exposure uses unknown rendering_method=${method}; expected ` +
        "forward_plus, mobile, or gl_compatibility.",
    );
  }
  if (attributes.type === "CameraAttributesPhysical") {
    throw new TranslateError(
      attributes.resPath,
      "active CameraAttributesPhysical auto exposure cannot be isolated from the resource's " +
        "physical camera contract: frustum focal length/focus/near/far, aperture and shutter " +
        "derive both the mounted camera projection/DOF and pre-lighting exposure normalization. " +
        "Those source-side camera and lighting writes are not yet carried, so translation " +
        "refuses the resource by type instead of emitting only its luminance-reduction tail.",
    );
  }
  const speed = finiteCameraScalar(
    attributes,
    "auto_exposure_speed",
    attributes.autoExposureSpeed ?? 0.5,
  );
  const scale = finiteCameraScalar(
    attributes,
    "auto_exposure_scale",
    attributes.autoExposureScale ?? 0.4,
  );
  const sensitivity = finiteCameraScalar(
    attributes,
    "exposure_sensitivity",
    attributes.exposureSensitivity ?? 100,
  );
  if (speed < 0 || scale <= 0 || sensitivity <= 0) {
    throw new TranslateError(
      attributes.resPath,
      `active auto exposure requires speed >= 0, scale > 0 and exposure_sensitivity > 0; ` +
        `received ${speed}, ${scale}, ${sensitivity}.`,
    );
  }
  const minSensitivity = finiteCameraScalar(
    attributes,
    "auto_exposure_min_sensitivity",
    attributes.autoExposureMinSensitivity ?? 0,
  );
  const maxSensitivity = finiteCameraScalar(
    attributes,
    "auto_exposure_max_sensitivity",
    attributes.autoExposureMaxSensitivity ?? 800,
  );
  if (minSensitivity < 0 || maxSensitivity < minSensitivity) {
    throw new TranslateError(
      attributes.resPath,
      `active practical auto exposure requires 0 <= min sensitivity <= max sensitivity; ` +
        `received ${minSensitivity}/${maxSensitivity}.`,
    );
  }
  const minLuminance = minSensitivity * ((12.5 / 100) / sensitivity);
  const maxLuminance = maxSensitivity * ((12.5 / 100) / sensitivity);
  if (
    !Number.isFinite(minLuminance) ||
    !Number.isFinite(maxLuminance) ||
    minLuminance < 0 ||
    maxLuminance < minLuminance
  ) {
    throw new TranslateError(
      attributes.resPath,
      `CameraAttributes resolves auto-exposure luminance range ${minLuminance}/${maxLuminance}; ` +
        "the pinned renderer requires a finite ordered nonnegative range.",
    );
  }
  const autoExposure: EmittedAutoExposure = {
    dialect: "godot-4",
    // Forward+ normally selects the storage/compute reduction. The copied WebGL pass executes the
    // same equations in fragments; a source device that cannot use storage instead selects
    // luminance_reduce_raster.glsl and remains an explicitly named device-path deviation.
    rendererPath: "compute",
    minLuminance,
    maxLuminance,
    speed,
    scale,
  };
  notes.push({
    at: attributes.resPath,
    message:
      `auto exposure is carried through Godot 4.7's exact ${autoExposure.rendererPath} ` +
      "8x luminance pyramid, first-frame immediate state, retained 1x1 smoothing, source range " +
      "conversion and tone/glow exposure texture. Forward+ devices whose RD backend rejects " +
      "storage images select Godot's distinct raster reducer; that device-only fallback is not " +
      "selected by rendering_method and is a named deviation from this compute-equation carry.",
  });
  return autoExposure;
}

function translateGodot4DepthOfField(
  input: RenderingTranslationInput,
  notes: TranslationNote[],
): EmittedDepthOfField | undefined {
  const attributes = input.cameraAttributes;
  if (attributes === undefined) return undefined;
  if (attributes.type === "CameraAttributesPhysical") {
    throw new TranslateError(
      attributes.resPath,
      "CameraAttributesPhysical derives near/far DOF transitions and blur size from " +
        "frustum_focus_distance, frustum_focal_length and exposure_aperture, while also replacing " +
        "the camera frustum. This practical-attributes pass refuses the physical camera resource " +
        "by source type instead of applying only its blur look.",
    );
  }
  const unsupportedKeys = attributes.authoredKeys.filter(
    (key) => !GODOT4_PRACTICAL_DOF_KEYS.has(key),
  );
  if (unsupportedKeys.length > 0) {
    throw new TranslateError(
      attributes.resPath,
      `CameraAttributesPractical authors non-DOF scalar(s) ${unsupportedKeys.join(", ")}. ` +
        "They affect exposure/auto-exposure whether or not DOF is active, so this DOF tranche " +
        "refuses rather than silently dropping them.",
    );
  }
  const farEnabled = attributes.farEnabled ?? false;
  const nearEnabled = attributes.nearEnabled ?? false;
  if (!farEnabled && !nearEnabled) {
    notes.push({
      at: attributes.resPath,
      message:
        "CameraAttributesPractical authors no enabled near/far depth-of-field branch, so Godot " +
        "does not schedule BokehDOF and neither does the translation.",
    });
    return undefined;
  }
  const shape = input.rendering.dofBokehShape ?? 1;
  if (shape !== 0 && shape !== 1 && shape !== 2) {
    throw new TranslateError(
      "project.godot#rendering/camera/depth_of_field/depth_of_field_bokeh_shape",
      `depth_of_field_bokeh_shape = ${shape} is not a Godot 4.7 DOFBokehShape ` +
        "(0 BOX, 1 HEXAGON, 2 CIRCLE).",
    );
  }
  const quality = input.rendering.dofBokehQuality ?? 1;
  if (quality !== 0 && quality !== 1 && quality !== 2 && quality !== 3) {
    throw new TranslateError(
      "project.godot#rendering/camera/depth_of_field/depth_of_field_bokeh_quality",
      `depth_of_field_bokeh_quality = ${quality} is not a Godot 4.7 DOFBlurQuality ` +
        "(0 VERY_LOW, 1 LOW, 2 MEDIUM, 3 HIGH).",
    );
  }
  const method = input.rendering.renderingMethod ?? "forward_plus";
  if (method === "gl_compatibility") {
    throw new TranslateError(
      "project.godot#rendering/renderer/rendering_method",
      "active CameraAttributesPractical depth of field is not implemented by Godot 4's " +
        "gl_compatibility renderer. Translation refuses instead of scheduling an RD bokeh pass " +
        "that the selected source renderer would not run.",
    );
  }
  if (method !== "forward_plus" && method !== "mobile") {
    throw new TranslateError(
      "project.godot#rendering/renderer/rendering_method",
      `active CameraAttributesPractical uses unknown rendering_method=${method}; expected ` +
        "forward_plus (compute BokehDOF) or mobile (raster BokehDOF).",
    );
  }
  if (method === "forward_plus" && input.rendering.dofUseJitter === true) {
    throw new TranslateError(
      "project.godot#rendering/camera/depth_of_field/depth_of_field_use_jitter",
      "Forward+ compute BokehDOF requests depth_of_field_use_jitter=true, whose per-frame " +
        "Math::randf seed must come from the translated project's deterministic random source. " +
        "That seed is not yet threaded into the postprocessing pass, so translation refuses " +
        "instead of using ambient Math.random or silently disabling jitter.",
    );
  }
  const amount = attributes.amount ?? 0.1;
  if (amount < 0 || amount > 1) {
    throw new TranslateError(
      attributes.resPath,
      `dof_blur_amount = ${amount} is outside CameraAttributesPractical's declared [0, 1] ` +
        "range. The exact WebGL circular kernel has Godot's maximum 4096 iterations for the " +
        "corresponding 64-pixel maximum radius, so translation refuses rather than truncating an " +
        "out-of-range resource.",
    );
  }
  const depthOfField: EmittedDepthOfField = {
    dialect: "godot-4",
    farEnabled,
    farDistance: attributes.farDistance ?? 10,
    farTransition: attributes.farTransition ?? 5,
    nearEnabled,
    nearDistance: attributes.nearDistance ?? 2,
    nearTransition: attributes.nearTransition ?? 1,
    amount,
    shape,
    quality,
    rendererPath: method === "forward_plus" ? "compute" : "raster",
  };
  notes.push({
    at: attributes.resPath,
    message:
      `CameraAttributesPractical depth of field is carried through Godot 4.7's exact ${depthOfField.rendererPath} ` +
      "BokehDOF equations, quality/shape kernel, blur-weight channel and low-quality composite.",
  });
  return depthOfField;
}

/** Godot 4's `WorldEnvironment` resource, key by key. */
function translateGodot4Environment(
  environment: AuthoredWorldEnvironment,
  notes: TranslationNote[],
  input: RenderingTranslationInput,
): RenderingTranslation {
  if (environment.volumetricFogEnabled === true) {
    throw new TranslateError(
      environment.resPath,
      "volumetric_fog_enabled = true requires Godot's raymarched froxel volume, temporal " +
        "reprojection, and light injection. The fixed depth/height pass cannot represent it, so " +
        "translation refuses rather than substituting Three Fog/FogExp2 or silently disabling it.",
    );
  }
  const { ambient, hemisphere, iblDiffuse } = translateGodot4Ambient(
    environment,
    notes,
  );
  const reflectionSource = environment.reflectionSource ?? 0;
  if (
    reflectionSource !== 0 &&
    reflectionSource !== 1 &&
    reflectionSource !== 2
  ) {
    throw new TranslateError(
      environment.resPath,
      `reflected_light_source = ${reflectionSource} is not one of Godot 4.7's three ` +
        "`ReflectionSource` values (0 BG, 1 DISABLED, 2 SKY).",
    );
  }
  const hasImageSky =
    environment.panorama !== undefined ||
    environment.cubemapSky !== undefined ||
    environment.physicalSky !== undefined;
  const iblSpecular =
    hasImageSky &&
    (reflectionSource === 2 ||
      (reflectionSource === 0 && environment.backgroundMode === BG_SKY))
      ? 1
      : 0;
  if (
    reflectionSource === 2 &&
    environment.backgroundMode !== BG_SKY &&
    hasImageSky
  ) {
    throw new TranslateError(
      environment.resPath,
      "reflected_light_source = SKY with a non-sky background needs the Environment Sky as a " +
        "hidden specular source. This lowering currently couples image loading to BG_SKY, so it " +
        "refuses instead of silently dropping the source or painting the hidden sky.",
    );
  }
  const worldEnvironment = translateGodot4Background(
    environment,
    { diffuse: iblDiffuse, specular: iblSpecular },
    notes,
  );
  // The glow is resolved BEFORE the tone curve because it rides the same pass and Godot applies it
  // first; a project whose tonemapper this lane cannot carry loses its glow with it, and
  // `translateGodot4Tonemap` says so at that path.
  const glow = translateGodot4Glow(
    environment,
    input.runtimeGlowAccess === true,
    notes,
  );
  const toneEffect = translateGodot4Tonemap(environment, glow, notes);
  const fog = translateGodot4Fog(environment, notes);
  const autoExposure = translateGodot4AutoExposure(input, notes);
  const depthOfField = translateGodot4DepthOfField(input, notes);
  const ambientOcclusion = translateGodot4AmbientOcclusion(
    environment,
    input.rendering,
    notes,
  );
  classifyGodot4ScreenSpaceReflections(environment, input.rendering, notes);
  classifyGodot4SkyTransform(environment, notes);
  refuseUnsupportedFixedFogInputs(fog, input, "Godot 4.7");
  if (fog !== undefined && input.rendering.physicalLightUnits === true) {
    throw new TranslateError(
      "project.godot#rendering/lights_and_shadows/use_physical_light_units",
      "fixed Environment fog with physical light units multiplies every directional light by " +
        "light_intensity and CameraAttributes exposure normalization. Those values are not yet " +
        "carried into the Three light, so translation refuses rather than applying the " +
        "non-physical E*PI/E geometry/sky energy split.",
    );
  }
  const postEffect =
    toneEffect === undefined
      ? fog === undefined &&
        autoExposure === undefined &&
        depthOfField === undefined &&
        ambientOcclusion === undefined
        ? undefined
        : {
            kind: "godot-output" as const,
            exposure: 1,
            white: 1,
            ...(fog === undefined ? {} : { fog }),
            ...(autoExposure === undefined ? {} : { autoExposure }),
            ...(depthOfField === undefined ? {} : { depthOfField }),
            ...(ambientOcclusion === undefined
              ? {}
              : { ambientOcclusion }),
          }
      : {
          ...toneEffect,
          ...(fog === undefined ? {} : { fog }),
          ...(autoExposure === undefined ? {} : { autoExposure }),
          ...(depthOfField === undefined ? {} : { depthOfField }),
          ...(ambientOcclusion === undefined ? {} : { ambientOcclusion }),
        };

  // `background_color` is authored by projects that never use BG_COLOR, and Godot ignores it there
  // ("Only effective when using the BG_COLOR background mode" — class_environment). Carrying it as
  // a clear colour would paint a colour the source engine never shows.
  if (
    environment.backgroundColor !== undefined &&
    environment.backgroundMode !== BG_COLOR
  ) {
    notes.push({
      at: environment.resPath,
      message:
        `background_color = ${environment.backgroundColor} is authored and NOT carried, because ` +
        `Godot does not read it either: it is effective only at background_mode = 1 (BG_COLOR) and ` +
        `this Environment declares ${environment.backgroundMode ?? 0}. Emitting it as a clear ` +
        "colour would put a colour on screen that the source engine never shows.",
    });
  }

  if (
    worldEnvironment?.kind === "godot-panorama" ||
    worldEnvironment?.kind === "godot-cubemap"
  ) {
    notes.push({
      at: environment.resPath,
      message:
        `Godot 4.7 resolves this Sky to independent IBL channels: diffuse ${iblDiffuse}, ` +
        `specular ${iblSpecular}. The emitted environment installs the one native Three texture, ` +
        "then the copied binding scales `getIBLIrradiance` and `getIBLRadiance` separately. " +
        "Authority: pinned `render_scene_data_rd.cpp`, whose ambient and reflection flags are " +
        "computed in separate branches.",
    });
  }

  accountEnvironmentKeys(
    environment,
    [
      "background_mode",
      "background_color",
      "background_energy_multiplier",
      "sky",
      "sky_custom_fov",
      "sky_rotation",
      "ambient_light_source",
      "ambient_light_color",
      "ambient_light_energy",
      "ambient_light_sky_contribution",
      "reflected_light_source",
      "reflection_source",
      "tonemap_mode",
      "tonemap_exposure",
      "tonemap_white",
      ...(postEffect?.kind === "godot-agx"
        ? ["tonemap_agx_white", "tonemap_agx_contrast"]
        : []),
      "adjustment_enabled",
      "adjustment_brightness",
      "adjustment_contrast",
      "adjustment_saturation",
      ...(postEffect?.glow === undefined ? [] : GLOW_KEYS),
      ...GODOT4_FOG_KEYS,
      ...GODOT4_SSAO_KEYS,
      ...GODOT4_SSR_KEYS,
      ...(environment.volumetricFogEnabled === false
        ? ["volumetric_fog_enabled"]
        : []),
    ],
    notes,
  );

  return {
    // Godot 4 renders linear-lit and writes sRGB, which is three's own pipeline — so unlike the
    // Godot 3 GLES2 case there is nothing to correct here. `toneMapping: 'none'` is still stated
    // rather than inherited, because when the Filmic pass above exists it owns the whole curve and
    // must not stack on the host's ACES, and when it does not the host's ACES would be a curve
    // Godot never applied. Godot 4's positional shadow filter is carried separately below because
    // Three must use PCFShadowMap (not the host's PCFSoft default) for per-light radius to work.
    config: {
      toneMapping: "none",
      outputColorSpace: "srgb",
      // Godot 4's positional shadow qualities use a finite PCF kernel whose radius is scaled per
      // light. Three's PCFShadowMap is the native mode that actually consumes LightShadow.radius;
      // PCFSoftShadowMap explicitly ignores it.
      shadowMapType: (input.rendering.positionalShadowFilterQuality ?? 2) === 0 ? "basic" : "pcf",
    },
    ...(ambient === undefined ? {} : { ambient }),
    ...(hemisphere === undefined ? {} : { hemisphere }),
    ...(postEffect === undefined ? {} : { postEffect }),
    ...(worldEnvironment === undefined ? {} : { worldEnvironment }),
    notes,
    assets:
      worldEnvironment?.kind === "godot-panorama" ||
      worldEnvironment?.kind === "godot-cubemap"
        ? [worldEnvironment.resPath]
        : [],
  };
}

// ---------------------------------------------------------------------------------------------
// The no-silent-drop guard.
// ---------------------------------------------------------------------------------------------

/**
 * Every `Environment` key this lane has CLASSIFIED but does not carry, and the reason.
 *
 * A key here is a NAMED DEVIATION: it reaches the emitted `TRANSLATION-NOTES.md` at the resource's
 * own path, so a reader of the port can see exactly what the source engine did that this one does
 * not. A key that is NOT here and not carried is a `TranslateError` — see
 * {@link accountEnvironmentKeys}, and this module's header for the defect that bought it.
 *
 * The names span both dialects (Godot 3.6's `Environment` has 85 properties, Godot 4.7's 93, and
 * they overlap only partly); each is spelled as the `.tres` spells it. `glow_levels/N` is a family
 * and is matched by prefix.
 */
const ENVIRONMENT_KEY_NOTES: Readonly<Record<string, string>> = {
  // --- Screen-space effects. Every one of these is a DEFERRED PASS over the depth/normal buffers,
  // and three has no deferred path at all: `EffectComposer` can host a post pass, but a
  // post-processing STACK for a translated game is a recorded engine decision this lane does not
  // make on its own. Each is cosmetic — it darkens, blooms or occludes an image that is otherwise
  // correct — so each is a named deviation rather than a halt.
  ssil_enabled:
    "screen-space indirect lighting bounces light from the colour buffer",
  ssil_radius: "an SSIL parameter",
  ssil_intensity: "an SSIL parameter",
  ssil_sharpness: "an SSIL parameter",
  ssil_normal_rejection: "an SSIL parameter",
  ssr_enabled: "screen-space reflections trace the depth buffer",
  ssr_max_steps: "an SSR parameter",
  ssr_fade_in: "an SSR parameter",
  ssr_fade_out: "an SSR parameter",
  ssr_depth_tolerance: "an SSR parameter",
  ss_reflections_enabled: "screen-space reflections (Godot 3)",
  ss_reflections_max_steps: "an SSR parameter (Godot 3)",
  ss_reflections_fade_in: "an SSR parameter (Godot 3)",
  ss_reflections_fade_out: "an SSR parameter (Godot 3)",
  ss_reflections_depth_tolerance: "an SSR parameter (Godot 3)",
  ss_reflections_roughness: "an SSR parameter (Godot 3)",

  // --- Glow/bloom. Same reason as above plus one of its own: Godot's glow is a MIP PYRAMID over
  // the HDR buffer with per-level weights, and the emitted world renders to an LDR target.
  glow_enabled: "bloom gathered from a mip pyramid over the HDR buffer",
  glow_normalized: "a glow parameter",
  glow_intensity: "a glow parameter",
  glow_strength: "a glow parameter",
  glow_mix: "a glow parameter",
  glow_bloom: "a glow parameter",
  glow_blend_mode: "a glow parameter",
  glow_hdr_threshold: "a glow parameter",
  glow_hdr_scale: "a glow parameter",
  glow_hdr_luminance_cap: "a glow parameter",
  glow_map_strength: "a glow parameter",
  glow_map: "a glow parameter",
  glow_bicubic_upscale: "a glow parameter (Godot 3)",
  glow_high_quality: "a glow parameter (Godot 3)",

  // --- Global illumination. A voxel/probe GI cascade has no three counterpart of any kind.
  sdfgi_enabled: "signed-distance-field global illumination",
  sdfgi_use_occlusion: "an SDFGI parameter",
  sdfgi_read_sky_light: "an SDFGI parameter",
  sdfgi_bounce_feedback: "an SDFGI parameter",
  sdfgi_cascades: "an SDFGI parameter",
  sdfgi_min_cell_size: "an SDFGI parameter",
  sdfgi_cascade0_distance: "an SDFGI parameter",
  sdfgi_max_distance: "an SDFGI parameter",
  sdfgi_y_scale: "an SDFGI parameter",
  sdfgi_energy: "an SDFGI parameter",
  sdfgi_normal_bias: "an SDFGI parameter",
  sdfgi_probe_bias: "an SDFGI parameter",

  // --- Fog. three has `Scene.fog`, but Godot's is a per-fragment depth/height/sun-scatter model
  // driven from the light list, and mapping it onto `FogExp2` would be a different function with
  // the same name. `kaykit-hexagons` is the first fixture that authors one (`fog_enabled = true`,
  // `fog_depth_end = 60`); it stays a named deviation until a measured Godot-3.6 run says what
  // three's exponential curve would have to be to match Godot's linear depth ramp.
  fog_enabled: "Godot's own depth/height fog model",
  fog_mode: "a fog parameter",
  fog_light_color: "a fog parameter",
  fog_light_energy: "a fog parameter",
  fog_sun_scatter: "a fog parameter",
  fog_density: "a fog parameter",
  fog_aerial_perspective: "a fog parameter",
  fog_sky_affect: "a fog parameter",
  fog_height: "a fog parameter",
  fog_height_density: "a fog parameter",
  fog_depth_curve: "a fog parameter",
  fog_depth_begin: "a fog parameter",
  fog_depth_end: "a fog parameter",
  fog_color: "a fog parameter (Godot 3)",
  fog_depth_enabled: "a fog parameter (Godot 3)",
  fog_height_enabled: "a fog parameter (Godot 3)",
  fog_height_curve: "a fog parameter (Godot 3)",
  fog_height_max: "a fog parameter (Godot 3)",
  fog_height_min: "a fog parameter (Godot 3)",
  fog_sun_amount: "a fog parameter (Godot 3)",
  fog_sun_color: "a fog parameter (Godot 3)",
  fog_transmit_enabled: "a fog parameter (Godot 3)",
  fog_transmit_curve: "a fog parameter (Godot 3)",
  volumetric_fog_enabled: "a raymarched froxel volume",
  volumetric_fog_density: "a volumetric fog parameter",
  volumetric_fog_albedo: "a volumetric fog parameter",
  volumetric_fog_emission: "a volumetric fog parameter",
  volumetric_fog_emission_energy: "a volumetric fog parameter",
  volumetric_fog_anisotropy: "a volumetric fog parameter",
  volumetric_fog_length: "a volumetric fog parameter",
  volumetric_fog_detail_spread: "a volumetric fog parameter",
  volumetric_fog_gi_inject: "a volumetric fog parameter",
  volumetric_fog_ambient_inject: "a volumetric fog parameter",
  volumetric_fog_sky_affect: "a volumetric fog parameter",
  volumetric_fog_temporal_reprojection_enabled: "a volumetric fog parameter",
  volumetric_fog_temporal_reprojection_amount: "a volumetric fog parameter",

  // --- Auto exposure. A histogram over the previous frame feeding this one's exposure; the
  // emitted Filmic pass carries the AUTHORED exposure and nothing adapts it.
  auto_exposure_enabled:
    "exposure adapted from a histogram of the previous frame",
  auto_exposure_scale: "an auto-exposure parameter",
  auto_exposure_speed: "an auto-exposure parameter",
  auto_exposure_min_luma: "an auto-exposure parameter (Godot 3)",
  auto_exposure_max_luma: "an auto-exposure parameter (Godot 3)",
  auto_exposure_min_sensitivity: "an auto-exposure parameter",
  auto_exposure_max_sensitivity: "an auto-exposure parameter",

  // --- Depth of field (Godot 3's Environment owns it; Godot 4 moved it onto Camera attributes).
  dof_blur_far_enabled: "a depth-of-field pass (Godot 3)",
  dof_blur_far_distance: "a depth-of-field parameter (Godot 3)",
  dof_blur_far_transition: "a depth-of-field parameter (Godot 3)",
  dof_blur_far_amount: "a depth-of-field parameter (Godot 3)",
  dof_blur_far_quality: "a depth-of-field parameter (Godot 3)",
  dof_blur_near_enabled: "a depth-of-field pass (Godot 3)",
  dof_blur_near_distance: "a depth-of-field parameter (Godot 3)",
  dof_blur_near_transition: "a depth-of-field parameter (Godot 3)",
  dof_blur_near_amount: "a depth-of-field parameter (Godot 3)",
  dof_blur_near_quality: "a depth-of-field parameter (Godot 3)",

  // --- Colour-correction LUT. The BCS stage IS carried (see `translateGodot4Tonemap`); the LUT is
  // an authored 1D/3D texture and sampling it is a different pass with a different input.
  adjustment_color_correction: "a colour-correction LUT texture",

  // --- Backgrounds this lane has no surface for.
  background_canvas_max_layer:
    "a `BG_CANVAS` background, which draws the 2D canvas behind the 3D",
  background_camera_feed_id:
    "a `BG_CAMERA_FEED` background, which draws a device camera",
  background_intensity: "a physical-light-units background intensity, in nits",
  sky_custom_fov: "a custom sky field of view",
  sky_rotation:
    "a sky orientation, which this lane leaves as the azimuth deviation it already names",
  background_sky_custom_fov: "a custom sky field of view (Godot 3)",
  background_sky_orientation: "a sky orientation (Godot 3)",
  background_sky_rotation: "a sky orientation (Godot 3)",
  background_sky_rotation_degrees: "a sky orientation (Godot 3)",

  // --- AgX's own knobs. Named only when another tonemapper is active; the AgX branch carries them.
  tonemap_agx_white: "an AgX tonemapper parameter",
  tonemap_agx_contrast: "an AgX tonemapper parameter",
};

/** `glow_levels/1` .. `glow_levels/7` — one weight per mip, matched as a family. */
const GLOW_LEVEL_PREFIX = "glow_levels/";

/**
 * Walk every key the Environment resource authors; carry, name, or REFUSE.
 *
 * @param carried the keys the calling branch read and turned into emitted output. Those already
 *   have a note of their own, written by the code that carried them and saying what it did.
 *
 * The third case is the point of this function. Before it, an unrecognised Environment key was read
 * by nothing, mentioned by nothing and rendered by nothing — which is how this game's entire
 * lighting went missing with every gate green. A key that reaches this lane for the first time now
 * stops the port and names itself, and closing it is a table entry plus (if it is carriable) a
 * branch.
 */
function accountEnvironmentKeys(
  environment: AuthoredWorldEnvironment,
  carried: readonly string[],
  notes: TranslationNote[],
): void {
  const handled = new Set(carried);
  const deviations: string[] = [];
  const unclassified: string[] = [];
  for (const key of environment.authoredKeys) {
    if (handled.has(key)) continue;
    if (key.startsWith(GLOW_LEVEL_PREFIX)) {
      // The whole family rides the emitted glow pass, so it is carried exactly when the pass is.
      if (handled.has("glow_enabled")) continue;
      deviations.push(`${key} (a glow mip weight)`);
      continue;
    }
    const why = ENVIRONMENT_KEY_NOTES[key];
    if (why === undefined) {
      unclassified.push(key);
      continue;
    }
    deviations.push(`${key} (${why})`);
  }
  if (unclassified.length > 0) {
    throw new TranslateError(
      environment.resPath,
      `this \`Environment\` authors ${unclassified.length} key(s) this lane has never classified: ` +
        `${unclassified.join(", ")}. An Environment key carries, or it is named in ` +
        "`translate/rendering.ts`'s ENVIRONMENT_KEY_NOTES as a deviation with its mechanism — " +
        "never neither. This resource holds the whole look of the game, and a key that reaches no " +
        "emitted line and no note is exactly how a port renders wrong with every gate green.",
    );
  }
  if (deviations.length === 0) return;
  notes.push({
    at: environment.resPath,
    message:
      `${deviations.length} authored Environment key(s) are NOT carried, each because three has no ` +
      `equivalent stage: ${deviations.join("; ")}. Every one of them is cosmetic — it grades, ` +
      "blooms, occludes or fogs a frame whose geometry and lighting are already what this " +
      "translation emits — so they are named deviations rather than a halt.",
  });
}

/** `[rendering]` → the emitted world's renderer config, plus every ceiling it could not carry. */
export function translateRendering(
  input: RenderingTranslationInput,
): RenderingTranslation {
  const notes: TranslationNote[] = [];
  const at = "project.godot";
  const driver = input.rendering.driverName;

  // MSAA is not a renderer PROPERTY, it is a context ATTRIBUTE: a WebGL context fixes its sample
  // count when it is created, from a boolean, and the host builds its renderer before any world
  // mounts. So it cannot ride the world's own renderer declaration — it rides the emitted
  // `vgai.project.json`, whose reader is `runtime/mount-manifest.ts` (see `manifestRendering`).
  const msaa = input.rendering.msaa;
  const manifestRendering =
    msaa === undefined || msaa === 0
      ? undefined
      : ({ antialias: true } as const);
  if (msaa !== undefined && msaa !== 0) {
    notes.push({
      at,
      message:
        `[rendering] quality/filters/msaa = ${msaa} (${MSAA_INDEX_TO_SAMPLES[msaa] ?? "unknown"}) ` +
        "becomes `rendering.antialias: true` in the emitted `vgai.project.json`, which the host " +
        "reads when it CONSTRUCTS each three root's WebGL context. WebGL exposes no sample " +
        "COUNT — the boolean asks for multisampling and the implementation picks the level (4x on " +
        "every desktop browser measured), so the sample count itself is a named deviation " +
        "wherever this project asked for 8x or 16x.",
    });
  }

  // Godot 4 FIRST, and before the shadow-filter read: `quality/shadows/filter_mode` is a Godot 3
  // project setting, and applying its Godot 3.6 DEFAULT to a Godot 4 project would be this
  // module's own anti-shim rule broken — an authoritative-looking value for a knob the project
  // never had. Godot 4 renames it (`rendering/lights_and_shadows/directional_shadow/
  // soft_shadow_filter_quality`) with different semantics, and this lane has not measured it, so a
  // Godot 4 world carries no shadow filter and the host's own stands.
  const environment = input.worldEnvironment;
  if (input.engine.major === 4) {
    classifyGodot4CameraExposure(input);
    if (environment !== undefined) {
      return {
        ...translateGodot4Environment(environment, notes, input),
        ...(manifestRendering === undefined ? {} : { manifestRendering }),
      };
    }
    const autoExposure = translateGodot4AutoExposure(input, notes);
    const depthOfField = translateGodot4DepthOfField(input, notes);
    notes.push({
      at,
      message:
        `this Godot ${input.engine.major} project ` +
        (input.hasWorldEnvironment
          ? "authors a `WorldEnvironment` whose `environment` does not resolve to one text " +
            "`Environment` resource, so its background, ambient light and tonemapper are not " +
            "carried"
          : "authors no `WorldEnvironment`, so it has no background, ambient light or tonemapper " +
            "to carry") +
        ". The world renders with the host's defaults (linear lighting, ACES tonemapping, sRGB " +
        "output), which is also what Godot 4 does with no Environment except for the tone curve.",
    });
    return {
      ...(depthOfField === undefined && autoExposure === undefined
        ? {}
        : {
            config: { toneMapping: "none" as const, outputColorSpace: "srgb" as const },
            postEffect: {
              kind: "godot-output" as const,
              exposure: 1,
              white: 1,
              ...(autoExposure === undefined ? {} : { autoExposure }),
              ...(depthOfField === undefined ? {} : { depthOfField }),
            },
          }),
      notes,
      assets: [],
      ...(manifestRendering === undefined ? {} : { manifestRendering }),
    };
  }

  const shadowMapType = translateShadowFilterMode(input, notes);
  const finish = (translation: RenderingTranslation): RenderingTranslation => ({
    ...translation,
    ...(manifestRendering === undefined ? {} : { manifestRendering }),
    ...(translation.config === undefined || shadowMapType === undefined
      ? {}
      : { config: { ...translation.config, shadowMapType } }),
  });

  if (input.engine.major === 3 && driver === "GLES2")
    return finish(translateGodot3Gles2(input, notes));

  // An undeclared Godot 3 driver means its own default, GLES3. This game's Environment authors
  // mode 2 (Filmic), whose exact curve is in Godot 3.6's GLES3 `tonemap.glsl`: Hable constants
  // with a baked exposure bias of 2, normalized by the authored white point. Three's `cineon`
  // operator is a DIFFERENT Hejl/Burgess-Dawson curve, so the emitted world owns a fullscreen
  // post-process using Godot's formula rather than mapping two similarly named modes.
  const effectiveDriver =
    input.engine.major === 3 && driver === undefined ? "GLES3" : driver;
  if (
    input.engine.major === 3 &&
    effectiveDriver === "GLES3" &&
    environment !== undefined
  )
    return finish(
      translateGodot3Gles3Environment(
        environment,
        notes,
        input,
      ),
    );

  notes.push({
    at,
    message:
      `[rendering] quality/driver/driver_name = ${driver === undefined ? "(not declared — Godot 3 defaults to GLES3)" : driver}` +
      `${input.engine.major === 3 ? "" : ` on a Godot ${input.engine.major ?? "?"} project`}: ` +
      "no measured translation matches this driver/operator pair, so no renderer configuration " +
      "is emitted and the world renders with the host's defaults (linear lighting, ACES " +
      "tonemapping, sRGB output). The measured cases are Godot 3 GLES2 and an unambiguous Godot " +
      "3 GLES3 WorldEnvironment using Filmic mode.",
  });
  return finish({ notes, assets: [] });
}
