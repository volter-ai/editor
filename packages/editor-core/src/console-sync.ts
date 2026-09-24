import { type ConsoleEntry, editorConsole, installEditorConsoleCapture } from '@volter/editor-sdk/kit/editor-console';
import { EDITOR_CLIENT_ID, sendControl } from './editor-presence';

/**
 * Push every console ERROR and WARNING this page sees to the server's
 * unresolved-console ledger (`server/console-ledger.ts`).
 *
 * This is the page's whole obligation under the loudness convention, and it is
 * deliberately dumb: it reports OCCURRENCE DELTAS and keeps no opinion about
 * what matters. The page cannot be the owner of that set — it dies with the
 * tab, and a reload wipes it — so the page's job is only to say what it saw,
 * and the server's job is to remember.
 *
 * Deltas, not totals: `editorConsole` collapses consecutive identical messages
 * onto one entry by bumping its `count`, so the ONLY faithful report of a
 * message that fired 400 times is "+397 since I last spoke". Sending totals
 * would make two page-loads of the same condition race each other instead of
 * summing, and sending one message per firing would put a flood on the wire.
 *
 * Info-level entries are not reported. The contract is errors and warnings —
 * the two severities that must stop an agent — and `logs/play-*.jsonl` already
 * carries the full narrative for a run.
 *
 * CAPTURE AND REPORTING ARE ONE ACT — {@link installEditorConsoleReporting} —
 * and that is why this file installs the capture rather than merely consuming
 * it. Measured 2026-09-19 (U6b's Model-workspace walk): a boot path that
 * called `installEditorConsoleCapture()` WITHOUT the `installConsoleSync()`
 * line that stood next to it. So 44 React duplicate-key
 * errors filled the page console and the bottom bar's counter while
 * `vgai console` reported a clean session — the one outcome the loudness
 * convention exists to prevent, arrived at by a single omitted line in a
 * two-line sequence. Two lines a caller must remember to write together are a
 * defect in the door, not in the caller; there is now one door, and it cannot
 * be half-called.
 */

/** Coalescing window. A render error cascade fires dozens of entries in one
 *  frame; they must arrive as one batch, not one request each. */
const FLUSH_MS = 250;

/**
 * THE ONE DOOR. Capture the session's console AND report it to the server's
 * ledger — the editor's whole obligation under the loudness convention, in one
 * call that cannot be half-made.
 *
 * Every host that boots the editor calls THIS: `main.tsx`, and the fork's
 * bridge. `installEditorConsoleCapture` alone leaves a page whose errors are
 * visible only to somebody LOOKING at the editor, which is exactly what the
 * convention forbids.
 */
export function installEditorConsoleReporting(): () => void {
  const stopCapture = installEditorConsoleCapture();
  const stopSync = installConsoleSync();
  return () => {
    stopSync();
    stopCapture();
  };
}

export function installConsoleSync(): () => void {
  /** Occurrences already reported, per `editorConsole` entry id. */
  const reported = new Map<number, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let released = false;

  function collect(): Array<{
    severity: 'error' | 'warn';
    message: string;
    source: string | null;
    occurrences: number;
  }> {
    const batch: Array<{
      severity: 'error' | 'warn';
      message: string;
      source: string | null;
      occurrences: number;
    }> = [];
    const live = new Set<number>();
    for (const entry of editorConsole.getEntries() as readonly ConsoleEntry[]) {
      live.add(entry.id);
      if (entry.level !== 'error' && entry.level !== 'warn') continue;
      const already = reported.get(entry.id) ?? 0;
      if (entry.count <= already) continue;
      reported.set(entry.id, entry.count);
      batch.push({
        severity: entry.level,
        message: entry.message,
        source: entry.source ?? null,
        occurrences: entry.count - already,
      });
    }
    // The store is a ring buffer; an evicted entry's id can never come back
    // (ids are monotonic), so its bookkeeping goes with it.
    for (const id of [...reported.keys()]) if (!live.has(id)) reported.delete(id);
    return batch;
  }

  function flush(): void {
    timer = null;
    if (released) return;
    const entries = collect();
    if (entries.length === 0) return;
    // `_clientId` IS the page-load id the ledger fences its clearing rule on.
    // The socket path overwrites it with the connection's own id (a tab cannot
    // speak for another); the POST fallback has only what the page declares.
    void sendControl('console-entries', { entries, _clientId: EDITOR_CLIENT_ID });
  }

  const unsubscribe = editorConsole.subscribe(() => {
    if (released || timer !== null) return;
    timer = setTimeout(flush, FLUSH_MS);
  });

  // ANNOUNCE, even with nothing to say. An empty batch is how this page tells
  // the server it has a reporter at all, which is the fact the server needs to
  // tell "no errors" apart from "no reporter" — the two look identical from the
  // ledger, and U6b spent a walk inside that ambiguity. See
  // `routes/control-plane.ts`'s `armConsoleReporterWatch`.
  void sendControl('console-entries', { entries: [], _clientId: EDITOR_CLIENT_ID });
  // Whatever was already captured before this installed (boot-time errors from
  // the pre-module bootstrap and from `installEditorConsoleCapture`) is part of
  // the session too — report it immediately rather than waiting for the next
  // one to arrive.
  flush();

  return () => {
    released = true;
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
  };
}
