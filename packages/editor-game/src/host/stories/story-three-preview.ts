/**
 * Off-screen `three`/R3F story preview — render a composed CSF story that
 * produces an R3F world OFF-SCREEN and hand back its root `THREE.Object3D`.
 * Portable CSF is a prefab's explicit declaration and its sole preview
 * authority, whether or not instances happen to exist in a scene.
 *
 * ## Why this module exists
 *
 * A discoverable CSF story (`*.stories.tsx`, found by `story-discovery.ts` and
 * composed by `compose-project-stories.ts`) is the author's portable "here is
 * how this prefab renders." This module mounts that story's R3F content in an
 * isolated fiber root and returns the resulting scene as an ordinary
 * `THREE.Object3D`, which callers feed to `captureObjectAssetPreview`.
 * Scene placement, authoring snapshots, and model literals are deliberately
 * outside this path: they describe instances or dependencies, not the prefab's
 * authored representative state.
 *
 * ## How the off-screen mount works (and why no real WebGL is needed to build
 * the graph)
 *
 * This mirrors `@vgai/game-runtime/world3d-react`'s `r3f-adapter.tsx` bridge, minus the
 * engine runtime: `createRoot(canvas)` + `configure({ frameloop: 'never' })`,
 * waiting for fiber's `onCreated` for the real `THREE.Scene` (React 19 gives no
 * synchronous first commit). Two deliberate choices:
 *
 *  - `extend(THREE)` first — fiber v9 tree-shakes the THREE catalogue, so a
 *    bare `createRoot` (no `<Canvas>`) throws "X is not part of the THREE
 *    namespace" on the first intrinsic (`<object3D>`, `<mesh>`, …) without it.
 *    This is the exact reason `r3f-adapter.tsx` calls `extend(host.three)`.
 *  - The renderer is a STUB (`createStubRenderer`). Under `frameloop: 'never'`
 *    fiber never calls `gl.render`, and the pixels are produced later by
 *    `captureObjectAssetPreview`, which builds its OWN `WebGLRenderer`. So the
 *    reconciler builds the real object graph with no WebGL context at all —
 *    which is what lets the mount (the load-bearing logic) run headless under
 *    jsdom while the snapshot stays environment-bound.
 *
 * `.load()` (the story's `loaders`) is awaited before the first render, the
 * same contract `StoryPreviewMount.tsx` documents: Storybook 9 only populates a
 * story's loaded data once `.load()` itself has run. A `three` prefab story's
 * loader is where it builds the runtime context its component needs (e.g. the
 * squash `Mob` story loads its `.glb` and inits Rapier there).
 *
 * ## What the mount photographs: the FIRST COMMIT
 *
 * Because the subject is whatever fiber commits first, a story that wraps its
 * three content in `<Suspense>` hands back the FALLBACK — the boundary commits
 * immediately with its (non-three) fallback subtree, so the story is skipped as
 * "no three content" while the real children arrive on a later commit nobody is
 * waiting for. `useGLTF` and drei's other suspending loaders WITHOUT a boundary
 * are the shape that works: with nothing to catch it the whole root suspends,
 * and the first commit is the one that already carries the loaded content.
 *
 * That shape has a price, and it is the other half of the same fact: an
 * unboundaried suspend delays the FIRST COMMIT until the content is ready, so a
 * story whose load outruns {@link ONCREATED_TIMEOUT_MS} rejects at the ceiling —
 * a big asset either loads fast here or the ceiling is its limit.
 *
 * ## Physics: the context a naive story of a `RigidBody` component never has
 *
 * `@react-three/rapier`'s hooks read a React context that only `<Physics>`
 * provides, so a colocated story of an ordinary gameplay prefab — the common
 * case, since template/example prefabs wrap themselves in `<RigidBody>` — dies
 * on `react-three-rapier: useRapier must be used within <Physics />!` the
 * moment a preview surface mounts it. That is a collision between two shipped
 * rules (every reusable gameplay component gets a colocated story; gameplay
 * components use rapier), not a story-authoring mistake, so the mount resolves
 * it: {@link mountStoryObject3D} RETRIES the mount once inside a real
 * `<Physics paused>` when — and only when — the first attempt failed with
 * exactly that error (see {@link isMissingPhysicsContext}).
 *
 * Retry rather than always-wrap, deliberately:
 *  - a story that needs no physics never imports rapier, never initializes its
 *    WASM, and mounts byte-identically to before;
 *  - a story that provides its OWN `<Physics>` never throws, so it never
 *    reaches the retry and is never double-wrapped. (Nesting is harmless
 *    anyway — measured: an inner `<Physics>` simply overrides the outer
 *    context and the tree mounts identically — but not relying on that is
 *    cheaper than relying on it.)
 * The retry's `<Physics>` is NOT paused, and that is the whole point: every
 * story mount runs the ONE bounded design-time settle below before it is handed
 * to anybody, so what a surface photographs is the component's REST pose — a
 * body on its suspension, a wheel the physics worker has actually placed — and
 * then content time is held forever. A paused provider would freeze the world
 * at a spawn pose whose wheels no worker ever positioned (measured: the
 * racing-game `Vehicle` exhibit rendered wheelless).
 *
 * The context is only real if the `<Physics>` provider and the story's hooks
 * come from the SAME `@react-three/rapier` module instance — a scaffolded
 * project resolves its own copy from its own `node_modules`, which would make
 * two contexts and leave the error exactly where it was. Repo-root
 * `vite.config.ts`'s `resolve.dedupe` carries the package for that reason, the
 * same identity contract already spelled out there for `@react-three/fiber`.
 * The packaged runtime resolves both the preview renderer and this lazy
 * provider through the project-rooted Vite graph, so the context identity is
 * the same there too; `story-three-preview-runtime.ts` owns that seam.
 */

