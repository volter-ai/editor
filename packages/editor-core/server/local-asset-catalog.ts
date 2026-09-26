import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetCapabilities } from '@volter/editor-sdk/kit/asset-capabilities';
import {
  type AssetCatalog,
  type AssetFamily,
  type AssetFile,
  type AssetVariant,
  parseAssetCatalog,
} from '@volter/editor-sdk/kit/asset-workflow/asset-types';
import { assertNoRemovedAssetCatalogV1 } from './asset-catalog-v2';
import { isPathInside } from './server-utils';

/**
 * The SSD library root, or `null` when this box has not named one.
 *
 * There is deliberately NO built-in default path. A default that names one
 * contributor's mounted volume is wrong on every other machine and inside
 * every shipped npm package, and it turns "this host has no local library"
 * into a filesystem error about a disk the reader does not have.
 */
export const LOCAL_ASSET_LIBRARY_ROOT_ENV = 'VGAI_ASSET_LIBRARY_ROOT';

/**
 * The checkout's own committed catalog index, or `null` when this process is
 * not running from a checkout.
 *
 * `import.meta.url` points at THIS FILE in a checkout and at the esbuild
 * bundle (`<pkg>/dist-server/packaged.mjs`) in a registry install, so the
 * relative walk lands on `<install>/node_modules/catalog/...` there — a path
 * that does not exist and never did. Resolving it unconditionally is what made
 * the packaged editor report a missing local file as `Upstream API error`.
 * Existence is checked once, here, so callers get an honest `null` instead of
 * a path that only resolves in one realm.
 *
 * The 20 MB index is deliberately NOT shipped in `@vgai/editor`'s `files`: it
 * indexes ~34k assets whose BYTES live on that SSD, so a registry install that
 * carried the index would still be unable to deliver a single one of them. The
 * cloud-hosted slice is the non-checkout answer (`cloud-asset-library`).
 */
export const REPOSITORY_ASSET_CATALOG_PATH: string | null = (() => {
  const candidate = fileURLToPath(
    new URL('../../../catalog/asset-library/catalog.json', import.meta.url),
  );
  return existsSync(candidate) ? candidate : null;
})();

/** Thrown when no local asset catalog is reachable from this host. Carries the
 *  realm's name so a route can answer with the cause instead of blaming an
 *  upstream API for a file that was never on this disk. */
export class LocalAssetCatalogUnavailableError extends Error {
  constructor() {
    super(
      'This editor host has no local asset catalog. The SSD asset library is a ' +
        `checkout-and-mounted-volume delivery: set ${LOCAL_ASSET_LIBRARY_ROOT_ENV} to a ` +
        'library root, or use the cloud-hosted catalog.',
    );
    this.name = 'LocalAssetCatalogUnavailableError';
  }
}

export type LocalAssetType = 'model' | 'animation' | 'source';
export type LocalAssetFile = AssetFile;

export interface LocalCatalogAsset {
  /** Variant identity. Family identity is explicit and separately exposed. */
  id: string;
  familyId: string;
  source: string;
  name: string;
  type: LocalAssetType;
  categories: string[];
  tags: string[];
  license: string;
  author: string;
  sourceUrl: string;
  thumbnail?: string;
  files: LocalAssetFile[];
  animationCount?: number;
  clipNames?: string[];
  variants: readonly AssetVariant[];
}

export interface LocalAssetCatalog extends AssetCatalog {
  /** Valid variant projections, derived once at load for existing server consumers. */
  readonly assets: readonly LocalCatalogAsset[];
}

/** The configured SSD library root, or `null` when this box names none. */
export function getLocalAssetLibraryRoot(): string | null {
  const configured = process.env[LOCAL_ASSET_LIBRARY_ROOT_ENV];
  return configured ? resolve(configured) : null;
}

/** For the operator scripts that cannot do their job without a real library:
 *  name the missing configuration instead of reaching for a built-in path. */
export function requireLocalAssetLibraryRoot(): string {
  const root = getLocalAssetLibraryRoot();
  if (!root) {
    throw new Error(
      `No asset library root. Set ${LOCAL_ASSET_LIBRARY_ROOT_ENV}=<path to your ` +
        'vgai-asset-library> (or pass --root=<path>).',
    );
  }
  return root;
}

export function getLocalCatalogPath(root: string): string {
  return resolve(root, 'catalog', 'catalog.json');
}

/** The catalog index this host can actually read, or `null` when it has none
 *  — a mounted library root first, the checkout's committed index second. */
export async function resolveLocalCatalogPath(
  root = getLocalAssetLibraryRoot(),
): Promise<string | null> {
  if (root) {
    const externalPath = getLocalCatalogPath(root);
    try {
      await stat(externalPath);
      return externalPath;
    } catch {
      /* fall through to the checkout's own index */
    }
  }
  return REPOSITORY_ASSET_CATALOG_PATH;
}

let cachedCatalog: LocalAssetCatalog | null = null;
let cachedPath = '';
let cachedMtimeMs = -1;
let pendingCatalogLoad: {
  path: string;
  mtimeMs: number;
  promise: Promise<LocalAssetCatalog>;
} | null = null;

