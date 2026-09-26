/**
 * translate/data/shadow.ts — a Godot 3 `DirectionalLight`'s shadow, as three's own shadow camera.
 *
 * ## Why a translation is needed at all
 *
 * `shadow_enabled = true` on a `.tscn`'s `DirectionalLight` is a one-bit fact, and carrying only
 * that bit produces a game with NO SHADOWS — which is what `squash-the-creeps` did for three rungs.
 * Two engine facts sit under the bit and neither survives a naive carry:
 *
 *  - **three's default directional shadow camera is a ±5 orthographic box** (`DirectionalLightShadow`
 *    constructs `new OrthographicCamera(-5, 5, 5, -5, 0.5, 500)`), which is a 10x10 window over a
 *    game whose authored ground is 60x60. Every caster outside it is simply missing from the map.
 *  - **three shadows nothing that does not opt in.** `Object3D.castShadow` and `receiveShadow` both
 *    default `false`, and a mesh that does neither is invisible to the whole shadow pass. Godot 3
 *    is the other way round: `GeometryInstance.cast_shadow` defaults to `SHADOW_CASTING_SETTING_ON`
 *    (measured on 3.6.stable: `MeshInstance.new().cast_shadow == 1 == SHADOW_CASTING_SETTING_ON`)
 *    and receiving is unconditional — Godot 3 has no per-object receive flag at all. So the honest
 *    translation of an UNANNOTATED Godot mesh is `castShadow receiveShadow`, and the exception is
 *    the mesh that authors `cast_shadow` explicitly.
 *
 * ## Every number here was measured on Godot 3.6.stable, not guessed
 *
 * Read out of a real editor-less run (`ProjectSettings.get_setting` / a freshly constructed node),
 * the same standard `translate/rendering.ts` sets:
 *
 *  - `rendering/quality/directional_shadow/size` → **4096**. That is the whole directional shadow
 *    map, which Godot then splits four ways (`DirectionalLight.directional_shadow_mode` → 3 =
 *    `SHADOW_PARALLEL_4_SPLITS`); the translation uses it as one undivided map, so the emitted
 *    world's texel density is HIGHER far away and lower up close than Godot's.
 *  - `DirectionalLight.directional_shadow_max_distance` → **100**. In Godot this is the distance
 *    from the CAMERA at which directional shadows stop, and the split fit is made against the
 *    camera's own frustum. three has no such fit: its shadow camera is an ordinary orthographic
 *    camera parented to the light. So `maxDistance` is CARRIED rather than converted — it goes into
 *    the light's `userData` and the copied `godot-compat` shadow system re-fits the box to the live
 *    camera every frame, which is why nothing here computes a lateral extent (see "What this file
 *    does NOT decide" below).
 *  - `DirectionalLight.shadow_color` → **`Color(0, 0, 0, 1)`** — a shadowed surface receives no
 *    light from this lamp at all. What keeps a Godot shadow from being black is the AMBIENT term
 *    (`translate/rendering.ts`), which is why that translation and this one had to land together:
 *    measured on `squash-the-creeps`, the native shadow under a character is byte 78 on a ground
 *    that is byte 255 in the light, and byte 78 is exactly what the white ground renders with the
 *    light switched OFF.
 *
 * ## What this file does NOT decide: the box's SIZE
 *
 * The lateral extent of the shadow box is Godot's frustum-slice bounding sphere, whose radius
 * depends on the live camera's fov and aspect — at the platformer's own 70-degree fov it is ~2.9x
 * `maxDistance / 2`, and it moves whenever the game's camera does. So it is fitted at runtime by
 * `godot-compat`'s `directional-shadow-3d.ts` (which carries the measurement), and so is everything
 * derived from it: the texel snap quantum and `shadow.normalBias`. This file emits only what a
 * fitted box does not move — the map size, the DEPTH range, `shadow.bias` normalized against that
 * range, and Godot's own `directional_shadow_normal_bias` as authored (converted at runtime — see
 * `normalBiasTexels` below).
 *
 * ## The ceiling, stated rather than hidden
 *
 * Godot can fit up to four shadow splits to the camera frustum; this emits ONE box, fitted the way
 * Godot's own `SHADOW_ORTHOGONAL` (single-split) mode fits it. A cascade adds texel density close
 * to the camera and nothing else, so a project authoring a multi-split mode loses shadow SHARPNESS
 * near the viewer — a named deviation, recorded per light by `noteLightShadowProperties`.
 */

