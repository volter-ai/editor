/**
 * `@volter/editor-blender`'s server half (`package.json#vgai.serving`): the routes the Blender
 * in the tab needs from the session — the engine's WebAssembly build, the file spool its
 * transports move bytes through, the project's files as Blender reads them, and the two ways
 * bytes it produced reach the project (a shipped output, the session's `.blend`). They were
 * the kit's own routes; the kit now names no Blender, and reaches these only because the
 * product that composes this package declares its serving module. Writes go through the kit's
 * services (`@volter/editor-sdk/session/project-serving`), so they are attributed and recorded
 * like every other project write.
 */

import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createBrotliDecompress } from 'node:zlib';
import { projectOutputRootOf } from '@volter/editor-sdk/project/output-roots';
import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';
import type { ProjectServingServices } from '@volter/editor-sdk/session/project-serving';
import type { Plugin } from 'vite';
import {
  BLENDER_WALI_ARTIFACT,
  BLENDER_WASM_FILES,
  blenderGlueText,
  blenderWasmOnDisk,
  blenderWasmReadStream,
  blenderWasmStatus,
  runtimeIndex,
  substrateModule,
  writeRuntimeBlob,
} from './blender-wasm-artifact';

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const value of req) chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array));
  return Buffer.concat(chunks);
}

