/**
 * A document whose subject runs in a same-origin frame (the Build Player runs
 * the project's own build in one) registers that frame here, so the capture
 * door photographs what runs inside it: the composite of the frame's own
 * document, not the editor's DOM around an `<iframe>` it cannot see into.
 *
 * `canvasFrame` is the composite's same-frame seam (`CaptureOptions`): the
 * frame's canvases are its game's, created without `preserveDrawingBuffer`,
 * so only the frame can copy them right after it renders.
 */

export interface FramedCapture {
  /** The element of the frame's document to composite. */
  readonly container: () => HTMLElement | null;
  readonly canvasFrame: (canvas: HTMLCanvasElement) => Promise<CanvasImageSource | null>;
}

const framed = new WeakMap<HTMLIFrameElement, FramedCapture>();

export function registerFramedCapture(frame: HTMLIFrameElement, capture: FramedCapture): void {
  framed.set(frame, capture);
}

/** The framed subject inside a document's content, when it has one. */
export function framedCapture(
  content: HTMLElement,
): { readonly container: HTMLElement; readonly canvasFrame: FramedCapture['canvasFrame'] } | null {
  for (const frame of Array.from(content.querySelectorAll('iframe'))) {
    const capture = framed.get(frame);
    const container = capture?.container();
    if (capture && container) return { container, canvasFrame: capture.canvasFrame };
  }
  return null;
}
