/**
 * THE ONE ORIGIN in front of two servers: the Code-OSS workbench and this
 * session. It listens IN THE SESSION PROCESS — no spawn, no second program —
 * exactly as the loopback Colyseus server does.
 *
 *   /$product-segment/*, /static, /vscode-remote, …   the workbench (the REH)
 *   everything else                                    this session
 *
 * WHY A PROXY AND NOT TWO ORIGINS (measured 2026-09-19 against the REH). The
 * REH stamps its own CSP on the workbench page
 * (`createWorkbenchContentSecurityPolicy`, src/vs/server/node/webClientServer.ts):
 *
 *   script-src 'self' 'unsafe-eval' blob: 'nonce-…' <sha> http://<the REH's own authority>
 *   connect-src 'self' ws: wss: https:
 *
 * The ONLY http origin on either list is the server's own. The editor's own
 * entry module and every project module are imported as module scripts from
 * this session, and every `/__editor/*` call is a fetch to it — so a session on
 * a second port is refused by `script-src` before CORS is ever consulted, and
 * its fetches by `connect-src` (which carries no `http:` at all). Relaxing that
 * means editing a core service; the proxy costs none.
 *
 * CROSS-ORIGIN ISOLATION. Every response carries COOP `same-origin` and COEP
 * `credentialless`, because the Blender build is `-sPROXY_TO_PTHREAD` and needs
 * `SharedArrayBuffer`. The REH has no cross-origin-isolation flag or header
 * hook of its own — `--enable-coi` is an ELECTRON-MAIN argument — so these
 * headers are this proxy's. `credentialless` rather than `require-corp` so the
 * workbench's own cross-origin loads keep working, the same choice `dev.ts`
 * makes.
 *
 * THE WEBVIEW'S SECOND ORIGIN. VS Code loads every webview from
 * `webviewExternalEndpoint`, which defaults to `https://{{uuid}}.vscode-cdn.net/…`
 * — a host that does not exist for this fork and that a cross-origin-isolated
 * page could not embed anyway. `IWorkbenchConstructionOptions.webviewEndpoint`
 * is the supported door and the REH leaves it unset, so this rewrites the page
 * config to `http://{{uuid}}.localhost:<port>`. It has to be a SUBDOMAIN and
 * not this origin itself: `pre/index.html` refuses to start unless
 * `location.hostname` IS the hash of `{parentOrigin, salt}` or begins with it,
 * and `*.localhost` is the one wildcard host a browser resolves to loopback
 * with no DNS. Two consequences handled here: the webview is genuinely
 * cross-origin, so its responses need CORP `cross-origin` (without it the frame
 * dies as `corp-not-same-origin-after-defaulted-to-same-origin-by-coep`, which
 * Chrome renders as "refused to connect" and which cost an hour); and the REH's
 * own `frame-src 'self' https://*.vscode-cdn.net` is widened on the way through.
 *
 * COMPRESSION IS THIS PROXY'S JOB, and it is the reason the frame's page weight
 * is not the workbench's disk size. U3 measured `transferSize ===
 * decodedBodySize` on every entry of a 41.75 MB page: the REH writes no
 * `content-encoding` at all, and neither did this proxy. It negotiates
 * `accept-encoding` now — brotli, then gzip — over text, JavaScript, CSS, JSON
 * and wasm only; everything else is byte-for-byte.
 */

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import { basename } from 'node:path';
import type { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, createGzip, constants as zlibConstants } from 'node:zlib';
import { JS_PROFILING_POLICY_HEADER, JS_PROFILING_POLICY_VALUE } from './js-profiling-policy';

export interface FrameProxyOptions {
  /** The one port a person opens: this proxy's. */
  readonly port: number;
  /** The Code-OSS workbench (REH) behind it. */
  readonly upstreamPort: number;
  /** This session's own port. */
  readonly sessionPort: number;
  /** The project the workbench opens; its folder name is the `?project=` id. */
  readonly projectRoot: string;
  /**
   * Which way round the PRODUCT paints, from its own declaration
   * (`package.json#vgai.product.colorTheme`, `@volter/editor-sdk/session/
   * product-locator`), or `null` when this session could not resolve a product
   * — in which case the page keeps the workbench's own web default and the
   * `served-modules` door is what says why there is no product.
   */
  readonly colorTheme: 'dark' | 'light' | null;
  readonly log: (line: string) => void;
}

export interface FrameProxy {
  /** The url to open: this origin, on this project. */
  readonly url: string;
  close(): Promise<void>;
}

