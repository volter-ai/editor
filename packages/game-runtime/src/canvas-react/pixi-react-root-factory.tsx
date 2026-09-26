/**
 * `pixiReactRootFactory` — mount a `canvas` root whose entry module
 * DEFAULT-EXPORTS a React component. This is the ONE first-party canvas mount:
 *
 * ```tsx
 * export default function World() {
 *   return <pixiContainer><pixiSprite texture={Texture.WHITE} /></pixiContainer>;
 * }
 * ```
 *
 * The world is an ordinary `@pixi/react` app. Everything vgai-shaped stays at
 * the entry module's STATIC surface (`export { debug, systems } from
 * './commands'`) and on the host's side of the seam; no vgai runtime context
 * ever enters the React tree. The host advances Pixi's real (never-started)
 * ticker on GAME time, wires the game-scoped input seams from outside
 * (`../runtime/game-input-seams.ts`), and installs `WorldProvider` off the
 * Game handle so the lib-legal react doors resolve.
 *
 * ## Why this is NOT in `mount-game.ts`
 *
 * The kind registry beside `mount-game.ts` is deliberately dependency-free:
 * registering a canvas factory there would make `pixi.js` + `@pixi/react`
 * unconditional for every game, including three-only ones. `canvas-react` is
 * the opt-in module that owns those dependencies, so the factory lives here and
 * a project opts in with `registerAdapter('canvas', pixiReactRootFactory)`.
 *
 * ## The loop contract
 *
 * `Application` is initialized with `autoStart: false` and `sharedTicker:
 * false`, so it owns a native Pixi ticker that is NEVER started and therefore
 * never requests an animation frame. `mounted.update(dt)` is the only thing
 * that advances that ticker, and it feeds GAME time, not wall time — which is
 * what makes the world freeze exactly when the host freezes it, and what makes
 * `game.waitSimTime` work in a hidden tab (a hidden tab has no rAF; the engine
 * loop's own catch-up still calls `update`, and Pixi has no independent clock
 * to disagree with it).
 *
 * ## Component catalogue
 *
 * `@pixi/react` resolves `<pixiSprite>` etc. through a module-global catalogue
 * that starts EMPTY — the first intrinsic in an un-extended tree throws
 * "X is not part of the PIXI namespace! Did you forget to extend?". This
 * module extends it with the whole `pixi.js` namespace once per mount
 * (idempotent `Object.assign`). A world that adds its own classes
 * (`@pixi/tilemap`, a custom `Container` subclass) calls `extend`/`useExtend`
 * itself.
 */

import { createRoot, extend } from '@pixi/react';
import type { MountedCanvasRoot, MountedCanvasSubstrate, RootAdapter } from '@volter/editor-project/adapter';
import type { GameCanvasHostContext } from '../runtime/host-context';
import type { SystemAdapters } from '@volter/editor-project/adapter/system-adapter';
import type { Application, ApplicationOptions, Container } from 'pixi.js';
import * as PIXI from 'pixi.js';
import { type ComponentType, createElement, Fragment, useEffect, useLayoutEffect } from 'react';
import { WorldProvider } from '../react/world-state';
import { getDebugRegistry } from '../runtime/debug-registry';
import { DEFAULT_INPUT_MAP_PATH, wireGameInputSeams } from '../runtime/game-input-seams';
import type { AdapterSurfaceFactory } from '../runtime/mount-game';

/** How long `mount()` waits for the tree's first commit before failing loudly
 *  rather than hanging (and wedging every root declared after this one, since
 *  roots mount sequentially). */
const FIRST_COMMIT_TIMEOUT_MS = 10_000;

/**
 * `@pixi/react` keys its reconciler roots off the canvas element in a
 * module-global map, and its own unmount path (which would clear that key) is
 * not exported. So a canvas this lane has already mounted must never be handed
 * to a second mount: `createRoot` would silently hand back the FIRST root,
 * whose `Application` this lane already destroyed. Every host in this repo
 * builds a fresh canvas per mount, so this only ever fires on a genuine bug —
 * and it fires as a named error rather than as a dead world.
 */
const MOUNTED_CANVASES = new WeakSet<HTMLCanvasElement>();

