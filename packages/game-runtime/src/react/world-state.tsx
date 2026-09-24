/**
 * Canonical `WorldProvider`/`useGame`/`useWorldState`/`useRootObservation`
 * entry for React adapter roots. Also home to `useDebugProvider` and
 * `useDebugCommand`/`useDebugEmit`, the React-facing debug seam.
 *
 * This is a SEPARATE, react-value-importing module under
 * `packages/game-runtime/src/react/` — colocated per the "colocate the
 * react-facing hooks with the HUD seam, not the react-free core" rule, just now living IN the engine package rather than only in the
 * project template. It is imported by NOTHING in the engine core import
 * graph (`packages/project/src/` outside this `react/` directory) — that
 * invariant is proved by `packages/engine/test/react-core-import-ban.test.ts`
 * (AC-F1).
 *
 * Every host and game imports this one module, so provider and hooks share
 * one `createContext()` identity. The engine core outside `src/react/`
 * remains React-free, enforced by `react-core-import-ban.test.ts`.
 */

import type { RootStateObserver } from '@volter/editor-project/adapter';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { z } from 'zod';
import type { DebugCommandArgs } from '../runtime/debug-registry';
import { getDebugRegistry } from '../runtime/debug-registry';
import { createFrameSelectorCache, type Equals, shallow } from '../runtime/frame-selector-cache';
import type { Game } from '../runtime/game';

/** Re-exported for convenience — the opt-in equality for selectors that
 *  return a fresh object/array/tuple every call (default is `Object.is`). */
export { shallow };

const GameContext = createContext<Game | null>(null);

/** Provide the `Game` to `useWorldState`/`useGame` for everything mounted
 *  beneath it. Adapter-root hosts install this provider automatically — see the module doc
 *  comment above for the context-identity rule this hook family depends on.
 *
 *  Props use `PropsWithChildren` (children optional in the TYPE, not
 *  runtime-optional in practice — you always want children mounted under
 *  the provider) rather than a bare `{ children: ReactNode }` field: a
 *  required `children` in `P` makes TS's `createElement<P>(type, props?:
 *  Attributes & P, ...children)` overload reject the plain 3-arg call
 *  `React.createElement(WorldProvider, { game }, child)` (no JSX transform,
 *  e.g. a `.ts` main composing a sibling `.tsx` HUD) with "Property
 *  'children' is missing" even though the 3rd arg supplies it — issue #97.
 *  Making `children` optional in the type lets that overload resolve; the
 *  rest-arg children are still wired through to `children` at runtime by
 *  React itself, unchanged. See `test/game-state-create-element-types.test.tsx`. */
export function WorldProvider({ game, children }: PropsWithChildren<{ game: Game }>) {
  return <GameContext.Provider value={game}>{children}</GameContext.Provider>;
}

/** Read the `Game` provided by the nearest `WorldProvider`. Throws
 *  descriptively when called outside one — matching the repo's loud-failure
 *  habit rather than silently returning `null`. */
export function useGame(): Game {
  const game = useContext(GameContext);
  if (!game) {
    throw new Error(
      'useGame: no Game in context — wrap this component in <WorldProvider game={ctx.game!}>.',
    );
  }
  return game;
}

/**
 * {@link useGame}'s non-throwing sibling: the `Game` when one hosts this tree,
 * `null` otherwise.
 *
 * For components that legitimately mount BOTH under a running game and under a
 * host that has none — the editor design-mounts a world to author it, and a
 * story renders a component with no game at all. Those components must degrade
 * (a dev/QA surface that simply has nothing to drive) rather than throw during
 * render, which would take the whole world down with it. Everything else uses
 * `useGame`, whose throw is the honest report of a wiring bug.
 */
export function useOptionalGame(): Game | null {
  return useContext(GameContext);
}

