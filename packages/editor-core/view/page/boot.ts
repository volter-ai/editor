/**
 * THE LIMITED VIEW'S PAGE — what `index.html` runs before the workbench exists.
 *
 *  1. Reads what this view is (`__view/view.json`) and which files the project has
 *     (`__view/files.json`).
 *  2. Registers the view's service worker and waits until it controls this page, then until the
 *     page is cross-origin isolated (Blender's threads need `SharedArrayBuffer`): a host that sent
 *     the headers itself is isolated on the first load, any other is after one reload through the
 *     worker.
 *  3. Holds the project's files (`project-store.ts`) and answers every request the worker hands
 *     it (`router.ts`, plus each integration's `volter.viewServing` routes).
 *  4. Publishes the store for the workbench's `volter-view:` folder
 *     (`view/workbench/src/volterView.contribution.ts`) and boots the Code-OSS web workbench on it.
 *
 * From there the kit runs exactly as it does over a session: the page origin answers
 * `/__editor/served-modules`, so it is the session origin (`volterSessionOrigin.ts`), and the
 * editor imports the product's frame entry from this view. Nothing asks which surface it is on.
 *
 * `view build` bundles this with a generated entry that passes the composed integrations'
 * `volter.viewServing` modules to {@link startLimitedView}.
 */

import type { ViewServingModule } from '@volter/editor-sdk/session/limited-view';
import { createLiveModules } from './live-modules';
import { SeededProjectStore } from './project-store';
import { createLimitedViewRouter, viewServingServices } from './router';
import type { ForwardedRequest, ForwardedResponse } from './service-worker';
import {
  HOST_PREFIXES,
  type LimitedViewConfig,
  type LimitedViewProjectIndex,
  SERVICE_WORKER_FILE,
  VIEW_DIR,
  WORKBENCH_DIR,
} from './view-contract';

/** The workbench's own scheme for the project folder, spelled again in `volterView.contribution.ts`. */
const VOLTER_VIEW_SCHEME = 'volter-view';
const RELOAD_FLAG = 'volter-limited-view-reloaded';

interface WorkbenchModule {
  create(element: HTMLElement, options: Record<string, unknown>): unknown;
  URI: { from(components: { scheme: string; path: string }): unknown };
}

function say(message: string): void {
  const notice = document.getElementById('volter-view-status');
  if (notice) notice.textContent = message;
}

/** One reload, never a loop: a host that can neither send the headers nor let the worker add
 *  them still opens, just without Blender's threads. */
function reloadOnce(why: string): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === why) return false;
    sessionStorage.setItem(RELOAD_FLAG, why);
  } catch {
    return false;
  }
  location.reload();
  return true;
}

async function controlledByWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) throw new Error('This browser has no service workers, and a limited view runs on one.');
  await navigator.serviceWorker.register(`/${SERVICE_WORKER_FILE}`, { scope: '/' });
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return true;
  // The worker claims open pages on activation; give that a moment before reloading into it.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
  return navigator.serviceWorker.controller !== null;
}

/** Same-origin `/__editor/` sockets never open: the session's control channel and heartbeat
 *  (`src/tab-bootstrap.js`) have nobody to talk to. A socket that stays CONNECTING is that
 *  answer without a failed connection logged every few seconds. */
function installQuietSessionSockets(): void {
  const Native = window.WebSocket;
  const quiet = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const target = new URL(String(url), location.href);
    if (target.host === location.host && target.pathname.startsWith('/__editor/')) {
      const socket = new EventTarget() as EventTarget & Record<string, unknown>;
      Object.assign(socket, {
        url: target.href, readyState: 0, protocol: '', extensions: '', bufferedAmount: 0, binaryType: 'blob',
        onopen: null, onclose: null, onerror: null, onmessage: null,
        send() {}, close() { (socket as Record<string, unknown>)['readyState'] = 3; },
        CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
      });
      return socket;
    }
    return protocols === undefined ? new Native(url) : new Native(url, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(quiet, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, prototype: Native.prototype });
  window.WebSocket = quiet;
}

/**
 * Project code's `fetch` does not reach the host's own routes (`/api/`, `/auth/`): a game has no
 * business with the person's account, and a module written in the view (by the person or the
 * agent) runs in this page with that account's session. The game-globals prelude routes every
 * project module's `fetch` through this hook (`@volter/editor-sdk/kit/game-globals-prelude`).
 *
 * DEFENCE IN DEPTH, NOT A SANDBOX: project code is JavaScript in this origin and can find other
 * ways to make a request. What bounds those is the host, and a content security policy if it
 * sends one.
 */
function installProjectFetch(): void {
  (globalThis as Record<string, unknown>)['__volterProjectFetch'] = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (target.origin === location.origin && HOST_PREFIXES.some((prefix) => target.pathname.startsWith(prefix))) {
      return Promise.reject(new TypeError(`Project code cannot call ${target.pathname}: it belongs to the site that hosts this view.`));
    }
    return fetch(input, init);
  };
}

