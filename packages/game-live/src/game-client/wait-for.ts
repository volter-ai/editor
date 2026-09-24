/**
 * Pure `game.waitFor` budget math — no Playwright, no browser. Polls a
 * caller-supplied snapshot source and evaluates a predicate against ONE
 * batched read per iteration (AC-B1.2: a predicate reading two providers
 * mutated between polls never sees a mixed frame). Kept separate from
 * `client.ts`'s Playwright wiring so it unit-tests headlessly (Task 3.2's
 * architecture requirement).
 */

import { SESSION_ERROR_CODES, SessionError } from './errors.js';
import type { DebugSnapshot } from './types.js';

export type WaitForBudget = { simSeconds: number } | { simTicks: number };

/** Byte-exact per Task 3.2 item: `waitFor`'s options type has no `timeout`
 *  key; this is the runtime guard for the mistake weaker models make anyway. */
export const WAIT_FOR_TIMEOUT_OPTION_MESSAGE =
  'waitFor takes { simSeconds } — budgets are sim-time (the game may run at 0.3x wall speed under SwiftShader); there is no wall-clock timeout here';

/**
 * The teaching message for a budget passed POSITIONALLY —
 * `game.waitSimTime(0.5)` instead of `game.waitSimTime({ simSeconds: 0.5 })`.
 *
 * That call used to be accepted in silence and was measured (blind build
 * probe, 2026-08-06) doing the worst possible thing: `0.5` has no
 * `simSeconds`, so the loop compares an elapsed delta against `undefined`,
 * which is false forever. Against a HIDDEN tab — where the client drives
 * deterministic ticks itself, so the frozen-clock stall guard never fires —
 * the call simply never returns. Nothing is printed, nothing errors, and the
 * caller is left with a wait that has nothing to do with their game.
 *
 * `describeBudgetArgument` names what actually arrived, because the whole
 * failure is that the argument LOOKS reasonable.
 */
export function positionalBudgetMessage(method: string, budget: unknown): string {
  return (
    `game.${method} takes an OPTIONS OBJECT and got ${describeBudgetArgument(budget)} — ` +
    'a positional budget is not read at all, so the wait never completes on its own. ' +
    `Write it as: game.${method}({ simSeconds: 0.5 })  (or { simTicks: 30 }). ` +
    'In eval scope: editor, game, page, tools, session.'
  );
}

/** What actually arrived, for `positionalBudgetMessage` — a short, honest
 *  rendering rather than `[object Object]`/`undefined` ambiguity. */
function describeBudgetArgument(budget: unknown): string {
  if (budget === null) return 'null';
  if (budget === undefined) return 'no argument';
  if (Array.isArray(budget)) return `an array (${JSON.stringify(budget)})`;
  return `the ${typeof budget} ${JSON.stringify(budget) ?? String(budget)}`;
}

/** Throws (not merely a type error) if `budget` is not an options object at
 *  all, is missing both recognized keys, or carries a `timeout` key. Called
 *  before any polling starts. `method` names the call in the message, because
 *  this guard now fronts several of them (`waitFor`, `waitSimTime`,
 *  `fastForward`, `input.hold`) and an error naming the wrong one sends the
 *  reader to the wrong line.
 *  M8: throws the package's own `SessionError` carrying the frozen
 *  `WAIT_FOR_INVALID_BUDGET` code (not a bare `Error`) — every failure this
 *  package throws must carry a machine-readable code (see errors.ts's module
 *  doc); a bare `Error` here was the one place that rule was broken. */
export function assertValidWaitForBudget(
  budget: unknown,
  method = 'waitFor',
): asserts budget is WaitForBudget {
  const isObject = !!budget && typeof budget === 'object';
  if (!isObject) {
    throw new SessionError(
      SESSION_ERROR_CODES.WAIT_FOR_INVALID_BUDGET,
      positionalBudgetMessage(method, budget),
    );
  }
  if ('timeout' in (budget as Record<string, unknown>)) {
    throw new SessionError(
      SESSION_ERROR_CODES.WAIT_FOR_INVALID_BUDGET,
      WAIT_FOR_TIMEOUT_OPTION_MESSAGE,
    );
  }
  const hasSimSeconds = 'simSeconds' in (budget as Record<string, unknown>);
  const hasSimTicks = 'simTicks' in (budget as Record<string, unknown>);
  if (!hasSimSeconds && !hasSimTicks) {
    throw new SessionError(
      SESSION_ERROR_CODES.WAIT_FOR_INVALID_BUDGET,
      WAIT_FOR_TIMEOUT_OPTION_MESSAGE,
    );
  }
}

/** Sim-time delta the budget measures, `current` relative to `start`. */
export function budgetElapsed(
  budget: WaitForBudget,
  start: DebugSnapshot,
  current: DebugSnapshot,
): number {
  return 'simSeconds' in budget
    ? current.time.simSeconds - start.time.simSeconds
    : current.time.tick - start.time.tick;
}

export function budgetTarget(budget: WaitForBudget): number {
  return 'simSeconds' in budget ? budget.simSeconds : budget.simTicks;
}

