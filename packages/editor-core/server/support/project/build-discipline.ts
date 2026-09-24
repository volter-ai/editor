/**
 * The build-discipline tripwires: "how long has this work been sitting
 * uncommitted?" and "has this session ever run the game at all?", plus the
 * cheap project reads behind them.
 *
 * WHY THIS LIVES IN THE SDK. It started in the CLI, wired to `vgai status`
 * alone — and a measured 17-minute blind build ran the editor and
 * `eval` while invoking `vgai status` ZERO times. The mechanisms were right;
 * the delivery assumption ("a building agent polls status constantly") was
 * false. Routing the SAME banners through the surfaces a build actually
 * crosses means two processes must compose them — the CLI and the editor dev
 * server — so the text and the thresholds move to the layer both already
 * depend on (this package: CLI -> SDK -> engine, never the reverse). There is
 * exactly ONE owner of the wording and ONE owner of the numbers; every
 * channel calls it.
 *
 * COMMIT CADENCE. Measured failure (blind-probe audit, three consecutive
 * probes): each quoted the project docs' "one commit per slice" bar back at
 * the reader, and each then shipped its ENTIRE build as one end-of-run commit.
 * The rule was read, understood, agreed with, and violated, because nothing
 * fired DURING the violation: prose is only ever read before the work, and a
 * commit that never happens produces no event.
 *
 * What it measures is NOT "time since the last commit" — a repo whose last
 * commit is three days old but whose first edit landed two minutes ago is not
 * behind on anything. The age of the CURRENT uncommitted batch is when its
 * oldest still-dirty file was written, floored at the last commit (work cannot
 * have been uncommitted before the commit that would have contained it). That
 * floor is what stops a long-parked dirty file from crying wolf forever.
 *
 * LIVE EVIDENCE. Measured failure, same audit: the final source edits of a
 * build shipped with zero runtime evidence behind them — eleven turns of code
 * nothing ever executed, handed off as finished, with every green check in the
 * terminal agreeing. Nothing in the toolchain could disagree: typecheck, tests
 * and validators all answer questions about the SOURCE, and the one question
 * left is whether the source was ever run. `staleEvidenceBanner` asks it of
 * the code on disk; `unplayedSessionBanner` asks it of the session's own clock,
 * which is the only one that can see the OPENING stretch of a build (a session
 * that has never played has no evidence for the source to be stale against).
 *
 * None of this is a poller and none of it is a hook: every function here is
 * either pure or a handful of `git`/`stat` reads made on an event the caller
 * already handles.
 */

import { commandLine } from '../../../src/product-command';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/**
 * How loud a tripwire is right now.
 *
 * Three steps, not a number that grows: a single line at `notice` reads as
 * information, the block at `loud` reads as a problem, and the difference is
 * what makes "45m" land differently from "3m". It is also what an event-driven
 * channel debounces on — see `advanceTripwireGate`.
 */
export type TripwireTier = 'silent' | 'notice' | 'loud';

const TIER_RANK: Record<TripwireTier, number> = { silent: 0, notice: 1, loud: 2 };

/** `12m`, `1h 06m` — a duration a reader can compare at a glance. */
function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

// ---------------------------------------------------------------------------
// Commit cadence
// ---------------------------------------------------------------------------

/**
 * The escalation steps, in ms.
 *
 * NOTICE at 10 minutes: roughly one honest slice. Early enough that the
 * warning can still change the outcome (the measured probes had already
 * finished several committable slices by then), late enough that an ordinary
 * in-progress edit never sees it.
 *
 * LOUD at 25 minutes: the measured defect was a 26-minute single-commit build,
 * so the loud step has to land BEFORE that, not at it — a banner that first
 * appears at the moment the mistake completes has reported history, not
 * prevented anything.
 */
const CADENCE_NOTICE_MS = 10 * 60_000;
const CADENCE_LOUD_MS = 25 * 60_000;

