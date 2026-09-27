/**
 * The surface-neutral Game root and its declaration-ordered root registry.
 * Three, Canvas, and DOM roots share one game-scoped loop, input manager,
 * system runner, state bridge, debug registry, clock, and seeded RNG. Each
 * RootInstance retains its own mounted surface and optional capabilities.
 */

import type { AdapterSurface as AdapterSurfaceLeaf } from '@volter/editor-project/adapter/adapter-surface';
import type { RootBinding } from '@volter/editor-project/adapter/binding';
import {
  formatAudioGateMessage,
  formatLoopGateMessage,
} from '@volter/editor-project/adapter/loop-gate-report';
import type { MountedRoot } from '@volter/editor-project/adapter/root-adapter';
import type { AudioAdapter, SystemAdapters } from '@volter/editor-project/adapter/system-adapter';
import { bindScopedSystem } from '@volter/editor-project/adapter/system-slot';
import type { AssetCache } from '@volter/threejs-runtime/assets';
import { hasUserData } from '@volter/threejs-runtime/ecs/user-data';
import type { CollisionSystem } from '@volter/threejs-runtime/physics/collision-system';
import type { PhysicsRegistry } from '@volter/threejs-runtime/physics/physics-registry';
import type * as THREE from 'three';
import type { createGameLoop } from './core/game-loop';
import {
  createSeededRandom,
  DEFAULT_SEEDED_RANDOM_SEED,
  registerSeededRandom,
} from './core/seeded-random';
import { createSimClock, registerSimClock, type SimClockInternal } from './core/sim-clock';
import { createSystemRunner, type SystemRunner } from './core/system-runner';
import { PHASE_ORDER, SystemPhase, type SystemPhaseName } from './core/types';
import { createPerformanceProfiler, type PerformanceProfiler } from './dev/performance-profiler';
// TYPE-ONLY (same rule as the pixi import above): this lives under `pixi/`,
// but `game.ts` only ever names its TYPE.
import type { Physics2DRegistry } from './pixi/physics-registry';
import {
  createDebugRegistry,
  DebugError,
  type RunTicksOptions,
  registerDebugRegistry,
} from './debug-registry';
import { createGameplayRngTrap, registerGameplayRngTrapControl } from './gameplay-rng-trap';
import type { PlaytestContext } from './playtest';

/** The one loop type — `createGameLoop`'s return shape (fixed-step sim,
 *  display-rate presentation). */
export type GameLoop = ReturnType<typeof createGameLoop>;

/**
 * The tail of `PHASE_ORDER` that presents rather than simulates, and
 * therefore runs once per DISPLAY frame (`runRenderFrameImpl`) rather than
 * once per fixed substep. The same two phases `runTicks`' `skipRenderPhases`
 * fast-forward skips and `render-control.ts`'s `renderOnce()` drives — one
 * definition of "the render phases" across all three, kept in `PHASE_ORDER`'s
 * own order.
 */
const DISPLAY_RATE_PHASES: readonly SystemPhaseName[] = PHASE_ORDER.filter(
  (phase) => phase === SystemPhase.PRE_RENDER || phase === SystemPhase.RENDER,
);

/**
 * Game-level play-state control surface (D10, T7.6): pause/resume/step as ONE
 * control surface on the running game, with PER-WORLD `pausable` semantics
 * (`RootInstance.pausable`) — a menu/HUD world declaring `pausable: false` keeps
 * ticking (input, physics) while every `pausable: true` world
 * freezes. A paused-and-pausable world's `render` phase still runs (with `dt`
 * forced to `0`, so time-based render effects — e.g. a post-processing pass with
 * its own internal clock — don't silently keep animating under a "frozen" scene)
 * — simulation freezes, the screen does not go black. That render runs once per
 * display frame under a host that drives `runRenderFrame`, and once per substep
 * under one that still renders inside
 * `runFrame`. `GameLoop.timeScale` remains the orthogonal
 * "speed up/slow down" axis — pausing never touches it, so the host's
 * accumulator/rAF loop keeps ticking at its normal cadence, which is what makes
 * "paused still renders" possible.
 */
export interface PlayState {
  /** Whether the game is currently paused (game-level — see the per-world
   *  `pausable` caveat above: a `pausable: false` world ignores this). */
  readonly paused: boolean;
  /**
   * Freeze every `pausable` world's simulation (idempotent — a second call
   * while already paused is a no-op) and, for every `pausable`, self-driven
   * (`drivesOwnLoop`) world, invoke its loop-gate capability
   * (`mounted.setPaused(true)`) — reporting loudly, once per world, when that
   * capability is absent (an honest "cannot gate" instead of a silent no-op).
   * Also silences every `pausable` world's audio via its
   * `SystemAdapters.audio` (absent ⇒ the same loud, once-only report).
   */
  pause(): void;
  /** Resume every `pausable` world — the inverse of `pause()`, same
   *  idempotency and loop-gate/audio fan-out (no re-reporting; a world that
   *  couldn't be gated on pause simply never was, so resume has nothing to
   *  undo for it). */
  resume(): void;
  /**
   * Advance exactly the currently-FROZEN roots by one fixed substep: the
   * `pausable`, host-driven (`!drivesOwnLoop`) roots while `paused` is
   * true. While NOT paused this is a whole-call no-op — under D10 the loop
   * never stops, so every non-frozen world is already being ticked; an
   * unconditional extra tick was the §7.1-2 double-tick bug (probe4). A
   * `pausable`, self-driven world that was actually gated by `pause()`
   * (adapter has `setPaused`) steps via its own loop-gate `step()`
   * capability instead (absent ⇒ the same loud report as `pause()`); a
   * self-driven world the gate couldn't reach is still running and is left
   * alone. `dt` defaults to the engine's fixed timestep (1/60s — every real
   * host constructs its loop with this value; see `create-runtime.ts`).
   */
  step(dt?: number): void;
}

/**
 * The kinds of render surface a world can be. `'three'` and `'canvas'`
 * roots are canvas-backed; `'dom'` roots own a DOM layer.
 *
 * Re-exported from `adapter/adapter-surface.ts` so
 * `adapter/root-adapter.ts`'s kind-tagged `MountedRoot` types can name it
 * without an import cycle back to this file. This re-export keeps every
 * existing `import type { AdapterSurface } from './game'` call site
 * compiling unchanged.
 */
export type AdapterSurface = AdapterSurfaceLeaf;

/**
 * A world's per-phase frame hooks.
 * Populated on a `RootInstance` only for first-party mounts — an opaque/
 * foreign mount has no phase-partitioned entry point, so it stays
 * `undefined` and the Game's frame executor falls back to its single
 * `mounted.update(dt)`. The mount's `updateCadence` chooses fixed-substep
 * (the default) or display-rate dispatch.
 */
export interface RootFrameHooks {
  /** Run this world's engine systems + component ticks + world-bound game
   *  systems for one phase. For a first-party world this delegates to the
   *  same `SystemRunner.runPhase` as its direct `mounted.update` entry. */
  runPhase(phase: SystemPhaseName, dt: number): void;
  /** Run once per substep, after ALL phases have run for ALL roots this
   *  substep (mirrors where `mounted.update`'s post-`systems.run` work sat
   *  today — e.g. `input.endFrame()`). Optional: a world may have nothing
   *  to do here. */
  endFrame?(): void;
}

/**
 * A single world instance: the unit of adaptation.
 */
/**
 * One `SystemAdapters` slot a mounted root's `systems` table answered with
 * `absent(reason)` (`adapter/system-slot.ts`) — a POSITIVE absence.
 *
 * Nothing is installed for it. It exists so a reader can tell "this game has no
 * physics" from "nobody looked", which the adapter bag alone cannot do: an
 * unfilled slot has the same shape for both, and only one of them is a work
 * order.
 */
export interface DeclaredSystemAbsence {
  /** The root whose declaration answered — absences are declared per root, and
   *  the slot is only truly absent when NO root fills it. */
  readonly rootId: string;
  readonly slot: keyof SystemAdapters;
  /** The game's own words: what was searched, and what was found. */
  readonly reason: string;
}

