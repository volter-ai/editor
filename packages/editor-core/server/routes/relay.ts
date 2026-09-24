/**
 * The command relay's HTTP surface: `/__editor/command`,
 * `/__editor/command-result`, `/__editor/command-received`,
 * `/__editor/command-listener`, `/__editor/page-error`,
 * `/__editor/play-phase`, `/__editor/console-entries`, `/__editor/console`,
 * `/__editor/console/ack`, and the `/__editor/recording/*` verbs.
 *
 * Every one of these is a THIN door onto `routes/control-plane.ts`: the POSTs
 * a tab makes land on exactly the handlers its duplex control socket's frames
 * land on, so the two transports cannot answer differently. Nothing here
 * decides anything — if a rule seems to be missing from this file, it is in
 * the control plane, which is the point.
 */

import { commandLine } from '@volter/editor-sdk/kit/product-command';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createBrotliDecompress } from 'node:zlib';
import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';
import type { NextFunction, Request, Response } from 'express';
import { projectOutputRootOf } from '@volter/editor-sdk/project/output-roots';
import { PROJECT_SESSION_WRITE_OPERATION } from '../support/project/provenance';
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
} from '../blender-wasm-artifact';
import { type EditorServerRouter, playRunSlug } from '../editor-server';
import { pruneGameplaySessionClips } from '../gameplay-session-retention';
import { isProjectOwnedRelativePath, projectFileIndex } from '../project-file-scan';
import { createProjectOutputWriter, projectOutputMediaType } from '../project-output-writer';
import {
  allowCrossOriginFrameEmbedding,
  commandResponseFor,
  isCanonicalPathInside,
} from '../server-utils';
import type { RouteContext } from './context';
import type { ControlPlane } from './control-plane';