/** Bound on the per-file stat fan-out. A batch this large is already far past
 *  every threshold below, so the extra files cannot change the verdict. */
const MAX_DIRTY_PATHS_DATED = 300;

/** The current uncommitted batch: how old it is, and how much is in it. */
export interface UncommittedWork {
  /** ms since the oldest still-dirty change in this batch (floored at the last commit). */
  readonly ageMs: number;
  /** Number of dirty paths git reported (tracked modifications + untracked). */
  readonly fileCount: number;
}

/**
 * Age of the current uncommitted batch — pure, so the floor rule is testable
 * as data-in/answer-out.
 *
 * `null` when there is nothing to date. `lastCommitAtMs` is `null` on an
 * unborn HEAD (no commit to floor against, so the file mtime stands alone).
 */
export function uncommittedWorkAge(
  now: number,
  lastCommitAtMs: number | null,
  oldestDirtyMtimeMs: number | null,
): number | null {
  if (oldestDirtyMtimeMs === null) return null;
  const startedAt =
    lastCommitAtMs === null ? oldestDirtyMtimeMs : Math.max(lastCommitAtMs, oldestDirtyMtimeMs);
  return Math.max(0, now - startedAt);
}

/** Which step the batch has reached — the ONE place the cadence thresholds are
 *  compared, so every channel (status, dev server, eval) agrees. */
export function commitCadenceTier(work: UncommittedWork | null): TripwireTier {
  if (!work || work.ageMs < CADENCE_NOTICE_MS) return 'silent';
  return work.ageMs < CADENCE_LOUD_MS ? 'notice' : 'loud';
}

/**
 * The ONE sentence this tripwire says in a single line.
 *
 * Shared by the notice step of `commitCadenceBanner` and by
 * `commitCadenceNotice`, so a channel that cannot afford a block still says
 * exactly what the block says — never a second wording of the same rule.
 */
function cadenceLine(work: UncommittedWork): string {
  return (
    `uncommitted work for ${formatElapsed(work.ageMs)} (${work.fileCount} file(s)) — ` +
    'the bar is one commit per slice; commit the slice that already works'
  );
}

/**
 * The escalating stderr line/banner for uncommitted work — pure, driven
 * directly by a test. `null` below NOTICE and whenever there is no batch at
 * all.
 *
 * THE TWO TIERS SAY DIFFERENT KINDS OF THING, deliberately. Notice DESCRIBES
 * (`cadenceLine`): at ten minutes a reader is mid-slice and the useful signal
 * is the clock. Loud PRESCRIBES: it opens with the imperative and the literal
 * two commands, because the measured failure is not ignorance of the rule —
 * three consecutive probes quoted "one commit per slice" back at the reader
 * and then batch-committed anyway. A banner that restates a rule the reader
 * already agrees with adds nothing; the one that names the next keystroke is
 * the one that can change the outcome.
 */
export function commitCadenceBanner(work: UncommittedWork | null): string | null {
  const tier = commitCadenceTier(work);
  if (!work || tier === 'silent') return null;
  if (tier === 'notice') return cadenceLine(work);
  const age = formatElapsed(work.ageMs);
  return [
    '================================================================',
    `  COMMIT NOW — UNCOMMITTED WORK FOR ${age.toUpperCase()}`,
    '================================================================',
    '  Commit NOW, one commit per slice (AGENTS.md):',
    '    git add <your files> && git commit -m "<mechanic>"',
    '',
    `  Uncommitted work is ${age} old across ${work.fileCount} file(s).`,
    '  A build that lands as a single end-of-run commit cannot be',
    '  reviewed, bisected, or partially recovered when a later step goes',
    '  wrong — and a build that reaches this banner is on exactly that',
    '  path. Commit the slice that already works, then keep going.',
    '================================================================',
  ].join('\n');
}

/**
 * The same tripwire as ONE line, at every step including the loud one.
 *
 * For channels whose output is parsed rather than read — `vgai eval` prints a
 * game's own JSON, and a fifteen-line block dropped beside it corrupts more
 * than it warns. Same sentence as the notice step of the banner (`cadenceLine`
 * is the single source); the only thing dropped is the block.
 */
