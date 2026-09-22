// T3.1 slice 1 — Node-only path wrapper around `loadGameManifest` (§5).
//
// Kept in its own module (rather than folded into `load.ts`) so that
// `loadGameManifest` itself stays free of `node:fs` — anything that only
// needs the pure parse/resolve function (e.g. a future browser/hosted-editor
// caller) can import `./load` without pulling a Node-only module into its
// bundle.

import { readFileSync } from 'node:fs';
import { type LoadGameManifestOptions, loadGameManifest, type ResolvedGameManifest } from './load';
import { resolveManifestPath } from './locate';

// The dual-name filesystem lookup lives in `./locate` (Zod-free on purpose);
// re-exported here so the common "load a project's manifest" import is one
// module.
export { hasManifest, manifestWritePath, resolveManifestPath } from './locate';

/** Read + JSON.parse `path`, then resolve it via `loadGameManifest`. Node-only. */
export function loadGameManifestFile(
  path: string,
  options: LoadGameManifestOptions = {},
): ResolvedGameManifest {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return loadGameManifest(raw, options);
}

/** {@link loadGameManifestFile} against `dir`'s `vgai.project.json`. */
export function loadGameManifestDir(
  dir: string,
  options: LoadGameManifestOptions = {},
): ResolvedGameManifest {
  return loadGameManifestFile(resolveManifestPath(dir), options);
}
