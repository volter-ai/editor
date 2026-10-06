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
 * editor's entries carry. They are the Game panel's clock too: the runner advances both at
 * the same call (`play-script.ts`), so they stand still while paused and run at the speed. The
 * runner adds its own lifecycle entries (`source: 'play'`): `play-start`, `play-restart` (a
 * Restart's fresh run, right after its `play-start`), `script-reload` with its reason,
 * `script-error`, `tint-unsupported`, `tint-unknown-object`, `pause`, `resume`, `step` (one per
 * stepped update, with its `dt`), `speed` (on a change, and at a start that is not 1×),
 * `autoplay-on` and `autoplay-off` (each with `by`: `panel`, `cli`, `takeover`, `script`),
 * `play-stop`.
 *
 * ONE LOG PER MODEL DOCUMENT, each its document's latest run. Two documents playing at once
 * keep separate logs; a read names its document or takes the active Play's (the latest
 * started that still plays, else the latest started). Play starting from a fresh copy
 * replaces its document's log; a script reload does not, and the log outlives Stop so a
 * finished run can be read. The runner writes through the {@link ModelPlayRun} handle Play
 * started: once that run has ended its handle writes nothing, so a stale timer of an old
 * script cannot reach the next run's log.
 *
 * BOUNDED AND PAGE-LIFETIME. The newest {@link MODEL_PLAY_LOG_CAPACITY} entries of a run are
 * kept in a ring (older ones are counted in `dropped`); one entry's facts are kept as JSON of
 * at most {@link MODEL_PLAY_LOG_FACTS_CHARS} characters. It is never stored: a reload of the
 * page forgets it, as it forgets the game.
 *
 * THE GAME PANEL DRAWS IT LIVE: {@link subscribeModelPlayLog} hears every write, and
 * {@link tailModelPlayLog} reads the newest entries of one document without copying the ring.
 *
 * Logging is a read of the script's own values: it never throws into the script and touches
 * neither the clock nor the copy.
 */

/** Entries a run's ring keeps; the oldest beyond this are dropped and counted. */
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
  /** The model document and play script of the run read; null when nothing has played. */
  readonly documentId: string | null;
  readonly script: string | null;
  readonly startedAt: number | null;
  /** Every model document with a log, so a read can name another. */
  readonly documents: readonly string[];
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
  /** The model document whose log to read; the active Play's when omitted. */
  readonly documentId?: string;
  /** Only entries at or after this simulation time (seconds). */
  readonly since?: number;
  /** Only entries of this kind. */
  readonly kind?: string;
}

interface Run {
  readonly documentId: string;
  readonly script: string;
  readonly startedAt: number;
  playing: boolean;
  simT: number;
  tick: number;
  readonly ring: ModelPlayLogEntry[];
  total: number;
  /** Every kind this run has written, for the panel's filter. */
  readonly kinds: Set<string>;
}

/** The runner's door onto its own run's log: inert once the run has ended. */
export interface ModelPlayRun {
  /** The runner is about to call `update(deltaSeconds)`. */
  advance(deltaSeconds: number): void;
  append(source: ModelPlayLogEntry['source'], kind: string, facts?: unknown): void;
  /** `play-stop`, then nothing more is written; the entries stay readable. */
  end(facts?: Record<string, unknown>): void;
}

// One registry per page, whichever copy of this module a contribution loaded it through: the
// runner writes it from the service, the session verb reads it from the command module.
const key = Symbol.for('volter.model-play-log');
const page = globalThis as typeof globalThis & { [key]?: Map<string, Run> };
const runs: Map<string, Run> = page[key] ??= new Map();
const listenersKey = Symbol.for('volter.model-play-log.listeners');
const pageListeners = globalThis as typeof globalThis & { [listenersKey]?: Set<() => void> };
const listeners: Set<() => void> = pageListeners[listenersKey] ??= new Set();

function publish(): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* A reader's failure is not the writer's. */ }
  }
}

/** Hear every write to any document's log (several may land in one frame; coalesce). */
export function subscribeModelPlayLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

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

