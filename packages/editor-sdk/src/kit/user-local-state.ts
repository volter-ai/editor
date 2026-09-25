/**
 * THE PERSON'S OWN UI STATE — one in-memory document mirroring `~/.vgai/editor-state.json`
 * (`GET/POST /__editor/user-state`), the per-user sibling of a project's
 * `.vgai/editor-state.json` (`@volter/editor-core` `project-local-state.ts`): what this
 * person's editor remembers in every project, as named sections, loaded once at boot.
 *
 * Browser storage cannot hold it. Every project and worktree is served on its own port
 * (`@volter/editor-core` `server/launcher/project-editor-port.ts`), so on its own origin, and a
 * preference kept in `localStorage` starts over in each; the project-local layer left browser
 * storage for the same kind of loss. Reads are synchronous: the boot awaits
 * {@link preloadUserLocalState} before the editor mounts, and a section read before then is
 * `undefined`.
 *
 * WRITES SEND ONLY THE SECTIONS THEY CHANGED, and the server merges them into the file.
 * Every open project runs its own editor session over this one file: a session that wrote its
 * whole document would erase what another session saved since it loaded.
 *
 * A guest in someone else's shared session keeps none: the host's file is the host's
 * (`/__editor/user-state` is never shared), so a guest's page neither reads nor writes it.
 */
import { BASE } from './api-base';
import { COLLABORATION_REMOTE_SHARE } from './editor-session-attribution';
import { assertEditorServerResponse, editorServerJson } from './editor-server-response';

const WRITE_DEBOUNCE_MS = 400;
const ROUTE = `${BASE}/user-state`;

let doc: Record<string, unknown> = {};
let loaded = false;
let loading: Promise<void> | null = null;
const changed = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let reportedWriteFailure = false;

/** Load the person's document once; later callers join the first load. */
export function preloadUserLocalState(): Promise<void> {
  if (loaded || COLLABORATION_REMOTE_SHARE) return Promise.resolve();
  loading ??= fetch(ROUTE)
    .then((response) => editorServerJson<Record<string, unknown>>(response, 'Could not read user state'))
    .then((state) => {
      // A write made before the load settled is kept on top of what loaded.
      doc = { ...(state && typeof state === 'object' ? state : {}), ...doc };
    })
    .catch(() => {})
    .finally(() => {
      loaded = true;
      loading = null;
    });
  return loading;
}

/** Whether the person's document has loaded (or there is none to load, for a guest). */
export function userLocalStateLoaded(): boolean {
  return loaded || COLLABORATION_REMOTE_SHARE;
}

/** One section, or `undefined` before the load or when never written. */
export function userLocalSection<T>(name: string): T | undefined {
  return doc[name] as T | undefined;
}

/**
 * POST a JSON body, kept alive past the page when the page is `leaving`. The browser keeps alive
 * only 64 KiB of request bodies at once, in bytes, shared by every such request the page has in
 * flight (the project's state and this one leave together): each takes at most a 32 KiB share,
 * and a send the browser refuses to keep alive is sent again as an ordinary request.
 */
export function postJson(url: string, body: string, leaving: boolean): Promise<Response> {
  const send = (keepalive: boolean) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive });
  const keepalive = leaving && new TextEncoder().encode(body).length <= 32 * 1024;
  return keepalive ? send(true).catch(() => send(false)) : send(false);
}

/** Send the changed sections. `leaving`: the page is going away, so the request must outlive it. */
function flush(leaving = false): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (changed.size === 0) return;
  const patch = Object.fromEntries([...changed].map((name) => [name, doc[name]]));
  changed.clear();
  void postJson(ROUTE, JSON.stringify(patch), leaving)
    .then((response) => assertEditorServerResponse(response, 'Could not save user state'))
    .catch((cause: unknown) => {
      if (reportedWriteFailure) return;
      reportedWriteFailure = true;
      // biome-ignore lint/suspicious/noConsole: the editor console captures console.error session-wide; this is the report channel.
      console.error(cause instanceof Error ? cause.message : String(cause));
    });
}

/** Replace one section and schedule its write. */
export function writeUserLocalSection(name: string, value: unknown): void {
  doc = { ...doc, [name]: value };
  if (COLLABORATION_REMOTE_SHARE) return;
  changed.add(name);
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(flush, WRITE_DEBOUNCE_MS);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true));
}
