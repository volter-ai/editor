/**
 * An `ingest-pixi` root's descriptor — the canvas sibling of
 * `./resolve-three.ts`, and here for the same reason: served-bundle vs `/@fs/`
 * is a per-PROJECT property, not a per-realm one.
 */

import type { IngestGame2D } from '@volter/game-runtime/pixi/ingest';
import type { ResolvedAdapterRoot } from '@volter/editor-project/manifest/load';
import { composeIngestLoad } from './entry-load';
import { ingestModuleLoaders } from './resolve-three';

/**
 * Build the {@link IngestGame2D} descriptor an `ingest-pixi` world resolves
 * to, straight from its manifest fields: the world's `entry` becomes a
 * `load()` thunk over the same loader pair the three lane uses, so the game's
 * modules are served with `pixi.js` deduped to the editor's own instance — and,
 * for a served bundle, over the served-URL route instead.
 */
export function resolveIngest2DDescriptor(
  world: ResolvedAdapterRoot,
  projectRoot: string,
): IngestGame2D {
  const { adapter } = world;
  if (adapter.type !== 'ingest') {
    throw new Error(`resolveIngest2DDescriptor: world "${world.id}" is not an { ingest } world.`);
  }
  if (!world.entry) {
    throw new Error(
      `resolveIngest2DDescriptor: world "${world.id}" has no \`entry\` — an ingest root mounts ` +
        "the game's own entry module.",
    );
  }

  const loaders = ingestModuleLoaders(projectRoot);
  return {
    id: world.id,
    name: world.id,
    description: world.description ?? '',
    ...(adapter.captureTimeoutMs !== undefined
      ? { captureTimeoutMs: adapter.captureTimeoutMs }
      : {}),
    load: composeIngestLoad(
      loaders.entry(world.entry),
      adapter.contractShim === undefined ? undefined : loaders.module(adapter.contractShim),
    ),
  };
}
