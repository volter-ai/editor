/**
 * RootAdapter — the host ⇄ runtime contract. A ROOT is *anything that mounts*.
 *
 * This is the interface the host depends on. First-party content and
 * unmodified external games are peer root adapters. A game is the
 * manifest's complete roots array, while each adapter owns exactly one
 * root.
 */

import type { AdapterSurface } from './adapter-surface';
import type { AuthoringAdapter } from './authoring';
import type { HostContextFor } from './host-context';
import type { WorldRendererConfig } from './renderer-config';
import type { SystemAdapters } from './system-adapter';

/**
 * The ingested-world observation contract (T7.4 slice 2, "the
 * must-answer"). Cross-world data flow with a
 * foreign game is observation via an adapter-provided interface, not ordinary
 * shared state (that's D7's answer for first-party↔first-party flow).
 * Optional on {@link MountedThreeRoot} —
 * absence means the adapter has nothing genuinely observable to expose (the
 * anti-shim rule: never fabricate state), and the world takes the honest
 * "no state bridge" tier hit (see `Game.registerRoot` in `runtime/game.ts`)
 * rather than silently offering an `undefined`-forever subscription.
 */
export interface RootStateObserver {
  /**
   * Notified at most once per frame IF the adapter can hook the game's own
   * update (`loop: 'gated'` roots, §(d)); self-driven roots (`loop:
   * 'self-driven'`, raw-rAF) may notify on their OWN rAF cadence instead —
   * consumers must not assume our frame timing. Returns an unsubscribe
   * function.
   */
  subscribe(onChange: () => void): () => void;
  /**
   * A cheap, adapter-chosen snapshot of this world's observable state.
   * Returns a STABLE reference while nothing has changed (so a selector run
   * over it can cheaply bail out by reference, same spirit as
   * `GameStateBridge`'s frame-version cache). Shape is adapter-defined —
   * not centrally schematized in v1.
   */
  snapshot(): unknown;
}

/**
 * Everything a mounted world provides except its render surface. Tagged
 * mounted-root variants carry their native surface fields: a Three scene and
 * camera, a declared canvas substrate root, or a DOM container.
 */
export interface MountedRootBase {
  /**
   * Loop model:
   *  - `false` (host-driven): first-party + "clean" externals. The host ticks
   *    `update(dt)` in its loop.
   *  - `true` (self-driven): an unmodified game that owns its renderer + rAF.
   *    The host does NOT tick it. Pause/step control is a DECLARED CAPABILITY,
   *    not a promise: implement `setPaused`/`step` only where the game exposes
   *    a sanctioned pause/step mechanism. Gating a raw-rAF loop from outside
   *    was demonstrated and REJECTED (D5 — it halts the loop rather than
   *    pausing it). Where `setPaused` is absent the host reports the
   *    shortfall loudly, naming the mechanism that would close it (T7.6).
   */
  readonly drivesOwnLoop: boolean;

  /**
   * Which host clock owns an opaque mounted root's single `update(dt)` hook.
   *
   * `fixed` (the default) preserves the adapter seam's original contract:
   * the callback runs once per consumed simulation substep. `display` is for
   * a reconciler whose one native advance is inseparably BOTH its callbacks
   * and its draw (React Three Fiber's `advance()` is the measured case). The
   * real host then withholds it from fixed catch-up substeps and invokes it
   * exactly once from the display pass. A direct/offline `runFrame` that does
   * not skip render phases still invokes it once, preserving capture and
   * explicit-tick semantics.
   *
   * Absent means `fixed`. This changes no foreign/ingest adapter unless that
   * adapter opts in explicitly.
   */
  readonly updateCadence?: 'fixed' | 'display';

  update?(dt: number): void; // host-driven only
  fixedUpdate?(dt: number): void;
  setPaused?(paused: boolean): void; // capability, not promise — see loop-model note above
  step?(): void;

  resize?(width: number, height: number): void;
  dispose(): void;
  /** Resolves after an asynchronous native reconciler has run every component
   * cleanup started by {@link dispose}. Omitted by synchronously-disposing
   * roots. Hosts use this before auditing/reclaiming realm-owned resources. */
  readonly disposeComplete?: Promise<void>;

  /** Optional capability providers — absence = "not supported", host degrades. */
  readonly authoring?: AuthoringAdapter;
  readonly systems?: SystemAdapters;
  /** Adapter-owned evaluation identity used to bind static system factories. */
  readonly systemScope?: object;
  /** Optional state-observation capability (T7.4 slice 2, §4) — absent means
   *  "no state bridge"; `Game.registerRoot` reports this loudly, once, for
   *  self-driven mount. A host-driven mount ticks inside the game's frame,
   *  where the editor reads it directly, so it needs none. */
  readonly observe?: RootStateObserver;
}

/** A live, mounted Three world. The host obtains `scene`/`camera` to render
 * and author it; they are opaque here, and `@volter/editor-threejs` names the
 * Three-typed root. */
