/**
 * Refuse a source-checkout editor whose workspace packages resolve into a
 * different checkout.
 *
 * The checkout Vite config deliberately dedupes the runtime packages from its own
 * root. A whole-directory `node_modules` symlink (or stale individual
 * workspace links) therefore does more than use old dependencies: the editor can
 * load the debug registry from one checkout while a game's mount reaches it
 * from another. The game renders, but all of its game-scoped command/provider
 * registrations silently land in a registry nothing reads.
 *
 * LOCAL-DEV's worktree shim is the one repair owner. The server must not try to
 * mutate an install tree whose donor it cannot know; it fails before Vite boot
 * with the exact invariant and repair seam instead.
 *
 * WHAT A WORKSPACE MEMBER IS comes from the root `package.json`'s own
 * `workspaces` globs, and from nothing else — not a package list here, not the
 * lockfile, and above all not a named package used as a "am I a source
 * checkout?" probe. Both of those drift with a rename and go VACUOUS-GREEN:
 * this guard spent the engine split (2026-09-21, `packages/engine` → `project`
 * + `threejs-runtime` + `game-runtime`) returning `null` on every source
 * checkout in the estate, because its first line asked for
 * `packages/engine/package.json` and that package no longer exists — measured
 * with the five links present AND with `@vgai/project`'s link deleted, both
 * `null`. A guard that can be switched off by a rename is not a guard, so the
 * question it asks is now the monorepo's own self-description.
 */

