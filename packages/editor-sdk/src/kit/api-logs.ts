/**
 * Play-mode console log persistence — agent/CLI-tooling introspection, so it
 * is bucketed with the CLI control channel.
 */

import { assertEditorServerResponse, editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';
import { BASE } from '@volter/editor-sdk/kit/api-base';
// ---------------------------------------------------------------------------
// Play-mode console log persistence
// ---------------------------------------------------------------------------

export interface LogEntry {
  t: number;
  level: string;
  source?: string;
  sub?: string;
  msg: string;
  meta?: Record<string, unknown>;
  /** Engine fixed-step counter at write time —
   *  present only while a live play session's debug seam can be read, so
   *  entries correlate frame-exactly with `ctx.debug.emit` events. */
  tick?: number;
  /** Accumulated sim-seconds at write time — same source as `tick`. */
  simT?: number;
  /** The world this run was presenting when the entry was written. Present
   *  only once the run's roots have mounted and a world is unambiguous (see
   *  `play-mode.ts`'s `playLogRunStamp`) — entries written during boot, and
   *  runs that present no world at all, honestly carry none. */
  world?: string;
  /** The loop's live time scale at write time (`game.loop.timeScale`) — 1 is
   *  real time, 0 is paused, and an instrument can change it mid-run, which is
   *  exactly why it is per-entry and not in the file's identity header. */
  simSpeed?: number;
}

/** Start a new log session. Returns the filename, or null on failure.
 *  Browser mode writes the SAME `logs/play-*.jsonl` record through the
 *  StorageBackend (`play-log/browser-play-log.ts`) — the Analytics utility's
 *  Gameplay Sessions read it, and a downloaded project carries its history —
 *  while a staged example/ingest stays a no-op (no storage home). */
export async function startLogSession(name?: string | null): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/log-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `name` (optional — `vgai play --name <text>`) is passed through RAW;
      // the server owns the slugifier, so there is exactly one definition of
      // what the run is called on disk and in the journal.
      body: JSON.stringify({ action: 'start', ...(name ? { name } : {}) }),
    });
    const data = await editorServerJson<{ ok: boolean; file: string }>(
      res,
      'Could not start a play log session',
    );
    return data.file;
  } catch {
    return null;
  }
}

/** End the current log session. Browser mode closes the storage-backed log. */
export async function endLogSession(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/log-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'end' }),
    });
    assertEditorServerResponse(res, 'Could not end the play log session');
  } catch {
    /* best-effort */
  }
}

/** Flush a batch of log entries. Browser mode appends to the storage-backed
 *  log (never a network call — this runs on a `setInterval` while Play is
 *  running, and a dead endpoint here is the retry-loop anti-pattern A2's SSE
 *  guards exist to avoid). */
export async function flushLogEntries(entries: LogEntry[]): Promise<boolean> {
  if (entries.length === 0) return true;
  try {
    const res = await fetch(`${BASE}/log-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    assertEditorServerResponse(res, 'Could not flush play log entries');
    return true;
  } catch {
    return false;
  }
}