export interface RootInstance {
  /** Manifest root id. */
  readonly id: string;
  readonly kind: AdapterSurface;
  /** Per-world play/pause semantics. */
  readonly pausable: boolean;
  /** The RootAdapter that produced `mounted` — first-party or external.
   *  Deliberately narrower than `RootAdapter<K>` (T7.5): this field is only
   *  ever read for `.id` (`Game.registerRoot`'s diagnostic message below) —
   *  never re-invoked — and `RootAdapter<K>`'s `mount` signature legitimately
   *  differs per kind's host CONTEXT (`HostContextFor<K>`, P-8: a canvas
   *  adapter's `CanvasHostContext`, a react adapter's `DomHostContext`, vs a
   *  three adapter's `ThreeHostContext`), so requiring the FULL interface here
   *  would force each registration site to name its own `K` for no behavioral
   *  gain — see `AdapterHandle` below. */
  readonly adapter: AdapterHandle;
  /** The live mounted surface — one of `MountedRoot`'s kind-tagged shapes
   *  (T7.5; `MountedThreeRoot` for a three world, `MountedCanvasRoot` for
   *  canvas, `MountedReactRoot` for react). */
  readonly mounted: MountedRoot;
  /** Kind-narrowed accessor: throws a descriptive error when this world is
   *  not a three world. */
  threeScene(): THREE.Scene;
  /** Kind-narrowed accessor for canvas roots: returns the native substrate
   * root the adapter mounted. The host keeps it opaque; a substrate adapter
   * that declared the matching name narrows `T`. */
  canvasRoot<T = unknown>(): T;
  /** Kind-narrowed accessor for DOM roots: returns the
   *  DOM-root layer `<div>` the host mounted this world's react tree into
   *  (the SAME element passed as `container` to `createRootInstance` —
   *  identity matters, mirroring `threeScene()`/`canvasRoot()`'s "same
   *  instance the adapter mounted" contract). Throws descriptively for a
   *  non-react world, or a react world built without a `container` (see
   *  `RootInstanceInit.container`). */
  reactRoot(): HTMLElement;
  /** Present only when the world's mount is first-party (Rapier3D for
   *  three roots). */
  readonly physics?: PhysicsRegistry | undefined;
  readonly collisions?: CollisionSystem | undefined;
  /** Present only when the world's mount owns a Rapier-2D world — the 2D
   *  analog of `physics` above. Kept as a separate field (not folded into
   *  `physics` as a union) so 3D call sites keep their non-union
   *  `PhysicsRegistry` typing unchanged. */
  readonly physics2d?: Physics2DRegistry | undefined;
  /** Kind-typed via `mounted` in T7.5; `unknown` here deliberately. */
  readonly camera?: unknown;
  /** Phase-partitioned frame entry point — present only for
   *  first-party mounts. `undefined` for an opaque/foreign mount, which
   *  `GameInternal.runFrame` drives via its single `mounted.update` call
   *  instead (unless it `drivesOwnLoop`, in which case it isn't ticked at
   *  all — see `runFrame`). */
  readonly frame?: RootFrameHooks | undefined;
  /** True from the moment this world's `mounted.dispose()` runs. There is no
   *  `unregisterRoot`, so a disposed world stays in `Game.roots`; `runFrame`
   *  reads this to skip it entirely — frame hooks AND the opaque
   *  `mounted.update` fallback (see the disposed-world guard in
   *  `createRootInstance`). */
  readonly disposed: boolean;
  /**
   * THIS ROOT'S WHOLE DECLARATION, BOUND — `adapter/binding.ts`'s
   * {@link RootBinding}, assembled at registration from this instance's own
   * `adapter`/`mounted`/`pausable` plus the {@link RootDeclaration} the
   * resolver produced. Every member of it is a reference to something already
   * reachable through the fields above; it is the ONE place the five protocol
   * families are addressed by name rather than re-assembled per consumer.
   *
   * `null` in exactly ONE honest case, and never as a degrade: the
   * registration carried NO declaration — a bare
   * `registerThreeRoot(game, adapter, mounted)` from a test harness, or a
   * `mountManifestRoots` caller that supplied an already-constructed adapter
   * with no entry namespace behind it. There is no manifest root, no parsed
   * definition and no entry surface to bind, and fabricating them would be
   * the anti-shim rule broken at the seam that exists to hold it. Every root
   * the editor resolves through `resolveAllRoots`/`resolveAllRootEntries`
   * carries a declaration, so its binding is non-null.
   *
   * A mount that exposes no `authoring` does NOT null this out; it costs that
   * root its `projection` and `truth` members only (see
   * {@link RootBinding.projection}). That distinction is load-bearing: the
   * editor supplies native TSX roots' authoring itself, so treating an
   * absent `mounted.authoring` as an absent BINDING made `binding` null for
   * every first-party root and left four perfectly constructible families
   * unreadable.
   */
  readonly binding: RootBinding | null;
}

/**
 * Minimal identity surface `RootInstance.adapter` needs (T7.5) — see that
 * field's doc comment for why it's narrower than `RootAdapter<K>`. Any real
 * adapter object (a NAMED type, not a fresh object literal) — `RootAdapter<K>`,
 * `Pixi2DRootAdapter`, `ReactRootAdapter`, or a project's own custom adapter —
 * satisfies this trivially (extra members beyond `id` are always fine for a
 * non-literal source); a bare `{ id, mount }` object literal built INLINE at
 * a `createRootInstance`/`registerXRoot` call site needs an intermediate
 * `const` (excess-property checking only special-cases fresh literals).
 */
export interface AdapterHandle {
  readonly id: string;
}

/** Inputs to {@link createRootInstance}. */
export interface RootInstanceInit {
  readonly id: string;
  readonly kind: AdapterSurface;
  /** Defaults to `true` (D10's per-world default). */
  readonly pausable?: boolean;
  readonly adapter: AdapterHandle;
  readonly mounted: MountedRoot;
  /** Required when `kind === 'three'` — backs `threeScene()`. */
  readonly scene?: THREE.Scene | undefined;
  /** Required when `kind === 'canvas'` — backs `canvasRoot()`, symmetric with
   * `scene` for three above. */
  readonly canvasRoot?: unknown;
  /** Required when `kind === 'dom'` — backs `reactRoot()` (T6.2 slice 1,
   *  symmetric with `scene`/`stage` above): the DOM-root layer `<div>` this
   *  world's react tree is mounted into. */
  readonly container?: HTMLElement | undefined;
  readonly physics?: PhysicsRegistry | undefined;
  readonly collisions?: CollisionSystem | undefined;
  readonly physics2d?: Physics2DRegistry | undefined;
  readonly camera?: unknown;
  readonly frame?: RootFrameHooks | undefined;
  /** This root's bound declaration — see {@link RootInstance.binding} for
   *  when it is legitimately absent. */
  readonly binding?: RootBinding | null | undefined;
}

/**
 * Build a `RootInstance` whose kind-narrowed accessors throw descriptively
 * on kind mismatch. This is the one place that builds
 * `threeScene`/`canvasRoot`, so every world (however it's constructed, in this
 * slice or later ones) gets identical throw behavior.
 */
export function createRootInstance(init: RootInstanceInit): RootInstance {
  const {
    id,
    kind,
    pausable = true,
    adapter,
    mounted,
    scene,
    canvasRoot,
    container,
    physics,
    collisions,
    physics2d,
    camera,
    frame,
    binding = null,
  } = init;

  // A three world with no scene has nothing for `threeScene()` to return —
  // fail loudly HERE, at construction, rather than letting `threeScene()`
  // throw its generic "not a three world" message later for a world whose
  // kind IS three (checklist item 5; a misleading error for this case).
  if (kind === 'three' && !scene) {
    throw new Error(
      `RootInstance "${id}" (kind: three): a three world requires a scene — ` +
        'pass `scene` in RootInstanceInit.',
    );
  }

  // Symmetric check for canvas — a canvas world with no native substrate root
  // has nothing for `canvasRoot()` to return; fail loudly here, at
  // construction, same as the three/scene check above.
  if (kind === 'canvas' && (canvasRoot === undefined || canvasRoot === null)) {
    throw new Error(
      `RootInstance "${id}" (kind: canvas): a canvas world requires a native substrate root — ` +
        'pass `canvasRoot` in RootInstanceInit.',
    );
  }

  // Symmetric check for react (T6.2 slice 1) — a react world with no
  // container has nothing for `reactRoot()` to return; fail loudly here,
  // at construction, same as the two checks above.
  if (kind === 'dom' && !container) {
    throw new Error(
      `RootInstance "${id}" (kind: react): a react world requires a container — ` +
        'pass `container` in RootInstanceInit.',
    );
  }

  // Disposed-world guard (T7.1 slice 3). There
  // is no `unregisterRoot` (decision 4 — roots are manifest-declared; a
  // whole Game is disposed, not one world out of its registry), so a caller
  // that disposes ONE world's `mounted` directly (e.g. ending a sub-session)
  // leaves that `RootInstance` sitting in `Game.roots` — and `runFrame`
  // would otherwise keep invoking its (now-torn-down) frame hooks every
  // subsequent frame. `MountedThreeRoot` has no public "am I disposed" flag to
  // read, so this wraps `mounted.dispose` in place (mutating the SAME mount
  // object every holder of `mounted` shares — calling `mounted.dispose()`
  // directly, exactly like calling `world.mounted.dispose()`, trips this)
  // to flip a flag this instance exposes as `disposed`, and wraps the frame
  // hooks so they silently no-op once it is set. `runFrame` reads `disposed`
  // and skips the world outright, which is what also covers the OPAQUE
  // `mounted.update` fallback — the path every three root takes now that a
  // mount is a plain `RootAdapter` with no phase-partitioned entry point.
  let disposed = false;
  const originalDispose = mounted.dispose.bind(mounted);
  mounted.dispose = () => {
    disposed = true;
    originalDispose();
  };
  const guardedFrame: RootFrameHooks | undefined = frame
    ? {
        runPhase(phase, dt) {
          if (disposed) return;
          frame.runPhase(phase, dt);
        },
        endFrame() {
          if (disposed) return;
          frame.endFrame?.();
        },
      }
    : undefined;

  return {
    id,
    kind,
    pausable,
    adapter,
    mounted,
    physics,
    collisions,
    physics2d,
    camera,
    frame: guardedFrame,
    binding,
    get disposed(): boolean {
      return disposed;
    },
    threeScene(): THREE.Scene {
      if (kind !== 'three' || !scene) {
        throw new Error(
          `RootInstance "${id}" (kind: ${kind}): threeScene() requested but this world is not ` +
            'a three world',
        );
      }
      return scene;
    },
    canvasRoot<T = unknown>(): T {
      if (kind !== 'canvas' || canvasRoot === undefined || canvasRoot === null) {
        throw new Error(
          `RootInstance "${id}" (kind: ${kind}): canvasRoot() requested but this world is not ` +
            'a canvas world',
        );
      }
      return canvasRoot as T;
    },
    reactRoot(): HTMLElement {
      // The `!container` branch a react world could hit here is now
      // unreachable (T6.2 slice 1): construction above throws for
      // `kind === 'dom'` with no `container`, symmetric with
      // `threeScene()`/`canvasRoot()`'s guards.
      if (kind !== 'dom' || !container) {
        throw new Error(
          `RootInstance "${id}" (kind: ${kind}): reactRoot() requested but this world is not ` +
            'a react world',
        );
      }
      return container;
    },
  };
}

