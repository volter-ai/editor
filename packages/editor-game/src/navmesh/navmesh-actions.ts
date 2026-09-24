/**
 * The window-event seam between the navmesh triggers (the Debug menu's
 * Bake / Clear items, `contributions/navmesh.menu.ts`) and their listener
 * (`navmesh-handler.ts`, started by `contributions/navmesh.service.ts`). Both
 * sides import these names so a rename can never silently unwire the control —
 * the handler would stop listening and the trigger would stop reaching it in
 * the SAME edit.
 *
 * A window event (rather than a direct call) is deliberate: the handler follows
 * the mounted `NavigationAdapter` and lives for the contribution pass, while
 * the trigger is React menu chrome rendered on demand — the two never share a
 * reference.
 */

export const NAVMESH_BAKE_EVENT = 'editor:bake-navmesh';
export const NAVMESH_CLEAR_EVENT = 'editor:clear-navmesh';

/** Ask the mounted game's navigation adapter to bake from the walkable-tagged
 * meshes in the authoring scene. */
export function dispatchNavMeshBake(): void {
  window.dispatchEvent(new CustomEvent(NAVMESH_BAKE_EVENT));
}

/** Ask the mounted game's navigation adapter to clear its navmesh. */
export function dispatchNavMeshClear(): void {
  window.dispatchEvent(new CustomEvent(NAVMESH_CLEAR_EVENT));
}
