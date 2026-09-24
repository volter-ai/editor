/**
 * The ordinary module surface a native game may expose to its own debugger.
 *
 * A root entry re-exports one `debug` object from the project's command module:
 *
 *   export { debug } from './commands';
 *
 * The command module imports no vgai API. Its functions are the application's
 * own functions over its own stores; the native adapter merely projects that
 * existing registry onto the session debug/input doors after the root mounts.
 * Loading through the root entry is load-bearing: the functions close over the
 * exact module graph the mounted application uses, never a separately evaluated
 * copy of its stores.
 */

import type { VgaiGameSystemAdapters } from '@volter/editor-project/adapter/ingest/game-contract';
import type {
  NativeCommandEntry,
  NativeDebugBinding,
  NativeDebugModule,
  NativeInputValue,
  NativeInputValueType,
  NativeSystemsBinding,
  NativeTable,
} from '@volter/editor-project/adapter/native-entry-surface';
import { NATIVE_INPUT_VALUE_TYPES } from '@volter/editor-project/adapter/native-entry-surface';
import {
  DebugError,
  type DebugRegistry,
  type DebugVirtualInputTarget,
  getDebugRegistry,
} from '../runtime/debug-registry';
import type { Game } from '../runtime/game';
import {
  CONTRACT_SYSTEM_SLOTS,
  type ContractSurface,
  projectContractSystemAdapters,
} from './ingest/contract-system-adapters';

export type {
  NativeCommandEntry,
  NativeDebugBinding,
  NativeDebugModule,
  NativeInputValue,
  NativeInputValueType,
  NativeSystemsBinding,
  NativeTable,
} from '@volter/editor-project/adapter/native-entry-surface';
export { NATIVE_INPUT_VALUE_TYPES } from '@volter/editor-project/adapter/native-entry-surface';

type NativeInputBinding = NonNullable<NativeDebugModule['input']>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], at: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `${at} has unknown ${unknown.length === 1 ? 'key' : 'keys'}: ${unknown.join(', ')}`,
    );
  }
}

function functionRecord(
  value: unknown,
  at: string,
): Record<string, (...args: unknown[]) => unknown> {
  if (!isRecord(value)) throw new Error(`${at} must be an object of named functions.`);
  const out: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [name, candidate] of Object.entries(value)) {
    if (!name) throw new Error(`${at} contains an empty name.`);
    if (typeof candidate !== 'function') throw new Error(`${at}.${name} must be a function.`);
    out[name] = candidate as (...args: unknown[]) => unknown;
  }
  return out;
}

function parseActions(value: unknown): Record<string, NativeInputValueType> {
  if (!isRecord(value)) {
    throw new Error('debug.input.actions must be an object mapping action names to value types.');
  }
  const actions: Record<string, NativeInputValueType> = {};
  for (const [name, valueType] of Object.entries(value)) {
    if (!name) throw new Error('debug.input.actions contains an empty action name.');
    if (!NATIVE_INPUT_VALUE_TYPES.includes(valueType as NativeInputValueType)) {
      throw new Error(
        `debug.input.actions.${name} must be one of ${NATIVE_INPUT_VALUE_TYPES.join(', ')}.`,
      );
    }
    actions[name] = valueType as NativeInputValueType;
  }
  return actions;
}

function parseInput(value: unknown): NativeInputBinding {
  if (!isRecord(value)) throw new Error('debug.input must be an object.');
  rejectUnknownKeys(value, ['actions', 'set', 'clear', 'tap', 'scheduleAtTick'], 'debug.input');
  if (typeof value['actions'] === 'function') {
    // A live table: validated per read (requireAction/the actions source), not
    // here — the whole point is that its content changes after install.
    const set = value['set'];
    const clear = value['clear'];
    if (typeof set !== 'function') throw new Error('debug.input.set must be a function.');
    if (typeof clear !== 'function') throw new Error('debug.input.clear must be a function.');
    return value as unknown as NativeInputBinding;
  }
  const set = value['set'];
  const clear = value['clear'];
  const tap = value['tap'];
  const scheduleAtTick = value['scheduleAtTick'];
  if (typeof set !== 'function') throw new Error('debug.input.set must be a function.');
  if (typeof clear !== 'function') throw new Error('debug.input.clear must be a function.');
  if (tap !== undefined && typeof tap !== 'function') {
    throw new Error('debug.input.tap must be a function when provided.');
  }
  if (scheduleAtTick !== undefined && typeof scheduleAtTick !== 'function') {
    throw new Error('debug.input.scheduleAtTick must be a function when provided.');
  }
  return {
    actions: parseActions(value['actions']),
    set: set as NativeInputBinding['set'],
    clear: clear as NativeInputBinding['clear'],
    ...(typeof tap === 'function' ? { tap: tap as NonNullable<NativeInputBinding['tap']> } : {}),
    ...(typeof scheduleAtTick === 'function'
      ? {
          scheduleAtTick: scheduleAtTick as NonNullable<NativeInputBinding['scheduleAtTick']>,
        }
      : {}),
  };
}

