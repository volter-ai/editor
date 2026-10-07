/** One owned screenshot bitmap; encode away from the live document's frame loop. */
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<ImageBitmap>) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
};

worker.onmessage = async ({ data: bitmap }) => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG encoding has no 2d canvas context');
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    worker.postMessage({ blob });
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
    worker.close();
  }
};

export {};