import type { RootState } from '@react-three/fiber';
import { Component, type ReactNode } from 'react';
import * as THREE from 'three';
import { captureObjectAssetPreview } from '@volter/editor-threejs/kit/asset-preview';
import { settleDesignWorld } from '@volter/editor-threejs/kit/authoring/design-time-settle';
import { CrashNullBoundary } from '@volter/editor-sdk/kit/crash-null-boundary';
import {
  resolveStoryThreePreviewRuntime,
  type StoryThreePreviewRuntime,
} from '../story-three-preview-runtime';
import { viewportTimingsEnabled } from '@volter/editor-sdk/kit/viewport-activation-timings';
import { runInStoryMountTurn } from '@volter/editor-sdk/kit/stories/story-mount-turn';

/** Last mount's phase split — only written when timings are on. The board
 *  reads this after each attempt so a per-story row can name load vs fiber
 *  vs settle without threading a callback through the mount turn. */
export interface StoryMountPhaseTiming {
  readonly runtimeMs: number;
  readonly loadMs: number;
  readonly fiberMs: number;
  readonly settleMs: number;
}

let lastMountPhases: StoryMountPhaseTiming | null = null;

export function lastStoryMountPhaseTiming(): StoryMountPhaseTiming | null {
  return lastMountPhases;
}

/** A composed portable story is a callable React component; Storybook attaches
 *  an optional `.load()` when the CSF export declares `loaders`. A plain React
 *  component (no `.load`) is accepted too — the load step is simply skipped. */
import type { StoryPreviewComponent } from '@volter/editor-sdk/kit/stories/story-preview-component';
export type { StoryPreviewComponent };

export interface MountedStoryObject3D {
  /** The named wrapper group the story rendered INTO — a single `THREE.Object3D`
   *  holding exactly the story's content (see {@link PREVIEW_ROOT_NAME}). Hand
   *  it straight to `captureObjectAssetPreview`; framing a precise wrapper
   *  rather than the whole `THREE.Scene` keeps default lights/helpers fiber may
   *  add out of the shot. */
  readonly root: THREE.Object3D;
  /** The authored R3F scene around `root`, including its background,
   * environment, fog, and scene-level camera declarations. */
  readonly scene: THREE.Scene;
  /** Advance only through an owning Asset Lab transport (animation/physics
   * preview). Merely mounting a story never calls this, so Edit remains held. */
  advance(deltaSeconds: number): void;
  /** Tear the isolated fiber root down. Runs the story's own effect cleanups
   *  (a translated scene's `detachNodes`, releasing its Rapier handles). */
  dispose(): void;
}

/** The name of the wrapper `<group>` every story is rendered into, so its root
 *  `Object3D` can be extracted unambiguously from fiber's scene. */
export const PREVIEW_ROOT_NAME = 'vgai:story-preview-root';

