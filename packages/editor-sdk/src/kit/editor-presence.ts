import type { EditorControlLifecycle } from '@volter/editor-sdk/session/editor-control-lifecycle';
import { COMMAND_RESULT_RECEIPT_EVENT } from '@volter/editor-sdk/session/editor-control-protocol';
import { isCancellationReason } from '@volter/editor-sdk/kit/cancellation-reason';
// Type-only: erased at compile, so the pre-React bootstrap module stays
// dependency-light while the channel vocabulary keeps ONE owner.
import type { LeaseChannelState } from './editor-lease';
import {
  COLLABORATION_PARTICIPANT_ID,
  COLLABORATION_PARTICIPANT_NAME,
} from '@volter/editor-sdk/kit/editor-session-attribution';
import { onSessionEndedChange } from './session-tombstone';
import type { TabCensus } from './tab-census';
import { type EditorTabRoute, installTabLifecycleListeners } from './tab-lifecycle-client';

const BASE = '/__editor';

interface EditorPresenceBootstrap {
  clientId: string;
  participantId: string;
  displayName: string;
  /**
   * This TAB's identity (sessionStorage, survives reloads) and this
   * page-load's `epoch`. Minted by the inline bootstrap, which also starts
   * the heartbeat worker that proves the tab to the server — see
   * `server/tab-presence.ts`. Absent only where there is no inline bootstrap
   * at all (browser-mode builds, jsdom tests).
   */
  tabId?: string;
  epoch?: string;
  /** The generation record most recently accepted by the server. */
  controlLifecycle?: EditorControlLifecycle | null;
  /**
   * Hand this tab's resource census to the heartbeat worker, which carries it
   * out on the next beat and then drops it (`server/tab-presence.ts`'s
   * `TabCensus`) — one call, one sample the server files. Absent wherever the
   * inline bootstrap is — browser-mode builds, jsdom tests, a tunnelled tab
   * that was refused the worker script.
   */
  reportCensus?: (census: TabCensus) => void;
  /** Hand the heartbeat worker what the page's main thread is about to do
   *  (`building src/models/x.ts`) or that it is done (`null`): the beat
   *  carries it while the page itself cannot speak. */
  reportPhase?: (phase: string | null, source: string, sequence: number) => void;
  /**
   * Stop the heartbeat worker, withdrawing this tab from the server's tab
   * table. The one caller is a TERMINAL session tombstone
   * (`session-tombstone.ts`) — see the bootstrap's own comment in index.html
   * for why a beating corpse is what this closes. Absent wherever the inline
   * bootstrap is.
   */
  stopHeartbeat?: () => void;
  source: PresenceEventSource | null;
  pageOwned: boolean;
  pending: Array<{ type: string; data: string }>;
  queueListeners: Array<{ type: string; listener: EventListener }>;
}

type PresenceEventSource = Pick<
  EventSource,
  'addEventListener' | 'removeEventListener' | 'dispatchEvent' | 'close'
> & {
  /**
   * Upstream control frame, present only on the duplex control socket the
   * inline bootstrap builds (index.html). Returns false when this transport
   * cannot carry it — an `EventSource`, or a socket the server has not
   * granted duplex to (the share tunnel bridges the SSE stream one way).
   *
   * Type and payload are separate ARGUMENTS, never one merged object: the
   * payload is open-ended (a state snapshot is whatever the editor reports),
   * so sharing a namespace with the discriminator would both leak `type`
   * into the state the server stores and let a payload key named `type`
   * silently redirect the frame.
   */
  send?(type: string, payload: Record<string, unknown>): boolean;

  /**
   * Whether this transport's connection to the server is UP right now.
   * Present only on the duplex control socket the inline bootstrap builds
   * (index.html). A real `EventSource` exposes the equivalent as its numeric
   * `readyState`, which `readControlChannelState` reads instead.
   */
  readonly connected?: boolean;
};

const bootstrapGlobal = globalThis as typeof globalThis & {
  __VGAI_EDITOR_PRESENCE_BOOTSTRAP__?: EditorPresenceBootstrap;
};
const bootstrap = bootstrapGlobal.__VGAI_EDITOR_PRESENCE_BOOTSTRAP__;

export const EDITOR_CLIENT_ID =
  bootstrap?.clientId ?? globalThis.crypto?.randomUUID?.() ?? `editor-${Date.now()}`;
export const EDITOR_PARTICIPANT_ID = COLLABORATION_PARTICIPANT_ID;
export const EDITOR_PARTICIPANT_NAME = COLLABORATION_PARTICIPANT_NAME;

