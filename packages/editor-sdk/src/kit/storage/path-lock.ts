/**
 * The one cross-realm mutual exclusion a browser storage backend has:
 * `navigator.locks`, keyed by backend id + path.
 *
 * Two callers matter and they MUST agree on the name, which is why this is a
 * shared function rather than a string built at each site — and why the name is
 * derived from the NORMALIZED path here rather than from whatever each caller
 * happens to hold. Sharing the function is not enough on its own: one caller
 * passes an already-normalized path and the other passes a module constant, so
 * agreement used to rest on that constant being spelled in normalized form.
 * Respell it as `/.vgai/assets.json` and the two names diverge, both locks are
 * "held", and mutual exclusion is silently gone with nothing failing. Deriving
 * the name from `normalize()` makes the agreement structural.
 *
 * Callers:
 *   - the asset ledger's `.lock` compare-and-delete
 *     (`../asset-workflow/asset-ledger-backend.ts`) — several steps that must
 *     not interleave with each other OR with the create above.
 *
 * Scope, stated exactly: Web Locks span every same-origin realm — the two
 * tabs on one project that motivate the ledger lock in the first place — and
 * nothing else. A writer that is not same-origin JS (a Node process
 * reaching the same files, i.e. `HttpStorage` racing the CLI) is not serialized
 * by this, and cannot be from the browser side.
 *
 * Absent in a non-secure context and in Node (tests): callers then get the bare
 * operation, which is the same exclusivity the platform itself offers.
 */
import { normalize } from '@volter/editor-sdk/kit/storage/paths';

export function withPathLock<T>(
  backendId: string,
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return operation();
  // `LockManager.request`'s DOM typing infers its result from the callback's
  // literal return type (`(lock) => T`), so an async callback types as
  // `Promise<Promise<T>>`. The platform awaits the returned promise before
  // releasing the lock — that flattening is the documented behavior, not an
  // assumption — so the settled value really is `T`.
  return locks.request(`vgai:${backendId}:${normalize(path)}`, operation) as Promise<T>;
}