/**
 * One world's half of a debris disposal, as {@link disposeDebrisSubtree} needs
 * it.
 *
 * `physics`/`rapierWorld` are OPTIONAL: an owner that builds no first-party
 * Rapier runtime (an R3F world) carries neither, and {@link
 * disposeDebrisSubtree} reads them behind `readRapierHandles` rather than
 * unconditionally.
 */
export interface DebrisOwner {
  readonly physics?: PhysicsRegistry;
  readonly rapierWorld?: import('@dimforge/rapier3d-compat').World;
}

/**
 * Read an owner's Rapier handles, treating an absent pair as "this owner holds
 * no rigid bodies" — the honest reading for a world (R3F, or a bare
 * `ComponentManager`-only owner) that builds no first-party physics runtime.
 */
function readRapierHandles(owner: DebrisOwner): {
  physics: NonNullable<DebrisOwner['physics']>;
  rapierWorld: NonNullable<DebrisOwner['rapierWorld']>;
} | null {
  const { physics, rapierWorld } = owner;
  if (!physics || !rapierWorld) return null;
  return { physics, rapierWorld };
}

/**
 * P3 — what `SimClock.disposeAfter` actually does. `core/sim-clock.ts` knows
 * only *when*; this is the *what*, and it lives here because it is the runtime
 * that knows about Rapier and shared geometry.
 *
 * The order mirrors `editor-game/src/host/roots/r3f-root.tsx`'s world teardown for
 * ONE subtree. Within the physics step,
 * `rapierWorld.removeRigidBody(body)` comes BEFORE `physics.remove(node)`: the
 * registry's `remove()` only drops index entries, so reversing the two leaks
 * the Rapier body.
 *
 * `owners` is every world that could own part of the subtree. `physics.get`
 * is a no-op for a node the
 * owner does not own, so offering the subtree to each is safe.
 *
 * Safe on an object already removed or already disposed: `removeFromParent` on
 * a parentless `Object3D` is a no-op and three's `dispose()` calls are
 * idempotent.
 */
export function disposeDebrisSubtree(
  obj: THREE.Object3D,
  owners: ReadonlyArray<DebrisOwner>,
): void {
  const nodes: THREE.Object3D[] = [];
  obj.traverse((node) => nodes.push(node));
  for (const owner of owners) {
    const rapier = readRapierHandles(owner);
    if (!rapier) continue;
    for (const node of nodes) {
      const refs = rapier.physics.get(node);
      if (!refs) continue;
      rapier.rapierWorld.removeRigidBody(refs.body);
      rapier.physics.remove(node);
    }
  }
  obj.removeFromParent();
  for (const node of nodes) {
    // Duck-typed rather than `instanceof THREE.Mesh` so this module keeps its
    // TYPE-ONLY three import (it is surface-neutral — it also hosts pixi
    // roots). Covers Points/Line/Sprite debris too, which a Mesh check would
    // silently leak.
    const drawable = node as Partial<THREE.Mesh>;
    if (!hasUserData(node, '__sharedGeometry')) drawable.geometry?.dispose();
    const material = drawable.material;
    if (Array.isArray(material)) {
      for (const m of material) m.dispose();
    } else {
      material?.dispose();
    }
  }
}

/**
 * The {@link DebrisOwner}s one registered world contributes. Written as a
 * standalone function
 * so `createGame`'s clock disposer is one line and the "which mounts count"
 * rule has exactly one home.
 */
function debrisOwnersOf(_world: RootInstance): DebrisOwner[] {
  // No mount carries first-party Rapier handles: physics is a declared
  // system built inside the world's own tree, and the library owns its
  // bodies' lifecycles there. The owner list stays as the disposal seam's
  // shape; today it is always empty.
  return [];
}

/**
 * The Game root. Owns the loop, raw-asset cache, world registry, input,
 * and game-scoped `SystemRunner`. Surface-specific capabilities remain on
 * their mounted roots or in the aggregated `SystemAdapters` contract.
 */
export interface Game {
  readonly loop: GameLoop;
  readonly assets: AssetCache;
  /** Host identity for this private play run or coordinated Team Test. */
  readonly playtest?: PlaytestContext | null;
  /** Per-game diagnostic store. Disabled by default; the editor enables it on demand. */
  readonly profiler: PerformanceProfiler;
  /**
   * The game-scoped `SystemRunner`, separate from any world's own runner.
   * Within each phase,
   * `GameInternal.runFrame` runs THIS runner's `runPhase` first, before any
   * world's engine systems/component ticks/world-bound game systems (e.g.
   * `ctx.systems.add`, which stays world-bound to the default world).
   * Empty for every existing game (nothing registers
   * against it), so an empty runner has no frame cost beyond dispatch.
   */
  readonly systems: SystemRunner;
  /** Declaration-ordered. This is the same array reference `registerRoot`
   *  mutates, not a snapshot, so holders observe
   *  later registrations. */
  readonly roots: ReadonlyArray<RootInstance>;
  world(id: string): RootInstance | null;
  /** First three world, else first world. Throws descriptively when no
   *  world has been registered yet. */
  readonly defaultRoot: RootInstance;
  /**
   * Game-scoped aggregation of every world's `SystemAdapters` (§7.1-3:
   * "`registerSystemAdapter` is game-scoped" — the recorded decision this
   * getter finally implements; probe1). Each mounted world builds its OWN
   * `mounted.systems` object (a game registers capabilities like `networking`
   * from ITS OWN `setup()`, via `ctx.registerSystemAdapter`, per-world) —
   * this merges every world's `mounted.systems` into ONE `SystemAdapters`, in
   * `roots` REGISTRATION order, first registration wins per key. A later
   * world registering the SAME kind (e.g. two roots both exposing
   * `networking`) does not override the first — instead this warns ONCE per
   * (game instance, key) naming both world ids, matching this file's `[game]
   * world "<id>" …` console idiom (see `registerRoot` below). NOT to be
   * confused with `Game.systems` (the game-scoped `SystemRunner` bucket, an
   * entirely different concept — see that field's doc comment) — this name
   * was deliberately chosen not to collide with it.
   *
   * A plain getter (recomputed on every read, not cached) so a LATER
   * `registerRoot` call (or a world's setup registering a NEW adapter kind
   * after this was first read) is always reflected — only the COLLISION
   * warning is deduped (once per key, for the lifetime of this `Game`).
   * Includes every world regardless of first-party-ness — `mounted.systems`
   * is a capability any adapter (first-party or foreign) may expose.
   */
  readonly systemAdapters: SystemAdapters;
  /** Subscribe when a mounted root registers or replaces a system adapter. */
  subscribeSystemAdapters?(listener: () => void): () => void;
  /**
   * Install a root's STATICALLY DECLARED system-adapter slots — the native
   * module surface's `export const systems` (adapter/native-debug-module.ts),
   * already validated by `contract-system-adapters.ts`. The host calls this
   * once per declaring root at mount; project components never do
   * (ARCHITECTURE-CORE §System adapters: "Components never call
   * `registerSystemAdapter`" — this door is the replacement, and the slots it
   * installs take precedence over a component registration for the same root
   * in {@link systemAdapters}'s merge, with the standard collision warning).
   * Throws on an unmounted root id or a second declaration for the same root.
   * Optional for the same reason {@link subscribeSystemAdapters} is: partial
   * `Game` doubles in tests; `installNativeSystemsBindings` refuses loudly
   * when the hosting Game lacks it.
   */
  installDeclaredSystemAdapters?(
    rootId: string,
    slots: Readonly<Partial<SystemAdapters>>,
    absent?: readonly DeclaredSystemAbsence[],
  ): void;
  /**
   * Every slot a mounted root's `systems` table answered with `absent(reason)`,
   * across all roots — the game-scoped read of the positive absences.
   *
   * This is what separates "this game has no networking" from "nobody looked",
   * and it is the ONLY source for that distinction on a native mount: the
   * adapter bag ({@link systemAdapters}) can only say a slot is unfilled, which
   * is the same shape for both. Empty means no root declared any absence — NOT
   * that every slot is answered.
   */
  readonly declaredSystemAbsences?: readonly DeclaredSystemAbsence[];
  /** Game-level play-state control surface (D10, T7.6) — see {@link PlayState}. */
  readonly play: PlayState;
  /**
   * The interpolation alpha the most recent display frame presented
   * at: `accumulator / fixedDt`, in `[0, 1]`. `0` means "exactly on the last
   * completed fixed state", `0.5` means "halfway to the next one".
   *
   * Read it to interpolate your own transforms between the last two fixed
   * states; it is the same number `onRenderStep` hands its callbacks, exposed
   * here for code that renders from somewhere other than a callback. Stays
   * `0` for a Game whose host never wired a display-rate render pass (see
   * {@link onRenderStep}).
   */
  readonly renderAlpha: number;
  /**
   * The `RenderStepped`-shaped host: register a callback that runs
   * ONCE PER DISPLAY FRAME, before that frame's `preRender`/`render` phases,
   * with `(alpha, displayDt)`.
   *
   * This is the seam for presentation-only work whose natural rate is the
   * monitor's, not the simulation's — camera polish/smoothing, procedural
   * sway, a cosmetic bob. It is NOT a gameplay hook: it can fire twice
   * between two fixed substeps (120 Hz display, 60 Hz sim) and zero times
   * across a `runTicks` fast-forward, so anything that must be deterministic
   * belongs in a fixed engine phase (`ctx.systems.add`) instead. Ecosystem
   * presentation hooks such as R3F's `useFrame` share this display clock.
   *
   * Reached from game code as `ctx.game?.onRenderStep(...)`. Returns an
   * unsubscribe function; pass `opts.signal` to unsubscribe with the same
   * `AbortSignal` a `setup()` already uses for its listeners and sim timers
   * (`core/sim-clock.ts`'s ownership section — cancelling what you registered
   * is the game's job, and a stale render-step closure is the same hazard
   * class as a stale event listener).
   *
   * Silent-no-op honesty: a callback registered on a Game whose host wired no
   * display-rate render pass (a bare test harness, a `drivesOwnLoop`-only
   * mount, an `externalDrive` capture page) never fires, because nothing
   * drives it. That is the same shape as `ctx.clock` on a Game-less mount.
   */
  onRenderStep(
    fn: (alpha: number, displayDt: number) => void,
    opts?: { signal?: AbortSignal | undefined },
  ): () => void;
}

