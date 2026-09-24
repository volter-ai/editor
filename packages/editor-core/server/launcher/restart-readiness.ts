/**
 * `restart`'s readiness contract — the decision half, kept out of the verb so
 * it reads without a live editor. Transferred from vgai's
 * `packages/vgai-cli/src/restart-readiness.ts`.
 *
 * Restart's ack means the session is ready for the NEXT command: the relay
 * answers, a tab is attached, and play is running and STILL running a moment
 * later. Anything else is a loud non-zero failure naming the next step.
 *
 * Readiness is judged by REPEATED measurement, not by a call returning: a
 * probe samples all three facts together, and a restart settles only after
 * several consecutive good samples, so a page reload landing right after the
 * ack is caught by the same loop that catches a play that never started. When
 * a sample regresses, restart re-converges (re-ensure the tab, re-issue the
 * remount) rather than reporting the regression — that recovery IS the verb's
 * job.
 *
 * Three bounds on that recovery. A command the RELAY ended never produced an
 * answer, so a second identical attempt learns nothing
 * (`isRelayCommandTimeout` ends the loop). A legitimate wait is narrated
 * (`commandWaitNote`). And the narration wait is raced against settlement so
 * the progress interval is never a latency floor on a healthy remount.
 */

/** One sample of the three facts "ready" is made of. */
export interface RestartReadinessProbe {
  /** The session server answered `/__editor/state` at all. */
  reachable: boolean;
  /** A browser tab is attached right now (the server's live count). */
  connected: boolean;
  /** Play is running. */
  playing: boolean;
}

/** The outcome of converging the session on one attached tab. */
export type RestartTabOutcome = 'attached' | 'skipped' | 'no-tab' | 'stuck' | 'unadopted';

export interface RestartTimings {
  /** How long a relaunching session server may take to answer again. */
  reachableBudgetMs: number;
  /** Spacing between readiness samples. */
  probeIntervalMs: number;
  /** How long one attempt waits for play to become — and stay — running. */
  playConfirmMs: number;
  /** Consecutive good samples required before restart calls it ready. */
  settleProbes: number;
  /** Convergence attempts before restart reports failure. */
  maxAttempts: number;
  /** How often to narrate a remount that has not answered yet. */
  playProgressIntervalMs: number;
  /** The server's own budget for one remount, quoted in that narration. */
  playBudgetMs: number;
}

export const DEFAULT_RESTART_TIMINGS: RestartTimings = {
  reachableBudgetMs: 15_000,
  probeIntervalMs: 250,
  playConfirmMs: 5_000,
  settleProbes: 3,
  maxAttempts: 3,
  playProgressIntervalMs: 10_000,
  playBudgetMs: 120_000,
};

export interface RestartDeps {
  /** The product command a person types (`volter-game-editor`), for messages. */
  command: string;
  /** Human-readable target (the session URL) for failure messages. */
  target: string;
  probe: () => Promise<RestartReadinessProbe>;
  /** Converge the session on exactly one attached browser tab. */
  ensureTab: () => Promise<RestartTabOutcome>;
  /** Send the remount; throws when the editor refuses it. */
  play: () => Promise<unknown>;
  /** Sleep; with a `signal`, settle early on abort AND clear the timer. */
  wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Progress lines for a human watching a wait that would otherwise be silent. */
  note?: (message: string) => void;
  timings?: Partial<RestartTimings>;
}

export type RestartFailureReason =
  | 'unreachable'
  | 'no-tab'
  | 'play-refused'
  | 'play-timed-out'
  | 'play-not-running';

/** Did the RELAY end this command itself, rather than the editor answering it?
 *  (`EditorCommandError.timedOut`, read structurally.) */
export function isRelayCommandTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { timedOut?: unknown }).timedOut === true;
}

/** One progress line for a remount that has not answered yet. It claims
 *  nothing about the tab; elapsed and budget are what this side measures. */
export function commandWaitNote(command: string, elapsedMs: number, budgetMs: number): string {
  return (
    `${command} restart: still waiting for the remount to finish — ` +
    `${Math.round(elapsedMs / 1000)}s, budget ${Math.round(budgetMs / 1000)}s. ` +
    'The editor has not answered yet; restart gives up when the budget runs out.'
  );
}

export type RestartReadyResult =
  | { ready: true; attempts: number; tab: RestartTabOutcome }
  | { ready: false; attempts: number; reason: RestartFailureReason; message: string; lastProbe: RestartReadinessProbe };

const UNREACHED: RestartReadinessProbe = { reachable: false, connected: false, playing: false };

type AttemptOutcome =
  | { done: 'ready' }
  | { done: 'retry' }
  | { done: 'fail'; reason: RestartFailureReason; message: string };

function tabFailureMessage(command: string, tab: RestartTabOutcome, target: string): string {
  switch (tab) {
    case 'stuck':
      return (
        `${command} restart: a browser tab is on ${target} and beating, but its page never attached a ` +
        `command listener, so nothing can receive the remount. Run \`${command} console\`, then ` +
        `\`${command} edit\` to reload that tab.`
      );
    case 'unadopted':
      return (
        `${command} restart: the session's tab is showing the project launcher (or a startup failure) ` +
        `rather than this project at ${target}. Look at that tab and fix what it reports, then ` +
        `re-run \`${command} restart\`.`
      );
    default:
      return (
        `${command} restart: no browser tab is attached to ${target}, so the remount has nobody to run ` +
        `in. Re-run \`${command} edit .\`, then \`${command} restart\`.`
      );
  }
}

