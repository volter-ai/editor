/**
 * THE NOTE A DYING TAB LEAVES FOR THE NEXT ONE.
 *
 * When an editor page decides its server is gone it raises an overlay — and
 * that overlay is the only place the fact has ever existed. Close the tab, or
 * let the browser discard it, and the entire episode is unrecoverable: the
 * server it would have been reported to is precisely the thing that died, so
 * no journal, no `vgai console` and no later session has any record that a
 * window sat there orphaned. A human who steps away and comes back to a
 * relaunched editor is left to reconstruct it from how slow things felt.
 *
 * Measured 2026-08-19: that reconstruction cost about an hour.
 *
 * So the page writes the fact somewhere its dead server cannot reach and
 * cannot erase — `localStorage`, keyed by ORIGIN, which is exactly the scope of
 * "the server that was serving this address". The next editor to boot on that
 * address picks the note up, says it out loud once through the ordinary console
 * door (so it reaches `vgai console` and the session journal like every other
 * editor fact), and clears it.
 *
 * The split here is deliberate: everything that decides or formats is a pure
 * function over plain data, and the two functions that touch `localStorage` do
 * nothing else. That is what lets the whole behaviour be tested without a
 * browser, and it is why the storage handle is a parameter rather than a
 * global reach.
 */

/** Why the tab that wrote this note stopped being a live editor. Only the
 *  UNGRACEFUL deaths are worth a note: a session the user closed on purpose is
 *  not a mystery anybody needs solved later. */
export type OrphanReason = 'server-gone';

export interface SessionOrphanRecord {
  /** When the page decided it, epoch ms. */
  readonly at: number;
  readonly reason: OrphanReason;
  /** The project the dead session was serving, as the tab last knew it.
   *  `null` when the tab never got a successful identity poll. */
  readonly project: string | null;
}

/** One key, versioned, namespaced like the editor's other per-user state.
 *  `localStorage` is already per-origin, so the key needs no port in it — and
 *  must not have one, or a note would be invisible to the very session that
 *  replaced the writer. */
export const SESSION_ORPHAN_KEY = 'vgai.editor.orphaned-tab.v1';

/**
 * Parse a stored note, rejecting anything that is not one.
 *
 * Strict and silent: this reads a value any page on the origin could have
 * written, and a boot path is the wrong place to throw. Unusable input is
 * simply "no note" — the same answer as an empty slot, which is the honest one
 * since a malformed note tells us nothing about any session.
 */
export function decodeSessionOrphanRecord(raw: string | null): SessionOrphanRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Partial<SessionOrphanRecord>;
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null;
  if (record.reason !== 'server-gone') return null;
  const project = typeof record.project === 'string' ? record.project : null;
  return { at: record.at, reason: record.reason, project };
}

export function encodeSessionOrphanRecord(record: SessionOrphanRecord): string {
  return JSON.stringify(record);
}

/**
 * The sentence the next session says.
 *
 * It names the three things a reader needs and cannot otherwise get: WHEN the
 * previous window lost its server, WHICH project it was on, and — the part
 * that closes the hour of misdiagnosis — that the stale window is still open
 * and is not the one they are now looking at.
 */
export function describeSessionOrphan(record: SessionOrphanRecord, now: number): string {
  const ageSeconds = Math.max(0, Math.round((now - record.at) / 1000));
  const ago =
    ageSeconds < 90
      ? `${ageSeconds}s ago`
      : ageSeconds < 5400
        ? `${Math.round(ageSeconds / 60)}m ago`
        : `${Math.round(ageSeconds / 3600)}h ago`;
  const project = record.project ? ` on ${record.project}` : '';
  return (
    `A previous editor window at this address lost its server ${ago}${project} and was left ` +
    'orphaned. If that window is still open it is a stale snapshot — nothing in it is saved and ' +
    'every click in it hangs on retries. Close it; this window is the live one.'
  );
}

/**
 * How long a note stays worth saying, ms.
 *
 * A note is about the session the reader is replacing, so it goes stale fast:
 * a day later it is archaeology, and reporting it would train people to ignore
 * the message that matters. Twelve hours covers "I came back the next
 * morning" without reaching into last week.
 */
export const SESSION_ORPHAN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Whether a note is recent enough for the booting session to say out loud.
 *  A note from the FUTURE (a clock the user moved) is not usable evidence
 *  either, and is dropped by the same bar. */
export function sessionOrphanIsWorthReporting(record: SessionOrphanRecord, now: number): boolean {
  const age = now - record.at;
  return age >= 0 && age <= SESSION_ORPHAN_MAX_AGE_MS;
}

/** The storage this module needs — narrowed to the three calls it makes so a
 *  test can pass a plain object and so no caller is tempted to hand it the
 *  whole `Window`. */
export interface OrphanRecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The page's own `localStorage`, or `null` where there is none (SSR, jsdom
 *  without storage, a browser refusing it in private mode). Every caller
 *  tolerates `null`: a note is a diagnostic, never a precondition. */
export function defaultOrphanRecordStorage(): OrphanRecordStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Leave the note. Called at the moment the page raises its "server is gone"
 * overlay, so the durable record and the visible one are the same event.
 *
 * A write failure is swallowed on purpose — a full or blocked `localStorage`
 * must not stop the page from telling the user what happened, which is the
 * half that actually matters.
 */
export function writeSessionOrphanRecord(
  record: SessionOrphanRecord,
  storage: OrphanRecordStorage | null = defaultOrphanRecordStorage(),
): void {
  try {
    storage?.setItem(SESSION_ORPHAN_KEY, encodeSessionOrphanRecord(record));
  } catch {
    /* diagnostics never break the page — see above */
  }
}

/**
 * Read and CLEAR the note in one step.
 *
 * Taking rather than peeking is the whole contract: the note describes one
 * episode, so it must be said once. A read that left it behind would have every
 * subsequent boot repeating a stale warning until the user learned to ignore
 * the channel.
 */
export function takeSessionOrphanRecord(
  storage: OrphanRecordStorage | null = defaultOrphanRecordStorage(),
): SessionOrphanRecord | null {
  if (!storage) return null;
  try {
    const record = decodeSessionOrphanRecord(storage.getItem(SESSION_ORPHAN_KEY));
    storage.removeItem(SESSION_ORPHAN_KEY);
    return record;
  } catch {
    return null;
  }
}

/**
 * Drop the note without reporting it.
 *
 * The `resume` branch: the same process answered again, so the page was never
 * orphaned and the note it wrote a moment ago is simply wrong. Retracting it
 * here is what keeps the record trustworthy enough to act on.
 */
export function clearSessionOrphanRecord(
  storage: OrphanRecordStorage | null = defaultOrphanRecordStorage(),
): void {
  try {
    storage?.removeItem(SESSION_ORPHAN_KEY);
  } catch {
    /* see writeSessionOrphanRecord */
  }
}
