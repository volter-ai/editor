import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/**
 * THE PACKAGE THIS REPORTS ON is `@vgai/game-runtime` — the one whose dual
 * resolution is the failure this diagnostic exists for: two copies mean two
 * `WorldProvider` contexts and `useGame` cannot see the one wrapping the tree.
 * The contract and the three.js twin carry no React context of their own.
 */
export const REPORTED_RUNTIME_PACKAGE = '@vgai/game-runtime';

export interface ProjectPackageOrigin {
  name: typeof REPORTED_RUNTIME_PACKAGE;
  version: string | null;
  path: string;
  installPath: string;
  linked: boolean;
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Resolve the game runtime exactly as project code does, then report whether npm's
 * installation entry is a symlink. This is diagnostic only: it never changes
 * resolution and never searches for a sibling checkout. */
export function projectEnginePackageOrigin(projectRoot: string): ProjectPackageOrigin | null {
  try {
    const projectRequire = createRequire(join(projectRoot, 'package.json'));
    const resolvedManifest = projectRequire.resolve(`${REPORTED_RUNTIME_PACKAGE}/package.json`);
    const resolvedPackageDir = dirname(resolvedManifest);
    const searchPaths = projectRequire.resolve.paths(REPORTED_RUNTIME_PACKAGE) ?? [];
    const installPath =
      searchPaths
        .map((base) => join(base, '@vgai', 'game-runtime'))
        .find(
          (candidate) =>
            existsSync(candidate) && canonical(candidate) === canonical(resolvedPackageDir),
        ) ?? resolvedPackageDir;
    const manifest = JSON.parse(readFileSync(resolvedManifest, 'utf8')) as { version?: unknown };
    return {
      name: REPORTED_RUNTIME_PACKAGE,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      path: canonical(resolvedPackageDir),
      installPath,
      linked: installPath !== resolvedPackageDir && lstatSync(installPath).isSymbolicLink(),
    };
  } catch {
    return null;
  }
}

export function formatProjectPackageOriginLine(origin: ProjectPackageOrigin): string {
  const version = origin.version ?? 'unknown version';
  return origin.linked
    ? `project runtime package: ${origin.name}@${version} (linked from ${origin.path})`
    : `project runtime package: ${origin.name}@${version} (installed at ${origin.path})`;
}
