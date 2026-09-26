/**
 * The one Godot import operation: a Godot project directory and an output directory in, a complete
 * standalone vgai app out.
 *
 * The output is built in a sibling temporary directory and promoted only after every acceptance
 * seam succeeds. A destination that already exists is user-owned and is never replaced; re-import
 * chooses a new destination. There are no per-game file lists and no hand-completion files.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { type BoundGodotProject, bindGodotProject } from './analyze/bound-project';
import { measuringEvidenceActive } from './godot-frontend/implementation-liveness';
import { captureGodotBoundProgramFromSnapshot } from './godot-frontend/run-bound-program';
import {
  promoteGodotTranslation,
  restoreGodotTranslationArtifacts,
  writeGodotTranslationArtifacts,
} from './materialize';
import { readGodotProjectSnapshot } from './read/godot-project';
import { bindGodotResources } from './read/resource-program';
import {
  captureGodotProjectSnapshot,
  materializeGodotProjectSnapshot,
} from './snapshot/project-snapshot';
import {
  captureGodotImportToolchainSnapshot,
  type GodotImportToolchainSnapshot,
} from './snapshot/toolchain-snapshot';
import { emitGodotTranslation } from './translate/emit';
import { planGodotTranslation } from './translate/plan';

/** The emitted project's own acceptance: its install, its typecheck and its `vite build`. */
function runAcceptance(projectDir: string): void {
  const commands: readonly [string, readonly string[]][] = [
    ['npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['run', 'build']],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, [...args], { cwd: projectDir, stdio: 'inherit' });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(' ')} failed with exit ${String(result.status)}`);
    }
  }
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

/**
 * A failed import keeps its staging directory, the evidence of the failure: its install and
 * whatever its typecheck or build left. Every candidate is created by this invocation through
 * `mkdtemp`, so import never deletes a directory that could belong to the user; a successful
 * candidate is consumed by renaming it onto the target.
 */
function reportKeptStaging(stagingDir: string, error: unknown): void {
  const lines: string[] = [
    '',
    'godot import FAILED — the staging directory is KEPT so its evidence survives:',
    `  ${stagingDir}`,
    `  reason: ${error instanceof Error ? error.message : String(error)}`,
    '  remove this evidence directory explicitly after diagnosing the failure.',
    '',
  ];
  process.stderr.write(`${lines.join('\n')}\n`);
}

export interface ImportGodotProjectOptions {
  /** Pinned source-built Godot executable carrying the bound-program exporter module. */
  readonly boundExporterBinary: string;
  readonly officialBinary: string;
}

function importCapturedGodotProject(
  sourceArg: string,
  targetArg: string,
  boundProject: BoundGodotProject,
  toolchain: GodotImportToolchainSnapshot,
): void {
  if (measuringEvidenceActive()) {
    throw new Error('import refuses to run while evidence is being measured');
  }
  const sourceDir = path.resolve(sourceArg);
  const targetDir = path.resolve(targetArg);
  if (!existsSync(path.join(sourceDir, 'project.godot'))) {
    throw new Error(`${sourceDir} is not a Godot project: project.godot is missing`);
  }
  if (isWithin(sourceDir, targetDir) || isWithin(targetDir, sourceDir)) {
    throw new Error(
      'source and target must be separate directories; neither may contain the other',
    );
  }
  if (existsSync(targetDir)) {
    throw new Error(
      `${targetDir} already exists; a translated project is user-owned and import never replaces it. ` +
        'Choose a new destination.',
    );
  }

  const translation = planGodotTranslation(boundProject, toolchain);
  if (translation.kind === 'refused-translation') {
    throw new Error(
      translation.diagnostics
        .map((diagnostic) => `${diagnostic.at}: ${diagnostic.message}`)
        .join('\n'),
    );
  }
  const emitted = emitGodotTranslation(translation);
  const parentDir = path.dirname(targetDir);
  mkdirSync(parentDir, { recursive: true });
  // This invocation creates and therefore owns the complete candidate, named after the target;
  // the unpredictable suffix prevents collision with any user-owned directory.
  const stagingDir = mkdtempSync(path.join(parentDir, `${path.basename(targetDir)}-godot-import-`));
  try {
    // Materialization begins from an importer-owned empty directory. Every prospective file is
    // already present in the accepted artifact plan; this phase can only write and verify it.
    writeGodotTranslationArtifacts(emitted, stagingDir);
    runAcceptance(stagingDir);
    restoreGodotTranslationArtifacts(emitted.artifacts, stagingDir);
    promoteGodotTranslation(stagingDir, targetDir);
  } catch (error) {
    // EVIDENCE BEFORE CLEANUP — and the staging directory is not cleaned up at all. See
    // {@link reportKeptStaging} for the disk lifecycle that makes keeping it free of accumulation.
    reportKeptStaging(stagingDir, error);
    throw error;
  }
}

export function importGodotProject(
  sourceArg: string,
  targetArg: string,
  options: ImportGodotProjectOptions,
): void {
  const sourceDir = path.resolve(sourceArg);
  const targetDir = path.resolve(targetArg);
  if (isWithin(sourceDir, targetDir) || isWithin(targetDir, sourceDir)) {
    throw new Error(
      'source and target must be separate directories; neither may contain the other',
    );
  }
  if (existsSync(targetDir)) {
    throw new Error(
      `${targetDir} already exists; a translated project is user-owned and import never replaces it. ` +
        'Choose a new destination.',
    );
  }
  const snapshot = captureGodotProjectSnapshot(sourceDir);
  const toolchain = captureGodotImportToolchainSnapshot({
    projectEngine: snapshot.engine,
    boundExporterBinary: options.boundExporterBinary,
    officialBinary: options.officialBinary,
  });
  const snapshotTemp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-project-snapshot-'));
  const capturedProjectDir = path.join(snapshotTemp, 'project');
  try {
    materializeGodotProjectSnapshot(snapshot, capturedProjectDir);
    // Only the disposable directory regains owner write permission. Captured project files stay
    // read-only, while the official frontend can add its captured script and import cache beside
    // them without changing a source byte or its content-addressed identity.
    chmodSync(capturedProjectDir, 0o755);
    const boundProgram = captureGodotBoundProgramFromSnapshot({
      exporter: toolchain.frontend.exporter,
      importer: toolchain.frontend.importer,
      projectDir: capturedProjectDir,
    });
    const decodedProject = readGodotProjectSnapshot(snapshot, toolchain.frontend.readAuthority);
    const boundProject = bindGodotProject(
      snapshot,
      boundProgram,
      bindGodotResources(decodedProject, toolchain.frontend.readAuthority),
      toolchain.frontend.analysisAuthority,
      toolchain.frontend.authority,
      toolchain.frontend.apiDump,
      decodedProject,
    );
    importCapturedGodotProject(sourceDir, targetDir, boundProject, toolchain);
  } finally {
    if (existsSync(capturedProjectDir)) chmodSync(capturedProjectDir, 0o755);
    rmSync(snapshotTemp, { recursive: true, force: true });
  }
}
