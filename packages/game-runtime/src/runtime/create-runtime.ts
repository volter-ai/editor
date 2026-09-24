import { assertNever } from '@volter/editor-project/adapter/adapter-surface';
import {
  createRootBinding,
  type RootBinding,
  type RootDeclaration,
} from '@volter/editor-project/adapter/binding';
import type { DomHostContext } from '@volter/editor-project/adapter/host-context';
import type {
  GameCanvasHostContext,
  GameDomHostContext,
  GameThreeHostContext,
} from './host-context';
import type {
  MountedCanvasRoot,
  MountedReactRoot,
  MountedRoot,
  MountedThreeRoot,
  RootAdapter,
  SurfaceAdapter,
} from '@volter/editor-project/adapter/root-adapter';
import { stackOrder } from '@volter/editor-project/adapter/root-stacking';
import { createAssetCache } from '@volter/threejs-runtime/assets';
import { createHostRenderer } from '@volter/threejs-runtime/setup/setup-renderer';
import * as THREE from 'three';
import { createGameLoop } from '../core/game-loop';
import { getDebugRegistry } from './debug-registry';
// TYPE-ONLY: `create-runtime.ts` must never value-import `pixi.js` — a canvas
// `RootMountSpec`'s `adapter` is supplied ALREADY-CONSTRUCTED by the caller, so
// the host only ever needs the seam's types.
import {
  createGame,
  createRootInstance,
  type Game,
  type GameInternal,
  type RootInstance,
} from './game';
import { createInputRouter, type RouterAdapterRoot } from './input-router';
import type { PlaytestContext } from './playtest';
import { installRenderControlHarness, isRenderModeRequested } from './render-control';

/**
 * Register a three world onto the Game shell. `opts.id` defaults to
 * `'main'`; multi-root callers pass an explicit id. This is the one
 * registration path for a three world, whatever its id.
 */
export function registerThreeRoot(
  game: GameInternal,
  adapter: RootAdapter,
  mounted: MountedThreeRoot,
  opts?: RegisterRootOptions,
): RootInstance {
  const pausable = opts?.pausable ?? true;
  const world = createRootInstance({
    id: opts?.id ?? 'main',
    kind: 'three',
    pausable,
    adapter,
    mounted,
    scene: mounted.scene as THREE.Scene,
    binding: bindRoot(
      game,
      opts?.declaration,
      {
        surface: 'three',
        adapter: adapter as RootAdapter<'three'>,
      },
      mounted,
      pausable,
    ),
  });
  game.registerRoot(world);
  return world;
}

/** What every `register<Surface>Root` takes beyond the mount itself. */
export interface RegisterRootOptions {
  readonly id?: string | undefined;
  readonly pausable?: boolean | undefined;
  /**
   * The DECLARATION half of this root's binding, from the resolver that
   * produced `adapter` (`adapter/binding.ts`). Absent for a bare harness
   * registration or a `mountManifestRoots` caller who supplied an
   * already-constructed adapter — see `RootInstance.binding` for why that
   * legitimately yields `null` rather than a fabricated binding.
   */
  readonly declaration?: RootDeclaration | undefined;
}

/**
 * Complete the root's binding at the first moment it CAN be completed: the
 * declaration is what the resolver knew, `mounted`/`adapter`/`pausable` are
 * what mounting produced, and the debug registry is the game's own. Nothing
 * here loads or fabricates — see `createRootBinding`.
 */
function bindRoot(
  game: GameInternal,
  declaration: RootDeclaration | undefined,
  adapter: SurfaceAdapter,
  mounted: MountedRoot,
  pausable: boolean,
): RootBinding | null {
  if (!declaration) return null;
  return createRootBinding({
    ...declaration,
    adapter,
    mounted,
    pausable,
    debugRegistry: getDebugRegistry(game),
  });
}

/**
 * Register a canvas world onto the Game shell — the canvas analog of
 * {@link registerThreeRoot}. `adapter` is the seam's own
 * `RootAdapter<'canvas'>`; `RootInstance.adapter` itself only needs `.id`
 * (`AdapterHandle`, `runtime/game.ts`), so this passes through with zero cast.
 * The substrate root remains opaque here; the editor dispatches from the
 * mount's explicit `substrate.name` declaration.
 */
export function registerCanvasRoot(
  game: GameInternal,
  adapter: RootAdapter<'canvas'>,
  mounted: MountedCanvasRoot,
  opts?: RegisterRootOptions,
): RootInstance {
  const id = opts?.id ?? 'main';
  const pausable = opts?.pausable ?? true;
  const world = createRootInstance({
    id,
    kind: 'canvas',
    pausable,
    adapter,
    mounted,
    canvasRoot: mounted.substrate.root,
    binding: bindRoot(game, opts?.declaration, { surface: 'canvas', adapter }, mounted, pausable),
  });
  game.registerRoot(world);
  return world;
}

/**
 * Register a React world onto the Game shell — the DOM
 * analog of {@link registerThreeRoot}/{@link registerCanvasRoot}. A react
 * world has no `frame` hooks (react's own
 * `createRoot` schedules its commits; `GameInternal.runFrame` correctly
 * leaves a world with no `frame` untouched by its opaque-`update` fallback
 * too, since `MountedReactGame` declares no `update`). `adapter` is typed
 * as the real {@link ReactRootAdapter} shape (same reasoning as
 * `registerCanvasRoot`'s doc comment above) — `RootInstance.adapter` only
 * needs `.id`, so this passes through with zero cast.
 */
export function registerReactRoot(
  game: GameInternal,
  adapter: RootAdapter<'dom'>,
  mounted: MountedReactRoot,
  container: HTMLElement,
  opts?: RegisterRootOptions,
): RootInstance {
  const pausable = opts?.pausable ?? true;
  const world = createRootInstance({
    id: opts?.id ?? 'main',
    kind: 'dom',
    pausable,
    adapter,
    mounted,
    container,
    binding: bindRoot(game, opts?.declaration, { surface: 'dom', adapter }, mounted, pausable),
  });
  game.registerRoot(world);
  return world;
}

