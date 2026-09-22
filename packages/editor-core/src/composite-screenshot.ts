/**
 * #146 — full-stack play screenshot: the game canvas(es) PLUS the DOM UI
 * layers stacked over/beside them (React adapter roots,
 * world layers), composited into one PNG. This is "what the game looks
 * like" for agent eyes — a canvas-only capture of a game whose score/health
 * lives in the HUD reads as a different (often emptier) game than the one
 * the human is watching.
 *
 * How: each `<canvas>` child of the play container is drawn onto an
 * offscreen 2D canvas at its on-screen rect, then the NON-canvas children are serialized into an
 * SVG `<foreignObject>` and drawn on top. The foreignObject leg is faithful
 * by construction FOR FIRST-PARTY DOM: the HUD rule is inline-styles-only
 * (CLAUDE.md), and react-world layers are engine-mounted with inline
 * positioning — so a detached serialization loses no styling. A FOREIGN
 * game's DOM is the exception, and it is handled explicitly: its layout lives
 * in a page stylesheet, which the host serves `@scope`d and this leg
 * re-inlines into the clone (`buildOverlaySvg`) — without that the capture
 * would report a styled screen as unstyled. The SVG rides a `data:` URL with
 * no external references, which keeps the output canvas untainted (the same
 * mechanism html-to-image libraries rely on).
 *
 * A canvas is only readable this late when its WebGL context was created with
 * `preserveDrawingBuffer: true`. Every canvas the vgai RUNTIME mounts sets it
 * (`@vgai/game-runtime/runtime/create-runtime`), so first-party play reads directly. A
 * canvas an INGESTED game created is its own — racing-game's `<Canvas>` passes
 * no `gl` prop, so fiber's `false` default applies and this read returns black.
 * `CaptureOptions.canvasFrame` is the seam for that case: the caller hands back
 * pixels copied inside the game's own render pass. This module deliberately
 * knows nothing about how (see `ingest/ingest-frame-snapshot.ts`).
 *
 * Active EDITOR documents use the same compositor with
 * `includeDocumentStyles`: their document container and accessible CSSOM ride
 * the detached clone, so design-system chrome photographs as it appears. Game
 * capture leaves that option off and therefore never imports editor styling.
 */

import { GAME_CSS_SCOPE_ATTRIBUTE } from '@volter/editor-sdk/session/game-css-scope';
import { scopedGameStylesCssText } from './scoped-game-css';

export interface OverlaySvg {
  svg: string;
  /** How many non-canvas layers were serialized (0 ⇒ callers skip the leg). */
  overlayCount: number;
}

const ROOT_SURFACE_SELECTOR = '[data-vgai-root-surface="true"]';

// A DOM root is also marked as a surface. Its descendant canvases are UI
// content (for example a 3D die), not additional host surfaces. Keep their
// pixels in the overlay so their own backgrounds and layout survive capture.
export function isRootCanvas(canvas: HTMLCanvasElement): boolean {
  return (
    canvas.matches(ROOT_SURFACE_SELECTOR) ||
    canvas.closest('[data-vgai-canvas-scene="true"]') !== null
  );
}

/**
 * Reusable data-URL snapshots of STATIC pixels across a sequence of frames.
 *
 * The overlay clone inlines every nested `<img>`'s pixels through a canvas
 * `toDataURL` — a synchronous PNG encode. For a one-shot screenshot that cost
 * is invisible; for the gameplay recorder it ran per `<img>` per frame, and one
 * HUD image measured at 68% of the entire main thread during play (the game's
 * own frame rounded to 0%, and relay commands queued seconds deep behind the
 * encodes). An `<img>`'s pixels only change when its `src` does, so the
 * recorder passes one of these per recording and the encode runs once per
 * source, not once per frame. `null` results are cached too — a tainted image
 * stays refused without re-attempting the readback every frame.
 */
export interface ImageSnapshotCache {
  readonly imgs: WeakMap<HTMLImageElement, { src: string; url: string | null }>;
}

export function createImageSnapshotCache(): ImageSnapshotCache {
  return { imgs: new WeakMap() };
}

/**
 * How stale a cached overlay raster may get before a rebuild is forced even
 * with no mutation observed. This bounds the ONE blind spot of
 * mutation-driven invalidation: motion no mutation reports — a CSS animation
 * mid-flight, a `<video>` element, an `<img>` finishing its load, a nested
 * non-root canvas repainting. Half a second of HUD staleness is invisible in
 * evidence video; rebuilding twice a second is invisible in the profile.
 */
export const OVERLAY_CACHE_MAX_AGE_MS = 500;

/**
 * The floor of the rebuild throttle window, and the cost multiplier that
 * stretches it.
 *
 * Mutation-driven invalidation has a degenerate regime: a HUD that mutates
 * every frame (an ammo counter during fire, a per-frame debug readout) makes
 * every window dirty, and the recorder is back to a full clone + serialize +
 * decode per frame — measured at ~40% of the main thread with 50–70ms relay
 * latency under a forced 16ms-mutation bench. So a DIRTY raster is still
 * served until `max(floor, multiplier × last build's wall cost)` has passed
 * since the last rebuild: rebuild work is bounded at 1/multiplier (~12.5%) of
 * the thread however hostile the HUD, and a cheap HUD still updates in the
 * video at ~1000/floor (~10) fps — comfortably above the "10 frames in a 5s
 * span" bar the evidence doors ask reviewers to hold recordings to. The
 * staleness this trades is bounded by the window itself and only exists
 * while the HUD is actively churning — the first take past the window
 * rebuilds from the live DOM.
 */
export const OVERLAY_REBUILD_FLOOR_MS = 100;
export const OVERLAY_REBUILD_COST_MULTIPLIER = 8;

/** What {@link OverlayFrameCache} stores: the decoded, `drawImage`-ready
 *  overlay raster — `image: null` is the cached form of "this container has
 *  no DOM overlay layers", so a canvas-only game skips the whole leg without
 *  re-asking the DOM every frame. */
export interface CachedOverlay {
  readonly image: CanvasImageSource | null;
  readonly overlayCount: number;
  /** Backdrop membership shares this overlay's stacking snapshot. */
  readonly backdrops?: readonly HTMLElement[];
}

/**
 * The DOM overlay, rasterized once per CHANGE instead of once per frame.
 *
 * The gameplay recorder calls {@link drawPlayCompositeFrame} at up to 30fps.
 * Rebuilding the overlay every frame — clone the HUD subtree, re-inline
 * styles, serialize to a foreignObject SVG, decode — measured at ~20% of the
 * main thread even after {@link ImageSnapshotCache} removed the per-frame PNG
 * encodes. A HUD mutates orders of magnitude less often than 30 times a
 * second, so a MutationObserver decides when the raster is rebuilt and every
 * other frame pays two `drawImage` calls.
 *
 * `take` is the whole protocol: it returns the reusable overlay, or returns
 * `null` and ARMS the cache for the rebuild the caller does next. Arming
 * clears the dirty flag at the moment the caller is about to read the DOM
 * (the read is synchronous in the same task, so nothing can interleave);
 * a mutation landing during the rebuild's async decode re-dirties the entry
 * through the observer, so the frame `store`d after it is already invalid —
 * one extra rebuild, never a stale cache.
 */
export interface OverlayFrameCache {
  take(container: HTMLElement, width: number, height: number): CachedOverlay | null;
  /** `buildCostMs` is the rebuild's WALL cost (clone through decode) — it
   *  sizes the throttle window that bounds how much of the main thread a
   *  churning HUD can spend on rebuilds. */
  store(
    container: HTMLElement,
    width: number,
    height: number,
    overlay: CachedOverlay,
    buildCostMs: number,
  ): void;
  /** Disconnect the observer. The recording that owns this cache ended. */
  dispose(): void;
}

