/**
 * ONE `canvasFrame` seam (`composite-screenshot.ts`), for every pixel door.
 *
 * ## Why this exists
 *
 * A canvas is only `drawImage`-able after its frame when its WebGL context was
 * created with `preserveDrawingBuffer: true`. Every canvas the vgai RUNTIME
 * mounts sets it; a canvas a GAME created is the game's own and almost never
 * does. Two different mechanisms recover those pixels, one per substrate:
 *
 *  - a lane whose render pass owns the canvas (a three ingest) copies the
 *    drawing buffer INSIDE that pass, asked through the live registry
 *    (`LiveSession.snapshotFrame`, `ingest/ingest-frame-snapshot.ts`);
 *  - a Pixi surface re-renders the stage through the renderer's own extractor
 *    ({@link presentedPixiFrame}, `stories/story-pixi-preview.ts`).
 *
 * Both already existed. What did not was a single place that tries both, and
 * that gap was VISIBLE AS A LIE: `command-listener.ts`'s `bridge-screenshot`
 * passed only the three one and `editor-view-presentation.ts`'s
 * `capture-active-document` passed only the Pixi one, so each door photographed
 * one lane correctly and the other one BLANK — and a blank frame is the worst
 * failure a look verb has, because nothing about it says it failed.
 *
 * Composing them is safe by construction: each half answers `null` — the seam's
 * documented "read the canvas directly" — for a canvas it does not own, so a
 * first-party runtime canvas still takes the ordinary path.
 */

import { presentedPixiFrame } from './canvas-preview-frames';
import { snapshotLiveFrame } from './live-session-registry';

/**
 * Same-frame pixels for `canvas`, whichever live surface owns it, or `null`
 * when none does.
 *
 * Order is the cheap test first: the registry's claim is an identity read
 * against the mounted lane's canvas, while the Pixi leg walks the presented
 * set and, on a hit, costs a real render.
 */
export async function liveCanvasFrame(
  canvas: HTMLCanvasElement,
): Promise<CanvasImageSource | null> {
  const live = snapshotLiveFrame(canvas);
  if (live) return live;
  return presentedPixiFrame(canvas);
}

/** A `CanvasImageSource` that can be read back as a PNG on its own — what the
 *  canvas-only capture leg needs when it has no compositor to draw into.
 *  Pixi's extractor hands back a real `HTMLCanvasElement`, but the seam's type
 *  is the wider `CanvasImageSource`, so the door asks rather than casts. */
export function readablePngSource(source: CanvasImageSource | null): HTMLCanvasElement | null {
  const candidate = source as HTMLCanvasElement | null;
  return candidate && typeof candidate.toDataURL === 'function' ? candidate : null;
}
