/**
 * `renderDebug` for an INGESTED world — the engine-owned auto-registration
 * the first-party mount already does (`setup-three-root-adapter.ts` builds the
 * same wiring under the same real-WebGL2-context guard), reached for a game
 * whose render loop the host does not own.
 *
 * ## Why this is host-owned and not per-game
 *
 * `RenderDebugAdapter` needs three things: a real WebGL2 context, the live scene
 * to attribute draws against, and a bracket around the render pass. A captured
 * ingest mount has all three and the host already holds them — the capture trap
 * (`@volter/threejs-runtime/adapter/ingest/scene-capture`) stands between the game and its own
 * `WebGLRenderer.render`, which is the ONLY place a host can see a
 * self-driven game's pass begin and end. So no game declares this slot: it is
 * derived from the mount, exactly like the first-party path, and a game that
 * declared one would be shimming what the host can measure.
 *
 * ## Why the game's own `three` instance is not a problem here
 *
 * `dev/render-debug-adapter.ts` never uses `instanceof`: it duck-types
 * renderables (`isMesh`/`isPoints`/…) and patches `onBeforeRender` on the
 * objects themselves. `dev/render-memory.ts` is the same shape
 * (`isTexture`/`isBufferGeometry` flags, numeric format enums), so neither
 * depends on the captured objects being the host's own classes.
 *
 * Returns `null` — the honest absence, which leaves the Frame debugger showing
 * its own "no adapter" notice — whenever the mount has no real WebGL2 context to
 * capture from (a headless harness, a stub renderer).
 *
 * ## The CANVAS lane, and what it can and cannot say
 *
 * The same three things are needed on the Pixi surface, and the mount holds two
 * and a half of them. `webgl-frame-capture.ts` is GL-LEVEL — it shadows the
 * five WebGL2 draw entry points on whatever real context it is handed and knows
 * nothing about three — so it is reused verbatim over the captured Pixi
 * renderer's own `gl`. The bracket is the renderer's own published seam, its
 * `prerender`/`postrender` runners (`@volter/game-runtime/pixi/render-pass-bracket`).
 *
 * What is NOT there is per-draw attribution, and it is absent for a structural
 * reason rather than a missing patch point: three calls `onBeforeRender` on the
 * object it is about to draw, whereas Pixi's batcher merges many display
 * objects into a single draw, so no display object IS the author of a given
 * draw. `createCanvasIngestRenderDebug` therefore omits `scene` and every draw
 * lands in `totals.unattributed` — the Frame debugger reads that count and says
 * so, which is the honest answer and not a degraded one.
 *
 * Render memory is absent on this lane for the same kind of reason.
 * `RenderMemorySnapshot` is a WHOLE-snapshot shape with non-nullable geometry
 * counts and byte totals; Pixi's renderer publishes one real managed collection
 * (`renderer.texture.managedTextures`) and no managed geometry or program
 * collection at all, so filling the geometry half with zeros is exactly the
 * fabrication the anti-shim rule forbids. The capability is therefore ABSENT
 * (`memorySnapshot` undefined), which `frame-debugger-model.ts` already reports
 * per-capability and the Profiler's memory view already renders as its own
 * notice.
 */

import { adapterObservations } from '@volter/editor-sdk/kit/adapter-observation';
import { createContractDebugAdapter } from '../runtime/adapter/ingest/contract-debug-adapter';
import {
  type ContractSurface,
  projectContractSystemAdapters,
} from '../runtime/adapter/ingest/contract-system-adapters';
import { mergeDebugAdapters } from '../runtime/adapter/ingest/merge-debug-adapters';
import { createObservationDebugAdapter } from '../runtime/adapter/ingest/observation-debug-adapter';
import {
  createRenderDebugAdapter,
  frameCaptureContextFor,
  type RenderDebugWiring,
} from '../runtime/dev/render-debug-adapter';
import { collectRenderMemory } from '../runtime/dev/render-memory';
import { createWebGLFrameCapture } from '../runtime/dev/webgl-frame-capture';
import { pixiRenderingContext } from '@volter/game-runtime/pixi/render-pass-bracket';
import type { ObservationDeclaration } from '@volter/editor-project/adapter/adapter-module';
import type { VgaiGameSystems } from '@volter/editor-project/adapter/ingest/game-contract';
import type { SystemAdapters } from '@volter/editor-project/adapter/system-adapter';
import type { RenderPassHooks } from '@volter/threejs-runtime/adapter/ingest/scene-capture';
import type * as THREE from 'three';
import { ingestGameRealmWindow } from './game-contract-realm';
import {
  deliverArmedIngestFrame,
  type IngestFrameSource,
  setIngestFrameSource,
} from './ingest-frame-snapshot';

