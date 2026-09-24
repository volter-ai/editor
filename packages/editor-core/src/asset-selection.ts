/**
 * Asset SELECTION state (W2) — the "single click selects" half of the selection-vs-open
 * contract:
 *
 *   - single click in the Project/Assets browser SELECTS the asset and shows
 *     compact preview/metadata in the Inspector (the registered
 *     `components/asset-selection-section.tsx` section reads this store);
 *   - double click / Enter OPENS the full viewer as a center document
 *     (`components/asset-documents.tsx`);
 *   - drag remains a placement gesture and never touches this store.
 *
 * A tiny module-scope store in the house `useSyncExternalStore` shape
 * (mirrors `inspector-section-registry.ts`): version counter + subscribe +
 * `__resetForTest`. It deliberately does NOT touch the EditorShellStore's entity
 * selection — clicking an asset must never deselect/reselect scene entities
 * (§6.1 "selection never unexpectedly..."); instead the Inspector gives the
 * asset domain precedence while retaining that entity selection, and the asset is auto-cleared
 * when the ENTITY selection changes (the user moved on — see
 * `installAssetSelectionAutoClear`).
 */

import type { AssetCapabilities } from '@volter/editor-sdk/kit/asset-capabilities';
import type { AssetKind, OnlineAssetInfo } from './editor-shell-store';

/** The §5.1 compact-selection payload — enough for the Inspector section to
 *  render preview + metadata without re-deriving browser state. */
export interface SelectedAsset {
  /** Project serving path, or a stable `online:<source>:<id>` document key. */
  readonly path: string;
  /** Source-owned file name as authored (§8 — `crate.png`). */
  readonly name: string;
  readonly kind: AssetKind | 'component' | 'folder' | 'unknown';
  /** Portable-CSF preview identity for a source-owned prefab/component. */
  readonly componentPreview?: {
    readonly surface: 'three' | 'canvas' | 'dom' | 'unknown';
    readonly sourcePath: string;
  };
  /** File size in bytes when the browser knows it. */
  readonly sizeBytes?: number;
  readonly capabilities?: AssetCapabilities;
  readonly health?: 'healthy' | 'source-only' | 'unsupported';
  readonly sourcePath?: string;
  readonly selectionCount?: number;
  readonly selectionTotalBytes?: number;
  readonly selectionFormats?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly references?: readonly { ownerPath: string; jsonPath: string }[];
  readonly healthCodes?: readonly string[];
  /** Selection came from the external acquisition Library rather than the
   * project's owned file tree. `online` carries the provider identity and is
   * intentionally absent from project assets. */
  readonly origin?: 'project' | 'library';
  readonly online?: OnlineAssetInfo;
}

let _selected: SelectedAsset | null = null;
let _version = 0;
const _listeners = new Set<() => void>();

function notifyChanged(): void {
  _version++;
  for (const fn of _listeners) fn();
}

/** Subscribe to selection changes. Returns an unsubscribe function. */
export function subscribeAssetSelection(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
export function assetSelectionVersion(): number {
  return _version;
}

/** The currently selected asset, or `null`. */
export function getSelectedAsset(): SelectedAsset | null {
  return _selected;
}

/** Select an asset (single-click). Idempotent on the same path. */
export function setSelectedAsset(asset: SelectedAsset): void {
  if (_selected && JSON.stringify(_selected) === JSON.stringify(asset)) return;
  _selected = asset;
  notifyChanged();
}

/** Clear the asset selection (no-op when already clear). */
export function clearSelectedAsset(): void {
  if (_selected === null) return;
  _selected = null;
  notifyChanged();
}

/** The narrow store surface the auto-clear needs (testable with a fake). */
export interface AssetSelectionAutoClearStore {
  subscribe(listener: () => void): () => void;
  readonly selectedEntityIds: ReadonlySet<string>;
}

function entitySelectionKey(store: AssetSelectionAutoClearStore): string {
  return [...store.selectedEntityIds].sort().join('\n');
}

/**
 * Auto-clear wiring (installed once per editor session by the layout): when
 * the ENTITY selection changes while an asset is selected, the user has moved
 * on — drop the asset selection so the Inspector goes back to being purely
 * entity-contextual. The entity-selection snapshot is captured on every asset
 * selection SET (not at install time), so only a change that happens AFTER
 * the asset click clears it.
 */
export function installAssetSelectionAutoClear(store: AssetSelectionAutoClearStore): () => void {
  let snapshot = entitySelectionKey(store);
  const unsubscribeSelf = subscribeAssetSelection(() => {
    if (_selected) snapshot = entitySelectionKey(store);
  });
  const unsubscribeStore = store.subscribe(() => {
    if (_selected && entitySelectionKey(store) !== snapshot) clearSelectedAsset();
  });
  return () => {
    unsubscribeSelf();
    unsubscribeStore();
  };
}

/** Test-only reset (mirrors `__resetInspectorSectionRegistryForTest`). */
export function __resetAssetSelectionForTest(): void {
  _selected = null;
  notifyChanged();
}
