/**
 * CANVAS PREVIEW AND PRESENTED PIXELS — the host's Pixi pixel plumbing, over a
 * live display subtree that is already there. Two jobs, one substrate:
 *
 *  - PHOTOGRAPHING a live subtree on an independent Application, under a node
 *    budget, so selecting a node costs a bounded amount whatever it selected
 *    ({@link capturePixiDisplayObjectThumbnail}, {@link snapshotPixiPreviewSubject}).
 *  - Answering the composite screenshot's `canvasFrame` seam for a canvas a
 *    Pixi renderer owns, whose drawing buffer is gone by the time the
 *    compositor reads it ({@link presentedPixiFrame}, over the surfaces that
 *    registered themselves).
 *
 * Neither job knows what put the objects there. A first-party canvas world, an
 * ingested game and a portable CSF story register the same way and are
 * photographed the same way — which is why this is the HOST's and not the story
 * estate's. It lived inside `stories/story-pixi-preview.ts` and four of its
 * five callers never had a story in hand (`authoring/canvas-design-mount.ts`,
 * `authoring/pixi-still-presentation.ts`, `components/world-root-stage.ts`,
 * `live-canvas-frame.ts`, and the ingest lane's canvas mount); moving it out is
 * the part of the CSF estate's exit to `@vgai/game` (WORK.md §The open-source
 * launch, phase 1 unit 3) that does not wait on anything else.
 */

import type { Application, Container, Matrix, Rectangle } from 'pixi.js';
import * as shellPixi from 'pixi.js';
type CanvasPixiNamespace = typeof shellPixi;

/** Requested presentation size for a photographed subject. Presentation only:
 *  it never becomes a second authored size or a component-specific asset. */
export interface CanvasThumbnailSize {
  readonly width?: number;
  readonly height?: number;
}

/**
 * How many display objects one selection preview may photograph.
 *
 * THE COST CLASS: selecting a node cloned and rendered that node's WHOLE
 * subtree to produce a 128-pixel picture. Selection is the editor's most
 * frequent gesture, and the cost was O(selected subtree) — unbounded.
 *
 * MEASURED in the page (`new Profiler`, 2.5s window around ONE relayed
 * `select` of the world root, scale harness's canvas N=20000 world, same tab,
 * same world, the only difference being whether this budget is live):
 *
 *   inclusive samples, of the window's total
 *     before   112 / 346   capturePixiDisplayObjectThumbnail
 *                          — under it: generateTexture 70, collectRenderables
 *                            34, getLocalBounds 19, i.e. a 20 000-object
 *                            clone photographed on a real renderer
 *     after      0 / 241   the frame is absent from the trace entirely, and
 *                          so are generateTexture, collectRenderables and
 *                          getLocalBounds
 *
 * WHAT IT WAS NOT, stated because the shape misleads: this cost is NOT the
 * long-animation-frame block a selection reports. It is asynchronous GPU and
 * clone work spread across the frames after the click, so LoAF never named it
 * and the editor's worst SINGLE block at N=20000 is unchanged by this fix (see
 * `scale-speed-thumbnail-budget-{before,after}.json`; that block belongs to
 * React's own layout-effect commit). What the profiler measures, and what this
 * removes, is a third of all sampled main-thread time after a click.
 *
 * Deferral alone does not fix it — `components/inspector-preview-section.tsx`
 * already holds the picture back a frame (`useAfterPaint`) and the work simply
 * lands in the next frames instead. The only bound that holds is a bound on the
 * WORK, so the subtree is COUNTED first (no further than this many nodes, so
 * the count is itself O(budget), never O(subtree)) and a subtree above the
 * budget is DECLINED — no clone, no render, no allocation.
 *
 * The number: an authored component — a HUD, a character, a prefab, the thing
 * a human actually selects and wants to see — is tens to low hundreds of
 * display objects, so this is roughly an order of magnitude of headroom above
 * the case the preview exists to serve. What it declines is a LEVEL ROOT, and
 * a level root at 128 pixels was never a picture of anything.
 */
export const PREVIEW_SUBTREE_NODE_BUDGET = 2_000;

