import { createHash } from 'node:crypto';
import type { BoundGodotProject } from '../analyze/bound-project';
import type { GodotImportToolchainSnapshot } from '../snapshot/toolchain-snapshot';
import { lowerOfficialBoundProgram } from './code/lower-official-bound';
import {
  type DirectGodotCompositionDiagnostic,
  planDirectGodotProjectComposition,
} from './data/direct-project-composition-plan';
import { planDirectGodotProjectData } from './data/direct-project-data-plan';
import { planDirectGodotSceneModules } from './data/direct-scene-module-plan';
import { planGodotSceneDocuments } from './data/scene-document-plan';
import { planScriptFieldInitializations } from './data/script-field-initialization-plan';
import { assembleGodotTranslationPlan, type GodotTranslationResult } from './translation-plan';

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateInputs(
  project: BoundGodotProject,
  toolchain: GodotImportToolchainSnapshot,
): readonly DirectGodotCompositionDiagnostic[] {
  const frontend = toolchain.frontend;
  const diagnostics: DirectGodotCompositionDiagnostic[] = [];
  if (JSON.stringify(project.authority) !== JSON.stringify(frontend.authority)) {
    diagnostics.push({
      at: 'project.godot',
      message: 'bound project and immutable toolchain select different source authorities',
    });
  }
  const authorityDigests = [
    ['code', frontend.codeAuthority, frontend.codeAuthorityDigest],
    ['field-value', frontend.fieldValueAuthority, frontend.fieldValueAuthorityDigest],
    ['scene-node', frontend.sceneNodeAuthority, frontend.sceneNodeAuthorityDigest],
    ['lifecycle', frontend.lifecycleAuthority, frontend.lifecycleAuthorityDigest],
  ] as const;
  for (const [name, authority, expected] of authorityDigests) {
    if (sha256(authority) !== expected) {
      diagnostics.push({
        at: 'toolchain-snapshot',
        message: `${name} translation authority changed after capture`,
      });
    }
  }
  return diagnostics;
}

/**
 * The one pure direct-planning door from immutable bound meaning to accepted composition.
 *
 * Every subsidiary planner runs before refusal so the caller receives the complete source-located
 * wall set. No partial plan escapes and no filesystem, frontend, emitter or materializer is called.
 */
export function planGodotTranslation(
  project: BoundGodotProject,
  toolchain: GodotImportToolchainSnapshot,
): GodotTranslationResult {
  const diagnostics = [...validateInputs(project, toolchain)];
  if (diagnostics.length > 0) return { kind: 'refused-translation', diagnostics };
  const code = lowerOfficialBoundProgram(project, toolchain.frontend.codeAuthority);
  const fields = planScriptFieldInitializations(project, toolchain.frontend.fieldValueAuthority);
  const scenes = planGodotSceneDocuments(project, toolchain.frontend.sceneNodeAuthority);
  if (code.kind === 'refused-code') {
    diagnostics.push(
      ...code.diagnostics.map((entry) => ({
        at: `${entry.sourcePath}:${entry.startLine}:${entry.startColumn}`,
        message: entry.message,
      })),
    );
  }
  if (fields.kind === 'refused-field-initializations') {
    diagnostics.push(
      ...fields.diagnostics.map((entry) => ({
        at: `${entry.documentPath}#${entry.nodePath}.${entry.fieldName}`,
        message: entry.message,
      })),
    );
  }
  if (scenes.kind === 'refused-scene-documents') diagnostics.push(...scenes.diagnostics);
  if (
    diagnostics.length > 0 ||
    code.kind !== 'accepted-code' ||
    fields.kind !== 'accepted-field-initializations' ||
    scenes.kind !== 'accepted-scene-documents'
  ) {
    return { kind: 'refused-translation', diagnostics };
  }
  const composition = planDirectGodotProjectComposition(
    project,
    code.plan,
    fields.plan,
    scenes.plan,
  );
  if (composition.kind === 'refused-composition') {
    return { kind: 'refused-translation', diagnostics: composition.diagnostics };
  }
  const sceneModules = planDirectGodotSceneModules(
    composition.plan,
    toolchain.frontend.lifecycleAuthority,
  );
  if (sceneModules.kind === 'refused-scene-modules') {
    return { kind: 'refused-translation', diagnostics: sceneModules.diagnostics };
  }
  const projectData = planDirectGodotProjectData(project, composition.plan, toolchain);
  if (projectData.kind === 'refused-project-data') {
    return { kind: 'refused-translation', diagnostics: projectData.diagnostics };
  }
  return assembleGodotTranslationPlan(
    project,
    toolchain,
    code.plan,
    composition.plan,
    sceneModules.plan,
    projectData.plan,
  );
}
