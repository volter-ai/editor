/**
 * Listing project assets, and the online asset library. Both are the session's
 * own routes: it owns the project folder, so it is the one thing that can list
 * `public/` or write a downloaded asset into it.
 */

import type { ProjectComponentEntry } from '../asset-workflow/project-content';

import { assertEditorServerAnswered, editorServerJson } from '../editor-server-response';
import { getStorageBackend } from '../storage';
import { BASE } from './base';
export interface AssetEntry {
  name: string;
  type: 'file' | 'directory';
  /** Bytes, when the backend reports it. ABSENT means unmeasured — not zero. */
  size?: number;
  /** Epoch ms, when the backend reports it. ABSENT means unmeasured — not 1970. */
  modifiedAt?: number;
}

/**
 * A listing that either HAPPENED or FAILED.
 *
 * `{ ok: true, entries: [] }` is a real measurement — the directory is empty,
 * the project defines no components. A failure is a DIFFERENT FACT and carries
 * its reason, because rendering "this folder is empty" over a permissions
 * error, an offline dev server or a 500 tells the author their work is gone.
 * Both listings used to `catch { return [] }`, so the two were the same bytes.
 */
export type Listing<T> =
  | { readonly ok: true; readonly entries: T[] }
  | { readonly ok: false; readonly reason: string };

function listingFailure(error: unknown): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason: error instanceof Error ? error.message : String(error) };
}

/** One named asset root, listed by the editor server's own route. The entry
 *  shape is the route's; an ABSENT root answers the empty listing (the route's
 *  own S-8 rule), and a real failure still reports its reason. */
async function listAssetRootFromServer(root: string, dir: string): Promise<Listing<AssetEntry>> {
  try {
    const query = new URLSearchParams({ root, dir });
    const response = await fetch(`${BASE}/assets?${query}`, { cache: 'no-store' });
    const body = await editorServerJson<{ entries?: AssetEntry[] }>(
      response,
      `Could not list ${root}/${dir} from ${BASE}/assets`,
    );
    return { ok: true, entries: body.entries ?? [] };
  } catch (error) {
    return listingFailure(error);
  }
}

/**
 * List files and folders in a directory under one of the project's asset roots
 * (`public`, or `references` — see `asset-workflow/project-asset-roots.ts`).
 * `dir` is root-relative in both tiers; only the way the root is reached
 * differs, and that difference is the two branches below.
 */
export async function listAssets(root: string, dir: string): Promise<Listing<AssetEntry>> {
  // The tier's backend is rooted AT `public/`, so a second root cannot be
  // spelled through it at all — it is named to the server's own listing route
  // instead, which resolves it from the open project.
  if (root !== 'public') return listAssetRootFromServer(root, dir);
  try {
    const entries = await getStorageBackend().list(dir);
    return {
      ok: true,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.type === 'dir' ? ('directory' as const) : ('file' as const),
        // OMITTED, never zeroed: a backend that does not report a size has not
        // told us the file is 0 bytes, and a browser listing genuinely cannot
        // for some handles. `0`/`0` sorted an unmeasured file to the bottom of
        // "largest first" and to 1970 in "most recent", both as if measured.
        ...(e.size === undefined ? {} : { size: e.size }),
        ...(e.mtime === undefined ? {} : { modifiedAt: e.mtime }),
      })),
    };
  } catch (error) {
    return listingFailure(error);
  }
}

/** List source-defined visual components for the semantic component board. */
export async function listProjectComponents(): Promise<Listing<ProjectComponentEntry>> {
  try {
    const response = await fetch(`${BASE}/project-components`, { cache: 'no-store' });
    const body = await editorServerJson<{ components?: ProjectComponentEntry[] }>(
      response,
      `Could not list project components from ${BASE}/project-components`,
    );
    return { ok: true, entries: body.components ?? [] };
  } catch (error) {
    return listingFailure(error);
  }
}

/** Build a download URL for a build artifact. */
export function getDownloadUrl(file: string): string {
  return `${BASE}/download?file=${encodeURIComponent(file)}`;
}

// ---------------------------------------------------------------------------
// Asset Library (online browsing + download)
//
// The session is a Node-only proxy to Poly Haven/ambientcg (CORS +
// SSRF-allowlist reasons to stay server-side) plus the 34,412-asset local SSD
// catalog, writing into `<project>/public/asset-library/...` via raw
// `node:fs`. A browser cannot do either: it is refused by CORS and has no
// local disk to read.
// ---------------------------------------------------------------------------

