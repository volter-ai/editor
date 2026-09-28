/**
 * The import's reachability phase (docs/GODOT.md §The lane's law, row 6), between emit and
 * materialize: a capability's module ships only when an import chain from the game's own files
 * reaches it, as a bundler follows the same imports. Its manifest and license files ship with any
 * module of it. Emit prints every planned artifact; this phase alone decides what ships.
 */
import * as path from 'node:path';
import type { GodotEmittedArtifact } from './translate/artifacts/types';
import { type GodotEmittedArtifactSet, withoutCapabilityCopies } from './translate/emit';

const decoder = new TextDecoder();

/** Module specifiers a TypeScript file names: static and side-effect imports, re-exports, `import()`, `new URL(…, import.meta.url)`. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/gu,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.push(match[1] as string);
  return found;
}

/** The emitted file a relative specifier names from `from`, if any. */
function resolve(from: string, specifier: string, paths: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier.replace(/\?[^/]*$/u, '')));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (paths.has(candidate)) return candidate;
  }
  return undefined;
}

/** The capability directory a copied file belongs to (`src/lib/godot-compat`). */
function capabilityRoot(file: string): string {
  const parts = file.split('/');
  return parts.slice(0, 3).join('/');
}

const isCode = (file: string) => /\.(ts|tsx|mts|js|mjs)$/u.test(file);

/** The emitted set without the capability copies the game never reaches. */
export function reachableGodotTranslation(set: GodotEmittedArtifactSet): GodotEmittedArtifactSet {
  const artifacts: readonly GodotEmittedArtifact[] = set.artifacts;
  const byPath = new Map(artifacts.filter((artifact) => artifact.role === 'primary').map((artifact) => [artifact.path, artifact] as const));
  const paths = new Set(byPath.keys());
  const reached = new Set<string>();
  const queue = artifacts.filter((artifact) => artifact.role === 'primary' && artifact.kind !== 'capability-copy' && isCode(artifact.path)).map((artifact) => artifact.path);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    const artifact = byPath.get(file);
    if (artifact === undefined || !isCode(file)) continue;
    for (const specifier of specifiers(decoder.decode(artifact.bytes))) {
      const target = resolve(file, specifier, paths);
      if (target === undefined || byPath.get(target)?.kind !== 'capability-copy' || reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  // A capability any of whose modules ships keeps its manifest and licenses.
  const shipped = new Set([...reached].map(capabilityRoot));
  const drop = new Set<string>();
  for (const artifact of artifacts) {
    if (artifact.kind !== 'capability-copy') continue;
    const file = artifact.role === 'primary' ? artifact.path : artifact.path.replace(/\.map$/u, '');
    const keep = reached.has(file) || (!isCode(file) && shipped.has(capabilityRoot(file)) && !/\.(woff2?|ttf|otf|png|wasm)$/u.test(file));
    if (!keep) drop.add(file);
  }
  return withoutCapabilityCopies(set, drop);
}
