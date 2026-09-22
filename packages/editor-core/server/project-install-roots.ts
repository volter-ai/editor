/**
 * WHERE A PROJECT'S MODULES REALLY LIVE ON DISK — the directory set a
 * project-rooted Vite instance must be allowed to serve from
 * (`server.fs.allow`).
 *
 * ## The measured defect
 *
 * `packaged.ts` used to allow exactly three paths: the project directory, the
 * realpath of `<project>/node_modules` *when that directory exists*, and the
 * editor package root. That set is correct for one shape of install — a
 * standalone scaffold with its own flat `node_modules` — and wrong for every
 * other shape a real project takes:
 *
 *  - an npm WORKSPACE MEMBER (every `examples/<id>`, and any user monorepo
 *    game) has no `node_modules` of its own at all; npm hoists the install to
 *    the workspace root ABOVE the project folder;
 *  - a workspace member's own sibling packages resolve through SYMLINKS that
 *    land outside the project entirely (`@vgai/game-runtime` → `<repo>/packages/
 *    engine`), and Vite's `fs.allow` matches the symlink-RESOLVED path;
 *  - a git worktree shares one install, so even the walk-up `node_modules`
 *    can be a tree of links into another checkout.
 *
 * Measured live before this module existed, packaged editor + `examples/
 * retro-shooter`: `/@fs/<repo>/packages/project/src/adapter/index.ts` → HTTP
 * 403, i.e. the world's own engine imports were unreachable; and
 * `react-data-grid/lib/styles.css?inline` (the data-tables document's grid
 * stylesheet) came back `200 text/css` — RAW CSS where the importer expects a
 * JS module — because with the file outside `fs.allow` the transform never ran
 * and a raw-file route answered instead, which is what the browser reports as
 * "Failed to fetch dynamically imported module".
 *
 * ## What this computes instead
 *
 * The same directories NODE would resolve from, asked the same way Node asks:
 *
 *  1. every `node_modules` directory on the walk UP from the project (this is
 *     literally Node's module lookup path), realpath'd, existing ones only; and
 *  2. for each dependency the project's own `package.json` DECLARES, the real
 *     install root that dependency actually resolves to — the enclosing
 *     `node_modules` directory when it is a normal install (covering hoisting,
 *     symlinked worktree trees and pnpm's nested store), or the package's own
 *     real directory when it is a linked workspace sibling that lives outside
 *     any `node_modules` at all.
 *
 * Resolution is Node's (`createRequire` rooted at the project), never a
 * hand-rolled path guess, so a shape this comment did not anticipate is still
 * answered correctly. Entries contained in another entry are dropped, so the
 * result is the smallest set that covers the project's real module graph — it
 * never widens to "allow the whole filesystem" and never allows a directory no
 * declared dependency resolves into.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { searchForWorkspaceRoot } from 'vite';
import { isPathInside } from './server-utils';

/** Dependency fields whose entries a project's module graph can reach at
 *  serve time. `devDependencies` counts: the editor serves stories, tools and
 *  capability source, which import dev-only packages by design. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

function realDirectory(candidate: string): string | null {
  try {
    const real = realpathSync(candidate);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/**
 * Every `node_modules` directory Node would consult on the walk up from `dir`
 * — BOUNDED by the enclosing workspace root.
 *
 * The bound is Vite's own `searchForWorkspaceRoot` (lockfile / `workspaces`
 * field / `.git`), which is exactly what Vite uses to compute its DEFAULT
 * `fs.allow`, so this half of the set is no wider than the default a
 * project-rooted Vite would have chosen for itself. Unbounded, the walk keeps
 * climbing past the repository into `~/node_modules` and `/node_modules` —
 * directories no project's resolution meaningfully depends on and which have
 * no business in a serving allowlist. A dependency that genuinely does resolve
 * from above the workspace root is still covered, one package at a time, by
 * {@link packageServingRoot}.
 */
