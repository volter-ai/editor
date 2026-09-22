/* THE TAB BOOTSTRAP — what makes a page one of this session's TABS.
 *
 * It mints the tab identity, opens the duplex control channel, starts the
 * heartbeat WORKER that proves the tab to `tab-presence.ts`, answers the
 * main-thread echo, and sends the `pagehide` goodbye. Everything the tab
 * bijection decides — bless, yield, depart, re-mint — is decided from what
 * this sends.
 *
 * IT IS PLAIN JS, AND IT IS SERVED VERBATIM (`tab-bootstrap.ts`, at
 * `/__editor/tab-bootstrap.js`). The page that runs it is the Code-OSS
 * workbench's, authored by VS Code, so it cannot be a module of the editor's
 * graph and cannot be transformed: it is a classic script the contribution
 * loads BEFORE the React Refresh preamble and before the editor itself. It
 * takes its base from its own `src` (`document.currentScript`), so every url
 * it builds points at the session rather than at the page hosting it.
 *
 * It lived inline in the editor's own `index.html` until PART B, and was read
 * back out of that file to be served here; the page is gone and this is its
 * own file now, with one author and nothing to drift against.
 */

/* Connect the tab before any editor module loads. `editor-presence.ts` adopts
   this exact client id/socket and replays any lifecycle event that arrived
   while its typed handlers were loading. */
