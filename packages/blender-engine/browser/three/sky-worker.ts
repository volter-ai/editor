/**
 * The page's side of the sky worker: one long-lived worker, one promise per sky.
 *
 * WHY A CLIENT MODULE AND NOT A `new Worker` AT THE CALL SITE: the worker is
 * built once and reused, because constructing one costs a module graph fetch and
 * a sky world re-derives on every sun edit. Requests are keyed by id so several
 * skies (a world split by `Is Camera Ray` has two) ride one worker.
 *
 * The type-only import of the worker module is LOAD-BEARING in two ways. It is
 * the contract for what crosses the boundary, and it is also how the probe
 * project's capability sync finds the worker file at all: that sync follows
 * `from './x'` spellings, and `new URL('./x.ts', import.meta.url)` is not one.
 * Delete the import and the worker silently stops being copied.
 */
import { precomputeSkyTexture, type SkyParameters } from './blender-sky';
import type { SkyWorkerRequest, SkyWorkerResponse } from './sky-precompute-worker';

let worker: Worker | null = null;
let workerUnavailable = false;
let nextId = 0;
const waiting = new Map<
  number,
  { resolve: (pixels: Float32Array) => void; reject: (error: Error) => void }
>();

function ensureWorker(): Worker | null {
  if (worker || workerUnavailable) return worker;
  if (typeof Worker === 'undefined') {
    workerUnavailable = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./sky-precompute-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    workerUnavailable = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<SkyWorkerResponse>) => {
    const { id, pixels, error } = event.data;
    const pending = waiting.get(id);
    if (!pending) return;
    waiting.delete(id);
    if (pixels) pending.resolve(pixels);
    else pending.reject(new Error(error ?? 'sky worker returned nothing'));
  };
  // A worker that dies takes every outstanding sky with it. Failing them LOUDLY
  // is the point: `worldReady()` propagates, so a capture reports the error
  // rather than photographing a scene with no sky in it.
  worker.onerror = (event) => {
    const failure = new Error(`sky worker failed: ${event.message || 'unknown error'}`);
    for (const pending of waiting.values()) pending.reject(failure);
    waiting.clear();
    worker?.terminate();
    worker = null;
    workerUnavailable = true;
  };
  return worker;
}

/**
 * One sky's 512x256 texture, derived OFF the main thread.
 *
 * Falls back to deriving it inline when there is no Worker (Node, a test, a
 * blocked construction). That fallback blocks -- which is the whole complaint --
 * but it is CORRECT, and correct-and-slow is the trade this lane already made
 * once by hand.
 */
export function precomputeSkyOffThread(parameters: SkyParameters): Promise<Float32Array> {
  const active = ensureWorker();
  if (!active) return Promise.resolve(precomputeSkyTexture(parameters));
  const id = nextId++;
  const request: SkyWorkerRequest = { id, parameters };
  return new Promise<Float32Array>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    active.postMessage(request);
  });
}
