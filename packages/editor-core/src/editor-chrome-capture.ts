/**
 * THE CHROME-CAPTURE DOOR: photograph the editor PAGE — every panel, every
 * tab strip, the Inspector, the viewport inside it — as the person is seeing
 * it. `vgai screenshot editor` / `editor.captureEditorChrome()`.
 *
 * WHY IT EXISTS. Every other capture door photographs a SUBJECT: the running
 * game, the active document, the Scene viewport, a model. None photographs
 * the editor itself, so a contribution author — human or agent — could not
 * run the sighted render→look→revise loop on a panel through the product, and
 * every dev-surface wave so far was built blind, on DOM probes (WORK.md, "The
 * chrome-capture door"). A skin, a workspace arrangement or a new region
 * cannot be judged at all without this.
 *
 * HOW. The same compositor the active-document door uses
 * (`composite-screenshot.ts`), pointed at `#editor-chrome-root` — the ONE
 * theme scope (ARCHITECTURE-CORE §Editor chrome) — with `includeDocumentStyles`
 * on, so the design system's stylesheet rides the clone and chrome
 * photographs as it appears. Three kinds of canvas sit inside that root and
 * only one of them can be read late:
 *
 *  - a canvas a medium re-renders at a chosen size — a three.js viewport or
 *    Object3D document with no `preserveDrawingBuffer` — is drawn by that
 *    medium (`@volter/editor-sdk/kit/canvas-frames`'s `renderedCanvasFrame`);
 *  - a live game or Pixi canvas goes through the one `canvasFrame` seam
 *    every pixel door shares (`live-canvas-frame.ts`).
 *
 * Everything else reads directly. A canvas this module cannot recognise or
 * re-render photographs as the browser hands it back — possibly black — and
 * `layers.canvases` says how many were drawn, so a reader can tell a black
 * panel from a missing one.
 */

import type { EditorView } from '@volter/editor-sdk';
import { renderedCanvasFrame } from '@volter/editor-sdk/kit/canvas-frames';
import { type CompositeCapture, capturePlayComposite } from './composite-screenshot';
import { currentEditorView } from './editor-current-view';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { liveCanvasFrame } from '@volter/editor-sdk/kit/live-canvas-frame';
import { activeDocumentContainer } from './editor-document-probe';
import { activeWorkspaceDocumentId } from '@volter/editor-sdk/kit/workspace-document-registry';

export const EDITOR_CHROME_ROOT_ID = 'editor-chrome-root';

export interface EditorChromeCapture extends CompositeCapture {
  /** The view the page was showing when the frame was taken. */
  view: EditorView;
  /** The frame's own size, in OUTPUT pixels. */
  size: { width: number; height: number };
  /** Output pixels per CSS pixel — what one pixel of {@link size} is. A
   *  reference frame captured on a 2x display is judged against `scale: 2`. */
  scale: number;
}

export interface EditorChromeCaptureOptions {
  /**
   * Output pixels per CSS pixel. Defaults to the page's own
   * `devicePixelRatio`, so the default frame is the pixels the display holds.
   *
   * A stroke weight, a 1 px border or a glyph edge cannot be judged below the
   * resolution it is being compared against — on a DPR-1 monitor the default
   * is 1 and a reference captured at 2x is only comparable if this is asked
   * for explicitly. It scales the DOM leg by rasterizing it through a viewBox
   * (crisp at any factor); canvases are limited by their own backing store and
   * are upscaled past it.
   */
  scale?: number;
  /** `page`, the default: the whole editor. `document`: the active document's own box, as
   *  the person sees it, overlays included. */
  region?: 'page' | 'document';
}

/** A data URL as something `drawImage` accepts. */
/**
 * Same-frame pixels for every canvas the page holds — the seam described in
 * the header. `null` means "read the canvas directly".
 */
function chromeCanvasFrame(scale: number) {
  return async (canvas: HTMLCanvasElement): Promise<CanvasImageSource | null> => {
    // A medium's re-render draws at a size WE choose, so it is asked for the
    // frame's own scale — a 2x capture whose viewport had to be re-rendered gets
    // a 2x render, not a 1x one stretched (`@volter/editor-sdk/kit/canvas-frames`).
    const size = {
      width: Math.max(1, Math.round(canvas.clientWidth * scale)),
      height: Math.max(1, Math.round(canvas.clientHeight * scale)),
    };
    return (await renderedCanvasFrame(canvas, size)) ?? liveCanvasFrame(canvas);
  };
}

/** Photograph the editor page. Throws, by name, when the chrome root is not
 *  mounted — a page that is not the editor has nothing to photograph. */
export async function captureEditorChrome(
  store: ShellStore,
  options?: EditorChromeCaptureOptions,
): Promise<EditorChromeCapture> {
  const page = document.getElementById(EDITOR_CHROME_ROOT_ID);
  if (!page) {
    throw new Error(
      `The editor chrome root (#${EDITOR_CHROME_ROOT_ID}) is not mounted, so there is no editor ` +
        'page to photograph.',
    );
  }
  // THE DOCUMENT REGION: the same compositor over the active document's own box, so a stage is
  // photographed with what the person sees over it (its navigation gizmo, its readouts), not
  // as the document's render alone.
  let root: HTMLElement = page;
  if (options?.region === 'document') {
    const documentId = activeWorkspaceDocumentId();
    const box = documentId ? activeDocumentContainer(documentId) : null;
    if (!box) throw new Error('No active document is showing, so there is no document region to photograph.');
    root = box;
  }
  const scale = options?.scale ?? window.devicePixelRatio ?? 1;
  const rect = root.getBoundingClientRect();
  const size = {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
  const composite = await capturePlayComposite(root, {
    canvasFrame: chromeCanvasFrame(scale),
    includeDocumentStyles: true,
    size,
  });
  return { ...composite, view: currentEditorView(store), size, scale };
}
