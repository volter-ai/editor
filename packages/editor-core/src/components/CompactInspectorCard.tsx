/**
 * The MINI card's physical home (`inspector-presentation.ts`): a card that is
 * PART OF THE VIEWPORT — positioned and clamped inside the center group's live
 * rect (`workspace-viewport-rect.ts`), so it rides the view as panels resize
 * instead of floating over the whole workspace. Rendered by the workspace host
 * while the ACTIVE SURFACE resolves the `card` presentation — the space-tight
 * fallback the user opts into, the case in which the narrow-column
 * `workspace:inspector` panel does not exist. Deliberately NOT a panel of the
 * host's: it belongs to the viewport, not the grid.
 *
 * Like the other viewport islands it has a SEMANTIC corner, rather than a
 * free-floating workspace position: bottom-right with the shared viewport
 * margin. Dock/layout changes recompute that placement from the active
 * center group's live rect, so an old drag offset can never strand it in the
 * middle of a resized Asset Lab or under a neighboring dock.
 *
 * MINIMIZED it is a pill (`InspectorPill`), and pressing the pill restores the
 * card. `minimized` lives here, above the projection, so the pill is always
 * rendered and the card is never unrestorable.
 *
 * The mini card and the pill show the same subject the box itself is showing
 * (`inspection/use-active-inspection.ts`), never from a second derivation over
 * the selection stores. The pill used to have one, and it disagreed — it
 * described the asset browser's selection while the box described a scene node.
 */

