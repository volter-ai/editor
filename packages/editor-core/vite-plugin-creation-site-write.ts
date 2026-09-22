/**
 * `vgai-creation-site-write` — the `/__ingest-source/*` dev-server
 * routes that let an ingest edit be written into the game's OWN source at the
 * line the creation-site index anchored it to.
 *
 * This file is wiring only; every decision lives in `server/creation-site-write.ts`
 * (ownership, containment, the checksum guard) and `src/creation-site-edit.ts`
 * (what may be rewritten). The split is the same one `vite-plugin-ui-oid.ts`
 * makes, and for the same reason: a handler that is a pure function of
 * `(body, projectRoot, engineRoot)` is one a unit test can drive without a
 * server.
 *
 * `getProjectRoot` is a THUNK, exactly like `uiOidPlugin`'s: `server/dev.ts`
 * keeps `process.env.VGAI_PROJECT` current as projects open and close
 * (`onProjectOpened`), so a route resolved per request follows the switch and a
 * snapshot taken at config time would not.
 *
 * ROUTES ARE ALWAYS REGISTERED, and refuse per request. There is no
 * "only mount these when the project is writable" branch, because ownership can
 * change under a running server (a project switch) and because a route that is
 * absent gives a client a different failure than a route that says no — and the
 * honest answer, with its reason, is the product surface here.
 */
import type { Plugin } from 'vite';
import {
  bindIngestWriteInvalidation,
  type HandlerResult,
  handleIngestApply,
  handleIngestInspect,
  handleIngestOwnership,
  handleIngestPrepare,
  handleIngestRead,
} from './server/creation-site-write';
import { editorChromeStampBoundary } from './server/project-script-hmr';

interface RequestLike {
  body?: unknown;
  url?: string | undefined;
  method?: string | undefined;
  on(event: string, listener: (chunk?: unknown) => void): void;
}
interface ResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function send(res: ResponseLike, result: HandlerResult): void {
  res.statusCode = result.status ?? 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.body));
}

/**
 * The request body — FROM `req.body` when something upstream already parsed it,
 * and only otherwise from the stream.
 *
 * That first line is not defensive coding, it is the only thing that works
 * here. `server/dev.ts` mounts Vite in middleware mode BEHIND an express app
 * (`app.use(editorRouter)` then `app.use(vite.middlewares)`), and the editor
 * router installs `express.json()` for every route it sees — so by the time a
 * Vite plugin middleware runs, the POST body has already been consumed and
 * attached to `req.body`. Reading the stream instead waits for a `data`/`end`
 * pair that fired minutes ago and NEVER RESOLVES: the request hangs, the client
 * awaits forever, and — because nothing threw — not one line appears in any log.
 * Measured live on SimCity: the write silently did nothing while every gate
 * reported open. `vite-plugin-ui-oid.ts`'s `readJson` has the same first line
 * for the same reason; do not "simplify" it away.
 */
export async function readBody(req: RequestLike): Promise<Record<string, unknown>> {
  const parsed = (req as { body?: unknown }).body;
  if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolveBody, reject) => {
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk as Uint8Array)));
    req.on('end', () => resolveBody());
    req.on('error', (error) => reject(error));
  });
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

/** One handler per route, as a table — `vite-plugin-ui-oid.ts`'s `postRoutes`
 *  shape. Every entry is a pure function of `(body, projectRoot, engineRoot)`,
 *  which is what lets `creation-site-write.test.ts` drive them with no server. */
const POST_ROUTES: Record<
  string,
  (
    body: Record<string, unknown>,
    projectRoot: string | undefined,
    engineRoot: string,
  ) => HandlerResult
> = {
  '/__ingest-source/prepare': handleIngestPrepare,
  '/__ingest-source/inspect': handleIngestInspect,
  '/__ingest-source/read': handleIngestRead,
  '/__ingest-source/apply': handleIngestApply,
};

/** The response for one `/__ingest-source/*` request, or `null` when the path is
 *  not ours and the request belongs to the next middleware. A THROWN handler is
 *  a bug, not a refusal, and must not read as one: refusals are 200/403 with a
 *  `reason` the UI shows, so a throw becomes an explicit 500. */
async function respondTo(
  path: string,
  req: RequestLike,
  projectRoot: string | undefined,
  engineRoot: string,
): Promise<HandlerResult | null> {
  try {
    if (path === '/__ingest-source/ownership') {
      return handleIngestOwnership(projectRoot, engineRoot);
    }
    const handler = POST_ROUTES[path];
    if (!handler) return null;
    return handler(await readBody(req), projectRoot, engineRoot);
  } catch (error) {
    return {
      status: 500,
      body: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

/**
 * This plugin's Vite name — the ONE spelling, so a host can ask its own
 * resolved plugin list whether it serves `/__ingest-source/*` instead of
 * declaring the same fact a second time. `vite-plugin-ui-oid.ts`'s
 * `UI_OID_PLUGIN_NAME` is the sibling.
 */
export const CREATION_SITE_WRITE_PLUGIN_NAME = 'vgai-creation-site-write';

/**
 * Does this Vite instance serve the `/__ingest-source/*` ownership + write
 * routes?
 *
 * Read off the RESOLVED plugin list, never declared — the same rule, and the
 * same defect behind it, as {@link servesUiSourceRoutes}: an ingest edit's
 * recorder is a fact about THIS SESSION'S HOST, and `import.meta.env.DEV` is a
 * fact about how the editor shell was built. This is what `/__editor/project`
 * reports as `ingestSourceWrite` and what
 * `src/ui-source/tier-source-write-backend.ts` hands the ingest lane.
 */
export function servesIngestSourceRoutes(plugins: readonly { name: string }[]): boolean {
  return plugins.some((plugin) => plugin.name === CREATION_SITE_WRITE_PLUGIN_NAME);
}

export function creationSiteWritePlugin(
  getProjectRoot: () => string | undefined,
  engineRoot: string,
): Plugin {
  return {
    name: CREATION_SITE_WRITE_PLUGIN_NAME,
    configureServer(server) {
      // `apply` writes the game's own source, so it invalidates the modules it
      // replaced — see `creation-site-write.ts`'s
      // `writtenSourceInvalidationGraph` for the stale-remount this closes, and
      // why the watcher is not allowed to be the only path.
      //
      // The boundary: a written game module's stamp propagates through its
      // importers so the game's own subgraph re-evaluates, but must STOP at
      // editor chrome — an unbounded walk re-stamped `play-mode.ts` and split
      // its container singleton. ONE shared spelling with the ui-oid write
      // route — see `editorChromeStampBoundary`'s doc.
      bindIngestWriteInvalidation(
        server.moduleGraph,
        editorChromeStampBoundary(engineRoot, getProjectRoot),
      );
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        if (!path.startsWith('/__ingest-source/')) return next();
        const result = await respondTo(
          path,
          req as unknown as RequestLike,
          getProjectRoot(),
          engineRoot,
        );
        if (!result) return next();
        send(res as unknown as ResponseLike, result);
      });
    },
  };
}
