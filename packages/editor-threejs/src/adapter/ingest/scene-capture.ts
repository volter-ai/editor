/**
 * Scene capture — the core primitive of unmodified-game ingestion.
 *
 * An external three.js game owns its own renderer, `Scene`, camera, and render
 * loop. To let the editor inspect/edit that live scene WITHOUT touching the
 * game's code, we need a handle to the game's `Scene`+camera the moment it
 * first renders. For WebGL, the robust way to obtain it is an **accessor trap**
 * on `WebGLRenderer.prototype.render`:
 *
 *   - `WebGLRenderer` assigns `this.render` as an OWN instance property inside
 *     its constructor (not on the prototype), and `THREE.WebGLRenderer` is a
 *     read-only module export (can't subclass-swap it). A naive "wrap render"
 *     hook therefore captures nothing.
 *   - Installing a getter/setter for `render` on the PROTOTYPE means the
 *     constructor's `this.render = realFn` hits our setter (the instance has no
 *     own `render` yet), we stash the real fn, and our getter returns a wrapper
 *     that captures `(scene, camera, renderer)` on the first real frame.
 *
 * This is the hardened, typed form of the `ingest-study` spike
 * (`docs/ingest-study-spike/vgai-ingest-adapter.js`), proven against an
 * unmodified `three.js/examples/games_fps` game.
 *
 * DOM-backed addon renderers use ordinary prototype methods instead. The host
 * supplies those exact shared classes through `additionalRendererCtors`, and
 * the same observer captures their `(scene, camera)` pair without inventing a
 * second world model. CSS3DRenderer is the first implementer.
 *
 * CRITICAL: every trap must be installed on the SAME `three` module/addon
 * instance the game uses. In a bundler/dev-server that dedupes `three` (one
 * `node_modules/three`), an external ESM game's imports resolve to those shared
 * classes. A game that bundles its own copy cannot be captured this way (the
 * module-identity gatekeeper).
 *
 * There is an OPTIONAL, ADDITIVE composer capture: a game rendering through
 * its own three.js addon `EffectComposer`
 * (`three/examples/jsm/postprocessing/EffectComposer.js`) still trips the `render`
 * trap above (its `RenderPass` calls `renderer.render(scene,camera)` internally),
 * but the renderer holds no reference back to the composer, so the host previously
 * could not resize the composer's own (intentionally non-1:1,
 * progressively-downsampled — see `UnrealBloomPass`) render targets when the host
 * resizes the game's pane. Unlike `WebGLRenderer`, `EffectComposer` is a plain ES
 * class whose methods (including `render`) live on the PROTOTYPE, not assigned as
 * own instance properties in the constructor — so a direct method-wrapper (no
 * getter/ setter indirection) on `EffectComposer.prototype.render` is sufficient:
 * it calls through to the real `render`, then — AFTER that call, so any nested
 * `renderer.render()` the pass makes has already hit the trap above and set
 * `captured` — records `this` (the composer instance) if its `.renderer` is the
 * captured one. This is deduped/shared-trappable for the same reason
 * `WebGLRenderer` is: `EffectComposer.js` is a FILE inside the same `three`
 * package tree Vite's `resolve.dedupe: ['three', …]` already collapses to one
 * instance — not a separate package with its own dedupe question. Proven live
 * against the `bloom-composer` fixture
 * (`docs/f13-bloom-composer-proof/record-fixed.mjs`).
 */

import type * as THREE from 'three';
import {
  type CaptureWaitOptions,
  documentVisibilityClock,
  startVisibleCaptureWindow,
  type VisibilityClock,
} from './visible-capture-window';

/** The renderer operations the ingest host may lawfully use after capture.
 * WebGLRenderer supplies every member; DOM-backed Three addon renderers such as
 * CSS3DRenderer deliberately omit the WebGL-only lifecycle operations. */
export interface CapturedThreeRenderer {
  readonly domElement: HTMLElement;
  readonly info?: THREE.WebGLInfo | undefined;
  render(scene: THREE.Scene, camera: THREE.Camera): unknown;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setAnimationLoop?(callback: ((time: number) => void) | null): void;
  dispose?(): void;
  getPixelRatio?(): number;
  getContext?(): unknown;
  getRenderTarget?(): unknown;
}

/** A live runtime captured from an external game on its first rendered frame. */
export interface CapturedRuntime {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: CapturedThreeRenderer;
}

