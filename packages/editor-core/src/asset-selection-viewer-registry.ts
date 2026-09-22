/**
 * WHO DRAWS *THIS* SELECTED ASSET — the tenth registry in the family of
 * `workspace-document-restore.ts` (a kind owns its persisted state),
 * `document-open-registry.ts` (a kind owns how it opens),
 * `chrome-slot-registry.ts` (the host owns the place, a package owns what
 * sits there), `content-entry-source-registry.ts` (the host owns the Content
 * scope, a package owns why a component is content),
 * `authoring/design-time-mount-registry.ts`, `component-board-registry.ts`,
 * `component-states-registry.ts` and `static-panel-presentation-registry.ts`.
 * Here: the host owns the Inspector's asset SECTION — the thumbnail, the
 * metadata rows, the tool sections, the empty state — and a package owns the
 * body for an asset the host has no way to draw.
 *
 * WHY IT EXISTS. `components/asset-selection-section.tsx` opened with
 * `if (asset.online) { … <OnlineAssetDetail/> … }` — the Inspector knowing
 * that an asset can come from an external catalog, and importing that
 * catalog's whole detail view (421 lines, plus the import-job ledger it
 * writes) into every editor boot, a `models` build that has no catalog
 * included (WORK.md §The open-source launch, the final audit's online-library
 * row). The sibling of `contentEntryForComponent`: one question — "is there a
 * registered body for this subject, and what is it" — asked of a registry
 * instead of answered by a branch.
 *
 * THE SHAPE is transcribed from `content-entry-source-registry.ts` (register /
 * list / subscribe, owner-replaces-owner for an HMR re-evaluation, a stable
 * EMPTY array so a reader's `useSyncExternalStore` snapshot is stable). TWO
 * deliberate differences:
 *  - NO per-registration `subscribe` to re-fan. A content SOURCE has a ledger
 *    that settles asynchronously; a viewer is a pure function of the asset
 *    the host already re-renders on. The registry's own change signal is all
 *    a reader needs, and a hook with nothing to subscribe to is a name that
 *    got built because it was named.
 *  - `match(asset)` IS THE WHOLE DISCRIMINATOR. The host never asks "is this
 *    online" again; it asks who claims the asset. First match wins, in
 *    registration order, so a build with no catalog package falls through to
 *    the host's own generic body — which is the answer it always gave for
 *    every asset that was not online.
 *
 * NOTHING REGISTERED IS A REAL ANSWER: the generic body, exactly as before.
 */

import type { ComponentType } from 'react';
import type { SelectedAsset } from './asset-selection';

export interface AssetSelectionViewerProps {
  readonly asset: SelectedAsset;
}

export interface AssetSelectionViewer {
  /** The viewer's id, in its own vocabulary. */
  readonly id: string;
  /** Which module registered it. Re-registering the same owner+id REPLACES. */
  readonly owner: string;
  /** Ascending; ties keep registration order. */
  readonly order?: number;
  /** Does this viewer claim the selected asset? The host asks; it never
   *  inspects the asset for a lane's own fields itself. */
  readonly match: (asset: SelectedAsset) => boolean;
  /** The Inspector body for a claimed asset, rendered INSTEAD of the host's
   *  generic one — the viewer owns everything below the section's frame,
   *  including any actions it wants. */
  readonly View: ComponentType<AssetSelectionViewerProps>;
}

const _viewers: AssetSelectionViewer[] = [];
const listeners = new Set<() => void>();
let version = 0;

function publish(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Install a viewer. Returns the teardown. */
export function registerAssetSelectionViewer(viewer: AssetSelectionViewer): () => void {
  const stale = _viewers.findIndex((item) => item.owner === viewer.owner && item.id === viewer.id);
  if (stale >= 0) _viewers.splice(stale, 1);
  _viewers.push(viewer);
  _viewers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  publish();
  return () => {
    const at = _viewers.indexOf(viewer);
    if (at < 0) return;
    _viewers.splice(at, 1);
    publish();
  };
}

/** The first registered viewer that claims this asset, or `null` — "nobody
 *  registered a body for it", which is a real answer and never an error. */
export function assetSelectionViewerFor(asset: SelectedAsset): AssetSelectionViewer | null {
  for (const viewer of _viewers) if (viewer.match(asset)) return viewer;
  return null;
}

/** ONE subscription for the Inspector section. */
export function subscribeAssetSelectionViewers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function assetSelectionViewersVersion(): number {
  return version;
}

/** Test-only reset (mirrors the restore, open, chrome-slot, content-source,
 *  design-time-mount, component-board and static-panel registries'). */
export function __resetAssetSelectionViewersForTest(): void {
  _viewers.length = 0;
  publish();
}
