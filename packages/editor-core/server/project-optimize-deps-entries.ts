// C3 (phase-b/c3-r3f-packaged) — the adaptive `optimizeDeps.entries` source
// for `packaged.ts`'s project-rooted Vite instance. See that file's header
// doc comment, "optimizeDeps" section, for the full crawl-vs-crash story;
// this module only computes WHICH files to scope the crawl to.

import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { EDITOR_LANE_DIRS } from '@volter/editor-sdk/session/tool-contribution-convention';
import { isDynamicPattern } from 'tinyglobby';
import { loadGameManifestDir } from '@volter/editor-project/manifest/load-file';
import { doorwayModuleSource, PACKAGED_MODULE_DOORWAYS } from '../vite-plugin-module-doorways';
import { isToolContributionModule, projectStorySourceDirs } from './server-utils';
import { ADAPTER_MODULE_FILENAME } from '../src/ui-source/adapter-region-includes';

/**
 * SERVER-ONLY packages that must never be crawled INTO during the client
 * dep-prebundle — passed to `optimizeDeps.exclude` in `packaged.ts` (C3
 * hardening follow-on). Belt to the entries-scoping suspenders.
 *
 * ## The pathological case this closes
 *
 * The entries-scoping fix (`computeProjectOptimizeDepsEntries` below) makes
 * the crawl start ONLY from a project's declared world entries — which
 * NORMALLY never reach `server/` code, so the colyseus server stack
 * (`colyseus` -> `@colyseus/core` -> `@pm2/io`) is never crawled and the
 * esbuild-scanner crash that `noDiscovery: true` used to guard against never
 * fires. But if a project VIOLATES the repo's D2 rule (CLAUDE.md
 * "Networking": client code calls Colyseus via the CLIENT SDK
 * `@colyseus/sdk`, dynamic-imported, and NEVER value-imports the `server/`
 * room classes) by having a WORLD ENTRY statically `import` from `server/`,
 * the crawl reaches `@colyseus/core`'s `Stats.mjs`, whose `import("@pm2/io")`
 * has no resolvable browser entry, and esbuild's prebundle step THROWS from
 * inside the async optimizer — which, unhandled, HARD-KILLS the whole
 * packaged node process (the only authoring surface). That is a strictly
 * harsher degrade than the old `noDiscovery: true`, which at least still
 * booted an editor.
 *
 * `exclude`-ing these three names keeps esbuild from crawling into them
 * during prebundle: even a world entry that (wrongly) reaches them no longer
 * crashes the scanner — the offending world degrades to a benign browser-
 * side runtime import failure for that ONE world, and the editor process
 * survives and serves everything else. Verified live (a real, checkout-
 * absent packaged boot against a project whose world entry value-imports
 * `server/rooms`): without this list the server process dies at boot; with
 * it, the server boots and serves.
 *
 * CRITICAL: this list must NOT contain `@colyseus/sdk` — that is the
 * legitimate CLIENT SDK a real multiplayer project's own game code imports
 * (dynamic-imported per D2; e.g. `examples/third-person-arena/src/
 * network.ts`). It is a SEPARATE package from `@colyseus/core` — its own
 * published `build/index.mjs` is a self-contained client bundle — and MUST
 * still prebundle so those projects work. Excluding only the server-side
 * names leaves the client SDK's prebundle path untouched (proven: a world
 * entry importing `@colyseus/sdk` still prebundles it cleanly with this
 * exclude list active).
 */
export const SERVER_ONLY_PREBUNDLE_EXCLUDE: readonly string[] = [
  'colyseus',
  '@colyseus/core',
  '@pm2/io',
];

