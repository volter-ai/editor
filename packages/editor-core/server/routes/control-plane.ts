/**
 * THE CONTROL PLANE — everything between a tab and this server that is not a
 * file read or a file write.
 *
 * One subsystem, two HTTP surfaces. The tab routes (`routes/session-tabs.ts`)
 * and the relay routes (`routes/relay.ts`) are registered from their own
 * modules, but both drive THIS: the pending-command table, the four upstream
 * control-message handlers, the SSE event stream, the duplex control socket,
 * and the command relay itself. They could not be split further without
 * inventing a hand-off wider than the subsystem.
 *
 * The invariant the whole file exists for: COMMANDS ARE ADDRESSED TO A TAB,
 * NOT TO A SOCKET. A socket is a per-page-load thing that comes and goes under
 * an ordinary reload; the tab is what the caller means. So the relay asks the
 * TABLE which tab is blessed, then looks up whatever channel that tab holds —
 * and if it holds none this instant, it WAITS inside the command's own budget
 * rather than answering "disconnected" about a tab that is provably here.
 *
 * The second invariant: a tab reports four facts upstream (it picked a command
 * up, the command finished, its state snapshot, which surface it is showing)
 * over its control socket OR as a POST, and BOTH land on the same handler
 * here, so the two transports cannot answer differently.
 */

import { commandLine } from '../../src/product-command';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import {
  EDITOR_CONTROL_LIFECYCLE_VERSION,
  type EditorControlLifecycle,
  editorControlLifecycleMismatch,
  parseEditorControlLifecycle,
} from '@volter/editor-sdk/session/editor-control-lifecycle';
import { COMMAND_RESULT_RECEIPT_EVENT } from '@volter/editor-sdk/session/editor-control-protocol';
import { isRelayCommandType } from '@volter/editor-sdk/session/command-table';
import type { Request, Response } from 'express';
import {
  ABNORMAL_SOCKET_CLOSE,
  CONTROL_ECHO_TIMEOUT_MS,
  createEditorControlSocket,
  type EditorControlSocketServer,
} from '../editor-control-socket';
import { type EditorServerRouter, headerValue, noEditorConnectedMessage } from '../editor-server';
import {
  addClient,
  clientControlHealthFor,
  clientCount,
  clientIdForResponse,
  closeClient,
  commandListenerFactsFor,
  type EditorEventClient,
  isClientAlive,
  isEditorSocketClient,
  noteCommandListenerAttached,
  noteCommandReceipt,
  noteCommandRelay,
  removeClient,
  sendToClientHandle,
  updateClientControlHealth,
} from '../editor-sse';
import { acceptPagePhase, playStallConsoleMessage, playStallDiagnosis } from '../play-stall';
import {
  CONTROLLER_DISCONNECTED_MESSAGE,
  type CommandListenerHealth,
  commandListenerHealth,
  DESKTOP_FRAME_ORIGIN,
  isAllowedEditorOrigin,
  RELAY_DELIVERY_ACK_MS,
  RELAY_DELIVERY_MAX_WAIT_MS,
  type RelayedCommandResult,
  relayCommandAckDeadlineMs,
  relayCommandTimeoutMs,
  unacknowledgedCommandMessage,
} from '../server-utils';
import { processSessionId } from '../session-registry';
import type { TabLifecycleController } from '../tab-lifecycle';
import {
  type TabPresenceReport,
  type TabSurface,
  tabAbsenceMessage,
  tabUnresponsiveMessage,
  tabWaitingMessage,
} from '../tab-presence';
import type { ControlOutcome, RouteContext, TrustedShareIdentity } from './context';

/** How many distinct pre-listener page errors one page-load may file. Enough
 *  for a cause plus a little of its cascade; a page in a rejection loop must
 *  not grow this without bound. */
const PAGE_ERRORS_PER_CLIENT = 8;
/** Per error. A stack is what makes the line actionable, so this is generous;
 *  it is a bound, not a summary. */
const PAGE_ERROR_MAX_CHARS = 2_000;
/** How many distinct CLIENT IDS may hold page errors at once. The per-client
 *  teardown only fires for clients that really connected, but the POST twin
 *  accepts a self-reported id — so without this bound a writer inventing
 *  fresh ids would grow the map (and spam the journal) forever. A session has
 *  a handful of live page-loads; this is an order of magnitude past that. */
const PAGE_ERROR_CLIENTS_MAX = 32;

export interface SettledCommandResult {
  result: RelayedCommandResult;
  /** Sent only after the original command caller's response finishes. */
  callerReceipt?: () => void;
}

export interface OpenGameplayRecording {
  readonly purpose?: 'export';
  readonly format: 'composite-webm' | 'canvas-dom';
  readonly path: string;
  readonly replayPath: string | null;
  nextSequence: number;
  nextDomSequence: number;
  domEventCount: number;
  domEventsStarted: boolean;
  readonly replayAssets: Set<string>;
}

export interface PresentedControlLifecycle {
  readonly status: 'aligned' | 'awaiting-heartbeat' | 'unconfirmed' | 'mismatch';
  readonly serverGeneration8: string;
  readonly connectionGeneration8: string;
  readonly pageGeneration8: string;
  readonly clientId8: string;
}

/** What the two route families read off the control plane. */
export interface ControlPlane {
  readonly handleCommandReceived: (payload: Record<string, unknown>) => ControlOutcome;
  readonly handleCommandListener: (payload: Record<string, unknown>) => ControlOutcome;
  readonly handlePlayPhase: (payload: Record<string, unknown>) => ControlOutcome;
  readonly handleConsoleEntries: (payload: Record<string, unknown>) => ControlOutcome;
  readonly handleConsoleResolved: (payload: Record<string, unknown>) => ControlOutcome;
  readonly handlePageError: (payload: Record<string, unknown>) => ControlOutcome;
  /** The page's contributed command rows (`/__editor/contributed-commands`). */
  readonly handleContributedCommands: (payload: Record<string, unknown>) => ControlOutcome;
  readonly handleCommandResult: (payload: Record<string, unknown>) => ControlOutcome;
  readonly handleEditorState: (reported: Record<string, unknown>) => ControlOutcome;
  readonly handleTabRoute: (
    body: Record<string, unknown>,
    trusted: TrustedShareIdentity | null,
  ) => ControlOutcome;
  readonly decorateWithCommandListener: (
    rows: readonly TabPresenceReport[],
    table: TabLifecycleController | null,
    now: number,
  ) => Array<
    TabPresenceReport & {
      commandListener?: CommandListenerHealth;
      pageErrors?: string[];
      controlLifecycles?: PresentedControlLifecycle[];
    }
  >;
  readonly tabTableFor: (participantId: string | null) => TabLifecycleController | null;
  readonly clientsInDeliveryOrder: (
    tabId: string,
    table: TabLifecycleController | null,
  ) => string[];
  readonly relayCommand: (
    body: Record<string, unknown>,
    requestedParticipantId?: string,
  ) => Promise<SettledCommandResult>;
  readonly relayCommandResult: (body: Record<string, unknown>) => Promise<RelayedCommandResult>;
  readonly openGameplayRecording: (id: unknown) => OpenGameplayRecording | null;
  /** The open recordings themselves — the chunk/finish/abort routes mutate them. */
  readonly openGameplayRecordings: Map<string, OpenGameplayRecording>;
  /** Close the duplex control socket. Part of the server's teardown. */
  readonly close: () => void;
  readonly MAX_RECORDING_CHUNK_BYTES: number;
}

