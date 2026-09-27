/**
 * Editor → Learn-site linkage (G6).
 *
 * The whole editor→site half of the FTUE deep-link contract lives here:
 * the Help/Learn menu's destinations (`ApplicationMenus.tsx`) and the
 * read-only example viewer's lesson affordance (`status-contributions.tsx`)
 * both consume these helpers, so the URL shapes are stated exactly once.
 *
 * Reference links are VERSION-PINNED: the zero-base platform-vertical plan
 * serves immutable per-minor snapshots at `/reference/<major>.<minor>/` with
 * `/reference/latest/` as an explicit 302 alias — so a project pinned to
 * engine 0.5.x links `/reference/0.5/` and keeps meaning that engine forever.
 * The pin is derived from the project's `engine.version` manifest field (an
 * identity pin, not a range — @volter/editor-project/manifest/schema). When the version is
 * missing or unparseable (or the `0.0.x` dev placeholder), we fall back to
 * the unpinned reference root rather than fabricating a snapshot that can
 * never exist.
 */

/** Learn-site origin (site/astro.config.mjs `site`). */
export const LEARN_SITE_URL = 'https://vgai-learn.pages.dev/';

/** Quick-starts landing (site/src/content/x). */
export const LEARN_QUICK_STARTS_URL = `${LEARN_SITE_URL}quick-starts/`;

/** Manual landing (site/src/content/x). */
export const LEARN_MANUAL_URL = `${LEARN_SITE_URL}manual/`;

/** Unpinned reference root — the fallback when no engine version is known. */
export const LEARN_REFERENCE_ROOT_URL = `${LEARN_SITE_URL}reference/`;

/**
 * The `<major>.<minor>` reference-snapshot pin for an engine version, or null
 * when the version cannot honestly name a snapshot: missing, unparseable, or
 * the `0.0.x` never-released dev placeholder. Prerelease/build suffixes
 * (`0.5.0-rc.1`) still pin their minor — the snapshot contract is per-minor.
 */
export function referenceVersionPin(engineVersion: string | null | undefined): string | null {
  const match = /^(\d+)\.(\d+)(?:[.+-]|$)/.exec(engineVersion?.trim() ?? '');
  if (!match) return null;
  const pin = `${Number(match[1])}.${Number(match[2])}`;
  return pin === '0.0' ? null : pin;
}

/**
 * Version-pinned Reference URL (`/reference/<major>.<minor>/`) for the given
 * engine version; the unpinned reference root when no pin can be derived.
 */
export function learnReferenceUrl(engineVersion: string | null | undefined): string {
  const pin = referenceVersionPin(engineVersion);
  return pin === null ? LEARN_REFERENCE_ROOT_URL : `${LEARN_REFERENCE_ROOT_URL}${pin}/`;
}

/**
 * A lesson URL from example `learn` metadata (FT-5), validated to an http(s)
 * absolute URL — manifests are project-authored content, so anything else
 * (relative paths, other schemes) renders no link rather than a broken or
 * unsafe one. Returns null when absent or invalid.
 */
export function safeLessonUrl(lesson: string | null | undefined): string | null {
  if (!lesson) return null;
  try {
    const url = new URL(lesson);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Open a Learn-site destination in a new tab (§6: all Help links open out). */
export function openLearnLink(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
