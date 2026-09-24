import * as THREE from 'three';

/**
 * Apply the authored mesh-shadow contract to every renderable in a model.
 *
 * Primitive scene entities contain one Mesh, while glTF entities usually
 * contain a Group with many Mesh/SkinnedMesh descendants. Keeping this walk
 * shared prevents editor preview and runtime Play from disagreeing by source
 * format.
 */
export function setMeshShadowEnabled(root: THREE.Object3D, enabled: boolean | undefined): void {
  if (enabled === undefined) return;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = enabled;
    object.receiveShadow = enabled;
  });
}
