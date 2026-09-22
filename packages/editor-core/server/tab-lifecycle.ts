/**
 * Tab lifecycle — the stateful shell around the tab table (`tab-presence.ts`).
 *
 * The owner invariant is unchanged: per edited game there is ONE and only one
 * browser tab. What changed on 2026-08-09 is how the server knows a tab
 * exists. It used to know by socket: an identified connection meant "here", a
 * close meant "lost — reopening". Both readings were wrong often enough to
 * ship bugs — a blocked main thread reads as dead, a reload reads as a
 * departure — and the relay compounded it by demanding an application-level
 * state report before it would route a command at all. Now a tab proves
 * itself by HEARTBEAT (a dedicated Worker, `tab-heartbeat.ts`), the table is
 * the only truth, and this file is a thin shell:
 *
 *  - Beats and socket events go IN as facts. Socket events are hints only:
 *    they update one boolean and schedule a reconcile. Nothing here opens,
 *    closes or blesses in a connect/disconnect handler.
 *  - ONE reconcile function runs on a tick and on those hints. It picks the
 *    single blessed tab (sticky while present, else oldest), tells extras to
 *    yield, and probes tabs whose beats have gapped. It NEVER opens one.
 *  - Everything it decides is journaled in tab vocabulary — appeared,
 *    heartbeat-gap, gap-closed, reloaded, departed, duplicated, blessed. The
 *    words "lost" and "reopening" are gone: neither was ever a fact about a
 *    tab.
 *
 * NOTHING IN THE BACKGROUND OPENS A TAB (owner, 2026-08-10). `vgai edit` opens
 * one; that is the whole list. The reconciler used to open whenever the table
 * went empty, on a budget a tab's own appearance RESET — so "open → tab
 * appears → you close it → open" ran forever, and it spent a night reopening
 * windows on two ports the owner was not using. The budget's doc comment
 * already said a returning tab must never refill it; the refill at the other
 * end of the file quietly re-enabled the loop it was written to stop. Closing
 * a tab is an instruction, not a fault to repair.
 */

import type { SessionJournalEvent } from './support/project/session-journal';
import {
  DEFAULT_TAB_PRESENCE_CONFIG,
  departedTabReport,
  initialTabPresenceState,
  latestCensus,
  noteTabCommandOutcome,
  presentTabs,
  reconcile,
  recordBeat,
  recordTabClose,
  setTabConnected,
  setTabListener,
  setTabRoute,
  setTabSurface,
  type TabBeat,
  type TabCensus,
  type TabCloseBeacon,
  type TabPresenceConfig,
  type TabPresenceReport,
  type TabPresenceState,
  type TabRecord,
  type TabRoute,
  type TabSurface,
  tabArriving,
  tabEndAcknowledged,
  tabNeedsProbe,
  tabPresenceReport,
  tabState,
  tabUnresponsive,
} from './tab-presence';

export type { TabRoute, TabSurface } from './tab-presence';

export type TabEnsureOutcome = 'focused' | 'adopt' | 'reloading' | 'arriving' | 'opening' | 'noop';

/** How long session end waits for the tabs to acknowledge it before going
 *  down anyway. A page that cannot answer must never hold a shutdown open. */
const SESSION_END_ACK_BUDGET_MS = 2_000;

/** How often the wait re-reads the table. The acks arrive over HTTP into this
 *  same process, so this is a poll of local state, not of a network. */
const SESSION_END_ACK_POLL_MS = 25;

