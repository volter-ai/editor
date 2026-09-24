/**
 * `three`-surface MOUNT builder for in-tree ingest fixtures (was
 * `ingest/discovery.ts`, which owned its own glob of `games/*`).
 *
 * Discovery is no longer here: `registry.ts` does the one glob over
 * `./games/*\/vgai.project.json` and hands back parsed entries. This module's only
 * job is turning a `three`-surface entry into the `IngestGame` descriptor
 * `ingest/mount-ingest-root.ts` mounts — which is genuinely per-surface work, and is why the
 * builders stayed split when discovery was unified.
 *
 * Module-loading choice (kept from the original): these are IN-TREE fixtures
 * Vite already knows statically, so the descriptor is built from
 * `import.meta.glob`s (`registry.ts` owns them) rather than through
 * `resolveIngestDescriptor`'s `/@fs/` dynamic-import route, which exists for an
 * EXTERNAL project folder:
 *   - entry modules (LAZY thunks) for the game's own entry (and its
 *     `contractShim`, when it declares one);
 *   - `?url` asset globs for the manifest's `assets` map.
 */

import {
  assetUrls,
  entryModules,
  gameFileKey,
  type IngestEntry,
  ingestEntriesOnSurface,
} from '@editor/ingest/registry';
import { composeIngestLoad, declaredSourceModules, ingestDataWriter } from './entry-load';
import type { IngestGame } from './types';

function resolveAssetUrls(
  folderId: string,
  assets: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [pathSubstring, relPath] of Object.entries(assets)) {
    const key = gameFileKey(folderId, relPath);
    const url = assetUrls[key];
    if (!url) {
      throw new Error(
        `ingest discovery: "${folderId}"'s asset "${relPath}" did not match any served asset ` +
          `(looked for glob key "${key}" — available: ${Object.keys(assetUrls).join(', ')})`,
      );
    }
    resolved[pathSubstring] = url;
  }
  return resolved;
}

type BaseFields = Pick<
  IngestGame,
  | 'id'
  | 'name'
  | 'description'
  | 'assets'
  | 'domStubs'
  | 'captureTimeoutMs'
  | 'gameVersion'
  | 'sourceModules'
>;

/** The entry-module glob's thunk for one folder-relative module path. */
export function fixtureModuleLoader(folderId: string, relPath: string): () => Promise<unknown> {
  const key = gameFileKey(folderId, relPath);
  const load = entryModules[key];
  if (!load) {
    throw new Error(
      `ingest discovery: "${folderId}"'s module "${relPath}" did not match any game ` +
        `module (looked for glob key "${key}").`,
    );
  }
  return load;
}

/** Build the mountable `IngestGame` for one `three`-surface registry entry. */
export function buildIngestGame({ folderId, manifest, root }: IngestEntry): IngestGame {
  const { adapter } = root;
  if (!root.entry) {
    throw new Error(
      `ingest discovery: "${folderId}" has no \`entry\` — an ingest root mounts the game's own ` +
        'entry module.',
    );
  }

  const base: BaseFields = {
    id: root.id,
    name: manifest.name,
    description: root.description ?? '',
    // The manifest's own `version`, so a later mount can compare a saved
    // overlay's `authoredAgainst.gameVersion` against what's currently
    // running.
    gameVersion: manifest.version,
    sourceModules: declaredSourceModules(root.entry, root.world?.entry),
    ...ingestDataWriter(adapter.dataWriter, (rel) => fixtureModuleLoader(folderId, rel)),
    ...(adapter.assets !== undefined ? { assets: resolveAssetUrls(folderId, adapter.assets) } : {}),
    ...(adapter.domStubs !== undefined ? { domStubs: adapter.domStubs } : {}),
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

let _cache: IngestGame[] | null = null;

/** Every in-tree `three`-surface ingest fixture. */
export function discoverIngestGames(): IngestGame[] {
  if (!_cache) {
    _cache = ingestEntriesOnSurface('three')
      .map(buildIngestGame)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  return _cache;
}

/** Look up one discovered three ingest game by its folder id. */
export function getIngestGame(id: string): IngestGame | undefined {
  return discoverIngestGames().find((g) => g.id === id);
}
