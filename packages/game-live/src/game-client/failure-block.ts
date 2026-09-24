/**
 * Pure failure-block assembly (Task 3.3) — no Playwright. Every
 * driver-originated failure (`game.waitFor` timeout, `game.events.expect`
 * mismatch) renders through this one assembler so the frozen eight-member
 * contract is met identically everywhere: elapsed (sim/wall/ratio+hint),
 * tick, predicate/expectation source, tier-annotated + byte-capped last
 * state, last 8 events, screenshot path, console errors, page errors. (M13
 * review fix adds one MORE line, hidden-tab recovery notices, kept
 * deliberately separate from the console/page-errors member rather than
 * folded into it — see `recoveryNotices` below.)
 */

import { capJson } from './state-cap.js';
import type { ProviderInfo, TickStampedEvent } from './types.js';

export interface FailureBlockContext {
  /** First line — e.g. "game.waitFor timed out: budget 10 sim-seconds". */
  headline: string;
  simElapsedSeconds: number;
  wallElapsedMs: number;
  tick: number;
  /** `pred.toString()` for waitFor; a rendered description for events.expect. */
  predicateSource: string;
  providers: ProviderInfo[];
  /** Provider names the predicate actually read (waitFor only) — drives the
   *  "⚠ proof consumed assisted state" header flag. Omitted (or empty) for
   *  assertions with no predicate function, e.g. events.expect. */
  touchedProviders?: string[];
  lastState: Record<string, unknown>;
  lastEvents: TickStampedEvent[];
  screenshotPath: string | null;
  consoleErrors: string[];
  pageErrors: string[];
  /** M13: hidden-tab recovery's own structured log lines (hidden-recovery.ts's
   *  `hiddenRecoveryLogLine`), kept SEPARATE from `consoleErrors` — a
   *  recovery notice ("bringToFront() fired") is not itself an error, and
   *  conflating it with real console/page errors muddies the one section a
   *  reader scans to tell "the game crashed" from "the tab was backgrounded
   *  and got recovered". Optional/defaults to empty — most failures have
   *  none. */
  recoveryNotices?: string[];
  /**
   * Issue #175 — the REAL loop liveness at the moment of failure (the
   * timed-out/failed snapshot's `time.loopLiveness`). When this is
   * `'loop-starved'`, `ratioLine` below replaces its generic "if ~0x, the
   * loop is stalled" hint with an explicit "the tab is hidden" diagnosis —
   * `HiddenRecoveryDriver` already tried ONE `bringToFront()` recovery
   * before this failure was ever thrown (see `client.ts`/`hidden-recovery.ts`);
   * a 0.00x ratio surviving past that recovery attempt is exactly the
   * ambiguous reading this field resolves: a backgrounded tab the recovery
   * couldn't reach (headless/no-op `bringToFront`), not proof the game
   * itself crashed. Optional/`undefined` when the bridge build predates
   * `loopLiveness` — falls back to the old generic hint, same as before.
   */
  loopLiveness?: 'running' | 'loop-starved' | 'stopped' | null | undefined;
}

export interface SessionFailureData {
  headline: string;
  elapsed: { simSeconds: number; wallMs: number; ratio: number; line: string };
  tick: number;
  predicateSource: string;
  lastState: { text: string; truncated: boolean };
  lastEvents: TickStampedEvent[];
  screenshotPath: string | null;
  consoleErrors: string[];
  pageErrors: string[];
  /** Non-empty when the predicate consumed an `assisted`-tier provider. */
  assistedTierConsumed: string[];
  /** M13: see `FailureBlockContext.recoveryNotices`. Always present (an
   *  empty array, not omitted) so a JSON reporter never has to distinguish
   *  "no notices" from "field absent". */
  recoveryNotices: string[];
  /** Issue #175 — see `FailureBlockContext.loopLiveness`'s doc comment.
   *  Machine-readable twin of `elapsed.line`'s hidden-tab hint, for a JSON
   *  reporter that doesn't want to parse prose to tell a frozen tab from a
   *  stalled game. `undefined`/`null` exactly mirrors the context field. */
  loopLiveness?: 'running' | 'loop-starved' | 'stopped' | null | undefined;
}

export interface AssembledFailureBlock {
  message: string;
  data: SessionFailureData;
}

/** Annotates each top-level state key with its provider tier, e.g.
 *  `"inventory[observable]"`. Providers with no matching registration
 *  (shouldn't normally happen — `stateAll()` and `providers()` are read from
 *  the same registry) are marked `[unknown]` rather than dropped. */
