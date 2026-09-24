/**
 * The standalone in-page debug bridge. Query-gated `window.__vgai`, the same
 * production-protection-lives-in-the-installer pattern `render-control.ts`'s
 * `installRenderControlHarness` established for `?vgai-render=1` (production
 * protection lives HERE, not just at whatever call site invokes this — a
 * caller that calls {@link maybeInstallDebugBridge} unconditionally on every
 * boot still only ever gets a handle when the gate below actually passes).
 *
 * D17: this is door (a) of the seam's three doors — the SAME `DebugAdapter`
 * names/JSON the editor relay (door b) and `@vgai/live` (door c, which
 * drives door (a) itself over Playwright) all read. D18: the bridge installs
 * only when the page opts in (`?vgai-debug=1`) AND is either a dev build
 * (`import.meta.env.DEV`) or the project's manifest explicitly opts a
 * production build in (`manifest.debug.allowInProduction`, the described
 * field whose runtime reader THIS module is).
 */

import type { DebugAdapter, TickStampedEvent } from '@volter/editor-project/adapter/system-adapter';
import type { GameLoopLiveness } from '../core/types';
import { DebugError, type DebugRegistry, type RunTicksOptions } from './debug-registry';
import { runTicksWhenSettled } from './run-ticks-settled';

/** Query-param name that opts a standalone page into the debug bridge (D18) —
 *  mirrors `render-seed.ts`'s `RENDER_MODE_QUERY_PARAM` naming/shape, own
 *  const because this is a different call site with a different flag. */
export const DEBUG_MODE_QUERY_PARAM = 'vgai-debug';

/** The subset of `ResolvedGameManifest` the D18 gate reads — typed narrowly
 *  (not imported from `manifest/load.ts`) so this module doesn't need the
 *  full manifest shape, just the one described field it is the runtime
 *  reader for. */
export interface DebugBridgeManifest {
  readonly debug?: { readonly allowInProduction: boolean } | undefined;
}

/** The bridge's actuation surface — byte-identical method names to
 *  `InputManager`'s virtual-action primitives (Task 1.4), reached through
 *  `DebugRegistry.getVirtualInputTarget(worldId?)` rather than a direct
 *  import. Every method takes an optional trailing `worldId` (D15/T-D15.5,
 *  the review-objection-2 fix): omitted, it resolves to the SAME default
 *  world the editor relay's `inject-input` case resolves to (one shared
 *  resolution function, `debug-registry.ts`'s `resolveInputRootId`) — never
 *  "whichever world's `InputManager` happened to register last". An
 *  explicit `worldId` reaches that world's `InputManager` specifically. */
