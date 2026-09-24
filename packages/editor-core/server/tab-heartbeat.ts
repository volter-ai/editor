/**
 * THE HEARTBEAT TRANSPORT — a dedicated Worker in every editor tab, beating
 * once a second over a socket of its own, and the server end that listens.
 *
 * WHY A WORKER, and not the page. Three properties, none of which the page's
 * own control socket has:
 *
 *  - It keeps beating while the page's MAIN THREAD IS BLOCKED. That is not a
 *    hypothetical: a cold editor boot blocked a real tab for 60-100s on
 *    2026-08-09, and every conclusion the server drew during that window
 *    ("did not acknowledge", "disconnected") was wrong.
 *  - Its socket is NOT the page's socket, so a page-side reconnect, a Vite
 *    reload, or a module flood in the browser's per-origin connection pool
 *    cannot take presence down with it.
 *  - It DIES EXACTLY WHEN THE TAB DIES. A dedicated worker is owned by its
 *    document; close the tab and the beats stop within one interval. No
 *    unload handler to miss, no close code to interpret.
 *
 * WHY A STATIC SCRIPT the server hands out, rather than a bundled module: the
 * worker must exist before the module graph does — that is the entire point —
 * so it cannot be part of it. It is plain JS, dependency-free, served from
 * this file's own constant so there is no build step and no file to lose in a
 * packaged build.
 *
 * HIDDEN TABS. Chrome throttles timers in background pages and may throttle
 * workers, so the cadence is NOT assumed to hold. Two things cover it: beats
 * carry the page's last-known visibility (the server extends that tab's
 * grace), and the server PROBES a tab whose beats have gapped. The worker
 * answers a probe from its `message` handler, and message delivery is not
 * throttled — so a hidden tab that is alive stays present indefinitely, and
 * one that is not is departed on the evidence rather than on a guess.
 */

import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { TabStallMetrics, WorkerCallTabMetrics } from '@volter/editor-sdk/project/tab-census';
import type { RawSocketRoute } from './editor-control-socket';
import type { TabBeat, TabCensus, TabCloseBeacon, TabVisibility } from './tab-presence';

/** The worker's own socket path — never the page's. */
export const TAB_HEARTBEAT_PATH = '/__editor/heartbeat';

/**
 * Where a page's GOODBYE lands — `pagehide` → `navigator.sendBeacon`.
 *
 * A route of its own, and the tiniest one in the server, for the same reason
 * the heartbeat POST is: it has to be deliverable by a document that is
 * already gone. `sendBeacon` is the one transport the browser promises after
 * unload, and it cannot read a response — so this route answers 204 and the
 * page never learns whether it arrived. That is fine: a lost beacon degrades
 * to `crashed`, which is what the server believed before this existed.
 */
export const TAB_CLOSE_PATH = '/__editor/tab/close';

/** Where the worker script itself is served from. */
export const TAB_HEARTBEAT_WORKER_PATH = '/__editor/tab-heartbeat.js';

/** The beat cadence the worker uses, and the number the grace is derived from. */
export const TAB_HEARTBEAT_INTERVAL_MS = 1_000;

/**
 * The worker source, verbatim.
 *
 * Deliberately tiny and defensive: it is the one piece of this session that
 * must keep running when everything else in the tab has stopped, so it has no
 * imports, no optional chaining on hot paths, and no way to throw out of a
 * timer. `fetch` is the fallback for every beat the socket cannot carry, and
 * reconnection is forever with capped backoff — a heartbeat that gives up is
 * a tab the server will declare departed while the user is looking at it.
 */
