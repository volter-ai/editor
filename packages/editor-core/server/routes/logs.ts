/**
 * `/__editor/log-session`, `/__editor/log-entries`, `/__editor/server-log` —
 * play-mode console log persistence: the per-run JSONL file under the
 * project's `logs/`, the reader behind the Console panel, and the server-side
 * `console.*` sink a page can post into.
 *
 * The log-session route is also where the build-discipline tripwires get their
 * SECOND firing moment: the save event alone goes quiet exactly during
 * end-of-build verification, which is when an uncommitted batch is oldest.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { asPlayLogHeader, playLogHeaderLine } from '../support/play/log-format';
import { type EditorServerRouter, playLogFilename, playRunSlug } from '../editor-server';
import { broadcast } from '../editor-sse';
import { pruneGameplaySessionLogs } from '../gameplay-session-retention';
import {
  gameplaySessionRecordingPath,
  getGameplaySession,
  listGameplaySessionCatalog,
} from '../gameplay-sessions';
import { processSessionId } from '../session-registry';
import type { RouteContext } from './context';

export function registerLogRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const { announceBuildDisciplineTripwires, journalEvent } = ctx;

  // ---- Play-mode console log persistence ----
  let logSessionSequence = 0;
  let activeLogStartedAt: number | null = null;
  let recentlyEndedLog: { file: string; startedAt: number; endedAt: number } | null = null;

  // Play start/stop is the SECOND event the build-discipline tripwires ride
  // (`announceBuildDisciplineTripwires`, above). The save event alone covers
  // the authoring stretch and goes quiet exactly where the measured failure
  // lives: the end-of-build verification phase is play, playtest and eval —
  // minutes of activity with no file written, which is also the stretch where
  // an uncommitted batch is at its oldest. Same guarded call, so the read cap
  // and the announce gate are unchanged; this only adds a moment at which
  // they can fire.
  router.post('/__editor/log-session', async (req: Request, res: Response) => {
    const body = req.body as { action: 'start' | 'end'; name?: string | null };

    if (body.action === 'start') {
      const logsDir = join(ctx.projectRoot, 'logs');
      await mkdir(logsDir, { recursive: true });

      // Lexicographic order remains chronological for pruning/tail tooling —
      // see `playLogFilename` for why an optional run name goes on the END.
      const slug = playRunSlug(body.name);
      const startedAt = new Date();
      const filename = playLogFilename(startedAt, ++logSessionSequence, slug);
      ctx.activeLogFile = join(logsDir, filename);
      activeLogStartedAt = startedAt.getTime();
      // The run's IDENTITY, recorded ONCE (see `play/log-format.ts`): who wrote
      // this file, for which project, under which run name, when. These four
      // facts are fixed for the file's whole lifetime, so they are a header
      // line and not a per-entry stamp — what varies per entry (tick/simT,
      // simSpeed, world) is stamped by the entry writer instead.
      await writeFile(
        ctx.activeLogFile,
        playLogHeaderLine({
          session: processSessionId(),
          project: ctx.projectRoot,
          run: slug,
          startedAt: startedAt.getTime(),
        }),
        'utf-8',
      );
      await pruneGameplaySessionLogs(ctx.projectRoot);
      journalEvent({ kind: 'play', action: 'start', name: slug, logFile: filename });
      announceBuildDisciplineTripwires();
      res.json({ ok: true, file: filename });
    } else {
      const ended = ctx.activeLogFile;
      if (ended !== null) {
        const endedAt = Date.now();
        await appendFile(
          ended,
          `${JSON.stringify({
            t: endedAt,
            level: 'info',
            source: 'gameplay-session',
            msg: 'ended',
            meta: { endedAt },
          })}\n`,
          'utf-8',
        ).catch(() => undefined);
        if (activeLogStartedAt !== null) {
          recentlyEndedLog = { file: ended, startedAt: activeLogStartedAt, endedAt };
        }
      }
      ctx.activeLogFile = null;
      activeLogStartedAt = null;
      journalEvent({
        kind: 'play',
        action: 'stop',
        name: null,
        logFile: ended === null ? null : basename(ended),
      });
      announceBuildDisciplineTripwires();
      res.json({ ok: true });
    }
  });

  router.get('/__editor/gameplay-sessions', async (_req: Request, res: Response) => {
    res.json({ sessions: await listGameplaySessionCatalog(ctx.projectRoot, ctx.activeLogFile) });
  });

  router.get(
    '/__editor/gameplay-sessions/:id/recording',
    async (req: Request, res: Response, next: NextFunction) => {
      const session = await getGameplaySession(
        ctx.projectRoot,
        Array.isArray(req.params['id']) ? (req.params['id'][0] ?? '') : (req.params['id'] ?? ''),
        ctx.activeLogFile,
      );
      const path = session ? gameplaySessionRecordingPath(ctx.projectRoot, session) : null;
      if (!path) {
        res.status(404).json({ error: 'This Gameplay Session has no recording.' });
        return;
      }
      res.sendFile(path, { dotfiles: 'allow' }, (error) => {
        if (!error) return;
        if (!res.headersSent) res.status(404).json({ error: 'Recording file not found.' });
        else next(error);
      });
    },
  );

  router.get('/__editor/gameplay-sessions/:id', async (req: Request, res: Response) => {
    const session = await getGameplaySession(
      ctx.projectRoot,
      Array.isArray(req.params['id']) ? (req.params['id'][0] ?? '') : (req.params['id'] ?? ''),
      ctx.activeLogFile,
    );
    if (!session) {
      res.status(404).json({ error: 'Gameplay Session not found.' });
      return;
    }
    res.json({ session });
  });

  // `entries` is ENTRIES ONLY — the file's first line is the run's identity
  // header (`play/log-format.ts`), and a reader counting or rendering log
  // lines must never see it as one. It is reported beside them instead, so a
  // follower learns which session/project/run it is tailing without a second
  // request.
  router.get('/__editor/log-entries', async (_req: Request, res: Response) => {
    if (!ctx.activeLogFile) {
      res.json({ entries: [], header: null });
      return;
    }
    // The whole read used to sit in one try/catch whose catch answered the
    // EMPTY NO-LOG SHAPE — the same bytes as "no session is running". So a log
    // being APPENDED TO while this route read it (the normal case: the writer
    // is a live play session, and a read landing mid-append sees a torn last
    // line) reported the entire run as having produced nothing. A follower
    // cannot tell that from a quiet session, so it stops asking.
    let raw: string;
    try {
      raw = await readFile(ctx.activeLogFile, 'utf-8');
    } catch (error) {
      res.json({
        entries: [],
        header: null,
        file: basename(ctx.activeLogFile),
        unreadable: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const lines = raw.split('\n').filter(Boolean);
    const records: unknown[] = [];
    let truncatedTail = false;
    let unparsableLines = 0;
    for (const [index, line] of lines.entries()) {
      try {
        records.push(JSON.parse(line) as unknown);
      } catch {
        // The writer appends WHOLE lines, so the last one is the only one a
        // concurrent read can catch half-written — that is a torn tail, and
        // every line before it is real data. An unparsable line anywhere else
        // is corruption, counted separately; neither discards what did parse.
        if (index === lines.length - 1) truncatedTail = true;
        else unparsableLines += 1;
      }
    }
    const header = records.length > 0 ? asPlayLogHeader(records[0]) : null;
    const entries = header === null ? records : records.slice(1);
    res.json({
      entries,
      header,
      file: basename(ctx.activeLogFile),
      ...(truncatedTail ? { truncatedTail: true } : {}),
      ...(unparsableLines > 0 ? { unparsableLines } : {}),
    });
  });

  router.post('/__editor/log-entries', async (req: Request, res: Response) => {
    const body = req.body as
      | {
          entries: Array<{
            t: number;
            level: string;
            source?: string;
            sub?: string;
            msg: string;
            meta?: Record<string, unknown>;
          }>;
        }
      | null
      | undefined;
    if (!body || !Array.isArray(body.entries) || body.entries.length === 0) {
      res.status(400).json({ error: 'Expected a non-empty entries array.' });
      return;
    }
    const batches = new Map<string, typeof body.entries>();
    for (const entry of body.entries) {
      const target =
        recentlyEndedLog &&
        Number.isFinite(entry.t) &&
        entry.t >= recentlyEndedLog.startedAt &&
        entry.t <= recentlyEndedLog.endedAt
          ? recentlyEndedLog.file
          : ctx.activeLogFile;
      if (!target) {
        res.status(409).json({ error: 'No matching Gameplay Session for these entries.' });
        return;
      }
      const batch = batches.get(target) ?? [];
      batch.push(entry);
      batches.set(target, batch);
    }
    await Promise.all(
      [...batches].map(([target, entries]) =>
        appendFile(
          target,
          `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
          'utf-8',
        ),
      ),
    );
    res.json({ ok: true });
  });

  // ---- External-tool narration relay ----
  // A tool driving this session (a `@vgai/live` client, say) fires
  // best-effort lifecycle lines at this route so they land in the
  // SAME live editor console the `server-log` SSE event feeds
  // (see `runFileValidation`'s `broadcast('server-log', …)` calls above) — a
  // human watching the editor sees the script's progress without tailing a
  // separate terminal. Deliberately dumb: this is a narration RELAY, not an
  // API — it validates shape, broadcasts, and gets out of the way; no state is
  // kept here, and a caller with nothing to say just never POSTs.
  router.post('/__editor/server-log', (req: Request, res: Response) => {
    const body = req.body as { level?: unknown; message?: unknown };
    const level = body.level;
    if (
      (level !== 'info' && level !== 'warn' && level !== 'error') ||
      typeof body.message !== 'string'
    ) {
      res
        .status(400)
        .json({ error: "Expected { level: 'info'|'warn'|'error', message: string }." });
      return;
    }
    broadcast('server-log', { level, message: body.message });
    res.status(204).end();
  });
}
