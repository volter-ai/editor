import type { BoundGodotProject } from '../analyze/bound-project';
import type { GodotImportToolchainSnapshot } from '../snapshot/toolchain-snapshot';
import { planDirectGodotArtifacts } from './artifacts/plan';
import type { GodotPlannedArtifact } from './artifacts/types';
import type { OfficialBoundCodePlan } from './code/lower-official-bound';
import type {
  DirectGodotCompositionDiagnostic,
  DirectGodotProjectCompositionPlan,
} from './data/direct-project-composition-plan';
import type { DirectGodotProjectDataPlan } from './data/direct-project-data-plan';
import type { DirectGodotSceneModulePlan } from './data/direct-scene-module-plan';

export const GODOT_TRANSLATION_PLAN_VERSION = 5 as const;

const acceptedTranslationBrand: unique symbol = Symbol('GodotAcceptedTranslation');

export interface GodotTranslationPlan {
  readonly version: typeof GODOT_TRANSLATION_PLAN_VERSION;
  readonly snapshotDigest: string;
  readonly toolchainDigest: string;
  readonly code: OfficialBoundCodePlan;
  readonly composition: DirectGodotProjectCompositionPlan;
  readonly sceneModules: DirectGodotSceneModulePlan;
  readonly projectData: DirectGodotProjectDataPlan;
  /** Complete immutable artifact census; only emit may realize planned generated text. */
  readonly artifacts: readonly GodotPlannedArtifact[];
  readonly deviations: readonly never[];
}

export interface GodotAcceptedTranslation {
  readonly kind: 'accepted-translation';
  readonly plan: GodotTranslationPlan;
  readonly [acceptedTranslationBrand]: true;
}

export type GodotTranslationResult =
  | GodotAcceptedTranslation
  | {
      readonly kind: 'refused-translation';
      readonly diagnostics: readonly DirectGodotCompositionDiagnostic[];
    };

/** The imported models the planned scenes instance: each copied beside the app. */
function importedModels(project: BoundGodotProject, composition: DirectGodotProjectCompositionPlan) {
  const paths = new Set<string>();
  const walk = (node: DirectGodotProjectCompositionPlan['scenes'][number]['root']): void => {
    if (node.model !== undefined) paths.add(node.model.sourceResPath);
    for (const child of node.children) walk(child);
    for (const placed of node.placements ?? []) walk(placed.node);
  };
  for (const scene of composition.scenes) walk(scene.root);
  return [...paths].sort().flatMap((resPath) => {
    const document = project.documents.scenes.find((scene) => scene.resPath === resPath);
    return document?.model === undefined
      ? []
      : [{ resPath, sourceDigest: document.sourceDigest, bytes: document.model.bytes }];
  });
}

/** The images and sounds the scenes load as imported resources: copied beside the app, as the models are. */
function importedTextures(project: BoundGodotProject, composition: DirectGodotProjectCompositionPlan) {
  const paths = new Set(
    composition.scenes.flatMap((scene) => scene.resources.flatMap((resource) => (resource.load === undefined ? [] : [resource.load.sourceResPath]))),
  );
  return [...project.documents.textures, ...project.documents.sounds]
    .filter((file) => paths.has(file.resPath))
    .map((file) => ({ resPath: file.resPath, sourceDigest: file.sourceDigest, bytes: file.bytes }));
}

function validateInputClosure(
  project: BoundGodotProject,
  composition: DirectGodotProjectCompositionPlan,
  sceneModules: DirectGodotSceneModulePlan,
): readonly DirectGodotCompositionDiagnostic[] {
  const consumed = new Set([
    'project.godot',
    ...composition.sourceModules.map((module) => module.sourceResPath.slice('res://'.length)),
    ...sceneModules.modules.map((module) => module.sourceResPath.slice('res://'.length)),
    // An imported model is copied beside the app; its `.import` sidecar is what imported it.
    ...[...importedModels(project, composition), ...importedTextures(project, composition)].flatMap((model) => {
      const relative = model.resPath.slice('res://'.length);
      return [relative, `${relative}.import`];
    }),
    // A `.tres` a scene's resources are constructed from is translated into that scene's module.
    ...composition.scenes.flatMap((scene) =>
      scene.resources.flatMap((resource) =>
        resource.key.startsWith('ext:res://') ? [resource.key.slice('ext:res://'.length).split('#')[0] as string] : [],
      ),
    ),
  ]);
  return project.inputs.flatMap((entry) => {
    if (
      entry.entryType === 'directory' ||
      entry.kind === 'explicit-non-input' ||
      consumed.has(entry.relativePath)
    ) {
      return [];
    }
    return [
      {
        at: entry.resPath ?? entry.relativePath,
        message: `${entry.kind} input has no source translation, asset copy, or conversion plan`,
      },
    ];
  });
}

function validateCapabilityClosure(
  projectData: DirectGodotProjectDataPlan,
  artifacts: readonly GodotPlannedArtifact[],
): readonly DirectGodotCompositionDiagnostic[] {
  const expected = new Map(
    projectData.requirements.capabilities.flatMap((capability) =>
      capability.artifacts.map(
        (artifact) =>
          [artifact.path, `${capability.id}\0${capability.version}\0${artifact.digest}`] as const,
      ),
    ),
  );
  const diagnostics: DirectGodotCompositionDiagnostic[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== 'capability-copy') continue;
    const identity = `${artifact.origin.capabilityId}\0${artifact.origin.capabilityVersion}\0${artifact.digest}`;
    if (expected.get(artifact.path) !== identity) {
      diagnostics.push({
        at: artifact.path,
        message: 'capability bytes have no matching requirement',
      });
    }
    expected.delete(artifact.path);
  }
  for (const path of expected.keys()) {
    diagnostics.push({ at: path, message: 'capability requirement has no frozen copy bytes' });
  }
  return diagnostics;
}

/** Pure assembly of already-selected code, data, project and toolchain plans. */
export function assembleGodotTranslationPlan(
  project: BoundGodotProject,
  toolchain: GodotImportToolchainSnapshot,
  code: OfficialBoundCodePlan,
  composition: DirectGodotProjectCompositionPlan,
  sceneModules: DirectGodotSceneModulePlan,
  projectData: DirectGodotProjectDataPlan,
): GodotTranslationResult {
  let artifacts: readonly GodotPlannedArtifact[];
  try {
    artifacts = planDirectGodotArtifacts(
      composition,
      code,
      sceneModules,
      projectData,
      toolchain.capabilityCopies,
      [...importedModels(project, composition), ...importedTextures(project, composition)],
    );
  } catch (error) {
    return {
      kind: 'refused-translation',
      diagnostics: [
        {
          at: 'translation-artifacts',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  const diagnostics = [
    ...validateInputClosure(project, composition, sceneModules),
    ...validateCapabilityClosure(projectData, artifacts),
  ];
  if (projectData.toolchainDigest !== toolchain.digest) {
    diagnostics.push({ at: 'toolchain-snapshot', message: 'project data uses another toolchain' });
  }
  if (diagnostics.length > 0) return { kind: 'refused-translation', diagnostics };
  return {
    kind: 'accepted-translation',
    [acceptedTranslationBrand]: true,
    plan: {
      version: GODOT_TRANSLATION_PLAN_VERSION,
      snapshotDigest: project.snapshotDigest,
      toolchainDigest: toolchain.digest,
      code,
      composition,
      sceneModules,
      projectData,
      artifacts,
      deviations: [],
    },
  };
}
