/**
 * #140 — drives `window.__vgai` through the editor dev-server's SESSION WIRE
 * (`POST /__editor/command`, the same relay `volter-game-editor play`/`volter-game-editor select`/every
 * other `EditorClient` method already uses — see `command-listener.ts`'s
 * `bridge-call`/`bridge-screenshot` cases, the server-side half) instead of
 * Playwright's `page.evaluate` (`client.ts`'s `PageTransport`). Used by
 * `volter-game-editor eval`: the script drives the game INSIDE the already-open editor tab
 * a human is watching, with zero new browser windows and zero extra vite
 * instances.
 *
 * The `bridge-call` op is a session-generic primitive (see
 * `command-listener.ts`'s `dispatchBridgeMethod` doc comment) — this
 * transport issues one HTTP round trip per call and carries no state beyond
 * the port, so it (or a sibling built the same way) is equally usable by a
 * one-shot CLI/REPL call, not just a whole scripted run.
 *
 * Deliberately imports nothing from `@playwright/test` — see
 * `bridge-transport.ts`'s module doc for why that matters (no browser launch
 * anywhere in this path).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BridgeCallOutcome, BridgeTransport } from './bridge-transport.js';
import type { CaptureNotes } from './capture-notes.js';

export interface RelayTransportOptions {
  /** The live editor session's dev-server port (e.g. from
   *  `findLiveEditorSession`/`volter-game-editor edit`). */
  port: number;
  /** Per-call fetch timeout, ms — default covers an ordinary sync-style
   *  bridge call; `callAsync` (debug `invoke`, which may run arbitrary game
   *  code) gets its own longer budget regardless of this override, see
   *  `INVOKE_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * WHICH mounted game these calls address, when the editor has more than one.
   *
   * Omitted is the single-player case and stays the default: the browser
   * resolves the sole live instance. With several mounted it REFUSES rather
   * than guessing (`systemsForInstance`), because the dangerous failure there
   * is not an error — it is success on the wrong game, with every log line
   * reading fine.
   *
   * Rides on `bridge-call` only. A screenshot captures the page, not an
   * instance, and `page-script` reaches the page itself.
   */
  instance?: string;
}

/** The `/__editor/command` wire shape for a relayed command — see
 *  `commandResponseFor` (`packages/editor/server/server-utils.ts`): `data`'s
 *  fields are spread at the TOP level of the JSON body, not nested — this
 *  interface reflects that verbatim, it is not a transcription error. */
interface RelayCommandBody {
  ok: boolean;
  error?: string;
  result?: unknown;
  code?: string;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** `invoke` dispatches to arbitrary game-registered debug commands — give it
 *  real headroom rather than the ordinary sync-call budget above. */
const INVOKE_TIMEOUT_MS = 60_000;
const SCREENSHOT_TIMEOUT_MS = 15_000;
/** A `page-script` step may itself poll (`locator.waitFor`) — give it the
 *  same headroom as `invoke` rather than the ordinary sync-call budget. */
const PAGE_SCRIPT_TIMEOUT_MS = 60_000;

/** How long one `/__editor/state` visibility sample stays good for. Short
 *  enough that foregrounding the tab mid-run is noticed almost immediately,
 *  long enough that the per-leg preflight doesn't double a bot's request
 *  count. */
const HIDDEN_SAMPLE_TTL_MS = 500;

/** How long `reloadPage` waits for a new document AND a working command
 *  round trip before it reports what it did and did not observe. A cold Vite
 *  re-optimize on a first reload is the slow case this budget is sized for. */
const RELOAD_READY_TIMEOUT_MS = 60_000;
const RELOAD_POLL_MS = 250;

/** Seconds since `since`, one decimal — every `reloadPage` failure names how
 *  long it actually waited rather than quoting the budget. */
function elapsedSeconds(since: number): string {
  return ((Date.now() - since) / 1000).toFixed(1);
}

export class RelayTransport implements BridgeTransport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private hiddenDriveLastWallMs: number | null = null;
  private hiddenDriveAnnounced = false;
  private forceHiddenDrive = false;
  private hiddenCache: { hidden: boolean; atMs: number } | null = null;
  private readonly instance: string | undefined;