/** How long to wait for fiber's first commit before giving up. The LAST-RESORT
 *  ceiling only: a reconcile-time crash is now caught by
 *  {@link CrashNullBoundary} and rejects immediately (see its doc comment), so
 *  reaching this timeout means the story neither committed nor threw. TWO causes
 *  reach it, and the common one is not a bug: a story still SUSPENDED on a slow
 *  load (the unboundaried shape the module doc recommends holds the first commit
 *  until its content is ready), or a genuinely hung render. Matches the 10s the
 *  engine's own `r3f-adapter.tsx` uses. */
const ONCREATED_TIMEOUT_MS = 10_000;

/**
 * A React fiber, just enough to walk the committed tree for a `<Physics>`
 * provider. Both `@react-three/rapier` and `@react-three/cannon` export that
 * name; the settle must not import either library to ask.
 */
interface ReactFiberLike {
  readonly type?: unknown;
  readonly elementType?: unknown;
  readonly memoizedProps?: unknown;
  readonly child?: ReactFiberLike | null;
  readonly sibling?: ReactFiberLike | null;
}

function reactComponentName(type: unknown): string {
  if (typeof type === 'function') {
    const named = type as { name?: string; displayName?: string };
    return named.displayName || named.name || '';
  }
  if (type && typeof type === 'object') {
    const wrapped = type as {
      displayName?: string;
      name?: string;
      type?: unknown;
      render?: unknown;
    };
    if (typeof wrapped.displayName === 'string' && wrapped.displayName.length > 0) {
      return wrapped.displayName;
    }
    if (typeof wrapped.name === 'string' && wrapped.name.length > 0) return wrapped.name;
    return reactComponentName(wrapped.type ?? wrapped.render);
  }
  return '';
}

function reactFiberOf(instance: object): ReactFiberLike | undefined {
  const record = instance as Record<string, unknown>;
  const fiber = record['_reactInternals'] ?? record['_reactInternalFiber'];
  return fiber && typeof fiber === 'object' ? (fiber as ReactFiberLike) : undefined;
}

function physicsNodeFacts(node: ReactFiberLike): {
  readonly provider: boolean;
  readonly body: boolean;
  readonly movingBody: boolean;
} {
  const names = [reactComponentName(node.type), reactComponentName(node.elementType)];
  const body = names.includes('RigidBody') || names.includes('InstancedRigidBodies');
  if (!body) return { provider: names.includes('Physics'), body: false, movingBody: false };
  const props =
    node.memoizedProps && typeof node.memoizedProps === 'object'
      ? (node.memoizedProps as Record<string, unknown>)
      : {};
  // Rapier's native default is dynamic. Kinematic bodies also own their pose
  // and must settle; only `fixed` is inert.
  return { provider: names.includes('Physics'), body: true, movingBody: props['type'] !== 'fixed' };
}

/**
 * Whether this committed tree has physics that can change its design pose.
 *
 * A provider containing only fixed Rapier bodies has a physics subscriber,
 * but there is nothing to settle: stepping it for the full "never observed
 * motion" budget cost third-person's static tower/tree stories ~1.3 seconds
 * apiece. Read the library's own `RigidBody type` declaration from the
 * committed React tree. Unknown physics remains conservative and settles;
 * only a tree whose identified bodies are ALL explicitly fixed skips.
 */
function reactSubtreeNeedsPhysicsSettle(fiber: ReactFiberLike | undefined): boolean {
  const stack: ReactFiberLike[] = fiber ? [fiber] : [];
  const seen = new Set<ReactFiberLike>();
  let hasPhysics = false;
  let identifiedBody = false;
  let movingBody = false;
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const facts = physicsNodeFacts(node);
    hasPhysics ||= facts.provider;
    identifiedBody ||= facts.body;
    movingBody ||= facts.movingBody;
    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
  if (!hasPhysics) return false;
  return !identifiedBody || movingBody;
}

/**
 * Walks the committed story tree after mount and reports whether physics can
 * change its pose. Fixed-only worlds are already at their final pose.
 */
class PhysicsSubscriberProbe extends Component<{
  readonly onReport: (hasPhysics: boolean) => void;
  readonly children?: ReactNode;
}> {
  override componentDidMount(): void {
    this.props.onReport(reactSubtreeNeedsPhysicsSettle(reactFiberOf(this)));
  }

  override render(): ReactNode {
    return this.props.children ?? null;
  }
}

