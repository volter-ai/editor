/**
 * The CENTER (viewport) group's live rect in dock-root-local coordinates.
 * The workspace host is the sole writer because the frame owns this geometry —
 * Consumers are
 * overlays that belong to the VIEWPORT rather than the whole workspace
 * (the compact inspector card clamps itself inside this rect), without
 * measuring the layout themselves.
 */

export interface WorkspaceViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

let rect: WorkspaceViewportRect | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function workspaceViewportRect(): WorkspaceViewportRect | null {
  return rect;
}

export function workspaceViewportRectVersion(): number {
  return version;
}

export function subscribeWorkspaceViewportRect(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setWorkspaceViewportRect(next: WorkspaceViewportRect | null): void {
  const same =
    rect === next ||
    (rect !== null &&
      next !== null &&
      rect.x === next.x &&
      rect.y === next.y &&
      rect.width === next.width &&
      rect.height === next.height);
  if (same) return;
  rect = next;
  version += 1;
  for (const listener of listeners) listener();
}

// ---- Viewport-owned overlay placement (pure — headlessly testable) --------

/** Offsets of an overlay's bottom-right corner from the VIEWPORT's
 *  bottom-right corner. Bottom-right anchoring keeps a corner-hugging
 *  overlay hugging its corner under viewport resizes, wherever it was
 *  dragged. */
export interface ViewportOverlayAnchor {
  readonly right: number;
  readonly bottom: number;
}

export interface ViewportOverlaySizing {
  readonly maxWidth: number;
  readonly maxHeight: number;
  /** Floor when the viewport is too small for the full size. */
  readonly minSize: number;
  /** Breathing room kept between the overlay and every viewport edge. */
  readonly margin: number;
}

/** The overlay's size and top-left for a given anchor, clamped fully inside
 *  the viewport (pinned toward the top-left edge when the viewport is
 *  smaller than the overlay + margins). */
export function resolveViewportOverlayPlacement(
  viewport: WorkspaceViewportRect,
  sizing: ViewportOverlaySizing,
  anchor: ViewportOverlayAnchor,
): { left: number; top: number; width: number; height: number } {
  const width = Math.min(
    sizing.maxWidth,
    Math.max(sizing.minSize, viewport.width - sizing.margin * 2),
  );
  const height = Math.min(
    sizing.maxHeight,
    Math.max(sizing.minSize, viewport.height - sizing.margin * 2),
  );
  const minLeft = viewport.x + sizing.margin;
  const maxLeft = viewport.x + viewport.width - width - sizing.margin;
  const minTop = viewport.y + sizing.margin;
  const maxTop = viewport.y + viewport.height - height - sizing.margin;
  const left = viewport.x + viewport.width - anchor.right - width;
  const top = viewport.y + viewport.height - anchor.bottom - height;
  return {
    width,
    height,
    left: Math.min(Math.max(left, minLeft), Math.max(maxLeft, minLeft)),
    top: Math.min(Math.max(top, minTop), Math.max(maxTop, minTop)),
  };
}
