/**
 * THE NAVMESH SESSION HANDLER (`@volter/editor-sdk/services`, a
 * `workspace.service` contribution): the listener behind Debug ▸ Bake /
 * Clear NavMesh (`navmesh.menu.ts`), which bakes the authoring scene's
 * walkable-tagged meshes through the mounted game's `NavigationAdapter` and
 * shows the result as the viewport's `navmesh` helper.
 *
 * It was a mount effect in the host's one-and-only scene panel, so a
 * build with no `@volter/editor-game` still carried it and that panel owned its
 * lifetime. A service instead: the contribution pass starts it and stops it
 * before the next one, and no stage names a lane.
 */
import { setupNavMeshHandlers } from '../src/navmesh/navmesh-handler';

export const point = 'workspace.service';

export function start(): () => void {
  return setupNavMeshHandlers();
}