export function createControlPlane(router: EditorServerRouter, ctx: RouteContext): ControlPlane {
  const {
    clientIdsForTab,
    clientTabIds,
    clientTabLifecycles,
    consoleLedger,
    currentCollaboration,
    currentCollaborationLocation,
    defaultCollaborationRole,
    editorStatesByClient,
    heartbeat,
    hostTabLifecycle,
    journalEvent,
    localParticipantIds,
    onTabReloaded,
    options,
    pageErrorsByClient,
    participantConnections,
    participantLeaveTimers,
    participantTabLifecycles,
    short,
    tabIdForClient,
    tabLifecycleForParticipant,
    trustedShareIdentity,
  } = ctx;
  /**
   * One accepted generation per event-stream connection, plus the current
   * generation for each page id. The connection map validates socket frames;
   * the page map validates POST fallbacks and is compare-deleted so a late
   * close from a superseded socket cannot erase its successor.
   */
  const controlLifecycleByConnection = new Map<EditorEventClient, EditorControlLifecycle>();
  const controlLifecycleByClientId = new Map<string, EditorControlLifecycle>();
  const currentConnectionByClientId = new Map<string, EditorEventClient>();
  const confirmedLifecycleConnections = new Set<EditorEventClient>();

  /**
   * THE THING THE LEDGER CANNOT OTHERWISE TELL APART: a page with no errors,
   * and a page that is not reporting its errors. Both are an empty ledger.
   *
   * Measured 2026-09-19 (U6b's Model-workspace walk): the fork's bridge boots
   * the editor without `installConsoleSync()`, so 44 React errors filled that
   * page's console and the bottom bar's counter while `vgai console` printed a
   * clean session for the length of a walk. The page-side fix is one door that
   * cannot be half-called (`src/console-sync.ts`); this is the half that
   * NOTICES when some future host gets it wrong anyway, because a convention
   * whose failure is silent is not enforced by anything.
   *
   * A reporting page announces itself with an empty batch the moment it
   * installs. A load that proved it is running the document and has still said
   * nothing after the grace window becomes an error in the ledger itself —
   * named, in the one place the convention says to look.
   */
  const consoleReporterWatch = new Map<string, ReturnType<typeof setTimeout>>();
  const consoleReportingLoads = new Set<string>();
  const CONSOLE_REPORTER_GRACE_MS = 30_000;

  function armConsoleReporterWatch(clientId: string): void {
    if (consoleReportingLoads.has(clientId) || consoleReporterWatch.has(clientId)) return;
    const timer = setTimeout(() => {
      consoleReporterWatch.delete(clientId);
      if (consoleReportingLoads.has(clientId)) return;
      consoleLedger.observe({
        severity: 'error',
        source: 'console-reporting',
        message:
          'This editor page is not reporting its console. Its errors and warnings reach the ' +
          "page's own console and the editor's bottom-bar counter and STOP THERE, so an empty " +
          `${commandLine('console')} says nothing about this session. The host that booted this page must ` +
          'call `installEditorConsoleReporting()` (src/console-sync.ts), never ' +
          '`installEditorConsoleCapture()` alone.',
        loadId: clientId,
      });
    }, CONSOLE_REPORTER_GRACE_MS);
    timer.unref?.();
    consoleReporterWatch.set(clientId, timer);
  }

  function noteConsoleReporter(clientId: string): void {
    consoleReportingLoads.add(clientId);
    const timer = consoleReporterWatch.get(clientId);
    if (timer !== undefined) {
      clearTimeout(timer);
      consoleReporterWatch.delete(clientId);
    }
  }

  function controlClientId(payload: Record<string, unknown>): string | null {
    const candidate = payload['_clientId'] ?? payload['clientId'];
    return typeof candidate === 'string' ? candidate : null;
  }

  /** A missing envelope is a rolling-upgrade client and remains observable as
   *  unconfirmed. A PRESENT envelope is never guessed through: it either
   *  names the current connection generation exactly or is rejected. */
  function rejectStalePostedControl(payload: Record<string, unknown>): ControlOutcome | null {
    const raw = payload['_controlLifecycle'];
    if (raw === undefined) return null;
    const reported = parseEditorControlLifecycle(raw);
    if (reported === null) {
      return { status: 400, error: 'The control lifecycle envelope is malformed.' };
    }
    const clientId = controlClientId(payload);
    const expected = clientId === null ? undefined : controlLifecycleByClientId.get(clientId);
    if (expected === undefined) {
      return {
        status: 409,
        error:
          'That editor page generation is no longer connected; its control report was ignored.',
      };
    }
    const mismatch = editorControlLifecycleMismatch(expected, reported);
    if (mismatch !== null) {
      return {
        status: 409,
        error: `That control report belongs to an older ${mismatch}; it was ignored.`,
      };
    }
    const connection = currentConnectionByClientId.get(expected.clientId);
    if (connection !== undefined && !confirmedLifecycleConnections.has(connection)) {
      confirmedLifecycleConnections.add(connection);
      journalEvent({
        kind: 'control-lifecycle-confirmed',
        clientId8: short(expected.clientId),
        connectionGeneration8: short(expected.connectionGeneration),
      });
    }
    return null;
  }

  function socketLifecycleMatches(
    client: EditorEventClient,
    reported: EditorControlLifecycle | null,
    malformed: boolean,
  ): boolean {
    // Rolling-upgrade compatibility: the server still accepts a page that
    // predates the envelope, but status names it `unconfirmed`. Once an
    // envelope is present it is strict; malformed and stale are not aliases
    // for legacy.
    if (reported === null && !malformed) return true;
    const expected = controlLifecycleByConnection.get(client);
    const mismatch =
      expected && reported ? editorControlLifecycleMismatch(expected, reported) : null;
    if (malformed || !expected || mismatch !== null) {
      journalEvent({
        kind: 'control-lifecycle-rejected',
        clientId8: short(expected?.clientId),
        mismatch: mismatch ?? 'connectionGeneration',
      });
      return false;
    }
    if (!confirmedLifecycleConnections.has(client)) {
      confirmedLifecycleConnections.add(client);
      journalEvent({
        kind: 'control-lifecycle-confirmed',
        clientId8: short(expected.clientId),
        connectionGeneration8: short(expected.connectionGeneration),
      });
    }
    return true;
  }
  // Pending command results — keyed by requestId, resolved by browser POST
  const pendingCommands = new Map<
    string,
    {
      resolve: (result: SettledCommandResult) => void;
      timer: ReturnType<typeof setTimeout>;
      /** Armed only for long-budget types (`relayCommandAckDeadlineMs`), and
       *  cleared by the tab's receipt. See that function for why delivery and
       *  work need separate budgets. */
      ackTimer?: ReturnType<typeof setTimeout>;
      /** Re-delivery timer while the target TAB is present but has no channel. */
      holdTimer?: ReturnType<typeof setTimeout>;
      /** The tab this command is addressed to — it outlives the channel. */
      tabId?: string;
      /** The frame to (re)deliver, kept so a held command can be sent again
       *  on the tab's NEXT channel without the caller re-issuing it. */
      command?: Record<string, unknown>;
      /** The tab's `epochCount` when the command was accepted, so a refusal can
       *  say how many times it reloaded while waiting. */
      epochAtRelay?: number;
      /** One `command-held` line per command, not one per retry. */
      heldJournaled?: boolean;
      /** Set by the tab's receipt. A POSITIVE marker, not the absence of a
       *  timer: the final refusal awaits a main-thread echo, and a receipt
       *  arriving inside that window must win. */
      acknowledged?: boolean;
      /** Long-budget commands have separate delivery and work budgets. The
       *  relay starts a defensive timer immediately, then the first receipt
       *  restarts it so time spent queued behind a blocked main thread cannot
       *  consume the work budget before the page begins the work. */
      restartWorkTimerAfterReceipt?: () => void;
      /** Adopt a late contribution's declared budget without resetting elapsed work. */
      refreshWorkTimer?: () => void;
      controller?: EditorEventClient;
      controllerClientId?: string;
    }
  >();
  // Per-command relay budgets live in ONE pure, unit-tested table
  // (`server-utils.ts`'s `relayCommandTimeoutMs`) — including the reason each
  // entry exists. Testing it here would mean booting a server and standing
  // through a real expiry per case.

  /** Fail every in-flight command with one error — used when the last SSE
   *  client goes away: a reloaded page has no memory of the requestId it was
   *  supposed to answer, so waiting out the timer only delays the inevitable
   *  (and mislabels a reload as "editor did not respond"). */
  /** The ONE path that ends a pending command: drop both timers, forget it,
   *  answer its caller. Every settle below goes through here so a new timer
   *  can never be left armed on a command that already answered. */
  /**
   * A TAB RELOADED WHILE HOLDING A COMMAND. The page that took the command is
   * gone, and with it whatever it was doing and every session it held; the
   * new page-load has no memory of the requestId, so nothing will ever answer
   * it, and waiting out the work budget (30 min for `blender-execute`) only
   * mislabels a reload as "did not respond" half an hour late. Measured
   * 2026-09-17: a `blender-execute` receipted at 01:44:47, the page reloaded
   * at 01:44:49 (`client-disconnected ... commandsSettled: 0`, then
   * `tab-reloaded epochCount: 2`), and the caller heard nothing until its own
   * timeout. Only commands the OLD page-load had TAKEN are settled here (the
   * receipt says so); one still held for delivery goes to the new page as
   * the hold contract promises.
   */
  function settleCommandsOfReloadedTab(tabId: string, epochCount: number): void {
    for (const [id, pending] of [...pendingCommands]) {
      if (pending.tabId !== tabId) continue;
      if (pending.acknowledged !== true) continue;
      if ((pending.epochAtRelay ?? epochCount) >= epochCount) continue;
      const type =
        typeof pending.command?.['type'] === 'string' ? pending.command['type'] : 'command';
      settlePendingCommand(id, {
        ok: false,
        error:
          `The editor tab reloaded while \`${type}\` was running in it (page-load ` +
          `${pending.epochAtRelay ?? 0} → ${epochCount}). The page that held the command is gone, ` +
          'and with it any session it was working in; nothing will answer it. Start again.',
      });
    }
  }
  onTabReloaded(settleCommandsOfReloadedTab);

  /**
   * The lifecycle whose table holds this TAB — the participant is not always
   * in hand where the answer is needed (a command settles from a timer, a
   * socket close, or a POST), and the tabId always is.
   */
  function tabTableOwning(tabId: string): TabLifecycleController | null {
    if (hostTabLifecycle.tab(tabId) !== undefined) return hostTabLifecycle;
    for (const lifecycle of participantTabLifecycles.values()) {
      if (lifecycle?.tab(tabId) !== undefined) return lifecycle ?? null;
    }
    return null;
  }

  function settlePendingCommand(
    id: string,
    result: RelayedCommandResult,
    callerReceipt?: () => void,
  ): void {
    const pending = pendingCommands.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    if (pending.ackTimer) clearTimeout(pending.ackTimer);
    if (pending.holdTimer) clearTimeout(pending.holdTimer);
    pendingCommands.delete(id);
    journalEvent({
      kind: 'command-result',
      requestId8: short(id),
      ok: result.ok === true,
      ...(result.ok === true ? {} : { error: String(result.error ?? '') }),
    });
    // HOW THE PAGE IS DOING, filed against the tab. A command that expired
    // while the heartbeat stayed fresh is the one piece of evidence for `hung`
    // that no page-side measurement can supply (a wedged main thread samples
    // no census and sends no report), and an answered one is the proof that
    // clears it. `tab-presence.ts`'s `tabState` is the only reader.
    if (pending.tabId) {
      const table = tabTableOwning(pending.tabId);
      if (result.timedOut === true) table?.onCommandOutcome(pending.tabId, 'timed-out');
      else if (result.ok === true) table?.onCommandOutcome(pending.tabId, 'answered');
    }
    pending.resolve({ result, ...(callerReceipt ? { callerReceipt } : {}) });
  }

  /**
   * A PACKAGE'S verbs, as the page reported them after its contribution pass
   * (`/__editor/contributed-commands`, `tool-loader.ts`): the relay's wait
   * for a contributed verb comes from its own row, never from the generic
   * budget. Replaced whole on every report, so a reload's registry is the
   * one that stands.
   */
  const contributedCommandTimeouts = new Map<string, number>();
  function commandTimeoutMs(type: unknown): number {
    if (typeof type === 'string') {
      const contributed = contributedCommandTimeouts.get(type);
      if (contributed !== undefined) return contributed;
      // The listener can receive a package command before discovery reports
      // its row. Allow bounded discovery, then adopt its real work budget.
      if (!isRelayCommandType(type)) return RELAY_DELIVERY_MAX_WAIT_MS;
    }
    return relayCommandTimeoutMs(type);
  }
  function commandAckDeadlineMs(type: unknown): number | null {
    if (typeof type === 'string' && !isRelayCommandType(type))
      return commandTimeoutMs(type) > RELAY_DELIVERY_ACK_MS ? RELAY_DELIVERY_ACK_MS : null;
    return relayCommandAckDeadlineMs(type);
  }
  function handleContributedCommands(payload: Record<string, unknown>): ControlOutcome {
    const rows = payload['commands'];
    if (!Array.isArray(rows))
      return { status: 400, error: 'contributed-commands requires { commands: [] }.' };
    const next = new Map<string, number>();
    for (const row of rows) {
      const record = (row ?? {}) as Record<string, unknown>;
      const type = record['type'];
      const timeoutMs = record['timeoutMs'];
      if (typeof type !== 'string' || typeof timeoutMs !== 'number' || !(timeoutMs > 0))
        return {
          status: 400,
          error: 'each contributed command row needs a type and a positive timeoutMs.',
        };
      next.set(type, timeoutMs);
    }
    contributedCommandTimeouts.clear();
    for (const [type, timeoutMs] of next) contributedCommandTimeouts.set(type, timeoutMs);
    for (const pending of pendingCommands.values()) {
      const type = pending.command?.['type'];
      if (typeof type === 'string' && next.has(type)) pending.refreshWorkTimer?.();
    }
    return CONTROL_OK;
  }

  /**
   * A long budget is for the WORK, not for DELIVERY — so for the types that
   * have one, start a receipt window beside the command's own timer.
   *
   * The tab clears it the instant its command listener picks the event up
   * (`POST /__editor/command-received`). When the window expires instead,
   * the command event is still QUEUED in a tab that may merely be blocked —
   * a cold editor boot under machine load froze a real tab's main thread for
   * 60-100s on 2026-08-09 while five 8s windows false-failed plays that all
   * executed afterward. So the window RE-ARMS while the controller's socket
   * lives, up to the ceiling (clamped to the command's own budget), and only
   * then refuses, with wording that warns against blind resends. A tab that
   * actually goes away is settled sooner and more precisely by the
   * connection `close` handler's `failCommandsOwnedBy`. A no-op for ordinary
   * commands, which already fail faster than the first window.
   *
   * On the duplex control socket the final refusal stops GUESSING. Before it
   * settles, it reads the socket's last protocol pong (answered by the
   * browser's network stack, so it is fresh even through a blocked main
   * thread) and asks the page's INLINE echo responder to reply. Those two
   * facts distinguish "blocked, still queued" from "responsive but running
   * no command listener" — see `unacknowledgedCommandMessage`.
   */
  function armDeliveryReceiptWindow(requestId: string, type: unknown): void {
    if (commandAckDeadlineMs(type) === null) return;
    const windowMs = options.relayDeliveryAckMs ?? RELAY_DELIVERY_ACK_MS;
    // Never outlive the command's own timer. `stop` (30s),
    // `capture-asset-preview` (30s) and `bridge-screenshot` (15s) all have
    // budgets SHORTER than the default ceiling, so an unclamped wait would
    // hand those callers the generic "editor connected but did not respond"
    // — the exact uninformative message the receipt exists to replace — and
    // they would never see this path's guidance at all.
    const maxWaitMs = Math.min(
      options.relayDeliveryMaxWaitMs ?? RELAY_DELIVERY_MAX_WAIT_MS,
      commandTimeoutMs(type),
    );
    const armedAt = Date.now();
    const expire = (): void => {
      const pending = pendingCommands.get(requestId);
      if (!pending) return;
      // Stop re-arming once the controller's connection is gone. Normally the
      // `close` handler's `failCommandsOwnedBy` has already settled this
      // command by then; this is the belt for the case where it has not.
      const controller = pending.controller;
      const socketAlive = controller !== undefined && isClientAlive(controller);
      const waitedMs = Date.now() - armedAt;
      if (socketAlive && waitedMs + 1 < maxWaitMs) {
        pending.ackTimer = setTimeout(expire, Math.min(windowMs, maxWaitMs - waitedMs));
        return;
      }
      if (!socketAlive || controller === undefined) {
        // The narrow race the `close` handler leaves: the socket died between
        // this timer firing and `failCommandsOwnedBy` running. Answer with
        // that handler's OWN wording rather than the unacknowledged message,
        // whose "Its connection is still open" would be false here — and
        // which, unlike this one, no caller treats as retryable.
        settlePendingCommand(requestId, {
          ok: false,
          timedOut: true,
          error: CONTROLLER_DISCONNECTED_MESSAGE,
        });
        return;
      }
      void refuseUnacknowledged(requestId, type, controller, waitedMs);
    };
    const pending = pendingCommands.get(requestId);
    if (pending) pending.ackTimer = setTimeout(expire, windowMs);
  }

  /**
   * Settle an expired receipt window with MEASURED facts rather than a
   * guess. The echo probe is awaited, so the command stays pending for at
   * most one extra `CONTROL_ECHO_TIMEOUT_MS` — a window the old synchronous
   * expiry did not have, which is why the receipt sets an `acknowledged`
   * flag this re-reads afterwards instead of relying on its timer's absence.
   */
  async function refuseUnacknowledged(
    requestId: string,
    type: unknown,
    controller: EditorEventClient,
    waitedMs: number,
  ): Promise<void> {
    const socket = isEditorSocketClient(controller) ? controller : null;
    const echoStartedAt = Date.now();
    const mainThreadEcho = socket
      ? (await socket.echo(CONTROL_ECHO_TIMEOUT_MS))
        ? ('answered' as const)
        : ('unanswered' as const)
      : ('unavailable' as const);
    if (socket) {
      journalEvent({
        kind: 'echo-probe',
        clientId8: short(clientIdForResponse(controller)),
        answered: mainThreadEcho === 'answered',
        waitedMs: Date.now() - echoStartedAt,
      });
    }
    // The receipt may have landed while the echo was in flight. It wins:
    // the tab IS running the command, and the whole budget is now the work's.
    if (pendingCommands.get(requestId)?.acknowledged) return;
    if (!pendingCommands.has(requestId)) return;
    // Re-read after the probe: a socket that died meanwhile is the
    // disconnect case, and `failCommandsOwnedBy` may already have said so.
    if (!isClientAlive(controller)) {
      settlePendingCommand(requestId, {
        ok: false,
        timedOut: true,
        error: CONTROLLER_DISCONNECTED_MESSAGE,
      });
      return;
    }
    const pending = pendingCommands.get(requestId);
    const targetClientId = pending?.controllerClientId ?? null;
    const health = clientControlHealthFor(targetClientId);
    settlePendingCommand(requestId, {
      ok: false,
      timedOut: true,
      error: unacknowledgedCommandMessage({
        type,
        visibility: health ? (health.visible ? 'visible' : 'hidden') : null,
        focused: health ? health.focused : null,
        silentForMs: health ? Date.now() - health.updatedAt : null,
        waitedMs,
        lastPongAgeMs: socket ? socket.lastPongAgeMs() : null,
        mainThreadEcho,
      }),
    });
  }

  /**
   * The same sweep, minus the commands a tab has RECEIPTED — the rule
   * `failCommandsOwnedBy` already follows, for the same reason.
   *
   * `clientCount() === 0` is a fact about the TRANSPORT at one instant, not
   * proof the page is gone, and the two are not the same event. MEASURED
   * 2026-09-15: the hinged vise broke at call 20 of 33 when its socket closed
   * with code 1006 and the SAME client id reconnected 577 ms later — no
   * reload, no new document, 167 MB of heap against a 4192 MB limit. The page
   * was still running the command it had receipted three seconds earlier.
   *
   * An UNRECEIPTED command is a different animal and still fails instantly
   * here: it is queued in a page that has not picked it up, so a reload really
   * does leave nobody who remembers the requestId (the cold-cache Vite
   * re-optimization case this sweep was written for in the first place).
   *
   * A receipted one has a delivery path that does not need this socket:
   * `sendCommandResultControl` POSTs the result over HTTP the moment
   * `WebSocket.send` reports the socket gone. Waiting costs the command's own
   * work budget in the genuinely-dead case and adds no new timeout.
   */
  function failUnreceiptedPendingCommands(error: string): number {
    let settled = 0;
    for (const [id, pending] of [...pendingCommands]) {
      if (pending.acknowledged === true) continue;
      settled++;
      settlePendingCommand(id, { ok: false, timedOut: true, error });
    }
    return settled;
  }

  /**
   * Settle the commands this connection's death stranded, and ONLY those.
   *
   * A RECEIPTED command is the WORK's, not the delivery window's — the same
   * rule the echo probe above already follows ("the tab IS running the
   * command, and the whole budget is now the work's"). This function used to
   * break it and kill every pending command on the owning socket's `close`,
   * including ones the tab had acknowledged and was busy running.
   *
   * That threw away results the transport was already designed to deliver:
   * `sendCommandResultControl` falls back to POSTing the result over HTTP the
   * moment `WebSocket.send` reports the socket gone. MEASURED 2026-09-14 — a
   * replayed model broke at call 20 of 33 on a socket that closed with code
   * 1006 and RECONNECTED 508 ms later under the same client id, with the tab
   * reporting 160 MB of heap against a 4192 MB limit. Nothing had died; the
   * server destroyed the pending command before its answer could arrive.
   *
   * The cost, stated rather than hidden: if a tab really is gone, a receipted
   * command now waits out its own work budget instead of failing at once. That
   * is the right trade — a slow correct failure beats a fast wrong one — and
   * it adds no new timeout, because the budget already exists.
   *
   * Returns how many this death actually settled, which is the number the
   * `client-disconnected` journal line reports.
   */
  function failCommandsOwnedBy(controller: EditorEventClient): number {
    let settled = 0;
    for (const [id, pending] of [...pendingCommands]) {
      if (pending.controller !== controller) continue;
      if (pending.acknowledged === true) continue;
      settled++;
      settlePendingCommand(id, {
        ok: false,
        timedOut: true,
        error: CONTROLLER_DISCONNECTED_MESSAGE,
      });
    }
    return settled;
  }

  // ---- Tab -> server control messages, transport-independent ----
  //
  // Four facts a tab reports upstream: it picked a command up, the command
  // finished, its current state snapshot, and which surface it is showing.
  // A local tab sends them as frames on its control socket; the share tunnel
  // and any older page POST them. Both land HERE, so the two paths cannot
  // answer differently. Each returns the HTTP shape its POST route needs.

  const CONTROL_OK: ControlOutcome = { status: 200 };

  /** The receipt: cancel the delivery window, leave the work budget alone. */
  function handleCommandReceived(payload: Record<string, unknown>): ControlOutcome {
    const stale = rejectStalePostedControl(payload);
    if (stale) return stale;
    const requestId = payload['_requestId'];
    if (typeof requestId === 'string') {
      const pending = pendingCommands.get(requestId);
      if (pending) {
        journalEvent({ kind: 'command-receipt', requestId8: short(requestId) });
        const firstReceipt = pending.acknowledged !== true;
        pending.acknowledged = true;
        noteCommandReceipt(pending.controllerClientId);
        if (pending.ackTimer) {
          clearTimeout(pending.ackTimer);
          delete pending.ackTimer;
        }
        if (firstReceipt) pending.restartWorkTimerAfterReceipt?.();
      }
    }
    return CONTROL_OK;
  }

  /** The page reporting whether it is RUNNING a command listener at all —
   *  see `src/editor-api.ts`'s `reportCommandListener` for why presence
   *  cannot answer this. */
  function handleCommandListener(payload: Record<string, unknown>): ControlOutcome {
    const stale = rejectStalePostedControl(payload);
    if (stale) return stale;
    const clientId = typeof payload['_clientId'] === 'string' ? payload['_clientId'] : null;
    if (clientId === null) return { status: 400, error: 'command-listener requires a client id.' };
    if (typeof payload['attached'] !== 'boolean') {
      return { status: 400, error: 'command-listener requires { attached: boolean }.' };
    }
    noteCommandListenerAttached(clientId, payload['attached'] ? Date.now() : null);
    // The TABLE needs this too, and for a different question than the health
    // verdict above: a channel is opened by the inline bootstrap before any
    // module loads, so it is this report — and only this report — that proves
    // the DOCUMENT is running. Blessing reads it (tab-presence.ts's
    // `tabUnresponsive`, stage 2).
    if (payload['attached'] === true) {
      // …and for exactly that reason, THIS is where the boot clock stops. The
      // control channel is opened by `index.html`'s inline bootstrap before a
      // single module loads, so stopping at it would report a boot that had
      // barely started: measured on an imported Unity port, the channel
      // arrived at 26s while the server was still saturated at 135s. Written
      // at most once per process (`takeBoundTimings`).
      const boot = options.bootTimings?.() ?? null;
      if (boot) journalEvent({ kind: 'boot', ...boot });
      const tabId = tabIdForClient(clientId);
      const pageEpoch = controlLifecycleByClientId.get(clientId)?.pageGeneration;
      if (tabId !== null && pageEpoch !== undefined) {
        clientTabLifecycles.get(clientId)?.onTabListener(tabId, pageEpoch);
      }
      // This — and only this — is the moment a NEW page-load is proven to be
      // running the document, which is what makes it a valid re-test of every
      // condition an older load reported. It arms the ledger's settle window;
      // see `console-ledger.ts`'s clearing rule (a).
      consoleLedger.noteLoad(clientId);
      // A CHAT VIEW WITH NO AGENT OUTLIVES A PAGE LOAD, and rule (a) would sweep it: the
      // condition was raised before any page existed, so the first real load retires it and
      // `vgai console` goes quiet while the panel is still dead. Measured. So the session
      // re-observes it HERE, under this load's own id — which is exactly what the ledger's
      // own contract says a recurrence is ("the same fingerprint is observed again under the
      // new load id and its count keeps climbing").
      const agentRefusal = ctx.frontendRefusal();
      if (agentRefusal) {
        consoleLedger.observe({
          severity: 'warn',
          message: `The Chat view has no agent runtime: ${agentRefusal}`,
          source: 'session/frontend-handoff',
          loadId: clientId,
        });
      }
      // …and start the clock on this load's own console reporter. See
      // `armConsoleReporterWatch`.
      armConsoleReporterWatch(clientId);
    }
    return CONTROL_OK;
  }

  /**
   * WHICH STEP OF A PLAY BOOT THE PAGE IS INSIDE.
   *
   * Published by the page BEFORE the step runs (`src/play-boot-phase.ts`), so
   * a step that never returns is still named. Held here, not in the state
   * snapshot: the snapshot is the expensive derivation, and a page wedged in a
   * boot step is exactly the page that cannot produce one — which is how three
   * consecutive commands timed out at N=20000 against a session every reader
   * called healthy (`play-stall.ts`).
   *
   * ONE latch for the session, not one per tab, and that is the honest scope:
   * the relay routes every command to the single BLESSED tab, so the phase a
   * refusal needs is that tab's. A guest tab booting play of its own would
   * overwrite it — the report would then name a real step of a real boot that
   * is not the one this command is waiting on. `run` is carried so a reader can
   * see that, and the alternative (a per-tab table keyed on an id the POST
   * fallback self-reports) buys nothing until a second local tab can be a
   * command target.
   */
  function handlePlayPhase(payload: Record<string, unknown>): ControlOutcome {
    const stale = rejectStalePostedControl(payload);
    if (stale) return stale;
    const phase = payload['phase'];
    if (phase !== null && typeof phase !== 'string') {
      return { status: 400, error: 'play-phase requires { phase: string | null }.' };
    }
    const next = acceptPagePhase(ctx.livePlayPhase, {
      phase,
      ...(typeof payload['source'] === 'string' && Number.isSafeInteger(payload['sequence'])
        ? { source: payload['source'], sequence: payload['sequence'] as number } : {}),
      at: typeof payload['at'] === 'number' ? payload['at'] : 0,
      run: typeof payload['run'] === 'number' ? payload['run'] : 0,
      // The SERVER's clock, because it is the only one both parties share.
      receivedAt: Date.now(),
    });
    const changed = ctx.livePlayPhase?.phase !== next.phase;
    ctx.livePlayPhase = next;
    // The durable half: a reader of the journal sees what the page said it
    // was entering, whether or not anything timed out inside it — once per
    // change, since the heartbeat road may have carried the same word.
    if (changed) journalEvent({ kind: 'page-phase', phase: next.phase });
    return CONTROL_OK;
  }

  /**
   * Console errors and warnings, reported as OCCURRENCE DELTAS by the page's
   * `console-sync.ts`. The server owns the set from here on: the page's own
   * ring buffer dies with the tab, and this ledger does not.
   */
  function handleConsoleEntries(payload: Record<string, unknown>): ControlOutcome {
    const stale = rejectStalePostedControl(payload);
    if (stale) return stale;
    const clientId = typeof payload['_clientId'] === 'string' ? payload['_clientId'] : null;
    if (clientId === null) return { status: 400, error: 'console-entries requires a client id.' };
    const reported = payload['entries'];
    if (!Array.isArray(reported)) {
      return { status: 400, error: 'console-entries requires { entries: [...] }.' };
    }
    // Any report at all — including the EMPTY announcement a page sends when it
    // installs its reporter — is the proof this load's console reaches here.
    noteConsoleReporter(clientId);
    for (const raw of reported) {
      if (raw === null || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      const severity = entry['severity'];
      const message = entry['message'];
      if (severity !== 'error' && severity !== 'warn') continue;
      if (typeof message !== 'string' || message.trim() === '') continue;
      consoleLedger.observe({
        severity,
        message,
        source: typeof entry['source'] === 'string' ? entry['source'] : null,
        occurrences: typeof entry['occurrences'] === 'number' ? entry['occurrences'] : 1,
        loadId: clientId,
      });
    }
    return CONTROL_OK;
  }

  /**
   * Clearing rule (c) of the unresolved-console ledger: the code that RAISED a
   * condition reporting that it is gone (`console-ledger.ts` documents why the
   * page-load rule cannot cover this — a play remount is not a page load, so
   * `[play-mode] Restart required` outlived the very verb named to fix it).
   *
   * Deliberately no client-id fence: unlike `console-entries`, this claims
   * nothing about WHO saw what — it names conditions by their own text, and the
   * ledger refuses to retire an acked one.
   */
  function handleConsoleResolved(payload: Record<string, unknown>): ControlOutcome {
    const stale = rejectStalePostedControl(payload);
    if (stale) return stale;
    const reported = payload['conditions'];
    if (!Array.isArray(reported)) {
      return { status: 400, error: 'console-resolved requires { conditions: [...] }.' };
    }
    const by = typeof payload['by'] === 'string' && payload['by'] ? payload['by'] : 'editor';
    const conditions: { severity: 'error' | 'warn'; message: string }[] = [];
    for (const raw of reported) {
      if (raw === null || typeof raw !== 'object') continue;
      const condition = raw as Record<string, unknown>;
      const severity = condition['severity'];
      const message = condition['message'];
      if (severity !== 'error' && severity !== 'warn') continue;
      if (typeof message !== 'string' || message.trim() === '') continue;
      conditions.push({ severity, message });
    }
    consoleLedger.resolve(conditions, by);
    return CONTROL_OK;
  }

  /**
   * A PAGE ERROR, captured by `index.html`'s inline bootstrap.
   *
   * The doctrine gap this closes: every other door onto a tab's errors runs
   * INSIDE the module graph (`editor-console.ts`'s capture, read back by
   * `command-listener.ts`'s `collectPageErrors`), so the one failure that most
   * needs explaining — a boot that dies before the listener attaches — was the
   * one the product could not describe. It could say `commandListener: not
   * attached` and never why. These errors arrive on the control connection the
   * bootstrap already holds, are journaled, and are read back through
   * `/__editor/state` (a plain GET), so `vgai status` answers with no listener
   * and no tab cooperation beyond the socket.
   */
  function handlePageError(payload: Record<string, unknown>): ControlOutcome {
    const stale = rejectStalePostedControl(payload);
    if (stale) return stale;
    const clientId = typeof payload['_clientId'] === 'string' ? payload['_clientId'] : null;
    const message = typeof payload['message'] === 'string' ? payload['message'].trim() : '';
    if (clientId === null) return { status: 400, error: 'page-error requires a client id.' };
    if (message === '') return { status: 400, error: 'page-error requires { message: string }.' };
    const capped = message.slice(0, PAGE_ERROR_MAX_CHARS);
    if (!pageErrorsByClient.has(clientId) && pageErrorsByClient.size >= PAGE_ERROR_CLIENTS_MAX) {
      return { status: 400, error: 'page-error: too many reporting clients.' };
    }
    const existing = pageErrorsByClient.get(clientId) ?? [];
    // Bounded, and the FIRST errors are the ones kept: a boot failure cascades
    // (one bad module, then every consumer of it), and the first line is the
    // cause while the tail is the echo.
    if (existing.length < PAGE_ERRORS_PER_CLIENT && !existing.includes(capped)) {
      pageErrorsByClient.set(clientId, [...existing, capped]);
      journalEvent({
        kind: 'page-error',
        tabId8: short(tabIdForClient(clientId)),
        message: capped,
      });
    }
    return CONTROL_OK;
  }

  function handleCommandResult(payload: Record<string, unknown>): ControlOutcome {
    const stale = rejectStalePostedControl(payload);
    if (stale) return stale;
    const body = payload as {
      _requestId: string;
      ok?: unknown;
      error?: string;
      data?: Record<string, unknown>;
      _clientId?: string;
      _awaitCallerReceipt?: boolean;
    };
    const pending = pendingCommands.get(body._requestId);
    if (pending) {
      // Only when the reporter NAMES itself. Over the socket the server fills
      // `_clientId` in from the connection, so a tab there cannot claim to be
      // another one; over the POST route a client that declares nothing (the
      // share tunnel's bridge, a curl, a test harness) has always been
      // trusted, and now that every connection carries a server-minted id it
      // would otherwise be rejected for not knowing a name it never chose.
      if (
        pending.controllerClientId &&
        typeof body._clientId === 'string' &&
        pending.controllerClientId !== body._clientId
      ) {
        return { status: 403, error: 'Command result came from a different editor tab.' };
      }
      const receiptClientId = pending.controllerClientId;
      const callerReceipt =
        body._awaitCallerReceipt === true && receiptClientId
          ? () => {
              sendToClientHandle(receiptClientId, COMMAND_RESULT_RECEIPT_EVENT, body._requestId);
            }
          : undefined;
      // THE PARSE BOUNDARY for the relay's answer shape. `CommandResult.ok` is
      // required because the tab always writes it — but this payload arrives
      // over HTTP/socket from off the wire, so the guarantee is CHECKED here
      // rather than assumed by the type (and rather than making `ok` optional
      // for every reader downstream, which is how the two declarations of this
      // shape drifted apart in the first place). The relay's own envelope keys
      // (`_requestId`, `_clientId`, `_awaitCallerReceipt`) are addressing, not
      // answer, and stop here.
      settlePendingCommand(
        body._requestId,
        {
          ok: body.ok === true,
          ...(body.error !== undefined ? { error: body.error } : {}),
          ...(body.data !== undefined ? { data: body.data } : {}),
        },
        callerReceipt,
      );
    }
    return CONTROL_OK;
  }

  function handleEditorState(reported: Record<string, unknown>): ControlOutcome {
    const stale = rejectStalePostedControl(reported);
    if (stale) return stale;
    const clientId = typeof reported['_clientId'] === 'string' ? reported['_clientId'] : null;
    const {
      _clientId: _ignoredClientId,
      _controlLifecycle: _ignoredControlLifecycle,
      _statePatch: statePatch,
      ...state
    } = reported;
    const previous = clientId ? editorStatesByClient.get(clientId)?.state : ctx.editorState;
    if (statePatch === true && !previous) {
      return {
        status: 409,
        error: 'Editor state patch arrived before this tab reported a full state snapshot.',
      };
    }
    const nextState = statePatch === true ? { ...previous, ...state } : state;
    const updatedAt = Date.now();
    ctx.editorState = nextState;
    ctx.editorStateUpdatedAt = updatedAt;
    if (clientId) {
      editorStatesByClient.set(clientId, { state: nextState, updatedAt });
      const pageErrors = nextState['pageErrors'];
      const presence = nextState['presence'];
      const presenceRecord =
        presence && typeof presence === 'object' ? (presence as Record<string, unknown>) : null;
      updateClientControlHealth(clientId, {
        errorState: Array.isArray(pageErrors)
          ? pageErrors.length === 0
            ? 'healthy'
            : 'errored'
          : 'unknown',
        visible: presenceRecord?.['visibility'] === 'visible',
        focused: presenceRecord?.['focused'] === true,
        updatedAt,
      });
    }
    return CONTROL_OK;
  }

  function handleTabRoute(
    body: Record<string, unknown>,
    trusted: ReturnType<typeof trustedShareIdentity>,
  ): ControlOutcome {
    const stale = rejectStalePostedControl(body);
    if (stale) return stale;
    const route = body['route'];
    const claimedParticipantId = body['participantId'];
    if (
      trusted &&
      typeof claimedParticipantId === 'string' &&
      trusted.participantId !== claimedParticipantId
    ) {
      return { status: 403, error: 'A shared tab can only route its own participant.' };
    }
    const clientId = body['clientId'];
    if (
      typeof clientId !== 'string' ||
      (route !== 'project' && route !== 'no-project' && route !== 'unknown')
    ) {
      return { status: 400, error: 'tab/route requires { clientId: string, route }' };
    }
    const participantId = trusted?.participantId ?? claimedParticipantId;
    const lifecycle =
      clientTabLifecycles.get(clientId) ??
      (typeof participantId === 'string'
        ? participantTabLifecycles.get(participantId)
        : undefined) ??
      (trusted ? undefined : hostTabLifecycle);
    const tabId = tabIdForClient(clientId);
    if (tabId !== null) lifecycle?.onTabRoute(tabId, route);
    return CONTROL_OK;
  }

  // ---- The event stream, shared by BOTH transports ----
  //
  // `/__editor/events` answers a plain GET as SSE and a WebSocket upgrade as
  // a duplex control socket. Everything below the transport — share identity,
  // collaboration join/resume, the client pool, the tab bijection, the
  // disconnect settlement — is ONE implementation, so the two transports can
  // never drift into two behaviors.

  interface EventStreamIdentity {
    readonly participantId: string | undefined;
    readonly clientId: string | undefined;
    /** The page's persistent TAB identity (sessionStorage; survives reloads). */
    readonly tabId: string | undefined;
    /** The page-load epoch shared with the heartbeat worker. */
    readonly pageGeneration: string | undefined;
    readonly displayName: string | undefined;
    /**
     * WHAT KIND OF PAGE this connection belongs to ({@link TabSurface}).
     *
     * Two readings, and the connection is where both are available: the page
     * DECLARES it (the tab bootstrap passes through what the frame wrote on
     * the script's url), and the server OBSERVES it (a control connection
     * whose `Origin` is the desktop frame's can only be a VS Code window).
     * The observation is what covers a frame that never ran the bootstrap at
     * all — the case that produced "SOMETHING IS OFF" with nothing to name.
     */
    readonly surface: TabSurface;
    readonly trusted: ReturnType<typeof trustedShareIdentity>;
    readonly lastEventId: string | undefined;
  }

  /** Identity check that must answer BEFORE either transport writes a byte. */
  function resolveEventStreamIdentity(source: {
    query: (name: string) => string | undefined;
    header: (name: string) => string | undefined;
    trusted: ReturnType<typeof trustedShareIdentity>;
  }): EventStreamIdentity | { error: string } {
    const claimedParticipantId = source.query('participantId');
    const trusted = source.trusted;
    if (trusted && claimedParticipantId && trusted.participantId !== claimedParticipantId) {
      return { error: 'The authenticated share participant does not match this event stream.' };
    }
    return {
      participantId: trusted?.participantId ?? claimedParticipantId,
      clientId: source.query('clientId'),
      tabId: source.query('tabId'),
      pageGeneration: source.query('pageGeneration'),
      displayName: source.query('displayName'),
      surface:
        source.query('surface') === 'vscode' || source.header('origin') === DESKTOP_FRAME_ORIGIN
          ? 'vscode'
          : 'editor',
      trusted,
      lastEventId: source.header('last-event-id'),
    };
  }

  /** Pool the connection, replay collaboration, arm the bijection. Returns the
   *  ONE teardown both transports run when their connection ends. */
  function openEventStream(
    identity: EventStreamIdentity,
    client: EditorEventClient,
    send: (event: string, data: string, id?: string) => void,
  ): (close?: { code: number; reason: string }) => void {
    const { participantId, trusted } = identity;
    const transport = isEditorSocketClient(client) ? ('ws' as const) : ('sse' as const);
    // EVERY connection belongs to a tab, and every connection is identified.
    //
    // A page that declares no `tabId` — the share tunnel's bridged stream, a
    // curl, a test client, anything older than the heartbeat — gets one
    // derived from its connection, and a connection that declares no
    // `clientId` gets a server-minted one. There is deliberately no
    // second class of citizen here: an anonymous connection used to be
    // invisible to the tab bijection and selectable by the relay only
    // through a special "legacy" fallback, which is two rules for one
    // question. Now `tabPresent`'s union rule covers it — present while it
    // holds a channel, because it can never beat.
    const clientId = identity.clientId ?? `conn-${randomUUID()}`;
    const tabId = identity.tabId ?? `tab-of-${clientId}`;
    const pageGeneration = identity.pageGeneration ?? `page-of-${clientId}`;
    const previousConnection = currentConnectionByClientId.get(clientId);
    if (previousConnection !== undefined && previousConnection !== client) {
      // A page reconnect is a successor generation, never a second controller.
      // End the predecessor before any command can select it from the pool.
      closeClient(previousConnection, 4000, 'superseded by a newer control connection');
    }
    const controlLifecycle: EditorControlLifecycle = {
      version: EDITOR_CONTROL_LIFECYCLE_VERSION,
      serverGeneration: processSessionId(),
      connectionGeneration: randomUUID(),
      clientId,
      tabId,
      pageGeneration,
    };
    controlLifecycleByConnection.set(client, controlLifecycle);
    controlLifecycleByClientId.set(clientId, controlLifecycle);
    currentConnectionByClientId.set(clientId, client);
    clientTabIds.set(clientId, tabId);
    if (participantId) {
      const collaboration = currentCollaboration();
      if (collaboration) {
        const leaveTimer = participantLeaveTimers.get(participantId);
        if (leaveTimer) {
          clearTimeout(leaveTimer);
          participantLeaveTimers.delete(participantId);
        }
        const localHost =
          trusted === null && participantId === ctx.localShareHost?.participantId
            ? ctx.localShareHost
            : null;
        if (
          !collaboration
            .snapshot()
            .participants.some((item) => item.participantId === participantId)
        ) {
          collaboration.join({
            participantId,
            account: trusted?.account ?? localHost?.account ?? null,
            displayName:
              trusted?.account.name ??
              trusted?.account.email ??
              localHost?.account.name ??
              localHost?.account.email ??
              identity.displayName?.slice(0, 80) ??
              'Editor participant',
            kind: 'human',
            role: localHost ? 'maintainer' : defaultCollaborationRole(participantId, trusted?.role),
            ephemeralRole: trusted !== null,
            location: currentCollaborationLocation(),
          });
        }
        if (!trusted) localParticipantIds.add(participantId);
        participantConnections.set(
          participantId,
          (participantConnections.get(participantId) ?? 0) + 1,
        );
        const lastEventId = Number(identity.lastEventId);
        const resumed =
          Number.isSafeInteger(lastEventId) && lastEventId >= 0
            ? collaboration.resume(lastEventId)
            : null;
        if (!resumed || resumed.reset) {
          send('collaboration-snapshot', JSON.stringify(collaboration.snapshot()));
        } else {
          for (const event of resumed.events) {
            send(`collaboration-${event.channel}`, JSON.stringify(event), String(event.sequence));
          }
          // The replay above is a gap BY CONSTRUCTION: presence and
          // participant patches bump the sequence without joining the durable
          // event log, so a resumed client that only replayed events would sit
          // on stale cursors and stale participant rows for the rest of the
          // connection. The snapshot is a whole-state replacement on the client
          // (`collaboration-client.ts` publish()), so sending it AFTER the
          // replay repairs the gap without disturbing event ordering.
          send('collaboration-snapshot', JSON.stringify(collaboration.snapshot()));
        }
      }
    }
    addClient(client, clientId, participantId);
    // Every transport gets the lifecycle. `control-duplex` remains the
    // separate native-socket capability grant; a tunnelled/SSE page uses this
    // same generation on its POST fallback.
    send('control-lifecycle', JSON.stringify(controlLifecycle));
    journalEvent({
      kind: 'client-connected',
      clientId8: short(clientId),
      transport,
      participant: participantId ? short(participantId) : null,
    });
    // Tab bijection: a connection is a HINT that its tab has a channel. It
    // never blesses anything by itself — the reconciler does, from the table.
    const clientTabLifecycle = participantId
      ? tabLifecycleForParticipant(participantId, trusted === null)
      : hostTabLifecycle;
    clientTabLifecycles.set(clientId, clientTabLifecycle);
    clientTabLifecycle.onTabChannelOpen(tabId, identity.surface);
    return (close?: { code: number; reason: string }) => {
      const ownsCurrentGeneration = currentConnectionByClientId.get(clientId) === client;
      removeClient(client);
      controlLifecycleByConnection.delete(client);
      confirmedLifecycleConnections.delete(client);
      if (participantId) {
        const remaining = Math.max(0, (participantConnections.get(participantId) ?? 1) - 1);
        if (remaining === 0) {
          participantConnections.delete(participantId);
          const timer = setTimeout(() => {
            participantLeaveTimers.delete(participantId);
            if ((participantConnections.get(participantId) ?? 0) > 0) return;
            if (!trusted) localParticipantIds.delete(participantId);
            currentCollaboration()?.leave(participantId);
          }, 5_000);
          timer.unref?.();
          participantLeaveTimers.set(participantId, timer);
        } else {
          participantConnections.set(participantId, remaining);
        }
      }
      if (ownsCurrentGeneration) {
        currentConnectionByClientId.delete(clientId);
        controlLifecycleByClientId.delete(clientId);
        clientTabIds.delete(clientId);
        pageErrorsByClient.delete(clientId);
      }
      // A socket that ended with NO CLOSE FRAME (1006) is what a killed
      // renderer process leaves behind — an ordinary tab close sends one. Read
      // the tab's resource census BEFORE the reconcile below can sweep the
      // record, so the death line has something to say (2026-08-10: a game
      // tab's renderer died repeatedly and the record was `1006` and nothing).
      const deathProfile =
        close?.code === ABNORMAL_SOCKET_CLOSE
          ? (clientTabLifecycles.get(clientId)?.censusOf(tabId) ?? null)
          : null;
      // Only when the tab has NO channel left: a reload's new socket often
      // opens before the old one's close lands, and calling this on the
      // dying one would report a channel-down the tab never had.
      if (clientIdsForTab(tabId).length === 0) {
        clientTabLifecycle.onTabChannelClose(tabId);
      }
      if (ownsCurrentGeneration) clientTabLifecycles.delete(clientId);
      const commandsSettled = failCommandsOwnedBy(client);
      journalEvent({
        kind: 'client-disconnected',
        clientId8: short(clientId),
        transport,
        code: close?.code ?? null,
        reason: close?.reason ? close.reason.slice(0, 120) : null,
        commandsSettled,
      });
      if (close?.code === ABNORMAL_SOCKET_CLOSE) {
        journalEvent({
          kind: 'tab-death-profile',
          tabId8: short(tabId),
          code: close.code,
          censusAgeMs: deathProfile?.ageMs ?? null,
          census: deathProfile?.census ?? null,
        });
      }
      // Last tab gone with commands still in flight: a command nobody has
      // picked up cannot be answered (a reload mints a fresh page with no
      // memory of the requestId), so fail THOSE now with the real reason
      // instead of letting the timer expire into a misleading "editor
      // connected but did not respond". The classic trigger is a mid-command
      // full page reload — e.g. Vite discovering/re-optimizing deps on a first
      // play (dogfooded 2026-07-12: every first `vgai play` on a cold cache
      // burned the full 120s window).
      //
      // A RECEIPTED command survives this: see
      // `failUnreceiptedPendingCommands` for the socket blip that is not a
      // death, and the measurement behind it.
      if (clientCount() === 0 && pendingCommands.size > 0) {
        const settled = failUnreceiptedPendingCommands(
          'Editor page disconnected while the command was pending — usually a mid-command page ' +
            'reload (e.g. Vite dep re-optimization on a cold cache) or a closed tab. ' +
            'Reload the editor tab and retry the command.',
        );
        if (settled > 0) {
          journalEvent({ kind: 'command-swept-on-last-tab-gone', settled });
        }
      }
    };
  }

  router.get('/__editor/events', (req: Request, res: Response) => {
    const identity = resolveEventStreamIdentity({
      query: (name) => (typeof req.query[name] === 'string' ? req.query[name] : undefined),
      header: (name) => req.header(name),
      trusted: trustedShareIdentity(req),
    });
    if ('error' in identity) {
      res.status(403).end(identity.error);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(':ok\n\n');
    const dispose = openEventStream(identity, res, (event, data, id) => {
      res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${data}\n\n`);
    });
    req.on('close', dispose);
  });

  // ---- Duplex control socket (same path, same vocabulary) ----
  //
  // Upstream control frames land on the SAME handlers the POST routes call,
  // so the two transports cannot answer differently. The POST routes stay:
  // the share tunnel bridges through the SSE form and keeps POSTing.
  const controlSocket: EditorControlSocketServer = createEditorControlSocket({
    // The heartbeat rides this same upgrade listener — see `RawSocketRoute`.
    extraRoutes: [heartbeat],
    authorize: (request, url) => {
      // S3, and it MATTERS more here than on the GET: a WebSocket handshake
      // is not subject to CORS, so without this check any page on the web
      // could open this socket against a developer's loopback editor and
      // both read the event stream and push control frames. `EventSource`
      // on the same path is refused by the browser's own CORS, which is why
      // the GET form does not need it. Same predicate as the mutating-route
      // gate above, including its VGAI_EDITOR_HOST escape.
      const host = process.env['VGAI_EDITOR_HOST'];
      if (!isAllowedEditorOrigin(headerValue(request, 'origin'), host ? [host] : [])) {
        return 'Cross-origin request rejected.';
      }
      const shareRequest = {
        method: 'GET',
        originalUrl: request.url ?? '/',
        header: (name: string) => headerValue(request, name),
      };
      let trusted: ReturnType<typeof trustedShareIdentity>;
      try {
        trusted = trustedShareIdentity(shareRequest);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      const claimed = url.searchParams.get('participantId');
      if (trusted && claimed && trusted.participantId !== claimed) {
        return 'The authenticated share participant does not match this event stream.';
      }
      return null;
    },
    open: (connection) => {
      const identity = resolveEventStreamIdentity({
        query: (name) => connection.url.searchParams.get(name) ?? undefined,
        header: (name) => headerValue(connection.request, name),
        trusted: trustedShareIdentity({
          method: 'GET',
          originalUrl: connection.request.url ?? '/',
          header: (name: string) => headerValue(connection.request, name),
        }),
      });
      if ('error' in identity) {
        connection.close(1008, identity.error);
        return () => {};
      }
      return openEventStream(identity, connection.client, connection.send);
    },
    duplexGranted: (connection) => {
      journalEvent({
        kind: 'duplex-granted',
        clientId8: short(clientIdForResponse(connection.client)),
      });
    },
    message: (type, payload, connection, lifecycle, lifecycleMalformed) => {
      if (!socketLifecycleMatches(connection.client, lifecycle, lifecycleMalformed)) {
        connection.close(1008, 'stale control lifecycle');
        return;
      }
      const clientId = clientIdForResponse(connection.client) ?? undefined;
      switch (type) {
        case 'command-received':
          handleCommandReceived({ ...payload, _clientId: clientId });
          return;
        case 'command-listener':
          // Same reason as `command-result` below: the socket KNOWS which page
          // spoke, so a tab cannot report a listener on another one's behalf.
          handleCommandListener({ ...payload, _clientId: clientId });
          return;
        case 'page-error':
          handlePageError({ ...payload, _clientId: clientId });
          return;
        case 'console-entries':
          // Same reason as `command-listener`: the socket KNOWS which page-load
          // spoke, and the ledger's clearing rule is fenced on that id.
          handleConsoleEntries({ ...payload, _clientId: clientId });
          return;
        case 'console-resolved':
          handleConsoleResolved(payload);
          return;
        case 'play-phase':
          handlePlayPhase({ ...payload, _clientId: clientId });
          return;
        case 'command-result':
          // The socket KNOWS which tab spoke, so the tab cannot claim to be
          // another one — stronger than the POST route's self-reported id.
          handleCommandResult({ ...payload, _clientId: clientId });
          return;
        case 'state':
          handleEditorState({ ...payload, _clientId: clientId });
          return;
        case 'tab-route':
          handleTabRoute(
            { ...payload, clientId: clientId ?? payload['clientId'] },
            trustedShareIdentity({
              method: 'POST',
              originalUrl: '/__editor/tab/route',
              header: (name: string) => headerValue(connection.request, name),
            }),
          );
          return;
        default:
          // An unknown control type is a client/server version skew, never a
          // silent partial read.
          console.warn(`[vgai-editor] ignoring unknown control frame "${type}"`);
      }
    },
  });
  router.attachControlSocket = (server: HttpServer) => controlSocket.attach(server);
  // ---- Editor command relay ----
  //
  // COMMANDS ARE ADDRESSED TO A TAB, NOT TO A SOCKET. A socket is a
  // per-page-load thing that comes and goes under an ordinary reload; the tab
  // is what the caller means. So the relay asks the TABLE which tab is
  // blessed, then looks up whatever channel that tab currently holds — and if
  // it holds none this instant, it WAITS inside the command's own budget
  // instead of answering "disconnected" about a tab that is provably here.
  //
  // That inversion is the fix for the 2026-08-09 defect: the old path asked
  // `sendToController`, which refused to select any tab that had not yet
  // POSTed an application-level state report, and then reported the refusal
  // as a disconnect. Reproduced headlessly at HEAD: a live, duplex-granted,
  // blessed tab, `editorsConnected: 1`, and `command-relayed clientId8:null`
  // followed 1ms later by "Editor disconnected before the command could be
  // delivered."

  /** How often a held command re-attempts delivery to its tab. */
  const COMMAND_HOLD_RETRY_MS = 200;

  const openGameplayRecordings = new Map<string, OpenGameplayRecording>();
  const MAX_RECORDING_CHUNK_BYTES = 8 * 1024 * 1024;

  function openGameplayRecording(id: unknown): OpenGameplayRecording | null {
    return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)
      ? (openGameplayRecordings.get(id) ?? null)
      : null;
  }

  /**
   * Add the standing `commandListener` verdict to each tab row.
   *
   * A tab can hold more than one page-load at once (the overlap across a
   * reload), so the row takes the BEST of them: `'ready'` beats `'silent
   * since'` beats `'not attached'`. That is not optimism — the field's claim is
   * "can this tab take a command", and one page-load that can take one settles
   * it. Without this rule, every ordinary reload would flash `not attached`
   * from the incoming page while the outgoing one was still listening.
   *
   * A row whose tab is not in `present()` is left UNDECORATED rather than given
   * a default: an absent tab is something this cannot measure.
   */
  function decorateWithCommandListener(
    rows: readonly TabPresenceReport[],
    table: TabLifecycleController | null,
    now: number,
  ): Array<
    TabPresenceReport & {
      commandListener?: CommandListenerHealth;
      pageErrors?: string[];
      controlLifecycles?: PresentedControlLifecycle[];
    }
  > {
    const rank: Record<string, number> = { 'not attached': 0, ready: 2 };
    const presentTabs = table?.present() ?? [];
    const fullTabIds = new Map(presentTabs.map((tab) => [short(tab.tabId), tab.tabId]));
    const pageOwners = new Map<string, Set<string>>();
    for (const tab of presentTabs) {
      for (const epoch of tab.epochs) {
        const owners = pageOwners.get(epoch.epoch) ?? new Set<string>();
        owners.add(tab.tabId);
        pageOwners.set(epoch.epoch, owners);
      }
    }
    return rows.map((row) => {
      const tabId = fullTabIds.get(row.tabId8);
      if (tabId === undefined) return row;
      let best: CommandListenerHealth = 'not attached';
      const pageErrors: string[] = [];
      const controlLifecycles: PresentedControlLifecycle[] = [];
      for (const clientId of clientIdsForTab(tabId)) {
        const verdict = commandListenerHealth(commandListenerFactsFor(clientId), now);
        if ((rank[verdict] ?? 1) > (rank[best] ?? 1)) best = verdict;
        // Every live page-load of this tab: across a reload's overlap both are
        // real, and the outgoing page's error is often the reason the incoming
        // one exists.
        for (const message of pageErrorsByClient.get(clientId) ?? []) {
          if (!pageErrors.includes(message)) pageErrors.push(message);
        }
        const lifecycle = controlLifecycleByClientId.get(clientId);
        if (lifecycle) {
          const connection = currentConnectionByClientId.get(clientId);
          const owners = pageOwners.get(lifecycle.pageGeneration) ?? new Set<string>();
          const confirmed =
            connection !== undefined && confirmedLifecycleConnections.has(connection);
          const status: PresentedControlLifecycle['status'] = !confirmed
            ? 'unconfirmed'
            : owners.size > 1 || (owners.size === 1 && !owners.has(tabId))
              ? 'mismatch'
              : owners.has(tabId)
                ? 'aligned'
                : 'awaiting-heartbeat';
          controlLifecycles.push({
            status,
            serverGeneration8: short(lifecycle.serverGeneration),
            connectionGeneration8: short(lifecycle.connectionGeneration),
            pageGeneration8: short(lifecycle.pageGeneration),
            clientId8: short(lifecycle.clientId),
          });
        }
      }
      // `[]` is an honest answer here — the capture is installed by the inline
      // bootstrap, so a tab this function can see has one, and "none reported"
      // is a measurement. A tab the table cannot see is left UNDECORATED by
      // the early return above, never given a default.
      return { ...row, commandListener: best, pageErrors, controlLifecycles };
    });
  }

  /** The lifecycle whose TABLE answers for this command's participant. */
  function tabTableFor(participantId: string | null): TabLifecycleController | null {
    if (participantId === '__vgai_missing_local_host__') return null;
    if (participantId !== null && participantId !== ctx.hostParticipantId) {
      return participantTabLifecycles.get(participantId) ?? null;
    }
    return hostTabLifecycle;
  }

  /**
   * The tab's page-loads in the order a command should try them: the page
   * whose control generation the tab's own heartbeat confirms first
   * (`aligned`), then any page still beating, then the rest. A same-tab
   * navigation leaves the OUTGOING page's connection registered for a while
   * beside the incoming one, and delivering to whichever the map listed
   * first sent every command to a page that was gone — measured 2026-09-05:
   * a tab with two lifecycles, the stale one first, timed out every relay
   * for minutes while its status said "commandListener ready".
   */
  function clientsInDeliveryOrder(tabId: string, table: TabLifecycleController | null): string[] {
    const tab = table?.tab(tabId);
    const liveEpochs = new Set((tab?.epochs ?? []).map((epoch) => epoch.epoch));
    const rank = (clientId: string): number => {
      const lifecycle = controlLifecycleByClientId.get(clientId);
      if (lifecycle === undefined) return 2;
      return liveEpochs.has(lifecycle.pageGeneration) ? 0 : 1;
    };
    return [...clientIdsForTab(tabId)].sort((a, b) => rank(a) - rank(b));
  }

  /**
   * Deliver to the tab's current channel, or HOLD.
   *
   * Holding is bounded by the command's own timer — nothing new is invented
   * here, the wait simply happens on the server instead of being converted
   * into a false refusal the caller then retries five times.
   */
  function deliverToTab(requestId: string, type: unknown, participantId: string | null): void {
    const pending = pendingCommands.get(requestId);
    if (pending === undefined) return;
    const tabId = pending.tabId;
    if (tabId === undefined) return;
    const table = tabTableFor(participantId);

    for (const clientId of clientsInDeliveryOrder(tabId, table)) {
      const client = sendToClientHandle(clientId, 'editor-command', pending.command);
      if (client === null) continue;
      pending.controller = client;
      pending.controllerClientId = clientId;
      noteCommandRelay(clientId);
      journalEvent({
        kind: 'command-relayed',
        command: String(type ?? 'unknown'),
        requestId8: short(requestId),
        tabId8: short(tabId),
        clientId8: short(clientId),
      });
      armDeliveryReceiptWindow(requestId, type);
      return;
    }

    // No channel right now. Is the TAB still here? The reconciler removes a
    // tab from the table only once it is absent past its grace — so a missing
    // record is the one honest occasion for `CONTROLLER_DISCONNECTED_MESSAGE`,
    // and the CLI's retry contract keeps meaning what it says.
    if (table !== null && table.tab(tabId) === undefined) {
      settlePendingCommand(requestId, {
        ok: false,
        timedOut: true,
        error: CONTROLLER_DISCONNECTED_MESSAGE,
      });
      return;
    }
    if (!pending.heldJournaled) {
      pending.heldJournaled = true;
      journalEvent({
        kind: 'command-held',
        requestId8: short(requestId),
        tabId8: short(tabId),
        reason: 'no-channel',
      });
    }
    pending.holdTimer = setTimeout(
      () => deliverToTab(requestId, type, participantId),
      COMMAND_HOLD_RETRY_MS,
    );
    pending.holdTimer.unref?.();
  }

  function relayCommand(
    body: Record<string, unknown>,
    requestedParticipantId?: string,
  ): Promise<SettledCommandResult> {
    const participantId =
      requestedParticipantId ??
      ctx.hostParticipantId ??
      (participantConnections.size > 0 ? '__vgai_missing_local_host__' : null);
    const table = tabTableFor(participantId);
    const targetTabId = table?.blessedTabId() ?? null;
    // Fail fast when the TABLE says no tab is present — and say so in table
    // facts. A caller can act on "no tab has been present for 9s" plus the URL
    // to open; it could never act on "disconnected" about a tab that was there.
    if (targetTabId === null) {
      // A tab can be PRESENT and still unblessable: its worker beats, its
      // page is dead. Refusing that with "no tab is present" would send the
      // reader looking for a window that is sitting right in front of them.
      const zombie = table?.unresponsive()[0];
      if (zombie !== undefined) {
        return Promise.resolve({
          result: {
            ok: false,
            timedOut: true,
            error: tabUnresponsiveMessage(zombie, Date.now()),
          },
        });
      }
      const absence = table === null ? null : tabAbsenceMessage(table.state(), Date.now());
      return Promise.resolve({
        result: {
          ok: false,
          timedOut: true,
          error:
            participantId === '__vgai_missing_local_host__'
              ? 'No local editor tab is connected; refusing to route this command to a remote participant.'
              : // A participant id only helps a caller who NAMED one. The local
                // session's own host participant is an internal identity — once
                // its tab goes away, naming it says nothing the caller can act
                // on, while `noEditorConnectedMessage` names the URL to open and,
                // for a `--no-open`/`VGAI_NO_OPEN` session, why no tab appeared
                // by itself.
                participantId !== null && participantId !== ctx.hostParticipantId
                ? `No editor tab is connected for participant ${participantId}.`
                : `${absence === null ? 'No editor tab is present' : absence}. ${noEditorConnectedMessage(options.tabBijection)}`,
        },
      });
    }

    // Assign a request ID so the browser can report the result back
    const requestId = randomUUID();
    const commandWithId = { ...body, _requestId: requestId };

    let timeoutMs = commandTimeoutMs(body['type']);
    let workStartedAt = Date.now();
    const hasSeparateDeliveryBudget = commandAckDeadlineMs(body['type']) !== null;
    const resultPromise = new Promise<SettledCommandResult>((resolve) => {
      const expire = (): void => {
        const tab = table?.tab(targetTabId);
        const pending = pendingCommands.get(requestId);
        const expiredAt = Date.now();
        const base =
          tab === undefined
            ? 'Command timed out — editor connected but did not respond.'
            : `Command timed out — ${tabWaitingMessage(
                tab,
                expiredAt,
                Math.max(0, tab.epochCount - (pending?.epochAtRelay ?? tab.epochCount)),
              )} and did not respond.`;
        // NAME THE PHASE. The sentence above is true and says nothing a reader
        // can act on: measured at N=20000, `play`, `screenshot` and `stop` all
        // expired with it while the page sat inside one 199.5s block and its
        // WORKER heartbeat kept the tab looking healthy. See `play-stall.ts`.
        const stall = playStallDiagnosis({
          command: body['type'],
          base,
          phase: ctx.livePlayPhase,
          now: expiredAt,
        });
        journalEvent({
          kind: 'play-stall',
          command: typeof body['type'] === 'string' ? body['type'] : 'unknown',
          requestId8: short(requestId),
          phase: stall.phase,
          phaseAgeMs: stall.phaseAgeMs,
          waitedMs: timeoutMs,
        });
        // …and into the console ledger, so `vgai status` explains the stuck
        // play instead of printing a healthy tab. Keyed on the PHASE, never on
        // the duration, so a repeating stall stays one condition with a count.
        consoleLedger.observe({
          severity: 'error',
          source: 'play-stall',
          message: playStallConsoleMessage(body['type'], stall.phase),
          loadId: pending?.controllerClientId ?? targetTabId,
        });
        settlePendingCommand(requestId, {
          ok: false,
          timedOut: true,
          error: stall.message,
        });
      };
      const timer = setTimeout(expire, timeoutMs);
      const refreshWorkTimer = (): void => {
        const pending = pendingCommands.get(requestId);
        if (pending === undefined) return;
        timeoutMs = commandTimeoutMs(body['type']);
        clearTimeout(pending.timer);
        pending.timer = setTimeout(expire, Math.max(0, workStartedAt + timeoutMs - Date.now()));
      };
      pendingCommands.set(requestId, {
        resolve,
        timer,
        tabId: targetTabId,
        command: commandWithId,
        refreshWorkTimer,
        epochAtRelay: table?.tab(targetTabId)?.epochCount ?? 0,
        ...(hasSeparateDeliveryBudget
          ? {
              restartWorkTimerAfterReceipt: () => {
                workStartedAt = Date.now();
                refreshWorkTimer();
              },
            }
          : {}),
      });
    });

    deliverToTab(requestId, body['type'], participantId);

    return resultPromise;
  }

  /** Relay helpers whose commands never defer editor presentation. */
  async function relayCommandResult(body: Record<string, unknown>): Promise<RelayedCommandResult> {
    const settled = await relayCommand(body);
    settled.callerReceipt?.();
    return settled.result;
  }

  // MediaRecorder emits bounded binary chunks while the page is recording.
  // They stream straight into the project's ignored capture area instead of
  // riding the JSON command result, whose 50 MiB limit is intentionally too

  return {
    handleCommandReceived,
    handleCommandListener,
    handleContributedCommands,
    handlePlayPhase,
    handleConsoleEntries,
    handleConsoleResolved,
    handlePageError,
    handleCommandResult,
    handleEditorState,
    handleTabRoute,
    decorateWithCommandListener,
    tabTableFor,
    clientsInDeliveryOrder,
    relayCommand,
    relayCommandResult,
    openGameplayRecording,
    openGameplayRecordings,
    close: () => controlSocket.close(),
    MAX_RECORDING_CHUNK_BYTES,
  };
}
