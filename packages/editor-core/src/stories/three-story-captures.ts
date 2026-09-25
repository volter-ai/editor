/**
 * The three.js story thumbnail capture (`@volter/editor-sdk/kit/story-thumbnails`): a prefab
 * story in an offscreen R3F stage. Loads its renderer on first use.
 */
import { registerStoryThumbnailCapture, StoryMediumMismatch } from '@volter/editor-sdk/kit/story-thumbnails';

/** The three.js leg needs WebGL; jsdom (the component tests) has none. */
function supportsThreeCapture(): boolean {
  return (
    typeof WebGLRenderingContext !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !navigator.userAgent.toLowerCase().includes('jsdom')
  );
}

export function registerThreeStoryCapture(): () => void {
  return supportsThreeCapture()
    ? registerStoryThumbnailCapture('three', async (component, options) => {
        const preview = await import('./story-three-preview');
        try {
          return await preview.captureStoryComponentThumbnail(
            component as Parameters<typeof preview.captureStoryComponentThumbnail>[0],
            options,
          );
        } catch (error) {
          // The reconciler's qualification rejection of a DOM story is a
          // classification, not a failure: the caller tries its next leg.
          if (preview.isStoryThreeClassificationRefusal(error)) {
            throw new StoryMediumMismatch('This story is not a three.js story.');
          }
          throw error;
        }
      })
    : () => {};
}