/**
 * The project-relative runtime WORLD entries shared by dependency discovery
 * and source warmup, for the project rooted at
 * `projectRoot` — every `roots[].entry` its OWN `vgai.project.json` declares
 * (default-adapter, code-authored roots; scene-only roots have no `entry`
 * and contribute nothing here — their gameplay code is registered
 * elsewhere, reached transitively from whichever world DOES declare an
 * `entry`, e.g. the template's single world), deduped, and filtered to paths
 * that exist on disk.
 *
 * ## Why THESE files, not `index.html` or the project's own bootstrap `main.ts`
 *
 * A project's `index.html` -> `src/main.ts` bootstrap ties every declared
 * world together for the STANDALONE (`npm run game`) build, and — critically
 * — the scaffolded template's own `main.ts` also carries the P2P-Colyseus
 * URL-param branch that dynamically imports the project's OWN `server/rooms`
 * (`await import('../server/rooms')`, gated behind `?net=p2p-host`, but
 * esbuild's dependency scanner follows a string-literal dynamic `import()`
 * as an unconditional graph edge regardless of the runtime guard around it).
 * `server/rooms.ts` re-exports real Colyseus `Room` classes, whose `colyseus`
 * (SERVER package) import chain reaches `@colyseus/core` -> `@pm2/io`, a
 * package esbuild's prebundle step cannot resolve an entry for (confirmed
 * empirically, not theoretically: a direct `vite.optimizeDeps` run scoped to
 * `index.html`-style discovery against `packages/editor/template` throws
 * `Failed to resolve entry for package "@pm2/io"` from inside
 * `@colyseus/core/build/Stats.mjs`'s own `import("@pm2/io")` — this is
 * `packaged.ts`'s ORIGINAL reason for `noDiscovery: true`, verified still
 * true on this Vite version at the time of the C3 fix).
 *
 * A manifest's `roots[].entry` files never reach that chain: they are the
 * PER-WORLD mount code the editor's own binding-resolver dynamically imports
 * directly for Play mode / world mounting (never `src/main.ts` — that
 * bootstrap is the STANDALONE build's concern, unrelated to how the editor
 * itself mounts a world; see `packaged.ts`'s header doc comment). Scoping the
 * crawl to exactly these files means: (a) it never touches `server/`, so the
 * `@pm2/io` class of crash cannot occur no matter what a project's server
 * room code imports, and (b) any CJS-needing-prebundle client dependency a
 * world's own code reaches — `react`, `@react-three/fiber`, `@react-three/
 * drei`, or some future ecosystem this repo has never heard of — gets
 * auto-discovered and prebundled for free, with no per-package allowlist to
 * maintain (this is what actually fixes the R3F class of bug this file's own
 * feature exists for: `@react-three/fiber`'s CJS transitive deps like
 * `use-sync-external-store` are reached from `examples/r3f-first-party`'s
 * `src/net-entry.tsx`, never from anything server-shaped).
 *
 * The client SDK case (`@colyseus/sdk`, the package a world's own game code
 * legitimately imports for real multiplayer — e.g.
 * `examples/third-person-arena/src/network.ts`) is DIFFERENT from the
 * server-package case above and does NOT crash: `@colyseus/sdk`'s own
 * published build (`build/index.mjs`) is a self-contained client bundle that
 * does not pull in `@colyseus/core`'s server-only `Stats.mjs` (confirmed
 * empirically the same way: a full prebundle scoped to
 * `examples/third-person-arena`'s own `src/index.tsx` world entry succeeds
 * and prebundles `@colyseus/sdk` cleanly).
 *
 * ## Discovery and warmup lifetimes
 *
 * Dependency discovery computes this ONCE from the boot-time `VGAI_PROJECT`,
 * exactly like `engineSrc`/`resolve.alias` in `packaged.ts`; those settings
 * are baked into Vite's `createServer` call. Checkout-dev source warmup also
 * calls this helper after `onProjectOpened`, so a switched-to project warms
 * its own current entries even though it keeps the boot project's dependency
 * discovery configuration.
 *
 * Never throws: an absent/unparseable manifest (no project open yet, a
 * pre-Phase-B project, a broken `vgai.project.json`) degrades to `[]` — the
 * SAFEST fallback, not a guess. Per Vite's own `optimizeDeps.entries`
 * resolution (`computeEntries` in vite's dep-scanner), a truthy-but-empty
 * array short-circuits the `**\/*.html` crawl fallback WITHOUT crawling
 * anything itself, so an unreadable manifest degrades to "no auto-discovery
 * beyond the static `include` list" — the same conservative posture
 * `noDiscovery: true` had, rather than falling back to a full crawl that
 * could reach server code we know nothing about.
 */
export function computeProjectWorldEntries(projectRoot: string): string[] {
  let manifest: ReturnType<typeof loadGameManifestDir>;
  try {
    manifest = loadGameManifestDir(projectRoot);
  } catch {
    return [];
  }

  const entries = new Set<string>();
  const add = (relative: string | undefined): void => {
    if (!relative) return;
    if (!existsSync(join(projectRoot, relative))) return;
    entries.add(relative);
  };
  for (const world of manifest.roots) {
    add(world.entry);
    // THE ROOT'S OWN WORLD COMPONENT, when it declares one
    // (`world.entry`). It is a SECOND discovery root for the
    // same reason `browserToolEntries` below is: the editor's design session
    // (`authoring/r3f-design-session.ts`) dynamic-imports that file directly,
    // and nothing reachable from `entry` leads to it — an ingest `entry` is a
    // host shim whose reference to the game is deliberately a VARIABLE
    // specifier under `@vite-ignore` (so the vendored source is never
    // typechecked against this checkout's React/fiber/three), which esbuild's
    // scanner cannot follow by construction.
    //
    // Measured cold on racing-game: without this, `@react-three/cannon` is
    // never prebundled, the design mount's `import()` fails with "Failed to
    // fetch dynamically imported module", and the Scene view is a Boundary —
    // i.e. the entire design-time lane is dark on a cold dep cache.
    add(world.world?.entry);
  }
  return [...entries];
}

