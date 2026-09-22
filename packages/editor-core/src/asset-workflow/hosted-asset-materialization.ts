/**
 * Materialize a project's DECLARED asset packs (`asset-manifest.json`, D-AP1)
 * from the `cloud-asset-library` Worker into a `StorageBackend`, recording
 * the same provenance ledger (`.vgai/assets.json`, D-AP3) every other
 * materialization site writes.
 *
 * This is the D-AP4 mechanism: a project's DECLARED packs are materialized
 * from the `cloud-asset-library` worker (existing manifest + object routes),
 * writing the same ledger.
 *
 * Exported for the open path to CALL rather than
 * wired into `seedIfEmpty` here, so any declared pack (in the template or an
 * example) reuses it without change. The template's `asset-manifest.json` is
 * `{"packs": {}}` today, so calling this against the shipped template is a
 * documented, harmless no-op: `declared` reports 0 and nothing is fetched.
 *
 * FAIL CLOSED AND LOUD, never fabricate (the anti-shim rule): a network
 * failure, a 404, or a sha256 mismatch aborts THAT entry only — nothing is
 * written for it — and is reported in the returned result; it never blocks
 * the other declared entries and never substitutes placeholder bytes.
 *
 * ## The expected digest comes from the DECLARATION, never from the response
 *
 * Every entry pins `sha256` in `asset-manifest.json` (see
 * `asset-pack-manifest.ts`), and that pin is the only authority here. Reading
 * the expected digest out of the worker's own `/v1/assets/<id>` record instead
 * would authenticate nothing on the FIRST fetch — a moved or tampered library
 * answers self-consistently (its record and its bytes agree), the bytes get
 * written, and its digest becomes the project's permanent `sourceHash` in the
 * ledger. So: the record's digest must MATCH the pin (a disagreement is a
 * refusal naming the asset), the fetched bytes are verified against the pin,
 * and the pin is what the ledger records.
 *
 * ## "Already materialized" means the FILE is there, not just the record
 *
 * Idempotent and retry-safe: an entry is skipped only when the ledger has it
 * AND its destination exists. Skipping on the ledger record alone made the
 * broken case unrepairable — a project whose bytes were deleted, or whose
 * ledger outlived a failed write, reported success forever, and the reopen
 * retry (`project-manager.ts`) plus the Retry banner both skipped exactly the
 * entry they existed to refetch.
 */

import { sha256Hex } from '../bytes-codec';
import type { StorageBackend } from '../storage/types';
import { normalizeLedgerPath } from './asset-ledger';
import {
  readAssetLedgerFromBackend,
  recordAssetMaterializationInBackend,
} from './asset-ledger-backend';
/** Project-relative path of the pack declaration (D-AP1) — sibling of
 *  `vgai.project.json` in the template/every example, and (per D-AP4) one of
 *  the plain-text files the browser build's seed writes alongside the rest
 *  of the template source. */
import {
  ASSET_MANIFEST_PATH,
  type FlattenedPackEntry,
  flattenAssetPacks,
  parseAssetPackManifest,
} from './asset-pack-manifest';
import {
  cloudAssetObjectUrl,
  DEFAULT_CLOUD_ASSET_BASE_URL,
  fetchCloudAssetRecord,
} from './cloud-asset-client';

export { ASSET_MANIFEST_PATH };

export interface AssetPackMaterializationFailure {
  readonly entry: FlattenedPackEntry;
  readonly reason: string;
}

export interface AssetPackMaterializationResult {
  /** Total entries declared across every pack. */
  readonly declared: number;
  readonly materialized: FlattenedPackEntry[];
  /** Recorded in the ledger AND present on disk — nothing to do, not a failure. */
  readonly alreadyPresent: FlattenedPackEntry[];
  readonly failed: AssetPackMaterializationFailure[];
}

export interface MaterializeAssetPacksOptions {
  /** Test-only override of the deployed worker's base URL. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  /** Called once per entry, after it is attempted. */
  readonly onProgress?: (
    entry: FlattenedPackEntry,
    outcome: 'materialized' | 'already-present' | 'failed',
  ) => void;
}

/**
 * Materialize every pack entry `backend` declares in its own
 * `asset-manifest.json` that is not already in the ledger.
 *
 * Reads the manifest from `backend` itself (not the repo), whichever backend
 * the caller is already using.
 */
