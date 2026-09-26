/**
 * The first-party `NavigationAdapter` — a thin coordination/introspection
 * boundary over this twin's recast `NavMeshManager`. The editor speaks only
 * the contract's interface; this binds it to the blessed implementation, so an
 * external game can supply its own equivalent.
 *
 * Its AUDIO sibling (`createAudioSystemAdapter`, `releaseAudioMeters`) is the
 * game runtime's — `@volter/game-runtime/adapter/first-party-audio-system` — for
 * the same reason this one is three.js's: each lives with the subsystem it
 * wraps. (The former `AnimationAdapter` over the `AnimGraph` map was removed
 * by E5; `createInputManagerAdapter`/`createVgaiAssetAdapter` went with
 * `SystemAdapters.input`/`.assets`, registered and never read.)
 */

import type {
  NavBakeParams,
  NavigationAdapter,
  NavPoint,
} from '@volter/editor-project/adapter/system-adapter';
import type * as THREE from 'three';
import type { NavMeshManager } from '../ai/navigation';

/** First-party `NavigationAdapter` over the engine `NavMeshManager` — the
 *  blessed recast implementation, including the optional bake/export/crowd
 *  capabilities the editor's Navigation panel binds through.
 *
 * `clear` is deliberately owner-supplied: a manager cannot know which gameplay
 * objects retain CrowdAgent handles, so disposing it generically would leave
 * those handles pointing at freed WASM memory. A game that grants clear owns
 * releasing/rebinding those references in the same callback. `bake` may be
 * overridden for the same reason when a live crowd must be rebuilt. */
export function createNavigationAdapter(
  nav: NavMeshManager,
  ownerCapabilities: {
    readonly bake?: (meshes: THREE.Mesh[], params?: NavBakeParams) => boolean;
    readonly clear?: (scene: THREE.Scene) => void;
  } = {},
): NavigationAdapter {
  return {
    hasNavMesh: () => nav.hasNavMesh(),
    findPath: (start: NavPoint, end: NavPoint) => nav.findPath(start, end) as NavPoint[],
    debugMesh: (scene: THREE.Scene) => nav.getDebugMesh(scene) as unknown as THREE.Object3D | null,
    bake: ownerCapabilities.bake ?? ((meshes: THREE.Mesh[], params?: NavBakeParams) => nav.buildFromMeshes(meshes, params)),
    exportData: () => nav.exportData(),
    ...(ownerCapabilities.clear ? { clear: ownerCapabilities.clear } : {}),
    crowdAgents: () => nav.getCrowdAgents(),
  };
}
