/**
 * The BOUND scenes projection of whatever game is live in this session, or
 * `null`.
 *
 * One question, one reader. The `open` verb's live half
 * (`scene-live-open.ts`) needs the very object the mount installed — the same
 * one the inspector's scene picker drives, carrying that mount's held-repaint
 * seam — so it is resolved off the single ingest slot (`active-ingest.ts`),
 * never rebuilt from the contract and never taken from a COMPOSITE adapter's
 * `stories` pass-through (that is a fresh delegating object; the projection's
 * `goToScene` does not survive it).
 *
 * The marker, not the session kind, is what decides: a plain `StoriesProvider`
 * (a react world's design-time CSF states) is not a game's own screens and must
 * not be navigated as though it were.
 */

import {
  type ContractScenesStories,
  isContractScenesStories,
} from '../host/authoring/contract-scenes-stories';
import type { AuthoringAdapter } from '@volter/editor-project/adapter/authoring';
import { activeIngest } from './active-ingest';

export function activeContractScenes(): ContractScenesStories | null {
  const active = activeIngest();
  if (!active) return null;
  // Every kind's own live authoring adapter — asked the same question, so a
  // projection bound on a lane that does not have one today answers the day it
  // does, without a second reader here.
  const adapter: AuthoringAdapter | null | undefined = (() => {
    switch (active.kind) {
      case 'canvas':
        return active.session.adapter;
      case 'dom':
        return active.session.adapter;
      case 'three':
        return active.session.mount?.authoring;
    }
  })();
  const stories = adapter?.stories;
  return isContractScenesStories(stories) ? stories : null;
}
