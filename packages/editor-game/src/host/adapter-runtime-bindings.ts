/**
 * Installs the loaded `vgai.adapter.ts` runtime bindings onto one mounted
 * Game. Game modules stay native: adapter closures close over app-owned stores
 * and functions, while this host-side file projects them onto the existing
 * session command/state/input doors.
 */

import {
  installNativeDebugBindings,
  installNativeSystemsBindings,
} from '@volter/game-runtime/adapter/native-debug-module';
import { publishDevInstruments } from '@volter/game-runtime/dev/instruments';
import {
  DebugError,
  type DebugRegistry,
  type DebugVirtualInputTarget,
  getDebugRegistry,
} from '@volter/game-runtime/runtime/debug-registry';
import type { Game } from '@volter/game-runtime/runtime/game';
import {
  ADAPTER_INPUT_VALUE_TYPES,
  type AdapterInputAction,
  type AdapterInputBinding,
  type AdapterInputValue,
  type AdapterInputValueType,
  type ObservationDeclaration,
} from '@volter/editor-project/adapter/adapter-module';
import type { ObservationBinding } from '@volter/editor-project/adapter/binding';
import { adapterInputBinding, adapterObservations } from '@volter/editor-sdk/kit/adapter-observation';

const ADAPTER_REGISTRATION_ID = '__adapter__';
const installedGames = new WeakSet<Game>();

/**
 * Every root's harvested entry binding of one kind, in root order.
 *
 * A root whose registration carried no declaration has no binding at all (a
 * bare harness `registerThreeRoot`), and a root whose entry module exports
 * neither `debug` nor `systems` has no member — both are skipped, which is the
 * same set the resolver used to accumulate into an array. Both installs are
 * keyed by `rootId` internally, so order carries no meaning here.
 */
function entryBindings<K extends 'entryDebug' | 'entrySystems'>(
  game: Game,
  kind: K,
): NonNullable<ObservationBinding[K]>[] {
  const out: NonNullable<ObservationBinding[K]>[] = [];
  for (const root of game.roots) {
    const harvested = root.binding?.observation[kind];
    if (harvested) out.push(harvested as NonNullable<ObservationBinding[K]>);
  }
  return out;
}

function installObservations(
  game: Game,
  registry: DebugRegistry,
  declarations: readonly ObservationDeclaration[],
): void {
  const debug = registry.forRoot(ADAPTER_REGISTRATION_ID);
  for (const declaration of declarations) {
    if (declaration.kind === 'state') {
      debug.registerStateProvider(
        declaration.id,
        () => {
          if (!declaration.answer) {
            throw new DebugError(
              'OBSERVATION_UNANSWERED',
              `Observation "${declaration.id}" (state) is declared by this game's adapter with no answer.`,
            );
          }
          return declaration.answer(game);
        },
        { tier: 'assisted' },
      );
      continue;
    }
    debug.registerCommand(
      declaration.id,
      {
        ...(declaration.description ? { description: declaration.description } : {}),
        locus: declaration.locus ?? 'client',
      },
      (...args: unknown[]) => {
        if (!declaration.answer) {
          throw new DebugError(
            'OBSERVATION_UNANSWERED',
            `Observation "${declaration.id}" (command) is declared by this game's adapter with no answer.`,
          );
        }
        return (declaration.answer as (game: unknown, ...args: unknown[]) => unknown)(
          game,
          ...args,
        );
      },
    );
  }
}

function actionMap(binding: AdapterInputBinding, game: Game): Map<string, AdapterInputValueType> {
  const actions = binding.actions(game);
  if (!Array.isArray(actions)) {
    throw new Error('vgai.adapter.ts input.actions must return an array.');
  }
  const out = new Map<string, AdapterInputValueType>();
  for (const candidate of actions as readonly Partial<AdapterInputAction>[]) {
    if (
      typeof candidate?.name !== 'string' ||
      candidate.name.length === 0 ||
      !ADAPTER_INPUT_VALUE_TYPES.includes(candidate.valueType as AdapterInputValueType)
    ) {
      throw new Error(
        'vgai.adapter.ts input.actions returned an invalid action; each action needs a non-empty ' +
          '`name` and a supported `valueType`.',
      );
    }
    if (out.has(candidate.name)) {
      throw new Error(
        `vgai.adapter.ts input.actions returned duplicate action "${candidate.name}".`,
      );
    }
    out.set(candidate.name, candidate.valueType as AdapterInputValueType);
  }
  return out;
}

function valueMatches(type: AdapterInputValueType, value: AdapterInputValue): boolean {
  if (type === 'digital') return typeof value === 'boolean';
  if (type === 'scalar') return typeof value === 'number' && Number.isFinite(value);
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  );
}

