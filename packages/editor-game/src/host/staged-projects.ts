/**
 * THE STAGED PROJECTS' ADDRESSES — where this editor build serves the games
 * it vendors as servable bundles (`public/ingest/<id>/`, the repo's
 * `vendor/games` locks), the way `/examples/<id>/` serves its examples.
 * Staged content is the HOST's catalog: the New Project screen's IMPORTED
 * group (`imported-gallery.ts`, the generated gallery) and the in-tree fixture
 * registry (`ingest/registry.ts`) read these; the LANE that mounts an
 * unmodified game (`@vgai/game`'s `src/ingest/`) resolves a
 * staged manifest to a mountable game from the same addresses.
 */

/** Root-relative base every vendored ingest is served under. */
export const PUBLIC_INGEST_BASE = '/ingest/';

/** A single path segment: no separators, no traversal, no query/hash. */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeIngestId(id: string): boolean {
  return SAFE_ID_RE.test(id) && id !== '.' && id !== '..';
}

export function publicIngestManifestUrl(id: string): string {
  return `${PUBLIC_INGEST_BASE}${id}/vgai.project.json`;
}
