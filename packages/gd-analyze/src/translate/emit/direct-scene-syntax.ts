/**
 * The scene modules: each accepted scene is written as idiomatic React Three Fiber
 * (`idiomatic-scene-syntax.ts`); a scene without an idiomatic form was refused when it planned.
 */
import { idiomaticSceneSourceFile } from './idiomatic-scene-syntax';
import type { TargetTsSourceFile } from '../code/target-ts-syntax';
import type { DirectGodotProjectCompositionPlan } from '../data/direct-project-composition-plan';
import type { DirectGodotSceneModulePlan } from '../data/direct-scene-module-plan';

export interface EmittedDirectGodotSceneModule {
  readonly sourceResPath: string;
  readonly sourceDigest: string;
  readonly targetPath: string;
  readonly syntax: TargetTsSourceFile;
}

/** Mechanically lower an already accepted scene-module plan to structured TSX syntax. */
export function emitDirectGodotSceneSyntax(
  project: DirectGodotProjectCompositionPlan,
  plan: DirectGodotSceneModulePlan,
): readonly EmittedDirectGodotSceneModule[] {
  const scenes = new Map(project.scenes.map((scene) => [scene.sourceResPath, scene] as const));
  if (scenes.size !== project.scenes.length) {
    throw new Error('accepted composition repeats a scene source path');
  }
  const emitted = plan.modules.map((module) => {
    const scene = scenes.get(module.sourceResPath);
    if (
      scene === undefined ||
      scene.sourceDigest !== module.sourceDigest ||
      scene.targetPath !== module.targetPath
    ) {
      throw new Error(`${module.sourceResPath}: accepted scene-module plan is inconsistent`);
    }
    scenes.delete(module.sourceResPath);
    return { ...module, syntax: idiomaticSceneSourceFile(project, scene) };
  });
  if (scenes.size > 0) {
    throw new Error(`${[...scenes.keys()][0]}: accepted scene has no module plan`);
  }
  return emitted;
}
