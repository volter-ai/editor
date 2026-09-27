/**
 * Asset Budget analysis core (W4a M1, roadmap F10 / eco B1 / critique P5).
 *
 * Headless, pure-input model: given a project file snapshot (paths + sizes +
 * byte/text readers — the storage seam's vocabulary, mirroring
 * `asset-workflow/project-asset-health.ts`), produce the per-asset budget:
 *
 *   - size + content hash for every asset row (duplicate detection)
 *   - gltf-transform `inspect()` stats for GLB/GLTF models — triangle/vertex
 *     counts, texture dims/formats, geometry + texture VRAM estimates
 *   - header-parsed dimensions + VRAM estimate for standalone images
 *   - the project REFERENCE GRAPH: which manifest entries, code files, or
 *     sibling assets mention each asset ("what uses this", critique P5),
 *     the unused list derived from it, and duplicate groups by sha256
 *   - provenance stamps projected from `.vgai/provenance.json`
 *
 * Anti-shim: anything unmeasurable is reported as absent/unknown with a
 * reason (`inspectError`, `gpuBytes: null`, `unknownTextureCount`) — never a
 * fabricated number. VRAM figures are labeled estimates: uncompressed RGBA
 * upload with a full mip chain for textures (inspect()'s own convention) plus
 * raw attribute/index bytes for geometry.
 */

import { sha256Hex } from '@volter/editor-sdk/kit/bytes-codec';
import { isPublicRootedBackend, type StorageBackend } from '@volter/editor-sdk/kit/storage-types';
import type { Document } from '@gltf-transform/core';
import { inspect } from '@gltf-transform/functions';
import { getGltfIO } from './gltf-io';
import { estimateImageGpuBytes, parseImageDims } from './image-dims';

// --- Categories -------------------------------------------------------------

/**
 * What a budget row IS. `classifyAssetCategory` below is the only producer, so
 * every member here is a branch of it — a category it cannot return is a
 * column header, a rollup row and a per-entry label nobody can ever see.
 */
export type AssetBudgetCategory = 'model' | 'image' | 'audio' | 'data' | 'other';

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|svg|ktx2|basis|bmp|avif)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i;
const MODEL_EXTENSIONS = /\.(glb|gltf)$/i;

export function classifyAssetCategory(path: string): AssetBudgetCategory {
  const clean = path.toLowerCase();
  if (MODEL_EXTENSIONS.test(clean)) return 'model';
  if (IMAGE_EXTENSIONS.test(clean)) return 'image';
  if (AUDIO_EXTENSIONS.test(clean)) return 'audio';
  if (clean.endsWith('.json') || clean.endsWith('.bin')) return 'data';
  return 'other';
}

// --- Report types -----------------------------------------------------------

/**
 * Who holds a reference to an asset. One member per REAL producer below:
 * `manifest` (`scanJsonOwnerReferences`), `code` (`scanCodeOwnerReferences`),
 * `asset` (`scanGltfDependencyReferences`). Nothing else in a project owns an
 * asset reference today — do not add a member ahead of the scan that emits it,
 * because the detail pane prints this string verbatim and an unreachable
 * member is a label nobody can ever see.
 */
export type AssetReferenceKind = 'manifest' | 'code' | 'asset';

export interface AssetReference {
  /** Project-relative path of the document/file holding the reference. */
  readonly ownerPath: string;
  readonly kind: AssetReferenceKind;
  /** JSON path inside the owner document (JSON owners only). */
  readonly jsonPath?: string;
}

export interface AssetTextureStat {
  readonly name: string;
  readonly mimeType: string;
  readonly resolution: string;
  readonly slots: readonly string[];
  readonly bytes: number;
  /** `null` when inspect() cannot estimate (e.g. KTX2 without transcoding). */
  readonly gpuBytes: number | null;
}

