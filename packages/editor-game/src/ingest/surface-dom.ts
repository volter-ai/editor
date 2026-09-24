/**
 * `dom`-surface MOUNT resolution for in-tree ingest fixtures (was
 * `ingest/discovery-react.ts`, which named React in a seam that is about the
 * DOM: a dom root may be React, Vue, Svelte or plain HTML).
 *
 * Discovery moved to `registry.ts` (one glob, one directory, dispatched on the
 * manifest's `surface`). What is left here is the per-surface part, and for
 * this surface it is small: a `dom` ingest root mounts through
 * `resolveRootBinding` (`roots/react-root.ts`'s `resolveIngestReactAdapter`,
 * N1) — the SAME `/@fs/`-dynamic-import + `createRoot` host stack `default-react`
 * uses — rather than a capture-based bridge, so there is no descriptor with its
 * own `load` thunk to build. The one thing the mount needs that discovery
 * cannot give it is the fixture's ABSOLUTE on-disk folder, which is what
 * {@link ingestGameDomProjectRoot} computes.
 *
 * `projectRoot` can't come from `import.meta.glob`/`import.meta.url` alone
 * (those resolve to HTTP URLs in the browser, not filesystem paths) — it is
 * built from `__VGAI_ENGINE_ROOT__` (a dev-server-only Vite `define`,
 * `server/dev.ts`, mirroring the existing `__VGAI_PROJECT_PATH__` define) plus
 * this folder's FIXED, known-at-build-time relative offset. `browser`
 * editor-mode builds (no dev server) never define `__VGAI_ENGINE_ROOT__` —
 * callers must check `getEditorMode() !== 'browser'` first (mirrors every other
 * `/@fs/`-dependent ingest route's guard, e.g. `ingest/mount-ingest-root.ts`'s
 * `tryManifestIngestRoute`).
 */

import { type IngestEntry, ingestEntriesOnSurface } from '../host/ingest/registry';
import type { ResolvedGameManifest } from '@volter/editor-project/manifest/load';

declare const __VGAI_ENGINE_ROOT__: string;

/** A discovered `dom`-surface ingest fixture: its parsed manifest (exactly one
 *  ingest root) plus that root's id for convenience. */
export interface IngestGameDom {
  readonly folderId: string;
  readonly manifest: ResolvedGameManifest;
  readonly worldId: string;
}

/** Validate a `dom` entry against the surface's v1 scope and project it into
 *  the shape the mount route consumes. */
export function buildIngestGameDom({ folderId, manifest, root }: IngestEntry): IngestGameDom {
  if (!root.entry) {
    throw new Error(
      `dom ingest discovery: "${folderId}" has no \`entry\` — a dom ingest root's \`entry\` ` +
        'must point at the host-shim module in the same folder (D-N2).',
    );
  }
  return { folderId, manifest, worldId: root.id };
}

let _cache: IngestGameDom[] | null = null;

/** Every in-tree `dom`-surface ingest fixture. */
export function discoverIngestGamesDom(): IngestGameDom[] {
  if (!_cache) {
    _cache = ingestEntriesOnSurface('dom')
      .map(buildIngestGameDom)
      .sort((a, b) => a.folderId.localeCompare(b.folderId));
  }
  return _cache;
}

/** Look up one discovered dom ingest fixture by its folder id (the same id
 *  resolution — the folder id IS the root id by convention, one root per
 *  manifest, but callers should key off `folderId` since that's what the URL
 *  param names). */
export function getIngestGameDom(folderId: string): IngestGameDom | undefined {
  return discoverIngestGamesDom().find((g) => g.folderId === folderId);
}

/**
 * The absolute on-disk `projectRoot` for a discovered dom ingest fixture's
 * folder — what `resolveRootBinding`/`resolveAllRoots` need to resolve its
 * `entry`. `undefined` when `__VGAI_ENGINE_ROOT__` isn't defined (browser-mode
 * static build — no dev server, no `/@fs/` route to resolve through anyway).
 */
export function ingestGameDomProjectRoot(folderId: string): string | undefined {
  if (typeof __VGAI_ENGINE_ROOT__ !== 'string' || !__VGAI_ENGINE_ROOT__) return undefined;
  const root = __VGAI_ENGINE_ROOT__.endsWith('/')
    ? __VGAI_ENGINE_ROOT__.slice(0, -1)
    : __VGAI_ENGINE_ROOT__;
  return `${root}/packages/editor/src/ingest/games/${folderId}`;
}