export const TAB_HEARTBEAT_WORKER_SOURCE = `/* vgai tab heartbeat — served by packages/editor/server/tab-heartbeat.ts */
'use strict';
var cfg = null;
var socket = null;
var seq = 0;
var visibility = 'visible';
var census = null;
/* undefined: nothing to say; { value } once the page announced a phase. */
var phase = undefined;
var retryMs = 250;
var beatTimer = null;
var stopped = false;

function body() {
  seq += 1;
  var frame = { tabId: cfg.tabId, epoch: cfg.epoch, seq: seq, visibility: visibility };
  /* The page's latest resource profile rides along ONCE and is then dropped
     (server/tab-presence.ts TabCensus). Carried, never sampled here: a worker
     cannot see the document's canvases and performance.memory is a page
     property.

     WHY IT IS DROPPED — the invariant is that every census arriving at the
     server is a sample the PAGE just took. Echoing the cache on every 1 Hz
     beat made the server's filing stamp mean "the last beat that repeated the
     cache", rather than "the last time the page measured", so a hidden
     tab that stopped sampling half an hour ago still reported a half-second-
     old profile, and the death line's age — whose entire job is to say a
     stale profile is stale — was a plausible falsehood on exactly the path
     that matters most (Chrome kills BACKGROUND tabs under memory pressure).
     The page re-posts every 5s while visible and stops while hidden, so with
     the cache cleared the age simply grows, truthfully.

     A beat neither transport can deliver loses that one sample; the next is
     5s behind it. Coarser, never a lie: the server stamps only what arrived. */
  if (census !== null) {
    frame.census = census;
    census = null;
  }
  /* What the page's main thread is inside (or null: done), said once per
     change. It rides the beat because the page's own socket cannot send
     while the page is blocked — which is exactly when it matters. */
  if (phase !== undefined) {
    frame.phase = phase.value;
    frame.phaseSource = phase.source;
    frame.phaseSequence = phase.sequence;
    phase = undefined;
  }
  return frame;
}

function beat() {
  if (stopped || cfg === null) return;
  var frame = body();
  if (socket !== null && socket.readyState === 1) {
    try {
      socket.send(JSON.stringify(frame));
      return;
    } catch (error) {
      /* fall through to the POST */
    }
  }
  try {
    fetch(cfg.postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(frame),
      keepalive: true,
    }).catch(function () {});
  } catch (error) {
    /* a beat that cannot be sent is a gap the server will see and say so */
  }
}

function connect() {
  if (stopped || cfg === null) return;
  var next;
  try {
    next = new WebSocket(cfg.socketUrl);
  } catch (error) {
    setTimeout(connect, retryMs);
    retryMs = Math.min(5000, retryMs * 2);
    return;
  }
  socket = next;
  next.onopen = function () {
    retryMs = 250;
    beat();
  };
  next.onmessage = function (event) {
    var frame;
    try {
      frame = JSON.parse(String(event.data));
    } catch (error) {
      return;
    }
    if (!frame || typeof frame.type !== 'string') return;
    /* A PROBE is answered right here, in the message handler. That is the
       whole reason a probe exists: message delivery to a worker is not
       throttled the way its timers are, so a hidden tab answers even when
       its beat loop has been slowed to a crawl. */
    if (frame.type === 'probe') {
      beat();
      return;
    }
    /* "Duplicate Tab" copied this tab's sessionStorage. The page mints a
       fresh tabId and restarts us. */
    if (frame.type === 're-mint') self.postMessage({ type: 're-mint' });
  };
  next.onclose = function () {
    if (socket === next) socket = null;
    if (stopped) return;
    var wait = retryMs;
    retryMs = Math.min(5000, retryMs * 2);
    setTimeout(connect, wait);
  };
  next.onerror = function () {
    try {
      next.close();
    } catch (error) {
      /* onclose owns the retry */
    }
  };
}

self.onmessage = function (event) {
  var message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'start') {
    cfg = {
      tabId: String(message.tabId),
      epoch: String(message.epoch),
      socketUrl: String(message.socketUrl),
      postUrl: String(message.postUrl),
    };
    seq = 0;
    stopped = false;
    if (beatTimer !== null) clearInterval(beatTimer);
    beatTimer = setInterval(beat, ${TAB_HEARTBEAT_INTERVAL_MS});
    connect();
    beat();
    return;
  }
  if (message.type === 'visibility') {
    visibility = message.visibility === 'hidden' ? 'hidden' : 'visible';
    beat();
    return;
  }
  /* A fresh resource profile from the page. Stored, NOT beaten on: the next
     beat is at most a second away and an extra frame per sample would be
     traffic bought for nothing. */
  if (message.type === 'census') {
    census = message.census === null || typeof message.census !== 'object' ? null : message.census;
    return;
  }
  if (message.type === 'phase') {
    phase = { value: typeof message.phase === 'string' ? message.phase : null,
      source: message.source, sequence: message.sequence };
    return;
  }
  if (message.type === 'stop') {
    stopped = true;
    if (beatTimer !== null) clearInterval(beatTimer);
    beatTimer = null;
    if (socket !== null) {
      try {
        socket.close();
      } catch (error) {
        /* going away regardless */
      }
    }
  }
};
`;

