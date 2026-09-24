/**
 * Copy-on-write dependency cache for FRESH scaffolds.
 *
 * Why this exists: a scaffolded project is standalone by design (outside the
 * npm workspace), so it gets its own full `npm install`. npm's cache
 * deduplicates the DOWNLOAD, not the DISK — every install materializes a fresh
 * physical copy, and `--install-strategy=linked` does not change that (it
 * builds a per-project `.store` and still copies into it). Measured on the dev
 * box, 8 identical warm-cache installs of a `three`+`vite` probe: npm 324 MB,
 * bun 327 MB, pnpm 7 MB. See docs/LOCAL-DEV.md "Probe projects".
 *
 * A human scaffolds one project and never notices. An agent scaffolds dozens
 * of probes in a session, and they are byte-identical — that is the case this
 * targets. Rather than ask every agent to remember `cp -c`, the ONE place that
 * already runs the install does it.
 *
 * Mechanism: after the first install for a given dependency set, the resulting
 * `node_modules` + `package-lock.json` are registered in a store keyed by that
 * set. Later scaffolds with the same key CLONE from the store using the
 * filesystem's copy-on-write primitive (APFS `clonefile` via `cp -c`, or
 * `--reflink` on btrfs/xfs), which costs ~1 MB and under a second for a
 * 143 MB / 1,479-file tree.
 *
 * OFF unless `VGAI_DEP_CACHE` is set, so a user's single `create` behaves
 * exactly as before. The dev box turns it on for every agent via the harness
 * env. Every failure path falls back to a normal `npm install`: this can make
 * an install cheaper, never wrong.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Specifier prefixes whose resolved CONTENT lives outside the registry, so the key must pin where they point. */
const LOCAL_SPECIFIER_PREFIXES = ['file:', 'link:', 'portal:'] as const;

/**
 * Source-derived build caches must never cross a project clone boundary.
 * Their metadata contains absolute module realpaths and Vite does not include
 * symlink targets in its own validity hash. A cloned cache can therefore serve
 * a donor project's engine/React identity even after the new project is
 * correctly relinked. Keep the dependency bytes; discard only rebuildable
 * caches after every store clone and before every store publication.
 */
const PROJECT_LOCAL_DEPENDENCY_CACHES = [
  '.vite',
  '.vite-editor',
  '.vite-editor-no-project',
  '.vite-temp',
] as const;

export function stripProjectLocalDependencyCaches(nodeModules: string): void {
  for (const name of PROJECT_LOCAL_DEPENDENCY_CACHES) {
    rmSync(join(nodeModules, name), { recursive: true, force: true });
  }
}

export interface DepCacheEnv {
  /** Enable flag. Unset/empty/`0`/`false` disables the cache entirely. */
  VGAI_DEP_CACHE?: string;
  /** Store location override. Defaults to `~/.cache/vgai/dep-store`. */
  VGAI_DEP_CACHE_DIR?: string;
}

/** `true` when the caller opted in. Anything falsy-looking is off — an unset var must never enable a cache. */
export function isDepCacheEnabled(env: DepCacheEnv): boolean {
  const raw = env.VGAI_DEP_CACHE?.trim().toLowerCase();
  return raw !== undefined && raw !== '' && raw !== '0' && raw !== 'false';
}

export function depStoreDir(env: DepCacheEnv): string {
  const override = env.VGAI_DEP_CACHE_DIR?.trim();
  if (override) return resolve(override);
  return join(homedir(), '.cache', 'vgai', 'dep-store');
}

interface KeyInputs {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** Directory the specifiers are relative to — a `file:../x` resolves differently per project. */
  projectDir: string;
  npmVersion: string;
  nodeMajor: string;
  platform: string;
  arch: string;
}

