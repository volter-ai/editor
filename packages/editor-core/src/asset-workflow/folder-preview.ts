/**
 * Folder preview content discovery.
 *
 * Scans a project folder (breadth-first, via the storage-backend-agnostic
 * `listAssets`) and picks up to four representative assets whose thumbnails a
 * folder tile can composite. Selection ranks candidates in two tiers —
 * tier 1 renders a real content thumbnail ('model', 'image' — including
 * capability-kind 'source' files whose extension the model-thumbnail pipeline
 * can render, see FOLDER_PREVIEW_MODEL_EXTENSIONS), tier 2 renders a
 * synthetic glyph ('audio', 'prefab', 'json') — preferring
 * tier 1, then shallower depth, then breadth-first directory listing order.
 *
 * Variety heuristic: within a tier, a first pass takes at most one candidate
 * per top-level subtree (the candidate's first path segment below the scanned
 * folder — a file directly inside the folder is its own subtree); remaining
 * slots are then filled from that tier in rank order. Tier 1 is exhausted
 * (both passes) before tier 2 is consulted, so tier preference dominates
 * variety.
 *
 * Termination: the traversal itself never early-stops on item count — it
 * walks everything the safety caps allow so `totalAssets` stays a useful
 * count, and item selection runs over the collected candidates afterwards.
 * `scannedAll` is false exactly when a cap (depth or listing budget) hid part
 * of the tree, letting the UI render an "N+" style count.
 */

import { type AssetEntry, listAssets as defaultListAssets, type Listing } from '../editor-api';
import { type AssetCapabilityKind, assetCapabilities } from '@volter/editor-sdk/kit/asset-capabilities';

/** Maximum number of preview items a folder summary carries. */
export const FOLDER_PREVIEW_MAX_ITEMS = 4;
/** Maximum directory depth entered below the scanned folder (folder itself = 0). */
export const FOLDER_PREVIEW_MAX_DEPTH = 4;
/** Maximum number of directory listings a single scan may perform. */
export const FOLDER_PREVIEW_MAX_LISTINGS = 24;
/** Bound on concurrent `listAssets` calls within one scan. */
export const FOLDER_PREVIEW_LIST_CONCURRENCY = 4;
/** Bound on concurrent scans across all `getFolderPreview` callers. */
export const FOLDER_PREVIEW_SCAN_CONCURRENCY = 3;

/** Kinds that render a real content thumbnail. */
export const FOLDER_PREVIEW_TIER1_KINDS: ReadonlySet<AssetCapabilityKind> = new Set([
  'model',
  'image',
]);
/**
 * File extensions the model-thumbnail pipeline can render live. Some of these
 * are kind 'source' in the capability registry (fbx/obj/dae/stl/ply/3ds/bvh),
 * but they still produce a real content thumbnail, so folder scans promote
 * them to tier-1 'model' candidates. Kept as a local list — importing
 * `modelThumbnailFormat` would drag three.js into this data-only module — and
 * pinned against `modelThumbnailFormat`'s supported set by a test.
 */
export const FOLDER_PREVIEW_MODEL_EXTENSIONS: ReadonlySet<string> = new Set([
  'glb',
  'gltf',
  'fbx',
  'obj',
  'dae',
  'stl',
  'ply',
  'spz',
  'bvh',
  '3ds',
]);

function hasPreviewableModelExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && FOLDER_PREVIEW_MODEL_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
/** Kinds that render a synthetic glyph thumbnail. */
export const FOLDER_PREVIEW_TIER2_KINDS: ReadonlySet<AssetCapabilityKind> = new Set([
  'audio',
  'video',
  'prefab',
  'json',
]);

export interface FolderPreviewItem {
  /** Path relative to the asset root — usable directly to build the asset URL. */
  path: string;
  name: string;
  kind: AssetCapabilityKind;
}

export interface FolderPreviewSummary {
  items: FolderPreviewItem[];
  /** Every non-hidden file seen by the (possibly capped) traversal. */
  totalAssets: number;
  /** False when a safety cap truncated the traversal (render counts as "N+"). */
  scannedAll: boolean;
  /** How many directory listings FAILED during the scan. Non-zero means this
   *  summary under-reports for a reason that is not "the folder is empty" —
   *  the counts below it are a floor, not a measurement. */
  failedListings: number;
}

