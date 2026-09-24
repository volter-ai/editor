/**
 * Debug ▸ Bake/Clear NavMesh — the navmesh session verbs as menu items.
 *
 * Both dispatch the window events `../src/navmesh/navmesh-handler.ts` listens
 * on (started by `navmesh.service.ts`), through `../src/navmesh/navmesh-actions.ts`:
 * the handler and the trigger import the SAME names, so a rename cannot
 * silently unwire the control. The whole cluster — handler, event names,
 * workflow store — is this package's now (P6b); no host module reads it.
 *
 * `disabled` and the Bake label are asked at render, and the host samples them
 * on its availability tick while a menu is open, so they follow the mounted
 * game's `NavigationAdapter` and a bake in flight.
 */
import { getActiveSystems } from '@volter/editor-core/authoring/active-systems';
import type { MenuContribution } from '@volter/editor-sdk/chrome';
import { dispatchNavMeshBake, dispatchNavMeshClear } from '../src/navmesh/navmesh-actions';
import { navBakeBusy, navMeshBaked } from '../src/navmesh/navmesh-workflow-store';

export const point = 'workspace.menu';

export const menu: MenuContribution = {
  menu: 'debug',
  items: [
    {
      id: 'navmesh-bake',
      label: () => (navMeshBaked() ? 'Rebake NavMesh' : 'Bake NavMesh'),
      testId: 'navmesh-bake',
      disabled: () => navBakeBusy() || !getActiveSystems().navigation?.bake,
      execute: dispatchNavMeshBake,
    },
    {
      id: 'navmesh-clear',
      label: 'Clear NavMesh',
      testId: 'navmesh-clear',
      disabled: () => navBakeBusy() || !navMeshBaked() || !getActiveSystems().navigation?.clear,
      execute: dispatchNavMeshClear,
    },
  ],
};
