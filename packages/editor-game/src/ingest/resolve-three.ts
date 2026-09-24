/**
 * An `ingest-three` root's descriptor, built straight from its manifest fields.
 *
 * This lives with the rest of the ingest code, NOT in `RealmServices`, because
 * the choice it makes is a PER-PROJECT property rather than a per-realm one:
 * whether this game's modules are reached by URL (its folder is a served
 * bundle under the editor's own `public/`) or by `/@fs/` is decided by how
 * that one game was vendored, and two ingested games open in the same realm
 * can answer differently. A realm cannot know it; only the project can.
 */

import {
  beginProjectMountEpoch,
  fsImportPath,
  INGEST_REMOUNT_QUERY,
} from '@volter/editor-sdk/session/project-module-url';
import type { ResolvedAdapterRoot } from '@volter/editor-project/manifest/load';
import { composeIngestLoad, declaredSourceModules, ingestDataWriter } from './entry-load';
import { servedEntryLoader, servedModuleLoader, servedProjectBaseUrl } from './served-bundle';
import type { IngestGame } from './types';

/**
 * How THIS project's ingest modules are reached: by URL when the folder is a
 * SERVED BUNDLE under the editor's own `public/`, by `/@fs/` otherwise.
 *
 * Vite refuses to put a file inside its `public/` directory into the module
 * graph at all, so `/@fs/` is not merely suboptimal there — it is a 500. See
 * `./served-bundle.ts` for the measured failure and the rule it restores.
 *
 * THE TWO SURFACES WANT OPPOSITE REUSE, so `remountEpochs` is a parameter
 * rather than a policy:
 *
 *  - A THREE ingest's teardown disposes the R3F root, so a remount MUST
 *    re-evaluate the entry — `remountEpochs: true` gives every `load()` its
 *    own `?vgai-ingest-remount=` buster (see `INGEST_REMOUNT_QUERY` for why
 *    it is deliberately NOT `vgai-mount`, whose realm-keying and subgraph
 *    stamping the ingest readers cannot follow; an ingest's `load` IS its
 *    mount). A bare URL made stop → ▶ a NO-OP: browser module identity is
 *    per-URL, the already-evaluated entry's top-level boot did not re-run,
 *    nothing rendered, and the mount failed by name after the 10s measured
 *    wait — measured on racing-game, 2026-08-21.
 *  - A CANVAS ingest's module-scope `Application` SURVIVES teardown and the
 *    remount re-adopts it through the render trap — the cached no-op
 *    re-import is the design. Busting it evaluated a SECOND app whose asset
 *    load died against the realm's already-populated singleton registries
 *    (pixi-sound's alias table) and the play mount failed "rendered no
 *    capturable frame" — measured on bubbo-bubbo the same day, by the same
 *    edit that fixed racing.
 *
 * The served-bundle lane is already fresh per call (it evaluates a new blob
 * URL each time) and takes no query either way.
 */
export function ingestModuleLoaders(
  projectRoot: string,
  options: { remountEpochs: boolean } = { remountEpochs: false },
): {
  entry: (relPath: string) => () => Promise<unknown>;
  module: (relPath: string) => () => Promise<unknown>;
} {
  const servedBase = servedProjectBaseUrl(projectRoot);
  if (servedBase === undefined) {
    const fs = (rel: string) => () =>
      import(
        /* @vite-ignore */ options.remountEpochs
          ? `${fsImportPath(projectRoot, rel)}?${INGEST_REMOUNT_QUERY}=${beginProjectMountEpoch()}`
          : fsImportPath(projectRoot, rel)
      );
    return { entry: fs, module: fs };
  }
  return {
    entry: (rel) => servedEntryLoader(servedBase, rel),
    module: (rel) => servedModuleLoader(servedBase, rel),
  };
}

/**
 * Build the {@link IngestGame} descriptor an `ingest-three` world resolves to,
 * straight from its manifest fields — deliberately WITHOUT looking up any
 * registry, because there is none: the in-tree fixture games are discovered by
 * `./surface-three.ts`'s own `import.meta.glob`, and this function is the
 * builder for the other half — an arbitrary manifest-backed project folder
 * never registered in source (the CLI-on-folder route).
 *
 * The world's `entry` resolves to `IngestGame.load` through
 * {@link ingestModuleLoaders}, so the game's modules are served by the dev
 * server with `three` deduped to the editor's own instance — unless the folder
 * is a served bundle, which Vite refuses to import at all.
 */
export function resolveIngestDescriptor(
  world: ResolvedAdapterRoot,
  projectRoot: string,
): IngestGame {
  const { adapter } = world;
  if (adapter.type !== 'ingest') {
    throw new Error(`resolveIngestDescriptor: world "${world.id}" is not an { ingest } world.`);
  }
  if (!world.entry) {
    throw new Error(
      `resolveIngestDescriptor: world "${world.id}" has no \`entry\` — an ingest root mounts ` +
        "the game's own entry module.",
    );
  }

  const loaders = ingestModuleLoaders(projectRoot, { remountEpochs: true });
  return {
    id: world.id,
    name: world.id,
    description: world.description ?? '',
    // The lane decision's scope (see `IngestGame.sourceModules`): a vendored
    // game's TSX lives OUTSIDE the project folder, named only by these paths.
    sourceModules: declaredSourceModules(world.entry, world.world?.entry),
    ...ingestDataWriter(adapter.dataWriter, loaders.module),
    ...(adapter.assets !== undefined ? { assets: adapter.assets } : {}),
    ...(adapter.domStubs !== undefined ? { domStubs: adapter.domStubs } : {}),
    ...(adapter.captureTimeoutMs !== undefined
      ? { captureTimeoutMs: adapter.captureTimeoutMs }
      : {}),
    load: composeIngestLoad(
      loaders.entry(world.entry),
      adapter.contractShim === undefined ? undefined : loaders.module(adapter.contractShim),
    ),
  };
}