export function commitCadenceNotice(work: UncommittedWork | null): string | null {
  if (!work || commitCadenceTier(work) === 'silent') return null;
  return cadenceLine(work);
}

/**
 * The dirty paths in a `git status --porcelain -z` payload — pure, because the
 * record shape is the one part of this that is easy to get quietly wrong.
 *
 * `-z` rather than plain porcelain because porcelain QUOTES paths containing
 * special characters, and a quoted path stats as nothing. Records are
 * `XY <path>`; a rename adds a second, prefix-less chunk holding the SOURCE
 * path, which the shape test skips — the destination is the file on disk.
 * Paths are relative to the repository root, not to cwd.
 */
export function dirtyPathsFromPorcelain(porcelain: string): string[] {
  const paths: string[] = [];
  for (const chunk of porcelain.split('\0')) {
    const match = /^(..) (.+)$/.exec(chunk);
    if (match?.[2]) paths.push(match[2]);
  }
  return paths;
}

/** Runs git in `cwd`. `null` for ANY failure — git missing, not a repository,
 *  unborn HEAD, non-zero exit — because each of those means "this project
 *  cannot be asked the question", not "this project is behind". */
function git(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout ?? '';
}

/**
 * Read the current uncommitted batch for `projectRoot`.
 *
 * `null` — say nothing — when there is no project, no git work tree, or a
 * clean tree. Two `git` invocations plus one `stat` per dirty path (capped),
 * made on a caller's own event (a status request, a
 * save the dev server already validated) — never on a timer.
 */
export function readUncommittedWork(
  projectRoot: string | null,
  now: number = Date.now(),
): UncommittedWork | null {
  if (!projectRoot) return null;
  const topLevel = git(projectRoot, ['rev-parse', '--show-toplevel'])?.trim();
  if (!topLevel) return null;

  // The `.` pathspec is what scopes the question to this project when it sits
  // inside a larger repo.
  const porcelain = git(projectRoot, ['status', '--porcelain', '-z', '--', '.']);
  if (porcelain === null) return null;
  const paths = dirtyPathsFromPorcelain(porcelain);
  if (paths.length === 0) return null;

  let oldest: number | null = null;
  for (const relative of paths.slice(0, MAX_DIRTY_PATHS_DATED)) {
    try {
      const mtime = statSync(join(topLevel, relative)).mtimeMs;
      if (oldest === null || mtime < oldest) oldest = mtime;
    } catch {
      /* a deleted path dates nothing */
    }
  }

  const committedAt = git(projectRoot, ['log', '-1', '--format=%ct'])?.trim();
  const lastCommitAtMs =
    committedAt && /^\d+$/.test(committedAt) ? Number.parseInt(committedAt, 10) * 1000 : null;

  const ageMs = uncommittedWorkAge(now, lastCommitAtMs, oldest);
  if (ageMs === null) return null;
  return { ageMs, fileCount: paths.length };
}

// ---------------------------------------------------------------------------
// Live evidence
// ---------------------------------------------------------------------------

/** Directories never walked when dating a project's source: build output,
 *  dependencies, and the evidence directories themselves (a run's artifacts
 *  must never read as a source change). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.vgai',
  '.agents',
  '.claude',
  '.github',
  'dist',
  'dist-server',
  'build',
  'logs',
  'coverage',
  '.turbo',
  '.vite',
  'test-results',
  'playwright-report',
]);

/** Extensions that count as project source for dating purposes. */
const SOURCE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html'];

/** Bound on the walk. A project big enough to exceed it is one where the
 *  answer is dominated by the first few thousand files anyway, and a status
 *  poll must stay cheap whatever it is pointed at. */
const MAX_FILES_WALKED = 4000;

