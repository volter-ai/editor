/**
 * THE `2D` BOARD's registration — one medium's answer to
 * `@volter/editor-sdk/kit/component-board-registry`.
 *
 * The board stays behind a dynamic `import()`: the 2D board is the only board
 * whose renderer initializes Pixi,
 * so a project whose census says it has no canvas content never loads it. The
 * asynchronous `install` contract exists for exactly this board.
 */

import type { ComponentBoard } from '@volter/editor-sdk/kit/component-board-registry';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { CANVAS_COMPONENTS_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  getStoryMediaPresence,
  subscribeStoryMediaPresence,
} from '../../host/stories/story-media-presence';
import { projectStoriesReady, subscribeProjectStoryModules } from '@volter/editor-sdk/kit/stories/story-registry';

/** The tab reads `2D`, the peer of `Scene` and `UI` in the center strip. */
const CANVAS_COMPONENTS_TITLE = '2D';

export const canvasComponentBoard: ComponentBoard = {
  medium: 'canvas',
  owner: '@volter/editor-game/canvas/canvas-board',
  documentId: CANVAS_COMPONENTS_DOCUMENT_ID,
  title: CANVAS_COMPONENTS_TITLE,
  presence: () =>
    !projectStoriesReady() ? null : getStoryMediaPresence().canvas ? 'present' : 'absent',
  subscribe: (listener) => {
    const stopPresence = subscribeStoryMediaPresence(listener);
    const stopRegistry = subscribeProjectStoryModules(listener);
    return () => {
      stopPresence();
      stopRegistry();
    };
  },
  install: async () => {
    try {
      const { installCanvasBoardDocument } = await import('./CanvasBoardDocument');
      installCanvasBoardDocument();
    } catch (error: unknown) {
      editorConsole.error(
        `Failed to load the ${CANVAS_COMPONENTS_TITLE} board: ${String(error)}`,
        'scene',
      );
      throw error;
    }
  },
  absentReason: () =>
    `This project has no ${CANVAS_COMPONENTS_TITLE} board (${CANVAS_COMPONENTS_DOCUMENT_ID}): ` +
    "board presence keys on STORIES, not on roots, and none of this project's stories declares " +
    'the "canvas" medium. Declare it — a manifest root entry naming the story\'s module, or a ' +
    '`vgai.adapter.ts` regionInclude that covers it — and the board appears. `vgai console` ' +
    'names every story it could not place.',
};