/**
 * Dependency discovery includes every browser-loaded project module that is
 * not reachable from a world entry: the adapter, tool contributions and portable stories.
 *
 * Stories are load-time entry points in their own right. A Pixi prefab may be
 * the project's only import of `@pixi/react`; leaving its CSF module out of
 * the initial scan lets Vite discover that renderer after the editor has
 * already loaded React, invalidating the optimized graph and producing an
 * invalid-hook-call split across optimizer generations.
 */
export function computeProjectOptimizeDepsEntries(projectRoot: string): string[] {
  const entries = new Set(computeProjectWorldEntries(projectRoot));
  // Modeling projects can have no runtime roots. Their adapter still imports
  // browser-facing layouts and looks; discover those before the first page load.
  if (existsSync(join(projectRoot, ADAPTER_MODULE_FILENAME)))
    entries.add(ADAPTER_MODULE_FILENAME);
  for (const tool of browserToolEntries(projectRoot)) entries.add(tool);
  for (const story of browserStoryEntries(projectRoot)) entries.add(story);
  return [...entries];
}

function browserStoryEntries(projectRoot: string): string[] {
  let manifest: ReturnType<typeof loadGameManifestDir>;
  try {
    manifest = loadGameManifestDir(projectRoot);
  } catch {
    return [];
  }

  const found: string[] = [];
  const walk = (directory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.stories.tsx') || entry.name.endsWith('.stories.ts'))
      ) {
        found.push(relative(projectRoot, absolute).split('\\').join('/'));
      }
    }
  };

  for (const directory of projectStorySourceDirs(projectRoot, manifest)) walk(directory);
  for (const preview of ['.storybook/preview.tsx', '.storybook/preview.ts']) {
    if (existsSync(join(projectRoot, preview))) found.push(preview);
  }
  return found.sort();
}

/**
 * The project's BROWSER-LOADED tool contribution modules — the second
 * discovery root the world-entry crawl cannot reach.
 *
 * The editor dynamic-imports a project's tool CONTRIBUTIONS (`src/contributions/
 * *.utility.tsx` cockpit cells, `*.document.tsx`, `*.inspector.tsx`, …) into
 * the browser, and those pull ordinary siblings (`src/tools/
 * dev-cockpit.utility.tsx` → `./tuning` → `@vgai/sdk/tools`). None of that
 * hangs off any `roots[].entry`, so scoping the crawl to world entries alone
 * left `@vgai/sdk/tools` undiscovered until the first cockpit mount —
 * measured 2026-08-09 on a live session: "✨ new dependencies optimized:
 * @vgai/sdk/tools" → "optimized dependencies changed. reloading", a full
 * editor reload minutes into authoring, which dropped the in-flight play
 * command (the exact class the C3 entries-scoping exists to prevent).
 *
 * The membership test is `isToolContributionModule` — the SAME predicate
 * `project-tools.ts`'s scan feeds `tool-loader.ts`'s browser dynamic-import
 * list, so "what the browser loads" stays one fact rather than a filename
 * rule kept in lockstep by hand. A negation (everything except `*.tool.ts`)
 * was measured wrong in the opposite direction: it swept each example's
 * `src/contributions/module-source.ts` — a NODE module importing `node:fs`, and
 * reachable only from a server-executed tool definition — into the browser
 * crawl, which is exactly the server-only import chain this file's scoping
 * exists to keep out. Walked recursively for the same reason
 * the loader's own scan is: a project may organise its contributions into
 * subdirectories.
 */
function browserToolEntries(projectRoot: string): string[] {
  const found: string[] = [];
  let laneDir = '';
  const walk = (directory: string, relative: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), childRelative);
      } else if (entry.isFile() && isToolContributionModule(entry.name)) {
        found.push(`${laneDir}/${childRelative}`);
      }
    }
  };
  for (const dir of EDITOR_LANE_DIRS) {
    laneDir = dir;
    walk(join(projectRoot, ...dir.split('/')), '');
  }
  return found;
}

