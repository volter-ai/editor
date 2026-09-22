/**
 * Durable Gameplay Sessions, derived from the artifacts Play already owns.
 *
 * The JSONL log is the session record. Recording lifecycle entries inside that
 * same record associate an optional WebM without a second manifest that can
 * drift. A server restart reconstructs the complete catalog from disk.
 *
 * The PARSE RULES live in the browser-safe core
 * (`@vgai/sdk`'s `play/session-record.ts`), and this module is the Node
 * wiring: the stat-keyed cache, the directory walk, and the recording
 * route/paths only a server has.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type GameplaySessionRecord,
  materializeGameplaySession,
  type ParsedGameplaySession,
  parsePlayLogText,
} from './support/play/session-record';

export type {
  GameplaySessionRecord,
  GameplaySessionRecording,
} from './support/play/session-record';

interface CachedGameplaySession {
  readonly size: number;
  readonly mtimeMs: number;
  readonly parsed: ParsedGameplaySession | null;
}

const sessionCache = new Map<string, CachedGameplaySession>();

async function parseGameplaySession(
  projectRoot: string,
  file: string,
): Promise<ParsedGameplaySession | null> {
  const absolute = join(projectRoot, 'logs', file);
  const fileStats = await stat(absolute).catch(() => null);
  if (!fileStats) return null;
  const cached = sessionCache.get(absolute);
  if (cached && cached.size === fileStats.size && cached.mtimeMs === fileStats.mtimeMs) {
    return cached.parsed;
  }
  let raw: string;
  try {
    raw = await readFile(absolute, 'utf-8');
  } catch {
    return null;
  }
  const parsed = parsePlayLogText(raw, {
    file,
    fallbackEndedAt: fileStats.mtimeMs,
    recordingUrl: (sessionId) =>
      `/__editor/gameplay-sessions/${encodeURIComponent(sessionId)}/recording`,
  });
  sessionCache.set(absolute, { size: fileStats.size, mtimeMs: fileStats.mtimeMs, parsed });
  return parsed;
}

async function readGameplaySession(
  projectRoot: string,
  file: string,
  activeLogFile: string | null,
): Promise<GameplaySessionRecord | null> {
  const parsed = await parseGameplaySession(projectRoot, file);
  return parsed
    ? materializeGameplaySession(parsed, {
        activeLogBaseName: activeLogFile === null ? null : basename(activeLogFile),
        now: Date.now(),
      })
    : null;
}

export async function listGameplaySessions(
  projectRoot: string,
  activeLogFile: string | null,
): Promise<GameplaySessionRecord[]> {
  const files = await readdir(join(projectRoot, 'logs')).catch(() => []);
  const playFiles = files
    .filter((file) => file.startsWith('play-') && file.endsWith('.jsonl'))
    .sort()
    .reverse();
  const livePaths = new Set(playFiles.map((file) => join(projectRoot, 'logs', file)));
  for (const cachedPath of sessionCache.keys()) {
    if (!livePaths.has(cachedPath)) sessionCache.delete(cachedPath);
  }
  const sessions = await Promise.all(
    playFiles.map((file) => readGameplaySession(projectRoot, file, activeLogFile)),
  );
  return sessions.filter((session): session is GameplaySessionRecord => session !== null);
}

/** Metadata-only catalog for the one-second rail poll. Entries are fetched
 * only for the selected session, so twenty long runs never cross the wire on
 * every live-edge update. */
export async function listGameplaySessionCatalog(
  projectRoot: string,
  activeLogFile: string | null,
): Promise<GameplaySessionRecord[]> {
  const sessions = await listGameplaySessions(projectRoot, activeLogFile);
  return sessions.map((session) => ({ ...session, entries: [] }));
}

export async function getGameplaySession(
  projectRoot: string,
  id: string,
  activeLogFile: string | null,
): Promise<GameplaySessionRecord | null> {
  if (basename(id) !== id || !id.startsWith('play-')) return null;
  return readGameplaySession(projectRoot, `${id}.jsonl`, activeLogFile);
}

export function gameplaySessionRecordingPath(
  projectRoot: string,
  session: GameplaySessionRecord,
): string | null {
  const file = session.recording?.file;
  if (!file || basename(file) !== file) return null;
  return join(projectRoot, '.vgai', 'recordings', file);
}