/**
 * Push this tab's resource census onto the heartbeat.
 *
 * A no-op wherever there is no inline bootstrap (browser-mode builds, jsdom):
 * the census is diagnostics, and diagnostics that break their host are worse
 * than none.
 */
export function reportTabPhase(phase: string | null, source: string, sequence: number): void {
  bootstrap?.reportPhase?.(phase, source, sequence);
}

export function reportTabCensus(census: TabCensus): void {
  bootstrap?.reportCensus?.(census);
}

/**
 * WITHDRAW THIS TAB from the server's tab table. Terminal tombstones only
 * (`session-tombstone.ts`).
 *
 * Presence is a UNION (`server/tab-presence.ts`): a fresh BEAT **or** a live
 * control channel. Both halves therefore have to go, and measured live on
 * 2026-08-15, stopping only the beat was not enough — the inert page's control
 * socket reconnected to the successor server on the same port, which kept the
 * corpse present, blessed, and reported as `commandListener not attached`
 * while `vgai edit` answered "focused" instead of opening a real tab.
 *
 * The channel is closed unconditionally, not by releasing a reference: this
 * page is over, so there is no consumer whose refcount could legitimately hold
 * it open. Both calls are no-ops where the inline bootstrap never ran (browser
 * mode, jsdom), which is also where the tab was never in the table.
 */
export function withdrawTabFromSession(): void {
  bootstrap?.stopHeartbeat?.();
  const real = sharedSource;
  if (real === null) return;
  sharedSource = null;
  sharedRefCount = 0;
  if (bootstrap?.source === real) bootstrap.source = null;
  if (lifecycleSource === real) lifecycleSource = null;
  try {
    real.close();
  } catch {
    /* the socket is going away with the page regardless */
  }
}

function eventsUrl(): string {
  const query = new URLSearchParams({
    clientId: EDITOR_CLIENT_ID,
    participantId: EDITOR_PARTICIPANT_ID,
    displayName: EDITOR_PARTICIPANT_NAME,
  });
  if (bootstrap?.tabId) query.set('tabId', bootstrap.tabId);
  return `${BASE}/events?${query}`;
}

/**
 * The subset of `EventSource` used by editor event consumers. `close()` only
 * releases the calling consumer; one real socket is shared by the whole page.
 */
