/**
 * The `play` channel every project contribution's props carry — ONE resolution
 * of "which live game is this contribution looking at", read by all four
 * contribution hosts (`components/ToolHost.tsx`,
 * `components/InspectorToolSection.tsx`,
 * `components/AssetInspectorToolSection.tsx`, and `@vgai/game`'s generation
 * documents).
 *
 * A dev-GUI contribution's whole subject is the running game (owner ruling,
 * `docs/ARCHITECTURE-CORE.md`, 2026-08-19), and this is its door to one.
 *
 * THE DEPENDENCY POINTS THE OTHER WAY, deliberately — play-mode PUBLISHES a
 * reader here, and this module imports nothing of play-mode's. That is the
 * same shape `performance-sources.ts` uses, and it is load-bearing rather than
 * stylistic: an inspector section importing play-mode drags the entire runtime
 * boot chain (renderer setup, vendored postprocessing, WebGL) into every
 * module graph that mounts one — which is a real cost in the editor and an
 * outright import-time crash in a headless host.
 *
 * RESOURCE OWNERSHIP: the reader is play-mode's, for the exact lifetime of one
 * play session. It is the only writer, `publishToolContributionPlay(null)` on
 * exit is the only teardown, and nothing here caches its result.
 */

import type { ToolContributionPlay } from '@volter/editor-sdk/contributions';
import { subscribeInspectedInstance } from '@volter/editor-sdk/kit/authoring/active-systems';

type PlayReader = () => ToolContributionPlay | null;

let _read: PlayReader | null = null;
const _listeners = new Set<() => void>();

/** Publish the live reader for a play session, or `null` when one ends. */
export function publishToolContributionPlay(read: PlayReader | null): void {
  _read = read;
  for (const listener of _listeners) listener();
}

/** The inspected play instance, or `null` while nothing is playing. */
export function toolContributionPlay(): ToolContributionPlay | null {
  return _read?.() ?? null;
}

/**
 * Observe the two things that change WHICH game a contribution is bound to: a
 * session starting or stopping (the publication above), and the Inspect
 * selector moving between live seats. Both, because either alone leaves a host
 * describing another mount's game — and the split is exactly the case where
 * that is invisible.
 */
export function subscribeToolContributionPlay(listener: () => void): () => void {
  _listeners.add(listener);
  const unsubscribeInstance = subscribeInspectedInstance(listener);
  return () => {
    _listeners.delete(listener);
    unsubscribeInstance();
  };
}

/**
 * A stable identity for the bound instance — the `getSnapshot` for
 * {@link subscribeToolContributionPlay}.
 *
 * A STRING rather than the `play` object itself, because
 * `useSyncExternalStore` compares snapshots with `Object.is` and
 * {@link toolContributionPlay} builds a fresh object on every call: returning
 * that would report a change on every render and loop. The mount id is enough
 * to key on because it is never reused (`play-mode.ts`'s instance-identity
 * block), so a remount is always a new value.
 */
export function toolContributionPlayKey(): string {
  const play = toolContributionPlay();
  return play ? `play:${play.instanceId}` : 'stopped';
}
