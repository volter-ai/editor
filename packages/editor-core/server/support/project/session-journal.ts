/**
 * The editor session's console stream, as a STRUCTURED FILE an agent can read
 * at any moment: `<project>/logs/editor-<sessionstamp>.jsonl`.
 *
 * WHY. Agents do not watch terminals; they read files. Every discipline signal
 * the editor server already produces — a save that failed validation, a
 * build-discipline tripwire crossing (`build-discipline.ts`), the session's own
 * lifecycle — was delivered ONLY as a terminal print, which in detach mode goes
 * to a raw capture nobody parses and in foreground scrolls past whoever was not
 * looking. Same measured shape as the tripwires' own origin story: the
 * mechanism was right and the delivery assumption was false.
 *
 * SO THE JOURNAL IS THE RECORD AND THE PRINTS ARE ITS RENDERERS. Every caller
 * emits the event here first and renders second, from one emit point, so no
 * line can reach a terminal without a durable twin on disk. Nothing new is
 * measured for the journal's sake: each event is a fact one of those surfaces
 * was about to print anyway.
 *
 * IT LIVES BESIDE `logs/play-*.jsonl`, in the project, deliberately: that is
 * the established idiom for "durable evidence this session produced", the
 * scaffold already gitignores `logs/`, and `build-discipline.ts` already skips
 * `logs/` when dating source (so a journal line can never read as a source
 * change and make a tripwire cry wolf on its own output).
 *
 * SCHEMA-LIGHT ON PURPOSE. One discriminated union, one writer, no zod: nothing
 * reads a journal back through a validator — an agent reads it, and `JSON.parse`
 * per line is the whole contract. Append-only, one object per line, no levels,
 * no transports, no config.
 *
 * BOUNDS. Same rule the play logs follow (`/__editor/log-session`): prune to the
 * newest `MAX_JOURNAL_FILES` when a new one is opened. Within a session the file
 * grows unbounded, which is what an append-only record means.
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { TripwireTier } from './build-discipline';
import type { BlenderTabMetrics, RecordedTabCensus } from '@volter/editor-sdk/project/tab-census';

/** `editor-` + an ISO instant with `:`/`.` flattened + `.jsonl` — the same
 *  lexicographic-order-is-chronological-order shape `play-*.jsonl` uses. */
const PREFIX = 'editor-';
const SUFFIX = '.jsonl';

/** Journals kept per project. Matches the play logs' own `MAX_LOG_FILES`. */
const MAX_JOURNAL_FILES = 20;

/**
 * One journal line's payload. `at` (ISO) is added by the writer, so a caller
 * only ever describes WHAT happened.
 *
 * The tripwire arm reuses `build-discipline.ts`'s vocabulary verbatim — its
 * `TripwireTier`, its tripwire names, and the same inputs its banners are
 * computed from — so the JSONL and the printed banner can never disagree about
 * what fired or how loud it was.
 */