import type { AssetFileOption, OnlineAsset } from './asset-library-wire';

export type { AssetFileOption, OnlineAsset } from './asset-library-wire';

export type AssetDeliveryIssueCode =
  | 'offline'
  | 'quota-limited'
  | 'license-blocked'
  | 'unavailable'
  | 'provider-error';

export class AssetDeliveryError extends Error {
  constructor(
    readonly code: AssetDeliveryIssueCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssetDeliveryError';
  }
}

export function assetDeliveryIssueMessage(code: AssetDeliveryIssueCode): string {
  return {
    offline: 'Network delivery is offline. SSD assets remain available.',
    'quota-limited': 'The remote provider quota is exhausted. Retry after the provider resets it.',
    'license-blocked': 'This delivery is blocked because its license terms are not accepted.',
    unavailable: 'No healthy SSD, cloud, or remote delivery is available for this variant.',
    'provider-error': 'The remote provider could not return delivery metadata. Retry the request.',
  }[code];
}

export interface OnlineAssetPreview {
  path: string;
  format: string;
  label: string;
  sourceAssetId: string;
  materialPath?: string;
}

// ---------------------------------------------------------------------------
// Downloaded-asset cache (client-side, keyed by exact provider identity)
// ---------------------------------------------------------------------------

/** Maps "source:asset-id" → local serving path. Display names are never identity. */
const downloadedAssetPaths = new Map<string, string>();

/** Listeners notified when the download cache changes. */
const downloadListeners = new Set<() => void>();

function assetCacheKey(source: string, assetId: string): string {
  return `${source}:${assetId}`;
}

/** Check if an online asset has already been downloaded. Returns local path or null. */
export function getDownloadedAssetPath(source: string, assetId: string): string | null {
  return downloadedAssetPaths.get(assetCacheKey(source, assetId)) ?? null;
}

/** Subscribe to download cache changes. Returns unsubscribe function. */
export function onAssetDownloaded(cb: () => void): () => void {
  downloadListeners.add(cb);
  return () => downloadListeners.delete(cb);
}

/** Fetch already-downloaded assets from the server and seed the cache. */
export async function loadDownloadedAssets(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/asset-library/downloaded`);
    const data = await editorServerJson<{
      downloaded: { source: string; id: string; path: string }[];
    }>(res, 'Could not read the downloaded-asset list');
    downloadedAssetPaths.clear();
    for (const entry of data.downloaded) {
      downloadedAssetPaths.set(assetCacheKey(entry.source, entry.id), `/${entry.path}`);
    }
    for (const cb of downloadListeners) cb();
  } catch {
    /* best-effort */
  }
}

/** Search for online assets via the editor server's proxy. */
export async function searchOnlineAssets(params: {
  source: string;
  type: string;
  q?: string;
  category?: string;
  offset?: number;
  limit?: number;
}): Promise<{ assets: OnlineAsset[]; total: number }> {
  const qs = new URLSearchParams();
  qs.set('source', params.source);
  qs.set('type', params.type);
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.limit != null) qs.set('limit', String(params.limit));

  const res = await fetch(`${BASE}/asset-library/search?${qs}`);
  assertEditorServerAnswered(res, 'Asset Library search failed');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Asset Library search failed (${res.status}).`);
  }
  return (await res.json()) as { assets: OnlineAsset[]; total: number };
}

/** Get available file options (resolutions/formats) for an online asset. */
export async function getOnlineAssetFiles(source: string, id: string): Promise<AssetFileOption[]> {
  return fetchOnlineAssetFilesFromServer(source, id);
}

async function fetchOnlineAssetFilesFromServer(
  source: string,
  id: string,
): Promise<AssetFileOption[]> {
  const qs = new URLSearchParams({ source, id });
  let res: Response;
  try {
    res = await fetch(`${BASE}/asset-library/files?${qs}`);
  } catch (error) {
    throw new AssetDeliveryError(
      'offline',
      error instanceof Error ? error.message : assetDeliveryIssueMessage('offline'),
    );
  }
  // A page fallback here is not a provider problem — it is nobody serving the
  // route — so it reports itself rather than being graded into a delivery code.
  assertEditorServerAnswered(res, 'Asset Library file lookup failed');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const code: AssetDeliveryIssueCode =
      res.status === 403
        ? 'license-blocked'
        : res.status === 429
          ? 'quota-limited'
          : res.status === 404
            ? 'unavailable'
            : 'provider-error';
    throw new AssetDeliveryError(code, body?.error ?? assetDeliveryIssueMessage(code));
  }
  const data = (await res.json()) as { files: AssetFileOption[] };
  return data.files;
}

