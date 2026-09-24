/**
 * Pure, react-free frame-version cache (T7.4 slice 1).
 * `useWorldState` (`packages/editor/template/src/
 * ui/game-state.tsx`) is a thin `useSyncExternalStore` wrapper
 * around this: `getSnapshot` re-runs the selector once per `frameVersion`
 * bump (`GameStateBridge`, `runtime/state-bridge.ts`), caches by version,
 * and returns the PREVIOUS reference when `equals` holds against the fresh
 * result — that reference stability is what lets `useSyncExternalStore`
 * (and thus React) bail out of a re-render.
 *
 * Extracted to its own react-free module (no react import here, or anywhere
 * under `runtime/`) so this cache/equality logic — the part of the hook
 * that has real branching to get wrong — is unit-testable headlessly under
 * `packages/engine/test/`, without needing a react test harness (none
 * exists in this repo today; see `test/frame-selector-cache.test.ts`).
 */

/** Equality comparator for `FrameSelectorCache`/`useWorldState`. Defaults to
 *  `Object.is` (T7.4 §3); pass {@link shallow} for tuples/plain objects. */
export type Equals<T> = (a: T, b: T) => boolean;

/**
 * One-level shallow-equality helper (own enumerable keys, `Object.is` per
 * value) — the opt-in equality for selectors that return a fresh
 * object/array/tuple every call. Two non-object values fall back to
 * `Object.is`; a non-object compared against an object is never equal.
 */
export function shallow<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  const bRecord = b as Record<string, unknown>;
  for (const key of aKeys) {
    if (!Object.is((a as Record<string, unknown>)[key], bRecord[key])) return false;
  }
  return true;
}

export interface FrameSelectorCache<T> {
  /**
   * Return the cached value for `frameVersion` if it's the SAME version as
   * the last call (selector not re-run at all). Otherwise call `compute()`
   * once: if the fresh result is `equals` to the previously cached value,
   * the PREVIOUS reference is returned (and re-tagged with this
   * `frameVersion`, so the next same-version call also short-circuits);
   * otherwise the fresh value is cached and returned.
   */
  get(frameVersion: number, compute: () => T): T;
}

/** Construct a fresh per-subscriber cache. One per `useWorldState` call site
 *  (a fresh cache each mount — see the hook). */
export function createFrameSelectorCache<T>(equals: Equals<T> = Object.is): FrameSelectorCache<T> {
  let hasValue = false;
  let cachedVersion = -1;
  let cachedValue: T;

  return {
    get(frameVersion: number, compute: () => T): T {
      if (hasValue && frameVersion === cachedVersion) {
        return cachedValue;
      }
      const next = compute();
      if (hasValue && equals(cachedValue, next)) {
        // Bail-out: keep the PREVIOUS reference, but remember we're current
        // as of this frameVersion so a repeat call at the same version
        // doesn't even re-run `compute`.
        cachedVersion = frameVersion;
        return cachedValue;
      }
      cachedValue = next;
      cachedVersion = frameVersion;
      hasValue = true;
      return cachedValue;
    },
  };
}
