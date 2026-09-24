/**
 * THE TAB TABLE — what the server knows about the browser tabs that exist for
 * this session, and the only thing any presence question is allowed to read.
 *
 * WHY THIS EXISTS (owner, 2026-08-09): "there exist tabs that may or may not
 * be open; if one or more tabs is open, choose one of them to be the editor;
 * if no tabs are open, auto-open one. Make sure the tabs do NOT get
 * disconnected, and if they do, make it clear that it happened. You're
 * relying on sockets to prove connection — that's highly unreliable. It
 * should be heartbeats."
 *
 * The invariant: IF a tab for this session exists in a browser, the backend
 * sees it — 100%.
 *
 * WHAT A SOCKET ACTUALLY PROVES. Almost nothing, in either direction. A
 * socket can be OPEN to a tab that cannot run a line of JavaScript (cold
 * module evaluation blocks the main thread for a minute), and a socket can
 * CLOSE for a tab that never went anywhere (a reload, a laptop lid). The old
 * model read both as facts about the tab: an open socket meant "here", a
 * close meant "lost — reopening". Worse, it demanded a THIRD thing before it
 * would route a command — an application-level state report — so a live,
 * duplex-granted, blessed tab that had not yet finished loading its module
 * graph was invisible to the relay and its commands came back "Editor
 * disconnected before the command could be delivered." Measured 2026-08-09
 * and reproduced headlessly: `editorsConnected: 1, connected: true`, no state
 * report, five refused plays.
 *
 * SO PRESENCE IS A BEAT. A dedicated Worker in the page beats every second
 * over its OWN socket. It keeps beating while the page's main thread is
 * blocked, its socket is not the page's socket, and it dies exactly when the
 * tab dies — which is the whole list of properties presence needs and a page
 * socket has none of.
 *
 * IDENTITY. `tabId` lives in `sessionStorage`, which is scoped to one tab and
 * survives its reloads, so a reload is the SAME tab with a new `epoch`. The
 * one thing sessionStorage does not survive correctly is "Duplicate Tab",
 * which copies it — two epochs beating at once under one tabId, detected here
 * and answered with a re-mint.
 *
 * PURE ON PURPOSE. Every decision below is a function of (state, input, now)
 * with the clock injected, so the tests never wait: `tab-lifecycle.test.ts`
 * drives real gaps, reloads and departures in microseconds — against these
 * functions directly as well as through the shell. The stateful shell that
 * wires this to sockets, the opener and a tick lives in `tab-lifecycle.ts`.
 */

import { commandLine } from '@volter/editor-sdk/kit/product-command';
import type { SessionJournalEvent } from './support/project/session-journal';
import type { TabCensus } from '@volter/editor-sdk/project/tab-census';

/** What the page last told its worker about itself. */
export type TabVisibility = 'visible' | 'hidden';

/**
 * Which surface a tab is showing.
 * - `'project'`    — the editor, on the project this session serves.
 * - `'no-project'` — the launcher/hub or the startup-failure surface: a real
 *   tab that is not on the project and can be adopted into it.
 * - `'unknown'`    — the page has not said yet (still booting). Read as "on
 *   its way to the project", which is what it is for every tab this session
 *   opened itself.
 */
export type TabRoute = 'project' | 'no-project' | 'unknown';

/**
 * WHAT KIND OF PAGE this tab is.
 *
 * - `'editor'`  — the vgai editor's own page, which is every tab this session
 *   opens itself.
 * - `'vscode'`  — a Code-OSS workbench window running the editor through the
 *   frame (docs/CODE-OSS.md §Boot, DESKTOP). It is a tab like any other under
 *   the bijection; the only difference is that vgai does not author its HTML,
 *   so the things a page does for itself — minting an identity, beating,
 *   saying goodbye — arrive from a script the session serves it
 *   (`server/tab-bootstrap.ts`).
 *
 * Why the table carries it at all: without it, a VS Code window that had not
 * yet been given that script was reported as an anomaly ("SOMETHING IS OFF")
 * with no way to say WHICH bootstrap was missing, and a window that had been
 * given it was indistinguishable from a browser tab. Both readings are now
 * the truth, in one word.
 *
 * TWO SOURCES, one field, because each covers what the other cannot: the
 * bootstrap DECLARES it (`?surface=` on the script's own url, which survives
 * the web shape where the workbench and the session share an origin), and the
 * server OBSERVES it (a control connection whose `Origin` is the desktop
 * frame's, which needs no cooperation from a page that never got the script).
 */
export type TabSurface = 'editor' | 'vscode';

/**
 * THE RESOURCE CENSUS — what the tab was holding, sampled by the page and
 * carried on the beat. Declared in `@vgai/sdk/tab-census` (the one package
 * every unit that speaks this shape already depends on) and re-exported here,
 * because this file is where the server's readers look for it.
 *
 * WHY IT EXISTS (measured 2026-08-10): a game tab's Chrome RENDERER PROCESS was
 * killed repeatedly — WS close code 1006, no goodbye — while a 3840x2080 WebGL
 * world with an HDR bloom chain was resident and painting. JS heap stayed flat
 * at ~190 MB throughout, so the kill was GPU/compositor-side, at a per-process
 * ceiling Chrome does not document and never announces. The tab table recovered
 * perfectly (departed → auto-open) and recorded NOTHING about why.
 *
 * The class is agent-native: an agent authors lush effects with zero cost
 * feedback, and the quality loop grades looks and never cost. So the tab now
 * says what it is holding, on a channel that already exists, and a death gets
 * a cause line instead of a shrug.
 *
 * MEASUREMENT ONLY. Nothing here enforces a budget — budgets are a later
 * decision, once real profiles exist to set them from.
 */
export type { TabCensus };

/**
 * One census as the SERVER filed it: the profile plus the server's own clock.
 *
 * THE INVARIANT `at` DEPENDS ON: a census reaches the server only on the one
 * beat that carries a FRESH page sample. The worker drops it after sending
 * (`tab-heartbeat.ts`'s `body()`), so `at` means "the page sampled this, and
 * it arrived", within the one beat (≤1s) between the two.
 *
 * That is load-bearing rather than tidy. The worker used to echo its cached
 * profile on every beat and this stamp moved with the echo, so a hidden tab
 * that had not sampled in half an hour still reported a half-second-old
 * profile — and the age, whose whole job is to make a stale profile READ as
 * stale, lied on the path that matters most: Chrome kills background tabs
 * under memory pressure. The stamp is also the server's, never the page's;
 * an age computed across two clocks is not an age.
 */
export type TabCensusSample = TabCensus & { readonly at: number };

/** How many samples per tab the table keeps. Two: the last one, and the one
 *  before it — enough to see a resource CLIMB in the line that reports a death,
 *  and short enough that the table stays a table. */
export const TAB_CENSUS_HISTORY = 2;

/**
 * THE PAGE SAYING GOODBYE — the one signal a page sends about its own end.
 *
 * WHY IT EXISTS (measured 2026-09-17): four different causes produced one
 * symptom, "the battery stopped", and the product reported all four the same
 * way. A renderer killed by a dev-server reload and a page whose main thread
 * was stuck in a 46 MB encode are indistinguishable from the beats alone —
 * both are silence. The difference is whether the page got a chance to say it
 * was going: `pagehide` fires for a close, a navigation and a reload, and does
 * NOT fire for a renderer kill or a wedged main thread. So a silence WITH a
 * goodbye is `closed`/`reloading` and a silence WITHOUT one is `crashed`, and
 * that is the whole discriminator.
 *
 * Sent with `navigator.sendBeacon` (index.html's inline bootstrap), which is
 * the one transport the browser promises to deliver after the document is
 * gone. `persisted` is `PageTransitionEvent.persisted`: the page went into the
 * back/forward cache and may yet come back alive, which is a different sentence
 * from "this page is over" and is carried rather than collapsed.
 */
