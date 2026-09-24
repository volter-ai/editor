/**
 * IN-PAGE TRANSPILE + MODULE RESOLUTION, for the one module graph the session's
 * Vite does not serve: a game vendored as a SERVED BUNDLE.
 *
 * A vendored game under `public/ingest/<id>/` ships as ordinary static files,
 * outside the editor's own module graph, so `import('/ingest/…/game.js')`
 * would ask the BROWSER to resolve its bare specifiers — and the browser would
 * fetch a second copy of `three`. Instead its relative files are fetched and
 * bundled here, its bare imports stay external, and each one is rewritten to a
 * blob-URL shim re-exporting the editor's ALREADY-RUNNING namespace
 * (`served-bundle-runtime-modules.ts` answers which). The flow:
 *
 *   served source → esbuild-wasm bundle (in a Web Worker)
 *     → rewrite bare imports to shims over the live singletons
 *     → Blob → URL.createObjectURL → dynamic import()
 *
 * Sharing singletons is the load-bearing detail: two copies of `three` break
 * `instanceof` and prototype chains, and two reconcilers cannot own one canvas.
 *
 * Idiomatic: esbuild-wasm is the same engine Vite uses, just run client-side;
 * we call its documented API directly (no wrapper abstraction).
 *
 * A PROJECT's own modules never come through here: the session that opened it
 * serves them.
 */

import { commandLine } from '@volter/editor-sdk/kit/product-command';
import type { ImportSpecifier as EsModuleImport } from 'es-module-lexer';
import { init as esModuleLexerInit, parse as parseEsModule } from 'es-module-lexer';
import * as esbuild from 'esbuild-wasm';
// Vite serves the wasm binary as a static asset URL — fully local, no CDN.
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import { GAME_GLOBALS_PRELUDE } from '@volter/editor-core/game-globals-prelude';

/** Live runtime modules, keyed by the bare specifier used to import them. */
type ModuleNamespace = Record<string, unknown>;
const runtimeModules = new Map<string, ModuleNamespace>();

/** Per-specifier shim blob URLs, memoized (the live module identity is stable). */
const shimUrlCache = new Map<string, string>();

let initPromise: Promise<void> | null = null;

/**
 * Initialize esbuild-wasm exactly once. Safe to call repeatedly — concurrent
 * callers share the same promise.
 */
/**
 * MEASURED EXPERIMENT, with a revert criterion — see the numbers below.
 *
 * esbuild-wasm defaults to running in a Web Worker in the browser. That keeps
 * its parse/link off the main thread, but EVERY plugin callback then crosses a
 * postMessage boundary, and this build's plugin is called twice per reached
 * file (`onResolve` + `onLoad`) — about 164 round-trips per rebuild for
 * `examples/third-person`, each structured-cloning source text.
 *
 * The same rebuild costs 182-364ms in Node, where the `worker` option is
 * refused outright and callbacks are direct calls, and ~1150ms in the browser
 * with a warm context (runhuman passes 102/104). Whether that gap is callback
 * IPC or simply browser-vs-Node wasm speed cannot be settled in Node, because
 * esbuild-wasm throws "The 'worker' option only works in the browser".
 *
 * So it is settled on the surface that has the question. The plugin work
 * already runs on the main thread either way; this only moves esbuild's own
 * parse/link there too, trading a thread for the round-trips.
 *
 * RESULT (runhuman pass 107, five rounds on the same entry pass 104 measured):
 * esbuild fell from 1447-2358ms to 500-560ms, and nothing froze — the tester
 * hovered controls and orbited the camera DURING an edit and reported the page
 * responsive, calling the result "visually faster... like a second or two
 * seconds faster". So the gap was substantially the callback round-trips, not
 * browser-versus-Node wasm speed, and the trade is kept.
 *
 * INVERTED (measured 2026-09-03, six-drop runs per mode, medians over drops
 * 2–6): once a content write stopped re-bundling every story module beside
 * the world, there is ONE bundle per edit and the ~164 round-trips are cheap
 * — worker esbuild 521 ms vs 951 on the main thread, remount 610 ms vs 1177 —
 * while long-task sum, worst rAF gap and the FPS floor are indistinguishable
 * between modes (the rest of the remount — R3F mount, Three scene, the reads
 * themselves — is main-thread work either way). Main-thread esbuild also
 * DEGRADES as
 * the scene grows (649 → 1072 ms from the first drop to the fifth) because
 * it competes with the editor's own React/Three work; the worker's stays
 * flat at ~400–520 ms after its first, slower bundle. The pass-107 figure of
 * 1447–2358 ms was measured under the ten-bundle storm and no longer
 * describes the single-bundle path. So the parse/link is back off the main
 * thread; the plugin callbacks still run here.
 */
