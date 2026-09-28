/**
 * A `StandardMaterial3D` as the three material a three.js developer would write for it
 * (docs/GODOT.md §The lane's law, rows 2 and 3): the planner decides the material class and every
 * prop here, and emit prints them as they are. The same mapping as compat's `base-material-3d.ts`,
 * which draws materials a script makes:
 *
 * - the class: unshaded is `meshBasicMaterial`, the toon diffuse mode `meshToonMaterial`, a
 *   material whose specular three's standard material cannot state (an amount other than 0.5,
 *   specular disabled) or that is anisotropic `meshPhysicalMaterial`, any other
 *   `meshStandardMaterial`;
 * - transparency: alpha and depth pre-pass are `transparent`, scissor `alphaTest` (0.5), hash
 *   `alphaHash`, the albedo's alpha `opacity`;
 * - the depth draw mode: `depthWrite` is true for `ALWAYS`, false for `DISABLED`, and for
 *   `OPAQUE_ONLY` three's usual pairing, a transparent material writing no depth;
 * - the specular amount is the physical material's `reflectivity` (three's reflectivity and Godot's
 *   specular both make the dielectric F0 `0.16 * specular^2`), specular disabled its
 *   `specularIntensity` 0;
 * - a billboard, vertex colour as albedo, proximity fade (three's soft particles) and distance
 *   fade (the albedo's alpha faded by the view distance: `transparent` for pixel alpha, three's
 *   `alphaHash` for the dithers) are `userData` compat's `godot_base_material_3d_scene_shader`
 *   draws, handed the material once made;
 * - what three has no idiom for (rim, backlight, grow, the other diffuse modes, toon
 *   specular, not receiving shadows) is `userData` compat reads back through the getters, and
 *   draws nothing;
 * - in a project that places a reflection probe, a standard or physical material is made by the
 *   game editor's reflections capability (`createVolumeReflectionMaterial`,
 *   `createVolumeReflectionPhysicalMaterial`) with the same props: Godot draws every geometry inside
 *   a probe's box with the probe's reflection, whichever scene the geometry comes from, and that
 *   material is the capability's way to draw one (compat's `reflection-probe.ts` says how the two
 *   differ). Its probe ceiling is the capability's own: see there for Godot's two per geometry.
 */
import { hexColor } from './scene-light-idioms';
import type { TargetGodotSceneSetterPlan, TargetGodotSceneValue } from './scene-document-plan';

/** A three material element. */
export type GodotSceneMaterialElement = 'meshBasicMaterial' | 'meshStandardMaterial' | 'meshPhysicalMaterial' | 'meshToonMaterial';

/** A material prop's value, as emit prints it. */
export type GodotSceneMaterialPropValue =
  | { readonly kind: 'literal'; readonly value: number | boolean | string }
  /** Linear colour components (a colour beyond sRGB hex's range): three's `Color`. */
  | { readonly kind: 'linear-color'; readonly components: readonly number[] }
  /** A three constant (`AdditiveBlending`, `DoubleSide`). */
  | { readonly kind: 'three'; readonly name: string }
  /**
   * A planned texture resource sampled with the material's filter and repeat; `model` when the
   * material draws on an imported model's own geometry, whose UVs are the file's (glTF's origin is
   * the image's top row), so the texture is sampled as the model's own images are.
   */
  | { readonly kind: 'map'; readonly texture: string; readonly filter: number; readonly repeat: boolean; readonly srgb: boolean; readonly model?: true }
  /** The Godot-only values compat reads back, as `userData`. */
  | { readonly kind: 'user-data'; readonly entries: readonly { readonly key: string; readonly value: number | boolean | readonly number[] }[] }
  /** A compat function the material is handed once made (`onUpdate`). */
  | { readonly kind: 'compat'; readonly module: string; readonly exportName: string };

export interface GodotSceneMaterialIdiom {
  readonly kind: 'material';
  readonly element: GodotSceneMaterialElement;
  readonly props: readonly { readonly name: string; readonly value: GodotSceneMaterialPropValue }[];
  /**
   * The capability function that makes the material in place of three's class: called with the
   * props as its parameters, it returns a handle whose `material` is the three material.
   */
  readonly factory?: { readonly module: string; readonly exportName: string };
}

