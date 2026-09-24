/**
 * PORTABLE CSF AS A COMPONENT'S NAMED STATES — the source
 * `component-states-registry.ts` is filled with, registered by
 * `story-lane.ts`.
 *
 * It was `authoring/project-three-stories.ts`, two nearly identical
 * factory functions that three host adapters CONSTRUCTED inside their own
 * constructors. The measurement said the two differed by exactly one thing —
 * which document a state opens in — so this is ONE source that dispatches on
 * the asking adapter's surface, the same way the story opener's own readiness
 * does.
 *
 * IT DOES NOT MOUNT A SECOND PREVIEW DIALECT. Applying a state opens the
 * document that already exists for that surface: the Object3D turntable for a
 * three subject (whose portable Storybook component mounts as an Object3D on
 * the standard Asset Lab viewport), and the ordinary isolated story document
 * for a canvas one (whose renderer can mount `@pixi/react` content). The
 * adapter supplies the component identity; the CSF registry owns
 * discovery and association.
 *
 * A `dom` subject is deliberately not an arm: a React world's own states come
 * from `@vgai/dom`'s adapter, which publishes its own `StoriesProvider`
 * against the board it mounts. This source answers for the two surfaces whose
 * adapters used to construct the CSF provider by hand.
 */

import type {
  ComponentStatesContext,
  ComponentStatesRef,
  ComponentStatesSource,
} from '../component-states-registry';
import { openRegisteredDocument } from '../document-open-registry';
import { editorConsole } from '../editor-console';
import {
  ISOLATED_STORY_DOCUMENT_OPENER,
  THREE_STORY_DOCUMENT_OPENER,
} from '@volter/editor-sdk/kit/story-document-openers';
import { getComponentPreviewStories, type ProjectPreviewStory } from './story-registry';

function storiesFor(component: ComponentStatesRef): ProjectPreviewStory[] {
  return getComponentPreviewStories(component.name, component.sourcePath);
}

export const componentStatesSource: ComponentStatesSource = {
  id: 'portable-csf',
  owner: './component-states',
  statesFor: (component, context) =>
    context.surface === 'dom'
      ? []
      : storiesFor(component).map((story) => ({ id: story.id, label: story.label })),
  apply: (component, stateId, context: ComponentStatesContext) => {
    const story = storiesFor(component).find((candidate) => candidate.id === stateId);
    if (!story) return;
    if (context.surface === 'three') {
      openRegisteredDocument(THREE_STORY_DOCUMENT_OPENER, context.store, {
        modulePath: story.modulePath,
        storyName: story.name,
        title: story.label,
      });
      return;
    }
    if (context.surface === 'canvas') {
      openRegisteredDocument(ISOLATED_STORY_DOCUMENT_OPENER, context.store, {
        modulePath: story.modulePath,
        storyName: story.name,
      });
      return;
    }
    // `statesFor` never named a state for this surface, so nothing should ever
    // reach here; say so rather than silently doing nothing, because a new
    // surface arriving is exactly how this would go quiet.
    editorConsole.warn(
      `[portable-csf] no story document is registered for the "${context.surface}" surface, ` +
        `so state "${stateId}" of "${component.name}" could not be opened.`,
      'authoring',
    );
  },
};