export interface TabCloseBeacon {
  readonly tabId: string;
  /** The page-load that is leaving — never assumed to be the current one. */
  readonly epoch: string;
  /** True when the document went into the back/forward cache. */
  readonly persisted: boolean;
  /**
   * WHY the page is saying goodbye, and the only thing that makes this beacon
   * an ACKNOWLEDGEMENT rather than a departure notice.
   *
   * `'pagehide'` — the document is unloading (index.html's bootstrap). The
   * original and the default: a beacon that does not say is one of these.
   *
   * `'session-ended'` — the page received the session's `tab-close` and has
   * already run every terminator behind `markSessionEnded`
   * (`src/tab-lifecycle-client.ts`). Measured 2026-09-19/20: the session used
   * to broadcast `tab-close`, sleep 150 ms blind and tear the server down,
   * with nothing waiting for or recording whether any page heard it — and a
   * page that did not hear it kept its Blender engine worker (one engine
   * thread plus a 16-thread pool) running at 100%+ CPU for minutes after
   * `vgai close`. This is the page's half of that fact; `tab-lifecycle.ts`'s
   * `notifySessionEnded` is the half that waits for it.
   */
  readonly reason: 'pagehide' | 'session-ended';
}

/** One heartbeat, as it arrives from a tab's worker. */
export interface TabBeat {
  readonly tabId: string;
  readonly epoch: string;
  readonly seq: number;
  readonly visibility: TabVisibility;
  /**
   * A FRESH page sample, on the one beat that carries it — see
   * {@link TabCensusSample}. Beats run at 1 Hz and the page samples at 0.2 Hz
   * while visible and not at all while hidden, so most beats have no census
   * and a hidden tab's beats have none for as long as it stays hidden. That
   * silence is the honest signal, not a gap to paper over.
   */
  readonly census?: TabCensus;
  /** What the page's main thread announced it was entering (`building
   *  src/models/x.ts`), or `null` when it left; present on the one beat
   *  that carries the change. */
  readonly phase?: string | null;
  readonly phaseSource?: string;
  readonly phaseSequence?: number;
}

/** One page-load of a tab, tracked only long enough to tell reload from duplicate. */
interface EpochRecord {
  readonly epoch: string;
  readonly firstSeenAt: number;
  readonly lastBeatAt: number;
}

/** Everything the server knows about one tab. */
export interface TabRecord {
  readonly tabId: string;
  /** First time this tabId was seen at all (beat or connection). */
  readonly firstSeenAt: number;
  /** Newest beat from any of this tab's live epochs; 0 if it has never beaten. */
  readonly lastBeatAt: number;
  /** True once at least one beat has arrived — see `tabPresent`. */
  readonly beatEver: boolean;
  /** The primary (oldest live) epoch — this tab's current page load. */
  readonly epoch: string | null;
  readonly epochStartedAt: number;
  /** How many distinct page loads this tab has had. A reload increments it. */
  readonly epochCount: number;
  readonly epochs: readonly EpochRecord[];
  readonly visibility: TabVisibility;
  readonly route: TabRoute;
  /** What kind of page this tab is — see {@link TabSurface}. */
  readonly surface: TabSurface;
  /** Does this tab hold a live control (command) channel right now? */
  readonly connected: boolean;
  /**
   * Has THIS page-load ever opened a command channel? Reset on every epoch.
   *
   * The zombie-page discriminator. A heartbeat proves the TAB exists; it says
   * nothing about the document. A page whose main thread died after the
   * inline bootstrap keeps beating (the worker is a separate thread) and can
   * never open a channel or run a command — so a tab that has been beating
   * without ever establishing one this epoch is not a candidate for blessing,
   * while a tab that HAD one and is mid-reload obviously still is.
   */
  readonly channelThisEpoch: boolean;
  /**
   * Has THIS page-load reported an ATTACHED COMMAND LISTENER? Reset on every
   * epoch, and the second half of the zombie discriminator above.
   *
   * A channel is not a document. `index.html`'s inline bootstrap opens the
   * control connection BEFORE the module graph exists, precisely so a tab
   * that is merely slow stays visible — which means a page whose module graph
   * never evaluates at all opens a channel and then does nothing forever.
   * That tab used to read as fully healthy here: blessed in the same
   * millisecond its socket connected, `vgai edit` reporting a live session,
   * and every command buffered in the bootstrap's replay queue with no
   * consumer that would ever arrive. Measured 2026-08-13 in a session journal
   * left behind by a real boot failure — `client-connected` and `tab-blessed`
   * on the same millisecond, no `tab-appeared` (the heartbeat worker never
   * started either), no listener, 77 seconds of nothing, then the tab closed.
   *
   * `connectCommandListener` reporting itself is the only evidence that the
   * document is RUNNING, so it is what blessing is allowed to require —
   * after {@link TabPresenceConfig.listenerBudgetMs}, never before.
   */
  readonly listenerThisEpoch: boolean;
  /** Recent page-owned listener reports, including one whose first beat is still in flight. */
  readonly listenerEpochs: readonly string[];
  /** Has the unresponsive verdict already been journaled for this epoch? */
  readonly unresponsiveNoticed: boolean;
  /** When beats stopped arriving; null while they are current. */
  readonly gapSince: number | null;
  /** Has the open gap already been journaled? (One line per gap, not per tick.) */
  readonly gapNoticed: boolean;
  /**
   * The last {@link TAB_CENSUS_HISTORY} DISTINCT resource profiles this tab
   * reported, oldest first. Empty for a tab that has never sent one (an older
   * page, a tab bridged through the share tunnel, a browser with no census
   * yet). The newest is what a death line quotes; the one before it is what
   * makes a climb visible.
   */
  readonly census: readonly TabCensusSample[];
  /**
   * The page-load that sent a {@link TabCloseBeacon}, or null when none has.
   * See {@link tabState}: this is what separates `closed`/`reloading` from
   * `crashed`, and it is a fact about an EPOCH, never about the tab — a reload
   * closes one page-load and opens another under the same tabId.
   */
  readonly closedEpoch: string | null;
  /** SERVER clock: when that beacon landed. Null with no beacon. */
  readonly closedAt: number | null;
  /** That beacon's `persisted` — the document went into the back/forward cache. */
  readonly closedPersisted: boolean;
  /** That beacon's {@link TabCloseBeacon.reason}; null with no beacon. It is
   *  what separates a page that ACKNOWLEDGED the session's end (`ended`) from
   *  one that merely went away (`closed`). */
  readonly closedReason: 'pagehide' | 'session-ended' | null;
  /**
   * The length of the most recent CLOSED gap in this tab's beats, and when it
   * closed. Two fields rather than one because the verdict needs both: a gap
   * longer than the grace that a beat later CLOSED is a suspend (a lid, a
   * sleep), not a death — and only while the return is recent enough to be
   * what a reader is looking at. `gapSince`/`gapNoticed` above cannot answer
   * this: `recordBeat` clears them the moment the gap ends, which is exactly
   * when this question gets asked.
   */
  readonly lastGapMs: number | null;
  readonly lastGapEndedAt: number | null;
  /**
   * When a relayed command last EXPIRED against this tab, or null when the
   * last one answered.
   *
   * The second half of `hung`, and the half no page-side measurement can
   * supply: a page whose main thread is inside a 46 MB encode samples no
   * census and answers no command, and the census-age test below sees only a
   * profile that stopped arriving. A command that went out and never came back
   * while the beats stayed fresh is the server's OWN evidence for the same
   * fact, and it is the one an operator already has in hand.
   */
  readonly commandTimeoutAt: number | null;
}