/**
 * WebRTC is the one way out of a page that a content security policy does not govern: a peer
 * connection can carry text to any address. Nothing in a view uses it, so its constructors are
 * taken off this window before any project code runs.
 *
 * BEST EFFORT, and said so: a script can make a new same-origin frame and find them on that
 * frame's window. It raises the cost of the ordinary case; it is not a boundary.
 */
function removeWebRtc(): void {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate', 'RTCRtpSender', 'RTCRtpReceiver']) {
    try {
      Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
    } catch {
      /* already fixed in place by the browser: left as it is */
    }
  }
}

export async function startLimitedView(integrations: readonly ViewServingModule[]): Promise<void> {
  say('Starting the limited view…');
  if (!(await controlledByWorker())) {
    if (reloadOnce('worker')) return;
    throw new Error('The limited view\'s service worker did not take control of this page.');
  }
  if (!crossOriginIsolated && reloadOnce('isolation')) return;

  const [config, index] = await Promise.all([
    fetch(`/${VIEW_DIR}/view.json`).then((response) => response.json() as Promise<LimitedViewConfig>),
    fetch(`/${VIEW_DIR}/files.json`).then((response) => response.json() as Promise<LimitedViewProjectIndex>),
  ]);
  document.title = `${config.project.name} — ${config.product.displayName} (limited view)`;

  const store = new SeededProjectStore(index.files, '/');
  const services = viewServingServices(config, store);
  const router = createLimitedViewRouter({
    config,
    store,
    liveModules: createLiveModules(config, store),
    integrations: integrations.flatMap((module) => module.viewRoutes(services)),
  });

  // This tab holds the project: it says so on start, whenever it comes back into view or focus,
  // and whenever the worker asks (a restarted worker remembers nothing).
  const announce = () => navigator.serviceWorker.controller?.postMessage({ type: 'volter-view:page-ready' });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') announce();
  });
  window.addEventListener('focus', announce);
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === 'volter-view:announce') {
      announce();
      return;
    }
    const request = event.data as ForwardedRequest | null;
    const port = event.ports[0];
    if (request?.type !== 'volter-view:request' || !port) return;
    void (async () => {
      let reply: ForwardedResponse;
      try {
        const response = await router(new Request(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body ? { body: request.body } : {}),
        }));
        const body = request.method === 'HEAD' || response.status === 204 ? null : await response.arrayBuffer();
        reply = { status: response.status, headers: [...response.headers], body };
      } catch (error) {
        const body = new TextEncoder().encode(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })).buffer;
        reply = { status: 500, headers: [['Content-Type', 'application/json']], body };
      }
      port.postMessage(reply, reply.body ? [reply.body] : []);
    })();
  });
  navigator.serviceWorker.startMessages();
  announce();

  // The brand mark from this view's own files (`brandLogoUrl` in the SDK reads this).
  if (config.product.logo) (globalThis as Record<string, unknown>)['__volterBrandLogo'] = config.product.logo;
  installQuietSessionSockets();
  installProjectFetch();
  removeWebRtc();
  (globalThis as Record<string, unknown>)['__volterLimitedView'] = { files: store, folder: config.project.name };

  say('Opening the workbench…');
  // A variable, so no bundler tries to resolve the workbench: it is the static host's file.
  const workbenchEntry: string = `/${WORKBENCH_DIR}/out/vs/workbench/workbench.web.main.internal.js`;
  const workbench = (await import(/* @vite-ignore */ workbenchEntry)) as WorkbenchModule;
  document.getElementById('volter-view-status')?.remove();
  workbench.create(document.body, {
    workspaceProvider: {
      workspace: { folderUri: workbench.URI.from({ scheme: VOLTER_VIEW_SCHEME, path: `/${config.project.name}` }) },
      trusted: true,
      open: async () => false,
    },
    // The project's own workbench state (`.volter/workbench-storage.json`), served by the router
    // from memory: the view opens with the layout the project was saved with.
    workspaceStorageUrl: '/__editor/workbench-storage',
    enableWorkspaceTrust: false,
    initialColorTheme: { themeType: config.product.colorTheme },
    windowIndicator: {
      label: '$(eye) Limited view',
      tooltip: `A limited view of ${config.project.name}. It works on this tab's copy of the project; saving and git are in the local editor: ${config.product.install}`,
    },
    // Code-OSS's chat tips advertise agent features this view's chat cannot run.
    // A view reaches no origin but its own (its host may send a content security policy saying
    // so): the workbench's features that fetch from elsewhere are off rather than left to fail
    // loudly. The web build has no extensions gallery at all (`scripts/workbench/overlay.mjs`).
    configurationDefaults: {
      'workbench.startupEditor': 'none',
      'chat.tips.enabled': false,
      // Type acquisition, by each of the three names the fork's TypeScript extension declares at
      // its pin (the web one is what a view's extension host reads).
      'typescript.disableAutomaticTypeAcquisition': true,
      'typescript.tsserver.web.typeAcquisition.enabled': false,
      'js/ts.tsserver.automaticTypeAcquisition.enabled': false,
      'json.schemaDownload.enable': false,
      // The npm extension looks packages up on the registry when a package.json is hovered.
      'npm.fetchOnlinePackageInfo': false,
      'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false,
      'extensions.ignoreRecommendations': true,
    },
  });
}