/** Options for {@link installSceneCapture}. */
export interface SceneCaptureOptions {
  /**
   * Additional shared Three addon renderer classes whose prototype `render`
   * method carries the same `(scene, camera)` pair as WebGLRenderer. CSS3DRenderer
   * is the first implementer. The caller must pass the exact class its game
   * imports; a bundled private copy remains deliberately uncapturable.
   */
  additionalRendererCtors?: readonly unknown[];
  /**
   * True when `renderer` is one the HOST constructed for its own drawing.
   *
   * The trap lives on the shared `WebGLRenderer.prototype` — that sharing is
   * the whole mechanism — so the host's renders arrive here too, and the trap
   * captures the first scene it sees. Any host renderer built after the trap
   * installs (the editor bakes model thumbnails and asset previews on demand,
   * each with its own offscreen renderer and its own little light rig) is a
   * candidate to be captured AS THE GAME.
   *
   * That is what made the "a game bundling its own three is DETECTED, never
   * silently mistaken for a capture" spec
   * pass or fail on timing alone: whether a thumbnail happened to bake inside
   * the game's capture window. When it did, the editor adopted its own
   * preview scene as the game and the mount reported success.
   *
   * Identity, not shape, is the discriminator: a host renderer and a game
   * renderer are the same class, both built after install, both drawing real
   * scenes. The host is the only party that knows which is which, so it says
   * so (`@vgai/threejs/viewport/renderer-ownership`).
   */
  isHostRenderer?: (renderer: unknown) => boolean;
  /**
   * The game's OWN declared world, read from its contract
   * (`window.vgaiGame` — the host passes a reader, never a cached value, because
   * the contract is declared by the game's modules and may not exist yet when
   * the trap installs).
   *
   * When it answers non-null, the DECLARATION decides: only a render of that
   * scene is adopted, and first-render-wins never runs. When it answers null —
   * the case for every game that declares nothing — behaviour is unchanged and
   * the adoption is reported as `measured`.
   */
  declaredScene?: () => unknown;
  /**
   * How the world was adopted, and every DISTINCT world seen afterwards.
   *
   * First-non-host-render-wins is a good measured default and a permanent,
   * SILENT commitment: a splash scene, a shadow pre-pass, or a
   * render-to-texture warm-up that happens to draw first is adopted as the game
   * forever, and the real world that renders one frame later reaches no reader
   * at all. This is that reader. It never changes which world is adopted — it
   * makes the ambiguity a recorded fact (`packages/editor/src/world-adoption.ts`
   * publishes it to `vgai status`).
   *
   * Post-processing games legitimately render several (scene, camera) pairs per
   * frame, so alternates are INFORMATION, never an error. Host renders are
   * excluded by the same `isHostRenderer` declaration the adoption itself uses.
   */
  onWorldAdoption?: (event: WorldAdoptionEvent) => void;
}

/**
 * One world-adoption fact. `adopted` fires exactly once, when the trap commits
 * to a (scene, camera, renderer) triple; `alternate` fires for each DISTINCT
 * triple seen afterwards, up to {@link MAX_RECORDED_ALTERNATES}.
 */
export type WorldAdoptionEvent =
  | {
      readonly phase: 'adopted';
      /** `declared` = the contract named this scene; `measured` = first render won. */
      readonly source: 'declared' | 'measured';
      readonly sceneId: string;
      readonly cameraId: string;
    }
  | {
      readonly phase: 'alternate';
      readonly sceneId: string;
      readonly cameraId: string;
      /** `false` ⇒ a SECOND renderer is drawing, which is the stronger signal. */
      readonly sameRenderer: boolean;
      /** Draws observed when this alternate first appeared — how far past the
       *  adoption it is, without a wall clock. */
      readonly drawCount: number;
    };

/**
 * How many distinct alternates are recorded before the trap stops looking.
 *
 * The bound is the point: this runs inside the game's own render call, and a
 * post-processing chain can present a new (scene, camera) pair every frame. A
 * handful names the ambiguity; an unbounded set would turn a diagnostic into a
 * leak on the hottest path in the process.
 */
export const MAX_RECORDED_ALTERNATES = 8;

/** A three object's identity, as a string a status facet can carry. `type` is
 *  what a reader recognizes ("Scene", "PerspectiveCamera"); `uuid` is what
 *  makes two of the same type tellable apart. */
function objectId(value: unknown): string {
  const obj = value as { type?: unknown; uuid?: unknown } | null | undefined;
  const type = typeof obj?.type === 'string' ? obj.type : 'unknown';
  const uuid = typeof obj?.uuid === 'string' ? obj.uuid : '(no uuid)';
  return `${type}:${uuid}`;
}

/**
 * Brackets ONE `render()` call the captured renderer makes.
 *
 * The trap already stands between an ingested game and its own
 * `WebGLRenderer.render`, which is the only place a host can see the game's
 * render pass begin and end — the game owns its loop, so nothing else in the
 * editor gets a `finally` around it. That is exactly the bracket
 * `dev/render-debug-adapter.ts`'s `beforeRender`/`afterRender` need, so the
 * first-party `RenderDebugAdapter` works for an ingested game with no per-game
 * shimming and no second capture mechanism.
 *
 * Neither hook may throw: they run inside the game's own render call, so an
 * exception here would break the game's frame. The trap calls them in a
 * `try`/`finally` for `after`, but a throwing `before` is the hook author's bug.
 */
