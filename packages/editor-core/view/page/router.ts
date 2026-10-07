/**
 * THE SESSION'S ROUTES, ANSWERED IN THE PAGE — what `/__editor/*` means in a limited view.
 *
 * The editor calls the same routes it calls in a session; the view's service worker hands each
 * one here (`service-worker.ts`), and this answers it against the project's files in memory
 * (`project-store.ts`). Four kinds of answer, and docs/LIMITED-VIEW.md lists every route:
 *
 *  - FILE ROUTES, over the store, with the session's request and response shapes
 *    (`server/routes/project-source.ts`, `project-identity.ts`, `project-state.ts`,
 *    `settings.ts`, `themes.ts`, `assets.ts`), so an edit made in the view is visible to every
 *    later read in it. The person's own layers (user settings, user state, user themes) start
 *    empty and live in this page: a view must not carry its builder's.
 *  - REPORTS the page sends a session (tab presence, console and play reports, command
 *    acknowledgements), accepted and dropped: nothing in a static page reads them.
 *  - THE INTEGRATIONS' ROUTES (`volter.viewServing`, `@volter/editor-sdk/session/limited-view`).
 *  - EVERYTHING ELSE under `/__editor/` is a refusal by name ({@link unavailableFeature}).
 *
 * Fixed answers recorded at build time (`/__editor/project`, `/__editor/project-tools`, compiled
 * modules, an engine's WebAssembly) never reach this router: the service worker serves them
 * from `__view/routes.json` first.
 */

import {
  LIMITED_VIEW_HEADER,
  limitedViewUnavailableBody,
  type ViewRoute,
  type ViewServingServices,
} from '@volter/editor-sdk/session/limited-view';
import { globToRegExp } from '@volter/editor-sdk/session/source-glob';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import { parseEditorSettings } from '@volter/editor-project/settings/schema';
import { foldDataFileText } from '../../server/data-file-serialize';
import type { SeededProjectStore } from './project-store';
import { type LimitedViewConfig, VIEW_DIR, VIEW_MISS_HEADER } from './view-contract';

/** The id the Code-OSS contribution looks for (`server/routes/served-modules.ts`). */
const FRAME_BRIDGE_MODULE_ID = 'vscode-bridge';

const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function respond(body: BodyInit | null, status: number, type: string | null, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { ...ISOLATION_HEADERS, 'Cache-Control': 'no-store', ...extra };
  if (type) headers['Content-Type'] = type;
  return new Response(body, { status, headers });
}

const json = (body: unknown, status = 200): Response => respond(JSON.stringify(body), status, 'application/json');
const ok = (): Response => json({ ok: true });

/** What a refused family of routes is called, in a person's words. */
const UNAVAILABLE_FEATURES: readonly [RegExp, string][] = [
  [/^\/__editor\/(account|twin)/, 'Your Volter account'],
  [/^\/__editor\/(harness-chat|worktrees|project-work|repository-presence)/, 'Chat and agents'],
  [/^\/__editor\/(git|share-control)/, 'Git, publishing and sharing'],
  [/^\/__editor\/collaboration/, 'Collaboration'],
  [/^\/__editor\/recording/, 'Recording'],
  [/^\/__editor\/(generations|project-tools\/run|asset-library)/, 'Tools, generation and the asset library'],
  [/^\/__editor\/configurations/, 'Running and building the project'],
  [/^\/__editor\/(open-project|create-project|inspect-project|adapt-project|browse-folder|reveal|recent-projects|launcher-settings|templates|examples|save-thumbnail)/, 'Opening and creating projects'],
  [/^\/__editor\/(download|export)/, 'Exporting a build'],
  [/^\/__editor\/command$/, 'Driving the editor from a terminal'],
  [/^\/__editor\/source-conflict\/resolve/, 'Resolving a source conflict'],
];

export function unavailableFeature(pathname: string): string {
  return UNAVAILABLE_FEATURES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'This part of the editor';
}