/**
 * Host-internal extension of {@link Game}: adds `registerRoot` (the host's
 * wiring surface for populating the world registry) and `runFrame` (the
 * frame executor). NEITHER is part of the game-facing `Game` surface —
 * games never call either directly; the host loop
 * (`createGameRuntime`) and `GameSession.step()` are the only callers of
 * `runFrame`.
 */
export interface GameInternal extends Game {
  /** Host-side signal used by root contexts after `registerSystemAdapter`. */
  notifySystemAdaptersChanged(): void;
  /** Append a world in declaration order. Throws on a duplicate id. */
  registerRoot(world: RootInstance): void;
  /**
   * Run ONE fixed substep across every phase and every world:
   *
   * ```
   * for phase in PHASE_ORDER:
   *   game.systems.runPhase(phase, dt)        // game-scoped, first
   *   for world in roots (declaration order):
   *     if world.mounted.drivesOwnLoop: continue
   *     world.frame?.runPhase(phase, dt)
   * for world in roots:                       // after ALL phases
   *   if world.mounted.drivesOwnLoop: continue
   *   if world.frame: world.frame.endFrame?.()
   *   else if updateCadence != 'display' OR render phases are included:
   *     world.mounted.update?.(dt)              // opaque world fallback
   * ```
   *
   * A single first-party world and its direct `mounted.update(dt)` entry run
   * the same `SystemRunner` and `postFrame` work. A `drivesOwnLoop` world is
   * never ticked here. An opaque host-driven world (no `frame`) gets exactly
   * one `update(dt)` call per substep after the phase loop by default. A
   * display-cadence opaque world is withheld when `skipRenderPhases` is true;
   * the matching host calls it once from {@link runRenderFrame}. A direct
   * `runFrame` with render phases included still calls it once.
   *
   * D10/T7.6 play-state addendum: when `Game.play.paused` is true, every
   * `pausable` (and non-`drivesOwnLoop`) world skips every phase EXCEPT
   * `render` (still called, every substep, with `dt` forced to `0`) and skips
   * its `endFrame`/opaque-`update` call entirely — a `pausable: false` world
   * is completely unaffected. `Game.play.step()` drives this function via the
   * internal-only `onlyFrozen` mode (see `runFrameImpl` — not part of this
   * public, host-facing signature): it ticks exactly the currently
   * frozen set (host-driven, `pausable`, and `paused`) through every phase +
   * `endFrame` with the real `dt` (not the render-phase's forced `0`), and
   * touches no other world at all — a natural no-op while not paused, since
   * the frozen set is then empty.
   *
   * `opts.skipRenderPhases` omits `preRender`+`render` from
   * the pass — every other phase, and `endFrame`, run exactly as always. A
   * host that drives presentation at DISPLAY rate sets it on every substep
   * and calls {@link runRenderFrame} once per real frame instead
   * (`create-runtime.ts`). A host that does
   * not set it renders inside the substep — which is why
   * `externalDrive` capture (`render-control.ts`'s `simulateSubsteps`, which
   * calls `runFrame(fixedDt)` with no opts) is frame-exact.
   * `runTicks` sets it per tick for its `render: 'none' | 'last'` modes.
   */
  runFrame(dt: number, opts?: { skipRenderPhases?: boolean }): void;
  /**
   * Run ONE display frame's presentation pass: the registered
   * `onRenderStep` callbacks, then the `preRender` and `render` phases across
   * game-scoped systems and every host-driven world, in the same
   * game-systems-then-worlds order {@link runFrame} uses.
   *
   * ```
   * for cb in onRenderStep callbacks: cb(alpha, displayDt)
   * for phase in [preRender, render]:
   *   game.systems.runPhase(phase, displayDt)
   *   for world in roots (declaration order):
   *     if world.mounted.drivesOwnLoop: continue
   *     world.frame?.runPhase(phase, frozen ? 0 : displayDt)
   * for opaque world with updateCadence == 'display':
   *   world.mounted.update?.(frozen ? 0 : displayDt)
   * ```
   *
   * Advances NOTHING: no `tick`, no `simT`, no sim-clock flush, no `endFrame`. It is presentation only, which is what makes calling
   * it at a rate the simulation does not share safe in the first place.
   *
   * D10's pause rule carries over unchanged in substance: a frozen world
   * (paused + `pausable`) still RENDERS — that is what keeps a paused editor
   * viewport painted — but with `dt` forced to `0`, so no time-based render
   * effect animates a frozen scene. What changes is only the cadence: once per
   * display frame instead of once per fixed substep.
   */
  runRenderFrame(alpha: number, displayDt: number): void;
  /**
   * D15/T-D15.3-.4 — a deterministic fast-forward primitive: synchronously
   * call the SAME per-tick pipeline `runFrame` uses, `n` times in a tight
   * loop, with `dt` fixed to the host loop's own fixed timestep
   * (`this.loop.fixedDt` — `core/game-loop.ts`). This generalizes
   * `render-control.ts`'s proven `VgaiRenderHarness. simulateSubsteps` from
   * the capture-only door (`?vgai-render=1`) to a Game-level primitive every
   * door can reach (the bridge's `window.__vgai.runTicks`, the editor relay's
   * `run-ticks` case → `play.runTicks`) — `simulateSubsteps` itself is
   * UNTOUCHED by this addition (it may later delegate to this method; not
   * this unit's job).
   *
   * Semantics:
   * - **Decoupled from wall clock and the accumulator.** `runTicks` drives
   *   `runFrame` DIRECTLY — it never goes through `GameLoop`'s own
   *   accumulator/spiral-of-death drop path, so `n` ticks always advance
   *   `tick`/`simT` by exactly `n`/`n * fixedDt`, on any hardware, regardless
   *   of how slow or fast the call actually took wall-clock-wise. Single-
   *   threaded-burst note: because JS has one thread, this synchronous burst
   *   can never interleave with a real rAF frame — but if the host's own
   *   loop is still running (`loop.start()`), wall-clock time keeps accruing
   *   in ITS accumulator while this call executes; the NEXT rAF frame after
   *   the burst sees that gap and the loop's existing `maxAccumulator` clamp
   *   absorbs it exactly as it would absorb any other slow-frame gap (up to
   *   8 substeps, additional time dropped) — `runTicks` does not need to
   *   (and does not) touch the accumulator itself to make this safe.
   *   One consequence worth its own sentence: because the burst is one
   *   synchronous JS turn, no React commit can interleave it — a scene
   *   RELOAD triggered inside the burst (a translated
   *   `reload_current_scene`, a `SceneManager.LoadScene`) leaves the
   *   incoming world unmounted for the burst's remaining ticks, which the
   *   outgoing world's replacement therefore never simulates. Measured on
   *   the starter-kit port: a 20-tick burst spanning a reload left the
   *   fresh scene with zero ticks (its census had no player), while the
   *   same 20 ticks driven as 1-tick calls interleaved the commit and
   *   matched the source engine, whose reloads happen between frames. A
   *   caller that can trigger remounts mid-window drives 1-tick bursts
   *   (the fidelity driver's `advanceTicks` is the worked example).
   * - **`opts.render`** (default `'last'`): `'last'` skips the `preRender`/
   *   `render` phases for ticks `0..n-2` and runs the full phase list
   *   (including `preRender`/`render`) on the final tick only — the GGPO
   *   tick-without-render pattern. `'all'` renders every tick. `'none'`
   *   never renders, not even the last tick. `tick`/`simT`/the debug event
   *   ring advance identically on EVERY tick regardless of `render` — only the
   *   paint-affecting phases are skipped, so debug state providers stay correct
   *   even when fast-forwarding with no visible output.
   * - **Refuses while paused.** Throws a structured `DebugError`
   *   (`code: 'RUN_TICKS_PAUSED'`) if `Game.play.paused` is true —
   *   `Game.play.step()` owns stepping the frozen set; `runTicks` is a
   *   running-game primitive, not a paused-world stepper, and silently
   *   no-op-ing or silently ignoring pause would violate the "byte-identical
   *   across doors" contract this primitive exists to provide.
   * - **Does not bypass the input focus gate.** Every tick runs the same
   *   frame every other call to `runFrame` does; `runTicks` has no
   *   special-cased "force focus" behavior.
   */
  runTicks(n: number, opts?: RunTicksOptions): void;
  /** Release game-owned resources after every mounted root has disposed. */
  dispose(): void;
}

