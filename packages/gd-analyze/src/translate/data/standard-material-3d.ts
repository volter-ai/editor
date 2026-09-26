/**
 * translate/data/standard-material-3d.ts — a Godot 4 `StandardMaterial3D` in Godot 3 `SpatialMaterial`
 * SPELLING, so that one material policy reads both dialects.
 *
 * The pinned Godot 4 oracle for every claim here is
 * **`vendor/extension-api/godot-4.7-extension_api.json` (`Godot Engine v4.7.stable.official`)**;
 * the Godot 3 side is `godot-3.6-stable`'s own `doc/classes/Material3D.xml`, which is what the
 * 3.6 class reference is generated from (the 3.6.2 dump carries no properties or constants for
 * this class, so the doc XML is the machine-readable Godot 3 source and it is quoted, never
 * recalled).
 *
 * ## What this module is, and what it deliberately is NOT
 *
 * It is a SPELLING map and nothing else. It renames, and where Godot 4 reshaped a property it
 * un-reshapes it into the Godot 3 shape — and then it stops. It decides no `side`, no `blending`,
 * no lit/unlit class, no note: `translate/data/spatial-material.ts` is THE material policy
 * (carry the expressible subset, record the rest — owner decision) and it stays the only
 * one. A second policy keyed by Godot 4 spellings is the fork `dialect.ts`'s header refuses.
 *
 * That split is why an unmapped key PASSES THROUGH under its own name rather than refusing. The
 * recorded policy for a material property with no three counterpart is a NOTE, not a refusal, and
 * `spatial-material.ts`'s catch-all writes one naming the key. Passing the Godot 4 spelling
 * through is also what makes that note name the property the FILE actually wrote — the same rule
 * `particles-dialect.ts`'s `authoredNames` exists for, one level along. What may NOT pass through
 * is a VALUE this map cannot express inside a slot it DOES map: `transparency = 2` folded onto
 * `flags_transparent = true` would draw an alpha-scissor cutout as plain alpha blending, which is
 * the plausible-and-wrong emission the lane refuses.
 *
 * ## The rename rows, and why exactly these
 *
 * TWO read sets reach this map, and both are named here because a row exists for a key exactly
 * when one of them consumes it. `translate/data/spatial-material.ts` is the MESH material policy;
 * `translate/data/particles-dialect.ts`'s `PARTICLE_MATERIAL` is the PARTICLE one, and the two rows at
 * the bottom of the table below (`billboard_mode`, `billboard_keep_scale`) are the particle read's
 * alone — `cpu-particles-3d.ts`'s `refuseUncarriedBillboard` is what consumes them, and nothing in
 * the mesh read does.
 *
 * `spatial-material.ts` reads 21 named properties plus every `*_texture` slot. Intersecting that
 * read set with the 4.7 dump's 131 `BaseMaterial3D` properties leaves FIFTEEN names spelled
 * identically in both engines — `albedo_color`, `metallic`, `metallic_specular`,
 * `metallic_texture_channel`, `roughness`, `roughness_texture_channel`, `emission_enabled`,
 * `emission`, `emission_operator`, `emission_on_uv2`, `vertex_color_use_as_albedo`,
 * `vertex_color_is_srgb`, `rim_enabled`, `rim`, `rim_tint` — each present in `Material3D.xml`
 * with the same setter/getter pair, so each carries with no row at all. Every remaining read
 * property is spelled differently in Godot 4, and those are the rows below.
 * The pinned-dump census records that intersection, so a
 * sixteenth shared name (or a dump that moves) cannot arrive unnoticed.
 *
 * | Godot 3 `Material3D` (3.6-stable `doc/classes/Material3D.xml`) | Godot 4 `BaseMaterial3D` (4.7 dump) | |
 * | --- | --- | --- |
 * | `params_blend_mode` (`enum="Material3D.BlendMode"`) | `blend_mode` | RENAME; `BLEND_MODE_MIX/ADD/SUB/MUL` are 0/1/2/3 in both |
 * | `params_cull_mode` (`enum="Material3D.CullMode"`) | `cull_mode` | RENAME; `CULL_BACK/FRONT/DISABLED` are 0/1/2 in both |
 * | `params_diffuse_mode` (`enum="Material3D.DiffuseMode"`) | `diffuse_mode` | RENAME **and the values MOVED** — see {@link DIFFUSE_MODE_GODOT4_TO_GODOT3} |
 * | `params_specular_mode` (`enum="Material3D.SpecularMode"`) | `specular_mode` | RENAME **and the values MOVED further** — see {@link SPECULAR_MODE_GODOT4_TO_GODOT3} |
 * | `flags_unshaded` (`type="bool"`) | `shading_mode` (`ShadingMode`) | RESHAPE — a bool became a three-valued enum |
 * | `flags_transparent` (`type="bool"`) | `transparency` (`Transparency`) | RESHAPE — a bool became a five-valued enum |
 * | `emission_energy` (`setter="set_emission_energy"`) | `emission_energy_multiplier` | RENAME |
 * | `params_billboard_mode` (`enum="Material3D.BillboardMode"`) | `billboard_mode` | RENAME; `BILLBOARD_DISABLED/ENABLED/FIXED_Y/PARTICLES` are 0/1/2/3 in both |
 * | `params_billboard_keep_scale` (`type="bool"`) | `billboard_keep_scale` | RENAME |
 * | `params_depth_draw_mode` (`enum="Material3D.DepthDrawMode"`) | `depth_draw_mode` | RENAME; the THREE members Godot 4 kept are 0/1/2 in both — see below |
 * | `flags_do_not_receive_shadows` (`type="bool"`) | `disable_receive_shadows` | RENAME, straight off the remap table below |
 *
 * Most of these rows are not guesswork about what Godot 4 called a Godot 3 name: Godot 4 ships
 * the mapping itself, as the compatibility remap `BaseMaterial3D::_set` walks when it loads a
 * Godot 3 material. Quoted from `scene/resources/material.cpp:3603-3634` (`4.4-stable`), which is
 * also where `params_blend_mode`/`params_cull_mode`/`params_diffuse_mode` above come from:
 *
 * ```cpp
 * static const Pair<const char *, const char *> remaps[] = {
 *         …
 *         { "flags_do_not_receive_shadows", "disable_receive_shadows" },
 *         …
 *         { "params_diffuse_mode", "diffuse_mode" },
 *         { "params_specular_mode", "specular_mode" },
 *         { "params_blend_mode", "blend_mode" },
 *         { "params_cull_mode", "cull_mode" },
 *         …
 *         { "params_billboard_mode", "billboard_mode" },
 *         { "params_billboard_keep_scale", "billboard_keep_scale" },
 *         { "params_grow", "grow" },
 *         { "params_grow_amount", "grow_amount" },
 *         …
 *         { "emission_energy", "emission_energy_multiplier" },
 * ```
 *
 * The two billboard rows are pure renames and nothing more — the enum NUMBERS agree
 * (`3.6-stable doc/classes/Material3D.xml`: `BILLBOARD_DISABLED` 0, `BILLBOARD_ENABLED` 1,
 * `BILLBOARD_FIXED_Y` 2, `BILLBOARD_PARTICLES` 3; the 4.7 dump's `BaseMaterial3D.BillboardMode`
 * declares the same four names at the same four values). What the two engines do NOT agree on is
 * what `BILLBOARD_PARTICLES` DOES with the mesh's scale, and that divergence is a fact about the
 * PARTICLE read rather than about the spelling — see `particles-dialect.ts`, which owns it.
 *
 * ## `depth_draw_mode`: the row Godot 4's own remap table does NOT carry, and why it is still a rename
 *
 * `params_depth_draw_mode` appears in the block above, mapped to ITSELF — a dead entry, because the
 * branch that runs first intercepts the name and throws the value away unless it is 3:
 *
 * ```cpp
 * } else if (p_name == "params_depth_draw_mode") {
 *         int mode = p_value;
 *         if (mode == 3) {
 *                 set_transparency(TRANSPARENCY_ALPHA_DEPTH_PRE_PASS);
 *         }
 *         return true;
 * ```
 * (`scene/resources/material.cpp:3589-3594`, `4.4-stable`.)
 *
 * That is Godot 4 REFUSING to import a Godot 3 depth-draw mode of 0/1/2, and it is a fact about
 * their DIRECTION, not about the enum: Godot 4 kept `depth_draw_mode` as a real property and the
 * three members it kept are numbered identically in both engines, with Godot 3's fourth having no
 * Godot 4 spelling at all.
 *
 * ```
 * 3.6-stable doc/classes/Material3D.xml
 *   <constant name="DEPTH_DRAW_OPAQUE_ONLY" value="0" enum="DepthDrawMode">   Depth is drawn only for opaque objects.
 *   <constant name="DEPTH_DRAW_ALWAYS" value="1" enum="DepthDrawMode">        Both opaque and transparent.
 *   <constant name="DEPTH_DRAW_DISABLED" value="2" enum="DepthDrawMode">      No depth draw.
 *   <constant name="DEPTH_DRAW_ALPHA_OPAQUE_PREPASS" value="3" enum="DepthDrawMode">
 *
 * 4.7 extension_api.json, BaseMaterial3D.DepthDrawMode
 *   DEPTH_DRAW_OPAQUE_ONLY=0, DEPTH_DRAW_ALWAYS=1, DEPTH_DRAW_DISABLED=2
 * ```
 *
 * So the direction THIS module travels — a Godot 4 value into the Godot 3 slot — is a pure rename
 * for every value a Godot 4 document can carry, and nothing produces Godot 3's `3` (Godot 4 spells
 * the opaque pre-pass as `transparency = TRANSPARENCY_ALPHA_DEPTH_PRE_PASS`, which the
 * `transparency` row below already refuses).
 *
 * ## `diffuse_mode`: the row that is a rename AND a value remap
 *
 * Godot 4 REMOVED Oren Nayar, and every mode after it shifted down one. Quoted from each engine's
 * own machine-readable source:
 *
 * ```
 * 3.6-stable doc/classes/Material3D.xml
 *   <constant name="DIFFUSE_BURLEY" value="0" enum="DiffuseMode">
 *   <constant name="DIFFUSE_LAMBERT" value="1" enum="DiffuseMode">
 *   <constant name="DIFFUSE_LAMBERT_WRAP" value="2" enum="DiffuseMode">
 *   <constant name="DIFFUSE_OREN_NAYAR" value="3" enum="DiffuseMode">
 *   <constant name="DIFFUSE_TOON" value="4" enum="DiffuseMode">
 *
 * 4.7 extension_api.json, BaseMaterial3D.DiffuseMode
 *   DIFFUSE_BURLEY=0, DIFFUSE_LAMBERT=1, DIFFUSE_LAMBERT_WRAP=2, DIFFUSE_TOON=3
 * ```
 *
 * So a Godot 4 `diffuse_mode = 3` is TOON and the Godot 3 spelling of Toon is `4`. Carrying the
 * number across unchanged would have made `spatial-material.ts`'s own note call a Toon surface
 * "Oren Nayar" — a message lying about the source, which is the failure `dialect.ts` names. The
 * mapping is total in one direction only: Godot 4 has no spelling for Oren Nayar, so nothing
 * produces Godot 3's `3`.
 *
 * ## `specular_mode`: the same shape, shifted TWICE
 *
 * Godot 4 removed BOTH of Godot 3's compatibility lobes, so every mode after Schlick-GGX shifted
 * down two. Quoted from each engine's own machine-readable source:
 *
 * ```
 * 3.6-stable doc/classes/Material3D.xml
 *   <constant name="SPECULAR_SCHLICK_GGX" value="0" enum="SpecularMode">  Default specular blob.
 *   <constant name="SPECULAR_BLINN" value="1" enum="SpecularMode">        Older specular algorithm, included for compatibility.
 *   <constant name="SPECULAR_PHONG" value="2" enum="SpecularMode">        Older specular algorithm, included for compatibility.
 *   <constant name="SPECULAR_TOON" value="3" enum="SpecularMode">         Toon blob which changes size based on roughness.
 *   <constant name="SPECULAR_DISABLED" value="4" enum="SpecularMode">     No specular blob.
 *
 * 4.7 extension_api.json, BaseMaterial3D.SpecularMode
 *   SPECULAR_SCHLICK_GGX=0, SPECULAR_TOON=1, SPECULAR_DISABLED=2
 * ```
 *
 * So a Godot 4 `specular_mode = 2` is DISABLED — no specular blob at all — and Godot 3's `2` is
 * PHONG, a lobe that very much renders. This is the `diffuse_mode` failure one property along and
 * a step worse: the two engines' numbers COLLIDE on the two values a `.tscn` can actually carry
 * (Godot 4 serialises only a non-default, so `1` and `2` are the whole authorable range), and each
 * one names a different lobe in the other engine. `starter-kit-3d-platformer`'s
 * `objects/player.tscn#ParticlesTrail` authors exactly `specular_mode = 2`. As with diffuse, the
 * mapping is total in one direction only: Godot 4 has no spelling for Blinn or Phong, so nothing
 * produces Godot 3's `1` or `2`.
 *
 * ## `shading_mode`: three values onto one bool, plus the one Godot 3 property it needs beside it
 *
 * `SHADING_MODE_UNSHADED = 0`, `SHADING_MODE_PER_PIXEL = 1`, `SHADING_MODE_PER_VERTEX = 2`
 * (4.7 dump; the class reference gives the property's default as `shading_mode = 1`). Godot 3 spells
 * the first as `flags_unshaded` and the third as a SECOND property, `flags_vertex_lighting`
 * (`<member name="flags_vertex_lighting" type="bool" setter="set_flag" getter="get_flag"
 * default="false">`, whose description is "If `true`, lighting is calculated per vertex rather
 * than per pixel"). So mode 2 becomes both bools, and the vertex-lighting one is a property
 * `spatial-material.ts` does not read — which is exactly right: it reaches that module's catch-all
 * and is RECORDED as a deviation instead of being silently folded into per-pixel shading.
 */

