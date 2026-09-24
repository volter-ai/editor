/**
 * THE `UI` BOARD's registration — the dom medium's answer to
 * `@editor/component-board-registry` (WORK.md §The open-source launch item
 * 18a).
 *
 * It was one arm of a literal table of three media inside
 * `@editor/components/world-documents.tsx`, which the host reconciled against
 * a CSF census it imported itself. What is dom-specific about it — that its
 * medium is `dom`, that the board exists because this project has `dom`
 * stories, and what a human should be told when it does not — lives here; the
 * document it installs is `ui-board-document.tsx`, loaded only for a project
 * whose verdict is `'present'`.
 */

import { commandLine } from '@volter/editor-sdk/kit/product-command';
import type { ComponentBoard, ComponentBoardContext } from '@volter/editor-core/component-board-registry';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import {
  getStoryMediaPresence,
  subscribeStoryMediaPresence,
} from '../host/stories/story-media-presence';
import { projectStoriesReady, subscribeProjectStoryModules } from '@volter/editor-core/stories/story-registry';
import { UI_COMPONENTS_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import { UI_COMPONENTS_TITLE } from './ui-board-title';

export const uiComponentBoard: ComponentBoard = {
  medium: 'dom',
  owner: '@volter/editor-game/react/ui-board',
  documentId: UI_COMPONENTS_DOCUMENT_ID,
  title: UI_COMPONENTS_TITLE,
  // A COMPONENT BOARD EXISTS BECAUSE THE PROJECT HAS STORIES OF ITS MEDIUM,
  // and for no other reason (owner ruling, 2026-08-15; ARCHITECTURE-CORE
  // §center-surface ontology). Root kinds are irrelevant: a project whose UI
  // components live inside an ingested game — no `dom` root in its manifest at
  // all — still gets this board the moment one of them declares a story.
  //
  // `null` while discovery has not published: an empty UNREADY registry is
  // boot in flight, never a verdict (`story-registry.ts` says so at the flag
  // itself). That tri-state is what the host used to spell for itself as
  // `projectStoriesReady()` in its own gap thunks.
  presence: () =>
    !projectStoriesReady() ? null : getStoryMediaPresence().dom ? 'present' : 'absent',
  subscribe: (listener) => {
    // Two signals, because the verdict is a function of both: the census
    // (which media the project's stories declare) and the discovery flag that
    // decides whether the census counts yet.
    const stopPresence = subscribeStoryMediaPresence(listener);
    const stopRegistry = subscribeProjectStoryModules(listener);
    return () => {
      stopPresence();
      stopRegistry();
    };
  },
  install: async (context: ComponentBoardContext) => {
    try {
      const { installUiBoard } = await import('./ui-board-document');
      installUiBoard(context);
    } catch (error: unknown) {
      editorConsole.error(
        `Failed to load the ${UI_COMPONENTS_TITLE} board: ${String(error)}`,
        'scene',
      );
      throw error;
    }
  },
  absentReason: () =>
    `This project has no ${UI_COMPONENTS_TITLE} board (${UI_COMPONENTS_DOCUMENT_ID}): board ` +
    "presence keys on STORIES, not on roots, and none of this project's stories declares the " +
    '"dom" medium. Declare it — a manifest root entry naming the story\'s module, or a ' +
    `\`vgai.adapter.ts\` regionInclude that covers it — and the board appears. ${commandLine('console')} ` +
    'names every story it could not place.',
};