export interface VgaiDebugInputHandle {
  setVirtualAction(
    action: string,
    value: boolean | number | { x: number; y: number },
    worldId?: string,
  ): { delivered: boolean; reason?: string };
  tapVirtualAction(action: string, worldId?: string): { delivered: boolean; reason?: string };
  clearVirtualActions(worldId?: string): void;
  /**
   * D15/T-D15.5: schedule a virtual actuation for a specific tick — applied
   * at the START of that tick's input phase, composing with `runTicks` (a
   * schedule for tick 500 fires exactly once the sim has been driven
   * through tick 500, regardless of burst size). A digital `true` produces
   * a genuine `isJustPressed` edge exactly at the target tick. Throws
   * `INPUT_ACTION_NOT_FOUND`/a valueType mismatch (same as
   * `setVirtualAction`) or `TICK_ALREADY_PASSED` (`data.currentTick`, the
   * NEXT tick to be serviced) for a tick that already elapsed.
   *
   * A scheduled tick whose input phase never runs at all (that world
   * paused/frozen, or skipped by a multi-tick gap, when the target tick
   * would have been serviced) DROPS the actuation rather than applying it
   * late — it is never delivered, and there is no `{delivered: false,
   * reason}`-shaped result to read here (the call already returned, long
   * before the drop happens). The only observable trace is an
   * `'input.schedule.dropped'` debug event (`{tick, action}`), readable via
   * `state()`/`stateAll()`'s `events` or `snapshot().events`.
   */
  scheduleActionAtTick(
    tick: number,
    action: string,
    value: boolean | number | { x: number; y: number },
    worldId?: string,
  ): void;
  /** Start (or restart) recording the post-gate action-delta trace, readable
   *  back via `state('input.trace')`/`stateAll()` (a built-in provider —
   *  itself resolved against the DEFAULT world only; see that provider's own
   *  doc comment in `debug-registry.ts`). */
  startRecording(worldId?: string): void;
  /** Stop recording — the trace accumulated so far stays readable. */
  stopRecording(worldId?: string): void;
  /** Whether a recording is currently active. */
  isRecording(worldId?: string): boolean;
  /** Accumulate a synthetic pointer delta for a named test source — mirrors
   *  `InputManager.injectPointerDelta` (the "injected test input" seam):
   *  multiple calls within the same frame SUM, and the accumulator clears
   *  each frame (`endFrame`). Bindings with `valueType: 'pointerDelta'`
   *  reading this source (`{ type: 'test_pointer_delta', sourceId }`) see the
   *  accumulated value via `getPointerDelta`. */
  injectPointerDelta(sourceId: string, delta: { x: number; y: number }, worldId?: string): void;
  /** Set a synthetic absolute pointer position for a named test source —
   *  mirrors `InputManager.injectPointerPosition`: LAST-WRITE-WINS across
   *  contributing sources on read, and persists until changed. Bindings with
   *  `valueType: 'pointerPosition'` reading this source (`{ type:
   *  'test_pointer_position', sourceId }`) see it via `getPointerPosition`. */
  injectPointerPosition(sourceId: string, value: { x: number; y: number }, worldId?: string): void;
}

/** `snapshot()`'s return shape — ONE synchronous pass over the registry, so
 *  every field reflects the exact same instant (AC-B1.2's batched-read
 *  primitive: a probe polling this never sees `time` from one tick and
 *  `state` from another). */
export interface VgaiDebugSnapshot {
  /** `loopLiveness` (issue #175): the REAL `GameLoop.liveness` behind this
   *  session — `'loop-starved'` when no recent host rAF progress was observed,
   *  `null` only when no loop is wired at all (a bare debug-registry test
   *  stand-in with no real `Game`). Never a fabricated `'running'` and never
   *  a conclusion about tab visibility. */
  time: { simSeconds: number; tick: number; loopLiveness: GameLoopLiveness | null };
  state: Record<string, unknown>;
  events: TickStampedEvent[];
  pageErrors: string[];
}

/** The frozen `window.__vgai` shape (D18/spec §3.4) — version it if it ever
 *  needs a breaking change; `providers`/`state`/`stateAll`/`commands`/`events`
 *  are straight off the game's `DebugAdapter`, `invoke` re-checks D18 gating
 *  (belt-and-braces, AC-A1.7), and `input`/`snapshot` are bridge-only. */
