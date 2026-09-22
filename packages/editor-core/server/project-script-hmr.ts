/**
 * The editor's project-script HMR hook — ONE copy, shared by `dev.ts` and
 * `packaged.ts` (both used to carry a hand-maintained "byte-identical" copy).
 *
 * IT RUNS ON VITE'S `hotUpdate`, NOT `handleHotUpdate`, AND THAT IS THE POINT
 * -------------------------------------------------------------------------
 * Vite calls the legacy `handleHotUpdate` hook for `type === 'update'` ONLY
 * (`handleHMRUpdate`, vite 6.4.3). The watcher's `add`/`unlink` path emits
 * `'create'`/`'delete'` instead, so for two years every delete and every
 * create of a project file went past this seam entirely: the running game kept
 * the vanished module, nothing set `restartRequired`, nothing was printed, and
 * vite fanned a useless HMR update across every accumulated `?vgai-mount=N`
 * variant of the project's modules (measured at 7 and 14 variants; the only
 * trace was `[vite] Failed to reload` in the page console, and often not even
 * that). The modern `hotUpdate` hook receives all three types, so the editor
 * now owns the whole file-event vocabulary — see
 * {@link handleProjectScriptHotUpdate}'s create/delete branch.
 *
 * WHY THIS MODULE EXISTS AT ALL: `vgai restart` served STALE CODE
 * ---------------------------------------------------------------
 * Measured 2026-08-02, live: editing `src/components/Dragon.tsx` (a component
 * the R3F entry imports) and then running `vgai restart` + play left the edit
 * UNAPPLIED, while an edit to `src/world.tsx` (the entry ITSELF) applied after
 * the same restart. Only closing the session and re-running `npm run dev`
 * picked the component edit up — i.e. the documented restart contract ("so
 * setup and disposal rerun") was silently running the pre-edit module.
 *
 * The mechanism, end to end:
 *
 *  1. This hook classifies a project source change and, for the kinds the
 *     editor drives itself (`r3f-entry`/`component`/`restart`), sends its OWN
 *     custom websocket event and returns `[]` — deliberately swallowing
 *     Vite's stock HMR propagation, because stock HMR on an R3F-dialect
 *     module bubbles to a full page reload (W4).
 *  2. Returning `[]` means Vite never calls `updateModules`. The only
 *     invalidation that ran is the watcher's `moduleGraph.onFileChange`,
 *     which calls `invalidateModule(mod, seen)` with `isHmr === false` — that
 *     branch sets `lastInvalidationTimestamp` and leaves `lastHMRTimestamp`
 *     at 0 (vite 6.4.1, `ModuleGraph.invalidateModule`).
 *  3. Vite's import-analysis appends the `?t=<ts>` cache-busting query to a
 *     static import ONLY when `depModule.lastHMRTimestamp > 0` (both the full
 *     transform path and `handleModuleSoftInvalidation`'s rewrite path check
 *     exactly that field).
 *  4. So when play remounts and the realm's entry loader
 *     (`src/realm-services.ts`) re-imports the ENTRY with
 *     its own `?vgai-play=<n>` buster, the freshly transformed entry still
 *     points at the BYTE-IDENTICAL `/@fs/.../Dragon.tsx` URL the browser
 *     already has in its ES module registry. Browser module identity is
 *     per-URL, so the browser reuses the pre-edit module. The entry is fresh;
 *     everything it imports is stale.
 *
 * THE FIX is one line of intent: when this hook swallows Vite's HMR, it must
 * still do the half of `updateModules` that the module graph needs — stamp
 * the changed file's modules as HMR-invalidated (`isHmr: true`), which
 * propagates to their importers and gives every ancestor a fresh `?t=` for
 * the changed module on its next transform. Cache-busting the entry then
 * genuinely re-evaluates the whole edited subgraph, which is what "restart"
 * always claimed to do.
 *
 * `stampHmrInvalidation` is deliberately defensive about the graph's shape:
 * if a module graph ever stops offering the invalidation API, this hook says
 * so LOUDLY and names the file, rather than swallowing HMR into silence and
 * letting a restart remount old code again.
 */

