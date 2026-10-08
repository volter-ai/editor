/** Session-only responsive canvas size for DOM-backed authoring roots. */
export interface RootCanvasViewport {
  readonly width: number | null;
  readonly height: number | null;
}

const FILL_VIEWPORT: RootCanvasViewport = { width: null, height: null };
let viewport: RootCanvasViewport = FILL_VIEWPORT;
const listeners = new Set<() => void>();

export function getRootCanvasViewport(): RootCanvasViewport {
  return viewport;
}

export function setRootCanvasViewport(width: number | null, height: number | null): void {
  const nextWidth = width === null ? null : Math.max(1, Math.round(width));
  const nextHeight = height === null ? null : Math.max(1, Math.round(height));
  if (viewport.width === nextWidth && viewport.height === nextHeight) return;
  viewport = { width: nextWidth, height: nextHeight };
  for (const listener of listeners) listener();
}

export function resetRootCanvasViewport(): void {
  setRootCanvasViewport(null, null);
}

export function subscribeRootCanvasViewport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function _resetRootCanvasViewportForTest(): void {
  viewport = FILL_VIEWPORT;
  listeners.clear();
}