export interface RenderPassHooks {
  before(): void;
  after(): void;
}

/**
 * Options for {@link SceneCaptureHandle.waitForCapture} — declared with the
 * window they configure (`visible-capture-window.ts`), because they configure
 * the WAIT and not this surface, and re-exported here for the callers that
 * look for them beside `waitForCapture`.
 */
export type { CaptureWaitOptions };

/**
 * WHICH interception yielded the captured renderer. Not decoration: every
 * coverage row the host prints names the mechanism it reached the game
 * through, and the two are materially different — a `shared-three` game runs
 * on the host's very `three` instance, while a `devtools-observer` game runs
 * its OWN pinned revision and only its renderer is shared.
 */
export type CaptureMechanism = 'shared-three' | 'devtools-observer';

/** Handle returned by {@link installSceneCapture}. */
export interface SceneCaptureHandle {
  /** The captured runtime, or null until the game renders its first frame. */
  readonly captured: CapturedRuntime | null;
  /** How {@link captured} was reached; `null` while nothing is captured. */
  readonly capturedVia: CaptureMechanism | null;
  /**
   * Install (or clear, with `null`) hooks bracketing every `render()` the
   * CAPTURED renderer makes. Set AFTER capture, because the consumer
   * (`RenderDebugAdapter`) is built from the captured scene and context. Only
   * the captured renderer's renders are bracketed — the editor's own viewport
   * renders come through the same trap and are not the game's frame.
   */
  setRenderPassHooks(hooks: RenderPassHooks | null): void;
  /**
   * Resolve once a scene+camera is captured.
   *
   * The timeout is a budget of **visible** time, not wall-clock time: a hidden
   * document cannot render (the browser parks rAF), so counting hidden time
   * against the game is counting time it was not allowed to use. The wait
   * therefore PARKS while `document.hidden` and resumes on `visibilitychange`
   * — see `visible-capture-window.ts` for the whole argument. Rejects only
   * when the window is spent with the document VISIBLE.
   */
  waitForCapture(options?: number | CaptureWaitOptions): Promise<CapturedRuntime>;
  /** Total `render()` calls observed through the trap (a liveness signal). */
  getDrawCount(): number;
  /** The game's last (non-null) `setAnimationLoop` callback for a renderer, so the
   *  host can pause (set null) and resume (re-set it) the game's own loop. */
  getAnimationLoop(renderer: CapturedThreeRenderer): ((time: number) => void) | null;
  /**
   * Resize every captured `EffectComposer` that renders
   * through the captured renderer to `w`×`h`, matching its pixel ratio to
   * `renderer.getPixelRatio()` — the composer tracks whatever DPR policy the
   * host already applies to the renderer; no separate knob. A no-op when no
   * `effectComposerCtor` was passed to {@link installSceneCapture} (or no
   * composer of that ctor has rendered through the captured renderer yet) —
   * a non-composer game is unaffected.
   */
  resizeComposers(w: number, h: number): void;
  /** Remove the trap and restore the captured renderer's real `render`. */
  uninstall(): void;
}

// Minimal structural type for the bits of the THREE namespace we touch, so this
// module never imports a concrete `three` (it must trap the CALLER's instance).
interface ThreeLike {
  WebGLRenderer: { prototype: Record<string, unknown> };
}

/**
 * A three renderer instance reached through three's OWN devtools seam, rather
 * than through a prototype the host shares with the game.
 *
 * Only the two constructor-assigned own methods this file already traps on the
 * shared prototype are named — nothing else about a foreign instance is
 * assumed, because nothing else about it is known.
 */
interface ForeignRendererLike {
  render?: unknown;
  setAnimationLoop?: unknown;
  domElement?: unknown;
}

/** What {@link observeForeignThreeRenderers} needs from the enclosing capture,
 *  passed in rather than closed over so this stays a top-level function. */
interface ForeignObserverPorts {
  /** True when this renderer's `render` was already intercepted by the shared
   *  prototype trap — i.e. it belongs to the host's OWN `three`, which is
   *  already captured properly and must not be double-wrapped. */
  alreadyTrapped(renderer: object): boolean;
  isHostRenderer(renderer: unknown): boolean;
  /** The same `(self, scene, camera)` observation the prototype trap makes. */
  observeRender(self: unknown, real: (...args: unknown[]) => unknown, args: unknown[]): unknown;
  /** Record a non-null animation-loop callback (hidden-tab pumping). */
  recordLoop(renderer: object, callback: (time: number) => void): void;
}

