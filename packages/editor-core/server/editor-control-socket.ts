/**
 * The editor tab's duplex control socket — a WebSocket upgrade on the SAME
 * path as the SSE stream (`/__editor/events`), carrying the SAME named events
 * downstream and the tab's control replies upstream.
 *
 * Why it exists (measured 2026-08-09): a cold editor boot blocked a real
 * tab's main thread for 60-100s. A blocked main thread can neither issue nor
 * answer a `fetch`, so every receipt/result/state POST stopped — and the
 * relay, which could only see silence, refused five plays that all executed
 * later. Two things fix that here:
 *
 *  - Upstream control traffic rides the ALREADY-OPEN socket instead of
 *    opening new HTTP requests, so it never queues behind a module flood in
 *    the browser's per-origin connection pool.
 *  - Liveness stops being a guess. The browser's NETWORK stack answers
 *    protocol pings while the main thread is blocked, and the page's INLINE
 *    bootstrap (index.html, attached before any module loads) answers a
 *    `control-echo`. Pong-fresh + echo-silent is "alive but busy" as a
 *    measured fact; an unanswered echo can never mean "the listener was not
 *    wired up yet", because the responder exists before the module graph does.
 *
 * Deliberately no frame-rate or rendering signal: games legitimately run
 * `frameloop: 'never'` and the engine hidden-pauses loops in a background
 * tab, so anything rAF-shaped would read a healthy tab as dead.
 */

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  type EditorControlLifecycle,
  parseEditorControlLifecycle,
} from '@volter/editor-sdk/session/editor-control-lifecycle';
import { type WebSocket, WebSocketServer } from 'ws';
import type { EditorSocketClient } from './editor-sse';

/** The one path both transports answer on. */
export const EDITOR_EVENTS_PATH = '/__editor/events';

/**
 * Protocol-ping cadence. Short enough that a pong age reported in a refusal
 * is meaningful evidence ("answered 3s ago" = the socket is genuinely live),
 * long enough to be invisible next to the keepalive it replaces.
 */
export const CONTROL_PING_INTERVAL_MS = 10_000;

/** How long the main-thread echo gets before it counts as unanswered. */
export const CONTROL_ECHO_TIMEOUT_MS = 1_000;

/**
 * The socket ENDED WITH NO CLOSE FRAME — RFC 6455's 1006, which no endpoint is
 * allowed to send and only an observer can synthesize. It is the shape a
 * KILLED browser renderer process leaves behind (a tab that closes normally
 * sends a frame), so it is also the discriminator the tab-death profile keys
 * off. One owner of the literal: this file synthesizes it below,
 * `editor-server.ts` reads it.
 */
export const ABNORMAL_SOCKET_CLOSE = 1006;

/**
 * The capability frame. Sent ONLY over a native socket, never on the SSE
 * stream — the share tunnel's gateway bridges the SSE stream into its own
 * WebSocket, and that socket does NOT accept upstream control frames. A tab
 * behind the tunnel therefore never sees this and keeps POSTing, which is
 * exactly right.
 */
const DUPLEX_READY_EVENT = 'control-duplex';

export interface EditorControlConnection {
  /** The pool handle for this socket. */
  readonly client: EditorSocketClient;
  /** The upgrade request's URL, for query parameters. */
  readonly url: URL;
  /** The raw upgrade request, for header-derived identity. */
  readonly request: IncomingMessage;
  /** Deliver one framed event before the client is pooled. */
  send(event: string, data: string, id?: string): void;
  /** Close the socket with a reason (rejected identity, session end). */
  close(code: number, reason: string): void;
}

/**
 * Another WebSocket path this session owns (the tab heartbeat).
 *
 * It rides the control socket's ONE `upgrade` listener rather than adding a
 * second, because the fallthrough branch below has to know whether ANY editor
 * path claimed the socket before it destroys it — and `listenerCount` cannot
 * answer that once two of our own listeners are competing to say "not mine".
 */
export interface RawSocketRoute {
  readonly path: string;
  /** Same shape as the control socket's own gate; a string refuses with 403. */
  authorize(request: IncomingMessage, url: URL): string | null;
  open(socket: WebSocket, url: URL, request: IncomingMessage): void;
}