import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import {
  classifyProjectHotUpdate,
  type ProjectHotUpdateKind,
  reactRefreshBoundaryExports,
} from './project-hmr-files';
import {
  importersFromModuleGraph,
  type ModuleGraphLike,
  resolveOidSurface,
} from './project-root-surface';

/** Structural stand-in for a Vite `ModuleNode` (never imported from `vite` —
 *  this file holds the same dependency-light bar as `project-root-surface`). */
export interface HmrModuleNodeLike {
  readonly url?: string | undefined;
  readonly id?: string | null | undefined;
  readonly file?: string | null | undefined;
  readonly isSelfAccepting?: boolean | undefined;
  /** Vite's `ModuleNode.importers` — read by {@link stampHmrInvalidation}'s
   *  boundary pre-walk; optional so a bare graph stays acceptable. */
  readonly importers?: Iterable<HmrModuleNodeLike> | undefined;
}

/** The slice of Vite's `ModuleGraph` this module needs, both members optional
 *  so a caller can hand over any graph-shaped object and get an honest
 *  `supported: false` rather than a crash.
 *
 *  METHOD syntax, deliberately: TypeScript checks method parameters
 *  bivariantly and property-typed function parameters contravariantly, and
 *  the whole point of this interface is that Vite's REAL `ModuleGraph`
 *  (whose `ModuleNode` is far richer than `HmrModuleNodeLike`) satisfies it. */
export interface HmrInvalidationGraph {
  getModulesByFile?(file: string): Iterable<HmrModuleNodeLike> | undefined;
  invalidateModule?(
    mod: HmrModuleNodeLike,
    seen?: Set<HmrModuleNodeLike>,
    timestamp?: number,
    isHmr?: boolean,
    softInvalidate?: boolean,
  ): void;
}

export type ScriptHmrModuleGraph = ModuleGraphLike & HmrInvalidationGraph;

/** Project documents can import helpers without being React boundaries.
 * Report actual dependent files so a Model reloads for its own dependencies,
 * never for every unrelated save in the project. Include every loaded variant. */
export function affectedProjectFiles(
  graph: HmrInvalidationGraph,
  file: string,
  projectRoot: string,
): string[] {
  const files = new Set([file.replaceAll('\\', '/')]);
  const seen = new Set<HmrModuleNodeLike>();
  const visit = (node: HmrModuleNodeLike): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.file) {
      const path = relative(projectRoot, node.file);
      if (path === '..' || path.startsWith('../')) return;
      files.add(node.file.replaceAll('\\', '/'));
    }
    for (const importer of node.importers ?? []) visit(importer);
  };
  for (const node of graph.getModulesByFile?.(file) ?? []) visit(node);
  return [...files].sort();
}

/** The minimal dev-server shape this hook drives. */
export interface ScriptHmrServerLike {
  ws: { send: (msg: unknown) => void };
  moduleGraph: ScriptHmrModuleGraph;
}

/** The slice of vite's `HotUpdateOptions` the editor's plugin reads —
 *  structural, so neither host has to import `vite` to declare its hook. */
export interface ScriptHmrHostOptions {
  readonly file: string;
  readonly type: ProjectFileEventType;
  readonly timestamp?: number;
  readonly server: ScriptHmrServerLike;
}

/** The `this` vite binds on `hotUpdate` — the environment whose pass this is. */
export interface ScriptHmrHookContext {
  readonly environment?: { readonly name?: string } | undefined;
}

/**
 * Does this update kind SWALLOW Vite's own HMR propagation (return `[]`)?
 *
 * Stated as the complement on purpose: the three kinds below return EARLY, so
 * stock Vite HMR runs `updateModules` and stamps the graph for us. Everything
 * else — including `ignore` — reaches `return []`, and therefore has to be
 * stamped by hand or an edit to it can survive a remount. Writing this as a
 * positive list of "the kinds I remembered" is how `ignore` would quietly
 * become a second hole.
 */
