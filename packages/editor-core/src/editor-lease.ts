/**
 * The editor tab is a SUPERVISED LEASE on its editor server.
 *
 * An editor tab is a client-side SPA: when its server dies UNGRACEFULLY (a
 * killed process, a crash), the tab keeps rendering pixel-for-pixel as if
 * nothing happened — and if a game is playing, it stays connected to the
 * Colyseus room as an unowned "ghost" player that nothing ever removes. So the
 * tab has to supervise its server.
 *
 * The graceful case (a clean `vgai close` sends a `tab-close` push) is handled
 * elsewhere (tab-lifecycle-client.ts). This module is the UNGRACEFUL case that
 * push never reaches.
 *
 * TWO independent readings, because ONE of them lies. The lease poll is a
 * `fetch` on the browser's per-origin HTTP connection pool, so it reports
 * "failed" for reasons that have nothing to do with the server being gone: a
 * cold Vite dep-optimize floods that pool and the poll never leaves the queue
 * before its own timeout; a server whose event loop is blocked answers nothing
 * while its process is perfectly alive. The tab's duplex control channel
 * (editor-presence.ts — a WebSocket, outside the HTTP pool) is the second
 * reading, and it is the one that distinguishes them: a killed process drops
 * that socket immediately, a merely BUSY one holds it open.
 *
 * Measured on 2026-08-09 against a live dev session: `kill -STOP` on the editor
 * server produced the "Editor disconnected" scrim ~19s later while the control
 * socket was still `readyState === OPEN` and duplex-granted. The tab had the
 * evidence that its server was alive and never looked at it. That is the whole
 * defect: missed polls alone are NOT evidence a session is gone.
 *
 * So a run of failed polls only VOIDS the lease when the control channel is
 * ALSO down for that same run. Failed polls on a page whose channel is open
 * degrade to a passive warning — never a blocking, input-eating overlay on a
 * page whose server is about to answer again.
 *
 * ## The third reading: TIME, because a tab does not run on demand
 *
 * MEASURED twice on live sessions, 2026-08-19: after its server was SIGKILLed,
 * the editor tab made ZERO network attempts of any kind — no lease poll, no
 * control-socket reconnect, no heartbeat beat, though the last two are written
 * to retry forever — and never came back, including after a replacement server
 * appeared on the same port. Once from a hidden tab over four and a half
 * minutes; once from a tab that was `visible` at the moment of the kill, over
 * forty-five seconds.
 *
 * WHY the page stops is NOT established. Suspension, discard, and a lost
 * renderer all fit, and the second run makes "the browser froze a background
 * tab" an insufficient story on its own. What IS established is the part the
 * design has to answer for: a page's own timers are not a thing this watchdog
 * may assume will run, and the page carrying an overlay cannot be relied on to
 * survive long enough to be read — which is why the durable note
 * (`session-orphan-record.ts`) is a channel and not a nicety.
 *
 * So a poll COUNT never meant what it was read as. Three polls are ~12s of a
 * foregrounded tab, minutes of a throttled one, and nothing at all of a stopped
 * one — and now that the watchdog also polls on events (the socket dropping, the
 * tab being shown again), three polls can land inside one second, which is a
 * server between processes rather than a dead one. The bar that was intended
 * all along is DARKNESS SUSTAINED FOR A WHILE, so the state carries the
 * timestamp that says it ({@link LeaseWatchState.darkSince}).
 *
 * And a page may only testify about time it EXPERIENCED. A tab returning from
 * a freeze knows nothing about the minutes it slept, so the shell forgets the
 * run on wake ({@link forgetLeaseFailures}) and earns a fresh window rather
 * than voiding on the strength of a gap it never observed.
 *
 * This file is the PURE half — the decision, the poll-folding reducer, and the
 * recovery policy, all data-in/data-out so the whole thing is unit-testable
 * with no browser, no timers, and no fetch. The watchdog
 * (`EditorLeaseGuard.tsx`) is a thin shell that supplies the timers/fetch and
 * renders the notice.
 */