/**
 * The R3F reconciler refusing a non-`three` intrinsic — the QUALIFICATION
 * REJECTION class, and the ONLY error class this module silences.
 *
 * A `<div>` in a story means "this is a DOM story", which is a question both 3D
 * surfaces ask on purpose and answer by skipping. It is matched on the
 * reconciler's own message because that message is what names the class: a
 * story that DOES render three content and then throws for its own reason
 * (a failed load, a bad prop) produces a different error and must still be
 * reported like any other.
 */
function isQualificationRejection(error: unknown): boolean {
  return error instanceof Error && error.message.includes('is not part of the THREE namespace');
}

/**
 * Errors the qualify / off-screen classify path produces for ITS OWN
 * scaffolding — missing engine context, R3F hooks outside a Canvas — that
 * must not reach the user's console as if the game threw them.
 *
 * "Hooks can only be used within the Canvas component" and "useGame: no Game
 * in context" both leaked past {@link isQualificationRejection}: a `<Physics>`
 * without a Canvas, or a story component reading the non-optional Game handle,
 * fails the classify mount and Fiber's `reportError` files it as a session
 * error. Both are classification-internal, the same class as the reconciler
 * refusal.
 */
function isQualifyInternalError(error: unknown): boolean {
  if (isQualificationRejection(error)) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('Hooks can only be used within the Canvas component') ||
    error.message.includes('useGame: no Game in context')
  );
}

/**
 * The refusals the story CAPTURE lane may fall through to its DOM leg silently —
 * "this is a DOM story", asked and answered by classification. Anything outside
 * this class is a THREE story that genuinely failed, and per the contract above
 * it must be NAMED where it falls through, never swallowed: an entire project's
 * prefab sheet once photographed blank with the real error (`Asset preview
 * source has no renderable bounds`) invisible behind a bare `catch`.
 */
export function isStoryThreeClassificationRefusal(error: unknown): boolean {
  return isQualifyInternalError(error);
}

/**
 * `@react-three/rapier` refusing to hand out its context — the PHYSICS-CONTEXT
 * class, and the one failure this module answers by mounting a second time (see
 * the module doc's "Physics" section).
 *
 * Matched on the library's own message (`useRapier must be used within
 * <Physics />`), which every rapier hook and `<RigidBody>` funnels through, for
 * the same reason {@link isQualificationRejection} matches the reconciler's: the
 * message is what names the class. A story that DOES have physics context and
 * then fails for its own reason produces a different error and must still be
 * reported.
 *
 * The rejection {@link mountStoryObject3DOnce} raises wraps the original
 * message, so this reads the whole string rather than the `cause`.
 */
function isMissingPhysicsContext(error: unknown): boolean {
  return error instanceof Error && error.message.includes('useRapier must be used within <Physics');
}

/**
 * The REAL `@react-three/rapier` `<Physics>` component, imported only once a
 * story has proven it needs one (see {@link isMissingPhysicsContext}) — the same
 * dynamic-import discipline the networking path uses, so a project with no
 * physics never pulls rapier or its WASM into the editor session at all.
 *
 * `null` when the package cannot be resolved: nothing to retry with, so the
 * caller re-throws the story's own error rather than inventing a second one.
 */
async function loadPhysicsProvider(runtime: StoryThreePreviewRuntime): Promise<React.ComponentType<{
  paused?: boolean;
  children?: ReactNode;
}> | null> {
  try {
    const projectRapierPath = '/@id/@react-three/rapier';
    const rapier = runtime.packaged
      ? await import(/* @vite-ignore */ projectRapierPath)
      : await import('@react-three/rapier');
    return rapier.Physics as React.ComponentType<{ paused?: boolean; children?: ReactNode }>;
  } catch {
    return null;
  }
}

interface ErrorReportingGlobal {
  reportError?: ((error: unknown) => void) | undefined;
}