export function swallowsViteHmr(kind: ProjectHotUpdateKind): boolean {
  return kind !== 'outside' && kind !== 'stock-data' && kind !== 'react' && kind !== 'r3f-refresh';
}

/** What {@link stampHmrInvalidation} did, so the caller can report honestly. */
export interface HmrStampOutcome {
  /** False when the graph does not expose the invalidation API at all — the
   *  ONE case where an edited module provably cannot be re-evaluated by a
   *  remount, and therefore the one case that must be shouted about. */
  readonly supported: boolean;
  /** Module urls/ids that were stamped. Empty with `supported: true` simply
   *  means the file has no module-graph node yet — it was never loaded, so
   *  it cannot be stale. */
  readonly stamped: readonly string[];
}

/**
 * Mark every module of `file` as HMR-invalidated, the way Vite's own
 * `updateModules` would have, so import-analysis re-stamps `?t=` on it for
 * every importer. Propagation to importers is `invalidateModule`'s own job
 * (it walks `mod.importers` with the same `isHmr` flag).
 *
 * `stopAt` BOUNDS that propagation at the editor's own modules, and its
 * absence was a live defect (measured on bubbo-bubbo, 2026-08-21): a
 * creation-site write to the game's source stamped the changed module, and
 * the importer walk climbed THROUGH the isolation-document's import edge into
 * editor chrome — `play-mode.ts` among the ancestors. Editor chrome is full
 * of lazy `await import('./x')` seams, and the next one to fire after the
 * stamp fetched a SECOND `play-mode.ts?t=…` instance: `GamePanel` then
 * reported its container to the new instance while the mount path read the
 * old one, and every subsequent ▶ refused with "Game container not mounted"
 * until a full page reload. A game edit re-evaluates the GAME's subgraph
 * (the entry re-import's own cache-buster sees the fresh `?t=`); it must
 * never re-instance editor-chrome singletons mid-session. The boundary works
 * by pre-seeding `invalidateModule`'s `seen` set: a module already in `seen`
 * is skipped AND its importers are not walked, which is exactly "stop here".
 */
export function stampHmrInvalidation(
  graph: HmrInvalidationGraph | undefined,
  file: string,
  timestamp: number = Date.now(),
  stopAt?: (moduleFile: string) => boolean,
): HmrStampOutcome {
  if (!graph || typeof graph.getModulesByFile !== 'function')
    return { supported: false, stamped: [] };
  if (typeof graph.invalidateModule !== 'function') return { supported: false, stamped: [] };
  const mods = graph.getModulesByFile(file);
  if (!mods) return { supported: true, stamped: [] };
  const stamped: string[] = [];
  if (stopAt) {
    // BOUNDED. Vite's `seen` is a CYCLE guard, not a fence: `invalidateModule`
    // assigns `invalidationState` BEFORE its early-return check, and only
    // returns for a seen module WHEN THAT ASSIGNMENT CHANGED NOTHING
    // (`if (seen.has(mod) && prevInvalidationState === mod.invalidationState)
    // return`, vite 6.4.3). A fresh module in `seen` therefore still gets
    // stamped and walked through — measured on bubbo-bubbo: every seeding
    // strategy shipped 33 editor-module stamps per write, identically. The
    // fence that actually holds is PRE-ARMING each boundary module's
    // `invalidationState` to the exact value both walk arms would assign:
    // the hard arm re-assigns `'HARD_INVALIDATED'` (no change) and the soft
    // arm's `??=` keeps it (no change), so the early return finally fires.
    // Pre-arming is behaviorally free for the boundary module itself — its
    // `transformResult` cache is untouched, and the soft-invalidation
    // replay path only consumes `invalidationState` after an invalidation
    // nulled that cache.
    const boundary = new Set<HmrModuleNodeLike>();
    const visited = new Set<HmrModuleNodeLike>([...mods]);
    const queue = [...visited];
    while (queue.length > 0) {
      const mod = queue.pop() as HmrModuleNodeLike;
      for (const importer of mod.importers ?? []) {
        if (visited.has(importer)) continue;
        visited.add(importer);
        if (typeof importer.file === 'string' && stopAt(importer.file)) {
          boundary.add(importer);
          continue;
        }
        queue.push(importer);
      }
    }
    for (const node of boundary) {
      // The mixed backward-compat graph hands out WRAPPERS whose state lives
      // on the per-environment halves; a plain environment graph's node holds
      // the field itself. Write whichever exists.
      const halves = node as {
        _clientModule?: { invalidationState?: unknown };
        _ssrModule?: { invalidationState?: unknown };
        invalidationState?: unknown;
      };
      if (halves._clientModule) halves._clientModule.invalidationState = 'HARD_INVALIDATED';
      if (halves._ssrModule) halves._ssrModule.invalidationState = 'HARD_INVALIDATED';
      if (!halves._clientModule && !halves._ssrModule) {
        halves.invalidationState = 'HARD_INVALIDATED';
      }
    }
    const seen = new Set<HmrModuleNodeLike>(boundary);
    for (const mod of mods) {
      graph.invalidateModule(mod, seen, timestamp, true);
      stamped.push(mod.url ?? mod.id ?? file);
    }
    return { supported: true, stamped };
  }
  const seen = new Set<HmrModuleNodeLike>();
  for (const mod of mods) {
    graph.invalidateModule(mod, seen, timestamp, true);
    stamped.push(mod.url ?? mod.id ?? file);
  }
  return { supported: true, stamped };
}