import { TranslateError } from './model';

/**
 * Godot 3.6's `rendering/quality/directional_shadow/size` default, measured rather than guessed.
 * (Godot also carries a `.mobile` override at 2048; a project declaring one is reading a different
 * setting name, and this translation reads only the one the desktop run resolves.)
 */
export const GODOT3_DIRECTIONAL_SHADOW_SIZE = 4096;

/** Godot 3.6's `DirectionalLight.directional_shadow_max_distance` default, measured. */
export const GODOT3_DIRECTIONAL_SHADOW_MAX_DISTANCE = 100;

/** Godot 3.6's `Light.shadow_bias` default, measured. A depth offset in WORLD units. */
export const GODOT3_SHADOW_BIAS = 0.1;

/** Godot 3.6's `DirectionalLight.directional_shadow_normal_bias` default, measured. A multiplier
 *  on the shadow TEXEL. (That is Godot 3's spelling; the Light-level `shadow_normal_bias` is
 *  Godot 4's and does not exist on 3.6.) */
export const GODOT3_SHADOW_NORMAL_BIAS = 0.8;

/** three's `Object3D.castShadow`/`receiveShadow` for one emitted geometry node. */
export interface ShadowCasting {
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
}

/** What the emitted `<directionalLight>`'s own shadow camera is. */
export interface DirectionalShadowFraming {
  /** `shadow-mapSize`, one edge in texels. */
  readonly mapSize: number;
  /** `directional_shadow_max_distance` itself, carried into the light's `userData` for the runtime
   *  fit. Godot measures it from the CAMERA, so it is a distance rather than a box. */
  readonly maxDistance: number;
  /** `shadow-camera-near`. NEGATIVE on purpose: an orthographic near plane may sit behind the
   *  camera, and a directional light's authored POSITION says nothing about where the geometry it
   *  lights actually is — so the depth range is symmetric about the light rather than starting at
   *  it. */
  readonly near: number;
  readonly far: number;
  /**
   * `shadow-bias`. NEGATIVE, and that is a unit conversion rather than a sign flip: Godot's
   * `shadow_bias` is a depth offset in WORLD units that pushes a shadow AWAY from its caster,
   * three's `shadow.bias` is added to the stored depth in the shadow camera's own normalised
   * `[0, 1]` range, and pushing away in that range is downward. So
   * `bias = -godotBias / (far - near)`.
   */
  readonly bias: number;
  /**
   * `directional_shadow_normal_bias`, carried as AUTHORED into `userData` rather than converted
   * here. The runtime converts it to three's world-unit `shadow.normalBias` as `authored x one
   * fitted shadow texel` — the lane's measured calibration, not Godot's own unit (3.6 applies the
   * value as a slope-scaled caster-depth offset; per-texel semantics are Godot 4's — see the
   * `godot-compat` helper's header). One texel is `2 * fittedRadius / mapSize`, which only exists
   * once the runtime has fitted the box to the live camera; a constant computed from
   * `maxDistance / mapSize` is ~3x too small.
   *
   * This is the term that actually matters, and it was measured rather than reasoned: without it
   * the first frame with shadows enabled had visible self-shadow acne all over the curved
   * character bodies — a mottling that dropped the masked orange body's mean by ~40 bytes and read
   * as a colour regression rather than as a shadow artefact.
   */
  readonly normalBiasTexels: number;
}

export interface DirectionalShadowInput {
  /** `project.godot`'s `quality/directional_shadow/size`, when it declares one. */
  readonly declaredMapSize?: number | undefined;
  /** The light's own `directional_shadow_max_distance`, when the `.tscn` authors one. */
  readonly authoredMaxDistance?: number | undefined;
  /** The light's own `shadow_bias`, when the `.tscn` authors one. */
  readonly authoredBias?: number | undefined;
  /** The light's own `directional_shadow_normal_bias`, when the `.tscn` authors one. */
  readonly authoredNormalBias?: number | undefined;
  /** Where the refusal points when a declared value is not usable. */
  readonly at: string;
}