/**
 * One world to mount in the universal host — the host-facing mirror of
 * `manifest/load.ts`'s `ResolvedAdapterRoot` (same identity and presentation
 * fields; the
 * manifest-to-host translation itself is the editor's job, not this file's).
 *
 * A `dom` root mounts as a DOM layer `<div>` in the same
 * stack instead of a canvas — see {@link ReactRootMountSpec}/{@link
 * ReactRootAdapter} below.
 */
export interface RootMountSpecBase {
  /** Manifest id — must be unique within one `roots` array. */
  readonly id: string;
  /** Canvas stacking order (D5 §1); ties broken by array
   *  order, mirroring `manifest/load.ts`'s `loadGameManifest` sort. Defaults
   *  to `0`. */
  readonly zOrder?: number | undefined;
  /** Whether play-mode pause/step applies to this world (D10). Defaults to `true`. */
  readonly pausable?: boolean | undefined;
  /**
   * Optional claim predicate for the delegating input router (D5 §2a), over
   * a point RELATIVE TO THE CONTAINER. Absent means: this world claims only
   * if it ends up the bottom (lowest zOrder) world — see
   * `input-router.ts`'s `resolveClaimingRoot`.
   */
  readonly hitTest?: ((x: number, y: number) => boolean) | undefined;
  /**
   * The DECLARATION half of this root's binding, from whoever resolved
   * `adapter` — see `adapter/binding.ts`'s {@link RootDeclaration}. Carried on
   * the spec because the resolver knows it and the host is the only one who
   * can complete the binding (it needs `mounted`, which does not exist until
   * this spec is mounted).
   */
  readonly declaration?: RootDeclaration | undefined;
}

export interface ThreeRootMountSpec extends RootMountSpecBase {
  readonly kind: 'three';
  readonly adapter: RootAdapter;
}

/**
 * `adapter` is the SEAM's `RootAdapter<'canvas'>` — a canvas root's mount
 * honestly returns a `MountedCanvasRoot`, and naming the real contract
 * here is what keeps the resolver cast-free.
 */
export interface CanvasRootMountSpec extends RootMountSpecBase {
  readonly kind: 'canvas';
  readonly adapter: RootAdapter<'canvas'>;
}

/**
 * A live, mounted React world — the DOM analog of a mounted canvas world.
 * React roots render from game state
 * instead of a per-frame `update`, so this shape carries no `update`/`fixedUpdate`/
 * `ctx`/`frame` — `drivesOwnLoop` is always `false` (react's `createRoot`
 * schedules its OWN commits; the host's fixed-step loop never drives it,
 * and it is correctly skipped by `GameInternal.runFrame`'s per-world
 * `frame`-hooks/opaque-`update` dispatch — see `registerReactRoot` below,
 * which registers this `RootInstance` with no `frame`, same as any other
 * opaque mount with nothing to tick).
 *
 * Deliberately carries NO `firstParty: true` brand: that brand specifically
 * a react world has no physics or component runtime at all, so branding it
 * first-party would be a type lie.
 * `Game.registerRoot`'s "no state bridge" console warning explicitly exempts
 * `kind: 'dom'` (§7.1-15): a react world has no `observe` BY DESIGN — that
 * hook is scoped to `useRootObservation` (the ingested/foreign-world case),
 * not `useWorldState` (`ui/game-state.tsx`), which a react world's own
 * mounted tree uses instead — it reads `Game.state` directly, never a
 * per-world `observe`.
 *
 * `kind`/`container` satisfy `MountedReactRoot` (`adapter/
 * root-adapter.ts`) — `container` is the SAME `DomHostContext.container` the
 * adapter's `mount` was handed (identity matters, mirroring `threeScene()`/
 * `canvasRoot()`'s "same instance the adapter mounted" contract); every
 * `ReactRootAdapter` implementer echoes it back here so `mounted` alone
 * (with no separately-threaded `container`) satisfies the union
 * `RootInstanceInit.mounted`/`RootInstance.mounted` with zero cast.
 */
export interface MountedReactGame extends MountedReactRoot {
  readonly drivesOwnLoop: false;
}

/**
 * A react-shaped adapter — the structural contract `RootMountSpec`'s
 * `react` variant requires. Deliberately
 * NOT tied to a concrete implementer here so an editor-resolved adapter (the
 * `default-react` resolver branch) can satisfy
 * this shape without this file importing react-dom or any editor code.
 *
 * A genuine `RootAdapter<'dom'>` refinement (`HostContextFor<'dom'>` =
 * `DomHostContext` = {@link DomHostContext}), narrowing only the return type to
 * {@link MountedReactGame}.
 */
export interface ReactRootAdapter extends RootAdapter<'dom'> {
  readonly id: string;
  mount(host: DomHostContext): Promise<MountedReactGame>;
}

/** Same reasoning as {@link CanvasRootMountSpec} above: the seam's
 *  `RootAdapter<'dom'>` is what a DOM root actually guarantees. */
export interface ReactRootMountSpec extends RootMountSpecBase {
  readonly kind: 'dom';
  readonly adapter: RootAdapter<'dom'>;
}

export type RootMountSpec = ThreeRootMountSpec | CanvasRootMountSpec | ReactRootMountSpec;

/**
 * Mount N adapter roots (three + canvas + react)
 * on ONE `Game`, stacked in `container` per D5 §1.
 * `roots[0]` participates in `Game.defaultRoot`'s existing "first three
 * root, else first root" rule.
 */
