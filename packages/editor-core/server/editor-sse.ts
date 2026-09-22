/**
 * Shared event fan-out for editor tabs — ONE message vocabulary over TWO
 * transports.
 *
 * A connected editor page is a `EditorEventClient` in this pool, and every
 * caller (asset browser, Colyseus plugin, the command relay, the tab
 * bijection) addresses it the same way regardless of how it got here:
 *
 *  - `ServerResponse` — the classic `GET /__editor/events` SSE stream. Still
 *    the transport the share tunnel bridges through (TryCloudflare cannot do
 *    SSE to the browser, so its gateway consumes this and re-frames it), and
 *    still curl-debuggable.
 *  - `EditorSocketClient` — a WebSocket upgrade on that SAME path. Local tabs
 *    use this one: it carries the identical named events downstream AND the
 *    tab's control replies upstream, so receipts/results/state no longer
 *    compete with module loads for the browser's per-origin HTTP connection
 *    pool. It also answers protocol pings from the browser's network stack
 *    while the main thread is blocked, which is what lets the relay say
 *    "busy" instead of guessing "dead".
 */

import type { ServerResponse } from 'node:http';
import type { CommandListenerFacts } from './server-utils';

/**
 * What a tab last told the server about itself (`POST /__editor/state` or the
 * equivalent control frame).
 *
 * It is EVIDENCE FOR A REFUSAL and nothing else now. It used to elect the tab
 * that owned commands, and that election is what the tab table replaced: who
 * owns the session is a presence question (`server/tab-presence.ts`), and
 * answering it from a report the page is not obliged to send is how a live,
 * blessed tab became unroutable and its commands came back "disconnected".
 * What survives is the part that was always true — when a command goes
 * unacknowledged, the refusal can say what that tab was showing and how long
 * it has been quiet instead of guessing.
 */
export interface ClientControlHealth {
  /** `healthy` means the tab explicitly reported an empty pageErrors list. */
  readonly errorState: 'healthy' | 'unknown' | 'errored';
  readonly visible: boolean;
  readonly focused: boolean;
  readonly updatedAt: number;
}

/**
 * A duplex control socket in the pool.
 *
 * Beyond delivery it exposes the two liveness facts an SSE response cannot:
 * the age of the last protocol pong (answered by the browser's NETWORK stack,
 * so it stays fresh through a blocked main thread) and a main-thread echo
 * round trip (answered by the inline bootstrap in index.html, so an
 * unanswered echo can only mean a blocked main thread).
 */
export interface EditorSocketClient {
  /** Structural discriminator against `ServerResponse`. */
  readonly kind: 'socket';
  /** Deliver one framed event; false when the socket can no longer take it. */
  sendFrame(event: string, data: string, id?: string): boolean;
  /** True once the socket is closing or closed. */
  isClosed(): boolean;
  /** Age in ms of the most recent protocol pong, or null before the first. */
  lastPongAgeMs(): number | null;
  /** Round-trip the page's inline main-thread echo responder. */
  echo(timeoutMs: number): Promise<boolean>;
  /** End this exact connection because a newer generation superseded it. */
  close(code: number, reason: string): void;
}

/** Either transport, as held by the pool and by a pending command's owner. */
export type EditorEventClient = ServerResponse | EditorSocketClient;

const sseClients = new Set<EditorEventClient>();
const clientIds = new Map<EditorEventClient, string>();
const clientParticipantIds = new Map<EditorEventClient, string>();
const clientControlHealth = new Map<string, ClientControlHealth>();
/**
 * Per-page-load command-listener facts (`server-utils.ts`'s
 * `CommandListenerFacts`), keyed by client id — which IS the page-load id, so
 * a reload starts from nothing rather than inheriting the dead page's verdict.
 *
 * OWNERSHIP: this map is written only by the three `note*` helpers below, and
 * an entry is dropped only by `dropClient`, exactly where `clientControlHealth`
 * beside it is dropped — one lifetime, one teardown path, no timer.
 */
const clientListenerFacts = new Map<string, MutableCommandListenerFacts>();

interface MutableCommandListenerFacts {
  attachedAt: number | null;
  lastRelayAt: number | null;
  lastReceiptAt: number | null;
}

