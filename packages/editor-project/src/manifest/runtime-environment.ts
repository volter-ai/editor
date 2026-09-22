/**
 * THE RUNTIME HALF OF A PROJECT'S ENVIRONMENT (ARCHITECTURE-CORE §The
 * project model, "environment"): the Node version a project's processes need
 * is declared ONCE, where the ecosystem already declares it —
 * `package.json` `engines.node` — and read here by whatever starts a
 * `process` configuration (the editor server's configurations route, the
 * CLI's autoboot). The manifest carries no `environment` key: a second
 * declaration of the same fact is the drift a single home prevents.
 *
 * Node-only (reads the project folder), like `locate.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';

/** `engines.node` from the project's `package.json`, or `null` when the
 *  project declares none (or has no package.json). */
export function declaredNodeRange(projectDir: string): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
    const engines = (raw as { engines?: { node?: unknown } } | null)?.engines;
    return typeof engines?.node === 'string' && engines.node.trim() ? engines.node.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Why a process of this project cannot start on the running Node, spelled
 * for the person who will fix it — or `null` when it can. A range that is
 * not valid semver is itself the issue: a declaration nobody can satisfy is
 * named, never skipped.
 */
export function nodeRuntimeIssue(
  projectDir: string,
  running: string = process.versions.node,
): string | null {
  const range = declaredNodeRange(projectDir);
  if (range === null) return null;
  if (semver.validRange(range) === null) {
    return `package.json declares engines.node "${range}", which is not a semver range`;
  }
  if (semver.satisfies(running, range, { includePrerelease: true })) return null;
  return (
    `package.json declares engines.node "${range}" and this host runs Node ${running} — ` +
    `run the editor and \`vgai\` on a Node that satisfies it, or change engines.node`
  );
}
