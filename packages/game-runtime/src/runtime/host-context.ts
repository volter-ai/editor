/**
 * The game runtime's extension of the shared host contexts: the `game` handle
 * a host hands a root it mounts. `@volter/editor-project`'s host contexts carry
 * only surfaces; this product-specific execution handle belongs here, beside
 * the `Game` it names, so the shared project contract never imports this
 * runtime.
 */
import type {
  CanvasHostContext,
  DomHostContext,
  ThreeHostContext,
} from '@volter/editor-project/adapter/host-context';
import type { AssetCache } from '@volter/threejs-runtime/assets';
import type * as THREE from 'three';
import type { Game } from './game';

/**
 * THE FOUR DOORS a mounting root actually opens on the Game — and the whole
 * reason `three`/`canvas` host contexts no longer name `GameInternal`.
 *
 * `GameInternal` is the HOST's own control surface: `runFrame`,
 * `runRenderFrame`, `runTicks`, `registerRoot`, `notifySystemAdaptersChanged`,
 * `dispose`. Handing it to an adapter's `mount()` published the loop driver to
 * the thing being driven — nothing read those members through `host.game`, but
 * the type said they could, so "what may a root do to its Game?" had no
 * answer short of "everything".
 *
 * The four doors, each with its verified consumer:
 *
 *  1. **Input-map load** — `runtime/game-input-seams.ts` calls
 *     `game.loadInputMap(path)` (and reads `game.input`/`game.loop.fixedDt`)
 *     from every three and canvas mount.
 *  2. **Debug-registry access** — `getDebugRegistry(host.game)`
 *     (`r3f-root.tsx` in the editor, `pixi-react-root-factory`); the registry is keyed by
 *     Game IDENTITY, which is why this handle is the Game and not a projection
 *     of it.
 *  3. **The profiler toggle** — `host.game.profiler` (`r3f-root.tsx`).
 *
 * Doors 2–3 are already on the PUBLIC {@link Game}. `loadInputMap` is the one
 * member that was only on `GameInternal`, and it is explicitly an adapter-mount
 * door (see its own doc comment in `runtime/game.ts`). So this handle is
 * `Game` plus that one method — and a `GameInternal` satisfies it, so every
 * host that already passes one keeps compiling unchanged.
 */
export interface HostGameHandle extends Game {
  /** Load the game-owned input map ONCE, however many roots ask. See
   *  `GameInternal.loadInputMap` for the load-once/competing-paths contract. */
  loadInputMap(path: string, options?: { optional?: boolean }): Promise<void>;
}

/**
 * A `three`-surface host context carrying the Game root. The host constructs
 * the Game shell BEFORE mounting an adapter and hands it down here so an
 * adapter can expose `ctx.game`/`ctx.roots` to the game it mounts. Absent in
 * headless harnesses and foreign hosts — everything must keep working when
 * this is undefined.
 */
export interface GameThreeHostContext extends ThreeHostContext<typeof THREE, THREE.WebGLRenderer, AssetCache> {
  readonly game?: HostGameHandle | undefined;
}

/** The `canvas`-surface counterpart of {@link GameThreeHostContext}. */
export interface GameCanvasHostContext extends CanvasHostContext {
  /** Shared Game root when mounted by the universal multi-root host. */
  readonly game?: HostGameHandle | undefined;
}

/**
 * The `dom`-surface counterpart, typed as the PUBLIC `Game` shell because that
 * is the weakest promise this surface makes, and deliberately optional: a
 * sibling mounted beside an ingest root has no native `Game` to hand it.
 */
export interface GameDomHostContext extends DomHostContext {
  readonly game?: Game | undefined;
}
