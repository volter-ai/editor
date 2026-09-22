/**
 * The ONE owner of every dev-server import URL the editor builds for a
 * PROJECT-OWNED module (a root's `entry`, a `{ module }` adapter's module).
 *
 * WHY THIS MODULE EXISTS: PD-3, a SILENT CROSS-ROOT MODULE SPLIT
 * -------------------------------------------------------------
 * A vgai project declares several adapter roots, and two of them routinely
 * import the SAME project module (the worked reference is a three root
 * writing `arena-state.ts`'s module-level `let snapshot` each frame while a
 * `dom` root's HUD reads it). Browser ES-module identity is per-URL, so the
 * whole model only works while every root resolves that shared module to the
 * BYTE-IDENTICAL url. Measured mechanism (vite 6.4.1, reproduced with a real
 * dev server — see the PR body's probe):
 *
 *  1. The three root's entry was imported with a monotonic cache-buster
 *     (`?vgai-play=<n>`) so a remount re-runs edited code. Every mount is
 *     therefore a url the browser has never fetched → a fresh transform.
 *  2. The `dom` root's entry was imported at a BARE url with no buster at
 *     all. A remount re-issues the identical string, so `import()` resolves
 *     straight out of the browser's module registry — the dom root keeps the
 *     module graph of whatever mount FIRST evaluated it.
 *  3. Editing a shared module HMR-invalidates it, and vite's import-analysis
 *     then appends `?t=<ts>` to it for every importer it re-transforms. So
 *     after the very first edit, the freshly-transformed three entry imports
 *     `…/arena-state.ts?t=T` while the cached dom entry still holds
 *     `…/arena-state.ts` — two urls, two evaluated instances, two copies of
 *     `let snapshot`. Nothing errors: the HUD reads its own copy's defaults
 *     forever while `game.state()` reports the three root's live one.
 *
 * THE GUARANTEE this module exists to make: every root entry of ONE mount is
 * imported with the SAME mount-scoped buster, so all roots are transformed
 * together and vite hands every one of them the same current `?t=` for every
 * shared dep. `beginProjectMountEpoch()` is called once per composition
 * resolve (`binding-resolver.ts`'s `resolveAllRootAdapters`); every entry url
 * built for that mount reads the same epoch.
 *
 * Do not hand-build a `/@fs/…` url for a project entry anywhere else —
 * `packages/editor/test/project-module-url-single-owner.test.ts` is the
 * tripwire. The runtime backstop for whatever this misses is
 * `project-module-split.ts`, which reports a split LOUDLY instead of letting
 * the next one be silent again.
 */

/**
 * Build a `/@fs/<absolute path>` dev-server import URL WITHOUT a doubled
 * leading slash (T6.2 slice 3 finding — see the "Report back" of that
 * slice's dispatch). `projectRoot` is always an absolute path (it starts
 * with `/`), so the naive `` `/@fs/${projectRoot}/...` `` template produces
 * `/@fs//abs/olute/path/...` — cosmetically harmless on its own (Vite's
 * `/@fs/` middleware tolerates it), UNTIL the SAME file is also reached via
 * a DIFFERENT route: a react world's entry module's own STATIC relative
 * import (e.g. `import { useWorldState } from './src/ui/game-
 * state'`) is rewritten by Vite's normal resolver into a SINGLE-slash,
 * symlink-canonicalized `/@fs/` URL — a textually different string than
 * this file's hand-built double-slash one. Browser ES module identity is
 * per-URL, so the two builds of `/@fs/` string for the SAME file produced
 * TWO SEPARATE module instances (two `createContext()` calls for
 * `game-state.tsx`), and `useWorldState`'s `useGame()` threw "no Game in
 * context" even though `<WorldProvider>` genuinely wrapped the entry — this
 * is what `resolveDefaultReactAdapter`'s AC e2e (T6.2 slice 3) caught. The
 * server-side half of this fix is `canonical-path.ts` (canonicalizes
 * `projectRoot` itself so it agrees with Vite's own symlink-resolved form);
 * this half removes the remaining single/double-slash divergence so the
 * two strings are BYTE-IDENTICAL once `projectRoot` is canonical.
 *
 * Lives in a module of its own rather than beside the root resolver so every
 * lane that needs a project import url — the realm's `/@fs` loader, the
 * `{ module }` route, the ingest descriptors — reaches ONE owner without an
 * import cycle. Before that, the three/pixi entry route hand-built a
 * doubled-slash form of its own, which is precisely how one shared module came
 * to be served twice under two urls.
 */