import type { SubResource } from '../../read/godot-types';
import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

/**
 * Godot 4 `DiffuseMode` → the Godot 3 value that names the SAME shading model. Both tables are
 * quoted in this module's header; the only difference is Godot 4's removal of Oren Nayar at 3.
 */
const DIFFUSE_MODE_GODOT4_TO_GODOT3: Readonly<Record<number, number>> = {
  0: 0, // Burley
  1: 1, // Lambert
  2: 2, // Lambert Wrap
  3: 4, // Toon — Godot 3's Toon is 4, because Oren Nayar sits at 3 there and not in Godot 4
};

/**
 * Godot 4 `SpecularMode` → the Godot 3 value that names the SAME lobe. Both tables are quoted in
 * this module's header; the difference is Godot 4's removal of Blinn at 1 and Phong at 2.
 */
const SPECULAR_MODE_GODOT4_TO_GODOT3: Readonly<Record<number, number>> = {
  0: 0, // Schlick-GGX
  1: 3, // Toon — Godot 3's Toon is 3, because Blinn and Phong sit before it there and not in Godot 4
  2: 4, // Disabled
};

/** `BaseMaterial3D.Transparency`; mode 4 maps to Godot 3's exact depth-prepass spelling. */
const TRANSPARENCY_DISABLED = 0;
const TRANSPARENCY_ALPHA = 1;
const TRANSPARENCY_ALPHA_DEPTH_PRE_PASS = 4;

