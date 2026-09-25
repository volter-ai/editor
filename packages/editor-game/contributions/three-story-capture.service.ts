/**
 * The three.js story thumbnail capture (`@volter/editor-sdk/kit/story-thumbnails`), installed at
 * boot (`workspace.service`): a prefab story renders in an offscreen React Three Fiber stage
 * (`src/host/stories/three-story-captures.ts`). It is the game's, because prefab stories are R3F.
 */
import { registerThreeStoryCapture } from '../src/host/stories/three-story-captures';

export const point = 'workspace.service';

export function start(): () => void {
  return registerThreeStoryCapture();
}