export interface EditorControlSocketOptions {
  /**
   * Reject the upgrade BEFORE the handshake. Return an error string to
   * refuse (sent as a plain 403 body, the same shape the SSE route answers
   * with), or null to accept.
   */
  authorize(request: IncomingMessage, url: URL): string | null;
  /**
   * Register the open socket; the returned function runs once on close, and
   * is handed the WebSocket close code/reason. Those two are the only honest
   * answer to "why did this tab's channel go away" — the journal quotes them
   * verbatim rather than inferring a story from the silence.
   */
  open(connection: EditorControlConnection): (close?: { code: number; reason: string }) => void;
  /** The duplex capability was granted to this socket (journalling hook). */
  duplexGranted?(connection: EditorControlConnection): void;
  /** One upstream control frame from the tab. */
  message(
    type: string,
    payload: Record<string, unknown>,
    connection: EditorControlConnection,
    lifecycle: EditorControlLifecycle | null,
    lifecycleMalformed: boolean,
  ): void;
  /** Other WebSocket paths this one upgrade listener also routes. */
  extraRoutes?: readonly RawSocketRoute[] | undefined;
}

export interface EditorControlSocketServer {
  /**
   * Handle `upgrade` on this HTTP server.
   *
   * Routes by PATHNAME and passes every other upgrade through untouched —
   * Vite's HMR socket may share this server. When this is the only `upgrade`
   * listener there is nobody to pass to, so the socket is destroyed, which is
   * exactly what Node does by default with no listener at all.
   */
  attach(server: HttpServer): void;
  /** Close every live control socket (server shutdown). */
  close(): void;
}

/**
 * One upstream `{ type, payload }` frame, or null if it is not one. A
 * malformed frame is dropped, never partially read.
 *
 * The discriminator and the payload live in SEPARATE keys, and that
 * separation is load-bearing in both directions. Flattened
 * (`{ type, ...payload }`) the envelope leaked its own `type` into the state
 * the server stored, so `vgai status` printed a field the tab never
 * reported — on the exact seam this transport promises the POST route
 * cannot drift from. And a payload key named `type` (a state snapshot is an
 * open-ended object) would have overwritten the discriminator on the way
 * out, turning a routine state report into an unknown control frame:
 * dropped silently, health left stale, and the next refusal quoting a
 * silence the tab never chose.
 */
function parseControlFrame(raw: unknown): {
  type: string;
  payload: Record<string, unknown>;
  lifecycle: EditorControlLifecycle | null;
  lifecycleMalformed: boolean;
} | null {
  let frame: unknown;
  try {
    frame = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!frame || typeof frame !== 'object') return null;
  const type = (frame as Record<string, unknown>)['type'];
  if (typeof type !== 'string') return null;
  const body = (frame as Record<string, unknown>)['payload'];
  const rawLifecycle = (frame as Record<string, unknown>)['lifecycle'];
  const lifecycle = parseEditorControlLifecycle(rawLifecycle);
  return {
    type,
    payload: body && typeof body === 'object' ? (body as Record<string, unknown>) : {},
    lifecycle,
    lifecycleMalformed: rawLifecycle !== undefined && lifecycle === null,
  };
}