export interface MountedThreeRoot<Scene = unknown, Camera = unknown> extends MountedRootBase {
  readonly kind: 'three';
  /** The live scene + camera the editor inspects/renders for authoring. */
  readonly scene: Scene;
  readonly camera: Camera;
  /**
   * The colour pipeline this world was authored for, REPORTED rather than
   * applied — the adapter has already applied it to the renderer its own host
   * handed it (`./renderer-config.ts`).
   *
   * It is here because the host that MOUNTS a world is not always the host
   * that DRAWS it. The editor's design session mounts against a
   * non-rasterizing renderer on purpose and then draws the mounted scene with
   * the editor viewport's own `WebGLRenderer`, so the world's declaration
   * lands on a surface with no pixels while the surface with pixels never
   * hears it. Reporting the declaration is what lets that host apply the same
   * config, through the same `applyWorldRendererConfig`, to the renderer that
   * actually produces the frame.
   *
   * Absent means the world declared nothing and the drawing host should leave
   * its own configuration alone — the same "absent = don't touch" rule the
   * config's own fields follow.
   */
  readonly rendererConfig?: WorldRendererConfig | undefined;
}

/**
 * A canvas substrate's native root, carried without teaching the universal
 * host that substrate's API. The declaration is explicit — editor substrate
 * adapters dispatch on `name`; they never infer a library from object shape.
 */
export interface MountedCanvasSubstrate<T = unknown> {
  readonly name: string;
  readonly root: T;
  /** The substrate's own module namespace when authoring needs constructors
   * (for example Babylon's native GizmoManager). Omitted when the projection
   * only needs the root itself, as Pixi's does. */
  readonly api?: unknown;
}

/** A live, mounted canvas world. The host owns the canvas and lifecycle; the
 * mounted root states which native substrate inhabits it and hands that
 * substrate's root through opaquely. */
export interface MountedCanvasRoot extends MountedRootBase {
  readonly kind: 'canvas';
  /** The same host-owned canvas passed to `mount`. */
  readonly canvas: HTMLCanvasElement;
  readonly substrate: MountedCanvasSubstrate;
}

/** A live, mounted react world (T6.2) — the react analog of
 *  {@link MountedThreeRoot}. `container` is the DOM-root layer the host
 *  handed the adapter's `mount` (the SAME element `RootInstance.reactRoot()`
 *  returns) — a react world's tree renders into it via `createRoot`. */
export interface MountedReactRoot extends MountedRootBase {
  readonly kind: 'dom';
  readonly container: HTMLElement;
}

/** Every kind of live, mounted world. */
export type MountedRoot = MountedThreeRoot | MountedCanvasRoot | MountedReactRoot;

/** Map a {@link AdapterSurface} to its mounted-world shape — lets generic
 *  code over
 *  `K extends AdapterSurface` name the right surface without a manual union. */
export type MountedRootFor<K extends AdapterSurface> = K extends 'three'
  ? MountedThreeRoot
  : K extends 'canvas'
    ? MountedCanvasRoot
    : K extends 'dom'
      ? MountedReactRoot
      : never;

/**
 * The interface every root implements to run on the host. Generic over
 * {@link AdapterSurface} so `mount` receives and returns its native surface
 * types. Bare `RootAdapter` denotes the first-party Three surface.
 *
 * `K` parameterizes both halves of `mount`: `HostContextFor<K>` selects the
 * host context and `MountedRootFor<K>` selects the mounted result. Production
 * adapters are genuine `RootAdapter<K>` subtypes —
 * `Pixi2DRootAdapter extends RootAdapter<'canvas'>`, `ReactRootAdapter extends
 * RootAdapter<'dom'>` (`runtime/create-runtime.ts`).
 */
/**
 * The `= 'three'` default is type-level only: an author who writes bare
 * `RootAdapter` for
 * a pixi root gets a compile error on `mount`'s return type, because
 * `MountedRootFor<'three'>` demands `scene`/`camera` a `MountedCanvasRoot` has
 * not got.
 */
export interface RootAdapter<K extends AdapterSurface = 'three'> {
  /** Stable id (telemetry/registry/conformance). */
  readonly id: string;
  /** Build/start the game against the host context for ITS surface; return the
   *  handle. */
  mount(host: HostContextFor<K>): Promise<MountedRootFor<K>>;
}

/**
 * One surface tag paired with an adapter typed FOR that surface.
 *
 * A resolver that turns a manifest root into a mountable
 * adapter handles every surface in one function, so its return type has to
 * span all three. Returning the bare union `RootAdapter<'three'> |
 * RootAdapter<'canvas'> | RootAdapter<'dom'>` does NOT work — a union of
 * function types INTERSECTS its parameters, so `.mount(host)` becomes
 * uncallable with any single host value (no one object is simultaneously a
 * `ThreeHostContext`, a `CanvasHostContext` and a `DomHostContext`).
 *
 * Carrying the tag ALONGSIDE the adapter fixes that structurally: this is a
 * discriminated union on `surface`, so `switch (resolved.surface)` narrows
 * `resolved.adapter` to ONE `RootAdapter<K>` inside each branch — a single
 * signature again, hence `.mount(host)` is callable with that surface's own
 * host context, checked by the compiler instead of asserted.
 */
export type SurfaceAdapterFor<K extends AdapterSurface> = {
  readonly surface: K;
  readonly adapter: RootAdapter<K>;
};

/** Every surface's {@link SurfaceAdapterFor}, as one discriminated union.
 *  Written out member-by-member (rather than as a distributive conditional)
 *  so `assertNever` sees exactly three variants and a hypothetical 4th
 *  `AdapterSurface` member fails to compile HERE, at the vocabulary, rather
 *  than silently widening every consumer's exhaustiveness guard. */
export type SurfaceAdapter =
  | SurfaceAdapterFor<'three'>
  | SurfaceAdapterFor<'canvas'>
  | SurfaceAdapterFor<'dom'>;