export interface VgaiDebugHandle {
  readonly version: 1;
  providers: DebugAdapter['providers'];
  state: DebugAdapter['state'];
  stateAll: DebugAdapter['stateAll'];
  commands: DebugAdapter['commands'];
  invoke(name: string, args: unknown[]): Promise<unknown>;
  events: DebugAdapter['events'];
  input: VgaiDebugInputHandle;
  /** See `DebugAdapter.events`'s doc comment for `sinceSeq`'s contract
   *  (run-4 friction #5) — `snapshot`'s `events` member is filtered the exact
   *  same way, just batched with `time`/`state`/`pageErrors` into one
   *  synchronous read. */
  snapshot(sinceSeq?: number): VgaiDebugSnapshot;
  /**
   * D15/T-D15.4 door (a): synchronously drive `n` fixed gameplay ticks via the
   * live `Game`'s `GameInternal.runTicks` (`runtime/game.ts`) — reached through
   * `DebugRegistry.getRunTicksTarget()`, the SAME target the editor relay's
   * `run-ticks` case (→ `play.runTicks`, door b) calls, so behavior is
   * byte-identical across every door (D17). Throws `DEBUG_RUN_TICKS_UNAVAILABLE`
   * if no `Game` has wired a target yet (no world mounted); throws whatever
   * `runTicks` itself throws otherwise (e.g. `RUN_TICKS_PAUSED`) — never a
   * silent no-op.
   */
  runTicks(n: number, opts?: RunTicksOptions): void;
  /**
   * The SETTLED-AWARE variant of {@link runTicks} (`runtime/run-ticks-settled.ts` — one
   * implementation with the editor relay's `run-ticks` case, D17): drives the budget one tick
   * at a time and, before each tick, waits for every registered world-settled probe
   * (`DebugRegistry.registerWorldSettledProbe`, declared by the game's `debug.settled` entry
   * export) — so a tick never races a scene remount's async commit, and WHICH tick first runs
   * a freshly reloaded world is a function of the sim rather than wall timing. Session tick
   * drivers (`@vgai/live`'s fastForward) prefer this door; with no probe registered it behaves
   * exactly like {@link runTicks}. Bounded: throws `WORLD_UNSETTLED_TIMEOUT` if a probe never
   * settles.
   */
  runTicksSettled(n: number, opts?: RunTicksOptions): Promise<void>;
  /**
   * Collapses `input.setVirtualAction(action, true)` → wait `simSeconds` of
   * REAL sim time (real ticks — deliberately NOT `runTicks`/fast-forward;
   * this is the honest human-input-path proof) → `input.clearVirtualActions()`
   * into ONE async bridge call, as a TOP-LEVEL method (not under `input`)
   * because it needs the sim clock, not just the input target. Was 15+
   * transport round trips over the editor relay (`@vgai/live`'s old
   * `GameInput.hold`: set → a 150ms-interval `waitSimTime` snapshot poll loop
   * → clear); now one `page.evaluate`/relay call that runs the wait
   * in-process on the page.
   *
   * Resolves the world's input target exactly like the other `input.*`
   * methods (`worldId` omitted → the same default-world resolution every
   * door on this seam shares). A gated actuation (the initial
   * `setVirtualAction` reports `delivered:false`) clears immediately and
   * resolves that SAME `{delivered:false, reason}` shape WITHOUT waiting —
   * matching `setVirtualAction`'s own gated-result contract. If the live
   * game's sim clock stalls while waiting (play stopped/paused mid-hold),
   * the action is still cleared (never left stuck) and this resolves
   * `{delivered:false, reason:'play stopped during hold'}` instead of
   * hanging forever. Throws `DEBUG_INPUT_UNAVAILABLE`/
   * `DEBUG_INPUT_WORLD_NOT_FOUND` up front, same as `input.setVirtualAction`,
   * when no target is wired/resolvable at all.
   */
  holdFor(
    action: string,
    simSeconds: number,
    worldId?: string,
  ): Promise<{ delivered: boolean; reason?: string }>;
  /**
   * Defect 5 fix — undo everything THIS install did: remove the
   * `error`/`unhandledrejection` window listeners it added, and delete
   * `window.__vgai` so the registry is no longer reachable from the page.
   * Idempotent (a second call is a harmless no-op). `mountManifestRoots`
   * wires this into its session's `stop()`; a caller mounting more
   * directly (a hand-rolled host) should call it on its own teardown path.
   */
  uninstall(): void;
}

/** Structural `window` surface this module needs — just enough to publish
 *  the handle and listen for page errors, typed narrowly (no `any`, no DOM
 *  lib dependency beyond what every other runtime module already assumes). */
export interface DebugBridgeWindowTarget {
  addEventListener?(
    type: 'error' | 'unhandledrejection',
    listener: (event: { message?: string; error?: unknown; reason?: unknown }) => void,
  ): void;
  /** Defect 5 fix — the installer's `uninstall()` calls this (when present)
   *  to remove the exact listener references it added via `addEventListener`
   *  above. Optional, like `addEventListener`, so a minimal test/host stub
   *  that never needs to uninstall can omit it. */
  removeEventListener?(
    type: 'error' | 'unhandledrejection',
    listener: (event: { message?: string; error?: unknown; reason?: unknown }) => void,
  ): void;
  [key: string]: unknown;
}

