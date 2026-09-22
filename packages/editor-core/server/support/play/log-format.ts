/**
 * THE on-disk shape of `<project>/logs/play-*.jsonl` — one definition, shared
 * by the writer (`editor-server.ts`'s `/__editor/log-session` +
 * `/__editor/log-entries` handlers) and every reader (`play.log.*` here,
 * `vgai status`'s play-error banner, the project Analytics utility).
 *
 * A play log is JSONL with TWO record kinds:
 *
 *   1. THE HEADER — always the FIRST line, written when the file is opened:
 *      `{"kind":"session","v":1,"session":…,"project":…,"run":…,"startedAt":…}`.
 *      This is where the run's IDENTITY lives, recorded ONCE. The alternative
 *      (stamping session/project onto every entry) pays the same constant
 *      thousands of times per run for facts that cannot change while the file
 *      is open — the file is opened by one session, for one project, at one
 *      instant.
 *   2. ENTRIES — every later line: `{t, level, source?, sub?, msg, meta?,
 *      tick?, simT?, world?, simSpeed?}`. Only genuinely per-entry facts go
 *      here: `tick`/`simT` (the frame the line was written on), `simSpeed`
 *      (the live time scale, which an instrument can change mid-run) and
 *      `world` (the world the run is presenting, unknown until the roots
 *      mount — so the entries written during boot honestly carry none).
 *
 * A reader must SKIP the header when counting or listing entries
 * (`asPlayLogHeader` is the one test), and must tolerate its ABSENCE: logs
 * written before the header existed are still on disk in real projects, and
 * "no header" means "this run's identity was never recorded", never an error.
 */

/** `kind` value marking a play log's header line. */
export const PLAY_LOG_HEADER_KIND = 'session';

/** Bumped only when the on-disk record shapes change incompatibly. */
export const PLAY_LOG_FORMAT_VERSION = 1;

/** The run identity a play log carries on its first line. */
export interface PlayLogHeader {
  readonly kind: typeof PLAY_LOG_HEADER_KIND;
  readonly v: number;
  /** The editor session that opened the file (`processSessionId()`) — the same
   *  id `vgai sessions` lists, so a log file names the session that wrote it. */
  readonly session: string;
  /** Absolute project root the session was serving. */
  readonly project: string;
  /** The run's slug (`vgai play --name <text>`), `null` for an unnamed run —
   *  the same slug that goes in the filename and the session journal. */
  readonly run: string | null;
  /** Wall-clock ms at which the file was opened. */
  readonly startedAt: number;
}

/** The header line (newline included) for a run's identity. */
export function playLogHeaderLine(identity: Omit<PlayLogHeader, 'kind' | 'v'>): string {
  const header: PlayLogHeader = {
    kind: PLAY_LOG_HEADER_KIND,
    v: PLAY_LOG_FORMAT_VERSION,
    ...identity,
  };
  return `${JSON.stringify(header)}\n`;
}

/** The parsed header, or `null` when this record is an ordinary entry (or a
 *  header from an unreadable/older shape). Every reader's one header test. */
export function asPlayLogHeader(record: unknown): PlayLogHeader | null {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return null;
  const rec = record as Record<string, unknown>;
  if (rec['kind'] !== PLAY_LOG_HEADER_KIND) return null;
  if (typeof rec['session'] !== 'string' || typeof rec['project'] !== 'string') return null;
  return {
    kind: PLAY_LOG_HEADER_KIND,
    v: typeof rec['v'] === 'number' ? rec['v'] : 0,
    session: rec['session'],
    project: rec['project'],
    run: typeof rec['run'] === 'string' ? rec['run'] : null,
    startedAt: typeof rec['startedAt'] === 'number' ? rec['startedAt'] : 0,
  };
}