export type SessionJournalEvent =
  /** This server began serving this project (the process's own start). */
  | { readonly kind: 'session-started'; readonly project: string; readonly pid: number }
  /** `POST /__editor/open-project` switched the live session's project. */
  | {
      readonly kind: 'project-opened';
      readonly project: string;
      readonly previousProject: string | null;
    }
  /** The session is going down (best-effort: a SIGKILL logs nothing). */
  | { readonly kind: 'session-shutdown' }
  /**
   * ONE RESOURCE THE SHUTDOWN COULD NOT STOP, by name.
   *
   * The host's shutdown list runs each task independently and bounds each one
   * (`packages/editor/server/process-shutdown.ts`); this is what a task writes
   * when its bound expires or it throws. Measured 2026-09-21 under load average
   * ~30: a `vgai close` died inside the tab notify before the workbench's
   * children were stopped, and the ONLY evidence was a journal that stopped —
   * no `session-shutdown` line, a Code-OSS server orphaned at PPID 1 on its
   * reserved port, and the next `vgai edit` refusing by name. A silence names
   * nothing; this line names the resource.
   */
  | {
      readonly kind: 'session-shutdown-task';
      readonly task: string;
      readonly outcome: 'timeout' | 'failed';
      readonly ms: number;
      readonly detail?: string;
    }
  /**
   * WHO HEARD THE SESSION END. Written by `tab-lifecycle.ts`'s
   * `notifySessionEnded` after it broadcasts `tab-close` and WAITS (bounded at
   * 2s) for every tab that was present at that moment to acknowledge it.
   *
   * Measured 2026-09-19/20: the broadcast used to be followed by a blind
   * 150 ms sleep and the HTTP server coming down, so nothing ever recorded
   * whether a page received it. A page that did not kept its Blender engine
   * worker — one engine thread plus a 16-thread pthread pool — at 100%+ CPU
   * for minutes after `vgai close`, and the box swapped. These two lines are
   * the difference, and `vgai close` prints whichever one it finds.
   */
  | { readonly kind: 'session-end-acked'; readonly tabs: number; readonly ms: number }
  /** …and the other outcome: these tabs never said they got it, so whatever
   *  their pages hold is still running. */
  | {
      readonly kind: 'session-end-unacked';
      readonly tabId8s: readonly string[];
      readonly ms: number;
    }
  /**
   * WHERE EDITOR BOOT TIME WENT — written ONCE, when the first page proves it
   * is RUNNING the editor document (its command listener attaches), which is
   * the honest end of the wait `vgai edit` narrates as "Vite cold start".
   *
   * The gap between "Editor ready at …" and that line is the largest stage of
   * opening a project and nothing used to record it: on an imported Unity port
   * it measured 83–139s against a template's 5s, and finding out why took a
   * hand-rolled request trace plus a V8 CPU profile of the dev server. Every
   * field here is a fact the host already had.
   *
   * READ `loopDelayP99Ms` FIRST. It is what separates "the server was busy" —
   * where every slow response in the window is queueing, not work — from "the
   * server was idle and the browser was the wait". See
   * `packages/editor/server/boot-timings.ts`.
   */
  | {
      readonly kind: 'boot';
      /** Process start → Vite's `createServer` resolved. */
      readonly viteMs: number;
      /** …→ the dependency scan settled. */
      readonly depScanMs: number;
      /** …→ HTTP listening (what "Editor ready at" announces). */
      readonly listenMs: number;
      /** Listening → the first page running the editor document. */
      readonly boundMs: number;
      /** Process start → the declared world warmup finished; `null` if none ran. */
      readonly worldWarmupDoneMs: number | null;
      readonly loopDelayP99Ms: number;
      readonly loopDelayMaxMs: number;
    }
  /** A save-validation verdict — the same facts `runFileValidation` reports. */
  | {
      readonly kind: 'validation';
      /** Project-relative, forward-slash. */
      readonly path: string;
      /** The validatable kind the server classified this file as. */
      readonly fileKind: string;
      readonly ok: boolean;
      readonly errors?: readonly string[];
      readonly warnings?: readonly string[];
    }
  /** A build-discipline tripwire CROSSED a step (never a repeat at one tier). */
  | {
      readonly kind: 'tripwire';
      readonly tripwire: 'commit-cadence';
      readonly tier: TripwireTier;
      readonly ageMs: number;
      readonly fileCount: number;
    }
  | {
      readonly kind: 'tripwire';
      readonly tripwire: 'unplayed-session';
      readonly tier: TripwireTier;
      readonly servingForMs: number;
    }
  /**
   * A play-mode log session opened or closed.
   *
   * `name` is the run's OPTIONAL slug (`vgai play --name <text>`), `null` for
   * an unnamed run — the same slug that goes in the log filename, so grepping
   * the journal for a run and listing `logs/` for it are the same question.
   */
  | {
      readonly kind: 'play';
      readonly action: 'start' | 'stop';
      readonly name: string | null;
      readonly logFile: string | null;
    }
  /**
   * A play run's VIDEO evidence opened or landed.
   *
   * Every `vgai play` records — there is no flag — so this row is the answer
   * to "where is the footage of that run", and it has to be in the journal
   * rather than only in a terminal ack: the runs whose footage matters most
   * are the unattended ones, whose ack nobody read.
   *
   * `reason` is what ENDED the recording (`'idle-autostop'`, `'stop'`), null
   * on the `started` row. `rotates` says whether the next play overwrites this
   * file — the unnamed clip does, a `--record <name>` keepsake does not.
   */
  | {
      readonly kind: 'play-recording';
      readonly action: 'started' | 'finalized';
      /** Basename under the project's `.vgai/recordings/`. */
      readonly file: string;
      readonly rotates: boolean;
      readonly reason: string | null;
    }
  /**
   * A relayed command ran out of budget, and WHICH PLAY-BOOT STEP the page was
   * inside when it did.
   *
   * The row exists because its absence was the defect. Measured 2026-08-20 at
   * N=20000 on the canvas lane: `play` (120s), `screenshot` (15s) and `stop`
   * (30s) all expired against a tab whose WORKER heartbeat kept beating at
   * 0.4s, and the journal's whole account of it was three `command-result`
   * lines saying "the tab is present … and did not respond" — true, and about
   * the tab rather than the page. `phase` is the page's own last word before it
   * went quiet (`editor/src/play-boot-phase.ts`); `null` means no play boot was
   * in flight, which is itself an answer.
   */
  | {
      readonly kind: 'play-stall';
      readonly command: string;
      readonly requestId8: string;
      readonly phase: string | null;
      /** How long the page had been in that phase. `null` with a null phase. */
      readonly phaseAgeMs: number | null;
      /** The budget the command actually waited out. */
      readonly waitedMs: number;
    }
  /**
   * THE TRANSPORT ARM. Everything below is one line per transport or
   * presence fact, and it exists because the journal was BLIND to all of
   * them: on 2026-08-09 a session refused five `vgai play` commands against
   * a healthy connected tab and the whole file it left behind was
   * `session-started` plus validation lines. A relay that can refuse has to
   * be able to say who it refused, to which tab, and on what evidence.
   *
   * Ids are truncated to 8 characters (`clientId8`, `tabId8`, `requestId8`)
   * — enough to correlate lines within one session, short enough that a
   * human can scan a column of them. No payload bodies, ever: a state
   * snapshot or a command argument list would turn an append-only record
   * into a memory dump.
   */
  /** A control connection opened (either transport). */
  | {
      readonly kind: 'client-connected';
      readonly clientId8: string;
      readonly transport: 'ws' | 'sse';
      readonly participant: string | null;
    }
  /** A control connection closed, and how many pending commands it settled. */
  | {
      readonly kind: 'client-disconnected';
      readonly clientId8: string;
      readonly transport: 'ws' | 'sse';
      /** WebSocket close code, or null for SSE (which has none). */
      readonly code: number | null;
      readonly reason: string | null;
      readonly commandsSettled: number;
    }
  /** The server granted a socket the duplex control capability. */
  | { readonly kind: 'duplex-granted'; readonly clientId8: string }
  /** A page proved it is speaking the exact generation the server granted. */
  | {
      readonly kind: 'control-lifecycle-confirmed';
      readonly clientId8: string;
      readonly connectionGeneration8: string;
    }
  /** A stale or contradictory control frame was refused. */
  | {
      readonly kind: 'control-lifecycle-rejected';
      readonly clientId8: string;
      readonly mismatch:
        | 'serverGeneration'
        | 'connectionGeneration'
        | 'clientId'
        | 'tabId'
        | 'pageGeneration';
    }
  /** A command left the relay for one tab's command channel. */
  | {
      readonly kind: 'command-relayed';
      readonly command: string;
      readonly requestId8: string;
      readonly tabId8: string | null;
      readonly clientId8: string | null;
    }
  /** The tab said its command listener PICKED THE COMMAND UP. */
  | { readonly kind: 'command-receipt'; readonly requestId8: string }
  /**
   * The last tab's connection went away while UNRECEIPTED commands were still
   * queued, and this many were swept. Receipted ones are deliberately not
   * counted here — they keep their own work budget.
   */
  | { readonly kind: 'command-swept-on-last-tab-gone'; readonly settled: number }
  /** The command settled — by the tab's own answer or by the relay refusing. */
  | {
      readonly kind: 'command-result';
      readonly requestId8: string;
      readonly ok: boolean;
      /** Present only when `ok` is false; the refusal/failure text. */
      readonly error?: string;
    }
  /**
   * The relay HELD a command instead of refusing it: the target tab is
   * present by heartbeat but its command channel is not carrying right now
   * (mid-reload, or a channel that has not answered an echo).
   */
  | {
      readonly kind: 'command-held';
      readonly requestId8: string;
      readonly tabId8: string;
      readonly reason: 'no-channel' | 'unacknowledged';
    }
  /** The main-thread echo probe over a duplex socket. */
  | {
      readonly kind: 'echo-probe';
      readonly clientId8: string;
      readonly answered: boolean;
      readonly waitedMs: number;
    }
  /** The blessed tab changed (or was chosen for the first time). */
  | {
      readonly kind: 'tab-blessed';
      readonly tabId8: string;
      readonly previousTabId8: string | null;
      readonly reason: 'sticky' | 'oldest' | 'claimed';
    }
  /** An extra tab was told to yield. */
  | { readonly kind: 'tab-yielded'; readonly tabId8: string }
  /**
   * PRESENCE, IN TAB VOCABULARY. These five say what the tab table saw, and
   * they deliberately do NOT use socket words: a socket closing is not a tab
   * leaving, and that conflation is what produced "editor tab lost —
   * reopening" against a tab that had never gone anywhere.
   */
  /** A tabId beat for the first time. */
  | {
      readonly kind: 'tab-appeared';
      readonly tabId8: string;
      readonly visibility: 'visible' | 'hidden';
    }
  /** Beats stopped arriving for longer than the notice threshold. */
  | { readonly kind: 'tab-heartbeat-gap'; readonly tabId8: string; readonly sinceMs: number }
  /** A gap closed — the same tab resumed beating. `gapMs` is its full length. */
  | { readonly kind: 'tab-gap-closed'; readonly tabId8: string; readonly gapMs: number }
  /** Same tabId, new epoch: the page reloaded. The tab never left. */
  | { readonly kind: 'tab-reloaded'; readonly tabId8: string; readonly epochCount: number }
  /** The page announced main-thread work before starting it (a play-boot
   *  step, a model's `building src/models/x.ts`), or cleared it (`null`). */
  | { readonly kind: 'page-phase'; readonly phase: string | null }
  /**
   * What the project's source watcher saw: one line per chokidar event under
   * `src/` (`add`/`change`/`unlink`), with the file's mtime as the watcher
   * found it (`null` when the path was gone). The instrument for "why did
   * the page reload / the table refresh" — a reload on a file whose mtime
   * never moved is a phantom event, and this is where it shows.
   */
  | {
      readonly kind: 'src-watch';
      readonly event: string;
      readonly path: string;
      readonly mtimeMs: number | null;
    }
  /** Absent past its grace: this tab is gone. */
  | { readonly kind: 'tab-departed'; readonly tabId8: string; readonly absentMs: number }
  /**
   * WHAT THE TAB WAS HOLDING WHEN IT DIED WITHOUT A GOODBYE.
   *
   * Emitted beside `client-disconnected` on an ABNORMAL close (1006 — the
   * socket ended with no close frame, which is what a killed renderer process
   * leaves behind; an ordinary tab close sends one). Measured 2026-08-10: a
   * game tab's renderer was killed repeatedly at Chrome's undocumented
   * per-process ceiling and the whole session record said `1006` and nothing
   * else — the recovery worked perfectly and the CAUSE was unrecorded.
   *
   * `census` is the tab's last resource profile and `censusAgeMs` how stale it
   * was; both null for a tab that never reported one (an older page, a
   * tunnelled tab). Numbers only — this stays a journal line, not a dump.
   */
  | {
      readonly kind: 'tab-death-profile';
      readonly tabId8: string;
      /** The abnormal close code that triggered the line. */
      readonly code: number;
      readonly censusAgeMs: number | null;
      /** {@link RecordedTabCensus} rather than `TabCensus`: the writer files a
       *  full census, but a line READ back may have been written before the
       *  mount census existed. */
      readonly census: RecordedTabCensus | null;
    }
  /** Two epochs beating under one tabId — "Duplicate Tab" copied sessionStorage. */
  | { readonly kind: 'tab-duplicated'; readonly tabId8: string }
  /**
   * The tab is present but its PAGE never came up this page-load. Presence
   * proves the tab exists, not that the document works — a main thread that
   * died after the inline bootstrap keeps beating and holding its control
   * connection, and can run nothing. Such a tab is passed over for blessing
   * and named in the refusal.
   *
   * `reason` says which stage it is stuck at: `'no-channel'` (the page never
   * opened a control connection at all) or `'no-command-listener'` (it did,
   * and the module graph behind it never produced a listener).
   */
  | {
      readonly kind: 'tab-unresponsive';
      readonly tabId8: string;
      readonly reason: 'no-channel' | 'no-command-listener';
      readonly unresponsiveForMs: number;
    }
  /**
   * An uncaught error or unhandled rejection in a tab's PAGE, captured by
   * `index.html`'s inline bootstrap — before the module graph, so it is
   * recorded even when the boot that would have reported it is the thing that
   * died. This is the line that says WHY a `tab-unresponsive` tab is
   * unresponsive.
   */
  | {
      readonly kind: 'page-error';
      readonly tabId8: string;
      readonly message: string;
    }
  /**
   * One batch of occurrences of ONE console error/warning condition, as the
   * server's unresolved-console ledger recorded it
   * (`packages/editor/server/console-ledger.ts`).
   *
   * This is the DURABLE half of the loudness convention, and the reason it is
   * a row per observation rather than a row per distinct message: `count` is
   * the running total after this batch, so the file answers "how many times
   * did this actually fire, and when did it stop" long after the ledger (and
   * the tab, and the server) are gone. A repeat is never filtered out here —
   * deduping repeats to silence is precisely the failure that made a session's
   * eleven errors read as one line and then nothing.
   */
  | {
      readonly kind: 'console-entry';
      readonly id: string;
      readonly severity: 'error' | 'warn';
      readonly source: string | null;
      /** Occurrences in THIS batch. */
      readonly added: number;
      /** Running total for this condition, across every page-load. */
      readonly count: number;
      readonly message: string;
    }
  /** A condition cleared by the honest re-test: the page reloaded and it did
   *  not recur. `count` is what it reached before it stopped. */
  | {
      readonly kind: 'console-retired';
      readonly id: string;
      readonly severity: 'error' | 'warn';
      readonly count: number;
      readonly message: string;
    }
  /** A condition waved through BY NAME (`vgai console ack`). The audit row is
   *  the whole point: an acknowledgment records who and why, and never erases
   *  what was acknowledged. */
  | {
      readonly kind: 'console-ack';
      readonly id: string;
      readonly severity: 'error' | 'warn';
      readonly count: number;
      readonly by: string;
      readonly reason: string;
      readonly message: string;
    }
  /** A condition cleared by its OWNER, which proved it gone by an event the
   *  reload rule cannot see — a play remount resolving its own
   *  `Restart required` warning. `by` names that owner, never a person. */
  | {
      readonly kind: 'console-resolved';
      readonly id: string;
      readonly severity: 'error' | 'warn';
      readonly count: number;
      readonly by: string;
      readonly message: string;
    };

