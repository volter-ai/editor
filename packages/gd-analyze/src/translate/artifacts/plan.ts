import { godotImportedModelDataPath } from '../data/scene-document-plan';
import { createHash } from 'node:crypto';
import type { CapabilityCopyArtifact } from '../../snapshot/toolchain-snapshot';
import type { OfficialBoundCodePlan } from '../code/lower-official-bound';
import type { DirectGodotProjectCompositionPlan } from '../data/direct-project-composition-plan';
import type { DirectGodotProjectDataPlan, DirectJsonValue } from '../data/direct-project-data-plan';
import {
  DIRECT_GODOT_INPUT_MAP_PATH,
  DIRECT_GODOT_SETTINGS_PATH,
  directGodotInputMapJson,
  directGodotSettingsJson,
} from '../emit/direct-project-world-syntax';
import type { DirectGodotSceneModulePlan } from '../data/direct-scene-module-plan';
import { godotAnimationLibraryDataPath, godotAnimationTreeDataPath } from '../data/scene-animation';
import {
  godotArrayMeshData,
  godotArrayMeshDataPath,
  godotGridMapDataPath,
  godotMeshLibraryData,
  godotMeshLibraryDataPath,
} from '../data/scene-families';
import { assetCopyArtifact } from './asset-copy';
import { capabilityCopyArtifact } from './capability-copy';
import { plannedArtifactIdentity, structuralDigest } from './identity';
import {
  projectDataBytesArtifact,
  projectDataGeneratedModuleArtifact,
  projectDataJsonArtifact,
} from './project-data';
import { sourceTranslationArtifact } from './source-translation';
import type { GodotPlannedArtifact } from './types';

function sourceArtifacts(
  composition: DirectGodotProjectCompositionPlan,
  code: OfficialBoundCodePlan,
  scenes: DirectGodotSceneModulePlan,
): readonly GodotPlannedArtifact[] {
  const codeSyntax: Map<string, OfficialBoundCodePlan['sourceFiles'][number]> = new Map(
    code.sourceFiles.map((syntax) => [`src/scripts/${syntax.sourcePath}`, syntax] as const),
  );
  if (codeSyntax.size !== code.sourceFiles.length) {
    throw new Error('accepted code plan repeats a target syntax path');
  }
  const plannedCode = composition.sourceModules.map((module) => {
    const syntax = codeSyntax.get(module.targetPath);
    if (syntax === undefined) {
      throw new Error(`${module.sourceResPath}: accepted code plan has no ${module.targetPath}`);
    }
    codeSyntax.delete(module.targetPath);
    return sourceTranslationArtifact(
      module.targetPath,
      {
        kind: 'code-module',
        syntaxSourcePath: syntax.sourcePath,
        inputDigest: structuralDigest(syntax),
      },
      {
        kind: 'source-translation',
        sourcePath: module.sourceResPath,
        sourceDigest: module.sourceDigest,
      },
    );
  });
  if (codeSyntax.size > 0) {
    throw new Error(`${[...codeSyntax.keys()][0]}: target syntax has no source-module plan`);
  }
  const compositionScenes = new Map(
    composition.scenes.map((scene) => [scene.sourceResPath, scene] as const),
  );
  if (compositionScenes.size !== composition.scenes.length) {
    throw new Error('accepted composition repeats a scene source path');
  }
  const plannedScenes = scenes.modules.map((module) => {
    const scene = compositionScenes.get(module.sourceResPath);
    if (
      scene === undefined ||
      scene.sourceDigest !== module.sourceDigest ||
      scene.targetPath !== module.targetPath
    ) {
      throw new Error(`${module.sourceResPath}: accepted scene-module plan is inconsistent`);
    }
    compositionScenes.delete(module.sourceResPath);
    return sourceTranslationArtifact(
      module.targetPath,
      {
        kind: 'scene-module',
        sceneResPath: module.sourceResPath,
        inputDigest: structuralDigest(scene),
      },
      {
        kind: 'source-translation',
        sourcePath: module.sourceResPath,
        sourceDigest: module.sourceDigest,
      },
    );
  });
  if (compositionScenes.size > 0) {
    throw new Error(`${[...compositionScenes.keys()][0]}: accepted scene has no module plan`);
  }
  return [...plannedCode, ...plannedScenes];
}

