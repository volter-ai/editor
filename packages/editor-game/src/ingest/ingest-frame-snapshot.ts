/**
 * SAME-FRAME PIXELS for an ingested game's canvas — the reason `volter-game-editor
 * screenshot` no longer returns black over a running ingest.
 *
 * ## The failure
 *
 * `composite-screenshot.ts` reads a game's canvas with `drawImage`, and that
 * only works on a WebGL canvas whose context was created with
 * `preserveDrawingBuffer: true`. Every canvas the volter RUNTIME mounts sets it
 * (`@volter/editor-game/runtime/create-runtime`), which is why the composite leg has always
 * worked for first-party play. An INGESTED game creates its own canvas: the
 * racing-game's `<Canvas>` passes no `gl` prop, so fiber's default
 * (`preserveDrawingBuffer: false`) applies, the browser discards the drawing
 * buffer after compositing, and a `drawImage` from a later task — which is
 * exactly what the composite leg does, after `waitForPaint`/
 * `waitForFiniteMotion` — reads BLACK. Silently: the composite's near-black
 * retry is gated on there being no canvas at all.
 *
 * ## Why this and not `preserveDrawingBuffer`
 *
 * The rejected alternative was to make the ingested canvas readable — a global
 * `HTMLCanvasElement.prototype.getContext` patch forcing the flag. Three things
 * are wrong with it and none are stylistic: the realm's lexical
 * `window`/`document` shadow deliberately skips `node_modules`
 * (`server/game-globals-shadow.ts`), and R3F creates the canvas inside
 * `@react-three/fiber`, so a realm-scoped trap cannot reach it at all; a global
 * one sits in front of the EDITOR's own canvases too and needs a host-vs-game
 * identity filter, which is the exact timing-sensitive problem
 * `SceneCaptureOptions.isHostRenderer` was painfully introduced to solve; and
 * it makes every ingested game pay a permanent per-frame cost so a screenshot
 * can occasionally be taken.
 *
 * The drawing buffer is not "unreadable", it is unreadable LATE. Read inside
 * the game's own render call and the pixels are there, no flag required. The
 * host already has that bracket and did not have to invent it: the capture trap
 * stands between an ingested game and its own `WebGLRenderer.render`
 * (`@volter/threejs-runtime/adapter/ingest/scene-capture`), and its `RenderPassHooks.after()`
 * runs synchronously inside that call — the same bracket `renderDebug` uses.
 * So this is arm-and-deliver on an existing seam, in the shape
 * `dev/render-debug-adapter.ts`'s `captureFrame()` already established: zero
 * cost until armed, and it works regardless of the game's GL flags (a vanilla
 * three ingest, or any future game that opts out, is covered for free).
 *
 * ## RESOURCE OWNERSHIP
 *
 * OWNER: the live three ingest mount. `wireIngestSystems`
 * (`ingest-render-debug.ts`) is the one installer — it owns the single
 * `setRenderPassHooks` slot and multiplexes it — and
 * `ingest-root-adapter.ts`'s `dispose()` is the ONE teardown path, through
 * {@link clearIngestFrameSource}. SHARERS: none; at most one ingest session is
 * mounted at a time (`mount-ingest-root.ts` fails a second by name), which is
 * why the armed state below is module-scoped rather than per-mount.
 *
 * THE COPY CANVAS IS A RECORDING'S, NOT A FRAME'S. A recorder asks for a
 * same-frame snapshot on every frame it paints (`host/gameplay-recording.ts`,
 * 30 times a second), and a fresh full-size 2D canvas per answer is ~3.7 MB at
 * 1280×720 — about 110 MB/s of canvas backing store that GC never caught up
 * with (measured: a renderer at 3.2 GB under one long agent-driven run). So a
 * recording HOLDS one copy canvas for its lifetime ({@link holdIngestFrameCopy})
 * and every delivery while it is held overwrites that one. OWNER: the
 * recording that took the hold; its stop is the one release. A one-off
 * snapshot with no hold (a screenshot outside a recording) still gets its own
 * canvas, which is the unchanged path. Sharing is safe because every consumer
 * draws the copy in the same task the snapshot settles in, and the next
 * delivery can only come from a later render pass.
 */

/** What the module needs from the captured runtime to take a snapshot. */
export interface IngestFrameSource {
  readonly renderer: {
    readonly domElement?: unknown;
    getRenderTarget?(): unknown;
  };
}

/** The live mount's source, or `null` between mounts. */
let source: IngestFrameSource | null = null;

