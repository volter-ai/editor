/** Retained canvas bindings for Control's engine-owned drag start and preview operations. */

import { Container } from 'pixi.js';

import { forceControlDrag, setControlDragPreview } from './control-state';

export interface GodotCanvasControlDragApi {
  set_drag_preview(preview: object): void;
  force_drag(data: unknown, preview: object): void;
}

export function bindGodotCanvasControlDragApi<T extends Container>(
  source: T,
): T & GodotCanvasControlDragApi {
  const control = source as T & GodotCanvasControlDragApi;
  Object.defineProperties(control, {
    set_drag_preview: {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (preview: object): void => setControlDragPreview(control, preview),
    },
    force_drag: {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (data: unknown, preview: object): void => forceControlDrag(control, data, preview),
    },
  });
  return control;
}
