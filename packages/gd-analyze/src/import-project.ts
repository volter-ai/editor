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
  readdirSync,
  readFileSync,
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

function runAcceptance(projectDir: string): void {
  const commands: readonly [string, readonly string[]][] = [
    ['npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['run', 'validate']],
    ['npm', ['run', 'build']],
    ['npm', ['run', 'vgai', '--', 'doctor', '.']],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, [...args], { cwd: projectDir, stdio: 'inherit' });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(' ')} failed with exit ${String(result.status)}`);
    }
  }
  assertQuietDoctor(projectDir);
}

function assertQuietDoctor(projectDir: string): void {
  const doctorRoot = path.join(projectDir, '.vgai', 'doctor');
  const reports = readdirSync(doctorRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const latest = reports.at(-1);
  if (latest === undefined) {
    throw new Error(`Doctor produced no report under ${doctorRoot}`);
  }
  const loudnessPath = path.join(doctorRoot, latest, '07-loudness.txt');
  if (!existsSync(loudnessPath)) {
    throw new Error(`Doctor report is incomplete: ${loudnessPath} is missing`);
  }
  const loudness = readFileSync(loudnessPath, 'utf8');
  const consoleLine = /^unresolvedConsole: (\{.*\})$/m.exec(loudness)?.[1];
  const brokenText = /^ontology invariants: \d+ rows, (\d+) broken$/m.exec(loudness)?.[1];
  if (consoleLine === undefined || brokenText === undefined) {
    throw new Error(`Doctor report has an unrecognized loudness sheet: ${loudnessPath}`);
  }
  const unresolved = JSON.parse(consoleLine) as { errors?: unknown; warnings?: unknown };
  const errors = unresolved.errors;
  const warnings = unresolved.warnings;
  const broken = Number.parseInt(brokenText, 10);
  if (
    typeof errors !== 'number' ||
    typeof warnings !== 'number' ||
    errors !== 0 ||
    warnings !== 0 ||
    broken !== 0
  ) {
    const conditionsAt = loudness.indexOf('\n---');
    const conditions = conditionsAt < 0 ? '' : loudness.slice(conditionsAt);
    throw new Error(
      `Doctor is not quiet: ${String(errors)} error(s), ${String(warnings)} warning(s), ` +
        `${String(broken)} broken ontology invariant(s); see ${loudnessPath}` +
        conditions,
    );
  }
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

/**
 * WHAT A FAILED IMPORT LEAVES BEHIND, and why it leaves anything at all.
 *
 * The staging directory IS the evidence. By the time an acceptance seam fails it holds a completed
 * `npm install`, a built `dist/`, and — for the seam that fails most often — Doctor's contact sheet:
 * the PNG pair the static-invariant phase compared, the loudness sheet, the phase table's artifacts.
 * Deleting it on the way out destroyed exactly the thing that explains the failure, and the only way
 * to get it back was to re-run the whole cycle by hand against a staging directory of one's own.
 * That workaround was needed twice in one day (2026-08-20); the loud-failure doctrine says the tool
 * prints what it knows and keeps what it has instead.
 *
 * DISK LIFECYCLE — a failed candidate is deliberately retained and its exact path is reported.
 * Every candidate is created by this invocation through `mkdtemp`, so import never guesses at or
 * deletes a pre-existing sibling that could belong to the user. A successful candidate is consumed
 * by RENAMING it onto the target.
 */
function reportKeptStaging(stagingDir: string, error: unknown): void {
  const lines: string[] = [
    '',
    'godot import FAILED — the staging directory is KEPT so its evidence survives:',
    `  ${stagingDir}`,
    `  reason: ${error instanceof Error ? error.message : String(error)}`,
  ];
  const doctorRoot = path.join(stagingDir, '.vgai', 'doctor');
  const latest = existsSync(doctorRoot)
    ? readdirSync(doctorRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .at(-1)
    : undefined;
  if (latest === undefined) {
    lines.push('  doctor: no report was written (the run failed before Doctor produced one).');
  } else {
    const reportDir = path.join(doctorRoot, latest);
    lines.push(`  doctor contact sheet: ${reportDir}`);
    for (const entry of readdirSync(reportDir).sort()) lines.push(`    ${entry}`);
    const loudnessPath = path.join(reportDir, '07-loudness.txt');
    if (existsSync(loudnessPath)) {
      lines.push('  loudness sheet:');
      for (const line of readFileSync(loudnessPath, 'utf8').trimEnd().split('\n')) {
        lines.push(`    ${line}`);
      }
    }
  }
  lines.push('  remove this evidence directory explicitly after diagnosing the failure.', '');
  process.stderr.write(`${lines.join('\n')}\n`);
}

export interface ImportGodotProjectOptions {
  /** Pinned source-built Godot executable carrying the bound-program exporter module. */
  readonly boundExporterBinary: string;
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
  // This invocation creates and therefore owns the complete candidate. Keep the real target name
  // visible in the sibling prefix because Doctor's ordinary story globs intentionally ignore dot
  // directories. The unpredictable suffix prevents collision with any user-owned directory.
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
