/**
 * The game-scoped debug/synthetic-player registry. ONE registry per `Game` root —
 * every world's `ctx.debug` (see {@link DebugCtxSurface} below) feeds the
 * SAME registry via {@link DebugRegistry.forRoot}, so a name a game registers is
 * visible (and name-collision-checked) across every world, not just the one that
 * registered it. `createGame` (`runtime/game.ts`) constructs the registry
 * and files it in a non-enumerable game-scoped slot;
 * later consumers (editor panels, the session wire) reach it via {@link getDebugRegistry}
 * rather than threading it through every call site.
 *
 * Provenance note: a registration's "world" is the MOUNT's adapter id (the
 * id a project's root adapter already carries) rather than the
 * `RootInstance.id` `registerThreeRoot`
 * assigns — that id isn't known until AFTER `mount()` resolves (`create-
 * runtime.ts` calls `registerThreeRoot` with it only once `mount()` returns),
 * which is after every `setup()`-time registration has already run. For the
 * single-world case (nearly every project today) this is simply `'setup-three'`;
 * a multi-world manifest names each world's adapter to match its declared id
 * by convention, so collision messages stay meaningful in practice.
 */

import type {
  DebugAdapter,
  DebugCommandInfo,
  TickStampedEvent,
} from '@volter/editor-project/adapter/system-adapter';
import { z } from 'zod';
import { createGameScopedSlot } from '../core/game-scoped-slot';
import type { GameLoopLiveness } from '../core/types';
import type { Game } from './game';

/**
 * The minimal structural shape `ctx.debug.attachRoom` needs from a joined
 * Colyseus room: just enough to send the reserved `__vgai:debugCommand`
 * message and listen for its `__vgai:debugCommandResult` reply. Structural,
 * not a Colyseus type import — the same seam-boundary style every other
 * `DebugCtxSurface` member uses (no wrapper around Colyseus itself, D2).
 * `onMessage`'s return type is `unknown` because Colyseus's own return shape
 * (void in some client versions, an unsubscribe function in others) isn't
 * load-bearing here: the registry calls it defensively (invokes it on detach
 * only if it's actually a function).
 */
export interface DebugRoomHandle {
  send(type: string, message?: unknown): void;
  onMessage(type: string, cb: (message: unknown) => void): unknown;
}

/**
 * Infers a `registerCommand`
 * handler's parameter tuple from its declared Zod `args` tuple (dry-run
 * finding, ledger — "`registerCommand` fn typing forces `unknown[]` casts"):
 * a real `z.ZodTuple` infers its element types (`z.tuple([z.number(),
 * z.string()])` → `(n: number, s: string) => ...`), while omitting `args`
 * (the generic's `undefined` default) resolves to the original permissive
 * `(...args: unknown[]) => ...` shape every command had before this generic
 * existed. That permissive fallback is deliberate, not just a placeholder —
 * it keeps every existing no-schema registration (including ones whose
 * handler reads positional args the runtime never validates, since
 * `invoke()` only parses `args` against a schema when one is declared)
 * compiling byte-for-byte unchanged.
 */
export type DebugCommandArgs<T extends z.ZodTuple | undefined = undefined> = T extends z.ZodTuple
  ? z.infer<T>
  : unknown[];

/**
 * The authoring half of the debug/synthetic-player seam — the read/actuate half is
 * `SystemAdapters.DebugAdapter` (`adapter/system-adapter.ts`). Callable from any
 * `init` (one file per new provider/command). Every registration feeds the ONE
 * game-scoped registry (`runtime/debug-registry.ts`) — never a per-world accumulator.
 */
export interface DebugCtxSurface {
  /** Register (or replace) a named, JSON-serializable state read. Duplicate
   *  names from the SAME world replace + warn once; the SAME name from a
   *  DIFFERENT world throws (`DebugError` code `DEBUG_NAME_COLLISION`). */
  registerStateProvider(
    name: string,
    fn: () => unknown,
    opts?: { tier?: 'observable' | 'assisted' },
  ): void;
  /** Register (or replace) an invokable command. `locus` is REQUIRED once the
   *  project declares a Colyseus room (`DebugRegistry.setRoomDeclared`) — a
   *  fixture must say whether it mutates authoritative (server) or predicted
   *  (client) state.
   *
   *  Generic over the declared `args` Zod tuple ({@link DebugCommandArgs}) so
   *  `fn`'s parameters INFER from it: `registerCommand('setHp', { args:
   *  z.tuple([z.number()]) }, (hp) => ...)` types `hp` as `number` with no
   *  cast. Leaving `args` off keeps `fn` typed `(...args: unknown[]) => ...`,
   *  same as before this generic existed. */
  registerCommand<T extends z.ZodTuple | undefined = undefined>(
    name: string,
    spec: { description?: string; args?: T; locus?: 'client' | 'server' },
    fn: (...args: DebugCommandArgs<T>) => unknown | Promise<unknown>,
  ): void;
  /** Push a tick-stamped event onto the debug event ring (spec §3.3) — the
   *  engine stamps `tick`/`simT` at emission, not at read time. */
  emit(event: string, detail?: unknown): void;
  /**
   * Task 2.2 — server-locus command routing (client leg). Call once your
   * game code has joined its Colyseus room, so `locus: 'server'` commands
   * have somewhere to send `__vgai:debugCommand`. Returns a detach function
   * (call on room leave/dispose) — game-scoped, last-attached room wins.
   */
  attachRoom(room: DebugRoomHandle): () => void;
}