/**
 * `createRoot`, with the qualification-rejection class filtered out of the
 * root's error reporting.
 *
 * {@link CrashNullBoundary} already HANDLES that error, but handling it is not
 * enough to keep it off the page: fiber pins React 19's
 * `onUncaughtError`/`onCaughtError`/`onRecoverableError` to one
 * `logRecoverableError` and exposes no override, and that reporter is
 * `reportError` — which dispatches a real uncaught-`error` event. `the world root's stage`
 * listens for exactly that and files it in `editorConsole`, so scanning a
 * project's DOM stories used to leave the editor showing a red `N errors` badge
 * for entirely by-design behaviour.
 *
 * Fiber captures that reporter SYNCHRONOUSLY inside `createRoot` (as
 * `typeof reportError === 'function' ? reportError : console.error`), so the
 * captured value is the one seam available — and the patch therefore lives
 * exactly as long as the `createRoot` call, while the root itself keeps the
 * filtering reporter for its whole life. Everything that is not a qualification
 * rejection is forwarded to the reporter fiber would otherwise have captured,
 * so no other failure is quietened anywhere.
 *
 * `retryable` extends the same containment to the physics-context class on the
 * attempt that HAS a retry behind it: an unwrapped mount of a physics story is
 * expected to fail and is immediately re-run inside `<Physics paused>`, so
 * surfacing its first failure would put a red error badge on the editor for a
 * preview that then renders perfectly — the flooded-console half of the same
 * defect. The retry itself is NOT retryable, so a story that still fails under
 * real physics reports exactly as loudly as any other broken story.
 */
function createFilteredStoryRoot(
  canvas: HTMLCanvasElement,
  retryable: boolean,
  createRoot: StoryThreePreviewRuntime['createR3FRoot'],
): ReturnType<StoryThreePreviewRuntime['createR3FRoot']> {
  const globals = globalThis as ErrorReportingGlobal;
  const previous = globals.reportError;
  const forward: (error: unknown) => void =
    typeof previous === 'function'
      ? previous.bind(globalThis)
      : (error) => {
          // biome-ignore lint/suspicious/noConsole: fiber's own fallback when the environment has no `reportError`; anything that is not a qualification rejection must still surface exactly as it would have.
          console.error(error);
        };
  globals.reportError = (error: unknown) => {
    if (isQualifyInternalError(error)) return;
    if (retryable && isMissingPhysicsContext(error)) return;
    forward(error);
  };
  try {
    return createRoot(canvas);
  } finally {
    globals.reportError = previous;
  }
}

/**
 * A do-nothing stand-in for `THREE.WebGLRenderer`, enough for fiber's
 * `configure()` to accept it while `frameloop: 'never'` guarantees `render()`
 * is never called. Only the members fiber touches during configure/teardown
 * are present.
 */
function createStubRenderer(canvas: HTMLCanvasElement): Record<string, unknown> {
  return {
    domElement: canvas,
    xr: {
      enabled: false,
      addEventListener() {},
      removeEventListener() {},
      setAnimationLoop() {},
      getSession() {
        return null;
      },
    },
    shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    setPixelRatio() {},
    setSize() {},
    setClearColor() {},
    setClearAlpha() {},
    setViewport() {},
    setScissor() {},
    setScissorTest() {},
    setAnimationLoop() {},
    clear() {},
    render() {},
    compile() {},
    dispose() {},
    getPixelRatio() {
      return 1;
    },
    getContext() {
      // This non-rendering mount owns no GPU context. An empty object lies
      // to components checking for one before constructing postprocessing.
      return null;
    },
  };
}

let catalogueExtendedWith: StoryThreePreviewRuntime['extendThree'] | null = null;

/** A mount function valid inside an already-acquired story turn. Compound
 * callers receive it so they can mount repeatedly without recursively joining
 * the queue and deadlocking themselves. */
export type StoryMountInTurn = (
  Component: StoryPreviewComponent,
  props?: Record<string, unknown>,
) => Promise<MountedStoryObject3D>;

/**
 * Run one compound story-mount operation without any other mount interleaving.
 *
 * The queue itself is `story-mount-turn.ts` — shared with the canvas surface's
 * own preview mount, because the process-global loader state two mounts collide
 * over is not per-medium.
 */
export function withStoryMountTurn<T>(task: (mount: StoryMountInTurn) => Promise<T>): Promise<T> {
  return runInStoryMountTurn(() => task(mountStoryObject3DInTurn));
}

/** `extend(THREE)` once per session — it merges into a module-global catalogue,
 *  so repeating it per mount is wasted work, and it must run before ANY three
 *  intrinsic reconciles (see the module doc). */
