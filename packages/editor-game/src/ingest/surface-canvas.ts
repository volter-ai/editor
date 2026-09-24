/**
 * `canvas`-surface MOUNT builder for in-tree ingest fixtures (was
 * `ingest/discovery2d.ts`, whose name and glob both said "2d/pixi" about a
 * surface that is a platform primitive: a canvas root may be Pixi, Phaser,
 * Babylon, raw WebGL/WebGPU or a 2D context).
 *
 * Discovery moved to `registry.ts` (one glob, one directory, dispatched on the
 * manifest's `surface`). What is left here is the genuinely per-surface part:
 * turning a `canvas` entry into the `IngestGame2D` descriptor
 * `ingest/mount-canvas-ingest-root.ts` mounts.
 *
 * ID CONTINUITY (§1.E/§1.G): each fixture's root id is UNCHANGED from its
 * registry-era id (`bunnymark`/`flappy`/`tilemap-camera`, no `2d-` prefix).
 */

import {
  entryModules,
  gameFileKey,
  type IngestEntry,
  ingestEntriesOnSurface,
} from '@editor/ingest/registry';
import type { IngestGame2D } from '@vgai/game-runtime/pixi/ingest';
import { composeIngestLoad } from './entry-load';

type BaseFields2D = Pick<IngestGame2D, 'id' | 'name' | 'description' | 'captureTimeoutMs'>;

function fixtureModuleLoader(folderId: string, relPath: string): () => Promise<unknown> {
  const key = gameFileKey(folderId, relPath);
  const load = entryModules[key];
  if (!load) {
    throw new Error(
      `canvas ingest discovery: "${folderId}"'s module "${relPath}" did not match any game ` +
        `module (looked for glob key "${key}").`,
    );
  }
  return load;
}

/** Build the mountable `IngestGame2D` for one `canvas`-surface registry entry. */
export function buildIngestGame2D({ folderId, manifest, root }: IngestEntry): IngestGame2D {
  const { adapter } = root;
  if (!root.entry) {
    throw new Error(
      `canvas ingest discovery: "${folderId}" has no \`entry\` — an ingest root mounts the ` +
        "game's own entry module.",
    );
  }

  const base: BaseFields2D = {
    id: root.id,
    name: manifest.name,
    description: root.description ?? '',
    ...(adapter.captureTimeoutMs !== undefined
      ? { captureTimeoutMs: adapter.captureTimeoutMs }
      : {}),
  };

  return {
    ...base,
    load: composeIngestLoad(
      fixtureModuleLoader(folderId, root.entry),
      adapter.contractShim === undefined
        ? undefined
        : fixtureModuleLoader(folderId, adapter.contractShim),
    ),
  };
}

let _cache: IngestGame2D[] | null = null;

/** Every in-tree `canvas`-surface ingest fixture. */
export function discoverIngestGames2D(): IngestGame2D[] {
  if (!_cache) {
    _cache = ingestEntriesOnSurface('canvas')
      .map(buildIngestGame2D)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  return _cache;
}

/** Look up one discovered canvas ingest game by id. */
export function getIngestGame2D(id: string): IngestGame2D | undefined {
  return discoverIngestGames2D().find((g) => g.id === id);
}
