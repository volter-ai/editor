/**
 * "A continuous viewport gesture is happening right now" — the one fact the
 * absorb-by-remount cycle needs from the gizmo.
 *
 * A source write remounts the world; a drag that is STILL RUNNING when the
 * swap lands moves old-scene objects, and the adopted scene snaps them back
 * to the written values — a human moving a three-cube selection "bit by bit"
 * watched one member stay behind on every quick successive drag (runhuman
 * passes 49/54, both ranked it their #1 fix). The design session builds the
 * new world in parallel but awaits {@link whenLiveGestureIdle} before the
 * swap, so a drag always completes on the objects it started on.
 *
 * Deliberately module-scoped and frameworkless: the setter is the viewport's
 * `dragging-changed` handler and the consumer is the design session — no
 * React context reaches both.
 */

let active = 0;
let waiters: Array<() => void> = [];

export function beginLiveGesture(): void {
  active += 1;
}

export function endLiveGesture(): void {
  active = Math.max(0, active - 1);
  if (active === 0) {
    const resolved = waiters;
    waiters = [];
    for (const resolve of resolved) resolve();
  }
}

/** Whether any gesture (a drag, or a gesture's still-landing write) holds
 *  the lock right now — the swap's settle loop re-checks this after each
 *  wait, because a lock taken in the same task that released the previous
 *  one can race a waiter that already resolved. */
export function liveGestureActive(): boolean {
  return active > 0;
}

/** Resolves immediately when no gesture is running, else on the current
 *  gesture's end. */
export function whenLiveGestureIdle(): Promise<void> {
  return active === 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        waiters.push(resolve);
      });
}
