/**
 * `@volter/editor-blender`'s server half (`package.json#volter.serving`): the routes the Blender
 * in the tab needs from the session — the engine's WebAssembly build, the file spool its
 * transports move bytes through, the project's files as Blender reads them, and the two ways
 * bytes it produced reach the project (a shipped output, the session's `.blend`). They were
 * the kit's own routes; the kit now names no Blender, and reaches these only because the
 * product that composes this package declares its serving module. Writes go through the kit's
 * services (`@volter/editor-sdk/session/project-serving`), so they are attributed and recorded
 * like every other project write.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
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
  runtimeTag,
  runtimeBlobBrotli,
  brotliArtifact,
  substrateModule,
  writeRuntimeBlob,
} from './blender-wasm-artifact';

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/** The largest chunk a document save sends (`document-chunks.mts`'s cut bound). */
const DOCUMENT_CHUNK_MAX = 4 * 1024 * 1024;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
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
  const transferRoot = join(tmpdir(), 'volter-blender-transfer');
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

  // The document's chunks: those the page sent for the save in flight, and where each chunk of
  // the last committed save lies in the file, valid while the file's size and mtime still match.
  // Keep chunks in the project's persistent filesystem, not /tmp's browser
  // memory overlay. This plugin owns its random staging directory only.
  const documentStagingId = randomUUID();
  const heldChunks = new Map<string, Map<string, { file: string; length: number }>>();
  const documentChunkRoot = (root: string, path: string): string =>
    join(root, '.volter', 'tmp', `blender-document-${documentStagingId}`, sha256(Buffer.from(path)));
  const committedChunks = new Map<
    string,
    { size: number; mtimeMs: number; byHash: Map<string, { offset: number; length: number }> }
  >();

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
      handle: async (req, res) => {
        const status = await blenderWasmStatus();
        if (status.skew !== 'wali' || status.dir === null) {
          json(res, { error: 'This editor does not serve the substrate skew of Blender.' }, 404);
          return;
        }
        // A validator, as the engine's own files have, and brotli once it is
        // made, as the standalone skew's payload goes out: small enough for
        // the HTTP cache, so a warm boot is a 304 (`runtimeBlobBrotli`).
        const index = await runtimeIndex(status.dir);
        const accepted = String(req.headers['accept-encoding'] ?? '').toLowerCase().includes('br');
        const compressed = accepted ? await runtimeBlobBrotli(status.dir, index) : null;
        const tag = runtimeTag(index).replace(/"$/, compressed ? '-br"' : '-identity"');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('etag', tag);
        res.setHeader('vary', 'accept-encoding');
        if (req.headers['if-none-match'] === tag) {
          res.statusCode = 304;
          res.end();
          return;
        }
        res.setHeader('content-type', 'application/octet-stream');
        if (compressed) {
          res.setHeader('content-encoding', 'br');
          res.setHeader('content-length', String((await stat(compressed)).size));
          createReadStream(compressed).pipe(res);
          return;
        }
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
        const onDisk = await blenderWasmOnDisk(status.dir!, file);
        if (!onDisk) {
          json(res, { error: `${file} vanished from ${status.dir}.` }, 404);
          return;
        }
        // The substrate skew's module is served as brotli too, made once (`brotliArtifact`).
        const found = file === BLENDER_WALI_ARTIFACT ? await brotliArtifact(onDisk) : onDisk;
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
          isContainedRelativePath(relPath) && relPath.startsWith('.volter/tmp/') && relPath.endsWith('.blend');
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
        // STREAMED, never read whole: on a tab-served project this server runs in the page, and a
        // 307 MB document read into one buffer and ended as one body was copied along the page's
        // own response path. MEASURED 2026-09-29 on the hosted Stoneguard open: the page's
        // isolate held 1,009 MB of ArrayBuffers while the document crossed, against 19 MB before.
        let size: number;
        try {
          const info = await stat(absolute);
          if (!info.isFile()) throw new Error('not a file');
          size = info.size;
        } catch {
          json(res, { error: 'Not found.' }, 404);
          return;
        }
        res.setHeader('content-type', 'application/octet-stream');
        res.setHeader('content-length', String(size));
        await new Promise<void>((resolve) => {
          const stream = createReadStream(absolute);
          stream.once('error', () => {
            res.destroy();
            resolve();
          });
          res.once('close', () => {
            stream.destroy();
            resolve();
          });
          stream.pipe(res);
        });
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
    //
    // IT ARRIVES AS A DELTA. The page cuts each save into content-defined chunks
    // (`blender-engine/browser/document-chunks.mts`) and posts their manifest; this answers with
    // the chunks it does not already hold, the page posts those, and the manifest again commits.
    // MEASURED 2026-09-29, native Blender 5.2 on the Stoneguard bridge: a 497 MB save, one object
    // moved, changed 1 of 475 one-MiB chunks, so an edit carries about a megabyte instead of the
    // whole file. Chunks this server reuses come from the document as it lies on disk, and each
    // is hashed again against the manifest before the commit: a file changed underneath (another
    // writer, a restore) is not drift but a missing chunk, re-sent.
    {
      method: 'POST',
      match: /^\/__editor\/blender-document-chunk$/,
      handle: async (req, res, url) => {
        const path = url.searchParams.get('path') ?? '';
        const hash = url.searchParams.get('hash') ?? '';
        if (!isDocumentPath(path) || !/^[0-9a-f]{64}$/u.test(hash)) {
          json(res, { error: 'A document chunk names its .blend `path` and its SHA-256 `hash` (64 hex digits).' }, 400);
          return;
        }
        const root = projectRoot();
        if (root === null) {
          json(res, { error: 'No project open, so there is nowhere to hold the document chunk.' }, 404);
          return;
        }
        const body = await readBody(req);
        if (body.byteLength === 0 || body.byteLength > DOCUMENT_CHUNK_MAX) {
          json(res, { error: `A document chunk is 1 to ${DOCUMENT_CHUNK_MAX} bytes; got ${body.byteLength}.` }, 400);
          return;
        }
        if (sha256(body) !== hash) {
          json(res, { error: `The chunk's bytes do not hash to ${hash}; it was not kept.` }, 400);
          return;
        }
        const key = join(root, path);
        let held = heldChunks.get(key);
        if (!held) heldChunks.set(key, (held = new Map()));
        const directory = documentChunkRoot(root, path);
        await mkdir(directory, { recursive: true });
        const file = join(directory, hash);
        await writeFile(file, body);
        held.set(hash, { file, length: body.byteLength });
        json(res, { ok: true, bytes: body.byteLength });
      },
    },
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
        const root = projectRoot();
        if (root === null) {
          json(res, { error: 'No project open, so there is nowhere to save the document.' }, 404);
          return;
        }
        // The editor server's `express.json` has already read a JSON body when it runs first
        // (MEASURED: the stream arrived empty); read the stream only when it has not.
        const parsed = (req as IncomingMessage & { body?: unknown }).body;
        let manifest: unknown = parsed !== null && typeof parsed === 'object' && !Buffer.isBuffer(parsed) ? parsed : null;
        if (manifest === null) {
          try {
            manifest = JSON.parse((await readBody(req)).toString('utf8'));
          } catch {
            manifest = null;
          }
        }
        const chunks = (manifest as { chunks?: unknown } | null)?.chunks;
        if (
          !Array.isArray(chunks) ||
          chunks.length === 0 ||
          !chunks.every(
            (chunk) =>
              Array.isArray(chunk) &&
              typeof chunk[0] === 'string' &&
              /^[0-9a-f]{64}$/u.test(chunk[0]) &&
              Number.isInteger(chunk[1]) &&
              chunk[1] > 0 &&
              chunk[1] <= DOCUMENT_CHUNK_MAX,
          )
        ) {
          // A zero-chunk manifest is a zero-byte .blend, which is not a document; writing one
          // would replace a good file with an empty one at exactly the moment something went wrong.
          json(res, { error: 'A document manifest is `{ chunks: [[sha256, length], ...] }`, at least one chunk.' }, 400);
          return;
        }
        const listed = chunks as [string, number][];
        const ms: Record<string, number> = {};
        let mark = performance.now();
        const lap = (phase: string) => {
          const now = performance.now();
          ms[phase] = Math.round(now - mark);
          mark = now;
        };
        const key = join(root, path);
        const held = heldChunks.get(key) ?? new Map<string, { file: string; length: number }>();
        const wanted = new Set(listed.map(([hash]) => hash));
        for (const [hash, chunk] of held) {
          if (wanted.has(hash)) continue;
          await unlink(chunk.file);
          held.delete(hash);
        }
        // What the document on disk already holds, by hash, re-verified below.
        const known = committedChunks.get(key);
        let onDisk: Awaited<ReturnType<typeof open>> | null = null;
        if (known && listed.some(([hash]) => !held.has(hash) && known.byHash.has(hash))) {
          try {
            const file = join(root, path);
            const now = await stat(file);
            if (now.size === known.size && now.mtimeMs === known.mtimeMs) onDisk = await open(file, 'r');
          } catch {
            onDisk = null;
          }
          lap('read');
        }
        const readChunk = async (hash: string, length: number): Promise<Buffer | null> => {
          const fresh = held.get(hash);
          if (fresh?.length === length) {
            const bytes = await readFile(fresh.file);
            return bytes.byteLength === length && sha256(bytes) === hash ? bytes : null;
          }
          const at = known?.byHash.get(hash);
          if (!onDisk || !at || at.length !== length) return null;
          const bytes = Buffer.allocUnsafe(length);
          let offset = 0;
          while (offset < length) {
            const read = await onDisk.read(bytes, offset, length - offset, at.offset + offset);
            if (!read.bytesRead) return null;
            offset += read.bytesRead;
          }
          return sha256(bytes) === hash ? bytes : null;
        };
        const missing = new Set<string>();
        try {
          for (const [hash, length] of listed) {
            if (!(await readChunk(hash, length))) missing.add(hash);
          }
          lap('verify');
          if (missing.size > 0) {
            json(res, { ok: false, missing: [...missing], ms });
            return;
          }
          const bytes = listed.reduce((sum, [, length]) => sum + length, 0);
          if (!Number.isSafeInteger(bytes)) {
            json(res, { error: 'Document manifest size is too large.' }, 400);
            return;
          }
          // The kit consumes this stream inside its existing mutation lock,
          // writing a hidden sibling before its atomic rename. Recheck every
          // chunk at consumption; a changed/deleted chunk aborts that sibling.
          async function* content(): AsyncGenerator<Uint8Array> {
            for (const [hash, length] of listed) {
              const chunk = await readChunk(hash, length);
              if (!chunk) throw new Error(`Document chunk ${hash} changed before commit`);
              yield chunk;
            }
          }
          try {
            const revision = await services.commitProjectMutation(req, [{ path, content: content() }]);
            lap('commit');
            heldChunks.delete(key);
            await rm(documentChunkRoot(root, path), { recursive: true, force: true });
            const byHash = new Map<string, { offset: number; length: number }>();
            let offset = 0;
            for (const [hash, length] of listed) {
              byHash.set(hash, { offset, length });
              offset += length;
            }
            const written = await stat(join(root, path)).catch(() => null);
            if (written && written.size === bytes)
              committedChunks.set(key, { size: written.size, mtimeMs: written.mtimeMs, byHash });
            else committedChunks.delete(key);
            json(res, {
              ok: true,
              bytes,
              sent: listed.reduce((sum, [hash, length]) => sum + (held.has(hash) ? length : 0), 0),
              revision: revision?.revision ?? null,
              ms,
            });
          } catch (error) {
            services.answerProjectMutationError(res, error);
          }
        } finally {
          await onDisk?.close();
        }
      },
    },
  ];

  return {
    name: 'volter-blender-routes',
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
