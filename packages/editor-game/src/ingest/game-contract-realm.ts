import { gameRealmForMountId } from '../host/gated-globals';
import {
  readGameContract,
  type VgaiGameContract,
} from '@volter/editor-project/adapter/ingest/game-contract';

/**
 * The browser realm used by the singleton ingest routes.
 *
 * Vendored ingest entry graphs deliberately carry no `?vgai-mount=` query:
 * they share the editor's Pixi/Three packages and run in the default gated
 * realm. Realm hardening keeps game-owned expandos on that realm's window
 * proxy, so host code must read the contract from the same proxy rather than
 * from the editor's real `window`.
 */
export function ingestGameRealmWindow(): Window {
  return gameRealmForMountId().window;
}

/**
 * Read the declaration from the realm in which ingest modules publish it.
 *
 * No DOM means no realm to build — `gameRealmForMountId` proxies the real
 * `window`/`document`, so calling it in a DOM-less process is a bare `window`
 * reference, not a null read. Answering `null` there is the same headless
 * default `readGameContract` itself carries, and it is what keeps the
 * DOM-free callers of this (the command relay's `recordContractSystemUse`,
 * reached by every `bridge-call`) degrading instead of throwing
 * `window is not defined` at them.
 */
export function readIngestGameContract(): VgaiGameContract | null {
  if (typeof window === 'undefined') return null;
  return readGameContract(ingestGameRealmWindow());
}