export async function loadLocalAssetCatalog(
  root = getLocalAssetLibraryRoot(),
): Promise<LocalAssetCatalog> {
  const catalogPath = await resolveLocalCatalogPath(root);
  if (!catalogPath) throw new LocalAssetCatalogUnavailableError();
  const catalogStat = await stat(catalogPath);
  if (cachedCatalog && cachedPath === catalogPath && cachedMtimeMs === catalogStat.mtimeMs) {
    return cachedCatalog;
  }
  if (
    pendingCatalogLoad?.path === catalogPath &&
    pendingCatalogLoad.mtimeMs === catalogStat.mtimeMs
  ) {
    return pendingCatalogLoad.promise;
  }

  const promise = readFile(catalogPath, 'utf8').then((source) => {
    const input: unknown = JSON.parse(source);
    assertNoRemovedAssetCatalogV1(input, catalogPath);
    const normalized = parseAssetCatalog(input);
    const parsed: LocalAssetCatalog = {
      ...normalized,
      assets: normalized.families.flatMap((family) =>
        family.variants.map((variant) => projectCatalogVariant(family, variant)),
      ),
    };
    cachedCatalog = parsed;
    cachedPath = catalogPath;
    cachedMtimeMs = catalogStat.mtimeMs;
    return parsed;
  });
  pendingCatalogLoad = { path: catalogPath, mtimeMs: catalogStat.mtimeMs, promise };
  try {
    return await promise;
  } finally {
    if (pendingCatalogLoad?.promise === promise) pendingCatalogLoad = null;
  }
}

export async function findLocalAsset(
  id: string,
  root = getLocalAssetLibraryRoot(),
): Promise<LocalCatalogAsset | null> {
  const catalog = await loadLocalAssetCatalog(root);
  const exactVariant = catalog.assets.find((asset) => asset.id === id);
  if (exactVariant) return exactVariant;
  const family = catalog.families.find((candidate) => candidate.id === id);
  return family ? preferredLocalAssetVariant(family) : null;
}

export async function findLocalAssetFamily(
  id: string,
  root = getLocalAssetLibraryRoot(),
): Promise<AssetFamily | null> {
  const catalog = await loadLocalAssetCatalog(root);
  return (
    catalog.families.find((family) => family.id === id) ??
    catalog.families.find((family) => family.variants.some((variant) => variant.id === id)) ??
    null
  );
}

function projectCatalogVariant(family: AssetFamily, variant: AssetVariant): LocalCatalogAsset {
  return {
    id: variant.id,
    familyId: family.id,
    source: family.source,
    name: family.name,
    type: variant.type,
    categories: family.categories,
    tags: family.tags,
    license: family.license,
    author: family.author,
    sourceUrl: family.sourceUrl,
    thumbnail: variant.thumbnail.path,
    files: variant.files,
    ...(variant.animationCount !== undefined ? { animationCount: variant.animationCount } : {}),
    ...(variant.clipNames !== undefined ? { clipNames: variant.clipNames } : {}),
    variants: family.variants,
  };
}

export function preferredLocalAssetVariant(family: AssetFamily): LocalCatalogAsset {
  const ranked = rankLocalAssetPreviewVariants(
    family.variants.map((variant) => projectCatalogVariant(family, variant)),
  );
  return ranked[0] ?? projectCatalogVariant(family, family.variants[0]!);
}

export function localAssetMatchesType(asset: LocalCatalogAsset, type?: string): boolean {
  const normalizedType = type === 'all' ? undefined : type?.replace(/s$/, '');
  if (!normalizedType) return true;
  if (normalizedType === 'animation') {
    return (
      asset.type === 'animation' ||
      asset.tags.includes('animation') ||
      asset.tags.includes('animated')
    );
  }
  return asset.type === normalizedType;
}

/** Resolve a catalog-relative file under the library root. `null` root means
 *  this host has no library to resolve INTO — the honest answer is "no such
 *  file here", never a path built from a guessed root. */
export function resolveCatalogFile(root: string | null, relativePath: string): string | null {
  if (!root) return null;
  const absolutePath = resolve(root, relativePath);
  if (!isPathInside(root, absolutePath)) {
    throw new Error(`Catalog path escapes the asset library: ${relativePath}`);
  }
  return absolutePath;
}

/**
 * {@link resolveCatalogFile} for the callers that are already inside a
 * not-found / degrade path: a host with no library root cannot hold this file,
 * and throwing lands on the same branch a missing file lands on, with the
 * realm named in the error rather than a guessed path in the message.
 */
export function requireCatalogFile(root: string | null, relativePath: string): string {
  const resolved = resolveCatalogFile(root, relativePath);
  if (!resolved) throw new LocalAssetCatalogUnavailableError();
  return resolved;
}

/** The throwing twin of {@link resolveLocalAssetThumbnail}, same reason. */
export function requireLocalAssetThumbnail(root: string | null, asset: LocalCatalogAsset): string {
  return requireCatalogFile(root, localAssetThumbnailPath(asset));
}