/** `BaseMaterial3D.ShadingMode`. */
const SHADING_MODE_UNSHADED = 0;
const SHADING_MODE_PER_VERTEX = 2;

const numberOr = (value: GodotValue, at: string, property: string): number => {
  if (value.kind !== 'number') {
    throw new TranslateError(at, `\`StandardMaterial3D.${property}\` is not a number.`);
  }
  return value.value;
};

/**
 * ONE Godot 4 `StandardMaterial3D` property in its Godot 3 spelling, or `undefined` when the two
 * dialects spell it the same and it needs no row.
 *
 * A row may produce SEVERAL Godot 3 properties (`shading_mode` produces two) — Godot 3 spread some
 * of what Godot 4 packed into one enum across separate flags, and dropping the extra one is how a
 * per-vertex-lit surface would silently become a per-pixel-lit one.
 *
 * Exported so `particles-dialect.ts`'s narrow, STRICT particle read can be keyed by the same rows
 * instead of a second copy of them, which is what its own header asked the lane-wide map to do.
 */
export function standardMaterial3DProperty(
  key: string,
  value: GodotValue,
  at: string,
): Readonly<Record<string, GodotValue>> | undefined {
  switch (key) {
    case 'blend_mode':
      return { params_blend_mode: value };
    case 'cull_mode':
      return { params_cull_mode: value };
    case 'emission_energy_multiplier':
      return { emission_energy: value };
    // The two billboard rows the PARTICLE read consumes. Pure renames — Godot 4's own compat
    // remap table, quoted in this module's header, and the `BillboardMode` numbers agree.
    case 'billboard_mode':
      return { params_billboard_mode: value };
    case 'billboard_keep_scale':
      return { params_billboard_keep_scale: value };
    // A rename in THIS direction only — Godot 4's importer discards a Godot 3 mode of 0/1/2 rather
    // than remapping it. See this module's header for the branch, and for both engines' enum
    // tables: the three members Godot 4 kept carry the same numbers, so the value moves untouched.
    case 'depth_draw_mode':
      return { params_depth_draw_mode: value };
    // A bool in both engines, off Godot 4's own remap table (quoted in this module's header). It
    // sets `FLAG_DONT_RECEIVE_SHADOWS` — the 4.7 dump gives the property as `set_flag` at index 13,
    // and `Flags.FLAG_DONT_RECEIVE_SHADOWS` is 13 — which appends `shadows_disabled` to the
    // generated `render_mode` (`scene/resources/material.cpp:856`, 4.4-stable).
    case 'disable_receive_shadows':
      return { flags_do_not_receive_shadows: value };
    case 'diffuse_mode': {
      const mode = numberOr(value, at, key);
      const godot3 = DIFFUSE_MODE_GODOT4_TO_GODOT3[mode];
      if (godot3 === undefined) {
        throw new TranslateError(
          at,
          `a \`StandardMaterial3D.diffuse_mode = ${String(mode)}\`, which is not one of Godot 4's ` +
            'four `DiffuseMode` members (0 Burley, 1 Lambert, 2 Lambert Wrap, 3 Toon). The two ' +
            'engines number this enum differently — Godot 4 removed Oren Nayar — so an unmodelled ' +
            'value cannot be carried across without naming the wrong shading model.',
        );
      }
      return { params_diffuse_mode: { kind: 'number', value: godot3 } };
    }
    case 'specular_mode': {
      const mode = numberOr(value, at, key);
      const godot3 = SPECULAR_MODE_GODOT4_TO_GODOT3[mode];
      if (godot3 === undefined) {
        throw new TranslateError(
          at,
          `a \`StandardMaterial3D.specular_mode = ${String(mode)}\`, which is not one of Godot 4's ` +
            'three `SpecularMode` members (0 Schlick-GGX, 1 Toon, 2 Disabled). The two engines ' +
            'number this enum differently — Godot 4 removed Blinn and Phong — so an unmodelled ' +
            'value cannot be carried across without naming the wrong specular lobe.',
        );
      }
      return { params_specular_mode: { kind: 'number', value: godot3 } };
    }
    case 'shading_mode': {
      const mode = numberOr(value, at, key);
      return {
        flags_unshaded: { kind: 'bool', value: mode === SHADING_MODE_UNSHADED },
        // Godot 3's SECOND lighting flag. Emitted only when Godot 4 asks for it, so a per-pixel
        // material's translated bag is exactly the one a Godot 3 document would have produced.
        ...(mode === SHADING_MODE_PER_VERTEX
          ? { flags_vertex_lighting: { kind: 'bool' as const, value: true } }
          : {}),
      };
    }
    case 'transparency': {
      const mode = numberOr(value, at, key);
      if (mode === TRANSPARENCY_ALPHA_DEPTH_PRE_PASS) {
        return {
          flags_transparent: { kind: 'bool', value: true },
          params_depth_draw_mode: { kind: 'number', value: 3 },
        };
      }
      if (mode !== TRANSPARENCY_DISABLED && mode !== TRANSPARENCY_ALPHA) {
        throw new TranslateError(
          at,
          `a \`StandardMaterial3D.transparency = ${String(mode)}\` (alpha scissor or alpha hash). ` +
            'Godot 3 had one transparency BOOLEAN and this translation carries the material ' +
            'through it; these Godot 4 modes cut or dither the ' +
            'surface instead of blending it, so they refuse rather than being drawn as plain ' +
            'alpha.',
        );
      }
      return { flags_transparent: { kind: 'bool', value: mode === TRANSPARENCY_ALPHA } };
    }
    default:
      return undefined;
  }
}

