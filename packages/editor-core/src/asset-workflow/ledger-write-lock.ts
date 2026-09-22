/**
 * The two mechanical halves of "a read-modify-write of one file never loses a
 * record", shared by the ledger's two I/O sides (`../../server/
 * asset-ledger-store.ts` over `node:fs`, `./asset-ledger-backend.ts` over a
 * `StorageBackend`).
 *
 * Why the ledger needs this at all: `.vgai/assets.json` (D-AP3) is updated by
 * READING it, adding one entry, and writing the whole object back. Two of those
 * in flight interleave — both read the old object, the later write wins, and the
 * earlier record is gone with no error anywhere. Two materializations at once is
 * ordinary, not exotic: two `vgai edit` sessions on one project, `npm run
 * asset-packs:sync` while an editor is prewarming, two tabs on one project
 * both retrying their declared packs on reopen.
 *
 * Neither half alone is enough, which is why both are here:
 *
 *   - `createSerializer` — an in-process (in-realm) promise chain per key. This
 *     is what makes concurrency INSIDE one process correct, and it is the only
 *     mechanism that can, since a file lock cannot exclude its own holder.
 *   - `withExclusiveLock` — a lock FILE, which is the only thing a second
 *     process/realm can see. Injected I/O (`ExclusiveLockIO`) so the same
 *     waiting/stale-breaking policy runs over `node:fs` and over a
 *     `StorageBackend` without either being reimplemented.
 *
 * This module is deliberately a helper, not a system: no ownership of when a
 * ledger is written, no retries of the caller's work, no state beyond the map a
 * `createSerializer` call hands back.
 */

/** File operations `withExclusiveLock` needs. One lock path per instance. */
export interface ExclusiveLockIO {
  /** Create the lock holding `content` iff absent. `false` when already held. */
  createIfAbsent(content: string): Promise<boolean>;
  /** The held lock's content, or `null` if it has since vanished. */
  read(): Promise<string | null>;
  /**
   * Delete the lock ONLY while it still holds `expected`. Must tolerate an
   * already-absent lock, and must leave a lock holding anything else alone.
   *
   * There is deliberately no unconditional delete: every deletion in this
   * module is either "release the lock I took" or "break the corpse I judged
   * stale", and both name the exact content they mean. A caller that could
   * delete whatever is there deletes ANOTHER writer's live lock whenever its
   * own view is one step out of date — which is how two writers used to end up
   * inside the critical section at once.
   *
   * The compare and the delete must be ATOMIC WITH RESPECT TO EACH OTHER, and
   * that requirement is on the implementer, not on this module. A backend that
   * reads, compares, then deletes as separate steps reintroduces the same
   * defect one level down: two waiters both compare against the corpse, the
   * first deletes it, acquires and enters, and the second's delete — already
   * past its comparison — removes the winner's fresh lock and lets it in behind
   * it. The two shipped backends each pay for this: the browser one runs inside
   * the `navigator.locks` name `writeIfAbsent` takes, and the `node:fs` one has
   * no atomic compare-and-delete at all and uses `removeIfHeldByTakeover`.
   */
  removeIfHeldBy(expected: string): Promise<void>;
}

/**
 * The atomic single steps a takeover-based compare-and-delete needs. Each
 * instance belongs to ONE attempt: the aside path is chosen by the caller and
 * unique per attempt, so two concurrent attempts can never collide on it.
 *
 * On `node:fs` these are `rename`, `readFile`, `rm` and `writeFile` with the
 * `wx` flag — every one a single syscall, which is the whole reason the
 * algorithm below can be reasoned about at all.
 */
export interface LockTakeoverOps {
  /**
   * Atomically move the lock to this attempt's aside path. `false` when the
   * lock was not there — which, when several attempts race, is how every
   * attempt but one finds out that it lost.
   */
  moveAside(): Promise<boolean>;
  /** Content of the moved-aside lock; `null` if it is somehow not there. */
  readAside(): Promise<string | null>;
  deleteAside(): Promise<void>;
  /** Put `content` back at the lock path, ONLY while it is still absent. */
  restoreIfAbsent(content: string): Promise<boolean>;
}

/**
 * `removeIfHeldBy` for a filesystem that has no atomic compare-and-delete:
 * SEIZE the lock with one atomic move, and only then compare.
 *
 * What this buys, and it is the entire point: for a given lock, AT MOST ONE
 * attempt can move it aside. Every other racer's `moveAside` reports `false`
 * and deletes nothing, so it loops, re-reads, and sees the winner's fresh
 * stamp. Read-then-delete could not offer this — its comparison is a snapshot,
 * and a snapshot is stale by the time the delete runs.
 *
 * If the seized content is NOT the content this attempt judged, this attempt had
 * no business taking it: put it straight back, then drop the aside copy.
 *
 * RESIDUAL — stated precisely, because it is not zero. Between the move and the
 * restore, the lock path is briefly absent. A writer whose `createIfAbsent`
 * lands in exactly that gap acquires while the lock's real holder is still
 * inside its critical section. Reaching it takes two coincidences: the content
 * must change between the caller's read and this move (the holder of a stamp
 * older than `staleAfterMs` releasing, and a successor acquiring, inside that
 * window), AND a third writer's create must land inside the restore window.
 * POSIX offers no primitive that closes it — there is no atomic
 * compare-and-delete — and closing it would take a lease/heartbeat protocol
 * with a "your lock was compromised" callback, which this helper deliberately
 * is not.
 */