function installInput(game: Game, registry: DebugRegistry, binding: AdapterInputBinding): void {
  if (!game.world(binding.root)) {
    throw new Error(
      `vgai.adapter.ts input.root names "${binding.root}", which is not a mounted manifest root.`,
    );
  }

  type Scheduled = { tick: number; action: string; value: AdapterInputValue };
  const scheduled: Scheduled[] = [];
  const trace: Array<{ tick: number; action: string; value: AdapterInputValue }> = [];
  let recording = false;

  const requireAction = (action: string, value: AdapterInputValue): AdapterInputValueType => {
    const type = actionMap(binding, game).get(action);
    if (!type) {
      throw new DebugError(
        'INPUT_ACTION_NOT_FOUND',
        `Adapter input has no action named "${action}".`,
        { registered: [...actionMap(binding, game).keys()] },
      );
    }
    if (!valueMatches(type, value)) {
      throw new DebugError(
        'INPUT_ACTION_VALUE_TYPE',
        `Adapter input action "${action}" expects ${type}, not ${typeof value}.`,
        { action, expected: type },
      );
    }
    return type;
  };

  const apply = (action: string, value: AdapterInputValue, tick: number): void => {
    requireAction(action, value);
    binding.set(game, action, value);
    if (recording) trace.push({ tick, action, value });
  };

  const runScheduled = (): void => {
    const tick = registry.getGameTick();
    // Preserve call order when several actuations target the same tick. A
    // backwards splice is allocation-cheap but reverses them, making
    // `set(true); set(false)` arrive as `false; true` at the app store.
    const due = scheduled.filter((item) => item.tick === tick);
    if (due.length === 0) return;
    for (let i = scheduled.length - 1; i >= 0; i--) {
      if (scheduled[i]!.tick === tick) scheduled.splice(i, 1);
    }
    for (const item of due) {
      apply(item.action, item.value, tick);
    }
  };
  game.systems.add('input', runScheduled, { name: 'adapter.input' });

  const unsupportedSource = (method: string): never => {
    throw new DebugError(
      'ADAPTER_INPUT_SOURCE_UNSUPPORTED',
      `${method} addresses an engine test source, but this game declares an app-owned action store. ` +
        'Drive it by action name instead.',
    );
  };

  const target: DebugVirtualInputTarget = {
    setVirtualAction(action, value) {
      apply(action, value, registry.getGameTick());
      return { delivered: true };
    },
    tapVirtualAction(action) {
      const tick = registry.getGameTick();
      apply(action, true, tick);
      scheduled.push({ tick: tick + 1, action, value: false });
      return { delivered: true };
    },
    clearVirtualActions() {
      scheduled.length = 0;
      binding.clear(game);
    },
    scheduleActionAtTick(tick, action, value) {
      const current = registry.getGameTick();
      if (!Number.isInteger(tick) || tick < current) {
        throw new DebugError(
          'TICK_ALREADY_PASSED',
          `Cannot schedule adapter input for tick ${tick}; current tick is ${current}.`,
          { tick, currentTick: current },
        );
      }
      // Validate now so a typo refuses at the call, not several ticks later.
      requireAction(action, value);
      scheduled.push({ tick, action, value });
    },
    startInputRecording() {
      trace.length = 0;
      recording = true;
    },
    stopInputRecording() {
      recording = false;
    },
    isInputRecording() {
      return recording;
    },
    injectAxis() {
      unsupportedSource('injectAxis');
    },
    injectVector2() {
      unsupportedSource('injectVector2');
    },
    injectPointerDelta() {
      unsupportedSource('injectPointerDelta');
    },
    injectPointerPosition() {
      unsupportedSource('injectPointerPosition');
    },
  };

  registry.setInputActionsSource(binding.root, () =>
    [...actionMap(binding, game)].map(([name, valueType]) => ({ name, valueType })),
  );
  registry.setInputTraceSource(binding.root, () => ({
    version: 1,
    seed: null,
    fixedDt: game.loop.fixedDt,
    ticks: [...trace],
  }));
  registry.setVirtualInputTarget(binding.root, target);
}

/**
 * Install the current project's boundary declarations onto a completed mount.
 *
 * The entry modules' own `debug`/`systems` exports are read off the roots'
 * BINDINGS (`binding.observation.entryDebug`/`entrySystems`) rather than
 * hand-carried here. They used to travel a second time as two arrays returned
 * by `resolveAllRootEntries` and threaded through play-mode — the same values
 * the resolver had already put on each root's declaration, so two carriers for
 * one fact, one of which had to be kept in sync by hand at every call site.
 */
export function installAdapterRuntimeBindings(game: Game): void {
  if (installedGames.has(game)) return;
  installNativeDebugBindings(game, entryBindings(game, 'entryDebug'));
  installNativeSystemsBindings(game, entryBindings(game, 'entrySystems'));
  // The engine's universal instruments (time scale, pause/frame-step,
  // collider draw, frame time) — HOST-published, so every game gets them for
  // zero lines and no in-world mount. The disposer is deliberately dropped:
  // the one resource it would end (the frame-time subscription) lives on this
  // Game, and this install runs once per Game (the WeakSet above), so the
  // set's lifetime IS the Game's.
  publishDevInstruments(game);
  const registry = getDebugRegistry(game);
  if (!registry) {
    throw new Error('Cannot install adapter runtime bindings: mounted Game has no debug registry.');
  }
  // Ingest mounts already project declarations against their browser realm
  // while assembling their own debug adapter. Native mounts publish either
  // this registry object or no debug adapter, so only those install here.
  const rootOwnsObservationProjection = game.roots.some(
    (root) =>
      root.mounted.systems?.debug !== undefined && root.mounted.systems.debug !== registry.adapter,
  );
  if (!rootOwnsObservationProjection) {
    installObservations(game, registry, adapterObservations());
  }
  const input = adapterInputBinding();
  if (input) installInput(game, registry, input);
  installedGames.add(game);
}
