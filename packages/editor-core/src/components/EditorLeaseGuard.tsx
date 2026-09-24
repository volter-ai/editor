/**
 * The client half of the SUPERVISED LEASE (policy: ../editor-lease.ts).
 *
 * A watchdog that polls the editor server's identity every few seconds, reads
 * this page's control-channel liveness alongside it, and acts on the pair:
 *
 *  - the session is provably GONE (failed polls AND a dropped control socket)
 *    or TAKEN OVER → tear the running game down (which drops the Colyseus room,
 *    so no ghost player is left behind) and raise the "Editor disconnected"
 *    overlay;
 *  - the polls fail but the control socket is still up → the server is BUSY,
 *    not gone. Say so in a passive banner that changes nothing and blocks
 *    nothing, and clear it the moment a poll answers.
 *
 * That second branch is the fix for the defect this file caused: a blocking,
 * non-dismissable overlay eats every pointer event while `page.evaluate` keeps
 * working, so a false void is invisible to every JS-level check and turns a
 * 12-second hiccup into a lost session. Measured 2026-08-09: `kill -STOP` on a
 * healthy dev server raised the scrim in ~19s with the control socket still
 * OPEN. Nothing here may block the page on evidence that weak — and the
 * overlay that DOES appear is dismissable ("Continue anyway") and clears
 * itself when the same server answers again.
 *
 * This is the UNGRACEFUL counterpart to the graceful `tab-close` path
 * (tab-lifecycle-client.ts): a clean `vgai close` pushes an event the tab acts
 * on, but a killed/crashed server sends nothing.
 *
 * ## Why this watchdog is not (only) a timer
 *
 * An interval is not a heartbeat the page controls. Measured twice on live
 * sessions, 2026-08-19: after its server was SIGKILLed, the tab made zero
 * network attempts of any kind for the rest of the run — no poll, no socket
 * reconnect, no worker beat — and a relaunched server on the same port went
 * unnoticed too. Once from a hidden tab over four and a half minutes, once
 * from a tab that was visible at the kill, over forty-five seconds. Why the
 * page stops is not established (see ../editor-lease.ts); that it may stop is.
 * A watchdog that can only fire from `setInterval` is therefore asleep for
 * exactly the stretch the user is away, and still owes three polls when they
 * come back and start clicking.
 *
 * So the poll is driven by the MOMENTS THAT MATTER as well as the clock: the
 * tab becoming visible again, a `pageshow` restore, and either edge of the
 * control socket. The clock moved into the DECISION instead — a void needs the
 * darkness to have lasted `LEASE_MIN_DARK_WINDOW_MS`, so polling eagerly can
 * never turn a server that is merely between processes into a dead one.
 *
 * And because the page may be closed or discarded while the overlay is up, the
 * void also leaves a durable note (`session-orphan-record.ts`) that the NEXT
 * session on this address reads and reports. The overlay is what the user in
 * front of the tab sees; the note is what everyone else gets.
 *
 * Editor-only by construction: it lives behind the `/__editor` server, so a
 * standalone `npm run game` page (which has no such server) never runs it —
 * no game-side flag is involved.
 */

import { commandLine } from '@volter/editor-sdk/kit/product-command';
import { useEffect, useRef, useState } from 'react';
import { pollEditorLeaseIdentity } from '../editor-api';
import {
  DEFAULT_LEASE_FAILURE_THRESHOLD,
  decideLeaseRecovery,
  decideLeaseState,
  forgetLeaseFailures,
  initialLeaseWatchState,
  LEASE_MIN_DARK_WINDOW_MS,
  LEASE_POLL_INTERVAL_MS,
  type LeaseChannelState,
  type LeasePollResult,
  type LeaseVoidReason,
  type LeaseWatchState,
  reduceLeasePoll,
} from '../editor-lease';
import { publishEditorLeaseView } from '../editor-lease-view';
import { dismissNotification, notify } from '../editor-notifications';
import { connectEvents, readControlChannelState } from '../editor-presence';
import { clearSessionOrphanRecord, writeSessionOrphanRecord } from '../session-orphan-record';
import { clearSessionEnded, markSessionEnded } from '../session-tombstone';

/** The last path segment of a project root, for user-facing copy. */
function projectName(path: string | null): string | null {
  if (!path) return null;
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? null;
}

/**
 * The one-shot teardown a void lease triggers: drop the Colyseus room (via the
 * game's React unmount) and stop the sim. `exitPlayMode` is imported lazily so
 * the guard — and therefore AppRoot's module graph — never eagerly pulls in the
 * engine renderer play-mode drags along; it is only needed on the rare void,
 * not on the poll cadence. A teardown throw is swallowed: the overlay must
 * still tell the user the tab is dead.
 */
async function tearDownVoidLease(): Promise<void> {
  try {
    const { stopAllLiveSessions } = await import('../live-session-registry');
    stopAllLiveSessions();
  } catch {
    /* the overlay is raised regardless — see above */
  }
}