export async function removeIfHeldByTakeover(
  ops: LockTakeoverOps,
  expected: string,
): Promise<void> {
  if (!(await ops.moveAside())) return;
  const seized = await ops.readAside();
  if (seized !== null && seized !== expected) await ops.restoreIfAbsent(seized);
  await ops.deleteAside();
}

export interface ExclusiveLockOptions {
  /**
   * How long a lock may be held before another writer BREAKS it.
   *
   * Breaking, rather than failing, is deliberate: the holder of a lock file is
   * usually a process that has since died (Ctrl-C in the middle of
   * `asset-packs:sync`, a closed tab), and a provenance record must not be
   * refused forever because of a corpse. A real holder finishes in single-digit
   * milliseconds, so this is orders of magnitude above the honest wait — and it
   * is also the loop bound, so waiting can never deadlock.
   */
  readonly staleAfterMs?: number;
  /** Poll interval while a live lock is held. */
  readonly retryDelayMs?: number;
  /** Recorded in the lock so a human can see who holds it. */
  readonly owner?: string;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * The per-ATTEMPT unique part of the stamp. Injectable so a test can name the
   * attempts it schedules; never for production use.
   *
   * It is load-bearing rather than cosmetic: `removeIfHeldBy` can only tell "my
   * lock" from "someone else's lock" if no two attempts can ever write the same
   * stamp, and `{at, owner}` alone repeats whenever two writers with the same
   * owner name land in the same millisecond.
   */
  readonly token?: () => string;
}

const DEFAULT_STALE_AFTER_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 15;

/** Same guarded form as `../storage/index.ts` — `crypto` is absent in a
 *  non-secure browser context, and a missing token must not fail a write. */
function defaultToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/** Run `work` while holding an exclusive on-disk lock, always releasing it. */
export async function withExclusiveLock<T>(
  io: ExclusiveLockIO,
  work: () => Promise<T>,
  options: ExclusiveLockOptions = {},
): Promise<T> {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const token = options.token ?? defaultToken;

  for (;;) {
    const stamp = JSON.stringify({ at: now(), owner: options.owner ?? 'unknown', token: token() });
    if (await io.createIfAbsent(stamp)) {
      try {
        return await work();
      } finally {
        // Release only OUR lock: if a waiter judged it stale and its successor
        // has already taken the lock, `stamp` is no longer the content and this
        // is a no-op. An unconditional delete here would hand the successor's
        // lock to whoever came next.
        await io.removeIfHeldBy(stamp);
      }
    }
    const held = await io.read();
    // Gone between the failed create and this read — race the create again.
    if (held === null) continue;
    if (now() - lockHeldSince(held) > staleAfterMs) {
      // Break the exact corpse we judged, not "whatever is there now" — an
      // unconditional delete here removes the lock of whoever broke this same
      // corpse a step ahead of us, and lets us walk in behind them.
      //
      // `held` is a SNAPSHOT: by the time the io acts on it, another waiter may
      // have broken this corpse and acquired. That is why `removeIfHeldBy` is
      // required to compare and delete atomically (see its doc comment) rather
      // than being handed a "delete if this is still there" hint it can act on
      // late — the atomicity is what makes at most one waiter break one corpse.
      // The entrant is then decided only by `createIfAbsent`, and the loser of
      // that race loops, re-reads, and sees the winner's fresh stamp.
      await io.removeIfHeldBy(held);
      continue;
    }
    await sleep(retryDelayMs);
  }
}

/**
 * When the holder took the lock. An unreadable stamp reports epoch 0, i.e.
 * immediately stale: a lock whose age cannot be established cannot be waited
 * out honestly, and refusing to write provenance because of an unparseable
 * scratch file would be the worse failure.
 */
function lockHeldSince(content: string): number {
  try {
    const parsed = JSON.parse(content) as { at?: unknown };
    return typeof parsed.at === 'number' ? parsed.at : 0;
  } catch {
    return 0;
  }
}

/**
 * A per-key promise chain: `serialize(key, work)` starts `work` only after
 * every earlier `work` for that key has settled (rejections included — one
 * failed write must not wedge the queue).
 *
 * Each call returns its OWN map, so two independent callers can never collide
 * on a key that happens to spell the same.
 */
export function createSerializer(): <T>(key: string, work: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.then(work, work);
    // Swallow only on the CHAIN copy — the returned promise still rejects.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}
