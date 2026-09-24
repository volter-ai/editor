/**
 * The Behavior debugger's palette actions (`@volter/editor-sdk/chrome`, a
 * `workspace.action` contribution) — a LIVE set: `Inspect Behavior` (the
 * first truthful live actor, the same reveal as Debug ▸ Inspect Behavior)
 * plus one `Inspect Behavior: <machine>` per running XState actor. The host
 * asks `actions` when the palette opens and re-lists on `subscribe`: an
 * actor registering or a hierarchy change (any shell-store notification, so
 * the listing walks the object map only while a palette is open).
 */

import type { ActionContribution } from '@volter/editor-sdk/chrome';
import { editorHost } from '@volter/editor-sdk/host';
import { subscribeXStateBehaviorInspections } from '@volter/threejs-runtime/behavior/xstate-inspection';
import {
  listLiveBehaviors,
  openBehaviorDocument,
  openFirstBehaviorDocument,
} from '../src/xstate/live-behaviors';

export const point = 'workspace.action';

export const actions: ActionContribution['actions'] = () => [
  {
    id: 'inspect-behavior',
    label: 'Inspect Behavior',
    execute: () => {
      if (openFirstBehaviorDocument()) return;
      editorHost().notify({
        id: 'inspect-behavior',
        tone: 'info',
        title: 'No live behavior to inspect',
        detail: 'A behavior appears here once the running world binds an XState actor.',
      });
    },
  },
  ...listLiveBehaviors().map((entry) => ({
    id: `xstate-machine:${entry.machineId}:${entry.nodeId}`,
    label: `Inspect Behavior: ${entry.machineId}`,
    execute: () => void openBehaviorDocument(entry.nodeId),
  })),
];

export const subscribe: ActionContribution['subscribe'] = (listener) => {
  const stopInspections = subscribeXStateBehaviorInspections(listener);
  const stopHierarchy = editorHost().hierarchy.subscribe(listener);
  return () => {
    stopInspections();
    stopHierarchy();
  };
};