export interface AssetModelStats {
  readonly meshCount: number;
  readonly materialCount: number;
  readonly textureCount: number;
  readonly animationCount: number;
  /** Total GL primitives (triangles for triangle meshes). */
  readonly glPrimitives: number;
  readonly vertices: number;
  /** Raw attribute+index bytes (upload estimate for geometry). */
  readonly geometryBytes: number;
  /** Sum of known texture gpuSize estimates. */
  readonly textureGpuBytes: number;
  /** Textures whose GPU size could not be estimated (lower-bound marker). */
  readonly unknownTextureCount: number;
  /** geometryBytes + textureGpuBytes — a LOWER BOUND when
   *  unknownTextureCount > 0. */
  readonly vramBytes: number;
  readonly textures: readonly AssetTextureStat[];
  /** Named mesh-bearing node names (LOD-generation candidates). */
  readonly meshNames: readonly string[];
}

export interface AssetImageStats {
  readonly width: number;
  readonly height: number;
  /** Uncompressed RGBA + mips upload estimate. */
  readonly gpuBytes: number;
}

export interface AssetProvenanceStamp {
  readonly operationId: string;
  readonly operationName: string;
  readonly createdAt: string;
}

export interface AssetBudgetEntry {
  /** Storage path (project-root-relative, e.g. `public/models/crate.glb`). */
  readonly path: string;
  /** Runtime serving path for `public/` assets (`/models/crate.glb`), else null. */
  readonly servingPath: string | null;
  readonly category: AssetBudgetCategory;
  readonly bytes: number;
  readonly sha256: string;
  readonly model?: AssetModelStats;
  readonly image?: AssetImageStats;
  /** Honest inspection failure (unreadable/undecodable model) — never hidden. */
  readonly inspectError?: string;
  readonly references: readonly AssetReference[];
  readonly provenance?: AssetProvenanceStamp;
  /**
   * Engine-vendored runtime infrastructure (Three.js `examples/jsm` served at
   * `/jsm/…` — the DRACO decoder wasm/js, loaders/decoders). Loaded by the
   * ENGINE at runtime (`loader.ts` wires `dracoLoader.setDecoderPath(
   * '/jsm/libs/draco/gltf/')`), never referenced by project content, so the
   * reference scan legitimately finds nothing for it in EVERY mode. Marked so
   * it is kept out of the "unused"/deletable set and labeled in the detail
   * pane — it is required infrastructure, not a project asset.
   */
  readonly engineVendored?: boolean;
}

export interface AssetBudgetDuplicateGroup {
  readonly sha256: string;
  readonly bytes: number;
  readonly paths: readonly string[];
  /** bytes × (copies − 1). */
  readonly wastedBytes: number;
}

export interface AssetBudgetCategoryTotal {
  readonly category: AssetBudgetCategory;
  readonly count: number;
  readonly bytes: number;
  readonly vramBytes: number;
}

export interface AssetBudgetReport {
  readonly entries: readonly AssetBudgetEntry[];
  readonly totalBytes: number;
  readonly totalVramBytes: number;
  readonly categories: readonly AssetBudgetCategoryTotal[];
  /** Paths of `public/` assets nothing references. */
  readonly unused: readonly string[];
  readonly duplicates: readonly AssetBudgetDuplicateGroup[];
  /**
   * Whether project SOURCE CODE (`src/**`) was reachable through the snapshot
   * and therefore scanned for asset references. FALSE in server mode: the live
   * `HttpStorage` seam is hard-rooted at `public/`, so `src/**` is unreachable
   * and a code-only-referenced asset (input maps, code-loaded models) has NO
   * discoverable reference — it surfaces as "unused" even though it is used.
   * The UI must caveat the Unused/zero-reference surfaces accordingly: with
   * this false, "unused" means "unreferenced by authored content", not "safe to
   * delete". A REAL structural signal (the seam knows its root), never a guess.
   */
  readonly codeReferencesScanned: boolean;
}

// --- Source (the storage seam's vocabulary, injectable for tests) -----------

export interface AssetBudgetFile {
  readonly path: string;
  readonly size: number;
}