/** The pieces of a captured runtime this needs. Structural so a headless test
 *  can hand in a mock GL context and a plain scene, exactly as the first-party
 *  render-debug suite does. */
export interface IngestRenderDebugRuntime {
  readonly scene: THREE.Object3D;
  readonly renderer: {
    getContext?(): unknown;
    readonly info?: THREE.WebGLInfo | undefined;
    /** Read by the same-frame snapshot only (`ingest-frame-snapshot.ts`); a
     *  runtime without them simply has no snapshot capability. */
    readonly domElement?: unknown;
    getRenderTarget?(): unknown;
  };
}

/**
 * Build the render-debug wiring for a captured ingest runtime, or `null` when
 * the mount cannot host frame capture. The caller installs
 * `beforeRender`/`afterRender` as the capture handle's render-pass hooks and
 * calls `dispose()` on unmount.
 */
export function createIngestRenderDebug(rt: IngestRenderDebugRuntime): RenderDebugWiring | null {
  // Reads a renderer the host did not construct: an unfamiliar/stub shape must
  // degrade to "no adapter", never break the mount.
  let glContext: unknown;
  try {
    glContext = typeof rt.renderer.getContext === 'function' ? rt.renderer.getContext() : undefined;
  } catch {
    return null;
  }
  // `headless: false` — this path only runs for a mount that actually rendered a
  // frame; `frameCaptureContextFor` is the ONE predicate deciding whether the
  // context is real, shared with the first-party mount so both sides agree.
  const context = frameCaptureContextFor(false, glContext);
  if (!context) return null;
  const info = rt.renderer.info;
  return createRenderDebugAdapter({
    capture: createWebGLFrameCapture(context),
    scene: rt.scene,
    // `memorySnapshot` is the W3a-style OPTIONAL capability: attached only when
    // the renderer exposes its own `info`, absent otherwise (never a zeroed
    // snapshot standing in for a count nobody read).
    ...(info ? { memory: () => collectRenderMemory(rt.scene, info) } : {}),
  });
}

/** The pieces of a captured CANVAS runtime this needs — just the game's own
 *  Pixi renderer, because the two things the three shape carries beyond it
 *  (a traversable scene, a `renderer.info`) have no honest Pixi analogue (see
 *  the module header). Structural, so a headless test hands in a plain object
 *  with a mock `gl` and a pair of runners. */
export interface CanvasIngestRenderDebugRuntime {
  readonly renderer: unknown;
}

/**
 * Build the render-debug wiring for a captured PIXI ingest runtime, or `null`
 * when the mount cannot host frame capture — no real WebGL2 context (a WebGPU
 * or headless renderer), or a renderer that publishes no render-pass runners to
 * bracket. Both are the same honest absence the three lane's `null` is.
 *
 * The caller installs `beforeRender`/`afterRender` through
 * {@link installPixiRenderPassBracket} and calls `dispose()` on unmount.
 */
