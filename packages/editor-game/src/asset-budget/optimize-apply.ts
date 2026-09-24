/**
 * Storage-side APPLY flow for Asset Budget optimizations (W4a M3).
 *
 * One place owns "optimized bytes land in the project": write through the
 * storage seam, stamp central provenance (`.vgai/provenance.json`, the SAME
 * document/idiom the generative-assets pipeline stamps and
 * `project-provenance.ts` projects — one operation with an `outputs` entry
 * carrying path/bytes/sha256), invalidate the engine's URL-keyed asset cache
 * for the rewritten file, and fire the editor's asset-mutation events so open
 * viewers re-read.
 *
 * Undo stance (decided per repo patterns): the editor undo stack is 50-deep
 * SCENE-DOCUMENT snapshots and never covers binary asset bytes, so binary
 * rewrites are CONFIRMED-DESTRUCTIVE — the UI shows the real before → after
 * size diff and only calls this after explicit confirmation. LOD generation
 * is additive (base geometry untouched; levels are new named siblings), and
 * its scene-side `mesh.lod` write goes through the store and IS undoable.
 *
 * A failed provenance stamp never silently vanishes: the write has already
 * happened, so the failure is returned for the UI to surface.
 */

import { sha256Hex } from '@volter/editor-sdk/kit/bytes-codec';
import { assertEditorServerAnswered } from '@volter/editor-sdk/kit/editor-server-response';
import { sourceMutationAttribution } from '@volter/editor-sdk/kit/editor-session-attribution';
import { handleProjectMutationFailure } from '@volter/editor-sdk/kit/source-conflict';
import type { StorageBackend } from '@volter/editor-sdk/kit/storage-types';
import { invalidateCachedAsset } from '@volter/threejs-runtime/asset-loaders';

const PROVENANCE_PATH = '.vgai/provenance.json';

