/**
 * Environments: `WorldEnvironment` nodes (`<GodotWorldEnvironment>`, drawing the background,
 * ambient light, tone mapping and fog on three) and the `Environment`, `Sky`, `ShaderMaterial`,
 * `PanoramaSkyMaterial`, `ProceduralSkyMaterial`, `PhysicalSkyMaterial` and `Shader` resources they take (a shader read by the pinned Godot's own
 * shader frontend and lowered to GLSL, a `.gdshader` or the text an engine material generates),
 * and the `CompressedCubemap` a sky shader samples.
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneNodeRule, GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

const identityOf = (className: string) => `${REVISION}\0ClassDB\0${className}`;

export const GODOT_4_7_ENVIRONMENT_NODE_RULES: readonly (GodotSceneNodeRule & { readonly source: Source })[] = [
  {
    sourceRevision: REVISION,
    nativeCanonicalIdentity: identityOf('WorldEnvironment'),
    targetKind: 'three-group',
    source: { file: 'scene/3d/world_environment.cpp', symbol: 'WorldEnvironment::WorldEnvironment', line: 226 },
  },
];

export const GODOT_4_7_ENVIRONMENT_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['Environment', 'environment', 'godot_environment_new', 'scene/resources/environment.cpp', 1637],
    ['Sky', 'sky', 'godot_sky_new', 'scene/resources/sky.cpp', 105],
    ['PanoramaSkyMaterial', 'panorama-sky-material', 'godot_panorama_sky_material_new', 'scene/resources/3d/sky_material.cpp', 513],
    ['ProceduralSkyMaterial', 'procedural-sky-material', 'godot_procedural_sky_material_new', 'scene/resources/3d/sky_material.cpp', 385],
    ['PhysicalSkyMaterial', 'physical-sky-material', 'godot_physical_sky_material_new', 'scene/resources/3d/sky_material.cpp', 827],
    ['ShaderMaterial', 'shader-material', 'godot_shader_material_new', 'scene/resources/material.cpp', 545],
    ['Shader', 'shader', 'godot_shader_new', 'scene/resources/shader.cpp', 300],
    ['CompressedCubemap', 'compressed-cubemap', 'useGodotCubemap', 'scene/resources/compressed_texture.h', 175],
  ] as const
).map(([className, module, exportName, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName },
  source: { file, symbol: `${className}::${className}`, line },
}));
