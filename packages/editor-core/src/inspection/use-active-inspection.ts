/**
 * `useActiveInspection` — the ONE reactive entry point to the inspection
 * model, and the reason the dock and the inspector cannot disagree about
 * which projection is showing.
 *
 * ## Why a hook and not "call the same function"
 *
 * Before this module, `components/Inspector.tsx` and
 * the workspace host both resolved the active surface and then
 * its presentation — the same expression, over DIFFERENT subscription sets. The inspector subscribed to
 * the active adapter (`adapter.subscribe`); the dock did not. So when the
 * active adapter changed under a document swap, the inspector re-rendered
 * with the new surface and the dock kept the old one: the card floated over
 * a dom document whose subject wanted the column, and the
 * `workspace:inspector` panel never existed (measured live, 2026-08-06).
 *
 * Sharing a function is discipline; sharing a hook is structure. Every store
 * the resolution reads is subscribed to HERE, once, so a consumer cannot
 * under-subscribe — there is no per-consumer subscription list left to drift.
 * The value returned is the whole {@link InspectionDisplay}
 * (`inspection/display.ts`): the composed subject, its surface, whether an
 * inspector exists, and which projection shows it, all derived from that one
 * subject.
 *
 * It is not a store: it holds nothing. Every listed store already exists and
 * already notifies; this hook only makes sure the same set backs every
 * consumer of the resolution.
 */

