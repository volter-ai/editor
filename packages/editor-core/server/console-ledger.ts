/**
 * THE UNRESOLVED CONSOLE SET — the session's errors and warnings, held by the
 * SERVER so they outlive the page that reported them.
 *
 * Why this exists at all (owner convention, measured failure 2026-08-14): the
 * editor console's errors and warnings must chase an agent through every
 * `vgai` invocation, so that nobody ever has to LOOK at the editor to learn a
 * session has errors. Before this, every fact about them lived in the browser:
 * `editor-console.ts`'s ring buffer, summarized to a `{count, recent[]}` facet
 * the page POSTed with its state. That has three fatal properties for the
 * convention:
 *
 *  1. **Tab death destroys the record.** A killed renderer takes the ring
 *     buffer with it; a session with eleven errors reported one journal row
 *     and then nothing.
 *  2. **A reload silently resets it** — the store is module state, so the
 *     count went to zero whether or not the condition was fixed.
 *  3. **Repeats deduped to silence.** The page collapses consecutive identical
 *     messages onto one entry; a message that fired 400 times and a message
 *     that fired once looked the same downstream.
 *
 * So the durable set lives here. The page reports OCCURRENCE DELTAS; this
 * ledger keys them by fingerprint and SUMS. Nothing is ever dropped for being
 * a repeat — the repeat becomes a count.
 *
 * CLEARING IS DELIBERATELY HARD (there is no auto-expiry, and reconnecting is
 * not a reset):
 *
 *  (a) **The page reloads and the condition does not recur.** A reload is the
 *      one event that re-runs the code that errored, so it is the one honest
 *      re-test. `noteLoad` records the new page-load; an entry last seen in an
 *      OLDER load retires once the new load has been settled for
 *      {@link LOAD_SETTLE_MS}. If it recurs, the same fingerprint is observed
 *      again under the new load id and its count keeps climbing.
 *  (b) **Somebody acknowledges it by name**, with a reason — `vgai console ack
 *      <id> --reason "..."`. That still leaves the entry here (acked, with who
 *      and why) and a `console-ack` row in the session journal. An
 *      acknowledgment is an audit record, not an erasure.
 *  (c) **The condition's OWNER proves it resolved** — {@link ConsoleLedger.resolve}.
 *      Rule (a) reads a page reload as the one honest re-test, and for
 *      page-scoped conditions it is. But some conditions are resolved by an
 *      event that is not a page load, and then rule (a) can never see it:
 *      measured 2026-08-29, `[play-mode] Restart required: X changed` survived
 *      `vgai restart` forever — the remount genuinely cleared the staleness
 *      (`clearRestartRequired` runs in `enterPlayMode`), but a remount is not a
 *      page load, so the ledger had no door to learn it and only
 *      `game.reloadPage()` could silence a warning whose own named verb had
 *      already fixed it. A named verb must be able to clear its own named
 *      condition. This door is for the code that RAISED a condition and knows
 *      the moment it is gone — never a general "clear the console".
 *
 * Pure and clock-injected — no I/O, no timers, no globals — so
 * `packages/editor/test/console-ledger.test.ts` drives every one of those
 * transitions directly.
 */

export type ConsoleSeverity = 'error' | 'warn';

/** One occurrence report from a page. `occurrences` is a DELTA: the page sends
 *  how many times this fired since its last report, never a running total, so
 *  two pages reporting the same condition sum instead of racing. */
export interface ConsoleObservation {
  readonly severity: ConsoleSeverity;
  readonly message: string;
  readonly source?: string | null;
  readonly occurrences?: number;
  /** The page-load (control-connection client id) that saw it. */
  readonly loadId: string;
  readonly at?: number;
}

export interface ConsoleAck {
  readonly at: number;
  readonly by: string;
  readonly reason: string;
}

export interface ConsoleLedgerEntry {
  /** Stable across restarts and across pages: a hash of severity+message
   *  (source is attribution, not identity — see {@link consoleEntryId}), so
   *  `vgai console ack <id>` names the CONDITION, not a serial number. */
  readonly id: string;
  readonly severity: ConsoleSeverity;
  readonly message: string;
  readonly source: string | null;
  /** Total occurrences observed, summed across every page-load. */
  readonly count: number;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly firstLoadId: string;
  readonly lastLoadId: string;
  readonly acked: ConsoleAck | null;
}

/** The counts every CLI response envelope carries. Distinct CONDITIONS in
 *  `errors`/`warnings`; total firings in the `*Occurrences` pair, because "3
 *  errors" and "3 errors that fired 900 times" are different situations and
 *  the banner says both. */
