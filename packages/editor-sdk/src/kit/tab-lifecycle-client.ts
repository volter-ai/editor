/**
 * Client half of the tab bijection (server: server/tab-lifecycle.ts) — the
 * page-lifetime handlers for the tab-maintenance SSE events. The inline boot
 * queues these events from the moment it creates the shared EventSource;
 * editor-presence.ts installs these typed handlers and replays that queue.
 *
 * - `tab-refocus` — this is the session's one blessed tab: focus it, and
 *   navigate only if the server says the URL should change.
 * - `tab-yield` — another tab is blessed. Try `window.close()` (script/CLI
 *   opened tabs with a single history entry close); otherwise leave the app
 *   for the server's static "open in another tab — Use here instead" page.
 *   Navigation tears the whole editor app down, so the editor never RUNS in
 *   two tabs for one session.
 * - `tab-close` — the session ended. Run every terminator, TELL THE SERVER
 *   they ran, then try to close; a user-opened tab that refuses shows a
 *   minimal inline "session ended" state instead (the server is exiting, so
 *   there is no page left to navigate to).
 * - `tab-adopt` — this tab is the session's one tab but it is showing the
 *   launcher/startup-failure surface. Focus it and re-run project detection
 *   so it lands on the project the server serves, instead of the server
 *   opening a SECOND tab beside it. The app registers the handler
 *   (`onTabAdopt`, AppRoot); with none registered — the yield page, or a
 *   teardown window — a reload is the same convergence by a blunter route.
 */

import { editorDocumentTitle, editorMarkImg } from '@volter/editor-sdk/session/editor-brand';
import { markSessionEnded } from './session-tombstone';
import { workspaceStorageProvider } from './workspace-storage';

/** How long `window.close()` gets to take effect before the fallback runs. */
const CLOSE_FALLBACK_DELAY_MS = 300;

function closeOrFallback(fallback: () => void): void {
  window.close();
  // If close() was refused (user-opened tab), the timer still runs.
  window.setTimeout(fallback, CLOSE_FALLBACK_DELAY_MS);
}

function handleRefocus(event: MessageEvent): void {
  try {
    window.focus();
    const data = JSON.parse(event.data as string) as { url?: unknown };
    if (typeof data.url !== 'string') return;
    const target = new URL(data.url, window.location.href);
    if (
      target.origin === window.location.origin &&
      target.pathname + target.search !== window.location.pathname + window.location.search
    ) {
      window.location.assign(target.href);
    }
  } catch {
    /* a malformed maintenance event must never break the editor */
  }
}

function handleYield(base: string, event: MessageEvent): void {
  let participantId: string | null = null;
  try {
    const data = JSON.parse(event.data as string) as { participantId?: unknown };
    if (typeof data.participantId === 'string') participantId = data.participantId;
  } catch {
    // The unscoped legacy route remains a safe fallback.
  }
  closeOrFallback(() => {
    const query = participantId ? `?participantId=${encodeURIComponent(participantId)}` : '';
    window.location.replace(`${base}/tab-yielded${query}`);
  });
}

// Session end now reaches EVERY connected tab, not just the blessed one (an
// extra tab that only learned of the shutdown by its socket dying fell
// through to the generic "Editor disconnected" overlay). A tab can therefore
// see more than one `tab-close`; acting twice would re-run `window.close()`
// and repaint the notice under itself.
let sessionEndHandled = false;

/** How long the end waits for the project's workspace state to reach its folder: well inside
 *  the server's own two-second wait for the acknowledgement below. */
const WORKSPACE_FLUSH_BUDGET_MS = 1_200;

/** The workbench's pending state, written to the project's folder before the page says it is
 *  done: once acknowledged, the server stops listening, and a write left for the page's unload
 *  arrives at nothing (measured: a panel hidden a second before `close` reopened shown). */
function persistWorkspaceState(): Promise<void> {
  const provider = workspaceStorageProvider();
  if (!provider) return Promise.resolve();
  let flushed: Promise<void>;
  try {
    flushed = provider.flush().catch(() => {});
  } catch {
    // A flush that cannot start must not cost the acknowledgement.
    flushed = Promise.resolve();
  }
  return Promise.race([
    flushed,
    new Promise<void>((resolve) => setTimeout(resolve, WORKSPACE_FLUSH_BUDGET_MS)),
  ]);
}

/**
 * THE PAGE'S ACKNOWLEDGEMENT — "I got `tab-close`, and everything it turns off
 * is already off."
 *
 * The same beacon route and the same transport as index.html's `pagehide`
 * goodbye (`server/tab-presence.ts`'s `TabCloseBeacon`), with `reason` telling
 * the two apart; `sendBeacon` and not `fetch` because `window.close()` runs a
 * line later and this must survive the document going away.
 *
 * Sent AFTER `markSessionEnded` returns, never before: its listeners run
 * synchronously, so by the time it comes back every terminator — the Blender
 * engine worker's included — has run, and that is precisely what this sentence
 * claims. Sending it first would make it a lie the server then waits on.
 */
