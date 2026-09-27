/**
 * Particles: `CPUParticles3D` nodes (compat's `<GodotCPUParticles3D>`, its simulation transcribed,
 * drawing its mesh as an `InstancedMesh`), the `Curve` and `Gradient` resources their parameters
 * take, the `GradientTexture2D` a material samples, and `ReflectionProbe` nodes (the game editor's
 * reflections capability).
 */
import { GODOT_4_7_CODE_SEED_SOURCE_REVISION } from '../../code/authority/godot-4.7-seed';
import type { GodotSceneResourceRule } from '../scene-node-authority';

const REVISION = GODOT_4_7_CODE_SEED_SOURCE_REVISION;

type Source = Readonly<{ file: string; symbol: string; line: number }>;

export const GODOT_4_7_PARTICLE_RESOURCE_RULES: readonly (GodotSceneResourceRule & { readonly source: Source })[] = (
  [
    ['Curve', 'curve', 'godot_curve_new', 'scene/resources/curve.cpp', 41],
    ['Gradient', 'gradient', 'godot_gradient_new', 'scene/resources/gradient.cpp', 36],
    ['GradientTexture2D', 'gradient-texture-2d', 'godot_gradient_texture_2d_new', 'scene/resources/gradient_texture.cpp', 193],
  ] as const
).map(([className, module, exportName, file, line]) => ({
  sourceRevision: REVISION,
  className,
  construct: { module: `lib/godot-compat/${module}`, exportName },
  source: { file, symbol: `${className}::${className}`, line },
}));
