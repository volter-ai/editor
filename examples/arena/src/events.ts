/**
 * The arena's event door AND its play-log pipeline — plain code, one screen.
 * There is deliberately no registry and no capability in the middle: this file
 * IS the pipeline (owner ruling: zero magic).
 *
 * `logArenaEvent('arena.fire', { weapon, ammo })` beside the mechanic that did
 * it. Events are batched into `fetch` POSTs to the editor server's flat append
 * door (`/__editor/log-entries`), so `logs/play-*.jsonl` is the durable record
 * an agent greps after a live playtest. An absent server (a headless import, an
 * exported build without one) is honest silence.
 */

const pending: Array<Record<string, unknown>> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  flushTimer = null;
  if (pending.length === 0) return;
  const entries = pending.splice(0, pending.length);
  void fetch('/__editor/log-entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).catch(() => {});
}

/** Record one beat of the match in the play log. */
export function logArenaEvent(kind: string, detail?: Record<string, unknown>): void {
  if (typeof fetch !== 'function') return;
  pending.push({
    t: Date.now(),
    level: 'info',
    source: 'game-event',
    msg: kind,
    ...(detail === undefined ? {} : { meta: detail }),
  });
  if (flushTimer === null) flushTimer = setTimeout(flush, 250);
}