/** A parsed journal line: the event plus when it was appended. */
export type SessionJournalLine = SessionJournalEvent & { readonly at: string };

/** An open journal. `append` never throws — a journal that breaks a save would
 *  be worse than a journal that misses a line. */
export interface SessionJournal {
  /** Absolute path of the file being appended to. */
  readonly path: string;
  append(event: SessionJournalEvent): void;
}

/** `editor-2026-08-09T12-34-56-789Z.jsonl` for a given instant. */
export function sessionJournalFilename(startedAt: Date): string {
  return `${PREFIX}${startedAt.toISOString().replace(/[:.]/g, '-')}${SUFFIX}`;
}

/**
 * Open (create) this session's journal under `<projectRoot>/logs/`.
 *
 * `null` when the directory cannot be created or the first write fails —
 * an unwritable project must degrade to "no journal", never to a crashed boot.
 */
export function openSessionJournal(
  projectRoot: string,
  startedAt: Date = new Date(),
): SessionJournal | null {
  const logsDir = join(projectRoot, 'logs');
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch {
    return null;
  }
  pruneJournals(logsDir);
  const path = join(logsDir, sessionJournalFilename(startedAt));
  const journal: SessionJournal = {
    path,
    append(event) {
      const line: SessionJournalLine = { at: new Date().toISOString(), ...event };
      try {
        appendFileSync(path, `${JSON.stringify(line)}\n`, 'utf-8');
      } catch {
        /* a journal that breaks the caller is worse than a missing line */
      }
    },
  };
  try {
    appendFileSync(path, '', 'utf-8');
  } catch {
    return null;
  }
  return journal;
}

