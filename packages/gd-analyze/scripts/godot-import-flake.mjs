#!/usr/bin/env node
/**
 * The import-crash instrument: runs official Godot's own `--headless --import` N times on a fresh
 * copy of a project, as the import pipeline does (a copy without .godot/.import), and appends one
 * JSON row per run: exit code, signal, time, stdout/stderr tails and any Godot crash report
 * (~/Library/Logs/DiagnosticReports) that appeared during the run.
 *
 * The pipeline itself reports the exit signal and a new crash report's path when an import dies
 * (`src/godot-frontend/run-bound-program.ts`); it never retries, so a crash stays recorded as
 * unexplained until this instrument or its report explains it.
 *
 * usage: godot-import-flake.mjs <official-godot-binary> <project-dir> <runs> <out.jsonl>
 * Run several at once to measure under load.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';

const [godot, project, runs, out] = process.argv.slice(2);
if (godot === undefined || project === undefined || runs === undefined || out === undefined) {
  process.stderr.write('usage: godot-import-flake.mjs <official-godot-binary> <project-dir> <runs> <out.jsonl>\n');
  process.exit(2);
}
const REPORTS = path.join(homedir(), 'Library', 'Logs', 'DiagnosticReports');
const reports = () => new Set(readdirSync(REPORTS).filter((name) => /^godot/iu.test(name) && name.endsWith('.ips')));
const tail = (text, lines) => (text ?? '').split('\n').slice(-lines).join('\n');

for (let run = 0; run < Number(runs); run += 1) {
  const before = reports();
  const temp = mkdtempSync(path.join(tmpdir(), 'godot-import-flake-'));
  const copy = path.join(temp, 'project');
  cpSync(project, copy, { recursive: true, filter: (source) => !['.git', '.godot', '.import'].includes(path.basename(source)) });
  const started = Date.now();
  const result = spawnSync(godot, ['--headless', '--path', copy, '--import'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
  const crash = [...reports()]
    .filter((name) => !before.has(name))
    .map((name) => ({ path: path.join(REPORTS, name), head: readFileSync(path.join(REPORTS, name), 'utf8').slice(0, 6000) }));
  const row = {
    run,
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    ms: Date.now() - started,
    stderrTail: tail(result.stderr, 15),
    stdoutTail: tail(result.stdout, 8),
    crash,
  };
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  rmSync(temp, { recursive: true, force: true });
}