export async function materializeDeclaredAssetPacks(
  backend: StorageBackend,
  options: MaterializeAssetPacksOptions = {},
): Promise<AssetPackMaterializationResult> {
  const entries = await declaredPackEntries(backend);
  const result: AssetPackMaterializationResult = {
    declared: entries.length,
    materialized: [],
    alreadyPresent: [],
    failed: [],
  };
  if (entries.length === 0) return result;

  const ledger = await readAssetLedgerFromBackend(backend);
  for (const entry of entries) {
    if (options.signal?.aborted) break;
    // A ledger record is a record, not the bytes — see the module header.
    if (ledger[normalizeLedgerPath(entry.dest)] && (await backend.exists(entry.dest))) {
      result.alreadyPresent.push(entry);
      options.onProgress?.(entry, 'already-present');
      continue;
    }
    try {
      await materializeOne(backend, entry, options);
      result.materialized.push(entry);
      options.onProgress?.(entry, 'materialized');
    } catch (error) {
      result.failed.push({ entry, reason: error instanceof Error ? error.message : String(error) });
      options.onProgress?.(entry, 'failed');
    }
  }
  return result;
}

async function declaredPackEntries(backend: StorageBackend): Promise<FlattenedPackEntry[]> {
  if (!(await backend.exists(ASSET_MANIFEST_PATH))) return [];
  const raw = await backend.read(ASSET_MANIFEST_PATH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${ASSET_MANIFEST_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return flattenAssetPacks(parseAssetPackManifest(parsed));
}

async function materializeOne(
  backend: StorageBackend,
  entry: FlattenedPackEntry,
  options: MaterializeAssetPacksOptions,
): Promise<void> {
  const fetched = await fetchVerifiedPackEntry(entry, options);
  await backend.write(entry.dest, fetched.bytes);
  await recordAssetMaterializationInBackend(backend, {
    destPath: entry.dest,
    key: entry.key,
    license: fetched.license,
    // The PIN, not the library's reported digest — identical here by the
    // check inside `fetchVerifiedPackEntry`, and the pin is the fact this
    // project reviewed.
    sourceSha256: entry.sha256,
  });
}

/** The bytes of one declared pack entry, plus the library's license string. */
export interface VerifiedPackEntryBytes {
  readonly bytes: Uint8Array;
  /** The library's own license string, for the ledger. */
  readonly license: string;
}

/**
 * Fetch and VERIFY one declared pack entry, writing nothing.
 *
 * This is the whole network + trust sequence — record lookup, pin/record
 * cross-check, byte fetch, digest verification — with the destination IO left
 * to the caller, because the two materialization sites differ only in where the
 * bytes land: this module writes through a `StorageBackend` (browser/hosted),
 * and `packages/vgai-cli/src/asset-packs.ts` writes to the filesystem for an
 * on-disk project `vgai add` just declared a pack into. Extracted so neither
 * site can drift from the other on the part that matters — a second copy of
 * "fetch then trust" is exactly how trust-on-first-use gets reintroduced.
 *
 * Throws on every failure and never returns partial bytes.
 */
export async function fetchVerifiedPackEntry(
  entry: FlattenedPackEntry,
  options: MaterializeAssetPacksOptions = {},
): Promise<VerifiedPackEntryBytes> {
  const separator = entry.key.indexOf(':');
  if (separator < 0) throw new Error(`Malformed asset key "${entry.key}" (expected "source:id").`);
  const source = entry.key.slice(0, separator);
  const assetId = entry.key.slice(separator + 1);
  if (source !== 'local') {
    throw new Error(
      `Asset key "${entry.key}": only the "local" (cloud-hosted) source can be materialized ` +
        'from the cloud worker.',
    );
  }
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_ASSET_BASE_URL;
  const fetchOptions = options.signal ? { baseUrl, signal: options.signal } : { baseUrl };
  const record = await fetchCloudAssetRecord(assetId, fetchOptions);
  if (!record) throw new Error(`"${entry.key}" is not hosted by the cloud asset library.`);
  const file = record.files[0];
  if (!file) throw new Error(`"${entry.key}" has no files in the cloud library.`);
  if (file.dependencies.length > 0) {
    throw new Error(
      `"${entry.key}" has ${file.dependencies.length} dependency file(s) — a pack entry names ` +
        'exactly one destination file.',
    );
  }
  // The cloud record must AGREE with the checked-in pin before a byte is
  // fetched. A library that has moved on is a legitimate event; silently
  // adopting its new bytes is not (see the module header).
  if (file.main.sha256 !== entry.sha256) {
    throw new Error(
      `"${entry.key}" → ${entry.dest}: the cloud library reports sha256:${file.main.sha256} but ` +
        `${ASSET_MANIFEST_PATH} pins sha256:${entry.sha256}. Nothing was fetched or written; ` +
        'the pin is only re-cut by a reviewed change to the declaration.',
    );
  }
  const url = cloudAssetObjectUrl(baseUrl, assetId, 0);
  const response = await fetch(url, options.signal ? { signal: options.signal } : {});
  if (!response.ok) throw new Error(`${url} returned ${response.status} ${response.statusText}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = await sha256Hex(bytes);
  if (actual !== entry.sha256) {
    throw new Error(
      `"${entry.key}" → ${entry.dest}: ${url} delivered sha256:${actual} but the declaration ` +
        `pins sha256:${entry.sha256}. Nothing was written.`,
    );
  }
  return { bytes, license: record.license };
}