/**
 * The loud warning for the one genuinely-uninvalidatable case. Pure so the
 * exact wording is a unit-testable contract rather than an inline string: a
 * silent stale remount is the defect this whole module exists to prevent, so
 * the failure to prevent it must NAME the module.
 */
export function staleModuleWarning(file: string, outcome: HmrStampOutcome): string | null {
  if (outcome.supported) return null;
  return (
    `vgai: ${file} changed, but this dev server's module graph does not support HMR ` +
    'invalidation — a play restart will re-run setup against the STALE copy of that ' +
    'module. Reload the editor page to pick the edit up.'
  );
}

/** Vite's `HotUpdateOptions['type']`, restated so this module keeps its
 *  never-import-`vite` bar. */
export type ProjectFileEventType = 'create' | 'update' | 'delete';

/** Everything `handleProjectScriptHotUpdate` needs from its plugin host. */
export interface ProjectScriptHotUpdateArgs {
  readonly file: string;
  readonly projectRoot: string;
  /** Which watcher event this is. Defaults to `'update'` so a caller that only
   *  ever had edits keeps its old meaning. */
  readonly type?: ProjectFileEventType | undefined;
  /** The changed file's source, or `''` when there is none to read — a
   *  non-script file, or a file that has just been DELETED (the caller reads
   *  it; this module does no I/O). */
  readonly source: string;
  readonly server: ScriptHmrServerLike;
  /**
   * Which of vite's environments this invocation is for. `hotUpdate` runs once
   * per environment (client, then ssr), and the editor's side effects — the
   * module-graph stamp and the custom websocket event — belong to the CLIENT
   * pass alone: the ssr pass would double-send both. Non-client passes still
   * return the same swallow/pass-through decision so vite's own propagation
   * stays consistent across environments.
   */
  readonly environment?: string | undefined;
  readonly timestamp?: number | undefined;
  /** Defaults to `console.warn`; injected in tests. */
  readonly warn?: ((message: string) => void) | undefined;
}

/**
 * Fast Refresh boundary status of the LAST source this hook saw for a file.
 *
 * React Refresh validates a boundary by COMPARING the loaded module's exports
 * with the incoming ones, so the hazard is a TRANSITION, not a state: the
 * update that REMOVES a non-component export invalidates exactly as hard as
 * the one that adds it (measured live — removing the `export` keyword again
 * full-reloaded the editor even though the new source is a perfectly good
 * boundary). Judging the incoming source alone therefore closes only half the
 * hole; the previous source has to be remembered.
 *
 * The serving plugin records initial client transforms as well as updates,
 * so the first edit after loading mixed exports cannot skip the transition.
 */
const lastSeenBoundary = new Map<string, readonly string[] | null>();