/** Resolve a read-only interactive model preview from the editor's catalog cache. */
export async function getOnlineAssetPreview(
  source: string,
  id: string,
): Promise<OnlineAssetPreview | null> {
  const qs = new URLSearchParams({ source, id });
  const res = await fetch(`${BASE}/asset-library/preview?${qs}`);
  // `null` stays the answer for a route that says "no preview" (404); it is NOT
  // the answer for an origin where the route does not exist at all.
  assertEditorServerAnswered(res, 'Could not resolve an asset preview');
  if (!res.ok) return null;
  return (await res.json()) as OnlineAssetPreview;
}

export interface AppliedAssetImportHistory {
  assetPath: string;
  beforeToken: string;
  afterToken: string;
}

export interface DownloadOnlineAssetResult {
  ok: boolean;
  path?: string;
  alreadyExists?: boolean;
  provenanceOperationId?: string;
  history?: AppliedAssetImportHistory;
  error?: string;
  /** The import SUCCEEDED but `.vgai/assets.json` could not be updated (D-AP3).
   *  Loud, non-fatal degradation: the bytes are in the project, the provenance
   *  record is not. */
  ledgerError?: string;
}

/** Download an online asset into the project's public/asset-library/ folder. */
export async function downloadOnlineAsset(params: {
  source: string;
  id: string;
  name: string;
  url: string;
  format: string;
  jobId?: string;
  includes?: { relativePath: string; url: string; size: number }[];
  /** License as the library's own search result reported it. Recorded in the
   *  provenance ledger for sources the server cannot resolve a license for
   *  (the polyhaven/ambientcg proxy) — see D-AP3. */
  license?: string;
  signal?: AbortSignal;
}): Promise<DownloadOnlineAssetResult> {
  const res = await fetch(`${BASE}/asset-library/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, signal: undefined }),
    ...(params.signal ? { signal: params.signal } : {}),
  });
  assertEditorServerAnswered(res, 'Could not download the asset');
  const result = (await res.json()) as DownloadOnlineAssetResult;
  // Cache the local path on success
  if (result.ok && result.path) {
    downloadedAssetPaths.set(assetCacheKey(params.source, params.id), `/${result.path}`);
    for (const cb of downloadListeners) cb();
  }
  return result;
}

/** Capture a content-addressed server snapshot for one imported asset directory. */
export async function captureProjectAssetHistory(assetPath: string): Promise<string> {
  const response = await fetch(`${BASE}/asset-library/history/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetPath }),
  });
  assertEditorServerAnswered(response, 'Asset history capture failed');
  const result = (await response.json()) as { ok?: boolean; token?: string; error?: string };
  if (!response.ok || !result.token) {
    throw new Error(result.error ?? `Asset history capture failed (${response.status}).`);
  }
  return result.token;
}

/** Restore an exact imported-directory + provenance snapshot during undo/redo. */
export async function restoreProjectAssetHistory(assetPath: string, token: string): Promise<void> {
  const response = await fetch(`${BASE}/asset-library/history/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetPath, token }),
  });
  // This function REPORTS BY RETURNING: a page fallback is `ok`, so an undo
  // that restored nothing used to complete silently.
  assertEditorServerAnswered(response, 'Asset history restore failed');
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(result?.error ?? `Asset history restore failed (${response.status}).`);
  }
}

/** Get categories for a given asset type (Poly Haven, or the cloud-hosted
 *  "local" catalog). */
export async function getAssetLibraryCategories(type: string, source?: string): Promise<string[]> {
  const params = new URLSearchParams({ type });
  if (source) params.set('source', source);
  const res = await fetch(`${BASE}/asset-library/categories?${params}`);
  assertEditorServerAnswered(res, 'Could not read Asset Library categories');
  if (!res.ok) return [];
  const data = (await res.json()) as { categories: string[] };
  return data.categories;
}