function ensureThreeCatalogue(runtime: StoryThreePreviewRuntime): void {
  if (catalogueExtendedWith === runtime.extendThree) return;
  catalogueExtendedWith = runtime.extendThree;
  runtime.extendThree(runtime.three as unknown as Parameters<typeof runtime.extendThree>[0]);
}

/**
 * Mount one composed `three`/R3F story off-screen and return the named wrapper
 * group it rendered into (see {@link PREVIEW_ROOT_NAME}) plus a `dispose()`. The
 * group's children are exactly what the story rendered —
 * `captureObjectAssetPreview` traverses it and frames the renderable geometry.
 *
 * `props` are passed straight to the composed story, which is Storybook's own
 * portable-story contract for overriding args at render time (partial props
 * over the composed args — the same mechanism the story documents use for
 * its Inspector arg edits). Omitted, the story renders with its authored args.
 *
 * A story whose component uses `@react-three/rapier` is mounted a second time
 * inside a real `<Physics>` — see the module doc's "Physics" section for
 * why that retry is the shape, and why a story carrying its own `<Physics>`
 * never takes it.
 *
 * The returned mount is ALREADY SETTLED and its content time is held: every
 * mount runs one bounded {@link settleDesignWorld} before returning. Its
 * explicit `advance(dt)` handle is inert until a document transport chooses to
 * call it; mounting a story never starts content time by itself.
 */
export async function mountStoryObject3D(
  Component: StoryPreviewComponent,
  props: Record<string, unknown> = {},
): Promise<MountedStoryObject3D> {
  return withStoryMountTurn((mount) => mount(Component, props));
}

/** Dispose a standalone story mount in the same shared turn domain. Compound
 * callers already holding a turn (the board) dispose their raw mounts inside
 * that turn instead. */
export function disposeStoryObject3D(mounted: MountedStoryObject3D): Promise<void> {
  return withStoryMountTurn(async () => mounted.dispose());
}

/** The mount body for callers that already own the process-wide turn. */
async function mountStoryObject3DInTurn(
  Component: StoryPreviewComponent,
  props: Record<string, unknown> = {},
): Promise<MountedStoryObject3D> {
  const timed = viewportTimingsEnabled();
  lastMountPhases = null;
  const t0 = timed ? Date.now() : 0;
  const runtime = await resolveStoryThreePreviewRuntime();
  const runtimeMs = timed ? Date.now() - t0 : 0;
  // Loaders (Storybook 9 portable-story contract): must run before the first
  // render or the story's `loaded` data is empty. See the module doc and
  // `StoryPreviewMount.tsx`. Hoisted ABOVE the mount so the physics retry
  // below re-renders the story without re-running its loaders — `.load()` is
  // the story's own side-effecting setup (a `.glb` fetch, a Rapier init), and
  // running it twice for one preview is work nobody asked for.
  const tLoad = timed ? Date.now() : 0;
  if (typeof Component.load === 'function') await Component.load();
  const loadMs = timed ? Date.now() - tLoad : 0;

  try {
    return await mountStoryObject3DOnce(runtime, Component, props, undefined, {
      timed,
      runtimeMs,
      loadMs,
    });
  } catch (error) {
    if (!isMissingPhysicsContext(error)) throw error;
    const Physics = await loadPhysicsProvider(runtime);
    if (!Physics) throw error;
    return await mountStoryObject3DOnce(
      runtime,
      Component,
      props,
      (story) => runtime.createElement(Physics, { paused: false }, story),
      { timed, runtimeMs, loadMs },
    );
  }
}

/**
 * One mount attempt. Everything {@link mountStoryObject3D} documents happens
 * here; it exists separately only so the physics retry can re-run it with a
 * `wrap` around the story (and without re-running the story's loaders).
 */