/**
 * Subscribe to a selected slice of game state. Re-renders only when the
 * selected value changes: the selector re-runs at most once per completed
 * frame (`game.state.frameVersion`), and `equals` (default `Object.is`; pass
 * {@link shallow} for tuples/objects) gates whether the fresh result
 * actually counts as a change.
 *
 * `selector` reads the live graph (e.g.
 * `g => g.world('main')?.threeScene().getObjectByName('Hero')?.position.y`)
 * at post-frame quiescence — no
 * copies. A selector that returns a fresh object every call must pass
 * `shallow` (or an equivalent `equals`), or it will re-render every frame.
 *
 * Note: `equals` is captured once, when this hook first mounts (in the
 * per-instance cache created below) — pass a stable function (module-level
 * `shallow`/`Object.is`, or a value that doesn't change across renders),
 * not a fresh inline arrow every render.
 */
export function useWorldState<T>(selector: (game: Game) => T, equals: Equals<T> = Object.is): T {
  const game = useGame();
  const cacheRef = useRef<ReturnType<typeof createFrameSelectorCache<T>> | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = createFrameSelectorCache<T>(equals);
  }

  return useSyncExternalStore(
    (onStoreChange) => game.state.subscribe(onStoreChange),
    () => cacheRef.current!.get(game.state.frameVersion, () => selector(game)),
  );
}

/**
 * Pure, react-free lookup for the `useRootObservation` hook below — factored
 * out so the hook body stays a thin `useSyncExternalStore` wrapper. Throws
 * descriptively (loud, not `undefined`-forever) when `worldId` doesn't name a
 * registered world, or that world's mount has no `observe`
 * (`RootStateObserver`, `@volter/editor-project/adapter`) — matching the `Game.registerRoot`
 * "no state bridge" report (`runtime/game.ts`) this is the react-side half of.
 */
export function requireRootObserver(game: Game, worldId: string): RootStateObserver {
  const world = game.world(worldId);
  if (!world) {
    throw new Error(
      `useRootObservation: no world registered with id "${worldId}" — check game.roots for the ` +
        'ids actually registered.',
    );
  }
  const observer = world.mounted.observe;
  if (!observer) {
    throw new Error(
      `useRootObservation: world "${worldId}" (kind: ${world.kind}, adapter: "${world.adapter.id}") ` +
        'has no state bridge — its mount has no `observe` (RootStateObserver). This world cannot ' +
        'be observed from React.',
    );
  }
  return observer;
}

/**
 * Subscribe to a selected slice of a FOREIGN (non-first-party) world's
 * observed state — the ingested-world counterpart of `useWorldState` above;
 * both are sugar over the same subscribe/snapshot shape, so a react HUD reads
 * native and ingested sources through one mental model.
 *
 * `selector` runs over that world's `snapshot()` — NOT the `Game` — since a
 * foreign world exposes no first-party state. Re-renders only when the
 * selected value changes (`equals`, default `Object.is`; pass {@link shallow}
 * for tuples/objects returned fresh every call).
 *
 * Cadence note: unlike `useWorldState`, this does NOT key its cache off
 * `game.state.frameVersion` — a foreign/self-driven world may notify on its
 * OWN rAF cadence, unrelated to our frame timing (§4's "consumers must not
 * assume our frame timing"). Instead this keeps a local version counter,
 * bumped once per `onChange` notification from the observer itself.
 *
 * Throws (loud, not a silently-undefined subscription) if `worldId` isn't
 * registered, or its mount has no `observe` — see `requireRootObserver`.
 */
export function useRootObservation<T>(
  worldId: string,
  selector: (snapshot: unknown) => T,
  equals: Equals<T> = Object.is,
): T {
  const game = useGame();
  const observer = requireRootObserver(game, worldId);
  const cacheRef = useRef<ReturnType<typeof createFrameSelectorCache<T>> | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = createFrameSelectorCache<T>(equals);
  }
  // Local notification-version counter — see the cadence note above. A
  // plain mutable ref (not React state): bumping it must not itself trigger
  // a render, `useSyncExternalStore`'s `onStoreChange` is what does that.
  const versionRef = useRef(0);

  return useSyncExternalStore(
    (onStoreChange) =>
      observer.subscribe(() => {
        versionRef.current++;
        onStoreChange();
      }),
    () => cacheRef.current!.get(versionRef.current, () => selector(observer.snapshot())),
  );
}

