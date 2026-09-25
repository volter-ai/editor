/**
 * WHICH COMPONENT BOARDS THIS PROJECT HAS — the one answer all three boards'
 * existence keys on.
 *
 * A component board exists because the project has STORIES of that board's
 * medium, never because it declares a root of some kind (owner ruling,
 * 2026-08-15; ARCHITECTURE-CORE §center-surface ontology). Root kinds are
 * irrelevant to presence: a project with a three root and no three story has
 * nothing to lay out on a 3D board, and a project whose UI components live
 * inside an ingested game — no `dom` root anywhere in its manifest — still has
 * a UI board the moment one of those components declares a story.
 *
 * ## Medium is DECLARED, not mounted
 *
 * ARCHITECTURE-CORE §Zero inference: the system answers this question from
 * the story's CSF tag, the adapter's `include`/`mounts`, and the manifest
 * root entry. See `story-declared-medium.ts`. A story the declarations
 * cannot place is a named gap — it does not create a board, and nothing
 * mounts it to guess.
 *
 * ## It is a LATCHING answer, and that is deliberate
 *
 * Classification is now synchronous, but a registry refresh can still
 * replace one settled answer with another. During a refresh the PREVIOUS
 * verdict stands rather than collapsing to "no boards": a project that has
 * boards must not have them blink out of the workspace every time a story
 * file is saved. The first pass over an empty registry therefore reports
 * every medium false — a project with no stories has never had a board and
 * never gets one — while a later pass only ever replaces one settled answer
 * with another.
 *
 * A pass superseded by a newer registry change is abandoned; only the newest
 * pass publishes.
 */

import { getProjectStoryRegions } from '@volter/editor-sdk/kit/stories/project-story-regions';
import {
  __resetUndeclaredStoryMediumReportsForTest,
  declaredStoryMedium,
  reportUndeclaredStoryMedium,
  type StoryMedium,
} from '@volter/editor-sdk/kit/stories/story-declared-medium';
import { getProjectStoryModules, subscribeProjectStoryModules } from '@volter/editor-core/stories/story-registry';

/** Which component boards the project's stories call for. */
export interface StoryMediaPresence {
  /** ≥1 story declared as `three` — the 3D board's existence. */
  readonly three: boolean;
  /** ≥1 story declared as `canvas` — the 2D board's existence. */
  readonly canvas: boolean;
  /** ≥1 story declared as `dom` — the UI board's existence. */
  readonly dom: boolean;
}

const NONE: StoryMediaPresence = { three: false, canvas: false, dom: false };

let _presence: StoryMediaPresence = NONE;
let _pass = 0;
const _listeners = new Set<() => void>();
let _subscribed = false;

/** The current verdict (stable reference between changes). */
export function getStoryMediaPresence(): StoryMediaPresence {
  ensureSubscribed();
  return _presence;
}

/** Subscribe to verdict changes. Returns an unsubscribe function. */
export function subscribeStoryMediaPresence(listener: () => void): () => void {
  ensureSubscribed();
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function ensureSubscribed(): void {
  if (_subscribed) return;
  _subscribed = true;
  subscribeProjectStoryModules(() => {
    void recomputeStoryMediaPresence();
  });
  void recomputeStoryMediaPresence();
}

function publish(next: StoryMediaPresence): void {
  if (
    next.three === _presence.three &&
    next.canvas === _presence.canvas &&
    next.dom === _presence.dom
  )
    return;
  _presence = next;
  for (const listener of _listeners) listener();
}

function classifyDeclared(story: { readonly modulePath?: string }): StoryMedium | undefined {
  const declared = declaredStoryMedium({
    modulePath: story.modulePath,
    regions: getProjectStoryRegions(),
  });
  if (declared.medium) return declared.medium;
  if (story.modulePath) reportUndeclaredStoryMedium(story.modulePath, declared.reason);
  return undefined;
}

/**
 * Re-read the open project's story media from declarations. Exported so a
 * caller that just refreshed the registry can await the verdict instead of
 * racing it — the subscription above drives the ordinary case.
 *
 * Never throws. Never mounts. An undeclared story is named once and does not
 * count toward any board.
 */
export async function recomputeStoryMediaPresence(): Promise<StoryMediaPresence> {
  const pass = ++_pass;
  const stories = getProjectStoryModules().flatMap((module_) =>
    module_.ok
      ? module_.stories.map((story) => ({ ...story, modulePath: module_.modulePath }))
      : [],
  );

  // The empty registry is the one case with no measuring to do, and the one
  // case that must be able to take boards AWAY (a project whose last story was
  // deleted, and — the common case — a project that never had one).
  if (stories.length === 0) {
    publish(NONE);
    return _presence;
  }

  const found: Record<StoryMedium, boolean> = { three: false, canvas: false, dom: false };
  for (const story of stories) {
    const medium = classifyDeclared(story);
    if (medium) found[medium] = true;
    if (pass !== _pass) return _presence;
  }
  const { three, canvas, dom } = found;
  if (pass !== _pass) return _presence;
  publish({ three, canvas, dom });
  return _presence;
}

/** Test-only: forget the current verdict and the registry subscription, so a
 *  suite can drive `recomputeStoryMediaPresence` against its own fixtures
 *  without a previous suite's answer latching into it. */
export function __resetStoryMediaPresenceForTest(): void {
  _presence = NONE;
  _pass = 0;
  _listeners.clear();
  _subscribed = false;
  __resetUndeclaredStoryMediumReportsForTest();
}