export function createOverlayFrameCache(
  maxAgeMs = OVERLAY_CACHE_MAX_AGE_MS,
  rebuildFloorMs = OVERLAY_REBUILD_FLOOR_MS,
): OverlayFrameCache {
  let observed: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let dirty = false;
  let frame:
    | (CachedOverlay & { width: number; height: number; builtAt: number; notBefore: number })
    | null = null;

  const observe = (container: HTMLElement): void => {
    observer?.disconnect();
    observed = container;
    frame = null;
    dirty = false;
    observer =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            dirty = true;
          });
    observer?.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  };

  return {
    take(container, width, height) {
      if (observed !== container) {
        // First frame, or the recorder retargeted: watch THIS container.
        observe(container);
        return null;
      }
      // Flush records the observer callback has not delivered yet — `take`
      // must never vouch for a CLEAN frame the DOM has already moved under.
      if (observer && observer.takeRecords().length > 0) dirty = true;
      const now = performance.now();
      if (frame && frame.width === width && frame.height === height) {
        if (!dirty && now - frame.builtAt <= maxAgeMs) return frame;
        // Dirty, but the last rebuild is still inside its throttle window:
        // serve the raster anyway (bounded staleness, stated in the window
        // constants above). `dirty` stays set, so the first take PAST the
        // window rebuilds from the live DOM.
        if (dirty && now < frame.notBefore) return frame;
      }
      frame = null;
      dirty = false; // armed: the caller rebuilds from the DOM as it is NOW
      return null;
    },
    store(container, width, height, overlay, buildCostMs) {
      if (observed !== container) return; // a retarget raced the rebuild
      // `dirty` is deliberately left alone: if a mutation landed during the
      // rebuild's decode await, this frame is already out of date and the
      // next `take` past the throttle window correctly rebuilds it.
      const now = performance.now();
      frame = {
        ...overlay,
        width,
        height,
        builtAt: now,
        notBefore: now + Math.max(rebuildFloorMs, OVERLAY_REBUILD_COST_MULTIPLIER * buildCostMs),
      };
    },
    dispose() {
      observer?.disconnect();
      observer = null;
      observed = null;
      frame = null;
    },
  };
}

export interface CaptureOptions {
  /** Authoring compositions may deliberately paint nothing or retain alpha. */
  readonly allowTransparent?: boolean;
  /** Output dimensions independent of the editor preview's CSS scale. Canvases
   *  and backdrops are painted at that scale; the DOM leg keeps its CSS-pixel
   *  layout and rasterizes through a viewBox at this size, so a frame asked for
   *  at device resolution comes back with device-resolution text. */
  readonly size?: { readonly width: number; readonly height: number } | undefined;
  /**
   * Same-frame pixels for a canvas this process cannot read back late.
   *
   * A WebGL canvas is only `drawImage`-able after its frame if its context was
   * created with `preserveDrawingBuffer: true`. Every canvas the vgai runtime
   * mounts sets it; a canvas an INGESTED game created does not, so reading it
   * here — several paint boundaries after its frame — yields black. The caller
   * supplies this when it has a seam that can copy the buffer inside the
   * game's own render pass (`ingest/ingest-frame-snapshot.ts`). Returning
   * `null` means "read the canvas directly", which is the unchanged path for
   * every first-party capture.
   */
  readonly canvasFrame?:
    | ((canvas: HTMLCanvasElement) => Promise<CanvasImageSource | null>)
    | undefined;
  /**
   * Preserve stylesheet-driven chrome when the subject is an editor document.
   *
   * The ordinary game path intentionally uses a neutral wrapper: editor
   * classes are not part of the game. An editor-owned document is the opposite
   * case — its classes and the editor's one static stylesheet ARE its visual
   * language, so omitting them turns a styled panel into browser-default HTML.
   */
  readonly includeDocumentStyles?: boolean | undefined;
  /**
   * Crop the photograph to the union of painted pixels plus padding, on a
   * backdrop of the container's own background.
   *
   * The Storybook framing model, split in two: the MOUNT box supplies the
   * screen the subject's anchors resolve against and is a semantic input,
   * while the PHOTOGRAPH frames the subject — measured, exactly as the 3D
   * story leg frames its camera on the object's bounds. A lone HUD widget
   * crops to the widget; a full screen's painted union spans the frame and
   * stays effectively full-frame, so no screen-vs-widget classifier exists.
   * DOM-only subjects only: a canvas-backed frame is already the full picture.
   */
  readonly cropToContent?: boolean | undefined;
  /**
   * Does this subject present on a CANVAS? — the declared answer, supplied by
   * the caller.
   *
   * This module used to answer it by counting `<canvas>` children, which is a
   * guess at a fact the adapter's region table already states: a `three`/
   * `canvas` region is handed a canvas, a `dom` region is handed a container
   * (ARCHITECTURE-CORE §The editor protocol, zero inference). The count and the
   * declaration agree for every healthy game — and disagree exactly in the case
   * worth catching, a canvas game photographed before its canvas mounted, which
   * the count silently graded as "DOM-only".
   *
   * Passed IN rather than read here on purpose: this file is pure DOM (jsdom-
   * testable, imports no editor state), and `presentation-surface.ts` is the one
   * door that knows. `undefined` = nobody declared, and the measured canvas
   * count stands — the unchanged path for any caller that has no adapter table.
   */
  readonly presentsOnCanvas?: boolean | undefined;
  /** See {@link ImageSnapshotCache}. Absent = snapshot every frame (the
   *  one-shot screenshot path, where there is only one frame). */
  readonly snapshots?: ImageSnapshotCache | undefined;
  /** See {@link OverlayFrameCache}. Absent = rasterize the DOM overlay every
   *  frame (correct for a one-shot still; ruinous at 30fps). */
  readonly overlayCache?: OverlayFrameCache | undefined;
}

/**
 * Serialize the play container's NON-canvas children into a standalone SVG
 * sized `width`×`height` (CSS pixels). Game capture clones children into a
 * neutral relatively-positioned wrapper. `includeDocumentStyles` instead
 * shallow-clones the editor document container and carries its CSSOM/theme,
 * because those classes are part of that subject. Returns null when there is
 * nothing but canvases to show.
 * Pure DOM (no rasterizing), so it's unit-testable under jsdom.
 */
/** Same-frame pixels, keyed by the canvas they came from — see the nested-canvas
 *  note in {@link buildOverlaySvg}'s clone loop. */
export type CanvasPixels = ReadonlyMap<HTMLCanvasElement, CanvasImageSource>;

/** One canvas's pixels as a data URL the foreignObject clone can carry. An SVG
 *  rasterized from a data: URL may not fetch EXTERNAL resources, but an inline
 *  data image is not external — the same mechanism html-to-image relies on.
 *  `null` when the source cannot be read back (a tainted canvas), which puts
 *  the caller back on the honest strip-it path. */