/** Drop the oldest journals so opening one more stays at `MAX_JOURNAL_FILES`. */
function pruneJournals(logsDir: string): void {
  try {
    const files = readdirSync(logsDir)
      .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_JOURNAL_FILES + 1))) {
      try {
        unlinkSync(join(logsDir, f));
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no logs dir yet */
  }
}

/**
 * The newest journal in a project, or `null`.
 *
 * File-native on purpose (the same shape as the CLI's newest-play-log reader):
 * the journal path is a fact about the PROJECT DIRECTORY, so `vgai status` and
 * the boot pointer can name it without a server round-trip — and can still name
 * it after the session that wrote it is gone.
 */
export function newestSessionJournal(projectRoot: string): string | null {
  try {
    const files = readdirSync(join(projectRoot, 'logs'))
      .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
      .sort();
    const newest = files.at(-1);
    return newest ? join(projectRoot, 'logs', newest) : null;
  } catch {
    return null;
  }
}

/**
 * The newest journal's last `limit` lines of the requested kinds, oldest first.
 *
 * WHY A READER EXISTS AT ALL. The journal was written as a file an agent
 * "can read at any time", and the measured answer to that invitation was: it
 * doesn't. The foundry probe's journal held the notice-tier tripwire crossing
 * that predicted its own end-of-run batch commit, and nothing that agent ran
 * ever rendered a line of it. So the record grows a RENDERER on the command
 * agents already poll (`vgai status`) — same principle as the tripwires' own
 * origin: the mechanism was right and the delivery assumption was false.
 *
 * Every failure is the same case — no project, no journal, unreadable file, a
 * line that will not parse — and it is the empty list, never a throw. A status
 * command that crashed on a malformed log line would be a worse outcome than
 * one that says nothing about it.
 *
 * The whole file is read, which is what bounds this: a journal is one editor
 * session's surface-worthy transitions (the happy-path silence rule keeps
 * clean saves out), the pruner caps how many exist, and the alternative — a
 * reverse streaming reader over a file measured in kilobytes — is machinery
 * with nothing to buy.
 */
