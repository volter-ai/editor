/**
 * The host's asset door, as the SEAM sees it — `HostContext.assets`. `three`
 * is a TYPE-ONLY import: the contract names the shapes a loaded glTF resolves
 * to and ships none of the loading, which is the three.js twin's
 * (`@vgai/threejs-runtime/assets`).
 */

import type * as THREE from 'three';

/** Result of loading a .glb/.gltf file. */
export interface GLTFResult {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface AssetCache {
  /** Load an asset by URL. Returns a cached promise if already loading/loaded. */
  load<T = unknown>(url: string): Promise<T>;

  /** Get a previously-loaded asset synchronously. Throws if not yet loaded. */
  get<T = unknown>(url: string): T;
}