function canvasDataUrl(document: Document, pixels: CanvasImageSource): string | null {
  try {
    const copy = document.createElement('canvas');
    const image = pixels as HTMLImageElement;
    // A VIDEO's frame size is `videoWidth/Height`: it has no `naturalWidth`,
    // and its `width` attribute is 0 unless someone set one — which sized the
    // copy 1×1 and threw the frame away.
    const video = pixels instanceof HTMLVideoElement ? pixels : null;
    copy.width = Math.max(
      1,
      Math.round(
        Number(video?.videoWidth || image.naturalWidth || (pixels as HTMLCanvasElement).width) || 0,
      ),
    );
    copy.height = Math.max(
      1,
      Math.round(
        Number(video?.videoHeight || image.naturalHeight || (pixels as HTMLCanvasElement).height) ||
          0,
      ),
    );
    const ctx = copy.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(pixels, 0, 0);
    return copy.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Flatten every readable sheet in document cascade order. CSSOM access is
 * the browser-native answer here: Vite dev styles, the production bundle, and
 * dynamically installed scoped game CSS all present the same interface.
 * Cross-origin sheets refuse `cssRules`; skipping those preserves the normal
 * browser security boundary instead of making capture itself fail. */
function documentStylesCssText(document: Document): string {
  const seen = new Set<CSSStyleSheet>();
  const read = (sheet: CSSStyleSheet): string => {
    if (seen.has(sheet)) return '';
    seen.add(sheet);
    try {
      return Array.from(sheet.cssRules)
        .map((rule) => {
          const imported = (rule as CSSImportRule).styleSheet;
          return imported ? read(imported) : rule.cssText;
        })
        .join('\n');
    } catch {
      return '';
    }
  };
  return Array.from(document.styleSheets, read).filter(Boolean).join('\n');
}

/** Carry the effective theme across the detached-foreignObject boundary.
 * Theme tokens live as custom properties on an editor-shell ancestor, which
 * the active document intentionally does not clone. Reading them from the
 * subject's computed style preserves adaptive panel ink as well as the base
 * palette, without guessing which ancestor established each value. */
function copyComputedDocumentContext(source: HTMLElement, target: HTMLElement): void {
  const computed = source.ownerDocument.defaultView?.getComputedStyle(source);
  if (!computed) return;
  for (const property of Array.from(computed)) {
    if (!property.startsWith('--')) continue;
    const value = computed.getPropertyValue(property);
    if (value) target.style.setProperty(property, value);
  }
  for (const property of [
    'color',
    'color-scheme',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'text-shadow',
  ]) {
    const value = computed.getPropertyValue(property);
    if (value) target.style.setProperty(property, value);
  }
}

/**
 * The element's own painted background colour, or `null` when it is fully
 * transparent (nothing to paint) or unreadable. Computed style, not the inline
 * attribute, so a class-styled document container answers too.
 */
export function opaqueBackgroundColor(element: HTMLElement): string | null {
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  const color = computed?.backgroundColor;
  if (!color || color === 'transparent') return null;
  // `rgba(r, g, b, 0)` is the other spelling of transparent, and the one
  // browsers actually report for an unset background.
  const alpha = /^rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(color)?.[1];
  if (alpha !== undefined && Number(alpha) === 0) return null;
  return color;
}

/**
 * THE ELEMENTS WHOSE BACKGROUND PAINTS *BEHIND* A ROOT-SURFACE CANVAS — the
 * canvas's own ancestor chain, outermost first, `container` included.
 *
 * Why this list has to exist. The compositor's model is "every canvas first,
 * then the whole DOM over the top with those canvases taken out of the clone"
 * (see the nested-canvas note in {@link buildOverlaySvg}: a root-surface canvas
 * is STRIPPED there because the canvas leg already drew it at its exact
 * on-screen rect). That model is only faithful while nothing between the canvas
 * and the composite root paints anything — and an editor document's Scene
 * container paints its ground. CSS puts an ancestor's background BELOW every
 * descendant; the overlay leg puts it ABOVE the canvas leg. So the ground wins
 * and the world vanishes.
 *
 * MEASURED (dodge-the-creeps, imported through `gd-analyze`; the same frame the
 * match-3 import produces): the Edit Scene photographed as ~99% flat `#131416`
 * over a canvas leg that had just drawn 69,366 pixels of the game's authored
 * `#385f61` ColorRect. Nothing about the world, the mount, the Pixi
 * `Application` or the render loop was wrong — only this ordering was, and it
 * was invisible on screen, where the browser composites correctly.
 *
 * Both legs consume this list: {@link drawPlayCompositeFrame} paints these
 * backgrounds UNDER the canvases (where the screen has them), and
 * {@link buildOverlaySvg} clears them from the clone so they cannot paint
 * twice. A document with no root-surface canvas yields an empty list and is
 * composited exactly as before.
 *
 * The Godot lane is ARCHIVED off main — `git fetch origin archive/godot-lane`, tag `archive/godot-lane-2026-09-19`.
 */
export function rootSurfaceBackdrops(container: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  const seen = new Set<Element>();
  for (const canvas of Array.from(container.querySelectorAll('canvas'))) {
    if (!isRootCanvas(canvas)) continue;
    const ancestors: HTMLElement[] = [];
    for (
      let node = canvas.parentElement;
      node && (node === container || container.contains(node));
      node = node.parentElement
    ) {
      ancestors.unshift(node);
      if (node === container) break;
    }
    // Outermost first, which is paint order: a nearer ancestor paints over a
    // further one. `unshift` above already produced that order, and the shared
    // outer ancestors of a second root surface are seen (and kept) first.
    for (const element of [...ancestors, ...stackedUnder(container, canvas)]) {
      if (seen.has(element)) continue;
      seen.add(element);
      chain.push(element);
    }
  }
  return chain;
}

/**
 * The elements that paint UNDER a root-surface canvas WITHOUT being its
 * ancestors — the second way a backdrop reaches the screen. A dock lays its
 * panel content in a render overlay positioned over the group boxes, so the
 * group's own surface (`--dv-group-view-background-color`) is a SIBLING
 * subtree beneath the canvas in stacking order, not an ancestor above it in
 * the tree. The ancestor walk cannot see it; the overlay leg clones it opaque
 * and paints it over the canvas the canvas leg just drew.
 *
 * MEASURED (`vgai screenshot editor` of the Game document in play, the
 * starter cube and daylight sky on screen): the whole game region came back
 * flat `rgb(36,36,36)` with every ancestor already cleared — the overlay leg
 * rasterized alone read that grey at the canvas centre and the SVG carried no
 * such literal, so it was a stylesheet-painted box that no ancestor owned.
 * The 3D tool documents never showed it because their canvases are not root
 * surfaces: they ride the clone inline, in document order, above that box.
 *
 * Found the way the screen resolves it: `elementsFromPoint` at a few points
 * inside the canvas's rect, everything listed BELOW the canvas that is inside
 * `container` and paints an opaque background. Bottom-most first, which is
 * paint order for the canvas leg. Points the canvas does not top (an overlay
 * above it) still list the canvas, so the cut is at the canvas itself.
 */
function stackedUnder(container: HTMLElement, canvas: HTMLCanvasElement): HTMLElement[] {
  const doc = container.ownerDocument;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || typeof doc.elementsFromPoint !== 'function') {
    return [];
  }
  const under = new Set<HTMLElement>();
  const points: [number, number][] = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + rect.width * 0.1, rect.top + rect.height * 0.1],
    [rect.left + rect.width * 0.9, rect.top + rect.height * 0.1],
    [rect.left + rect.width * 0.1, rect.top + rect.height * 0.9],
    [rect.left + rect.width * 0.9, rect.top + rect.height * 0.9],
  ];
  for (const [x, y] of points) {
    const stack = doc.elementsFromPoint(x, y);
    const at = stack.indexOf(canvas);
    if (at < 0) continue;
    for (const element of stack.slice(at + 1)) {
      if (paintsOpaqueWithin(element, container)) under.add(element);
    }
  }
  // `elementsFromPoint` lists top-most first; the canvas leg paints
  // bottom-most first.
  return Array.from(under).reverse();
}

function paintsOpaqueWithin(element: Element, container: HTMLElement): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    (element === container || container.contains(element)) &&
    opaqueBackgroundColor(element) !== null
  );
}

/**
 * THE BACKDROP AN EDITOR DOCUMENT DOES NOT PAINT ITSELF — the subject's own
 * ancestor chain, outermost first, `container` EXCLUDED (the overlay leg
 * clones the container and keeps whatever it paints).
 *
 * The compositor's model is "clone the subject, detached, and rasterize it".
 * A detached clone has no ancestors, so anything an ancestor paints is simply
 * gone — and in this editor the panel fill is DELIBERATELY an ancestor's:
 * `components/workspace-surfaces.css` says in as many words that interior
 * wrappers (`.vgai-dock-document-content`, the element every document capture
 * and the document probe resolve as "the document") paint NOTHING, because
 * the surface AROUND them carries the fill for every theme.
 *
 * MEASURED (2026-08-20, `project-tools` — the editor's OWN built-in document —
 * through `editor.captureActiveDocument` on the Vite dev server AND on the
 * built `dist/` served by the packaged/prod editor servers): the composite came
 * back with legible text over ZERO alpha everywhere else, which every PNG
 * reader renders black and which `measureFlatness` (alpha-blind, by design)
 * scores as "~96-98% one flat surface (#000000)". `ok: true`, a warning nobody
 * can act on, and a black photograph offered as evidence of a document that was
 * on screen and perfectly legible. It is NOT a packaged-only defect: dev
 * measured 0.976 and the packaged bundle 0.955 — one mechanism, both paths.
 *
 * `story-capture.ts` had already bought this lesson from the other side — it
 * paints an opaque `STORY_BACKDROP` behind every story precisely because a
 * canvas-less transparent composite reads as a torn frame.
 *
 * Only the EDITOR-DOCUMENT subject takes this leg (`includeDocumentStyles`): a
 * game's picture must never inherit editor chrome, which is the whole reason
 * the game path composites onto a neutral transparent wrapper.
 */
export function ancestorBackdrops(container: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  for (let node = container.parentElement; node; node = node.parentElement) {
    chain.unshift(node);
  }
  return chain;
}

/**
 * Take the backgrounds {@link rootSurfaceBackdrops} named out of one overlay
 * layer's clone: the canvas leg has already painted them, UNDER the canvas they
 * belong under, so a second copy here would paint over the world.
 *
 * Called before any other clone surgery, while `source` and `clone` still walk
 * in the same order — the same index-parallel assumption the image and nested
 * canvas passes make.
 */
