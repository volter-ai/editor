import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  constants,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGodotBoundProgram, type GodotBoundProgram } from './bound-program';
import { GODOT_4_SOURCE_AUTHORITIES } from './source-authority';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..', '..');
const CAPTURE_SCRIPT = path.join(PACKAGE_ROOT, 'godot-frontend/capture-bound-program-godot4.gd');
const MODULE_ROOT = path.join(
  PACKAGE_ROOT,
  'godot-frontend/exporter-modules/gdscript_frontend_exporter',
);
const OFFICIAL_SOURCE_PATCHES = path.join(PACKAGE_ROOT, 'godot-frontend/official-source-patches');
/** The patch the pinned 4.7 exporter is built with; a revision names its own in its authority. */
export const DEFAULT_OFFICIAL_SOURCE_PATCH = '4.7-selected-call-targets.patch';
const EXCLUDED_EXPORTER_FILES = new Set(['build_identity.gen.h']);

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function godotBoundExporterSourceSha256(
  officialSourcePatch: string = DEFAULT_OFFICIAL_SOURCE_PATCH,
): string {
  const rows: string[] = [];
  const visit = (absolute: string): void => {
    const entry = statSync(absolute);
    if (entry.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (!EXCLUDED_EXPORTER_FILES.has(name)) visit(path.join(absolute, name));
      }
      return;
    }
    if (!entry.isFile()) return;
    rows.push(
      `${path.relative(PACKAGE_ROOT, absolute).split(path.sep).join('/')}\0${sha256(readFileSync(absolute))}`,
    );
  };
  visit(MODULE_ROOT);
  visit(path.join(OFFICIAL_SOURCE_PATCHES, officialSourcePatch));
  return sha256(rows.sort().join('\n'));
}

export const GODOT_BOUND_EXPORTER_SNAPSHOT_VERSION = 1 as const;

export interface GodotBoundExporterSnapshot {
  readonly version: typeof GODOT_BOUND_EXPORTER_SNAPSHOT_VERSION;
  readonly executableBytes: Uint8Array;
  readonly executableSha256: string;
  readonly captureScriptBytes: Uint8Array;
  readonly captureScriptSha256: string;
  readonly exporterSourceSha256: string;
}

/** Capture every byte the official frontend process will execute before translation begins. */
export function captureGodotBoundExporterSnapshot(
  godotBinary: string,
  officialSourcePatch: string = DEFAULT_OFFICIAL_SOURCE_PATCH,
): GodotBoundExporterSnapshot {
  const executableBytes = readFileSync(path.resolve(godotBinary));
  const captureScriptBytes = readFileSync(CAPTURE_SCRIPT);
  return {
    version: GODOT_BOUND_EXPORTER_SNAPSHOT_VERSION,
    executableBytes,
    executableSha256: sha256(executableBytes),
    captureScriptBytes,
    captureScriptSha256: sha256(captureScriptBytes),
    exporterSourceSha256: godotBoundExporterSourceSha256(officialSourcePatch),
  };
}