export function readRecentJournalEvents(
  projectRoot: string,
  kinds: readonly SessionJournalEvent['kind'][],
  limit: number,
): SessionJournalLine[] {
  const path = newestSessionJournal(projectRoot);
  if (path === null || limit <= 0) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const wanted = new Set<string>(kinds);
  const matched: SessionJournalLine[] = [];
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    let parsed: SessionJournalLine;
    try {
      parsed = JSON.parse(line) as SessionJournalLine;
    } catch {
      continue; // a torn final line is not a reason to report nothing
    }
    if (parsed && typeof parsed === 'object' && wanted.has(parsed.kind)) matched.push(parsed);
  }
  return matched.slice(-limit);
}

/**
 * One journal line as a scannable terminal line: `HH:MM:SS`, the kind, and
 * the few facts that line is about.
 *
 * ONE OWNER of this rendering, for `sessionJournalPointerLine`'s reason — the
 * events already have exactly one wording as data, and a second prose form per
 * caller is how a reader ends up believing there are two records.
 */
/** Split out of {@link formatJournalLine}'s switch for the same reason as
 *  {@link playRecordingLine} below. Seconds, because that is the unit the
 *  reader's complaint is in ("opening this project takes two minutes"), except
 *  the loop-delay pair — a p99 is a millisecond fact and rounding it to
 *  seconds would erase the only number that says WHO was waiting. */
