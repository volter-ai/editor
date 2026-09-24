/**
 * Packaged editor server — the entry a `@vgai/editor` npm package resolves from a
 * PROJECT's own `node_modules`, with NO monorepo checkout on disk (Phase B; see
 * the phase plan's D-FORK decision + §0/§3 "the real work" for `@vgai/editor`).
 *
 * Run with:
 *   VGAI_PROJECT=<projectDir> node dist-server/packaged.mjs
 *
 * ## Why this file exists (and isn't just `dev.ts`)
 *
 * `dev.ts` boots ONE Vite instance rooted at the monorepo checkout, which
 * does double duty: it builds the editor's OWN React app AND resolves the
 * OPENED PROJECT's module graph (bare imports like `three`/`zod`/`react`
 * resolve only because that Vite's `root` is the repo root, whose hoisted
 * `node_modules` has everything). That is exactly what a registry install
 * does NOT have: there is no checkout, so there is no repo root to serve
 * either graph from.
 *
 * This file is the second code path: it serves the editor's OWN
 * app as a PREBUILT static SPA (`../dist/`, produced by the workspace-local
 * `npm run build -w @vgai/editor`) — no dev-mode transform of the editor's
 * own source is needed, since a project author isn't hot-reloading the
 * editor's own UI — and boots a SEPARATE, PROJECT-ROOTED Vite instance
 * (`root: <project>`, `configFile: false`, middleware mode, HMR + watch
 * ENABLED) whose job is ONLY to resolve/transform the opened PROJECT's own
 * source. Because that Vite instance's `root` is the project directory,
 * Vite's own resolver naturally walks the PROJECT's OWN `node_modules` for
 * every bare specifier (`three`, `zod`, `react`, ...) —
 * for free, with zero hand-written import rewriting. This is the same
 * pattern `packages/editor/scripts/run-conformance.ts` uses to run the
 * adapter conformance kit against an arbitrary external folder, adapted for
 * live editing (HMR/watch on) instead of a one-shot SSR run.
 *
 * The project's runtime packages — `@vgai/project`, `@vgai/threejs-runtime`
 * and `@vgai/game-runtime` — resolve to the PROJECT's own installed copies,
 * not copies baked into this package's tarball. A project pinning
 * `@vgai/game-runtime@0.3.0` must be served ITS 0.3.0 source, so each is
 * resolved via `createRequire`, rooted at the project directory — Node's own
 * resolution algorithm, not a hardcoded path (see
 * `resolveInstalledPackageSrcDir` in `server-utils.ts`).
 *
 * ## React-world OID authoring parity (DEBT-4 follow-on)
 *
 * `dev.ts` reaches THREE extra plugins via its `configFile:` (repo-root
 * `vite.config.ts`): `uiOidPlugin()` (stamps `data-oid` on every JSX element
 * in project-scoped `.tsx` files + serves the `/__ui-source/*` read/write
 * endpoints the hierarchy/inspector's source-write path needs),
 * `creationSiteWritePlugin()` (the `/__ingest-source/*` ownership +
 * read/plan/apply routes an INGEST root's edits are written through — absent
 * here until 2026-08-20, which made ingest-lane source writes unreachable
 * under a registry install no matter what the client asked) and
 * `reactRootProviderPlugin()` (resolves the synthetic
 * `/__vgai-game-provider` module `binding-resolver.ts`'s
 * `loadProjectWorldProvider` imports — WITHOUT it, every `kind: 'dom'`
 * world 404s on mount, not just "authors without OID"). All are carried
 * over here — the source-authoring integration's serving plugin through the project-serving
 * door, and this package's own `vite-plugin-creation-site-write` / `vite-plugin-react-world-provider`
 * (same files, no copy) and registered
 * with NO extra scoping beyond their own built-in `defaultProjectScopeInclude`
 * (already project-scoped — see that file's doc comment: excludes
 * `node_modules`, vendored trees, and the vgai tooling/engine source, which
 * this Vite instance never serves anyway since its `root` IS the project).
 *
 * `@vitejs/plugin-react` (`react()`) is DELIBERATELY NOT added here — this
 * is the one piece of `dev.ts` parity that is a genuine, structural
 * incompatibility, not a missing plugin call:
 *
 * 1. **Fast Refresh's preamble has nowhere to run.** `@vitejs/plugin-react`
 *    only skips its fast-refresh code-injection when `config.isProduction ||
 *    config.command === 'build' || config.server.hmr === false` — none of
 *    which hold here (this instance is `middlewareMode` `serve` with `hmr`
 *    ON, by design, for live editing). With fast-refresh injection ON, every
 *    transformed `.tsx` module gets a trailer that THROWS
 *    (`"@vitejs/plugin-react can't detect preamble. Something is wrong."`)
 *    unless `window.$RefreshReg$`/`$RefreshSig$` were set by the preamble
 *    script `transformIndexHtml` injects into an HTML page THAT INSTANCE
 *    SERVES. This instance is `appType: 'custom'` (no HTML serving at all —
 *    the editor's own shell is a PREBUILT static `dist/`, sent by `express.
 *    static` below with zero Vite involvement, so no `transformIndexHtml`
 *    hook ever runs for it either). Registering `react()` as-is would not
 *    degrade gracefully to "no Fast Refresh" — it would make every react-
 *    world/component module throw on first load, a regression versus
 *    today's baseline (plain esbuild JSX, which works fine for basic JSX —
 *    proven by the default template). The only way to silence just the
 *    fast-refresh half (short of a bespoke preamble-bootstrap module the
 *    browser would need to import before any project entry, itself a new
 *    client-side subsystem) is `server.hmr: false` on the WHOLE instance,
 *    which would also kill the `vgai-script-hmr` plugin below's WebSocket
 *    delivery — not an acceptable trade for this slice.
 * 2. **JSX compilation itself doesn't need it.** Vite's default esbuild JSX
 *    transform (`automatic` runtime, no config here) already compiles
 *    `.tsx`/`.jsx` correctly without `@vitejs/plugin-react` — proven by the
 *    default (threejs-only) template authoring fine today, and unaffected
 *    by this file's plugin list either way.
 *
 * So: OID stamping (source-write authoring) and the `WorldProvider` identity
 * fix are real, working parity gained by this change. React Fast Refresh
 * for a project's own components remains NOT at `dev.ts` parity under the
 * packaged runtime — a documented, structural gap, not a hidden one.
 *
 * ## ONE React for the editor's tree — the shell's (`vite-plugin-shared-react.ts`)
 *
 * The deeper structural gap this file's two-graph design opens: the editor's
 * own `react`/`react-dom` are STATICALLY bundled into its prebuilt SPA
 * (`dist/`, built at `npm run build -w @vgai/editor` time), while this
 * project-rooted Vite instance resolves bare `react` from the PROJECT's own
 * `node_modules` — two React module instances on one page, reading different
 * internal singletons. `dev.ts` has no such split (ONE Vite + repo-root
 * `vite.config.ts`'s `resolve.dedupe: ['react', 'react-dom', …]`), which is
 * why nothing in a checkout ever reproduced any of it.
 *
 * It surfaced twice, both confirmed live against a tarball-installed,
 * checkout-absent packaged editor:
 *
 *  1. a `dom` root's `useWorldState` threw `TypeError: Cannot read properties
 *     of null (reading 'useContext')` at mount, because the editor's bundled
 *     `createRoot` reconciled a component whose hooks came from the project's
 *     react; and
 *  2. every project TOOL CONTRIBUTION — the four dev-tools inspector facets
 *     (`src/contributions/game-*.inspector.tsx`), the builder inspectors, the World
 *     Labs asset inspector, the data-tables document — REGISTERED and then
 *     rendered as a crash box: `Invalid hook call … more than one copy of
 *     React in the same app`. Those render INSIDE the editor's own tree, so
 *     there was no isolated subtree to hide in.
 *
 * The fix, for (2): the editor build publishes its OWN React (plus `react-dom`,
 * `react-dom/client`, `react/jsx-runtime`, `react/jsx-dev-runtime`, and the one
 * third-party package that calls React hooks in the editor's tree) as entry
 * chunks, and `sharedReactPlugin` below resolves those specifiers — for
 * the EDITOR TREE only — to those chunks' URLs, the same URLs the shell's
 * bundle already imports, so the browser's module map hands both graphs one
 * instance. `@volter/editor-sdk/widgets` moves out of `optimizeDeps.include` and into
 * `exclude` for the same reason: a prebundled chunk's React is decided at
 * prebundle time, where a source-level redirect cannot reach it.
 *
 * The seam stops at the GAME, and that boundary is measured, not assumed: a
 * first attempt redirected the whole graph and broke Play mode
 * (`@react-three/fiber`'s prebundled DEVELOPMENT `react-reconciler` against the
 * shell's PRODUCTION React → `Cannot read properties of undefined (reading
 * 'push')` in `updateContainer`, then `onCreated did not fire within 10s`). So
 * the game keeps its own development React — which is exactly (1)'s fix, and
 * why the react-world and story MODULE DOORWAYS below still route the
 * editor's own mount/story imports through THIS graph. Read
 * `../vite-plugin-shared-react.ts` for the full rule and for why the entry
 * bodies are generated rather than written.
 *
 * ## Scoped dependency discovery, not disabled discovery (C3 follow-on)
 *
 * `optimizeDeps` below used to carry `noDiscovery: true` (see git history for
 * the exact prior comment): with the boot-time crawl DEFAULT-targeting the
 * project's own `index.html`, and a scaffolded project's `src/main.ts`
 * bootstrap containing a `?net=p2p-host`-gated `await import('../server/
 * rooms')` that esbuild's scanner statically follows regardless of the
 * runtime guard around it, that crawl reached real Colyseus SERVER code
 * (`colyseus` -> `@colyseus/core` -> `@pm2/io`, a package with no browser-
 * resolvable entry) and crashed the esbuild prebundle step outright. Turning
 * discovery off entirely sidestepped that crash — at the cost of any CJS-
 * only dependency NOT in the hardcoded `include` list below being served raw
 * to the browser and failing (this is exactly what broke `examples/
 * r3f-first-party`: `@react-three/fiber`'s CJS transitive deps, e.g.
 * `use-sync-external-store/shim/with-selector.js`, have no place to be
 * hardcoded — this server serves ARBITRARY projects, most without R3F
 * installed at all, and Vite errors on `include`-ing a not-installed dep).
 *
 * The fix (C3, `phase-b/c3-r3f-packaged`) is not "add R3F to the allowlist"
 * — that just moves the whack-a-mole to the next ecosystem a project
 * happens to pull in. It SCOPES the crawl instead of disabling it:
 * `optimizeDeps.entries` is set (see `projectOptimizeDepsEntries` /
 * `computeProjectOptimizeDepsEntries` in `project-optimize-deps-entries.ts`)
 * to the OPENED PROJECT's own `vgai.project.json`-declared world `entry` files
 * — the exact per-world mount code the editor's binding-resolver dynamically
 * imports for Play mode, never the project's `src/main.ts` bootstrap (a
 * standalone-build concern this Vite instance never serves — the editor's
 * own prebuilt SPA answers `/`). A world entry's own import graph reaches
 * real client packages (react, R3F, a legitimate client `@colyseus/sdk`
 * import for real multiplayer — `examples/third-person-arena/src/
 * network.ts`) but never `server/`, so the `@pm2/io` crash class cannot
 * occur no matter what a project's room code imports, while ANY CJS-needing-
 * prebundle client dependency a world reaches gets auto-discovered and
 * prebundled — no per-package allowlist, adapts to whatever the opened
 * project actually has installed. `project-optimize-deps-entries.ts`'s doc
 * comment has the empirical proof (direct `vite.optimizeDeps` runs, not just
 * theory): scoped to the template's world entry, prebundling succeeds
 * clean; scoped to `index.html` (the old default), it reproduces the exact
 * `@pm2/io` crash; scoped to `examples/r3f-first-party`'s world entries, `@react-
 * three/fiber`/`@react-three/drei` are discovered and prebundled with no
 * hardcoding; scoped to `examples/third-person-arena`'s world entry (a real
 * colyseus multiplayer project), `@colyseus/sdk` prebundles clean too — the
 * client SDK's own published build is self-contained and never reaches
 * `@colyseus/core`'s server-only `Stats.mjs`. See the C3 build report for
 * the real-browser proof (checkout absent, tarball-installed): R3F's
 * `examples/r3f-first-party` "net" world mounts with no console error, AND the
 * pre-existing react-world (C1) / colyseus-bearing-project (this section)
 * cases still work — no regression.
 *
 * ## Known scope trims (v1 — flagged, not silently dropped)
 *
 * - Project creation resolves the shared scaffold from this package's npm
 *   installation root, so the in-editor and terminal journeys use the same
 *   packaged template, examples, and registry dependency mode.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductIdentity } from '@volter/editor-sdk/session/product-locator';
import express from 'express';
import {
  createServer as createViteServer,
  type InlineConfig,
  type PluginOption,
  optimizeDeps,
  resolveConfig,
} from 'vite';
import {
  DEFAULT_EDITOR_PORT,
  editorHmrPort,
  editorOrigin,
} from '@volter/editor-project/manifest/editor-port';
import { servesIngestSourceRoutes } from '../vite-plugin-creation-site-write';
import { PACKAGED_MODULE_DOORWAYS } from '../vite-plugin-module-doorways';
import { readSharedReactManifest, sharedReactUrls } from '../vite-plugin-shared-react';
import { readSharedThreeManifest, sharedThreeUrl } from '../vite-plugin-shared-three';
import { SOURCE_WRITE_ROUTES_PLUGIN } from '@volter/editor-sdk/session/project-serving';
import { canonicalProjectRoot } from './canonical-path';
import { createEditorServer, type EditorServerRouter } from './editor-server';
import { productContributionsPlugin } from '../vite-plugin-product-contributions';
import { clientCount } from './editor-sse';
import {
  builtFrameBridgeModule,
  FRAME_BRIDGE_PACKAGED_PATH,
  readBuiltProductEntry,
} from './frame-bridge';
import {
  type FrameWorkbench,
  frameLaunchFromEnv,
  frameWorkbenchUrl,
  startFrameWorkbench,
} from './frame-workbench';
import {
  createIdleShutdown,
  formatIdleWindow,
  IDLE_SHUTDOWN_MINUTES_ENV,
  resolveIdleShutdownMs,
} from './idle-shutdown';
import { jsProfilingPolicy } from './js-profiling-policy';
import { configureManagedAccountDefaults } from './managed-account-defaults';
import { closeHttpServer, createProcessShutdown } from './process-shutdown';
import { projectServingRoots } from './project-install-roots';
import { freshProjectModuleLoader } from './project-module-freshness';
import {
  computeEditorRuntimeIncludes,
  computeRuntimeSourceCrawlEntries,
  computePackageContributionCrawlEntries,
  computeProjectOptimizeDepsEntries,
  computeUnresolvableRuntimeImports,
  RUNTIME_PACKAGE_NAMES,
  SERVER_ONLY_PREBUNDLE_EXCLUDE,
  viteOptimizeDepsEntries,
} from './project-optimize-deps-entries';
import { isProjectScratchPath } from './project-scratch-path';
import { createProjectServingPlugins } from './project-serving-plugins';
import {
  friendlyListenError,
  resolveBindHost,
  resolveInstalledPackageSrcDir,
} from './server-utils';
import { createProjectServingServices, loadServingPlugins } from './project-serving-services';
import { productServingModules, resolveProductForProject, sessionProduct } from './session-product';
import { setProductNames } from '@volter/editor-sdk/kit/product-command';
import { registerSession, unregisterSession } from './session-registry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This file lives directly under the `@vgai/editor` package root either as
// `packages/editor/server/packaged.ts` (source, run via tsx) or as the
// esbuild-bundled `packages/editor/dist-server/packaged.mjs` (`server/` and
// `dist-server/` are BOTH direct children of the package root) — so
// `resolve(__dirname, '..')` lands on the package root in either shape.
const editorPackageRoot = path.resolve(__dirname, '..');
const checkoutRoot = path.resolve(editorPackageRoot, '..', '..');
// The CLI's reservation wins over an inherited `PORT`: a product's `edit`
// allocates this project's port, hands it over as VGAI_EDITOR_PORT and waits
// on it, so a shell or platform that sets PORT for its own reasons (a
// container's convention of 8080) left the server on 8080 and the CLI waiting
// on the port it reserved until it gave up.
const PORT =
  Number(process.env['VGAI_EDITOR_PORT']) || Number(process.env['PORT']) || DEFAULT_EDITOR_PORT;
const HMR_PORT = Number(process.env['VGAI_HMR_PORT']) || editorHmrPort(PORT);
const HMR_CLIENT_PORT = Number(process.env['VGAI_HMR_CLIENT_PORT']) || HMR_PORT;
// S3: bind to loopback by default; opt-in to a wider interface via env.
const HOST = resolveBindHost();
// Same rule as dev.ts: every URL this process prints or opens names the host it
// actually bound, never `localhost` (see `editorOrigin`).
const EDITOR_ORIGIN = editorOrigin(PORT, HOST);

if (!process.env['VGAI_PROJECT']) {
  console.error(
    '\n  \x1b[31mVGAI_PROJECT is required — the packaged editor has no monorepo checkout to fall ' +
      'back to. Set VGAI_PROJECT=<absolute path to your project>.\x1b[0m\n',
  );
  process.exit(1);
}
// Canonicalized (symlink-resolved) — see canonical-path.ts's doc comment
// (dev.ts's identical fix: a react world's `WorldProvider` colocation breaks
// if this path and Vite's own resolver disagree on a symlinked segment).
const projectPath = canonicalProjectRoot(process.env['VGAI_PROJECT']);

// THE PRODUCT'S BUILD is what this host serves — `npm run build -w
// @vgai/game-editor` / `-w @vgai/model-editor`, each into its own package's
// `dist/` (`packages/editor/vite-product-build.ts`). The kit has no browser
// build of its own any more: `frame/bridge.tsx` is a module the product's entry
// imports, and the ENTRY is what a build has (ARCHITECTURE-CORE §The target
// shape, rule 4: "each product's build is its own entry").
//
// `null` when this session serves no product — the served-modules door says so
// by name rather than answering with an empty directory.
const resolvedProduct = sessionProduct(projectPath);
if (resolvedProduct === null) {
  // The same refusal the CLI prints before it ever spawns this process. Said
  // again here because this host can also be started by hand, and a packaged
  // session with no product has no bundle to serve at all — there is nothing to
  // degrade to.
  try {
    resolveProductForProject(projectPath);
  } catch (error) {
    console.error(`\n  \x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
  }
  process.exit(1);
}
// Re-bound with the non-null type rather than leaning on the narrowing above:
// every reader below is inside a closure, and a narrowing is not a type.
const sessionProductIdentity: ProductIdentity = resolvedProduct;
// Every message this server writes about a verb names the product's command.
setProductNames(sessionProductIdentity);
const distPath = path.join(sessionProductIdentity.dir, 'dist');
/**
 * SOURCE MODE — a checkout's development host (`VOLTER_EDITOR_FROM_SOURCE=1`): the product's own
 * `src/index.ts` is served through the project-rooted Vite below instead of its production build,
 * so a change is walked without bundling the product (a multi-gigabyte build). In a checkout the
 * project resolves the same React and three files as the editor, so the shared-React/three
 * doorways the prebuilt shell needs are off. An installed product has no `src/index.ts` beside
 * its package, so this is never true there.
 */