/** Reports a session collects and a static page has nobody to read: accepted, dropped. */
const DROPPED_REPORTS = new RegExp(
  '^/__editor/(state|heartbeat|tab/(ensure|route|claim|expect-restart|close)|page-error|play-phase|' +
    'console-entries|console-resolved|console/ack|command-result|command-received|command-listener|' +
    'contributed-commands|log-session|log-entries|server-log)$',
);

/** A project-relative path the routes may touch: no traversal, no absolute path, no backslash. */
function contained(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The content type a raw project file is served with, by extension. */
export function contentTypeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
    txt: 'text/plain', md: 'text/markdown', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
    wasm: 'application/wasm', glb: 'model/gltf-binary', gltf: 'model/gltf+json', mp3: 'audio/mpeg',
    ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff',
    woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', ts: 'text/plain', tsx: 'text/plain',
  };
  return types[ext] ?? 'application/octet-stream';
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface LimitedViewRouterOptions {
  readonly config: LimitedViewConfig;
  readonly store: SeededProjectStore;
  /** The routes each composed integration's `volter.viewServing` module returned. */
  readonly integrations?: readonly ViewRoute[];
}

/** The services an integration's view routes are handed. */
export function viewServingServices(config: LimitedViewConfig, store: SeededProjectStore): ViewServingServices {
  return {
    projectRoot: config.project.root,
    files: store,
    json,
    unavailable: (feature, reason) =>
      respond(JSON.stringify(limitedViewUnavailableBody(feature, config.product.install, reason)), 503, 'application/json', {
        [LIMITED_VIEW_HEADER]: 'unavailable',
      }),
  };
}

