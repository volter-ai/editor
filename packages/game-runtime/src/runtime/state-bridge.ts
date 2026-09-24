/**
 * Frame-versioned game state bridge (T7.4 slice 1, the D7 remainder). Components
 * mutate state on `this` freely during ticks — there is no proxy, no dirty
 * tracking, no event per mutation (Track A: no mirror, no sync layer). So the
 * unit of change a subscriber can observe is the FRAME: `GameInternal.runFrame`
 * bumps `frameVersion` and notifies subscribers at most once, at its tail, AFTER
 * every phase of every world and every world's `endFrame` hook has run (see the
 * wiring in `runtime/game.ts`) — mirroring the D7 "from `gameLogic` onward,
 * every world's post-step state is readable" guarantee, extended to "after the
 * frame, ALL state is readable".
 *
 * This file is plain, react-free TypeScript any consumer could use — no
 * react import here, or anywhere under `runtime/` (the react-facing
 * `useWorldState` hook, which DOES import React, lives at
 * `packages/game-runtime/src/react/world-state.tsx`).
 *
 * SECOND trigger for `bump()` (`Game.registerRoot`, `runtime/game.ts`): the
 * `roots` list is also state a `useWorldState` selector can read
 * (`g.roots.map(...)`, the T6.2 two-world-compose gate), and it changes
 * OUTSIDE the frame loop — `registerRoot` is called as each world finishes
 * mounting, which can happen well before the host's loop has ticked even
 * once. Without an immediate notification here, a selector that first reads
 * `g.roots` before every world has registered stays stuck on that stale
 * snapshot until the next completed frame — which, on a slow/contended host
 * or a backgrounded tab, may be arbitrarily delayed. See `registerRoot`'s
 * own doc comment for the concrete CI failure this closes.
 */

/** Frame-versioned, react-free subscription surface. */
export interface GameStateBridge {
  /** Monotonic; bumped once per completed `runFrame`, AND once per
   *  `Game.registerRoot` call (world-list changes are observable state too
   *  — see this file's module doc comment). Starts at 0 before the first of
   *  either has happened. Never treat this as a literal frame COUNT — only
   *  "did it change" is a contract any consumer may rely on. */
  readonly frameVersion: number;
  /** Notified at most once per frame, after ALL phases of ALL roots (and
   *  their `endFrame` hooks) have run. Returns an unsubscribe function. */
  subscribe(onFrame: () => void): () => void;
}

/** Host-internal extension of {@link GameStateBridge}: adds `bump`, called
 *  both by `GameInternal.runFrame` at its tail AND by `Game.registerRoot`
 *  when the world list changes (see this file's module doc comment). NOT
 *  part of the game-facing `Game.state` surface (typed as the narrower
 *  `GameStateBridge` there) — games/components/hooks never call `bump`
 *  directly; only the frame executor and the world registry do. */
export interface GameStateBridgeInternal extends GameStateBridge {
  /** Bump `frameVersion` by one and notify every current subscriber, in
   *  subscription order. Subscriber errors are isolated (per-subscriber
   *  try/catch, loud `console.error`, never swallowed silently): one
   *  offending subscriber must not stop its siblings
   *  from being notified, and must not break the frame loop. */
  bump(): void;
}

/**
 * Construct a fresh bridge. One per `Game` (created alongside the other
 * game-scoped state in `createGame`, `runtime/game.ts`).
 */
export function createStateBridge(): GameStateBridgeInternal {
  let frameVersion = 0;
  const subscribers = new Set<() => void>();

  return {
    get frameVersion() {
      return frameVersion;
    },
    subscribe(onFrame: () => void): () => void {
      subscribers.add(onFrame);
      return () => {
        subscribers.delete(onFrame);
      };
    },
    bump(): void {
      frameVersion++;
      // Snapshot before iterating (same idiom as ComponentManager's
      // per-phase `list = byPhase.get(phase)!.slice()`): a subscriber that
      // subscribes/unsubscribes from WITHIN a notification must not affect
      // which of ITS SIBLINGS get notified this same bump.
      const notified = Array.from(subscribers);
      for (const onFrame of notified) {
        try {
          onFrame();
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: a throwing subscriber must not take the notify loop down, and the console (captured by the editor session ledger) is the engine runtime's one report channel.
          console.error('[state-bridge] subscriber threw:', err);
        }
      }
    },
  };
}