export interface AssetBudgetSource {
  readonly files: readonly AssetBudgetFile[];
  /**
   * Reference-owner documents living OUTSIDE the walked snapshot, scanned for
   * references but never budget rows. Server mode uses this for the project
   * manifest: `HttpStorage` is hard-rooted at `public/` (its own doc comment;
   * the T3.3 "two-`.vgai`-dirs" finding), so `vgai.project.json` is unreachable
   * through the seam and is fetched over the dev server instead — without it,
   * every manifest-referenced asset (input maps, scenes) would be reported
   * unused, a fabricated finding.
   */
  readonly ownerFiles?: readonly AssetBudgetFile[];
  /**
   * True when the snapshot root IS the served assets root (server-mode
   * `HttpStorage`): paths carry no `public/` prefix and every walked file is
   * a served asset — so every file is a budget row and `/`-prefixed serving
   * paths derive directly from entry paths.
   */
  readonly servingRooted?: boolean;
  /**
   * Whether project source code (`src/**`) is reachable through this snapshot.
   * FALSE for the server-mode `HttpStorage` seam (hard-rooted at `public/`, so
   * `src/**` cannot be walked); TRUE for project-rooted snapshots whose walk
   * includes `src/`. Absent is treated as reachable. Projected onto the report
   * as `codeReferencesScanned` so the UI can caveat "unused" honestly.
   */
  readonly codeReferencesScannable?: boolean;
  readBytes(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  /** Parsed `.vgai/provenance.json` (or null/undefined when absent). */
  readonly provenance?: unknown;
}

// --- Provenance projection (same structural read as project-provenance.ts) --

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function operationOutputPaths(rawOperation: unknown): {
  stamp: Omit<AssetProvenanceStamp, 'operationId'>;
  paths: string[];
} | null {
  const operation = asRecord(rawOperation);
  const identity = asRecord(operation?.['operation']);
  const createdAt = operation?.['createdAt'];
  const operationName = identity?.['name'];
  const outputs = operation?.['outputs'];
  if (typeof createdAt !== 'string' || typeof operationName !== 'string') return null;
  if (!Array.isArray(outputs)) return null;
  const paths = outputs.flatMap((rawOutput) => {
    const path = asRecord(rawOutput)?.['path'];
    return typeof path === 'string' ? [normalizeRefValue(path)] : [];
  });
  return { stamp: { operationName, createdAt }, paths };
}

/** Index newest provenance operation per output path (storage path). */
export function indexProvenanceOutputs(provenance: unknown): Map<string, AssetProvenanceStamp> {
  const byPath = new Map<string, AssetProvenanceStamp>();
  const operations = asRecord(asRecord(provenance)?.['operations']);
  if (!operations) return byPath;
  for (const [operationId, rawOperation] of Object.entries(operations)) {
    const parsed = operationOutputPaths(rawOperation);
    if (!parsed) continue;
    for (const path of parsed.paths) {
      const prior = byPath.get(path);
      if (!prior || parsed.stamp.createdAt.localeCompare(prior.createdAt) > 0) {
        byPath.set(path, { operationId, ...parsed.stamp });
      }
    }
  }
  return byPath;
}

// --- Engine-vendored runtime infrastructure ---------------------------------

/**
 * Three.js `examples/jsm` runtime infrastructure vendored into every project's
 * `public/jsm/` and served at `/jsm/…` — the DRACO decoder (`draco_decoder.wasm`
 * / `.js` / `draco_wasm_wrapper.js`), loaders, decoders. It is loaded by the
 * ENGINE at runtime (`loader.ts`: `dracoLoader.setDecoderPath('/jsm/libs/draco/
 * gltf/')`), never referenced by project code or the manifest — so
 * the reference scan finds nothing for it in EVERY storage mode, not just the
 * server-mode code blind spot. Marked (never dropped from the report) so its
 * real footprint stays visible, and kept out of the deletable "unused" set.
 * Matches both the serving-rooted (`jsm/…`) and project-rooted (`public/jsm/…`)
 * spellings.
 */
export function isEngineVendoredRuntimePath(path: string): boolean {
  return /(?:^|\/)jsm\//i.test(path);
}

// --- Reference scanning ------------------------------------------------------

const CODE_OWNER_PATTERN = /\.(?:tsx?|jsx?|mjs|cjs)$/i;
const MANIFEST_NAME = 'vgai.project.json';

/**
 * The manifest is the ONLY JSON document that owns asset references. An
 * `.inputmap.json` was scanned as one too, and could not be. `collectStringPaths`
 * below yields string VALUES only (action names are record KEYS — never
 * candidates), and every string value an input map carries is a binding
 * `type` literal, a `KeyboardEvent.code`, a `direction`/`valueType` enum, or an
 * injected/touch `sourceId`; button/axis indexes are numbers. None of them is a
 * path, so the only value that could ever have resolved to an asset was a
 * path-SHAPED `sourceId` — a fabricated reference, which is exactly what hides a
 * genuinely unused asset from the Unused list. Do not re-add a document to this
 * scan without a field that actually holds an asset path.
 */
function isJsonReferenceOwner(path: string): boolean {
  return (path.split('/').pop() ?? path) === MANIFEST_NAME;
}

function collectStringPaths(value: unknown, path = '$'): { path: string; value: string }[] {
  if (typeof value === 'string') return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStringPaths(entry, `${path}[${index}]`));
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([key, entry]) =>
    collectStringPaths(entry, `${path}.${key}`),
  );
}