/**
 * CARRY WHAT A CLONE DOES NOT: the form state that lives in an IDL property
 * rather than in an attribute.
 *
 * `cloneNode(true)` copies ATTRIBUTES. A `<select>`'s selectedness is not one
 * — it is `HTMLOptionElement.selected`, and React never writes the `selected`
 * attribute for a controlled `<select>` — so the serialized clone reaches the
 * foreignObject with every option unselected and the browser paints THE FIRST
 * ONE. That is a camera that lies about the screen, and it lied loudly enough
 * to be written down as a product defect: WALK 5's beat 11b recorded "the rail
 * draws `Quaternion (WXYZ)`" for an object whose Rotation Mode was XYZ and
 * then ZYX, and a follow-up was raised against the enum WIDGET. Measured here
 * through the chrome door on 2026-09-21: the live `<select>`'s `value` is
 * `"XYZ"`, its options carry no `selected` attribute, and the widget is
 * correct. The instrument was the whole symptom.
 *
 * A checkbox has the same split (`checked` the property vs `checked` the
 * attribute), so a ticked box photographs empty; a `<textarea>`'s value is its
 * child text. A text/number `<input>` needs nothing — React keeps the `value`
 * attribute in sync for controlled inputs, which is why the Properties rail's
 * numbers always photographed correctly and only its one dropdown did not. It
 * is written anyway, because "which inputs React syncs" is not a fact this
 * module should have to depend on.
 *
 * Called while source and clone are still INDEX-PARALLEL — before the img,
 * video and canvas legs replace nodes.
 */
function carryFormStateInClone(source: Element, clone: Element): void {
  const FIELDS = 'select, input, textarea';
  const fieldsIn = (root: Element): Element[] => [
    ...(root.matches(FIELDS) ? [root] : []),
    ...Array.from(root.querySelectorAll(FIELDS)),
  ];
  const sources = fieldsIn(source);
  const clones = fieldsIn(clone);
  sources.forEach((field, index) => {
    const copy = clones[index];
    if (!copy) return;
    if (field instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) {
      const options = Array.from(field.options);
      Array.from(copy.options).forEach((option, at) => {
        if (options[at]?.selected) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      });
      return;
    }
    if (field instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
      if (field.type === 'checkbox' || field.type === 'radio') {
        if (field.checked) copy.setAttribute('checked', '');
        else copy.removeAttribute('checked');
      } else {
        copy.setAttribute('value', field.value);
      }
      return;
    }
    if (field instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
      copy.textContent = field.value;
    }
  });
}

/**
 * CARRY THE SCROLL. A clone's `scrollTop` is zero, and no markup can say
 * otherwise — so every scrolled panel in the editor photographed AT THE TOP.
 *
 * This is {@link carryFormStateInClone}'s twin and it cost more: B11 handed on
 * "an agent-added torus never appears in the Outliner, even after a restart"
 * as a panel-height finding, read off a frame from this camera. Measured here
 * 2026-09-21, through the chrome door, on eight objects in a five-row panel:
 * the live tree IS scrolled to the new object (first row at y −53 against a
 * body starting at 46 — 99 px of scroll, the active `Sphere.005` at 127..147,
 * the last fully visible row), and the SAME frame photographs the tree at row
 * zero. The panel was doing its job; the camera was not.
 *
 * WHY THE FIRST CHILD'S MARGIN and not a wrapper: a scroll IS the content
 * drawn `scrollTop` higher inside the same clipped box, and a negative margin
 * on the first in-flow child produces exactly that while leaving the
 * scroller's own layout mode untouched. A wrapper div would collapse a flex
 * column's items into one item and re-lay-out everything under it. The
 * element's own margin is READ off the source and subtracted from, so a
 * scroller whose first child already has one is not flattened.
 *
 * `overflow: hidden` on the clone because the offset content must be CLIPPED:
 * a foreignObject gets no scrollbars and an `auto` box would simply grow.
 */
