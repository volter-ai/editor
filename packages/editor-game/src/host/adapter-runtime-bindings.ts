/**
 * Installs the loaded `vgai.adapter.ts` runtime bindings onto one mounted
 * Game. Game modules stay native: adapter closures close over app-owned stores
 * and functions, while this host-side file projects them onto the existing
 * session command/state/input doors.
 */

import {
  installNativeDebugBindings,
  installNativeSystemsBindings,
} from '../runtime/adapter/native-debug-module';
import { publishDevInstruments } from '../runtime/dev/instruments';
import {
  DebugError,
  type DebugRegistry,
  type DebugVirtualInputTarget,
  getDebugRegistry,
} from '../runtime/debug-registry';
import type { Game } from '../runtime/game';
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
import { observedGameAudio } from '../services/game-audio';
import { observedGameNetwork } from '../services/game-network';
import { observedRapierPhysics, rapierContextFor } from '../services/game-physics';
import { projectDependencyNames, projectVerbFacts } from '../coverage/live-project-verbs';
import type * as THREE from 'three';
import type { NativeSystemsBinding } from '@volter/editor-project/adapter/native-entry-surface';

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

/**
 * A game that says nothing about its audio is heard through the editor's observer of the
 * page's Web Audio (`services/game-audio.ts`), on every root, so each world's pause gate and the
 * editor's mute reach the one page-wide adapter. A game whose roots declare audio, or its
 * absence, has spoken for it and gets no observer beside its own.
 */
function withObservedAudio(game: Game, bindings: NativeSystemsBinding[]): NativeSystemsBinding[] {
  if (bindings.some((binding) => binding.slots.audio || binding.absent.some((slot) => slot.slot === 'audio'))) {
    return bindings;
  }
  return game.roots.map((root) => {
    const own = bindings.find((binding) => binding.rootId === root.id);
    return { rootId: root.id, slots: { ...own?.slots, audio: observedGameAudio }, absent: own?.absent ?? [] };
  });
}

/** The libraries whose presence says a project joins Colyseus rooms. */
const COLYSEUS_CLIENT_LIBRARIES = ['@colyseus/sdk', 'colyseus.js'];

/**
 * A game that says nothing about its networking, and ships a Colyseus client, is inspected
 * through the editor's observer of the page's room sockets (`services/game-network.ts`), on its
 * first root: the page has one set of sockets, and the inspector reads one adapter. A game that
 * declares networking, or its absence, has spoken for it; a project known to ship no Colyseus
 * client gets nothing that pretends.
 */
function withObservedNetworking(game: Game, bindings: NativeSystemsBinding[]): NativeSystemsBinding[] {
  const declared = bindings.some(
    (binding) => binding.slots.networking || binding.absent.some((slot) => slot.slot === 'networking'),
  );
  // While the project's dependency list is still loading the answer is unknown, not no (Play
  // starts that read and mounts in the same breath), so the observer is attached; it answers
  // `disconnected` until the game joins a room.
  projectVerbFacts();
  const dependencies = projectDependencyNames();
  const shipsClient = dependencies === null || dependencies.some((name) => COLYSEUS_CLIENT_LIBRARIES.includes(name));
  const first = game.roots[0];
  if (declared || !shipsClient || !first) return bindings;
  const index = bindings.findIndex((binding) => binding.rootId === first.id);
  const own = index >= 0 ? bindings[index] : undefined;
  const binding: NativeSystemsBinding = {
    rootId: first.id,
    slots: { ...own?.slots, networking: observedGameNetwork },
    absent: own?.absent ?? [],
  };
  const out = [...bindings];
  if (index >= 0) out[index] = binding;
  else out.push(binding);
  return out;
}

/** The libraries whose presence says a project simulates Rapier physics. */
const RAPIER_LIBRARIES = ['@react-three/rapier', '@dimforge/rapier3d-compat'];

/**
 * A three world that declares no physics, and whose own mount carries none, is edited through
 * the editor's observer of its `@react-three/rapier` world (`services/game-physics.ts`) when the
 * world has one: a `<Physics>` already mounted, or a project that ships Rapier (its provider
 * mounts only once the WASM loads). A world with neither gets nothing that pretends. While the
 * project's dependency list is still loading (`projectVerbFacts` starts that read) the answer is
 * unknown, not no, so the observer is attached; it answers `unresolved` until a world mounts.
 */
export function withObservedPhysics(game: Game, bindings: NativeSystemsBinding[]): NativeSystemsBinding[] {
  projectVerbFacts();
  const dependencies = projectDependencyNames();
  const shipsRapier = dependencies === null || dependencies.some((name) => RAPIER_LIBRARIES.includes(name));
  const out = [...bindings];
  for (const root of game.roots) {
    if (root.mounted.kind !== 'three' || root.mounted.systems?.physics) continue;
    const index = out.findIndex((binding) => binding.rootId === root.id);
    const own = index >= 0 ? out[index] : undefined;
    if (own && (own.slots.physics || own.absent.some((slot) => slot.slot === 'physics'))) continue;
    const scene = root.mounted.scene as THREE.Object3D;
    if (!shipsRapier && !rapierContextFor(scene)) continue;
    const physics = observedRapierPhysics(scene);
    const binding: NativeSystemsBinding = { rootId: root.id, slots: { ...own?.slots, physics }, absent: own?.absent ?? [] };
    if (index >= 0) out[index] = binding;
    else out.push(binding);
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
  installNativeSystemsBindings(
    game,
    withObservedNetworking(game, withObservedPhysics(game, withObservedAudio(game, entryBindings(game, 'entrySystems')))),
  );
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