export function annotateStateTiers(
  state: Record<string, unknown>,
  providers: ProviderInfo[],
): Record<string, unknown> {
  const tierByName = new Map(providers.map((p) => [p.name, p.tier]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    const tier = tierByName.get(key) ?? 'unknown';
    out[`${key}[${tier}]`] = value;
  }
  return out;
}

function ratioLine(
  simElapsedSeconds: number,
  wallElapsedMs: number,
  loopLiveness?: 'running' | 'loop-starved' | 'stopped' | null,
): { ratio: number; line: string } {
  const wallElapsedS = wallElapsedMs / 1000;
  const ratio = wallElapsedS > 0 ? simElapsedSeconds / wallElapsedS : 0;
  // Issue #175: an rAF chain can make no progress while UI play state still
  // says running — the same ~0x reading a genuinely crashed game produces.
  // The loop's own measurement distinguishes that condition without guessing
  // what is happening to the browser window.
  //
  // P21: state the READING, not a conclusion about the human's screen. This
  // hint used to read "the EDITOR/BROWSER TAB IS HIDDEN", and that sentence
  // reached the owner as an assertion about a tab they were looking at.
  // `loop-starved` is what the engine's own loop reports when no recent host
  // rAF callback was observed; repeating that is honest, narrating the window
  // is not.
  const hint =
    loopLiveness === 'loop-starved'
      ? "the loop reported liveness 'loop-starved' — no recent host rAF " +
        'callback was observed (not, by itself, a crash or a visibility ' +
        'verdict). Sim time still advances through game.waitSimTime/waitFor, ' +
        'which drive deterministic ticks over the relay; `volter-game-editor status` prints ' +
        'the visibility readings with their ages if you need to know why'
      : 'if ~0x, the loop is stalled; if <1x under CI, the budget may just ' +
        'be too small for SwiftShader';
  const line =
    `sim-time elapsed: ${simElapsedSeconds.toFixed(2)}s over ${wallElapsedS.toFixed(1)}s wall ` +
    `(sim speed ${ratio.toFixed(2)}x — ${hint})`;
  return { ratio, line };
}

export function assembleFailureBlock(ctx: FailureBlockContext): AssembledFailureBlock {
  const tierByName = new Map(ctx.providers.map((p) => [p.name, p.tier]));
  const touched = ctx.touchedProviders ?? [];
  const assistedTierConsumed = touched.filter((name) => tierByName.get(name) === 'assisted');

  const annotatedState = annotateStateTiers(ctx.lastState, ctx.providers);
  const capped = capJson(annotatedState);
  const last8Events = ctx.lastEvents.slice(-8);
  const { ratio, line: elapsedLine } = ratioLine(
    ctx.simElapsedSeconds,
    ctx.wallElapsedMs,
    ctx.loopLiveness,
  );

  const eventsLine =
    last8Events.length > 0
      ? last8Events
          .map(
            (e) =>
              `[t=${e.tick}] ${e.event}${e.detail !== undefined ? ` ${JSON.stringify(e.detail)}` : ''}`,
          )
          .join(' ')
      : '(none)';

  const consoleAndPageErrorsText =
    ctx.consoleErrors.length + ctx.pageErrors.length > 0
      ? [...ctx.consoleErrors, ...ctx.pageErrors].join('; ')
      : '(none)';

  const recoveryNotices = ctx.recoveryNotices ?? [];
  const recoveryNoticesText = recoveryNotices.length > 0 ? recoveryNotices.join('; ') : '(none)';

  const lines = [
    ctx.headline,
    elapsedLine,
    `tick at failure: ${ctx.tick}`,
    `predicate: ${ctx.predicateSource}`,
    `last state (tier-annotated): ${capped.text}${capped.truncated ? ' [truncated]' : ''}`,
    `last 8 events: ${eventsLine}`,
    `screenshot: ${ctx.screenshotPath ?? '(none)'}`,
    `console/page errors during test: ${consoleAndPageErrorsText}`,
    // M13: its own line, deliberately separate from the console/page errors
    // line above — a hidden-tab recovery notice is not itself an error.
    `hidden-tab recovery notices: ${recoveryNoticesText}`,
  ];

  const header =
    assistedTierConsumed.length > 0
      ? `⚠ proof consumed assisted (X-ray) state: ${assistedTierConsumed.join(', ')}\n`
      : '';

  const data: SessionFailureData = {
    headline: ctx.headline,
    elapsed: {
      simSeconds: ctx.simElapsedSeconds,
      wallMs: ctx.wallElapsedMs,
      ratio,
      line: elapsedLine,
    },
    tick: ctx.tick,
    predicateSource: ctx.predicateSource,
    lastState: capped,
    lastEvents: last8Events,
    screenshotPath: ctx.screenshotPath,
    consoleErrors: ctx.consoleErrors,
    pageErrors: ctx.pageErrors,
    assistedTierConsumed,
    recoveryNotices,
    loopLiveness: ctx.loopLiveness,
  };

  return { message: header + lines.join('\n'), data };
}