/**
 * Display objects in `source`'s subtree, counted no further than `limit`.
 *
 * The return is the true count when that is at most `limit`, and `limit + 1` —
 * "more than `limit`" — otherwise. That ceiling is the whole point: the caller's
 * question is "may I afford this?", and a count that answered it exactly would
 * pay the very cost it is being asked to avoid.
 *
 * Drained with a CURSOR rather than `Array.prototype.shift()`, for the reason
 * `authoring/hierarchy-walk.ts` records: `shift` moves every remaining element
 * down, so a flat-fanned tree turns a linear-looking walk quadratic.
 */
export function countPixiSubtree(source: Container, limit: number): number {
  const queue: Container[] = [source];
  let cursor = 0;
  let count = 0;
  while (cursor < queue.length) {
    const node = queue[cursor++]!;
    count++;
    if (count > limit) return limit + 1;
    for (const child of node.children) queue.push(child as Container);
  }
  return count;
}

/**
 * Render-only snapshot of a live display subtree, or `null` when the subtree is
 * larger than `budget`. The source is never reparented, filtered, or rendered:
 * same stance as three's `createAssetPreviewSnapshot`. Textures are shared;
 * filters are not (they bind to the live renderer).
 *
 * The budget is a DEFAULT rather than an opt-in — see
 * {@link PREVIEW_SUBTREE_NODE_BUDGET}. A caller that genuinely wants the whole
 * tree whatever it costs passes `Number.POSITIVE_INFINITY` and says why.
 */
export function snapshotPixiPreviewSubject(
  source: Container,
  budget: number = PREVIEW_SUBTREE_NODE_BUDGET,
  pixi: CanvasPixiNamespace = shellPixi,
): Container | null {
  if (countPixiSubtree(source, budget) > budget) return null;
  const snapshot = clonePixiVisual(pixi, source);
  const world = composedWorldMatrix(pixi, source);
  snapshot.position.set(0, 0);
  snapshot.scale.set(Math.hypot(world.a, world.b), Math.hypot(world.c, world.d));
  snapshot.rotation = Math.atan2(world.b, world.a);
  snapshot.visible = true;
  return snapshot;
}

/** Compose local transforms up to the stage. Avoids `updateTransform()`,
 * which requires a live render-group parent the snapshot must not assume. */
function composedWorldMatrix(pixi: CanvasPixiNamespace, source: Container): Matrix {
  const world = new pixi.Matrix();
  const chain: Container[] = [];
  for (let node: Container | null = source; node; node = node.parent) chain.push(node);
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i]!.updateLocalTransform();
    world.append(chain[i]!.localTransform);
  }
  return world;
}

/**
 * `pixi` is the namespace `source` ITSELF came from — see
 * `../../vite-plugin-module-doorways.ts`. Every `instanceof` below is a class
 * from that same graph, which is what makes the chain answer at all: against
 * the shell's classes a project subtree missed EVERY branch, fell to the
 * generic Container tail, and produced a preview with no textures in it —
 * exactly the empty-preview failure the NineSlice note below records, at the
 * scale of the whole tree.
 */
