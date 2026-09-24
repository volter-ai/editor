/**
 * The DEBUG-SEAM verbs of the session wire (`@volter/editor-sdk/commands`, a
 * `workspace.command` contribution): reading a running game's declared state
 * and commands, and actuating its input, time scale, seed and tick loop.
 *
 * All eight read/actuate the LIVE play session's game-scoped debug registry
 * (`SystemAdapters.debug`, installed by `setActiveSystems` on play enter) or
 * its InputManager/GameLoop (via `getPlayRuntimeAccess`). A stopped session
 * answers with a structured failure, never a fabricated success; a running
 * game that exposes NO debug adapter (a non-first-party mount) degrades to
 * the honest empty/null shape.
 *
 * Play mode and the active-systems registry are the game skew's own modules,
 * still housed in the editor until Play leaves the host (WORK.md §The
 * workbench, G); they are reached through the `@editor/*` alias the editor's
 * Vite serves to every contribution, and become this package's own imports
 * when they move. Nothing here is host API.
 */

import { getActiveSystems } from '@volter/editor-core/authoring/active-systems';
import type { CommandContribution } from '@volter/editor-sdk/commands';
import { notPlayingResult, structuredErrorResult } from '../src/command-results';
import { getPlayRuntimeAccess, isPlayModeActive } from '../src/play/play-mode';

export const point = 'workspace.command';

