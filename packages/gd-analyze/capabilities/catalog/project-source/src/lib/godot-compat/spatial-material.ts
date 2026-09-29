/**
 * @godot-class ShaderMaterial
 * @role PROTOCOL
 *
 * A ShaderMaterial of a `spatial` shader drawn as three draws a custom lit material: a
 * `three-custom-shader-material` over `MeshStandardMaterial` (`MeshBasicMaterial` when `unshaded`),
 * its two stages the ones the translation lowered (`spatial-shader.ts`), its uniforms the shader's
 * defaults and then the material's parameters, kept current as they are set. The render modes are
 * the material's settings: `cull_*` its side, `blend_add` additive blending, `depth_draw_never` and
 * `depth_test_disabled` its depth, and a written `ALPHA` makes it transparent (Godot's transparent
 * pass, `scene/resources/material.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`).
 * `source_color` uniforms are converted from sRGB to linear, as Godot's are. `TIME` is the
 * `godot_TIME` uniform, which the scene sets from R3F's clock each frame.
 *
 * Where it differs: `SPECULAR` is not drawn (three's standard material keeps Godot's default
 * 0.5), and `shadows_disabled` does not stop the mesh receiving shadows (a mesh setting in three).
 */

import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import {
  AdditiveBlending,
  BackSide,
  Color as ThreeColor,
  DoubleSide,
  FrontSide,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  type Texture,
  Vector2 as ThreeVector2,
  Vector3 as ThreeVector3,
  Vector4 as ThreeVector4,
} from 'three';
import type { GodotShaderUniform } from './shader';
import type { ShaderMaterial } from './shader-material';

/** `ShaderLanguage::TextureFilter` and `TextureRepeat` (`servers/rendering/shader_language.h:331`). */
const FILTER_NEAREST = 0;
const REPEAT_ENABLE = 1;

/** The three material, with the time uniform its scene sets each frame. */
export type GodotSpatialMaterial = Material & { readonly uniforms: { readonly godot_TIME: { value: number } } };

const THREE_MATERIALS = new WeakMap<ShaderMaterial, GodotSpatialMaterial>();
const OF_THREE = new WeakMap<Material, ShaderMaterial>();

/**
 * The ShaderMaterial a three material draws, where it is one (a mesh's override read back).
 *
 * @godot ShaderMaterial (protocol)
 * @source scene/resources/material.cpp:545
 */
export function godot_shader_material_of_three(material: unknown): ShaderMaterial | undefined {
  return typeof material === 'object' && material !== null ? OF_THREE.get(material as Material) : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, number>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A uniform's value as three's uniform holds it, from a parameter's value or the shader default. */
function uniformValue(uniform: GodotShaderUniform & { readonly color?: true; readonly filter?: number; readonly repeat?: number }, value: unknown): unknown {
  if (uniform.type.startsWith('sampler')) {
    const texture = value as Texture | null;
    if (texture !== null && texture !== undefined) {
      if (uniform.filter === FILTER_NEAREST) texture.magFilter = texture.minFilter = NearestFilter;
      if (uniform.repeat === REPEAT_ENABLE) texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.needsUpdate = true;
    }
    return texture ?? null;
  }
  const components: readonly number[] = Array.isArray(value)
    ? (value as number[])
    : typeof value === 'number' || typeof value === 'boolean'
      ? [Number(value)]
      : isRecord(value)
        ? 'r' in value
          ? [value['r'] as number, value['g'] as number, value['b'] as number, value['a'] as number]
          : Object.values(value)
        : [];
  const values = [...components];
  if (uniform.color === true && values.length >= 3) {
    const linear = new ThreeColor(values[0], values[1], values[2]).convertSRGBToLinear();
    values[0] = linear.r;
    values[1] = linear.g;
    values[2] = linear.b;
  }
  switch (uniform.type) {
    case 'vec2':
      return new ThreeVector2(values[0] ?? 0, values[1] ?? 0);
    case 'vec3':
      return new ThreeVector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
    case 'vec4':
      return new ThreeVector4(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1);
    case 'bool':
      return (values[0] ?? 0) !== 0;
    default:
      return values[0] ?? 0;
  }
}

/**
 * The three material a ShaderMaterial of a spatial shader draws with, made once per material.
 *
 * @godot ShaderMaterial (protocol)
 * @source scene/resources/material.cpp:545
 */
export function godot_shader_material_three(material: ShaderMaterial): GodotSpatialMaterial {
  const held = THREE_MATERIALS.get(material);
  if (held !== undefined) return held;
  const lowered = material.shader?.lowered;
  const spatial = lowered?.spatial;
  if (lowered === undefined || spatial === undefined) throw new Error('godot-compat: a ShaderMaterial without a spatial shader draws no mesh.');
  const uniforms: Record<string, { value: unknown }> = { godot_TIME: { value: 0 } };
  const byName = new Map(lowered.uniforms.map((uniform) => [uniform.name, uniform] as const));
  for (const uniform of lowered.uniforms) {
    const value = material.parameters.has(uniform.name) ? material.parameters.get(uniform.name) : uniform.default;
    uniforms[uniform.glsl] = { value: value === null ? (uniform.type.startsWith('sampler') ? null : uniformValue(uniform, [])) : uniformValue(uniform, value) };
  }
  const modes = new Set(lowered.renderModes);
  const made = new CustomShaderMaterial({
    baseMaterial: modes.has('unshaded') ? MeshBasicMaterial : MeshStandardMaterial,
    vertexShader: spatial.vertexShader,
    fragmentShader: spatial.fragmentShader,
    uniforms,
    transparent: spatial.transparent,
    vertexColors: spatial.vertexColors,
    side: modes.has('cull_disabled') ? DoubleSide : modes.has('cull_front') ? BackSide : FrontSide,
    ...(modes.has('blend_add') ? { blending: AdditiveBlending } : {}),
    depthWrite: !modes.has('depth_draw_never') && !spatial.transparent,
    depthTest: !modes.has('depth_test_disabled'),
  });
  material.listeners.add((name, value) => {
    const uniform = byName.get(name);
    if (uniform === undefined) return;
    const slot = uniforms[uniform.glsl] as { value: unknown };
    slot.value = value === null || value === undefined ? uniformValue(uniform, uniform.default ?? []) : uniformValue(uniform, value);
  });
  const drawn = made as unknown as GodotSpatialMaterial;
  THREE_MATERIALS.set(material, drawn);
  OF_THREE.set(drawn, material);
  return drawn;
}
