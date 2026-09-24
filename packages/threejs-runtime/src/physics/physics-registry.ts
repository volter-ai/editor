import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';

/** The Rapier handles owned by a single Object3D entity. */
export interface PhysicsRefs {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

/**
 * Maps Three.js Object3Ds to their Rapier bodies/colliders, and Rapier collider
 * handles back to Object3Ds.
 *
 * Replaces the old bitecs RigidBodyRef/ColliderRef SoA components. Two indexes:
 *  - `Object3D → {body, collider}` for the postPhysics transform writer and for
 *    game code/editor to reach an entity's physics.
 *  - `colliderHandle → Object3D` reverse index for collision/trigger dispatch
 *    (Rapier collision events report collider handles).
 */
export function createPhysicsRegistry() {
  const byObject = new Map<THREE.Object3D, PhysicsRefs>();
  const byColliderHandle = new Map<number, THREE.Object3D>();
  const removeListeners: Array<(object3D: THREE.Object3D, refs: PhysicsRefs) => void> = [];

  return {
    /** Register an Object3D's body + collider, indexing both directions. */
    add(object3D: THREE.Object3D, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
      byObject.set(object3D, { body, collider });
      byColliderHandle.set(collider.handle, object3D);
    },

    /** Get the physics refs for an Object3D, if any. */
    get(object3D: THREE.Object3D): PhysicsRefs | undefined {
      return byObject.get(object3D);
    },

    /** Resolve a Rapier collider handle to the Object3D that owns it. */
    getByColliderHandle(handle: number): THREE.Object3D | undefined {
      return byColliderHandle.get(handle);
    },

    /**
     * Register a callback fired synchronously, just before an entry is torn
     * down, for every `remove()` call (both indexes are still intact at call
     * time). Used by trigger-dispatch (T1.12d) to flush any pending
     * `onTriggerExit` for a sensor overlap involving this object before the
     * collider handle becomes unresolvable — otherwise an entity despawned
     * between the physical exit and the next `collisions.drain()` silently
     * drops the exit callback on its still-live overlap partner.
     */
    onRemove(listener: (object3D: THREE.Object3D, refs: PhysicsRefs) => void): void {
      removeListeners.push(listener);
    },

    /** Remove an Object3D's entry from both indexes. */
    remove(object3D: THREE.Object3D): void {
      const refs = byObject.get(object3D);
      if (refs) {
        for (const listener of removeListeners) listener(object3D, refs);
        byColliderHandle.delete(refs.collider.handle);
      }
      byObject.delete(object3D);
    },

    /** Iterate every (Object3D, refs) pair — used by the transform writer. */
    entries(): IterableIterator<[THREE.Object3D, PhysicsRefs]> {
      return byObject.entries();
    },

    /** Number of registered physics entities. */
    get size(): number {
      return byObject.size;
    },

    /** Clear both indexes (does not free Rapier bodies). */
    clear(): void {
      byObject.clear();
      byColliderHandle.clear();
    },
  };
}

export type PhysicsRegistry = ReturnType<typeof createPhysicsRegistry>;
