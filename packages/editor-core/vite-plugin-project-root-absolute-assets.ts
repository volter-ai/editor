/**
 * vite-plugin-project-root-absolute-assets — S-9 (the SimCity ingest ledger).
 *
 * THE DEFECT. A foreign game mounted from its own folder is bundled by the
 * EDITOR's Vite server, whose `root` is the engine checkout. So a root-absolute
 * reference in the game's own source —
 *
 *     import playIconUrl from '/icons/play-color.png';   // micropolisJS ui.js
 *     <img src="/icons/person.png">                      // its index.html
 *
 * — resolved against the EDITOR's root and 404'd, taking the whole module graph
 * down with it ("Failed to fetch dynamically imported module … ui.js"). Every
 * ingested game whose author ever typed a leading slash needed a source patch
 * to mount, which is precisely the zero-diff promise the ingest path exists to
 * keep. SimCity's was two lines in `ui.js`, and it was the LAST diff.
 *
 * THE FIX, in one sentence: a root-absolute reference made BY PROJECT CODE
 * resolves inside the PROJECT, against the same conventional public roots a
 * project's own bundler would use.
 *
 * ATTRIBUTION is the whole design, because "project's assets win" and "don't
 * break the editor's own root-absolute assets" are only compatible if we can
 * tell whose request this is. Two seams, two mechanisms, both exact where they
 * can be and conservative where they cannot:
 *
 *   1. MODULE GRAPH (`resolveId`) — `importer` says exactly who asked. A
 *      root-absolute specifier imported by a file inside the open project
 *      resolves into the project, always, ahead of Vite's own root-relative
 *      resolution (`enforce: 'pre'`). Editor modules are untouched: their
 *      importer is not under the project root.
 *
 *   2. RUNTIME URLS (middleware) — an `<img src="/icons/…">` or a CSS
 *      `url(/fonts/…)` carries no importer, only a `Referer`. A referer that is
 *      itself a project file (`/project-game-static/…`, `/@fs/<project>/…`) IS
 *      exact attribution and the project wins outright. The rest are
 *      UNATTRIBUTABLE by construction — an ingested game's DOM lives in the
 *      editor's own document, so its image requests refer the editor page — and
 *      those are decided by an explicit precedence rule instead:
 *      `THE EDITOR WINS IF IT ACTUALLY HAS THE FILE`, otherwise the project
 *      answers. That also removes a class of ingest-boot 404s (S-8).
 *
 *      The precedence is computed, not positional, because POSITION DOES NOT
 *      WORK HERE and that is worth recording. The obvious design — a Vite POST
 *      hook, which runs after `serveStaticMiddleware` and before the 404, so a
 *      request only reaches us if nothing else answered — is defeated by this
 *      server's `appType: 'spa'`: `htmlFallbackMiddleware` sits BEFORE the post
 *      hooks and rewrites the URL of any extension-less-or-not request whose
 *      `Accept` contains `*​/*` (every browser image request does) to
 *      `/index.html`. So the post hook never sees a miss, it sees the editor's
 *      page. Measured, not assumed: the first cut of this plugin served the
 *      EDITOR's own document from the game's `src/index.html` and the whole
 *      editor came up as a file download.
 *
 * WHY PROBE DIRECTORIES INSTEAD OF READING A DECLARED `publicDir`. The obvious
 * alternative — load the project's own `vite.config.*` and read `root`/
 * `publicDir` — executes arbitrary user config inside the editor server, and
 * answers nothing for a game that does not use Vite at all (a webpack game, a
 * plain static game, a folder of scripts). Probing is hermetic and general: we
 * try each conventional public root in order and accept the first one that
 * ACTUALLY CONTAINS the requested file. A wrong candidate therefore cannot
 * produce a wrong answer — it simply does not match — which is what makes an
 * ordered list of guesses safe rather than magic. (micropolisJS declares
 * `root: './src'`, `publicDir: './public'`; `src/public` is the second
 * candidate and the file is found there.)
 *
 * `getProjectRoot` is a THUNK for the same reason the sibling
 * `vite-plugin-project-game-static.ts` uses one: `open-project` can switch the
 * current project live, and every request/resolve must read the CURRENT root.
 *
 * `configureServer`-only, like that sibling: it answers for an OPENED
 * project, which only a session has.
 */
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { isPathInside } from './server/server-utils';
import { MIME } from './vite-plugin-game-static';

/**
 * Project-relative directories a root-absolute reference from project code may
 * resolve into, MOST SPECIFIC FIRST. The first entry that actually contains the
 * requested file wins (see the header: this is why an ordered guess list is
 * safe). `public` and `static` are the near-universal public-asset conventions;
 * `src/public` is the Vite `root: 'src'` + `publicDir: 'public'` layout
 * micropolisJS uses; `src` and the project root itself come last and reproduce
 * plain "root-absolute means relative to the bundler root" semantics for a
 * project that keeps assets beside its source.
 */
export const PROJECT_ROOT_ABSOLUTE_DIRS: readonly string[] = [
  'public',
  'src/public',
  'static',
  'src',
  '',
];