/** A Godot 3 directional shadow → three's orthographic shadow camera. */
export function frameDirectionalShadow(input: DirectionalShadowInput): DirectionalShadowFraming {
  const mapSize = input.declaredMapSize ?? GODOT3_DIRECTIONAL_SHADOW_SIZE;
  if (!Number.isInteger(mapSize) || mapSize <= 0) {
    throw new TranslateError(
      input.at,
      `\`rendering/quality/directional_shadow/size = ${mapSize}\` is not a positive whole number ` +
        'of texels. three allocates a render target of exactly this edge, so a fractional or ' +
        'negative one has no meaning — it refuses rather than silently falling back to a default ' +
        'the project did not declare.',
    );
  }
  const maxDistance = input.authoredMaxDistance ?? GODOT3_DIRECTIONAL_SHADOW_MAX_DISTANCE;
  if (!(maxDistance > 0)) {
    throw new TranslateError(
      input.at,
      `\`directional_shadow_max_distance = ${maxDistance}\`. Godot treats this as a distance, so a ` +
        'zero or negative one would frame an empty shadow camera and produce a game with no ' +
        'shadows that still claims to cast them.',
    );
  }
  // Symmetric about the light — see `near`'s doc comment.
  const near = -maxDistance;
  const far = maxDistance;
  const godotBias = input.authoredBias ?? GODOT3_SHADOW_BIAS;
  return {
    mapSize,
    maxDistance,
    near,
    far,
    bias: -godotBias / (far - near),
    normalBiasTexels: input.authoredNormalBias ?? GODOT3_SHADOW_NORMAL_BIAS,
  };
}

/**
 * Godot 3's `GeometryInstance.cast_shadow` enum, as three's two booleans.
 *
 * The enum is `OFF = 0`, `ON = 1`, `DOUBLE_SIDED = 2`, `SHADOWS_ONLY = 3`. `receiveShadow` is not
 * in it because Godot 3 has no per-object receive flag: every surface receives, so every emitted
 * mesh does.
 */
export function shadowCastingOf(mode: number | undefined, at: string): ShadowCasting {
  // Godot's own default for an unannotated GeometryInstance, measured on 3.6.stable.
  if (mode === undefined || mode === 1) return { castShadow: true, receiveShadow: true };
  if (mode === 0) return { castShadow: false, receiveShadow: true };
  if (mode === 2) {
    throw new TranslateError(
      at,
      '`cast_shadow = 2` (SHADOW_CASTING_SETTING_DOUBLE_SIDED) asks Godot to render BOTH faces ' +
        "into the shadow map. three's equivalent is `Material.shadowSide`, which is a property of " +
        'the MATERIAL rather than of the object, so it cannot be carried from a node that shares ' +
        'its material with another. It refuses rather than emitting a single-sided shadow that ' +
        'would look right from one side of the caster and wrong from the other.',
    );
  }
  if (mode === 3) {
    throw new TranslateError(
      at,
      '`cast_shadow = 3` (SHADOW_CASTING_SETTING_SHADOWS_ONLY) draws the object into the shadow ' +
        'map while hiding it from the camera. three has no counterpart — `castShadow` with ' +
        '`visible = false` removes it from the shadow pass too — so it refuses rather than ' +
        'emitting a visible object where the game authored an invisible one.',
    );
  }
  throw new TranslateError(
    at,
    `\`cast_shadow = ${mode}\` is not one of Godot 3's four GeometryInstance shadow modes ` +
      '(OFF 0, ON 1, DOUBLE_SIDED 2, SHADOWS_ONLY 3).',
  );
}

/** Three PointLight uses a cube map; Godot dual-paraboloid would silently change the projection. */
export function refuseOmniDualParaboloidShadow(at: string, shadowMode: number): void {
  if (shadowMode === 1) return;
  throw new TranslateError(
    at,
    `\`omni_shadow_mode = ${shadowMode}\` selects Godot's dual-paraboloid shadow. ` +
      'Three PointLight uses a cube shadow map; emitting one would silently change the authored shadow projection.',
  );
}