export interface MaybeInstallDebugBridgeOptions {
  /** The game-scoped registry (`getDebugRegistry(session.game)`) — its
   *  `.adapter` backs every read/invoke method on the published handle, and
   *  its `getVirtualInputTarget()` backs `input.*`. */
  readonly registry: DebugRegistry;
  readonly manifest: DebugBridgeManifest;
  /** Where to read `?vgai-debug=1` from. Defaults to `window.location` when a
   *  real `window` exists; a headless caller with no `window` at all (and no
   *  override) gets no bridge — there's nowhere to read a URL from. */
  readonly url?: { readonly search: string } | undefined;
  /** Where to publish the handle and install the page-error listeners.
   *  Defaults to the real `window`; override in a unit test to avoid
   *  touching (or requiring) the global object. */
  readonly window?: DebugBridgeWindowTarget | undefined;
}

const PAGE_ERROR_CAP = 100;

/** `holdFor`'s in-process poll interval — this loop never leaves the page
 *  (no transport round trip per poll, unlike `@vgai/live`'s old
 *  `waitSimTime`), so it can afford to be tighter than that loop's 150ms. */
const HOLD_FOR_POLL_MS = 50;

/** Consecutive `HOLD_FOR_POLL_MS` polls with the tick unchanged before
 *  `holdFor` gives up waiting and treats the game as stopped — mirrors
 *  `@vgai/live`'s `WAIT_FOR_STALL_POLL_LIMIT` reasoning (`wait-for.ts`:
 *  a genuinely frozen sim clock must never poll forever), scaled to this
 *  faster in-process interval so the wall-clock grace period (~5s) lands in
 *  the same neighborhood. */
const HOLD_FOR_STALL_POLL_LIMIT = 100;

/** Maximum ticks driven per synchronous starved-loop batch. Sized like
 *  `fast-forward.ts`'s own batching rationale: big enough that per-batch
 *  bookkeeping is negligible, small enough that one batch of a complex game's
 *  phases stays a short synchronous burst. The actual batch is capped to the
 *  hold's remaining fixed-tick budget below; otherwise a one-tick `tap()` in a
 *  hidden tab becomes a 60-tick hold and releases only after short gameplay
 *  interactions have already completed. */
const STARVED_DRIVE_BATCH_TICKS = 60;

/** Hard ceiling on starved-drive batches for ONE hold — `STARVED_DRIVE_BATCH_TICKS
 *  * this` ≈ 33 sim-minutes. A bound, not a timeout: it exists so a
 *  `runTicks` target that advances the tick counter without advancing the sim
 *  clock can never spin forever, and it is far past any honest hold. */
const STARVED_DRIVE_MAX_BATCHES = 2000;

/** The message a hold gets when the loop is loop-starved and NOTHING can
 *  drive it — the one case where the platform genuinely prevents the verb
 *  from working. Names the cause and the fix rather than expiring into a
 *  generic stall (which reported the wrong cause: "play stopped during
 *  hold"). One exported constant so both doors and their tests read the same
 *  string. */
export const HOLD_STARVED_NO_DRIVER_REASON =
  "the host loop reported liveness 'loop-starved' and this session has no way to drive " +
  'ticks — no recent rAF progress was observed. Check `vgai status` for the separate ' +
  'visibility readings; foreground/reload the editor, or start play to wire the run-ticks ' +
  'target, then retry.';

/** What `adapter.state('time')` returns for the two fields this loop reads,
 *  plus the liveness the hidden path branches on. */
interface HoldClockReading {
  simSeconds: number;
  tick: number;
  loopLiveness?: GameLoopLiveness | null;
  /** Present for every real Game-backed debug registry. Optional only because a bare adapter
   *  stand-in can omit it; that case drives one conservative tick at a time. */
  fixedDt?: number;
}