export function createEditorControlSocket(
  options: EditorControlSocketOptions,
): EditorControlSocketServer {
  const sockets = new WebSocketServer({ noServer: true });

  const onUpgrade = (
    server: HttpServer,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://editor.local');
    } catch {
      return;
    }
    const extra = (options.extraRoutes ?? []).find((route) => route.path === url.pathname);
    if (extra) {
      const extraRefusal = extra.authorize(request, url);
      if (extraRefusal !== null) {
        socket.end(
          `HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${extraRefusal}`,
        );
        return;
      }
      sockets.handleUpgrade(request, socket, head, (ws) => extra.open(ws, url, request));
      return;
    }
    if (url.pathname !== EDITOR_EVENTS_PATH) {
      // Not ours. Another listener (Vite HMR, the share gateway) owns it — or
      // nobody does, in which case leaving the socket open would leak it.
      if (server.listenerCount('upgrade') <= 1) socket.destroy();
      return;
    }
    const refusal = options.authorize(request, url);
    if (refusal !== null) {
      socket.end(
        `HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${refusal}`,
      );
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      let closed = false;
      let lastPongAt: number | null = null;
      let echoSequence = 0;
      const pendingEchoes = new Map<string, (answered: boolean) => void>();

      const sendFrame = (event: string, data: string, id?: string): boolean => {
        if (closed || ws.readyState !== ws.OPEN) return false;
        try {
          ws.send(JSON.stringify(id === undefined ? { event, data } : { event, data, id }));
          return true;
        } catch {
          return false;
        }
      };

      const client: EditorSocketClient = {
        kind: 'socket',
        sendFrame,
        isClosed: () => closed || ws.readyState !== ws.OPEN,
        lastPongAgeMs: () => (lastPongAt === null ? null : Date.now() - lastPongAt),
        echo: (timeoutMs) =>
          new Promise<boolean>((resolve) => {
            if (closed || ws.readyState !== ws.OPEN) {
              resolve(false);
              return;
            }
            const id = `echo-${++echoSequence}`;
            const timer = setTimeout(() => {
              pendingEchoes.delete(id);
              resolve(false);
            }, timeoutMs);
            timer.unref?.();
            pendingEchoes.set(id, (answered) => {
              clearTimeout(timer);
              resolve(answered);
            });
            if (!sendFrame('control-echo', id)) {
              pendingEchoes.delete(id);
              clearTimeout(timer);
              resolve(false);
            }
          }),
        close: (code, reason) => {
          try {
            ws.close(code, reason);
          } catch {
            /* The close event owns teardown if the socket is still alive. */
          }
        },
      };

      const connection: EditorControlConnection = {
        client,
        url,
        request,
        send: (event, data, id) => {
          sendFrame(event, data, id);
        },
        close: (code, reason) => {
          try {
            ws.close(code, reason);
          } catch {
            /* already gone */
          }
        },
      };

      const dispose = options.open(connection);

      // Tell the page this socket takes upstream control frames. Only the
      // native transport ever emits this (see DUPLEX_READY_EVENT).
      if (sendFrame(DUPLEX_READY_EVENT, JSON.stringify({ ok: true }))) {
        options.duplexGranted?.(connection);
      }

      // Ping immediately so the first refusal in this connection's life can
      // still quote a real pong age, then on the standing cadence.
      ws.on('pong', () => {
        lastPongAt = Date.now();
      });
      const ping = () => {
        if (closed || ws.readyState !== ws.OPEN) return;
        try {
          ws.ping();
        } catch {
          /* the close handler owns teardown */
        }
      };
      ping();
      const pingTimer = setInterval(ping, CONTROL_PING_INTERVAL_MS);
      pingTimer.unref?.();

      ws.on('message', (raw) => {
        const frame = parseControlFrame(raw);
        if (!frame) return;
        if (frame.type === 'echo-reply') {
          const id = frame.payload['id'];
          if (typeof id !== 'string') return;
          pendingEchoes.get(id)?.(true);
          pendingEchoes.delete(id);
          return;
        }
        options.message(
          frame.type,
          frame.payload,
          connection,
          frame.lifecycle,
          frame.lifecycleMalformed,
        );
      });

      const onClosed = (code?: number, reason?: Buffer | string) => {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer);
        for (const settle of [...pendingEchoes.values()]) settle(false);
        pendingEchoes.clear();
        dispose({
          code: typeof code === 'number' ? code : ABNORMAL_SOCKET_CLOSE,
          reason: reason === undefined ? '' : String(reason),
        });
      };
      ws.on('close', onClosed);
      ws.on('error', () => onClosed());
    });
  };

  return {
    attach(server) {
      server.on('upgrade', (request, socket, head) =>
        onUpgrade(server, request, socket as Duplex, head),
      );
    },
    close() {
      for (const ws of sockets.clients) {
        try {
          ws.close(1001, 'editor session ended');
        } catch {
          /* best effort */
        }
      }
      sockets.close();
    },
  };
}