/**
 * What the guard is currently showing. `void` carries whether a fresh boot is
 * on offer, so the overlay can hand back a way out instead of being a dead end.
 */
type GuardView =
  | { kind: 'quiet' }
  /** `busy` — polls failing over a live channel. `stale` — a real void the
   *  user chose to keep reading; the page is a snapshot and says so. */
  | { kind: 'degraded'; subject: 'busy' | 'stale' }
  | { kind: 'void'; reason: LeaseVoidReason; reloadOffered: boolean };

/**
 * Mounts the watchdog and renders its notice. Place it at the editor root
 * (AppRoot) so the overlay covers the whole editor.
 */
export function EditorLeaseGuard() {
  const [view, setView] = useState<GuardView>({ kind: 'quiet' });
  // The rolling watch state and the one-shot latches live in refs: the interval
  // closure reads them without re-subscribing, and the teardown must run
  // exactly once per void.
  const stateRef = useRef<LeaseWatchState>(initialLeaseWatchState(Date.now()));
  const voidedRef = useRef<LeaseVoidReason | null>(null);
  // Sticky for the page: once the user says "continue anyway", this guard never
  // blocks them again. A second scrim after an explicit dismissal is the same
  // trap wearing a later timestamp.
  const dismissedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Say it, THEN clean up. The timer keeps running for `server-gone` so the
    // tombstone can recover; `taken-over` stops, because that tab yielded to a
    // live window and must never come back to fight it.
    const enterVoidState = async (reason: LeaseVoidReason) => {
      voidedRef.current = reason;
      // The page-wide latch: from here the command listener refuses relayed
      // traffic and reports itself detached, so the server's tab table stops
      // treating this page as a live editor (`session-tombstone.ts`). The
      // overlay below is the human half of the same fact.
      markSessionEnded(reason);
      if (reason === 'taken-over') stop();
      // ORDER IS THE POINT. Everything that tells somebody — the overlay on
      // screen and the note for the next session — happens before the
      // teardown, and neither touches the network. The teardown is a dynamic
      // import; today it resolves from the module cache, but the server whose
      // module graph it belongs to is by definition dead at this instant, and
      // a page that announces its own death only after a fetch to the corpse
      // has the failure mode this whole file exists to remove.
      if (reason === 'server-gone') {
        writeSessionOrphanRecord({
          at: Date.now(),
          reason: 'server-gone',
          project: stateRef.current.bootIdentity?.project ?? null,
        });
      }
      setView(
        dismissedRef.current
          ? { kind: 'degraded', subject: 'stale' }
          : { kind: 'void', reason, reloadOffered: false },
      );
      await tearDownVoidLease();
    };

    // The tombstone watch: this page has already declared itself dead and is
    // now only asking whether anything came back. `taken-over` never reaches
    // here — its timer stops, because that tab yielded to a live window.
    const tickTombstone = (result: LeasePollResult, channel: LeaseChannelState, now: number) => {
      switch (decideLeaseRecovery(stateRef.current.bootIdentity, result)) {
        case 'resume': {
          // The SAME process answered: it was never gone, so nothing here is
          // stale and the session is kept. This is the branch that turns a
          // false void back into a working editor.
          voidedRef.current = null;
          // …and the page is live again, so lift the tombstone: control
          // traffic must stop being refused the moment the evidence says the
          // process never died.
          clearSessionEnded();
          // Retract the note too. It said this window was orphaned; the
          // process answering proves it was not, and a record nobody can
          // trust is worse than none.
          clearSessionOrphanRecord();
          stateRef.current = reduceLeasePoll(stateRef.current, result, channel, now);
          setView({ kind: 'quiet' });
          return;
        }
        case 'reload':
          // A new process serves our project: the page IS stale, so a full
          // boot is the honest recovery (../editor-lease.ts revival contract).
          // Unless the user asked to keep this window — "continue anyway"
          // means exactly "do not take it away from me", and overriding that
          // is the same class of defect as the scrim it dismissed.
          if (dismissedRef.current) return;
          window.location.reload();
          return;
        case 'offer-reload':
          setView((current) =>
            current.kind === 'void' && !current.reloadOffered
              ? { ...current, reloadOffered: true }
              : current,
          );
          return;
        default:
          return;
      }
    };

    const tick = async () => {
      const result = await pollEditorLeaseIdentity();
      const channel = readControlChannelState();
      const now = Date.now();
      if (cancelled) return;

      if (voidedRef.current !== null) {
        tickTombstone(result, channel, now);
        return;
      }

      stateRef.current = reduceLeasePoll(stateRef.current, result, channel, now);
      const next = decideLeaseState({
        consecutiveFailures: stateRef.current.consecutiveFailures,
        unbackedFailures: stateRef.current.unbackedFailures,
        failureThreshold: DEFAULT_LEASE_FAILURE_THRESHOLD,
        darkForMs: now - stateRef.current.darkSince,
        minDarkWindowMs: LEASE_MIN_DARK_WINDOW_MS,
        bootIdentity: stateRef.current.bootIdentity,
        lastIdentity: stateRef.current.lastIdentity,
      });
      if (next.status === 'void' && next.reason !== null) {
        await enterVoidState(next.reason);
        return;
      }
      setView(
        next.status === 'degraded' ? { kind: 'degraded', subject: 'busy' } : { kind: 'quiet' },
      );
    };

    // One poll at a time. The interval and the event triggers below all land
    // in here, and overlapping polls would fold two readings of the same
    // moment into the counter as if they were two moments.
    let polling = false;
    const poll = () => {
      if (polling || cancelled) return;
      polling = true;
      void tick().finally(() => {
        polling = false;
      });
    };

    // The page was NOT RUNNING and now is. Measured 2026-08-19: a hidden tab
    // whose server had been killed made no network attempt of any kind for
    // four and a half minutes — the browser had suspended the page and its
    // heartbeat worker with it. Until the tab is shown again there is no
    // watchdog, only a timer the browser has stopped calling; the ONLY moment
    // that matters is this one, and waiting a further interval to look would
    // spend the user's first clicks hanging on a server the page could have
    // asked about immediately.
    //
    // The failure run is dropped first: those counters are testimony about
    // elapsed time and this page slept through it (see `forgetLeaseFailures`).
    const wake = () => {
      if (cancelled) return;
      if (voidedRef.current === null) {
        stateRef.current = forgetLeaseFailures(stateRef.current, Date.now());
      }
      poll();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', wake);

    // The control socket is the fast half of the evidence: a killed process
    // drops it in milliseconds, while the poll cadence is seconds. Looking the
    // instant it moves — in EITHER direction — is what makes the notice track
    // the server rather than the clock. No reset here: unlike a wake, these
    // fire on a page that has been awake and watching, so its readings stand,
    // and resetting on the reconnect attempts a dead server produces would
    // stop the run from ever accumulating.
    let channelEvents: { close(): void } | null = null;
    try {
      const events = connectEvents();
      events.addEventListener('error', poll);
      events.addEventListener('open', poll);
      channelEvents = events;
    } catch {
      // No control channel available on this page (no `EventSource`, a
      // transport the bootstrap never built). The interval below still runs;
      // the guard is simply back to its slower reading.
    }

    timer = setInterval(poll, LEASE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', wake);
      channelEvents?.close();
    };
  }, []);

  // STATE goes to the status bar (`editor-lease-view.ts`); the EVENT goes to
  // the notification stack. Neither blocks the page: the modal this guard
  // used to raise ate every click on a window that was often perfectly
  // readable, and the owner named it (2026-09-04) as the wrong shape.
  useEffect(() => {
    publishEditorLeaseView(view);
    const name = projectName(stateRef.current.bootIdentity?.project ?? null);
    const dismiss = () => {
      dismissedRef.current = true;
      setView({ kind: 'degraded', subject: 'stale' });
    };
    if (view.kind === 'quiet') {
      dismissNotification(LEASE_NOTIFICATION_ID);
      return;
    }
    if (view.kind === 'degraded') {
      notify({
        id: LEASE_NOTIFICATION_ID,
        tone: 'warning',
        sticky: true,
        ...(view.subject === 'busy'
          ? {
              title: 'Editor server is slow to answer.',
              detail:
                'Still connected — this window keeps working, and this clears itself when the server catches up.',
            }
          : {
              title: "This window's editor server has stopped.",
              detail:
                'You chose to keep reading it — nothing here saves, and it will not reconnect on its own. Reload once the editor is served here again.',
              actions: [{ label: 'Reload', primary: true, run: () => window.location.reload() }],
            }),
      });
      return;
    }
    notify({
      id: LEASE_NOTIFICATION_ID,
      tone: 'error',
      sticky: true,
      title: 'Editor disconnected.',
      detail:
        view.reason === 'taken-over'
          ? `${name ? `${name}'s` : "This project's"} editor is now running in another window. This one has yielded.`
          : `This window's editor server has stopped — nothing here is saved, and a running game has left its room. Reopen with ${commandLine(`edit ${name ?? '<project>'}`)}${name ? `, or leave this window open: it reloads by itself when ${name}'s editor is served here again.` : '.'}`,
      onDismiss: () => {
        if (!dismissedRef.current) dismiss();
      },
      actions: [
        ...(view.reloadOffered
          ? [{ label: 'Reload', primary: true, run: () => window.location.reload() }]
          : []),
        { label: 'Close window', run: () => window.close() },
        { label: 'Continue anyway', run: dismiss },
      ],
    });
  }, [view]);

  return null;
}

const LEASE_NOTIFICATION_ID = 'editor-lease';