/** Strip query/hash and leading `/` / `./` — the serving-vs-storage seam. */
function normalizeRefValue(value: string): string {
  return value.split(/[?#]/, 1)[0]!.replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Reference key (storage OR serving spelling) → entry path, + accumulator. */
class ReferenceIndex {
  readonly keyToPath = new Map<string, string>();
  private readonly referencesByPath = new Map<string, AssetReference[]>();

  constructor(entryFiles: readonly AssetBudgetFile[]) {
    for (const file of entryFiles) {
      this.keyToPath.set(file.path, file.path);
      if (file.path.startsWith('public/')) {
        this.keyToPath.set(file.path.slice('public/'.length), file.path);
      }
    }
  }

  resolve(rawValue: string): string | undefined {
    return this.keyToPath.get(normalizeRefValue(rawValue));
  }

  add(entryPath: string, reference: AssetReference): void {
    const list = this.referencesByPath.get(entryPath) ?? [];
    // Dedupe identical owner/jsonPath pairs (a scene often repeats a src).
    if (
      !list.some(
        (existing) =>
          existing.ownerPath === reference.ownerPath && existing.jsonPath === reference.jsonPath,
      )
    ) {
      list.push(reference);
      this.referencesByPath.set(entryPath, list);
    }
  }

  referencesOf(entryPath: string): AssetReference[] {
    return this.referencesByPath.get(entryPath) ?? [];
  }
}

async function scanOneJsonOwner(
  source: AssetBudgetSource,
  owner: AssetBudgetFile,
  index: ReferenceIndex,
): Promise<void> {
  if (!isJsonReferenceOwner(owner.path)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await source.readText(owner.path));
  } catch {
    return; // invalid JSON is asset-health's finding, not the budget's
  }
  for (const candidate of collectStringPaths(parsed)) {
    const target = index.resolve(candidate.value);
    if (target && target !== owner.path) {
      index.add(target, { ownerPath: owner.path, kind: 'manifest', jsonPath: candidate.path });
    }
  }
}

/** The manifest: JSON string values resolving to a known asset path are
 *  references. Owners span the walked snapshot AND any out-of-snapshot owner
 *  documents (server-mode manifest). */
async function scanJsonOwnerReferences(
  source: AssetBudgetSource,
  index: ReferenceIndex,
): Promise<void> {
  for (const owner of [...source.files, ...(source.ownerFiles ?? [])]) {
    await scanOneJsonOwner(source, owner, index);
  }
}

/** Any script outside public/ mentioning an asset path references it. */
async function scanCodeOwnerReferences(
  source: AssetBudgetSource,
  index: ReferenceIndex,
): Promise<void> {
  const owners = source.files.filter(
    (file) => !file.path.startsWith('public/') && CODE_OWNER_PATTERN.test(file.path),
  );
  for (const owner of owners) {
    let text: string;
    try {
      text = await source.readText(owner.path);
    } catch {
      continue;
    }
    for (const [key, entryPath] of index.keyToPath) {
      // Length guard avoids substring noise; asset keys always carry a
      // directory or extension, so >4 chars is safe in practice.
      if (key.length > 4 && text.includes(key)) {
        index.add(entryPath, { ownerPath: owner.path, kind: 'code' });
      }
    }
  }
}

interface GltfExternalRefs {
  buffers?: { uri?: string }[];
  images?: { uri?: string }[];
}

function gltfExternalUris(json: GltfExternalRefs, gltfPath: string): string[] {
  const base = gltfPath.includes('/') ? gltfPath.slice(0, gltfPath.lastIndexOf('/') + 1) : '';
  return [...(json.buffers ?? []), ...(json.images ?? [])].flatMap(({ uri }) =>
    uri && !uri.startsWith('data:') ? [`${base}${decodeURIComponent(uri)}`] : [],
  );
}

/** A .gltf's external buffers/images are referenced BY that .gltf. */
async function scanGltfDependencyReferences(
  source: AssetBudgetSource,
  entryFiles: readonly AssetBudgetFile[],
  index: ReferenceIndex,
): Promise<void> {
  for (const file of entryFiles) {
    if (!/\.gltf$/i.test(file.path)) continue;
    try {
      const json = JSON.parse(await source.readText(file.path)) as GltfExternalRefs;
      for (const uri of gltfExternalUris(json, file.path)) {
        const target = index.resolve(uri);
        if (target) index.add(target, { ownerPath: file.path, kind: 'asset' });
      }
    } catch {
      /* undecodable .gltf JSON surfaces as inspectError on its own row */
    }
  }
}

// --- Project walk over the storage seam --------------------------------------

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.vgai',
  '.ci-scaffold',
  'coverage',
  'test-results',
  'playwright-report',
]);

