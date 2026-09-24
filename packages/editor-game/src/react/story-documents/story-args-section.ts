/**
 * The glyph for the shared `Story Args` inspector facet.
 *
 * Lives here — an editor-side module both story-document contributions import
 * (`story-documents.tsx`, `three-story-documents.tsx`) — rather than in
 * `inspection/model.ts`, so the data-model layer stays free of the icon
 * package (node-env tests import `@editor/inspection/model` and must not pull
 * `@fortawesome/*` through it). The id and title stay as plain strings in
 * `model.ts`; only the icon needs a React-side home.
 *
 * The glyph is DISTINCT from the generic `properties` grid's `faSliders`: the
 * compact inspector card tells its tabs apart by glyph alone (the title is a
 * tooltip), so two "knob" icons would be one indistinguishable tab. Story args
 * are the story's NAMED inputs, so they wear a tag glyph.
 */

import { faTags, type IconDefinition } from '@fortawesome/free-solid-svg-icons';

export const STORY_ARGS_SECTION_ICON: IconDefinition = faTags;
