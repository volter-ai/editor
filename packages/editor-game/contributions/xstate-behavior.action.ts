/**
 * The Behavior debugger's palette actions (`@vgai/editor-sdk/chrome`, a
 * `workspace.action` contribution) — a LIVE set: `Inspect Behavior` (the
 * first truthful live actor, the same reveal as Debug ▸ Inspect Behavior)
 * plus one `Inspect Behavior: <machine>` per running XState actor. The host
 * asks `actions` when the palette opens and re-lists on `subscribe`: an
 * actor registering or a hierarchy change (any shell-store notification, so
 * the listing walks the object map only while a palette is open).
 */

import type { ActionContribution } from '@vgai/editor-sdk/chrome';
import { editorHost } from '@vgai/editor-sdk/host';
import { subscribeXStateBehaviorInspections } from '@vgai/threejs-runtime/behavior/xstate-inspection';
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
    execute: () => void openFirstBehaviorDocument(),
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