export function fsImportPath(projectRoot: string, relativePath: string): string {
  const root = projectRoot.endsWith('/') ? projectRoot.slice(0, -1) : projectRoot;
  const rel = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  // Windows canonical roots ('C:/…') carry no leading slash of their own —
  // without inserting one the URL degenerates to '/@fsC:/…', which Vite
  // serves as a 404. POSIX roots keep the concat form (root already starts
  // with '/'), preserving the byte-identical contract described above.
  return root.startsWith('/') ? `/@fs${root}/${rel}` : `/@fs/${root}/${rel}`;
}

/** Reuse Vite's exact update URL to verify evaluation without a second module
 * instance. Vite emits afterUpdate even when importing the update failed.
 */
export function viteUpdateImportPath(
  update: {
    acceptedPath: string;
    timestamp: number;
    explicitImportRequired?: boolean;
  },
  base = '/',
): string {
  const [file, query] = update.acceptedPath.split('?');
  return (
    base +
    file!.slice(1) +
    `?${update.explicitImportRequired ? 'import&' : ''}t=${update.timestamp}${query ? `&${query}` : ''}`
  );
}

/** The query key every project ENTRY url carries. One name for every root's
 *  entry (it replaced the per-caller `?vgai-play=` / `?vgai-reload=` names,
 *  whose divergence was never meaningful and whose ABSENCE on the react route
 *  was PD-3 itself). */
export const PROJECT_MOUNT_QUERY = 'vgai-mount';

/**
 * The INGEST remount buster — deliberately NOT {@link PROJECT_MOUNT_QUERY}.
 *
 * `vgai-mount` is the whole mount-instance machinery: the server rewrites the
 * module's relative specifiers to carry the same stamp (a per-mount subgraph)
 * and the gated-globals prelude keys the GAME REALM by its value. An ingest
 * remount wants exactly one of those effects — a fresh evaluation of the
 * entry, so its top-level boot re-runs — and none of the others: the ingest
 * lane's readers (the contract shim's `window.vgaiGame`, the live plane, the
 * evidence surface) all read the DEFAULT realm. Busting the ingest entry with
 * `vgai-mount` moved the shim's assignment into a per-epoch realm nobody
 * reads: the game played while `vgai status` said "idle — commands/providers
 * enumerate while playing" and the doctor read "declares no game-state
 * providers" — measured on racing-game, 2026-08-22. A key the server does not
 * interpret busts the URL and changes nothing else.
 */
export const INGEST_REMOUNT_QUERY = 'vgai-ingest-remount';

/**
 * Optional play remount: serve this entry with its swap-slot const rewritten
 * to `key`. Only the targeted region's entry carries these — siblings keep
 * the shared `?vgai-mount=` so PD-3 still holds. Kept in sync with the
 * server plugin's literals by `project-module-instance.test.ts`.
 */
export const PROJECT_SELECTION_QUERY = 'vgai-selection';
export const PROJECT_SCENE_QUERY = 'vgai-scene';

/** Isolation imports a screen CLASS. The matching server key is
 *  `ISOLATE_QUERY_KEY` — tripwired in `project-module-instance.test.ts`. */
export const PROJECT_ISOLATE_QUERY = 'vgai-isolate';

/** Host-owned mount parameter: remount the entrypoint at a declared table key. */
export interface EntrypointSelectionOverride {
  readonly selection: string;
  readonly key: string;
}

let lastMountEpoch = 0;

/**
 * A mount generation. Opaque on purpose: callers thread it, never construct or
 * arithmetic it.
 *
 * It is also the INSTANCE IDENTITY for multi-instance authoring — two mounts
 * at different epochs import every project module at different urls, and
 * browser module identity is per-url, so their module graphs are genuinely
 * separate (separate `let`s, separate class identities). See
 * ARCHITECTURE-CORE §Observability "N INSTANCES of one project". That is the
 * PD-3 guarantee read the other way round: same epoch ⇒ shared modules,
 * different epoch ⇒ nothing shared.
 */