/** The reflections capability's volume material for a lit three material the project's probes light. */
const REFLECTED: Partial<Record<GodotSceneMaterialElement, NonNullable<GodotSceneMaterialIdiom['factory']>>> = {
  meshStandardMaterial: { module: 'lib:reflections/index', exportName: 'createVolumeReflectionMaterial' },
  meshPhysicalMaterial: { module: 'lib:reflections/index', exportName: 'createVolumeReflectionPhysicalMaterial' },
};

const f32 = Math.fround;

/**
 * Godot's Compatibility default material for a surface without one (`rasterizer_scene_gles3.cpp:4624`:
 * albedo 0.6, roughness 0.8, metallic 0.2).
 */
export const GODOT_DEFAULT_MATERIAL_IDIOM: GodotSceneMaterialIdiom = {
  kind: 'material',
  element: 'meshStandardMaterial',
  props: [
    { name: 'color', value: { kind: 'literal', value: hexColor([0.6, 0.6, 0.6]) } },
    { name: 'roughness', value: { kind: 'literal', value: 0.8 } },
    { name: 'metalness', value: { kind: 'literal', value: 0.2 } },
  ],
};

/**
 * The material as it draws on an imported model's own geometry (an external material the importer
 * swaps in, a surface override on a model's mesh): its textures sampled as the model's own images
 * are. The same idiom when it samples no texture.
 */
export function godotModelMaterialIdiom(idiom: GodotSceneMaterialIdiom): GodotSceneMaterialIdiom {
  if (!idiom.props.some((prop) => prop.value.kind === 'map')) return idiom;
  return { ...idiom, props: idiom.props.map((prop) => (prop.value.kind === 'map' ? { name: prop.name, value: { ...prop.value, model: true } } : prop)) };
}

/** The Compatibility shader's `srgb_to_linear` (`tonemap_inc.glsl:22`), in single precision. */
function srgbToLinear(value: number): number {
  return f32(value * f32(f32(value * f32(f32(value * 0.305306011) + 0.682171111)) + 0.012522878));
}

/** A colour: its sRGB hex, or linear components where a channel is beyond hex's range. */
function colour(components: readonly number[]): GodotSceneMaterialPropValue {
  const rgb = components.slice(0, 3);
  if (rgb.every((value) => value >= 0 && value <= 1)) return { kind: 'literal', value: hexColor(rgb) };
  return { kind: 'linear-color', components: rgb.map(srgbToLinear) };
}

/** `BaseMaterial3D::BlendMode` (`material.h:226`) as three's blending, mix excepted. */
const BLENDING = ['', 'AdditiveBlending', 'SubtractiveBlending', 'MultiplyBlending'] as const;

/**
 * The material a `StandardMaterial3D` with these authored setters is written as; `reflected`, the
 * project places a reflection probe.
 *
 * @godot StandardMaterial3D (protocol)
 * @source scene/resources/material.cpp:3908
 */
