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
  /** Every input the plan leaves out, with why nothing the game runs reads it. */
  readonly unplannedInputs: readonly GodotUnplannedInput[];
  readonly deviations: readonly never[];
}

export interface GodotUnplannedInput {
  readonly path: string;
  readonly reason: string;
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
  return [...project.documents.textures, ...project.documents.sounds, ...project.documents.cubemaps]
    .filter((file) => paths.has(file.resPath))
    .map((file) => ({ resPath: file.resPath, sourceDigest: file.sourceDigest, bytes: file.bytes }));
}

function validateInputClosure(
  project: BoundGodotProject,
  composition: DirectGodotProjectCompositionPlan,
  sceneModules: DirectGodotSceneModulePlan,
): { readonly diagnostics: readonly DirectGodotCompositionDiagnostic[]; readonly unplanned: readonly GodotUnplannedInput[] } {
  const consumed = new Set([
    'project.godot',
    // License and attribution files are carried verbatim (`licenses/<path>`).
    ...project.documents.licenses.map((license) => license.relativePath),
    ...composition.sourceModules.map((module) => module.sourceResPath.slice('res://'.length)),
    ...sceneModules.modules.map((module) => module.sourceResPath.slice('res://'.length)),
    // An imported model is copied beside the app; its `.import` sidecar is what imported it.
    ...[...importedModels(project, composition), ...importedTextures(project, composition)].flatMap((model) => {
      const relative = model.resPath.slice('res://'.length);
      return [relative, `${relative}.import`];
    }),
    // A `.gdshader` is read by the shader frontend and lowered into the scene module that uses it.
    ...composition.scenes.flatMap((scene) =>
      scene.resources.flatMap((resource) => (resource.className === 'Shader' && resource.key.startsWith('ext:res://') ? [resource.key.slice('ext:res://'.length)] : [])),
    ),
    // A MeshLibrary's item thumbnails are the editor's: its data file is what the scene loads.
    ...composition.scenes.flatMap((scene) =>
      scene.resources.flatMap((resource) =>
        (resource.library?.previews ?? []).flatMap((preview) => {
          const relative = preview.slice('res://'.length);
          return [relative, `${relative}.import`];
        }),
      ),
    ),
    // A `.tres` a scene's resources are constructed from is translated into that scene's module.
    ...composition.scenes.flatMap((scene) =>
      scene.resources.flatMap((resource) =>
        resource.key.startsWith('ext:res://') ? [resource.key.slice('ext:res://'.length).split('#')[0] as string] : [],
      ),
    ),
  ]);
  // What the planned files name: a scene's or resource's `[ext_resource]`s, a script's `preload`s.
  const relative = (resPath: string): string => resPath.slice('res://'.length);
  const referenced = new Set<string>();
  for (const scene of project.documents.scenes) {
    if (consumed.has(relative(scene.resPath))) for (const entry of scene.extResources) referenced.add(relative(entry.resPath));
  }
  for (const resource of project.documents.resources) {
    if (consumed.has(relative(resource.resPath))) for (const entry of resource.extResources) referenced.add(relative(entry.resPath));
  }
  for (const script of project.scripts) {
    if (!consumed.has(relative(script.resPath))) continue;
    for (const node of script.program.nodes) if (node.kind === 'PRELOAD') referenced.add(relative(node.resolvedPath));
  }
  const roots = new Map(project.read.runtimeRoots.map((root) => [relative(root.resPath), root.mechanism] as const));
  // An empty AudioBusLayout is refused by `AudioServer::set_bus_layout` (servers/audio/audio_server.cpp:1755):
  // the one Master bus stays, which is compat's.
  const emptyBusLayout = (path: string): boolean =>
    roots.get(path) === 'default-audio-bus-layout' &&
    project.documents.resources.some(
      (resource) => relative(resource.resPath) === path && resource.resource.type === 'AudioBusLayout' && Object.keys(resource.resource.properties).length === 0 && resource.subResources.length === 0,
    );
  /**
   * Accounted for without a plan: a consumed file's `.uid` sidecar (the path's UID, which the plan
   * resolves by path); the empty default bus layout; the application icon (`DisplayServer::set_icon`,
   * main/main.cpp:4753, window chrome the page host owns); and a file nothing planned names, with
   * its `.import` sidecar: the translated game reads files only through a planned scene, resource or
   * `preload` (no runtime `load` is bound), so such a file is never read.
   */
  const unplannedReason = (path: string): string | undefined => {
    if (path.endsWith('.uid') && consumed.has(path.slice(0, -'.uid'.length))) return 'the UID sidecar of a translated file, which the plan resolves by path';
    if (emptyBusLayout(path)) return 'an empty AudioBusLayout, which AudioServer refuses (the Master bus stays)';
    const source = path.endsWith('.import') ? path.slice(0, -'.import'.length) : path;
    if (roots.get(source) === 'application-icon') return 'the application icon (window chrome the page host owns)';
    if (referenced.has(source) || roots.has(source) || (source !== path && consumed.has(source))) return undefined;
    return source === path ? 'nothing the game runs names it' : 'the import sidecar of a file nothing the game runs names';
  };
  const diagnostics: DirectGodotCompositionDiagnostic[] = [];
  const unplanned: GodotUnplannedInput[] = [];
  for (const entry of project.inputs) {
    if (entry.entryType === 'directory' || entry.kind === 'explicit-non-input' || consumed.has(entry.relativePath)) continue;
    const reason = unplannedReason(entry.relativePath);
    if (reason !== undefined) unplanned.push({ path: entry.resPath ?? entry.relativePath, reason });
    else diagnostics.push({ at: entry.resPath ?? entry.relativePath, message: `${entry.kind} input has no source translation, asset copy, or conversion plan` });
  }
  return { diagnostics, unplanned };
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
      project.documents.licenses,
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
  const closure = validateInputClosure(project, composition, sceneModules);
  const diagnostics = [
    ...closure.diagnostics,
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
      unplannedInputs: closure.unplanned,
      deviations: [],
    },
  };
}
