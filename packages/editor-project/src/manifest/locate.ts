// Finding the project manifest ON DISK. There is ONE filename — see
// `./filename.ts` for why the old one was removed rather than kept readable.
//
// Deliberately dependency-light — `node:fs` + `node:path` + `./filename` and
// NOTHING else (no Zod, no `./load`). Several callers are explicitly
// schema-free by design (`packages/editor/server/project-root-surface.ts`,
// `packages/editor/vite-plugin-ui-oid.ts`) and must be able to locate a
// manifest without dragging the validator in.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  MANIFEST_FILENAME,
  REMOVED_MANIFEST_FILENAME,
  removedManifestFilenameMessage,
} from './filename';

/**
 * Throw the rename instruction if `dir` carries only the REMOVED manifest
 * filename. The `assertNoRemoved*` shape: a removed thing must reject loudly
 * naming the exact fix, never be silently ignored (which would present as
 * "this folder is not a project" — a diagnosis pointing nowhere).
 *
 * Returns normally when `dir` holds the current manifest, or neither file.
 */
export function assertNoRemovedManifestFilename(dir: string): void {
  if (existsSync(join(dir, MANIFEST_FILENAME))) return;
  if (!existsSync(join(dir, REMOVED_MANIFEST_FILENAME))) return;
  throw new Error(removedManifestFilenameMessage(join(dir, REMOVED_MANIFEST_FILENAME)));
}

/**
 * The manifest path inside `dir`. Always `vgai.project.json` — so a "not
 * found" message names the filename a project must be using — except that a
 * directory carrying only the removed `vgai.game.json` THROWS the rename
 * instruction instead of reporting a phantom path.
 *
 * This is the drop-in replacement for a hand-written `join(dir, …)` everywhere
 * a manifest is READ. Writers want {@link manifestWritePath}.
 */
export function resolveManifestPath(dir: string): string {
  assertNoRemovedManifestFilename(dir);
  return join(dir, MANIFEST_FILENAME);
}

/** True when `dir` holds a manifest. A lone `vgai.game.json` throws. */
export function hasManifest(dir: string): boolean {
  assertNoRemovedManifestFilename(dir);
  return existsSync(join(dir, MANIFEST_FILENAME));
}

/** Where a manifest gets WRITTEN in `dir`. There is one answer. */
export function manifestWritePath(dir: string): string {
  return join(dir, MANIFEST_FILENAME);
}