function append(run: Run, source: ModelPlayLogEntry['source'], kind: string, facts?: unknown): void {
  try {
    const kept = keptFacts(facts);
    const entry: ModelPlayLogEntry = {
      seq: run.total, t: Date.now(), simT: run.simT, tick: run.tick, kind: String(kind), source,
      ...(kept ? { facts: kept } : {}),
    };
    run.ring[run.total % MODEL_PLAY_LOG_CAPACITY] = entry;
    run.total += 1;
    run.kinds.add(entry.kind);
  } catch { /* A log that cannot be written is not the script's failure. */ }
  publish();
}

/** Play started from a fresh copy: the document's log replaced by an empty one at zero,
 *  opened by `play-start`. */
export function beginModelPlayLog(documentId: string, script: string): ModelPlayRun {
  const run: Run = { documentId, script, startedAt: Date.now(), playing: true, simT: 0, tick: 0, ring: [], total: 0, kinds: new Set() };
  // Re-inserted, so the map's order is the order Plays started.
  runs.delete(documentId);
  runs.set(documentId, run);
  append(run, 'play', 'play-start', { documentId, script });
  return {
    advance(deltaSeconds) {
      if (!run.playing) return;
      run.tick += 1;
      run.simT += deltaSeconds;
    },
    append(source, kind, facts) { if (run.playing) append(run, source, kind, facts); },
    end(facts) {
      if (!run.playing) return;
      append(run, 'play', 'play-stop', facts);
      run.playing = false;
    },
  };
}

function activeRun(): Run | undefined {
  const started = [...runs.values()].reverse();
  return started.find((run) => run.playing) ?? started[0];
}

export function readModelPlayLog(query: ModelPlayLogQuery = {}): ModelPlayLogReading {
  const run = query.documentId === undefined ? activeRun() : runs.get(query.documentId);
  const documents = [...runs.keys()];
  if (!run) {
    return {
      playing: false, documentId: query.documentId ?? null, script: null, startedAt: null, documents,
      simT: 0, tick: 0, capacity: MODEL_PLAY_LOG_CAPACITY, total: 0, dropped: 0, entries: [],
    };
  }
  const dropped = Math.max(0, run.total - MODEL_PLAY_LOG_CAPACITY);
  const entries: ModelPlayLogEntry[] = [];
  for (let seq = dropped; seq < run.total; seq++) {
    const entry = run.ring[seq % MODEL_PLAY_LOG_CAPACITY]!;
    if (query.since !== undefined && entry.simT < query.since) continue;
    if (query.kind !== undefined && entry.kind !== query.kind) continue;
    entries.push(entry);
  }
  return {
    playing: run.playing, documentId: run.documentId, script: run.script, startedAt: run.startedAt, documents,
    simT: run.simT, tick: run.tick, capacity: MODEL_PLAY_LOG_CAPACITY, total: run.total, dropped, entries,
  };
}

export interface ModelPlayLogTail {
  /** Entries the document's latest run has written; 0 when it has no log. */
  readonly total: number;
  /** Every kind that run has written, in the order first seen. */
  readonly kinds: readonly string[];
  /** The newest kept entries (of the asked kind), at most `last`, oldest first. */
  readonly entries: readonly ModelPlayLogEntry[];
}

/** The newest `last` entries of one document's log, walked from the newest end. */
export function tailModelPlayLog(documentId: string, last: number, kind?: string): ModelPlayLogTail {
  const run = runs.get(documentId);
  if (!run) return { total: 0, kinds: [], entries: [] };
  const oldest = Math.max(0, run.total - MODEL_PLAY_LOG_CAPACITY);
  const entries: ModelPlayLogEntry[] = [];
  for (let seq = run.total - 1; seq >= oldest && entries.length < last; seq--) {
    const entry = run.ring[seq % MODEL_PLAY_LOG_CAPACITY]!;
    if (kind === undefined || entry.kind === kind) entries.push(entry);
  }
  return { total: run.total, kinds: [...run.kinds], entries: entries.reverse() };
}
