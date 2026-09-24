/**
 * The running actors, as the editor reads them: the registry the served machine stamp fills
 * (`serving/live-module.ts`) in the game's graph, reached through its `globalThis` key. Nothing
 * here writes to it; a stopped actor leaves when it completes, and one whose snapshot says it is
 * no longer active is not listed.
 */

import { useSyncExternalStore } from 'react';

export interface LiveMachineEvent {
  readonly type: string;
  readonly at: number;
  readonly from: unknown;
  readonly to: unknown;
}

interface ActorRefLike {
  readonly id?: string;
  readonly sessionId?: string;
  getSnapshot(): { readonly value: unknown; readonly context: unknown; readonly status?: string };
}

export interface LiveActor {
  /** The machine's source identity (`src/player-body-machine.ts#playerBodyMachine`). */
  readonly key: string;
  readonly ref: ActorRefLike;
  readonly events: readonly LiveMachineEvent[];
  readonly startedAt: number;
}

interface LiveRegistry {
  readonly actors: Map<unknown, LiveActor>;
  readonly listeners: Set<() => void>;
  version: number;
}

const REGISTRY = Symbol.for('volter.xstate.live');

function registry(): LiveRegistry {
  const holder = globalThis as unknown as Record<symbol, LiveRegistry | undefined>;
  return (holder[REGISTRY] ??= { actors: new Map(), listeners: new Set(), version: 0 });
}

export function liveActors(key?: string): LiveActor[] {
  const out: LiveActor[] = [];
  for (const actor of registry().actors.values()) {
    if (key !== undefined && actor.key !== key) continue;
    const status = actor.ref.getSnapshot().status;
    if (status !== undefined && status !== 'active') continue;
    out.push(actor);
  }
  return out;
}

export function subscribeLiveActors(listener: () => void): () => void {
  const listeners = registry().listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function liveActorsVersion(): number {
  return registry().version;
}

/** The registry's version, re-read at most once per animation frame: a machine that takes an
 *  event every frame must not re-render the document at the event rate. */
export function useLiveActorsVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      let frame = 0;
      const stop = subscribeLiveActors(() => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          listener();
        });
      });
      return () => {
        if (frame) cancelAnimationFrame(frame);
        stop();
      };
    },
    liveActorsVersion,
  );
}
