/**
 * The story thumbnail captures this editor's media provide
 * (`@volter/editor-sdk/kit/story-thumbnails`): a three.js prefab story in an
 * offscreen R3F stage, a canvas story in an offscreen Pixi application. Each
 * loads its renderer on the first capture.
 */
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
  return () => {
    stopThree();
    stopCanvas();
  };
}
