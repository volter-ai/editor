/**
 * The `__vgaiIngest` / `__vgaiIngest2D` / `__vgaiIngestReact` dev hooks: the
 * headless-readable evidence a live ingest mount publishes for automation,
 * screenshots and `vgai doctor`.
 *
 * Everything here is EVIDENCE, not control: names read off the live adapter,
 * counters read off the live gate, the coverage report re-derived on demand.
 * Nothing is inferred from the route or the adapter's identity — a capability
 * appears here because the mounted object actually has it.
 */

import { getActiveSystems } from '@volter/editor-sdk/kit/authoring/active-systems';
import { loadIngestOwnership } from '../host/authoring/ingest-source-persistence';
import { gameLoopGate } from '../host/gated-globals';
import type { DomAuthoringAdapter } from '../react/dom-authoring-adapter';
import type { AuthoringAdapter } from '@volter/editor-project/adapter/authoring';
import type { IngestMount } from './authoring/ingest-root-adapter';
import { ingestCoverageReport } from './mount-coverage';

/** The window key each surface's mount publishes its evidence under. */
export type IngestHookKey = '__vgaiIngest' | '__vgaiIngest2D' | '__vgaiIngestReact';

const AUTHORING_PROVIDER_KEYS = [
  'hierarchy',
  'selection',
  'transforms',
  'inspector',
  'assetSubject',
  'structure',
  'persistence',
  'pickable',
  'rects',
  'boxEdit',
  'text',
  'colorSample',
  'stories',
  'truth',
  'assetDrop',
] as const satisfies readonly (keyof AuthoringAdapter)[];

/** Names only providers that exist on the LIVE adapter. This is the shelf's
 * authoring-family evidence; no capability is inferred from adapter identity. */
export function authoringProviderNames(adapter: AuthoringAdapter): string[] {
  return AUTHORING_PROVIDER_KEYS.filter((name) => adapter[name] !== undefined);
}

/** The shared evidence fields every surface-specific dev hook publishes. */
export function ingestHookEvidence(adapter: AuthoringAdapter): Record<string, unknown> {
  return {
    coverage: () => ingestCoverageReport(),
    prepareCoverage: () => loadIngestOwnership(),
    authoringProviders: () => authoringProviderNames(adapter),
    // Registered-adapter names deliberately come from the live registry, not
    // from the coverage report's game-contract row (WORK.md's explicit rule).
    engineSystems: () => Object.keys(getActiveSystems()),
  };
}

/**
 * The loop fields the `__vgaiIngest` dev hook publishes — the measured verdict
 * plus the gate's own counters, so automation can drive Play/Pause/Step through
 * exactly the seam the editor's own buttons use rather than a parallel one.
 */
export function defineLoopHookFields(target: Record<string, unknown>, mount: IngestMount): void {
  // `defineProperty`, NOT a spread: the verdict is itself live (the gate
  // re-measures it at every hold) and spreading an accessor evaluates it
  // once, which would freeze the claim at mount time and start lying the moment
  // the game's shape changed.
  Object.defineProperties(target, {
    loop: {
      enumerable: true,
      get: () => mount.realmLoopVerdict?.()?.loop ?? null,
    },
    loopReason: {
      enumerable: true,
      get: () => mount.realmLoopVerdict?.()?.reason ?? null,
    },
  });
  // S-5: the gate's own counters — what a pause actually held back. Before
  // this there was NOTHING to read about whether a pause held anything, which
  // is how "the gate reports success while gating nothing" survived. `null`
  // when no gate is installed; never a fabricated number.
  target['realmLoopStats'] = () => gameLoopGate()?.stats() ?? null;
}

/**
 * D-L1 — the LIVE value behind
 * `__vgaiIngestReact.domEvidence()`, shared by both react ingest routes.
 * Evaluated at scrape time (a function result, never memoized),
 * same "read the live state fresh on every call" discipline as
 * `__vgaiSiblingMounts` (D-H1).
 *
 * `elementCount` prefers the DOM's real `querySelectorAll('*').length` — a
 * real browser `HTMLElement` (what `reactRoot()` actually returns in
 * production) always has it — and falls back to the adapter's own
 * structural-walk size (`nodeCount()`) only when the mounted root doesn't
 * expose `querySelectorAll` at all (this repo's own vitest-node adapter
 * fixtures have no real DOM). Never a fabricated number either way: both
 * paths count real, currently-present elements.
 *
 * `reactRootPresent` checks for a React 19 `createRoot` own-property mount
 * stamp (`__reactContainer$<hash>`) on `root` itself — the SAME element
 * `reactRoot()` returned, which is exactly the element `createRoot(...)`
 * rendered into (`create-runtime.ts`'s `DomHostContext.container` doc
 * comment: "the adapter's `mount` renders its react tree INTO this exact
 * element via `createRoot`").
 */
export function reactDomEvidence(
  root: HTMLElement,
  adapter: DomAuthoringAdapter,
): { elementCount: number; hierarchyNodeCount: number; reactRootPresent: boolean } {
  const withQuery = root as unknown as { querySelectorAll?: (sel: string) => ArrayLike<unknown> };
  const elementCount =
    typeof withQuery.querySelectorAll === 'function'
      ? withQuery.querySelectorAll('*').length
      : adapter.nodeCount();
  const reactRootPresent = Object.keys(root as object).some((k) =>
    k.startsWith('__reactContainer'),
  );
  return { elementCount, hierarchyNodeCount: adapter.nodeCount(), reactRootPresent };
}

/** Publish a mount's evidence object. The ONE place these keys are written. */
export function publishIngestHook(key: IngestHookKey, hook: Record<string, unknown>): void {
  (window as unknown as Record<string, unknown>)[key] = hook;
}

/** Drop a torn-down mount's evidence. The ONE place these keys are removed. */
export function clearIngestHook(key: IngestHookKey): void {
  delete (window as unknown as Record<string, unknown>)[key];
}
