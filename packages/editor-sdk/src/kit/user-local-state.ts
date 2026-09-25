/**
 * THE PERSON'S OWN UI STATE — one in-memory document mirroring `~/.vgai/editor-state.json`
 * (`GET/POST /__editor/user-state`), the per-user sibling of a project's
 * `.vgai/editor-state.json` (`project-local-state.ts`): what this person's editor remembers in
 * every project, as named sections, loaded once at boot and written back debounced.
 *
 * Browser storage cannot hold it. Every project and worktree is served on its own port
 * (`@volter/editor-core` `server/launcher/project-editor-port.ts`), so on its own origin, and a preference kept in
 * `localStorage` starts over in each; the project-local layer left browser storage for the
 * same kind of loss. Reads are synchronous: the boot awaits {@link preloadUserLocalState}
 * before the editor mounts, and a section read before then is `undefined`.
 */
import { BASE } from './api-base';
import { assertEditorServerResponse, editorServerJson } from './editor-server-response';

const WRITE_DEBOUNCE_MS = 400;
const ROUTE = `${BASE}/user-state`;

let doc: Record<string, unknown> = {};
let loaded = false;
let loading: Promise<void> | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let reportedWriteFailure = false;

/** Load the person's document once; later callers join the first load. */
export function preloadUserLocalState(): Promise<void> {
  if (loaded) return Promise.resolve();
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

/** One section, or `undefined` before the load or when never written. */
export function userLocalSection<T>(name: string): T | undefined {
  return doc[name] as T | undefined;
}

function flush(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty) return;
  dirty = false;
  void fetch(ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) })
    .then((response) => assertEditorServerResponse(response, 'Could not save user state'))
    .catch((cause: unknown) => {
      if (reportedWriteFailure) return;
      reportedWriteFailure = true;
      // biome-ignore lint/suspicious/noConsole: the editor console captures console.error session-wide; this is the report channel.
      console.error(cause instanceof Error ? cause.message : String(cause));
    });
}

/** Replace one section and schedule the write. */
export function writeUserLocalSection(name: string, value: unknown): void {
  doc = { ...doc, [name]: value };
  dirty = true;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(flush, WRITE_DEBOUNCE_MS);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
}