/**
 * Resolves once `simSeconds` of sim time has elapsed since the call, or once
 * the wait provably cannot make progress. Never rejects. Exported (not just
 * used by `holdFor` below) so the editor relay's `command-listener.ts`
 * `holdFor` case can share the EXACT same logic against its own
 * `DebugAdapter` (reached via `getActiveSystems().debug` rather than a
 * `DebugRegistry`) — D17: byte-identical behavior across doors, not two
 * hand-copies that can silently drift apart.
 *
 * Two regimes, and the split is the whole point:
 *
 * - **Visible**: the host loop is ticking on its own, so this polls it every
 *   `HOLD_FOR_POLL_MS` and gives up after `HOLD_FOR_STALL_POLL_LIMIT`
 *   consecutive unchanged-tick polls (`stalled: true` — play stopped/paused).
 *
 * - **Loop-starved**: no recent host rAF progress is observable, so sim time
 *   only moves reliably if this drives it. It therefore drives
 *   the WHOLE remaining budget in synchronous batches, yielding a MICROTASK
 *   between them — never a timer. That distinction is load-bearing, not
 *   stylistic: a hidden tab clamps `setTimeout` to ~1s (and to ~1/minute under
 *   Chrome's intensive throttling after 5 minutes hidden), so the previous
 *   "drive 3 ticks, then `setTimeout(poll, 50)`" shape ran the sim at ~3
 *   ticks per SECOND. A 1.2s hold needed ~24 clamped turns — ~24s of wall
 *   clock against the editor relay's 5s per-command budget, which is exactly
 *   how a hold that passes on a foregrounded tab died with a generic
 *   "editor connected but did not respond" on a backgrounded one. Microtasks
 *   are not throttled, so the hidden path now costs sim-work time and nothing
 *   else.
 *
 * The regime is re-read every iteration, so an rAF chain that resumes or
 * becomes starved mid-hold crosses over without restarting the budget.
 *
 * `starvedWithoutDriver: true` is the one honest refusal: loop-starved with
 * no `driveStarvedTicks` hook means nothing in this process can advance the
 * clock, so it reports that IMMEDIATELY (see
 * {@link HOLD_STARVED_NO_DRIVER_REASON}) instead of burning the stall guard
 * and then blaming a stopped game.
 */
export async function waitForHoldBudget(
  adapter: DebugAdapter,
  simSeconds: number,
  driveStarvedTicks?: (n: number) => void,
): Promise<{ stalled: boolean; starvedWithoutDriver?: boolean }> {
  const readTime = () => adapter.state('time') as HoldClockReading;
  const start = readTime();
  let lastTick = start.tick;
  let stalledPolls = 0;
  let starvedBatches = 0;

  for (;;) {
    const current = readTime();
    if (current.simSeconds - start.simSeconds >= simSeconds) return { stalled: false };

    if (current.loopLiveness === 'loop-starved') {
      if (!driveStarvedTicks) return { stalled: true, starvedWithoutDriver: true };
      if (starvedBatches >= STARVED_DRIVE_MAX_BATCHES) return { stalled: true };
      starvedBatches += 1;
      const remaining = simSeconds - (current.simSeconds - start.simSeconds);
      const fixedDt = current.fixedDt;
      // A real Game publishes its fixed timestep, so drive exactly the number of whole ticks
      // still needed (up to the throughput cap). Subtract a tiny ratio tolerance before `ceil`:
      // repeated floating-point additions can leave an integer tick budget a few ulps above its
      // mathematical value, and that must not manufacture one extra held-input frame. A bare
      // adapter that does not publish `fixedDt` takes the conservative path: one tick, re-read,
      // repeat. Exact input duration matters more than batching a non-Game test stand-in.
      const ticksForRemaining =
        fixedDt !== undefined && Number.isFinite(fixedDt) && fixedDt > 0
          ? Math.max(1, Math.ceil(remaining / fixedDt - 1e-9))
          : 1;
      driveStarvedTicks(Math.min(STARVED_DRIVE_BATCH_TICKS, ticksForRemaining));
      const after = readTime();
      // A batch that moved neither the tick counter nor the sim clock means
      // the drive is a no-op (paused game, torn-down runtime) — the same
      // "nothing is advancing" verdict the visible path's stall guard
      // reaches, just observable in one batch instead of a hundred polls.
      if (after.tick === current.tick && after.simSeconds === current.simSeconds) {
        return { stalled: true };
      }
      lastTick = after.tick;
      stalledPolls = 0;
      // Yield so the page can service other work between batches, WITHOUT
      // handing control to the same timer lane the browser may be starving.
      await Promise.resolve();
      continue;
    }

    stalledPolls = current.tick === lastTick ? stalledPolls + 1 : 0;
    lastTick = current.tick;
    if (stalledPolls >= HOLD_FOR_STALL_POLL_LIMIT) return { stalled: true };
    await new Promise<void>((resolve) => setTimeout(resolve, HOLD_FOR_POLL_MS));
  }
}

