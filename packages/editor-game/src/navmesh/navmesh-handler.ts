import { getActiveSystems } from '@volter/editor-sdk/kit/authoring/active-systems';
import { editorHost } from '@volter/editor-sdk/host';
import type { NavigationAdapter } from '@volter/editor-project/adapter';
import { getUserData } from '@volter/threejs-runtime/ecs/user-data';
import * as THREE from 'three';
import { NAVMESH_BAKE_EVENT, NAVMESH_CLEAR_EVENT } from './navmesh-actions';
import {
  beginNavBake,
  endNavBake,
  markNavMeshBaked,
  navBakeBusy,
  resetNavMeshBaked,
} from './navmesh-workflow-store';
import { threeNavigation } from '@volter/editor-threejs/adapter/three-contract';
import { hostHierarchyObjects } from '@volter/editor-threejs/host-hierarchy-objects';
import { setViewportHelper, viewportRig } from '@volter/editor-threejs/viewport-door';

/**
 * The game skew's side of the Navigation verbs: bake/clear and the walkable
 * overlay tint, shown through the viewport door (`viewport-door`'s `setViewportHelper`,
 * kind `navmesh` — the Helpers menu's own toggle).
 *
 * Started by `contributions/navmesh.service.ts`, so its lifetime is the
 * contribution pass; it used to be a mount effect in the editor's scene panel,
 * which made a host panel the owner of a game-skew tool.
 *
 * It reads the authoring scene through `host-hierarchy-objects` and the
 * viewport through `viewport-door`'s `setViewportHelper` / `.rig()`, but keeps the
 * `@editor/authoring/active-systems` import for the adapter itself: the bake
 * collects the PRIMARY AUTHORING mount's walkable meshes, so the adapter it
 * bakes into must be that same mount's — `getActiveSystems()`. The door's
 * `systems.inspected()` follows the INSPECTED instance (the Inspect selector),
 * which in a split session is a different mount, and baking the authoring
 * scene's geometry into another instance's navmesh is the bug that would
 * cause. `host.systems.subscribe` IS `subscribeActiveNavigation` (measured in
 * `editor-host-door.ts`), so only the read needs the direct import.
 *
 * This handler speaks ONLY to the mounted game's `NavigationAdapter`
 * (bake/debug/clear). It never imports Recast, constructs a navigation
 * implementation, or disposes its handles. Returns a dispose function for
 * editor-owned listeners and presentation only.
 */