export function budgetUnitLabel(budget: WaitForBudget): 'sim-seconds' | 'sim-ticks' {
  return 'simSeconds' in budget ? 'sim-seconds' : 'sim-ticks';
}

/** Binds a snapshot to the synchronous `s(name)` reader predicates use, and
 *  (optionally) records which provider names the predicate actually read —
 *  the failure block's "assisted-tier consumed" header flag needs this. */
export function makeStateReader(
  snapshot: DebugSnapshot,
  touched?: Set<string>,
): (name: string) => unknown {
  return (name: string) => {
    touched?.add(name);
    return snapshot.state[name];
  };
}

/** Everything the failure-block assembler needs about a timed-out waitFor.
 *  Deliberately does not know about providers/screenshots/console errors —
 *  those are gathered by the caller (client.ts) after catching this. */
export interface WaitForTimeoutInfo {
  budget: WaitForBudget;
  startSnapshot: DebugSnapshot;
  lastSnapshot: DebugSnapshot;
  wallElapsedMs: number;
  predicateSource: string;
  touchedProviders: string[];
}

export class WaitForTimeoutError extends Error {
  readonly info: WaitForTimeoutInfo;
  constructor(info: WaitForTimeoutInfo) {
    super(
      `game.waitFor timed out: budget ${budgetTarget(info.budget)} ${budgetUnitLabel(info.budget)}`,
    );
    this.name = 'WaitForTimeoutError';
    this.info = info;
  }
}

/** The clock/snapshot source `runWaitFor` polls against. Real usage (from
 *  `client.ts`) supplies a real `sleep`/`now` and a `snapshot()` that calls
 *  through to the page's bridge; tests supply scripted fakes. */