export interface UnresolvedConsoleSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly errorOccurrences: number;
  readonly warningOccurrences: number;
  readonly acked: number;
  /** Distinct conditions evicted by {@link MAX_ENTRIES}. Never silent: the
   *  banner says so, because a dropped error is exactly what this file exists
   *  to prevent. */
  readonly dropped: number;
  /**
   * WHEN THESE COUNTS WERE COUNTED. The banner that prints them is assembled
   * once per CLI process and re-printed at exit, and the counts can arrive by
   * two routes with different ages (a preflight GET before the verb ran, a
   * command envelope after it), so a banner with no time on it invites the
   * reader to treat whichever one they saw as current. The CLI subtracts this
   * from its own clock and prints the age; see `console-loudness.ts`.
   */
  readonly measuredAt: number;
}

export type ConsoleLedgerJournalEvent =
  | {
      readonly kind: 'console-entry';
      readonly id: string;
      readonly severity: ConsoleSeverity;
      readonly source: string | null;
      readonly added: number;
      readonly count: number;
      readonly message: string;
    }
  | {
      readonly kind: 'console-retired';
      readonly id: string;
      readonly severity: ConsoleSeverity;
      readonly count: number;
      readonly message: string;
    }
  | {
      readonly kind: 'console-ack';
      readonly id: string;
      readonly severity: ConsoleSeverity;
      readonly count: number;
      readonly by: string;
      readonly reason: string;
      readonly message: string;
    }
  | {
      readonly kind: 'console-resolved';
      readonly id: string;
      readonly severity: ConsoleSeverity;
      readonly count: number;
      /** The owner that proved it gone — `play-mode`, never a person. */
      readonly by: string;
      readonly message: string;
    };

/**
 * How long a NEW page-load must have been settled before entries that only the
 * PREVIOUS load saw are retired. Long enough that a boot-time error has fired
 * again (the editor's own boot is well under a second), short enough that a
 * genuine fix is visible on the next command.
 */
export const LOAD_SETTLE_MS = 4_000;

/** Distinct conditions retained. Occurrences of a retained condition are
 *  unbounded (they are a counter); it is the number of DIFFERENT messages that
 *  needs a ceiling, and a game logging 500 distinct errors has already made
 *  the point. */
const MAX_ENTRIES = 500;
const MESSAGE_MAX_CHARS = 4_000;

/** Remove tokens that name an OCCURRENCE rather than a condition. Kept narrow:
 * ordinary numbers, entity ids, paths and line numbers remain significant;
 * only timestamp/cache-buster forms, UUIDs, and explicitly labelled
 * transport/job ids collapse. The original text is still what the ledger
 * displays and journals. */
