/**
 * The project-owned asset provenance ledger — `.vgai/assets.json` (D-AP3).
 *
 * Assets follow the capability model: the asset library is the SOURCE, a
 * project owns its COPIES. Every materialization — the editor's Library-panel
 * download, the template/example `asset-packs:sync` script, the hosted seed —
 * records the copy here, keyed by PROJECT-RELATIVE destination path.
 *
 * One ledger, not per-file sidecars: sidecars pollute asset directories and
 * break tooling that globs them.
 *
 * The ledger is the license/attribution record and the drift input. Comparing a
 * file's current hash to `sourceHash` distinguishes "the user edited their copy"
 * (legitimate; git reports it) from "the library moved" (reported, never
 * auto-applied — there is deliberately no `vgai asset update`).
 *
 * ANTI-SHIM: `license` and `sourceHash` are OPTIONAL and are recorded only when
 * the library actually supplied them. We never hash the bytes we just wrote and
 * call the result a `sourceHash` — that would make every copy look pristine
 * forever and destroy the drift signal the field exists for. A materialization
 * path with no library-supplied hash records the key and the timestamp and
 * nothing else. Today that is the polyhaven/ambientcg remote proxy, whose
 * upstream APIs publish no per-file digest; the local/cloud catalog paths
 * (34,412 assets) carry `sha256` and populate the field.
 */

import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';
import { z } from 'zod';

/** Project-relative location of the ledger. */
export const ASSET_LEDGER_PATH = '.vgai/assets.json';

/** The library's asset identity: `source:id` (see `onlineAssetKey`). */
export function assetKey(source: string, id: string): string {
  return `${source}:${id}`;
}

export const AssetLedgerEntrySchema = z
  .object({
    /** `source:id` — the library's own identity for the asset. */
    key: z.string().min(1),
    /** SPDX-ish license string as the library reported it, when it reported one. */
    license: z.string().min(1).optional(),
    /** The LIBRARY's digest of the source bytes — never a re-hash of our copy. */
    sourceHash: z
      .string()
      .regex(/^sha256-[a-f0-9]{64}$/, 'sourceHash must be "sha256-<64 hex>"')
      .optional(),
    /** ISO-8601 instant the copy was written into this project. */
    materializedAt: z.string().datetime(),
  })
  .strict();

export const AssetLedgerSchema = z.record(z.string().min(1), AssetLedgerEntrySchema);

export type AssetLedgerEntry = z.infer<typeof AssetLedgerEntrySchema>;
export type AssetLedger = Record<string, AssetLedgerEntry>;

/** Format a raw hex digest as the ledger's `sourceHash`. Rejects non-digests
 *  loudly rather than storing something that only looks like a hash. */
export function sourceHashFromSha256(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`Not a sha256 digest, refusing to record it as a sourceHash: ${sha256}`);
  }
  return `sha256-${sha256}`;
}

/** The raw hex digest inside a `sha256-…` sourceHash, or null for other forms. */
export function sha256FromSourceHash(sourceHash: string): string | null {
  const match = /^sha256-([a-f0-9]{64})$/.exec(sourceHash);
  return match?.[1] ?? null;
}

/** Normalize a ledger key: project-relative, forward slashes, no leading `./`. */
export function normalizeLedgerPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!normalized) throw new Error('An asset ledger path cannot be empty.');
  if (!isContainedRelativePath(normalized)) {
    throw new Error(`An asset ledger path cannot escape the project: ${path}`);
  }
  return normalized;
}

/** Parse a ledger document. Throws (loudly) on anything malformed — a
 *  provenance record that silently drops entries is worse than no record. */
export function parseAssetLedger(input: unknown): AssetLedger {
  return AssetLedgerSchema.parse(input);
}

/** Parse ledger JSON text; an absent ledger is `{}`, a CORRUPT one throws. */
export function parseAssetLedgerJson(text: string | null | undefined): AssetLedger {
  if (text == null || text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${ASSET_LEDGER_PATH} is not valid JSON: ${String(cause)}`);
  }
  return parseAssetLedger(parsed);
}

/** Record one materialization. Pure: returns a new, key-sorted ledger. */
export function upsertAssetLedgerEntry(
  ledger: AssetLedger,
  destPath: string,
  entry: AssetLedgerEntry,
): AssetLedger {
  const key = normalizeLedgerPath(destPath);
  const validated = AssetLedgerEntrySchema.parse(entry);
  const merged: AssetLedger = { ...ledger, [key]: validated };
  const sorted: AssetLedger = {};
  for (const path of Object.keys(merged).sort()) sorted[path] = merged[path]!;
  return sorted;
}

/** Serialize for disk — stable key order, trailing newline. */
export function serializeAssetLedger(ledger: AssetLedger): string {
  const sorted: AssetLedger = {};
  for (const path of Object.keys(ledger).sort()) sorted[path] = ledger[path]!;
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export type AssetLedgerDrift =
  | { readonly status: 'untracked' }
  | { readonly status: 'unknown-source-hash' }
  | { readonly status: 'pristine' }
  | {
      readonly status: 'edited-locally';
      readonly sourceHash: string;
      readonly currentHash: string;
    };

/**
 * Classify one copy against its ledger entry. `currentHash` is the sha256 of
 * the bytes on disk RIGHT NOW.
 *
 * This deliberately cannot tell "user edited" from "library moved" on its own —
 * both show as a hash difference. The ledger supplies one half (what we copied);
 * re-reading the library supplies the other. Callers that have not consulted the
 * library must report `edited-locally` as "differs from what was materialized",
 * never as "the library moved".
 */
export function classifyAssetLedgerDrift(
  ledger: AssetLedger,
  destPath: string,
  currentSha256: string,
): AssetLedgerDrift {
  const entry = ledger[normalizeLedgerPath(destPath)];
  if (!entry) return { status: 'untracked' };
  if (!entry.sourceHash) return { status: 'unknown-source-hash' };
  const expected = sha256FromSourceHash(entry.sourceHash);
  if (expected === null) return { status: 'unknown-source-hash' };
  return expected === currentSha256
    ? { status: 'pristine' }
    : { status: 'edited-locally', sourceHash: expected, currentHash: currentSha256 };
}
