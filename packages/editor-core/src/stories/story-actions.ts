/**
 * OPEN STORY — one palette action per composed portable story.
 *
 * A LIVE SET (`@volter/editor-sdk/chrome`): `actions` is read whenever the
 * palette lists, and `subscribe` re-lists it when the project's story modules
 * compose. That is why it is a chrome registration rather than a line in
 * `action-registry.ts`'s static table — the set changes after the palette's
 * first read, and the registry is the one door that re-lists.
 *
 * EMPTY WHEN NOTHING CAN OPEN ONE: a palette entry that does nothing is worse
 * than no entry, and a product with no surface package registers no story
 * document under either medium's address.
 */

import type { ActionContribution } from '@volter/editor-sdk/chrome';
import { editorHost } from '@volter/editor-sdk/host';
import { hasDocumentOpener } from '@volter/editor-sdk/kit/document-open-registry';
import {
  ISOLATED_STORY_DOCUMENT_OPENER,
  THREE_STORY_DOCUMENT_OPENER,
} from '@volter/editor-sdk/kit/story-document-openers';
import { STORY_DOCUMENT_OPENER } from './story-opener';
import { getProjectStoryModules, subscribeProjectStoryModules } from './story-registry';

export const storyPaletteActions: ActionContribution = {
  actions: () => {
    if (
      !hasDocumentOpener(ISOLATED_STORY_DOCUMENT_OPENER) &&
      !hasDocumentOpener(THREE_STORY_DOCUMENT_OPENER)
    ) {
      return [];
    }
    const out: { id: string; label: string; execute: () => void }[] = [];
    for (const module_ of getProjectStoryModules()) {
      if (!module_.ok) continue;
      const moduleName = module_.modulePath.split('/').pop() ?? module_.modulePath;
      for (const story of module_.stories) {
        out.push({
          id: `story:${story.id}`,
          label: `Open Story: ${story.name} — ${moduleName}`,
          execute: () =>
            void editorHost().workspace.open({
              kind: STORY_DOCUMENT_OPENER,
              modulePath: module_.modulePath,
              storyName: story.name,
              title: story.name,
            }),
        });
      }
    }
    return out;
  },
  subscribe: (listener) => subscribeProjectStoryModules(listener),
};
