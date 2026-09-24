/**
 * Shared DOM-world canvas transform (spec27 §8 "space-pan" row, D4 rebuild) — a
 * module-level subscribable singleton (mirrors `eyedropper-session.ts`'s "bare
 * singleton + own listener set" shape) holding the CURRENT SHARED pan + zoom
 * applied, in LOCKSTEP, to both every design-time world-layer host
 * (`design-time-layers.ts`'s `createLayerElement`-produced react/pixi layers)
 * and `RootSelectionOverlay`'s visual-chrome wrapper. Its independent input
 * sibling deliberately remains untransformed and covers the full viewport.
 *
 * SOUNDNESS (why lockstep preserves the "zero-correction" host-relative rect
 * invariant `RootSelectionOverlay.tsx`'s own doc comment establishes):
 * `RectProvider.rect(id)` is computed as `el.getBoundingClientRect()` MINUS
 * the owning world's own root/host `getBoundingClientRect()`
 * (`react-world-authoring-adapter.ts`'s `toHostRelative`/`hostRect` — `this
 * .root` IS the exact layer div `createLayerElement` produces). A CSS
 * `transform: translate()` applied directly to that host element shifts the
 * host's OWN rendered rect AND every descendant's rendered rect by the
 * IDENTICAL `(x, y)` delta — a rigid subtree translation — so the
 * subtraction is invariant under pan: `rect(id)` returns the SAME
 * host-relative numbers at any pan offset, unmodified, with no pan-awareness
 * needed in `inspect.ts`'s geometry math or the overlay chrome consumers.
 * Zoom scales both measured rectangles; `toHostRelative` divides their
 * offsets and dimensions by the shared zoom before exposing authored-space
 * geometry, while `RootSelectionOverlay.toHostLocal` performs the inverse
 * for pointer gestures. `PickProvider.pick` needs no changes — it
 * hit-tests real rendered rects against the real client cursor position,
 * both of which already reflect the applied transform natively.
 *
 * Applying the exact SAME transform to `RootSelectionOverlay`'s own visual-
 * chrome wrapper (a SIBLING of every world-layer host inside the SAME
 * `the world root's stage` containerRef parent — see that file's own mount-site doc
 * comment) shifts and scales the overlay by the identical transform — so
 * drawing a chrome element at `rect(id)`'s authored coordinates lands it at the
 * SAME screen position as the panned live element it describes. This is the
 * entire "lockstep" contract: every consumer on both sides of the pan reads
 * ONE shared value (`getRootPan()`) and applies it through the ONE shared
 * pure helper (`panTransformValue`) — never two independently-computed
 * transforms that could drift.
 */

