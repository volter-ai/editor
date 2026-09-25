/**
 * The captures this editor's media provide: story thumbnails
 * (`@volter/editor-sdk/kit/story-thumbnails`) — a three.js prefab story in an
 * offscreen R3F stage, a canvas story in an offscreen Pixi application — and
 * Pixi's same-frame canvas pixels (`@volter/editor-sdk/kit/canvas-frames`), for
 * the canvases its live surfaces present and the ones a photographed mount
 * creates. Each loads its renderer on first use.
 */
import {
  type CanvasFrame,
  registerCanvasFrameSource,
  registerCanvasMountObserver,
} from '@volter/editor-sdk/kit/canvas-frames';
import { registerStoryThumbnailCapture } from '@volter/editor-sdk/kit/story-thumbnails';

export function registerStoryMediaCaptures(): () => void {
  const stopThree = registerStoryThumbnailCapture('three', async (component, options) => {
    const { captureStoryComponentThumbnail } = await import('./story-three-preview');
    return captureStoryComponentThumbnail(
      component as Parameters<typeof captureStoryComponentThumbnail>[0],
      options,
    );
  });
  const stopCanvas = registerStoryThumbnailCapture('canvas', async (component, options) => {
    const { capturePixiStoryThumbnail } = await import('./story-pixi-preview');
    return capturePixiStoryThumbnail(component as Parameters<typeof capturePixiStoryThumbnail>[0], options);
  });
  const stopFrames = registerCanvasFrameSource(async (canvas) =>
    (await import('../canvas-preview-frames')).presentedPixiFrame(canvas),
  );
  // Every `Application` a photographed mount creates is collected, so the two
  // things a Pixi canvas's capture needs — a settled first frame, and a readback
  // the compositor cannot clear — are keyed on the MOUNT
  // (`canvas-preview-frames.ts` owns both, with the measurement).
  const stopObserver = registerCanvasMountObserver({
    observe: async (task) => {
      const { pixiCanvasFrame, withApplicationCollector } = await import('../canvas-preview-frames');
      const { awaitPixiStoryFrame } = await import('./story-pixi-preview');
      let apps: Parameters<typeof awaitPixiStoryFrame>[0] = [];
      const result = await withApplicationCollector(async (created) => {
        apps = created;
        return task();
      });
      const frame: CanvasFrame = pixiCanvasFrame(apps);
      return { result, settled: () => awaitPixiStoryFrame(apps), frame };
    },
  });
  return () => {
    stopThree();
    stopCanvas();
    stopFrames();
    stopObserver();
  };
}
