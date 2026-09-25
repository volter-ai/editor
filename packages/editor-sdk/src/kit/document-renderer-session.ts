import {
  isEditorPresentationActive,
  subscribeEditorPresentationActivity,
} from '@volter/editor-sdk/kit/editor-presentation-activity';

/**
 * The frame-loop + renderer lifetime for one Object3D document viewport.
 *
 * Deactivate ≠ dispose.
 *
 * The layout host keeps every open document mounted. A tab
 * flip only flips `active`. Destroying the `WebGLRenderer` on deactivate is
 * a full context teardown + recreate on the next flip — measured live on
 * `examples/third-person` at 4296 ms for the first 3D-board activation and
 * 4015 ms for the second (doctor `--timings-only`). Pause the RAF loop
 * instead; the canvas keeps its last frame and the program cache / IBL bake
 * survive. Real document CLOSE unmounts the host, and {@link dispose} is the
 * one path that frees the context.
 */

export class DocumentRendererSession {
  private rafId = 0;
  private running = false;
  private disposed = false;
  private active = false;
  private readonly unsubscribeActivity: () => void;

  constructor(
    private readonly frame: (time: number, resumed: boolean) => void,
    private readonly releaseRenderer: () => void,
  ) {
    this.unsubscribeActivity = subscribeEditorPresentationActivity(() => this.syncActivity());
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Tab flip. `false` pauses the loop and keeps the GPU surface. `true`
   * resumes it. Neither constructs nor disposes a renderer.
   */
  setActive(active: boolean): void {
    if (this.disposed) return;
    this.active = active;
    this.syncActivity();
  }

  private syncActivity(): void {
    if (this.active && isEditorPresentationActive()) this.start();
    else this.stop();
  }

  /** Resizing clears the drawing buffer. Repaint immediately while visible;
   * a suspended document redraws as soon as its presentation resumes. */
  redraw(): void {
    if (this.running && !this.disposed && isEditorPresentationActive()) {
      this.guardedFrame(performance.now());
    }
  }

  /** The one teardown path — document CLOSE / host unmount. */
  dispose(): void {
    this.stop();
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeActivity();
    this.releaseRenderer();
  }

  private start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    // A tab activation is a direct request to present this document. Draw one
    // frame in the activation turn, then join the browser's animation clock.
    // Waiting for the first rAF made a visible tab inherit Chromium's former
    // background cadence (the 1 Hz signature) even when the page itself was
    // visible; users saw the old canvas for that whole interval. Subsequent
    // presentation remains ordinary rAF-driven work.
    // Let content reset its delta baseline without advancing by the hidden interval.
    this.guardedFrame(performance.now(), true);
    if (!this.running || this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** The last frame's failure text, so a persistent fault narrates ONCE
   *  rather than sixty times a second, and a recovered loop resets. */
  private lastFrameFailure: string | null = null;

  /**
   * One frame, and the loop survives it. A throw out of a rAF callback used
   * to be the end of this document's presentation: the exception left
   * `tick` before it rescheduled, so the stage froze on whatever it last
   * drew and nothing said why. Measured (2026-09-04, the mesh document's
   * session swap): three's "Cannot read properties of null (reading
   * 'precision')" from one frame drawn between a disposed overlay and the
   * scene swap killed the stage for the rest of the session. The frame's
   * failure goes to the console WITH its stack — that is what reaches the
   * doors — and the next frame is drawn, because a transient race recovers
   * on its own and a persistent fault is still better shown than frozen.
   */
  private guardedFrame(time: number, resumed = false): void {
    try {
      this.frame(time, resumed);
      this.lastFrameFailure = null;
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : String(caught);
      if (text !== this.lastFrameFailure) {
        this.lastFrameFailure = text;
        // biome-ignore lint/suspicious/noConsole: a document frame that threw must narrate itself
        console.error('[document renderer] a frame threw; the loop continues:', caught);
      }
    }
  }

  private stop(): void {
    this.running = false;
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private readonly tick = (time: number): void => {
    if (!this.running || this.disposed) return;
    if (!isEditorPresentationActive()) {
      this.stop();
      return;
    }
    this.guardedFrame(time);
    if (!this.running || this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);
  };
}
