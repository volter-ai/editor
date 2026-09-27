/**
 * Node's client for the deployed `cloud-asset-library` Worker: it reads
 * `VGAI_CLOUD_ASSET_URL` and resolves variants through GraphQL, neither of
 * which a browser bundle can do — so the FETCHING here is genuinely its own.
 *
 * What the worker RETURNS is not. `CloudAssetObject`/`CloudAssetFile`/
 * `CloudAssetRecord` and the manifest response are declared once, in
 * `src/asset-workflow/cloud-asset-client.ts` (a browser-safe module `server/`
 * can import but which cannot import back — see its header), and imported here.
 * The mirror that used to live in this file had drifted into the worker's
 * INTERNAL pre-projection shape: `familyId`/`label`/`categories`/`tags`
 * optional, plus a `key` no editor path reads and this file's own GraphQL
 * query does not select.
 */

import type {
  CloudAssetManifestResponse,
  CloudAssetRecord,
} from '@volter/editor-sdk/kit/asset-workflow/cloud-asset-client';

export const DEFAULT_CLOUD_ASSET_BASE_URL = 'https://vgai-asset-library.aaron-0ed.workers.dev';

export type {
  CloudAssetFile,
  CloudAssetManifestResponse,
  CloudAssetObject,
  CloudAssetRecord,
} from '@volter/editor-sdk/kit/asset-workflow/cloud-asset-client';

let cachedManifest:
  | { value: CloudAssetManifestResponse; url: string; loadedAt: number }
  | undefined;
const CACHE_MS = 5 * 60 * 1000;
const GRAPHQL_ID_BATCH = 500;
const graphqlAssetCache = new Map<
  string,
  { baseUrl: string; value: CloudAssetRecord | null; loadedAt: number }
>();

export function getCloudAssetBaseUrl(): string {
  return (process.env['VGAI_CLOUD_ASSET_URL'] ?? DEFAULT_CLOUD_ASSET_BASE_URL).replace(/\/+$/, '');
}

export async function loadCloudAssetManifest(): Promise<CloudAssetManifestResponse | null> {
  const baseUrl = getCloudAssetBaseUrl();
  if (
    cachedManifest &&
    cachedManifest.url === baseUrl &&
    Date.now() - cachedManifest.loadedAt < CACHE_MS
  ) {
    return cachedManifest.value;
  }
  try {
    const response = await fetch(`${baseUrl}/v1/manifest`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const value = (await response.json()) as CloudAssetManifestResponse;
    if ((value.version !== 1 && value.version !== 2) || !Array.isArray(value.assets)) return null;
    cachedManifest = { value, url: baseUrl, loadedAt: Date.now() };
    return value;
  } catch {
    return null;
  }
}

export async function findCloudAsset(id: string): Promise<CloudAssetRecord | null> {
  return (await findCloudAssets([id]))[0] ?? null;
}

async function queryCloudAssets(ids: readonly string[]): Promise<CloudAssetRecord[] | null> {
  if (ids.length === 0) return [];
  const response = await fetch(`${getCloudAssetBaseUrl()}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query CloudAssets($ids: [ID!]!) {
        assetsByIds(ids: $ids) {
          id familyId label status source name type license author sourceUrl attribution categories tags
          files: deliveries {
            label format
            main { sha256 sizeBytes contentType relativePath }
            dependencies { sha256 sizeBytes contentType relativePath }
          }
        }
      }`,
      variables: { ids },
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    data?: { assetsByIds?: CloudAssetRecord[] };
    errors?: unknown[];
  };
  return body.errors || !Array.isArray(body.data?.assetsByIds) ? null : body.data.assetsByIds;
}

/** Resolve exact hosted variants through GraphQL; REST manifest is rollout fallback only. */
export async function findCloudAssets(ids: readonly string[]): Promise<CloudAssetRecord[]> {
  const uniqueIds = [...new Set(ids)];
  const baseUrl = getCloudAssetBaseUrl();
  const now = Date.now();
  const unresolved = uniqueIds.filter((id) => {
    const cached = graphqlAssetCache.get(id);
    return !cached || cached.baseUrl !== baseUrl || now - cached.loadedAt >= CACHE_MS;
  });
  try {
    for (let offset = 0; offset < unresolved.length; offset += GRAPHQL_ID_BATCH) {
      const batch = unresolved.slice(offset, offset + GRAPHQL_ID_BATCH);
      const found = await queryCloudAssets(batch);
      if (!found) throw new Error('GraphQL catalog unavailable.');
      const byId = new Map(found.map((asset) => [asset.id, asset]));
      for (const id of batch) {
        graphqlAssetCache.set(id, { baseUrl, value: byId.get(id) ?? null, loadedAt: now });
      }
    }
    return uniqueIds.flatMap((id) => {
      const asset = graphqlAssetCache.get(id)?.value;
      return asset ? [asset] : [];
    });
  } catch {
    const manifest = await loadCloudAssetManifest();
    const requested = new Set(uniqueIds);
    return manifest?.assets.filter((asset) => requested.has(asset.id)) ?? [];
  }
}

export function cloudAssetObjectUrl(
  assetId: string,
  fileIndex: number,
  dependencyIndex?: number,
): string {
  const base = `${getCloudAssetBaseUrl()}/v1/assets/${encodeURIComponent(assetId)}/files/${fileIndex}`;
  return dependencyIndex === undefined ? base : `${base}/dependencies/${dependencyIndex}`;
}

export function parseCloudAssetObjectUrl(
  value: string,
  expectedAssetId: string,
): { fileIndex: number; dependencyIndex?: number } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const expectedBase = new URL(getCloudAssetBaseUrl());
  if (url.protocol !== 'https:' || url.origin !== expectedBase.origin || url.search || url.hash)
    return null;
  const prefix = expectedBase.pathname.replace(/\/$/, '');
  const relativePath = url.pathname.slice(prefix.length);
  const match = /^\/v1\/assets\/([a-f0-9]{24})\/files\/(\d+)(?:\/dependencies\/(\d+))?$/.exec(
    relativePath,
  );
  if (!match || match[1] !== expectedAssetId) return null;
  const parsed: { fileIndex: number; dependencyIndex?: number } = { fileIndex: Number(match[2]) };
  if (match[3] !== undefined) parsed.dependencyIndex = Number(match[3]);
  return parsed;
}
