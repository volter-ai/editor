/**
 * The Three integration's answers to the hierarchy panel's row questions
 * (`@volter/editor-sdk/kit/hierarchy-row-media`): an instanced mesh's row names the units it
 * draws, a node's component marks come off its `Object3D`, and the store's Three half logs which
 * projected parents its object map changed so the panel can patch rows.
 */
import { registerHierarchyRowMedia } from '@volter/editor-sdk/kit/hierarchy-row-media';
import { entityObject3D } from './entity-object';
import { markReaderFor } from './hierarchy-mark-reader';
import { instancedRowDetail } from './instanced-presentation';
import { threeStateOf } from './three-state';

export function registerThreeHierarchyRowMedia(): () => void {
  return registerHierarchyRowMedia({
    detail: (adapter, nodeId, store) =>
      instancedRowDetail(entityObject3D(adapter, threeStateOf(store).objectMap, nodeId)),
    marks: (hierarchy) => markReaderFor(hierarchy),
    structureLog: (store) => {
      const three = threeStateOf(store);
      return {
        epoch: () => three.gizmoEpoch,
        parentChangesSince: (epoch) => three.ingestObjectMapChangesSince(epoch),
      };
    },
  });
}