/** Read the single native `debug` export from an already-loaded root module. */
export function nativeDebugBindingFromEntryModule(
  rootId: string,
  entryModule: unknown,
): NativeDebugBinding | null {
  if (!isRecord(entryModule) || entryModule['debug'] === undefined) return null;
  if (!isRecord(entryModule['debug'])) {
    throw new Error(`Root "${rootId}" exports \`debug\`, but it is not an object.`);
  }
  const raw = entryModule['debug'];
  rejectUnknownKeys(
    raw,
    ['commands', 'state', 'input', 'events', 'settled'],
    `Root "${rootId}" debug export`,
  );

  // A thunk table defers to install time (see {@link NativeTable}); a plain
  // record validates here, where the error can still name the export.
  const parseTable = (value: unknown, at: string) => {
    if (value === undefined) return undefined;
    if (typeof value === 'function') return value as () => Readonly<Record<string, never>>;
    return functionRecord(value, at);
  };
  // Commands allow the `{ description?, run }` entry shape; full validation
  // happens at install (`resolveCommandTable`), where thunks resolve too.
  const parseCommands = (value: unknown, at: string) => {
    if (value === undefined) return undefined;
    if (typeof value === 'function') return value as () => Readonly<Record<string, never>>;
    if (!isRecord(value)) throw new Error(`${at} must be an object of named commands.`);
    return value as Readonly<Record<string, NativeCommandEntry>>;
  };
  const commands = parseCommands(raw['commands'], 'debug.commands');
  const state = parseTable(raw['state'], 'debug.state');
  const input = raw['input'] === undefined ? undefined : parseInput(raw['input']);
  const events = raw['events'] === undefined ? undefined : parseEvents(raw['events']);
  const settled = raw['settled'];
  if (settled !== undefined && typeof settled !== 'function') {
    throw new Error('debug.settled must be a function returning a boolean.');
  }
  if (!commands && !state && !input && !events && !settled) {
    throw new Error(`Root "${rootId}" exports an empty \`debug\` object.`);
  }
  return {
    rootId,
    debug: {
      ...(commands ? { commands } : {}),
      ...(state ? { state } : {}),
      ...(input ? { input } : {}),
      ...(events ? { events } : {}),
      ...(settled ? { settled: settled as () => boolean } : {}),
    },
  };
}

function parseEvents(value: unknown): NonNullable<NativeDebugModule['events']> {
  if (!isRecord(value) || typeof value['subscribe'] !== 'function') {
    throw new Error('debug.events must be an object with a subscribe(listener) function.');
  }
  return value as unknown as NonNullable<NativeDebugModule['events']>;
}

/** Resolve a possibly-thunk COMMAND table, validating each entry's shape. */
function resolveCommandTable(
  table: NativeTable<NativeCommandEntry> | undefined,
  at: string,
): Readonly<Record<string, NativeCommandEntry>> {
  if (table === undefined) return {};
  const raw = typeof table === 'function' ? table() : table;
  if (!isRecord(raw)) throw new Error(`${at} must be an object of named commands.`);
  for (const [name, entry] of Object.entries(raw)) {
    if (!name) throw new Error(`${at} contains an empty name.`);
    const ok =
      typeof entry === 'function' ||
      (isRecord(entry) && typeof (entry as { run?: unknown }).run === 'function');
    if (!ok) throw new Error(`${at}.${name} must be a function or { description?, run }.`);
  }
  return raw as Readonly<Record<string, NativeCommandEntry>>;
}

/** Resolve a possibly-thunk table at install time, validating the result. */
function resolveTable<T>(
  table: NativeTable<T> | undefined,
  at: string,
): Readonly<Record<string, T>> {
  if (table === undefined) return {};
  if (typeof table === 'function') {
    return functionRecord(table(), at) as Readonly<Record<string, T>>;
  }
  return table;
}

