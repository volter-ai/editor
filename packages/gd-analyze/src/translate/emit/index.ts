import { createHash } from 'node:crypto';
import { structuralDigest } from '../artifacts/identity';
import type {
  GodotArtifactOrigin,
  GodotEmittedArtifact,
  GodotPlannedArtifact,
  GodotProjectDataOrigin,
  GodotSourceTranslationOrigin,
} from '../artifacts/types';
import type { TargetTsSourceFile } from '../code/target-ts-syntax';
import type { GodotAcceptedTranslation, GodotTranslationPlan } from '../translation-plan';
import { directMainSyntax, directViteConfigSyntax } from './direct-project-shell-syntax';
import { emitDirectGodotWorldSyntax } from './direct-project-world-syntax';
import { emitDirectGodotSceneSyntax } from './direct-scene-syntax';
import { emitTargetTsSourceFile } from './target-ts-printer';

export type GodotOutputArtifact = GodotEmittedArtifact;

const emittedArtifactSetBrand: unique symbol = Symbol('GodotEmittedArtifactSet');

/** A complete emitted set can only be constructed by the accepted-plan emitter below. */
export interface GodotEmittedArtifactSet {
  readonly artifacts: readonly GodotOutputArtifact[];
  readonly acceptedPlan: GodotTranslationPlan;
  readonly [emittedArtifactSetBrand]: true;
}

function emitted(
  kind: GodotPlannedArtifact['kind'],
  path: string,
  bytes: Uint8Array,
  origin: GodotArtifactOrigin,
  planIdentity: string,
  role: GodotEmittedArtifact['role'] = 'primary',
): GodotEmittedArtifact {
  return {
    kind,
    path,
    bytes,
    digest: createHash('sha256').update(bytes).digest('hex'),
    origin,
    role,
    planIdentity,
  };
}

function emitSyntax(
  kind: GodotPlannedArtifact['kind'],
  path: string,
  sourceMapPath: string,
  syntax: Parameters<typeof emitTargetTsSourceFile>[0],
  origin: GodotSourceTranslationOrigin | GodotProjectDataOrigin,
  planIdentity: string,
): readonly GodotEmittedArtifact[] {
  const sourcePaths = 'sourcePath' in origin ? [origin.sourcePath] : origin.sourcePaths;
  const result = emitTargetTsSourceFile(syntax, path, sourceMapPath, sourcePaths);
  return [
    emitted(kind, path, Buffer.from(result.text, 'utf8'), origin, planIdentity),
    emitted(
      kind,
      sourceMapPath,
      Buffer.from(result.sourceMap, 'utf8'),
      origin,
      planIdentity,
      'source-map',
    ),
  ];
}

interface EmissionContext {
  readonly plan: GodotTranslationPlan;
  readonly codeSyntax: Map<string, TargetTsSourceFile>;
  readonly sceneSyntax: Map<string, ReturnType<typeof emitDirectGodotSceneSyntax>[number]>;
  readonly sceneInputs: Map<string, GodotTranslationPlan['composition']['scenes'][number]>;
  readonly projectModules: Map<'world' | 'main' | 'vite-config', string>;
}

function sourceSyntax(
  artifact: Extract<GodotPlannedArtifact, { readonly kind: 'source-translation' }>,
  context: EmissionContext,
): TargetTsSourceFile {
  switch (artifact.emission.kind) {
    case 'code-module': {
      const syntax = context.codeSyntax.get(artifact.emission.syntaxSourcePath);
      if (
        syntax === undefined ||
        artifact.path !== `src/scripts/${syntax.sourcePath}` ||
        structuralDigest(syntax) !== artifact.emission.inputDigest
      ) {
        throw new Error(`${artifact.path}: accepted code syntax changed before emission`);
      }
      context.codeSyntax.delete(artifact.emission.syntaxSourcePath);
      return syntax;
    }
    case 'scene-module': {
      const module = context.sceneSyntax.get(artifact.emission.sceneResPath);
      const scene = context.sceneInputs.get(artifact.emission.sceneResPath);
      if (
        module === undefined ||
        scene === undefined ||
        module.targetPath !== artifact.path ||
        structuralDigest(scene) !== artifact.emission.inputDigest
      ) {
        throw new Error(`${artifact.path}: accepted scene plan changed before emission`);
      }
      context.sceneSyntax.delete(artifact.emission.sceneResPath);
      context.sceneInputs.delete(artifact.emission.sceneResPath);
      return module.syntax;
    }
  }
}