/** Snapshot the project through the storage seam (recursive list). */
export async function collectProjectBudgetSource(
  backend: StorageBackend,
): Promise<AssetBudgetSource> {
  const files: AssetBudgetFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await backend.list(dir);
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.type === 'dir') {
        if (!IGNORED_DIRS.has(entry.name)) await walk(path);
      } else {
        files.push({ path, size: entry.size ?? 0 });
      }
    }
  };
  await walk('');

  // Server mode: `HttpStorage` is hard-rooted at the project's `public/`
  // folder (its doc comment; the T3.3 "two-`.vgai`-dirs" finding), so BOTH
  // project-root documents the budget needs live outside the seam. Use the
  // dev server's own idioms for each: the raw manifest served at
  // `/vgai.project.json` (`manifest-project.ts`) and the `.vgai/`-scoped
  // `/__editor/vgai-file` route (`project-provenance.ts`). Anything
  // unavailable stays honestly absent — no fabricated owners or stamps.
  if (isPublicRootedBackend(backend)) {
    const ownerFiles: AssetBudgetFile[] = [];
    const virtualTexts = new Map<string, string>();
    try {
      const manifestRes = await fetch('/vgai.project.json');
      if (manifestRes.ok) {
        const text = await manifestRes.text();
        virtualTexts.set('vgai.project.json', text);
        ownerFiles.push({ path: 'vgai.project.json', size: text.length });
      }
    } catch {
      // No reachable manifest → no manifest-owned references.
    }
    let provenance: unknown = null;
    try {
      // NOT read through `editor-server-response.ts`: this route's GET half
      // answers `text/plain` raw file bytes, which that JSON-only reader would
      // reject as a non-answer. See `optimize-apply.ts`'s `readLedgerText`.
      const provenanceRes = await fetch(
        `/__editor/vgai-file?${new URLSearchParams({ path: '.vgai/provenance.json' })}`,
      );
      if (provenanceRes.ok) provenance = JSON.parse(await provenanceRes.text());
    } catch {
      provenance = null; // unreadable provenance = no stamps, never a crash
    }
    return {
      files,
      ownerFiles,
      servingRooted: true,
      // HttpStorage is rooted at `public/`; the project's `src/**` is outside
      // the seam and cannot be walked, so code references are NOT scanned here.
      codeReferencesScannable: false,
      provenance,
      readBytes: (path) => backend.readBytes(path),
      readText: (path) => {
        const virtual = virtualTexts.get(normalizeRefValue(path));
        return virtual !== undefined ? Promise.resolve(virtual) : backend.read(path);
      },
    };
  }

  let provenance: unknown = null;
  try {
    if (await backend.exists('.vgai/provenance.json')) {
      provenance = JSON.parse(await backend.read('.vgai/provenance.json'));
    }
  } catch {
    provenance = null; // unreadable provenance = no stamps, never a crash
  }
  return {
    files,
    // Project-rooted walk: `src/**` is in the snapshot, so code references are
    // scanned (see `scanCodeOwnerReferences`).
    codeReferencesScannable: true,
    provenance,
    readBytes: (path) => backend.readBytes(path),
    readText: (path) => backend.read(path),
  };
}

