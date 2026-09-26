/**
 * The editor's mount of a `three` root whose entry module DEFAULT-EXPORTS a
 * React component — the world a game's own boot renders inside `<Canvas>`:
 *
 * ```tsx
 * export default function World() {
 *   return <><ambientLight /><mesh>…</mesh></>;
 * }
 * ```
 *
 * The world is an ordinary R3F app. The editor renders it bare into a Fiber
 * root on the host's canvas and renderer, drives Fiber's `frameloop: 'never'`
 * scheduler from the game's own loop. A game's input is its own: the session's
 * input door reaches it through the entry's `debug.input` export.
 *
 * WHOSE REACT AND FIBER. The entry's hooks resolve `react` and
 * `@react-three/fiber` through the project's module graph, so the root that
 * renders it must be built with the same instances: {@link R3FRuntime} is
 * handed in by `r3f-entry-runtime.ts`, which takes them from the R3F doorway
 * under the packaged runtime and from its own imports in a checkout, where one
 * Vite graph already shares them.
 *
 * three.js identity: nothing here imports `three` for scene objects. Fiber's
 * catalogue is extended with the host's `three` (`host.three`), the same
 * instance the returned scene and camera belong to.
 */

import type * as Fiber from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import type { MountedThreeRoot, RootAdapter } from '@volter/editor-project/adapter';
import type { SystemAdapters } from '@volter/editor-project/adapter/system-adapter';
import {
  type RenderVitalsRegistration,
  registerRenderVitals,
} from '../../runtime/dev/register-render-vitals';
import {
  createRenderDebugAdapter,
  frameCaptureContextFor,
  type RenderDebugWiring,
} from '../../runtime/dev/render-debug-adapter';
import { collectRenderMemory } from '../../runtime/dev/render-memory';
import { RENDER_SUBMIT_PHASE } from '../../runtime/dev/render-vitals';
import { createWebGLFrameCapture } from '../../runtime/dev/webgl-frame-capture';
import { getDebugRegistry } from '../../runtime/debug-registry';
import { devBuildEnabled } from '../../runtime/dev-build';
import type { GameThreeHostContext } from '../../runtime/host-context';
import type * as React from 'react';
import type { ComponentType, PropsWithChildren } from 'react';

/** The React and Fiber a three world is mounted with — the ones its own hooks resolve. */
export interface R3FRuntime {
  readonly createElement: typeof React.createElement;
  readonly Fragment: typeof React.Fragment;
  readonly Component: typeof React.Component;
  readonly useEffect: typeof React.useEffect;
  readonly createRoot: typeof Fiber.createRoot;
  readonly extend: typeof Fiber.extend;
  readonly advance: typeof Fiber.advance;
  readonly flushSync: typeof Fiber.flushSync;
  readonly events: typeof Fiber.events;
}

/** The slice of `WebGLRenderer.info` the vitals reporter reads. Declared
 *  structurally rather than imported from `three`, per this module's own
 *  identity rule (see the header): a duck-typed host renderer legitimately has
 *  no `info` at all, which is why every read of it is guarded. */
interface RendererCounters {
  readonly render: { readonly calls: number; readonly triangles: number; readonly frame: number };
  readonly memory: { readonly geometries: number; readonly textures: number };
}

interface R3FEntryModuleExports {
  /** The one shape: the world IS a component. */
  readonly default?: ComponentType;
}

type MountErrorBoundaryProps = PropsWithChildren<{ onError: (error: Error) => void }>;

/** React errors must reject a mount in Node too, where there is no window
 * error event. This boundary changes no authored content on successful mounts.
 * Built on the runtime's own `Component`, once per runtime. */
const boundaries = new WeakMap<object, ComponentType<MountErrorBoundaryProps>>();
function mountErrorBoundary(runtime: R3FRuntime): ComponentType<MountErrorBoundaryProps> {
  const known = boundaries.get(runtime.Component);
  if (known) return known;
  class MountErrorBoundary extends runtime.Component<MountErrorBoundaryProps, { failed: boolean }> {
    override state = { failed: false };
    static getDerivedStateFromError(): { failed: boolean } {
      return { failed: true };
    }
    override componentDidCatch(error: Error): void {
      this.props.onError(error);
    }
    override render() {
      return this.state.failed ? null : this.props.children;
    }
  }
  boundaries.set(runtime.Component, MountErrorBoundary);
  return MountErrorBoundary;
}