/**
 * Hash of everything that can change the resolved tree.
 *
 * Scaffolds pin exact versions (see scaffold.ts's dual-package-hazard note), so
 * the declared set determines the resolved set — EXCEPT for `file:`/`link:`
 * specifiers, whose content is whatever that path holds. Those are keyed by
 * their resolved absolute path, so two different engine checkouts never share a
 * store entry. A floating range (`^`, `~`, `*`, `x`, or a range operator) is
 * NOT safely cacheable — it resolves to whatever the registry served that day —
 * so `computeDepCacheKey` returns null and the caller installs normally.
 */
export function computeDepCacheKey(inputs: KeyInputs): string | null {
  const all = { ...inputs.dependencies, ...inputs.devDependencies };
  const entries: string[] = [];
  for (const name of Object.keys(all).sort()) {
    const spec = all[name] ?? '';
    const local = LOCAL_SPECIFIER_PREFIXES.find((p) => spec.startsWith(p));
    if (local) {
      const rel = spec.slice(local.length);
      entries.push(`${name}@${local}${isAbsolute(rel) ? rel : resolve(inputs.projectDir, rel)}`);
      continue;
    }
    if (!isExactVersion(spec)) return null;
    entries.push(`${name}@${spec}`);
  }
  if (entries.length === 0) return null;
  const h = createHash('sha256');
  h.update(
    JSON.stringify({
      // Earlier checkout installs cached temporary file: dependencies under registry specs.
      format: 2,
      entries,
      npm: inputs.npmVersion,
      node: inputs.nodeMajor,
      platform: inputs.platform,
      arch: inputs.arch,
    }),
  );
  return h.digest('hex').slice(0, 32);
}

/** An exact version pin — `1.2.3`, `1.2.3-rc.1`. Anything with a range operator resolves per-day and cannot be keyed. */
export function isExactVersion(spec: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec.trim());
}

/** Same filesystem? A copy-on-write clone cannot cross devices, and attempting it silently degrades to a full copy on some platforms. */
export function onSameDevice(a: string, b: string): boolean {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return false;
  }
}

/** The platform's reflink/clone copy, or null where there is no copy-on-write copy to reach for. */
function cloneCommand(src: string, dest: string): { cmd: string; args: string[] } | null {
  if (process.platform === 'darwin') return { cmd: 'cp', args: ['-c', '-R', src, dest] };
  if (process.platform === 'linux')
    return { cmd: 'cp', args: ['-a', '--reflink=always', src, dest] };
  return null;
}

function cloneTree(src: string, dest: string): boolean {
  const spec = cloneCommand(src, dest);
  if (!spec) return false;
  const r = spawnSync(spec.cmd, spec.args, { stdio: 'ignore' });
  if (r.status === 0) return true;
  rmSync(dest, { force: true, recursive: true });
  return false;
}

export type DependencyTreeCloner = (src: string, dest: string) => boolean;

/**
 * A store entry is only usable if the install that produced it COMPLETED.
 * `node_modules/.package-lock.json` is npm's own record of what it put on disk,
 * so its absence means a killed or partial install and the entry must be
 * ignored rather than cloned.
 */
function isCompleteEntry(entryDir: string): boolean {
  return existsSync(join(entryDir, 'node_modules', '.package-lock.json'));
}

function npmVersion(): string {
  // `shell: true` for the same reason as every other npm spawn in this repo:
  // on Windows `npm` is `npm.cmd` and a shell is the only way to reach it.
  // This one failed SILENTLY — the status check below turns ENOENT into the
  // string 'unknown', so on Windows the cache key was a constant, not a
  // version, and nothing ever said so.
  const r = spawnSync('npm', ['--version'], { encoding: 'utf8', shell: true });
  return r.status === 0 ? (r.stdout ?? '').trim() : 'unknown';
}

export type InstallOutcome = 'cloned' | 'installed-and-cached' | 'installed';

export interface InstallDepsOptions {
  targetDir: string;
  env?: DepCacheEnv;
  /** Runs the real `npm install`. Injected so tests never shell out. */
  runInstall: () => void;
}