async function mountStoryObject3DOnce(
  runtime: StoryThreePreviewRuntime,
  Component: StoryPreviewComponent,
  props: Record<string, unknown>,
  wrap?: (story: ReactNode) => ReactNode,
  phases?: { timed: boolean; runtimeMs: number; loadMs: number },
): Promise<MountedStoryObject3D> {
  ensureThreeCatalogue(runtime);

  // A detached canvas — never added to the document. Fiber needs a canvas
  // handle for `createRoot`; nothing ever draws to it (stub renderer +
  // `frameloop: 'never'`).
  const canvas = document.createElement('canvas');
  // An UNWRAPPED attempt always has the physics retry behind it (see
  // `mountStoryObject3D`), which is exactly what makes its physics-context
  // failure containable rather than reportable.
  const root = createFilteredStoryRoot(canvas, wrap === undefined, runtime.createR3FRoot);

  let resolveState!: (state: RootState) => void;
  const statePromise = new Promise<RootState>((resolve) => {
    resolveState = resolve;
  });

  await root.configure({
    gl: (() => createStubRenderer(canvas)) as never,
    frameloop: 'never',
    size: { width: 128, height: 96, top: 0, left: 0 },
    onCreated: (state) => resolveState(state),
  });

  // A reconcile crash is reported by the boundary, not by a throw fiber lets
  // through (see {@link CrashNullBoundary}) — turn it into an immediate
  // rejection so a non-`three` story answers in milliseconds.
  let reconcileError: Error | null = null;
  let rejectOnReconcileError!: (reason: Error) => void;
  const reconcileFailure = new Promise<never>((_, reject) => {
    rejectOnReconcileError = reject;
  });
  const reportReconcileError = (error: unknown): void => {
    reconcileError ??= new Error(
      'mountStoryObject3D: the story threw while reconciling into an R3F root — it does not ' +
        'render `three` content (a DOM/React story), or its component crashed. Original error: ' +
        String(error instanceof Error ? error.message : error),
      { cause: error },
    );
    rejectOnReconcileError(reconcileError);
  };

  // Render the story INTO a named wrapper group so its root `Object3D` is
  // extractable by name (point: a stable capture subject, not the whole scene).
  const story = runtime.createElement(Component, props);
  // The probe reports after commit whether physics can change the authored
  // pose. A mesh with no provider, and a fixed-only physics world, must not pay
  // the worker quiet-wait and "never observed motion" budget.
  let hasPhysicsSubscriber = false;
  const notePhysicsSubscriber = (hasPhysics: boolean): void => {
    hasPhysicsSubscriber = hasPhysics;
  };
  root.render(
    runtime.createElement(
      'group',
      { name: PREVIEW_ROOT_NAME },
      runtime.createElement(
        CrashNullBoundary,
        { onCaught: reportReconcileError },
        runtime.createElement(
          PhysicsSubscriberProbe,
          { onReport: notePhysicsSubscriber },
          // The physics retry's `<Physics paused>` goes INSIDE the boundary, so a
          // story that still fails under it reports through the same path.
          wrap ? wrap(story) : story,
        ),
      ),
    ),
  );

  // Neither committing nor throwing — a story still suspended on a slow load,
  // or a hung render. The last-resort ceiling (the same guard
  // `r3f-adapter.tsx` uses); see {@link ONCREATED_TIMEOUT_MS}.
  const tFiber = phases?.timed ? Date.now() : 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const state = await Promise.race([
    statePromise,
    reconcileFailure,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              'mountStoryObject3D: onCreated did not fire within 10s — the story never reached ' +
                'its first R3F commit and never threw. Either it is still SUSPENDED on a slow ' +
                'load (a suspending loader with no <Suspense> boundary holds the first commit ' +
                'until its content is ready), or its render is hung.',
            ),
          ),
        ONCREATED_TIMEOUT_MS,
      );
    }),
  ])
    .catch((reason: unknown) => {
      if (phases?.timed) {
        lastMountPhases = {
          runtimeMs: phases.runtimeMs,
          loadMs: phases.loadMs,
          fiberMs: Date.now() - tFiber,
          settleMs: 0,
        };
      }
      root.unmount();
      throw reason;
    })
    .finally(() => clearTimeout(timer));

  // `componentDidCatch` and `onCreated` can both fire for the SAME commit (the
  // boundary's fallback commits successfully), so a resolved race does not by
  // itself mean the story rendered. The captured error is the authority.
  if (reconcileError) {
    root.unmount();
    throw reconcileError;
  }

  // Fiber's clock leaks wall time into `useFrame` deltas via `getDelta()` unless
  // stopped. The Asset Lab host may advance this root later, but only with its
  // own deterministic document delta through the `advance` handle below.
  state.clock.autoStart = false;
  state.clock.stop();

  const previewRoot = state.scene.getObjectByName(PREVIEW_ROOT_NAME);
  if (!previewRoot) {
    root.unmount();
    throw new Error(
      `mountStoryObject3D: the story's wrapper group ("${PREVIEW_ROOT_NAME}") is not in the ` +
        'scene after its first commit — the story rendered nothing mountable.',
    );
  }

  // THE ONE BOUNDED SETTLE (`authoring/design-time-settle.ts`) — the same
  // mechanism, constants and rest test the Scene view's design session runs, on
  // the same seam (the world's own tick). Without it a physics-owned story shows
  // a spawn pose the game never has, and for a raycast vehicle the wheels are
  // never placed at all. After it returns, nothing advances this mount again.
  const fiberMs = phases?.timed ? Date.now() - tFiber : 0;
  const tSettle = phases?.timed ? Date.now() : 0;
  await settleDesignWorld({
    scene: previewRoot,
    update: (deltaSeconds) => {
      state.advance(state.clock.elapsedTime + Math.min(deltaSeconds, 0.1), false);
    },
    hasPhysicsSubscriber,
  });
  if (phases?.timed) {
    lastMountPhases = {
      runtimeMs: phases.runtimeMs,
      loadMs: phases.loadMs,
      fiberMs,
      settleMs: Date.now() - tSettle,
    };
  }

  let explicitContentTime = state.clock.elapsedTime;

  return {
    root: previewRoot,
    scene: state.scene,
    advance(deltaSeconds): void {
      if (!(deltaSeconds > 0) || !Number.isFinite(deltaSeconds)) return;
      explicitContentTime += Math.min(deltaSeconds, 0.1);
      state.advance(explicitContentTime, false);
    },
    dispose(): void {
      root.unmount();
    },
  };
}