/** Engine-local error for the debug seam — mirrors the `code` + `data` shape
 *  `packages/vgai-sdk/src/errors.ts` uses (no import: the engine does not
 *  depend on `@vgai/sdk`). `code` is always machine-readable; nothing reading
 *  this error may key off `message` prose. */
export class DebugError extends Error {
  readonly code: string;
  readonly data?: Record<string, unknown> | undefined;

  constructor(code: string, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'DebugError';
    this.code = code;
    this.data = data;
  }
}

const REGISTRATION_HINT =
  'ctx.debug.registerStateProvider(name, fn) — see the template example component';

/** A thrown value flattened to JSON-SAFE fields. Every caller of a debug
 *  command is on the far side of a JSON boundary — the editor session relay
 *  (`POST /__editor/command`) and `page.evaluate` both serialize the error's
 *  `data` bag — and an `Error` stringifies to `{}` there, so a command's own
 *  refusal text ("no such waypoint") vanished and the developer at
 *  `vgai eval` saw only `debug: command "x" threw`. The text has to travel as
 *  plain strings, and in the `message` above all: that is the one field every
 *  client (`SessionError`, the CLI's own error print) actually surfaces. */
function describeCause(cause: unknown): {
  causeName: string;
  causeMessage: string;
  causeStack?: string;
} {
  if (cause instanceof Error) {
    const described = { causeName: cause.name, causeMessage: cause.message };
    return cause.stack === undefined ? described : { ...described, causeStack: cause.stack };
  }
  return { causeName: typeof cause, causeMessage: String(cause) };
}

/** Task 2.2 — how long `invoke()` waits for a `locus: 'server'` command's
 *  `__vgai:debugCommandResult` reply before failing loudly. */
const SERVER_COMMAND_TIMEOUT_MS = 10_000;

/** The virtual-input surface the debug bridge (`runtime/debug-bridge.ts`)
 *  actuates through — the SAME three methods `InputManager` exposes
 *  (`setVirtualAction`/`tapVirtualAction`/`clearVirtualActions`, Task 1.4),
 *  typed narrowly here so this module never imports `InputManager` itself.
 *  Wired once by the hosting adapter (`editor-game/src/host/roots/r3f-root.tsx`, at the
 *  same seed spot as `setInputActionsSource`) — absent until then. */
export interface DebugVirtualInputTarget {
  setVirtualAction(
    action: string,
    value: boolean | number | { x: number; y: number },
  ): { delivered: boolean; reason?: string };
  tapVirtualAction(action: string): { delivered: boolean; reason?: string };
  clearVirtualActions(): void;
  /** D15/T-D15.5 — schedule a virtual actuation for a specific future (or
   *  current) tick, applied at the start of that tick's input phase (composes
   *  with `runTicks`). */
  scheduleActionAtTick(
    tick: number,
    action: string,
    value: boolean | number | { x: number; y: number },
  ): void;
  startInputRecording(): void;
  stopInputRecording(): void;
  isInputRecording(): boolean;
  /** The four legacy named-test-source injectors (`InputManager`'s own),
   *  included here so `inject-input`'s non-`action` kinds route through the
   *  SAME per-world resolution as everything else on this interface (D15
   *  review objection: routing must never depend on registration order). */
  injectAxis(sourceId: string, value: number): void;
  injectVector2(sourceId: string, value: { x: number; y: number }): void;
  injectPointerDelta(sourceId: string, delta: { x: number; y: number }): void;
  injectPointerPosition(sourceId: string, value: { x: number; y: number }): void;
}

/**
 * D15/T-D15.5 — the `input.trace` builtin provider's shape.
 * `seed`/`fixedDt` are
 * replay-critical metadata a future SP5 consumer needs BESIDE the raw
 * per-tick action deltas (`ticks`, straight off `InputManager.getInputTrace()`)
 * to know what to replay the trace AGAINST — recording deltas alone is not
 * enough to reproduce a run. Both are `null` only when no wiring/no
 * `ctx.random`/no `Game` exists behind this world (never a fabricated 0).
 */
export interface InputTraceSnapshot {
  version: 1;
  seed: number | null;
  fixedDt: number | null;
  ticks: unknown[];
}

/** `Game.runTicks`'s options — see `GameInternal.runTicks`'s doc comment
 *  (`runtime/game.ts`, D15/T-D15.3-.4) for full semantics. Named here (not
 *  re-declared per-caller) so the bridge (`runtime/debug-bridge.ts`), the
 *  editor relay (`command-listener.ts`'s `run-ticks` case), and
 *  `play.runTicks` (`@vgai/sdk`) all reference the SAME type. */