/**
 * Construct the (host-internal) Game shell. Callers: `createGameRuntime`
 * builds this BEFORE mounting its one adapter, then registers the default
 * three world once mount resolves (see `registerThreeRoot` in
 * `create-runtime.ts`).
 */
export function createGame(opts: {
  loop: GameLoop;
  assets: AssetCache;
  playtest?: PlaytestContext | null | undefined;
  /** D15 (T-D15.1) — the root seed `ctx.random` boots from, on every world
   *  mounted onto this Game. Defaults to `DEFAULT_SEEDED_RANDOM_SEED` (a
   *  fixed, non-wall-clock constant — `ctx.random` is always reproducible
   *  on its own terms, whether or not the project's manifest DECLARES that
   *  reproducibility as a contract). The manifest-aware boot path
   *  (`mount-manifest.ts`'s `mountManifestRoots`) is what actually resolves
   *  `manifest.determinism.defaultSeed`/`?vgai-seed=`/explicit config and
   *  passes the result here, BEFORE any world's `mount()`/`setup()` runs —
   *  `createGameRuntime` always constructs the Game (this call) first (see
   *  this function's own doc comment below). */
  seed?: number | undefined;
}): GameInternal {
  const roots: RootInstance[] = [];
  const profiler = createPerformanceProfiler();
  const systems = createSystemRunner(profiler.systemObserver, 'game');
  // D15 (T-D15.1) — the game-scoped seeded-random surface every world's
  // `ctx.random` aliases (see `editor-game/src/host/roots/r3f-root.tsx`'s `ctx.random =
  // ...`, wired the same way `ctx.debug` is just below). Constructed
  // unconditionally (cheap — a handful of closures) regardless of whether
  // this project ever declares `determinism.seededRandom`; only the BOOT
  // SEED and the enforcement (the burn-down scan, the trap right below) are
  // conditional on that declaration.
  const seededRandom = createSeededRandom(opts.seed ?? DEFAULT_SEEDED_RANDOM_SEED);
  // D15 (T-D15.3) — the dev-mode `Math.random` phase trap. Constructed
  // unconditionally too (disabled by default: `rngTrapEnabled` starts
  // `false`, so `runFrameImpl`'s enable/disable calls below are no-ops) —
  // the manifest-aware boot path flips `rngTrapControl.setEnabled(true)`
  // once it resolves `manifest.determinism?.seededRandom` (mirrors
  // `debugRegistry.setRoomDeclared` being flipped post-hoc from the same
  // boot path for the very same "only the caller who read the manifest
  // knows" reason).
  const rngTrap = createGameplayRngTrap();
  let rngTrapEnabled = false;
  const rngTrapControl = {
    setEnabled(enabled: boolean): void {
      rngTrapEnabled = enabled;
    },
    get enabled(): boolean {
      return rngTrapEnabled;
    },
  };
  // `tick` counts completed fixed substeps, `simT` accumulates their `dt` —
  // both game-scoped, advanced ONLY under `advanced` (`runFrame`'s tail below), so a paused/frozen frame never
  // advances either. The debug registry reads them via suppliers (not by
  // capturing the numbers now) so its built-in `time` provider always sees
  // the CURRENT values.
  let tick = 0;
  let simT = 0;
  // The display-rate half. `renderAlpha` is the last alpha
  // `runRenderFrameImpl` presented at (0 until a host drives one); the set is
  // the `RenderStepped`-shaped registry `Game.onRenderStep` feeds. Deliberately
  // NOT beside `tick`/`simT` in meaning: neither of these ever advances sim
  // state, which is exactly what makes running them at the monitor's rate safe.
  let renderAlpha = 0;
  const renderStepCallbacks = new Set<(alpha: number, displayDt: number) => void>();
  // P3 — the ONE sim clock this Game owns, declared beside the accumulator it
  // is bound to (`flush(simT)` runs at the tail of `runFrameImpl`, inside the
  // same `advanced` guard as the two bumps above, so a paused/frozen frame
  // fires no timers). Every world's `ctx.clock` is THIS instance, reached the
  // same way `ctx.random`/`ctx.debug` reach their game-scoped singletons —
  // `getSimClock(host.game)` over the game-scoped slot filed below.
  //
  // The disposer is supplied HERE rather than inside the clock because
  // `core/sim-clock.ts` deliberately knows nothing about Rapier or shared
  // geometry. It mirrors `editor-game/src/host/roots/r3f-root.tsx`'s world teardown
  // ordering for ONE subtree.
  const simClock: SimClockInternal = createSimClock({
    // Every mount that could own part of the subtree is offered it:
    // `physics.get` is a no-op for a node the mount does not own, so this is
    // correct with several three roots on one Game and needs no ownership
    // bookkeeping.
    dispose: (obj) => disposeDebrisSubtree(obj, roots.flatMap(debrisOwnersOf)),
  });
  const debugRegistry = createDebugRegistry({
    getTick: () => tick,
    getSimT: () => simT,
    getFixedDt: () => opts.loop.fixedDt,
    // D15/T-D15.5 — "the manifest's first/default world" for the debug
    // registry's world-addressed input-target surface: the root an unaddressed
    // `game.input.*` call reaches when several roots export an input door.
    // Use the SAME "first three world, else first world" rule
    // `requireDefaultRoot` (declared just below — safe: this closure is
    // only ever CALLED later, once at least one world has mounted) already
    // defines for `Game.defaultRoot`.
    getDefaultRootId: () => (roots.length > 0 ? requireDefaultRoot().id : null),
    // Issue #175 — the built-in `time` provider's `loopLiveness` field reads
    // the REAL loop, not any UI-level play-state store: `opts.loop` is the
    // SAME `GameLoop` this `Game`'s own `.loop` field exposes, so this
    // registry can never disagree with `game.loop.liveness` about whether
    // the loop is actually ticking.
    getLoopLiveness: () => opts.loop.liveness,
  });
  /** Whether any world advances this frame — the game-owned systems run only then. */
  let worldsAdvancing = false;

  function requireDefaultRoot(): RootInstance {
    if (roots.length === 0) {
      throw new Error('Game.defaultRoot: no roots registered yet');
    }
    return roots.find((w) => w.kind === 'three') ?? roots[0]!;
  }

  // --- Game.systemAdapters aggregation (§7.1-3, probe1) --------------------
  // Warn-once-per-colliding-key state, scoped to this Game instance (a fresh
  // Game gets a fresh warn history) — deliberately NOT reset by anything
  // short of a new `createGame` call, matching `reportedGateShortfalls`
  // above's "once per game instance" idiom.
  const warnedSystemAdapterKeys = new Set<string>();
  const systemAdapterListeners = new Set<() => void>();
  /** Per-root slots installed by `installDeclaredSystemAdapters` — the native
   *  module surface's static `systems` declaration. Merged BEFORE the same
   *  root's live `mounted.systems` below, so during migration a lingering
   *  component registration for a declared slot is shadowed (with the
   *  standard warning) rather than silently winning by running later. */
  const declaredSystemAdapters = new Map<string, Readonly<Partial<SystemAdapters>>>();
  /** Per-root POSITIVE ABSENCES from the same declaration — `absent(reason)`
   *  slots. Nothing binds them (there is nothing to bind); they are kept so a
   *  reader can tell an answered absence from an unasked question. */
  const declaredAbsences = new Map<string, readonly DeclaredSystemAbsence[]>();
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one cohesive merge-with-collision-report walk (per-world × per-source × per-key); splitting the collision-warn branch out would obscure that it's part of the same pass, not reduce real complexity
  function computeSystemAdapters(): SystemAdapters {
    // Debug is game-scoped: React hooks, probes, and the built-in time
    // provider all register with the one registry created above, regardless
    // of whether any mounted root happens to expose a `systems` object. A
    // root may still publish this SAME adapter (the first-party Three/Pixi
    // mounts do); the reference-equality branch below treats that as the
    // intentional shared registration it is.
    const result: SystemAdapters = { debug: debugRegistry.adapter };
    const ownerRootId = new Map<string, string>([['debug', '(game)']]);
    const merge = (
      owner: string,
      adapters: Readonly<Partial<SystemAdapters>>,
      quietKeys?: ReadonlySet<string>,
    ): void => {
      for (const key of Object.keys(adapters) as (keyof SystemAdapters)[]) {
        if (adapters[key] === undefined) continue;
        const existingOwner = ownerRootId.get(key);
        if (existingOwner !== undefined) {
          // Reference-equality short-circuit: two roots sharing the ONE
          // game-scoped debug registry's adapter (T1.1) both expose the SAME
          // object under `systems.debug` — that is by design, not a
          // collision, so it must never warn.
          if (result[key] === adapters[key]) continue;
          // A world's own DECLARED slot overriding that same world's
          // substrate-seeded default (the three lane pre-seeds physics/audio/
          // renderDebug into `mounted.systems`) is the door working as
          // intended, not a collision — same silence `ctx.
          // registerSystemAdapter` gives the same override. Cross-root
          // collisions still warn.
          if (quietKeys?.has(key)) continue;
          if (!warnedSystemAdapterKeys.has(key)) {
            warnedSystemAdapterKeys.add(key);
            // biome-ignore lint/suspicious/noConsole: structured, greppable — mirrors this file's own reportGateShortfallOnce's deliberate direct console.warn just above
            console.warn(
              `[game] systemAdapters: "${key}" is registered by both ${existingOwner} and ` +
                `${owner} — the FIRST registration (${existingOwner}) wins; the later ` +
                'one is shadowed (game-scoped system adapters).',
            );
          }
          continue;
        }
        // biome-ignore lint/suspicious/noExplicitAny: SystemAdapters is a plain optional-field record; the per-key copy is correct by construction (same key on both sides), just not expressible without a cast
        (result as any)[key] = adapters[key];
        ownerRootId.set(key, owner);
      }
    };
    for (const world of roots) {
      const declared = declaredSystemAdapters.get(world.id);
      if (declared) merge(`world "${world.id}" (declared systems export)`, declared);
      const adapters = world.mounted.systems;
      if (adapters) {
        merge(
          `world "${world.id}"`,
          adapters,
          declared ? new Set(Object.keys(declared)) : undefined,
        );
      }
    }
    return result;
  }

  // --- D10/T7.6 play-state (Game.play) -------------------------------------
  let paused = false;
  // Dedupe loop-gate/audio-gate shortfall warnings to ONCE per (world, kind)
  // — `pause()` fans out over every world every call; without this a
  // multi-second play session would re-log the same "can't gate" shortfall
  // every time the user hits Pause.
  const reportedGateShortfalls = new Set<string>();
  function reportGateShortfallOnce(kind: 'loop' | 'audio', worldId: string, reason: string): void {
    const key = `${kind}:${worldId}`;
    if (reportedGateShortfalls.has(key)) return;
    reportedGateShortfalls.add(key);
    const message =
      kind === 'loop'
        ? formatLoopGateMessage({ worldId, reason })
        : formatAudioGateMessage({ worldId, reason });
    // Other native `console.warn`/`console.error` call sites in this file are
    // unsuppressed and already counted in the lint baseline (see `runFrame`'s
    // impl below); this one is a NEW site, so it's suppressed to keep this
    // task's diff at zero NEW warnings.
    // biome-ignore lint/suspicious/noConsole: see comment above
    console.warn(message);
  }

  const audioMuteBeforePause = new WeakMap<AudioAdapter, boolean>();

  /** Fan out a loop-gate (self-driven roots) + audio-gate call over every
   *  `pausable` world, reporting honestly (once) wherever the capability is
   *  absent — shared by `pause()`/`resume()` below (same fan-out, opposite
   *  boolean). */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fans out TWO independent capability gates (loop, audio) with the same "call it, else report once" shape per world — splitting the two gates into separate loops would duplicate the fan-out, not reduce real complexity
  function setRootGates(next: boolean): void {
    for (const world of roots) {
      // A disposed world stays in `roots` (there is no `unregisterRoot`), and
      // its adapter's `setPaused`/`systems.audio` reach a renderer, ticker or
      // audio graph that `dispose()` already released — the same reason
      // `runFrame`/`runRenderFrame`/`runTicks` skip it. Without this, a
      // pause/resume after a partial teardown calls into freed resources, and
      // the audio leg re-mutes a context that no longer exists.
      if (world.disposed) continue;
      if (!world.pausable) continue; // pausable:false roots are untouched by design
      if (world.mounted.drivesOwnLoop) {
        if (world.mounted.setPaused) {
          world.mounted.setPaused(next);
        } else if (next) {
          reportGateShortfallOnce(
            'loop',
            world.id,
            'self-driven world, adapter declares no setPaused capability',
          );
        }
      }
      // A native entry's static `systems` export is this root's primary
      // declaration surface. `computeSystemAdapters()` already gives it
      // precedence over a substrate-seeded mounted adapter; pause must read
      // the same source or a valid entry-declared audio graph is visible to
      // the editor yet paradoxically reported as ungateable here.
      const audio = declaredSystemAdapters.get(world.id)?.audio ?? world.mounted.systems?.audio;
      if (audio) {
        if (next) {
          if (!audioMuteBeforePause.has(audio)) audioMuteBeforePause.set(audio, audio.isMuted());
          audio.setMuted(true);
        } else if (audioMuteBeforePause.has(audio)) {
          audio.setMuted(audioMuteBeforePause.get(audio)!);
          audioMuteBeforePause.delete(audio);
        }
      } else if (
        next &&
        !declaredAbsences.get(world.id)?.some((absence) => absence.slot === 'audio')
      ) {
        reportGateShortfallOnce('audio', world.id, 'no SystemAdapters.audio on this world');
      }
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the frame algorithm (now with D10's per-world pause gate + the onlyFrozen step()-only mode) is one cohesive nested loop over phases/roots — splitting it would obscure the ordering contract documented on GameInternal.runFrame
  function runFrameImpl(
    dt: number,
    frameOpts?: { onlyFrozen?: boolean; skipRenderPhases?: boolean },
  ): void {
    // D15 (T-D15.3) — brackets the ENTIRE frame body (every phase, every
    // world, both the `onlyFrozen` and normal branches below converge on the
    // single `profiler.endFrame()` at the tail) with zero reordering of the
    // phase algorithm itself — a no-op pair of calls while
    // `rngTrapEnabled` is false (the common case: most projects never
    // declare `determinism.seededRandom`).
    if (rngTrapEnabled) rngTrap.enable();
    profiler.beginFrame();
    // The render-phase skip. Two callers set it, for the
    // same reason — this substep is not the thing that paints. `runTicks`'s
    // `render: 'none'|'last'` fast-forward sets it on every tick it doesn't
    // want to paint (see `runTicks`'s doc comment on `GameInternal`), and a
    // DISPLAY-RATE host sets it on every substep because `runRenderFrame`
    // paints once per real frame instead. Unlike `onlyFrozen` below it is not
    // internal-only: it is part of the public `GameInternal.runFrame`
    // signature, since an external host is one of those two callers.
    const skipRenderPhases = frameOpts?.skipRenderPhases ?? false;
    // `onlyFrozen` is internal-only (not part of the public `GameInternal.runFrame`
    // signature — no external caller sets it) — `Game.play.step()` below is the
    // one and only caller. It ticks EXACTLY the currently-frozen set (host-driven,
    // `pausable`, and `paused`) through every phase + `endFrame`, with the REAL
    // `dt` (not the render-phase's forced `0`), and touches no other world at all
    const onlyFrozen = frameOpts?.onlyFrozen ?? false;
    // Checklist item 7: snapshot the world count ONCE at entry and iterate
    // by index in both loops below. A world registered mid-frame (e.g. from
    // a game-scoped system's side effect) joins at the NEXT `runFrame` call,
    // not this one — `for (const world of roots)` would otherwise pick up
    // a world pushed during this very frame. This also drops the two
    // per-phase `for...of` iterator allocations.
    const n = roots.length;
    worldsAdvancing = false;
    for (let i = 0; i < n; i++) {
      const world = roots[i]!;
      if (world.disposed) continue;
      if (onlyFrozen) {
        if (paused && world.pausable && !world.mounted.drivesOwnLoop) {
          worldsAdvancing = true;
          break;
        }
      } else if (
        world.mounted.drivesOwnLoop
          ? !paused || !world.pausable || !world.mounted.setPaused
          : !paused || !world.pausable
      ) {
        worldsAdvancing = true;
        break;
      }
    }

    // §7.1-11 fix (probe5): the frame's tail (tick, sim time, timers) runs iff
    // at least one world actually advanced this call — not unconditionally. `advanced`
    // covers rule (a) below (host-driven roots this call actually ticked);
    // rule (b): a self-driven world that is RUNNING — which is every
    // self-driven world while not paused, and, while paused, the ones the
    // gate can't reach (`pausable: false`, or no `setPaused` capability) —
    // checked once, up front, over the same `roots` array (no extra
    // allocation, matching every other loop here). Rule (b) is skipped in
    // `onlyFrozen` mode: a `step()` call advances iff it ticked a frozen world
    // — self-driven notifications belong to the loop's own `runFrame`s.
    let advanced = false;
    if (!onlyFrozen) {
      for (let i = 0; i < n; i++) {
        const world = roots[i]!;
        if (world.disposed) continue;
        if (!world.mounted.drivesOwnLoop) continue;
        if (!paused || !world.pausable || !world.mounted.setPaused) {
          advanced = true;
          break;
        }
      }
    }

    if (onlyFrozen) {
      // step(): the frozen set is host-driven + pausable + currently paused.
      // While NOT paused this set is empty by construction, so this whole
      // branch is a natural no-op — `Game.play.step()`'s "no-op while
      // running" behavior falls straight out of this, no separate guard
      // needed.
      for (const phase of PHASE_ORDER) {
        profiler.beginPhase();
        // Game-owned systems follow the same one-run-per-phase contract as a
        // normal frame whenever Step advances at least one frozen world.
        if (worldsAdvancing) systems.runPhase(phase, dt);
        for (let i = 0; i < n; i++) {
          const world = roots[i]!;
          if (world.disposed) continue;
          if (world.mounted.drivesOwnLoop) continue;
          if (!(paused && world.pausable)) continue; // only the frozen set
          try {
            world.frame?.runPhase(phase, dt);
          } catch (err) {
            console.error(
              `[game] world "${world.id}" (kind: ${world.kind}) runPhase("${phase}") threw ` +
                '(step()):',
              err,
            );
          }
        }
        profiler.endPhase(phase);
      }
      for (let i = 0; i < n; i++) {
        const world = roots[i]!;
        if (world.disposed) continue;
        if (world.mounted.drivesOwnLoop) continue;
        if (!(paused && world.pausable)) continue;
        advanced = true;
        if (world.frame) {
          try {
            world.frame.endFrame?.();
          } catch (err) {
            console.error(
              `[game] world "${world.id}" (kind: ${world.kind}) endFrame() threw (step()):`,
              err,
            );
          }
        } else {
          try {
            world.mounted.update?.(dt);
          } catch (err) {
            console.error(
              `[game] world "${world.id}" (kind: ${world.kind}) update() threw (step()):`,
              err,
            );
          }
        }
      }
    } else {
      for (const phase of PHASE_ORDER) {
        profiler.beginPhase();
        // D15/T-D15.4: `runTicks`'s fast-forward skip — `preRender`/`render`
        // are the ONLY phases ever skipped this way (every earlier gameplay
        // phase, and `endFrame` below, always run) — see `skipRenderPhases`'s
        // declaration above and `runTicks`'s doc comment on `GameInternal`.
        const skipThisPhase =
          skipRenderPhases && (phase === SystemPhase.PRE_RENDER || phase === SystemPhase.RENDER);
        if (!skipThisPhase) {
          systems.runPhase(phase, dt);
          for (let i = 0; i < n; i++) {
            const world = roots[i]!;
            if (world.disposed) continue;
            if (world.mounted.drivesOwnLoop) continue;
            // D10/T7.6: a `pausable` world under an active pause
            // skips every phase except `render` — its render still runs, every
            // substep, but with `dt` forced to `0` (deterministic: no
            // time-based render effect silently keeps animating a "frozen"
            // scene). A `pausable: false` world is unaffected.
            const frozen = paused && world.pausable;
            if (frozen && phase !== SystemPhase.RENDER) continue;
            const phaseDt = frozen ? 0 : dt;
            // Checklist item 2: isolate each world's per-phase work — one
            // world's `runPhase` throwing must not starve sibling roots still
            // due this phase, nor abort the frame. Mirrors `runOne`'s style in
            // `core/system-runner.ts` (loud console.error, never swallowed).
            try {
              world.frame?.runPhase(phase, phaseDt);
            } catch (err) {
              console.error(
                `[game] world "${world.id}" (kind: ${world.kind}) runPhase("${phase}") threw:`,
                err,
              );
            }
          }
        }
        profiler.endPhase(phase);
      }
      for (let i = 0; i < n; i++) {
        const world = roots[i]!;
        if (world.disposed) continue;
        if (world.mounted.drivesOwnLoop) continue;
        // A fully-frozen world gets no `endFrame`/opaque-`update` call either —
        // there is nothing to "end the frame" of when nothing ran this substep.
        const frozen = paused && world.pausable;
        if (frozen) continue;
        advanced = true;
        if (world.frame) {
          try {
            world.frame.endFrame?.();
          } catch (err) {
            console.error(
              `[game] world "${world.id}" (kind: ${world.kind}) endFrame() threw:`,
              err,
            );
          }
        } else {
          // Checklist item 2: same isolation for the opaque-world fallback —
          // one foreign mount's `update` throwing must not starve its
          // siblings' `endFrame`/`update` calls this same loop.
          // A display-cadence opaque update is the root's indivisible native
          // presentation (R3F `advance()` is callbacks + draw). The real
          // rAF host withholds render phases from EVERY fixed catch-up step;
          // withhold this update beside them, then run it once in
          // `runRenderFrameImpl`. A direct/offline `runFrame` includes render
          // phases and therefore still advances the root exactly once.
          if (!(skipRenderPhases && world.mounted.updateCadence === 'display')) {
            try {
              world.mounted.update?.(dt);
            } catch (err) {
              console.error(
                `[game] world "${world.id}" (kind: ${world.kind}) update() threw:`,
                err,
              );
            }
          }
        }
      }
    }

    // The frame's tail runs LAST, after every phase of every world and every
    // world's endFrame/update above, at most once per completed
    // `runFrame`/`step()` call and, per §7.1-11's fix, only when `advanced`
    // (see above) is true: a fully-gated paused game advances nothing.
    if (advanced) {
      tick++;
      simT += dt;
      // P3 — sim timers fire IMMEDIATELY after the bump, inside this same
      // `advanced` guard: a paused/frozen world advances no sim time, so it
      // must fire no timers either, and `Game.play.step()` (which reaches this
      // block with `advanced` set by the frozen-set loop above) fires exactly
      // the timers that ONE substep makes due. One flush === one completed
      // substep, which is what lets `SimClock.tickNow()` simply count flushes
      // and always agree with `tick`.
      simClock.flush(simT);
    }
    profiler.endFrame();
    if (rngTrapEnabled) rngTrap.disable();
  }

  /**
   * One display frame's PRESENTATION pass. See
   * `GameInternal.runRenderFrame`'s doc comment for the contract; this is the
   * `preRender`+`render` slice of `runFrameImpl`'s phase loop, lifted out and
   * driven by the loop's own per-real-frame callback instead of by the substep
   * loop.
   *
   * Three deliberate parallels with `runFrameImpl`, so the two passes cannot
   * drift into different rules for the same situation:
   *  - game-scoped systems run before per-world hooks, per phase;
   *  - one world's throw is logged and isolated, never allowed to starve a
   *    sibling still due this phase;
   *  - the RNG trap brackets the whole pass, so `Math.random` called from a
   *    render-phase system is still caught by D15's dev-mode trap — it was,
   *    back when this pass lived inside `runFrame`, and moving code must not
   *    quietly move it out from under a guard.
   *
   * Profiler note (a real, accepted consequence): the profiler's "frame" has
   * always meant "one `runFrame` call", so a display frame now produces the
   * substep records it always did PLUS one record for this pass, carrying the
   * `preRender`/`render` spans and the renderer counters. Re-modelling the
   * profiler's frame boundary around the display frame is a separate change to
   * a debugging surface, not part of flipping the loop.
   */
  function runRenderFrameImpl(alpha: number, displayDt: number): void {
    renderAlpha = alpha;
    if (rngTrapEnabled) rngTrap.enable();
    profiler.beginFrame();

    // `RenderStepped` first: a camera adjusted here is drawn by THIS frame's
    // render phase, not next frame's. Iterated over a snapshot so a callback
    // that unsubscribes itself (or registers another) cannot mutate the set
    // mid-iteration.
    if (renderStepCallbacks.size > 0) {
      for (const fn of [...renderStepCallbacks]) {
        try {
          fn(alpha, displayDt);
        } catch (err) {
          console.error('[game] an onRenderStep callback threw:', err);
        }
      }
    }

    const n = roots.length;
    for (const phase of DISPLAY_RATE_PHASES) {
      profiler.beginPhase();
      systems.runPhase(phase, displayDt);
      for (let i = 0; i < n; i++) {
        const world = roots[i]!;
        if (world.disposed) continue;
        if (world.mounted.drivesOwnLoop) continue;
        // D10/T7.6, carried over verbatim in substance: a frozen world still
        // renders (a paused viewport stays painted) but with `dt` forced to
        // `0`, and skips every other phase.
        const frozen = paused && world.pausable;
        if (frozen && phase !== SystemPhase.RENDER) continue;
        try {
          world.frame?.runPhase(phase, frozen ? 0 : displayDt);
        } catch (err) {
          console.error(
            `[game] world "${world.id}" (kind: ${world.kind}) runPhase("${phase}") threw ` +
              '(display frame):',
            err,
          );
        }
      }
      profiler.endPhase(phase);
    }

    // An opaque display-cadence root cannot expose phase hooks because its
    // native advance is inseparable. It still belongs to THIS presentation
    // frame, once — never to every fixed catch-up substep that preceded it.
    // A frozen world redraws at dt=0, preserving the established pause rule.
    for (let i = 0; i < n; i++) {
      const world = roots[i]!;
      if (world.disposed) continue;
      if (world.mounted.drivesOwnLoop) continue;
      if (world.frame) continue;
      if (world.mounted.updateCadence !== 'display') continue;
      const frozen = paused && world.pausable;
      try {
        world.mounted.update?.(frozen ? 0 : displayDt);
      } catch (err) {
        console.error(
          `[game] world "${world.id}" (kind: ${world.kind}) update() threw (display frame):`,
          err,
        );
      }
    }

    profiler.endFrame();
    if (rngTrapEnabled) rngTrap.disable();
  }

  const gameInternal: GameInternal = {
    loop: opts.loop,
    assets: opts.assets,
    playtest: opts.playtest ?? null,
    profiler,
    systems,
    get roots() {
      return roots;
    },
    world(id: string): RootInstance | null {
      return roots.find((w) => w.id === id) ?? null;
    },
    get defaultRoot() {
      return requireDefaultRoot();
    },
    get systemAdapters() {
      return computeSystemAdapters();
    },
    subscribeSystemAdapters(listener: () => void) {
      systemAdapterListeners.add(listener);
      return () => systemAdapterListeners.delete(listener);
    },
    notifySystemAdaptersChanged() {
      for (const listener of systemAdapterListeners) listener();
    },
    get declaredSystemAbsences() {
      return [...declaredAbsences.values()].flat();
    },
    installDeclaredSystemAdapters(
      rootId: string,
      slots: Readonly<Partial<SystemAdapters>>,
      absent: readonly DeclaredSystemAbsence[] = [],
    ) {
      const root = roots.find((w) => w.id === rootId);
      if (!root) {
        throw new Error(
          `installDeclaredSystemAdapters: no mounted root is named "${rootId}" ` +
            `(mounted: ${roots.map((w) => `"${w.id}"`).join(', ') || 'none'}).`,
        );
      }
      if (declaredSystemAdapters.has(rootId)) {
        throw new Error(
          `installDeclaredSystemAdapters: root "${rootId}" already installed its declared ` +
            'systems — a declaration is static and installs exactly once per mount.',
        );
      }
      const scope = root.mounted.systemScope ?? root.mounted;
      const bound = Object.fromEntries(
        Object.entries(slots).map(([key, adapter]) => [
          key,
          adapter === undefined ? undefined : bindScopedSystem(adapter, scope),
        ]),
      ) as Partial<SystemAdapters>;
      declaredSystemAdapters.set(rootId, bound);
      // ALWAYS set, never merge: a re-install (an HMR of the entry's `systems`
      // table) that dropped an `absent()` marker must also drop the recorded
      // absence, or the coverage report keeps printing a game statement the
      // game no longer makes.
      declaredAbsences.set(rootId, absent);
      gameInternal.notifySystemAdaptersChanged();
    },
    play: {
      get paused() {
        return paused;
      },
      pause() {
        if (paused) return;
        paused = true;
        setRootGates(true);
      },
      resume() {
        if (!paused) return;
        paused = false;
        setRootGates(false);
      },
      step(dt = 1 / 60) {
        // Self-driven pausable roots advance via their adapter's `step()`
        // capability — but only the ones that are actually FROZEN: the game
        // must be paused, and the world must have been gate-able in the
        // first place (`setPaused` present — a world the gate couldn't reach
        // never stopped, so "stepping" it would double-tick a still-running
        // loop, the same §7.1-2 class as the host-driven fix below). While
        // not paused, nothing here runs — step() is a whole-call no-op.
        if (paused) {
          for (const world of roots) {
            // Same disposed-world guard `runFrameImpl` (and `setRootGates`)
            // make: a disposed world's `mounted.step` drives a loop whose
            // resources are already freed.
            if (world.disposed) continue;
            if (!world.pausable || !world.mounted.drivesOwnLoop) continue;
            if (!world.mounted.setPaused) continue; // never gated — still running
            if (world.mounted.step) {
              world.mounted.step();
            } else {
              reportGateShortfallOnce(
                'loop',
                world.id,
                'self-driven world, adapter declares no step capability',
              );
            }
          }
        }
        // Tick exactly the frozen (host-driven, pausable, paused) set.
        runFrameImpl(dt, { onlyFrozen: true });
      },
    },
    registerRoot(world: RootInstance): void {
      if (roots.some((w) => w.id === world.id)) {
        throw new Error(`Game.registerRoot: duplicate world id "${world.id}"`);
      }
      // Checklist item 6: the SAME `mounted` object registered under two
      // world ids would be double-ticked by `runFrame` (its `frame.runPhase`/
      // `endFrame` called once per registration) and double-dispose-wrapped
      // (`createRootInstance` wraps `mounted.dispose` in place — a second
      // wrap would flip `disposed` and call through on ITS OWN wrapped
      // `originalDispose`, which would be harmless only if the adapter's
      // dispose happened to be idempotent; a foreign adapter
      // has no such guarantee). Reject it outright instead.
      if (roots.some((w) => w.mounted === world.mounted)) {
        throw new Error(
          `Game.registerRoot: world "${world.id}" shares its \`mounted\` object with an ` +
            `already-registered world ("${roots.find((w) => w.mounted === world.mounted)!.id}") — ` +
            'the same mount cannot be registered twice.',
        );
      }
      roots.push(world);
      gameInternal.notifySystemAdaptersChanged();
      // T7.4 slice 2: a self-driven mount with no `observe` has no state
      // bridge at all — the editor's observations cannot read it, and
      // silently returning `undefined` forever would hide that. Report ONCE
      // per mount, at registration time, matching this file's existing
      // `[game] world "<id>" (kind: <kind>) ...` console idiom (see
      // `runFrame` below).
      //
      // §7.1-15: a `kind: 'dom'` world is exempt — it has no `observe`
      // BY DESIGN (its state is its own React tree's). Without
      // this exemption every production react world logged a false-positive
      // "no state bridge" warning at registration (probe: every real react
      // world mount), eroding the signal for a genuinely un-observable
      // ingested world.
      // A HOST-DRIVEN mount (`drivesOwnLoop: false`, notably the R3F adapter)
      // ticks inside `runFrame`, where the editor reads it directly; requiring
      // an `observe` bridge there produces a false warning.
      if (world.mounted.drivesOwnLoop && world.kind !== 'dom' && !world.mounted.observe) {
        console.warn(
          `[game] world "${world.id}" (kind: ${world.kind}, adapter: "${world.adapter.id}"): ` +
            'no state bridge — this mounted game has no `observe` (RootStateObserver); ' +
            "the editor's observations cannot subscribe to its state.",
        );
      }
    },
    runFrame(dt: number, frameOpts?: { skipRenderPhases?: boolean }): void {
      runFrameImpl(dt, frameOpts);
    },
    runRenderFrame(alpha: number, displayDt: number): void {
      runRenderFrameImpl(alpha, displayDt);
    },
    get renderAlpha() {
      return renderAlpha;
    },
    onRenderStep(
      fn: (alpha: number, displayDt: number) => void,
      stepOpts?: { signal?: AbortSignal | undefined },
    ): () => void {
      const signal = stepOpts?.signal;
      // Already-aborted is a no-op registration, never a throw — the same
      // `AbortSignal` contract `SimClock.after` honors.
      if (signal?.aborted) return () => {};
      renderStepCallbacks.add(fn);
      let detachAbort: (() => void) | null = null;
      const unsubscribe = (): void => {
        renderStepCallbacks.delete(fn);
        detachAbort?.();
        detachAbort = null;
      };
      if (signal) {
        signal.addEventListener('abort', unsubscribe, { once: true });
        detachAbort = (): void => signal.removeEventListener('abort', unsubscribe);
      }
      return unsubscribe;
    },
    runTicks(n: number, ticksOpts?: RunTicksOptions): void {
      if (!Number.isInteger(n) || n < 0) {
        throw new RangeError(`Game.runTicks: n must be a non-negative integer, got ${n}`);
      }
      // Refuse while paused (D15 §2.b): stepping the frozen set is
      // `Game.play.step()`'s contract, not this one's — see `runTicks`'s doc
      // comment on `GameInternal` above.
      if (paused) {
        throw new DebugError(
          'RUN_TICKS_PAUSED',
          'Game.runTicks: refused — Game.play.paused is true; stepping the frozen set is ' +
            "Game.play.step()'s contract, not runTicks'",
        );
      }
      const render = ticksOpts?.render ?? 'last';
      const fixedDt = opts.loop.fixedDt;
      for (let i = 0; i < n; i++) {
        const isFinalTick = i === n - 1;
        const skipRenderPhases = render === 'all' ? false : render === 'none' ? true : !isFinalTick;
        runFrameImpl(fixedDt, { skipRenderPhases });
      }
    },
    dispose(): void {
      // P3 — the sim clock is GAME-scoped, so this is the only correct place to
      // dispose it: `create-runtime.ts`'s `fullCleanup` calls us after EVERY
      // root's `mounted.dispose()`, whereas a per-root teardown may be ending
      // just one sub-session while sibling roots keep running (see the
      // disposed-world guard in `runFrame`). It used to be disposed from
      // `editor-game/src/host/roots/r3f-root.tsx`'s teardown, which meant disposing one of
      // two three roots froze `now()` for the whole Game, rejected the other
      // world's pending `delay`s and turned its `after()` calls into silent
      // no-ops. Note the asymmetry that gives the bug away: `seededRandom` and
      // `debugRegistry` are game-scoped too, and per-root teardown has never
      // destroyed either — only ever `strip(this.id)`, its own slice.
      simClock.dispose();
      debugRegistry.strip();
    },
  };

  // Filed AFTER the shell exists (the slot lives on the Game object
  // itself) so `getDebugRegistry(game)` — the react hooks' and any later
  // consumer's reach-in — works from the moment `createGame` returns.
  registerDebugRegistry(gameInternal, debugRegistry);
  // D15/T-D15.4: wire the run-ticks target the instant the Game shell exists
  // (unlike `setVirtualInputTarget`, which waits for a per-world mount, a
  // Game's own `runTicks` needs nothing else) — this is what makes
  // `window.__vgai.runTicks` (`debug-bridge.ts`) and the editor relay's
  // `run-ticks` case reach the SAME implementation `game.runTicks` above is.
  debugRegistry.setRunTicksTarget({ runTicks: gameInternal.runTicks });
  // D15 (T-D15.1/.3) — same "file after the shell exists" ordering as the
  // debug registry above: `getSeededRandom(game)`/`getGameplayRngTrapControl
  // (game)` (per-world `ctx.random` wiring, and the manifest-aware boot
  // path's post-hoc `setEnabled` call) both work from the moment
  // `createGame` returns.
  registerSeededRandom(gameInternal, seededRandom);
  registerGameplayRngTrapControl(gameInternal, rngTrapControl);
  // P3 — same "file after the shell exists" ordering: `getSimClock(game)` is
  // how every world's mount resolves `ctx.clock` to THIS game's one clock.
  registerSimClock(gameInternal, simClock);

  return gameInternal;
}