const ESBUILD_IN_WORKER = true;

/**
 * `import.meta.env` for a PROJECT module bundled here. Vite defines it for the
 * dev tier; esbuild defines nothing, so a project reading
 * `import.meta.env['VITE_…']` — the cinematic example's video-plate switch —
 * threw "Cannot read properties of undefined (reading 'VITE_VIDEO_PLATE')" on
 * the first Play of every hosted session (runhuman pass 148). The hosted
 * tier is a production build of the project with no `.env`: the standard
 * Vite shape, every `VITE_*` absent.
 */
const PROJECT_MODULE_DEFINES: Record<string, string> = {
  'import.meta.env': JSON.stringify({
    MODE: 'production',
    DEV: false,
    PROD: true,
    SSR: false,
    BASE_URL: '/',
  }),
  'import.meta.env.MODE': '"production"',
  'import.meta.env.DEV': 'false',
  'import.meta.env.PROD': 'true',
};

/**
 * THE WASM BINARY'S OWN URL, ABSOLUTE, AGAINST THE ORIGIN THAT SERVES THIS
 * MODULE — and it is the origin, never the PAGE's.
 *
 * Vite hands `esbuild.wasm?url` back ROOT-RELATIVE (`/@fs/…` in dev), and
 * `esbuild-wasm`'s own loader then does `new URL(wasmURL, location.href)`
 * before posting it into the blob worker it spawns
 * (`esbuild-wasm/lib/browser.js`). Everywhere but one shape that is the same
 * origin and nothing is wrong. Inside the Code-OSS DESKTOP frame the page is
 * `vscode-file://vscode-app` while this module came from the session over
 * loopback http, so the worker ended up fetching
 * `vscode-file://vscode-app/@fs/…`: a scheme Electron's own
 * `onBeforeRequest` cancels for a request with no frame, at a path that does
 * not exist under the app root. MEASURED 2026-09-19 (the frame walk, beat
 * 19): `TypeError: Failed to fetch`, surfacing as
 * `Ingest failed: TypeError: Failed to fetch` — and ONLY for a
 * `public/ingest/*` project, because the served-bundle lane is the only one
 * that reaches esbuild at mount; the `/@fs/` lane uses a native `import()`.
 *
 * Neither half of the frame's origin shim could have caught it: the URL is
 * absolutised before it reaches `fetch`, and the worker is a SAME-ORIGIN
 * `blob:` the shim deliberately leaves unwrapped.
 *
 * NOTE THE SHAPE, and do not "simplify" it: `new URL(<expression>,
 * import.meta.url)` is Vite's asset-URL pattern and is rewritten statically,
 * so the origin is taken once with the ONE-argument form and used as a plain
 * base string — the same rule `tool-loader.ts`'s `MODULE_SERVING_ORIGIN`
 * states. An already-absolute URL (a production build with a CDN base) is
 * left exactly as it is.
 */
const ESBUILD_WASM_URL = esbuildWasmUrl.startsWith('/')
  ? `${new URL(import.meta.url).origin}${esbuildWasmUrl}`
  : esbuildWasmUrl;

