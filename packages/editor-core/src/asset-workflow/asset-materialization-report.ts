/**
 * The FAILURE CHANNEL for declared-asset-pack materialization (D-AP4):
 * *"Failure = loud degradation, not fabrication. ... the missing asset is
 * reported in the editor console + status surface with a retry affordance, and
 * dependent features degrade honestly."*
 *
 * `materializeDeclaredAssetPacks` already fails closed per entry — it never
 * writes placeholder bytes and never blocks the other entries — but it only
 * RETURNS a `failed` array, and an array with no reader is the hazard: a seed
 * that lands without its clips would look like a working editor with a
 * mysteriously dead animation, which is the worst possible outcome and
 * precisely what the anti-shim rule forbids.
 *
 * This module is that reader, and it is deliberately TWO channels, because
 * neither alone is enough — D-AP4's own words, *"reported in the editor
 * console + status surface with a retry affordance"*:
 *
 *   1. `editorConsole.error` — one line per failed entry, subsystem `assets`,
 *      naming the library key, the destination path, the reason, and what
 *      degrades.
 *   2. A module-level report slot the status bar's `asset-materialization`
 *      contribution reads (`../components/status-contributions.tsx`),
 *      carrying the RETRY affordance. Retry re-runs materialization against
 *      the active backend, which is safe and cheap by construction: the
 *      materializer skips every entry already in the ledger, so a retry only
 *      refetches what is still missing.
 *
 * That status item used to be a red banner across the top of the shell. The
 * editor has ONE error home — console line, bottom-left status item, the
 * Console utility behind it — and a second one only taught users two places
 * to look, so the banner is gone.
 *
 * Same plain module-singleton + own-`subscribe` shape as
 * `../authoring/mount-failure-report.ts`.
 */

import { editorConsole } from '../editor-console';
import type { StorageBackend } from '../storage/types';
import type { AssetPackMaterializationResult } from './hosted-asset-materialization';

/** One declared pack entry that did not materialize — the exact fields both
 *  channels show. Flattened out of `AssetPackMaterializationFailure` so the
 *  banner never has to know the materializer's own types. */
export interface AssetMaterializationFailure {
  /** Library key, `source:id` (e.g. `local:a7c5288306d9e98cb7dbdbd2`). */
  readonly key: string;
  /** Project-relative destination the bytes were meant to land at. */
  readonly dest: string;
  /** Declaring pack name from `asset-manifest.json`. */
  readonly pack: string;
  /** The materializer's own reason string — never fabricated, never softened. */
  readonly reason: string;
}

let _failures: readonly AssetMaterializationFailure[] = [];
const _listeners = new Set<() => void>();

/** `useSyncExternalStore`-compatible subscribe for the banner. */
export function subscribeToAssetMaterializationFailures(callback: () => void): () => void {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

/** Every declared entry that failed to materialize, in declaration order. */
export function getAssetMaterializationFailures(): readonly AssetMaterializationFailure[] {
  return _failures;
}

/** Clear the slot (the banner's dismiss). Does not retry. */
export function clearAssetMaterializationFailures(): void {
  _failures = [];
  notify();
}

function notify(): void {
  for (const listener of _listeners) listener();
}

/**
 * The message BOTH channels use, so the console line and the banner row can
 * never drift apart. Names the key, the destination and the reason, then says
 * what degrades — a reader who sees only this line knows what is broken and
 * what it costs them.
 */
export function formatAssetMaterializationFailure(failure: AssetMaterializationFailure): string {
  return (
    `Starter asset "${failure.key}" (pack "${failure.pack}") did not materialize into ` +
    `${failure.dest}: ${failure.reason} Nothing was written for it — features that read ` +
    'that file degrade (a missing clips GLB leaves the character standing without ' +
    'locomotion clips). Use Retry once the cause is fixed.'
  );
}

/**
 * Report a materialization result through both channels. Called by every
 * production materialization site (today: `../storage/seed.ts`'s
 * `seedIfEmpty`) so no caller can forget to read `failed`.
 *
 * A result with no failures CLEARS the slot: that is what makes a successful
 * retry dismiss its own banner.
 */
export function reportAssetMaterialization(result: AssetPackMaterializationResult): void {
  const failures = result.failed.map((failure) => ({
    key: failure.entry.key,
    dest: failure.entry.dest,
    pack: failure.entry.pack,
    reason: failure.reason,
  }));
  for (const failure of failures) {
    editorConsole.error(formatAssetMaterializationFailure(failure), 'assets');
  }
  _failures = failures;
  notify();
}

/**
 * Re-run materialization against `backend` and re-report. Retry-safe by
 * construction (the materializer skips ledger-present entries), so this
 * refetches only what is still missing.
 *
 * A THROW here is the manifest itself being unreadable/invalid — not a
 * per-entry failure — so it degrades through the console too rather than
 * becoming an unhandled rejection in a click handler.
 */
export async function retryAssetMaterialization(backend: StorageBackend): Promise<void> {
  try {
    // Lazy for the same reason the seed's call is: the materializer is the
    // heaviest thing this report knows, and only the retry needs it.
    const { materializeDeclaredAssetPacks } = await import('./hosted-asset-materialization');
    const result = await materializeDeclaredAssetPacks(backend);
    reportAssetMaterialization(result);
  } catch (error) {
    editorConsole.error(
      `Retrying asset materialization failed before any entry was attempted: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'assets',
    );
  }
}