function carryScrollInClone(source: Element, clone: Element): void {
  const sourceNodes = [source, ...Array.from(source.querySelectorAll('*'))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
  sourceNodes.forEach((node, index) => {
    const top = node.scrollTop;
    const left = node.scrollLeft;
    if (top === 0 && left === 0) return;
    const target = cloneNodes[index];
    if (!(target instanceof HTMLElement)) return;
    const first = target.firstElementChild;
    if (!(first instanceof HTMLElement)) return;
    target.style.overflow = 'hidden';
    const computed = getComputedStyle(node.firstElementChild ?? node);
    const marginTop = Number.parseFloat(computed.marginTop) || 0;
    const marginLeft = Number.parseFloat(computed.marginLeft) || 0;
    if (top !== 0) first.style.marginTop = `${marginTop - top}px`;
    if (left !== 0) first.style.marginLeft = `${marginLeft - left}px`;
  });
}

function clearBackdropsInClone(
  source: Element,
  clone: Element,
  backdrops: ReadonlySet<Element> | undefined,
): void {
  if (!backdrops?.size) return;
  const sourceNodes = [source, ...Array.from(source.querySelectorAll('*'))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
  sourceNodes.forEach((node, index) => {
    if (!backdrops.has(node)) return;
    const target = cloneNodes[index];
    if (target instanceof HTMLElement) target.style.background = 'transparent';
  });
}

export function buildOverlaySvg(
  container: HTMLElement,
  width: number,
  height: number,
  options?: CaptureOptions & {
    readonly canvasPixels?: CanvasPixels | undefined;
    /** {@link rootSurfaceBackdrops} — cleared in the clone because the canvas
     *  leg painted them under the canvas they belong under. */
    readonly transparentBackdrops?: ReadonlySet<Element> | undefined;
    /**
     * Rasterize at THIS pixel size while laying the clone out at `width` ×
     * `height`. The two are one number apart and they are not the same
     * question: the clone is DOM, so it must be laid out in the CSS pixels its
     * styles are written in (a 14px label is 14px, a 1px border is 1px),
     * while the frame may be wanted at device resolution or above it.
     * Stretching the wrapper's box instead would keep every font size and
     * border width at 1x inside a larger box — the layout would change, not
     * the resolution. A `viewBox` is the one mechanism that scales the
     * rendering: the browser rasterizes the `foreignObject` through it, so
     * text and borders come out at the output scale, vector-crisp.
     */
    readonly rasterSize?: { readonly width: number; readonly height: number } | undefined;
  },
): OverlaySvg | null {
  const overlays = Array.from(container.children).filter(
    (el) => el.tagName.toLowerCase() !== 'canvas',
  );
  if (overlays.length === 0) return null;

  const includeDocumentStyles = options?.includeDocumentStyles === true;
  const wrapper = includeDocumentStyles
    ? (container.cloneNode(false) as HTMLElement)
    : container.ownerDocument.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.inset = 'auto';
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.margin = '0';
  wrapper.style.transform = 'none';
  // Transparent is load-bearing for GAME capture, not tidiness — see the
  // scope marker below. An editor document keeps its real container backdrop,
  // unless that backdrop paints behind a root-surface canvas the canvas leg
  // already drew (see {@link rootSurfaceBackdrops}).
  if (includeDocumentStyles) copyComputedDocumentContext(container, wrapper);
  else wrapper.style.background = 'transparent';
  const backdrops = options?.transparentBackdrops;
  if (backdrops?.has(container)) wrapper.style.background = 'transparent';
  // THE CONTAINER MAY BE THE GAME'S CSS SCOPE ROOT. The neutral game path does
  // not clone that container (see this function's doc comment), so it would
  // otherwise lose the root and, with it, every `@scope`d rule that positions
  // the HUD. The ingest surface is exactly this shape: `#container` IS the game's
  // page in-realm and IS the marked scope root, and its HUD elements are its
  // CHILDREN. The wrapper already stands in for the container's box; it stands
  // in for its scope identity here too.
  //
  // Its own background stays transparent because that identity brings one
  // declaration that does not belong on this layer: the page backdrop
  // (`body { background }` → `:scope`). On screen that sits BEHIND the canvas,
  // and the canvas leg has already drawn it; repainting it here would hide the
  // game under its own background. A scope root that is INSIDE the container
  // (a story card's content) is cloned normally and keeps its backdrop.
  if (container.closest(`[${GAME_CSS_SCOPE_ATTRIBUTE}]`)) {
    wrapper.setAttribute(GAME_CSS_SCOPE_ATTRIBUTE, '');
  }
  if (includeDocumentStyles) {
    const css = documentStylesCssText(container.ownerDocument);
    if (css) {
      const documentStyles = container.ownerDocument.createElement('style');
      documentStyles.textContent = css;
      wrapper.appendChild(documentStyles);
    }
  }
  // Snapshot a stable DOM frame. CSS animations/transitions inside an SVG
  // foreignObject can be rasterized while Chrome is between compositor
  // layers, producing large opaque-black rectangles even though the live DOM
  // is fine (reproduced by the 2048 dogfood run during a tile-pop frame).
  // Disabling motion in the detached clone leaves the live game untouched
  // and makes the captured evidence atomic.
  const freezeMotion = container.ownerDocument.createElement('style');
  freezeMotion.textContent =
    '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;' +
    'backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}';
  wrapper.appendChild(freezeMotion);
  // The GAME's own page stylesheet, re-inlined for the same structural reason
  // the freeze above is: this clone is DETACHED, and a detached fragment
  // carries no document stylesheet. The sheet is already `@scope`d to the
  // containers the clone contains (`scoped-game-css.ts`), so re-inlining it
  // reaches exactly the game DOM and nothing else — and without it a styled
  // HUD photographs as unstyled, i.e. the look verb reports the very
  // wreckage the scoped stylesheet exists to remove.
  const gameCss = scopedGameStylesCssText();
  if (gameCss) {
    const gameStyles = container.ownerDocument.createElement('style');
    gameStyles.textContent = gameCss;
    wrapper.appendChild(gameStyles);
  }
  for (const el of overlays) {
    const clone = el.cloneNode(true) as Element;
    // Clear the backgrounds that paint BEHIND a root-surface canvas before any
    // other clone surgery, while source and clone are still index-parallel.
    clearBackdropsInClone(el, clone, backdrops);
    // …and carry the form state and the scroll offsets, for the same
    // index-parallel reason: the legs below REPLACE nodes.
    carryFormStateInClone(el, clone);
    carryScrollInClone(el, clone);
    // An SVG loaded from a `data:` URL cannot fetch an ordinary `/public/...`
    // image referenced by a nested `<img>`. The live DOM therefore looked
    // correct while both story screenshots and Doctor's UI-board evidence
    // silently omitted every authored bitmap. Snapshot each already-loaded
    // image through canvas and carry the pixels in the clone, exactly like the
    // nested-canvas path below. A cross-origin/tainted or not-yet-loaded image
    // keeps its original URL: capture remains best-effort for foreign content,
    // while same-origin project assets become self-contained.
    const sourceImages = [
      ...(el instanceof HTMLImageElement ? [el] : []),
      ...Array.from(el.querySelectorAll('img')),
    ];
    const clonedImages = [
      ...(clone instanceof HTMLImageElement ? [clone] : []),
      ...Array.from(clone.querySelectorAll('img')),
    ];
    clonedImages.forEach((image, index) => {
      const source = sourceImages[index];
      if (!source?.complete || source.naturalWidth <= 0 || source.naturalHeight <= 0) return;
      // `currentSrc` first: a `srcset` image's pixels follow the RESOLVED
      // candidate, and re-snapshotting on a `src` that never changed is the
      // exact per-frame cost the cache exists to remove.
      const src = source.currentSrc || source.src;
      const cached = options?.snapshots?.imgs.get(source);
      const url =
        cached && cached.src === src ? cached.url : canvasDataUrl(container.ownerDocument, source);
      if (!cached || cached.src !== src) options?.snapshots?.imgs.set(source, { src, url });
      if (url) image.setAttribute('src', url);
    });
    // A `<video>` is the `<img>` case one step further along: a detached clone
    // has no media pipeline, so a clip whose frame is decoded and on screen
    // photographs as a BLACK BOX — measured on a reference clip's Content tile
    // and its Asset Lab document, both of which a person could see perfectly
    // well. The element's CURRENT frame is `drawImage`-able exactly like an
    // image, so snapshot it and carry the pixels, keeping the element's own box
    // (an `<img>` in its place inherits the same style and layout). A video
    // with no decoded frame yet keeps its empty element rather than gaining a
    // fabricated one.
    const sourceVideos = [
      ...(el instanceof HTMLVideoElement ? [el] : []),
      ...Array.from(el.querySelectorAll('video')),
    ];
    const clonedVideos = [
      ...(clone instanceof HTMLVideoElement ? [clone] : []),
      ...Array.from(clone.querySelectorAll('video')),
    ];
    clonedVideos.forEach((video, index) => {
      const source = sourceVideos[index];
      if (!source || source.readyState < 2 || source.videoWidth <= 0) return;
      const url = canvasDataUrl(container.ownerDocument, source);
      if (!url) return;
      const image = container.ownerDocument.createElement('img');
      image.setAttribute('src', url);
      image.setAttribute('style', video.getAttribute('style') ?? '');
      video.replaceWith(image);
    });
    // A canvas nested INSIDE an overlay layer serializes as an empty box. Its
    // pixels are drawn by the canvas leg, but UNDER this whole overlay — so
    // anything the layer paints between them (the `2D` board's frames paint an
    // alpha checkerboard behind every exhibit) covers it, and the exhibit
    // photographs blank while looking perfectly fine on screen. When the caller
    // has the pixels, they are inlined HERE, in the nested canvas's own place,
    // so document order — the real z-order — decides what covers what. With no
    // pixels the old answer stands: strip it rather than ship a lying blank.
    const sources = Array.from(el.querySelectorAll('canvas'));
    Array.from(clone.querySelectorAll('canvas')).forEach((nested, index) => {
      const source = sources[index];
      // A host root-surface canvas was already painted by the canvas leg at
      // its exact on-screen rect. Re-inlining it here paints the same pixels a
      // second time inside a detached stacking context; Chromium then places
      // that raster over higher-z sibling DOM roots (the measured failure was
      // a Three game's HUD disappearing only from composite screenshots).
      // Board/story canvases are not root surfaces and still need this inline
      // path so their surrounding card backgrounds preserve document order.
      if (source && isRootCanvas(source)) {
        nested.remove();
        return;
      }
      const pixels = source ? options?.canvasPixels?.get(source) : undefined;
      const url = pixels ? canvasDataUrl(container.ownerDocument, pixels) : null;
      if (!url) {
        nested.remove();
        return;
      }
      const image = container.ownerDocument.createElement('img');
      image.setAttribute('src', url);
      image.setAttribute('style', `${nested.getAttribute('style') ?? ''}`);
      for (const attribute of Array.from(nested.attributes)) {
        image.setAttribute(attribute.name, attribute.value);
      }
      nested.replaceWith(image);
    });
    wrapper.appendChild(clone);
  }

  const serialized = new XMLSerializer().serializeToString(wrapper);
  const rasterWidth = options?.rasterSize?.width ?? width;
  const rasterHeight = options?.rasterSize?.height ?? height;
  // The viewBox is emitted ONLY when the raster differs from the layout, so an
  // unscaled capture serializes the exact string it always has.
  const viewBox =
    rasterWidth === width && rasterHeight === height ? '' : ` viewBox="0 0 ${width} ${height}"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rasterWidth}" height="${rasterHeight}"${viewBox}>` +
    `<foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  return { svg, overlayCount: overlays.length };
}

export interface CompositeCapture {
  base64: string;
  mimeType: 'image/png';
  /** Honest capture provenance: how many canvases were drawn, and how many
   *  DOM layers rode the foreignObject leg. */
  layers: { canvases: number; domOverlays: number };
  /** How much of the frame is one flat surface — see {@link measureFlatness}.
   *  Absent only when the readback itself was unavailable (tainted canvas). */
  flatness?: CaptureFlatness;
}

export interface CompositeFrame {
  /** Number of native canvas surfaces painted into this frame. */
  canvases: number;
  /** Number of DOM overlay roots painted above those canvases. */
  domOverlays: number;
}

/** The three independently fallible legs of a full game-frame capture. */
export type CaptureLayer = 'canvas' | 'dom-overlay' | 'composite-output';

const CAPTURE_LAYER_LABEL: Record<CaptureLayer, string> = {
  canvas: 'canvas layer',
  'dom-overlay': 'DOM overlay layer',
  'composite-output': 'composite output',
};

/**
 * A capture failure whose message names the layer that failed. This crosses
 * the active-document and relay doors unchanged, so neither caller has to
 * infer a layer from a browser exception such as "The operation is insecure".
 */
export class CaptureLayerError extends Error {
  readonly layer: CaptureLayer;

  constructor(layer: CaptureLayer, error: unknown) {
    // Browser exceptions can come from another realm (an ingested page or
    // jsdom's DOM realm), where `instanceof Error` is false despite a real
    // `.message`. Read the platform shape rather than losing it to
    // `String(error)`'s generic "Error: …" prefix.
    const detail =
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
        ? error.message
        : String(error);
    super(`${CAPTURE_LAYER_LABEL[layer]} capture failed — ${detail}`);
    this.name = 'CaptureLayerError';
    this.layer = layer;
  }
}

function layerFailure(layer: CaptureLayer, error: unknown): CaptureLayerError {
  return error instanceof CaptureLayerError ? error : new CaptureLayerError(layer, error);
}

/**
 * Is this capture worth anything as evidence?
 *
 * Measured failure (two blind probes, 2026-08): both filed near-blank
 * screenshots — "essentially blank: a black band over a flat beige plane",
 * "camera buried in geometry" — under "Tested". A PNG that is one flat colour
 * proves nothing, and nothing in the pipeline said so, so the reader had to
 * open the file and notice. This is the cheap heuristic that says it at
 * capture time.
 *
 * `warning` is the ONE place the sentence is spelled. Every surface that
 * shows this (the `vgai screenshot` verb, the `/__vgai/screenshot` poke, the
 * relay transport behind `game.screenshot()`) lives in a different package,
 * and three copies of a sentence is three sentences that drift — so the layer
 * holding the pixels writes the words and the rest print them verbatim.
 */
export interface CaptureFlatness {
  /** Fraction of sampled cells inside the single largest near-uniform region. */
  dominantFraction: number;
  /** That region's mean colour, `#rrggbb` — names WHICH flat surface it is. */
  dominantColor: string;
  /** How many coarse colour regions cover >=1% of the frame. Reported for
   *  context only; nothing branches on it (see the threshold note below). */
  distinctRegions: number;
  degenerate: boolean;
  /** Present iff `degenerate`. */
  warning?: string;
}

/**
 * Grid the measure samples at. 32x32 = 1024 cells: fine enough that a HUD
 * strip, a character, or a horizon occupies several cells, coarse enough that
 * the whole measurement is one GPU-side downsample plus 4 KB of readback no
 * matter how large the capture is.
 */
export const FLATNESS_GRID = 32;

/** Per-channel tolerance for "still the same flat surface". A wall or sky
 *  under one light still shades by a few levels across the frame; 24/255 keeps
 *  those together without merging two genuinely different surfaces. */
const FLAT_TOLERANCE = 24;

/**
 * Warn at 90%: nine tenths of the frame is one surface, i.e. less than a tenth
 * of the picture shows anything at all. Deliberately high — this warns, it
 * never refuses, and a warning that fires on ordinary frames is a warning
 * people learn to skip. Measured live against the starter template: the
 * default stage (sky + construction grid + focal cube) reads 0.745 — high,
 * because a ground plane legitimately owns three quarters of that frame — and
 * a camera sealed inside geometry reads 1.000. Anything under 0.9 is a picture
 * a reader can still learn something from; the interesting failures pile up at
 * the very top of the range.
 */
export const FLATNESS_WARN_AT = 0.9;

/**
 * The pure half: given RGBA for `cellCount` sampled cells, how dominated is
 * the frame by one near-uniform region?
 *
 * Two passes, no dependencies. First bucket every cell coarsely (32-wide per
 * channel) to find the busiest region; then re-count every cell within
 * `FLAT_TOLERANCE` of that region's MEAN, which is what stops a smooth surface
 * that happens to straddle a bucket boundary from reading as two regions.
 */
type Rgb = [number, number, number];

/** One sampled cell's colour. The `?? 0` keeps a short/ragged buffer from
 *  producing NaN arithmetic downstream. */
function cellColor(rgba: Uint8ClampedArray | number[], cell: number): Rgb {
  return [rgba[cell * 4] ?? 0, rgba[cell * 4 + 1] ?? 0, rgba[cell * 4 + 2] ?? 0];
}

/** Pass 1: coarse buckets (32 levels per channel) to find the busiest region
 *  and count how many regions cover >=1% of the frame. */
function dominantRegion(
  rgba: Uint8ClampedArray | number[],
  cellCount: number,
): { mean: Rgb; distinctRegions: number } {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let cell = 0; cell < cellCount; cell++) {
    const [r, g, b] = cellColor(rgba, cell);
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let top = { n: 1, r: 0, g: 0, b: 0 };
  let distinctRegions = 0;
  for (const bucket of buckets.values()) {
    if (bucket.n / cellCount >= 0.01) distinctRegions += 1;
    if (bucket.n > top.n) top = bucket;
  }
  return {
    mean: [Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)],
    distinctRegions,
  };
}

/** Pass 2: every cell within `FLAT_TOLERANCE` of that mean, which is what
 *  stops a smooth surface straddling a bucket boundary from reading as two. */
function countWithinTolerance(
  rgba: Uint8ClampedArray | number[],
  cellCount: number,
  mean: Rgb,
): number {
  let within = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    const color = cellColor(rgba, cell);
    const delta = Math.max(
      Math.abs(color[0] - mean[0]),
      Math.abs(color[1] - mean[1]),
      Math.abs(color[2] - mean[2]),
    );
    if (delta <= FLAT_TOLERANCE) within += 1;
  }
  return within;
}

