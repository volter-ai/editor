/**
 * THE SESSION-WIRE DISPATCH — `bridge-call`'s method table, moved out of the
 * editor's `command-listener.ts` with the verb it serves (WORK.md §The
 * workbench).
 *
 * The game skew's own host modules — play mode, the active-systems registry,
 * the live-seam evidence recorders, the ingest contract — are reached through
 * the `@editor/*` alias the editor's Vite serves to every contribution, and
 * become this package's own imports when they move. Nothing here is host API.
 */

import {
  getActiveSystems,
  InstanceResolutionError,
  systemsForInstance,
} from '@volter/editor-core/authoring/active-systems';
import { collectPlayRunPageErrors } from '@volter/editor-core/command-listener';
import { gameContractEpoch } from '../host/coverage/game-contract-seam-evidence';
import { recordLiveSeamEvidence } from '@volter/editor-sdk/kit/live-seam-evidence';
import { systemAdapterEpoch } from '@volter/editor-sdk/kit/system-seam-evidence';
import {
  HOLD_STARVED_NO_DRIVER_REASON,
  waitForHoldBudget,
} from '@volter/game-runtime/runtime/debug-bridge';
import type { SystemAdapters } from '@volter/editor-project/adapter';
import { activeIngestContract } from '../ingest/ingest-play-control';
import { getPlayRuntimeAccess } from '../play/play-mode';

/** Is there ANY live debug plane to answer from?
 *
 *  Not the same question as `isPlayModeActive()`: the edit-time R3F design
 *  session publishes the edit-mounted world's own registry through
 *  `setActiveSystems` while play is stopped (ARCHITECTURE-CORE §Editor chrome
 *  — "the edit-time design session PUBLISHES its debug plane"), so a stopped
 *  session with a mounted world has a real, honest plane to read: the game's
 *  declared providers/commands, values as the still world reports them.
 *  An INGESTED game reaches the same answer by a different route and is the
 *  second reason this predicate is provenance-free: its mount IS the running
 *  game, so it never creates a play session at all, and what it publishes
 *  through `setActiveSystems` is the debug adapter projected from its own
 *  declared contract (`ingest-root-adapter.ts` →
 *  `@volter/game-runtime/adapter/ingest/contract-debug-adapter`). The question asked here is
 *  only ever "has a live mount published a plane", never who mounted it.
 *  `notPlayingResult()` stays the answer for the genuinely-no-world case. */
export const hasLiveDebugPlane = (): boolean => getActiveSystems().debug != null;

/** Duck-typed structured error (see `structuredErrorResult` above) — a plain
 *  `Error` carrying a machine-readable `code` (and optional `data`), the same
 *  shape `DebugError`/`InputActionError` already throw. Used by
 *  `dispatchBridgeMethod` below for its OWN precondition failures (no debug
 *  adapter installed, no InputManager wired) so they survive
 *  `structuredErrorResult` exactly like an engine-thrown error would. */
export function bridgeError(code: string, message: string, data?: Record<string, unknown>): Error {
  const err = new Error(message) as Error & { code: string; data?: unknown };
  err.code = code;
  if (data) err.data = data;
  return err;
}

function returnedNames(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value
      .filter((entry): entry is { name: string } =>
        Boolean(entry && typeof entry === 'object' && typeof entry.name === 'string'),
      )
      .map((entry) => entry.name),
  );
}

function debugUseReachesContract(
  member: string,
  value: unknown,
  name: string | undefined,
  commands: ReadonlySet<string>,
  state: ReadonlySet<string>,
): boolean {
  if (member === 'commands') {
    const returned = returnedNames(value);
    return Array.isArray(value) && [...commands].every((declared) => returned.has(declared));
  }
  if (member === 'providers') {
    const returned = returnedNames(value);
    return Array.isArray(value) && [...state].every((declared) => returned.has(declared));
  }
  if (!name) return false;
  if (member === 'state') return state.has(name);
  if (member === 'invoke') return commands.has(name);
  return false;
}