/**
 * Prefixes that are never a project asset reference, whatever asked for them:
 * Vite's own module protocols and virtual ids, the editor's API surface, the
 * verbatim project-file route (which already resolves into the project by its
 * own rules), and node_modules (bare specifiers are Vite's job).
 */
const NEVER_PROJECT_PREFIXES = [
  '/@',
  '/__editor',
  '/__vgai',
  '/project-game-static',
  '/game-static',
  '/node_modules/',
];

/**
 * Is `id` a root-absolute reference this plugin may redirect at all? Rejects
 * anything with a scheme, a protocol-relative URL, and the reserved prefixes
 * above. Note `/` alone is rejected — that is the editor document, not an asset.
 */
export function isRedirectableRootAbsolute(id: string): boolean {
  if (!id.startsWith('/')) return false;
  if (id.startsWith('//')) return false; // protocol-relative
  if (id === '/') return false;
  return !NEVER_PROJECT_PREFIXES.some(
    (p) => id === p || id.startsWith(`${p}/`) || id.startsWith(p),
  );
}

/** Strip a query/hash suffix from a specifier or request URL. */
function bareId(id: string): string {
  return id.split('?')[0]?.split('#')[0] ?? '';
}

/**
 * Resolve the root-absolute reference `id` inside `projectRoot`, returning the
 * absolute path of the first candidate directory that actually holds a FILE
 * there — or `null` when no candidate does. `fileExists` is injected so the
 * rule is unit-testable against a synthetic tree with no disk at all.
 */
