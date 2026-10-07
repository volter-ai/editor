/**
 * `<product> view build [folder] --out <dir> --workbench <vscode-web dir>` — compile a project
 * into a LIMITED VIEW (docs/LIMITED-VIEW.md): a static page that looks like the editor on that
 * project, minus what needs the person's machine.
 *
 * One function every product's CLI calls with its own identity, through the launcher door it
 * already uses (`launcher/launch.ts` re-exports it); the kit names no product.
 *
 * WHAT IT DOES, in order:
 *
 *  1. Starts the project's own session HEADLESS — the packaged session `edit` starts, with no
 *     workbench, no tab and an ephemeral identity — so the project's modules are compiled by the
 *     very Vite instance and plugins a person's session uses
 *     (`server/packaged.ts`, `project-serving-plugins.ts`), not by a second build config.
 *  2. Records what that session serves:
 *       - the kit's fixed answers (`/__editor/project`, `project-tools`, …), with the session's
 *         own identity scrubbed;
 *       - each composed integration's `viewSnapshotRoutes()` (Blender's WebAssembly);
 *       - every project module and everything those modules import, crawled from the project's
 *         source files, its contributions and the kit's module doorways. Each project module is
 *         also recorded under a sentinel mount id, so every `?volter-mount=<id>` the page asks
 *         for is answered by one recording (`view/page/view-contract.ts`).
 *  3. Stops the session (by its own PID) and writes the view: the product's production build,
 *     the web workbench, the project's files, the recordings, the page (`view/page/boot.ts`, with
 *     each integration's `volter.viewServing` routes bundled in) and the service worker.
 *
 * WHAT IT DOES NOT: recompile anything after this. A limited view's modules are the ones
 * compiled here; edits made in the view stay in that page's memory.
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pathToFileURL } from 'node:url';
import { init as initLexer, parse as parseImports } from 'es-module-lexer';
import type { ProjectServingModule } from '@volter/editor-sdk/session/project-serving';
import { type ProductIdentity, resolveProductForProject } from '@volter/editor-sdk/session/product-locator';
import { PACKAGED_MODULE_DOORWAYS } from '../../vite-plugin-module-doorways';
import { builtFrameBridgeModule, readBuiltProductEntry } from '../frame-bridge';
import { waitForOwnEditorServer } from './editor-boot';
import { computePackageContributionCrawlEntries } from '../project-optimize-deps-entries';
import { productServingModules, productViewServingModules } from '../session-product';
import { selectProjectFiles } from './view-files';
import { PathNeutralizer, scanForLocalPaths } from './view-paths';
import {
  type LimitedViewConfig,
  type LimitedViewRouteEntry,
  MOUNT_SENTINEL,
  neutralProjectRoot,
  SERVICE_WORKER_FILE,
  VIEW_DIR,
  WORKBENCH_DIR,
} from '../../view/page/view-contract';

/** Who is building: the package a project declares, and the name a person sees (a product's
 *  `LaunchingProduct` is one). */
export interface ViewBuildingProduct {
  readonly packageName: string;
  readonly displayName: string;
}

export interface ViewBuildOptions {
  readonly out?: string;
  /** The web workbench: `scripts/workbench/build-release.mjs --target web`'s `vscode-web`. */
  readonly workbench?: string;
  readonly log?: (line: string) => void;
}

/** The session's fixed answers a limited view ships. Each is read-only and none is the person's
 *  own (user settings, user state and recent projects are not recorded: a view must not carry
 *  its builder's). The file routes are answered live in the page (`view/page/router.ts`). */
const KIT_SNAPSHOT_ROUTES = [
  '/__editor/compatibility',
  '/__editor/project',
  '/__editor/project-verbs',
  '/__editor/project-components',
  '/__editor/project-tools',
  '/__editor/project-attribution',
  '/__editor/story-files',
  '/__editor/scoped-game-css',
  '/__editor/configurations',
  '/__editor/gameplay-sessions',
  '/__editor/project-thumbnail',
  '/__editor/tab-bootstrap.js',
  '/__editor/tab-bootstrap.js?surface=vscode',
] as const;

