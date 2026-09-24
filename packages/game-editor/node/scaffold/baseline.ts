/**
 * The scaffold pristine baseline (T2.3/D3 §1.D).
 *
 * At scaffold time, `.vgai/scaffold-baseline.json` records the engine
 * version this project was scaffolded against plus a sha256 hash of every
 * template-derived file (the copied template tree PLUS the scaffold's own
 * rewrites — `package.json`, `tsconfig.json`, `vite.config.ts`,
 * `vgai.project.json`, etc. — hashed at their FINAL post-rewrite content,
 * since the baseline is built after `scaffoldProject` finishes all of its
 * rewrite steps).
 *
 * `vgai upgrade` (slice 2) uses this for three-way classification of a
 * template re-sync: unchanged (hash still matches -> safe to update),
 * user-edited (hash differs -> never overwritten, diffed instead), or
 * both-moved. The hashing helper (`hashFile`) is kept pure and exported so
 * slice 2 can reuse it against the CURRENT project tree without duplicating
 * the hashing logic.
 *
 * Also records `engineSource` (the dogfooded-failure fix, 2026-07-12): the
 * engine checkout's git HEAD sha (plus a dirty-worktree flag) at
 * scaffold/last-upgrade time. `manifest.engine.version`/`engineVersion`
 * above is a SEMVER pin, and this repo's engine is a source-linked `file:`
 * dependency — the checkout can advance (new commits, uncommitted edits)
 * WITHOUT a version bump, so the semver pin alone cannot see drift that
 * breaks a project (e.g. an engine API a project's copied template code
 * references gets removed upstream). `vgai validate` compares this recorded
 * sha against the engine checkout's CURRENT HEAD to surface that drift.
 * Optional and best-effort: absent whenever the runtime package isn't a git
 * checkout (e.g. a tarball/registry install with no `.git` at all) — the
 * feature just degrades silently, and old baselines written before this
 * field existed simply lack it (never treated as a mismatch).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Project-relative path (POSIX-separated) of the baseline file itself. */
export const SCAFFOLD_BASELINE_RELATIVE_PATH = '.vgai/scaffold-baseline.json';

/** Engine checkout git state at scaffold/last-upgrade time — see this module's header comment. */
export interface EngineSourceState {
  /** `git rev-parse HEAD` of the engine checkout (full 40-char sha). */
  sha: string;
  /** `true` when `git status --porcelain` was non-empty (uncommitted changes present). */
  dirty: boolean;
}

export interface ScaffoldBaseline {
  /** The `@volter/editor-project` version this project was scaffolded/last-upgraded against. */
  engineVersion: string;
  /**
   * The engine checkout's git state at scaffold/last-upgrade time. Absent
   * when the engine dir isn't a git checkout, or on old baselines predating
   * this field — both mean "no drift check available", never a mismatch.
   */
  engineSource?: EngineSourceState;
  /** Project-relative path (POSIX-separated) -> sha256 hex digest of the file's contents. */
  files: Record<string, string>;
}

/**
 * Best-effort read of `engineDir`'s git HEAD sha + dirty-worktree flag.
 * Returns `undefined` (never throws) when `engineDir` isn't a git checkout
 * at all — a tarball/registry install of the engine has no `.git`, and this
 * feature is meant to degrade silently in that case rather than fail
 * scaffold/upgrade over a diagnostics-only field.
 */
export function readEngineSourceState(engineDir: string): EngineSourceState | undefined {
  try {
    const sha = execFileSync('git', ['-C', engineDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // `HEAD` above is necessarily the WHOLE checkout's (this repo is one
    // git repo, not a per-package one) — but `status` is scoped to
    // `engineDir` itself via the trailing `-- .` pathspec, for two reasons:
    // (1) relevance — "dirty" should mean "the engine's OWN source has
    // uncommitted changes", not "anything anywhere in a large monorepo
    // checkout is mid-edit" (almost always true during active development,
    // which would make the flag noise rather than signal); (2) speed —
    // measured on this repo's WSL/`/mnt/c` checkout, an UNSCOPED `git
    // status --porcelain` (walking the entire multi-package tree) took
    // ~5.5s, long enough to blow past a test's default timeout when this
    // runs once per scaffold/upgrade call; scoped to just the runtime package
    // it's ~0.9s.
    const status = execFileSync('git', ['-C', engineDir, 'status', '--porcelain', '--', '.'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { sha, dirty: status.trim().length > 0 };
  } catch {
    return undefined;
  }
}

/**
 * Pure sha256 hex digest of one file's contents. Exported (not just an
 * internal helper) because `vgai upgrade` (slice 2) reuses it verbatim to
 * hash the CURRENT project tree for comparison against a baseline recorded
 * here — the two must hash identically byte-for-byte or classification
 * would be unreliable.
 */
export function hashFile(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

/** Every file under `dir`, as a path relative to `dir` (POSIX-separated), unsorted. */
function listFilesRecursive(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else if (entry.isFile()) {
      out.push(relative(base, full).split(sep).join('/'));
    }
  }
  return out;
}

/**
 * Build the baseline record for `targetDir` (a fully scaffolded — i.e.
 * post-rewrite — project directory): every file under it, hashed, keyed by
 * its project-relative POSIX path, EXCLUDING the baseline file's own path
 * (it doesn't exist yet the first time this runs, but is excluded
 * explicitly rather than relying on that ordering). Deterministic: keys are
 * inserted in sorted order, so `JSON.stringify` (insertion-ordered for
 * string keys) always emits the same byte sequence for the same file set.
 *
 * `engineDir`, when given, is read via `readEngineSourceState` and stored as
 * `engineSource` (best-effort — `undefined` when it isn't a git checkout;
 * omitted from the record's JSON entirely, since `JSON.stringify` drops
 * `undefined`-valued keys, so old-format readers see exactly the old shape).
 */
export function buildScaffoldBaseline(
  targetDir: string,
  engineVersion: string,
  engineDir?: string,
): ScaffoldBaseline {
  const relPaths = listFilesRecursive(targetDir)
    .filter((p) => p !== SCAFFOLD_BASELINE_RELATIVE_PATH)
    .sort();

  const files: Record<string, string> = {};
  for (const relPath of relPaths) {
    files[relPath] = hashFile(join(targetDir, relPath));
  }
  const engineSource = engineDir ? readEngineSourceState(engineDir) : undefined;
  // `exactOptionalPropertyTypes` — conditionally spread rather than assign
  // `engineSource: undefined` explicitly, so the key is truly ABSENT (not
  // present-with-value-undefined) both in the TS type and the eventual
  // `JSON.stringify` output.
  return { engineVersion, ...(engineSource ? { engineSource } : {}), files };
}

/**
 * Build and write the baseline to `.vgai/scaffold-baseline.json` inside
 * `targetDir`. Returns the written record so callers/tests don't need a
 * separate read-back.
 */
export function writeScaffoldBaseline(
  targetDir: string,
  engineVersion: string,
  engineDir?: string,
): ScaffoldBaseline {
  const baseline = buildScaffoldBaseline(targetDir, engineVersion, engineDir);
  mkdirSync(join(targetDir, '.vgai'), { recursive: true });
  writeFileSync(
    join(targetDir, SCAFFOLD_BASELINE_RELATIVE_PATH),
    `${JSON.stringify(baseline, null, 2)}\n`,
    'utf-8',
  );
  return baseline;
}