const productSourceEntry = path.join(sessionProductIdentity.dir, 'src', 'index.ts');
const fromSource = process.env['VOLTER_EDITOR_FROM_SOURCE'] === '1' && existsSync(productSourceEntry);

// WHAT THIS SESSION WAS TOLD TO FRAME — the workbench directory `vgai edit`
// resolved and the two reserved ports. `null` when the launch named none.
const frameLaunch = frameLaunchFromEnv();
/** What the frame is running, once it is. Read by `/__editor/state`. */
let frameWorkbench: FrameWorkbench | null = null;

// Where this project's modules REALLY live — the project plus the install
// roots Node itself would resolve its dependencies from
// (`project-install-roots.ts`). This replaces a boot-time
// `realpath(<project>/node_modules)` guess that was correct only for a
// standalone flat install: a workspace-member project (every `examples/<id>`,
// any user monorepo game) has no `node_modules` of its own — npm hoists it
// ABOVE the project — and its sibling packages resolve through symlinks that
// land outside the project entirely, so Vite 403'd the world's own engine
// imports and served `?inline` CSS raw instead of transforming it. See that
// module's header for the measured failures.
const projectFsRoots = projectServingRoots(projectPath);

// D-X2: the project-static route must follow the CURRENTLY open project, not
// a boot-time snapshot — mirrors dev.ts's `currentProjectRoot` box, updated
// in the SAME `onProjectOpened` callback that extends Vite's fs.allow/
// watcher/game-globals shadow for a newly opened project.
let currentProjectRoot: string = projectPath;
const projectRoots = new Set<string>([projectPath]);