export function resolveProjectRootAbsolute(
  projectRoot: string,
  id: string,
  fileExists: (absPath: string) => boolean,
): string | null {
  if (!isRedirectableRootAbsolute(id)) return null;
  const rel = normalize(decodeURIComponentSafe(bareId(id).slice(1)));
  // A root-absolute reference that climbs out of the directory it is resolved
  // against is not a reference to a project asset under ANY candidate, so it is
  // refused once here rather than being caught per-candidate by containment —
  // otherwise `/../secret.env` merely lands one directory up, still inside the
  // project, which is a traversal that happens to stay in bounds.
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return null;
  for (const dir of PROJECT_ROOT_ABSOLUTE_DIRS) {
    const candidate = normalize(join(resolve(projectRoot), dir, rel));
    if (!isPathInside(projectRoot, candidate)) continue;
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Is this request attributable to the open project by its `Referer` alone?
 * True for a referer served out of the project's own files — the verbatim
 * `/project-game-static/` route, or a `/@fs/<projectRoot>/…` module/stylesheet.
 * A CSS `url(...)` inside the game's own stylesheet is the case this exists for.
 *
 * Deliberately NOT true for the editor document: the ingested game's DOM lives
 * in the editor page, so its `<img>` requests refer the editor and are handled
 * by the FALLBACK middleware instead (see the header) — attributable requests
 * take precedence, unattributable ones only fill a hole.
 */
export function isProjectAttributedReferer(
  referer: string | undefined,
  projectRoot: string,
): boolean {
  if (!referer) return false;
  let path: string;
  try {
    path = new URL(referer, 'http://localhost').pathname;
  } catch {
    return false;
  }
  if (path.startsWith('/project-game-static/')) return true;
  const fsPrefix = '/@fs';
  if (!path.startsWith(fsPrefix)) return false;
  const filePath = decodeURIComponentSafe(path.slice(fsPrefix.length));
  return isPathInside(projectRoot, filePath);
}

function isFile(absPath: string): boolean {
  try {
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}

interface MinimalReq {
  url?: string | undefined;
  headers?: Record<string, string | string[] | undefined> | undefined;
}
interface MinimalRes {
  statusCode: number;
  setHeader(key: string, value: string): void;
  end(body?: unknown): void;
}

/**
 * Is this request for an HTML DOCUMENT rather than an asset? Those never
 * belong to this plugin, and one of them is load-bearing: Vite's
 * `htmlFallbackMiddleware` runs BEFORE post hooks and rewrites `/` to
 * `/index.html`, so without this guard the FALLBACK handler answers the
 * editor's own page with the mounted game's `src/index.html` — the editor
 * downloads instead of loading. (Caught live, not reasoned about; the whole
 * editor came up as an `application/octet-stream` download.)
 *
 * A game reaches its own entry document through `/project-game-static/`, which
 * this plugin never touches, so nothing legitimate is lost.
 */
export function isDocumentRequest(url: string): boolean {
  const path = bareId(url).toLowerCase();
  return path.endsWith('.html') || path.endsWith('.htm') || path.endsWith('/');
}

/** The request's `Referer`, normalized past node's `string | string[]` header type. */
function refererOf(req: MinimalReq): string | undefined {
  const referer = req.headers?.['referer'];
  return Array.isArray(referer) ? referer[0] : referer;
}

/** Serve `filePath` verbatim, mirroring the sibling static route's headers. */
async function sendFile(res: MinimalRes, filePath: string): Promise<boolean> {
  try {
    const buf = await readFile(filePath);
    res.setHeader('Content-Type', MIME[extname(filePath)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.statusCode = 200;
    res.end(buf);
    return true;
  } catch {
    return false;
  }
}

/** Where the EDITOR itself serves root-absolute paths from: its Vite
 *  `publicDir` then its `root`. Supplied by `configResolved`. */
export interface EditorServingDirs {
  readonly publicDir: string | undefined;
  readonly root: string;
}

/**
 * Decide who answers a root-absolute request. Exported and pure (both existence
 * probes are injected) because THIS is the contract — "project's assets win"
 * and "the editor's own assets keep working" are one rule, not two middlewares
 * in a lucky order.
 *
 *   - not a redirectable asset path, or no project open → nobody, pass it on
 *   - referer is a project file → PROJECT (exact attribution, wins outright)
 *   - the editor actually has this file → EDITOR (pass it on untouched)
 *   - otherwise → PROJECT if it has the file, else nobody
 */
export function decideRootAbsoluteOwner(args: {
  url: string;
  referer: string | undefined;
  projectRoot: string | undefined;
  editorDirs: EditorServingDirs;
  projectFile: (projectRoot: string, url: string) => string | null;
  editorHasFile: (absPath: string) => boolean;
}): { owner: 'project'; filePath: string } | { owner: 'editor' | 'none' } {
  const { url, referer, projectRoot, editorDirs } = args;
  if (!projectRoot) return { owner: 'none' };
  if (!isRedirectableRootAbsolute(url) || isDocumentRequest(url)) return { owner: 'none' };
  const rel = bareId(url).slice(1);
  const editorCandidates = [
    ...(editorDirs.publicDir ? [join(editorDirs.publicDir, rel)] : []),
    join(editorDirs.root, rel),
  ];
  // Packaged mode's Vite root IS the open project. Let that Vite instance
  // transform its own modules instead of serving them verbatim merely because
  // their Referer is another project module. External-project dev mode keeps
  // the attributed-project precedence below because its Vite root differs.
  if (
    resolve(editorDirs.root) === resolve(projectRoot) &&
    editorCandidates.some(args.editorHasFile)
  ) {
    return { owner: 'editor' };
  }
  const attributed = isProjectAttributedReferer(referer, projectRoot);
  if (!attributed) {
    if (editorCandidates.some(args.editorHasFile)) return { owner: 'editor' };
  }
  const filePath = args.projectFile(projectRoot, url);
  return filePath ? { owner: 'project', filePath } : { owner: 'none' };
}

/**
 * Build the request handler this plugin installs. Exported (rather than built
 * inline in `configureServer`) so a unit test can drive it with a fake req/res.
 */
export function createProjectRootAbsoluteHandler(
  getProjectRoot: () => string | undefined,
  getEditorDirs: () => EditorServingDirs,
) {
  return async (req: MinimalReq, res: MinimalRes, next: () => void): Promise<void> => {
    const decision = decideRootAbsoluteOwner({
      url: req.url ?? '',
      referer: refererOf(req),
      projectRoot: getProjectRoot(),
      editorDirs: getEditorDirs(),
      projectFile: (root, url) => resolveProjectRootAbsolute(root, url, isFile),
      editorHasFile: isFile,
    });
    if (decision.owner !== 'project' || !(await sendFile(res, decision.filePath))) next();
  };
}

export function projectRootAbsoluteAssetsPlugin(getProjectRoot: () => string | undefined): Plugin {
  // Filled by `configResolved`; the handler reads it through a thunk so it is
  // never captured before Vite has resolved the config.
  let editorDirs: EditorServingDirs = { publicDir: undefined, root: process.cwd() };
  const handler = createProjectRootAbsoluteHandler(getProjectRoot, () => editorDirs);
  return {
    name: 'vgai-project-root-absolute-assets',
    // Ahead of `vite:resolve`, whose root-relative rule is the defect.
    enforce: 'pre',
    configResolved(config) {
      editorDirs = {
        publicDir: config.publicDir || undefined,
        root: config.root,
      };
    },
    resolveId(source, importer) {
      const projectRoot = getProjectRoot();
      if (!projectRoot || !importer) return null;
      if (!isRedirectableRootAbsolute(source)) return null;
      // ATTRIBUTION: only project code redirects. `importer` is an absolute fs
      // path for a project module (Vite normalizes `/@fs/…` to it), so this is
      // an exact test, not a heuristic.
      if (!isPathInside(projectRoot, bareId(importer))) return null;
      const resolved = resolveProjectRootAbsolute(projectRoot, source, (p) => existsSync(p));
      return resolved ?? null;
    },
    configureServer(server) {
      // PRE hook deliberately (see the header): a post hook never sees a miss
      // on this `appType: 'spa'` server, because `htmlFallbackMiddleware`
      // rewrites the URL to `/index.html` first. Precedence is therefore
      // decided inside the handler, by `decideRootAbsoluteOwner`, rather than
      // by where this middleware sits.
      server.middlewares.use(handler);
    },
  };
}
