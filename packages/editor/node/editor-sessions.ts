/**
 * CLI-side reader of the editor session registry. The WRITER is
 * `packages/editor/server/session-registry.ts` (dev.ts registers on listen /
 * project switch, unregisters on shutdown); the FORMAT — entry shape,
 * guards, path, liveness-filtered read — lives once in
 * `@vgai/sdk`'s `session-registry-format`, which this module and both SDK
 * transports import instead of carrying copies.
 *
 * Every read is defensive: PID-liveness-filtered (crashed servers can't
 * unregister), and callers that need certainty verify a session with
 * `fetchEditorSession` (a live `/__editor/project` fetch) before acting on it.
 */

import {
  type EditorSessionEntry as EditorSession,
  pidAlive,
  readLiveRegisteredSessions,
  servedProjectAnswer,
} from '@volter/editor-sdk/session/registry-format';

export type { EditorSessionEntry as EditorSession } from '@volter/editor-sdk/session/registry-format';

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loopbackPortFree } from './loopback-port';

export interface VerifiedEditorSession {
  port: number;
  project: string | null;
  pid: number | null;
  sessionId: string | null;
  repositoryId: string | null;
  worktreeId: string | null;
  worktreeRoot: string | null;
  projectRelativePath: string | null;
  branch: string | null;
  headCommit: string | null;
  baseCommit: string | null;
  /**
   * FX-1 — does this session have a LIVE REGISTRY ENTRY, or was it found only
   * by probing a port? The distinction is the whole gap between what `vgai
   * edit` can see (this live probe) and what `vgai status`/`play`/`eval` can
   * see (`liveSessions()`, the registry alone): a session in the gap is one
   * `vgai edit` could claim and no other command could reach. Required, not
   * optional, so every producer must answer it.
   */
  registered: boolean;
  /** The server said it is a throwaway probe (`VGAI_EPHEMERAL_SESSION`,
   *  `vgai doctor`). `undefined` from a server too old to say. */
  ephemeral?: boolean;
  /** Set when the server is SERVING `project` but cannot describe it — the
   *  manifest is unparseable or fails strict validation. See
   *  {@link ProbedEditorSession.manifestError}. */
  manifestError: string | null;
}

/** Registered sessions whose server process is still alive. */
export function liveSessions(): EditorSession[] {
  return readLiveRegisteredSessions();
}

/** Canonical (symlink-resolved) form of a path, for project identity checks. */
export function canonicalPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Ask a (possibly unregistered, pre-D12) editor server which project it has
 * open. Returns undefined when nothing answers on that port.
 *
 * The timeout is the DUPLICATE-SESSION knob, not just a latency budget: when
 * a live same-project server merely answers slowly (a dev server's event
 * loop routinely blocks for seconds during Vite dep-optimize/ssrLoadModule),
 * a timeout here reads as "no session" and `vgai edit` silently starts a
 * second editor for the same project on the next port (reproduced live
 * 2026-07-25 with a paused server). A dead port still fails in
 * milliseconds with ECONNREFUSED — only genuinely hung servers pay the full
 * wait — so this errs generously.
 */