/** Module paths never recorded from the session: the view answers them itself. */
const NOT_CRAWLED = /^\/@vite\/client|^\/@vite\/env|^\/@react-refresh|^\/__editor\//;
/** Source files a project's modules are compiled from. */
const MODULE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|json|css)$/;
/** How many requests are in flight against the session at once. */
const CRAWL_CONCURRENCY = 4;
/** A runaway crawl is a defect to name, not a view to write. */
const CRAWL_LIMIT = 20_000;

function fail(message: string): never {
  throw new Error(`view build: ${message}`);
}

async function freePort(): Promise<number> {
  return new Promise((done, failed) => {
    const server = createServer();
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? done(address.port) : failed(new Error('no port'))));
    });
  });
}

/** Stop the session this build started, by its own PID and its own tree only. */
function stopSession(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

/** The vscode-web package, checked: its entry exists, and the overlay compiled THIS product in. */
function checkWorkbench(dir: string | undefined, product: ProductIdentity): string {
  const productId = product.name.split('/').pop() ?? product.name;
  const build = `node scripts/workbench/build-release.mjs --target web --product ${productId} --checkout <fork dir>`;
  if (!dir) fail(`--workbench <dir> is required: the Code-OSS web workbench this view runs in. Cut one with\n  ${build}\nand pass its vscode-web directory.`);
  const root = resolve(dir);
  if (!existsSync(join(root, 'out/vs/workbench/workbench.web.main.internal.js'))) {
    fail(`${root} is not a vscode-web package (it has no out/vs/workbench/workbench.web.main.internal.js). Cut one with\n  ${build}`);
  }
  const chat = join(root, 'extensions/volter-view-chat/view-product.json');
  if (!existsSync(chat)) fail(`${root} carries no limited-view chat (extensions/volter-view-chat): it was not built with --target web. Cut one with\n  ${build}`);
  const built = (JSON.parse(readFileSync(chat, 'utf8')) as { name?: string }).name;
  if (built !== product.name) fail(`${root} was built for ${built}, and this project opens in ${product.name}. Cut one with\n  ${build}`);
  return root;
}

/**
 * The output directory — new, empty, or a view this command wrote before — and the STAGING
 * directory beside it that the view is actually built in. The view is moved into place only once
 * it is whole and its scan for machine paths passed; a failed build leaves nothing in `--out`.
 */
function prepareOut(final: string): { final: string; staging: string } {
  if (existsSync(final) && readdirSync(final).length > 0 && !existsSync(join(final, VIEW_DIR, 'view.json'))) {
    fail(`${final} is not empty and holds no earlier limited view; refusing to write over it.`);
  }
  const staging = `${final}.building-${process.pid}`;
  rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
  mkdirSync(join(staging, VIEW_DIR, 'r'), { recursive: true });
  return { final, staging };
}

/** A path with its symlinks resolved, as far as it exists (`--out` usually does not yet). */
function realOrNearest(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(path);
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

/** `/@fs/<absolute>` as Vite spells it on this platform (`fsImportPath`'s rule). */
function fsUrl(absolute: string): string {
  const posix = absolute.split(sep).join('/');
  return posix.startsWith('/') ? `/@fs${posix}` : `/@fs/${posix}`;
}

function extensionFor(type: string): string {
  if (/javascript/.test(type)) return 'js';
  if (/json/.test(type)) return 'json';
  if (/wasm/.test(type)) return 'wasm';
  if (/^text\//.test(type)) return 'txt';
  if (/^image\/png/.test(type)) return 'png';
  return 'bin';
}

/** The absolute paths each compiled module imports from the same origin. */
function importedUrls(code: string): string[] {
  const found = new Set<string>();
  try {
    const [imports] = parseImports(code);
    for (const entry of imports) if (entry.n?.startsWith('/') && !entry.n.startsWith('//')) found.add(entry.n);
  } catch {
    /* not parseable as a module: only the string scan below applies */
  }
  // `new URL('/src/x.wasm', import.meta.url)` and worker URLs are strings, not imports.
  for (const [, url] of code.matchAll(/["'`](\/(?:@fs\/|@id\/|node_modules\/|src\/|__volter-)[^"'`\s]*)["'`]/g)) {
    if (url) found.add(url);
  }
  return [...found];
}

export async function viewBuild(folder: string, building: ViewBuildingProduct, options: ViewBuildOptions = {}): Promise<string> {
  const log = options.log ?? ((line: string) => console.log(line));
  const project = realpathSync(resolve(folder));
  const product = resolveProductForProject(project);
  if (product.name !== building.packageName) fail(`${project} declares ${product.name}, not ${building.displayName}.`);
  const workbench = checkWorkbench(options.workbench, product);
  const distPath = join(product.dir, 'dist');
  // The product's production build is what the page runs; without it there is nothing to frame.
  const frameBridge = builtFrameBridgeModule(readBuiltProductEntry(distPath, product));
  // A view written inside its project would publish itself on the next build, and a workbench
  // inside the output would be deleted before it is copied.
  if (!options.out) fail('--out <dir> is required: the directory the static view is written to.');
  {
    const target = realOrNearest(options.out);
    const inside = (child: string, parent: string) => {
      const rel = relative(parent, child);
      return rel === '' || (!rel.startsWith('..') && !/^[A-Za-z]:/.test(rel));
    };
    if (inside(target, project)) fail(`--out ${target} is inside the project ${project}; a view there would be published with the project's own files. Write it somewhere else.`);
    const realWorkbench = realpathSync(workbench);
    if (inside(realWorkbench, target) || inside(target, realWorkbench)) fail(`--out ${target} and --workbench ${workbench} overlap; the output is replaced whole before the workbench is copied into it. Keep them apart.`);
  }
  const { final, staging: out } = prepareOut(realOrNearest(options.out));
  try {
    const resolveFromProduct = createRequire(join(product.dir, 'package.json'));
    const sessionEntry = resolveFromProduct.resolve('@volter/editor-core/server/packaged');
    const editorCoreRoot = dirname(dirname(sessionEntry));

    // What of the project is published: what it would commit, never a secret (`view-files.ts`).
    const published = selectProjectFiles(project);
    log(`Publishing ${published.files.length} project files.`);
    for (const [rule, count] of published.excluded) log(`  left out: ${count} × ${rule}`);

    // ---- 1. the project's own session, headless.
    const port = await freePort();
    const hmrPort = await freePort();
    const logPath = join(tmpdir(), `volter-view-build-${port}.log`);
    const logFile = createWriteStream(logPath);
    log(`Compiling ${project} through its own session (log: ${logPath})…`);
    const child = spawn(process.execPath, [sessionEntry], {
      cwd: project,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        VOLTER_PROJECT: project,
        VOLTER_PRODUCT_DIR: product.dir,
        VOLTER_EDITOR_PORT: String(port),
        VOLTER_HMR_PORT: String(hmrPort),
        VOLTER_NO_OPEN: '1',
        VOLTER_EPHEMERAL_SESSION: '1',
      },
    });
    child.stdout?.pipe(logFile);
    child.stderr?.pipe(logFile);
    let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    child.once('exit', (code, signal) => { exit = { code, signal }; });
    const serverUrl = `http://127.0.0.1:${port}`;
    const entries: Record<string, LimitedViewRouteEntry> = {};
    let sessionRoot = project;
    try {
      const booted = await waitForOwnEditorServer({ serverUrl, isOurs: (reported) => reported === project, childExit: () => exit });
      if (booted.status !== 'ready') fail(`the project's session did not start (${booted.status}); see ${logPath}.`);

      // ---- 2. what it serves.
      await initLexer;
      const record = async (url: string, options: { modulesOnly: boolean }): Promise<string | null> => {
        const response = await fetch(`${serverUrl}${url}`, { headers: { accept: '*/*' } });
        const type = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim();
        if (options.modulesOnly && (!response.ok || !/javascript/.test(type))) {
          await response.body?.cancel();
          return null;
        }
        const file = `${createHash('sha1').update(url).digest('hex').slice(0, 20)}.${extensionFor(type)}`;
        const target = join(out, VIEW_DIR, 'r', file);
        let text: string | null = null;
        if (/javascript|json|^text\//.test(type)) {
          text = await response.text();
          writeFileSync(target, text);
        } else if (response.body) {
          await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(target));
        } else writeFileSync(target, '');
        const mount = url.includes(MOUNT_SENTINEL) || (text?.includes(MOUNT_SENTINEL) ?? false);
        entries[url] = { file, type, status: response.status, ...(mount ? { mount: true as const } : {}) };
        return text;
      };

      for (const url of KIT_SNAPSHOT_ROUTES) await record(url, { modulesOnly: false });
      // The session's own identity is not the view's: a pid, a worktree and a branch of the
      // machine that built it.
      const projectAnswer = entries['/__editor/project'];
      if (projectAnswer) {
        const path = join(out, VIEW_DIR, 'r', projectAnswer.file);
        const answer = JSON.parse(readFileSync(path, 'utf8')) as { project?: { path?: string }; session?: unknown; engine?: unknown; sourceWrite?: boolean; ingestSourceWrite?: boolean };
        if (answer.project?.path) sessionRoot = answer.project.path;
        answer.session = { pid: 0, ephemeral: true, sessionId: 'limited-view', repositoryId: null, worktreeId: null, worktreeRoot: null, projectRelativePath: null, branch: null, headCommit: null, baseCommit: null };
        // The engine's git state is the building checkout's, and source writes need the session's
        // `/__ui-source/*` and `/__ingest-source/*` routes, which a view refuses.
        answer.engine = { branch: null, commit: null, behindOriginMain: null, dirty: null };
        answer.sourceWrite = false;
        answer.ingestSourceWrite = false;
        writeFileSync(path, JSON.stringify(answer));
      }
      // A heartbeat worker with nobody to beat to.
      const heartbeat = 'tab-heartbeat.js';
      writeFileSync(join(out, VIEW_DIR, 'r', heartbeat), 'self.onmessage = () => {};\n');
      entries['/__editor/tab-heartbeat.js'] = { file: heartbeat, type: 'text/javascript', status: 200 };

      for (const file of productServingModules(product)) {
        const module = (await import(pathToFileURL(file).href)) as Partial<ProjectServingModule>;
        for (const url of (await module.viewSnapshotRoutes?.()) ?? []) {
          log(`  ${url}`);
          const text = await record(url, { modulesOnly: false });
          const recorded = entries[url];
          if (text !== null && recorded && module.viewSnapshotScrub) {
            writeFileSync(join(out, VIEW_DIR, 'r', recorded.file), module.viewSnapshotScrub(url, text));
          }
        }
      }

      // The modules: every source file of the project, as the editor imports it (`/@fs/<root>/…`,
      // plain and under the mount sentinel) and as a relative import reaches it (`/<path>`), every
      // contribution the project's packages declare, and the kit's doorways.
      const files = published.files;
      const seeds = new Set<string>(PACKAGED_MODULE_DOORWAYS.map((doorway) => doorway.path));
      const rootUrl = fsUrl(sessionRoot);
      for (const file of files) {
        if (!MODULE_EXTENSIONS.test(file.path) || file.path.startsWith('public/')) continue;
        if (file.path.startsWith('.') && !file.path.startsWith('.storybook/')) continue;
        seeds.add(`${rootUrl}/${file.path}`);
        seeds.add(`/${file.path}`);
        if (!file.path.endsWith('.json') && !file.path.endsWith('.css')) seeds.add(`${rootUrl}/${file.path}?volter-mount=${MOUNT_SENTINEL}`);
      }
      // Vite names a file by its real path, so a contribution reached through a link is recorded there.
      for (const entry of computePackageContributionCrawlEntries(project).entries) {
        try {
          seeds.add(fsUrl(realpathSync(entry)));
        } catch {
          /* a declared file that is not there is the session's to report, not the view's */
        }
      }
      const queue = [...seeds];
      const seen = new Set(queue);
      let recorded = 0;
      const worker = async (): Promise<void> => {
        for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
          if (NOT_CRAWLED.test(url)) continue;
          let code: string | null;
          try {
            code = await record(url, { modulesOnly: true });
          } catch {
            continue;
          }
          if (code === null) continue;
          recorded++;
          for (const next of importedUrls(code)) {
            if (seen.has(next)) continue;
            if (seen.size >= CRAWL_LIMIT) fail(`the module crawl passed ${CRAWL_LIMIT} URLs; something imports without end (last: ${next}).`);
            seen.add(next);
            queue.push(next);
          }
        }
      };
      // Workers drain a shared queue; one that finds it empty while others still add to it simply
      // ends, so the crawl is re-run until nothing new arrived.
      while (queue.length > 0) await Promise.all(Array.from({ length: CRAWL_CONCURRENCY }, worker));
      log(`  ${recorded} modules compiled by the session`);
    } finally {
      stopSession(child);
      logFile.end();
    }

    // ---- 2b. the building machine's path out of what was recorded. Every URL and body names the
    //          project's root as `/volter-view/<name>`: what the editor builds from
    //          `/__editor/project` and what the compiled modules import then agree, and a published
    //          view does not carry `C:/Users/<you>/…`. Paths outside the project (a workspace's
    //          hoisted packages) keep their own spelling.
    const neutral = neutralProjectRoot(basename(project));
    const paths = new PathNeutralizer([sessionRoot, project], neutral, [product.dir, editorCoreRoot]);
    const recordedEntries = Object.entries(entries);
    const textOf = new Map<string, string>();
    for (const [key, entry] of recordedEntries) {
      paths.learn(key);
      if (/javascript|json|^text\//.test(entry.type)) {
        const text = readFileSync(join(out, VIEW_DIR, 'r', entry.file), 'utf8');
        textOf.set(entry.file, text);
        paths.learn(text);
      }
    }
    for (const key of Object.keys(entries)) delete entries[key];
    for (const [key, entry] of recordedEntries) {
      const published = paths.rewrite(key);
      // A recording is named for its PUBLISHED url: named for the session's, a guessed home path could
      // be confirmed against the file names offline.
      const file = `${createHash('sha1').update(published).digest('hex').slice(0, 20)}${entry.file.slice(entry.file.lastIndexOf('.'))}`;
      const text = textOf.get(entry.file);
      if (text !== undefined) {
        // Vite's inline source maps carry every original source and its absolute path, base64'd
        // where no scan reads them; a view ships none.
        const stripped = paths.rewrite(text).replace(/\n?\/\/# sourceMappingURL=[^\n]*/g, '').replace(/\/\*# sourceMappingURL=[\s\S]*?\*\//g, '');
        writeFileSync(join(out, VIEW_DIR, 'r', file), stripped);
        if (file !== entry.file) rmSync(join(out, VIEW_DIR, 'r', entry.file), { force: true });
      } else if (file !== entry.file) {
        renameSync(join(out, VIEW_DIR, 'r', entry.file), join(out, VIEW_DIR, 'r', file));
      }
      entries[published] = { ...entry, file };
    }

    // ---- 3. the view.
    log('Writing the view…');
    const vite = 'vite-client.js';
    entries['/@vite/client'] = { file: vite, type: 'text/javascript', status: 200 };
    writeFileSync(join(out, VIEW_DIR, 'routes.json'), JSON.stringify({ mountSentinel: MOUNT_SENTINEL, entries }));

    // The product's production build, minus its build manifest (a fact for the session, not a page).
    // No source maps in a published view: they carry sources and their paths.
    cpSync(distPath, out, { recursive: true, filter: (source) => !source.includes(`${sep}.vite`) && !source.endsWith('.map') });
    writeFileSync(join(out, VIEW_DIR, 'frame-bridge.js'), frameBridge);
    cpSync(workbench, join(out, WORKBENCH_DIR), { recursive: true, filter: (source) => !source.endsWith('.map') });

    const files = published.files;
    for (const file of files) {
      const target = join(out, VIEW_DIR, 'project', ...file.path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(project, ...file.path.split('/')), target);
    }
    writeFileSync(join(out, VIEW_DIR, 'files.json'), JSON.stringify({ files }));
    const config: LimitedViewConfig = {
      version: 1,
      product: { name: product.name, displayName: product.displayName, colorTheme: product.colorTheme, install: product.install },
      project: { root: neutral, name: basename(project) },
      builtAt: new Date().toISOString(),
    };
    writeFileSync(join(out, VIEW_DIR, 'view.json'), JSON.stringify(config, null, 2));

    // The page and its worker, bundled from the kit's own sources with each integration's view
    // routes compiled in.
    const esbuild = (await import(pathToFileURL(createRequire(join(editorCoreRoot, 'package.json')).resolve('esbuild')).href)) as typeof import('esbuild');
    const pageDir = join(editorCoreRoot, 'view', 'page');
    const integrations = productViewServingModules(product);
    const entry = [
      `import { startLimitedView } from ${JSON.stringify(join(pageDir, 'boot.ts').split(sep).join('/'))};`,
      ...integrations.map((file, index) => `import * as integration${index} from ${JSON.stringify(file.split(sep).join('/'))};`),
      `startLimitedView([${integrations.map((_file, index) => `integration${index}`).join(', ')}]).catch((error) => {`,
      `  const status = document.getElementById('volter-view-status');`,
      `  if (status) status.textContent = 'The limited view did not open: ' + (error && error.message ? error.message : String(error));`,
      '  throw error;',
      '});',
    ].join('\n');
    const common = { bundle: true, minify: true, platform: 'browser' as const, target: 'es2022', logLevel: 'warning' as const, define: { 'process.env.NODE_ENV': '"production"' } };
    await esbuild.build({ ...common, stdin: { contents: entry, resolveDir: pageDir, sourcefile: 'limited-view-entry.ts', loader: 'ts' }, format: 'esm', outfile: join(out, VIEW_DIR, 'boot.js') });
    await esbuild.build({ ...common, entryPoints: [join(pageDir, 'service-worker.ts')], format: 'iife', outfile: join(out, SERVICE_WORKER_FILE) });
    await esbuild.build({ ...common, entryPoints: [join(pageDir, 'vite-client.ts')], format: 'esm', outfile: join(out, VIEW_DIR, 'r', vite) });

    writeFileSync(join(out, 'index.html'), indexHtml(config));
    writeFileSync(join(out, '_headers'), HEADERS_FILE);

    // ---- 4. nothing of the building machine. A hit fails the build, and the page is taken out so
    //         the output cannot be served as a view by mistake (`view-paths.ts`).
    const leaks = scanForLocalPaths(out);
    if (leaks.length > 0) {
      fail(
        `the view would still name this machine (${leaks.length}${leaks.length >= 12 ? '+' : ''} places), so it was not written to ${final}:\n` +
          leaks.map((leak) => `  ${leak.file}: …${leak.context}…`).join('\n'),
      );
    }
    rmSync(final, { recursive: true, force: true, maxRetries: 3 });
    renameSync(out, final);
  } catch (error) {
    rmSync(out, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  }
  log(`
  ${final}

  Serve it from the ROOT of an origin (the editor's URLs are root-relative), over https or
  localhost (service workers need a secure context). Cross-origin isolation: _headers states it
  for hosts that read it; on any other host the view's own worker adds it after one reload.
    npx serve ${relative(process.cwd(), final) || '.'}`);
  return final;
}

/** Cross-origin isolation for hosts that read a `_headers` file (Netlify, Cloudflare Pages). */
const HEADERS_FILE = `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: credentialless
  Cross-Origin-Resource-Policy: same-origin
/${SERVICE_WORKER_FILE}
  Service-Worker-Allowed: /
  Cache-Control: no-cache
`;

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** The page: the web workbench's own startup (its file root, its stylesheet, its messages) and
 *  then the view's boot, which creates the workbench once the project is in place. */
function indexHtml(config: LimitedViewConfig): string {
  const background = config.product.colorTheme === 'dark' ? '#1f1f1f' : '#ffffff';
  const foreground = config.product.colorTheme === 'dark' ? '#cccccc' : '#333333';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(config.project.name)} — ${escapeHtml(config.product.displayName)}</title>
  <link rel="stylesheet" href="/${WORKBENCH_DIR}/out/vs/workbench/workbench.web.main.internal.css">
  <style>html, body { margin: 0; height: 100%; background: ${background}; color: ${foreground}; }
  #volter-view-status { font: 13px system-ui, sans-serif; padding: 16px; }</style>
</head>
<body aria-label="">
  <div id="volter-view-status">Loading…</div>
  <script>globalThis._VSCODE_FILE_ROOT = new URL('/${WORKBENCH_DIR}/out/', location.href).toString();</script>
  <script type="module" src="/${WORKBENCH_DIR}/out/nls.messages.js"></script>
  <script type="module" src="/${VIEW_DIR}/boot.js"></script>
</body>
</html>
`;
}
