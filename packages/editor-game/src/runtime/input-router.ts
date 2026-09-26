/**
 * The delegating input router (D5 §2a) —
 * `createGameRuntime`'s roots path (T6.1 slice 1) uses this to route
 * pointer input across N stacked world canvases with exactly ONE root
 * listener.
 *
 * Split into two layers so the decision logic is unit-testable with plain
 * fake roots — no real DOM/canvas needed:
 *
 *  - `stackOrder` / `resolveClaimingRoot`: pure functions over
 *    `{id, zOrder, hitTest?}` — "who claims this point". They live in
 *    `adapter/root-stacking.ts`, because the EDITOR asks the same question
 *    at design time with no game running and may not import the runtime.
 *  - `applyPointerEventsStacking` / `createInputRouter`: this file, the DOM wiring —
 *    sets `pointer-events` CSS per D5 §2a and forwards a claimed event to
 *    the claiming world's own canvas.
 *
 * Per-event fall-through (D5 §2b — the sanctioned mechanism for an
 * authoring surface's own interior drag affordances, e.g. a canvas
 * editor's gizmos) is explicitly NOT this file's job — it stays inside
 * whatever authoring surface needs it.
 */

import {
  type ClaimEntry,
  resolveClaimingRoot,
  stackOrder,
} from '@volter/editor-project/adapter/root-stacking';

/** The DOM-wiring inputs — one real canvas per world. */
export interface RouterAdapterRoot extends ClaimEntry {
  readonly canvas: HTMLCanvasElement;
}

/**
 * Sets `canvas.style.pointerEvents` per D5 §1/§2a: the bottom (lowest
 * zOrder) world's canvas is `'auto'` (real user input DOM-hit-tests it by
 * default); every canvas above it is `'none'` (real user input never
 * DOM-hit-tests it — the router's JS-level `hitTest` is what still lets it
 * claim a point via `createInputRouter`'s forwarding).
 */
export function applyPointerEventsStacking(entries: readonly RouterAdapterRoot[]): void {
  const order = stackOrder(entries);
  order.forEach((entry, i) => {
    entry.canvas.style.pointerEvents = i === 0 ? 'auto' : 'none';
  });
}

const ROUTED_EVENT_TYPES = ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel'] as const;

/** Common pointer/mouse/wheel event fields this router knows how to carry
 *  over when forwarding a claimed event to a different canvas (see
 *  `forwardEvent` below) — not an exhaustive Event surface, just the fields
 *  games/libraries actually read for hit-testing and input state. */
function pickEventInit(original: Event): Record<string, unknown> {
  const src = original as unknown as Record<string, unknown>;
  const keys = [
    'clientX',
    'clientY',
    'screenX',
    'screenY',
    'offsetX',
    'offsetY',
    'button',
    'buttons',
    'ctrlKey',
    'altKey',
    'shiftKey',
    'metaKey',
    'pointerId',
    'pointerType',
    'pressure',
    'isPrimary',
    'deltaX',
    'deltaY',
    'deltaZ',
    'deltaMode',
  ];
  const init: Record<string, unknown> = { bubbles: false, cancelable: true, composed: true };
  for (const key of keys) if (key in src) init[key] = src[key];
  return init;
}

/**
 * Forward `original` onto `canvas` as a NEW, non-bubbling event of the same
 * event-type family — so a canvas with `pointer-events:none` (never a
 * native DOM hit-test target) still receives the interaction its own event
 * pipeline (Pixi's `EventSystem`, a raycast-driven three controller, …)
 * listens for on ITS canvas. `bubbles:false` is deliberate: it stops the
 * clone from re-triggering the container's own capture listener (an
 * infinite loop) — re-dispatching the SAME event object is not an option
 * either (the DOM forbids re-dispatching an event still being dispatched).
 *
 * Best-effort: environments with no `PointerEvent`/`MouseEvent`/
 * `WheelEvent` global (Node unit tests) skip forwarding silently — those
 * tests exercise the pure claim-resolution logic above instead, which needs
 * no real `Event` objects at all.
 */
function forwardEvent(canvas: HTMLCanvasElement, original: Event): void {
  const g = globalThis as unknown as {
    PointerEvent?: new (type: string, init?: unknown) => Event;
    MouseEvent?: new (type: string, init?: unknown) => Event;
    WheelEvent?: new (type: string, init?: unknown) => Event;
  };
  const Ctor =
    original.type === 'wheel'
      ? g.WheelEvent
      : original.type.startsWith('pointer')
        ? g.PointerEvent
        : (g.MouseEvent ?? g.PointerEvent);
  if (!Ctor || typeof canvas.dispatchEvent !== 'function') return;
  try {
    canvas.dispatchEvent(new Ctor(original.type, pickEventInit(original)));
  } catch {
    // Best-effort forwarding — a construction failure here must never break
    // the (already-delivered) original event's own handling.
  }
}

export interface InputRouterHandle {
  /** Resolve which world claims a container-relative point right now — the
   *  pure decision, exposed for callers/tests that don't want to simulate a
   *  real DOM event. */
  resolveClaim(x: number, y: number): string | null;
  /** Detach the container listener(s). Idempotent. */
  dispose(): void;
}

/**
 * Wire the delegating router onto `container` for `entries` (D5 §2a): apply
 * the pointer-events stacking, then attach ONE capture-phase listener per
 * routed event type that resolves the claiming world and forwards the event
 * to ITS canvas when that world isn't already the natural DOM target (the
 * bottom world, whose canvas is the only one with `pointer-events:auto`).
 */
export function createInputRouter(
  container: HTMLElement,
  entries: readonly RouterAdapterRoot[],
): InputRouterHandle {
  applyPointerEventsStacking(entries);
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const bottomId = stackOrder(entries)[0]?.id;

  const handler = (evt: Event) => {
    const rect = container.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const clientX = (evt as unknown as { clientX?: number }).clientX ?? 0;
    const clientY = (evt as unknown as { clientY?: number }).clientY ?? 0;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const claimant = resolveClaimingRoot(entries, x, y);
    if (claimant && claimant !== bottomId) {
      const entry = byId.get(claimant);
      if (entry) forwardEvent(entry.canvas, evt);
    }
  };

  for (const type of ROUTED_EVENT_TYPES) {
    container.addEventListener?.(type, handler, true);
  }

  return {
    resolveClaim: (x, y) => resolveClaimingRoot(entries, x, y),
    dispose() {
      for (const type of ROUTED_EVENT_TYPES) {
        container.removeEventListener?.(type, handler, true);
      }
    },
  };
}
