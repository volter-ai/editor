/**
 * The Behavior debugger's status facet (`@volter/editor-sdk/services`, a
 * `workspace.service` contribution): `vgai status` reports the live actors
 * `Inspect Behavior` would open, so "it opened nothing" is answerable from
 * the session rather than guessed at.
 */
import { editorHost } from '@volter/editor-sdk/host';
import { listLiveBehaviors } from '../src/xstate/live-behaviors';

export const point = 'workspace.service';

export function start(): () => void {
  const host = editorHost();
  return host.session.reportFacet(() => ({
    liveBehaviors: {
      actors: listLiveBehaviors().map(({ nodeId, machineId }) => ({ nodeId, machineId })),
      // The objects the lookup walked: zero actors over zero objects is a door with no scene,
      // not a world with no machines.
      objectsSearched: host.hierarchy.objects().size,
    },
  }));
}