/**
 * FOREIGN-INSTANCE CAPTURE — through three's own `__THREE_DEVTOOLS__` seam.
 *
 * The prototype trap above can only reach a game that resolves `three` to the
 * host's instance ("the module-identity gatekeeper" in this file's header). A
 * game vendored as a BUILT BUNDLE routinely does not: a webpack/CRA build
 * inlines three outright, and a Vite build externalized to the game's own
 * pinned `three-rNNN.module.js` loads a second ES module. Those games rendered
 * a real picture the host could not see, and the mount failed by name.
 *
 * The canvas lane already answers this exact question and answers it the same
 * way: `authoring/canvas-runtime-recognition.ts` recognizes Phaser and Babylon
 * through THEIR OWN documented public registries (`Phaser.GAMES`,
 * `BABYLON.Engine.Instances`) rather than by sharing a module instance. three's
 * equivalent public registry is `__THREE_DEVTOOLS__`: every `WebGLRenderer`
 * constructor since r118 ends with
 *
 *   if ( typeof __THREE_DEVTOOLS__ !== 'undefined' )
 *     __THREE_DEVTOOLS__.dispatchEvent( new CustomEvent( 'observe', { detail: this } ) );
 *
 * — a bare global lookup, so it is not affected by the game-globals lexical
 * shadow, and it is present in every revision this repo vendors (r129, r155,
 * r170) as well as the host's own r180. Setting that global before the game's
 * modules evaluate therefore hands the host the game's renderer INSTANCE, and
 * an own-property wrapper on that instance's `render` yields the identical
 * `(scene, camera, renderer)` triple the prototype trap yields.
 *
 * This never changes what happens for a deduped game: such a renderer's own
 * `render` assignment was already intercepted by the prototype setter, so
 * `alreadyTrapped` skips it and there is exactly one interception per renderer.
 *
 * Returns its own teardown. If something else already installed
 * `__THREE_DEVTOOLS__` (the real three.js devtools extension), we listen on it
 * and leave it in place.
 */
function observeForeignThreeRenderers(ports: ForeignObserverPorts): () => void {
  const host = globalThis as { __THREE_DEVTOOLS__?: EventTarget };
  if (typeof EventTarget !== 'function') return () => undefined;
  const weInstalled = host.__THREE_DEVTOOLS__ === undefined;
  if (weInstalled) host.__THREE_DEVTOOLS__ = new EventTarget();
  const target = host.__THREE_DEVTOOLS__;
  if (!target) return () => undefined;
  const restores: Array<() => void> = [];

  function wrapOwn(instance: object, key: 'render' | 'setAnimationLoop', value: unknown): void {
    const prior = (instance as Record<string, unknown>)[key];
    Object.defineProperty(instance, key, {
      configurable: true,
      writable: true,
      value,
    });
    restores.push(() => {
      Object.defineProperty(instance, key, { configurable: true, writable: true, value: prior });
    });
  }

  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail as ForeignRendererLike | null;
    // `observe` also carries Scenes (r129/r155/r170 dispatch from the `Scene`
    // constructor too). A renderer is the one that owns a canvas and a render
    // method; anything else is not this observer's subject.
    if (!detail || typeof detail !== 'object') return;
    if (typeof detail.render !== 'function' || !detail.domElement) return;
    if (ports.alreadyTrapped(detail)) return;
    if (ports.isHostRenderer(detail)) return;
    const realRender = detail.render as (...args: unknown[]) => unknown;
    wrapOwn(detail, 'render', function (this: unknown, ...args: unknown[]) {
      return ports.observeRender(detail, realRender, args);
    });
    const realSal = detail.setAnimationLoop;
    if (typeof realSal === 'function') {
      const sal = realSal as (...args: unknown[]) => unknown;
      wrapOwn(detail, 'setAnimationLoop', function (this: unknown, callback: unknown) {
        if (typeof callback === 'function') {
          ports.recordLoop(detail, callback as (time: number) => void);
        }
        return sal.call(detail, callback);
      });
    }
  };

  target.addEventListener('observe', listener);
  return () => {
    target.removeEventListener('observe', listener);
    for (const restore of restores.splice(0)) restore();
    if (weInstalled) delete host.__THREE_DEVTOOLS__;
  };
}

// Minimal structural type for the bits of an `EffectComposer` instance we
// touch. This module never imports a concrete `three/examples/jsm/…` addon
// either — the caller passes the SAME class its ingested game imports, so the
// trap lands on the instance the game actually constructs.
interface ComposerLike {
  renderer?: unknown;
  setSize(width: number, height: number): void;
  setPixelRatio(pixelRatio: number): void;
}

interface EffectComposerCtorLike {
  prototype: { render?: (...args: unknown[]) => unknown };
}

interface PrototypeRendererCtorLike {
  prototype: { render?: (...args: unknown[]) => unknown };
}