export interface WaitForClock {
  snapshot(): Promise<DebugSnapshot> | DebugSnapshot;
  now(): number;
  sleep(ms: number): Promise<void>;
  pollIntervalMs?: number;
  /**
   * Test-only safety valve bounding the number of polls, so a scripted
   * "stalled" fake source terminates deterministically in unit tests.
   * Real callers MUST leave this undefined: production `waitFor` has no
   * internal wall-clock bound by design (the build plan forbids a
   * wall-clock timeout PARAMETER) — a genuinely stalled game is instead
   * caught by the outer harness (Playwright's own per-test timeout, or the
   * caller's own outer budget), not by this
   * module.
   */
  maxPolls?: number | undefined;
  /** Real callers: `console.log`. Tests: a capturing fake, so heartbeat
   *  assertions never depend on stdout spies. Defaults to a no-op so a
   *  clock fixture that doesn't care about heartbeats needn't supply one. */
  log?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Fixture heartbeat ("Watchdog sim-awareness / fixture
// heartbeat for long silent tests" — Session C hit exit-5 on the runner's
// 2x90s stdout-liveness watchdog during a legitimately silent 5-minute test).
//
// A caller watching stdout for liveness already treats ANY
// child stdout as liveness — it has no idea what a line MEANS, only that one
// arrived. This is the fixture-side half: while `waitFor`/`waitSimTime` is
// polling, print one line every ~60s of WALL silence so a genuinely
// advancing test can never false-wedge regardless of duration, no matter how
// long a single `simSeconds` budget runs.
//
// INVARIANT (tested below): a heartbeat requires BOTH
// (a) >= HEARTBEAT_INTERVAL_MS of wall time since the last heartbeat, AND
// (b) the tick has ADVANCED since the last heartbeat (not merely since the
// last poll). Without (b), the poll loop itself — which keeps running
// against a frozen page, that being the whole reason `WAIT_FOR_STALL_POLL_
// LIMIT` above exists as a SEPARATE guard — would emit a heartbeat every 60s
// regardless of whether the game is actually alive, defeating the point: a
// frozen sim clock must go heartbeat-silent so the outer watchdog can still
// diagnose it as wedged. Advancing ticks -> heartbeats keep the run alive
// indefinitely; frozen ticks -> no heartbeats, and the existing stall guard
// (or the outer harness watchdog) still fires.
// ---------------------------------------------------------------------------

export const HEARTBEAT_INTERVAL_MS = 60_000;

/** Mutable-by-replacement heartbeat bookkeeping a caller threads through
 *  successive `maybeHeartbeat` calls — never mutated in place, so a test can
 *  freely compare successive states. */
export interface HeartbeatState {
  lastEmitWallMs: number;
  lastEmitTick: number;
}

/** The liveness line this prints to stdout — greppable, and
 *  stable so a human tailing a long run can `grep vgai-heartbeat`. */
export function formatHeartbeatLine(testTitle: string, simSeconds: number, tick: number): string {
  return `vgai-heartbeat ${testTitle} simSeconds=${simSeconds} tick=${tick}`;
}

/**
 * Pure decision, called once per poll: should a heartbeat print now, and
 * what's the updated bookkeeping? See the module-doc invariant above — both
 * the wall-silence budget AND tick advancement (since the last EMITTED
 * heartbeat, not the last poll) must hold. Returns the SAME `state` object
 * (referentially) when nothing should emit, so a caller can cheaply no-op.
 */
export function maybeHeartbeat(opts: {
  nowMs: number;
  tick: number;
  simSeconds: number;
  testTitle: string;
  state: HeartbeatState;
}): { line: string | null; state: HeartbeatState } {
  const wallElapsed = opts.nowMs - opts.state.lastEmitWallMs;
  const tickAdvancedSinceLastEmit = opts.tick !== opts.state.lastEmitTick;
  if (wallElapsed >= HEARTBEAT_INTERVAL_MS && tickAdvancedSinceLastEmit) {
    return {
      line: formatHeartbeatLine(opts.testTitle, opts.simSeconds, opts.tick),
      state: { lastEmitWallMs: opts.nowMs, lastEmitTick: opts.tick },
    };
  }
  return { line: null, state: opts.state };
}

/**
 * D2: a real internal stall guard, always active (unlike `maxPolls` above,
 * which is a test-only seam real callers must leave unset). The bug this
 * fixes: `budgetElapsed` (above) is computed from `current.time.simSeconds`/
 * `.tick` — if the game's sim clock freezes entirely (the loop itself is
 * stalled, not merely backgrounded), those fields never change, so
 * `budgetElapsed` stays at 0 FOREVER and the budget itself can never
 * exhaust — contradicting hidden-recovery.ts's own doc comment, which
 * assumes `runWaitFor`'s sim-time budget is what eventually diagnoses a
 * still-stalled loop after `HiddenRecoveryDriver` has had its one
 * `bringToFront()` chance.
 *
 * 200 consecutive polls with an utterly unchanged tick, at the default
 * 150ms poll interval, is ~30s of real wall time — comfortably (20x) past
 * `HIDDEN_RECOVERY_STALL_POLLS`'s ~1.5s window (hidden-recovery.ts), so a
 * merely-backgrounded tab has already had its recovery chance well before
 * this guard would ever fire. If the tick is STILL frozen after that much
 * wall time, the game loop itself is stalled (not the tab), and this guard
 * throws the same `WaitForTimeoutError` an ordinary budget exhaustion would
 * — the failure block renders honestly, with its ~0x sim-speed ratio and
 * "if ~0x, the loop is stalled" hint (failure-block.ts), rather than the
 * caller hanging forever.
 */
export const WAIT_FOR_STALL_POLL_LIMIT = 200;

/**
 * Polls `clock.snapshot()` until `pred` is true or `budget` is exhausted.
 * Each iteration reads exactly one snapshot (AC-B1.2). On exhaustion throws
 * `WaitForTimeoutError` carrying everything `client.ts` needs to assemble
 * the full failure block.
 *
 * `testTitle` (defaults to `'test'` for callers that don't have one — every
 * REAL caller, `client.ts`'s `waitFor`, always supplies the real Playwright
 * test title) names the fixture heartbeat lines this loop emits — see the
 * module doc above `maybeHeartbeat` for the emission invariant.
 */
export async function runWaitFor(
  pred: (s: (name: string) => unknown) => boolean,
  budget: WaitForBudget,
  clock: WaitForClock,
  testTitle = 'test',
): Promise<DebugSnapshot> {
  assertValidWaitForBudget(budget);
  const pollIntervalMs = clock.pollIntervalMs ?? 150;
  const log = clock.log ?? (() => {});
  const startWall = clock.now();
  const start = await clock.snapshot();
  let current = start;
  const touched = new Set<string>();
  let polls = 0;
  // D2: consecutive polls (so far) whose tick exactly matches the poll
  // before it — independent of the budget's own elapsed math, which is what
  // lets this catch a frozen clock the budget itself would never exhaust.
  let stalledTickPolls = 0;
  let heartbeat: HeartbeatState = { lastEmitWallMs: startWall, lastEmitTick: start.time.tick };

  for (;;) {
    const reader = makeStateReader(current, touched);
    if (pred(reader)) return current;

    polls += 1;
    const elapsed = budgetElapsed(budget, start, current);
    const target = budgetTarget(budget);
    const outOfPolls = clock.maxPolls !== undefined && polls >= clock.maxPolls;
    const stalled = stalledTickPolls >= WAIT_FOR_STALL_POLL_LIMIT;
    if (elapsed >= target || outOfPolls || stalled) {
      throw new WaitForTimeoutError({
        budget,
        startSnapshot: start,
        lastSnapshot: current,
        wallElapsedMs: clock.now() - startWall,
        predicateSource: pred.toString(),
        touchedProviders: [...touched],
      });
    }

    await clock.sleep(pollIntervalMs);
    const next = await clock.snapshot();
    stalledTickPolls = next.time.tick === current.time.tick ? stalledTickPolls + 1 : 0;
    current = next;

    const heartbeatResult = maybeHeartbeat({
      nowMs: clock.now(),
      tick: next.time.tick,
      simSeconds: next.time.simSeconds,
      testTitle,
      state: heartbeat,
    });
    heartbeat = heartbeatResult.state;
    if (heartbeatResult.line) log(heartbeatResult.line);
  }
}
