#!/usr/bin/env node
/**
 * verify-unaltered — the zero-source-diff gate for this package's vendored ANALYSIS FIXTURES.
 *
 * A deliberate MIRROR of `vendor/games/verify-unaltered.mjs`, not a caller of it. That script owns
 * the RUNNABLE-INGEST shelf (`vendor/games/<id>/` and `public/ingest/<id>/`), with two lock kinds,
 * a `--refetch` mode and host-state exclusions that only make sense for a game the editor opens as
 * a project. A `packages/gd-analyze/test/fixtures/<id>/` tree is none of those things: nothing
 * serves it, nothing opens it as a project, and its whole content is what the reader parses. The
 * cheap thing would be to widen the shared script with a third root; the honest thing is that
 * these are two different shelves with two different invariants, and a ~60-line check here keeps
 * `vendor/games/` free of a knob it does not need.
 *
 * What it asserts, per `test/fixtures/<id>.UPSTREAM.lock`:
 *
 *   - every path in `sha256_manifest` exists and hashes to the recorded digest
 *   - the on-disk tree contains NOTHING ELSE — planting a new file is an alteration too
 *   - the lock itself is well formed (a 40-hex upstream commit, a named license)
 *
 * Vendored source is only evidence while it is UNMODIFIED, and this tree is the input the entire
 * import ladder is measured against. An accidental edit — or a formatter reaching in — has to be
 * loud.
 *
 * Usage:  node packages/gd-analyze/verify-unaltered.mjs
 *         npm run verify-unaltered -w @vgai/gd-analyze
 *
 * Optional diagnostic root. Ordinary verification runs never set it:
 *   VGAI_GD_FIXTURES_ROOT — where the locks and fixture trees are read from
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_ROOT =
  process.env.VGAI_GD_FIXTURES_ROOT ||
  join(dirname(fileURLToPath(import.meta.url)), 'test', 'fixtures');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(root, base = root, acc = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) walk(abs, base, acc);
    else acc.push(relative(base, abs).split('/').join('/'));
  }
  return acc;
}

/** Verify one fixture. Returns an array of human-readable failures (empty = green). */
export function verifyFixture(lockPath) {
  const failures = [];
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const dir = join(dirname(lockPath), lock.id);

  if (!Array.isArray(lock.upstreams) || lock.upstreams.length === 0) {
    failures.push(`${lock.id}: the lock records no upstreams`);
  }
  for (const upstream of lock.upstreams ?? []) {
    if (!/^[0-9a-f]{40}$/.test(upstream.commit ?? '')) {
      failures.push(`${lock.id}: upstream ${upstream.repo} has no 40-hex pinned commit`);
    }
    if (!upstream.license) {
      failures.push(`${lock.id}: upstream ${upstream.repo} names no license`);
    }
  }

  if (!existsSync(dir)) {
    failures.push(`${lock.id}: no fixture tree at ${dir}`);
    return failures;
  }

  const manifest = lock.sha256_manifest ?? {};
  const recorded = new Set(Object.keys(manifest));
  const onDisk = new Set(walk(dir));

  for (const rel of [...onDisk].sort()) {
    if (!recorded.has(rel)) failures.push(`${lock.id}: EXTRA file not in the lock — ${rel}`);
  }
  for (const [rel, expected] of Object.entries(manifest).sort()) {
    if (!onDisk.has(rel)) {
      failures.push(`${lock.id}: MISSING file the lock records — ${rel}`);
      continue;
    }
    const actual = sha256(join(dir, rel));
    if (actual !== expected) {
      failures.push(`${lock.id}: ALTERED — ${rel}\n    expected ${expected}\n    actual   ${actual}`);
    }
  }
  return failures;
}

/** Verify every lock under the fixtures root. Refuses to pass by finding no locks. */
export function verifyAll(fixturesRoot = FIXTURES_ROOT) {
  const locks = readdirSync(fixturesRoot)
    .filter((name) => name.endsWith('.UPSTREAM.lock'))
    .sort();
  if (locks.length === 0) {
    return { locks, failures: [`no *.UPSTREAM.lock under ${fixturesRoot} — nothing was checked`] };
  }
  return {
    locks,
    failures: locks.flatMap((name) => verifyFixture(join(fixturesRoot, name))),
  };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const { locks, failures } = verifyAll();
  if (failures.length > 0) {
    process.stderr.write(`verify-unaltered: ${failures.length} failure(s)\n`);
    for (const failure of failures) process.stderr.write(`  ${failure}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `verify-unaltered: ${locks.length} fixture(s) unaltered — ${locks.map((l) => l.replace('.UPSTREAM.lock', '')).join(', ')}\n`,
  );
}
