/**
 * The editor server's intake of a project's CONFIGURATION-KIND
 * CONTRIBUTIONS (ARCHITECTURE-CORE §The project model): every
 * `src/contributions/*.kind.ts` is evaluated through the same Vite SSR loader the
 * operation catalog uses, and its `kind` export is registered in THIS
 * process's engine registry before the manifest is read. Memoized on the
 * modules' paths and mtimes, so a route pays nothing until a kind file
 * changes.
 */

import { statSync } from 'node:fs';
import {
  contributedKindModulePaths,
  registerKindModule,
} from '@volter/editor-project/manifest/kind-modules';
import type { ProjectModuleLoader } from './project-tools';

let loader: ProjectModuleLoader | null = null;
let signature = '';
let unregister: Array<() => void> = [];
let loadErrors: string[] = [];

/** The loader the server evaluates project modules with; set once at boot. */
export function setKindModuleLoader(next: ProjectModuleLoader | null): void {
  loader = next;
}

export function kindModuleLoader(): ProjectModuleLoader | null {
  return loader;
}

function currentSignature(paths: readonly string[]): string {
  return paths
    .map((path) => {
      try {
        return `${path}@${statSync(path).mtimeMs}`;
      } catch {
        return `${path}@gone`;
      }
    })
    .join('|');
}

/** Register the project's kinds if their files changed since the last call.
 *  Returns the load errors, which the caller surfaces by name. */
export async function ensureProjectConfigurationKinds(
  projectRoot: string,
): Promise<readonly string[]> {
  const paths = contributedKindModulePaths(projectRoot);
  const next = `${projectRoot}::${currentSignature(paths)}`;
  if (next === signature) return loadErrors;
  for (const off of unregister) off();
  unregister = [];
  loadErrors = [];
  if (paths.length > 0 && !loader) {
    loadErrors.push(
      "configuration kinds need the editor server's module host, which this session has not started",
    );
  } else {
    for (const path of paths) {
      try {
        const module = await (loader as ProjectModuleLoader)(path);
        unregister.push(registerKindModule(module, path));
      } catch (error) {
        loadErrors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  signature = next;
  return loadErrors;
}