export function godotSceneMaterialIdiom(setters: readonly TargetGodotSceneSetterPlan[], reflected = false): GodotSceneMaterialIdiom {
  const value = (exportName: string, index?: number): TargetGodotSceneValue | undefined =>
    setters.find((entry) => entry.setter.exportName === exportName && (index === undefined || entry.index === index))?.value;
  const num = (exportName: string, index?: number): number | undefined => {
    const found = value(exportName, index);
    return found?.kind === 'number' ? found.value : undefined;
  };
  const bool = (exportName: string, index?: number): boolean | undefined => {
    const found = value(exportName, index);
    return found?.kind === 'bool' ? found.value : undefined;
  };
  const components = (exportName: string): readonly number[] | undefined => {
    const found = value(exportName);
    return found !== undefined && 'components' in found ? found.components : undefined;
  };
  const resource = (exportName: string, index: number): string | undefined => {
    const found = value(exportName, index);
    return found?.kind === 'resource' ? found.key : undefined;
  };

  const albedo = components('set_albedo');
  const transparency = num('set_transparency') ?? 0;
  const blend = num('set_blend_mode') ?? 0;
  const unshaded = (num('set_shading_mode') ?? 1) === 0;
  const diffuseMode = num('set_diffuse_mode') ?? 0;
  const specularMode = num('set_specular_mode') ?? 0;
  const specular = f32(num('set_specular') ?? 0.5);
  const anisotropic = !unshaded && bool('set_feature', 4) === true;
  const element: GodotSceneMaterialElement = unshaded
    ? 'meshBasicMaterial'
    : diffuseMode === 3
      ? 'meshToonMaterial'
      : anisotropic || specular !== 0.5 || specularMode === 2
        ? 'meshPhysicalMaterial'
        : 'meshStandardMaterial';
  const props: { name: string; value: GodotSceneMaterialPropValue }[] = [];
  const literal = (name: string, entry: number | boolean | string) => props.push({ name, value: { kind: 'literal', value: entry } });

  if (albedo !== undefined && albedo.slice(0, 3).some((channel) => channel !== 1)) props.push({ name: 'color', value: colour(albedo) });
  const filter = num('set_texture_filter') ?? 3;
  const repeat = bool('set_flag', 16) ?? true;
  const texture = resource('set_texture', 0);
  if (texture !== undefined) props.push({ name: 'map', value: { kind: 'map', texture, filter, repeat, srgb: true } });
  // `Transparency` (`material.h:198`): alpha and depth pre-pass, scissor, hash. Proximity fade reads
  // the scene's depth, which draws the material in the alpha pass, its albedo's alpha applied
  // (`material.cpp:1807`).
  const proximity = bool('set_proximity_fade_enabled') === true;
  // `DistanceFadeMode` (`material.h:322`): pixel alpha draws in the alpha pass (`material.cpp:1807`);
  // the dithers discard by the fade, which is three's hashed alpha.
  const fade = num('set_distance_fade') ?? 0;
  const transparent = transparency === 1 || transparency === 4 || proximity || fade === 1;
  if (transparent) literal('transparent', true);
  if (transparency === 2) literal('alphaTest', 0.5);
  if (transparency === 3 || fade === 2 || fade === 3) literal('alphaHash', true);
  if (transparency !== 0 || proximity || fade === 1) literal('opacity', albedo?.[3] ?? 1);
  // `DepthDrawMode` (`material.h:235`): `ALWAYS` 1, `DISABLED` 2; three writes depth by default.
  const depthDraw = num('set_depth_draw_mode') ?? 0;
  if (depthDraw === 2 || (depthDraw === 0 && transparent)) literal('depthWrite', false);
  const blending = BLENDING[blend];
  if (blending !== undefined && blending !== '') props.push({ name: 'blending', value: { kind: 'three', name: blending } });
  if (!unshaded && element !== 'meshToonMaterial') {
    const metallic = num('set_metallic');
    const roughness = num('set_roughness');
    if (metallic !== undefined) literal('metalness', metallic);
    if (roughness !== undefined) literal('roughness', roughness);
    // `TEXTURE_ROUGHNESS` (`material.h:149`): three samples its green channel where Godot samples the
    // material's `roughness_texture_channel` (red by default); a grey image reads the same.
    const roughnessTexture = resource('set_texture', 2);
    if (roughnessTexture !== undefined) props.push({ name: 'roughnessMap', value: { kind: 'map', texture: roughnessTexture, filter, repeat, srgb: false } });
  }
  // No `normal_texture` (`TEXTURE_NORMAL`, 4) is planned yet. The lane that adds it as three's
  // `normalMap` needs no flip on three's own geometry (its primitives, an ArrayMesh's data, a
  // script's primitive mesh): their `v` runs up the image and textures upload with three's `flipY`,
  // so the bitangent three derives without a `tangent` attribute (`getTangentFrame`,
  // `normal_fragment_begin.glsl.js:30` in three 0.180) points up the image, as Godot's does, and an
  // ArrayMesh's tangents keep Godot's sign, which points it up too (`scene-families.ts`,
  // `godotArrayMeshData`). The model variant (`godotModelMaterialIdiom`) is the one to flip: on a
  // model's glTF UVs `v` runs down the image, so without tangents the derived bitangent points down
  // and `normalScale.y` goes negative, as GLTFLoader does for the same case (`normalScale.y *= -1`,
  // and `clearcoatNormalScale.y *= -1` for a clearcoat normal map, `GLTFLoader.js:3583-3586`); a
  // model surface with tangents carries glTF's sign and needs no flip.
  if (!unshaded && bool('set_feature', 0) === true) {
    const emission = components('set_emission') ?? [0, 0, 0, 1];
    const energy = num('set_emission_energy_multiplier') ?? 1;
    props.push({ name: 'emissive', value: { kind: 'linear-color', components: emission.slice(0, 3).map((channel) => srgbToLinear(f32(channel * energy))) } });
  }
  // `CULL_FRONT` and `CULL_DISABLED` (`material.h:296`) as the side three draws.
  const cull = num('set_cull_mode') ?? 0;
  if (cull !== 0) props.push({ name: 'side', value: { kind: 'three', name: cull === 1 ? 'BackSide' : 'DoubleSide' } });

  // The Godot-only values compat reads back (`godot_base_material_3d_of`); values that do nothing
  // (a grow amount without grow, rim or backlight parameters without their feature) are left out.
  const data: { key: string; value: number | boolean | readonly number[] }[] = [];
  const billboard = num('set_billboard_mode') ?? 0;
  const coloured = bool('set_flag', 1) === true;
  if (billboard !== 0) data.push({ key: 'billboard_mode', value: billboard });
  if (bool('set_flag', 5) === true) data.push({ key: 'billboard_keep_scale', value: true });
  if (coloured) data.push({ key: 'vertex_color_use_as_albedo', value: true });
  if (bool('set_flag', 2) === true) data.push({ key: 'vertex_color_is_srgb', value: true });
  if (proximity) {
    data.push({ key: 'proximity_fade_enabled', value: true });
    data.push({ key: 'proximity_fade_distance', value: Math.max(f32(num('set_proximity_fade_distance') ?? 1), f32(0.01)) });
  }
  if (depthDraw !== 0) data.push({ key: 'depth_draw_mode', value: depthDraw });
  if (bool('set_grow_enabled') === true) data.push({ key: 'grow', value: f32(num('set_grow') ?? 0) });
  if (fade !== 0) {
    data.push({ key: 'distance_fade_mode', value: fade });
    data.push({ key: 'distance_fade_min', value: f32(num('set_distance_fade_min_distance') ?? 0) });
    data.push({ key: 'distance_fade_max', value: f32(num('set_distance_fade_max_distance') ?? 10) });
    if (transparency === 0) data.push({ key: 'distance_fade_opaque', value: true });
  }
  if (!unshaded) {
    if (diffuseMode !== 0 && diffuseMode !== 3) data.push({ key: 'diffuse_mode', value: diffuseMode });
    if (specularMode === 1) data.push({ key: 'specular_mode', value: specularMode });
    if (bool('set_feature', 2) === true) data.push({ key: 'rim', value: [f32(num('set_rim') ?? 1), f32(num('set_rim_tint') ?? 0.5)] });
    if (bool('set_flag', 13) === true) data.push({ key: 'dont_receive_shadows', value: true });
    if (bool('set_feature', 9) === true) data.push({ key: 'backlight', value: (components('set_backlight') ?? [0, 0, 0, 1]).slice(0, 3) });
  }
  if (data.length > 0) props.push({ name: 'userData', value: { kind: 'user-data', entries: data } });
  // A billboard, vertex colour, proximity or distance fade draws through compat (`godot_base_material_3d_scene_shader`).
  if (billboard !== 0 || coloured || proximity || fade !== 0) props.push({ name: 'onUpdate', value: { kind: 'compat', module: 'base-material-3d', exportName: 'godot_base_material_3d_scene_shader' } });

  if (element === 'meshPhysicalMaterial') {
    // `godot_base_material_3d_anisotropy`: a negative ratio stretches the highlight across the tangent.
    if (anisotropic) {
      const ratio = f32(num('set_anisotropy') ?? 0);
      literal('anisotropy', Math.abs(ratio));
      if (ratio < 0) literal('anisotropyRotation', Math.PI / 2);
    }
    if (specular !== 0.5) literal('reflectivity', specular);
    if (specularMode === 2) literal('specularIntensity', 0);
  }
  const factory = reflected ? REFLECTED[element] : undefined;
  return { kind: 'material', element, props, ...(factory === undefined ? {} : { factory }) };
}