function bootLine(line: Extract<SessionJournalEvent, { kind: 'boot' }>): string {
  const s = (ms: number): string => `${Math.round(ms / 100) / 10}s`;
  return (
    `boot ready ${s(line.listenMs)} (vite ${s(line.viteMs)}, dep-scan ${s(line.depScanMs)}) ` +
    `→ page bound +${s(line.boundMs)}` +
    (line.worldWarmupDoneMs === null ? '' : `, world warmup done ${s(line.worldWarmupDoneMs)}`) +
    ` — loop delay p99 ${line.loopDelayP99Ms}ms / max ${line.loopDelayMaxMs}ms`
  );
}

/** Split out of {@link formatJournalLine}'s switch so this row's three
 *  conditionals do not push that already-long function further over the
 *  complexity bound. */
function playRecordingLine(line: Extract<SessionJournalEvent, { kind: 'play-recording' }>): string {
  const why = line.reason === null ? '' : ` (${line.reason})`;
  const life = line.rotates ? ' — replaced by the next play' : ' — kept';
  return `play-recording ${line.action} .vgai/recordings/${line.file}${why}${life}`;
}

export function formatJournalLine(line: SessionJournalLine): string {
  const at = line.at.slice(11, 19);
  switch (line.kind) {
    case 'tripwire':
      return line.tripwire === 'commit-cadence'
        ? `journal: ${at} tripwire commit-cadence ${line.tier} (${line.fileCount} files, ${Math.round(line.ageMs / 60_000)}m)`
        : `journal: ${at} tripwire unplayed-session ${line.tier} (${Math.round(line.servingForMs / 60_000)}m)`;
    case 'validation':
      return `journal: ${at} validation ${line.ok ? 'ok' : 'FAILED'} ${line.path}`;
    case 'play':
      return `journal: ${at} play ${line.action}${line.name === null ? '' : ` [${line.name}]`}`;
    case 'play-recording':
      return `journal: ${at} ${playRecordingLine(line)}`;
    case 'play-stall':
      return (
        `journal: ${at} play-stall ${line.command} ${line.requestId8} after ` +
        `${Math.round(line.waitedMs / 1000)}s — ` +
        (line.phase === null
          ? 'no play boot was in flight'
          : `stuck in "${line.phase}" for ${Math.round((line.phaseAgeMs ?? 0) / 1000)}s`)
      );
    case 'session-started':
      return `journal: ${at} session-started pid ${line.pid}`;
    case 'project-opened':
      return `journal: ${at} project-opened ${line.project}`;
    case 'session-shutdown':
      return `journal: ${at} session-shutdown`;
    case 'session-shutdown-task':
      return (
        `journal: ${at} session-shutdown-task ${line.task} ${line.outcome} after ${line.ms}ms` +
        (line.detail === undefined ? '' : ` — ${line.detail}`)
      );
    case 'session-end-acked':
      return line.tabs === 0
        ? `journal: ${at} session-end-acked no tab was present`
        : `journal: ${at} session-end-acked ${line.tabs} tab(s) in ${line.ms}ms`;
    case 'session-end-unacked':
      return (
        `journal: ${at} session-end-unacked ${line.tabId8s.join(' ')} after ${line.ms}ms — ` +
        'their pages may still hold what the session started'
      );
    case 'boot':
      return `journal: ${at} ${bootLine(line)}`;
    // The TRANSPORT arm. One short line each, and every one of them names the
    // TAB or the request it is about — a column of ids is how these lines get
    // correlated, and a paragraph per line is how a reader stops reading.
    case 'client-connected':
      return `journal: ${at} client-connected ${line.clientId8} (${line.transport})`;
    case 'client-disconnected':
      return `journal: ${at} client-disconnected ${line.clientId8} code ${line.code ?? '-'} settled ${line.commandsSettled}`;
    case 'duplex-granted':
      return `journal: ${at} duplex-granted ${line.clientId8}`;
    case 'control-lifecycle-confirmed':
      return `journal: ${at} control-lifecycle-confirmed ${line.clientId8} connection ${line.connectionGeneration8}`;
    case 'control-lifecycle-rejected':
      return `journal: ${at} control-lifecycle-rejected ${line.clientId8} stale ${line.mismatch}`;
    case 'command-relayed':
      return `journal: ${at} command-relayed ${line.command} ${line.requestId8} -> tab ${line.tabId8 ?? 'none'}`;
    case 'command-receipt':
      return `journal: ${at} command-receipt ${line.requestId8}`;
    case 'command-swept-on-last-tab-gone':
      return `journal: ${at} command-swept-on-last-tab-gone ${line.settled} unreceipted`;
    case 'command-result':
      return `journal: ${at} command-result ${line.requestId8} ${line.ok ? 'ok' : `FAILED ${line.error ?? ''}`}`;
    case 'command-held':
      return `journal: ${at} command-held ${line.requestId8} tab ${line.tabId8} (${line.reason})`;
    case 'echo-probe':
      return `journal: ${at} echo-probe ${line.clientId8} ${line.answered ? 'answered' : 'UNANSWERED'} in ${line.waitedMs}ms`;
    case 'tab-blessed':
      return `journal: ${at} tab-blessed ${line.tabId8} (${line.reason})`;
    case 'tab-yielded':
      return `journal: ${at} tab-yielded ${line.tabId8}`;
    case 'tab-appeared':
      return `journal: ${at} tab-appeared ${line.tabId8} (${line.visibility})`;
    case 'tab-heartbeat-gap':
      return `journal: ${at} tab-heartbeat-gap ${line.tabId8} ${Math.round(line.sinceMs / 100) / 10}s`;
    case 'tab-gap-closed':
      return `journal: ${at} tab-gap-closed ${line.tabId8} after ${Math.round(line.gapMs / 100) / 10}s`;
    case 'tab-reloaded':
      return `journal: ${at} tab-reloaded ${line.tabId8} (page load ${line.epochCount})`;
    case 'page-phase':
      return `journal: ${at} page-phase ${line.phase ?? '(clear)'}`;
    case 'src-watch':
      return `journal: ${at} src-watch ${line.event} ${line.path}${line.mtimeMs === null ? ' (gone)' : ''}`;
    case 'tab-departed':
      return `journal: ${at} tab-departed ${line.tabId8} absent ${Math.round(line.absentMs / 100) / 10}s`;
    case 'tab-duplicated':
      return `journal: ${at} tab-duplicated ${line.tabId8}`;
    case 'tab-unresponsive':
      return `journal: ${at} tab-unresponsive ${line.tabId8} ${line.reason} for ${Math.round(line.unresponsiveForMs / 1000)}s`;
    case 'page-error':
      return `journal: ${at} page-error ${line.tabId8} ${line.message}`;
    case 'tab-death-profile':
      return `journal: ${at} tab-death-profile ${line.tabId8} code ${line.code} — ${tabDeathProfileBody(line)}`;
    // The CONSOLE arm. `count` is the running total for that condition, so a
    // reader scanning the column sees a repeat climbing rather than the same
    // line over and over with nothing to distinguish the fiftieth from the
    // first. Every line leads with the ack id, because that is what a reader
    // types next.
    case 'console-entry':
      return `journal: ${at} console-${line.severity} ${line.id} +${line.added} (total ${line.count}) ${line.source === null ? '' : `[${line.source}] `}${line.message.split('\n')[0]}`;
    case 'console-retired':
      return `journal: ${at} console-retired ${line.id} after ${line.count} — did not recur after reload`;
    case 'console-ack':
      return `journal: ${at} console-ack ${line.id} (×${line.count}) by ${line.by}: ${line.reason}`;
    case 'console-resolved':
      return `journal: ${at} console-resolved ${line.id} after ${line.count} — ${line.by} cleared the condition it raised`;
  }
}