export interface RootsRuntimeConfig {
  /** The host creates one absolutely-positioned surface per world inside
   *  this element (D5 §1) — a canvas for three/canvas, a DOM-root `<div>`
   *  layer for react — plus one shared UI overlay above all of them. */
  container: HTMLElement;
  roots: RootMountSpec[];
  width?: number | undefined;
  height?: number | undefined;
  /**
   * Mirrors `ThreeHostContext.headless` (Node conformance tests — no GPU): skips
   * real `WebGLRenderer` construction for every three world in this
   * session (a stand-in renderer is used instead; adapters special-case
   * `host.headless` themselves). Pixijs roots are unaffected — Pixi already falls back to
   * a 2D canvas renderer with no GPU. Never set `true` in a real host.
   */
  headless?: boolean | undefined;
  /**
   * `vgai.project.json`'s `rendering.antialias` — whether every three root's
   * WebGL context is built with a multisampled drawing buffer.
   *
   * It is a RUNTIME-CONFIG option rather than a world's own
   * `WorldRendererConfig` field for the reason that file's header gives: a
   * context's sample count is fixed at CREATION, before any world exists, so
   * there is no honest moment at which a world could ask for it. The
   * manifest-aware boot path (`mount-manifest.ts`) is the real reader;
   * omitting it leaves `createHostRenderer`'s own registry default alone.
   */
  antialias?: boolean | undefined;
  /** D15 (T-D15.1) — the root seed `ctx.random` boots from on every world
   *  mounted onto this session's Game, forwarded to `createGame` BEFORE any
   *  world's `mount()`/`setup()` runs (this function constructs the Game
   *  first — see `createRootsGameRuntime`). The manifest-aware boot path
   *  (`mount-manifest.ts`'s `mountManifestRoots`) is the real caller that
   *  resolves this from `manifest.determinism`/`?vgai-seed=`/its own
   *  explicit-config leg; a caller building `RootsRuntimeConfig` by hand
   *  (a test, a bespoke host) may also set it directly. Omitting it falls
   *  back to `createGame`'s own fixed default. */
  seed?: number | undefined;
  /** Private-play or Team Test identity supplied by the host. Networking
   * remains game-owned; games may use `roomKey` in their direct room join. */
  playtest?: PlaytestContext | null | undefined;
  /**
   * Test-only overrides for the render-control seam this host now wires up
   * for EVERY session (see `createRootsGameRuntime`): `location` is where
   * `?vgai-render=1` is read from (defaults to the real `window.location`;
   * a Node test has no `window` and must inject one to exercise the seam),
   * `target` is where the harness publishes (defaults to the real `window`
   * — override in a unit test to avoid touching the global object; mirrors
   * `RenderControlHarnessOptions.target`/`.location` and the
   * `debugBridge.url` override precedent in `mount-manifest.ts`).
   */
  renderControl?:
    | {
        readonly location?: { readonly search: string } | undefined;
        readonly target?: Record<string, unknown> | undefined;
      }
    | undefined;
}

/**
 * Handle returned by createGameRuntime() for controlling the running game.
 *
 * This is the GENERIC host handle — it has no first-party concepts. A
 * root's own surface is reached through `game.defaultRoot.mounted`, typed
 * as the mounted-root contract (`MountedRoot`).
 *
 * Root access is explicit through `game.roots`, `game.world(id)`, and
 * `game.defaultRoot`; the session does not project a surface-specific alias.
 */
export interface GameSession {
  stop(): void;
  /** Resolves after every root has finished the cleanup initiated by stop(). */
  readonly stopComplete: Promise<void>;
  pause(): void;
  resume(): void;
  step(): void;
  /** Resize every world's render buffer. `pixelRatio` optionally re-pins the
   * three renderers' DPR in the same pass. */
  resize(width: number, height: number, pixelRatio?: number): void;
  /** The multi-root entry point. Root access stays explicit through
   * `game.roots`, `game.world(id)`, and `game.defaultRoot`. */
  readonly game: Game;
}

/**
 * Bootstrap the game host and mount a game adapter.
 *
 * `createGameRuntime` is the universal HOST: it owns the root surfaces,
 * renderers, loop, and asset cache. Every game — including a one-root game —
 * uses the same explicit adapter-root path.
 */
export async function createGameRuntime(config: RootsRuntimeConfig): Promise<GameSession> {
  return createRootsGameRuntime(config);
}

// ---------------------------------------------------------------------------
// Universal root host
// ---------------------------------------------------------------------------

/** A stand-in `THREE.WebGLRenderer` for headless (`headless:true`) three
 *  roots: draw submission is inert while native scene/component evaluation
 *  still runs. This satisfies Fiber's custom-renderer gate and the calls
 *  (`setPixelRatio`/`setClearColor`/`setSize` at mount, `dispose`/
 *  `forceContextLoss` at teardown) — never a real GL call. Node conformance
 *  tests only; never used when `headless` is left `false`/absent. */
function createHeadlessRendererStub(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  return {
    domElement: canvas,
    render() {},
    setPixelRatio() {},
    setClearColor() {},
    setSize() {},
    dispose() {},
    forceContextLoss() {},
  } as unknown as THREE.WebGLRenderer;
}

/** One already-mounted world, tracked for disposal + the router. `element`
 *  is the world's stacked surface — an `HTMLCanvasElement` for three/
 *  canvas, or the DOM-root layer `<div>` for React — kept
 *  under one field name so `fullCleanup`'s disposal loop stays kind-generic
 *  (`container.removeChild(entry.element)` needs no branch). */
interface MountedAdapterRoot {
  readonly id: string;
  readonly kind: 'three' | 'canvas' | 'dom';
  readonly element: HTMLElement;
  readonly mounted: MountedRoot;
  /** Only three roots own a renderer this file constructed. */
  readonly renderer: THREE.WebGLRenderer | undefined;
}

/**
 * Reclaim ONE mounted root: its adapter, the renderer this file constructed for
 * it (including the WebGL context — a browser keeps only a handful alive, so
 * `dispose()` alone is not enough), and its stacked surface element.
 *
 * ONE body, TWO callers, deliberately: the session's `fullCleanup` (a normal
 * stop) and `mountAllRootSpecs`'s partial-mount ROLLBACK (a later root's mount
 * rejected, so the roots that already mounted must not survive the rejection).
 * Those two must never drift — a rollback that reclaims less than a stop is how
 * a failed play leaves a live renderer and a lost GL context behind with no
 * handle anywhere able to reach it.
 *
 * Throws only what the adapter's own `dispose()` throws; every caller wraps it
 * per entry so one bad root cannot abort the rest of the teardown.
 */