function assertExporterSnapshot(snapshot: GodotBoundExporterSnapshot): void {
  if (snapshot.version !== GODOT_BOUND_EXPORTER_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported Godot bound exporter snapshot: ${String(snapshot.version)}`);
  }
  if (sha256(Buffer.from(snapshot.executableBytes)) !== snapshot.executableSha256) {
    throw new Error('Godot bound exporter executable bytes changed after toolchain capture');
  }
  if (sha256(Buffer.from(snapshot.captureScriptBytes)) !== snapshot.captureScriptSha256) {
    throw new Error('Godot bound exporter capture script changed after toolchain capture');
  }
}

/** Execute only the exact frontend bytes already owned by the immutable toolchain snapshot. */
/** Where macOS writes a crashed process's report (`<process>-<date>.ips`). */
const CRASH_REPORTS = path.join(homedir(), 'Library', 'Logs', 'DiagnosticReports');

function godotCrashReports(): ReadonlySet<string> {
  try {
    return new Set(readdirSync(CRASH_REPORTS).filter((name) => /^godot/iu.test(name) && name.endsWith('.ips')));
  } catch {
    return new Set();
  }
}

/**
 * How a Godot process ended when it did not exit 0: its exit code, else the signal that killed it,
 * and any Godot crash report that appeared while it ran. Not retried: a crash stays recorded.
 */
function godotExit(
  what: string,
  result: { readonly status: number | null; readonly signal: NodeJS.Signals | null; readonly stdout: string; readonly stderr: string },
  reportsBefore: ReadonlySet<string>,
): string {
  const ended = result.status !== null ? `exited ${String(result.status)}` : `was killed by ${result.signal ?? 'an unknown signal'}`;
  let fresh = [...godotCrashReports()].filter((name) => !reportsBefore.has(name));
  // macOS writes a crash report a few seconds after the process dies: wait up to 10 s for one.
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; result.signal !== null && fresh.length === 0 && waited < 20; waited += 1) {
    Atomics.wait(pause, 0, 0, 500);
    fresh = [...godotCrashReports()].filter((name) => !reportsBefore.has(name));
  }
  const report =
    fresh.length > 0
      ? `crash report: ${fresh.map((name) => path.join(CRASH_REPORTS, name)).join(', ')}`
      : 'no new Godot crash report within 10 s of exit';
  return `${what} ${ended} (${report}).\n${result.stdout}\n${result.stderr}`.trim();
}

/** The official release editor that performs Godot's own import before the exporter runs. */
export interface GodotOfficialImporter {
  readonly binary: string;
  readonly executableSha256: string;
}

/** Verify the importer's bytes, then run Godot's own `--headless --import` on the project copy. */
function runOfficialImport(importer: GodotOfficialImporter, project: string): void {
  const actual = sha256(readFileSync(importer.binary));
  if (actual !== importer.executableSha256) {
    throw new Error(
      `${importer.binary}: executable ${actual} is not the pinned official editor ${importer.executableSha256}`,
    );
  }
  const reportsBefore = godotCrashReports();
  const result = spawnSync(importer.binary, ['--headless', '--path', project, '--import'], {
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run the official Godot import: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(godotExit('Official Godot import', result, reportsBefore));
  }
}

export function captureGodotBoundProgramFromSnapshot(options: {
  readonly exporter: GodotBoundExporterSnapshot;
  readonly projectDir: string;
  readonly importer?: GodotOfficialImporter;
}): GodotBoundProgram {
  assertExporterSnapshot(options.exporter);
  const temp = mkdtempSync(path.join(tmpdir(), 'volter-godot-bound-program-'));
  const project = path.join(temp, 'project');
  const output = path.join(temp, 'bound-program.json');
  const binary = path.join(temp, 'godot-bound-exporter');
  try {
    writeFileSync(binary, options.exporter.executableBytes);
    chmodSync(binary, 0o755);
    cpSync(path.resolve(options.projectDir), project, {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      filter: (source) => {
        const name = path.basename(source);
        return name !== '.git' && name !== '.godot' && name !== '.import';
      },
    });
    if (options.importer !== undefined) {
      // Only this disposable copy gains write access: the import writes `.godot` and sidecars.
      spawnSync('chmod', ['-R', 'u+w', project], { windowsHide: true });
      runOfficialImport(options.importer, project);
    }
    const projectCaptureScript = path.join(project, '.volter-bound-capture.gd');
    writeFileSync(projectCaptureScript, options.exporter.captureScriptBytes);
    const reportsBefore = godotCrashReports();
    const result = spawnSync(
      binary,
      [
        '--headless',
        '--path',
        project,
        '--script',
        'res://.volter-bound-capture.gd',
        '--',
        '--out',
        output,
        '--binary-sha256',
        options.exporter.executableSha256,
      ],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.error !== undefined) {
      throw new Error(`Could not run Godot bound exporter: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(godotExit('Godot bound exporter', result, reportsBefore));
    }
    if (!existsSync(output)) {
      throw new Error(
        `Godot bound exporter did not produce its bound program.\n${result.stdout}\n${result.stderr}`.trim(),
      );
    }
    return decodeGodotBoundProgram(JSON.parse(readFileSync(output, 'utf8')), {
      exporterSourceSha256: options.exporter.exporterSourceSha256,
      executableSha256: options.exporter.executableSha256,
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

