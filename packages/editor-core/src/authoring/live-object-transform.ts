/**
 * Reading the transform of a LIVE `Object3D` the editor did not write.
 *
 * THE TRAP, measured on the racing-game ingest (2026-08-15). A physics library
 * that drives a node writes the node's MATRIX and turns matrix composition off:
 * `@react-three/cannon`'s frame handler is literally
 * `object.matrixAutoUpdate = false; object.matrix.copy(m)`. Three never
 * decomposes that back, so `object.position`/`.quaternion`/`.scale` keep
 * whatever they held when the body was created — forever. Everything derived
 * from `matrixWorld` (selection brackets, bounds, three's own
 * `TransformControls`) tracks the truth, while everything derived from
 * `.position` shows the spawn point. Measured side by side: the driven chassis
 * reported `[-110, 0.75, 220]` in the Inspector while the game's own state
 * provider put it at `(-24.5, 0.85, 186.2)`.
 *
 * That mismatch is worse than a wrong number: origin markers and gizmo anchors
 * derived from `.position` sit somewhere the object is not, while the bounding
 * box around them is correct, so the editor contradicts itself on screen.
 *
 * THE RULE: **when a node owns its own matrix (`matrixAutoUpdate === false`),
 * the MATRIX is the transform.** Decompose it — through three's own
 * `Matrix4.decompose`, never a re-derivation. Otherwise the vector fields are
 * authoritative and are read directly: deliberately not "always decompose",
 * because for an ordinary node `matrix` is one frame BEHIND a write the editor
 * just made, and reading it back would make a gizmo drag stutter.
 *
 * Nothing here is library-specific: the predicate is three's own flag, so any
 * driver following the same convention (cannon, a custom integrator, an
 * animation system baking matrices) is covered without naming it.
 */

import * as THREE from 'three';

export interface LocalTransformRead {
  readonly position: [number, number, number];
  readonly quaternion: [number, number, number, number];
  readonly scale: [number, number, number];
}

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/**
 * The node's LOCAL transform, from whichever of the two representations it
 * actually maintains.
 */
export function localTransformOf(object: THREE.Object3D): LocalTransformRead {
  if (object.matrixAutoUpdate === false) {
    object.matrix.decompose(_position, _quaternion, _scale);
    return {
      position: _position.toArray() as [number, number, number],
      quaternion: _quaternion.toArray() as [number, number, number, number],
      scale: _scale.toArray() as [number, number, number],
    };
  }
  return {
    position: object.position.toArray() as [number, number, number],
    quaternion: object.quaternion.toArray() as [number, number, number, number],
    scale: object.scale.toArray() as [number, number, number],
  };
}