export function createLimitedViewRouter(options: LimitedViewRouterOptions): (request: Request) => Promise<Response> {
  const { config, store } = options;
  const services = viewServingServices(config, store);
  // A Windows root is spelled with `/` in every URL the browser sends (`\` is `/` in an http path).
  const root = config.project.root.replaceAll('\\', '/').replace(/\/+$/, '');
  /** `/@fs/<root>/` as Vite spells it: a POSIX root carries its own leading slash, a Windows one does not. */
  const fsPrefix = root.startsWith('/') ? `/@fs${root}/` : `/@fs/${root}/`;
  /** The person's own layers: empty at load, kept in this page. */
  let userSettings: unknown = {};
  let userState: Record<string, unknown> = {};
  const userThemes = new Map<string, unknown>();

  const readText = async (path: string): Promise<string | null> => {
    try {
      return await store.read(path);
    } catch {
      return null;
    }
  };
  const readJsonFile = async (path: string): Promise<unknown> => {
    const text = await readText(path);
    if (text === null) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  const writeJsonFile = (path: string, value: unknown) => store.write(path, `${JSON.stringify(value, null, 2)}\n`);

  /** A raw project file, or `?raw` as Vite's own module body for it: the text as it is NOW. */
  const serveFile = async (path: string, search: URLSearchParams): Promise<Response | null> => {
    const found = await store.stat(path);
    if (!found || found.type !== 'file') return null;
    const bytes = await store.readBytes(path);
    if (search.has('raw')) {
      return respond(`export default ${JSON.stringify(new TextDecoder().decode(bytes))};\n`, 200, 'text/javascript');
    }
    return respond(bytes as Uint8Array<ArrayBuffer>, 200, contentTypeOf(path));
  };

  const listAssets = async (url: URL): Promise<Response> => {
    const dir = url.searchParams.get('dir') ?? '';
    const rootName = url.searchParams.get('root') ?? 'public';
    if (rootName !== 'public' && rootName !== 'references') return json({ error: 'Unknown asset root.' }, 400);
    if (dir !== '' && !contained(dir)) return json({ error: 'Path traversal not allowed.' }, 400);
    const absolute = dir ? `${rootName}/${dir}` : rootName;
    let entries;
    try {
      entries = await store.list(absolute);
    } catch {
      return dir === '' ? json({ entries: [] }) : json({ error: `No such directory: ${dir}` }, 404);
    }
    return json({
      entries: entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map((entry) => ({ name: entry.name, type: entry.type === 'dir' ? 'directory' : 'file', size: entry.size ?? 0, mtime: entry.mtime ?? 0 })),
    });
  };

  const kit: ViewRoute[] = [
    {
      method: 'GET',
      match: /^\/__editor\/served-modules$/,
      handle: () => json({ modules: [{ id: FRAME_BRIDGE_MODULE_ID, url: `/${VIEW_DIR}/frame-bridge.js` }], refusals: [] }),
    },
    // The session's event stream: a static page has no events, and 204 tells an EventSource
    // not to reconnect.
    { method: 'GET', match: /^\/__editor\/events$/, handle: () => respond(null, 204, null) },
    { method: 'GET', match: /^\/__editor\/assets$/, handle: (_request, url) => listAssets(url) },
    {
      method: 'POST',
      match: /^\/__editor\/save-file$/,
      handle: async (request) => {
        const body = await readJson(request);
        const path = typeof body?.['path'] === 'string' ? body['path'] : '';
        if (!contained(path)) return json({ error: 'Invalid path.' }, 400);
        if (body?.['delete'] === true) {
          await store.remove(`public/${path}`);
          return json({ ok: true, path, revision: null });
        }
        if (typeof body?.['content'] !== 'string') return json({ error: 'Missing content.' }, 400);
        await store.write(`public/${path}`, body['encoding'] === 'base64' ? base64ToBytes(body['content']) : body['content']);
        return json({ ok: true, path, revision: null });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/(source-file|source-conflict)$/,
      handle: async (_request, url) => {
        const path = (url.searchParams.get('path') ?? '').split('\\').join('/');
        if (!contained(path)) return json({ error: 'Path is outside the project.' }, 400);
        const text = await readText(path);
        if (url.pathname.endsWith('source-conflict')) return json({ path, content: text });
        return text === null ? json({ error: 'Not found.' }, 404) : respond(text, 200, 'text/plain');
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/source-files$/,
      handle: async (_request, url) => {
        const globs = url.searchParams.getAll('include').filter((glob) => glob.length > 0 && !glob.includes('..'));
        const matchers = globs.map(globToRegExp);
        const files = (await store.allFiles('src')).filter(
          (file) =>
            !file.path.split('/').some((segment) => segment.startsWith('.') || segment === 'node_modules') &&
            matchers.some((matcher) => matcher.test(file.path)),
        );
        if (url.searchParams.get('order') === 'mtime') files.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
        else files.sort((a, b) => a.path.localeCompare(b.path));
        return json({ files: files.map((file) => file.path) });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/(volter-file|project-resource)$/,
      handle: async (_request, url) => {
        const path = url.searchParams.get('path') ?? '';
        const volterFile = url.pathname.endsWith('volter-file');
        if (!contained(path) || (volterFile && !path.startsWith('.volter/'))) return json({ error: 'Invalid path.' }, 400);
        const found = await store.stat(path);
        if (!found || found.type !== 'file') return json({ error: 'Not found.' }, 404);
        const type = volterFile ? (path.endsWith('.png') ? 'image/png' : 'text/plain') : 'application/octet-stream';
        return respond((await store.readBytes(path)) as Uint8Array<ArrayBuffer>, 200, type);
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/(volter-file|project-resource)$/,
      handle: async (request, url) => {
        const body = await readJson(request);
        const path = typeof body?.['path'] === 'string' ? body['path'] : '';
        const volterFile = url.pathname.endsWith('volter-file');
        if (!contained(path) || (volterFile && !path.startsWith('.volter/'))) return json({ error: 'Invalid path.' }, 400);
        const content = typeof body?.['content'] === 'string' ? body['content'] : '';
        if (!volterFile && body?.['encoding'] !== 'base64') return json({ error: 'Project resource content must be base64.' }, 400);
        await store.write(path, body?.['encoding'] === 'base64' ? base64ToBytes(content) : content);
        return json({ ok: true, revision: null });
      },
    },
    {
      method: 'DELETE',
      match: /^\/__editor\/project-resource$/,
      handle: async (request) => {
        const body = await readJson(request);
        const path = typeof body?.['path'] === 'string' ? body['path'] : '';
        if (!contained(path)) return json({ error: 'Invalid project resource path.' }, 400);
        await store.remove(path);
        return json({ ok: true, revision: null });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/data-files$/,
      handle: async () => {
        const files: { path: string; content: string; schema: string | null }[] = [];
        for (const file of (await store.allFiles('src/data')).sort((a, b) => a.path.localeCompare(b.path))) {
          if (!file.path.endsWith('.data.json') || file.path.split('/').some((segment) => segment.startsWith('.'))) continue;
          const content = await readText(file.path);
          if (content === null) continue;
          files.push({ path: file.path, content, schema: await readText(file.path.replace(/\.data\.json$/, '.schema.json')) });
        }
        return json({ files });
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/data-file$/,
      handle: async (request) => {
        const body = await readJson(request);
        const path = typeof body?.['path'] === 'string' ? body['path'] : '';
        if (!contained(path) || !path.startsWith('src/data/') || !path.endsWith('.data.json')) {
          return json({ error: 'Invalid path — expected src/data/**/*.data.json.' }, 400);
        }
        const values = body?.['values'];
        if (!values || typeof values !== 'object' || Array.isArray(values)) return json({ error: 'values must be a JSON object.' }, 400);
        await store.write(path, foldDataFileText(await readText(path), values as Record<string, unknown>));
        return json({ ok: true, path, revision: null });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/manifest$/,
      handle: async () => {
        const text = await readText(MANIFEST_FILENAME);
        return text === null ? json({ error: 'Not found.' }, 404) : respond(text, 200, 'application/json');
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/manifest$/,
      handle: async (request) => {
        const body = await readJson(request);
        const content = body?.['content'];
        if (typeof content !== 'string') return json({ error: 'A manifest write carries its content as a string.' }, 400);
        try {
          JSON.parse(content);
        } catch {
          return json({ error: `${MANIFEST_FILENAME} must be JSON.` }, 400);
        }
        await store.write(MANIFEST_FILENAME, content);
        return json({ ok: true, revision: null });
      },
    },
    {
      method: 'DELETE',
      match: /^\/__editor\/manifest$/,
      handle: async () => {
        await store.remove(MANIFEST_FILENAME);
        return json({ ok: true, revision: null });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/editor-state$/,
      handle: async () => json((await readJsonFile('.volter/editor-state.json')) ?? {}),
    },
    {
      method: 'POST',
      match: /^\/__editor\/editor-state$/,
      handle: async (request) => {
        await writeJsonFile('.volter/editor-state.json', await readJson(request));
        return ok();
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/workbench-storage$/,
      handle: async () => {
        const stored = (await readJsonFile('.volter/workbench-storage.json')) as { items?: unknown } | undefined;
        const items = stored?.items && typeof stored.items === 'object' && !Array.isArray(stored.items) ? stored.items : {};
        return json({ items });
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/workbench-storage$/,
      handle: async (request) => {
        const body = await readJson(request);
        const stored = (await readJsonFile('.volter/workbench-storage.json')) as { items?: Record<string, string> } | undefined;
        const items: Record<string, string> = { ...(stored?.items ?? {}) };
        for (const [key, value] of Object.entries((body?.['insert'] ?? {}) as Record<string, unknown>)) {
          if (typeof value === 'string') items[key] = value;
        }
        for (const key of (Array.isArray(body?.['delete']) ? body['delete'] : []) as unknown[]) {
          if (typeof key === 'string') delete items[key];
        }
        await writeJsonFile('.volter/workbench-storage.json', { items });
        return ok();
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/settings\/(user|project)$/,
      handle: async (_request, url) => {
        if (url.pathname.endsWith('/user')) return json({ settings: userSettings, issues: [], path: null });
        const raw = await readJsonFile('.volter/settings.json');
        if (raw === undefined) return json({ settings: {}, issues: [], path: '.volter/settings.json' });
        const parsed = parseEditorSettings(raw);
        return json({ settings: parsed.settings ?? {}, issues: parsed.issues, path: '.volter/settings.json' });
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/settings\/(user|project)$/,
      handle: async (request, url) => {
        const layer = url.pathname.endsWith('/user') ? 'user' : 'project';
        const parsed = parseEditorSettings(await readJson(request));
        if (!parsed.settings) return json({ error: `Invalid ${layer} settings.`, issues: parsed.issues }, 400);
        if (layer === 'user') userSettings = parsed.settings;
        else await writeJsonFile('.volter/settings.json', parsed.settings);
        return json({ ok: true, path: layer === 'user' ? null : '.volter/settings.json' });
      },
    },
    { method: 'GET', match: /^\/__editor\/user-state$/, handle: () => json(userState) },
    {
      method: 'POST',
      match: /^\/__editor\/user-state$/,
      handle: async (request) => {
        const patch = await readJson(request);
        if (!patch) return json({ error: 'User state is a JSON object of the sections that changed.' }, 400);
        userState = { ...userState, ...patch };
        return json({ ok: true, path: null });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/themes\/(user|project)$/,
      handle: async (_request, url) => {
        if (url.pathname.endsWith('/user')) {
          return json({ documents: [...userThemes].map(([id, document]) => ({ id, path: null, document })), issues: [], dir: null });
        }
        const documents: { id: string; path: string; document: unknown }[] = [];
        const issues: string[] = [];
        for (const file of await store.allFiles('.volter/themes')) {
          const name = file.path.slice('.volter/themes/'.length);
          if (name.includes('/') || !name.endsWith('.json')) continue;
          const document = await readJsonFile(file.path);
          if (document === undefined) issues.push(`${file.path}: not JSON`);
          else documents.push({ id: name.slice(0, -'.json'.length), path: file.path, document });
        }
        return json({ documents, issues, dir: '.volter/themes' });
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/themes\/(user|project)$/,
      handle: async (request, url) => {
        const body = await readJson(request);
        const id = typeof body?.['id'] === 'string' ? body['id'] : '';
        if (!/^[a-z0-9_-]+$/.test(id) || !body?.['document'] || typeof body['document'] !== 'object') {
          return json({ error: 'A theme write names an id and carries a JSON document.' }, 400);
        }
        if (url.pathname.endsWith('/user')) userThemes.set(id, body['document']);
        else await writeJsonFile(`.volter/themes/${id}.json`, body['document']);
        return json({ ok: true, path: url.pathname.endsWith('/user') ? null : `.volter/themes/${id}.json` });
      },
    },
    {
      method: 'DELETE',
      match: /^\/__editor\/themes\/(user|project)$/,
      handle: async (_request, url) => {
        const id = url.searchParams.get('id') ?? '';
        if (!/^[a-z0-9_-]+$/.test(id)) return json({ error: 'A theme delete names an id.' }, 400);
        if (url.pathname.endsWith('/user')) userThemes.delete(id);
        else await store.remove(`.volter/themes/${id}.json`);
        return ok();
      },
    },
  ];

  const routes = [...kit, ...(options.integrations ?? [])];

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const route = routes.find(
      (candidate) => (candidate.method === method || (method === 'HEAD' && candidate.method === 'GET')) && candidate.match.test(url.pathname),
    );
    if (route) {
      try {
        return await route.handle(request, url);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }
    if (url.pathname.startsWith('/__editor/')) {
      if (method !== 'GET' && DROPPED_REPORTS.test(url.pathname)) return ok();
      return services.unavailable(unavailableFeature(url.pathname));
    }
    if (method === 'GET' || method === 'HEAD') {
      // Vite's module transport for a file inside the project, and root-relative paths: what the
      // project-rooted Vite serves at `/<path>` (its `public/` first, then the file itself).
      const path = decodeURIComponent(url.pathname);
      const answered = path.startsWith(fsPrefix)
        ? await serveFile(path.slice(fsPrefix.length), url.searchParams)
        : !path.startsWith('/@')
          ? ((await serveFile(`public/${path.slice(1)}`, url.searchParams)) ?? (await serveFile(path.slice(1), url.searchParams)))
          : null;
      if (answered) return answered;
    }
    return respond('Not in this limited view.', 404, 'text/plain', { [VIEW_MISS_HEADER]: '1' });
  };
}