function factsFor(clientId: string): MutableCommandListenerFacts {
  const existing = clientListenerFacts.get(clientId);
  if (existing) return existing;
  const fresh: MutableCommandListenerFacts = {
    attachedAt: null,
    lastRelayAt: null,
    lastReceiptAt: null,
  };
  clientListenerFacts.set(clientId, fresh);
  return fresh;
}

const KEEPALIVE_MS = 15_000;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

/** True for the WebSocket transport. */
export function isEditorSocketClient(client: EditorEventClient): client is EditorSocketClient {
  return (client as Partial<EditorSocketClient>).kind === 'socket';
}

/**
 * Whether this client's transport can still carry an event.
 *
 * Both flags are needed on the SSE side: `writableEnded` reports that the
 * SERVER called `res.end()`, which nothing does for an SSE response, so a
 * client abort leaves `writableEnded: false, destroyed: true` (measured).
 */
export function isClientAlive(client: EditorEventClient): boolean {
  if (isEditorSocketClient(client)) return !client.isClosed();
  return !client.writableEnded && !client.destroyed;
}

/** End one exact event-stream generation. Its ordinary close handler owns all
 * table and pending-command cleanup. */
export function closeClient(client: EditorEventClient, code: number, reason: string): void {
  if (isEditorSocketClient(client)) {
    client.close(code, reason);
    return;
  }
  try {
    client.end();
  } catch {
    /* The stream is already ending; its request close still owns cleanup. */
  }
}

function dropClient(client: EditorEventClient): void {
  const clientId = clientIds.get(client);
  sseClients.delete(client);
  clientIds.delete(client);
  clientParticipantIds.delete(client);
  if (clientId && ![...clientIds.values()].includes(clientId)) {
    clientControlHealth.delete(clientId);
    clientListenerFacts.delete(clientId);
  }
}

