/**
 * EDITS THAT TAKE EFFECT — a changed project module is compiled in the page and the game remounts.
 *
 * A view's modules are recorded at `view build`, so an edit made in the view (a person's, in the
 * workbench, or the agent's) used to change only the file's text. Three things make it run:
 *
 *  1. THIS PAGE KNOWS WHAT CHANGED. Every write to the project store (`project-store.ts`) after
 *     load is a change; reading a shipped file into memory is not.
 *  2. THE WORKER ASKS THE PAGE FIRST. For a project script module the service worker asks this
 *     page before its recording (`service-worker.ts`, `LIVE_MODULE_HEADER`). An unchanged file
 *     answers a miss and the recording is served as before; a changed one is compiled here
 *     (`live-compiler.ts`). The worker keeps nothing, so a restarted worker cannot serve a stale
 *     module.
 *  3. THE EDITOR IS TOLD, on the bus a session's Vite reports saves on
 *     (`@volter/editor-sdk/kit/project-module-changes`): Play remounts the script and its UI under
 *     a fresh mount, which imports every project module anew.
 *
 * A MODULE IMPORTED WITHOUT A MOUNT ID is kept by the browser under its URL for the life of the
 * page, and nothing a server answers later changes that. So an importer that asks for an entry
 * under an address it has used before keeps the copy it has; one that asks under a fresh address
 * gets the current file and, through it, current neighbours (`revision` below).
 *
 * Only the project's game modules are compiled: scripts under `src/` outside the editor's own
 * lanes (`src/contributions`, `src/tools`). Anything else keeps its recording.
 */

import type { SeededProjectStore } from './project-store';
import { isLiveModulePath, type LimitedViewConfig, type LimitedViewRoutes, VIEW_DIR } from './view-contract';

type Compiler = typeof import('./live-compiler');
type ChangeListener = (path: string, affected?: readonly string[], type?: 'create' | 'update' | 'delete') => void;

const ISOLATION: Record<string, string> = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const script = (body: string): Response =>
  new Response(body, { status: 200, headers: { ...ISOLATION, 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' } });

export interface LiveModules {
  /** The compiled module for `url` when its file changed in this page; null when the recording stands. */
  answer(url: URL): Promise<Response | null>;
  /** What stops `path` from compiling as it is now, or null. For whoever just wrote it. */
  check(path: string): Promise<string | null>;
}

export function createLiveModules(config: LimitedViewConfig, store: SeededProjectStore): LiveModules {
  const root = config.project.root.replaceAll('\\', '/').replace(/\/+$/, '');
  const fsPrefix = root.startsWith('/') ? `/@fs${root}/` : `/@fs/${root}/`;
  /** Paths written or removed since the page loaded. */
  const changed = new Set<string>();
  /** How many changes there have been: the stamp a module imported WITHOUT a mount id is told to
   *  import its neighbours by, so the browser does not hand back the copy it already holds. */
  let revision = 0;
  let compiler: Promise<Compiler> | null = null;
  let recorded: Promise<readonly string[]> | null = null;

  const load = (): Promise<Compiler> => {
    // A variable, so the bundler leaves the chunk as the view's own file.
    const chunk: string = `/${VIEW_DIR}/live-compiler.js`;
    return (compiler ??= import(/* @vite-ignore */ chunk) as Promise<Compiler>);
  };
  const recordedUrls = (): Promise<readonly string[]> =>
    (recorded ??= fetch(`/${VIEW_DIR}/routes.json`)
      .then((response) => response.json() as Promise<LimitedViewRoutes>)
      .then((routes) => Object.keys(routes.entries)));

  const compile = async (path: string, mountId: string | null): Promise<string> => {
    const [{ compileLiveModule }, urls] = await Promise.all([load(), recordedUrls()]);
    return compileLiveModule({ path, source: await store.read(path), mountId, revision, recorded: urls, exists: async (candidate) => (await store.stat(candidate))?.type === 'file' });
  };

  // Tell the editor once per burst of writes: an agent's turn, or a save of several files.
  let pending: { path: string; type: 'create' | 'update' | 'delete' } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const announce = (): void => {
    const last = pending;
    pending = null;
    if (!last) return;
    const bus = (globalThis as unknown as Record<symbol, { listeners?: Set<ChangeListener> } | undefined>)[Symbol.for('volter.project-module-changes')];
    if (!bus?.listeners) return;
    void store.allFiles('src').then((files) => {
      // Every game module may import the changed one, and a remount imports them all anew.
      const affected = files.map((file) => file.path).filter(isLiveModulePath);
      for (const listener of [...bus.listeners!]) listener(last.path, affected, last.type);
    });
  };
  store.watch((event) => {
    const path = event.path;
    if (!isLiveModulePath(path)) return;
    changed.add(path);
    revision += 1;
    pending = { path, type: event.type === 'remove' ? 'delete' : event.type === 'create' ? 'create' : 'update' };
    clearTimeout(timer);
    timer = setTimeout(announce, 300);
  });

  return {
    async answer(url) {
      const pathname = decodeURIComponent(url.pathname).replace(/^\/@fs\/+/, '/@fs/');
      const path = pathname.startsWith(fsPrefix) ? pathname.slice(fsPrefix.length) : pathname.slice(1);
      if (!isLiveModulePath(path)) return null;
      const mountId = url.searchParams.get('volter-mount');
      // Under a mount every module is imported anew, so only a changed file needs compiling and
      // the recording serves the rest. With NO mount id the browser keeps each module by its URL
      // for the life of the page: once anything has changed, every game module asked for this way
      // is compiled here, so that each imports its neighbours under the current revision and none
      // reaches a changed file through a copy the browser already holds.
      if (!changed.has(path) && (mountId !== null || revision === 0)) return null;
      try {
        if ((await store.stat(path))?.type !== 'file') throw new Error(`${path} was deleted, and something still imports it.`);
        return script(await compile(path, mountId));
      } catch (error) {
        // A module that fails in words, where the game's own error reporting shows it.
        return script(`throw new Error(${JSON.stringify(error instanceof Error ? error.message : String(error))});\n`);
      }
    },
    async check(path) {
      if (!isLiveModulePath(path) || (await store.stat(path))?.type !== 'file') return null;
      try {
        await compile(path, null);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  };
}
