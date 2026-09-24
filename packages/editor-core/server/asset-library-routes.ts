/**
 * Asset Library — server proxy routes for browsing and downloading
 * CC0 assets from Poly Haven and ambientCG.
 *
 * Mounted as an Express Router under /__editor/asset-library/*.
 * Proxies external API calls (avoids CORS) and streams downloads
 * into the project's public/asset-library/ directory.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Router } from 'express';
import express from 'express';
import { ProjectProvenanceDocumentSchema } from './support/project/provenance';
import { assetKey } from '../src/asset-workflow/asset-ledger';
import {
  type CloudAssetRecord,
  cloudAssetMatchesType,
  cloudAssetSlug,
} from '../src/asset-workflow/cloud-asset-client';
import { AssetHistorySnapshots } from './asset-history-snapshots';
import { recordAssetMaterialization } from './asset-ledger-store';
import {
  cloudAssetObjectUrl,
  findCloudAsset,
  findCloudAssets,
  getCloudAssetBaseUrl,
  loadCloudAssetManifest,
  parseCloudAssetObjectUrl,
} from './cloud-asset-catalog';
import { broadcast } from './editor-sse';
import {
  findLocalAsset,
  findLocalAssetFamily,
  getLocalAssetLibraryRoot,
  LocalAssetCatalogUnavailableError,
  loadLocalAssetCatalog,
  localAssetCapabilities,
  localAssetMatchesType,
  localAssetPreviewVariants,
  localAssetSlug,
  requireCatalogFile,
  requireLocalAssetThumbnail,
  searchLocalCatalog,
} from './local-asset-catalog';
import {
  convertStagedModelToGlb,
  SERVER_CONVERTIBLE_MODEL_FORMATS,
} from './model-import-conversion';
import { commitStagedProjectDirectory } from './project-output-writer';
import { isAllowedAssetHost, isAllowedAssetSource, isPathInside } from './server-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The asset-library wire is declared ONCE, on the CLIENT side of its own
// route (`../src/api/assets.ts`) — this producer imports the contract it
// must satisfy, so the two sides of `/__editor/assets/*` cannot drift.
import type { AssetFileOption, OnlineAsset } from '@volter/editor-sdk/kit/api-asset-library-wire';

const LOCAL_ASSET_LAB_FORMATS = new Set([
  'glb',
  'gltf',
  'fbx',
  'obj',
  'dae',
  'stl',
  'ply',
  'bvh',
  '3ds',
]);

function localPreviewFileUrl(assetId: string, fileIndex: number, relativePath: string): string {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return `/__editor/asset-library/preview-files/${assetId}/${fileIndex}/${encodedPath}`;
}

function cloudPreviewFileUrl(assetId: string, fileIndex: number, relativePath: string): string {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return `/__editor/asset-library/cloud-preview-files/${assetId}/${fileIndex}/${encodedPath}`;
}

// ---------------------------------------------------------------------------
// In-memory cache with TTL
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export async function beginAssetStaging(destination: string): Promise<string> {
  await mkdir(dirname(destination), { recursive: true });
  const exists = await stat(destination).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  if (exists) throw new Error(`Destination already exists and was not overwritten: ${destination}`);
  return mkdtemp(join(dirname(destination), `.${basename(destination)}.staging-`));
}

export async function commitAssetStaging(staging: string, destination: string): Promise<void> {
  await rename(staging, destination);
}

async function commitCatalogAsset(
  publicRoot: string,
  staging: string,
  destination: string,
  input: Record<string, unknown>,
) {
  return commitStagedProjectDirectory({
    projectRoot: dirname(publicRoot),
    stagedDirectory: staging,
    destination,
    provenance: {
      operationName: 'catalog.asset.acquire',
      operationSource: 'vgai-catalog',
      input,
    },
  });
}

async function centralCatalogIds(projectRoot: string): Promise<Map<string, string>> {
  try {
    const document = ProjectProvenanceDocumentSchema.parse(
      JSON.parse(await readFile(join(projectRoot, '.vgai', 'provenance.json'), 'utf8')),
    );
    const ids = new Map<string, string>();
    for (const operation of Object.values(document.operations)) {
      if (operation.operation.name !== 'catalog.asset.acquire') continue;
      const input = operation.input;
      if (!input || typeof input !== 'object' || Array.isArray(input)) continue;
      const id = input['id'];
      if (typeof id !== 'string') continue;
      for (const output of operation.outputs) {
        const match = /^public\/asset-library\/([^/]+)\/([^/]+)\//.exec(output.path);
        if (match?.[1] && match[2]) ids.set(`${match[1]}/${match[2]}`, id);
      }
    }
    return ids;
  } catch {
    return new Map();
  }
}

const LOCAL_ASSET_PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#181818"/><path d="M64 82l64-36 64 36v76l-64 38-64-38z" fill="#252a31" stroke="#579eff" stroke-width="8"/><path d="M64 82l64 38 64-38M128 120v76" fill="none" stroke="#579eff" stroke-width="8"/><text x="128" y="226" text-anchor="middle" fill="#9aa4b2" font-family="sans-serif" font-size="18">PREVIEW PENDING</text></svg>';

function sendLocalPlaceholder(res: import('express').Response): void {
  res.set('Cache-Control', 'no-store').type('image/svg+xml').send(LOCAL_ASSET_PLACEHOLDER_SVG);
}

async function pipeCloudThumbnail(id: string, res: import('express').Response): Promise<boolean> {
  try {
    const response = await fetch(
      `${getCloudAssetBaseUrl()}/v1/assets/${encodeURIComponent(id)}/thumbnail`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok || !response.body) return false;
    const length = response.headers.get('Content-Length');
    if (length) res.set('Content-Length', length);
    res
      .set('Cache-Control', response.headers.get('Cache-Control') ?? 'public, max-age=86400')
      .type(response.headers.get('Content-Type') ?? 'image/webp');
    await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), res);
    return true;
  } catch {
    return false;
  }
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

function cloudCatalogUnavailableMessage(): string {
  return (
    'The hosted asset catalog did not answer with a readable manifest. ' +
    'Check the network connection and retry.'
  );
}

async function searchCloudCatalog(input: {
  q: string;
  type: string;
  category?: string;
  offset: number;
  limit: number;
}): Promise<{ assets: OnlineAsset[]; total: number }> {
  const manifest = await loadCloudAssetManifest();
  if (!manifest) throw new Error(cloudCatalogUnavailableMessage());
  const query = input.q.trim().toLowerCase();
  const matches = manifest.assets.filter((asset) => {
    if (!cloudAssetMatchesType(asset, input.type)) return false;
    if (input.category && !asset.categories.includes(input.category)) return false;
    if (query) {
      const haystack = `${asset.name} ${asset.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  return {
    total: matches.length,
    assets: matches.slice(input.offset, input.offset + input.limit).map((asset) => ({
      id: asset.id,
      source: 'local',
      name: asset.name,
      type: asset.type as OnlineAsset['type'],
      thumbnailUrl: `/__editor/asset-library/thumbnails/${asset.id}.webp`,
      categories: asset.categories,
      tags: asset.tags,
      license: asset.license,
      author: asset.author,
      sourceUrl: asset.sourceUrl,
      cloudHosted: true,
      variantId: asset.id,
      variantCount: 1,
      sizeBytes: asset.files.reduce(
        (total, file) =>
          total +
          file.main.sizeBytes +
          file.dependencies.reduce((dependencyTotal, dependency) => {
            return dependencyTotal + dependency.sizeBytes;
          }, 0),
        0,
      ),
      deliveryKinds: ['cloud'],
      addedAt: manifest.generatedAt,
    })),
  };
}

function cloudAssetFileOptions(asset: CloudAssetRecord): AssetFileOption[] {
  return asset.files.map((file, fileIndex) => ({
    label: `${asset.label} · Cloud · ${file.label}`,
    format: file.format,
    url: cloudAssetObjectUrl(asset.id, fileIndex),
    sizeBytes: file.main.sizeBytes,
    ...(file.dependencies.length > 0
      ? {
          includes: file.dependencies.map((dependency, dependencyIndex) => ({
            relativePath: dependency.relativePath,
            url: cloudAssetObjectUrl(asset.id, fileIndex, dependencyIndex),
            size: dependency.sizeBytes,
          })),
        }
      : {}),
  }));
}

async function resolveCloudAssetPreview(assetId: string): Promise<{
  path: string;
  format: string;
  label: string;
  sourceAssetId: string;
  materialPath?: string;
} | null> {
  const asset = await findCloudAsset(assetId);
  if (!asset) return null;
  for (const [fileIndex, file] of asset.files.entries()) {
    const format = file.format.toLowerCase();
    if (!LOCAL_ASSET_LAB_FORMATS.has(format)) continue;
    const material = file.dependencies.find(
      (dependency) => extname(dependency.relativePath).toLowerCase() === '.mtl',
    );
    return {
      path: cloudPreviewFileUrl(asset.id, fileIndex, file.main.relativePath),
      format,
      label: file.label,
      sourceAssetId: asset.id,
      ...(material
        ? { materialPath: cloudPreviewFileUrl(asset.id, fileIndex, material.relativePath) }
        : {}),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Poly Haven helpers
// ---------------------------------------------------------------------------

const PH_HEADERS = { 'User-Agent': 'Volter-Editor/1.0' };

/** Map Poly Haven asset type strings to our unified types. */
function phTypeToUnified(phType: string): OnlineAsset['type'] {
  if (phType === 'hdris') return 'hdri';
  if (phType === 'textures') return 'texture';
  return 'model';
}

