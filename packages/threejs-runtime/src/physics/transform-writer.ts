import * as THREE from 'three';
import type { PhysicsRegistry } from './physics-registry';

const _quat = new THREE.Quaternion();
const _parentInv = new THREE.Matrix4();
const _parentQuat = new THREE.Quaternion();

/**
 * Build the single postPhysics transform writer.
 *
 * Replaces the old three-step path (physicsSyncSystem → ECS Position/Rotation →
 * vnode-manager.syncTransforms). Rapier always reports world-space transforms, so
 * for objects parented under something other than the scene root we convert the
 * body's world position/rotation into the parent's local space (P1.5) — the old
 * vnode path wrote world transforms as local and mis-placed parented children.
 *
 * Scale is left untouched: Rapier carries no scale, so the Object3D keeps its
 * authored local scale.
 */
export function createTransformWriter(physics: PhysicsRegistry, sceneRoot: THREE.Object3D) {
  return function writeTransforms(): void {
    for (const [object3D, { body }] of physics.entries()) {
      const t = body.translation();
      const r = body.rotation();
      const parent = object3D.parent;

      if (parent && parent !== sceneRoot) {
        // World → local: position through the inverse parent world matrix,
        // rotation through the inverse parent world quaternion.
        parent.updateWorldMatrix(true, false);
        _parentInv.copy(parent.matrixWorld).invert();
        object3D.position.set(t.x, t.y, t.z).applyMatrix4(_parentInv);
        parent.getWorldQuaternion(_parentQuat).invert();
        object3D.quaternion.copy(_parentQuat.multiply(_quat.set(r.x, r.y, r.z, r.w)));
      } else {
        object3D.position.set(t.x, t.y, t.z);
        object3D.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
  };
}