export function normalizeConsoleFingerprintText(text: string): string {
  return (
    text
      .replace(
        /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
        '<timestamp>',
      )
      .replace(/\b1\d{12}\b/g, '<timestamp-ms>')
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
        '<uuid>',
      )
      .replace(/([?&](?:t|v)=)\d{8,}/gi, '$1<cache-buster>')
      .replace(
        /\b((?:request|session|client|load|tab|operation|job|trace|event)(?:[-_ ]?id)?\s*(?::|=|\bis\b)\s*)(["']?)[a-z0-9][a-z0-9._:-]{5,}\2/gi,
        '$1<volatile-id>',
      )
      // A client-instance ordinal after an @-tagged identity names an
      // OCCURRENCE, not a condition: Supabase logs `GoTrueClient@<key>:1`,
      // `:2`, `:3`… — one per module-graph evaluation — and each ordinal minted
      // a distinct ledger id, so ONE standing fact demanded four separate acks
      // (measured on racing's doctor walk). `@` is required so `file.ts:103`
      // line references stay condition-significant.
      .replace(/(@[\w.-]+):\d+\b/g, '$1:<instance>')
  );
}

/** FNV-1a over normalized severity|message → 8 lowercase hex chars.
 * Short enough to type into `vgai console ack`, wide enough that a session's
 * few hundred conditions never collide.
 *
 * Source is deliberately NOT part of the fingerprint. The CONDITION is what
 * fired (severity + message); WHO it belongs to is an attribute the capture
 * learns about it, and that learning is best-effort — a game library's warn
 * deferred into a promise microtask reaches the console capture with no
 * game-realm marker on the stack (there is no async-context door in the
 * platform), so one standing fact can arrive labelled 'editor' on some
 * occurrences and 'game' on others. Keying the id on source split that one
 * fact into two rows demanding two separate acks (measured: racing's
 * GoTrueClient warning). One condition, one id; the row's `source` keeps the
 * strongest attribution any occurrence proved — see the observe() rule. */
export function consoleEntryId(severity: ConsoleSeverity, message: string): string {
  const key = `${severity}|${normalizeConsoleFingerprintText(message)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

interface MutableEntry {
  id: string;
  severity: ConsoleSeverity;
  message: string;
  source: string | null;
  count: number;
  firstAt: number;
  lastAt: number;
  firstLoadId: string;
  lastLoadId: string;
  acked: ConsoleAck | null;
}

export interface ConsoleLedger {
  /** Record one occurrence delta. Returns the entry as it now stands. */
  observe(observation: ConsoleObservation): ConsoleLedgerEntry;
  /** A page-load became the current one (its command listener attached). Starts
   *  the settle window that retires conditions the previous load owned. */
  noteLoad(loadId: string, at?: number): void;
  /** Acknowledge by id, with who and why. `null` when no such entry. */
  ack(id: string, ack: { by: string; reason: string; at?: number }): ConsoleLedgerEntry | null;
  /**
   * Clearing rule (c) — the condition's OWNER proves it resolved. Named by the
   * severity+message it was raised with, so the caller never has to reproduce
   * this module's fingerprint hash. Returns the ids actually retired.
   *
   * An ACKED entry is left alone: that record carries a human's reason and
   * retiring it would erase it (same rule the page-load sweep follows).
   *
   * NO TIMESTAMP FENCE, deliberately. A recurrence is reported through the same
   * control connection this call arrives on, so a condition that fires again
   * after the owner declared it gone is observed AFTER this and simply
   * re-created — the ordering does the fencing, and a clock the page and the
   * server would have to agree on does not exist.
   */
  resolve(
    conditions: readonly { severity: ConsoleSeverity; message: string }[],
    by: string,
  ): string[];
  /** Unresolved conditions (never acked, not retired), oldest first. */
  unresolved(): ConsoleLedgerEntry[];
  /** Everything still held, acked included — what `vgai console --all` shows. */
  all(): ConsoleLedgerEntry[];
  summary(): UnresolvedConsoleSummary;
}

export function createConsoleLedger(options?: {
  readonly now?: () => number;
  readonly journal?: (event: ConsoleLedgerJournalEvent) => void;
}): ConsoleLedger {
  const now = options?.now ?? Date.now;
  const journal = options?.journal ?? ((): void => {});
  const entries = new Map<string, MutableEntry>();
  let currentLoadId: string | null = null;
  let currentLoadAt = 0;
  let dropped = 0;

  /** Retire what condition (a) covers: last seen in an older page-load, and the
   *  current load has been settled long enough that a recurrence would already
   *  have been reported. Runs on every read so no caller can see a stale set. */
  function sweep(): void {
    if (currentLoadId === null) return;
    if (now() - currentLoadAt < LOAD_SETTLE_MS) return;
    for (const entry of [...entries.values()]) {
      if (entry.lastLoadId === currentLoadId) continue;
      // An entry observed at-or-after the current load began belongs to a page
      // that raced ahead of (or never reached) command-listener attach — a
      // fresh boot error, or a guest tab that can never attach. Retiring it
      // would silence a live condition forever, because the page-side delta
      // bookkeeping never re-reports an occurrence it already sent.
      if (entry.lastAt >= currentLoadAt) continue;
      // An acked entry is an audit record; retiring it would erase the reason.
      if (entry.acked !== null) continue;
      entries.delete(entry.id);
      journal({
        kind: 'console-retired',
        id: entry.id,
        severity: entry.severity,
        count: entry.count,
        message: entry.message,
      });
    }
  }

  function snapshot(entry: MutableEntry): ConsoleLedgerEntry {
    return { ...entry };
  }

  return {
    observe(observation: ConsoleObservation): ConsoleLedgerEntry {
      const at = observation.at ?? now();
      const message = observation.message.slice(0, MESSAGE_MAX_CHARS);
      const source = observation.source ?? null;
      const added = Math.max(1, Math.trunc(observation.occurrences ?? 1));
      const id = consoleEntryId(observation.severity, message);
      const existing = entries.get(id);
      if (existing) {
        // The id names the normalized condition; retain the newest raw detail
        // so UUID/timestamp normalization never makes the human-facing record
        // stale or vague.
        existing.message = message;
        // Keep the STRONGEST attribution any occurrence proved. 'editor' is
        // the capture's default label (least evidence — see consoleEntryId's
        // note on why one fact can arrive under two labels), so it never
        // overwrites a specific one; between specific sources, newest wins.
        existing.source =
          source === null || (source === 'editor' && existing.source !== null)
            ? existing.source
            : source;
        existing.count += added;
        existing.lastAt = at;
        existing.lastLoadId = observation.loadId;
        journal({
          kind: 'console-entry',
          id,
          severity: existing.severity,
          source,
          added,
          count: existing.count,
          message,
        });
        return snapshot(existing);
      }
      if (entries.size >= MAX_ENTRIES) {
        // Evict the oldest ACKED record first — it has already been read and
        // reasoned about. Only when there is no such record does an unresolved
        // one go, and that is counted and reported, never silent.
        const victim =
          [...entries.values()]
            .filter((e) => e.acked !== null)
            .sort((a, b) => a.lastAt - b.lastAt)[0] ??
          [...entries.values()].sort((a, b) => a.lastAt - b.lastAt)[0];
        if (victim) {
          entries.delete(victim.id);
          if (victim.acked === null) dropped++;
        }
      }
      const entry: MutableEntry = {
        id,
        severity: observation.severity,
        message,
        source,
        count: added,
        firstAt: at,
        lastAt: at,
        firstLoadId: observation.loadId,
        lastLoadId: observation.loadId,
        acked: null,
      };
      entries.set(id, entry);
      journal({
        kind: 'console-entry',
        id,
        severity: entry.severity,
        source,
        added,
        count: added,
        message,
      });
      return snapshot(entry);
    },

    noteLoad(loadId: string, at?: number): void {
      if (loadId === currentLoadId) return;
      currentLoadId = loadId;
      currentLoadAt = at ?? now();
    },

    ack(id: string, ack: { by: string; reason: string; at?: number }): ConsoleLedgerEntry | null {
      const entry = entries.get(id);
      if (!entry) return null;
      entry.acked = { at: ack.at ?? now(), by: ack.by, reason: ack.reason };
      journal({
        kind: 'console-ack',
        id,
        severity: entry.severity,
        count: entry.count,
        by: entry.acked.by,
        reason: entry.acked.reason,
        message: entry.message,
      });
      return snapshot(entry);
    },

    resolve(
      conditions: readonly { severity: ConsoleSeverity; message: string }[],
      by: string,
    ): string[] {
      const retired: string[] = [];
      for (const condition of conditions) {
        const id = consoleEntryId(
          condition.severity,
          condition.message.slice(0, MESSAGE_MAX_CHARS),
        );
        const entry = entries.get(id);
        if (!entry || entry.acked !== null) continue;
        entries.delete(id);
        retired.push(id);
        journal({
          kind: 'console-resolved',
          id,
          severity: entry.severity,
          count: entry.count,
          by,
          message: entry.message,
        });
      }
      return retired;
    },

    unresolved(): ConsoleLedgerEntry[] {
      sweep();
      return [...entries.values()]
        .filter((e) => e.acked === null)
        .sort((a, b) => a.firstAt - b.firstAt)
        .map(snapshot);
    },

    all(): ConsoleLedgerEntry[] {
      sweep();
      return [...entries.values()].sort((a, b) => a.firstAt - b.firstAt).map(snapshot);
    },

    summary(): UnresolvedConsoleSummary {
      sweep();
      let errors = 0;
      let warnings = 0;
      let errorOccurrences = 0;
      let warningOccurrences = 0;
      let acked = 0;
      for (const entry of entries.values()) {
        if (entry.acked !== null) {
          acked++;
          continue;
        }
        if (entry.severity === 'error') {
          errors++;
          errorOccurrences += entry.count;
        } else {
          warnings++;
          warningOccurrences += entry.count;
        }
      }
      return {
        errors,
        warnings,
        errorOccurrences,
        warningOccurrences,
        acked,
        dropped,
        measuredAt: now(),
      };
    },
  };
}

/** The zero summary — what a caller reports when it never reached a session.
 *  Named rather than spelled inline so "no session" and "no errors" cannot
 *  drift into different shapes across the CLI's response readers.
 *
 *  `measuredAt: 0` is deliberate and is NOT a time: nothing was measured, so
 *  the age readers compute from it is meaningless and they say "unknown"
 *  rather than "56 years". A fabricated `Date.now()` here would make "we never
 *  reached the session" print as a fresh reading. */
export const EMPTY_UNRESOLVED_CONSOLE: UnresolvedConsoleSummary = {
  errors: 0,
  warnings: 0,
  errorOccurrences: 0,
  warningOccurrences: 0,
  acked: 0,
  dropped: 0,
  measuredAt: 0,
};
