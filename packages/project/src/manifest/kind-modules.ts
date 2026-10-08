/**
 * Where a project's CONFIGURATION-KIND CONTRIBUTIONS live and how a host
 * takes them in (ARCHITECTURE-CORE §The project model). A module named
 * `src/contributions/<name>.kind.ts` (or `.tsx`) exports `kind`, a plain
 * `ConfigurationKindContribution`; the HOST that loads the manifest — the
 * editor server through Vite's SSR loader, a project's own validate script
 * through tsx — imports each and registers it in its own registry through
 * {@link registerContributedConfigurationKind}. Node-only: it walks the
 * project folder.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { registerContributedConfigurationKind } from './configuration-kinds';

const KIND_SUFFIXES = ['.kind.ts', '.kind.tsx'] as const;

/** Whether one file name is a kind contribution by the convention. */
export function isConfigurationKindModule(fileName: string): boolean {
  return KIND_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

/** Absolute paths of the project's kind contributions, sorted. */
export function contributedKindModulePaths(projectDir: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const absolute = join(directory, name);
      let isDirectory = false;
      try {
        isDirectory = statSync(absolute).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) walk(absolute);
      else if (isConfigurationKindModule(name)) found.push(absolute);
    }
  };
  walk(join(projectDir, 'src', 'contributions'));
  return found.sort();
}

/** Register the `kind` export of an already-imported module; the source
 *  path names the module in a refusal. */
export function registerKindModule(module: unknown, source: string): () => void {
  const exported = (module as { kind?: unknown } | null)?.kind;
  if (exported === undefined) {
    throw new Error(`${source}: a kind contribution must export \`kind\``);
  }
  return registerContributedConfigurationKind(exported, source);
}
