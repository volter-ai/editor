import { type RootPan, type RootViewController, sharedRootViewController } from '@volter/editor-sdk/kit/world-pan-state';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_SENSITIVITY = 0.002;
const SECONDARY_DRAG_THRESHOLD_PX = 4;

export interface ReactCanvasWheelInput {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
}

function deltaPixels(delta: number, mode: number, pageSize: number): number {
  if (mode === 1) return delta * 16; // WheelEvent.DOM_DELTA_LINE
  if (mode === 2) return delta * pageSize; // WheelEvent.DOM_DELTA_PAGE
  return delta;
}

/** Resolve one component-board wheel gesture without touching global state. */
export function resolveReactCanvasWheel(view: RootPan, input: ReactCanvasWheelInput): RootPan {
  let deltaX = deltaPixels(input.deltaX, input.deltaMode, input.bounds.width);
  let deltaY = deltaPixels(input.deltaY, input.deltaMode, input.bounds.height);

  if (input.ctrlKey || input.metaKey) {
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, view.zoom * Math.exp(-deltaY * ZOOM_SENSITIVITY)),
    );
    const pointerX = input.clientX - input.bounds.left;
    const pointerY = input.clientY - input.bounds.top;
    const worldX = (pointerX - view.x) / view.zoom;
    const worldY = (pointerY - view.y) / view.zoom;
    return {
      x: pointerX - worldX * zoom,
      y: pointerY - worldY * zoom,
      zoom,
    };
  }

  // Figma treats a shifted vertical mouse wheel as horizontal movement.
  // Trackpads already provide deltaX, so preserve that richer input.
  if (input.shiftKey && deltaX === 0) {
    deltaX = deltaY;
    deltaY = 0;
  }
  return { x: view.x - deltaX, y: view.y - deltaY, zoom: view.zoom };
}

/** Resolve the wheel gesture for a native 2D Scene. Like the Three Scene and
 * Godot's 2D workspace, the wheel changes the spatial camera's zoom around
 * the cursor; panning belongs to middle-drag, right-drag, or Space-drag. This is
 * intentionally different from the component board above, where a wheel pans
 * the layout and a modifier-wheel zooms it. */
export function resolveCanvasSceneWheel(view: RootPan, input: ReactCanvasWheelInput): RootPan {
  const deltaY = deltaPixels(input.deltaY, input.deltaMode, input.bounds.height);
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, view.zoom * Math.exp(-deltaY * ZOOM_SENSITIVITY)),
  );
  const pointerX = input.clientX - input.bounds.left;
  const pointerY = input.clientY - input.bounds.top;
  const worldX = (pointerX - view.x) / view.zoom;
  const worldY = (pointerY - view.y) / view.zoom;
  return {
    x: pointerX - worldX * zoom,
    y: pointerY - worldY * zoom,
    zoom,
  };
}

function isNavigationChrome(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-vgai-canvas-navigation-ignore="true"]') !== null
  );
}

/**
 * Install viewport-sized navigation for a React design canvas. This stays on
 * the untransformed document container, unlike authoring chrome that follows
 * the world transform, so navigation remains available after fit/zoom.
 */