export function measureFlatness(
  rgba: Uint8ClampedArray | number[],
  cellCount: number,
  threshold = FLATNESS_WARN_AT,
): CaptureFlatness {
  if (cellCount <= 0) {
    return { dominantFraction: 0, dominantColor: '#000000', distinctRegions: 0, degenerate: false };
  }
  const { mean, distinctRegions } = dominantRegion(rgba, cellCount);
  const dominantFraction =
    Math.round((countWithinTolerance(rgba, cellCount, mean) / cellCount) * 1000) / 1000;
  const dominantColor = `#${mean.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const degenerate = dominantFraction >= threshold;
  const warning =
    `this capture is ~${Math.round(dominantFraction * 100)}% one flat surface ` +
    `(${dominantColor}) — likely a wall, an empty view, or a buried camera; ` +
    'it is weak evidence.';
  return {
    dominantFraction,
    dominantColor,
    distinctRegions,
    degenerate,
    ...(degenerate ? { warning } : {}),
  };
}

/**
 * The DOM half: downsample any drawable source to {@link FLATNESS_GRID} and
 * measure it. The downsample is `drawImage` into a tiny canvas — the
 * compositor does the averaging, so cost is independent of capture size and
 * the readback is 4 KB. Returns null when readback is unavailable (a tainted
 * canvas), because a missing measurement must never read as a clean one.
 */
export function sampleFlatness(
  source: CanvasImageSource,
  doc: Document,
  threshold = FLATNESS_WARN_AT,
): CaptureFlatness | null {
  try {
    const grid = doc.createElement('canvas');
    grid.width = FLATNESS_GRID;
    grid.height = FLATNESS_GRID;
    const ctx = grid.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, FLATNESS_GRID, FLATNESS_GRID);
    const pixels = ctx.getImageData(0, 0, FLATNESS_GRID, FLATNESS_GRID);
    return measureFlatness(pixels.data, FLATNESS_GRID * FLATNESS_GRID, threshold);
  } catch {
    return null;
  }
}

/** Wait briefly for finite CSS/Web Animations to settle before serializing a
 * DOM frame. Chromium can rasterize an actively animated foreignObject as
 * opaque black compositor tiles; a settled frame is both more legible and
 * closer to what a human sees after the interaction. Infinite ambience never
 * blocks evidence capture, and the timeout keeps a broken animation from
 * wedging the relay. */
export async function waitForFiniteMotion(container: HTMLElement, maxWaitMs = 350): Promise<void> {
  if (typeof container.getAnimations !== 'function') return;
  const animations = container.getAnimations({ subtree: true }).filter((animation) => {
    const endTime = animation.effect?.getComputedTiming().endTime;
    return typeof endTime === 'number' && Number.isFinite(endTime);
  });
  if (animations.length === 0) return;
  await Promise.race([
    Promise.allSettled(animations.map((animation) => animation.finished)),
    new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
  ]);
}

/** Cross two paint boundaries when the tab is rendering, but never depend on
 * rAF firing: Chromium suspends it for hidden/background editor tabs, and a
 * screenshot is specifically expected to work there. The timer is the
 * bounded fallback, not an extra delay after a successful frame. */
export async function waitForPaint(container: HTMLElement, maxWaitMs = 75): Promise<void> {
  const requestFrame = container.ownerDocument.defaultView?.requestAnimationFrame.bind(
    container.ownerDocument.defaultView,
  );
  if (!requestFrame) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, maxWaitMs);
    requestFrame(() => requestFrame(finish));
  });
}

/**
 * Rasterize the full play container (canvases + DOM UI layers) to a PNG.
 * Output is sized to the container's CSS rect — the same geometry the human
 * sees. Throws on any rasterization failure; the caller
 * (`handleBridgeScreenshot`) degrades to the canvas-only capture and marks
 * the result honestly rather than failing the op.
 */
export async function capturePlayComposite(
  container: HTMLElement,
  options?: CaptureOptions,
): Promise<CompositeCapture> {
  // Debug state can become observable just before React commits the matching
  // DOM. Cross two paint boundaries first, then let newly-mounted finite
  // transitions finish, then cross one more stable paint before cloning.
  await waitForPaint(container);
  // Chrome's foreignObject renderer can retain opaque-black compositor tiles
  // for several frames after a React-only tree replaces an overlay (observed
  // on an immediate game-over -> restart capture even after its 180ms tile
  // animation reported finished). Give DOM-only roots one short compositor
  // settle window; canvas-backed games do not use this fragile leg as their
  // sole image and keep the faster path.
  //
  // WHICH ROOTS ARE DOM-ONLY is a DECLARATION when the caller has one
  // ({@link CaptureOptions.presentsOnCanvas}); the canvas count is the measured
  // fallback, and it is spelled second so the fallback reads as one.
  //
  // The window itself STAYS, for both: it does not answer "has the game
  // painted" (declared readiness answers that, upstream, before capture is even
  // called) — it answers "has Chromium finished compositing the tiles it will
  // rasterize from", which no game can declare. Its measured companion is the
  // transparent/near-black retry below, which grades the actual pixels.
  const presentsOnCanvas =
    options?.presentsOnCanvas ?? container.querySelectorAll('canvas').length > 0;
  if (!presentsOnCanvas) {
    await new Promise<void>((resolve) => setTimeout(resolve, 650));
  }
  await waitForFiniteMotion(container);
  await waitForPaint(container);
  return capturePlayCompositeAttempt(container, 2, options ?? {});
}

/** How much fully-transparent area still reads as a torn/blank frame rather
 *  than as rounded corners (which stay far below it). One constant, because the
 *  retry and the refusal below must agree about what "photographed nothing"
 *  means. */
export const TRANSPARENT_PIXEL_LIMIT = 0.03;

/** Fraction of the frame at alpha 0 — the measure both the bounded retry and
 *  the refusal read. */
export function transparentPixelFraction(rgba: Uint8ClampedArray, pixelCount: number): number {
  if (pixelCount <= 0) return 0;
  let transparent = 0;
  for (let alpha = 3; alpha < rgba.length; alpha += 4) {
    if (rgba[alpha] === 0) transparent += 1;
  }
  return transparent / pixelCount;
}

export function hasExcessTransparentPixels(
  rgba: Uint8ClampedArray,
  pixelCount: number,
  limit = TRANSPARENT_PIXEL_LIMIT,
): boolean {
  if (pixelCount <= 0) return false;
  return transparentPixelFraction(rgba, pixelCount) > limit;
}

/** Chromium's foreignObject compositor sometimes fills a torn tile with
 * fully-opaque black rather than transparency. Catch only a LARGE region of
 * near-pure black; a legitimately dark game merely takes the bounded retry
 * path and is still returned unchanged when it remains dark. */
export function hasExcessNearBlackPixels(
  rgba: Uint8ClampedArray,
  pixelCount: number,
  limit = 0.08,
): boolean {
  if (pixelCount <= 0) return false;
  let black = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (
      rgba[offset]! <= 8 &&
      rgba[offset + 1]! <= 8 &&
      rgba[offset + 2]! <= 8 &&
      rgba[offset + 3]! >= 250
    ) {
      black += 1;
    }
  }
  return black / pixelCount > limit;
}

type DomOnlyVerdict =
  | { kind: 'ok' }
  | { kind: 'retry' }
  | { kind: 'blank'; transparentFraction: number };

/**
 * Grade a DOM-ONLY composite (no canvas underneath it) on its own pixels.
 *
 * Two failures wear the same face here, and both end as black PNGs:
 *  - A Chromium foreignObject can decode while React is between compositor
 *    frames, leaving large transparent rectangles in an otherwise opaque
 *    frame — that one is transient, so it earns a repaint and a retry.
 *    Rounded-corner edge pixels stay far below {@link TRANSPARENT_PIXEL_LIMIT}.
 *  - Nothing painted a backdrop at all. Out of retries and still mostly zero
 *    alpha, the frame is REFUSED rather than returned: `measureFlatness` never
 *    sees alpha, so it scores an empty frame as an ordinary flat surface and
 *    the caller is handed a black photograph plus a warning about a buried
 *    camera. That is the fabrication this module exists to not commit.
 *
 * A canvas-backed capture has its canvas underneath and is never graded here.
 */
function judgeDomOnlyFrame(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
  retriesRemaining: number,
): DomOnlyVerdict {
  let pixels: ImageData;
  try {
    pixels = ctx2d.getImageData(0, 0, width, height);
  } catch {
    // Readback unavailable (a tainted canvas): preserve the existing honest
    // capture, or let `toDataURL` surface the taint downstream.
    return { kind: 'ok' };
  }
  const pixelCount = width * height;
  const transparentFraction = transparentPixelFraction(pixels.data, pixelCount);
  const excessTransparent = transparentFraction > TRANSPARENT_PIXEL_LIMIT;
  if (
    retriesRemaining > 0 &&
    (excessTransparent || hasExcessNearBlackPixels(pixels.data, pixelCount))
  ) {
    return { kind: 'retry' };
  }
  return excessTransparent ? { kind: 'blank', transparentFraction } : { kind: 'ok' };
}

/**
 * The bounding box of every pixel with any alpha, or `null` for a frame that
 * painted nothing. Runs on the PRE-backdrop composite (the crop path skips the
 * container's own background exactly so this scan sees only the subject), so
 * painted alpha IS the content — the measured half of "mount in the truth,
 * frame the subject".
 */
function contentAlphaBounds(
  ctx2d: CanvasRenderingContext2D,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } | null {
  let pixels: ImageData;
  try {
    pixels = ctx2d.getImageData(0, 0, width, height);
  } catch {
    // Readback unavailable (a tainted canvas): no measurement, so degrade to
    // the full frame — an uncropped capture, never a false blank refusal.
    return { left: 0, top: 0, right: width, bottom: height };
  }
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  const data = pixels.data;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

async function capturePlayCompositeAttempt(
  container: HTMLElement,
  retriesRemaining: number,
  options: CaptureOptions,
): Promise<CompositeCapture> {
  const out = container.ownerDocument.createElement('canvas');
  const layers = await drawPlayCompositeFrame(container, out, options);
  const width = out.width;
  const height = out.height;
  const ctx2d = out.getContext('2d');
  if (!ctx2d) {
    throw new CaptureLayerError('composite-output', 'no 2d canvas context');
  }

  if (layers.canvases === 0 && layers.domOverlays > 0 && options?.cropToContent === true) {
    // The crop path's own emptiness test: the frame deliberately has no
    // backdrop yet, so painted alpha IS the content. Nothing painted after
    // the retries is the same blank refusal as below; content crops to its
    // measured union plus padding, on the container's own backdrop.
    const bounds = contentAlphaBounds(ctx2d, width, height);
    if (bounds === null) {
      if (options.allowTransparent)
        return { base64: out.toDataURL('image/png').split(',')[1]!, mimeType: 'image/png', layers };
      if (retriesRemaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        await waitForPaint(container);
        return capturePlayCompositeAttempt(container, retriesRemaining - 1, options);
      }
      throw new CaptureLayerError(
        'dom-overlay',
        'the composite is ~100% fully transparent after two repaints — nothing in it painted ' +
          "a backdrop, so the PNG would read as a flat black frame. This subject's background " +
          'is painted by an element OUTSIDE what is being photographed (a detached clone ' +
          'carries no ancestors), or its own DOM never mounted.',
      );
    }
    const CROP_PAD = 16;
    const x0 = Math.max(0, bounds.left - CROP_PAD);
    const y0 = Math.max(0, bounds.top - CROP_PAD);
    const x1 = Math.min(width, bounds.right + CROP_PAD);
    const y1 = Math.min(height, bounds.bottom + CROP_PAD);
    const cropped = container.ownerDocument.createElement('canvas');
    cropped.width = Math.max(1, x1 - x0);
    cropped.height = Math.max(1, y1 - y0);
    const croppedCtx = cropped.getContext('2d');
    if (!croppedCtx) throw new CaptureLayerError('composite-output', 'no 2d canvas context');
    const ownBackground = getComputedStyle(container).backgroundColor;
    if (ownBackground && ownBackground !== 'transparent' && ownBackground !== 'rgba(0, 0, 0, 0)') {
      croppedCtx.fillStyle = ownBackground;
      croppedCtx.fillRect(0, 0, cropped.width, cropped.height);
    }
    croppedCtx.drawImage(
      out,
      x0,
      y0,
      cropped.width,
      cropped.height,
      0,
      0,
      cropped.width,
      cropped.height,
    );
    const flatness = sampleFlatness(cropped, container.ownerDocument);
    let croppedUrl: string;
    try {
      croppedUrl = cropped.toDataURL('image/png');
    } catch (error) {
      throw layerFailure('composite-output', error);
    }
    const croppedComma = croppedUrl.indexOf(',');
    return {
      base64: croppedComma >= 0 ? croppedUrl.slice(croppedComma + 1) : croppedUrl,
      mimeType: 'image/png',
      layers,
      ...(flatness ? { flatness } : {}),
    };
  }
  if (layers.canvases === 0 && layers.domOverlays > 0 && !options.allowTransparent) {
    const verdict = judgeDomOnlyFrame(ctx2d, width, height, retriesRemaining);
    if (verdict.kind === 'retry') {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      await waitForPaint(container);
      return capturePlayCompositeAttempt(container, retriesRemaining - 1, options);
    }
    if (verdict.kind === 'blank') {
      throw new CaptureLayerError(
        'dom-overlay',
        `the composite is ~${Math.round(verdict.transparentFraction * 100)}% fully transparent ` +
          'after two repaints — nothing in it painted a backdrop, so the PNG would read as a flat ' +
          "black frame. This subject's background is painted by an element OUTSIDE what is being " +
          'photographed (a detached clone carries no ancestors), or its own DOM never mounted.',
      );
    }
  }

  // Measure BEFORE encoding, off the composite we just drew: the pixels are
  // already here, so honesty costs one downsample and no PNG decode anywhere
  // downstream. (The alternative — measuring in Node from the CLI — would need
  // a PNG decoder this repo does not ship, in a process that never has the
  // frame in memory in the first place.)
  const flatness = sampleFlatness(out, container.ownerDocument);

  let dataUrl: string;
  try {
    dataUrl = out.toDataURL('image/png');
  } catch (error) {
    throw layerFailure('composite-output', error);
  }
  const comma = dataUrl.indexOf(',');
  return {
    base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
    mimeType: 'image/png',
    layers,
    ...(flatness ? { flatness } : {}),
  };
}

/** Fill each element's own painted background at its own on-screen box,
 *  outermost first — the order and the places the browser has them, so a
 *  translucent ("glass") surface composites the way it does on screen. */
function paintBackdrops(
  ctx2d: CanvasRenderingContext2D,
  elements: readonly HTMLElement[],
  rect: DOMRect,
  scaleX = 1,
  scaleY = 1,
): void {
  for (const element of elements) {
    const color = opaqueBackgroundColor(element);
    if (!color) continue;
    const box = element.getBoundingClientRect();
    ctx2d.fillStyle = color;
    ctx2d.fillRect(
      (box.left - rect.left) * scaleX,
      (box.top - rect.top) * scaleY,
      box.width * scaleX,
      box.height * scaleY,
    );
  }
}

/**
 * Paint one current game frame into a caller-owned canvas.
 *
 * Screenshots call this once and encode the result. Gameplay recording calls
 * it repeatedly while a native `MediaRecorder` consumes `output.captureStream()`.
 * Keeping the draw primitive here is what guarantees that a still and a video
 * see the same game stack: every world canvas plus DOM HUD. This function
 * performs no settling,
 * retry, quality judgment, or encoding; those are policies of its callers.
 */
export async function drawPlayCompositeFrame(
  container: HTMLElement,
  output: HTMLCanvasElement,
  options?: CaptureOptions,
): Promise<CompositeFrame> {
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, Math.round(options?.size?.width ?? rect.width));
  const height = Math.max(1, Math.round(options?.size?.height ?? rect.height));
  const scaleX = options?.size ? width / rect.width : 1;
  const scaleY = options?.size ? height / rect.height : 1;
  if (output.width !== width) output.width = width;
  if (output.height !== height) output.height = height;

  const ctx2d = output.getContext('2d');
  if (!ctx2d) {
    throw new CaptureLayerError('composite-output', 'no 2d canvas context');
  }
  ctx2d.clearRect(0, 0, width, height);

  // The container's OWN background, painted first. Both backdrop walks below
  // start from canvases, so a canvas-less DOM subject (a story capture host,
  // whose inline backdrop exists precisely to show through wherever the story
  // paints nothing) composited as pure overlay — and a sparse HUD story came
  // back ~99% transparent and was refused as blank. A crop-to-content capture
  // skips it HERE so the content-bounds scan sees only what the subject
  // painted; the cropped output re-paints it underneath.
  if (options?.cropToContent !== true) {
    const ownBackground = getComputedStyle(container).backgroundColor;
    if (ownBackground && ownBackground !== 'transparent' && ownBackground !== 'rgba(0, 0, 0, 0)') {
      ctx2d.fillStyle = ownBackground;
      ctx2d.fillRect(0, 0, width, height);
    }
  }

  // The backdrop the SUBJECT ITSELF does not paint — an editor document's panel
  // fill lives on an ancestor, which the detached clone cannot carry. See {@link ancestorBackdrops} for the measurement that put this here.
  if (options?.includeDocumentStyles) {
    paintBackdrops(ctx2d, ancestorBackdrops(container), rect, scaleX, scaleY);
  }

  // The backgrounds that paint BEHIND a root-surface canvas, painted before the
  // canvases themselves. Without this leg they ride the overlay ABOVE the
  // canvases and erase the world. See {@link rootSurfaceBackdrops} for the
  // measurement that put this here.
  // Canvas pixels can change without a DOM mutation. A nested UI canvas must
  // be photographed this frame, not frozen into the recorder's HUD cache.
  const nestedCanvas = Array.from(container.querySelectorAll('canvas')).some(
    (canvas) => !isRootCanvas(canvas),
  );
  const cached = nestedCanvas ? null : options?.overlayCache?.take(container, width, height);
  const backdrops = cached?.backdrops ?? rootSurfaceBackdrops(container);
  paintBackdrops(ctx2d, backdrops, rect, scaleX, scaleY);

  // Hidden/restored documents can retain a canvas whose backing store or
  // layout box is zero-sized. The browser paints no pixels for it, and
  // CanvasRenderingContext2D.drawImage throws instead of expressing that
  // no-op. Keep the capture's canvas count tied to surfaces that could
  // actually contribute pixels to the frame.
  const canvases = Array.from(container.querySelectorAll('canvas')).filter((canvas) => {
    const canvasRect = canvas.getBoundingClientRect();
    return canvas.width > 0 && canvas.height > 0 && canvasRect.width > 0 && canvasRect.height > 0;
  });
  const canvasPixels = new Map<HTMLCanvasElement, CanvasImageSource>();
  for (const canvas of canvases) {
    try {
      const canvasRect = canvas.getBoundingClientRect();
      // `?? canvas` is the unchanged path: no seam offered, or the seam had no
      // frame for THIS canvas, means read the canvas itself.
      const pixels = (await options?.canvasFrame?.(canvas)) ?? canvas;
      canvasPixels.set(canvas, pixels);
      ctx2d.drawImage(
        pixels,
        (canvasRect.left - rect.left) * scaleX,
        (canvasRect.top - rect.top) * scaleY,
        canvasRect.width * scaleX,
        canvasRect.height * scaleY,
      );
    } catch (error) {
      throw layerFailure('canvas', error);
    }
  }

  let domOverlays = 0;
  // The same pixels ride the overlay leg, so a canvas nested inside an overlay
  // layer keeps its z-order instead of being painted over by its own layer.
  try {
    if (cached) {
      if (cached.image) ctx2d.drawImage(cached.image, 0, 0, width, height);
      domOverlays = cached.overlayCount;
    } else {
      const buildStart = performance.now();
      // LAYOUT in CSS pixels, RASTER at the output size. `size` scales the
      // frame, never the DOM's own geometry: the clone is laid out in the
      // pixels its stylesheet is written in and the SVG's viewBox does the
      // scaling, so a 2x frame has 2x-resolution text rather than the same
      // text in a doubled box. See {@link buildOverlaySvg}'s `rasterSize`.
      const overlay = buildOverlaySvg(container, width / scaleX, height / scaleY, {
        includeDocumentStyles: options?.includeDocumentStyles,
        canvasPixels,
        transparentBackdrops: new Set<Element>(backdrops),
        snapshots: options?.snapshots,
        rasterSize: { width, height },
      });
      if (overlay) {
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(overlay.svg)}`;
        await image.decode();
        ctx2d.drawImage(image, 0, 0, width, height);
        domOverlays = overlay.overlayCount;
        options?.overlayCache?.store(
          container,
          width,
          height,
          { image, overlayCount: overlay.overlayCount, backdrops },
          performance.now() - buildStart,
        );
      } else {
        options?.overlayCache?.store(
          container,
          width,
          height,
          { image: null, overlayCount: 0, backdrops },
          performance.now() - buildStart,
        );
      }
    }
  } catch (error) {
    throw layerFailure('dom-overlay', error);
  }

  return { canvases: canvases.length, domOverlays };
}