/** Options for {@link captureStoryComponentThumbnail}, mirroring the asset
 *  browser's own live-instance capture dimensions. */
export interface StoryThumbnailOptions {
  readonly width?: number;
  readonly height?: number;
  /** Arg overrides for the composed story — see {@link mountStoryObject3D}'s
   *  `props`. A card photographed with edited args must photograph THOSE args. */
  readonly props?: Record<string, unknown>;
  /** Free capture camera, forwarded to `captureObjectAssetPreview` — one view
   *  from the chosen angle instead of the default perspective view. */
  readonly camera?: import('@volter/editor-sdk').AssetPreviewCameraChoice;
  /** Clip pose, forwarded to `captureObjectAssetPreview` — sample a named
   *  clip at a time on the capture snapshot before framing. */
  readonly pose?: import('@volter/editor-sdk').AssetPreviewPose;
}

/**
 * The thumbnail entry point: mount a `three` prefab's story off-screen, capture a
 * perspective thumbnail from the resulting root `THREE.Object3D` via
 * `captureObjectAssetPreview`, then tear the
 * off-screen root down. Returns a `data:` URL.
 *
 * Requires a real WebGL context (`captureObjectAssetPreview` builds a
 * `WebGLRenderer`), so it throws under jsdom — the caller gates on
 * {@link supportsThreeStoryCapture} exactly as the asset browser gates its
 * live capture, and honestly keeps the glyph when capture is unavailable.
 */
export async function captureStoryComponentThumbnail(
  Component: StoryPreviewComponent,
  options: StoryThumbnailOptions = {},
): Promise<string> {
  const mounted = await mountStoryObject3D(Component, options.props ?? {});
  try {
    const capture = captureObjectAssetPreview(mounted.root, {
      width: options.width ?? 128,
      height: options.height ?? 96,
      ...(options.camera === undefined ? {} : { camera: options.camera }),
      ...(options.pose === undefined ? {} : { pose: options.pose }),
    });
    const image = capture.views.find((view) => view.view === 'perspective') ?? capture.views[0];
    if (!image) throw new Error('Story preview capture returned no views.');
    return `data:${image.mimeType};base64,${image.base64}`;
  } finally {
    await disposeStoryObject3D(mounted);
  }
}

/** Whether a WebGL snapshot can be taken here — the same environment gate the
 *  asset browser applies to its live-instance capture (jsdom has no real WebGL, so
 *  the off-screen render still builds the graph but a snapshot cannot be
 *  rasterized). */
export function supportsThreeStoryCapture(): boolean {
  return (
    typeof WebGLRenderingContext !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !navigator.userAgent.toLowerCase().includes('jsdom')
  );
}