/** Serving path (`/models/x.glb`) or bare path → storage path under public/. */
export function assetStoragePath(path: string): string {
  const clean = path.split(/[?#]/, 1)[0]!.replace(/^\/+/, '');
  return clean.startsWith('public/') ? clean : `public/${clean}`;
}

/** Storage path → runtime serving path (`public/models/x.glb` → `/models/x.glb`). */
export function assetServingPath(storagePath: string): string {
  return storagePath.startsWith('public/')
    ? `/${storagePath.slice('public/'.length)}`
    : `/${storagePath}`;
}

/**
 * Resolve a serving/scene `src` (or bare path) to the path THIS backend
 * actually stores it under, by probing both spellings: the live backend is
 * serving-rooted (`HttpStorage` is hard-rooted at `public/`), while a
 * project-rooted one (a `MemStorage` fixture) prefixes `public/`. Throws
 * naming both candidates when neither exists — never guesses.
 */
export async function resolveAssetStoragePath(
  backend: StorageBackend,
  path: string,
): Promise<string> {
  const bare = path.split(/[?#]/, 1)[0]!.replace(/^\.\//, '').replace(/^\/+/, '');
  const candidates = bare.startsWith('public/')
    ? [bare, bare.slice('public/'.length)]
    : [bare, `public/${bare}`];
  for (const candidate of candidates) {
    if (await backend.exists(candidate)) return candidate;
  }
  throw new Error(`Asset not found in project storage (tried: ${candidates.join(', ')})`);
}

/**
 * The central provenance ledger's project-rooted path spelling (the pipeline
 * idiom `project-provenance.ts` also forces): a serving-rooted storage path
 * (`models/x.glb`) is recorded as its on-disk `public/models/x.glb` truth.
 */
function ledgerAssetPath(storagePath: string): string {
  return storagePath.startsWith('public/') ? storagePath : `public/${storagePath}`;
}

/**
 * Ledger IO honoring the backend's reach: server-mode `HttpStorage` is
 * hard-rooted at `public/`, so writing `.vgai/provenance.json` through it
 * would land at `public/.vgai/provenance.json` — a divergent second ledger
 * (the exact T3.3 "two-`.vgai`-dirs" bug class). The dev server's
 * `.vgai/`-scoped `/__editor/vgai-file` GET/POST route pair is the recorded
 * fix for that class; every other
 * backend reaches the project root directly.
 */
async function readLedgerText(backend: StorageBackend): Promise<string | null> {
  if (backend.id === 'http') {
    // NOT read through `editor-server-response.ts`: the GET half of this route
    // answers `text/plain` (routes/project-source.ts) because it serves raw
    // file bytes, and that reader's whole rule is "the editor server answers
    // JSON" — it would reject this route's successes.
    const res = await fetch(
      `/__editor/vgai-file?${new URLSearchParams({ path: PROVENANCE_PATH })}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`read ${PROVENANCE_PATH}: HTTP ${res.status}`);
    return res.text();
  }
  if (!(await backend.exists(PROVENANCE_PATH))) return null;
  return backend.read(PROVENANCE_PATH);
}

async function writeLedgerText(backend: StorageBackend, content: string): Promise<void> {
  if (backend.id === 'http') {
    const write = async () => {
      const res = await fetch('/__editor/vgai-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: PROVENANCE_PATH, content, ...sourceMutationAttribution() }),
      });
      // The POST half DOES answer JSON, so this one is read: `res.ok` alone
      // accepted a page fallback and the provenance ledger write vanished.
      assertEditorServerAnswered(res, `Write ${PROVENANCE_PATH} failed`);
      if (!res.ok) {
        await handleProjectMutationFailure(res, {
          label: `Write ${PROVENANCE_PATH}`,
          attempted: { [PROVENANCE_PATH]: content },
          reapply: write,
        });
      }
    };
    await write();
    return;
  }
  await backend.write(PROVENANCE_PATH, content);
}

export interface OptimizeStampInput {
  /** Provenance operation name, e.g. `asset-budget.meshopt`. */
  readonly operationName: string;
  readonly storagePath: string;
  readonly beforeBytes: number;
  readonly beforeSha256: string;
  /** Operation parameters recorded as provenance `input` (with the source). */
  readonly params?: Record<string, unknown>;
}

/**
 * Append one operation to the central provenance document. Throws when the
 * existing document is unreadable (never clobber a ledger we cannot parse).
 */
export async function stampOptimizeProvenance(
  backend: StorageBackend,
  input: OptimizeStampInput,
  outputBytes: Uint8Array,
): Promise<void> {
  let document: { version: 1; operations: Record<string, unknown> } = {
    version: 1,
    operations: {},
  };
  const existing = await readLedgerText(backend);
  if (existing !== null) {
    const parsed: unknown = JSON.parse(existing);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { operations?: unknown }).operations !== 'object'
    ) {
      throw new Error(`${PROVENANCE_PATH} exists but is not a provenance document`);
    }
    document = parsed as typeof document;
  }
  const operationId = `asset-budget-${crypto.randomUUID()}`;
  document.operations[operationId] = {
    createdAt: new Date().toISOString(),
    operation: { name: input.operationName, source: 'editor:asset-budget' },
    input: {
      path: ledgerAssetPath(input.storagePath),
      bytes: input.beforeBytes,
      sha256: input.beforeSha256,
      ...(input.params ? { params: input.params } : {}),
    },
    outputs: [
      {
        path: ledgerAssetPath(input.storagePath),
        bytes: outputBytes.byteLength,
        sha256: await sha256Hex(outputBytes),
        mediaType: 'model/gltf-binary',
        role: 'asset',
      },
    ],
  };
  await writeLedgerText(backend, `${JSON.stringify(document, null, 2)}\n`);
}

export interface ApplyOptimizedResult {
  /** Set when the FILE write succeeded but the provenance stamp failed. */
  readonly stampError?: string;
}

/**
 * Land optimized bytes: write → stamp → cache-invalidate → notify. Callers
 * confirmed the diff already (module header). Returns any stamp failure for
 * the UI to surface honestly.
 */
export async function applyOptimizedBytes(
  backend: StorageBackend,
  stamp: OptimizeStampInput,
  outputBytes: Uint8Array,
): Promise<ApplyOptimizedResult> {
  await backend.write(stamp.storagePath, outputBytes);
  let stampError: string | undefined;
  try {
    await stampOptimizeProvenance(backend, stamp, outputBytes);
  } catch (error) {
    stampError = error instanceof Error ? error.message : String(error);
  }
  // The engine gltf cache is keyed by the URL the scene used — both the
  // serving spelling and any bare spelling must drop.
  const serving = assetServingPath(stamp.storagePath);
  invalidateCachedAsset(serving);
  invalidateCachedAsset(serving.replace(/^\/+/, ''));
  invalidateCachedAsset(stamp.storagePath);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('editor:asset-mutation', {
        detail: { type: 'change', paths: [stamp.storagePath, serving] },
      }),
    );
    window.dispatchEvent(new CustomEvent('editor:assets-changed'));
  }
  return stampError ? { stampError } : {};
}
