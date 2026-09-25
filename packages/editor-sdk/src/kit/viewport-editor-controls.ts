/**
 * The viewport's editor-owned direct-manipulation controls (constraint target/pole effectors),
 * for the full-cover selection overlay: it owns pointer events over the project viewport, so it
 * forwards them through this narrow seam instead of duplicating the viewport's raycasting or
 * constraint semantics. The Three viewport publishes them with its pick context; the overlay
 * reads them here and names no viewport.
 */
export interface ViewportEditorControls {
  activate(clientX: number, clientY: number): boolean;
  hover(clientX: number, clientY: number): 'pointer' | 'not-allowed' | null;
  clearHover(): void;
}

let current: ViewportEditorControls | null = null;

export function setViewportEditorControls(controls: ViewportEditorControls | null): void {
  current = controls;
}

export function viewportEditorControls(): ViewportEditorControls | null {
  return current;
}