/** `@pixi/react`'s reconciler-root handle. Its `Root` type is internal (the
 *  package exports the FUNCTION, not the type), so name it off the function. */
type PixiReactRoot = ReturnType<typeof createRoot>;

interface CanvasEntryModuleExports {
  /** The one shape: the world IS a component. */
  readonly default?: ComponentType;
  /** Imperative canvas substrates export their own host adapter. This is the
   * same explicit boundary the three entry adjudicator accepts; gameplay
   * modules remain ecosystem-native. */
  readonly adapter?: unknown;
}

/** Pixi's substrate-narrowed mounted shape: generic canvas hosts depend on
 * {@link MountedCanvasRoot}. */
export interface MountedPixiRoot extends MountedCanvasRoot {
  readonly substrate: MountedCanvasSubstrate<Container> & { readonly name: 'pixi' };
}

function isCanvasRootAdapter(candidate: unknown): candidate is RootAdapter<'canvas'> {
  if (candidate === null || typeof candidate !== 'object') return false;
  const value = candidate as Record<string, unknown>;
  return (
    typeof value['id'] === 'string' &&
    value['id'].length > 0 &&
    typeof value['mount'] === 'function'
  );
}

/**
 * Build the `RootAdapter<'canvas'>` for one default-exported Pixi world.
 * Mounts through `@pixi/react`, gated entirely by the host's own loop and
 * rendering into the host's own canvas — never a second canvas, never a
 * second `requestAnimationFrame` loop.
 */
