/**
 * A tiny memoized-async-factory primitive — the machinery behind
 * `index.ts`'s lazy top-level `editor`/`tools` singletons. Pulled into
 * its own module (rather than inlined) so it's independently unit-testable
 * with a fake factory, with no need to exercise a real `connect()` (session
 * discovery, network) just to prove "two accesses, one connect".
 *
 * Caches the in-flight PROMISE, not just the resolved value — two callers
 * racing `ensure()` before the first resolves still share the SAME
 * connection attempt, not two independent ones.
 */
export interface LazySession<T> {
  /** Returns the memoized promise, creating it via `factory()` on first call. */
  ensure(): Promise<T>;
  /** Clears the memo — the NEXT `ensure()` calls `factory()` again. Exposed for tests (and for a caller that deliberately wants to reconnect); not needed in ordinary use. */
  reset(): void;
}

export function createLazySession<T>(factory: () => Promise<T>): LazySession<T> {
  let promise: Promise<T> | null = null;
  return {
    ensure(): Promise<T> {
      promise ??= factory();
      return promise;
    },
    reset(): void {
      promise = null;
    },
  };
}
