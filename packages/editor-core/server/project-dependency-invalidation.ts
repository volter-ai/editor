import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectModuleLoader } from './project-tools';

/**
 * Makes a live editor session see dependencies installed UNDER it.
 *
 * The problem, measured: `vgai add mesh` copies `src/lib/mesh/**` in and runs
 * `npm install three-bvh-csg …`, but a session that is already running keeps
 * failing every Node module-lane call with
 * `Cannot find module 'three-bvh-csg' imported from …/src/lib/mesh/modifiers.ts`
 * — while `require.resolve` from the very same project directory succeeds.
 *
 * The mechanism is a cached FAILURE, not a cached resolution. Vite's SSR
 * module runner memoises a module's load promise on its module-graph node and
 * never clears it when that promise REJECTS
 * (`vite/dist/node/module-runner.js`, `cachedRequest`: `mod.promise = promise`
 * inside a `try`/`finally` that only flips `evaluated`). So the first load of
 * `modifiers.ts` attempted before the package existed poisons that module for
 * the life of the process, and every later call replays the identical
 * rejection — including calls from brand-new files that merely import it. The
 * poison is per-module, not per-package: a fresh module importing
 * `three-bvh-csg` DIRECTLY resolves it fine at the same moment.
 *
 * That also explains the two things the symptom report noted. Editing the
 * importing file "fixes" it, because an HMR invalidation drops the module
 * node together with its rejected promise. And `vgai restart` does not, because
 * it re-issues `play` to the browser and never touches this Node process.
 *
 * The fix is to perform that same invalidation when the project's dependency
 * set moves. This is checked ON USE rather than from a file watcher on
 * purpose: `vgai add` installs and returns, and the next thing a caller does
 * is run the tool. A debounced watcher races that window; a fingerprint read
 * at load time cannot.
 */

/**
 * Files whose contents define which packages a project has. `package.json`
 * alone is not enough — a bare `npm install` that only writes the lockfile
 * still changes what is resolvable — and the lockfile alone is not enough
 * either, since `vgai add` merges dependencies into `package.json` first.
 */
export const DEPENDENCY_MANIFEST_FILES = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
] as const;

/**
 * Cheap stat-based fingerprint of a project's dependency manifests. Size is
 * carried alongside mtime because an install that lands inside one filesystem
 * timestamp tick still changes the file's length.
 */
export function dependencyManifestFingerprint(projectRoot: string): string {
  return DEPENDENCY_MANIFEST_FILES.map((name) => {
    try {
      const stats = statSync(join(projectRoot, name));
      return `${name}:${stats.mtimeMs}:${stats.size}`;
    } catch {
      return `${name}:-`;
    }
  }).join('|');
}

export interface DependencyChangeInvalidationDeps {
  /** Read live — the open project changes at runtime. */
  getProjectRoot: () => string;
  /**
   * Drop everything the Node module lane has cached for this project. The
   * owning dev server implements it as
   * `vite.environments.ssr.moduleGraph.invalidateAll()`; a host without a
   * bundler (the static production server) has nothing to invalidate and
   * omits it, leaving the loader a plain pass-through.
   */
  invalidateModules?: (() => void) | undefined;
}

/**
 * Wraps a project-module loader so a dependency change invalidates the cached
 * module graph before the next load. Returns `undefined` for an absent loader
 * so hosts that never load project modules stay unchanged.
 */
export function withDependencyChangeInvalidation(
  load: ProjectModuleLoader | undefined,
  deps: DependencyChangeInvalidationDeps,
): ProjectModuleLoader | undefined {
  if (!load) return undefined;
  const { getProjectRoot, invalidateModules } = deps;
  if (!invalidateModules) return load;

  let lastProjectRoot: string | null = null;
  let lastFingerprint: string | null = null;

  return async (absoluteModuleId: string): Promise<unknown> => {
    const projectRoot = getProjectRoot();
    const fingerprint = dependencyManifestFingerprint(projectRoot);
    // A different project is a fresh baseline, never an invalidation: opening
    // a project already rebuilds what the graph holds for it.
    if (
      lastProjectRoot === projectRoot &&
      lastFingerprint !== null &&
      lastFingerprint !== fingerprint
    ) {
      invalidateModules();
    }
    lastProjectRoot = projectRoot;
    lastFingerprint = fingerprint;
    return load(absoluteModuleId);
  };
}