function canvasWorldAdapter(id: string, component: ComponentType): RootAdapter<'canvas'> {
  const content = createElement(component);

  return {
    id,

    async mount(host: GameCanvasHostContext): Promise<MountedPixiRoot> {
      // THE HOST WIRES THIS GAME'S INPUT FROM OUTSIDE THE TREE — the project's
      // declared map (conventional path, optional: a brand-new project
      // declares no actions yet) and this root's `game.input.*` seams on the
      // debug registry. Actions must exist before any component's first tick
      // reads them — wait for the (never-rejecting) load before the first
      // commit.
      const registry = host.game ? getDebugRegistry(host.game) : null;
      if (registry) {
        await wireGameInputSeams(host, registry, {
          id,
          inputMapPath: DEFAULT_INPUT_MAP_PATH,
          optionalInputMap: true,
        });
      }

      const canvas = host.canvas;
      if (MOUNTED_CANVASES.has(canvas)) {
        throw new Error(
          `canvas world "${id}": this lane has already mounted this canvas. @pixi/react keys ` +
            'its reconciler roots off the canvas element, so re-using one would resurrect a ' +
            'root whose Application is destroyed. Hand each mount a fresh canvas (every vgai ' +
            'host already does).',
        );
      }
      MOUNTED_CANVASES.add(canvas);

      // The catalogue is module-global and starts empty; this is idempotent.
      extend(PIXI as unknown as Parameters<typeof extend>[0]);

      let resolveCommitted!: () => void;
      const committed = new Promise<void>((resolve) => {
        resolveCommitted = resolve;
      });
      let resolveEffectsReady!: () => void;
      const effectsReady = new Promise<void>((resolve) => {
        resolveEffectsReady = resolve;
      });
      let resolveUnmounted!: () => void;
      const unmounted = new Promise<void>((resolve) => {
        resolveUnmounted = resolve;
      });
      let resolveEffectsUnmounted!: () => void;
      const effectsUnmounted = new Promise<void>((resolve) => {
        resolveEffectsUnmounted = resolve;
      });
      /**
       * Signals the tree's FIRST COMMIT and both unmount cleanup phases. Rendered as the LAST
       * child deliberately:
       *
       *  - mount: layout effects run synchronously inside the commit, before
       *    any passive effect and before any tick can be scheduled;
       *  - unmount: the layout cleanup fences `useTick` and the passive cleanup fences ordinary
       *    project effects. Native destruction waits for BOTH; resolving only from layout left
       *    passive listener/resource cleanup racing an Application whose renderer was null.
       */
      function Lifecycle(): null {
        useLayoutEffect(() => {
          resolveCommitted();
          return resolveUnmounted;
        }, []);
        // This component is the last sibling. Reaching its passive effect
        // means the initial tree's provider/command effects have registered,
        // so mount() can truthfully back Play's ack.
        useEffect(() => {
          resolveEffectsReady();
          return resolveEffectsUnmounted;
        }, []);
        return null;
      }

      // `WorldProvider` rides `host.game` — the React seam every dom root
      // already has, and the only way a capability hook can reach the ONE
      // game-scoped registry the editor/`vgai eval` read. `host.game` is
      // genuinely absent in bare/foreign hosts, so the provider is
      // conditional and those hooks stay the inert no-ops they already
      // document themselves to be.
      const game = host.game;
      const world = createElement(Fragment, null, content, createElement(Lifecycle));
      const element = game ? createElement(WorldProvider, { game }, world) : world;

      const root: PixiReactRoot = createRoot(canvas);

      // The host owns size, dpr, transparency and capture cost; the loop
      // contract owns `autoStart`/`sharedTicker`.
      const initOptions: Partial<ApplicationOptions> = {
        antialias: true,
        width: host.width,
        height: host.height,
        resolution: host.dpr ?? globalThis.devicePixelRatio ?? 1,
        autoDensity: true,
        // Stacked ABOVE a sibling root -> clear with alpha 0 so the layer below
        // shows through (COMPOSITION-DESIGN D5 §1).
        backgroundAlpha: host.transparent ? 0 : 1,
        preserveDrawingBuffer: host.preserveDrawingBuffer ?? false,
        autoStart: false,
        sharedTicker: false,
      };

      // Install the reconcile-error listener BEFORE `root.render`: Pixi hands
      // the Application back after `init()` but React can already have thrown
      // during that same turn. Attaching after the await loses the real error
      // and turns it into a misleading ten-second timeout.
      let reportReconcileFailure!: (why: string) => void;
      const reconcileFailure = new Promise<string>((resolve) => {
        reportReconcileFailure = resolve;
      });
      const onError = (event: ErrorEvent): void => {
        reportReconcileFailure(
          `the Pixi tree crashed before its first commit — ${event.message} ` +
            '(mount() fails loudly instead of hanging)',
        );
      };
      globalThis.addEventListener?.('error', onError);

      let app: Application | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // `root.render` is async: it awaits `Application.init()` (which is what
        // creates the renderer) and only then hands the tree to the reconciler.
        // A crash inside init rejects here, which is the loud failure we want.
        const renderedApp = await root.render(element, initOptions);
        app = renderedApp;

        // A reconcile-time crash (e.g. an un-extended component) surfaces as
        // an uncaught window error and the first commit never lands. Race that
        // exact signal against the commit and the last-resort ceiling.
        const timeout = new Promise<string>((resolve) => {
          timer = setTimeout(
            () =>
              resolve(
                `no first commit within ${FIRST_COMMIT_TIMEOUT_MS / 1000}s ` +
                  '(mount() fails loudly instead of hanging)',
              ),
            FIRST_COMMIT_TIMEOUT_MS,
          );
        });
        const failure = await Promise.race([
          Promise.all([committed, effectsReady]).then(() => null),
          reconcileFailure,
          timeout,
        ]);
        if (failure !== null) {
          throw new Error(`canvas world "${id}": ${failure}`);
        }
      } catch (error) {
        try {
          app?.destroy(false, { children: true });
        } catch {
          /* the world never fully came up; teardown failure must not mask why */
        }
        throw error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        globalThis.removeEventListener?.('error', onError);
      }

      // `app` is assigned before the first-commit race. Reaching here proves
      // both initialization and commit succeeded, so narrow once for the live
      // mounted-root methods below.
      if (app === undefined) {
        throw new Error(`canvas world "${id}": initialized without an Application`);
      }
      const mountedApp = app;

      // Pin the ticker's clock to GAME time. `Ticker.lastTime` starts at -1, so
      // without this the first `update()` would report a 1ms phantom delta on
      // top of the real one. From here every `deltaMS` a `useTick` callback
      // sees is exactly the `dt` the host handed us — no wall clock anywhere,
      // which is what makes a paused world's resume frame ordinary rather than
      // one giant catch-up step.
      mountedApp.ticker.lastTime = 0;
      let elapsedMs = 0;
      let disposed = false;
      // Adapter surface: the host's shared debug registry. The game's own
      // capabilities arrive as the entry module's declared `systems`.
      const systemAdapters: SystemAdapters = registry ? { debug: registry.adapter } : {};
      const disposeComplete = Promise.all([unmounted, effectsUnmounted]).then(() => {
        // React can tear the root down itself after a fatal layout/effect error. In that path the
        // host has not called dispose() yet, but Application.destroy() still clears Pixi's ticker
        // and renderer. Wait for both layout and passive cleanup first: project effects may own
        // window/document listeners and can still read the Pixi Application while React drains
        // passive deletion effects. Fence the mounted root before clearing the native slots so
        // subsequent host frames and the eventual host teardown cannot re-enter them.
        disposed = true;
        mountedApp.destroy(false, { children: true });
      });

      return {
        kind: 'canvas',
        canvas,
        substrate: { name: 'pixi', root: mountedApp.stage },
        drivesOwnLoop: false,
        systems: systemAdapters,
        disposeComplete,
        update(dt: number): void {
          if (disposed) return;
          elapsedMs += dt * 1000;
          // The real Pixi ticker remains the one scheduler `useTick` observes;
          // the host only gates/advances it.
          mountedApp.ticker.update(elapsedMs);
        },
        resize(width: number, height: number): void {
          if (disposed) return;
          // `autoDensity: true` makes Pixi re-stamp `canvas.style.width`/
          // `.height` from this call, so the on-screen box follows the logical
          // size with no explicit CSS write from the host.
          mountedApp.renderer.resize(width, height);
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          // Pixi's EventSystem owns document.pointermove + window.pointerup
          // (and its event ticker's global listener). React's deletion commit
          // is asynchronous, so waiting to destroy the Application leaves
          // those listeners live when the host audits this game realm. Detach
          // the input target synchronously; the later Application.destroy()
          // repeats this idempotently after every useTick cleanup has landed.
          mountedApp.renderer.events.setTargetElement(null as unknown as HTMLElement);
          // Rendering `null` children is the only unmount path `@pixi/react`
          // exposes publicly (its `unmountRoot` helper is internal), and React
          // commits that deletion on its own schedule — NOT synchronously. So
          // the Application is destroyed on the `Lifecycle` cleanup signal
          // instead of inline: `useTick`'s cleanup calls `ticker.remove()`, and
          // a ticker destroyed before it lands throws inside React's commit.
          // `removeView` stays false — the canvas belongs to the HOST.
          void root.render(null, initOptions);
        },
      };
    },
  };
}