export function initBrowserTranspile(): Promise<void> {
  if (!initPromise) {
    initPromise = esbuild
      .initialize({ wasmURL: ESBUILD_WASM_URL, worker: ESBUILD_IN_WORKER })
      .catch((err) => {
        // Allow a retry on failure rather than caching a rejected promise.
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}

/**
 * Register the live runtime module namespaces that transpiled user code is
 * allowed to import. Call once at editor/runtime init with the modules the
 * host already imported statically (so identities are shared).
 *
 *   registerRuntimeModules({
 *     three: THREE,
 *     '@volter/threejs-runtime/ecs/user-data': userDataModule,
 *   });
 */
export function registerRuntimeModules(modules: Record<string, ModuleNamespace>): void {
  for (const [spec, ns] of Object.entries(modules)) {
    runtimeModules.set(spec, ns);
    shimUrlCache.delete(spec); // invalidate any stale shim
  }
  // Exposed on globalThis so shim modules (which run in their own module scope)
  // can reach the live namespaces by specifier.
  (globalThis as Record<string, unknown>)['__vgaiModules'] = Object.fromEntries(runtimeModules);
}

/**
 * A resolver from a bare specifier to a LAZY loader of the editor's live copy
 * of that module, or `undefined` when the specifier is not one the browser
 * editor ships. Installed once by `served-bundle-runtime-modules.ts`
 * (`browserRuntimeModuleLoader`), which owns the dependency list; this module
 * only asks it. Lazy on purpose: the list is the whole estate's dependency
 * closure (engine subpaths, physics wasm, audio, …) and a project imports a
 * handful of it, so a load happens per specifier a project ACTUALLY imports —
 * never the whole table on first Play.
 */
export type RuntimeModuleResolver = (specifier: string) => (() => Promise<unknown>) | undefined;

let runtimeModuleResolver: RuntimeModuleResolver | null = null;
const pendingRuntimeModuleLoads = new Map<string, Promise<void>>();

export function registerRuntimeModuleResolver(resolver: RuntimeModuleResolver): void {
  runtimeModuleResolver = resolver;
}

/**
 * THE WALL, in the product's own words. A bare import the browser editor does
 * not ship is not a bug in the project and not a bug in the editor: it is the
 * one dependency this tier cannot resolve, and the remedy is named — the dev
 * server resolves the project's own `node_modules`, and the list grows by a
 * capability declaring the package (which `validate-browser-runtime-modules`
 * then holds it to). Never a silent degrade, never a partial mount.
 */
function unregisteredRuntimeModules(specifiers: readonly string[]): Error {
  const list = specifiers.map((s) => `'${s}'`).join(', ');
  const verb = specifiers.length === 1 ? 'is' : 'are';
  return new Error(
    `${list} ${verb} not in the browser editor's dependency list, so this project cannot run ` +
      'here. The browser editor bundles project source itself and resolves every package ' +
      'import to a dependency it ships; a package outside that list needs a dev server. Open ' +
      `the project locally with ${commandLine('edit')} (which resolves the project’s own node_modules), ` +
      'or add the package to a capability so it joins the list ' +
      '(packages/editor/src/served-bundle-runtime-modules.ts, gated by ' +
      '`npm run validate-browser-runtime-modules`).',
  );
}

/**
 * Every bare specifier `code` imports STATICALLY (re-exports included),
 * PARSED — es-module-lexer, never a regex. The regex this replaced matched
 * `from '...'`-shaped text inside STRING LITERALS, and the moment a game's
 * bundle inlined a string-heavy library (Babylon's loader messages), Play
 * refused it over junk "specifiers" (measured live, 2026-08-27). Literal dynamic imports are deliberately not in the eager set:
 * `import('x')` is lazy by the language's own contract, and a project's
 * Node-only fallback (`if (typeof indexedDB === 'undefined') await
 * import('fake-indexeddb/auto')`) must stay unreached in a browser rather
 * than be loaded — and walled — at bundle time. Those resolve at CALL time
 * through {@link importRuntimeModule}, which the rewrite points them at.
 */
async function parseModuleImports(code: string): Promise<readonly EsModuleImport[]> {
  await esModuleLexerInit;
  try {
    return parseEsModule(code)[0];
  } catch (error) {
    throw new Error(
      `browser transpile could not parse this module's imports: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Load ONE specifier through the resolver (shared in-flight promise), or throw the wall. */
function loadRuntimeModule(spec: string): Promise<void> {
  let pending = pendingRuntimeModuleLoads.get(spec);
  if (!pending) {
    const load = runtimeModuleResolver?.(spec);
    if (!load) return Promise.reject(unregisteredRuntimeModules([spec]));
    pending = load()
      .then((ns) => registerRuntimeModules({ [spec]: ns as ModuleNamespace }))
      .finally(() => pendingRuntimeModuleLoads.delete(spec));
    pendingRuntimeModuleLoads.set(spec, pending);
  }
  return pending;
}

/**
 * The call-time half of a literal dynamic import in project code. The rewrite
 * turns `import('tone')` into `globalThis.__vgaiImportRuntimeModule('tone')`,
 * so the load — and the wall, if the browser editor does not ship it — happens
 * exactly when the project's own code executes the import, never earlier.
 */
export async function importRuntimeModule(spec: string): Promise<ModuleNamespace> {
  if (!runtimeModules.has(spec)) await loadRuntimeModule(spec);
  return runtimeModules.get(spec) as ModuleNamespace;
}
(globalThis as Record<string, unknown>)['__vgaiImportRuntimeModule'] = importRuntimeModule;

/**
 * Bring every static bare import live, then rewrite by the lexer's own byte
 * offsets — static specifiers to blob-URL shims over the live modules,
 * literal dynamic imports to the call-time loader
 * ({@link importRuntimeModule}). Offset-exact replacement (walked from the
 * end so earlier offsets stay valid) is what makes this safe inside code
 * that CONTAINS import-shaped strings. Specifiers already registered cost
 * nothing, the rest load through the installed resolver (one in-flight load
 * per specifier, shared by concurrent bundles), and the ones the resolver
 * does not know are reported TOGETHER — a project with three unshipped
 * packages learns all three at once.
 */
export async function resolveAndRewriteBareImports(code: string): Promise<string> {
  const imports = await parseModuleImports(code);
  const staticBare = new Set<string>();
  for (const record of imports) {
    if (record.d === -1 && record.n !== undefined && !isResolvable(record.n)) {
      staticBare.add(record.n);
    }
  }
  const missing = [...staticBare].filter((spec) => !runtimeModules.has(spec));
  if (missing.length > 0) {
    const unknown = missing.filter((spec) => !runtimeModuleResolver?.(spec));
    if (unknown.length > 0) throw unregisteredRuntimeModules(unknown);
    await Promise.all(missing.map((spec) => loadRuntimeModule(spec)));
  }
  let out = code;
  for (let i = imports.length - 1; i >= 0; i -= 1) {
    const record = imports[i] as EsModuleImport;
    if (record.n === undefined || isResolvable(record.n)) continue;
    if (record.d === -1) {
      // Static import / re-export: swap the specifier text (inside its quotes).
      out = `${out.slice(0, record.s)}${shimUrlFor(record.n)}${out.slice(record.e)}`;
    } else if (record.d >= 0) {
      // Literal dynamic import: swap the whole `import(...)` expression.
      out = `${out.slice(0, record.ss)}globalThis.__vgaiImportRuntimeModule(${JSON.stringify(
        record.n,
      )})${out.slice(record.se)}`;
    }
  }
  return out;
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Reserved words can't be `export const <name>` binding identifiers. Some real
// modules expose them as convenience named exports (e.g. zod exports `catch`,
// `enum`, `function`, `void`) — re-exporting those verbatim would make the shim
// itself a SyntaxError ("Unexpected token 'catch'"). They're never imported by
// those names, so we skip them.
const RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'await',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
]);

/** Build (or reuse) a blob-URL ESM module that re-exports a live namespace. */
function shimUrlFor(spec: string): string {
  const cached = shimUrlCache.get(spec);
  if (cached) return cached;

  const ns = runtimeModules.get(spec);
  // Every caller runs `ensureBareImportsLoaded` first, so this is reached only
  // by a specifier the resolver was never asked about (a direct
  // `registerRuntimeModules` user) — the same wall, said the same way.
  if (!ns) throw unregisteredRuntimeModules([spec]);

  const lines = [`const __m = globalThis.__vgaiModules[${JSON.stringify(spec)}];`];
  for (const key of Object.keys(ns)) {
    if (key === 'default' || !IDENT_RE.test(key) || RESERVED_WORDS.has(key)) continue;
    lines.push(`export const ${key} = __m[${JSON.stringify(key)}];`);
  }
  if ('default' in ns) lines.push(`export default __m[${JSON.stringify('default')}];`);

  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/javascript' }));
  shimUrlCache.set(spec, url);
  return url;
}

/** True for specifiers that are already directly importable in the browser. */
function isResolvable(spec: string): boolean {
  return (
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('blob:') ||
    spec.startsWith('http:') ||
    spec.startsWith('https:')
  );
}

/**
 * Transpile TS/TSX source to an importable ESM module URL (blob:). Bare imports
 * are rewritten to live-singleton shims.
 *
 * Low-level primitive: it does NOT apply the game-globals shadow. Project /
 * game code must go through {@link importFromSource} (which wraps this) so its
 * `window`/`document` input listeners stay focus-gated; only shadow-exempt
 * editor-internal source should call this directly.
 */
export async function transpileToModuleUrl(
  source: string,
  filename = 'in-browser-edit.tsx',
): Promise<string> {
  await initBrowserTranspile();
  const { code } = await esbuild.transform(source, {
    loader: filename.endsWith('.tsx') ? 'tsx' : 'ts',
    format: 'esm',
    target: 'es2022',
    sourcefile: filename,
    // Match the editor's tsconfig: decorators + classic field semantics.
    tsconfigRaw: {
      compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
    },
  });
  const rewritten = await resolveAndRewriteBareImports(code);
  return URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
}

/**
 * Prepend the game-globals lexical shadow to project source — the browser-side
 * analogue of the dev server's `vgai-game-globals` Vite plugin
 * (`server/dev.ts` + `shouldShadowGameGlobals`). The server shadows per-module
 * because Vite transforms EVERY module indiscriminately and must be told which
 * ones are game code; the browser has no such firehose — {@link importFromSource}
 * is the single client-transpile chokepoint and only ever receives project
 * code, so "scoping" here is by construction (route project code through this
 * seam; never through the raw {@link transpileToModuleUrl}). Applying the shadow
 * to EVERY module that reaches this seam is what keeps game `window`/`document`
 * input focus-gated on the whole browser path — the bundled project scripts
 * (`served-bundle-runtime-modules.ts`) AND every single-file hot-swap alike, not just
 * hot-swaps. Kept as its own named, exported function so that invariant is
 * unit-testable and can't be silently dropped (`browser-globals-shadow.test.ts`).
 */
export function applyGameGlobalsShadow(source: string): string {
  return GAME_GLOBALS_PRELUDE + source;
}

/**
 * Transpile TS/TSX source in-browser and dynamically import it, returning the
 * module namespace. The blob URL is revoked once the import settles.
 *
 * This is the ONLY path project code should take: it applies the game-globals
 * shadow ({@link applyGameGlobalsShadow}) so a component's `window`/`document`
 * resolve to the editor's gated proxies (input stays focus-gated on the HMR
 * path too). The raw {@link transpileToModuleUrl} deliberately does NOT shadow —
 * it is the low-level primitive; feeding project code to it directly would leak
 * ungated input listeners.
 */
export async function importFromSource(
  source: string,
  filename = 'in-browser-edit.tsx',
): Promise<Record<string, unknown>> {
  const url = await transpileToModuleUrl(applyGameGlobalsShadow(source), filename);
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.json'] as const;

export function resolveProjectPath(importer: string, specifier: string): string {
  const base = specifier.startsWith('/') ? [] : importer.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (base.length === 0) {
        throw new Error(`Project import '${specifier}' escapes the project root.`);
      }
      base.pop();
      continue;
    }
    base.push(segment);
  }
  return base.join('/');
}

/**
 * Extensions an `import url from './thing.png'` is allowed to name.
 *
 * Vite gives that import a URL string, and game source is ecosystem-native —
 * `examples/top-down-strategy` imports its three terrain rasters exactly that
 * way — so this bundle owes the same import SHAPE. It cannot owe the same
 * URL: a served bundle's own files are not in the session's module graph, so
 * the bytes travel inside the bundle as a data URL. `dataurl` reads the MIME from this extension, and
 * it is the only loader whose default export is a string a `fetch`/`Image.src`
 * consumer can use unchanged.
 *
 * The cost is base64's third: a large binary belongs in `public/` and is
 * referenced by path, which is what every model in the estate already does.
 * This list is for the small rasters and clips source genuinely imports.
 */
const ASSET_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.bmp',
  '.ico',
  '.svg',
  '.mp3',
  '.ogg',
  '.wav',
  '.m4a',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
];

export function loaderFor(path: string): esbuild.Loader {
  const sourcePath = path.split(/[?#]/, 1)[0]!;
  if (sourcePath.endsWith('.tsx')) return 'tsx';
  if (sourcePath.endsWith('.jsx')) return 'jsx';
  if (sourcePath.endsWith('.js') || sourcePath.endsWith('.mjs')) return 'js';
  if (sourcePath.endsWith('.json')) return 'json';
  if (sourcePath.endsWith('.glsl') || sourcePath.endsWith('.vert') || sourcePath.endsWith('.frag'))
    return 'text';
  const lower = sourcePath.toLowerCase();
  if (ASSET_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'dataurl';
  return 'ts';
}

function resolveServedModulePath(importer: string, specifier: string): string {
  if (specifier.startsWith('/')) return specifier;
  if (/^(?:https?:|blob:|data:)/.test(specifier)) return specifier;
  const origin = globalThis.location?.origin ?? 'https://vgai.invalid';
  const resolved = new URL(specifier, new URL(importer, origin));
  return resolved.origin === origin
    ? `${resolved.pathname}${resolved.search}${resolved.hash}`
    : resolved.href;
}

/**
 * Bundle one module graph served as ordinary static files. Unlike a direct
 * `import('/ingest/.../game.js')`, this path does not ask the browser to
 * resolve package specifiers: relative files are fetched and bundled here,
 * while bare imports remain external and are rewritten to the host's live
 * registered namespaces. That preserves the one-Three invariant in a static
 * deployment as well as under Vite's development server.
 */
export async function bundleServedModule(
  entry: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string> {
  await initBrowserTranspile();
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: PROJECT_MODULE_DEFINES,
    plugins: [
      {
        name: 'vgai-served-module',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (
              args.kind !== 'entry-point' &&
              !args.path.startsWith('.') &&
              !args.path.startsWith('/')
            ) {
              return { path: args.path, external: true };
            }
            const path =
              args.kind === 'entry-point'
                ? args.path
                : resolveServedModulePath(args.importer, args.path);
            return { path, namespace: 'vgai-served' };
          });
          build.onLoad({ filter: /.*/, namespace: 'vgai-served' }, async (args) => {
            const response = await fetchImpl(args.path);
            if (!response.ok) {
              throw new Error(
                `Cannot load static game module '${args.path}' (${response.status} ${response.statusText}).`,
              );
            }
            const loader = loaderFor(args.path);
            // An asset is BYTES; decoding it as text is what turns a PNG into
            // a parse error against replacement characters.
            if (loader === 'dataurl') {
              return { contents: new Uint8Array(await response.arrayBuffer()), loader };
            }
            const source = await response.text();
            return {
              contents:
                loader === 'json' || loader === 'text' ? source : applyGameGlobalsShadow(source),
              loader,
            };
          });
        },
      },
    ],
  });
  const output = result.outputFiles?.find((file) => !file.path.endsWith('.css'));
  if (!output) throw new Error(`Static game module bundle produced no JavaScript for '${entry}'.`);
  return await resolveAndRewriteBareImports(output.text);
}

export async function importServedModule(
  entry: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Record<string, unknown>> {
  const source = await bundleServedModule(entry, fetchImpl);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(url);
  }
}