/** Stable SSD cache location for a catalog card's generated preview. */
export function localAssetThumbnailPath(asset: LocalCatalogAsset): string {
  return asset.thumbnail ?? `thumbnails/${asset.id}.webp`;
}

/** Resolve a generated/upstream thumbnail without allowing catalog path escapes. */
export function resolveLocalAssetThumbnail(
  root: string | null,
  asset: LocalCatalogAsset,
): string | null {
  return resolveCatalogFile(root, localAssetThumbnailPath(asset));
}

const PREVIEW_FORMAT_PRIORITY: Record<string, number> = {
  glb: 0,
  gltf: 1,
  obj: 2,
  dae: 3,
  fbx: 4,
  stl: 5,
  ply: 6,
  '3ds': 7,
  bvh: 8,
};

/**
 * Identify format variants of the same catalog item without relying on category order.
 * Catalog sources consistently use `sources/<source-root>/<collection>/...`; collection plus
 * normalized display name distinguishes same-named assets from different packs and GSO objects.
 */
export function localAssetVariantKey(asset: LocalCatalogAsset): string {
  return asset.familyId;
}

/** Best-first preview candidates for every source-format variant of an asset. */
export function localAssetPreviewVariants(
  asset: LocalCatalogAsset,
  catalogAssets: readonly LocalCatalogAsset[],
): LocalCatalogAsset[] {
  const key = localAssetVariantKey(asset);
  return rankLocalAssetPreviewVariants(
    catalogAssets.filter((candidate) => localAssetVariantKey(candidate) === key),
  );
}

/** Rank an already-associated set of semantic variants without regrouping it. */
export function rankLocalAssetPreviewVariants(
  variants: readonly LocalCatalogAsset[],
): LocalCatalogAsset[] {
  return [...variants].sort((left, right) => {
    const leftFile = left.files[0];
    const rightFile = right.files[0];
    const formatDifference =
      (PREVIEW_FORMAT_PRIORITY[leftFile?.format ?? ''] ?? 99) -
      (PREVIEW_FORMAT_PRIORITY[rightFile?.format ?? ''] ?? 99);
    if (formatDifference !== 0) return formatDifference;
    const qualityDifference =
      previewPathPenalty(leftFile?.path) - previewPathPenalty(rightFile?.path);
    if (qualityDifference !== 0) return qualityDifference;
    return (leftFile?.path ?? '').localeCompare(rightFile?.path ?? '');
  });
}

function previewPathPenalty(path: string | undefined): number {
  const normalized = path?.toLowerCase() ?? '';
  let penalty = 0;
  if (normalized.includes('unity')) penalty += 4;
  if (normalized.includes('draco')) penalty += 3;
  if (normalized.includes('quantized')) penalty += 2;
  if (normalized.includes('embedded')) penalty += 1;
  return penalty;
}

export function searchLocalCatalog(
  catalog: LocalAssetCatalog,
  options: { q?: string; type?: string; category?: string; offset?: number; limit?: number },
): { assets: LocalCatalogAsset[]; total: number } {
  const queryTokens = (options.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const category = options.category?.toLowerCase();
  const type = options.type === 'all' ? undefined : options.type;

  const matches = catalog.families.map(preferredLocalAssetVariant).filter((asset) => {
    if (!localAssetMatchesType(asset, type)) return false;
    if (category && !asset.categories.some((value) => value.toLowerCase() === category)) {
      return false;
    }
    if (queryTokens.length === 0) return true;
    const haystack = [
      asset.name,
      asset.source,
      asset.author,
      asset.license,
      ...asset.categories,
      ...asset.tags,
      ...(asset.clipNames ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return queryTokens.every((token) => haystack.includes(token));
  });

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(200, Math.max(1, options.limit ?? 48));
  return { assets: matches.slice(offset, offset + limit), total: matches.length };
}

export function localAssetSlug(asset: LocalCatalogAsset): string {
  const base = asset.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'asset'}-${asset.familyId.slice(0, 8)}`;
}

export function localAssetCapabilities(asset: LocalCatalogAsset) {
  const capabilities = assetCapabilities(asset.files[0]?.format ?? 'unknown');
  return {
    previewable: capabilities.previewable,
    importable: capabilities.importable,
    runtimeReady: capabilities.runtimeReady,
    animated: capabilities.animated || (asset.animationCount ?? 0) > 0,
    deliveryAvailable: asset.variants.some((variant) =>
      variant.deliveries.some((delivery) => delivery.available),
    ),
    health: capabilities.runtimeReady
      ? 'healthy'
      : capabilities.importable
        ? 'source-only'
        : 'unsupported',
  } as const;
}

export function makeLocalAssetId(source: string, key: string): string {
  return createHash('sha256').update(`${source}\0${key}`).digest('hex').slice(0, 24);
}

export function catalogFormat(path: string): string {
  return extname(path).slice(1).toLowerCase() || 'bin';
}