/** Converge the session on "ready for the next command", or report exactly
 *  what is missing. Never `ready: true` without having MEASURED all three
 *  facts, repeatedly, after the remount. */
export async function restartToReady(deps: RestartDeps): Promise<RestartReadyResult> {
  const timings = { ...DEFAULT_RESTART_TIMINGS, ...deps.timings };
  const now = deps.now ?? ((): number => Date.now());
  const { command } = deps;
  let lastProbe: RestartReadinessProbe = UNREACHED;
  let lastTab: RestartTabOutcome = 'attached';

  const waitReachable = async (): Promise<boolean> => {
    const deadline = now() + timings.reachableBudgetMs;
    let announced = false;
    for (;;) {
      lastProbe = await deps.probe();
      if (lastProbe.reachable) return true;
      if (now() >= deadline) return false;
      if (!announced) {
        announced = true;
        deps.note?.(`${command} restart: ${deps.target} is not answering yet — waiting for it to come back…`);
      }
      await deps.wait(timings.probeIntervalMs);
    }
  };

  const settle = async (): Promise<boolean> => {
    const deadline = now() + timings.playConfirmMs;
    let consecutive = 0;
    for (;;) {
      lastProbe = await deps.probe();
      consecutive = lastProbe.reachable && lastProbe.connected && lastProbe.playing ? consecutive + 1 : 0;
      if (consecutive >= timings.settleProbes) return true;
      if (now() >= deadline) return false;
      await deps.wait(timings.probeIntervalMs);
    }
  };

  const playNarrated = async (): Promise<void> => {
    const settled = new AbortController();
    const call = deps.play().finally(() => settled.abort());
    const narrate = async (): Promise<void> => {
      for (let elapsed = 0; !settled.signal.aborted; ) {
        await deps.wait(timings.playProgressIntervalMs, settled.signal);
        if (settled.signal.aborted) return;
        elapsed += timings.playProgressIntervalMs;
        deps.note?.(commandWaitNote(command, elapsed, timings.playBudgetMs));
      }
    };
    const narration = narrate();
    try {
      await call;
    } finally {
      await narration;
    }
  };

  const playThrew = async (error: unknown, isLast: boolean): Promise<AttemptOutcome> => {
    const message = error instanceof Error ? error.message : String(error);
    if (isRelayCommandTimeout(error)) {
      return { done: 'fail', reason: 'play-timed-out', message: `${command} restart: the relay gave up on the remount — ${message}` };
    }
    if (!isLast) {
      await deps.wait(timings.probeIntervalMs);
      return { done: 'retry' };
    }
    if (lastProbe.reachable && !lastProbe.connected) {
      return { done: 'fail', reason: 'no-tab', message: tabFailureMessage(command, 'no-tab', deps.target) };
    }
    return { done: 'fail', reason: 'play-refused', message: `${command} restart: the editor refused the remount — ${message}` };
  };

  const attemptOnce = async (isLast: boolean): Promise<AttemptOutcome> => {
    if (!(await waitReachable())) {
      return {
        done: 'fail',
        reason: 'unreachable',
        message:
          `${command} restart: the editor session at ${deps.target} never answered within ` +
          `${Math.round(timings.reachableBudgetMs / 1000)}s. Nothing was remounted. Start it with ` +
          `\`${command} edit .\`, then re-run \`${command} restart\`.`,
      };
    }
    // Converge the tab only when the probe says one is MISSING: asking a
    // healthy session refocuses (and may re-navigate) its tab, which is the
    // navigation this verb is trying to survive.
    if (!lastProbe.connected) {
      lastTab = await deps.ensureTab();
      if (lastTab !== 'attached' && lastTab !== 'skipped') {
        return { done: 'fail', reason: 'no-tab', message: tabFailureMessage(command, lastTab, deps.target) };
      }
    }
    try {
      await playNarrated();
    } catch (error) {
      return await playThrew(error, isLast);
    }
    return (await settle()) ? { done: 'ready' } : { done: 'retry' };
  };

  for (let attempt = 1; attempt <= timings.maxAttempts; attempt++) {
    const outcome = await attemptOnce(attempt === timings.maxAttempts);
    if (outcome.done === 'ready') return { ready: true, attempts: attempt, tab: lastTab };
    if (outcome.done === 'fail') {
      return { ready: false, attempts: attempt, reason: outcome.reason, lastProbe, message: outcome.message };
    }
  }
  return {
    ready: false,
    attempts: timings.maxAttempts,
    reason: lastProbe.connected ? 'play-not-running' : 'no-tab',
    lastProbe,
    message: lastProbe.connected
      ? `${command} restart: the remount was accepted but play is NOT running — the session is not ` +
        `ready for the next command. See the evidence below, then fix it and re-run \`${command} restart\`.`
      : tabFailureMessage(command, 'no-tab', deps.target),
  };
}

/** The live probe: one `/__editor/state` read, mapped onto the three facts.
 *  `connected` is the server-stamped live count, never a cached snapshot. */
export async function probeRestartReadiness(serverUrl: string, fetchImpl: typeof fetch = fetch): Promise<RestartReadinessProbe> {
  try {
    const res = await fetchImpl(`${serverUrl}/__editor/state`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return UNREACHED;
    const body = (await res.json()) as { playState?: unknown; connected?: unknown; editorsConnected?: unknown };
    const connected = body.connected === true || (typeof body.editorsConnected === 'number' && body.editorsConnected > 0);
    return { reachable: true, connected, playing: body.playState === 'playing' };
  } catch {
    return UNREACHED;
  }
}
