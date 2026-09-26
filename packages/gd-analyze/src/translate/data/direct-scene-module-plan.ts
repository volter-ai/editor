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

/** The lifecycle phases `node.ts`'s binding mounts at tree entry, readiness and exit. */
const TREE_PHASES = new Set(['enter-tree', 'ready', 'exit-tree']);

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
    ...node.children.flatMap((child) => nodeDiagnostics(project, sourceResPath, child)),
  ];
}

function hasMountedLifecycle(node: DirectGodotSceneNodePlan): boolean {
  return (
    (node.scriptInstance?.lifecycle.some((entry) => TREE_PHASES.has(entry.phase)) ?? false) ||
    node.children.some(hasMountedLifecycle)
  );
}

/** Whether a script processes frames or input: callbacks `Main`'s loop drives (`compat/main.tsx`). */
function hasLoopLifecycle(node: DirectGodotSceneNodePlan): boolean {
  return (
    (node.scriptInstance?.lifecycle.some((entry) => !TREE_PHASES.has(entry.phase)) ?? false) ||
    node.children.some(hasLoopLifecycle)
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
  const hasLoop = project.scenes.some((scene) => hasLoopLifecycle(scene.root));
  const loopRule = hasLoop ? resolver.mainLoopRule() : undefined;
  if (hasLoop && loopRule === undefined) {
    diagnostics.push({ at: 'scene-lifecycle', message: "process and input callbacks have no live Main-loop evidence rule" });
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
      evidenceClaimIds: [
        ...(lifecycleRule === undefined ? [] : [lifecycleRule.evidenceClaimId]),
        ...(loopRule === undefined ? [] : [loopRule.evidenceClaimId]),
      ],
      semanticClaimRegistryDigest: resolver.registryDigest,
    },
  };
}