function acknowledgeSessionEnd(base: string, identity: TabIdentity): void {
  if (identity.tabId === undefined || identity.epoch === undefined) return;
  try {
    navigator.sendBeacon?.(
      `${base}/tab/close`,
      new Blob(
        [
          JSON.stringify({
            tabId: identity.tabId,
            epoch: identity.epoch,
            persisted: false,
            reason: 'session-ended',
          }),
        ],
        { type: 'application/json' },
      ),
    );
  } catch {
    /* an ack that cannot be sent degrades to the unacked line the server
       journals — which is the truth about this page either way */
  }
}

function handleSessionEnded(base: string, identity: TabIdentity): void {
  if (sessionEndHandled) return;
  sessionEndHandled = true;
  // The latch FIRST, and unconditionally: `window.close()` is refused for a
  // user-opened tab, so the page below may well keep running. Everything that
  // would let it go on impersonating a live editor reads this
  // (`session-tombstone.ts`).
  markSessionEnded('session-closed');
  void persistWorkspaceState().then(() => {
    acknowledgeSessionEnd(base, identity);
    closeOrFallback(() => {
      document.title = editorDocumentTitle('Session ended');
      document.body.innerHTML = `<style>
        :root{color-scheme:dark;background:#101318;color:#e8edf3;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
        body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 30%,#1c2a3a 0,#101318 52%,#0b0e13 100%)}
        main{width:min(440px,100%);box-sizing:border-box;padding:34px;text-align:center;border:1px solid rgba(255,255,255,.1);border-radius:20px;background:rgba(23,28,35,.92);box-shadow:0 22px 60px rgba(0,0,0,.38)}
        .brand-mark{width:68px;height:68px;margin:0 auto 20px}.brand-mark img{display:block;width:100%;height:100%}h1{margin:0 0 10px;font-size:22px}p{margin:0;color:#aeb9c6;font-size:14px;line-height:1.6}
      </style><main><div class="brand-mark">${editorMarkImg()}</div><h1>Session ended</h1><p>This editor session has ended. You can close this tab.</p></main>`;
    });
  });
}

/**
 * Which surface this tab is showing, as the server's tab bijection accounts
 * for it (`POST /__editor/tab/route`; server vocabulary:
 * server/tab-lifecycle.ts `TabRoute`). `'no-project'` covers BOTH the
 * launcher and the startup-failure surface — from the bijection's side they
 * are the same fact: a live tab that is not on the served project and can be
 * adopted into it.
 */
export type EditorTabRoute = 'project' | 'no-project';

const adoptHandlers = new Set<() => void>();

/**
 * Register the app's response to `tab-adopt` (AppRoot: re-run detection).
 * Returns an unsubscribe. Kept as a registry rather than an import from the
 * component so this module stays free of React and of the editor's graph.
 */
export function onTabAdopt(handler: () => void): () => void {
  adoptHandlers.add(handler);
  return () => {
    adoptHandlers.delete(handler);
  };
}

function handleAdopt(): void {
  try {
    window.focus();
  } catch {
    /* focus is a nicety; adoption is the point */
  }
  if (adoptHandlers.size === 0) {
    window.location.reload();
    return;
  }
  for (const handler of [...adoptHandlers]) handler();
}

/**
 * This tab's identity as the inline bootstrap minted it — passed in rather
 * than read here, because `editor-presence.ts` owns the one read of
 * `__VGAI_EDITOR_PRESENCE_BOOTSTRAP__` and a second reader would be a second
 * opinion about who this tab is. Both fields are absent wherever there is no
 * inline bootstrap at all (browser-mode builds, jsdom): such a page is not in
 * the server's tab table and has nothing to acknowledge with.
 */
export interface TabIdentity {
  readonly tabId?: string | undefined;
  readonly epoch?: string | undefined;
}

/**
 * Install the tab-maintenance listeners on the (one) real EventSource.
 * `base` is the editor API prefix (`/__editor`).
 */
export function installTabLifecycleListeners(
  source: Pick<EventSource, 'addEventListener'>,
  base: string,
  identity: TabIdentity = {},
): void {
  source.addEventListener('tab-refocus', (event) => handleRefocus(event as MessageEvent));
  source.addEventListener('tab-yield', (event) => handleYield(base, event as MessageEvent));
  source.addEventListener('tab-close', () => handleSessionEnded(base, identity));
  source.addEventListener('tab-adopt', () => handleAdopt());
}