import {
  type Dirent,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';

function canonical(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

interface WorkspaceIdentity {
  packageName: string;
  source: string;
}

const workspaceIdentityCache = new Map<string, WorkspaceIdentity[]>();

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** The root manifest's own `workspaces` globs — `packages/*`, `examples/*`, … */
function workspaceGlobs(engineRoot: string): string[] {
  const manifest = readJson(path.join(engineRoot, 'package.json')) as
    | { workspaces?: string[] | { packages?: string[] } }
    | undefined;
  const declared = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : (manifest?.workspaces?.packages ?? []);
  return declared.filter((glob): glob is string => typeof glob === 'string');
}

/**
 * Expand the globs to the members that are ON DISK. Only the two shapes npm's
 * own workspaces use here are honoured — a literal directory and a trailing
 * `/*` — because a member this cannot see is a member this cannot refuse for,
 * and a half-understood pattern silently becomes the vacuous green above.
 */
function expandWorkspaceGlob(engineRoot: string, glob: string): string[] {
  const normalized = glob.replaceAll('\\', '/').replace(/\/+$/, '');
  if (!normalized.endsWith('/*')) {
    return existsSync(path.join(engineRoot, normalized, 'package.json')) ? [normalized] : [];
  }
  const parent = normalized.slice(0, -2);
  let entries: Dirent[];
  try {
    entries = readdirSync(path.join(engineRoot, parent), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => `${parent}/${entry.name}`)
    .filter((source) => existsSync(path.join(engineRoot, source, 'package.json')));
}

/**
 * The workspace globs, not the lockfile and not a maintained package list, own
 * the topology: a member added to `packages/` before anyone regenerates the
 * lock is still a member, and a member deleted by a rename stops being one in
 * the same gesture. A directory whose manifest has no `name` is not a package
 * and is skipped by name rather than guessed at.
 */
function checkoutWorkspaceIdentities(engineRoot: string): WorkspaceIdentity[] {
  const cacheKey = canonical(engineRoot);
  const cached = workspaceIdentityCache.get(cacheKey);
  if (cached) return cached;
  const identities: WorkspaceIdentity[] = [];
  for (const glob of workspaceGlobs(engineRoot)) {
    for (const source of expandWorkspaceGlob(engineRoot, glob)) {
      const manifest = readJson(path.join(engineRoot, source, 'package.json')) as
        | { name?: string }
        | undefined;
      if (typeof manifest?.name !== 'string' || manifest.name.length === 0) continue;
      identities.push({ packageName: manifest.name, source });
    }
  }
  identities.sort((a, b) => a.packageName.localeCompare(b.packageName));
  workspaceIdentityCache.set(cacheKey, identities);
  return identities;
}

/**
 * Canonical top-level symlink topology participating in Vite resolution.
 * Includes ordinary and scoped packages, but never crawls package contents.
 */
function installedLinkTopology(nodeModules: string): string[] {
  const links: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return links;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const installed = path.join(nodeModules, entry.name);
    if (entry.isSymbolicLink()) {
      links.push(`${entry.name}=${canonical(installed)}`);
      continue;
    }
    if (!entry.name.startsWith('@') || !entry.isDirectory()) continue;
    let scopedEntries: Dirent[];
    try {
      scopedEntries = readdirSync(installed, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const scopedEntry of scopedEntries) {
      if (!scopedEntry.isSymbolicLink()) continue;
      const packageName = `${entry.name}/${scopedEntry.name}`;
      links.push(`${packageName}=${canonical(path.join(installed, scopedEntry.name))}`);
    }
  }
  return links.sort();
}

/**
 * Identity input for the optimizer namespace. Vite's own config/lock hashes do
 * not include symlink realpaths, so a relinked same-path project otherwise
 * keeps accepting a cache built from a different checkout.
 */
export function editorResolutionTopology(engineRoot: string, projectPath?: string): string {
  const parts = [
    `engine-node-modules=${canonical(path.join(engineRoot, 'node_modules'))}`,
    ...installedLinkTopology(path.join(engineRoot, 'node_modules')).map((v) => `engine:${v}`),
  ];
  if (projectPath) {
    parts.push(
      `project-node-modules=${canonical(path.join(projectPath, 'node_modules'))}`,
      ...installedLinkTopology(path.join(projectPath, 'node_modules')).map((v) => `project:${v}`),
    );
  }
  return parts.join('\n');
}

function repairMessage(engineRoot: string, detail: string): string {
  return (
    `Editor startup refused: source-checkout workspace identity is split. ${detail}\n` +
    `Vite resolves shared @vgai modules from ${engineRoot}/node_modules, so continuing could ` +
    'render a game with a different debug registry identity. Recreate this ' +
    "checkout's node_modules with scripts/worktree-node-modules-shim.mjs as documented in " +
    'docs/LOCAL-DEV.md; never symlink the whole node_modules directory.'
  );
}

function projectRepairMessage(
  projectPath: string,
  installed: string,
  actual: string,
  expected: string,
): string {
  return (
    `Editor startup refused: ${installed} resolves to ${actual}, but the serving checkout ` +
    `requires ${expected}. A live editor cannot compose workspace packages from two checkouts. ` +
    `Either launch this project from the checkout at ${actual} or relink it to this checkout ` +
    `with \`cd ${projectPath} && npm link --no-save ${expected}\`.`
  );
}

/**
 * Every member the globs found must have a link in the checkout's own
 * `node_modules`, pointing at the checkout's own source. A member with NO link
 * is refused by name: nothing later in the boot can tell that absence from a
 * package nobody imports, and the shim is the one repair.
 */
function engineLinkError(
  normalizedRoot: string,
  nodeModules: string,
  identities: WorkspaceIdentity[],
): string | null {
  for (const { packageName, source: relativeSource } of identities) {
    const installed = path.join(nodeModules, ...packageName.split('/'));
    const expected = path.join(normalizedRoot, relativeSource);
    if (!existsSync(installed)) {
      return repairMessage(normalizedRoot, `${installed} is missing; expected ${expected}.`);
    }
    const actual = canonical(installed);
    const expectedCanonical = canonical(expected);
    if (actual !== expectedCanonical) {
      return repairMessage(
        normalizedRoot,
        `${installed} resolves to ${actual}; expected this checkout's ${expectedCanonical}.`,
      );
    }
  }
  return null;
}

/**
 * A registry-installed project copy is intentionally collapsed by the
 * checkout's Vite dedupe. A project-local SYMLINK is different: it is an
 * explicit checkout selection, and if it names another checkout the active
 * server must restart there rather than compose both graphs. Check every
 * workspace member, not a hand-maintained `@vgai` subset.
 */
function projectLinkError(
  normalizedRoot: string,
  identities: WorkspaceIdentity[],
  projectPath?: string,
): string | null {
  if (projectPath === undefined) return null;
  for (const { packageName, source: relativeSource } of identities) {
    const installed = path.join(projectPath, 'node_modules', ...packageName.split('/'));
    try {
      if (!lstatSync(installed).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const actual = canonical(installed);
    const expected = canonical(path.join(normalizedRoot, relativeSource));
    if (actual !== expected) {
      return projectRepairMessage(projectPath, installed, actual, expected);
    }
  }
  return null;
}

/**
 * No-op for a packaged editor: a published package declares no `workspaces`,
 * so it has no members and nothing to split. A source checkout is recognized
 * by that declaration alone — never by a package name, which a rename deletes.
 */
export function checkoutWorkspaceIdentityError(
  engineRoot: string,
  projectPath?: string,
): string | null {
  const normalizedRoot = path.resolve(engineRoot);
  if (workspaceGlobs(normalizedRoot).length === 0) return null;

  const nodeModules = path.join(normalizedRoot, 'node_modules');
  try {
    if (lstatSync(nodeModules).isSymbolicLink()) {
      return repairMessage(
        normalizedRoot,
        `${nodeModules} is a whole-directory symlink to ${canonical(nodeModules)}.`,
      );
    }
  } catch {
    // Missing/unreadable node_modules will already make this source server's
    // dependency imports fail by name. Do not replace that useful native error.
    return null;
  }

  const identities = checkoutWorkspaceIdentities(normalizedRoot);
  if (identities.length === 0) {
    return repairMessage(
      normalizedRoot,
      `${path.join(normalizedRoot, 'package.json')} declares workspace globs ` +
        `(${workspaceGlobs(normalizedRoot).join(', ')}) that match no package on disk.`,
    );
  }
  return (
    engineLinkError(normalizedRoot, nodeModules, identities) ??
    projectLinkError(normalizedRoot, identities, projectPath)
  );
}

export function assertCheckoutWorkspaceIdentity(engineRoot: string, projectPath?: string): void {
  const error = checkoutWorkspaceIdentityError(engineRoot, projectPath);
  if (error !== null) throw new Error(error);
}

export interface WorkspaceIdentityRestartMonitor {
  checkNow(): void;
  dispose(): void;
}

/**
 * Poll the tiny top-level link set because npm relinking replaces symlinks in
 * node_modules, a path source watchers intentionally ignore. Fires once: the
 * existing exit-75 handoff owns the actual process replacement.
 */
export function createWorkspaceIdentityRestartMonitor(options: {
  engineRoot: string;
  projectPath: () => string | undefined;
  onStale: (change: { changedPath: string; changedAt: string }) => void;
  intervalMs?: number;
  now?: () => Date;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (timer: unknown) => void;
}): WorkspaceIdentityRestartMonitor {
  let fired = false;
  const checkNow = (): void => {
    if (fired) return;
    if (checkoutWorkspaceIdentityError(options.engineRoot, options.projectPath()) === null) return;
    fired = true;
    options.onStale({
      changedPath: 'node_modules workspace package links',
      changedAt: (options.now ?? (() => new Date()))().toISOString(),
    });
  };
  const setTimer =
    options.setInterval ??
    ((callback: () => void, ms: number): unknown => {
      const timer = setInterval(callback, ms);
      timer.unref();
      return timer;
    });
  const clearTimer =
    options.clearInterval ?? ((timer: unknown): void => clearInterval(timer as NodeJS.Timeout));
  const timer = setTimer(checkNow, options.intervalMs ?? 1_000);
  return {
    checkNow,
    dispose(): void {
      clearTimer(timer);
    },
  };
}
