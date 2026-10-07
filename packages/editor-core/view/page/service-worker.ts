/**
 * THE LIMITED VIEW'S SERVICE WORKER — the transport behind `/__editor/*` when there is no session.
 *
 * The editor and the workbench make the same requests they make against a session; this worker
 * decides who answers each one, in order:
 *
 *  1. A NAVIGATION is the static host's page, re-served with cross-origin isolation
 *     (COOP `same-origin`, COEP `credentialless`), so a host that cannot set headers still runs
 *     Blender's threads. The page reloads itself once when it was not isolated on first load.
 *  2. A GET recorded at build time (`__view/routes.json`): a compiled project module, a fixed
 *     answer of the session, an integration's engine bytes. Looked up by the exact URL, then by
 *     {@link recordedKey} (cache busters dropped, the mount id swapped for the sentinel and put
 *     back into the body).
 *  3. The view's own files, the workbench and the product's chunks: the static host.
 *  4. Everything else goes to THE PAGE, whose router answers it against the project's files in
 *     memory (`router.ts`). The files live in the page because a worker's memory does not last:
 *     the browser stops an idle worker whenever it likes.
 *
 * Built to `<out>/view-sw.js` by `server/view/view-build.ts`.
 */

import { LIMITED_VIEW_HEADER } from '@volter/editor-sdk/session/limited-view';
import {
  type LimitedViewRouteEntry,
  type LimitedViewRoutes,
  MOUNT_SENTINEL,
  recordedKey,
  STATIC_PREFIXES,
  VIEW_DIR,
  VIEW_MISS_HEADER,
} from './view-contract';

/** The few service-worker globals used here, declared rather than pulling the WebWorker lib into
 *  a project compiled against the DOM. */
interface WorkerClient {
  readonly id: string;
  readonly type: string;
  /** Window clients only: `top-level` or `auxiliary` (opened with an opener) for a tab, `nested`
   *  for an iframe (the extension host's). */
  readonly frameType?: string;
  readonly focused?: boolean;
  readonly visibilityState?: string;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
interface WorkerScope {
  readonly clients: { get(id: string): Promise<WorkerClient | undefined>; matchAll(options: { type: 'window' }): Promise<readonly WorkerClient[]>; claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: { waitUntil(p: Promise<unknown>): void }) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchLike) => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown; source: WorkerClient | null }) => void): void;
}
interface FetchLike { readonly request: Request; readonly clientId: string; readonly resultingClientId: string; respondWith(response: Promise<Response>): void }

declare const self: WorkerScope;

/** The message a forwarded request travels to the page in, and the reply it comes back as. */
export interface ForwardedRequest {
  readonly type: 'volter-view:request';
  readonly url: string;
  readonly method: string;
  readonly headers: [string, string][];
  readonly body: ArrayBuffer | null;
}
export interface ForwardedResponse {
  readonly status: number;
  readonly headers: [string, string][];
  readonly body: ArrayBuffer | null;
}

const ISOLATION: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
/** How long a page may take to answer before the request fails by name. */
const PAGE_TIMEOUT_MS = 120_000;

function isolated(response: Response, extra: Record<string, string> = {}): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries({ ...ISOLATION, ...extra })) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

let routes: Promise<LimitedViewRoutes> | null = null;
function recorded(): Promise<LimitedViewRoutes> {
  routes ??= fetch(`/${VIEW_DIR}/routes.json`, { cache: 'no-cache' })
    .then((response) => (response.ok ? (response.json() as Promise<LimitedViewRoutes>) : { mountSentinel: MOUNT_SENTINEL, entries: {} }))
    .catch(() => {
      routes = null;
      return { mountSentinel: MOUNT_SENTINEL, entries: {} };
    });
  return routes;
}

/**
 * THE PAGE THAT HOLDS THE PROJECT'S FILES for a request — never a guess.
 *
 * A browser stops an idle worker whenever it likes, and what it remembered goes with it, so the
 * set of pages that said they are ready ({@link pages}) can be empty while pages are open. The
 * answer is, in order:
 *
 *  1. the requester itself, when it is a TAB of this view (any window client but a nested iframe, so a view opened with an opener counts too);
 *  2. otherwise (a worker, the extension host's iframe) a tab that holds the project — asking the
 *     open tabs to say so again when none is known — preferring the focused one, then a visible
 *     one, then the one that announced last.
 *
 * An iframe is never the answer: it holds no files, and a request handed to it waits out the whole
 * timeout. With no tab holding the project the request fails by name.
 */
const pages = new Set<string>();
const isTab = (client: WorkerClient | undefined): client is WorkerClient =>
  client !== undefined && client.type === 'window' && client.frameType !== 'nested';

async function tabsHoldingTheProject(): Promise<WorkerClient[]> {
  const held: WorkerClient[] = [];
  for (const id of pages) {
    const client = await self.clients.get(id);
    if (isTab(client)) held.push(client);
    else pages.delete(id);
  }
  return held;
}