(() => {
  /* ONCE PER DOCUMENT. The mount path that loads this can be reached twice,
     and a second bootstrap would mint a second tab identity for one document:
     two tabs, to a table that exists to count one. */
  if (globalThis.__VGAI_EDITOR_PRESENCE_BOOTSTRAP__) return;

  /* WHERE THE SESSION IS — the base every url below is built on, and the
     reason none of them reads `location`.

     Inline in the editor's own page the two are the same thing: an inline
     script's `currentScript` has no `src`, so this falls through to
     `location.href` and nothing changes. But this same bootstrap is also
     SERVED, as `/__editor/tab-bootstrap.js`, to a page vgai does not
     author — the Code-OSS workbench, which on desktop is
     `vscode-file://vscode-app` and can never be this session's origin
     (docs/CODE-OSS.md §Boot, DESKTOP; server/tab-bootstrap.ts). On that
     page `location` is the WORKBENCH: a heartbeat socket built from it
     goes nowhere, and a tab that cannot beat is a tab the bijection
     believes is dead. The script's own `src` is the one reading that
     cannot be wrong, because the frame fetched it from the session.

     The frame also declares WHAT KIND of page it is in the same url
     (`?surface=vscode-desktop`), and that is what the tab table reports
     back — so a page that beats is never described as an anomaly. */
  const bootstrapSrc = document.currentScript?.src || '';
  const sessionBase = bootstrapSrc ? `${new URL(bootstrapSrc).origin}/` : location.href;
  const pageSurface = bootstrapSrc ? new URL(bootstrapSrc).searchParams.get('surface') || '' : '';
  const sessionUrl = (path) => new URL(path, sessionBase).href;
  const sessionSocketUrl = (path) => {
    const url = new URL(path, sessionBase);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url;
  };
  const clientId = globalThis.crypto?.randomUUID?.() || `editor-${Date.now()}`;
  const uuid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random()}`;

  /* PAGE ERRORS, CAPTURED FIRST — before this bootstrap's own next line,
     and long before the module graph.

     The doctrine: the product answers its own state. Every other door onto
     a tab's errors lives INSIDE the module graph (editor-console.ts's
     capture, read back by command-listener.ts's `collectPageErrors`), so
     the one boot failure that most needs explaining — the one that kills
     the page before the command listener attaches — was the only one the
     product could not describe. It could report `commandListener: not
     attached` and never why, and the way you learned the cause was to open
     devtools, which is the workaround this whole seam exists to delete.

     These go out on the control connection the bootstrap already holds,
     falling back to a POST exactly like editor-presence.ts's `sendControl`
     does for a tunnelled tab. The server journals them and serves them
     back on `/__editor/state` — a plain GET — so `vgai status` answers with
     no listener, no module graph, and no cooperation from the page beyond
     this handler. */
  const pendingPageErrors = [];
  let pageErrorChannel = null;
  const PAGE_ERROR_LIMIT = 8;
  const deliverPageError = (message) => {
    if (pageErrorChannel && pageErrorChannel.send('page-error', { message })) return;
    try {
      const lifecycle = pageErrorChannel?.lifecycle ?? null;
      void fetch(sessionUrl('/__editor/page-error'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          _clientId: clientId,
          ...(lifecycle === null ? {} : { _controlLifecycle: lifecycle }),
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* A page that cannot even fetch has nothing left to report with;
         the tab table still says the document never came up. */
    }
  };
  const flushPageErrors = () => {
    while (pendingPageErrors.length > 0) deliverPageError(pendingPageErrors.shift());
  };
  const capturePageError = (message) => {
    if (typeof message !== 'string' || message === '') return;
    if (pageErrorChannel === null) {
      if (pendingPageErrors.length < PAGE_ERROR_LIMIT) pendingPageErrors.push(message);
      return;
    }
    deliverPageError(message);
  };
  const describeError = (value) => {
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
    try {
      return String(value);
    } catch {
      return 'unstringifiable error value';
    }
  };
  window.addEventListener(
    'error',
    (event) => {
      /* A failed <script>/<link> load raises `error` on the ELEMENT with no
       `error` property — the module graph failing to arrive at all, which
       is precisely the case that leaves no listener. */
      if (event.error) capturePageError(describeError(event.error));
      else if (event.message)
        capturePageError(`${event.message} (${event.filename ?? '?'}:${event.lineno ?? 0})`);
      else if (event.target && event.target !== window) {
        const src = event.target.src || event.target.href;
        if (src) capturePageError(`failed to load ${src}`);
      }
    },
    true,
  );
  window.addEventListener('unhandledrejection', (event) => {
    capturePageError(`unhandled rejection: ${describeError(event.reason)}`);
  });
  /* TAB IDENTITY. sessionStorage is scoped to exactly one tab and
     survives its reloads, which is the definition the server needs: a
     reload is the SAME tab with a new `epoch`, not a departure. The one
     thing it gets wrong is "Duplicate Tab", which COPIES it — the server
     sees two epochs beating under one tabId and tells the younger to
     re-mint, which is what `remint()` below does. */
  const TAB_KEY = 'vgai.tab.v1';
  let tabId;
  try {
    tabId = sessionStorage.getItem(TAB_KEY) || '';
    if (!tabId) {
      tabId = uuid();
      sessionStorage.setItem(TAB_KEY, tabId);
    }
  } catch {
    /* No sessionStorage (rare, but a private-mode quirk is not a reason
       to be invisible): a per-load id still makes this tab countable. */
    tabId = uuid();
  }
  const epoch = uuid();
  let participantId;
  let displayName = 'Local editor';
  try {
    participantId = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith('vgai_share_participant='))
      ?.slice('vgai_share_participant='.length);
    participantId ||= localStorage.getItem('vgai.collaboration.participant.v1');
    if (!participantId) {
      participantId = globalThis.crypto?.randomUUID?.() || `participant-${Date.now()}`;
      localStorage.setItem('vgai.collaboration.participant.v1', participantId);
    }
    displayName = localStorage.getItem('vgai.collaboration.display-name.v1') || displayName;
  } catch {
    participantId = globalThis.crypto?.randomUUID?.() || `participant-${Date.now()}`;
  }
  const query = new URLSearchParams({
    clientId,
    participantId,
    displayName,
    tabId,
    pageGeneration: epoch,
  });
  /* Only a page that is not the editor's own sends this; the tab table
     keeps it so `vgai status` can name the page instead of guessing. */
  if (pageSurface) query.set('surface', pageSurface);
  /* The tab's control channel. Downstream it looks exactly like an
     EventSource (same named events, same `data` strings). Upstream it
     also carries this page's control replies — receipts, results, state,
     route — so they never queue behind a module flood in the browser's
     per-origin HTTP connection pool. That queueing is what made a cold
     boot's blocked main thread indistinguishable from a dead tab on
     2026-08-09: five `vgai play` commands were refused as "not picked
     up" and every one of them ran later.

     `duplex` is granted by the SERVER, never assumed: the share tunnel's
     gateway answers this same URL with a one-way bridge of the SSE
     stream, and a control frame sent into that would vanish. Only a
     native socket emits `control-duplex`, so a tunnelled tab keeps
     POSTing (see editor-presence.ts's `sendControl`). */
  class WebSocketEventSource extends EventTarget {
    constructor(path) {
      super();
      this.path = path;
      this.closed = false;
      this.duplex = false;
      this.lifecycle = null;
      this.lastEventId = '';
      this.retryMs = 500;
      this.connectionAttempt = 0;
      this.reidentifyAfterClose = null;
      this.identityReady = null;
      this.connect();
    }
    connect() {
      const attempt = ++this.connectionAttempt;
      const url = new URL(this.path, sessionBase);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      if (this.lastEventId) url.searchParams.set('lastEventId', this.lastEventId);
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (attempt !== this.connectionAttempt) return;
        this.retryMs = 500;
        this.dispatchEvent(new Event('open'));
      });
      socket.addEventListener('message', (message) => {
        if (attempt !== this.connectionAttempt || this.reidentifyAfterClose !== null) return;
        try {
          const frame = JSON.parse(String(message.data));
          if (!frame || typeof frame.event !== 'string' || typeof frame.data !== 'string') {
            return;
          }
          if (frame.event === 'control-duplex') {
            this.duplex = true;
            this.finishIdentityChange();
            return;
          }
          if (frame.event === 'control-lifecycle') {
            const lifecycle = JSON.parse(frame.data);
            if (
              lifecycle?.version === 1 &&
              typeof lifecycle.serverGeneration === 'string' &&
              typeof lifecycle.connectionGeneration === 'string' &&
              typeof lifecycle.clientId === 'string' &&
              typeof lifecycle.tabId === 'string' &&
              typeof lifecycle.pageGeneration === 'string'
            ) {
              this.lifecycle = lifecycle;
              this.dispatchEvent(new MessageEvent('control-lifecycle', { data: frame.data }));
              this.finishIdentityChange();
            }
            return;
          }
          /* The main-thread liveness echo. Answered HERE, in the inline
             bootstrap, because that is what makes an unanswered echo
             mean something: this responder exists before the first
             module loads, so silence can only be a blocked main thread —
             never a listener that had not been wired up yet. */
          if (frame.event === 'control-echo') {
            this.send('echo-reply', { id: frame.data });
            return;
          }
          if (typeof frame.id === 'string') this.lastEventId = frame.id;
          this.dispatchEvent(
            new MessageEvent(frame.event, {
              data: frame.data,
              lastEventId: typeof frame.id === 'string' ? frame.id : '',
            }),
          );
        } catch {
          this.dispatchEvent(new Event('error'));
        }
      });
      socket.addEventListener('error', () => this.dispatchEvent(new Event('error')));
      socket.addEventListener('close', () => {
        if (attempt !== this.connectionAttempt) return;
        this.duplex = false;
        this.lifecycle = null;
        if (this.closed) return;
        if (this.reidentifyAfterClose !== null) {
          this.path = this.reidentifyAfterClose;
          this.reidentifyAfterClose = null;
          this.retryMs = 500;
          this.connect();
          return;
        }
        const retryMs = this.retryMs;
        this.retryMs = Math.min(5_000, retryMs * 2);
        /* Same clientId across reconnects — the server treats the
           reconnected tab as the same tab, not a second one. */
        setTimeout(() => this.connect(), retryMs);
      });
    }
    /* Is this page's control connection to the server UP right now?
       Read by the supervised lease (src/editor-lease.ts) as the second,
       independent liveness reading: a killed server drops this socket
       immediately, while a merely BUSY one — a blocked event loop, a cold
       dep-optimize — holds it open while HTTP polls time out. Without it
       the watchdog cannot tell "gone" from "slow", and on 2026-08-09 a
       `kill -STOP`ped (perfectly alive) server produced the blocking
       "Editor disconnected" scrim while this socket read OPEN. */
    get connected() {
      return this.socket?.readyState === WebSocket.OPEN;
    }
    /* Upstream control frame; false when this socket cannot carry it.
       The envelope is built HERE and only here, with the discriminator
       and the payload in separate keys — a caller cannot flatten them.
       A payload is an open-ended object (a state snapshot is literally
       whatever the editor reports), so a shared namespace would let a
       key named `type` overwrite the frame type on the way out and drop
       the whole report, and would leak the frame type into stored state
       on the way in. */
    send(type, payload) {
      const socket = this.socket;
      if (!this.duplex || !this.lifecycle || !socket || socket.readyState !== WebSocket.OPEN)
        return false;
      try {
        socket.send(JSON.stringify({ type, payload, lifecycle: this.lifecycle }));
        return true;
      } catch {
        return false;
      }
    }
    finishIdentityChange() {
      if (!this.duplex || !this.lifecycle || this.identityReady === null) return;
      const ready = this.identityReady;
      this.identityReady = null;
      ready();
    }
    /* Replace ALL channels which name a tab, as one transition. The old
       connection closes before the new one opens, and the new heartbeat
       starts only after the server accepts the replacement control
       identity. A duplicate can therefore never beat as B while taking
       commands as copied tab A. */
    reidentifyTab(nextTabId, ready) {
      const next = new URL(this.path, sessionBase);
      next.searchParams.set('tabId', nextTabId);
      this.duplex = false;
      this.lifecycle = null;
      this.identityReady = ready;
      this.reidentifyAfterClose = `${next.pathname}${next.search}${next.hash}`;
      const socket = this.socket;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        try {
          socket.close(1000, 'tab identity replaced');
          return;
        } catch {
          /* Fall through to a fresh attempt. */
        }
      }
      this.path = this.reidentifyAfterClose;
      this.reidentifyAfterClose = null;
      this.connect();
    }
    close() {
      this.closed = true;
      this.socket?.close();
    }
  }
  /* Every tab, not just tunnelled ones. TryCloudflare Quick Tunnels
     cannot do SSE at all; local tabs use the socket for the reason
     above. The plain GET/SSE form of this URL still works — it is what
     the tunnel gateway bridges through, and what curl reads. */
  let bootstrap = null;
  const source = new WebSocketEventSource(`/__editor/events?${query}`);
  /* From here the capture above has a channel. Anything it buffered while
     this class was being defined goes now, and on every reconnect — the
     duplex grant arrives after `open`, and `send` answers false until it
     does, which is exactly when the POST fallback takes over. */
  pageErrorChannel = source;
  source.addEventListener('open', () => flushPageErrors());
  flushPageErrors();

  /* THE HEARTBEAT. A dedicated Worker, started here — before the module
     graph exists — because the failure it covers is the module graph
     blocking the main thread for a minute on a cold boot. It keeps
     beating through that, it dies exactly when this tab dies, and its
     socket is not this page's socket, so nothing that happens to the
     control channel can make the server believe the tab went away.

     Presence is a UNION of a fresh beat and a live control channel
     (server/tab-presence.ts), so a tab that cannot run a worker at all —
     a tunnelled one, which is refused the script by the share gateway —
     is still SEEN. What the beat adds is the case the union needs it
     for: a tab whose page socket is down or whose main thread is
     blocked. */
  let heartbeatWorker = null;
  let heartbeatVisibilityListener = null;
  const startHeartbeat = (activeTabId) => {
    try {
      heartbeatWorker?.terminate();
      if (heartbeatVisibilityListener !== null) {
        document.removeEventListener('visibilitychange', heartbeatVisibilityListener);
      }
      const worker = new Worker(sessionUrl('/__editor/tab-heartbeat.js'));
      heartbeatWorker = worker;
      worker.addEventListener('message', (event) => {
        if (event.data?.type === 're-mint') remint();
      });
      /* A worker that cannot start (no script — the share gateway
         refuses it to a tunnelled tab — or a CSP that forbids one) is
         not an error to report: presence falls back to this page's own
         control channel. */
      worker.addEventListener('error', (event) => event.preventDefault());
      const socketUrl = sessionSocketUrl('/__editor/heartbeat');
      socketUrl.searchParams.set('tabId', activeTabId);
      worker.postMessage({
        type: 'start',
        tabId: activeTabId,
        epoch,
        socketUrl: socketUrl.href,
        postUrl: sessionUrl('/__editor/heartbeat'),
      });
      const reportVisibility = () =>
        worker.postMessage({
          type: 'visibility',
          visibility: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
        });
      heartbeatVisibilityListener = reportVisibility;
      document.addEventListener('visibilitychange', heartbeatVisibilityListener);
      reportVisibility();
    } catch {
      /* A tab that cannot run a Worker is still SEEN — the server counts
         a live control channel as presence too (tab-presence.ts's union
         rule). It just loses the reload/blocked-thread coverage. */
    }
  };
  /* "Duplicate Tab" copied this tab's sessionStorage, so two pages are
     beating under one identity. The younger takes a fresh one. */
  const remint = () => {
    heartbeatWorker?.terminate();
    heartbeatWorker = null;
    tabId = uuid();
    try {
      sessionStorage.setItem(TAB_KEY, tabId);
    } catch {
      /* the in-memory id is enough for this page load */
    }
    if (bootstrap !== null) bootstrap.tabId = tabId;
    source.reidentifyTab(tabId, () => startHeartbeat(tabId));
  };
  startHeartbeat(tabId);

  /* The module graph's one door to the beat. The census rides the
     HEARTBEAT rather than the control channel deliberately: the profile
     that explains a death has to leave the tab on the thread that is
     still alive when the page's is not.

     Each call hands over ONE fresh sample and the worker carries it on one
     beat, so the server's stamp means "the page sampled this" — never
     "the worker echoed it again". Nothing is replayed into a re-minted
     worker for the same reason: a duplicate-tab re-mint is a new tabId
     with an empty record, and it gets its first honest sample within 5s. */
  const reportCensus = (census) => {
    try {
      heartbeatWorker?.postMessage({ type: 'census', census });
    } catch {
      /* the next sample tries again; a missed profile is not a missed beat */
    }
  };
  /* What the page's main thread is about to do — a model's build() — or
     null when it is done. Same road as the census, for the same reason:
     the phase that explains a stall has to leave on the thread that is
     still alive while the page's is inside the work. */
  const reportPhase = (phase) => {
    try {
      heartbeatWorker?.postMessage({ type: 'phase', phase });
    } catch {
      /* the control channel carries it too, once the page can speak */
    }
  };

  /* LEAVING THE TAB TABLE, for a page whose session is over for good.

     The beat is what PROVES a tab to the server (server/tab-presence.ts),
     so a page that keeps beating after its session ended stays present,
     stays blessed, and `vgai edit` answers "focused" instead of opening a
     real tab — a corpse holding the session's one tab slot. Measured on
     this box, 2026-08-15: a page that had painted the "session ended"
     notice went on beating under the same tabId across a `vgai close` and
     a fresh `vgai edit`, so the new server blessed it and every command
     had nowhere to go.

     Stopping the beat is the whole withdrawal: the table departs the tab
     on the evidence it already uses, and the bijection opens a new one by
     its own existing rule. Only the TERMINAL deaths call this
     (src/session-tombstone.ts) — a `server-gone` page may still resume. */
  const stopHeartbeat = () => {
    try {
      heartbeatWorker?.postMessage({ type: 'stop' });
      if (heartbeatVisibilityListener !== null) {
        document.removeEventListener('visibilitychange', heartbeatVisibilityListener);
        heartbeatVisibilityListener = null;
      }
    } catch {
      /* the worker dies with the document regardless */
    }
  };

  /* THE GOODBYE. One `sendBeacon` on `pagehide`, and the only page signal
     this bootstrap sends about its own end.

     WHY (measured 2026-09-17): four different failures — a renderer killed
     by a dev-server reload, a worker that never finished booting, a main
     thread wedged inside a 46 MB encode, and a twin call genuinely running
     for sixteen minutes — all reached the server as the SAME observation,
     beats that stopped or a page that did not answer. `pagehide` fires for
     a close, a navigation and a reload; it does NOT fire for a renderer
     kill or a wedged thread. So its presence is exactly the discriminator
     the table was missing (server/tab-presence.ts's `tabState`): a silence
     WITH a goodbye is closed/reloading, a silence without one is crashed.

     `sendBeacon` and not `fetch`: it is the one transport the browser
     promises to deliver for a document that is already gone. The reply is
     unreadable by definition, and nothing waits on it — a beacon that does
     not arrive degrades to `crashed`, which is what the server believed
     before this line existed.

     `persisted` is the back/forward cache: the page may yet come back, so
     it is reported rather than collapsed into "this page is over". */
  const sendCloseBeacon = (persisted, reason) => {
    try {
      navigator.sendBeacon?.(
        sessionUrl('/__editor/tab/close'),
        new Blob(
          [
            JSON.stringify({
              tabId,
              epoch,
              persisted: persisted === true,
              ...(reason === undefined ? {} : { reason }),
            }),
          ],
          { type: 'application/json' },
        ),
      );
    } catch {
      /* a goodbye that cannot be sent is the crash case, truthfully */
    }
  };
  addEventListener('pagehide', (event) => sendCloseBeacon(event.persisted));

  bootstrap = {
    clientId,
    participantId,
    displayName,
    tabId,
    epoch,
    controlLifecycle: source.lifecycle,
    reportCensus,
    reportPhase,
    stopHeartbeat,
    source,
    pageOwned: true,
    pending: [],
    queueListeners: [],
  };
  source.addEventListener('control-lifecycle', (event) => {
    try {
      bootstrap.controlLifecycle = JSON.parse(event.data);
    } catch {
      bootstrap.controlLifecycle = null;
    }
  });
  globalThis.__VGAI_EDITOR_PRESENCE_BOOTSTRAP__ = bootstrap;
  /* This EventSource connects before the module graph loads, so from here
     on the server counts this tab and will route to it. Anything it sends
     in that window reaches a page with no listener for it yet — buffered
     here, replayed by editor-presence.ts once a real consumer subscribes.
     `editor-command` belongs on this list for the same reason the tab-*
     events do, and its absence was a silent command loss: the event
     dispatched to zero listeners and left no trace, so `vgai play` was
     refused for a tab that never saw the command. Capped because a tab
     whose consumer never arrives must not grow this without bound. */
  /* `tab-reload` is the ONE instruction that is not buffered, because it is
     the one that matters precisely when the module graph never evaluated.
     Everything else here waits for a consumer that, in that case, is never
     coming: a page whose app failed to boot keeps beating from its worker,
     keeps this EventSource open, and answers `tab-refocus` and `tab-adopt`
     by appending them to a queue nobody drains. The session then adopts it
     forever and no command can complete. Acting here — in the inline
     bootstrap, before any module — is what makes "a lost tab self-heals"
     true for a lost DOCUMENT and not just a lost socket. */
  source.addEventListener('tab-reload', () => {
    location.reload();
  });
  /* `tab-close` is the SECOND instruction this bootstrap acts on itself, and
     for the same reason as the first: it matters precisely when no editor
     module is there to act on it.

     Measured 2026-09-21 on a first open of an untrusted folder: the page is a
     tab from the moment it loads (the frame's activation bootstrap) while the
     workbench is still asking whether the person trusts it, so `vgai close`
     reached a tab whose consumer was never coming — the instruction went onto
     a queue nobody drains, the session waited out its two seconds and exited
     with "tab … did not acknowledge", and the browser was left showing a
     workbench whose session is gone. The bijection's own promise is that
     shutdown CLOSES the tab; a window that only draws the editor could not
     keep it.

     ONLY WHILE NOBODY ELSE OWNS IT. `editor-presence.ts` removes this type's
     queue listener the moment its own consumer attaches (`drainBootstrap`), so
     a still-queued `tab-close` is exactly "the editor has not taken this
     over" — and after it has, this stays out of the way and the editor's
     handler does the whole job (tombstone latch, ack, close-or-card). */
  source.addEventListener('tab-close', () => {
    if (!bootstrap.queueListeners.some((entry) => entry.type === 'tab-close')) return;
    sendCloseBeacon(false, 'session-ended');
    /* Best effort: a browser refuses `close()` for a tab a person opened. The
       page then keeps standing with a dead session behind it — the same
       outcome as before this listener, minus the unacknowledged close.
       `globalThis.close`, spelled out: this file declares a `close()` METHOD a
       few hundred lines up (the control socket's), and a bare call here costs
       the next reader the proof that it is not that one. */
    try {
      globalThis.close?.();
    } catch {
      /* refused is the ordinary case, and it is not an error */
    }
  });
  for (const type of ['tab-refocus', 'tab-yield', 'tab-close', 'tab-adopt', 'editor-command']) {
    const listener = (event) => {
      if (bootstrap.pending.length >= 64) return;
      bootstrap.pending.push({ type, data: event.data });
    };
    source.addEventListener(type, listener);
    bootstrap.queueListeners.push({ type, listener });
  }
})();
