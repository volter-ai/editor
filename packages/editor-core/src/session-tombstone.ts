import { commandLine } from './product-command';
/**
 * THE PAGE'S OWN DEATH CERTIFICATE — one latch, read by everything that would
 * otherwise let a dead page keep impersonating a live editor.
 *
 * A vgai editor page is a client-side SPA. When its session ends — gracefully
 * (`vgai close` pushes `tab-close`) or ungracefully (the process was killed, or
 * a DIFFERENT server took the port) — the page keeps running: it keeps its
 * control channel's reconnect loop, keeps POSTing state snapshots, and keeps
 * executing relayed commands. Measured during a live debugging session: pages
 * from earlier crashed/replaced sessions ("corpse pages") kept answering
 * probes, so an attach or a `vgai status` read could land on a page whose
 * server was gone or replaced, and nothing on that page said so.
 *
 * Both halves of the detection ALREADY existed and neither was wired to
 * anything but a notice:
 *  - graceful: `tab-lifecycle-client.ts` handles the server's `tab-close` push;
 *  - ungraceful: `EditorLeaseGuard`/`editor-lease.ts` void the supervised lease
 *    (`server-gone` / `taken-over`).
 * This module is the ONE state both write to, and the one thing the command
 * listener reads before it runs anything.
 *
 * ## Why a latch and not a per-caller check
 *
 * The bijection (`server/tab-lifecycle.ts`) is the server's account of which
 * tab is real, and it is the mechanism the owner invariant names. A corpse page
 * must therefore not merely stay quiet — it must LEAVE that account. So
 * `markSessionEnded` is what the command listener subscribes to in order to
 * report its listener DETACHED (`POST /__editor/command-listener`, the same
 * fact `server/server-utils.ts`'s `commandListenerHealth` already prints per
 * tab as `not attached`). The server's own tab table then names the page as
 * unresponsive instead of blessing it — integrating with the bijection rather
 * than growing a second notion of tab liveness beside it.
 *
 * ## Why it can be cleared
 *
 * Not every void is final. `editor-lease.ts`'s `decideLeaseRecovery` has a
 * `resume` branch: the SAME process answers again, so it was never gone and the
 * page is not stale. That branch calls {@link clearSessionEnded}. The two
 * TERMINAL reasons (`taken-over`, and the server's own `tab-close`) never
 * clear — a tab that yielded to a live window must never come back to fight it.
 */

/** Why this page's session is over, in the vocabulary its detector already
 *  uses (`editor-lease.ts`'s `LeaseVoidReason`, plus the graceful push). */
export type SessionEndReason = 'server-gone' | 'taken-over' | 'session-closed';

export interface SessionEndedState {
  readonly reason: SessionEndReason;
  /** When this page decided it. Every refusal quotes the age, because "this
   *  page is dead" without a time is the same unfalsifiable present-tense claim
   *  the status age-stamp exists to kill. */
  readonly at: number;
}

let ended: SessionEndedState | null = null;
const listeners = new Set<(state: SessionEndedState | null) => void>();

function publish(): void {
  for (const listener of [...listeners]) listener(ended);
}

/** The state, or `null` while this page still believes it is live. */
export function sessionEndedState(): SessionEndedState | null {
  return ended;
}

/** Record the death. Idempotent per reason, and a TERMINAL reason is never
 *  overwritten by a later recoverable one. */
export function markSessionEnded(reason: SessionEndReason, at: number = Date.now()): void {
  if (ended !== null && ended.reason !== 'server-gone') return;
  if (ended !== null && ended.reason === reason) return;
  ended = { reason, at };
  publish();
}

/** The `resume` branch: the same process answered again, so nothing here is
 *  stale. Only ever legitimate after a `server-gone` void. */
export function clearSessionEnded(): void {
  if (ended === null || ended.reason !== 'server-gone') return;
  ended = null;
  publish();
}

/** Subscribe to transitions. Returns an unsubscribe. */
export function onSessionEndedChange(
  listener: (state: SessionEndedState | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The refusal a dead page answers control traffic with — a message that NAMES
 * the state, its age, and the one thing that fixes it, so a caller never has to
 * infer "corpse" from a plausible-looking answer.
 *
 * Pure over the state (no globals, no clock of its own) so the wording is
 * testable without a browser.
 */
export function sessionEndedRefusal(
  state: SessionEndedState,
  commandType: string,
  now: number = Date.now(),
): string {
  const age = `${Math.max(0, Math.round((now - state.at) / 1000))}s ago`;
  const what =
    state.reason === 'taken-over'
      ? `a DIFFERENT editor session took this port ${age}; this page yielded to it`
      : state.reason === 'session-closed'
        ? `this page's editor session was closed ${age}`
        : `this page's editor server stopped ${age}`;
  return (
    `refused "${commandType}": this editor page is a TOMBSTONE — ${what}. ` +
    'Nothing it reports is live state and nothing it does is saved. ' +
    `Run ${commandLine('edit <project>')} to open the session again; that reuses the live ` +
    'server and its one tab.'
  );
}

/** Test seam: forget everything this page decided. */
export function resetSessionTombstone(): void {
  ended = null;
  listeners.clear();
}
