import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { HOSTED_ATTACHMENT_PATH, HOSTED_MESSAGE_BYTES, isHostedRequest } from '@volter/editor-sdk/session/hosted-attachment';

interface Lease {
  id: string;
  client: string;
  worker: string;
  page: string;
  expiresAt: number;
  socket?: WebSocket;
  clients: Set<WebSocket>;
  pending: Map<string, { client: WebSocket; originalId: string; timer: ReturnType<typeof setTimeout> }>;
  state: Record<string, unknown>;
}
const send = (socket: WebSocket, value: unknown): void => {
  if (socket.readyState !== WebSocket.OPEN) return;
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > HOSTED_MESSAGE_BYTES || socket.bufferedAmount + Buffer.byteLength(data) > HOSTED_MESSAGE_BYTES) { socket.close(1009, 'Attachment buffer limit'); return; }
  socket.send(data);
};
const equal = (a: string, b: unknown): boolean => typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** An explicit deployment adapter, not installed on ordinary editor servers.
 * The host supplies its allowed public origin (never inferred from Host).
 * Secrets stay in auth frames and owner-only client state, not access-log URLs. */
export function createHostedAttachmentRelay(options: { origin: string; ttlMs?: number; maxLeases?: number }) {
  const origin = new URL(options.origin).origin;
  const leases = new Map<string, Lease>();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: HOSTED_MESSAGE_BYTES, perMessageDeflate: false });
  function finish(lease: Lease, id: string, answer: Record<string, unknown>): void {
    const call = lease.pending.get(id);
    if (!call) return;
    clearTimeout(call.timer); lease.pending.delete(id);
    send(call.client, { ...answer, type: 'response', id: call.originalId });
  }
  function remove(lease: Lease): void {
    for (const id of lease.pending.keys()) finish(lease, id, { error: 'Hosted attachment ended; request was not replayed.' });
    lease.socket?.close(); for (const client of lease.clients) client.close();
    leases.delete(lease.id);
  }
  const sweep = setInterval(() => { for (const lease of leases.values()) if (lease.expiresAt <= Date.now()) remove(lease); }, 1000);
  sweep.unref();
  // Browser WebSockets answer control-frame pings automatically. Keep both
  // worker and client connections active through idle proxy timeouts without
  // issuing editor requests or extending the attachment's lease.
  const keepAlive = setInterval(() => {
    for (const socket of sockets.clients) if (socket.readyState === WebSocket.OPEN) socket.ping();
  }, 20_000);
  keepAlive.unref();
  const json = (response: ServerResponse, status: number, value: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value));
  };
  async function middleware(request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> {
    const path = (request.url ?? '').split('?')[0];
    if (path !== HOSTED_ATTACHMENT_PATH) { next(); return; }
    if (request.method !== 'POST') { json(response, 405, { error: 'Use the product hosted attach command.' }); return; }
    if (request.headers.origin && request.headers.origin !== origin) { json(response, 403, { error: 'Origin refused.' }); return; }
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > 8192) { json(response, 413, { error: 'Attachment request too large.' }); return; }
        chunks.push(bytes);
      }
      if (leases.size >= (options.maxLeases ?? 16)) { json(response, 429, { error: 'Hosted attachment capacity reached.' }); return; }
      const { page: input } = JSON.parse(Buffer.concat(chunks).toString());
      const page = new URL(input);
      if (page.origin !== origin || page.username || page.password || page.hash) throw new Error('Attachment must name a page on the configured origin, without a fragment.');
      const id = randomUUID();
      const lease: Lease = { id, client: randomBytes(32).toString('hex'), worker: randomBytes(32).toString('hex'),
        page: page.href, expiresAt: Date.now() + (options.ttlMs ?? 2 * 60 * 60_000), clients: new Set(), pending: new Map(), state: { phase: 'waiting-for-tab', page: page.href } };
      leases.set(id, lease);
      json(response, 201, { id, clientToken: lease.client, workerToken: lease.worker, page: lease.page, expiresAt: lease.expiresAt, endpoint: `${origin}${HOSTED_ATTACHMENT_PATH}/${id}` });
    } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
  }
  function install(server: {
    on(event: 'upgrade', listener: (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void): unknown;
    off(event: 'upgrade', listener: (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void): unknown;
  }): () => void {
    const onUpgrade = (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void => {
      const match = /^\/__editor-hosted\/([a-f0-9-]+)$/.exec(request.url ?? '');
      if (!match) return;
      const lease = leases.get(match[1]!);
      if (!lease || lease.expiresAt <= Date.now() || (request.headers.origin && request.headers.origin !== origin)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
      }
      sockets.handleUpgrade(request, socket, head, ws => {
        let role: 'worker' | 'client' | undefined;
        const authTimeout = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
        ws.on('error', () => ws.close());
        ws.on('message', data => {
          try {
            const message = JSON.parse(data.toString());
            if (!role) {
              if (message.type !== 'auth') throw new Error('Authentication required');
              if (message.role === 'worker' && equal(lease.worker, message.token) && message.page === lease.page && !lease.socket) {
                role = 'worker'; lease.socket = ws;
              } else if (message.role === 'client' && equal(lease.client, message.token) && lease.clients.size < 8) {
                role = 'client'; lease.clients.add(ws);
              } else throw new Error('Attachment refused');
              clearTimeout(authTimeout); send(ws, { type: 'ready', state: lease.state }); return;
            }
            if (role === 'worker') {
              if (message.type === 'state') {
                lease.state = { phase: String(message.state?.phase ?? 'unknown').slice(0, 1000), page: lease.page };
                for (const client of lease.clients) send(client, { type: 'state', state: lease.state });
              } else if (message.type === 'response' && typeof message.id === 'string') {
                if (typeof message.error !== 'string' && (!Number.isInteger(message.status) || message.status < 200 || message.status > 599 || typeof message.body !== 'string')) throw new Error('Invalid editor response');
                finish(lease, message.id, message);
              }
              return;
            }
            if (message.type === 'revoke') { remove(lease); return; }
            if (message.type === 'cancel') {
              for (const [id, call] of lease.pending) if (call.client === ws && call.originalId === message.id) {
                if (lease.socket) send(lease.socket, { type: 'cancel', id });
                finish(lease, id, { error: 'Request cancelled.' });
              }
              return;
            }
            if (!isHostedRequest(message)) throw new Error('Only bounded editor requests are accepted');
            if (!lease.socket || lease.socket.readyState !== WebSocket.OPEN) { send(ws, { type: 'response', id: message.id, error: 'Hosted tab is not connected.' }); return; }
            if (lease.pending.size >= 8) { send(ws, { type: 'response', id: message.id, error: 'Hosted request capacity reached.' }); return; }
            // Relay-owned ids prevent one client from answering/cancelling another's call.
            const id = randomUUID();
            const timer = setTimeout(() => {
              if (lease.socket) send(lease.socket, { type: 'cancel', id });
              finish(lease, id, { error: 'Hosted request timed out; it was not replayed.' });
            }, 31 * 60_000);
            lease.pending.set(id, { client: ws, originalId: message.id, timer });
            send(lease.socket, { ...message, id });
          } catch (error) { send(ws, { type: 'error', error: error instanceof Error ? error.message : String(error) }); ws.close(1008); }
        });
        ws.on('close', () => {
          clearTimeout(authTimeout); lease.clients.delete(ws);
          if (lease.socket === ws) {
            delete lease.socket; lease.state = { phase: 'disconnected', page: lease.page };
            for (const id of lease.pending.keys()) finish(lease, id, { error: 'Hosted tab disconnected; request was not replayed.' });
          } else for (const [id, call] of lease.pending) if (call.client === ws) {
            if (lease.socket) send(lease.socket, { type: 'cancel', id });
            finish(lease, id, { error: 'Client disconnected.' });
          }
        });
      });
    };
    server.on('upgrade', onUpgrade);
    return () => { server.off('upgrade', onUpgrade); };
  }
  return { middleware, install, close() { clearInterval(sweep); clearInterval(keepAlive); for (const lease of leases.values()) remove(lease); sockets.close(); } };
}
