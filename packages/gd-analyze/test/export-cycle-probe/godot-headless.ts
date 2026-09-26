/**
 * export-cycle-probe/godot-headless.ts — drive the box's real Godot 4.7 against a cycled project.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env['GODOT'],
  'godot',
  '/opt/homebrew/bin/godot',
  '/Applications/Godot.app/Contents/MacOS/Godot',
].filter((value): value is string => value !== undefined && value.length > 0);

export function resolveGodotBinary(): string {
  for (const candidate of CANDIDATES) {
    if (candidate === 'godot') {
      const which = spawnSync('which', ['godot'], { encoding: 'utf8' });
      if (which.status === 0 && which.stdout.trim() !== '') return which.stdout.trim();
      continue;
    }
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('no Godot binary found (tried which godot, Homebrew, /Applications/Godot.app)');
}

export interface GodotRun {
  readonly command: string;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGodot(bin: string, args: string[], cwd: string, timeoutMs: number): GodotRun {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1' },
  });
  return {
    command: `${bin} ${args.join(' ')}`,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error === undefined ? '' : `\n${result.error.message}`}`,
  };
}

export function godotImport(projectDir: string, timeoutMs = 120_000): GodotRun {
  const bin = resolveGodotBinary();
  return runGodot(bin, ['--headless', '--path', projectDir, '--import'], projectDir, timeoutMs);
}

export function godotQuitAfter(projectDir: string, frames: number, timeoutMs = 60_000): GodotRun {
  const bin = resolveGodotBinary();
  return runGodot(
    bin,
    ['--headless', '--path', projectDir, `--quit-after=${frames}`],
    projectDir,
    timeoutMs,
  );
}

export function godotImportBuiltCache(run: GodotRun): boolean {
  if (run.status !== 0) return false;
  const text = `${run.stdout}\n${run.stderr}`;
  return /\[ DONE \]/.test(text) && /reimport/.test(text);
}

/** Godot 4.7 loading a Godot 3 `.gd` after import — same errors the ORIGINAL fixture prints. */
export function godotScriptErrors(run: GodotRun): string[] {
  const text = `${run.stdout}\n${run.stderr}`;
  return [...text.matchAll(/Failed to load script "([^"]+)"/g)].map((match) => match[1] ?? '');
}