/** A finite number, or null for anything else (including NaN and a string). */
function finite(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** A plain object, or null for anything else (arrays included). */
function objectRecord(raw: unknown): Record<string, unknown> | null {
  return raw === null || typeof raw !== 'object' || Array.isArray(raw)
    ? null
    : (raw as Record<string, unknown>);
}

/**
 * One lane's worker calls on a census. Parsed with the same posture as the rest
 * of this file: a field the page could not measure stays NULL (no call yet), and
 * the lane is dropped rather than half-filed if its counters are not numbers. A
 * malformed block must never cost the census it rode in on.
 */
function parseWorkerCallLane(raw: unknown): WorkerCallTabMetrics | undefined {
  const record = objectRecord(raw);
  if (record === null) return undefined;
  const callsOver5s = finite(record['callsOver5s']);
  const callsOver30s = finite(record['callsOver30s']);
  if (callsOver5s === null || callsOver30s === null) return undefined;
  return {
    inFlightMs: finite(record['inFlightMs']),
    lastCallMs: finite(record['lastCallMs']),
    maxCallMs: finite(record['maxCallMs']),
    callsOver5s,
    callsOver30s,
    lastCallLongestTaskMs: finite(record['lastCallLongestTaskMs']),
    wasmMemoryMB: finite(record['wasmMemoryMB']),
  };
}

/** Every well-formed lane on a census, or undefined when the beat carried none
 *  (the usual case: no lane published a meter). */
function parseWorkerCalls(raw: unknown): Record<string, WorkerCallTabMetrics> | undefined {
  const record = objectRecord(raw);
  if (record === null) return undefined;
  const lanes: Record<string, WorkerCallTabMetrics> = {};
  for (const [lane, value] of Object.entries(record)) {
    const parsed = parseWorkerCallLane(value);
    if (parsed !== undefined) lanes[lane] = parsed;
  }
  return Object.keys(lanes).length === 0 ? undefined : lanes;
}

/** The main thread's stalls on a census, or undefined when nobody watched. */
function parseStalls(raw: unknown): TabStallMetrics | undefined {
  const record = objectRecord(raw);
  if (record === null) return undefined;
  const tasksOver100ms = finite(record['tasksOver100ms']);
  if (tasksOver100ms === null) return undefined;
  return { longestTaskMs: finite(record['longestTaskMs']), tasksOver100ms };
}

/**
 * The resource profile carried on a beat, or null when the frame has none.
 *
 * Strict about the two fields that are always measurable (`canvases`,
 * `canvasMB`) and honest about the rest: a heap the browser will not report
 * stays null, and a renderer count the page could not read stays ABSENT. A
 * zero here would read as "no textures", which is a different claim from
 * "nobody measured".
 */
export function parseCensus(raw: unknown): TabCensus | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const canvases = finite(record['canvases']);
  const canvasMB = finite(record['canvasMB']);
  const mountEpochs = finite(record['mountEpochs']);
  if (canvases === null || canvasMB === null || mountEpochs === null) return null;
  const textures = finite(record['textures']);
  const geometries = finite(record['geometries']);
  const programs = finite(record['programs']);
  const workerCalls = parseWorkerCalls(record['workerCalls']);
  const stalls = parseStalls(record['stalls']);
  return {
    heapUsedMB: finite(record['heapUsedMB']),
    heapLimitMB: finite(record['heapLimitMB']),
    mountEpochs,
    canvases,
    canvasMB,
    ...(textures === null ? {} : { textures }),
    ...(geometries === null ? {} : { geometries }),
    ...(programs === null ? {} : { programs }),
    ...(workerCalls === undefined ? {} : { workerCalls }),
    ...(stalls === undefined ? {} : { stalls }),
  };
}

/** One close beacon, or null when the payload is not one. `persisted` defaults
 *  to false: an absent flag is "the page did not say it was cached", never a
 *  guess that it was. `reason` defaults to `'pagehide'` for the same reason and
 *  one more — that is what index.html's bootstrap beacon has always meant, and
 *  it keeps that beacon unchanged. Only the exact word `'session-ended'` is an
 *  acknowledgement; anything else is a page going away. */
export function parseTabClose(raw: unknown): TabCloseBeacon | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const tabId = record['tabId'];
  const epoch = record['epoch'];
  if (typeof tabId !== 'string' || tabId === '' || typeof epoch !== 'string' || epoch === '') {
    return null;
  }
  return {
    tabId,
    epoch,
    persisted: record['persisted'] === true,
    reason: record['reason'] === 'session-ended' ? 'session-ended' : 'pagehide',
  };
}