export async function fetchEditorSession(
  port: number,
  timeoutMs = 5000,
): Promise<ProbedEditorSession | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__editor/project`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      project: { path?: string } | null;
      serving?: { path?: string; error?: string } | null;
      session?: Record<string, unknown>;
    };
    const session = body.session;
    return {
      port,
      // The serving-vs-project distinction is the shared parser's whole job —
      // see `servedProjectAnswer`'s doc in session-registry-format.
      project: servedProjectAnswer(body).path,
      manifestError: servedProjectAnswer(body).manifestError,
      pid: typeof session?.['pid'] === 'number' ? session['pid'] : null,
      sessionId: typeof session?.['sessionId'] === 'string' ? session['sessionId'] : null,
      repositoryId: typeof session?.['repositoryId'] === 'string' ? session['repositoryId'] : null,
      worktreeId: typeof session?.['worktreeId'] === 'string' ? session['worktreeId'] : null,
      worktreeRoot: typeof session?.['worktreeRoot'] === 'string' ? session['worktreeRoot'] : null,
      projectRelativePath:
        typeof session?.['projectRelativePath'] === 'string'
          ? session['projectRelativePath']
          : null,
      branch: typeof session?.['branch'] === 'string' ? session['branch'] : null,
      headCommit: typeof session?.['headCommit'] === 'string' ? session['headCommit'] : null,
      baseCommit: typeof session?.['baseCommit'] === 'string' ? session['baseCommit'] : null,
      ...(typeof session?.['ephemeral'] === 'boolean' ? { ephemeral: session['ephemeral'] } : {}),
    };
  } catch {
    return undefined;
  }
}

/** What a live `/__editor/project` probe learned about the server answering on
 *  a port. `pid`/`ephemeral` come from the server's own `session` block (FX-1,
 *  `editor-server.ts`) and are absent/null for a server too old to report it. */
export interface ProbedEditorSession {
  port: number;
  project: string | null;
  pid: number | null;
  sessionId: string | null;
  repositoryId: string | null;
  worktreeId: string | null;
  worktreeRoot: string | null;
  projectRelativePath: string | null;
  branch: string | null;
  headCommit: string | null;
  baseCommit: string | null;
  ephemeral?: boolean;
  /**
   * The reason this server cannot describe the project it is SERVING — the
   * `error` half of `/__editor/project`'s `serving` block, i.e. the manifest's
   * own parse/validation failure, with the failing key. `null` when the
   * project reads fine (and when there is no project at all: `project` is then
   * `null` too, which is the genuinely different condition).
   */
  manifestError: string | null;
}

/** A snapshot of the `/__editor/state` fields the verified-open flow cares
 *  about — the live SSE-connected page count, the last published editor
 *  state, and (run-2 frictions fix) the last time this server served its own
 *  index HTML page to a browser, however that page came to be served (Vite
 *  dev middleware,
 *  `express.static` + SPA fallback, the packaged server's fallback — see
 *  `editor-server.ts`'s response-observing middleware). Both default to
 *  "nothing happened yet" (`0` / `null`) on any fetch failure. */
export interface EditorStateSnapshot {
  editorsConnected: number;
  lastIndexRequestAt: number | null;
  stateUpdatedAt: number | null;
  /**
   * ONE ROW PER PRESENT TAB, and the two fields that say whether the DOCUMENT
   * behind it is running (`server/routes/project-state.ts`'s
   * `decorateWithCommandListener` + `tabUnresponsive`).
   *
   * `editorsConnected` above cannot answer that and never could: it is
   * `tabTable.report().length`, and a tab is PRESENT from its first heartbeat
   * — which `index.html`'s inline bootstrap starts before the module graph
   * exists. MEASURED 2026-09-19 (see `waitForVerifiedEditorOpen`): a page
   * stalled before React mounts reaches `editorsConnected: 1` in about two
   * seconds and stays `commandListener: 'not attached'` forever.
   */
  tabs: readonly EditorTabHealth[];
}

/** The per-tab half of {@link EditorStateSnapshot}. */
export interface EditorTabHealth {
  tabId8: string;
  /** `server/server-utils.ts`'s `CommandListenerHealth` — `'ready'`,
   *  `'not attached'`, or `silent since …`. `null` from a server that predates
   *  the field, where the caller must fall back to presence. */
  commandListener: string | null;
  /** The SERVER's own verdict that this page-load is never going to come up
   *  (`tab-presence.ts`'s `tabUnresponsive`). The one clock that decides how
   *  long a boot may take lives there; this side quotes it rather than keeping
   *  a competing one. */
  unresponsive: boolean;
  route: string | null;
}

export type EditorSourceCompatibility =
  | { state: 'current' }
  | { state: 'restart-required'; changedPath?: string; changedAt?: string }
  | { state: 'unknown' };

/** Read only the source-freshness part of the editor compatibility handshake.
 * A failed or older endpoint is `unknown`, not stale: session reuse must keep
 * working for older published editors that predate this handshake. */
export async function fetchEditorSourceCompatibility(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EditorSourceCompatibility> {
  try {
    const res = await fetchImpl(`${serverUrl}/__editor/compatibility`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return { state: 'unknown' };
    const body = (await res.json()) as {
      source?: { state?: unknown; changedPath?: unknown; changedAt?: unknown };
    };
    if (body.source?.state === 'current') return { state: 'current' };
    if (body.source?.state === 'restart-required') {
      return {
        state: 'restart-required',
        ...(typeof body.source.changedPath === 'string'
          ? { changedPath: body.source.changedPath }
          : {}),
        ...(typeof body.source.changedAt === 'string' ? { changedAt: body.source.changedAt } : {}),
      };
    }
    return { state: 'unknown' };
  } catch {
    return { state: 'unknown' };
  }
}

/**
 * THE WORKBENCH THIS SESSION IS RUNNING, read back from the session itself.
 *
 * The launch line names the Code-OSS commit and directory, and it names them
 * from what the SESSION reports rather than from what the CLI resolved a minute
 * earlier: the REH is the session's child, and a line that quoted this side's
 * resolution would be true about a plan rather than about a running process.
 * `null` covers "not framed" and "cannot tell" alike, and callers print nothing
 * for either.
 */
export async function fetchSessionWorkbench(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ kind: string; dir: string; commit: string; product: string } | null> {
  try {
    const res = await fetchImpl(`${serverUrl}/__editor/state`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      workbench?: { kind?: unknown; dir?: unknown; commit?: unknown; product?: unknown } | null;
    };
    const workbench = body.workbench;
    if (
      !workbench ||
      typeof workbench.kind !== 'string' ||
      typeof workbench.dir !== 'string' ||
      typeof workbench.commit !== 'string' ||
      typeof workbench.product !== 'string'
    ) {
      return null;
    }
    return {
      kind: workbench.kind,
      dir: workbench.dir,
      commit: workbench.commit,
      product: workbench.product,
    };
  } catch {
    return null;
  }
}

/**
 * The same read, waited for. The Code-OSS server is the slowest thing a framed
 * boot starts, and the session reports the workbench only once it is listening
 * — so this is how long "Workbench ready at" may take to be TRUE. The deadline
 * is the session's own (`frame-workbench.ts` gives the REH 300s): past it, the
 * session has already printed its own refusal and exited, and this throws
 * naming that terminal rather than inventing a second diagnosis.
 */
export async function waitForSessionWorkbench(
  serverUrl: string,
  timeoutMs = 300_000,
): Promise<{ kind: string; dir: string; commit: string; product: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const workbench = await fetchSessionWorkbench(serverUrl);
    if (workbench) return workbench;
    if (Date.now() > deadline) {
      throw new Error(
        `The session at ${serverUrl}/ never reported a workbench within ${Math.round(timeoutMs / 1000)}s. ` +
          "It prints the Code-OSS server's own refusal on its way down — read this terminal above.",
      );
    }
    await new Promise((settle) => setTimeout(settle, 500));
  }
}

/** #145 — fetch the live `/__editor/state` snapshot. 0/null on any
 *  failure — callers treat "can't tell" as "no page/no request", which at
 *  worst opens a tab that was already open, never the reverse. `fetchImpl`
 *  injectable for unit tests. */
export async function fetchEditorState(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EditorStateSnapshot> {
  try {
    const res = await fetchImpl(`${serverUrl}/__editor/state`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return EMPTY_EDITOR_STATE;
    const body = (await res.json()) as {
      editorsConnected?: number;
      lastIndexRequestAt?: number | null;
      stateUpdatedAt?: number | null;
      tabs?: unknown;
    };
    return {
      editorsConnected: typeof body.editorsConnected === 'number' ? body.editorsConnected : 0,
      lastIndexRequestAt:
        typeof body.lastIndexRequestAt === 'number' ? body.lastIndexRequestAt : null,
      stateUpdatedAt: typeof body.stateUpdatedAt === 'number' ? body.stateUpdatedAt : null,
      tabs: (Array.isArray(body.tabs) ? body.tabs : []).map((row): EditorTabHealth => {
        const tab = (row ?? {}) as Record<string, unknown>;
        return {
          tabId8: typeof tab['tabId8'] === 'string' ? tab['tabId8'] : '',
          commandListener:
            typeof tab['commandListener'] === 'string' ? tab['commandListener'] : null,
          unresponsive: tab['unresponsive'] === true,
          route: typeof tab['route'] === 'string' ? tab['route'] : null,
        };
      }),
    };
  } catch {
    return EMPTY_EDITOR_STATE;
  }
}

const EMPTY_EDITOR_STATE: EditorStateSnapshot = {
  editorsConnected: 0,
  lastIndexRequestAt: null,
  stateUpdatedAt: null,
  tabs: [],
};

/**
 * IS A TAB ON THIS SESSION THAT CAN ACTUALLY RUN A COMMAND?
 *
 * The one predicate every "did the editor come up" wait below keys on. A tab
 * whose `commandListener` is `'ready'` has reported `connectCommandListener`
 * attached from inside the page (`src/api/relay.ts`'s
 * `reportCommandListener`) — the only evidence the server ever gets that the
 * document behind the channel is running.
 *
 * A server that predates the field reports `commandListener: null`; there the
 * old meaning (a present tab) is the best available answer, so presence still
 * counts. That is the ONLY place presence is allowed to stand in for the
 * document.
 */
function commandReadyTabs(snapshot: EditorStateSnapshot): number {
  if (snapshot.tabs.length === 0) return 0;
  if (snapshot.tabs.every((tab) => tab.commandListener === null)) return snapshot.editorsConnected;
  return snapshot.tabs.filter((tab) => tab.commandListener === 'ready').length;
}

/** The server's own verdict that a present tab's page is never coming up, and
 *  the tab it is about. Null while every present tab is still inside the
 *  server's budget. */
function unresponsiveTab(snapshot: EditorStateSnapshot): EditorTabHealth | null {
  return snapshot.tabs.find((tab) => tab.unresponsive) ?? null;
}

/** #145 — live SSE-connected editor-page count for a session (the
 *  server-stamped `editorsConnected` on `/__editor/state`, never the stale
 *  browser-POSTed snapshot). 0 on any failure — callers treat "can't tell"
 *  as "no page", which at worst opens a tab that was already open, never
 *  the reverse. `fetchImpl` injectable for unit tests. */
export async function editorsConnectedAt(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const snapshot = await fetchEditorState(serverUrl, fetchImpl);
  return snapshot.editorsConnected;
}

/** Return a connected editor page without opening anything, including a page
 *  that is briefly reconnecting after its initial Vite load. The recent index
 *  request/state stamps are the server-owned memory that distinguishes that
 *  transient from a genuinely closed tab. */
export async function editorsConnectedOrReconnectingAt(
  serverUrl: string,
  opts: {
    reconnectGraceMs?: number;
    intervalMs?: number;
    nowMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const snapshot = await fetchEditorState(serverUrl, fetchImpl);
  if (snapshot.editorsConnected > 0) return snapshot.editorsConnected;

  const lastActivityAt = Math.max(
    snapshot.lastIndexRequestAt ?? Number.NEGATIVE_INFINITY,
    snapshot.stateUpdatedAt ?? Number.NEGATIVE_INFINITY,
  );
  const graceMs = opts.reconnectGraceMs ?? 5_000;
  const ageMs = (opts.nowMs ?? Date.now()) - lastActivityAt;
  if (!Number.isFinite(lastActivityAt) || ageMs < 0 || ageMs >= graceMs) return 0;

  return waitForEditorPageConnected(serverUrl, {
    timeoutMs: graceMs - ageMs,
    intervalMs: opts.intervalMs ?? 100,
    fetchImpl,
  });
}

/** #145 — poll until at least one editor page can RUN A COMMAND
 *  ({@link commandReadyTabs}). Resolves to that count, or 0 on timeout, or 0
 *  the moment the server declares a present tab unresponsive — waiting out a
 *  budget the server has already spent is time nobody gets back. Pure polling
 *  (no browser spawn) so the CLI's verified-open flow is unit-testable without
 *  a real browser. */
export async function waitForEditorPageConnected(
  serverUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await fetchEditorState(serverUrl, opts.fetchImpl ?? fetch);
    const ready = commandReadyTabs(snapshot);
    if (ready > 0) return ready;
    if (unresponsiveTab(snapshot) !== null) return 0;
    if (Date.now() >= deadline) return 0;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Tab bijection (server: packages/editor/server/tab-lifecycle.ts): ask the
 * session's server to converge its browser tab to exactly one — focus the
 * blessed tab, wait out a tab that is still arriving, or open one (`open`
 * false means "never open", the caller's --no-open). Two answers come from
 * outside the lifecycle proper:
 * - `'disabled'` — the session maintains no tab (started headless with
 *   VGAI_NO_OPEN) and none is connected; the CALLER decides whether to open.
 * - `'unsupported'` — an older server without the endpoint (or an
 *   unreachable one); the caller falls back to client-side convergence.
 */
export type TabEnsureResult =
  | 'focused'
  /** The session's one tab is live but sitting on the launcher / a startup
   *  failure. It has been told to adopt the served project; wait for it —
   *  opening a second tab is the duplicate the bijection forbids. */
  | 'adopt'
  /** The session's one tab is open and BEATING but its document never finished
   *  loading, so it can act on nothing. It has been told to reload itself —
   *  the inline bootstrap handles that without the module graph — and the next
   *  page-load is the one to wait for. */
  | 'reloading'
  | 'arriving'
  | 'opening'
  | 'noop'
  | 'disabled'
  | 'unsupported';

export async function requestEditorTabEnsure(
  serverUrl: string,
  open: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<TabEnsureResult> {
  try {
    const res = await fetchImpl(`${serverUrl}/__editor/tab/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return 'unsupported';
    const body = (await res.json()) as { status?: unknown };
    switch (body.status) {
      case 'focused':
      case 'adopt':
      case 'reloading':
      case 'arriving':
      case 'opening':
      case 'noop':
      case 'disabled':
        return body.status;
      default:
        return 'unsupported';
    }
  } catch {
    return 'unsupported';
  }
}

