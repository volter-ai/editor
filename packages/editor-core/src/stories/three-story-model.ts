/**
 * Shared, headless facts about a `three` STORY: whether a mounted story holds
 * three content, and how a story's preview thumbnail is keyed in an in-memory
 * cache. Kept pure and off the React tree so every one of them is
 * unit-testable with no renderer.
 *
 * Membership belongs to the CONSUMER, never to the registry, and it is
 * DECLARED (`story-declared-medium.ts`). The `3D Components` board admits
 * stories whose medium is `three`, the canvas board admits `canvas`, the
 * DOM design board admits `dom` ({@link domStoryBoardMembers}). An
 * undeclared story is a named gap and is not a candidate on any board —
 * nothing here mounts to guess. The project's story registry stays
 * deliberately unfiltered.
 */

import type * as THREE from 'three';
import { getProjectStoryRegions } from './project-story-regions';
import { declaredStoryMedium, reportUndeclaredStoryMedium } from './story-declared-medium';

/**
 * Whether a mounted story's root wrapper actually holds `three` content.
 *
 * A story that renders nothing (or renders only React fragments/null) commits
 * successfully into the wrapper group and yields an EMPTY `Object3D` — a
 * successful mount with nothing in it. A surface shows a story that rendered
 * something; "the mount succeeded" alone is not the test.
 */
export function mountedStoryHasThreeContent(root: THREE.Object3D): boolean {
  return root.children.length > 0;
}

/**
 * The DOM design board's membership — every story DECLARED as `dom`.
 *
 * An undeclared story is named once and is not a member. Nothing here
 * mounts: medium is a declaration, and a last-resort mount would make
 * "residue 0" unfalsifiable (the orphan would land on this board).
 *
 * The board (`authoring/design-time-layers.ts`) renders each member through
 * `react-dom`, so a three story landing on it renders `<group>`/`<primitive>`
 * as unknown DOM tags. Declaration is what keeps those stories off this
 * board; the project's story registry stays deliberately unfiltered.
 */
export function domStoryBoardMembers<
  T extends {
    readonly id?: string;
    readonly name?: string;
    readonly modulePath?: string;
    readonly tags?: readonly string[];
  },
>(stories: readonly T[]): T[] {
  const regions = getProjectStoryRegions();
  const members: T[] = [];
  for (const story of stories) {
    const declared = declaredStoryMedium({ modulePath: story.modulePath, regions });
    if (declared.medium === 'dom') {
      members.push(story);
      continue;
    }
    if (declared.via === 'undeclared' && story.modulePath) {
      reportUndeclaredStoryMedium(story.modulePath, declared.reason);
    }
  }
  return members;
}

