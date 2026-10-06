/**
 * THE MODEL PLAY LOG — what a play script says happened, stamped with the run's own clock.
 *
 * The game editor's play log is the receipt of a run (`play-*.jsonl`, `log-format.ts`); this
 * is Model Play's. A script calls `play.log(kind, facts)` (`play-script.ts`) on the
 * transitions that explain a run — a jump, a landing, a death and its cause, autoplay's
 * choice — and an agent reads them back with `volter-model-editor play-log` or
 * `editor.modelPlayLog()` in `eval`. `console.log` cannot do this job: the session's
 * console feed keeps warnings and errors only.
 *
 * Every entry carries `simT` (the seconds of simulation since Play started: the sum of the
 * `dt`s the runner has handed to `update`) and `tick` (the number of the update in
 * progress; 0 while the script's default export runs), the same two stamps the game
 * editor's entries carry. The runner adds its own lifecycle entries (`source: 'play'`):
 * `play-start`, `script-reload` with its reason, `script-error`, `play-stop`.
 *
 * BOUNDED AND PAGE-LIFETIME. The newest {@link MODEL_PLAY_LOG_CAPACITY} entries are kept in a
 * ring (older ones are counted in `dropped`); one entry's facts are kept as JSON of at most
 * {@link MODEL_PLAY_LOG_FACTS_CHARS} characters. Play starting from a fresh copy empties it;
 * a script reload does not, and the log outlives Stop so a finished run can be read. It is
 * never stored: a reload of the page forgets it, as it forgets the game.
 *
 * Logging is a read of the script's own values: it never throws into the script and touches
 * neither the clock nor the copy.
 */

/** Entries the ring keeps; the oldest beyond this are dropped and counted. */
export const MODEL_PLAY_LOG_CAPACITY = 5000;
/** The longest JSON one entry's facts keep; longer facts are kept truncated, as a string. */
export const MODEL_PLAY_LOG_FACTS_CHARS = 2048;

export interface ModelPlayLogEntry {
  /** The entry's place in this run, from 0: a gap in `seq` is entries the ring dropped. */
  readonly seq: number;
  /** Wall-clock ms. */
  readonly t: number;
  /** Seconds of simulation since Play started, across script reloads. */
  readonly simT: number;
  /** The update in progress (the first is 1); 0 before the first. */
  readonly tick: number;
  readonly kind: string;
  /** `script` for the play script's own entries; `play` for the runner's lifecycle ones. */
  readonly source: 'script' | 'play';
  readonly facts?: Record<string, unknown>;
}

export interface ModelPlayLogReading {
  /** The run is still playing; false after Stop, or when nothing has played. */
  readonly playing: boolean;
  /** The model document and play script of the run this log is for; null before any Play. */
  readonly documentId: string | null;
  readonly script: string | null;
  readonly startedAt: number | null;
  /** The run's clock now. */
  readonly simT: number;
  readonly tick: number;
  readonly capacity: number;
  /** Entries this run has written, and how many of those the ring has dropped. */
  readonly total: number;
  readonly dropped: number;
  /** The kept entries that match the read's filters, oldest first. */
  readonly entries: readonly ModelPlayLogEntry[];
}

export interface ModelPlayLogQuery {
  /** Only entries at or after this simulation time (seconds). */
  readonly since?: number;
  /** Only entries of this kind. */
  readonly kind?: string;
}

interface Run {
  documentId: string | null;
  script: string | null;
  startedAt: number | null;
  playing: boolean;
  simT: number;
  tick: number;
  ring: (ModelPlayLogEntry | undefined)[];
  total: number;
}

// One log per page, whichever copy of this module a contribution loaded it through: the
// runner writes it from the service, the session verb reads it from the command module.
const key = Symbol.for('volter.model-play-log');
const page = globalThis as typeof globalThis & { [key]?: Run };
const run: Run = page[key] ??= {
  documentId: null, script: null, startedAt: null, playing: false, simT: 0, tick: 0, ring: [], total: 0,
};

function keptFacts(facts: unknown): Record<string, unknown> | undefined {
  if (facts === undefined || facts === null) return undefined;
  let json: string | undefined;
  try { json = JSON.stringify(facts); }
  catch (error) { return { unserializable: error instanceof Error ? error.message : String(error) }; }
  if (json === undefined) return undefined;
  if (json.length > MODEL_PLAY_LOG_FACTS_CHARS) return { truncated: json.slice(0, MODEL_PLAY_LOG_FACTS_CHARS) };
  // A snapshot, so a script that goes on mutating what it logged does not rewrite history.
  const value: unknown = JSON.parse(json);
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : { value };
}

/** Play started from a fresh copy: an empty log, its clock at zero, and `play-start`. */
export function beginModelPlayLog(documentId: string, script: string): void {
  Object.assign(run, { documentId, script, startedAt: Date.now(), playing: true, simT: 0, tick: 0, ring: [], total: 0 });
  appendModelPlayLog('play', 'play-start', { documentId, script });
}

/** The runner is about to call `update(deltaSeconds)`. */
export function advanceModelPlayClock(deltaSeconds: number): void {
  run.tick += 1;
  run.simT += deltaSeconds;
}

export function appendModelPlayLog(source: ModelPlayLogEntry['source'], kind: string, facts?: unknown): void {
  try {
    const kept = keptFacts(facts);
    const entry: ModelPlayLogEntry = {
      seq: run.total, t: Date.now(), simT: run.simT, tick: run.tick, kind: String(kind), source,
      ...(kept ? { facts: kept } : {}),
    };
    run.ring[run.total % MODEL_PLAY_LOG_CAPACITY] = entry;
    run.total += 1;
  } catch { /* A log that cannot be written is not the script's failure. */ }
}

/** `play-stop`; the entries stay readable until the next Play. */
export function endModelPlayLog(facts?: Record<string, unknown>): void {
  if (!run.playing) return;
  appendModelPlayLog('play', 'play-stop', facts);
  run.playing = false;
}

export function readModelPlayLog(query: ModelPlayLogQuery = {}): ModelPlayLogReading {
  const dropped = Math.max(0, run.total - MODEL_PLAY_LOG_CAPACITY);
  const entries: ModelPlayLogEntry[] = [];
  for (let seq = dropped; seq < run.total; seq++) {
    const entry = run.ring[seq % MODEL_PLAY_LOG_CAPACITY]!;
    if (query.since !== undefined && entry.simT < query.since) continue;
    if (query.kind !== undefined && entry.kind !== query.kind) continue;
    entries.push(entry);
  }
  return {
    playing: run.playing, documentId: run.documentId, script: run.script, startedAt: run.startedAt,
    simT: run.simT, tick: run.tick, capacity: MODEL_PLAY_LOG_CAPACITY, total: run.total, dropped, entries,
  };
}