function clonePixiVisual(pixi: CanvasPixiNamespace, source: Container): Container {
  // NineSliceSprite is a ViewContainer, not a Sprite. Falling through to the
  // generic Container branch drops the texture and yields an empty preview —
  // the measured Bubbo HUD `decorContainer` trays and borders.
  if (source instanceof pixi.NineSliceSprite) {
    const slice = new pixi.NineSliceSprite({
      texture: source.texture,
      leftWidth: source.leftWidth,
      rightWidth: source.rightWidth,
      topHeight: source.topHeight,
      bottomHeight: source.bottomHeight,
      width: source.width,
      height: source.height,
    });
    slice.anchor.copyFrom(source.anchor);
    slice.tint = source.tint;
    copyPixiLocalPose(source, slice);
    return slice;
  }
  if (source instanceof pixi.TilingSprite) {
    const tile = new pixi.TilingSprite({
      texture: source.texture,
      width: source.width,
      height: source.height,
    });
    tile.tilePosition.copyFrom(source.tilePosition);
    tile.tileScale.copyFrom(source.tileScale);
    tile.anchor.copyFrom(source.anchor);
    copyPixiLocalPose(source, tile);
    return tile;
  }
  if (source instanceof pixi.Text) {
    const text = new pixi.Text({
      text: source.text,
      style: source.style.clone(),
    });
    if ('anchor' in source) text.anchor.copyFrom(source.anchor);
    copyPixiLocalPose(source, text);
    return text;
  }
  if (source instanceof pixi.Graphics) {
    const graphics = source.clone(true);
    copyPixiLocalPose(source, graphics);
    return graphics;
  }
  if (source instanceof pixi.Sprite) {
    const sprite = new pixi.Sprite(source.texture);
    sprite.anchor.copyFrom(source.anchor);
    sprite.tint = source.tint;
    copyPixiLocalPose(source, sprite);
    return sprite;
  }
  const container = new pixi.Container();
  copyPixiLocalPose(source, container);
  container.pivot.copyFrom(source.pivot);
  for (const child of source.children) {
    container.addChild(clonePixiVisual(pixi, child as Container));
  }
  return container;
}

function copyPixiLocalPose(source: Container, target: Container): void {
  target.alpha = source.alpha;
  target.visible = source.visible;
  target.rotation = source.rotation;
  target.scale.copyFrom(source.scale);
  target.position.copyFrom(source.position);
  target.skew.copyFrom(source.skew);
}

/**
 * OWNER — this module. SHARERS — {@link capturePixiDisplayObjectThumbnail}.
 * THE ONE TEARDOWN — {@link disposeInspectorPixiPreviewApp}. The live scene
 * Application is never a sharer: three photographs a snapshot on its own
 * WebGLRenderer, and this is that lane for canvas.
 *
 * KEYED BY NAMESPACE, not a singleton. The subject's textures belong to the
 * graph the subject came from, and a renderer only understands its own
 * `TextureSource`s — so a shell Application photographing a project subtree is
 * one renderer looking at another renderer's GPU resources. There is at most
 * one entry per namespace and at most two namespaces on a page (the shell's,
 * and the opened project's under the packaged runtime), so this is a two-slot
 * map, not a cache with a growth story.
 */
const previewApps = new Map<CanvasPixiNamespace, Application>();
const previewAppsReady = new Map<CanvasPixiNamespace, Promise<Application>>();

async function inspectorPixiPreviewApp(pixi: CanvasPixiNamespace): Promise<Application> {
  const existing = previewApps.get(pixi);
  if (existing) return existing;
  let pending = previewAppsReady.get(pixi);
  if (!pending) {
    pending = (async () => {
      const app = new pixi.Application();
      await app.init({
        autoStart: false,
        sharedTicker: false,
        backgroundAlpha: 0,
        width: 128,
        height: 96,
        antialias: true,
      });
      previewApps.set(pixi, app);
      return app;
    })();
    previewAppsReady.set(pixi, pending);
  }
  return pending;
}

/** Test and session teardown — every namespace's app. Idempotent. */
export function disposeInspectorPixiPreviewApp(): void {
  previewAppsReady.clear();
  const apps = [...previewApps.values()];
  previewApps.clear();
  for (const app of apps) {
    app.destroy(true, { children: true, texture: false, textureSource: false });
  }
}

function paddedAspectFrame(
  pixi: CanvasPixiNamespace,
  bounds: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
): Rectangle {
  const padding = 8;
  const frame = new pixi.Rectangle(
    bounds.x - padding,
    bounds.y - padding,
    Math.max(1, bounds.width + padding * 2),
    Math.max(1, bounds.height + padding * 2),
  );
  const targetAspect = width / height;
  if (frame.width / frame.height < targetAspect) {
    const nextWidth = frame.height * targetAspect;
    frame.x -= (nextWidth - frame.width) / 2;
    frame.width = nextWidth;
  } else if (frame.width / frame.height > targetAspect) {
    const nextHeight = frame.width / targetAspect;
    frame.y -= (nextHeight - frame.height) / 2;
    frame.height = nextHeight;
  }
  return frame;
}