/** One beat frame, or null when the payload is not one. */
export function parseBeat(raw: unknown): TabBeat | null {
  // A socket frame arrives as a Buffer, which IS an object — so "already an
  // object, use it as-is" has to exclude binary or every WebSocket beat is
  // read as an empty record and silently dropped. Only a POST body (already
  // JSON-parsed by express) takes the fast path.
  const isParsedBody =
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    !ArrayBuffer.isView(raw) &&
    !(raw instanceof ArrayBuffer);
  let frame: unknown;
  try {
    frame = isParsedBody ? raw : JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!frame || typeof frame !== 'object') return null;
  const record = frame as Record<string, unknown>;
  const tabId = record['tabId'];
  const epoch = record['epoch'];
  if (typeof tabId !== 'string' || tabId === '' || typeof epoch !== 'string' || epoch === '') {
    return null;
  }
  const visibility: TabVisibility = record['visibility'] === 'hidden' ? 'hidden' : 'visible';
  const seq = Number(record['seq']);
  const census = parseCensus(record['census']);
  const rawPhase = record['phase'];
  const phase = rawPhase === null || typeof rawPhase === 'string' ? rawPhase : undefined;
  return {
    tabId,
    epoch,
    seq: Number.isSafeInteger(seq) ? seq : 0,
    visibility,
    // A malformed census must never cost a beat: presence is the beat's job,
    // and the profile is a passenger.
    ...(census === null ? {} : { census }),
    ...(phase === undefined ? {} : { phase }),
    ...(typeof record['phaseSource'] === 'string' && Number.isSafeInteger(record['phaseSequence'])
      ? { phaseSource: record['phaseSource'], phaseSequence: record['phaseSequence'] as number } : {}),
  };
}

export interface TabHeartbeatOptions {
  /** Same origin gate the control-socket upgrade uses. */
  authorize(request: IncomingMessage, url: URL): string | null;
  /**
   * One beat. Returns `'re-mint'` when this tab's sessionStorage was copied
   * and the sender must take a fresh identity.
   */
  beat(beat: TabBeat): 're-mint' | null;
  /** A heartbeat socket opened or closed (a reconcile hint, never a verdict). */
  hint?(): void;
}

export interface TabHeartbeatServer extends RawSocketRoute {
  /**
   * Ask every tab whose beats have gapped to answer NOW. Called by the
   * reconciler, not by a timer of its own — probing is a question the TABLE
   * asks, so the table decides who is worth asking.
   */
  probe(tabIds: readonly string[]): void;
  /** How many heartbeat sockets this tab currently holds (diagnostics/tests). */
  socketCount(tabId: string): number;
  close(): void;
}

/**
 * The server end. It owns sockets and nothing else: every beat goes straight
 * to `options.beat`, and no presence decision is made here. That separation
 * is the point — a transport that also decided would be a second opinion
 * about who is present, and two opinions is exactly the bug this replaces.
 */
export function createTabHeartbeatServer(options: TabHeartbeatOptions): TabHeartbeatServer {
  const socketsByTab = new Map<string, Set<WebSocket>>();

  const forget = (tabId: string, socket: WebSocket): void => {
    const set = socketsByTab.get(tabId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) socketsByTab.delete(tabId);
  };

  return {
    path: TAB_HEARTBEAT_PATH,
    authorize: options.authorize,
    open(socket, url) {
      const declaredTabId = url.searchParams.get('tabId') ?? '';
      let tabId = declaredTabId;
      if (tabId !== '') {
        const set = socketsByTab.get(tabId) ?? new Set<WebSocket>();
        set.add(socket);
        socketsByTab.set(tabId, set);
      }
      options.hint?.();
      socket.on('message', (raw) => {
        const beat = parseBeat(raw);
        if (beat === null) return;
        if (beat.tabId !== tabId) {
          if (tabId !== '') forget(tabId, socket);
          tabId = beat.tabId;
          const set = socketsByTab.get(tabId) ?? new Set<WebSocket>();
          set.add(socket);
          socketsByTab.set(tabId, set);
        }
        if (options.beat(beat) === 're-mint') {
          try {
            socket.send(JSON.stringify({ type: 're-mint' }));
          } catch {
            /* the tab will re-mint on its next beat, or depart */
          }
        }
      });
      const onClosed = (): void => {
        if (tabId !== '') forget(tabId, socket);
        options.hint?.();
      };
      socket.on('close', onClosed);
      socket.on('error', onClosed);
    },
    probe(tabIds) {
      for (const tabId of tabIds) {
        for (const socket of socketsByTab.get(tabId) ?? []) {
          try {
            socket.send(JSON.stringify({ type: 'probe' }));
          } catch {
            /* an unsendable probe is a gap the table already sees */
          }
        }
      }
    },
    socketCount(tabId) {
      return socketsByTab.get(tabId)?.size ?? 0;
    },
    close() {
      for (const set of socketsByTab.values()) {
        for (const socket of set) {
          try {
            socket.close(1001, 'editor session ended');
          } catch {
            /* best effort */
          }
        }
      }
      socketsByTab.clear();
    },
  };
}
