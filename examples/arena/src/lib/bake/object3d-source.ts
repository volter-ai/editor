import type * as THREE from 'three';

/** Project-local structural boundary between raw Three.js source and bake/preview helpers. */
export interface Object3DSourceBuild {
  root: THREE.Object3D;
  animations?: readonly THREE.AnimationClip[];
  dispose(): void;
}