/**
 * The workbench's own paths. `<product segment>` (`/oss-dev` out of a source
 * checkout, the quality segment out of a build — `getServerProductSegment`) is
 * DISCOVERED at boot rather than spelled here, because the page states it.
 */
const VSCODE_PATH_BASE =
  '^\\/$|^\\/(static|favicon|manifest\\.json|code-192|code-512|callback|oauth|out|extensions|builtin|remote|vscode-remote|_static|web-extension|version|delay-shutdown)';

/** What is worth compressing. Everything else goes through byte for byte. */
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:javascript|json|wasm|manifest\+json)|image\/svg\+xml)/;

/** `&quot;`-encoded HTML attribute value ↔ JSON, the way webClientServer writes it. */
const decodeAttr = (value: string): string =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
const encodeAttr = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/**
 * Which encoding the browser asked for, in this proxy's order of preference.
 * `null` means "send it as it is" — no `accept-encoding`, or none we write.
 */
function negotiateEncoding(header: string | string[] | undefined): 'br' | 'gzip' | null {
  const accepted = (Array.isArray(header) ? header.join(',') : (header ?? '')).toLowerCase();
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return null;
}

/**
 * Quality 5 rather than brotli's default 11. The default spends seconds on a
 * multi-megabyte workbench chunk and this proxy compresses on the request path,
 * with the person waiting; 5 is the knee where the ratio is nearly the same and
 * the CPU is not.
 */
function compressor(encoding: 'br' | 'gzip'): Transform {
  return encoding === 'br'
    ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
    : createGzip({ level: 6 });
}

