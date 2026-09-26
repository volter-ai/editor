/**
 * Filesystem side of the asset provenance ledger (D-AP3).
 *
 * The shape, validation and merge rules live in the pure module
 * `../src/asset-workflow/asset-ledger.ts`; this file is only read-modify-write
 * of `<projectRoot>/.vgai/assets.json`.
 *
 * That read-modify-write is CONCURRENT-SAFE, and both halves are load-bearing
 * (see `../src/asset-workflow/ledger-write-lock.ts` for why neither alone is
 * enough):
 *
 *   - Same process: a promise chain per ledger path, so two overlapping
 *     `recordAssetMaterialization` calls do not both read the pre-write object
 *     and lose the earlier record.
 *   - Other processes: an exclusive `assets.json.lock` beside the ledger.
 *     Two `vgai edit` sessions, or `asset-packs:sync` racing an editor, are
 *     separate processes and the in-process chain cannot see them.
 *
 * The write itself is ATOMIC — staging file then `rename` — so a crash or a
 * concurrent READER never observes a half-serialized ledger. A truncated
 * provenance record reads as "these assets were never materialized", which is
 * exactly the silent-drop failure D-AP3 exists to prevent.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ASSET_LEDGER_PATH,
  type AssetLedger,
  type AssetLedgerEntry,
  normalizeLedgerPath,
  parseAssetLedgerJson,
  serializeAssetLedger,
  sourceHashFromSha256,
  upsertAssetLedgerEntry,
} from '@volter/editor-sdk/kit/asset-workflow/asset-ledger';
import {
  createSerializer,
  type ExclusiveLockIO,
  type ExclusiveLockOptions,
  removeIfHeldByTakeover,
  withExclusiveLock,
} from '@volter/editor-sdk/kit/asset-workflow/ledger-write-lock';

export function assetLedgerFile(projectRoot: string): string {
  return join(projectRoot, ...ASSET_LEDGER_PATH.split('/'));
}

/** Read the ledger. Absent → `{}`. Corrupt → throws, never silently reset. */
export async function readAssetLedger(projectRoot: string): Promise<AssetLedger> {
  let text: string;
  try {
    text = await readFile(assetLedgerFile(projectRoot), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  return parseAssetLedgerJson(text);
}

export async function writeAssetLedger(projectRoot: string, ledger: AssetLedger): Promise<void> {
  const file = assetLedgerFile(projectRoot);
  await mkdir(dirname(file), { recursive: true });
  // Staging + rename: `rename` within one directory is atomic, so a reader sees
  // either the old ledger or the new one, never a partial write.
  const staging = `${file}.writing-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(staging, serializeAssetLedger(ledger), 'utf8');
  try {
    await rename(staging, file);
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
}

/**
 * Run `work` while holding the ledger's CROSS-PROCESS lock.
 *
 * Exported for the concurrency test, which needs the on-disk half without the
 * in-process chain in front of it — a file lock cannot exclude its own holder,
 * so the two halves can only be proven separately.
 */
export async function withAssetLedgerFileLock<T>(
  projectRoot: string,
  work: () => Promise<T>,
  options: ExclusiveLockOptions = {},
): Promise<T> {
  const lockFile = `${assetLedgerFile(projectRoot)}.lock`;
  await mkdir(dirname(lockFile), { recursive: true });
  return withExclusiveLock(ledgerLockIo(lockFile), work, {
    owner: `pid ${process.pid}`,
    ...options,
  });
}

/**
 * The `node:fs` lock I/O for ANY ledger file, exported for the lock's own tests
 * — the interesting behavior here is per-operation (who may break a corpse,
 * what a release leaves behind) and is not reachable through
 * `withAssetLedgerFileLock`.
 *
 * Nothing in it is asset-specific: it takes the lock PATH. The project's
 * central provenance ledger (`.vgai/provenance.json`, another whole-document
 * read-modify-write, now written by the editor server AND by `vgai blender-mcp`)
 * takes the same lock through `server/project-output-writer.ts`.
 */
export function ledgerLockIo(lockFile: string): ExclusiveLockIO {
  /** `wx` = create-or-fail: the one primitive here that is a true atomic CAS. */
  const createExclusive = async (path: string, content: string): Promise<boolean> => {
    try {
      await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  };
  const readOrNull = async (path: string): Promise<string | null> => {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };

  return {
    createIfAbsent: (content) => createExclusive(lockFile, content),
    read: () => readOrNull(lockFile),
    // A filesystem has no atomic compare-and-delete, so this is a TAKEOVER:
    // `rename` (one syscall) decides which racer may break a given lock, and
    // the comparison happens after the seize rather than before it. See
    // `removeIfHeldByTakeover` for why read-then-unlink is not good enough and
    // for the residual window this still leaves.
    removeIfHeldBy: (expected) => {
      // Private to this attempt, so concurrent attempts never collide here.
      const aside = `${lockFile}.breaking-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      return removeIfHeldByTakeover(
        {
          moveAside: async () => {
            try {
              await rename(lockFile, aside);
              return true;
            } catch (error) {
              // ENOENT — another racer seized it first, or it is simply gone.
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
              throw error;
            }
          },
          readAside: () => readOrNull(aside),
          deleteAside: () => rm(aside, { force: true }),
          restoreIfAbsent: (content) => createExclusive(lockFile, content),
        },
        expected,
      );
    },
  };
}

export interface MaterializationRecord {
  /** Project root — the directory that owns `.vgai/`. */
  readonly projectRoot: string;
  /** Project-relative destination, e.g. `public/asset-library/local/x/y.glb`. */
  readonly destPath: string;
  /** `source:id` — the library's identity for this asset. */
  readonly key: string;
  /** License string as the library reported it, if it reported one. */
  readonly license?: string | undefined;
  /** The LIBRARY's sha256 of the source bytes. Omit when the library has none —
   *  never substitute a hash of the bytes we just wrote (anti-shim). */
  readonly sourceSha256?: string | undefined;
  readonly materializedAt?: string;
}

/** In-process serialization, keyed by the ledger file each record targets. */
const serializeLedgerWrite = createSerializer();

/** Record one materialization in the project's ledger. */
export async function recordAssetMaterialization(record: MaterializationRecord): Promise<void> {
  const entry: AssetLedgerEntry = {
    key: record.key,
    ...(record.license ? { license: record.license } : {}),
    ...(record.sourceSha256 ? { sourceHash: sourceHashFromSha256(record.sourceSha256) } : {}),
    materializedAt: record.materializedAt ?? new Date().toISOString(),
  };
  await serializeLedgerWrite(assetLedgerFile(record.projectRoot), () =>
    withAssetLedgerFileLock(record.projectRoot, async () => {
      const ledger = await readAssetLedger(record.projectRoot);
      await writeAssetLedger(
        record.projectRoot,
        upsertAssetLedgerEntry(ledger, normalizeLedgerPath(record.destPath), entry),
      );
    }),
  );
}