// --- glTF inspection ---------------------------------------------------------

async function readModelDocument(
  path: string,
  bytes: Uint8Array,
  source: AssetBudgetSource,
): Promise<Document> {
  const { io } = await getGltfIO();
  if (/\.glb$/i.test(path)) return io.readBinary(new Uint8Array(bytes));
  // .gltf: resolve external buffers/images through the same snapshot. Copies
  // are fresh ArrayBuffer-backed views (gltf-transform 4.x's resource type).
  const json = JSON.parse(new TextDecoder().decode(bytes)) as GltfExternalRefs;
  const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
  const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  for (const { uri } of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (uri && !uri.startsWith('data:')) {
      resources[uri] = new Uint8Array(await source.readBytes(`${base}${decodeURIComponent(uri)}`));
    }
  }
  return io.readJSON({ json: json as never, resources });
}

async function inspectModel(
  path: string,
  bytes: Uint8Array,
  source: AssetBudgetSource,
): Promise<{ model?: AssetModelStats; inspectError?: string }> {
  try {
    const document = await readModelDocument(path, bytes, source);
    const report = inspect(document);
    const meshes = report.meshes.properties;
    const textures = report.textures.properties;
    const geometryBytes = meshes.reduce((sum, mesh) => sum + mesh.size, 0);
    const textureGpuBytes = textures.reduce((sum, texture) => sum + (texture.gpuSize ?? 0), 0);
    const meshNames = new Set<string>();
    for (const node of document.getRoot().listNodes()) {
      if (node.getName() && node.getMesh() && !node.getSkin()) meshNames.add(node.getName());
    }
    return {
      model: {
        meshCount: meshes.length,
        materialCount: report.materials.properties.length,
        textureCount: textures.length,
        animationCount: report.animations.properties.length,
        glPrimitives: meshes.reduce((sum, mesh) => sum + mesh.glPrimitives, 0),
        vertices: meshes.reduce((sum, mesh) => sum + mesh.vertices, 0),
        geometryBytes,
        textureGpuBytes,
        unknownTextureCount: textures.filter((texture) => texture.gpuSize === null).length,
        vramBytes: geometryBytes + textureGpuBytes,
        textures: textures.map((texture) => ({
          name: texture.name || texture.uri,
          mimeType: texture.mimeType,
          resolution: texture.resolution,
          slots: texture.slots,
          bytes: texture.size,
          gpuBytes: texture.gpuSize,
        })),
        meshNames: [...meshNames],
      },
    };
  } catch (error) {
    return { inspectError: error instanceof Error ? error.message : String(error) };
  }
}