function disposeMountedRoot(entry: MountedAdapterRoot, container: HTMLElement): void {
  try {
    entry.mounted.dispose();
  } finally {
    // Renderer + surface release run even when the adapter's dispose threw:
    // the GL context is the scarce resource, and the caller still sees the
    // error (this rethrows through the `finally`).
    entry.renderer?.dispose();
    entry.renderer?.forceContextLoss();
    // Remove from the element's CURRENT parent, not the mount-time
    // `container`: the editor's Game panel re-parents the live surfaces
    // when its mount element swaps (fill <-> device preset, W2c), and
    // `container.removeChild` would throw NotFoundError after such a move.
    // `container` remains the fallback for hosts whose element stand-ins
    // never wire `parentNode` (headless unit fixtures); an element already
    // detached by such a host is a no-op via the catch.
    try {
      (entry.element.parentNode ?? container).removeChild(entry.element);
    } catch {
      /* already detached — nothing to remove */
    }
  }
}

interface OneRootResult {
  readonly mountedEntry: MountedAdapterRoot;
  readonly routerEntry: RouterAdapterRoot;
}

/** Shared per-world mount inputs, computed once in `createRootsGameRuntime`'s
 *  loop (canvas stacking + one dpr) and threaded into whichever of
 *  `mountOneThreeRoot`/`mountOneCanvasRoot` this world's `kind` needs — split
 *  out so the orchestrating loop itself stays a simple dispatch. */
interface OneRootContext {
  readonly game: GameInternal;
  readonly canvas: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  readonly isBottom: boolean;
  readonly headless: boolean;
  /** `RootsRuntimeConfig.antialias` — see that field. Undefined leaves
   *  `createHostRenderer`'s own registry default alone. */
  readonly antialias: boolean | undefined;
  readonly assets: ReturnType<typeof createAssetCache>;
}

/** Mount one three `RootMountSpec` (canvas + renderer construction, per
 *  D5 §1/§4, then `registerThreeRoot`). Split out of
 *  `createRootsGameRuntime` purely to keep that function's own branching
 *  simple — see `mountOneCanvasRoot` for the canvas sibling. */
async function mountOneThreeRoot(
  spec: ThreeRootMountSpec,
  ctx: OneRootContext,
): Promise<OneRootResult> {
  const { game, canvas, w, h, dpr, isBottom, headless, assets, antialias } = ctx;
  const renderer = headless
    ? createHeadlessRendererStub(canvas)
    : createHostRenderer(
        canvas,
        w,
        h,
        // The manifest's `rendering.antialias` reaches the WebGL context here and NOWHERE else:
        // `createHostRenderer` passes it straight to the constructor, and the sample count is
        // fixed from that moment. Omitted → the render-settings registry's own default.
        antialias === undefined ? undefined : { antialias },
        {
          alpha: !isBottom,
          preserveDrawingBuffer: true,
        },
      );
  renderer.setSize(w, h, false); // backing resolution only — CSS stacking owns layout size
  // Defect E4.R1 (Fable review): `createHostRenderer`'s OWN construction-time
  // `setSize` call (`setup-renderer.ts`, `updateStyle` defaulting `true` —
  // unchanged there on purpose, see below) stamps `canvas.style.width`/
  // `.height` to literal `${w}px`/`${h}px` the moment the renderer is built,
  // OVERWRITING the container-relative `100%`/`100%` the surface-stacking
  // loop above just set. The `renderer.setSize(w, h, false)` line right above
  // this comment does NOT undo that stamp (updateStyle:false only skips
  // TOUCHING style, it can't un-stamp a previous call) — so without this
  // re-assertion, every roots-path three canvas' on-screen size was
  // permanently pinned to whatever `w`/`h` it happened to mount at (usually
  // the manifest's `resolution`, since standalone builds mount before a real
  // container size is known — see `mount-manifest.ts`). Re-asserting here
  // makes the CSS layout size and the render-buffer resolution fully
  // independent, exactly like the react DOM world layer already is: this
  // fixes the template-standalone bug (broken at any viewport other than the
  // manifest's `resolution`, which is also Playwright's DEFAULT viewport —
  // why it went unnoticed) and, for free, tri-world's pre-existing
  // resize-staleness (the roots-path `resize()` below always calls
  // `setSize(rw, rh, false)`, so nothing else was ever going to update this
  // canvas' CSS after mount). `createHostRenderer`'s own default
  // (`updateStyle:true`) is intentionally left alone; the host owns CSS layout
  // and reasserts the container-relative size after renderer construction.
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  renderer.setPixelRatio(dpr);
  if (!isBottom) renderer.setClearColor(0x000000, 0); // D5 §1: alpha-clear above the bottom layer

  const host: GameThreeHostContext = {
    three: THREE,
    surface: { canvas, width: w, height: h },
    renderer,
    assets,
    headless,
    game,
  };
  const mounted = await spec.adapter.mount(host);
  registerThreeRoot(game, spec.adapter, mounted, {
    id: spec.id,
    pausable: spec.pausable,
    declaration: spec.declaration,
  });
  return {
    mountedEntry: { id: spec.id, kind: 'three', element: canvas, mounted, renderer },
    routerEntry: { id: spec.id, zOrder: spec.zOrder ?? 0, canvas, hitTest: spec.hitTest },
  };
}

/** Mount one canvas `RootMountSpec` (via its own `CanvasHostContext`, per D5
 *  §1/§3/§4, then `registerCanvasRoot`) — the canvas sibling of
 *  `mountOneThreeRoot` above.
 *
 *  Unlike `mountOneThreeRoot`, this needs no explicit `canvas.style.width`/
 *  `.height` re-assertion. The canvas surface constructs its
 *  `Application` with `autoDensity: true`, which makes PIXI ITSELF re-stamp
 *  `canvas.style.width`/`.height` (real CSS px, matching the LOGICAL
 *  width/height passed to `resize()`) on every `app.renderer.resize()` call —
 *  including the one this world's `mounted.resize?.()` triggers from the
 *  roots-path `resize()` below. So while a pixi world's canvas can start
 *  pinned to the mount-time `w`/`h` (same as three, until PIXI's own
 *  construction-time resize runs), it self-heals the moment ANY real
 *  `session.resize(rw, rh)` fires — every shipped standalone entry
 *  (`packages/editor/template/src/main.ts`, `examples/tri-world/src/main.ts`)
 *  already calls `session.resize()` unconditionally right after mount, so
 *  this never surfaces as a lasting bug the way three' buffer-only resize
 *  did (never self-healing, by design — see above). */