/** How a server on a port identifies itself to a polling tab. `project` is the
 *  canonical root it reports serving (or `null` for an idle server); `pid` is
 *  the server process id — the strongest signal that a port was taken over by
 *  a DIFFERENT session, since a replaced server on the same port has a new pid.
 *  `pid` is `null` for a server too old to report one (the `/__editor/project`
 *  `session` block is optional). */
export interface LeaseIdentity {
  project: string | null;
  pid: number | null;
}

/** The outcome of one poll: either the server answered with its identity, or
 *  the request failed (connection refused / non-OK / timeout). */
export type LeasePollResult = { ok: true; identity: LeaseIdentity } | { ok: false };

/**
 * What the tab's own control channel said at the moment of a poll — the
 * SECOND, independent liveness reading (see the module header).
 *
 * - `open` — the duplex socket to this server is connected. A dead process
 *   cannot hold a socket open, so this is POSITIVE evidence the session lives.
 * - `closed` — the socket is down (or reconnecting). Consistent with a dead
 *   server; on its own it is not proof, which is why it only ever combines
 *   with failed polls.
 * - `unknown` — no channel reading is available (a share-tunnelled tab whose
 *   downstream bridge exposes none). Treated exactly like `closed`: absent
 *   evidence must not make the watchdog MORE willing to keep a dead tab alive.
 */
export type LeaseChannelState = 'open' | 'closed' | 'unknown';

/** The rolling state the watchdog folds each poll into. Pure data. */
export interface LeaseWatchState {
  /** Identity this tab attached to, captured from the first successful poll.
   *  `null` until then. Once set it never changes — it is what a later poll is
   *  compared against to detect a takeover. */
  bootIdentity: LeaseIdentity | null;
  /** Identity from the most recent SUCCESSFUL poll, or `null` when the most
   *  recent poll failed. */
  lastIdentity: LeaseIdentity | null;
  /** Consecutive failed polls since the last success. Reset to 0 on any
   *  success. */
  consecutiveFailures: number;
  /** The subset of that run whose polls ALSO found the control channel down —
   *  failures with no liveness evidence behind them. Voiding reads this
   *  counter, never `consecutiveFailures` alone. A single poll that saw an
   *  open channel resets it, because that poll proved the server alive. */
  unbackedFailures: number;
  /** The last moment this tab had POSITIVE EVIDENCE its server was alive — a
   *  poll that answered, or a poll that failed while the control socket was
   *  up — falling back to when the watch began, which is the earliest instant
   *  any claim about darkness could be measured from. `now - darkSince` is
   *  therefore "how long since we last saw a sign of life", and it is the
   *  clock half of the void bar.
   *
   *  A count alone stopped meaning "a sustained window" once polls became
   *  EVENT-DRIVEN (the watchdog now re-polls the instant the control socket
   *  drops, and again when a hidden tab is shown). Three failures can then
   *  land inside a second — which is a dev server mid-restart, not a dead
   *  one. Equally, a backgrounded tab's interval is throttled to as slow as
   *  once a minute, so three polls can span minutes. Neither is what the
   *  threshold was ever trying to measure: the bar is DARKNESS FOR A WHILE,
   *  and only a timestamp says that. */
  darkSince: number;
}

/** Default grace before a run of EVIDENCE-BACKED failed polls voids the lease.
 *  At the watchdog's ~4s cadence this is ~12s — long enough that an ordinary
 *  dev-server restart or HMR reload does not false-trigger, short enough to
 *  catch a real death promptly. */
export const DEFAULT_LEASE_FAILURE_THRESHOLD = 3;

