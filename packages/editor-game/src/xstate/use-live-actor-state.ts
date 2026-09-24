/**
 * E3 ("Current state and active transition are highlighted during
 * preview/play") — subscribes to a live XState actor and returns the full
 * set of currently-active state ids, updating on every transition.
 *
 * Returns `null` (not `[]`) when no actor is provided, or the actor hasn't
 * emitted a snapshot yet — callers should treat `null` as "fall back to the
 * static `currentStateId` prop", and `[]` as "the actor genuinely reports no
 * active animation-relevant states" (shouldn't normally happen for a running
 * actor, but is a real distinct value from "no live actor at all").
 */

import type { InspectableXStateActor } from '@volter/threejs-runtime/behavior/xstate-inspection';
import { useEffect, useState } from 'react';
import type { AnyStateMachine, StateValue } from 'xstate';
import { activeStateIdsOf } from './xstate-graph';

// The actor is the engine binding's own minimal shape, not XState's
// `AnyActorRef` — see `XStateAnimationActor`'s note. It keeps `value` as
// `unknown`, so interpreting it as a `StateValue` is this inspector's job and
// happens in exactly the two places below.
export function useLiveActorState(
  machine: AnyStateMachine,
  actor: InspectableXStateActor | undefined,
): string[] | null {
  const [activeIds, setActiveIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!actor) {
      setActiveIds(null);
      return;
    }
    // Seed from whatever snapshot the actor already has (it may have started
    // and transitioned before this component mounted), then follow every
    // subsequent transition.
    setActiveIds(activeStateIdsOf(machine, actor.getSnapshot().value as StateValue));
    const subscription = actor.subscribe((snapshot) => {
      setActiveIds(activeStateIdsOf(machine, snapshot.value as StateValue));
    });
    return () => subscription.unsubscribe();
  }, [machine, actor]);

  return activeIds;
}
