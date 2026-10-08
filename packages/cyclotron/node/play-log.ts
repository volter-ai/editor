/**
 * `cyclotron play-log`: Model Play's log, read from the running session
 * (`editor.modelPlayLog()`, the `model-play-log` verb `@volter/play` contributes).
 * One line per entry — simulation seconds, frame, kind, facts — or the whole reading as JSON.
 */
import { connect } from '@volter/live';

export const PLAY_LOG_USAGE = 'play-log [--since <simTime>] [--kind <kind>] [--document <id>] [--json]';

export async function playLog(options: {
  readonly since?: string | undefined; readonly kind?: string | undefined; readonly document?: string | undefined; readonly json?: boolean | undefined;
}): Promise<void> {
  const since = options.since === undefined ? undefined : Number(options.since);
  if (since !== undefined && !Number.isFinite(since))
    throw new Error(`--since takes simulation seconds, a number; it was given ${options.since}.`);
  const live = await connect();
  const reading = await live.editor.modelPlayLog({
    ...(options.document === undefined ? {} : { documentId: options.document }),
    ...(since === undefined ? {} : { since }),
    ...(options.kind === undefined ? {} : { kind: options.kind }),
  });
  if (options.json) {
    console.log(JSON.stringify(reading, null, 2));
    return;
  }
  if (reading.script === null) {
    console.log(options.document === undefined ? 'Nothing has played since the editor page loaded.'
      : `${options.document} has not played since the editor page loaded${reading.documents.length ? `; logs: ${reading.documents.join(', ')}` : ''}.`);
    return;
  }
  const kept = reading.total - reading.dropped;
  if (reading.documents.length > 1) console.log(`Logs: ${reading.documents.join(', ')}; this is ${reading.documentId}'s (--document picks another).`);
  console.log(`Play log of ${reading.script}: ${reading.playing ? 'playing' : 'stopped'} at ${reading.simT.toFixed(3)}s, tick ${reading.tick}; ` +
    `${kept} of ${reading.total} entries kept${reading.dropped ? ` (the oldest ${reading.dropped} dropped)` : ''}, ${reading.entries.length} shown.`);
  for (const entry of reading.entries)
    console.log(`${entry.simT.toFixed(3).padStart(10)}s  #${String(entry.tick).padEnd(6)} ${entry.kind}${entry.facts ? `  ${JSON.stringify(entry.facts)}` : ''}`);
}