/** Ask every open tab of this view to announce itself again, and give them a moment to. */
async function askTabsToAnnounce(): Promise<void> {
  const tabs = (await self.clients.matchAll({ type: 'window' })).filter(isTab);
  for (const tab of tabs) tab.postMessage({ type: 'volter-view:announce' });
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function pageFor(event: FetchLike): Promise<WorkerClient | undefined> {
  const requester = event.clientId ? await self.clients.get(event.clientId) : undefined;
  if (isTab(requester)) return requester;
  let held = await tabsHoldingTheProject();
  if (held.length === 0) {
    await askTabsToAnnounce();
    held = await tabsHoldingTheProject();
  }
  return held.find((tab) => tab.focused) ?? held.find((tab) => tab.visibilityState === 'visible') ?? held.at(-1);
}

async function serveRecorded(entry: LimitedViewRouteEntry, mount: string | null): Promise<Response> {
  const stored = await fetch(`/${VIEW_DIR}/r/${entry.file}`);
  if (!stored.ok) return new Response(`The limited view lost ${entry.file}.`, { status: 500, headers: ISOLATION });
  const headers = { ...ISOLATION, 'Content-Type': entry.type, 'Cache-Control': 'no-cache' };
  if (entry.mount && mount !== null) {
    const body = (await stored.text()).replaceAll(MOUNT_SENTINEL, mount);
    return new Response(body, { status: entry.status, headers });
  }
  return new Response(stored.body, { status: entry.status, headers });
}

async function forward(event: FetchLike): Promise<Response> {
  const page = await pageFor(event);
  if (!page) {
    return new Response(JSON.stringify({ error: 'The limited view page is not open, so nothing holds the project.' }), {
      status: 503,
      headers: { ...ISOLATION, 'Content-Type': 'application/json', [LIMITED_VIEW_HEADER]: 'no-page' },
    });
  }
  const request = event.request;
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
  const channel = new MessageChannel();
  const reply = new Promise<ForwardedResponse>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the page did not answer ${request.method} ${request.url}`)), PAGE_TIMEOUT_MS);
    channel.port1.onmessage = (message) => {
      clearTimeout(timer);
      resolve(message.data as ForwardedResponse);
    };
  });
  const message: ForwardedRequest = { type: 'volter-view:request', url: request.url, method: request.method, headers: [...request.headers], body };
  page.postMessage(message, body ? [channel.port2, body] : [channel.port2]);
  const answer = await reply;
  return new Response(answer.status === 204 || answer.status === 304 ? null : answer.body, { status: answer.status, headers: answer.headers });
}

async function handle(event: FetchLike): Promise<Response> {
  const request = event.request;
  const url = new URL(request.url);
  // `/@fs//root/…` and `/@fs/root/…` are one module to Vite; the recordings are keyed by the latter.
  if (url.pathname.startsWith('/@fs//')) url.pathname = url.pathname.replace(/^\/@fs\/+/, '/@fs/');
  if (request.mode === 'navigate') return isolated(await fetch(request));
  if (request.method === 'GET' || request.method === 'HEAD') {
    const table = await recorded();
    const exact = table.entries[url.pathname + url.search];
    if (exact) return serveRecorded(exact, null);
    const { key, mount } = recordedKey(url.pathname, url.search);
    const normalized = table.entries[key];
    if (normalized) return serveRecorded(normalized, mount);
  }
  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return isolated(await fetch(request));
  // A project module the build did not compile has no honest answer here: its raw TypeScript or
  // JSX is not a module (plain `.js` may be, and stays the page's). Answer with one that fails in
  // words, instead of a MIME error naming nothing. `?raw` (the text itself) is the page's, and so
  // is any read that is not an import.
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    /\.(?:[cm]?ts|tsx|jsx)$/.test(url.pathname) &&
    !url.searchParams.has('raw') &&
    (request.destination === 'script' || request.destination === 'worker' || url.searchParams.has('import') || url.searchParams.has('volter-mount'))
  ) {
    const message = `The limited view has no compiled ${url.pathname}${url.search}: it was not reached when this view was built, and a limited view compiles nothing after that. Rebuild the view (\`view build\`) or open the project in the local editor.`;
    return new Response(`throw new Error(${JSON.stringify(message)});\n`, {
      status: 200,
      headers: { ...ISOLATION, 'Content-Type': 'text/javascript', [LIMITED_VIEW_HEADER]: 'not-compiled' },
    });
  }
  const answered = await forward(event);
  if (answered.status === 404 && answered.headers.get(VIEW_MISS_HEADER)) return isolated(await fetch(request));
  return answered;
}

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'volter-view:page-ready' && event.source) {
    // Most recent last, so a tab that announces again moves to the end.
    pages.delete(event.source.id);
    pages.add(event.source.id);
  }
});
self.addEventListener('fetch', (event) => {
  // Another origin's request is left to the browser: a worker that re-fetches it changes its mode
  // and credentials, and a brand image from a CDN came back "Failed to fetch" (measured).
  if (new URL(event.request.url).origin !== (globalThis as unknown as { location: { origin: string } }).location.origin) return;
  event.respondWith(
    handle(event).catch(
      (error: unknown) =>
        new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
          status: 502,
          headers: { ...ISOLATION, 'Content-Type': 'application/json' },
        }),
    ),
  );
});
