import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * Collision event handler.
 * Called with the two collider handles and whether contact started or stopped.
 */
export type CollisionHandler = (handleA: number, handleB: number, started: boolean) => void;

/**
 * Drains the Rapier event queue each frame and dispatches collision events.
 *
 * Usage:
 *   const collisions = createCollisionSystem(rapierWorld, eventQueue);
 *   collisions.onCollision((a, b, started) => { ... });
 *   // In physics phase: rapierWorld.step(eventQueue);
 *   // In postPhysics: collisions.drain();
 */
export function createCollisionSystem(rapierWorld: RAPIER.World, eventQueue: RAPIER.EventQueue) {
  const handlers: CollisionHandler[] = [];

  return {
    /** Register a collision handler. */
    onCollision(handler: CollisionHandler) {
      handlers.push(handler);
    },

    /** Remove a collision handler. */
    offCollision(handler: CollisionHandler) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    },

    /**
     * Drain the event queue and dispatch collision events.
     * Call this in POST_PHYSICS phase, after rapierWorld.step(eventQueue).
     *
     * Events are buffered first, then handlers run *after* the drain callback
     * returns. This is required: a handler that calls back into the Rapier world
     * (e.g. trigger dispatch resolving a collider, or an `onTriggerEnter` that
     * spawns/removes a body) would otherwise re-enter Rapier while it is still
     * borrowed by `drainCollisionEvents`, throwing "recursive use of an object
     * ... unsafe aliasing in rust".
     */
    drain() {
      const events: Array<[number, number, boolean]> = [];
      eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        events.push([handle1, handle2, started]);
      });
      eventQueue.drainContactForceEvents((_event) => {
        // Contact force events available for advanced use.
        // Game code can subscribe to these by extending this system.
      });

      for (const [handle1, handle2, started] of events) {
        for (let i = 0; i < handlers.length; i++) {
          handlers[i]!(handle1, handle2, started);
        }
      }
    },

    /**
     * Look up the rigid body handle that owns a collider handle.
     * To resolve a collider directly to its Object3D entity, use the physics
     * registry's `getByColliderHandle` reverse index instead.
     */
    getBodyHandleFromCollider(colliderHandle: number): number | undefined {
      const collider = rapierWorld.getCollider(colliderHandle);
      if (!collider) return undefined;
      const body = collider.parent();
      if (!body) return undefined;
      return body.handle;
    },
  };
}

export type CollisionSystem = ReturnType<typeof createCollisionSystem>;
