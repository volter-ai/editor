/**
 * The Playwright-page-bound wiring for `game`'s client methods (D17: specs
 * drive `window.__vgai` via `page.evaluate` — the standalone page has no HTTP
 * channel). This module is deliberately the ONLY place that touches `Page`;
 * the budget math (`wait-for.ts`), the events matcher (`events-matcher.ts`),
 * and the failure-block assembler (`failure-block.ts`) are plain modules
 * that never import Playwright, per Task 3.2's architecture requirement.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { type BridgeHeartbeatState, maybeBridgeHeartbeat } from './bridge-heartbeat.js';
import type { BridgeCallOutcome, BridgeTransport } from './bridge-transport.js';
import { type CaptureListener, type CaptureNotes, describeCaptureCaveat } from './capture-notes.js';
import { appendWarmSessionHint, inputGatedError, SessionError, SessionFailure } from './errors.js';
import { describeEventsExpectation, matchEventsSubsequence } from './events-matcher.js';
import { assembleFailureBlock } from './failure-block.js';
import {
  type FastForwardBudget,
  type FastForwardClock,
  type FastForwardOptions,
  type FastForwardTime,
  runFastForward,
} from './fast-forward.js';
import { HiddenRecoveryDriver } from './hidden-recovery.js';
import { TpsAccumulator, type TpsStats } from './perf-sampling.js';
import { resolveScreenshotTarget } from './screenshot-target.js';
import type {
  DebugCommandInfo,
  DebugSnapshot,
  ProviderInfo,
  VirtualActionResult,
  VirtualActionValue,
} from './types.js';
import {
  assertValidWaitForBudget,
  budgetTarget,
  type HeartbeatState,
  maybeHeartbeat,
  runWaitFor,
  WAIT_FOR_STALL_POLL_LIMIT,
  type WaitForBudget,
  WaitForTimeoutError,
} from './wait-for.js';

/** Runs inside the page. Kept as a single exported plain function (not a
 *  closure over Node state) because `page.evaluate(fn, arg)` only ships
 *  `fn`'s own source across the boundary. */
function bridgeCallInPage(args: { method: string; callArgs: unknown[] }): BridgeCallOutcome {
  const bridge = (window as unknown as { __vgai?: Record<string, unknown> }).__vgai;
  if (!bridge) {
    return {
      ok: false,
      error: { code: undefined, message: 'window.__vgai is not installed on this page' },
    };
  }
  const parts = args.method.split('.');
  let parent: Record<string, unknown> = bridge;
  for (let i = 0; i < parts.length - 1; i++) {
    parent = parent[parts[i] as string] as Record<string, unknown>;
  }
  const key = parts[parts.length - 1] as string;
  const fn = parent[key] as (...fnArgs: unknown[]) => unknown;
  try {
    const result = fn.apply(parent, args.callArgs);
    return { ok: true, result };
  } catch (err) {
    const e = err as { code?: string; message?: string; data?: unknown };
    return {
      ok: false,
      error: { code: e?.code, message: e?.message ?? String(err), data: e?.data },
    };
  }
}

/** Same shape, but awaits the call — used for `invoke` (async debug
 *  commands). */
async function bridgeCallInPageAsync(args: {
  method: string;
  callArgs: unknown[];
}): Promise<BridgeCallOutcome> {
  const bridge = (window as unknown as { __vgai?: Record<string, unknown> }).__vgai;
  if (!bridge) {
    return {
      ok: false,
      error: { code: undefined, message: 'window.__vgai is not installed on this page' },
    };
  }
  const parts = args.method.split('.');
  let parent: Record<string, unknown> = bridge;
  for (let i = 0; i < parts.length - 1; i++) {
    parent = parent[parts[i] as string] as Record<string, unknown>;
  }
  const key = parts[parts.length - 1] as string;
  const fn = parent[key] as (...fnArgs: unknown[]) => unknown;
  try {
    const result = await fn.apply(parent, args.callArgs);
    return { ok: true, result };
  } catch (err) {
    const e = err as { code?: string; message?: string; data?: unknown };
    return {
      ok: false,
      error: { code: e?.code, message: e?.message ?? String(err), data: e?.data },
    };
  }
}

/**
 * A relay step crosses the wire as function source, so compiler-owned helpers that live beside the
 * function in its Node module are closures too. esbuild's `keepNames` transform is the live case:
 * a named helper inside an otherwise literal callback becomes `__name(fn, "helper")`, while the
 * module-level `__name` implementation is absent after `step.toString()`. Seat that exact compiler
 * primitive inside the serialized function instead of installing a page global or asking every
 * caller to avoid ordinary named local helpers.
 *
 * Ordinary source stays byte-for-byte unchanged. That preserves the public wire account and keeps
 * unsupported user closures loud; this only completes the source for a compiler helper whose
 * semantics are intrinsic and deterministic.
 */