export interface TabLifecycleController {
  /**
   * A control connection for this tab opened. A HINT — see the header.
   *
   * `surface` is what kind of PAGE opened it ({@link TabSurface}); it rides
   * this hint because a connection is the first and only moment the server
   * learns it, and it must be known for a page that never beats.
   */
  onTabChannelOpen(tabId: string, surface?: TabSurface): void;
  /** A control connection for this tab closed. A HINT. */
  onTabChannelClose(tabId: string): void;
  /** One heartbeat; `'re-mint'` tells a duplicated tab to take a new identity. */
  onBeat(beat: TabBeat): 're-mint' | null;
  /**
   * A page said goodbye (`pagehide` → `navigator.sendBeacon`). The ONE page
   * signal this file gained on 2026-09-17, and the only thing that tells a
   * closed/reloading tab from a crashed one — see `tab-presence.ts`'s
   * {@link TabCloseBeacon}.
   */
  onTabClose(beacon: TabCloseBeacon): void;
  /**
   * How a relayed command against this tab ENDED. The server's own evidence
   * for `hung`: a command that expired while the beats stayed fresh is the
   * page not running, and the next answered one is proof it is.
   */
  onCommandOutcome(tabId: string, outcome: 'timed-out' | 'answered'): void;
  /**
   * This tab's page reported its COMMAND LISTENER attached — the only
   * evidence the server ever gets that the document behind the channel is
   * actually running. A fact, like a beat: recorded, then reconciled on.
   */
  onTabListener(tabId: string, pageEpoch: string): void;
  /** The tab said which surface it is showing. */
  onTabRoute(tabId: string, route: TabRoute): void;
  /** Yield-page claim: bless the claimant's tab instead of the current one. */
  claim(tabId?: string): void;
  /** Converge for an edit/create invocation; opens the browser on 'opening'. */
  ensure(open: boolean): TabEnsureOutcome;
  /** Successor incoming on this port — do NOT close the tab at shutdown. */
  expectRestart(): void;
  /**
   * `tab-close` to every tab, then WAIT for the tabs that were present to
   * acknowledge it — see the implementation for what the wait is worth.
   */
  notifySessionEnded(): Promise<void>;
  /** One reconcile pass (interval-driven; exposed for tests). */
  tick(): void;
  stop(): void;
  /** The one tab commands address, or null when none is present. */
  blessedTabId(): string | null;
  /** Present tabs, oldest first. */
  present(): TabRecord[];
  /** Present tabs whose PAGE never came up this page-load — no control channel
   *  at all, or a channel with no command listener behind it. See
   *  `tab-presence.ts`'s `tabUnresponsive` for the two stages and their budgets. */
  unresponsive(): TabRecord[];
  /** One row per present tab — what `vgai status` prints. */
  report(): TabPresenceReport[];
  /** One row per RECENTLY DEPARTED tab — the only place `closed` and
   *  `crashed` can be said, because both are verdicts about a tab that is no
   *  longer present. Bounded memory, not a log. */
  departedReport(): TabPresenceReport[];
  /** This tab's record, present or not (a refusal quotes it). */
  tab(tabId: string): TabRecord | undefined;
  /**
   * This tab's newest resource census and how stale it is, on the lifecycle's
   * OWN clock — the one that stamped it, so the age is a subtraction and not a
   * guess across two clocks. Null when the tab is unknown or never sent one.
   *
   * Asked at exactly the moment a tab stops being normal (an abnormal socket
   * close), which is why it does not require the tab to be present.
   */
  censusOf(tabId: string): { census: TabCensus; ageMs: number } | null;
  /** Read-only snapshot (tests/diagnostics). */
  state(): Readonly<TabPresenceState>;
}

export interface TabLifecycleOptions {
  /** The URL the one tab must show (and the one auto-open opens). */
  editorUrl: string;
  /** Platform browser hand-off (same helper family the CLI uses). */
  openUrl: (url: string) => void;
  /** Targeted send to every live connection of one TAB; false when it has none. */
  sendToTab: (tabId: string, event: string, data: unknown) => boolean;
  /**
   * Send to EVERY connection in this lifecycle's scope. Session end is the
   * only caller and the reason it exists: `tab-close` used to reach the
   * blessed tab alone, so every OTHER connected tab (an extra on the yield
   * page, a launcher tab, a second window) learned about the shutdown only by
   * its socket dying and fell through to the generic "Editor disconnected"
   * overlay. Returns how many connections took it.
   */
  broadcastToClients: (event: string, data: unknown) => number;
  /** Ask these tabs' workers to beat NOW (see `tab-heartbeat.ts`). */
  probeTabs?: ((tabIds: readonly string[]) => void) | undefined;
  /** Live view of the server's last index-page request stamp. */
  lastIndexRequestAt: () => number | null;
  /** One journal line per decision. */
  journal?: ((event: SessionJournalEvent) => void) | undefined;
  /** A tab's page reloaded under the same tabId (its `epochCount` advanced).
   *  The page that held everything addressed to the old page-load is gone;
   *  the control plane settles those commands on this. */
  onTabReloaded?: ((tabId: string, epochCount: number) => void) | undefined;
  now?: () => number;
  config?: Partial<TabPresenceConfig>;
  /** Reconcile cadence; 0 disables the interval (tests drive `tick()`). */
  tickIntervalMs?: number;
  /** False for a remote participant: enforce one tab, never open one here. */
  maintain?: boolean;
}

