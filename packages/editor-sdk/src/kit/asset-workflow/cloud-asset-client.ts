/**
 * Browser-safe client for the deployed `cloud-asset-library` Worker (D-AP4/
 * D-AP5).
 *
 * GET-only, no `process.env` overrides, no admin routes, no Node imports —
 * so a Vite browser bundle can include it directly. Node's own client
 * (`packages/editor/server/cloud-asset-catalog.ts`) additionally proxies
 * Poly Haven/ambientcg and reads `VGAI_CLOUD_ASSET_URL`, so the two clients'
 * FETCHING stays separate; the two clients' idea of what the worker RETURNS
 * does not. This module is where the worker's record shape is declared, and
 * the Node client imports it from here.
 *
 * That direction is the only one available and it is the one the package
 * already uses everywhere: `src/` is what this package's browser
 * `tsconfig.json` includes, so a `src` module cannot reach `server/`, while
 * `server/` reaches into `src/` in twenty-odd places today
 * (`asset-catalog-v2.ts` -> `asset-workflow/asset-types.ts` is the nearest
 * sibling). The mirror the Node client used to keep instead had drifted into
 * a DIFFERENT SHAPE — see {@link CloudAssetRecord}.
 *
 * Two materialization sites share this client:
 *   - `hosted-asset-materialization.ts` (D-AP4 — a project's DECLARED packs,
 *     `asset-manifest.json`)
 *   - `browser-asset-library.ts` (D-AP5 — the Library panel's cloud-hosted
 *     "local" source)
 *
 * ANTI-SHIM: every byte this module hands back is verified by its caller
 * against the library's own sha256 before being written anywhere — this
 * module itself never fabricates or substitutes bytes, and a 404/network
 * failure surfaces as `null`/a thrown `fetch` rejection, never a placeholder.
 */

export const DEFAULT_CLOUD_ASSET_BASE_URL = 'https://vgai-asset-library.aaron-0ed.workers.dev';

/**
 * One deliverable object. The worker's own
 * `packages/cloud-asset-library/src/types.ts` carries a `key` here — its R2
 * object key — which is deliberately absent from this consumer shape: no
 * editor path reads it, and the GraphQL leg the Node client uses does not even
 * select it (`queryCloudAssets` asks for `sha256 sizeBytes contentType
 * relativePath`). A field with no reader is not part of a client's contract.
 */
export interface CloudAssetObject {
  sha256: string;
  sizeBytes: number;
  contentType: string;
  relativePath: string;
}

export interface CloudAssetFile {
  label: string;
  format: string;
  main: CloudAssetObject;
  dependencies: CloudAssetObject[];
}

/**
 * One hosted asset variant, as the worker SERVES it.
 *
 * `familyId`, `label`, `categories` and `tags` are REQUIRED because the worker
 * guarantees them on the way out: `worker.ts`'s `runtimeManifest` projects a
 * canonical v2 snapshot through `projectCloudAssets` and an older flat v1
 * snapshot through `projectLegacyCloudManifest`, and BOTH fill these in
 * (`asset.familyId ?? asset.id`, `asset.label ?? files[0].label ?? name`,
 * `?? []`) before anything leaves the worker. The optional-everything mirror
 * the Node client used to keep was the worker's INTERNAL
 * `LegacyCloudAssetRecord` — the pre-projection R2 shape, which no client ever
 * receives — under this name. Downstream already relies on the guarantee:
 * `cloudAssetSlug` does `record.familyId.slice(0, 8)`.
 */
export interface CloudAssetRecord {
  id: string;
  familyId: string;
  label: string;
  status: 'validated';
  source: string;
  name: string;
  type: string;
  license: string;
  author: string;
  sourceUrl: string;
  attribution: string;
  categories: string[];
  tags: string[];
  files: CloudAssetFile[];
}

/**
 * `GET /v1/manifest`, narrowed to the two fields both clients read. The
 * response carries more (`familyCount`, `totalBytes`, the canonical `families`
 * graph); a client declares what it reads.
 *
 * `version` stays `1 | 2` even though the current worker always projects to 2,
 * because the version is exactly what a client checks to find out whether the
 * DEPLOYED worker is that one — the Node client's `loadCloudAssetManifest`
 * rejects anything else outright.
 */
export interface CloudAssetManifestResponse {
  version: 1 | 2;
  generatedAt: string;
  assets: CloudAssetRecord[];
}

