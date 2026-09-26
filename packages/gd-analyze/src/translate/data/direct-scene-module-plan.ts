import type {
  DirectGodotProjectCompositionPlan,
  DirectGodotSceneNodePlan,
} from './direct-project-composition-plan';
import {
  type GodotLifecycleAuthority,
  GodotLifecycleAuthorityResolver,
} from './lifecycle-authority';

export const DIRECT_GODOT_SCENE_MODULE_PLAN_VERSION = 1 as const;

export interface DirectGodotSceneModule {
  readonly sourceResPath: string;
  readonly sourceDigest: string;
  readonly targetPath: string;
}

export interface DirectGodotSceneModulePlan {
  readonly version: typeof DIRECT_GODOT_SCENE_MODULE_PLAN_VERSION;
  readonly modules: readonly DirectGodotSceneModule[];
  readonly evidenceClaimIds: readonly string[];
  readonly semanticClaimRegistryDigest: string;
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

function nodeDiagnostics(
  project: DirectGodotProjectCompositionPlan,
  sourceResPath: string,
  node: DirectGodotSceneNodePlan,
): readonly DirectGodotSceneModuleDiagnostic[] {
  return [
    ...(node.scriptInstance?.lifecycle.flatMap((entry) =>
      entry.phase === 'enter-tree' || entry.phase === 'ready' || entry.phase === 'exit-tree'
        ? []
        : [
            {
              at: `${sourceResPath}#${node.nodePath}`,
              message: `${node.scriptInstance!.scriptResPath} ${entry.phase} lifecycle mounting is not planned`,
            },
          ],
    ) ?? []),
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
    ...node.children.flatMap((child) => nodeDiagnostics(project, sourceResPath, child)),
  ];
}

function hasMountedLifecycle(node: DirectGodotSceneNodePlan): boolean {
  return (
    (node.scriptInstance?.lifecycle.some(
      (entry) =>
        entry.phase === 'enter-tree' || entry.phase === 'ready' || entry.phase === 'exit-tree',
    ) ??
      false) ||
    node.children.some(hasMountedLifecycle)
  );
}

/** Select scene-module outputs and lifecycle evidence without constructing target syntax. */
export function planDirectGodotSceneModules(
  project: DirectGodotProjectCompositionPlan,
  authority: GodotLifecycleAuthority,
): DirectGodotSceneModuleResult {
  const resolver = new GodotLifecycleAuthorityResolver(authority);
  const diagnostics: DirectGodotSceneModuleDiagnostic[] = project.scenes.flatMap((scene) =>
    nodeDiagnostics(project, scene.sourceResPath, scene.root),
  );
  if (project.sourceRevision !== resolver.sourceRevision) {
    diagnostics.push({
      at: 'scene-lifecycle',
      message: 'composition and lifecycle authority differ',
    });
  }
  const hasSupportedLifecycle = project.scenes.some((scene) => hasMountedLifecycle(scene.root));
  const lifecycleRule = hasSupportedLifecycle
    ? resolver.rule(['enter-tree', 'ready', 'exit-tree'])
    : undefined;
  if (hasSupportedLifecycle && lifecycleRule === undefined) {
    diagnostics.push({
      at: 'scene-lifecycle',
      message: 'enter-tree/ready/exit-tree native hierarchy mounting has no live evidence rule',
    });
  }
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
      evidenceClaimIds: lifecycleRule === undefined ? [] : [lifecycleRule.evidenceClaimId],
      semanticClaimRegistryDigest: resolver.registryDigest,
    },
  };
}