/**
 * What a canvas entry module MEANS, in one place.
 *
 * Two callers need this answer and must never disagree about it: the runtime
 * mount ({@link pixiReactRootFactory}, below) and the EDITOR, which resolves
 * the same entry for play mode and for the design-time layer. When only one
 * side knows the shape, a world plays fine and shows "(no scene loaded)" in
 * edit mode.
 *
 * Returns `null` when the module has no default-exported component — the
 * callers differ on what to do about that (the factory throws; the editor
 * reports a mount failure on that root's boundary node and leaves every
 * sibling working).
 */
export function resolveCanvasEntryAdapter(
  entryModule: unknown,
  rootId: string,
): RootAdapter<'canvas'> | null {
  const mod = entryModule as CanvasEntryModuleExports | undefined;
  if (isCanvasRootAdapter(mod?.adapter)) return mod.adapter;
  if (typeof mod?.default === 'function') return canvasWorldAdapter(rootId, mod.default);
  return null;
}

/**
 * Register with `registerAdapter('canvas', pixiReactRootFactory)`.
 */
export const pixiReactRootFactory: AdapterSurfaceFactory = (root, ctx) => {
  const adapter = resolveCanvasEntryAdapter(ctx.entryModule, root.id);
  if (adapter) return { kind: 'canvas', adapter };
  throw new Error(
    `pixiReactRootFactory: entry module "${root.entry ?? '(none)'}" for root "${root.id}" must ` +
      'default-export a React component (`export default function World() { … }`).',
  );
};