/**
 * A whole Godot 4 `StandardMaterial3D` sub-resource in Godot 3 spelling, ready for
 * `translate/data/spatial-material.ts` — the ONE material policy, which then carries what three
 * reproduces and records the rest.
 *
 * `resource_name`/`resource_local_to_scene` are `Resource` properties rather than material state
 * and pass through untouched; `spatial-material.ts` classifies them itself.
 */
export function standardMaterial3DToGodot3(material: SubResource, at: string): SubResource {
  const out: Record<string, GodotValue> = {};
  for (const key of Object.keys(material.properties).sort()) {
    const value = material.properties[key] as GodotValue;
    const renamed = standardMaterial3DProperty(key, value, at);
    if (renamed === undefined) out[key] = value;
    else Object.assign(out, renamed);
  }
  return { id: material.id, type: 'SpatialMaterial', properties: out };
}

/**
 * Godot 3 key → the Godot 4 name the FILE wrote, for every row this module renames — what
 * `translate/data/spatial-material.ts`'s notes must call a property so that a message about a Godot 4
 * document does not name a property Godot 4 has no such thing as.
 *
 * A CONSTANT rather than a by-product of the translation above, because the direction that matters
 * is the one a NOTE reads: it asks "what should I call `params_diffuse_mode`?", never "what did
 * this material author?". The pinned dump is the source of those rows.
 *
 * `flags_vertex_lighting` has no entry on purpose: Godot 4 has no such property, and a note about
 * it is a note about the SHADING MODE the file wrote — which is the `shading_mode` row's own
 * business, not a rename.
 */
export const STANDARD_MATERIAL_3D_AUTHORED_NAMES: Readonly<Record<string, string>> = {
  params_blend_mode: 'blend_mode',
  params_cull_mode: 'cull_mode',
  params_diffuse_mode: 'diffuse_mode',
  params_specular_mode: 'specular_mode',
  flags_unshaded: 'shading_mode',
  flags_transparent: 'transparency',
  emission_energy: 'emission_energy_multiplier',
  params_billboard_mode: 'billboard_mode',
  params_billboard_keep_scale: 'billboard_keep_scale',
  params_depth_draw_mode: 'depth_draw_mode',
  flags_do_not_receive_shadows: 'disable_receive_shadows',
};