/**
 * Populate `targetDir`'s dependencies, cloning from the store when possible.
 *
 * Returns which path was taken, for the caller to report. Never throws on a
 * cache problem — only `runInstall` may throw, and it throws exactly as it
 * would have without this function in the way.
 */
export function installDependencies(options: InstallDepsOptions): InstallOutcome {
  const { targetDir, runInstall } = options;
  const env = options.env ?? (process.env as DepCacheEnv);
  if (tryCloneDependencies(targetDir, env)) return 'cloned';
  runInstall();
  return cacheDependencies(targetDir, env) ? 'installed-and-cached' : 'installed';
}

/**
 * Populate `targetDir/node_modules` from the store, or report that it could not.
 *
 * `false` always means "carry on and install normally" — a disabled cache, an
 * unkeyable dependency set, a cold or partial store entry, a different
 * filesystem, or a failed clone are all the same answer to the caller.
 */
export function tryCloneDependencies(
  targetDir: string,
  env?: DepCacheEnv,
  clone: DependencyTreeCloner = cloneTree,
): boolean {
  const e = env ?? (process.env as DepCacheEnv);
  if (!isDepCacheEnabled(e)) return false;
  const key = readKey(targetDir);
  if (!key) return false;
  const entry = join(depStoreDir(e), key);
  if (!isCompleteEntry(entry)) return false;
  if (!onSameDevice(entry, dirname(targetDir))) return false;
  const nm = join(targetDir, 'node_modules');
  if (existsSync(nm)) return false;
  if (!clone(join(entry, 'node_modules'), nm)) return false;
  stripProjectLocalDependencyCaches(nm);
  const lock = join(entry, 'package-lock.json');
  const destLock = join(targetDir, 'package-lock.json');
  if (existsSync(lock) && !existsSync(destLock)) clone(lock, destLock);
  return true;
}

/** Publish a just-installed tree into the store. `false` means it was not cached, which is never an error. */
export function cacheDependencies(
  targetDir: string,
  env?: DepCacheEnv,
  clone: DependencyTreeCloner = cloneTree,
): boolean {
  const e = env ?? (process.env as DepCacheEnv);
  if (!isDepCacheEnabled(e)) return false;
  const key = readKey(targetDir);
  if (!key) return false;
  return register(join(depStoreDir(e), key), targetDir, clone);
}

function readKey(targetDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return computeDepCacheKey({
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
      projectDir: targetDir,
      npmVersion: npmVersion(),
      nodeMajor: process.versions.node.split('.')[0] ?? '0',
      platform: process.platform,
      arch: process.arch,
    });
  } catch {
    return null;
  }
}

/**
 * Publish a freshly-installed tree into the store.
 *
 * Staged through a temp directory and moved into place with a single rename so
 * a concurrent scaffold never observes a half-written entry — several agents
 * scaffold at once on this box. Losing the rename race is success: the winner's
 * entry is equivalent by construction (same key), so the loser discards its own.
 */
function register(entryDir: string, targetDir: string, clone: DependencyTreeCloner): boolean {
  if (!existsSync(join(targetDir, 'node_modules', '.package-lock.json'))) return false;
  if (isCompleteEntry(entryDir)) return false;
  let staging: string | null = null;
  try {
    mkdirSync(dirname(entryDir), { recursive: true });
    if (!onSameDevice(dirname(entryDir), targetDir)) return false;
    staging = `${entryDir}.staging-${process.pid}`;
    rmSync(staging, { force: true, recursive: true });
    mkdirSync(staging, { recursive: true });
    if (!clone(join(targetDir, 'node_modules'), join(staging, 'node_modules'))) return false;
    stripProjectLocalDependencyCaches(join(staging, 'node_modules'));
    const lock = join(targetDir, 'package-lock.json');
    if (existsSync(lock)) clone(lock, join(staging, 'package-lock.json'));
    renameSync(staging, entryDir);
    staging = null;
    return true;
  } catch {
    return false;
  } finally {
    if (staging) rmSync(staging, { force: true, recursive: true });
  }
}