function hasRealWindow(): boolean {
  return typeof window !== 'undefined';
}

function isDebugModeRequested(url: { readonly search: string }): boolean {
  return new URLSearchParams(url.search).get(DEBUG_MODE_QUERY_PARAM) === '1';
}

/** D18's gate: a dev build, or a production build the manifest explicitly
 *  opted in. Read fresh on every call (not cached at install time) so
 *  `invoke()`'s belt-and-braces re-check (AC-A1.7) is a genuine second
 *  evaluation, not a rubber stamp of a value computed once at install. */
function isDebugAllowed(manifest: DebugBridgeManifest): boolean {
  return Boolean(import.meta.env?.DEV) || manifest.debug?.allowInProduction === true;
}

function buildDebugHandle(opts: {
  registry: DebugRegistry;
  manifest: DebugBridgeManifest;
  window: DebugBridgeWindowTarget;
}): VgaiDebugHandle {
  const { registry, manifest } = opts;
  const adapter = registry.adapter;

  const pageErrors: string[] = [];
  function pushPageError(message: string): void {
    pageErrors.push(message);
    if (pageErrors.length > PAGE_ERROR_CAP) pageErrors.shift();
  }
  // Named (not inline-anonymous) so `uninstall()` below can pass the exact
  // same reference to `removeEventListener` (Defect 5 fix).
  const onWindowError = (event: { message?: string; error?: unknown }) => {
    pushPageError(event.message || String(event.error));
  };
  const onWindowRejection = (event: { reason?: unknown }) => {
    pushPageError(`Unhandled promise rejection: ${String(event.reason)}`);
  };
  opts.window.addEventListener?.('error', onWindowError);
  opts.window.addEventListener?.('unhandledrejection', onWindowRejection);

  function requireInputTarget(method: string, worldId?: string) {
    const target = registry.getVirtualInputTarget(worldId);
    if (!target) {
      throw new DebugError(
        'DEBUG_INPUT_UNAVAILABLE',
        `debug bridge: ${method}() has no virtual-input target wired — no default three ` +
          "world has mounted yet, or this project's mount path never wired one",
      );
    }
    return target;
  }

  return {
    version: 1,
    // None of these `DebugAdapter` methods reference `this` (they close over
    // the registry's own private maps) — passing the references directly is
    // safe and avoids five redundant wrapper closures.
    providers: adapter.providers,
    state: adapter.state,
    stateAll: adapter.stateAll,
    commands: adapter.commands,
    events: adapter.events,
    async invoke(name, args) {
      // Belt-and-braces D18 re-check (AC-A1.7): the outer install gate
      // already required this to be true, but a caller could hold onto this
      // handle across an environment/manifest change — refuse loudly rather
      // than trust a decision made once at install time.
      if (!isDebugAllowed(manifest)) {
        throw new DebugError(
          'DEBUG_COMMANDS_UNSUPPORTED',
          `debug: command "${name}" invocation refused — production build without ` +
            'debug.allowInProduction (D18)',
          { name },
        );
      }
      return adapter.invoke(name, args);
    },
    input: {
      setVirtualAction: (action, value, worldId) =>
        requireInputTarget('setVirtualAction', worldId).setVirtualAction(action, value),
      tapVirtualAction: (action, worldId) =>
        requireInputTarget('tapVirtualAction', worldId).tapVirtualAction(action),
      clearVirtualActions: (worldId) =>
        requireInputTarget('clearVirtualActions', worldId).clearVirtualActions(),
      scheduleActionAtTick: (tick, action, value, worldId) =>
        requireInputTarget('scheduleActionAtTick', worldId).scheduleActionAtTick(
          tick,
          action,
          value,
        ),
      startRecording: (worldId) =>
        requireInputTarget('startRecording', worldId).startInputRecording(),
      stopRecording: (worldId) => requireInputTarget('stopRecording', worldId).stopInputRecording(),
      isRecording: (worldId) => requireInputTarget('isRecording', worldId).isInputRecording(),
      injectPointerDelta: (sourceId, delta, worldId) =>
        requireInputTarget('injectPointerDelta', worldId).injectPointerDelta(sourceId, delta),
      injectPointerPosition: (sourceId, value, worldId) =>
        requireInputTarget('injectPointerPosition', worldId).injectPointerPosition(sourceId, value),
    },
    snapshot(sinceSeq) {
      // One synchronous pass — see VgaiDebugSnapshot's doc comment.
      return {
        time: adapter.state('time') as {
          simSeconds: number;
          tick: number;
          loopLiveness: GameLoopLiveness | null;
        },
        state: adapter.stateAll(),
        events: adapter.events(sinceSeq),
        pageErrors: pageErrors.slice(),
      };
    },
    runTicks(n, runTicksOpts) {
      const target = registry.getRunTicksTarget();
      if (!target) {
        throw new DebugError(
          'DEBUG_RUN_TICKS_UNAVAILABLE',
          'debug bridge: runTicks() has no run-ticks target wired — no Game has mounted yet',
        );
      }
      target.runTicks(n, runTicksOpts);
    },
    runTicksSettled(n, runTicksOpts) {
      return runTicksWhenSettled(registry, n, runTicksOpts);
    },
    async holdFor(action, simSeconds, worldId) {
      const target = requireInputTarget('holdFor', worldId);
      const setResult = target.setVirtualAction(action, true);
      if (!setResult.delivered) {
        target.clearVirtualActions();
        // `exactOptionalPropertyTypes`: don't write an explicit `reason:
        // undefined` when the gate itself didn't supply one — omit the key
        // entirely rather than assign `undefined` into an optional `string`
        // property.
        return setResult.reason !== undefined
          ? { delivered: false, reason: setResult.reason }
          : { delivered: false };
      }
      const runTicksTarget = registry.getRunTicksTarget();
      const { stalled, starvedWithoutDriver } = await waitForHoldBudget(
        adapter,
        simSeconds,
        runTicksTarget ? (n) => runTicksTarget.runTicks(n, { render: 'last' }) : undefined,
      );
      target.clearVirtualActions();
      if (!stalled) return { delivered: true };
      return {
        delivered: false,
        reason: starvedWithoutDriver ? HOLD_STARVED_NO_DRIVER_REASON : 'play stopped during hold',
      };
    },
    uninstall() {
      opts.window.removeEventListener?.('error', onWindowError);
      opts.window.removeEventListener?.('unhandledrejection', onWindowRejection);
      delete opts.window['__vgai'];
    },
  };
}