/**
 * How long the evidence must stay dark before a void, ms — the bar the count
 * used to stand in for.
 *
 * A dev server RESTARTS on its own, routinely: a source change relaunches it,
 * and a cold dep re-optimize can hold it down for minutes. Every one of those
 * windows opens exactly like a death — socket dropped, polls refused — and
 * only its DURATION tells them apart at the start. So the watchdog must sit in
 * the dark for a stretch no ordinary restart is shorter than before it says
 * anything final. Ten seconds is that stretch: comfortably longer than the
 * relaunch gap of a running server, short enough that a user who just clicked
 * something is told inside one breath.
 *
 * Note the asymmetry, which is the whole point: being WRONG about "gone" costs
 * the user a session, while being wrong about "busy" costs them a banner that
 * clears itself. The clock buys the cheap error.
 */
export const LEASE_MIN_DARK_WINDOW_MS = 10_000;

/** The watchdog's poll cadence, ms. Exported so the shell and any test share
 *  one number. */
export const LEASE_POLL_INTERVAL_MS = 4_000;

/** `now` is when the watch begins: a tab that has never seen its server answer
 *  still needs a defensible instant to measure darkness from, and the moment
 *  it started looking is the only honest one. */
export function initialLeaseWatchState(now: number): LeaseWatchState {
  return {
    bootIdentity: null,
    lastIdentity: null,
    consecutiveFailures: 0,
    unbackedFailures: 0,
    darkSince: now,
  };
}

/**
 * Fold one poll result into the watch state.
 *
 * - A FAILURE clears `lastIdentity` (we no longer have a fresh reading) and
 *   increments the failure counter — and increments `unbackedFailures` too
 *   ONLY when the control channel was not open at that moment. A failed poll
 *   over a live socket is a busy server, and counts toward nothing that can
 *   void the tab.
 * - A SUCCESS records the identity, adopts it as `bootIdentity` if we did not
 *   have one yet, and RESETS both counters — a single good poll clears a
 *   transient blip so a quick restart never accumulates toward a void.
 */
export function reduceLeasePoll(
  state: LeaseWatchState,
  result: LeasePollResult,
  channel: LeaseChannelState,
  now: number,
): LeaseWatchState {
  if (!result.ok) {
    const backed = channel === 'open';
    return {
      ...state,
      lastIdentity: null,
      consecutiveFailures: state.consecutiveFailures + 1,
      unbackedFailures: backed ? 0 : state.unbackedFailures + 1,
      // An open socket is a sign of life even when the fetch missed, so it
      // relights the clock exactly where it clears the counter. A dark poll
      // leaves it alone: the stretch is measured from the LAST SIGN OF LIFE,
      // not from the first failure — which is what makes it independent of how
      // often the watchdog happens to be polling.
      darkSince: backed ? now : state.darkSince,
    };
  }
  return {
    bootIdentity: state.bootIdentity ?? result.identity,
    lastIdentity: result.identity,
    consecutiveFailures: 0,
    unbackedFailures: 0,
    darkSince: now,
  };
}

/**
 * Drop the current failure run, keeping the identity this tab attached to.
 *
 * Called when the page comes back from a state where it was not RUNNING — a
 * hidden tab the browser froze, a bfcache restore. The counters and the dark
 * clock are testimony about a stretch of time, and a page that was suspended
 * has none to give: its last readings are from before the gap and say nothing
 * about the server now. Carrying them across would let one unlucky poll on a
 * just-woken page (the socket has not finished reconnecting yet, so the
 * channel reads `closed`) satisfy a threshold that was banked minutes ago and
 * void a perfectly live session instantly.
 *
 * `bootIdentity` deliberately SURVIVES: who this tab attached to is not
 * testimony about elapsed time, and it is what takeover and recovery are
 * judged against.
 */
export function forgetLeaseFailures(state: LeaseWatchState, now: number): LeaseWatchState {
  return {
    bootIdentity: state.bootIdentity,
    lastIdentity: null,
    consecutiveFailures: 0,
    unbackedFailures: 0,
    darkSince: now,
  };
}