export interface EditorEventSource {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

let sharedSource: PresenceEventSource | null = bootstrap?.source ?? null;
let sharedRefCount = bootstrap?.source && bootstrap.pageOwned ? 1 : 0;
let lifecycleSource: PresenceEventSource | null = null;

/**
 * Buffered types whose replay must wait for their own consumer.
 *
 * The tab-* events are replayed by `installLifecycle` because
 * `installTabLifecycleListeners` has just attached their listeners — the
 * consumer is in place before the drain. `editor-command` is different: its
 * listener is attached by `connectCommandListener`, once the whole React
 * graph has loaded, long after boot. Replaying it at boot would dispatch it
 * to zero listeners and lose it exactly as not buffering it did.
 */
const DEFERRED_REPLAY_TYPES = new Set(['editor-command']);

/**
 * Hand back the buffered events whose type `accept`s, and stop buffering
 * that type — its consumer is now attached, so later events reach it
 * directly. Everything else stays queued for its own consumer.
 */
function drainBootstrap(source: PresenceEventSource, accept: (type: string) => boolean): void {
  if (!bootstrap || bootstrap.source !== source) return;
  bootstrap.queueListeners = bootstrap.queueListeners.filter(({ type, listener }) => {
    if (!accept(type)) return true;
    source.removeEventListener(type, listener);
    return false;
  });
  const replay = bootstrap.pending.filter((event) => accept(event.type));
  bootstrap.pending = bootstrap.pending.filter((event) => !accept(event.type));
  for (const { type, data } of replay) {
    source.dispatchEvent(new MessageEvent(type, { data }));
  }
}

function installLifecycle(source: PresenceEventSource): void {
  if (lifecycleSource === source) return;
  lifecycleSource = source;
  // This tab's identity rides along so `tab-close` can be ACKNOWLEDGED: the
  // bootstrap global is read here and nowhere else.
  installTabLifecycleListeners(source, BASE, { tabId: bootstrap?.tabId, epoch: bootstrap?.epoch });
  drainBootstrap(source, (type) => !DEFERRED_REPLAY_TYPES.has(type));
}

/**
 * Connect to the editor's shared SSE stream.
 *
 * Keeping this implementation in a dependency-light module is intentional:
 * index.html imports it before the React entry so the server sees the tab even
 * while Vite is still loading or optimizing the much larger editor graph.
 */
export function connectEvents(): EditorEventSource {
  if (!sharedSource) {
    if (bootstrap?.source) {
      sharedSource = bootstrap.source;
      if (bootstrap.pageOwned) sharedRefCount++;
    } else {
      sharedSource = new EventSource(eventsUrl());
      if (bootstrap) bootstrap.source = sharedSource;
    }
  }
  const real = sharedSource;
  installLifecycle(real);
  sharedRefCount++;

  const ownListeners: Array<{ type: string; listener: EventListener }> = [];
  let released = false;

  return {
    addEventListener(type, listener) {
      const wrapped = listener as EventListener;
      real.addEventListener(type, wrapped);
      ownListeners.push({ type, listener: wrapped });
      // The consumer this type was buffered FOR has just arrived. Replaying
      // here — rather than at boot — is the whole point of the deferral.
      if (DEFERRED_REPLAY_TYPES.has(type)) drainBootstrap(real, (queued) => queued === type);
    },
    removeEventListener(type, listener) {
      const wrapped = listener as EventListener;
      real.removeEventListener(type, wrapped);
      const idx = ownListeners.findIndex((item) => item.type === type && item.listener === wrapped);
      if (idx >= 0) ownListeners.splice(idx, 1);
    },
    close() {
      if (released) return;
      released = true;
      for (const { type, listener } of ownListeners) real.removeEventListener(type, listener);
      ownListeners.length = 0;
      sharedRefCount--;
      if (sharedRefCount <= 0) {
        real.close();
        if (sharedSource === real) sharedSource = null;
        // The bootstrap holds its own reference, and `connectEvents` adopts
        // it before minting a socket. Leaving it pointing at the one we just
        // closed would hand the next caller a dead EventSource that never
        // reconnects and never errors — it would simply go quiet.
        if (bootstrap?.source === real) bootstrap.source = null;
        if (lifecycleSource === real) lifecycleSource = null;
        sharedRefCount = 0;
      }
    },
  };
}

/**
 * Is this page's control connection to its editor server up?
 *
 * The supervised lease (editor-lease.ts) reads this as its SECOND liveness
 * signal, independent of the HTTP poll: a fetch can fail because the browser's
 * per-origin pool is saturated by a cold module flood or because the server's
 * event loop is blocked, neither of which means the session is gone — but a
 * dead PROCESS cannot hold this socket open. Both readings together are what
 * separates "gone" from "busy".
 *
 * `unknown` is deliberate rather than an optimistic `open`: a transport that
 * exposes no connection state (the share tunnel's one-way SSE bridge) gives no
 * evidence, and absent evidence must not make the watchdog keener to keep a
 * dead tab alive. The lease treats it exactly like `closed`.
 */
export function readControlChannelState(): LeaseChannelState {
  const source = sharedSource ?? bootstrap?.source ?? null;
  if (!source) return 'unknown';
  if (typeof source.connected === 'boolean') return source.connected ? 'open' : 'closed';
  // A real `EventSource`: 0 CONNECTING, 1 OPEN, 2 CLOSED. Only OPEN is
  // evidence — a socket mid-reconnect proves nothing about the server.
  const readyState = (source as { readyState?: unknown }).readyState;
  if (typeof readyState === 'number') return readyState === 1 ? 'open' : 'closed';
  return 'unknown';
}

/** Hold this page's editor-session connection until its caller releases it. */
export function connectTabPresence(): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const events = connectEvents();
  // A TERMINAL tombstone withdraws this tab from the server's table — both
  // halves of the presence union. Subscribed HERE rather than inside
  // `session-tombstone.ts` so that module keeps no dependencies at all (and so
  // this file, which owns both doors, stays the only thing that touches them).
  // `server-gone` deliberately stays present: that page may still resume onto
  // the same process, and a tab that withdrew could not.
  const unsubscribeTombstone = onSessionEndedChange((state) => {
    if (state !== null && state.reason !== 'server-gone') withdrawTabFromSession();
  });
  const stopBootErrors = reportBootErrors();
  return () => {
    stopBootErrors();
    unsubscribeTombstone();
    events.close();
  };
}

/** How many boot failures one page-load reports. A module that throws inside a
 *  retry loop must not become a firehose; the first few say what broke. */
const BOOT_ERROR_CAP = 5;