export interface TabPresenceConfig {
  /** The worker's beat cadence. Everything else is expressed in multiples. */
  readonly beatIntervalMs: number;
  /** A visible tab is PRESENT while its newest beat is younger than this. */
  readonly graceMs: number;
  /**
   * The same for a hidden tab. Chrome throttles background timers and may
   * throttle workers, so cadence is not assumed: the grace is long, and the
   * server actively probes over the heartbeat socket (message delivery is not
   * throttled) — a probe answer is recorded as a beat, so a hidden tab that
   * still answers stays present indefinitely.
   */
  readonly hiddenGraceMs: number;
  /** A gap this long is worth a journal line (owner: make it clear). */
  readonly gapNoticeMs: number;
  /** Beats older than this stop probing and let the tab depart on grace. */
  readonly probeAfterMs: number;
  /**
   * How long a page-load gets to open a command channel before the tab is
   * called unresponsive. Generous: a cold editor boot blocks the main thread
   * for 60-100s, but the CHANNEL is opened by index.html's inline bootstrap
   * before any module loads, so a page that has not opened one in this long
   * never will.
   */
  readonly channelBudgetMs: number;
  /**
   * How long a page-load gets to attach its COMMAND LISTENER before the tab
   * is called unresponsive — the whole module graph, not just the inline
   * bootstrap, so it is far longer than `channelBudgetMs`.
   *
   * Sized from the two measurements that bound it. A cold editor boot blocks
   * the main thread for 60-100s (the same measurement `channelBudgetMs`'s
   * comment cites), and `arrivalGraceMs` already concedes that a cold Vite
   * dep-optimize can take minutes — so a smaller budget would demote healthy
   * tabs mid-boot, which is the 2026-08-09 defect this whole file exists to
   * undo. Bigger than either is not a cost worth paying either: this budget
   * only ever decides how long the session may keep CLAIMING a tab can run
   * commands before it says otherwise, and nothing waits on it — a command
   * relayed meanwhile is held on its own budget exactly as before.
   */
  readonly listenerBudgetMs: number;
  /** How long the table must be EMPTY before auto-open fires. */
  /** Base interval between auto-opens; each attempt doubles it. */
  /**
   * No blessing may be REASSIGNED within this long of the last change.
   * Hysteresis against a beat landing either side of a grace boundary and
   * churning which tab owns the session. A DEPARTED blessed tab is exempt —
   * there is nothing to keep sticky — so the dwell only ever delays an
   * upgrade, never a repair.
   */
  readonly blessDwellMs: number;
  /**
   * A tab that requested the index page this recently is ARRIVING — booting,
   * no worker yet. Neither auto-open nor `ensure` may open a duplicate under
   * it. Cold Vite dep-optimize can take minutes, hence the size.
   */
  readonly arrivalGraceMs: number;
  /**
   * Beats fresh, census this old — the page's MAIN THREAD is not sampling, and
   * {@link tabState} says `hung`.
   *
   * SIZED FROM THE CENSUS CADENCE, with the same margin the beat grace uses.
   * The page samples every `TAB_CENSUS_INTERVAL_MS` = 5s
   * (`packages/editor/src/tab-census.ts`), and `graceMs` is 3 × the 1s beat
   * interval — so this is 3 × 5s. Two skipped samples are weather (a beat that
   * neither transport could carry drops the sample it was carrying, and the
   * next is 5s behind it); three is a thread that has stopped running timers.
   *
   * ONLY FOR A VISIBLE TAB, and {@link tabState} enforces that rather than
   * softening the number: a hidden tab is deliberately not sampled at all, so
   * its census age is a fact about the tab being backgrounded and says nothing
   * about its main thread.
   */
  readonly hungAfterMs: number;
  /**
   * How long a DEPARTED tab's record is kept so the session can still say what
   * happened to it. `closed` and `crashed` are verdicts about a tab that is no
   * longer present, so without a memory the table answers them with silence —
   * which is the 2026-09-17 defect exactly. Bounded because it is a memory,
   * not a log; the session journal is the archive.
   */
  readonly departedMemoryMs: number;
}

export const DEFAULT_TAB_PRESENCE_CONFIG: TabPresenceConfig = {
  beatIntervalMs: 1_000,
  graceMs: 3_000,
  hiddenGraceMs: 30_000,
  gapNoticeMs: 2_000,
  probeAfterMs: 2_000,
  channelBudgetMs: 30_000,
  listenerBudgetMs: 120_000,
  blessDwellMs: 2_000,
  arrivalGraceMs: 120_000,
  hungAfterMs: 15_000,
  departedMemoryMs: 120_000,
};

/** How many departed records the table keeps, whatever
 *  {@link TabPresenceConfig.departedMemoryMs} says. A session has a handful of
 *  page-loads; this is an order of magnitude past that. */
export const DEPARTED_TAB_MEMORY = 8;

export interface TabPresenceState {
  readonly tabs: ReadonlyMap<string, TabRecord>;
  /**
   * TABS THAT ARE GONE, newest departure last — the table's short memory.
   *
   * A departed tab used to be deleted outright, so the one question an
   * operator actually asks ("what happened to it?") had no answer anywhere:
   * `closed` and `crashed` are both verdicts about a tab that is no longer
   * present. Kept SEPARATE from `tabs` deliberately — every decision above
   * reads `tabs`, and a dead record among the live ones would have to be
   * filtered out at each of them. Bounded by
   * {@link TabPresenceConfig.departedMemoryMs} and {@link DEPARTED_TAB_MEMORY}.
   */
  readonly departed: ReadonlyMap<string, TabRecord>;
  /** The one tab commands and lifecycle events address. */
  readonly blessedTabId: string | null;
  /** When the blessing last changed — the dwell clock for `blessDwellMs`. */
  readonly blessedAt: number | null;
  /** Since when the table has had ZERO present tabs; null while any is present. */
  readonly absentSince: number | null;
  /** True once any tab has ever been present. Auto-open only REPLACES. */
  readonly everPresent: boolean;
  /**
   * Auto-open has given up and said so. Set once the budget is spent with
   * still nothing in the table, cleared the moment any tab appears (or a
   * fresh `vgai edit` mandate arrives).
   */
}

export function initialTabPresenceState(): TabPresenceState {
  return {
    tabs: new Map(),
    departed: new Map(),
    blessedTabId: null,
    blessedAt: null,
    absentSince: null,
    everPresent: false,
  };
}

/** The grace this tab gets before it counts as departed. */
function graceFor(tab: TabRecord, config: TabPresenceConfig): number {
  return tab.visibility === 'hidden' ? config.hiddenGraceMs : config.graceMs;
}

/**
 * Is this tab PRESENT?
 *
 * A UNION, deliberately: a fresh beat OR a live control channel. Both are
 * POSITIVE evidence that a tab exists; neither absence is proof on its own,
 * and requiring both would manufacture exactly the false absences this model
 * replaces (a tab mid-reload has no channel for a moment; a tab whose worker
 * was never allowed to start has no beats at all — the share tunnel bridges
 * the event stream one way, so a bridged tab can never beat).
 *
 * What the heartbeat buys, then, is that it ADDS presence and never removes
 * it: a tab whose page socket is down — mid-reload, main thread blocked by a
 * cold module graph, control POSTs starved in the browser's connection pool —
 * is still visibly here, which is the whole failure this replaces. A gap in
 * the beats of a tab that is otherwise connected does not evict it; it gets
 * journaled loudly and shows up in `vgai status` as `lastBeatAgo`, which is
 * the owner's "if they DO get disconnected, make it clear".
 */
export function tabPresent(tab: TabRecord, now: number, config: TabPresenceConfig): boolean {
  if (tab.connected) return true;
  if (!tab.beatEver) return false;
  return now - tab.lastBeatAt < graceFor(tab, config);
}

/** Every present tab, oldest first (the tiebreak bless order). */
export function presentTabs(
  state: TabPresenceState,
  now: number,
  config: TabPresenceConfig,
): TabRecord[] {
  return [...state.tabs.values()]
    .filter((tab) => tabPresent(tab, now, config))
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt || (a.tabId < b.tabId ? -1 : 1));
}

/** Should the server probe this tab's worker rather than wait out the grace? */
export function tabNeedsProbe(tab: TabRecord, now: number, config: TabPresenceConfig): boolean {
  if (!tab.beatEver) return false;
  const age = now - tab.lastBeatAt;
  return age >= config.probeAfterMs && age < graceFor(tab, config);
}

