import type { AuthoringAdapter } from '@volter/editor-project/adapter';

let nextKey = 1;
const keys = new WeakMap<AuthoringAdapter, number>();

/**
 * Adapter-owned UI state must not outlive the adapter that created it.
 * Remounting also keeps React DEV prop-diff instrumentation from traversing
 * live renderer objects and invoking their legacy getters on adapter handoff.
 */
export function authoringAdapterKey(adapter: AuthoringAdapter | undefined): number {
  if (!adapter) return 0;
  const existing = keys.get(adapter);
  if (existing !== undefined) return existing;
  const key = nextKey++;
  keys.set(adapter, key);
  return key;
}
