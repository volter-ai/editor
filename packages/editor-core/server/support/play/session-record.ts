/**
 * The Gameplay Session RECORD, as pure functions over the play log's text.
 * The server derives the catalog from `logs/*.jsonl` on disk
 * (`server/gameplay-sessions.ts`, which keeps its stat-keyed cache and fs
 * wiring and calls in here); the functions themselves touch no filesystem, so
 * the rules live in one place. They are subtle enough to fork badly — the
 * torn live-append tail, the
 * `ended` marker, the three-message recording lifecycle — which is why they
 * live HERE and nowhere twice.
 *
 * Also home to the retention budgets, for the same reason: two copies of a
 * byte budget is how two readers start keeping different histories.
 */

import { asPlayLogHeader } from './log-format';

/** Structured logs are the durable Analytics source. At the current event
 * density this keeps hundreds of substantial sessions, without allowing one
 * project to grow forever. */
export const GAMEPLAY_SESSION_LOG_BUDGET_BYTES = 256 * 1024 * 1024;

/** Automatically named session clips are working evidence, not keepsakes.
 * Two GiB provides a useful history while making long recordings pay their
 * actual disk cost. Explicitly named recordings are outside this budget. */
export const GAMEPLAY_SESSION_CLIP_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;

export interface GameplaySessionRecording {
  readonly format: 'composite-webm' | 'canvas-dom';
  readonly replay: string | null;
  readonly file: string;
  readonly url: string;
  readonly startedAt: number | null;
  readonly finalized: boolean;
  readonly bytes: number | null;
}

export interface GameplaySessionRecord {
  readonly id: string;
  readonly run: string | null;
  readonly status: 'live' | 'completed';
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly durationMs: number;
  readonly logFile: string;
  readonly entries: readonly Record<string, unknown>[];
  readonly recording: GameplaySessionRecording | null;
}

export interface ParsedGameplaySession {
  readonly id: string;
  readonly run: string | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly logFile: string;
  readonly entries: readonly Record<string, unknown>[];
  readonly recording: GameplaySessionRecording | null;
  readonly fallbackEndedAt: number;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A bare filename — no path separators. The same refusal the server's
 *  `basename(file) !== file` check made, path-module-free. */
function isBareFilename(file: string): boolean {
  return file.length > 0 && !file.includes('/') && !file.includes('\\');
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is a small single-pass reducer over three recording lifecycle messages.
function recordingEvent(
  entries: readonly Record<string, unknown>[],
): Omit<GameplaySessionRecording, 'url'> | null {
  type RecordingState = Omit<GameplaySessionRecording, 'url'>;
  let current: RecordingState | null = null;
  for (const entry of entries) {
    if (entry['source'] !== 'gameplay-recording') continue;
    const meta = entry['meta'];
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) continue;
    const fields = meta as Record<string, unknown>;
    const file = fields['file'];
    if (typeof file !== 'string' || !isBareFilename(file)) continue;
    if (entry['msg'] === 'started') {
      current = {
        file,
        format: fields['format'] === 'canvas-dom' ? 'canvas-dom' : 'composite-webm',
        replay: null,
        startedAt: numberField(fields['startedAt']),
        finalized: false,
        bytes: null,
      };
    } else if (entry['msg'] === 'finalized') {
      const existing = current as RecordingState | null;
      if (existing?.file === file) {
        current = {
          ...existing,
          finalized: true,
          bytes: numberField(fields['bytes']),
          replay:
            typeof fields['replay'] === 'string' && isBareFilename(fields['replay'])
              ? fields['replay']
              : null,
        };
      }
    } else if (
      (current as RecordingState | null)?.file === file &&
      (entry['msg'] === 'aborted' || entry['msg'] === 'evicted')
    ) {
      current = null;
    }
  }
  return current;
}

export interface ParsePlayLogOptions {
  /** The log's bare filename, e.g. `play-2026-…-0001.jsonl`. */
  readonly file: string;
  /** What "ended" means when the log carries no `ended` marker (a crashed
   *  run): the file's own last-modified time on tiers that know it, or the
   *  read time otherwise. */
  readonly fallbackEndedAt: number;
  /** How this tier addresses the session's recording, when one survives the
   *  lifecycle reduce — the server serves a route, the browser has none. */
  readonly recordingUrl: (sessionId: string, recordingFile: string) => string;
}

/**
 * Parse one play log's raw text into the session record's parsed half, or
 * `null` when the first line is not a play-log identity header (any other
 * JSONL in `logs/` is not a session).
 */
export function parsePlayLogText(
  raw: string,
  options: ParsePlayLogOptions,
): ParsedGameplaySession | null {
  const records: unknown[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line) as unknown);
    } catch {
      // A live append may expose a torn tail. Everything before it remains a
      // valid session record and the next poll will pick up the completed row.
    }
  }
  const header = asPlayLogHeader(records[0]);
  if (!header) return null;
  const entries = records
    .slice(1)
    .filter(
      (value): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && !Array.isArray(value),
    );
  const end = [...entries]
    .reverse()
    .find((entry) => entry['source'] === 'gameplay-session' && entry['msg'] === 'ended');
  const endMeta =
    typeof end?.['meta'] === 'object' && end['meta'] !== null && !Array.isArray(end['meta'])
      ? (end['meta'] as Record<string, unknown>)
      : null;
  const recording = recordingEvent(entries);
  const id = options.file.replace(/\.[^.]*$/, '');
  return {
    id,
    run: header.run,
    startedAt: header.startedAt,
    endedAt: numberField(endMeta?.['endedAt']),
    fallbackEndedAt: options.fallbackEndedAt,
    logFile: `logs/${options.file}`,
    entries,
    recording: recording ? { ...recording, url: options.recordingUrl(id, recording.file) } : null,
  };
}

/**
 * Project a parsed session against the tier's live state: the active log (if
 * this is it, the session is `live` and its edge is `now`) or the recorded /
 * fallback end.
 */
export function materializeGameplaySession(
  parsed: ParsedGameplaySession,
  options: { readonly activeLogBaseName: string | null; readonly now: number },
): GameplaySessionRecord {
  const active =
    options.activeLogBaseName !== null && parsed.logFile === `logs/${options.activeLogBaseName}`;
  const endedAt = active ? null : (parsed.endedAt ?? parsed.fallbackEndedAt);
  const liveEdge = active ? options.now : (endedAt ?? parsed.fallbackEndedAt);
  return {
    id: parsed.id,
    run: parsed.run,
    status: active ? 'live' : 'completed',
    startedAt: parsed.startedAt,
    endedAt,
    durationMs: Math.max(0, liveEdge - parsed.startedAt),
    logFile: parsed.logFile,
    entries: parsed.entries,
    recording: parsed.recording,
  };
}