/**
 * The newest mtime (epoch ms) among the project's own source files, or `null`
 * when there are none to date.
 *
 * `src/` plus the manifest and package.json — the files whose change means
 * "the build is different now". Deliberately NOT the whole tree: a screenshot
 * landing in `.vgai/`, a log line, or a `node_modules` touch is not a source
 * change, and treating it as one would make the banner cry wolf on its own
 * evidence.
 */
export function newestSourceMtime(projectRoot: string): number | null {
  let newest: number | null = null;
  let walked = 0;

  const consider = (file: string): void => {
    try {
      const at = statSync(file).mtimeMs;
      if (newest === null || at > newest) newest = at;
    } catch {
      /* a file that vanished mid-walk dates nothing */
    }
  };

  const isDirectory = (file: string): boolean | null => {
    try {
      return statSync(file).isDirectory();
    } catch {
      return null; // vanished mid-walk
    }
  };

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (walked >= MAX_FILES_WALKED) return;
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const isDir = isDirectory(full);
      if (isDir === null) continue;
      if (isDir) walk(full);
      else if (SOURCE_EXT.some((ext) => entry.endsWith(ext))) {
        walked += 1;
        consider(full);
      }
    }
  };

  walk(join(projectRoot, 'src'));
  for (const file of ['vgai.project.json', 'package.json']) {
    const full = join(projectRoot, file);
    if (existsSync(full)) consider(full);
  }
  return newest;
}

/**
 * The newest mtime (epoch ms) among this project's LIVE-EVIDENCE artifacts, or
 * `null` when the game has never run.
 *
 * The artifact is the same one the idiom checker's "has this ever been
 * played" rule reads, for the same reason: it is written by the editor server
 * itself while a real browser runs the real game, so it cannot be produced by
 * intending to play.
 *   - `logs/play-*.jsonl` — one per Play session, opened by the editor server.
 */
export function newestEvidenceMtime(projectRoot: string): number | null {
  let newest: number | null = null;
  const consider = (file: string): void => {
    try {
      const at = statSync(file).mtimeMs;
      if (newest === null || at > newest) newest = at;
    } catch {
      /* unreadable: not evidence */
    }
  };

  const logsDir = join(projectRoot, 'logs');
  try {
    for (const entry of readdirSync(logsDir)) {
      if (entry.startsWith('play-') && entry.endsWith('.jsonl')) consider(join(logsDir, entry));
    }
  } catch {
    /* no logs dir */
  }
  return newest;
}

/** The later of two optional instants — how a caller combines the two walks
 *  above into one "when did anything about this project last change" number. */
export function latestOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * The loud banner for SOURCE THAT HAS NEVER RUN — pure so it can be driven
 * directly by a test.
 *
 * `null` in the two honest silences:
 *   - a project with no datable source (nothing to be stale);
 *   - source no newer than the newest evidence (the running build IS this code).
 *
 * NOT silent when there is no evidence at all: a project that has never run is
 * the strongest form of the thing this reports, not an exemption from it.
 */
export function staleEvidenceBanner(
  newestSource: number | null,
  newestEvidence: number | null,
): string | null {
  if (newestSource === null) return null;
  if (newestEvidence !== null && newestEvidence >= newestSource) return null;
  const gap =
    newestEvidence === null
      ? '  no live evidence exists at all — no logs/play-*.jsonl.'
      : `  newest source: ${new Date(newestSource).toISOString()}\n` +
        `  newest live evidence: ${new Date(newestEvidence).toISOString()}`;
  return [
    '================================================================',
    '  SOURCE CHANGED SINCE LAST LIVE EVIDENCE',
    '================================================================',
    gap,
    '',
    '  The shipped build has never run. Typecheck, tests and validators all',
    '  answer questions about the source; whether it WORKS is a question only',
    '  running it can answer — and the pixel-only failures (blank canvas,',
    '  invisible mesh, camera inside the geometry) are invisible to every one',
    '  of them.',
    '',
    `  Play before claiming it works: ${commandLine('play')}, then look, and playtest`,
    `  live through ${commandLine('eval')}.`,
    '================================================================',
  ].join('\n');
}