/**
 * The list handed to `optimizeDeps.entries`, spelled so Vite takes the LITERAL
 * fast path through it.
 *
 * ## The silent degrade this closes
 *
 * Vite's `globEntries` (dep-scanner) reads the whole list as ONE decision:
 *
 * ```js
 * if (resolvedPatterns.every((str) => !isDynamicPattern(str))) {
 *   return resolvedPatterns.map((p) => normalizePath(path.resolve(root, p)));
 * }
 * return glob(pattern, { cwd: root, ignore: ['**\/node_modules/**', …] });
 * ```
 *
 * Every entry this module produces is a real file path, never a pattern — but
 * a path is a pattern's syntax too. One entry containing `(`, `[` or a leading
 * `!` makes `isDynamicPattern` true and routes ALL of them through `glob()`,
 * whose unconditional `**\/node_modules/**` ignore then drops the engine-source
 * crawl entries (`computeRuntimeSourceCrawlEntries` — they live in the project's
 * own `node_modules/@vgai/<runtime package>/src`). Nothing reports it: the boot succeeds,
 * `exclude` still holds, and cold-start discovery just quietly stops reaching
 * the engine's graph — one optimizer wave and tab reload at a time, the exact
 * class those entries exist to prevent. Measured with the real predicate
 * (tinyglobby 0.2.x, the package Vite scans with): a project at
 * `~/my (game)` or `~/my [wip]` makes every absolute entry dynamic; `{x}`,
 * `+` and spaces do not.
 *
 * ## Why relative, and NOT escaped
 *
 * Escaping the specials (`escapePath`) is the obvious fix and is WRONG here,
 * measurably: an escaped path is no longer a dynamic pattern, so Vite takes the
 * fast path and `path.resolve`s the escaped STRING — a path with literal
 * backslashes in it, which exists nowhere. That turns a dropped engine entry
 * into a dropped everything.
 *
 * The specials come from the ROOT segment of the path, not from the parts this
 * module builds, so spelling every under-root entry root-RELATIVE removes them
 * from the string Vite tests: `resolve(root, 'node_modules/@vgai/project/src/
 * loader.ts')` is the same file with no pattern syntax in the entry at all.
 * Entries outside the Vite root (the dev server's project entries) keep their
 * absolute spelling — Vite accepts absolute non-glob entries — because a
 * `../../my (game)/…` relative path would carry the same specials.
 *
 * An entry that is STILL dynamic after that (a project whose own `src` folder
 * is named `assets (new)`) has no correct spelling left, so it warns by name
 * rather than degrading silently.
 */
export function viteOptimizeDepsEntries(viteRoot: string, files: readonly string[]): string[] {
  const rootPrefix = viteRoot.endsWith(sep) ? viteRoot : `${viteRoot}${sep}`;
  const entries = files.map((file) =>
    isAbsolute(file) && file.startsWith(rootPrefix)
      ? relative(viteRoot, file).split(sep).join('/')
      : file,
  );

  const dynamic = entries.filter((entry) => isDynamicPattern(entry));
  if (dynamic.length > 0) {
    console.warn(
      `\n  \x1b[33mWarning:\x1b[0m ${dynamic.length} dependency-scan ` +
        `entr${dynamic.length === 1 ? 'y reads' : 'ies read'} as a glob pattern ` +
        `(${dynamic.join(', ')}). Vite scans the whole list with glob() when any entry ` +
        'does, and that path ignores **/node_modules/**, so the engine-source crawl entries ' +
        'are dropped and their dependencies are discovered mid-session (an optimizer wave and ' +
        'a tab reload each) instead of at boot. Renaming the path segment containing ' +
        '( ) [ ] or a leading ! restores the fast path.\n',
    );
  }
  return entries;
}

/**
 * Dependency-scan entries for the checkout-backed editor dev server.
 *
 * That Vite instance is rooted at the engine checkout, so it must keep the
 * editor's own HTML entry while also scanning the opened project's
 * manifest-declared roots. A project opened from OUTSIDE the checkout stays
 * absolute (Vite accepts absolute non-glob entries and preserves them);
 * anything under the root is spelled root-relative — see
 * {@link viteOptimizeDepsEntries} for why that spelling is load-bearing.
 */