/** Clears the memo above so a test can start from a known first-sight state. */
export function resetReactBoundaryMemoForTest(): void {
  lastSeenBoundary.clear();
}

/** Record the source actually served, including the initial mixed-export case. */
export function recordReactBoundary(file: string, source: string): void {
  if (/\.[jt]sx$/.test(file)) lastSeenBoundary.set(file, reactRefreshBoundaryExports(source));
}

/**
 * Record this source's boundary status and downgrade a `react` classification
 * to `restart` unless BOTH the previous and the incoming source are Fast
 * Refresh boundaries. Runs for every `.tsx`/`.jsx` update, whatever its kind,
 * so the memo also records the versions that never rode stock HMR.
 */
function trackReactBoundary(
  kind: ProjectHotUpdateKind,
  file: string,
  source: string,
): ProjectHotUpdateKind {
  if (!/\.(tsx|jsx)$/.test(file)) return kind;
  const isBoundary = reactRefreshBoundaryExports(source);
  const wasBoundary = lastSeenBoundary.has(file) ? lastSeenBoundary.get(file)! : isBoundary;
  lastSeenBoundary.set(file, isBoundary);
  if (kind !== 'react' && kind !== 'r3f-refresh') return kind;
  return isBoundary && wasBoundary && isBoundary.join('\0') === wasBoundary.join('\0')
    ? kind
    : kind === 'r3f-refresh'
      ? 'r3f-entry'
      : 'restart';
}

/** A plain model/helper module may use Vite's dependency propagation only
 * when EVERY loaded importer path ends at a proven R3F refresh boundary.
 * Dead ends, cycles, mixed exports and paths into editor code retain the
 * controlled fallback. The URLs are Vite's own, including mount variants.
 */
export function r3fDependencyBoundaries(
  graph: ScriptHmrModuleGraph,
  file: string,
  projectRoot: string,
): readonly string[] | null {
  const nodes = [...(graph.getModulesByFile?.(file) ?? [])];
  if (!nodes.length) return null;
  const boundaries = new Set<string>();
  const root = `${projectRoot.replaceAll('\\', '/').replace(/\/$/, '')}/`;
  const importersOf = importersFromModuleGraph(graph);
  const proven = new Set<HmrModuleNodeLike>();
  const visit = (node: HmrModuleNodeLike, ancestors: Set<HmrModuleNodeLike>): boolean => {
    if (proven.has(node)) return true;
    if (ancestors.has(node) || !node.file?.replaceAll('\\', '/').startsWith(root)) return false;
    if (node.isSelfAccepting) {
      if (
        !node.url ||
        !lastSeenBoundary.get(node.file) ||
        resolveOidSurface(node.file, '', importersOf).attribute !== 'userData-oid'
      )
        return false;
      boundaries.add(node.url);
      proven.add(node);
      return true;
    }
    const importers = [...(node.importers ?? [])];
    if (!importers.length) return false;
    const next = new Set(ancestors).add(node);
    if (!importers.every((importer) => visit(importer, next))) return false;
    proven.add(node);
    return true;
  };
  return nodes.every((node) => visit(node, new Set())) && boundaries.size ? [...boundaries] : null;
}

/**
 * Is a file APPEARING or VANISHING under this kind the editor's event to own?
 *
 * `outside` is not the project's, so vite keeps it. Everything else is —
 * including `ignore`, whose files are swallowed silently exactly as an edit to
 * them is. The kinds in between all name a module the running game may hold,
 * and a module that no longer exists (or has just started existing beside the
 * ones it does) cannot be reconciled by any hot update: only a remount can.
 */
function appearanceIsOurs(kind: ProjectHotUpdateKind): boolean {
  return kind !== 'outside';
}

/**
 * A project file was CREATED or DELETED.
 *
 * There is exactly one honest answer for a runtime module: restart. Vite's own
 * propagation is swallowed (`[]`) rather than allowed to run, because for a
 * delete it has nothing to send that any client can apply — its only effect
 * was pushing an unusable update at every `?vgai-mount=N` variant the session
 * had accumulated, which is how this failure stayed invisible: the page logged
 * `[vite] Failed to reload` and nothing else did anything at all.
 */