/**
 * Install the render accessor trap on `threeNamespace.WebGLRenderer.prototype`.
 * Pass the host's `three` module so the game (which shares it) is trapped.
 *
 * `effectComposerCtor` is OPTIONAL: pass the host's
 * `EffectComposer` class (`three/examples/jsm/postprocessing/EffectComposer.js`)
 * to also trap composer construction/rendering on that shared addon, so
 * `resizeComposers()` can reach it. Omitting it (or a game never constructing
 * one) leaves capture byte-identical to before this wave.
 *
 * Idempotent per call site is NOT guaranteed — install once per ingest session
 * and `uninstall()` on teardown.
 */
export function installSceneCapture(
  threeNamespace: unknown,
  effectComposerCtor?: unknown,
  opts?: SceneCaptureOptions,
): SceneCaptureHandle {
  const THREE_NS = threeNamespace as ThreeLike;
  const proto = THREE_NS.WebGLRenderer.prototype;

  // Stash the real render fn per-instance under a unique symbol so multiple
  // renderers (editor's + game's) never collide.
  const REAL = Symbol('vgai.realRender');

  let captured: CapturedRuntime | null = null;
  let drawCount = 0;
  /** Memoized answer of `opts.declaredScene` — asked each render until it
   *  answers, because a game declares its contract from its own modules and may
   *  not have run yet when the trap installs. Once it answers, it is fixed:
   *  a declaration that changes mid-boot is not a thing the host chases. */
  let declaredScene: unknown = null;
  /** Distinct alternates already reported, keyed by the same triple identity the
   *  event carries — see {@link MAX_RECORDED_ALTERNATES} for why it is bounded. */
  const seenAlternates = new Set<string>();
  /** Set post-capture by the host; see {@link SceneCaptureHandle.setRenderPassHooks}. */
  let renderPassHooks: RenderPassHooks | null = null;
  const waiters: Array<(rt: CapturedRuntime) => void> = [];

  // Preserve any descriptor already on the prototype so uninstall can restore it.
  const priorDescriptor = Object.getOwnPropertyDescriptor(proto, 'render');

  // Trap setAnimationLoop to record each renderer's game loop callback, so the host
  // can freeze (set null) and resume (re-set) the game's own rAF for stable editing.
  // CRITICAL: like `render`, WebGLRenderer assigns `this.setAnimationLoop` as an OWN
  // instance property in its constructor — NOT on the prototype. A naive value-wrapper
  // on the prototype is therefore shadowed by the instance's own property and never
  // runs (resume could never recover the callback). So we mirror the `render` trap: a
  // prototype getter/setter. The constructor's `this.setAnimationLoop = realFn` hits
  // our SETTER (the instance has no own property yet) and we stash realFn per-instance;
  // the GETTER returns a wrapper that records each non-null callback before forwarding.
  const REAL_SAL = Symbol('vgai.realSetAnimationLoop');
  const loopCallbacks = new WeakMap<object, (time: number) => void>();
  const loopedRenderers = new Set<object>();
  /** Visibility clock of the in-flight `waitForCapture`, if any. */
  let waitingVisibility: VisibilityClock | null = null;
  const priorSAL = Object.getOwnPropertyDescriptor(proto, 'setAnimationLoop');

  function pumpHiddenLoops(): void {
    if (
      captured ||
      !waitingVisibility ||
      !(waitingVisibility.suspended?.() ?? waitingVisibility.hidden())
    ) {
      return;
    }
    for (const renderer of loopedRenderers) {
      try {
        loopCallbacks.get(renderer)?.(0);
      } catch {
        /* a throwing game frame must not kill the waiter */
      }
      if (captured) return;
    }
  }

  Object.defineProperty(proto, 'setAnimationLoop', {
    configurable: true,
    set(this: Record<symbol, unknown>, fn: unknown) {
      this[REAL_SAL] = fn;
    },
    get(this: Record<symbol, unknown>) {
      const self = this;
      return function setAnimationLoop(this: unknown, cb: unknown) {
        if (cb) recordAnimationLoop(self as object, cb as (time: number) => void);
        const real = self[REAL_SAL];
        return typeof real === 'function'
          ? (real as (...a: unknown[]) => unknown).call(self, cb)
          : undefined;
      };
    },
  });

  /**
   * Call the renderer's own real `render`, bracketed by the render-pass hooks
   * when this IS the captured game's renderer (see `setRenderPassHooks`).
   * `after` runs in a `finally`, so a throwing game frame still restores
   * whatever the hook armed.
   */
  function bracketedRender(
    self: unknown,
    real: (...a: unknown[]) => unknown,
    args: unknown[],
  ): unknown {
    const hooks = renderPassHooks;
    if (hooks === null || !captured || self !== captured.renderer) {
      return real.apply(self, args);
    }
    hooks.before();
    try {
      return real.apply(self, args);
    } finally {
      hooks.after();
    }
  }

  function forwardRender(self: Record<symbol, unknown>, args: unknown[]): unknown {
    return bracketedRender(self, self[REAL] as (...a: unknown[]) => unknown, args);
  }

  /** Register a game's animation-loop callback, whichever trap saw it. */
  function recordAnimationLoop(renderer: object, callback: (time: number) => void): void {
    loopCallbacks.set(renderer, callback);
    loopedRenderers.add(renderer);
    // Hidden tabs park rAF. Play/eval still need a first frame, so when a
    // waiter is parked we drive the game's own loop once — the same class of
    // tick `waitSimTime` already uses for a hidden document.
    queueMicrotask(pumpHiddenLoops);
  }

  /**
   * Commit to a world, DECLARATION FIRST.
   *
   * First-non-host-render-wins is the measured default and a permanent one, so
   * a game that states which scene is its world is not made to race its own
   * splash screen. `declaredScene` is asked until it answers (the game's own
   * modules declare the contract, and may not have run when the trap installed);
   * once it does, only that scene is adopted.
   */
  function adoptWorld(self: unknown, scene: unknown, camera: unknown): void {
    if (declaredScene === null) declaredScene = opts?.declaredScene?.() ?? null;
    if (declaredScene !== null && declaredScene !== scene) return;
    captured = {
      scene: scene as THREE.Scene,
      camera: camera as THREE.Camera,
      renderer: self as CapturedThreeRenderer,
    };
    opts?.onWorldAdoption?.({
      phase: 'adopted',
      source: declaredScene === null ? 'measured' : 'declared',
      sceneId: objectId(scene),
      cameraId: objectId(camera),
    });
    for (const resolve of waiters.splice(0)) resolve(captured);
  }

  /**
   * A DISTINCT world drew after the adopted one. Recorded, never acted on:
   * which world is adopted does not change (that would break every handle the
   * host already built from it) — but the reader stops being the only party who
   * could have noticed. Deduped and bounded because this is the game's own
   * render call.
   */
  function recordAlternateWorld(self: unknown, scene: unknown, camera: unknown): void {
    if (!captured || seenAlternates.size >= MAX_RECORDED_ALTERNATES) return;
    if (scene === captured.scene && camera === captured.camera) return;
    const sameRenderer = self === captured.renderer;
    const key = `${objectId(scene)}|${objectId(camera)}|${sameRenderer}`;
    if (seenAlternates.has(key)) return;
    seenAlternates.add(key);
    opts?.onWorldAdoption?.({
      phase: 'alternate',
      sceneId: objectId(scene),
      cameraId: objectId(camera),
      sameRenderer,
      drawCount,
    });
  }

  /** Observe the common `(scene, camera)` render contract once, regardless of
   * whether it came from WebGLRenderer's constructor-assigned method or an
   * addon's ordinary prototype method. */
  function observeRendererRender(self: unknown, scene: unknown, camera: unknown): void {
    if (!captured || self === captured.renderer) drawCount++;
    if (opts?.isHostRenderer?.(self) === true) return;
    if (!(scene as { isScene?: boolean })?.isScene) return;
    if (captured) recordAlternateWorld(self, scene, camera);
    else adoptWorld(self, scene, camera);
  }

  Object.defineProperty(proto, 'render', {
    configurable: true,
    set(this: Record<symbol, unknown>, fn: unknown) {
      this[REAL] = fn;
    },
    get(this: Record<symbol, unknown>) {
      const self = this;
      return function render(this: unknown, ...args: unknown[]) {
        const [scene, camera] = args;
        // Attribute the draw to the GAME, not to whoever shares this prototype.
        // The trap patches `WebGLRenderer.prototype.render` on the editor's own
        // three, so the EDITOR viewport's renders land here too. Counting them
        // made `getDrawCount()` climb while the ingested game was paused, which
        // is what the pause assertions in `14-ingest-feature-matrix` were
        // measuring — the loop gate was doing its job (both games use
        // `setAnimationLoop`, so they ARE gateable) and the instrument was
        // reporting someone else's frames. Before capture every render still
        // counts: that is how the first game frame is detected at all.
        // Never capture a scene the HOST owns. The trap sits on the shared
        // `WebGLRenderer.prototype`, so the editor's own viewport renders
        // arrive here too — and when a game bundles its own MISMATCHED three,
        // the editor's scene is then the only thing that ever reaches the trap.
        // It was duly "captured" as the game: the editor got a hierarchy of
        // its own GridHelper, BatchedRenderer and viewport lights presented as
        // the ingested game's content, and the mount reported success.
        // Whether that happened at all came down to whether the editor
        // rendered a frame inside the game's capture window, so the same
        // session could pass or fail on timing alone.
        observeRendererRender(self, scene, camera);
        return forwardRender(self, args);
      };
    },
  });

  // A game that does NOT share the host's `three` never reaches the prototype
  // trap above. three's own devtools seam reaches it anyway — see
  // {@link observeForeignThreeRenderers}.
  const foreignRenderers = new WeakSet<object>();
  const stopForeignObserver = observeForeignThreeRenderers({
    alreadyTrapped: (renderer) => (renderer as Record<symbol, unknown>)[REAL] !== undefined,
    isHostRenderer: (renderer) => opts?.isHostRenderer?.(renderer) === true,
    observeRender: (self, real, args) => {
      foreignRenderers.add(self as object);
      observeRendererRender(self, args[0], args[1]);
      return bracketedRender(self, real, args);
    },
    recordLoop: recordAnimationLoop,
  });

  // DOM-backed Three renderers (CSS3DRenderer is the first): trap only classes
  // explicitly supplied by the host, and restore each byte-for-byte. Two
  // shapes exist across three revisions and both are met: an ordinary
  // prototype `render` is wrapped in place; a CONSTRUCTOR-ASSIGNED `render`
  // (r180's CSS3DRenderer does `this.render = function …` exactly like
  // WebGLRenderer, so the prototype carries none) gets the same
  // getter/setter trap the WebGLRenderer path uses — the constructor's
  // assignment hits the setter, the getter hands back the observing wrapper.
  // Skipping that shape silently was measured as "the game never rendered"
  // on css3d_periodictable while 118 of its elements sat in the DOM.
  const additionalRendererRestores: Array<() => void> = [];
  for (const candidate of opts?.additionalRendererCtors ?? []) {
    const ctor = candidate as PrototypeRendererCtorLike;
    const rendererProto = ctor?.prototype;
    if (!rendererProto || rendererProto === proto) continue;
    const priorRender = rendererProto.render;
    if (typeof priorRender === 'function') {
      rendererProto.render = function (this: unknown, ...args: unknown[]) {
        observeRendererRender(this, args[0], args[1]);
        const hooks = renderPassHooks;
        if (hooks === null || !captured || this !== captured.renderer) {
          return priorRender.apply(this, args);
        }
        hooks.before();
        try {
          return priorRender.apply(this, args);
        } finally {
          hooks.after();
        }
      };
      additionalRendererRestores.push(() => {
        rendererProto.render = priorRender;
      });
      continue;
    }
    const priorAddonDescriptor = Object.getOwnPropertyDescriptor(rendererProto, 'render');
    Object.defineProperty(rendererProto, 'render', {
      configurable: true,
      set(this: Record<symbol, unknown>, fn: unknown) {
        this[REAL] = fn;
      },
      get(this: Record<symbol, unknown>) {
        const self = this;
        return function render(this: unknown, ...args: unknown[]) {
          observeRendererRender(self, args[0], args[1]);
          return forwardRender(self, args);
        };
      },
    });
    additionalRendererRestores.push(() => {
      if (priorAddonDescriptor)
        Object.defineProperty(rendererProto, 'render', priorAddonDescriptor);
      else delete (rendererProto as { render?: unknown }).render;
    });
  }

  // ---- (D-C2): additive composer capture, only when a composer ctor
  // was passed. `EffectComposer` methods (including `render`) live on the
  // PROTOTYPE (a plain ES class — the constructor never does `this.render =
  // …`), so a direct method-wrapper suffices — no getter/setter indirection
  // like the `render`/`setAnimationLoop` traps above need. ----
  const composers = new Set<ComposerLike>();
  let composerProto: Record<string, unknown> | undefined;
  let priorComposerRender: ((...a: unknown[]) => unknown) | undefined;
  if (effectComposerCtor) {
    const EC = effectComposerCtor as EffectComposerCtorLike;
    composerProto = EC.prototype as unknown as Record<string, unknown>;
    priorComposerRender = composerProto['render'] as (...a: unknown[]) => unknown;
    composerProto['render'] = function (this: ComposerLike, ...args: unknown[]) {
      // Call the real render FIRST: a composer's RenderPass calls
      // `renderer.render(scene,camera)` internally, which is what actually
      // sets `captured` (above) on the game's first frame. Checking after
      // ensures a composer's very first render is still collected.
      const result = priorComposerRender?.apply(this, args);
      if (captured && this.renderer === captured.renderer) {
        composers.add(this);
      }
      return result;
    };
  }

  // Extracted so `uninstall()`'s own cognitive complexity doesn't grow with
  // this additive restore step (biome's noExcessiveCognitiveComplexity).
  function restoreComposerTrap() {
    if (!composerProto) return;
    if (priorComposerRender) composerProto['render'] = priorComposerRender;
    else delete composerProto['render'];
  }

  return {
    get captured() {
      return captured;
    },
    get capturedVia(): CaptureMechanism | null {
      if (!captured) return null;
      return foreignRenderers.has(captured.renderer as unknown as object)
        ? 'devtools-observer'
        : 'shared-three';
    },
    getDrawCount() {
      return drawCount;
    },
    setRenderPassHooks(hooks: RenderPassHooks | null) {
      renderPassHooks = hooks;
    },
    getAnimationLoop(renderer: THREE.WebGLRenderer) {
      return loopCallbacks.get(renderer as unknown as object) ?? null;
    },
    resizeComposers(w: number, h: number) {
      // No composer ctor passed (or none constructed yet) → no-op, and never
      // touches `renderer.getPixelRatio()` — a non-composer game's captured
      // renderer need not even expose that method for this to stay a no-op.
      if (!captured || composers.size === 0) return;
      const pixelRatio = captured.renderer.getPixelRatio?.();
      if (pixelRatio === undefined) return;
      for (const composer of composers) {
        composer.setSize(w, h);
        composer.setPixelRatio(pixelRatio);
      }
    },
    waitForCapture(options) {
      const opts: CaptureWaitOptions =
        typeof options === 'number' ? { timeoutMs: options } : (options ?? {});
      const timeoutMs = opts.timeoutMs ?? 10_000;
      if (captured) return Promise.resolve(captured);
      return new Promise<CapturedRuntime>((resolve, reject) => {
        // A budget of VISIBLE time. The window disarms itself while the
        // document is hidden and resumes when it comes back, so a tab that
        // boots in the background waits instead of dying — and the trap it is
        // waiting on stays installed the whole time, which is what makes the
        // first frame after foregrounding a capture rather than a retry.
        const captureWindow = startVisibleCaptureWindow({
          budgetMs: timeoutMs,
          ...(opts.visibility !== undefined ? { clock: opts.visibility } : {}),
          onExpire: () => {
            const i = waiters.indexOf(wrapped);
            if (i >= 0) waiters.splice(i, 1);
            waitingVisibility = null;
            opts.onWait?.(null);
            reject(
              new Error(
                `Scene capture timed out after ${timeoutMs}ms of VISIBLE time ` +
                  `(${Math.round(captureWindow.elapsedHiddenMs())}ms browser-suspended, which is ` +
                  'not counted because no frame can be presented) — no three renderer of ANY ' +
                  "instance drew a scene: neither the host's own `three` (the shared prototype " +
                  "trap) nor a renderer announcing itself on three's `__THREE_DEVTOOLS__` seam, " +
                  'which is what reaches a game that bundles its own copy. The game never ' +
                  'rendered.',
              ),
            );
          },
        });
        const wrapped = (rt: CapturedRuntime) => {
          captureWindow.cancel();
          waitingVisibility = null;
          opts.onWait?.(null);
          resolve(rt);
        };
        waiters.push(wrapped);
        waitingVisibility = opts.visibility ?? documentVisibilityClock();
        opts.onWait?.(captureWindow);
        // A waiter that starts already-hidden (the normal `vgai play` path
        // against a backgrounded tab) must not wait for a human to foreground
        // it. Pump any loop the game has already registered.
        queueMicrotask(pumpHiddenLoops);
      });
    },
    uninstall() {
      // Restore the captured renderer's real render as an OWN property so its
      // loop keeps working after the prototype trap is removed.
      if (captured) {
        const r = captured.renderer as unknown as Record<symbol, unknown>;
        const real = r[REAL];
        if (typeof real === 'function') {
          Object.defineProperty(captured.renderer, 'render', {
            configurable: true,
            writable: true,
            value: real,
          });
        }
      }
      if (priorDescriptor) {
        Object.defineProperty(proto, 'render', priorDescriptor);
      } else {
        delete proto['render'];
      }
      // Restore the captured renderer's real setAnimationLoop as an OWN property (the
      // prototype getter/setter intercepted the constructor's assignment, so the
      // instance has none) — else removing the prototype trap would leave it without
      // setAnimationLoop and freeze its loop.
      if (captured) {
        const r = captured.renderer as unknown as Record<symbol, unknown>;
        const realSal = r[REAL_SAL];
        if (typeof realSal === 'function') {
          Object.defineProperty(captured.renderer, 'setAnimationLoop', {
            configurable: true,
            writable: true,
            value: realSal,
          });
        }
      }
      if (priorSAL) Object.defineProperty(proto, 'setAnimationLoop', priorSAL);
      else delete proto['setAnimationLoop'];
      // Fully restore the composer addon's `render` (a plain
      // prototype method — no per-instance own-property to restore, unlike
      // the renderer/loop traps above).
      restoreComposerTrap();
      // Stop listening on three's devtools seam and give every foreign
      // renderer instance its own `render`/`setAnimationLoop` back.
      stopForeignObserver();
      for (const restore of additionalRendererRestores) restore();
    },
  };
}
