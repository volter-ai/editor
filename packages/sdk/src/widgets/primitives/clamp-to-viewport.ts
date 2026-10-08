/**
 * Shared clamp-to-viewport positioning (P6 glass-native chrome, U6.5 F5/F11).
 *
 * A popup/panel that anchors to a pointer position (a right-click context menu)
 * or otherwise sets its own absolute/fixed `top`/`left` can open partly — or
 * entirely — off the visible window when the anchor sits near an edge. This
 * utility takes the *desired* rect (position + measured size) and returns a
 * shifted `{ top, left }` that keeps the whole rect inside the window: it never
 * resizes, only slides the popup so
 *
 *   top ≥ margin, bottom ≤ innerHeight − margin,
 *   left ≥ margin, right ≤ innerWidth − margin.
 *
 * If the rect is larger than the viewport on an axis the leading edge wins
 * (the popup pins to `margin` and lets the far edge overflow) so the anchor /
 * first items stay reachable rather than the popup vanishing upward or left.
 *
 * Keep this the single home for the clamp — do not re-derive the arithmetic at
 * each call site.
 */
export interface ClampDesiredRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface ClampedPoint {
  readonly top: number;
  readonly left: number;
}

export function clampRectToViewport(desired: ClampDesiredRect, margin = 8): ClampedPoint {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  // Math.max(margin, …) guards the case where the popup is wider/taller than the
  // window: the upper bound collapses to `margin`, pinning the leading edge.
  const maxLeft = Math.max(margin, viewportWidth - desired.width - margin);
  const maxTop = Math.max(margin, viewportHeight - desired.height - margin);
  return {
    left: Math.min(Math.max(desired.left, margin), maxLeft),
    top: Math.min(Math.max(desired.top, margin), maxTop),
  };
}