export const commands: CommandContribution['commands'] = {
  'list-gameplay-state': {
    derivedRefresh: 'if-content-changed',
    handle: () => {
      const debug = getActiveSystems().debug;
      if (!debug) {
        return isPlayModeActive() ? { ok: true, data: { providers: [] } } : notPlayingResult();
      }
      return { ok: true, data: { providers: debug.providers() } };
    },
  },
  'inspect-gameplay-state': {
    derivedRefresh: 'if-content-changed',
    handle: (cmd) => {
      const debug = getActiveSystems().debug;
      if (!debug) {
        return isPlayModeActive() ? { ok: true, data: { state: null } } : notPlayingResult();
      }
      const keys = cmd['keys'] as string[] | undefined;
      try {
        const state: Record<string, unknown> = {};
        if (keys && keys.length > 0) {
          for (const key of keys) state[key] = debug.state(key);
        } else {
          Object.assign(state, debug.stateAll());
        }
        return { ok: true, data: { state } };
      } catch (err) {
        return structuredErrorResult(err);
      }
    },
  },
  'list-debug-commands': {
    derivedRefresh: 'if-content-changed',
    handle: () => {
      const debug = getActiveSystems().debug;
      if (!debug) {
        return isPlayModeActive() ? { ok: true, data: { commands: [] } } : notPlayingResult();
      }
      return { ok: true, data: { commands: debug.commands() } };
    },
  },
  'invoke-debug-command': {
    derivedRefresh: 'always',
    handle: async (cmd) => {
      const debug = getActiveSystems().debug;
      if (!debug) {
        if (!isPlayModeActive()) return notPlayingResult();
        // Honest not-registered shape: no adapter means NOTHING is registered.
        return {
          ok: false,
          error: `debug: no command registered under "${cmd['name']}" — this game exposes no debug adapter`,
          data: { code: 'DEBUG_COMMAND_NOT_REGISTERED', registered: [] },
        };
      }
      try {
        const result = await debug.invoke(cmd['name'] as string, (cmd['args'] as unknown[]) ?? []);
        return { ok: true, data: { result } };
      } catch (err) {
        return structuredErrorResult(err);
      }
    },
  },
  'inject-input': {
    derivedRefresh: 'none',
    handle: (cmd) => {
      const runtime = getPlayRuntimeAccess();
      if (!runtime) {
        return { ok: false, error: 'not in play mode — start play before injecting input' };
      }
      // D15/T-D15.5 (review objection 2's fix) — resolved through the SAME
      // per-world `DebugRegistry.getVirtualInputTarget(worldId?)` the debug
      // bridge's `window.__vgai.input.*` calls, instead of the old
      // `Game.input` (always the DEFAULT world only) — an explicit
      // `cmd['worldId']` reaches that world specifically; omitted resolves
      // to the same default both doors now share. Throws
      // `DEBUG_INPUT_WORLD_NOT_FOUND` (caught below) for an explicit,
      // unregistered world id.
      let input: ReturnType<typeof runtime.getInputTarget>;
      try {
        input = runtime.getInputTarget(cmd['worldId'] as string | undefined);
      } catch (err) {
        return structuredErrorResult(err);
      }
      if (!input) {
        return {
          ok: false,
          error: 'this play session has no first-party InputManager to inject into',
        };
      }
      try {
        // Action-level is primary (frozen decision, spec §3.2): the honest
        // gated path — a gated actuation surfaces {delivered:false, reason},
        // never a false ok. The four legacy kinds map to the persistent
        // test-source injectors (read back only through declared test_*
        // bindings, so `delivered` here means "the source was written").
        if (cmd['kind'] === 'action') {
          const atTick = cmd['atTick'];
          // D15/T-D15.5 — `atTick` defers to InputManager.scheduleActionAtTick
          // instead of an immediate setVirtualAction. scheduleActionAtTick
          // throws InputActionError/a valueType mismatch (same as
          // setVirtualAction) or InputTickError ('TICK_ALREADY_PASSED',
          // data.currentTick) — all caught by this handler's outer try/catch
          // below via structuredErrorResult.
          if (typeof atTick === 'number') {
            input.scheduleActionAtTick(
              atTick,
              cmd['action'] as string,
              cmd['value'] as boolean | number | { x: number; y: number },
            );
            return { ok: true, data: { scheduled: true, tick: atTick } };
          }
          const outcome = input.setVirtualAction(
            cmd['action'] as string,
            cmd['value'] as boolean | number | { x: number; y: number },
          );
          return { ok: true, data: outcome };
        }
        const sourceId = cmd['sourceId'] as string;
        switch (cmd['kind']) {
          case 'axis':
            input.injectAxis(sourceId, cmd['value'] as number);
            break;
          case 'vector2':
            input.injectVector2(sourceId, cmd['value'] as { x: number; y: number });
            break;
          case 'pointerDelta':
            input.injectPointerDelta(sourceId, cmd['value'] as { x: number; y: number });
            break;
          case 'pointerPosition':
            input.injectPointerPosition(sourceId, cmd['value'] as { x: number; y: number });
            break;
          default:
            return { ok: false, error: `unknown injection kind "${cmd['kind']}"` };
        }
        return { ok: true, data: { delivered: true } };
      } catch (err) {
        return structuredErrorResult(err);
      }
    },
  },
  'set-time-scale': {
    derivedRefresh: 'none',
    handle: (cmd) => {
      const runtime = getPlayRuntimeAccess();
      if (!runtime) {
        return { ok: false, error: 'not in play mode — start play before setting time-scale' };
      }
      runtime.loop.timeScale = cmd['timeScale'] as number;
      // Read back after the loop's own [0,8] clamp so the caller sees the
      // value actually applied.
      return { ok: true, data: { timeScale: runtime.loop.timeScale } };
    },
  },
  // D15/T-D15.6 — the `play.seed.set` relay verb: reaches the live
  // session's `ctx.random.reseed(seed)` through `getPlayRuntimeAccess()`'s
  // `random` accessor. Gated on `determinismDeclared` (the running
  // project's manifest `determinism.seededRandom`, per T4.1: reseeding a
  // project with no documented determinism contract would silently imply
  // one exists) — the structured `DETERMINISM_NOT_DECLARED` marker the SDK
  // maps to its own declared error code.
  'set-seed': {
    derivedRefresh: 'none',
    handle: (cmd) => {
      const runtime = getPlayRuntimeAccess();
      if (!runtime) {
        return { ok: false, error: 'not in play mode — start play before setting the seed' };
      }
      if (!runtime.determinismDeclared) {
        return {
          ok: false,
          error:
            "this project's manifest does not declare determinism.seededRandom — " +
            'play.seed.set has no documented contract to reseed against (D15)',
          data: { code: 'DETERMINISM_NOT_DECLARED' },
        };
      }
      if (!runtime.random) {
        return {
          ok: false,
          error: 'this play session has no first-party ctx.random to reseed',
        };
      }
      runtime.random.reseed(cmd['seed'] as number);
      // Read back the live, post-reseed value (mirrors set-time-scale's own
      // read-after-apply convention immediately above).
      return { ok: true, data: { seed: runtime.random.seed } };
    },
  },
  // D15/T-D15.4 — the `play.runTicks` relay verb: reaches the live
  // session's `GameInternal.runTicks` through `getPlayRuntimeAccess()`'s
  // `runTicks` accessor (itself backed by the SAME
  // `DebugRegistry.getRunTicksTarget()` the bridge's
  // `window.__vgai.runTicks` calls — one implementation, byte-identical
  // behavior across doors, D17). `runTicks` itself throws a structured
  // `DebugError` (`RUN_TICKS_PAUSED`) while paused — never a silent no-op —
  // which `structuredErrorResult` below carries through as `data.code`.
  'run-ticks': {
    derivedRefresh: 'none',
    handle: async (cmd) => {
      const runtime = getPlayRuntimeAccess();
      if (!runtime) {
        return { ok: false, error: 'not in play mode — start play before running ticks' };
      }
      if (!runtime.runTicks) {
        return {
          ok: false,
          error: 'this play session has no first-party Game to run ticks on',
          data: { code: 'RUN_TICKS_UNAVAILABLE' },
        };
      }
      try {
        const n = cmd['n'] as number;
        const render = cmd['render'] as 'last' | 'all' | 'none' | undefined;
        // The settled-aware driver (`runtime/run-ticks-settled.ts`): a tick never races a
        // scene remount's async commit — byte-identical with the bridge's `runTicksSettled`
        // door (D17). With no world-settled probe registered it is `runTicks` exactly.
        if (runtime.runTicksSettled) {
          await runtime.runTicksSettled(n, render ? { render } : undefined);
        } else {
          runtime.runTicks(n, render ? { render } : undefined);
        }
        return { ok: true };
      } catch (err) {
        return structuredErrorResult(err);
      }
    },
  },
};