import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { assetEditorContextVersion, subscribeAssetEditorContext } from '../asset-editor-context';
import {
  assetInspectorActionsVersion,
  subscribeAssetInspectorActions,
} from '../asset-inspector-actions';
import { assetSelectionVersion, subscribeAssetSelection } from '../asset-selection';
import { activeAuthoringVersion, subscribeActiveAuthoring } from '../authoring/active-adapter';
import { resolvePanelAuthoring } from '../authoring/panel-authoring';
import { recordAuthoringConsumerUse } from '@volter/editor-sdk/kit/authoring-seam-evidence';
import { documentContextVersion, subscribeDocumentContexts } from '../document-context-registry';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import {
  inspectorPresentationVersion,
  subscribeInspectorPresentation,
} from '../inspector-presentation';
import {
  inspectorSectionRegistryVersion,
  subscribeInspectorSectionRegistry,
} from '@volter/editor-sdk/kit/inspector-section-registry';
import { subscribeToolContributionPlay, toolContributionPlayKey } from '../tool-contribution-play';
import {
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { chromeRegionsVersion, subscribeChromeRegions } from '../workspace-regions';
import { describeActiveInspectionSubject } from './active-subject';
import type { InspectionDisplay } from './display';
import {
  documentInspectionSubjectVersion,
  subscribeDocumentInspectionSubject,
} from './document-subject';

/**
 * The active inspection display, re-derived whenever anything it reads
 * changes. Consumers: the inspector projections (`components/Inspector.tsx`),
 * the workspace's physical gating (the workspace host) and the
 * floating card's own chrome (`components/CompactInspectorCard.tsx`).
 */
export function useActiveInspection(store: ShellStore): InspectionDisplay {
  // 1. Selection, the scene, and reflected edits. Exact membership-only
  // changes for an unrelated runtime object cannot change the active subject;
  // selected replacement and conservative structural changes advance the
  // shell snapshot at the store boundary.
  useSyncExternalStore(store.subscribe, store.getShellSnapshot, store.getShellSnapshot);
  // 2. Which document is active (the surface's first input).
  useSyncExternalStore(
    subscribeWorkspaceDocuments,
    workspaceDocumentRegistryVersion,
    workspaceDocumentRegistryVersion,
  );
  // 3. The adapter override slot — an ingest/document swap installs another.
  useSyncExternalStore(subscribeActiveAuthoring, activeAuthoringVersion, activeAuthoringVersion);
  // Play publishes the Game subject after async authoring setup has already
  // notified the shell. Observe that publication even while no section is mounted.
  useSyncExternalStore(
    subscribeToolContributionPlay,
    toolContributionPlayKey,
    toolContributionPlayKey,
  );
  // 4. The user's per-surface presentation preference.
  useSyncExternalStore(
    subscribeInspectorPresentation,
    inspectorPresentationVersion,
    inspectorPresentationVersion,
  );
  // 4b. The active workspace's docked-layout choice beneath it
  //     (`workspace-regions.ts`) — a workspace switch re-lays the column.
  useSyncExternalStore(subscribeChromeRegions, chromeRegionsVersion, chromeRegionsVersion);
  // 5. Section contributions (project tools register asynchronously / on HMR).
  useSyncExternalStore(
    subscribeInspectorSectionRegistry,
    inspectorSectionRegistryVersion,
    inspectorSectionRegistryVersion,
  );
  // 5b. The verbs `asset.inspector` sections publish for the selected asset.
  //     They resolve asynchronously (the Edit Mesh door imports the module
  //     before it knows), so the subject that carries them has to re-derive
  //     when they land — exactly like (5).
  useSyncExternalStore(
    subscribeAssetInspectorActions,
    assetInspectorActionsVersion,
    assetInspectorActionsVersion,
  );
  // 6. The asset browser's transient selection — a contribution matches on it.
  useSyncExternalStore(subscribeAssetSelection, assetSelectionVersion, assetSelectionVersion);
  // 7. The open Asset Lab document — the `asset-lab` surface's own subject.
  useSyncExternalStore(
    subscribeAssetEditorContext,
    assetEditorContextVersion,
    assetEditorContextVersion,
  );
  // 7b. What the ACTIVE document says it is. A document whose own subject
  //     changes under a pick the adapters never see (the component boards)
  //     has no other way into this resolution.
  useSyncExternalStore(
    subscribeDocumentInspectionSubject,
    documentInspectionSubjectVersion,
    documentInspectionSubjectVersion,
  );
  // 7c. What the active document's PUBLISHED CONTEXT answers, when the package
  //     driving it says that moved (`document-context-registry.ts`'s
  //     `notifyDocumentContextChanged`, the SDK's `documents.contextChanged`).
  //     A context is a live handle: `@volter/editor-blender` reads the engine through
  //     its RNA door and the answer decides which Properties TABS a datablock
  //     has, and nothing in a host store moves when that answer lands.
  useSyncExternalStore(subscribeDocumentContexts, documentContextVersion, documentContextVersion);
  // 8. The adapter's OWN truth (hierarchy/props changes, and the mount that
  //    makes a root's adapter resolvable in the first place — the
  //    notification the dock was missing).
  const [, forceAdapterUpdate] = useReducer((value: number) => value + 1, 0);
  const { adapter } = resolvePanelAuthoring(store);
  const observedStoreVersions = useRef({
    broad: store.getSnapshot(),
    shell: store.getShellSnapshot(),
  });
  observedStoreVersions.current = {
    broad: store.getSnapshot(),
    shell: store.getShellSnapshot(),
  };
  useEffect(() => {
    const subscribe = adapter.subscribe;
    if (!subscribe) return;
    return recordAuthoringConsumerUse({
      adapter,
      seam: 'editor.subscribe',
      stage: 'effect',
      detail: 'the active Inspector subscribed to adapter-owned changes',
      run: () =>
        subscribe.call(adapter, () => {
          const previous = observedStoreVersions.current;
          const next = {
            broad: store.getSnapshot(),
            shell: store.getShellSnapshot(),
          };
          observedStoreVersions.current = next;
          // A store-backed adapter reports through the same notification that
          // already reaches the selector above. An exact object-map-only
          // change advances only `broad` and cannot affect the selected
          // subject; a shell change is already scheduled by the direct store
          // subscription. A genuine adapter-only event advances neither and
          // still owns this explicit re-render path (notably replaceChild).
          if (next.broad === previous.broad && next.shell === previous.shell) {
            forceAdapterUpdate();
          }
        }),
    });
  }, [adapter, store]);

  return describeActiveInspectionSubject(store);
}