/**
 * The debug seam's react-world registration door (Task 1.5): react roots
 * have no `setup()`/ `ctx.debug` of their own, so this hook registers a
 * named state provider into the SAME game-scoped registry every root's
 * `ctx.debug` feeds (`getDebugRegistry(game)`, `runtime/debug-registry.ts`),
 * readable through `game.systemAdapters.debug.state(name)` exactly like a
 * `ctx.debug.registerStateProvider` call.
 *
 * Registers ONCE per mount (keyed on `name`) and unregisters on unmount —
 * silently, like hot-reload's `strip()`. Re-renders never re-register or
 * re-warn: `fn` is kept in a ref updated every render, so the registered
 * closure always calls the CURRENT `fn` without touching the registry.
 * Outside a `<WorldProvider>` (or against a bare test `Game` built without a
 * registry) this is an inert no-op — it never throws, matching the "no seam
 * without a consumer" degrade every optional `ctx.*` surface follows.
 */
export function useDebugProvider(
  name: string,
  fn: () => unknown,
  opts?: { tier?: 'observable' | 'assisted' },
): void {
  const game = useContext(GameContext);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const tier = opts?.tier;

  useEffect(() => {
    const registry = game && getDebugRegistry(game);
    if (!registry) return;
    return registry.registerReactProvider(name, () => fnRef.current(), { tier });
    // `tier` is deliberately NOT a dep (same reasoning as `useDebugCommand`'s
    // `spec`) — captured once at mount, so it never forces re-registration.
  }, [game, name]);
}

/**
 * The command-side counterpart of {@link useDebugProvider} — registers an
 * invokable debug command into the same game-scoped registry, readable
 * through `game.systemAdapters.debug.commands()`/`invoke(name, args)`.
 *
 * Same mount/unmount/ref-latest contract as {@link useDebugProvider}: `spec`
 * (description/args/locus) is captured at registration time, `fn` always
 * calls through to the latest render's closure via a ref, and the hook is an
 * inert no-op with no `<WorldProvider>` in scope.
 *
 * Generic over the declared `args` Zod tuple, same as
 * `DebugCtxSurface.registerCommand` ({@link DebugCommandArgs}, dry-run
 * finding — ledger): declaring `args: z.tuple([z.number(), z.string()])`
 * types `fn`'s parameters as `(n: number, s: string) => ...` with no
 * `unknown[]` cast; omitting `args` keeps `fn` typed `(...args: unknown[])
 * => ...` as before.
 */
export function useDebugCommand<T extends z.ZodTuple | undefined = undefined>(
  name: string,
  spec: { description?: string; args?: T; locus?: 'client' | 'server' },
  fn: (...args: DebugCommandArgs<T>) => unknown | Promise<unknown>,
): void {
  const game = useContext(GameContext);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const registry = game && getDebugRegistry(game);
    if (!registry) return;
    return registry.registerReactCommand(name, spec, (...args: DebugCommandArgs<T>) =>
      fnRef.current(...args),
    );
    // `spec` is deliberately NOT a dep (like `equals` above) — captured once
    // at mount, so a fresh inline object literal every render never forces
    // re-registration.
  }, [game, name]);
}

/**
 * The event-side counterpart of {@link useDebugProvider} and
 * {@link useDebugCommand}. Returns a stable callback that writes a
 * tick-stamped event to the game-scoped debug flight recorder:
 *
 * ```tsx
 * const emit = useDebugEmit();
 * emit('score-changed', { score });
 * ```
 *
 * It is an inert no-op outside a `<WorldProvider>`, matching the optional
 * behavior of the other React debug hooks. Games never need to import the
 * debug registry or know its internal React provenance id.
 */
export function useDebugEmit(): (event: string, detail?: unknown) => void {
  const game = useContext(GameContext);
  return useCallback(
    (event: string, detail?: unknown) => {
      if (!game) return;
      getDebugRegistry(game)?.emitReact(event, detail);
    },
    [game],
  );
}