/**
 * Photograph a live display subtree on an independent Application.
 * The live scene renderer is never a render target.
 *
 * `null` — the answer `previewImage` already carries for "this surface has no
 * picture of that node" — when the subtree is over
 * {@link PREVIEW_SUBTREE_NODE_BUDGET}. Nothing is cloned and nothing is
 * rendered in that case: the whole cost is the bounded count.
 */
export async function capturePixiDisplayObjectThumbnail(
  target: Container,
  options: CanvasThumbnailSize & {
    budget?: number;
    /** THE namespace `target` came from. Absent ⇒ this bundle's own copy,
     *  which is right on every one-graph runtime. */
    pixi?: CanvasPixiNamespace;
  } = {},
): Promise<string | null> {
  const width = options.width ?? 128;
  const height = options.height ?? 96;
  const pixi = options.pixi ?? shellPixi;
  const budget = options.budget ?? PREVIEW_SUBTREE_NODE_BUDGET;
  // DECLINE BEFORE THE RENDERER. An over-budget subtree costs this call the
  // bounded count and nothing else — no preview Application is resolved (the
  // first selection would otherwise create a real WebGL renderer to draw a
  // picture it is about to refuse), nothing is cloned, nothing is rasterized.
  if (countPixiSubtree(target, budget) > budget) return null;
  const app = await inspectorPixiPreviewApp(pixi);
  // Counted a second time inside, and deliberately: the world keeps running
  // across the `await` above, so the subtree that gets CLONED is not provably
  // the one that was counted. The snapshot's own budget is what bounds the
  // clone; the count above is what keeps the common refusal free.
  const snapshot = snapshotPixiPreviewSubject(target, budget, pixi);
  if (snapshot === null) return null;
  app.stage.removeChildren();
  app.stage.addChild(snapshot);
  try {
    const frame = paddedAspectFrame(pixi, snapshot.getLocalBounds(), width, height);
    const source = (await app.renderer.extract.canvas({
      target: app.stage,
      frame,
    })) as HTMLCanvasElement;
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d');
    if (!context)
      throw new Error('Canvas selection preview could not create a 2D readback context.');
    const scale = Math.min(width / source.width, height / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    context.drawImage(
      source,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    return output.toDataURL('image/png');
  } finally {
    app.stage.removeChildren();
    snapshot.destroy({ children: true, texture: false, textureSource: false });
  }
}

/**
 * A `canvasFrame` seam (`composite-screenshot.ts`) for Pixi-owned canvases.
 *
 * THE OTHER HALF of the blank capture, and the half waiting alone cannot fix.
 * The compositor reads a canvas back LATE — after paint — and a WebGL context
 * created without `preserveDrawingBuffer` has had its drawing buffer cleared by
 * then, so `drawImage` of a perfectly-rendered Pixi canvas yields nothing. The
 * story owns its own `<Application>` and does not pass that flag (nor should it
 * have to), so the pixels are taken through Pixi's own extraction instead:
 * `renderer.extract.canvas` renders the stage into a texture and reads it back,
 * which is correct whatever the context was created with.
 *
 * Returns `null` for a canvas no collected Application owns — the seam's
 * documented "read the canvas directly" answer, so an ordinary DOM story's
 * canvas is untouched.
 */
export function pixiCanvasFrame(
  apps: readonly Application[],
): (canvas: HTMLCanvasElement) => Promise<CanvasImageSource | null> {
  return async (canvas) => {
    const app = apps.find((candidate) => candidate.canvas === canvas);
    if (!app?.renderer) return null;
    // `frame` and `clearColor` are what make this a picture OF THE CANVAS
    // rather than of the display tree: extract's own default frame is the
    // target's content BOUNDS, so a 24-texel gem in a 240x180 cell came back
    // as a 24x24 image that the compositor then stretched over the whole cell,
    // and the story's own `<Application background>` — a renderer clear, not a
    // display object — was missing behind it. The screen shows the app's
    // screen rectangle cleared to its background; so does this.
    const background = app.renderer.background;
    return app.renderer.extract.canvas({
      target: app.stage,
      frame: app.screen,
      ...(background.alpha > 0 ? { clearColor: background.color } : {}),
    }) as unknown as CanvasImageSource;
  };
}

/**
 * The Applications a mounted editor SURFACE is presenting right now.
 *
 * The story sheet knows its own Applications because it created them inside
 * one call ({@link withApplicationCollector}); a board does not — its exhibits
 * outlive any single capture, and the capture is taken by a door
 * (`capture-active-document`) that knows nothing about Pixi. So a surface that
 * adopts mounted stories registers them here, and {@link presentedPixiFrame}
 * is the `canvasFrame` the composite lane passes for EVERY document: it
 * answers for a registered canvas and returns `null` — "read the canvas
 * directly" — for every other. Without it a canvas board photographs blank,
 * for exactly the reason {@link pixiCanvasFrame} records.
 *
 * OWNER: the presenting surface. The returned function is the ONE way to
 * unregister, and it runs in that surface's own teardown.
 */
const presentedApps = new Set<Application>();
const presentedCanvasFrames = new Map<HTMLCanvasElement, () => Promise<CanvasImageSource | null>>();

export function registerPresentedPixiApps(apps: readonly Application[]): () => void {
  for (const app of apps) presentedApps.add(app);
  return () => {
    for (const app of apps) presentedApps.delete(app);
  };
}

/** Register a surface whose presented pixels need preparation beyond Pixi's
 * ordinary raw-stage extraction. The native canvas Scene uses this to render
 * its independent editor camera immediately before capture; returning `null`
 * then tells the compositor to read the already-presented canvas directly.
 *
 * Kept at the pixel boundary, not in the capture command: the presenting
 * surface is the only owner that knows whether its view is a raw stage, a
 * camera, a render texture, or some other native Pixi presentation. */
export function registerPresentedCanvasFrame(
  canvas: HTMLCanvasElement,
  frame: () => Promise<CanvasImageSource | null>,
): () => void {
  presentedCanvasFrames.set(canvas, frame);
  return () => {
    if (presentedCanvasFrames.get(canvas) === frame) presentedCanvasFrames.delete(canvas);
  };
}

/** The `canvasFrame` seam over {@link registerPresentedPixiApps}' live set. */
export function presentedPixiFrame(canvas: HTMLCanvasElement): Promise<CanvasImageSource | null> {
  const prepared = presentedCanvasFrames.get(canvas);
  if (prepared) return prepared();
  return pixiCanvasFrame([...presentedApps])(canvas);
}

/**
 * Run `task` with every `Application` created during it collected.
 *
 * `__PIXI_APP_INIT__` is Pixi's own global init hook (`ApplicationInitHook`,
 * the seam its devtools use), fired once per `Application.init()`. It is the
 * only observation point keyed on the MOUNT itself: `@pixi/react` keys its
 * reconciler roots off the canvas element in a map it does not export, and a
 * story's `<Application>` is written by the story, so its `onInit` prop is not
 * ours to pass. Any previously-installed hook (a devtools extension) is
 * forwarded, and the previous value is restored when the window closes.
 *
 * Exported because the CAPTURE lane needs the same observation for a different
 * reason — see {@link awaitPixiStoryFrame}.
 */
export async function withApplicationCollector<T>(
  task: (created: Application[]) => Promise<T>,
): Promise<T> {
  const created: Application[] = [];
  const previous = globalThis.__PIXI_APP_INIT__;
  globalThis.__PIXI_APP_INIT__ = (instance, version) => {
    // The hook's declared parameter is `Application | Renderer`; only
    // `ApplicationInitHook` calls THIS one, but narrow structurally rather than
    // trust that, since a mis-typed entry would put a renderer on the board.
    const candidate = instance as Partial<Application>;
    if (candidate.stage && candidate.ticker) created.push(instance as Application);
    previous?.(instance, version);
  };
  try {
    return await task(created);
  } finally {
    globalThis.__PIXI_APP_INIT__ = previous;
  }
}