export interface RootPan {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const ZERO_PAN: RootPan = { x: 0, y: 0, zoom: 1 };

/**
 * One document camera over a 2D authoring plane.
 *
 * DOM component boards still use the historical shared instance exported
 * below. A native canvas Scene creates its own instance, because a scene
 * camera and a component-board camera are different documents and must not
 * inherit one another's pose merely because both happen to be 2D.
 */
export interface RootViewController {
  get(): RootPan;
  setView(x: number, y: number, zoom: number): void;
  setPan(x: number, y: number): void;
  setZoom(zoom: number): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function createRootViewController(initial: RootPan = ZERO_PAN): RootViewController {
  let current: RootPan = initial;
  const subscribers = new Set<() => void>();
  const notifySubscribers = (): void => {
    for (const listener of subscribers) listener();
  };
  return {
    get: () => current,
    setView: (x, y, zoom) => {
      const nextZoom = Math.min(4, Math.max(0.1, zoom));
      if (current.x === x && current.y === y && current.zoom === nextZoom) return;
      current = { x, y, zoom: nextZoom };
      notifySubscribers();
    },
    setPan: (x, y) => {
      const nextZoom = current.zoom;
      if (current.x === x && current.y === y) return;
      current = { x, y, zoom: nextZoom };
      notifySubscribers();
    },
    setZoom: (zoom) => {
      const nextZoom = Math.min(4, Math.max(0.1, zoom));
      if (current.zoom === nextZoom) return;
      current = { x: current.x, y: current.y, zoom: nextZoom };
      notifySubscribers();
    },
    reset: () => {
      if (current.x === 0 && current.y === 0 && current.zoom === 1) return;
      current = ZERO_PAN;
      notifySubscribers();
    },
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
}

let _pan: RootPan = ZERO_PAN;
const listeners = new Set<() => void>();

/** The historical DOM-board camera, exposed as a controller for generic
 * navigation/overlay code. Existing function exports below remain the
 * compatibility surface for board-specific callers. */
export const sharedRootViewController: RootViewController = {
  get: () => getRootPan(),
  setView: (x, y, zoom) => setRootView(x, y, zoom),
  setPan: (x, y) => setRootPan(x, y),
  setZoom: (zoom) => setRootZoom(zoom),
  reset: () => resetRootPan(),
  subscribe: (listener) => subscribeRootPan(listener),
};

function notify(): void {
  for (const l of listeners) l();
}

/** The current shared canvas transform; x/y are CSS px and zoom is unitless. */
export function getRootPan(): RootPan {
  return _pan;
}

/** Set the complete shared canvas transform in one subscriber notification. */
export function setRootView(x: number, y: number, zoom: number): void {
  const nextZoom = Math.min(4, Math.max(0.1, zoom));
  if (_pan.x === x && _pan.y === y && _pan.zoom === nextZoom) return;
  _pan = { x, y, zoom: nextZoom };
  notify();
}

/** Set the shared pan translate to an absolute `(x, y)`. */
export function setRootPan(x: number, y: number): void {
  setRootView(x, y, _pan.zoom);
}

/** Set the shared canvas zoom while preserving its current pan. */
export function setRootZoom(zoom: number): void {
  setRootView(_pan.x, _pan.y, zoom);
}

/** Set the shared pan translate by a RELATIVE `(dx, dy)` — a convenience
 *  wrapper over `setRootPan` (not used by `RootSelectionOverlay`'s own
 *  space-drag, which composes onto a captured drag-start snapshot instead —
 *  see its own doc comment — but kept here as the natural pure counterpart
 *  for any future incremental caller, e.g. a nudge-pan keybinding). */
export function panRootBy(dx: number, dy: number): void {
  setRootPan(_pan.x + dx, _pan.y + dy);
}

/** Reset pan to `(0, 0)` and zoom to 100% — called on a world-layer remount (`design-time-
 *  layers.ts`'s `mountDesignTimeLayers`, invoked on initial edit-mode install
 *  AND every acknowledged edit-mode rebuild), so switching/reloading the active
 *  world set never leaves a stale pan offset applied over a DIFFERENT layer
 *  stack. A no-op (no `notify()`) when already at rest, so a fresh session
 *  never fires a spurious subscriber tick. */
export function resetRootPan(): void {
  if (_pan.x === 0 && _pan.y === 0 && _pan.zoom === 1) return;
  _pan = ZERO_PAN;
  notify();
}

/** Subscribe to canvas-transform changes — both `design-time-layers.ts` (imperative DOM
 *  style writes) and `RootSelectionOverlay` (`useSyncExternalStore`) bind
 *  this so every lockstep mount point re-applies the SAME new value the
 *  instant it changes. */
export function subscribeRootPan(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The ONE shared CSS `transform` value both visual lockstep mount points apply —
 * pure, so a unit test can assert the world-layer host and the overlay
 * wrapper are handed byte-identical strings for any given pan (the actual
 * "lockstep" proof). `undefined` at rest `(0, 0)` so neither mount point ever
 * carries a no-op `transform: translate(0px, 0px)` — keeps every pre-pan
 * pixel-position snapshot (the full 27x suite, pinned at pan=0) byte-identical
 * to its pre-this-feature output.
 */
export function panTransformValue(pan: RootPan): string | undefined {
  if (pan.x === 0 && pan.y === 0 && pan.zoom === 1) return undefined;
  if (pan.zoom === 1) return `translate(${pan.x}px, ${pan.y}px)`;
  if (pan.x === 0 && pan.y === 0) return `scale(${pan.zoom})`;
  return `translate(${pan.x}px, ${pan.y}px) scale(${pan.zoom})`;
}

/** Test-only reset (mirrors `eyedropper-session.ts`'s/`world-session-
 *  state.ts`'s identical helpers) — drops pan + every subscriber so unit
 *  tests don't leak state across cases. */
export function _resetRootPanStateForTest(): void {
  _pan = ZERO_PAN;
  listeners.clear();
}
