/** Two-Hz filmstrip encoding. HTMLCanvasElement.toBlob can synchronously flush
 * GPU work before returning; keeping only its callback async does not protect
 * the game loop. Transfer an ImageBitmap; draw/downscale and encode in a worker.
 * One pending image bounds memory. Stop settles it and closes every owned bitmap.
 * Unsupported workers/canvases report a preview error; never silently fall back
 * to blocking the main thread. The video recorder can continue without previews.
 */
export function createRecordingPreviewEncoder() {
  let worker: Worker | null = null;
  let stopped = false;
  let pending: { resolve: (blob: Blob) => void; reject: (error: Error) => void } | null = null;
  const source = `
    let canvas;
    onmessage = async ({data}) => {
      const {bitmap, width, height, type, quality} = data;
      try {
        if (!canvas) canvas = new OffscreenCanvas(width, height);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No worker canvas context');
        context.globalCompositeOperation = 'copy';
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        const blob = await canvas.convertToBlob({type, quality});
        postMessage({blob});
      } catch (error) {
        bitmap.close();
        postMessage({error: error instanceof Error ? error.message : String(error)});
      }
    };
  `;
  function fail(error: Error) {
    const job = pending;
    pending = null;
    worker?.terminate();
    worker = null;
    job?.reject(error);
  }
  return {
    encode(
      canvas: HTMLCanvasElement,
      width: number,
      height: number,
      type: string,
      quality: number,
    ): Promise<Blob> {
      if (stopped) return Promise.reject(new Error('Recording preview encoder stopped'));
      if (pending) return Promise.reject(new Error('Recording preview already in flight'));
      return new Promise<Blob>((resolve, reject) => {
        const job = { resolve, reject };
        pending = job;
        try {
          if (!worker) {
            const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            try {
              worker = new Worker(url);
            } finally {
              URL.revokeObjectURL(url);
            }
            worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob; error?: string }>) => {
              if (data.error || !data.blob) {
                fail(new Error(data.error ?? 'No recording preview image'));
                return;
              }
              const job = pending;
              pending = null;
              job?.resolve(data.blob);
            };
            worker.onerror = (event) => {
              event.preventDefault();
              fail(new Error(event.message || 'Recording preview worker failed'));
            };
            worker.onmessageerror = () =>
              fail(new Error('Recording preview worker message failed'));
          }
          // Snapshot cost belongs in the main-thread profile too. Do not replace
          // this with toDataURL/getImageData: those force synchronous readback.
          createImageBitmap(canvas).then(
            (bitmap) => {
              if (stopped || pending !== job || !worker) {
                bitmap.close();
                return;
              }
              try {
                worker.postMessage({ bitmap, width, height, type, quality }, [bitmap]);
              } catch (error) {
                bitmap.close();
                fail(error instanceof Error ? error : new Error(String(error)));
              }
            },
            (error) => {
              if (pending === job) fail(error instanceof Error ? error : new Error(String(error)));
            },
          );
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    dispose() {
      stopped = true;
      fail(new Error('Recording preview encoder stopped'));
    },
  };
}
