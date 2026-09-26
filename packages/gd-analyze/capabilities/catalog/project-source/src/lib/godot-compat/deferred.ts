/**
 * Godot's two "not right now" primitives — `Object.set_deferred` and
 * `Node.queue_free` — over the engine's own end-of-frame queue.
 *
 * Both exist for the same reason, and the pilot shows it in one line.
 * `Player.gd:54` is `$CollisionShape2D.set_deferred("disabled", true)`, and the
 * comment above it says why: *"Must be deferred as we can't change physics
 * properties on a physics callback."* The handler is running INSIDE the physics
 * step; disabling a shape there would mutate the world the solver is iterating.
 * `Mob.gd:11`'s `queue_free()` is the same hazard one size up — it runs from a
 * `screen_exited` signal and deletes the node the signal was dispatched on.
 *
 * ## What is the ENGINE's, and what is Godot's
 *
 * The QUEUE is not Godot's and no longer lives here. Deferring a mutation out
 * of a physics callback, deferring destruction to the end of a frame, disposing
 * a subject once however many times it was queued, and re-draining so a
 * deferred write that defers one more still lands the same frame — that is
 * `@vgai/engine/core/deferred-commands`'s {@link DeferredCommands}, and every
 * Rapier+three or Rapier+pixi game hits the same hazard whether or not anything
 * was ported. Read that header for the ordering rule (commands first, disposal
 * last, so a deferred write to a doomed subject still happens) and for why the
 * drain point is the CALLER's — `scene-tree.ts`'s `tick`, after physics, once
 * per frame — rather than a `queueMicrotask` or a `setTimeout(0)`.
 *
 * What stays here is Godot protocol, and only that:
 *
 *  - **the member names**, and the fact that the two of them share one queue.
 *  - **`is_queued_for_deletion()`**, which Godot exposes so a signal handler can
 *    skip a node that is already going away (`call_group` reads it for the same
 *    reason), and the "did this queue free it" question `scene-tree.ts` sweeps
 *    groups with — Godot removes a freed node from its groups as part of
 *    deletion.
 *  - **`set_deferred` taking a THUNK rather than a property name.** GDScript can
 *    only name a foreign object's member with a string. The emitted TypeScript
 *    already has the setter in hand, so the translation is
 *    `setDeferred(queue, () => setDisabled(shape, true))` — the string
 *    disappears at emission time. A `set_deferred` here that took a name and a
 *    value would need a property registry to look the name up in, which is the
 *    machinery this capability exists without, and it would defer the LOOKUP as
 *    well as the write, so a typo'd property name would fail a frame later at a
 *    call site that no longer exists.
 *  - **the deviation on non-termination.** Godot has no re-drain bound and will
 *    happily hang; the engine queue throws after {@link MAX_FLUSH_PASSES}
 *    passes naming the bug instead. That is deliberately NOT Godot's behaviour,
 *    and it is strictly better than it here.
 *  - **the surface split for freeing**, below.
 *
 * ## Why a queued node carries its own `free` thunk
 *
 * Freeing is the one thing here that is not surface-neutral. A Pixi
 * `Container` is freed with `removeFromParent()` + `destroy({ children })`; a
 * `THREE.Object3D` is freed by detaching it and disposing the geometries and
 * materials underneath it. The queue does neither: it takes the thunk from the
 * surface's own `queueFree` helper (`node.ts` for the display tree,
 * `node-3d.ts` for the three tree) and runs it at the end of the frame. So the
 * ORDERING lives in the engine once and the surface knowledge stays where the
 * surface is — which is what lets one `SceneTree` serve a 2D port and a 3D one.
 *
 * ## Resource ownership
 *
 * This module owns nothing of its own: it is a naming shim over one
 * `DeferredCommands`, whose ownership is stated in that module's header
 * (owner = whoever created it, which here is the `SceneTree`; sharers = the
 * queued nodes by reference until the flush that frees them; teardown =
 * dropping it).
 */

import { createDeferredCommands, MAX_DRAIN_PASSES } from '@volter/game-runtime/core/deferred-commands';

/**
 * How many times {@link DeferredQueue.flush} will re-drain a queue that keeps
 * refilling itself before declaring the port's own logic non-terminating.
 * The engine's bound, re-exported under Godot's spelling so a port that reads
 * it does not have to know which layer owns it.
 */
export const MAX_FLUSH_PASSES = MAX_DRAIN_PASSES;

/** The queue `set_deferred` and `queue_free` write into. */
export interface DeferredQueue {
  /**
   * `object.set_deferred("prop", value)` — run `apply` at the end of the frame.
   *
   * ```ts
   * // GDScript: $CollisionShape2D.set_deferred("disabled", true)
   * setDeferred(tree.deferred, () => setDisabled(collider, true));
   * ```
   */
  setDeferred(apply: () => void): void;
  /**
   * `node.queue_free()` — run `free` on `node` at the end of the frame.
   * Queueing the same node twice frees it once (the FIRST thunk wins, which is
   * the same one every caller for that node passes).
   */
  queueFree(node: object, free: () => void): void;
  /** `node.is_queued_for_deletion()` — true between `queueFree` and the flush
   *  that acts on it. Godot exposes this so a signal handler can skip a node
   *  that is already going away; `call_group` reads it for the same reason. */
  isQueuedForDeletion(node: object): boolean;
  /** Has this queue already freed `node`? `scene-tree.ts` reads it to sweep
   *  freed nodes out of their groups, which Godot does as part of deletion. */
  wasFreed(node: object): boolean;
  /**
   * Run every pending deferred call, then free every queued node. Called once
   * per frame by `scene-tree.ts`'s `tick`, after physics.
   *
   * Calls added DURING a flush run in the same flush, which is Godot's own
   * behaviour (it drains until the queue is empty). A call that defers itself
   * forever hangs Godot; here it throws — see this module's header.
   */
  flush(): void;
}

/** Build one queue. A `SceneTree` owns exactly one; nothing else should. */
export function createDeferredQueue(): DeferredQueue {
  const commands = createDeferredCommands();

  return {
    setDeferred(apply): void {
      commands.defer(apply);
    },
    queueFree(node, free): void {
      commands.deferDispose(node, free);
    },
    isQueuedForDeletion(node): boolean {
      return commands.isDisposePending(node);
    },
    wasFreed(node): boolean {
      return commands.wasDisposed(node);
    },
    flush(): void {
      commands.drain();
    },
  };
}