// --- The analysis ------------------------------------------------------------

/**
 * Is this file a budget ROW (vs merely a reference owner)?
 *
 * Path spellings differ per backend root: a project-rooted snapshot prefixes
 * assets with `public/`, while the live backend serves assets at its root
 * (`HttpStorage` is public/-rooted). A serving-rooted snapshot makes every walked
 * file a row; elsewhere accept the `public/` spelling, authored document
 * formats anywhere, and the unambiguous binary asset categories at bare
 * serving-style paths — never project code/config.
 */
function isBudgetEntry(path: string, servingRooted: boolean): boolean {
  if (servingRooted) return true;
  if (path.startsWith('public/')) return true;
  if (/\.inputmap\.json$/i.test(path)) return true;
  if (path.startsWith('src/') || path.startsWith('server/') || !path.includes('/')) return false;
  const category = classifyAssetCategory(path);
  return category === 'model' || category === 'image' || category === 'audio';
}

const UNUSED_ELIGIBLE = new Set<AssetBudgetCategory>(['model', 'image', 'audio', 'data', 'other']);

/** Categories that are unambiguously assets at BARE (un-prefixed) paths. */
const BARE_ASSET_CATEGORIES = new Set<AssetBudgetCategory>(['model', 'image', 'audio']);

function servingPathOf(path: string, servingRooted: boolean): string | null {
  if (servingRooted) return `/${path}`;
  return path.startsWith('public/') ? `/${path.slice('public/'.length)}` : null;
}

/**
 * Provenance stamp for an entry, tolerant of the ledger's project-rooted
 * spelling (`public/models/x.glb` — the pipeline idiom `project-provenance.ts`
 * also forces) against a serving-rooted entry path (`models/x.glb`), and the
 * inverse.
 */
function provenanceForEntry(
  provenanceByPath: Map<string, AssetProvenanceStamp>,
  path: string,
): AssetProvenanceStamp | undefined {
  const normalized = normalizeRefValue(path);
  const alternate = normalized.startsWith('public/')
    ? normalized.slice('public/'.length)
    : `public/${normalized}`;
  return provenanceByPath.get(normalized) ?? provenanceByPath.get(alternate);
}

async function buildEntry(
  file: AssetBudgetFile,
  source: AssetBudgetSource,
  index: ReferenceIndex,
  provenanceByPath: Map<string, AssetProvenanceStamp>,
): Promise<AssetBudgetEntry> {
  const category = classifyAssetCategory(file.path);
  const servingRooted = source.servingRooted === true;
  const engineVendored = isEngineVendoredRuntimePath(file.path);
  let bytes: Uint8Array;
  try {
    bytes = await source.readBytes(file.path);
  } catch (error) {
    return {
      path: file.path,
      servingPath: servingPathOf(file.path, servingRooted),
      category,
      bytes: file.size,
      sha256: '',
      inspectError: `unreadable: ${error instanceof Error ? error.message : String(error)}`,
      references: index.referencesOf(file.path),
      ...(engineVendored ? { engineVendored } : {}),
    };
  }
  let model: AssetModelStats | undefined;
  let image: AssetImageStats | undefined;
  let inspectError: string | undefined;
  if (category === 'model') {
    ({ model, inspectError } = await inspectModel(file.path, bytes, source));
  } else if (category === 'image') {
    const dims = parseImageDims(bytes);
    if (dims) image = { ...dims, gpuBytes: estimateImageGpuBytes(dims) };
  }
  const provenance = provenanceForEntry(provenanceByPath, file.path);
  return {
    path: file.path,
    servingPath: servingPathOf(file.path, servingRooted),
    category,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    ...(model ? { model } : {}),
    ...(image ? { image } : {}),
    ...(inspectError ? { inspectError } : {}),
    references: index.referencesOf(file.path),
    ...(provenance ? { provenance } : {}),
    ...(engineVendored ? { engineVendored } : {}),
  };
}