export function blenderRoutesPlugin(services: ProjectServingServices): Plugin {
  // ---- File bodies, which are NOT commands.
  //
  // A FILE IS A BODY, NOT A JSON FIELD. `blender-read-file` used to answer with the whole file
  // base64'd inside a control-plane message, so a mesh the twin had written came back as a
  // single JSON frame on the command socket (measured 2026-09-15: a 31 MB file became ~41.5 MB
  // of base64 in one message and killed the socket). So bytes move as bytes: the page POSTs an
  // octet-stream; the requester GETs it once and it is gone. The spool keeps PATH AUTHORITY
  // WITH THE REQUESTER: the page never names a destination on disk, only an id the caller
  // minted.
  const transferRoot = join(tmpdir(), 'vgai-blender-transfer');
  const transferPath = (id: string): string => join(transferRoot, id);
  // Every id is a uuid minted by a caller in a PREVIOUS process, so nothing live is here yet:
  // clearing once at startup bounds what a failed transfer can leave.
  void rm(transferRoot, { recursive: true, force: true });
  const transferId = (value: string | null): string | null =>
    value !== null && /^[0-9a-f-]{36}$/.test(value) ? value : null;
  const projectRoot = (): string | null => {
    const root = services.currentProjectRoot();
    return root === undefined || root === services.engineRoot ? null : root;
  };
  // The session's document is a project-relative `.blend` with no traversal and no dot
  // segment: the page names a document, never a place on disk.
  const isDocumentPath = (path: string): boolean => {
    if (!path.endsWith('.blend') || path.startsWith('/') || path.includes('\\')) return false;
    if (!isContainedRelativePath(path)) return false;
    return path.split('/').every((segment) => segment !== '' && !segment.startsWith('.'));
  };

  const routes: { method: 'GET' | 'POST'; match: RegExp; handle: Handler }[] = [
    // ---- The engine itself: headless Blender, compiled to WebAssembly. Its pthreads load
    // `blender_browser.js` from this same URL as a classic worker, so the patched glue has to
    // be what the URL answers with.
    {
      method: 'GET',
      match: /^\/__editor\/blender-wasm\/status$/,
      handle: async (_req, res) => {
        services.allowCrossOriginFrameEmbedding(res);
        json(res, await blenderWasmStatus());
      },
    },
    // The substrate skew's own doors beside the standalone bundle's: Blender's runtime tree as
    // one index and one blob (a request per file would be ~2,300 round trips), and the
    // substrate's browser ESM with its bare specifiers rewritten.
    {
      method: 'GET',
      match: /^\/__editor\/blender-wasm\/runtime\.idx$/,
      handle: async (_req, res) => {
        const status = await blenderWasmStatus();
        if (status.skew !== 'wali' || status.dir === null) {
          json(res, { error: 'This editor does not serve the substrate skew of Blender.' }, 404);
          return;
        }
        json(res, await runtimeIndex(status.dir));
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/blender-wasm\/runtime\.bin$/,
      handle: async (_req, res) => {
        const status = await blenderWasmStatus();
        if (status.skew !== 'wali' || status.dir === null) {
          json(res, { error: 'This editor does not serve the substrate skew of Blender.' }, 404);
          return;
        }
        res.setHeader('content-type', 'application/octet-stream');
        await writeRuntimeBlob(status.dir, (chunk) => void res.write(chunk));
        res.end();
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/blender-wasm\/wali\/([^/]+)\/([^/]+)$/,
      handle: async (_req, res, url) => {
        const [, segment = '', file = ''] = /^\/__editor\/blender-wasm\/wali\/([^/]+)\/([^/]+)$/.exec(url.pathname) ?? [];
        const served = await substrateModule(decodeURIComponent(segment), decodeURIComponent(file));
        if (!served) {
          json(
            res,
            {
              error:
                `This editor does not serve ${segment}/${file}. The substrate skew runs Blender through ` +
                '@volter/browser-wali and @volter/browser-runtime; a project that opts into it declares them.',
            },
            404,
          );
          return;
        }
        res.setHeader('content-type', 'text/javascript');
        res.end(served.text);
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/blender-wasm\/([^/]+)$/,
      handle: async (req, res, url) => {
        const file = decodeURIComponent(url.pathname.slice('/__editor/blender-wasm/'.length));
        // The frame's page is cross-origin-isolated and this session is not its origin, so every
        // byte of the engine has to say it may be embedded — the glue above all, which Blender's
        // pthreads load with `importScripts`.
        services.allowCrossOriginFrameEmbedding(res);
        const bundled = (BLENDER_WASM_FILES as readonly string[]).includes(file);
        if (!bundled && file !== BLENDER_WALI_ARTIFACT) {
          json(res, { error: `The Blender build has no ${file}.` }, 404);
          return;
        }
        const status = await blenderWasmStatus();
        if (!status.available) {
          json(
            res,
            { error: `The headless Blender WebAssembly build is not served by this editor: ${status.missing.join('; ')}` },
            404,
          );
          return;
        }
        if (file === 'blender_browser.js') {
          res.setHeader('content-type', 'text/javascript');
          res.end(await blenderGlueText(status.dir!));
          return;
        }
        const found = await blenderWasmOnDisk(status.dir!, file);
        if (!found) {
          json(res, { error: `${file} vanished from ${status.dir}.` }, 404);
          return;
        }
        // A VALIDATOR, SO THE COMPILED ENGINE IS CACHED. Chrome keeps the machine code it
        // compiled from an `instantiateStreaming` response only while that response sits in its
        // HTTP cache, and a response with no validator is never stored (measured: every boot
        // compiled all 86 MB again, 12-36 s at load ~35). `no-cache` still asks every time, and
        // this answers 304 while the file on disk is the same one.
        const info = await stat(found.path);
        // A pre-compressed file goes out as stored, declared as brotli, to a client that accepts
        // brotli; one that does not (a service worker in the tab asks with no Accept-Encoding)
        // gets it inflated here.
        const accepted = String(req.headers['accept-encoding'] ?? '').toLowerCase();
        const sendEncoded = found.encoding !== null && accepted.includes(found.encoding);
        const etag = `"${sendEncoded ? found.encoding : 'identity'}-${info.size}-${Math.floor(info.mtimeMs)}"`;
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('etag', etag);
        res.setHeader('vary', 'accept-encoding');
        if (req.headers['if-none-match'] === etag) {
          res.statusCode = 304;
          res.end();
          return;
        }
        res.setHeader('content-type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        if (sendEncoded) {
          res.setHeader('content-encoding', found.encoding!);
          res.setHeader('content-length', String(found.size));
          blenderWasmReadStream(found).pipe(res);
          return;
        }
        const stream = blenderWasmReadStream(found);
        // A stored file that does not inflate ends this response, not the server.
        const body = found.encoding ? stream.pipe(createBrotliDecompress()).on('error', () => res.destroy()) : stream;
        body.pipe(res);
      },
    },
    {
      method: 'POST',
      match: /^\/__editor\/blender-file$/,
      handle: async (req, res, url) => {
        const id = transferId(url.searchParams.get('id'));
        if (id === null) {
          json(res, { error: 'blender-file requires a uuid `id`.' }, 400);
          return;
        }
        const path = transferPath(id);
        await mkdir(dirname(path), { recursive: true });
        const body = await readBody(req);
        await writeFile(path, new Uint8Array(body));
        json(res, { bytes: body.byteLength });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/blender-file$/,
      handle: async (_req, res, url) => {
        const id = transferId(url.searchParams.get('id'));
        if (id === null) {
          json(res, { error: 'blender-file requires a uuid `id`.' }, 400);
          return;
        }
        const path = transferPath(id);
        const info = await stat(path).catch(() => null);
        if (info === null) {
          json(res, { error: 'No transfer is spooled under that id.' }, 404);
          return;
        }
        res.setHeader('content-type', 'application/octet-stream');
        res.setHeader('content-length', String(info.size));
        const stream = createReadStream(path);
        stream.pipe(res);
        stream.on('close', () => {
          void unlink(path).catch(() => {});
        });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/blender-project-index$/,
      handle: async (_req, res) => {
        const root = projectRoot();
        if (root === null) {
          json(res, { error: 'No project open.' }, 404);
          return;
        }
        json(res, { root, files: await services.projectFileIndex() });
      },
    },
    {
      method: 'GET',
      match: /^\/__editor\/blender-project-file$/,
      handle: async (_req, res, url) => {
        const relPath = url.searchParams.get('path') ?? '';
        const scratchDocument =
          isContainedRelativePath(relPath) && relPath.startsWith('.vgai/tmp/') && relPath.endsWith('.blend');
        if (!services.isProjectOwnedPath(relPath) && !scratchDocument) {
          json(res, { error: 'Not a project-owned path.' }, 400);
          return;
        }
        const root = projectRoot();
        if (root === null) {
          json(res, { error: 'No project open.' }, 404);
          return;
        }
        const absolute = join(root, relPath);
        if (!(await services.isCanonicalPathInside(root, absolute))) {
          json(res, { error: 'That path leaves the project root.' }, 403);
          return;
        }
        try {
          const bytes = await readFile(absolute);
          res.setHeader('content-type', 'application/octet-stream');
          res.end(bytes);
        } catch {
          json(res, { error: 'Not found.' }, 404);
        }
      },
    },
    // ---- A SHIPPED OUTPUT: bytes Blender produced for the game to ship (`public/`), recorded
    // with the session and revision that re-derive them.
    {
      method: 'POST',
      match: /^\/__editor\/blender-output$/,
      handle: async (req, res, url) => {
        const path = url.searchParams.get('path') ?? '';
        const session = url.searchParams.get('session') ?? '';
        const source = url.searchParams.get('source') ?? '';
        const revision = Number(url.searchParams.get('revision'));
        const callId = url.searchParams.get('callId') ?? '';
        if (!isContainedRelativePath(path) || projectOutputRootOf(path) !== 'public') {
          json(
            res,
            {
              error:
                'A shipped output is a project-relative path under public/ with no traversal ' +
                `(public/models/model.glb); got ${JSON.stringify(path)}.`,
            },
            400,
          );
          return;
        }
        if (session === '' || !Number.isInteger(revision) || revision < 0) {
          json(
            res,
            {
              error:
                'A shipped output must name the session that produced it — `session` and a ' +
                'non-negative integer `revision` — so the record can say what re-derives the file.',
            },
            400,
          );
          return;
        }
        if (source === '' || source.length > 64) {
          json(res, { error: '`source` names the transport that wrote the file, in 1-64 characters.' }, 400);
          return;
        }
        const inputs = url.searchParams.getAll('inputs');
        const badInput = inputs.find((value) => !isContainedRelativePath(value));
        if (badInput !== undefined) {
          json(
            res,
            {
              error:
                'Each `inputs` value is a project-relative path with no traversal (the source file ' +
                `these bytes were produced from); got ${JSON.stringify(badInput)}.`,
            },
            400,
          );
          return;
        }
        if (projectRoot() === null) {
          json(res, { error: 'No project open, so there is nowhere to record the output.' }, 404);
          return;
        }
        const body = await readBody(req);
        if (body.byteLength === 0) {
          json(res, { error: 'The output body was empty; nothing was written.' }, 400);
          return;
        }
        try {
          const written = await services.writeProjectOutput({
            path,
            content: body,
            source,
            session: {
              id: session,
              port: req.socket.localPort ?? 0,
              revision,
              ...(callId === '' ? {} : { callId }),
            },
            ...(inputs.length > 0 ? { inputs } : {}),
          });
          json(res, { ok: true, bytes: body.byteLength, provenanceOperationId: written.provenanceOperationId });
        } catch (error) {
          json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
        }
      },
    },
    // ---- The session's DOCUMENT, written back OUT into the project. A Blender session holds one
    // `.blend`; its `save_as_mainfile` writes it into the engine's filesystem, and this is how
    // those bytes reach the disk the project lives on. Unlike the spool, the destination shape is
    // pinned BY THIS SERVER, and the write is the project's one attributed, conflict-checked
    // transaction: a `.blend` is the project's file like any other.
    {
      method: 'POST',
      match: /^\/__editor\/blender-document$/,
      handle: async (req, res, url) => {
        const path = url.searchParams.get('path') ?? '';
        if (!isDocumentPath(path)) {
          json(
            res,
            {
              error:
                'A Blender document is a project-relative .blend path with no traversal ' +
                `(models/model.blend); got ${JSON.stringify(path)}.`,
            },
            400,
          );
          return;
        }
        if (projectRoot() === null) {
          json(res, { error: 'No project open, so there is nowhere to save the document.' }, 404);
          return;
        }
        const body = await readBody(req);
        // A zero-byte .blend is not a document; writing one would replace a good file with an
        // empty one at exactly the moment something went wrong.
        if (body.byteLength === 0) {
          json(res, { error: 'The Blender document body was empty; nothing was written.' }, 400);
          return;
        }
        try {
          const revision = await services.commitProjectMutation(req, [{ path, content: body }]);
          json(res, { ok: true, bytes: body.byteLength, revision: revision?.revision ?? null });
        } catch (error) {
          services.answerProjectMutationError(res, error);
        }
      },
    },
  ];

  return {
    name: 'vgai-blender-routes',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://local');
        if (!url.pathname.startsWith('/__editor/blender-')) return next();
        const route = routes.find((candidate) => candidate.method === req.method && candidate.match.test(url.pathname));
        if (!route) return next();
        route.handle(req, res, url).catch((error: unknown) => {
          if (!res.headersSent) json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
          else res.destroy();
        });
      });
    },
  };
}