export function computeDevOptimizeDepsEntries(
  engineRoot: string,
  projectRoot: string | undefined,
  productEntry: string | null,
  productContributions: readonly string[] = [],
): string[] {
  // THE EDITOR'S OWN ENTRY is the PRODUCT's entry: the module the Code-OSS
  // contribution imports, and the root of every editor import there is. It used
  // to be `index.html`, which crawled to the same graph through a page that no
  // longer exists. `null` when this session serves no product — then the crawl
  // is the project's alone, which is the honest answer for a session with no
  // editor to boot.
  //
  // ...AND ITS COMPOSED PACKAGES' CONTRIBUTIONS, HANDED OVER, because the crawl
  // cannot walk to them: the product names each package as a SYNTHESIZED module
  // (`vgai:contributions/<name>`), which hangs off no file, so the esbuild
  // scanner never sees the `import()` rows inside it. That is the same blindness
  // `vite-plugin-module-doorways.ts`'s header records for the other synthesized
  // module, cured the same way — from the same declaration the browser is
  // served (`server/session-product.ts`'s `productContributionFiles`). Measured
  // without it, 2026-09-21: a `--template game` boot discovered storybook's
  // preview API, three `@gltf-transform` packages and `axe-core` mid-session and
  // Vite hard-reloaded the one tab out from under the session.
  const entries = productEntry === null ? [] : [productEntry, ...productContributions];
  if (projectRoot) {
    for (const entry of computeProjectOptimizeDepsEntries(projectRoot)) {
      entries.push(join(projectRoot, entry));
    }
  }
  return viteOptimizeDepsEntries(engineRoot, entries);
}

// ---------------------------------------------------------------------------
// The EDITOR's own browser-side modules (C3 follow-on, 2026-08-19)
// ---------------------------------------------------------------------------

/**
 * The bare (package) specifiers written in a literal module body.
 *
 * Deliberately lexical: the bodies these are read from are hand-written
 * constant strings of static `import`/`export … from` lines, so a lexical
 * read is exact for them, and it cannot execute or resolve anything.
 */
function bareSpecifiersOf(moduleSource: string): string[] {
  const found = new Set<string>();
  const pattern =
    /(?:^|\s)(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  for (const match of moduleSource.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
      continue;
    }
    found.add(specifier);
  }
  return [...found];
}

/**
 * Every package specifier the editor's OWN synthesized browser modules import.
 *
 * ## The gap this closes
 *
 * `packaged.ts` serves five MODULE DOORWAYS that exist only in memory —
 * `/__vgai-react-world-runtime`, `/__vgai-r3f-runtime`,
 * `/__vgai-canvas-runtime`, `/__vgai-three-ingest-runtime`,
 * `/__vgai-story-runtime`
 * (see `vite-plugin-module-doorways.ts` for why the editor must reach react /
 * fiber / `@pixi/react` / `@storybook/react` through the PROJECT's Vite graph
 * rather than its own prebuilt SPA copy). Being synthesized, they hang off NO file on disk, so no
 * `optimizeDeps.entries` value can ever crawl them: the boot scan starts at the
 * project's world entries, tool contributions and stories, none of which import
 * a `/__vgai-*` URL. The editor requests them at the FIRST Play mount / story
 * preview instead — mid-session — and Vite answers a newly-seen bare specifier
 * by re-running the optimizer and hard-reloading the controlling tab
 * ("optimized dependencies changed. reloading"), which drops the in-flight
 * command and, when the reload lands between two module generations, splits the
 * React identity (`Invalid hook call`, `Cannot read properties of null (reading
 * 'useContext')`).
 *
 * Measured on a real canonical-Pixi project (`packaged.ts` against a game whose
 * only renderer is Pixi), cold `node_modules/.vite`: the boot pass prebundled
 * 19 deps; a single request for the three synthetic modules took it to 21,
 * adding `three` and `@react-three/fiber` — two optimizer waves, two reloads.
 * The project had grown a workaround file importing `@pixi/react`,
 * `@react-three/fiber` and `three` from a world entry purely to keep the crawl
 * complete; closing the gap here is what makes that unnecessary.
 *
 * Read from each doorway's own module BODY — the same string the browser is
 * served — so this list cannot drift from what the modules actually import.
 */
export const EDITOR_RUNTIME_MODULE_SPECIFIERS: readonly string[] = [
  ...new Set(
    PACKAGED_MODULE_DOORWAYS.flatMap((doorway) => bareSpecifiersOf(doorwayModuleSource(doorway))),
  ),
].sort();

/**
 * The vgai RUNTIME packages a project installs — the contract and the two
 * shipped twins. All three are source-served whole (never prebundled), for the
 * one-singleton reason the crawl-entry doc below states.
 */
export const RUNTIME_PACKAGE_NAMES = [
  '@volter/editor-project',
  '@volter/editor-threejs',
  '@volter/threejs-runtime',
  '@volter/game-runtime',
] as const;

/** name -> that package's installed `src` directory, for the ones that resolve. */
export type RuntimePackageSources = ReadonlyMap<string, string>;

/** The runtime package a specifier names, or undefined. */
function runtimePackageOf(specifier: string): string | undefined {
  return RUNTIME_PACKAGE_NAMES.find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}

function isRuntimePackageSpecifier(specifier: string): boolean {
  return runtimePackageOf(specifier) !== undefined;
}

