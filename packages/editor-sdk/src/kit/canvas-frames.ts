/**
 * A CANVAS'S SAME-FRAME PIXELS, answered by the medium that draws into it. A
 * canvas a medium renders without `preserveDrawingBuffer` photographs blank if
 * it is read after its frame, so the kit's compositor asks here instead of
 * reading such a canvas directly. Two doors: the canvases a live surface is
 * presenting now, and the canvases a mount the kit is about to photograph
 * creates (a story's own `<Application>`). With no medium registered the kit
 * reads every canvas directly.
 */
export type CanvasFrame = (canvas: HTMLCanvasElement) => Promise<CanvasImageSource | null>;

let sources: readonly CanvasFrame[] = [];

/** A medium's reader for the canvases its live surfaces present; it answers
 *  `null` for a canvas it does not own. Returns the removal. */
export function registerCanvasFrameSource(source: CanvasFrame): () => void {
  sources = [...sources, source];
  return () => {
    sources = sources.filter((existing) => existing !== source);
  };
}

/** The first registered source's pixels for `canvas`, or null when none owns it. */
export async function presentedCanvasFrame(canvas: HTMLCanvasElement): Promise<CanvasImageSource | null> {
  for (const source of sources) {
    const frame = await source(canvas);
    if (frame) return frame;
  }
  return null;
}

/** What a medium learned while a mount ran: when its surfaces have drawn their
 *  first frame, and how to read their canvases. */
export interface ObservedCanvasMount<T> {
  readonly result: T;
  settled(): Promise<void>;
  readonly frame: CanvasFrame;
}

export interface CanvasMountObserver {
  observe<T>(task: () => Promise<T>): Promise<ObservedCanvasMount<T>>;
}

let observer: CanvasMountObserver | null = null;

/** The one medium that observes mounts for canvases it creates. Returns the removal. */
export function registerCanvasMountObserver(next: CanvasMountObserver): () => void {
  observer = next;
  return () => {
    if (observer === next) observer = null;
  };
}

/** Run a mount under the registered observer, or plainly when none is. */
export async function observeCanvasMount<T>(task: () => Promise<T>): Promise<ObservedCanvasMount<T>> {
  if (observer) return observer.observe(task);
  return { result: await task(), settled: async () => {}, frame: async () => null };
}