function selfContainedStepSource(step: (scope: unknown) => unknown): string {
  const source = step.toString();
  if (!/\b__name\s*\(/u.test(source)) return source;
  return `(scope) => { const __name = (target, value) => Object.defineProperty(target, "name", { value, configurable: true }); return (${source})(scope); }`;
}

/**
 * #140 — the `BridgeTransport` `page.evaluate` implementation. This is the
 * ONE place a `Page` is ever touched to drive `window.__vgai` (module doc
 * above); `RelayTransport` (`relay-transport.ts`) is the sibling
 * implementation for the live editor session, and imports no Playwright at
 * all. Exported so `fixture.ts` (which already imports `@playwright/test`
 * for its own `page.goto`/error-listener setup) can construct one.
 */
export class PageTransport implements BridgeTransport {
  constructor(private readonly page: Page) {}

  async call(method: string, callArgs: unknown[]): Promise<BridgeCallOutcome> {
    return this.page.evaluate(bridgeCallInPage, { method, callArgs });
  }

  async callAsync(method: string, callArgs: unknown[]): Promise<BridgeCallOutcome> {
    return this.page.evaluate(bridgeCallInPageAsync, { method, callArgs });
  }

  async isHidden(): Promise<boolean> {
    return this.page.evaluate(() => document.hidden);
  }

  async bringToFront(): Promise<void> {
    await this.page.bringToFront();
  }

  /** No notes: Playwright drives its own foregrounded page, so neither the
   *  hidden-surface nor the near-blank measurement the editor page makes
   *  (`capture-notes.ts`) exists on this leg. `{}` says that honestly rather
   *  than inventing a clean bill of health. */
  async screenshot(path: string): Promise<CaptureNotes> {
    await mkdir(dirname(path), { recursive: true });
    await this.page.screenshot({ path });
    return {};
  }

  /** The ONE transport that runs a `game.page()` step against a REAL
   *  Playwright `Page` — no serialization, so `step`'s own closures work
   *  here (see `bridge-transport.ts`'s `runPageScript` doc comment for the
   *  full honesty-boundary contract; `src` is unused on this leg, kept only
   *  to satisfy the shared interface). */
  async runPageScript(_src: string, step: (page: unknown) => unknown): Promise<BridgeCallOutcome> {
    try {
      const result = await step(this.page);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: { code: undefined, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /** THE MODULE LANE under a real Playwright host: the step's source is
   *  evaluated INSIDE the editor page via the same in-page handler the relay
   *  op uses (`window.__vgaiGameEval`), because `modules()` only means
   *  anything in the page's own module space — a Node-side call could never
   *  hand back the running mount's instances. Same serialization contract
   *  as the relay leg. */
  async runGameScript(
    src: string,
    _step: (scope: unknown) => unknown,
    instance?: string,
  ): Promise<BridgeCallOutcome> {
    try {
      const result = await this.page.evaluate(
        async (args: { src: string; instance?: string }) => {
          const hook = (window as unknown as Record<string, unknown>)['__vgaiGameEval'] as
            | ((src: string, instance?: string) => Promise<unknown>)
            | undefined;
          if (typeof hook !== 'function') {
            throw new Error(
              'game-eval: this page has no __vgaiGameEval hook — is the editor page loaded?',
            );
          }
          return hook(args.src, args.instance);
        },
        { src, ...(instance === undefined ? {} : { instance }) },
      );
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: { code: undefined, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /** Playwright's own reload already waits for the new document's `load`
   *  event, which is exactly the completion signal this method's contract
   *  asks for — nothing to reconstruct on this leg. */
  async reloadPage(): Promise<void> {
    await this.page.reload();
  }
}

export interface GameClientOptions {
  /** The bridge transport — `new PageTransport(page)` for a standalone page
   *  (`fixture.ts`), `new RelayTransport({ port })` for `--in-editor`
   *  (`relay-fixture.ts`). See `bridge-transport.ts`'s module doc: every
   *  method below reaches `window.__vgai` (or its relay-side equivalent)
   *  ONLY through this seam. */
  transport: BridgeTransport;
  /** Populated by the fixture's `pageerror` listener, installed before goto. */
  pageErrors: string[];
  /** Populated by the fixture's `console` listener (type `'error'`), same timing. */
  consoleErrors: string[];
  /** First snapshot's `time.tick` — used only for `events.expect`'s
   *  `withinTicks` timing math (`events-matcher.ts`) and the D5 failure-block
   *  deltas below; identity fencing itself is `fenceSeq`'s job (run-4
   *  friction #5 — see that field's doc comment). */
  fenceTick: number;
  /** Run-4 friction #5: the fence snapshot's own event ring's last `seq`
   *  (`0` if the ring was empty at fence time — nothing emitted yet, so
   *  "since seq 0" is correct). `events.expect` fences on THIS, not
   *  `fenceTick` — the removed `tick > sinceTick` filter silently dropped any event that
   *  shares the fence's own tick (e.g. one emitted from a debug-command
   *  handler, which runs between ticks), which is exactly the bug this field
   *  closes. See `debug-registry.ts`'s `TickStampedEvent.seq` doc comment
   *  for the full mechanism. */
  fenceSeq: number;
  /** D5: first snapshot's `time.simSeconds` — `events.expect`'s failure block
   *  computes REAL elapsed sim-time as a delta off this, instead of the
   *  absolute (since-boot) `simSeconds` the pre-fix code passed. */
  fenceSimSeconds: number;
  /** D5: `Date.now()` at the same moment as the fence snapshot — the wall
   *  side of that same delta, instead of the pre-fix code's hardcoded `0`
   *  (which fabricated a "sim speed 0.00x — loop stalled" reading on every
   *  single `events.expect` failure, regardless of how the game was
   *  actually running). */
  fenceWallMs: number;
  artifactsDir?: string | undefined;
  /** The project root the editor session is SERVING, when the caller knows it
   *  (`@volter/game-live`'s `connect()` does). Used for one thing: saying, in a
   *  capture's own notes, that its destination falls under the dev server's
   *  file watcher — see `capture-notes.ts`. Never used to resolve a path. */
  projectRoot?: string | undefined;
  /** Set by the caller when it reused an already-running game server rather
   *  than booting a fresh one for this run. Threaded through so `unwrap` can
   *  append the warm-session staleness hint to a
   *  `DEBUG_COMMAND_NOT_REGISTERED` failure (see `errors.ts`'s
   *  `appendWarmSessionHint`). Defaults to `false` so every caller that never
   *  sets it is unaffected. */
  warmSession?: boolean;
  /** `testInfo.title` — names the fixture heartbeat lines `waitFor`/
   *  `waitSimTime` print during a long poll (see `wait-for.ts`'s module doc).
   *  Defaults to `'test'` so a caller that never sets it (existing direct
   *  `GameClient` construction in older tests) still gets a valid, if
   *  generic, heartbeat line rather than `undefined` in the output. */
  testTitle?: string;
}

/**
 * A relay-transport call that overran its async-invoke timeout budget
 * surfaces as a `RELAY_UNREACHABLE` `SessionError` whose message names the
 * timeout (`relay-transport.ts`'s `postCommand` uses `AbortSignal.timeout`,
 * and Node's fetch rejects an aborted-by-timeout signal with a message
 * containing "timeout") — a genuine network-down failure gets the SAME code
 * but never mentions timeout, so this narrows on the message text, not just
 * the code, before deciding to append the split-the-hold hint. Appends
 * rather than replaces so the underlying transport message stays visible.
 * `action` is whatever the caller passed to `hold()` (a single name or an
 * array of them) — `JSON.stringify` renders either shape sensibly in the
 * hint.
 */
function rethrowIfHoldTimedOut(err: unknown, action: string | string[], simSeconds: number): never {
  if (
    err instanceof SessionError &&
    err.code === 'RELAY_UNREACHABLE' &&
    /timeout/i.test(err.message)
  ) {
    throw new SessionError(
      err.code,
      `${err.message}\nhint: game.input.hold(${JSON.stringify(action)}, { simSeconds: ${simSeconds} }) ` +
        "may have exceeded the relay transport's async-invoke timeout budget — split it into " +
        'multiple shorter game.input.hold() calls instead of one long hold',
      err.data,
    );
  }
  throw err;
}

/** {@link GameInput.tap}'s budget: one fixed tick at the default 60Hz
 *  timestep. `waitForHoldBudget` resolves on the FIRST reading that covers
 *  the budget, so this asks for the shortest press a tick can actually
 *  service — never a wall-clock duration. A project running a non-default
 *  fixed timestep simply covers it in its own single (longer) tick. */
const TAP_SIM_SECONDS = 1 / 60;

export class GameInput {
  constructor(private readonly client: GameClient) {}

  /**
   * Holds one action, or SIMULTANEOUSLY holds several — `hold('jump')` and
   * `hold(['move_right', 'move_forward'])` (the natural way to drive a
   * diagonal) are both first-class. `action` is deliberately typed as
   * `string | string[]`, never just `string`: a bare JS array silently
   * stringifies to a comma-joined name (`['move_right','move_forward']` →
   * `"move_right,move_forward"`) wherever it crosses a template literal or
   * the bridge's JSON boundary, which used to surface as a baffling
   * `unknown action "move_right,move_forward"` — the array was accepted
   * structurally (nothing rejected it) and then silently mangled instead.
   * Accepting the array for real, instead of merely rejecting it, is the
   * useful behavior: every 2D/3D mover needs "hold two directions at once"
   * as its ordinary case, not an edge case.
   *
   * Single action: one `holdFor` bridge call (`runtime/debug-bridge.ts`)
   * instead of the old set → `waitSimTime`'s 150ms-interval snapshot poll
   * loop → clear (15+ transport round trips over the editor relay for a
   * multi-second hold). The wait uses ordinary host-loop ticks while visible.
   * If the browser has loop-starved that loop, the bridge drives the held
   * action through the same game phases with deterministic ticks; this
   * collapses transport cost without letting a background tab deadlock it.
   *
   * A relay call has a bounded async-invoke timeout budget (see
   * `relay-transport.ts`'s `INVOKE_TIMEOUT_MS`) — a `simSeconds` long enough
   * to exceed it at worst-case sim speed is NOT silently truncated; the
   * transport timeout is caught and rethrown with a hint to split the hold
   * into multiple shorter `hold()` calls instead.
   *
   * Multiple actions: `holdFor` is a single-action bridge primitive, so this
   * presses every action (`setVirtualAction(action, true)`, in order),
   * waits the shared `simSeconds` once via `waitSimTime`, and releases every
   * action it managed to press — in a `finally`, so a gated press (a
   * `delivered: false` result throws `INPUT_GATED` immediately) or a stalled
   * clock during the wait still leaves no action stuck held.
   */
  async hold(action: string | string[], budget: { simSeconds: number }): Promise<void> {
    // `hold('left', 0.5)` would otherwise send `undefined` sim-seconds down the
    // `holdFor` bridge call — the same options-object-only contract as
    // `waitSimTime`, named for the method the caller actually wrote.
    assertValidWaitForBudget(budget, 'input.hold');
    const actions = Array.isArray(action) ? action : [action];
    if (actions.length === 0) {
      throw new Error('game.input.hold: action array must not be empty');
    }

    if (actions.length === 1) {
      const single = actions[0] as string;
      let result: VirtualActionResult;
      try {
        result = await this.client.callBridgeAsync<VirtualActionResult>(
          'holdFor',
          single,
          budget.simSeconds,
        );
      } catch (err) {
        throw rethrowIfHoldTimedOut(err, single, budget.simSeconds);
      }
      if (!result.delivered) throw inputGatedError(single, result.reason);
      return;
    }

    const pressed: string[] = [];
    try {
      for (const single of actions) {
        const result = await this.client.callBridge<VirtualActionResult>(
          'input.setVirtualAction',
          single,
          true,
        );
        if (!result.delivered) throw inputGatedError(single, result.reason);
        pressed.push(single);
      }
      await this.client.waitSimTime(budget);
    } finally {
      for (const single of pressed) {
        await this.client
          .callBridge<VirtualActionResult>('input.setVirtualAction', single, false)
          .catch(() => {
            // Best-effort release — a failure here must never mask whatever
            // the try block itself threw (or replace a clean success with a
            // spurious one), and there is nothing more this call can do
            // about a bridge/session that is no longer reachable.
          });
      }
    }
  }

  /**
   * Keep one or more honest game actions pressed while `observe` runs, then
   * release every action in a `finally` block. This is the evidence-oriented
   * sibling of {@link hold}: `hold()` resolves after release, which is ideal
   * for asserting distance travelled but cannot capture a moving pose or read
   * transient "currently sprinting" state. `whileHeld()` makes that interval
   * explicit without asking tests to hand-roll unsafe set/clear cleanup.
   *
   * The callback uses the same `GameClient` instance already in the test, so
   * it may call `game.waitFor`, `game.state`, `game.screenshot`, or any other
   * ordinary observation. No state is fabricated and the actions still enter
   * through `input.setVirtualAction`/the project's real input map.
   */
  async whileHeld<T>(action: string | string[], observe: () => T | Promise<T>): Promise<T> {
    const actions = Array.isArray(action) ? action : [action];
    if (actions.length === 0) {
      throw new Error('game.input.whileHeld: action array must not be empty');
    }

    const pressed: string[] = [];
    try {
      for (const single of actions) {
        const result = await this.client.callBridge<VirtualActionResult>(
          'input.setVirtualAction',
          single,
          true,
        );
        if (!result.delivered) throw inputGatedError(single, result.reason);
        pressed.push(single);
      }
      return await observe();
    } finally {
      for (const single of pressed) {
        await this.client
          .callBridge<VirtualActionResult>('input.setVirtualAction', single, false)
          .catch(() => {
            // Best-effort release: preserve the callback/gating failure while
            // never leaving an action held merely because teardown lost the
            // relay.
          });
      }
    }
  }

  /**
   * One honest one-shot press — pressed, carried through AT LEAST ONE FULL
   * FIXED TICK, then released, as a single bridge call.
   *
   * The contract is deliberately "a tick services it", not "the bridge
   * accepted it", because the raw primitive underneath (`InputManager.
   * tapVirtualAction`) only QUEUES: `poll()` promotes the queue to that tick's
   * just-pressed set, and nothing else ever does. On a visible tab a tick
   * lands ~16ms later so the difference is invisible; on a HIDDEN tab the host
   * loop is stopped outright, so a queue-only tap sat unserviced and then died
   * — silently, having already reported `delivered: true` (measured:
   * `input.trace: { ticks: [] }`, no event, while `whileHeld` on the same
   * action worked every time). Routing through the `holdFor` primitive is what
   * makes the press TICK-ALIGNED by construction: that call owns the wait, and
   * its hidden-tab leg drives the tick deterministically
   * (`runtime/debug-bridge.ts`'s `waitForHoldBudget`), so a tap can no longer
   * fall between ticks on any transport or any tab state.
   *
   * A gated action still fails loudly and immediately with `INPUT_GATED`,
   * exactly as {@link hold} does — same `delivered:false` contract, same
   * error.
   */
  async tap(action: string): Promise<void> {
    const result = await this.client.callBridgeAsync<VirtualActionResult>(
      'holdFor',
      action,
      TAP_SIM_SECONDS,
    );
    if (!result.delivered) throw inputGatedError(action, result.reason);
  }

  /**
   * Sets one action, or the SAME value on several at once — same
   * `string | string[]` shape as {@link hold}, and for the same reason: a
   * bare array used to silently stringify into a single bogus action name
   * instead of being rejected or honored.
   */
  async set(action: string | string[], value: VirtualActionValue): Promise<void> {
    const actions = Array.isArray(action) ? action : [action];
    if (actions.length === 0) {
      throw new Error('game.input.set: action array must not be empty');
    }
    for (const single of actions) {
      const result = await this.client.callBridge<VirtualActionResult>(
        'input.setVirtualAction',
        single,
        value,
      );
      if (!result.delivered) throw inputGatedError(single, result.reason);
    }
  }
}

export class GameEvents {
  constructor(private readonly client: GameClient) {}

  async expect(names: string[], opts?: { exact?: boolean; withinTicks?: number }): Promise<void> {
    // Run-4 friction #5: fence on `fenceSeq` (unambiguous — see its doc
    // comment on `GameClientOptions`), not `fenceTick`. The old
    // `snapshot(fenceTick)` call used the tick-based filter, which silently
    // dropped an event emitted at the fence tick itself — exactly what a
    // debug-command handler running right at test start produces.
    const snapshot = await this.client.snapshot(this.client.fenceSeq);
    // M9: pass the REAL fence tick (the test's own start), not
    // `snapshot.events[0].tick` — see events-matcher.ts's doc comment.
    const result = matchEventsSubsequence(names, snapshot.events, this.client.fenceTick, opts);
    if (result.matched) return;

    const providers = await this.client.providers();
    // D5: real deltas off the fence, not the absolute (since-boot)
    // simSeconds + a hardcoded wallElapsedMs: 0 — the pre-fix code fabricated
    // a "sim speed 0.00x — loop stalled" reading on every single
    // events.expect failure regardless of actual game health.
    const block = assembleFailureBlock({
      headline: `game.events.expect failed: expected ${JSON.stringify(names)} as an ${opts?.exact ? 'exact' : 'ordered subsequence'} of events since test start`,
      simElapsedSeconds: snapshot.time.simSeconds - this.client.fenceSimSeconds,
      wallElapsedMs: Date.now() - this.client.fenceWallMs,
      tick: snapshot.time.tick,
      predicateSource: describeEventsExpectation(names, opts),
      providers,
      lastState: snapshot.state,
      lastEvents: snapshot.events,
      screenshotPath: await this.client.screenshot('events-expect-failure').catch(() => null),
      consoleErrors: this.client.consoleErrors,
      pageErrors: this.client.pageErrors,
      recoveryNotices: this.client.recoveryNotices,
      // Issue #175: same hidden-tab diagnosis toSessionFailure gets below —
      // an events.expect failure deserves the same honesty about WHY the
      // clock looks frozen.
      loopLiveness: snapshot.time.loopLiveness,
    });
    throw new SessionFailure('EVENTS_EXPECT_FAILED', block);
  }
}

/**
 * The `game` fixture value. Every method reaches `window.__vgai` (or its
 * relay-side equivalent) through `this.#transport` — see `bridge-transport.ts`'s
 * module doc for the seam, and this file's own module doc for why it, alone,
 * is allowed to import Playwright (via `PageTransport`, above).
 */
export class GameClient {
  readonly input = new GameInput(this);
  readonly events = new GameEvents(this);
  readonly fenceTick: number;
  /** Run-4 friction #5: see `GameClientOptions.fenceSeq`. */
  readonly fenceSeq: number;
  /** D5: see `GameClientOptions.fenceSimSeconds`. */
  readonly fenceSimSeconds: number;
  /** D5: see `GameClientOptions.fenceWallMs`. */
  readonly fenceWallMs: number;
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
  /** M13: hidden-tab recovery's own structured notices — kept SEPARATE from
   *  `consoleErrors` (see `hidden-recovery.ts`'s hook below and
   *  `failure-block.ts`'s `recoveryNotices` member). */
  readonly recoveryNotices: string[] = [];
  // Everything below is `#`-PRIVATE, not `private` — deliberately, and the
  // difference is observable. TypeScript's `private` is erased at compile
  // time: `this.transport = …` leaves an ordinary own property that
  // `Object.getOwnPropertyNames(game)` reports and `game.transport.call(…)`
  // happily invokes. `volter-game-editor eval --list` enumerates this object's REAL members
  // (it must — `input`/`events` are instance fields no prototype walk can
  // see), so an erased-private field is a plumbing detail advertised to every
  // agent as a door, right next to the doors it should actually use. `#` is
  // the only privacy the runtime enforces, so it is the only privacy an
  // introspecting listing can respect.
  readonly #transport: BridgeTransport;
  /** Where a labelled `screenshot()` lands — project-scoped by `@volter/game-live`, cwd-relative otherwise. Public: a caller reading it is asking a fair question, and `screenshot()` returns a path under it anyway. */
  readonly artifactsDir: string;
  /** See `GameClientOptions.projectRoot`. */
  readonly #projectRoot: string | undefined;
  /** See `GameClientOptions.warmSession`. */
  readonly #warmSession: boolean;
  /** See `GameClientOptions.testTitle`. */
  readonly #testTitle: string;
  #screenshotCounter = 0;
  /** Everyone watching this client's captures — see {@link GameClient.onCapture}. */
  readonly #captureListeners = new Set<CaptureListener>();
  /** Per-test tick-rate samples, fed by every `snapshot()` read (a poll the
   *  client was making anyway — zero extra page.evaluate round trips). */
  readonly #tps = new TpsAccumulator();
  /** True after the settled run-ticks door proved absent on this page (an older exported
   *  game's engine) — see `fastForward`'s `runTicksBatch`. */
  #legacyRunTicksDoor = false;
  /** Hidden-tab recovery (hollowstone field lesson: the engine hard-stops
   *  while `document.hidden`). Client-lifetime state so `bringToFront()`
   *  fires at most once per test, across ALL waitFor/waitSimTime loops. */
  readonly #hiddenRecovery: HiddenRecoveryDriver;
  /** run-3 friction #2 — throttled "a bridge call is flowing" liveness
   *  heartbeat (see bridge-heartbeat.ts's module doc), client-lifetime so
   *  the 30s throttle applies across the whole test, not per call site. */
  #bridgeHeartbeat: BridgeHeartbeatState;

  constructor(opts: GameClientOptions) {
    this.#transport = opts.transport;
    this.pageErrors = opts.pageErrors;
    this.consoleErrors = opts.consoleErrors;
    this.fenceTick = opts.fenceTick;
    this.fenceSeq = opts.fenceSeq;
    this.fenceSimSeconds = opts.fenceSimSeconds;
    this.fenceWallMs = opts.fenceWallMs;
    this.artifactsDir = opts.artifactsDir ?? resolve('.vgai/last-run');
    this.#projectRoot = opts.projectRoot;
    this.#warmSession = opts.warmSession ?? false;
    this.#testTitle = opts.testTitle ?? 'test';
    this.#bridgeHeartbeat = { lastEmitWallMs: Date.now() };
    this.#hiddenRecovery = new HiddenRecoveryDriver({
      sampleHidden: () => this.#transport.isHidden(),
      bringToFront: () => this.#transport.bringToFront(),
      log: (line) => {
        // M13: structured line on stdout AND into its OWN recoveryNotices
        // collection — NOT consoleErrors, so a real console error and a
        // benign "we recovered a backgrounded tab" notice never conflate in
        // the failure block's console/page-errors section.
        console.log(line);
        this.recoveryNotices.push(line);
      },
    });
  }

  async state(name: string): Promise<unknown> {
    return this.callBridge<unknown>('state', name);
  }

  async command(name: string, ...args: unknown[]): Promise<unknown> {
    return this.callBridgeAsync<unknown>('invoke', name, args);
  }

  async providers(): Promise<ProviderInfo[]> {
    return this.callBridge<ProviderInfo[]>('providers');
  }

  async commands(): Promise<DebugCommandInfo[]> {
    return this.callBridge<DebugCommandInfo[]>('commands');
  }

  async snapshot(sinceSeq?: number): Promise<DebugSnapshot> {
    const snap = await this.callBridge<DebugSnapshot>('snapshot', sinceSeq);
    // Both hardening seams hang off the read every poll loop already makes:
    // one tick-rate sample per snapshot, and one hidden-tab-recovery
    // observation (which only pays an extra evaluate once the tick has been
    // frozen for HIDDEN_RECOVERY_STALL_POLLS consecutive reads).
    this.#tps.record(snap.time.tick, Date.now());
    await this.#hiddenRecovery.observeTick(snap.time.tick);
    return snap;
  }

  /**
   * Read only the simulation clock for a predicate-free wait.
   *
   * `snapshot()` intentionally batches every declared provider for `waitFor`, whose predicate may
   * read any of them. `waitSimTime` has no predicate: serializing a large `unity` provider every
   * 150ms can itself consume multiple frames and corrupt the performance window it is advancing.
   * Keep the two hardening observers fed exactly as an ordinary snapshot does.
   */
  private async readTime(): Promise<DebugSnapshot['time']> {
    const time = await this.callBridge<DebugSnapshot['time']>('state', 'time');
    this.#tps.record(time.tick, Date.now());
    await this.#hiddenRecovery.observeTick(time.tick);
    return time;
  }

  /** Fixture-teardown perf read: p50/p95 effective ticks-per-second over all
   *  the snapshot polls this test performed. */
  tpsStats(): TpsStats {
    return this.#tps.stats();
  }

  /** True if the hidden-tab recovery fired (page.bringToFront was called). */
  hiddenRecoveryTriggered(): boolean {
    return this.#hiddenRecovery.wasTriggered();
  }

  /**
   * D15/T-D15.4 — synchronously drives `budget` worth of sim time/ticks via
   * the live `Game`'s `runTicks` (through the debug bridge), instead of
   * waiting for real wall-clock time to pass. Doctrine (see
   * `fast-forward.ts`'s module doc, which also documents the two honesty
   * decisions this wraps): SETUP/STAGING traversal — reaching a known
   * late-game state fast — not a substitute for real-input proofs, which
   * still run in real ticks. Returns the final `{time, state, events,
   * pageErrors}` snapshot (a completely ordinary `snapshot()` read, taken
   * AFTER the tps baseline reset below, so it never itself corrupts the tps
   * stats either).
   */
  async fastForward(
    budget: FastForwardBudget,
    opts: FastForwardOptions & { result: 'time' },
  ): Promise<FastForwardTime>;
  async fastForward(budget: FastForwardBudget, opts?: FastForwardOptions): Promise<DebugSnapshot>;
  async fastForward(
    budget: FastForwardBudget,
    opts?: FastForwardOptions,
  ): Promise<DebugSnapshot | FastForwardTime> {
    // Same options-object-only contract as `waitSimTime` (`ticksForBudget`
    // would otherwise fail on `'simTicks' in 0.5` with a raw TypeError that
    // names neither the method nor the shape).
    assertValidWaitForBudget(budget, 'fastForward');
    const clock: FastForwardClock = {
      // The SETTLED door (`runTicksSettled`, an async bridge method): ticks never race a scene
      // remount's async commit, so which tick first runs a freshly reloaded world is
      // deterministic (see engine/runtime/run-ticks-settled.ts — measured: without it, one
      // drive script produced 7 or 8 post-respawn walked ticks depending on wall timing).
      // Falls back ONCE to the plain sync door for a page whose engine predates the method
      // (an older exported game), and remembers the verdict for the rest of the burst.
      runTicksBatch: async (n, render) => {
        if (this.#legacyRunTicksDoor) {
          await this.callBridgeVoid('runTicks', n, { render });
          return;
        }
        try {
          await this.callBridgeAsync<void>('runTicksSettled', n, { render });
        } catch (error) {
          const code = (error as { code?: string }).code;
          const message = error instanceof Error ? error.message : String(error);
          const doorAbsent =
            code === 'UNKNOWN_BRIDGE_METHOD' || /is not a function|undefined/i.test(message);
          if (!doorAbsent) throw error;
          this.#legacyRunTicksDoor = true;
          await this.callBridgeVoid('runTicks', n, { render });
        }
      },
      readTime: async () => {
        // Raw, clock-only bridge read — deliberately NOT `this.snapshot()`,
        // which both feeds the TpsAccumulator and serializes every declared
        // provider. Large imported worlds can carry megabytes of census state;
        // the batching math needs only these two numbers.
        const time = await this.callBridge<DebugSnapshot['time']>('state', 'time');
        return { tick: time.tick, simSeconds: time.simSeconds };
      },
      heartbeat: (info) => {
        console.log(`volter-game-editor fastForward: ${info.ticksDone}/${info.ticksTotal} ticks driven`);
      },
    };
    const finalTime = await runFastForward(budget, opts ?? {}, clock);
    // The burst is over — reset the baseline so the very next ordinary poll
    // (including the `snapshot()` call right below) treats itself as a fresh
    // "first observation" rather than diffing across the burst's enormous
    // tick delta over a near-zero wall delta.
    this.#tps.resetBaseline();
    if (opts?.result === 'time') {
      return finalTime;
    }
    return this.snapshot();
  }

  async waitFor(
    pred: (s: (name: string) => unknown) => boolean,
    budget: WaitForBudget,
  ): Promise<void> {
    try {
      await runWaitFor(
        pred,
        budget,
        {
          snapshot: () => this.snapshot(),
          now: () => Date.now(),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          // Fixture heartbeat — real stdout, the
          // same channel a caller watching stdout already treats as
          // liveness (see wait-for.ts's module doc for the emission
          // invariant `maybeHeartbeat` enforces).
          log: (line) => console.log(line),
        },
        this.#testTitle,
      );
    } catch (err) {
      if (err instanceof WaitForTimeoutError) throw await this.toSessionFailure(err);
      throw err;
    }
  }

  /** Used by `input.hold` — waits for a sim-time delta to pass with no
   *  predicate (a predicate that is never true would misreport as a
   *  waitFor failure, so this is its own tiny loop, not `runWaitFor` with a
   *  false predicate).
   *
   *  D2: this loop has the SAME frozen-clock bug `runWaitFor` had — with no
   *  predicate at all, a stalled sim clock would poll forever, since
   *  `current.time.simSeconds` would never advance. Carries the identical
   *  stall guard (`WAIT_FOR_STALL_POLL_LIMIT` consecutive polls with an
   *  unchanged tick — see wait-for.ts's doc comment for the rationale),
   *  throwing the same `WaitForTimeoutError` shape so it renders through the
   *  same honest failure block as an ordinary `waitFor`/`waitSimTime` budget
   *  exhaustion. */
  async waitSimTime(budget: WaitForBudget): Promise<void> {
    // A positional budget (`waitSimTime(0.5)`) reads `undefined` here and the
    // exit comparison below is then false FOREVER — and against a hidden tab
    // the client drives its own ticks, so the frozen-clock stall guard never
    // fires either. Refuse in the caller's own vocabulary instead of hanging.
    assertValidWaitForBudget(budget, 'waitSimTime');
    const startWall = Date.now();
    // Predicate-free means clock-only from the FIRST read, not merely from the
    // second poll onward. A full initial snapshot serializes every provider;
    // the Unity FPS provider alone carries ~4,500 objects and measured a
    // 150-300ms main-thread hitch each time a caller began an otherwise cheap
    // wait. Failure diagnostics still take one complete terminal snapshot
    // below, only on the failure path where its state is actually printed.
    const startTime = await this.readTime();
    let lastTick: number | null = null;
    let stalledPolls = 0;
    // Fixture heartbeat — same invariant as
    // `wait-for.ts`'s `runWaitFor`: a heartbeat requires BOTH 60s of wall
    // silence AND the tick having advanced since the last one emitted, so a
    // genuinely stalled sim clock (caught by `stalledPolls` above, ~30s)
    // goes heartbeat-silent well before this loop's own guard ever needs to.
    let heartbeat: HeartbeatState = { lastEmitWallMs: startWall, lastEmitTick: startTime.tick };
    for (;;) {
      const currentTime = await this.readTime();
      const elapsed =
        'simSeconds' in budget
          ? currentTime.simSeconds - startTime.simSeconds
          : currentTime.tick - startTime.tick;
      if (elapsed >= budgetTarget(budget)) return;
      stalledPolls = lastTick !== null && currentTime.tick === lastTick ? stalledPolls + 1 : 0;
      lastTick = currentTime.tick;
      if (stalledPolls >= WAIT_FOR_STALL_POLL_LIMIT) {
        // Failure diagnostics still carry one honest complete terminal snapshot. The hot path above
        // stays clock-only; the expensive provider batch is paid only when it will be printed.
        const current = await this.snapshot();
        throw await this.toSessionFailure(
          new WaitForTimeoutError({
            budget,
            // The timeout renderer reads only the start clock; provider state
            // is intentionally terminal-only because no initial provider read
            // occurred. Empty collections state that absence honestly.
            startSnapshot: { time: startTime, state: {}, events: [], pageErrors: [] },
            lastSnapshot: current,
            wallElapsedMs: Date.now() - startWall,
            predicateSource:
              '(no predicate — game.input.hold is waiting for a sim-time delta to pass)',
            touchedProviders: [],
          }),
        );
      }
      const heartbeatResult = maybeHeartbeat({
        nowMs: Date.now(),
        tick: currentTime.tick,
        simSeconds: currentTime.simSeconds,
        testTitle: this.#testTitle,
        state: heartbeat,
      });
      heartbeat = heartbeatResult.state;
      if (heartbeatResult.line) console.log(heartbeatResult.line);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /**
   * Capture the running game to disk and return the ABSOLUTE path written.
   *
   * `labelOrPath` is read as a LABEL when it is a bare identifier
   * (`'waitfor-timeout'`) — numbered into the artifacts directory, the
   * long-standing spec behaviour — and as a DESTINATION PATH the moment it
   * carries a separator or a file extension, in which case the bytes land
   * exactly there (relative to `process.cwd()`). See
   * `screenshot-target.ts`'s header for the live incident that made this
   * distinction mandatory: a caller naming a path used to get "success" and
   * an empty path.
   */
  async screenshot(labelOrPath: string): Promise<string> {
    const target = resolveScreenshotTarget({
      arg: labelOrPath,
      artifactsDir: this.artifactsDir,
      sequence: this.#screenshotCounter + 1,
      cwd: process.cwd(),
      projectRoot: this.#projectRoot,
    });
    if (target.consumedSequence) this.#screenshotCounter += 1;
    await mkdir(dirname(target.path), { recursive: true });
    const transportNotes = await this.#transport.screenshot(target.path);
    // The out-path resolver is the only thing that knows the destination fell
    // under the served project root, and the notes are where a capture says
    // what it cost — so the two are joined here rather than at either end.
    const notes: CaptureNotes = {
      ...transportNotes,
      ...(target.underWatchedProjectRoot === undefined
        ? {}
        : { watchedProjectRoot: target.underWatchedProjectRoot }),
    };
    const capture = {
      label: labelOrPath,
      path: target.path,
      caveat: describeCaptureCaveat(notes),
    };
    // ONE place says the sentence, with the WHOLE note set — a human watching
    // this terminal and a run record read beside the frame must not be told
    // different things (`capture-notes.ts`'s contract). The transport used to
    // warn from its own partial set, which silently dropped every note this
    // layer adds.
    if (capture.caveat !== null)
      console.warn(`volter-game-editor screenshot: ${capture.path} — ${capture.caveat}`);
    // Sequential and AWAITED: a listener may need to read the game to stamp
    // this capture, and it must have finished before the path is handed back —
    // a caller that files the path is entitled to assume the record of it is
    // already complete. A throwing listener fails the call rather than being
    // swallowed: a capture whose bookkeeping silently did not happen is the
    // fabricated-evidence shape this whole seam exists to prevent.
    for (const listener of this.#captureListeners) await listener(capture);
    return target.path;
  }

  /**
   * Watch every capture this client writes, and get back the unsubscribe.
   *
   * The reason this exists rather than each caller wrapping `screenshot()`:
   * a run does not take all of its own captures. `waitFor`'s timeout path and
   * `events.expect`'s failure path each shoot a frame on their own
   * (`toSessionFailure`, `GameEvents.expect`), and a route's `whileHeld`
   * observer may shoot one from inside a callback the driver never sees. The
   * only place that sees ALL of them is here, which is why a driving tool
   * stamps its captures by listening rather than by intercepting.
   */
  onCapture(listener: CaptureListener): () => void {
    this.#captureListeners.add(listener);
    return () => {
      this.#captureListeners.delete(listener);
    };
  }

  /**
   * One dialect, full capability — runs a UI-automation step
   * written as a literal Playwright `async (page) => {...}` (interface
   * doctrine §3.2/§4 rung 4: "the AI should think it is basically just
   * executing Playwright"). Under `PageTransport` this drives the REAL
   * `Page` (real closures, real hit-testing); under `RelayTransport` it
   * posts the step's own `toString()` source to the editor dev server's
   * `page-script` op, which reconstructs it in-page against
   * `playwright-shim.ts`'s in-page shim (`isTrusted: false` synthetic
   * DOM events, no real hit testing). This is the honest input path for a
   * React-only DOM game; canvas gameplay continues to use `game.input.*`.
   * Write specs as if ALWAYS serialized — inline every value the step needs,
   * never close over imported `expect`/helpers/outer variables, and return
   * observations to assert outside the callback. See `bridge-transport.ts`'s
   * `runPageScript` doc comment for the full contract this method wraps.
   */
  async page<T = unknown>(step: (page: Page) => T | Promise<T>): Promise<T> {
    const erased = (arg: unknown) => step(arg as Page);
    const outcome = await this.#transport.runPageScript(
      selfContainedStepSource(step as (scope: unknown) => unknown),
      erased,
    );
    return this.unwrap<T>(outcome);
  }

  /**
   * THE MODULE LANE — run literal JS INSIDE the game's page, with the
   * running mount's modules in reach:
   *
   * ```js
   * await game.run(async ({ modules }) => {
   *   const { simHost } = await modules('src/sim/host.ts');
   *   return simHost().state.day;
   * })
   * ```
   *
   * `scope` is `{ page, modules, instanceId }`. Serialization contract as
   * `game.page()`: the step travels as source (no closures), and the return
   * value must be plain data. `modules(path)` resolves through the ACTIVE
   * mount's own url space, so what you touch IS the running game — never a
   * phantom second copy. Dev-server sessions only; a shipped build's curated
   * surface is its adapter exports.
   *
   * `modules(path)` IS ASYNC — it dynamic-imports that url — so the callback
   * is `async` and the call is `await`ed, in every example on this page and
   * everywhere else. Skipping it does not fail quietly: reading a member off
   * the unawaited promise throws a message naming the fix, because
   * `TypeError: modules(...).simHost is not a function` (measured, cold fox
   * #3) says nothing about promises.
   *
   * `modules` IS A FUNCTION, not a table — there is no module registry. To ask
   * what the mount has loaded, read `modules.loaded`, the project-relative
   * paths you can pass straight back in:
   *
   * ```js
   * await game.run(({ modules }) => modules.loaded)
   * // → ['src/scenes/MainScene.tsx', 'src/world.tsx', …]
   * ```
   */
  async run<T = unknown>(
    step: (scope: {
      page: Page;
      modules: ((path: string) => Promise<Record<string, unknown>>) & { readonly loaded: string[] };
      instanceId: string;
    }) => T | Promise<T>,
    opts?: { instance?: string },
  ): Promise<T> {
    const erased = (arg: unknown) => step(arg as Parameters<typeof step>[0]);
    const outcome = await this.#transport.runGameScript(
      selfContainedStepSource(step as (scope: unknown) => unknown),
      erased,
      opts?.instance,
    );
    return this.unwrap<T>(outcome);
  }

  /**
   * Reload the document showing the game, resolving only once it is back and
   * answering commands (see `bridge-transport.ts`'s `reloadPage`).
   *
   * Bound as `page.reload()` on `@volter/game-live`'s `page` binding. It is the one
   * recovery for bytes that changed on disk after the running document
   * loaded: `volter-game-editor restart` remounts every root from fresh SOURCE, but
   * module-scope loaders and the page-lifetime asset caches (Pixi `Assets`,
   * three's loader caches) survive a remount and keep serving the old bytes.
   */
  async reloadPage(): Promise<void> {
    await this.#transport.reloadPage();
  }

  private async toSessionFailure(err: WaitForTimeoutError): Promise<SessionFailure> {
    const providers = await this.providers();
    const screenshotPath = await this.screenshot('waitfor-timeout').catch(() => null);
    const block = assembleFailureBlock({
      headline: err.message,
      simElapsedSeconds:
        err.info.lastSnapshot.time.simSeconds - err.info.startSnapshot.time.simSeconds,
      wallElapsedMs: err.info.wallElapsedMs,
      tick: err.info.lastSnapshot.time.tick,
      predicateSource: err.info.predicateSource,
      providers,
      touchedProviders: err.info.touchedProviders,
      lastState: err.info.lastSnapshot.state,
      lastEvents: err.info.lastSnapshot.events,
      screenshotPath,
      consoleErrors: this.consoleErrors,
      pageErrors: this.pageErrors,
      recoveryNotices: this.recoveryNotices,
      // Issue #175 — "state must never claim health it cannot observe": a
      // waitFor/waitSimTime timeout with a ~0x sim-speed ratio used to read
      // as a generic "loop is stalled" no matter WHY the clock was frozen.
      // `HiddenRecoveryDriver` already tried ONE `bringToFront()` recovery
      // before this failure fires (see this class's constructor) — if the
      // loop is STILL loop-starved here, recovery couldn't reach the tab
      // (headless run, no-op bringToFront), and the failure block must say
      // so explicitly rather than leaving an agent to guess "stalled" for a
      // tab that is simply backgrounded.
      loopLiveness: err.info.lastSnapshot.time.loopLiveness,
    });
    return new SessionFailure('WAIT_FOR_TIMEOUT', block);
  }

  /** run-3 friction #2 — called at the top of every bridge dispatch, before
   *  the await, so a burst of short calls (e.g. many `hold()`s) keeps
   *  printing throttled liveness even while individually near-silent. See
   *  bridge-heartbeat.ts's module doc for why this needs no sim-tick
   *  awareness the way `wait-for.ts`'s poll-loop heartbeat does. */
  private emitBridgeHeartbeatIfDue(method: string): void {
    const result = maybeBridgeHeartbeat({
      nowMs: Date.now(),
      method,
      testTitle: this.#testTitle,
      state: this.#bridgeHeartbeat,
    });
    this.#bridgeHeartbeat = result.state;
    if (result.line) console.log(result.line);
  }

  /** @internal exposed for GameInput/GameEvents in this module only. */
  async callBridge<T>(method: string, ...callArgs: unknown[]): Promise<T> {
    this.emitBridgeHeartbeatIfDue(method);
    const outcome = await this.#transport.call(method, callArgs);
    return this.unwrap<T>(outcome);
  }

  /** @internal like `callBridge`, but awaits the page-side call (for async
   *  bridge methods like `invoke`). */
  async callBridgeAsync<T>(method: string, ...callArgs: unknown[]): Promise<T> {
    this.emitBridgeHeartbeatIfDue(method);
    const outcome = await this.#transport.callAsync(method, callArgs);
    return this.unwrap<T>(outcome);
  }

  /** @internal void-returning convenience (clearVirtualActions). */
  async callBridgeVoid(method: string, ...callArgs: unknown[]): Promise<void> {
    await this.callBridge<void>(method, ...callArgs);
  }

  private unwrap<T>(outcome: BridgeCallOutcome): T {
    if (!outcome.ok) {
      const error = outcome.error ?? { code: undefined, message: 'unknown bridge error' };
      const message = appendWarmSessionHint(error.message, error.code, this.#warmSession);
      throw new SessionError(error.code ?? 'DEBUG_COMMAND_FAILED', message, error.data);
    }
    return outcome.result as T;
  }
}
