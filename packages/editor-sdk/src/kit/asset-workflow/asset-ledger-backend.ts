/**
 * `StorageBackend` side of the asset provenance ledger (D-AP3) — the
 * browser/isomorphic sibling of `packages/editor/server/asset-ledger-store.ts`,
 * which reads/writes `.vgai/assets.json` via `node:fs` for the local
 * (HttpStorage-backed) Node editor. Every environment materializes through the
 * SAME record shape (`../asset-workflow/asset-ledger.ts`'s pure schema) — only
 * the I/O side differs, exactly like `storage/seed.ts`'s `readProjectManifest`
 * reading `vgai.project.json` through a `StorageBackend` instead of `node:fs`.
 *
 * Used by `hosted-asset-materialization.ts` (D-AP4 — a project's declared
 * packs).
 *
 * Concurrency: the same two-half protection the Node side takes, over this
 * side's I/O (see `./ledger-write-lock.ts`). The in-realm chain covers one tab
 * — several declared entries materializing in one pass, the Library panel and a
 * reopen retry overlapping — and the `.lock` file covers the case only another
 * realm can see: two tabs open on the same project, both retrying their
 * declared packs. `writeIfAbsent` is honest about not being O_EXCL on
 * handle APIs (it "serializes same-origin writers and rechecks at handle
 * acquisition"), which is exactly the guarantee that matters here — the racing
 * writers ARE same-origin — so it is the strongest primitive available and not
 * a claim of more.
 */

import { withPathLock } from '../storage/path-lock';
import type { StorageBackend } from '@volter/editor-sdk/kit/storage-types';
import {
  ASSET_LEDGER_PATH,
  type AssetLedger,
  type AssetLedgerEntry,
  normalizeLedgerPath,
  parseAssetLedgerJson,
  serializeAssetLedger,
  sourceHashFromSha256,
  upsertAssetLedgerEntry,
} from './asset-ledger';
import { createSerializer, withExclusiveLock } from './ledger-write-lock';

/** Read the ledger via `backend`. Absent → `{}`. Corrupt → throws (same
 *  contract as the Node `asset-ledger-store.ts` — a provenance record that
 *  silently drops entries is worse than no record). */
export async function readAssetLedgerFromBackend(backend: StorageBackend): Promise<AssetLedger> {
  if (!(await backend.exists(ASSET_LEDGER_PATH))) return {};
  return parseAssetLedgerJson(await backend.read(ASSET_LEDGER_PATH));
}

export async function writeAssetLedgerToBackend(
  backend: StorageBackend,
  ledger: AssetLedger,
): Promise<void> {
  await backend.write(ASSET_LEDGER_PATH, serializeAssetLedger(ledger));
}

export interface BackendMaterializationRecord {
  /** Project-relative destination, e.g. `public/asset-library/local/x/y.glb`. */
  readonly destPath: string;
  /** `source:id` — the library's identity for this asset. */
  readonly key: string;
  /** License string as the library reported it, if it reported one. */
  readonly license?: string | undefined;
  /** The LIBRARY's sha256 of the source bytes. Omit when the library has
   *  none — never substitute a hash of the bytes just written (anti-shim). */
  readonly sourceSha256?: string | undefined;
  readonly materializedAt?: string;
}

const LEDGER_LOCK_PATH = `${ASSET_LEDGER_PATH}.lock`;
const serializeLedgerWrite = createSerializer();
/** Stable per-backend key for the in-realm chain (`backend.id` is shared by
 *  every instance of a backend TYPE, so it cannot key this on its own). */
const backendKeys = new WeakMap<StorageBackend, string>();
let nextBackendKey = 0;

function ledgerWriteKey(backend: StorageBackend): string {
  const existing = backendKeys.get(backend);
  if (existing !== undefined) return existing;
  nextBackendKey += 1;
  const key = `${backend.id}#${nextBackendKey}`;
  backendKeys.set(backend, key);
  return key;
}

/** Record one materialization in the project's ledger, via `backend`. */
export async function recordAssetMaterializationInBackend(
  backend: StorageBackend,
  record: BackendMaterializationRecord,
): Promise<void> {
  const entry: AssetLedgerEntry = {
    key: record.key,
    ...(record.license ? { license: record.license } : {}),
    ...(record.sourceSha256 ? { sourceHash: sourceHashFromSha256(record.sourceSha256) } : {}),
    materializedAt: record.materializedAt ?? new Date().toISOString(),
  };
  await serializeLedgerWrite(ledgerWriteKey(backend), () =>
    withExclusiveLock(
      {
        createIfAbsent: (content) => backend.writeIfAbsent(LEDGER_LOCK_PATH, content),
        read: async () =>
          (await backend.exists(LEDGER_LOCK_PATH)) ? backend.read(LEDGER_LOCK_PATH) : null,
        // Compare-and-delete (see `./ledger-write-lock.ts`'s `ExclusiveLockIO`),
        // and its three steps must not interleave with another realm's — so
        // they run under the SAME path lock `HandleStorage.writeIfAbsent` takes
        // (`../storage/path-lock.ts`). That makes this side genuinely atomic
        // against every same-origin tab, so it needs no `rename` takeover
        // like the `node:fs` side.
        // NOT covered: `HttpStorage`, whose peer writer is the Node server/CLI
        // rather than another tab — Web Locks cannot reach a separate process,
        // and neither can anything else available in the page.
        removeIfHeldBy: (expected) =>
          withPathLock(backend.id, LEDGER_LOCK_PATH, async () => {
            if (!(await backend.exists(LEDGER_LOCK_PATH))) return;
            if ((await backend.read(LEDGER_LOCK_PATH)) !== expected) return;
            await backend.remove(LEDGER_LOCK_PATH);
          }),
      },
      async () => {
        const ledger = await readAssetLedgerFromBackend(backend);
        await writeAssetLedgerToBackend(
          backend,
          upsertAssetLedgerEntry(ledger, normalizeLedgerPath(record.destPath), entry),
        );
      },
      { owner: backend.id },
    ),
  );
}