/**
 * The escalation steps for "this session has never played", in ms.
 *
 * NOTICE at 5 minutes: the opening minutes of a session are legitimately spent
 * reading the brief and the scaffold, so a line before that would fire on
 * every single session and be tuned out by the second one.
 *
 * LOUD at 15 minutes: the measured blind stretch was 11 minutes, so the loud
 * step lands just past it rather than at the end of a build — by 15 minutes a
 * session has authored real gameplay it has never once watched run.
 */
const UNPLAYED_NOTICE_MS = 5 * 60_000;
const UNPLAYED_LOUD_MS = 15 * 60_000;

/**
 * Which step the "never played" clock has reached — the ONE place the unplayed
 * thresholds are compared.
 *
 * `silent` in the honest silences: no session serving this project (no clock to
 * run), or evidence at least as new as the session start (this session HAS
 * played, and how long ago is `staleEvidenceBanner`'s question, not this one).
 */
export function unplayedSessionTier(
  sessionStartedAtMs: number | null,
  newestEvidence: number | null,
  now: number,
  /** Does the project declare anything to play? A MODELS project (no roots)
   *  has no game to run; the nag sent one to `vgai play`, which refused,
   *  and the refusal sat on the console (blind lantern round, 2026-09-06). */
  playable = true,
): TripwireTier {
  if (!playable) return 'silent';
  if (sessionStartedAtMs === null) return 'silent';
  if (newestEvidence !== null && newestEvidence >= sessionStartedAtMs) return 'silent';
  const servingForMs = now - sessionStartedAtMs;
  if (servingForMs < UNPLAYED_NOTICE_MS) return 'silent';
  return servingForMs < UNPLAYED_LOUD_MS ? 'notice' : 'loud';
}

/**
 * The escalating line/banner for a session that has served this project
 * without ever producing live-play evidence — pure, driven directly by a test.
 *
 * The evidence signal is the SAME pair `newestEvidenceMtime` walks (a Play
 * session's `logs/play-*.jsonl`), so this
 * banner and the staleness banner can never disagree about what counts as
 * having run. Nothing new is instrumented on the game side: both artifacts are
 * already written by the tools themselves while a real browser runs the real
 * game, which is exactly why neither can be produced by intending to play.
 */