function blankTab(tabId: string, now: number): TabRecord {
  return {
    tabId,
    firstSeenAt: now,
    lastBeatAt: 0,
    beatEver: false,
    epoch: null,
    epochStartedAt: 0,
    epochCount: 0,
    epochs: [],
    visibility: 'visible',
    route: 'unknown',
    surface: 'editor',
    connected: false,
    channelThisEpoch: false,
    listenerThisEpoch: false,
    listenerEpochs: [],
    unresponsiveNoticed: false,
    gapSince: null,
    gapNoticed: false,
    census: [],
    closedEpoch: null,
    closedAt: null,
    closedPersisted: false,
    closedReason: null,
    lastGapMs: null,
    lastGapEndedAt: null,
    commandTimeoutAt: null,
  };
}

/**
 * File a fresh page sample against a tab's history, newest last.
 *
 * A plain append, because every arrival IS a fresh sample — the worker sends a
 * profile once and drops it (see {@link TabCensusSample}). A beat with no
 * census leaves the history untouched: silence is not a profile, and a hidden
 * tab is silent for exactly as long as it is hidden.
 *
 * Two identical-looking samples five seconds apart are kept as two, and that
 * is the point: they differ in the field the death line reads, `at`.
 */
function fileCensus(
  history: readonly TabCensusSample[],
  census: TabCensus | undefined,
  now: number,
): readonly TabCensusSample[] {
  if (census === undefined) return history;
  return [...history, { ...census, at: now }].slice(-TAB_CENSUS_HISTORY);
}

/**
 * A tab whose PAGE never came up this page-load, past the budget for the
 * stage it is stuck at.
 *
 * This is the zombie: everything the server can see about the tab is fine and
 * the document is not. It is present (the tab really is open, and saying
 * otherwise would be a lie a user can see through), it is passed over for
 * blessing so a healthy sibling wins, and when it is the only tab the refusal
 * names this exact fact instead of holding a command for a page that will
 * never take it.
 *
 * TWO STAGES, because there are two things a live tab can fail to do and each
 * has its own evidence and its own budget:
 *
 *  1. NO CHANNEL. The worker beats and the page never opened a control
 *     connection. `channelBudgetMs` — short, because the connection is opened
 *     by the inline bootstrap before any module loads, so a page that has not
 *     opened one in half a minute never will.
 *  2. NO LISTENER. The channel is open and the module graph behind it never
 *     produced a command listener. `listenerBudgetMs` — long, because this
 *     stage is waiting on the whole editor app.
 *
 * Stage 2 exempts a tab that says it is on the LAUNCHER (`route:
 * 'no-project'` — the hub, or the startup-failure surface): those surfaces
 * legitimately run no project command listener, and they are healthy targets
 * for `ensure`'s adopt path, not zombies. A tab whose document never ran says
 * nothing at all and stays `'unknown'`, which is exactly the case stage 2 is
 * for.
 */
export function tabUnresponsive(tab: TabRecord, now: number, config: TabPresenceConfig): boolean {
  const epochStartedAt = tab.epochStartedAt || tab.firstSeenAt;
  if (!tab.connected && !tab.channelThisEpoch) {
    if (!tab.beatEver) return false;
    return now - epochStartedAt >= config.channelBudgetMs;
  }
  if (tab.listenerThisEpoch) return false;
  if (tab.route === 'no-project') return false;
  return now - epochStartedAt >= config.listenerBudgetMs;
}

/** Which stage {@link tabUnresponsive} is reporting — the word a journal line
 *  and a refusal both need, derived from the same record rather than restated. */
export function tabUnresponsiveReason(tab: TabRecord): 'no-channel' | 'no-command-listener' {
  return !tab.connected && !tab.channelThisEpoch ? 'no-channel' : 'no-command-listener';
}

function replaceTab(state: TabPresenceState, tab: TabRecord): TabPresenceState {
  const tabs = new Map(state.tabs);
  tabs.set(tab.tabId, tab);
  // A tab that is live again is not a memory. Dropping it here rather than at
  // each caller is why this is the ONE function that writes the table.
  if (!state.departed.has(tab.tabId)) return { ...state, tabs };
  const departed = new Map(state.departed);
  departed.delete(tab.tabId);
  return { ...state, tabs, departed };
}

/** An epoch is "live" while it has beaten within the duplicate-detection window. */
function liveEpochs(
  epochs: readonly EpochRecord[],
  now: number,
  config: TabPresenceConfig,
): EpochRecord[] {
  return epochs.filter((e) => now - e.lastBeatAt < config.beatIntervalMs * 3);
}

export interface BeatOutcome {
  readonly state: TabPresenceState;
  readonly events: SessionJournalEvent[];
  /**
   * `'re-mint'` when this beat came from a tab whose sessionStorage was
   * COPIED (Chrome's "Duplicate Tab"): two epochs are beating under one
   * tabId, and the younger one is told to mint a fresh tabId.
   */
  readonly reply: 're-mint' | null;
}

/**
 * Record one heartbeat.
 *
 * Reload vs duplicate is decided by one measurement, not a timer: a dedicated
 * Worker dies with its page, so after a RELOAD the old epoch never beats
 * again — its last beat necessarily predates the new epoch's first. Two
 * epochs whose beats INTERLEAVE can only be two live pages, which is the
 * duplicate. The re-mint goes to the younger epoch (the beat that observed
 * the interleave), so the original tab keeps its identity.
 */
export function recordBeat(
  state: TabPresenceState,
  beat: TabBeat,
  now: number,
  config: TabPresenceConfig = DEFAULT_TAB_PRESENCE_CONFIG,
): BeatOutcome {
  const events: SessionJournalEvent[] = [];
  // A beat from a tab the table has already DEPARTED is a RETURN, not a new
  // tab: a machine that went to sleep froze the server's tick and the page's
  // worker together, and on wake the beat can easily land after the sweep. Its
  // old record is what makes that readable — resurrect it, and the gap it
  // carries is what `tabState` reads as `suspended` rather than as a death.
  // (A CLOSED tab cannot come back this way: `sessionStorage` died with it, so
  // a genuinely new tab arrives under a new tabId.)
  const existing = state.tabs.get(beat.tabId) ?? state.departed.get(beat.tabId);
  const base = existing ?? blankTab(beat.tabId, now);
  const tabId8 = beat.tabId.slice(0, 8);

  const others = liveEpochs(base.epochs, now, config).filter((e) => e.epoch !== beat.epoch);
  const mine = base.epochs.find((e) => e.epoch === beat.epoch);
  const myFirstSeenAt = mine?.firstSeenAt ?? now;

  // Two live pages under one tabId: another epoch has beaten AT OR AFTER this
  // one first appeared, so they overlap in time. Only the YOUNGEST re-mints.
  const rival = others.find((e) => e.lastBeatAt >= myFirstSeenAt);
  const duplicated = rival !== undefined && others.every((e) => e.firstSeenAt <= myFirstSeenAt);
  if (duplicated) {
    events.push({ kind: 'tab-duplicated', tabId8 });
    // The record is NOT advanced by an impostor beat: the original tab owns
    // this tabId, and the duplicate is about to re-mint and come back as a
    // tab of its own.
    return { state, events, reply: 're-mint' };
  }

  const epochs: EpochRecord[] = [
    ...others,
    { epoch: beat.epoch, firstSeenAt: myFirstSeenAt, lastBeatAt: now },
  ];
  // The beat's own epoch IS the tab's current page-load. (Reading the OLDEST
  // live epoch instead looks defensible and is not: a reload's dead epoch
  // stays "live" for the pruning window, so the reload went unnoticed for
  // three seconds and the new page-load inherited the old one's channel
  // credit — long enough for the zombie check to be answering about a page
  // that no longer existed.)
  const epochChanged = base.epoch !== null && base.epoch !== beat.epoch;

  if (!existing) {
    events.push({ kind: 'tab-appeared', tabId8, visibility: beat.visibility });
  } else if (existing.beatEver && epochChanged) {
    // A duplicate's FIRST beat is indistinguishable from a reload and is
    // reported as one; its second beat interleaves with the original's and
    // lands on the `tab-duplicated` branch above. One arguable line, followed
    // immediately by the correction — better than withholding the reload
    // report that is right in every other case.
    events.push({ kind: 'tab-reloaded', tabId8, epochCount: existing.epochCount + 1 });
  }
  if (existing?.gapSince !== null && existing?.gapNoticed === true) {
    events.push({ kind: 'tab-gap-closed', tabId8, gapMs: now - existing.gapSince });
  }

  // THE GAP THIS BEAT JUST CLOSED. Recorded here and not in `sweepPresence`
  // because a gap longer than the grace normally ends in a DEPARTURE — the
  // only way one gets closed instead is a tab that came back, which is the
  // suspend `tabState` has to tell apart from a death.
  const gapMs = base.beatEver ? now - base.lastBeatAt : 0;
  const closedGap = gapMs >= graceFor(base, config);
  // A beat from the epoch that said goodbye means the page came BACK — the
  // back/forward cache restored it. The goodbye is no longer true of it.
  const sameEpochReturned = base.closedEpoch !== null && base.closedEpoch === beat.epoch;

  const tab: TabRecord = {
    ...base,
    lastBeatAt: now,
    beatEver: true,
    epoch: beat.epoch,
    epochStartedAt: myFirstSeenAt,
    epochCount: base.epochCount + (epochChanged || base.epochCount === 0 ? 1 : 0),
    epochs,
    visibility: beat.visibility,
    // A new page-load starts owing a channel again — and gets a fresh chance
    // to be called unresponsive, or not.
    channelThisEpoch: epochChanged ? base.connected : base.channelThisEpoch,
    // A listener belongs to the page-load that reported it and to no other:
    // a reload has to load the module graph again, so the new epoch owes its
    // own listener and its own budget starts here.
    listenerThisEpoch: base.listenerEpochs.includes(beat.epoch),
    unresponsiveNoticed: epochChanged ? false : base.unresponsiveNoticed,
    gapSince: null,
    gapNoticed: false,
    // A reload does NOT clear the history: the profile of the page that just
    // went away is the whole point of keeping one, and a renderer death is
    // followed by exactly such a reload.
    census: fileCensus(base.census, beat.census, now),
    ...(sameEpochReturned
      ? { closedEpoch: null, closedAt: null, closedPersisted: false, closedReason: null }
      : {}),
    ...(closedGap ? { lastGapMs: gapMs, lastGapEndedAt: now } : {}),
    // A beat is not an answer to a command, so it does not clear a timeout:
    // that is `noteTabCommandOutcome`'s job, and conflating them is how the
    // worker's liveness would end up vouching for the page's again. A NEW
    // page-load owes nothing to the old one's commands, though.
    ...(epochChanged ? { commandTimeoutAt: null } : {}),
  };
  const next = replaceTab(state, tab);
  return {
    state: next,
    events,
    reply: null,
  };
}

