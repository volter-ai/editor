/**
 * THE PROJECT-LOCAL SETTINGS LAYER — one in-memory document mirroring
 * `.vgai/editor-state.json`, the git-ignored file the scaffold already
 * reserves for "editor autosaved UI state" (ARCHITECTURE-CORE §Editor chrome,
 * "Settings have four layers with named homes").
 *
 * Every piece of per-user, per-checkout state — the workspace layouts, the
 * active workspace, the open documents, the view state the shell store
 * autosaves — is a SECTION of this one document, loaded ONCE when a project
 * becomes active and written back debounced through `saveEditorState`, the
 * editor server's own route. One document, one writer, so two sections can
 * never clobber each other through the whole-file route.
 *
 * Keyed by the folder itself: a rename, another browser or another checkout
 * of the same folder finds the same file. Browser storage keyed by an
 * absolute path was the previous home, and it lost a layout to exactly those
 * three moves (measured 2026-09-04).
 */

import { activeProjectKey, getCurrentProject, onProjectChange } from '@volter/editor-sdk/kit/active-project';
import { loadEditorState, saveEditorState } from '@volter/editor-sdk/kit/editor-api';
import { preloadSettings } from '@volter/editor-sdk/kit/settings-store';

type Sections = Record<string, unknown>;

const WRITE_DEBOUNCE_MS = 400;

let loadedFor: string | null = null;
let loading: Promise<void> | null = null;
let doc: Sections = {};
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function projectKey(): string {
  return activeProjectKey();
}

/**
 * Load the active project's local document, once per project. Idempotent and
 * memoized: the second caller for the same project joins the first load, and
 * a different project starts over. Callers that read synchronously through
 * {@link projectLocalSection} await this first.
 */
export function preloadProjectLocalState(): Promise<void> {
  const key = projectKey();
  if (loadedFor === key) return Promise.resolve();
  // A load in flight for ANOTHER project (the boot's unscoped one, or a
  // project switched away from mid-load) settles for that project; this
  // caller's project loads after it, never joins it.
  if (loading) return loading.then(() => preloadProjectLocalState());
  loading = Promise.all([loadEditorState(), preloadSettings()])
    .then(([state]) => {
      doc = state && typeof state === 'object' ? { ...state } : {};
      loadedFor = key;
    })
    .catch(() => {
      doc = {};
      loadedFor = key;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** True once the active project's document has loaded. */
export function projectLocalStateReady(): boolean {
  return loadedFor === projectKey();
}

/** One section of the loaded document, or `undefined` before load or when
 *  the project has never written it. Synchronous by design: the boot awaits
 *  {@link preloadProjectLocalState} before anything reads. */
export function projectLocalSection<T>(name: string): T | undefined {
  if (!projectLocalStateReady()) return undefined;
  return doc[name] as T | undefined;
}

function flush(leaving = false): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty) return;
  dirty = false;
  void saveEditorState(doc, { leaving });
}

/** Replace one section and schedule the write. A write before the load has
 *  settled is applied on top of what loads, so a fast first edit is kept. */
export function writeProjectLocalSection(name: string, value: unknown): void {
  const apply = () => {
    doc = { ...doc, [name]: value };
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, WRITE_DEBOUNCE_MS);
  };
  if (projectLocalStateReady()) apply();
  else void preloadProjectLocalState().then(apply);
}

/** Write what is pending NOW — the page is leaving. */
export function flushProjectLocalState(): void {
  flush(true);
}

// The layer loads the moment a project becomes active, so the dock that
// mounts next reads its layout from the folder, not defaults. This module is
// imported by the shell's boot (`EditorContext`), which is what makes the
// subscription exist before the first project activates; `active-project.ts`
// imports nothing of it, so a bounded host's closure stays as it was.
onProjectChange(() => {
  if (getCurrentProject()) void preloadProjectLocalState();
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushProjectLocalState);
}