function projectSyntax(
  artifact: Extract<GodotPlannedArtifact, { readonly kind: 'project-data' }> & {
    readonly content: { readonly kind: 'generated-target-ts' };
  },
  context: EmissionContext,
): TargetTsSourceFile {
  const module = artifact.content.module;
  const expectedPath = context.projectModules.get(module);
  if (expectedPath !== artifact.path) {
    throw new Error(`${artifact.path}: ${module} project module is absent from the accepted plan`);
  }
  let actualInputDigest: string;
  let syntax: TargetTsSourceFile;
  switch (module) {
    case 'world':
      actualInputDigest = structuralDigest({
        composition: context.plan.composition,
        module: context.plan.projectData.worldModule,
      });
      syntax = emitDirectGodotWorldSyntax(context.plan.composition);
      break;
    case 'main':
    case 'vite-config': {
      const shell = context.plan.projectData.shellFiles.find(
        (file) => file.kind === 'generated-target-ts' && file.module === module,
      );
      if (shell === undefined || shell.targetPath !== artifact.path) {
        throw new Error(`${artifact.path}: accepted ${module} shell plan is inconsistent`);
      }
      actualInputDigest = structuralDigest(shell);
      syntax = module === 'main' ? directMainSyntax() : directViteConfigSyntax();
      break;
    }
  }
  if (actualInputDigest !== artifact.content.inputDigest) {
    throw new Error(`${artifact.path}: accepted ${module} input changed before emission`);
  }
  context.projectModules.delete(module);
  return syntax;
}

function emitArtifact(
  artifact: GodotPlannedArtifact,
  context: EmissionContext,
): readonly GodotEmittedArtifact[] {
  switch (artifact.kind) {
    case 'source-translation':
      return emitSyntax(
        artifact.kind,
        artifact.path,
        artifact.sourceMapPath,
        sourceSyntax(artifact, context),
        artifact.origin,
        artifact.planIdentity,
      );
    case 'project-data':
      switch (artifact.content.kind) {
        case 'generated-target-ts':
          if (!('sourceMapPath' in artifact)) {
            throw new Error(`${artifact.path}: TypeScript project data has no source-map path`);
          }
          return emitSyntax(
            artifact.kind,
            artifact.path,
            artifact.sourceMapPath,
            projectSyntax(artifact, context),
            artifact.origin,
            artifact.planIdentity,
          );
        case 'json':
          return [
            emitted(
              artifact.kind,
              artifact.path,
              Buffer.from(`${JSON.stringify(artifact.content.value, null, 2)}\n`, 'utf8'),
              artifact.origin,
              artifact.planIdentity,
            ),
          ];
        case 'bytes': {
          if (!('digest' in artifact)) {
            throw new Error(`${artifact.path}: planned opaque bytes have no digest`);
          }
          const result = emitted(
            artifact.kind,
            artifact.path,
            artifact.content.bytes,
            artifact.origin,
            artifact.planIdentity,
          );
          if (result.digest !== artifact.digest) {
            throw new Error(`${artifact.path}: planned final bytes changed before emission`);
          }
          return [result];
        }
      }
      throw new Error(`${artifact.path}: unhandled project-data content`);
    case 'asset-copy':
    case 'capability-copy': {
      const result = emitted(
        artifact.kind,
        artifact.path,
        artifact.bytes,
        artifact.origin,
        artifact.planIdentity,
      );
      if (result.digest !== artifact.digest) {
        throw new Error(`${artifact.path}: planned final bytes changed before emission`);
      }
      return [result];
    }
  }
}

/** One mechanical emission door; only a complete accepted translation can reach it. */
export function emitGodotTranslation(accepted: GodotAcceptedTranslation): GodotEmittedArtifactSet {
  const codeSyntax = new Map(
    accepted.plan.code.sourceFiles.map((syntax) => [syntax.sourcePath, syntax] as const),
  );
  if (codeSyntax.size !== accepted.plan.code.sourceFiles.length) {
    throw new Error('accepted code plan repeats a syntax source path');
  }
  const emittedScenes = emitDirectGodotSceneSyntax(
    accepted.plan.composition,
    accepted.plan.sceneModules,
  );
  const sceneSyntax = new Map(
    emittedScenes.map((module) => [module.sourceResPath, module] as const),
  );
  if (sceneSyntax.size !== emittedScenes.length) {
    throw new Error('accepted scene-module plan repeats a scene source path');
  }
  const sceneInputs = new Map(
    accepted.plan.composition.scenes.map((scene) => [scene.sourceResPath, scene] as const),
  );
  if (sceneInputs.size !== accepted.plan.composition.scenes.length) {
    throw new Error('accepted composition repeats a scene source path');
  }
  const projectModuleRows = [
    ['world', accepted.plan.projectData.worldModule.targetPath],
    ...accepted.plan.projectData.shellFiles.flatMap((file) =>
      file.kind === 'generated-target-ts' ? [[file.module, file.targetPath] as const] : [],
    ),
  ] as const;
  const projectModules = new Map(projectModuleRows);
  if (projectModules.size !== projectModuleRows.length) {
    throw new Error('accepted project data repeats a generated module');
  }
  const context: EmissionContext = {
    plan: accepted.plan,
    codeSyntax,
    sceneSyntax,
    sceneInputs,
    projectModules,
  };
  const artifacts = accepted.plan.artifacts.flatMap((artifact) => emitArtifact(artifact, context));
  if (
    codeSyntax.size > 0 ||
    sceneSyntax.size > 0 ||
    sceneInputs.size > 0 ||
    projectModules.size > 0
  ) {
    throw new Error('accepted generated modules are absent from the artifact plan');
  }
  return {
    artifacts,
    acceptedPlan: accepted.plan,
    [emittedArtifactSetBrand]: true,
  };
}