/** Each imported model's data file (the importer's tree), once however many scenes instance it. */
function modelDataArtifacts(composition: DirectGodotProjectCompositionPlan): readonly GodotPlannedArtifact[] {
  const written = new Map<string, GodotPlannedArtifact>();
  const visit = (scene: DirectGodotProjectCompositionPlan['scenes'][number], node: DirectGodotProjectCompositionPlan['scenes'][number]['root']): void => {
    if (node.model !== undefined) {
      const file = godotImportedModelDataPath(node.model.sourceResPath);
      if (!written.has(file)) {
        written.set(
          file,
          projectDataJsonArtifact(file, { rootClasses: node.model.rootClasses, nodes: node.model.nodes } as unknown as DirectJsonValue, [scene.sourceResPath]),
        );
      }
    }
    for (const child of node.children) visit(scene, child);
    for (const placed of node.placements ?? []) visit(scene, placed.node);
  };
  for (const scene of composition.scenes) visit(scene, scene.root);
  return [...written.values()];
}

/** Each `ArrayMesh`'s, `MeshLibrary`'s and `AnimationLibrary`'s data file, once however many scenes use it, and each GridMap's cells. */
function meshDataArtifacts(composition: DirectGodotProjectCompositionPlan): readonly GodotPlannedArtifact[] {
  const written = new Map<string, GodotPlannedArtifact>();
  for (const scene of composition.scenes) {
    const resources = new Map(scene.resources.map((resource) => [resource.key, resource] as const));
    for (const resource of scene.resources) {
      if (resource.mesh !== undefined) {
        const file = godotArrayMeshDataPath(scene.targetPath, resource.key);
        if (!written.has(file)) written.set(file, projectDataJsonArtifact(file, godotArrayMeshData(resource.mesh) as unknown as DirectJsonValue, [scene.sourceResPath]));
      }
      if (resource.animationTree !== undefined) {
        const file = godotAnimationTreeDataPath(scene.targetPath, resource.key);
        if (!written.has(file)) written.set(file, projectDataJsonArtifact(file, resource.animationTree as unknown as DirectJsonValue, [scene.sourceResPath]));
      }
      if (resource.animations !== undefined) {
        const file = godotAnimationLibraryDataPath(scene.targetPath, resource.key);
        if (!written.has(file)) written.set(file, projectDataJsonArtifact(file, resource.animations as unknown as DirectJsonValue, [scene.sourceResPath]));
      }
      if (resource.library !== undefined) {
        const file = godotMeshLibraryDataPath(scene.targetPath, resource.key);
        if (!written.has(file)) written.set(file, projectDataJsonArtifact(file, godotMeshLibraryData(resource.library, resources) as DirectJsonValue, [scene.sourceResPath]));
      }
    }
    // A GridMap's cells, as written (a node's own `data`, or an instance's override of it).
    const walk = (node: DirectGodotProjectCompositionPlan['scenes'][number]['root']): void => {
      for (const setter of node.setters) {
        if (setter.setter.exportName !== 'godot_grid_map_set_data' || setter.value.kind !== 'PackedInt32Array') continue;
        const file = godotGridMapDataPath(scene.targetPath, node.nodePath);
        written.set(file, projectDataJsonArtifact(file, [...setter.value.components], [scene.sourceResPath]));
      }
      for (const child of [...node.children, ...(node.placements ?? []).map((placed) => placed.node)]) walk(child);
    };
    walk(scene.root);
  }
  return [...written.values()];
}

