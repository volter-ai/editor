/**
 * The source questions the kit asks of a source-authoring integration on the server, answered
 * by whichever composed package's `vgai.serving` module provides them
 * (`@volter/editor-sdk/session/project-serving`). With none composed, a source proves no dialect
 * and carries no authoring diagnostics: a product with no such integration authors no JSX.
 */

import type {
  R3fAuthoringDiagnostic,
  SourceDialectEvidence,
} from '@volter/editor-sdk/source-authoring';
import { registerComponentContractAnalyzer } from '@volter/editor-sdk/source-analysis';
import type { ProjectServingModule } from '@volter/editor-sdk/session/project-serving';

const NO_EVIDENCE: SourceDialectEvidence = { reconcilerImport: false, r3fOnlyTags: [], domOnlyTags: [] };

let dialectReader: ProjectServingModule['sourceDialectEvidence'] | null = null;
let diagnosticsReader: ProjectServingModule['sourceDiagnostics'] | null = null;

/** Take the answers a loaded serving module provides. */
export function adoptSourceAnalysis(module: Partial<ProjectServingModule>): void {
  if (module.sourceDialectEvidence) dialectReader = module.sourceDialectEvidence;
  if (module.sourceDiagnostics) diagnosticsReader = module.sourceDiagnostics;
  if (module.componentContracts) registerComponentContractAnalyzer(module.componentContracts);
}

export function sourceDialectEvidence(code: string): SourceDialectEvidence {
  return dialectReader?.(code) ?? NO_EVIDENCE;
}

/** Whether the evidence proves the three.js reconciler renders this source. */
export function sourceProvesR3f(evidence: SourceDialectEvidence): boolean {
  return evidence.reconcilerImport || evidence.r3fOnlyTags.length > 0;
}

export function sourceAuthoringDiagnostics(
  code: string,
  file: string,
  options: { knownThreeSurface: boolean },
): readonly R3fAuthoringDiagnostic[] {
  return diagnosticsReader?.(code, file, options) ?? [];
}