export type ProjectMountEpoch = number;

/**
 * Open a new mount generation. Called ONCE per composition resolve, before any
 * root's entry is imported, so every root of that mount shares one buster (the
 * guarantee in this module's header). Monotonic, so a remount always
 * re-transforms every entry and therefore re-runs edited code.
 *
 * The returned epoch is THREADED to every url built for this mount. It is
 * deliberately not readable from ambient state: a module-level "current epoch"
 * makes isolation SEQUENTIAL — two concurrent resolves interleave their
 * `begin` calls and each then builds urls with the other's generation, so the
 * mounts silently share module instances. Passing the value is what makes N
 * concurrent instances expressible at all.
 */
export function beginProjectMountEpoch(): ProjectMountEpoch {
  lastMountEpoch += 1;
  return lastMountEpoch;
}

/**
 * The dev-server import url for one root's `entry` (or a `{ module }`
 * adapter's module) — `fsImportPath` plus the mount's own epoch. Two roots
 * resolved in the SAME mount pass the same epoch and therefore get the same
 * query, which is the whole point.
 */
/**
 * Import a scene CLASS as an Edit piece. The isolate query keys a module
 * graph whose vendor `init();` is silenced — Play still boots the unstamped
 * entry. Cache-busted per mount, same always-fresh discipline as design-time
 * CSF (`stories/story-discovery.ts`).
 */
export function isolationImportUrl(projectRoot: string, relativePath: string): string {
  return `${fsImportPath(projectRoot, relativePath)}?${PROJECT_ISOLATE_QUERY}=1&t=${Date.now()}`;
}

/**
 * The LIVE MODULE document's import url — a project `.ts`/`.tsx` module opened
 * as an Asset Lab document that re-executes on every save
 * (`components/asset-viewers/LiveModuleDocument.tsx`).
 *
 * Deliberately NOT {@link PROJECT_MOUNT_QUERY}, for the reason
 * {@link INGEST_REMOUNT_QUERY} states: `vgai-mount` is the whole
 * mount-instance machinery (per-mount specifier rewriting, gated-globals
 * realm keying). A model module is EDITOR-side content — it builds an
 * `Object3D` for a document, it does not mount a game — so it wants exactly
 * one of those effects, a fresh evaluation, and none of the others. A key the
 * server does not interpret busts the url and changes nothing else.
 *
 * `revision` is the document's own rebuild counter, so consecutive saves each
 * get a url the browser has never fetched. That is only half the freshness
 * story and the smaller half: the dev server's `hotUpdate` hook has already
 * stamped the changed file HMR-invalid across the project's subgraph
 * (`server/project-script-hmr.ts`), so re-transforming this module also
 * re-points every dependency of it at a fresh `?t=`. Busting the leaf alone
 * would re-run the leaf against stale imports.
 */
export function liveModuleImportUrl(
  projectRoot: string,
  relativePath: string,
  revision: number,
): string {
  return `${fsImportPath(projectRoot, relativePath)}?vgai-live-module=${revision}`;
}

let liveModuleRevision = Date.now();

/** A rebuild's import identity must outlive a component's local counter.
 * Closing/reopening a document must never reuse its first cached module. */
export function beginLiveModuleRevision(): number {
  liveModuleRevision = Math.max(liveModuleRevision + 1, Date.now());
  return liveModuleRevision;
}

export function projectEntryImportUrl(
  projectRoot: string,
  entry: string,
  epoch: ProjectMountEpoch,
  selectionOverride?: EntrypointSelectionOverride,
): string {
  const base = `${fsImportPath(projectRoot, entry)}?${PROJECT_MOUNT_QUERY}=${epoch}`;
  if (!selectionOverride) return base;
  return (
    `${base}&${PROJECT_SELECTION_QUERY}=${encodeURIComponent(selectionOverride.selection)}` +
    `&${PROJECT_SCENE_QUERY}=${encodeURIComponent(selectionOverride.key)}`
  );
}