// C3: the OPENED project's own manifest-declared world entry files — scopes
// `optimizeDeps.entries` below to exactly the client code a world can mount,
// never `index.html`/the project's own bootstrap `main.ts` (which is how the
// crawl used to reach `server/` room code and crash on `@pm2/io`). Boot-time
// snapshot only, same trim as `runtimeSources`/`resolve.alias` below — see
// `project-optimize-deps-entries.ts`'s doc comment for the full rationale
// and the empirical proof this avoids the colyseus-scanner crash.
const projectOptimizeDepsEntries = computeProjectOptimizeDepsEntries(projectPath);

/** Whether `packageName` resolves from the PROJECT's own node_modules —
 *  Node's resolution rooted at the project, same discipline as
 *  `resolveInstalledPackageSrcDir` (server-utils.ts), for deps that are only
 *  safe to `optimizeDeps.include` when actually installed. */
function projectHasPackage(fromDir: string, packageName: string): boolean {
  try {
    createRequire(path.join(fromDir, 'package.json')).resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

/** Every dependency the project's own `package.json` declares, of any kind. */
function projectDeclaredDependencies(projectRoot: string): Set<string> {
  try {
    const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    const names = new Set<string>();
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const table = manifest[field];
      if (table && typeof table === 'object') for (const name of Object.keys(table)) names.add(name);
    }
    return names;
  } catch {
    return new Set();
  }
}

async function main(): Promise<void> {
  configureManagedAccountDefaults();
  const app = express();
  // Cross-origin isolation, and the Blender WORKER is why it stays. Removing
  // these in the belief that nothing wanted a SharedArrayBuffer broke every
  // module worker on the page (measured 2026-09-14): a cross-origin-isolated
  // document may only create a dedicated worker whose SCRIPT is itself
  // delivered with a COEP header, and without it Chrome refuses with an
  // ErrorEvent carrying no message, no file and no error — a three-line worker
  // failed exactly like Blender's. Blender runs in a module worker, so this
  // middleware is load-bearing. `same-origin` costs the editor nothing — every
  // window it opens is `noopener` already — and `credentialless` embedding
  // keeps cross-origin assets loading (without credentials) where
  // `require-corp` would demand a resource policy on each. Set first, ahead of
  // every route and of Vite's own responses.
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });

  // Idle self-shutdown — same contract, same wiring, same reasons as dev.ts
  // (read idle-shutdown.ts's header for the ownership story). Armed ahead of
  // every route so `noteActivity` sees each request; the forward reference is
  // resolved to this host's own shutdown function below.
  let onIdleShutdown: (why: string) => void = () => {};
  const idleShutdown = createIdleShutdown({
    idleMs: resolveIdleShutdownMs(),
    hasConnectedClients: () => clientCount() > 0,
    onIdle: (why) => onIdleShutdown(why),
  });
  app.use((_req, _res, next) => {
    idleShutdown.noteActivity();
    next();
  });

  // Same contract as dev.ts: grant the editor page the JS Self-Profiling API
  // its own `visible-tab-fps-floor` invariant tells the reader to use, ahead of
  // every route so it lands on whichever of this host's three paths
  // (`express.static`, the SPA fallback, Vite) writes the document response.
  // See `js-profiling-policy.ts`.
  app.use(jsProfilingPolicy());

  // The project's own installed runtime packages — resolved from the PROJECT's
  // node_modules (Node's own resolution algorithm), never copies baked into
  // this package's own tarball (see this file's header doc comment). A package
  // that does not resolve simply contributes no alias — e.g. a project that
  // hasn't run `npm install` yet — so a bad install reports a resolution
  // failure without silently using the editor package's own copy.
  const runtimeSources = new Map<string, string>();
  for (const name of RUNTIME_PACKAGE_NAMES) {
    const dir = resolveInstalledPackageSrcDir(projectPath, name);
    if (dir) runtimeSources.set(name, dir);
  }
  // Only a package the project DECLARES is owed an install: a modeling
  // project carries no game runtime, and its absence is not a fault.
  const declaredDependencies = projectDeclaredDependencies(projectPath);
  const unresolvedRuntimePackages = RUNTIME_PACKAGE_NAMES.filter(
    (name) => declaredDependencies.has(name) && !runtimeSources.has(name),
  );
  if (unresolvedRuntimePackages.length > 0) {
    console.warn(
      `\n  \x1b[33mWarning:\x1b[0m ${unresolvedRuntimePackages.join(', ')} not resolvable from ` +
        `${projectPath} — run npm install in the project first. ` +
        'Their imports will fail to resolve until then.\n',
    );
  }

  // The editor's OWN browser-side modules, folded into the boot pass. The
  // four `/__vgai-*-runtime` plugins registered above synthesize modules that
  // exist only in memory, so NO crawl entry can reach them, yet they are what
  // the editor imports at the first Play mount / story preview — every
  // specifier they carry was otherwise discovered mid-session, re-optimized,
  // and hard-reloaded the controlling tab. See
  // `project-optimize-deps-entries.ts`'s "EDITOR's own browser-side modules"
  // section for the measurement and for why the three parts differ:
  // `include` for the packages (gated on the project actually having them),
  // crawl `entries` for the engine subpaths (which `exclude` below deliberately
  // keeps source-served, and which the scanner therefore refuses to follow by
  // specifier), and `exclude` for engine imports this project cannot resolve
  // (without which the added crawl would throw and kill the boot).
  const editorRuntimeIncludes = computeEditorRuntimeIncludes(projectPath);
  const runtimeSourceCrawlEntries = computeRuntimeSourceCrawlEntries(runtimeSources);
  const unresolvableRuntimeImports = computeUnresolvableRuntimeImports(runtimeSources, projectPath);
  // The skew packages the project declares (`@volter/editor-blender`, `@vgai/game`): their
  // contributions are walked at boot the way the engine's source is, so the
  // dependencies they reach are prebundled instead of served raw — see
  // `computePackageContributionCrawlEntries`.
  const packageContributionCrawl = computePackageContributionCrawlEntries(projectPath);

  // ONE React for everything that renders inside the EDITOR's own tree — the
  // shell's. The shell is a prebuilt bundle with React inlined; this Vite
  // instance serves the project's source and would otherwise resolve `react`
  // to the PROJECT's node_modules, so a tool contribution called hooks from a
  // different React than the one reconciling it ("Invalid hook call"). The
  // build publishes the shell's own React as entry chunks; `sharedReactPlugin`
  // below points the editor tree's React specifiers at those chunks' URLs. The
  // GAME keeps the project's own React — see that plugin's doc comment for the
  // measured reason that boundary exists.
  const sharedReact = fromSource ? null : readSharedReactManifest(distPath);
  if (!sharedReact && !fromSource) {
    console.warn(
      `\n  \x1b[33mWarning:\x1b[0m ${distPath} carries no usable vgai-shared-react.json — this ` +
        'editor build predates the shared-React entry chunks, or predates one of ' +
        'them (the manifest must name every published specifier). Project tool contributions, ' +
        'Asset Lab documents and asset inspectors will crash with "Invalid hook call" ' +
        'because the page has two React copies. Rebuild the editor ' +
        `(npm run build -w ${sessionProductIdentity.name}).\n`,
    );
  }
  const sharedReactSpecifierUrls = sharedReact ? sharedReactUrls(sharedReact) : null;

  // ONE three for the whole page — the shell's. The shell inlines three (the
  // viewport renderer, gizmos, ~100 modules) and evaluates it at boot; this
  // project-rooted Vite would otherwise prebundle the PROJECT's own three into
  // `.vite/deps`, a SECOND instance whose module body trips three's
  // `window.__THREE__` "Multiple instances" guard and keeps `vgai console` off
  // exit-0. The build publishes the shell's three as a chunk;
  // `sharedThreePlugin` (below, via project-serving-plugins) redirects the
  // project graph's `three` onto its URL, and `optimizeDeps.exclude` below
  // keeps three from being prebundled so Fiber's own `import 'three'` is
  // externalized and follows the same redirect. See
  // `../vite-plugin-shared-three.ts`.
  const sharedThree = fromSource ? null : readSharedThreeManifest(distPath);
  if (!sharedThree && !fromSource) {
    console.warn(
      `\n  \x1b[33mWarning:\x1b[0m ${distPath} carries no usable vgai-shared-three.json — this ` +
        'editor build predates the shared-three entry chunk. The page will load three.js twice ' +
        "(the shell's inlined copy and the project's prebundled copy), and three's own " +
        'duplicate-instance guard will warn, blocking a clean console. Rebuild the editor ' +
        `(npm run build -w ${sessionProductIdentity.name}).\n`,
    );
  }
  const sharedThreeSpecifierUrl = sharedThree ? sharedThreeUrl(sharedThree) : null;

  // 1. Boot a Vite instance rooted at the PROJECT, not this editor package
  //    or a monorepo checkout — its own node_modules resolves every bare
  //    specifier for free (the run-conformance.ts pattern, live-editing not
  //    one-shot: HMR + watch stay ON, unlike that script's headless SSR run).
  // Annotated rather than inferred: an unannotated object literal widens
  // `configFile: false` to `boolean` and `appType: 'custom'` to `string`,
  // neither of which `resolveConfig` accepts — so the literal typechecks on
  // its own and only fails at the call site far below.
  // The server halves of the product's integrations (`package.json#vgai.serving`): their
  // plugins serve the project's source beside the kit's own, through the kit's services.
  // The serving door is built before the editor router it writes through; bound below.
  let servingEditorRouter: EditorServerRouter | null = null;
  const contributedServing = (await loadServingPlugins(
    productServingModules(sessionProductIdentity),
    createProjectServingServices({
      engineRoot: checkoutRoot,
      projectRoots: () => projectRoots,
      currentProjectRoot: () => currentProjectRoot,
      projectMutations: () => servingEditorRouter?.projectMutations ?? null,
    }),
  )) as PluginOption[];
  const viteInlineConfig: InlineConfig = {
    configFile: false,
    root: projectPath,
    appType: 'custom', // no HTML serving/SPA-fallback — this instance only serves project modules
    // Same reasoning as `dev.ts`: a transform failure in the project's own
    // source must not erase this terminal's scrollback (Vite's error
    // middleware logs with `{ clear: true }`), because the `✖ Invalid project
    // file` verdict printed for the same edit is the record that outlives it.
    clearScreen: false,
    // Registry-standalone SDK loadability (WORK.md, measured by the donut
    // build 2026-08-28): a NON-checkout-linked project installs @vgai/* from
    // the registry as PUBLISHED TS SOURCE under node_modules. The project-
    // module loader is `vite.ssrLoadModule`, and Vite externalizes
    // node_modules in SSR — handing the .ts files to Node, whose type
    // stripping refuses anything under node_modules. So a standalone project
    // could not run its own tool contributions (`project.bake.*`,
    // `vgai screenshot <module>`) until a checkout link existed. noExternal
    // keeps every @vgai package inside Vite's own SSR transform, where TS
    // source is ordinary input; a checkout link resolves outside
    // node_modules and never hit the wall, which is why only registry
    // installs were broken.
    ssr: { noExternal: [/^@volter\//] },
    // This Vite instance transforms not only project TSX (which uiOidPlugin
    // already sends through automatic JSX) but also the installed engine's
    // React bridge. Vite/esbuild otherwise compiles that dependency source to
    // `React.createElement` even though the canonical bridge uses named React
    // imports and intentionally has no global `React` binding. Keep Fast
    // Refresh out (the custom app has no preamble host), but make the JSX
    // runtime explicit for every TSX module served through this graph.
    esbuild: { jsx: 'automatic' },
    // ONE ordered list with `dev.ts` (`project-serving-plugins.ts`) — the two
    // hand-maintained lists drifted apart three times, each time as a silent
    // capability hole under a registry install only. `packagedOnly` is what
    // this host genuinely adds: the shared-React redirect, the two source-write
    // route plugins `dev.ts` instead reaches through its repo-root
    // `configFile:`, and the synthetic module doorways that bridge the shell's
    // prebuilt bundle to this separate, project-rooted graph.
    plugins: createProjectServingPlugins({
      projectRoots: () => projectRoots,
      // A THUNK, like every other project-scoped plugin: `onProjectOpened`
      // below moves `currentProjectRoot` when a session switches project, and a
      // boot-time snapshot would keep resolving an INGEST root's
      // out-of-manifest sources, the reported `resourcePath` of a write, and
      // the shared-session path gate against the project this process started
      // on.
      currentProjectRoot: () => currentProjectRoot,
      packagedOnly: {
        // Omitted (`null`) only when this dist predates the shared-React
        // chunks, which the boot warning above names.
        sharedReactUrls: sharedReactSpecifierUrls,
        // Omitted (`null`) only when this dist predates the shared-three chunk
        // (the boot warning above names it).
        sharedThreeUrl: sharedThreeSpecifierUrl,
        editorPackageRoot,
        checkoutRoot,
        doorways: PACKAGED_MODULE_DOORWAYS,
      },
      // Always registered here — a project is ALWAYS open in packaged mode,
      // unlike dev.ts's conditional-on-boot-time-projectPath gate. No
      // `watchDir`: this instance's Vite root IS the project.
      scriptHmr: { projectRoot: () => currentProjectRoot },
      contributed: contributedServing,
    }),
    optimizeDeps: {
      // C3 (phase-b/c3-r3f-packaged) — SCOPED auto-discovery, not disabled
      // discovery. This used to be `noDiscovery: true` (see git history for
      // the pre-C3 version of this comment): that flag disabled Vite's
      // AUTO-prebundling entirely — both the boot-time crawl AND the lazy,
      // on-request discovery of new bare specifiers — because the DEFAULT
      // crawl target (the project's own `index.html`) follows everything
      // dynamically reachable from it, including the project's `server/`
      // room code (a scaffolded project's `src/main.ts` dynamically imports
      // `../server/rooms` behind a `?net=p2p-host` URL-param branch — a
      // branch esbuild's scanner still statically follows), whose colyseus
      // server transitive deps (`@colyseus/core` -> `@pm2/io`) have no
      // browser-resolvable entry and crash the esbuild prebundle step
      // (`Failed to resolve entry for package "@pm2/io"`).
      //
      // That worked for the react-only CJS fix (C1) because the fix could be
      // fully hardcoded: react/react-dom are ALWAYS present (the editor
      // itself depends on them). It does NOT work for R3F (or any other
      // ecosystem a project's own `package.json` happens to pull in): this
      // server can't hardcode `@react-three/fiber` into `include` for every
      // possible project — most projects don't have it installed, and Vite
      // errors on `include`-ing a dep that isn't there.
      //
      // The actual fix: scope the CRAWL, don't disable it. `entries` below
      // points the crawl at the OPENED PROJECT's own manifest-declared world
      // entry files (`computeProjectOptimizeDepsEntries` /
      // `project-optimize-deps-entries.ts`) instead of `index.html` — the
      // exact per-world mount code the editor's binding-resolver dynamically
      // imports for Play mode (NEVER the project's own `src/main.ts`
      // bootstrap, which is a standalone-build concern this Vite instance
      // never serves anyway — the editor's own prebuilt SPA answers `/`).
      // A world entry's import graph can reach real client packages
      // (`react`, `@react-three/fiber`, `@react-three/drei`, a legitimate
      // client `@colyseus/sdk` import for real multiplayer) but never
      // `server/` — see `project-optimize-deps-entries.ts`'s doc comment for
      // the empirical proof (a direct `vite.optimizeDeps` run) that this
      // scoping avoids the `@pm2/io` crash for a colyseus-bearing project
      // while a `@react-three/fiber`-bearing world's CJS transitive deps
      // (`use-sync-external-store` and friends) get discovered and
      // prebundled automatically — no allowlist, adapts to whatever the
      // opened project actually has installed.
      //
      // `include` below is now a MINIMUM baseline, not the only mechanism:
      // React's JSX-runtime specifiers are INJECTED by the JSX transform
      // (not written as literal source imports), so even an entries-scoped
      // crawl does not reliably discover them on its own — the repo-root
      // `vite.config.ts` / template `vite.config.ts` `optimizeDeps.include`
      // carry the identical comment/list for the same reason. Kept
      // unconditional (not project-conditional) since react/react-dom are
      // always present (the editor's own react-world mount runtime depends
      // on them regardless of what a given project uses).
      //
      // `react-dom` (bare, NOT just `/client`) was added for C1
      // (`phase-b/c1-react-mount`): `vite-plugin-module-doorways.ts`'s
      // synthetic `/__vgai-react-world-runtime` module re-exports `flushSync`
      // from bare `react-dom` (the same peer `react-dom/client`'s `createRoot`
      // comes from — `design-time-layers.ts`'s react-world layer mount needs
      // it from that SAME installed package). Confirmed live at the time:
      // a real-browser Playwright run against a tarball-installed,
      // checkout-absent packaged editor threw exactly `SyntaxError: The
      // requested module '/node_modules/react-dom/index.js' does not
      // provide an export named 'flushSync'` at Play-mode mount before this
      // entry was added.
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        // ^ the GAME's React, and it stays prebundled: the game mounts into
        // its own isolated tree with its own development React and reconciler
        // (see the `sharedReactPlugin` registration above for why the editor
        // shell's production React must not reach it).
        //
        // A scaffold's project-authored client modules are loaded lazily by
        // the prebuilt editor. They are outside the manifest-world entry
        // crawl above, so a cold install otherwise discovers what they import
        // in waves and Vite hard-reloads the controlling tab each time.
        // The editor's own widget kit is NOT here — it renders in the editor's
        // own React tree, so it is `exclude`d below and source-served, which is
        // the only way `sharedReactPlugin`'s scope reaches its React imports.
        // Its dependency closure is deliberately shallow (react plus the widget
        // files — see `src/widgets/index.ts`'s header), so source-serving it
        // costs a round of module requests, not a discovery wave. The ENGINE
        // subpaths these modules import are handled a third way — as crawl
        // `entries` (see `LAZY_ENGINE_CRAWL_SUBPATHS`), because `include`-ing an
        // engine module prebundles a second copy of everything it reaches,
        // which is exactly the split WorldProvider identity the `exclude`
        // below exists to prevent.
        //
        // Project tool contributions load this after the shell is visible;
        // discovering it then would invalidate the already-loaded React graph.
        'zod',
        // The story runtime (`/__vgai-story-runtime`) re-exports
        // `@storybook/react`, which a project's CSF files import ONLY as
        // types (erased) — so the entries crawl never discovers it, and the
        // first story preview/capture of a session would otherwise trigger a
        // second optimization wave and hard-reload the controlling tab
        // mid-command. Conditional because Vite errors on `include`-ing a
        // package that isn't installed, and `@storybook/react` is a
        // devDependency a project may legitimately not have (it then has no
        // usable stories, and the story lane reports the missing package by
        // name — story-dom-runtime.ts).
        ...(projectHasPackage(projectPath, '@storybook/react') ? ['@storybook/react'] : []),
        // The editor's own synthesized runtime modules' packages (`three`,
        // `@react-three/fiber`, … — whatever those module bodies actually
        // import, read from the bodies themselves). Same installed-only gate
        // as the two conditionals above, for the same reason.
        //
        // `three` is dropped from this list when the shared-three redirect is
        // active (`sharedThreeSpecifierUrl`): it moves to `exclude` below so
        // Fiber's own `import 'three'` is externalized onto the shell's one
        // copy, and a specifier cannot be both `include` and `exclude`. The
        // three ADDONS stay included — they prebundle fine, and their internal
        // `import 'three'` is the externalized one. When no shared-three chunk
        // exists (old dist), three stays included/prebundled as before.
        ...(sharedThreeSpecifierUrl
          ? editorRuntimeIncludes.filter((specifier) => specifier !== 'three')
          : editorRuntimeIncludes),
      ],
      // Installed engine entry points include TSX. Dependency optimization
      // is a separate esbuild pipeline from Vite's top-level `esbuild`
      // option, so it needs the same automatic runtime explicitly.
      // `loader['.js'] = 'jsx'` is the SCANNER half of the JSX-in-`.js`
      // acceptance (`projectJsxInJsPlugin` in the plugin list above is the
      // transform half, and `project-validation.ts`'s `sourceLoader` the
      // validate half — the plugin's header names all three and why fixing
      // one alone leaves the others red). `dev.ts` has carried it since the
      // transform landed; this host had neither, so a CRA-era ingested game
      // under a registry install died at its first `.js` file.
      esbuildOptions: { jsx: 'automatic', loader: { '.js': 'jsx' } },
      // Spelled root-relative wherever the file is under the project, because
      // Vite reads the whole list as ONE decision: one entry that parses as a
      // glob pattern (a project at `~/my (game)`) sends every entry through
      // `glob()`, whose `**/node_modules/**` ignore silently drops the
      // engine-source crawl entries below. See `viteOptimizeDepsEntries`.
      entries: viteOptimizeDepsEntries(projectPath, [
        ...projectOptimizeDepsEntries,
        ...runtimeSourceCrawlEntries,
        ...packageContributionCrawl.entries,
      ]),
      // C3 hardening: belt to the entries-scoping suspenders. Entries-scoping
      // ALREADY keeps the crawl out of `server/` for a well-formed project
      // (so the colyseus server stack is never reached), but a project that
      // VIOLATES D2 by value-importing `server/` room code FROM a world entry
      // would drag `@colyseus/core` -> `@pm2/io` into the crawl and crash the
      // esbuild prebundle step — which, unhandled in the async optimizer,
      // hard-kills the whole packaged process (the only authoring surface).
      // Excluding these SERVER-ONLY names stops esbuild crawling into them, so
      // that pathological world degrades to a benign in-browser import failure
      // instead of process death. Does NOT include `@colyseus/sdk` — the
      // legitimate CLIENT SDK a real multiplayer project imports (D2, dynamic-
      // imported) must still prebundle; it is a separate package and its path
      // is untouched. See `project-optimize-deps-entries.ts`'s
      // `SERVER_ONLY_PREBUNDLE_EXCLUDE` doc comment for the live proof.
      exclude: [
        ...SERVER_ONLY_PREBUNDLE_EXCLUDE,
        // ONE three for the whole page. Excluding `three` externalizes it out
        // of every prebundled chunk (notably `@react-three/fiber`'s), so those
        // chunks' `import 'three'` is resolved at serve time by
        // `sharedThreePlugin` and lands on the shell's single published copy
        // instead of a second `.vite/deps/three.js`. Only when the shell
        // actually published that chunk — otherwise three must stay prebundled
        // (there is nothing to redirect to). See `../vite-plugin-shared-three.ts`.
        ...(sharedThreeSpecifierUrl ? ['three'] : []),
        // The editor's own widget kit, the API's fourth face. A PREBUNDLED
        // package bakes its React import at prebundle time, where
        // `sharedReactPlugin`'s source-level scope can never reach it — and
        // this kit renders inside the EDITOR's React tree, so a prebundled
        // copy is a second React and the crash box that plugin exists to
        // remove. Source-served, its `react` import resolves through the
        // plugin like any other editor-tree module. (It is listed with the
        // SDK's other doors below for the same reason; the name is here
        // because the kit is the one a PROJECT's own contributions import.)
        '@volter/editor-sdk/widgets',
        // The Blender engine spawns its worker as
        // `new Worker(new URL('./worker.ts', import.meta.url))`. Prebundled,
        // that URL is rewritten against a `.vite/deps` chunk that has no
        // worker beside it, and the request 404s — measured 2026-09-20 from a
        // REGISTRY install (invisible from a checkout, where the package is a
        // symlink Vite serves as source): every Model document died with
        // "Blender worker failed: the worker script did not load". Served as
        // source, the URL resolves to the package's own file.
        //
        // THIS LIST IS THE KIT'S, AND A PRODUCT ADDS NOTHING TO IT (measured
        // 2026-09-21, WORK.md step 3 P1). This instance is rooted at the
        // PROJECT and prebundles what the PROJECT's graph reaches: a package
        // the project DECLARES, whose contributions are served `/@fs/` from its
        // own install — which is how `@volter/editor-blender` gets here, and why the
        // name below is a fact about a project's dependency rather than about
        // any composition. A package the PRODUCT composes is in the product's
        // built bundle, which this instance never transforms, so no
        // product-declared dependency needs an exclusion and there is no
        // `vgai.product.optimizeDepsExclude` to declare one with.
        '@volter/blender-engine',
        '@volter/blender-engine/browser',
        '@volter/editor-sdk/layouts',
        '@volter/editor-sdk/layout-arrangements',
        // The SDK's OTHER doors, same rule: each holds module state or calls
        // React hooks, and a prebundled copy would carry the PROJECT's React
        // into the editor's tree — measured 2026-09-17 as "Cannot read
        // properties of null (reading 'useSyncExternalStore')" from a package
        // contribution's status item, whose `@volter/editor-sdk/host` had been
        // prebundled with `.vite/deps/react.js` inside it.
        '@volter/editor-sdk/host',
        '@volter/editor-sdk/contributions',
        '@volter/editor-sdk/commands',
        '@volter/editor-sdk/looks',
        // Engine imports this project cannot resolve — the guard that lets the
        // engine-source crawl entries above be safe. An unresolvable bare
        // import makes Vite's discovery THROW ("imported but could not be
        // resolved"), which rejects the boot-time `optimizeDeps()` barrier
        // below and kills the process; excluding the name externalizes it in
        // the scanner instead, degrading one optional engine feature in the
        // browser rather than the whole editor. See
        // `computeUnresolvableRuntimeImports`.
        ...unresolvableRuntimeImports,
        ...packageContributionCrawl.unresolvable,
        // The project's runtime-package source is the document-side module
        // graph. Keep every subpath source-served so an arbitrary project
        // import cannot create a second prebundled WorldProvider identity.
        // React/Fiber themselves remain prebundled and deduped above.
        //
        // The scanner matches the RAW specifier before any alias runs, so a
        // package left out here is prebundlable — which is how eight runtime
        // modules (`world3d-react`, `runtime/mount-game`, …) once sat in
        // `.vite/deps` beside their source-served twins, each chunk carrying
        // its own bundled `react/world-state` `GameContext`.
        ...RUNTIME_PACKAGE_NAMES,
      ],
    },
    resolve: {
      // `configFile: false` deliberately ignores the project's Vite config,
      // so reconstruct the template's renderer identity contract here. Fiber,
      // Drei, the installed engine and the world must share these instances.
      // The runtime packages are in the list for the same
      // WorldProvider/`useGame` singleton the checkout-rooted `dev.ts` path
      // gets from repo-root `vite.config.ts` (see that file's dedupe comment).
      // The alias below already points each specifier at the project's own
      // installed source when it resolves; dedupe is the remaining collapse
      // for a nested copy that alias resolution still walks into.
      dedupe: [
        '@volter/editor-sdk',
        ...RUNTIME_PACKAGE_NAMES,
        'react',
        'react-dom',
        'three',
        '@react-three/fiber',
        'pixi.js',
        '@pixi/react',
      ],
      alias: [
        // The editor's own deep specifiers a project contribution still
        // names — `@editor/game-module-access`, and the R3F analyzer a
        // project's `check-idioms` loads (the scaffolder writes the matching
        // tsconfig path). The widget kit is NOT among them any more: it is
        // `@volter/editor-sdk/widgets`, an ordinary package export. In checkout
        // mode the root Vite config supplies this alias; this project-rooted
        // packaged Vite instance has no configFile, so it must reconstruct
        // the runtime half from its own package root.
        { find: /^@editor\//, replacement: `${path.join(editorPackageRoot, 'src')}/` },
        // Each runtime package resolves to THIS project's installed copy.
        // Keeping one source root per package is what preserves React/Fiber
        // singleton identity in Play mode.
        ...[...runtimeSources].map(([name, src]) => ({
          find: new RegExp(`^${name.replace('/', '\\/')}(?=\\/|$)`),
          replacement: src,
        })),
      ],
    },
    server: {
      middlewareMode: true,
      // `overlay: false` for the same product reason as `dev.ts`'s instance:
      // this server's project modules load into the SAME page as the packaged
      // editor shell, so Vite's full-screen error overlay would cover the
      // editor whenever the game fails to compile. `overlay` is the CLIENT
      // overlay only — HMR itself (and therefore `vgai-script-hmr`'s WebSocket
      // delivery, which the header note above says `hmr: false` would kill)
      // stays fully on.
      hmr: { port: HMR_PORT, clientPort: HMR_CLIENT_PORT, overlay: false },
      // OFF because the shared-React doorway makes it structurally broken in
      // THIS instance — see `vite-plugin-shared-react.ts`. Every editor-tree
      // module's `react`/`react/jsx-runtime` import is resolved to the prebuilt
      // shell's own chunk URL (`/assets/vgai-shared-*.js`), which the BROWSER
      // fetches from `express.static(dist)` below and this project-rooted Vite
      // deliberately cannot resolve. Import analysis then hands each of those
      // URLs to `warmupRequest`, which resolves them against the project root,
      // fails, and logs a formatted `Pre-transform error` — measured on a fresh
      // scaffold: 64 of them from ONE `src/contributions/*.inspector.tsx` request,
      // because nothing caches a failed warmup and each import site retries it.
      //
      // The plugin already opts out of Vite's dependency SCAN for exactly this
      // reason (`options.scan` — the scanner recorded the URL as a file to
      // prebundle and died on ENOENT). Pre-transform is the same class of
      // server-side pass following a browser-only redirect, but Vite exposes no
      // per-request opt-out, and the alternative — teaching this Vite to LOAD
      // those URLs from `dist/` — is worse than the noise: each doorway chunk
      // imports the shell's own `./index-*.js`, so satisfying one warmup drags
      // the entire prebuilt SPA into the project's dev module graph, which is
      // the exact separation this file's two-graph design exists to keep.
      //
      // What is given up is latency-only: known static imports are transformed
      // when the browser asks instead of just before. The editor reaches the
      // project through DYNAMIC imports (tool contributions, world entries,
      // stories), which pre-transform skips anyway, and this instance declares
      // no `server.warmup` list (which the same flag would have disabled).
      preTransformRequests: false,
      // Watch source; never watch output — the same list as `dev.ts`'s
      // instance, for the same product reason: a build (`npm run build`,
      // `vercel build`) rewriting output HTML inside the project root reads
      // as a source change and full-page-reloads the editor tab out from
      // under whatever it was doing.
      watch: {
        ignored: [
          // Scratch HTML/tsconfig writes must not reload the active editor.
          (filename: string) => isProjectScratchPath(filename, projectRoots),
          '**/.claude/worktrees/**',
          '**/.vercel/**',
          '**/dist/**',
          '**/dist-ssr/**',
          '**/dist-wip/**',
          '**/logs/**',
        ],
      },
      fs: {
        allow: [
          ...projectFsRoots,
          // The `@editor/*` deep specifiers above are source-served, so this
          // package's own `src/` must be readable even when it does not sit
          // under the project's own resolved `node_modules`.
          editorPackageRoot,
          // Source mode serves the product and every package it composes from the checkout.
          ...(fromSource ? [checkoutRoot] : []),
        ],
      },
    },
  };

  // This is a custom, prebuilt SPA host: unlike Vite's normal HTML-serving
  // path, nothing asks the project-rooted middleware server for an HTML entry
  // before the editor begins importing its virtual runtime modules. Finish the
  // entries-scoped optimizer pass first so every project module sees one
  // browser hash from the first request. Without this barrier, the synthetic
  // React/R3F runtime can load against the provisional hash while the world
  // entry loads against the scan's committed hash, producing two React/Fiber
  // graphs and an invalid-hook-call failure on a clean packaged install.
  if (fromSource) {
    // The product's composition (`vgai:contributions/<package>`) and its module workers, which
    // its production build resolves with the same plugin and format.
    viteInlineConfig.plugins = [...(viteInlineConfig.plugins ?? []), productContributionsPlugin()];
    viteInlineConfig.worker = { ...viteInlineConfig.worker, format: 'es' };
    console.log(`  Source mode: ${sessionProductIdentity.name} from ${productSourceEntry}`);
  }
  const resolvedViteConfig = await resolveConfig(viteInlineConfig, 'serve');
  await optimizeDeps(resolvedViteConfig);
  const vite = await createViteServer(resolvedViteConfig);

  // 2. Mount editor API routes (/__editor/*). `engineRoot` identifies the
  //    running packaged editor for runtime capability checks.
  const editorRouter = createEditorServer({
    engineRoot: editorPackageRoot,
    projectPath,
    collaborationPort: PORT,
    // This host DOES serve the `/__ui-source/*` recorder (`uiOidPlugin()` is
    // registered above), and saying so is what makes design-time edits write
    // the game's own TSX under a registry install. Read off the resolved
    // plugin list rather than hardcoded `true`, so removing the plugin can
    // never leave a flag claiming a route that is gone.
    sourceWriteRoutes: vite.config.plugins.some((plugin) => plugin.name === SOURCE_WRITE_ROUTES_PLUGIN),
    // And the ingest lane's route, off the same resolved list — this host
    // registers `creationSiteWritePlugin()` above, and saying so is what lets an
    // ingest edit be written into the game's own source under a registry
    // install instead of reporting the live-only floor forever.
    ingestSourceWriteRoutes: servesIngestSourceRoutes(vite.config.plugins),
    // Tab bijection — same session contract as dev.ts: one blessed browser
    // tab, self-healed and closed with the session; VGAI_NO_OPEN (the CLI's
    // --no-open) disables the whole loop for headless sessions.
    tabBijection: {
      enabled: !process.env['VGAI_NO_OPEN'],
      // Same contract as dev.ts: under the frame this session's ONE tab is the
      // workbench page, and the url is arithmetic over the reserved proxy port.
      editorUrl: frameLaunch ? frameWorkbenchUrl(frameLaunch, projectPath) : `${EDITOR_ORIGIN}/`,
    },
    // The session's children are the session's to report (`vgai status`).
    workbench: () => frameWorkbench?.identity ?? null,
    // The serving door (routes/served-modules.ts), same contract as dev.ts:
    // where the Code-OSS frame finds the editor. Registered on BOTH bundler
    // hosts deliberately — a capability that exists on one and not the other is
    // the drift `project-serving-plugins.ts`'s header was written about. Here
    // the answer is the PRODUCTION BUILD's frame entry (WORK.md §U3), reached
    // through the wrapper below rather than directly, because the built entry's
    // stylesheet has no HTML of ours to be injected into.
    frameBridgeUrl: () => {
      if (!fromSource) readBuiltProductEntry(distPath, sessionProductIdentity);
      return FRAME_BRIDGE_PACKAGED_PATH;
    },
    // The session's children are its to report: which product it is serving,
    // beside which workbench it is running.
    product: () => ({
      id: sessionProductIdentity.name,
      dir: sessionProductIdentity.dir,
      version: sessionProductIdentity.version,
      command: sessionProductIdentity.command,
      displayName: sessionProductIdentity.displayName,
    }),
    loadProjectModule: freshProjectModuleLoader(vite, () => projectPath),
    // Same contract as dev.ts: a dependency installed under a live session
    // (`vgai add <capability>`) is invisible until the SSR module graph, which
    // caches even a REJECTED module load, is dropped.
    invalidateProjectModules() {
      vite.environments.ssr.moduleGraph.invalidateAll();
      console.log('[vgai-editor] project dependencies changed; reloaded project modules.');
    },
    onProjectOpened(newProjectPath: string) {
      const allowed = vite.config.server.fs.allow;
      // The newly opened project's OWN install roots, not just its folder —
      // a project switched into at runtime has exactly the hoisting/symlink
      // shapes the boot-time set above exists for.
      for (const root of projectServingRoots(newProjectPath)) {
        if (!allowed.includes(root)) allowed.push(root);
      }
      projectRoots.add(newProjectPath);
      vite.watcher.add(newProjectPath);
      currentProjectRoot = newProjectPath;
      // Session parity with dev.ts (D12): keep the registry pointing
      // at the CURRENT project so `vgai edit`/`sessions`/cwd-resolution see
      // switches, not boot state — same call, same shape.
      registerSession({
        project: newProjectPath,
        port: PORT,
        pid: process.pid,
        startedAt: sessionStartedAt,
      });
    },
  });
  servingEditorRouter = editorRouter;
  app.use(editorRouter);

  // 3. The project-rooted Vite instance — handles `/@fs/`, `/@id/`, and any
  //    request matching a real file under the project root (module
  //    transform + bare-specifier resolution through the PROJECT's own
  //    node_modules). `appType: 'custom'` means it calls `next()` instead of
  //    synthesizing an HTML/404 response for anything else, so requests for
  //    the editor's OWN app (`/`, `/assets/*`) fall through to step 4.
  app.use(vite.middlewares);

  // 3b. The Code-OSS frame's entry into this build (routes/served-modules.ts
  //     answers this url). Generated per request rather than emitted at build
  //     time, because both halves it needs — the hashed chunk and its
  //     stylesheets — are facts about the `dist/` this process is serving.
  app.get(FRAME_BRIDGE_PACKAGED_PATH, (_req, res) => {
    let body: string;
    try {
      body = fromSource
        ? `// Source mode: the product's own entry, served by the project Vite.\nexport * from ${JSON.stringify(`/@fs${productSourceEntry}`)};\n`
        : builtFrameBridgeModule(readBuiltProductEntry(distPath, sessionProductIdentity));
    } catch (error) {
      // The door already reports this sentence as a refusal; a direct fetch of
      // this url gets it too rather than an empty 200 that imports nothing.
      res
        .status(503)
        .type('text/plain')
        .send(error instanceof Error ? error.message : String(error));
      return;
    }
    res.type('text/javascript').set('Cache-Control', 'no-store').send(body);
  });

  // 4. Serve the PRODUCT's prebuilt chunks (static — no dev-mode transform of
  //    editor or product source; see this file's header doc comment). The
  //    module served at step 3b re-exports one of these by its hashed name.
  app.use(express.static(distPath));

  // 5. Start Express
  const sessionStartedAt = new Date().toISOString();
  const server = app.listen(PORT, HOST, () => {
    void (async () => {
      console.log(
        `\n  \x1b[32mEditor server\x1b[0m (packaged) running at \x1b[36m${EDITOR_ORIGIN}\x1b[0m`,
      );
      console.log(`  \x1b[33mProject\x1b[0m: ${projectPath}`);
      console.log(`  \x1b[33mEditor\x1b[0m: \x1b[36m${EDITOR_ORIGIN}/\x1b[0m\n`);
      if (idleShutdown.armed) {
        console.log(
          `  Idle shutdown after ${formatIdleWindow(resolveIdleShutdownMs())} with no connected ` +
            `editor tab and no request (${IDLE_SHUTDOWN_MINUTES_ENV}=0 disables)\n`,
        );
      }
      // D12: announce this session so `vgai edit`/`sessions`/`play`
      // (cwd-resolution) see the packaged runtime exactly like dev.ts's.
      registerSession({
        project: projectPath,
        port: PORT,
        pid: process.pid,
        startedAt: sessionStartedAt,
      });
      // The workbench, last and for the same reason dev.ts starts it last: it
      // is the slowest thing this boot does, and a frame that cannot start is a
      // `vgai edit` that has failed (frame-workbench.ts states the ownership).
      if (frameLaunch) {
        // THE AGENT'S RUNTIME COMES FIRST — same reason as dev.ts: an extension
        // host inherits its server's environment and that environment is fixed
        // at spawn (frame-workbench.ts's `env`, frontend-handoff.ts's header).
        const handoff = await editorRouter.frontendHandoff();
        if (handoff.refusal) console.log(`  \x1b[33mAgent\x1b[0m: ${handoff.refusal}`);
        try {
          frameWorkbench = await startFrameWorkbench({
            launch: frameLaunch,
            projectRoot: projectPath,
            sessionPort: PORT,
            env: handoff.env,
            log: (line) => console.log(`  ${line}`),
          });
          console.log(`  \x1b[33mWorkbench\x1b[0m: \x1b[36m${frameWorkbench.url}\x1b[0m\n`);
        } catch (error) {
          // biome-ignore lint/suspicious/noConsole: the frame's refusal IS the product here — this terminal is the only surface that exists yet.
          console.error(
            `\n  \x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`,
          );
          process.exit(1);
        }
      }
    })();
  });

  // The tab's duplex control socket rides this same HTTP server — an
  // `upgrade` for `/__editor/events`, routed by pathname so every other
  // upgrade (Vite's HMR socket) passes through untouched.
  editorRouter.attachControlSocket(server);

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`\n  \x1b[31m${friendlyListenError(err, PORT, HOST, 'PORT')}\x1b[0m\n`);
    process.exit(1);
  });

  // Self-healing registration — same rationale and cadence as dev.ts: the
  // registry's unlocked read-modify-write can lose this entry to a concurrent
  // writer's interleaved write, leaving a healthy server invisible to
  // `vgai edit`/`sessions`/`close`; re-asserting once a minute heals it.
  const reregisterTimer = setInterval(() => {
    registerSession({
      project: currentProjectRoot,
      port: PORT,
      pid: process.pid,
      startedAt: sessionStartedAt,
    });
  }, 60_000);
  reregisterTimer.unref();

  // Best-effort, and nothing but the HTTP server waits on it — see dev.ts's
  // note at its own `tabNotice` for the measurement (a `vgai close` under load
  // died inside this notify, the shutdown list never ran, and the Code-OSS
  // server outlived the session on its reserved port).
  let tabNotice: Promise<void> | null = null;
  const shutdown = createProcessShutdown({
    journal: (record) => editorRouter.journalShutdownTask(record),
    tasks: [
      { name: 'tab-close notice', run: () => tabNotice ?? undefined },
      {
        name: 'http server',
        run: async () => {
          // The `tab-close` write needs a live SSE socket, and closing the
          // server takes those sockets down: this ORDER is the only dependency
          // on the notice anywhere in the list.
          await tabNotice;
          await closeHttpServer(server);
        },
      },
      // THE ONE TEARDOWN for the REH and the proxy (frame-workbench.ts's
      // ownership note) — the path `vgai close`, SIGTERM and the idle timer
      // all take. The detached CHILD waits on nothing; the proxy is the tab's
      // route and waits with the HTTP server.
      { name: 'Code-OSS server', run: () => frameWorkbench?.stopServer() },
      {
        name: 'one-origin proxy',
        run: async () => {
          await tabNotice;
          await frameWorkbench?.closeProxy();
        },
      },
      {
        name: 'editor router',
        run: async () => {
          // The other half of the notice's dependency: `close()` takes the
          // control plane down and the `tab-close` push rides it. See dev.ts's
          // `tabNotice` for the measurement (acked ~26ms ordered, unacked at
          // the full 2s budget when it races).
          await tabNotice;
          await editorRouter.close();
        },
      },
      { name: 'vite', run: () => vite.close() },
    ],
  });
  let shutdownStarted = false;
  const unregisterAndShutdown = (signal: string) => {
    // A repeat signal is not a new instruction — see dev.ts's note at its own
    // handler registration for the measurement behind this latch.
    if (shutdownStarted) return;
    shutdownStarted = true;
    idleShutdown.stop();
    clearInterval(reregisterTimer);
    unregisterSession(process.pid);
    // Tab bijection: session-end notice to the blessed tab.
    // No-op after /__editor/tab/expect-restart.
    tabNotice = editorRouter.notifyTabSessionEnded().catch((error) => {
      console.error(
        `[vgai-editor] tab-close notice failed: ${error instanceof Error ? error.message : error}`,
      );
    });
    void shutdown(signal);
  };
  // The idle timer's ONE exit: the same function a signal takes, plus the
  // honest line naming why the session ended (dev.ts prints this from its
  // shared `lastGasp`; this host has no such line, so the idle path says it).
  onIdleShutdown = (why) => {
    console.error(`[vgai-editor] shutting down (${why}) — pid ${process.pid}, port ${PORT}`);
    unregisterAndShutdown(why);
  };
  process.on('SIGINT', () => unregisterAndShutdown('SIGINT'));
  process.on('SIGTERM', () => unregisterAndShutdown('SIGTERM'));
  process.once('exit', () => {
    idleShutdown.stop();
    clearInterval(reregisterTimer);
    unregisterSession(process.pid);
  });
}

main().catch((err) => {
  console.error('Failed to start packaged editor server:', err);
  process.exit(1);
});
