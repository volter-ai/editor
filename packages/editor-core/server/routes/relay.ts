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
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { type EditorServerRouter, playRunSlug } from '../editor-server';
import { pruneGameplaySessionClips } from '../gameplay-session-retention';
import { commandResponseFor, isCanonicalPathInside } from '../server-utils';
import type { RouteContext } from './context';
import type { ControlPlane } from './control-plane';

export function registerRelayRoutes(
  router: EditorServerRouter,
  ctx: RouteContext,
  plane: ControlPlane,
): void {
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