function walkUpNodeModules(dir: string): string[] {
  const found: string[] = [];
  const bound = path.resolve(searchForWorkspaceRoot(dir));
  let current = path.resolve(dir);
  for (;;) {
    if (path.basename(current) !== 'node_modules') {
      const real = realDirectory(path.join(current, 'node_modules'));
      if (real) found.push(real);
    }
    const parent = path.dirname(current);
    if (current === bound || parent === current) return found;
    current = parent;
  }
}

/** The declared dependency names of the project at `projectDir`, or `[]` when
 *  it has no readable `package.json` (a project that has not been installed
 *  yet still serves its own source; the walk-up set covers what exists). */
function declaredDependencies(projectDir: string): string[] {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(path.join(projectDir, 'package.json'), 'utf-8')) as Record<
      string,
      unknown
    >;
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const value = manifest[field];
    if (value && typeof value === 'object') {
      for (const name of Object.keys(value)) names.add(name);
    }
  }
  return [...names];
}

/**
 * The real directory serving `packageName` for a project rooted at
 * `projectDir`, or `null` when it does not resolve.
 *
 * For an ordinary install this is the ENCLOSING `node_modules` directory (so
 * one entry covers every package installed beside it, including the ones the
 * project only reaches transitively). For a linked workspace sibling — whose
 * real path contains no `node_modules` segment — it is that package's own
 * directory, which is as tight as the allow entry can honestly be.
 */
export function packageServingRoot(projectDir: string, packageName: string): string | null {
  // Rooted at the project's own `package.json`, the same discipline
  // `resolveInstalledPackageSrcDir` (server-utils.ts) uses.
  const require = createRequire(path.join(projectDir, 'package.json'));
  let resolved: string;
  try {
    // The manifest resolves for any package, including one whose `exports`
    // map hides its entry point from a bare specifier resolve.
    resolved = require.resolve(`${packageName}/package.json`);
  } catch {
    try {
      resolved = require.resolve(packageName);
    } catch {
      return null;
    }
  }
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    return null;
  }
  const segments = real.split(path.sep);
  const enclosing = segments.lastIndexOf('node_modules');
  if (enclosing >= 0) return segments.slice(0, enclosing + 1).join(path.sep);
  // A linked workspace sibling, which lives in no `node_modules` at all: allow
  // the package's own ROOT. Walking up to the nearest `package.json` rather
  // than taking the resolved file's directory, because the fallback resolve
  // above lands on the package's ENTRY (`<pkg>/src/index.ts` for a package
  // whose `exports` map hides `./package.json`), and allowing `<pkg>/src`
  // would serve the entry while 403'ing every sibling file it imports.
  return packageRootOf(path.dirname(real));
}

/** The nearest ancestor of `dir` (inclusive) that holds a `package.json`. */
function packageRootOf(dir: string): string | null {
  let current = dir;
  for (;;) {
    if (existsSync(path.join(current, 'package.json'))) return realDirectory(current);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Drop every entry contained in another entry. */
function minimalRoots(roots: readonly string[]): string[] {
  const unique = [...new Set(roots)].filter((root) => root.length > 0);
  return unique.filter(
    (root) => !unique.some((other) => other !== root && isPathInside(other, root)),
  );
}

/**
 * Every real directory a project-rooted Vite instance must be able to serve
 * from for the project's own module graph to resolve — the project itself
 * plus its real install roots.
 *
 * Boot-time (and open-project-time) computation: an install that appears
 * later is a dependency change, which already restarts or invalidates the
 * module graph through its own path.
 */
export function projectServingRoots(projectDir: string): string[] {
  const projectReal = realDirectory(projectDir) ?? path.resolve(projectDir);
  const roots = [projectReal, ...walkUpNodeModules(projectReal)];
  for (const name of declaredDependencies(projectReal)) {
    const root = packageServingRoot(projectReal, name);
    if (root && existsSync(root)) roots.push(root);
  }
  return minimalRoots(roots);
}