/**
 * Record a page's goodbye ({@link TabCloseBeacon}).
 *
 * Filed against whichever half of the table holds the tab — a beacon can
 * easily land after the sweep has already moved the record into the departed
 * memory (a close is exactly the event that ends the beats), and a verdict
 * that can only be filed on a live record would miss the case it exists for.
 *
 * A beacon for a tab the server has never seen is DROPPED. There is no record
 * to describe and nothing to say about one; inventing a blank record here
 * would put a tab in the memory that was never in the table.
 */
export function recordTabClose(
  state: TabPresenceState,
  beacon: TabCloseBeacon,
  now: number,
): TabPresenceState {
  const closed = {
    closedEpoch: beacon.epoch,
    closedAt: now,
    closedPersisted: beacon.persisted,
    closedReason: beacon.reason,
  };
  const live = state.tabs.get(beacon.tabId);
  if (live !== undefined) return replaceTab(state, { ...live, ...closed });
  const gone = state.departed.get(beacon.tabId);
  if (gone === undefined) return state;
  const departed = new Map(state.departed);
  departed.set(beacon.tabId, { ...gone, ...closed });
  return { ...state, departed };
}

/**
 * Has this tab acknowledged the session's end?
 *
 * Reads BOTH halves of the table, for {@link recordTabClose}'s reason: the ack
 * is the last thing a page does, so its record can already have been swept
 * into the departed memory by the time the question is asked.
 */
export function tabEndAcknowledged(state: TabPresenceState, tabId: string): boolean {
  const tab = state.tabs.get(tabId) ?? state.departed.get(tabId);
  return tab?.closedReason === 'session-ended';
}

/**
 * How a relayed command against this tab ENDED — the server's own half of the
 * `hung` verdict (see {@link TabRecord.commandTimeoutAt}).
 *
 * Latches on a timeout and clears on any answer, which is the honest pair:
 * one expired command is evidence the page was not running, and the next
 * answered one is proof it is. Nothing else clears it — a fresh beat is the
 * WORKER speaking, and the whole point of this field is that the worker cannot
 * vouch for the page.
 */
export function noteTabCommandOutcome(
  state: TabPresenceState,
  tabId: string,
  now: number,
  outcome: 'timed-out' | 'answered',
): TabPresenceState {
  const tab = state.tabs.get(tabId);
  if (tab === undefined) return state;
  const commandTimeoutAt = outcome === 'timed-out' ? now : null;
  if (tab.commandTimeoutAt === commandTimeoutAt) return state;
  if (outcome === 'timed-out' && tab.commandTimeoutAt !== null) return state;
  return replaceTab(state, { ...tab, commandTimeoutAt });
}

/**
 * A tab's CONTROL channel opened or closed. This is a hint, never a verdict:
 * it updates one boolean on the record and schedules a reconcile. Nothing
 * here opens, closes, or blesses a tab.
 */
export function setTabConnected(
  state: TabPresenceState,
  tabId: string,
  connected: boolean,
  now: number,
): TabPresenceState {
  const existing = state.tabs.get(tabId);
  if (existing === undefined) {
    if (!connected) return state;
    const fresh = replaceTab(state, {
      ...blankTab(tabId, now),
      connected: true,
      channelThisEpoch: true,
    });
    return fresh;
  }
  if (existing.connected === connected) return state;
  return replaceTab(state, {
    ...existing,
    connected,
    // Opening a channel is the proof this page-load is alive; losing one is
    // not proof of the opposite, so the flag only ever latches ON.
    channelThisEpoch: existing.channelThisEpoch || connected,
  });
}

/**
 * This page-load reported its COMMAND LISTENER attached.
 *
 * Latches ON for the epoch, for the same reason `channelThisEpoch` does:
 * attaching is proof the document is running, while the detach report that
 * `connectCommandListener`'s cleanup sends (an unmount, an HMR swap) is not
 * proof of the opposite. The listener and heartbeat travel independently:
 * retain the reporting page's identity even if its first beat has not arrived.
 * Never credit whichever page happens to own the tab table at report time.
 */
export function setTabListener(
  state: TabPresenceState,
  tabId: string,
  now: number,
  epoch: string,
): TabPresenceState {
  const existing = state.tabs.get(tabId) ?? blankTab(tabId, now);
  if (existing.listenerEpochs.includes(epoch)) return state;
  // Reloads must not grow the tab record forever. Keep the current page's
  // credit plus recent reports that may be racing a heartbeat or a duplicate.
  const recent = existing.listenerEpochs.filter((value) => value !== existing.epoch);
  const listenerEpochs = [
    ...(existing.epoch !== null && existing.listenerThisEpoch ? [existing.epoch] : []),
    ...recent.slice(-7),
    epoch,
  ];
  return replaceTab(state, {
    ...existing,
    listenerEpochs,
    listenerThisEpoch:
      existing.listenerThisEpoch || existing.epoch === null || existing.epoch === epoch,
  });
}

/**
 * What kind of page this tab is — declared by the bootstrap, or observed from
 * the frame's own origin. Never DOWNGRADED to `'editor'`: the two sources
 * arrive on different connections of one tab, and the narrower reading is the
 * one that knows something.
 */
export function setTabSurface(
  state: TabPresenceState,
  tabId: string,
  surface: TabSurface,
): TabPresenceState {
  const existing = state.tabs.get(tabId);
  if (existing === undefined || existing.surface === surface) return state;
  if (surface === 'editor') return state;
  return replaceTab(state, { ...existing, surface });
}

