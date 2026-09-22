/**
 * Debounced, content-aware restart gate for the dev host's engine-source
 * watcher (editor-session diagnosis cause 4). The watcher used to hand ANY
 * chokidar event straight to the exit-75 restart handoff, which produced
 * back-to-back restart storms for an actively-editing agent: a multi-file
 * save burst restarted once per file (each relaunch caught the next event),
 * and mtime-only touches / git branch switches restoring identical bytes
 * restarted a process whose imported modules were not actually stale — the
 * "zombie-tab reload loop". Two minimal suppressions, without changing what
 * counts as watched:
 *
 * - **Content check**: each watched file's content hash is baselined during
 *   the watcher's initial scan and refreshed as events arrive; an event
 *   whose bytes match the last-seen hash is ignored entirely (only different
 *   bytes stale the Node process's imports). Unreadable/deleted paths hash
 *   to null and are treated as changed, so deletions still restart.
 * - **Debounce**: a real change (re)arms a short quiet-window timer; the
 *   restart callback fires ONCE, after the burst goes quiet, reporting the
 *   burst's FIRST change (matching the old first-event-wins staleSource
 *   semantics). Once fired, the gate is latched — the process is exiting.
 *
 * Hashing and timers are injectable so the decision logic is unit-testable
 * without filesystem or clock choreography (test-proportionality policy).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface EngineSourceChange {
  changedPath: string;
  changedAt: string;
}

/** sha256 of a file's bytes, or null when unreadable (deleted, a directory,
 *  permission). Callers treat null as "changed" — a vanished source file
 *  stales imports exactly like different bytes do. */
export function hashFileContent(file: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

export interface EngineSourceRestartGate {
  /** Record a file's boot-time content during the watcher's initial scan
   *  (chokidar's pre-`ready` add events) — served content IS boot content,
   *  since any earlier change already restarted the previous process. */
  recordBaseline(file: string): void;
  /** Handle a post-scan watcher event; arms/re-arms the quiet-window timer
   *  when the file's content actually differs from the last-seen bytes. */
  handleEvent(event: string, file: string): void;
  /** Cancel any pending restart (shutdown path). */
  dispose(): void;
}

export function createEngineSourceRestartGate(options: {
  onRestart: (change: EngineSourceChange) => void;
  /** Quiet window a burst must go silent for before the single restart fires. */
  quietMs?: number;
  hashFile?: (file: string) => string | null;
  /** Timer seam (opaque handle) so tests drive the quiet window directly. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  now?: () => Date;
}): EngineSourceRestartGate {
  const quietMs = options.quietMs ?? 1000;
  const hashFile = options.hashFile ?? hashFileContent;
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as NodeJS.Timeout));
  const now = options.now ?? (() => new Date());

  /** file -> last-seen content hash (baseline scan, then refreshed per event). */
  const lastSeen = new Map<string, string>();
  let pending: EngineSourceChange | null = null;
  let timer: unknown = null;
  let fired = false;

  const fire = (): void => {
    timer = null;
    if (fired || pending === null) return;
    fired = true;
    options.onRestart(pending);
  };

  return {
    recordBaseline(file: string): void {
      const hash = hashFile(file);
      if (hash !== null) lastSeen.set(file, hash);
    },
    handleEvent(event: string, file: string): void {
      if (fired) return;
      if (event === 'unlink' || event === 'unlinkDir') {
        // Deletions are always real changes (old any-event behavior kept);
        // drop the hash so a later re-add with identical bytes still counts
        // as a change relative to "the file was gone".
        lastSeen.delete(file);
      } else {
        const hash = hashFile(file);
        if (hash !== null && hash === lastSeen.get(file)) return; // mtime-only touch
        if (hash !== null) lastSeen.set(file, hash);
        else lastSeen.delete(file);
      }
      if (pending === null) {
        pending = { changedPath: file, changedAt: now().toISOString() };
      }
      if (timer !== null) clearTimer(timer);
      timer = setTimer(fire, quietMs);
    },
    dispose(): void {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
