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
import { SeededProjectStore } from './project-store';
import { createLimitedViewRouter, viewServingServices } from './router';
import type { ForwardedRequest, ForwardedResponse } from './service-worker';
import {
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
    integrations: integrations.flatMap((module) => module.viewRoutes(services)),
  });

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
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
  navigator.serviceWorker.controller?.postMessage({ type: 'volter-view:page-ready' });

  installQuietSessionSockets();
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
      tooltip: `A limited view of ${config.project.name}. Chat, git and code changes run in the local editor: ${config.product.install}`,
    },
    configurationDefaults: { 'workbench.startupEditor': 'none' },
  });
}