/** Whether two identities describe the same live lease — i.e. NOT a takeover.
 *  A takeover requires POSITIVE evidence that a DIFFERENT session now holds the
 *  port; absence of evidence is never a takeover. There are exactly two positive
 *  signals, and a `null` project is neither:
 *
 *   1. Two KNOWN, DIFFERENT projects — the port serves a different project than
 *      we booted on. A server is bound to one project, so a different project is
 *      a different session, even if the OS happened to recycle the same pid.
 *   2. Two KNOWN, DIFFERENT pids — same (or absent) project but a REPLACED
 *      process: a second server for our project, which the tab bijection wants
 *      this now-stale tab to yield to.
 *
 *  Everything else is the same lease. In particular a reading that reports NO
 *  project on the SAME pid — a transiently unreadable `vgai.project.json` save
 *  on our own still-live server — is absence of evidence, NOT a takeover; the
 *  pid positively identifies it as our own process. A `null` pid on either side
 *  (a server too old to report one) is likewise treated conservatively. */
function sameLease(a: LeaseIdentity, b: LeaseIdentity): boolean {
  if (a.project !== null && b.project !== null && a.project !== b.project) return false;
  if (a.pid !== null && b.pid !== null && a.pid !== b.pid) return false;
  return true;
}

export type LeaseVoidReason = 'server-gone' | 'taken-over';

/**
 * - `live` — nothing to say.
 * - `degraded` — the poll is failing but the control channel is up. The server
 *   is busy, or this page's HTTP pool is. Say so passively; change nothing.
 * - `void` — the session this tab leased is gone. Tear the game down and tell
 *   the user.
 */
export type LeaseStatus = 'live' | 'degraded' | 'void';

export interface LeaseDecision {
  status: LeaseStatus;
  /** Which void. `null` for every non-void status. */
  reason: LeaseVoidReason | null;
}

export interface LeaseDecisionInput {
  consecutiveFailures: number;
  /** Of that run, how many polls also had NO channel evidence (see
   *  `LeaseWatchState.unbackedFailures`). */
  unbackedFailures: number;
  failureThreshold: number;
  /** How long it has been since the last sign of life, ms — `now - darkSince`,
   *  computed by the caller so this decision keeps no clock of its own. */
  darkForMs: number;
  /** The window that run must span before it can void (see
   *  {@link LEASE_MIN_DARK_WINDOW_MS}). */
  minDarkWindowMs: number;
  /** Identity this tab attached to at boot (`null` before the first success). */
  bootIdentity: LeaseIdentity | null;
  /** Identity from the latest successful poll (`null` when it failed). */
  lastIdentity: LeaseIdentity | null;
}

/**
 * Decide this tab's lease status — the whole policy, as a pure function.
 *
 *  - `taken-over` — a poll SUCCEEDED but the server on the port is provably a
 *    DIFFERENT session than the one this tab attached to (a different known
 *    project, or a replaced process on a new pid — see `sameLease`). This is
 *    IMMEDIATE: no grace, even with zero failures, because the port has
 *    demonstrably changed hands. A server that merely reports no/unreadable
 *    project on the SAME pid is NOT a takeover.
 *  - `server-gone` — polls have failed `failureThreshold` times in a row, the
 *    control channel was down for that whole run, AND the run has lasted
 *    `minDarkWindowMs`. Three readings, because each alone has a benign
 *    explanation: a queued/timed-out poll on a busy server, a socket
 *    mid-reconnect, and — the one the clock covers — a burst of event-driven
 *    polls fired inside the second a restarting server is between processes.
 *  - `degraded` — a failure run that has not (yet) cleared all three bars:
 *    the channel is still up, or the darkness is still young. The session may
 *    be alive and merely unreachable; that is a warning, not a void. A run
 *    that will eventually void passes THROUGH this state, which is what puts
 *    an honest "not answering" notice on screen within a poll of the trouble
 *    starting instead of leaving the page silent for the whole window.
 *
 * Takeover is checked first: a successful poll that disagrees on identity is a
 * stronger, faster signal than a failure run.
 */
