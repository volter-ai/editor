/**
 * The asset ROOTS Content lists, and the one place a row's root plus its
 * root-relative path becomes a project path or a URL.
 *
 * `public/` is the shipped game's assets; `references/` is reference material
 * that lives in the project and is deliberately NOT shipped (see
 * `@vgai/sdk/output-roots` for the writer's half of the same rule). Both are
 * ordinary directories of ordinary files — there is no reference database, no
 * import step, and no copy into `public/` to make something appear.
 *
 * Why a reference is addressed through `/project-game-static/`: that middleware
 * (`vite-plugin-project-game-static.ts`) already serves the CURRENTLY OPEN
 * project's own folder verbatim, which is exactly what a reference needs and
 * exactly what `public/`'s root-relative URLs are not — a public asset's URL is
 * `/<publicRelativePath>` because a shipped game addresses it that way, and
 * giving references the same spelling would collide with the game's own paths.
 * Nothing new is served; a reference simply uses the project-file route that
 * already exists.
 *
 * `projectPathForAssetUrl` is the inverse: a bytes reader takes the URL a
 * document or a tile already holds and asks THIS module which project file it
 * names.
 */

export const REFERENCE_ROOT = 'references';

/** A listable asset root. `public` is the default and the shipped one. */
export type AssetRootId = 'public' | typeof REFERENCE_ROOT;

export const ASSET_ROOTS: readonly AssetRootId[] = ['public', REFERENCE_ROOT];

/** The URL prefix a reference is served under on the local editor server. */
export const REFERENCE_URL_PREFIX = `/project-game-static/${REFERENCE_ROOT}/`;

/** Project-root-relative path for a root + root-relative path. */
export function projectAssetPath(root: AssetRootId, rootRelativePath: string): string {
  return `${root}/${rootRelativePath}`;
}

/**
 * The URL editor chrome, asset documents and the Inspector address this asset
 * by. Public keeps its exact existing spelling (`/textures/crate.png`).
 */
export function assetRootServingUrl(root: AssetRootId, rootRelativePath: string): string {
  return root === REFERENCE_ROOT
    ? `${REFERENCE_URL_PREFIX}${rootRelativePath}`
    : `/${rootRelativePath}`;
}

/** Is this URL/document path a reference rather than a public asset? */
export function isReferenceAssetUrl(url: string): boolean {
  return url.startsWith(REFERENCE_URL_PREFIX);
}

/**
 * Which project file a serving URL names — the inverse of
 * {@link assetRootServingUrl}, and the one mapping every bytes reader uses.
 * A plain `/x.png` is a public asset, so it answers `public/x.png`, which is
 * the rule those readers used to hardcode.
 */
export function projectPathForAssetUrl(url: string): string {
  const servingUrl = url.startsWith('/') ? url : `/${url}`;
  if (isReferenceAssetUrl(servingUrl)) {
    return projectAssetPath(REFERENCE_ROOT, servingUrl.slice(REFERENCE_URL_PREFIX.length));
  }
  const withoutSlash = url.startsWith('/') ? url.slice(1) : url;
  return withoutSlash.startsWith('public/') ? withoutSlash : `public/${withoutSlash}`;
}
