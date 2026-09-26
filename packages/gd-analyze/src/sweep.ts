/**
 * `gd-analyze sweep` — the lane's completeness table, regenerated instead of remembered.
 *
 * One command runs the whole import cycle (translate → install → typecheck → build → atomic
 * promote) over every vendored source fixture discovered from its adjacent `.UPSTREAM.lock`, into
 * throwaway targets, and prints one verdict row per game: PASS, or the first failing gate with the
 * first line of its error.
 *
 * Deliberately a serial loop and nothing more: no parallelism (each import runs an npm install;
 * two at once starve the box), no persistence (a stored table goes stale while claiming to be
 * current), no ladder writes.
 *
 * ```
 * npx tsx packages/gd-analyze/src/cli.ts sweep            # every pinned source fixture
 * npx tsx packages/gd-analyze/src/cli.ts sweep dodge-the-creeps squash-the-creeps
 * ```
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importGodotProject } from './import-project';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = path.join(PACKAGE_DIR, 'test', 'fixtures');

interface SweepRow {
  readonly fixture: string;
  readonly verdict: 'PASS' | 'FAIL';
  /** The import cycle's own gate sequencing makes the FIRST thrown error the first failed gate. */
  readonly detail: string;
  readonly seconds: number;
}

function pinnedSourceFixtures(): readonly string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.UPSTREAM.lock'))
    .map((name) => name.slice(0, -'.UPSTREAM.lock'.length))
    .sort();
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n', 1)[0] ?? text;
}

export function runSweep(
  requested: readonly string[],
  boundExporterBinary: string,
  officialBinary: string,
): number {
  const fixtures = requested.length > 0 ? requested : pinnedSourceFixtures();
  const rows: SweepRow[] = [];
  for (const fixture of fixtures) {
    const sourceDir = path.join(FIXTURES_DIR, fixture);
    const stagingRoot = mkdtempSync(path.join(tmpdir(), `gd-sweep-${fixture}-`));
    const target = path.join(stagingRoot, 'app');
    const started = Date.now();
    process.stdout.write(`sweep: ${fixture} — importing into ${target}\n`);
    try {
      importGodotProject(sourceDir, target, { boundExporterBinary, officialBinary });
      rows.push({
        fixture,
        verdict: 'PASS',
        detail: 'promoted, loudness quiet',
        seconds: (Date.now() - started) / 1000,
      });
    } catch (error) {
      rows.push({
        fixture,
        verdict: 'FAIL',
        detail: firstLine(error),
        seconds: (Date.now() - started) / 1000,
      });
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  const width = Math.max(...rows.map((row) => row.fixture.length));
  process.stdout.write('\n');
  for (const row of rows) {
    process.stdout.write(
      `${row.fixture.padEnd(width)}  ${row.verdict}  (${row.seconds.toFixed(0)}s)  ${row.detail}\n`,
    );
  }
  const failed = rows.filter((row) => row.verdict === 'FAIL');
  process.stdout.write(`\nsweep: ${rows.length - failed.length}/${rows.length} PASS\n`);
  return failed.length === 0 ? 0 : 1;
}
