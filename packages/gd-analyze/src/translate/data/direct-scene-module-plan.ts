import { godotSceneSubnodes } from './scene-document-plan';
import type {
  DirectGodotProjectCompositionPlan,
  DirectGodotSceneNodePlan,
} from './direct-project-composition-plan';

export const DIRECT_GODOT_SCENE_MODULE_PLAN_VERSION = 1 as const;

export interface DirectGodotSceneModule {
  readonly sourceResPath: string;
  readonly sourceDigest: string;
  readonly targetPath: string;
}

export interface DirectGodotSceneModulePlan {
  readonly version: typeof DIRECT_GODOT_SCENE_MODULE_PLAN_VERSION;
  readonly modules: readonly DirectGodotSceneModule[];
}

export interface DirectGodotSceneModuleDiagnostic {
  readonly at: string;
  readonly message: string;
}

export type DirectGodotSceneModuleResult =
  | { readonly kind: 'accepted-scene-modules'; readonly plan: DirectGodotSceneModulePlan }
  | {
      readonly kind: 'refused-scene-modules';
      readonly diagnostics: readonly DirectGodotSceneModuleDiagnostic[];
    };

/** The lifecycle phases `node.ts`'s binding mounts at tree entry, readiness and exit. */

function nodeDiagnostics(
  project: DirectGodotProjectCompositionPlan,
  sourceResPath: string,
  node: DirectGodotSceneNodePlan,
): readonly DirectGodotSceneModuleDiagnostic[] {
  return [
    ...(node.scriptInstance?.autoloadReferences.flatMap((reference) =>
      project.scriptAutoloads.some(
        (autoload) =>
          autoload.singleton &&
          autoload.name === reference.name &&
          autoload.scriptResPath === reference.resPath,
      )
        ? []
        : [
            {
              at: `${sourceResPath}#${node.nodePath}`,
              message: `${reference.name} does not resolve to singleton ${reference.resPath}`,
            },
          ],
    ) ?? []),
    ...godotSceneSubnodes(node).flatMap((child) => nodeDiagnostics(project, sourceResPath, child)),
  ];
}

/** Select scene-module outputs without constructing target syntax. */
export function planDirectGodotSceneModules(project: DirectGodotProjectCompositionPlan): DirectGodotSceneModuleResult {
  const diagnostics: DirectGodotSceneModuleDiagnostic[] = project.scenes.flatMap((scene) =>
    nodeDiagnostics(project, scene.sourceResPath, scene.root),
  );
  if (diagnostics.length > 0) return { kind: 'refused-scene-modules', diagnostics };
  return {
    kind: 'accepted-scene-modules',
    plan: {
      version: DIRECT_GODOT_SCENE_MODULE_PLAN_VERSION,
      modules: project.scenes.map((scene) => ({
        sourceResPath: scene.sourceResPath,
        sourceDigest: scene.sourceDigest,
        targetPath: scene.targetPath,
      })),
    },
  };
}