/**
 * The stamp's propagation boundary for a PROJECT file: the project's own
 * modules re-evaluate on the next remount; any importer OUTSIDE the project
 * tree is editor chrome (or an engine module the chrome shares) and must
 * never be re-instanced by a game edit — see {@link stampHmrInvalidation}'s
 * doc for the split-singleton failure this prevents.
 */
function projectStampBoundary(projectRoot: string): (moduleFile: string) => boolean {
  const root = `${projectRoot.replaceAll('\\', '/').replace(/\/+$/, '')}/`;
  return (moduleFile) => !moduleFile.replaceAll('\\', '/').startsWith(root);
}

/**
 * Pick the stamp boundary for ONE changed file. A file inside the project
 * tree bounds at the project; a repo-VENDORED game file (classified
 * `restart` by `classifyProjectHotUpdate` even though it sits outside the
 * project folder) must keep propagating through the vendored subtree AND the
 * project's own modules — only editor chrome stops it — so its boundary is
 * the engine-root form, with the engine root read off the file's own
 * `/vendor/games/` position.
 */
function stampBoundaryFor(file: string, projectRoot: string): (moduleFile: string) => boolean {
  const normalized = file.replaceAll('\\', '/');
  const vendorIdx = normalized.indexOf('/vendor/games/');
  if (vendorIdx !== -1) {
    return editorChromeStampBoundary(normalized.slice(0, vendorIdx), () => projectRoot);
  }
  return projectStampBoundary(projectRoot);
}

/**
 * The same boundary for a WRITE-ROUTE stamp, where the changed file can live
 * OUTSIDE the project root (a repo-vendored game's source under
 * `vendor/games/`): editor chrome is what must not re-instance, and here it
 * is nameable directly — modules under the engine checkout's `packages/`
 * that are not the open project's own tree. The project-root carve-out is
 * load-bearing for in-tree fixture projects, which live inside
 * `packages/editor/src/ingest/games/`. Vendored sources sit under `vendor/`
 * (not `packages/`), so they propagate; engine modules the chrome shares sit
 * under `packages/engine/`, so they stop. ONE spelling, exported so every
 * write route stamps with the same boundary — a second inline copy is how
 * one route shipped unbounded (see {@link stampHmrInvalidation}'s doc).
 */
export function editorChromeStampBoundary(
  engineRoot: string,
  getProjectRoot: () => string | undefined,
): (moduleFile: string) => boolean {
  const packagesRoot = `${engineRoot.replaceAll('\\', '/').replace(/\/+$/, '')}/packages/`;
  return (moduleFile) => {
    const normalized = moduleFile.replaceAll('\\', '/');
    if (!normalized.startsWith(packagesRoot)) return false;
    const projectRoot = getProjectRoot();
    if (!projectRoot) return true;
    const projectPrefix = `${projectRoot.replaceAll('\\', '/').replace(/\/+$/, '')}/`;
    return !normalized.startsWith(projectPrefix);
  };
}

function handleProjectFileAppearance(
  args: ProjectScriptHotUpdateArgs,
  kind: ProjectHotUpdateKind,
  isClient: boolean,
): never[] | undefined {
  if (!appearanceIsOurs(kind)) return undefined;
  if (!isClient || kind === 'ignore') return [];
  const { file, server } = args;
  // A delete leaves the graph holding nodes for a file that is gone; stamping
  // them HMR-invalid is what makes every importer re-transform (and therefore
  // re-resolve, and therefore FAIL LOUDLY) instead of silently serving the
  // cached transform that still points at the vanished module.
  const outcome = stampHmrInvalidation(
    server.moduleGraph,
    file,
    args.timestamp,
    stampBoundaryFor(file, args.projectRoot),
  );
  const warning = staleModuleWarning(file, outcome);
  if (warning) (args.warn ?? console.warn)(warning);
  server.ws.send({
    type: 'custom',
    event: kind === 'tool' ? 'vgai:script-update' : 'vgai:restart-required',
    data: { file: file.replaceAll('\\', '/') },
  });
  return [];
}