async function mountOneCanvasRoot(
  spec: CanvasRootMountSpec,
  ctx: Omit<OneRootContext, 'assets'>,
): Promise<OneRootResult> {
  const { game, canvas, w, h, dpr, headless, isBottom } = ctx;
  const pixiHost: GameCanvasHostContext = {
    canvas,
    width: w,
    height: h,
    game,
    headless,
    dpr,
    transparent: !isBottom,
    preserveDrawingBuffer: true,
  };
  const mounted = await spec.adapter.mount(pixiHost);
  registerCanvasRoot(game, spec.adapter, mounted, {
    id: spec.id,
    pausable: spec.pausable,
    declaration: spec.declaration,
  });
  return {
    mountedEntry: {
      id: spec.id,
      kind: 'canvas',
      element: canvas,
      mounted,
      renderer: undefined,
    },
    routerEntry: {
      id: spec.id,
      zOrder: spec.zOrder ?? 0,
      canvas,
      hitTest: spec.hitTest,
    },
  };
}

/**
 * Mount one React `RootMountSpec` — the DOM sibling of
 * `mountOneThreeRoot`/`mountOneCanvasRoot`. Unlike its canvas-backed siblings
 * this returns NO `routerEntry`: a react world's DOM-root layer participates in
 * D5's z-order/box stacking (the caller still creates and positions its `<div>`
 * exactly like a canvas — see `createRootsGameRuntime`'s stack-building loop)
 * but needs no entry in the delegating router's hit-test loop (§1.C — "DOM
 * layers need no entry in the router's hit-test loop"): the layer's own
 * `pointer-events` discipline (this file sets `none` on the layer by default;
 * the mounted React tree opts specific elements back in with
 * `pointer-events:auto`) is what lets its interactive elements claim events
 * NATIVELY, via the real DOM, with zero router involvement — and lets a click
 * over its non-interactive (transparent) area fall through to the canvas below
 * it via the SAME native DOM hit-testing (a `pointer-events:none` element is
 * invisible to hit-testing entirely, so the click lands on whatever real DOM
 * element is beneath it — the router's normal canvas-vs-canvas forwarding,
 * unaffected by this layer's presence).
 */
async function mountOneReactRoot(
  spec: ReactRootMountSpec,
  game: GameInternal,
  /** The ALREADY-created, already-stacked (position/z-index set, appended to
   *  `container`) DOM-root layer for this world — see
   *  `createRootsGameRuntime`'s surface-stack loop, which builds a `<div>`
   *  for every react-kind spec up front, in the SAME pass that builds every
   *  other world's canvas. This function must reuse that exact element (never
   *  create its own) so `RootInstance.reactRoot()` returns the SAME node
   *  that is actually positioned in the stack. */
  layer: HTMLElement,
): Promise<{ mountedEntry: MountedAdapterRoot }> {
  layer.style.pointerEvents = 'none';
  // An absolutely-positioned layer with no width/height collapses to zero
  // content size, so a child's
  // own position:absolute offsets resolve against a degenerate containing
  // block; otherwise clicks land outside the game.
  layer.style.width = '100%';
  layer.style.height = '100%';
  const reactHost: GameDomHostContext = { container: layer, game };
  const mounted = await spec.adapter.mount(reactHost);
  registerReactRoot(game, spec.adapter, mounted, layer, {
    id: spec.id,
    pausable: spec.pausable,
    declaration: spec.declaration,
  });
  return {
    mountedEntry: {
      id: spec.id,
      kind: 'dom',
      element: layer,
      mounted,
      renderer: undefined,
    },
  };
}

/**
 * The universal host implementer behind {@link createGameRuntime}. It builds
 * one surface per world — a
 * canvas for three/canvas, a DOM-root `<div>` layer for react — stacked
 * per D5 §1, z-order/ties exactly matching
 * `manifest/load.ts`'s sort, ONE `Game`, and registers every world onto it
 * via `registerThreeRoot`/`registerCanvasRoot`/`registerReactRoot` — the
 * SAME wiring `test/create-runtime-worlds.test.ts` proves for the
 * three/canvas pair. Worlds MOUNT in `roots` ARRAY order ("manifest
 * declaration order" — the frame/registration axis), independent of
 * `zOrder` (the canvas-stacking/rendering axis) — the two orders can differ
 * and both are honored correctly.
 */

/**
 * Dev/e2e-only `window.__vgaiScene`/`__vgaiCamera` exposure for the roots
 * path's default world — split out of `createRootsGameRuntime` purely
 * to keep that function's own cyclomatic complexity down. It uses the
 * "first three world, else none" rule: a non-Three default world publishes
 * neither global. Returns an identity-guarded retraction callback so an
 * older session's stop cannot clobber a newer session's globals. It is a no-op when nothing was
 * published (non-DEV build, or non-threejs default world).
 */
function installDefaultRootDevGlobals(game: GameInternal): () => void {
  if (!import.meta.env?.DEV) return () => {};
  const defaultMounted = game.defaultRoot.mounted;
  if (defaultMounted.kind !== 'three') return () => {};
  const scene = defaultMounted.scene;
  const w = window as unknown as Record<string, unknown>;
  w['__vgaiScene'] = scene;
  // An ACCESSOR, not a value read once: a world may replace its camera after
  // mount (fiber's `set({ camera })` — drei's `makeDefault`, or a translated
  // Godot world installing the camera its `.tscn` authors), and a snapshot
  // here reads as authoritative to the probe that reaches for it while naming
  // a camera the frame no longer uses. The retraction guard compares the
  // GETTER's identity, which is the same "don't clobber a newer session"
  // rule the value comparison was.
  const readCamera = (): THREE.PerspectiveCamera =>
    defaultMounted.camera as THREE.PerspectiveCamera;
  Object.defineProperty(w, '__vgaiCamera', {
    get: readCamera,
    configurable: true,
    enumerable: true,
  });
  return () => {
    if (w['__vgaiScene'] === scene) delete w['__vgaiScene'];
    if (Object.getOwnPropertyDescriptor(w, '__vgaiCamera')?.get === readCamera)
      delete w['__vgaiCamera'];
  };
}

