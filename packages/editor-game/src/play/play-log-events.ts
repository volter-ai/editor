import type { LogEntry } from '@volter/editor-core/editor-api';
import type { TickStampedEvent } from '@volter/editor-project/adapter/system-adapter';

/** Convert newly observed game-authored debug events into persistent JSONL entries. */
export function debugEventsToLogEntries(
  events: readonly TickStampedEvent[],
  sinceSeq: number,
  wallTime = Date.now(),
): { entries: LogEntry[]; lastSeq: number } {
  const fresh = events.filter((event) => event.seq > sinceSeq).sort((a, b) => a.seq - b.seq);
  return {
    entries: fresh.map((event) => ({
      t: wallTime,
      level: 'info',
      source: 'game-event',
      msg: event.event,
      tick: event.tick,
      simT: event.simT,
      meta: {
        seq: event.seq,
        ...(event.detail !== undefined ? { detail: event.detail } : {}),
      },
    })),
    lastSeq: fresh.at(-1)?.seq ?? sinceSeq,
  };
}