/**
 * The shared `hotUpdate` body. Returns `[]` to swallow Vite's HMR
 * propagation, or `undefined` to let it run — the same two-valued contract
 * `dev.ts`/`packaged.ts` returned when each carried its own copy.
 */
export function handleProjectScriptHotUpdate(
  args: ProjectScriptHotUpdateArgs,
): never[] | undefined {
  const { file, projectRoot, source, server } = args;
  const isClient = (args.environment ?? 'client') === 'client';
  const classified = classifyProjectHotUpdate(
    file,
    projectRoot,
    source,
    // T43: reach a non-entry R3F component through the live import graph,
    // same as `vite-plugin-ui-oid.ts`'s transform hook — see
    // `project-hmr-files.ts`'s doc comment on why this is shared, not
    // re-derived.
    importersFromModuleGraph(server.moduleGraph),
  );
  if ((args.type ?? 'update') !== 'update') {
    return handleProjectFileAppearance(args, classified, isClient);
  }
  const boundaries =
    classified === 'restart' && /\.[cm]?[jt]s$/.test(file)
      ? r3fDependencyBoundaries(server.moduleGraph, file, projectRoot)
      : null;
  const kind = boundaries
    ? 'r3f-refresh'
    : isClient
      ? trackReactBoundary(classified, file, source)
      : classified;
  // `outside` / `stock-data` / `react` ride stock Vite HMR (a data handle's
  // owning module live-tunes it through its own `import.meta.hot.accept`;
  // a react module takes Fast Refresh) — and stock HMR does the module-graph
  // stamping itself, which is why they leave here untouched.
  if (!swallowsViteHmr(kind)) {
    if (kind === 'r3f-refresh' && isClient) {
      server.ws.send({
        type: 'custom',
        event: 'vgai:r3f-refresh-source',
        data: {
          file: file.replaceAll('\\', '/'),
          path: relative(projectRoot, file).replaceAll('\\', '/'),
          sha: createHash('sha256').update(source).digest('hex').slice(0, 16),
          timestamp: args.timestamp,
          affected: affectedProjectFiles(server.moduleGraph, file, projectRoot),
          ...(boundaries ? { boundaries } : {}),
        },
      });
    }
    return undefined;
  }
  // The ssr pass owns no side effects — see `ProjectScriptHotUpdateArgs.environment`.
  if (!isClient) return [];

  // Swallowing Vite's HMR means taking on the module-graph bookkeeping it
  // would have done. See this module's header for the full mechanism and the
  // stale-restart incident that produced it.
  const outcome = stampHmrInvalidation(
    server.moduleGraph,
    file,
    args.timestamp,
    stampBoundaryFor(file, args.projectRoot),
  );
  const warning = staleModuleWarning(file, outcome);
  if (warning) (args.warn ?? console.warn)(warning);

  // R3F-dialect modules are swallowed from stock HMR (their non-component)
  // exports would force a full page reload) — the editor's R3F design
  // session listens for this custom event and remounts the design world in
  // place, re-resolving selection by oid.
  if (kind === 'r3f-entry') {
    server.ws.send({
      type: 'custom',
      event: 'vgai:r3f-entry-update',
      data: { file, affected: affectedProjectFiles(server.moduleGraph, file, projectRoot) },
    });
  }
  if (kind === 'tool') {
    server.ws.send({
      type: 'custom',
      event: 'vgai:script-update',
      data: {
        file: file.replaceAll('\\', '/'),
        affected: affectedProjectFiles(server.moduleGraph, file, projectRoot),
      },
    });
  }
  if (kind === 'restart') {
    server.ws.send({
      type: 'custom',
      event: 'vgai:restart-required',
      data: { file, affected: affectedProjectFiles(server.moduleGraph, file, projectRoot) },
    });
  }
  // Other project changes (including scripts/, tests/, dist/) are not runtime
  // modules. Swallow them; scene/asset changes are delivered through the
  // editor's own SSE channel.
  return [];
}