export function unplayedSessionBanner(
  sessionStartedAtMs: number | null,
  newestEvidence: number | null,
  now: number,
  playable = true,
): string | null {
  const tier = unplayedSessionTier(sessionStartedAtMs, newestEvidence, now, playable);
  if (tier === 'silent' || sessionStartedAtMs === null) return null;
  const elapsed = formatElapsed(now - sessionStartedAtMs);
  if (tier === 'notice') {
    return (
      `unplayed for ${elapsed} — this editor session has never run the game; ` +
      `start it now (${commandLine('play')}) rather than at the end`
    );
  }
  return [
    '================================================================',
    `  ${elapsed.toUpperCase()} SERVING THIS PROJECT, NEVER ONCE PLAYED`,
    '================================================================',
    '  No Play session and no bot run has produced any live evidence since',
    '  this editor session started.',
    '',
    '  Every gate that has passed so far answered a question about the',
    '  SOURCE. The failures that only a running game shows — blank canvas,',
    '  invisible mesh, camera inside the geometry, input that reaches',
    '  nothing — are invisible to all of them, and the longer the first play',
    '  is deferred the more work is stacked on top of an unverified base.',
    '',
    `  Play it now: ${commandLine('play')}, then look — and direct the resident tester`,
    `  from the live session (${commandLine('eval')}).`,
    '================================================================',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The event-driven channel's gate
// ---------------------------------------------------------------------------

/**
 * What an event-driven channel remembers between events.
 *
 * The editor dev server prints these banners on the save/validation event it
 * ALREADY handles — no timer, no poller — and a save burst is dozens of those
 * events in a second. Two things therefore have to be bounded: how often the
 * (git + stat) reads run at all, and how often the same warning is repeated.
 */
export interface TripwireGate {
  /** When the reads last ran, or `null` if they never have. */
  readonly evaluatedAtMs: number | null;
  /** The highest tier announced since the tripwire last went quiet. */
  readonly announced: TripwireTier;
}

/** A gate that has never evaluated and never announced — the initial state, and
 *  what a project switch resets to. */
export const IDLE_TRIPWIRE_GATE: TripwireGate = { evaluatedAtMs: null, announced: 'silent' };

/**
 * Floor on how often the reads run, whatever the event rate.
 *
 * A minute is far finer than any threshold here (the earliest is 5 minutes),
 * so it costs the banner no timeliness at all, while a 50-file save burst pays
 * for at most one `git status` instead of fifty.
 */
export const TRIPWIRE_MIN_EVAL_INTERVAL_MS = 60_000;

/** May this event pay for the reads, or has one already run recently enough? */
export function shouldEvaluateTripwires(gate: TripwireGate, now: number): boolean {
  return gate.evaluatedAtMs === null || now - gate.evaluatedAtMs >= TRIPWIRE_MIN_EVAL_INTERVAL_MS;
}

/**
 * Fold a freshly measured tier into the gate: print only on a CROSSING.
 *
 * `announce` is true exactly when the tier is higher than the highest one
 * already announced, so a burst of saves at the same tier prints once, the
 * escalation to `loud` prints again, and dropping back (a commit landed, a play
 * happened) re-arms the gate for the next crossing. Debounce as a rank
 * comparison rather than a wall-clock window: it is what "at most once per
 * threshold crossing" literally means, and it needs no clock to be correct.
 */
export function advanceTripwireGate(
  gate: TripwireGate,
  tier: TripwireTier,
  now: number,
): { readonly announce: boolean; readonly gate: TripwireGate } {
  return {
    announce: TIER_RANK[tier] > TIER_RANK[gate.announced],
    gate: { evaluatedAtMs: now, announced: tier },
  };
}

// ---------------------------------------------------------------------------
// The gate, across process restarts
// ---------------------------------------------------------------------------

/**
 * WHY THE GATE IS ON DISK.
 *
 * Measured failure (the "foundry" blind probe, 45 minutes): the commit-cadence
 * tripwire announced at NOTICE mid-run — `{"tier":"notice","ageMs":679238,
 * "fileCount":23}` is in that session's journal — and the LOUD step never
 * announced once across three editor-server restarts, while the agent went on
 * to batch-commit all 23 files at the end. The gate above is correct and the
 * process holding it is not: an editor server restarts (a crash, a config
 * change, `vgai restart`) far more often than a dirty batch resolves, and each
 * restart re-armed at `announced: 'silent'`, so a batch that had already been
 * noticed simply got noticed AGAIN at the same tier — never escalated. The
 * loudest step of the escalation was unreachable by construction for exactly
 * the builds it exists to catch.
 *
 * WHAT IS KEYED, AND WHY IT IS NOT A TIMESTAMP. The persisted record carries a
 * KEY alongside the announced tier, and a key that differs from the one being
 * asked about reads as a fresh gate. The key is what "the tripwire went quiet"
 * means for that tripwire — the same thing the in-memory gate re-arms on:
 *   - `commit-cadence` — the last commit (`commitCadenceGateKey`). A commit
 *     lands, the key changes, the next batch is heard from zero.
 *   - `unplayed-session` — the newest live evidence
 *     (`unplayedSessionGateKey`). A play happens, the key changes, the clock
 *     starts over.
 * `evaluatedAtMs` is deliberately NOT persisted: it is the read cap, a fact
 * about one process's event rate, and carrying it across a restart would blind
 * the first minute of the new session for no benefit.
 */

/** The tripwires with a persisted gate — the same names the session journal
 *  uses, so a journal line and a gate entry can never disagree about which
 *  tripwire is meant. */
export type TripwireName = 'commit-cadence' | 'unplayed-session';

/** One tripwire's persisted state. */
interface PersistedGate {
  readonly key: string;
  readonly announced: TripwireTier;
}

/**
 * Where the gate lives, project-relative.
 *
 * Under `.vgai/` beside the other machine-local caches (`check-idioms.json`),
 * and inside a directory `newestSourceMtime` already skips — so the file the
 * tripwire writes can never read as a source change and make the tripwire cry
 * wolf on its own output. It is gitignored in the scaffold for the same
 * reason it must never count: a gate write that dirtied the tree would add a
 * file to the very `fileCount` it is reporting.
 */
export const TRIPWIRE_GATE_PATH = join('.vgai', 'tripwire-gate.json');

function gateFilePath(projectRoot: string): string {
  return join(projectRoot, TRIPWIRE_GATE_PATH);
}

/** The whole file, or an empty record. Corrupt, missing, unreadable and
 *  not-an-object are ONE case: a fresh gate, never a throw. A discipline
 *  banner that crashed a save would be worse than one that repeated itself. */
function readGateFile(projectRoot: string): Record<string, PersistedGate> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(gateFilePath(projectRoot), 'utf-8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, PersistedGate>;
  } catch {
    return {};
  }
}

/** Best-effort write. Same rule as the read: never throws. */
function writeGateFile(projectRoot: string, file: Record<string, PersistedGate>): void {
  const path = gateFilePath(projectRoot);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  } catch {
    /* an unwritable project degrades to the in-memory gate */
  }
}

