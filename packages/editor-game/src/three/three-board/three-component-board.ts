/**
 * THE `3D` BOARD's registration — one medium's answer to
 * `@editor/component-board-registry`.
 *
 * The board ITSELF is still `@editor/three-board/*`: it is loaded lazily here
 * for the reason the 2D board always was, and moves house in this unit's
 * second half. What lives here is the part that was never the host's — which
 * medium this is a board of, whether this project has one, and what to say
 * when it does not.
 */

import { commandLine } from '@volter/editor-sdk/kit/product-command';
import type { ComponentBoard, ComponentBoardContext } from '@volter/editor-core/component-board-registry';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import {
  getStoryMediaPresence,
  subscribeStoryMediaPresence,
} from '../../host/stories/story-media-presence';
import { projectStoriesReady, subscribeProjectStoryModules } from '@volter/editor-core/stories/story-registry';
import { THREE_COMPONENTS_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';

/** The tab reads `3D`, the peer of `Scene` and `UI` in the center strip. */
const THREE_COMPONENTS_TITLE = '3D';

export const threeComponentBoard: ComponentBoard = {
  medium: 'three',
  owner: '@volter/editor-game/three-board',
  documentId: THREE_COMPONENTS_DOCUMENT_ID,
  title: THREE_COMPONENTS_TITLE,
  // A board exists because the project has STORIES of its medium, and for no
  // other reason (owner ruling, 2026-08-15): a three root with no three story
  // has nothing to lay out. `null` while discovery has not published — an
  // empty UNREADY registry is boot in flight, never a verdict.
  presence: () =>
    !projectStoriesReady() ? null : getStoryMediaPresence().three ? 'present' : 'absent',
  subscribe: (listener) => {
    const stopPresence = subscribeStoryMediaPresence(listener);
    const stopRegistry = subscribeProjectStoryModules(listener);
    return () => {
      stopPresence();
      stopRegistry();
    };
  },
  install: async ({ store }: ComponentBoardContext) => {
    try {
      const { installThreeBoardDocument } = await import('./ThreeBoardDocument');
      installThreeBoardDocument(store.shell);
    } catch (error: unknown) {
      editorConsole.error(
        `Failed to load the ${THREE_COMPONENTS_TITLE} board: ${String(error)}`,
        'scene',
      );
      throw error;
    }
  },
  absentReason: () =>
    `This project has no ${THREE_COMPONENTS_TITLE} board (${THREE_COMPONENTS_DOCUMENT_ID}): ` +
    "board presence keys on STORIES, not on roots, and none of this project's stories declares " +
    'the "three" medium. Declare it — a manifest root entry naming the story\'s module, or a ' +
    `\`vgai.adapter.ts\` regionInclude that covers it — and the board appears. ${commandLine('console')} ` +
    'names every story it could not place.',
};
