/** An opt-in attachment to one hosted editor. Only the existing editor HTTP
 * routes cross this channel; it is neither a DOM inspector nor a shell. */
export const HOSTED_ATTACHMENT_PATH = '/__editor-hosted';
export const HOSTED_ATTACHMENT_FRAGMENT = 'volter-editor-attach';
export const HOSTED_MESSAGE_BYTES = 32 * 1024 * 1024;
export const HOSTED_REQUEST_BYTES = 1024 * 1024;

export interface HostedAttachment {
  id: string;
  token: string;
  endpoint: string;
  page: string;
  expiresAt: number;
}
export interface HostedRequest {
  type: 'request';
  id: string;
  path: string;
  method: string;
  body?: string;
}
export function isHostedRequest(value: unknown): value is HostedRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v['type'] === 'request' && typeof v['id'] === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(v['id']) &&
    typeof v['path'] === 'string' && /^\/__editor\/[a-zA-Z0-9_/?=&%.-]+$/.test(v['path']) &&
    !v['path'].includes('..') && (v['method'] === 'GET' || v['method'] === 'POST') &&
    (v['body'] === undefined || (typeof v['body'] === 'string' && new TextEncoder().encode(v['body']).length <= HOSTED_REQUEST_BYTES));
}

export function hostedSocketUrl(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new Error('Hosted attachments require HTTPS (or local loopback HTTP).');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** Client side: the SDK still issues its normal HTTP requests. Socket loss
 * fails outstanding calls; a mutation is never replayed after reconnect. */
export async function connectHostedAttachment(attachment: HostedAttachment): Promise<{
  fetch: typeof fetch;
  state: Record<string, unknown>;
  close(): void;
}> {
  const socket = new WebSocket(hostedSocketUrl(attachment.endpoint));
  const pending = new Map<string, { resolve(value: Response): void; reject(error: Error): void; cleanup(): void }>();
  let state: Record<string, unknown> = {};
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('Hosted attachment did not answer.')); socket.close(); }, 15_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', role: 'client', token: attachment.token })));
    socket.addEventListener('message', event => {
      try {
        const value = JSON.parse(String(event.data));
        if (value.type === 'ready') { state = value.state ?? {}; clearTimeout(timer); resolve(); }
        else if (value.type === 'state') state = value.state ?? {};
        else if (value.type === 'response') {
          const call = pending.get(value.id);
          if (!call) return;
          pending.delete(value.id); call.cleanup();
          if (value.error) call.reject(new Error(value.error));
          else call.resolve(new Response([204, 205, 304].includes(value.status) ? null : value.body, {
            status: value.status, headers: { 'content-type': 'application/json' },
          }));
        } else if (value.type === 'error') { clearTimeout(timer); reject(new Error(value.error)); socket.close(); }
      } catch (error) { clearTimeout(timer); reject(error); socket.close(); }
    });
    socket.addEventListener('close', () => {
      clearTimeout(timer); reject(new Error('Hosted attachment disconnected.'));
      for (const call of pending.values()) { call.cleanup(); call.reject(new Error('Hosted attachment disconnected; the request was not replayed.')); }
      pending.clear();
    });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Hosted attachment connection failed.')); });
  });
  await ready;
  const remoteFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const message: HostedRequest = { type: 'request', id: crypto.randomUUID(), path: url.pathname + url.search, method: request.method };
    if (request.body) message.body = await request.text();
    if (!isHostedRequest(message)) throw new Error('Hosted attachment only carries bounded editor HTTP requests.');
    request.signal.throwIfAborted();
    return await new Promise<Response>((resolve, reject) => {
      const abort = (): void => {
        pending.delete(message.id);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'cancel', id: message.id }));
        reject(new Error('Hosted request cancelled; any completed mutation is not undone.'));
      };
      if (socket.readyState !== WebSocket.OPEN) { reject(new Error('Hosted attachment is disconnected.')); return; }
      pending.set(message.id, { resolve, reject, cleanup: () => request.signal.removeEventListener('abort', abort) });
      request.signal.addEventListener('abort', abort, { once: true });
      socket.send(JSON.stringify(message));
    });
  };
  return { fetch: remoteFetch, get state() { return state; }, close: () => socket.close() };
}

/** Hosted shell integration. The worker credential comes only from an explicit
 * product attach action's URL fragment, never from a query, cookie or owner token. */
export function attachHostedEditorPage(options: {
  location: Pick<Location, 'href'>;
  replaceUrl(url: string): void;
}): { setState(state: Record<string, unknown>): void; serve(fetchEditor: typeof fetch): void; close(): void } | undefined {
  const page = new URL(options.location.href);
  const fragment = new URLSearchParams(page.hash.slice(1));
  const encoded = fragment.get(HOSTED_ATTACHMENT_FRAGMENT);
  if (!encoded) return undefined;
  const attachment = JSON.parse(encoded) as HostedAttachment;
  if (new URL(attachment.endpoint).origin !== page.origin || attachment.page !== page.origin + page.pathname + page.search)
    throw new Error('Hosted attachment does not name this exact page.');
  fragment.delete(HOSTED_ATTACHMENT_FRAGMENT);
  page.hash = fragment.toString(); options.replaceUrl(page.href);
  const socket = new WebSocket(hostedSocketUrl(attachment.endpoint));
  let handler: typeof fetch | undefined;
  let state: Record<string, unknown> = { phase: 'booting', page: attachment.page };
  const active = new Map<string, AbortController>();
  const send = (value: unknown): void => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  socket.addEventListener('open', () => send({ type: 'auth', role: 'worker', token: attachment.token, page: attachment.page }));
  socket.addEventListener('message', async event => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.type === 'ready') { send({ type: 'state', state }); return; }
      if (message.type === 'cancel') { active.get(message.id)?.abort(); return; }
      if (!isHostedRequest(message)) return;
      if (!handler) { send({ type: 'response', id: message.id, error: 'Hosted editor is still starting.' }); return; }
      const controller = new AbortController(); active.set(message.id, controller);
      try {
        const response = await handler(new URL(message.path, 'http://127.0.0.1'), {
          method: message.method, ...(message.body === undefined ? {} : { body: message.body }),
          headers: { 'content-type': 'application/json' }, signal: controller.signal,
        });
        const body = await response.text();
        if (new TextEncoder().encode(body).length > HOSTED_MESSAGE_BYTES - 4096) throw new Error('Hosted response exceeds attachment limit.');
        send({ type: 'response', id: message.id, status: response.status, body });
      } catch (error) { send({ type: 'response', id: message.id, error: error instanceof Error ? error.message : String(error) }); }
      finally { active.delete(message.id); }
    } catch { socket.close(); }
  });
  const stop = (): void => { for (const controller of active.values()) controller.abort(); active.clear(); };
  socket.addEventListener('close', stop);
  return {
    setState(value) { state = { ...value, page: attachment.page }; send({ type: 'state', state }); },
    serve(fetchEditor) { handler = fetchEditor; state = { phase: 'ready', page: attachment.page }; send({ type: 'state', state }); },
    close() { stop(); socket.close(); },
  };
}