/**
 * THE APP'S FIRST ERROR, reported by the layer that is already up.
 *
 * `installEditorConsoleCapture` hooks `error`/`unhandledrejection`, but it is
 * part of the editor app -- so when the app dies during init, that hook never
 * exists and the page reports NOTHING. The reporter sat downstream of the
 * failure it needed to describe.
 *
 * MEASURED 2026-09-15: a tab beat for the better part of an hour, answered
 * liveness echoes, and reported `commandListener not attached` with no page
 * error and an empty `vgai console` -- so `vgai status` could say only that
 * the app "never finished loading", which is the symptom, never the cause.
 * Every door the CLI offers was blind to a crash before the app came up.
 *
 * Presence is connected by this point, so this reports through the SAME
 * `console-entries` door the app uses later and lands in the same ledger
 * `vgai console` reads. A duplicate once the app's own capture starts is
 * deduplicated there by fingerprint.
 */
function reportBootErrors(): () => void {
  if (typeof window === 'undefined') return () => {};
  let sent = 0;
  const report = (message: string): void => {
    if (message === '' || sent >= BOOT_ERROR_CAP) return;
    sent += 1;
    void postControl('console-entries', {
      entries: [
        {
          id: `boot-error:${sent}`,
          severity: 'error',
          // Presence outlives startup. Report the error without claiming that
          // a running editor failed to boot (for example during a later reload).
          message: `editor runtime error: ${message}`,
          source: 'runtime',
          occurrences: 1,
        },
      ],
      _clientId: bootstrap?.clientId ?? 'boot',
    });
  };
  const onError = (event: ErrorEvent): void => {
    const error = event.error as Error | undefined;
    report(error?.stack ?? `${event.message} (${event.filename ?? '?'}:${event.lineno ?? 0})`);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason: unknown = event.reason;
    // A CANCELLATION IS NOT A FAILURE TO START. See `isCancellationReason`'s
    // own note in `editor-console.ts`: this listener is the page's, the page
    // under the Code-OSS frame is a WORKBENCH, and a workbench throws
    // `CancellationError` (`name === 'Canceled'`) whenever a quick input is
    // dismissed or a search is superseded. MEASURED 2026-09-19, the frame
    // walk's beat 9: `[runtime] editor app failed to start: Canceled: Canceled`
    // on a game scaffold whose editor had started perfectly. The claim in that
    // sentence was false in BOTH halves — nothing failed, and nothing was
    // starting.
    if (isCancellationReason(reason)) return;
    report(
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : `unhandled rejection: ${String(reason)}`,
    );
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * The five things this tab reports UPSTREAM, and the one door they go
 * through.
 *
 * Each has an equivalent POST route, and the POST is still the fallback —
 * the share tunnel's gateway bridges the SSE stream one way, so a tunnelled
 * tab has no upstream socket. But when the page holds a duplex control
 * socket (every local tab), these ride it instead. That is the entire point
 * of the socket: a blocked main thread cannot issue a `fetch`, and even an
 * unblocked one queues control POSTs behind a cold module flood in the
 * browser's per-origin HTTP connection pool.
 *
 * `play-phase` is the second of those standing facts, and it exists for the
 * same reason: it says which of play's eight boot steps the page is INSIDE,
 * published before the step runs, so a step that never returns is still named.
 * It rides its own message rather than the state snapshot on purpose — the
 * snapshot is the expensive derivation, and a page wedged inside a boot step is
 * exactly the page that cannot produce one. Measured at N=20000: `play`,
 * `screenshot` and `stop` all timed out and every reader called the session
 * healthy (`server/play-stall.ts`).
 *
 * `command-listener` is the odd one out: it reports nothing
 * about a command, only whether this page is in a position to run one. THIS
 * module opens the control channel before any other module loads, so a page
 * that dies during boot still connects, still beats, and still counts as
 * present — and every one of those facts is about the TAB, not the document.
 * The listener says so about the document, which is the only thing that
 * separates a healthy session from an eight-minute lie.
 */
export type EditorControlMessage =
  | 'command-received'
  | 'command-result'
  | 'command-listener'
  | 'console-entries'
  | 'console-resolved'
  | 'play-phase'
  | 'state'
  | 'tab-route';

/** A missing receipt must never strand deferred editor presentation forever. */
const CONTROL_RECEIPT_TIMEOUT_MS = 2_000;

const CONTROL_POST_PATHS: Record<EditorControlMessage, string> = {
  'command-received': `${BASE}/command-received`,
  'command-result': `${BASE}/command-result`,
  'command-listener': `${BASE}/command-listener`,
  'console-entries': `${BASE}/console-entries`,
  'console-resolved': `${BASE}/console-resolved`,
  'play-phase': `${BASE}/play-phase`,
  state: `${BASE}/state`,
  'tab-route': `${BASE}/tab/route`,
};

/** Send one control message on the socket, else POST it. Never throws — a
 *  failed report costs a named refusal, never a broken page.
 *
 *  Deliberately NOT read through `editor-server-response.ts`: never-throwing is
 *  this function's contract and there is no caller to report to, so asserting
 *  could only turn a dropped report into a swallowed one. The absence is
 *  detected at the READING end instead — `/__editor/state` goes stale and the
 *  CLI says so — which is where a missing report is actually visible. */
async function postControl(
  type: EditorControlMessage,
  payload: Record<string, unknown>,
): Promise<void> {
  if (typeof fetch === 'undefined') return;
  try {
    await fetch(CONTROL_POST_PATHS[type], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        ...(bootstrap?.controlLifecycle ? { _controlLifecycle: bootstrap.controlLifecycle } : {}),
      }),
    });
  } catch {
    // Relative URLs outside a real document (jsdom/tests) can throw
    // synchronously, and a dropped report must never take down the page.
  }
}

