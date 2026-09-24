/**
 * The exact host-owned delta for the synchronous R3F frame currently being dispatched.
 *
 * Fiber's `frameloop: 'never'` API accepts an absolute timestamp and reconstructs the frame
 * delta by subtracting its previous timestamp. Once that timestamp is large enough, ordinary
 * floating-point cancellation can turn an exact host `1 / 60` into either adjacent double. The
 * host still owns the original exact `dt`; adapter-boundary runtimes that must reproduce another
 * engine's clock can read it here instead of mistaking Fiber's reconstruction residue for game
 * time. The seat exists only for the synchronous `advance(...)` call and is cleared immediately
 * afterwards, so an async consumer can never read a stale frame.
 */

const hostFrameDeltas = new WeakMap<object, number>();

export function setHostFrameDelta(state: object, delta: number): void {
  hostFrameDeltas.set(state, delta);
}

export function clearHostFrameDelta(state: object): void {
  hostFrameDeltas.delete(state);
}

export function hostFrameDelta(state: object, fiberDelta: number): number {
  return hostFrameDeltas.get(state) ?? fiberDelta;
}
