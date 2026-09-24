/**
 * STILL-STAGE PRESENTATION for design-time Pixi mounts — the two pieces the
 * canvas design layer (`canvas-design-mount.ts`) and the isolated screen mount
 * (`mount-isolated-pixi-screen.ts`) each spelled for themselves (owner-directed
 * overlap audit, 2026-08-22): framing authored bounds into the Scene camera,
 * and preparing a camera-presented frame for capture on a hidden tab.
 *
 * Both mounts share one presentation model: the stage is STILL (no ticker —
 * Edit's paused clock), the editor camera owns pan/zoom, and a capture must
 * see the exact camera-presented frame rather than a raw-stage extraction.
 * What stays per-mount is the render itself (whose renderer, whose stage,
 * whose camera pose) — handed in as `renderScene`.
 */

import { registerPresentedCanvasFrame } from '@volter/editor-core/canvas-preview-frames';
import type { RootViewController } from '@volter/editor-core/authoring/world-pan-state';

/**
 * Frame authored world bounds in the independent Scene camera. Unlike an
 * asset/UI preview, a scene editor may magnify small subjects: zoom is an
 * inspection tool, not a claim about the runtime's pixel scale. `false` when
 * the pane or the bounds are too small to frame yet (a sub-2px pane is a
 * dock mid-layout, not a viewport).
 */
export function fitSceneView(
  layer: HTMLElement,
  bounds: { x: number; y: number; width: number; height: number },
  view: RootViewController,
  /** A floor on the zoom the fit may choose — the OPENING fit passes the zoom
   *  that frames the game's declared resolution, so a world whose floor dwarfs
   *  its actors still opens at the scale the player sees (see the mount). */
  minZoom = 0.1,
): boolean {
  const rect = layer.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  if (!(bounds.width > 0) || !(bounds.height > 0)) return false;
  const zoom = Math.min(
    4,
    Math.max(
      minZoom,
      Math.min((rect.width - 96) / bounds.width, (rect.height - 96) / bounds.height),
    ),
  );
  view.setView(
    rect.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    rect.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  );
  return true;
}

/**
 * A hidden editor tab has no rAF, but capture is still a first-class reader of
 * the authoring surface. Register a presenter that prepares the exact
 * camera-presented frame at that boundary instead of falling back to raw-stage
 * extraction: `renderScene` is retried across event-loop turns because the
 * first frames of a mount can race layout (`false` = not renderable yet).
 * Returns the unregister function.
 */
export function registerStillFramePresenter(
  canvas: HTMLCanvasElement,
  renderScene: () => boolean,
): () => void {
  return registerPresentedCanvasFrame(canvas, async () => {
    for (let turn = 0; turn < 24; turn++) {
      if (renderScene()) return null;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return null;
  });
}