export function decideLeaseState(input: LeaseDecisionInput): LeaseDecision {
  const {
    consecutiveFailures,
    unbackedFailures,
    failureThreshold,
    darkForMs,
    minDarkWindowMs,
    bootIdentity,
    lastIdentity,
  } = input;
  if (bootIdentity && lastIdentity && !sameLease(bootIdentity, lastIdentity)) {
    return { status: 'void', reason: 'taken-over' };
  }
  if (consecutiveFailures >= failureThreshold) {
    if (unbackedFailures >= failureThreshold && darkForMs >= minDarkWindowMs) {
      return { status: 'void', reason: 'server-gone' };
    }
    return { status: 'degraded', reason: null };
  }
  return { status: 'live', reason: null };
}

/**
 * After a `server-gone` void: whether one fresh poll proves the SAME project
 * has reoccupied this port, so the tombstone page may RELOAD into the live
 * editor instead of demanding a manual reopen.
 *
 * The revival contract (each piece decided, not defaulted):
 *  - AUTOMATIC, by full page reload. A reload boots a fresh SPA from the new
 *    server — the honest equivalent of the manual reopen the overlay used to
 *    demand — so "a dead tab never silently reconnects" still holds: nothing
 *    stale survives the reload.
 *  - Identity-gated: revival requires this tab's KNOWN boot project and a
 *    KNOWN, EQUAL reported project. A port reoccupied by a DIFFERENT project
 *    must never be reloaded into — that is exactly the silent retargeting the
 *    reserved-port rule exists to prevent. The pid is deliberately ignored:
 *    a revived server is a new process by definition.
 */
function revives(bootIdentity: LeaseIdentity | null, identity: LeaseIdentity): boolean {
  if (!bootIdentity?.project || !identity.project) return false;
  return identity.project === bootIdentity.project;
}

/**
 * What a `server-gone` tombstone should do when a poll starts answering again.
 *
 * - `resume` — the SAME PROCESS answered (equal, known pid). It never died;
 *   the void was drawn on a run of unreachable polls. Nothing about the page
 *   is stale, so it keeps its session: no reload, no lost camera/selection/
 *   undo stack. This is the branch that turns a hiccup back into a working
 *   editor instead of a restart.
 * - `reload` — a DIFFERENT process now serves our SAME project: the server
 *   really did die and came back. The page IS stale, so the honest recovery is
 *   a full boot against the new server (the revival contract above).
 * - `offer-reload` — something answers, but this tab never learned who it was
 *   (it died before its first successful poll, which is exactly what a
 *   mid-boot stall produces). It cannot verify the occupant, so it must not
 *   reload ITSELF — but leaving it a permanently dead window was the worst
 *   half of this defect. The notice offers the reload as a click and names it.
 * - `none` — nothing answered, or a different known project holds the port.
 *
 * `taken-over` never recovers by any branch: that tab yielded to a live window
 * the bijection chose, and reviving it would recreate the duplicate. The
 * watchdog stops polling on that reason rather than encoding it here.
 */
export type LeaseRecovery = 'none' | 'resume' | 'reload' | 'offer-reload';

export function decideLeaseRecovery(
  bootIdentity: LeaseIdentity | null,
  result: LeasePollResult,
): LeaseRecovery {
  if (!result.ok) return 'none';
  const identity = result.identity;
  if (
    bootIdentity &&
    bootIdentity.pid !== null &&
    identity.pid === bootIdentity.pid &&
    sameLease(bootIdentity, identity)
  ) {
    return 'resume';
  }
  if (revives(bootIdentity, identity)) return 'reload';
  if (!bootIdentity?.project) return 'offer-reload';
  return 'none';
}
