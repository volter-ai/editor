/**
 * "COMPONENTS WITH A REGISTERED PREVIEW STORY" — this package's filler for the
 * host's Content scope (`@editor/content-entry-source-registry`).
 *
 * A registered portable story is the explicit prefab declaration and its
 * preview authority: source shape alone cannot distinguish a reusable prefab
 * from scene composition or implementation detail, so a component with no
 * colocated story is not a Content entry at all. That rule used to be spelled
 * in `components/AssetBrowser.tsx` — the host's own Content browser knowing
 * what CSF is — and it is the reason the story registry, and through it
 * Storybook, was in every editor boot.
 *
 * WHAT MOVED WITH IT, verbatim:
 *  - the admission rule (`pickComponentPreviewStory`, and the surface focus:
 *    DOM stories live on their design board, world prefabs stay scoped to the
 *    surface that can consume them);
 *  - the picture (`StoryComponentThumbnail`);
 *  - the open verb — a `three` prefab mounts as an `Object3D`, so it opens as
 *    its TURNTABLE (`story:three`, the same document the `3D Components`
 *    board's exhibits open on); anything else opens on the isolated story
 *    document (`story:isolated`). Both are ADDRESSES
 *    (`@editor/document-open-registry`): the documents themselves are
 *    `@vgai/game`'s, and a build without it opens neither.
 */

import type {
  ContentComponentRef,
  ContentEntry,
  ContentEntrySource,
  ContentEntrySourceContext,
  ContentEntryThumbnailProps,
} from '../content-entry-source-registry';
import { openRegisteredDocument } from '../document-open-registry';
import type { WorkspaceStateStore } from '../workspace-document-restore';
import { StoryComponentThumbnail } from './StoryComponentThumbnail';
import {
  ISOLATED_STORY_DOCUMENT_OPENER,
  THREE_STORY_DOCUMENT_OPENER,
} from './story-document-openers';
import {
  getProjectStoryModules,
  type ProjectPreviewStory,
  pickComponentPreviewStory,
  subscribeProjectStoryModules,
} from './story-registry';

/** What this source carries on each row: the story that admitted the
 *  component, which is also its picture and its open address. */
type StoryContentDetail = ProjectPreviewStory;

function belongsInFocusedContent(
  component: ContentComponentRef,
  surface: ContentEntrySourceContext['surface'],
): boolean {
  if (component.surface === 'dom') return false;
  return surface === null || component.surface === surface;
}

function StoryContentThumbnail({
  entry,
  previewRevision,
  width,
  height,
}: ContentEntryThumbnailProps) {
  const story = entry.detail as StoryContentDetail;
  return (
    <StoryComponentThumbnail
      component={entry.component}
      story={story}
      previewRevision={previewRevision}
      {...(width === undefined ? {} : { width })}
      {...(height === undefined ? {} : { height })}
    />
  );
}

export const STORY_CONTENT_SOURCE_ID = 'story';

export const storyComponentContentSource: ContentEntrySource = {
  id: STORY_CONTENT_SOURCE_ID,
  owner: './component-content-source',
  entries(context): readonly ContentEntry[] {
    const modules = getProjectStoryModules();
    const out: ContentEntry[] = [];
    for (const component of context.components) {
      if (!belongsInFocusedContent(component, context.surface)) continue;
      const story = pickComponentPreviewStory(modules, component.name, component.path);
      if (!story) continue;
      out.push({ id: `${component.path}:${component.name}`, component, detail: story });
    }
    return out;
  },
  subscribe: subscribeProjectStoryModules,
  Thumbnail: StoryContentThumbnail,
  open(store: WorkspaceStateStore, entry: ContentEntry, title: string): void {
    const story = entry.detail as StoryContentDetail;
    const three = entry.component.surface === 'three';
    openRegisteredDocument(
      three ? THREE_STORY_DOCUMENT_OPENER : ISOLATED_STORY_DOCUMENT_OPENER,
      store,
      three
        ? { modulePath: story.modulePath, storyName: story.name, title }
        : { modulePath: story.modulePath, storyName: story.name },
    );
  },
};
