/**
 * THE SHAPE OF A LIMITED VIEW ON DISK — shared by the Node half that writes it
 * (`server/view/view-build.ts`) and the browser half that reads it (`boot.ts`, `service-worker.ts`).
 *
 *   <out>/index.html            the page: the workbench's host, its boot script
 *   <out>/view-sw.js            the service worker (scope `/`)
 *   <out>/_headers              cross-origin isolation for hosts that read it
 *   <out>/assets/…              the product's production build (`<product>/dist`)
 *   <out>/workbench/…           the Code-OSS web workbench (`build-release.mjs --target web`)
 *   <out>/__view/view.json      {@link LimitedViewConfig}
 *   <out>/__view/routes.json    {@link LimitedViewRoutes}: compiled modules and fixed answers
 *   <out>/__view/files.json     {@link LimitedViewProjectIndex}: the project's files
 *   <out>/__view/project/…      the project's files, as they were at build time
 *   <out>/__view/r/…            the bodies {@link LimitedViewRoutes} names
 *
 * Nothing here imports Node or the DOM beyond `URL`, so both halves compile it.
 */

/** The directory every file the view itself owns lives under. */
export const VIEW_DIR = '__view';
/** The vscode-web package, copied whole. Its `out/` is `_VSCODE_FILE_ROOT`. */
export const WORKBENCH_DIR = 'workbench';
/** The service worker's own file, at the root so its scope is the whole origin. */
export const SERVICE_WORKER_FILE = 'view-sw.js';

/** Paths the service worker hands straight to the static host: the view's own files, the
 *  workbench and the product's chunks. Everything else may be the session's to answer. */
export const STATIC_PREFIXES = [
  `/${VIEW_DIR}/`,
  `/${WORKBENCH_DIR}/`,
  '/assets/',
  `/${SERVICE_WORKER_FILE}`,
  '/favicon.ico',
] as const;

/** The header a page-router miss carries, so the service worker tries the static host instead. */
export const VIEW_MISS_HEADER = 'x-volter-view-miss';

/** What the page is told about the view it is. */
export interface LimitedViewConfig {
  readonly version: 1;
  readonly product: {
    /** `@volter/model-editor`. */
    readonly name: string;
    readonly displayName: string;
    readonly colorTheme: 'dark' | 'light';
    /** `volter.product.install`. */
    readonly install: string;
  };
  readonly project: {
    /** The root the session reported (`/__editor/project`'s `project.path`), which every
     *  compiled module's `/@fs/` URL is spelled against. */
    readonly root: string;
    /** The folder's name: the workspace folder the workbench opens. */
    readonly name: string;
  };
  readonly builtAt: string;
}

/** One answer the view ships as bytes. */
export interface LimitedViewRouteEntry {
  /** Under `__view/r/`. */
  readonly file: string;
  readonly type: string;
  readonly status: number;
  /** The body carries {@link LimitedViewRoutes.mountSentinel} where a mount id goes. */
  readonly mount?: true;
}

export interface LimitedViewRoutes {
  /** Stands for `volter-mount=<id>`'s id in recorded URLs and bodies (`vite-plugin-mount-isolation.ts`). */
  readonly mountSentinel: string;
  /** Keyed by pathname + search, exactly as the request was made at build time. */
  readonly entries: Readonly<Record<string, LimitedViewRouteEntry>>;
}

export interface LimitedViewProjectFile {
  /** Project-root relative, `/`-separated. */
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
}

export interface LimitedViewProjectIndex {
  readonly files: readonly LimitedViewProjectFile[];
}

/** The mount id the build requests every project module under, so one recording serves every
 *  `?volter-mount=<id>` the page will ask for. Letters only: it must survive being a query value,
 *  a JSON string and an identifier fragment unchanged. */
export const MOUNT_SENTINEL = 'volterviewmount';

/** Cache busters the editor appends that change nothing about the module served. */
const BUSTER_KEYS = new Set(['t', 'volter-source', 'volter-reload']);
/** A script module's own source: Vite's `?import` marker changes nothing about how one is
 *  compiled (it matters for assets and JSON, which keep it). */
export const SCRIPT_SOURCE = /\.(?:[cm]?[jt]sx?)$/;

/** The neutral project root a view's recorded URLs and bodies are spelled against, instead of the
 *  building machine's own absolute path. POSIX-shaped, so `/@fs/<root>/…` is `/@fs/volter-view/…`. */
export function neutralProjectRoot(projectName: string): string {
  return `/volter-view/${projectName.replace(/[^A-Za-z0-9._-]/g, '-')}`;
}

/**
 * The key a recorded answer is looked up by when the exact URL is not recorded: busters
 * dropped, the mount id replaced by the sentinel. Query pairs are kept verbatim and in order —
 * Vite's own keys (`?import`, `?raw`, `?v=…`) are part of a module's identity.
 */
export function recordedKey(pathname: string, search: string): { key: string; mount: string | null } {
  let mount: string | null = null;
  const pairs = search.replace(/^\?/, '').split('&').filter((pair) => pair !== '');
  const kept: string[] = [];
  for (const pair of pairs) {
    const [rawKey = '', ...rest] = pair.split('=');
    const key = decodeURIComponent(rawKey);
    if (BUSTER_KEYS.has(key)) continue;
    if (key === 'import' && SCRIPT_SOURCE.test(pathname)) continue;
    if (key === 'volter-mount') {
      mount = decodeURIComponent(rest.join('='));
      kept.push(`volter-mount=${MOUNT_SENTINEL}`);
      continue;
    }
    kept.push(pair);
  }
  return { key: kept.length > 0 ? `${pathname}?${kept.join('&')}` : pathname, mount };
}