export interface CloudAssetClientOptions {
  /** Override the deployed worker's base URL — tests only; production callers
   *  always get {@link DEFAULT_CLOUD_ASSET_BASE_URL}. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
}

/** Match the Library panel's plural filter values ("models", "animations",
 *  "sources") against the singular type carried by cloud records. Animation
 *  tags count for the same reason they do in the SSD catalog: several source
 *  packs classify an animated model as a model while still tagging the
 *  capability honestly. */
export function cloudAssetMatchesType(record: CloudAssetRecord, type?: string): boolean {
  const normalizedType = type === 'all' ? undefined : type?.replace(/s$/, '');
  if (!normalizedType) return true;
  if (normalizedType === 'animation') {
    return (
      record.type === 'animation' ||
      record.tags.includes('animation') ||
      record.tags.includes('animated')
    );
  }
  return record.type === normalizedType;
}

function baseUrlOf(options: CloudAssetClientOptions): string {
  return (options.baseUrl ?? DEFAULT_CLOUD_ASSET_BASE_URL).replace(/\/+$/, '');
}

function fetchInit(options: CloudAssetClientOptions): RequestInit {
  return options.signal ? { signal: options.signal } : {};
}

/** Fetch one asset's metadata (`GET /v1/assets/:id`). `null` on a 404 or a
 *  malformed response — a miss is an ordinary outcome the caller reports as
 *  "not hosted", never a crash. */
export async function fetchCloudAssetRecord(
  assetId: string,
  options: CloudAssetClientOptions = {},
): Promise<CloudAssetRecord | null> {
  const baseUrl = baseUrlOf(options);
  const response = await fetch(
    `${baseUrl}/v1/assets/${encodeURIComponent(assetId)}`,
    fetchInit(options),
  );
  if (!response.ok) return null;
  const value = (await response.json()) as Partial<CloudAssetRecord> | null;
  if (!value || typeof value !== 'object' || !Array.isArray(value.files)) return null;
  return value as CloudAssetRecord;
}

interface ManifestCacheEntry {
  baseUrl: string;
  generatedAt: string;
  assets: CloudAssetRecord[];
  loadedAt: number;
}

let cachedManifest: ManifestCacheEntry | undefined;
const MANIFEST_CACHE_MS = 5 * 60 * 1000;

/** Test-only: forget the in-memory manifest cache so each test starts fresh. */
export function resetCloudAssetManifestCache(): void {
  cachedManifest = undefined;
}

/** Fetch the full hosted-asset manifest (`GET /v1/manifest`), cached in
 *  memory for {@link MANIFEST_CACHE_MS} — a Library-panel session searches
 *  and lists categories repeatedly, and the worker itself only refreshes its
 *  own R2 read every 60s (`packages/cloud-asset-library/src/worker.ts`), so
 *  re-fetching on every keystroke would buy nothing. `null` on a network/
 *  malformed-response failure (never a cached stale value past its TTL, and
 *  never a fabricated empty catalog reported as success). */
export async function fetchCloudAssetManifest(
  options: CloudAssetClientOptions = {},
): Promise<{ generatedAt: string; assets: CloudAssetRecord[] } | null> {
  const baseUrl = baseUrlOf(options);
  if (
    cachedManifest &&
    cachedManifest.baseUrl === baseUrl &&
    Date.now() - cachedManifest.loadedAt < MANIFEST_CACHE_MS
  ) {
    return { generatedAt: cachedManifest.generatedAt, assets: cachedManifest.assets };
  }
  const response = await fetch(`${baseUrl}/v1/manifest`, fetchInit(options));
  if (!response.ok) return null;
  const value = (await response.json()) as Partial<CloudAssetManifestResponse> | null;
  if (!value || !Array.isArray(value.assets)) return null;
  cachedManifest = {
    baseUrl,
    generatedAt: value.generatedAt ?? '',
    assets: value.assets,
    loadedAt: Date.now(),
  };
  return { generatedAt: cachedManifest.generatedAt, assets: cachedManifest.assets };
}

/** The worker's thumbnail route for one asset. Quota-free and immutably
 *  cached (`serveThumbnail`), which is why a grid may show hundreds. */
export function cloudAssetThumbnailUrl(baseUrl: string | undefined, assetId: string): string {
  return `${baseUrlOf(baseUrl ? { baseUrl } : {})}/v1/assets/${encodeURIComponent(assetId)}/thumbnail`;
}

/** Build the download URL for one file of a hosted asset (`main` when
 *  `dependencyIndex` is omitted, one of its dependencies otherwise) — mirrors
 *  `packages/editor/server/cloud-asset-catalog.ts`'s `cloudAssetObjectUrl`. */
export function cloudAssetObjectUrl(
  baseUrl: string | undefined,
  assetId: string,
  fileIndex: number,
  dependencyIndex?: number,
): string {
  const base = `${baseUrlOf(baseUrl ? { baseUrl } : {})}/v1/assets/${encodeURIComponent(assetId)}/files/${fileIndex}`;
  return dependencyIndex === undefined ? base : `${base}/dependencies/${dependencyIndex}`;
}

/** Inverse of {@link cloudAssetObjectUrl}: recover the file/dependency index
 *  from a URL already known to name `expectedAssetId`, or `null` if it does
 *  not match this worker's own URL shape. */
export function parseCloudAssetObjectUrl(
  value: string,
  expectedAssetId: string,
  options: { baseUrl?: string } = {},
): { fileIndex: number; dependencyIndex?: number } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  let expectedBase: URL;
  try {
    expectedBase = new URL(baseUrlOf(options));
  } catch {
    return null;
  }
  if (url.origin !== expectedBase.origin || url.search || url.hash) return null;
  const prefix = expectedBase.pathname.replace(/\/$/, '');
  const relativePath = url.pathname.slice(prefix.length);
  const match = /^\/v1\/assets\/([a-f0-9]{24})\/files\/(\d+)(?:\/dependencies\/(\d+))?$/.exec(
    relativePath,
  );
  if (!match || match[1] !== expectedAssetId) return null;
  const result: { fileIndex: number; dependencyIndex?: number } = { fileIndex: Number(match[2]) };
  if (match[3] !== undefined) result.dependencyIndex = Number(match[3]);
  return result;
}

/** The same slug algorithm the Node Library panel uses for the SSD/cloud
 *  catalog's on-disk destination (`localAssetSlug` in
 *  `packages/editor/server/local-asset-catalog.ts`), rebuilt from the fields
 *  the cloud worker's own record already carries (`name`/`familyId`) so the
 *  browser client needs no dependency on the 34,412-asset local catalog. */
export function cloudAssetSlug(record: Pick<CloudAssetRecord, 'name' | 'familyId'>): string {
  const base = record.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'asset'}-${record.familyId.slice(0, 8)}`;
}