export interface FolderPreviewOptions {
  /** Injectable listing function (tests); defaults to the editor API. */
  listAssets?: (root: string, dir: string) => Promise<Listing<AssetEntry>>;
  maxItems?: number;
  maxDepth?: number;
  maxListings?: number;
  listConcurrency?: number;
}

/** Minimal FIFO limiter bounding how many tasks run concurrently. */
function createLimiter(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((release) => waiting.push(release));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

function normalizeFolderPath(path: string): string {
  // Strip only explicit `./` and `/` prefixes — a bare `[./]+` class would eat
  // the leading dot of a real top-level dot-folder name (`.generated` →
  // `generated`: wrong directory AND a cache-key collision with `generated`).
  return path.replace(/^(?:\.\/|\/)+/, '').replace(/\/+$/, '');
}

/** First path segment below the scanned folder; a direct file is its own subtree. */
function subtreeKey(base: string, path: string): string {
  const relative = base ? path.slice(base.length + 1) : path;
  return relative.split('/', 1)[0] ?? relative;
}

interface Candidate extends FolderPreviewItem {
  tier: 1 | 2;
  depth: number;
  seq: number;
  subtree: string;
}

function rank(a: Candidate, b: Candidate): number {
  return a.tier - b.tier || a.depth - b.depth || a.seq - b.seq;
}

/** Variety pass (one candidate per subtree) then a fill pass, both in rank order. */
function pickFromTier(
  tierList: Candidate[],
  picked: Candidate[],
  usedSubtrees: Set<string>,
  maxItems: number,
): void {
  for (const candidate of tierList) {
    if (picked.length >= maxItems) break;
    if (usedSubtrees.has(candidate.subtree)) continue;
    usedSubtrees.add(candidate.subtree);
    picked.push(candidate);
  }
  for (const candidate of tierList) {
    if (picked.length >= maxItems) break;
    if (!picked.includes(candidate)) picked.push(candidate);
  }
}

function selectItems(candidates: Candidate[], maxItems: number): FolderPreviewItem[] {
  const sorted = [...candidates].sort(rank);
  const picked: Candidate[] = [];
  const usedSubtrees = new Set<string>();
  for (const tier of [1, 2] as const) {
    const tierList = sorted.filter((candidate) => candidate.tier === tier);
    pickFromTier(tierList, picked, usedSubtrees, maxItems);
  }
  picked.sort(rank);
  return picked.map(({ path, name, kind }) => ({ path, name, kind }));
}

function previewTier(kind: AssetCapabilityKind): 0 | 1 | 2 {
  if (FOLDER_PREVIEW_TIER1_KINDS.has(kind)) return 1;
  return FOLDER_PREVIEW_TIER2_KINDS.has(kind) ? 2 : 0;
}

interface PendingDir {
  dir: string;
  depth: number;
}

interface ScanState {
  base: string;
  maxDepth: number;
  candidates: Candidate[];
  totalAssets: number;
  truncated: boolean;
  failedListings: number;
  seq: number;
}

/** Fold one directory listing into the scan, queueing subdirectories on `next`. */
function ingestListing(
  state: ScanState,
  entry: PendingDir,
  assets: AssetEntry[],
  next: PendingDir[],
): void {
  for (const asset of assets) {
    if (asset.name.startsWith('.')) continue; // hidden, including .vgai
    const path = entry.dir ? `${entry.dir}/${asset.name}` : asset.name;
    if (asset.type === 'directory') {
      if (entry.depth + 1 > state.maxDepth) state.truncated = true;
      else next.push({ dir: path, depth: entry.depth + 1 });
      continue;
    }
    state.totalAssets++;
    const kind = hasPreviewableModelExtension(asset.name)
      ? 'model'
      : assetCapabilities(asset.name).kind;
    const tier = previewTier(kind);
    if (tier === 0) continue;
    state.candidates.push({
      path,
      name: asset.name,
      kind,
      tier,
      depth: entry.depth,
      seq: state.seq++,
      subtree: subtreeKey(state.base, path),
    });
  }
}

/**
 * Breadth-first scan of `folderPath` (relative to `root`) producing a
 * deterministic preview summary. Hidden entries (leading '.', including
 * `.vgai`) are skipped entirely; safety caps bound depth and listing count.
 */
export async function collectFolderPreview(
  root: string,
  folderPath: string,
  options: FolderPreviewOptions = {},
): Promise<FolderPreviewSummary> {
  const list = options.listAssets ?? defaultListAssets;
  const maxItems = options.maxItems ?? FOLDER_PREVIEW_MAX_ITEMS;
  const maxListings = options.maxListings ?? FOLDER_PREVIEW_MAX_LISTINGS;
  const limit = createLimiter(options.listConcurrency ?? FOLDER_PREVIEW_LIST_CONCURRENCY);
  const base = normalizeFolderPath(folderPath);
  const state: ScanState = {
    base,
    maxDepth: options.maxDepth ?? FOLDER_PREVIEW_MAX_DEPTH,
    candidates: [],
    totalAssets: 0,
    truncated: false,
    failedListings: 0,
    seq: 0,
  };

  let listings = 0;
  let level: PendingDir[] = [{ dir: base, depth: 0 }];
  while (level.length > 0) {
    const budget = Math.max(0, maxListings - listings);
    const toList = level.slice(0, budget);
    if (toList.length < level.length) state.truncated = true;
    listings += toList.length;
    // Concurrency is bounded by `limit`; Promise.all preserves queue order, so
    // results are processed deterministically regardless of resolution order.
    const results = await Promise.all(toList.map((entry) => limit(() => list(root, entry.dir))));
    const next: PendingDir[] = [];
    for (const [index, entry] of toList.entries()) {
      const listing = results[index];
      // A listing that FAILED is counted, not folded in as an empty directory.
      // Treating it as empty is how a backend hiccup rendered as "this folder
      // has nothing in it" — with `scannedAll: true` beside it, claiming the
      // traversal was complete.
      if (!listing || !listing.ok) {
        state.failedListings += 1;
        continue;
      }
      ingestListing(state, entry, listing.entries, next);
    }
    level = next;
  }

  return {
    items: selectItems(state.candidates, maxItems),
    totalAssets: state.totalAssets,
    scannedAll: !state.truncated && state.failedListings === 0,
    failedListings: state.failedListings,
  };
}

const CACHE_KEY_SEPARATOR = '\u0000';
const previewCache = new Map<string, Promise<FolderPreviewSummary>>();
const sharedScanLimiter = createLimiter(FOLDER_PREVIEW_SCAN_CONCURRENCY);

/**
 * Memoized `collectFolderPreview` per root+path. Concurrent calls for the same
 * folder share one in-flight scan, and scans across different folders are
 * bounded by a shared limiter so many visible tiles cannot stampede the
 * storage backend. A failed scan is evicted so the next call retries.
 */
export function getFolderPreview(
  root: string,
  folderPath: string,
  options?: FolderPreviewOptions,
): Promise<FolderPreviewSummary> {
  const key = `${root}${CACHE_KEY_SEPARATOR}${normalizeFolderPath(folderPath)}`;
  const cached = previewCache.get(key);
  if (cached) return cached;
  const promise = sharedScanLimiter(() => collectFolderPreview(root, folderPath, options));
  previewCache.set(key, promise);
  const evict = () => {
    if (previewCache.get(key) === promise) previewCache.delete(key);
  };
  promise.then((summary) => {
    // A scan whose listings FAILED is not a folder that is empty; serve what we
    // got, but never memoize it — the next call retries. (An empty summary is
    // evicted too: re-checking a genuinely empty folder is one cheap listing,
    // and it is cheaper than pinning a stale emptiness.)
    if (summary.failedListings > 0) evict();
    else if (summary.items.length === 0 && summary.totalAssets === 0) evict();
  }, evict);
  return promise;
}

/** True when one path is an ancestor of, equal to, or a descendant of the other. */
function pathsRelated(a: string, b: string): boolean {
  return a === b || a === '' || b === '' || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Drop cached previews. With no argument, clears everything. Given a changed
 * path, drops every cached entry that is an ancestor of, equal to, or a
 * descendant of that path — ancestors' composites may include the changed
 * subtree's contents, and descendants may themselves have changed.
 */
export function invalidateFolderPreviews(changedPath?: string): void {
  if (changedPath === undefined) {
    previewCache.clear();
    return;
  }
  const changed = normalizeFolderPath(changedPath);
  for (const key of [...previewCache.keys()]) {
    const cachedPath = key.slice(key.indexOf(CACHE_KEY_SEPARATOR) + 1);
    if (pathsRelated(cachedPath, changed)) previewCache.delete(key);
  }
}