/** The census half of a `tab-death-profile` line, split out so the switch above
 *  stays one expression per case. */
function tabDeathProfileBody(line: SessionJournalEvent & { kind: 'tab-death-profile' }): string {
  const census = formatTabCensus(line.census);
  if (line.censusAgeMs === null) return census;
  return `${census} (sampled ${Math.round(line.censusAgeMs / 100) / 10}s before)`;
}

/** The resource profile a `tab-death-profile` line and a `vgai status` tab row
 *  both quote. ONE wording, for `sessionJournalPointerLine`'s reason: two
 *  phrasings of the same numbers is how a reader ends up believing there are
 *  two measurements. Renderer counts appear only when the page could read them
 *  (no mounted render-debug adapter = the words are absent, never a zero). */
/**
 * The Blender block's words: what the Blender worker and this tab's main thread
 * have been doing. Absent entirely in a tab with no Blender session.
 *
 * `in flight` is the field that speaks during a wedge — the 2026-09-16 call
 * that held the worker 1,800s produced no other number anywhere in the product.
 * A field the page could not measure is OMITTED rather than printed as 0: no
 * call yet, or no Long Tasks API (Safari/Firefox), is not "never stalled".
 */
function formatBlenderMetrics(blender: BlenderTabMetrics): string {
  const s = (ms: number): string => `${Math.round(ms / 100) / 10}s`;
  const parts = [
    blender.inFlightMs === null ? 'idle' : `IN FLIGHT ${s(blender.inFlightMs)}`,
    // First after the wedge field, because it is the tab's LARGEST number and
    // the one the heap line above is routinely mistaken for.
    ...(blender.wasmMemoryMB === null || blender.wasmMemoryMB === undefined
      ? []
      : [`engine memory ${blender.wasmMemoryMB}MB`]),
    ...(blender.lastCallMs === null ? [] : [`last call ${s(blender.lastCallMs)}`]),
    ...(blender.maxCallMs === null ? [] : [`max ${s(blender.maxCallMs)}`]),
    `over 5s ${blender.callsOver5s}`,
    `over 30s ${blender.callsOver30s}`,
    ...(blender.longestTaskMs === null
      ? []
      : [
          `longest main-thread task ${s(blender.longestTaskMs)} (${blender.tasksOver100ms} over 100ms)`,
        ]),
    ...(blender.lastCallLongestTaskMs === null
      ? []
      : [`${s(blender.lastCallLongestTaskMs)} of that during the last call`]),
  ];
  return `blender: ${parts.join(', ')}`;
}

