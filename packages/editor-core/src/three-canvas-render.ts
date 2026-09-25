/**
 * The Three set's canvases, rendered at a caller's scale
 * (`@volter/editor-sdk/kit/canvas-frames`): the Scene viewport's presented frame
 * or a fresh render of it, and an Object3D document's presented frame or an
 * offscreen render of its subject. The editor-chrome photograph asks here, so a
 * 2x capture of a viewport gets a 2x render rather than a 1x one stretched.
 */
import { registerCanvasRender } from '@volter/editor-sdk/kit/canvas-frames';
import { allObject3DDocumentSessions } from './authoring/object3d-document-session-registry';
import { liveCanvasFrame } from '@volter/editor-sdk/kit/live-canvas-frame';
import { threeStoreForHost } from './shell-store-door';

async function imageOf(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return image;
}

export function registerThreeCanvasRender(): () => void {
  return registerCanvasRender((canvas, size) => {
    const store = threeStoreForHost();
    if (store && store.viewportCanvas() === canvas) {
      return (async () => {
        const presented = await liveCanvasFrame(canvas);
        if (presented) return presented;
        const dataUrl = store.captureViewportImage(size);
        return dataUrl ? imageOf(dataUrl) : null;
      })();
    }
    const session = allObject3DDocumentSessions().find((candidate) => candidate.renderer.domElement === canvas);
    if (!session) return null;
    return (async () => {
      // The PRESENTED frame first: everything the host drew over the document's
      // own render — the compass above all — lives only in the default
      // framebuffer, and `captureImage` is an offscreen re-render of the subject
      // alone. Falling back to it keeps a stopped loop photographable.
      const presented = await session.requestPresentedFrame();
      if (presented) return presented;
      const dataUrl = session.captureImage(size);
      return dataUrl ? imageOf(dataUrl) : null;
    })();
  });
}
