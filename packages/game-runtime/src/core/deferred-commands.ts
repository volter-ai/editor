/**
 * `DeferredCommands` — work the caller runs at ONE point it chooses, plus the
 * subject-keyed disposal that has to land after it.
 *
 * The hazard is not exotic and it is not a foreign engine's: it is what a
 * Rapier world does to anything that mutates it from inside a callback. Disable
 * a collider while the solver is iterating, or free the node a collision
 * handler was dispatched ON, and the failure is either a corrupt step or
 * Rapier's own "recursive use of an object ... unsafe aliasing in rust". The
 * remedy is always the same shape — write down WHAT to do, do it once the frame
 * is out of anybody's way — and every caller that needs it was previously
 * hand-rolling an array.
 *
 * ## The one point is the CALLER's, deliberately
 *
 * There is no `queueMicrotask`, no `setTimeout(0)`, no `requestAnimationFrame`
 * and no subscription anywhere in this module. Whoever builds the queue decides
 * where {@link DeferredCommands.drain} runs — after physics, at the tail of a
 * world's update, wherever the frame's quiet moment actually is. A queue nobody
 * drains simply does not run its work, which is a visible failure rather than a
 * silent reordering onto a timeline the game does not control.
 *
 * ## This is NOT `SimClock`, and `after(0)` is not a substitute
 *
 * `core/sim-clock.ts` schedules on SIM TIME: `after(0, fn)` scheduled mid-frame
 * does land in that frame's tail flush (`runtime/game.ts` calls `flush(simT)`
 * after every phase of every world), so the resemblance is real and worth
 * naming. Three things make it the wrong tool for deferral:
 *
 *  - **A paused world never flushes.** `flush` is inside `runFrameImpl`'s
 *    `advanced` guard, so a game that pauses between the defer and the drain
 *    holds the work forever. End-of-frame deferral has to run on the frame,
 *    not on the clock.
 *  - **No subject identity.** Deferring destruction needs "this object, once",
 *    and needs the two questions that fall out of it —
 *    {@link DeferredCommands.isDisposePending} (a handler must be able to skip
 *    a subject that is already going away) and
 *    {@link DeferredCommands.wasDisposed} (an owner sweeping its own indexes
 *    after the drain). A time-ordered timer set answers neither.
 *  - **No same-drain re-entry.** A sim timer scheduled during a flush is
 *    deliberately never due in that flush; a deferred command that defers one
 *    more command must still land this frame, or the second write arrives a
 *    frame after the first and the two are no longer atomic.
 *
 * ## Ordering, and why disposal goes last
 *
 * {@link DeferredCommands.drain} runs every deferred command first, re-draining
 * until the queue is empty, and only then disposes every pending subject. That
 * order is not cosmetic: a deferred write to a subject that is ALSO queued for
 * disposal must still happen — it is what the caller asked for — and disposing
 * first would make that write operate on a freed handle. A subject queued twice
 * is disposed once, and the FIRST thunk wins (every caller for one subject
 * passes the same one).
 *
 * The re-drain is bounded by {@link MAX_DRAIN_PASSES}. A command that defers
 * itself forever is a bug in the caller, and a bounded loop names it in a
 * millisecond instead of hanging the frame.
 *
 * ## Why disposal carries its own thunk
 *
 * Disposal is the one thing here that is not surface-neutral. A `PIXI.Container`
 * ends with `removeFromParent()` + `destroy({ children })`; a `THREE.Object3D`
 * ends by detaching and disposing the geometries and materials underneath it;
 * a physics-backed entity has a Rapier body to pull first. This queue does none
 * of that — it takes the thunk from whoever owns the surface and runs it at the
 * drain. So the ORDERING lives here once and the surface knowledge stays where
 * the surface is, which is what lets one queue serve a 2D world and a 3D one.
 *
 * ## Resource ownership
 *
 * **Owner:** whoever calls {@link createDeferredCommands}, and that owner is
 * also the only caller of `drain()` — a queue is per-DRAINER, not per-process,
 * so two mounted games are two queues and neither can see the other's work.
 * This module registers nothing anywhere: there is no game-scoped slot (unlike
 * `sim-clock.ts`, which needs one because every world on a Game shares one
 * clock) and no module-level state at all.
 * **Sharers:** the queued subjects, by reference, and only until the drain that
 * disposes them.
 * **Teardown:** dropping the queue. There is deliberately no `dispose()` —
 * nothing here holds a handle, a listener or a timer, and a queue dropped with
 * work still in it has simply not run that work, which is what discarding a
 * frame means.
 */

/**
 * How many times {@link DeferredCommands.drain} re-drains a queue that keeps
 * refilling itself before declaring the caller's own logic non-terminating.
 *
 * A bound that correct code cannot reach (a deferred command that defers one
 * more, ten deep) while catching the infinite case immediately.
 */
export const MAX_DRAIN_PASSES = 16;

/** The queue. Build one per drainer with {@link createDeferredCommands}. */
export interface DeferredCommands {
  /**
   * Run `command` at the next {@link DeferredCommands.drain}.
   *
   * ```ts
   * // inside a collision handler, where the solver still owns the world:
   * frame.defer(() => collider.setSensor(true));
   * ```
   */
  defer(command: () => void): void;
  /**
   * Dispose `subject` at the next drain, after every deferred command has run.
   * Queuing the same subject twice disposes it once — the first `dispose`
   * thunk wins.
   */
  deferDispose(subject: object, dispose: () => void): void;
  /**
   * Is `subject` queued for disposal and not yet disposed? Read by a handler
   * that must skip a subject already on its way out.
   */
  isDisposePending(subject: object): boolean;
  /**
   * Has THIS queue already disposed `subject`? Read after a drain by an owner
   * sweeping its own indexes (a group, a registry, a spatial bucket) — "am I
   * destroyed" is a surface-specific question that a plain `Object3D` has no
   * answer to, so the queue is asked instead.
   */
  wasDisposed(subject: object): boolean;
  /** Run every deferred command (re-draining), then dispose every pending
   *  subject. Called once per frame, by the owner, at the point it chose. */
  drain(): void;
}

/** Build one queue. See the module header for who owns it and who drains it. */
export function createDeferredCommands(): DeferredCommands {
  let commands: (() => void)[] = [];
  const doomed = new Map<object, () => void>();
  const disposed = new WeakSet<object>();

  return {
    defer(command): void {
      commands.push(command);
    },

    deferDispose(subject, dispose): void {
      if (!doomed.has(subject)) doomed.set(subject, dispose);
    },

    isDisposePending(subject): boolean {
      return doomed.has(subject);
    },

    wasDisposed(subject): boolean {
      return disposed.has(subject);
    },

    drain(): void {
      let passes = 0;
      while (commands.length > 0) {
        if (++passes > MAX_DRAIN_PASSES) {
          throw new Error(
            `DeferredCommands.drain: still queueing more work after ${MAX_DRAIN_PASSES} passes. ` +
              'Something passed to defer() defers itself, so this drain would never terminate.',
          );
        }
        const batch = commands;
        commands = [];
        for (const command of batch) command();
      }

      // Subjects last, and only after every deferred command has run — see the
      // module header's ordering section.
      for (const [subject, dispose] of doomed) {
        dispose();
        disposed.add(subject);
      }
      doomed.clear();
    },
  };
}