/**
 * Wait for the session's tab to finish ADOPTING the project — i.e. for the
 * launcher tab the previous `ensure` nudged to report that it is now on the
 * project. Polling `ensure` is the ask: it is idempotent, it re-nudges a tab
 * that missed the first event, and `'focused'` is precisely the answer
 * "the one tab is on the project".
 *
 * `open: false` throughout — adoption must never be able to open a browser,
 * whatever this invocation's --no-open state is.
 */
export async function waitForEditorTabAdopted(
  serverUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 300;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const status = await requestEditorTabEnsure(serverUrl, false, fetchImpl);
    if (status === 'focused') return true;
    // The tab is LANDING. `arriving` is what `ensure` says about a tab whose
    // page has not attached a command listener this epoch, and adoption can
    // produce exactly that: the fallback for a tab with no `onTabAdopt`
    // handler is a reload, and the successor page-load has no listener until
    // its React graph is up. Both of those are this wait's own subject, so
    // they keep it waiting rather than reading as failure.
    if (status === 'arriving' || status === 'reloading') {
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    // Anything that is no longer 'adopt' (the tab closed mid-adoption, an
    // older server) is not adoption succeeding — let the caller's own
    // verification decide, rather than looping on a state that cannot change.
    if (status !== 'adopt') return false;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Tab bijection, restart handoff: tell the session's server a successor is
 * about to take its port, so shutdown must NOT close the browser tab — it
 * stays and reconnects. Best-effort: an older server without the endpoint
 * simply never had server-driven tab closing either.
 */
export async function requestEditorTabExpectRestart(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`${serverUrl}/__editor/tab/expect-restart`, {
      method: 'POST',
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // best-effort by design
  }
}

/**
 * Wait for a browser state report produced after `afterMs`. An SSE socket can
 * remain writable briefly while its page is unloading, and a replacement
 * socket connects before the new app is command-ready. The state POST is the
 * first concrete proof that the replacement app finished booting.
 */
export async function waitForEditorStateAfter(
  serverUrl: string,
  afterMs: number,
  opts: { timeoutMs?: number; intervalMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await fetchEditorState(serverUrl, opts.fetchImpl ?? fetch);
    if (
      snapshot.editorsConnected > 0 &&
      snapshot.stateUpdatedAt !== null &&
      snapshot.stateUpdatedAt > afterMs
    ) {
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Run-2 frictions fix — cold-Vite misdiagnosis. `waitForEditorPageConnected`
 * gives up after a flat 15s, which is the RIGHT signal for "did a browser
 * even show up" but the WRONG one for "did the editor app finish loading":
 * a freshly scaffolded project's FIRST page load pays Vite's dep-optimize
 * cold start (worse on drvfs/9P), which can take far longer than 15s while
 * the tab sits there loading correctly. Proven live: create/`vgai edit`
 * printed "auto-open likely failed silently" while the browser tab was, in
 * fact, open and loading.
 *
 * WHAT "CONNECTED" MEANS, and the correction this carries (measured
 * 2026-09-19, WORK.md §"The editor tab can wedge in a state `vgai edit` cannot
 * self-heal"). This used to succeed on `editorsConnected > 0` and its own doc
 * called that "SSE attached, i.e. the app finished booting". That equivalence
 * was true when presence WAS the page's socket; it stopped being true when
 * presence moved to the heartbeat table, because `index.html`'s inline
 * bootstrap starts the heartbeat worker before the module graph exists. A page
 * that stalls before React mounts therefore reached `editorsConnected: 1` in
 * about two seconds, and `vgai edit` printed
 *
 *     Editor page connected — the browser is showing http://127.0.0.1:22845/
 *
 * and exited 0 for a tab that answered nothing, for the rest of the session.
 * Success is now the DOCUMENT ({@link commandReadyTabs}), which is the fact
 * the server already measures per tab.
 *
 * `lastIndexRequestAt` gets the same correction on the other side. It is
 * `null` for a tab that RETURNS to a successor server on the same port — a
 * reconnecting page never re-requests `/`, and a wedged page is exactly the
 * page that outlives its server — so "a browser arrived" is read off the tab
 * TABLE as well, where a beating tab is proof no stamp can improve on.
 *
 * This distinguishes three outcomes:
 *
 * - `connected` — a tab reported its command listener attached. Can
 *   happen at any point, even before `initialTimeoutMs`.
 * - `never-arrived` — no index-page request was observed by
 *   `initialTimeoutMs` (default 15s): the auto-open itself likely failed,
 *   exactly the case the old flat timeout was built for. Reported
 *   immediately — no reason to wait the full budget for a browser that
 *   never showed up at all.
 * - `stuck` — a browser DID request the index page within the initial
 *   window (so the hand-off worked) but never SSE-connected even by
 *   `totalTimeoutMs` (default 120s) — a real problem (console error, stuck
 *   build) worth naming distinctly from "never arrived".
 *
 * A TAB THAT IS THERE AND NOT YET MOUNTED IS NOT AN OUTCOME, because it is not
 * over: the wait continues to `totalTimeoutMs`, and `onProgress` is what
 * narrates it. Nothing here asks the person for anything, and nothing here says
 * they are being asked — a `vgai edit` workbench opens on a folder
 * whose session IS the trust decision, so the only reason it can still be
 * loading is a cold Vite dep-optimize (see the workbench contribution's
 * `connectSessionTab`, packages/editor/workbench/src/vgai.contribution.ts). The
 * page says the same thing from its own side: the product's cover carries the
 * product's name and "Opening…" until the editor is there.
 *
 * `openAttemptAt` must be captured by the CALLER immediately before
 * `openBrowser(...)` — only an index request AT OR AFTER that instant counts
 * as "arrived for this attempt" (an old request from a previous session).
 * `onProgress(elapsedMs)` fires at most once per `progressIntervalMs`
 * (default 20s) once a browser has arrived but not yet connected, so a human
 * watching a cold Vite boot sees intermittent proof of life instead of
 * silence. `fetchImpl`/short custom timeouts make this fully unit-testable
 * without a real browser or a 2-minute test.
 */
export type VerifiedEditorOpenOutcome =
  | { status: 'connected'; connectedCount: number }
  | { status: 'never-arrived' }
  | { status: 'stuck' };

export async function waitForVerifiedEditorOpen(
  serverUrl: string,
  opts: {
    openAttemptAt: number;
    initialTimeoutMs?: number;
    totalTimeoutMs?: number;
    intervalMs?: number;
    progressIntervalMs?: number;
    fetchImpl?: typeof fetch;
    onProgress?: (elapsedMs: number) => void;
  },
): Promise<VerifiedEditorOpenOutcome> {
  const {
    openAttemptAt,
    initialTimeoutMs = 15_000,
    totalTimeoutMs = 120_000,
    intervalMs = 500,
    progressIntervalMs = 20_000,
    fetchImpl = fetch,
    onProgress,
  } = opts;
  const initialDeadline = openAttemptAt + initialTimeoutMs;
  const totalDeadline = openAttemptAt + totalTimeoutMs;
  let browserArrived = false;
  let lastProgressAt = openAttemptAt;

  for (;;) {
    const snapshot = await fetchEditorState(serverUrl, fetchImpl);
    const ready = commandReadyTabs(snapshot);
    if (ready > 0) {
      return { status: 'connected', connectedCount: ready };
    }
    if (
      snapshot.tabs.length > 0 ||
      (snapshot.lastIndexRequestAt !== null && snapshot.lastIndexRequestAt >= openAttemptAt)
    ) {
      browserArrived = true;
    }

    const now = Date.now();
    // The SERVER owns the budget for "this page is never coming up"
    // (`tab-presence.ts`'s `listenerBudgetMs`), and it has just spent it. Say
    // so now rather than sit out a second clock that measures the same thing.
    if (unresponsiveTab(snapshot) !== null) return { status: 'stuck' };
    if (!browserArrived && now >= initialDeadline) return { status: 'never-arrived' };
    if (browserArrived && now >= totalDeadline) return { status: 'stuck' };
    if (browserArrived && onProgress && now - lastProgressAt >= progressIntervalMs) {
      lastProgressAt = now;
      onProgress(now - openAttemptAt);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** What `restartPendingSessionHint` learned from `.vgai/session.json`. */
export interface PendingSessionHint {
  port: number | null;
  pid: number | null;
}

/**
 * Restart-window race guard (editor-session diagnosis cause 3): the dev
 * host's exit-75 source-change handoff leaves a multi-second window with NO
 * server on the project's port while the owning CLI relaunches it. A
 * concurrent `vgai edit` probing during that window sees "no session" and
 * spawns its own server — which then collides with the owner's relaunch on
 * the same port ("Port already in use" + registry churn). The dying server
 * REFRESHES the in-project `.vgai/session.json` on a restart exit instead of
 * removing it (dev.ts's exit handler), so the file is the marker: a live pid
 * means a server exists but hasn't answered/registered yet, and a recent
 * mtime means a restart handoff is in flight. Either way the caller should
 * retry the probe for a bounded few seconds before concluding absent. `null`
 * means no session file, an unreadable one, or a stale one (dead pid + old
 * mtime) — conclude absent immediately, exactly as before.
 */
export function restartPendingSessionHint(
  projectDir: string,
  opts: {
    nowMs?: number;
    recentWindowMs?: number;
    pidAliveImpl?: (pid: number) => boolean;
  } = {},
): PendingSessionHint | null {
  const file = join(projectDir, '.vgai', 'session.json');
  let mtimeMs: number;
  let parsed: { port?: unknown; pid?: unknown };
  try {
    mtimeMs = statSync(file).mtimeMs;
    parsed = JSON.parse(readFileSync(file, 'utf8')) as { port?: unknown; pid?: unknown };
  } catch {
    return null; // no session file (or unreadable/torn) — nothing pending
  }
  const pid = typeof parsed.pid === 'number' ? parsed.pid : null;
  const port = typeof parsed.port === 'number' ? parsed.port : null;
  const alive = pid !== null && (opts.pidAliveImpl ?? pidAlive)(pid);
  const recent = (opts.nowMs ?? Date.now()) - mtimeMs < (opts.recentWindowMs ?? 15_000);
  return alive || recent ? { port, pid } : null;
}

/**
 * Live sessions with their CURRENT project verified by a live request — registry
 * entries that don't answer are dropped; a legacy (unregistered) server on
 * `alsoCheckPort` is included if it answers.
 */
export async function verifiedSessions(alsoCheckPort?: number): Promise<VerifiedEditorSession[]> {
  const out: VerifiedEditorSession[] = [];
  const seenPorts = new Set<number>();
  for (const s of liveSessions()) {
    const probed = await fetchEditorSession(s.port);
    if (!probed) continue;
    if (probed.sessionId && s.sessionId && probed.sessionId !== s.sessionId) continue;
    if (probed.pid !== null && probed.pid !== s.pid) continue;
    seenPorts.add(s.port);
    out.push({
      port: s.port,
      project: probed.project,
      pid: s.pid,
      sessionId: probed.sessionId,
      repositoryId: probed.repositoryId,
      worktreeId: probed.worktreeId,
      worktreeRoot: probed.worktreeRoot,
      projectRelativePath: probed.projectRelativePath,
      branch: probed.branch,
      headCommit: probed.headCommit,
      baseCommit: probed.baseCommit,
      manifestError: probed.manifestError,
      registered: true,
      ...(probed.ephemeral !== undefined ? { ephemeral: probed.ephemeral } : {}),
    });
  }
  if (alsoCheckPort !== undefined && !seenPorts.has(alsoCheckPort)) {
    const probed = await fetchEditorSession(alsoCheckPort);
    // FX-1: this entry is the whole point of `registered: false` — a server
    // nothing registered, found only because it happens to answer on the port
    // this launch was aiming at. It is real enough to REFUSE a port to, and
    // never enough to report as "this project's editor is already open".
    if (probed)
      out.push({
        port: probed.port,
        project: probed.project,
        pid: probed.pid,
        sessionId: probed.sessionId,
        repositoryId: probed.repositoryId,
        worktreeId: probed.worktreeId,
        worktreeRoot: probed.worktreeRoot,
        projectRelativePath: probed.projectRelativePath,
        branch: probed.branch,
        headCommit: probed.headCommit,
        baseCommit: probed.baseCommit,
        manifestError: probed.manifestError,
        registered: false,
        ...(probed.ephemeral !== undefined ? { ephemeral: probed.ephemeral } : {}),
      });
  }
  return out;
}

/** True for a Node `ESRCH` error (POSIX "no such process" — the process, or
 *  in `process.kill(-pid, …)`'s case the whole process GROUP, is already
 *  gone). Any other error (e.g. `EPERM`) is a real problem and must not be
 *  swallowed alongside it. */
function isEsrch(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ESRCH'
  );
}

/**
 * Kill a detached process by its GROUP, given only the group leader's pid.
 *
 * A server spawned via `npx tsx …` with `detached: true` re-spawns the real
 * process as a further descendant (`npm exec` -> `sh -c tsx …` -> the actual
 * `node` process) — proven live: killing ONLY the recorded (leader) pid with a
 * plain `SIGTERM` leaves that real process running, reparented to init but
 * still carrying the SAME process group id, so it keeps serving indefinitely
 * as an orphan. The recorded pid IS the group leader, so a process-GROUP
 * signal (the negative-pid form) reaches every descendant in one shot — this
 * still works even after the leader itself has already exited, since the group
 * id persists as long as any member is alive.
 *
 * This mirrors `packages/editor/e2e/helpers/server.ts`'s `stopProcess`
 * discipline (group kill first, bare-pid fallback; `taskkill /T` is the
 * Windows tree-kill equivalent) but is reimplemented against a bare `pid` read
 * back from the JSON session registry — `vgai close` runs in a DIFFERENT
 * process than the one that spawned the server, so there is no live
 * `ChildProcess` handle to hand `stopProcess` itself.
 *
 * Hardening (closure objection on an earlier attempt at this fix): BOTH the
 * group-kill attempt and its bare-pid fallback can independently race a
 * process that's already exiting on its own — by the time this runs, the group
 * may already be gone (first `process.kill(-pid, …)` throws `ESRCH`) AND the
 * pid itself may ALSO already be gone by the time the fallback tries it
 * (second `process.kill(pid, …)` throws its OWN `ESRCH`). An unguarded
 * fallback call would let that second throw escape uncaught — `vgai close`
 * must never crash just because there was, in the end, nothing left to kill.
 * Both attempts are therefore wrapped, and only `ESRCH` is swallowed; any
 * other error (e.g. `EPERM`) still propagates — a real problem, not "already
 * gone".
 *
 * Ordinary editor sessions use `killEditorSessionProcess` below because their
 * registry pid can be an inner child; this direct group-first path is what
 * that helper falls back to on Windows.
 */
export function killProcessGroup(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // already dead, or taskkill itself unavailable — bare-pid kill below is the last resort
    }
    try {
      process.kill(pid, signal);
    } catch (err) {
      if (!isEsrch(err)) throw err; // a real problem, not "already gone" — surface it
    }
    return;
  }
  try {
    process.kill(-pid, signal); // negative pid = the whole process group
  } catch (err) {
    if (!isEsrch(err)) throw err;
    try {
      process.kill(pid, signal); // group already gone — fall back to the bare pid
    } catch (err2) {
      // pid ALSO already gone (both the group and the leader exited before
      // this ran) — nothing left to kill, which is a successful close, not
      // an error. Any OTHER failure here still propagates.
      if (!isEsrch(err2)) throw err2;
    }
  }
}

/** Return the POSIX process-group id for `pid`, or `undefined` when it cannot
 * be read. Editor sessions are launched detached, but the registry records the
 * inner `dev.ts` Node pid rather than the `npx` group leader. Looking the group
 * up here lets `vgai close` reach the complete npx -> tsx -> Vite/esbuild tree
 * without changing the durable registry format. */
function processGroupId(pid: number): number | undefined {
  if (process.platform === 'win32') return undefined;
  try {
    const parsed = Number.parseInt(
      execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
      10,
    );
    return Number.isInteger(parsed) && parsed > 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Kill an ordinary editor's complete detached process group when it has one.
 * A non-detached process (including unit-test children) shares this CLI's
 * process group and is deliberately signalled by pid only so closing an editor
 * can never signal the caller's own terminal group. */
export function killEditorSessionProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (process.platform === 'win32') {
    killProcessGroup(pid, signal);
    return;
  }
  const group = processGroupId(pid);
  const ownGroup = processGroupId(process.pid);
  const target = group !== undefined && group !== ownGroup ? -group : pid;
  try {
    process.kill(target, signal);
  } catch (error) {
    if (!isEsrch(error)) throw error;
  }
}

export type SessionTermination = 'already-gone' | 'graceful' | 'forced';

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (pidAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !pidAlive(pid);
}

/**
 * Stop a registered session and do not report success until its PID is gone.
 * The server gets a bounded graceful window matching its own shutdown budget;
 * a broken or older server is then force-killed so an immediate restart cannot
 * collide with its tsx/esbuild children.
 */
export async function terminateEditorSession(
  session: Pick<EditorSession, 'pid'>,
  graceMs = 5_500,
): Promise<SessionTermination> {
  if (!pidAlive(session.pid)) return 'already-gone';
  try {
    killEditorSessionProcess(session.pid, 'SIGTERM');
  } catch (error) {
    if (isEsrch(error)) return 'already-gone';
    throw error;
  }
  if (await waitForPidExit(session.pid, graceMs)) return 'graceful';

  try {
    killEditorSessionProcess(session.pid, 'SIGKILL');
  } catch (error) {
    if (!isEsrch(error)) throw error;
  }
  if (!(await waitForPidExit(session.pid, 1_000))) {
    throw new Error(`Editor process ${session.pid} did not exit after SIGKILL.`);
  }
  return 'forced';
}

/** First bindable port at or above `start` (skipping `avoid`). */
export async function findFreePort(start: number, avoid: Set<number>): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (avoid.has(port)) continue;
    if (await loopbackPortFree(port)) return port;
  }
  throw new Error(`No free editor port found in ${start}..${start + 99}`);
}