/** The tab said which surface it is showing. */
export function setTabRoute(
  state: TabPresenceState,
  tabId: string,
  route: TabRoute,
): TabPresenceState {
  const existing = state.tabs.get(tabId);
  if (existing === undefined || existing.route === route) return state;
  return replaceTab(state, { ...existing, route });
}

export interface ReconcileInput {
  readonly now: number;
  /** Last time this server served its index page — an ARRIVING tab. */
  readonly lastIndexRequestAt: number | null;
  /** False for a session that must never open a browser (--no-open, remote). */
  readonly mayOpen: boolean;
}

export interface ReconcileResult {
  readonly state: TabPresenceState;
  /** The blessed tab AFTER reconciliation (null when no tab is present). */
  readonly blessedTabId: string | null;
  /** Present tabs that are not blessed — each is told to yield. */
  readonly yieldTabIds: string[];
  /** Open exactly one tab: the table says there are none. */
  readonly events: SessionJournalEvent[];
}

/**
 * THE ONE FUNCTION THAT DECIDES ANYTHING.
 *
 * Socket events never open, close or bless a tab — they only schedule a call
 * to this. That inversion is the reason the old model could not be repaired
 * in place: its decisions were spread across a connect handler, a disconnect
 * handler, a route handler and a self-heal tick, each holding a fragment of
 * the truth and racing the others. Here the whole truth is the table, read
 * once, and everything downstream is derived from it.
 *
 * Blessing is STICKY: the current blessed tab keeps the blessing while it
 * remains present, so an ordinary reload (same tabId, new epoch) does not
 * hand the session to a different tab. Otherwise the oldest present tab wins,
 * which is stable under any arrival order.
 */
/**
 * Step 1 — gaps and departures, in TAB vocabulary.
 *
 * `lastBeatAt` only ever moves forward, so "age >= grace" IS "continuously
 * absent for the whole grace window": there is no partial-credit state a beat
 * near the boundary could oscillate across. Reappearance, by contrast, is
 * instant — a beat is proof, and making a returning tab serve a probation
 * would be inventing an absence.
 */
function sweepPresence(
  state: TabPresenceState,
  now: number,
  config: TabPresenceConfig,
  events: SessionJournalEvent[],
): TabPresenceState {
  const tabs = new Map(state.tabs);
  const departed = new Map(state.departed);
  for (const tab of [...tabs.values()]) {
    const tabId8 = tab.tabId.slice(0, 8);
    if (!tabPresent(tab, now, config)) {
      events.push({
        kind: 'tab-departed',
        tabId8,
        absentMs: tab.beatEver ? now - tab.lastBeatAt : 0,
      });
      tabs.delete(tab.tabId);
      departed.set(tab.tabId, tab);
      continue;
    }
    if (!tab.beatEver) continue;
    const age = now - tab.lastBeatAt;
    if (age < config.gapNoticeMs) continue;
    if (!tab.gapNoticed) events.push({ kind: 'tab-heartbeat-gap', tabId8, sinceMs: age });
    tabs.set(tab.tabId, { ...tab, gapSince: tab.gapSince ?? tab.lastBeatAt, gapNoticed: true });
  }
  return { ...state, tabs, departed: pruneDeparted(departed, now, config) };
}

/** The departed memory, bounded by age and by count — a memory, not a log. */
function pruneDeparted(
  departed: Map<string, TabRecord>,
  now: number,
  config: TabPresenceConfig,
): Map<string, TabRecord> {
  for (const [tabId, tab] of departed) {
    // A tab that never beat has no departure age of its own; the tab's own
    // first-seen stamp is the only clock it has.
    const goneAt = tab.beatEver ? tab.lastBeatAt : tab.firstSeenAt;
    if (now - goneAt >= config.departedMemoryMs) departed.delete(tabId);
  }
  while (departed.size > DEPARTED_TAB_MEMORY) {
    const oldest = departed.keys().next();
    if (oldest.done === true) break;
    departed.delete(oldest.value);
  }
  return departed;
}

/** Step 2 — the zombies: present and beating, but their page never woke up. */
function partitionEligible(
  state: TabPresenceState,
  present: readonly TabRecord[],
  now: number,
  config: TabPresenceConfig,
  events: SessionJournalEvent[],
): { state: TabPresenceState; eligible: TabRecord[] } {
  const tabs = new Map(state.tabs);
  const eligible: TabRecord[] = [];
  for (const tab of present) {
    if (!tabUnresponsive(tab, now, config)) {
      eligible.push(tab);
      continue;
    }
    if (tab.unresponsiveNoticed) continue;
    events.push({
      kind: 'tab-unresponsive',
      tabId8: tab.tabId.slice(0, 8),
      reason: tabUnresponsiveReason(tab),
      unresponsiveForMs: now - (tab.epochStartedAt || tab.firstSeenAt),
    });
    tabs.set(tab.tabId, { ...tab, unresponsiveNoticed: true });
  }
  return { state: { ...state, tabs }, eligible };
}

/**
 * Step 3 — exactly one blessed tab.
 *
 * Sticky while the holder stays ELIGIBLE, and no reassignment inside
 * `blessDwellMs` unless the holder is genuinely gone. Together those are the
 * anti-flap: an eligibility flip cannot ping-pong the session between two
 * tabs, while a real departure is repaired immediately.
 */
function chooseBlessed(
  state: TabPresenceState,
  present: readonly TabRecord[],
  eligible: readonly TabRecord[],
  now: number,
  config: TabPresenceConfig,
  events: SessionJournalEvent[],
): TabPresenceState {
  let blessedTabId = state.blessedTabId;
  let blessedAt = state.blessedAt;
  const holderEligible = eligible.some((tab) => tab.tabId === blessedTabId);
  const holderPresent = present.some((tab) => tab.tabId === blessedTabId);
  const dwelling = blessedAt !== null && now - blessedAt < config.blessDwellMs;
  if (blessedTabId !== null && !holderEligible && !(holderPresent && dwelling)) {
    blessedTabId = null;
  }
  if (blessedTabId === null && eligible.length > 0) {
    // Oldest first, but a tab with a live channel beats one without: a healthy
    // sibling must win over a page that is merely mid-something.
    const chosen = eligible.find((tab) => tab.connected) ?? eligible[0]!;
    events.push({
      kind: 'tab-blessed',
      tabId8: chosen.tabId.slice(0, 8),
      previousTabId8: state.blessedTabId === null ? null : state.blessedTabId.slice(0, 8),
      reason: state.blessedTabId === null ? 'oldest' : 'sticky',
    });
    blessedTabId = chosen.tabId;
    blessedAt = now;
  }
  return { ...state, blessedTabId, blessedAt };
}

export function reconcile(
  state: TabPresenceState,
  input: ReconcileInput,
  config: TabPresenceConfig = DEFAULT_TAB_PRESENCE_CONFIG,
): ReconcileResult {
  const { now } = input;
  const events: SessionJournalEvent[] = [];

  let next = sweepPresence(state, now, config, events);

  const present = presentTabs(next, now, config);
  next =
    present.length > 0
      ? { ...next, absentSince: null, everPresent: true }
      : next.absentSince === null
        ? { ...next, absentSince: now }
        : next;

  const partition = partitionEligible(next, present, now, config, events);
  next = chooseBlessed(partition.state, present, partition.eligible, now, config, events);
  const blessedTabId = next.blessedTabId;
  // YIELD MEANS "ANOTHER TAB HOLDS THIS SESSION" — so there has to BE another
  // tab. With nothing blessed, no present tab is an extra, and every one of
  // them would be told to go away.
  //
  // MEASURED 2026-09-19, reproducing the wedge in WORK.md §"The editor tab can
  // wedge in a state `vgai edit` cannot self-heal". A page that stalls before
  // React mounts beats forever with no command listener; at
  // `listenerBudgetMs` `partitionEligible` drops it from `eligible`,
  // `chooseBlessed` releases the blessing, and the filter below then named the
  // session's ONLY tab as an extra:
  //
  //     08:59:57.381 tab-unresponsive  tabId8 025db401 reason no-command-listener
  //     08:59:57.382 tab-yielded       tabId8 025db401
  //     08:59:57.390 client-disconnected code 1001   ← the page closed itself
  //     09:00:27.418 tab-departed      tabId8 025db401
  //
  // `tab-lifecycle-client.ts`'s `handleYield` is `window.close()`, falling back
  // to navigating away to the yield page — so the bijection destroyed the one
  // tab it exists to keep, and `ensure`'s heal (`tab-reload`, the one message a
  // page with no module graph can still act on) never got the chance: the yield
  // fires on the reconcile TICK, before any `vgai edit` can reach the heal.
  const yieldTabIds =
    blessedTabId === null
      ? []
      : present.filter((tab) => tab.tabId !== blessedTabId).map((tab) => tab.tabId);

  return { state: next, blessedTabId, yieldTabIds, events };
}