export interface RunTicksOptions {
  /** `'last'` (default) — skip `preRender`/`render` for every tick except
   *  the final one. `'all'` — render every tick. `'none'` — never render,
   *  not even the last tick. */
  render?: 'last' | 'all' | 'none';
}

/** The run-ticks actuation surface a live `Game` wires in (see
 *  {@link DebugRegistry.setRunTicksTarget}) — just `GameInternal.runTicks`'s
 *  signature, typed narrowly here so this module never imports `./game`
 *  as a value (only `Game` as a type, already the case above). */
export interface RunTicksTarget {
  runTicks(n: number, opts?: RunTicksOptions): void;
}

interface PendingServerCommand {
  resolve(result: unknown): void;
  reject(err: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

interface ProviderEntry {
  fn: () => unknown;
  tier: 'observable' | 'assisted';
  worldId: string;
  builtin: boolean;
}

interface CommandEntry {
  description?: string | undefined;
  argsSchema?: z.ZodTuple | undefined;
  locus?: 'client' | 'server' | undefined;
  fn: (...args: unknown[]) => unknown | Promise<unknown>;
  worldId: string;
}

/** What {@link createDebugRegistry} returns — the adapter half (`DebugAdapter`,
 *  for `SystemAdapters.debug`) plus the registration/lifecycle surface the
 *  hosting adapter (`editor-game/src/host/roots/r3f-root.tsx`) and `createGame` drive. */
export interface DebugRegistry {
  /** The `SystemAdapters.debug` implementer — one shared instance, seeded
   *  onto every world's adapter bag. */
  readonly adapter: DebugAdapter;
  /** Build the `ctx.debug` surface for one world/mount — registrations made
   *  through it carry `worldId` as their provenance for collision messages. */
  forRoot(worldId: string): DebugCtxSurface;
  /**
   * Remove non-built-in registrations (Defect 2 fix — this used to be
   * unconditionally global, which made a per-mount call like `hotReload`'s
   * silently wipe every OTHER live world's registrations).
   *
   * - `strip(worldId)` — scoped: removes only providers/commands whose
   *   provenance is exactly `worldId` (and clears their warn-once state), so
   *   a hot-reloading world re-seeds itself without disturbing anyone else.
   * - `strip()` (no id) — the original global behavior: every non-built-in
   *   registration is removed. Intended for "the
   *   whole game is going away" (`disposeGame`) or test teardown, not a
   *   single mount's warm restart.
   *
   * Either way, the very next registration of a name just removed is silent —
   * there is nothing left to collide with or warn about.
   */
  strip(worldId?: string): void;
  /** Manifest wiring lands in a later wave; until then, call this directly
   *  (default `false`) to exercise the locus-required throw. */
  setRoomDeclared(declared: boolean): void;
  /** Wire the built-in `input.actions` provider to a live `InputManager`
   *  (T1.2), scoped to `worldId` — lazy, since a world's InputManager doesn't
   *  exist yet when the registry is constructed (`createGame`, before any
   *  world mounts). Before ANY source is set, `input.actions` reads `[]`;
   *  once one or more roots have registered, the built-in `input.actions`
   *  provider reads the DEFAULT world's (see {@link resolveInputRootId}) —
   *  same resolution every other per-world seam on this interface uses. */
  setInputActionsSource(worldId: string, fn: () => { name: string; valueType: string }[]): void;
  /** D15/T-D15.5 — wire the built-in `input.trace` provider to a live
   *  `InputManager.getInputTrace`, scoped to `worldId` — same lazy-supplier
   *  shape/seed spot as {@link setInputActionsSource}, same default-world
   *  resolution for the read. Before a source is set, `input.trace` reads
   *  `{version: 1, seed: null, fixedDt: null, ticks: []}`. `seed`/`fixedDt`
   *  are the two replay-critical metadata fields the design doc's format
   *  sketch (§2.c) calls for beside the raw per-tick deltas — the wiring
   *  adapter (`editor-game/src/host/roots/r3f-root.tsx`) assembles them from
   *  `getSeededRandom(game)?.seed`/`host.game?.loop.fixedDt` alongside
   *  `InputManager.getInputTrace()`'s own `{version, ticks}`. An `engine`
   *  (package version) stamp remains a KNOWN GAP — no build-time version
   *  constant is threaded into the runtime bundle today; a future track
   *  adding one should extend this shape, not invent a second trace format. */
  setInputTraceSource(worldId: string, fn: () => InputTraceSnapshot): void;
  /**
   * Wire the debug bridge's actuation methods (`runtime/debug-bridge.ts`) to
   * a live `InputManager` (Task 2.1), scoped to `worldId` — same lazy-
   * supplier shape as {@link setInputActionsSource}, wired at the same seed
   * spot (once per world mount, not once per Game).
   *
   * Fix for a closed-PR review objection: this used to be a SINGLE slot
   * (last-writer-wins across every world that mounted), which could route
   * the debug bridge (`window.__vgai.input.*`, which read this directly) and
   * the editor relay (which reached the default world's `InputManager`
   * through a DIFFERENT accessor, `Game.input`) to two DIFFERENT roots in a
   * multi-world project — the bridge always got whichever world mounted
   * LAST, the relay always got the FIRST/default world. Now every world's
   * target is kept, keyed by `worldId`, and {@link getVirtualInputTarget}
   * resolves ONE of them via {@link resolveInputRootId} — the SAME
   * resolution the bridge and the relay both call through, so they can never
   * disagree again. An explicit `worldId` reaches that world specifically. */
  setVirtualInputTarget(worldId: string, target: DebugVirtualInputTarget): void;
  /**
   * Resolve and return a virtual-input target: `worldId` given and
   * registered → that world's; omitted → the DEFAULT world's (per
   * {@link resolveInputRootId} — the manifest's first/default world when a
   * `Game` is behind this registry, else the single registered world, else
   * whichever registered first), consistently, for every caller (the debug
   * bridge and the editor relay both call this — see this interface's own
   * doc comment above). `null` when nothing is registered for the resolved
   * id at all (callers throw a structured `DEBUG_INPUT_UNAVAILABLE` in that
   * case rather than silently no-op-ing). Throws `DebugError`
   * (`DEBUG_INPUT_WORLD_NOT_FOUND`) for an EXPLICIT `worldId` that was never
   * registered — a caller mistake, distinct from "nothing mounted yet".
   */
  getVirtualInputTarget(worldId?: string): DebugVirtualInputTarget | null;
  /**
   * D15/T-D15.4: wire `Game.runTicks` (`runtime/game.ts`) as the run-ticks
   * actuation target — called ONCE by `createGame`, immediately (unlike
   * {@link setVirtualInputTarget}, which waits for a per-world mount, a
   * `Game`'s own `runTicks` exists the instant the Game shell does). The
   * SAME target backs `runtime/debug-bridge.ts`'s `window.__vgai.runTicks`
   * (door a) and the editor relay's `run-ticks` case → `play.runTicks`
   * (door b) — one implementation, byte-identical semantics across doors
   * (D17).
   */
  setRunTicksTarget(target: RunTicksTarget): void;
  /** The target {@link setRunTicksTarget} last set, or `null` before any
   *  `Game` has wired one (a bare `createDebugRegistry()` test stand-in with
   *  no `createGame` behind it). Consumers throw a structured "unavailable"
   *  error in that case rather than silently no-op-ing — see
   *  `debug-bridge.ts`'s `runTicks` method. */
  getRunTicksTarget(): RunTicksTarget | null;
  /**
   * Register a WORLD-SETTLED probe: `false` while this game is intentionally
   * between worlds — a scene remount in flight (`reload_current_scene`'s
   * React remount commits asynchronously). The game declares it through the
   * `settled` key of its `debug` entry export (`native-debug-module.ts`);
   * session tick drivers ({@link runTicksWhenSettled} behind BOTH run-ticks
   * doors) wait for every probe to answer `true` before each tick, so WHICH
   * tick first runs a freshly remounted scene is a function of the sim, not
   * of wall timing between driver calls — measured before this seam: the
   * same drive script produced 7 or 8 post-respawn walked ticks depending on
   * how long the driver idled between ticks. Returns the deregistration.
   */
  registerWorldSettledProbe(probe: () => boolean): () => void;
  /** `true` when every registered probe answers `true` (and vacuously with
   *  none registered). A probe that THROWS counts as settled=false — a
   *  broken probe must stall the driver loudly (its bounded wait names the
   *  timeout), never silently un-gate it. */
  worldSettled(): boolean;
  /** D15/T-D15.3/.5 — the CURRENT shared game tick (the same counter the
   *  built-in `time` provider's `tick` field reads), for a per-world
   *  `InputManager.poll(tick)` call to key its `scheduleActionAtTick`
   *  numbering off — see `editor-game/src/host/roots/r3f-root.tsx`'s `systems.add('input',
   *  ...)` wiring. `0` for a bare `createDebugRegistry()` test stand-in with
   *  no real `Game`/tick counter behind it (matching `getTick`'s own
   *  constructor-supplied default in that case). */
  getGameTick(): number;
}

function warnOnce(
  warned: Set<string>,
  name: string,
  kind: 'provider' | 'command',
  worldId: string,
): void {
  if (warned.has(name)) return;
  warned.add(name);
  // biome-ignore lint/suspicious/noConsole: structured, greppable — the debug seam's own duplicate-registration signal (spec §3.1)
  console.warn(`[debug] ${kind} "${name}" re-registered (world "${worldId}")`);
}

/**
 * Construct a fresh game-scoped debug registry. `getTick`/`getSimT` are
 * suppliers (not values) so the built-in `time` provider always reads the
 * CURRENT counters — `createGame` passes closures over its own mutable
 * `tick`/`simT`, incremented in `runFrame`'s tail (T1.2). `getDefaultRootId`
 * (D15/T-D15.5, optional) resolves the manifest's first/default world id —
 * `createGame` passes `() => (roots.length ? requireDefaultRoot().id :
 * null)`; a bare `createDebugRegistry()` test stand-in with no `Game` behind
 * it omits it (per-world resolution then falls back to "the single
 * registered world" or "whichever registered first" — see
 * `resolveInputRootId`). `getLoopLiveness` (issue #175, optional) supplies
 * the REAL `GameLoop.liveness` — `createGame` passes `() => opts.loop.
 * liveness`; a bare `createDebugRegistry()` test stand-in with no loop
 * behind it omits it, and the built-in `time` provider reports `null`
 * rather than fabricating `'running'` (this module must never claim health
 * it cannot observe, same rule the loop's own liveness getter documents).
 */
export function createDebugRegistry(opts: {
  getTick(): number;
  getSimT(): number;
  /** The host loop's configured simulation step, when a real Game owns this registry. */
  getFixedDt?(): number;
  getDefaultRootId?(): string | null;
  getLoopLiveness?(): GameLoopLiveness;
}): DebugRegistry {
  const providers = new Map<string, ProviderEntry>();
  const commands = new Map<string, CommandEntry>();
  const warnedProviders = new Set<string>();
  const warnedCommands = new Set<string>();
  const ring: TickStampedEvent[] = [];
  const RING_CAP = 500;
  // Run-4 friction #5 — monotonic, registry-lifetime counter backing
  // `TickStampedEvent.seq`. Never reset, never shared by two events (unlike
  // `tick`, which a debug-command emission and a fenced consumer's snapshot
  // can legitimately collide on — see that field's doc comment in
  // `adapter/system-adapter.ts`).
  let seqCounter = 0;

  let roomDeclared = false;
  // D15/T-D15.5 — per-world maps (Map preserves insertion order, which
  // `resolveInputRootId`'s "whichever registered first" fallback relies on
  // when no `getDefaultRootId` is available to disambiguate).
  const inputActionsSources = new Map<string, () => { name: string; valueType: string }[]>();
  const inputTraceSources = new Map<string, () => InputTraceSnapshot>();
  const virtualInputTargets = new Map<string, DebugVirtualInputTarget>();
  let runTicksTarget: RunTicksTarget | null = null;
  const worldSettledProbes = new Set<() => boolean>();
  let attachedRoom: DebugRoomHandle | null = null;
  const pendingServerCommands = new Map<string, PendingServerCommand>();
  let requestCounter = 0;

  /**
   * The ONE resolution function every per-world input seam shares (D15
   * review objection: the debug bridge and the editor relay must never be
   * able to disagree about which world an unqualified actuation targets).
   *
   * - `explicit` given: must be a registered world id, else throws
   *   `DEBUG_INPUT_WORLD_NOT_FOUND` (a caller mistake — distinct from
   *   "nothing mounted yet", which returns `null` below instead of throwing).
   * - `explicit` omitted: the manifest's first/default world id
   *   (`opts.getDefaultRootId()`) iff that world has actually registered —
   *   else (no `Game`/no default resolvable, or the default world never
   *   wired one — e.g. a foreign/opaque mount) the single registered world,
   *   or, with more than one and no resolvable default, whichever registered
   *   FIRST (`Map` insertion order) — the closest analogue to this seam's
   *   pre-D15.5 single-slot behavior, but now a stable, principled choice
   *   instead of "whichever mounted last".
   * - Nothing registered at all: `null`.
   */
  function resolveInputRootId(explicit?: string): string | null {
    if (explicit !== undefined) {
      if (!virtualInputTargets.has(explicit)) {
        throw new DebugError(
          'DEBUG_INPUT_WORLD_NOT_FOUND',
          `debug: no InputManager wired for world "${explicit}" — registered: ` +
            (virtualInputTargets.size ? [...virtualInputTargets.keys()].join(', ') : '(none)'),
          { worldId: explicit, registered: [...virtualInputTargets.keys()] },
        );
      }
      return explicit;
    }
    return resolveRootForSource(virtualInputTargets.keys());
  }

  /** The same "default world, else the one registered, else whichever
   *  registered first" fallback {@link resolveInputRootId} uses for the
   *  ACTUATION target, generalized over any per-world registration set
   *  (`inputActionsSources`/`inputTraceSources` included) — every one of
   *  these maps is keyed by the same world ids, populated at the same
   *  per-world mount seed spot, so "the default world" means the same thing
   *  for all of them. Never throws (no explicit-id case here — the two
   *  builtin providers that call this have no way to accept a caller-chosen
   *  worldId today; see their own doc comments). */
  function resolveRootForSource(registered: IterableIterator<string>): string | null {
    const ids = [...registered];
    if (ids.length === 0) return null;
    const defaultId = opts.getDefaultRootId?.() ?? null;
    if (defaultId !== null && ids.includes(defaultId)) return defaultId;
    return ids[0]!;
  }

  providers.set('time', {
    // `loopLiveness` (issue #175): `null` when no loop is wired behind this
    // registry (a bare `createDebugRegistry()` test stand-in) — never a
    // fabricated `'running'`. Every real `Game` (`createGame`) wires this,
    // so every live play session reports a real value.
    fn: () => ({
      simSeconds: opts.getSimT(),
      tick: opts.getTick(),
      loopLiveness: opts.getLoopLiveness?.() ?? null,
      ...(opts.getFixedDt === undefined ? {} : { fixedDt: opts.getFixedDt() }),
    }),
    tier: 'observable',
    worldId: '__engine__',
    builtin: true,
  });
  providers.set('input.actions', {
    // Resolves to the DEFAULT world's action list (see `resolveInputRootId`)
    // — deterministic across every world that registers, rather than the
    // pre-D15.5 "whichever mounted last" behavior.
    fn: () => {
      const worldId = resolveRootForSource(inputActionsSources.keys());
      return (worldId ? inputActionsSources.get(worldId) : undefined)?.() ?? [];
    },
    tier: 'observable',
    worldId: '__engine__',
    builtin: true,
  });
  // D15/T-D15.5 — the post-gate action-delta trace, readable via a provider.
  // Absent a wired source (no world mounted yet) reads an empty, correctly-
  // versioned trace rather than throwing. Same default-world resolution as
  // `input.actions` immediately above.
  providers.set('input.trace', {
    fn: () => {
      const worldId = resolveRootForSource(inputTraceSources.keys());
      return (
        (worldId ? inputTraceSources.get(worldId) : undefined)?.() ?? {
          version: 1,
          seed: null,
          fixedDt: null,
          ticks: [],
        }
      );
    },
    tier: 'observable',
    worldId: '__engine__',
    builtin: true,
  });

  function registerStateProvider(
    worldId: string,
    name: string,
    fn: () => unknown,
    tier: 'observable' | 'assisted',
  ): void {
    const existing = providers.get(name);
    if (existing?.builtin) {
      // Defect 1 fix: a builtin name (`time`, `input.actions`) must never be
      // silently shadowed — the old `!existing.builtin` guard skipped BOTH
      // the collision throw and the warn for this case, so
      // `registerStateProvider('time', ...)` quietly replaced engine truth,
      // and a later `strip()` deleted it outright (leaving NO `time`
      // provider at all post-hot-reload). Throw loudly instead; there is no
      // silent-replace path for a builtin.
      throw new DebugError(
        'DEBUG_BUILTIN_RESERVED',
        `debug: "${name}" is a built-in state provider (registered by "${existing.worldId}") — ` +
          'built-in names cannot be registered over from a world',
        { name, registered: existing.worldId },
      );
    }
    if (existing) {
      if (existing.worldId !== worldId) {
        throw new DebugError(
          'DEBUG_NAME_COLLISION',
          `debug: state provider "${name}" is registered by both world "${existing.worldId}" ` +
            `and world "${worldId}" — each provider name must be unique across live roots`,
          { name, roots: [existing.worldId, worldId] },
        );
      }
      warnOnce(warnedProviders, name, 'provider', worldId);
    }
    providers.set(name, { fn, tier, worldId, builtin: false });
  }

  function registerCommand(
    worldId: string,
    name: string,
    spec: { description?: string; args?: z.ZodTuple; locus?: 'client' | 'server' },
    fn: (...args: unknown[]) => unknown | Promise<unknown>,
  ): void {
    if (spec.locus === undefined && roomDeclared) {
      throw new DebugError(
        'DEBUG_COMMAND_LOCUS_REQUIRED',
        "this project declares a Colyseus room — declare locus: 'client' | 'server' so " +
          'fixtures mutate authoritative state, not client prediction',
        { name, worldId },
      );
    }
    const existing = commands.get(name);
    if (existing) {
      if (existing.worldId !== worldId) {
        throw new DebugError(
          'DEBUG_NAME_COLLISION',
          `debug: command "${name}" is registered by both world "${existing.worldId}" and ` +
            `world "${worldId}" — each command name must be unique across live roots`,
          { name, roots: [existing.worldId, worldId] },
        );
      }
      warnOnce(warnedCommands, name, 'command', worldId);
    }
    commands.set(name, {
      description: spec.description,
      argsSchema: spec.args,
      locus: spec.locus,
      fn,
      worldId,
    });
  }

  function emit(event: string, detail?: unknown): void {
    seqCounter += 1;
    ring.push({ tick: opts.getTick(), simT: opts.getSimT(), event, detail, seq: seqCounter });
    if (ring.length > RING_CAP) ring.shift();
  }

  /** See `DebugAdapter.events`'s doc comment (`adapter/system-adapter.ts`)
   *  for the full contract — `seq` is the ONLY fence (the defective
   *  `sinceTick` filter was removed). */
  function events(sinceSeq?: number): TickStampedEvent[] {
    if (sinceSeq === undefined) return ring.slice();
    return ring.filter((e) => e.seq > sinceSeq);
  }

  /**
   * Task 2.2 — server-locus command routing (client leg). A `locus: 'server'`
   * command never calls its own registered `fn` locally: `invoke()` instead
   * sends the reserved room message `__vgai:debugCommand` and resolves on the
   * matching `__vgai:debugCommandResult` reply, so a fixture mutates the
   * AUTHORITATIVE (server) copy of state, not client prediction. Request ids
   * are a monotonic per-registry counter (`dbg-<n>`), not `Math.random`/
   * `Date.now`, so two in-flight commands never collide and correlation is
   * trivially inspectable in logs.
   */
  function invokeServerCommand(name: string, args: unknown[]): Promise<unknown> {
    if (!attachedRoom) {
      throw new DebugError(
        'DEBUG_COMMAND_FAILED',
        `debug: command "${name}" is locus:'server' but no Colyseus room is attached ` +
          '(call ctx.debug.attachRoom(room) once your game joins its room)',
        { reason: 'no room connection' },
      );
    }
    const requestId = `dbg-${++requestCounter}`;
    const room = attachedRoom;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingServerCommands.delete(requestId);
        reject(
          new DebugError(
            'DEBUG_COMMAND_FAILED',
            `debug: command "${name}" (requestId "${requestId}") timed out waiting for the server`,
            { reason: 'server timeout' },
          ),
        );
      }, SERVER_COMMAND_TIMEOUT_MS);
      pendingServerCommands.set(requestId, { resolve, reject, timer });
      room.send('__vgai:debugCommand', { name, args, requestId });
    });
  }

  // Defect 8 fix — the live detach() for whatever room is CURRENTLY attached
  // (or null if none). `attachRoom` calls this itself before attaching a new
  // room: without it, a second `attachRoom` call (no explicit `detach()` in
  // between) left the first room's `__vgai:debugCommandResult` subscription
  // live forever (a leak — the old room keeps getting messages dispatched to
  // a handler nothing reads anymore) and stranded any of ITS in-flight
  // commands riding the full 10s timeout with no way to ever be answered.
  let detachCurrentRoom: (() => void) | null = null;

  /** {@link DebugCtxSurface.attachRoom} — shared across every world's ctx
   *  surface (game-scoped, last-attached room wins — and, since Defect 8,
   *  actually CLEANS UP the previous attachment rather than merely
   *  overwriting the pointer). Subscribes to the reserved
   *  `__vgai:debugCommandResult` reply and resolves/rejects the matching
   *  in-flight {@link invokeServerCommand} promise by `requestId`. */
  function attachRoom(room: DebugRoomHandle): () => void {
    // Last-wins, but with cleanup: detach whatever room was attached before
    // (unsubscribes its listener, rejects ITS in-flight pendings — see
    // `detach` below) rather than leaking it.
    detachCurrentRoom?.();

    attachedRoom = room;
    const unsubscribe = room.onMessage('__vgai:debugCommandResult', (message) => {
      const reply = message as
        | { requestId?: string; ok?: boolean; result?: unknown; error?: unknown }
        | undefined;
      const requestId = reply?.requestId;
      if (requestId === undefined) return;
      const pending = pendingServerCommands.get(requestId);
      if (!pending) return;
      pendingServerCommands.delete(requestId);
      clearTimeout(pending.timer);
      if (reply?.ok) {
        pending.resolve(reply.result);
      } else {
        pending.reject(
          new DebugError(
            'DEBUG_COMMAND_FAILED',
            `debug: server command failed: ${String(reply?.error)}`,
            { cause: reply?.error },
          ),
        );
      }
    });

    const detach = (): void => {
      // Idempotent, and a no-op if a LATER attachRoom already superseded
      // this attachment (its own detach ran first via detachCurrentRoom?.()
      // above) — calling this stale detach again must not clobber the new
      // attachment's state.
      if (detachCurrentRoom !== detach) return;
      detachCurrentRoom = null;
      if (attachedRoom === room) attachedRoom = null;
      if (typeof unsubscribe === 'function') (unsubscribe as () => void)();
      // Defect 8 fix: reject every command still awaiting THIS room's reply
      // right now, rather than let it silently ride out the full 10s
      // `SERVER_COMMAND_TIMEOUT_MS` with no room left to ever answer it.
      for (const [requestId, pending] of pendingServerCommands) {
        clearTimeout(pending.timer);
        pending.reject(
          new DebugError(
            'DEBUG_COMMAND_FAILED',
            `debug: command (requestId "${requestId}") failed — its room was detached before a reply arrived`,
            { reason: 'no room connection' },
          ),
        );
      }
      pendingServerCommands.clear();
    };
    detachCurrentRoom = detach;
    return detach;
  }

  const adapter: DebugAdapter = {
    providers() {
      return [...providers.entries()].map(([name, entry]) => ({ name, tier: entry.tier }));
    },
    state(name: string) {
      const entry = providers.get(name);
      if (!entry) {
        throw new DebugError(
          'STATE_PROVIDER_NOT_FOUND',
          `debug: no state provider registered under "${name}"`,
          {
            registered: [...providers.keys()],
            registrationHint: REGISTRATION_HINT,
          },
        );
      }
      return entry.fn();
    },
    stateAll() {
      const result: Record<string, unknown> = {};
      for (const [name, entry] of providers) {
        try {
          result[name] = entry.fn();
        } catch (err) {
          result[name] = { __error: String(err) };
        }
      }
      return result;
    },
    commands(): DebugCommandInfo[] {
      return [...commands.entries()].map(([name, entry]) => ({
        name,
        description: entry.description,
        argsJsonSchema: entry.argsSchema
          ? z.toJSONSchema(entry.argsSchema, { unrepresentable: 'any' })
          : undefined,
        locus: entry.locus ?? 'client',
      }));
    },
    async invoke(name: string, args: unknown[]): Promise<unknown> {
      const entry = commands.get(name);
      if (!entry) {
        throw new DebugError(
          'DEBUG_COMMAND_NOT_REGISTERED',
          `debug: no command registered under "${name}"`,
          { registered: [...commands.keys()], registrationHint: REGISTRATION_HINT },
        );
      }
      let parsedArgs: unknown[] = args;
      if (entry.argsSchema) {
        const result = entry.argsSchema.safeParse(args);
        if (!result.success) {
          throw new DebugError(
            'DEBUG_COMMAND_ARGS_INVALID',
            `debug: command "${name}" received invalid args`,
            { issues: result.error.issues },
          );
        }
        parsedArgs = result.data as unknown[];
      }
      if ((entry.locus ?? 'client') === 'server') {
        return invokeServerCommand(name, parsedArgs);
      }
      try {
        return await entry.fn(...parsedArgs);
      } catch (cause) {
        // `cause` stays for in-process readers; the flattened fields are what
        // survive the wire (see `describeCause`).
        const described = describeCause(cause);
        throw new DebugError(
          'DEBUG_COMMAND_FAILED',
          `debug: command "${name}" threw: ${described.causeMessage}`,
          { cause, ...described },
        );
      }
    },
    events(sinceSeq?: number) {
      return events(sinceSeq);
    },
  };

  return {
    adapter,
    forRoot(worldId: string): DebugCtxSurface {
      return {
        registerStateProvider(name, fn, providerOpts) {
          registerStateProvider(worldId, name, fn, providerOpts?.tier ?? 'observable');
        },
        registerCommand(name, spec, fn) {
          // Cast: the public generic (`DebugCtxSurface.registerCommand`,
          // `DebugCommandArgs<T>`) exists purely for the CALLER's inference —
          // internally, every entry is stored/invoked through the same
          // untyped `(...args: unknown[])` shape (`invoke()` parses `args`
          // against `argsSchema` at the seam, not at the type level).
          registerCommand(
            worldId,
            name,
            spec as { description?: string; args?: z.ZodTuple; locus?: 'client' | 'server' },
            fn as (...args: unknown[]) => unknown | Promise<unknown>,
          );
        },
        emit(event, detail) {
          emit(event, detail);
        },
        attachRoom(room) {
          return attachRoom(room);
        },
      };
    },
    strip(worldId?: string) {
      // Defect 2 fix — scoped when `worldId` is given (a single mount's
      // hot-reload re-seed), global otherwise (the whole game going away, or
      // a test's blanket teardown). See this method's interface doc comment.
      for (const [name, entry] of providers) {
        if (entry.builtin) continue;
        if (worldId !== undefined && entry.worldId !== worldId) continue;
        providers.delete(name);
        warnedProviders.delete(name);
      }
      for (const [name, entry] of commands) {
        if (worldId !== undefined && entry.worldId !== worldId) continue;
        commands.delete(name);
        warnedCommands.delete(name);
      }
    },
    setRoomDeclared(declared: boolean) {
      roomDeclared = declared;
    },
    setInputActionsSource(worldId: string, fn: () => { name: string; valueType: string }[]) {
      inputActionsSources.set(worldId, fn);
    },
    setInputTraceSource(worldId: string, fn: () => InputTraceSnapshot) {
      inputTraceSources.set(worldId, fn);
    },
    setVirtualInputTarget(worldId: string, target: DebugVirtualInputTarget) {
      virtualInputTargets.set(worldId, target);
    },
    getVirtualInputTarget(worldId?: string) {
      const resolved = resolveInputRootId(worldId);
      return resolved !== null ? (virtualInputTargets.get(resolved) ?? null) : null;
    },
    setRunTicksTarget(target: RunTicksTarget) {
      runTicksTarget = target;
    },
    getRunTicksTarget() {
      return runTicksTarget;
    },
    registerWorldSettledProbe(probe: () => boolean) {
      worldSettledProbes.add(probe);
      return () => {
        worldSettledProbes.delete(probe);
      };
    },
    worldSettled() {
      for (const probe of worldSettledProbes) {
        try {
          if (!probe()) return false;
        } catch {
          // A throwing probe stalls the driver LOUDLY (the bounded wait's
          // timeout names it) rather than silently un-gating the tick.
          return false;
        }
      }
      return true;
    },
    getGameTick() {
      return opts.getTick();
    },
  };
}

const registryByGame = createGameScopedSlot<DebugRegistry>('debug-registry');

/** Called once by `createGame`, right after both the registry and the Game
 *  shell object exist, to file the association {@link getDebugRegistry} reads. */
export function registerDebugRegistry(game: Game, registry: DebugRegistry): void {
  registryByGame.set(game, registry);
}

/** The game-scoped registry backing `game.systemAdapters.debug`, or `null` for
 *  a `Game` built without one (there is always one for every `createGame`
 *  call — `null` only for a `Game`-shaped stand-in a test builds by hand). */
export function getDebugRegistry(game: Game): DebugRegistry | null {
  return registryByGame.get(game) ?? null;
}