export async function startFrameProxy(options: FrameProxyOptions): Promise<FrameProxy> {
  const { port, upstreamPort, sessionPort, projectRoot, colorTheme, log } = options;
  const upstream = { host: '127.0.0.1', port: upstreamPort };
  const session = { host: '127.0.0.1', port: sessionPort };
  const upstreamOrigin = `http://${upstream.host}:${upstream.port}`;
  const selfOrigin = `http://127.0.0.1:${port}`;
  const webviewOriginTemplate = `http://{{uuid}}.localhost:${port}`;
  const webviewOriginPattern = `http://*.localhost:${port}`;
  const projectId = basename(projectRoot);

  const isolation: Record<string, string> = {
    // The Code-OSS HTML comes from the upstream, not Express. Keep the
    // editor's profiling permission on the actual top-level document too.
    [JS_PROFILING_POLICY_HEADER]: JS_PROFILING_POLICY_VALUE,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };

  let vscodePath = new RegExp(VSCODE_PATH_BASE);

  /**
   * THE DOCUMENT'S OWN COLOUR, before it has any styles at all.
   *
   * `initialColorTheme` below fixes the WORKBENCH's first paint, and that is not the page's
   * first paint: measured 2026-09-21 on the live release, `html` and `body` compute
   * `rgba(0, 0, 0, 0)` — upstream's `workbench.css` styles `.monaco-workbench` and nothing
   * above it — so from the document's first frame until `Workbench.renderWorkbench` builds that
   * element, the canvas is the BROWSER's default, which is white. One frame of it survived F1's
   * first reading (frame 0 at 0.0 s white, frame 1 at 0.5 s already the product's splash).
   *
   * `color-scheme` is the platform's own answer to exactly that question, and it is why this is
   * a meta tag and not a background rule: it hands the browser the product's `dark`/`light`
   * declaration UNCHANGED and lets it paint its own dark canvas, so nothing here becomes a
   * second author of a palette value. The workbench sets `color-scheme` itself once its theme
   * loads; this only fills the window before that.
   */
  const colorSchemeMeta = (html: string): string =>
    colorTheme === null
      ? html
      : html.replace('<head>', `<head>\n\t\t<meta name="color-scheme" content="${colorTheme}">`);

  /** Rewrite the workbench page's own configuration for THIS origin.
   *
   *  - `remoteAuthority` needs NOTHING here, and that is worth stating: the REH
   *    derives it from the request's HOST header (measured — a direct fetch to
   *    the REH reports its own authority, the same fetch through this proxy
   *    reports this one), so forwarding the original Host is already what makes
   *    the management websocket, the `vscode-remote://` file system, every
   *    `vscode-remote-resource` url AND the page's own CSP address this origin.
   *  - `webviewEndpoint` is set (see the header).
   *  - `initialColorTheme` is set (see below).
   *  - `workspaceStorageUrl` is set (see below).
   *  - `configurationDefaults` turns the editor's local chat agent off (see below). */
  const patchWorkbenchConfig = (html: string): string => {
    const webBaseUrl =
      html.match(/id="vscode-workbench-web-base-url" data-settings="([^"]*)"/)?.[1] ?? '/static';
    return html.replace(
      /(id="vscode-workbench-web-configuration" data-settings=")([^"]*)(")/,
      (_all, head: string, value: string, tail: string) => {
        const config = JSON.parse(decodeAttr(value)) as Record<string, unknown>;
        config['webviewEndpoint'] =
          `${webviewOriginTemplate}${decodeAttr(webBaseUrl)}/out/vs/workbench/contrib/webview/browser/pre/`;
        // THE FIRST PAINT IS THE PRODUCT'S, NOT THE WEB DEFAULT'S. Measured
        // 2026-09-21 against both releases: with nothing here the page's first
        // frame is LIGHT — `workbenchThemeService` falls back to
        // `isWeb ? ColorScheme.LIGHT : ColorScheme.DARK` when it has no stored
        // theme — so the product's opening cover, every colour of which is a
        // `--vscode-*` variable by design, was WHITE from the first frame until
        // the real theme loaded seconds later, and then flipped.
        //
        // `IWorkbenchConstructionOptions.initialColorTheme` is the supported
        // door and the REH leaves it unset, the same shape as `webviewEndpoint`
        // above. It has to be HERE and not in a setting or an extension: the
        // theme service reads it in its constructor, before any extension is
        // registered, which is exactly the window the cover lives in. The
        // themeType strings ARE `ColorScheme`'s values (`dark`, `light`).
        //
        // The colour comes from the PRODUCT's own declaration and nothing else
        // (`package.json#vgai.product.colorTheme`), and it is a FALLBACK in the
        // workbench's own order: a person who has already picked a theme has it
        // in storage, and `ColorThemeData.fromStorageData` is preferred over
        // this on every open after the first.
        if (colorTheme !== null) config['initialColorTheme'] = { themeType: colorTheme };
        // THE WORKSPACE'S STATE LIVES IN THE PROJECT'S FOLDER. The web workbench keeps its
        // workspace-scoped storage (its layout, open editors and views, and the editor's) in
        // IndexedDB keyed by the workspace id, which lost state to a folder rename, another browser
        // and another checkout (measured 2026-09-04). The fork's
        // `IWorkbenchConstructionOptions.workspaceStorageUrl` moves that scope to this server,
        // which keeps it in `.vgai/workbench-storage.json` (`routes/project-state.ts`). A release
        // cut before the option reads nothing from it and keeps IndexedDB.
        config['workspaceStorageUrl'] = '/__editor/workbench-storage';
        // THE CHAT OPENS ON SUPERCODE, NOT ON "LOCAL". Local is Code-OSS's own agent
        // loop, and its request goes to the core setup agent, which waits for a
        // language model that is default for Chat (`chatSetupProviders.ts`
        // `whenLanguageModelReady`). This release ships none (the overlay removes
        // Copilot and names the Supercode extension the chat agent), so a Local turn
        // said "Getting chat ready" until it timed out. With the editor's local agent
        // off, `getComputedDefaultSessionType` (`chat/common/constants.ts`) takes the
        // first visible non-local session type, which is the extension's `supercode`.
        // A default, not a policy: a person who adds a model provider can turn it on.
        config['configurationDefaults'] = {
          ...(config['configurationDefaults'] as Record<string, unknown> | undefined),
          'chat.editor.localAgent.enabled': false,
        };
        return head + encodeAttr(JSON.stringify(config)) + tail;
      },
    );
  };

  const sendText = (res: ServerResponse, status: number, body: string, type: string): void => {
    res.writeHead(status, { ...isolation, 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  /** An unknown `?project=` says so by name rather than opening an empty workbench. */
  const refuseProject = (res: ServerResponse, id: string): void => {
    sendText(
      res,
      404,
      `<!doctype html><meta charset="utf-8"><title>no such project</title>` +
        `<body style="font:14px system-ui;padding:2rem"><h1>No project "${encodeAttr(id)}" is open here.</h1>` +
        `<p>This workbench is the session for <code>${encodeAttr(projectRoot)}</code>, whose id is ` +
        `<code>${encodeAttr(projectId)}</code>.</p>`,
      'text/html; charset=utf-8',
    );
  };

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', selfOrigin);
    const pathname = url.pathname;
    // THE ONE HOSTED BOOT PARAM, ONTO THE WORKBENCH'S OWN. `?project=<id>` is
    // what a link to the vgai editor carries; the workbench's own boot contract
    // is `?folder=<path>` (`WorkspaceProvider.create`, which reads a bare path
    // against `remoteAuthority`). This is a REDIRECT and not an injected
    // `folderUri`, and the reason was measured (2026-09-19): under this shape
    // the workbench page is ALSO the vgai editor's page, and the editor's boot
    // refuses `?project=` on a session-backed surface by name — "project
    // identity does NOT live in the URL on a local editor"
    // (`assertNoRemovedBootParams`, packages/editor/src/boot-routing.ts). The
    // redirect hands the page a url both halves accept.
    if (pathname === '/') {
      const id = url.searchParams.get('project');
      if (id && !url.searchParams.has('folder') && !url.searchParams.has('workspace')) {
        if (id !== projectId) {
          refuseProject(res, id);
          return;
        }
        const next = new URL(url);
        next.searchParams.delete('project');
        next.searchParams.set('folder', projectRoot);
        res.writeHead(302, {
          ...isolation,
          location: `${next.pathname}${next.search}`,
          'cache-control': 'no-store',
        });
        res.end();
        return;
      }
    }

    const target = vscodePath.test(pathname) ? upstream : session;
    const encoding = negotiateEncoding(req.headers['accept-encoding']);
    const forward = httpRequest(
      { ...target, method: req.method, path: req.url, headers: req.headers },
      (answer) => {
        const headers: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(answer.headers)) {
          if (value !== undefined) headers[key] = value;
        }
        delete headers['cross-origin-opener-policy'];
        delete headers['cross-origin-embedder-policy'];
        delete headers['cross-origin-resource-policy'];
        // Hop-by-hop headers describe the upstream's connection, not this
        // one: this response is framed by this server. Copied, the upstream's
        // `transfer-encoding: chunked` sat beside the `content-length` the
        // buffered branch sets, which a client must refuse; a browser that
        // asks for compression never took that branch, a client that asks
        // for none (a service worker's) always did.
        for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']) delete headers[name];
        // The webview's second origin, onto the REH's own `frame-src`.
        const csp = headers['content-security-policy'];
        if (typeof csp === 'string' && csp.includes('frame-src')) {
          // GLTFLoader fetches local blob textures; img-src alone cannot
          // authorize that fetch. Media previews use local blobs as well.
          headers['content-security-policy'] = csp
            .replace(/frame-src([^;]*)/, `frame-src$1 ${webviewOriginPattern}`)
            .replace(/connect-src([^;]*)/, 'connect-src$1 blob:')
            .replace(/media-src([^;]*)/, 'media-src$1 blob:');
        }
        const type = String(headers['content-type'] ?? '');
        const alreadyEncoded = headers['content-encoding'] !== undefined;
        // The workbench HTML and its config spell the upstream's OWN origin
        // into absolute script and endpoint URLs; through this origin those are
        // cross-origin and CORS refuses them. Text bodies are re-spelled here,
        // which needs the whole body — so this branch buffers and the streaming
        // one below does not.
        if (/text\/html|javascript|json/.test(type) && !alreadyEncoded) {
          const chunks: Buffer[] = [];
          answer.on('data', (chunk: Buffer) => chunks.push(chunk));
          answer.on('end', () => {
            let body = Buffer.concat(chunks)
              .toString('utf8')
              .replaceAll(upstreamOrigin, selfOrigin);
            if (pathname === '/' && target === upstream && /text\/html/.test(type)) {
              body = colorSchemeMeta(patchWorkbenchConfig(body));
            }
            delete headers['content-length'];
            const raw = Buffer.from(body, 'utf8');
            if (encoding === null) {
              res.writeHead(answer.statusCode ?? 502, {
                ...headers,
                ...isolation,
                'content-length': raw.byteLength,
              });
              res.end(raw);
              return;
            }
            res.writeHead(answer.statusCode ?? 502, {
              ...headers,
              ...isolation,
              'content-encoding': encoding,
              vary: 'accept-encoding',
            });
            const stream = compressor(encoding);
            stream.pipe(res);
            stream.end(raw);
          });
          return;
        }
        if (encoding !== null && !alreadyEncoded && COMPRESSIBLE.test(type)) {
          delete headers['content-length'];
          res.writeHead(answer.statusCode ?? 502, {
            ...headers,
            ...isolation,
            'content-encoding': encoding,
            vary: 'accept-encoding',
          });
          void pipeline(answer, compressor(encoding), res).catch(() => res.destroy());
          return;
        }
        res.writeHead(answer.statusCode ?? 502, { ...headers, ...isolation });
        answer.pipe(res);
      },
    );
    forward.on('error', (error) => {
      if (!res.headersSent) {
        sendText(
          res,
          502,
          `upstream ${target.port}: ${error.message}`,
          'text/plain; charset=utf-8',
        );
      } else res.destroy();
    });
    // A browser that goes away takes its upstream request with it — otherwise a
    // dead tab's event stream stays open, this session keeps that tab blessed,
    // and EVERY later tab lands on `/__editor/tab-yielded` (measured
    // 2026-09-19 in the session journal).
    res.on('close', () => forward.destroy());
    req.pipe(forward);
  };

  const handleUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
    const target = vscodePath.test(new URL(req.url ?? '/', selfOrigin).pathname)
      ? upstream
      : session;
    const proxied = netConnect(target.port, target.host, () => {
      proxied.write(
        `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
          Object.entries(req.headers)
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
            .join('\r\n') +
          '\r\n\r\n',
      );
      if (head.length) proxied.write(head);
      socket.pipe(proxied).pipe(socket);
    });
    proxied.on('error', () => socket.destroy());
    socket.on('error', () => proxied.destroy());
  };

  /**
   * Wait for the upstream to report its shape before accepting requests. The REH serves its static
   * assets under a PRODUCT SEGMENT (`/oss-dev/static` out of a source checkout,
   * `/<quality>/static` out of a build), and this cannot route without knowing
   * it. The page itself states it in `vscode-workbench-web-base-url`, so it is
   * read rather than spelled.
   */
  const discoverUpstream = (): Promise<string | null> =>
    new Promise((done) => {
      const probe = httpRequest({ ...upstream, path: '/' }, (answer) => {
        const chunks: Buffer[] = [];
        answer.on('data', (chunk: Buffer) => chunks.push(chunk));
        answer.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8');
          const base = html.match(
            /id="vscode-workbench-web-base-url" data-settings="([^"]*)"/,
          )?.[1];
          done(answer.statusCode === 200 && base ? decodeAttr(base).replace(/\/static\/?$/, '') : null);
        });
      });
      probe.on('error', () => done(null));
      probe.setTimeout(3_000, () => {
        probe.destroy();
        done(null);
      });
      probe.end();
    });

  // A listening socket is not proof that Code-OSS can serve its HTML yet.
  // Never expose a half-configured proxy: unknown prefixes route native JS to
  // the session server and produce a blank workbench with script 404s.
  const discoveryDeadline = Date.now() + 30_000;
  let segment: string | null = null;
  do {
    segment = await discoverUpstream();
    if (segment !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < discoveryDeadline);
  if (segment === null) throw new Error(
    `Code-OSS on port ${upstream.port} did not report its workbench asset base within 30s; refusing to start an incorrectly routed proxy.`,
  );
  if (segment) {
    vscodePath = new RegExp(
      `${VSCODE_PATH_BASE}|^${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\/|$)`,
    );
    log(`frame: workbench product segment ${segment}`);
  }

  // ONE handler, TWO loopback listeners — 127.0.0.1 and ::1. The webview's
  // origin is a `*.localhost` subdomain (see the header), and macOS answers
  // `<anything>.localhost` with the IPv6 `::1` as well as 127.0.0.1
  // (`dscacheutil -q host -a name x.localhost`); a browser that picks the IPv6
  // address finds nothing listening and the webview iframe fails as
  // `chrome-error://chromewebdata` with no message at all — measured
  // 2026-09-19 against a proxy bound to 127.0.0.1 alone.
  const servers: Server[] = [];
  await new Promise<void>((ready, failed) => {
    let settled = false;
    for (const host of ['127.0.0.1', '::1']) {
      const one = createServer(handleRequest);
      one.on('upgrade', handleUpgrade);
      one.on('error', (error) => {
        if (host === '::1') {
          log(
            `frame: no IPv6 loopback listener (${error.message}); webviews need one if the browser resolves *.localhost to ::1`,
          );
          return;
        }
        if (!settled) {
          settled = true;
          failed(error);
        }
      });
      servers.push(one);
      one.listen(port, host, () => {
        if (!settled) {
          settled = true;
          ready();
        }
      });
    }
  });

  return {
    url: `${selfOrigin}/?project=${encodeURIComponent(projectId)}`,
    close: async () => {
      await Promise.all(
        servers.map(
          (one) =>
            new Promise<void>((done) => {
              one.close(() => done());
              one.closeAllConnections?.();
            }),
        ),
      );
    },
  };
}