/**
 * Is a tab on its way in — index page served, app not yet beating?
 *
 * A booting tab has no worker, so the table cannot see it and would happily
 * open a second one on top of it. The index request is the only evidence
 * available in that window, and it is bounded so a load that died never
 * suppresses the reconciler forever.
 */
export function tabArriving(
  state: TabPresenceState,
  now: number,
  lastIndexRequestAt: number | null,
  config: TabPresenceConfig = DEFAULT_TAB_PRESENCE_CONFIG,
): boolean {
  if (lastIndexRequestAt === null) return false;
  if (now - lastIndexRequestAt >= config.arrivalGraceMs) return false;
  if (state.absentSince === null) return !state.everPresent;
  return lastIndexRequestAt >= state.absentSince;
}

/**
 * WHAT IS TRUE OF THIS TAB, in one word — the first thing every `vgai` verb
 * says about a tab, and the reason this file exists in its current form.
 *
 * MEASURED 2026-09-17. One symptom — "the battery stopped" — had four causes
 * in one night, and the product reported all four the same way or not at all:
 * a renderer killed by a dev-server reload; a worker that never finished
 * booting; a page whose main thread was stuck in a 46 MB encode (`tab present,
 * last heartbeat 20.5s ago, did not respond`); and a twin call genuinely
 * running for 16 minutes at 21% CPU. Every one of those is a DIFFERENT
 * instruction to whoever is reading, and "present / did not respond" is none
 * of them.
 *
 * The seven words, and the evidence each is allowed to be derived from:
 *
 * - `ended`     — the page ACKNOWLEDGED the session's end: it received
 *                 `tab-close`, ran every terminator behind `markSessionEnded`
 *                 (its Blender engine worker among them) and said so. The one
 *                 verdict that means nothing of this page is still running.
 * - `closed`    — the page said goodbye and no successor is beating.
 * - `reloading` — the page said goodbye and a NEW page-load is already beating.
 * - `crashed`   — the beats stopped past the grace with NO goodbye. The worker
 *                 died with its renderer; nothing got a chance to speak.
 * - `suspended` — the beats stopped past the grace and RESUMED under the same
 *                 epoch. A lid, a sleep, a throttle — not a death.
 * - `hung`      — the beats are fresh and the PAGE is not running: its census
 *                 has stopped being sampled, or a command went out and never
 *                 came back. The worker is a separate thread, which is exactly
 *                 why it keeps saying the tab is fine.
 * - `busy`      — the page is answering and a Blender call is outstanding.
 * - `present`   — none of the above.
 *
 * THE NUMBER IS THE VERDICT. `busy` deliberately does not try to tell a hung
 * twin call from a long one: from outside the worker those are the same
 * observation, and `ms` (the in-flight age) is the whole truth available. A
 * reader decides; nothing here cancels, kills, restarts or budgets anything.
 */
export type TabState =
  | 'ended'
  | 'closed'
  | 'reloading'
  | 'crashed'
  | 'suspended'
  | 'hung'
  | 'busy'
  | 'present';

export interface TabStateVerdict {
  readonly state: TabState;
  /**
   * THE number that goes with the word, in ms — and a different measurement
   * per state, because each word is about a different clock: time since the
   * goodbye (`closed`/`reloading`), beat age (`crashed`/`present`), the gap
   * that was resumed (`suspended`), census age or time since the command
   * expired (`hung`), the outstanding call's age (`busy`). Null only for a tab
   * that has never beaten, which has no clock of its own at all.
   */
  readonly ms: number | null;
  /** The evidence, in a sentence. Printed beside the word so a reader never
   *  has to know which field the verdict came from. */
  readonly because: string;
}

const seconds = (ms: number): string => `${Math.round(ms / 100) / 10}s`;

/**
 * Derive {@link TabState} — ONE function, ONE place, from the table's own
 * fields. Every surface that says what a tab is doing calls this; a second
 * derivation somewhere else is a second opinion, which is the bug this whole
 * file replaces.
 */
export function tabState(
  tab: TabRecord,
  now: number,
  config: TabPresenceConfig = DEFAULT_TAB_PRESENCE_CONFIG,
): TabStateVerdict {
  const grace = graceFor(tab, config);
  const beatAge = tab.beatEver ? now - tab.lastBeatAt : null;
  const beating = beatAge !== null && beatAge < grace;

  if (tab.closedEpoch !== null && tab.closedAt !== null) {
    const sinceClose = Math.max(0, now - tab.closedAt);
    const successor = tab.epoch !== null && tab.epoch !== tab.closedEpoch && beating;
    if (!successor && tab.closedReason === 'session-ended') {
      return {
        state: 'ended',
        ms: sinceClose,
        because:
          `its page acknowledged the session's end ${seconds(sinceClose)} ago — every ` +
          "terminator it holds (every lane's worker among them) had already run when " +
          'it said so',
      };
    }
    if (!successor) {
      return {
        state: 'closed',
        ms: sinceClose,
        because:
          `its page sent a close beacon ${seconds(sinceClose)} ago` +
          (tab.closedPersisted ? ' (into the back/forward cache — it may yet come back)' : '') +
          ' and no new page-load is beating',
      };
    }
    // A successor that has outlived the grace is no longer RELOADING; it is
    // just the tab, and the goodbye it replaced is history.
    if (sinceClose < grace) {
      return {
        state: 'reloading',
        ms: sinceClose,
        because: `its page said goodbye ${seconds(sinceClose)} ago and a new page-load is already beating`,
      };
    }
  }

  if (!tab.beatEver) {
    return {
      state: 'present',
      ms: null,
      because:
        tab.surface === 'vscode'
          ? "this VS Code window has never beaten: its page never ran the session's tab " +
            'bootstrap (/__editor/tab-bootstrap.js), which is what starts the heartbeat ' +
            'worker — the frame loads it before the bridge (docs/CODE-OSS.md §Boot, ' +
            'DESKTOP). Its control channel is all that proves it'
          : 'this tab has never beaten (no heartbeat worker — a tunnelled tab is refused the ' +
            'script); its control channel is what proves it',
    };
  }

  if (!beating) {
    const age = beatAge ?? 0;
    return {
      state: 'crashed',
      ms: age,
      because:
        `its beats stopped ${seconds(age)} ago with no close beacon — the heartbeat worker ` +
        'dies with its renderer, and nothing said goodbye',
    };
  }

  if (
    tab.lastGapMs !== null &&
    tab.lastGapEndedAt !== null &&
    tab.lastGapMs >= grace &&
    now - tab.lastGapEndedAt < grace
  ) {
    return {
      state: 'suspended',
      ms: tab.lastGapMs,
      because: `its beats stopped for ${seconds(tab.lastGapMs)} and resumed under the SAME page-load — a sleep, not a death`,
    };
  }

  if (tab.commandTimeoutAt !== null) {
    const since = Math.max(0, now - tab.commandTimeoutAt);
    return {
      state: 'hung',
      ms: since,
      because:
        `a command timed out against it ${seconds(since)} ago while its beats stayed fresh — ` +
        'the heartbeat is a worker, so it says nothing about the page',
    };
  }

  const newest = latestCensus(tab);
  if (newest !== null) {
    const censusAge = Math.max(0, now - newest.at);
    // ONLY a visible tab. A hidden one is deliberately not sampled at all
    // (`src/tab-census.ts`), so its census age is a fact about being
    // backgrounded and no evidence at all about its main thread.
    if (tab.visibility === 'visible' && censusAge >= config.hungAfterMs) {
      return {
        state: 'hung',
        ms: censusAge,
        because:
          `its beats are fresh but the page has not sampled its census in ${seconds(censusAge)} ` +
          `(it samples every 5s while visible) — the MAIN THREAD is not running`,
      };
    }
    let oldest: { lane: string; ms: number } | null = null;
    for (const [lane, calls] of Object.entries(newest.workerCalls ?? {})) {
      const inFlight = calls.inFlightMs;
      if (inFlight !== null && inFlight > 0 && (oldest === null || inFlight > oldest.ms)) {
        oldest = { lane, ms: inFlight };
      }
    }
    if (censusAge < config.hungAfterMs && oldest !== null) {
      return {
        state: 'busy',
        ms: oldest.ms,
        because:
          `a ${oldest.lane} call has been outstanding for ${seconds(oldest.ms)}; the page is still ` +
          'sampling, so it is running — whether that call is stuck is what the number is for',
      };
    }
  }

  return {
    state: 'present',
    ms: beatAge,
    because: `beating ${seconds(beatAge ?? 0)} ago, page sampling`,
  };
}