/** The package name a specifier belongs to (`three/addons/x.js` -> `three`). */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
}

/**
 * Whether `specifier` resolves from `fromDir` — Node's own resolution, rooted
 * where the import is actually written, so a nested install is found the same
 * way Vite would find it.
 *
 * The `require.resolve` fallback matters: a package published with an
 * `exports` map that has no `require` condition throws `ERR_PACKAGE_PATH_NOT_
 * EXPORTED` even though it is installed and perfectly resolvable by Vite. A
 * false "not installed" there would push an INSTALLED package into
 * `optimizeDeps.exclude` below and un-prebundle it, so fall back to the
 * question actually being asked — is the package directory on disk? — by
 * resolving its `package.json`, which every package exposes.
 */
export function specifierResolvesFrom(fromDir: string, specifier: string): boolean {
  const require = createRequire(join(fromDir, '__vgai-resolve__.js'));
  try {
    require.resolve(specifier);
    return true;
  } catch {
    // fall through to the package-directory question
  }
  try {
    require.resolve(`${packageNameOf(specifier)}/package.json`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The synthesized-module specifiers to add to `optimizeDeps.include` for the
 * project rooted at `projectRoot`.
 *
 * Conditional on the package actually being installed for the same reason the
 * existing `@storybook/react` entry in `packaged.ts` is: Vite ERRORS on
 * `include`-ing a dependency it cannot resolve, and this server opens arbitrary
 * projects — a canonical Pixi game must not be required to install the 3D
 * renderer stack just to boot its editor. A project WITHOUT `three` simply
 * never mounts an R3F root, so the specifier it lacks is one it never requests.
 *
 * Engine specifiers are excluded here on purpose: `packaged.ts` puts
 * every runtime package in `optimizeDeps.exclude` so every one of their subpaths stays
 * source-served (one WorldProvider identity), and an `include`
 * entry for an excluded package is a contradiction Vite warns about. They are
 * handled by `computeRuntimeSourceCrawlEntries` instead — as crawl ENTRIES,
 * which reach the engine's own source graph without prebundling it.
 */

export function computeEditorRuntimeIncludes(projectRoot: string): string[] {
  return EDITOR_RUNTIME_MODULE_SPECIFIERS.filter(
    (specifier) =>
      !isRuntimePackageSpecifier(specifier) && specifierResolvesFrom(projectRoot, specifier),
  );
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'] as const;

/** The file an aliased `<runtime package>/<subpath>` import lands on, or null. */
function packageSubpathFile(srcDir: string, subpath: string): string | null {
  const base = join(srcDir, subpath);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // next candidate
    }
  }
  return null;
}

/**
 * Engine subpaths the browser loads LAZILY — a scaffolded project's own client
 * modules (`@vgai/game-runtime/runtime/mount-game`, `react/use-data`, the loader,
 * the input/scene/asset readers), reached only after the editor shell is up
 * and therefore outside the world-entry/tool/story crawl.
 *
 * They are crawl ENTRIES, never `optimizeDeps.include` entries, and the
 * difference is a correctness one, not a tuning one. `include` PREBUNDLES the
 * named module: esbuild bundles that engine file and everything it reaches by
 * relative import into one dep chunk, so the chunk carries its own copy of
 * `react/world-state`'s `GameContext` while the canonical
 * `@vgai/game-runtime/react/world-state` import is served as source — two providers,
 * one of which silently answers `null` to `useDebugProvider`/`useWorldState`.
 * (`exclude: ['@vgai/game-runtime']` does not stop it: the scanner tests the
 * RAW specifier, and this list used to be written in an alias spelling that
 * check never sees. Measured on a live packaged session:
 * eight prebundled engine modules in `.vite/deps/_metadata.json`, none of them
 * `react/world-state`.)
 *
 * As entries they buy exactly what the include list was for — the third-party
 * packages these modules import (three, zod, `three/addons/*`, fiber) are
 * discovered in the BOOT pass instead of one mid-session optimizer wave and
 * tab reload at a time — while the engine itself stays source-served.
 */
const LAZY_RUNTIME_CRAWL_SPECIFIERS: readonly string[] = [
  '@volter/editor-threejs/asset-parse-error',
  '@volter/editor-threejs/loader',
  '@volter/threejs-runtime/asset-parse-error',
  '@volter/threejs-runtime/loader',
  '@volter/game-runtime/data/data-asset',
  '@volter/game-runtime/input/input-manager',
  '@volter/game-runtime/input/rebind-controller',
  '@volter/game-runtime/react/use-data',
  '@volter/game-runtime/runtime/mount-game',
  '@volter/game-runtime/world3d-react',
];

/**
 * Crawl entries for the engine source the browser reaches: the document-side
 * modules the editor's synthesized runtime modules import, plus the lazily
 * loaded subpaths above.
 *
 * `packaged.ts` `exclude`s each runtime package, and Vite's dep SCANNER checks
 * `exclude` against the raw specifier BEFORE it resolves anything — so an
 * `import … from '@vgai/game-runtime/world3d-react'` is externalized on sight and the
 * engine's own source graph is never crawled at all. That graph is then served
 * as source and its bare imports are discovered one browser request at a time,
 * each a fresh optimizer wave. Naming the engine FILES as entries walks that
 * graph at boot instead: entries are absolute paths, so the scanner's
 * bare-specifier `exclude` check never sees them, while the modules they reach
 * are the very ones the browser will ask for.
 *
 * Measured on the same cold Pixi project as above, scoped to
 * `react/world-state` + `world3d-react`: four `three/addons/*` entry points
 * (`DRACOLoader`, `GLTFLoader`, `KTX2Loader`, `meshopt_decoder`) that the
 * include list alone never reaches are discovered at boot — four waves that
 * would otherwise fire the first time the asset lane loads a glTF.
 *
 * Paths are built the way `packaged.ts`'s own alias resolves them
 * (`@vgai/game-runtime/x` -> `<that package's src>/x`), not through its
 * `exports` map, because that alias is what Vite actually applies. A subpath
 * that does not exist in the installed engine contributes nothing.
 */
export function computeRuntimeSourceCrawlEntries(sources: RuntimePackageSources): string[] {
  const specifiers = new Set<string>();
  for (const specifier of EDITOR_RUNTIME_MODULE_SPECIFIERS)
    if (isRuntimePackageSpecifier(specifier)) specifiers.add(specifier);
  for (const specifier of LAZY_RUNTIME_CRAWL_SPECIFIERS) specifiers.add(specifier);

  const entries: string[] = [];
  for (const specifier of specifiers) {
    const name = runtimePackageOf(specifier);
    const srcDir = name === undefined ? undefined : sources.get(name);
    if (name === undefined || srcDir === undefined) continue;
    const subpath = specifier.slice(name.length + 1);
    if (!subpath) continue;
    const file = packageSubpathFile(srcDir, subpath);
    if (file) entries.push(file);
  }
  return entries;
}

/**
 * The packages imported ANYWHERE in the installed engine's source that the
 * OPENED PROJECT cannot resolve — to be added to `optimizeDeps.exclude`.
 *
 * This is the safety net that makes `computeRuntimeSourceCrawlEntries` safe to
 * hand to Vite. Crawling engine source can reach a package the engine does not
 * DECLARE and a given project therefore does not have: measured on this repo's
 * engine, `src/world3d-react/r3f-adapter.tsx` imports `@react-three/fiber`
 * and `src/world3d-react/rapier-physics-bridge.tsx` imports
 * `@react-three/rapier` — neither of them in the engine's `dependencies`. An unresolvable bare import during the scan is not a
 * warning: Vite collects it and `discoverProjectDependencies` THROWS "The
 * following dependencies are imported but could not be resolved", which in
 * `packaged.ts` rejects the boot-time `optimizeDeps()` barrier and kills the
 * only authoring surface the user has. Vite's scanner tests `exclude` against
 * the raw specifier before resolving, so an excluded name is externalized and
 * never recorded as missing — the same mechanism, and the same benign degrade
 * (that ONE feature fails in the browser; the editor boots and serves), as
 * `SERVER_ONLY_PREBUNDLE_EXCLUDE` above.
 *
 * Scanning the whole `src` tree rather than only the reachable subgraph is
 * deliberate: it is a strict superset, it costs one lexical pass over ~180
 * files, and it stays correct when the engine grows a new optional peer without
 * anyone remembering this file. Excluding a name nothing imports is a no-op, so
 * the lexical scan's occasional false positive (a package-name-shaped word in a
 * string literal) is harmless by construction — which is why a parser is not
 * worth its cost here.
 *
 * ## Resolve from the PROJECT ROOT, not from the engine's own directory
 *
 * The first version of this asked Node whether the name resolved from
 * the package's own src dir, which reads like the more accurate question — that is where
 * the import is written. It is wrong, and the failure is silent until boot:
 * every name in `packaged.ts`'s `resolve.dedupe` (`three`,
 * `@react-three/fiber`, `pixi.js`, react, the runtime packages themselves) is resolved by
 * Vite from `root` — the PROJECT — precisely so one copy wins. Measured on a
 * synthetic Pixi-only project whose runtime packages link into a tree that
 * DOES have `three`: resolving from their own src dirs judged `three` installed and
 * left it out of this list, and the boot died on exactly the error this
 * function exists to prevent, naming `three`, four `three/addons/*` entries and
 * `@react-three/fiber`. Asking the project is also the conservative direction:
 * npm hoists a dependency of the engine to the project's own `node_modules`, so
 * "not resolvable from the project" means "not installed anywhere Vite will
 * look", while the reverse error un-prebundles a package that works.
 */
export function computeUnresolvableRuntimeImports(
  sources: RuntimePackageSources,
  projectRoot: string,
): string[] {
  if (sources.size === 0) return [];

  const specifiers = new Set<string>();
  const walk = (directory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
        for (const name of importedPackageNames(absolute)) specifiers.add(name);
      }
    }
  };
  for (const srcDir of sources.values()) walk(srcDir);

  return [...specifiers].filter((name) => !specifierResolvesFrom(projectRoot, name)).sort();
}

