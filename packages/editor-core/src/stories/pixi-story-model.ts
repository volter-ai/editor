/**
 * Shared, headless facts about a CANVAS story: whether a mounted story holds
 * Pixi content. The exact counterpart of `three-story-model.ts`'s
 * `mountedStoryHasThreeContent`, kept pure and off the React tree.
 *
 * Membership is DECLARED (`story-declared-medium.ts`). This module does not
 * classify a story by mounting it.
 */

import type { Container } from 'pixi.js';

/**
 * Whether a mounted story's stage actually holds Pixi content.
 *
 * A story can mount a `<Application>` successfully and render nothing into it —
 * a gate whose condition never became true, a component that returns `null`.
 * That is a successful mount with nothing in it, and a surface shows a story
 * that rendered SOMETHING; "the mount succeeded" alone is not the test. Exactly
 * the rule (and exactly the expression) `mountedStoryHasThreeContent` states
 * for the three surface.
 */
export function mountedStoryHasPixiContent(stage: Container): boolean {
  if (stage.children.length === 0) return false;
  // An empty wrapper (`<pixiContainer>` around a still-loading piece) is
  // a child and not content. Isolation and IsolatedPiece both land pixels
  // after an async asset load; a 0×0 stage is the same "gate never true"
  // case the header names.
  const bounds = stage.getBounds();
  return bounds.width > 1 && bounds.height > 1;
}