export function createCanvasIngestRenderDebug(
  rt: CanvasIngestRenderDebugRuntime,
): RenderDebugWiring | null {
  // Reads a renderer the host did not construct: an unfamiliar/stub shape must
  // degrade to "no adapter", never break the mount.
  let glContext: unknown;
  try {
    glContext = pixiRenderingContext(rt.renderer);
  } catch {
    return null;
  }
  // The SAME predicate the three lane uses, so both surfaces agree on what
  // counts as a real context. `headless: false` — this path only runs for a
  // mount whose game already rendered a capturable frame.
  const context = frameCaptureContextFor(false, glContext);
  if (!context) return null;
  return createRenderDebugAdapter({
    capture: createWebGLFrameCapture(context),
    // No `scene`: this surface has no per-draw annotation seam, so every draw
    // is honestly unattributed. No `memory`: see the module header.
  });
}

/** What a three ingest mount publishes to `setActiveSystems`, plus the
 *  render-debug handle its `dispose()` has to release. */
export interface IngestSystemsWiring {
  /** Spread onto the `MountedThreeRoot`. Empty when nothing was reachable —
   *  the caller omits `systems` entirely then, keeping the pre-contract floor. */
  readonly systems: SystemAdapters;
  /** Non-null only when a real frame capture was built; `dispose()` on unmount. */
  readonly renderDebug: RenderDebugWiring | null;
  /**
   * One sentence per name BOTH debug feeders declared — the game's own contract
   * and its adapter's observation table (`merge-debug-adapters.ts`). Empty is
   * the norm; non-empty is a defect in whichever of the two the reader owns, and
   * the mount says so out loud rather than leaving the coded refusal to be
   * discovered by whoever calls the name first.
   */
  readonly debugCollisions: readonly string[];
}

/**
 * THE one place an ingest mount's `SystemAdapters` bag is assembled — on EITHER
 * surface — so a shim never has to know anything about the mount, and no second
 * assembly can drift into publishing a different surface from the same
 * declaration.
 *
 * Four sources, each with a different provenance:
 *  - `debug` — projected from the contract's own `commands`/`state`;
 *  - `debug`, AGAIN — projected from the loaded ADAPTER's observation
 *    declarations (`@volter/editor-game/runtime/adapter/ingest/observation-debug-adapter`).
 *    These two are peers onto ONE slot, so they are MERGED
 *    (`merge-debug-adapters.ts`) rather than layered: a name declared by both
 *    is refused by a coded error naming both sources, never shadowed;
 *  - the game-declarable slots — projected from its `systemAdapters` carrier
 *    (an IMPLEMENTED-EMPTY slot is deliberately NOT bound; it is an answer the
 *    coverage report reads, not an adapter);
 *  - `renderDebug` — engine-owned, derived from the captured runtime, and wired
 *    to that surface's render-pass bracket.
 *
 * The observation half is read HERE rather than threaded in by each mount, and
 * that is the point of "the one place": the adapter's table is a PROJECT fact
 * the loader already resolved (`project-adapter.ts` loads it per project, not
 * per mount), so a lane cannot forget to pass it. Both parameters exist only as
 * a test seam.
 *
 * `runtime` and `canvasRuntime` are the SAME source in two surface shapes, and
 * are mutually exclusive: a mount has captured a three renderer or a Pixi one,
 * never both. They stay separate types rather than one widened type because the
 * three shape's `scene`/`info` have no honest Pixi analogue — a union that
 * merely made them optional would let a three mount silently lose its
 * attribution. What they share is this function and the `setRenderPassHooks`
 * slot; the MECHANISM behind that slot is each surface's own (the render
 * accessor-trap for three, the renderer's runners for Pixi).
 */