  constructor(opts: RelayTransportOptions) {
    this.baseUrl = `http://127.0.0.1:${opts.port}`;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.instance = opts.instance;
  }

  /**
   * Deliberately NOT guarded against a page-fallback answer the way the browser
   * (`packages/editor/src/editor-server-response.ts`) and the CLI client
   * (`@volter/editor-sdk`'s `EditorClient.readJson`) are. Those two can be pointed
   * at an arbitrary URL — a share tunnel, a static host — where a `200
   * text/html` for an unserved route is real. This `baseUrl` is
   * `http://127.0.0.1:<port>` and nothing else, and `session.ts` has already
   * PROVED that port is this project's editor server (`probeServedProject`, whose
   * own unparseable-answer path is exactly the refusal): a foreign occupant is
   * refused there, before any command reaches here.
   */
  private async postCommand(
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<RelayCommandBody> {
    const res = await fetch(`${this.baseUrl}/__editor/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return (await res.json()) as RelayCommandBody;
  }

  /** Maps the relay's wire body back onto the transport-neutral
   *  `BridgeCallOutcome` — `result` on success, `code`/`error`/the rest of
   *  `data` on failure. This is the exact property the round-trip unit test
   *  proves: `code`/`data` survive byte-equivalent to `PageTransport`'s own
   *  `unwrap()` path. */
  private toBridgeOutcome(body: RelayCommandBody): BridgeCallOutcome {
    if (body.ok) return { ok: true, result: body.result };
    const { ok: _ok, error, code, result: _result, ...rest } = body;
    return {
      ok: false,
      error: {
        code,
        message: error ?? 'unknown relay error',
        data: Object.keys(rest).length > 0 ? rest : undefined,
      },
    };
  }

  private async bridgeCall(
    method: string,
    callArgs: unknown[],
    timeoutMs: number,
  ): Promise<BridgeCallOutcome> {
    try {
      // `instance` is OMITTED, not sent as undefined, when unset: the wire
      // body is JSON, and an explicit `"instance": null` would have to be
      // distinguished from absence on the far side for no gain.
      const body = await this.postCommand(
        {
          type: 'bridge-call',
          method,
          callArgs,
          ...(this.instance !== undefined ? { instance: this.instance } : {}),
        },
        timeoutMs,
      );
      return this.toBridgeOutcome(body);
    } catch (err) {
      // Never hang, never throw across the transport boundary — a relay
      // that's unreachable (no editor connected, server gone, timeout) is
      // reported the same structured way an in-page bridge-not-installed
      // failure is (see `client.ts`'s `bridgeCallInPage`).
      return {
        ok: false,
        error: {
          code: 'RELAY_UNREACHABLE',
          message:
            `game-live: could not reach the editor dev server relay at ${this.baseUrl} — ` +
            `${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  /**
   * The PREFLIGHT every leg shares: sample the tab's visibility (through the
   * short TTL cache above) and, the first time it reads hidden, say so ONCE on
   * stdout in a stable, greppable line naming the cause and the fix.
   *
   * It runs on every leg, not just `call('snapshot')`, because that is where
   * the measured gap was: a bot that drives the game with `hold`/`command` and
   * reads through them could run
   * its entire session against a backgrounded tab and never be told, so a
   * later failure read as a generic relay timeout instead of "your tab is
   * hidden". Returns whether the tab is hidden so `call` can decide whether to
   * also drive ticks.
   */
  private async preflightHidden(): Promise<boolean> {
    const hidden = this.forceHiddenDrive || (await this.isHiddenCached());
    if (hidden && !this.hiddenDriveAnnounced) {
      this.hiddenDriveAnnounced = true;
      // P21: what was measured, and what this run is doing about it — not a
      // claim about where the tab is. The reading is a `presence` snapshot
      // (`isHidden` below), which ages between the tab's own reports.
      // STDERR, not stdout. `volter-game-editor status` and every other `--json`-shaped verb
      // put their PAYLOAD on stdout and every banner on stderr; this notice went
      // to stdout and prepended a prose sentence to the JSON, so any machine
      // consumer piping `volter-game-editor status` into a parser got a SyntaxError the moment
      // the tab happened to be hidden — measured while reading the coverage
      // table on a backgrounded session. A diagnostic that breaks the payload it
      // annotates is worse than no diagnostic.
      process.stderr.write(
        'game-live: the editor page last REPORTED document.visibilityState "hidden" — the engine ' +
          'stops its loop while the page reports itself hidden, so this run drives ' +
          'deterministic runTicks through the session relay instead of wall clock. Sim time ' +
          'advances either way; `volter-game-editor status` prints that reading with its age.\n',
      );
    }
    return hidden;
  }

  /** `isHidden()` is an HTTP round trip; the preflight now runs on every leg,
   *  so a short TTL keeps that from multiplying a bot's request count while
   *  still reacting to a tab the human foregrounds mid-run. */
  private async isHiddenCached(): Promise<boolean> {
    const now = Date.now();
    if (this.hiddenCache && now - this.hiddenCache.atMs < HIDDEN_SAMPLE_TTL_MS) {
      return this.hiddenCache.hidden;
    }
    const hidden = await this.isHidden();
    this.hiddenCache = { hidden, atMs: now };
    return hidden;
  }

  async call(method: string, callArgs: unknown[]): Promise<BridgeCallOutcome> {
    const hidden = await this.preflightHidden();
    // A predicate-free `waitSimTime` poll reads only the `time` provider. It needs the same hidden
    // tab deterministic driver as a full snapshot or a hidden editor would freeze that lighter
    // clock read forever.
    if (method === 'snapshot' || (method === 'state' && callArgs[0] === 'time')) {
      if (hidden) {
        const now = Date.now();
        const elapsed =
          this.hiddenDriveLastWallMs === null ? 1000 / 60 : now - this.hiddenDriveLastWallMs;
        this.hiddenDriveLastWallMs = now;
        const ticks = Math.max(1, Math.min(30, Math.round(elapsed / (1000 / 60))));
        const driven = await this.bridgeCall(
          'runTicks',
          [ticks, { render: 'last' }],
          this.timeoutMs,
        );
        if (!driven.ok) return driven;
      } else {
        this.hiddenDriveLastWallMs = null;
        this.forceHiddenDrive = false;
      }
    }
    return this.bridgeCall(method, callArgs, this.timeoutMs);
  }

  async callAsync(method: string, callArgs: unknown[]): Promise<BridgeCallOutcome> {
    await this.preflightHidden();
    return this.bridgeCall(method, callArgs, INVOKE_TIMEOUT_MS);
  }

  async isHidden(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/__editor/state`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const state = (await res.json()) as {
        presence?: { visibility?: string; focused?: boolean } | null;
      };
      return state.presence?.visibility === 'hidden';
    } catch {
      return false;
    }
  }

  /**
   * A relay cannot foreground a person's browser tab. If the generic hidden
   * recovery driver reaches this hook, force the same deterministic stepping
   * path `call('snapshot')` normally activates from `/__editor/state`.
   */
  async bringToFront(): Promise<void> {
    this.forceHiddenDrive = true;
  }

  async screenshot(path: string): Promise<CaptureNotes> {
    // Same preflight as every other leg — a hidden tab's canvas is a provably
    // stale frame, and `refreshStarvedFrame` is what asks the relay for a
    // deterministic one-tick refresh instead of a `BRIDGE_SCREENSHOT_STALE`
    // refusal (`command-listener.ts`'s `handleBridgeScreenshot`).
    const body = await this.postCommand(
      {
        type: 'bridge-screenshot',
        refreshStarvedFrame: await this.preflightHidden(),
        // Address THIS transport's instance so a per-seat `game.instance(id)`
        // screenshot captures that seat's game stack, not always the primary.
        ...(this.instance !== undefined ? { instance: this.instance } : {}),
      },
      SCREENSHOT_TIMEOUT_MS,
    );
    if (!body.ok || typeof body['base64'] !== 'string') {
      throw new Error(
        `game-live: screenshot unavailable — ${body.error ?? 'no play-mode canvas to capture'}`,
      );
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(body['base64'] as string, 'base64'));
    // `game.screenshot()` hands back a path, so a near-blank or on-demand frame
    // is indistinguishable from a good one until somebody opens the file —
    // which is exactly how two probes cited blank captures as evidence. The
    // page measured both conditions; carry them back so the caller can persist
    // them beside the frame.
    //
    // The SENTENCE is not said here. `GameClient.screenshot` composes it from
    // these notes PLUS the ones only it has (the out-path's relation to the
    // served project root), and `capture-notes.ts`'s whole contract is that
    // the terminal and the persisted record cannot drift — which a second
    // `console.warn` on a partial set is exactly how they would.
    const warning = (body['flatness'] as { warning?: string } | undefined)?.warning;
    const recordingPath = (body['recording'] as { path?: string } | undefined)?.path;
    const notes: CaptureNotes = {
      ...(body['loopRecoveryFrame'] === true ? { loopRecoveryFrame: true } : {}),
      ...(typeof warning === 'string' ? { flatnessWarning: warning } : {}),
      ...(typeof recordingPath === 'string' ? { recordingPath } : {}),
    };
    return notes;
  }

  /**
   * Ships `src` (`step.toString()`) to the editor dev server's
   * `page-script` op — a STANDALONE relay command (like `bridge-screenshot`
   * above), not a `bridge-call` method (see `command-listener.ts`'s
   * `handlePageScript` doc comment for why). `step` itself is unused on this
   * leg — closures don't survive the wire, see `bridge-transport.ts`'s
   * `runPageScript` doc comment — kept only to satisfy the shared interface
   * `PageTransport` (which DOES call it directly) also implements.
   */
  async runPageScript(src: string, _step: (page: unknown) => unknown): Promise<BridgeCallOutcome> {
    try {
      const body = await this.postCommand({ type: 'page-script', src }, PAGE_SCRIPT_TIMEOUT_MS);
      return this.toBridgeOutcome(body);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'RELAY_UNREACHABLE',
          message:
            `game-live: could not reach the editor dev server relay at ${this.baseUrl} — ` +
            `${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  /** THE MODULE LANE over the relay — same wire shape as `page-script`. */
  async runGameScript(
    src: string,
    _step: (scope: unknown) => unknown,
    instance?: string,
  ): Promise<BridgeCallOutcome> {
    try {
      const body = await this.postCommand(
        { type: 'game-eval', src, ...(instance === undefined ? {} : { instance }) },
        PAGE_SCRIPT_TIMEOUT_MS,
      );
      return this.toBridgeOutcome(body);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'RELAY_UNREACHABLE',
          message:
            `game-live: could not reach the editor dev server relay at ${this.baseUrl} — ` +
            `${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  /**
   * P20 — order the tab to reload, then wait for EVIDENCE that it came back.
   *
   * Two witnesses, in order, because either one alone lies in a way that
   * matters:
   *
   *  1. The tab table's EPOCH count rising. A tab's epoch id is minted per
   *     page-load and carried on its heartbeat, so the server increments
   *     this when it observes a new document — not when the tab claims one.
   *     Without it, a `page-reload` that the page never acted on (a
   *     `beforeunload` blocker, a listener that had already died) would look
   *     identical to a completed reload.
   *
   *     `lastIndexRequestAt` was the first choice here and is measurably the
   *     WRONG one: a reload served from the browser's own cache leaves it
   *     untouched (observed live 2026-08-15 — `epochCount` went 2 → 3 while
   *     the stamp did not move), so it reported "no new document" for a
   *     reload that had plainly happened.
   *  2. A `list-instances` command completing. That is the whole relay path
   *     — server → SSE channel → the NEW document's command listener — so it
   *     is the difference between "a document loaded" and "the session can
   *     be driven again". It has no play gate and no side effects
   *     (`@volter/editor-game`'s `instances.command.ts`). It is sent only
   *     once the server reports the reloaded tab's command listener
   *     attached: the relay does not hold a command for a listener that is
   *     not there yet, and a timeout would be filed as a stall.
   *
   * Neither witness is inferred from the send. A reload that never completes
   * REJECTS with what was and was not observed, rather than resolving into a
   * caller's belief that the page is fresh.
   */
  async reloadPage(): Promise<void> {
    const before = await this.readTabEpochs();
    const orderedAt = Date.now();
    const ordered = await this.postCommand({ type: 'page-reload' }, this.timeoutMs);
    if (!ordered.ok) {
      throw new Error(
        `game-live: the editor session refused the reload — ${ordered.error ?? 'no reason given'}`,
      );
    }
    // The stale visibility sample belongs to a document that no longer
    // exists; the next leg must measure the new one.
    this.hiddenCache = null;
    const deadline = orderedAt + RELOAD_READY_TIMEOUT_MS;
    let reloaded: string[] = [];
    const loaded = await this.pollUntil(deadline, async () => {
      const now = await this.readTabEpochs();
      // Any present tab whose epoch count has RISEN, or a tab that was not
      // in the table before (the reload arrived as a fresh row). An unknown
      // table — an unreachable server, an older one — never witnesses a
      // reload by default; `undefined` compares false here on purpose.
      reloaded = [...now].filter(([tabId, tab]) => tab.epochs > (before.get(tabId)?.epochs ?? 0)).map(([tabId]) => tabId);
      return reloaded.length > 0;
    });
    if (!loaded) {
      throw new Error(
        `game-live: reload ordered ${elapsedSeconds(orderedAt)}s ago and no tab of the session at ` +
          `${this.baseUrl} has reported a new page load. The tab may be gone; ` +
          '`volter-game-editor edit` reopens it.',
      );
    }
    // The new document loads seconds before its command listener attaches
    // (measured: epoch at ~5s, listener at ~13s). A witness command sent in
    // that window is not held — it times out against a beating tab and is
    // filed as a stall in the session's console ledger. So wait for the
    // server to report the reloaded tab's listener attached first; a server
    // that reports no listener state skips straight to the command.
    await this.pollUntil(deadline, async () => {
      const now = await this.readTabEpochs();
      return reloaded.some((tabId) => {
        const listener = now.get(tabId)?.listener;
        return listener === undefined || listener === 'ready';
      });
    });
    const answering = await this.pollUntil(deadline, async () => {
      const ready = await this.postCommand({ type: 'list-instances' }, this.timeoutMs).catch(
        () => ({ ok: false }) as RelayCommandBody,
      );
      return ready.ok;
    });
    if (!answering) {
      throw new Error(
        `game-live: reload ordered ${elapsedSeconds(orderedAt)}s ago — a new document loaded, but ` +
          'its command listener has not answered yet. Check `volter-game-editor status` for page errors ' +
          'from that load.',
      );
    }
  }

  /** Poll `check` every {@link RELOAD_POLL_MS} until it holds or `deadline`
   *  passes; `false` means the deadline won, and the CALLER names what that
   *  means — a shared "timed out" sentence would be exactly the kind of
   *  message that says nothing about which witness was missing. */
  private async pollUntil(deadline: number, check: () => Promise<boolean>): Promise<boolean> {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, RELOAD_POLL_MS));
      if (await check()) return true;
      if (Date.now() >= deadline) return false;
    }
  }

  /** Page-loads per present tab, from `/__editor/state`'s tab table — the
   *  server's own count of the documents it has seen a tab run. Empty when
   *  the server cannot answer, which witnesses nothing. */
  private async readTabEpochs(): Promise<Map<string, { epochs: number; listener?: string }>> {
    try {
      const res = await fetch(`${this.baseUrl}/__editor/state`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const state = (await res.json()) as {
        tabs?: { tabId8?: string; epochCount?: number; commandListener?: unknown }[];
      };
      const epochs = new Map<string, { epochs: number; listener?: string }>();
      for (const tab of state.tabs ?? []) {
        if (typeof tab.tabId8 === 'string' && typeof tab.epochCount === 'number') {
          epochs.set(tab.tabId8, {
            epochs: tab.epochCount,
            ...(typeof tab.commandListener === 'string' ? { listener: tab.commandListener } : {}),
          });
        }
      }
      return epochs;
    } catch {
      return new Map();
    }
  }
}
