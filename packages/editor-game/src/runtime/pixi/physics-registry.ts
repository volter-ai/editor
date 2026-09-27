import type RAPIER from '@dimforge/rapier2d-compat';
import type { Container } from 'pixi.js';

/** The Rapier 2D handles owned by a single display-object entity. */
export interface Physics2DRefs {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

/**
 * Maps PixiJS display objects to their Rapier 2D bodies/colliders and back —
 * the Pixi analog of `PhysicsRegistry`. Two indexes:
 *  - `Container → {body, collider}` for the postPhysics transform writer.
 *  - `colliderHandle → Container` reverse index for collision/trigger dispatch.
 */
export function createPhysics2DRegistry() {
  const byObject = new Map<Container, Physics2DRefs>();
  const byColliderHandle = new Map<number, Container>();

  return {
    add(display: Container, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
      byObject.set(display, { body, collider });
      byColliderHandle.set(collider.handle, display);
    },
    get(display: Container): Physics2DRefs | undefined {
      return byObject.get(display);
    },
    getByColliderHandle(handle: number): Container | undefined {
      return byColliderHandle.get(handle);
    },
    remove(display: Container): void {
      const refs = byObject.get(display);
      if (refs) byColliderHandle.delete(refs.collider.handle);
      byObject.delete(display);
    },
    entries(): IterableIterator<[Container, Physics2DRefs]> {
      return byObject.entries();
    },
    get size(): number {
      return byObject.size;
    },
    clear(): void {
      byObject.clear();
      byColliderHandle.clear();
    },
  };
}

export type Physics2DRegistry = ReturnType<typeof createPhysics2DRegistry>;