/**
 * Install `window.__vgai` iff the page opted in (`?vgai-debug=1`) AND D18's
 * gate passes (dev build, or manifest `debug.allowInProduction`). When the
 * param is present but the gate fails, warns once (this single call IS the
 * "once" — there is exactly one install attempt per boot) and installs
 * nothing. Returns the installed handle (mostly useful for tests), or
 * `undefined` when nothing was installed.
 */
export function maybeInstallDebugBridge(
  opts: MaybeInstallDebugBridgeOptions,
): VgaiDebugHandle | undefined {
  const url = opts.url ?? (hasRealWindow() ? window.location : undefined);
  if (!url) return undefined;
  if (!isDebugModeRequested(url)) return undefined;

  const windowTarget =
    opts.window ?? (hasRealWindow() ? (window as unknown as DebugBridgeWindowTarget) : undefined);
  if (!windowTarget) return undefined;

  if (!isDebugAllowed(opts.manifest)) {
    // biome-ignore lint/suspicious/noConsole: structured, greppable D18 signal — mirrors debug-registry.ts's own console.warn idiom.
    console.warn(
      '[debug] ?vgai-debug=1 ignored: production build without debug.allowInProduction (D18)',
    );
    return undefined;
  }

  const handle = buildDebugHandle({
    registry: opts.registry,
    manifest: opts.manifest,
    window: windowTarget,
  });
  windowTarget['__vgai'] = handle;
  return handle;
}