function installCanvasNavigation(
  container: HTMLElement,
  view: RootViewController,
  resolveWheel: (view: RootPan, input: ReactCanvasWheelInput) => RootPan,
  options: { readonly rightDragPans?: boolean } = {},
): () => void {
  let drag: {
    readonly pointerId: number;
    readonly button: 1 | 2;
    readonly startClientX: number;
    readonly startClientY: number;
    readonly startPan: RootPan;
    moved: boolean;
  } | null = null;
  let suppressNextContextMenu = false;
  let previousInteractionCursor = '';

  const interactionLayer = (): HTMLElement | null =>
    container.querySelector<HTMLElement>('[data-testid="world-selection-overlay-interaction"]');

  const setDraggingAppearance = (dragging: boolean): void => {
    container.dataset['canvasPanning'] = dragging ? 'true' : 'false';
    container.style.cursor = dragging ? 'grabbing' : '';
    const interaction = interactionLayer();
    if (!interaction) return;
    if (dragging) {
      previousInteractionCursor = interaction.style.cursor;
      interaction.style.cursor = 'grabbing';
    } else {
      interaction.style.cursor = previousInteractionCursor;
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // PointerEvent's button mask is platform-independent: 4 is middle, 2 is
    // secondary/right. Windows can drop pointerup around native auto-scroll
    // or a window boundary, so stop as soon as the active bit disappears.
    const pressedButtonMask = drag.button === 1 ? 4 : 2;
    if ((event.buttons & pressedButtonMask) === 0) {
      endDrag(event);
      return;
    }
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!drag.moved) {
      if (Math.hypot(deltaX, deltaY) <= SECONDARY_DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDraggingAppearance(true);
    }
    view.setPan(drag.startPan.x + deltaX, drag.startPan.y + deltaY);
  };

  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pointerId = drag.pointerId;
    if (drag.button === 2 && drag.moved) suppressNextContextMenu = true;
    drag = null;
    setDraggingAppearance(false);
    if (container.hasPointerCapture?.(pointerId)) container.releasePointerCapture(pointerId);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const isMiddleButton = event.button === 1;
    const isRightButton = options.rightDragPans === true && event.button === 2;
    if ((!isMiddleButton && !isRightButton) || isNavigationChrome(event.target)) return;
    if (isRightButton) suppressNextContextMenu = false;
    event.preventDefault();
    // A secondary press is shared with the selection overlay: navigation owns
    // movement, while the overlay owns the stationary overlap menu. Let that
    // one event continue so both can measure the same press; middle drag is
    // unambiguous and remains navigation-only.
    if (isMiddleButton) event.stopPropagation();
    drag = {
      pointerId: event.pointerId,
      button: event.button as 1 | 2,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: view.get(),
      // Middle-drag is unambiguous and retains its immediate response. A
      // secondary press waits for movement so a stationary secondary click
      // remains the viewport's overlap/context menu.
      moved: isMiddleButton,
    };
    // Pointer capture is the mouse-equivalent of a trackpad's uninterrupted
    // gesture stream: middle-drag keeps panning across child frames and past
    // the viewport edge, including on Windows where window-level move/up
    // delivery is otherwise inconsistent around native auto-scroll.
    container.setPointerCapture?.(event.pointerId);
    setDraggingAppearance(isMiddleButton);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  };

  const onMouseDown = (event: MouseEvent): void => {
    // Prevent Chromium's native middle-button auto-scroll glyph.
    if (event.button === 1 && !isNavigationChrome(event.target)) event.preventDefault();
  };

  const onContextMenu = (event: MouseEvent): void => {
    if (options.rightDragPans !== true) return;
    const activeRightDrag = drag?.button === 2 && drag.moved;
    if (!activeRightDrag && !suppressNextContextMenu) return;
    suppressNextContextMenu = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onWheel = (event: WheelEvent): void => {
    if (isNavigationChrome(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = resolveWheel(view.get(), {
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      bounds: container.getBoundingClientRect(),
    });
    view.setView(next.x, next.y, next.zoom);
  };

  container.addEventListener('pointerdown', onPointerDown, true);
  container.addEventListener('lostpointercapture', endDrag, true);
  container.addEventListener('mousedown', onMouseDown, true);
  container.addEventListener('contextmenu', onContextMenu, true);
  container.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => {
    drag = null;
    setDraggingAppearance(false);
    container.removeEventListener('pointerdown', onPointerDown, true);
    container.removeEventListener('lostpointercapture', endDrag, true);
    container.removeEventListener('mousedown', onMouseDown, true);
    container.removeEventListener('contextmenu', onContextMenu, true);
    container.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  };
}

/** Component-board navigation: wheel pans; modifier-wheel zooms. */
export function installReactCanvasNavigation(
  container: HTMLElement,
  view: RootViewController = sharedRootViewController,
): () => void {
  return installCanvasNavigation(container, view, resolveReactCanvasWheel);
}

/** Native 2D Scene navigation: wheel zooms; middle/right/Space drag pans. */
export function installCanvasSceneNavigation(
  container: HTMLElement,
  view: RootViewController,
): () => void {
  return installCanvasNavigation(container, view, resolveCanvasSceneWheel, {
    rightDragPans: true,
  });
}
