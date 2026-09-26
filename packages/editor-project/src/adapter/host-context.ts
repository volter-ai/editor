/** Host-provided surfaces for adapter mounting.
 * Product-specific execution handles belong in that product's extension of
 * these contexts; the shared project contract must not import its runtime.
 */
import type { AdapterSurface } from './adapter-surface';

/** The canvas/container the game renders into, plus its size. */
export interface HostSurface {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
}

/**
 * The surface-INDEPENDENT half of every host context — see this file's header
 * for ownership of product-specific extensions. Generic host code (a
 * harness, a tier report, anything that must not care what it is mounting) can
 * type against this; a real adapter always receives one of the per-surface
 * contexts below.
 */
export interface HostContextBase {
  /**
   * No GPU/DOM/audio available (Node conformance tests). A first-party adapter
   * skips postprocessing/render/audio/input-map loading but still builds the
   * scene + Rapier + components, so its scene/authoring/physics can be exercised
   * headlessly. Browser hosts leave this false/undefined → full behavior.
   */
  readonly headless?: boolean;
}

/**
 * What a `three`-surface root is handed. This is the ONLY context carrying
 * three's own objects — the split's entire point (see the header): a Pixi or
 * React root is never handed a `WebGLRenderer` it cannot use. The objects are
 * opaque here; `@volter/editor-threejs` names the Three-typed context, and a
 * runtime names its own.
 */
export interface ThreeHostContext<Three = unknown, Renderer = unknown, Assets = unknown>
  extends HostContextBase {
  /** The ONE shared three instance — identity matters for capture (see ingest). */
  readonly three: Three;
  /** Canvas/container + size; a self-driven game may take the surface over. */
  readonly surface: HostSurface;
  /** Host renderer — host-driven games render through it. */
  readonly renderer: Renderer;
  /** Shared GLTF/texture cache. */
  readonly assets: Assets;
}

/**
 * What a `canvas`-surface root is handed: a raw canvas + its
 * logical size, plus the
 * compositing hints the multi-root host computes once for every stacked
 * surface. No `three`, no `renderer`, no `assets` — a Pixi root builds its own
 * `PIXI.Application` and its own asset cache from this.
 */
export interface CanvasHostContext extends HostContextBase {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  /** DPR override (T6.1 slice 1, D5 §3 — "one DPR
   *  everywhere"): the roots-path host computes ONE dpr for every stacked
   *  surface and passes it here; omitted -> the canvas adapter's own
   *  default (`window.devicePixelRatio`, uncapped). */
  readonly dpr?: number;
  /** This root is stacked ABOVE another root (D5 §1): clear with alpha 0
   *  instead of an opaque background so the layer below shows through. */
  readonly transparent?: boolean;
  /** Capture tier cost (D5 §4) — the renderer's `preserveDrawingBuffer`. */
  readonly preserveDrawingBuffer?: boolean;
}

/**
 * What a `dom`-surface root is handed (the shape `runtime/create-runtime.ts`
 * used to spell `ReactRootHost`).
 *
 * `container` is the absolutely-positioned, z-ordered DOM-root layer `<div>`
 * the host already created and stacked (same box/z-order rules as a canvas per
 * D5 §1) — the adapter's `mount` renders its react tree INTO
 * this exact element via `createRoot`; it must never create its own root
 * element (the DOM analog of three's "the root's runtime renders into the
 * surface it is handed" rule).
 *
 * `game` (inherited, and deliberately still optional): a
 * `default-react` sibling mounted BESIDE an ingest root (`packages/editor/src/
 * ingest-siblings.ts`) has no native `Game` to hand it — there is no
 * first-party loop for the sibling to join, only the ingested
 * root's own foreign runtime — so its host carries no `game` at all rather than
 * fabricating an empty one (anti-shim rule); the sibling mounts its entry
 * component bare, with no `<WorldProvider>` wrap. `mountOneReactRoot`
 * (`runtime/create-runtime.ts`, the NATIVE multi-root runtime path) still
 * ALWAYS supplies a real `game` — this optionality is reached only by the
 * composite sibling's own hand-built host, never by weakening the native path's
 * guarantee.
 */
export interface DomHostContext extends HostContextBase {
  readonly container: HTMLElement;
}

/**
 * Map an {@link AdapterSurface} to the host context that surface's roots are
 * handed — the mirror image of `MountedRootFor<K>` (`root-adapter.ts`), and
 * what makes `RootAdapter<K>.mount`'s PARAMETER K-typed. A hypothetical 4th
 * surface resolves to `never` here, so it cannot be mounted until it declares
 * its own context (the same fail-to-compile discipline `assertNever` gives the
 * dispatch sites).
 */
export type HostContextFor<K extends AdapterSurface> = K extends 'three'
  ? ThreeHostContext
  : K extends 'canvas'
    ? CanvasHostContext
    : K extends 'dom'
      ? DomHostContext
      : never;