// ---- File bodies, which are NOT commands.
//
// A FILE IS A BODY, NOT A JSON FIELD. `blender-read-file` used to answer
// with the whole file base64'd inside a control-plane message, so a mesh the
// twin had written came back as a single JSON frame on the command socket:
// +33% for the encoding, a string the page built one 32 KB `fromCharCode`
// chunk at a time on the main thread, and a 60 s COMMAND budget applied to
// what is really a transfer.
//
// MEASURED 2026-09-15: `02-hinged-vise` writes a 31 MB
// `raw-FINAL-HandleKnobA.json`, which became ~41.5 MB of base64 in one
// message -- within 20% of the server's 50 MB JSON body cap, and the only
// file in the battery whose read killed the socket (1006). Nothing about
// that is specific to the parity battery; an exported GLB or a baked texture
// would do the same.
//
// So bytes move as bytes, the way `/__editor/recording/chunk` above already
// moves video. The page POSTs an octet-stream; the requester GETs it once
// and it is gone. The command result carries only a length.
//
// The spool deliberately keeps PATH AUTHORITY WITH THE REQUESTER: the page
// never names a destination on disk, it only hands over bytes under an id
// the caller minted. Adding a page-driven write-anywhere route to make one
// harness faster would be a far worse trade than the copy this costs.
function registerBlenderFileRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const transferRoot = join(tmpdir(), 'vgai-blender-transfer');
  const transferPath = (id: string): string => join(transferRoot, id);

  // A spool is deleted by the GET that reads it, so the only thing that can
  // accumulate is a transfer nobody ever collected -- a command that failed
  // between the page's POST and the caller's GET. Clearing the whole directory
  // once at startup bounds that exactly, with no age to guess at: every id is
  // a uuid minted by a caller in a PREVIOUS process, so nothing live can be in
  // here yet. A TTL sweep would be a number nothing measured.
  void rm(transferRoot, { recursive: true, force: true });

  const transferId = (value: unknown): string | null =>
    typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) ? value : null;

  // ---- The engine itself: headless Blender, compiled to WebAssembly.
  //
  // `blender-wasm-artifact.ts` owns where it is and the one patch its glue
  // takes; this is the door. The runtime spawns its pthreads by loading
  // `blender_browser.js` from this same URL as a classic worker, so the
  // patched text has to be what the URL answers with -- not something the
  // worker rewrites for itself.
  router.get('/__editor/blender-wasm/status', async (_req: Request, res: Response) => {
    allowCrossOriginFrameEmbedding(res);
    res.json(await blenderWasmStatus());
  });

  // THE SUBSTRATE SKEW'S OWN THREE DOORS, beside the standalone bundle's.
  //
  // `blender.wasm` goes out through the same `:file` route below. These are
  // what that skew needs and the other does not: Blender's runtime tree as one
  // index and one blob (a request per file would be ~2,300 round trips), and
  // the substrate's browser ESM with its bare specifiers rewritten -- which is
  // the ONLY way `@volter/*` reaches the tab, and therefore the reason
  // `@volter/editor-blender` can declare no dependency on browser-substrate at all.
  router.get('/__editor/blender-wasm/runtime.idx', async (_req: Request, res: Response) => {
    const status = await blenderWasmStatus();
    if (status.skew !== 'wali' || status.dir === null) {
      res.status(404).json({ error: 'This editor does not serve the substrate skew of Blender.' });
      return;
    }
    res.json(await runtimeIndex(status.dir));
  });

  router.get('/__editor/blender-wasm/runtime.bin', async (_req: Request, res: Response) => {
    const status = await blenderWasmStatus();
    if (status.skew !== 'wali' || status.dir === null) {
      res.status(404).json({ error: 'This editor does not serve the substrate skew of Blender.' });
      return;
    }
    res.type('application/octet-stream');
    await writeRuntimeBlob(status.dir, (chunk) => void res.write(chunk));
    res.end();
  });

  router.get('/__editor/blender-wasm/wali/:segment/:file', async (req: Request, res: Response) => {
    const served = await substrateModule(String(req.params['segment']), String(req.params['file']));
    if (!served) {
      res.status(404).json({
        error:
          `This editor does not serve ${req.params['segment']}/${req.params['file']}. ` +
          'The substrate skew runs Blender through @volter/browser-wali and ' +
          '@volter/browser-runtime; a project that opts into it declares them.',
      });
      return;
    }
    res.type('text/javascript').send(served.text);
  });

  router.get('/__editor/blender-wasm/:file', async (req: Request, res: Response) => {
    const file = String(req.params['file']);
    // The frame's page is cross-origin-isolated and this session is not its
    // origin, so every byte of the engine has to say it may be embedded — the
    // glue above all, which Blender's pthreads load with `importScripts`
    // (`server-utils.ts`'s allowCrossOriginFrameEmbedding says what that cost
    // before it was measured).
    allowCrossOriginFrameEmbedding(res);
    const bundled = (BLENDER_WASM_FILES as readonly string[]).includes(file);
    if (!bundled && file !== BLENDER_WALI_ARTIFACT) {
      res.status(404).json({ error: `The Blender build has no ${String(file)}.` });
      return;
    }
    const status = await blenderWasmStatus();
    if (!status.available) {
      res.status(404).json({
        error:
          'The headless Blender WebAssembly build is not served by this editor: ' +
          status.missing.join('; '),
      });
      return;
    }
    if (file === 'blender_browser.js') {
      res.type('text/javascript').send(await blenderGlueText(status.dir!));
      return;
    }
    const found = await blenderWasmOnDisk(status.dir!, file);
    if (!found) {
      res.status(404).json({ error: `${file} vanished from ${status.dir}.` });
      return;
    }
    // A VALIDATOR, SO THE COMPILED ENGINE IS CACHED. Chrome keeps the machine
    // code it compiled from an `instantiateStreaming` response only while that
    // response sits in its HTTP cache, and a response with no validator is
    // never stored -- so every boot compiled all 86 MB of Blender again,
    // measured at 12-36 s of a boot at load ~35 and 49-84 s in the battery.
    // `no-cache` still asks this server every time, which answers 304 while
    // the file on disk is the same one.
    const info = await stat(found.path);
    // A pre-compressed file goes out as stored, declared as brotli, to a
    // client that accepts brotli: the browser inflates it before
    // `instantiateStreaming` / the `.data` preload read a byte, so
    // `content-type` stays what the runtime requires. A client that does not
    // (a service worker answering a page from a server it runs in the tab
    // asks with no Accept-Encoding) gets the file inflated here; sent as
    // brotli regardless, it handed Blender compressed bytes as its wasm.
    const accepted = String(req.headers['accept-encoding'] ?? '').toLowerCase();
    const sendEncoded = found.encoding !== null && accepted.includes(found.encoding);
    const etag = `"${sendEncoded ? found.encoding : 'identity'}-${info.size}-${Math.floor(info.mtimeMs)}"`;
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('etag', etag);
    res.setHeader('vary', 'accept-encoding');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.type(file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
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
  });

  router.post('/__editor/blender-file', async (req: Request, res: Response) => {
    const id = transferId(req.query['id']);
    if (id === null) {
      res.status(400).json({ error: 'blender-file requires a uuid `id`.' });
      return;
    }
    const path = transferPath(id);
    await mkdir(dirname(path), { recursive: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of req) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      chunks.push(chunk);
    }
    await writeFile(path, new Uint8Array(Buffer.concat(chunks)));
    res.json({ bytes });
  });

  router.get('/__editor/blender-file', async (req: Request, res: Response) => {
    const id = transferId(req.query['id']);
    if (id === null) {
      res.status(400).json({ error: 'blender-file requires a uuid `id`.' });
      return;
    }
    const path = transferPath(id);
    const info = await stat(path).catch(() => null);
    if (info === null) {
      res.status(404).json({ error: 'No transfer is spooled under that id.' });
      return;
    }
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', String(info.size));
    const stream = createReadStream(path);
    stream.pipe(res);
    // One reader, then it is gone -- a spool that outlives its GET is a
    // tmpdir leak proportional to everything Blender ever wrote.
    stream.on('close', () => {
      void unlink(path).catch(() => {});
    });
  });

  // ---- The project's own files, read INTO the session.
  //
  // The direction `blender-file` above does not cover: the session's Python
  // opening the project's own files. Scope is the project root and nothing
  // else, through the estate `collaborationSourceSnapshot` already publishes
  // (`isProjectOwnedRelativePath`). The client names a project-RELATIVE path
  // and the server joins it to its own root -- no host path on the wire -- and
  // the join is canonicalized before any byte is read.
  router.get('/__editor/blender-project-index', async (_req: Request, res: Response) => {
    if (ctx.projectRoot === ctx.engineRoot) {
      res.status(404).json({ error: 'No project open.' });
      return;
    }
    res.json({ root: ctx.projectRoot, files: await projectFileIndex(ctx.projectRoot) });
  });

  router.get('/__editor/blender-project-file', async (req: Request, res: Response) => {
    const relPath = (req.query['path'] as string) ?? '';
    // Saved scratch documents can be opened explicitly without indexing logs,
    // recordings, credentials or the rest of the editor's private directory.
    const scratchDocument =
      isContainedRelativePath(relPath) &&
      relPath.startsWith('.vgai/tmp/') &&
      relPath.endsWith('.blend');
    if (!isProjectOwnedRelativePath(relPath) && !scratchDocument) {
      res.status(400).json({ error: 'Not a project-owned path.' });
      return;
    }
    if (ctx.projectRoot === ctx.engineRoot) {
      res.status(404).json({ error: 'No project open.' });
      return;
    }
    const absolute = join(ctx.projectRoot, relPath);
    if (!(await isCanonicalPathInside(ctx.projectRoot, absolute))) {
      res.status(403).json({ error: 'That path leaves the project root.' });
      return;
    }
    try {
      res.type('application/octet-stream').send(await readFile(absolute));
    } catch {
      res.status(404).json({ error: 'Not found.' });
    }
  });

  // ---- The session's SHIPPED OUTPUTS, written back OUT into the project
  // WITH a provenance record.
  //
  // The third direction, and the one that must record. A Blender script's
  // `export_scene.gltf` to `<project>/public/models/lantern.glb` is a
  // generated binary the project SHIPS, and a shipped binary with no record in
  // `.vgai/provenance.json` is the one state
  // `scripts/validate-project-provenance.mjs` calls fatal.
  //
  // `vgai blender-mcp` used to commit those bytes itself, by importing
  // `server/project-output-writer.ts` straight out of this package. That is a
  // LICENCE break before it is anything else — the CLI is Apache-2.0 and this
  // server is AGPL-3.0-only, and licence follows the import graph — and it put
  // a second PROCESS on a ledger whose write lock had to grow a cross-process
  // half to survive it. The session face is the one door the CLI rides, so it
  // rides it here: the bytes arrive as a body, the writer runs in the process
  // that owns the project, and there is exactly one writer.
  //
  // The destination shape is pinned BY THIS SERVER, like `blender-document`
  // below and unlike the `blender-file` spool above: a project-relative path
  // under `public/`, no traversal, joined to the server's own root. The SESSION
  // facts are the caller's to state, because only it watched the frames — and
  // an unnamed session is REFUSED rather than invented
  // (`ProjectProvenanceSessionSchema`: a kind that can be claimed without
  // evidence is the cheapest way past the gate).
  router.post('/__editor/blender-output', async (req: Request, res: Response) => {
    const path = (req.query['path'] as string) ?? '';
    const session = (req.query['session'] as string) ?? '';
    const source = (req.query['source'] as string) ?? '';
    const revision = Number(req.query['revision']);
    const callId = (req.query['callId'] as string) ?? '';
    if (!isContainedRelativePath(path) || projectOutputRootOf(path) !== 'public') {
      res.status(400).json({
        error:
          'A shipped output is a project-relative path under public/ with no traversal ' +
          `(public/models/model.glb); got ${JSON.stringify(path)}.`,
      });
      return;
    }
    if (session === '' || !Number.isInteger(revision) || revision < 0) {
      res.status(400).json({
        error:
          'A shipped output must name the session that produced it — `session` and a ' +
          'non-negative integer `revision` — so the record can say what re-derives the file.',
      });
      return;
    }
    if (source === '' || source.length > 64) {
      res
        .status(400)
        .json({ error: '`source` names the transport that wrote the file, in 1-64 characters.' });
      return;
    }
    // WHAT THE BYTES WERE MADE FROM — project FILES, validated the same way
    // the destination is. A session-written `.glb` names the
    // `src/models/<name>.blend` it was exported from, which is what lets a
    // reader drill DOWN by kind from a prefab's glTF to its model
    // (ARCHITECTURE-CORE §Roots). Repeatable; each value is a
    // project-relative path with no traversal, and unlike the destination it
    // is NOT restricted to `public/` — a source lives in `src/`.
    const inputs = (
      Array.isArray(req.query['inputs'])
        ? (req.query['inputs'] as unknown[])
        : req.query['inputs'] === undefined
          ? []
          : [req.query['inputs']]
    ).map((value) => String(value));
    const badInput = inputs.find((value) => !isContainedRelativePath(value));
    if (badInput !== undefined) {
      res.status(400).json({
        error:
          'Each `inputs` value is a project-relative path with no traversal (the source file ' +
          `these bytes were produced from); got ${JSON.stringify(badInput)}.`,
      });
      return;
    }
    if (ctx.projectRoot === ctx.engineRoot) {
      res.status(404).json({ error: 'No project open, so there is nowhere to record the output.' });
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of req) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      chunks.push(chunk);
    }
    if (bytes === 0) {
      res.status(400).json({ error: 'The output body was empty; nothing was written.' });
      return;
    }
    const mediaType = projectOutputMediaType(path);
    try {
      const written = await createProjectOutputWriter(ctx.projectRoot, {
        operationName: PROJECT_SESSION_WRITE_OPERATION,
        operationSource: source,
        session: {
          id: session,
          // The server's OWN port, read off the connection rather than taken
          // from the caller: it is the port a person gets back to this tab on,
          // and the one fact here nobody else should be asserting.
          port: req.socket.localPort ?? 0,
          revision,
          ...(callId === '' ? {} : { callId }),
        },
        ...(inputs.length > 0 ? { inputs } : {}),
      }).write([
        {
          path,
          content: Buffer.concat(chunks),
          role: 'asset',
          ...(mediaType ? { mediaType } : {}),
        },
      ]);
      res.json({ ok: true, bytes, provenanceOperationId: written.provenanceOperationId ?? null });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ---- The session's DOCUMENT, written back OUT into the project.
  //
  // The one direction the two routes above do not cover. A Blender session
  // holds one `.blend` (`browser/session.py`, "THE SESSION HAS A DOCUMENT");
  // Blender's own `save_as_mainfile` writes it into the engine's filesystem,
  // and this is how those bytes reach the disk the project actually lives on.
  //
  // NOT the `blender-file` spool above, and the difference is the one that
  // spool exists to protect: there the page hands over bytes under an id and
  // the REQUESTER names the destination, because the requester (`vgai
  // blender-mcp`'s Mirror) writes anywhere a script wrote. Here the
  // destination shape is pinned BY THIS SERVER — a project-relative `.blend`,
  // no traversal, joined to the server's own root — so the page names a
  // document, never a place on disk. Same defence-in-depth as `/__editor/
  // data-file`, whose write half accepts only `src/data/**/*.data.json`, and
  // the same reason: a purpose-scoped route beats widening a general one.
  //
  // The write is `commitProjectMutation` — the project's one attributed,
  // conflict-checked transaction. A `.blend` is the project's file like any
  // other, and there is deliberately no second write path.
  //
  // No provenance record, deliberately: the ledger is about what the project
  // SHIPS and `public/` is what ships (see `vgai blender-mcp`'s Mirror). A
  // document is the source the shipped artifact is exported FROM.
  const isDocumentPath = (path: string): boolean => {
    if (!path.endsWith('.blend') || path.startsWith('/') || path.includes('\\')) return false;
    if (!isContainedRelativePath(path)) return false;
    return path.split('/').every((segment) => segment !== '' && !segment.startsWith('.'));
  };

  router.post('/__editor/blender-document', async (req: Request, res: Response) => {
    const path = (req.query['path'] as string) ?? '';
    if (!isDocumentPath(path)) {
      res.status(400).json({
        error:
          'A Blender document is a project-relative .blend path with no traversal ' +
          `(models/model.blend); got ${JSON.stringify(path)}.`,
      });
      return;
    }
    if (ctx.projectRoot === ctx.engineRoot) {
      res.status(404).json({ error: 'No project open, so there is nowhere to save the document.' });
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of req) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      chunks.push(chunk);
    }
    // A zero-byte .blend is not a document; writing one would replace a good
    // file with an empty one at exactly the moment something went wrong.
    if (bytes === 0) {
      res.status(400).json({ error: 'The Blender document body was empty; nothing was written.' });
      return;
    }
    try {
      const revision = await ctx.commitProjectMutation(req, [
        { path, content: Buffer.concat(chunks) },
      ]);
      res.json({ ok: true, bytes, revision: revision?.revision ?? null });
    } catch (error) {
      ctx.projectMutationError(res, error);
    }
  });
}

export function registerRelayRoutes(
  router: EditorServerRouter,
  ctx: RouteContext,
  plane: ControlPlane,
): void {
  registerBlenderFileRoutes(router, ctx);
  const { consoleLedger, engineRoot, journalEvent, trustedShareIdentity } = ctx;
  const {
    handleCommandListener,
    handleCommandReceived,
    handleCommandResult,
    handleConsoleEntries,
    handleConsoleResolved,
    handlePageError,
    handleContributedCommands,
    handlePlayPhase,
    MAX_RECORDING_CHUNK_BYTES,
    openGameplayRecording,
    openGameplayRecordings,
    relayCommand,
  } = plane;

  // small for a full QA playthrough.
  router.post('/__editor/recording/start', async (req: Request, res: Response) => {
    if (ctx.projectRoot === engineRoot) {
      res.status(409).json({ error: 'Open a game project before recording gameplay.' });
      return;
    }
    const startedAt = req.body?.startedAt;
    const mimeType = req.body?.mimeType;
    if (
      typeof startedAt !== 'string' ||
      !Number.isFinite(Date.parse(startedAt)) ||
      typeof mimeType !== 'string' ||
      !mimeType.startsWith('video/webm')
    ) {
      res
        .status(400)
        .json({ error: 'Recording start requires a WebM mimeType and ISO start time.' });
      return;
    }
    const purpose = req.body?.purpose;
    if (purpose !== undefined && purpose !== 'export') {
      res.status(400).json({ error: 'Unknown recording purpose.' });
      return;
    }
    const format = req.body?.format ?? 'composite-webm';
    if (format !== 'composite-webm' && format !== 'canvas-dom') {
      res.status(400).json({ error: 'Unknown gameplay recording format.' });
      return;
    }
    if (purpose === 'export' && format !== 'composite-webm') {
      res.status(400).json({ error: 'Fixed-step export requires composite-webm.' });
      return;
    }
    const id = randomUUID();
    // WHERE A RECORDING LIVES, AND HOW LONG.
    //
    // Two ownership rules, because the disk cost of "always record" has to be
    // bounded by the DESIGN rather than by a cleanup chore nobody runs.
    //
    //  - Inside a Gameplay Session, an unnamed clip takes the log's stem. It
    //    participates in the managed clip BYTE budget; the durable log has a
    //    separate, much larger history and survives ordinary clip eviction.
    //  - Outside a Gameplay Session, the unnamed fallback is the single
    //    rotating `play-latest.webm`.
    //  - Named (`vgai play --record <name>`): the caller's own keepsake, and
    //    NOTHING rotates it. Reusing a name overwrites that name's own file —
    //    an explicit instruction, unlike rotation — so a name is also how you
    //    keep a clip past the next play.
    //
    // The directory is gitignored in the scaffold (`.vgai/recordings/`), so
    // neither kind is ever a commit's problem.
    const slug = playRunSlug(req.body?.name);
    if (purpose === 'export' && slug === null) {
      res.status(400).json({ error: 'Video export requires a non-empty filename.' });
      return;
    }
    const sessionStem = ctx.activeLogFile
      ? basename(ctx.activeLogFile, extname(ctx.activeLogFile))
      : null;
    const path = resolve(
      ctx.projectRoot,
      '.vgai',
      'recordings',
      slug === null && sessionStem !== null
        ? `${sessionStem}.webm`
        : `${slug ?? 'play-latest'}.webm`,
    );
    const replayPath =
      format === 'canvas-dom' ? `${path.slice(0, -extname(path).length)}.replay` : null;
    // Export must not replace a source capture and delete its DOM sidecar.
    if (purpose === 'export' && existsSync(`${path.slice(0, -extname(path).length)}.replay`)) {
      res
        .status(409)
        .json({ error: 'Export name belongs to a source replay. Choose a different name.' });
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    // Truncate the chosen target before chunks append. For a session-derived
    // name it is a fresh file; for an explicit reused name it is intentional.
    await writeFile(path, new Uint8Array());
    await rm(`${path.slice(0, -extname(path).length)}.replay`, { recursive: true, force: true });
    if (replayPath !== null) {
      await mkdir(join(replayPath, 'assets'), { recursive: true });
      await writeFile(join(replayPath, 'events.json'), '[', 'utf-8');
      await writeFile(
        join(replayPath, 'manifest.json'),
        `${JSON.stringify({ version: 1, status: 'recording', format, startedAt }, null, 2)}\n`,
        'utf-8',
      );
    }
    openGameplayRecordings.set(id, {
      path,
      format,
      replayPath,
      nextSequence: 0,
      nextDomSequence: 0,
      domEventCount: 0,
      domEventsStarted: false,
      replayAssets: new Set(),
      ...(purpose ? { purpose } : {}),
    });
    if (ctx.activeLogFile !== null) {
      await appendFile(
        ctx.activeLogFile,
        `${JSON.stringify({
          t: Date.now(),
          level: 'info',
          source: purpose === 'export' ? 'gameplay-export' : 'gameplay-recording',
          msg: 'started',
          meta: { file: basename(path), format, startedAt: Date.parse(startedAt) },
        })}\n`,
        'utf-8',
      );
    }
    journalEvent({
      kind: 'play-recording',
      action: 'started',
      file: basename(path),
      rotates: slug === null && sessionStem === null,
      reason: null,
    });
    res.json({
      id,
      path,
      format,
      replayPath,
      rotates: slug === null && sessionStem === null,
      logFile: ctx.activeLogFile === null ? null : basename(ctx.activeLogFile),
    });
  });

  router.post('/__editor/recording/dom', async (req: Request, res: Response) => {
    const recording = openGameplayRecording(req.query['id']);
    const sequence = Number(req.query['sequence']);
    if (!recording) {
      res.status(404).json({ error: 'No open gameplay recording has that id.' });
      return;
    }
    if (recording.format !== 'canvas-dom' || recording.replayPath === null) {
      res.status(409).json({ error: 'This recording has no DOM replay stream.' });
      return;
    }
    if (!Number.isInteger(sequence) || sequence !== recording.nextDomSequence) {
      res.status(409).json({
        error: `DOM event sequence ${String(req.query['sequence'])} arrived; expected ${recording.nextDomSequence}.`,
      });
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of req) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > MAX_RECORDING_CHUNK_BYTES) {
        res.status(413).json({
          error: `DOM event batches are limited to ${MAX_RECORDING_CHUNK_BYTES} bytes.`,
        });
        return;
      }
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks, bytes).toString('utf-8').trim();
    let events: unknown;
    try {
      events = JSON.parse(text);
    } catch {
      res.status(400).json({ error: 'DOM event batch was not valid JSON.' });
      return;
    }
    if (!Array.isArray(events) || events.length === 0) {
      res.status(400).json({ error: 'DOM event batch must be a non-empty array.' });
      return;
    }
    const serialized = JSON.stringify(events).slice(1, -1);
    await appendFile(
      join(recording.replayPath, 'events.json'),
      `${recording.domEventsStarted ? ',' : ''}${serialized}`,
      'utf-8',
    );
    recording.domEventsStarted = true;
    recording.domEventCount += events.length;
    recording.nextDomSequence += 1;
    res.json({ ok: true });
  });

  router.post('/__editor/recording/asset', async (req: Request, res: Response) => {
    const recording = openGameplayRecording(req.query['id']);
    const name = req.query['name'];
    if (!recording) {
      res.status(404).json({ error: 'No open gameplay recording has that id.' });
      return;
    }
    if (recording.format !== 'canvas-dom' || recording.replayPath === null) {
      res.status(409).json({ error: 'This recording has no replay asset store.' });
      return;
    }
    if (typeof name !== 'string' || !/^\d{6}\.(?:png|jpg|webp|gif|svg)$/.test(name)) {
      res.status(400).json({ error: 'Replay asset name is invalid.' });
      return;
    }
    if (recording.replayAssets.has(name)) {
      res.status(409).json({ error: 'Replay asset already exists.' });
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of req) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > MAX_RECORDING_CHUNK_BYTES) {
        res.status(413).json({
          error: `Replay assets are limited to ${MAX_RECORDING_CHUNK_BYTES} bytes.`,
        });
        return;
      }
      chunks.push(chunk);
    }
    if (bytes === 0) {
      res.status(400).json({ error: 'Replay asset was empty.' });
      return;
    }
    await writeFile(join(recording.replayPath, 'assets', name), Buffer.concat(chunks, bytes));
    recording.replayAssets.add(name);
    res.json({ ok: true });
  });

  router.post('/__editor/recording/chunk', async (req: Request, res: Response) => {
    const recording = openGameplayRecording(req.query['id']);
    const sequence = Number(req.query['sequence']);
    if (!recording) {
      res.status(404).json({ error: 'No open gameplay recording has that id.' });
      return;
    }
    if (!Number.isInteger(sequence) || sequence !== recording.nextSequence) {
      res.status(409).json({
        error: `Recording chunk sequence ${String(req.query['sequence'])} arrived; expected ${recording.nextSequence}.`,
      });
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of req) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > MAX_RECORDING_CHUNK_BYTES) {
        res.status(413).json({
          error: `Recording chunks are limited to ${MAX_RECORDING_CHUNK_BYTES} bytes.`,
        });
        return;
      }
      chunks.push(chunk);
    }
    if (bytes === 0) {
      res.status(400).json({ error: 'Recording chunk was empty.' });
      return;
    }
    await appendFile(recording.path, Buffer.concat(chunks, bytes));
    recording.nextSequence += 1;
    res.json({ ok: true });
  });

  router.post('/__editor/recording/finish', async (req: Request, res: Response) => {
    const id = req.body?.id;
    const recording = openGameplayRecording(id);
    if (!recording || typeof id !== 'string') {
      res.status(404).json({ error: 'No open gameplay recording has that id.' });
      return;
    }
    const file = await stat(recording.path);
    if (file.size === 0) {
      res.status(409).json({ error: 'The browser finalized an empty gameplay recording.' });
      return;
    }
    if (recording.format === 'canvas-dom') {
      const replay = req.body?.replay;
      if (
        recording.replayPath === null ||
        !replay ||
        typeof replay !== 'object' ||
        replay.version !== 1 ||
        typeof replay.eventCount !== 'number' ||
        replay.eventCount !== recording.domEventCount ||
        typeof replay.assetCount !== 'number' ||
        replay.assetCount !== recording.replayAssets.size
      ) {
        res.status(409).json({
          error: 'The canvas-dom replay manifest does not match its uploaded events and assets.',
        });
        return;
      }
      await appendFile(join(recording.replayPath, 'events.json'), ']', 'utf-8');
      await writeFile(
        join(recording.replayPath, 'manifest.json'),
        `${JSON.stringify(
          {
            ...replay,
            video: basename(recording.path),
            status: 'complete',
            format: recording.format,
            completedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        'utf-8',
      );
    }
    openGameplayRecordings.delete(id);
    // The finalized clip lands in the journal so "where is the evidence for
    // that run" is answerable from the session record alone — including for a
    // run nobody was watching, which is the case this whole path exists for.
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
    if (ctx.activeLogFile !== null) {
      await appendFile(
        ctx.activeLogFile,
        `${JSON.stringify({
          t: Date.now(),
          level: 'info',
          source: recording.purpose === 'export' ? 'gameplay-export' : 'gameplay-recording',
          msg: 'finalized',
          meta: {
            file: basename(recording.path),
            bytes: file.size,
            format: recording.format,
            replay: recording.replayPath === null ? null : basename(recording.replayPath),
            reason,
          },
        })}\n`,
        'utf-8',
      );
    }
    journalEvent({
      kind: 'play-recording',
      action: 'finalized',
      file: basename(recording.path),
      rotates: basename(recording.path) === 'play-latest.webm',
      reason,
    });
    await pruneGameplaySessionClips(ctx.projectRoot);
    res.json({ ok: true, path: recording.path, bytes: file.size });
  });

  router.post('/__editor/recording/abort', async (req: Request, res: Response) => {
    const id = req.body?.id;
    const recording = openGameplayRecording(id);
    if (recording && typeof id === 'string') {
      openGameplayRecordings.delete(id);
      if (ctx.activeLogFile !== null) {
        await appendFile(
          ctx.activeLogFile,
          `${JSON.stringify({
            t: Date.now(),
            level: 'info',
            source: recording.purpose === 'export' ? 'gameplay-export' : 'gameplay-recording',
            msg: 'aborted',
            meta: { file: basename(recording.path) },
          })}\n`,
          'utf-8',
        );
      }
      await unlink(recording.path).catch(() => undefined);
      if (recording.replayPath !== null) {
        await rm(recording.replayPath, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    res.json({ ok: true });
  });

  /** Serve one completed local replay artifact to the editor's in-page viewer.
   * The caller names a project recording or its absolute path; containment rejects
   * symlinks and every path outside this project's recording directory. */
  router.get(
    '/__editor/recording/replay-file',
    async (req: Request, res: Response, next: NextFunction) => {
      const replay = req.query['replay'];
      const file = req.query['file'];
      if (
        typeof replay !== 'string' ||
        !/^[a-zA-Z0-9._-]+\.replay$/.test(basename(replay)) ||
        typeof file !== 'string'
      ) {
        res.status(400).json({ error: 'Replay file request is invalid.' });
        return;
      }
      const recordingsRoot = resolve(ctx.projectRoot, '.vgai', 'recordings');
      const replayRoot =
        replay === basename(replay)
          ? resolve(recordingsRoot, replay)
          : resolve(ctx.projectRoot, replay);
      if (
        dirname(replayRoot) !== recordingsRoot ||
        !(await isCanonicalPathInside(recordingsRoot, replayRoot))
      ) {
        res.status(400).json({
          error:
            'Replay must be inside this project’s .vgai/recordings directory; use the original recording, not an external copy.',
        });
        return;
      }
      const manifestPath = join(replayRoot, 'manifest.json');
      const manifest = await readFile(manifestPath, 'utf-8')
        .then((text) => JSON.parse(text) as { status?: unknown; video?: unknown })
        .catch(() => null);
      if (manifest?.status !== 'complete' || typeof manifest.video !== 'string') {
        res.status(404).json({ error: 'Completed replay not found.' });
        return;
      }
      let path: string | null = null;
      if (file === 'manifest.json') path = manifestPath;
      else if (file === 'events.json') path = join(replayRoot, 'events.json');
      else if (file === 'video') path = join(recordingsRoot, manifest.video);
      else if (/^assets\/\d{6}\.(?:png|jpg|webp|gif|svg)$/.test(file)) {
        path = join(replayRoot, file);
      }
      if (path === null || !(await isCanonicalPathInside(recordingsRoot, path))) {
        res.status(404).json({ error: 'Replay file not found.' });
        return;
      }
      res.sendFile(path, { dotfiles: 'allow' }, (error: Error | undefined) => {
        if (!error) return;
        if (!res.headersSent) res.status(404).json({ error: 'Replay file not found.' });
        else next(error);
      });
    },
  );

  router.post('/__editor/command', (req: Request, res: Response) => {
    relayCommand(
      req.body as Record<string, unknown>,
      trustedShareIdentity(req)?.participantId,
    ).then(({ result, callerReceipt }) => {
      if (callerReceipt) res.once('finish', callerReceipt);
      const { status, body } = commandResponseFor(result, consoleLedger.summary());
      res.status(status).json(body);
    });
  });

  // ---- Editor command result (browser reports back) ----
  router.post('/__editor/command-result', (req: Request, res: Response) => {
    const outcome = handleCommandResult(req.body as Record<string, unknown>);
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  // ---- Delivery receipt (browser reports it PICKED THE COMMAND UP) ----
  //
  // The other half of `relayCommandAckDeadlineMs`: the tab sends this the
  // instant its command handler sees the event, before it starts the work. It
  // only cancels the receipt window — the command's own budget keeps running,
  // so a genuinely slow game boot still gets its full 120s.
  router.post('/__editor/command-received', (req: Request, res: Response) => {
    const outcome = handleCommandReceived((req.body ?? {}) as Record<string, unknown>);
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  // ---- Command-listener presence (browser reports it CAN run commands) ----
  //
  // The POST fallback for pages with no upstream socket (the share tunnel's
  // one-way SSE bridge). See `src/editor-api.ts`'s `reportCommandListener`.
  router.post('/__editor/command-listener', (req: Request, res: Response) => {
    const outcome = handleCommandListener((req.body ?? {}) as Record<string, unknown>);
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  // The POST twin of the `page-error` control frame, for the same reason the
  // one above has one: a page whose control socket never came up (the share
  // tunnel's one-way SSE bridge, or a boot that died before the upgrade) must
  // still be able to say what killed it. `sendBeacon`-friendly.
  router.post('/__editor/contributed-commands', (req: Request, res: Response) => {
    const outcome = handleContributedCommands((req.body ?? {}) as Record<string, unknown>);
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  router.post('/__editor/page-error', (req: Request, res: Response) => {
    const outcome = handlePageError((req.body ?? {}) as Record<string, unknown>);
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  // The POST twin of the `play-phase` frame — same reason as the ones above.
  router.post('/__editor/play-phase', (req: Request, res: Response) => {
    const outcome = handlePlayPhase((req.body ?? {}) as Record<string, unknown>);
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  // The POST twin of the `console-entries` frame — same reason as the two
  // above (a page with no upstream socket must still be able to report).
  router.post('/__editor/console-entries', (req: Request, res: Response) => {
    const outcome = handleConsoleEntries((req.body ?? {}) as Record<string, unknown>);
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  // Clearing rule (c): the owner of a condition reporting it resolved. The POST
  // twin exists for the same reason as the frame above.
  router.post('/__editor/console-resolved', (req: Request, res: Response) => {
    const outcome = handleConsoleResolved((req.body ?? {}) as Record<string, unknown>);
    if (outcome.status === 200) res.json({ ok: true });
    else res.status(outcome.status).json({ error: outcome.error });
  });

  // ---- The unresolved console set (CLI reads; `vgai status` prints in full) ----
  //
  // The counts ride every command envelope (`commandResponseFor`), so this
  // route exists for the DETAIL: the complete list of distinct conditions with
  // their occurrence counts, which is what `vgai status` / `vgai console`
  // print. Deliberately a plain GET with no tab cooperation — the whole point
  // is that it answers when the tab is dead.
  router.get('/__editor/console', (req: Request, res: Response) => {
    const all = req.query['all'] === '1' || req.query['all'] === 'true';
    res.json({
      unresolvedConsole: consoleLedger.summary(),
      entries: all ? consoleLedger.all() : consoleLedger.unresolved(),
    });
  });

  // Clearing rule (b): a NAMED acknowledgment, with who and why. It never
  // deletes the record — the entry stays, marked, and a `console-ack` row goes
  // into the session ctx.journal — because the point of an acknowledgment is that
  // somebody can later read what was waved through and on whose say-so.
  router.post('/__editor/console/ack', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof body['id'] === 'string' ? body['id'].trim() : '';
    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    const by =
      typeof body['by'] === 'string' && body['by'].trim() !== '' ? body['by'].trim() : null;
    if (id === '') {
      res.status(400).json({ ok: false, error: 'console ack requires { id }.' });
      return;
    }
    if (reason === '') {
      res.status(400).json({
        ok: false,
        error:
          'console ack requires { reason } — an acknowledgment with no stated reason is a silent reset, ' +
          'which is the exact failure this ledger exists to prevent.',
      });
      return;
    }
    const acked = consoleLedger.ack(id, { by: by ?? 'unknown', reason });
    if (acked === null) {
      res.status(404).json({
        ok: false,
        error: `No unresolved console entry with id "${id}". Run ${commandLine('status')} for the current set.`,
      });
      return;
    }
    res.json({ unresolvedConsole: consoleLedger.summary(), ok: true, entry: acked });
  });
}