export function createTabLifecycle(options: TabLifecycleOptions): TabLifecycleController {
  const config: TabPresenceConfig = { ...DEFAULT_TAB_PRESENCE_CONFIG, ...options.config };
  const now = options.now ?? Date.now;
  const journal = options.journal ?? ((): void => {});
  const maintain = options.maintain ?? true;
  let state = initialTabPresenceState();
  let restartExpected = false;
  /** Tabs already told to yield for the CURRENT blessing — one nudge each. */
  let yielded = new Set<string>();
  /** Page-loads already told to reload themselves — one attempt each, so a
   *  document that cannot boot is never put in a loop. */
  const reloaded = new Set<string>();

  function emit(events: readonly SessionJournalEvent[]): void {
    for (const event of events) journal(event);
  }

  /**
   * The single decision point. Every caller below either records a fact and
   * lands here, or reads the table — nothing decides on its own.
   */
  function run(): void {
    const at = now();
    const previousBlessed = state.blessedTabId;
    const result = reconcile(
      state,
      { now: at, lastIndexRequestAt: options.lastIndexRequestAt(), mayOpen: maintain },
      config,
    );
    state = result.state;
    emit(result.events);

    if (result.blessedTabId !== previousBlessed) yielded = new Set();
    for (const tabId of result.yieldTabIds) {
      if (yielded.has(tabId)) continue;
      // A worker beat can arrive before its page's control channel. Retry on
      // the next reconcile when there was no channel to take this nudge.
      if (!options.sendToTab(tabId, 'tab-yield', { reason: 'duplicate' })) continue;
      yielded.add(tabId);
      journal({ kind: 'tab-yielded', tabId8: tabId.slice(0, 8) });
    }

    // Probing is a question the TABLE asks: only tabs whose beats have
    // gapped, and only while they are still inside their grace. A hidden tab
    // answers from its worker's message handler even when its timers are
    // throttled, which is what keeps it present indefinitely.
    if (options.probeTabs) {
      const stale = [...state.tabs.values()]
        .filter((tab) => tabNeedsProbe(tab, at, config))
        .map((tab) => tab.tabId);
      if (stale.length > 0) options.probeTabs(stale);
    }
  }

  const intervalMs = options.tickIntervalMs ?? 1_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  const controller: TabLifecycleController = {
    onTabChannelOpen(tabId, surface) {
      state = setTabConnected(state, tabId, true, now());
      if (surface !== undefined) state = setTabSurface(state, tabId, surface);
      run();
    },
    onTabChannelClose(tabId) {
      state = setTabConnected(state, tabId, false, now());
      run();
    },
    onBeat(beat) {
      const outcome = recordBeat(state, beat, now(), config);
      state = outcome.state;
      emit(outcome.events);
      for (const event of outcome.events)
        if (event.kind === 'tab-reloaded') options.onTabReloaded?.(beat.tabId, event.epochCount);
      // A beat that CLOSES a gap is a hint worth reconciling on immediately —
      // it is the moment a tab stops being a question.
      if (outcome.events.length > 0) run();
      return outcome.reply;
    },
    onTabClose(beacon) {
      const before = state;
      state = recordTabClose(state, beacon, now());
      // A goodbye is the moment a tab stops being a question — reconcile on it
      // for the same reason a gap-closing beat does.
      if (state !== before) run();
    },
    onCommandOutcome(tabId, outcome) {
      state = noteTabCommandOutcome(state, tabId, now(), outcome);
    },
    onTabListener(tabId, pageEpoch) {
      const before = state;
      state = setTabListener(state, tabId, now(), pageEpoch);
      // Only the transition is worth a reconcile: this arrives once per
      // page-load, and it is the moment a tab stops being a question.
      if (state !== before) run();
    },
    onTabRoute(tabId, route) {
      state = setTabRoute(state, tabId, route);
    },
    claim(tabId) {
      // "Use here instead": drop the blessing so the next reconcile picks the
      // claimant. The claimant's own tab is preferred when it names itself.
      const current = state.blessedTabId;
      if (current !== null && current !== tabId) {
        options.sendToTab(current, 'tab-yield', { reason: 'claimed' });
      }
      state = { ...state, blessedTabId: tabId ?? null, blessedAt: now() };
      if (tabId !== undefined) {
        journal({
          kind: 'tab-blessed',
          tabId8: tabId.slice(0, 8),
          previousTabId8: current === null ? null : current.slice(0, 8),
          reason: 'claimed',
        });
      }
      yielded = new Set();
      run();
    },
    ensure(open) {
      run();
      const at = now();
      const blessed = state.blessedTabId;
      // HEAL A DEAD DOCUMENT, and only when nothing can take a command.
      //
      // A page that connected and never attached a command listener cannot act
      // on `tab-refocus` or `tab-adopt`: it buffers them for a consumer that is
      // never coming (`index.html`'s bootstrap), so adopting it again leaves
      // the session holding a tab where, as `vgai status` says, "no command
      // will complete". `tab-reload` is the one message the bootstrap acts on
      // without the module graph.
      //
      // The condition is about the SESSION, not about which tab is blessed. A
      // dead tab that is merely present keeps `ensure` from opening a fresh one
      // while never being able to run anything itself, and only checking the
      // blessed tab left exactly that state unhealable. So: if NO tab has a
      // command listener, reload every tab that has given up on getting one.
      //
      // And never while a healthy tab exists. Reloading a dead tab beside a
      // working one produces two healthy tabs, and the bijection then tells one
      // to yield — which closed the tab fourteen minutes into a replay and lost
      // the run (measured 2026-09-15: `client-disconnected` code 1001, a
      // deliberate unload, with the model's command still in flight).
      //
      // Once per page-load, and only from an explicit `vgai edit`, so a
      // document that cannot boot is never put in a reload loop.
      const anyHealthy = [...state.tabs.values()].some(
        (tab) => tab.listenerThisEpoch && tab.connected,
      );
      if (!anyHealthy) {
        for (const tab of state.tabs.values()) {
          if (!tabUnresponsive(tab, at, config)) continue;
          const epoch = tab.epoch ?? tab.tabId;
          if (reloaded.has(epoch)) continue;
          if (!options.sendToTab(tab.tabId, 'tab-reload', {})) continue;
          reloaded.add(epoch);
          // Deliberately UNJOURNALED. This used to write `tab-yielded`, which
          // is a different decision with a different consequence — a yield
          // tells a page to go away — and a reader diagnosing the wedge sees
          // one word for two acts. The pair that already brackets this is
          // honest and complete: `tab-unresponsive` (the cause, journaled by
          // the reconciler) and `tab-reloaded` (the outcome, journaled when the
          // successor page-load beats). A send that produced neither is a lost
          // message, which is exactly what should read as nothing happening.
          return 'reloading';
        }
      }
      // A BLESSED TAB THAT SAID GOODBYE IS NOT A TAB.
      //
      // Blessing is not released by a close: the record stays, `connected`
      // goes false, and `listenerThisEpoch` is still latched from the epoch
      // that just ended — so the branch below answered `focused` for a page
      // that is gone, and the CLI printed "Editor already open on this
      // project" and exited 0 having opened nothing. MEASURED twice on walk 5,
      // each time by quitting the browser and running `vgai edit .`
      // immediately: `vgai status` in the same breath read
      //
      //     tab 7b08ccd5: CLOSED 7.4s — its page sent a close beacon 7.4s ago
      //                   and no new page-load is beating
      //
      // and `vgai edit` said the editor was already open. A second run ~30 s
      // later, once the record had aged out of `presentTabs`, opened the tab
      // normally — so the defect was a WINDOW, which is exactly the window a
      // person or an agent reaches for `vgai edit` in.
      //
      // The verdict this asks is the SAME ONE the status line prints
      // (`tabState`), so the two can no longer disagree about whether there is
      // a tab. A `reloading` verdict is deliberately not here: that page said
      // goodbye and a successor is already beating, which the branches below
      // handle as the arriving tab it is.
      const saidGoodbye = (tab: TabRecord): boolean => {
        const verdict = tabState(tab, at, config).state;
        return verdict === 'closed' || verdict === 'ended';
      };
      const blessedRecord = blessed === null ? undefined : state.tabs.get(blessed);
      if (blessed !== null && !(blessedRecord !== undefined && saidGoodbye(blessedRecord))) {
        const record = blessedRecord;
        if (record?.route === 'no-project') {
          // The tab is live but on the launcher: retarget THAT tab instead of
          // opening one beside it.
          options.sendToTab(blessed, 'tab-adopt', { url: options.editorUrl });
          return 'adopt';
        }
        // A PAGE THAT HAS NOT ATTACHED A COMMAND LISTENER THIS EPOCH IS NOT
        // `focused`. `focused` is this endpoint's word for "converged — a tab
        // is on this session and it answers", and the CLI reads it as exactly
        // that (`tab-attach.ts`'s `planTabAttach`: `focused` -> `attached` ->
        // "Editor already open on this project", exit 0).
        //
        // MEASURED 2026-09-19 against a page stalled before React mounts (the
        // wedge in WORK.md §"The editor tab can wedge in a state `vgai edit`
        // cannot self-heal"): for the WHOLE `listenerBudgetMs` — two minutes —
        // this branch answered
        //
        //     POST /__editor/tab/ensure  ->  {"status":"focused"}
        //     tab=025db401 connected=true channelThisEpoch=true
        //     listenerThisEpoch=false route=unknown epochAge=95349ms
        //
        // for a tab that could never run a command, and `tab-refocus` went to
        // a page that buffers it for a consumer that is never coming (see the
        // heal note above). That is the window the blind contributor probe hit
        // three times in one session.
        //
        // `arriving` is the truthful word for it: the page-load is on its way
        // in and the caller must WAIT for the document rather than be told it
        // already has one. Past the budget the heal above turns it into
        // `reloading`; both map to `wait-arriving`, and the CLI's wait now
        // keys on the listener (`editor-sessions.ts`), so a page that never
        // comes up ends in a named, non-zero failure instead of a lie.
        if (record !== undefined && !record.listenerThisEpoch) return 'arriving';
        options.sendToTab(blessed, 'tab-refocus', { url: options.editorUrl });
        return 'focused';
      }
      if (tabArriving(state, at, options.lastIndexRequestAt(), config)) return 'arriving';
      // A PRESENT TAB IS A TAB, blessed or not. Blessing is released the moment
      // a page stops being eligible (`tab-presence.ts`'s `partitionEligible`),
      // and reading "nothing blessed" as "no tab" is the same mistake the yield
      // filter made — there it closed the session's only tab, here it would
      // open a second one on top of it, which is the duplicate the bijection
      // exists to forbid. The heal above is the door for a present tab that
      // cannot run; waiting is the answer once it has been used.
      // …and a tab that said goodbye is not present either, for the reason the
      // blessed branch above states: `tabPresent` keeps a closed tab for its
      // whole grace, which is the same window that made `vgai edit` report a
      // tab it did not have.
      if (presentTabs(state, at, config).some((tab) => !saidGoodbye(tab))) return 'arriving';
      if (!open || !maintain) return 'noop';
      // An explicit `vgai edit` is the ONLY thing that opens a tab. Nothing in
      // the reconcile loop opens one: a tab you closed stays closed.
      options.openUrl(options.editorUrl);
      return 'opening';
    },
    expectRestart() {
      restartExpected = true;
    },
    /**
     * THE END OF THE SESSION IS A FACT THE PAGE HAS TO CONFIRM.
     *
     * This used to broadcast `tab-close`, sleep 150 ms blind and return, and
     * the caller then tore the HTTP server down (`dev.ts`). Nothing waited for
     * the message and nothing recorded whether it landed — and everything the
     * page tears down on the session's end hangs off it: `tab-close` →
     * `markSessionEnded` → every `editorHost().session.onEnded` terminator,
     * `terminateBlenderRuntime` among them. Measured 2026-09-19/20: when the
     * socket died before the event did, the page instead fell to the lease
     * guard's `server-gone` path — main-thread timers Chrome throttles to once
     * a minute in a long-hidden tab — and the tab's Blender engine worker (one
     * engine thread plus a 16-thread pthread pool) stayed at 100%+ CPU for
     * minutes after `vgai close`, with the box swapping.
     *
     * So the sleep is gone and a real wait takes its place: every tab PRESENT
     * when the end was announced has to send a `session-ended` goodbye
     * (`src/tab-lifecycle-client.ts`, the same beacon route `pagehide` uses),
     * bounded at {@link SESSION_END_ACK_BUDGET_MS}. The bound is the point —
     * a page that cannot answer must not hold the shutdown open — and the
     * journal says which of the two happened, so `vgai close` can print it
     * instead of the operator having to find the CPU themselves.
     */
    async notifySessionEnded() {
      controller.stop();
      if (restartExpected) return;
      const awaiting = presentTabs(state, now(), config).map((tab) => tab.tabId);
      const startedAt = now();
      const unacked = (): string[] => awaiting.filter((id) => !tabEndAcknowledged(state, id));
      const journalUnacked = (missing: readonly string[]): void => {
        journal({
          kind: 'session-end-unacked',
          tabId8s: missing.map((id) => id.slice(0, 8)),
          ms: now() - startedAt,
        });
      };
      if (options.broadcastToClients('tab-close', {}) === 0) {
        // Nobody took the message, so no ack can ever come — waiting the
        // budget out would only delay the exit. Say so at once when there was
        // a tab to tell; a session with no tabs has nothing to record.
        const missing = unacked();
        if (missing.length > 0) journalUnacked(missing);
        return;
      }
      for (;;) {
        const missing = unacked();
        if (missing.length === 0) {
          journal({
            kind: 'session-end-acked',
            tabs: awaiting.length,
            ms: now() - startedAt,
          });
          return;
        }
        if (now() - startedAt >= SESSION_END_ACK_BUDGET_MS) {
          journalUnacked(missing);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, SESSION_END_ACK_POLL_MS));
      }
    },
    tick() {
      run();
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    blessedTabId() {
      return state.blessedTabId;
    },
    present() {
      return presentTabs(state, now(), config);
    },
    unresponsive() {
      const at = now();
      return presentTabs(state, at, config).filter((tab) => tabUnresponsive(tab, at, config));
    },
    report() {
      return tabPresenceReport(state, now(), config);
    },
    departedReport() {
      return departedTabReport(state, now(), config);
    },
    tab(tabId) {
      return state.tabs.get(tabId);
    },
    censusOf(tabId) {
      const record = state.tabs.get(tabId);
      const newest = record === undefined ? null : latestCensus(record);
      if (newest === null) return null;
      const { at, ...census } = newest;
      return { census, ageMs: now() - at };
    },
    state() {
      return state;
    },
  };

  if (intervalMs > 0) {
    timer = setInterval(() => controller.tick(), intervalMs);
    timer.unref?.();
  }

  return controller;
}