function recordContractSystemUse(member: string, value: unknown, name?: string): void {
  const contract = activeIngestContract();
  const systems = contract?.systems;
  if (!contract || !systems) return;
  const commands = new Set((systems.commands ?? []).map((entry) => entry.name));
  const state = new Set((systems.state ?? []).map((entry) => entry.name));
  if (!debugUseReachesContract(member, value, name, commands, state)) return;
  recordLiveSeamEvidence({
    seam: 'contract.systems',
    subject: 'game',
    epoch: gameContractEpoch(contract),
    stage: 'operation',
    outcome: 'pass',
    source: 'consumer',
    detail: `the session wire consumed contract systems through debug.${member}`,
  });
}

/**
 * #140 — the generic session-wire dispatch table: the SAME method-name
 * surface `window.__vgai` exposes (`@volter/game-runtime/runtime/debug-bridge`'s
 * `VgaiDebugHandle` — `state`/`stateAll`/`providers`/`commands`/`events`/
 * `snapshot`/`invoke`/`runTicks`/`input.*`), built from the SAME
 * registry-backed accessors the sibling
 * `gameplay.command.ts` verbs (`list-gameplay-state`/`inject-input`/`run-ticks`)
 * already use. This is what makes the
 * `bridge-call` relay op (below) a session-generic primitive rather than a
 * test-specific one — any client of the live session (the `@volter/editor-live`
 * `RelayTransport`, a future one-shot `vgai game state/call/hold` REPL) can
 * issue `{method, callArgs}` against it with no dependency on a proof run's
 * own lifecycle/env, and get byte-identical dispatch to the page-transport's
 * `page.evaluate(bridgeCallInPage)` (D17) — without requiring the editor tab
 * to be loaded with `?vgai-debug=1` (that gate exists for the bridge's own
 * production exposure; this relay is already local-loopback-only — see
 * `editor-server.ts`'s CSRF/origin guard).
 */