interface ArmedSnapshot {
  readonly settle: (image: HTMLCanvasElement | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  /** The most recent copy taken this frame; see {@link deliverArmedIngestFrame}
   *  for why the LAST one is the answer and not the first. */
  image: HTMLCanvasElement | null;
  delivering: boolean;
}
let armed: ArmedSnapshot | null = null;

interface FrameCopyHold {
  /** Created by the first delivery under this hold, then reused. */
  canvas: HTMLCanvasElement | null;
}
/** The live recording's hold on its reusable copy target, or `null` while no
 *  recording holds one. See {@link holdIngestFrameCopy}. */
let frameCopyHold: FrameCopyHold | null = null;

/**
 * Hold ONE copy canvas for a recording's lifetime; every snapshot delivered
 * while it is held is written into it rather than into a new canvas. Returns
 * the release, which drops the canvas. Idempotent, and a stale release (a
 * recording whose hold a newer one already replaced) leaves the newer hold
 * alone.
 */
export function holdIngestFrameCopy(): () => void {
  const hold: FrameCopyHold = { canvas: null };
  frameCopyHold = hold;
  return () => {
    hold.canvas = null;
    if (frameCopyHold === hold) frameCopyHold = null;
  };
}

/** Install the live mount's runtime. Called by the one installer. */
export function setIngestFrameSource(next: IngestFrameSource | null): void {
  source = next;
  if (!next) clearIngestFrameSnapshot();
}

/** Teardown: drop the source AND settle any armed wait, so a screenshot in
 *  flight when the mount goes down resolves (as "no frame") instead of hanging
 *  until its timeout. */
export function clearIngestFrameSource(): void {
  source = null;
  clearIngestFrameSnapshot();
}

function clearIngestFrameSnapshot(): void {
  const pending = armed;
  armed = null;
  if (pending) {
    clearTimeout(pending.timer);
    pending.settle(null);
  }
}

/**
 * The game's own canvas, or `null` when there is no live ingest runtime.
 *
 * Deliberately NOT an `instanceof HTMLCanvasElement` test: this module is
 * imported by the command relay, which runs headless in Node for the relay
 * suites — there `HTMLCanvasElement` is not even defined, and the reference
 * alone would throw on every first-party screenshot. The only question a
 * caller asks is identity ("is the canvas I found the ingest mount's?"), which
 * needs no class.
 */
export function ingestFrameCanvas(): HTMLCanvasElement | null {
  const element = source?.renderer.domElement;
  return typeof element === 'object' && element !== null ? (element as HTMLCanvasElement) : null;
}

/**
 * Called from inside the game's render pass (the capture trap's `after`).
 * Copies the live drawing buffer when a snapshot is armed AND this render went
 * to the canvas rather than to an offscreen target — a game that bakes a
 * render target mid-frame (racing-game's minimap does) must not have that pass
 * mistaken for its picture.
 *
 * THE LAST CANVAS PASS OF THE FRAME IS THE PICTURE, not the first, and that is
 * a MEASURED correction rather than a precaution. A frame is often several
 * canvas-targeted `render()` calls: racing-game's minimap draws the world,
 * then `clearDepth()`, then the map overlay — all to the canvas — and drei's
 * `<Hud>` has the identical shape. Settling on the first bracket produced a
 * capture with the minimap MISSING, i.e. a screenshot that silently omitted a
 * HUD layer the human can see. So each qualifying pass overwrites the copy and
 * the promise settles one macrotask later, once the frame's JS has finished
 * and no further pass can arrive.
 *
 * Never throws: it runs inside the game's own frame.
 */
export function deliverArmedIngestFrame(): void {
  const pending = armed;
  if (!pending || !source) return;
  try {
    const renderer = source.renderer;
    if (typeof renderer.getRenderTarget === 'function' && renderer.getRenderTarget() !== null) {
      return;
    }
    const canvas = ingestFrameCanvas();
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const hold = frameCopyHold;
    const copy =
      pending.image ?? hold?.canvas ?? canvas.ownerDocument.createElement('canvas');
    if (hold && !hold.canvas) hold.canvas = copy;
    // Resizing reallocates (and clears) the backing store, so only a size
    // change pays for it; a reused copy of the same size is cleared instead —
    // a game canvas with alpha must not composite over the previous frame.
    const resized = copy.width !== canvas.width || copy.height !== canvas.height;
    if (copy.width !== canvas.width) copy.width = canvas.width;
    if (copy.height !== canvas.height) copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    if (!ctx) return;
    if (!resized) ctx.clearRect(0, 0, copy.width, copy.height);
    ctx.drawImage(canvas, 0, 0);
    pending.image = copy;
    if (pending.delivering) return;
    pending.delivering = true;
    setTimeout(() => {
      if (armed !== pending) return;
      armed = null;
      clearTimeout(pending.timer);
      pending.settle(pending.image);
    }, 0);
  } catch {
    // A snapshot that cannot be taken is a capture that degrades to the
    // ordinary canvas read; it is never the game's frame breaking.
  }
}

/**
 * Ask for the next frame the ingested game draws to its canvas, as a readable
 * 2D canvas. Resolves `null` when nothing is mounted, when the game does not
 * render inside `timeoutMs` (a paused or hidden game), or when the mount goes
 * down first — every one of which means "capture it the ordinary way".
 *
 * Only one wait at a time; a second arm supersedes the first, which settles
 * `null`.
 */
export function armIngestFrameSnapshot(timeoutMs = 2000): Promise<HTMLCanvasElement | null> {
  if (!source) return Promise.resolve(null);
  clearIngestFrameSnapshot();
  return new Promise<HTMLCanvasElement | null>((resolve) => {
    const timer = setTimeout(() => {
      if (armed?.timer === timer) armed = null;
      resolve(null);
    }, timeoutMs);
    armed = { settle: resolve, timer, image: null, delivering: false };
  });
}