export async function sendControl(
  type: EditorControlMessage,
  payload: Record<string, unknown>,
): Promise<void> {
  const source = sharedSource ?? bootstrap?.source ?? null;
  if (source?.send?.(type, payload)) return;
  await postControl(type, payload);
}

/**
 * Report one command result and wait until its original caller is answered.
 *
 * `WebSocket.send()` only queues bytes; its return says nothing about whether
 * the relay accepted the result. Selection presentation depends on that
 * distinction: the server must release the waiting control caller before a
 * large hierarchy/inspector render can monopolize the editor page again.
 *
 * The server answers with {@link COMMAND_RESULT_RECEIPT_EVENT} only after the
 * original command caller's response has finished. That works for both a
 * native duplex result and a tunnelled/SSE result posted upstream. The timeout
 * preserves the standing control-channel rule that a vanished server may drop
 * a report but must never leave the editor page wedged.
 */
export async function sendCommandResultControl(
  requestId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const source = sharedSource ?? bootstrap?.source ?? null;
  if (!source) {
    await postControl('command-result', payload);
    return;
  }

  let settle!: () => void;
  const receipt = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const onReceipt: EventListener = (event) => {
    const wireData = (event as MessageEvent).data;
    let received = wireData;
    if (typeof wireData === 'string') {
      try {
        received = JSON.parse(wireData);
      } catch {
        // Direct/fake event sources may already carry the unencoded id.
      }
    }
    if (received === requestId) settle();
  };
  source.addEventListener(COMMAND_RESULT_RECEIPT_EVENT, onReceipt);

  const resultPayload = { ...payload, _awaitCallerReceipt: true };
  if (!source.send?.('command-result', resultPayload)) {
    await postControl('command-result', resultPayload);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let acknowledged = false;
  await Promise.race([
    receipt.then(() => {
      acknowledged = true;
    }),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, CONTROL_RECEIPT_TIMEOUT_MS);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);

  // NO RECEIPT MEANS THE RESULT DID NOT LAND — SO SEND IT AGAIN, OVER HTTP.
  //
  // This is the whole reason the receipt exists (see the docblock: `send()`
  // only queues bytes), and until now nothing acted on its absence: the race
  // simply expired and the page dropped an answer it was still holding. The
  // caller then burned its entire command budget waiting for a result that had
  // already been computed.
  //
  // MEASURED 2026-09-15 on `02-hinged-vise`: a `blender-read-file` was relayed
  // 2.1 s before the socket closed 1006, the page reconnected, and the command
  // failed at exactly 60.0 s — its budget — with the tab's last heartbeat
  // 0.9 s old. The bytes went into a socket that died before the server read
  // them, and `send()` had already returned true.
  //
  // Re-posting is safe to do blind: `settlePendingCommand` returns early when
  // the request is no longer pending, so a duplicate result is a no-op, and
  // the HTTP path does not depend on the socket that just died.
  if (!acknowledged) await postControl('command-result', payload);
  source.removeEventListener(COMMAND_RESULT_RECEIPT_EVENT, onReceipt);
}

/** Tell the local editor session which surface this tab is showing. */
export function reportTabRoute(route: EditorTabRoute): void {
  void sendControl('tab-route', {
    clientId: EDITOR_CLIENT_ID,
    participantId: EDITOR_PARTICIPANT_ID,
    route,
  });
}