export function formatTabCensus(census: RecordedTabCensus | null): string {
  if (census === null) return 'no resource census';
  const parts = [
    census.heapUsedMB === null
      ? 'heap n/a'
      : `heap ${census.heapUsedMB}MB${census.heapLimitMB === null ? '' : `/${census.heapLimitMB}MB`}`,
    `canvas ${census.canvasMB}MB in ${census.canvases}`,
  ];
  if (census.mountEpochs !== undefined) parts.splice(1, 0, `mount epochs ${census.mountEpochs}`);
  if (census.textures !== undefined) parts.push(`tex ${census.textures}`);
  if (census.geometries !== undefined) parts.push(`geo ${census.geometries}`);
  if (census.programs !== undefined) parts.push(`prog ${census.programs}`);
  const line = parts.join(', ');
  // On its own line: the Blender block answers a different question from the
  // resource profile (is the tab ANSWERING, not what is it holding), and
  // running the two together is how a reader stops seeing either.
  return census.blender === undefined
    ? line
    : `${line}\n            ${formatBlenderMetrics(census.blender)}`;
}

/**
 * The ONE wording for "here is the journal" — printed by the editor server's
 * boot block, by `vgai edit`'s ready/detach lines, and by `vgai status`.
 *
 * One owner of the sentence, for `build-discipline.ts`'s reason: three
 * processes point at this file, and a second phrasing of the same pointer is
 * how a reader ends up believing there are two things.
 */
export function sessionJournalPointerLine(journalPath: string): string {
  return `Session journal: ${journalPath} — structured JSONL, read it any time`;
}