/** What `vgai status` prints per tab, and what a refusal quotes. */
export interface TabPresenceReport {
  readonly tabId8: string;
  readonly presentFor: number;
  readonly lastBeatAgo: number | null;
  readonly epochCount: number;
  /**
   * How long ago THIS page-load started (`epochStartedAt`), i.e. the age of
   * the document currently running in this tab. `presentFor` above is the
   * age of the TAB and survives its reloads, which is a different question
   * and the wrong one for anything that cares about what the running
   * document has in memory.
   *
   * P20 reads it as the reference point for "did bytes under `public/`
   * change after this document loaded" — a page-lifetime asset cache is
   * exactly as old as its epoch. It is the server's own observation (the
   * heartbeat's epoch id changing), not a page claim.
   */
  readonly epochAgeMs: number;
  readonly visibility: TabVisibility;
  readonly route: TabRoute;
  /** What kind of page this tab is — see {@link TabSurface}. */
  readonly surface: TabSurface;
  readonly blessed: boolean;
  readonly channel: 'open' | 'down';
  /** Beating, but this page-load has never opened a command channel. */
  readonly unresponsive: boolean;
  /** This tab's newest resource profile, or null when it has never sent one. */
  readonly census: TabCensus | null;
  /** How long ago that profile was filed. Null when there is none. */
  readonly censusAgeMs: number | null;
  /**
   * {@link tabState}'s verdict, flattened — the FIRST thing every reader
   * prints about this tab, before it attempts anything that can fail. Every
   * other field on this row answers a narrower question; this one answers the
   * question that was actually asked.
   */
  readonly state: TabState;
  readonly stateMs: number | null;
  readonly stateBecause: string;
}

/** The newest profile this tab filed, or null. */
export function latestCensus(tab: TabRecord): TabCensusSample | null {
  return tab.census[tab.census.length - 1] ?? null;
}

/**
 * The whole table, for a human or an agent. Owner: "if they DO get
 * disconnected make it clear that it happened" — a per-tab row with the beat
 * age in it is that clarity, and it is the same data every decision above
 * read, not a parallel summary that can disagree with them.
 */
export function tabPresenceReport(
  state: TabPresenceState,
  now: number,
  config: TabPresenceConfig = DEFAULT_TAB_PRESENCE_CONFIG,
): TabPresenceReport[] {
  return presentTabs(state, now, config).map((tab) => reportRow(state, tab, now, config));
}

/**
 * The same row for a tab that is GONE — the table's short memory
 * ({@link TabPresenceState.departed}).
 *
 * Separate from {@link tabPresenceReport} on purpose: `editorsConnected` and
 * every present-tab reader counts that array, and a dead row inside it would
 * make a crashed tab read as a connected one. The words a departed row carries
 * (`closed`, `crashed`) are exactly the ones nobody could print before.
 */
export function departedTabReport(
  state: TabPresenceState,
  now: number,
  config: TabPresenceConfig = DEFAULT_TAB_PRESENCE_CONFIG,
): TabPresenceReport[] {
  return [...state.departed.values()].map((tab) => reportRow(state, tab, now, config));
}

function reportRow(
  state: TabPresenceState,
  tab: TabRecord,
  now: number,
  config: TabPresenceConfig,
): TabPresenceReport {
  const newest = latestCensus(tab);
  const verdict = tabState(tab, now, config);
  return {
    tabId8: tab.tabId.slice(0, 8),
    presentFor: now - tab.firstSeenAt,
    lastBeatAgo: tab.beatEver ? now - tab.lastBeatAt : null,
    epochCount: tab.epochCount,
    // `|| firstSeenAt` matches `tabUnresponsive`'s own fallback for a tab
    // whose epoch has not been stamped yet — never `now`, which would read
    // as a document that just loaded.
    epochAgeMs: now - (tab.epochStartedAt || tab.firstSeenAt),
    visibility: tab.visibility,
    route: tab.route,
    surface: tab.surface,
    blessed: tab.tabId === state.blessedTabId,
    channel: tab.connected ? 'open' : 'down',
    unresponsive: tabUnresponsive(tab, now, config),
    census: newest === null ? null : stripStamp(newest),
    censusAgeMs: newest === null ? null : now - newest.at,
    state: verdict.state,
    stateMs: verdict.ms,
    stateBecause: verdict.because,
  };
}

/** The profile without the server's filing stamp — the report carries the age
 *  as its own field, and two ways to say "when" is one too many. */
function stripStamp(sample: TabCensusSample): TabCensus {
  const { at: _at, ...census } = sample;
  return census;
}

/**
 * The refusal/timeout wording, stated as TABLE FACTS and nothing else.
 *
 * Every previous version of this message described a socket ("its connection
 * is still open", "editor tab lost") and was routinely wrong about the tab.
 * These two sentences can only be wrong if the table is, and the table is
 * what the decision was made from.
 */
export function tabAbsenceMessage(state: TabPresenceState, now: number): string {
  const absentMs = state.absentSince === null ? 0 : now - state.absentSince;
  return (
    `No tab has been present for ${(absentMs / 1000).toFixed(1)}s` +
    ` (nothing reopens it: run ${commandLine('edit')} to open one)`
  );
}

/** The zombie's refusal: the tab is open, the page is not running. */
export function tabUnresponsiveMessage(tab: TabRecord, now: number): string {
  const forMs = now - (tab.epochStartedAt || tab.firstSeenAt);
  const beat = tab.beatEver
    ? `beating (last heartbeat ${((now - tab.lastBeatAt) / 1000).toFixed(1)}s ago)`
    : 'connected (it has never sent a heartbeat)';
  const stuck =
    tabUnresponsiveReason(tab) === 'no-channel'
      ? `has opened no command channel in ${(forMs / 1000).toFixed(0)}s`
      : `opened a control channel but has attached no command listener in ` +
        `${(forMs / 1000).toFixed(0)}s — it never finished loading the editor app, so every ` +
        `command sent there queues with nothing to run it`;
  return (
    `The one tab present is ${beat} but its PAGE ${stuck}. The tab is open and its ` +
    `document is not running. Reload it, or re-run ${commandLine('edit')} (which reuses this session ` +
    `and opens a fresh tab). ${commandLine('status')} prints any page errors that tab reported.`
  );
}

/** The other half: the tab IS here, and here is what it has been doing. */
export function tabWaitingMessage(
  tab: TabRecord,
  now: number,
  reloadsWhileWaiting: number,
): string {
  const beat = tab.beatEver
    ? `last heartbeat ${((now - tab.lastBeatAt) / 1000).toFixed(1)}s ago`
    : 'no heartbeat yet';
  const reloads =
    reloadsWhileWaiting > 0
      ? ` but reloaded ${reloadsWhileWaiting === 1 ? 'once' : `${reloadsWhileWaiting} times`} while this command waited`
      : '';
  return `the tab is present (${beat})${reloads}`;
}