/**
 * Build the `RootAdapter` for one default-exported R3F world. Mounts through
 * react-three-fiber, gated entirely by the host's own loop and rendering
 * through the host's own `WebGLRenderer` — never a second renderer, never a
 * second `requestAnimationFrame` loop.
 */
function threeWorldAdapter(id: string, component: ComponentType, runtime: R3FRuntime): RootAdapter {
  const { createElement, Fragment, useEffect, createRoot, extend, advance, flushSync } = runtime;
  const MountErrorBoundary = mountErrorBoundary(runtime);
  const content = createElement(component);

  return {
    id,

    async mount(host: GameThreeHostContext): Promise<MountedThreeRoot> {
      // Headless mounts use this same Fiber reconciler and authored tree.
      // Their host supplies an inert draw command; absence of a GPU is not
      // permission to return a successful but empty scene.
      // Fiber v9 made the THREE catalogue tree-shakeable: `<Canvas>` calls
      // `extend(THREE)` for you, a bare `createRoot` does NOT — without this,
      // the FIRST three intrinsic in the tree (`<color>`, `<ambientLight>`,
      // …) throws "X is not part of the THREE namespace! Did you forget to
      // extend?" at reconcile time. Extending with `host.three` (not a fresh
      // `import * as THREE`) keeps the catalogue on the host's deduped three
      // instance — the same identity rule the returned scene/camera rely on.
      // `extend` merges into a module-global catalogue, so calling it once
      // per mount is idempotent.
      extend(host.three as unknown as Parameters<typeof extend>[0]);

      const gameDebugRegistry = host.game ? getDebugRegistry(host.game) : null;

      const canvas = host.surface.canvas;
      const root = createRoot(canvas);

      // `RootState` (the live scene/camera/gl fiber built) only arrives via
      // the `onCreated` callback — `root.render()`'s return value is
      // TECHNICALLY the same store, but `onCreated` is the supported hook, and
      // waiting for it (rather than assuming the first commit already ran
      // synchronously) is the honest choice under React 19's concurrent
      // renderer, which does not guarantee a synchronous first commit the way
      // legacy ReactDOM.render did.
      let resolveState!: (state: RootState) => void;
      const statePromise = new Promise<RootState>((resolve) => {
        resolveState = resolve;
      });
      let resolveEffectsReady!: () => void;
      const effectsReady = new Promise<void>((resolve) => {
        resolveEffectsReady = resolve;
      });
      // Rendered after the game's content. React runs passive effects in tree
      // order, so when this fires every provider/command effect in the
      // initial tree has registered. A Play acknowledgement is a claim that
      // the mounted game's command surface exists, not merely that Fiber
      // allocated a scene.
      function MountEffectsReady(): null {
        useEffect(resolveEffectsReady, []);
        return null;
      }

      // `root.configure()` is ASYNC in fiber v9 (`Promise<ReconcilerRoot>`) —
      // it must be awaited before `render()`.
      await root.configure({
        // The engine's renderer, not a second one — fiber renders THROUGH
        // `host.renderer` instead of constructing its own `WebGLRenderer`.
        gl: host.renderer,
        // …and the host's shadow map, not fiber's.
        //
        // `configure()` runs `gl.shadowMap.enabled = !!shadows`
        // UNCONDITIONALLY, against its own default of `false`. Passing nothing
        // therefore does not mean "leave it alone" — it means "turn shadows
        // off on the renderer the host just configured" (FX-5: every three
        // root silently read flat, with no error anywhere). Reading it back
        // off the renderer is exactly "don't clobber": a boolean also pins
        // `shadowMap.type` to `PCFSoftShadowMap`, which is what
        // `createHostRenderer` already sets, so the round trip is lossless
        // and the HOST stays the one deciding.
        //
        // Optional-chained even though `WebGLRenderer.shadowMap` is not
        // optional: a headless/stub host renderer is a real shape in this
        // repo's tests, and fiber's own `if (gl.shadowMap)` guard means the
        // value it reads there is ignored anyway.
        shadows: host.renderer.shadowMap?.enabled ?? false,
        // The engine's gated loop is the ONLY loop — fiber must never run its
        // own rAF (that would defeat editor pause; `drivesOwnLoop: false`).
        frameloop: 'never',
        // `RenderProps.size` types as the FULL `Size` (width/height/top/left),
        // so `top`/`left` are pinned to 0 (this bridge always fills its whole
        // canvas; no offset viewport).
        size: { width: host.surface.width, height: host.surface.height, top: 0, left: 0 },
        // Fiber's pointer-event manager, passed EXPLICITLY. There IS no
        // default for a bare `createRoot`: the `events = createPointerEvents`
        // default lives in the `<Canvas>` COMPONENT, which this mount does not
        // use, and `configure` gates on `if (events && !state.events.handlers)`.
        // With `events` undefined the store keeps its initial
        // `{ priority, enabled, connected: false }` — no handlers, nothing
        // bound to the canvas, no error — and every mesh-level pointer prop
        // (`onClick`, `onPointerOver`, `onPointerMissed`) is dead. Proven by a
        // control experiment differing ONLY in this property.
        ...(host.headless ? {} : { events: runtime.events }),
        onCreated: (state) => resolveState(state),
      });

      // No `<StrictMode>` — the host mounts once; StrictMode's deliberate
      // double-invoke of effects would double-subscribe `useFrame` callbacks
      // against a host loop that only ticks once per frame.
      const world = createElement(
        Fragment,
        null,
        content,
        createElement(MountEffectsReady, { key: 'vgai-mount-effects-ready' }),
      );
      // A reconcile-time crash (e.g. a missing `extend` catalogue entry)
      // surfaces as an uncaught window error and `onCreated` never fires —
      // without this guard, `mount()` would await `statePromise` FOREVER and
      // silently wedge every world declared after this one (roots mount
      // sequentially). Convert that class of failure into a loud mount error.
      const state = await new Promise<RootState>((resolve, reject) => {
        const fail = (message: string) => {
          cleanup();
          root.unmount();
          gameDebugRegistry?.strip(id);
          reject(
            new Error(`three world "${id}": fiber crashed before its first commit — ${message}`),
          );
        };
        const onError = (event: ErrorEvent) => {
          fail(event.message);
        };
        const timer = setTimeout(() => {
          cleanup();
          root.unmount();
          gameDebugRegistry?.strip(id);
          reject(
            new Error(
              `three world "${id}": onCreated did not fire within 10s — the R3F tree never ` +
                'reached its first commit (mount() fails loudly instead of hanging)',
            ),
          );
        }, 10_000);
        const cleanup = () => {
          clearTimeout(timer);
          if (typeof window !== 'undefined') window.removeEventListener('error', onError);
        };
        if (typeof window !== 'undefined') window.addEventListener('error', onError);
        root.render(
          createElement(MountErrorBoundary, { onError: (error) => fail(error.message) }, world),
        );
        void Promise.all([statePromise, effectsReady]).then(([s]) => {
          cleanup();
          resolve(s);
        });
      });

      // Clock hardening: fiber's internal `update()` calls
      // `state.clock.getDelta()` BEFORE its `frameloop:'never'` branch, and a
      // RUNNING (or autoStart) `THREE.Clock` accumulates WALL time into
      // `elapsedTime` as a side effect — skewing the deltas the 'never'
      // branch derives from the game timestamps `update(dt)` feeds below.
      // Stopped + autoStart=false makes `getDelta()` a pure no-op, so
      // `useFrame` deltas come from game time alone.
      state.clock.autoStart = false;
      state.clock.stop();

      // THE STORE IS THE TRUTH, NOT THE `onCreated` SNAPSHOT.
      //
      // `state` is one immutable zustand snapshot: every `set(...)` produces a
      // NEW state object. A world that legitimately REPLACES the default
      // camera — `useThree(s => s.set)({ camera })`, which is exactly what
      // drei's `makeDefault` does — never reaches anything read off `state`
      // directly, and fiber's own `update()` renders
      // `state.gl.render(state.scene, state.camera)` off the state object it
      // is HANDED. Measured: an authored `OrthographicCamera` world rendered
      // from fiber's default (0, 0, 5) forever, culling every ground polygon.
      // `state.get()` is fiber's own `StoreApi.getState`, carried on
      // `RootState` for precisely this reason; it is a plain map read.
      const live = (): RootState => state.get();

      // --- Live render vitals, host-seeded ---------------------------------
      // A running game must be able to explain its own frame cost through the
      // debug registry, with no capability to install and nothing for a game
      // to write. Gate: `devBuildEnabled()` (the ONE owner of "is this a dev
      // context" — a ship build registers nothing and pays nothing) and a
      // `Game` shell (the readings are folded out of that game's profiler
      // frames). A headless host cannot supply GPU readings.
      let renderVitals: RenderVitalsRegistration | null = null;
      if (!host.headless && host.game && devBuildEnabled()) {
        // The readings are folded out of profiler frames, and the profiler is
        // a flag the editor already sets on play — under the dev gate this is
        // the same cost arriving a little earlier, not a new one.
        host.game.profiler.enabled = true;
        if (!gameDebugRegistry) {
          throw new Error(`three world "${id}": mounted Game has no debug registry.`);
        }
        renderVitals = registerRenderVitals({
          registry: gameDebugRegistry,
          worldId: id,
          profiler: host.game.profiler,
          scene: live().scene,
          renderer: host.renderer,
        });
      }

      // Engine-owned render introspection, built over the SAME renderer and
      // scene Fiber uses. A design-time stand-in has no context; a headless
      // mount also honestly omits the GPU capture capability.
      const rendererContext =
        typeof host.renderer.getContext === 'function' ? host.renderer.getContext() : undefined;
      const frameCaptureContext = frameCaptureContextFor(host.headless ?? false, rendererContext);
      const frameCapture = frameCaptureContext
        ? createWebGLFrameCapture(frameCaptureContext)
        : null;
      const renderDebugWiring: RenderDebugWiring | null = frameCapture
        ? createRenderDebugAdapter({
            capture: frameCapture,
            scene: state.scene,
            memory: () => collectRenderMemory(live().scene, host.renderer.info),
          })
        : null;
      // The session debug registry is host instrumentation, not component
      // context. Publishing the existing adapter here lets coverage and
      // editor panels see the same door without wrapping the R3F tree. The
      // world's own declared systems merge in from the entry module at the
      // Game layer (`installDeclaredSystemAdapters`).
      const systemAdapters: SystemAdapters = gameDebugRegistry
        ? { debug: gameDebugRegistry.adapter }
        : {};
      if (renderDebugWiring) systemAdapters.renderDebug = renderDebugWiring.adapter;

      // The engine drives every `useFrame` through the mounted world's
      // `update(dt)` hook, never off a raw Fiber loop. This mount declares
      // that indivisible Fiber advance at DISPLAY cadence below: the real
      // host calls it once per presentation, a paused world gets dt=0, and an
      // explicit `Game.play.step()` still ticks it exactly once.
      //
      // `advance(timestamp, runGlobalEffects, state)`'s `timestamp` is
      // consumed as `THREE.Clock.elapsedTime` DIRECTLY when
      // `frameloop:'never'` (verified against fiber's `update()`
      // implementation): `delta = timestamp - clock.elapsedTime;
      // clock.elapsedTime = timestamp`. So `timestamp` must be a
      // monotonically increasing SECONDS value — GAME time, not wall time:
      // `update` simply isn't called while this world is frozen, so
      // accumulating its `dt` means fiber's clock does not advance across a
      // pause. Wall clock would leak the pause duration into the first
      // resumed frame as one giant `useFrame` delta.
      let elapsed = 0;

      return {
        kind: 'three',
        // Fiber's REAL `THREE.Scene`/`THREE.Camera`. Checkout development
        // dedupes `three`; a registry-installed project and the prebundled
        // editor can legitimately have distinct constructor identities, so
        // editor boundaries recognize Three's stable structural brands
        // (`isScene`, `isCamera`) rather than relying only on `instanceof`.
        //
        // Both are GETTERS over the live store, not snapshot fields: the host
        // and the editor must see the camera the world actually renders
        // through, including one the world swapped in after the first commit
        // (see `live` above).
        get scene() {
          return live().scene;
        },
        get camera() {
          return live().camera;
        },
        drivesOwnLoop: false,
        // Fiber's `advance()` cannot separate its `useFrame` callbacks from
        // its WebGL draw. Running this opaque update in every fixed catch-up
        // substep renders N complete frames inside one rAF callback: once a
        // scene costs more than 16.7ms, the accumulator asks for more draws,
        // those draws make the next gap larger, and the loop spirals to its
        // max-substep ceiling. The host's display pass is the one clock that
        // must own this inseparable native advance.
        updateCadence: 'display',
        // Adapter surface: `debug` (the shared game registry) and, when a real
        // WebGL2 context exists, `renderDebug` are engine-seeded. The game's
        // own capabilities arrive as the entry module's declared `systems`.
        systems: systemAdapters,
        systemScope: live().scene,
        update(dt: number): void {
          elapsed += dt;
          const current = live();
          // Fiber receives an ABSOLUTE timestamp and reconstructs `delta` by subtraction. Publish
          // the exact host-owned dt beside the synchronous advance so compatibility adapters that
          // reproduce another engine's frame clock do not inherit one-ulp cancellation residue.
          try {
            renderDebugWiring?.beforeRender();
            const profiler = host.game?.profiler;
            if (!profiler?.enabled) {
              advance(elapsed, true, current);
              return;
            }
            // The frame's CPU submission cost, produced where the draw
            // actually happens: `advance()` under `frameloop: 'never'` is what
            // calls `gl.render(scene, camera)`, and this bracket is also what
            // makes this frame a PRESENTATION as far as the vitals fold is
            // concerned (`../dev/render-vitals.ts`: no bracket, no display
            // frame). The profiler's phase clock is a stack, so bracketing
            // here cannot truncate an enclosing phase.
            const info = host.renderer.info as RendererCounters | undefined;
            const passesBefore = info?.render.frame ?? 0;
            profiler.beginPhase();
            try {
              advance(elapsed, true, current);
            } finally {
              profiler.endPhase(RENDER_SUBMIT_PHASE);
            }
            // Checked, not assumed — a duck-typed/design-time renderer
            // supplies only what a mount needs, and a mount with no counters
            // must report NOTHING rather than throw once per frame. `gpuMs` is
            // null: this path runs no GPU timer, and the profiler keeps the
            // previous reading rather than inventing a zero.
            if (info) {
              profiler.reportRender({
                gpuMs: null,
                drawCalls: info.render.calls,
                triangles: info.render.triangles,
                geometries: info.memory.geometries,
                textures: info.memory.textures,
                renderPasses: info.render.frame - passesBefore,
              });
            }
          } finally {
            renderDebugWiring?.afterRender();
          }
        },
        resize(width: number, height: number): void {
          live().setSize(width, height);
        },
        dispose(): void {
          // Reject/restore a pending capture while its renderables still
          // exist, then unmount component effects and strip this world's
          // registrations.
          renderDebugWiring?.dispose();
          // The editor audits and disposes the mounted game's window/document
          // realm immediately after `session.stop()`. Fiber's ordinary
          // `unmount()` submits a concurrent reconciler update, so component
          // effect cleanups could still be pending at that boundary and the
          // audit would truthfully report/reclaim listeners the world was
          // about to remove itself. Force the unmount COMMIT (not fiber's
          // deliberately delayed renderer/context disposal) to finish here: a
          // stopped root owns no live component lifecycle beyond this method.
          flushSync(() => root.unmount());
          // The vitals fold owns two `profiler.subscribe` registrations —
          // ended here, before the strip, so a subscription can never outlive
          // the door it feeds.
          renderVitals?.dispose();
          renderVitals = null;
          // `strip(id)` ends this world's PROVIDERS AND COMMANDS (the
          // render-vitals door above is the one this mount registers under
          // `id`); sibling roots are untouched. It does NOT end the input
          // seams `wireGameInputSeams` set — see that module's LIFETIME note.
          gameDebugRegistry?.strip(id);
        },
      };
    },
  };
}

/**
 * What a three entry module MEANS: a default-exported component is a world;
 * anything else is `null`, and each caller decides what that means (Play
 * refuses the root by name, the design session declines the world).
 */
export function resolveR3FEntryAdapter(
  entryModule: unknown,
  rootId: string,
  runtime: R3FRuntime,
): RootAdapter | null {
  const mod = entryModule as R3FEntryModuleExports | undefined;
  if (typeof mod?.default === 'function') return threeWorldAdapter(rootId, mod.default, runtime);
  return null;
}
