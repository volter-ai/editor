/**
 * The GAME-SCOPED input wiring one world mount owns — HOST work performed from
 * outside the world's own tree, shared verbatim by the three and canvas lanes
 * (a project has ONE input map and one bot-input doctrine, whatever surface
 * reads them).
 *
 * Two things happen here:
 *
 *  1. the project's input map is loaded through `Game.loadInputMap` (game-owned,
 *     load-once), so the actions the project declared exist;
 *  2. this root's seams are registered on the game-scoped debug registry
 *     (`setVirtualInputTarget`/`setInputActionsSource`/`setInputTraceSource`),
 *     which is what makes `game.input.hold/tap/...` (the bot/`vgai eval` input
 *     doctrine) and the built-in `input.actions`/`input.trace` providers
 *     resolve to this world instead of throwing `DEBUG_INPUT_UNAVAILABLE`.
 *
 * A world's React tree receives no vgai context — this wiring is precisely the
 * part that never needed one: every closure below reads GAME-scoped state the
 * host owns (`game.input`, `game.loop.fixedDt`, the game's seed).
 *
 * `optionalInputMap` is the CONVENTIONAL-PATH probe used when the project
 * never named a map: an absent file is the ordinary state of a brand-new
 * project, so it resolves quietly instead of printing an error on every boot.
 * A map that exists and fails to parse is as loud as ever.
 *
 * LIFETIME, honestly: `registry.strip(id)` runs on the mount's dispose, but it
 * walks providers/commands only — the three seams set here survive it, keyed
 * by this world's id, until a remount of the same id overwrites them. That
 * residue is inert rather than hidden: every closure reads game-scoped state,
 * so a stale entry actuates exactly what a live one would. What it can still
 * do is name a dead world in `DEBUG_INPUT_WORLD_NOT_FOUND`'s registered list.
 * Do not write "the strip clears the input seams" anywhere without changing
 * `strip` to actually do it.
 */

import type { HostGameHandle } from './host-context';
import { getSeededRandom } from '@volter/game-runtime/core/seeded-random';
import type { DebugRegistry } from './debug-registry';

/** The conventional input-map location every scaffolded project ships
 *  (`public/inputmaps/default.inputmap.json`). */
export const DEFAULT_INPUT_MAP_PATH = '/inputmaps/default.inputmap.json';

/** The slice of a host context this wiring reads — satisfied structurally by
 *  both `ThreeHostContext` and `CanvasHostContext`. */
export interface GameInputSeamHost {
  readonly game?: HostGameHandle | null | undefined;
  readonly headless?: boolean | undefined;
}

export function wireGameInputSeams(
  host: GameInputSeamHost,
  registry: DebugRegistry,
  options: {
    readonly id: string;
    readonly inputMapPath?: string | null | undefined;
    readonly optionalInputMap?: boolean | undefined;
  },
): Promise<void> {
  const { id, inputMapPath = DEFAULT_INPUT_MAP_PATH, optionalInputMap = false } = options;
  if (!host.game) return Promise.resolve();
  const game = host.game;
  const input = game.input;
  registry.setInputActionsSource(id, () =>
    input.actionNames().map((name) => ({ name, valueType: input.getActionValueType(name) })),
  );
  registry.setInputTraceSource(id, () => {
    const raw = input.getInputTrace();
    return {
      version: raw.version,
      seed: getSeededRandom(game)?.seed ?? null,
      fixedDt: game.loop.fixedDt,
      ticks: raw.ticks,
    };
  });
  registry.setVirtualInputTarget(id, {
    setVirtualAction: (action, value) => input.setVirtualAction(action, value),
    tapVirtualAction: (action) => input.tapVirtualAction(action),
    clearVirtualActions: () => input.clearVirtualActions(),
    scheduleActionAtTick: (tick, action, value) => input.scheduleActionAtTick(tick, action, value),
    startInputRecording: () => input.startInputRecording(),
    stopInputRecording: () => input.stopInputRecording(),
    isInputRecording: () => input.isInputRecording(),
    injectAxis: (sourceId, value) => input.injectAxis(sourceId, value),
    injectVector2: (sourceId, value) => input.injectVector2(sourceId, value),
    injectPointerDelta: (sourceId, delta) => input.injectPointerDelta(sourceId, delta),
    injectPointerPosition: (sourceId, value) => input.injectPointerPosition(sourceId, value),
  });
  if (host.headless || inputMapPath === null) return Promise.resolve();
  // Load-once through the game-owned path (competing paths across roots throw
  // THERE, loudly). A FAILED load (missing/bad file) must not fail the mount:
  // a world with no declared actions is legal. It degrades loudly instead —
  // naming exactly what breaks.
  // The non-optional call passes ONE argument, exactly as it always has — a
  // trailing `undefined` is a different call to any observer of it.
  const load = optionalInputMap
    ? game.loadInputMap(inputMapPath, { optional: true })
    : game.loadInputMap(inputMapPath);
  return load.catch((err: unknown) => {
    // biome-ignore lint/suspicious/noConsole: deliberate loud degrade — the documented alternative to failing the mount (see comment above)
    console.error(
      `world "${id}": failed to load input map "${inputMapPath}" — declared input ` +
        'actions and `game.input.*` (bot/virtual input) will not work until a valid map ' +
        `loads. Ship one at the conventional path (${DEFAULT_INPUT_MAP_PATH}). ` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}