/**
 * A PACKAGE's contributions, as crawl entries (WORKBENCH.md §Package or copy;
 * ARCHITECTURE-CORE §The universal editor). On a real install a skew package
 * (`@volter/editor-blender`, `@vgai/game`) sits under the project's `node_modules`, and
 * the editor imports its `package.json#vgai.contributions` modules by
 * absolute path. Vite's scanner never walks a graph that starts under
 * `node_modules`, so every bare import those modules reach — the mesh kit's
 * `@react-three/drei`, and through it the CommonJS `stats.js` — is served
 * raw, one optimizer wave per request, or not at all: measured 2026-09-17 on
 * a registry 0.5.56 install, `SyntaxError: The requested module
 * '/node_modules/stats.js/build/stats.min.js' does not provide an export
 * named 'default'` on every mesh contribution. Naming the contribution FILES
 * as entries walks their graphs at boot, exactly as the engine's source
 * entries do above.
 *
 * `unresolvable` is the same safety net as {@link computeUnresolvableRuntimeImports}
 * over the package's own tree: a peer the project does not have is excluded
 * by name rather than allowed to reject the boot-time optimizer.
 */
export interface PackageContributionCrawl {
  readonly entries: string[];
  readonly unresolvable: string[];
}

export function computePackageContributionCrawlEntries(
  projectRoot: string,
): PackageContributionCrawl {
  const entries: string[] = [];
  const specifiers = new Set<string>();
  let declared: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  } catch {
    return { entries, unresolvable: [] };
  }
  const req = createRequire(join(projectRoot, 'package.json'));
  for (const name of declared) {
    let manifestPath: string;
    try {
      manifestPath = req.resolve(`${name}/package.json`);
    } catch {
      continue;
    }
    let contributions: unknown;
    try {
      contributions = (
        JSON.parse(readFileSync(manifestPath, 'utf-8')) as { vgai?: { contributions?: unknown } }
      ).vgai?.contributions;
    } catch {
      continue;
    }
    if (!Array.isArray(contributions)) continue;
    const dir = dirname(manifestPath);
    for (const entry of contributions) {
      if (typeof entry !== 'string') continue;
      const file = join(dir, entry);
      if (existsSync(file)) entries.push(file);
    }
    const walk = (directory: string): void => {
      let found: Dirent[];
      try {
        found = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of found) {
        if (item.name.startsWith('.') || item.name === 'node_modules') continue;
        const absolute = join(directory, item.name);
        if (item.isDirectory()) walk(absolute);
        else if (item.isFile() && SOURCE_FILE_PATTERN.test(item.name))
          for (const imported of importedPackageNames(absolute)) specifiers.add(imported);
      }
    };
    walk(join(dir, 'contributions'));
    walk(join(dir, 'src'));
  }
  const unresolvable = [...specifiers]
    .filter((name) => !specifierResolvesFrom(projectRoot, name))
    .sort();
  return { entries, unresolvable };
}

const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|mts|js|jsx|mjs)$/;
const IMPORT_PATTERN = /(?:from|import|require)\s*\(?\s*['"]([^'"\n]+)['"]/g;
/** npm's own name grammar — anything else the lexical scan caught is prose. */
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** The package names a source file's bare imports name; `[]` if unreadable. */
function importedPackageNames(file: string): string[] {
  let source: string;
  try {
    source = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (!specifier || isLocalSpecifier(specifier)) continue;
    const name = packageNameOf(specifier);
    if (PACKAGE_NAME_PATTERN.test(name)) names.push(name);
  }
  return names;
}

/** Resolved by path or by this repo's own aliases — never by node_modules. */
function isLocalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('node:') ||
    specifier.startsWith('virtual:') ||
    isRuntimePackageSpecifier(specifier)
  );
}