export function wireIngestSystems(opts: {
  readonly contractSystems: VgaiGameSystems | undefined;
  /**
   * THIS MOUNT'S SURFACE, stated rather than inferred from which runtime is
   * present — the recognized-Phaser/Babylon canvas branch captures neither
   * renderer and would infer nothing. The projection needs it to check the
   * physics slot's keying (`contract-system-adapters.ts` header).
   */
  readonly surface: ContractSurface;
  /** Absent when there is no captured THREE renderer to bracket. */
  readonly runtime?: IngestRenderDebugRuntime | undefined;
  /** Absent when there is no captured PIXI renderer to bracket. */
  readonly canvasRuntime?: CanvasIngestRenderDebugRuntime | undefined;
  /**
   * The mount's OWN resolved physics carrier, which REPLACES the projected
   * `physics` slot when supplied.
   *
   * The canvas mount is the case and the reason: the carrier its gizmo path
   * actually uses is the declared one COMPOSED with the host's registry-backed
   * one (`mount-canvas-ingest-root.ts`), and the bag must publish that same
   * object — a coverage row reading `bound` off a different instance than the
   * editor calls would be true about nothing. Absent ⇒ the projection's own
   * slot stands, which is every other mount.
   */
  readonly physics?: SystemAdapters['physics'] | undefined;
  readonly setRenderPassHooks?: ((hooks: RenderPassHooks | null) => void) | undefined;
  /**
   * TEST SEAM. Omitted — every shipped mount — this is the loaded adapter's own
   * table, which is what makes the projection impossible for a lane to forget.
   */
  readonly observation?: readonly ObservationDeclaration[] | undefined;
  /**
   * The mounted game handle an observation `answer` is evaluated against.
   *
   * Omitted — every shipped mount — it is THIS REALM: an ingest mount runs the
   * game's own modules in its gated realm, so the game's public handles are on
   * that realm's window proxy (not the editor tab's real `window`) and that is
   * the only honest thing to hand a foreign game's closure
   * (`observation-debug-adapter.ts` states the whole argument). Passed
   * explicitly only by tests, which hand a fake realm.
   */
  readonly game?: unknown;
}): IngestSystemsWiring {
  const contractDebug = createContractDebugAdapter(opts.contractSystems);
  const observationDebug = createObservationDebugAdapter(
    opts.observation ?? adapterObservations(),
    'game' in opts ? opts.game : typeof window === 'undefined' ? null : ingestGameRealmWindow(),
  );
  const { adapter: debug, collisions } = mergeDebugAdapters([
    { label: "the game's own contract (window.vgaiGame.systems)", adapter: contractDebug },
    { label: "its adapter's observation table (vgai.adapter.ts)", adapter: observationDebug },
  ]);
  const declared = projectContractSystemAdapters(opts.contractSystems, opts.surface);
  const renderDebug = opts.runtime
    ? createIngestRenderDebug(opts.runtime)
    : opts.canvasRuntime
      ? createCanvasIngestRenderDebug(opts.canvasRuntime)
      : null;
  // ONE bracket, TWO consumers. `setRenderPassHooks` is a single-writer slot
  // (last writer wins), so this is the only place that may install it, and
  // anything needing the game's render pass multiplexes here rather than
  // opening a second seam. The second consumer is the same-frame canvas
  // snapshot (`ingest-frame-snapshot.ts`) that makes `vgai screenshot` readable
  // over a game whose canvas has no `preserveDrawingBuffer`; it costs nothing
  // until armed, and `deliverArmedIngestFrame` no-ops while no source is set —
  // which is the canvas lane's state, because a Pixi ingest is already
  // photographable through its own registered `Application`
  // (`stories/story-pixi-preview.ts`, registered at the canvas mount) and needs
  // no second route to the same pixels.
  if (opts.runtime) setIngestFrameSource(opts.runtime as IngestFrameSource);
  if (opts.setRenderPassHooks && (renderDebug || opts.runtime)) {
    opts.setRenderPassHooks({
      // Neither hook may throw — they run inside the game's own render call.
      before: () => {
        renderDebug?.beforeRender();
      },
      after: () => {
        try {
          renderDebug?.afterRender();
        } finally {
          deliverArmedIngestFrame();
        }
      },
    });
  }
  return {
    systems: {
      ...declared.bound,
      ...(opts.physics ? { physics: opts.physics } : {}),
      ...(debug ? { debug } : {}),
      ...(renderDebug ? { renderDebug: renderDebug.adapter } : {}),
    },
    renderDebug,
    debugCollisions: collisions,
  };
}