export function setupNavMeshHandlers(): () => void {
  let boundNavigation: NavigationAdapter | null = null;

  /** Unity-style blue walkable carpet (the helper's default is orange). */
  const walkableMaterial = new THREE.MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });

  function applyWalkableTint(helper: THREE.Object3D): void {
    helper.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = walkableMaterial;
    });
  }

  /**
   * Nodes tagged for navmesh baking.
   *
   * The role is read from `userData['navRole']` — the format-neutral key
   * `@volter/threejs-runtime/ecs/user-data` documents for exactly this ("navmesh role;
   * collected at runtime"). An adapter-backed world tags its own objects.
   */
  function collectNavigationIds(role: 'walkable' | 'obstacle'): Set<string> {
    const ids = new Set<string>();
    for (const [id, obj] of (hostHierarchyObjects()?.objects() ?? new Map<string, THREE.Object3D>())) {
      if (getUserData(obj, 'navRole') === role) ids.add(id);
    }
    return ids;
  }

  function clearPresentation(): void {
    setViewportHelper('navmesh', null);
  }

  /** Follow late registration/replacement of the primary mounted adapter. A
   * root may register navigation only after its async WASM setup completes. */
  function syncMountedNavigation(): void {
    const active = getActiveSystems().navigation;
    const nav = active ? threeNavigation(active) : null;
    if (nav !== boundNavigation) {
      boundNavigation = nav;
      clearPresentation();
    }
    if (!nav) {
      resetNavMeshBaked();
      return;
    }
    let baked = false;
    try {
      baked = nav.hasNavMesh();
    } catch (error) {
      editorHost().console.error(
        `Navigation adapter failed to report its state: ${error}`,
        'navigation',
      );
    }
    if (!baked) {
      resetNavMeshBaked();
      return;
    }
    markNavMeshBaked();
    // The adapter builds its debug mesh against the editor's scene; without
    // a mounted viewport there is nothing to show it in.
    const scene = viewportRig()?.scene;
    if (!scene) return;
    let debugMesh: THREE.Object3D | null = null;
    try {
      debugMesh = nav.debugMesh(scene);
    } catch (error) {
      editorHost().console.error(
        `Navigation adapter failed to create its debug mesh: ${error}`,
        'navigation',
      );
    }
    if (debugMesh) {
      applyWalkableTint(debugMesh);
      setViewportHelper('navmesh', debugMesh);
    }
  }

  const onBake = async () => {
    if (navBakeBusy()) return;
    beginNavBake();
    // Recast's solo bake is synchronous WASM — yield a frame so the Bake
    // button visibly paints its busy state before the build blocks the thread.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const active = getActiveSystems().navigation;
    const nav = active ? threeNavigation(active) : undefined;
    if (!nav) {
      const reason = 'The mounted game has no NavigationAdapter';
      editorHost().console.warn(`${reason} — nothing can be baked`, 'navigation');
      endNavBake(reason);
      return;
    }
    if (!nav.bake) {
      const reason = 'The mounted NavigationAdapter is inspect-only and does not support baking';
      editorHost().console.warn(reason, 'navigation');
      endNavBake(reason);
      return;
    }

    const walkableIds = collectNavigationIds('walkable');
    if (walkableIds.size === 0) {
      editorHost().console.warn(
        // The role is the object's own `userData.navRole` (see `collectNavigationIds`); a source
        // world tags it where the mesh is written.
        'No walkable meshes found — give the floors `userData={{ navRole: \'walkable\' }}` (and blockers `\'obstacle\'`) where they are written',
        'navigation',
      );
      endNavBake('No walkable-tagged entities in the scene');
      return;
    }

    // Obstacle-role meshes go into the recast input TOO: recast's slope
    // filter marks their steep faces unwalkable and erodes around them by
    // walkableRadius — that is what carves holes the path routes around
    // (Unity's Not-Walkable semantics). Only walkable-role presence gates
    // the bake; obstacles alone can't produce a mesh.
    const meshes: THREE.Mesh[] = [];
    for (const id of [...walkableIds, ...collectNavigationIds('obstacle')]) {
      const obj = (hostHierarchyObjects()?.objects() ?? new Map<string, THREE.Object3D>()).get(id);
      if (!obj) continue;
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
      });
    }
    if (meshes.length === 0) {
      editorHost().console.error(
        'NavMesh bake failed: the walkable-tagged entities have no meshes',
        'navigation',
      );
      endNavBake('Walkable entities have no meshes');
      return;
    }

    // Nothing authors bake parameters, so the bake uses recast's own defaults.
    let success = false;
    try {
      success = nav.bake(meshes);
    } catch (error) {
      editorHost().console.error(`NavMesh bake failed: ${error}`, 'navigation');
      endNavBake(`Bake failed: ${error}`);
      return;
    }
    if (!success) {
      editorHost().console.error('NavMesh bake failed', 'navigation');
      endNavBake('Bake failed (recast rejected the input geometry)');
      return;
    }

    boundNavigation = nav;
    const scene = viewportRig()?.scene;
    const debugMesh = scene ? nav.debugMesh(scene) : null;
    if (debugMesh) {
      applyWalkableTint(debugMesh);
      setViewportHelper('navmesh', debugMesh);
    }

    endNavBake(null);

    // The bake is SESSION-ONLY: no file is written and no loader reads one
    // back, so the mesh lives only for as long as this editor session does.
  };

  const onClear = () => {
    const active = getActiveSystems().navigation;
    const nav = active ? threeNavigation(active) : undefined;
    if (!nav) {
      editorHost().console.warn('The mounted game has no NavigationAdapter to clear', 'navigation');
      return;
    }
    if (!nav.clear) {
      editorHost().console.warn(
        'The mounted NavigationAdapter is inspect-only and does not support clearing',
        'navigation',
      );
      return;
    }
    try {
      nav.clear(viewportRig()?.scene ?? new THREE.Scene());
    } catch (error) {
      editorHost().console.error(`NavMesh clear failed: ${error}`, 'navigation');
      return;
    }
    clearPresentation();
    resetNavMeshBaked();
  };

  window.addEventListener(NAVMESH_BAKE_EVENT, onBake);
  window.addEventListener(NAVMESH_CLEAR_EVENT, onClear);
  const unsubscribeNavigation = editorHost().systems.subscribe(syncMountedNavigation);
  syncMountedNavigation();

  return () => {
    window.removeEventListener(NAVMESH_BAKE_EVENT, onBake);
    window.removeEventListener(NAVMESH_CLEAR_EVENT, onClear);
    unsubscribeNavigation();
    clearPresentation();
    walkableMaterial.dispose();
  };
}