function valueMatches(type: NativeInputValueType, value: NativeInputValue): boolean {
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

function installInput(
  game: Game,
  registry: DebugRegistry,
  binding: NativeDebugBinding,
  input: NativeInputBinding,
): void {
  const trace: Array<{ tick: number; action: string; value: NativeInputValue }> = [];
  let recording = false;

  // LIVE read on every use — see the `actions` field's own comment.
  const liveActions = (): Readonly<Record<string, NativeInputValueType>> =>
    typeof input.actions === 'function' ? input.actions() : input.actions;

  const requireAction = (action: string, value: NativeInputValue): NativeInputValueType => {
    const actions = liveActions();
    const type = actions[action];
    if (!type) {
      throw new DebugError(
        'INPUT_ACTION_NOT_FOUND',
        `Native input has no action named "${action}".`,
        {
          registered: Object.keys(actions),
        },
      );
    }
    if (!valueMatches(type, value)) {
      throw new DebugError(
        'INPUT_ACTION_VALUE_TYPE',
        `Native input action "${action}" expects ${type}, not ${typeof value}.`,
        { action, expected: type },
      );
    }
    return type;
  };

  const apply = (action: string, value: NativeInputValue, tick: number): void => {
    requireAction(action, value);
    input.set(action, value);
    if (recording) trace.push({ tick, action, value });
  };

  const unsupportedSource = (method: string): never => {
    throw new DebugError(
      'NATIVE_INPUT_SOURCE_UNSUPPORTED',
      `${method} addresses an engine test source, but this game exposes an app-owned action store. Drive it by action name instead.`,
    );
  };
  const target: DebugVirtualInputTarget = {
    setVirtualAction(action, value) {
      apply(action, value, registry.getGameTick());
      return { delivered: true };
    },
    tapVirtualAction(action) {
      if (!input.tap) {
        throw new DebugError(
          'NATIVE_INPUT_TAP_UNSUPPORTED',
          `Native input for root "${binding.rootId}" does not export tap(); use setVirtualAction through the app-owned store.`,
        );
      }
      requireAction(action, true);
      input.tap(action);
      return { delivered: true };
    },
    clearVirtualActions() {
      input.clear();
    },
    scheduleActionAtTick(tick, action, value) {
      const currentTick = registry.getGameTick();
      if (!Number.isInteger(tick) || tick < currentTick) {
        throw new DebugError(
          'TICK_ALREADY_PASSED',
          `Cannot schedule native input for tick ${tick}; current tick is ${currentTick}.`,
          { tick, currentTick },
        );
      }
      requireAction(action, value);
      if (!input.scheduleAtTick) {
        throw new DebugError(
          'NATIVE_INPUT_SCHEDULE_UNSUPPORTED',
          `Native input for root "${binding.rootId}" does not export scheduleAtTick(); the adapter will not create a host scheduler for it.`,
        );
      }
      input.scheduleAtTick(tick, action, value);
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

  registry.setInputActionsSource(binding.rootId, () =>
    Object.entries(liveActions()).map(([name, valueType]) => ({ name, valueType })),
  );
  registry.setInputTraceSource(binding.rootId, () => ({
    version: 1,
    seed: null,
    fixedDt: game.loop.fixedDt,
    ticks: [...trace],
  }));
  registry.setVirtualInputTarget(binding.rootId, target);
}

/** Project native registries onto the existing session debugger after mount. */
export function installNativeDebugBindings(
  game: Game,
  bindings: readonly NativeDebugBinding[],
): void {
  if (bindings.length === 0) return;
  const registry = getDebugRegistry(game);
  if (!registry)
    throw new Error('Cannot install native debug bindings: mounted Game has no debug registry.');
  for (const binding of bindings) {
    if (!game.world(binding.rootId)) {
      throw new Error(`Native debug binding names unmounted root "${binding.rootId}".`);
    }
    const root = registry.forRoot(binding.rootId);
    const state = resolveTable(binding.debug.state, `Root "${binding.rootId}" debug.state`);
    for (const [name, read] of Object.entries(state)) {
      root.registerStateProvider(name, read, { tier: 'assisted' });
    }
    const commands = resolveCommandTable(
      binding.debug.commands,
      `Root "${binding.rootId}" debug.commands`,
    );
    for (const [name, entry] of Object.entries(commands)) {
      const run = typeof entry === 'function' ? entry : entry.run;
      const description = typeof entry === 'function' ? undefined : entry.description;
      root.registerCommand(
        name,
        { locus: 'client', ...(description === undefined ? {} : { description }) },
        run,
      );
    }
    if (binding.debug.input) installInput(game, registry, binding, binding.debug.input);
    // The app's emitter → the session's tick-stamped event log. The
    // subscription's disposer is deliberately dropped: it lives exactly as
    // long as this Game's registry does.
    binding.debug.events?.subscribe((event, detail) => root.emit(event, detail));
    // The app's own between-worlds truth → the session's tick gate
    // (`runTicksWhenSettled`). Same lifetime rule as the event subscription.
    if (binding.debug.settled) registry.registerWorldSettledProbe(binding.debug.settled);
  }
}

// ---------------------------------------------------------------------------
// The native `systems` export — the first-party door onto `SystemAdapters`
// ---------------------------------------------------------------------------
//
// The sibling of `debug` on the SAME module surface: a root entry re-exports
// one `systems` object beside it —
//
//   export { debug, systems } from './commands';
//
// — whose slots are the ONE declarable carrier both realms share,
// `VgaiGameSystemAdapters` (`ingest/game-contract.ts`; the native engine is
// the premade 100% implementation of that contract). Validation is the SAME
// projection the ingest realm uses (`ingest/contract-system-adapters.ts`), so
// there is one shape law, not two. This door is what retires
// `ctx.registerSystemAdapter` from component code (ARCHITECTURE-CORE §System
// adapters: "a project's `vgai.adapter.ts` binds app-owned systems through
// declared native exports … Components never call `registerSystemAdapter`").
//
// Native-realm difference from ingest: a malformed slot THROWS (this is our
// own code failing its own contract — fail fast), where the ingest projection
// files a verdict for the coverage report. A `{ present: false, evidence }`
// slot is accepted as the positive absence it is and binds nothing.

/**
 * Read the single native `systems` export from an already-loaded root module.
 * `surface` is the root's own mount surface when the caller knows it — it
 * feeds the physics keying check (`PHYSICS_KEYING_BY_SURFACE`).
 */
export function nativeSystemsBindingFromEntryModule(
  rootId: string,
  entryModule: unknown,
  surface?: ContractSurface | undefined,
): NativeSystemsBinding | null {
  if (!isRecord(entryModule) || entryModule['systems'] === undefined) return null;
  const raw = entryModule['systems'];
  if (!isRecord(raw)) {
    throw new Error(`Root "${rootId}" exports \`systems\`, but it is not an object.`);
  }
  rejectUnknownKeys(raw, CONTRACT_SYSTEM_SLOTS, `Root "${rootId}" systems export`);
  const projection = projectContractSystemAdapters(
    { systemAdapters: raw as VgaiGameSystemAdapters },
    surface,
  );
  if (projection.malformed.length > 0) {
    throw new Error(
      `Root "${rootId}" systems export is malformed: ` +
        projection.malformed.map((slot) => `${slot.slot} — ${slot.reason}`).join('; '),
    );
  }
  if (Object.keys(projection.bound).length === 0 && projection.empty.length === 0) {
    throw new Error(`Root "${rootId}" exports an empty \`systems\` object.`);
  }
  return { rootId, slots: projection.bound, absent: projection.empty };
}

/**
 * Install every declared binding onto the mounted Game's game-scoped slot
 * table (`Game.installDeclaredSystemAdapters`), where the ordinary
 * `game.systemAdapters` merge picks them up ahead of any lingering component
 * registration for the same root.
 *
 * A root's ABSENCES travel the same call and install NOTHING — they are
 * recorded, never bound, because the whole point of `absent()` is that no
 * adapter exists to bind (see its comment: a marker, never a stub). They are
 * recorded HERE rather than left on the binding alone so the answer is
 * game-scoped, matching the registry every editor panel already reads: a
 * `SystemAdapters` slot is filled by whichever root builds it, so "does this
 * GAME have physics" cannot be answered one root at a time.
 *
 * A root that declares only absences therefore still calls through — skipping
 * it on an empty `slots` map is what would drop exactly the games whose whole
 * declaration is "I have none of these".
 */
export function installNativeSystemsBindings(
  game: Game,
  bindings: readonly NativeSystemsBinding[],
): void {
  if (bindings.length === 0) return;
  const install = game.installDeclaredSystemAdapters;
  if (!install) {
    throw new Error(
      'Cannot install native systems bindings: this Game does not implement ' +
        'installDeclaredSystemAdapters.',
    );
  }
  for (const binding of bindings) {
    if (Object.keys(binding.slots).length === 0 && binding.absent.length === 0) continue;
    install.call(
      game,
      binding.rootId,
      binding.slots,
      binding.absent.map((slot) => ({
        rootId: binding.rootId,
        slot: slot.slot,
        reason: slot.evidence,
      })),
    );
  }
}
