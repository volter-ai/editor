/**
 * The canvas medium's captures, installed at boot (`workspace.service`): story thumbnails for a
 * canvas story in an offscreen Pixi application, and Pixi's same-frame canvas pixels
 * (`src/host/stories/story-media-captures.ts`). They are the game's, because Pixi is.
 */
import { registerStoryMediaCaptures } from '../src/host/stories/story-media-captures';

export const point = 'workspace.service';

export function start(): () => void {
  return registerStoryMediaCaptures();
}