/**
 * The highest tier already announced for `name` under `key` — `silent` when
 * nothing is recorded, when the file is unreadable, or when the recorded key
 * is a different one (which is what "the tripwire went quiet" looks like on
 * disk).
 */
export function readAnnouncedTier(
  projectRoot: string,
  name: TripwireName,
  key: string,
): TripwireTier {
  const entry = readGateFile(projectRoot)[name];
  if (!entry || entry.key !== key) return 'silent';
  return entry.announced in TIER_RANK ? entry.announced : 'silent';
}

/** The commit-cadence key: the commit the current batch sits on top of.
 *  A constant outside a work tree — the tripwire is silent there anyway. */
export function commitCadenceGateKey(projectRoot: string | null): string {
  if (!projectRoot) return 'no-project';
  return git(projectRoot, ['rev-parse', 'HEAD'])?.trim() || 'unborn';
}

/** The unplayed-session key: the newest live evidence this project has, which
 *  is precisely what makes that tripwire go quiet. */
export function unplayedSessionGateKey(newestEvidence: number | null): string {
  return newestEvidence === null ? 'never-played' : String(newestEvidence);
}

/**
 * {@link advanceTripwireGate}, with the announced tier read from and written
 * back to the project — so a crossing announces once per crossing rather than
 * once per crossing PER PROCESS.
 *
 * The in-memory gate is still the caller's: it carries `evaluatedAtMs` (the
 * read cap) and its own `announced` is folded in as a floor, so a failed write
 * degrades to the old behavior rather than to a repeating banner. Persistence
 * rides this call and nothing else — there is no poller, no watcher, and no
 * second place that touches the file.
 */
export function advancePersistedTripwireGate(
  projectRoot: string,
  name: TripwireName,
  key: string,
  gate: TripwireGate,
  tier: TripwireTier,
  now: number,
): { readonly announce: boolean; readonly gate: TripwireGate } {
  const onDisk = readAnnouncedTier(projectRoot, name, key);
  const announced = TIER_RANK[onDisk] > TIER_RANK[gate.announced] ? onDisk : gate.announced;
  const step = advanceTripwireGate({ evaluatedAtMs: gate.evaluatedAtMs, announced }, tier, now);
  writeGateFile(projectRoot, {
    ...readGateFile(projectRoot),
    [name]: { key, announced: step.gate.announced },
  });
  return step;
}
