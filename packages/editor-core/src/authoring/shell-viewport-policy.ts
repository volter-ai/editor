/**
 * THE SHELL'S ANSWERS to `ViewportAuthoringPolicy` — the composition the
 * editor installs at boot (`EditorContext.tsx`'s `EditorProvider`).
 *
 * Every member here is a one-line delegation to the module that already owned
 * that answer. Nothing moved and nothing was reimplemented: the point of the
 * seam is only that `editor-viewport.ts` no longer imports these modules, so
 * the gizmo viewport does not carry the composite adapter, the workspace
 * document registry, or the layered-pick walk in its own closure
 * (ARCHITECTURE-CORE §Editor chrome, "the viewport stack is separable").
 *
 * This file is the shell side of that boundary and is free to import all of
 * them.
 */

import type { ViewportAuthoringPolicy } from '../viewport-authoring-policy';
import { getActiveAuthoring } from './active-adapter';
import { CompositeAuthoringAdapter } from './composite-authoring-adapter';
import { pickTopmost } from './layered-pick';
import { resolvePanelAuthoring } from './panel-authoring';
import { isViewportToolContextVisible, resolveViewportToolContext } from './viewport-tool-context';
import {
  applyRootHiddenVisibility,
  isThreejsSurfaceVisible,
  resolveThreeViewportRootId,
  suppressRootEnvironment,
} from './world-hidden-viewport';

export const SHELL_VIEWPORT_AUTHORING_POLICY: ViewportAuthoringPolicy = {
  activeAuthoring: (store) => getActiveAuthoring(store),
  panelAuthoring: (store) => resolvePanelAuthoring(store).adapter,
  pick: (store, clientX, clientY, intent) => pickTopmost(store, clientX, clientY, { intent }),
  toolOwner: (adapter, selectedIds) => resolveViewportToolContext(adapter, selectedIds),
  // Both halves of "is this owner painted here" — visibility says a three
  // surface is drawn at all, selection ownership says it is the world being
  // edited. The viewport ANDs the result with `kind === 'three'`, exactly as it
  // did when it called these two itself.
  toolOwnerPainted: (store, owner) =>
    isThreejsSurfaceVisible(store) && isViewportToolContextVisible(store, owner),
  threeSurfaceShowing: (store, adapter) =>
    isThreejsSurfaceVisible(store) &&
    (adapter instanceof CompositeAuthoringAdapter
      ? adapter.childAdapters().some((child) => child.kind === 'three')
      : !adapter.rects && typeof adapter.hierarchy.object3D === 'function'),
  threeViewportRootId: (store) => resolveThreeViewportRootId(store),
  applyRootHiddenVisibility,
  suppressRootEnvironment,
};