function projectArtifacts(
  plan: DirectGodotProjectDataPlan,
  composition: DirectGodotProjectCompositionPlan,
): readonly GodotPlannedArtifact[] {
  const sourcePaths = plan.worldModule.sourcePaths;
  return [
    projectDataGeneratedModuleArtifact(
      plan.worldModule.targetPath,
      'world',
      structuralDigest({ composition, module: plan.worldModule }),
      sourcePaths,
    ),
    projectDataJsonArtifact(DIRECT_GODOT_SETTINGS_PATH, directGodotSettingsJson(composition) as DirectJsonValue, sourcePaths),
    projectDataJsonArtifact(DIRECT_GODOT_INPUT_MAP_PATH, directGodotInputMapJson(composition) as DirectJsonValue, sourcePaths),
    ...meshDataArtifacts(composition),
    ...modelDataArtifacts(composition),
    projectDataJsonArtifact('vgai.project.json', plan.manifest, sourcePaths),
    projectDataJsonArtifact('package.json', plan.packageManifest, sourcePaths),
    projectDataJsonArtifact('package-lock.json', plan.packageLock, sourcePaths),
    ...plan.capabilityStamps.map((stamp) =>
      projectDataJsonArtifact(stamp.targetPath, stamp.value, [], [stamp.toolchainSource]),
    ),
    ...plan.shellFiles.map((file) =>
      file.kind === 'generated-target-ts'
        ? projectDataGeneratedModuleArtifact(
            file.targetPath,
            file.module,
            structuralDigest(file),
            file.sourcePaths,
          )
        : projectDataBytesArtifact(file.targetPath, file.bytes, file.sourcePaths),
    ),
  ];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifactPaths(artifact: GodotPlannedArtifact): readonly string[] {
  return 'sourceMapPath' in artifact ? [artifact.path, artifact.sourceMapPath] : [artifact.path];
}

function finalBinaryBytes(artifact: GodotPlannedArtifact): Uint8Array | undefined {
  if (artifact.kind === 'project-data') {
    return artifact.content.kind === 'bytes' ? artifact.content.bytes : undefined;
  }
  return artifact.kind === 'asset-copy' || artifact.kind === 'capability-copy'
    ? artifact.bytes
    : undefined;
}

function artifactPayloadDigest(artifact: GodotPlannedArtifact): string {
  if (artifact.kind === 'source-translation') return structuralDigest(artifact.emission);
  if (artifact.kind !== 'project-data') return artifact.digest;
  switch (artifact.content.kind) {
    case 'generated-target-ts':
      return structuralDigest({
        module: artifact.content.module,
        inputDigest: artifact.content.inputDigest,
      });
    case 'json':
      return structuralDigest(artifact.content.value);
    case 'bytes':
      return sha256(artifact.content.bytes);
  }
}

function validateArtifact(artifact: GodotPlannedArtifact, paths: Set<string>): void {
  for (const path of artifactPaths(artifact)) {
    if (paths.has(path)) throw new Error(`${path}: artifact has two origins`);
    paths.add(path);
  }
  const binary = finalBinaryBytes(artifact);
  if (binary !== undefined && 'digest' in artifact && sha256(binary) !== artifact.digest) {
    throw new Error(`${artifact.path}: planned final bytes do not match their digest`);
  }
  const payloadDigest = artifactPayloadDigest(artifact);
  const sourceMapPath = 'sourceMapPath' in artifact ? artifact.sourceMapPath : undefined;
  const expectedIdentity = plannedArtifactIdentity(
    artifact.kind,
    artifact.path,
    sourceMapPath,
    payloadDigest,
    artifact.origin,
  );
  if (expectedIdentity !== artifact.planIdentity) {
    throw new Error(`${artifact.path}: planned artifact identity changed before acceptance`);
  }
}

/** Close every output descriptor and every already-final opaque byte before acceptance. */
export function planDirectGodotArtifacts(
  composition: DirectGodotProjectCompositionPlan,
  code: OfficialBoundCodePlan,
  scenes: DirectGodotSceneModulePlan,
  project: DirectGodotProjectDataPlan,
  capabilities: readonly CapabilityCopyArtifact[],
  models: readonly { readonly resPath: string; readonly sourceDigest: string; readonly bytes: Uint8Array }[] = [],
): readonly GodotPlannedArtifact[] {
  const artifacts = [
    ...sourceArtifacts(composition, code, scenes),
    ...projectArtifacts(project, composition),
    ...capabilities.map(capabilityCopyArtifact),
    ...models.map((model) => assetCopyArtifact(model.resPath, model.sourceDigest, model.bytes)),
  ];
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    validateArtifact(artifact, paths);
  }
  return artifacts;
}
