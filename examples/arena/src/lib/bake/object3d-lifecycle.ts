import type * as THREE from 'three';

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []) {
      material.dispose();
    }
  });
}