interface PHAssetEntry {
  name: string;
  type: number; // 0=hdri, 1=texture, 2=model — but we use the query type
  categories: string[];
  tags: string[];
  thumbnail_url?: string;
  download_count?: number;
}

async function searchPolyHaven(
  type: string,
  category?: string,
): Promise<{ assets: OnlineAsset[]; total: number }> {
  const cacheKey = `ph:${type}:${category ?? ''}`;
  const cached = getCached<{ assets: OnlineAsset[]; total: number }>(cacheKey);
  if (cached) return cached;

  let url = `https://api.polyhaven.com/assets?type=${type}`;
  if (category) url += `&categories=${category}`;

  const res = await fetch(url, { headers: PH_HEADERS });
  if (!res.ok) throw new Error(`Poly Haven API error: ${res.status}`);

  const data = (await res.json()) as Record<string, PHAssetEntry>;
  const assets: OnlineAsset[] = Object.entries(data).map(([id, entry]) => ({
    id,
    source: 'polyhaven' as const,
    name: entry.name,
    type: phTypeToUnified(type),
    thumbnailUrl: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256`,
    categories: entry.categories ?? [],
    tags: entry.tags ?? [],
    ...(entry.download_count != null ? { downloadCount: entry.download_count } : {}),
  }));

  const result = { assets, total: assets.length };
  setCache(cacheKey, result);
  return result;
}

interface PHFileInfo {
  url: string;
  size: number;
  md5?: string;
  include?: Record<string, { url: string; size: number }>;
}

type PHFilesResponse = Record<string, Record<string, Record<string, PHFileInfo>>>;

async function getPolyHavenFiles(id: string): Promise<AssetFileOption[]> {
  const cacheKey = `ph-files:${id}`;
  const cached = getCached<AssetFileOption[]>(cacheKey);
  if (cached) return cached;

  const res = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: PH_HEADERS });
  if (!res.ok) throw new Error(`Poly Haven files API error: ${res.status}`);

  const data = (await res.json()) as PHFilesResponse;
  const files: AssetFileOption[] = [];

  // Models: GLTF with included files (bin + textures)
  if (data['gltf']) {
    for (const [resolution, formats] of Object.entries(data['gltf'])) {
      const gltfInfo = formats['gltf'];
      if (!gltfInfo) continue;

      const includes: { relativePath: string; url: string; size: number }[] = [];
      let totalSize = gltfInfo.size;

      if (gltfInfo.include) {
        for (const [relPath, fileInfo] of Object.entries(gltfInfo.include)) {
          includes.push({ relativePath: relPath, url: fileInfo.url, size: fileInfo.size });
          totalSize += fileInfo.size;
        }
      }

      const entry: AssetFileOption = {
        label: `GLTF ${resolution}`,
        format: 'gltf',
        url: gltfInfo.url,
        sizeBytes: totalSize,
      };
      if (includes.length > 0) entry.includes = includes;
      files.push(entry);
    }
  }

  // HDRIs
  if (data['hdri']) {
    for (const [resolution, formats] of Object.entries(data['hdri'])) {
      for (const [fmt, info] of Object.entries(formats)) {
        files.push({
          label: `${fmt.toUpperCase()} ${resolution}`,
          format: fmt,
          url: info.url,
          sizeBytes: info.size,
        });
      }
    }
  }

  setCache(cacheKey, files);
  return files;
}

// ---------------------------------------------------------------------------
// ambientCG helpers
// ---------------------------------------------------------------------------

interface ACGAsset {
  assetId: string;
  displayName: string;
  dataType: string;
  tags: string[];
  previewImage?: { [key: string]: string };
  downloadFolders?: Record<
    string,
    {
      downloadFiletypeCategories: Record<
        string,
        {
          downloads: Array<{
            attribute: string;
            downloadLink: string;
            zipContent?: string[];
            fileSizeInBytes?: number;
            fileName?: string;
          }>;
        }
      >;
    }
  >;
}

interface ACGResponse {
  foundAssets: ACGAsset[];
  numberOfResults: number;
}

function acgTypeParam(type: string): string {
  // ambientCG types: Material, HDRI, etc.
  if (type === 'materials') return 'Material';
  if (type === 'hdris') return 'HDRI';
  return type;
}

async function searchAmbientCG(
  type: string,
  q?: string,
  offset = 0,
  limit = 48,
): Promise<{ assets: OnlineAsset[]; total: number }> {
  const cacheKey = `acg:${type}:${q ?? ''}:${offset}:${limit}`;
  const cached = getCached<{ assets: OnlineAsset[]; total: number }>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    type: acgTypeParam(type),
    limit: String(limit),
    offset: String(offset),
    include: 'previewData,downloadData,tagData',
    sort: 'Popular',
  });
  if (q) params.set('q', q);

  const res = await fetch(`https://ambientcg.com/api/v2/full_json?${params}`);
  if (!res.ok) throw new Error(`ambientCG API error: ${res.status}`);

  const data = (await res.json()) as ACGResponse;
  const assets: OnlineAsset[] = data.foundAssets.map((a) => ({
    id: a.assetId,
    source: 'ambientcg' as const,
    name: a.displayName,
    type: type === 'hdris' ? ('hdri' as const) : ('material' as const),
    thumbnailUrl: a.previewImage?.['256-PNG'] ?? '',
    categories: [],
    tags: a.tags ?? [],
  }));

  // Cache raw data for file extraction later
  for (const a of data.foundAssets) {
    setCache(`acg-raw:${a.assetId}`, a);
  }

  const result = { assets, total: data.numberOfResults };
  setCache(cacheKey, result);
  return result;
}

function getAmbientCGFiles(id: string): AssetFileOption[] {
  const raw = getCached<ACGAsset>(`acg-raw:${id}`);
  if (!raw || !raw.downloadFolders) return [];

  const files: AssetFileOption[] = [];
  for (const folder of Object.values(raw.downloadFolders)) {
    for (const [_category, cat] of Object.entries(folder.downloadFiletypeCategories)) {
      for (const dl of cat.downloads) {
        const entry: AssetFileOption = {
          label: dl.attribute || dl.fileName || 'Download',
          format: dl.downloadLink.endsWith('.zip') ? 'zip' : 'unknown',
          url: dl.downloadLink,
        };
        if (dl.fileSizeInBytes != null) entry.sizeBytes = dl.fileSizeInBytes;
        files.push(entry);
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAssetLibraryRouter(getPublicRoot: () => string): Router {
  const router = express.Router();
  const historySnapshots = new Map<string, AssetHistorySnapshots>();
  const assetHistory = () => {
    const publicRoot = getPublicRoot();
    const existing = historySnapshots.get(publicRoot);
    if (existing) return existing;
    const created = new AssetHistorySnapshots(publicRoot);
    historySnapshots.set(publicRoot, created);
    return created;
  };
  const captureCommittedHistory = async (assetPath: string, beforeToken: string) => {
    try {
      return {
        assetPath,
        beforeToken,
        afterToken: await assetHistory().capture(assetPath),
      };
    } catch (error) {
      await assetHistory().restore(assetPath, beforeToken);
      throw error;
    }
  };

  /**
   * Record a completed materialization in `.vgai/assets.json` (D-AP3).
   *
   * `resultPath` is public-root-relative (what the route returns); the ledger is
   * keyed project-relative, hence the `public/` prefix.
   *
   * The bytes are already committed by the time we get here, so a ledger
   * failure must NOT be reported as a failed import. It degrades LOUDLY
   * instead: logged on the server and surfaced to the client as `ledgerError`.
   */
  const recordLedger = async (
    resultPath: string,
    entry: { key: string; license?: string | undefined; sourceSha256?: string | undefined },
  ): Promise<string | undefined> => {
    try {
      await recordAssetMaterialization({
        projectRoot: dirname(getPublicRoot()),
        destPath: `public/${resultPath}`,
        ...entry,
      });
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // biome-ignore lint/suspicious/noConsole: the dev server's terminal is its own report channel for a ledger write that failed after the import succeeded.
      console.error(
        `[asset-ledger] ${resultPath} was imported but its provenance could not be recorded ` +
          `in .vgai/assets.json: ${message}`,
      );
      return message;
    }
  };

  router.post('/history/capture', async (req, res) => {
    const assetPath = (req.body as { assetPath?: unknown }).assetPath;
    if (typeof assetPath !== 'string') {
      res.status(400).json({ error: 'Asset history capture requires an asset path.' });
      return;
    }
    try {
      res.json({ ok: true, token: await assetHistory().capture(assetPath) });
    } catch (error) {
      res.status(400).json({
        error: `Asset history capture failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  router.post('/history/restore', async (req, res) => {
    const body = req.body as { assetPath?: unknown; token?: unknown };
    if (typeof body.assetPath !== 'string' || typeof body.token !== 'string') {
      res.status(400).json({ error: 'Asset history restore requires an asset path and token.' });
      return;
    }
    try {
      await assetHistory().restore(body.assetPath, body.token);
      broadcast('assets-changed', {});
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        error: `Asset history restore failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
  router.use(express.json());

  // ---- Search ----
  router.get('/search', async (req, res) => {
    const source = req.query['source'] as string;
    const type = req.query['type'] as string;
    const q = (req.query['q'] as string) ?? '';
    const category = req.query['category'] as string | undefined;
    const offset = Number.parseInt((req.query['offset'] as string) ?? '0', 10);
    const limit = Number.parseInt((req.query['limit'] as string) ?? '48', 10);

    if (!source || !type) {
      res.status(400).json({ error: 'Missing source or type.' });
      return;
    }

    try {
      let result: { assets: OnlineAsset[]; total: number };

      if (source === 'local') {
        try {
          const catalog = await loadLocalAssetCatalog();
          const localResult = searchLocalCatalog(catalog, {
            q,
            type,
            offset,
            limit,
            ...(category ? { category } : {}),
          });
          const cloudAssets = await findCloudAssets(
            localResult.assets.flatMap((asset) => asset.variants.map((variant) => variant.id)),
          );
          const cloudIds = new Set(cloudAssets.map((asset) => asset.id));
          result = {
            total: localResult.total,
            assets: localResult.assets.map((asset) => {
              const hostedVariant = asset.variants.find((variant) => cloudIds.has(variant.id));
              return {
                id: asset.familyId,
                source: 'local' as const,
                name: asset.name,
                type: asset.type,
                thumbnailUrl: `/__editor/asset-library/thumbnails/${hostedVariant?.id ?? asset.familyId}.webp`,
                categories: asset.categories,
                tags: asset.tags,
                license: asset.license,
                author: asset.author,
                sourceUrl: asset.sourceUrl,
                cloudHosted: Boolean(hostedVariant),
                variantId: asset.id,
                variantCount: asset.variants.length,
                sizeBytes: asset.variants.reduce(
                  (total, variant) =>
                    total +
                    variant.files.reduce((variantTotal, file) => variantTotal + file.sizeBytes, 0),
                  0,
                ),
                animationCount: asset.variants.reduce(
                  (total, variant) => total + (variant.animationCount ?? 0),
                  0,
                ),
                deliveryKinds: [
                  ...new Set(
                    asset.variants.flatMap((variant) =>
                      variant.deliveries
                        .filter((delivery) => delivery.available)
                        .map((delivery) => delivery.kind),
                    ),
                  ),
                ],
                addedAt: catalog.generatedAt,
                capabilities: localAssetCapabilities(asset),
              };
            }),
          };
        } catch (error) {
          if (!(error instanceof LocalAssetCatalogUnavailableError)) throw error;
          result = await searchCloudCatalog({
            q,
            type,
            offset,
            limit,
            ...(category ? { category } : {}),
          });
        }
      } else if (source === 'polyhaven') {
        result = await searchPolyHaven(type, category);
        // Client-side text filter (PH API doesn't have text search)
        if (q) {
          const lower = q.toLowerCase();
          result = {
            assets: result.assets.filter(
              (a) =>
                a.name.toLowerCase().includes(lower) ||
                a.tags.some((t) => t.toLowerCase().includes(lower)),
            ),
            total: 0, // will be set below
          };
          result.total = result.assets.length;
        }
        // Manual pagination for PH (returns all at once)
        result = {
          assets: result.assets.slice(offset, offset + limit),
          total: result.total,
        };
      } else if (source === 'ambientcg') {
        result = await searchAmbientCG(type, q || undefined, offset, limit);
      } else {
        res.status(400).json({ error: `Unknown source: ${source}` });
        return;
      }

      res.json(result);
    } catch (err) {
      // A LOCAL host that carries no asset catalog is not an upstream fault —
      // saying `Upstream API error: ENOENT` for a file that was never on this
      // disk sends the reader to the network for a realm problem.
      if (err instanceof LocalAssetCatalogUnavailableError) {
        res.status(501).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: `Upstream API error: ${err}` });
    }
  });

  // ---- Read-only Asset Lab preview for the SSD catalog ----
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the route visibly walks ranked format variants and reports each distinct availability outcome.
  router.get('/preview', async (req, res) => {
    const source = req.query['source'] as string;
    const id = req.query['id'] as string;
    if (source !== 'local' || !/^[a-f0-9]{24}$/.test(id)) {
      res.status(400).json({ error: 'A valid local catalog asset id is required.' });
      return;
    }

    try {
      const catalog = await loadLocalAssetCatalog();
      const selectedAsset = await findLocalAsset(id);
      if (!selectedAsset) {
        const cloudPreview = await resolveCloudAssetPreview(id);
        if (cloudPreview) res.json(cloudPreview);
        else res.status(404).json({ error: 'Catalog asset not found.' });
        return;
      }
      const libraryRoot = getLocalAssetLibraryRoot();
      for (const candidate of localAssetPreviewVariants(selectedAsset, catalog.assets)) {
        for (const [fileIndex, file] of candidate.files.entries()) {
          const format = file.format.toLowerCase();
          if (!LOCAL_ASSET_LAB_FORMATS.has(format)) continue;
          try {
            await stat(requireCatalogFile(libraryRoot, file.path));
          } catch {
            continue;
          }
          const sourceDirectory = dirname(file.path);
          const mainRelativePath = relative(sourceDirectory, file.path).replaceAll('\\', '/');
          const materialPath = file.dependencies?.find(
            (dependency) => extname(dependency).toLowerCase() === '.mtl',
          );
          const materialRelativePath = materialPath
            ? relative(sourceDirectory, materialPath).replaceAll('\\', '/')
            : undefined;
          res.json({
            path: localPreviewFileUrl(candidate.id, fileIndex, mainRelativePath),
            format,
            label: file.label,
            sourceAssetId: candidate.id,
            ...(materialRelativePath
              ? {
                  materialPath: localPreviewFileUrl(candidate.id, fileIndex, materialRelativePath),
                }
              : {}),
          });
          return;
        }
      }
      for (const candidate of localAssetPreviewVariants(selectedAsset, catalog.assets)) {
        const cloudPreview = await resolveCloudAssetPreview(candidate.id);
        if (!cloudPreview) continue;
        res.json(cloudPreview);
        return;
      }
      res.status(404).json({ error: 'No Asset Lab-compatible variant is available.' });
    } catch (error) {
      if (error instanceof LocalAssetCatalogUnavailableError) {
        const cloudPreview = await resolveCloudAssetPreview(id);
        if (cloudPreview) res.json(cloudPreview);
        else res.status(404).json({ error: 'No cloud Asset Lab-compatible variant is available.' });
        return;
      }
      res.status(500).json({ error: `Local Asset Lab preview failed: ${error}` });
    }
  });

  router.get('/preview-files/:id/:fileIndex/*path', async (req, res) => {
    const id = req.params['id'];
    const fileIndex = Number.parseInt(req.params['fileIndex'] ?? '', 10);
    const pathParam = req.params['path'] as unknown;
    const requestedRelativePath = (Array.isArray(pathParam) ? pathParam : [pathParam])
      .filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
      .join('/');
    if (!id || !/^[a-f0-9]{24}$/.test(id) || !Number.isInteger(fileIndex)) {
      res.status(400).json({ error: 'Invalid catalog preview path.' });
      return;
    }

    try {
      const asset = await findLocalAsset(id);
      const file = asset?.files[fileIndex];
      if (!file) {
        res.status(404).json({ error: 'Catalog preview file not found.' });
        return;
      }
      const sourceDirectory = dirname(file.path);
      const exactPath = [file.path, ...(file.dependencies ?? [])].find(
        (candidate) =>
          relative(sourceDirectory, candidate).replaceAll('\\', '/') === requestedRelativePath,
      );
      const basenameMatches = (file.dependencies ?? []).filter(
        (candidate) => basename(candidate) === basename(requestedRelativePath),
      );
      const allowedPath = exactPath ?? (basenameMatches.length === 1 ? basenameMatches[0] : null);
      if (!allowedPath) {
        res.status(404).json({ error: 'Catalog preview dependency not found.' });
        return;
      }
      const absolutePath = requireCatalogFile(getLocalAssetLibraryRoot(), allowedPath);
      await stat(absolutePath);
      res.set('Cache-Control', 'private, max-age=3600').sendFile(absolutePath);
    } catch {
      res.status(404).json({ error: 'Catalog preview file not found.' });
    }
  });

  // Cloud previews stay same-origin so glTF relative dependencies resolve
  // through this validated route instead of guessing the Worker's object URL.
  router.get('/cloud-preview-files/:id/:fileIndex/*path', async (req, res) => {
    const id = req.params['id'];
    const fileIndex = Number.parseInt(req.params['fileIndex'] ?? '', 10);
    const pathParam = req.params['path'] as unknown;
    const requestedRelativePath = (Array.isArray(pathParam) ? pathParam : [pathParam])
      .filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
      .join('/');
    if (!id || !/^[a-f0-9]{24}$/.test(id) || !Number.isInteger(fileIndex)) {
      res.status(400).json({ error: 'Invalid cloud catalog preview path.' });
      return;
    }

    try {
      const asset = await findCloudAsset(id);
      const file = asset?.files[fileIndex];
      if (!file) {
        res.status(404).json({ error: 'Cloud catalog preview file not found.' });
        return;
      }
      const objects = [file.main, ...file.dependencies];
      const objectIndex = objects.findIndex(
        (candidate) => candidate.relativePath === requestedRelativePath,
      );
      const object = objects[objectIndex];
      if (!object) {
        res.status(404).json({ error: 'Cloud catalog preview dependency not found.' });
        return;
      }
      const dependencyIndex = objectIndex === 0 ? undefined : objectIndex - 1;
      const response = await fetch(cloudAssetObjectUrl(id, fileIndex, dependencyIndex), {
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok || !response.body) {
        res.status(502).json({ error: `Cloud preview delivery failed (${response.status}).` });
        return;
      }
      res
        .set('Cache-Control', 'private, max-age=3600')
        .set('Content-Length', String(object.sizeBytes))
        .type(object.contentType);
      await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), res);
    } catch (error) {
      if (!res.headersSent) {
        res.status(502).json({ error: `Cloud catalog preview failed: ${error}` });
      }
    }
  });

  // ---- File options for an asset ----
  router.get('/files', async (req, res) => {
    const source = req.query['source'] as string;
    const id = req.query['id'] as string;

    if (!source || !id) {
      res.status(400).json({ error: 'Missing source or id.' });
      return;
    }

    try {
      let files: AssetFileOption[];

      if (source === 'local') {
        let family: Awaited<ReturnType<typeof findLocalAssetFamily>> = null;
        try {
          family = await findLocalAssetFamily(id);
        } catch (error) {
          if (!(error instanceof LocalAssetCatalogUnavailableError)) throw error;
        }
        if (!family) {
          const cloudAsset = await findCloudAsset(id);
          if (!cloudAsset) {
            res.status(404).json({ error: 'Catalog asset not found.' });
            return;
          }
          res.json({ files: cloudAssetFileOptions(cloudAsset) });
          return;
        }
        const cloudFiles: AssetFileOption[] = [];
        const localFiles: AssetFileOption[] = [];
        for (const variant of family?.variants ?? []) {
          const cloudAsset = await findCloudAsset(variant.id);
          if (cloudAsset) {
            cloudFiles.push(...cloudAssetFileOptions(cloudAsset));
          }
          const variantAsset = await findLocalAsset(variant.id);
          const localDeliveryAvailable = variant.deliveries.some(
            (delivery) => delivery.kind === 'local-ssd' && delivery.available,
          );
          if (variantAsset && localDeliveryAvailable) {
            localFiles.push(
              ...(
                await Promise.all(
                  variantAsset.files.map(async (file, index): Promise<AssetFileOption | null> => {
                    try {
                      await stat(requireCatalogFile(getLocalAssetLibraryRoot(), file.path));
                      return {
                        label: `${variant.label} · SSD · ${file.label}`,
                        format: file.format,
                        url: `vgai-local:${variant.id}:${index}`,
                        sizeBytes: file.sizeBytes,
                      };
                    } catch {
                      return null;
                    }
                  }),
                )
              ).filter((file): file is AssetFileOption => file !== null),
            );
          }
        }
        files = [...cloudFiles, ...localFiles];
      } else if (source === 'polyhaven') {
        files = await getPolyHavenFiles(id);
      } else if (source === 'ambientcg') {
        files = getAmbientCGFiles(id);
        // If not cached, do a fresh search to populate
        if (files.length === 0) {
          await searchAmbientCG('materials', id, 0, 1);
          files = getAmbientCGFiles(id);
        }
      } else {
        res.status(400).json({ error: `Unknown source: ${source}` });
        return;
      }

      res.json({ files });
    } catch (err) {
      // A LOCAL host that carries no asset catalog is not an upstream fault —
      // saying `Upstream API error: ENOENT` for a file that was never on this
      // disk sends the reader to the network for a realm problem.
      if (err instanceof LocalAssetCatalogUnavailableError) {
        res.status(501).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: `Upstream API error: ${err}` });
    }
  });

  // ---- Download ----
  router.post('/download', async (req, res) => {
    const body = req.body as {
      source: string;
      id: string;
      name: string;
      url: string;
      format: string;
      jobId?: string;
      includes?: { relativePath: string; url: string; size: number }[];
      /** License the CLIENT already read off the library's own search result.
       *  Used only for the remote (polyhaven/ambientcg) proxy, whose upstream
       *  APIs are not re-queried here; the local/cloud catalog paths resolve the
       *  license server-side and ignore this. */
      license?: string;
    };
    const { source, id, name, url, format } = body;
    const cancellation = new AbortController();
    req.once('aborted', () =>
      cancellation.abort(new DOMException('Import cancelled', 'AbortError')),
    );
    res.once('close', () => {
      if (!res.writableEnded)
        cancellation.abort(new DOMException('Import cancelled', 'AbortError'));
    });
    const throwIfCancelled = () => cancellation.signal.throwIfAborted();
    const progress = (
      stage: 'fetch' | 'convert' | 'validate' | 'commit',
      loaded: number,
      total: number,
      message?: string,
    ) => {
      if (!body.jobId) return;
      broadcast('asset-import-progress', {
        jobId: body.jobId,
        stage,
        loaded,
        total,
        ...(message ? { message } : {}),
      });
    };
    const includes = body.includes ?? [];

    if (!source || !id || !url) {
      res.status(400).json({ error: 'Missing required fields.' });
      return;
    }

    // S1: only allow known sources — `source` is used as a path segment below.
    if (!isAllowedAssetSource(source)) {
      res.status(400).json({ error: `Unknown source: ${source}` });
      return;
    }

    if (source === 'local') {
      let stagingDir: string | null = null;
      try {
        let family: Awaited<ReturnType<typeof findLocalAssetFamily>> = null;
        let asset: Awaited<ReturnType<typeof findLocalAsset>> = null;
        try {
          family = await findLocalAssetFamily(id);
          asset = family ? await findLocalAsset(family.id) : null;
        } catch (error) {
          if (!(error instanceof LocalAssetCatalogUnavailableError)) throw error;
        }
        const publicRoot = getPublicRoot();
        const cloudVariantId = /\/v1\/assets\/([a-f0-9]{24})\/files\//.exec(url)?.[1];
        const cloudRoute = cloudVariantId ? parseCloudAssetObjectUrl(url, cloudVariantId) : null;
        if (cloudRoute && cloudRoute.dependencyIndex === undefined) {
          const cloudAsset = await findCloudAsset(cloudVariantId!);
          const cloudFile = cloudAsset?.files[cloudRoute.fileIndex];
          const matchesCatalogIdentity = family
            ? family.variants.some((variant) => variant.id === cloudVariantId)
            : cloudAsset?.id === id || cloudAsset?.familyId === id;
          if (
            !cloudAsset ||
            !cloudFile ||
            (asset !== null && cloudAsset.source !== asset.source) ||
            !matchesCatalogIdentity
          ) {
            res.status(404).json({ error: 'Cloud asset file not found.' });
            return;
          }
          const assetSlug = asset ? localAssetSlug(asset) : cloudAssetSlug(cloudAsset);
          const destDir = join(publicRoot, 'asset-library', 'local', assetSlug);
          stagingDir = await beginAssetStaging(destDir);
          const mainDestination = join(stagingDir, cloudFile.main.relativePath);
          if (!isPathInside(stagingDir, mainDestination)) {
            await rm(stagingDir, { recursive: true, force: true });
            stagingDir = null;
            res.status(400).json({ error: 'Invalid cloud asset path.' });
            return;
          }
          await downloadRemoteFile(
            url,
            mainDestination,
            cloudFile.main.sha256,
            cloudFile.main.sizeBytes,
            (loaded, total) => progress('fetch', loaded, total),
            cancellation.signal,
          );
          for (const [dependencyIndex, dependency] of cloudFile.dependencies.entries()) {
            const destination = join(stagingDir, dependency.relativePath);
            if (!isPathInside(stagingDir, destination)) {
              await rm(stagingDir, { recursive: true, force: true });
              stagingDir = null;
              res
                .status(400)
                .json({ error: `Invalid dependency path: ${dependency.relativePath}` });
              return;
            }
            await downloadRemoteFile(
              cloudAssetObjectUrl(cloudVariantId!, cloudRoute.fileIndex, dependencyIndex),
              destination,
              dependency.sha256,
              dependency.sizeBytes,
              (loaded, total) =>
                progress('fetch', loaded, total, `Dependency ${dependencyIndex + 1}`),
              cancellation.signal,
            );
          }
          const cloudResultPath = `asset-library/local/${assetSlug}/${cloudFile.main.relativePath}`;
          progress('validate', cloudFile.main.sizeBytes, cloudFile.main.sizeBytes);
          throwIfCancelled();
          if (asset) await copyLocalAssetThumbnail(asset, stagingDir);
          const beforeToken = await assetHistory().capture(cloudResultPath);
          const committed = await commitCatalogAsset(publicRoot, stagingDir, destDir, {
            id: family?.id ?? id,
            variantId: cloudVariantId,
            name: asset?.name ?? cloudAsset.name,
            source: asset?.source ?? cloudAsset.source,
            sourceUrl: asset?.sourceUrl ?? cloudAsset.sourceUrl,
            author: asset?.author ?? cloudAsset.author,
            license: asset?.license ?? cloudAsset.license,
            delivery: 'cloudflare-r2',
            attribution: cloudAsset.attribution,
            sha256: cloudFile.main.sha256,
          });
          progress('commit', 1, 1);
          stagingDir = null;
          const resultPath = cloudResultPath;
          const history = await captureCommittedHistory(resultPath, beforeToken);
          const ledgerError = await recordLedger(resultPath, {
            key: assetKey(source, id),
            license: asset?.license ?? cloudAsset.license,
            sourceSha256: cloudFile.main.sha256,
          });
          broadcast('assets-changed', {});
          res.json({
            ok: true,
            path: resultPath,
            provenanceOperationId: committed.provenanceOperationId,
            history,
            ...(ledgerError ? { ledgerError } : {}),
          });
          return;
        }

        if (!asset || !family) {
          res.status(404).json({
            error:
              'This asset has no hosted delivery, and the optional SSD archive is not available.',
          });
          return;
        }
        const assetSlug = localAssetSlug(asset);
        const destDir = join(publicRoot, 'asset-library', 'local', assetSlug);

        const match = url.match(/^vgai-local:([a-f0-9]{24}):(\d+)$/);
        const selectedAsset = match?.[1] ? await findLocalAsset(match[1]) : null;
        const selectedFile =
          selectedAsset && selectedAsset.familyId === family.id
            ? selectedAsset.files[Number(match?.[2])]
            : undefined;
        if (!selectedFile || !selectedAsset) {
          res.status(404).json({ error: 'Local asset file not found.' });
          return;
        }
        const libraryRoot = getLocalAssetLibraryRoot();
        const mainSource = requireCatalogFile(libraryRoot, selectedFile.path);
        const sourceDirectory = dirname(mainSource);
        stagingDir = await beginAssetStaging(destDir);
        const primaryRelative = basename(mainSource);
        const stagedPrimary = join(stagingDir, primaryRelative);
        progress('fetch', 0, selectedFile.sizeBytes);
        await copyFile(mainSource, stagedPrimary);
        progress('fetch', selectedFile.sizeBytes, selectedFile.sizeBytes);
        throwIfCancelled();
        for (const dependency of selectedFile.dependencies ?? []) {
          const dependencySource = requireCatalogFile(libraryRoot, dependency);
          const sourceRelative = relative(sourceDirectory, dependencySource);
          const dependencyRelative = sourceRelative.startsWith('..')
            ? basename(dependencySource)
            : sourceRelative;
          const dependencyDestination = join(stagingDir, dependencyRelative);
          await mkdir(dirname(dependencyDestination), { recursive: true });
          await copyFile(dependencySource, dependencyDestination);
        }
        let resultFile = primaryRelative;
        let backend: 'native' | 'three' = 'native';
        const format = selectedFile.format.toLowerCase();
        if (SERVER_CONVERTIBLE_MODEL_FORMATS.has(format)) {
          progress('convert', 0, 1);
          resultFile = `${basename(primaryRelative, extname(primaryRelative))}.glb`;
          const converted = await convertStagedModelToGlb(stagedPrimary, format);
          await writeFile(join(stagingDir, resultFile), converted);
          backend = 'three';
          progress('convert', 1, 1);
          throwIfCancelled();
        }
        const resultPath = `asset-library/local/${assetSlug}/${resultFile}`;
        progress('validate', 1, 1);
        throwIfCancelled();
        await copyLocalAssetThumbnail(asset, stagingDir);
        const beforeToken = await assetHistory().capture(resultPath);
        const committed = await commitCatalogAsset(publicRoot, stagingDir, destDir, {
          id: family.id,
          variantId: selectedAsset.id,
          name: asset.name,
          source: asset.source,
          sourceUrl: asset.sourceUrl,
          author: asset.author,
          license: asset.license,
          delivery: 'local-ssd',
          originalPath: selectedFile.path,
        });
        progress('commit', 1, 1);
        stagingDir = null;
        const history = await captureCommittedHistory(resultPath, beforeToken);
        // A converted copy is DERIVED, not a byte-copy of the library's file, so
        // the catalog digest would never match it — omit rather than record a
        // hash that reads as permanent drift.
        const ledgerError = await recordLedger(resultPath, {
          key: assetKey(source, id),
          license: asset.license,
          sourceSha256: backend === 'native' ? selectedFile.sha256 : undefined,
        });
        broadcast('assets-changed', {});
        res.json({
          ok: true,
          path: resultPath,
          provenanceOperationId: committed.provenanceOperationId,
          history,
          ...(ledgerError ? { ledgerError } : {}),
        });
      } catch (error) {
        if (stagingDir) await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        res.status(500).json({ error: `Local asset copy failed: ${error}` });
      }
      return;
    }

    // S2: restrict the main download URL (and includes) to allowlisted CDNs,
    // blocking SSRF to private / link-local addresses.
    if (!isAllowedAssetHost(url)) {
      res.status(400).json({ error: 'Download URL host is not allowed.' });
      return;
    }
    for (const inc of includes) {
      if (!isAllowedAssetHost(inc.url)) {
        res.status(400).json({ error: 'Included file URL host is not allowed.' });
        return;
      }
    }

    const publicRoot = getPublicRoot();
    const slug = (name || id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const destDir = join(publicRoot, 'asset-library', source, slug);

    // Skip if already downloaded
    try {
      await stat(destDir);
      const existing = await readdir(destDir);
      if (existing.length > 0) {
        // Find the main file (gltf/glb/hdr/exr, not textures)
        const mainFile = existing.find((f) => /\.(gltf|glb|hdr|exr)$/i.test(f)) ?? existing[0]!;
        res.json({
          ok: true,
          path: `asset-library/${source}/${slug}/${mainFile}`,
          alreadyExists: true,
        });
        return;
      }
    } catch {
      // Doesn't exist yet — continue
    }

    let stagingDir: string | null = null;
    try {
      stagingDir = await beginAssetStaging(destDir);

      /** Download a single file to a destination path. */
      async function downloadFile(
        fileUrl: string,
        destPath: string,
        expectedBytes?: number,
      ): Promise<void> {
        await mkdir(join(destPath, '..'), { recursive: true });
        const response = await fetch(fileUrl, { signal: cancellation.signal });
        if (!response.ok || !response.body) {
          throw new Error(`Download failed: ${response.status} for ${fileUrl}`);
        }
        const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
        const total =
          expectedBytes ?? Number.parseInt(response.headers.get('content-length') ?? '0', 10);
        let loaded = 0;
        const reporter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            loaded += chunk.length;
            progress('fetch', loaded, total);
            callback(null, chunk);
          },
        });
        await pipeline(nodeStream, reporter, createWriteStream(destPath));
      }

      const isZip = format === 'zip' || url.endsWith('.zip');
      const ext = isZip ? 'zip' : url.split('.').pop() || format || 'bin';
      const fileName = `${slug}.${ext}`;
      const filePath = join(stagingDir, fileName);

      // Download main file
      await downloadFile(url, filePath);

      // Download included files (GLTF bin + textures)
      for (const inc of includes) {
        const incPath = join(stagingDir, inc.relativePath);
        // S1: ensure each relativePath stays inside destDir (reject `..` escapes).
        if (!isPathInside(stagingDir, incPath)) {
          await rm(stagingDir, { recursive: true, force: true });
          stagingDir = null;
          res.status(400).json({ error: `Invalid include path: ${inc.relativePath}` });
          return;
        }
        await downloadFile(inc.url, incPath, inc.size);
      }

      let resultPath = `asset-library/${source}/${slug}/${fileName}`;

      // Extract ZIPs
      if (isZip) {
        progress('convert', 0, 1);
        await new Promise<void>((resolve, reject) => {
          execFile('unzip', ['-o', filePath, '-d', stagingDir!], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        await unlink(filePath).catch(() => {});
        const extracted = await readdir(stagingDir);
        const mainFile = extracted.find((f) => !f.endsWith('.zip')) ?? extracted[0];
        if (mainFile) {
          resultPath = `asset-library/${source}/${slug}/${mainFile}`;
        }
        progress('convert', 1, 1);
      }

      progress('validate', 1, 1);
      throwIfCancelled();
      const beforeToken = await assetHistory().capture(resultPath);
      const committed = await commitCatalogAsset(publicRoot, stagingDir, destDir, {
        id,
        name,
        source,
        sourceUrl: url,
        delivery: source,
      });
      progress('commit', 1, 1);
      stagingDir = null;
      const history = await captureCommittedHistory(resultPath, beforeToken);
      // No `sourceSha256`: the Poly Haven / ambientCG APIs publish no per-file
      // digest, so this copy has no library hash to drift against. Recording a
      // hash of the bytes we just wrote would fabricate a pristine-forever
      // record — the anti-shim rule forbids it.
      const ledgerError = await recordLedger(resultPath, {
        key: assetKey(source, id),
        license: body.license,
      });
      broadcast('assets-changed', {});

      res.json({
        ok: true,
        path: resultPath,
        provenanceOperationId: committed.provenanceOperationId,
        history,
        ...(ledgerError ? { ledgerError } : {}),
      });
    } catch (err) {
      if (stagingDir) await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      res.status(500).json({ error: `Download failed: ${err}` });
    }
  });

  // ---- Categories for Poly Haven ----
  router.get('/categories', async (req, res) => {
    const source = req.query['source'] as string | undefined;
    const type = req.query['type'] as string;
    if (!type) {
      res.status(400).json({ error: 'Missing type.' });
      return;
    }

    if (source === 'local') {
      try {
        let categories: string[];
        try {
          const catalog = await loadLocalAssetCatalog();
          categories = [
            ...new Set(
              catalog.assets
                .filter((asset) => localAssetMatchesType(asset, type))
                .flatMap((asset) => asset.categories),
            ),
          ].sort();
        } catch (error) {
          if (!(error instanceof LocalAssetCatalogUnavailableError)) throw error;
          const manifest = await loadCloudAssetManifest();
          if (!manifest) throw new Error(cloudCatalogUnavailableMessage());
          categories = [
            ...new Set(
              manifest.assets
                .filter((asset) => cloudAssetMatchesType(asset, type))
                .flatMap((asset) => asset.categories),
            ),
          ].sort();
        }
        res.json({ categories });
      } catch (error) {
        res.status(502).json({ error: `Asset catalog unavailable: ${error}` });
      }
      return;
    }

    const cacheKey = `ph-cats:${type}`;
    const cached = getCached<string[]>(cacheKey);
    if (cached) {
      res.json({ categories: cached });
      return;
    }

    try {
      const response = await fetch(`https://api.polyhaven.com/categories/${type}`, {
        headers: PH_HEADERS,
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = (await response.json()) as Record<string, number>;
      const categories = Object.keys(data).sort();
      setCache(cacheKey, categories);
      res.json({ categories });
    } catch (err) {
      // A LOCAL host that carries no asset catalog is not an upstream fault —
      // saying `Upstream API error: ENOENT` for a file that was never on this
      // disk sends the reader to the network for a realm problem.
      if (err instanceof LocalAssetCatalogUnavailableError) {
        res.status(501).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: `Upstream API error: ${err}` });
    }
  });

  router.get('/thumbnails/:id.webp', async (req, res) => {
    const id = req.params['id'];
    if (!id || !/^[a-f0-9]{24}$/.test(id)) {
      res.status(400).json({ error: 'Invalid local asset id.' });
      return;
    }
    const asset = await findLocalAsset(id).catch(() => null);
    if (asset) {
      try {
        const thumbnailPath = requireLocalAssetThumbnail(getLocalAssetLibraryRoot(), asset);
        const bytes = await readFile(thumbnailPath);
        res.set('Cache-Control', 'public, max-age=86400').type(extname(thumbnailPath)).send(bytes);
        return;
      } catch {
        // This checkout can carry the catalog index without the SSD thumbnail
        // bytes. The hosted variant remains the canonical portable fallback.
      }
    }
    const delivered = await pipeCloudThumbnail(asset?.id ?? id, res);
    if (!delivered && !res.headersSent) sendLocalPlaceholder(res);
  });

  router.get('/local-placeholder.svg', (_req, res) => {
    sendLocalPlaceholder(res);
  });

  // ---- List already-downloaded assets ----
  router.get('/downloaded', async (_req, res) => {
    const publicRoot = getPublicRoot();
    const libraryDir = join(publicRoot, 'asset-library');
    const downloaded: { source: string; id: string; path: string }[] = [];
    const centralIds = await centralCatalogIds(dirname(publicRoot));

    try {
      const sources = await readdir(libraryDir).catch(() => [] as string[]);
      for (const source of sources) {
        const sourceDir = join(libraryDir, source);
        const sourceStat = await stat(sourceDir).catch(() => null);
        if (!sourceStat?.isDirectory()) continue;

        const slugs = await readdir(sourceDir).catch(() => [] as string[]);
        for (const slug of slugs) {
          const slugDir = join(libraryDir, source, slug);
          const slugStat = await stat(slugDir).catch(() => null);
          if (!slugStat?.isDirectory()) continue;

          const files = await readdir(slugDir).catch(() => [] as string[]);
          const id = centralIds.get(`${source}/${slug}`) ?? slug;
          // Find the main asset file
          const assetFiles = files.filter((file) => file !== '.vgai-thumbnail.webp');
          const mainFile =
            assetFiles.find((file) => /\.(gltf|glb|hdr|exr)$/i.test(file)) ?? assetFiles[0];
          if (mainFile) {
            downloaded.push({
              source,
              id,
              path: `asset-library/${source}/${slug}/${mainFile}`,
            });
          }
        }
      }
    } catch {
      // Directory might not exist yet
    }

    res.json({ downloaded });
  });

  return router;
}

export async function downloadRemoteFile(
  url: string,
  destination: string,
  expectedSha256: string,
  expectedSizeBytes: number,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const response = await fetch(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
      : AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} for ${url}`);
  }
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        signal?.throwIfAborted();
        hash.update(chunk);
        sizeBytes += chunk.length;
        onProgress?.(sizeBytes, expectedSizeBytes);
        callback(null, chunk);
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  try {
    await pipeline(nodeStream, verifier, createWriteStream(destination));
    const actualSha256 = hash.digest('hex');
    if (actualSha256 !== expectedSha256 || sizeBytes !== expectedSizeBytes) {
      throw new Error(
        `Cloud asset integrity mismatch: expected ${expectedSha256}/${expectedSizeBytes}, got ${actualSha256}/${sizeBytes}`,
      );
    }
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw error;
  }
}

async function copyLocalAssetThumbnail(
  asset: NonNullable<Awaited<ReturnType<typeof findLocalAsset>>>,
  destination: string,
): Promise<void> {
  try {
    const source = requireLocalAssetThumbnail(getLocalAssetLibraryRoot(), asset);
    if (extname(source).toLowerCase() !== '.webp') return;
    await copyFile(source, join(destination, '.vgai-thumbnail.webp'));
  } catch {
    // A thumbnail is presentation cache, never a reason to fail an asset download.
  }
}