import { zIndex } from '@volter/editor-sdk/widgets';
import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  assetSelectionVersion,
  clearSelectedAsset,
  subscribeAssetSelection,
} from '@volter/editor-sdk/kit/asset-selection';
import { setAuthoringSelection } from '@volter/editor-sdk/kit/authoring/consumer-actions';
import { resolvePanelAuthoring } from '@volter/editor-sdk/kit/authoring/panel-authoring';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import { useActiveInspection } from '../inspection/use-active-inspection';
import {
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import {
  resolveViewportOverlayPlacement,
  subscribeWorkspaceViewportRect,
  type ViewportOverlayAnchor,
  type WorkspaceViewportRect,
  workspaceViewportRect,
  workspaceViewportRectVersion,
} from '../workspace-viewport-rect';
import { CompactInspectorHostProvider } from '@volter/editor-sdk/kit/components/CompactInspectorShell';
import { InspectorPill } from '@volter/editor-sdk/kit/components/InspectionProjection';
import { Inspector } from './Inspector';

/**
 * The compact inspector BOX's physical size family. It is size only — WHERE
 * the box sits is this host's business (it clamps against
 * `workspace-viewport-rect.ts`).
 *
 * `CARD_MAX_HEIGHT` is a CEILING, not a height: the mini card is preview + name
 * + icon strip + open-for-edit, content-driven, so a fixed height would leave
 * dead space beneath it. The card is bottom-anchored and its body scrolls once
 * it reaches this ceiling.
 */
const CARD_WIDTH = 260;
const CARD_MAX_HEIGHT = 360;
/** Breathing room kept between the box and every edge of the viewport. */
const CARD_MARGIN = 16;
/** Floor when the viewport is too small for the full size. */
const CARD_MIN_SIZE = 200;
const FAB_WIDTH = 220;
const FAB_HEIGHT = 54;
/** Fallback when no viewport rect is published yet (pre-first-layout):
 *  dock-root bottom-right, clear of the global status/conversation row. */
const FALLBACK_BOTTOM = 52;

type CardAnchor = ViewportOverlayAnchor;

const CARD_SIZING = {
  maxWidth: CARD_WIDTH,
  maxHeight: CARD_MAX_HEIGHT,
  minSize: CARD_MIN_SIZE,
  margin: CARD_MARGIN,
} as const;

const DEFAULT_ANCHOR: CardAnchor = { right: CARD_MARGIN, bottom: CARD_MARGIN };

const FAB_SIZING = {
  maxWidth: FAB_WIDTH,
  maxHeight: FAB_HEIGHT,
  minSize: FAB_HEIGHT,
  margin: CARD_MARGIN,
} as const;

function cardPlacement(viewport: WorkspaceViewportRect, anchor: CardAnchor, minimized: boolean) {
  return resolveViewportOverlayPlacement(viewport, minimized ? FAB_SIZING : CARD_SIZING, anchor);
}

export function CompactInspectorCard() {
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getShellSnapshot);
  useSyncExternalStore(
    subscribeWorkspaceDocuments,
    workspaceDocumentRegistryVersion,
    workspaceDocumentRegistryVersion,
  );
  useSyncExternalStore(subscribeAssetSelection, assetSelectionVersion, assetSelectionVersion);
  useSyncExternalStore(
    subscribeWorkspaceViewportRect,
    workspaceViewportRectVersion,
    workspaceViewportRectVersion,
  );
  const viewport = workspaceViewportRect();
  const [minimized, setMinimized] = useState(false);
  // THE subject — the same one `<Inspector/>` below renders. The pill is a
  // miniature of it, so there is nothing here to derive.
  const { subject } = useActiveInspection(store);

  // The PILL's clear, and the only one left: the title bar's X is gone (owner,
  // 2026-08-07 — "the x does deselect? may not be necessary either"), because
  // clicking empty viewport space already deselects. The pill keeps one,
  // because minimized there is no viewport gesture that reaches this box.
  const clearSelection = useCallback(() => {
    // Clear whatever produced the subject: the browser's asset selection is
    // its own producer (`inspection/active-subject.ts`), so clearing it is
    // what "no selection" means while it is showing.
    clearSelectedAsset();
    const { adapter } = resolvePanelAuthoring(store);
    if (!setAuthoringSelection(adapter, [])) store.select(null);
  }, [store]);

  const placement = viewport ? cardPlacement(viewport, DEFAULT_ANCHOR, minimized) : null;
  return (
    // Two elements, one box: the OUTER one is the clamped maximum rect for the
    // semantic bottom-right anchor, and the visible card inside it is
    // bottom-aligned with an intrinsic height. That lets a collapsed card be
    // exactly as tall as its own chrome while its bottom edge stays fixed.
    // The outer box is inert; the inner one owns all visible interaction.
    <div
      style={{
        position: 'absolute',
        ...(placement
          ? {
              left: placement.left,
              top: placement.top,
              width: placement.width,
              height: placement.height,
            }
          : {
              right: CARD_MARGIN,
              bottom: FALLBACK_BOTTOM,
              width: minimized ? FAB_WIDTH : CARD_WIDTH,
              height: minimized ? FAB_HEIGHT : CARD_MAX_HEIGHT,
            }),
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: zIndex.sticky,
        pointerEvents: 'none',
      }}
    >
      <div
        data-testid="compact-inspector-card"
        style={{
          display: 'flex',
          width: '100%',
          // The pill is a fixed lozenge; the open card is content-driven up to
          // the outer box's ceiling, beyond which its panel body scrolls.
          ...(minimized ? { height: '100%' } : { maxHeight: '100%' }),
          borderRadius: minimized ? 999 : 'var(--dv-group-border-radius, 8px)',
          overflow: minimized ? ('hidden' as const) : ('clip' as const),
          border: 'var(--dv-floating-border, 1px solid var(--vgai-boundary-default))',
          boxShadow: 'var(--dv-floating-box-shadow, var(--vgai-shadow-lg))',
          background: 'var(--dv-group-view-background-color, var(--vgai-bg-1))',
          pointerEvents: 'auto',
        }}
      >
        {minimized ? (
          <InspectorPill
            subject={subject}
            onExpand={() => setMinimized(false)}
            onClear={clearSelection}
          />
        ) : (
          <CompactInspectorHostProvider actions={{ minimize: () => setMinimized(true) }}>
            <Inspector />
          </CompactInspectorHostProvider>
        )}
      </div>
    </div>
  );
}