/** Deliver one named event, removing the client from the pool if it is dead. */
function deliver(client: EditorEventClient, event: string, data: string, id?: string): boolean {
  try {
    if (isEditorSocketClient(client)) {
      if (client.isClosed()) {
        dropClient(client);
        return false;
      }
      if (!client.sendFrame(event, data, id)) {
        dropClient(client);
        return false;
      }
      return true;
    }
    // `writableEnded` guards against writing to a closed stream.
    if (client.writableEnded) {
      dropClient(client);
      return false;
    }
    client.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${data}\n\n`);
    return true;
  } catch {
    // SC3: one dead client must not abort the broadcast loop.
    dropClient(client);
    return false;
  }
}

/** Start the keepalive ticker once at least one client is connected. */
function ensureKeepalive(): void {
  if (keepaliveTimer || sseClients.size === 0) return;
  keepaliveTimer = setInterval(() => {
    if (sseClients.size === 0) {
      stopKeepalive();
      return;
    }
    // Socket clients have the protocol ping instead (editor-control-socket.ts).
    for (const client of [...sseClients]) {
      if (isEditorSocketClient(client)) continue;
      try {
        if (client.writableEnded) dropClient(client);
        else client.write(':keepalive\n\n');
      } catch {
        dropClient(client);
      }
    }
  }, KEEPALIVE_MS);
  // Don't keep the process alive solely for the heartbeat.
  keepaliveTimer.unref?.();
}

function stopKeepalive(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

/** Send an event to all connected editor clients. */
export function broadcast(event: string, data: unknown): void {
  const sequence =
    data &&
    typeof data === 'object' &&
    Number.isSafeInteger((data as { sequence?: unknown }).sequence)
      ? Number((data as { sequence: number }).sequence)
      : null;
  const payload = JSON.stringify(data);
  // Snapshot so deletions during iteration are safe.
  for (const client of [...sseClients]) {
    deliver(client, event, payload, sequence === null ? undefined : String(sequence));
  }
}

/**
 * Send an event to the connection(s) carrying one specific clientId
 * (tab-bijection lifecycle: yield/refocus/close target exactly one tab).
 * Returns true when at least one live connection received it.
 */
export function sendToClient(clientId: string, event: string, data: unknown): boolean {
  const payload = JSON.stringify(data);
  let delivered = false;
  for (const [client, id] of [...clientIds]) {
    if (id !== clientId) continue;
    if (deliver(client, event, payload)) delivered = true;
  }
  return delivered;
}

/**
 * Send an event to the FIRST live connection carrying this clientId, and hand
 * back the handle it went to.
 *
 * The command relay needs the handle, not a boolean: a command is owned by
 * the connection that took it, so the disconnect settlement can find it
 * again. `sendToClient` fans out to every connection of a client and can only
 * answer "did anyone take it", which is the right shape for a lifecycle
 * notification and the wrong one for a side effect that must happen once.
 */
export function sendToClientHandle(
  clientId: string,
  event: string,
  data: unknown,
): EditorEventClient | null {
  const payload = JSON.stringify(data);
  for (const [client, id] of [...clientIds]) {
    if (id !== clientId) continue;
    if (deliver(client, event, payload)) return client;
  }
  return null;
}

/**
 * Send an event to EVERY live connection, optionally scoped to one
 * participant. Distinct from `broadcast` only in the scoping — session end is
 * the caller: `tab-close` has to reach the extras and the launcher tabs too,
 * not just the blessed one, or every other tab falls through to the generic
 * "Editor disconnected" overlay when the process exits under it.
 */
export function sendToAllClients(event: string, data: unknown, participantId?: string): number {
  const payload = JSON.stringify(data);
  let delivered = 0;
  for (const client of [...sseClients]) {
    if (participantId && clientParticipantIds.get(client) !== participantId) continue;
    if (deliver(client, event, payload)) delivered++;
  }
  return delivered;
}

/** Add a client connection. Call from the /__editor/events handler. */
export function addClient(res: EditorEventClient, clientId?: string, participantId?: string): void {
  sseClients.add(res);
  if (clientId) clientIds.set(res, clientId);
  if (participantId) clientParticipantIds.set(res, participantId);
  ensureKeepalive();
}

/** Remove a client connection. Call on request/socket close. */
export function removeClient(res: EditorEventClient): void {
  dropClient(res);
  if (sseClients.size === 0) stopKeepalive();
}

/** Record what a tab last said about itself — read only by a refusal. */
export function updateClientControlHealth(clientId: string, health: ClientControlHealth): void {
  clientControlHealth.set(clientId, health);
}

/** Clear project-specific health snapshots while keeping live sockets. */
export function clearClientControlHealth(): void {
  clientControlHealth.clear();
}

/** The page said its command listener attached (a timestamp) or detached
 *  (`null`). See `src/editor-api.ts`'s `reportCommandListener`. */
export function noteCommandListenerAttached(clientId: string, at: number | null): void {
  factsFor(clientId).attachedAt = at;
}

/** The relay handed this page a command. */
export function noteCommandRelay(clientId: string, at: number = Date.now()): void {
  factsFor(clientId).lastRelayAt = at;
}

/** This page acknowledged receipt of a relayed command — the OTHER half of the
 *  verdict, and the one that needs no cooperation beyond the receipt the relay
 *  already depends on. */
export function noteCommandReceipt(clientId: string | undefined, at: number = Date.now()): void {
  if (clientId === undefined) return;
  factsFor(clientId).lastReceiptAt = at;
}

/** What is MEASURED about this page-load's command listener. A page-load that
 *  has never reported anything reads as all-null, which
 *  `commandListenerHealth` states as `'not attached'` — never as healthy. */
export function commandListenerFactsFor(clientId: string): CommandListenerFacts {
  return (
    clientListenerFacts.get(clientId) ?? {
      attachedAt: null,
      lastRelayAt: null,
      lastReceiptAt: null,
    }
  );
}

/** Number of currently-connected clients (exposed for tests). */
export function clientCount(participantId?: string): number {
  if (!participantId) return sseClients.size;
  return [...clientParticipantIds.values()].filter((candidate) => candidate === participantId)
    .length;
}

/** The last health a given tab reported, or `undefined` if it never has. Read
 *  when a relayed command goes unacknowledged, so the refusal can name what
 *  that tab was showing and how long it has been silent rather than guessing. */
export function clientControlHealthFor(clientId: string | null): ClientControlHealth | undefined {
  return clientId === null ? undefined : clientControlHealth.get(clientId);
}

/** Client identity for a handle returned by `sendToClientHandle`. */
export function clientIdForResponse(response: EditorEventClient): string | null {
  return clientIds.get(response) ?? null;
}