function entryVramBytes(entry: AssetBudgetEntry): number {
  return entry.model?.vramBytes ?? entry.image?.gpuBytes ?? 0;
}

function rollupCategories(entries: readonly AssetBudgetEntry[]): AssetBudgetCategoryTotal[] {
  const totals = new Map<AssetBudgetCategory, { count: number; bytes: number; vram: number }>();
  for (const entry of entries) {
    const total = totals.get(entry.category) ?? { count: 0, bytes: 0, vram: 0 };
    total.count += 1;
    total.bytes += entry.bytes;
    total.vram += entryVramBytes(entry);
    totals.set(entry.category, total);
  }
  return [...totals.entries()]
    .map(([category, total]) => ({
      category,
      count: total.count,
      bytes: total.bytes,
      vramBytes: total.vram,
    }))
    .sort((left, right) => right.bytes - left.bytes);
}

function collectDuplicates(entries: readonly AssetBudgetEntry[]): AssetBudgetDuplicateGroup[] {
  const byHash = new Map<string, AssetBudgetEntry[]>();
  for (const entry of entries) {
    if (!entry.sha256) continue;
    const group = byHash.get(entry.sha256) ?? [];
    group.push(entry);
    byHash.set(entry.sha256, group);
  }
  return [...byHash.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      sha256: group[0]!.sha256,
      bytes: group[0]!.bytes,
      paths: group.map((entry) => entry.path).sort(),
      wastedBytes: group[0]!.bytes * (group.length - 1),
    }))
    .sort((left, right) => right.wastedBytes - left.wastedBytes);
}

export async function analyzeAssetBudget(source: AssetBudgetSource): Promise<AssetBudgetReport> {
  const servingRooted = source.servingRooted === true;
  const entryFiles = source.files.filter((file) => isBudgetEntry(file.path, servingRooted));
  const provenanceByPath = indexProvenanceOutputs(source.provenance);

  // Reference passes run BEFORE entry construction so every row sees the
  // complete graph regardless of file order.
  const index = new ReferenceIndex(entryFiles);
  await scanJsonOwnerReferences(source, index);
  // Code references are only discoverable when `src/**` is in the snapshot
  // (project-rooted). In server mode the seam is `public/`-rooted, so the scan
  // is skipped and the report says so (`codeReferencesScanned`).
  const codeReferencesScanned = source.codeReferencesScannable !== false;
  if (codeReferencesScanned) await scanCodeOwnerReferences(source, index);
  await scanGltfDependencyReferences(source, entryFiles, index);

  const entries: AssetBudgetEntry[] = [];
  for (const file of entryFiles) {
    entries.push(await buildEntry(file, source, index, provenanceByPath));
  }
  entries.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));

  // Unused: unreferenced eligible entries. At bare (serving-style) paths in a
  // NON-serving-rooted snapshot, only unambiguous asset categories qualify —
  // a data/other file there may be project config, and claiming it unused
  // would be a fabricated finding.
  const unused = entries
    .filter(
      (entry) =>
        // Engine-vendored runtime infra (`/jsm/…`) is loaded by engine code, not
        // project content; it is never a deletable "unused" asset.
        !entry.engineVendored &&
        UNUSED_ELIGIBLE.has(entry.category) &&
        entry.references.length === 0 &&
        (servingRooted ||
          entry.path.startsWith('public/') ||
          BARE_ASSET_CATEGORIES.has(entry.category)),
    )
    .map((entry) => entry.path);

  return {
    entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    totalVramBytes: entries.reduce((sum, entry) => sum + entryVramBytes(entry), 0),
    categories: rollupCategories(entries),
    unused,
    duplicates: collectDuplicates(entries),
    codeReferencesScanned,
  };
}
