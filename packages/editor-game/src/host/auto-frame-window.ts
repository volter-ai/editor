/**
 * What is still allowed to move the editor camera after a world is adopted,
 * and when that stops.
 *
 * Opening the Scene tab on an adopted world is not one action, because the
 * world is not one event: a game captures on its first drawn frame and keeps
 * building itself for seconds afterwards (a level streams in; an R3F game's
 * own camera appears only when its `<Suspense>` content resolves). So there is
 * a WINDOW, and two things may fire inside it — the game's own camera, which
 * wins outright, and a measured framing, which lands once as the interim
 * answer. `scene-framing.ts` is what each of those means.
 *
 * The rule that outranks both: **the reader's first camera gesture ends the
 * window** (#1706). Yanking the view out from under someone already looking is
 * worse than never framing at all, so `cancel()` is total — after it, nothing
 * in here touches the camera again, whatever is still loading.
 */

/** How long a requested auto-frame keeps waiting for a world that is still
 *  building itself, and how often it re-checks. */
export const AUTO_FRAME_WINDOW_MS = 20_000;
export const AUTO_FRAME_RETRY_MS = 250;
/** How long an adopted game gets to produce its OWN camera before the editor
 *  settles for its measured framing. Shorter than the framing window on
 *  purpose: replacing the view is welcome while the reader is still watching
 *  the world appear, and an intrusion long after that. */
export const AUTO_SEED_WINDOW_MS = 5_000;

/** The two things that may open the reader on the world. Each returns whether
 *  it actually moved the camera. */
export interface AutoFrameSteps {
  /** Adopt the adopted game's own camera; false when it has none yet, or none
   *  whose view is usable. */
  seedFromGameCamera(): boolean;
  /** Frame the content that exists right now; false when there is none yet. */
  frameContent(): boolean;
}

export class AutoFrameWindow {
  #framingDeadline = 0;
  #seedDeadline = 0;
  #nextTry = 0;
  readonly #steps: AutoFrameSteps;

  constructor(steps: AutoFrameSteps) {
    this.#steps = steps;
  }

  /** True while something in here may still move the camera. */
  get pending(): boolean {
    return this.#framingDeadline > 0 || this.#seedDeadline > 0;
  }

  /**
   * Open the window and take the first attempt immediately.
   * `watchForGameCamera` is false for a world that has no game camera to wait
   * for — a first-party scene never gets one.
   */
  begin(now: number, watchForGameCamera: boolean): void {
    this.#framingDeadline = now + AUTO_FRAME_WINDOW_MS;
    this.#seedDeadline = watchForGameCamera ? now + AUTO_SEED_WINDOW_MS : 0;
    this.#nextTry = 0;
    this.tick(now);
  }

  /** Ride the caller's frame loop. Cheap and self-rate-limiting: a no-op
   *  unless the window is open and the retry cadence has come round. */
  tick(now: number): void {
    if (!this.pending || now < this.#nextTry) return;
    this.#nextTry = now + AUTO_FRAME_RETRY_MS;
    // The game's own camera outranks any measurement, and ends the window: it
    // is the answer both other paths were approximating.
    if (this.#seedDeadline > 0 && this.#steps.seedFromGameCamera()) {
      this.cancel();
      return;
    }
    // The framing lands ONCE — re-framing every retry would drag the view
    // around for the whole window while a level streams in.
    if (this.#framingDeadline > 0 && this.#steps.frameContent()) this.#framingDeadline = 0;
    if (now >= this.#framingDeadline) this.#framingDeadline = 0;
    if (now >= this.#seedDeadline) this.#seedDeadline = 0;
  }

  /** The reader took the camera. Nothing here moves it again. */
  cancel(): void {
    this.#framingDeadline = 0;
    this.#seedDeadline = 0;
  }
}