export async function dispatchBridgeMethod(
  method: string,
  callArgs: unknown[],
  instance?: string,
): Promise<unknown> {
  // ADDRESSED resolution, not editor focus. `getActiveSystems()` answers "the
  // game the user is looking at", which is the right question for the panels
  // and the wrong one here: a relayed command names an instance, and resolving
  // it through focus would let a bot drive whichever game was last clicked.
  // With one instance the two coincide, which is why this was invisible.
  let debug: SystemAdapters['debug'];
  try {
    debug = systemsForInstance(instance).debug;
  } catch (err) {
    if (err instanceof InstanceResolutionError) {
      throw bridgeError('INSTANCE_UNRESOLVED', `session wire: "${method}" — ${err.message}`, {
        instances: err.instances,
      });
    }
    throw err;
  }
  const requireDebug = () => {
    if (!debug) {
      throw bridgeError(
        'DEBUG_ADAPTER_UNAVAILABLE',
        `session wire: "${method}" — this game exposes no debug adapter`,
      );
    }
    return debug;
  };
  // Named `throughDebug`, not `useDebug`: a `use`-prefixed local reads as a
  // React hook to the lint rules a package is checked under.
  const throughDebug = <T>(member: string, stage: 'operation' | 'effect', run: () => T): T => {
    const adapter = requireDebug();
    const epoch = systemAdapterEpoch(adapter);
    try {
      const value = run();
      recordLiveSeamEvidence({
        seam: `system.debug.${member}`,
        subject: 'game',
        epoch,
        stage,
        outcome: 'pass',
        source: 'consumer',
        detail: `the session wire called debug.${member} and received its result`,
      });
      recordLiveSeamEvidence({
        seam: 'system.debug',
        subject: 'game',
        epoch,
        stage: 'operation',
        outcome: 'pass',
        source: 'consumer',
        detail: 'the session wire consumed the mounted debug adapter',
      });
      recordContractSystemUse(member, value, callArgs[0] as string | undefined);
      return value;
    } catch (error) {
      recordLiveSeamEvidence({
        seam: `system.debug.${member}`,
        subject: 'game',
        epoch,
        stage,
        outcome: 'fail',
        source: 'consumer',
        detail: `the session wire called debug.${member} and it failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  };
  switch (method) {
    case 'state':
      return throughDebug('state', 'operation', () => requireDebug().state(callArgs[0] as string));
    case 'stateAll':
      return throughDebug('stateAll', 'operation', () => requireDebug().stateAll());
    case 'providers':
      return throughDebug('providers', 'operation', () => requireDebug().providers());
    case 'commands':
      return throughDebug('commands', 'operation', () => requireDebug().commands());
    case 'events':
      return throughDebug('events', 'operation', () =>
        requireDebug().events(callArgs[0] as number | undefined),
      );
    case 'snapshot': {
      const adapter = requireDebug();
      return {
        time: throughDebug('state', 'operation', () => adapter.state('time')) as {
          simSeconds: number;
          tick: number;
        },
        state: throughDebug('stateAll', 'operation', () => adapter.stateAll()),
        // Run-4 friction #5 — same `sinceSeq` contract as the in-page
        // bridge's `snapshot()` (`runtime/debug-bridge.ts`): both doors must
        // fence identically, or a script driving the live session (this door)
        // vs. standalone (that door) could disagree about which events are
        // "new".
        events: throughDebug('events', 'operation', () =>
          adapter.events(callArgs[0] as number | undefined),
        ),
        // #146 (closes the #140 honest-empty gap): the editor page already
        // funnels window error/unhandledrejection into the editor console as
        // level 'error' / source 'runtime' (`installEditorConsoleCapture`'s
        // boot-time listeners) — the SAME events and message format
        // `window.__vgai`'s own handle buffers. Fenced to the current play run
        // via `inPlayRun` so a probe never reads a previous run's stale
        // failures, capped at 100 for parity with the bridge's ring buffer.
        pageErrors: collectPlayRunPageErrors(),
      };
    }
    case 'invoke': {
      const name = callArgs[0] as string;
      const invokeArgs = (callArgs[1] as unknown[]) ?? [];
      try {
        const result = await requireDebug().invoke(name, invokeArgs);
        const adapter = requireDebug();
        recordLiveSeamEvidence({
          seam: 'system.debug.invoke',
          subject: 'game',
          epoch: systemAdapterEpoch(adapter),
          stage: 'effect',
          outcome: 'pass',
          source: 'consumer',
          detail: `the session wire invoked debug command "${name}" and received its result`,
        });
        recordLiveSeamEvidence({
          seam: 'system.debug',
          subject: 'game',
          epoch: systemAdapterEpoch(adapter),
          stage: 'operation',
          outcome: 'pass',
          source: 'consumer',
          detail: 'the session wire consumed the mounted debug adapter',
        });
        recordContractSystemUse('invoke', result, name);
        return result;
      } catch (error) {
        const adapter = requireDebug();
        recordLiveSeamEvidence({
          seam: 'system.debug.invoke',
          subject: 'game',
          epoch: systemAdapterEpoch(adapter),
          stage: 'effect',
          outcome: 'fail',
          source: 'consumer',
          detail: `the session wire invoked debug command "${name}" and it failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        throw error;
      }
    }
    case 'runTicks': {
      const runtime = getPlayRuntimeAccess();
      if (!runtime?.runTicks) {
        throw bridgeError(
          'RUN_TICKS_UNAVAILABLE',
          'this play session has no first-party Game to run ticks on',
        );
      }
      const n = callArgs[0] as number;
      const opts = callArgs[1] as { render?: 'last' | 'all' | 'none' } | undefined;
      runtime.runTicks(n, opts);
      return undefined;
    }
    case 'runTicksSettled': {
      // The settled-aware driver (`engine/runtime/run-ticks-settled.ts`) — a tick never races
      // a scene remount's async commit; byte-identical with the relay's `run-ticks` case and
      // the page bridge's own `runTicksSettled` (D17).
      const runtime = getPlayRuntimeAccess();
      if (!runtime?.runTicksSettled) {
        throw bridgeError(
          'RUN_TICKS_UNAVAILABLE',
          'this play session has no first-party Game to run ticks on',
        );
      }
      const n = callArgs[0] as number;
      const opts = callArgs[1] as { render?: 'last' | 'all' | 'none' } | undefined;
      await runtime.runTicksSettled(n, opts);
      return undefined;
    }
    case 'input.setVirtualAction':
    case 'input.tapVirtualAction':
    case 'input.clearVirtualActions':
    // bridge↔wire coverage-parity gate (`bridge-wire-parity.test.ts`)
    // closed this trio's gap: `startRecording`/`stopRecording`/`isRecording`
    // exist on the page bridge's `VgaiDebugInputHandle` (`runtime/
    // debug-bridge.ts`) but had no relay case at all — an agent driving the
    // input-trace recorder over the session wire (RelayTransport) instead of
    // `?vgai-debug=1` simply had no door to it. Same single optional
    // trailing `worldId` shape as `clearVirtualActions`.
    case 'input.startRecording':
    case 'input.stopRecording':
    case 'input.isRecording': {
      const runtime = getPlayRuntimeAccess();
      // D15/T-D15.5 (rebase composition with #140): this wire is a THIRD
      // door to the virtual-input target — it must resolve through the SAME
      // `DebugRegistry.getVirtualInputTarget(worldId?)` the page bridge
      // (`window.__vgai.input.*`) and the `inject-input` relay case use, so
      // no two doors can ever disagree about which world an unqualified
      // actuation targets. Each method takes the page bridge's own optional
      // trailing `worldId` (byte-parity with `VgaiDebugInputHandle`); an
      // explicit, unregistered id throws the registry's structured
      // `DEBUG_INPUT_WORLD_NOT_FOUND`, shipped back over the wire as-is.
      const worldId = (
        method === 'input.setVirtualAction'
          ? callArgs[2]
          : method === 'input.tapVirtualAction'
            ? callArgs[1]
            : callArgs[0]
      ) as string | undefined;
      const inputTarget = runtime ? runtime.getInputTarget(worldId) : null;
      if (!inputTarget) {
        throw bridgeError(
          'DEBUG_INPUT_UNAVAILABLE',
          `session wire: ${method}() has no virtual-input target wired — no default three ` +
            "world has mounted yet, or this project's mount path never wired one",
        );
      }
      if (method === 'input.setVirtualAction') {
        return inputTarget.setVirtualAction(
          callArgs[0] as string,
          callArgs[1] as boolean | number | { x: number; y: number },
        );
      }
      if (method === 'input.tapVirtualAction') {
        return inputTarget.tapVirtualAction(callArgs[0] as string);
      }
      if (method === 'input.clearVirtualActions') {
        inputTarget.clearVirtualActions();
        return undefined;
      }
      if (method === 'input.startRecording') {
        inputTarget.startInputRecording();
        return undefined;
      }
      if (method === 'input.stopRecording') {
        inputTarget.stopInputRecording();
        return undefined;
      }
      return inputTarget.isInputRecording();
    }
    case 'input.scheduleActionAtTick': {
      // bridge↔wire coverage-parity gate: `window.__vgai.input.
      // scheduleActionAtTick` (`runtime/debug-bridge.ts`, D15/T-D15.5) had NO
      // bridge-call case — it was reachable over the relay ONLY via the
      // separate `inject-input` command's `atTick` field (see that case,
      // above), never by this method name. Same `getInputTarget(worldId?)`
      // resolution as the other `input.*` cases; forwards `tick`/`action`/
      // `value` straight through and returns whatever the target returns
      // (`void`, same as the page bridge's own `scheduleActionAtTick`).
      const runtime = getPlayRuntimeAccess();
      const tick = callArgs[0] as number;
      const action = callArgs[1] as string;
      const value = callArgs[2] as boolean | number | { x: number; y: number };
      const worldId = callArgs[3] as string | undefined;
      const inputTarget = runtime ? runtime.getInputTarget(worldId) : null;
      if (!inputTarget) {
        throw bridgeError(
          'DEBUG_INPUT_UNAVAILABLE',
          'session wire: input.scheduleActionAtTick() has no virtual-input target wired — no ' +
            "default three world has mounted yet, or this project's mount path never wired one",
        );
      }
      return inputTarget.scheduleActionAtTick(tick, action, value);
    }
    case 'input.injectPointerDelta':
    case 'input.injectPointerPosition': {
      // pointer-dispatch op: `window.__vgai.input.injectPointerDelta`/
      // `injectPointerPosition` (`runtime/debug-bridge.ts`) had no relay case
      // — this is the HONEST gameplay-seam reading of "pointer dispatch": the
      // engine's existing virtual pointer-injection, never a synthesized DOM
      // mouse event (that boundary belongs to the future playwright shim).
      // Same `getInputTarget(worldId?)` resolution as every other `input.*`
      // case.
      const runtime = getPlayRuntimeAccess();
      const sourceId = callArgs[0] as string;
      const value = callArgs[1] as { x: number; y: number };
      const worldId = callArgs[2] as string | undefined;
      const inputTarget = runtime ? runtime.getInputTarget(worldId) : null;
      if (!inputTarget) {
        throw bridgeError(
          'DEBUG_INPUT_UNAVAILABLE',
          `session wire: ${method}() has no virtual-input target wired — no default three ` +
            "world has mounted yet, or this project's mount path never wired one",
        );
      }
      if (method === 'input.injectPointerDelta') {
        inputTarget.injectPointerDelta(sourceId, value);
      } else {
        inputTarget.injectPointerPosition(sourceId, value);
      }
      return undefined;
    }
    case 'holdFor': {
      // #140/D17: byte-identical semantics to `window.__vgai.holdFor` (door
      // a, `runtime/debug-bridge.ts`) — same `getInputTarget(worldId?)`
      // resolution as the `input.*` cases above, same `waitForHoldBudget`
      // poll/stall loop (imported, not hand-copied, so the two doors can
      // never silently drift apart), reached through `requireDebug().state
      // ('time')` instead of a `DebugRegistry` (this relay only has
      // `getActiveSystems().debug`, not the registry itself).
      const runtime = getPlayRuntimeAccess();
      const worldId = callArgs[2] as string | undefined;
      const inputTarget = runtime ? runtime.getInputTarget(worldId) : null;
      if (!inputTarget) {
        throw bridgeError(
          'DEBUG_INPUT_UNAVAILABLE',
          'session wire: holdFor() has no virtual-input target wired — no default three ' +
            "world has mounted yet, or this project's mount path never wired one",
        );
      }
      const action = callArgs[0] as string;
      const simSeconds = callArgs[1] as number;
      const setResult = inputTarget.setVirtualAction(action, true);
      if (!setResult.delivered) {
        inputTarget.clearVirtualActions();
        return { delivered: false, reason: setResult.reason };
      }
      const { stalled, starvedWithoutDriver } = await waitForHoldBudget(
        requireDebug(),
        simSeconds,
        runtime?.runTicks ? (n) => runtime.runTicks?.(n, { render: 'last' }) : undefined,
      );
      inputTarget.clearVirtualActions();
      if (!stalled) return { delivered: true };
      return {
        delivered: false,
        reason: starvedWithoutDriver ? HOLD_STARVED_NO_DRIVER_REASON : 'play stopped during hold',
      };
    }
    default:
      throw bridgeError('UNKNOWN_BRIDGE_METHOD', `session wire: unknown bridge method "${method}"`);
  }
}
