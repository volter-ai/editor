/**
 * ONE shared 250ms availability tick replacing the three independent
 * `setInterval(…, 250)` pollers that W4 left behind (utility availability,
 * the Dev utility's live-plane gate, and ConnectionStatus's networking-adapter
 * poll).
 *
 * These gates all watch the SAME kind of out-of-band signal — a live play
 * session's adapters appearing/disappearing without any store/registry
 * notification — so they don't need three timers, three wakeups, and three
 * interleaved re-render schedules; they need one heartbeat. The interval is
 * refcounted: it starts with the first subscriber and stops with the last,
 * so an idle editor (none of the three consumers mounted) runs no timer at
 * all — strictly better than the three always-on intervals it replaces.
 *
 * `useSyncExternalStore`-shaped on purpose: consumers subscribe and SELECT
 * the derived value they actually read (`getActiveDebug()` presence, a
 * connection state, an availability fingerprint) — they re-render only when
 * that value changes, never on the tick itself. The former version-counter
 * hook (`useAvailabilityTick`) re-rendered every subscriber 4×/s
 * unconditionally; with the workspace and every panel subscribed
 * that measured ~27ms of React work per tick (~110ms/s) in an idle editor —
 * found 2026-07-31 by the Profiler's long-animation-frame attribution.
 */

import { useSyncExternalStore } from 'react';

const TICK_MS = 250;

let _version = 0;
let _intervalId: ReturnType<typeof setInterval> | null = null;
const _listeners = new Set<() => void>();

function onTick(): void {
  _version++;
  for (const fn of _listeners) fn();
}

/** Subscribe to the shared 250ms tick. Starts the timer on first subscriber,
 *  stops it with the last. Returns unsubscribe. */
export function subscribeAvailabilityTick(fn: () => void): () => void {
  _listeners.add(fn);
  if (_intervalId === null) _intervalId = setInterval(onTick, TICK_MS);
  return () => {
    _listeners.delete(fn);
    if (_listeners.size === 0 && _intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
  };
}

/** Monotonic tick counter — exposed for tests that assert the timer runs. */
export function availabilityTickVersion(): number {
  return _version;
}

/**
 * Re-evaluate `select` on every shared availability tick, re-rendering the
 * caller ONLY when its result changes (`Object.is`). `select` must return a
 * primitive or a stable reference (an adapter identity, a joined-id string,
 * a bitmask) — a fresh object every call would defeat the point and re-render
 * per tick. It runs 4×/s plus once per render, so keep it a cheap read.
 */
export function useAvailabilitySelector<T>(select: () => T): T {
  return useSyncExternalStore(subscribeAvailabilityTick, select, select);
}