/** Shared inputs `mountAllRootSpecs` needs beyond each individual spec —
 *  everything `OneRootContext` needs except the per-world `canvas`/
 *  `isBottom`, plus the surface lookup and bottom-id needed to derive them. */
interface MountAllRootsInputs extends Omit<OneRootContext, 'canvas' | 'isBottom'> {
  readonly surfacesById: Map<string, HTMLElement>;
  /** The host element the surfaces were stacked into — needed only by the
   *  partial-mount rollback, which reclaims them through the same
   *  {@link disposeMountedRoot} body a normal stop uses. */
  readonly container: HTMLElement;
}

interface MountAllRootsResult {
  readonly mountedEntries: MountedAdapterRoot[];
  readonly routerEntries: RouterAdapterRoot[];
}

/**
 * Mount + register every world spec, in ARRAY (declaration) order — split
 * out of `createRootsGameRuntime` purely to keep that function's own
 * cyclomatic complexity down (E4, same reason `mountOneThreeRoot`/
 * `mountOneCanvasRoot` are already split out). React roots contribute NO
 * router entry ("DOM layers need no entry in the router's hit-test loop"):
 * their layer's own `pointer-events` discipline handles claim/fall-through
 * natively, with zero router involvement (see `mountOneReactRoot`'s doc
 * comment).
 */
async function mountAllRootSpecs(
  mountSpecs: (ThreeRootMountSpec | CanvasRootMountSpec | ReactRootMountSpec)[],
  bottomId: string | undefined,
  inputs: MountAllRootsInputs,
): Promise<MountAllRootsResult> {
  const { surfacesById, container, ...shared } = inputs;
  const mountedEntries: MountedAdapterRoot[] = [];
  const routerEntries: RouterAdapterRoot[] = [];

  try {
    for (const spec of mountSpecs) {
      const isBottom = spec.id === bottomId;
      if (spec.kind === 'dom') {
        const layer = surfacesById.get(spec.id)!;
        const { mountedEntry } = await mountOneReactRoot(spec, shared.game, layer);
        mountedEntries.push(mountedEntry);
        continue;
      }
      const canvas = surfacesById.get(spec.id)! as HTMLCanvasElement;
      const oneCtx: OneRootContext = { ...shared, canvas, isBottom };
      let mountedEntry: MountedAdapterRoot;
      let routerEntry: RouterAdapterRoot;
      if (spec.kind === 'three') {
        ({ mountedEntry, routerEntry } = await mountOneThreeRoot(spec, oneCtx));
      } else if (spec.kind === 'canvas') {
        ({ mountedEntry, routerEntry } = await mountOneCanvasRoot(spec, oneCtx));
      } else {
        // Exhaustiveness guard (§7.4-2): 'react' was already handled by the
        // early `continue` above, so only a hypothetical 4th `AdapterSurface` can
        // reach here — fail loudly rather than silently defaulting. `spec`
        // itself (not `spec.kind`) is what TS has narrowed to `never`, since
        // `RootMountSpec` is a discriminated union at the object level.
        assertNever(spec, 'create-runtime mount loop');
      }
      mountedEntries.push(mountedEntry);
      routerEntries.push(routerEntry);
    }
  } catch (err) {
    // PARTIAL MOUNT ROLLBACK. Roots mount sequentially, so a rejection from
    // root N leaves roots 1..N-1 fully live — renderer, WebGL context, R3F
    // tree, adapter registrations — and NOTHING ever gets a handle to them:
    // this function throws instead of returning, so no `GameSession` (and
    // therefore no `stop()`) is ever constructed. Reclaim them here, in
    // REVERSE mount order (the inverse of the order they were built in), then
    // rethrow the ORIGINAL error — the mount failure is what the caller must
    // see, never a teardown error raised while cleaning up after it.
    for (let i = mountedEntries.length - 1; i >= 0; i--) {
      const entry = mountedEntries[i]!;
      try {
        disposeMountedRoot(entry, container);
      } catch (disposeErr) {
        // biome-ignore lint/suspicious/noConsole: a rollback failure must be visible; the original mount error is still what we rethrow
        console.error(
          `createGameRuntime: rolling back root "${entry.id}" after a mount failure threw:`,
          disposeErr,
        );
      }
    }
    throw err;
  }
  return { mountedEntries, routerEntries };
}

/**
 * G3/FT-11 — publish the render-control harness (`render-control.ts`) for a
 * live session, returning its retraction (wired into the session's own
 * `stop()`, same leave-nothing-live rule as the debug bridge's `uninstall()`
 * in mount-manifest.ts — render-control has no uninstall surface of its own,
 * a render page being a single-load host by design, so the retraction is
 * the publication's inverse). Split out of `createRootsGameRuntime` purely
 * to keep that function's cyclomatic complexity down (the same reason
 * `mountAllRootSpecs`/`installDefaultRootDevGlobals` are split out).
 *
 * The clock is a documented no-op: a manifest-mounted game has no global
 * cinematic AnimationClock to seek (a cinematic fixture that HAS one
 * installs its own harness with the real clock, e.g.
 * packages/engine/e2e/render-cinematic/main.ts) — the meaningful advance
 * path for a plain game is `simulateSubsteps` (I5 `--simulate`), which
 * drives `game.runFrame`.
 */
function installSessionRenderHarness(
  game: GameInternal,
  location: { readonly search: string },
  targetOverride: Record<string, unknown> | undefined,
): (() => void) | undefined {
  const target =
    targetOverride ??
    (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined);
  if (target === undefined) return undefined;
  installRenderControlHarness({
    game,
    clock: {
      seek() {
        /* no global cinematic clock on a manifest-mounted game — see above */
      },
      seekFrame() {
        /* intentional no-op, as seek() */
      },
    },
    readiness: {
      // Mount is complete by the time this harness exists (the install site
      // in `createRootsGameRuntime` is after `mountAllRootSpecs`
      // resolved) — the hook resolving immediately IS the readiness
      // statement, not an assumption.
      scene() {},
    },
    location,
    target,
  });
  return () => {
    delete target['__vgaiRender'];
  };
}

/**
 * Reclaim what `createRootsGameRuntime` built for ITSELF when the mount
 * rejects. `mountAllRootSpecs` has already rolled back every root that DID
 * mount, so what is left is the Game shell (holding whatever registrations
 * those roots made into it) and the stacked surface elements of the roots that
 * never got to mount. Neither is reachable afterwards: the mount throws instead
 * of returning, so no `GameSession` — and therefore no `stop()` — ever exists.
 *
 * Never throws: the MOUNT error is what the caller must see, so a failure while
 * cleaning up after it is reported and swallowed.
 */
function reclaimAfterMountFailure(
  game: GameInternal,
  surfaces: Iterable<HTMLElement>,
  container: HTMLElement,
): void {
  try {
    game.dispose();
  } catch (disposeErr) {
    // biome-ignore lint/suspicious/noConsole: a failed rollback must be visible; the original mount error is what the caller gets
    console.error('createGameRuntime: disposing the game after a mount failure threw:', disposeErr);
  }
  for (const surface of surfaces) {
    try {
      (surface.parentNode ?? container).removeChild(surface);
    } catch {
      /* already detached by the per-root rollback */
    }
  }
}

async function createRootsGameRuntime(config: RootsRuntimeConfig): Promise<GameSession> {
  const { container, roots: specs, width, height, headless = false, seed, playtest } = config;
  if (specs.length === 0) {
    throw new Error('createGameRuntime: `roots` must contain at least one root.');
  }
  const mountSpecs = specs as (ThreeRootMountSpec | CanvasRootMountSpec | ReactRootMountSpec)[];

  const w = Math.max(
    1,
    width ?? (container as HTMLElement & { clientWidth?: number }).clientWidth ?? 0,
  );
  const h = Math.max(
    1,
    height ?? (container as HTMLElement & { clientHeight?: number }).clientHeight ?? 0,
  );
  const dpr = headless
    ? 1
    : Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

  if (!container.style.position) container.style.position = 'relative';

  // --- Surface stack (D5 §1): DOM/z-order follows zOrder, ties -> array order
  // — computed FIRST (bottom -> top) so both the z-index assignment below and
  // the router's default-claim rule share one definition. A react world's
  // DOM-root layer shares this SAME stacking pass even though it is a `<div>`, not a
  // canvas, and carries no `hitTest` (the router never sees react entries at
  // all — see the dispatch loop below). ---
  const claimEntries = mountSpecs.map((spec) => ({
    id: spec.id,
    zOrder: spec.zOrder ?? 0,
    hitTest: spec.hitTest,
  }));
  const stacked = stackOrder(claimEntries);
  const bottomId = stacked[0]?.id;
  const kindById = new Map(mountSpecs.map((spec) => [spec.id, spec.kind] as const));

  const surfacesById = new Map<string, HTMLElement>();
  stacked.forEach((entry, i) => {
    const isReact = kindById.get(entry.id) === 'dom';
    const surface = document.createElement(isReact ? 'div' : 'canvas') as HTMLElement;
    surface.dataset['vgaiRootSurface'] = 'true';
    // WHICH ROOT THIS SURFACE PRESENTS — the host mounted it, so the host
    // knows, and stamping it here is the difference between a declaration and
    // the guess every late reader had to make instead ("the first <canvas> in
    // DOM order is the game's"). Read by `packages/editor/src/presentation-
    // surface.ts`, which is the one door the capture/staleness/screenshot
    // sites now ask (ARCHITECTURE-CORE §The editor protocol, zero inference).
    surface.dataset['vgaiRootId'] = entry.id;
    if (!isReact) {
      const canvas = surface as unknown as HTMLCanvasElement;
      canvas.width = w;
      canvas.height = h;
    }
    // Defect E4.R1 (Fable review): layout size is ALWAYS container-relative
    // (`width:100%;height:100%`), fully decoupled from the surface's
    // intrinsic buffer resolution (`w`/`h`, set on the canvas element's
    // `width`/`height` ATTRIBUTES above — a device-pixel/render-resolution
    // concern only). Without this, a canvas with no CSS size falls back to
    // its `width`/`height` attribute as its CSS layout size too, so whatever
    // stamped those attributes (`createHostRenderer`'s construction-time
    // `setSize`, `mountOneThreeRoot` below) pins the ON-SCREEN size — see
    // that function's doc comment for the concrete bug this caused (template
    // standalone at any viewport ≠ the manifest resolution). Setting it HERE
    // too (not just in `mountOneThreeRoot`) means every surface, whatever
    // kind, starts container-relative from its very first paint, before any
    // per-kind mount work has even run.
    // `contain:layout paint` makes each surface the containing block for
    // `position:fixed` descendants (and clips overflow to the world's
    // rectangle): full-screen game UI written the natural way (`fixed;
    // inset:0`) then fills the WORLD, not the page. Without it, `fixed` UI
    // looks correct standalone (surface == window) but escapes over the
    // editor chrome whenever the surface is a sub-rectangle of the page —
    // and toggles behavior when any ancestor gains a transform (e.g. the
    // editor's space-pan). Dogfooded 2026-07-12 via a react shell world.
    surface.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;z-index:${i + 1};contain:layout paint;`;
    container.appendChild(surface);
    surfacesById.set(entry.id, surface);
  });

  const assets = createAssetCache();
  // Every manifest/host-mounted game is a deterministic-capture candidate —
  // the render-control seam (`?vgai-render=1`, render-control.ts) is wired
  // HERE, at the one host every boot path shares (mountGameFromManifest,
  // mountManifestRoots, and direct createGameRuntime callers all reach this
  // function), instead of asking every project's entry page to install it
  // the way the e2e fixtures do. Production-protected twice over:
  // `isRenderModeRequested` gates on the query param, and
  // `installRenderControlHarness` re-checks it internally (its AC 4), so a
  // normal gameplay page sees zero change.
  const renderModeLocation =
    config.renderControl?.location ?? (typeof window !== 'undefined' ? window.location : undefined);
  const renderMode = renderModeLocation !== undefined && isRenderModeRequested(renderModeLocation);
  let started = false;
  const loop = createGameLoop({
    fixedTimestep: 1 / 60,
    maxSubSteps: 8,
    // Render mode runs the loop in EXTERNAL-DRIVE mode (game-loop.ts, I2):
    // no RAF is ever armed, so nothing advances gameplay between the capture
    // host's explicit `simulateSubsteps`/`renderOnce` calls — wall-clock time
    // passing while a screenshot is taken must not move the world.
    externalDrive: renderMode,
    // Sim and presentation are wired to different callbacks here:
    // `update` runs the gameplay phases once per consumed fixed substep with
    // `preRender`/`render` withheld, and `render` runs those two once per real
    // display frame with the interpolation alpha. Both closures are invoked
    // only from the loop's own rAF arm, which `externalDrive` never arms — so
    // a capture/offline-export page (`renderMode`) reaches neither, and its
    // `simulateSubsteps` → `game.runFrame(fixedDt)` path stays frame-exact,
    // rendering inside the substep.
    update: (dt) => {
      if (started) game.runFrame(dt, { skipRenderPhases: true });
    },
    render: (alpha, displayDt) => {
      if (started) game.runRenderFrame(alpha, displayDt);
    },
  });
  const game = createGame({ loop, assets, seed, playtest });

  // --- Mount + register every world, in ARRAY (declaration) order. ---
  // Split out into its own top-level function purely to keep
  // `createRootsGameRuntime`'s own cyclomatic complexity down (E4) — same
  // reason `mountOneThreeRoot`/`mountOneCanvasRoot` are already split out
  // below.
  let mounted: MountAllRootsResult;
  try {
    mounted = await mountAllRootSpecs(mountSpecs, bottomId, {
      game,
      surfacesById,
      container,
      w,
      h,
      dpr,
      headless,
      assets,
      antialias: config.antialias,
    });
  } catch (err) {
    reclaimAfterMountFailure(game, surfacesById.values(), container);
    throw err;
  }
  const { mountedEntries, routerEntries } = mounted;

  // --- Delegating input router (D5 §2a) ---
  const router = createInputRouter(container, routerEntries);

  started = true;
  loop.start();

  // Expose the default Three root's scene and camera for dev/e2e tooling.
  const retractDevGlobals = installDefaultRootDevGlobals(game);

  // G3/FT-11 — publish `window.__vgaiRender` for the deterministic capture
  // host. Installed at the TAIL of the mount (same position as
  // mount-manifest.ts's debug bridge): every world's `mount()`/`setup()` has
  // resolved by now, so the harness's `scene` readiness hook reporting ready
  // is truthful. See `installSessionRenderHarness` below.
  const retractRenderHarness =
    renderMode && renderModeLocation !== undefined
      ? installSessionRenderHarness(game, renderModeLocation, config.renderControl?.target)
      : undefined;

  let resolveStopComplete!: () => void;
  const stopComplete = new Promise<void>((resolve) => {
    resolveStopComplete = resolve;
  });
  let stopping = false;

  /**
   * Reclaim EVERYTHING this session owns, and let no single failure stop that.
   *
   * Teardown used to be one `try` over the whole body, so a throwing
   * `entry.mounted.dispose()` on root 1 skipped root 2's disposal, both
   * renderers' `forceContextLoss`, `game.dispose()` and the two global
   * retractions — while `stopComplete` still resolved and the editor still
   * reported the instance reclaimed. Every step is now isolated: a failure is
   * COLLECTED and reported, never allowed to abort the steps after it.
   */
  function fullCleanup(): void {
    if (stopping) return;
    stopping = true;
    const failures: { readonly step: string; readonly error: unknown }[] = [];
    /** Run one teardown step; record its failure and keep going. */
    const step = (name: string, run: () => void): void => {
      try {
        run();
      } catch (error) {
        failures.push({ step: name, error });
      }
    };
    try {
      step('loop.stop', () => loop.stop());
      step('router.dispose', () => router.dispose());
      for (const entry of mountedEntries) {
        step(`root "${entry.id}"`, () => disposeMountedRoot(entry, container));
      }
      step('game.dispose', () => game.dispose());
      step('dev globals', () => retractDevGlobals());
      step('render harness', () => retractRenderHarness?.());
    } finally {
      void Promise.allSettled(
        mountedEntries.map((entry) => entry.mounted.disposeComplete ?? Promise.resolve()),
      ).then(() => resolveStopComplete());
    }
    if (failures.length > 0) {
      // LOUD, and after everything else has been reclaimed. `stop()` is called
      // from hosts that must not be left half-torn-down by an early throw, so
      // the report comes last — but it IS a report: a silent partial teardown
      // is the failure this whole restructure exists to end. The editor's
      // `exitPlayMode` catches it and prints it to the editor console.
      throw new AggregateError(
        failures.map((f) => f.error),
        `Game session teardown failed in ${failures.length} step(s): ${failures
          .map((f) => f.step)
          .join(', ')}. Every other step still ran.`,
      );
    }
  }

  return {
    stop: fullCleanup,
    stopComplete,
    // `Game.play` owns per-world pause, loop-gate, and audio-gate semantics.
    pause() {
      game.play.pause();
    },
    resume() {
      game.play.resume();
    },
    step() {
      game.play.step();
    },
    resize(rw: number, rh: number, pixelRatio?: number) {
      const safeWidth = Math.max(1, rw);
      const safeHeight = Math.max(1, rh);
      for (const entry of mountedEntries) {
        // W2c device preview: re-pin DPR before setSize so the drawing
        // buffer (and the first-party composer, whose `mounted.resize` reads
        // `getDrawingBufferSize`) picks it up in this same pass. Pixi/react
        // worlds have no `entry.renderer` and keep their own resolution.
        if (pixelRatio !== undefined) entry.renderer?.setPixelRatio(pixelRatio);
        entry.renderer?.setSize(safeWidth, safeHeight, false);
        entry.mounted.resize?.(safeWidth, safeHeight);
      }
    },
    game,
  };
}
